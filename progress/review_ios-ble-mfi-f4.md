# review — delta `ios-ble-mfi` · **Fase F4**: selección, prioridad por plataforma y el driver del emulador

**Fecha**: 2026-08-17 · **Reviewer**: agente `reviewer` (read-only) · **Árbol revisado**: sin commitear sobre
`e0a32ad` (HEAD); 33 entradas en `git status` al abrir y al cerrar (no dejé nada tocado).
**Informe del implementer**: `progress/impl_ios-ble-mfi-f4.md`.
**Contrato**: `requirements-ios-ble-mfi.md` RBM4.4/4.5 + RBM5.1–RBM5.14 · `tasks-ios-ble-mfi.md` Fase F4 ·
`design-ios-ble-mfi.md` §6.

# VEREDICTO: **CHANGES_REQUESTED**

No hay tests rojos, `check.mjs` está verde de punta a punta y **toda la trazabilidad `RBM<n>` → test está
cubierta y falsificada**. Lo que bloquea son **tres desalineaciones entre lo que las specs afirman y lo que el
código as-built hace** (regla dura: reconciliación pendiente = CHANGES_REQUESTED), dos de ellas con
consecuencia de producción y no solo de prosa:

1. 🟠-1 — En iOS, F4 hace que `new BleManager()` (CoreBluetooth) se construya **en el arranque en frío**, y las
   specs + el comentario del adapter afirman lo contrario ("el arranque en frío no llega nunca a tocar la
   radio", "RBM3.8 se cumple también en iOS"). Es la puerta de un diálogo del SO no pedido.
2. 🟠-2 — En **Android** el transporte `ble-gatt` **sigue siendo inalcanzable en producción** después de F4,
   que es exactamente el problema que RBM5.6 dice haber resuelto. El escenario Android del banco de F6 no
   tiene con qué arrancar.
3. 🟡-2 — `tasks` **T5.3** quedó vieja: pide para F5 lo que F4 ya hizo.

Ninguna pide rehacer nada de lo construido: dos se cierran con una reconciliación honesta (y una decisión
chica de código en la 🟠-1), la tercera es una línea de tasks.

---

## 0. Cómo verifiqué (separando "lo leí" de "lo corrí y lo vi")

**Lo corrí y lo vi:**

- `node scripts/check.mjs` → **RC=0**, `"Entorno listo. Podés trabajar."`. Verifiqué que **ningún stage quedó
  cortado** (el script muere en el primer rojo): están los 22 pares `>>> / <<< OK` completos, de
  *typecheck client* a *Health EF suite (spec 16 Run C)*. **No hizo falta correr stages a mano.**
  - *client unit tests*: **3340 pass / 0 fail**.
- Las 12 suites de la unidad, sueltas: **312 pass / 0 fail** (`selection-priority`, `driver-registry`,
  `wiring`, `ea-protocols`, `remembered-format`, `connection-view`, `adapter-ble-gatt`, `ble-gatt-protocol`,
  `frame-parser-resolve`, `adapter-ingest-mode`, `spp-bridge-timeout-guard`, `permissions-android`).
- `tsc --noEmit` (app) → rc=0. Con `--noUnusedLocals --noUnusedParameters` (no está en el tsconfig del repo):
  **cero hallazgos en los 16 archivos de F4** — los dos únicos hits (`adapter-ble-gatt.ts:352`,
  `adapter-spp-android.ts:280`, un param `ms` sin usar) son preexistentes y ajenos a esta fase.
- **8 mutantes propios**, cada uno revertido y verificado por hash contra **mi** backup
  (`scratchpad/reviewer-f4-backup-9dfa/`, nombre único de este reviewer). Integridad final: **12/12 archivos
  idénticos al backup**.
- Comparación **ejecutada** de `selectTransportAdapter` viejo (`a9d81ff`) vs nuevo sobre **216
  combinaciones** — no contra el informe (§6).
- Los 4 shots del Gate 2.5 existen y los miré (`03`, `04`).

**Lo leí y tracé (no ejecutado, y está dicho donde importa):** el camino
`useMemo → instantiateTransport('ble-gatt') → isBleGattTransportAvailable() → loadBleManager() → new BleManager()`
(🟠-1); la ausencia de un bootstrap de la preferencia en Android (🟠-2); qué hace iOS al instanciar un
`CBCentralManager` (no tengo device ni build de iOS — es justamente lo que pido declarar).

---

## 1. 🔑 ¿Se colapsó la diversidad de fixtures que F3 compró? **NO.** Medido.

Era la sospecha nº1 del encargo y la contesto con los tres mutantes de F3 corridos por mí, sobre este árbol
(con el `ESP32_GATT_DRIVER` ya registrado con los mismos UUID NUS):

| Mutante de F3 | Qué re-hardcodea | Resultado medido |
|---|---|---|
| `[params.serviceUuid]` → literal NUS en `startDeviceScan` (`:1098`) | el filtro del escaneo | ☠️ **81 tests, 1 fail** |
| `params.serviceUuid, params.notifyCharUuid` → los dos literales NUS (`:980-982`) | servicio + característica del monitor | ☠️ **81 tests, 1 fail** |
| `new LineFramer(params.delimiter)` → `new LineFramer()` (`:979`) | el fin de trama | ☠️ **81 tests, 1 fail** |

El mecanismo sigue intacto y lo verifiqué a mano: `DRIVER_PROFILES` tiene **2** perfiles (`TEST_DRIVER` con NUS
+ `\n`; `ALT_DRIVER` con servicio de 16 bits `FFE0`/`ffe1` + `\r`), el test *"ANTI-VACUIDAD de los perfiles"*
exige que difieran en los **tres** campos y que ninguno del alternativo colisione con los NUS, y el test
parametrizado corre el camino entero (escaneo → device reconocido → monitor → reensamblado → EID) **por
perfil**, con las dos direcciones del delimitador (el ajeno NO cierra, el propio SÍ).

**Y los tests que F4 agregó no tocan esos fixtures**: los que usan `ESP32_GATT_DRIVER` viven en
`selection-priority.test.ts` / `connection-view.test.ts`, donde los UUID **no participan de la decisión**.
Verifiqué además que ninguna aserción de `adapter-ble-gatt.test.ts` dependa del registro global de forma que
el driver nuevo la afloje: el único que lo mira es el guard *"si el registro llega a declarar DOS drivers
ble-gatt"* (`conGatt.length <= 1`), que sigue en 1.

## 2. RBM5.13 — el invariante de la balanza: **tiene dientes.** Mutantes propios.

Escribí **dos** (no reusé el del informe) y los dos caen:

| Mutante propio | Resultado medido |
|---|---|
| **MUT-R1**: `deviceMatch: { namePattern, advertisedServiceUuids: [NUS_SERVICE_UUID] }` | ☠️ **3 tests** — *el bridge de la balanza Vesta … NO se reconoce como bastón* · *el matcher NO declara advertisedServiceUuids* · *un device que anuncia NUS sin el nombre no se reconoce* |
| **MUT-R2** (más fuerte): `deviceMatch: { advertisedServiceUuids: [NUS_SERVICE_UUID] }` — match **solo** por UUID | ☠️ **4 tests** (los 3 de arriba + *el emulador se reconoce por su NOMBRE anunciado*) |

Lo que hace que el oráculo no sea teatro, leído en el test: el fixture de la colisión usa `NUS_SERVICE_UUID`
**importado del driver** (la colisión *es* "el mismo UUID", no una copia que puede desincronizarse), prueba la
forma en minúsculas (como la anunciaría el SO), y trae **control positivo** (el mismo device con el nombre del
emulador SÍ resuelve) para que un `findDriverForDevice` que devolviera `null` siempre no pase. `matchesDevice`
es un **OR** (`driver-registry.ts:38-49`), así que agregar los UUID basta para que `VESTA_BRIDGE` matchee: el
mutante ataca el mecanismo real, no una decoración.

## 3. Los 7 tests reescritos: **cada uno está autorizado.** Medido, no leído del informe.

| # | Test | Lo que MEDÍ | Veredicto |
|---|---|---|---|
| 1 | `RMV6.2/6.3: ble-gatt y mfi no tienen adapter buildable (null)` | el viejo afirmaba `adapterForTransport('ble-gatt','ios') === null` | **Obsoleto autorizado**: RBM5.2 exige el mapeo; **RBM7.1** declara literal que RMV6.2/6.3 dejan de ser "fuera del delta" |
| 2 | `RMV6.1/6.2: driver mfi-only en iOS → binding null` | ahora `{mfi-ios, mfi, false, 'build-sin-protocolos'}` | **Obsoleto autorizado** por RBM4.4 + RBM4.5 + RBM5.5 |
| 3 | `RMV2.3/2.4: RS420 en android` | diffeé el test contra `a9d81ff`: las **tres** aserciones originales (`adapterKind:'spp-android'`, `transportKind:'spp'`, `available`) están **textualmente intactas**; la única adición es `unavailableReason:'adapter-no-construido'` | **NO es regresión de RBM5.4**. Confirmado el informe |
| 4 | `RMV2.2/2.4: driver solo-HID en android` | ídem: `hid-wedge`/`ble-hid`/`false` idénticos + la clave nueva | ídem |
| 5 | `RMV2.2/2.4: driver HID genérico en iOS` | ídem. La sospecha del leader es correcta y quedó escrita en el test: un driver que declara SOLO `ble-hid` no puede resolver a otro transporte, así que RBM5.1 no lo mueve | ídem |
| 6 | `RMV2.7 regresión: EXACTAMENTE lo de antes` | **lo medí ejecutando las dos versiones** (§6). Único cambio: `ios/auto` `manual → ble-gatt`. `mock`/`manual`/`demo` **byte por byte iguales en las 6 plataformas y con las 9 preferencias** | **NO viola RBM5.9** (congela `auto` *"en Android y en web"*) y el design §6.2 autoriza el piso de iOS por escrito |
| 7 | `R7: en iOS (auto) sigue sin haber transporte alcanzable` (wiring) | el reemplazo asierra `ios/auto → 'ble-gatt'` **+** `macos → 'manual'` **+** `blocksManualEntry(s) === false` en los 5 estados | **Obsoleto autorizado** por RBM5.6; R7 no se pierde |

**Ningún test se aflojó.** El que más me preocupaba (el 6) quedó **más fuerte** que antes: el nuevo agrega
`android/manual`, `web/demo`, `macos/auto` y `otro/auto`, que el viejo no tenía.

## 4. El invariante "todo `available:false` trae motivo": **no pasa por vacuidad.** Medido.

- Recorre la matriz completa: **7 drivers × 4 plataformas × 3 juegos de `builtAdapters` × 2 listas de
  protocolos**, saltea los `null`, y tiene **anti-vacuidad explícita** (`vistosTrue > 0 && vistosFalse > 0`).
- Dos mutantes propios:

| Mutante propio | Resultado medido |
|---|---|
| **MUT-R3**: la rama `adapter-no-construido` devuelve `{...base, available:false}` (sin motivo) | ☠️ **6 tests**, incluido el invariante |
| **MUT-R4**: la rama de MFi pierde `unavailableReason: mfi.reason` | ☠️ **4 tests**, incluido el invariante |

La otra punta también está aserrada (*"TODO disponible NO lo trae"*), así que un `undefined` colándose como
"hay motivo" no pasa.

## 5. Los dos bugs que el implementer encontró solo

### (a) CTA "Olvidar el bastón guardado" escondido en `{isSpp ? …}` — **tiene oráculo de comportamiento.** ✅

No es solo un guard de fuente. `baston-ios-ble-mfi-f4.capture.ts` asierra **antes** de cada shot, y en web el
transporte es `web-serial` (`isSpp === false`): el camino que la E2E ejercita **es** el no-SPP.
- sin registro → `expect(getByTestId('stick-forget-cta')).toHaveCount(0)` (sin afordancia muerta);
- con el registro sembrado en el **formato nuevo** (`{deviceId, adapterKind:'web-serial'}`) + `reload` →
  `expect(forget).toBeVisible()`. Eso además ejercita `parseRememberedValue` de punta a punta en el navegador.

Miré los shots: el botón entra completo a 412 px y **no recorta descendentes** ("g"/"j" de *"Olvidar el bastón
guardado"*). El guard de fuente (`wiring.test.ts`) suma la mitad estructural: el CTA no está en **ninguna** de
las dos ramas del ternario **y** su condición es *exactamente* `hasRemembered` — eso cierra la variante
`{isSpp && hasRemembered ? …}`, que es cómo el bug volvería sin moverse de lugar.

### (b) `vendorId` persistido como id de device — **la clase está barrida.** ✅ (con un 🟡)

Barrí la **ausencia**, no las instancias. Escrituras de la clave `rafq.ble.remembered_device` en todo
`app/src` + `app/e2e` (grep de `writeRememberedDevice|serializeRememberedValue|rafq.ble.remembered_device`):

- `adapter-spp-android.ts:393` → `writeRememberedDevice(deviceId, {adapterKind:'spp-android'})`
- `adapter-ble-gatt.ts:394` → `writeRememberedDevice(deviceId, {adapterKind:'ble-gatt'})`
- (`remembered-device.ts` = el borde; `capture.ts` = el fixture de la E2E)

**No hay ninguna otra**, y ninguna escribe algo que no sea un id de device: verifiqué en el fuente que el
`target` que el adapter persiste es el device que **ya contestó** (`adapter-ble-gatt.ts:947-964`:
`this.device = device` → `writeRemembered(target)`), y del lado del comportamiento eso está aserrado en
`adapter-ble-gatt.test.ts:745` (`assert.deepEqual(state.written, [d.device.id])`, con el **segundo** perfil de
driver aportando otro id → una constante hardcodeada cae).
Los **lectores** también están sanos: los tres consumidores usan `?.deviceId` / `?.adapterKind` / `!= null`.
Ninguno trata el registro como un string.

> 🟡-3 (abajo): el guard quedó escrito sobre **los archivos de hoy** (la pantalla + los dos adapters) y no
> sobre el conjunto de escritores, que es lo que pedía la deuda ⚪-K; y `docs/backlog.md` sigue con esa deuda
> abierta.

## 6. RBM5.9 en serio: **comparado contra `a9d81ff`, no contra el informe**

Ejecuté las dos versiones de `selectTransportAdapter` (la de `a9d81ff` extraída a un módulo aparte) sobre
**216 combinaciones**: 6 plataformas × 4 modos × {sin preferencia + los 8 `AdapterKind`}.

```
combinaciones: 216 | diffs: 10
  ios/auto  · pref=(undefined|manual|mock|web-serial|spp-android|ble-gatt|hid-wedge|simulator): manual -> ble-gatt
  ios/auto  · pref=mfi-ios:                                                                    manual -> mfi-ios
  android/auto · pref=ble-gatt:                                                                spp-android -> ble-gatt
SIN preferencia -> diffs: 1
  ios/auto: manual -> ble-gatt
```

- **`mock`, `manual` y `demo`: cero diferencias**, en todas las plataformas y con **cualquier** preferencia. Es
  lo que RBM5.9 congela y lo que protege a las ~70 specs E2E. ✅
- `auto` en **Android** y en **web** sin preferencia: sin cambios. ✅
- Los dos cambios son los dos autorizados: el piso de iOS (RBM5.6 + design §6.2) y la preferencia del bastón
  recordado (RBM5.6). ✅
- El renglón `ios/auto · pref=mfi-ios → mfi-ios` es el que abre 🟡-1.

## 7. RBM5.11 — ningún lector comercial adivinado. ✅

`DRIVER_REGISTRY` = `[RS420_DRIVER, ESP32_GATT_DRIVER]`, **medido en runtime**. El guard está escrito **sobre
la ausencia** (`deepEqual(DRIVER_REGISTRY.map(vendorId), ['allflex-rs420','esp32-gatt-emu'])`), así que un
Gallagher HR5 v3 con parámetros "razonables" **nace en rojo**. El `ALT_DRIVER` de los fixtures es sintético y
vive solo en el test. `RS420_DRIVER` sigue sin declarar `mfi` (RBM4.6), con test de anti-vacuidad propio.

## 8. Piezas a medio cablear (dos agentes murieron acá). **No encontré ninguna.**

- **Imports muertos**: cero en los 16 archivos de F4 (medido con `--noUnusedLocals --noUnusedParameters`,
  filtrado a esos archivos). El import que el diff sacó (`writeRememberedDevice` de la pantalla) se sacó bien;
  `BluetoothSearching` ya estaba importado (línea 23) y ahora tiene consumidor real (`INSTRUCTION_ICONS`).
- **Exports sin consumidor**: ninguno huérfano. `isAdapterUsableOn` ← `adapter-selection`; `TRANSPORT_KINDS` ←
  `isAdapterUsableOn`; `eaProtocolsFromExpoConfig`/`eaProtocolsFrom` ← `declaredEaProtocols` + tests;
  `NUS_*`/`ESP32_GATT_ADVERTISED_NAME`/`EA_PROTOCOLS_INFO_PLIST_KEY`/`TRANSPORT_INSTRUCTION_KEYS` ← tests +
  anclas de exhaustividad por typecheck (que es su razón de existir, declarada).
- **Ramas inalcanzables**: las **8** claves de `TransportInstructionKey` tienen caso de test y **cuerpo
  distinto** (con anti-vacuidad de cuerpos duplicados); `instantiateTransport('mfi-ios') → null` está declarado
  como el estado honesto de F4; la rama de copy `'mfi'` disponible es inalcanzable en producción (RBM4.6) y el
  propio código lo dice.
- **El re-montaje**: `useMemo(() => instantiateTransport(resolvedKind), [resolvedKind])` depende del **kind** y
  no de la preferencia cruda (con guard que fija el `useMemo` literal), y el efecto de wiring tiene
  `transport?.disconnect()` en su cleanup. Coherente con el riesgo del design §13.
- `stick-adapter.ts`: el diff es **solo** el union de `kind` (aditivo) + comentarios → **RBM9.6 cumplido**,
  verificado línea por línea. Cero archivos de `app/src/features/animals/*`.
- `git status --porcelain supabase/ sync-streams/` → **vacío** → **Gate 1 N/A verificado** (RBM9.1/9.2).
  `git status design/` → vacío (sin churn de PNG). `package.json`/lockfile sin cambios.

## 9. El copy y la card: verificado contra el as-built anterior

Diffeé las **5 cadenas** que el copy mudado dice conservar verbatim contra el JSX de `a9d81ff`: coinciden
**palabra por palabra**. Y el override de la card:

| Mutante propio | Resultado medido |
|---|---|
| **MUT-R5**: el override de `disconnected` también cambia `tone` | ☠️ **2 tests**, incluido *"RMV3.1 fila: el TONO nunca contradice a la card"* |

Eso demuestra que las **4 combinaciones con `transportKind`** que F4 agregó a `ROW_ENVS` no son decorativas:
son las únicas por las que ese invariante puede ver el override (el test itera `ROW_ENVS`; sin esas filas el
mutante sería invisible). El hallazgo 🟠-2 de la autorrevisión era correcto y el fix también.

---

# Hallazgos

## 🟠-1 — En iOS, F4 construye `CBCentralManager` en el ARRANQUE EN FRÍO, y las specs afirman que no

**Dónde**: `app/src/services/ble/BleStickListenerProvider.tsx:222-223` → `adapter-ble-gatt.ts:309-318`
(`isBleGattTransportAvailable`) → `adapter-ble-gatt.ts:248-279` (`loadBleManager`, **`:273
cachedManager = new mod.BleManager()`**).

**El camino, trazado** (leído, no ejecutado — en node no hay RN):

1. El provider está montado en el **root layout** (`app/app/_layout.tsx:729`), `mode='auto'` en un build real.
2. Primer render: `selectTransportAdapter({platformOS:'ios', mode:'auto', preferredAdapter: undefined})` →
   **`'ble-gatt'`** (medido en §6: es el cambio que F4 introdujo).
3. `instantiateTransport('ble-gatt')` → `isBleGattTransportAvailable()`.
4. Condición (b) del guard (`bleGattDriverFrom(DRIVER_REGISTRY) != null`) → **la medí en runtime**:
   `esp32-gatt-emu`, **TRUE**. Al cerrar F3 era `false` (lo dice la propia nota de reconciliación de RBM2.3),
   así que `loadBleManager()` **no se alcanzaba**. F4 la da vuelta.
5. `loadBleManager()` → `NativeModules.BlePlx != null` (cierto en el build de iOS con la dep de F2) →
   `new BleManager()` → la lib crea su client → **se instancia un `CBCentralManager`**.

**Por qué importa**: en iOS el diálogo de permiso de Bluetooth **no lo pide una API** — lo muestra el SO cuando
la app usa CoreBluetooth por primera vez, e instanciar el central manager es la forma habitual de disparar ese
prompt. O sea: **un iPhone recién instalado, de un operario que nunca vio un bastón, puede recibir el diálogo
de Bluetooth al abrir la app**, sin haber tocado nada. Eso es lo que **RBM3.8** prohíbe ("no deberá mostrar un
diálogo del SO … desde un camino automático").

**Y la spec dice lo contrario, en dos lugares** — esto es lo que bloquea, no la incógnita de iOS:

- `adapter-ble-gatt.ts:572-578`: *"POR QUÉ ESTO CUMPLE RBM3.8 TAMBIÉN EN iOS … el gate 1 exige un bastón
  RECORDADO … **El arranque en frío no llega nunca a tocar la radio**"*.
- `tasks-ios-ble-mfi.md:223`: *"un arranque en frío **no consulta permisos ni toca la radio**. Eso es lo que
  hace que RBM3.8 se cumpla también en iOS"*.

Las dos son ciertas **de `autoConnect()`** (verifiqué el orden de gates: `busy → foreground → readRemembered →
skip('no_remembered')` corta antes del `loadManager()`, `adapter-ble-gatt.ts:594-613` — bien hecho) pero
**falsas del sistema**, porque el manager se construye **una capa antes**, en el instanciado, fuera de todo
gate. Y la analogía que RBM2.3 y el design usan (*"mismo guard que `isSppNativeAvailable`"*) no aplica:
`isSppNativeAvailable()` **solo consulta** `NativeModules` (`adapter-spp-android.ts:202-211`), no construye
nada.

**Qué pido** (una de las dos, no las dos):

- **(a) preferida, y es chica**: que `isBleGattTransportAvailable()` **no construya** el manager — que consulte
  la presencia del módulo (`NativeModules.BlePlx != null`, exactamente como el SPP) y deje la construcción para
  el primer uso real (el `autoConnect` **después** de su gate de bastón recordado, o el gesto del operario). El
  `cachedManager` ya existe: es mover el `new` de lugar. Con eso la afirmación de las specs pasa a ser cierta y
  RBM3.8 queda sostenida por construcción también en iOS.
- **(b)**: si se decide dejarlo así, **corregir las dos afirmaciones** (comentario + T2.x), agregar la fila a
  los **riesgos declarados del design §13** y sumarlo como **escenario explícito de F6/T6.4 en iOS** ("abrir la
  app en una instalación limpia, sin bastón recordado: ¿aparece el diálogo de Bluetooth?"). Lo que no puede
  quedar es la spec asegurando que no pasa cuando nadie lo midió.

## 🟠-2 — En Android, `ble-gatt` sigue INALCANZABLE en producción: RBM5.6 no consigue lo que dice conseguir

**El texto que queda sin cumplir** (`requirements-ios-ble-mfi.md`, nota "Por qué entra" de **RBM5.6**): *"sin
esto, en Android `selectTransportAdapter` monta siempre `spp-android`, así que un lector **BLE** … sería
**inalcanzable en producción justo en la plataforma donde está el productor argentino**, y el banco de RBM6 en
Android no podría correr el camino real"*. Y `design §6.2` **"El problema real"**, igual.

**Lo que medí y tracé**: el bucle está cerrado y no tiene entrada.

- Para que Android monte `ble-gatt` hace falta `preferredAdapter === 'ble-gatt'` (medido en §6: `android/auto`
  con cualquier otra preferencia, o sin ninguna, → `spp-android`).
- `preferredAdapter` sale **solo** de `readRememberedDevice().adapterKind`
  (`BleStickListenerProvider.tsx:206-217`).
- `adapterKind:'ble-gatt'` lo escribe **un solo lugar en todo el repo** (barrido del §5b):
  `defaultBleEnv().writeRemembered` — o sea **el propio `BleGattAdapter`**, que solo existe si ya se montó
  `ble-gatt`.
- Y la pantalla **ya no persiste nada** (el fix correcto de 🟡 (b)), así que no hay otro escritor. El
  `onChooseDevice` conecta con **el transporte montado**, y `activeDriver = transport?.driver` → en Android eso
  es el RS420 por SPP: no hay fila BLE que tocar.

O sea: **en Android, la única forma de que la preferencia diga `ble-gatt` es haber conectado por `ble-gatt`
antes.** Huevo y gallina. Consecuencias concretas:

1. La justificación de RBM5.6 quedó **falsa por omisión**: el requisito literal se cumple (la preferencia se
   honra cuando existe), su propósito declarado no.
2. **F6/T6.2 (banco en Android) no tiene con qué arrancar.** El escenario que el informe §10 declara
   ("conectar por BLE, cerrar la app, reabrirla y ver que monta `ble-gatt`") no se puede iniciar: el primer
   "conectar por BLE" en Android no existe. Y `SecureStore` en Android no se siembra desde afuera como el
   `localStorage` de la captura web.

**Qué pido**: elegir y dejarlo escrito, no que se descubra en F6.

- **(a)** Declarar la limitación en RBM5.6 y en el design §6.2 (*"en Android el transporte BLE queda alcanzable
  solo cuando exista una superficie para elegirlo; hoy la preferencia solo se auto-escribe"*) **y** agregarle a
  **`tasks` F6/T6.2** el paso que destraba el banco (afordancia dev-only, `__DEV__` toggle, lo que decida el
  leader).
- **(b)** O cablear el bootstrap. **No lo pido en esta fase**: es scope nuevo (la pantalla muestra el driver del
  transporte **montado**, así que ofrecer el binding BLE sin montarlo es otra decisión de diseño). Lo que no
  acepto es que la spec siga afirmando que el problema está resuelto.

## 🟡-1 — `honorsPreference` valida "usable en la plataforma" y "no gateado", pero **no** "construido"

`adapter-selection.ts:100-104`. Medido en §6: `selectTransportAdapter({platformOS:'ios', mode:'auto',
preferredAdapter:'mfi-ios'})` → **`'mfi-ios'`** → `instantiateTransport('mfi-ios')` → `null` → **el iPhone se
queda sin transporte** (perdiendo el `ble-gatt` que le correspondía por piso), en silencio.

No es alcanzable hoy (nadie escribe ese `adapterKind`), pero **es literalmente el escenario con el que se
justificó gatear `hid-wedge`**: *"un downgrade después de que F7 exista"*. F5 **va a** escribir
`adapterKind:'mfi-ios'`, así que el tratamiento asimétrico es una deuda con fecha. Atenúa la severidad que la
salida existe y quedó bien puesta: el CTA "Olvidar el bastón guardado" ahora se renderiza con cualquier
transporte (el fix de 🟡 (a)), así que el operario puede salir del pozo.

**Qué pido**: una línea. O `'mfi-ios'` entra a `NOT_SELECTABLE_AS_PREFERENCE` hasta que F5 lo construya (y sale
en el mismo diff que lo construye, el patrón que ya usa el guard de `BUILT_ADAPTERS`), o el comentario explica
por qué `hid-wedge` sí y `mfi-ios` no.

## 🟡-2 — `tasks-ios-ble-mfi.md` **T5.3** quedó vieja: pide para F5 lo que F4 ya hizo

`tasks-ios-ble-mfi.md:275` sigue en `[ ]` diciendo: *"`adapter-selection.ts` / `permissions.ts`: `'mfi-ios'` en
`AdapterKind`, `ADAPTER_KINDS`, `ADAPTER_INGEST_MODE` (`raw-line`) y `permissionModelFor`
(`{kind:'ios-mfi'}`)"*. **Las cuatro están hechas en F4** (verificado en el diff), y el código lo declara
explícitamente (*"`'mfi-ios'` entra en **F4** y no en F5 (donde el task lo ponía, T5.3)"*). El diff de tasks
solo tocó T4.1–T4.9 y T8.7: las 10 líneas removidas son todas `[ ] T4.x → [x] T4.x`.

Es la clase de spec vieja que la regla de reconciliación prohíbe: el implementer de F5 lee T5.3 y o la re-hace
o pierde tiempo entendiendo por qué ya está.

**Qué pido**: reconciliar T5.3 con una nota `(hecho en F4, con su motivo de compilación)`, dejando en F5 solo lo
que falta (el adapter + `BUILT_ADAPTERS` + actualizar el guard de su ausencia + registrar
`adapter-mfi-ios.test.ts`).

## 🟡-3 — El guard del `vendorId` está escrito sobre los archivos de hoy, y la deuda del backlog sigue abierta

`docs/backlog.md:1688` (⚪-K, ítem 2) pedía dos cosas: sacar la escritura **y** *"un guard de fuente que enumere
**todas** las escrituras de la clave"*. Lo primero está hecho y bien. Lo segundo quedó a mitad: el guard mira
que **la pantalla** no escriba y que **los dos adapters** escriban con su `adapterKind`. Un **tercer** archivo
que llamara `writeRememberedDevice(algoQueNoEsUnDeviceId)` pasaría en verde.

Barrí la ausencia yo (§5b) y hoy no hay tercero, así que no es un bug vivo — es el guard escrito sobre las
instancias en vez de sobre el invariante, que es la crítica que este repo ya se hizo cuatro veces. Y
`docs/backlog.md` no se actualizó: la deuda figura abierta cuando su mitad principal se cerró en esta fase.

**Qué pido**: (a) que el guard enumere los **módulos habilitados** a escribir la clave (lista cerrada; un
importador nuevo nace en rojo) o quede dicho por qué no; (b) cerrar/actualizar el ítem 2 de esa entrada.

## 🟡-4 — En un iPhone la única fila de "Dispositivos" es el banco de pruebas, y **Raf no la puede ver** en este Gate 2.5

No es un defecto: es la consecuencia **declarada** de RBM5.12 + la pantalla mostrando el driver del transporte
montado, está reconciliada en la nota de RBM5.12 y **fijada por un test** (`connection-view.test.ts`: *"la fila
del bastón BLE dice 'banco de pruebas'"*, con `actionable:true`). La traigo igual porque es una superficie que
un cliente final ve y **la evidencia visual no existe todavía**: el capture de F4 es web (donde el binding es
`serial` y esta fila no aparece) y la de device es **F6/T6.6**. O sea que el Gate 2.5 de esta fase le pide a Raf
ratificar una pantalla que no puede mirar.

Con el detalle completo, para que la decisión sea informada: en iOS, un operario sin ningún bastón ve la card
ofreciendo *"Conectar bastón"*, la fila *"Emulador ESP32 (banco de pruebas) — Reconocido. Tocá para
conectar."*, y al tocar un escaneo que busca `EMU-GATT-STICK` y termina en *"Buscar de nuevo"*.
**Sugerencia (no bloqueante)**: declarar el veto visual de F4 como **parcial** y atar la ratificación de esta
fila a T6.6.

## ⚪-1 — Divergencias declaradas, verificadas como declaradas (sin acción)

- **La fila corta de "Más" no conoce el transporte** → con GATT la card dice *"Buscando el bastón…"* y la fila
  *"Reintentando…"*. Verificado en el fuente: los dos call sites de `connectionRowStatus`
  (`StickStatusIndicator.tsx:188`, `mas.tsx:280`) no pasan `transportKind`. Declarado en la nota de RBM5.14, y
  lo que el repo exige que no se contradiga (el **tono**) está aserrado con el `transportKind` en la matriz (lo
  falsifiqué: MUT-R5).
- **`'mfi-ios'` fuera de `BUILT_ADAPTERS`**: desviación deliberada de T4.8, declarada, con el guard escrito
  **sobre la ausencia** y fijando el conjunto completo
  (`['ble-gatt','manual','mock','simulator','spp-android','web-serial']`), así que F5 no lo puede agregar sin
  actualizar el guard en el mismo diff. Bien resuelto.
- El informe dice *"8 líneas"* del diff de `run-tests.mjs`; `--stat` dice 10. Ruido.

---

## Tasks completas: **sí (F4)**

Todas las de la fase en `[x]`: **T4.1–T4.9**. La única desviación (T4.8, `'mfi-ios'` fuera de
`BUILT_ADAPTERS`) está **declarada con su motivo** y con guard sobre la ausencia, y la comparto. T8.7 quedó
marcado como parcial (4 de 6) con su nota. Fuera de F4: 🟡-2 (T5.3 sin reconciliar) es lo que corresponde
arreglar.

## Trazabilidad `RBM<n>` ↔ test (completa; cada fila verificada por mí)

| Requisito | Test que lo verifica | Falsificado |
|---|---|---|
| RBM4.4 | `ea-protocols`: *build CON la cadena del driver → available* · `selection-priority`: *driver mfi-only en iOS → binding mfi-ios* | MUT-R4 ☠️ |
| RBM4.5 | `ea-protocols` (3 motivos distintos, comparación exacta) · `selection-priority`: *TODO binding no disponible trae su motivo* · `connection-view`: *el copy de MFi dice que falta la autorización DEL FABRICANTE* | MUT-R3/R4 ☠️ |
| RBM4.6 | `selection-priority`: *el RS420 REAL sigue sin declarar mfi* · `ea-protocols`: *la config real da `[]`* | anti-vacuidad del propio test |
| RBM4.7 | `ea-protocols`: *de punta a punta: la cadena puesta en la config REAL la levanta el camino de producción* + los dos guards de la RUTA | informe: M20/M21 |
| RBM4.9 | `wiring`: *`mfi-ios` tiene su PROPIO modelo de permiso* · `adapter-ingest-mode` (recorre `ADAPTER_KINDS`) | typecheck (tablas exhaustivas) |
| RBM5.1 | `selection-priority`: *la prioridad de iOS pasa a MFi > GATT > HID* | informe: M13 |
| RBM5.2 / 5.3 | *ble-gatt mapea en iOS Y Android, mfi SOLO en iOS, spp SOLO en Android* · *`isAdapterUsableOn` se DERIVA del mapeo* | informe: M3/M4 |
| RBM5.4 | *la prioridad de Android y de web NO cambia* · *RS420 en android → {spp-android, spp}* · **+ mi comparación ejecutada contra `a9d81ff`** | §6 |
| RBM5.5 | *el `available` de mfi-ios es una CONJUNCIÓN* (4 casos, incluido el ORDEN del chequeo) | MUT-R3 ☠️ |
| RBM5.6 | *la preferencia le gana al piso* · *fail-closed* · `wiring`: *el provider HIDRATA la preferencia* + *el adapter escribe su `adapterKind`* | ver 🟠-2 |
| RBM5.7 | `remembered-format` (13 tests: formato viejo, JSON no-objeto, `adapterKind` desconocido, saneado idéntico) | informe: M14 |
| RBM5.8 | *la tabla del §6.1 es DETERMINÍSTICA y no depende del orden de declaración* · *determinístico sobre TODA la matriz* | orden invertido en el fixture |
| RBM5.9 | *mock/manual/demo y auto en Android/web → EXACTAMENTE lo de antes* · *la preferencia NO puede cambiar mock/manual/demo* · **+ §6** | §6 (216 combos) |
| RBM5.10 | *RS420 en iOS → null* · *SPP-only en web → null* · `macos → 'manual'` · `wiring`: `blocksManualEntry` en los 5 estados | — |
| RBM5.11 | `driver-registry`: *el registro NO declara ningún lector comercial adivinado* · guard de los DOS drivers `ble-gatt` | medido en runtime (§7) |
| RBM5.12 | *el displayName DICE que es un banco de pruebas* · *declara ble-gatt con los UUID NUS de ADR-003* · *la fila del bastón BLE dice "banco de pruebas"* | informe: M2 |
| **RBM5.13** | `driver-registry`: *se reconoce por su NOMBRE* · *el bridge Vesta anuncia los MISMOS UUID NUS y NO se reconoce* (control positivo) · *el matcher NO declara advertisedServiceUuids* · *NUS sin el nombre no se reconoce* | **MUT-R1 ☠️3 · MUT-R2 ☠️4 (míos)** |
| RBM5.14 | `connection-view`: 8 claves con caso y cuerpo distinto · *REGRESIÓN: las cinco que ya existían* (verbatim vs `a9d81ff`) · *el copy de BLE GATT no promete un paso que el adapter NO tiene* · *el TONO nunca contradice a la card* | MUT-R5 ☠️2 |
| RBM9.1/9.2 | `git status --porcelain supabase/ sync-streams/` vacío | — |
| RBM9.4 | `offline-noread` verde; cero red nueva | — |
| RBM9.5 | el copy de las 3 ramas no disponibles ofrece la manual · *NINGÚN estado bloquea la carga manual* | — |
| RBM9.6 | diff de `stick-adapter.ts` = solo el union + comentarios; cero archivos de spec 09 | leído línea por línea |
| RBM9.7 | 4 shots en `__shots__/baston-ios-ble-mfi-f4/` (los miré) + el N/A declarado con motivo estructural | ver 🟡-4 |
| R6.6 | `wiring`: *el CTA de "olvidar" NO puede vivir adentro de una rama por transporte* + **la E2E del capture (comportamiento)** | informe: M19a/M19b |
| R8.7 | *una preferencia `hid-wedge` NUNCA se honra* (4 plataformas × 4 modos) | informe: M7 |

**Ningún `RBM<n>` del contrato de F4 quedó sin test.**

## CHECKPOINTS.md

- [x] `node scripts/check.mjs` verde — **RC=0, los 22 stages corridos** (verificado par por par; ninguno cortado).
- [x] Tests verdes — 312/312 en las 12 suites de la unidad; 3340/3340 en el stage de cliente.
- [x] Trazabilidad requisito ↔ test completa.
- [x] Guards falsificados con mutantes — **8 propios**, todos muertos, revert verificado por hash.
- [x] Suites nuevas registradas en `scripts/run-tests.mjs` (y el bloque de la otra terminal intacto).
- [x] Gate 1 (`supabase/`, `sync-streams/`) N/A verificado de forma atribuible.
- [x] Capturas del Gate 2.5 generadas, con aserción **antes** del shot.
- [x] Sin churn de `design/**/*.png`; `package.json` y lockfile sin cambios; nada commiteado.
- [ ] **Specs reconciliadas al as-built** — 🟠-1 (afirmación falsa sobre el arranque en frío), 🟠-2 (el propósito
      de RBM5.6 no se cumple y no está declarado), 🟡-2 (T5.3 vieja).
- [ ] **Veto visual completo** — la superficie de iOS (🟡-4) no tiene captura hasta F6/T6.6.
- [ ] `pnpm e2e` (~38 min) **no se corrió** en esta fase. El riesgo declarado es bajo y lo verifiqué: §6
      muestra `mock` sin una sola diferencia con cualquier preferencia, y las ~70 specs corren en `mock`.
      Queda para T8.10; no lo cuento como bloqueante de F4.

## Checklist RAFAQ-específico

- **A. Multi-tenancy / RLS** — **N/A**. F4 es selección de transporte (pura) + UI local: cero tablas, cero
  policies, cero `establishment_id` (RBM9.3). Verificado con `git status --porcelain supabase/` vacío.
- **B. Offline-first** — **aplica parcialmente y cumple**. Cero I/O de red nueva; las únicas entradas son
  `SecureStore`/`localStorage` (local, con el techo de `storage` que ya vivía en el borde) y
  `Constants.expoConfig` (manifiesto del build). `offline-noread.test.ts` verde. Sin sync bucket ni resolución
  de conflictos porque no hay dato de dominio.
- **C. BLE** — **aplica**.
  - [x] Desconexión repentina + timeout + UI clara: heredado de F3 (RBM3.2/3.4/3.5); F4 no lo toca.
  - [x] Modo manual de fallback en ≤1 tap: el `ManualAdapter` está montado siempre, `blocksManualEntry` es
        `false` en los 5 estados (aserrado) y las 3 ramas de copy "no disponible" apuntan a la carga a mano.
  - [x] Correlación TAG↔peso: N/A en esta fase (F4 no toca ingesta).
  - [x] Los logs BLE no bloquean el flujo: `logTransportEvent` es best-effort, con test propio.
  - [ ] 🟠 **La radio se toca sin gesto en iOS** (🟠-1). Es el único box de esta sección que no cierra.
- **D. UI de campo** — **aplica parcialmente** (`/baston` es pantalla de configuración, no manga).
  - [x] Una decisión por pantalla: "Dispositivos" quedó fila + instrucción + CTA sin pisarse (shot 04).
  - [x] Targets y fuente: el CTA reusa el `Button` `secondary`/`fullWidth` que la pantalla ya usaba — F4 no
        introduce un target nuevo más chico. Sin recorte de descendentes (verificado en la captura: "g" y "j"
        de *"Olvidar el bastón guardado"*).
  - [x] Estado de loading visible: `scanning → "Buscando el bastón…"` es el fix de copy de RBM5.14.
  - ⚪ El `lineHeight` del cuerpo de las cards de instrucción pasó a `$4` con `fontSize="$3"` (en la de HID era
        `$3`/`$3`): declarado, alineado con las otras dos cards de la pantalla, sin recorte medido. Para el ojo
        del leader, no un hallazgo.
- **E. Edge Functions** — **N/A**. F4 no toca `supabase/functions/`.

---

## Cambios requeridos (concretos, con archivo y línea)

1. **🟠-1** · `app/src/services/ble/adapter-ble-gatt.ts:309-318` + `:248-279` — sacar el `new BleManager()` del
   camino del **instanciado**: que `isBleGattTransportAvailable` consulte `NativeModules.BlePlx` como hace
   `isSppNativeAvailable`, y que la construcción quede para el primer uso real (después del gate de bastón
   recordado del `autoConnect`, o el gesto del operario). **O**, si se deja como está: corregir
   `adapter-ble-gatt.ts:572-578` y `tasks-ios-ble-mfi.md:223` (que hoy afirman que el arranque en frío no toca
   la radio), agregar la fila a los riesgos del `design §13` y sumar el escenario a **F6/T6.4** en iOS.
2. **🟠-2** · `requirements-ios-ble-mfi.md` (nota "Por qué entra" de RBM5.6) + `design-ios-ble-mfi.md §6.2` —
   declarar que en **Android** `ble-gatt` sigue sin superficie que lo elija, y agregarle a **`tasks` F6/T6.2** el
   paso que destraba el banco de Android. (Cablear el bootstrap es scope nuevo: no lo pido en esta fase.)
3. **🟡-1** · `app/src/services/ble/adapter-selection.ts:100-104` — o `'mfi-ios'` entra a
   `NOT_SELECTABLE_AS_PREFERENCE` hasta que F5 lo construya (saliendo en el mismo diff, como el guard de
   `BUILT_ADAPTERS`), o el comentario explica por qué `hid-wedge` sí y `mfi-ios` no.
4. **🟡-2** · `specs/active/04-bluetooth-baston/tasks-ios-ble-mfi.md:275` (T5.3) — reconciliar: el union,
   `ADAPTER_KINDS`, `ADAPTER_INGEST_MODE` y `permissionModelFor` **ya los hizo F4**; en F5 queda el adapter.
5. **🟡-3** · `app/src/services/ble/wiring.test.ts` (test *"MEDIUM-2 (delta ios-ble-mfi)"*) — que el guard
   enumere los **módulos habilitados** a llamar `writeRememberedDevice` (lista cerrada, un importador nuevo nace
   en rojo) en vez de tres archivos nombrados; y cerrar el ítem 2 de la entrada ⚪-K de `docs/backlog.md:1688`.
6. **🟡-4** · (para el leader, no para el implementer) declarar el veto visual de F4 como **parcial** y atar la
   ratificación de la fila *"Emulador ESP32 (banco de pruebas)"* en iOS a la captura de **F6/T6.6**.

## Lo que quiero dejar dicho a favor de esta fase

El trabajo es **muy bueno**, y resistió la prueba que el encargo puso en el centro: la diversidad de fixtures
que F3 compró **no se colapsó**, los tres mutantes de F3 siguen cayendo con el `ESP32_GATT_DRIVER` registrado
con los mismos UUID NUS, y RBM5.13 aguantó dos mutantes que escribí yo (uno más fuerte que el del informe). Los
siete rojos del agente caído están **cada uno autorizado por escrito**; verifiqué la aritmética del más
peligroso (RMV2.7) ejecutando las dos versiones sobre 216 combinaciones, y los dos bugs que el implementer
encontró solo son hallazgos reales, bien diagnosticados y —el del CTA— con oráculo de comportamiento y no solo
de fuente. **Nada de lo que pido arriba invalida lo construido**: son tres reconciliaciones y dos líneas de
código.

## Apéndice — los 8 mutantes propios (todos revertidos y verificados por hash)

| # | Mutante | Qué invariante vigila | Resultado |
|---|---|---|---|
| MUT-F3-A | `startDeviceScan([literal NUS])` | RBM2.4 (el filtro sale del driver) | ☠️ 1 |
| MUT-F3-B | `monitorCharacteristicForService(literal, literal)` | RBM2.6 | ☠️ 1 |
| MUT-F3-C | `new LineFramer()` (default) | RBM2.8 | ☠️ 1 |
| MUT-R1 | `deviceMatch` += `advertisedServiceUuids:[NUS]` | **RBM5.13** (la balanza Vesta) | ☠️ 3 |
| MUT-R2 | `deviceMatch` **solo** `advertisedServiceUuids:[NUS]` | **RBM5.13** (más fuerte) | ☠️ 4 |
| MUT-R3 | `adapter-no-construido` sin `unavailableReason` | RBM4.5 / el invariante de forma | ☠️ 6 |
| MUT-R4 | la rama de MFi pierde su `reason` | RBM4.5 / RBM5.5 | ☠️ 4 |
| MUT-R5 | el override de GATT cambia el `tone` | RBM5.14 / el invariante fila-vs-card | ☠️ 2 |

Backup propio: `scratchpad/reviewer-f4-backup-9dfa/` (12 archivos). Integridad final verificada: **12/12
idénticos**, y `git status` con las mismas 33 entradas que al abrir el review.
