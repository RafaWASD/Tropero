# Gate 1 (modo `spec`) — feature 21: watched queries (`db.onChange` / `useQuery`)

> Auditoría de seguridad sobre `specs/active/21-watched-queries/{context,requirements,design,tasks}.md`.
> Fecha: 2026-07-21. Analista: `security_analyzer` (ADR-019).
> Alcance del gate: el **DELTA** respecto de la feature 20 (que ya pasó Gate 1 PASS —
> `progress/security_spec_20-reactividad-sync.md` — y Gate 2). La 21 cambia el **DISPARADOR**
> (de `lastSyncedMs` a `db.onChange`/`useQuery`) y **preserva la lógica de resolución de la 20 sin
> cambios**. No re-audito la resolución que la 20 ya validó; audito si el cambio de disparador
> introduce algún riesgo NUEVO.

## Veredicto

**PASS.**

El cambio es de disparador de lectura, no de frontera de autorización. Verifiqué las cinco áreas
del encargo contra el código as-built (no contra la declaración de la spec) y ninguna abre un hueco
nuevo. La dirección del riesgo del disparo más frecuente es **fail-closed y estrictamente mejor**
(revocación detectada antes, ~1,5 s vs ~90 s+), no peor. No hay findings HIGH. Al final dejo dos
observaciones NO bloqueantes (una de determinismo de E2E que es de Gate 2.5, no de seguridad) por
trazabilidad.

---

## Los 5 focos del encargo (con evidencia verificada en código)

### 1. Dirección fail-safe con disparo más frecuente (E1, design §4) — **SE SOSTIENE**

El argumento "es estrictamente mejor, no peor" es correcto y lo verifiqué en la lógica pura que la
21 NO toca:

- **La única puerta a `confirmed` sigue siendo la evidencia afirmativa.**
  `assessDisappearance` (`app/src/utils/establishment.ts:247-260`, sin cambios en la 21) retorna
  `confirmed` **solo** con `roleEvidence === 'absent_or_inactive'`; `active` y `unknown` caen en
  `inconclusive`. La frecuencia del disparador **no puede cambiar el valor de la evidencia** — solo
  cambia CUÁNDO se re-lee. Más disparos = converge antes al veredicto correcto, nunca a uno falso.
- **Ningún camino concluye revocación sobre un estado transitorio.** Si `establishments` desapareció
  de un checkpoint pero el rol propio sigue `active = 1`, la evidencia es `active` → `inconclusive`
  → no cambia de estado (R21.16/R21.17, verificado en la tabla de `assessDisappearance`). El disparo
  observa snapshots consistentes: `sync-streams/rafaq.yaml` **no declara ninguna `priority`**
  (verifiqué el archivo completo, 1-323) → cada checkpoint es una vista completa y consistente, así
  que ningún `onChange` observa buckets a medio aplicar (R21.18 confirmado).
- **¿Un revocado se ve como activo por el disparo más frecuente?** No. Al bajar `user_roles.active → 0`,
  `buildMembershipsQuery` (`local-reads.ts:212-221`) filtra `ur.active = 1` → el campo sale de
  `available` → `stillPresent = false` → evidencia `absent_or_inactive` → `confirmed`. Correcto y
  además **más rápido** que con `lastSyncedMs` (ése es el punto de D2).
- **¿Un falso `active_lost` explotable al revés?** No. Requeriría que `assessDisappearance` devuelva
  `confirmed` sobre un estado transitorio, lo cual la evidencia afirmativa bloquea. Y si aun así se
  colara, el blast radius es idéntico a la 20 (design §4.3): auto-cura en el próximo `onChange`, un
  solo campo → auto-activo; el daño máximo es un aviso espurio, no una fuga ni una sesión perdida.

**Verificación cruzada del sentido del disparo**: la detección de revocación necesita que `user_roles`
cambie, que es exactamente lo que `onChange` observa (R21.7/R21.9). No hay escenario donde
`lastSyncedMs` hubiera disparado y `onChange` no, para un cambio relevante de revocación (si
`user_roles` no cambió, no hay nada nuevo que detectar). Sin regresión de latencia hacia el lado
inseguro.

### 2. D2 — observar `user_roles` como watched query de revocación — **CANDADO RG-1 PRESERVADO, SIN FUGA**

- **RG-1 intacto y anclado donde se rompe.** `sync-streams/rafaq.yaml:73-88`: `self_user_roles` sigue
  siendo `SELECT * FROM user_roles WHERE user_id = auth.user_id()`, **sin `active`, sin `org_scope`**,
  con el comentario-candado explícito (`:74-85`) que la 20 dejó (RG-1). La 21 **no toca el YAML**
  (design §1.1, §8; ninguna task lo lista). El invariante del que cuelga D2 se conserva. El mismo
  candado está duplicado en `local-reads.ts::buildActiveRoleQuery` (`:227-243`).
- **Observar el SQLite local NO expone nada cross-tenant.** `db.onChange({ tables: ['user_roles', …] })`
  es una **notificación** de que la tabla cambió — no lee filas. Las lecturas reales que corren en el
  callback están scopeadas por `user_id = ?` propio: `buildMembershipsQuery` (`:212`,
  `WHERE ur.user_id = ? AND ur.active = 1`) y `buildActiveRoleQuery` (`:249`,
  `WHERE user_id = ? AND establishment_id = ?`). El set local de `user_roles` ya está scopeado por las
  streams (`self_user_roles` self-only + `est_members_roles` owner-only). Observar la tabla es un
  disparador de UX sobre datos ya autorizados, no un control de acceso ni una ampliación del sync set.

### 3. La frontera de autorización real — **SERVER-SIDE, INTACTA**

- La spec declara explícitamente que el enforcement sigue server-side (`has_role_in`,
  `0005_rls_helpers.sql`) y que la detección cliente es UX no authz (design §8, R21.24/R21.25).
- **Cero RLS / migración / sync stream / Edge Function tocados.** Verificado contra `tasks.md`: las
  tareas T1-T19 tocan exclusivamente `EstablishmentContext.tsx`, `RodeoContext.tsx`, `lotes.tsx`,
  `app/e2e/reactividad-sync.spec.ts` (+ docs de reconciliación). No hay migraciones, ni YAML, ni
  funciones de Deno, ni policies. R21.15 lo exige y el desglose de tasks lo confirma
  (`git diff --stat` acotado es el criterio de T17).
- El honesto acotamiento de la 20 se preserva sin regresión: R21.13 conserva el diferimiento D1,
  R21.14 conserva el copy de E5, R21.24 prohíbe prometer revocación de UI instantánea, y T14 conserva
  `assertServerSessionsRevoked` como PRIMER assert de la E2E de revocación (el candado anti-falso-verde
  que cerró HIGH-1 de la 20). No reaparece ninguna sobre-promesa.

### 4. Inputs / rate limits — **SIN INPUT NUEVO, QUERIES PARAMETRIZADAS**

- **Cero campos de entrada de usuario nuevos.** Es un cambio de disparador de LECTURA. No hay
  formularios, buscadores, texto libre ni prompts nuevos. Los estados de UI que se agregan en
  `lotes.tsx` ("Sincronizando…" / "sin lotes") son copy estático (`SYNCING_MESSAGE`), no
  atacante-controlado.
- **SQL de las watched queries parametrizado.** `buildManagementGroupsQuery`
  (`local-reads.ts:1530-1541`): `... WHERE mg.establishment_id = ? AND mg.active = 1 AND
  mg.deleted_at IS NULL AND <NOT EXISTS pending_status_overrides> ORDER BY name ASC`,
  `args: [establishmentId]`. El `notHiddenByOverride` (`:548-555`) interpola SOLO constantes
  controladas por código (`'management_groups'`, `'mg.id'`, `'soft_deleted'`) — sin input de usuario,
  sin injection. `buildActiveRoleQuery` (`:249-254`): dos placeholders `?`, cero interpolación.
  `useQuery(sql, args, …)` de `@powersync/react` pasa `args` separado → parametrizado.
- **Rate limits: n.a.** Todas las lecturas son SQLite local, cero red nueva. Sin Edge Function, sin
  email/SMS, sin API externa, sin bulk. No se toca `[auth.rate_limit]` de `config.toml`.

### 5. `lotes.tsx` con `useQuery` — empty-state y optimismo — **SIN LEAK CROSS-TENANT**

- **La query está scopeada por `establishment_id = ?` en todo momento.** Un cambio de campo re-corre
  `useQuery` con el nuevo `establishmentId`; el `WHERE mg.establishment_id = ?` garantiza que nunca
  devuelve filas de otro tenant, ni siquiera durante la transición. `buildManagementGroupsQuery('')`
  (establishmentId nulo, defensivo) matchea nada → `data = []`, no filas ajenas.
- **El empty-state es UX, no fuga.** La desambiguación "Sincronizando…" vs "sin lotes" (R21.32/R21.33,
  vía `hasSynced`) no expone datos; corrige el "falso vacío" que sería un bug de producto, no un leak.
- **El optimismo automático no cruza tenants.** Crear/renombrar/borrar son writes locales a
  `management_groups`; el INSERT lleva `establishment_id` (`buildCreateManagementGroupInsert:2996-3005`)
  → la fila optimista pertenece al campo activo. El overlay `pending_status_overrides` es local-only
  (ops propias) y se correla por `target_id = mg.id` ya scopeado. Un borrado rechazado no escribió
  overlay → la fila sigue; no hay revert que exponga nada.
- **Transición al hacer switch**: mostrar brevemente los lotes del campo A (previamente accesible) por
  un frame antes de que resuelva el de B es el MISMO comportamiento que la 20 (`load(establishmentId)`),
  y es data del PROPIO usuario sobre un campo al que tiene acceso — no exposición cross-tenant. El
  disparador nuevo no lo agrava.

---

## Tabla de inputs (campos que el usuario tipea)

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| — | — | — | — |

**La feature no agrega ni modifica ningún campo de entrada de usuario.** Es un cambio de disparador de
lectura. El único string de UI nuevo es copy estático (`SYNCING_MESSAGE` reusado). Las dos queries del
delta (`buildManagementGroupsQuery`, `buildActiveRoleQuery`) toman `establishmentId`/`userId` del
contexto/JWT, parametrizados con `?` — verificado en `local-reads.ts`.

## Tabla de rate limits (acciones abusables tocadas por el delta)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| `db.onChange` re-lee membresías (R21.1) | n.a. | — | — | Callback corre `refreshEstablishments` → `getAll` SQLite local. Cero red. Sin superficie server-side. |
| `db.onChange` re-lee rodeos (R21.2) | n.a. | — | — | Callback corre `load` → lectura local. Ídem. |
| `useQuery` sobre `management_groups` (R21.3) | n.a. | — | — | Watched query sobre SQLite local, `LIMIT` implícito por el set del campo. Cero red. |
| Writes optimistas de lote (crear/renombrar/borrar) | n.a. (delta) | — | — | Pre-existentes de la 20; la 21 solo quita los parches manuales de la lista. El enforcement owner-only lo hace la RLS al SUBIR (`is_owner_of`). No lo toca la 21. |

**Ninguna Edge Function nueva. Ningún email/SMS/API externa. Ninguna operación bulk. `config.toml`
`[auth.rate_limit]` intacto.**

---

## Dominios de seguridad revisados

| Dominio | Resultado |
|---|---|
| **A1** — service-role bypassa RLS | n.a. Sin Edge Function ni `createAdminClient()` nuevo. |
| **A2** — mass assignment | n.a. Sin `.insert(body)`/`.update(body)` nuevo. Los writes optimistas de lote (pre-existentes) arman columnas explícitas. |
| **A3/A4** — IDOR / BFLA | Revisado. El delta no agrega camino de write; los reads nuevos scopean por `user_id`/`establishment_id` del contexto. |
| **B1** — `err.message` crudo al cliente | n.a. Sin cambios de EF. `lotes.tsx` conserva su manejo de error propio (design §3.3). |
| **B3** — over-fetching column-level | Revisado. `buildManagementGroupsQuery` proyecta `id, name`; `buildActiveRoleQuery` una columna. Mínimo. |
| **C1** — PowerSync sync rules | Revisado. `rafaq.yaml` **intacto**; candado RG-1 de `self_user_roles` preservado con comentario en el punto de cambio. Sin ampliación del sync set. |
| **C2** — Realtime | n.a. Las watched queries leen SQLite local, no canales Realtime. |
| **C3** — data-at-rest local | No cubierto (deuda pre-existente); la 21 no cambia qué hay en disco. |
| **C4** — stale-auth en replay | Preservado de la 20: los writes se re-autorizan server-side (`has_role_in`). El delta no toca el camino de escritura. |
| **D1/D3** — service_role en cliente / secrets | n.a. Sin secretos nuevos; `usePowerSync()` devuelve el singleton ya inicializado. |
| **E1** — queries sin tope | Revisado. `useQuery` sobre el set del campo activo (acotado por `establishment_id`), local. |
| **F1** — PostgREST/SQL injection | Revisado. Ambas queries del delta parametrizadas; `notHiddenByOverride` interpola solo constantes de código. |
| **H1** — invalidación de sesión | Revisado. El acotamiento honesto de la 20 (session revocation server-side + `assertServerSessionsRevoked` como primer assert de la E2E) se preserva (R21.13/R21.14/R21.24, T14). Sin regresión. |

## Dominios excluidos (con justificación)

- **F2 (import/CSV), F3 (SSRF), F4 (XSS email)** — la feature no toca ingesta de archivos, `fetch()` a
  URLs, ni templates de email.
- **G (BLE)** — explícitamente fuera (context §fencing, design §1.1); no se toca `ble/**` ni `baston.tsx`.
- **I1/I2/I3** — sin cambios en retención/borrado, audit trail ni hardening mobile.

---

## Observaciones NO bloqueantes (trazabilidad — no son findings de seguridad)

- **OBS-1 (determinismo de E2E de revocación — es Gate 2.5, no Gate 1).** D3 saca `retries` + forzador
  de blip de la E2E de la 20, incluidos los casos de revocación T20/T21. Pero E4 (design §6, R21.25)
  reconoce que la **ENTREGA** de la remoción de bucket la gobierna el servicio y **se disrupta con
  reconnects** — o sea sigue siendo async y potencialmente no determinista bajo red mala. Sacar los
  `retries` de T20/T21 podría reintroducir flakiness en esos dos casos. **Dirección del riesgo: falla
  cerrado** — un flake por entrega lenta da test ROJO, no verde falso; y `assertServerSessionsRevoked`
  como primer assert (T14) garantiza que el test no puede pasar sin la revocación server-side real. La
  propiedad de seguridad está intacta; el riesgo es de robustez de suite y lo maneja el implementer al
  medir los timeouts (design §7 punto 3 ya lo prevé). Lo dejo anotado para que Gate 2.5 no lo lea como
  regresión si un T20/T21 flakea por propagación.
- **OBS-2 (lifecycle del listener — correctitud, no seguridad).** R21.5/T19 exigen `dispose()` en el
  cleanup de los dos efectos `db.onChange`. Un leak de listeners al re-suscribir por cambio de
  usuario/campo sería un bug de recursos, no una fuga (los listeners son sobre el SQLite local propio).
  El reviewer lo verifica en Gate 2 (inspección de wiring); la autorrevisión del implementer (T19-a) lo
  cubre. Sin impacto de seguridad.

---

## Cobertura de la herramienta

Gate 1 en **modo `spec`**: revisión manual contra el catálogo RAFAQ + verificación en código de cada
afirmación de la spec. La skill `sentry-skills:security-review` **no se invocó** — es para modo `code`
sobre un diff, y acá no hay implementación todavía. Los dominios que esa skill no cubre bien —sync
rules de PowerSync, RLS de Postgres, la primitiva `db.onChange`/`useQuery` del SDK— se revisaron a mano
y están citados archivo:línea arriba.

**Recomendación para Gate 1 modo `code`** (post-implementer): foco en (a) que `dispose()` efectivamente
se llame en el cleanup de ambos efectos (sin leak al re-suscribir), (b) que la carga inicial siga
viviendo en el bootstrap SEPARADO (R21.35 — `triggerImmediate` es false, el `onChange` no dispara al
montar; un bootstrap roto = pantalla en blanco, fail-closed pero bug de producto), (c) que `lotes.tsx`
no re-ponga `isLoading` en las re-emisiones (no blanquear la lista) y que la desambiguación
vacío/sincronizando quede como en design §3.3, y (d) confirmar que el diff quedó acotado a los 3
consumidores + la E2E de la 20 (R21.30, sin tocar RLS/stream/migración/EF).
