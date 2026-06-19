baseline_commit: a03e593406da77096a239f7d54eb262ec1f9098f

# impl_03-m5-custom-bugfix — Bugfix de 2 defectos visuales de la maniobra CUSTOM (M5-CLIENTE)

Feature: `03-modo-maniobras` (in_progress). Chunk: M5-CLIENTE (custom maneuvers, ya en prod).
Frontend PURO. NO se toca backend.

## Los 2 bugs (cazados EN VIVO por Raf)
1. **El título del paso de maniobra custom se RECORTA.** Gotcha recurrente de truncado/lineHeight.
2. **En las listas (enum_single / enum_multi) NO se nota que se puede SCROLLEAR** — el operario cree que
   las opciones visibles son todas.

## Plan (tasks)
- **T1** — Reproducir AMBOS bugs con una maniobra custom de título largo + enum de 8–12 opciones (e2e nuevo,
  captura del estado roto ANTES de arreglar).
- **T2** — Fix bug 1 (título sin recorte): el maneuver line del frame (`carga.tsx`) usa `numberOfLines={1}` →
  elipsa labels largos. Length-aware step-down (patrón `hero-text-size.ts`) + wrap a 2 líneas + lineHeight
  matching (descendentes). Aplicar también al sub-header interno de `EnumMultiSelect` ("Elegí las que
  correspondan", `numberOfLines={1}`) si recorta.
- **T3** — Fix bug 2 (affordance de scroll en enum_single + enum_multi): cuando las opciones exceden el alto,
  dejar CLARO que hay más → fade-gradiente abajo (y arriba si scrolleó) + PEEK (item parcial asomando) +
  contenedor obviamente scrolleable. enum_single hoy NO scrollea (YStack con flexGrow por bloque) → pasarlo a
  ScrollView con affordance.
- **T4** — Test: e2e con capturas 360/412 (web táctil) del título largo completo + la lista con affordance
  visible. Unit del helper de tamaño de título (length-aware) si se extrae.
- **T5** — Verificar `node scripts/check.mjs` (typecheck + anti-hardcode + unit). Autorrevisión adversarial
  mirando las capturas. Reconciliar `design.md §11.6`.

## Baseline del entorno (pre-trabajo)
- anti-hardcode: VERDE (0 violaciones).
- typecheck: ROJO por **debris ajeno** — `app/src/utils/cut-eligibility.ts` (UNTRACKED, `??`, creado hoy por
  otra terminal) tiene un `</content>` pegado al final (artefacto de paste). NO es de mi feature, NO lo
  introduje, NO lo toco (regla de terminales paralelas). Lo documento como pre-existente fuera de scope.
  Verifico MI typecheck contra el resto del árbol filtrando ese único error.
- suite animal: ROJO por colisión de `tag_electronic` entre 2 terminales (flake cross-terminal documentado en
  memoria `reference_check_red_rate_limit`), no regresión.

## Causa raíz de cada bug

### Bug 1 — título recortado
La LÍNEA DE MANIOBRA del frame `carga.tsx` (~631) renderizaba el `label` de la maniobra a `$5` con
`numberOfLines={1}` + `flex/minWidth:0` → un label de maniobra CUSTOM largo ("Ángulo de inclinación de pezuña
posterior", 41 ch) se ELIPSABA a 1 línea silenciosa ("Ángulo de inclinación de pezuña …"). Las de fábrica son
cortas ("Tacto", "Dientes") → el bug nunca se veía con ellas; las custom pueden ser arbitrariamente largas. Es
el gotcha recurrente del repo (`reference_descender_clipping` + truncado de 1 línea).

### Bug 2 — listas sin affordance de scroll
- `enum_single`: era un `YStack` de bloques `flexGrow:1/flexBasis:0` → con muchas opciones los bloques se
  APLASTABAN para entrar todos (NO scrolleaba); peor aún, cuando excedían, simplemente se cortaban en el borde
  sin ninguna señal.
- `enum_multi`: SÍ scrolleaba (ScrollView dentro de la card) pero con `showsVerticalScrollIndicator={false}` y
  SIN ningún fade/peek → un corte limpio en el borde de la card se lee como "esto es todo". + el sub-header
  "Elegí las que correspondan" tenía `numberOfLines={1}` → las descendentes g de "Elegí"/"correspondan" se
  recortaban contra el borde superior de la card.

## Qué cambié (archivos)
- **`app/src/utils/maneuver-title-size.ts`** (NUEVO, puro) + `maneuver-title-size.test.ts` (6 tests):
  `maneuverTitleFontToken` length-aware step-down `$5`/`$4` (>56 ch), lineHeight matching.
- **`app/src/utils/scroll-affordance.ts`** (NUEVO, puro) + `scroll-affordance.test.ts` (6 tests): `scrollFades`
  decide fade top/bottom por geometría del scroll (EPS + defensivo ante medidas no llegadas) + `hasOverflow`.
- **`app/app/maniobra/carga.tsx`**: la línea de maniobra usa `maneuverTitleFontToken` + `numberOfLines={2}` +
  word-break (web) + fila `alignItems="flex-start"` (contador pinneado en la 1ra línea).
- **`app/app/maniobra/_components/CustomManeuverStep.tsx`**: nuevo componente reusable `ScrollAffordanceList`
  (ScrollView + scrollbar + fade-gradiente `expo-linear-gradient` [color = fondo: `$bg`/`$surface`] + chevron ▾
  + PEEK + posicionamiento por tokens `$0`, gradiente `flex:1` dentro de View tokenizada). `EnumSingleBlocks`
  lo usa con `fillHeight` (pocas→bloques gigantes idiom DientesStep / muchas→scrollea con affordance);
  `EnumMultiSelect` lo usa dentro de su card (fade `$surface`) + sub-header `numberOfLines={1}`→`{2}`. El value
  capturado y el `onConfirm` NO se tocaron.
- **`scripts/run-tests.mjs`**: enganché los 2 nuevos test files al client-unit del check.
- **`app/e2e/maniobra-custom-bugfix.spec.ts`** (NUEVO): repro+fix, web TÁCTIL (hasTouch+isMobile).

## Trazabilidad R → test
- **R13.8** (presentación: título completo + lista scrolleable del paso de maniobra custom):
  - `app/src/utils/maneuver-title-size.test.ts` — step-down length-aware del título ($5 normal / $4 muy largo),
    borde del umbral, trim, vacío, lineHeight matching (descendentes).
  - `app/src/utils/scroll-affordance.test.ts` — sin overflow→sin fades; arriba→solo abajo; medio→ambos;
    fondo→solo arriba; EPS; medidas no llegadas (defensivo).
  - `app/e2e/maniobra-custom-bugfix.spec.ts::custom enum_single …` — título largo VISIBLE completo + fade abajo
    en reposo + (al scrollear) fade arriba + sin fade abajo + llega a la última opción.
  - `app/e2e/maniobra-custom-bugfix.spec.ts::custom enum_multi …` — ídem para el multi-select.
  - Regresión: `app/e2e/maniobra-custom-render.spec.ts` (enum_single 3 opciones + numeric) 2/2 → confirma
    pocas-opciones SIN fade espurio (bloques que llenan) + el flujo de captura intacto.

## Autorrevisión adversarial (paso 8)
Busqué activamente, como revisor hostil:
- **¿El título entra completo con descendentes a 360 y 412?** SÍ — `custom-bug-enum-360.png` muestra "Ángulo de
  inclinación de pezuña / posterior" en 2 líneas con g/p/ñ intactos; 412 entra en 1 línea. Counter pinneado.
- **¿Se nota que la lista scrollea a 360 y 412?** SÍ — fade abajo + chevron ▾ visibles en ambas. Verifiqué
  también el caso scrolleado (fade arriba aparece, fade abajo desaparece) — assertion + captura
  `custom-bug-enum-scrolled-412.png`.
- **¿Pocas opciones generan fade falso?** NO — `custom-render-enum-360.png` (3 opciones) sin fade ni chevron,
  bloques gigantes que llenan. `scrollFades` devuelve `{false,false}` sin overflow (testeado).
- **Test que pasa por la razón equivocada (cazado y corregido).** Mi 1ra versión usaba
  `scrollIntoViewIfNeeded` para "scrollear al fondo" → el fade ARRIBA no aparecía: `scrollIntoViewIfNeeded` NO
  mueve de forma fiable el ScrollView de react-native-web (no dispara su `onScroll`), así que el test verificaba
  "llega a la última opción" pero NO que la afordancia reaccionara al scroll real. Lo corregí con
  `scrollListToBottom` (encuentra el contenedor overflow-y + `scrollTop=scrollHeight` + dispatch `scroll`) →
  ahora el test ejerce el path real `onScroll`→recompute→fade. Esto es exactamente el tipo de gotcha
  RN-web de la memoria `reference_rn_web_pitfalls`.
- **¿El value/captura cambió?** NO — sólo layout/render; `onConfirm({kind:'string',value})` /
  `{kind:'multi',value}` idénticos. Confirmado por la regresión `maniobra-custom-render` (oráculo server) verde.
- **Defensivo ante medidas no llegadas** (viewport/content 0/NaN antes del primer layout): `scrollFades`
  trata 0/NaN/negativo como 0 → no inventa fades espurios (testeado).
- **Overlays no bloquean el scroll ni los taps**: todos los fades + chevron son `pointerEvents="none"`.
- **enum_multi fade sobre el fondo correcto**: la lista vive en card `$surface` → fade `$surface` (no `$bg`).
- **boolean / numeric / text / date / numeric_stepped**: no usan listas → intactos (no tocados).

## Captura de evidencia (tests/modo-maniobra/)
- ANTES (estado roto reproducido): `custom-bug-enum-before-{360,412}.png`, `custom-bug-multi-before-{360,412}.png`.
- DESPUÉS (fix): `custom-bug-enum-{360,412}.png`, `custom-bug-multi-{360,412}.png`,
  `custom-bug-enum-scrolled-412.png`.

## Reconciliación de specs
- `design.md` §11.6 — AS-BUILT M5-CUSTOM-BUGFIX (los 2 fixes + verificación).
- `requirements.md` R13.8 — nota de reconciliación (presentación, sin cambio de *qué*).
- `tasks.md` — task `[x] M5-CUSTOM-BUGFIX` con su AS-BUILT.

## Verificación final
- typecheck OK (el debris ajeno `cut-eligibility.ts` lo arregló su terminal dueña — ya no rompe).
- anti-hardcode: 0 violaciones.
- client unit: 1519/1519 (incl. los 2 nuevos suites).
- RLS 22/22, Edge 42/42.
- e2e: `maniobra-custom-bugfix` 2/2, `maniobra-custom-render` (enum/numeric) 2/2, `maniobra-carga` 3/3,
  `maniobra-elegir` 2/2.
- `check.mjs` exit 1 SOLO por la suite backend `animal` (`animals_tag_unique` 23505 = colisión de seed entre 2
  terminales, memoria `reference_check_red_rate_limit`) — NO este bugfix (frontend puro).
- **PROOF de no-regresión**: el e2e `maniobra-custom-render::propiedad custom … ficha` falla TANTO con mis
  cambios como SIN ellos (lo verifiqué stasheando mis 2 archivos tracked + rebuild + run sobre el commit
  `a03e593`). Es un fallo PRE-EXISTENTE del path LWW de `custom_attributes` (editar "Apodo"→"Manchado"), en
  `CustomPropertiesSection.tsx`/`custom-attributes.ts` — archivos SIN imports compartidos con mi trabajo. No es
  mío. (Anoto el cabo para la terminal dueña, no lo toco.)

## NO marco la feature done. Espera reviewer + Gate 2.
