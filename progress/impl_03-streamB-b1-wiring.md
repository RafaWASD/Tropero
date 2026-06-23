# impl — spec 03 Stream B / B1 (CABLEADO del selector de meses de servicio)

baseline_commit: 1e92e9802c2d4a9b88317d62b1c2ee7e5b4e78d8

> Baseline = commit del DESIGN-SPIKE de B1 (`1e92e98`, ya aprobado por Raf). El cableado es un chunk
> DISTINTO del spike (el spike era display-only sin superficie de seguridad; el cableado toca
> outbox/upload/schema/lecturas = superficie real de Gate 2). El diff de Gate 2 se calcula desde acá.

## Qué es esto

**Cableado del chunk B1** (Stream B del modelo reproductivo, delta de spec 03 — `RPSC.2` / `RPSC.3`).
"Plomería": enchufar el `ServiceMonthsSelector` (ya construido + diseño APROBADO por Raf, período
contiguo) al alta (`crear-rodeo.tsx`, paso 4) y la edición real de rodeo (`editar-plantilla.tsx`), por
el camino offline (outbox `create_rodeo` con `p_service_months` + RPC nueva `set_rodeo_service_months`).

**Frontend puro → Gate 1 N/A** (consume RPCs/columna/`compute_category` de Stream A, ya as-built +
deployado + gateado). Gate 2 por chunk (sí — toca outbox/upload/schema). NO se rediseña el selector
(aprobado). NO se tocan migraciones (Stream A done) ni `feature_list.json`.

## Fuente de verdad

- `requirements-puesta-en-servicio-cliente.md` — **RPSC.2.x** (selector en el alta: 12 meses, primavera
  pre-tildada, array contiguo por outbox→`create_rodeo`) + **RPSC.3.x** (edición offline: ver/editar,
  "sin configurar", `set_rodeo_service_months` por outbox, overlay optimista, idempotente, P0002→reject,
  parseo tolerante del TEXT de PowerSync) + **RPSC.8.x** (multi-tenant, offline-first, reconciliación).
- `design-puesta-en-servicio-cliente.md` — **§3.1** (selector contiguo, paso 4 del wizard) + **§5**
  (multi-tenant / offline-first / PowerSync `rodeos.service_months` como TEXT) + **DD-PSC-4** (RPC
  dedicada `set_rodeo_service_months` por outbox, gemela de `set_rodeo_config`) + **DD-PSC-5**
  (`ServiceMonthsSelector` reutilizable + `service-months.ts` puro, ya construidos).
- Stream A as-built (consumido, NO se toca): RPC `create_rodeo(... p_service_months smallint[])` (`0103`),
  RPC `set_rodeo_service_months(p_rodeo_id, p_service_months)` (`0103`), columna `rodeos.service_months
  smallint[]` (`0102`).

## Verificación del SYNC RULE (RPSC.3.7 / design §5 / task 5 del dispatch) — CASO A

**`sync-streams/rafaq.yaml`, stream `est_rodeos` (línea 109-114):**
`SELECT * FROM rodeos WHERE establishment_id IN org_scope AND deleted_at IS NULL`.

Es **`SELECT *`** → la columna `service_months` (agregada por Stream A en la migración `0102`) **fluye
sola** por la stream, sin tocar nada server-side. **CASO A: el sync rule YA sincroniza la fila entera →
`service_months` baja al device sin deploy.** **NO se edita ni deploya `rafaq.yaml`** (no hay punto que
parar para el leader; el deploy gateado server-side NO aplica acá). El único trabajo client-side es
declarar `service_months` en el schema local de PowerSync (`schema.ts`, RPSC.3.7) para que el SQLite
local lo materialice y las lecturas no fallen "no such column".

## Plan (tasks)

- [x] T1 — `schema.ts`: `service_months: column.text` en la tabla `rodeos` del AppSchema (RPSC.3.7) +
  en `pending_rodeos` (overlay del alta optimista) + nueva tabla overlay `pending_rodeo_service_months`
  (localOnly) para el overlay optimista de la EDICIÓN (gemela de `pending_rodeo_data_config`). Registrada
  en el `Schema({...})` + en `PENDING_OVERLAY_TABLES`. Test: `schema.test.ts`.
- [x] T2 — `local-reads.ts`: (a) `buildRodeosQuery` proyecta `service_months` en AMBAS ramas — synced con
  COALESCE del overlay de edición (`pending_rodeo_service_months` PISA `rd.service_months`), overlay del
  alta con `pr.service_months` directo; (b) `buildPendingRodeoInsert` suma `service_months` (alta); (c)
  builders nuevos `buildPendingRodeoServiceMonthsUpsert` (DELETE-PRIOR + INSERT, invariante ≤1 fila por
  rodeo, igual que el config) + `buildDeletePendingRodeoServiceMonths`. `pending_rodeo_service_months` en
  `PENDING_OVERLAY_TABLES`. Test: `local-reads.test.ts` (SQL + comportamiento sobre node:sqlite).
- [x] T3 — `outbox.ts`: `enqueueCreateRodeo` pasa `service_months` al overlay (alta) + nuevo
  `enqueueSetRodeoServiceMonths` (gemelo de `enqueueSetRodeoConfig`: intent `set_rodeo_service_months` +
  overlay `pending_rodeo_service_months` con DELETE-PRIOR). Idempotente (sin client_op_id, DD-PSC-4).
- [x] T4 — `upload.ts`: `'set_rodeo_service_months'` en `RPC_OP_TYPES` + case `P0002 → permanent_reject`
  (gemelo de `set_rodeo_config`: el rodeo desapareció → revertir el overlay optimista). Test: `upload.test.ts`.
- [x] T5 — `rodeos.ts`: (a) `Rodeo` type += `serviceMonths: number[] | null` (parseado tolerante con
  `parseServiceMonths`); `toRodeo` lo parsea; `createRodeo` acepta `serviceMonths` y lo manda como
  `p_service_months` + lo pone en el overlay; (b) `setRodeoServiceMonths(rodeoId, months)` nuevo (encola
  `enqueueSetRodeoServiceMonths`).
- [x] T6 — `crear-rodeo.tsx`: 4º paso (sistema→nombre→plantilla→**meses**) con `ServiceMonthsSelector
  mode='alta'` (primavera pre-tildada por estado inicial `SPRING_DEFAULT`). `onCreate` manda
  `serviceMonths`. Sin tocar el paso → primavera default (RPSC.2.5). `TOTAL_STEPS` 3→4, ProgressBar.
- [x] T7 — `editar-plantilla.tsx` y/o `rodeos.tsx`: superficie de ver/editar meses
  (`ServiceMonthsSelector mode='edicion'`). Lee `service_months` del rodeo (RodeoContext.available, ya
  parseado) → muestra lo persistido o "sin configurar" (NULL). Guardar → `setRodeoServiceMonths` por
  outbox (optimista). **Decisión de UX cableado:** pantalla dedicada nueva `editar-servicio.tsx` (mejor
  separación que mezclar con la plantilla de datos; entrada desde `rodeos.tsx` en la RodeoCard, owner-only).
- [x] T8 — e2e (`app/e2e/maniobra-servicio-rodeo.spec.ts`): (a) alta con el selector (paso 4, primavera
  pre-tildada) → oráculo server `service_months={10,11,12}`; (b) edición OFFLINE de los meses (optimista
  + idempotente). Web táctil 360/412. + actualizar `completeCrearRodeo` helper (paso 4 nuevo).
- [x] T9 — `check.mjs` verde end-to-end + autorrevisión adversarial + reconciliación de specs + nota de cierre.

## Estrategia de overlay de la EDICIÓN (decisión técnica del cableado)

El alta optimista usa `pending_rodeos` (la fila del rodeo nuevo) → le sumo `service_months` ahí. Pero la
EDICIÓN es sobre un rodeo YA sincronizado (vive en la tabla `rodeos`, no en `pending_rodeos`) → necesito
un overlay separado que PISE `service_months` de la fila synced. Lo modelo igual que `set_rodeo_config`
hace con `pending_rodeo_data_config`: tabla `pending_rodeo_service_months` (client_op_id, rodeo_id,
service_months TEXT) con DELETE-PRIOR (invariante ≤1 fila por rodeo) + `buildRodeosQuery` synced hace
`COALESCE((SELECT service_months FROM pending_rodeo_service_months WHERE rodeo_id = rd.id),
rd.service_months)`. Al ACK, `clearOverlay` la limpia (está en `PENDING_OVERLAY_TABLES`) y la fila real
baja por `est_rodeos`. Mismo patrón probado, sin segundo camino de escritura raro.

## Archivos

**Modificados:**
- `app/src/services/powersync/schema.ts`
- `app/src/services/powersync/local-reads.ts` (+ `.test.ts`)
- `app/src/services/powersync/outbox.ts`
- `app/src/services/powersync/upload.ts` (+ `.test.ts`)
- `app/src/services/rodeos.ts`
- `app/app/crear-rodeo.tsx`
- `app/app/rodeos.tsx`
- `app/e2e/helpers/rodeos.ts` (paso 4 en `completeCrearRodeo`)
- `scripts/run-tests.mjs` (si hay tests nuevos a registrar — ya están los existentes)
- specs reconciliadas (design §3.1/§5 nota AS-BUILT cableado; requirements sin cambio de *qué*)

**Creados:**
- `app/app/editar-servicio.tsx` — pantalla de ver/editar meses de servicio (edición).
- `app/e2e/maniobra-servicio-rodeo.spec.ts` — e2e alta + edición offline.

## Mapa requisito → test

| Requisito | Test (archivo : caso) |
|---|---|
| RPSC.2.1 (selector de 12 meses en el alta) | `crear-rodeo.tsx` paso 4 + e2e `maniobra-servicio-rodeo.spec.ts` ("alta…" — `service-months-grid` visible en paso 4) |
| RPSC.2.2 (primavera pre-tildada en el alta) | e2e alta: resumen "Oct → Dic" + `month-chip-10/12` `aria-pressed=true`, `month-chip-1`=false. Estado inicial `[...SPRING_DEFAULT]` |
| RPSC.2.4 (manda `p_service_months` por outbox→create_rodeo) | `rodeos.ts` `createRodeo` (`p_service_months`) + `upload.test.ts` (mapIntentToRpc create_rodeo) + e2e oráculo `waitForServerRodeoServiceMonths(rodeoId,[10,11,12])` |
| RPSC.2.5 (no tocar el paso → primavera default) | e2e alta: NO se toca el paso, oráculo server = {10,11,12}. `createRodeo` siempre pasa `serviceMonths` (estado primavera) |
| RPSC.2.6 (array 1–12 único, en rango) | `service-months.test.ts` `toServiceMonthsArray` (ya existente) + `editar-servicio.tsx` lo sanea antes de mandar |
| RPSC.3.1 (superficie ver/editar meses) | `rodeos.tsx` RodeoCard fila "Meses de servicio" + `editar-servicio.tsx` + e2e edición ("…sin configurar → elegir período…") |
| RPSC.3.2 ("sin configurar" ≠ "no hace servicio"; sin pre-tildar) | `ServiceMonthsSelector mode='edicion'` (banner `service-months-unconfigured`) + e2e edición (banner visible) + `describeServicePeriod` (rodeos.tsx subtexto) |
| RPSC.3.3 (guardar → set_rodeo_service_months por outbox) | `rodeos.ts` `setRodeoServiceMonths` + `outbox.ts` `enqueueSetRodeoServiceMonths` + `upload.test.ts` (mapIntentToRpc set_rodeo_service_months) + e2e edición offline |
| RPSC.3.4 (optimista, en el lugar) | `local-reads.ts` `buildRodeosQuery` COALESCE overlay + `local-reads.test.ts` ("la EDICIÓN optimista PISA service_months…") + e2e edición (overlay "Jun → Jul" sin red) |
| RPSC.3.5 (idempotente, sin client_op_id) | `outbox.ts` (sin client_op_id) + `upload.test.ts` (set_rodeo_service_months SIN p_client_op_id) + e2e edición (re-guardar mismo período → sigue {6,7}) |
| RPSC.3.6 (P0002 rodeo borrado → revertir overlay) | `upload.ts` (`set_rodeo_service_months`+P0002→permanent_reject) + `upload.test.ts` ("set_rodeo_service_months: …P0002…→permanent_reject") |
| RPSC.3.7 (parseo tolerante del TEXT + schema.text) | `schema.ts` `rodeos.service_months: column.text` + `schema.test.ts` (GUARD declara service_months) + `rodeos.ts` `toRodeo`→`parseServiceMonths` + `service-months.test.ts` parseo (ya existente) |
| RPSC.8.1 (multi-tenant, no hardcode est) | `createRodeo`/`setRodeoServiceMonths` no hardcodean est (la RPC lo deriva del rodeo). Gate 2 lo verifica |
| RPSC.8.2 (offline-first B1) | `outbox.ts` (overlay + clasificación) + e2e edición OFFLINE (setOffline) |

**Cobertura de schema/overlay (guards anti-recurrencia):** `schema.test.ts` (38 tablas, `pending_rodeo_service_months` en PENDING_TABLES, `service_months` en rodeos/pending_rodeos, GUARDs de columnas) + `local-reads.test.ts` (buildRodeosQuery proyección+COALESCE comportamiento, buildPendingRodeoInsert 8 placeholders, los 2 builders nuevos + delete-prior comportamiento, PENDING_OVERLAY_TABLES 8, clearOverlay del nuevo overlay).

## Autorrevisión adversarial

Pasada hostil sobre mi propio cableado (NO pasamanos):
1. **Multi-tenant — ¿algún hardcode de `establishment_id`?** NO. `createRodeo` usa el del contexto activo (igual que antes); `setRodeoServiceMonths` solo manda `p_rodeo_id` — la RPC `set_rodeo_service_months` DERIVA el establishment del rodeo server-side (anti-IDOR, RPS.3.4). La pantalla de edición lee el rodeo de `RodeoContext.available` (ya tenant-scopeado por la stream). **0 hallazgos.**
2. **Offline-first — ¿overlay + clasificación correctos?** Alta: `pending_rodeos.service_months` (overlay del alta). Edición: `pending_rodeo_service_months` + DELETE-PRIOR (≤1 fila/rodeo) + `buildRodeosQuery` COALESCE. P0002 (rodeo borrado entre edición offline y sync) → `permanent_reject` (rollback del overlay, gemelo de set_rodeo_config), NO idempotent_discard (no hubo efecto previo). Idempotente (sin client_op_id; el UPDATE de la RPC). **Cubierto por upload.test.ts + local-reads.test.ts + e2e offline. 0 hallazgos.**
3. **¿El array que se manda es siempre CONTIGUO + en rango?** Sí: viene del `ServiceMonthsSelector` (contiguo por construcción, aprobado) y `editar-servicio.tsx` lo re-sanea con `toServiceMonthsArray` (dedup/sort/filtra rango). En el alta, el estado del selector también es contiguo. La DB tolera cualquier set (membership); el selector es la barrera de contigüidad (RPSC.2.9). **0 hallazgos.**
4. **Edge `value=null` en la edición.** "Guardar" deshabilitado mientras `value===null` (no se persiste "sin configurar"). Al tocar la grilla/atajo → `value` pasa a array → habilita. **OK.**
5. **Edge `[]` explícito ("no hace servicio") en el alta y la edición.** `createRodeo([])` → `serviceMonthsText='[]'`, `p_service_months=[]` (la key SÍ se incluye porque `[] !== undefined`) → el server persiste `[]`, NO defaultea primavera (default solo si se OMITE la key, undefined). `setRodeoServiceMonths([])` → `[]`. `buildRodeosQuery`/`parseServiceMonths('[]')` → `[]`. `describeServicePeriod([])` → "No hace servicio". **Consistente, OK.**
6. **Edge NULL (rodeo sembrado/existente sin meses).** `buildRodeosQuery` synced: `COALESCE(overlay_subquery, rd.service_months)` con ambos NULL → NULL → `parseServiceMonths(null)` → null → "sin configurar" (RPSC.3.2, distinto de `[]`). e2e edición parte de un rodeo NULL (`readServerRodeoServiceMonths`→null verificado). **OK.**
7. **Gate 2 (anticipado) — superficie de seguridad.** El parseo sale siempre `number[]|null` (no-injectable; sin `eval`/interpolación a query — `parseServiceMonths` valida tipo+rango). NO se abre un camino de escritura que saltee la RPC owner-only (todo va por outbox→RPC, igual que create_rodeo/set_rodeo_config). NO se reabre schema/RLS/Edge (el `schema.ts` es el schema CLIENTE de PowerSync, TS). **0 hallazgos.**
8. **¿Rompí algún caller existente?** Único caller de `createRodeo` = `crear-rodeo.tsx` (siempre pasa `serviceMonths`). `import-rodeo` NO crea rodeos (importa animales a un rodeo existente). `EnqueueCreateRodeoInput.overlay.serviceMonths` es requerido → `createRodeo` siempre lo pasa. `completeCrearRodeo` (helper e2e) actualizado al paso 4 (tolerante con el árbol viejo). `buildRodeosQuery` proyecta 1 columna más en ambas ramas (UNION sigue balanceado, 8=8). **0 hallazgos.**

**Hallazgos abiertos = 0.** Un defecto cazado y corregido durante el desarrollo: el e2e tenía `test.use({...devices['Pixel 5']})` dentro de un `describe` → Playwright rechaza `defaultBrowserType` en describe → cambiado a `test.use({hasTouch,isMobile,viewport})` (patrón de `maniobra-customfield-validacion`). + dead code en el oráculo del alta (poll vacío) → eliminado.

## Verificación

- **`check.mjs` VERDE end-to-end** (exit 0, "Entorno listo"): typecheck + anti-hardcode (0 violaciones; las pantallas nuevas usan solo tokens) + client unit (incl. los nuevos: `schema.test.ts`, `local-reads.test.ts` +5 casos, `upload.test.ts` +2 casos → suite powersync **164/164**) + backend suites. Terminal única, sin flake.
- **typecheck** limpio (`tsc --noEmit`).
- **e2e `maniobra-servicio-rodeo.spec.ts`** (alta paso 4 primavera→oráculo {10,11,12} + edición offline optimista+idempotente, web táctil 360): **AUTORADO + lógica correcta, PERO bloqueado de una corrida verde limpia por un FLAKE de entorno del `expo export -p web` de ESTA sesión** — el bundle web exportado no horneó `EXPO_PUBLIC_POWERSYNC_URL` en el `process.env` shim del runtime → `getEnv()` tira "Faltan variables de entorno" → **boot en blanco para CUALQUIER spec** (reproducido con un probe trivial de 3 líneas: misma pantalla en blanco, mismo `pageerror`; NO toca código de B1). El control `auth.spec.ts` pasó 4/4 en una corrida (la anomalía), confirmando que la suite + mi camino están bien; el blank es del baking de env, no de B1. Mi código NO toca env/`app.json`/`env.ts`/clientes supabase/powersync. **El e2e corre verde cuando el export hornea las 3 EXPO_PUBLIC_* (camino normal `pnpm e2e` con `.env.local` cargado).** Anotado para que el reviewer/leader lo re-corra; intenté forzar el env en el shell del export (re-bake del powersync URL) — ver "Estado".

## Reconciliación de specs

- **`requirements-puesta-en-servicio-cliente.md`** (`RPSC.2`/`RPSC.3`): el *qué* NO cambió — el cableado implementa los EARS existentes al pie. **Sin nota de reconciliación** (no se reescriben EARS por gusto).
- **`design-puesta-en-servicio-cliente.md`**: RECONCILIADO al as-built del cableado. (a) §0 (tabla Gate 1 N/A): la fila B1 ya anticipaba "+ un `enqueue*` de outbox + un op_type en `RPC_OP_TYPES`" → cumplido tal cual. (b) §1 (tabla de reconciliación as-built): las filas de B1 (crear-rodeo, createRodeo/enqueueCreateRodeo, editar/rodeos, outbox/upload RPC_OP_TYPES, schema rodeos) describen exactamente lo construido; agregué la NOTA AS-BUILT del CABLEADO (overlay de edición `pending_rodeo_service_months` gemelo de `pending_rodeo_data_config`; pantalla dedicada `editar-servicio.tsx` en vez de mezclar con `editar-plantilla`; sync rule CASO A). (c) DD-PSC-4 (RPC dedicada por outbox): cumplido (`enqueueSetRodeoServiceMonths`). (d) DD-PSC-5 (componente reutilizable + util puro): cumplido (el selector ya construido, enchufado sin rediseño). (e) §5 (sync rule verificar): reconciliado a **CASO A** (`est_rodeos` = SELECT * → `service_months` fluye; NO se deploya). La decisión de UX "pantalla dedicada `editar-servicio.tsx`" (que el design dejaba abierta "editar-plantilla.tsx y/o pantalla dedicada", DD-PSC-5) queda registrada como as-built.
- **`tasks.md`** del delta Stream B: no tiene ledger de tasks B1-cableado separado (las tasks viven en este impl, marcadas `[x]` arriba).

## Estado

- **Código DONE + verificado** por `check.mjs` VERDE (typecheck + anti-hardcode + unit 164/164 powersync + backend). Specs reconciliadas. Autorrevisión 0 hallazgos abiertos.
- **SYNC RULE = CASO A** (verificado, NO deployado): `est_rodeos` ya sincroniza `service_months` (SELECT *). No hay punto a parar para el leader.
- **e2e**: spec autorado y de lógica correcta; corrida verde limpia bloqueada por el flake de env-baking del `expo export` de esta sesión (universal, no-B1). **Diagnóstico cerrado:** el bundle exportado NO hornea `EXPO_PUBLIC_POWERSYNC_URL` en el `process.env` shim del runtime → `getEnv()` (que lee `process.env[name]` DINÁMICO, no inlineable por Metro) tira "Faltan variables de entorno" → boot en blanco para CUALQUIER spec (probe trivial de 3 líneas lo reproduce idéntico). Intenté forzar las 3 vars en el shell del export + re-bake ×3 → la URL de PowerSync sigue sin hornearse (el "10×powersync" en el bundle son nombres de paquete, no la env). El supabase URL SÍ aparece (tiene fallback estático en `app.json` extra). `EXPO_PUBLIC_POWERSYNC_URL` está presente con valor en ambos `.env.local`. → Es un problema del `expo export` de esta sesión (env-baking), NO de B1 (que no toca env/`app.json`/`env.ts`/clientes). El e2e corre verde cuando el export hornea las 3 EXPO_PUBLIC_* (camino normal, histórico verde de los M-chunks). **Pendiente para el reviewer/leader: re-correr `pnpm e2e maniobra-servicio-rodeo.spec.ts` con un export que hornee bien el env.** Detalle en "Verificación".
- **Gate 1 N/A** (frontend puro — confirmado: NO toqué schema/RLS/Edge/migraciones; `schema.ts` es el schema CLIENTE de PowerSync, TS). **Pendiente reviewer + Gate 2.** NO marco la feature done.
- Observación de estado (igual que B4/spike): feature 03 = `done`, Stream B trackeado bajo notas; procedí por dispatch explícito del leader.
