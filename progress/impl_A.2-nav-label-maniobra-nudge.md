baseline_commit: 9f1803740290cf5a28374738612ba5eb69238d53

# A.2 — Bottom nav: bajar ~4px el label "Maniobra" del FAB central

> Ajuste de diseño incremental, NO una feature con spec (misma naturaleza que A.1 / B.0 /
> A.2 inc. 1-3). Modo colaborativo: SOLO el `<Text>` "Maniobra" del componente `ManiobraFab`
> en `app/app/(tabs)/_layout.tsx`. NO backend, NO otras pantallas, NO el FAB / halo / ⚡ /
> otros labels.
> Verificación = typecheck + check.mjs + expo export -p web (precedente A.1/B.0/inc.1-3: no
> hay runner de tests unitarios de UI en `app/`; la verificación de UI es la captura CDP).

## Plan

- [x] T1 — Bajar el label "Maniobra" ~4px: `bottom="$1"` (+2px) → `-$1` (-2px), expresado como
      token negativo del design system (no px literal, ADR-023 §4).
- [x] T2 — Verificación: typecheck + check.mjs + expo export web (dist/ regenerado) + captura
      CDP a 412px confirmando que el label NO se corta.

## Estado: COMPLETO

typecheck verde · check.mjs verde · expo export -p web OK (dist/ regenerado in-place) ·
render verificado headless a 412px (label no clipeado, sin overflow horizontal).

---

## Cambio (T1)

`app/app/(tabs)/_layout.tsx`, componente `ManiobraFab`, único `<Text>` "Maniobra":

- **Antes:** `bottom="$1"` → space token `$1` = **+2px**.
- **Después:** `bottom={LABEL_BOTTOM}` con `const LABEL_BOTTOM = -getTokenValue('$1', 'space')`
  → **-2px**. Delta = el label baja **4px** exactos respecto del +2px previo.

### Por qué `getTokenValue('$1','space')` negado y no el string `"-$1"`

La consigna pedía `bottom="-$1"` (token negativo de Tamagui). El runtime de Tamagui 2.0.0 SÍ
soporta la sintaxis negativa, pero los **tipos** generados para la prop `bottom` no aceptan el
string `"-$1"` (`TS2322: Type '"-$1"' is not assignable...`). Para no romper el typecheck Y no
introducir un px literal (ADR-023 §4), se LEE el token `$1` del grupo `space` con `getTokenValue`
y se niega en runtime — mismo patrón que ya usa `navColors()` en este archivo para cruzar valores
del design system a props computadas. Sigue siendo **referencia al design token**, no literal.

Runtime verificado: `getTokenValue('$1','space')` ⇒ `2` (number) ⇒ `LABEL_BOTTOM = -2`.

Sin tocar: color `$textPrimary`, `fontWeight="600"`, `fontSize="$2"` (=12), `zIndex={10}`, el FAB,
el halo, el ⚡, ni los otros 4 labels.

## Verificación visual (T2) — captura CDP a 412px

Método: headless Edge + CDP `Emulation.setDeviceMetricsOverride` (412×915, DPR 2, mobile),
sobre el static server ya levantado en `:8137` (sirviendo el bundle recién regenerado
`entry-700404b9...`). Medición de geometría real:

- `viewport = 412×915`; `docScrollW == docClientW == 412` → **sin overflow horizontal**.
- Label "Maniobra": `bottom = 905px` (alto 20px), centrado horizontalmente (left 179 / right 233).
- Nav bar: `bottom = 903px`, alto 59px.
- El label termina a **905px**, dejando **10px** hasta el borde inferior del viewport (915) →
  **NO se corta** ni se sale de la pantalla. Cae dentro del `paddingBottom` mínimo del nav
  (`max(insets,12)` = 12 en web). En device el inset (~34px) da aún más holgura.
- Inspección visual del PNG: "Maniobra" se lee completo (con descendentes), en la misma línea
  base que Inicio/Animales/Reportes/Más; FAB + halo + ⚡ + los 5 ítems intactos.

(Artefactos CDP throwaway — `.cdp-shot.mjs`, `.shot-412.png`, `.cdp-profile/` — borrados tras la
captura. No se mató ningún proceso; `dist/` se regeneró via dir temporal `.dist-tmp` + mirror
in-place con robocopy por EBUSY del server `:8137`, luego se borró el temp.)

## Trazabilidad

No hay `requirements.md` para este ajuste (no es feature con spec — es iteración de diseño del nav
shell, ADR-018/ADR-023). El requisito operativo único ("bajar ~4px sin cortar el label a 412px")
queda verificado por la medición CDP de arriba: label bottom 905px < viewport 915px, 10px de
margen, sin clip. No hay tests unitarios de UI en `app/` (precedente A.1/B.0/inc.1-3).

## Las 3 verificaciones de gate

1. `cd app && pnpm.cmd typecheck` → **verde** (`tsc --noEmit`, sin errores).
2. `node scripts/check.mjs` (raíz) → **verde** (RLS 15/15, Edge 26/26, animal 19/19; único WARN
   pre-existente = `current.md` inflado, ajeno a este cambio).
3. `cd app && pnpm.cmd exec expo export -p web` → **OK**, `dist/` regenerado in-place
   (bundle `entry-700404b9a70b3486b9e9af8cdab82b6c.js`; `index.html` lo referencia; bundle stale
   anterior eliminado).
