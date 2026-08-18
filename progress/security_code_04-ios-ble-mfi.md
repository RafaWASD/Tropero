# Gate 2 (security_analyzer, modo `code`) — delta `ios-ble-mfi` (feature 04)

**Fecha**: 2026-08-17 · **Obligatorio por**: RBM9.2 · **Baseline**: `fbfa476` (padre de `3272227`)
**Changeset auditado**: `3272227`, `a9d81ff`, `54b72f8`, `7f4a0bf` (+ `b0eda3f`, `1fe4ba3` chore/docs)

## Veredicto: **FAIL**

Un finding HIGH. No es del camino del EID ni del multi-tenant (esos están limpios y verificados uno por
uno): es la **frontera de confianza BLE**, que este delta abre por primera vez sobre la radio nativa.

| # | Severidad | Qué | Dónde |
|---|---|---|---|
| 1 | **HIGH** | El reensamblador de trama del transporte BLE no tiene tope de buffer, y la defensa de liveness que debería cubrirlo la **resetea el propio flujo** | `line-framer.ts:42-52` + `adapter-ble-gatt.ts:1045,1071-1073` |
| 2 | MEDIUM | Identificadores de dispositivo (MAC en Android) salen a breadcrumbs de Sentry sin redactar — el scrubber es key-based y no tiene la clave | `adapter-ble-gatt.ts:1184-1187`, `:783`, `adapter-mfi-ios.ts:673` |

---

## HIGH-1 — `LineFramer` sin tope, estrenado sobre la radio en este delta

### Qué

`LineFramer.push()` acumula sin cota y solo recorta cuando aparece el delimitador:

```ts
// app/src/services/ble/line-framer.ts:42-52
push(chunk: string): string[] {
  this.buffer += chunk;                                  // ← sin tope
  const lines: string[] = [];
  let idx: number;
  while ((idx = this.buffer.indexOf(this.delimiter)) !== -1) {
```

y el transporte BLE nuevo lo alimenta con cada notificación GATT:

```ts
// app/src/services/ble/adapter-ble-gatt.ts:1045
const framer = new LineFramer(params.delimiter);
// :1071-1073
this.lastDataAt = this.now();
for (const line of framer.push(text)) {
  if (this.listening) this.emitTag(line);
}
```

### Por qué es de ESTE delta y no deuda heredada

Verificado contra el baseline: pre-delta `LineFramer` tenía **un solo call site de producción**,
`adapter-web-serial.ts:47` — web, escritorio, y detrás del gesto obligatorio de `requestPort()` de la Web
Serial API. `adapter-ble-gatt.ts:1045` es el **primer call site nativo, sobre radio, y que auto-conecta sin
gesto** (`autoConnect` del provider, RBM2.16). El delta no creó el buffer sin tope; le abrió la puerta por
la que entra un peer no confiable.

`adapter-mfi-ios` **no** está afectado: usa `splitSppPayload` (`spp-protocol.ts:107`), que es sin estado.

### Por qué las defensas existentes no lo tapan — las miré una por una

- **`connected_silent` / watchdog** (`:1295-1305`): compara contra `this.lastDataAt`, y `:1071` refresca
  `lastDataAt` **en cada chunk**. Un flujo que no cierra trama mantiene el watchdog en verde permanente:
  no es que no actúe (ya sabíamos que solo loguea), es que **ni siquiera loguea**.
- **`verifyLiveness`** (`:1304`): pregunta `isDeviceConnected`. El peer que inunda está genuinamente
  conectado → pasa.
- **`isValidTag` / dedup / confirmación**: corren *después* del framer. A una línea que nunca se corta no
  llegan nunca.
- **Tests**: no existe `line-framer.test.ts` en el repo. El invariante no está vigilado por nada.

### Los dos disparadores, y el que NO es un atacante es el más probable

1. **No adversarial (el más probable).** Un lector configurado con un terminador distinto del `delimiter`
   de su driver. Es exactamente el `term cr` / BENCH-2 que ya se pagó en el SPP, con el agravante que el
   propio encabezado del archivo declara: en BLE **no hay framing nativo, el framer de JS es el único que
   corta**. `line-framer.ts:11-18` nombra la consecuencia al pie de la letra — *"dejaría la app conectada y
   muda, con el buffer creciendo para siempre"*— y después parametriza el delimitador, que resuelve la mitad
   diagnóstica y deja la mitad de robustez abierta.
2. **Adversarial.** El `deviceMatch` es `{ namePattern: /EMU-GATT-STICK/i }` (`driver-esp32-gatt.ts:83`).
   El nombre anunciado en BLE lo elige el periférico, no hay pairing ni bonding ni cifrado en el camino
   (NUS abierto, ADR-003). Cualquiera con un ESP32 a 10 m se hace reconocer y emite bytes sin delimitador.

### Impacto

El daño llega **antes por CPU que por memoria**: `indexOf` recorre el buffer **entero en cada
notificación** → costo cuadrático. Con el buffer en decenas de MB, cada notificación barre decenas de MB
en el hilo de JS y la app se vuelve inusable; después, OOM.

Y eso rompe un invariante declarado de la unidad: **manual-first es ley** (R7.2 / R9.6 / **RBM9.5**).
Todos los demás modos de falla de este delta degradan a un estado con la carga manual intacta —
`permission_denied`, `disconnected`, `parser_unresolved`, `mfi_unavailable`—. Este se lleva el proceso, y
con él la carga manual, en la manga y sin señal.

### Fix recomendado

Tope en `LineFramer.push()`: si `this.buffer.length` supera un múltiplo chico de la trama legítima más
larga, descartar el buffer y `logTransportEvent` con un kind propio. Misma forma que RBM1.4 —
**fail-closed con log, no silencio** — que es el patrón que el resto de la unidad ya aplica bien. Cubrirlo
con el `line-framer.test.ts` que hoy no existe, falsificándolo con el mutante obvio (sacar el tope).

---

## MEDIUM-2 — Identificadores de dispositivo a Sentry sin redactar

### Cadena completa (verificada extremo a extremo)

```ts
// app/src/services/ble/adapter-ble-gatt.ts:1184-1187   ← NUEVO en este delta
logTransportEvent({ kind: 'connect_error', message: `ble_device_not_recognized: ${device.id}` });
```

`logging.ts:147` → `sentry.native.ts:84-86` `addBleBreadcrumb` → `payloads.ts:82`
`buildBleBreadcrumb`, que hace `data: { ...event }` **verbatim, sin filtrar** → `beforeBreadcrumb` =
`redactBreadcrumb` (`redact.ts:168`).

El scrubber no lo alcanza, y no por descuido de diseño sino por su forma: es **key-based**. `deviceid` no
está en `PII_KEYS_RAW` (`redact.ts:24-48`), no contiene ninguna raíz de `SECRET_ROOTS_RAW`, y los tres
patrones de `scrubString` (JWT / `Bearer` / `token=`) no matchean una MAC. Además acá el id va **embebido
en el free-text de `message`**, donde ninguna defensa key-based puede llegar aunque se agregara la clave.

`device.id` de `react-native-ble-plx` es la **MAC en Android**, un UUID por-app en iOS; en MFi es el serial
del accesorio.

### Qué es nuevo y qué no — la distinción importa para priorizar

- **Clase nueva**: `ble_device_not_recognized` loguea el id de dispositivos **de terceros** que ni siquiera
  son nuestros — cualquier periférico que anuncie NUS y no matchee. Por el razonamiento del propio RBM5.13
  el hit esperado es el bridge de la balanza Vesta; en el campo es lo que haya cerca.
- **Clase preexistente, 2 emisores nuevos**: `connect_superseded { deviceId }` en `adapter-ble-gatt.ts:783`
  y `adapter-mfi-ios.ts:673`. Ya existía en `adapter-spp-android.ts:726` desde antes del baseline. El delta
  amplía la superficie, no la inaugura.

### Fix recomendado

Dos partes, y la segunda es la que realmente cierra: (a) agregar `deviceid` a `PII_KEYS_RAW` en
`redact.ts` — `normalizeKey` lo colapsa, así que atrapa `deviceId` y `device_id`; (b) **sacar `device.id`
del string de `message`** y pasarlo como campo propio, porque un scrubber por claves no puede tocar un
interpolado. ⚠️ `redact.ts` y `payloads.ts` **no son de este delta**: el arreglo cruza a superficie de la
feature 17.

---

## Lo que la spec declara y VERIFIQUÉ — punto por punto

### RBM9.1 / RBM9.2 — Gate 1 N/A, de forma atribuible ✅

Como pide el requisito, **no** usé `git diff` contra el árbol. Crucé la lista de archivos **por commit**
(`git show --name-only` × 6) contra `git status --porcelain --untracked-files=all supabase/ sync-streams/`:

- **Archivos del delta bajo `supabase/` o `sync-streams/`: CERO.** Cero migraciones, RPC, Edge Functions,
  policies, cero cambios de sync rules.
- Lo que el working tree sí muestra bajo `supabase/` —` M config.toml`, ` M functions/audit_query/index.ts`,
  `?? functions/audit_query/{access,access-helpers,access-helpers.test}.ts`— es **feature 24, otra
  terminal**, y no está en la lista del delta. No cuenta, exactamente como el requisito anticipa.
- Los tres `??` untracked los vi porque usé `--untracked-files=all`; un `git diff` los habría perdido.

### Integridad del EID / SENASA (RBM1.8) ✅

El delta cambia **de dónde sale el parser** y nada más. Verificado:

- `contract.ts:75-94` `ingestRawLine` aplica `isValidTag` a lo que devuelva **cualquier** `frameParser`
  (`parser-rs420.ts:72-84`: `/^\d{15}$/` + prefijo ISO). La validación no se movió ni se relajó.
- Dedup por-TAG (`contract.ts:168`) y gate de confirmación pre-commit (`commit()` separado de
  `processRawLine`) intactos.
- **Ningún adapter nuevo parsea ni valida por su cuenta**: `adapter-ble-gatt.ts:1514` y
  `adapter-mfi-ios.ts:1118` solo emiten `rawLine`. No hay atajo al motor.
- **Fail-closed real, no fallback**: `resolveFrameParser` (`adapter-selection.ts:413-428`) exige
  `typeof parser.parse === 'function'` y devuelve `null` + `onUnresolved`; el provider descarta con
  `parser_unresolved{at:'read'}` (`BleStickListenerProvider.tsx:350-355`) y avisa `at:'mount'` al cablear
  (`:146-148`). Sin default a RS420 en ningún camino.
- Perseguí el único olor a fallback que encontré — `frameParser: { parse: () => null }` en
  `adapter-ble-gatt.ts:583`. **No es fail-open**: solo se construye con `driver == null`, que
  `isBleGattTransportAvailable()` impide antes de instanciar, y aun así `connect()` corta con
  `driver-sin-ble-gatt` antes de que exista stream. Y si llegara una línea, daría `parse_failed`
  (rechazo + log), no aceptación.
- Suites verdes, corridas con el runner del proyecto (**no** `check.mjs`): `frame-parser-resolve`,
  `adapter-ingest-mode`, `permissions-android`, `remembered-format`, `adapter-ble-gatt`,
  `adapter-mfi-ios`, `with-bluetooth-classic`, `ios-purpose-strings-guard`, `app.config` → **254 tests,
  0 fallos**.

### Permisos Android — contra el manifiesto MERGEADO ✅

No me quedé en `app.config.ts`. Leí los artefactos de merge del build local del 2026-08-17 03:49
(post-delta; se confirma que ble-plx estuvo en ese build porque aparece su `uses-permission-sdk-23`).
`processDebugMainManifest`, `expoDebugOverrideMaxSdkConflicts` y `processDebugManifestForPackage`
coinciden:

```xml
<uses-permission-sdk-23 android:name="…ACCESS_COARSE_LOCATION" android:maxSdkVersion="30" />
<uses-permission-sdk-23 android:name="…ACCESS_FINE_LOCATION"   android:maxSdkVersion="30" />
<uses-permission        android:name="…ACCESS_FINE_LOCATION"   android:maxSdkVersion="30" />
<uses-permission android:name="…BLUETOOTH"        android:maxSdkVersion="30" />
<uses-permission android:name="…BLUETOOTH_ADMIN"  android:maxSdkVersion="30" />
<uses-permission android:name="…BLUETOOTH_CONNECT" android:minSdkVersion="31" />
<uses-permission android:name="…BLUETOOTH_SCAN"    android:minSdkVersion="31"
                 android:usesPermissionFlags="neverForLocation" />
```

**Ninguna ubicación sin tope en el manifiesto mergeado.** Las dos librerías declaran
`ACCESS_FINE_LOCATION` sin `maxSdkVersion` en sus propios manifiestos
(`node_modules/react-native-ble-plx/android/src/main/AndroidManifest.xml:5-6`,
`react-native-bluetooth-classic/…:5`) y las dos quedan neutralizadas: el `tools:node="replace"` de
`with-bluetooth-classic.js:70` para `uses-permission`, y `neverForLocation: true` del plugin de ble-plx
para el array `uses-permission-sdk-23`. `BLUETOOTH_SCAN` sale con `neverForLocation`.

Runtime coherente y fail-closed: tabla por transporte exhaustiva por `TransportKind`
(`permissions-android.ts:78-87`), `hasAndroidPermissionPolicy` evita el fail-open del transporte
desconocido (`:97-99`), `classifyPermission*` exigen **todos** concedidos (`:136-157`), y los caminos
automáticos usan `check` (no pide) mientras el gesto usa `ensure`.

### Background BLE (RBM2.15) ✅

- Merged manifest: **cero `<uses-feature>`** → `isBackgroundEnabled: false` efectivo.
- `app.config.ts:53`: `UIBackgroundModes: ['remote-notification']`. Sin `bluetooth-central`; `modes: []`.

### iOS / `UISupportedExternalAccessoryProtocols` (RBM4.6) ✅

- `app.config.ts:96`: declarada y **vacía**.
- **Ninguna `protocolString` inventada**: el registro tiene `[RS420_DRIVER, ESP32_GATT_DRIVER]`
  (`driver-registry.ts:23`) y ninguno declara transporte `mfi`. `protocolString` solo existe como *tipo*
  (`driver-types.ts:63`).
- Guard vivo y con el oráculo correcto (`ios-purpose-strings-guard.test.ts:590-608`): acepta el array
  vacío, **falla ante la ausencia** y ante el "casi" (string suelto).
- `ea-protocols.ts:42-50` lee `Constants.expoConfig`, **no** `NativeModules` — respeta el motivo por el que
  la clave vacía existe (no instanciar el módulo del force-cast).

### Bastón recordado — qué se persiste, dónde, y si se limpia ✅

- Se guarda `{deviceId, vendorId?, adapterKind?}` como JSON en SecureStore (`rafq.ble.remembered_device`),
  con charset saneado a `[A-Za-z0-9._:-]` (`remembered-format.ts:56`). Sin EID, sin datos de
  establecimiento, sin PII de persona.
- `parseRememberedValue` es fail-closed sobre el `adapterKind` desconocido (`:99`, descarta la preferencia
  y conserva el id) y `honorsPreference` (`adapter-selection.ts:119-123`) no honra un kind imposible ni
  gateado — un storage manoseado no puede dejar al operario sin transporte.
- **Se limpia en las dos salidas**: `signOut` (`AuthContext.tsx:127` y `:207`) y baja de cuenta
  (`account.ts:168`).
- No se filtra a logs: ningún `logTransportEvent` emite el registro.

### Multi-tenant (RBM9.3) ✅

Grep sobre los 30 archivos de app del delta: **cero** `establishment_id`, `from(`, `rpc(`, `session`,
`access_token`. Los únicos hits son comentarios de `app.config.ts` y entradas de `package.json`/lockfile.
El EID sigue entrando al find-or-create de spec 09, que corre bajo RLS, y ese camino no cambia.

### Supply chain (dep nueva) ✅

`react-native-ble-plx` entra **pineado exacto** (`"3.5.1"`, sin `^`/`~`), con entrada en `pnpm-lock.yaml`,
y **fuera** de `onlyBuiltDependencies` → sus lifecycle scripts (`prepare`) no corren. Correcto.

### Otros ✅

- `console.info('[ble]', …)` (`logging.ts:140`) **no** llega a Sentry: `captureConsoleIntegration` está
  configurada con `levels: ['error']` (`sentry.native.ts:38`).
- Sentry no adjunta pixeles ni jerarquía de views (`:43-44`).

---

## Tabla de inputs de usuario

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| **EID por bastón** (BLE GATT / MFi — el input nuevo del delta) | 15 dígitos ISO 11784/11785 | **Servidor-autoritativa**: cliente `isValidTag` (`parser-rs420.ts:74`, `/^\d{15}$/` + prefijo) y el motor find-or-create de spec 09 bajo RLS, que no cambia | ✅ |
| **Línea cruda por bastón** (antes del parseo) | **NINGUNO** — el buffer del framer crece sin cota | Ninguna antes de acumular | ❌ **HIGH-1** |
| Baud (`baston-test.tsx:296`) | `parseInt` + `> 0` + fallback `DEFAULT_BAUD` (`:152-153`), `keyboardType="number-pad"` | Local: solo alimenta `navigator.serial.open()` en el harness web de dev. Nunca sale del dispositivo | ✅ n/a servidor |

No hay formularios, buscadores ni prompts nuevos en el delta.

## Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed | Nota |
|---|---|---|---|---|
| Escaneo BLE | Sí — presupuesto acotado + `stopDeviceScan` siempre (`adapter-ble-gatt.ts:1129+`) | por-sesión de adapter | sí | Local, sin costo de servidor |
| Reintentos de reconexión | Sí — backoff + tope de cadena `autoconnect_exhausted` (`:1444`), foreground-only | por-adapter | sí | El tope se destopa solo con trigger `operator` (gesto) |
| Ingesta de notificaciones GATT | **No** | — | no | Es el vector de HIGH-1; el tope que falta es de tamaño, no de frecuencia |
| Cualquier endpoint / Edge Function / email / SMS / API externa | **n/a** | — | — | El delta no toca red. Cero superficie de servidor (RBM9.1 verificado) |

---

## Cobertura de la skill y falsos positivos

**No corrí `sentry-skills:security-review`** sobre este diff, y lo digo en vez de disimularlo: su
metodología (trazar data flow de input attacker-controlled → sink) está orientada a superficies
web/servidor —inyección, XSS, authz, cripto— y este changeset **no tiene ni un sink de esos**: cero SQL,
cero HTTP, cero authz, cero render de HTML, cero DB. Los dominios que sí manda este delta —trust boundary
BLE, permisos de manifiesto Android, `Info.plist` de iOS, breadcrumbs de telemetría, SecureStore— son
justamente los que la skill declara como no cubiertos. Los revisé **manualmente**, uno por uno, con los
oráculos que sí aplican: el manifiesto **mergeado** (no la fuente), el fuente instalado de las libs en
`node_modules`, y las suites del proyecto.

**Falsos positivos descartados** (los perseguí y no lo son):

1. `frameParser: { parse: () => null }` (`adapter-ble-gatt.ts:583`) — parece fallback; es un centinela
   inalcanzable y, aun alcanzado, rechaza con log. Motivo completo arriba.
2. `DRIVER_REGISTRY` exportado como array mutable (`driver-registry.ts:23`) — sin frontera de confianza
   dentro del bundle del cliente; preexistente al delta.
3. `bleGattDriverFrom` devolviendo "el primero del registro" (`:334`) — está acotado y **vigilado** por un
   guard que cae si aparece un segundo driver `ble-gatt`.
4. `androidBluetoothPermissionsFor` cayendo al régimen legacy con `apiLevel` ilegible
   (`permissions-android.ts:118-128`) — el desenlace es correcto por el `maxSdkVersion=30` del manifiesto:
   `requestMultiple` devuelve denegado **sin diálogo**, no un pedido de ubicación.

## Archivos analizados

`app/src/services/ble/`: `line-framer.ts`, `adapter-ble-gatt.ts`, `adapter-mfi-ios.ts`,
`adapter-selection.ts`, `contract.ts`, `logging.ts`, `driver-registry.ts`, `driver-esp32-gatt.ts`,
`driver-types.ts`, `ea-protocols.ts`, `remembered-device.ts`, `remembered-format.ts`,
`permissions-android.ts`, `permissions.ts`, `ble-gatt-protocol.ts`, `spp-protocol.ts`, `parser-rs420.ts`,
`BleStickListenerProvider.tsx`, `stick-adapter.ts`, `selection-priority.ts`, `connect-trigger.ts` ·
`app/src/features/ble-stick/` · `app/app/baston-test.tsx` · `app/app.config.ts` ·
`app/plugins/with-bluetooth-classic.js` · `app/package.json` + `pnpm-lock.yaml` ·
`app/src/services/observability/{sentry.native.ts,payloads.ts,redact.ts}` (destino de los logs) ·
`app/src/contexts/AuthContext.tsx`, `app/src/services/account.ts` (limpieza) ·
merged manifests de `android/app/build/intermediates/**` · manifiestos de librería en `node_modules`.

## Nota de método

No corrí `check.mjs`: muere en el primer stage rojo (`execSync` sin `try`), así que un RC≠0 no habría
dicho nada de los stages posteriores. Corrí las 9 suites relevantes directo con el runner del proyecto
(`node --import ./scripts/ts-ext-resolver.mjs --test`) → 254 tests verdes. No edité código ni commiteé.
