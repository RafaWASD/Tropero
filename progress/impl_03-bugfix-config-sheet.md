# impl 03-bugfix-config-sheet — ManeuverConfigSheet se auto-cierra al abrir (web)

baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

> Bug reportado por Raf en testing en vivo (web), spec 03 MODO MANIOBRAS, wizard etapa 2 "ordenar".
> Frontend puro. Backend NO se toca. Feature `in_progress`, specs aprobadas. Una sola feature.

## Síntoma (Raf)
En la etapa 2 del wizard, al tocar el cuerpo de **Vacunación** (fila seleccionada configurable) para
agregarle una vacuna, el bottom sheet `ManeuverConfigSheet` **se abre y se cierra al instante** (~1ms).
No deja escribir ni leer. Solo en **web**. El e2e con clicks precisos de Playwright NO lo cazaba.

## CAUSA RAÍZ — CONFIRMADA CON REPRO + LOGGING DIAGNÓSTICO (no inferida)
Instrumenté el `bodyTap.onEnd` (ManeuverReorderList) y el `onPress` del scrim (ManeuverConfigSheet) con
`console.log`, y corrí un Playwright con un **context táctil** (`hasTouch:true`) usando `touchscreen.tap`.
Secuencia observada al tocar el cuerpo de Vacunación:

```
[DIAG] bodyTap onEnd success=true configurable=true       ← el tap ABRE el sheet (setConfigManeuver)
[DIAG] scrim onPress fired, ready=false  (~20ms después)  ← el CLICK HUÉRFANO cae sobre el scrim
```

Mecánica exacta:
1. El cuerpo de la fila configurable abre el sheet con un **`Gesture.Tap()` de react-native-gesture-handler**
   (`ManeuverReorderList.tsx` `bodyTap` → `runOnJS(onOpenConfig)` → `jornada.tsx` `setConfigManeuver` → el
   sheet monta un tick después). El gesto de RNGH web resuelve en **`pointerup`**.
2. En **web táctil**, tras el `touchend` el navegador **emula** una secuencia de mouse
   (`mousedown → mouseup → CLICK`) y dispara ese `click` **~20ms después**, **re-hit-testeándolo** contra lo
   que esté bajo el dedo en ese momento.
3. Para entonces el sheet **ya montó** y su **`$scrim`** (un `Pressable` full-screen con `onPress=onClose`)
   está justo bajo el dedo → el **click huérfano emulado** cae sobre el scrim → `onClose` → cierra a ~1ms.
4. En **native** el gesto consume el touch y **no hay click emulado suelto** → por eso SOLO se ve en web.

El diagnóstico del leader fue correcto en la dirección (tap-through al backdrop); el matiz preciso es que
el click huérfano es la **emulación touch→mouse→click** del browser (no un click de mouse cualquiera) — por
eso requiere `hasTouch:true` para reproducirse.

## FIX (robusto, no rompe native ni el cierre intencional)
`app/app/maniobra/_components/ManeuverConfigSheet.tsx`:
- Guard `readyToDismissRef` (`useRef(false)` — no estado, el scrim lo lee en el `onPress`, sin re-render).
- Un `useEffect` lo arma en el **PRÓXIMO frame** vía **doble `requestAnimationFrame`** (fallback
  `setTimeout(0)` si no hay rAF / sin DOM). Cleanup cancela rAF/timer al desmontar.
- El `onPress` del scrim (`onBackdropPress`, línea ~105) hace `if (!readyToDismissRef.current) return;`
  antes de `onClose()`. → El click huérfano del open (que llega dentro de la ventana de ~2 frames / ~33ms)
  **NO cierra**; un tap **deliberado** posterior del usuario en el backdrop **SÍ** cierra (la salida por
  backdrop sigue viva, R3/UX).
- El guard es **SOLO para el scrim**. Cancelar (`onClose` directo), Guardar, chips ×, sugerencias y el input
  **no pasan por `onBackdropPress`** → andan desde el 1er tick. (Verificado: el e2e del wizard ejercita
  Guardar/limpiar/chips/sugerencias y pasa; el race spec tipea en el input apenas abre.)

### Alcance: `CutPromptSheet` (DientesStep, R6.8) NO necesita el guard — VERIFICADO, no asumido
Inicialmente extendí el mismo guard al `CutPromptSheet` ("patrón idéntico"). La **autorrevisión adversarial
lo cazó**: corrí la misma repro táctil + logging sobre el prompt CUT (tocar el bloque de dientes `1/2` con
`touchscreen.tap`). Resultado: **el scrim del CUT prompt NUNCA recibe el click huérfano** (`logs: []`, el
sheet queda abierto). Razón: el bloque de dientes abre el sheet con el **`onPress` de Tamagui** (driven por
el evento **`click`**, que lo **consume**) → no queda un click suelto para el scrim. El race solo aparece
cuando el sheet lo abre un `Gesture.Tap` de RNGH (driven por `pointerup`, que deja el `click` nativo libre).
→ **Revertí el guard del CutPromptSheet** (era dead code que retrasaba el dismiss legítimo ~2 frames sin
mitigar ningún bug) y dejé solo una **nota** en el archivo explicando por qué no lo necesita.

## REGRESIÓN E2E — caza el race de verdad (probado fail-without / pass-with)
**Hallazgo clave de por qué el e2e viejo no lo agarraba** (doble motivo):
1. El wizard spec usaba `locator.click()` → mouse sintético sobre el target ya resuelto, **sin re-hit-test**
   del `click` contra el scrim recién montado → el race no aparece.
2. Y corre en el project **default (Desktop Chrome, `hasTouch:false`)** → **sin** la emulación
   touch→mouse→click que dispara el bug.

Confirmé empíricamente que **ni `locator.click()` ni `page.mouse.down/up`** reproducen el race (logging:
el scrim nunca recibe el click). La **única forma fiel en Playwright** es un context con `hasTouch:true` +
`page.touchscreen.tap()` (touch real → el browser emite el click emulado hit-testeado al dispatch).

Nuevo spec `app/e2e/maniobra-config-sheet-race.spec.ts` (abre su propio context táctil, el default no lo es):
- **CASO 1** (caza el race): tap **táctil** en el cuerpo de Vacunación → assert sheet visible → `waitForTimeout(500)`
  (deja pasar el click huérfano + el doble rAF) → **re-assert sheet SIGUE visible** → tipea "Brucelosis" y
  verifica el value (el sheet quedó interactivo). **Con el bug presente este assert falla** (sheet count 0).
- **CASO 2** (no rompimos la salida): tap **táctil deliberado** sobre el scrim (zona alta libre) → el sheet
  cierra (`count 0`) → la fila vuelve al hint (cerrar por backdrop ≠ guardar).

**Probado en ambas direcciones (rebuild completo cada vez):**
- Fix presente → `maniobra-config-sheet-race.spec.ts` **PASA** (1 passed).
- Fix revertido (scrim `onPress={onClose}`) → **FALLA** en la línea 93 (`toBeVisible` → element(s) not found:
  el sheet se auto-cerró). → el e2e **caza** el race.

## AUTORREVISIÓN ADVERSARIAL (qué busqué / qué encontré / cómo cerré)
- **¿El fix resuelve el bug reportado?** Sí — probado con repro táctil (scrim onPress con `ready=false` →
  bloqueado → sheet queda) y con el race spec fail-without/pass-with.
- **¿El backdrop deliberado sigue cerrando?** Sí — CASO 2 del race spec. El guard arma en ~33ms, imperceptible
  para un tap humano. Cancelar (botón) nunca pasó por el guard.
- **¿Re-open rápido / leak?** Cada mount = `readyToDismissRef` fresco + effect nuevo; cleanup cancela rAF/timer.
- **¿Tests que pasan por la razón equivocada?** El e2e viejo (mouse, sin touch) daba **falso verde aun CON el
  bug** — lo diagnostiqué y reemplacé por uno táctil que falla sin el fix. No dejé el assert engañoso en el
  wizard spec: lo saqué y dejé una nota apuntando al race spec (hasTouch).
- **¿Extendí el fix sin necesidad?** Sí, al CutPromptSheet — la autorrevisión lo cazó con repro táctil
  (no tiene el race) → revertido a una nota. (Caso de no ser pasamanos de mi propia primera intención.)
- **¿Cero hardcode / patrón as-built?** El guard usa solo APIs estándar (rAF/ref); el resto del sheet intacto.

## RECONCILIACIÓN DE SPECS (as-built, antes del reviewer)
El *qué* de R1.7 (pre-configurar params de tanda una vez) NO cambió — el sheet abre, configura, guarda y el
backdrop dismiss sigue igual; solo se endureció el *cuándo* del dismiss contra un race de UI. Por eso NO toqué
los EARS de `requirements.md` (la regla: reconciliar requirements solo si cambia el *qué*). Reconciliado:
- `design.md` §6.bis.1 → **As-built v5**: causa raíz, fix (guard doble-rAF), alcance (CutPromptSheet NO lo
  necesita y por qué), y la regresión táctil.
- `tasks.md` M1.4 → **As-built v5** + `Archivos` actualizado (ManeuverConfigSheet v5, DientesStep nota,
  `maniobra-config-sheet-race.spec.ts` NUEVO).

## ESTADO
- `node scripts/check.mjs`: **RC=0 VERDE** (typecheck + anti-hardcode + 1174+ unit + suites backend; sin flake).
- e2e: `maniobra-config-sheet-race` **1/1** (regresión nueva, táctil) · `maniobra-wizard` **1/1** (smoke) ·
  `maniobra-elegir` **2/2** (regresión del CUT prompt, intacto tras revertir el guard innecesario).
- Diagnósticos y specs throwaway eliminados; logging removido de los 2 componentes.

## Archivos tocados
- `app/app/maniobra/_components/ManeuverConfigSheet.tsx` — guard `readyToDismiss` + `onBackdropPress` (FIX).
- `app/app/maniobra/_components/DientesStep.tsx` — NOTA: por qué su scrim NO necesita el guard.
- `app/e2e/maniobra-config-sheet-race.spec.ts` — NUEVO, regresión táctil (caza el race).
- `app/e2e/maniobra-wizard.spec.ts` — nota apuntando al race spec; revertidos los asserts engañosos (mouse).
- `specs/active/03-modo-maniobras/design.md` (§6.bis.1 v5) + `tasks.md` (M1.4 v5).

## NO done
No marco `done`. Espera reviewer + Gate 2.
