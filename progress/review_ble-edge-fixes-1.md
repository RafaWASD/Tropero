# Review — unidad «dos 🔴 del barrido de edge cases del bastón»

**Veredicto**: **CHANGES_REQUESTED**
**Baseline**: `1f1c002`, diff sin commitear. **Fecha**: 2026-08-06. **Reviewer**: read-only (no se editó código; ningún `git add`).

> **Método**: además de leer, **falsifiqué los guards con 14 mutantes ejecutados**. Cada mutante se aplicó a
> byte, se corrió la suite, y se restauró desde una copia propia en el scratchpad — **nunca con `git checkout`**,
> que acá habría destruido trabajo sin commitear. Verificación de la restauración al final: los 14 archivos
> `cmp`-idénticos a la copia, `git status` con las mismas 51 entradas que al empezar, `design/` limpio.
> Etiquetas: **[EJECUTADO]** = lo corrí y lo vi · **[LEÍDO]** = verificado línea por línea, sin ejecutar.

---

## 1. Resultado de los mutantes (lo principal que se pidió)

Suites corridas por mutante: `read-dispatch` + `bulk-assign-empty` + `listener-gate` + `wiring` +
`maniobra-listen-state` (49 casos). **[EJECUTADO]**

| # | Mutante | Resultado |
|---|---|---|
| M1 | `playFeedback(true)` antes del gate (el bug canónico) | MUERE (2 guards) |
| M2 | `const fb = playFeedback; fb(true)` antes del gate (alias) | **SOBREVIVE** |
| M3 | `hapticTick()` (otra API de vibración del repo) antes del gate | **SOBREVIVE** |
| M5 | `stick.ts:74` — nullish por OR lógico | **SOBREVIVE** (+ typecheck limpio) |
| M5b | `stick.ts:74` se olvidan de invocar: `acceptsRef.current ?? true` | sobrevive la suite, la mata `tsc` |
| M6 | CALL SITE: el `acceptsRead` del overlay deja de mirar la ruta dueña | **SOBREVIVE** |
| M6b | DIVERGENCIA: `accepts` miente y el callback corta adentro (vibra y tira) | **SOBREVIVE** |
| M7 | Consumidor NUEVO sin `accepts` en `maniobra/carga.tsx` | MUERE (tabla) |
| M8 | Consumidor NUEVO por destructuring (`const { subscribeTagRead } = api`) | **SOBREVIVE** |
| M8b | Consumidor NUEVO por alias de import (`useBleStickListener as useStick`) | **SOBREVIVE** |
| M9 | CALL SITE: la función pura devuelve el CTA y el JSX **no lo renderiza** | **SOBREVIVE** |
| M10 | Control: `accepts: () => true` en el overlay | MUERE |
| M11 | Control: se borra el log del descarte | MUERE |
| M12 | Control: `bulkAssignEmptyView` ignora `isConnected` | MUERE (4 rojos) |

Los controles confirman que **los guards sí matan las formas que declaran matar**. Lo que fallan es el borde:
todos los sobrevivientes reintroducen el defecto por un camino que el guard no modela.

---

## 2. Cambios requeridos, por prioridad

### 🔴 A — El cableado de `accepts` se anula con un cambio de dos caracteres, y el guard que existe para eso no lo ve. [EJECUTADO]

`app/src/services/ble/stick.ts:74`

    () => acceptsRef.current?.() ?? true,   // hoy
    () => acceptsRef.current?.() || true,   // M5: TODO consumidor acepta siempre -> el fix es un no-op TOTAL

Con M5 aplicado: `pnpm exec tsc --noEmit` da **RC=0** y las 49 aserciones quedan **verdes**. El 🔴-2 vuelve
entero (el overlay global está siempre suscripto, siempre hay "consumidor", el provider vuelve a confirmar
en `maniobra/carga`) y `check.mjs` no puede verlo.

El guard que debería cazarlo es `read-dispatch.test.ts:400-438` («el mecanismo existe de las dos puntas»):
`assert.match(hook, /subscribeTagRead...acceptsRef/)`. Eso prueba que **el token `acceptsRef` aparece** en
algún lugar después de `subscribeTagRead(`. No prueba que su valor se **respete**. Es exactamente el defecto
que la otra unidad ya pagó esta noche: el guard está escrito sobre la forma del código y no sobre el
comportamiento.

**Fix pedido**: sacar la composición del módulo de React y verificarla por comportamiento. P. ej. exportar
desde `read-dispatch.ts` una `resolveAccepts(ref)` y asertar **ejecutando** que
`resolveAccepts({current: () => false})()` es `false` y que `resolveAccepts({current: undefined})()` es
`true`. Eso mata M5 y M5b sin depender de un regex. Cualquier oráculo equivalente sirve; lo que no sirve es
otro `assert.match`.

### 🔴 B — Las specs quedaron contradiciendo el as-built, y no hay ningún R-n al que trazar este trabajo. [LEÍDO]

Es el paso 6 de mi protocolo y la regla del repo («toda corrección se reconcilia en las specs **antes** de
cerrar»). La unidad hermana sí reconcilió (T-MV.4.8 + notas en RMV3.5/RMV3.6). **Esta no reconcilió nada.**

1. `specs/active/09-buscar-animal/design-09resto-dedup.md:274-277` — describe el as-built como
   `bulkAssignEmptyView(hasTransport)` (parámetro único obligatorio), **dos** estados, *"Con transporte, el
   vacío queda carácter por carácter como antes (fijado en un test de regresión)"* y *"unit (5) + E2E (2)"*.
   Todo eso es **falso hoy**: la firma es un objeto, hay **tres** estados, con transporte y desconectado el
   copy es **nuevo**, y son **9 unit + 3 E2E**.
2. `specs/active/09-buscar-animal/tasks-09resto-dedup.md:73` (F5.6) — repite lo mismo, con los mismos números.
3. `specs/active/09-buscar-animal/design-09resto-dedup.md:253` — *"No hay gating per-suscriptor en el
   provider"*. Es la premisa con la que se justificó hacer el overlay route-aware, y **dejó de ser cierta**:
   `accepts` **es** gating per-suscriptor en el provider. El próximo que lea ese párrafo va a volver a
   inventar el mecanismo que ya existe.
4. `specs/active/04-bluetooth-baston/requirements.md:215` (**R10.4**) — *"deberá implementar
   useBleStickListener(opts: { enabled, onTagRead }) con la firma exacta que spec 09 declaró"*. As-built:
   `{ enabled, onTagRead, accepts? }`. Idem `09.../design.md:180`, `context-09resto-ble-global.md:34` y
   **RB3.1** (`requirements-09resto-ble-global.md:57`, *"firma exacta de stick.ts"*). Es un **contrato
   público** extendido, y `CLAUDE.md` lo lista entre las cosas que se confirman antes de tocar.
5. `specs/active/04-bluetooth-baston/requirements.md:69` (**R4.1**) — *"deberá emitir vibración táctil...
   siempre (no apagable)"*. La excepción «sin consumidor, sin confirmación» hoy vive **solo en un comentario
   de código**. Tiene defensa (sin consumidor el contrato nunca *confirma*, así que R4.1 no se viola en su
   letra), pero eso es precisamente lo que hay que escribir, no dejar que se deduzca.
6. **No existe en ninguna spec**: el 🔴-2, `read-dispatch.ts`, el invariante, el evento
   `read_dropped_no_consumer`, ni la decisión sobre la ventana de dedup. **Sin un R-n nuevo no hay
   trazabilidad posible** (ver §3) ni entrada de task que marcar (ver §4).

**Fix pedido**: nota de reconciliación as-built en `design-09resto-dedup.md` (§4.2 y §4.6) y en
`requirements.md` / `design-multivendor.md` de 04 (R4.1, R10.4), EARS nuevo para el invariante, y una task
`[x]` en el `tasks.md` que corresponda, con el nivel de detalle de T-MV.4.8.

### 🟠 C — El CTA nuevo crea un camino de doble consumo que antes no existía. [LEÍDO, no ejecutado]

`asignar-caravanas.tsx:428` hace `router.push({ pathname: '/baston' })`. En un Stack **la pantalla de origen
queda MONTADA**. Y `asignar-caravanas`:

- suscribe por montaje, no por foco (`useBleStickListener` en `:209`);
- su `acceptsRead` (`:179`) es solo `establishmentIdRef.current !== null`, o sea **sigue en true**;
- **no consulta `scopedScannerActive`** (grep: no aparece en el archivo).

`StickConnectionScreen` toma el scanner acotado al foco (`:181`), pero **el único que honra
`scopedScannerActive` es el `FindOrCreateOverlay`**. Resultado esperado: un bastonazo hecho en `/baston`
**después de llegar por el CTA nuevo** lo consumen **dos**: la lista de `/baston` **y** la cola masiva de
atrás, en silencio. El peón vuelve y tiene un EID encolado que no pidió, y como la ventana de dedup ya se
consumió, re-bastonear ese animal en la masiva dentro de los 3 s no hace nada.

Es el 🟠-8 **(b)** del barrido, que había quedado *"sin probar"*: **esta unidad le construye el disparador**.
Antes `/baston` solo se alcanzaba desde "Más" o por deep-link, con `asignar-caravanas` desmontada.

**Oráculo para dirimirlo** (1 minuto): entrar a la masiva con el bastón desconectado, tocar «Conectar el
bastón», conectar, bastonear, volver atrás y mirar la cola y el contador. Si el EID está, hay que decidir; lo
más barato es que el `acceptsRead` de `asignar-caravanas` incluya `!scopedScannerActive`, que es la respuesta
que el overlay ya da.

### 🟠 D — El fail-open del predicado no está acotado: manda un predicado roto a un loop de despacho sin red. [LEÍDO]

`read-dispatch.ts:96-112` cuenta como destinatario al suscriptor cuyo `accepts()` **tira**, y entrega su `cb`
a `BleStickListenerProvider.tsx:238` (`for (const cb of targets) cb(candidate.eid);`), **sin try/catch**.

Los cuatro consumidores `declares-accepts` arrancan su callback con `if (!acceptsRead()) return;`, **la misma
función que acaba de tirar**. O sea: vuelve a tirar, ahora **adentro del loop**, y la excepción se escapa de
`handleReading` hacia `SppAndroidAdapter.emitTag` (`adapter-spp-android.ts:1274-1276`, **también sin
try/catch**).

Neto: la lectura **se pierde igual** (el callback nunca llega a su cuerpo) **y encima** una excepción sube al
loop de lectura del transporte. La justificación escrita —*"El callback igual tiene sus propias guardas
adentro"* (`read-dispatch.ts:93-94`)— **es exactamente la función que falló**. No compro el argumento tal
como está redactado: no es "una confirmación de más" contra "un bastón mudo", es "una confirmación de más,
**más la lectura perdida igual, más una excepción suelta**".

No lo marco 🔴 porque hoy los cuatro predicados son lecturas de ref y no pueden tirar de verdad. Pero la rama
**no tiene un solo test de punta a punta** y su fundamento está mal escrito. Mínimo: envolver el despacho en
un try/catch que loguee, y corregir el comentario. Si se envuelve, el fail-open queda acotado y lo compro.

### 🟠 E — Los guards son más angostos que el invariante que declaran. [EJECUTADO]

El invariante dice *"no se emite **feedback sensorial**"*; lo que está cercado es *"no se llama
`playFeedback`"*.

- **M2** (alias de `playFeedback` antes del gate) da 49/49 verde. Lo caza el E2E (el contador de beeps mide
  `playFeedback`), **no** `check.mjs`.
- **M3** (`hapticTick()` antes del gate) da 49/49 verde **y también pasaría el E2E**: `src/utils/haptics.ts`
  es un **segundo canal de vibración real y vivo en el repo** (lo usan el reorder y la rueda) que no toca
  `AudioContext`. Ese se escapa de los dos oráculos.
- **M8 / M8b**: `CONSUMER_CALL` (`read-dispatch.test.ts:262`) solo matchea `useBleStickListener(` y
  `.subscribeTagRead(`. Un `const { subscribeTagRead } = api;` (idiomático en React) o un
  `import { useBleStickListener as useStick }` agregan un consumidor con la tabla en verde.

Sugerencia acotada: que el guard del feedback se escriba **sobre la ausencia** (ningún `Vibration`, `vibrate`
o `haptic*` dentro de `services/ble/` fuera de `feedback.ts`, y ninguno dentro de `handleReading`), que es la
forma que este repo ya usa para bugs de clase. Y que `CONSUMER_CALL` cubra el identificador pelado.

### 🟡 F — La capa de RENDER del 🔴-3 no tiene oráculo en `check.mjs`. [EJECUTADO]

**M9**: borrar el bloque del CTA (`asignar-caravanas.tsx:426-432`) dejando la función pura intacta da
**49/49 verde**. El peón vuelve al pozo mudo: se entera de que el bastón no está conectado y no tiene botón.
Los tres guards de call site (`bulk-assign-empty.test.ts:184-212`) fijan **el flujo de props**, no que el CTA
se pinte. Lo cubre solo `asignar-caravanas-sin-transporte.spec.ts` (b), y el E2E **no corre en `check.mjs`**.

### 🟡 G — Acoplamiento con la otra unidad sin commitear.

`asignar-caravanas-sin-transporte.spec.ts:143` (y el capture `:108`) anclan en
`getByTestId('stick-devices-section')`, un `testID` que **agrega la OTRA unidad** en
`StickConnectionScreen.tsx:397`. Esta unidad **no se puede commitear sola**: sin ese testID, (b) se cae.
Además `scripts/run-tests.mjs` trae en un solo edit los registros de **las dos** unidades
(`nav-target-bands` y `tap-target-collision-guard` son de la otra), así que tampoco se puede stagear por
unidad tal como está.

### 🟡 H — `StickConnectionScreen` se declara `always` pero solo es dueña del bastón **con foco**. [LEÍDO]

La tabla (`read-dispatch.test.ts:255-259`) lo justifica con *"mientras está montada consume todas"*. Pero la
propia pantalla ya decidió que **montada no es lo mismo que en foco**: su `acquireScopedScanner` es
`useFocusEffect` (`:181`) y su `subscribeTagRead` es un `useEffect([api])` (`:187-197`). Montada-sin-foco
sigue contando como consumidor, así que `drop_no_consumer` no puede dispararse mientras esté en el stack y la
lectura aterriza en una lista que nadie mira. Es la misma clase de divergencia que la unidad vino a cerrar,
del otro lado de la tabla.

### 🟡 I — La puerta MANUAL va a caer en la misma trampa el día que se cablee. [LEÍDO]

`ManualAdapter.submit()` **no tiene un solo call site** (grep verificado), así que hoy la puerta manual no
pasa por `handleReading` y no hay regresión. Cuando se cablee (spec 04 **R7.1**: *"la carga manual alimenta el
MISMO contrato"*), el gate de `accepts` va a **tragarse el EID tipeado a mano** en el `TagScanSheet`: su
`acceptsRead` (`TagScanSheet.tsx:143`) es `!assigningRef && !manualModeRef`, o sea **falso justo cuando el
operario está tipeando**. El predicado se llama "acepto esta lectura" pero gatea las dos puertas. Mínimo, una
advertencia en la cabecera de `read-dispatch.ts`.

### ⚪ J — El evento de log nuevo no tiene test.

`wiring.test.ts:105` cubre `read_loop_error`; nada ejecuta
`logTransportEvent({ kind: 'read_dropped_no_consumer', subscribers: 0 })`. El guard solo verifica que el
literal aparezca en el provider.

### ⚪ K — El `<Text fontSize="$4">` de `view.body` (`asignar-caravanas.tsx:420`) no lleva `lineHeight`, y el aviso de `:416` sí.

Pre-existente, pero el cuerpo nuevo ('connectable') es **el más largo de los tres** y el más propenso a
envolver, que es cuando el recorte de descendentes muerde.

### ⚪ L — Copy: «Prendé el bastón» es falso en dos de los casos que el propio módulo nombra.

`bulk-assign-empty.ts:238-248` documenta que 'connectable' incluye *"fuera de rango"* y *"la cadena de
reconexión se agotó"*: ahí el bastón **ya está prendido**. El CTA funciona igual, así que es cosmético. El
resto del copy pasa bien la lente del peón: dice **qué pasa** ("El bastón no está conectado"), **qué tocar**
(nombra el botón textual) y deja la **segunda salida** (la ficha). Voseo, sin jerga, verificado por
`bulk-assign-empty.test.ts:82`, que prohíbe BLE / pairing / SPP / adapter / bluetooth.

### ⚪ M — Bookkeeping.

Las features 4 (`04-bluetooth-baston`) y 9 (`09-buscar-animal`) están en **`deferred`** en
`feature_list.json` mientras su código produce y sus specs viven en `specs/active/`. **No hay ninguna feature
`in_progress`** a la que colgar esta unidad. Pre-existente, no lo causó esta unidad.

---

## 3. Trazabilidad R-n ↔ test

**No hay ningún R-n nuevo para esta unidad** (ver 🔴-B.6): el invariante del 🔴-2 no está en ninguna spec.
Lo que sigue es la trazabilidad contra los EARS **existentes** que la unidad toca.

| R-n | Test concreto | Estado |
|---|---|---|
| 04 **R4.1 / R4.4** (feedback al confirmar), ahora con la excepción «sin consumidor» | `read-dispatch.test.ts:37-74` (decisión pura) + `:143-203` (orden dentro del provider) + `e2e/baston-lectura-sin-consumidor.spec.ts` (contador de confirmaciones, los dos lados) | test OK / **el EARS no describe la excepción** |
| 04 **R3.1** (ventana de dedup desde la última ingesta confirmada) | `read-dispatch.test.ts:170-186` (el motor corre después del gate) + `dedup.test.ts` | OK |
| 04 **R10.4** (firma del hook) | `read-dispatch.test.ts:400-409` | **guard burlable (🔴-A)** + **el EARS quedó viejo** |
| 04 **R15.1** (logging no bloqueante) | `read-dispatch.test.ts:198-202` (que se loguea) | el payload nuevo no se ejecuta nunca (⚪-J) |
| 09 **RD5.2** (estado vacío de la masiva) | `bulk-assign-empty.test.ts:34-161` (9 casos, con mutantes propios) + `e2e/asignar-caravanas-sin-transporte.spec.ts` (a)(b)(c) | pura OK / **el render no tiene oráculo en `check.mjs`** (🟡-F) |
| 09 **RB3.1** (el overlay consume el hook) | `read-dispatch.test.ts:332-398` (declara `accepts` y es el mismo que gatea el callback) | **guard burlable desde el call site (M6/M6b)** |
| invariante «sin consumidor no se emite feedback ni se consume la ventana» | `read-dispatch.test.ts` completo + los dos E2E | **sin R-n que lo declare** |

---

## 4. Tasks completas

**NO.** No hay entrada de task para esta unidad en ningún `tasks.md`.
`specs/active/04-bluetooth-baston/tasks-multivendor.md` sumó **T-MV.4.8**, que es de la **otra** unidad, y
`specs/active/09-buscar-animal/tasks-09resto-dedup.md` sigue con **F5.6** describiendo el as-built de julio.
No es que quede un `[ ]` sin justificar: es que **no se escribió la task**.

---

## 5. CHECKPOINTS

- **C1** — [ ] `node scripts/check.mjs` **no verificado por mí** (me lo prohibió el encargo por la unidad viva
  en paralelo; la corrida previa del leader dio RC=0). Archivos base y docs existen: [x].
- **C2** — [ ] Ninguna feature en `in_progress`; 04 y 09 en `deferred` con código productivo (⚪-M).
  `progress/current.md` describe la sesión: [x].
- **C3** — [x] Capas respetadas (`services/ble`, `utils`, `components`, `app/`); sin dependencias nuevas en
  `package.json`; sin logs de debug sueltos; **sin `establishment_id` hardcodeado** (se lee del contexto por ref).
- **C4** — [x] con reserva: **121/121 verdes** en las 9 suites de la unidad **[EJECUTADO]**; el runner muestra
  más de 0 tests. La reserva es 🔴-A: el módulo de cableado (`stick.ts`) **no tiene test de comportamiento**,
  solo un regex.
- **C5** — [x] Sin artefactos temporales; `design/` limpio; nada mío quedó en el árbol.
- **C6** — [ ] **Rechazado**: las specs contradicen el as-built (🔴-B), no hay R-n para el invariante, no hay task.
- **C7** — **N/A** (sin tablas, sin SQL, sin migraciones).
- **C8** — [x] No se agrega una sola llamada de red; todo el fix es puro o local (provider + funciones puras +
  render). El vacío nuevo lee estado del provider, no de Supabase.
- **C9** — [ ] Las suites E2E existen y **colectan 9 tests** en 3 archivos **[EJECUTADO: `playwright --list`]**;
  el capture file existe (`e2e/captures/baston-edge-fixes-1.capture.ts`, 7 shots). **El Gate 2.5 no se corrió**
  (el propio informe del leader lo declara pendiente), así que falta el veto visual con las capturas a la vista.

---

## 6. Checklist RAFAQ-específico

### A — multi-tenancy / RLS
**N/A.** La unidad no crea ni toca tablas, policies, funciones SQL ni migraciones.

### B — offline-first
- [x] Funciona offline: no se agrega ninguna llamada a red; `read-dispatch.ts` y `bulk-assign-empty.ts` son
  puros, y el estado vacío se decide con estado del provider (radio + refs locales).
- **N/A** sync bucket: no hay datos nuevos que sincronizar.
- **N/A** resolución de conflictos: no hay escritura.
- [x] Sin requests síncronos a Supabase desde la pantalla: el `onTagRead` de `asignar-caravanas` sigue
  corriendo `lookupByTag`, que es lectura **local** de SQLite, sin cambios.

### C — BLE
- [x] Desconexión repentina con UI clara: **es el 🔴-3**, y el estado nuevo la nombra y da salida. El
  *reintento* al volver a foreground sigue pendiente (§2 y §5 del barrido), fuera de alcance.
- [ ] **Modo manual de fallback en 1 tap o menos: NO se cumple en `asignar-caravanas`.** Sigue siendo la única
  pantalla BLE-only **sin entrada manual**; el fix ofrece un CTA a `/baston` y un **texto** que apunta a la
  ficha, no un tap. **Justificación**: es la decisión de producto vigente de RD5.2, documentada en
  `design-09resto-dedup.md` §4.6, anterior a esta unidad. **No bloqueo por esto**, pero queda dicho: el pozo
  se hizo menos hondo, no se tapó.
- **N/A** correlación TAG-peso: esta unidad no toca pesaje.
- [x] Los logs no bloquean: `logTransportEvent` es best-effort (`wiring.test.ts` lo verifica) y el descarte
  loguea **después** de decidir, sin await.

### D — UI de campo
- [x] Target del CTA: `Button` con `minHeight: '$touchMin'` = **56 dp** (`src/components/Button.tsx:7,23`)
  más `fullWidth`. El checklist genérico pide 60; **56 es el token canónico del repo** para "manga-friendly",
  no una decisión de esta unidad.
- [ ] **Fuente de 18 pt o más: no se cumple en el cuerpo.** Título `$7` con `lineHeight="$7"`: bien. **Aviso y
  cuerpo a `$4` = 14 px** (`asignar-caravanas.tsx:416,420`). **Justificación**: es **exactamente** el
  tratamiento que ya tenían los otros dos estados de este mismo vacío y el `ManualPromptHero`, y el comentario
  de `:410-414` razona el contraste a propósito. Cambiarlo solo acá rompería la consistencia. **No bloqueo**;
  ver ⚪-K por el `lineHeight` faltante.
- [x] Una decisión por pantalla: el vacío tiene **un** CTA primario.
- **N/A** loading: el estado vacío es síncrono, no hay espera que mostrar.

### E — Edge Functions
**N/A.** Ninguna.

---

## 7. Lo que confirmo y lo que contradigo del informe del leader

| Afirmación | Veredicto |
|---|---|
| `pnpm exec tsc --noEmit` limpio | **CONFIRMADO** [EJECUTADO]: RC=0, cero salida |
| Suites propias verdes | **CONFIRMADO y ampliado** [EJECUTADO]: **121/121** sobre las 9 suites de la unidad (los 52/52 del leader eran un set más chico) |
| `run-tests.mjs` parsea, sin duplicados, guard registrado | **CONFIRMADO** [EJECUTADO]: `node --check` OK; el comando principal tiene 149 archivos y 0 duplicados; `read-dispatch.test.ts` y `bulk-assign-empty.test.ts` presentes |
| `design/` limpio | **CONFIRMADO**, y sigue limpio después de mis 14 mutantes |
| `node scripts/check.mjs` RC=0 | **NO VERIFICADO** por mí (prohibido en el encargo) |
| 18/18 E2E de bastón, 2/2 `fab-target-geometry` | **NO VERIFICADO** por mí. Solo confirmé que los 3 archivos relevantes **colectan 9 tests** con `playwright --list` |
| *"Hay una sola función acceptsRead... No pueden divergir"* | **CONFIRMADO como hecho, REFUTADO como garantía.** [LEÍDO] Los **cuatro** consumidores (`FindOrCreateOverlay.tsx:168`, `identificar.tsx:183`, `asignar-caravanas.tsx:179`, `TagScanSheet.tsx:143`) definen **una** función y la usan de los dos lados; **hoy ninguno diverge**, y `/baston` no declara `accepts` de forma consistente con su callback. Pero **M6b lo falsificó**: el guard exige que exista la línea `if (!acceptsRead()) return`, **no prohíbe un SEGUNDO return temprano** en el callback. Agregar uno deja 49/49 en verde con el bug "peor" (vibra y el callback tira) puesto |
| La decisión sobre la ventana de dedup | **LA COMPRO.** [LEÍDO] R3.1 (`requirements.md:55`) dice literalmente *"desde la última **ingesta confirmada**"*, y `dedup.shouldEmit` se llama **únicamente** dentro de `processRawLine` / `processEid` (`contract.ts:107-123`), que ahora corren después del gate: una lectura descartada **no puede** quemar la ventana. No rompe el banco del ESP32: sus escenarios de dedup (1/2/8 exacto) corren sobre `maniobra/identificar`, que **sí** tiene consumidor, o sea toman el camino `process` sin cambios. El banco no lo re-corrí |
| El invariante es el correcto | **SÍ** en su **enunciado** y en el **orden** (gate antes del feedback y antes del motor). **NO** en su alcance de enforcement: hay un camino que emite feedback sin pasar por `resolveReadHandling`, que es cualquier `Vibration` / `haptics` (🟠-E, M3), y `src/utils/haptics.ts` es un canal vivo del repo. Hoy `playFeedback` tiene **un solo call site** (grep verificado: `BleStickListenerProvider.tsx:226`), después del gate |
| Regresión del camino feliz | **Sin evidencia de apagado de más** [LEÍDO]: los refs se asignan **en render** (no en efectos) en los cuatro consumidores, así que no hay ventana de `accepts` stale al montar; `/baston` acepta siempre; y `ManualAdapter.submit()` no tiene call sites, así que la puerta manual no pasa por el gate. El 18/18 del leader no lo re-corrí |

---

## 8. Lo positivo, que también es parte del veredicto

- El diagnóstico del leader sobre `subscribers.size === 0` era correcto y el rediseño a `accepts()` es la
  respuesta buena: cambia la pregunta de *"¿hay alguien suscripto?"* a *"¿hay alguien que va a actuar?"*.
- El E2E `baston-lectura-sin-consumidor.spec.ts` es el mejor pedazo de la unidad: convierte *"¿el producto le
  confirmó al peón?"* en un **número observable** en web (contador de `AudioContext`) y trae el contrafáctico
  (a) para que no pueda pasar por "no confirmar nunca".
- El implementer encontró y arregló tests que **estaban asertando el bug**:
  `asignar-caravanas-sin-transporte.spec.ts` (b) verificaba *"Bastoneá para empezar"* sobre un mock
  **desconectado**. Lo mismo en `baston-dedup.spec.ts` (c) y (d), y en `dedup-screenshot.spec.ts`.
- Los tres guards de call site de `bulk-assign-empty.test.ts:184-212` y la falsificación con mutantes de
  `:120-161` están bien pensados: **M12 los pone en 4 rojos**.
- El descarte se **loguea**: el silencio correcto es indistinguible del bastón mudo, y sin ese evento el
  agujero de producto sería invisible.

---

## 9. Qué hace falta para que esto pase a APPROVED

1. **🔴-A**: `stick.ts:74` verificado por **comportamiento**, no por regex. Que M5 y M5b mueran.
2. **🔴-B**: reconciliar `design-09resto-dedup.md` (§4.2 y §4.6), `tasks-09resto-dedup.md` F5.6, R10.4 y R4.1
   de 04; EARS nuevo para el invariante; task escrita.
3. **🟠-C**: dirimir el doble consumo `asignar-caravanas` contra `/baston` con el oráculo de §2-C. Si se
   confirma, arreglarlo: lo trae el CTA nuevo, no es un pre-existente.
4. **🟠-D**: envolver el loop de despacho o sacar el fail-open, y corregir el fundamento escrito.
5. **🟠-E, 🟡-F, 🟡-H, 🟡-I**: al menos decididas y escritas. Si alguna se difiere, que se difiera **por su
   consecuencia** y quede en `docs/backlog.md`, no en el silencio.
6. Gate 2.5 corrido con las capturas del `.capture.ts` a la vista (C9).
