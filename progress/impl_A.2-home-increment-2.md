# A.2 — Home de RAFAQ, Incremento 2 (ADR-023, fixes de render web)

> Infraestructura/diseño incremental, NO una feature con spec (igual naturaleza que A.1 / B.0).
> Modo colaborativo: SOLO los 3 fixes pedidos, verde y renderizable. NO features nuevas,
> NO backend. Verificación = typecheck + check.mjs + expo export -p web (precedente A.1/B.0:
> no hay runner de tests unitarios de UI en `app/`).

baseline_commit: 9f1803740290cf5a28374738612ba5eb69238d53

## Plan (tareas del incremento 2)

- [x] Fix 1 — Overflow horizontal a 360/412px (header avatar, ✕ banner, CTA, bodies, "Más" del nav).
- [x] Fix 2 — Altura del navbar 56→64 (token `size.navBar`).
- [x] Fix 3 — Elevación del FAB a la regla de los tercios (~2/3 arriba), token `size.fabRaise`.
- [x] Verificación: typecheck + check.mjs + expo export -p web (dist/ regenerado).

## Estado: COMPLETO — typecheck verde + check.mjs verde + expo export -p web OK (dist/ regenerado).

---

## Fix 1 — Overflow horizontal (causa raíz + solución)

**Causa raíz:** las filas (`XStack`) del header, del banner y los rieles del Stepper no
estaban acotadas a `width:100%`, y en React Native los hijos NO encogen por default
(`flexShrink: 0`). Cuando la suma de anchos intrínsecos de los hijos superaba el ancho
de pantalla, la fila tomaba su ancho intrínseco y `justifyContent="space-between"` dejaba
de tener efecto → los elementos del extremo derecho (avatar del header, ✕ del banner)
quedaban EMPUJADOS fuera de pantalla a la derecha. Además, faltaba acotar el contenido
del `ScrollView` a `width:100%` (en RN-Web el content container puede crecer más ancho
que el viewport). En el bottom-nav, el FAB usaba una celda de ancho FIJO (`width: fab+16`
= 80px) mientras las otras 4 tabs reparten el resto por flex → a 360/412px el ancho total
(4 tabs flex + 80px fijos) superaba la pantalla y el 5º item ("Más") se cortaba.

**Solución (cero hardcode nuevo de color/spacing; solo flex/width estructurales):**
- `index.tsx` raíz: `YStack flex={1} width="100%"`. Padding horizontal simétrico `$4`
  (18px c/lado) en los contenedores internos (header + contentContainer del ScrollView).
- Header: `XStack width="100%" justifyContent="space-between"`. El switch de
  establecimiento `flexShrink:1` y el nombre `numberOfLines={1}` (trunca, no empuja).
  Wordmark RAFAQ y avatar `flexShrink:0` (siempre visibles; avatar en el extremo derecho).
- Banner: `Card alignSelf="stretch"` + `XStack width="100%"`; círculo de ícono y ✕ con
  `flexShrink:0` (✕ visible a la derecha), texto con `flex:1` (wrappea).
- `ScrollView`: `width="100%"` + `contentContainerStyle.width:'100%'` +
  `showsHorizontalScrollIndicator={false}` → el contenido nunca excede el ancho.
- `Stepper.tsx`: contenedor y filas `width="100%"`; `StepRail` `flexShrink:0` (ancho fijo
  del riel) y la columna derecha `flex:1` (el body wrappea dentro del ancho, sin overflow).
- `_layout.tsx` (bottom-nav): la celda del FAB pasó de `width={fab+16}` (fijo, 80px) a
  `flex={1}` → reparte el ancho por igual con las otras 4 tabs. Los 5 items + el FAB
  entran dentro de la pantalla a 360 y 412px (FAB ⌀64 cabe en la celda ≈72–82px).

## Fix 2 — Altura del navbar (56 → 64)

- Token nuevo `size.navBar = 64` en `tamagui.config.ts` (alto de CONTENIDO del bottom-nav,
  excluye `insets.bottom` que se suma aparte como hoy).
- `_layout.tsx`: `navColors().navHeight` ahora lee `$navBar` (antes `$touchMin`=56).
  `tabBarStyle.height = navBar + insets.bottom`. Iconos (24px) + labels (Inter 500 11px)
  entran con ritmo cómodo tipo Mercado Pago (antes 56px quedaba apretado).

## Fix 3 — Elevación del FAB (regla de los tercios)

- Token nuevo `size.fabRaise = Math.round(fab * 0.66)` = **42** (derivado de `$fab`=64,
  ratio `FAB_RAISE_RATIO=0.66` como constante única del config — NO literal en la pantalla).
- `_layout.tsx`: el offset del FAB pasó de `marginTop: -(FAB_SIZE/2)` (≈-32, cruce al 50%)
  a `marginTop: -$fabRaise` (-42).
- **Valor final del cruce:** con raise=42, el borde superior de la barra cruza el FAB a
  42/64 = **65.6% desde arriba** → **~66% del botón por encima** de la barra y **~34%
  (22px) solapado dentro**. Cumple el target (~2/3 arriba, patrón Mercado Pago / Pangea).
- Anillo blanco (`borderWidth:4 borderColor white`) y sombra: SE MANTIENEN.
- Label "Maniobra": como el FAB sube más, su parte solapada baja menos; subí el
  `marginTop` del label de `$1` (2px) a `$3` (13px) para que el texto caiga en la misma
  línea base que los otros labels (label-top ≈ 22+13 = 35px, igual que antes ≈34px) sin
  que el círculo lo pise.

## Tokens nuevos (`tamagui.config.ts`)

- `size.navBar = 64` — alto de contenido del bottom-nav (Fix 2).
- `size.fabRaise = round(fab * 0.66) = 42` — cuánto sube el FAB sobre la barra (Fix 3),
  derivado de `$fab` vía las constantes `FAB_SIZE` / `FAB_RAISE_RATIO`.
- (Sin tokens nuevos de color/spacing: el Fix 1 fue estructural — width/flex/flexShrink.)

## Verificación (3/3 verdes)

| Check | Resultado |
|---|---|
| `cd app && pnpm.cmd typecheck` | **VERDE** (tsc --noEmit, sin errores) |
| `node scripts/check.mjs` (root) | **VERDE** — typecheck cliente + RLS 15/15 + Edge 26/26 + Animal 19/19 (backend intacto) |
| `cd app && pnpm.cmd exec expo export -p web` | **OK** — 3471 módulos; plugin Tamagui corrió sobre _layout/index/Stepper; `dist/` regenerado |

> Nota EBUSY: el server `python -m http.server 8137` sobre `dist/` la tiene bloqueada.
> Exporté a `dist_tmp/` y copié el contenido sobre `dist/` (Copy-Item -Force), borré el
> bundle JS huérfano viejo y `dist_tmp/`. NO maté procesos. `index.html` apunta al bundle
> nuevo (1d2fa1f). Listo para el screenshot headless del leader a 360 y 412px.

## Fuera de scope (no tocado)

- Backend / migrations / supabase/ — INTACTO.
- Dropdown del switch (R6.8.1), "Mis campos", navegación real de CTAs — siguen como TODOs.
- Tests unitarios de UI — no hay runner (precedente A.1/B.0).
