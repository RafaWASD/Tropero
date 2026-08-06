# Unidad «dos 🔴 del barrido de edge cases del bastón»

> ⚠️ **Este informe lo escribió el LEADER, no el implementer.** El implementer murió **cinco veces** por
> errores 529 del API de Anthropic (servidor sobrecargado) y nunca llegó a escribir el suyo, ni siquiera
> cuando le cambié el orden para que lo escribiera primero. Lo que sigue es lo que **yo verifiqué
> ejecutando**, más lo que **leí** en su código. No es su relato de lo que hizo: es mi constatación de lo
> que quedó en el árbol. Todo lo que no pude verificar está marcado como tal.

**Origen**: `progress/sweep_bluetooth-edge-cases.md`, hallazgos 🔴-2 y 🔴-3.
**Baseline**: `1f1c002`. **Sin commitear.**

## 1. Qué quedó en el árbol

| Archivo | Qué |
|---|---|
| `app/src/services/ble/read-dispatch.ts` (**nuevo**) + `.test.ts` | decisión PURA de qué hacer con una lectura: `process` / `drop_listener_suspended` / `drop_no_consumer` |
| `app/src/services/ble/BleStickListenerProvider.tsx` | usa la decisión pura; cuenta consumidores que **aceptan**, no suscriptores |
| `app/src/services/ble/stick.ts` | el hook expone `accepts` en la suscripción |
| `app/src/services/ble/logging.ts` | evento nuevo de descarte sin consumidor |
| `app/app/_components/FindOrCreateOverlay.tsx` | `acceptsRead()` como fuente única |
| `app/app/maniobra/identificar.tsx`, `app/src/components/TagScanSheet.tsx` | declaran su `accepts` |
| `app/src/utils/bulk-assign-empty.ts` + `.test.ts` | el vacío mira el **estado de conexión**, no solo `hasTransport` |
| `app/app/asignar-caravanas.tsx` | pasa el estado real y ofrece salida |
| `scripts/run-tests.mjs` | registra el guard nuevo |

## 2. Lo importante: el fix es mejor que el que yo había encargado

Yo pedí *"no dispares feedback si `subscribers.size === 0`"*. **Eso habría sido un no-op**, y el implementer
lo detectó: el `FindOrCreateOverlay` es **global**, está siempre suscripto, y su supresión por ruta ocurre
**adentro** de su callback, donde el provider no la ve. Siempre hay ≥1 suscriptor.

El cambio real es de contrato: cada suscriptor declara un `accepts()` que se evalúa **en cada lectura**, y la
pregunta pasa de *"¿hay alguien suscripto?"* a *"¿hay alguien que vaya a ACTUAR?"*. Eso explica por qué la
unidad tocó `identificar.tsx`, `TagScanSheet.tsx`, `stick.ts` y `FindOrCreateOverlay.tsx`.

**Decisión sobre la ventana de dedup** (yo se la dejé abierta): la lectura descartada **no** la consume. El
argumento está en la cabecera de `read-dispatch.ts` y lo comparto: `TagDedup` documenta —y el banco del ESP32
verificó— que la ventana se mide *"desde la última emisión CONFIRMADA, no desde el último intento"*. Una
lectura que nadie recibió no es una emisión; registrarla quemaría el EID 3 s por algo que nunca salió. No
debilita la semántica: la restaura. Y hay precedente en el mismo archivo — el corte por listener suspendido
también sale antes del motor.

**El riesgo que le marqué y quedó cerrado.** Le advertí que el `accepts()` podía duplicar la guarda que el
callback ya tenía adentro, y que si divergían el bug volvía **peor** (vibra y el callback corta adentro) —
la misma clase que las tres copias de `toneColorToken` de esta misma noche. **Lo verifiqué leyendo**: hay una
sola función, `acceptsRead()` (`FindOrCreateOverlay.tsx:168-174`), que consultan los dos lados sobre las
**mismas refs**; el callback hace `if (!acceptsRead()) return;` como defensa en profundidad. No son dos
copias, es una función usada dos veces. No pueden divergir.

## 3. Verificación — qué EJECUTÉ yo

| Qué | Resultado |
|---|---|
| `pnpm exec tsc --noEmit` | **verde** |
| `node --test` sobre `read-dispatch` + `bulk-assign-empty` + `listener-gate` + `dedup` + `wiring` | **52/52** |
| Entre esos 52, tests de FALSIFICACIÓN y guards de invariante propios | presentes y en verde |
| `node --check scripts/run-tests.mjs` + duplicados dentro del comando | parsea; **sin duplicados** |

Los guards que más me importan, por nombre, porque están escritos sobre el invariante y no sobre la
instancia:
- *"guard: la PANTALLA le pasa el estado de conexión REAL (no un literal ni el transporte otra vez)"*
- *"guard: el criterio de conexión se REUSA (`resolveListenConnState`), no se re-inventa acá"*
- *"guard: la frase de «sin bastón» es LITERALMENTE la misma en las 3 superficies"*

## 4. Lo que NO está verificado — hay que cerrarlo antes de commitear

1. **No corrió `node scripts/check.mjs` completo.** Se lo prohibí a propósito: había otra unidad editando en
   vivo `nav-target-bands*` / `tap-target-collision-guard*` y levantaba archivos a medio escribir. **Lo corro
   yo cuando cierren las dos unidades.**
2. **Los mutantes contra los guards NUEVOS no se probaron.** El implementer no llegó. Es justamente lo que
   esta noche resultó crítico en la otra unidad: al reviewer le alcanzó **una línea** para reintroducir el
   bug con 30/30 en verde, porque el guard estaba escrito sobre la forma del bug y no sobre el invariante.
   **Este guard todavía no pasó por esa prueba.**
3. **Nada de esto se probó en device.** El A07 quedó bloqueado por PIN (ver §6 del barrido).
4. **Sin E2E propio ni capturas.** Si el vacío de `asignar-caravanas` cambió de aspecto, falta el veto visual
   del Gate 2.5.
5. **Sin review.** No pasó por `reviewer`.

## 5. Estado

**NO listo para commitear.** Falta: mutantes contra los guards nuevos, `check.mjs` completo, review, y —si
hay cambio visual— capturas. El código está sano y verificado hasta donde llegué; lo que falta es la
evidencia de que el guard no se puede burlar.

---

# FIX-LOOP 1 — respuesta al CHANGES_REQUESTED

> **Este bloque lo escribe el IMPLEMENTER** (el cuerpo de arriba es del leader, por los 529). Responde a
> `progress/review_ble-edge-fixes-1.md`. Etiquetas: **[EJECUTADO]** = lo corrí y lo vi · **[LEÍDO]** =
> verificado línea por línea, sin ejecutar.

## FL.1 — 🔴-A · El cableado se anulaba con dos caracteres, y el guard no lo veía

El reviewer tiene razón, y su mutante es el peor de los 14. `stick.ts` componía el predicado inline
(`() => acceptsRef.current?.() ?? true`): una línea de React que **ninguna suite puede ejecutar**, así que
el único oráculo posible era un regex sobre el texto. Cambiar `??` por `||` deja `tsc` en RC=0, la suite en
verde, y **el 🔴-2 restaurado entero** (todo consumidor acepta siempre). `??` cubre solo "no declaró
predicado"; `||` además pisa el `false` de uno que declaró que NO acepta. Para un guard de forma son
indistinguibles; en comportamiento son opuestos.

**Fix**: la composición salió de React. `read-dispatch.ts` exporta `resolveAccepts(ref)` —pura— y se
verifica **ejecutándola**:

- `resolveAccepts({current: undefined})()` → `true` (el default de `/baston`, que solo lista lecturas).
- `resolveAccepts({current: () => false})()` → `false`. **Con `||` esto da `true` y el test cae.**
- lee la ref **en cada llamada**, y se asserta que el resultado sea booleano (M5b: olvidarse de invocar el
  predicado devolvería la función, que es truthy siempre).

**[EJECUTADO]** M5 y M5b mueren.

## FL.2 — 🟠-E · El guard era más angosto que el invariante (M2 alias, M3 hapticTick)

El invariante dice *"no se emite **feedback sensorial**"* y lo cercado era *"no se llama `playFeedback`"*.
Reescrito **sobre la ausencia y por forma de efecto**, no por nombre de función: en todo
`src/services/ble/**` —que **es** el camino de la lectura— nadie puede nombrar un canal sensorial
(`Vibration`, `vibrate`, `haptic*`, `Haptics`, `AudioContext`, `createOscillator`, `playFeedback`) salvo el
**punto único**. Un canal nuevo nace en rojo hasta que se lo enchufe ahí.

**Corrección del leader incorporada**: `src/utils/haptics.ts` **NO** es un canal de lectura vivo (sus dos
consumidores son el reorder y la rueda). **No lo toqué**, y el guard **no prohíbe háptica en la app**:
prohíbe emitir feedback de **lectura** fuera del punto único. Su cabecera dice que ahí se enchufa el canal
háptico rico cuando exista, y el guard es compatible con eso — el día que se enchufe va **dentro** de
`feedback.ts`, que es aguas abajo del gate.

El "punto único" son dos archivos (`feedback.ts` = efecto, `feedback-logic.ts` = decisión pura). Para que
exentar la mitad pura no sea una puerta trasera, el guard **también** asserta que `feedback-logic.ts` no
importe RN/expo.

**[EJECUTADO]** M2 y M3 mueren.

## FL.3 — 🟠-E · M8/M8b: consumidor nuevo por destructuring o alias de import

`CONSUMER_CALL` matcheaba `useBleStickListener(` / `.subscribeTagRead(`. Ahora matchea **el nombre en
cualquier posición** (llamada, destructuring, import con o sin alias): nombrar el mecanismo ya es entrar en
la tabla. Acepto el falso positivo de un import que no llama — cuesta una línea en la tabla; el falso
negativo cuesta una pantalla que recibe bastonazos y los tira en silencio. **[EJECUTADO]** M8 y M8b mueren.

## FL.4 — La pregunta del `accepts()` duplicado (M6 / M6b)

**Quedaron las dos copias, atadas por guard.** Es una decisión, no un olvido:

- El provider ya solo despacha a los que aceptan, así que la guarda de adentro del callback es **redundante
  en el camino normal**. Borrarla daba "una sola fuente" barata.
- Pero no cierra el agujero real. El riesgo no es que la copia actual diverja (hoy no diverge en ninguno de
  los cuatro): es que **mañana alguien agregue un corte nuevo** en el callback por un motivo que el provider
  no conoce → confirma y el callback tira. Borrar la copia no impide eso; solo saca al testigo.

La defensa se puso donde está el riesgo, con **tres chequeos de valor** (antes había uno de texto):

- **(a)** el `accepts` pasado es el identificador `acceptsRead`, no una expresión del call site → mata
  `accepts: () => true`.
- **(b)** `acceptsRead` está definido ahí y **sigue mirando los términos que declara** en la tabla
  (`onBleOwnedRouteRef`, `scopedScannerActiveRef`, …) → mata **M6**: sacarle un término lo deja existiendo,
  idéntico de los dos lados, y sin censurar nada.
- **(c)** **todo** corte temprano del `onTagRead` está declarado en la tabla con su clase → mata **M6b**.
  La clase es lo que importa: `gate` (corta antes de tocar la lectura; **tiene** que ser la misma condición
  que el predicado) vs `stale` (corre después de un `await` y descarta un **resultado** viejo — no puede
  producir una confirmación falsa, porque la lectura ya llegó y disparó su trabajo). Un corte nuevo nace en
  rojo hasta que alguien escriba de cuál de las dos clases es.

**Bug que encontré en mi propio guard mientras lo escribía**: el extractor de cortes usaba
`if\s*\(([^)]*)\)\s*return`, que se corta en el primer `)` y por lo tanto **no veía
`if (!acceptsRead()) return`** — justo el corte más importante. Lo cazó el chequeo de entradas muertas de la
propia tabla. Ahora balancea paréntesis y tiene test de auto-verificación.

## FL.5 — 🟠-C · El doble consumo que trajo mi CTA. Confirmado y arreglado

El reviewer lo marcó `[LEÍDO, no ejecutado]` y tiene razón: **lo trajo esta unidad**. El CTA nuevo empuja
`/baston` y, en un Stack, `asignar-caravanas` queda **montada y suscripta** detrás; su `acceptsRead` no
miraba `scopedScannerActive`, que es lo único que distingue "esta lectura es del sheet de `/baston`".

Arreglado: `acceptsRead` de la masiva ahora es
`establishmentIdRef.current !== null && !scopedScannerActiveRef.current` — **el mismo criterio que ya da el
`FindOrCreateOverlay`**, no una tercera respuesta. El término está declarado en la tabla del guard, así que
sacarlo pone rojo.

**No lo verifiqué en device** (no tengo el A07). El dato del leader —que el camino gemelo (`/baston` +
jornada activa) se comporta bien en device— es consistente: ese camino funciona **porque** el consumidor de
`maniobra` se suprime por ruta; el mío no replicaba esa guarda.

## FL.6 — 🟠-D · Fail-open acotado, y el fundamento corregido

El reviewer no compró el argumento escrito, y hace bien: decía *"el callback igual tiene sus propias guardas
adentro"*, y esa guarda **es la función que acaba de tirar**. Neto real: la lectura se perdía igual **y** la
excepción subía al read-loop del transporte, que tampoco atrapa.

- El despacho ahora entrega **cada `cb` en su propio try/catch**, con log
  (`read_loop_error: tag_subscriber_threw`). Un consumidor que tira no se lleva a los otros ni mata la
  ingesta del bastón hasta reconectar.
- El fundamento del fail-open está reescrito: se sostiene **porque** el despacho está acotado.

Mantengo el fail-open y no fail-closed: acá "cerrado" significa que el peón bastonea y **no pasa nada**, sin
causa visible, en la manga. Una confirmación de más es recuperable; un bastón mudo por un bug de predicado,
no.

## FL.7 — 🟡-F · M9: el CTA podía dejar de pintarse con la función pura intacta

Los tres guards de call site fijaban el **flujo de props**, no que el botón existiera. Borrar el bloque del
JSX devolvía al peón al pozo mudo (ahora con mejor cartel) y la suite quedaba verde; solo lo veía el E2E, que
**no corre en `check.mjs`**. Guard nuevo: el estado vacío lee `view.action`, **renderiza** un `Button` con
`action.label`, y navega a `action.href`. **[EJECUTADO]** M9 muere.

## FL.8 — Lo que decidí NO cambiar, dicho por su consecuencia

- **🟡-H (`/baston` declarada `always` pero dueña solo con foco)**: se queda. El archivo es de la **unidad
  hermana sin commitear** y está fuera de mi alcance. Consecuencia asumida: montada-sin-foco cuenta como
  consumidor, así que `drop_no_consumer` no se dispara mientras esté en el stack y una lectura puede
  aterrizar en una lista que nadie mira. **No hay dato perdido ni confirmación falsa** (la pantalla sí la
  muestra). Queda escrito en la tabla del guard y anotado en `docs/backlog.md`.
- **🟡-I (la puerta MANUAL va a caer en la misma trampa)**: no se cablea en esta unidad
  (`ManualAdapter.submit()` no tiene call sites), pero **el gate ya está puesto en el camino que va a usar**.
  Advertencia explícita en la cabecera de `read-dispatch.ts`: quien la cablee tiene que **separar las
  puertas**, porque el `accepts` del `TagScanSheet` es falso exactamente cuando el operario tipea.
- **⚪-M (features en `deferred` sin `in_progress`)**: pre-existente, no lo toco desde acá.

## FL.9 — Los ⚪ chicos

- **⚪-J**: `wiring.test.ts` ahora **ejecuta** el payload nuevo (`read_dropped_no_consumer` con 0 y con 3
  suscriptores) y el de `tag_subscriber_threw`. Antes solo se verificaba que el literal apareciera.
- **⚪-K**: `lineHeight="$4"` en el cuerpo del vacío. El copy nuevo es el más largo de los tres y el que más
  envuelve, y Tamagui no aplica el lineHeight del token con `fontSize` suelto → recortaba descendentes
  (g/q/p de "Prendé"/"podés"/"tocá").
- **⚪-L**: copy corregido. Era *"Prendé el bastón"*, falso en dos de los tres casos que el propio módulo
  nombra (fuera de rango / cadena agotada: el bastón **ya está prendido**). Ahora: *"Fijate que el bastón
  esté prendido y cerca, y tocá «Conectar el bastón»"*.

## FL.10 — 🔴-B · Specs reconciliadas

| Archivo | Qué |
|---|---|
| `04/requirements.md` R4.1 | nota de reconciliación: "confirma" se lee literal — sin consumidor el contrato **no confirma**, así que R4.1 no aplica a ese caso |
| `04/requirements.md` **R4.6** (nuevo) | EARS del invariante: sin consumidor, ni feedback ni ventana de dedup, y se loguea el descarte |
| `04/requirements.md` **R4.7** (nuevo) | el feedback sensorial se emite desde un **punto único**, por cualquier API |
| `04/requirements.md` R10.4 | la firma quedó **extendida** con `accepts?` (retrocompatible) + el porqué + la advertencia de la puerta manual |
| `04/tasks.md` **T7.1** (nueva, `[x]`) | la task que faltaba, con el bug, el porqué del rediseño, las dos decisiones (dedup / cola en `carga`) y la verificación |
| `04/tasks.md` tabla de trazabilidad | R3.1, R4.1/4.2/4.5 y R10.4 apuntan a T7.1; fila nueva para R4.6/R4.7 |
| `09/design-09resto-dedup.md` §4.5 | *"No hay gating per-suscriptor en el provider"* → corregido + nota de reconciliación (dejó de ser cierto, y la supresión por ruta **no** se reemplazó) |
| `09/design-09resto-dedup.md` §4.6 | nota de reconciliación del 🔴-3: firma nueva, **tres** estados, el copy nuevo, 9 unit + 3 E2E, y los tests que asertaban el bug |
| `09/tasks-09resto-dedup.md` **F5.7** (nueva, `[x]`) | F5.6 cerró contra la dimensión equivocada; qué quedó as-built; la consecuencia que trajo el CTA |

## FL.11 — Verificación

**[EJECUTADO]**

| Qué | Resultado |
|---|---|
| `pnpm typecheck` | **RC=0**, cero salida |
| Suites de la unidad (9 archivos) | **90/90** verdes |
| **Mutantes** | **20/20 muertos**, incluidos los **7 que sobrevivieron al reviewer** (M5, M5b, M2, M3, M6, M6b, M9) y los 4 nuevos que cubren lo que agregó este fix-loop (try/catch del despacho, `scopedScannerActive` de la masiva) |
| Bloque de unit tests del cliente completo | **2757/2757** |
| E2E del bastón (5 specs, 16 tests) | **16/16** verdes sobre build fresco |
| `design/**/*.png` | **limpio** (verificado después de correr E2E) |

**Un mutante que sobrevivió y hubo que cerrar en esta misma vuelta**: `M17` (borrar el try/catch del
despacho, o sea mi propio fix de 🟠-D) pasaba con todo en verde. Ahora el guard exige que el bucle entregue
`cb(...)` dentro de un try/catch, con el motivo escrito.

### `node scripts/check.mjs` — **10 rojos, NINGUNO mío** [EJECUTADO]

Todos salen de **`app/src/utils/nav-target-bands.ts`**, que es de la **unidad hermana** (está en mi lista de
archivos prohibidos) y hoy **queda con las llaves desbalanceadas al blanquearle los comentarios**. Eso rompe
`assertScanCoverage`, que es **compartido**: por eso caen 5 guards que no tienen nada que ver entre sí (el
mensaje repetido "AUTO-VERIFICACIÓN: el guard escaneó todo el árbol"), más los propios de
`tap-target-collision-guard.test.ts`.

**Cómo lo verifiqué en vez de suponerlo**: saqué ese archivo del árbol un momento y corrí el bloque entero
de unit tests del cliente → **2757/2757, fail 0**. Lo restauré intacto (29.896 bytes) y no lo toqué.

## FL.12 — Lo que NO pude verificar

1. **Nada en device.** No tengo el A07. En particular el 🟠-C (doble consumo masiva ↔ `/baston`) lo arreglé
   por análisis; el oráculo de 1 minuto que propuso el reviewer sigue sin correrse.
2. **El veto visual del Gate 2.5 lo hace el leader** (no es mío). Los **7 shots están generados**
   [EJECUTADO]: `pnpm exec playwright test e2e/captures/baston-edge-fixes-1.capture.ts --config
   playwright.capture.config.ts` → **3/3 tests, 7/7 shots**, `design/` limpio, `__shots__/` gitignoreado.
   El leader ya aprobó el 01; quedan 02–07.

   **Dos bugs del capture que había que arreglar antes** (eran del script, no del producto):
   - **Volver desde `/baston` con `gotoTab(page, 'Más', …)`**: `/baston` es una pantalla de **Stack** y no
     tiene bottom tab bar → el `role="tab"` no existe ahí. Ahora vuelve por el **chevron del header**, que
     además es el viaje de ida y vuelta REAL que promete el CTA y de paso ejercita el `backOr`. Se toma con
     `.last()` porque la pantalla de origen queda montada detrás y también tiene su "Volver".
   - **`context().clearCookies()` NO desloguea**: el token de Supabase vive en `localStorage`, así que el
     `signIn` de la segunda sesión esperaba para siempre un campo "Email" que nunca aparecía (la app seguía
     adentro con el usuario anterior). El shot 04 pasó a ser un **test aparte**, con page/contexto limpios.

   Auto-veto de los dos shots que faltaban, antes de devolverlos: **03** (conectado) es carácter por
   carácter el copy de siempre y sin CTA — es el contrafáctico que hace legible al 01; la `g` de "asignás"
   renderiza entera en la tercera línea, que es lo que fija el `lineHeight` de ⚪-K. **04** (sin transporte)
   quedó intacto respecto del bugfix de julio: frase canónica, salida por la ficha, sin CTA.
   Dato para el veto del 🔴-2: **06 y 07 son byte-idénticos** (`cmp` limpio) — antes del fix, ese mismo
   bastonazo hacía vibrar el teléfono sobre una pantalla que no cambiaba.
3. **La mitad "dedup" del 🔴-2 no tiene oráculo E2E.** El contador de confirmaciones prueba que no se
   confirma; que la ventana **no se queme** solo lo cubren el guard de orden y el test puro. Un E2E honesto
   necesitaría re-bastonear el mismo EID en otra pantalla **dentro de los 3 s**, y eso pasa vacuo en cuanto
   la máquina va lenta.
4. **`baston-multivendor.spec.ts` y `maniobra-carga.spec.ts` no los volví a correr** en esta vuelta.
   `maniobra-carga` tiene **2 rojos PRE-EXISTENTES** que verifiqué stasheando mis cambios: fallan igual sin
   esta unidad (la jornada arranca con 1 maniobra en vez de 2 — huele a dependencia de fecha, no lo
   diagnostiqué).
5. **Acoplamiento con la unidad hermana** (🟡-G del review, sigue vigente): mi E2E (b) ancla en
   `getByTestId('stick-devices-section')`, un `testID` que agrega **su** cambio sin commitear. **Esta unidad
   no se puede commitear sola.**
