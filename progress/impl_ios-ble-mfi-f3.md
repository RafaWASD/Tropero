# impl — delta `ios-ble-mfi` · **Fase F3**: `adapter-ble-gatt` (código + tests puros)

baseline_commit: 3272227fbcb05a9a1c57c2e25702450a3f98f1cc

> `3272227` = «feat(04): el parser sale del registro de drivers + BLE GATT vetado contra un build real»
> (F1 + F2 cerradas y commiteadas). Es el punto desde el cual el Gate 2 calcula el diff de ESTA fase.
> No se re-usa el baseline de F1/F2: cada fase se despacha y se audita por separado (ADR-028 Nivel B).

**Fecha**: 2026-08-17. **Spec**: `specs/active/04-bluetooth-baston/{requirements,design,tasks}-ios-ble-mfi.md`.
**Alcance**: **solo Fase F3** (T3.1–T3.13). F1/F2 no se tocan. F4 (selección/prioridad/UI/driver del
emulador), F5 (`adapter-mfi-ios`), F6 (banco en device) y F7 (HID) **quedan fuera** por contrato.

> ⚠️ **Esta fase se terminó en DOS sesiones.** La primera murió por límite de sesión con el código escrito
> y una suite en rojo, sin informe. La segunda (esta) cerró el rojo, encontró y corrigió lo que estaba
> verde midiendo otra cosa, completó T3.11 —que estaba **sin hacer**—, registró las suites en el check y
> escribió esto. Todo lo que dice "(sesión 2)" abajo es de la segunda pasada.

---

## 0. Lo primero, para que ningún verde se lea de más

| Afirmación | Estado |
|---|---|
| El transporte BLE **está escrito** y su máquina de estados se ejercita completa con entorno inyectado | ✅ |
| El transporte BLE **es alcanzable en producción** | ❌ **NO** — `selectTransportAdapter` nunca devuelve `'ble-gatt'` y `adapterForTransport('ble-gatt')` sigue en `null`: eso es **F4** (T4.1/T4.6). Y `isBleGattTransportAvailable()` exige además un driver `ble-gatt` en el registro, que también entra en F4 (T4.3) |
| El transporte BLE **lee de un dispositivo real** | ❌ **NO VERIFICADO** — es el banco del ESP32 en `MODO_GATT` (**F6**, RBM6.1). Lección de `dad711f`: un transporte "escrito y testeado" sin device tenía tres 🔴 de máquina de estados |
| F3 **cambia el comportamiento de alguna plataforma hoy** | ❌ no. El `case` del provider existe, está probado y **nadie lo elige** |
| Hay **UI** nueva | ❌ no (la pantalla de conexión es F4/T4.8) → **Gate 2.5 N/A en esta fase**, ver §9 |

---

## 1. Plan (tasks de la fase) — estado final

| Task | Qué | Estado |
|---|---|---|
| T3.1 | `ble-gatt-protocol.ts` (PURO): `decodeBase64Ascii`, `normalizeUuid128`, `bleGattDelimiterIsSupported`, `resolveBleGattParams` | ✅ |
| T3.2 | `ble-gatt-protocol.test.ts` | ✅ (23) |
| T3.3 | `driver-types.ts`: `ble-gatt` gana `delimiter?` | ✅ |
| T3.4 | `adapter-ble-gatt.ts`: `StickAdapter` con `BleEnv` inyectado + import perezoso | ✅ |
| T3.5 | Escaneo filtrado por `serviceUuid` y acotado + `ble_scan_timeout` | ✅ |
| T3.6 | Notificación → `decodeBase64Ascii` → `LineFramer(delimitador del driver)` → línea cruda | ✅ |
| T3.7 | `adapter-selection.ts` / `permissions.ts` / `stick-adapter.ts` += `'ble-gatt'` | ✅ |
| T3.8 | `instantiateTransport`: `case 'ble-gatt'` solo si el módulo nativo está en el build | ✅ |
| T3.9 | Las 10 lecciones del SPP, implementadas | ✅ (13 mutantes, §5) |
| T3.10 | `remembered-device.ts` + `autoConnect()` con la política de triggers del SPP | ✅ |
| T3.11 | `spp-bridge-timeout-guard.test.ts` += el adapter nuevo, falsificado | ✅ **(sesión 2 — estaba sin hacer)** |
| T3.12 | `adapter-ble-gatt.test.ts`: máquina de estados completa con entorno inyectado | ✅ (75) |
| T3.13 | Reensamblado con el troceo real (20 bytes, dos pegadas, STX partido, sin terminador) | ✅ |

**Extra fuera de la fase, con motivo**: `scripts/run-tests.mjs` — T8.7 es de F8, pero **3 de sus 5 suites ya
existían y ninguna corría** (incluida `frame-parser-resolve.test.ts`, de **F1**). Registrarlas recién en F8
dejaba tres fases dando "verde" sobre oráculos que nunca se ejecutaban. Ver §7.

---

## 2. Archivos de esta fase (la lista para el Gate 2)

**Nuevos** (untracked al cierre):

| Archivo | Qué |
|---|---|
| `app/src/services/ble/ble-gatt-protocol.ts` | PURO: base64→latin-1, UUIDs canónicos, delimitador soportado, `resolveBleGattParams` + opciones de scan/connect |
| `app/src/services/ble/ble-gatt-protocol.test.ts` | 23 tests |
| `app/src/services/ble/adapter-ble-gatt.ts` | el `StickAdapter` `kind:'ble-gatt'` (import perezoso, `BleEnv` inyectado, las 10 lecciones del SPP) |
| `app/src/services/ble/adapter-ble-gatt.test.ts` | 75 tests |

**Modificados** (todos 04-owned):

| Archivo | Cambio |
|---|---|
| `app/src/services/ble/adapter-selection.ts` | `AdapterKind`/`ADAPTER_KINDS`/`ADAPTER_INGEST_MODE` += `'ble-gatt'` (`raw-line`) |
| `app/src/services/ble/permissions.ts` | `PermissionModel` += `{kind:'ble'}` + su `case` |
| `app/src/services/ble/stick-adapter.ts` | el union de `kind` += `'ble-gatt'` (aditivo; **ningún método cambia**) |
| `app/src/services/ble/driver-types.ts` | `TransportCapability` `ble-gatt` += `delimiter?` |
| `app/src/services/ble/line-framer.ts` | delimitador **parametrizado** (default `'\n'`) — estaba hardcodeado |
| `app/src/services/ble/connect-trigger.ts` | `LINK_DWELL_MS` se mudó acá (política de la cadena, no de un adapter) |
| `app/src/services/ble/adapter-spp-android.ts` | re-exporta `LINK_DWELL_MS` (sus call sites no cambian) |
| `app/src/services/ble/logging.ts` | += `ble_scan_timeout {ms, seen}` |
| `app/src/services/ble/BleStickListenerProvider.tsx` | `instantiateTransport` += `case 'ble-gatt'` |
| `app/src/services/ble/spp-bridge-timeout-guard.test.ts` | **(sesión 2)** el guard pasa de un archivo a una tabla derivada del árbol |
| `app/src/services/ble/adapter-ingest-mode.test.ts` | **(sesión 2)** aserción explícita de `ble-gatt` → `raw-line` |
| `scripts/run-tests.mjs` | **(sesión 2)** += 3 suites (⚠️ archivo compartido: ver §7) |
| `specs/active/04-bluetooth-baston/{tasks,design,requirements}-ios-ble-mfi.md` | reconciliación al as-built (§8) |
| `progress/impl_ios-ble-mfi-f3.md` | este informe |

---

## 3. El rojo con el que arrancó la sesión 2, y qué era de verdad

**Test**: `el escaneo NO se auto-sella: el driver decide, y el filtro nuestro no cuenta como match`.
**Síntoma**: `state.fire('scan')` → `no hay timer 'scan' pendiente`.

**La pregunta que había que contestar primero** (leyendo el código, no suponiendo): ¿`findDriverForDevice`
matchea un device **sin nombre y sin UUIDs anunciados**? **Medido, no deducido**:

```
1) device anónimo total (name/localName/serviceUUIDs ausentes) -> null: NO matchea
2) device que solo anuncia el UUID NUS, driver que matchea por nombre -> null: NO matchea
```

O sea: **el producto está bien**. `matchesDevice` exige `typeof device.name === 'string'` para la rama de
nombre y **las dos** listas presentes para la de UUIDs; y `recognizes()` del adapter le pasa al driver los
UUID que el device **anunció**, nunca el `serviceUuid` con el que filtramos. Era **el fixture**:

```ts
name: opts.name ?? 'TEST-GATT-01',          // ← `{ name: null }` devuelve… 'TEST-GATT-01'
serviceUUIDs: opts.serviceUUIDs ?? [NUS_SERVICE],
```

`??` no puede expresar *"el SO no expone este campo"*. El device "anónimo" del test salía **con el nombre por
default**, o sea **reconocible** → el escaneo lo aceptaba → `finish()` cancelaba el presupuesto → el
`fire('scan')` explotaba. Y el mismo `??` dejaba **verde midiendo otra cosa** al test de al lado (*"el
reconocimiento acepta el nombre del ANUNCIO (`localName`)"*): matcheaba por el **GAP name** del default, así
que probaba lo que ya sabíamos y no lo que dice su título.

**Desenlace: fixture (2), no producto (1).** Lo que se hizo:

1. `fakeDevice` distingue "no lo declaré" (default) de "lo declaré `null`" (el SO no lo expone), con el
   motivo escrito arriba de la función.
2. **META-TEST del fixture**: un device declarado anónimo tiene que salir anónimo de verdad — y el default
   tiene que seguir siendo el reconocible (si no, todos los tests del camino feliz probarían el camino del
   device anónimo sin que nadie se enterara).
3. Anti-vacuidad en el test del `localName`: `assert.equal(d.device.name, null)` **antes** de conectar.

### 3-bis. Y el test que decía cazar un mutante que NO cazaba

El test del auto-sellado usaba `TEST_DRIVER`, que matchea **solo por nombre**. Con ese driver, el mutante que
el propio comentario del test describe —pasarle al driver NUESTRO `serviceUuid` como "lo que el device
anunció"— **pasa en verde**: si el `deviceMatch` no mira UUIDs, no hay nada que sellar. Medido: con el
mutante puesto, **70 de 71 tests verdes** y el único rojo era… otro. El test se reescribió con:

- un driver que **sí** reconoce por `advertisedServiceUuids` (el único con el que el mutante tiene efecto);
- **control positivo**: un device que anuncia el servicio de verdad **sí** se reconoce (sin esta mitad, el
  "no conecta" podría venir de que el matcher por UUID no funciona en absoluto);
- la aserción de que el escaneo **sigue en curso** cuando aparece el device anónimo.

**Falsificado**: con el mutante, muere **ese** test y ningún otro de los 75. Es el invariante de RBM5.13 — el
bridge de la balanza Vesta (ADR-003) anuncia los **mismos** UUID Nordic UART, así que un match laxo haría que
la app reconozca **la balanza como un bastón** y le mande el peso al ingesta de EID.

---

## 4. Trazabilidad `RBM<n>` → test

Abreviaturas: **A** = `app/src/services/ble/adapter-ble-gatt.test.ts`, **P** = `…/ble-gatt-protocol.test.ts`,
**G** = `…/spp-bridge-timeout-guard.test.ts`, **I** = `…/adapter-ingest-mode.test.ts`,
**F** = `…/frame-parser-resolve.test.ts` (F1).

| Requisito | Test(s) |
|---|---|
| RBM2.1 (kind `ble-gatt`, mismo código iOS/Android) | **A**: `RBM2.1/RBM2.11: el adapter es kind…` (el "mismo código" es estructural: no hay una sola rama por plataforma en el archivo) |
| RBM2.2 (import perezoso) | **A**: `RBM2.2/RBM2.3: sin módulo nativo, loadBleManager devuelve null…` (la suite entera **importa** el módulo en node sin RN: si el require fuera top-level no cargaría ninguno de los 75) |
| RBM2.3 (sin binario → no se monta) | **A**: `RBM2.2/RBM2.3…` + `RBM2.3: sin driver ble-gatt en el registro…` + `un adapter construido SIN driver no tira…` |
| RBM2.4 (escaneo FILTRADO por `serviceUuid`) | **A**: `RBM2.4: el escaneo va FILTRADO…` (uuids = `[serviceUuid canónico]`) · **A (fix-loop)**: `RBM2.4/RBM2.6/RBM2.8: los TRES parámetros del transporte salen DEL DRIVER — …` ×2 perfiles + `ANTI-VACUIDAD de los perfiles…` ← **es esta la que cubre "del driver"**; la vieja `…el servicio y la característica del MONITOR salen del driver` medía la NORMALIZACIÓN (título corregido) · **P**: los 3 tests de `normalizeUuid128` |
| RBM2.5 (escaneo acotado, se detiene) | **A**: `RBM2.5: el escaneo que se agota se DETIENE…`, `RBM2.5: startDeviceScan que RECHAZA…`, `un error por el listener del escaneo…`, `un disconnect() en medio del escaneo APAGA LA RADIO`, `un stopDeviceScan que NO VUELVE no cuelga…`, `RBM3.2: un escaneo que NO SE ASIENTA NUNCA…` |
| RBM2.6 (connect + discover + suscripción a notify) | **A**: `RBM2.4/RBM2.6…`, `el descubrimiento de servicios que se cuelga…`, `el descubrimiento que RECHAZA…` · **A (fix-loop)**: los 2 parametrizados `…salen DEL DRIVER` (el servicio y la característica del monitor, por perfil) |
| RBM2.7 (base64 → 1 byte = 1 char, con STX) | **P**: `la trama con STX sobrevive el round-trip`, `un byte ≥ 0x80 NO se mangle (contraprueba de UTF-8)`, `el padding y el whitespace…`, `un valor que NO se puede decodificar → null` · **A**: `RBM2.7/RBM2.8: … entrega la LÍNEA CRUDA (con su STX)`, `una notificación que no se puede decodificar se DESCARTA con log` |
| RBM2.8 (reensamblado con el delimitador del driver) | **P**: `la trama partida en trozos de 20 bytes…`, `un trozo que corta EL STX…`, `el framer corta por el delimitador DEL LECTOR (\r)`, `multi-carácter consume el delimitador COMPLETO`, `regresión: sin delimitador declarado sigue cortando por \n` · **A**: `RBM2.8/RBM2.12: la trama partida en trozos de 20 bytes… es UNA lectura`, `el buffer del framer NO se arrastra entre sesiones` · **A (fix-loop)**: los 2 parametrizados `…salen DEL DRIVER` — el delimitador **del driver** (`'\r'` en el perfil alternativo), con las dos direcciones (el terminador ajeno NO cierra línea) ← **es esta la que cubre "del driver" en el ADAPTER**; en **P** se prueba el framer, no el adapter |
| RBM2.9 (dos tramas pegadas = dos lecturas) | **P**: `DOS tramas pegadas… son DOS lecturas` · **A**: `RBM2.9: dos tramas PEGADAS…` |
| RBM2.10 (delimitador no frameable → no abre) | **P**: `el delimitador vacío NO está soportado`, `los TRES motivos de "no alcanzable" son distintos`, `un delimitador declarado VACÍO no cae al default (?? y no ||)`, `un driver con OTRO fin de trama lo impone` · **A**: `RBM2.10: un delimitador que no podemos framear NO abre la conexión` |
| RBM2.11 (`ADAPTER_INGEST_MODE` = `raw-line`) | **I**: `los adaptadores de STREAM entregan LÍNEA CRUDA` (aserción explícita, sesión 2) + los dos exhaustivos · **A**: `RBM2.1/RBM2.11…` |
| RBM2.12 (MTU por defecto) | **P**: `el payload por notificación… son 20 bytes`, `chunk 20 y chunk 0 dan el MISMO resultado`, `el connect NO pide MTU` · **A**: `RBM2.8/RBM2.12…` |
| RBM2.13 (permisos por transporte) | **A**: `RBM2.13: el entorno REAL pide el conjunto de permisos DEL TRANSPORTE BLE, no el del SPP` (**oráculo estático, declarado**, ver §6-b) + `permissionModelFor('ble-gatt')` en `RBM2.1/RBM2.11…`; la tabla en sí es de F2 (`permissions-android.test.ts`, 26 tests) |
| RBM2.14 (permiso denegado → CTA, sin backoff) | **A**: `RBM2.14: permiso DENEGADO…`, `RBM2.14 (iOS): radio Unauthorized…`, `permiso unavailable… no granted` |
| RBM2.15 (sin background) | F2 (`app.config.test.ts`) + **A**: `RBM3.6: el foreground se verifica AL DISPARAR…`, `el autoConnect en BACKGROUND no arranca` |
| RBM2.16 (`remembered-device` + `autoConnect`) | **A**: `RBM2.16: el device conectado se PERSISTE…`, `RBM2.16: con bastón recordado NO se escanea`, `el autoConnect sin bastón recordado NO toca la radio`, `RBM3.2: el readRemembered colgado vence…` |
| RBM3.1 (tope de la cadena sin gesto) | **A**: `RBM3.1: la cadena que NADIE pidió tiene tope…` (**+ fix-loop**: exige además que el timer con el presupuesto vencido NO sume un intento → mata la copia del timer, ⚪-4), `RBM3.1: una cadena con el presupuesto VENCIDO muere aunque la app esté en BACKGROUND` (**nueva, sesión 2**), `RBM3.1: el tope… NO acota los primeros 2 minutos`, `RBM3.1: un tap del operario DESTOPA la cadena` · **A (fix-loop)**: `RBM3.1/RBM3.7: un tap con el intento EN VUELO también DESTOPA la cadena…` (diferencial) |
| RBM3.2 (presupuesto en todo await + latch con generación) | **A**: los 4 tests `RBM3.2: …` + `un disconnect() mientras se abría el link…`, `un intento VIEJO que despierta… (orphan_socket_kept)` · **G**: los 5 tests `[adapter-ble-gatt.ts]` |
| RBM3.3 (guard estático de presupuestos) | **G**: `TODO await que cruza el puente…`, `el adapter importa el mecanismo y lo usa DE VERDAD`, `el escáner NO está ciego`, `la promesa del puente que se guarda (pending)`, `el latch… se libera SIEMPRE`, `la tabla… se DERIVA del árbol` |
| RBM3.4 (desconexión de fuente propia) | **A**: `RBM3.4: la suscripción… es POR DEVICE — el listener GLOBAL no se usa nunca`, `RBM3.4: la desconexión de OTRO device no afecta al bastón`, `la desconexión del PROPIO device corta…`, `un evento… SIN id legible se acepta` |
| RBM3.5 (2ª fuente de verdad, fail-closed) | **A**: los 4 tests `RBM3.5: …` + `sin sonda de liveness (lib vieja) se DICE una vez`, `la sonda con el link VIVO no molesta`, `el monitor que MUERE…` |
| RBM3.6 (foreground **al disparar**) | **A**: `RBM3.6: el foreground se verifica AL DISPARAR el timer…` |
| RBM3.7 (encolar el connect a otro target) | **A**: `RBM3.7: un connect a OTRO bastón… se ENCOLA y se atiende`, `RBM3.7: un segundo connect al MISMO target… deja log` · **A (fix-loop)**: `RBM3.1/RBM3.7: un tap con el intento EN VUELO también DESTOPA…` (la otra mitad de esa rama: el **efecto**, no solo el log) |
| RBM3.8 (ningún diálogo del SO desde un timer) | **A**: `RBM3.8: el camino AUTOMÁTICO consulta el permiso; jamás lo pide`, `RBM3.8: el GESTO del operario sí pide`, `el autoConnect NO arranca con la radio apagada` · **A (fix-loop)**: `RBM3.8: CONSULTAR y PEDIR pueden dar resultados distintos…` (la distinción por **resultado**, no por contadores) |
| RBM3.9 (dwell del backoff) | **A**: `RBM3.9: un FLAP no resetea el backoff` (**+ fix-loop**: con el reloj arrancado en un instante real, así el dwell se mide como INTERVALO), `RBM3.9: un link que DURÓ resetea el backoff al piso` |
| RBM3.10 (`connected_silent`) | **A**: `RBM3.10: conectado y MUDO queda escrito… y NO se desconecta` (**+ fix-loop**: reloj no-cero + `ms` asertado por `JSON.parse`, no por substring) |
| RBM3.11 (máquina de estados en node:test con entorno inyectado) | **A**: los **81** (incluidas 8 promesas que **no resuelven nunca**, reloj inyectado —y ahora **ejercitado** desde un instante real— y desconexión de otro device) |
| RBM1.3 (el adapter expone su driver) | **A**: `RBM1.3: el adapter EXPONE su driver…`, `⚪-3 de F1: el ReadSource se resuelve al CABLEAR y el driver NO MUTA` · **F** (F1) |
| RBM5.11 (no se registra ningún lector real) | **A**: `RBM5.11: bleGattDriverFrom devuelve el primero…` + `GUARD: si el registro llega a declarar DOS drivers ble-gatt…`; y el driver de los tests es **sintético y local** |
| RBM5.13 (reconocer por nombre, no por UUID) | **A**: `RBM5.13: un device que anuncia el MISMO servicio pero NO lo reconoce el driver no se conecta`, `el escaneo NO se auto-sella…`, `el reconocimiento acepta el nombre del ANUNCIO (localName)`, `META-TEST del fixture…` (la otra mitad —el driver del emulador— es F4) |
| RBM9.4 (offline-first) | Estructural y verificado por grep: **cero** `fetch(`, `supabase`, `powersync` en los dos archivos nuevos. Los 75 tests corren sin red |
| RBM9.5 (la carga manual nunca se bloquea) | Estructural: el adapter **nunca lanza** hacia afuera (toda falla es un estado + log) y `instantiateTransport` devuelve `null` cuando no hay transporte. **A**: `un adapter construido SIN driver no tira (no se lleva el render)` |
| RBM9.6 (no se toca ningún método de `StickAdapter` ni spec 09) | Diff: `stick-adapter.ts` solo extiende el union de `kind`; ningún archivo bajo `app/src/features/animals/` |
| R10.5 (`enable`/`disable`) | **A**: `R10.5: disable() corta la ESCUCHA sin desconectar` |

**RBM sin test en esta fase, con su motivo**: RBM2.17/RBM2.18 (censo y veto de la dep) son **F2**;
RBM2.15 se verifica en la config (**F2**); RBM5.12/RBM5.14 y el resto de RBM5 son **F4**; RBM4.\* es **F5**;
RBM6.\* es **F6** (device); RBM8.\* es F0/F7.

---

## 5. Tabla de mutantes

Metodología: se aplica **un** mutante al fuente, se corren las **5** suites juntas, se anota **qué** test lo
mata y se revierte. La batería se corrió con la suite en **133** tests (el total final es **136**: los 3 que
se agregaron *después*, por lo que la batería encontró — el de MB3.1 y los dos del §6-f). La restauración se verifica byte a byte contra una copia
del original y se re-corre la baseline al final (`POST-RESTORE: pass 133`).

### 5.1 Las lecciones del SPP (RBM3) — lo que el leader pidió

| # | Lección / requisito | Mutante | Resultado | Muerto por |
|---|---|---|---|---|
| MB3.4-a | **RBM3.4** desconexión de fuente propia | se borra el filtro por id del handler → atiende la desconexión de **cualquier** device | 132/133 | `RBM3.4: la desconexión de OTRO device no afecta al bastón` |
| MB3.4-b | **RBM3.4** ídem, por la otra puerta | se suscribe **además** al listener GLOBAL de la lib | 132/133 | `RBM3.4: la suscripción… es POR DEVICE — el listener GLOBAL no se usa nunca` |
| MB3.2-a | **RBM3.2** latch + generación | el latch **no se libera** en el `finally` de `runConnect` | 119/133 (**14 rojos**) | 4× `RBM3.2: …`, 4× `RBM3.5: …`, 2× `RBM3.9: …`, `RBM3.1`, `RBM3.7`, `orphan_socket_kept`, el framer entre sesiones **y** el guard estático `[adapter-ble-gatt.ts]: el latch… se libera SIEMPRE` |
| MB3.2-b | **RBM3.2** generación de intento | `disconnect()` **no invalida** la generación en curso | 132/133 | el guard estático `[adapter-ble-gatt.ts]: el latch de conexión se libera SIEMPRE (finally) y también en disconnect()` |
| MB3.2-c | **RBM3.2** techo del await | el `await` del connect **pierde su presupuesto** | **HANG** (la suite no termina) | Lo caza el **guard estático** (M1 de §5.2) — y el hang es la prueba literal de por qué un await sin techo es 🔴: en device eso son los 2 min 40 s del A07 |
| MB3.5-a | **RBM3.5** reconciliación al volver a foreground | no se arma la sonda de foreground | 129/133 | 3× `RBM3.5: …` + `el teardown no deja timers ni suscripciones huérfanas` |
| MB3.5-b | **RBM3.5** poll periódico | el watchdog **no sondea** el liveness (solo mira la mudez) | 132/133 | `RBM3.5: el POLL periódico detecta el link muerto sin depender de ningún evento` |
| MB3.5-c | **RBM3.5** fail-**closed** | la sonda que RECHAZA se lee como "sigue conectado" (fail-open) | 131/133 | `RBM3.5: la sonda que RECHAZA se lee como "no estamos conectados"` + `…que NO RESUELVE NUNCA vence y también cae del lado cerrado` |
| MB3.1 | **RBM3.1** tope de la cadena sin gesto | se borra el chequeo del presupuesto de la **cabecera** de `scheduleReconnect` | ⚠️ **SOBREVIVIÓ** (133/133) → **test nuevo** → ahora 132/133 | `RBM3.1: una cadena con el presupuesto VENCIDO muere aunque la app esté en BACKGROUND` (escrito en la sesión 2 por este mutante) |
| MB3.6 | **RBM3.6** foreground **al disparar** | el foreground se chequea solo al **programar** | 132/133 | `RBM3.6: el foreground se verifica AL DISPARAR el timer, no solo al programarlo` |
| MB3.9 | **RBM3.9** dwell del backoff | el backoff se resetea con **cualquier** conexión (sin exigir que el link durara) | 132/133 | `RBM3.9: un FLAP no resetea el backoff (el dwell exige que el link haya DURADO)` |
| MB3.10 | **RBM3.10** `connected_silent` | la mudez del link deja de registrarse | 132/133 | `RBM3.10: conectado y MUDO queda escrito (connected_silent) y NO se desconecta` |
| MB3.7 | **RBM3.7** encolado del otro target | el connect a otro bastón se descarta en silencio | 132/133 | `RBM3.7: un connect a OTRO bastón durante un intento se ENCOLA y se atiende` |
| MB3.8 | **RBM3.8** ningún diálogo desde un timer | el camino automático **PIDE** el permiso en vez de consultarlo | 132/133 | `RBM3.8: el camino AUTOMÁTICO consulta el permiso; jamás lo pide` |

**El mutante que sobrevivió, y qué se hizo.** MB3.1 dejó las 133 en verde porque el tope está chequeado
**dos veces** (cabecera de `scheduleReconnect` **y** adentro del timer) y todos los caminos que la suite tenía
pasaban por el timer. Lo que **solo** la copia de la cabecera cubre: llegar a programar un reintento con la
cadena **ya vencida** y la app en **background** — sin ella el orden se invierte (primero el gate de
foreground), la cadena se **parquea** esperando el retorno a primer plano en vez de morir, y el tope de
RBM3.1 pasa a ser **evitable guardando el teléfono en el bolsillo**, justo en el escenario que lo motivó
("ese bastón lo vendí / quedó en otro campo"). El test nuevo simula lo que pasa de verdad: el intento tarda
(en producción hasta 20 s por connect, la cadena topea a los 120 s) y el operario guarda el teléfono
mientras corre → exige `'off'` + `autoconnect_exhausted` + **cero** listeners de foreground esperando.
Verificado en las dos direcciones: pasa con el código bueno, **cae** con MB3.1 puesto.

> **Corrección del fix-loop (⚪-4 del review)**: el párrafo de arriba presentaba la doble copia como "dos
> oráculos" y eso era falso para la copia **del timer** — el reviewer midió que borrarla dejaba 136/136 en
> verde, porque el desenlace observado (`off` + `autoconnect_exhausted`) se alcanzaba igual por la cabecera,
> **un intento después**. Era un oráculo (cabecera) + un cinturón (timer). Ya no: el test del tope exige
> además que con el presupuesto vencido el timer **no sume un intento**, y los dos mutantes caen (§12).

### 5.2 Guards y oráculos (sesión 2)

| # | Qué vigila | Mutante | Resultado |
|---|---|---|---|
| M1 | **RBM3.3** — todo await del puente con techo | se le saca el `withTimeout` a `manager.stopDeviceScan()` | 🔴 el guard cae **nombrando `adapter-ble-gatt.ts:1127`** — y las **75** pruebas del adapter quedan en **VERDE** (por eso el guard existe) |
| M2 | la tabla del guard se **deriva del árbol** | se saca `adapter-ble-gatt.ts` de `RADIO_ADAPTERS` (**el estado real en que estaba el árbol**) | 🔴 `la tabla de adaptadores con radio se DERIVA del árbol (uno nuevo nace en rojo)` |
| M3 | el escáner del guard **no está ciego** | se renombra la variable de la lib (`manager` → `mgr`, 26 ocurrencias) | 🔴 `el escáner NO está ciego` + `la promesa del puente que se guarda (pending)` |
| M4 | **RBM2.13** — el conjunto de permisos del transporte | `defaultBleEnv` pide `'spp'` en vez de `'ble-gatt'` | **sobrevivía 121/121** → se agregó el guard → 🔴 `RBM2.13: el entorno REAL pide el conjunto de permisos DEL TRANSPORTE BLE` |
| M5 | **RBM5.13** — el filtro nuestro no es un match | `recognizes()` le pasa al driver `[params.serviceUuid]` como `advertisedServiceUuids` | con el test viejo **pasaba en verde**; con el reescrito 🔴 `el escaneo NO se auto-sella…` (y **ningún otro** de los 75 lo ve) |

---

## 6. Autorrevisión adversarial (sesión 2)

Un árbol que nadie revisó, escrito por un agente que murió a mitad de camino. Lo que busqué, en este orden,
y lo que encontré:

**(a) ¿Qué está verde midiendo otra cosa?** → **3 hallazgos**, todos cerrados:
1. el `??` del fixture (§3) — un test verde por el GAP name donde decía medir el `localName`;
2. la contraprueba del auto-sellado, que **no falsificaba** el mutante que su propio comentario describe
   (§3-bis);
3. **el permiso del transporte** (M4): toda la suite inyecta un `BleEnv` falso, así que **nada** ejercía
   `defaultBleEnv()` — cambiar los dos literales a `'spp'` dejaba 121 tests en verde y en producción
   significaba escanear **sin `BLUETOOTH_SCAN`** (API ≥ 31) o **sin `ACCESS_FINE_LOCATION`** (API ≤ 30): cero
   resultados, sin error y sin log. Se agregó un guard **estático y declarado como tal** (un oráculo de
   comportamiento es imposible sin RN: las dos funciones devuelven `'unavailable'` para los dos transportes
   cuando no hay `PermissionsAndroid`), con **contraprueba** de que los dos conjuntos son distintos de verdad
   (si fueran iguales, el guard sería teatro).

**(b) ¿Qué task quedó sin hacer?** → **T3.11 estaba sin empezar** (el guard de presupuestos no conocía el
adapter nuevo). Y al hacerlo apareció que el task pedía el **lugar equivocado**: `BOUNDED_AT_THE_BOUNDARY`
solo mira awaits de primitivas nativas, que el adapter BLE **no tiene** → habría sido una entrada **vacua**
(cero awaits mirados, verde garantizado, RBM3.3 "cumplido" sin vigilar nada). Se hizo sobre la mitad
correcta, con la tabla **derivada del árbol** y un test de **no-ceguera**. Detalle en la reconciliación de
RBM3.3.

**(c) ¿Cableado a medias / imports muertos?** (el `tsc` verde no lo dice) → el `case 'ble-gatt'` del provider
**está completo** (`isBleGattTransportAvailable() ? new BleGattAdapter() : null`, con los dos motivos de
indisponibilidad logueados por separado) y es el **único** call site; no hay imports a módulos de F4/F5 que
no existan; el único importador de `adapter-ble-gatt` es el provider. **Pero está inalcanzable** (la
selección es F4) y eso quedó escrito en tres lugares (§0, tasks T3.8, design §4) en vez de dejarlo implícito.

**(d) ¿Código exportado que no usa nadie?** → `sameUuid()` en `ble-gatt-protocol.ts`: exportado y con 5
aserciones propias, **cero call sites de producción**. Cobertura que no mide nada del camino real, y no lo
pedía ningún task (T3.1 lista otras cuatro funciones). **Borrado**, con el motivo escrito en el archivo y con
las aserciones re-escritas sobre `normalizeUuid128` (que es la que sí se usa) para no perder el invariante.
Se dejó anotado dónde **sí** haría falta comparar UUID el día que aparezca: el cruce del `deviceMatch` en
`driver-registry.ts`, que hoy compara con `toLowerCase()` y **no** expande la forma corta de 16 bits — de
`multivendor`, y no se toca en esta fase.

**(e) ¿Tipos?** → `app/tsconfig.json` **excluye `**/*.test.ts`**, así que el typecheck del repo **no ve** los
tests. Corriendo `tsc` a mano sobre el archivo aparecieron **2 errores reales**: (1) `assert.deepEqual(x, [])`
narra `x` a `never[]` (la firma de @types/node es `asserts actual is T`) y rompía un `push` posterior; (2) un
`let` asignado dentro del callback de un `new Promise` queda narrado a `null` → `never` al invocarlo. Los dos
corregidos, y verificado que los tests **pre-existentes** de esta carpeta no tienen esa clase de error (o
sea: no es un artefacto de mis flags).

**(f) ¿Fixtures muertos?** → tres knobs del doble estaban declarados y nunca usados. `discoverRejects` y
`hangStopScan` ahora tienen su test —y no son de relleno: el primero fija que un **rechazo** del nativo se
loguee como `connect_error` y **no** como `bridge_timeout` (decir "timeout" cuando el nativo sí contestó es
un diagnóstico falso), el segundo que un `stopDeviceScan` que no vuelve **no cuelgue** el camino de conexión
ni deje el latch tomado—. `removeFiresMonitorError` se **eliminó como knob**: la conducta fiel a la lib pasa
a ser incondicional, así que el oráculo del "nuestro propio teardown dispara el error del monitor" no se
puede desactivar.

**(g) ¿Bordes sin cubrir en el camino de datos?** → el EID: **este delta no toca** `isValidTag`, la dedup ni
la confirmación pre-commit (RBM1.8). Lo que el adapter entrega es la **línea cruda**, y los tests lo verifican
pasándola por `ingestRawLine(línea, driver.frameParser)` de punta a punta, con el `STX` **intacto** (si el
adapter "limpiara" bytes, el parser del driver dejaría de reconocer su trama).

**(h) Offline-first / multi-tenant** → cero red y cero `establishment_id` en los archivos nuevos (grep, §4).
Los 75 tests corren sin red por construcción.

> **Lo que esta autorrevisión NO vio, y es la lección de la sesión** (lo encontró el review y está cerrado en
> §12): busqué "¿qué está verde midiendo otra cosa?" y encontré **tres instancias**, pero no la **clase** —
> que el fixture declaraba **un solo juego de parámetros de driver**, así que las tres claims *"el parámetro
> sale del driver"* no se podían falsificar. Es exactamente el bug del `??` del `fakeDevice` una capa más
> arriba: barrí la instancia, no la familia. La autorrevisión del fix-loop (§12.5) sí se hizo enumerando la
> **ausencia** (los ejes del fixture que eran monocultura) y encontró dos más por su cuenta.

**(i) ¿Rompe el bundle de web?** (riesgo que F3 introduce: un `require('react-native-ble-plx')` nuevo en el
grafo de Metro) → **medido**: `pnpm run e2e:build` (`expo export -p web`) → **rc=0**, bundle generado. No
prueba que las ~70 specs E2E pasen (eso es una corrida de Playwright, del leader), pero sí que el bundle que
esas specs necesitan **se construye**.

---

## 7. `scripts/run-tests.mjs` — archivo compartido

Se agregaron **3** suites a la lista explícita del bloque de tests del cliente:
`frame-parser-resolve.test.ts` (de **F1**, que había nacido sin registrar), `ble-gatt-protocol.test.ts` y
`adapter-ble-gatt.test.ts`. Faltan `ea-protocols` y `adapter-mfi-ios`, que son de **F5** y no existen.

⚠️ **El archivo lo está tocando también la otra terminal** (rebrand fase 5: el bloque de
`scripts/lib/backup-ci-consistency.test.mjs`, Cat. H). Verificado después de editar: su comentario y su
entrada **siguen intactos** (`grep -c backup-ci-consistency.test.mjs` → 2, uno en el comentario y uno en el
comando). Mi edición vive en otro `run(...)`, ~100 líneas más abajo.

---

## 8. Reconciliación de specs al as-built

`tasks-ios-ble-mfi.md`: las 13 tasks de F3 en `[x]`, cada una con sus notas **(as-built)**; encabezado de la
fase con el estado y con lo que F3 **no** deja andando; nota **(parcial)** en T8.7.

`design-ios-ble-mfi.md`:
- §2.2 gana tres filas que la tabla no tenía y que el as-built **sí** tocó (`line-framer.ts`,
  `connect-trigger.ts`, `adapter-ingest-mode.test.ts`) y precisa la de `logging.ts` (`seen`).
- §4 gana un recuadro **as-built** con las 4 diferencias reales contra el flujo de 11 pasos: **falta un paso
  (la radio)** con sus tres desenlaces y la decisión de **nunca** llamar `manager.enable()`; el **doble
  techo** del escaneo; la **generación de sesión** (la trampa del `cancelTransaction` de esta lib); y el
  framer en la clausura de la sesión. Más el ⚠️ de que el transporte no es alcanzable hasta F4.
- la "nota de implementación para F3" sobre el **servicio de ubicación** en API ≤ 30 quedó reconciliada:
  **no se implementó**, con el motivo (la lib no lo expone; leerlo pide una dep nativa nueva) y con lo que sí
  se hizo para no dejarlo invisible (`ble_scan_timeout {seen:0}`).

`requirements-ios-ble-mfi.md`: **8 notas de reconciliación** (no se reescribió ningún EARS), bajo RBM2.3,
RBM2.5, RBM2.8, RBM2.13, RBM2.14, RBM3.1, RBM3.3 y RBM5.13.

**Recomendación al leader** (no la aplico porque `docs/backlog.md` lo está editando la otra terminal): anotar
en el backlog (1) el estado del **servicio de ubicación** en Android ≤ 30 como escenario del banco de F6, y
(2) que `driver-registry.ts` compara UUIDs anunciados con `toLowerCase()` sin expandir la forma corta de
16 bits — hoy inocuo (los NUS son 128 bits), relevante el día que un driver declare un servicio estándar.

---

## 9. Gates

**Gate 1 (`security_analyzer` modo `spec`): N/A**, verificado como pide RBM9.2 —con `git status --porcelain`,
que **sí** ve untracked, y **cruzado contra la lista de archivos de §2**—:

```
$ git status --porcelain supabase/ sync-streams/
 M supabase/functions/health/index.ts
```

Esa línea **no es de esta fase**: es de la **otra terminal** (rebrand fase 7 — `RAFAQ_ENV` →
`MITROPERO_ENV` con lectura de los dos nombres en dos tiempos). No aparece en §2 y no la tocó F3. Cero
migraciones, cero RPC, cero Edge Functions, cero policies, cero `sync-streams/` (RBM9.1).

**Gate 2 (`security_analyzer` modo `code`)**: obligatorio, diff desde `3272227`. Lo que le puede interesar,
enumerado por mí antes de que lo pregunte:

- **Qué sale por el log.** Los 26 call sites de `logTransportEvent` del adapter están enumerados y **ninguno
  loguea la línea cruda ni el EID** (el `ble_decode_failed` va sin payload, y las líneas del framer no se
  loguean nunca). Importa porque `logTransportEvent` no es solo `console.info`: manda además un **breadcrumb
  de Sentry** que hace `data: { ...event }` — el spread completo del evento— apoyado en la premisa escrita en
  `payloads.ts` de que los miembros de `TransportLogEvent` "solo llevan campos diagnósticos". El evento nuevo
  de F3 (`ble_scan_timeout {ms, seen}`) **respeta esa premisa**.
- **Identificadores de dispositivo.** El único dato de esa clase que F3 agrega al log es el **id del device**
  dentro de `ble_device_not_recognized: <id>` (en Android es una MAC). Es el **mismo dato** que el SPP ya
  manda desde `multivendor` (`connect_superseded {deviceId}`, un miembro declarado del union): no es el EID ni
  datos del animal, y no cambia la clase de dato que ya viajaba. Lo dejo dicho en vez de que aparezca como
  hallazgo: si se decide que un id de dispositivo no debe salir del teléfono, es una decisión sobre **los dos
  transportes** y sobre el union entero, no sobre esta fase.
- **Cero superficie de datos**: no hay DB, ni auth, ni tokens, ni secrets, ni red (§4, RBM9.4). El EID sigue
  entrando por el mismo camino de spec 09, sin tocar `isValidTag`, la dedup ni la confirmación pre-commit.

**Gate 2.5 (ADR-029, capturas): N/A en esta fase, y no por omisión.** F3 no toca **ninguna** superficie de
UI: no hay pantallas, sheets, formularios ni componentes en el changeset (§2 — todo es
`app/src/services/ble/` + un `case` en el provider, que no renderiza). La UI del transporte BLE (flujo
escanear → listar → elegir, y el CTA "Buscar de nuevo") es **F4/T4.8**, y sus capturas están pedidas en
T8.11 + T6.6 (device). Un `.capture.ts` de F3 sería una captura de una pantalla que esta fase no cambió.

---

## 10. Verificación

| Qué | Resultado |
|---|---|
| `npx tsc -p app/tsconfig.json --noEmit` | **rc=0** |
| `tsc` a mano sobre los 5 test files editados (el proyecto los excluye) | **sin errores** (había 2, corregidos) |
| `adapter-ble-gatt.test.ts` | **75/75** → **81/81** tras el fix-loop |
| `ble-gatt-protocol.test.ts` | **23/23** |
| `spp-bridge-timeout-guard.test.ts` | **15/15** |
| `adapter-ingest-mode.test.ts` | **8/8** |
| `frame-parser-resolve.test.ts` (F1, ahora registrada) | **15/15** |
| Bloque **completo** de unit tests del cliente de `run-tests.mjs` (con las 3 suites nuevas dentro) | **3275/3275** → **3281/3281** tras el fix-loop |
| `pnpm run e2e:build` (`expo export -p web`) | **rc=0** — el bundle de web sobrevive el `require` nuevo |
| 18 mutantes (13 de RBM3 + 5 de guards) | 17 muertos, 1 sobrevivió → **test nuevo** → muerto |

**No corrido, y por qué**: `node scripts/check.mjs` completo **no** se corrió en esta sesión — sus stages de
backend pegan contra la **DB remota compartida** y hay otra terminal trabajando (el patrón conocido de
`Request rate limit reached` fabrica rojos que no son regresiones). Lo que F3 puede romper está **entero**
dentro de los dos primeros stages (typecheck + unit del cliente), y los dos se corrieron verdes. `pnpm e2e`
(Playwright, ~38 min) tampoco: queda para el leader contra su baseline — con el dato de que el **build** de
web ya está verificado.

---

## 11. Qué queda pendiente después de F3

| Qué | Fase | Por qué no acá |
|---|---|---|
| Que el transporte **se pueda elegir** (prioridad iOS, `adapterForTransport`, bastón recordado, UI) | **F4** | T4.1/T4.6/T4.8 — F3 solo construye el adapter |
| El **driver del emulador** `ESP32_GATT_DRIVER` (y con él `isBleGattTransportAvailable()` en `true`) | **F4** | T4.3. RBM5.11: en F3 no se registra ningún driver, ni real ni de banco |
| Que esto **lea de un dispositivo real** (las 3 🔴 que el SPP encontró recién en device) | **F6** | RBM6.1, banco `MODO_GATT` en Android (local) y iOS (OK de build de Raf) |
| El estado del **servicio de ubicación** en Android ≤ 30 | F6 + backlog | La lib no lo expone; ver §8 |
| `ea-protocols` / `adapter-mfi-ios` en `run-tests.mjs` | F5 → F8 | Todavía no existen |

---

# 12. FIX-LOOP del review (`progress/review_ios-ble-mfi-f3.md`, CHANGES_REQUESTED)

**Fecha**: 2026-08-17, misma jornada. **Naturaleza del cambio**: **todo es oráculo**. El reviewer midió aparte
que el producto está bien (un driver con `delimiter:'\r'` entrega la lectura), y yo lo volví a medir: el
**único** cambio de código de producción es **borrar una firma muerta** de la superficie modelada
(`BleManagerLike.cancelDeviceConnection`, cero call sites) + dos comentarios. Cero cambios de comportamiento.

> **Cómo leer esta sección**: todo lo que sigue lo **ejecuté** (mutante aplicado → 5 suites → revertido →
> hash verificado). El baseline del fix-loop es **136/136**; el cierre es **142/142**.

## 12.1 Los tres mutantes bloqueantes (🟠-1): reproducidos y muertos

Antes de escribir una línea reproduje los tres mutantes que el review nombra, sobre el árbol tal como estaba:

| Mutante | Qué re-hardcodea | ANTES del fix | DESPUÉS |
|---|---|---|---|
| `:1088` (M-17) | el UUID del **filtro del escaneo** → literal NUS | **136/136 sobrevive** | 🔴 **muere** — `…los TRES parámetros del transporte salen DEL DRIVER — servicio de 16 bits + \r`, y falla en **su** aserción (`actual: ['6e400001-…']` vs `expected: ['0000ffe0-…']`) |
| `:970-971` (M-18) | **servicio + característica** del monitor → los dos literales | **136/136 sobrevive** | 🔴 **muere** — mismo test, en la aserción de `monitorArgs` |
| `:968` (M-19) | `new LineFramer(params.delimiter)` → `new LineFramer()` | **136/136 sobrevive** | 🔴 **muere** — mismo test, en la aserción de que el terminador **ajeno** no cierra línea (con el default `'\n'`, el `\n` del perfil `\r` cerraba una línea que no debía) |

**El arreglo es de fixture y es estructural, como pedía el review**: la suite ahora declara una tabla
`DRIVER_PROFILES` con **dos** juegos de parámetros y los recorre de punta a punta (escaneo filtrado → device
reconocido → connect → discover → monitor → notificación en base64 → reensamblado → **EID**). El segundo
perfil no comparte **ningún** parámetro con el primero: servicio `FFE0` (forma corta de 16 bits, en
mayúsculas → ejercita la expansión de `normalizeUuid128`), característica `ffe1` (minúsculas), fin de trama
`'\r'`, y otro id de device. Más un test de **anti-vacuidad** que exige que los dos juegos difieran en los
tres campos y que ninguno del alternativo colisione con los canónicos NUS: si mañana alguien "prolija" los
fixtures igualándolos, cae ese test en vez de volverse teatro en silencio.

**No se agregó ninguna aserción sobre el fuente ni sobre nombres**, como el leader pidió explícitamente: el
invariante se **observa** por comportamiento.

## 12.2 🟡-2 — el destope de la cadena por tap, con oráculo

`adapter-ble-gatt.ts:651`. Mutante M-15 (borrar `if (policyFor(trigger).chain !== 'inherit')
this.applyChainPolicy(trigger);`): **136/136 sobrevivía** → ahora 🔴 muere nombrando
`RBM3.1/RBM3.7: un tap con el intento EN VUELO también DESTOPA la cadena (no solo si ya murió)`.

El test es **diferencial** y por eso no puede pasar por vacuidad: corre el MISMO escenario dos veces (cadena
`autoconnect` con el connect gateado, presupuesto vencido mientras el intento está en vuelo, y después el
intento falla) y exige que **con** el tap la cadena siga reintentando (`≠ 'off'`,
`autoConnectExhausted === false`, un timer `reconnect` armado, **sin** `autoconnect_exhausted` en el log) y
que **sin** el tap muera en `'off'` con su log. O sea: el presupuesto se venció de verdad en las dos mitades y
lo único que cambia el desenlace es el gesto del operario.

## 12.3 🟡-3 — las cuatro piezas muertas, una decisión por cada una (con el motivo)

| Pieza | Decisión | Motivo, medido |
|---|---|---|
| `FakeEnvOptions.checkPermission` | **SE CABLEA** | No era un knob decorativo: sin él, `checkPermissions()` y `ensurePermissions()` devolvían **lo mismo** en toda la suite y los dos caminos solo se distinguían por contadores. **Medido**: borrar el gate de permiso del `autoConnect` (`if (permission !== 'granted') skip('permission')`) sobrevive **141/141 con el test nuevo excluido** (`--test-skip-pattern`), o sea que ningún otro oráculo de la suite lo ve. El test nuevo ejercita la secuencia REAL —`check → denied` (nunca se pidió el permiso) y después `ensure → granted` (el gesto muestra el diálogo y el operario concede)— y exige que el arranque no conecte, no toque la radio y **no emita estado**. El mutante ahora 🔴 muere |
| `FakeEnvOptions.clock` | **SE CABLEA** | Con el reloj en 0, `now() - lastDataAt` y `now()` dan el mismo número (ídem `now() - connectedAt`): la **medición del intervalo** no se podía falsificar. **Medido** (sobre el árbol pre-fix, antes de tocar nada): `silentMs = this.now()` (RBM3.10) y `this.now() >= LINK_DWELL_MS` (RBM3.9) sobrevivían **136/136**. Los tests que miden un intervalo arrancan ahora en un instante real (`CLOCK_START`) y los dos mutantes 🔴 mueren. El `ms` del `connected_silent` se asierra con `JSON.parse`, no por substring (`"ms":60000` es substring de `"ms":1723000060000`) |
| `state.cancelDeviceCalls` | **SE BORRA** | Espejaba un método muerto y ningún test lo asertaba |
| `BleManagerLike.cancelDeviceConnection` | **SE BORRA** (mismo criterio que `sameUuid`) | Cero call sites de producción. Y no es prolijidad: cerrar el link **por id** es justo el bug que `canCloseOrphanLink` existe para evitar (un intento vencido le mata el link al que conectó después → "conectado" sobre un link muerto). Con la firma **fuera** del modelo, un call site nuevo **no compila** — la ausencia es un guard más fuerte que el contador que había. El comentario de `canCloseOrphanLink` quedó coherente (nombra la API de la lib y dice por qué no está modelada) |

## 12.4 ⚪-4 — el "cinturón" del tope se ganó su test

M-10 (borrar el chequeo del presupuesto **adentro del timer**): **136/136 sobrevivía**, porque el desenlace
observado (`off` + `autoconnect_exhausted`) se alcanzaba igual por la copia de la cabecera, **un intento
después**. El review daba la opción de solo reconciliar la prosa; elegí darle el oráculo, porque el costo
real de ese intento de más es medible (≈10 s de radio martillando por apertura de la app, con el bastón
ausente). Dos líneas en el test que ya existía: guardar `connectCalls.length` antes y exigir que **no crezca**.
Ahora 🔴 muere. Las dos copias quedan falsificadas (M-9 la cabecera, M-10 el timer).

## 12.5 Hallazgos PROPIOS de la autorrevisión (misma clase que el 🟠-1, en otros ejes)

Barrí la **ausencia**: enumeré los 4 usos de `params.*` y los 5 de `this.driver` del adapter (grep) para
confirmar que la superficie parametrizada quedaba entera, y después busqué la misma monocultura en los otros
ejes del fixture. Dos hallazgos, los dos medidos y cerrados:

| Hallazgo | Evidencia | Cierre |
|---|---|---|
| **El id del device es una monocultura**: el target pedido y el id del device del doble eran el MISMO (`DEV_ID`), y `state.written` se asertaba solo donde coincidían | `this.env.writeRemembered('11:22:33:44:55:66')` hardcodeado **sobrevivía 141/141** (la suite ya con los tests del 🟠-1/🟡-2/🟡-3 dentro). En producción: RBM2.16/R6.4 recordarían **siempre el mismo id** → la reconexión del arranque apuntaría a otro bastón | El perfil alternativo usa `ALT_DEV_ID` y el test parametrizado asierra `state.written === [id del perfil]`. Ahora 🔴 muere |
| **Los presupuestos del doble eran los cuatro `5`**, así que **cuál** presupuesto acota **cuál** await no se podía observar | envolver el `connectToDevice` con `ms('call')` en vez de `ms('connect')` **sobrevivía 141/141**; el del **diálogo** de permisos no lo medí como sobreviviente suelto sino por el **contrafáctico** de la fila de abajo | `FAST_TIMEOUTS` pasa a `call:5 / prompt:6 / connect:7 / scan:8` + los dos tests de vencimiento asertan el `ms` del `bridge_timeout` + un test de anti-vacuidad exige que sigan siendo distintos. Los dos mutantes 🔴 mueren. **Medido además el contrafáctico**: con la monocultura restaurada en el fixture (`prompt: 5`), el mutante del diálogo vuelve a ser invisible y el único rojo es el test de anti-vacuidad — que es exactamente su trabajo |

## 12.6 Tabla de mutantes del fix-loop (11 nuevos + 6 de regresión)

Metodología: un mutante por vez, las **5** suites juntas, revertir y verificar sha256. Baseline y
POST-RESTORE: **142/142**.

| # | Qué desactiva | Antes | Después | Muerto por |
|---|---|---|---|---|
| M-17 | filtro del escaneo hardcodeado (`:1088`) | 136/136 sobrevive | **141/142** | `…salen DEL DRIVER — servicio de 16 bits + \r` |
| M-18 | servicio+característica del monitor hardcodeados (`:970-971`) | 136/136 sobrevive | **141/142** | idem |
| M-19 | `new LineFramer()` (`:968`) | 136/136 sobrevive | **141/142** | idem |
| M-15 | el tap con intento en vuelo no destopa (`:651`) | 136/136 sobrevive | **141/142** | `un tap con el intento EN VUELO también DESTOPA…` |
| M-10 | tope de la cadena adentro del timer | 136/136 sobrevive | **141/142** | `RBM3.1: la cadena que NADIE pidió tiene tope…` |
| MCLK | la mudez se mide en ABSOLUTO (sin la resta) | 136/136 sobrevive | **141/142** | `RBM3.10: conectado y MUDO queda escrito…` |
| MDWL | el dwell se mide en ABSOLUTO | 136/136 sobrevive | **141/142** | `RBM3.9: un FLAP no resetea el backoff…` |
| MGATE | el `autoConnect` no gatea por el permiso consultado | **141/141 sobrevive** (con el test nuevo excluido) | **141/142** | `RBM3.8: CONSULTAR y PEDIR pueden dar resultados distintos…` |
| MWR | el bastón recordado se persiste con un id fijo | 141/141 sobrevive | **141/142** | `…salen DEL DRIVER — servicio de 16 bits + \r` |
| MBUD | el connect se acota con el presupuesto de una llamada | 141/141 sobrevive | **141/142** | `RBM3.2: el connect que NO RESUELVE NUNCA vence…` |
| MPRM | el diálogo de permisos se acota con el de una llamada | contrafáctico (ver 12.5) | **141/142** | `RBM3.2: el permiso que NO RESUELVE NUNCA vence…` |
| M-2 (reg.) | el latch NO se libera en el `finally` de `runConnect` | ya moría (review) | **127/142 (15 rojos)** | los mismos 15 que reportó el review |
| M-9 (reg.) | se borra el tope de la **cabecera** de `scheduleReconnect` | ya moría | **140/142** | el de BACKGROUND **+** el del tap en vuelo (nuevo) |
| M-12 (reg.) | el backoff se resetea sin exigir dwell | ya moría | **141/142** | `RBM3.9: un FLAP…` |
| M-13 (reg.) | la mudez deja de registrarse | ya moría | **141/142** | `RBM3.10…` |
| M-16 (reg.) | el camino automático **PIDE** el permiso | ya moría | **141/142** | `RBM3.8: el camino AUTOMÁTICO…` |
| MCHK (reg.) | el `autoConnect` pide en vez de consultar | ya moría | **140/142** | `RBM3.8: el camino AUTOMÁTICO…` **+** el nuevo de check/ensure |

Los 6 de regresión confirman que **ningún oráculo previo se debilitó** al tocar el fixture (era el riesgo real
de cambiar `FAST_TIMEOUTS` y el reloj de tres tests que ya existían).

## 12.7 Lo que NO toqué, y por qué

- **Las 10 lecciones del SPP y RBM2.7**: el review las verificó (15 de sus 20 mutantes murieron nombrando su
  test; el decodificado se midió con bytes reales). No se rehicieron.
- **⚪-5 (catch mudos del molde SPP), ⚪-6 (`permission_ios` vs `bluetooth_off`), ⚪-7 (`connect_error` por
  condición esperada en `isBleGattTransportAvailable`)**: el review las dejó como **recomendaciones al
  leader** (backlog / F4), no como cambios de F3. No las apliqué: la primera es deuda de los **dos**
  transportes y las otras dos cambian comportamiento observable, que no es lo que un fix-loop de oráculos
  debe decidir por su cuenta.
- **M-4 y M-20** (la generación que invalida `disconnect()`, y el `gen !==` de `:898`): siguen siendo
  cinturones tapados por otra copia. El review no pidió cambio; queda dicho acá y en la nota de RBM3.1 en vez
  de presentarse como oráculos.

## 12.8 Reconciliación de specs (as-built del fix-loop)

- `requirements-ios-ble-mfi.md`: nota nueva bajo **RBM2.4** que cubre RBM2.4/2.6/2.8 (por qué la mitad "del
  driver" no estaba falsificada y qué la falsifica ahora); nota nueva bajo **RBM2.6**; párrafo agregado a la
  nota de **RBM2.8**; **RBM3.1** gana la precisión de ⚪-4 (de las dos copias solo la cabecera estaba
  falsificada) **y** el destope por gesto; notas nuevas bajo **RBM3.8** (consultar vs pedir, por resultado) y
  **RBM3.11** (el reloj estaba inyectado pero no ejercitado). Ningún EARS reescrito.
- `design-ios-ble-mfi.md`: §2.1 declara los dos perfiles de driver del test; el recuadro as-built de §4 gana
  el punto **5** (`BleManagerLike` sin `cancelDeviceConnection`, con el motivo) y el ⚠️ pasa a ser el **6**.
- `tasks-ios-ble-mfi.md`: el encabezado de F3 declara el fix-loop y qué cerró cada punto; notas nuevas en
  **T3.6**, **T3.9** y **T3.12** (con los tres ejes de la monocultura y las decisiones del 🟡-3). El conteo de
  T3.12 pasa de 75 a **81**.
- Este informe: §4 (trazabilidad de RBM2.4/2.6/2.8 corregida — declaraba cobertura que no existía), §5
  (corrección del ⚪-4), §10 (números).

## 12.9 Verificación final del fix-loop

| Qué | Resultado |
|---|---|
| Las 5 suites de F3 juntas | **142/142** (baseline del fix-loop: 136) |
| `adapter-ble-gatt.test.ts` sola | **81/81** |
| Bloque **completo** de unit tests del cliente de `run-tests.mjs` | **3281/3281**, 0 fail (era 3275; +6 tests nuevos, ninguna suite vecina rota) |
| `tsc -p app/tsconfig.json --noEmit` (typecheck del repo) | **rc=0** |
| `tsc` a mano sobre los **5** test files (el proyecto excluye `*.test.ts`) | **rc=0** |
| 17 mutantes (11 del fix-loop + 6 de regresión) | **17 muertos, 0 sobrevivientes**; POST-RESTORE 142/142 |
| `scripts/run-tests.mjs` (archivo compartido con la otra terminal) | **no lo toqué** (`git diff --stat` = el mismo cambio de la sesión anterior); el bloque de rebrand sigue intacto (`grep -c backup-ci-consistency.test.mjs` → 2) |
| `git status --porcelain supabase/ sync-streams/` | **vacío** → Gate 1 sigue N/A y es atribuible |
| Gate 2.5 (ADR-029) | **N/A**: el fix-loop no toca ninguna superficie de UI (dos archivos de `services/ble/` + specs) |

**Los dos CHECKPOINTS que el review dejó en `[ ]` y este fix-loop cierra**:

- **C4** *"fixtures reales, no mocks de I/O crítico sin necesidad"* — el problema no eran los dobles de I/O
  (que estaban bien) sino el **fixture de datos del driver**, que era único. Ahora son dos juegos distintos,
  con anti-vacuidad.
- **C6** *"cada `R<n>` con ≥1 test concreto"* — RBM2.4 / RBM2.6 / RBM2.8 estaban **parciales** (la mitad "del
  driver" sin oráculo). Cerrados, con los tres mutantes cayendo.

Los que siguen en `[ ]` y **no** son de esta fase: **C1** (`check.mjs` verde de punta a punta) y la corrida de
Playwright contra baseline → cierre del delta (F8) / leader; **C5** (`history.md`) → cierre de sesión.

**No corrido, y por qué**: `node scripts/check.mjs` completo — sus stages de backend pegan contra la DB remota
**compartida** y hay otra terminal en el árbol (el patrón `Request rate limit reached` fabrica rojos que no son
regresiones), y un stage rojo impide que corran los posteriores. En su lugar corrí **el stage 1 completo**
(typecheck del cliente) y **el bloque entero de unit del cliente**, que es donde este cambio puede romper algo:
el fix-loop no toca ni un archivo de backend. `pnpm e2e` tampoco (queda del leader; el fix-loop no cambia el
bundle: son tests y una firma de interfaz borrada).

## 12.10 Nota de proceso (para que la evidencia se lea bien)

A mitad del fix-loop **perdí las ediciones del archivo de test** por una herramienta propia: mi script de
mutación guardaba el backup como `<archivo>.orig` en el scratchpad, que está **compartido con las sesiones
anteriores** (el `mut.py` del reviewer dejó backups con **ese mismo nombre**). El `apply` respetó un backup
ajeno y viejo, y el `revert` pisó mis ediciones con la versión pre-fix. Lo detecté porque el bloque completo
de unit tests seguía diciendo **3275** cuando tenía que decir 3281 (y mis tests no aparecían en la salida) —
o sea, lo cazó una verificación que no era la que lo buscaba.

Qué hice: rehacer las ediciones, cambiar el backup a un nombre propio (`fixloop-f3.<archivo>.orig`) y hacer
que el `apply` **aborte** si ya hay un backup pendiente en vez de reusarlo, guardar una copia de los dos
archivos fuera de ese espacio de nombres, y **re-correr toda la batería de mutantes desde cero** sobre el
árbol restaurado (§12.6 son esos números, no los de antes del incidente) + los dos typechecks + el bloque
completo. Todo lo que está en esta sección se midió **después** de la recuperación.
