# Review - spec 03 MODO MANIOBRAS - bugfix aplicabilidad per-animal + robustez de label largo

Reviewer: reviewer (RAFAQ)
Fecha: 2026-06-16
Chunk: frontend-puro (sin schema/DB). Dos sub-pasos: progress/impl_03-bugfix-aplicabilidad.md + progress/impl_03-maniobra-label-largo.md. Fixes de defectos reportados por Raf en pnpm web.

## Veredicto: APPROVED

Logica de aplicabilidad correcta y bien testeada, labels renombrados con unica fuente (MANEUVER_LABELS), linea de maniobra robusta a labels largos (verificado en capturas), specs reconciliadas en las 3 superficies (design 6.bis.4 + 6.bis linea 708 / requirements R6.2-R6.3 y R6.9-R6.10 / tasks). Typecheck verde, unit de maniobras verde (104/104 en las suites afectadas). El unico rojo de check.mjs es el flake conocido de backend (animals_tag_unique, 23505), ajeno a este chunk frontend-puro.

## 1. Trazabilidad R-n / test

- R6.2 (tacto prenez = hembras): maneuver-applicability.test.ts (tactos aplican a hembra, NO a macho, sexo null se salta fail-safe, filterByAnimalApplicability saca ambos tactos de un macho; integracion macho/hembra). e2e maniobra-carga.spec.ts:172 (vaquillona female, label Tacto de prenez).
- R6.2/R6.3 (rename label es-AR): maneuver-wizard.test.ts:34-35 (maneuverLabel tacto y tacto_vaquillona); maneuver-sequence.test.ts (summaryRows). e2e maniobra-carga.spec.ts:172.
- R6.3 (tacto aptitud = hembras): mismos predicados (tacto_vaquillona); e2e maniobra-tacto-bugfix.spec.ts (vaquillona female).
- R6.9 / R6.10 (pesaje vs pesaje_ternero excluyentes por categoria): maneuver-applicability.test.ts (pesaje_ternero solo ternero/ternera; pesaje solo adulto; categoria null da pesaje si / pesaje_ternero se salta; PESAJE Y PESAJE_TERNERO NUNCA A LA VEZ por fuerza bruta 7 combos); integracion TERNERO/ADULTO/null. e2e maniobra-sanitaria.spec.ts:237-278 (ternera elige pesaje_ternero, 1 de 1).
- R6.12 (raspado solo machos, intacto): tests R6.12 existentes + test agnostico narrowed (la lista agnostica ya NO incluye raspado/tacto/pesaje).
- Robustez linea label largo (R5.14): capturas maniobra-line-vaquillona-360/412.png (label elipsado + contador 1 de 2 visible); capture spec e2e/captures/maniobra-label-largo.capture.ts 2/2.

Invariante doble-pesaje: confirmado. El codigo (maneuver-applicability.ts:72-77) hace pesaje_ternero = code en CALF y pesaje = NOT(code en CALF), un XOR estructural que no puede dar ambos true. El test de fuerza bruta lo cubre y no miente.

## 2. Tasks completas

Si. impl_03-bugfix-aplicabilidad.md T1-T5 todas marcadas; impl_03-maniobra-label-largo.md T1-T3 todas marcadas. Ninguna pendiente sin justificacion.

## 3. Reconciliacion de specs (codigo hacia spec)

- design.md 6.bis.4 (linea 766): Aplicabilidad per-animal as-built v2 (tactos=hembras + pesaje/pesaje_ternero excluyentes por categoria incl. null fail-safe + cambio del e2e de la ternera + resto de la matriz pendiente de Facundo). OK
- design.md 6.bis (linea 708): nota linea de maniobra robusta a labels LARGOS (flex/minWidth:0/numberOfLines en el label + flexShrink:0 en el contador + auditoria de los otros call-sites). OK
- requirements.md: nota de reconciliacion bajo R6.2/R6.3 (linea 182) y bajo R6.9/R6.10 (linea 200). EARS no reescritos, son notas. OK
- tasks.md: extension AS-BUILT sobre M3.1 (no task nueva, bugfix sobre celdas ya marcadas). OK

Ningun design quedo mintiendo. No hay reconciliacion pendiente.

## 4. Sin regresiones (verificado)

- Raspado (machos): intacto (raspado = sex male, sin cambio; tests R6.12 verdes).
- Gating por rodeo (capa 1/2): intacto. filterByAnimalApplicability se aplica DESPUES del gating del rodeo (carga.tsx:245-248: gating.filter, luego filterByAnimalApplicability, luego buildSequence). Las dos capas componen, no se pisan.
- Orden/secuencia: buildSequence preserva orden de config; los tests de integracion verifican el orden resultante.
- ManeuverKind/data_keys: NO cambiaron (solo el label es-AR). event-timeline.ts REPRO_LABELS NO tocado (working tree limpio para ese archivo).
- Otras superficies Tacto (event-timeline.ts:758, events.spec.ts, presets en maneuver-reads.test.ts, rodeo-template.test.ts) son FICHA/timeline/nombre-de-preset/description, otras superficies correctamente NO tocadas.

## 5. Robustez del label largo (call-sites auditados)

Todos los call-sites de maneuverLabel que renderizan en una linea visible estan constrenidos (flex=1 + minWidth=0 + numberOfLines=1 + lineHeight matching):
- carga.tsx:502 (linea de maniobra): FIXEADO (label flex/minWidth:0/numberOfLines; contador flexShrink:0). OK
- jornada.tsx:524 (resumen etapa 3): ya constrenido. OK
- ManeuverReorderList.tsx:369 (fila seleccionada) y :453 (pool): ya constrenidos. OK
- AnimalSummary.tsx:75 (resumen por animal): ya constrenido. OK
- carga.tsx:609 (SilentSanitaryStep title) y :671 (PlaceholderStep): tacto_vaquillona NUNCA llega (routea a case vaquillona, TactoVaquillonaStep, dispatcher linea 565). OK
- Resto: aria/accessibilityLabel (no visuales) y maneuver-sequence.ts:216 (string puro). N/A.

Capturas vetadas a 360/412: label elipsa con puntos suspensivos, contador N de M siempre visible, sin overflow, sin recorte de descendentes.

## 6. Tests (ejecutados)

- typecheck cliente (pnpm typecheck): EXIT 0.
- unit maniobras afectadas (applicability/wizard/sequence/step-kind/gating con ts-ext-resolver): 104/104 PASS.
- capture spec label largo: 2/2 (capturas presentes y verificadas visualmente).
- e2e maniobras (reportados por impl, web build real + Supabase live): carga 3/3, sanitaria 8/8, elegir 2/2, tacto-bugfix 3/3, wizard 1/1. Asserts estaticos verificados (label Tacto de prenez, ternera hacia pesaje_ternero, 1 de 1).
- node scripts/check.mjs: RC=1, SOLO el flake conocido animals_tag_unique (23505 duplicate key) en la suite BACKEND supabase/tests/animal/run.cjs (seed concurrente de terminales paralelas, memoria reference_check_red_rate_limit). Este chunk es frontend-puro: no toca schema/backend/migraciones, NO es regresion. Todas las suites de cliente/logica-pura verdes.

## CHECKPOINTS

- [x] C2: estado coherente (una feature in_progress; no se marco nada done).
- [x] C3: arquitectura (logica pura en utils/, labels en utils/maneuver-wizard.ts, render en app/maniobra/; sin fetch en componentes; sin hardcode de establishment_id; sin logs de debug; tokens del DS).
- [x] C4: verificacion real (tests con fixtures reales node:test, mayor a 0 verdes en el modulo).
- [x] C6: SDD (cada R-n tocado tiene al menos 1 test; tasks marcadas; specs reconciliadas).
- [ ] C1 / C5 / C7 / C8: N/A para este chunk (no toca harness base, RLS/multi-tenancy nuevo ni buckets PowerSync). C8: persistencia offline de eventos es de M3.1 done; este chunk solo filtra la SECUENCIA (logica pura cliente, sin red).

## Checklist RAFAQ-especifico

- A (multi-tenancy/RLS): N/A (no toca tablas/RLS/policies).
- B (offline-first): N/A estricto (no agrega carga/edicion nueva; filtra la secuencia client-side, sin requests; persistencia de pasos ya es de M3.1).
- C (BLE): N/A (no toca BLE).
- D (UI de campo / manga rojo):
  - [x] Botones mayor o igual a 60dp (APTA/NO APTA/DIFERIDA full-width gigantes, captura maniobra-line-vaquillona-360.png).
  - [x] Fuente mayor o igual a 18pt (header de identidad y label de maniobra token 5+).
  - [x] Una decision por pantalla (el paso muestra una sola maniobra a la vez).
  - [x] Estado de loading visible (fuera de scope, sin cambio; SWR de 6.bis.7 ya lo cubre).
  - [x] (extra) Recorte de descendentes: lineHeight matching en todo Text tocado; verificado en capturas.
  - [x] (extra) es-AR: labels en espanol, sin afectar formatos de maquina.
- E (Edge Functions): N/A (no toca Edge Functions).

## Cambios requeridos

Ninguno.

## Nota (no bloqueante, para el leader)

- El texto del label de tacto_vaquillona esta marcado como PENDIENTE de decision de Raf (puede acortarse). El mecanismo de unica-fuente (MANEUVER_LABELS + maneuverLabel) es correcto y la linea es robusta a cualquier longitud: un futuro acortamiento es un string en un solo lugar, sin tocar layout ni tests de logica.
- Los archivos del chunk estan untracked en git (toda app/app/maniobra/ y los utils de maniobras viven como working-tree). No es objecion del reviewer: el commit lo hace el leader tras la aprobacion. El codigo existe, compila y se testea.
