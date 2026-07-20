baseline_commit: 672149bb0ab0c9dedc35a32ce81cef7b43d69b37

# impl — spec 04 delta «multivendor» — Gate 2.5 (E2E de regresión + capturas de veto) — T-MV.7.2

**Feature en curso**: spec 04 DELTA multivendor — entregables del **Gate 2.5 (ADR-029)** para la pantalla de
conexión + demo. Es un run de **TEST-ONLY**: NO se tocó código de producción (todos los testIDs/anclas ya
existían en la UI construida y verde). Dos artefactos:

1. `app/e2e/baston-multivendor.spec.ts` — suite de **regresión E2E** (contra el simulador/demo).
2. `app/e2e/captures/baston-multivendor.capture.ts` — **capture file** de veto visual (6 shots).

## Plan (ejecutado)

- T1 — Leer specs (`requirements/design/tasks-multivendor.md`) + la UI construida (`StickConnectionScreen`,
  `DemoControls`, `StickDeviceRow`, `StickStatusIndicator`, `connection-view`) + el wiring host-level
  (`_layout.tsx` precedencia demo, `demo-gate.ts`, `BleStickListenerProvider` `instantiateTransport`) + los
  patrones E2E/capture (`rodeo-grande.spec.ts`, `lotes-venta.capture.ts`, helpers admin/ui/fixtures). ✅
- T2 — Escribir la suite E2E (4 casos) contra el simulador/demo. ✅
- T3 — Escribir el capture file (6 shots nombrados). ✅
- T4 — tsc (base + targeted e2e) + correr E2E (verde) + correr capture (shots generados) + verificar shots. ✅
- T5 — Reconciliar `tasks-multivendor.md` (T-MV.7.2 `[x]`) + progress. ✅

## Cómo se activa la demo (recordatorio del contrato)

`addInitScript` (ANTES del bundle) setea `window.__RAFAQ_BLE_E2E__ = true` **y** `window.__RAFAQ_BLE_DEMO__ =
true`. Con ambas, `isDemoMode()` = true (`isDemoBuildAllowed()` acepta el contexto E2E vía `isE2eDemoAllowed()`)
→ `_layout.tsx` da precedencia `mode='demo'` → el provider raíz monta el `SimulatorAdapter` + `DemoControls`.
Una corrida E2E **normal** (solo `__RAFAQ_BLE_E2E__`) sigue en `mock` (regresión intacta, caso (d)).

## (1) Suite E2E — `app/e2e/baston-multivendor.spec.ts` — 4/4 verde

| Caso | Qué prueba | RMV |
|---|---|---|
| (a) | La `StickConnectionScreen` MONTA en `/baston` bajo demo: RS420 **reconocido** en web (`recognized-available`, "Allflex RS420" + "Reconocido. Tocá para conectar."), "Simular lectura" presente, carga **manual** disponible (no bloqueante). | RMV3.1, RMV3.2, RMV3.4, RMV3.6, RMV4.5 |
| (b) | Tocar "Simular lectura" → EID sintético por el **mismo contrato** → **find-or-create** disparado (overlay con el EID = confirmación pre-commit R2) + la lectura marcada **DEMO** en la lista de la pantalla (`aria-label "Caravana <15 díg> DEMO"`). | RMV4.2, RMV4.6, RMV4.8 |
| (c) | **Estados** con CTA: off ("Conectar bastón") → conectado ("Desconectar" + indicador global visible) → desconectado ("Volver a conectar"); manual disponible en cada estado. | RMV3.4, RMV3.5, RMV3.6 |
| (d) | **REGRESIÓN**: corrida E2E **no-demo** (solo `__RAFAQ_BLE_E2E__` → `mock`) NO monta `DemoControls` (`demo-simulate` count 0) NI el indicador global (`stick-status-indicator` count 0, `isNonDemoE2E` lo suprime aunque el mock conecte), y el bridge mock **sigue abriendo el overlay** (find-or-create) como HOY. | RMV4.3 (guard 1), regresión del chrome |

**Trazabilidad RMV → test concreto:**

| RMV | Cubierto por |
|---|---|
| RMV3.1 (pantalla en "Más", consume provider global) | `baston-multivendor.spec.ts` (a) — monta en `/baston` |
| RMV3.2 (descubrir→listar→elegir→conectar por adaptador) | (a) — fila RS420 `recognized-available` + `TransportInstructions` serial |
| RMV3.4 (estados con CTA) | (c) — off/conectado/desconectado + CTAs |
| RMV3.5 (indicador global) | (c) — `stick-status-indicator` visible bajo demo; (d) — suprimido no-demo |
| RMV3.6 (no bloqueante / manual) | (a), (c) — InfoNote "¿Sin bastón?" presente en cada estado |
| RMV3.7 / RMV3.8 (available:false / unrecognized) | **N/A E2E web** (RS420 = `recognized-available` en web) → cubierto por `connection-view.test.ts` (T-MV.4.6, node:test) |
| RMV4.2 (simulador por el mismo contrato) | (b) — lectura sintética → validate+dedup+confirm → find-or-create |
| RMV4.3 (guard 1: `auto`/`mock` nunca simulador) | (d) — no-demo → mock, sin DemoControls |
| RMV4.5 (guard 3: DemoControls solo bajo demo) | (a) — visible bajo demo; (d) — count 0 no-demo |
| RMV4.6 (marca DEMO en la confirmación/lista) | (b) — read-row `aria-label …DEMO`; capture `03` |
| RMV4.8 (confirmación pre-commit del simulador) | (b) — overlay find-or-create con el EID leído |

## (2) Capture file — `app/e2e/captures/baston-multivendor.capture.ts` — 6/6 shots

Shots a `app/e2e/captures/__shots__/baston-multivendor/` (gitignored — el `.capture.ts` SE COMMITEA, los
`.png` NO):

| Shot | Contenido | Verificado |
|---|---|---|
| `01-pantalla-conexion.png` | Pantalla cargada, estado **off**: card de estado + DemoControls + RS420 reconocido + Lecturas vacío + manual. | ✅ full-screen, no blanco |
| `02-demo-controls.png` | Banda del componente **DemoControls**: "Modo demo" DEMO + "Simular lectura" + "Reproducir automático". | ✅ band-clip |
| `03-lectura-demo-confirmacion.png` | Banda de la card **Lecturas (1)** con el read-row `032000000000000` **DEMO** + hora. | ✅ band-clip, badge DEMO visible |
| `04-find-or-create.png` | **FindOrCreateOverlay** disparado por la lectura demo: "Caravana leída" + EID legible + "Animal nuevo" + "Dar de alta". | ✅ full-screen |
| `05-estado-desconectado.png` | Estado **desconectado**: "Bastón desconectado" (terracota) + "Volver a conectar" + indicador global. | ✅ full-screen |
| `06-estado-conectado.png` | Estado **conectado**: "Bastón conectado" + "Desconectar" + indicador global. | ✅ full-screen |

**07/08 (device-no-reconocido / available:false)**: **N/A** — no alcanzables en el E2E web sin mockear
`Platform.OS` / inyectar un device sintético (el RS420 resuelve `recognized-available` en web). Los mapeos son
PUROS y quedan cubiertos por `connection-view.test.ts` (T-MV.4.6). Documentado en el header del `.capture.ts`.

**Nota para el leader (veto Gate 2.5):** en los shots 04/05/06 el **indicador global** del chrome ("Bastón
conectado/desconectado", pill superior) queda **pegado al header "Bastón"** y lo solapa — es un veto de
posición/estética esperado (design-multivendor §7 lo dejó explícitamente como "posición/estética final = veto
de diseño de Gate 2.5").

## Detalles de implementación que merecen registro

- **Retry-tap de la lectura simulada (`triggerDemoRead`)**: tras el `page.goto('/baston')` (deep-link, reload
  completo) el listener GLOBAL queda momentáneamente suspendido — el `useBleStickListener` del
  `FindOrCreateOverlay` lo re-habilita recién cuando el **rodeo activo re-resuelve** (warm-up de
  PowerSync/contextos post-reload). Un solo tap puede caer en esa ventana y el gate de escucha lo descarta
  (status "conectado" pero SIN lectura — confirmado en el primer run fallido). Fix: reintentar el tap con
  `expect(...).toPass()` — cada emisión del simulador es un EID **fresco** (seq++), así que reintentar NO choca
  con la dedup. El re-tap solo ocurre mientras NO hay overlay (al abrir, el bloque pasa → el scrim nunca
  intercepta un re-tap). Diagnóstico: caso (d) — que bastonea desde home SIN reload — nunca falló, lo que aísla
  el reload como la causa.
- **`.first()` en los textos de estado**: bajo demo el texto de estado aparece **dos veces** (la card de
  estado de la pantalla + el indicador global del chrome). Sin `.first()` el locator `{ exact: true }` viola
  strict-mode. (En una corrida no-demo el indicador se auto-suprime, así que ahí no hay duplicado — por eso el
  caso (a) con estado 'off', que auto-oculta el indicador, no necesita `.first()`.)
- **Auth + reload a `/baston`**: `waitForHome` ANTES del `goto('/baston')` garantiza que la sesión quedó
  persistida en localStorage (`persistSession:true`) → el reload la restaura y el gate NO expulsa `/baston`
  (no es ruta de gating/stranded). El find-or-create dispara un **lookup** (read) del EID sintético; NUNCA
  commitea (no se toca "Dar de alta") → cero escritura en la DB compartida.

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:

- **¿Los shots capturan el estado real (no pantalla en blanco)?** ✅ Leí los 6 PNG: 01 (off completo), 02
  (DemoControls aislado), 03 (read-row DEMO), 04 (overlay con EID legible), 05 (desconectado terracota), 06
  (conectado). Ninguno blanco/truncado.
- **¿La marca "DEMO" se ve?** ✅ En 03 (badge en el read-row) y en el `aria-label` asertado por el caso (b).
- **Redundancia de shots**: los primeros runs dieron `01==02` y `03==06` (bytes idénticos: la pantalla entera
  entra en 915px → mis "scroll to X" no cambiaban el frame). Corregido: 02 y 03 pasaron a **band-clips** del
  componente (DemoControls / card Lecturas) → 6 shots genuinamente distintos.
- **Regresión del chrome (elemento NUEVO global)**: el caso (d) prueba que el `StickStatusIndicator` **no** se
  monta en corridas E2E no-demo (aunque el mock conecte) → no duplica los textos de estado que las ~70 specs
  asertan `{ exact: true }`. Sin esto, el indicador habría roto specs ajenas. Verificado count 0.
- **Falso verde**: descarté que los tests pasaran "por la razón equivocada" — el caso (b) exige el overlay
  REAL (find-or-create con el EID) + el read-row con `…DEMO` en el `aria-label` (no un texto suelto "DEMO",
  que también existe en el pill de DemoControls). El `getByLabel(/^Caravana \d{15} DEMO$/)` es exclusivo del
  read-row del simulador.
- **Integridad SENASA (RMV4.7)**: nunca se toca "Dar de alta" → un EID demo jamás se declara; el marcado DEMO
  es explícito. El caso (d) confirma que sin demo NO hay camino al simulador.
- **Scope**: cero cambios de producción; los únicos archivos nuevos son los 2 de test. `design/` intacto (no
  corrí `e2e:build`, reusé el dist existente que ya tenía la UI demo horneada). Sin `git add -A`.

## Reconciliación de specs (paso 9)

- `tasks-multivendor.md` T-MV.7.2 → `[x]` con nota as-built (2 artefactos, 4 casos + 6 shots, N/A de
  RMV3.7/3.8 en E2E web, retry-tap, `.first()`).
- No hubo desvíos del `qué`: la suite cubre exactamente lo pedido por T-MV.7.2 (RMV3, RMV4.6, RMV4.8) contra el
  simulador. El único "no cubierto por E2E" (RMV3.7/3.8, available:false/unrecognized) ya estaba delegado a
  `connection-view.test.ts` (T-MV.4.6) por diseño — lo documenté como N/A del E2E web, no es un hueco nuevo.
- No se tocó `requirements-multivendor.md` ni `design-multivendor.md` (no cambió el comportamiento ni el
  contrato; el design §7 ya anticipaba el veto de posición del indicador para Gate 2.5).

## Resultados de verificación

- `pnpm typecheck` (base): **0 errores** (producción intacta).
- `tsc` targeted de mis 2 archivos (tsconfig temporal, borrado): **0 errores míos** (las únicas señales
  remanentes eran pre-existentes en `e2e/helpers/admin.ts` — `ws` sin tipos + 2 casts — que el pipeline real
  no typechequea y que NO debo tocar).
- `pnpm exec playwright test e2e/baston-multivendor.spec.ts`: **4 passed** (el `UV_HANDLE_CLOSING` + exit 127
  tras "4 passed" es el gotcha de teardown de Windows, no un fallo).
- `pnpm exec playwright test e2e/captures/baston-multivendor.capture.ts --config playwright.capture.config.ts`:
  **1 passed**, 6 shots escritos y verificados.

## Frontera / scope limpio

- CREADO: `app/e2e/baston-multivendor.spec.ts`, `app/e2e/captures/baston-multivendor.capture.ts`.
- NO tocado: ningún archivo de producción, ningún otro spec E2E, ni `helpers/admin.ts`/`helpers/ui.ts`, ni
  archivos de la otra terminal (reactividad-sync / teléfono). Los `M`/`??` de `services/ble/*` +
  `features/ble-stick/*` son de los implementers previos (services/UI), NO míos.
- `design/` intacto; `__shots__/*.png` + `test-results/` gitignored (no se commitean). Sin `git add -A`.
- NO commiteado (lo cierra el leader tras el reviewer + Gate 2.5).
