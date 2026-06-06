# Spec 04 — Integración bastón lector RFID (EID) — Requirements (EARS)

**Status**: ✅ **Puerta 1 APROBADA por Raf (2026-06-03).** Gate 1 (security, modo spec) PASS (sin findings HIGH). En implementación. Status flip en `feature_list.json` pendiente (coordinación).
**Fecha**: 2026-06-03 (sesión 22+).
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/04-bluetooth-baston/context.md` (Gate 0 aprobado por Raf, sesión 22, 2026-06) + **ADR-024** (transporte: contrato de ingesta de EID transport-agnóstico + 5 adaptadores — **FUENTE DE VERDAD del transporte, no se re-decide**). Cada "Caso y decisión" del context queda cubierto por ≥1 `R<n>` (ver mapa de cobertura al final). No se re-decidió contexto ni transporte: se tradujeron a EARS.
**Related**: ADR-024 (contrato + adaptadores), spec 09 (`buscar-animal` — interfaz `BleStickEvent` / `useBleStickListener` / `BleStickListenerProvider` / `useBleConnectionStatus` / `useBusyMode` + mock que 04 **implementa**), spec 03 (`modo-maniobras` — consume `disableListener`/`enableListener`), ADR-002 (stack), ADR-018 (navegación: pantalla de conexión en "Más"; listener global = no es tab), `field-findings.md` (protocolo RS420 capturado + investigación de mercado), `android-spp-impl-plan.md` + `web-serial-dev-harness-plan.md` (planes de adaptadores), `app/src/services/ble/parser-rs420.ts` (commit `9126dba` — `parseRs420Line`/`isValidTag`/`normalizeTag`, reuso directo), CONTEXT/05 (hardware), CONTEXT/07 (día de campo).

> **Cambio respecto de la v1 de esta spec (2026-05-30).** La v1 (requirements/design/tasks del 30-may) asumía un único transporte **BLE GATT** (`react-native-ble-plx`) con UUIDs "a confirmar el día de campo". El día de campo y la investigación de mercado lo **refutaron** (el RS420 es Classic SPP+MFi; no hay GATT abierto en stick readers; el camino abierto cross-platform es BLE-HID keyboard-wedge). ADR-024 reemplazó ese supuesto por un **contrato multi-adaptador**, y el `context.md` se actualizó en consecuencia. Esta v2 reescribe la spec sobre ADR-024 + el context actualizado.

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". IDs estables, no reordenar tras aprobar. Cada `R<n>` verificable por ≥1 test.

> **Madurez por capa.** El **contrato de ingesta de EID** (R1 normalización/validación, R2 confirmación pre-commit, R3 dedup) + el **mock/wiring** (R10) + la **interfaz** (R11) son **firmes** — operan sobre `parser-rs420.ts` ya de-riskeado y la interfaz que spec 09 ya declaró. Los **adaptadores** se clasifican por madurez de hardware: `adapter-web-serial` (R5) + `adapter-manual` (R7) + `adapter-mock` (R10) son **buildables hoy** sin device; `adapter-spp-android` (R6, R12) requiere **dev build + teléfono Android** (Raf lo compra); `adapter-hid-wedge` (R8) está **GATED** por validación física en iPhone real (ADR-024 §4) — su implementación no arranca hasta pasar ese gate. La **UI** de conexión (R9) es **TENTATIVA** hasta cerrar el design system (mismo patrón que spec 09 R2): describe QUÉ hace la pantalla a nivel funcional, no el layout.

> **Manual-first es ley.** Principio rector del context: el bastón es *enhancement*. La app funciona entera sin él (carga manual, `adapter-manual`, puerta cero de spec 09 R1). Ningún estado del bastón ni del transporte deberá **nunca** bloquear la app, la carga manual ni el resto del flujo (R7, R9).

> **Qué implementa 04 vs. qué define spec 09.** Spec 09 ya declaró la interfaz consumidora (`useBleStickListener`, `BleStickEvent`, `BleStickListenerProvider`, `useBleConnectionStatus`, `useBusyMode`, mock con `mockTagRead`) y montó un stub (spec 09 T1.5). Spec 04 **implementa esa interfaz** sobre el contrato de ADR-024 — NO la redefine ni la contradice. El alcance del listener (en qué pantallas está activo, find-or-create, asignación masiva) lo gobierna spec 09; 04 provee los eventos `tag_read`/`connection_changed` y el control `enable`/`disable`.

---

## R1. Contrato de ingesta — normalización y validación del EID

> **Firme.** Vive en el contrato, no en cada adaptador (ADR-024 §1). Reusa `parser-rs420.ts` (`normalizeTag`/`parseRs420Line`/`isValidTag`) ya committeado y testeado (commit `9126dba`).

**R1.1** El sistema deberá exponer un **contrato de ingesta de EID** único por el que pasa todo EID producido por cualquier adaptador, antes de tocar el motor find-or-create de spec 09.

**R1.2** Cuando un adaptador de stream (`spp-android` / `web-serial`) entrega una línea cruda del lector, el sistema deberá extraer el EID descartando el framing (byte de control, cabecera fija `1000000`, timestamp del lector) reusando `parseRs420Line` de `app/src/services/ble/parser-rs420.ts` sin reimplementar el parseo.

**R1.3** El sistema deberá validar todo EID entrante con `isValidTag` (exactamente 15 dígitos numéricos; prefijo de 3 dígitos país, ej. `032`=AR, **o** fabricante, ≥900, ej. `982`) antes de proponerlo para commit.

**R1.4** Si el EID entrante no pasa `isValidTag` (malformado, longitud distinta de 15, contenido no numérico) o `parseRs420Line` retorna `null`, entonces el sistema **no deberá** proponerlo para commit, deberá descartarlo y deberá registrarlo en un log no bloqueante (opcionalmente un toast), sin interrumpir el flujo del operario.

**R1.5** El sistema deberá usar el **timestamp del teléfono** al momento de la ingesta como timestamp de correlación del evento; deberá descartar el timestamp del lector (ya recortado por `parseRs420Line`). Consistente con CONTEXT/05.

**R1.6** El sistema deberá emitir cada EID confirmado (R2) hacia el consumidor de spec 09 como un `BleStickEvent` de tipo `tag_read` con la forma `{ kind: 'tag_read', tag: string, timestamp: number }` declarada por spec 09, idéntica para todos los adaptadores.

## R2. Contrato de ingesta — confirmación visual antes del commit

> **Firme.** Integridad de dato SENASA: un EID con un dígito corrupto se declara mal ante SENASA (10 días hábiles, Res. 841/2025). ADR-024 §1 exige confirmación visual antes de persistir.

**R2.1** Cuando el contrato recibe un EID válido (R1.3), el sistema deberá mostrar al operario una **confirmación visual de la lectura** (el EID legible en pantalla) antes de persistir o disparar el commit al motor find-or-create.

**R2.2** El sistema deberá alcanzar la confirmación visual en pantalla en **menos de 1 segundo** desde la lectura del EID (objetivo de campo del context decisión 3).

**R2.3** Mientras la confirmación visual de un EID esté pendiente, el sistema deberá ofrecer al operario un control explícito para **confirmar** (proceder al commit / find-or-create) y, donde el flujo lo permita, **descartar** la lectura sin commit.

**R2.4** El sistema deberá tratar la confirmación visual como el **mismo gate** que el feedback sensorial de R4: la confirmación en pantalla es a la vez el indicador visual de lectura exitosa y el punto previo al commit.

**R2.5** Donde el consumidor de spec 09 opera en modo de **asignación masiva** (spec 09 R8: una sesión de bastoneo en serie de EIDs distintos), el sistema deberá permitir que la confirmación sea ligera y encadenable (no deberá bloquear el siguiente bastoneo de un EID distinto), conservando la verificación visual de cada EID asignado.

## R3. Contrato de ingesta — deduplicación por TAG en ventana corta

> **Firme.** Dedup por-TAG con ventana (no cooldown global), transport-agnóstico, en el contrato (ADR-024 §1, context decisión 2). Clave para no romper la asignación masiva de spec 09 R8.

**R3.1** Si el contrato recibe el **mismo** EID dentro de una ventana de aproximadamente **3 segundos** desde la última ingesta confirmada de ese mismo EID, entonces el sistema **no deberá** emitir un segundo `tag_read` para ese EID (ignora el re-escaneo accidental).

**R3.2** Cuando el contrato recibe un EID **distinto** de la última lectura, el sistema deberá emitirlo **al instante** sin esperar la ventana de dedup (no deberá aplicar un cooldown global entre EIDs distintos), de modo que tres bastoneos seguidos de tres EIDs distintos produzcan tres `tag_read` (habilita la asignación masiva de spec 09 R8: 3 escaneos = 3 animales).

**R3.3** El sistema deberá implementar la dedup **por-TAG** (keyed por el valor del EID, cada uno con su ventana propia), no como un cooldown único compartido entre todos los EIDs.

**R3.4** El sistema deberá exponer el valor de la ventana de dedup como una constante **ajustable** (default ~3000 ms), no hardcodeada en múltiples lugares.

**R3.5** El sistema deberá aplicar la dedup en el contrato (transport-agnóstico), de modo que sea idéntica para todos los adaptadores (`spp-android`, `web-serial`, `hid-wedge`, `manual`, `mock`).

## R4. Feedback de lectura exitosa

> **Firme** (la lógica) / detalle visual **tentativo** (design system). Redundancia sensorial para la manga (context decisión 3): se siente con guantes/barro y se oye al sol/ruido.

**R4.1** Cuando el contrato confirma un EID válido, el sistema deberá emitir **vibración táctil** en el dispositivo, **siempre** (no apagable), porque el operario la percibe con guantes o con barro.

**R4.2** Cuando el contrato confirma un EID válido y el beep está habilitado, el sistema deberá emitir un **beep** sonoro corto.

**R4.3** El sistema deberá exponer una preferencia de usuario para **apagar el beep** de lectura (útil/molesto según el sol o el ruido), persistida localmente entre sesiones; con el beep apagado, la vibración (R4.1) deberá seguir activa.

**R4.4** Cuando el contrato confirma un EID válido, el sistema deberá mostrar la **confirmación visual** de R2.1 con objetivo de latencia **< 1 segundo** desde la lectura (R2.2).

**R4.5** Donde la plataforma sea web (harness `adapter-web-serial`), el sistema deberá emitir el beep vía Web Audio y deberá degradar la vibración silenciosamente (la vibración de desktop es pobre), sin romper la confirmación visual.

## R5. Adaptador `web-serial` — RS420 dev/test harness (buildable hoy)

> **Buildable hoy, dev-only.** No es transporte de producción (Web Serial no existe en RN ni en iOS Safari). Convierte el RS420 físico pareado a Windows en fuente de TAGs reales en la app web, sin dev build ni device (`web-serial-dev-harness-plan.md`). El iPhone y el transporte shippable quedan afuera de este camino (ADR-024).

**R5.1** El sistema deberá exponer un `adapter-web-serial` que implemente la interfaz `StickAdapter` (R11) y que **solo** se monte cuando `Platform.OS === 'web'`.

**R5.2** Cuando el operario solicita conectar el bastón en web, el sistema deberá pedir el puerto serie con `navigator.serial.requestPort()` (gesto de usuario) y abrirlo con `port.open({ baudRate })`, usando el baud configurado (default 9600).

**R5.3** El sistema deberá leer el stream del puerto (`port.readable` + `TextDecoderStream`), framearlo por línea (`\n`, tolerando `\r\n`) y entregar cada línea cruda al contrato (R1.2) vía `parseRs420Line`.

**R5.4** Cuando el operario reabre la app web, el sistema deberá reconectar sin volver a preguntar usando `navigator.serial.getPorts()` para recuperar los puertos ya autorizados (implementa "recordar el bastón" del context para web-serial).

**R5.5** Si el read loop del puerto serie falla o el navegador emite el evento `disconnect`, entonces el sistema deberá reflejar el estado `desconectado` vía `onStatus` (R11) y deberá reintentar `open()` con backoff, sin bloquear la carga manual.

**R5.6** El sistema deberá restringir `adapter-web-serial` a navegadores Chromium en contexto seguro (`localhost:8081` de `pnpm web` califica) y deberá degradar con un mensaje claro en navegadores sin Web Serial (Safari/Firefox).

## R6. Adaptador `spp-android` — RS420 nativo (cubre el beta; requiere dev build)

> **Requiere dev build + teléfono Android** (Raf lo compra). Cubre al cliente beta de Chascomús (ADR-024 §3). Bluetooth Classic SPP nativo vía `react-native-bluetooth-classic`; el protocolo está caracterizado (`field-findings.md`, `android-spp-impl-plan.md`).

**R6.1** El sistema deberá exponer un `adapter-spp-android` que implemente la interfaz `StickAdapter` (R11) leyendo el Allflex RS420 por Bluetooth Classic SPP (UUID `00001101-0000-1000-8000-00805F9B34FB`) vía `react-native-bluetooth-classic`.

**R6.2** Cuando el operario empareja el bastón por primera vez, el sistema deberá soportar el pairing SPP del RS420 (slave, PIN **1234**) desde la pantalla de conexión (R9), listar los dispositivos disponibles y permitir elegir uno.

**R6.3** Cuando el operario elige un bastón en la pantalla de conexión, el sistema deberá **guardar** ese dispositivo como el bastón recordado del usuario en el dispositivo, localmente, sobreviviendo a reinicios de la app.

**R6.4** Cuando la app abre o el bastón recordado vuelve a estar en rango, el sistema deberá **reconectar automáticamente** al bastón guardado con backoff incremental, sin requerir que el operario vuelva a la pantalla de conexión.

**R6.5** El sistema deberá leer las líneas ASCII del stream SPP y entregarlas al contrato (R1.2) vía `parseRs420Line`, que descarta el byte de control, la cabecera fija y el timestamp del lector.

**R6.6** El sistema deberá ofrecer en la pantalla de conexión (R9) una acción para **cambiar** (elegir otro) y otra para **olvidar** el bastón guardado, limpiando el identificador persistido.

**R6.7** El sistema deberá operar con **un bastón por dispositivo** en MVP; si hay múltiples bastones disponibles cerca, la pantalla de conexión deberá listarlos y el sistema deberá recordar el último elegido (R6.3). El sistema **no deberá** intentar conectar múltiples bastones simultáneamente.

**R6.8** El sistema deberá ser baud-independiente para el RS420 por SPP (SPP virtual ignora el baud), sin requerir que el operario configure el baud en Android.

**R6.9** El sistema deberá ejecutar conexión, escaneo y reconexión únicamente en **foreground** (sin BLE/SPP en background en MVP), reanudando los intentos al volver a foreground.

## R7. Adaptador `manual` — piso siempre disponible (buildable hoy)

> **Firme, buildable hoy.** Es la puerta cero (spec 09 R1). Garantiza el principio manual-first: la app nunca se bloquea por el bastón.

**R7.1** El sistema deberá tratar la carga manual del número (tipeo de IDV / visual / EID en el campo de búsqueda o form de spec 09 R1) como un proveedor del **mismo** contrato de ingesta (R1), de modo que bastón y tipeo manual alimenten el mismo flujo find-or-create (dos puertas, un motor).

**R7.2** El sistema deberá mantener la carga manual **siempre disponible**, independiente del estado del bastón o del transporte, en todos los estados de conexión (apagado, permiso denegado, buscando, conectado, desconectado).

**R7.3** Cuando el bastón se desconecta a mitad de jornada, el sistema deberá mantener la carga manual accesible en **1 tap**, sin pasos intermedios obligatorios de reconexión, sin interrumpir el flujo del operario.

**R7.4** El sistema **no deberá** bloquear la app, la carga manual ni el resto del flujo por ningún estado del bastón ni del transporte (manual-first, principio rector del context).

## R8. Adaptador `hid-wedge` — BLE-HID keyboard-wedge (GATED por validación física)

> **GATED.** Dirección elegida para el camino iOS-sin-MFi (ADR-024 §4), **pero su implementación NO arranca** hasta pasar el gate físico en iPhone real (ver R8.7 + Preguntas abiertas). El Council fue enfático: no fijar arquitectura sobre un mecanismo no ejecutado. NO es GATT; NO usa `react-native-ble-plx`. Estos requirements describen el comportamiento esperado del adaptador **una vez destrabado**; hasta entonces no se implementa código de este adaptador.

**R8.1** El sistema deberá exponer (una vez pasado el gate de R8.7) un `adapter-hid-wedge` que implemente la interfaz `StickAdapter` (R11) capturando el EID que el bastón **tipea como teclado Bluetooth del SO** en un `TextInput` de "scan" enfocado, en iOS y Android, sin MFi.

**R8.2** El sistema deberá capturar los dígitos tipeados por el bastón HID y el **terminador (Enter)** en el campo de scan, ensamblar la línea y entregarla al contrato de ingesta para que `isValidTag` (R1.3) la valide. (El framing de `parseRs420Line` puede no aplicar si el HID tipea solo los 15 dígitos: el adaptador define su propia captura — R11.4.)

**R8.3** El sistema deberá apoyarse en el **pairing del SO** para el bastón HID (es un teclado Bluetooth): el sistema **no deberá** escanear BLE para este adaptador; el "recordar el bastón" lo provee el SO al recordar el teclado pareado.

**R8.4** El sistema deberá proveer y mantener enfocado un campo de scan que capte el tipeo del bastón HID de forma confiable cuando el adaptador está activo.

**R8.5** El sistema **no deberá** requerir permisos BLE de la app para `adapter-hid-wedge` (el bastón es un teclado del SO).

**R8.6** El sistema deberá manejar el efecto colateral documentado de que BLE-HID **suprime el teclado en pantalla en iOS** sin romper la UX de manga (a verificar en el gate físico — R8.7).

**R8.7** El sistema **no deberá** considerar `adapter-hid-wedge` listo para implementación hasta que se valide físicamente en **iPhone real** (y se verifique el equivalente en Android) que el bastón HID: (a) tipea los 15 dígitos completos, (b) emite el terminador Enter, (c) la supresión del teclado en pantalla de iOS no rompe la UX, (d) el `TextInput` de RN con foco programático captura confiablemente entre versiones (gate de ADR-024 §4). Hasta ese gate, el adaptador queda marcado **GATED** y el contrato sigue operativo con los otros adaptadores.

## R9. Conexión, estado e indicador global

> **Comportamiento firme** / UI **tentativa** (design system). Pantalla de conexión en "Más" (ADR-018). Indicador global consumido por spec 09 R2.5 vía `useBleConnectionStatus`.

**R9.1** El sistema deberá exponer una **pantalla de conexión del bastón** accesible desde la sección "Más" de la navegación (ADR-018: el listener es global, no una tab). La pantalla deberá ser específica por adaptador (SPP: listar/elegir/olvidar dispositivos; web-serial: requestPort + lista de getPorts; HID: instrucción de parear el teclado en el SO + campo de scan).

**R9.2** El sistema deberá exponer estados de conexión claros con CTA accionable: **bastón apagado**, **permiso denegado**, **buscando**, **conectado**, **desconectado**.

**R9.3** El sistema deberá exponer un **indicador global de estado de conexión** en el chrome de la app, alimentado por el hook `useBleConnectionStatus()` que spec 04 implementa y spec 09 R2.5 consume.

**R9.4** Cuando cambia el estado de conexión, el sistema deberá emitir un `BleStickEvent` de tipo `connection_changed` con la forma `{ kind: 'connection_changed', connected: boolean }` (declarada por spec 09) y actualizar el indicador global (R9.3) de forma reactiva.

**R9.5** Si el bastón está apagado, fuera de rango, en sleep o sin batería, entonces el sistema deberá reflejar `desconectado` en el indicador (R9.3) y, donde el adaptador lo soporte (`spp-android`, `web-serial`), deberá intentar reconexión automática con backoff — sin bloquear la carga manual (R7).

**R9.6** El sistema deberá mantener todos los estados de conexión **no bloqueantes**: la carga manual deberá funcionar en cualquiera de ellos (R7.2).

## R10. Mock provider y wiring del contrato a spec 09

> **Firme, buildable hoy.** El `adapter-mock` ya fue pedido por spec 09; 04 lo implementa conforme a la interfaz. Testea el stack entero sin hardware. El wiring monta el adaptador según plataforma/entorno y conecta `enable/disable` + `useBusyMode` de spec 03/09.

**R10.1** El sistema deberá exponer un `adapter-mock` que implemente la interfaz `StickAdapter` (R11) e inyecte lecturas simuladas (`mockTagRead(tag)`) y transiciones de conexión (`mockConnectionChange(connected)`), para ejercitar el contrato completo (normalización, validación, confirmación, dedup, asignación masiva) y el find-or-create de spec 09 sin hardware.

**R10.2** El sistema deberá montar `adapter-mock` en CI y en dev sin device, vía un toggle de dev, conforme a la interfaz del mock provider que spec 09 ya declaró (`BleStickListenerProvider` con `mode='mock'` exponiendo `mockTagRead`).

**R10.3** El sistema deberá implementar el `BleStickListenerProvider` (interfaz de spec 09) montando el adaptador correcto según plataforma/entorno: `adapter-spp-android` en Android device, `adapter-web-serial` en web, `adapter-hid-wedge` cuando esté destrabado (R8.7), `adapter-mock` en CI/dev, y `adapter-manual` siempre como piso (R7).

**R10.4** El sistema deberá implementar `useBleStickListener(opts: { enabled, onTagRead })` con la firma exacta que spec 09 declaró, retornando `{ isConnected, isListening }`, reemplazando el stub que spec 09 montó (spec 09 T1.5).

**R10.5** Cuando `enabled` es `false` (lo setea spec 09 al entrar a MODO MANIOBRAS, spec 03), el sistema deberá **desactivar** la escucha del listener global (sin desconectar físicamente el bastón) para que el wizard de spec 03 procese los TAGs por su cuenta sin interferencia, y deberá reactivarla al volver a `enabled = true`.

**R10.6** El sistema deberá implementar `useBusyMode()` (interfaz de spec 09) de modo que, mientras un form CREATE/EDIT de spec 09 esté activo, el listener global **no dispare** un nuevo flujo encima del form en curso, reactivándose al salir del modo ocupado.

**R10.7** El sistema deberá exponer la API `{ disableListener, enableListener }` del `BleStickListenerProvider` (interfaz de spec 09 / consumida por spec 03) para suspender/reanudar el listener desde MODO MANIOBRAS.

**R10.8** El mock provider deberá respetar la dedup (R3), el feedback (R5/R4), la validación (R1) y el control `enable/disable` (R10.5), de modo que el comportamiento testeado con el mock sea representativo del real salvo por la capa de transporte física.

## R11. Interfaz `StickAdapter` (contrato de proveedor común)

> **Firme.** La interfaz transport-agnóstica detrás de la cual viven los 5 adaptadores (ADR-024 §2, `android-spp-impl-plan.md`). El contrato de ingesta (R1–R3) y el provider (R10) hablan con todos los adaptadores solo a través de esta interfaz.

**R11.1** El sistema deberá definir una interfaz `StickAdapter` transport-agnóstica con, como mínimo: `connect(deviceId?)`, `disconnect()`, `onTagRead(cb)`, `onStatus(cb)`, `enable()`, `disable()`.

**R11.2** El sistema deberá implementar los 5 adaptadores del MVP (`spp-android`, `hid-wedge` —GATED—, `web-serial`, `manual`, `mock`) detrás de esta única interfaz, sin que el contrato de ingesta (R1–R3) ni el provider (R10) conozcan el transporte concreto.

**R11.3** El sistema deberá permitir sumar un adaptador futuro (ej. `adapter-ble-gatt` si aparece un lector con GATT abierto, `adapter-ea-ios` con MFi, `adapter-batch-dump`, `adapter-websocket` del plan B del harness) implementando `StickAdapter` **sin modificar** el contrato de ingesta, el motor find-or-create ni los otros adaptadores (reversibilidad de ADR-024).

**R11.4** El sistema deberá entregar todos los streams de lector (`spp-android`, `web-serial`) al **mismo** `parser-rs420.ts` compartido; el `adapter-hid-wedge` (GATED) deberá usar su propia captura de keystrokes (no es un stream parseable por línea con framing del lector).

## R12. Permisos por transporte

> **Firme** (los de Android requieren dev build). Permisos diferenciados por adaptador (context §Permisos).

**R12.1** Donde el adaptador sea `spp-android`, el sistema deberá solicitar en Android 12+ los permisos `BLUETOOTH_SCAN` y `BLUETOOTH_CONNECT` (con `neverForLocation` donde aplique) y, en Android <12, `BLUETOOTH`/`BLUETOOTH_ADMIN` + location.

**R12.2** Donde el adaptador sea `spp-android`, el sistema deberá requerir un **dev build** (`expo-dev-client` + prebuild/EAS) por el módulo nativo `react-native-bluetooth-classic`; Expo Go no deberá considerarse soporte válido para este adaptador.

**R12.3** Donde el adaptador sea `hid-wedge`, el sistema **no deberá** solicitar permisos BLE de la app (el bastón es un teclado del SO); solo deberá requerir el campo de scan enfocado (R8.4).

**R12.4** Donde el adaptador sea `web-serial`, el sistema deberá depender del permiso del **navegador** (gesto de usuario en `requestPort()`), sin permisos de app nativos.

**R12.5** Si el permiso de un transporte es denegado, entonces el sistema deberá reflejar el estado **permiso denegado** con CTA (R9.2) y deberá mantener la carga manual operativa (R7.2), sin bloquear la app.

## R13. No-read silencioso

> **Firme.** Context §No-read / tag dañado.

**R13.1** Si el bastón se acciona pero no detecta ningún tag (o el tag está dañado), entonces el sistema **no deberá** emitir ningún evento (no-read **silencioso**), apoyándose en el fallback manual (R7) para tipear el ID visual.

**R13.2** El sistema **no deberá** asumir, en MVP, una señal de "lectura fallida" del lector (hoy se asume que no existe a nivel protocolo). Si en el futuro se confirma que algún reader emite señal de lectura fallida, se folda como refinamiento (Preguntas abiertas).

## R14. Offline-first

> **Firme.** Context §Offline-first; spec 09 R11.3.

**R14.1** El sistema deberá ejecutar la lectura del bastón y la ingesta del EID **sin requerir internet**: la conexión bastón↔teléfono es local (BLE Classic / serie / HID), y el find-or-create corre contra PowerSync local (spec 09 R11.3, spec 09 T5.2).

**R14.2** El sistema **no deberá** depender de ninguna llamada a internet para conectar, reconectar, leer, validar ni deduplicar lecturas; ningún paso del contrato de ingesta deberá requerir red.

## R15. Logging no bloqueante de eventos de transporte

> **Firme.** Context §Desconexión ("logs no bloquean").

**R15.1** El sistema deberá registrar los eventos del ciclo de vida del transporte (conexión, desconexión, reintentos, lecturas malformadas, EIDs descartados por R1.4) en un log diagnóstico que **no** bloquee ni demore el flujo del operario.

**R15.2** Si un evento de transporte falla (timeout de conexión, error de escaneo, error de read loop), entonces el sistema deberá capturar el error, registrarlo y reflejar el estado en `useBleConnectionStatus()` sin propagar excepciones que rompan la UI.

---

## Trazabilidad context.md → requirements

| Caso/decisión del context.md | Requirement(s) |
|---|---|
| Contrato de ingesta — normalización + `isValidTag` antes del motor | R1 |
| Contrato — confirmación visual antes del commit (integridad SENASA) | R2 |
| Contrato — timestamp del teléfono | R1.5 |
| Decisión 2 — dedup por-TAG ventana ~3s (no rompe spec 09 R8) | R3 |
| Decisión 3 — feedback vibración (siempre) + beep (apagable) + visual <1s | R4, R2.2 |
| Conexión/reconexión — `spp-android` (pairing PIN 1234, recordar, backoff, cambiar/olvidar) | R6, R9 |
| Conexión/reconexión — `web-serial` (requestPort + getPorts) | R5 |
| Conexión/reconexión — `hid-wedge` (pairing del SO, campo de scan) | R8 |
| Un bastón por dispositivo / múltiples cerca → lista + recordar último | R6.7 |
| Desconexión a mitad de jornada → reconexión + indicador + manual 1 tap | R9.5, R7.3, R9.3 |
| Fallback manual siempre disponible / dos puertas un motor | R7 |
| No-read / tag dañado → silencioso | R13 |
| Permisos por transporte (SPP-Android / HID sin permisos app / web-serial browser) | R12 |
| Normalización del EID (parser ya hecho) | R1.2, R1.3, R11.4 |
| Mock provider (testing sin device) | R10.1, R10.2, R10.8 |
| Offline-first | R14 |
| Indicador global de conexión | R9.3 |
| Manual-first como principio rector | R7.4, R9.6 |
| 5 adaptadores del MVP detrás del contrato (ADR-024 §2) | R5, R6, R7, R8, R10, R11 |
| `adapter-spp-android` cubre el beta (ADR-024 §3) | R6, R12 |
| `adapter-hid-wedge` GATED por validación física (ADR-024 §4) | R8.7 |
| Implementa interfaz de spec 09 (listener, provider, busyMode, status, enable/disable) | R10, R9.3 |
| Logs no bloquean | R15 |

## Criterios de aceptación globales

Esta spec se considera implementada (en el alcance buildable-hoy + beta) cuando:

- Todo EID que llega de cualquier adaptador pasa por normalización + `isValidTag` antes de tocar el motor, y un EID malformado se descarta + loguea sin romper el flujo (R1, R13).
- El operario ve la **confirmación visual** del EID en <1s, con vibración siempre + beep configurable, y la confirmación es el gate previo al commit que protege la integridad SENASA (R2, R4).
- Tres bastoneos seguidos de EIDs distintos producen 3 `tag_read` al instante (asignación masiva spec 09 R8 no se rompe); un re-escaneo del mismo EID dentro de ~3s se ignora (R3).
- El `adapter-web-serial` lee el RS420 real pareado a Windows desde la app web (`pnpm web`), reusa `parser-rs420.ts` tal cual, y ejercita el pipeline entero (dedup, asignación masiva, find-or-create, busy-mode) sin dev build ni device (R5, R10).
- El `adapter-mock` ejercita el stack completo en CI sin hardware (R10).
- La carga manual funciona en **todos** los estados de conexión y nunca se bloquea por el bastón (R7, R9.6).
- El `adapter-spp-android` lee el RS420 nativo en el Android de pruebas (pairing PIN 1234, recordar device, reconexión backoff, stream parseado) — entregable del beta (R6, R12).
- `useBleStickListener` / `BleStickListenerProvider` / `useBleConnectionStatus` / `useBusyMode` / `enableListener`/`disableListener` quedan implementados con la firma exacta de spec 09, reemplazando el stub, y MODO MANIOBRAS suspende el listener (R10).
- El `adapter-hid-wedge` queda **GATED**: no se implementa hasta pasar el gate físico de ADR-024 §4 (R8.7). El resto de la spec funciona sin él.
- Todo el flujo del contrato de ingesta funciona **offline** (R14).
- Conteo final: **R1..R15**, con el contrato de ingesta (R1, R2, R3) + feedback (R4) + mock/wiring (R10) + interfaz (R11) + offline (R14) + logging (R15) **firmes**; `web-serial` (R5) + `manual` (R7) **buildables hoy**; `spp-android` (R6, R12) **requiere dev build + Android**; `hid-wedge` (R8) **GATED**; UI de conexión (R9) **tentativa** (design system).

## Preguntas abiertas / a confirmar

Huecos detectados entre context / ADR-024 / spec 09 / planes — **no se improvisaron resoluciones**; se documentan para refinamiento.

1. **`useBleConnectionStatus` no figura en el design de spec 09 con esa firma exacta.** El context (línea 28) y ADR-024 §111 nombran `useBleConnectionStatus()`, pero el `design.md` de spec 09 declara el estado de conexión dentro del retorno de `useBleStickListener` (`{ isConnected, isListening }`) y menciona `useBleConnectionStatus()` como "a definir" en su `tasks.md` T4.2. **R9.3 asume que 04 expone `useBleConnectionStatus()` como hook propio** además de `isConnected` en `useBleStickListener`. A confirmar con quien implemente spec 09 Fase 4 si es un hook separado o un selector sobre el provider. No bloquea: ambos leen el mismo estado del provider.
2. **Ruta del módulo de listener**: el context (línea 25) dice que 04 implementa `services/ble/stick.ts`; el design de spec 09 lista `app/src/features/animals/hooks/useBleStickListener.ts` (stub) y `app/src/features/animals/providers/BleStickListenerProvider.tsx`. El parser ya vive en `app/src/services/ble/parser-rs420.ts`. El `design.md` de 04 propone que el contrato + adaptadores vivan en `app/src/services/ble/` (junto al parser) y que el provider/hook de spec 09 deleguen ahí, para no duplicar. A confirmar el reparto exacto con quien implemente spec 09 Fase 4 (coordinación, no contradicción de contrato).
3. **Confirmación pre-commit vs. el flujo de spec 09 R2.4** (abre el resultado "encima de la pantalla actual"): spec 09 no modela explícitamente un paso de confirmación visual del EID **antes** del find-or-create — su `FindOrCreateOverlay` aparece tras el `tag_read`. R2 de esta spec introduce la confirmación pre-commit que ADR-024 exige. **Interpretación adoptada**: la confirmación visual de R2 puede realizarse como parte del overlay de spec 09 (el EID legible visible antes de ejecutar el commit del find-or-create / la asignación), sin reabrir spec 09. A validar en implementación conjunta 04+09 que el overlay muestre el EID confirmable y no commitee a ciegas. Si requiere un cambio de contrato en spec 09, **parar y reportar** (no parchear desde 04).
4. **Gate físico HID** (R8.7): bloquea solo a `adapter-hid-wedge`. Pendientes asociados del context: verificar si los genéricos AR (Montetech ME-BL01 / Smart LFID) hacen HID; conseguir el test rig (AgriEID BT Ultra o genérico verificado). No bloquea el `spec_ready` ni los otros adaptadores.
5. **Firmware RS420** (acción de Raf, `field-findings.md`): si se actualiza el firmware y la trama SPP cambia, hay que re-capturar el protocolo y revalidar `parser-rs420.ts`. Hoy el parser está anclado al formato capturado (`□ + 1000000 + EID + YYMMDDHHMMSS`). Riesgo bajo (el parser tolera `\r`/STX por `normalizeTag`), pero anotado.
</content>
