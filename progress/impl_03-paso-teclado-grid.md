# impl — spec 03 M2.0 (design spike): fix de grilla del teclado en paso.tsx

baseline_commit: 6308ff5c1e806a007144d9b244a667767d0f735f

Fix de diseño ACOTADO sobre el design spike M2.0 de MODO MANIOBRAS. SOLO se toca
`app/app/maniobra/paso.tsx` (pantalla de pesaje / teclado numérico). `carga.tsx` NO se toca (ya
vetado). Sigue siendo MOCK-PURO (sin servicios/BLE/PowerSync/persistencia).

> No hay `specs/active/<feature>` propia para este micro-fix (es ajuste de diseño directo sobre un
> spike visual ya existente, no una feature SDD nueva). No hay superficie de seguridad (sin DB, sin
> RPC, sin tenant): Gate 2 N/A. Trazabilidad R<n> N/A — el criterio es visual (grilla simétrica +
> bordes) y se prueba con medición Pillow sobre el PNG recapturado.

## Bug (confirmado por el leader con Pillow, re-medido por mí antes de tocar)

El teclado numérico NO era una grilla 3×4 simétrica. Medición sobre el render previo
(`design/maniobra-spike/paso.png`, 412×915):

| fila | centros de columna (x) | anchos de celda (px) |
|---|---|---|
| row1 (1/2/3) | 75.0 / 201.5 / 332.0 | 115 / 124 / 123 |
| row2 (4/5/6) | 78.5 / 206.0 / 333.0 | 122 / 119 / 121 |
| row3 (7/8/9) | 77.0 / 204.5 / 333.0 | 119 / 122 / 121 |
| **row4 (./0/⌫)** | **69.5 / 187.0 / 323.0** | **104 / 117 / 141** |

La fila 4 rompía la grilla: el `⌫` estiraba su celda a 141px (el glifo del ícono `Delete` tiene
ancho intrínseco ~43px) y le robaba ancho al `.` (104px) y al `0`, desplazando el `0` de ~204 a
187. Causa: `flex={1}` sin `flexBasis=0` reparte el espacio SOBRANTE (después del contenido), no el
total → una celda con contenido más ancho (el ícono) termina más grande. Es el mismo problema que
ataca ADR-027 (decoración asimétrica que descentra), pero acá sobre una grilla de celdas iguales.

## Plan (T1..T3)

- T1: forzar 12 celdas idénticas (flexBasis=0 + minWidth=0 + overflow=hidden) → centros de columna
  alineados en las 4 filas. Ícono ⌫ centrado DENTRO de su celda de ancho fijo (sin estirarla).
- T2: bordes nítidos en las teclas (contraste a pleno sol) con tokens del DS (cero hardcode).
- T3: recapturar PNG con el spec Playwright + medir con Pillow (autorrevisión). Verde de typecheck +
  lint anti-hardcode.

## Implementación (lo que cambió en `paso.tsx`)

T1 — simetría de la grilla. Cada celda del teclado pasó de `flex={1}` a:
`flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0} overflow="hidden"`.
- `flexBasis={0}` + `minWidth={0}` → las 3 celdas crecen desde cero por igual repartiendo el ancho
  TOTAL de la fila (no el sobrante tras el contenido). Sin esto, react-native-web reparte el espacio
  remanente y la celda del ⌫ (ícono con ancho intrínseco) se quedaba con más.
- `overflow="hidden"` → el ícono/glifo no puede empujar la celda hacia afuera.
- El ⌫ (`Delete` size=$icon) queda CENTRADO dentro de su celda de ancho fijo por el
  `alignItems/justifyContent="center"` ya presente. La celda NO crece con el ícono.

T2 — bordes nítidos. `borderWidth={1}→{2}` y `borderColor="$divider"→"$textFaint"`. Tokens del DS,
cero hardcode. Razón (contraste medido vs $bg / $surface):
- `$divider` (#E5E5E3): 1.2 vs $bg → invisible al sol (era el bug de contraste).
- `$textFaint` (#807A74): 4.03 vs $bg, 3.92 vs $surface → AA non-text (≥3:1), borde claramente
  definido sin leerse como "activo" (eso sería $primary, 7.5) ni pesado (textMuted, 5.6).
- Fill $surface (bone) se mantiene para el figura-fondo cálido; aporta poco contraste solo (1.03 vs
  $bg), por eso el borde hace el trabajo.

## Captura recapturada (412×915) → `design/maniobra-spike/paso.png`

`pnpm e2e:build && pnpm exec playwright test e2e/maniobra-spike.spec.ts -g "PESAJE"` → **1 passed**.
Densidad medida por el spec: **87.0% del alto útil** (action-zone teclado+CTA border-to-border,
R12.5 ≥60%, mantiene la densidad previa ~87%). (La línea `Assertion failed ... uv async.c` al final
es ruido de teardown de libuv en Windows, no un fallo — el test reporta 1 passed.)

## Autorrevisión adversarial (paso 8) — MEDIDA con Pillow sobre el PNG recapturado

Centros de columna por fila (x), medidos border-to-border de cada celda:

| fila | col0 | col1 | col2 | anchos |
|---|---|---|---|---|
| row1 (1/2/3) | 78.0 | 205.5 | 333.0 | 121/120/121 |
| row2 (4/5/6) | 78.0 | 205.5 | 333.0 | 121/120/121 |
| row3 (7/8/9) | 78.0 | 205.5 | 333.0 | 121/120/121 |
| row4 (./0/⌫) | 78.0 | 205.5 | 333.0 | 121/120/121 |

**Spread por columna = 0.0px** en las 3 columnas (tolerancia ±3px → cumple con margen total). Los 12
anchos de celda son idénticos. El ⌫ (row4·col2) quedó en 333.0 / 121px, EXACTO bajo el 3/6/9 — ya
no estira su celda (antes: 141px @ x=323). El `0` volvió a x=205.5 (antes 187), el `.` a x=78.0
(antes 69.5). Grilla 3×4 perfectamente simétrica. ✔

Otros checks adversariales:
- **Recorte de descendentes**: no toqué ningún Text. La línea "Pesaje" (g+j) y el resto conservan
  `lineHeight` matching (`$5`/`$9`/`$10`); las teclas son dígitos (sin descendentes). PNG: sin clip. ✔
- **Lint anti-hardcode**: `node scripts/check-hardcode.mjs` → 0 violaciones. `flexBasis={0}`/`minWidth={0}`
  son layout numérico estructural (0 = sin base), no color/spacing hardcodeado; `borderWidth={2}` es
  el patrón ya usado por los estados activos del repo. Bordes vía token `$textFaint`. ✔
- **typecheck**: `pnpm typecheck` (tsc --noEmit) → exit 0. ✔
- **Mock-puro**: imports = react / react-native / safe-area / tamagui / lucide / SpikeIdentityHeader
  local. CERO services/BLE/PowerSync/supabase/auth. `peso` es `useState` efímero, no persiste. ✔
- **Scope**: SOLO `app/app/maniobra/paso.tsx` (+ el PNG recapturado). `carga.tsx` NO tocado. El dir
  `app/app/maniobra/` es untracked (spike no commiteado) → mi cambio no contamina código trackeado. ✔
- **Safe-area inferior**: el CTA conserva `paddingBottom={Math.max(insets.bottom, $navBottomMin)}`.
  Medido: 12px bajo el botón (web preview tiene insets.bottom=0 → cae al mínimo navBottomMin=12). En
  device con barra de gestos, insets.bottom>12 gana. No queda bajo la barra. ✔
- **¿Test por la razón equivocada?** El spec Playwright recorre la ruta real `/maniobra/paso`, ancla
  en teclas reales (1, 0) + display + CTA, captura el DOM montado y mide los `data-testid="action-zone"`
  reales (no el texto). La medición de simetría la hago aparte con Pillow sobre ese PNG → no es un
  falso verde. ✔

## Reconciliación de specs

No hay `specs/active/<feature>` propia para este micro-fix (ajuste de diseño sobre un spike visual
mock ya existente, no feature SDD). El spike `paso.tsx` no está en git (untracked). Actualicé el
comentario de cabecera y el comentario del bloque del teclado en `paso.tsx` para reflejar el as-built
(grilla simétrica con flexBasis:0 + bordes $textFaint). No hay requirements/design/tasks que
reconciliar. Gate 2 N/A (sin superficie de seguridad: sin DB/RPC/tenant).

---

# ITERACIÓN 2 — peso dominante + coma decimal es-AR (design spike, mock-puro)

Iteración de diseño ACOTADA, MISMO scope (solo `paso.tsx`) + un token nuevo de tipografía en
`tamagui.config.ts` (requerido por el pedido — NO hardcode). `carga.tsx` NO se toca. Mock-puro.
Mismo `baseline_commit` (6308ff5…) — feature multi-sesión, no se sobreescribe. Gate 2 N/A.

## Cambios pedidos (3) y cómo quedaron

1. **Peso DOMINANTE (Cash App).** La escala de la fuente Inter llegaba a `$10`=38px, que ya usan las
   teclas → no alcanzaba para que el peso dominara. Agregué un token nuevo a `tamagui.config.ts`:
   `size.11 = 64` + `lineHeight.11 = 72` en la fuente `interFont` (hero number / monto dominante,
   JIT, comentado). El display del peso pasó de `fontSize="$10"` a `fontSize="$11"` (`lineHeight="$11"`
   matching). El "kg" queda como sufijo `$7` al lado. **Token NUEVO agregado** (avisado).
2. **Separador decimal = coma (es-AR).** Tecla abajo-izquierda `.` → `,` (KEY_ROWS). Constante
   `DECIMAL_SEP=','` (único lugar del glifo). `pressKey` usa `DECIMAL_SEP` (una sola coma; límite de
   largo cuenta solo dígitos). Display formateado con `formatPesoAR()`: separa entera/decimal por la
   coma, formatea la entera con `toLocaleString('es-AR')` (punto de miles) y reconcatena el decimal
   preservando el tipeo en curso. NO es concatenación cruda. "385"→"385", "1050"→"1.050".
3. **Bordes + grilla 3×4 INTACTOS.** No toqué el bloque del teclado (flexBasis:0 + minWidth:0 +
   borderWidth:2 + borderColor `$textFaint`). Verificado por medición (abajo).

## Autorrevisión adversarial (paso 8) — MEDIDA

- **PNG recapturado** (412×915) → `design/maniobra-spike/paso.png` (sobreescrito). Test Playwright
  `-g "PESAJE"` → **1 passed**, densidad **83.8%** del alto útil (R12.5 ≥60%). (`Assertion failed
  ... async.c` = ruido de teardown libuv Windows, no fallo.)
- **Grilla 3×4 SIMÉTRICA (Pillow).** Centros de columna en las 4 filas: col0=77, col1=205, col2=332,
  **spread 0px** en las 3 columnas (tolerancia ±3px → cumple con margen total). NO rompí la simetría
  de la iter-1. Bordes de celda (`$textFaint` #807A74) detectados en las 4 filas → bordes intactos.
- **Peso DOMINA (Pillow).** Alto de glifo del número del peso = 89px vs 27px de un dígito del teclado
  → **ratio 3.30x**. Es el elemento más grande de la pantalla. ✔
- **Coma confirmada (PNG visual).** La tecla abajo-izquierda muestra `,`. El display "385 kg" con el
  385 gigante. ✔
- **Formato es-AR (test unitario, 8/8).** `formatPesoAR` validado: "385"→"385", "1050"→"1.050",
  "1050,5"→"1.050,5", "1050,"→"1.050," (coma en curso preservada), ""→"0", ",5"→"0,5". La parte
  entera pasa por `toLocaleString('es-AR')` (Intl), no concatenación. `Number.isFinite` con fallback
  defensivo. ✔
- **Descendentes OK.** Peso: `lineHeight="$11"` (72) matching `fontSize="$11"` (64). La coma `,` en la
  tecla usa `$10`/`$10` matching. Header/línea de maniobra sin cambios. PNG sin clip. ✔
- **Lint anti-hardcode VERDE** (`scripts/check-hardcode.mjs` → 0 violaciones). El token nuevo vive en
  `tamagui.config.ts` (única fuente literal de px); la pantalla lo consume como `$11`. ✔
- **typecheck VERDE** (`pnpm typecheck` → exit 0). El token `11` es aditivo en size+lineHeight de la
  fuente; no modifica valores existentes; el tipado de tokens lo acepta. ✔
- **Mock-puro / scope.** Imports sin cambios (react/react-native/safe-area/tamagui/lucide/header
  local). `peso` = `useState` efímero. Toqué SOLO `paso.tsx` + `tamagui.config.ts` (token requerido) +
  el PNG. `carga.tsx` NO tocado. ✔
- **¿Token rompe otra pantalla?** Es puramente aditivo (`11:` nuevo en ambas escalas de `interFont`);
  ninguna pantalla existente referencia `$11` todavía. typecheck + check.mjs verdes lo confirman. ✔
