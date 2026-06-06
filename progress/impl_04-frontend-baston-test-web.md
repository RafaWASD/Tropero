baseline_commit: 23ff54e9a6c4d8bdd06824f074d868906dab9ab2

# impl 04 — Pantalla de TEST WEB del bastón RFID (harness dev/test)

**Feature**: 04-bluetooth-baston (capa harness web; la capa buildable-hoy ya está committeada en `23ff54e`).
**Tipo**: harness de dev/test funcional (NO pantalla de producción — la de conexión R9 espera el design system).
**Objetivo**: que Raf valide `adapter-web-serial.ts` contra el RS420 real pareado a su notebook Windows, en `pnpm web`, lo antes posible.

## Nota de estado (pre-condición)

`feature_list.json` tiene la feature 04 en `deferred` (no `in_progress`). El `deferred` se puso a propósito porque el CHUNK buildable-hoy está DONE+committeado y el RESTO queda pendiente de hardware/decisión. Esta tarea **no implementa una task deferred de la spec**: es una herramienta de dev (un Expo Router route nuevo y self-contained) para **desbloquear la prueba real T2.5** ("Prueba real con RS420 en web", marcada `[~]` DIFERIDA por falta de hardware en la sesión de implementación). El leader scopeó esto explícitamente como harness self-contained. Se procede por eso; el harness no toca la spec ni el contrato committeado.

## Qué se construyó

- **Archivo nuevo**: `app/app/baston-test.tsx` — ruta navegable en web vía `http://localhost:8081/baston-test`.
- **Self-contained**: monta su propio `BleStickListenerProvider mode="auto"` (en web → selecciona `web-serial`). NO toca `app/app/_layout.tsx`, `(tabs)/*`, `mas.tsx`, `crear-animal.tsx` ni nada de la otra terminal.
- **No se tocó** `app/src/services/ble/` (cero bugs del adapter que bloquearan el harness — ver autorrevisión).

### Decisión de diseño (faithfulness al código committeado)

El brief pide un input de baud configurable. El `BleStickListenerProvider` instancia su `WebSerialAdapter` con baud fijo (9600) y NO auto-conecta (confirmado en el código: "NO auto-conectamos el transporte"). Para honrar el baud configurable sin tocar archivos compartidos, el harness instancia **su propia** `WebSerialAdapter(baud)` + un `EidIngestEngine` local, y cablea EXACTAMENTE como el provider:

```
línea cruda (adapter-web-serial: requestPort/open/read loop/LineFramer/backoff)
  → EidIngestEngine.processRawLine  (contract.ingestRawLine = parseRs420Line + isValidTag, R1)
  → dedup por-TAG ~3s               (dedup.ts, R3.1)
  → commit                          (tag_read con timestamp del teléfono, R1.5/R1.6)
  → fila en la lista en vivo        (confirmación visual, R2.1/R4.4)
```

Esto ejercita el código committeado que Raf quiere de-riskear (adapter-web-serial + contract + dedup + parser-rs420) end-to-end. El provider queda montado para que la pantalla sea self-contained y los hooks de spec 09 tengan contexto si se usan; su transporte interno nunca conecta (no se llama `.connect()` sobre él), así no hay dos conexiones serie en conflicto.

### Funcionalidad de la pantalla (vs. el brief)

| Pedido | Estado |
|---|---|
| Monta `BleStickListenerProvider` modo web | ✅ `mode="auto"` (web → web-serial) |
| Botón "Conectar bastón (Web Serial)" → `requestPort()` con gesto de usuario | ✅ `onConnect` (onPress) → `adapter.connect()` |
| Mostrar/editar el baud (default 9600) | ✅ `BaudInput`, default `DEFAULT_BAUD`, deshabilitado mientras conecta |
| Indicador de estado (apagado/conectando/conectado/reintentando/desconectado/sin permiso) con CTA | ✅ `statusView` + Card de estado |
| Lista en vivo de EIDs, más reciente arriba, con timestamp | ✅ `reads`, prepend, `formatTime` con ms |
| Contador de lecturas | ✅ "Lecturas (N)" |
| Confirmación visual de cada lectura (R4.4; beep/vibración no aplica en web) | ✅ fila destacada para la más reciente |
| Botón "Limpiar" | ✅ `onClear` |
| Mensaje si el navegador no soporta Web Serial (Safari/Firefox) — R5.6 | ✅ `UnsupportedBanner` (gate `Platform.OS==='web' && isWebSerialSupported()`) |
| ADR-023 §4: cero hardcode color/spacing, reusar Button/Card | ✅ tokens Tamagui + `Button`/`Card`; lint verde |

## Trazabilidad R<n> → verificación

Esta pantalla es un **harness manual** (la suite automatizada `node:test` de la capa committeada ya cubre los R con tests puros). La verificación de los R que el harness toca:

| R<n> | Cómo se verifica |
|---|---|
| R5.2 (requestPort con gesto) | `onConnect` corre dentro de `onPress` del Button → gesto de usuario. **Manual (Raf)**: el diálogo de puerto del navegador aparece. |
| R5.3 (read loop + framing → parser) | `adapter.onTagRead(rawLine)` → `processRawLine`. Cubierto por `adapter-web-serial.test.ts` (framing) + `parser-rs420.test.ts` (parseo). **Manual**: EID de 15 díg aparece en la lista. |
| R5.6 (degradar sin soporte) | `supported` gate → `UnsupportedBanner`. **Manual**: abrir en Firefox/Safari muestra el banner. |
| R1.3/R1.4 (validar/descartar) | `processRawLine` → `ingestRawLine` (isValidTag); malformado → `rejected` → no fila. Cubierto por `contract.test.ts`. |
| R3.1 (dedup mismo EID <3s) | `EidIngestEngine` con su `TagDedup`. Cubierto por `dedup.test.ts`. **Manual**: bastonear 2× el mismo EID rápido = 1 fila. |
| R1.5/R1.6 (timestamp del teléfono) | `commit(eid, now)` con `Date.now()`. Cubierto por `contract.test.ts`. |
| R4.4 (confirmación visual <1s) | fila en la lista al instante (sin red, local). **Manual**: latencia percibida. |
| R7.4 (no bloquea) | cancelar el diálogo / desconectar → estado claro, sin throw (`.catch(() => undefined)`). |

## Qué debe ver/hacer Raf (prueba real con RS420)

1. Parear el **Allflex RS420** a la notebook Windows por Bluetooth (queda como un puerto COM virtual — SPP). Confirmar el COM en el Administrador de dispositivos.
2. Levantar la app web: `pnpm web` (o `cd app && pnpm web`) en **Chrome o Edge** (Chromium). Web Serial NO existe en Firefox/Safari → la pantalla muestra el banner de "no soportado" (R5.6). Contexto seguro requerido; `localhost:8081` califica.
3. Navegar a `http://localhost:8081/baston-test`.
4. (Opcional) Ajustar el **Baud rate** si el lector no usa 9600 (el RS420 default es 9600).
5. Tocar **"Conectar bastón (Web Serial)"** → el navegador abre el diálogo de puertos serie → **elegir el COM del RS420**. El estado pasa a "Conectando…" → "Conectado".
6. **Bastonear** un animal (o un tag de prueba). El **EID de 15 dígitos** aparece arriba en la lista, destacado, con la hora local (hh:mm:ss.ms) — en **menos de 1 segundo**. El contador sube.
7. Bastonear el **mismo** EID dos veces rápido (<3s): debe aparecer **una sola** fila (dedup por-TAG, R3.1). Bastonear **EIDs distintos** seguidos: **una fila por cada uno** al instante (asignación masiva, R3.2).
8. "Limpiar" vacía la lista. "Desconectar" cierra el puerto.

### Caveats conocidos del Web Serial

- **Solo Chromium en contexto seguro**: Chrome/Edge en Windows. `localhost:8081` (HTTP) cuenta como contexto seguro para Web Serial. Firefox/Safari NO exponen `navigator.serial` → banner de degradado.
- **Gesto de usuario obligatorio**: `requestPort()` solo funciona desde el onPress del botón (ya cumplido). No se puede auto-conectar sin click.
- **Puerto exclusivo**: si el COM del RS420 ya está abierto por otra app (Allflex Connect, un terminal serie, otra pestaña), `open()` falla → estado "Desconectado". Cerrar la otra app y reintentar.
- **Reconexión**: si se pierde el puerto (bastón en sleep / fuera de rango), el adapter reintenta con backoff (`scanning` → reconnect). La carga manual nunca se bloquea (no aplica acá porque es harness, pero el estado no rompe la UI).
- **Trama**: el parser está anclado al formato capturado del RS420 (`□ + 1000000 + EID(15) + YYMMDDHHMMSS`). Si Raf actualizó el firmware y la trama cambió, el EID podría no parsear → re-capturar protocolo (Preguntas abiertas #5 de la spec). Riesgo bajo (el parser tolera `\r`/STX).

## Autorrevisión adversarial

Busqué activamente, como revisor hostil:

- **Desvío del spec / R no cubierto**: el harness cubre R5 (web-serial) + la confirmación visual de R4.4/R2.1 + dedup R3 + validación R1. NO cubre (ni debe) feedback sensorial (web no vibra/beepea, R4.5 lo dice), find-or-create (spec 09), ni la UI de producción R9. Coherente con el scope de "harness".
- **Edge cases**:
  - Cancelar el diálogo de `requestPort` → el adapter hace `emitStatus('disconnected')` en el catch (no throw); el harness no rompe. ✅
  - Baud inválido (texto vacío / no numérico) → `Number.parseInt` → fallback a `DEFAULT_BAUD` (guard `Number.isFinite(n) && n > 0`). ✅
  - Cambiar baud reconstruye el adapter (effect dep `[supported, baud]`); el cleanup desconecta el adapter viejo antes de crear el nuevo → no quedan dos conexiones ni listeners colgados. ✅
  - Re-escaneo del mismo EID <3s → `processRawLine` devuelve `null` → no fila (dedup). ✅
  - EID malformado → `'rejected' in candidate` → no fila, sin romper. ✅
  - Lista de muchas lecturas → `key={r.seq}` (incremental, estable); dos lecturas del mismo EID son filas distintas (correcto: son dos pasadas). ✅
- **Seguridad**: frontend puro, sin red, sin DB, sin secretos. No expone helpers como RPC. No hay multi-tenant acá (no toca `establishment_id`). El EID se valida con `isValidTag` antes de mostrarse (igual que el motor real). N/A el resto del checklist (RLS/search_path/etc.).
- **Tests que pasan por la razón equivocada**: no agregué tests nuevos (es un harness manual; la lógica subyacente ya tiene su suite `node:test` verde). El typecheck + lint + suite existente verifican que no rompí nada.
- **Self-containment**: verifiqué que NO importo ni toco `_layout.tsx`, `(tabs)/`, `mas.tsx`, `crear-animal.tsx`. La ruta `baston-test` la registra Expo Router por convención de archivo (file-based routing) — no hay que agregarla al `Stack` del `_layout.tsx` (es un route de primer nivel). El `RootGate` del layout podría re-rutear, pero solo cuando hay sesión/gating activo; para el harness Raf navega directo a la URL (en dev). Documentado como caveat menor: si el gating re-rutea, Raf puede probar el harness sin sesión completa (la pantalla no depende de auth/establishment).

Hallazgos que corregí durante la autorrevisión:
- `BaudInput` usaba `getTokenValue('$5', 'size')` (= 52px, token de spacing/size) en vez del font-size 16 → cambiado a `getTokenValue('$inputText', 'size')` (= 16, mismo patrón que el SearchBar de mis-campos.tsx). Si no, el input se veía gigante.
- `import { TextInput }` estaba a mitad de archivo → movido al top junto al resto (higiene; los imports se hoistean igual, pero queda más limpio).

## Bug del adapter

**Ninguno.** El `adapter-web-serial.ts` committeado se consumió tal cual (sin parches). No hubo bug que bloqueara el harness.

## Verificación

- `node scripts/check.mjs`: ver resultado al cierre (typecheck + anti-hardcode 0 + suite sin regresión).
