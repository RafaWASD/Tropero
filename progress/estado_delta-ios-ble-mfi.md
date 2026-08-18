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
| **F3** | `adapter-ble-gatt` | ✅ **commiteada `a9d81ff`** | review CHANGES_REQUESTED (🟠-1: fixtures con un solo juego de parámetros) → fix-loop → **re-falsificado por el leader**: quitarle el delimitador al driver **cae**. 17 mutantes, 17 muertos |
| **F4** | Selección/prioridad + driver del emulador | ✅ **commiteada `54b72f8`** | review CHANGES_REQUESTED (2 🟠: iOS construía el manager en el arranque contra lo que el comentario afirmaba · `ble-gatt` inalcanzable en Android por falta de escritor) → fix-loop → **re-falsificado por el leader**: el mutante eager mata el test que lo nombra |
| **F5** | `adapter-mfi-ios` prearmado | ✅ **commiteada `7f4a0bf`** | El hallazgo más grave de la unidad: **RBM4.7 era FALSO con la suite entera en verde** — `getBondedDevices()` no copia `protocolStrings`, así que MFi habría seguido muerto el día que llegara la cadena. Re-falsificado por el leader: revertir rompe 10 tests |
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

## F4 — clasificación de los 6 rojos (leader, 2026-08-17)

El agente de F4 murió dos veces (límite de sesión y watchdog) dejando `tsc` en verde y 6 tests rojos. **Los
seis no son iguales**, y confundirlos es cómo se acepta una regresión en silencio. Clasificados contra la
spec ANTES de mandar a arreglarlos:

**Legítimamente obsoletos** — el delta los vuelve falsos a propósito. Se actualiza el test **citando el
requisito que lo autoriza**:

1. `RMV6.2/6.3: ble-gatt y mfi no tienen adapter buildable (null)` → **RBM7.1** (dejan de ser "fuera del delta").
2. `RMV6.1/6.2: driver mfi-only en iOS → binding null` → F4 cablea el binding de MFi (**RBM4.4/4.5/RBM5.5**).

**Sospechosos de REGRESIÓN** — la spec dice que estos caminos NO cambian. Default: **el código está mal, no
el test**:

3. `RMV2.3/2.4: RS420 en android` → **RBM5.4**, la prioridad de Android no cambia.
4. `RMV2.2/2.4: driver solo-HID en android` → ídem.
5. `RMV2.2/2.4: driver HID genérico en iOS` → si el driver declara **solo** `ble-hid`, el orden de prioridad
   no debería cambiar su resultado; si cambió, hay algo más.
6. 🔴 `RMV2.7: selectTransportAdapter(auto/mock/manual) devuelve EXACTAMENTE lo de antes` → **RBM5.9 lo
   prohíbe explícitamente**.

~~**Sospecha concreta para 3/4/6**: **RBM5.6** puede haber cambiado el camino por defecto de Android.~~

**❌ FALSIFICADA (2026-08-17).** La escribí yo como sospecha concreta y **estaba equivocada**. Medido: sin
preferencia recordada la selección **sí** cae al piso por plataforma, y el mutante que mueve la rama de la
preferencia antes de `mock` **muere**. **Ninguno de los 7 rojos era regresión** (eran 7, no 6: el séptimo
estaba en `wiring.test.ts`).

Lo que realmente eran:
- **3/4/5** — `adapterKind` y `transportKind` **idénticos**; lo único que cambió es la clave nueva
  `unavailableReason:'adapter-no-construido'`, cambio de **forma** autorizado por RBM4.5 + RBM5.14.
- **6** — de sus 8 aserciones falla **una**: `ios/auto`. RBM5.9 congela `auto` *"en Android y en web"*, y el
  design §6.2 dice literal que iOS pasa de `manual` a `ble-gatt`. Android sigue en `spp-android`.

**La lección de método, que es lo que vale**: la clasificación previa sirvió para que nadie pusiera los tests
en verde editándolos, pero **una sospecha del leader es una hipótesis, no un hallazgo** — y esta se cayó
contra la medición. Que se mida siempre antes de tratarla como cierta.

## Dos bugs que NO estaban en los rojos (los cazó la autorrevisión de F4)

- **El CTA "Olvidar el bastón guardado" quedaba escondido por la preferencia misma**: vivía dentro de
  `{isSpp ? …}` y desde RBM5.6 la preferencia monta `ble-gatt` → `isSpp` false → **R6.6 incumplido por
  ubicación**, sin salida posible. Un bastón recordado que ya no existe y ningún botón para olvidarlo.
- **La pantalla persistía el `vendorId` como si fuera un id de device.** Bug **vivo** con el adapter BLE,
  porque `connect()` usa el id recordado **en vez de escanear**. Era deuda ⚪-K del backlog desde julio y
  esta fase la volvió real. → El reviewer de F4 tiene orden de **barrer la clase**, no la instancia.

### Veredicto de los 7 rojos (implementer, 2026-08-17) — ninguno era regresión, y se midió

El séptimo estaba en `wiring.test.ts` (`R7: en iOS (auto) … piso manual`), misma causa que el 6º.

- **1 y 2**: obsoletos a propósito, como estaban clasificados. Reescritos citando RBM5.2/RBM7.1 y
  RBM4.4/4.5/RBM5.5.
- **3, 4 y 5**: **NO son regresión de RBM5.4/Android.** Medido: `adapterKind` y `transportKind` son
  **idénticos** en los tres; la única diferencia es la clave nueva `unavailableReason:'adapter-no-construido'`.
  Es un cambio de FORMA del `ReaderBinding` que autorizan RBM4.5 (el motivo tiene que ser explícito) y
  RBM5.14 (la UI dice la verdad). Se agregó el invariante "todo `available:false` trae motivo" sobre la
  matriz completa y se reconcilió `requirements` + `design §6.1`.
- **6**: **NO viola RBM5.9.** De sus 8 aserciones falla UNA: `ios/auto`. RBM5.9 congela `auto` *"en Android
  y en web"* y el design §6.2 dice literal *"iOS pasa de 'manual' a 'ble-gatt' como piso"*. Android sigue
  en `spp-android` y web en `web-serial`. Se partió en dos tests: uno congela lo congelado, el otro declara
  el único cambio con su autorización citada.
- **La sospecha de RBM5.6 quedó falsificada**: sin preferencia recordada la selección **cae al piso por
  plataforma** (`spp-android` en Android), la rama de la preferencia va después de `mock`/`demo`/`manual`, y
  el mutante que la mueve al principio **muere**.

**Dos bugs propios encontrados en la autorrevisión** (no estaban en los rojos): el CTA "Olvidar el bastón
guardado" quedaba **escondido por la preferencia misma** (vivía dentro de la rama `isSpp`, y la preferencia
monta `ble-gatt` → `isSpp` false → R6.6 incumplido por ubicación), y la pantalla persistía el **`vendorId`
como si fuera un id de device** — que con el adapter BLE es un bug vivo (`connect()` usa el id recordado en
vez de escanear). Los dos cerrados con guard y mutante.

## Regla de proceso que esta unidad dejó (2 agentes caídos)

`tsc` verde **no** confirma cableado. Ante un agente muerto mid-tarea: medir el árbol (typecheck **+** correr
las suites **+** buscar imports muertos y leer los archivos de integración) **antes** de relanzar, y relanzar
**un agente fresco y angosto** con el diagnóstico ya servido, no resucitar el transcript largo.

## F5 — estado tras el 3er agente caído (leader, 2026-08-17)

Tres agentes murieron en esta unidad: **límite de sesión** (F3), **watchdog** (F4) y **conexión perdida**
(F5). En los tres casos el árbol quedó con `tsc` en verde y trabajo a medias.

**Invariantes de RBM4.3/4.6 pre-registrados por el leader ANTES de que F5 reportara — los tres SE
MANTUVIERON**: `UISupportedExternalAccessoryProtocols` sigue `[]`, `driver-rs420.ts` tiene **0** menciones de
`mfi`, y no hay dependencias nuevas (51 deps, 2 de Bluetooth). Verificar por comparación contra un baseline
pre-registrado sale más barato que leer un informe y creerle.

**Estado**: `adapter-mfi-ios.ts` existe (sin suite propia todavía), `ea-protocols` a medio extender.
`tsc` rc=0 · **173 pasan / 10 fallan**.

### Los 10 rojos son LOS GUARDS DE F4 HACIENDO SU TRABAJO

No son regresión: son las redes que el fix-loop de F4 puso, disparándose porque F5 construyó un transporte
sin terminar de cablearlo.

- `🟠-2 GUARD SOBRE LA AUSENCIA: todo transporte construido y usable es ALCANZABLE en su plataforma` → saltó
  en cuanto existió `adapter-mfi-ios` sin su camino de alcance. **Es el guard que se pidió justamente para
  que un transporte nuevo naciera en rojo si nadie puede seleccionarlo.**
- `🟡-3: los módulos habilitados a ESCRIBIR el bastón recordado son una lista CERRADA` → F5 agregó un
  escritor y no lo registró.
- `RBM5.6 fail-closed: una preferencia mfi-ios no se honra hasta que F5 construya su adapter` → test de F4
  **legítimamente obsoleto**: se reescribe citando RBM4.4/4.5.
- `🟠-2: un transporte que la selección NO honraría no se ofrece` → ídem, revisar contra el as-built.
- `RBM5.5/RBM4.7: la pantalla pasa la lista REAL de protocolos declarados, no un [] literal` → test **nuevo
  de F5**, todavía no satisfecho.

⚠️ **Al cerrar F5, la regla de F4 sigue valiendo**: un test viejo solo se reescribe si la spec cambió ese
comportamiento a propósito, **citando el `RBM<n>` que lo autoriza**. Los que son guards de alcance
(`🟠-2`, `🟡-3`) **no se aflojan**: se satisfacen cableando lo que falta.

## Gate 2 (security_analyzer, modo code) — FAIL → cerrado en `fae4f53`

**El HIGH no estaba en el código nuevo, y eso es la lección.** `line-framer.ts` acumulaba sin cota y **ese
archivo no lo tocó el delta**: lo que cambió es **quién lo alimenta**. Tenía un solo call site de producción
(web-serial, en web, detrás del gesto obligatorio de `requestPort()`); el adapter BLE lo puso **sobre una
radio que auto-conecta sin gesto**.

Tres reviews adversariales anteriores no lo vieron porque las tres miraron **los archivos del changeset**.
→ Pregunta que hay que agregar a toda review de una unidad que suma un consumidor o un transporte:
**"¿qué código que NO tocamos quedó expuesto a algo nuevo?"**

Agravantes que sólo se ven mirando el flujo: las defensas las **reseteaba el propio flujo** (cada chunk
refrescaba `lastDataAt`, y el chequeo de liveness pregunta si el device está conectado — el que inunda
**está** conectado). Y el disparador realista no es un atacante: **un lector con otro terminador**, el
BENCH-2 que ya se pagó en el SPP.

**Falsificación del leader, más fuerte que un test en rojo**: con el tope, 12/12 en <1 s; **sin el tope la
suite NO TERMINA** (timeout a los 7 min) — que es el síntoma de producción, no una metáfora.

**Lo que el Gate 2 verificó y quedó limpio** (no repetirlo): camino del EID, multi-tenant, Gate 1 N/A
cruzado por commit contra `--untracked-files=all`, manifiesto **mergeado** sin ubicación sin tope, sin
background BLE, clave del plist vacía con su guard vivo.

### Dos decisiones del leader sobre los §7 (en curso)

- **7.1 — allowlist del meta-guard, NO purgar prosa.** `ble/logging.ts` está a **2 líneas** de poner en rojo
  **9 guards**. Es un catálogo donde **la prosa ES el artefacto**; borrarla para satisfacer una heurística de
  cobertura optimiza la métrica **contra su propósito**. Estrena una allowlist vacía → va con entrada
  angosta, motivo en el lugar, y **guard sobre la propia allowlist** para que no se vuelva la salida de
  emergencia de todos.
- **7.2 — `errorCode:<n>` en vez del `message` crudo, barriendo la CLASE** (`ble-gatt` + `spp-android` +
  `mfi-ios`). Los mensajes de `ble-plx` interpolan el id del device, así que la MAC de **nuestro** bastón
  llega a los breadcrumbs. Precio aceptado y dicho: **se pierde legibilidad del log**, no diagnóstico (los
  códigos mapean 1:1 con las plantillas).
