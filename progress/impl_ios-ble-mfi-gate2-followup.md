# Follow-up del Gate 2 — los dos hallazgos §7 del delta `ios-ble-mfi` (feature 04)

baseline_commit: fae4f53b9935516a160bd4421357e3d53b9aced8

**Entrada**: `progress/impl_ios-ble-mfi-gate2-fix.md` §7 (los dos hallazgos que el fix-loop del HIGH dejó
fuera de alcance) + `progress/security_code_04-ios-ble-mfi.md`. El HIGH ya está commiteado en `fae4f53`.
**Alcance ejecutado**: SOLO §7.1 y §7.2. No se empezó F6 ni F7, no se instalaron dependencias, no se
lanzaron builds. **No se commiteó.**
**Estado**: los dos cerrados, con falsificación por 13 mutantes y medición en las dos direcciones.

## 1. Tasks (todas cerradas — `TG.1`–`TG.10` en `tasks-ios-ble-mfi.md`, fase F5-followup)

- [x] **TG.1** — allowlist compartida del meta-guard, UNA entrada, exención **por chequeo**.
- [x] **TG.2** — `scan-coverage.test.ts`: el **freno** de la allowlist + la demostración en dos direcciones.
- [x] **TG.3** — `error-text.ts`: `safeErrorText(e, deviceId?)`, el convertidor único.
- [x] **TG.4** — los tres adapters: se borran las tres copias de `errorMessage(e)`.
- [x] **TG.5** — `error-text.test.ts` (12 tests), con la tabla de códigos **derivada** de la lib.
- [x] **TG.6** — `log-device-identifier-guard.test.ts`: el guard sobre la ausencia.
- [x] **TG.7** — barrido de comportamiento en las tres suites de adapter (8 tests).
- [x] **TG.8** — 13 mutantes, control positivo, árbol restaurado byte a byte.
- [x] **TG.9** — `run-tests.mjs` (compartido): registro de los tres tests nuevos + verificación del bloque
      de rebrand fase 5.
- [x] **TG.10** — reconciliación de specs (RBM9.9, RBM9.10, nota bajo RBM5.13, design §4.2).

---

## 2. §7.1 — la allowlist del meta-guard, estrenada CON freno

### 2.1 El problema, re-medido acá (no copiado del informe anterior)

| Archivo | Líneas no vacías | Post-blanqueo | Retención | Estado |
|---|---|---|---|---|
| `src/services/ble/logging.ts` | 148 | 34 | **0.230** | ya bajo el piso de 0.25; lo salvaba estar **2 líneas** abajo del umbral de 150 |

Barrido del árbol entero (406 archivos) para ver si era un caso aislado: los vecinos más cerca del borde
son `read-dispatch.ts` (149 líneas, 0.255 — **arriba** del piso) y `stick-adapter.ts` (131, 0.244 — bajo el
piso pero a 19 líneas del umbral de tamaño). O sea: **uno solo** califica hoy, y por eso la entrada es una.

**Medición del mutante, en las dos direcciones** (dos miembros de una línea agregados al union, sin un solo
comentario — el crecimiento mínimo posible):

| | Guards en rojo |
|---|---|
| **SIN** la entrada | **10 de 11** (`keyboard-avoiding`, `sheet-keyboard-dismiss`, `worklet-callbacks`, `stick-status-surface`, `storage-keys`, `brand-name`, `safe-bottom-inset`, `tap-target-collision`, `today-iso`, `log-device-identifier`) |
| **CON** la entrada | **0 de 11** |

El único que se salva sin la entrada es `phone-field`: su raíz de escaneo (`app/app` + `app/src/components`)
no llega al archivo. Confirma el diagnóstico del informe anterior, que decía 9 sobre 10 — ahora son 10 sobre
11 porque el guard nuevo de §7.2 es el undécimo consumidor.

### 2.2 Cómo quedó (`app/src/utils/scan-coverage.ts`)

**UNA entrada, compartida, con el motivo escrito en el lugar.** Los once guards calculan el mismo `label`
(`relative(APP_ROOT, f)` con `/`), así que una entrada alcanza para todos — y eso **no se deja a la suerte**:
hay un test que exige que todos lo calculen igual, porque un guard que etiquete distinto no sería cubierto
por la entrada compartida y se pondría rojo igual, con el mensaje del blanqueo y a diez guards de distancia
del síntoma.

**La exención es ANGOSTA, y es un cambio de semántica del módulo.** Antes `allow` hacía `continue`: el
archivo desaparecía del escaneo. Ahora la entrada declara **de qué chequeo** exime (`'retention'` |
`'braces'`) y el archivo **se sigue leyendo, blanqueando y midiendo**: a `logging.ts` le corre el balance de
llaves igual. Un `continue` habría devuelto al guard exactamente la ceguera que `scan-coverage.ts` vino a
cerrar.

**El motivo, en el lugar y no en un informe.** El texto completo está en el `why` de la entrada: es un
catálogo de eventos donde la prosa **es** el artefacto (cada miembro del union existe para que un síntoma en
logcat se distinga de otro), el blanqueador **no** está roto (el balance cierra en 0), y la alternativa era
purgar documentación de diagnóstico de otras unidades para bajar un ratio — que es optimizar la métrica
contra su propósito.

### 2.3 El freno (`app/src/utils/scan-coverage.test.ts`, nuevo — 10 tests)

Una allowlist estrenada es un precedente: de acá en adelante, cualquiera que se tope con un guard rojo tiene
delante una salida de emergencia de una línea. Los cinco dientes:

1. **Motivo escrito en el lugar** — ≥ 200 caracteres y que **no arranque** con un puntero (`ver`, `see`,
   `cf`, `TODO`, `temporal`…). Una exención que no se puede evaluar no se saca nunca.
2. **Tope** (hoy 1). Subirlo es un acto deliberado, en el mismo commit que agrega la entrada, y queda en el
   diff.
3. **El archivo existe** — una entrada huérfana no exime nada y encima esconde que ya no hace falta.
4. **La exención está GANADA contra el árbol real** — se mide la retención con el escáner canónico y, si el
   archivo dejó de violar el chequeo, la entrada **sobra y se pone roja**. Es lo que hace que la lista se
   limpie sola. (Falsificado: apuntar la entrada a `read-dispatch.ts`, que retiene 0.255, la pone roja.)
5. **La puerta es UNA** — ningún guard puede pasar su propia `allow` inline. La opción del call site quedó
   **solo para este test**, que la necesita para medir con y sin la entrada; el escaneo que lo verifica barre
   `app/app` + `app/src` **y la raíz de `app/`**, donde ya viven `ios-purpose-strings-guard` y
   `eas-profiles-guard`. Dos puertas a una allowlist es una allowlist sin freno, porque la segunda no la mira
   nadie.

Y arriba de los cinco, **la demostración**: el mutante de dos líneas sobre el archivo **real**, corrido con
la entrada y sin ella, con dos aserciones anti-vacuidad (que el mutado siga cruzando el umbral de tamaño y
que su retención siga bajo el piso — si alguien purga la prosa, este test manda a borrar la entrada en vez de
quedar verde por nada).

---

## 3. §7.2 — el identificador del bastón fuera del free-text, barriendo la CLASE

### 3.1 Lo que se verificó en el fuente instalado (no supuesto)

- **`react-native-ble-plx`** (`src/BleError.js`): **20** plantillas interpolan `{deviceID}`. El `BleError`
  que llega a JS **no tiene** la propiedad `deviceID` —el constructor solo copia `message`, `errorCode`,
  `attErrorCode`, `iosErrorCode`, `androidErrorCode`, `reason`—, así que "detectar si el error trae el id"
  **solo se puede por el código**. Eso decide el diseño.
- **`react-native-bluetooth-classic`** (`Exceptions.java` + `ConnectionFailedException`/`ConnectionLost`/
  `DevicePairing`): `'Connection to %s failed.'`, `'Connection to %s was lost'`, `'Not connected to %s'`,
  `'Unable to complete pairing with %s'`, y el `%s` es **`device.getAddress()`** → la MAC. **La fuga del SPP
  es real y es anterior al baseline**, como decía el hallazgo.
- **MFi**: el identificador es el **serial del accesorio**. No tiene forma reconocible: ninguna regex lo
  distingue de otra palabra. El módulo nativo todavía no existe, así que esto entra **antes** de que haya un
  mensaje del que arrepentirse.

### 3.2 `app/src/services/ble/error-text.ts` (nuevo) — un solo convertidor

```
safeErrorText(e, deviceId?)
  ├─ errorCode ∈ tabla {deviceID}  → `errorCode:<n>`   (el mensaje NO se mira)
  └─ resto → message | string | code | errorCode:<n> | 'unknown'
                 → blanqueo: el deviceId EXACTO (case-insensitive, ≥6 chars) + cualquier MAC → `<device>`
                 → tope de 240 caracteres
```

**Por qué la tabla de códigos** (el camino que eligió el leader): es la **única** vía que cubre el id de iOS,
que es un UUID y por forma es indistinguible de un UUID de servicio o de característica — que sí queremos
seguir viendo en el log. Los códigos mapean 1:1 con las plantillas: no se pierde diagnóstico, **se pierde
legibilidad, y ese es el precio aceptado**.

**Por qué además el blanqueo**: el SPP y el MFi no tienen códigos de `ble-plx`. El primero interpola la MAC
(que sí tiene forma) y el segundo el serial (que no tiene ninguna, y por eso el call site que lo conoce se lo
pasa). Con esto, `'Connection to AA:BB:CC:DD:EE:FF was lost'` sale como `'Connection to <device> was lost'`:
se pierde el dueño, **no la causa**.

**Lo que a propósito NO se toca**, porque blanquear de más también rompe el diagnóstico: los UUID de
servicio/característica, y los mensajes sin identificador (`'BluetoothLE is powered off'` — la causa que más
se lee en logcat — sale entera; hay test).

**La tabla no está escrita a ojo**: el test la **deriva** de `node_modules/react-native-ble-plx` parseando
`BleErrorCode` + `BleErrorCodeMessage`, y exige que la declarada contenga a la derivada. Un upgrade de la lib
que agregue una plantilla con el id se pone **rojo antes** de que el id empiece a viajar. El único código
extra (`InvalidIdentifiers`, cuyo `{internalMessage}` **son** los identificadores) va en un mapa aparte con
su motivo, y el test exige que la diferencia sea **exactamente** ese mapa.

### 3.3 Los tres adapters

Se borraron las **tres copias** de `errorMessage(e)` (dos leían `.message` con cast, una directo) y en su
lugar quedó un comentario que dice qué había y por qué se fue. Los call sites que conocen el device se lo
pasan:

| Call site | Antes | Ahora |
|---|---|---|
| `verifyLiveness` (los **tres** adapters) | `errorMessage(e)` | `safeErrorText(e, deviceId/address)` |
| `ble_monitor_lost` (GATT) | `errorMessage(error)` | `safeErrorText(error, target)` |
| `ble_disconnected` (GATT) | `errorMessage(error)` | `safeErrorText(error, target)` |
| `ble_scan_error`, `ble_manager_load_failed`, `mfi_module_load_failed` | `errorMessage(…)` | `safeErrorText(…)` (sin device: no hay uno en juego) |
| `logBridgeFailure` (los tres) | 3 parámetros | 4º opcional `deviceId`, pasado en `connect_path` |

**Único cambio de estructura**: el `let target` de `adapter-mfi-ios` se declaró **fuera del `try`**, porque
el `catch` del `connect_path` necesita saber cuál era el accesorio para poder blanquearlo. Sin eso, el serial
del nativo salía entero.

### 3.4 El guard sobre la AUSENCIA (`log-device-identifier-guard.test.ts`, nuevo)

Arreglar tres call sites no cierra nada: la forma se re-escribe sola en el próximo adapter. El guard enumera
**las superficies que loguean** (hoy 6, con piso) y exige tres cosas:

- **A** — ninguna lee el texto de un error por su cuenta: `.message`, `String(e)`, `${e}`. El único
  convertidor es `safeErrorText`. (Es la regla que cierra la indirección: la fuga real viajaba por una
  variable `why`, que ningún escaneo de call sites podía ver.)
- **B** — ninguna **nombra** un identificador en la expresión de un `message`, ni interpolado
  (`${device.id}`) ni **concatenado** (`'x: ' + device.id`) — la misma fuga con otra sintaxis, que un
  extractor que solo mirara `${…}` habría dejado pasar en silencio. El **texto literal** sí puede decir
  "device" (`ble_device_not_recognized` es el nombre del evento) y el **campo con clave** sigue siendo legal
  (`connect_superseded { deviceId }`), porque ese sí lo alcanza el scrubber de `redact.ts`.
- **C** — `error-text.ts` es el único convertidor error→texto de `services/ble/`. La copia a mano es el bug
  de clase que ya costó el union `RejectReason` recopiado de `contract.ts`.

Con **anti-vacuidad** (las tres reglas disparan sobre el cuerpo VIEJO, incluida la grafía con cast que tenían
dos de las tres copias) y **control de falsos positivos** (no disparan sobre los seis call sites correctos de
hoy — un guard que da falsos positivos se termina apagando, y apagado no vigila nada).

**Lo que declara NO cubrir**: un texto armado lejos del call site y logueado por una variable. Eso es data
flow, no escaneo estático. Esa mitad la cubre el barrido de **comportamiento** de las tres suites de adapter,
que mira los eventos EMITIDOS y no el fuente: ahí el origen del string no importa.

---

## 4. Trazabilidad `R<n>` → archivo:test

| Requisito | Test que lo cubre |
|---|---|
| **RBM9.9** (el id fuera del free-text — la regla) | `ble/log-device-identifier-guard.test.ts` → `REGLA A: ninguna superficie que loguea lee el texto de un error por su cuenta` · `REGLA B: ningún message NOMBRA un identificador…` · `REGLA C: el convertidor error→texto es UNO` · `las tres reglas DISPARAN sobre las formas que tenía el código antes del fix` · `las reglas NO disparan sobre lo que hoy es correcto` |
| **RBM9.9** (el convertidor) | `ble/error-text.test.ts` → `la tabla de códigos se DERIVA de la lib instalada` · `la desconexión de ble-plx sale como errorCode…` · `el id de iOS (UUID) también queda afuera` · `los CUATRO mensajes que nombra el hallazgo caen del lado seguro` · `un código SIN identificador conserva su mensaje` · `la MAC del SPP se blanquea y la CAUSA sobrevive` · `un identificador SIN forma reconocible (el serial MFi)…` · `un UUID de SERVICIO no se toca` · `un id conocido demasiado CORTO no se usa` · `las formas que llegan de verdad por el puente de RN` · `el texto que va al log está ACOTADO` · `el blanqueo alcanza a TODAS las apariciones` |
| **RBM9.9** (comportamiento, BLE GATT) | `adapter-ble-gatt.test.ts` → `§7.2: la desconexión con un BleError de la lib NO deja la MAC en el log` · `§7.2: el monitor que muere con un BleError tampoco filtra el id` · `§7.2: un error SIN código conocido pero CON la MAC adentro se blanquea` · `§7.2 (la CLASE): en un flujo entero, ningún message lleva el id` |
| **RBM9.9** (comportamiento, SPP) | `adapter-spp-android.test.ts` → `§7.2: la sonda que rechaza con la MAC adentro no la manda al log` · `§7.2 (la CLASE): el connect que falla con el mensaje del nativo tampoco filtra la MAC` |
| **RBM9.9** (comportamiento, MFi) | `adapter-mfi-ios.test.ts` → `§7.2: la sonda que rechaza con el SERIAL adentro no lo manda al log` · `§7.2: el connect que falla con el serial en el mensaje del nativo tampoco lo filtra` |
| **RBM9.10** (el union puede crecer) | `utils/scan-coverage.test.ts` → `el mutante de DOS LÍNEAS: con la entrada NO rompe, sin la entrada SÍ` · `el archivo REAL de hoy pasa por las dos` |
| **RBM9.10** (el freno de la allowlist) | `utils/scan-coverage.test.ts` → `cada exención trae su motivo ESCRITO EN EL LUGAR` · `la allowlist NO puede crecer sin que alguien lo note` · `cada archivo eximido EXISTE` · `cada exención está GANADA contra el árbol real` · `eximir de la RETENCIÓN no saca el archivo del escaneo` · `eximir del BALANCE no exime de la retención` · `LA PUERTA A LA ALLOWLIST ES UNA` · `los guards calculan el MISMO label` |
| **RBM5.13** (nota de reconciliación) | el mutante `${device.id}` ahora cae también en `REGLA B` (estático), además de los dos tests de comportamiento que ya existían |

## 5. Falsificación — 13 mutantes

Script propio (`scratchpad/mutantes-followup.mjs` + `m13.mjs`), backups con **nombre único mío**
(`impl-followup-<archivo>.bak`) fuera del repo, restauración verificada **byte a byte contra mis propios
backups**, y control positivo sin mutar en verde en la misma corrida. Ninguno toca el `LineFramer`, así que
no aplica el riesgo de suite colgada; el runner igual tiene `timeout` de 180 s por corrida.

| # | Mutante | Desenlace |
|---|---|---|
| M1 | §7.1 dos miembros al union **con** la entrada | **VERDE a propósito** (los 11 guards siguen en pie) |
| M2 | los mismos dos miembros **sin** la entrada | ROJO: 10 de 11 guards |
| M3 | el motivo pasa a ser `'ver el informe del Gate 2'` | ROJO: `cada exención trae su motivo ESCRITO EN EL LUGAR` |
| M4 | la exención vuelve a ser un `continue` (saca del escaneo) | ROJO: los dos tests de "angosta" |
| M5 | una segunda entrada sin subir el tope | ROJO: `la allowlist NO puede crecer…` |
| M6 | la entrada apunta a un archivo que NO viola el piso | ROJO: `cada exención está GANADA…` + la demostración |
| M7 | `adapter-ble-gatt` vuelve a interpolar el message crudo | ROJO: `REGLA A` + 2 de comportamiento |
| M8 | `adapter-spp-android` idem | ROJO: `REGLA A` + 1 de comportamiento |
| M9 | `adapter-mfi-ios` idem | ROJO: `REGLA A` + 1 de comportamiento |
| M10 | se cae el código 201 de la tabla | ROJO: el oráculo derivado + 2 de `error-text` + 1 del adapter |
| M11 | el blanqueo es un no-op | ROJO: 6 tests entre `error-text`, SPP y MFi |
| M12 | vuelve `${device.id}` al message del no-reconocido | ROJO: `REGLA B` |
| M13 | la misma fuga por **concatenación** (`'…' + device.id`) | ROJO: `REGLA B` |

Los dos criterios de aceptación que pidió el leader quedan medidos **en las dos direcciones**: M1/M2 para
§7.1 y M7/M8/M9 para §7.2.

## 6. Autorrevisión adversarial

Qué busqué, qué encontré y cómo lo cerré:

1. **Que la allowlist fuera una puerta ancha — ENCONTRADO Y CORREGIDO.** Mi primera versión dejaba viva la
   opción `allow` del call site *además* de la lista compartida. Dos puertas a una allowlist es una allowlist
   sin freno: la segunda no la mira nadie. Ahora la opción **reemplaza** a la compartida, existe solo para el
   test que necesita medir con y sin la entrada, y hay un test que verifica que ningún guard la pase.
2. **Que ese test de "una sola puerta" fuera ciego — ENCONTRADO Y CORREGIDO.** Escaneaba `app/app` +
   `app/src`, pero **dos guards viven en la raíz de `app/`** (`ios-purpose-strings-guard`,
   `eas-profiles-guard`): un guard nuevo ahí con una `allow` inline se habría colado. Se agregó la raíz.
3. **Que la entrada compartida no cubriera a todos.** Depende de que los once guards calculen el mismo
   `label`; si uno etiquetara distinto, se pondría rojo igual y el diagnóstico volvería a estar a diez guards
   del síntoma. Se agregó el test que lo exige (y valida los alias `rel`/`relOf` contra su definición).
4. **Que el guard de §7.2 fuera solo sobre `${…}` — ENCONTRADO Y CORREGIDO.** `message: 'x: ' + device.id`
   es la misma fuga con otra sintaxis y se me escapaba. El extractor pasó a leer **la parte expresión** del
   valor (lo de adentro de `${…}` **más** lo que está fuera de toda comilla), con su mutante propio (M13).
5. **Que el guard se convirtiera en teatro por no ver nada.** Tres pisos con mensaje explícito: 6 superficies
   que loguean, 35 campos `message` leídos (piso 20), y la auto-verificación de `assertScanCoverage`. Más el
   test que dispara sobre el cuerpo VIEJO.
6. **Que el guard diera falsos positivos y terminara apagado.** Test explícito con los seis call sites
   correctos de hoy, incluidos los dos que parecen violarlo y no lo son: `ble_device_not_recognized` (texto
   literal) y `accessories.length` (un conteo, no una identidad).
7. **Que se perdiera diagnóstico.** Control positivo escrito: `'BluetoothLE is powered off'`,
   `'Cannot start scanning operation'` y `'Operation timed out'` **salen enteros**; un UUID de servicio no se
   blanquea; el test preexistente `liveness_lost … 'powered off'` sigue verde sin tocarlo.
8. **Que el fix del §7.1 se comiera a sí mismo.** Medí la retención de **todos** los archivos de producción
   que toqué: `scan-coverage.ts` quedó en 219 líneas / 0.443 y `error-text.ts` en 102 / 0.471. Si alguno
   hubiera caído bajo el piso, el arreglo habría necesitado una segunda entrada — que es exactamente lo que
   el tope prohíbe.
9. **Que la tabla de códigos se pudriera.** Es el modo de falla del union `RejectReason` recopiado: por eso
   el oráculo la **deriva** de `node_modules` en vez de compararla contra otra copia a mano.
10. **Fail-closed y comportamiento.** Ninguna de las tres suites de adapter cambió de veredicto: los tests
    que verifican que la sonda que rechaza sigue cayendo del lado cerrado (`scanning`/`disconnected`) están
    aserdios **dentro** de los tests nuevos, no aparte.
11. **Multi-tenant / offline-first.** El diff no toca red, Supabase, PowerSync ni `establishment_id`: es
    transporte local y un meta-guard de tests. El invariante que sí estaba en juego —**manual-first**
    (R7.2 / RBM9.5)— no se movió: ningún camino nuevo desconecta ni tira.

### Residuales, declarados (ninguno bloqueante)

- **Un texto armado en otro archivo y logueado por variable** se le escapa al guard estático (es data flow).
  Cubierto por el barrido de comportamiento, que mira los eventos emitidos.
- **`BleError.reason`** (el mensaje específico de plataforma) podría traer el id. Hoy **nadie lo lee** —
  `rawErrorText` no lo mira—, y prohibir `.reason` daría falsos positivos sobre los campos `reason` legítimos
  de tres eventos del union. Si algún día se lee, cae en la REGLA A por el mismo mecanismo.
- **Un mensaje con un UUID de device, sin `errorCode` y sin que el call site pase el `deviceId`** saldría
  entero. Los cuatro call sites donde hay un device en juego **sí** lo pasan; los demás no tienen uno.
- `SCAN_COVERAGE_ALLOW` es una constante de guard que vive en `app/src` (o sea, viaja en el bundle). Es el
  mismo compromiso que ya tiene `assertScanCoverage`, y su motivo está escrito arriba del archivo: el
  `tsconfig` del cliente no type-checkea los `.test.ts`.

## 7. Reconciliación de specs (hecha, no pendiente)

- `requirements-ios-ble-mfi.md`: **RBM9.9** (el identificador fuera del free-text) y **RBM9.10** (el catálogo
  de eventos puede crecer) nuevos, cada uno con su as-built, la medición y lo que se descartó. Nota de
  reconciliación bajo **RBM5.13** ("de la instancia a la clase"). No se reescribió ningún EARS existente —
  patrón `impl_13`.
- `design-ios-ble-mfi.md`: **§4.2** con el as-built completo del follow-up, y se **cerró el pendiente** que
  §4.1 había dejado abierto ("queda como recomendación al leader" → "CERRADO en §4.2", con la aclaración de
  que el kind propio dejó de estar bloqueado pero no se cambió igual: la forma de sub-evento sigue siendo la
  correcta para esa familia).
- `tasks-ios-ble-mfi.md`: fase **F5-followup** con TG.1–TG.10 en `[x]`, y el mapa `RBM<n> → task` actualizado
  (RBM9.9, RBM9.10 y el agregado de TG.6 a RBM5.13).

## 8. Verificación

Corrido con el runner directo del proyecto (`check.mjs` levanta las 16 suites contra la DB DEV **compartida**
con la otra terminal y este diff no toca backend):

| Stage | Resultado |
|---|---|
| `pnpm typecheck` (app) | ✅ |
| `client unit tests` (la lista explícita completa de `run-tests.mjs`) | ✅ **3503 / 3503** (eran 3467: +36 exactos) |
| `scripts unit tests` (incluye el guard estático de `run-tests.mjs`) | ✅ 77 / 77 |
| `request-headers rename guard` (rebrand fase 5 — el bloque compartido) | ✅ 14 / 14 |
| Mutantes | ✅ 13 / 13 con el desenlace esperado, control positivo verde, árbol restaurado byte a byte |

- **Gate 2.5 / capturas (ADR-029): N/A.** El follow-up es de logging y de un meta-guard de tests; no toca
  ninguna pantalla, componente, sheet ni copy. No se corrió `pnpm e2e`: no hay superficie de UI en el diff y
  una corrida re-renderiza 40+ `design/**/*.png` con diffs espurios.
- **Archivos de la otra terminal: no tocados.** `feature_list.json`, `progress/current.md`,
  `progress/estado_delta-ios-ble-mfi.md`, `supabase/`, `sync-streams/`, spec 09, spec 24,
  `scripts/check.mjs` y `scripts/lib/stage-runner.mjs` están intactos (`git status --porcelain
  --untracked-files=all` cruzado contra mi lista). De `scripts/run-tests.mjs` —compartido— se tocó **solo**
  el bloque de tests del cliente (un comentario + tres paths en la lista), y se verificó que el stage de
  **rebrand fase 5** y el de `stage-runner` siguieran intactos y en verde.
- **Sin churn de CRLF**: `git diff --stat` y `git diff -w --stat` dan idéntico, en código y en specs.
- **No se commiteó**, como pidió el leader.

## 9. Diff (15 archivos, ninguno backend)

```
app/src/utils/scan-coverage.ts                        +72 / -10   allowlist compartida + exención angosta
app/src/utils/scan-coverage.test.ts                   NUEVO (403 líneas, 10 tests)  el freno + la demostración
app/src/services/ble/error-text.ts                    NUEVO (113 líneas)            el convertidor único
app/src/services/ble/error-text.test.ts               NUEVO (201 líneas, 12 tests)  con el oráculo derivado
app/src/services/ble/log-device-identifier-guard.test.ts  NUEVO (373 líneas, 6 tests)  el guard sobre la ausencia
app/src/services/ble/adapter-ble-gatt.ts              +15 / -21   fuera el helper local, entra safeErrorText
app/src/services/ble/adapter-ble-gatt.test.ts         +120        4 tests de §7.2
app/src/services/ble/adapter-spp-android.ts           +11 / -8    idem (la fuga era anterior al baseline)
app/src/services/ble/adapter-spp-android.test.ts      +77         2 tests de §7.2
app/src/services/ble/adapter-mfi-ios.ts               +15 / -17   idem + el `target` fuera del `try`
app/src/services/ble/adapter-mfi-ios.test.ts          +68         2 tests de §7.2
scripts/run-tests.mjs                                 +19 / -1    registro de los 3 tests + el porqué
specs/active/04-bluetooth-baston/{requirements,design,tasks}-ios-ble-mfi.md   reconciliación
```
