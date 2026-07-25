# impl 03-bugfix-autoscroll-reorder — el auto-scroll del drag se va al FONDO de todo el contenido

baseline_commit: 8384d0a3a7f3a27993922d9ba8f4f5ba315e4efb

> Bug 🔴 reportado por Raf en device iOS (con screen recording), spec 03 MODO MANIOBRAS, wizard etapa 2
> ("Elegí las maniobras"). Frontend puro (cero backend, cero migración, cero deps nuevas → Gate 1 N/A).
> Feature 03 `done`; esto es un delta/bugfix con Puerta 1 ya dada por Raf (mismo patrón que
> `impl_03-bugfix-config-body.md` / `impl_03-bugfix-config-sheet.md`).

## Síntoma (Raf, iOS)

Al mantener apretado el grip de una maniobra que está cerca del borde inferior de la pantalla (p. ej. la
nº 5), el auto-scroll del drag se dispara y **scrollea la página hasta el fondo de TODO el contenido** —
mucho más abajo que la última maniobra seleccionada: se ve el pool de no-seleccionadas, las custom, el
"Detalle de la tanda" y el CTA, y **la lista que estás ordenando desaparece de pantalla**.
Raf: *"no nos interesa al ordenar irnos tan hacia abajo que no se vean las seleccionadas; el límite
scrolleable del holding debería ser desde la primera seleccionada hasta un poquito más abajo de la última"*.

## Causa raíz (verificada contra el as-built, no re-investigada)

`app/app/maniobra/_components/ManeuverReorderList.tsx`:
- El **ítem arrastrado SÍ estaba clampeado** a la región (`dragY ∈ [minDragY, maxDragY]`). Eso andaba bien.
- El **auto-scroll NO tenía tope hacia abajo**: el frame callback hacía
  `scrollTo(scrollRef, 0, Math.max(0, next), false)` → el único bound era 0 hacia arriba; hacia abajo corría
  hasta el final del contenido del `Animated.ScrollView` padre.
- El **disparador** era puramente "el dedo entró en los `EDGE_ZONE` (72px) del borde del viewport", **sin
  preguntar si quedaba algo por revelar**.
- Consecuencia UX: el ítem ya está pinneado en su último slot y la página sigue volando → se pierde de vista
  la lista que se está ordenando (Nielsen #1 visibilidad del estado del sistema; se rompe la manipulación
  directa: no ves dónde va a caer lo que arrastrás).

## Plan (T1..T5)

- [x] **T1** — Función PURA `autoScrollDelta` en `app/src/utils/reorder-autoscroll.ts` (clamp por visibilidad
  de la región + piso 0 + guardas defensivas), con la directiva `'worklet'`.
- [x] **T2** — Tests unitarios `app/src/utils/reorder-autoscroll.test.ts` (17 casos) + registro en
  `scripts/run-tests.mjs` (la lista es explícita: un test no registrado NUNCA corre).
- [x] **T3** — Wiring en `ManeuverReorderList.tsx`: `useAnimatedRef` sobre la región (pasa a `Animated.View` +
  `collapsable={false}`), `measure()` en el frame callback (solo con `autoScrollDir !== 0`), llamada a la
  función pura, `measure()===null` → NO auto-scrollear. Comentario-cabecera actualizado.
- [x] **T4** — Regresión E2E web `app/e2e/maniobra-reorder-autoscroll.spec.ts` (2 tests) +
  `testID="jornada-scroll"` en el `Animated.ScrollView` de `jornada.tsx` (ancla para medir el scroll real).
- [x] **T5** — Capture de Gate 2.5 `app/e2e/captures/reorder-autoscroll.capture.ts` (5 estados) + specs
  reconciliadas (requirements R1.12-a, design §6.bis.1 v3-bis, tasks M1.4 as-built v7).

## Fix aplicado

### La función pura (`app/src/utils/reorder-autoscroll.ts`)

```ts
export function autoScrollDelta(input: ReorderAutoScrollInput): number {
  'worklet';
  // dir/speed/region/viewport no válidos → 0 (NUNCA el comportamiento sin tope)
  if (dir === 1) {
    const hidden = regionTop + regionHeight + air - (viewportTop + viewportHeight);
    return hidden <= 0 ? 0 : Math.min(speed, hidden);          // baja solo mientras quede región por revelar
  }
  const hidden = viewportTop - (regionTop - air);
  const step = Math.min(speed, hidden, offset);                 // sube; el piso de scroll 0 lo mete `offset`
  return hidden <= 0 || step <= 0 ? 0 : -step;
}
```

- El paso se **recorta al remanente exacto** → la región aterriza con el aire pedido, sin overshoot ni
  rebote (dentro de una misma dirección el remanente nunca cambia de signo).
- `AUTO_SCROLL_REVEAL_MARGIN = 24px` (const nombrada en el componente, junto a `EDGE_ZONE`/`AUTO_SCROLL_SPEED`
  — geometría de gesto, no spacing themeable → ADR-023 §4 OK, el lint anti-hardcode da 0). **Por qué 24**:
  (a) < `EDGE_ZONE` (72) → cuando el scroll frena, el dedo (que está dentro de la banda de borde) sigue estando
  sobre las últimas filas y no sobre el vacío; (b) ~30% de `ROW_HEIGHT` (80) → la última fila queda claramente
  despegada del borde sin gastar una fila entera de recorrido; (c) > el gap visual entre filas (8) → se lee
  como "aire", no como otro gap.

### El wiring (`ManeuverReorderList.tsx`)

- El contenedor de la región (`height = n*ROW_HEIGHT`) pasó de `View` de Tamagui a **`Animated.View` con
  `ref={regionRef}` (`useAnimatedRef`) + `collapsable={false}`**. El `collapsable` NO es decorativo: en Android
  una View sin props visuales se aplana y `measure()` devuelve NaN (lo dice el propio warning de reanimated)
  → sin él, el guard defensivo apagaría el auto-scroll entero en Android.
- `useFrameCallback` → `measure(regionRef)` **solo cuando `autoScrollDir !== 0`** (early-return antes de medir:
  no se mide en cada frame de la app, solo durante los frames de drag-cerca-del-borde) → `autoScrollDelta(...)`
  → `scrollTo(..., Math.max(0, offset + delta))` (se mantiene el clamp duro en 0 pedido).
- `measure()` puede devolver `null` (vista no layouteada / plataforma sin soporte) → **no se auto-scrollea**,
  mismo criterio que el guard preexistente de `viewportHeight <= 0`.
- **NO se implementó** el gate por "el ítem ya está en el extremo de sus bounds" ni el hardcode de "más de 5
  maniobras" — ambos descartados y **documentados en el código** con el porqué.

## Trazabilidad R<n> → test

| Requisito | Test |
|---|---|
| **R1.12-a — región que ENTRA en el viewport → el auto-scroll no se mueve** | `app/src/utils/reorder-autoscroll.test.ts` ("región más chica que el viewport y visible con aire → delta 0 en ambas direcciones", "región de 5 filas que entra entera (el caso reportado) → delta 0") + `app/e2e/maniobra-reorder-autoscroll.spec.ts:95` (oráculo DOM: `scrollTop < 24` tras sostener el grip 1s en el borde + `selected-row-0/3` `toBeInViewport()`) |
| **R1.12-a — región MÁS ALTA que el viewport → revela y FRENA** | `reorder-autoscroll.test.ts` ("fondo de la región fuera de pantalla → avanza a speed", "el ítem en el último slot NO gatea el auto-scroll", "remanente menor que la velocidad → avanza solo lo que falta", "fondo ya visible CON el margen → corta") + `maniobra-reorder-autoscroll.spec.ts:134` (revela la última fila **y** `scrolled < maxScroll - 60`) |
| **R1.12-a — borde superior + piso de scroll** | `reorder-autoscroll.test.ts` ("región pegada al tope → sube SOLO el margen", "tope ya visible con su margen → corta", "remanente hacia arriba menor que la velocidad", "offset 0/negativo → nunca scrollea a offset negativo") |
| **R1.12-a — fail-closed sin medida** | `reorder-autoscroll.test.ts` ("viewport sin medir (0/NaN) → 0", "región sin medir (measure() null → NaN/0) → 0", "velocidad inválida → 0", "margen no finito → 0") |
| **R1.12 (reorder, sin regresión)** | `app/e2e/maniobra-elegir.spec.ts` 2/2 + `maniobra-config-reactiva.spec.ts` 2/2 (etapa 2 completa: selección, orden, continuar, arrancar) |

**Los oráculos E2E están FALSIFICADOS** (no pasan por la razón equivocada): con el auto-scroll viejo
re-inyectado a mano en el frame callback y el bundle reconstruido, los 2 tests **caen** —
`Expected < 24, Received 249` y `Expected < 343, Received 403` (249 y 403 = el `maxScroll` de cada caso, o sea
"se fue al fondo de todo"). Restaurado el fix, vuelven a verde.

## Verificación (lo que EJECUTÉ, no lo que leí)

1. `pnpm typecheck` (app) → **limpio**.
2. Unit del cliente COMPLETO (129 archivos, la lista de `run-tests.mjs`) → **2400/2400 pass**, incluidos los
   17 nuevos de `reorder-autoscroll.test.ts`.
3. `node scripts/check-hardcode.mjs` → **0 violaciones**.
4. E2E web (build real `pnpm e2e:build` + Playwright contra Supabase dev):
   - `maniobra-reorder-autoscroll.spec.ts` **2/2** (+ falsificación: 2/2 rojos con el código viejo).
   - `maniobra-elegir.spec.ts` **2/2**, `maniobra-config-reactiva.spec.ts` **2/2** (sin regresión del wizard).
   - `maniobra-carga.spec.ts` **1/3**: los 2 rojos (`:133` y `:277`) son los **pre-existentes documentados**
     (tacto adaptativo, spec 03 B2 — `progress/current.md` 2026-07-14). **Verificado empíricamente**: revertí
     mis 2 archivos al baseline, rebuildeé y esos mismos 2 tests fallan igual (mismo síntoma: la línea espera
     `· 1 de 2` y la app muestra `Pesaje · 1 de 1`). No son míos.
5. Capture Gate 2.5 (`--config playwright.capture.config.ts`, mobile 412×915) → **1/1**, 5 PNG en
   `app/e2e/captures/__shots__/reorder-autoscroll/` (gitignored, NO commiteados):
   `01-region-entra-reposo`, `02-region-entra-drag-borde`, `03-region-larga-reposo`,
   `04-region-larga-drag-borde`, `05-region-larga-tope`. Las 3 con "drag" están tomadas **con el grip
   SOSTENIDO** (mouse down sin soltar) — el instante exacto del bug. Las miré: (02) la lista entera sigue en
   pantalla y el scroll no se movió; (04) el auto-scroll reveló la última fila (la burbuja levantada está en
   el último slot) y **frenó ahí con aire**, sin comerse el pool/custom/CTA; (05) desde el fondo, sostener
   arriba frena con el rótulo "En la jornada (arrastrá para ordenar)" a la vista.
6. `design/**/*.png` re-renderizados por el e2e → **revertidos** (`git checkout -- design/`). Nada commiteado
   (el commit lo hace el leader).

### Verificación EXTRA del camino NATIVO (que no puedo device-testear)

El único riesgo real de esta implementación en nativo era que el babel plugin de worklets no workletizara la
función pura importada de otro módulo (una llamada no-worklet desde el hilo de UI tira en runtime, y en web
no se notaría). Lo verifiqué **estáticamente pero ejecutando babel** con la config real del proyecto
(`@babel/core` + `babel.config.js`, caller metro/ios):
- `reorder-autoscroll.ts` → sale con `__workletHash` + `__initData` (function workletizada). ✔
- `ManeuverReorderList.tsx` → el worklet del frame callback captura en su `__closure`:
  `{scrollContext, autoScrollDir, measure, regionRef, autoScrollDelta, AUTO_SCROLL_SPEED,
  AUTO_SCROLL_REVEAL_MARGIN, scrollTo}`. ✔ (el cuerpo serializado llama a `autoScrollDelta(...)`).

## Autorrevisión adversarial (paso 8)

Qué busqué y qué encontré:

1. **¿El drag sigue al dedo 1:1 cuando el auto-scroll corta?** Sí: `dragY` se computa en `onUpdate` con
   `translationY + scrollDelta` y NO lo toqué. Si el auto-scroll frena, `scrollDelta` deja de crecer y el ítem
   sigue exactamente al dedo (que es lo correcto: no hay más contenido que revelar).
2. **¿El reorder final da lo mismo?** Sí: `commit(index, myPos.value)` intacto; `myPos` se calcula del mismo
   `effY`. Verificado además en vivo por las capturas 04/05 (la fila arrastrada cambia de slot y los hermanos
   reflowean) y por `maniobra-elegir` (orden → secuencia de carga) verde.
3. **¿`measure()` mete jank?** Se llama SOLO cuando `autoScrollDir !== 0` (early-return antes) → 0 llamadas en
   reposo, en scroll normal y durante un drag lejos de los bordes.
4. **¿Rompí "pool vacío" / "1 sola seleccionada"?** Con 0 seleccionadas la región no se renderiza → `measure()`
   null → no auto-scrollea (y no hay grip que agarrar). Con 1 sola, `minDragY == maxDragY == 0` (sin cambios)
   y el clamp da 0 si entra en el viewport. Con el pool vacío (todas seleccionadas) el caso queda cubierto por
   la captura 03/04 (probé con 9 y con las 12 ofrecidas).
5. **Android view-flattening** (lo encontré leyendo la implementación de `measure` de reanimated: devuelve
   `null` + warning si la vista se aplanó): sin `collapsable={false}` el fix quedaba **inerte en Android**
   (guard → sin auto-scroll). Agregado + comentado. No lo puedo confirmar en device.
6. **Web (react-native-web)**: verifiqué la implementación de `measure.web` (usa `getBoundingClientRect().top`
   y `offsetHeight`) contra la de `measureInWindow` de RNW que alimenta `viewportTop/viewportHeight` (también
   `getBoundingClientRect`) → **mismo sistema de coordenadas** (viewport-relative), que es la premisa del
   cómputo. Confirmado empíricamente: el E2E web pasa y falla al revertir.
7. **`-0`**: la rama de subida podía devolver `-0` (que rompe un `assert.strictEqual(x, 0)` por `Object.is`).
   Normalizado a `0` y testeado explícitamente.
8. **Overshoot/rebote**: recorto el paso al remanente en vez de dejar el `speed` fijo → el último frame
   aterriza exacto; el remanente no cambia de signo dentro de una dirección → no puede oscilar.
9. **El harness del test se me estaba mintiendo dos veces** (lo cacé revisando las capturas, no los verdes):
   (a) `scrollIntoViewIfNeeded()` de Playwright **CENTRA** el elemento → falseaba el escenario "región larga"
   (la captura salía con todo el contenido de abajo a la vista, por el harness, no por el fix); (b) el
   `boundingBox()` del DOM **ignora el clipping del ScrollView** → agarraba un grip que en pantalla cae bajo el
   CTA pinneado y el drag ni se activaba (la captura mostraba una lista quieta que parecía correcta). Los dos
   arreglados (scroll explícito al offset + helper `lastVisibleHandleIndex` que mide contra el rect del
   ScrollView). Sin esto tenía 2 verdes falsos.

Todo lo encontrado quedó corregido y re-verificado (typecheck + unit + E2E + capture, arriba).

## Reconciliación de specs (paso 9)

- `specs/active/03-modo-maniobras/requirements.md` → **nota de reconciliación R1.12-a** bajo R1.12 (el auto-scroll
  del drag se acota a la región de seleccionadas; entra entera → no se mueve; no entra → revela hasta el último
  borde y frena; sin medida → no scrollea). No se reescribió el EARS original.
- `specs/active/03-modo-maniobras/design.md` → **As-built v3-bis** (cómo quedó construido: `Animated.View` +
  `useAnimatedRef` + `collapsable={false}`, `measure()` en el frame callback, `autoScrollDelta` puro, el valor y
  el porqué de `AUTO_SCROLL_REVEAL_MARGIN`, el fail-closed, **las 2 alternativas descartadas** y qué NO cambió).
- `specs/active/03-modo-maniobras/tasks.md` → **As-built v7 (BUGFIX)** en M1.4 + la línea `Archivos:` con los 4
  archivos nuevos/tocados.

## Limitación conocida (ADR-029)

**No puedo verificar en device iOS/Android.** Lo que está verificado acá es: la lógica pura (unit), el wiring y
el comportamiento real del auto-scroll **en web** (E2E con el gesto sostenido + oráculo sobre el `scrollTop` del
DOM, falsificado contra el código viejo) y que el camino nativo compila a un worklet correcto (babel real).
**Queda para el veredicto de Raf en device**: (a) el gesto con el dedo en iOS (que el clamp se sienta natural y
el ítem siga al dedo al frenar); (b) **Android**, donde además hay que confirmar que `measure()` devuelve valores
(el `collapsable={false}` es la defensa contra el view-flattening); si en Android el auto-scroll no se moviera
NUNCA, el sospechoso es exactamente ese.

## Riesgos / regresiones

- **Bajo**: el cambio es aditivo sobre el frame callback y el contenedor de la región; el clamp del ítem, el
  gesto, el reorder y el reflow no se tocaron. El peor caso de una medida rara es "no auto-scrollea" (degrada a
  scroll manual), nunca "scrollea de más".
- `jornada.tsx` solo suma un `testID`.
- `scripts/run-tests.mjs`: agregué mi test a la lista explícita. **Ojo al commitear**: ese archivo lo está
  tocando también la otra terminal (sheets) — stagear con cuidado.
- Archivos de la otra terminal en el árbol (`BottomSheetShell.tsx`, `sheet-shell.*`, `sheet-teclado.*`,
  sheets modificados): **no los toqué**. El build E2E de mis últimas corridas los incluye (typecheck verde).
