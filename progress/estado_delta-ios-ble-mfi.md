# Estado del delta `ios-ble-mfi` (feature 04) — handoff vivo

**Para qué existe**: la unidad son 8 fases y ya se perdió un agente por límite de sesión. Esto es lo mínimo
para retomar sin releer todo. **Fuente de verdad de QUÉ hacer**: `requirements-ios-ble-mfi.md` +
`tasks-ios-ble-mfi.md`. Esto es solo DÓNDE estamos.

Última actualización: **2026-08-17**, leader.

## Fases

| Fase | Qué | Estado | Evidencia |
|---|---|---|---|
| **F0** | Gate físico del HID | ⏸ **espera a Raf** (iPhone + ESP32 en mano) | Runbook listo: `progress/gate_hid-runbook.md`. **No cuesta build de EAS** |
| **F1** | El parser sale del registro de drivers | ✅ **commiteada `3272227`** | reviewer CHANGES_REQUESTED → fix-loop → **re-falsificado por el leader con un mutante nuevo** (`Object.values(DRIVER_REGISTRY)[0]`): compila y **4 tests caen** |
| **F2** | `react-native-ble-plx@3.5.1` + config + permisos + veto | ✅ **commiteada `3272227`** | Veto **FIRME**: `assembleDebug` local BUILD SUCCESSFUL 3m23s, **0 EAS**. `progress/veto_ble-plx.md` |
| **F3** | `adapter-ble-gatt` | 🔄 **en revisión** | 98 tests verdes, `tsc` rc=0. **Sin commitear** |
| **F4** | Selección/prioridad + driver del emulador | ⏳ pendiente | Bloqueada hasta que cierre la review de F3 (no mover el árbol bajo un reviewer) |
| **F5** | `adapter-mfi-ios` prearmado | ⏳ pendiente | — |
| **F6** | Banco ESP32 en `MODO_GATT`, en device | ⏳ pendiente | Android local; **iOS necesita OK de build de Raf** |
| **F7** | Adapter HID | ⏳ **condicional**: solo si F0 da verde | — |
| **F8** | Reconciliación + Gate 2 + cierre | ⏳ pendiente | ADR-024 ya enmendado (adelantado por el leader) |

## Lo que espera a Raf

1. **Pushear**: hay commits sin pushear, **4 son de la otra terminal** (rebrand fases 4 y 5, migraciones
   0132/0133 ya aplicadas a DEV). El leader no los empuja sin su OK.
2. **Gate F0**: cuando tenga el iPhone, el leader flashea el ESP32 a `MODO_HID` (30 s) y él empareja + mira
   la pantalla. Es lo único que no se puede automatizar.
3. **OK de build de EAS iOS** — solo para F6 (verificar el stream BLE en iPhone). Android es local.
4. **Tres llamadas a fabricantes**, con pedidos DISTINTOS: Gallagher → **documentación técnica** (su camino
   es BLE, no tiene key MFi que dar) · Allflex y **Datamars** → cadena iAP + licencia MFi.

## Cosas que ya nos mordieron en esta unidad (no repetirlas)

- **El guard que enumera nombres prohibidos persigue grafías.** Pasó dos veces: el reviewer esquivó el de
  F1 con una cuarta grafía y el leader con una quinta. El arreglo es un **oráculo de comportamiento** (fijar
  el valor devuelto por identidad), no sumar un nombre a la lista.
- **Un fixture con `??` pone tests en verde por el motivo equivocado.** En F3, `fakeDevice` devolvía los
  UUIDs para un device declarado `serviceUUIDs: null` → el "anónimo" no era anónimo. Se arregló el fixture +
  **meta-test** de que un anónimo sale anónimo. El reviewer de F3 tiene orden de barrer **todos** los
  defaults de esas suites, no solo ese.
- **`git diff <paths>` NO sirve como oráculo de "no toqué esto"**: mide el árbol (con dos terminales muestra
  trabajo ajeno) y es **ciego a los untracked**. Se usa `git status --porcelain` cruzado contra la lista de
  archivos del cambio.
- **`check.mjs` muere en el primer stage rojo** (`execSync` sin `try`) → cuando da rojo, **lo posterior no
  corrió**. Un RC=0 sigue siendo señal completa; un RC≠0 no dice nada del resto. (🔴 abierto en
  `docs/backlog.md`, lo encontró la otra terminal.)
- **Un `try/catch` mudo convierte una falla en "el operario no está bastoneando".** Todo camino de error
  tiene que ser distinguible en el log.

## Deuda declarada, no escondida

- El adapter BLE tiene **un solo consumidor conocido en el mercado y no lo tenemos** (Gallagher HR5 v3).
  Sale verificado contra el emulador, no contra hardware comercial. Está en el contexto §3.
- **No se registra ningún driver con UUIDs adivinados** (RBM5.11). Un fabricante entra al registro cuando
  entrega su documentación.
- El veto de `ble-plx` prueba que **compila, linkea y se empaqueta**; **no** prueba la reachability del
  puente en runtime (es un módulo de puente legacy bajo la capa de interop). Eso lo mide F6.
