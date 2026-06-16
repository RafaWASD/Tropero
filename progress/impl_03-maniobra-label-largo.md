baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

# impl 03 — robustez de la LÍNEA DE MANIOBRA a labels largos (tacto_vaquillona)

Feature `03-modo-maniobras` (in_progress). Iteración de VETO del leader (frontend puro, 🔴 manga).
No toca lógica de aplicabilidad ni data_keys: solo layout/robustez de render.

## Contexto
El label de `tacto_vaquillona` se renombró a **"Tacto de aptitud reproductiva (vaquillonas)"** (~42 chars),
mucho más largo que cualquier label previo. Riesgo: superficies que renderizan `maneuverLabel(...)` en una
línea de ancho NO constreñido pueden overflowear horizontal o empujar contenido vecino fuera de pantalla
a 360px. Caso crítico: la LÍNEA DE MANIOBRA de `carga.tsx` (label + contador "· N de M").

## Plan (tasks)
- [x] T1 — Hacer robusta la LÍNEA DE MANIOBRA de `carga.tsx` (~497-503): label `<Text>` = `flex={1}` +
  `minWidth={0}` + `numberOfLines={1}` (elipsa con "…"); contador "· N de M" = `flexShrink={0}` (nunca se
  recorta). lineHeight matching + tokens existentes, cero hardcode.
- [x] T2 — Auditar las OTRAS superficies que renderizan `maneuverLabel(...)` en una sola línea constreñida;
  aplicar el mismo patrón SOLO si overflowean con el label largo.
- [x] T3 — Capturas para el veto del leader (360 y 412, context mobile + hasTouch): lista del wizard con
  tacto_vaquillona elegida + carga rápida en el paso tacto_vaquillona (línea de maniobra).

## T1 — fix de la línea de maniobra (DONE)
`app/app/maniobra/carga.tsx` ~497-503:
- Label: agregado `flex={1}` + `minWidth={0}` (en RN-web `numberOfLines={1}` NO elipsa sin ancho constreñido
  porque el default `flexShrink:0` deja overflowear/empujar) → ahora elipsa con "…".
- Contador "· N de M": agregado `flexShrink={0}` → nunca se recorta, siempre visible.
- lineHeight matching `$5` preservado (descenders); tokens existentes (sin hardcode); es-AR intacto.

## T2 — auditoría de los OTROS call-sites de maneuverLabel( (DONE)
Grep de `maneuverLabel(` → cada call-site clasificado. Solo el de carga.tsx:497 necesitaba fix; el resto
ya está constreñido o nunca recibe el label largo:

| Call-site | Render | Veredicto |
|---|---|---|
| `carga.tsx:498` (línea de maniobra) | una línea, label + contador | **FIXEADO (T1)** — era el riesgo real |
| `carga.tsx:604` (`SilentSanitaryStep title=`) | título del paso silent | NO TOCAR — tacto_vaquillona NUNCA llega acá (routea a `vaquillona`→`TactoVaquillonaStep`); los títulos de ese paso son cortos (Antiparasitario/Antibiótico/Inseminación) |
| `carga.tsx:666` (`PlaceholderStep`) | label del skip default | NO TOCAR — con M3 completo las 12 maniobras renderizan; el `default` no se alcanza para tacto_vaquillona |
| `jornada.tsx:525` (wizard etapa 3, resumen) | dentro de `<YStack flex={1} minWidth={0}>` + `numberOfLines={1}` | YA CONSTREÑIDO → NO TOCAR |
| `ManeuverReorderList.tsx:369` (etapa 2, fila seleccionada) | dentro de `<YStack flex={1} minWidth={0}>` + `numberOfLines={1}` | YA CONSTREÑIDO → NO TOCAR |
| `ManeuverReorderList.tsx:453` (etapa 2, pool row) | `flex={1} minWidth={0} numberOfLines={1}` | YA CONSTREÑIDO → NO TOCAR |
| `AnimalSummary.tsx:75` (resumen por animal, vía `summaryRows`→`label`) | dentro de `<YStack flex={1} minWidth={0}>` + `numberOfLines={1}` | YA CONSTREÑIDO → NO TOCAR |
| `ManeuverReorderList.tsx:324/325/348/349/354/355/401/402/432/435` | strings de `aria-label`/`accessibilityLabel` | N/A (no se renderizan visualmente) |
| `maneuver-sequence.ts:216` | construye `SummaryRow.label` (puro) | N/A (no es render) |
| `maneuver-wizard.test.ts:35` | test del label | N/A |

## T3 — capturas (DONE)
Spec de captura nueva `app/e2e/captures/maniobra-label-largo.capture.ts` (patrón de
`maniobra-exit-hero.capture.ts`: `browser.newContext` con `hasTouch:true`+`isMobile:true`+viewport por
ancho). Setup espejado de `maniobra-elegir.spec.ts` (rodeo "Cría hembras" → 0018 habilita tacto_vaquillona;
hembra vaquillona con EID → bastonazo del MockAdapter bajo `__RAFAQ_BLE_E2E__`). tacto_vaquillona + pesaje →
secuencia de 2 pasos → la línea muestra "· 1 de 2" (el contador importa).

Paths (absolutos): ver sección final.

## Autorrevisión adversarial (paso 8)
- A 360px: la línea de maniobra con el label largo elipsa ("Tacto de aptitud reproductiva (vaqui…") y el
  contador "· 1 de 2" queda visible (verificado en captura `maniobra-line-vaquillona-360.png`).
- A 412px: idem; con más ancho entra más del label antes de elipsar. Contador visible.
- Lista del wizard (etapa 2): el label largo ya estaba en `<YStack flex={1} minWidth={0}>` + numberOfLines
  → elipsa en la fila sin empujar el chevron/grip (verificado en `wizard-vaquillona-{360,412}.png`).
- No quedó ninguna superficie que renderice el label largo en una línea no constreñida (auditoría T2).

## Reconciliación de specs
`design.md` — nota chica de as-built: la línea de maniobra de la carga rápida es robusta a labels largos
(label elipsa `flex/minWidth:0`, contador `flexShrink:0` siempre visible). Sin cambio de comportamiento ni
contrato → no toca requirements EARS.

## Verificación
- `npx tsc --noEmit` (app) → **exit 0**.
- Unit (resolver del proyecto): `maneuver-wizard` + `maneuver-sequence` + `maneuver-step-kind` → **58/58 pass**
  (incl. `maneuverLabel('tacto_vaquillona')==='Tacto de aptitud reproductiva (vaquillonas)'`; el fix es
  layout-only, no afecta asserts).
- `node scripts/check.mjs` → RC=1 **= flake conocido** `animals_tag_unique` (duplicate key) en la suite
  BACKEND `animal` por terminales paralelas sembrando concurrentemente (memoria
  `reference_check_red_rate_limit` + current.md). NO es regresión: este chunk es frontend puro (no toca
  schema/backend ni la suite animal).
- e2e:build (`expo export -p web`) → exit 0.
- Capture spec `e2e/captures/maniobra-label-largo.capture.ts` (config `playwright.capture.config.ts`) →
  **2/2 passed** (@360px y @412px), context `hasTouch:true`+`isMobile:true`.

## Capturas (paths absolutos)
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\maniobra-line-vaquillona-360.png` — línea de maniobra @360:
  label "Tacto de aptitud reproductiva (v…" ELIPSADO + contador "· 1 de 2" VISIBLE, sin overflow.
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\maniobra-line-vaquillona-412.png` — @412: entra más label
  ("…(vaquillon…") + contador "· 1 de 2" visible.
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\wizard-vaquillona-360.png` — lista del wizard (etapa 2) @360:
  fila seleccionada "Tacto de aptitud reprod…" elipsa (ya constreñida) + check/badge/grip visibles.
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\wizard-vaquillona-412.png` — idem @412.

## Resultado del veto (auto)
PASA la autorrevisión: a 360 y 412 NINGUNA superficie overflowea con el label largo y el contador
"· N de M" queda SIEMPRE visible (el label elipsa con "…"). Pendiente: veto del leader + reviewer + Gate 2.
