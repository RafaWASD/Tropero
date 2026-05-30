# A.2 — Home de RAFAQ, Incremento 3 (ADR-023, fix overflow web + elevación FAB)

> Infraestructura/diseño incremental, NO una feature con spec (misma naturaleza que A.1 / B.0 / inc. 2).
> Modo colaborativo: SOLO los 2 ajustes pedidos, verde y renderizable. NO features nuevas, NO backend.
> Verificación = typecheck + check.mjs + expo export -p web (precedente A.1/B.0/inc.2: no hay runner de
> tests unitarios de UI en `app/`).

## Plan

- [x] Ajuste 1 — Overflow horizontal en WEB (react-native-web `min-width:0`).
- [x] Ajuste 2 — Bajar la elevación del FAB a ~57% (Mercado Pago medido), `FAB_RAISE_RATIO 0.66→0.57`.
- [x] Verificación: typecheck + check.mjs + expo export -p web (dist/ regenerado) + render headless a 360/412px.

## Estado: COMPLETO — typecheck verde + check.mjs verde + expo export web OK (dist/ regenerado) +
## render verificado headless a 360 y 412px (0 elementos exceden el viewport).

---

## Ajuste 1 — Overflow horizontal en WEB (`minWidth: 0`)

**Causa raíz (confirmada por medición CDP):** en react-native-web los ítems flex tienen
`min-width:auto` por default → NO encogen por debajo del ancho intrínseco de su contenido. El
`flexShrink:1` del inc. 2 NO alcanza en web. Un hijo flex con texto que no wrappeaba (body del
Stepper, bloque del switch del header, texto del banner) empujaba su fila más ancha que el viewport,
el documento tomaba el ancho del hijo más ancho y TODO se estiraba → corte uniforme a la derecha.

**Contenedores que recibieron `minWidth:0`:**
- `Stepper.tsx`: la **columna de contenido** (`YStack flex={1}` al lado del riel) → `minWidth={0}`.
  Además el **title** y el **body** (`Text`) recibieron `flexShrink={1} minWidth={0}`; el body
  sigue sin `numberOfLines` (wrappea libremente).
- `index.tsx` header: el **Pressable del switch** (`style={{ flexShrink:1, minWidth:0 }}`), el
  **XStack interno** del switch (`flexShrink={1} minWidth={0}`) y el **Text del nombre del campo**
  (`flexShrink={1} minWidth={0}`, mantiene `numberOfLines={1}`).
- `index.tsx` banner: el **Text del cuerpo** (`flex={1} minWidth={0}`) — así el ✕ no se empuja fuera.

**Defensa raíz aplicada (último cinturón de seguridad web):**
- Raíz de la home (`YStack` raíz): `width="100%" maxWidth="100%" overflow="hidden"`. Clipea cualquier
  exceso horizontal sin romper el scroll vertical (lo maneja el `ScrollView` interno, no la raíz).
- `ScrollView`: `maxWidth="100%"` + `contentContainerStyle.maxWidth:'100%'` (sumado al `width:'100%'`
  que ya tenía).

**Sin tokens nuevos de color/spacing.** `minWidth:0` es el literal 0 (no es color ni spacing temático,
no tiene token equivalente — mismo criterio documentado para el hairline de 1px del Stepper).

## Ajuste 2 — Elevación del FAB a ~57% (Mercado Pago medido)

- `tamagui.config.ts`: `FAB_RAISE_RATIO` **0.66 → 0.57** → `size.fabRaise = round(64 * 0.57) = 36`
  (antes 42). Constante única del config; la pantalla lo lee con `getTokenValue('$fabRaise','size')`.
- **Cruce nuevo:** con raise=36 y FAB ⌀64, el borde superior de la barra cruza el FAB a
  36/64 = **56.25% desde arriba** → **~57% del botón por encima** de la barra y **~43% (28px)
  solapado dentro** (antes: 66% arriba / 34% dentro). Coincide con el navbar real de Mercado Pago.
- Anillo blanco (`borderWidth:4 borderColor white`) y sombra: SE MANTIENEN.
- Label "Maniobra": al bajar el FAB ~6px, su borde inferior cae ~6px y el label lo seguiría en el
  flujo; reduje su `marginTop` **$3 → $2** para que suba un poco y caiga en la misma línea base que
  los otros labels sin que el círculo lo pise.

## Verificación (3/3 verdes + render)

| Check | Resultado |
|---|---|
| `cd app && pnpm.cmd typecheck` | **VERDE** (tsc --noEmit, sin errores) |
| `node scripts/check.mjs` (root) | **VERDE** — typecheck cliente + RLS 15/15 + Edge 26/26 + Animal 19/19 (backend intacto) |
| `cd app && pnpm.cmd exec expo export -p web` | **OK** — bundle nuevo `entry-6b78c1e8…`; `dist/` regenerado |
| Render headless (Edge + CDP `Emulation.setDeviceMetricsOverride`) a **360px** | **0 offenders**: `innerWidth=360 docScrollWidth=360 clientWidth=360`. Avatar, ✕ del banner, CTA, bodies wrappeados y los 5 items del nav (incl. "Más") visibles. |
| Render headless a **412px** | **0 offenders**: `innerWidth=412 docScrollWidth=412 clientWidth=412`. Idem 360. |

> **Lección de verificación:** el screenshot headless por `--window-size` SOLO recorta la ventana del
> SO; el viewport CSS del WebView quedaba en ~470px → daba falso positivo de "corte". El método
> correcto es CDP `Emulation.setDeviceMetricsOverride` (viewport CSS exacto). Con eso, 0 overflow.

> **EBUSY (precedente):** un `python -m http.server 8137` sobre `dist/` la tiene bloqueada. Exporté a
> `dist_tmp/`, copié el contenido sobre `dist/` (`Copy-Item -Recurse -Force`), borré el bundle JS
> huérfano viejo (`entry-1d2fa1f…`) y `dist_tmp/`. NO maté el server python ni procesos de Raf (solo
> las instancias headless de Edge con `remote-debugging-port=9222` que yo lancé para medir).

## Fuera de scope (no tocado)

- Backend / migrations / supabase/ — INTACTO.
- Dropdown del switch (R6.8.1), "Mis campos", navegación real de CTAs — siguen como TODOs.
- Tests unitarios de UI — no hay runner (precedente A.1/B.0/inc.2).
