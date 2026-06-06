# Spec 04 — Integración bastón lector RFID (EID) — Refinamiento de contexto (Gate 0)

**Status**: ✅ **Aprobado por Raf (sesión 22) → `context_ready`.** Re-presentado tras foldear ADR-024. El **transporte está resuelto por ADR-024**; este context refina la **UX/comportamiento transport-agnóstica** sobre el contrato de ingesta de EID.
**Fecha**: 2026-05-29 (refinamiento inicial, sesión 18) · actualizado 2026-06 (folding ADR-024, sesión 22).
**Conducido por**: leader + Raf.
**Related**: **ADR-024** (transporte: contrato de ingesta de EID + adaptadores — **FUENTE DE VERDAD del transporte**), spec 09 (interfaz `BleStickEvent`/`useBleStickListener` que 04 implementa), spec 03 (MODO MANIOBRAS consume el listener), ADR-002 (stack), ADR-018 (navegación: pantalla de conexión en "Más"), `field-findings.md` (hallazgos de campo + investigación de mercado), CONTEXT/05 (hardware), CONTEXT/07 (día de campo).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos. **El transporte NO se decide acá — lo fija ADR-024.** Este context cubre el comportamiento/UX que el `spec_author` traduce a requirements/design/tasks. Cada "Caso y decisión" debe quedar cubierto por ≥1 `R<n>`.
> **Cambio vs. la v1 de este context**: la v1 asumía un único transporte **BLE GATT** (`react-native-ble-plx`). El día de campo (2026-05-30) y la investigación de mercado lo **refutaron** (el RS420 es Classic SPP+MFi; no hay GATT abierto en el mercado de stick readers; el camino abierto cross-platform es BLE-HID keyboard-wedge). ADR-024 reemplazó ese supuesto por un **contrato multi-adaptador**. Este context se actualizó en consecuencia.

## Contexto validado

04 hace que RAFAQ lea el **EID** (RFID, caravana electrónica FDX-B ISO 11784/11785, 15 dígitos) del bastón y lo entregue al **motor de identificación** (find-or-create de spec 09). El bastón es una de las puertas de BUSCAR ANIMAL (spec 09 R2) y la lectura dentro de MODO MANIOBRAS (spec 03).

**Transporte — ver ADR-024, no se re-decide acá.** El bastón se integra detrás de un **contrato de ingesta de EID transport-agnóstico** con adaptadores intercambiables. El MVP soporta:
- `adapter-spp-android` — RS420 nativo (Bluetooth Classic SPP). **Cubre al cliente beta.**
- `adapter-hid-wedge` — bastón BLE-HID que tipea el EID en un `TextInput` de "scan", en iOS+Android, sin MFi. **GATED**: requiere validación física antes de implementar (ver Pendientes).
- `adapter-web-serial` — RS420 por COM virtual (Web Serial API) en la notebook Windows. **Dev/test harness** (no producción).
- `adapter-manual` — carga manual del número (puerta cero, spec 09 R1). **Piso, siempre disponible.**
- `adapter-mock` — CI / dev sin device (ya pedido por spec 09).

La **validación del EID** (15 díg, normalización, prefijo país/fabricante — `parser-rs420.ts`, commit `9126dba`) y la **confirmación antes del commit** viven en el **contrato**, no en cada adaptador. MFi-Allflex + certificaciones de fabricantes = **track paralelo diferido** (canal Facundo).

**La arquitectura ya está contractualizada por spec 09** (no se re-decide acá):
- 04 implementa `services/ble/stick.ts` exponiendo `useBleStickListener` con la interface `BleStickEvent` de spec 09 (hoy stub que nunca dispara). El "contrato de ingesta" de ADR-024 es la generalización de esa interfaz a N adaptadores.
- `BleStickListenerProvider` (global) monta el/los adaptador(es) según plataforma/entorno; dispara el find-or-create de spec 09 al recibir `tag_read`.
- Expone `enableListener()` / `disableListener()` (MODO MANIOBRAS los usa) y `useBusyMode()` (CREATE/EDIT suspenden el listener).
- `useBleConnectionStatus()` para el estado de conexión.
- **Listener global**: activo en todas las pantallas EXCEPTO MODO MANIOBRAS (ADR-018). El alcance lo gobierna spec 09; 04 provee los eventos y el control enable/disable.

**Principio rector: manual-first.** El bastón es enhancement; la app funciona entera sin él (carga manual de IDV/visual, `adapter-manual`). La app **nunca se bloquea** por estado del bastón ni del transporte.

## Alcance

**Dentro (refinable ahora, transport-agnóstico)**: ciclo de vida de conexión/reconexión por adaptador, dedup de lecturas, **validación + confirmación del EID antes del commit**, feedback de lectura, fallback manual, permisos por transporte, indicador de estado, mock provider, normalización del EID. Implementación de la interface de spec 09 sobre el contrato de ADR-024.

**Dentro (MVP, por adaptador)**: `spp-android` (RS420, el beta), `web-serial` (RS420 dev/test), `manual` (piso), `mock` (CI). El `hid-wedge` entra al MVP **pero gated** por validación física.

**Fuera (post-MVP / track diferido)**: autorización MFi-Allflex + certificaciones de fabricantes (canal Facundo); multi-wand simultáneo (un bastón por dispositivo en MVP); background BLE (foreground-only); correlación EID↔peso (spec 05, balanza); `adapter-batch-dump` (bastón que bufferea offline y descarga después — proveedor candidato documentado en ADR-024, no MVP).

**Resuelto (ya NO bloqueante)**: el protocolo del RS420 (capturado en campo, `field-findings.md`: `□ + "1000000" + <EID 15d> + <YYMMDDHHMMSS>`, ASCII, 1 línea por lectura) y el `parser-rs420.ts` ya están de-riskeados y committeados (`9126dba`).

**Depende de**: spec 09 (interfaz + provider + motor find-or-create), spec 03 (consumidor en manga). NO depende de spec 02 directamente.

## Casos y decisiones

### Contrato de ingesta — validación y confirmación (NUEVO, ADR-024)
- Todo EID que llega de cualquier adaptador pasa por **normalización + `isValidTag`** (15 díg, prefijo país/fabricante) **antes** de tocar el motor.
- **Confirmación antes del commit**: por el riesgo de **declaración SENASA incorrecta** (un EID con un dígito corrupto se declara mal, 10 días hábiles), el contrato exige **confirmación visual de la lectura** antes de persistir. Lectura malformada → se descarta + log, no rompe el flujo (opcional toast).
- El **timestamp del teléfono** se usa para correlación (el del lector se descarta, ya en el parser; CONTEXT/05).

### Conexión y reconexión (decisión 1: recordar el bastón + reconectar solo) — por adaptador
- **`spp-android`**: pairing SPP **slave, PIN 1234** (RS420). Primera vez: pantalla de conexión (en "Más", ADR-018) que lista dispositivos y deja elegir; el elegido **queda guardado**. Después **reconecta automáticamente** (backoff) al abrir / volver a rango. Pantalla para cambiar/olvidar.
- **`hid-wedge`**: el **pairing lo maneja el SO** (el bastón es un teclado Bluetooth). La app no escanea BLE; provee un **campo de scan** enfocado que capta el tipeo. UX de "recordar" = el SO recuerda el teclado pareado.
- **`web-serial`**: `requestPort()` (gesto de usuario) + `getPorts()` para reconectar sin re-preguntar.
- **Un bastón por dispositivo** en MVP. **Múltiples disponibles cerca**: la pantalla de conexión (SPP) lista y recuerda el último.

### Desconexión a mitad de jornada
- El transporte se cae (fuera de rango, sleep, batería) → **reconexión automática** (donde aplica) con **indicador de estado**, y la **carga manual sigue disponible en 1 tap** (acceptance). No se interrumpe el flujo del operario. Logs no bloquean (acceptance).

### Lectura doble / dedup (decisión 2: dedup por TAG en ventana corta) — en el contrato
- Segunda lectura del **MISMO EID dentro de ~3s** se ignora (re-escaneo accidental no dispara dos veces).
- **EIDs distintos pasan al instante** — clave para la **asignación masiva de caravanas** (spec 09 R8: 3 escaneos seguidos de EIDs distintos = 3 animales).
- Dedup **por-TAG con ventana** (no cooldown global), transport-agnóstico. Valor ~3s ajustable.

### Feedback de lectura exitosa (decisión 3: vibración + sonido + visual)
- Al confirmar un EID válido (objetivo **<1s** del escaneo a pantalla, acceptance): **vibración táctil siempre** (se siente con guantes/barro), **beep configurable** (apagable; útil al sol/ruido) y **confirmación visual** (que además es el gate de confirmación pre-commit). Redundancia sensorial para manga.

### Fallback manual
- La **carga manual siempre disponible** (`adapter-manual`, puerta de spec 09 R1 — tab Animales / form), independiente del estado del bastón. Accesible en **1 tap** ante desconexión (acceptance). Bastón y tipeo manual alimentan el **mismo** contrato de ingesta → dos puertas a un mismo flujo.

### No-read / tag dañado
- Si el bastón se acciona pero no detecta tag (o está dañado), **no emite evento** → **silencioso**. Lo cubre el fallback manual (tipear el ID visual). (Si se confirma que algún reader emite señal de "lectura fallida", se folda.)

### Permisos y estado — por transporte
- **`spp-android`**: Android `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` (12+), location pre-12. Requiere **dev build** (módulo nativo `react-native-bluetooth-classic`; Expo Go no sirve).
- **`hid-wedge`**: el bastón es un **teclado del SO** → **no requiere permisos BLE de la app**; sí un campo enfocado. (UX iOS: el teclado HID **suprime el teclado en pantalla** — a verificar en el gate físico.)
- **`web-serial`**: permiso del navegador (Chromium/Windows, contexto seguro `localhost:8081`).
- Estados claros con CTA: bastón apagado / permiso denegado / buscando / conectado / desconectado. La **carga manual anda en todos los estados**. **Indicador global** (`useBleConnectionStatus`) en el chrome.

### Normalización del EID leído
- El adaptador entrega el EID ya recortado de framing (byte de control, cabecera, timestamp — en el parser del stream); el **contrato** normaliza/valida (15 díg, estructura) antes de find-or-create. Ya implementado/testeado (`parser-rs420.ts`).

### Mock provider (testing sin device)
- `adapter-mock` conforme a la interface (spec 09): inyecta lecturas simuladas → testea el stack entero (find-or-create, dedup, asignación masiva, MODO MANIOBRAS) sin hardware. Toggle de dev.

### Offline-first
- La lectura y el find-or-create funcionan **offline** (PowerSync local, spec 09 T5.2). El bastón no requiere internet.

### Ergonomía de manga (open question, del Council)
- ¿Quién sostiene el teléfono cuando el operario tiene el bastón en una mano, con barro/animal forcejeando? Puede empujar hacia captura con **mínima interacción de pantalla** (confirmación por audio/háptica) o, en el extremo, el `adapter-batch-dump`. **A validar con el operario beta**; no bloquea el MVP pero informa el diseño de la UI de scan.

## Pendientes

- **GATE FÍSICO — `hid-wedge` (BLOQUEANTE de ese adaptador)**: conseguir un lector HID-capable (test rig) y validar en **iPhone real**: tipea 15 díg completos + terminador (Enter); la supresión del teclado en pantalla no rompe la UX de manga; el `TextInput` de RN con foco captura confiable. Idem en Android. (ADR-024 §4.)
- **Verificar si los genéricos baratos de AR hacen HID** (Montetech ME-BL01 / Smart LFID) — define si el camino BLE-abierto es barato-en-AR o requiere importar un USD 595+.
- **Dev build con `react-native-bluetooth-classic`** para `spp-android` (necesita el Android de pruebas que Raf compra). Vetar compatibilidad del config plugin con Expo SDK 56.
- **Señal de "lectura fallida"** del reader: confirmar si existe a nivel protocolo (hoy se asume que no → no-read silencioso).
- **Battery Service** (low-battery warning): nice-to-have, hardware-dependiente.
- **Actualizar firmware del RS420** (acción de Raf, `field-findings.md`) y anotar si la trama SPP cambió.

## Insumos para spec_author

- **ADR-024** (`docs/adr/ADR-024-transporte-baston-contrato-ingesta-eid.md`) — **transporte: contrato de ingesta + adaptadores. Fuente de verdad. No re-decidir.**
- **spec 09** (`specs/active/09-buscar-animal/`) — interface `BleStickEvent`, `useBleStickListener`, `BleStickListenerProvider`, `useBleConnectionStatus`, `useBusyMode`, mock. 04 las **implementa** (ver `tasks.md` T1.5, Fase 4 T4.1-T4.5, T5.2).
- **spec 03** (`context.md`) — MODO MANIOBRAS suspende el listener (`disableListener`).
- `field-findings.md` — protocolo RS420 capturado + investigación de mercado (HID-wedge, precios, genéricos AR) + decisiones de transporte.
- `android-spp-impl-plan.md` — plan del `adapter-spp-android`.
- `web-serial-dev-harness-plan.md` — plan del `adapter-web-serial`.
- `app/src/services/ble/parser-rs420.ts` (commit `9126dba`) — `parseRs420Line`/`isValidTag`/`normalizeTag`. **Reuso directo.**
- ADR-002 (stack), ADR-013 (frontend stack), ADR-018 (listener global = no es tab; pantalla de conexión en "Más"), CONTEXT/05 (hardware), CONTEXT/07 (día de campo).

## Aprobación

- ✅ **Aprobado por Raf (sesión 22, 2026-06).** 04 pasa a `context_ready`: las decisiones de UX/comportamiento quedan lockeadas y el transporte queda gobernado por ADR-024. La spec se redacta just-in-time con `spec_author`. El `adapter-hid-wedge` queda en la spec como **gated** por el test físico (no bloquea `context_ready` ni la implementación de los otros adaptadores).
- **Pendiente (coordinación)**: mover 04 a `context_ready` en `feature_list.json` (lo hace Raf / la terminal de coordinación).
