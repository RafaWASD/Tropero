# impl — bloqueantes del camino Bluetooth Classic SPP del bastón (feature 04, bugfix)

> ## ⚠️ ESTE INFORME ESTÁ INCOMPLETO — nota del leader (2026-07-30)
>
> **Hubo una TERCERA pasada (el tope de la cadena de reintentos sin gesto) que este informe NO
> documenta.** El implementer la implementó, pero murió **dos veces por 529 Overloaded** del servidor
> antes de poder escribirla, autorrevisarla y verificarla. Concretamente, de la tercera pasada faltan:
> su entrada en §1, su **autorrevisión adversarial** en §3, la verificación de §4 re-corrida al final, y
> la reconciliación de specs de §5.
>
> Lo escribo acá arriba y no al final a propósito: **ya nos pasó una vez** que un informe quedara
> commiteado como si estuviera completo cuando el agente había muerto mid-run y la autorrevisión estaba
> vacía (`progress/impl_baston-android-spp.md`, seis placeholders sin llenar — es de dónde salieron los
> 2 🔴 de esta unidad). Un informe que se skimea por el título tiene que decir la verdad en el título.
>
> **Lo que sí verifiqué yo (leader, read-only)** sobre el estado final del código, para que el reviewer
> no arranque a ciegas:
> - `npx tsc -p app/tsconfig.json --noEmit` → **rc=0**.
> - Las 6 suites del camino → **151 pass / 0 fail**.
> - Los **4** archivos de test nuevos **están registrados** en `run-tests.mjs`; ninguna referencia
>   colgada en esa lista.
> - El tope está **cableado en producción**, no solo escrito: `runConnect(deviceId, trigger)` como punto
>   único de entrada, `applyChainPolicy`, `UNPROMPTED_RETRY_BUDGET_MS = 120_000`, y el estado honesto
>   (`autoConnectExhausted` → "No encontramos el bastón") con la carga manual viva.
>
> **Para el reviewer**: la tercera pasada es la que llega **sin autorrevisión**, así que es la que hay
> que mirar con más desconfianza — no la que tiene menos escrito. Dos riesgos concretos que le pedí al
> implementer y que quedaron sin su respuesta: (a) que el tope **no se filtre** a la cadena que nace de
> un tap del operario, y (b) que `autoConnectExhausted` **pueda volver a false** (si queda pegado, la app
> dice "no encontramos el bastón" para siempre, incluso conectada).

baseline_commit: c252b72c86826965f82aeb59264d2521adebba46

**Tipo**: bugfix sobre feature aprobada (delta multivendor de 04), no feature nueva.
**Entradas**: `progress/review_baston-android-spp.md` (2 🔴 · 5 🟠 · 5 🟡 · 5 ⚪) +
`progress/bench_baston-spp-emulador.md` (corrida en el A07 real, 2026-07-30, con baseline automatizado
**18/21** contra `dad711f`) + `progress/handoff-bluetooth-esp32.md` §2/§3 +
`firmware/baston-emulator/README.md`.

> **Ojo con el baseline**: el leader commiteó tres veces (`0fdc8c1`, `2268f14`, `d220ef5`) **mientras**
> corría esta unidad, así que el diff desde `c252b72` incluye esos tres (docs: backlog, decisiones de
> Raf, baseline del banco). Todo lo de `app/`, `scripts/` y `specs/` de este diff es de esta unidad.

## Método (para que ningún número de acá sea una afirmación)

- **lo leí** = lectura de código (nuestro, o el Java de `react-native-bluetooth-classic@1.73.0-rc.17`
  en `app/node_modules`).
- **lo ejecuté** = lo corrí y vi la salida. Todo lo que dice "ejecutado" abajo tiene su comando.
- Conteo de tests: `node --test` por archivo, tomando su línea `ℹ pass`. No `grep`.
- Los guards estáticos nuevos se validaron **mutando el código que vigilan** y viendo el rojo (8
  mutantes, §4). Un guard que nunca se probó rompiendo lo que cuida no prueba nada.

**Dos pasadas, un informe**: la 1 son los 9 bloqueantes del pedido original (§1.1–§1.9); la 2 es **R6.4**
(§1.10), que el leader pidió después con el criterio de producto ya resuelto por Raf. Todo lo verificado
abajo es del estado FINAL (las suites y la E2E se re-corrieron después de la segunda pasada).

---

## 1. Qué se arregló (9 bloqueantes + R6.4)

### 🔴 1 · BENCH-1 — el "Bastón conectado" mentiroso (banco §4.1, 3/3 repro en device)

**El defecto**: si el link se caía con la app **minimizada**, el evento de desconexión se perdía y al
volver a primer plano la pantalla decía *"Bastón conectado — Bastoneá un animal: la lectura entra
sola"* **indefinidamente**, con el socket muerto. `scheduleReconnect()` manejaba bien el background,
pero **solo se llegaba ahí si la desconexión se había detectado**; al volver a foreground nada
reconciliaba.

**Causa raíz, leída en el Java** (esto es nuevo respecto del informe del reviewer, y explica por qué el
evento se pierde de verdad):

- El **único** evento que llega a nuestro listener lo emite `onACLDisconnected` con
  `sendEvent(EventType, WritableMap)`, y ese método **descarta el evento** si
  `!context.hasActiveCatalystInstance()` (`RNBluetoothClassicModule.java:1398-1408`; loguea *"There is
  currently no active Catalyst instance"* y sigue).
- El **otro** emisor —`onDisconnect`, el del hilo de lectura cuando el socket tira `IOException`—
  publica en `DEVICE_DISCONNECTED@<address>` (la sobrecarga de `sendEvent` con device, `:1425-1435`),
  y `onDeviceDisconnected(listener)` se suscribe a `DEVICE_DISCONNECTED` **pelado**: ese evento **no
  llega nunca** a este listener. O sea: no había un segundo aviso, había **uno solo y frágil**.

**El fix**: segunda fuente de verdad. `isDeviceConnected(address)` es, del lado Java,
`mConnections.containsKey(address)` (`:939-946`), y ese mapa lo limpian **dos** caminos que corren en
Java independientemente de que el evento llegue a JS: `onACLDisconnected` (`:1379-1385`) y
`onDisconnect` (`:1157-1166`). Se consulta por **dos** disparadores:

1. **al volver a foreground** — instantáneo para el caso del bolsillo;
2. **un poll periódico de 15 s** (`livenessPoll`) que no depende de ningún evento ni de `AppState`.

El poll no es redundante: es lo que **acota el techo** del "conectado" mentiroso a 15 s. La sonda de
foreground puede llegar unos ms *antes* de que el lado Java se entere (el hilo de lectura todavía no
tiró y el broadcast del ACL todavía no corrió) y devolver un `true` viejo; y además el poll cubre el
corte que ocurre con la app **en primer plano** y el evento perdido igual. Un `containsKey` cada 15 s
es gratis al lado de mantener un RFCOMM abierto.

**Fail-closed**: si la sonda no existe (lib vieja) o **rechaza** —el nativo rechaza con
`BLUETOOTH_NOT_ENABLED` cuando el adaptador está apagado, o sea que seguro NO estamos conectados—, no
se sigue afirmando "conectado". El peor caso es un teardown + reconexión de más (~1-2 s); el caso que
evita es 40 bastonazos perdidos sin un indicio. Si la lib no expone la sonda, se dice **una vez por
conexión** (`liveness_probe_unavailable`) en vez de fingir cobertura.

**R6.9 sigue en pie**: sondear no es conectar, escanear ni reconectar; y la reconexión que la sonda
dispara pasa por `scheduleReconnect`, que es foreground-only.

### 🔴 2 · `connectInFlight` sin timeout (🔴-1 del review, banco §4.2)

**El defecto**: no había **un solo** timeout en el archivo. Un await del puente que no resolvía dejaba
el latch tomado para siempre y todo `connect()` posterior era un no-op mudo hasta matar la app (el
adapter se construye una vez por vida del proceso). Medido en device: **2 min 40 s sin un solo evento**
con el Bluetooth prendido y el bastón disponible, porque el operario lo prendió del panel rápido en vez
de contestarle al diálogo del sistema.

**El fix**, en cuatro piezas:

1. **`bridge-timeout.ts`** (nuevo, puro): `withTimeout` / `withTimeoutOr` / `BridgeTimings`. Al vencer
   (a) le adosa un handler vacío a la promesa abandonada (un rechazo tardío del nativo no puede
   explotar como `unhandledRejection`) y (b) llama a `onTimeout`, que es donde el caller cierra lo que
   la llamada abandonada abrió igual — caso real: un `connectToDevice` que vence y **después** resuelve
   con el socket abierto; si no se cierra queda en `mConnections` sin que nadie lo lea, y la propia
   sonda de liveness lo vería "vivo".
2. **Presupuestos por clase**, no uno: `call` 10 s (llamadas que solo cruzan y vuelven), `prompt` 30 s
   (las que esperan a **una persona** frente a un diálogo del SO — el presupuesto no mide latencia,
   mide cuánto tiempo aceptamos ser rehenes de un diálogo que el operario puede resolver por otro
   lado), `connect` 20 s (RFCOMM; con el bastón apagado Android tarda ~10-12 s en rendirse).
3. **El latch dejó de ser un booleano**: es `inFlightGen` + una **generación de intento**. Se libera en
   el `finally` **y** en `disconnect()`, y la generación es lo que hace que liberarlo ahí sea seguro: el
   intento viejo, al despertar de su await, ve que ya no es el vigente, **cierra lo que abrió** y se va
   sin tocar el estado. Sin la generación, liberar el latch en `disconnect()` abría la ventana de dos
   intentos pisándose (`this.device`/`this.dataSub` sobreescritos → socket huérfano abierto).
4. **`requestBluetoothEnabled` coalescido a nivel módulo.** Esta era la **causa raíz #2** del review y
   no se cierra con timeouts: el nativo guarda esa promesa en **un solo slot** (`mEnabledPromise`,
   `:409-424`) y hay **dos** entradas independientes que lo piden (`listPairedSppDevices` desde la
   pantalla y `doConnect` desde el chip/el timer). Dos llamadas solapadas **pisan** el slot y dejan la
   primera huérfana para siempre. Coalescer del lado de JS es lo único que evita que el solapamiento lo
   causemos nosotros.

**Y un guard sobre la ausencia** (`spp-bridge-timeout-guard.test.ts`): enumera **todos** los `await`
del adapter cuya expresión arranca en `native.` / `device.` / `env.` / `this.env.` —las cuatro
superficies que no controlamos— y exige `withTimeout`/`withTimeoutOr` en cada uno. El fix del bug 2 de
`dad711f` (`pairDevice()` colgado) sacó **la llamada** pero no escribió el guard sobre **la ausencia
del mecanismo**, y la clase volvió por otras cinco puertas. Ahora una llamada nueva al puente nace en
rojo. El guard declara lo que **no** puede ver: un await indirecto (`const p = native.x(); await p;`).
Para el único caso de promesa guardada que existe hoy (`pending`, que existe justamente para poder
envolverla) el guard lo exige a mano.

### 🔴 3 · El evento de desconexión es GLOBAL (🔴-2 del review)

Confirmado por lectura propia del Java (no re-litigado): `onDeviceDisconnected` se suscribe a
`DEVICE_DISCONNECTED` pelado y lo alimenta `ActionACLReceiver`, un `BroadcastReceiver` de
`BluetoothDevice.ACTION_ACL_DISCONNECTED` — **de todos los devices Classic del teléfono**. El payload
sí trae el device (`BluetoothDeviceEvent.buildMap()` → `map.putMap("device", device.map())`, y
`NativeDevice` tiene `address`), así que se puede filtrar.

**El fix**: comparación case-insensitive (el SO devuelve las MAC en minúscula) contra la MAC de la
sesión **y** contra la que reporta el device. Un evento **sin dirección legible** se **acepta**, con el
motivo escrito: es la señal que teníamos, preferimos un teardown de más que un "conectado" mentiroso, y
la sonda de liveness cubre el falso positivo reconectando enseguida.

### 🟠 4 · Gate de foreground al DISPARAR, no al programar (🟠-1; banco §4.6 lo confirmó en device)

Se chequeaba al armar el timer y no al dispararlo, así que un timer nacido en primer plano se ejecutaba
en background. El banco lo capturó con timestamps: `reconnect_attempt attempt:0` en foreground → HOME →
`connect_error "read failed…"` **14 s después**, o sea un connect nativo ejecutado con la app
minimizada. Viola R6.9/RMV5.5 y es el **habilitador** del latch eterno (un `requestBluetoothEnabled` en
background no puede abrir su Activity → su promesa no se asienta nunca).

**Bonus del mismo tramo** (§9.3 del review): **el diálogo del sistema nunca sale de un timer.** Un
reintento automático con el Bluetooth apagado ya no pide activarlo; sigue reintentando en silencio, y
como el backoff topea en 8 s, cuando el operario lo prenda por afuera —lo que hizo en el banco— la app
reconecta sola dentro de esa ventana. Un `connect()` **del operario** sí lo pide, como antes.

### 🟠 5 · Un `connect()` con otro target no se descarta mudo (🟠-2)

Antes: el operario tocaba el bastón A (cuyo `connectToDevice` bloquea segundos si está apagado), se daba
cuenta de que era el otro, tocaba el B → **no pasaba nada** (ni estado, ni log) y terminaba conectado a
A. Ahora se **encola** el último target pedido y se atiende al terminar el intento en curso, con log
`connect_superseded`. Un `connect()` **sin** target ("conectá a lo que estabas") no encola nada: el
intento en curso ya es eso. Un `disconnect()` descarta la cola (gana el operario).

### 🟠 6 · Guard de re-entrada + timeout en la lista de emparejados (🟠-4)

Dos capas: (a) `listPairedSppDevices` **coalesce** los pedidos concurrentes y **acota todos** sus awaits
del puente → siempre se asienta en `{ok:false, reason}`, así que `pairedState` no puede quedar clavado
en `loading` (que es el estado sin CTA de salida); (b) la pantalla tiene su propio guard de re-entrada y
cae a `error` —que sí ofrece "Reintentar"— si el service llegara a tirar.

### 🟠 7 · Honestidad del terminador + watchdog de mudez (🟠-5 / BENCH-2)

**Elegí la opción fuerte: el terminador sale del driver**, con chequeo honesto como el del UUID.
`TransportCapability` de kind `spp` gana `delimiter?`; el RS420 lo declara **explícito** (`\n`, de
`field-findings.md`) aunque coincida con el default, para que quede escrito que es un supuesto **del
lector** y no del transporte. `splitSppPayload` separa por **ese mismo** delimitador (separar por otro
sería inventar tramas).

El chequeo honesto es falsable, no decorativo: un delimitador **vacío** es legal para el nativo pero
significa otra cosa —`DelimitedStringDeviceConnectionImpl.read()` con delimitador vacío devuelve **todo
el buffer** como un mensaje, o sea modo crudo por chunks, que exigiría framear de este lado: el bug que
costó "cero lecturas"— y además un `split('')` explotaría el payload en caracteres. Ese caso **corta la
conexión con log**, no la abre.

**Lo que el fix NO arregla, y queda dicho**: BENCH-2 (el `StringBuffer` sin cota del nativo envenena
también la primera trama válida al corregir el terminador) **es irreparable desde JS** — el buffer vive
en Java. Lo que cambia es que ahora la causa (el terminador equivocado) es **configuración del driver**
en vez de una constante nuestra, y que la mudez **deja rastro**: el watchdog loguea `connected_silent`
con los ms de silencio cuando pasan ≥45 s sin un byte. No desconecta —el silencio es lo normal cuando
el operario no bastonea— pero es lo que permite distinguir en logcat las tres causas que hoy dan
**exactamente** el mismo síntoma (terminador equivocado / lector dormido / socket muerto). La cota de
los framers quedó en `docs/backlog.md` (la puso el leader).

### 🟡 8 · `isRawStream` derivado + guard sobre la ausencia (🟡-1)

`ADAPTER_INGEST_MODE` en `adapter-selection.ts`, declarado
`satisfies Record<AdapterKind, IngestMode>` → un `AdapterKind` nuevo **no compila** hasta declarar su
modo. El provider delega en `ingestModeFor(transport.kind)`.

**Un hallazgo de la autorrevisión que cambió el diseño**: la primera versión puso el ancla de
exhaustividad (`Exclude<…> extends never`) **en el test**. Eso era un guard **decorativo**:
`app/tsconfig.json` **excluye `**/*.test.ts`**, así que una aserción de tipos escrita en un test **no
la chequea nadie** (node:test solo borra los tipos). El ancla se movió a `adapter-selection.ts`, que sí
está en el typecheck. Es un dato que vale para todo el repo: **un "guard de tipos" en un archivo de
test de este proyecto no existe.**

### 🟠 9 · BENCH-3 — `/baston` consumía cada lectura dos veces (banco §4.5)

**Mecanismo elegido: el scanner acotado (RCF.6), no `BLE_OWNED_ROUTES`.** Los dos suprimen el overlay
igual (y los dos cierran uno abierto al entrar); lo que decide son dos cosas:

1. La propiedad la declara **el dueño**, no una lista de literales de rutas que vive en otro archivo.
   Mover o renombrar la ruta rompería esa lista **en silencio** — la misma clase de bug que 🟡-1, en la
   misma sesión. Y el riesgo no es teórico: `/baston` es una ruta top-level *hoy*, y `segments[0]` es de
   lo que depende `BLE_OWNED_ROUTES`.
2. El scanner acotado además **fuerza la escucha** aunque un ancestro haya prendido `busyMode`, que es
   lo que necesita una pantalla cuyo único trabajo es mostrar lecturas en vivo.

**Y `useFocusEffect`, no `useEffect`** (mismo motivo documentado en `useHardwareBack`): las pantallas
del stack quedan **montadas** al navegar encima. Con `useEffect`, algo empujado sobre `/baston` dejaría
el overlay global suprimido **en toda la app** hasta volver — un bastonazo en la pantalla de arriba no
abriría nada, en silencio. Acotado al foco, la propiedad dura lo que dura la pantalla en primer plano.

**Freebie tomado** (🟡-3, el único que el pedido autorizaba si salía gratis): el **dwell del backoff**.
El contador se reseteaba apenas resolvía `connectToDevice`, así que `flap 4 3000` daba `attempt:0` las
cuatro veces (medido en device, §4.3). Ahora el reset exige que el link haya **durado**
`LINK_DWELL_MS` = 30 s. Salió gratis porque `scheduleReconnect` ya estaba abierto para el fix del gate
de foreground, y el precio es un campo (`connectedAt`) y un reloj inyectable.

---

### 🟠 10 · R6.4 — reconexión automática al ABRIR la app (segunda pasada)

**El defecto** (🟠-3 del review): R6.4 dice *"reconectar automáticamente al bastón guardado … **sin
requerir que el operario vuelva a la pantalla de conexión**"*, y no estaba implementado **ni podía tener
un test** (el camino no existía). Los únicos llamadores de `connect()` eran gestos, así que
`readRememberedDevice()` solo se alcanzaba tocando algo: **cada arranque exigía Más → Bastón → tocar**.
Decisión de Raf: *"que se reconecte sola al abrir, sí"* (la alternativa —reconciliar la spec diciendo que
el arranque es por gesto— quedó descartada).

**El fix**: `SppAndroidAdapter.autoConnect()`, que el provider llama **una vez** al montar el transporte,
gobernada por una regla que el EARS no decía y que es la que importa: **el arranque no pide nada**.
Cuatro gates, ordenados del más barato al que toca el hardware — y el orden es parte del diseño:

1. **¿Hay device recordado?** Lectura local, va **primera**: un arranque en frío no consulta permisos ni
   pregunta por el Bluetooth. Nada. (Solo se auto-conecta a un bastón que el operario **ya eligió**.)
2. **¿El permiso ya está concedido?** Se **consulta** (`PermissionsAndroid.check`), no se pide.
3. **¿El Bluetooth ya está prendido?** Se lee, sin diálogo. Apagado → no arranca.
4. **¿Foreground?** R6.9.

Un gate que no pasa **no emite ningún estado**: queda en `'off'`, que es el estado honesto de "nunca se
intentó" (*"Bastón sin conectar"* + CTA, y el `StickStatusIndicator` se auto-oculta en `'off'`). Emitir
`'disconnected'` sería mentir —*"se apagó, quedó fuera de rango o cancelaste"*— y ponerle un pill en el
chrome a alguien que no pidió nada. El motivo va al log (`autoconnect_skipped`, 6 motivos): desde la UI
los seis se ven idénticos (nada), así que sin el log un "no se conectó solo" es inadivinable.

**Una ampliación gratis del mismo principio, que era un hueco real**: `ensureAndroidBluetoothPermissions`
llama `requestMultiple`, y sobre un permiso **denegado una vez** (sin "no volver a preguntar") eso
**vuelve a mostrar el diálogo**. O sea que la cadena de reintentos —no solo el arranque— podía tirarle el
diálogo de permisos en la cara sin contexto. Ahora **todo** camino `auto` consulta en vez de pedir. Y el
campo `checkPermissions` del `SppEnv` es **obligatorio** a propósito, no un opcional con caída a
`ensurePermissions`: un env nuevo que se lo olvide **no compila**, en vez de empezar a mostrar diálogos
desde un timer en silencio.

**`autoConnect` es OPCIONAL en `StickAdapter`** y hoy la implementa **solo** spp-android — y no por
olvido de los otros cuatro, que es lo que `wiring.test.ts` fija como decisión escrita: `web-serial` **no
puede** (la Web Serial API exige un gesto para `requestPort()`; su "recordar" es `getPorts()`, R5.4),
`manual` no tiene transporte físico, y `mock`/`simulator` los conecta su propio disparador. De ahí que el
cambio tenga **cero riesgo** para las ~70 specs E2E, que corren en `mock`.

**Consecuencia que hay que mirar, y la escalé en el backlog**: el ítem *"`scanning` sin CTA y sin tope de
reintentos"* **subió de severidad**. Antes solo pasaba después de que el operario hubiera conectado; ahora
el caso "emparejó un bastón hace un mes y ya no lo tiene" da, **en cada apertura y sin tocar nada**,
`Reintentando…` para siempre y un connect cada 8 s, sin botón para frenarlo. No lo arreglé acá porque el
pedido fue explícito ("con el **mismo** backoff") y capear la cadena es una decisión de UX; queda la
opción barata anotada: topear solo la cadena que arrancó **sin gesto**.

### 🔴 11 · El TOPE de la cadena que nadie pidió (tercera pasada) + su fix-loop

**El defecto, que lo introdujo R6.4** (lo escalé yo en la §6 de la pasada anterior; el leader lo decidió
sin llevarlo a Raf porque *"no es una preferencia de UX, es un defecto que introduce R6.4"*): la cadena de
reintentos no tenía tope. Con el bastón apagado la app reintenta cada 8 s **para siempre**, y `scanning`
devuelve `cta:'none'`, o sea que no hay botón para frenarla. Mientras eso exigía un gesto deliberado era
discutible; con el arranque auto-conectando, un bastón **vendido, roto o que quedó en otro campo** deja la
app permanentemente con cara de rota, martillando la radio en cada apertura, sin que nadie toque nada.

**El fix**: la política se declara por **ORIGEN de la cadena** —no por estado— en una tabla exhaustiva
(`connect-trigger.ts`), que además reemplazó al booleano `auto` de `doConnect` (el mismo dato, pero
adivinado, y sin distinguir "cadena del operario" de "intento sin diálogos"):

| trigger | ¿diálogos del SO? | efecto en la cadena |
|---|---|---|
| `operator` (un tap) | ✅ el único | `start-unbounded` — el operario está tratando de conectar |
| `autoconnect` (el arranque) | ❌ | `start-capped` — nadie la pidió: 120 s |
| `retry` (el timer) | ❌ | `inherit` — continúa la cadena vigente |

**`retry` DEBE heredar**: si arrancara cadena, re-armaría el presupuesto en cada vuelta y el tope no se
alcanzaría nunca — la cadena infinita disfrazada. El mutante que lo prueba rompe 6 tests.

**Los 120 s, contra la escalera de backoff** (500·1000·2000·4000·8000 y de ahí 8 s fijos → 15,5 s de rampa
y después un poll de 8 s): tiene que cubrir *"abrí la app al llegar, caminé hasta la manga y prendí el
bastón un minuto después"* y **no** cubrir *"ese bastón lo vendí"*. 120 s es el **doble** del escenario a
cubrir; 60 s sería igual al escenario, sin margen para el boot del lector ni para un primer connect que
falla. En intentos son ~18 si el nativo resolviera al instante y ~6-7 con el bastón ausente (cada
`connectToDevice` bloquea ~10 s antes de rendirse) — **por eso el tope se mide en tiempo, no en intentos**.

**Al agotarse**: deja de reintentar · **no olvida** el device recordado · emite `'off'`, que **sí** tiene
CTA (a diferencia de `scanning`) y que es el único estado que el `StickStatusIndicator` se auto-oculta → no
se le toma el chrome a alguien que no pidió nada · el backoff vuelve al piso. Y el que **fue** a la
pantalla de conexión recibe el copy honesto ("No encontramos el bastón / puede estar apagado o fuera de
rango") vía `autoConnectExhausted`, en vez de un "Conectá el bastón" que sonaría a que nunca se intentó.

**El chequeo del presupuesto va ANTES del gate de foreground**, en los dos lugares donde se evalúa. Lo
encontré con un test propio: si fuera después, un timer que dispara con la app en background se parquearía
en `waitForForeground()` **sin pasar por el tope**, y una cadena vencida quedaría de zombi esperando el
retorno para volver a martillar — o sea, el tope sería evitable guardando el teléfono en el bolsillo.

#### El fix-loop: el 🔴 que encontraron el reviewer y el Gate 2 por separado

Los dos, independientemente, encontraron **el mismo** bloqueante (🔴-A / HIGH-1), y los dos lo
reprodujeron ejecutando un probe propio. Y el reviewer hizo algo que me importa más que el hallazgo:
corrió **el fix candidato como mutante (su M7)** y la suite quedó **104 pass / 0 fail** — mis 8 casos del
bloque `TOPE:` **no distinguían el bug del arreglo**. Cuarta repetición del verde mentiroso en esta
feature, esta vez dentro del mecanismo escrito para evitarlo.

**🔴-A — el presupuesto no moría al conectar.** `retryBudgetUntil` se fijaba al arrancar la cadena
`autoconnect` y **nunca se limpiaba al establecer el link**, así que no acotaba "la cadena que nadie pidió"
sino **los primeros 120 s de vida de la app**. El operario abre la app, R6.4 conecta sola, trabaja 10
minutos, el bastón se va de rango un segundo → **cero reintentos por el resto de la sesión**, estado
`'off'` (pill oculto) y la pantalla inventando un diagnóstico sobre un bastón que estaba conectado tres
segundos antes. Incumplía la **segunda cláusula del propio R6.4** (*"o el bastón recordado vuelve a estar
en rango"*), que después de R6.4 es el caso normal de toda sesión. Y el log se autodelataba:
`autoconnect_exhausted {"ms":600000,"attempts":0}` — 600 s de "intentos" sin un solo intento.

**El invariante que faltaba, ahora escrito en el código y en la spec**: el presupuesto pertenece a la
CADENA, y una cadena que llegó a `'connected'` **terminó**. El tope existe por un motivo único —"ese bastón
lo vendí"— y en el instante en que el bastón **contesta**, ese motivo dejó de aplicar. Una línea
(`retryBudgetUntil = null` en el punto de éxito) y **5 tests que sí distinguen**: re-corrí el M7 del
reviewer y ahora **falla 3**. Efecto lateral bueno: con el presupuesto muerto al conectar, un
`autoconnect_exhausted` solo puede venir de una cadena que **nunca** conectó, así que su `ms` mide tiempo
realmente reintentando y su `attempts` es > 0. El log dejó de poder mentir.

**🟠-B — el `connect()` del operario sin target seguía mudo, y encima se comía el destope.** Es el camino
del chip del header (`BleConnectionChip` → `connect()` sin argumentos, renderizado en la tab Animales y en
`maniobra/identificar`). Mi justificación escrita de la primera pasada —*"un connect sin target no encola
nada: el intento en curso ya es eso"*— era cierta entonces y **la tercera pasada la volvió falsa**: el
intento en curso puede pertenecer a una cadena **capada**, y el tap significa "quiero que insista". Ahora
un `connect()` con trigger `operator` y el latch tomado **re-aplica la política de su cadena** (destopa) y
**siempre** deja log (`connect_reasserted`).

**MEDIUM-1 — el cleanup del connect vencido desconectaba por DIRECCIÓN.** El `onTimeout` llamaba
`device.disconnect()`, que en la lib instalada cierra el socket **de esa MAC**
(`BluetoothDevice.js:54-55` → `disconnectFromDevice(this.address)`), no el del intento que lo armó. Si A
vence y B ya reconectó, **A le cierra el socket a B** y la app queda diciendo "conectado" sobre un socket
muerto: el síntoma de BENCH-1, producido por la limpieza que vino a evitar un socket fantasma. Cerrado con
`canCloseOrphanSocket(gen)`, que separa las **dos** razones por las que la generación pudo avanzar:
`closed` (el operario no quiere nada en esa dirección → cerrar sí o sí) vs. otro intento vigente (es su
dirección → no tocar). **Y me obligó a corregir un test propio**: el que decía *"el socket viejo se
cerró"* se apoyaba en que los dos dobles del test son devices independientes — en el teléfono son el MISMO
socket, porque el nativo reusa la conexión existente de esa dirección.

**MEDIUM-2 — el device recordado.** El punto del Gate 2 es correcto: el dato era pre-existente pero **R6.4
cambió su naturaleza** (antes una MAC inerte en storage; ahora la app abre un RFCOMM contra ella **sin
gesto** en cada apertura, y la fila deja tocar cualquier emparejado a propósito, así que puede ser unos
auriculares). Cuatro piezas:
- **no se persiste más antes de conectar**: la escritura de la pantalla era redundante (el adapter ya lo
  hace al llegar a `'connected'`) **y** peor, porque recordaba lo que nunca funcionó;
- **R6.6 cableada**: `forgetRememberedDevice` tenía **cero call sites** — un requisito aprobado cuya
  ausencia estaba dormida. Ahora hay un CTA "Olvidar el bastón guardado", condicionado a que **haya** algo
  guardado (un botón que no hace nada es la afordancia muerta que esta feature viene cerrando desde el
  chip);
- **se limpia al cerrar sesión y al dar de baja la cuenta**;
- **el scope por usuario**: no se implementó, y está argumentado en vez de omitido. Limpiar en `signOut`
  hace que la vida de la clave sea **la de la sesión**, que es exactamente lo que compra el scope para el
  caso descrito (teléfono compartido, cambio de turno del peón: el turno cambia con un logout). Si el peón
  A no cierra sesión, B **es** A para la app y una clave por-usuario no cambiaría nada. Threadear un
  `userId` hasta el `SppEnv` costaría más y no cubriría un caso más.

Los tres call sites de `forget` van con **guard sobre la ausencia** (`wiring.test.ts`): si alguien saca la
limpieza de cualquiera de los tres, cae en rojo con el motivo.

### 🟠 12 · El invariante del techo, FUERA del adapter (pasada final)

**El defecto**: los dos awaits que agregó el fix-loop —`forgetRememberedDevice()` en el `signOut()` y en la
baja de cuenta— quedaron **afuera del archivo donde mi guard enumeraba**. Un `.catch()` cubre el RECHAZO y
**no el COLGADO**: si SecureStore no contesta, el `signOut()` nunca corre y **el operario no puede cerrar
sesión**. Es el 🔴-1 de esta misma unidad (`connectInFlight` sin timeout) entrando por otra puerta, y la
ironía es que el tema entero de la unidad fue "todo await del puente necesita techo".

**El fix, en el borde y no en el call site.** Puse el techo dentro de `remembered-device.ts` (las tres
funciones, con `DEFAULT_BRIDGE_TIMINGS.storage` = **2 s**, no los 10 s de una llamada genérica: un logout
que tarda 10 s es un logout roto). Así **todo** caller queda protegido —el adapter, el arranque de R6.4, el
logout, la baja, la pantalla— y un call site nuevo **nace protegido** en vez de nacer roto. Las tres
funciones ya eran best-effort, así que vencer es otra forma de "no se pudo".

**Y el guard dejó de mirar una carpeta para mirar el invariante**, que es la parte que importa del pedido:
*ninguna promesa que cruza el puente nativo puede quedar sin techo, y el techo va en el BORDE que hace la
llamada nativa*. Dos mitades que se cierran entre sí:
- **MITAD 1** — los bordes declarados en `BOUNDED_AT_THE_BOUNDARY` acotan **de verdad**: en esos archivos
  todo `await` de una primitiva nativa va envuelto. **La tabla no puede mentir**, porque el guard la
  verifica.
- **MITAD 2** — en el territorio de esta unidad (`services/ble/**` + `features/ble-stick/**`) **ningún**
  archivo awaitea una primitiva nativa (`SecureStore.` / `PermissionsAndroid.` / `AsyncStorage.` /
  `NativeModules.`) sin techo, salvo los nombrados en `PRE_EXISTING_UNBOUNDED` **con su motivo**. Un
  archivo nuevo nace en rojo; meterlo en la lista de excepciones es una decisión visible en el diff.
- **Y la contraparte de la lista**: el guard exige que cada excepción declarada **exista** y **siga siendo
  una excepción** — si alguien la arregla y no la saca de la lista, el guard deja de cubrirla en silencio.

**Verificado rompiendo, las dos mitades**: (a) sacarle el techo al borde → cae MITAD 1 nombrando archivo y
línea; (b) crear un archivo nuevo en el territorio con un `await SecureStore.getItemAsync()` pelado → cae
MITAD 2. Límite declarado: una primitiva nativa que no esté en la lista se escapa; agregarla es parte del
costo de sumar una dependencia nativa.

### 🟠 13 · LOW-5 y un comentario que afirmaba más de lo que el código hacía

El leader tenía razón en las dos mitades, y la segunda me importa más.

**El agujero**: la limpieza del bastón recordado vivía solo en el `signOut()`, o sea que cubría el **gesto
explícito** y no los fines de sesión **involuntarios** — refresh token revocado o expirado, contraseña
cambiada en otro dispositivo, y el caso concreto que lo vuelve no-teórico: `delete_account` **revoca
global**, así que en el segundo teléfono de la cuenta la sesión muere por `onAuthStateChange` y el `forget`
de `account.ts` **no corre nunca**. Cerrado con una línea en el branch `SIGNED_OUT`.

**El comentario**: mi nota decía *"su vida es la de la sesión"* con **solo** el call site del `signOut`
puesto, y eso era falso — era la vida del **gesto de logout**. El leader lo aceptó, el Gate 2 lo refutó, y
lo que quedó escrito en el código era mi razonamiento equivocado **presentado como verificado**. Eso es
peor que el bug: es cómo nace el próximo "ADR-003 que se lee como prohibición general". Ahora los dos
comentarios dicen exactamente qué cubre cada call site, y por qué la afirmación es cierta **recién con los
dos puestos**. El guard fija los dos, con el motivo del involuntario escrito en el mensaje de fallo.

## 2. Trazabilidad: requisito → test concreto

Los tests están nombrados con el hallazgo que cierran (🔴-1, BENCH-1, …) justamente para que este mapa
no sea la única forma de encontrarlos.

| requisito / hallazgo | test (archivo · título) |
|---|---|
| RMV5.5 nota 1 · **BENCH-1** liveness al volver a foreground | `adapter-spp-android.test.ts` · *BENCH-1: corte con la app minimizada + vuelta a foreground → la sonda lo reconcilia* |
| ídem · el poll no depende de ningún evento | ídem · *BENCH-1: la sonda de liveness es PERIÓDICA — no depende de ningún evento ni de AppState* |
| ídem · no hay teardown gratuito con el socket vivo | ídem · *BENCH-1: volver a foreground con el socket VIVO no toca nada* |
| ídem · fail-closed si la sonda rechaza | ídem · *BENCH-1: si la sonda RECHAZA (BT apagado) se falla CERRADO* |
| ídem · lib sin la sonda no rompe | ídem · *BENCH-1: una lib SIN isDeviceConnected no rompe* |
| ídem · sin suscripciones/timers huérfanos | ídem · *la sonda de foreground se da de baja al desconectar* + *el watchdog muere con el link* + *el poll no se apila* |
| RMV5.5 nota 2 · **🔴-1** `connectToDevice` que no resuelve | ídem · *🔴-1: un connectToDevice que NO RESUELVE vence, y el connect() siguiente SÍ llega al nativo* |
| ídem · `requestBluetoothEnabled` que no resuelve | ídem · *🔴-1: un requestBluetoothEnabled que NO RESUELVE vence (el diálogo del SO no toma rehenes)* |
| ídem · `ensurePermissions` que no resuelve | ídem · *🔴-1: un ensurePermissions que NO RESUELVE vence y no deja el latch tomado* |
| ídem · `disconnect()` libera el latch | ídem · *🔴-1 (b): disconnect() LIBERA el latch aunque el intento siga colgado* |
| ídem · y liberarlo NO abre la ventana de dos intentos | ídem · *🔴-1 (b): un intento invalidado por disconnect+connect NO pisa la conexión nueva* |
| ídem · el diagnóstico nombra el await perdido | ídem · *🔴-1: el log de vencimiento nombra el await QUE se perdió* |
| ídem · el mecanismo en sí | `bridge-timeout.test.ts` (12 casos: vencimiento, rechazo tardío sin `unhandledRejection`, `onTimeout`, `onTimeout` que tira, presupuestos) |
| ídem · **guard sobre la ausencia** | `spp-bridge-timeout-guard.test.ts` (4 casos) |
| RMV5.5 · **🔴-2** evento global filtrado | `adapter-spp-android.test.ts` · *🔴-2: la desconexión de OTRO device Classic NO mata la conexión del bastón* |
| ídem · case-insensitive | ídem · *🔴-2: la desconexión de NUESTRA dirección sí desconecta (comparación case-insensitive)* |
| ídem · evento sin dirección | ídem · *🔴-2: un evento SIN dirección legible se acepta (la señal que teníamos, documentada)* |
| RMV5.5 nota 3 · **🟠-1** foreground al disparar (R6.9) | ídem · *🟠-1: si la app se fue a background entre armar y disparar, NO se conecta (R6.9)* |
| RMV5.5 nota 5 · ningún diálogo desde un timer | ídem · *un REINTENTO automático con el Bluetooth apagado no pide prenderlo, y sigue reintentando* |
| ídem · el gesto del operario sí lo pide | ídem · *un connect() DEL OPERARIO con el Bluetooth apagado sí pide prenderlo* |
| RMV5.5 nota 4 · **🟡-3** dwell del backoff | ídem · *🟡-3: un link que NO dura no resetea el backoff (flap: el delay crece entre ciclos)* + *🟡-3: una conexión que DURÓ resetea el backoff* |
| RMV5.5 · **🟠-2** connect a otro target | ídem · *🟠-2: elegir OTRO bastón mientras se conecta al primero se ATIENDE al terminar* (+ los dos casos de borde: sin target no encola; `disconnect()` descarta la cola) |
| RMV3.2 · **🟠-4** lista de emparejados | ídem · *🟠-4: dos listPairedSppDevices concurrentes son UNA sola llamada al nativo (coalesce)* + los 3 casos de awaits colgados (`getBondedDevices` / `ensurePermissions` / `requestBluetoothEnabled`) |
| RMV5.2 · **🟠-5** delimitador del driver | ídem · *🟠-5: el delimitador del driver es el que se le pide al nativo Y el que separa el payload* + *🟠-5: un driver con delimitador VACÍO no abre el socket* + *🟠-5: un driver sin `delimiter` cae al del RS420* |
| ídem · las piezas puras | `spp-protocol.test.ts` · 4 casos nuevos (`sppConnectOptions(delimiter)`, `sppDelimiterIsSupported`, `splitSppPayload` con delimitador ajeno / inválido) |
| RMV5.2 · **🟠-5** watchdog de mudez | `adapter-spp-android.test.ts` · *🟠-5: conectado sin un byte hace N s → queda ESCRITO* + *🟠-5: una lectura reciente NO genera el log de mudez* |
| RMV5.3 / RMV1.1 · **🟡-1** modo de ingesta | `adapter-ingest-mode.test.ts` (5 casos, incluido el guard de que el provider delegue) + `tsc` (el `satisfies`) |
| RMV3.1 / RMV4.8 · **BENCH-3** un solo consumidor | `app/e2e/baston-multivendor.spec.ts` (b) · *"Simular lectura" entra UNA sola vez: lista en vivo marcada DEMO, sin el sheet global encima* |
| R15 · los 5 kinds de log nuevos | `wiring.test.ts` · *R15.1/R15.2: logTransportEvent nunca tira* |
| **R6.4** · con device recordado + permiso + BT → conecta solo | `adapter-spp-android.test.ts` · *R6.4: con device recordado + permiso concedido + BT prendido → conecta SOLO, sin gesto* |
| ídem · arranque en frío no toca nada | ídem · *R6.4: SIN device recordado no toca NADA — ni la radio, ni los permisos, ni el estado* |
| ídem · BT apagado sin diálogo | ídem · *R6.4: con el Bluetooth APAGADO no muestra el diálogo de activar* |
| ídem · permiso: consulta, no pide | ídem · *R6.4: si el permiso NO está concedido, lo CONSULTA pero NO lo pide* + *si está concedido, el arranque NO vuelve a pedirlo* |
| ídem · R6.9 en el arranque | ídem · *R6.4/R6.9: en background el arranque no conecta ni consulta nada* |
| ídem · sin módulo nativo / sin storage | ídem · *sin módulo nativo … no rompe ni promete nada* + *un readRemembered que NO RESUELVE no cuelga el arranque* |
| ídem · idempotencia y ciclo del efecto | ídem · *dos autoConnect() … NO abren dos sockets* + *el ciclo autoConnect → disconnect → autoConnect termina CONECTADO* |
| ídem · falla igual que un gesto fallido | ídem · *un arranque que FALLA cae en el mismo estado que un connect por gesto fallido* + *reintenta al MISMO device recordado* |
| ídem · contraprueba: el gesto SÍ pide | ídem · *el gesto SÍ pide permiso y SÍ pide prender el BT* |
| ídem · el reintento tampoco pide permiso | ídem · *un REINTENTO automático con el Bluetooth apagado no pide prenderlo* (assert nuevo sobre `permissionCalls`) |
| ídem · piezas puras del check | `permissions-android.test.ts` · 6 casos (`classifyPermissionChecks` fail-closed, sin RN → 'unavailable') |
| ídem · **guards del call site** | `wiring.test.ts` · *el provider LLAMA a transport.autoConnect()* + *autoConnect la implementa SOLO spp-android* |

**Lo que NO tiene test y por qué**: el filtro de 🔴-2 en **device** (necesita un segundo device Classic
emparejado — unos auriculares; el mecanismo está leído en el Java y cubierto con dobles), el camino
positivo de `isSppNativeAvailable()` (🟡-2, ya en el backlog: el require de `react-native` es directo,
sin inyección), y la rama verdadera de `checkAndroidBluetoothPermissions` (mismo hueco que 🟡-2: el
require de RN es directo; la parte que DECIDE —`classifyPermissionChecks`— sí está testeada, y el
comportamiento real se ve en el device).

---

## 3. Autorrevisión adversarial (antes del reviewer)

Busqué, en este orden: desviaciones del spec · bugs y edge cases no testeados · gaps de seguridad ·
gaps offline-first/multi-tenant · **tests que pasan por la razón equivocada**. Lo que encontré y cerré:

1. **Un guard de tipos que no guardaba nada.** El ancla de exhaustividad de `ADAPTER_KINDS` estaba en
   el test, y `app/tsconfig.json` excluye `**/*.test.ts`. Movido a `adapter-selection.ts`. **Verificado
   ejecutando**: con `simulator` sacado del mapa, `tsc --noEmit` da `TS1360` + `TS7053`; con el ancla en
   el test, no daba nada.
2. **Dos guards estáticos que podían ser teatro.** Los mutantes: (a) sacarle el `withTimeout` a
   `getBondedDevices` → el guard de timeouts **falla** y nombra el archivo y la línea; (b) volver a
   poner `transport.kind === 'web-serial' || …` en el provider → el guard de ingesta **falla**.
   Restaurados los dos.
3. **Un test 🔴 que no probaba lo que decía.** *"disconnect() libera el latch"* pasaba igual con la
   generación de intento removida (una promesa que no resuelve nunca no puede pisar nada). Agregué
   *"un intento invalidado por disconnect+connect NO pisa la conexión nueva"* y lo validé con el
   mutante correcto (sacar el chequeo de generación después de `connectToDevice`): **falla**. De paso
   quedó medido que el `connectGeneration += 1` de `disconnect()` es **belt-and-braces** (el connect
   siguiente también la incrementa) — lo dejo porque hace `disconnect()` autosuficiente, pero no lo
   presento como el mecanismo que cierra el hueco.
4. **Un test que congelaba el bug.** *"una reconexión exitosa RESETEA el backoff"* congelaba el
   reset-sin-dwell como correcto (lo había marcado el reviewer). Reescrito en dos: uno con el link que
   **duró** y otro de flap que asserta la escalera `500 → 1000 → 2000`.
5. **Un fake que mentía.** El `schedule` inyectado no sacaba de la cola el timer que **ya había
   disparado**, así que un test no podía distinguir "se re-armó" de "quedó el viejo" (4 tests
   fallaron por eso y el diagnóstico fácil habría sido aflojar la aserción). Corregido el doble para
   que modele `setTimeout` real.
6. **Cuatro awaits del puente que me había salteado**: `readRemembered`, `writeRemembered`, el
   `device.disconnect()` del teardown y el del abort. Los encontró el guard que yo mismo escribí, al
   correrlo. El del teardown era el más filoso: un `disconnect()` que no volviera dejaba colgado el
   teardown, que es justo lo que deja el latch tomado.
7. **Un socket fantasma.** Un `connectToDevice` que vence y **después** resuelve dejaba el socket
   abierto en `mConnections` del nativo — y la sonda de liveness lo habría visto "vivo". De ahí el
   `onTimeout` de `withTimeout`.
8. **Un `'connected'` mentiroso de dos líneas.** Si un `disconnect()` entraba **durante** el
   `writeRemembered`, se suscribía `onDataReceived` sobre un socket ya cerrado y se emitía
   `'connected'`. Agregado el chequeo de generación/sesión después de ese await.
9. **Un diagnóstico que se pisaba a sí mismo.** El `catch` del tramo de conexión reportaba su propio
   label, así que un vencimiento de `connectToDevice` se logueaba como `connect_path`. Ahora, si el
   error **es** un vencimiento, gana el label del `withTimeout` que lo envolvió — el que sabe qué await
   se perdió. Con test.
10. **Un timer huérfano posible**: el poll de liveness re-armándose después de un teardown. Cubierto
    con dos tests (*el watchdog muere con el link*, *el poll no se apila*).
11. **Riesgo de MAC en distinto case.** La sonda usa el string **exacto** con el que se abrió el
    socket, porque esa es la clave del `mConnections` del nativo (`put(address, …)` usa el argumento
    tal cual). Si se conectara con una MAC en minúscula, el `remove(device.getAddress())` del ACL
    receiver —que usa la canónica en mayúscula— no matchearía y la sonda daría un `true` viejo. Hoy no
    pasa (todas nuestras MAC vienen de `getBondedDevices`, canónicas); queda escrito en el código.
12. **Un `useEffect` que habría suprimido el overlay en toda la app.** Ver el punto 9 de arriba:
    corregido a `useFocusEffect` **antes** de correr la E2E, por lectura del comentario de
    `useHardwareBack` (las pantallas del stack quedan montadas al navegar encima).
13. **Dos artefactos de test que aserraban el bug**: la spec E2E y la capture del Gate 2.5 esperaban que
    un bastonazo en `/baston` **abriera** el sheet global. Corregidos a la invariante nueva (ver §5).

### Segunda pasada (R6.4) — lo que encontré revisándome

14. **El gate que MATABA la feature que acababa de escribir.** `autoConnect()` empezaba con
    `if (this.closed || …) skip('busy')`, para "no reconectar a espaldas del operario". Suena prudente y
    es **al revés**: `closed` lo pone `disconnect()`, y `disconnect()` tiene dos call sites que
    significan cosas OPUESTAS — el gesto del operario, y **el cleanup del efecto del provider**. El
    único camino por el que `autoConnect()` puede volver a llamarse es justamente el segundo (efecto
    re-corriendo: StrictMode, cambio de `mode`, re-montaje), así que el gate **mataba R6.4 en silencio**:
    cleanup → `closed = true` → el arranque siguiente se abstenía y nada se ponía rojo. Y no compraba
    nada: en producción el efecto corre una sola vez (`mode` sale de globals constantes,
    `handleReading` es un `useCallback([])`), o sea que el caso que decía proteger es inalcanzable hoy.
    Lo saqué de los **tres** puntos donde lo había puesto (el gate inicial y los dos re-chequeos
    post-await). **Verificado ejecutando**: el test del ciclo `autoConnect → disconnect → autoConnect`
    falla con el gate puesto y pasa sin él; y el segundo `closed` (el de después de leer el storage) lo
    encontré **debuggeando** ese rojo, no leyendo — el primer fix no alcanzaba. La protección real es el
    **contrato** (`autoConnect()` se llama una vez al montar y NO es un reconectador genérico), escrita
    en `stick-adapter.ts` y en el código.
15. **Un hueco de diálogo que no estaba en el pedido**: la cadena de **reintentos** también llamaba
    `ensurePermissions` → `requestMultiple`, que sobre un permiso denegado una vez vuelve a mostrar el
    diálogo. O sea que el 🟠-1 de la primera pasada ("ningún diálogo del sistema desde un timer") estaba
    cerrado solo para el diálogo de Bluetooth, no para el de permisos. Cerrado, con un assert nuevo en
    el test del reintento.
16. **El orden de los gates era un requisito disfrazado de detalle.** Si el chequeo de permisos fuera
    antes que la lectura del device recordado, un arranque en frío (nadie eligió un bastón nunca)
    consultaría permisos igual. Los dos tests que lo fijan asertan `permissionChecks === 0`, así que un
    reordenamiento cae en rojo.
17. **El fallback de `isBluetoothEnabled` es distinto en los dos caminos, a propósito**: `false` en el
    arranque (la duda NO habilita a tocar la radio: nadie pidió nada) y `true` en `doConnect` (el
    operario pidió conectar; el error real lo da el connect). Lo dejé escrito en las dos, porque leído
    salteado parece una inconsistencia.
18. **Una consecuencia que el fix EMPEORA y no arreglé**: el ítem de backlog *"`scanning` sin CTA y sin
    tope"* ahora es alcanzable **sin ningún gesto** (bastón recordado que ya no existe → `Reintentando…`
    para siempre en cada apertura). No lo topeé porque el pedido dijo "el **mismo** backoff" y capear es
    una decisión de UX; lo escalé en el backlog con la opción barata (topear solo la cadena que arrancó
    sin gesto). Lo digo acá porque es el tipo de cosa que un fix no debería dejar pasar en silencio.

### Tercera pasada + fix-loop — lo que encontré revisándome

19. **El tope era evitable guardando el teléfono en el bolsillo.** El chequeo del presupuesto estaba en
    `scheduleReconnect` pero **no** en el callback del timer, donde el gate de foreground corría primero:
    un timer que dispara con la app en background se parqueaba en `waitForForeground()` **sin pasar por el
    tope**, y una cadena vencida quedaba de zombi esperando el retorno para volver a martillar. Lo
    encontró un test que escribí para el caso ("una cadena con presupuesto vencido MUERE aunque la app
    esté en background") y que falló contra mi propio código. **Verificado ejecutando** el mutante que
    invierte el orden: cae ese test.
20. **Un test mío medía 1 y parecía que la cadena moría.** `drainRetries` disparaba los timers en un loop
    **sincrónico**: el reintento arma el timer siguiente recién cuando su `connect()` asíncrono se
    asienta, así que sin soltar el event loop entre vuelta y vuelta el drenaje contaba 1. El diagnóstico
    fácil era aflojar la aserción; el correcto era arreglar el helper (`await flush()` entre vueltas).
21. **Dos tests del dwell tenían un atajo que dejó de ser equivalente.** Simulaban el flap llamando
    `adapter.connect(MAC)` en cada ciclo. Con el tope en escena, un `connect()` es un GESTO y arranca
    cadena **nueva** (backoff desde el piso, sin tope), así que el test medía 500/500/500 y parecía una
    regresión del dwell. Reescritos para disparar el TIMER (trigger `retry`), que es lo que hace el flap
    real, con la explicación en el propio test para que nadie vuelva al atajo.
22. **Lo que NO encontré yo, y es el aprendizaje de esta pasada.** Los 8 casos que escribí para el tope
    **no distinguían el bug del arreglo** (el mutante M7 del reviewer pasó 104/104), y ni el reviewer ni
    el Gate 2 tuvieron que buscar mucho: los dos reprodujeron el 🔴 con un probe propio, por separado. La
    causa está identificada y no es "me faltó un caso": **escribí los tests del mecanismo que estaba
    construyendo (¿el tope topea?) y no los del requisito que el mecanismo podía romper** (R6.4: "o el
    bastón recordado vuelve a estar en rango"). Los 5 casos nuevos están escritos desde el requisito, y
    el que valida que sirven es el mutante M7 re-corrido: ahora **falla 3**.
23. **Y una autocrítica de la que ya tenía el dato**: en la §6 de la pasada anterior escribí que este ítem
    "necesita decisión de Raf" y lo dejé en el backlog. El leader lo corrigió con el argumento correcto —
    no era una preferencia de UX, era un defecto que introducía mi propio cambio. Un fix que empeora un
    escenario que antes no existía no se escala: se arregla o se reporta como bloqueante, no como ítem de
    backlog.

### Pasada final — lo que encontré revisándome

24. **El guard que escribí para el invariante empezó mirando una carpeta.** El pedido decía "extendé el
    guard para que cubra los awaits del puente **fuera** del adapter", y mi primer impulso fue agregar dos
    archivos a la lista de escaneo. Eso habría sido la misma clase de error que el guard vino a cerrar:
    enumerar las instancias conocidas. La versión que quedó enumera **primitivas nativas** en un
    territorio, con la lista de bordes acotados verificada en las dos direcciones, así que lo que
    protege es el invariante y no los dos sitios de hoy.
25. **La lista de excepciones podía podrirse en silencio.** Una allowlist que nadie revisa termina
    cubriendo archivos borrados o ya arreglados. Le agregué la contraparte: el guard exige que cada
    excepción **exista** y que **siga siendo** una excepción (si alguien la arregla y no la saca, el guard
    dejaría de cubrirla sin avisar). Lo probé sacando el techo del borde y creando un archivo nuevo
    mutante: caen las dos mitades correspondientes.
26. **Casi dejé el techo en el call site en vez del borde.** El pedido daba las dos opciones (`withTimeoutOr`
    en el caller, o `void`). Elegí una tercera: acotar **dentro** de `remembered-device.ts`. Motivo: con el
    techo en el caller, el logout queda protegido **hoy** y el próximo call site vuelve a nacer roto —
    exactamente lo que acababa de pasar. Con el techo en el borde, el invariante se cumple por
    construcción y el guard solo tiene que verificar el borde.
27. **`stripSourceComments` blanquea preservando posiciones**, así que mis dos asserts de proximidad
    (`signOut … forgetRememberedDevice` dentro de N caracteres) fallaron por los cientos de espacios que
    dejó el comentario largo que yo mismo acababa de escribir. El diagnóstico fácil era subir la ventana;
    el correcto es medir distancia en **código** (colapsar el whitespace). Queda dicho porque es una trampa
    reusable para el próximo guard de proximidad de este repo.
28. **Lo que NO hice, y es deliberado**: no arreglé los 6 awaits de `SecureStore` pre-existentes fuera de
    spec 04 (`establishment-store`, `last-rodeo`, `lockout-store`, `pending-invitation`, `rodeo-store`,
    `feedback-pref`). El mecanismo ya está y es reusable, pero es una pasada aparte con su propio
    veredicto: quedaron **inventariados** en el backlog y **nombrados uno por uno** en la allowlist del
    guard, que es lo que impide que se confundan con "cubiertos".

**Offline-first**: nada de lo agregado toca la red (la sonda es una llamada al puente nativo; el
`writeRemembered` es SecureStore local). `offline-noread.test.ts` sigue verde. **Multi-tenant**: el
transporte no conoce `establishment_id` y no se agregó ninguna referencia. **Seguridad**: no hay
superficie nueva expuesta; el único export "de test" es `__resetSppModuleStateForTests()`, que solo
limpia dos slots de coalesce (su peor caso es des-coalescer).

---

## 4. Verificación

**Ejecutado:**

- `node scripts/check.mjs` → **RC=0**, *"All tests passed"* / *"Entorno listo"*. 18 suites con `fail 0`.
  **`check.mjs` NO incluye Playwright** (typecheck del cliente + unit del cliente + suites contra la DB
  remota).
- `npx tsc --noEmit` (app) → limpio. Y con un tsconfig temporal que **incluye** los tests y el e2e (que
  el del repo excluye), los únicos errores en archivos que toqué eran del entorno (`@types/node` fuera
  de scope, extensiones `.ts`); quedan 3 pre-existentes en `driver-registry.test.ts` /
  `selection-priority.test.ts` (`possibly undefined` en un `.find()`), que **no** son míos.
- Suites del camino SPP, contadas con la línea `ℹ pass` de `node --test`, una por archivo:
  `adapter-spp-android` **86** (era **39** en `dad711f`: +34 en la primera pasada, +13 de R6.4) ·
  `bridge-timeout` **12** (nuevo) · `spp-protocol` **17** (era 13) · `adapter-ingest-mode` **5** (nuevo) ·
  `spp-bridge-timeout-guard` **4** (nuevo) · `wiring` **14** (era 12; los 2 nuevos son los guards de
  R6.4) · `permissions-android` **13** (era 9).
  Todo el camino BLE junto (`app/src/services/ble/*.test.ts` + `connection-view.test.ts` +
  `with-bluetooth-classic.test.ts`) → **291 pass / 0 fail**.
- Los 3 archivos de test nuevos están **registrados** en la lista explícita de `scripts/run-tests.mjs`
  (un test que no corre da falsa confianza).
- **Mutación** — **8 mutantes**, los 8 dieron el rojo esperado y se restauraron (`cp` del original antes
  y después; `git status` limpio al final):
  1. sacarle el `withTimeout` a `getBondedDevices` → cae el guard de timeouts, nombrando archivo y línea;
  2. re-meter la comparación de literales en el provider → cae el guard de ingesta;
  3. sacar `simulator` de `ADAPTER_INGEST_MODE` → `tsc` da TS1360 + TS7053;
  4. sacar el chequeo de generación de después de `connectToDevice` → cae el test del intento stale;
  5. sacar el `connectGeneration += 1` de `disconnect()` → cae otro test (y así medí que ese `+= 1` es
     belt-and-braces, no el mecanismo que cierra el hueco);
  6. sacar el gate de "¿BT prendido?" de `autoConnect` → cae el test del diálogo;
  7. usar `ensurePermissions` en vez de `checkPermissions` en `autoConnect` → caen 2 tests;
  8. re-poner el gate `this.closed` en `autoConnect` → cae el test del ciclo del efecto.
  Y uno más de cobertura del guard: sacarle el `withTimeoutOr` al `isBluetoothEnabled` **de
  `autoConnect`** → el guard de timeouts lo caza también ahí (o sea: cubre el método nuevo, no solo el
  código que existía cuando lo escribí).
- **E2E de regresión**: `pnpm run e2e:build` + `npx playwright test e2e/baston-multivendor.spec.ts` →
  **4 passed** (contra el build final, re-corrido después del último cambio de código).
- **Capturas (Gate 2.5, ADR-029)**: `npx playwright test e2e/captures/baston-spp-bloqueantes.capture.ts
  e2e/captures/baston-multivendor.capture.ts --config playwright.capture.config.ts` → **2 passed**, 4 +
  6 PNG generados. El shot **`02-lectura-sin-sheet-encima`** es la prueba visual del fix: "Bastón
  conectado", "Lecturas (1)" con el EID + badge DEMO, y **nada encima**. Los `.capture.ts` se
  commitean; los `__shots__/*.png` están gitignored (`app/.gitignore:29`, verificado con
  `git check-ignore`) y **no** se agregaron. Borré dos PNG viejos (`04-find-or-create`,
  `07-indicador-global-chrome`) que sobrevivían de una corrida anterior para que el directorio no
  muestre evidencia que ya no se produce.
- `git status` limpio de churn espurio: **cero** `design/**/*.png` re-renderizados.

- **Fix-loop, verificación final** (todo re-corrido después de los 5 arreglos):
  - `node scripts/check.mjs` → **RC=0**, 18 suites con `fail 0`. **Un dato honesto**: la primera corrida
    dio **RC=1** con 2 rojos en `supabase/tests/edge/run.cjs` (`delete_account`, *"owner con 2do owner NO
    bloquea"*). **No es mío, y lo verifiqué en vez de suponerlo**: mi diff no toca `supabase/` (`git status`
    de ese path, vacío) y ese test llama a la edge function por `supabase-js`, sin importar código del
    cliente. Corrí la suite sola → **47 tests, 0 fail**, y el mismo test que había tardado **39,6 s** tardó
    **1,1 s**: firma de contención contra la DB remota compartida, no regresión. La corrida siguiente del
    check completo dio **RC=0**.
  - Camino BLE completo: **320 pass / 0 fail** (`adapter-spp-android` **102** · `connection-view` 30 ·
    `spp-protocol` 17 · `wiring` **17** · `permissions-android` 13 · `bridge-timeout` 12 ·
    `connect-trigger` 6 · `adapter-ingest-mode` 5 · `spp-bridge-timeout-guard` 4).
  - `tsc --noEmit` limpio. E2E `baston-multivendor.spec.ts` **4/4** y las 2 capturas **2/2**, contra un
    build nuevo posterior a todos los cambios.
  - **Mutantes del fix-loop (5 más, todos con el rojo esperado y restaurados)**: (1) **el M7 del reviewer**
    —revertir el fix del 🔴-A— ahora **falla 3 tests** (antes pasaba 104/104); (2) volver al no-op mudo en la
    puerta del latch → caen los 2 tests de 🟠-B; (3) cerrar el socket huérfano siempre, sin mirar el dueño →
    cae el test de MEDIUM-1; (4) sacar la limpieza del bastón recordado de `signOut` → cae el guard de R6.6;
    (5) partir un await del puente en dos líneas → **ahora sí** lo caza el guard de timeouts (era el límite
    ⚪-H que declaró el reviewer, cerrado colapsando el whitespace antes de escanear).

- **Pasada final, verificación** (después del techo en el borde + el guard del invariante + LOW-5):
  - `node scripts/check.mjs` -> **RC=0**, 18 suites con fail 0. `tsc --noEmit` limpio.
  - Camino BLE: **324 pass / 0 fail** (`spp-bridge-timeout-guard` pasó de 4 a **8** casos: las dos mitades
    del invariante + la contraparte de la allowlist + los call sites críticos).
  - E2E `baston-multivendor.spec.ts` **4/4** y la captura de la unidad **1/1**, contra un build nuevo.
  - **Mutantes (2 más, los dos con el rojo esperado y restaurados)**: (a) sacarle el techo al borde
    (`remembered-device.ts`) -> cae **MITAD 1** nombrando archivo y línea; (b) crear un archivo nuevo en el
    territorio con un `await SecureStore.getItemAsync()` pelado -> cae **MITAD 2**, o sea que lo nuevo nace
    en rojo. **Total de la unidad: 15 mutantes.**

**NO ejecutado:**

- **La suite E2E completa** (`pnpm e2e`, ~38 min). Corrí la spec afectada. Riesgo residual: otra spec
  que dependa de que el overlay se abra en `/baston` — busqué con `grep` todas las navegaciones a
  `/baston` en `app/e2e/` y son **4** (2 en `baston-multivendor.spec.ts`, 2 en los captures), todas
  cubiertas. Las ~70 specs restantes disparan el bastonazo desde otras pantallas (bridge mock), donde el
  overlay sigue intacto — y el test (d) de la spec multivendor es exactamente esa regresión, y pasa.
- **El banco en device** (T-MV.5.18). Es tu paso siguiente y el oráculo que importa.

**Predicciones falsables para el re-run del banco** (si alguna no se da, el fix no es lo que digo):

| # | oráculo | baseline `dad711f` | predicción con el fix |
|---|---|---|---|
| 1 | `BENCH1` (corte con la app minimizada) | ❌ *app dice 'Bastón conectado' · link=libre · lee=False* | ✅ al volver: **o** dice desconectado/Reintentando **o** ya reconectó; y `read` entra |
| 2 | `LATCH` (BT prendido por afuera sin contestar el diálogo) | ❌ *NO reconectó* | ✅ reconecta sola, sin diálogo colgado; en logcat `bluetooth_off_auto` repetido, no `requestBluetoothEnabled` |
| 3 | `flap 4 3000` | `attempt:0` × 4 | `attempt:0 → 1 → 2 → 3` (dwell de 30 s) |
| 4 | `E13` `drop` / `E14` `off 8000` | ✅ | ✅ (y la detección puede llegar por la sonda antes que por el evento) |
| 5 | `term cr` + `read 5` | conectado y mudo, **sin un solo log** | sigue mudo (el RS420 declara `\n`), pero a los ≥45 s aparece `connected_silent` en logcat |
| 6 | bastonazo en `/baston` | lectura + sheet global tapando | lectura en la lista, **sin sheet** |
| 7 | apagar unos auriculares BT con el bastón conectado | el bastón se desconecta solo | **la conexión sobrevive** (esto es el device-test que falta) |
| 8 | **arranque en frío** con el bastón recordado, BT prendido, permiso concedido, emulador arriba: matar la app (`am force-stop`) y abrirla **sin tocar nada** | queda en "Bastón sin conectar" hasta ir a Más → Bastón → tocar | **conecta sola en ~1-2 s**; en logcat un `connecting` → `connected` sin ningún gesto, y **cero** diálogos |
| 9 | ídem con el **Bluetooth apagado** | — | **ningún diálogo** de activar; la pantalla queda en "Bastón sin conectar" (no en "desconectado"); en logcat `autoconnect_skipped reason:bluetooth_off` |
| 10 | ídem después de `forget` del device recordado (o primera instalación) | — | **nada**: ni un log de permisos, ni un connect; solo `autoconnect_skipped reason:no_remembered` |
| 11 | revocar `BLUETOOTH_CONNECT` desde Ajustes y abrir la app | — | **ningún prompt de permisos** en el arranque; `autoconnect_skipped reason:permission`. Y al tocar "Conectar bastón" **sí** aparece el prompt |

| 12 | **COLD-CUT** (el que agregó el leader para el 🔴 del fix-loop): arranque en frío auto-conectado + **~140 s sanos** + `drop` | **reconecta** (`reconnect_attempt attempt:0` en logcat) — el presupuesto murió al conectar | cero reintentos + `autoconnect_exhausted attempts:0` → el fix del 🔴-A no llegó al build |
| 13 | con el emulador **apagado** (`off 120000` o desenchufado) y un device recordado | deja de reintentar a los **~2 min** y muestra CTA (*"No encontramos el bastón"*), con `autoconnect_exhausted` y `attempts` **> 0** | sigue reintentando para siempre → el tope no aplica; o `attempts:0` → el presupuesto se consumió esperando, o sea el 🔴-A de vuelta |
| 14 | 🟠-B: con el arranque contra un bastón ausente, tocar el **chip del header** mientras dice *"Conectando…"* | aparece `connect_reasserted` en logcat y la cadena **deja de tener tope** (sigue reintentando pasados los 2 min) | nada en logcat / se rinde igual a los 120 s → 🟠-B sigue abierto |
| 15 | **CAP** y **CAP-RESET** | ✅ los dos — pero **no sirven como oráculo del 🔴-A** (el reviewer avisó que pasan con el bug puesto). El oráculo es COLD-CUT | — |
| 16 | R6.6: tocar *"Olvidar el bastón guardado"* → force-stop → relanzar | el arranque **no intenta nada**: `autoconnect_skipped reason:no_remembered`. Y el botón **desaparece** de la pantalla | intenta conectar igual → el forget no llegó al storage |
| 17 | cerrar sesión → volver a entrar con OTRO usuario → force-stop → relanzar | idem: `no_remembered`. La MAC del turno anterior **no** se hereda | auto-conecta al bastón del usuario anterior → la limpieza del `signOut` no corre |

---

## 5. Reconciliación de specs (regla dura, hecha antes de reportar)

`specs/active/04-bluetooth-baston/`:

- **`requirements-multivendor.md`**
  - **RMV5.2** — **corregí una reconciliación anterior que era falsa** (🟡-4): decía *"el `frameParser`
    y el `pin` **sí** salen del driver"*. El `pin` lo devuelve `resolveSppParams` y **nadie lo
    consume** (va a la UI, no al transporte); el `frameParser` **no se usa en producción**
    (`contract.ingestRawLine` llama `parseRs420Line` hardcodeado, y el driver solo se invoca desde los
    tests) → **RMV1.6 no se cumple** con un segundo driver SPP de otro formato. Queda declarado como
    deuda (backlog), no como logro. Y se documenta lo que **sí** se agregó: el `delimiter`.
  - **RMV5.3** — el delimitador ya no es fijo; y la puerta de ingesta es una tabla exhaustiva.
  - **RMV5.5** — nota nueva con las **cinco** cosas que cambiaron (liveness, timeouts, foreground al
    disparar, dwell, ningún diálogo desde un timer), cada una con el defecto que cierra.
  - **RMV3.1** — la pantalla es **dueña** del bastón mientras está enfocada, con la justificación de
    por qué el scanner acotado y no `BLE_OWNED_ROUTES`, y por qué `useFocusEffect`.
  - **RMV3.2** — guard de re-entrada + awaits acotados en la lista de emparejados.
  - **RMV4.8** — en `/baston` la confirmación pre-commit es la lista de la pantalla; se explica por qué
    no se pierde nada del EARS (desde ahí no hay ningún camino de commit).
  - **RMV5.9** — reconciliación **(ter)**: el gate se corrió, el bastón lee en device, 18/21 de
    baseline; queda gated lo del RS420 físico + el device-test de 🔴-2.
- **`design-multivendor.md`** — §6 reescrita al as-built **2026-07-30**: el pseudocódigo del `connect()`
  ahora incluye la generación de intento, los `⏱` de cada await del puente, el chequeo del delimitador,
  la rama `auto` del Bluetooth apagado, el filtro del evento por dirección y el armado de la
  sonda/watchdog; más una §6-bis con las cuatro piezas nuevas y §2.1 con los archivos.
- **`tasks-multivendor.md`** — **T-MV.5.2** con nota de reconciliación (su enunciado citaba
  `LineFramer`, que es justo lo que el as-built **no** hace); **fase MV.5-bis nueva** con
  **T-MV.5.8 … T-MV.5.17** (todas `[x]`) y **T-MV.5.18** `[ ]` (re-correr el banco, con los oráculos
  que tienen que darse vuelta); **T-MV.7.2** con la reconciliación de los dos artefactos de test.
- **`tasks.md` (core)** — lo que 🟡-4 marcó: **T4.0/T4.1/T4.5/T4.6** y **T6.1/T6.2/T6.3** pasan a `[x]`
  (están construidas y verificadas), con una nota en cada fase explicando **por qué** las demás siguen
  abiertas (T4.2: el pairing programático se eliminó a propósito; T4.3: R6.4, aprobada por Raf, va en la
  pasada siguiente; T4.4/T4.7: hardware).

**Tercera pasada + fix-loop** (el tope, y los 5 arreglos del review + Gate 2):

- **`requirements.md` (core), R6.4** — la nota del tope (los tres triggers, los 120 s justificados contra la
  escalera de backoff, qué pasa al agotarse) **más la CORRECCIÓN del fix-loop**: la política estaba definida
  solo por *origen* de la cadena y era ambigua justo donde estaba el defecto. Ahora dice el invariante:
  *el presupuesto pertenece a la cadena, y una cadena que llegó a `'connected'` terminó*. Con el escenario
  medido que lo motivó y con la nota de que un tap del operario **siempre** destopa.
- **`requirements-multivendor.md`, RMV5.5** — nota 4 ampliada (el contador también vuelve al piso cuando
  arranca una cadena nueva, con el aviso del modelo: un `connect()` es un gesto, el flap real lo dispara el
  timer) + el párrafo de la tercera pasada (la tabla de triggers, que reemplazó al booleano `auto`, y el
  `autoConnectExhausted` opcional en `ConnectionEnv`).
- **`design-multivendor.md`** — §6-quater nueva (la tabla de triggers, el por qué de los 120 s,
  `exhaustUnpromptedChain`, el guard de call sites) **+ los dos bullets del fix-loop** (el presupuesto muere
  al conectar, con el invariante; y el tap que siempre destopa) + `scheduleReconnect` reescrito con el orden
  tope→foreground y la nota de por qué ese orden. Y **🟡-F cerrado**: §6-ter documentaba un gate por
  `this.closed` que el código **deliberadamente no tiene** (lo saqué en la 2ª pasada porque mataba R6.4 en
  silencio) — ahora el pseudocódigo lo dice, con el motivo.
- **`tasks-multivendor.md`** — **T-MV.5.20** (el tope) y **T-MV.5.21** (el fix-loop); **T-MV.5.18** con las
  predicciones falsables nuevas para el banco; **🟡-E cerrado**: los números de T-MV.5.17 estaban mal (el
  *"39 → 71"* mezclaba pasadas y el *"bridge-timeout (13)"* eran 12) → corregidos **con el método escrito**
  y con los totales al cierre; **T-MV.5.7 cerrada** apuntando al informe que la cerró de verdad
  (`bench_baston-spp-emulador.md`), incluidos los dos sub-escenarios que dieron hallazgos y no verdes.
- **`docs/backlog.md`** — **🟡-G cerrado**: el ítem de `scanning` pasó a *"RESUELTO A MEDIAS"*, con lo que se
  hizo y con lo que queda **como decisión tomada** (la cadena del operario no tiene tope ni CTA a propósito).
  Y **MEDIUM-3** (acumuladores sin cota) entró como ítem nuevo, unificado con el ⚪-3 de la review anterior.
- **`progress/impl_baston-android-spp.md`** — **🟡-D cerrado**: los **6 placeholders** vacíos de `dad711f`.
  Tres se **reconstruyeron con evidencia** (el build de Gradle, la reconciliación de specs, el gate de
  hardware con una tabla de cómo se movió) y tres se marcaron **IMPOSIBLE DE RECONSTRUIR con el motivo** —
  incluido el más importante: la autorrevisión de esa pasada **nunca se hizo** (el agente murió antes del
  paso 8), y eso es lo que dice, en vez de un relleno. Inventar un output que no se corrió sería peor que
  el vacío.
- **`app/e2e/captures/baston-spp-bloqueantes.capture.ts`** — **🟠-C cerrado**: el encabezado afirmaba que el
  único cambio visible era BENCH-3, y con la tercera pasada + el fix-loop hay **dos más**. Los dos quedan
  declarados **N/A del E2E web con el motivo estructural** y con el precedente que esta misma spec ya fijó
  en T-MV.7.2: el estado *"No encontramos el bastón"* sale de `transport.autoConnectExhausted`, que **solo
  existe en `SppAndroidAdapter`** (en web el transporte es `mock`/`simulator`), y el CTA *"Olvidar"* vive en
  el bloque `isSpp`, que en web no se renderiza. Renderizarlos exigiría cambiar producción para poder
  sacarles una foto. La lógica sí está cubierta (4 tests puros del copy/CTA/tono/no-contaminación) y lo que
  el veredicto visual habría agregado —que el hint largo no recorte— está cubierto por construcción
  (`lineHeight` matcheado, sin `numberOfLines`).
- **⚪-H cerrado** (no era obligatorio): el guard de timeouts escaneaba **por línea**, así que un
  member-expression partido en dos se le escapaba. Ahora colapsa el whitespace antes de escanear, y lo
  verifiqué con un mutante partido en dos líneas.
- **⚪-I anotado** en el código: `pendingTarget` promueve a `operator` cualquier target encolado, y la
  ventana en que un `retry` podría colarse por ahí es angosta (el `doConnect` cancela el reintento pendiente
  en su segunda línea) y su efecto es el comportamiento pre-fix, no una mudez.

Fuera de las specs:

- **`firmware/baston-emulator/README.md`** — la fila `flap` volvió a "backoff creciente", **con la
  historia de las dos veces que estuvo mal escrita** (primero sin medir, después medida y falsa) y
  marcada como pendiente de re-medir en device.
- **`docs/backlog.md`** — tres deudas nuevas que dejó este fix: (1) el `frameParser` sin usar
  (RMV1.6 incumplida), (2) `scanning` sin CTA y sin tope de reintentos, (3) `/baston` sin entrada
  in-app (que es lo que tiró abajo la captura `07`).
- **`scripts/run-tests.mjs`** — los 3 archivos de test nuevos, en la lista explícita.

**Segunda pasada — R6.4** (hecha después del pedido del leader, en esta misma sesión):

- **`requirements.md` (core), R6.4** — nota de reconciliación con el as-built **y con la regla que el
  EARS no decía** ("el arranque no pide nada"): los cuatro gates y su orden, el "no se emite ningún
  estado" al saltear (con el argumento de por qué `'off'` y no `'disconnected'`), y el log de los seis
  motivos. Es la nota más larga porque es donde vive el requisito.
- **`tasks.md` (core), T4.3** — pasa a `[x]` con la nota del as-built; y la nota de la Fase 4 se
  actualizó (ya no dice "va en la pasada siguiente").
- **`requirements-multivendor.md`, RMV5.5** — la nota 5 se **amplió**: "el diálogo del sistema nunca sale
  de un timer" ahora incluye el de **permisos** (no solo el de Bluetooth), con el motivo técnico
  (`requestMultiple` re-muestra el diálogo sobre un permiso denegado una vez) y con por qué
  `checkPermissions` es un campo **obligatorio** del `SppEnv`. Más un párrafo con lo que R6.4 le toca a
  este delta: `autoConnect` opcional en `StickAdapter`, implementado solo por spp-android, con el motivo
  de cada uno de los otros cuatro (y por qué eso deja las ~70 specs E2E sin riesgo).
- **`design-multivendor.md`** — §6-ter nueva con el pseudocódigo de `autoConnect()` (los cuatro gates y
  el `skip()` que no emite estado), el paso 3 del flujo de `connect()` actualizado (check vs request), y
  §2.1 con los archivos tocados.
- **`tasks-multivendor.md`** — **T-MV.5.19** nueva (`[x]`), y la nota de la fase MV.5-bis ya no dice que
  R6.4 queda afuera.
- **`docs/backlog.md`** — el ítem de `scanning` sin CTA **escalado**, porque R6.4 lo vuelve alcanzable sin
  ningún gesto (ver §1.10).

---

## 6. Dudas abiertas

0. **La consecuencia de R6.4 que subí de severidad en el backlog** (§1.10, punto 18 de la autorrevisión):
   un bastón recordado que ya no existe hace que la app arranque en `Reintentando…` **para siempre, en
   cada apertura, sin que nadie toque nada**, y no hay botón para frenarlo. No lo topeé porque el pedido
   fue "el **mismo** backoff" y capear es UX. **Es la decisión que hay que llevarle a Raf**, y la opción
   barata es topear solo la cadena que arrancó sin gesto.

1. **El poll de 15 s en background.** Hoy corre también minimizado (si el proceso no está congelado; si
   lo está, dispara al descongelar, que es justo cuando queremos). Es una llamada al puente cada 15 s
   con un RFCOMM abierto: irrelevante al lado del socket. Pero **no lo medí en device**. Si el banco
   muestra consumo raro, subirlo a 30 s cuesta un número.
2. **El `prompt` de 30 s** es un juicio, no un dato: es cuánto tiempo aceptamos quedarnos rehenes de un
   diálogo del SO antes de devolverle el CTA al operario. Si en el banco el diálogo tarda más en
   contestarse de lo que un humano tarda, hay que subirlo.
3. **`scanning` sigue sin CTA y sin tope de reintentos** (backlog). Con los timeouts, `connecting` ya
   está acotado; lo que queda es que con el bastón apagado la app reintente cada 8 s para siempre sin
   que el operario pueda frenarla. Es decisión de UX y **necesita a Raf**: en la manga, reintentar solo
   es lo que uno quiere; frenar es lo raro. ¿Vale un "Cancelar"?
4. **`LINK_DWELL_MS` = 30 s** es un número elegido, no medido: más que cualquier ciclo de flap
   patológico y mucho menos que una jornada. Si el bastón real corta cada ~20 s por radio, el backoff se
   queda en 8 s (que es lo deseable), pero recién el banco con el RS420 lo va a decir.
5. **El evento sin dirección se ACEPTA.** Elegí un teardown de más antes que un "conectado" mentiroso,
   apoyado en que la sonda cubre el falso positivo. El Java siempre manda el device, así que en la
   práctica no debería pasar; si en el banco aparece un flap inexplicable, este es el primer lugar donde
   mirar.
6. **La captura `07-indicador-global-chrome` se cayó** y no la reemplacé por una peor. Vuelve cuando
   "Más" tenga la fila a `/baston` — que además es lo que hace la pantalla alcanzable para alguien que
   no escribe URLs. `mas.tsx` es de la otra terminal: **no lo toqué** (colisión-safe).
7. **El device-test de 🔴-2** necesita un segundo device Classic emparejado en el A07. Un minuto de Raf
   con unos auriculares, y es el único de los tres 🔴 que no tiene evidencia en device.
8. **R6.4 y el `disconnect()` con dos significados.** Hoy `disconnect()` es el gesto del operario **y**
   el cleanup del efecto del provider, y no se distinguen. Eso alcanza porque `autoConnect()` se llama
   una sola vez, al montar. Si alguna vez se lo llama también **al volver a foreground** —que es una
   extensión plausible de R6.4 y encajaría con la sonda de liveness que ya está ahí—, esa pasada tiene
   que resolver primero cómo distinguirlos, o va a reconectar a espaldas de un operario que desconectó a
   propósito. Está escrito en el código, en el punto donde importa.
9. **`autoConnect` es opcional en `StickAdapter`** y hoy solo spp-android la implementa. `wiring.test.ts`
   fija esa tabla con el motivo de cada uno, así que un adapter nuevo que la necesite va a tener que
   tocar el test y justificar. Lo que ese guard NO puede ver es un adapter nuevo que **debería**
   auto-conectar y se olvida: eso queda en la lectura del reviewer.
