baseline_commit: b1bd0a09645fc5a02d5fdae2b41a147e41263869

# impl — spec 10 chunk UI-B2 FIX-LOOP: VIA-ENUM-MISMATCH (HIGH, pérdida de datos)

> Fix-loop de un finding HIGH del Gate 2 sobre `app/app/vacunacion-masiva.tsx` (UI-B2, T-UI.6).
> SOLO el campo "Vía (opcional)": de TextInput de texto libre → selector de chips con los 5 valores
> del enum `sanitary_route`. NADA más (ni producto, ni filtro, ni preview, ni otra pantalla).

## Feature en curso
- spec 10 — Operaciones masivas por rodeo + vista de grupo. EN IMPLEMENTACIÓN (multi-chunk;
  Puerta 1 aprobada; backend delta + Fase 2/3 + UI-A + UI-B + UI-B2 committeados). Status
  `spec_ready` de feature_list.json es la etiqueta stale conocida (notes dice "EN IMPLEMENTACIÓN").

## El bug (HIGH — pérdida de datos sanitarios en el happy path)
`app/app/vacunacion-masiva.tsx` tenía el campo "Vía (opcional)" como `FormField` (TextInput) de texto
libre (placeholder "Ej. Subcutánea"). Pero `sanitary_events.route` (DB) es el ENUM `public.sanitary_route`
(`supabase/migrations/0027_sanitary_events.sql:5,16`) con SOLO 5 valores:
`intramuscular | subcutaneous | oral | topical | other`.

El string crudo que tipea el operario (`route.trim()`) viajaba sin mapeo:
`onConfirm` → `applyBulkVaccination(..., { route: route.trim() || null })` → `planVaccination`
→ `buildAddVaccinationInsert(id, profileId, productName, route, eventDate)`
→ `INSERT INTO sanitary_events (... route ...) VALUES (..., ?, ...)` con el texto crudo.

Postgres rechaza el cast con `22P02` (invalid input value for enum sanitary_route) → `upload-classify.ts`
lo clasifica PERMANENTE → la CrudEntry se descarta del queue → **se pierden los N eventos de la masiva
server-side**, DESPUÉS de que la UI dijo "Vacunando ✓". Pérdida silenciosa de datos sanitarios.

## Plan
- T1 — Util PURO nuevo `app/src/utils/sanitary-route.ts`: `routeOptions()` (los 5 valores del enum con
  su label es-AR) + `isValidRoute(x)` (type-guard contra los 5 códigos). Garantiza que lo que se manda al
  INSERT es SIEMPRE un código válido o null (nunca texto libre). Testeado.
- T2 — En `vacunacion-masiva.tsx`: reemplazar el `FormField` de "Vía (opcional)" por una fila de chips
  (mismo `FilterChip`/`FilterChipRow` que el filtro categoría/sexo) single-select toggle (tocar el
  seleccionado lo deselecciona → vuelve a null). `route` pasa de `string` ('') a `SanitaryRoute | null`.
  El INSERT recibe `route ?? null` (ya un código válido). Borrar `ROUTE_MAX` (texto libre eliminado).
- T3 — Regenerar el screenshot `design/spec10-ui-b2/vacunacion-preview.png` mostrando los chips de Vía.

## Progreso — DONE (esperando re-gateo de Gate 2 sobre el delta)

### T1 — Util PURO `app/src/utils/sanitary-route.ts` + test ✅
- `SANITARY_ROUTES` = los 5 valores del enum `public.sanitary_route` (0027), anclado con NOTA ANTI-DRIFT
  (cualquier migración que toque el enum debe actualizar acá + el test).
- `routeOptions()` → `[{ code, label }]` con labels es-AR (consistentes con `humanizeRoute`; `other`→"Otra").
- `isValidRoute(x)` type-guard contra los 5 códigos (case-sensitive, lowercase como el enum).
- `toRouteValue(x)` = la BARRERA DURA: código válido pasa, TODO lo demás → `null` (nunca texto crudo).
- `sanitary-route.test.ts` (6 casos): anti-drift contra el enum 0027 pineado independiente; routeOptions
  (5, labels, sin dups); isValidRoute true/false (texto libre es-AR, `intravenous`, case, no-strings);
  el invariante de `toRouteValue`. Registrado en `scripts/run-tests.mjs`.

### T2 — `vacunacion-masiva.tsx`: Vía de TextInput libre → chips ✅
- Estado `route`: de `string` ('') → `SanitaryRoute | null` (default `null`).
- Reemplazado el `FormField` "Vía (opcional)" por una fila de chips con el MISMO `FilterChip`/`FilterChipRow`
  que el filtro categoría/sexo (consistencia visual). 5 chips (`routeOptions()`), single-select toggle
  (`toggleRoute`: tocar el seleccionado → `null`). Vía sigue OPCIONAL (ninguna seleccionada = `null`).
- `onConfirm` manda `route: toRouteValue(route)` → SIEMPRE código del enum o `null`, jamás texto libre.
- Borrado `ROUTE_MAX` (ya no hay texto libre). Imports limpios (`routeOptions`/`toRouteValue`/`SanitaryRoute`).
- SOLO este campo: producto, filtro, preview, apply, progreso intactos.

### T3 — Screenshot regenerado ✅
- `design/spec10-ui-b2/vacunacion-preview.png` muestra "Vía (opcional)" con los 5 chips (Subcutánea
  seleccionada/verde, Intramuscular, Oral, Tópica, Otra) — ya NO el TextInput. Producto + filtro + preview
  + CTA intactos. `vacunacion-skip.png` no se tocó (no muestra la vía).

## `route` → solo enum-válido-o-null (confirmación del fix)
La cadena completa: chips → `setRoute(SanitaryRoute|null)` → `onConfirm` → `toRouteValue(route)` →
`applyBulkVaccination({ route })` → `planVaccination(params.route ?? null)` →
`buildAddVaccinationInsert(..., route, ...)` → `INSERT ... route ... VALUES (..., ?, ...)`.
En NINGÚN punto puede entrar texto libre: el ÚNICO productor de `route` es el chip (código del enum) y
`toRouteValue` es una segunda barrera dura que normaliza cualquier cosa fuera del enum a `null`. El enum
`sanitary_route` nunca recibe un valor que dispare `22P02`.

## Trazabilidad finding → test
| Finding | Cobertura |
|---|---|
| VIA-ENUM-MISMATCH (route ∈ enum o null, nunca texto libre) | `sanitary-route.test.ts` (`toRouteValue` invariante: válido pasa, basura/texto-libre/`intravenous`/no-string → null) + `isValidRoute` false para texto libre + anti-drift SANITARY_ROUTES == enum 0027 |
| Vía OPCIONAL (null permitido) | `sanitary-route.test.ts` (`toRouteValue(null/undefined/'')==null`) + pantalla: ninguna seleccionada = `route===null` → `applyBulkVaccination` con `route:null` (ya soportado, `route?: string|null`) |
| Chips del enum (5 opciones, labels es-AR) | `sanitary-route.test.ts` (routeOptions: 5, códigos válidos, labels concretos incl. "Otra") + screenshot `vacunacion-preview.png` (5 chips visibles, Subcutánea activa) |
| Consistencia visual con filtro categoría/sexo | screenshot (mismo lenguaje de chips) + reuso del MISMO `FilterChip`/`FilterChipRow` (mismo componente, no copia) |
> La UI completa se cubre con E2E en T-UI.11 (chunk siguiente, como el resto de la pantalla). La capture
> e2e (`spec10-uib2-screenshots.capture.ts`) ahora asserta que los 5 chips de vía están visibles y
> selecciona "Subcutánea" antes de capturar — oráculo del design-review + smoke del render.

## Autorrevisión adversarial (qué busqué / qué encontré / cómo cerré)
1. **¿Otro campo de las masivas manda texto libre a una columna enum/constrained?** (auditado): revisé
   los 4 insert/update builders de las masivas en `local-reads.ts`: `buildAddVaccinationInsert` (route =
   AHORA enum-o-null; product_name = `text` libre legítimo), `buildAddWeaningInsert` (`event_type='weaning'`
   literal, sin campos libres), `buildSetCastratedUpdate` (literales 0/1, sin texto), `buildAddObservationInsert`
   (texto → columna `text` `notes`, libre legítimo). NINGÚN otro free-text→enum. El único agujero era la vía.
2. **¿`toRouteValue` es redundante si el chip ya produce solo códigos válidos?** (decisión): NO — es defensa
   en profundidad barata y el invariante queda garantizado aunque un refactor futuro cambie el productor de
   `route` (p.ej. deep-link con query param). El test pinea el invariante independiente de la UI.
3. **¿El enum real es el correcto?** (verificado contra fuente): leí `0027:5` — `('intramuscular',
   'subcutaneous','oral','topical','other')`. NO incluye `intravenous` (que SÍ está en `humanizeRoute` de
   event-timeline, pensado para OTRO contexto). El test asserta explícitamente que `intravenous` NO es
   válido para `sanitary_route` y que SANITARY_ROUTES == el enum 0027 (sin sobra ni falta) → anti-drift.
4. **Toggle deselecciona → vuelve a null** (verificado): `toggleRoute(code)`: `prev===code ? null : code`.
   Tocar el chip activo lo apaga → `route=null` → `toRouteValue(null)=null` → INSERT con `route NULL` (OK,
   columna nullable). Vía OPCIONAL respetada: se puede confirmar sin vía (`canApply` solo exige producto + M>0).
5. **¿Cambié algo fuera del scope?** (verificado): diff = `sanitary-route.ts` (nuevo) + su test (nuevo) +
   `vacunacion-masiva.tsx` (SOLO el bloque de vía: estado, import, toggle, render, onConfirm) + capture
   (assert chips) + run-tests + specs. Producto/filtro/preview/apply/progreso/otras pantallas intactos.
6. **Anti-hardcode** (verificado): `check.mjs` lint ADR-023 §4 = 0 violaciones. Chips reusan el componente
   tokenizado existente; los códigos del enum NO son "hardcode visual" (son el contrato de datos de la DB,
   centralizado en una sola fuente `sanitary-route.ts` con anti-drift).
7. **Test que pasa por la razón correcta** (verificado): los tests de `toRouteValue`/`isValidRoute` ejercen
   el reject real (texto libre, `intravenous`, case, no-strings → null/false), no solo el happy path; el
   anti-drift fallaría si alguien agrega un código fuera del enum. El screenshot e2e renderiza el componente
   real (no un mock) y verifica los 5 labels.
8. **⚠ TENSIÓN chipMin (40px) vs "≥44px" del pedido** (flag al leader, NO improvisé): el pedido pide chips
   ≥44px Y reusar el MISMO estilo del filtro categoría/sexo. El `FilterChip` as-built usa `$chipMin`=40
   (token de diseño DOCUMENTADO en `tamagui.config.ts:187-189`: "≥40px target tappable cómodo, un escalón
   bajo touchMin", reusado por TODOS los chips de filtro de la app incl. los de categoría/sexo de ESTA
   pantalla, ya pasados por Gate 2). Reusé el componente tal cual → consistencia visual exacta (requisito
   explícito) a 40px. NO inventé un valor nuevo ni bumpeé `$chipMin` global (cambio de design token =
   confirm-gated por CLAUDE.md, afecta toda la app, y divergiría los chips de vía de los de categoría/sexo
   adyacentes — rompiendo justo el requisito de consistencia). El gap es de 4px sobre un token establecido,
   no específico de este fix. **Lo dejo en `$chipMin`=40 y lo flageo para decisión del leader/Raf**: si se
   quiere el piso de 44 hay que subir `$chipMin` globalmente (todos los filtros) en un cambio aparte.

## Reconciliación de specs (as-built)
- `design.md` §1.1 (bloque AS-BUILT chunk UI-B2): (a) la línea de pre-config ahora dice "vía (opcional,
  `route`) como SELECTOR DE CHIPS del enum sanitary_route (NO texto libre)"; (b) nuevo bullet
  **RECONCILIACIÓN VIA-ENUM-MISMATCH** con el bug, el as-built del fix, el util puro + test, la auditoría
  de los demás campos, y la captura; (c) caption de `vacunacion-preview.png` menciona los chips de vía.
- `tasks.md` T-UI.6 (sigue `[x]`): nota FIX-LOOP VIA-ENUM-MISMATCH (el *qué* de R4.x NO cambió — la vía no
  es un R<n> con EARS propio; es un sub-detalle del pre-config R4.1, ahora construido correcto).
- `requirements.md`: SIN cambios. R3.1/R4.1 hablan de "pre-config (product_name y demás parámetros)" sin
  fijar el control de la vía ni decir "texto libre" → el fix no contradice ningún EARS; no hay nota que agregar.

## Verificación
- `cd app; pnpm.cmd typecheck` → verde (`tsc --noEmit` sin output).
- `node scripts/check.mjs` → **exit 0** ("Entorno listo"; anti-hardcode 0 violaciones; typecheck client OK;
  client unit incl. `sanitary-route` 6/6 + `vaccination-preview` 10/10; RLS/Edge/Animal/Maneuvers/
  user_private/Import/Sync-streams/Operaciones-rodeo todas verdes). Sin flake esta corrida.
- `sanitary-route.test.ts` aislado → 6/6 pass. Combinado con vaccination-preview → 16/16.
- Screenshot `design/spec10-ui-b2/vacunacion-preview.png` regenerado y verificado visualmente (5 chips de
  vía, Subcutánea seleccionada en verde, consistente con los chips de filtro de abajo).

## Archivos tocados
NUEVOS:
- `app/src/utils/sanitary-route.ts`
- `app/src/utils/sanitary-route.test.ts`
MODIFICADOS:
- `app/app/vacunacion-masiva.tsx` (SOLO el campo Vía → chips: estado, import, toggleRoute, render, onConfirm; borrado ROUTE_MAX)
- `app/e2e/captures/spec10-uib2-screenshots.capture.ts` (assert 5 chips de vía + seleccionar Subcutánea para la captura)
- `scripts/run-tests.mjs` (registra sanitary-route.test.ts)
- `design/spec10-ui-b2/vacunacion-preview.png` (regenerado con los chips de vía)
- `specs/active/10-operaciones-rodeo/{design.md,tasks.md}` (reconciliación as-built del fix)

## NO marqué nada done
Re-gateo de Gate 2 sobre el delta (security_analyzer modo code, baseline_commit arriba). Pendiente la
decisión del leader/Raf sobre la tensión chipMin 40 vs ≥44 (punto 8 de la autorrevisión).
