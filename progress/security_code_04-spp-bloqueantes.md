# security (modo `code`) — bloqueantes del camino Bluetooth Classic SPP (feature 04, bugfix)

**Veredicto: FAIL** — 1 HIGH.

- Gate: 2 (ADR-019), modo `code`.
- Baseline: `c252b72c86826965f82aeb59264d2521adebba46` + cambios sin commitear del árbol.
- Skill: `sentry-skills:security-review` invocada (metodología aplicada: trazar data flow + verificar
  explotabilidad ANTES de reportar). **No devolvió findings HIGH propios** en las categorías clásicas
  (inyección, XSS, deserialización, SSRF, secretos, authz) — ver §"False positives / descartados".
  El HIGH de este informe salió del checklist RAFAQ-específico + un repro ejecutado, no de la skill.
- `supabase/` **vacío en el diff** (verificado: `git diff --stat -- supabase/` y
  `git status --porcelain -- supabase/` no devuelven nada). Sin schema, sin RLS, sin Edge Functions,
  sin migraciones. Los dominios A (service-role / mass assignment / IDOR), B1/B3 (respuestas al
  cliente), D1 (service_role en el bundle) y H (auth/sesión) **no aplican a este diff**.

**Método** (regla dura del rol): distingo explícitamente **lo leí** de **lo ejecuté**.
Lo ejecutado en esta pasada:
- `node --test` de las 11 suites puras del camino BLE → **228 pass / 0 fail** (no corrí
  `check.mjs`: lo estaba corriendo el reviewer).
- Un **repro propio** del HIGH-1, escrito en el scratchpad (fuera del repo, read-only sobre el
  código) → falla contra el código actual. Output pegado abajo.
- Grep de los patrones "always flag" de la skill sobre `app/src/services/ble` +
  `app/src/features/ble-stick`: cero `eval`/`new Function`/`innerHTML`/`dangerouslySetInnerHTML`/
  `child_process`/`fetch`/secretos hardcodeados.

---

## HIGH

### [HIGH-1] El tope de la cadena `autoconnect` no se limpia al conectar → el primer corte pasados 120 s del arranque MATA la reconexión automática, y lo hace en el único estado que el chrome oculta

**Pertenece a la tercera pasada** (la que llegó sin autorrevisión, tal como avisó el leader).
Categoría: `RAFAQ-SPECIFIC` — pérdida silenciosa de captura de datos regulados (integridad de la
declaración SENASA por omisión, no por dato falso).

**Ubicación**: `app/src/services/ble/adapter-spp-android.ts:459` (declaración),
`:669-677` (`applyChainPolicy`, **único** lugar que lo setea), `:1065-1068` (el chequeo, primero en
`scheduleReconnect`), `:1140-1142` (`unpromptedBudgetSpent`), `:1144-1152`
(`exhaustUnpromptedChain`). El camino de éxito (`:846-911`) **no lo toca**.

**El defecto**: `retryBudgetUntil` se fija una vez al arrancar la cadena `autoconnect`
(`chainStartedAt + 120_000`) y **nunca se limpia cuando la conexión se establece**. Como el
presupuesto se mide en tiempo de pared desde el arranque de la app y la cadena "vigente" no muere al
conectar, el presupuesto sigue armado durante toda la sesión. El **primer** corte del link posterior
a los 120 s del arranque entra a `scheduleReconnect()` → `unpromptedBudgetSpent()` es `true` →
`exhaustUnpromptedChain()` → **cero reintentos** y `emitStatus('off')`.

```ts
// :1058-1068
private scheduleReconnect(): void {
  if (this.closed || this.cancelScheduled != null || this.unsubForeground != null) return;
  // TOPE de la cadena que NADIE pidió (R6.4). Va ANTES del gate de foreground a propósito: …
  if (this.unpromptedBudgetSpent()) {
    this.exhaustUnpromptedChain();
    return;
  }
```

**Escenario de falla (el normal, no un borde)**: el operario abre la app al llegar al campo, R6.4
conecta sola en 1-2 s, trabaja. A los 10 minutos el bastón se va de rango un segundo (o se apaga y
se prende, o el ACL se cae — el caso que BENCH-1/`E13 drop`/`E14 off` documentan como cotidiano).
Desde ese momento: **la app no vuelve a reintentar en toda la sesión**, el estado es `'off'`, y
`StickStatusIndicator.tsx:107` (`if (status === 'off') return null;`) **oculta el pill del chrome**.
El operario sigue bastoneando en la manga y no entra nada, sin un solo indicio en pantalla. Las
lecturas perdidas son identificaciones que hay que declarar ante SENASA en 10 días hábiles.

Es exactamente el síntoma que esta unidad vino a cerrar (el "Bastón conectado" mentiroso), corrido
un paso: ahora no miente el estado, miente la ausencia de estado.

**Evidencia ejecutada** (repro en el scratchpad, no en el repo):

```
[ble] autoconnect_exhausted {"kind":"autoconnect_exhausted","ms":600000,"attempts":0}
  statuses: connecting -> connected -> disconnected -> off
  reintentos programados: 0
  autoConnectExhausted: true
✖ REPRO: autoconnect OK + corte a los >120 s → NO reconecta (queda en off)
  AssertionError: DEBERÍA reintentar tras un corte de un link ya establecido → 0 !== 1

✔ CONTRASTE: mismo corte, pero a los 30 s (dentro del presupuesto) → sí reconecta
```

Fijate en `attempts:0`: el presupuesto se consumió **sin un solo reintento**, esperando. El log dice
"agotamos 600 s de intentos" cuando en realidad el link estuvo sano 10 minutos.

**Por qué la suite no lo ve**: los 8 casos nuevos de `TOPE:` en `adapter-spp-android.test.ts`
(:1612-1800) cubren la cadena que **nunca conectó** y la cadena del **operario**. El caso
"`autoConnect` conectó y el link se cae después" no está: el único test con un link establecido
(`:1779` *"un corte DESPUÉS de una conexión del operario no hereda ningún tope"*) usa
`adapter.connect(MAC)` — trigger `operator`, presupuesto `null`. La contraparte con `autoConnect()`
es la que falta, y es la que ahora es el camino por defecto de cada apertura.

**Contradice la intención escrita**, no solo mi criterio: `docs/backlog.md` (ítem nuevo de esta
unidad) propone *"topear la cadena que arrancó **sin gesto** y dejar **sin tope** la que arrancó con
una conexión establecida"*. La mitad implementada es la primera. Y la nota de R6.4
(`specs/active/04-bluetooth-baston/requirements.md:119-128`) justifica el número contra un escenario
explícito —*"abrí la app, caminé hasta la manga y prendí el bastón un minuto después"*— que ya está
satisfecho en el instante en que el bastón contesta: una vez que conectó, el bastón **existe**, y el
motivo del tope ("ese bastón lo vendí") dejó de aplicar.

**Fix recomendado** (decisión del implementer, pero el invariante es uno): el presupuesto tiene que
morir con la razón que lo justifica. Concretamente, limpiar `this.retryBudgetUntil = null` en el
punto donde el link se establece (junto a `this.connectedAt = this.now()`, `:848`, o antes de
`emitStatus('connected')`, `:911`); o, si se quiere conservar un techo para el flapping, re-armar un
presupuesto nuevo **desde el corte** en vez de arrastrar el del arranque. Lo que no puede quedar es
un campo de vida indefinida mutado en dos lugares sin invariante.

Además:
1. **Test que falta**: `autoConnect` OK → corte a los N > 120 s → **reintenta** (y su contraprueba a
   los 30 s, que ya pasa). Sin ese par, el fix se puede volver a perder.
2. **Reconciliar la spec**: la nota de R6.4 define la política solo por *origen* de la cadena y no
   dice nada del caso post-conexión, así que hoy la spec es ambigua justo donde está el defecto.
3. Mirar de paso el log: `autoconnect_exhausted` con `ms:600000 attempts:0` es un diagnóstico
   engañoso (mide desde el arranque de la cadena, no desde el corte).

---

## MEDIUM

### [MEDIUM-1] La limpieza tardía del `connectToDevice` vencido desconecta **por dirección** → puede cerrar el socket que el reintento siguiente acabó de abrir

**Ubicación**: `app/src/services/ble/adapter-spp-android.ts:826-831`.

```ts
const device = await withTimeout(pending, this.ms('connect'), 'connect_to_device', () => {
  void pending.then((d) => d?.disconnect?.()).catch(() => undefined);
});
```

El `onTimeout` es correcto en su intención (cerrar el socket fantasma del intento abandonado), pero
**no está acotado a la generación/sesión del intento que lo armó**, y —leído en la lib instalada—
`device.disconnect()` no cierra *ese* socket: cierra el de **esa dirección**
(`app/node_modules/react-native-bluetooth-classic/lib/BluetoothDevice.js:54-55` →
`this._bluetoothModule.disconnectFromDevice(this.address)`).

Secuencia: el intento A vence a los 20 s; el backoff dispara B ≤ 8 s después; B conecta y emite
`'connected'`; A resuelve tarde (el nativo no respeta el timeout — está declarado en
`bridge-timeout.ts`) y su handler cierra la conexión **de la misma MAC**, que ahora es la de B. La
app queda diciendo "Bastón conectado" con el socket cerrado. Acotado a ≤ 15 s por el poll de
liveness (que es precisamente el mecanismo que esta unidad agregó), así que no es HIGH — pero es la
interacción no testeada entre dos mecanismos nuevos, y el síntoma es el mismo que BENCH-1.

**Fix**: capturar `gen`/`session` en el closure y no desconectar si ya hay un intento posterior
vigente sobre la misma dirección (`this.device != null && sameAddress(this.currentDeviceId, target)`).

### [MEDIUM-2] El device recordado se persiste **antes** de saber si conecta, sobre cualquier emparejado, no se puede olvidar, no se limpia al cerrar sesión — y desde R6.4 dispara una conexión RFCOMM **sin gesto** en cada apertura

Esto responde al foco 3. El dato en sí es pre-existente; lo que cambia esta unidad es que **ahora se
lee y se actúa sobre él en el arranque, sin intervención humana**, lo que sube el impacto de cada
pieza:

| pieza | dónde | qué |
|---|---|---|
| se persiste antes de conectar | `StickConnectionScreen.tsx:250-256` | `void writeRememberedDevice(device.id)` y **después** `transport?.connect(device.id)`; el resultado del connect no revierte nada |
| cualquier emparejado es tappable | `StickConnectionScreen.tsx:366` (`allowUnrecognized: true`) + `connection-view.ts:277-285` + `StickDeviceRow.tsx:43` | un device que NINGÚN driver reconoce sale `actionable: true` — auriculares, el estéreo de la camioneta, otro teléfono |
| clave global, sin scope | `remembered-device.ts:11` (`'rafq.ble.remembered_device'`) | no está scopeada por usuario ni por `establishment_id` |
| no hay forma de olvidarlo | `forgetRememberedDevice` (`remembered-device.ts:52`) **no tiene un solo call site** en `app/src` ni `app/app` | R6.6 ("olvidar") no está cableada |
| sobrevive al logout y a la baja | `AuthContext.tsx:157` (`signOut`) y `services/account.ts` no la borran | la MAC queda en SecureStore indefinidamente |

**Consecuencias concretas**:
1. **Conexión no solicitada a un device arbitrario**: la app abre un RFCOMM SPP, en el primer frame
   y sin gesto, contra la MAC que quedó guardada — que puede no ser un bastón. Con el HIGH-1 sano,
   además reintenta hasta 120 s por apertura.
2. **Integridad del EID (foco 1) por el borde del canal**: lo que ese device escupa entra por
   `processRawLine` como si fuera el bastón. Si alguna línea matchea
   `^1000000(\d{15})\d{12}$` (`parser-rs420.ts:56`), se presenta al operario como lectura **REAL**
   (sin badge DEMO — `readingBadge` solo marca `kind === 'simulator'`), a un tap de convertirse en un
   animal declarable. **Lo que sí sigue en pie**: el bond de Bluetooth es obligatorio (`secure: true`
   en `spp-protocol.ts:93`, RFCOMM autenticado/cifrado, exige emparejamiento previo) y la
   confirmación visual pre-commit sigue intacta. Por eso es MEDIUM y no HIGH: hace falta que el
   teléfono esté emparejado con el device y que el operario confirme.
3. **Privacidad / multi-tenancy (catálogo C3/I1)**: identificador de hardware de un tercero
   persistido sin caducidad, sin scope de usuario y sin camino de borrado; en un teléfono compartido
   (cambio de turno del peón, celular prestado) el usuario B arranca auto-conectando al bastón de A.

**Modelo de confianza del canal (catálogo G2) — no documentado para el camino automático**: no hay
handshake ni verificación de que el peer sea el lector (ni por nombre ni por primera trama). La spec
declara el modelo para el camino con gesto ("dejamos probar cualquier emparejado porque la regex del
nombre es una hipótesis" — decisión razonable y escrita), pero **no** para el camino que ahora corre
sin nadie mirando.

**Fix recomendado** (barato, tres líneas y una decisión):
- persistir el device recién **después** del `'connected'` (mover el `writeRememberedDevice` de la
  pantalla al éxito del adapter, que ya lo hace en `:852-858` — el de la pantalla es redundante);
- no auto-conectar a un device que nunca llegó a `'connected'` (basta con la regla anterior);
- limpiar la clave en `signOut` y en la baja de cuenta; cablear "olvidar" (R6.6);
- scopear la clave por usuario, o dejar escrito por qué global está bien.

### [MEDIUM-3] Acumuladores sin cota en el camino de ingesta (pre-existente; el autoconnect les da más ventana)

Foco 4. Lo verifico y lo acoto, porque parte de la nota abierta es imprecisa:

- **El camino SPP ya no tiene framer propio sin cota**: `splitSppPayload`
  (`spp-protocol.ts:107-111`) es **stateless** — no acumula nada entre payloads. El `LineFramer`
  (`line-framer.ts:11-28`, buffer sin límite) **ya no se usa en el camino SPP**; queda solo en
  web-serial. El `StringBuffer` del nativo es Java y está fuera de alcance desde JS (correctamente
  declarado como irreparable en el informe del implementer).
- **Sin ReDoS**: los tres regex del parser están anclados y son lineales (`parser-rs420.ts:36`,
  `:56`, `:74`); un payload gigante falla en el carácter 8 sin backtracking. Verificado leyendo.
- **Lo que sí crece sin cota** (todo pre-existente, ninguna línea de este diff):
  `TagDedup.lastEmittedAt` (`dedup.ts:26`) es un `Map` que nunca se poda y cuyo `reset()` no tiene
  call site en producción — un peer que emita EIDs válidos distintos lo hace crecer indefinidamente;
  y la lista `reads` de `/baston` (`StickConnectionScreen.tsx:186`) se prepende sin tope, con un
  re-render por lectura.
- **Timers: limpios**. Revisado uno por uno: `withTimeout` limpia su `setTimeout` en las dos ramas
  (`bridge-timeout.ts:119`, `:125`); el poll del watchdog no se apila (guard `cancelWatchdog != null`
  + re-arm solo con sesión vigente, `:995-1010`) y muere en `teardownStreams` (`:1179-1186`);
  `unsubLiveness` idem. **No encontré un timer huérfano.**

Los dos acumuladores sin cota son **foldeables al backlog** (agregar poda por ventana al `TagDedup` y
un tope a `reads` son cambios de una línea cada uno, y no son de esta unidad).

---

## LOW (anexo — foldeables al backlog)

1. **MAC y mensajes del SO en logcat.** `logging.ts:22` (`connect_superseded` con `deviceId`, nuevo
   en este diff) loguea la MAC en claro, y `adapter-spp-android.ts:284` loguea
   `errorMessage(error)` crudo del nativo (que en algunos caminos de Android incluye la dirección:
   `"<mac> is not a valid Bluetooth address"`). **Verificado que NO hay sink remoto**: no hay Sentry
   ni ningún override de `console` en `app/src` (el único match de "Sentry" está en tests), y
   `app/babel.config.js` no aplica `transform-remove-console` → los logs quedan en logcat también en
   release. Exposición real: `adb` con depuración USB o una app de sistema con `READ_LOGS`. Bajo, y
   es la MAC del periférico, no del teléfono. Fix barato si se quiere cerrar: ofuscar a los últimos
   dos octetos y loguear un código en vez del mensaje del SO.
2. **El formato del EID no tiene validación autoritativa server-side.** La regla FDX-B (15 dígitos)
   la enforcea solo el cliente (`isValidTag`, `parser-rs420.ts:72`). En la DB,
   `animals.tag_electronic` es `text` con un `CHECK` de **largo** (≤64, migración
   `0070_check_text_length_caps.sql`, y en esa columna quedó `NOT VALID` sin `validate`), sin `CHECK`
   de formato. Es **pre-existente y fuera de este diff** (que no toca `supabase/`), y no es motivo
   del FAIL — pero para un dato regulado que se declara ante SENASA, el control autoritativo del
   formato hoy no existe. Vale como ítem de backlog con nombre propio.
3. **`BLUETOOTH_SCAN` declarado y no usado** (`app/plugins/with-bluetooth-classic.js:40`, con
   `neverForLocation`; el código nunca descubre). Fuera del diff. Higiene de la ficha de Play.
4. **El poll de liveness corre en background** (`armWatchdog` no gatea por foreground; `verifyLiveness`
   hace una llamada al puente cada 15 s). No abre conexiones —la reconexión sigue siendo
   foreground-only— así que no viola R6.9, pero es consumo no medido en device. El implementer ya lo
   tiene como duda abierta #1; queda como tal.

---

## Tabla de inputs (campos que el usuario tipea)

| campo | límite (largo/charset/formato/rango) | validación | OK? |
|---|---|---|---|
| — | — | — | — |

**Este diff no agrega ni modifica ningún formulario, buscador, campo de texto libre ni prompt.** La
pantalla de conexión solo tiene botones y una lista; la lista de lecturas es de solo lectura. No hay
inputs de usuario que validar, así que la regla de "límite + validación autoritativa por cada campo"
no tiene sujeto en esta unidad. Enumero abajo las entradas **no tipeadas** que sí toca, porque son
las que traen datos de afuera:

| entrada externa | límite | validación | OK? |
|---|---|---|---|
| payload SPP (`onDataReceived`) | sin cota de largo previa; formato acotado por `^1000000(\d{15})\d{12}$` | `splitSppPayload` → `ingestRawLine` → `parseRs420Line` + `isValidTag`, **sin cambios** en esta unidad | sí (con MEDIUM-3 sobre la ausencia de cota de largo y MEDIUM-2 sobre el origen del payload) |
| delimitador del driver | `sppDelimiterIsSupported`: string no vacío | chequeo honesto que **corta la conexión** con log (`adapter:722-729`) en vez de abrir en modo crudo | sí |
| MAC del device recordado (storage local) | `safe()` al **escribir** (`[^A-Za-z0-9._:-]` → `_`) | **ninguna al leer**; se pasa tal cual a `connectToDevice` | parcial — el nativo rechaza una MAC inválida y el error se captura, pero ver MEDIUM-2 |
| evento global `DEVICE_DISCONNECTED` | — | filtrado por dirección case-insensitive; evento sin dirección se **acepta** (decisión escrita, cubierta por la sonda) | sí |

## Tabla de rate limits

| acción abusable | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| reintentos de conexión de la cadena `autoconnect` | **sí** (120 s de presupuesto de tiempo, `UNPROMPTED_RETRY_BUDGET_MS`) | por cadena (origen del intento) | sí (deja de reintentar y emite `'off'`) | **el control funciona de más**: ver HIGH-1 — también mata la cadena que ya había conectado |
| reintentos de la cadena `operator` | no (por diseño declarado) | — | n/a | decisión escrita en spec: el operario está tratando de conectar; abandonarlo es peor. Backoff topeado en 8 s |
| poll de liveness | período fijo 15 s | por conexión | n/a | un `containsKey` del otro lado del puente |
| watchdog de mudez | período fijo (mismo timer), umbral 45 s | por conexión | n/a | solo loguea, no acciona |
| awaits del puente nativo | presupuestos 10 s / 30 s / 20 s | por llamada | sí (vencen y liberan el latch) | guard estático sobre la ausencia (`spp-bridge-timeout-guard.test.ts`) |
| red / email / SMS / API externa / bulk | **n.a.** | — | — | este diff no toca la red ni la DB: es transporte local (BLE/SPP) + storage local. Nada que rate-limitear server-side |

---

## False positives descartados / revisado-y-limpio (trazabilidad)

Lo que la skill o un scanner de patrones marcaría, y por qué no aplica:

1. **`pin: '1234'` en `driver-rs420.ts:29`** — un scanner de secretos lo flagea. NO es un secreto: es
   el PIN de fábrica público del RS420, documentado en `field-findings.md`, y encima **nadie lo
   consume** (`resolveSppParams` lo devuelve y solo va al copy de la UI: *"emparejalo… (PIN 1234)"*).
2. **`.exec(` en `parser-rs420.ts:56`** — es `RegExp.prototype.exec`, no ejecución de comandos.
3. **`require()` dinámico en `adapter-spp-android.ts`** (:184, :192, :207, :376, :385, :394, :407) —
   especificadores **constantes** (import perezoso para no meter RN en el grafo de web/CI). No hay
   ningún `require` con string dinámico ni derivado de input.
4. **`autoConnectExhausted` público y mutable desde afuera** — es una propiedad de instancia sin
   `readonly` en la clase (sí `readonly` en la interfaz `StickAdapter`). El único consumidor es la
   pantalla, en lectura. No es una superficie de ataque en un cliente móvil (todo el bundle es
   attacker-controlled por definición); no lo reporto.
5. **`__resetSppModuleStateForTests()` exportado en producción** (`:362`) — solo limpia dos slots de
   coalesce; su peor caso es des-coalescer un pedido. No es un backdoor.

Y lo que **revisé porque el leader lo pidió explícitamente**, con el resultado:

6. **Foco 1 — ¿se debilitó la validación del EID en algún camino?** **No.** La tabla
   `ADAPTER_INGEST_MODE` (`adapter-selection.ts:85-95`) reproduce **exactamente** el comportamiento
   anterior (`web-serial` + `spp-android` → `raw-line`; `manual`/`mock`/`simulator` → `eid`;
   `hid-wedge` gated → `eid`) y es exhaustiva por tipo. `ingestRawLine` sigue exigiendo
   `normalizeTag` no vacío + `parseRs420Line` + `isValidTag`; `ingestEid` sigue exigiendo
   `normalizeTag` + `isValidTag` (`contract.ts:32-62`, sin cambios en el diff). **No existe un camino
   nuevo por el que una línea cruda entre como EID limpio ni al revés.** La confirmación visual
   pre-commit sigue intacta: `FindOrCreateOverlay.tsx:165` ignora las lecturas mientras hay un
   scanner acotado activo y el commit sigue siendo un `router.push('/crear-animal', {tag})` que el
   operario tiene que completar. El cambio de dueño en `/baston` **falla seguro**: si el contador de
   scanner acotado quedara colgado, se pierden lecturas (no se commitea nada sin confirmar).
7. **Foco 2 — ¿algún camino automático pide permisos o muestra un diálogo del SO?** **No.**
   `autoConnect` usa `checkPermissions` (`:595`); `doConnect` deriva `ensure` vs `check` de
   `policyFor(trigger).allowsSystemDialogs` (`:745-753`), y `autoconnect`/`retry` lo tienen en
   `false` (`connect-trigger.ts:46-49`). `requestBluetoothEnabled` solo se llama con
   `allowsSystemDialogs` (`:797-808`) o desde `listPairedSppDevices`, cuyo **único** call site de
   producción es un gesto (`StickConnectionScreen.tsx:226`, vía `onLoadPaired`/`onStatusCta`). Grep
   confirmado: no hay ningún `PermissionsAndroid.request*` alcanzable desde un timer o desde el
   arranque. El campo obligatorio `checkPermissions` en `SppEnv` hace que un env nuevo que lo olvide
   no compile. **El implementer cerró esto bien.**
8. **Foco 5, riesgo (a) del leader — ¿el tope se puede "lavar" convirtiendo una cadena `autoconnect`
   en `operator`?** Lo busqué y **no es alcanzable**: `queueTarget` (`:688-693`) solo encola targets
   **explícitos** y **distintos** del in-flight, y en la cadena `autoconnect` el target in-flight es
   siempre la MAC recordada (`autoConnect` pasa `remembered`; el `retry` pasa `currentDeviceId`), así
   que un reintento nunca se encola y nunca promueve la cadena a `operator`. No es finding.
9. **Foco 5, riesgo (b) del leader — ¿`autoConnectExhausted` puede quedar pegado en `true`?** **No**:
   `applyChainPolicy` lo limpia al arrancar cualquier cadena (`:674`), y el test de :1640-1660 lo
   asserta. Corre verde.
10. **Foco 5 — ¿el estado agotado filtra información?** No. `autoconnect_exhausted` lleva `ms` +
    `attempts` (sin MAC, sin PII) y el copy de `connection-view.ts:162-172` es genérico es-AR sin
    jerga ni detalle técnico. Único matiz: el copy revela que **había** un bastón guardado, lo que en
    un teléfono compartido le dice al usuario B que A tenía uno. Irrelevante.
11. **El guard estático de timeouts no es teatro**: lo leí y es falsable (enumera todo `await` cuyo
    prefijo es `native.`/`device.`/`env.`/`this.env.` y exige `withTimeout*`), declara sus propios
    límites (await indirecto) y cubre a mano el único caso de promesa guardada. Su límite real: solo
    ve awaits de una línea que **arrancan** con el prefijo del puente (un
    `await Promise.all([native.x(), …])` lo evadiría). Hoy no hay ninguno.
12. **Catálogo, dominios excluidos con justificación**: A/B1/B3/D1/H (no hay backend, ni cliente
    admin, ni respuestas al cliente, ni sesión en este diff) · C1/C2/C4 (no toca PowerSync, Realtime
    ni la cola offline; el transporte no conoce `establishment_id` y no se agregó ninguna
    referencia) · E1/E2/E3/E4 (no hay queries, ni costo por request, ni signup, ni enumeración) ·
    F1/F2/F3/F4 (no hay filtros PostgREST, ni import de archivos, ni `fetch`, ni templates de email) ·
    D2/D4 (el diff no toca `deno.lock` ni `.github/workflows`) · I2 (no toca el audit trail).
    **Aplicados**: C3 (data-at-rest local → MEDIUM-2), D3 (secretos en logs → LOW-1), G1/G2/G3
    (frontera BLE → MEDIUM-2 y el punto 6 de arriba), I1/I3 (retención del identificador → MEDIUM-2).

---

## Archivos analizados

Producción (los que importan para el veredicto):
`app/src/services/ble/adapter-spp-android.ts` (+813/-85) · `bridge-timeout.ts` (nuevo) ·
`connect-trigger.ts` (nuevo) · `adapter-selection.ts` · `spp-protocol.ts` · `logging.ts` ·
`permissions-android.ts` · `driver-types.ts` · `driver-rs420.ts` · `stick-adapter.ts` ·
`BleStickListenerProvider.tsx` · `app/src/features/ble-stick/connection-view.ts` ·
`app/src/features/ble-stick/screens/StickConnectionScreen.tsx`.

Leídos como contexto de data flow (no modificados por el diff, necesarios para trazar el EID):
`contract.ts` · `parser-rs420.ts` · `dedup.ts` · `line-framer.ts` · `remembered-device.ts` ·
`listener-gate.ts` · `app/app/_components/FindOrCreateOverlay.tsx` ·
`app/src/features/ble-stick/components/StickStatusIndicator.tsx` · `StickDeviceRow.tsx` ·
`app/plugins/with-bluetooth-classic.js` · `app/node_modules/react-native-bluetooth-classic/lib/BluetoothDevice.js`.

Tests / infra revisados (no auditados como código de producción):
`adapter-spp-android.test.ts` · `spp-bridge-timeout-guard.test.ts` · `scripts/run-tests.mjs`
(los 4 archivos de test nuevos **están** registrados en la lista explícita) ·
`app/e2e/baston-multivendor.spec.ts` + los dos `captures/*.capture.ts` (cambio de expectativa a la
invariante nueva; no introducen flags que se filtren a producción — `isNonDemoE2E` y `isDemoMode`
siguen leyendo globals de test).

## Cobertura indirecta / no cubierto por la skill

- **Deno / Edge Functions**: no aplica (sin cambios en `supabase/`).
- **RLS / multi-tenant a nivel DB**: no aplica (sin migraciones). El transporte no conoce
  `establishment_id`; lo único con sabor a multi-tenancy es la clave global del device recordado
  (MEDIUM-2).
- **PowerSync / sync rules**: **no cubierto por la skill** y no tocado por el diff. Sigue pendiente
  cuando se cablee (ADR-002).
- **React Native / Android nativo**: **cobertura indirecta**. La skill no modela `PermissionsAndroid`,
  el ciclo de `AppState`, el puente de módulos legacy ni el comportamiento de `BluetoothSocket`. Todo
  lo de los focos 2, 3, 4 y 5 de este informe salió de revisión manual + lectura de la lib instalada,
  no de la skill.
- **Frontera BLE/SPP (catálogo G)**: **no cubierta por la skill**. Revisada a mano (MEDIUM-2 + punto
  6). El modelo de confianza del canal para el camino **automático** no está documentado en la spec —
  vale escribirlo, aunque no sea un finding en sí.
- **Device-test**: nada de este informe se verificó en el A07. El repro del HIGH-1 corre con dobles
  (reloj y timers inyectados), que es donde vive la lógica del presupuesto; el oráculo del banco
  (T-MV.5.18) sigue siendo el que decide sobre el resto.


---
---

# ADENDA — re-auditoría del fix-loop (2026-07-30, misma sesión)

**Veredicto nuevo: PASS** — el HIGH cerrado y verificado con el mismo oráculo que lo encontró; los dos
MEDIUM cerrados; queda **1 LOW nuevo** (mío, derivado del argumento con el que se cerró MEDIUM-2) y
2 nits, todos foldeables al backlog.

Lo de arriba **no se reescribió a propósito**: queda el rastro de qué se encontró y cómo se cerró.
Alcance de esta pasada: solo mis tres hallazgos + lo que el fix pudo abrir. Read-only. **No corrí
`check.mjs`** (lo corre el reviewer).

**Ejecutado en esta pasada** (todo con dobles, en el scratchpad, fuera del repo):
- Las 12 suites puras del camino BLE → **241 pass / 0 fail** (eran 228 antes del fix: +13 casos nuevos,
  ninguno rojo).
- Mi repro original de HIGH-1 → **pasa**.
- 4 probes nuevos (A-D) sobre lo que el fix-loop reclama → **4 pass**.

---

## HIGH-1 — CERRADO

`retryBudgetUntil = null` en `adapter-spp-android.ts:891`, dentro del camino de éxito, después del
guard de generación (`:852`) y antes de `writeRemembered`. El invariante que declara —*el presupuesto
pertenece a la CADENA, y una cadena que llegó a `'connected'` terminó*— es el correcto y es el que yo
pedía: el tope existe por "ese bastón no existe", y el bastón contestando refuta esa hipótesis.

**Mi repro (el oráculo) ahora pasa**:

```
statuses: connecting -> connected -> disconnected -> scanning
reintentos programados: 1        (antes: 0)
autoConnectExhausted: false     (antes: true)
REPRO: autoconnect OK + corte a los >120 s → reintenta        ✔
CONTRASTE: mismo corte a los 30 s → reintenta                 ✔
```

**Ubicación del clear, revisada**: está antes del segundo guard (`:901`), así que en la carrera
"disconnect entra durante `writeRemembered`" el presupuesto se limpia sin haber emitido `'connected'`.
Lo miré y **es correcto igual**: para llegar ahí el socket ya se abrió (el bastón contestó → la
hipótesis del tope ya está refutada), y la cadena en esa carrera está muerta por otra vía (`closed`, o
una generación nueva que ya re-aplicó su propia política). No hay ventana donde una cadena capada
pierda el tope sin que el bastón haya contestado.

### El efecto lateral que reclama: es cierto, y es una mejora real de diagnóstico

Verificado ejecutando (probes A y B):

```
A · cadena que NUNCA conectó → {"kind":"autoconnect_exhausted","ms":200000,"attempts":1}   attempts > 0 ✔
B · cadena que CONECTÓ y se cae 10 min después → NINGÚN autoconnect_exhausted, 1 reintento          ✔
```

Y lo verifiqué además **por construcción**, no solo por el caso que corrí: `exhaustUnpromptedChain` lee
`this.reconnectAttempt`, que `scheduleReconnect` incrementa **después** de evaluar el presupuesto
(`:1065` vs `:1083`). Para que un `autoconnect_exhausted` saliera con `attempts:0` haría falta que el
**primer** fallo ya encontrara los 120 s gastados, o sea que un solo `doConnect` tardara ≥120 s — y la
suma de sus presupuestos en producción es ~60 s en el peor caso (10+10+10+20+10). Solo alcanzable con
`timeouts` en 0, que es la puerta explícita de los tests. **En producción `attempts ≥ 1` siempre**, y
`ms` mide tiempo realmente reintentando. Se acabó el `{"ms":600000,"attempts":0}` — que, como dice el
comentario nuevo, era una confesión.

## MEDIUM-1 — CERRADO (en las dos direcciones)

`canCloseOrphanSocket(gen)` (`:1199-1202`) separa las dos razones por las que la generación pudo
avanzar, que es exactamente la distinción que faltaba:

```ts
private canCloseOrphanSocket(gen: number): boolean {
  if (this.closed) return true;                  // el operario no quiere NADA en esa dirección
  return gen === this.connectGeneration;         // sigo siendo el dueño de la dirección
}
```

Recorrí los dos call sites (`:844` la resolución tardía del `onTimeout`, `:857` el abort post-await) y
**no encontré ninguna ventana** en la que el intento vencido cierre el socket del vigente:

| estado al resolver tarde | resultado | ¿correcto? |
|---|---|---|
| `closed` (el operario desconectó) | cierra por dirección | sí — el punto original del `onTimeout` sigue en pie |
| misma generación (nadie más tomó la dirección) | cierra | sí — mata el socket fantasma |
| generación nueva **sin** `closed` (B es el dueño) | **no toca** + `orphan_socket_kept` | sí — es el fix |

Verificado ejecutando las dos direcciones, que es lo que pediste:

```
C · A vence → B conecta → A resuelve tarde:
      disconnects por dirección: 0   ·   orphan_socket_kept: 1   ·   estado final: connected   ✔
D · A vence → el operario desconecta → A resuelve tarde:
      disconnects por dirección: 1 (antes 0) → el socket fantasma SÍ se cierra                 ✔
```

Sin el probe D esto habría sido un cambio que arregla un síntoma abriendo el otro; con él está medido
que no.

**Residuo aceptable, no finding**: en el caso "B es el dueño" el socket de A queda abierto en el
`mConnections` del nativo. No acumula: ese mapa es **por dirección**, así que a lo sumo hay UNA conexión
viva por MAC, y el `connectToDevice` siguiente recibe esa misma. El razonamiento del comentario es
correcto.

## MEDIUM-2 — CERRADO en lo que importaba, con un residuo que bajo a LOW

Lo que se cerró, verificado leyendo:

| pieza | estado |
|---|---|
| persistir antes de conectar | **cerrado** — `onChoosePaired` (`StickConnectionScreen.tsx:280-286`) ya no escribe; el único que persiste es el adapter, en el punto donde el bastón contestó (`:894`). Con guard sobre la función (`wiring.test.ts:204`) |
| R6.6 "olvidar" sin cablear | **cerrado** — CTA `stick-forget-cta` (`:428-432`), condicionado a `hasRemembered` (sin afordancia muerta en la primera instalación) |
| no se limpia al cerrar sesión / dar de baja | **cerrado para las dos acciones explícitas** — `AuthContext.tsx:167`, `account.ts:153`, las dos best-effort (no bloquean el logout ni convierten una baja consumada en error) |
| guard sobre la ausencia | **existe** — `wiring.test.ts:179` exige los tres call sites por fuente |

**Mis tres consecuencias, re-evaluadas** (es mi hallazgo, así que doy el veredicto explícito):

1. **Conexión no solicitada a un device arbitrario** → **cerrada**. Ahora solo se recuerda una MAC que
   llegó a `'connected'`, o sea un peer que abrió un RFCOMM de verdad. Tocar los auriculares por error ya
   no los convierte en "el bastón". Era la mitad que importaba de esta consecuencia.
2. **El borde del canal para la integridad del EID** → **acotada, no eliminada** — y está bien así. Un
   peer que acepte RFCOMM y hable el framing del RS420 sigue pudiendo inyectar lecturas que se presentan
   como reales; lo que cambia es que ahora tiene que haber conectado al menos una vez, con un gesto. El
   resto lo sostienen dos controles intactos: el bond obligatorio (`secure: true`) y la confirmación
   visual pre-commit. Es el precio explícito de `allowUnrecognized: true`, que está decidido y escrito.
   **Lo que sigue faltando es una línea de spec**, no código: el modelo de confianza del canal está
   documentado para el camino con gesto y no para el automático.
3. **Privacidad / multi-tenancy** → **cerrada para el logout y la baja; abierta para el fin de sesión
   involuntario**. Ver LOW-5.

### [LOW-5] El argumento "la vida de la clave es la de la sesión" no se cumple: la limpieza está en la ACCIÓN de logout, no en el fin de la sesión

Este es el punto que me pediste evaluar, y la respuesta es **no, el argumento no cierra** — aunque el
residuo es chico, así que lo dejo en LOW y no en MEDIUM.

El argumento sería válido si todo fin de sesión pasara por `signOut()`. No pasa:
`AuthContext.tsx:115-117` es el único lugar que ve el fin de sesión y **solo hace `setState`**:

```ts
const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
  if (active) setState(stateFromSession(session));
});
```

**Caminos que cambian de usuario sin ejecutar `forgetRememberedDevice`** (los busqué porque los pediste):

1. **Expiración / revocación del refresh token** — el caso natural de un teléfono compartido que queda
   semanas sin abrirse: la sesión muere, el evento llega al listener, el usuario cae en el login y el
   siguiente entra con SUS credenciales. `signOut()` nunca corrió.
2. **Sign-out global disparado desde otro device** — y este no es teórico en RAFAQ: la Edge Function
   `delete_account` hace `adminClient.auth.admin.signOut(accessToken, 'global')` + ban
   (`supabase/functions/delete_account/index.ts:155-164`). En el **segundo** teléfono de esa cuenta la
   sesión muere por el listener, así que el `forgetRememberedDevice` de `account.ts` —que corre solo en
   el device que inició la baja— no lo cubre: la cuenta ya no existe y la MAC sigue ahí.
3. **Cualquier otra revocación server-side de sesiones** (cambio de password con scope global, etc.):
   mismo camino que 1.

Consecuencia real: una MAC de periférico sobrevive a un cambio de usuario involuntario y el arranque del
usuario B abre un RFCOMM contra el bastón de A, sin gesto. Impacto bajo (dato de baja sensibilidad,
periférico local del galpón, tope de 120 s, confirmación visual intacta, y ahora hay un CTA visible para
olvidarlo) — pero es exactamente el escenario que el argumento dice cubrir.

**Fix, una línea, y es más barato que el scope por usuario**: limpiar en el listener cuando la sesión pasa
a null (o cuando cambia el `user.id`), en vez de —o además de— hacerlo en la acción. Eso sí hace que la
vida de la clave sea la de la sesión, y de paso vuelve verdadero el comentario que ya está escrito en
`signOut`. **Foldeable al backlog** si Raf prefiere no tocar `AuthContext` en esta unidad; si se folda,
conviene corregir el comentario de `AuthContext.tsx:160-166`, que hoy afirma más de lo que el código hace.

---

## Los dos focos nuevos del fix-loop

### 1. `connect_reasserted` (y `orphan_socket_kept`) — limpios

Los dos eventos nuevos llevan **solo literales de una unión cerrada**, ningún dato de entorno:

```ts
| { kind: 'connect_reasserted'; trigger: 'operator' | 'autoconnect' | 'retry' }
| { kind: 'orphan_socket_kept'; reason: 'address_owned_by_newer' }
```

Sin MAC, sin `message`, sin excepción del SO — o sea que no repiten lo de `connect_error`
(`adapter:284`, que sigue pasando el mensaje crudo del nativo) ni lo de `connect_superseded`
(`logging.ts:22`, que sigue llevando el `deviceId`). Esos dos siguen en **LOW-1** del informe original,
sin cambios: logcat, sin sink remoto (re-verificado: no hay Sentry ni override de `console` en
`app/src`, y `babel.config.js` no borra `console` en release).

Revisé además el **comportamiento** nuevo del reassert (`:633-646`), que es lo que de verdad importa del
evento: un `connect()` con un intento en vuelo re-aplica la política de su cadena, así que un tap del
operario **destopa**. Es correcto y cierra un hueco que yo no había visto (tocar el chip durante el
intento del arranque no cambiaba nada y la app se rendía igual a los 120 s). Verifiqué que la rama es
inalcanzable para `autoconnect` —`autoConnect()` se abstiene con el latch tomado, en los cuatro gates y
en los tres re-chequeos post-await— así que nadie puede **re-armar** un tope desde ahí; y `retry` es
`inherit`, o sea que el timer no puede reiniciar el presupuesto (que era la trampa que el propio diseño
ya cubría con un test).

### 2. El CTA "Olvidar el bastón guardado" — correcto

- **No se puede disparar sin gesto**: es un `<Button onPress>` (`:428-432`) renderizado solo si
  `hasRemembered` y solo en la rama SPP. Ningún efecto lo llama.
- **Deja el sistema consistente**, verificado leyendo el orden (`:290-299`): `disconnect()` **primero**
  (que además pone `closed = true` y cancela la cadena de reintentos) y recién después
  `forgetRememberedDevice()`. Así que **no queda ningún auto-connect apuntando a la clave borrada**:
  `scheduleReconnect` sale temprano por `closed`, `autoConnect()` no se vuelve a llamar (una vez por
  montaje del transporte) y un `connect()` posterior sin target lee `null` → `'disconnected'`. El orden
  importa y está bien elegido: al revés, el link vivo re-persistía la MAC al reconectar.
- **Idempotente**: `deleteItemAsync` sobre una clave ausente no tira, y va dentro del try/catch del
  módulo.

---

## Nits (no findings; los nombro porque son de la clase que vuelve)

1. **La otra escritura pre-conexión sigue viva, 70 líneas más arriba**: `onChooseDevice`
   (`StickConnectionScreen.tsx:202-204`) todavía hace `writeRememberedDevice(binding.driver.vendorId)`
   **antes** de conectar. Hoy es **inalcanzable** (esa fila solo se renderiza en la rama no-SPP, y ahí
   `hasTransport` es false → `actionable: false` → `onPress` undefined) y escribiría un vendorId, no una
   MAC. Pero el guard nuevo (`wiring.test.ts:204`) está escrito sobre **`onChoosePaired`**, o sea sobre
   la instancia que se arregló, no sobre el invariante ("nadie más que el adapter persiste"). Si alguien
   vuelve a hacer esa fila accionable, el defecto reaparece **en verde**. Es la doctrina de la casa (el
   guard se escribe sobre la ausencia): debería mirar el archivo entero y permitir
   `writeRememberedDevice` en cero call sites de la pantalla.
2. **Carrera cosmética del CTA**: el efecto que calcula `hasRemembered` depende de `status`, y
   `onForgetRemembered` cambia el status (por el `disconnect()`) antes de borrar, así que la lectura del
   efecto puede resolver con la MAC todavía presente y volver a mostrar el botón por un frame. La clave
   **sí** queda borrada; tocarlo de nuevo es idempotente. Cosmético.

---

## Resumen de la re-auditoría

| hallazgo | severidad original | estado | oráculo |
|---|---|---|---|
| HIGH-1 · el presupuesto no moría al conectar | HIGH | **cerrado** | mi repro (pasa) + probes A y B |
| MEDIUM-1 · `disconnect()` por dirección | MEDIUM | **cerrado** en las dos direcciones | probes C y D |
| MEDIUM-2 · la MAC recordada | MEDIUM | **cerrado** salvo el fin de sesión involuntario → LOW-5 | lectura + guard de `wiring.test.ts` |
| MEDIUM-3 · acumuladores sin cota | MEDIUM (pre-existente) | en `docs/backlog.md`, no re-litigado | — |
| `connect_reasserted` / `orphan_socket_kept` | — | limpios | lectura |
| CTA "Olvidar" | — | correcto y consistente | lectura |

**Al backlog**: LOW-5 (limpiar la MAC en el listener de sesión, no en la acción) + los dos nits + lo que
ya estaba (LOW-1 MAC en logcat, LOW-2 formato del EID sin validación server-side, LOW-3
`BLUETOOTH_SCAN` declarado y no usado, LOW-4 el poll en background, MEDIUM-3).

**Sigue fuera de mi alcance y sin cambios**: el device-test en el A07 (T-MV.5.18) es el oráculo que
decide sobre el comportamiento real de la radio; todo lo de esta adenda corre con dobles.
