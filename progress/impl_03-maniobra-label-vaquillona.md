baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

# impl 03 — afinado del label es-AR de tacto_vaquillona (sacar "(vaquillonas)")

Feature `03-modo-maniobras` (in_progress). Chunk frontend PURO, sin backend, decidido por Raf.
Continuación del chunk previo (impl_03-maniobra-label-largo): MISMO baseline (feature multi-sesión,
no se sobreescribe el SHA previo a la 1ra task de la feature).

## Contexto / decisión
Raf decidió sacar el sufijo "(vaquillonas)" del label de `tacto_vaquillona`:
- DE: `'Tacto de aptitud reproductiva (vaquillonas)'` (~42 chars)
- A:  `'Tacto de aptitud reproductiva'` (~29 chars)
Motivos: (a) redundante — el header de la carga rápida YA muestra la categoría del animal
("Cría hembras · Vaquillona", verificado en la captura); (b) a 360px el "(vaquillonas)" se
recortaba al final con "…", así que nunca se llegaba a leer completo. El de `tacto` queda en
`'Tacto de preñez'`. El `ManeuverKind` interno y los data_keys NO cambian — solo el label es-AR.

## Plan (tasks)
- [x] T1 — Cambiar el string en `MANEUVER_LABELS['tacto_vaquillona']` (`maneuver-wizard.ts`).
- [x] T2 — Grepear el string viejo en TODO el repo y actualizar asserts/menciones al texto nuevo
  (unit test, capture spec, design.md, requirements.md). Cero referencias al string viejo salvo la
  narrativa "de X a Y" de las notas as-built (intencional).
- [x] T3 — Re-capturar la carga rápida (paso tacto_vaquillona) a 360 y 412 → pisar los PNGs.
- [x] T4 — Reconciliar la mención del label en specs/active/03 (design §6.bis nota as-built + R6.3).

## T1 — cambio del string (DONE)
`app/src/utils/maneuver-wizard.ts:22`: `tacto_vaquillona: 'Tacto de aptitud reproductiva'`.
Línea robusta de `carga.tsx` NO re-tocada (flex+ellipsis + contador flexShrink:0 del chunk previo
quedan tal cual; solo se actualizó el comentario que citaba el ejemplo del label viejo).

## T2 — referencias actualizadas (DONE)
Grep `'(vaquillonas)' / 'aptitud reproductiva (vaquillonas)'` → cada hit clasificado:

| Archivo | Acción |
|---|---|
| `app/src/utils/maneuver-wizard.ts:22` | string del label → **CAMBIADO (T1)** |
| `app/src/utils/maneuver-wizard.test.ts:35` | assert `maneuverLabel('tacto_vaquillona')===` → **actualizado al texto nuevo** |
| `app/app/maniobra/carga.tsx:496` | comentario (ejemplo del label) → actualizado (~29 chars) |
| `app/e2e/captures/maniobra-label-largo.capture.ts` (docstring l.4/11) | comentario → actualizado |
| `specs/active/03-modo-maniobras/design.md` §6.bis (nota AS-BUILT línea robusta) | actualizado + **nota nueva** del afinado (T4) |
| `specs/active/03-modo-maniobras/requirements.md` R6.3 reconciliación | actualizado + nota del afinado (T4) |
| `progress/impl_03-bugfix-aplicabilidad.md`, `impl_03-maniobra-label-largo.md` | NO tocados — reportes HISTÓRICOS de chunks CERRADOS; describen lo que fue verdad en su momento (no son asserts ni specs). Reescribirlos falsificaría el registro. |
| `progress/current.md` | NO tocado — estado de sesión leader-owned (regla terminales paralelas). |
| `app/app/maniobra/_components/TactoVaquillonaStep.tsx:3`, `carga.tsx:566` | NO tocados — describen la semántica del paso ("aptitud reproductiva de una vaquillona"), NO el label string. |

NINGÚN test/spec/código de la app asserta el string viejo (verificado con re-grep).

## T3 — re-captura (DONE)
Rebuild del bundle web (`pnpm run e2e:build`, exit 0) → la capture spec corre contra el bundle nuevo.
`pnpm exec playwright test e2e/captures/maniobra-label-largo.capture.ts --config playwright.capture.config.ts`
→ **2/2 passed** (@360 y @412, context `hasTouch:true`+`isMobile:true`). PNGs pisados (timestamps frescos).

Veto visual de la LÍNEA DE MANIOBRA con el label nuevo:
- **@412**: "Tacto de aptitud reproductiva" entra COMPLETO (sin "…"); contador "· 1 de 2" visible.
- **@360**: "Tacto de aptitud reproductiva" entra COMPLETO (sin "…"); contador "· 1 de 2" visible.
  → Mejora real vs el label viejo (que elipsaba a 360). El header muestra "Cría hembras · Vaquillona"
  → confirma que la categoría ya está visible (redundancia del "(vaquillonas)" que se sacó).
- Wizard etapa 2 @360: la fila seleccionada "Tacto de aptitud reprod…" elipsa (contenedor más angosto
  por badge+check+grip — esperado, ya constreñido del chunk previo, sin empujar el grip).
La robustez de la línea (flex+ellipsis, contador flexShrink:0) quedó INTACTA — solo verificada.

## T4 — reconciliación de specs (DONE)
- `design.md` §6.bis: la nota AS-BUILT de "línea robusta a labels largos" se actualizó (label más largo
  = "Tacto de aptitud reproductiva", ~29 chars) y se agregó una nota AS-BUILT NUEVA del afinado del
  label (de "…(vaquillonas)" a "…", motivos, fit 360/412).
- `requirements.md` R6.3: la nota de reconciliación as-built (b) Label es-AR ahora dice el label final
  "Tacto de aptitud reproductiva" + nota del afinado 2026-06-16. El EARS de R6.3 (resultado apta/no_apta/
  diferida) NO cambia — solo el label de UI.

## Autorrevisión adversarial (paso 8)
- ¿Quedó algún assert/mención apuntando al string viejo en código/tests/specs? → re-grep: NO (solo la
  narrativa "de X a Y" en notas as-built, que es correcta — describe la transición).
- ¿La línea de maniobra sigue robusta? → SÍ, no la toqué; verificada en captura (label completo + contador
  visible a ambos anchos). El label más corto NO reabre el riesgo de overflow.
- ¿El header realmente muestra la categoría (justifica sacar "(vaquillonas)")? → SÍ: la captura muestra
  "Cría hembras · Vaquillona" sobre la línea de maniobra. La redundancia era real.
- ¿Otras superficies con el label (wizard etapa 2/3, resumen por animal)? → renderizan el label nuevo,
  más corto → si el label viejo no overfloweaba ahí (auditoría del chunk previo), el nuevo tampoco.
- ¿es-AR / cero hardcode? → el label es es-AR; sigue centralizado en `MANEUVER_LABELS` (única fuente),
  cero hardcode en pantallas.
- ¿Multi-tenant / offline-first? → N/A (cambio de copy de un mapa estático; no toca datos ni red).

## Verificación
- `node scripts/check.mjs` → RC=1 **= flake conocido** `animals_tag_unique` (23505 duplicate key) en la
  suite BACKEND `animal` por terminales paralelas sembrando concurrentemente (memoria
  `reference_check_red_rate_limit` + brief). NO es regresión: este chunk es frontend puro (label string)
  y no toca schema/backend ni la suite animal. Lo verde antes del FAIL: typecheck client (`tsc --noEmit`
  OK) + client unit suite arrancó.
- Unit (resolver del proyecto, `--import ./scripts/ts-ext-resolver.mjs`): `maneuver-wizard` +
  `maneuver-sequence` + `maneuver-step-kind` + `maneuver-applicability` + `maneuver-gating` +
  `maneuver-config` → **132/132 pass** (incl. el assert nuevo
  `maneuverLabel('tacto_vaquillona')==='Tacto de aptitud reproductiva'`).
- e2e:build (`expo export -p web`) → exit 0.
- Capture spec `maniobra-label-largo.capture.ts` (`playwright.capture.config.ts`) → **2/2 passed**
  (@360 + @412), context `hasTouch:true`+`isMobile:true`.

## Capturas (paths absolutos)
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\maniobra-line-vaquillona-360.png` — línea de maniobra @360:
  label "Tacto de aptitud reproductiva" COMPLETO (sin "…") + contador "· 1 de 2" VISIBLE.
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\maniobra-line-vaquillona-412.png` — @412: idem, label completo
  + contador "· 1 de 2" visible.
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\wizard-vaquillona-360.png` — lista del wizard (etapa 2) @360:
  fila seleccionada "Tacto de aptitud reprod…" (contenedor angosto por badge/check/grip) + grip visible.
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\wizard-vaquillona-412.png` — idem @412.

## Resultado del veto (auto)
PASA la autorrevisión: a 360 y 412 el label nuevo "Tacto de aptitud reproductiva" entra COMPLETO en la
línea de maniobra (mejora vs el viejo, que elipsaba a 360) y el contador "· 1 de 2" queda visible. Cero
referencias al string viejo en código/tests/specs. Pendiente: reviewer + Gate 2.
