# Rebrand fase 5 — headers HTTP (`X-Rafaq-*` → `X-Mitropero-*`)

**baseline_commit: 80c7022296c425b9616e4a0880d7b693870ccdeb** (HEAD al arrancar la fase; punto desde el
cual el Gate 2 calcula el diff. Trabajamos sobre `main`, sin feature-branch).

**Fecha**: 2026-08-17 · **Autorización de Raf en sesión**: migración a DEV + redeploy de Edge Functions.
**PROD no se toca.**

---

## 1. Baseline de atribución (medido ANTES de tocar nada)

Literal, corrido en este orden:

```
$ node --test supabase/tests/audit/run.cjs
✔ audit forense suite — spec 18 (40640.6422ms)
ℹ tests 15  ℹ pass 15  ℹ fail 0  ℹ skipped 0

$ node --test supabase/tests/edge/run.cjs
ℹ tests 47  ℹ pass 42  ℹ fail 0  ℹ skipped 5   (los 5 skipped son U9, gated por U9_DEPLOYED=1)
```

Baseline del árbol (heredado del plan, no re-medido acá porque `check.mjs` muere en el stage rojo):
`3115 pass / 1 fail`, y ese fallo único son las 3 líneas de `'X-Rafaq-Request-Id'` en `app/src` que caza
la **regla A** del guard de marca. Es lo que esta fase tiene que cerrar.

## 2. Inventario completo (grep sobre el árbol tracked, `progress/` excluido)

### Runtime (lo que hay que cambiar)

| # | Punta | Archivo:línea | Header | Rol |
|---|---|---|---|---|
| 1 | Lector EF | `supabase/functions/_shared/serve.ts:30` | `X-Rafaq-Request-Id` | **lee** |
| 2 | CORS | `supabase/functions/_shared/cors.ts:9` | `x-rafaq-request-id` | **publica** |
| 3 | Admin client EF | `supabase/functions/_shared/supabase.ts:34,35` | `X-Rafaq-Actor`, `X-Rafaq-Request-Id` | **escribe** |
| 4 | Lector DB | `supabase/migrations/0124_audit_log.sql:107` (`audit.resolve_actor`) | `x-rafaq-actor` | **lee** |
| 5 | Lector DB | `supabase/migrations/0131_audit_request_id.sql:40` (`audit.resolve_request_id`) | `x-rafaq-request-id` | **lee** |
| 6 | Cliente | `app/src/services/account.ts:127` | `X-Rafaq-Request-Id` | **escribe** |
| 7 | Cliente | `app/src/services/members.ts:152` | `X-Rafaq-Request-Id` | **escribe** |
| 8 | Cliente | `app/src/services/push-notifications.ts:88` | `X-Rafaq-Request-Id` | **escribe** |
| 9 | Tests | `supabase/tests/audit/run.cjs:322,326,340,344` (TA.12/TA.13) | `X-Rafaq-Actor` | ejerce |

### Comentarios / prosa que quedaría mintiendo

`app/app/invitar.tsx:109` · `supabase/functions/{accept_invitation,change_member_role,delete_account,remove_member}/index.ts`
(comentarios) · `supabase/functions/_shared/supabase.ts:11,17` · `scripts/run-tests.mjs:266` ·
`docs/observabilidad-los-tres-trabajos.md:32` · `docs/marketing/plan-toma-de-marca-mitropero.md:425,431` ·
`specs/active/18-audit-log/{requirements,design,tasks}.md` · `specs/active/23-request-id-correlation/{context,requirements,design,tasks}.md` ·
`specs/active/24-audit-viewer/{requirements,design}.md` · `docs/rebrand-mitropero-plan.md`.

### Lo que NO se toca (verificado que no es este header)

`rafaq-app` / `rafaqsorg` / `scheme: 'rafq'` (fase 6, pospuesta) · `RAFAQ_ENV` y env vars · `rafaq.db` ·
`@rafaq-test.local` de las suites backend · `progress/` (historial) · las migraciones históricas
`0124`/`0131` (append-only: el lector nuevo va en una migración NUEVA, no editando las viejas).

## 3. El cuerpo VIGENTE en el remoto (la trampa de la fase 4)

Traído con `pg_get_functiondef` de DEV vía Management API **antes** de escribir la migración:

- `audit.resolve_actor()` vigente == cuerpo de `0124` (byte a byte, incluido el comentario).
- `audit.resolve_request_id()` vigente == cuerpo de `0131`.
- `audit.insert_update_delete_trigger()` vigente == cuerpo de `0131` (el de `0124` está pisado).

**Esta vez no hubo drift** — pero se verificó, no se supuso. Consecuencia práctica: el trigger **no se
re-crea** en esta fase (no cambia; llama a los resolvers por nombre y `CREATE OR REPLACE` conserva el oid).
Sólo se re-crean las **dos** funciones resolver.

## 4. Diseño: rename en DOS TIEMPOS

### Paso 1 — servidor TOLERANTE (lee los dos)

Motivo (del plan): hay builds instaladas afuera (TestFlight + APK de testers) y **no hay OTA**
(`app/app.config.ts` no tiene bloque `updates`). Corte seco ⇒ cliente viejo → servidor nuevo ⇒ `request_id`
**NULL** en el audit: no rompe nada visible, **la correlación se pierde en silencio**. Para auditoría es el
peor modo de falla.

- **`supabase/functions/_shared/request-headers.ts` (NUEVO, puro)** — única definición de los nombres, de
  cuáles LEE el servidor y de la resolución `nuevo ?? viejo`. Sin deps Deno-only → testeable con `node:test`.
- `serve.ts` usa `readRequestIdHeader(req)` en vez del literal.
- `cors.ts` **deriva** el `Access-Control-Allow-Headers` de `SERVER_READ_HEADERS`. Así es **imposible**
  publicar un set distinto del que el servidor lee (que es exactamente el modo de falla del CORS de spec 23).
- Migración **`0133_rename_audit_headers_mitropero.sql`**: `CREATE OR REPLACE` de `audit.resolve_actor()` y
  `audit.resolve_request_id()` leyendo `x-mitropero-*` con fallback a `x-rafaq-*`.
  - **TOTAL** preservado: el handler `exception when others` exterior queda intacto (si tirara, abortaría el
    write del operario y rompería el invariante offline).
  - **Spoof-safe** preservado: el header se lee **sólo** dentro del `if v_role = 'service_role'`. El fallback
    vive DENTRO de ese gate → no abre un canal nuevo de spoof.
  - **Precedencia**: gana el nombre NUEVO; se cae al viejo si el nuevo **falta o no es un uuid válido**
    (`is null or !~ uuid_re`). "Nuevo presente pero basura" no puede tapar un viejo válido.

### Paso 2 — clientes escriben SÓLO el nombre nuevo

- `supabase/functions/_shared/supabase.ts` usa las constantes de `request-headers.ts`.
- Los 3 call-sites del cliente (`account.ts`, `members.ts`, `push-notifications.ts`) usan **una constante
  compartida** en `app/src/utils/request-id.ts` (`REQUEST_ID_HEADER`), no el literal repetido.
- Comentario de `app/app/invitar.tsx:109` actualizado.

### Paso 3 — limpieza: NO se hace acá

Sacar el fallback SQL, los nombres legacy de `request-headers.ts` y el header viejo de CORS es una fase
aparte, cuando no queden clientes viejos. **Anotada en `docs/backlog.md`** con la condición que la habilita.

## 5. El guard de marca: decisión y por qué

La **regla B** ("el nombre nuevo se escribe SIEMPRE `miTropero`") caza `X-Mitropero-Request-Id` en `app/src`:
el `Mitropero` viene precedido de `-`, que no es el carve-out de DOMINIO (`.` + letra) ni el de FLAG (`__`).

**Decisión: válvula por línea (`brand-name-disable-line -- <razón>`), NO carve-out de forma.** Por qué:

1. **Población de uno.** La constante compartida colapsa los 3 sitios a **1**. El carve-out de FLAG de la
   fase 2 se justificó por VOLUMEN (10 líneas de plomería); acá hay una sola línea. Un carve-out es
   maquinaria permanente para una población de uno.
2. **Un carve-out de forma ensancha el punto ciego más allá del caso.** Cualquier regla razonable
   (`-Mitropero-`, o "precedido de `X-`") también eximiría un `<Text>X-Mitropero-Algo</Text>` o un copy que
   contenga un guion antes del nombre. Los dos carve-outs vigentes cubren categorías con población real y
   forma inconfundible (un dominio DNS, un `__flag`); "nombre de header de wire" no tiene una forma que el
   escáner pueda distinguir de texto.
3. **La válvula exige razón escrita y muere con la línea.** Queda documentada exactamente donde vive la
   excepción, y si la constante se borra, la exención desaparece sola (no queda huérfana como sí puede
   quedar un carve-out).
4. **Si mañana aparece un segundo header, vuelve a chocar** — y eso es una feature: una línea con razón
   escrita por header, y el guard sigue enumerando el árbol en vez de tener un agujero con forma.

Contra-argumento considerado y descartado: "el carve-out se escribe sobre la ausencia y cubre lo que venga".
Cubriría, sí, **en silencio** — que es justo lo que la válvula evita.

## 6. Verificación planificada

1. Baseline de atribución (arriba). ✔
2. **Falsificación del doble-lectura, en 3 capas**:
   - **En la migración**: bloque `DO` que setea `request.jwt.claims` + `request.headers` transaction-local y
     ejerce las 8 combinaciones (nuevo solo / viejo solo / los dos / nuevo basura + viejo bueno / sin header /
     no-service_role / claims basura). Aborta la migración si alguna falla.
   - **En la suite `audit`**: TA.12/TA.13 pasan al nombre NUEVO; TA.17–TA.21 nuevos: header VIEJO contra
     servidor NUEVO → actor y `request_id` **igual se registran**; spoof con el nombre nuevo Y con el viejo.
   - **En node:test puro**: `request-headers.test.ts` — el lector cae al legacy, el nuevo gana, y el
     Allow-Headers de CORS **contiene todos** los nombres que el servidor lee.
   - **Contraprueba temporal**: correr la suite `audit` con los tests nuevos **ANTES** de deployar la
     migración → los del nombre nuevo tienen que FALLAR (si pasan, no ejercen el path real).
3. `pnpm -C app typecheck` → 0. `node scripts/check.mjs` → 0 fallos (destapa 17 suites backend).
4. `pnpm -C app run e2e` → 307 passed / 1 skipped.

---

## Ejecución

### Lo que se cambió

**Backend — nuevo módulo, única definición de los nombres**
- `supabase/functions/_shared/request-headers.ts` **(NUEVO, puro)** — `ACTOR_HEADER` /
  `REQUEST_ID_HEADER` / `LEGACY_*` / `ACCEPTED_REQUEST_ID_HEADERS` / `readRequestIdHeader(req)`.
- `_shared/serve.ts` — `const requestId = readRequestIdHeader(req) ?? crypto.randomUUID();`
  (se sacó el `UUID_RE` local: la validación de forma se mudó al módulo, ver "Autorrevisión" §A2).
- `_shared/cors.ts` — `Access-Control-Allow-Headers` **derivado** de `ACCEPTED_REQUEST_ID_HEADERS`.
- `_shared/supabase.ts` — `headers[ACTOR_HEADER]` / `headers[REQUEST_ID_HEADER]` (escribe SOLO el nuevo).
- Comentarios de las 4 EFs que nombran el header de actor.

**DB — migración `0133_rename_audit_headers_mitropero.sql` (NUEVA)**
- `CREATE OR REPLACE` de `audit.resolve_actor()` y `audit.resolve_request_id()` con lectura doble.
  El trigger `insert_update_delete_trigger()` **NO se re-crea** (llama a los resolvers por nombre).
- `revoke execute` re-afirmado + smoke-check del muro + **bloque `DO` de falsificación** (§ abajo).
- `0124` y `0131` **no se editaron** (append-only).

**Cliente**
- `app/src/utils/request-id.ts` — `export const REQUEST_ID_HEADER` (única definición) + la válvula.
- `account.ts` · `members.ts` · `push-notifications.ts` — `headers: { [REQUEST_ID_HEADER]: … }`.
- Comentario de `app/app/invitar.tsx:109`.

**Tests**
- `supabase/functions/_shared/request-headers.test.ts` **(NUEVO, 14 casos puros)** — registrado en la lista
  explícita de `scripts/run-tests.mjs`.
- `app/src/utils/request-id.test.ts` — +3 tests (la constante del cliente **es** la del backend, importando
  el módulo real; ningún archivo de `app/src` hardcodea el literal; los 3 call-sites usan la constante).
- `supabase/tests/audit/run.cjs` — TA.12/TA.13 al nombre nuevo; **TA.17–TA.22 nuevos**; `auditRows` ahora
  proyecta `request_id` (antes no había NINGÚN test backend del header de correlación — gap de spec 23).

**Docs y specs reconciliadas** (mismo commit): `docs/backlog.md` (entrada de limpieza con su condición) ·
`docs/rebrand-mitropero-plan.md` (estado + §4.D corregido: "deploy-ordering" NO alcanzaba, no hay OTA) ·
`docs/observabilidad-los-tres-trabajos.md` · `docs/marketing/plan-toma-de-marca-mitropero.md` (decía que el
header "no se toca en ninguna fase") · `specs/active/18-audit-log/{requirements,design,tasks}.md` ·
`specs/active/23-request-id-correlation/{context,requirements,design,tasks}.md` ·
`specs/active/24-audit-viewer/{requirements,design}.md` (decía "deuda de rebrand, NO se toca acá").

### Deploy a DEV (autorizado por Raf en sesión; PROD NO se tocó)

1. `node scripts/apply-migration-mgmt.mjs supabase/migrations/0133_…sql` → `OK (HTTP 201)`.
2. `npx supabase@2 functions deploy --project-ref xrhlxxdnfzvdnztacofj` → las **10** EFs
   (`accept_invitation, audit_query, cancel_invitation, change_member_role, delete_account, health,
   invite_user, register_push_token, remove_member, resend_invitation`).
3. Se re-aplicó/re-deployó una segunda vez al final, después del fix de la autorrevisión (§A2) y del ajuste
   de comentarios, para que **lo deployado sea byte a byte lo del repo**.

Verificación directa contra el remoto:
```
actor_lee_los_dos = 1 · rid_lee_los_dos = 1
has_function_privilege('authenticated', resolve_actor|resolve_request_id, EXECUTE) = false
provolatile = s (STABLE) · proconfig = {search_path=""}
health sin JWT -> HTTP 200   (verify_jwt=false de config.toml sobrevivió al deploy de todas)
OPTIONS invite_user -> 204
access-control-allow-headers: authorization, x-client-info, apikey, content-type,
                              x-mitropero-request-id, x-rafaq-request-id
```

### Cómo se falsificó el doble-lectura (4 capas)

**1. Contraprueba temporal — la suite `audit` ANTES de aplicar la migración.** Con los tests nuevos ya
escritos y el servidor todavía viejo:

```
✖ TA.12 service_role + header X-Mitropero-Actor → auth_uid = actor    actual: null
✔ TA.13 authenticated con X-Mitropero-Actor forjado → uid real (spoof-safe)
✔ TA.17 service_role + header VIEJO X-Rafaq-Actor → auth_uid = actor
✖ TA.18 service_role + X-Mitropero-Request-Id → request_id aterriza   actual: null
✔ TA.19 service_role + header VIEJO X-Rafaq-Request-Id → se registra igual
✔ TA.20 control negativo · ✔ TA.21 spoof con las dos grafías
ℹ tests 20  ℹ pass 17  ℹ fail 3   (los 2 tests + el nodo padre)
```
Exactamente los dos del nombre NUEVO en rojo y los del VIEJO en verde ⇒ los tests ejercen el path real, no
pasan por otra razón. Post-deploy: **21/21**.

**2. Dentro de la migración** — bloque `DO` que setea `request.jwt.claims`/`request.headers`
transaction-local (el mismo canal de PostgREST) y **aborta** si algo no da: (a) sólo el nuevo → resuelve ·
(b) sólo el viejo → resuelve igual · (c) los dos → gana el nuevo · (d) nuevo basura + viejo bueno → gana el
viejo · (e) sin headers → NULL · (f) **spoof**: `authenticated` con las cuatro grafías forjadas → actor =
su `sub`, request_id NULL · (g) claims/headers no-JSON → NULL sin lanzar (**TOTAL**).

**3. En `node:test` puro** — `request-headers.test.ts`, con 3 mutantes que lo falsifican:

| mutante | resultado |
|---|---|
| `serve.ts` vuelve al literal hardcodeado | ✖ *"ningún archivo … escribe el nombre a mano"* |
| `cors.ts` vuelve al string a mano sin el nombre nuevo | ✖ *"CORS permite TODOS los nombres que la EF acepta"* + ✖ el del literal |
| se saca el legacy de `ACCEPTED_REQUEST_ID_HEADERS` (limpieza prematura) | ✖ *"el nombre VIEJO sigue resolviendo"* + ✖ case-insensitive |

**4. End-to-end por la Edge Function (TA.22)** — la cadena completa
`app → HTTP header viejo → serveEf → admin client (nombre nuevo) → PostgREST → audit.record_version`,
recorriendo las **dos** grafías: `invite_user` (sin email, ADR-014) → `accept_invitation` mandando sólo ese
header → la fila de audit del INSERT de `user_roles` tiene **ese mismo uuid** y el actor real. Es el único
test que ve el tramo donde vive de verdad la tolerancia para builds instaladas (los TA.17–TA.20 entran por
PostgREST directo). El oráculo es un uuid concreto: un id generado server-side no puede coincidir.

### Verificación final

| Qué | Baseline (pre-fase) | Ahora |
|---|---|---|
| `node --test supabase/tests/audit/run.cjs` | 15 pass / 0 fail | **21 pass / 0 fail** |
| `node --test supabase/tests/edge/run.cjs` | 42 pass / 5 skip / 0 fail | **42 pass / 5 skip / 0 fail** |
| `pnpm -C app typecheck` | 0 | **0** |
| `node scripts/check.mjs` | ROJO (1 fail: guard de marca) — y por eso **el backend no corría** | **RC=0, 22 stages** |
| `pnpm -C app run e2e` | 307 passed / 1 skipped (2 flakes catalogados) | **307 passed / 1 skipped / 1 failed → el flake catalogado, verde al re-correrlo** |

Los 5 `skipped` de la suite `edge` son los U9, gateados por `U9_DEPLOYED=1` — idénticos al baseline.

**E2E, literal** (`33.5m`): `1 failed · 1 skipped · 307 passed`. El único rojo es
`e2e/animals.spec.ts:1311` — **uno de los dos flakes catalogados**. No lo di por bueno de la lista:

```
$ pnpm exec playwright test e2e/animals.spec.ts:1311
  ok 1 [chromium] › animals.spec.ts:1311:5 › delta #15 (RCAP.4/RCAP.5): vaca con cría al pie → … (8.3s)
  1 passed (9.8s)
```
El otro flake catalogado, `e2e/cria-al-pie-bastoneo.spec.ts:87`, pasó **dentro de la corrida completa**
(`ok 90 … (7.8s)`), así que no hubo que re-correrlo. El `RC=127` + `Assertion failed:
!(handle->flags & UV_HANDLE_CLOSING)` del final es el crash de teardown de Node en Windows **después** de
terminar los tests (`reference_playwright_win_teardown`), no un fallo.

> ⚠️ **La primera corrida del E2E abortó en el bundle, y no fue por esta fase**:
> `SyntaxError: src/services/ble/BleStickListenerProvider.tsx: Duplicate declaration "readSourceFor"` —
> un archivo a medio editar por la **otra terminal** (está trabajando en `app/src/services/ble/*`). Al
> re-verificar minutos después, `pnpm -C app typecheck` daba 0 y el duplicado ya no estaba: la arreglaron.
> Se re-corrió el E2E completo desde cero y ese es el resultado de arriba.

Después del E2E se revirtieron los **53** PNG de `design/` que la corrida re-renderiza con diffs espurios
(`git checkout -- design/` → 0 modificados). No se hizo `git add -A` en ningún momento.

**El árbol volvió a verde y con eso `check.mjs` alcanzó por primera vez en días las 17 suites de backend
(entrada de `docs/backlog.md` del 2026-08-17). NO aparecieron fallos backend ocultos**: los 22 stages
pasaron. O sea que el defecto del orquestador (morir en el primer stage rojo) no estaba tapando ninguna
regresión — pero el defecto sigue ahí y su entrada de backlog sigue abierta.

### Trazabilidad — requisito reconciliado → test concreto

Esta fase no tiene `R<n>` propios (es una fase del rebrand, no una feature): los requisitos que toca son
los de las specs 18 y 23, reconciliados. Mapa de lo que cada uno tiene hoy como oráculo:

| Requisito | Test |
|---|---|
| **18-R2.6** actor por header bajo `service_role` (grafía nueva) | `supabase/tests/audit/run.cjs` TA.12 |
| **18-R2.6** ídem, grafía VIEJA (tolerancia) | `audit/run.cjs` TA.17 · migración `0133` `DO` caso (b) |
| **18-R2.8** anti-spoof, grafía nueva | `audit/run.cjs` TA.13 |
| **18-R2.8** anti-spoof, las DOS grafías juntas | `audit/run.cjs` TA.21 · `0133` `DO` caso (f) |
| **18-R7.4b** sin header → `auth_uid` NULL | `audit/run.cjs` TA.4/TA.5/TA.6 y TA.20 |
| **18-R2.1 / TOTAL** la función nunca lanza | `0133` `DO` casos (g)/(g2) |
| **23-R1.4** el cliente manda el header en los 3 call-sites | `app/src/utils/request-id.test.ts` *"los tres call-sites … por la constante"* |
| **23-R2.2** header nuevo válido → se usa | `_shared/request-headers.test.ts` *"lee CADA uno de los nombres aceptados"* · `audit/run.cjs` TA.22 |
| **23-R2.3** sin header → id server-side | `request-headers.test.ts` *"sin ninguno de los dos → null"* |
| **23-R2.4** header inválido → tratado como ausente | `request-headers.test.ts` *"un header con basura se trata como AUSENTE"* |
| **23-R2.4 (bis)** nuevo inválido + viejo válido → gana el viejo | `request-headers.test.ts` *"el primero VÁLIDO, no el primero PRESENTE"* · `0133` `DO` caso (d) |
| **23-R2.12** el admin client setea el header | `audit/run.cjs` TA.18 (llega a la fila de audit) · TA.22 (end-to-end real) |
| **23-R2.13** CORS permite el header | `request-headers.test.ts` *"CORS permite TODOS los nombres que la EF acepta"* + preflight real verificado |
| **23-R3.3/R3.7/R3.8** `request_id` aterriza en el audit (grafía nueva) | `audit/run.cjs` TA.18 |
| **23-R3.3 (tolerancia)** ídem con la grafía VIEJA | `audit/run.cjs` TA.19 · `0133` `DO` caso (b) |
| **23-R3.4/R3.5** anti-spoof del `request_id` | `audit/run.cjs` TA.21 · `0133` `DO` caso (f) |
| **23-R3.6 / TOTAL** | `0133` `DO` casos (g)/(g2) |
| **23-R3.12/R3.13** fail-closed (EXECUTE + muro) | `audit/run.cjs` TA.16 · smoke-check de `0133` · query directa al remoto |
| **una sola definición** (que no reaparezca un literal) | `request-headers.test.ts` *"ningún archivo de supabase/functions…"* · `request-id.test.ts` *"ningún archivo de app/src…"* |
| **cadena completa cliente→EF→PostgREST→audit**, las dos grafías | `audit/run.cjs` TA.22 |

### Gate 2.5 (capturas) — **N/A**

La fase no toca UI: no hay pantalla, sheet, formulario ni copy nuevos. El único archivo de `app/app` que
cambió es un **comentario** en `invitar.tsx:109`. Los cambios de `app/src` son el nombre de un header de
wire en tres llamadas a Edge Functions — invisible para el usuario, con el mismo comportamiento observable
(mismos estados, mismos errores). Por eso no se entrega `app/e2e/captures/<feature>.capture.ts`. Lo que sí
corre es la **suite E2E completa de regresión**, que ejerce los tres call-sites de verdad contra las EFs
deployadas (y de paso el preflight de CORS, que en nativo no existe y sólo se ve en web).

---

## Autorrevisión adversarial

Qué busqué: desviaciones del diseño acordado · edge cases sin test (NULL, vacío, basura, ambos presentes,
orden) · gaps de seguridad (spoof, fail-closed, `search_path`, `revoke execute`, helpers expuestos) ·
tests que pasan por la razón equivocada · daño colateral del deploy. Lo que encontré:

**A1 — 🔴 El fallback SQL NO es lo que salva a las builds instaladas. Estaba justificándolo mal.**
Siguiendo la cadena real: una app vieja le manda `X-Rafaq-Request-Id` **a la Edge Function**, no a
PostgREST. La EF lo lee y el admin client lo **re-emite con el nombre NUEVO** hacia PostgREST. O sea que la
tolerancia que le sirve al cliente instalado vive en el **TypeScript** (`readRequestIdHeader` en
`serve.ts`), y el fallback de las dos funciones SQL cubre otra cosa: la **ventana de deploy** entre aplicar
la migración y redeployar las EFs, un redeploy parcial o el rollback de una EF, y cualquier caller futuro
que escriba directo a PostgREST. Sigue valiendo la pena (un `if` por función evita que el ORDEN del deploy
pierda correlación), pero el motivo escrito estaba inflado. **Cerrado**: reescribí el bloque de comentario
de `0133` diciendo las dos tolerancias por separado y **re-apliqué** la migración; corregí la redacción en
`docs/rebrand-mitropero-plan.md` §4.D y en el §4 de este archivo. Y —lo importante— **agregué TA.22**, el
end-to-end por la EF, porque hasta ese momento la capa que de verdad sostiene el argumento no tenía
ningún test de integración.

**A2 — 🔴 Las dos capas resolvían con precedencias distintas (bug latente de pérdida de correlación).**
La primera versión de `readRequestIdHeader` devolvía **el primero PRESENTE**; el SQL usa **el primero
VÁLIDO**. Con un header nuevo vacío o con basura y el viejo bueno, la EF devolvía la basura → `serveEf` la
descartaba (R2.4) → generaba un id server-side → la fila de audit quedaba con un uuid que **no** es el que
la app puso en su evento de dominio. Correlación rota con un valor plausible adentro: no hay síntoma.
**Cerrado**: la validación de forma se mudó a `request-headers.ts` (`readRequestIdHeader` = primero VÁLIDO,
igual criterio que el SQL), `serve.ts` quedó en `readRequestIdHeader(req) ?? crypto.randomUUID()` y se
sacó su `UUID_RE` duplicado. +3 tests (`basura → ausente`, `vacío → ausente`, `nuevo basura + viejo bueno →
gana el viejo`, `los dos inválidos → null`). Re-deployado.

**A3 — 🟠 La primera versión de CORS anunciaba los headers de ACTOR.** Derivaba el `Allow-Headers` de una
lista `SERVER_READ_HEADERS` que incluía `X-Mitropero-Actor` y su legacy → el preflight habría publicado que
la EF acepta el header de actor **desde el navegador**. No es explotable (ninguna EF lee el actor del
request entrante; lo mintea el admin client con el `user.id` del JWT validado), pero es publicitar un canal
que el modelo anti-spoof asume inexistente. **Cerrado antes de deployar**: la lista pasó a
`ACCEPTED_REQUEST_ID_HEADERS` (sólo el id de correlación, las dos grafías) + test de contraprueba
*"CORS NO anuncia los headers de ACTOR"* + el motivo escrito en el módulo.

**A4 — el fallback como canal de spoof: verificado que NO.** Vive **dentro** del
`if v_role = 'service_role'`. Falsificado por el caso (f) del `DO` de la migración (un `authenticated` con
las 4 grafías forjadas → actor = su `sub`, request_id NULL) y por **TA.21** contra la base real.

**A5 — TOTAL (invariante offline): verificado que se preserva.** Los handlers `exception when others` (y el
anidado de `resolve_actor`) quedaron **idénticos** al cuerpo vigente. Casos (g)/(g2) del `DO`: claims
no-JSON y headers no-JSON, bajo y fuera de `service_role` → NULL sin lanzar. Si tiraran, abortarían el
write del operario.

**A6 — colisión de fixtures.** `user_roles_active_unique` (0003) es único parcial sobre
`(user_id, establishment_id) WHERE active`. Los INSERT de TA.17–TA.20 usan `active: false` a propósito
(TA.12 ya dejó uno activo para `userB` en `estA`) y TA.22 desactiva el rol entre las dos vueltas del loop.
Escrito en un comentario del archivo para que no se pierda.

**A7 — el control negativo faltaba.** Sin TA.20 (sin ningún header → `auth_uid` y `request_id` NULL),
TA.17–TA.19 podrían estar verdes por un default o por un valor pegado de otra fila. Agregado.

**A8 — daño colateral del deploy de TODAS las funciones.** `health` tiene `verify_jwt = false` en
`config.toml`; deployar todas podía pisarlo. Verificado empíricamente después: `GET /functions/v1/health`
sin JWT → **HTTP 200**. Y la suite `edge` quedó idéntica al baseline (42/5/0).

**A9 — territorio de la otra terminal.** No toqué `app/src/services/ble/*`, `app/app/baston-test.tsx`,
`docs/bastones-mercado-argentino.md`, `specs/active/04-bluetooth-baston/*` ni `progress/current.md`.
Aparecen como modificados en `git status` porque los está editando la otra sesión — **mi diff no los roza**
(verificado con `git diff --stat` por archivo). Tampoco toqué `feature_list.json` (archivo de coordinación
del leader; sus notas nombran el header viejo en entradas de bitácora fechadas — es historia, no contrato).

**A10 — churn de CRLF.** Las ediciones por script se hicieron con Python en modo binario-de-líneas
(`newline=''` en lectura y escritura). `git diff --stat` da conteos proporcionales al cambio real, sin
reescrituras de archivo entero.

**A11 — guards que no miran nada.** Los dos escaneos de árbol tienen anti-vacío: ≥15 `.ts` bajo
`supabase/functions` **y** las tres puntas nombradas explícitamente (`serve.ts`/`supabase.ts`/`cors.ts`);
≥200 fuentes bajo `app/src`. Y los dos tienen contrapruebas del detector (incluyendo que una MENCIÓN del
header en un comentario no dispare — los `_shared/*.ts` lo nombran en prosa varias veces).

**A12 — hallazgo ajeno, NO lo arreglo**: `ops.applied_migrations` **no existe en DEV** → `health_status()`
devuelve `schema_version: 'unknown'` (la suite `health` lo acepta explícitamente). Es del ledger de spec 16
Run F, pre-existente; ni la fase 4 ni la 5 lo introdujeron. Anotado acá y nada más.

---

## Lo que quedó AFUERA (a propósito)

- **La limpieza del fallback (tercer tiempo del rename).** Entrada nueva en `docs/backlog.md` con las dos
  condiciones que la habilitan. Los tests que exigen la tolerancia están escritos para ponerse **rojos** si
  alguien limpia antes de tiempo: ese rojo es la pregunta *"¿ya no quedan clientes viejos?"*.
- **`0124` y `0131` sin editar** (append-only). El literal viejo que se lee ahí es historia; el as-built
  está en `0133` y reproducido en los `design.md` de las specs 18 y 23 con su marca `[AS-BUILT]`.
- **PROD.** No se tocó: `0133` y el redeploy fueron sólo a DEV (`xrhlxxdnfzvdnztacofj`, con el assert de ref
  del script). Cuando se replaye a PROD, `0133` va junto con `0132`.
- **Fase 6 (identidad Expo)** y todo `rafaq-app`/`rafaqsorg`/`scheme: 'rafq'`/`RAFAQ_*`/`rafaq.db`/
  `@rafaq-test.local`: fuera de alcance, pospuestos por Raf.
- **El defecto del orquestador de `check.mjs`** (morir en el primer stage rojo y no llegar al backend):
  esta fase lo destapó y lo *mitigó de hecho* al devolver el árbol a verde, pero **no lo arregló**. Su
  entrada de backlog del 2026-08-17 sigue abierta y sigue siendo válida.
- **`feature_list.json`**: no lo toqué (coordinación del leader).
- **Commit**: no commiteé, según la instrucción.
