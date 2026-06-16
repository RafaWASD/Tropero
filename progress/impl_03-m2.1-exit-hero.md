baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

# impl — spec 03 M2.1: ExitJornadaSheet + Hero adaptativo por conexión

Feature en curso: **03-modo-maniobras** (`in_progress`, spec aprobado). Chunk: identificación de la manga (`app/app/maniobra/identificar.tsx`).

Dos partes en un solo pase (diseño ya decidido por leader+Raf — se cablea, no se rediseña):

## PARTE A — Botón volver (‹) → ExitJornadaSheet con "Terminar jornada"
- T1: pasar `onBack` al `SpikeSessionHeader` → abre un bottom sheet de salida (no navega atrás directo).
- T2: nuevo `ExitJornadaSheet` (reusa idiom de `ManeuverConfigSheet`: scrim tappable + guard tap-through `readyToDismissRef` doble-rAF + safe-area + grip). Contexto arriba ("Llevás N animales hoy"). 3 acciones, NADA rojo:
  - Terminar jornada (primaria verde) → `closeSession(sessionId)` → cierre claro "Procesaste N animales" (paso de confirmación con "Listo") → navegar FUERA del flujo (`router.dismissAll()` → vuelve a `(tabs)`); si `ok:false`, error accionable es-AR + reintentar (fail-closed).
  - Salir sin terminar (outline) → navegar FUERA sin cerrar (sesión reanudable, R10.5/R10.6).
  - Seguir en la jornada (terciario / scrim) → cierra el sheet.

## PARTE B — Hero adaptativo por estado de conexión (solo "escuchando", outcome===null)
- T3: ramificar el render del estado "escuchando" en 3 sub-estados según `isConnected` (de `useBleStickListener`) + `transport = useBleProviderApi()?.transport != null`:
  1. CONECTADO → `ScanHero` actual (sin cambios).
  2. DESCONECTADO + CONECTABLE (`!isConnected && transport!=null`) → nuevo `ConnectHero`: disco = BOTÓN activo (StickIcon + Bluetooth), tap → `api?.transport?.connect()`. Manual como banda secundaria; compacta cuando el manual está expandido.
  3. DESCONECTADO + NO CONECTABLE (`!isConnected && transport==null`) → MANUAL PROMOVIDO: sin disco, `ManualEntry` expandida por default, tono neutro.
- Solo aplica a outcome===null; las ramas de outcome quedan igual. Reacciona en vivo a isConnected/transport.

## Tests (T4)
- Extender `app/e2e/maniobra-identify.spec.ts`: exit sheet (terminar/salir/cancelar/scrim tap-through con hasTouch); hero adaptativo (3 sub-estados con mock de transporte/BLE).

## Reconciliación de specs (T5)
- `design.md` §6.bis.8 (as-built): back→sheet "Terminar jornada" (R10.7 + salir reanudable R10.5/R10.6) + hero adaptativo por conexión (R3.6/R3.7).

## Deliverable veto leader (T6)
- Capturas web táctil 360 + 412 de: hero conectado, ConnectHero, manual promovido, ExitJornadaSheet, paso de confirmación "Procesaste N animales" → `tests/modo-maniobra/`.

---

## As-built (resumen)

**PARTE A — ExitJornadaSheet (surfacing R10.7 + salida reanudable R10.5/R10.6)**
- Nuevo `app/app/maniobra/_components/ExitJornadaSheet.tsx`: scrim `$scrim` tappable + sheet anclado + grip + safe-area + **guard tap-through `readyToDismissRef`** (doble-rAF + fallback `setTimeout(0)`, idéntico a `ManeuverConfigSheet`). Contexto "Llevás N animales hoy". 3 acciones, NADA rojo: Terminar jornada (primaria → `onTerminar()` que envuelve `closeSession`; al OK → fase de confirmación "Procesaste N animales" + "Listo"; al `ok:false` → fail-closed: error es-AR + reintenta) / Salir sin terminar (outline → `onExit` sin cerrar) / Seguir en la jornada (terciario texto → `onClose`). Scrim phase-aware: en `terminated` también navega fuera.
- `identificar.tsx`: `onBack={openExitSheet}` al `SpikeSessionHeader`; `onTerminarJornada` (= `closeSession(sessionId)`, sessionId del param); `exitManiobraFlow` = `router.canDismiss() ? router.dismissAll() : router.replace('/(tabs)')`.

**PARTE B — hero adaptativo por conexión (R3.6/R3.7), solo `outcome===null`**
- Decisión PURA `app/src/utils/maniobra-listen-state.ts` (`resolveListenConnState`/`isManualPromoted`) sobre `{isConnected, conectable}` (conectable = `useBleProviderApi()?.transport != null`).
- 3 sub-estados: `connected`→`ScanHero` (sin cambios) / `connectable`→`ConnectHero` (NUEVO, disco = botón `testID="connect-stick-disc"` + StickIcon + badge Bluetooth, tap→`connect()`) / `manual`→`ManualPromptHero` (NUEVO, sin disco) + `ManualEntry` con prop `promoted` (expandido + sin "Cancelar").
- E2E del sub-estado `manual` (`transport==null`): flag secundario `__RAFAQ_BLE_E2E_MANUAL__` (doble-gateado por `isBleE2E`) → `ProviderMode='manual'` → `instantiateTransport`=null. Sin superficie de prod.

## Trazabilidad R<n> → archivo:test

| R<n> | Cubierto por |
|---|---|
| **R10.7** (cerrar la jornada, surfacing) | `maniobra-listen-state` N/A; e2e `app/e2e/maniobra-identify.spec.ts` **(i)** "salida → terminar jornada" → `waitForServerSessionClosed(sessionId)` (oráculo server: `sessions.status='closed'`) + "Procesaste N animales" + navega fuera (`waitForHome`). |
| **R10.5/R10.6** (salir sin terminar = reanudable) | e2e `maniobra-identify.spec.ts` **(j)** "salir sin terminar" → `readServerSessionStatus(sessionId)==='active'` + navega fuera. |
| (sheet no-destructivo / seguir / cancelar) | e2e `maniobra-identify.spec.ts` **(k)** "seguir en la jornada" → cierra el sheet sin navegar. |
| (tap-through web táctil, `reference_rn_web_pitfalls`) | e2e `maniobra-identify.spec.ts` **(l)** `hasTouch:true` + `touchscreen.tap()`: abrir con tap NO auto-cierra (guard) + backdrop deliberado SÍ cierra. |
| **R3.6/R3.7** (hero adaptativo por conexión) | unit `app/src/utils/maniobra-listen-state.test.ts` (4 casos: los 3 sub-estados + `isManualPromoted`); e2e `maniobra-identify.spec.ts` **(m)** conectado↔conectable en vivo (ConnectHero `connect-stick-disc` tap → ScanHero; disconnect → vuelve a ConnectHero). |
| (sub-estado manual-promovido `transport==null`) | captura `app/e2e/captures/maniobra-exit-hero.capture.ts` (flag `__RAFAQ_BLE_E2E_MANUAL__`) → `identify-manual-promovido-{360,412}.png` (no expresable con el mock-adapter en web; sub-estado puro testeado en `maniobra-listen-state.test.ts`). |

## Autorrevisión adversarial

Busqué activamente como revisor hostil:
- **(a) Desviaciones del spec**: confirmé que la lógica adaptativa aplica SOLO a `outcome===null` (las ramas found/unknown/other/ambiguous quedan idénticas; el `ambiguous` refleja el sub-estado de fondo). Las 3 acciones del sheet + NADA rojo + contexto N respetan el diseño dado por el leader.
- **(b) Bugs / edge cases**: **CACÉ** que dismissar el sheet por scrim DURANTE la fase de confirmación (jornada ya cerrada) dejaba al usuario en la pantalla de identificación con una sesión cerrada (estado raro). **Cerrado**: `onBackdropPress` phase-aware → en `terminated` navega fuera (igual que "Listo"). Pluralización es-AR N=1 ("animal"). Guard `terminating` anti doble-`closeSession`. `manualPromoted` reactivo (si aterriza transporte en vivo deja de promover).
- **(c) Seguridad**: frontend puro, sin migraciones. `sessionId` SIEMPRE del param (nunca hardcodeado); `closeSession` re-valida RLS al subir. El flag `__RAFAQ_BLE_E2E_MANUAL__` es doble-gateado por `isBleE2E()` (sin marca → false → transporte real); sin camino de usuario para activarlo; mismo patrón que `__RAFAQ_BLE_E2E__` que Gate 2 ya audita. No expongo helpers como RPC.
- **(d) Offline-first / multi-tenant**: `closeSession` es CRUD-plano offline (write local siempre ok offline → confirmación inmediata; rechazo de RLS es async al subir, no bloquea); "Salir sin terminar" no escribe nada → sesión reanudable por `getActiveSession`. Multi-tenant: el cierre opera sobre la sesión por id; RLS `has_role_in` re-valida.
- **(e) Tests que pasan por la razón equivocada**: el e2e (i) NO se conforma con la UI — usa el oráculo server `waitForServerSessionClosed` (prueba que el UPDATE de cierre llegó REAL al server). (j) prueba el REJECT del cierre (status sigue `active`). (m) ejercita el path real (tap del disco → `connect()` → ScanHero en vivo + disconnect → ConnectHero).
- **CACÉ una regresión de mis propios cambios**: el hero adaptativo cambió el estado inicial de "escuchando" (con mock conectable, ahora arranca en ConnectHero, no ScanHero) → 5 specs e2e que esperaban "Acercá el bastón" tras "Arrancar jornada" sin conectar el mock (`maniobra-{carga,elegir,sanitaria,tacto-bugfix}` + `maniobra-wizard`). **Cerrado**: los helpers de carga/elegir/sanitaria/tacto-bugfix conectan el mock antes de asertar el ScanHero (camino conectado que asumen); el wizard (sin flag de mock → web-serial → conectable) ahora asierta ConnectHero (su estado genuino).

## Reconciliación de specs
- `design.md` **§6.bis.8** (NUEVO): as-built completo de A (ExitJornadaSheet + routing `dismissAll`) + B (hero adaptativo 3 sub-estados + flag E2E secundario).
- `requirements.md`: nota de reconciliación bajo **R10.7** (superficie de cierre = ExitJornadaSheet) y **R3.6/R3.7** (hero adaptativo). NO se reescribieron los EARS.
- `tasks.md`: bloque **M2.1-exit-hero** `[x]` con detalle as-built + tests + archivos.

## Verificación
- `npx tsc --noEmit`: **0 errores**. `check-hardcode.mjs`: **0 violaciones**. unit `maniobra-listen-state.test.ts`: **4/4**.
- e2e `maniobra-identify.spec.ts`: **18/18** (1-8 previos + i/j/k/l/m nuevos).
- **NOTA check.mjs**: el rojo del check completo es el flake conocido de terminales paralelas (`animals_tag_unique` 23505 duplicate-key en la suite BACKEND `animal` por seed concurrente de otra terminal — `reference_check_red_rate_limit` / `feedback_parallel_terminals`), NO regresión: este chunk es frontend puro (typecheck + anti-hardcode + client unit + e2e de maniobras verdes).
- Capturas deliverable (web táctil, 360 + 412) en `tests/modo-maniobra/`: `identify-{connected,connecthero,manual-promovido,exit-sheet,exit-confirmacion}-{360,412}.png` (10 archivos).
