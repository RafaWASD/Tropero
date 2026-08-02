# Review — Fix de clase: blindaje de worklets de gesto/scroll (crash nativo SIGABRT)

**Tipo**: bug-fix defensivo a feature 03 (MODO MANIOBRAS, `done`). NO es feature nueva -> no hay `specs/active/<name>/`.
**Baseline**: `aead27c`. Archivos del fix: `ManeuverReorderList.tsx`, `WheelPicker.tsx`, `worklet-callbacks-guard.test.ts`.
(`docs/marketing/*` y `docs/backlog.md` fuera de scope, ignorados.)

## Veredicto: APPROVED

El fix envuelve los 8 callbacks de evento-worklet del arbol (4 del Pan + 3 Tap + 1 scroll) en `try/catch`
DENTRO del worklet, degrada a estado inerte en release y re-lanza en DEV, y extiende el guard estatico para
barrer la AUSENCIA de blindaje. `check.mjs` RC=0. Mutante verificado en rojo end-to-end y revertido byte-exacto.

---

## 1. try/catch DENTRO del worklet (critico)

Confirmado en cada callback: la directiva worklet es la 1ra sentencia, `try {` la 2da -> el catch atrapa el
throw ANTES de cruzar a C++. Un try/catch afuera del worklet seria inutil.

| Callback | file:line (worklet-directive / try) |
|---|---|
| pan.onStart | ManeuverReorderList.tsx:223 / :224 |
| pan.onUpdate | ManeuverReorderList.tsx:237 / :238 |
| pan.onEnd | ManeuverReorderList.tsx:285 / :286 |
| pan.onFinalize | ManeuverReorderList.tsx:300 / :301 |
| badgeTap.onEnd | ManeuverReorderList.tsx:352 / :353 |
| bodyTap.onEnd | ManeuverReorderList.tsx:362 / :363 |
| PoolRow tap.onEnd | ManeuverReorderList.tsx:549 / :550 |
| scrollHandler.onScroll | WheelPicker.tsx:290+ (directiva worklet, luego try) |

`gripTapSwallow = Gesture.Tap().maxDuration(250)` NO tiene callback -> nada que blindar (correcto).
`Gesture.Race(pan, gripTapSwallow)` no agrega callbacks.

## 2. Happy-path byte-identico

`git diff -w --stat` de los dos fuentes = **73 inserciones, 0 borrados**: no se borro ni modifico ninguna
linea de los cuerpos originales, solo se agrego scaffolding (worklet-directive, try/catch, comentarios). El
orden de sentencias en `onEnd` se preservo (commit ANTES de los resets, ManeuverReorderList.tsx:287-290). La
directiva worklet explicita es idempotente (los callbacks ya eran worklets: acceden a `.value` y llaman
`runOnJS`, imposible en JS thread) -> no cambia de thread. OK.

## 3. El catch no re-tira y deja estado inerte coherente

- pan onStart/onUpdate/onFinalize catch (`:229-234`, `:276-282`, `:304-309`): resetea `dragY=0`,
  `activeKey` vacio y `autoScrollDir=0` -> drag inerte, la fila vuelve por el spring de `positions`. OK
- pan onEnd catch (`:291-297`): resetea los mismos shared values y **NO re-llama `commit`** -> sin reorder
  fantasma. OK
- badge/body/PoolRow tap catch (`:355`, `:365`, `:552`): solo `if (__DEV__) throw err` (no hay estado de drag)
  -> tap inerte en release. OK
- scrollHandler onScroll catch (WheelPicker.tsx): solo `if (__DEV__) throw err` -> rueda quieta; el SETTLE/lock
  nativo asienta al soltar. OK
- Todos los catch escriben SOLO `useSharedValue().value` (host objects) o nada -> en la practica no re-tiran en
  release. `if (__DEV__) throw` presente en los 8. OK (mismo argumento que BottomSheetShell:467-471.)

## 4. Guard de clase (REGLA 2) - barre la ausencia, oraculo vivo

- Enumera callbacks de gesto SOLO dentro de cadenas `Gesture.` (`gestureChainRegions` + `consumeGestureChain`,
  test.ts:126-161) + keys de `useAnimatedScrollHandler` (test.ts:186-203). Exige `try` + `catch` +
  `if(__DEV__)throw` (`isBlindado`, test.ts:209-211). Cobertura CALCULADA con piso `WORKLET_CALLBACK_FLOOR=10`
  (hoy 13) + 3 archivos-testigo + valvula `worklet-blindaje-disable-next-line -- <razon>`.
- **Falsos positivos descartados** (verificado): `db.onChange` (PowerSync) y props JSX `onEnd/onChange` NO se
  enumeran - test sintetico (test.ts:453-463) + confirmado con grep: `mas/animales/editar-plantilla/index.tsx`
  tienen 0 cadenas `Gesture.` (sus `.onEnd/.onChange` son props JSX, correctamente excluidas).
- **Mutante corrido por mi (end-to-end)**: saque el try/catch de `WheelPicker.onScroll` -> el guard se puso
  ROJO senalando exactamente `app/maniobra/_components/WheelPicker.tsx:291  scrollHandler.onScroll`. Revertido
  byte-exacto (blob `7184e95`, ver nota abajo). El oraculo no esta muerto. OK

## 5. Sin regresion

- `node scripts/check.mjs` -> **RC=0** (incluye typecheck del cliente + suite unitaria con el guard).
- Guard aislado: 6/6 verde antes y despues del mutante.
- E2E NO corrido, correcto: el crash es del UI-runtime nativo (`UIEventHandler::process`); react-native-web no
  ejercita ese path -> la red es el guard estatico en check.mjs. OK

## 6. Cobertura del arbol - no quedo worklet de evento sin cubrir

- `useFrameCallback` (ManeuverReorderList.tsx:635): non-target CORRECTO. Corre por el frame-callback registry,
  NO por `UIEventHandler::process` -> el stack del crash lo excluye. Razonamiento valido.
- `useAnimatedStyle` (SelectedRow:314, WheelPicker WheelCell:123) / `useDerivedValue`: worklets de estilo, no
  de evento -> fuera del path. OK
- Sin `useAnimatedGestureHandler` (API v1), sin `useEvent`/`useHandler` crudos, sin segundo scroll handler
  (grep del arbol: solo los 4 archivos, todos cubiertos o comment-only como DientesStep.tsx:143). OK

---

## Trazabilidad (invariante-de-clase <-> test)

Bug-fix -> no hay `R<n>`; el requirement es el invariante de clase y su red es el guard en check.mjs:
- Invariante "todo callback gesto/scroll worklet blindado" <-> `worklet-callbacks-guard.test.ts` :: "cada
  callback de gesto RNGH / animated-scroll-handler esta BLINDADO" (**verificado ROJO via mutante**).
- Invariante "el guard sabe fallar / no confunde db.onChange" <-> :: "el guard de BLINDAJE sabe FALLAR".
- Cobertura del scan <-> :: "AUTO-VERIFICACION: el guard escaneo todo el arbol" + "el guard recorre el arbol real".
- No-regresion REGLA 1 (`runOnJS(X.y)`) <-> :: "ningun worklet le pasa a runOnJS/scheduleOnRN un metodo de modulo".
- Comportamiento de feature 03 tocado (R1.4/R1.5/R1.12/R1.13 reorder, R14.5 rueda): happy-path byte-identico ->
  cubierto por los tests preexistentes (reorder-autoscroll, wheel-picker, maneuver-*), sin cambios.

## Tasks completas: si

T1-T6 del `progress/impl_crash-worklet-gesto-guard.md` en `[x]`, todas verificadas contra el codigo.

## Exactitud de specs (codigo -> spec)

Fix puramente defensivo a feature 03 (`done`): happy-path byte-identico -> NO contradice R1.4/R1.5/R1.12/R1.13/
R14.5. `specs/done/*` requiere confirmacion humana para editar (CLAUDE.md) y no hay as-built que reconciliar.
El guard `worklet-callbacks-guard.test.ts` auto-documenta el bug y su clase en su header. Sin specs viejas. OK

## CHECKPOINTS (aplicables)

- C1 `check.mjs` RC=0 -> [x]
- C3 codigo respeta arquitectura (cambios en `_components` existentes + guard en `components`; sin deps nuevas;
  sin logs debug; sin `establishment_id` hardcodeado) -> [x]
- C4 verificacion real (guard escanea el arbol REAL como fixture; runner >0 tests, 6/6 verde; mutante probado) -> [x]
- C6 SDD -> N/A (bug-fix a feature `done`, sin `specs/active/<name>/`)
- C7 multi-tenant -> N/A (no toca tablas/RLS)
- C8 offline-first -> N/A (no agrega path de carga; happy-path intacto)
- C9 E2E/visual -> N/A documentado (crash nativo del UI-runtime; web/E2E no lo ejercitan; sin cambios de UI)

## Checklist RAFAQ-especifico

- A (RLS/multi-tenancy) -> N/A
- B (offline-first) -> N/A
- C (BLE) -> N/A
- D (UI de campo) -> sin cambios de dimension/fuente/layout (happy-path byte-identico); el fix MEJORA la
  fiabilidad en manga: la app ya no aborta a mitad de jornada, degrada a gesto inerte. Boxes de tamanos/fuentes
  se mantienen (codigo de UI intacto).
- E (Edge Functions) -> N/A

---

## Findings

- AMARILLO (no bloqueante) `isBlindado` (test.ts:209-211) es un chequeo de CONTENCION: exige que el cuerpo
  contenga `try`+`catch`+`if(__DEV__)throw` en algun lado, no que el try envuelva TODO el cuerpo ni que vaya
  tras la directiva worklet. Un blindaje mal ubicado (codigo antes del try) pasaria. Es el tradeoff aceptado de
  un guard estatico barato (mismo espiritu que BottomSheetShell) y cumple su fin declarado - barrer la ausencia:
  un gesto/scroll nuevo SIN try/catch nace en rojo (probado con mutante). No amerita cambio.
- AMARILLO (backlog, no bloqueante) `useFrameCallback` queda sin blindar por diseno (correcto para ESTE crash,
  otro registry). Pero un throw en un frame-callback worklet es la misma clase de abort nativo por otro trigger;
  hoy su cuerpo es defensivo (early-returns + null-checks + `autoScrollDelta` puro). Candidato a
  defense-in-depth (ya anotado por el implementer en dudas abiertas + feature 17 Sentry). No es parte de la
  evidencia del bug.

## Nota de proceso (transparencia)

Para verificar el oraculo corri un mutante sobre `WheelPicker.tsx` (saque el try/catch del `onScroll`). Un
`git checkout` de restauracion lo llevo a HEAD y con eso deshizo tambien el fix (estaba sin commitear).
Re-apliqué el fix byte-exacto (confirmado: blob de working tree `7184e95`, identico al header del diff
original; `git diff` de WheelPicker.tsx = identico al fix del implementer). Working tree final = estado de
entrada (436 inserciones / 58 borrados en los 4 archivos). NO se edito logica del fix.
