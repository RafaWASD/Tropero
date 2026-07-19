# Gate 1 (modo `spec`) — feature 20: reactividad de lecturas sincronizadas

> Auditoría de seguridad sobre `specs/active/20-reactividad-sync/{context,requirements,design,tasks}.md`.
> Fecha: 2026-07-19. Analista: `security_analyzer` (ADR-019).

## Veredicto

**NEEDS_CLARIFICATION**

- **La frontera de autorización: PASS, sin reservas.** La feature no toca RLS, ni migraciones, ni
  `sync-streams/rafaq.yaml`. No hay elevación de privilegio, no hay fuga cross-tenant, no hay write
  que sobreviva a la revocación. Verificado contra el código, no asumido (§ Respuestas 1-6).
- **Lo que bloquea el PASS limpio es un hecho fáctico que contradice D1**, descubierto al auditar
  justamente la ventana de diferimiento: `remove_member` **revoca la sesión del target** en la misma
  llamada que revoca el rol. El operario SÍ termina pateado en medio de la maniobra — no por
  `active_lost`, sino por pérdida de sesión — dentro de ≤1h. Y el E2E diseñado para probar D1 usa un
  fixture que salta ese paso, así que va a dar verde sobre una promesa falsa. Detalle en **HIGH-1**.

Es una decisión de producto (aceptar D1 como best-effort acotado y decirlo, o resolverlo), no una
decisión mía. **Decide Raf.**

---

## Respuestas a las 6 preguntas del encargo

### 1. ¿Se toca la frontera de autorización real? — **No. Tu lectura es correcta.**

Verificado:

- `sync-streams/rafaq.yaml` **no aparece en ningún task**. `tasks.md` T1-T25 tocan 7 archivos de app
  + `app/e2e/helpers/admin.ts`. Cero migraciones, cero YAML, cero policies. `design.md:38` lo declara
  y el desglose de tasks lo confirma.
- El scoping sigue siendo `org_scope` (`rafaq.yaml:33-34, 85, 114, …`):
  `SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true`.
  Al revocar (`active = false`), el establishment sale de `org_scope` → PowerSync remueve el bucket.
  Ese mecanismo corre **server-side y es totalmente independiente** de cuándo el cliente re-lee.
- ADR-025 (WAL ignora views/RPC/column-GRANTs) sigue respetado: la única lectura nueva
  (`buildActiveRoleQuery`) es un `SELECT` **local** sobre una tabla que **ya** está sincronizada por
  `self_user_roles` (`rafaq.yaml:73-76`). No amplía el sync set en un byte.

**La feature cambia exclusivamente el momento en que el cliente re-lee su propio SQLite.** Confirmado.

### 2. La evidencia afirmativa: ¿mecanismo de seguridad o de UX? — **UX. Y la spec lo trata bien.**

Es dato local en un device que el usuario controla: un usuario con root puede poner `active = 1` en su
SQLite y **nunca** ver el `active_lost`. Eso es aceptable **solo** porque el enforcement es server-side,
y lo verifiqué exhaustivamente:

- `has_role_in()` (`supabase/migrations/0005_rls_helpers.sql:9-25`) exige `ur.active = true` **y**
  `e.deleted_at is null`. Es la base de todas las policies.
- Todos los RPC del outbox son `SECURITY DEFINER` **con el guard primero**:
  `create_animal` (`0083:83-84`), `create_rodeo`/`set_rodeo_config` (`0081:53`, `0103:84-85`),
  `register_birth` (`0075:102`), `assign_tag_to_animal` (`0089:65-66`),
  `link_calf_to_mother` (`0114:83-84`), `exit_animal_profile` (`0044:49-51`),
  `soft_delete_*` (`0041:34,59,78,110`), `soft_delete_maneuver_preset` (`0057:26-27`).
- El CRUD plano va por PostgREST con RLS (`animal_events_insert … has_role_in(establishment_id)`,
  `0034:97-98`; mismo patrón en `0025`).

**No encontré ningún lugar de la spec que trate la fila local como control de acceso.**
`design.md:270-273` (§5.5) lo dice explícitamente y es correcto.

**Pedido de hardening (no bloqueante, MED-1 abajo)**: el lenguaje de `design.md` §4.3 —
*"hecho leído"*, *"determinista"*, *"evidencia afirmativa"*— es lo bastante fuerte como para que un
lector futuro lo confunda con un primitivo de autorización. Falta **una** frase explícita.

### 3. R20.30 fail-OPEN — **aceptable, y por una razón mejor que la que da la spec.**

No crea un camino explotable:

- **No hay escalada marginal.** El atacante que puede inducir el fallo de una lectura del SQLite local
  ya tiene control del SQLite local — puede escribir `active = 1` directamente. Fail-open no le da nada
  que fail-closed le negaría.
- **Y sobre todo: no retiene datos.** Éste es el punto que la spec no explota. Cuando la evidencia
  falla, PowerSync **ya borró el bucket** (eso es E2). Lo que el usuario conserva es la *decisión de
  navegación*, no las filas: se queda mirando una cáscara vacía. Verifiqué que `active_lost` **no
  dispara ningún purge local** (`grep active_lost` sobre `app/src` + `app/app`: solo transiciones de
  estado y ruteo; ningún `disconnectAndClear`). O sea, concluir o no concluir la revocación **no
  cambia qué datos hay en el device**. El fail-open es, literalmente, gratis en términos de exposición.

**Lo que sí es un problema (MED-2)**: `inconclusive` y `unknown` **no tienen salida terminal**, ni
siquiera en arranque en frío. R20.25 quita el *diferimiento* al reiniciar, pero la regla de evidencia
sigue aplicando idéntica → un SQLite local corrupto (el caso en que `unknown` persiste) deja al usuario
clavado en `active` sobre un campo muerto, para siempre y a través de reinicios. Impacto de seguridad:
≈nulo (ver arriba). Impacto de producto: dead-end silencioso. La spec debería **declararlo como
limitación aceptada** o darle un piso.

### 4. Escrituras durante la ventana — **rechazadas server-side de forma confiable. No hay camino.**

Tracé los dos caminos de escritura:

- **op_intents → RPC** (`connector.ts:151-152`): todos los RPC guardan con `has_role_in`/`is_owner_of`
  **antes** de tocar nada (citas en la respuesta 2). `has_role_in` lee `user_roles.active` **de la DB
  server-side**, no del token. Revocado → `42501`.
- **CRUD plano → PostgREST** (`connector.ts:76-107`): RLS con `has_role_in`. Revocado → `42501`.
- `42501` cae en el default `permanent_reject` de `classifyIntentUploadError` →
  `rollbackOverlay` + `transaction.complete()` (`connector.ts:178-180`) / `surfaceUploadRejection` +
  `complete()` (`connector.ts:126-127`). Descartado, nunca persistido.

**Extra que fortalece el caso**: `remove_member` también borra las sesiones del target
(`remove_member/index.ts:106-113` → `revoke_user_sessions`, `0072:46` `delete from auth.sessions`),
así que el refresh token muere ya. La única ventana de escritura es el access token vigente
(`config.toml:160` `jwt_expiry = 3600`) — y dentro de ella, las escrituras igual rebotan por RLS.

Confirmado: **cero caminos de write persistente post-revocación.** (Que rebote *en silencio* es E2,
fuera de scope por D3, y R20.26 impide que el copy mienta al respecto. Correcto.)

### 5. ¿La ventana expone datos que el usuario no había visto? — **No. Verificado, no asumido.**

- Al caer de `org_scope`, PowerSync **remueve** el bucket. El flujo es de resta, no de suma.
- Todas las lecturas afectadas son locales — lo verifiqué archivo por archivo, no por la declaración
  de la spec: `loadMemberships` (`establishments.ts:70-89`, `runLocalQuery`), `fetchRodeos`
  (`rodeos.ts:149-150`, `runLocalQuery`). Ninguna re-lectura sale a la red, así que no hay forma de
  traerse datos frescos del campo revocado durante la ventana. R20.31 lo exige y el código as-built ya
  lo cumple.
- Un intento de leer por red igual rebotaría: `has_role_in` = false.
- **Único matiz, y NO lo introduce esta feature**: entre el commit de la revocación y el checkpoint que
  remueve el bucket hay lag de replicación del servicio PowerSync (sub-segundo a segundos), durante el
  cual un write de un coworker en ese campo todavía puede llegar al device. Existe hoy idéntico, con o
  sin este cambio, y el diferimiento de D1 **no lo alarga** (el diferimiento posterga la decisión de UI,
  no la remoción del bucket). No es finding de esta feature.

### 6. Límites y validación de input — **limpio.**

- `buildActiveRoleQuery` (T1): `SELECT active FROM user_roles WHERE user_id = ? AND establishment_id = ?
  LIMIT 1`, `args: [userId, establishmentId]`. **Cero interpolación de strings**, dos placeholders.
  T6 asserta el orden de los args. Coincide con el patrón del archivo
  (`buildMembershipsQuery:212-221`, `buildOwnPhoneQuery:227-232`).
- Las funciones de `local-reads.ts` que **sí** interpolan lo hacen solo con constantes controladas por
  código, y cada una lo documenta: `notHiddenByOverride:515-522`, `apodoValueSubquery:534-542`,
  `injectProjection:666-672`. `buildActiveRoleQuery` no necesita ninguna.
- `userId` / `establishmentId` no son texto tipeado por el usuario: vienen del JWT/contexto.
- **Esta feature no agrega ni un solo campo de entrada de usuario.** El único string nuevo de UI es el
  copy estático de `campo-perdido.tsx` (T15).

---

## Findings

### HIGH-1 — D1 promete algo que `remove_member` ya rompe, y el E2E que lo "prueba" está ciego

**Dónde**: `context.md:60` (D1), `requirements.md` R20.20/R20.21, `tasks.md` T16 y T21.

**Cita de la spec** (`context.md:60`):

> **D1 — Revocación en caliente**: si al usuario le revocan el acceso al campo que tiene abierto,
> **nunca se lo patea en medio de una maniobra**.

**Cita de la spec** (`tasks.md:109`, T16):

> `revokeMemberRole(userId, establishmentId)` (service_role → `update user_roles set active = false,
> deactivated_at = now()`, **espejo exacto de `remove_member`**)

**No es un espejo exacto.** `remove_member` hace **dos** cosas
(`supabase/functions/remove_member/index.ts:87-113`):

```ts
// 1) el update que el fixture sí espeja
.from('user_roles').update({ active: false, deactivated_at: … })
// 2) el que el fixture NO espeja
await adminClient.rpc('revoke_user_sessions', { target_uid: targetUserId });
```

`revoke_user_sessions` (`0072:46`) hace `delete from auth.sessions where user_id = target_uid` → mata
el refresh token de forma persistente. Cadena de consecuencias, verificada:

1. El access token vigente sigue siendo válido hasta `jwt_expiry = 3600` (`supabase/config.toml:160`)
   — los JWT de Supabase son stateless, borrar la sesión no los invalida.
2. Al vencer, el refresh falla (no hay sesión que refrescar).
3. `supabase.auth.onAuthStateChange` emite con `session = null` →
   `AuthContext.tsx:114-116` → `setState(stateFromSession(null))` → **no autenticado**.
4. El `RootGate` rutea a auth. **Con la maniobra abierta.**

Es decir: en el camino de producción de la revocación, el operario **sí** es sacado de la manga dentro
de ≤1h, con la pantalla de login y sin ningún aviso. D1 no lo puede evitar — vive en la capa de auth,
por encima de `EstablishmentContext`.

**Y el test no lo va a cazar.** T21 (`tasks.md:128-130`) asserta que "en ≥20 s no se navegó ni a
`/campo-perdido` ni a `/crear-rodeo`" usando el fixture de T16, que **no** revoca la sesión. El E2E va a
dar verde sobre una garantía que producción no da.

**Asimetría que hay que decidir junto**: el camino de **campo borrado** (E5, trigger 0076) **no** llama
a `revoke_user_sessions`. Ahí la sesión sobrevive y el diferimiento sí es indefinido. O sea, las dos
causas que R20.27/R20.28 tratan como idénticas **no** lo son en la duración de la ventana:

| Causa | Sesión | Ventana real de diferimiento |
|---|---|---|
| `remove_member` (rol revocado) | revocada (`0072`) | ≤ `jwt_expiry` (3600 s), después bounce a login |
| soft-delete del campo (trigger `0076`) | intacta | ilimitada, hasta que el usuario salga de la maniobra |

**Dirección de seguridad**: benigna. El bounce es fail-closed y **acorta** la ventana. No es un hueco
— es una promesa de spec falsa, en la feature que nació precisamente de un comentario mentiroso
(`context.md:40-46`). Por eso lo reporto como HIGH-confidence: el hecho está verificado y contradice
una decisión aprobada en Gate 0.

**Qué hay que aclarar (decide Raf)**:
1. ¿D1 se re-enuncia como *"no se lo patea **por revocación de campo**; la caída de sesión es otra capa
   y puede sacarlo dentro de la hora"*? (mi recomendación: sí, es la verdad y es barato)
2. ¿T16 espeja `remove_member` **completo** (incluido `revoke_user_sessions`) para que T21 pruebe el
   camino real, o se documenta explícitamente en el header del spec E2E que testea el camino
   *sin* revocación de sesión y por qué?
3. ¿La asimetría de la tabla de arriba se documenta en `design.md` §6 (donde hoy se afirma que las dos
   causas son indistinguibles — lo son *en la firma local*, no *en la duración de la ventana*)?

---

### MED-1 — Falta la frase que impide que la "evidencia afirmativa" se lea como control de acceso

**Dónde**: `design.md` §4.3 (líneas 137-195), `requirements.md` R20.12/R20.14.

`design.md:152` dice: *"Eso convierte una conjetura … en un **hecho leído**"*. Es cierto para un cliente
honesto. Para un cliente hostil es un valor en un SQLite que el usuario controla. La spec nunca lo
afirma como control de acceso (§5.5 es correcta), pero tampoco lo **niega** en la sección donde alguien
lo va a leer.

**Fix propuesto** — una frase en `design.md` §4.3, después del párrafo de "El hecho que la habilita":

> Esta fila es **dato local en un device que el usuario controla**: la evidencia afirmativa decide una
> transición de **UI**, no un permiso. El enforcement es server-side y no depende de ella
> (`has_role_in`, `0005_rls_helpers.sql:9-25`, exige `ur.active = true` en la DB en cada lectura y cada
> escritura). Un cliente que falsee esta fila conserva una vista de datos que PowerSync ya le está
> borrando, y no gana ninguna capacidad de leer ni escribir nada.

---

### MED-2 — `inconclusive` / `unknown` no tienen salida terminal, tampoco en arranque en frío

**Dónde**: R20.15, R20.30, `design.md` §4.3 (tabla de veredictos) y el párrafo
*"Por qué esto elimina el timer, y no lo esconde como fallback"* (`design.md:175-184`).

`design.md:182` argumenta:

> `'inconclusive'` es, **por definición**, un estado a mitad de camino … Eso implica que **hay más sync
> en vuelo**, y el próximo checkpoint —que llega solo, sin timer— lo resuelve.

Eso es una **inferencia**, de la misma clase que el supuesto 5 que §4.2 honestamente marca como
no auditable. Para `inconclusive` el argumento es bueno (revocación y desactivación de rol salen del
mismo commit — `remove_member` en un `update`, el trigger `0076:64-70` en la misma transacción del
soft-delete). Para `unknown` (R20.30) es **débil**: el caso que produce `unknown` es un fallo de lectura
del SQLite local, y un SQLite corrupto falla **siempre**, no una vez.

Y R20.25 no rescata: quita el *diferimiento* en arranque en frío, pero la regla de evidencia se
re-aplica idéntica → `unknown` → `inconclusive` → sigue clavado.

**Impacto de seguridad: ≈nulo** (PowerSync ya borró las filas; no se retiene información — ver
Respuesta 3). **Impacto de producto: dead-end silencioso** — el usuario queda en `active` sobre un campo
vacío sin ningún aviso, indefinidamente.

**Fix propuesto**: una de las dos, a elección del leader —
(a) requisito nuevo que declare esto como **limitación conocida y aceptada**, con la justificación de
que el blast radius es una vista vacía y no una fuga; o
(b) un piso: N avances de sync consecutivos con `unknown` → tratar como `absent_or_inactive`
(fail-closed sobre la evidencia **irrecuperable**, distinto del fail-safe sobre la evidencia
*transitoriamente* ilegible). Ojo: (b) reintroduce un contador, que T3 prohíbe explícitamente
(`tasks.md:27`) — por eso la decisión es del leader, no mía.

---

## Anexo LOW (no bloquea; lo dejo por trazabilidad, es correctitud y no seguridad)

- **L1 — `available` durante el diferimiento.** `applyMemberships` actualiza `availableRef.current`
  (`EstablishmentContext.tsx:140`) **antes** del chequeo de `lost` (línea 142). Con el diferimiento
  ("no cambiar de estado", `design.md:246`), queda `state.available` **con** el campo revocado y
  `availableRef.current` **sin** él. Consecuencia: `switchEstablishment` lee de `availableRef`
  (`:231`) → resuelve → `applyMemberships` → vuelve a diferir → **el switch queda en no-op silencioso**.
  La spec no define qué contiene `available` durante la ventana. El implementer se lo va a comer en T9.
- **L2 — R20.22 sin guard de "ya no aplica".** *"Cuando el usuario salga del flujo de maniobra teniendo
  una revocación diferida pendiente, el sistema deberá aplicar la transición a `active_lost`"* — sin
  condición de que el pendiente siga siendo válido. Si entre la detección y la salida el campo activo
  cambió (o el rol se reactivó), se emite un `active_lost` espurio nombrando un campo que el usuario
  sí tiene. Se auto-cura (`design.md:186-188`), pero conviene guardar el pendiente contra el id activo
  vigente al momento de emitir.
- **L3** — `T2` pide `runLocalQuerySingle` con `emptyIsSyncing: false`; ése ya es el **default**
  (`local-query.ts:72`). Explicitarlo está bien, solo que no es un cambio de comportamiento.

---

## Tabla de inputs (campos que el usuario tipea)

| Campo | Límite (largo/charset/formato/rango) | Validación | OK? |
|---|---|---|---|
| — | — | — | — |

**La feature no agrega ni modifica ningún campo de entrada de usuario.** No hay formularios, ni
buscadores, ni texto libre, ni prompts. El único string nuevo de UI es el copy **estático** de
`campo-perdido.tsx` (T15), no atacante-controlado. La única query nueva
(`buildActiveRoleQuery`, T1) toma `userId` (del JWT) y `establishmentId` (del contexto activo), ambos
parametrizados con `?` — verificado en Respuesta 6.

## Tabla de rate limits (acciones abusables tocadas por el cambio)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Re-lectura de membresías por checkpoint (R20.1) | n.a. | — | — | `loadMemberships` → `runLocalQuery` (`establishments.ts:74`). SQLite local, **cero red**. Sin superficie server-side que abusar. |
| Re-lectura de rodeos por checkpoint (R20.2) | n.a. | — | — | `fetchRodeos` → `runLocalQuery` (`rodeos.ts:150`). Ídem. |
| Re-lectura de lotes por checkpoint (R20.3) | n.a. | — | — | `load({ silent: true })`, lectura local. Ídem. |
| Lectura de evidencia afirmativa (R20.31) | n.a. | — | — | `SELECT` local, y solo cuando el activo no está en el set (R20.32). R20.31 **prohíbe** la red explícitamente. |
| Re-render de la app por checkpoint | mitigado | — | — | No es rate limit, pero es el vector de amplificación *cliente* real (provider en la raíz). R20.11 + T10 (guard de equivalencia) lo cortan. `design.md:90`. |
| `remove_member` (Edge Function, produce la revocación) | **sin rate limit propio** | — | — | **Pre-existente, NO lo toca esta feature.** Supabase no rate-limitea EFs por defecto. Owner-only (`requireOwnerOf`, `remove_member:46`) → superficie de abuso acotada a owners sobre su propio campo. Queda anotado; no es finding de la 20. |

**Ninguna Edge Function nueva. Ningún email/SMS. Ninguna API externa. Ninguna operación bulk.**
No se toca `[auth.rate_limit]` de `supabase/config.toml`.

---

## Dominios de seguridad revisados

| Dominio | Resultado |
|---|---|
| **A1** — service-role bypassa RLS | Revisado. La feature no agrega ni modifica ninguna EF. `remove_member` (as-built) usa `createAdminClient` con `requireOwnerOf` + scoping por `establishment_id` (`:46,49-55`). Correcto. |
| **A2** — mass assignment | n.a. Sin `.insert(body)`/`.update(body)` nuevo. |
| **A3/A4** — IDOR por FK / BFLA | Revisado sobre el camino de writes durante la ventana. Todos los RPC derivan el tenant de la fila real y guardan con `has_role_in`/`is_owner_of` primero (citas en Respuesta 2). |
| **B1** — `err.message` crudo al cliente | n.a. Sin cambios de EF. |
| **B3** — over-fetching column-level | Revisado. `buildActiveRoleQuery` proyecta **una** columna (`active`). Mínimo posible. |
| **C1** — PowerSync sync rules | Revisado. `rafaq.yaml` **intacto**. `self_user_roles` (`:73-76`) es self-scoped por `auth.user_id()`; no fuga cross-tenant. La feature no amplía el sync set. |
| **C2** — Realtime | n.a. No se tocan canales. |
| **C3** — data-at-rest local | **No cubierto por esta feature** — la SQLite local sigue sin encriptar (deuda pre-existente, no la introduce ni la agrava la 20). La ventana de D1 no cambia qué hay en disco (PowerSync borra igual). |
| **C4** — stale-auth en replay | **Revisado a fondo (era el riesgo central de la pregunta 4)**. Las mutaciones encoladas offline se **re-autorizan server-side** al sincronizar: `has_role_in` lee `user_roles` de la DB, no del token. Correcto. |
| **D1** — service_role en el cliente | Verificado limpio: `SUPABASE_SERVICE_ROLE_KEY` (server-only, `e2e/helpers/env.ts:66`), NO `EXPO_PUBLIC_*`. El helper de T16 corre en Node (Playwright), nunca en el bundle. |
| **D3** — secrets hardcodeados | Sin secretos nuevos. |
| **E1** — queries sin tope | Revisado. La query nueva es `LIMIT 1`. |
| **E2/E3** — denial-of-wallet / bot | n.a. Sin superficie de costo nueva. |
| **F1** — PostgREST filter injection | n.a. La lectura nueva es SQLite local parametrizado. |
| **H1** — invalidación de sesión | **Revisado, y es el origen de HIGH-1.** `revoke_user_sessions` (`0072`) existe y funciona; el problema es que la spec de la 20 no lo contempla al prometer D1. |
| **I2** — audit tamper-evidence | n.a. Sin cambios en el trail. |

## Dominios excluidos (con justificación)

- **F2 (import/CSV), F3 (SSRF), F4 (XSS en email)** — la feature no toca ingesta de archivos, ni
  `fetch()` a URLs, ni templates de email.
- **G (BLE)** — no se toca el camino de lectura del bastón.
- **H2 (política de credenciales), H3 (token en URL)** — sin cambios de auth ni de invitaciones.
- **I1 (retención/borrado), I3 (mobile hardening)** — fuera del alcance de los 7 archivos.
- **E4 (enumeration)** — el copy nuevo de `campo-perdido.tsx` (T15) es **menos** informativo que el
  actual (deja de afirmar una causa única, R20.28). Reduce, no aumenta, la señal.

## Cobertura de la herramienta

Este Gate 1 corrió en **modo `spec`** (revisión manual contra el catálogo RAFAQ + verificación en
código de cada afirmación de la spec). La skill `sentry-skills:security-review` **no se invocó**: es
para modo `code` sobre un diff, y acá no hay implementación todavía. Los dominios que esa skill no
cubre bien —RLS de Postgres, sync rules de PowerSync, RPC `SECURITY DEFINER` de Deno/Supabase— se
revisaron a mano y están citados arriba archivo:línea.

**Recomendación para Gate 1 modo `code`** (post-implementer): foco en (a) la carrera async de T8
(`loadSeq` — usuario/campo cambiados en vuelo, `tasks.md:63`), (b) que `buildActiveRoleQuery` haya
salido efectivamente parametrizado y sin interpolación, y (c) que ningún camino emita `active_lost`
o `no_rodeos` sin la evidencia correspondiente (T23-d ya lo pide).

---
---

# RE-GATE 1 (modo `spec`) — 2026-07-19, tras el diff de reconciliación

> Segunda pasada sobre `specs/active/20-reactividad-sync/{context,requirements,design,tasks}.md`.
> El informe de arriba queda **intacto** como trazabilidad de la primera pasada. Esta sección solo
> agrega el veredicto del re-gate.

## Veredicto del re-gate

**PASS.**

Los cuatro puntos se cerraron. HIGH-1 se cerró con el estándar correcto: no se tapó el problema, se
corrigió la promesa **y** se blindó el test para que no pueda volver a mentir. Siguiente paso: puerta
humana.

Lo que sigue son verificaciones, no reservas. Al final hay **un hallazgo nuevo de segunda pasada**
(RG-1) y tres residuos cosméticos — ninguno bloquea, y digo explícitamente por qué.

---

## 1. HIGH-1 — ¿quedó realmente cerrado? **Sí.** Barrí los cuatro documentos, no solo lo editado.

Busqué residuos de la redacción vieja en todo el directorio
(`nunca se lo patea|no se saca|no es sacado|sobreviv|se respeta hasta terminarla`). Resultado:

| Documento | Dónde aparece la promesa | ¿Lleva el acotamiento? |
|---|---|---|
| `context.md:60` (D1 original) | *"**nunca se lo patea** en medio de una maniobra"* | **Sí, por capas.** D1.1 (`:62`) y D1.2 (`:64-74`) están inmediatamente debajo y lo acotan. |
| `context.md:74` | consecuencia (a): *"nada puede prometer que la maniobra sobrevive a una remoción"* | Es el acotamiento mismo. |
| `requirements.md:80-82` | preámbulo §3 | **Sí** — límite duro D1.1 + límite duro D1.2 explícito. |
| `requirements.md:86` (R20.21) | *"el usuario no es sacado de la pantalla"* | **Sí** — *"**y la sesión siga vigente**"*. |
| `requirements.md:104` (R20.36) | — | Es el requisito del acotamiento. |
| `requirements.md:112` | matiz de E5 | **Sí** — separa "firma local" de "duración de la ventana". |
| `requirements.md:129` (A4) | criterio de aceptación | **Sí** — *"y **solo mientras viva la sesión**"*. |
| `design.md:299` | *"el usuario no es sacado de la pantalla"* | **Sí** — *"**por decisión de esta feature**"*, y el bullet `:301` niega la supervivencia a la caída de sesión. |
| `design.md:303-312` | tabla de ventana real por causa | Es el acotamiento, con citas verificables. |
| `design.md:322` | §5.5 | **Sí** — la ventana ahora está acotada por **tres** cosas, la tercera es la sesión. |
| `tasks.md:148` (header T21) | — | **Sí** — *"No se puede escribir un assert que sugiera que la maniobra sobrevive indefinidamente a una remoción."* |

**No queda ninguna promesa de que la maniobra sobrevive a una remoción de miembro.** Dejar D1 con su
redacción original en `context.md:60`, acotada por D1.1/D1.2 debajo, es correcto: es el registro
histórico de la decisión de Gate 0 y el mismo patrón de capas que ya usaba D1.1. Un lector que llegue
a D1 no puede saltearse D1.2 — está tres líneas abajo, con la tabla.

Verifiqué además que **la sustancia de D1.2 es exacta** (no una paráfrasis que suene bien): las cinco
citas que usa —`remove_member/index.ts:107`, `0072:46`, `config.toml:160` `jwt_expiry = 3600`,
`AuthContext.tsx:114-115`, y la asimetría con el trigger `0076`— son las mismas que verifiqué en la
primera pasada. Nada inventado, nada suavizado.

## 2. El fixture — **cerrado, y por el mecanismo correcto.** Es lo que mejor quedó del diff.

**`assertServerSessionsRevoked` sí impide el falso verde.** T21 (`tasks.md:143-145`) la corre como
**assert 1, antes de nada**: *"Sin esto el resto del test no prueba lo que dice"*. La propiedad que
importa es la **dirección del fallo**: si un futuro refactor del helper vuelve a hacer solo el `update`
de rol, `assertServerSessionsRevoked` falla y el test se pone **rojo antes** de llegar a los asserts
del diferimiento. Ya no hay forma de que el test pase verde sobre el camino equivocado. Ése era
exactamente el agujero, y está tapado por construcción, no por disciplina.

**El flag `revokeSession: false` no reabre nada.** Tres razones, verificadas:

1. **El default es `true`** (`tasks.md:118`), o sea paridad con producción por omisión. El camino
   inseguro exige escribirlo a mano.
2. **Ningún test del diferimiento lo usa.** Barrí las seis tasks de Fase E: T17/T18/T19 no revocan;
   T20 llama `revokeMemberRole` sin opciones → default `true`; **T21 lo pasa explícito en `true`**
   (`:143`, *"o sea el camino real"*); T22 no revoca. **Cero usos de `false` en la spec.** Existe
   declarado para un futuro test que aísle el camino "campo borrado" (donde el trigger `0076`
   efectivamente **no** revoca sesión — que es la verdad, no una excusa).
3. **Tiene candado documental**: `tasks.md:122` obliga a que cualquier test que lo ponga en `false`
   declare en su header *"qué parte del camino real NO cubre y por qué"*. Es la misma regla que
   convirtió el problema original en visible.

**Chequeo de coherencia que hice por las dudas** (el fixture podría haber roto T21 desde otro lado):
revocar la sesión **no** mata el sync, así que la premisa de T21 sigue en pie. Los JWT de Supabase son
stateless: borrar `auth.sessions` no invalida el access token vigente, y PowerSync valida firma/claims,
no estado de sesión. Por eso el checkpoint que remueve el bucket **sí** llega al cliente, y la fila
`active = 0` **sí** baja por `self_user_roles` (que scopea por el `sub` del JWT, todavía válido). El
diferimiento tiene qué detectar. T21 es ejecutable.

**Riesgo de implementación que dejo anotado** (no de seguridad, y falla en rojo, no en verde): tras
`revokeMemberRole` el refresh token está muerto. Si el runner de T21 esperase cerca del vencimiento del
access token, `autoRefreshToken` de supabase-js fallaría y el test se iría a login → **flake rojo**.
Con `jwt_expiry = 3600` y asserts de ~20-60 s no pasa, pero conviene que el implementer no meta esperas
largas en ese spec y no reuse esa sesión en tests posteriores.

## 3. MED-1 y MED-2 — **alcanzan.**

**MED-1 (`design.md:154`)**: sí, alcanza — y quedó mejor de lo que pedí. El callout ⚠️ está **en §4.3,
donde está el lenguaje peligroso**, no escondido en la nota de seguridad. Cubre las tres cosas que
importan: (a) *"dato local en un device que el usuario controla"*; (b) decide *"una transición de UI
—qué pantalla mostrar—, nunca un permiso"*, con el enforcement citado (`0005:9-25` + los RPC
`SECURITY DEFINER`); (c) cierra el vector de mal-lectura de frente: *"Leer 'hecho leído', 'determinista'
o 'evidencia afirmativa' como primitivas de autorización sería un error: son adjetivos sobre la calidad
de una señal de UX."* **Ya no es interpretable como control de acceso.**

**MED-2**: se tomó la opción (a) con la justificación correcta, y las tres razones de `design.md:226-230`
son las que yo verifiqué (blast radius = vista vacía; el purge no depende de `active_lost`; el escenario
está subsumido por una falla mayor). Bien que R20.30 se declare **no debilitado** (`:234`): el fail-safe
sigue intacto, R20.37 solo hace visible que no se pudo verificar.

**R20.37 — ¿filtra PII o datos de campo? No.** Verificado campo por campo:

- Lo que loguea: `establishmentId` + **clase** de error. Un UUID opaco que ya vive en el estado local
  de la app, y un discriminante de error. Sin `member_name`, sin email, sin teléfono, sin EID, sin
  datos de animales, sin el error crudo.
- El requisito lo dice normativo (`requirements.md:72`, *"sin datos de campo ni PII"*) y el design lo
  ancla a la regla dura que ya existe (`design.md:232`, *"misma regla dura que 'NUNCA se loguea
  `opData`'"*, `connector.ts:199`). **T23-(g)** lo pone en la autorrevisión del implementer.
- **No hay sumidero remoto**: el propio design confirma que no existe canal de telemetría en el repo,
  así que es `console.warn` local. No hay camino de exfiltración. Correcto marcarlo como hook para la
  feature 17.
- Higiene: se registra en la **transición** a ilegible, no por checkpoint. No es contador y no participa
  del veredicto (`:232`) — o sea que no reintroduce por la ventana la heurística que §9.2 eliminó.

## 4. Regresión de R20.33-R20.37 y las dos guardas — **sin superficie nueva.** Los miré de cero.

| Requisito | ¿Superficie nueva? | Análisis con ojo fresco |
|---|---|---|
| **R20.33** (conservar el campo revocado en `available`) | **No.** | Es lo que más olía a riesgo, así que lo trabajé a fondo. `available` alimenta UI local (switch, "Mis campos", `buildRecents`) — ninguna decisión de permiso. El campo retenido **no tiene filas**: PowerSync ya borró el bucket. Y el mecanismo elegido no es nuevo: reusa la forma de `pendingCreatedRef`, que ya mergea un campo que el sync **no trajo**; acá mergea uno que el sync **se llevó**. Menos código nuevo = menos superficie. |
| **R20.34** (switch durante el diferimiento descarta el pendiente) | **No.** | Descartar sin aviso es correcto: el usuario ya no está parado sobre el campo revocado. |
| **R20.35** (re-verificar al emitir) | **No.** Reduce. | Agrega una lectura **local** en un camino frío (una vez por salida de maniobra con pendiente). Chequeé el caso borde que el texto no nombra: si esa re-lectura devuelve `unknown`, la condición 2 no se cumple → se descarta el pendiente **sin emitir**. Es coherente con R20.30 (nunca concluir sin evidencia) y se auto-cura: el próximo checkpoint vuelve a detectar la ausencia y re-evalúa. Sin agujero. |
| **R20.36** (acotado a la sesión) | **No.** | Declarativo. No cambia código; alinea la spec con el comportamiento as-built de auth. |
| **R20.37** (log de `unknown`) | **No.** | Ver punto 3. Único dato nuevo que sale del sistema: un UUID de establecimiento a `console`, sin sumidero remoto. |

Las dos guardas (evidencia afirmativa + re-verificación) **solo pueden hacer que el sistema concluya
menos, nunca más**. Eso significa que el vector que podrían introducir es "no avisar cuando había que
avisar" — que es un dead-end de UI sobre datos que ya no están, no una exposición. La dirección del
riesgo no cambió respecto de la primera pasada.

Un detalle de implementación que le dejo al implementer, no de seguridad: tras R20.34 el merge de
R20.33 debe apagarse **en el mismo tick** que se descarta el pendiente. Si el merge sobrevive hasta el
próximo checkpoint, el usuario que se cambió a B ve todavía el campo revocado en el switch y puede
volver a entrar — y `detectActiveLost` no dispara (está en el set), así que ni siquiera se consulta la
evidencia (R20.32) hasta el checkpoint siguiente. Se auto-cura en un checkpoint y no hay datos que ver
(PowerSync ya los borró), pero es un rebote raro y evitable atando el merge a `pendingRevocationRef`.

## 5. La limpieza — **no se llevó nada por delante.** Tres residuos cosméticos.

- **§5.4 duplicada: resuelta.** Hay **una** §5.4 (`design.md:295`, "Límites explícitos (D1.1 y D1.2)"),
  que absorbió el contenido de la vieja §5.4 (los bullets ✅/❌ de D1.1 están completos en `:299-300`,
  con E2/D3 intactos) y le sumó el bullet D1.2 + la tabla. §5.5 sobrevive y quedó actualizada (`:322`).
  Nada se perdió en el merge.
- **RG-R1 (cosmético)** — residuo de `{ source: 'sync' }`: la limpieza sacó el parámetro de los bloques
  de código (`design.md:81` y `:96`, que ahora dicen explícitamente *"sin parámetro de origen"*), pero
  **quedaron dos referencias textuales a un parámetro que ya no existe**: `design.md:100`
  (*"en una re-lectura de **origen `'sync'`** con estado ya resuelto…"*) y `design.md:384`
  (riesgo 3, *"origen `'sync'` con estado resuelto no vuelve a `loading`"*). Contradicen a `:86`
  (*"no se agrega ningún parámetro a `refreshEstablishments`"*). La condición operativa real es
  **"¿hay estado ya resuelto?"**, que es observable sin ningún parámetro y es lo que R20.10 pide.
  Fix: reemplazar "origen `'sync'`" por "con estado ya resuelto" en esos dos lugares. Sin impacto de
  comportamiento; es para que el implementer no salga a buscar un parámetro fantasma.
- **RG-R2 (cosmético)** — en la tabla de riesgos de `design.md` §8, **la fila 8 está antes de la 7**
  (`:388` y `:389`). Reordenar.
- **RG-R3 (cosmético)** — los encabezados `design.md:242` (*"## 5. D1 / D1.1 — revocación en caliente"*)
  y `requirements.md:78` (*"## 3. D1 / D1.1 …"*) no mencionan D1.2, aunque el cuerpo de ambos sí lo
  trata. Agregar "/ D1.2" al título.

Ninguno de los tres toca seguridad ni bloquea. Los junto acá para que entren de una pasada.

---

## Hallazgo nuevo de segunda pasada

### RG-1 — la ausencia de filtro `active` en `self_user_roles` pasó a ser **load-bearing**, y nada lo dice donde se lo va a romper

**No bloquea. Es prevención barata, y prefiero decirlo ahora.**

Toda la regla de evidencia afirmativa se apoya en un detalle del YAML de sync
(`sync-streams/rafaq.yaml:73-76`):

```yaml
self_user_roles:
  queries:
    - SELECT * FROM user_roles WHERE user_id = auth.user_id()
```

Sin `active`, sin `org_scope`. La spec lo explica bien (`design.md:150`) — pero **la explicación vive
en la spec de la feature 20, no donde alguien va a tocar el YAML**. Un futuro cambio que "optimice"
esa stream agregando `AND active = true` —una edición que se ve inocente y hasta prolija— rompe la
premisa de E1 **en silencio**: la fila desaparecería del local y el veredicto pasaría a decidirse por
ausencia, que es exactamente la inferencia que esta feature eliminó.

Matiz que hace que esto **no** sea un finding de seguridad: si eso pasara, la evidencia sería
`absent_or_inactive` → `'confirmed'` → el sistema concluiría revocación. **Falla cerrado**, y encima
acierta el veredicto por accidente. El daño sería el retorno de los falsos `active_lost` por sync
parcial (el bug de producto que E1 existe para evitar), no una exposición.

**Fix propuesto** (sin deploy de PowerSync, que es lo que lo hace barato): en vez de tocar el YAML
—que obligaría a correr `scripts/powersync-deploy.sh` por un comentario—, sumarlo a **T24** como
punto (d): dejar anotado en `specs/active/15-powersync/design.md` que la ausencia de filtro `active`
en `self_user_roles` es un **invariante del que depende la feature 20**, con puntero a `design.md`
§4.3 de esta spec. Es el archivo que alguien lee antes de tocar streams.

---

## Cambio de veredicto — resumen

| Finding (pasada 1) | Estado tras el re-gate |
|---|---|
| **HIGH-1** — D1 promete algo que `remove_member` rompe; E2E ciego | ✅ **Cerrado.** D1.2 + R20.21/R20.36 + `design.md` §5.4 corrigen la promesa; T16 espeja `remove_member` completo y T21 lo verifica server-side como primer assert. |
| **MED-1** — evidencia afirmativa legible como control de acceso | ✅ **Cerrado.** `design.md:154`, en la sección correcta. |
| **MED-2** — `inconclusive`/`unknown` sin salida terminal | ✅ **Cerrado** como limitación conocida (opción (a)) + R20.37 de visibilidad. Sin contador. |
| **L1 / L2 / L3** | ✅ **Cerrados** por R20.33/R20.34, R20.35 + `shouldEmitDeferredRevocation`, y la nota de `design.md:220`. |
| **RG-1** (nuevo) | 🟡 Abierto, **no bloqueante**. Falla cerrado. Fix propuesto: T24 punto (d). |
| **RG-R1/R2/R3** (cosméticos) | 🟡 Abiertos, no bloqueantes. |

**Veredicto: PASS.** La frontera de autorización sigue intacta y ahora la spec dice la verdad sobre lo
que puede garantizar. Adelante con la puerta humana.
