baseline_commit: 638679fa61672e884fc75b3ae94a855bf9853642

# impl 10 — Eliminación del campo "Vía de aplicación" del flujo de vacunación

**Tipo**: feature acotada (NO el flujo SDD completo de spec 10 — chunk de remoción).
**Decisión de producto** (cerrada por Raf tras consultar a Facundo, el vet socio): el producto YA
implica la vía de aplicación (cada producto la tiene en su etiqueta) → capturar la vía aparte es
redundante. Se ELIMINA el campo del flujo de vacunación masiva. El mismo criterio aplica a
antibióticos/antiparasitarios (flujos de tratamiento/desparasitación que aún no existen en UI → nacen
sin vía; nada que sacar ahí, solo documentar). REVIERTE los commits f518ea5 / 638679f (curado de la
vía a 3 opciones SC/IM/Intranasal).

## DB — DORMIDA, sin migración (LOCKEADO por Raf)
NO se toca la DB. La columna `sanitary_events.route` (enum `public.sanitary_route`, incl. el valor
`intranasal` agregado por 0090) queda DORMIDA: nullable, sin escribirse. NO migración, NO drop de
columna, NO drop del valor del enum (dropear sería destructivo y podría romper la RPC del timeline;
una columna null no molesta). El INSERT de vacunación OMITE la columna `route` → queda NULL por default.

## Plan
- T1: `app/app/vacunacion-masiva.tsx` — borrar el bloque "Vía (opcional)", el estado `route`/`setRoute`,
  el `toggleRoute`, el import de `sanitary-route`, y sacar `route` del objeto de params de
  `applyBulkVaccination` en `onConfirm`.
- T2: `app/src/utils/bulk-operations-plan.ts` — sacar `route` de `VaccinationParams`, `planVaccination`,
  y la firma del builder inyectado.
- T3: `app/src/services/bulk-operations.ts` — actualizar el call-site del builder (sin `route`).
- T4: `app/src/services/powersync/local-reads.ts` — `buildAddVaccinationInsert` sin `route` (INSERT
  omite la columna `route`).
- T5: borrar `app/src/utils/sanitary-route.ts` + `.test.ts`; desregistrarlos de `scripts/run-tests.mjs`.
- T6: ajustar tests que asserten `route` (`bulk-operations-plan.test.ts`, `local-reads.test.ts`).
- T7: e2e — `spec10-uib2-screenshots.capture.ts` (sacar aserciones de chips de vía) +
  `operaciones-vacunacion.spec.ts` (sacar la selección de vía por chip).
- T8: reconciliación de specs 10 (requirements R4.1, design UI-B2 DELTA, tasks T-UI.6) + CONTEXT/03 si aplica.
- T9: verificación (typecheck + check.mjs + tests afectados) + autorrevisión adversarial.

## Reglas
- `event-timeline.ts` `humanizeRoute`/`ROUTE_LABELS` (incl. `intranasal`) → NO tocar (display defensivo
  de eventos LEGACY; evento nuevo tendrá route=null → humanizeRoute(null)=null → no se muestra).
- Parallel terminal: NO toco feature_list.json ni progress/* de otras features (spec 03 maniobras activa
  en este repo). Esta feature es colisión-safe (archivos de spec 10, ya cerrada/done en lo que toca).

## Trazabilidad (decisión → test/verificación)
Esta es una REMOCIÓN, no un EARS nuevo. La "verdad que debe quedar" = el path de vacunación ya no
captura ni persiste `route`. Cubierta por:
- **`route` fuera del INSERT** → `app/src/services/powersync/local-reads.test.ts` :: `T-CL.8 / R3.1: buildAddVaccinationInsert …` — assert nuevo `!/\broute\b/.test(q.sql)` (el SQL NO menciona route) + `q.args` sin el slot de route (`['id-1','p-1','Aftosa','2026-06-11']`).
- **`route` fuera del plan/params** → `app/src/utils/bulk-operations-plan.test.ts` :: `R3.1/R6.1: vacunación = 1 INSERT por animal …` — `VaccinationParams` sin `route`; el builder inyectado tiene 4 args; el último arg del statement es `eventDate` (NO 'subcutánea'). El resto de los casos de planVaccination (R6.3 re-ejecución, batches, empty) pasan con la firma nueva (142/142 verde).
- **`route` fuera de la UI** → `app/e2e/operaciones-vacunacion.spec.ts` (T-UI.11): el flujo end-to-end llena SOLO Producto → preview "3 eventos sobre 3 animales" → confirmar → "3 animales listos" → re-ejecutar = 0 nuevos (idempotencia). Ya no selecciona ni asserta vía. (No corrido por mí — requiere build/Supabase/Playwright; lo corre el leader.)
- **No quedan símbolos colgados** → `pnpm typecheck` verde (TS habría fallado con cualquier import roto de `sanitary-route`).

## Qué hice (T1–T8)
- **T1** `app/app/vacunacion-masiva.tsx`: borré el bloque "Vía (opcional)" (YStack + label + FilterChipRow/`vaccineRouteOptions().map`), el estado `route`/`setRoute`, el handler `toggleRoute`, el import de `@/utils/sanitary-route`. En `onConfirm` el objeto de params quedó `{ productName: productName.trim(), eventDate }` y saqué `route` del dep-array del useCallback. Actualicé el comentario de cabecera. La Card de pre-config quedó SOLO con el `FormField` de Producto.
- **T2** `app/src/utils/bulk-operations-plan.ts`: saqué `route?` de `VaccinationParams`; `planVaccination` ya no pide ni pasa `route` (builder inyectado de 4 args: id, profileId, productName, eventDate).
- **T3** `app/src/services/bulk-operations.ts`: el call-site del builder en `applyBulkVaccination` ya no pasa `route`.
- **T4** `app/src/services/powersync/local-reads.ts`: `buildAddVaccinationInsert` sin el parámetro `route`; el INSERT omite la columna `route` (lista de columnas `(id, animal_profile_id, event_type, product_name, event_date)`) → `route` queda NULL por default. Docblock actualizado (columna dormida).
- **T5** Borré `app/src/utils/sanitary-route.ts` + `app/src/utils/sanitary-route.test.ts`; los desregistré de `scripts/run-tests.mjs` (saqué `app/src/utils/sanitary-route.test.ts` de la línea de client unit tests).
- **T6** Tests ajustados: `bulk-operations-plan.test.ts` (firma del `vaccBuilder` sin route + el caso R3.1 ahora asserta que el último arg es eventDate, NO 'subcutánea'); `local-reads.test.ts` (sin 'subcutánea' en la llamada + assert nuevo de que el SQL no menciona route).
- **T7** e2e: `spec10-uib2-screenshots.capture.ts` (saqué las aserciones de los 3 chips visibles, los 3 ausentes y el click en "Subcutánea"; ahora llena Producto y sigue al preview/CTA); `operaciones-vacunacion.spec.ts` (saqué la selección de vía por chip + aria-pressed; ajusté nombre del test y comentarios). NO corrí build/capture (lo hace el leader).
- **T8** Reconciliación specs 10: `requirements.md` R4.1 (nota as-built reescrita a "VÍA ELIMINADA" — pre-config solo producto; columna/enum dormidos sin migración); `design.md` §1.1 (la nota inline de "vía como chips" → "solo producto"; reemplacé el bloque "DELTA VÍA-INTRANASAL" por "DELTA: VÍA ELIMINADA" con el razonamiento de Facundo + alcance vacunas/antibióticos/antiparasitarios + UI+servicio+DB dormida; marqué la "RECONCILIACIÓN VIA-ENUM-MISMATCH" como OBSOLETA con forward-pointer; actualicé las notas de capturas y la línea de UI-D e2e); `tasks.md` T-UI.6 (nota DELTA: VÍA ELIMINADA). CONTEXT/03: revisado — no menciona la vía como dato a capturar (línea 110 ya dice "Pre-config el producto"), nada que reconciliar.

## DB DORMIDA (nota explícita, sin migración)
La columna `sanitary_events.route` (enum `public.sanitary_route`, incl. el valor `intranasal` de 0090)
queda DORMIDA: nullable, no se escribe. **NO se creó migración, NO se dropeó la columna ni el valor del
enum.** El espejo PowerSync (`schema.ts:345` `route: column.text`) se conserva A PROPÓSITO: la columna
local existe para que el timeline lea la vía de eventos LEGACY (`humanizeRoute`); un evento nuevo nace
con `route=null`. `event-timeline.ts` (`humanizeRoute`/`ROUTE_LABELS`, incl. `intranasal`) intacto.

## Autorrevisión adversarial (paso 8)
- **(a) ¿Imports/símbolos colgados de sanitary-route?** Grep repo-wide en `app/`: 0 matches de `sanitary-route|SanitaryRoute|vaccineRouteOptions|toRouteValue|isValidRoute|routeOptions|VACCINE_ROUTES|SANITARY_ROUTES`. `typecheck` verde (cualquier import roto habría fallado). En `vacunacion-masiva.tsx` las únicas menciones de "route"/"vía" restantes son COMENTARIOS.
- **(b) ¿`route` salió de TODO el path o quedó a medias?** Verificado end-to-end: UI (params sin route) → service (call-site sin route) → plan (`VaccinationParams`/`planVaccination` sin route) → INSERT (columna omitida). Las DEMÁS menciones de `route` que quedan son legítimas y FUERA del path de vacunación masiva: timeline read/projection de eventos legacy (`local-reads.ts:1019`, `event-timeline.ts`, `TimelineEvent.tsx`), maniobras de spec 03 que ya NO escriben route por D10 (`local-reads.ts:1310/1348`, `maneuver-event-query.*`), y el espejo de columna PowerSync (`schema.ts`). Ninguna las toqué.
- **(c) ¿La Card de pre-config renderiza bien con solo Producto?** Sí: `<Card gap="$3">` con un único hijo `<FormField>`. El `gap` queda inerte (un solo hijo) pero inocuo; la Card maneja su padding. No quedó YStack vacío ni gap raro. El filtro (categoría/sexo) y el preview siguen abajo intactos. `FilterChip`/`FilterChipRow` SIGUEN usados por el filtro → no son dead code.
- **(d) ¿Algún test seguía asserteando `route` y pasó por la razón correcta?** Los dos tests que asserteaban 'subcutánea' los reescribí para assertear la AUSENCIA de route (el `local-reads` ahora verifica `!/\broute\b/.test(q.sql)`, y el `bulk-operations-plan` verifica que el último arg es eventDate). Pasan porque el path ya NO inserta route, no por azar.
- **(e) ¿Toqué algo fuera de scope?** No. Solo el path de vacunación masiva + sus specs/tests/e2e + el módulo borrado. NO toqué backend/DB, NO `event-timeline.ts`, NO archivos de spec 03/08, NO feature_list.json, NO progress/* de otras features, NO el espejo de columna PowerSync. Producto/filtro/preview/apply/progreso de vacunacion-masiva intactos.

## Reconciliación de specs (paso 9)
Implementación quedó consistente con `requirements.md`/`design.md`/`tasks.md` de spec 10: las 3 reflejan
"VÍA ELIMINADA" (pre-config solo producto; columna/enum dormidos sin migración). No quedan specs que
contradigan el código. La "RECONCILIACIÓN VIA-ENUM-MISMATCH" del design se marcó OBSOLETA (histórico).

## Verificación
- `pnpm run typecheck` (app) → **verde** (sin imports colgados).
- Tests afectados directos → **142/142 verde** (`bulk-operations-plan.test.ts` + `local-reads.test.ts` + `vaccination-preview.test.ts`).
- `node scripts/check.mjs` → **exit 0** (typecheck + anti-hardcode + 1195+ client unit + RLS/Edge/Animal/Maneuvers + operaciones-rodeo backend 22/22, todo verde). SIN flake de rate-limit esta corrida.
- e2e (`operaciones-vacunacion.spec.ts`, capture `spec10-uib2`): NO corridos por mí (build/Supabase/Playwright) — el leader regenera los PNG y corre la suite. Los `.ts` quedaron correctos (sin selección/aserción de vía).

## Flags
- NINGUNO bloqueante. La columna `sanitary_events.route` + el valor de enum `intranasal` quedan DORMIDOS
  en la DB (sin migración, por decisión de Raf). Si en el futuro se quisiera limpiar el enum, sería una
  migración destructiva aparte (fuera de scope, NO recomendada mientras la RPC del timeline lea route).

