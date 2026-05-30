# impl — dropdown del switch de establecimiento (frontend, spec 01 R6.8.1 + R6.9)

baseline_commit: a80342d40f63da8c9e96497f5a52352cf77280e7

> Tarea de **frontend de diseño** (track ADR-023, componentes = deliverable), NO el
> pipeline SDD de la feature 01 (que sigue `deferred`: backend done, frontend pausado).
> Mismo régimen con que se construyeron la home + la `EstablishmentCard` + la pantalla
> "Mis campos". No marca la feature como `done`. Continúa el track de la home
> (`impl_A.1-home-increment-1.md` / `impl_A.2-home-increment-*.md`): hace funcional el
> switch ESTÁTICO del header (incremento 1) → dropdown inline (R6.8.1). NO toca backend.

## Plan (T1..T5)

- [x] **T1** — Componente reusable `EstablishmentSwitcherDropdown` (popover anclado +
  backdrop `Pressable` que cierra al tocar afuera). Anatomía R6.8.1.
- [x] **T2** — Cableado del switch del header de la home (`app/app/(tabs)/index.tsx`).
- [x] **T3** — Lógica pura `pickVisited` (activo excluido + recorte a 2 + <3 campos) +
  verificación (5/5).
- [x] **T4** — Token JIT `size.dropdownWidth` (280).
- [x] **T5** — `node scripts/check.mjs` verde + render fiel CDP con el dropdown ABIERTO.

## Qué se construyó

### Componente nuevo — `app/src/components/EstablishmentSwitcherDropdown.tsx`
Dropdown inline del switch de establecimiento (R6.8.1), reusable (ADR-023, componentes =
deliverable). Exporta `EstablishmentSwitcherDropdown`, `pickVisited`, y los tipos
`EstablishmentSwitcherDropdownProps` / `SwitcherField` (barrel en `components/index.ts`).

**Primitivo del popover**: **overlay absoluto (`StyleSheet.absoluteFill`) + `Pressable`
de backdrop** que cierra al tocar afuera, con la card del menú anclada arriba-izquierda
JUSTO bajo el header (`top = anchorTop`, computado en la pantalla con la safe-area). Se
eligió sobre `Tamagui Popover/Adapt` porque la home es una pantalla hand-crafted con
control total de layout (ADR-023): el overlay+backdrop es el primitivo más predecible,
sin deps extra, que se siente nativo (modelo mental Jakob: overflow-menu / account-switcher
de iOS/Android/MP) y cierra al tocar afuera **o con ESC** (web, `onKeyDown` del backdrop).

**Anatomía (orden EXACTO R6.8.1)**, cada fila target ≥ `$touchMin` (56px, manga-friendly):
1. Campo **activo** — diferenciado (contenedor `$greenLight` + check `$primary` + "● activo").
   Tap = sólo cierra (`onSelectActive` + `onClose`).
2. **Últimos 2 visitados** distintos del activo (ícono `Building2`). Tap = fija activo +
   navega a su home + cierra.
3. **Divider** `$divider` — separa los campos (arriba) de las acciones (abajo).
4. **"Ver todos mis campos"** (`LayoutGrid`) → `router.push('/mis-campos')`.
5. **"Crear nuevo campo"** (`Plus`, en `$primary`) → STUB (flujo de alta R3.1).

### Pantalla cableada — `app/app/(tabs)/index.tsx`
El switch ESTÁTICO del incremento 1 ahora es funcional: estado `switcherOpen` (toggle),
`activeField` (mock que cambia al elegir un visitado → el label del switch se actualiza),
`headerBottom` medido con `onLayout` para anclar el dropdown, chevron que **rota 180°**
abierto (feedback de estado, Nielsen #1), `aria-expanded` para a11y. Mock R6.9 coherente
con "Mis campos": activo **La Juanita**; recientes **El Ombú** + **Bella Vista**.
`pickVisited(RECENT_FIELDS, activeField.id)` da los 2 visitados.

## Tokens nuevos

- **`app/tamagui.config.ts` → `size.dropdownWidth` (280)** — JIT, ancho de la card del
  menú. `maxWidth:100%` lo recorta en pantallas angostas. Único token nuevo; **0 literales**
  de color/spacing en el componente ni en la pantalla (lint anti-hardcode verde).

## Qué quedó MOCK / STUB

- **Mock data del switch** (`ACTIVE_FIELD` + `RECENT_FIELDS`): en prod vienen del **contexto
  multi-tenant** (`establishment_id` activo + `last_establishment_opened` R6.9), **NUNCA
  hardcodeados** (CLAUDE.md ppio 6).
- **`onSelectVisited`**: actualiza el label del switch (mock). El cambio real de contexto
  (R6.3) + persistencia de `last_establishment_opened` (R6.9) + el re-aterrizaje
  (`router.replace('/')`, comentado) son sub-tarea del contexto multi-tenant.
- **`onCreate`**: STUB (el wizard de alta de establecimiento R3.1 es sub-tarea posterior).
- **`onSeeAll`**: `router.push('/mis-campos')` — funcional (la pantalla ya existe).

## Trazabilidad (R → evidencia)

Verificación de la tarea de diseño = **typecheck + lint anti-hardcode + lógica pura
verificada + render fiel medido** (no hay framework de unit-test de componentes en el
repo; el `test` command son typecheck + suites DB — ver `impl_mis-campos-screen.md`).

| Requisito | Evidencia |
|---|---|
| **R6.8.1** tocar el switch despliega un dropdown inline (NO navega directo a "Mis campos") | `design/stitch-iter-4/switch-dropdown.png`: dropdown abierto anclado bajo el switch; `onSwitchPress` togglea `switcherOpen`, no navega |
| **R6.8.1 (1)** campo activo primero, diferenciado (check + "● activo") | render: fila "La Juanita" en `$greenLight` con check `$primary` + "● activo"; tap = `onSelectActive`+`onClose` (no hace nada más) |
| **R6.8.1 (2)** últimos 2 visitados distintos del activo; con <3 campos, los que haya | render: "El Ombú" + "Bella Vista"; `pickVisited()` verificado 5/5 (excluye activo, recorta a 2, con 2 campos→1 visitado, con 1→0) |
| **R6.8.1 (2)** tocar un visitado → fija activo + navega a su home | `onSelectVisited` → `setActiveField` + `onClose` (label del switch cambia); `router.replace('/')` comentado como stub de navegación |
| **R6.8.1 (3)** "Ver todos mis campos" → pantalla "Mis campos" | `onSeeAll` → `router.push('/mis-campos')` (ruta ya registrada en `_layout.tsx`) |
| **R6.8.1 (4)** "Crear nuevo campo +" | fila con `Plus` en `$primary`; `onCreate` STUB comentado (flujo R3.1) |
| **R6.8.1** orden EXACTO activo → visitados → divider → acciones | render top→bottom: La Juanita ● → El Ombú → Bella Vista → ──divider── → Ver todos → Crear nuevo |
| **R6.8.1** divider separa campos de acciones | `View` 1px `$divider` entre los visitados y "Ver todos" |
| **R6.9** últimos visitados derivados de `last_establishment_opened` | `RECENT_FIELDS` mock (recencia first) → `pickVisited`; en prod = contexto multi-tenant |
| **manga-friendly 🟡** target grande por ítem (≥ `$touchMin`) | cada `Row` `minHeight="$touchMin"` (56px) + gap + label `$5`/16px |
| **Jakob** patrón conocido + cierra al tocar afuera/ESC | backdrop `Pressable` (tap=cerrar) + `onKeyDown` Escape (web); chevron rota 180° abierto |
| **tokens, no hardcode** | lint anti-hardcode **0 violaciones**; único token nuevo `$dropdownWidth` |

## Verificación

- `node scripts/check.mjs` **verde**: typecheck client OK, anti-hardcode **0 violaciones**
  en `app/app` + `app/src/components`, suites DB (RLS / Edge / Animal 28) **0 fail**.
- **Render fiel** capturado con **CDP `Emulation.setDeviceMetricsOverride`** (412px, dsf2,
  mobile) — NO `--window-size`. El dropdown se forzó `open` (estado inicial `true`)
  SÓLO para el screenshot y se **revirtió** a `false` (cerrado por default = comportamiento
  real). Captura: **`design/stitch-iter-4/switch-dropdown.png`**.
- **Warnings RN-web pre-existentes** (no regresiones): `accessibilityRole` leak (del
  `Button` "Crear rodeo" → `styled(View)`, ya en baseline) + `shadow*` deprecated (de
  `shadows.*` del config). Verificado que aparecen con el dropdown CERRADO también → no
  los introduce esta tarea. Fuera de scope (frontend mock); el gate `check.mjs` es verde.
- Chrome headless + Metro (8081/9223) **muertos**; temp user-data-dir limpiado; **0
  temporales** dejados (`cdp-capture.py` es el script reusable del repo, no temporal).

## Iteración (re-vet del leader, render `switch-dropdown.png`)

El leader veteó el render y encontró 2 cosas. NO se rehízo el componente; sólo 2 fixes
quirúrgicos. Tokens, no hardcode.

### Fix 1 — 🔴 prop `accessibilityRole` filtrándose al DOM (ERROR de React)
- **Síntoma**: toast rojo en el render web — *"React does not recognize the `acc...` prop
  on a DOM element"*. Identificado por CDP leyendo `Runtime.consoleAPICalled`: la prop
  EXACTA es **`accessibilityRole`** (React sugiere `accessibilityrole` lowercase).
- **Origen**: `app/src/components/Button.tsx` — el `ButtonFrame` es un **`styled(View)` de
  Tamagui** y recibía `accessibilityRole="button"`. En react-native-web Tamagui **NO**
  traduce `accessibilityRole`→`role` sobre un `styled(View)` (al contrario de lo que decía
  el comentario viejo), así que se filtraba al `<div>`. El "Crear rodeo" de la home renderea
  detrás del dropdown → el toast salía sobre el render del dropdown. Los demás
  `accessibilityRole` del árbol están sobre `Pressable` de RN (RNW sí los mapea) → no filtran.
- **Fix**: split por plataforma (mismo patrón con que ya se trataba `accessibilityState`):
  web → `role="button"` + `aria-disabled` (atributos ARIA/DOM válidos); native →
  `accessibilityRole` + `accessibilityState`. Verificado por consola: el error **desaparece**
  (solo queda el WARN pre-existente `shadow*` deprecated, fuera de scope).

### Fix 2 — 🟡 items del dropdown left-aligned (Jakob: los menús son left-aligned)
- **Síntoma**: el label de cada fila quedaba **centrado** en el hueco de la fila (hueco raro
  entre el ícono a la izquierda y el label).
- **Fix**: `textAlign="left"` en el `Text` del `Row` (`EstablishmentSwitcherDropdown.tsx`) →
  ícono + label agrupados a la izquierda con gap `$3`, el label arrancando justo después del
  ícono, para los 5 items. El `● activo` queda como trailing indicator a la derecha. Targets
  ≥ `$touchMin` y el divider intactos.

### Re-vet (CDP `Emulation.setDeviceMetricsOverride`, 412px dsf2 mobile, dropdown ABIERTO)
Re-render → **sobreescrito** `design/stitch-iter-4/switch-dropdown.png`. Confirmado en el
render: (a) **NO** hay toast de error; (b) los 5 items quedaron **left-aligned**; (c) se ve
el **bottom-nav** completo (antes el error lo tapaba). `node scripts/check.mjs` **verde**
(typecheck + anti-hardcode 0 violaciones + 28 tests DB). Chrome headless + Metro **muertos**,
temporales de diagnóstico (`cdp-console.py`, `_diag-*.png`, user-data-dir) **eliminados**.

## Capturas

- `design/stitch-iter-4/switch-dropdown.png` (412px, dsf2, mobile — dropdown ABIERTO;
  re-vet: sin error, items left-aligned, bottom-nav visible)
