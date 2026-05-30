# Spec 04 — Integración bastón Bluetooth (Allflex RS420) — Requirements

**Status**: `spec_ready` (pendiente de aprobación humana — Puerta 1).
**Fecha**: 2026-05-30 (sesión 18).
**Autor**: spec_author.
**Cobertura**: parte **NO-hardware** de la feature. El protocolo BLE concreto del Allflex RS420 (service/characteristic UUIDs + parsing del mensaje del TAG) queda como **TODO bloqueante hasta el día de campo** (CONTEXT/07, CONTEXT/05). Ver requirements marcadas con 🔧 **[HARDWARE — día de campo]**.

## Historial de refinamiento

- **2026-05-30 — Creación inicial.** Requirements redactadas a partir del `context.md` aprobado en Gate 0 (sesión 18). Cada "Caso y decisión" del context queda cubierto por ≥1 requirement. Spec **implementa** la interfaz ya contractualizada por spec 09 (`BleStickEvent`, `useBleStickListener`, `BleStickListenerProvider`, `useBleConnectionStatus`, `useBusyMode`, mock provider) — no la redefine. Referencias: ADR-002 (react-native-ble-plx), ADR-013 (frontend stack), ADR-018 (listener global = no es tab; pantalla de conexión en "Más"), CONTEXT/05 (hardware), CONTEXT/07 (día de campo).

## Resumen

04 hace que RAFAQ lea el TAG electrónico (RFID) del bastón **Allflex RS420** vía BLE nativo (`react-native-ble-plx`, ADR-002) y lo entregue al motor de identificación de spec 09. El bastón es la **puerta BLE** de BUSCAR ANIMAL (spec 09 R2) y la fuente de lectura dentro de MODO MANIOBRAS (spec 03).

**Principio rector: manual-first.** El bastón es enhancement. La app funciona entera sin él (carga manual de IDV/visual). La app **nunca se bloquea** por estado BLE.

**Arquitectura ya contractualizada por spec 09** (esta spec la implementa, no la re-decide):
- `services/ble/stick.ts` expone `useBleStickListener` con la interface `BleStickEvent` declarada en spec 09 design.md.
- `BleStickListenerProvider` global monta el hook real; al recibir `tag_read` dispara el find-or-create de spec 09.
- `enableListener()` / `disableListener()` (MODO MANIOBRAS los usa); `useBusyMode()` (CREATE/EDIT suspenden el listener).
- `useBleConnectionStatus()` para el estado de conexión.

## Convención de marcado

- 🔧 **[HARDWARE — día de campo]**: requirement cuya implementación depende del protocolo BLE concreto del RS420, no finalizable hasta el día de campo. El resto se implementa y testea **ahora** contra el mock provider.
- El resto de las requirements son **independientes del hardware**: se implementan y verifican contra el mock provider sin device físico.

---

## Requirements (EARS)

### R1. Servicio BLE del bastón (`services/ble/stick.ts`)

**R1.1** El sistema deberá exponer un módulo `services/ble/stick.ts` que implemente la interface `useBleStickListener(opts: { enabled: boolean, onTagRead: (tag: string) => void }): { isConnected: boolean, isListening: boolean }` declarada por spec 09 design.md, reemplazando el stub de spec 09 T1.5.

**R1.2** El sistema deberá emitir, hacia los consumidores del servicio, eventos del tipo `BleStickEvent` (`{ kind: 'tag_read', tag: string, timestamp: number }` y `{ kind: 'connection_changed', connected: boolean }`) exactamente con la forma definida en spec 09 design.md, sin redefinir esos tipos.

**R1.3** El sistema deberá exponer una función de control `enableListener()` y una función `disableListener()` que activen y desactiven, respectivamente, la escucha de TAGs sin desconectar físicamente el bastón.

**R1.4** Mientras el parámetro `enabled` del listener sea `false` (o se haya llamado `disableListener()`), el sistema **no deberá** invocar `onTagRead` aunque el bastón emita lecturas, y deberá mantener la conexión física activa para reactivar la escucha sin re-emparejar.

**R1.5** El sistema deberá construir el servicio detrás de una interface de adaptador (`BleStickAdapter`) con dos implementaciones intercambiables: una real (`react-native-ble-plx`) y una mock (R10), seleccionables sin tocar el código consumidor.

**R1.6** 🔧 **[HARDWARE — día de campo]** El adaptador real deberá descubrir el service y la characteristic de notificación del Allflex RS420 por sus UUIDs y suscribirse a las notificaciones que transportan el TAG leído. Los UUIDs concretos y el `BleStickAdapter` real quedan como stub hasta confirmarse el día de campo (escaneo con nRF Connect); el servicio compila y testea contra el mock entretanto.

### R2. Permisos BLE y estado del adaptador del dispositivo

**R2.1** Cuando la app necesita usar el bastón por primera vez, el sistema deberá solicitar los permisos BLE requeridos por la plataforma: en Android 12+ `BLUETOOTH_SCAN` y `BLUETOOTH_CONNECT`; en Android < 12 el permiso de ubicación necesario para escaneo BLE; en iOS el permiso de Bluetooth.

**R2.2** Si el usuario deniega un permiso BLE requerido, entonces el sistema deberá exponer un estado `permission_denied` con un CTA accionable que explique cómo habilitarlo (deep-link a settings cuando la plataforma lo permita) y **no deberá** bloquear la carga manual ni el resto de la app.

**R2.3** Mientras el adaptador Bluetooth del dispositivo esté apagado, el sistema deberá exponer un estado `bluetooth_off` con un CTA para activarlo y deberá mantener la carga manual disponible.

**R2.4** El sistema deberá modelar el estado de conexión del bastón con al menos los siguientes valores discretos: `bluetooth_off`, `permission_denied`, `scanning`, `connecting`, `connected`, `disconnected`.

**R2.5** El sistema deberá exponer el hook `useBleConnectionStatus()` que retorne el estado actual de R2.4 para que cualquier pantalla del chrome lo consuma.

### R3. Conexión, recuerdo y reconexión automática del bastón

**R3.1** El sistema deberá exponer, dentro de la tab "Más" (ADR-018), una pantalla de conexión del bastón que escanee dispositivos BLE cercanos y liste los candidatos compatibles (Allflex) para que el usuario elija uno.

**R3.2** Cuando el usuario elige un bastón en la pantalla de conexión, el sistema deberá persistir su identificador de dispositivo (el `deviceId` de `react-native-ble-plx`) como **el bastón recordado** del dispositivo, sobreviviendo a reinicios de la app.

**R3.3** Cuando la app inicia o vuelve a foreground y existe un bastón recordado, el sistema deberá intentar reconectar automáticamente a ese bastón sin intervención del usuario.

**R3.4** Mientras exista un bastón recordado y la conexión esté caída pero el bastón vuelva a estar en rango/disponible, el sistema deberá reintentar la reconexión automáticamente con backoff incremental, sin requerir que el usuario abra la pantalla de conexión.

**R3.5** El sistema deberá ofrecer en la pantalla de conexión una acción para **cambiar de bastón** (elegir otro) y una acción para **olvidar** el bastón recordado, limpiando el identificador persistido.

**R3.6** Mientras haya múltiples dispositivos Allflex compatibles en rango, el sistema deberá listarlos todos en la pantalla de conexión y, tras una elección, deberá recordar el último elegido como el bastón recordado.

**R3.7** El sistema deberá soportar **un único bastón recordado por dispositivo** (sin emparejamiento simultáneo de varios bastones en MVP).

**R3.8** El sistema deberá ejecutar conexión, escaneo y reconexión únicamente en foreground (sin BLE en background en MVP), reanudando los intentos al volver a foreground.

### R4. Deduplicación de lecturas por TAG en ventana corta

**R4.1** Cuando el bastón emite una lectura de un TAG y ese mismo TAG ya fue emitido por el servicio dentro de una ventana de deduplicación reciente (~3 s, valor configurable), el sistema **no deberá** volver a invocar `onTagRead` para esa segunda lectura (la ignora silenciosamente).

**R4.2** Cuando el bastón emite lecturas de TAGs **distintos** en sucesión rápida, el sistema deberá invocar `onTagRead` para cada TAG distinto sin demora adicional, de modo que la asignación masiva de caravanas de spec 09 R8 (varios escaneos seguidos de TAGs distintos) no se rompa.

**R4.3** El sistema deberá implementar la deduplicación como **por-TAG con ventana temporal** (cada TAG tiene su propia ventana), y **no** como un cooldown global que bloquee cualquier lectura tras una previa.

**R4.4** El sistema deberá exponer el tamaño de la ventana de deduplicación como una constante de configuración del módulo, ajustable sin cambiar la lógica.

### R5. Feedback de lectura exitosa

**R5.1** Cuando el servicio emite una lectura de TAG exitosa hacia el consumidor, el sistema deberá disparar una **vibración táctil** del dispositivo (haptic) siempre, independientemente de la configuración de sonido.

**R5.2** Cuando el servicio emite una lectura de TAG exitosa y el usuario tiene el sonido de lectura habilitado, el sistema deberá reproducir un **beep sonoro** corto.

**R5.3** El sistema deberá exponer una preferencia de usuario para **apagar el beep sonoro** de lectura, persistida entre sesiones; con el beep apagado, la vibración (R5.1) deberá seguir activa.

**R5.4** Cuando el servicio emite una lectura de TAG exitosa, el sistema deberá proveer una **confirmación visual** consumible por la UI (señal/evento) para que la pantalla activa muestre el feedback correspondiente.

**R5.5** El sistema deberá disparar el feedback de lectura (vibración + sonido opcional + señal visual) con un objetivo de latencia **< 1 s** desde la recepción de la notificación BLE hasta el feedback al usuario.

### R6. Fallback manual siempre disponible

**R6.1** Mientras el bastón esté desconectado, sin permisos, con Bluetooth apagado, o en cualquier estado de error BLE, el sistema **no deberá** bloquear la puerta manual de spec 09 (R1) ni ninguna otra parte de la app.

**R6.2** El sistema deberá garantizar que la carga manual (búsqueda/alta por IDV o visual de spec 09) sea accesible en **un tap** ante una desconexión del bastón, sin pasos intermedios obligatorios de reconexión.

**R6.3** El sistema deberá garantizar que un bastoneo (puerta BLE) y un tipeo manual alimenten el **mismo** motor find-or-create de spec 09 (R3): el bastón y el teclado son dos puertas hacia un único flujo, no flujos paralelos.

### R7. No-read silencioso (tag dañado o sin detección)

**R7.1** Si el bastón se acciona pero no detecta ningún TAG (tag dañado, fuera de alcance, lectura fallida) y no emite ningún mensaje, entonces el sistema **no deberá** mostrar error ni interrumpir el flujo, dejando que el operador recurra a la carga manual (no-read silencioso).

**R7.2** 🔧 **[HARDWARE — día de campo]** Si el día de campo revela que el RS420 emite una señal de protocolo de "lectura fallida", entonces el sistema deberá folder ese caso (emitir un evento de no-read manejable); hasta confirmarlo, el sistema asume que el RS420 **no** emite tal señal y mantiene el no-read silencioso de R7.1.

### R8. Normalización y validación del TAG leído

**R8.1** Cuando el servicio recibe un mensaje del bastón con un TAG, el sistema deberá normalizarlo (trim de whitespace y control chars, formato canónico esperado de RFID) antes de pasarlo al motor find-or-create de spec 09.

**R8.2** Si el TAG normalizado no cumple el formato esperado de identificador RFID, entonces el sistema **no deberá** invocar `onTagRead`, deberá registrar la lectura malformada en logs y **no deberá** romper el flujo (opcionalmente un toast no bloqueante).

**R8.3** 🔧 **[HARDWARE — día de campo]** El sistema deberá derivar el formato canónico exacto del TAG (byte-format / encoding del mensaje del RS420) del escaneo del día de campo; hasta entonces R8.1/R8.2 se implementan contra una normalización provisional verificable con el mock provider.

### R9. Indicador global de conexión

**R9.1** El sistema deberá exponer un indicador de estado de conexión del bastón, visible de forma consistente en el chrome de la app (ubicación visual concreta definida con el design system), alimentado por `useBleConnectionStatus()` (R2.5).

**R9.2** Cuando el estado de conexión del bastón cambia (R2.4), el sistema deberá actualizar el indicador global de R9.1 de forma reactiva.

### R10. Mock provider para testing sin device

**R10.1** El sistema deberá proveer una implementación **mock** del `BleStickAdapter` (R1.5) conforme a la misma interface que la real, que no requiera ningún device BLE físico.

**R10.2** El mock provider deberá exponer una API de test/dev para inyectar lecturas simuladas (`mockTagRead(tag: string)`) y para simular transiciones de conexión (`mockConnectionChange(connected: boolean)`), permitiendo testear el stack completo de spec 09 (find-or-create, asignación masiva R8, MODO MANIOBRAS) sin hardware.

**R10.3** El sistema deberá permitir seleccionar el mock provider mediante un toggle de desarrollo (y por defecto en el entorno de tests), sin que el código consumidor distinga entre mock y real.

**R10.4** El mock provider deberá respetar la deduplicación (R4), el feedback (R5), la normalización (R8) y el control `enable/disable` (R1.3/R1.4), de modo que el comportamiento testeado con el mock sea representativo del real salvo por la capa GATT física.

### R11. Suspensión del listener por contexto (MODO MANIOBRAS y formularios)

**R11.1** Mientras la pantalla activa pertenezca al flujo MODO MANIOBRAS (spec 03), el sistema deberá desactivar el listener global vía `disableListener()` para que el wizard de spec 03 procese los TAGs por su cuenta sin interferencia. (El alcance lo gobierna spec 09 R2.3 / spec 03; 04 provee el control.)

**R11.2** Cuando la pantalla activa deja de pertenecer a MODO MANIOBRAS, el sistema deberá reactivar el listener global vía `enableListener()`.

**R11.3** El sistema deberá exponer `useBusyMode()` para que las pantallas CREATE/EDIT de spec 09 marquen un modo "ocupado"; mientras `useBusyMode` esté activo, el sistema deberá suspender el listener global para no abrir un nuevo flujo encima de un formulario en curso, y reactivarlo al salir del modo ocupado.

### R12. Offline-first del bastón

**R12.1** El sistema deberá operar la conexión BLE, la lectura de TAGs y el feedido del TAG al motor find-or-create **sin requerir red** (la relación bastón↔device es local; PowerSync resuelve el find-or-create contra la copia local, spec 09 R11).

**R12.2** El sistema **no deberá** depender de ninguna llamada a internet para conectar, reconectar, leer ni deduplicar lecturas del bastón.

### R13. Logging no bloqueante de eventos BLE

**R13.1** El sistema deberá registrar los eventos del ciclo de vida BLE (conexión, desconexión, reintentos, lecturas malformadas) en un log diagnóstico que **no** bloquee ni demore el flujo del operario.

**R13.2** Si un evento BLE falla (timeout de conexión, error de escaneo, error GATT), entonces el sistema deberá capturar el error, registrarlo y reflejar el estado en `useBleConnectionStatus()` sin propagar excepciones que rompan la UI.

---

## Trazabilidad context.md → requirements

| Caso/decisión del context.md | Requirement(s) |
|---|---|
| Arquitectura contractualizada por spec 09 (`stick.ts`, provider, enable/disable, busyMode, connectionStatus) | R1, R2.5, R9, R11 |
| Decisión 1 — recordar bastón + reconexión automática | R3 |
| Pantalla de conexión en "Más" (primera vez, cambiar, olvidar) | R3.1, R3.5, R3.6 |
| Un bastón por dispositivo | R3.7 |
| Múltiples Allflex → lista + recordar último | R3.6 |
| Desconexión a mitad de jornada → reconexión + indicador + manual 1 tap | R3.4, R6.2, R9 |
| Logs BLE no bloquean | R13 |
| Decisión 2 — dedup por TAG ~3 s (no rompe R8 de spec 09) | R4 |
| Decisión 3 — feedback vibración + sonido(apagable) + visual, < 1 s | R5 |
| Fallback manual siempre disponible / dos puertas un motor | R6 |
| No-read silencioso | R7 |
| Permisos y estado BLE (Android/iOS, estados claros) | R2 |
| Indicador global de conexión | R9 |
| Normalización/validación del TAG | R8 |
| Mock provider para tests sin device | R10 |
| Offline-first | R12 |
| BLOQUEANTE día de campo — UUIDs + parsing del mensaje | R1.6, R7.2, R8.3 (marcadas 🔧) |

## Requirements dependientes del hardware (día de campo)

Solo estas dependen del protocolo BLE concreto del RS420 y **no** se finalizan hasta el día de campo:

- **R1.6** — adaptador GATT real (service/characteristic UUIDs).
- **R7.2** — señal de "lectura fallida" del RS420 (a confirmar; default = no existe → no-read silencioso).
- **R8.3** — byte-format/encoding exacto del mensaje del TAG.

**Nice-to-have hardware-dependiente (fuera de las R numeradas, ver design § "Pendiente día de campo")**: Battery Service estándar (0x180F) del Allflex para low-battery warning — solo si el device lo expone.

Todas las demás requirements (R1.1–R1.5, R2–R6, R7.1, R8.1–R8.2, R9–R13) son **independientes del hardware** y se implementan/verifican **ahora** contra el mock provider.

## Criterios de aceptación globales

Esta spec (parte no-hardware) se considera implementada cuando:

- `services/ble/stick.ts` implementa `useBleStickListener` con la interface de spec 09 y reemplaza el stub de spec 09 T1.5, contra el **mock provider**.
- El stack completo de spec 09 (find-or-create, asignación masiva R8, MODO MANIOBRAS R2.3) testea de punta a punta con el mock provider, sin device físico.
- La reconexión automática al bastón recordado, el cambio y el olvido funcionan (verificados contra el mock).
- La deduplicación por-TAG (~3 s) ignora re-lecturas del mismo TAG pero deja pasar TAGs distintos al instante (verificado: tres TAGs distintos seguidos = tres `onTagRead`).
- El feedback de lectura (vibración + beep opcional + señal visual) se dispara con objetivo < 1 s y el beep es apagable.
- La carga manual queda disponible en 1 tap en todos los estados BLE (apagado, denegado, desconectado).
- Los permisos BLE se solicitan correctamente por plataforma y exponen estados claros con CTA.
- El listener se suspende en MODO MANIOBRAS (`disableListener`) y durante formularios CREATE/EDIT (`useBusyMode`), y se reactiva al salir.
- Todo el flujo del bastón funciona offline.
- El **adaptador GATT real (R1.6), la señal de no-read (R7.2) y el byte-format del TAG (R8.3)** quedan documentados como TODO bloqueante del día de campo; el resto está completo y testeado.
- Conteo final: **R1..R13** (13 grupos de requirements), de los cuales **3 sub-requirements dependen del hardware** (R1.6, R7.2, R8.3, marcadas 🔧).
