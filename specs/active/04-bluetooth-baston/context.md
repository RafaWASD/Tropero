# Spec 04 — Integración bastón Bluetooth (Allflex RS420) — Refinamiento de contexto (Gate 0)

**Status**: Pendiente de aprobación de Raf. **Parcial**: cubre la parte **no-hardware**; el protocolo BLE concreto queda BLOQUEANTE hasta el día de campo.
**Fecha**: 2026-05-29 (sesión 18)
**Conducido por**: leader + Raf (1 ronda de AskUserQuestion, 3 decisiones).
**Related**: spec 09 (define la interfaz `BleStickEvent`/`useBleStickListener` que 04 implementa), spec 03 (MODO MANIOBRAS consume el listener), ADR-002 (stack: react-native-ble-plx), ADR-013 (frontend stack), CONTEXT/05 (hardware), CONTEXT/07 (día de campo).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos. El `spec_author` lo lee como fuente de verdad y lo traduce a requirements/design/tasks — no re-decide nada de acá. Cada "Caso y decisión" debe quedar cubierto por ≥1 `R<n>`.
> **Refinamiento parcial**: las decisiones de UX/comportamiento se cierran acá; el protocolo BLE concreto (UUIDs + parsing) se finaliza tras el día de campo y se folda antes de implementar (Ola 2/B.3 del plan).

## Contexto validado

04 hace que RAFAQ lea el TAG electrónico (RFID) del bastón **Allflex RS420** vía BLE nativo (`react-native-ble-plx`, ADR-002) y lo entregue al motor de identificación. El bastón es la **puerta BLE** de BUSCAR ANIMAL (spec 09 R2) y la lectura dentro de MODO MANIOBRAS (spec 03).

**La arquitectura ya está contractualizada por spec 09** (no se re-decide acá):
- 04 implementa `services/ble/stick.ts` exponiendo `useBleStickListener` con la interface `BleStickEvent` declarada en spec 09 (hoy stub que nunca dispara).
- `BleStickListenerProvider` (global) monta el hook real; dispara el find-or-create de spec 09 al recibir `tag_read`.
- Expone `enableListener()` / `disableListener()` (MODO MANIOBRAS los usa) y `useBusyMode()` (CREATE/EDIT suspenden el listener).
- `useBleConnectionStatus()` para el estado de conexión.
- **Listener global**: activo en todas las pantallas EXCEPTO MODO MANIOBRAS (ADR-018). El alcance del listener lo gobierna spec 09; 04 solo provee los eventos y el control enable/disable.

**Principio rector**: **manual-first**. El bastón es enhancement; la app funciona entera sin él (carga manual de IDV/visual). La app **nunca se bloquea** por estado BLE.

## Alcance

**Dentro (no-hardware, refinable ahora)**: conexión/pairing y reconexión automática, ciclo de vida BLE, dedup de lecturas, feedback de lectura, fallback manual, permisos BLE, indicador de estado, mock provider, normalización del TAG leído. Implementación de la interface ya definida por spec 09.

**Fuera (post-MVP)**: multi-wand simultáneo (un bastón por dispositivo en MVP), background BLE (foreground-only), correlación TAG↔peso (eso es spec 05, balanza).

**BLOQUEANTE — requiere día de campo (CONTEXT/07)**: el protocolo BLE concreto del Allflex RS420 → **service y characteristic UUIDs** + **formato del mensaje al leer un TAG** (escaneo con nRF Connect). Sin esto, `services/ble/stick.ts` no puede leer del device real (sí compila y testea contra el mock). El `spec_author`/`implementer` lo folda antes de implementar B.3.

**Depende de**: spec 09 (interfaz + provider + motor find-or-create), spec 03 (consumidor en manga). NO depende de spec 02 directamente (entrega el TAG; el lookup lo hace spec 09).

## Casos y decisiones

### Conexión y reconexión (decisión 1: recordar el bastón + reconectar solo)
- **Primera vez**: pantalla de conexión (en "Más", ADR-018) que escanea dispositivos BLE y deja elegir el Allflex. El device elegido **queda guardado**.
- **Después**: la app **reconecta automáticamente** al bastón recordado al abrir / al volver a rango, sin intervención. Cero fricción en manga (una mano, barro).
- Pantalla para **cambiar de bastón** / olvidar el recordado cuando haga falta.
- **Múltiples Allflex cerca**: la pantalla de conexión lista los disponibles; se recuerda el último elegido.
- **Un bastón por dispositivo** en MVP.

### Desconexión a mitad de jornada
- BLE se cae (fuera de rango, bastón en sleep, batería) → **reconexión automática en background** (con backoff), **indicador de estado** lo refleja, y la **carga manual sigue disponible en 1 tap** (acceptance). No se interrumpe el flujo del operario.
- Logs de eventos BLE **no bloquean** el flujo (acceptance).

### Lectura doble / dedup (decisión 2: dedup por TAG en ventana corta)
- Una **segunda lectura del MISMO TAG dentro de ~3s** se ignora (re-escaneo accidental no dispara el flujo dos veces).
- Lecturas de **TAGs distintos pasan al instante** — clave para no romper la **asignación masiva de caravanas** (spec 09 R8: 3 escaneos seguidos de TAGs distintos = 3 animales).
- El dedup es **por-TAG con ventana**, no un cooldown global. Valor ~3s ajustable.

### Feedback de lectura exitosa (decisión 3: vibración + sonido + visual)
- Al leer un TAG con éxito (objetivo **<1s** del escaneo físico a pantalla, acceptance): **vibración táctil siempre** (se siente con guantes/barro), **beep sonoro configurable** (apagable; útil al sol/ruido) y **confirmación visual**. Redundancia sensorial para manga.

### Fallback manual
- La **carga manual está siempre disponible** (puerta manual de spec 09 R1 — tab Animales / form), independientemente del estado BLE. El bastón es enhancement puro. Manual accesible en **1 tap** ante desconexión (acceptance).
- "Correlación con teclado manual" (acceptance) = bastón y tipeo manual alimentan el **mismo** motor find-or-create de spec 09; son dos puertas a un mismo flujo.

### No-read / tag dañado
- Si el bastón se acciona pero no detecta tag (o el tag está dañado), **no emite evento** y la app no puede saber que hubo un intento fallido → **silencioso**. Lo cubre el fallback manual (tipear el ID visual). (Si el día de campo revela que el RS420 emite alguna señal de "lectura fallida", se folda.)

### Permisos y estado BLE
- Flujo de permisos: Android (`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` 12+, location pre-12), iOS (Bluetooth). Estados claros con CTA: **Bluetooth apagado**, **permiso denegado**, **buscando**, **conectado**, **desconectado**. La carga manual anda en todos los estados.
- **Indicador global de conexión** (`useBleConnectionStatus`) visible en el chrome.

### Normalización del TAG leído
- La app **normaliza/valida** lo que llega del bastón antes de pasarlo a find-or-create (trim, formato esperado de RFID). Lectura malformada → log, no rompe, opcional toast. El **byte-format exacto** del mensaje del RS420 se confirma el día de campo (BLOQUEANTE de arriba).

### Mock provider (testing sin device)
- 04 entrega una **implementación mock** del provider conforme a la interface (ya pedida por spec 09: bastón mockeado en CI). Permite testear el stack entero (find-or-create, asignación masiva, MODO MANIOBRAS) sin device físico. Toggle de dev para inyectar lecturas simuladas.

### Offline-first
- La lectura BLE y el find-or-create funcionan **offline** (PowerSync local, spec 09 T5.2). El bastón no requiere internet.

## Pendientes (CONTEXT/07)
- **BLOQUEANTE día de campo**: escanear el Allflex RS420 con nRF Connect → service/characteristic UUIDs + formato del mensaje del TAG. Documentar y foldar antes de implementar B.3.
- **Battery Service del Allflex** (low-battery warning): nice-to-have, hardware-dependiente (¿expone el 0x180F estándar? a ver el día de campo).
- **Señal de "lectura fallida"** del RS420: confirmar si existe a nivel protocolo (hoy se asume que no → no-read silencioso).

## Insumos para spec_author
- **spec 09** (`specs/active/09-buscar-animal/`) — define la interface `BleStickEvent`, `useBleStickListener`, `BleStickListenerProvider`, `useBleConnectionStatus`, `useBusyMode`, mock provider. 04 las **implementa**, no las redefine. Ver `tasks.md` T1.5, Fase 4 (T4.1-T4.5), T5.2.
- **spec 03** (`context.md`) — MODO MANIOBRAS suspende el listener (`disableListener`) y maneja su propio escaneo.
- ADR-002 (react-native-ble-plx), ADR-013 (frontend stack), ADR-018 (listener global = no es tab; pantalla de conexión en "Más").
- CONTEXT/05 (hardware), CONTEXT/07 (día de campo — protocolo BLE).

## Aprobación
- **Pendiente de aprobación de Raf.** Al aprobar, 04 pasa a `context_ready` **parcial**: las decisiones de UX/comportamiento quedan lockeadas; el protocolo BLE concreto sigue pendiente del día de campo (no bloquea pasar a `context_ready`, sí bloquea la implementación de B.3). La spec se redacta just-in-time (Ola 2), foldando el resultado del día de campo.
