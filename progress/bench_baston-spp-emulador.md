# Banco del bastón — `MODO_SPP` contra el A07 real

**Corrida**: 2026-07-29 23:46 → 2026-07-30 00:22 (leader, autónomo).
**Autorización**: Raf, esta sesión — *"lo de flashearlo mandale automático, ya está respaldado"*. Cierra la
decisión abierta §7.1 del handoff.

**Qué es esto**: la primera vez que la app lee una trama de bastón **de verdad**. Hasta hoy el camino SPP
estaba cableado y verde en unit, pero **nunca había pasado un byte por él** (§1 del handoff). El ESP32,
flasheado como emulador, cierra ese hueco.

---

## 1. Montaje (reproducible)

| pieza | valor |
|---|---|
| ESP32 | `ESP32-D0WD-V3 rev 3.1`, MAC base `b0:cb:d8:03:50:c8`, **BT Classic `B0:CB:D8:03:50:CA`** |
| firmware | `firmware/baston-emulator` `-DEMU_MODE=MODO_SPP`, 1.071.440 B, flasheado por `arduino-cli` a **115200** en COM7 |
| teléfono | Samsung `SM-A075M` (A07), **Android 15 / SDK 35**, por `adb` (`R8ML200W33L`) |
| APK | `ar.rafq.app` 0.1.0, instalado 2026-07-29 21:23 = el build de `dad711f` |
| emparejamiento | desde Ajustes de Android. **No pidió PIN**: Android 15 lo resolvió con un "¿Vincular?" simple, sin el `1234` que documenta el README del emulador |
| puente serie | `emu-bridge.py` (scratchpad): abre COM7 con DTR/RTS bajos para no resetear, log con timestamp, comandos por archivo |
| observación | `Lecturas (N)` de `/baston` leída por `uiautomator` + `logcat -s ReactNativeJS` (los `[ble]` de `logging.ts`) + traza del emulador |

`node scripts/check.mjs` → **RC=0** al arrancar la sesión.

**Verificación de mesa previa**: `selftest` del emulador imprimió
`\x021000000982000364696050260530101701\r\n` — **byte por byte igual** a la captura de campo de
`specs/active/04-bluetooth-baston/field-findings.md`.

---

## 2. El resultado que importa

**00:51:39 — la app ingirió su primera trama real.** `Lecturas (1)` con el EID `982000364696050`, en el
mismo segundo en que el emulador la emitió. La cadena completa —RFCOMM → `splitSppPayload` →
`parser-rs420` → `isValidTag` → `dedup` → commit → UI— **funciona en device**.

Y el driver la reconoció: la pantalla listó el device emparejado como **"Allflex RS420 — Reconocido"**
(`findDriverForDevice` matcheando `RS420-EMU` contra el `namePattern` del driver).

---

## 3. Los 16 escenarios del README del emulador

Todos contra el APK de `dad711f`, sin tocar código. `N` = filas en la lista de Lecturas de `/baston`.

| # | escenario | comando | esperado | **medido** | |
|---|---|---|---|---|---|
| E1 | repetidas dentro de la ventana | `same 5 300` | 1 | **1** | ✅ |
| E2 | repetidas cruzando la ventana | `gap 800` + `same 5` | 2 | **2** (00:55:01 y 00:55:04) | ✅ |
| E3 | ráfaga del mismo animal | `seq off`+`burst 8` | 1 | **1** | ✅ |
| E4 | ráfaga de animales distintos | `seq on`+`burst 8` | 8 | **8** | ✅ |
| E5 | lecturas espaciadas | `same 5 3500` | 5 | **5** | ✅ |
| E6 | muchos animales | `seq on`+`read 20 500` | 20 | **20**, ninguna perdida | ✅ |
| E7 | 9 tramas malformadas | `bad header…garbage` | 0 + descarte silencioso | **0**, y **9** `eid_rejected` (8 `parse_failed` + 1 `empty`) — una por trama, ni de más ni de menos | ✅ |
| E8 | trama sin terminador, sola | `bad noterm` | no se entrega | **0** | ✅ |
| E8b | sin terminador + una válida | `bad noterm`+`read` | se come la siguiente | **0** — se la come, confirmado | ✅ |
| E9 | trama partida | `split 300` | 1 reensamblada | **1** | ✅ |
| E10 | dos tramas pegadas | `double` | 2 | **2** | ✅ |
| E11 | terminador LF solo | `term lf`+`read` | igual que CRLF | **1** | ✅ |
| E12 | sin STX | `stx off`+`read` | igual | **1** | ✅ |
| E13 | corte del link | `drop` | `disconnected` + reintento | detecta a los **~6 s**, `attempt:0`, reconecta **1,4 s** después | ✅ |
| E14 | bastón apagado 8 s | `off 8000` | sobrevive al 1er fallo y reconecta solo | reconecta a los **~10 s** y **vuelve a leer** | ✅ |
| E15 | corte repetido | `flap 4 3000` | "backoff creciente" | reconecta las 4 veces, **pero el backoff NO crece** — ver §4.3 | ⚠️ |
| E16 | conectado pero mudo | `mute 20` | `connected`, 0 ingestas | **0**, sigue `connected` | ✅ |

**El dedup compone exactamente como dice `dedup.ts`**: E1/E2/E4 dan 1/2/8. La ventana se mide desde la
última emisión **confirmada** (por eso E2 da 2 y no 1) — verificado en device, no deducido.

---

## 4. Hallazgos del banco

### 4.1 🔴 BENCH-1 — un corte con la app minimizada deja un "Bastón conectado" MENTIROSO (nuevo)

**No está en el informe del reviewer. Es el peor hallazgo de la noche.**

Secuencia (**3/3 reproducciones, determinista**):

1. app conectada y leyendo, en primer plano;
2. se minimiza (HOME);
3. el link se cae mientras está minimizada (`off 8000`);
4. se vuelve a la app.

**Resultado**: la pantalla dice **"Bastón conectado — Bastoneá un animal: la lectura entra sola"**,
indefinidamente (verificado a los 5 s y a los 70 s). El emulador dice `link=libre`. Los bastonazos salen
como **`lectura (DESCARTADA, nadie conectado)`** y la app ingiere **0**.

**No hay ni un `[ble]` en logcat desde antes de minimizar**: la app **nunca se enteró** de la desconexión.

**Causa** (leída, no ejecutada): `scheduleReconnect()` (`adapter-spp-android.ts:421-440`) sí maneja bien el
caso de estar en background — se suscribe a `onForeground` y reintenta al volver. Pero **solo se llega ahí
si la desconexión se DETECTÓ**. El único detector es el evento del SO, y con la app congelada en background
(Android 15 + One UI son agresivos) ese evento **se pierde**. Al volver a foreground **nada reconcilia**:
`unsubForeground` solo existe mientras hay un reintento pendiente, así que si no hubo reintento programado,
el retorno a primer plano no chequea nada. **La app confía en un evento que puede perder, y no tiene
segunda fuente de verdad.**

**Acotado**: minimizar **solo** no rompe nada — 60 s en background sin tocar el bastón y al volver el link
sigue vivo y lee (verificado). El defecto es específicamente **corte + background**.

**Por qué es 🔴 de manga**: es el escenario normal de trabajo. El operario guarda el teléfono en el bolsillo,
el bastón se apaga o sale de rango, saca el teléfono y ve el chip verde. Bastonea 40 animales y **no se
registra ninguno**, sin un solo indicio. Es la clase de "verde mentiroso" que ya nos quemó dos veces.

**Lo que pido**: verificación de liveness al volver a foreground (y/o un heartbeat de "conectado sin un byte
hace N s"), no confiar solo en el evento.

### 4.2 🔴-1 del reviewer — CONFIRMADO en device, y peor de lo que decía

El reviewer lo probó con un probe unitario. En el device se reproduce con un gesto **que un operario hace
todo el tiempo**:

1. se apaga el Bluetooth (`cmd bluetooth_manager disable`);
2. la app pide activarlo → diálogo del sistema *"RAFAQ le está solicitando que active Bluetooth"*;
3. **el operario prende el Bluetooth desde el panel rápido en vez de contestarle al diálogo** (lo natural).

**Resultado medido**: Bluetooth **prendido** (`bluetooth_on=1`), bastón disponible, y la app **2 min 40 s
sin un solo evento `[ble]`**. Cero. El latch `connectInFlight` queda tomado esperando una promesa que
depende de un diálogo que el operario ya resolvió por otro lado. La cadena de reintentos está muerta y la
UI no ofrece salida.

Se recuperó **exactamente** al cancelar el diálogo (BACK) → `connect_error: "User did not enable Bluetooth"`
→ `reconnect_attempt: 1` → conectado 2 s después. O sea: **el adapter queda rehén de un diálogo del sistema
sin timeout de ningún tipo.**

### 4.3 ⚠️ El README del banco afirma algo FALSO: el backoff no crece

`firmware/baston-emulator/README.md` dice que `flap 4 3000` tiene que dar *"backoff creciente"*. Medido en
los 4 ciclos:

```
00:05:54.140  reconnect_attempt attempt:0   → conectado 00:05:59.395
00:06:02.220  reconnect_attempt attempt:0   → conectado 00:06:07.523
00:06:10.350  reconnect_attempt attempt:0   → conectado 00:06:15.661
00:06:18.458  reconnect_attempt attempt:0   → conectado 00:06:23.738
```

**`attempt:0` las cuatro veces.** El contador se resetea con cada conexión exitosa sin exigir que el link
**dure** — que es exactamente el 🟡-3 del reviewer, y su predicción #5 gana. La expectativa del README es la
equivocada y **queda corregida ahí**.

Efecto lateral que conviene saber: en estos ciclos solo se ve **un** `reconnect_attempt` por corte, no la
escalera. El `connect()` nativo **bloquea** mientras la radio está abajo y termina resolviendo cuando
vuelve, así que la escalera de backoff **casi no se ejercita**. Refuerza 🔴-1: si ese connect bloqueante no
volviera nunca, el latch queda tomado para siempre.

### 4.4 🟠 BENCH-2 — arreglar el terminador NO alcanza: el buffer nativo envenena la trama siguiente

Refina el 🟠-5 del reviewer con evidencia. Con `term cr` (terminador CR solo) la app queda **conectada y
muda** — predicción #7 del reviewer, confirmada: 0 ingestas, 0 errores, 0 logs.

**Lo que no estaba previsto**: al restaurar `term crlf`, la primera trama válida **tampoco se ingiere**
(medido: 0). Recién la segunda entra. Es el `StringBuffer` sin cota del nativo: las 5 tramas CR quedaron
acumuladas y la primera con LF las arrastra a todas en una sola línea gigante que no parsea
(se ve el `eid_rejected: parse_failed` correspondiente). Un lector con el terminador equivocado no solo se
calla: **deja una mina puesta**.

### 4.5 🟠 BENCH-3 — `/baston` no está en `BLE_OWNED_ROUTES`: cada bastonazo abre el overlay global encima

`FindOrCreateOverlay.tsx:97` — `BLE_OWNED_ROUTES = {'asignar-caravanas', 'maniobra'}`. **`baston` no está**,
y `StickConnectionScreen` no toma el scanner acotado ni prende `busyMode`. Medido: cada lectura en `/baston`
se consume **dos veces** — entra en la lista de Lecturas de la pantalla **y** abre el sheet global
*"Caravana leída / ¿Es uno de tus animales sin caravana?"* tapando la pantalla.

Rompe la invariante que el propio proyecto se construyó ("un solo consumidor efectivo"), y pega justo donde
más incomoda: `context-multivendor.md` §3 define esta pantalla como **la cara de la demo a los fabricantes
de bastones**. Demo real = tocás conectar, bastoneás, y un modal te tapa lo que estabas mostrando.

*(No contamina las mediciones de esta corrida: el overlay no suspende la escucha — verificado leyendo
`useBleStickListener({enabled, onTagRead})` sin `busyMode`— y los conteos se leen de la lista de la pantalla.)*

### 4.6 ⚪ Latencia de detección del corte: ~2 a 6 s

`drop` → la app tarda **~6 s** en pasar a desconectada; con `off` (radio abajo) **~2 s**. No es un defecto
declarado en ninguna spec, pero es el tiempo durante el cual la UI promete un bastón que ya no está.

---

## 5. Predicciones del reviewer, contrastadas

| # | predicción | veredicto |
|---|---|---|
| 1 | connect disparado desde background (viola R6.9) | **no reproducida en el orden que probé** (minimizar y *después* cortar): no hubo ni un intento. El caso exacto del reviewer —cortar en foreground y minimizar antes de que dispare el timer— **no se probó**; queda abierto |
| 2 | BT apagado → Conectando… sin salida | ✅ **confirmada** (§4.2), con un camino más realista todavía |
| 3 | auriculares BT apagados matan el bastón (🔴-2) | **no probada — falta un 2º device Classic.** El A07 no tenía ningún otro emparejado. Sigue en pie por lectura del Java |
| 4 | tocar otra fila mientras conecta = nada | **no probada** (hay un solo device en la lista) |
| 5 | `flap`: delays con reset en cada ciclo | ✅ **confirmada** — `attempt:0` × 4 (§4.3) |
| 6 | `bad noterm`+`read` → 0 ingestas | ✅ **confirmada** (E8b) |
| 7 | `term cr` → conectado y mudo, sin log | ✅ **confirmada**, + el envenenamiento de §4.4 |
| 8 | `mute` idéntico al #7 siendo otra cosa | ✅ **confirmada** — mismo síntoma exacto, indistinguibles |
| 9 | dedup 1 / 2 / 8 | ✅ **confirmada** (E1/E2/E4) |
| 10 | `double` → 2, separadas por el nativo | 2 ingestas ✅; **la atribución no es observable desde afuera** |

Y una confirmación indirecta del 🟡-1: `isRawStream` **hoy está bien** (si `spp-android` faltara en esa
lista no habría entrado ni una lectura). El hallazgo sigue en pie por lo que es: una lista de literales
duplicada, sin tests, que si alguien toca deja el bastón mudo con la suite en verde.

---

## 6. Qué queda gated por hardware ajeno (después de esta corrida)

De la lista de "qué NO valida" del README del emulador, sigue sin verificarse: el emparejamiento y los
tiempos del RS420 real, su semántica de desconexión, su buffer/sessions, el firmware desactualizado que
marcó Allflex, iAP/MFi, y qué tipea exactamente un lector BLE-HID comercial. **Todo lo demás
—stream, dedup, ráfagas, reconexión, backoff, malformadas, mudez— ya está verificado en device.**

Se agrega uno nuevo: **🔴-2 necesita un segundo device Classic** (unos auriculares alcanzan). Es una prueba
de 1 minuto para Raf.
