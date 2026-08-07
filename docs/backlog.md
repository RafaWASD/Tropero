# Backlog

Overflow de scope: ítems que aparecieron durante una sesión pero exceden su objetivo. Se anotan acá para no perderse y se procesan después como feature nueva, ADR, spec o nota informativa.

No es un sustituto de `feature_list.json` ni de los ADRs — es la antesala donde se acumulan cosas pendientes de clasificar.

## Formato

````
## YYYY-MM-DD — <título corto>

**Origen**: sesión X, mientras se trabajaba en Y.
**Qué**: descripción breve.
**Por qué importa**: 1-2 líneas.
**Próximo paso sugerido**: feature nueva en `feature_list.json` / ADR / spec / nada (info).
````

## Ítems pendientes

## 2026-08-06 — El sexo es el único dato del alta que no se puede corregir nunca

**Origen**: Gate 0 de «forzar categoría desde la ficha». Raf preguntó si tenía sentido poder cambiar el sexo
desde la ficha y pidió analizarlo; decidió dejarlo **fuera de esa tanda** y decidirlo con el QA a la vista.

**Los dos datos que contestan su pregunta** (verificados, no supuestos):
- **El EID NO codifica sexo.** FDX-B ISO 11784/11785 son 15 dígitos: 3 de prefijo (país/fabricante) + 12 de
  identificación nacional (`src/utils/eid-format.ts:6`). No hay nada reservado a sexo.
- **No existe ninguna forma de cambiar el sexo hoy.** Se setea solo en el alta (`crear-animal.tsx:182,808`,
  paso 2) y en la ficha únicamente se **lee** (`animal/[id].tsx:465`, para gatear "castrado").

**Qué**: el sexo es el **único** atributo del alta sin reparación. Raza, lote, categoría, castrado, caravana
visual y caravana electrónica se editan todos desde la ficha. El sexo no. Un misclick en el paso 2 deja al
animal mal **para siempre**, o hay que borrarlo y recrearlo perdiendo su historia.

**Por qué importa más de lo que parece**: el propio razonamiento de Raf lo confirma en vez de descartarlo —
*"si querías cargar un macho y misclickeaste, te vas a dar cuenta cuando elijas «vaquillona»"*. Exacto: **te
das cuenta y no podés hacer nada**. Descubrible e irreparable es la peor combinación.

**Por qué NO alcanza con "un toggle con doble confirmación"** (la idea inicial): el sexo arrastra estado
derivado —sistema de categorías, elegibilidad reproductiva, circunferencia escrotal, partos—. Cambiárselo a
un animal **con historia** produce registros incoherentes: una hembra con `scrotal_measurements`.

**Propuesta**: editable **solo mientras el animal no tenga historia que dependa del sexo** (sin
`reproductive_events`, sin `scrotal_measurements`, sin partos registrados). Cubre el caso real —el misclick,
que se descubre minutos después del alta— sin habilitar incoherencias. Con historia, la ficha lo dice con
honestidad en vez de ofrecer un botón que va a romper cosas. La condición es consultable con los mismos reads
que ya alimentan la ficha.

**Próximo paso sugerido**: decidir junto con los hallazgos del QA de maniobras (`progress/qa_maniobras-device.md`).

## 2026-08-06 — `WEB_TONES` y los .wav nativos se espejan por comentario, no por guard

**Origen**: verificación del leader de la unidad de feedback sensorial, mirando si los assets viajaban en el
bundle (sí viajan: `require()` estáticos en `feedback.ts:257,259`, Metro los resuelve aunque estén dentro de
una función).

**Qué**: el canal sonoro de WEB se **sintetiza** con un oscilador (`WEB_TONES` en `feedback.ts:183-189`:
`read-ok` = 3150 Hz/110 ms, `read-error` = 1300 Hz/95 ms + gap 45 ms + 850 Hz/110 ms) y el comentario dice que
"espeja los assets nativos". En NATIVO suenan los `.wav` (`assets/sounds/*.wav`, generados por
`scripts/gen-baston-sounds.mjs`). **Son dos representaciones de la misma verdad y nada las ata**: el guard de
assets (`feedback-guard.test.ts:360`) solo verifica que los dos WAV no sean byte-idénticos entre sí y que no
sean silencio — no los compara contra `WEB_TONES`.

**Por qué importa**: el oscilador de web **es el oráculo de la E2E** — el propio archivo lo dice: *"es el
único canal observable por la E2E, así que además de cumplir R4.5 es EL ORÁCULO de «qué le dijo el producto
al peón»"*. Si alguien regenera los WAV con otras frecuencias, `WEB_TONES` no lo sigue, y la E2E queda
verificando en verde un tono que el device **nunca reproduce**. El síntoma sería el peor: la suite afirmando
que el producto avisa bien, mientras en la manga suena otra cosa (o nada distinguible).

**Por qué NO se arregló ahora**: el leader había declarado cerrada la última vuelta de guards de esa unidad y
lo sostuvo — abrir otra por un 🟡 después de 30 mutantes es rendimiento decreciente. Queda anotado en vez de
improvisado.

**Próximo paso sugerido**: decodificar los `.wav` en el propio guard (ya hay precedente: el reviewer los
decodificó a mano para verificar frecuencia y duración) y asertar que coinciden con `WEB_TONES` — misma
frecuencia, misma duración, misma cantidad de pips y mismo gap. Es la clase de guard que esta sesión
demostró que hay que escribir: **resolver el valor de las dos fuentes y compararlas**, no confiar en un
comentario que dice que se espejan.

## 2026-08-06 — Flake de `upload-rejections.test.ts` R10.8 bajo carga del lote (NO es regresión)

**Origen**: verificación de la unidad de feedback sensorial del bastón. `check.mjs` dio rojo con **un solo**
test caído y casi lo atribuyo mal.

**Firma exacta**:
```
✖ R10.8: recordUploadRejection guarda { id, table, op, code, at } SIN opData
  AssertionError: true !== false
  app/src/services/powersync/upload-rejections.test.ts:127
```

**Qué es**: un **flake bajo carga**, no una regresión. Medido:
- El archivo solo: **18/18, tres veces**.
- El lote completo (151 suites): **2857/2857, dos veces** después del rojo.
- `node --test` corre **cada archivo en su propio proceso**, así que no puede ser contaminación de estado
  entre suites — lo que varía es el paralelismo y la contención de CPU.

**El error de método que casi cometo, y que es lo valioso de esta entrada**: corrí una vez el lote **sin** las
dos suites nuevas de la unidad, dio verde, y estuve a un paso de concluir que ellas lo causaban. Comparar
**una corrida contra una corrida** es exactamente como se fabrica una atribución falsa. Un flake solo se
descarta —o se confirma— repitiendo; y la repetición tiene que ser del caso que falló, no del que pasó.

**Si reaparece**: re-correr el archivo solo y el lote completo 2-3 veces antes de tocar nada. Si el test
resulta ser genuinamente sensible al tiempo, el arreglo es de ese test (esperar la condición en vez de
asumir el orden), no del lote.

## 2026-08-06 — 🔴 E2E en rojo en `main`: `lotes.spec.ts` «crear lote → asignar desde la ficha → ver miembros»

**Origen**: unidad «el FAB le roba los taps a la banda de arriba del nav», corriendo la regresión de las specs que pisan el tab "Más".
**Qué**: `app/e2e/lotes.spec.ts:61` falla en `lotes.spec.ts:103` — `getByText(<nombre del lote>, { exact: true }).first()` resuelve a un `<span>` con caja de área CERO → `toBeVisible()` recibe `hidden`. **La funcionalidad NO está rota**: el snapshot del error muestra la ficha ya con *"Lote actual «<nombre>»"* y el botón *"Cambiar lote"* renderizados, o sea la asignación funcionó. Lo que falla es el LOCATOR: `.first()` agarra una copia oculta del nombre (con toda probabilidad la del selector que se está cerrando) en vez de la de la ficha.
**Verificado que es PRE-EXISTENTE, no una regresión** (ejecutado, no deducido): con los 5 archivos de producción de esa unidad stasheados y el `dist` rebuildeado desde **`1f1c002`**, la spec **falla igual**. Los otros 4 casos del archivo pasan. No reproduce por contención (falla también corriendo sola).
**Por qué importa**: medio. Es un rojo permanente en la suite, y un rojo permanente es peor que un test que no existe: entrena a leer "1 failed" como ruido. Además tapa una regresión real de lotes el día que ocurra.
**Próximo paso sugerido**: cambiar el ancla por una EXCLUSIVA de la ficha en vez de `.first()` sobre un texto que aparece dos veces — el patrón que el repo ya usa (`testID` / `getByRole` con el nombre accesible de la sección "Lote actual"). Ojo con el reflejo de agregarle `.last()`: eso lo pinta de verde sin saber por qué había dos. Antes de tocar el test, confirmar con el trace si el segundo nodo es el del selector cerrándose o si la ficha está pintando el nombre dos veces (en cuyo caso el bug es de la app).

## 2026-08-06 — La última card del tab "Más" puede quedar DEBAJO del bottom-nav (medido, no diagnosticado)

**Origen**: unidad «el FAB le roba los taps a la banda de arriba del nav». Lo encontró el primer intento del guard geométrico (`e2e/fab-target-geometry.spec.ts`), que reportó como colisión un control que en realidad estaba **tapado** por la barra.
**Qué** (medido @412×915, tab "Más" con el pill del bastón vivo): la card **"Completá el RENSPA del campo para la exportación a SIGSA"** (`role="button"`) tiene su caja en `x=[18,394] y=[848,934]`. El **techo del bottom-nav está en y=843** y el viewport termina en **915** → esa card se pinta **entera por debajo de la barra**, y además su borde inferior cae 19 px fuera de la pantalla. No es un problema de z-order del pill ni del FAB: es contenido de la pantalla que, en ese scroll, queda inalcanzable.
**Lo que NO se verificó** (y por eso esto es una observación, no un bug confirmado): si el `ScrollView` de `mas.tsx` puede scrollear lo suficiente como para subir esa card por encima del nav. Si el `contentContainer` reserva `useSafeBottomInset() + $navBar`, no hay problema y esto es solo la foto de un scroll intermedio; si no lo reserva, la última fila de la pantalla de ajustes es **permanentemente intocable** — que es exactamente el tipo de defecto que solo se ve en un device.
**Por qué importa**: medio. La card del RENSPA es un CTA de onboarding de SIGSA (driver regulatorio). Y si la reserva falta, no falla solo esa card: falla el último elemento de la pantalla, sea cual sea.
**Próximo paso sugerido**: medir el scroll máximo de `mas.tsx` (`scrollHeight - clientHeight` vs. el alto del nav) y, si falta, sumar la reserva canónica al `contentContainerStyle` con `useSafeBottomInset()` — **nunca a mano** (`src/utils/safe-bottom-inset-guard.test.ts`). Barrer después las otras tabs con el mismo criterio: es un bug de CLASE candidato, no un spot.

## 2026-08-05 — Se cerró el último `router.back()` pelado y NO se dejó el guard que lo mantenga cerrado

**Origen**: 🟡-4 del review de la unidad «acceso in-app a la pantalla del bastón» (`progress/review_baston-acceso-mas.md`). Se anota acá como **decisión, no como olvido** — que es lo que el reviewer pidió explícitamente si no se hacía en esa unidad.
**Qué**: el barrido de `backOr` terminó: `StickConnectionScreen` era el último `router.back()` pelado y ya usa `backOr(router, '/(tabs)/mas')` (verificado por grep: en `app/app` + `app/src` solo quedan menciones en comentarios + la implementación en `nav.ts`). Faltan **dos** cosas:
1. **Un guard estático** que enumere los `router.back()` de `app/app/**` + `app/src/**` y falle si aparece uno pelado. La regla de la casa es *"barrer la ausencia: el guard se escribe sobre la ausencia para que lo nuevo nazca en rojo"* — sin él, el próximo `back()` pelado nace en verde y el barrido se re-abre en silencio. Es el único momento en que el guard puede escribirse contra un árbol limpio (cero excepciones que declarar).
2. **Un test que falle si se revierte el fix de esta pantalla.** El E2E `(e)` de `baston-multivendor.spec.ts` llega a `/baston` **por push**, así que ejercita la rama `router.back()` — que con un `back()` pelado se comporta idéntico. La rama que el fix realmente arregla (stack vacío → `replace('/(tabs)/mas')`) está a dos líneas: los casos (a)-(d) de esa misma spec ya entran con `page.goto('/baston')`, o sea con el stack vacío; alcanza con tocar "Volver" en uno y asertar que aterriza en "Más".
**Por qué importa**: es la tercera aparición de la misma clase en este repo — *el guard cubre la instancia arreglada y no el invariante*, así que lo nuevo nace roto. Acá el costo es bajo (un `back()` pelado deja al usuario trabado en una pantalla, no corrompe datos), pero el patrón es el que ya mordió con `runOnJS`, con los framers sin cota y con la fuente de verdad del link SPP.
**Por qué NO se hizo en esa unidad**: el encargo era el acceso in-app; el `backOr` entró como efecto colateral de 2 líneas y el guard es un artefacto nuevo con su propio blast radius (enumera dos árboles enteros de pantallas). Decisión del leader al cerrar el fix-loop.
**Próximo paso sugerido**: (2) primero (3 líneas dentro de una spec E2E que ya existe y ya corre), (1) después, junto con cualquier otra unidad que toque navegación.

## 2026-08-01 — 🔴 Crash nativo (SIGABRT) por worklet de gesto sin guard — clase ya conocida, superficie sin cubrir

**Origen**: crash real de Raf en device (iPhone 15 Pro, iOS 27 beta, build `ar.rafq.app` = preview/production) el 2026-08-01 21:14, "armando una maniobra / dato personalizado". `.ips` compartido; leído + localizado con un Explore read-only (no se simbolizó: no había dSYM).
**Qué**: `EXC_CRASH/SIGABRT` (`abort()`), main thread. Stack: `__cxa_throw` ← `HermesRuntimeImpl::throwPendingError` ← `WorkletRuntime::runSync` ← `reanimated::UIEventHandler::process` ← `ReanimatedModuleProxy::handleEvent` ← `-[REANodesManager dispatchEvent:]` ← `UIGestureRecognizer`. O sea: **un worklet atado a un animated-event handler de gesto/scroll tiró una excepción de JS sin catch → `std::terminate` → abort** (muere toda la app, sin red box). Ese stack (`UIEventHandler::process`) es exclusivo de scroll handlers / callbacks de gesto RNGH → descarta `useAnimatedStyle`/`useDerivedValue`/`useFrameCallback`.
**Sospechoso #1**: `app/app/maniobra/_components/ManeuverReorderList.tsx:209-266` — el `Gesture.Pan()` del drag-reorder de maniobras (onStart/onUpdate/onEnd). Único gesto del flujo del wizard SIN try/catch; casa con contexto + stack. #2 `app/app/maniobra/_components/WheelPicker.tsx:285-300` (`useAnimatedScrollHandler`; encaja con el stack pero vive en CARGA, no en el armado de jornada). #3 `app/src/components/BottomSheetShell.tsx:451-548` (Pan del `CustomFieldSheet` = "dato personalizado"; blindado con try/catch fail-closed en release → improbable en un build no-`.dev`). NO se encontró una línea con throw garantizado — el árbol es defensivo.
**Por qué importa**: crash duro en un flujo core (armar jornada), en device, en build de release. Es la MISMA clase que ya mordió al repo (`runOnJS(Keyboard.dismiss)` en un sheet → `worklet-callbacks-guard.test.ts` guarda `runOnJS(X.y)`): el guard cubre una forma del bug, pero la AUSENCIA de try/catch en los callbacks de gesto quedó sin barrer. `BottomSheetShell` está blindado; `ManeuverReorderList` no.
**Próximo paso sugerido**: bug-fix por SDD que (a) envuelva todos los gesto-worklets sin guard con el patrón probado de `BottomSheetShell` (try/catch por callback + `if(__DEV__) throw` + nunca `runOnJS(X.y)`), empezando por `ManeuverReorderList`; (b) extienda `worklet-callbacks-guard.test.ts` para enumerar los callbacks de gesto y exigir el blindaje → un gesto nuevo sin guard nace en rojo (barrer la ausencia, no la instancia). Refuerza el caso de feature 17 (Sentry), que simbolizaría la línea exacta.

## 2026-07-30 — El adapter de iOS va a nacer sin fuente de verdad del link, y nada lo va a obligar

**Origen**: pregunta de Raf al cierre de la sesión del bastón — *"lo que corregiste, lo corregiste para ambos?"*. La respuesta destapó esto.
**Qué**: el peor 🔴 de esa noche (el *"Bastón conectado"* mentiroso) se arregló con una **segunda fuente de verdad** del link: `isDeviceConnected` del lado Java, consultado al volver a foreground y por un poll de 15 s, en vez de confiar en el evento de desconexión del SO — que se puede perder (`sendEvent` lo descarta si no hay Catalyst instance activa, y el otro emisor publica en `DEVICE_DISCONNECTED@<address>`, al que el listener no estaba suscrito). **Ese mecanismo vive entero dentro de `adapter-spp-android.ts`.**
Cuando aterrice el camino de iOS (BLE-HID wedge, `adapter-hid-wedge.ts`, hoy 22 líneas de placeholder gateadas por T5.0/R8.7) va a tener su propio modelo de eventos y su propia forma de perderlos — y **no hay ningún guard que le exija tener una fuente de verdad propia**. La lección quedó codificada como *implementación* en un adapter, no como *invariante* del contrato.
**Por qué importa**: es la clase que este proyecto se comió tres veces en una semana — el guard cubre la instancia arreglada y no el invariante, así que lo nuevo nace roto y en silencio. Y el modo de falla acá es el peor de todos para la manga: el estado dice "conectado", el operario bastonea 40 animales y no entra ninguno. No hay verde que lo delate.
**Lo que SÍ hereda iOS ya hoy** (para no re-litigarlo): el techo de los awaits del puente (`bridge-timeout.ts` + el guard, que escanea `services/ble/**`, así que un `adapter-hid-wedge` implementado cae adentro) · la MAC recordada con techo en el borde, R6.6 cableada y limpieza en `signOut`/`SIGNED_OUT`/baja · el fin del doble consumo en `/baston` · y el guard del modo de ingesta, que **recorre todos los `AdapterKind` incluido `hid-wedge`** → ese sí nace en rojo si no declara.
**Próximo paso sugerido**: al escribir la spec del adapter HID, subir "fuente de verdad del estado de conexión independiente del stream de eventos" del nivel de implementación al nivel de **contrato** (`StickAdapter` / ADR-024), con un guard que recorra los adapters y falle si alguno no la declara — el mismo patrón que ya funcionó con `ADAPTER_INGEST_MODE`.

## 2026-07-30 — 🔴 de clase: NINGUNA aserción de tipos escrita en un test la chequea nadie

**Origen**: autorrevisión del implementer en el fix de los bloqueantes del SPP (2026-07-30). Se lo encontró a sí mismo: había puesto un guard de tipos en un test y no guardaba nada.
**Qué**: `app/tsconfig.json` tiene en `exclude`: `**/*.test.ts`, `**/*.test.tsx` y `e2e` (verificado leyendo el archivo). O sea que `tsc` **no mira ningún test del repo**. Cualquier `satisfies`, cualquier tipo explícito, cualquier `@ts-expect-error` escrito dentro de un `.test.ts` es decoración: no falla nunca, ni cuando debería.
**Por qué importa**: es la tercera aparición de la misma clase — *un verificador roto y uno que no encuentra nada se ven igual*. Ya pasó con el blanqueo de comentarios de los guards (556 líneas invisibles) y con el guard del teclado que cubría una sola dirección. Acá el modo de falla es peor porque es silencioso **por configuración**: alguien escribe un guard de tipos convencido de haber cerrado una clase de bug, y no cerró nada. Y hay un incentivo perverso: los guards de tipo son el patrón natural para "un adapter nuevo tiene que declarar su modo", que es justo lo que se acaba de escribir en este fix.
**Cuántos hay hoy**: sin medir. Hace falta enumerar los tests con aserciones de tipo (`satisfies`, anotaciones explícitas de retorno, `@ts-expect-error`) para saber el tamaño real.
**Próximo paso sugerido**: (a) medir cuántas aserciones de tipos viven hoy en tests excluidos; (b) decidir si los tests entran a `tsc` (probablemente con un `tsconfig.test.json` aparte, para no frenar el typecheck de producción) o si se prohíbe el patrón y los guards de tipo se anclan **en el módulo**, que es el parche que se aplicó acá. La opción (b) sola no alcanza: no hay nada que impida volver a escribirlo en un test.

## 2026-07-30 — Tres deudas que dejó el fix de los bloqueantes del SPP (y una es de contrato)

**Origen**: unidad «bloqueantes del camino SPP» (`progress/impl_baston-spp-bloqueantes.md`). No son notas del review: son cosas que el propio fix dejó abiertas o descubrió.
**Qué**:
1. **`contract.ingestRawLine` llama `parseRs420Line` HARDCODEADO** → el `frameParser` del `ReaderDriver` **no se usa en producción** (solo desde los tests). Consecuencia concreta: con un segundo driver SPP de otro formato de trama, **RMV1.6 no se cumple** (sumar un fabricante SÍ exigiría tocar `contract.ts`). El review lo marcó como falso-verde (🟡-4) y la spec quedó reconciliada diciendo la verdad; el fix pertenece a `contract.ts`, que es del CORE, y conviene hacerlo cuando exista el segundo driver y se sepa qué necesita — no antes, a ciegas.
2. **El estado `scanning` (Reintentando…) no tiene CTA y la cadena de reintentos no tiene tope.** Con el bastón apagado la app reintenta cada 8 s **para siempre** y el operario no tiene botón para frenarlo (`connection-view.ts` devuelve `cta:'none'` para `connecting` y `scanning`). Con los timeouts nuevos el `connecting` quedó ACOTADO (≤30 s), así que el hueco filoso es solo el `scanning`. Es una decisión de UX, no un bug: ¿un "Cancelar"? ¿un tope de intentos con "Volver a conectar"? En la manga, reintentar solo es lo que uno quiere; frenar es lo raro.
   **RESUELTO A MEDIAS — 2026-07-30 (tercera pasada + fix-loop).** R6.4 subió la severidad: el reintento infinito, que antes exigía un gesto, pasó a arrancar solo en cada apertura, así que un bastón vendido / roto / que quedó en otro campo dejaba la app con cara de rota para siempre. **Se implementó el tope de la cadena que arranca SIN gesto** (`connect-trigger.ts`, 120 s, con estado final `'off'` que sí tiene CTA), y el fix-loop cerró su defecto: el presupuesto **muere cuando el bastón contesta**, así que no le pone vencimiento a la reconexión de una sesión que estaba funcionando.
   **Lo que QUEDA de este ítem** (y es una decisión tomada, no una omisión): la cadena del **operario** —la que nace de un tap y la que sigue a una conexión establecida— **no tiene tope ni CTA en `scanning`**, a propósito: ahí el operario está activamente tratando de conectar, o el bastón ya demostró que existe, y abandonarlo es peor que insistir (el backoff topea en 8 s). Si algún día se quiere un "Cancelar" en `scanning`, es UX y necesita a Raf; lo que era un defecto ya no está.
3. **`/baston` es una ruta sin entrada in-app**: se alcanza solo por deep-link (la fila de "Más" nunca se cableó — la agrega quien sea dueño de `mas.tsx`). Efecto colateral medido: la captura `07-indicador-global-chrome` del Gate 2.5 se cayó, porque la única navegación client-side que salía de `/baston` con la conexión viva era el "Dar de alta" del sheet global — que ahora está suprimido ahí a propósito (BENCH-3). Cablear la fila devuelve la evidencia visual de RMV3.5 y, de paso, hace la pantalla alcanzable para un operario que no sabe escribir URLs.
   **RESUELTO — 2026-08-05** (unidad «acceso in-app a la pantalla del bastón», `progress/impl_baston-acceso-mas.md`). Lo destapó Raf en device: abrió la app, el chip global quedó ciclando *"Conectando…"* (reconexión R6.4 con el ESP32 apagado) y no tuvo forma de llegar a la pantalla para cortarlo. `(tabs)/mas.tsx` tiene ahora una sección **"Bastón"** con un `ActionRow` a `/baston`, **entre la card de Perfil y el bloque "Campo activo"** (el bastón se empareja con el TELÉFONO, no con el campo; y ese bloque está gateado por `activeField != null`, así que la fila habría desaparecido justo sin campo resuelto) y **sin gate de rol**. El trailing muestra el **estado de conexión en vivo** (`connectionRowStatus`, función pura nueva y testeada de `connection-view.ts`), que es lo que responde el reporte: enterarse sin entrar. La captura **`07-indicador-global-chrome` volvió** (más `08-mas-fila-baston` y `09-fila-mas-baston-conectado`). Specs 04 reconciliadas (RMV3.1 + design §7 + T-MV.4.7).
**Por qué importa**: (1) es una promesa de arquitectura (RMV1.6) que hoy no se cumple y estaba documentada como si sí. (2) es 🟡 de manga. (3) bloquea una captura y es una feature a medio cablear.
**Próximo paso sugerido**: (3) ~~es una fila de `ActionRow` en `mas.tsx` (coordinar con quien lo posea)~~ → hecho, ver arriba; (2) preguntarle a Raf con opciones; (1) esperar al segundo driver.

## 2026-07-30 — Cinco notas del review del SPP que quedaron fuera del fix de los bloqueantes

**Origen**: review adversarial de `dad711f` + banco en device (`progress/review_baston-android-spp.md`, `progress/bench_baston-spp-emulador.md`). El fix de esa noche cerró los 🔴 y los 🟠; esto es lo que se dejó afuera a propósito.
**Qué**:
1. **Ningún framer tiene cota** (⚪-3). Ni el `StringBuffer` del nativo ni `LineFramer.push` (`line-framer.ts:19-20`, vivo en web-serial). Un lector que escupa basura sin terminador los hace crecer sin límite. **Medido en device**: con `term cr`, además de quedar mudo, al corregir el terminador se pierde también la primera trama válida (la arrastra el buffer acumulado).
2. **`splitSppPayload` es defensa muerta en Android** (⚪-2): con dos tramas pegadas las separa el nativo, no nuestra función. Sin consecuencia, pero el README del emulador se lo atribuía a `splitSppPayload`.
3. **Dos escrituras del device recordado** (⚪-4): la pantalla persiste la MAC *antes* de saber si conecta y el adapter la persiste otra vez al conectar → tocar unos auriculares por error los deja recordados como bastón.
4. **El plugin declara `BLUETOOTH_SCAN` sin usarlo** (⚪-5, `with-bluetooth-classic.js:40`) — mismo argumento con el que se topeó `ACCESS_FINE_LOCATION` a `maxSdkVersion=30`. Declaración de más en la ficha de Play.
5. **`instantiateTransport` / `isSppNativeAvailable()` sin cobertura en el camino positivo** (🟡-2): el require de `react-native` es directo, sin inyección, así que el único test posible es el negativo, que pasa trivialmente. La única evidencia de que la rama verdadera anda es la corrida en device de esta noche.
**Por qué importa**: (1) y (5) son la misma clase que ya nos quemó tres veces — el camino que importa no tiene guard y un verificador que no encuentra nada se ve igual que uno roto. (3) y (4) son chicos y baratos.
**Próximo paso sugerido**: (1) cota + descarte con log en los dos framers, con test; (4) sacar el permiso; (3) forget en el fallo. (2) y (5) son nota informativa.

## 2026-07-29 — El UUID RFCOMM del SPP en Android NO es parametrizable con la lib que usamos

**Origen**: unidad «bastón Android SPP» (2026-07-29), al leer el código nativo de `react-native-bluetooth-classic` para escribir el adapter de verdad.
**Qué**: `RfcommConnectorThreadImpl.java` llama `device.createRfcommSocketToServiceRecord(BluetoothUUID.SPP.uuid)` con `00001101-0000-1000-8000-00805F9B34FB` **hardcodeado**, e **ignora** la opción `uuid` que se le pase a `connectToDevice`. O sea: la promesa de RMV5.2 ("otro lector SPP se soporta agregando su driver") vale para el `frameParser` y el `pin`, pero **no** para el `sppUuid`.
**Cómo quedó mitigado**: el adapter **contrasta** el `sppUuid` del driver contra el UUID fijo (`sppUuidIsSupported`) y, si no coincide, **no abre el socket** (emite `disconnected` + log) en vez de conectarse al SPP estándar fingiendo que es el del driver. Falla ruidosa y testeada, no silenciosa.
**Por qué importa**: el día que aparezca un lector SPP publicado en otro UUID de servicio (no es raro en lectores industriales), el registro de drivers **no** alcanza: hay que cambiar de librería o escribir un módulo nativo propio (son ~30 líneas de Kotlin: `createRfcommSocketToServiceRecord(UUID.fromString(...))`). Hoy no bloquea nada — el RS420 usa el SPP estándar.
**Próximo paso sugerido**: nada ahora. Revisar cuando entre el segundo fabricante SPP al registro (RMV1.6). Si además hiciera falta discovery de no-emparejados, conviene evaluar las dos cosas juntas.

## 2026-07-29 — Stash `pressable-sweep-wip`: 67 archivos a medio barrer del bug de taps, en CONFLICTO con HEAD

**Origen**: bugfix del chip del bastón (2026-07-29). Raf pasó la titularidad de BLE desde otra terminal de Claude que murió a mitad de trabajo; el stash es lo que dejó tirado.
**Qué**: `git stash list` → `stash@{0}: On main: pressable-sweep-wip`. **67 archivos, 2564 inserciones**: un barrido A MEDIO HACER del bug de taps (`<Pressable>` de RN envolviendo un Tamagui con `pressStyle` → en nativo/new-arch el Tamagui roba el responder y el `onPress` no dispara; ver la memoria `reference_rn_pressable_tamagui_tap`). Hoy **conflictúa contra HEAD en la mitad de los archivos** (`main` avanzó con las unidades de teclado/aire/CTA, que tocaron muchas de esas mismas superficies).
**Además, la premisa del barrido está EN DISPUTA y sin dirimir**: la nota del repo dice que el bug requiere `pressStyle` en el Tamagui envuelto; un comentario de la terminal muerta afirma que es **más general** (cualquier `<Pressable>` de RN envolviendo un Tamagui). En el árbol hay **24 casos en 19 archivos, ninguno con `pressStyle`** — o sea que bajo la primera premisa el barrido entero no arregla nada, y bajo la segunda arregla 24 taps. Raf tiene una prueba de device corriendo para dirimirlo.
**Por qué importa**: 2564 líneas de trabajo sin dueño, sin verificación, y que envejecen mal (cada unidad nueva que toca esas pantallas agrava el conflicto). Y **no se sabe si son necesarias**: aplicarlo antes del veredicto de device es refactorizar 67 archivos por una hipótesis.
**Próximo paso sugerido**: **NO** aplicar el stash. Esperar el veredicto de device de Raf. Si el bug resulta ser general → rehacer el barrido **desde HEAD, en lotes chicos** (la memoria ya lo dice: "barrer en lotes chicos"), con guard estático de clase, y `git stash drop` del viejo. Si resulta requerir `pressStyle` → `git stash drop` directo (los 24 casos del árbol no lo tienen). En cualquiera de los dos caminos el stash se descarta; conservarlo solo mantiene la ilusión de que hay trabajo recuperable.

## 2026-07-29 — `StickConnectionScreen`: el único `router.back()` pelado que queda en la app (ahora sí es deuda nuestra) — **RESUELTO 2026-08-05**

**Origen**: bugfix del chip del bastón (2026-07-29), al heredar la titularidad de BLE. **Actualiza** la entrada "2026-06-04 — Barrido de `backOr`", que dejaba a esta pantalla excluida *"por ser territorio de la terminal de BLE"*. Esa terminal murió y Raf nos pasó `app/src/services/ble/**` + `app/src/features/ble-stick/**` → el motivo de la exclusión ya no existe.
**Qué**: `app/src/features/ble-stick/screens/StickConnectionScreen.tsx` usa `router.back()` pelado en el chevron del header, en vez de `backOr(router, fallback)` (`app/src/utils/nav.ts`). Es el **último** de la app: el barrido del 2026-07-23 blindó 15 pantallas y dejó solo esta.
**Por qué importa**: con el stack vacío (web-refresh / hot-reload / deep-link / cold-start directo en `/baston` — que es EXACTAMENTE como se llega hoy, porque la fila de "Más" no está cableada y se entra por deep-link) el `back()` falla en silencio y el usuario queda trabado en la pantalla. Bajo impacto (una pantalla, hoy semi-oculta), pero es el único hueco de una clase que ya se cerró en todos lados.
**Próximo paso sugerido**: `backOr(router, '/(tabs)/mas')` — "Más" es el origen lógico declarado de esta pantalla (ADR-018) y es el fallback que usaron las otras 5 llegadas desde ahí. Cambio de 2 líneas + el import; sin test propio (`nav.test.ts` ya cubre `backOr`). NO se hizo en el bugfix del chip para no mezclar una corrección de navegación en un diff de afordancias.
**RESUELTO — 2026-08-05** (unidad «acceso in-app a la pantalla del bastón», `progress/impl_baston-acceso-mas.md`). Se aplicó exactamente el próximo paso sugerido: `backOr(router, '/(tabs)/mas')`, sin test propio. Fue en ESA unidad y no antes porque dependía de ella: hasta que "Más" tuvo la fila, el fallback nombraba un origen que en la práctica nunca lo era. La rama `router.back()` la ejercita el E2E `baston-multivendor.spec.ts` (e) (Más → fila → `/baston` → chevron → Más); la del fallback ya la cubre `nav.test.ts`. Con esto **no queda ningún `router.back()` pelado en la app**.

## 2026-07-29 — `$textFaint` usado en texto CHICO queda por debajo de WCAG AA (observación cross-cutting)

**Origen**: bugfix del chip del bastón (2026-07-29), fix-loop. Al escribir el vacío de `asignar-caravanas` copié el patrón del hero de `maniobra/identificar` (`$textFaint` para la línea de apoyo) y al revisarlo lo descarté; queda la observación general.
**Qué**: el token `$textFaint` (`#807A74`) está declarado en `tamagui.config.ts` como **AA-large 4.03** — o sea válido solo para ≥18px regular (o ≥14px bold). Hay **60 usos** en `app/app` + `app/src`, y una parte está en texto de **12/13/14px regular** (`fontSize="$2"/"$3"/"$4"`), donde WCAG AA pide **4.5:1**. Ejemplos: `maniobra/identificar.tsx:939` (`$4`/500), `animal/[id].tsx:1247` (`$4`/400), `(tabs)/mas.tsx:351` (`$2`/400), `export-sigsa.tsx:529` (`$3`/400).
**Por qué importa**: no es teoría de checklist — el producto se usa **a pleno sol, con una mano** (CLAUDE.md principio 4). El gris terciario sobre `$bg` en 12-14px es justo lo que desaparece en la manga. Varios de esos usos son texto secundario prescindible, pero otros llevan información (subtítulos que explican por qué algo no está disponible).
**Por qué NO se arregló acá**: es cross-cutting (60 call sites, 3 tamaños, decisión de DS), no cabe en un bugfix de afordancias del bastón. En `asignar-caravanas` se resolvió sin tocar el token: la jerarquía la da el **peso** (500 vs 400) sobre `$textMuted`.
**Próximo paso sugerido**: decidir en el DS una de dos — (a) subir `$textFaint` a ≥4.5:1 (deja de ser "faint" pero cumple en todo tamaño), o (b) declarar la regla "solo ≥18px / ≥14px bold" y barrer los usos chicos a `$textMuted`. La (b) es más honesta con el token existente; la (a) es un cambio de un valor. Un guard estático (fontSize + color) puede sostener la regla después.

## 2026-07-29 — `TagScanCta` promete "Bastonear la caravana" en devices sin bastón (misma clase, sin cerrar)

**Origen**: bugfix del chip del bastón (2026-07-29), barrida de superficies. Encontrado, evaluado y **deliberadamente no arreglado** (overflow de scope).
**Qué**: `src/components/TagScanCta.tsx` renderiza el CTA "Bastonear la caravana" **sin mirar el transporte**, en **4** call sites (ficha `animal/[id]`, `crear-animal`, `agregar-evento`/parto, `LinkCalfPrompt`). En un device sin transporte (Android hoy) ese CTA abre el `TagScanSheet`, que degrada correctamente al hero "Cargá la caravana a mano / El bastón no está disponible en este dispositivo" con un CTA primario a la carga manual.
**Por qué NO se arregló acá**: (a) **no es una afordancia de conectar** — el criterio del bugfix era "ofrece conectar sin mirar el transporte", y este CTA no llama `connect()`; (b) su destino **entrega función real sin transporte**: el `ManualTagEntry` de adentro del sheet es el **único** camino para cargar la caravana electrónica en la ficha (la ficha ya NO ofrece carga manual directa, UX Raf 2026-07-06) → ocultar el CTA **quitaría funcionalidad**; (c) arreglarlo bien implica **dos** decisiones de diseño, no una: cambiar el label por transporte ("Cargar la caravana") *y* abrir el sheet directo en modo manual para no cobrar un tap de más — con blast radius sobre los 4 call sites, el testID `tag-scan-open` y **10 archivos E2E** (6 specs + 4 captures) que asertan ese texto/testID.
**Por qué importa igual**: el label miente en el device de Raf. Es la misma clase que el chip (un significante que promete lo que no puede cumplir), un escalón más abajo: no ofrece una acción imposible, ofrece un *nombre* imposible para una acción posible.
**Próximo paso sugerido**: unidad chica de UX cuando se decida el copy. La condición ya está disponible y es la misma de siempre (`useBleProviderApi()?.transport != null`, o `resolveListenConnState`); la decisión iría en `TagScanCta` (label por prop derivada) + un `initialManual` en `TagScanSheet`. Requiere decisión de producto sobre el copy, no es mecánico.
**ACTUALIZACIÓN 2026-07-29 (unidad «bastón Android SPP») — la urgencia BAJA, el ítem NO se cierra**: Android ya **tiene** transporte (`spp-android` montado), así que en el teléfono de Raf el label "Bastonear la caravana" **dejó de mentir**. Lo que queda vivo es el caso **iOS** (sigue sin transporte alcanzable hasta el MFi) y el de un **dev build viejo sin el módulo nativo** (`isSppNativeAvailable()` false → transporte null). O sea: el defecto es el mismo, la población de devices afectados se achicó. Sigue pendiente la decisión de copy.

## 2026-07-28 — `KeyboardAvoidingShell` que MONTA con el teclado ya abierto arranca en altura 0 (límite declarado, NO cerrado)

**Origen**: bugfix 🔴 «abrir un sheet baja el teclado» (Raf, device Android, APK `a3b8d804`). El leader pidió evaluar una **capa 2**: sembrar la altura del teclado al montar.
**Qué**: cuando el shell se suscribe con el IME YA visible, `height` arranca en **0** hasta el próximo evento de insets (`KeyboardAnimationManager` no le reproduce el estado actual a un listener nuevo; `KeyboardAvoidingView` en iOS hace lo mismo con `keyboardWillChangeFrame`). El contenido no sube hasta que el teclado se mueva.
**Estado**: la **capa 1** (abrir un overlay modal descarta el teclado — `hooks/useDismissKeyboardOnOpen` en los 22 archivos con `$scrim`, con guard) saca de la ecuación a **todos los overlays**, que eran el caso reportado y el único con consecuencia grave (un diálogo de decisión inoperable en la manga). Lo que queda expuesto es **una superficie que monte con el teclado arriba sin ser un overlay**: en la práctica, navegar a otra pantalla mientras se tipea. Se auto-corrige al primer evento del IME y no bloquea ninguna decisión.
**Por qué NO se sembró la altura (decisión, con fundamento)**: la única fuente disponible al montar es `Keyboard.metrics()`, y su `height` es **la de RN, o sea la que está mal bajo edge-to-edge** (`ReactRootView.java:978` = `imeInsets.bottom - barInsets.bottom`). Usarla exige sumarle de vuelta el inset inferior de `systemBars`, y ese término de corrección **no es verificable desde web ni desde el unit** (el bug entero es invisible en RNW) y **no está garantizado que sea el mismo** que RN resta (gestos vs 3 botones, cutouts, y el frame-0 en 0 contra el que este repo ya tuvo que blindarse en `useSafeBottomInset`). Un término equivocado da un lift equivocado, que es **peor que no levantar nada**: el contenido salta a un lugar mal y recién se acomoda con el próximo evento del IME. Sumado a que habría que escribir sobre un shared value cuyo dueño es el `KeyboardAnimationManager` (contrato de Reanimated) y a que `useAnimatedKeyboard` ya está `@deprecated` (la migración a `react-native-keyboard-controller` está en este mismo backlog), el costo/riesgo no se paga hoy.
**Próximo paso sugerido**: revisarlo **junto con** la migración a `react-native-keyboard-controller` (que expone el estado del teclado sin la resta de la barra), no antes. Si aparece un caso 🔴 de "navegué con el teclado arriba y la pantalla nueva quedó tapada", la alternativa BARATA y sin aritmética es descartar el teclado también en el cambio de ruta (mismo criterio de producto que la capa 1: navegar es salir del contexto de escritura).

## 2026-07-28 — Los 21 sheets a mano ahora arrastran DOS invariantes copiados a mano (no uno)

**Origen**: mismo bugfix. Al adoptar `useDismissKeyboardOnOpen` en los 21 overlays hechos a mano quedó a la vista que cada uno repite, copiado: el `View absolute inset0 $scrim`, el guard anti click-huérfano (doble rAF), la reserva inferior, y ahora el descarte del teclado.
**Qué**: cada invariante nuevo del patrón sheet cuesta 21 ediciones + un guard estático que lo sostenga. Ya hay **dos** guards de este tipo (`keyboard-avoiding`, `sheet-keyboard-dismiss`) y la entrada de backlog de migrar los 6 sheets con input a `BottomSheetShell` sigue abierta.
**Por qué importa**: el guard evita la regresión silenciosa, pero no baja el costo. La migración de los sheets a mano al primitivo convierte los dos guards en un chequeo de una línea sobre un solo archivo.
**Próximo paso sugerido**: ampliar la entrada existente de migración a `BottomSheetShell` para incluir **todos** los overlays con scrim (no solo los 6 con input), con el criterio ordenado por riesgo: primero los alcanzables desde la manga 🔴.

## 2026-07-22 — 🎯 REBRANDING (nombre nuevo) — camino crítico del beta; bloquea U8a/deep-links + submit a stores

**Origen**: al arrancar el Gate 0 de U8a (deep links), Raf avisó: **rebranding PENDIENTE, nombre NUEVO (RAFAQ no es final), "cambia todo"**, y **no tiene dominio ni nada (0)**.
**Qué**: cambio de identidad de la app. Toca, en cadena: (1) **decidir el nombre nuevo** (decisión de Raf, sin empezar); (2) **conseguir el dominio** (no existe); (3) rebrandear el CÓDIGO — bundle id (`ar.rafq.app` → nuevo; barato ahora, PRE-launch), `scheme` (`rafq://`), URLs hardcodeadas del invite (`app.rafq.ar` en `invite_user`/`resend_invitation`/`members.ts` `INVITE_BASE_URL`), strings "RAFAQ"/"rafq" en todo el código, nombre EAS/Supabase project, app.config.ts (name/slug); (4) **assets de marca** (logo/colores/favicon/íconos); (5) app store listings.
**Por qué importa (CRÍTICO para el beta)**: es **prerequisito** de U8a (deep links dependen del dominio+bundle final) y del **submit a las stores** (bundle id + nombre + assets son dolorosos de cambiar POST-launch). La prioridad-beta que eligió Raf (multi-usuario/U8a) está en realidad DETRÁS de esto. Hacer deep-link config ahora contra `app.rafq.ar` = 100% trabajo tirado.
**Estado**: NADA que hacer hasta que Raf **decida el nombre nuevo** (nada que rebrandear sin nombre). El leader puede ayudar a scopear el rebrand MECÁNICO (inventario de dónde vive "rafq"/"RAFAQ", plan de migración de bundle/scheme/URLs/EAS/Supabase, checklist de assets) una vez elegido el nombre.
**Próximo paso sugerido**: Raf decide el nombre → registra dominio → el leader arma el plan de rebrand (probablemente su propio "feature"/effort grande) → recién ahí U8a (deep links) + preparación de stores. Fixes rebrand-safe del invite (loop + backOr) se hacen YA (independientes del nombre).

## 2026-07-22 — U8a (deep links de invitación / multi-usuario) — DIFERIDO hasta el rebrand

**Origen**: Gate 0 de U8a (2026-07-22). Groundwork (Explore) confirmó que **toda la lógica de aceptación ya existe y está testeada** (pantalla `/invite`, parseo token universal/deep-link/crudo, `accept_invitation`, persistencia cross-cold-start secure-store+RootGate, todos los errores + binding U9). El scheme `rafq://` ya funciona.
**Qué falta (el delta de U8a)**: (A) config nativa **app** — `ios.associatedDomains:['applinks:<dominio>']` + `android.intentFilters` `autoVerify` para `https://<dominio>/invite` (NO están en `app.config.ts`); (B) **externo (Raf)** — hostear el dominio + servir `/.well-known/apple-app-site-association` (appID `<TeamID>.<bundle>`, Team `5C9KYFJCU5`) + `/.well-known/assetlinks.json` (package + SHA-256 de `eas credentials`) + página fallback (redirect a `rafq://` + instrucciones). (C) 2 bug fixes rebrand-safe del invite (loop + backOr) → **se hacen YA**, aparte.
**Por qué DIFERIDO**: (A) y (B) dependen del **dominio + bundle FINAL**, que el rebrand va a cambiar (ver entrada rebrand arriba). Hacerlos ahora = trabajo tirado. **Se retoma apenas el rebrand cierre nombre/dominio/bundle.** Ahí: config app + generar los 2 `.well-known` (con el fingerprint de eas credentials) + fallback + rebuild + verificación en device. Edge cases ya mapeados (app no logueada→cubierto; verificación sin propagar→fallback web+paste; device sin app→web; expirado/usado/binding→server-side).

## 2026-07-20 — `lastSyncedAt` es un proxy NO determinista del cambio de dato → migrar a watched queries (PowerSync) · **3 consumidores HECHOS (feature 21); resto = migración incremental pendiente**

**✅ CERRADO en la UI de usuario (2026-07-23, `impl_adr030-watched-queries-resto`)** — el proxy no determinista `lastSyncedAt` ya NO dispara ninguna re-lectura de tabla local en la app.

**Historia**: (a) feature 21 migró los 3 consumidores de la 20 (`EstablishmentContext`/`RodeoContext` con `db.onChange`, `lotes.tsx` con `useQuery`). (b) feature 22 migró `useManeuverGating` (config/maniobra). (c) **2026-07-23**: un inventario AUTORITATIVO por grep destapó que los consumidores que TODAVÍA usaban el proxy NO eran los "4 focus-only" que decía la memoria, sino **otros 4** — `animales.tsx` (lista+búsqueda), `index.tsx`/home (conteos+cards), `ProfileContext.tsx` (saludo), `useGroupView.ts` (grupo grande) — **todos migrados a `db.onChange`**. Además se cazó un 5º en la autorrevisión: `mas.tsx` `RenspaBanner`, que usaba `statusChanged` (vía `subscribeSyncUiState`) como data-proxy → también migrado (`db.onChange` sobre `establishments`).

**Los "focus-only" del backlog NO usaban el proxy**: `miembros`/`animal[id]`/`export-sigsa` recargan por `useFocusEffect` (sin señal de sync); `use-reports` es **online-only** (KPIs server-side, sin tabla local que observar). No son objetivo de "matar el proxy"; darles reactividad viva sería feature nueva (follow-up opcional).

**Permanecen (usos legítimos de status, NO data-proxy)**: `connected` (online/offline) + `hasSynced` (vacío-vs-sincronizando en lotes). **Falta**: veredicto en DEVICE (nativo, ADR-029) de que `db.onChange` dispara al bajar el cambio al SQLite local en sesión viva. Detalle + trazabilidad en `progress/impl_adr030-watched-queries-resto.md` y **ADR-030**. Entrada original abajo por trazabilidad.

**Origen**: feature 20 (reactividad de lecturas sync). El diagnóstico ORIGINAL de este ítem ("un SEGUNDO cambio no se ve en 120 s") estaba **confundido** (lo objetó el reviewer): se apoyaba en que tras un `reload` el dato aparecía — pero el reload re-sincroniza y el SQLite local es persistente, así que trae la fila igual; no probaba que estuviera local ANTES. **Rehecho con un experimento A/B DETERMINISTA** (2/3 cambios server-side secuenciales, sondeo DIRECTO del SQLite vía `__RAFAQ_PS__.getAll` SIN reload) en la remediación de la 20.
**Qué (corregido, con evidencia)**: la fila SIEMPRE llega al SQLite local en **~1,5 s** (6/6 cambios, INSERT y UPDATE) — la ENTREGA del dato NO es el problema. Pero `lastSyncedAt` avanza de forma **NO determinista por cambio**: corrida 1, los 3 cambios ticaron al instante; corrida 2, el **primer** cambio se estancó (fila en SQLite, señal congelada ~90 s) hasta que un cambio POSTERIOR forzó un checkpoint que barrió todo. O sea: NO es un "latch permanente" (el claim viejo "deja de avanzar tras el 1er cambio" es falso), es que `lastSyncedAt` significa "último sync FULL completado", no "cambió un dato" — el **primitivo equivocado** para reactividad, que puede lagear arbitrariamente detrás de la llegada del dato.
**Por qué importa**: la 20 arregló la RE-LECTURA (re-leer en CADA avance de la señal, que antes no pasaba nunca) y es estrictamente mejor que el latch, pero **no puede** hacer que la UI reaccione a un cambio cuyo checkpoint no tica la señal. "Un coworker cambia una cosa" puede tardar en verse hasta el próximo checkpoint (otro cambio, un keepalive, un reconnect).
**Fix real (EXPANSIÓN DE ALCANCE — decisión de Raf)**: migrar los 3 consumidores (`EstablishmentContext`, `RodeoContext`, `lotes.tsx`) —y a la larga toda la app— a **watched queries** (`useQuery`/`db.watch`) que reaccionen al cambio del SQLite local en vez de a la señal gruesa de status. Hoy la app tiene **cero** watched queries (deuda deliberada, `specs/active/15-powersync/design.md`, y la entrada 2026-06-09 de este backlog). Merece su propio ADR + spec.
**Próximo paso sugerido**: ADR de migración a `db.watch` (arranca por los 3 consumidores de la 20, que ya están aislados). Evidencia cruda del A/B en `progress/impl_20-reactividad-sync.md`.

## 2026-07-20 — El rodeo activo borrado por un coworker durante una maniobra

**Origen**: feature 20, `design.md` §8 riesgo 6. Anotado al cerrar la feature.
**Qué**: D1 (no patear al operario en medio de una maniobra) cubre la **revocación del campo**. No cubre que un coworker borre el **rodeo activo** mientras hay una jornada en curso sobre ese rodeo. `applyRodeos` preserva el preferido *mientras exista en el set*; si desaparece, cae al primero disponible — cambia el rodeo bajo los pies del operario.
**Por qué importa**: es el mismo modo de falla que D1 evita para campos, una superficie más abajo. Raro (requiere que borren justo el rodeo en uso), pero desconcertante en la manga.
**Próximo paso sugerido**: decidir con Raf/Facundo si merece el mismo tratamiento que D1 (diferir + avisar al cerrar) o si alcanza con un aviso. No inventar la decisión: la 20 lo dejó explícitamente afuera.

## 2026-07-20 — Distinguir "campo borrado" de "rol revocado" requiere una señal server-side

**Origen**: feature 20, `design.md` §6 (E5). Verificado columna por columna.
**Qué**: desde el cliente las dos causas son **indistinguibles**: `remove_member` y el trigger `deactivate_roles_on_establishment_soft_delete` (0076) escriben el mismo par de columnas con los mismos valores (`active = false` + `deactivated_at = now()`), y en ambos casos la fila de `establishments` sale del SQLite local. Por eso el aviso usa un copy verdadero para ambas y la razón `establishment_deleted` quedó declarada en el tipo pero **no alcanzable**.
**Por qué importa**: hoy no se puede decirle al usuario *por qué* perdió el campo. Un borrado es definitivo y una revocación puede revertirse; con un flujo de restore (que el MVP no tiene) la diferencia empezaría a habilitar acciones distintas.
**Próximo paso sugerido**: si alguna vez se agrega restore/undelete de establecimientos, resolver server-side una razón fiel (columna o evento) y recién ahí prender la rama del copy. Costo sin beneficio hasta entonces.

## 2026-07-19 — 🔴 Pérdida SILENCIOSA de writes del operario cuando le revocan el acceso al campo

**Origen**: Gate 0 de la feature 20 (reactividad de lecturas sync). Hallazgo **fuera del alcance** de esa feature, sacado aparte por decisión de Raf (D3) porque es pérdida de datos y merece spec + Gate 1 propios.
**Qué**: cuando a un usuario se le revoca el rol (o se borra el campo), `org_scope` deja de incluir ese `establishment_id` → **PowerSync borra el bucket** → las filas locales desaparecen del SQLite del device. Hasta ahí es correcto. El problema es lo que pasa con lo que el operario ya cargó y todavía no subió:
  1. Los `op_intents` / CrudEntries encolados en el outbox **se suben igual** cuando hay red.
  2. Server-side rebotan por RLS → `42501` → `classifyIntentUploadError` lo clasifica **permanente** → `rollbackOverlay(clientOpId)` + `transaction.complete()` (ver `app/src/services/powersync/connector.ts:175-181`).
  3. Resultado: **el trabajo se descarta**. El overlay optimista se revierte y la fila real nunca existió server-side.
**Por qué importa**: 🔴 ALTO pese a ser raro. El escenario exige que la revocación caiga justo mientras hay trabajo sin sincronizar, pero el modo de falla es el peor posible para este producto: el peón cargó 20 animales en la manga, se los revocan, y desaparecen **sin que nadie le avise**. Viola el principio 3 de CLAUDE.md (offline-first) en su punto más sensible: el dato cargado en el campo no se pierde nunca.
**Matices a resolver en la spec**:
  - ¿Se puede distinguir "42501 por revocación de acceso" de "42501 por RLS legítima" (intento de escribir algo que nunca le correspondió)? El primero merece preservación; el segundo es un rechazo correcto.
  - ¿Dónde se preserva lo rechazado? (¿export local? ¿cola en cuarentena? ¿re-asignable si le devuelven el acceso?)
  - Hoy `recordUploadRejection` (R10.8) ya materializa el rechazo en un store observable que la UI de manga consume — **puede ser el gancho**, pero hay que verificar que sobreviva al borrado del bucket.
  - Interacción con D1 de la feature 20: se decidió no patear al usuario en medio de una maniobra, pero eso es solo navegación — los datos se van igual por abajo hasta que ESTA entrada se resuelva.
**Próximo paso sugerido**: feature propia con Gate 0 + Gate 1 (toca frontera de autorización + retención de datos del operario). Levantarla apenas cierre la feature 20, que es su vecina natural. Evidencia completa en `specs/active/20-reactividad-sync/context.md` §6 E2.

## 2026-07-19 — Pelaje: pasar de texto libre a lista de opciones (BLOQUEADO por validación de dominio)

**Origen**: sesión de planificación de mejoras UX (2026-07-18), ítem 1 de los 5 que levantó Raf. Ver `docs/plan-mejoras-ux-2026-07-18.md`.
**Qué**: hoy el pelaje se carga en un campo de **texto libre**. El mismo pelaje entra de N formas (`colorado` / `Colorado` / `col.` / `rojo`) → el dato no es contable ni comparable, y rompe cualquier reporte o benchmarking por pelaje. Se propone una **lista cerrada + "Otro (especificar)"** como salida de emergencia para no trabar al operario en la manga.
**Estado**: la lista candidata (12 pelajes) ya está redactada y sale de cruzar la clasificación de **Bavera** ("El pelaje del bovino y su importancia en la producción", 2009) con las razas que la app ya maneja → `docs/pelajes-consulta-facundo-2026-07-18.txt`. Va corta a propósito: se usa con guante y cada opción de más cuesta tiempo (Hick).
**⛔ BLOQUEADO POR**: validación de **Facundo** (vet socio). No se implementa nada hasta que apruebe la lista y conteste las 4 preguntas del documento, porque las respuestas **cambian el diseño**, no solo el contenido:
  1. **¿un campo o dos?** Bavera trata "pampa" como particularidad de la CABEZA, no color de cuerpo (un Hereford es colorado + cabeza pampa). Un campo = 1 toque y lista mezclada; dos campos = más preciso y 2 toques. Propuesta: **un campo** (manga).
  2. **¿el pelaje IDENTIFICA o DESCRIBE?** Si sirve para reconocer un animal sin leer la caravana, la lista tiene que discriminar mejor y probablemente necesite más opciones.
  3. **¿obligatorio u opcional?** En la charla de dominio de junio quedó anotado que pasa a dato base NO opcional; hoy la app lo tiene opcional.
  4. **¿falta o sobra algo?** términos de uso corriente en la zona.
**Por qué importa**: medio-alto. Es dato base de todas las categorías y habilita analytics/benchmarking (uno de los 3 pilares del producto). Pero implementar sobre una taxonomía no validada es peor que no implementar: migrar datos de pelaje ya cargados sale caro.
**Nota de trazabilidad**: en la sesión advertí que `moro`/`cebruno`/`rosillo` eran términos equinos — **estaba equivocado**, Bavera los documenta como nomenclatura bovina argentina válida y quedaron en la lista. Lo que sí es equino es el "Código de Pelajes" de la SRA (no usar como fuente).
**Próximo paso sugerido**: cuando Facundo responda → Gate 0 (refinamiento de contexto) + spec del delta sobre feature de alta de animal. Toca modelo de datos (enum/catálogo vs texto) + migración de los pelajes ya cargados en texto libre.

## 2026-07-22 — Auditar sheets con `<ScrollView flex={1}>` — colapso en nativo con contenido corto (patrón latente)

**Origen**: fix de U5 (`8752592`). El `ManeuverConfigSheet` tenía `<ScrollView flex={1}>` dentro de un `YStack maxHeight:85%` SIN altura fija → en nativo (Yoga) el ScrollView colapsa a altura 0 cuando el contenido es CORTO (no llega al cap → `flexGrow:1`/`basis:0%` sin espacio libre). En WEB no pasa. Fix aplicado: `flexShrink:1` (grow:0, basis:auto).
**Qué falta**: **auditar los OTROS sheets con el mismo patrón** (`flex={1}` en un ScrollView dentro de un padre `maxHeight`-sin-altura-fija). Conocido: **`CustomFieldSheet.tsx`** (`flex={1}` en 2 ScrollViews) — hoy NO roto porque su contenido es SIEMPRE alto (un form entero → clampea el padre al maxHeight → flex:1 funciona), pero es latente si algún estado deja el contenido corto. Grep: `flex={1}` + `ScrollView` en `app/**`.
**Por qué importa**: medio. Es la clase de bug web-ok/native-roto (memoria `reference_rn_web_pitfalls`) y 🔴 si toca un sheet de manga. Barato de prevenir (flexShrink:1 o el patrón de BulkConfirmSheet = ScrollView sin flex, content-sized).
**Próximo paso sugerido**: cuando se toque `CustomFieldSheet` (o cualquier sheet), aplicar `flexShrink:1`. NO forzar un barrido masivo ahora (cada uno necesita device-verify). Codificar la regla en el skill `design-review` (patrón de sheet: body = `flexShrink:1`, NO `flex:1`, sobre padre `maxHeight`-auto).

## 2026-07-22 — Rutinas (presets) vs dato deshabilitado: 2 gaps (el caso base está bien)

**Origen**: pregunta de Raf ("¿qué pasa si deshabilito un dato usado en una rutina guardada?"). Investigación (Explore) confirmó que el **caso base está BIEN resuelto**: los presets son por-establecimiento (`maneuver_presets`, sin rodeo_id); al aplicar (`loadPreset(preset, rodeoId)`, `app/src/services/maneuver-presets.ts:177-198`) se filtra contra la config del rodeo (`filterApplicableManeuvers`), la maniobra deshabilitada va a `omitted` → no pre-seleccionada + no en el pool + InfoNote "Se omitieron por la configuración del rodeo: X" (`jornada.tsx:762-766`); arranca solo con las aplicables; el preset NO se modifica; barrera server-side capa 2 (trigger 0054, `assert_data_keys_enabled`, rechazo 23514). Sin dato basura, sin rotura.

**Gap 1 (menor) — asimetría de aviso para maniobras CUSTOM.** `loadPreset` solo filtra las de FÁBRICA hacia `presetOmitted`; las custom (`customManiobras`) van directo a `chosenCustom` sin filtrar y recién se filtran en `buildCurrentConfig` contra las custom enabled del rodeo (`jornada.tsx:246-247`, `:328-332`) → una maniobra custom de la rutina deshabilitada/borrada en ese rodeo **desaparece SIN el InfoNote**. Fix: alimentar `presetOmitted` también con las custom omitidas.

**Gap 2 (el importante) — poda PERMANENTE y silenciosa al EDITAR una rutina desde un rodeo con el dato OFF.** En modo edición (`editPresetId`, `jornada.tsx:363-384`) se elige un rodeo y corre el mismo `loadPreset`; `buildCurrentConfig` reconstruye desde `chosen` (solo aplicables) → si editás la rutina (p. ej. para reordenar/agregar) con un rodeo donde `vacunacion` está OFF y guardás, `updatePreset` **sobrescribe el preset SIN vacunacion** → se pierde permanentemente de la rutina, aunque sería válida en otros rodeos. Hay InfoNote pero es fácil no registrarlo si editás por otro motivo. Es borrado silencioso de config. **Fix direction**: al EDITAR (distinto de aplicar), preservar las maniobras del preset que están omitidas-por-el-rodeo-de-edición (no dropearlas del `updatePreset`); o desacoplar la edición de la rutina del gating de un rodeo puntual.

**Nota menor (transitorio, no data-integrity)**: si `loadPreset` falla porque el gating del rodeo no sincronizó, `jornada.tsx:238` (`if (!active || !r.ok) return;`) sale sin setear maniobras ni superficiar error → wizard con selección vacía sin mensaje. Edge-case.

**Próximo paso sugerido**: decidir con Raf si Gap 2 amerita fix ya (borrado silencioso de config = clase data-loss, aunque edge-case). Gap 1 = fix chico cuando se toque el wizard. Ambos frontend puro.

## 2026-07-22 — ✅ CERRADO — Skeleton loaders (U6b, 2 incrementos)

**✅ DONE (2026-07-22)**: 1er incremento `54c13ea` (primitivo `Skeleton.tsx` + animales/home-rodeos/lotes/reportes) + 2do incremento `745c0c2` (ficha/rodeos/miembros — presets `AnimalFichaSkeleton`/`RodeoCardSkeleton`/`MemberRowSkeleton`). Skeletons de 1ra-carga en TODAS las pantallas de carga de la app, guard anti-parpadeo (`data===null`), pulse de opacidad (Reanimated, reduce-motion), cero deps/cero tokens nuevos. Gates: reviewer APPROVED ×2 + veto visual del leader PASS (7 capturas) + typecheck + anti-hardcode 0 + frontend-puro. Home "Lotes" queda SIN skeleton a propósito (cantidad fetcheada → evita flash de cards fantasma). **Nada pendiente.**

## 2026-07-21 — Nombre de establecimiento largo se trunca/recorta en toda la UI (auditoría de truncado)

**Origen**: sesión 2026-07-21, mientras Raf probaba el bug de sync-down en el campo "nombre de campo de prueba" (nombre largo a propósito).
**Qué**: un nombre de establecimiento largo no se ve entero EN NINGÚN lado (header/switch, cards de home, títulos). Decisión de diseño (leader, 2026-07-21): **truncar con ellipsis en los lugares apretados es correcto** (patrón estándar, Jakob) — NO forzar el nombre completo en headers (rompe layout). PERO el nombre completo debe ser legible en AL MENOS un lugar con espacio: la lista **"Mis campos"** y/o **editar-campo** (wrap a 2 líneas, no truncado).
**Por qué importa**: bajo-medio. El caso extremo hoy es un nombre de prueba; pero un nombre real largo ("Establecimiento La Esperanza del Sur S.A.") es plausible. Robustez de layout + no perder la identidad del campo.
**A verificar cuando se toque**: (a) truncado = ellipsis real con `numberOfLines={1}` (no corte a lo bruto); (b) **descender-safe** (`lineHeight="$N"` matching — bug recurrente g/p/j/q, ver memoria `feedback_descender_clipping`); (c) el nombre completo aparece entero en "Mis campos"/editar-campo. **Vetear con un nombre largo QUE TENGA descendentes.**
**Próximo paso sugerido**: pulido de UI (foldear con U6b o la tanda de polish). No urgente. NO arrancar hasta cerrar el bug de sync-down.
**RESUELTO 2026-07-23** (polish frontend, sin backend): se aplicó la decisión por lugar.
- APRETADOS (ellipsis, `numberOfLines={1}` + `lineHeight` matching, descender-safe): switch del header (`app/(tabs)/index.tsx` HomeHeader, `lineHeight="$5"`); filas del dropdown del switch (`EstablishmentSwitcherDropdown.tsx` Row, `lineHeight="$5"`); lista de campos bloqueantes de eliminar-cuenta (`app/(tabs)/mas.tsx`, `lineHeight="$4"`). El ellipsis ya funcionaba (contenedores con `flexShrink`/`minWidth:0`); faltaba el `lineHeight` (recorte de descendentes).
- ROOMY (nombre completo): card de "Mis campos" (`EstablishmentCard.tsx`) → `numberOfLines={1}`→`{2}` (wrap 2 líneas) + `lineHeight="$7"`; editar-campo ya muestra el nombre entero en el input (sin cambios).
- Spot documentado sin tocar: `mas.tsx` `SectionTitle` "Campo activo · <nombre>" wrappea libre (fontSize $3, sin numberOfLines) → muestra el nombre entero, no recorta; la captura 04 confirma que a $3 entra en 1 línea. Se dejó como está (cambiar el SectionTitle compartido afectaría 5 títulos por poco valor).
- Fuera de alcance: `FindOrCreateOverlay.tsx` (transferencia BLE, territorio de la otra terminal) — el nombre va inline en prosa que wrappea, no se recorta.
- Verificado con capturas @412px + nombre "nombre de campo de prueba" (descendentes 'p' en campo/prueba): `app/e2e/captures/nombre-establecimiento-largo.capture.ts`. typecheck + anti-hardcode verdes; `git diff supabase/ sync-streams/` vacío.

## 2026-07-18 — PowerSync no reconecta / no re-evalúa buckets nuevos sin reiniciar la app (offline-first) · 🔧 **EN FIX — feature 22 (a) commiteada, veredicto device pendiente**

**🔧 FIX (2026-07-22, feature 22 `22-sync-liveness-nativo`, commiteada):** RC-1 atacada por reconexión NetInfo+AppState (cliente puro, ADR-031) + `useManeuverGating` migrado a watched query (continúa ADR-030) + instrumentación de SyncStatus. Gates verdes (reviewer APPROVED + Gate 2 PASS + veto visual + 206 unit + 8 E2E + git diff supabase/ sync-streams/ vacío). **PENDIENTE: veredicto en DEVICE** (ADR-029) — que la descarga reenganche en nativo tras los triggers (la instrumentación `[powersync][diag]` lo evidencia). **Límite conocido**: los 2 triggers NO cubren la muerte silenciosa del socket mid-foreground sin cambio de red → contingencia **(a′) watchdog de foreground** (decide la instrumentación en device; no implementada a ciegas). **Fast-follow con Gate 1**: **(c)/RC-2** — el overlay se limpia en el ACK HTTP (`connector.ts`) antes de que baje la fila synced confirmada → sostenerlo hasta el eco (candidato Gate 1; con la descarga sana el flicker es sub-segundo). **Contingente**: **(b)** streaming HTTP (`react-native-fetch-api`) solo si el device muestra que ni el teardown+reconnect restablece la descarga.

**⬆️ CONFIRMACIÓN 2026-07-21 (Raf, device Android)**

**⬆️ CONFIRMACIÓN 2026-07-21 (Raf, device Android)**: el bug **muerde un flujo frecuente y crítico** — habilitar datos en "Editar plantilla" de un rodeo (RPC `set_rodeo_config` vía outbox + overlay). El save PERSISTE server-side (verificado en DB dev: `rodeo_data_config.enabled=true`, `updated_at`=momento del save, `establishment_id` OK, in-scope del stream `est_rodeo_data_config` auto_subscribe), pero el device NO baja el cambio en vivo → el toggle "revierte" tras guardar y el dato NO se puede usar en maniobra hasta **reiniciar la app** (arranque en frío → `db.connect()` re-baja → converge). Raf habilitó ~5 datos, TODOS quedaron off hasta el reinicio (no es puntual de un field → sync-down amplio muerto en sesión viva). El caso de uso es el bucle config→maniobra: habilitás un dato JUSTO para usarlo en maniobra ahí mismo → tiene que reflejarse rápido sin restart. **Confirma que el sync-DOWN no fluye en nativo durante una sesión viva** (ni siquiera para los writes que el propio cliente confirmó al subir). Diagnóstico de código + plan de fix en marcha (Plan agent, 2026-07-21). **Se eleva a feature propia con Gate 0 + probable Gate 1 (toca la frontera de sync).** Sospechas a validar: (1) `db.connect` una sola vez sin reconexión (NetInfo/AppState); (2) streaming de descarga roto en nativo; (3) el overlay hand-rolled se limpia en el ACK ANTES de que baje la fila confirmada → ventana de inconsistencia. Entrada original abajo.

**Origen**: sesión de bring-up nativo + test de sync en el Android A07 (seed de 5000 animales). Raf lo reprodujo: creé un campo nuevo server-side y, con la app VIVA y online (incluso togglendo modo avión), el device NO lo bajó; el campo solo apareció tras **cerrar y reabrir** la app.
**Qué**: `app/src/services/powersync/provider.tsx` llama `db.connect(connector)` UNA sola vez cuando `hasValidSession` pasa a true (login/mount). NO hay listener de red (NetInfo) ni de foreground (AppState) que reconecte o re-evalúe las parameter queries (`org_scope`) al volver la conexión. Depende 100% del retry interno del SDK de PowerSync, que en nativo no reenganchó limpio (o no propagó el bucket nuevo) tras el toggle de red.
**Por qué importa**: ALTO para offline-first (principio 3 de CLAUDE.md). El peón en la manga pierde y recupera señal constantemente; si el sync no resume solo (subir writes encolados + bajar deltas + buckets nuevos) sin reiniciar la app, es showstopper de campo. También afecta ver invitaciones / campos nuevos en caliente.
**Próximo paso sugerido**: diagnóstico primero (reproducir con logs de PowerSync) — (a) confirmar si el retry del SDK reconecta tras drop de red en nativo, (b) wirear reconexión explícita en `provider.tsx` con NetInfo (online→`connect`) + AppState (foreground→revalidar), (c) verificar propagación de bucket/parameter-query nuevo sin restart. Después spec/ADR; toca el core de sync → probable Gate 1 si cambia la frontera.

## 2026-07-18 — Lista de Animales no virtualizada + tope LIMIT 200 (rodeos grandes solo alcanzables por búsqueda)

**Origen**: sesión de test de performance con rodeo de 5000 en el A07 (gama baja). El leader lo dedujo del código antes de medir.
**Qué**: la tab Animales (`app/app/(tabs)/animales.tsx`, ~l.361-401) renderiza con `ScrollView` + `visible.map(...)` — **no virtualizada** (no FlashList/FlatList). Y `fetchAnimals` (`app/src/services/animals.ts`) trae **LIMIT 200** (`buildAnimalsListQuery`, `local-reads.ts` l.749). Efecto: en un campo de >200 cabezas el operario **solo alcanza los 200 más recientes** por scroll; al resto llega únicamente por el buscador. El header cuenta `list.length` (topeado en 200), no el total real del rodeo.
**Por qué importa**: medio-alto. Rodeos reales de cría son de cientos a miles; el tope silencioso da falsa sensación de "faltan animales" y rompe la exploración por scroll. La no-virtualización además impide subir el tope sin antes cambiar la lista (200 filas no-virtualizadas ya es borderline en el A07; miles la funden).
**Próximo paso sugerido**: (1) virtualizar con FlashList/FlatList — obra de performance real y prerequisito de (2). (2) reemplazar el LIMIT 200 por paginación / scroll infinito y un contador de total real desacoplado de la lista renderizada. (3) el buscador ya cubre el acceso puntual. Feature nueva (spec/ADR de la lista) — dimensionar según lo que mida el test del A07.

## 2026-07-18 — `user_private.email` es auto-escribible por el cliente (grant a nivel tabla, no de columna)

**Origen**: Gate 2 (code) del delta de teléfono. **Pre-existente de spec 14 (`0068`), fuera del alcance del delta** — el delta solo agrega restricción, no afloja nada.
**Qué**: `0068_user_private_pii.sql:200` otorga `grant select, update on public.user_private` a nivel de **tabla**, no de columna. Con la RLS `user_private_update_self`, eso permite que un usuario autenticado **se auto-escriba el `email`** vía PostgREST (solo su propia fila) y lo **desalinee de `auth.users`**, que es la fuente de verdad de la identidad.
**Ojo con el comentario engañoso**: el bloque `RTEL.14.5` de `supabase/tests/user_private/run.cjs` afirma que "el cliente no tiene grant para escribir su email". **Es inexacto** y puede inducir a error a quien lo lea. Corregirlo cuando se toque ese archivo.
**Por qué importa**: bajo-medio. Es self-scoped (no cruza usuarios ni tenants) y un email de contacto desalineado no otorga privilegios — la identidad la sigue gobernando `auth.users.email`, y el trigger `propagate_confirmed_email` (`0068:169-194`) la re-propaga al confirmar. Pero ensucia el dato de contacto y contradice el propósito de aislamiento de PII de ADR-025.
**Próximo paso sugerido**: evaluar `grant update (phone) on public.user_private` (column-level), para que el cliente pueda escribir el teléfono y NO el email. Toca grants → **Gate 1 puntual** + verificar que no rompa `saveProfile` ni el trigger de propagación. Foldear cuando se toque `user_private` por otra razón.

## 2026-07-18 — ✅ CERRADO MAL, REABIERTO Y RESUELTO (2026-08-06) — Zona muerta de tap en el FAB de Maniobra

> **⛔ LA HIPÓTESIS (a) DE ESTA ENTRADA ERA LA CORRECTA, Y SE CERRÓ IGUAL.** El 19/7 se dio por
> "no se reproduce" porque Raf tocó el FAB en el iPhone y anduvo. El defecto existía —y era el
> **opuesto** al que la entrada preveía: no una zona muerta (target *de menos*), sino un target
> **de más** que invadía territorio ajeno. Se manifestó recién el 2026-08-05 como otro síntoma
> (*"el pill de «Conectando…» que se ve arriba del rayo de modo maniobra, si lo clickeo me lleva al
> modo maniobra"*). Resuelto en la unidad «el FAB le roba los taps a la banda de arriba del nav»
> (2026-08-06, `progress/impl_fab-hitslop-pill.md`).
>
> **EL ERROR DE MÉTODO, que es lo que hay que aprender de acá.** La entrada escribió: *"Si reaparece:
> el síntoma sería «toco el FAB y no pasa nada»"*. Previó **un solo** modo de falla —el de menos— y
> declaró el diagnóstico refutado al no verlo. Un target y su vecino son un sistema con **dos** modos
> de falla simétricos (el botón no llega / el botón se pasa), y una prueba que solo mira uno no puede
> cerrar el otro. Peor: el test que se corrió ("¿el FAB responde donde debería?") **pasa igual** con el
> bug puesto, porque el bug hace que el FAB responda **de más**. Un experimento que da el mismo
> resultado con y sin el defecto no es evidencia — y así se archivó como "no se reproduce" algo que sí
> pasaba. Regla que queda: cuando se sospecha de la **geometría de un target**, se mide contra **qué
> choca**, no solo si el propio botón anda.
>
> **LA HIPÓTESIS (a) ERA CIERTA — medido, no deducido (2026-08-05/06, el leader).** Dos métodos
> independientes:
> - **Web** (viewport 412×915, cajas reales del DOM): pill `top=777 bottom=810` (alto 33) · FAB
>   `top=820 bottom=884` · aire pill↔círculo **10 dp** · techo del target con `hitSlop` en `y=794` →
>   **solape de 16 dp = 48 % inferior del pill**.
> - **Device A07** (720×1600, densidad 300 → 1 dp = 1,875 px): pill `[241,1244]-[479,1306]` (62 px =
>   33 dp) · techo **PINTADO** del círculo (`$primary` #1E5A3E, medido con Pillow sobre `screencap`)
>   en `y=1324` · techo **TÁCTIL** del FAB en `y=1276` (barrido de `input tap`: 1272 no dispara, 1276
>   sí) → **48 px = 25,6 dp ≈ `$fabRaise`** por encima de la pintura, y **30 px = 16 dp** de solape con
>   el pill. Los dos métodos coinciden en el 48 %.
>
> Tres hechos que quedan probados y no hay que re-verificar:
> 1. **El `hitSlop.top` SÍ funciona en Android.** La afirmación contraria que vivía en el comentario de
>    `_layout.tsx` era falsa (se verificó el paquete de **web** y se generalizó a nativo sin medirlo).
> 2. **El ancestro NO recorta los toques**: el target dispara en `y=1276`, **86 px por encima** del
>    techo de la barra (`y=1362`). Corolario directo: **sacar el `top` no puede crear una zona
>    muerta** — el círculo entero (1324→1444) es alcanzable por sus propios bounds. O sea que la
>    premisa geométrica de esta entrada (*"los toques fuera de los límites del ancestro no se
>    entregan"*) **tampoco se sostiene acá**.
> 3. **La franja robada le pertenece al FAB haya o no haya pill**: cuando se corrió el barrido fino el
>    pill ya estaba oculto (tope de 120 s de R6.4 → estado `'off'`) y el FAB seguía disparando desde
>    1276.
>
> **Por qué en web nunca se vio**: `hitSlop` es **no-op** en react-native-web 0.21.2 (`Pressable` no lo
> implementa; la única aparición en el paquete está en el módulo legacy `Touchable`). **Ningún test de
> comportamiento en web puede cazar este bug** → el guard de la unidad es **geométrico y aritmético**,
> no de comportamiento (`app/src/utils/nav-target-bands.test.ts` +
> `app/src/utils/tap-target-collision-guard.test.ts` + `app/e2e/fab-target-geometry.spec.ts`).
>
> **Lo que se hizo**: se sacó el `top` del `hitSlop` (el `bottom` se queda: es el que gana área real y
> hace tocable el label "Maniobra") y el pill subió a **~20 dp** de aire.
> ⚠️ Corregido el 2026-08-06: este párrafo decía que el pill "pasó a ser tocable → `/baston`". **Se
> intentó y se REVIRTIÓ el mismo día**, con evidencia medida: el pill se superpone a CTAs a ancho
> completo de las pantallas de manga (en el A07 queda ENTERO adentro de 'Arrancar jornada') y les roba
> el toque. Hoy es informativo: sin `onPress`, con `pointerEvents="none"`, y lo congela el caso `(E)` de
> `tap-target-collision-guard.test.ts`. El acceso a `/baston` va por la fila "Bastón" del tab "Más".
> **El "fix real" que esta entrada dejaba pendiente (sacar el FAB del tabBar y montarlo como overlay
> absoluto) sigue SIN estar justificado, y ahora por un motivo distinto y verificado**: no hay zona
> muerta que arreglar (hecho 2).

**Origen**: análisis del navbar (variante B4). El leader lo dedujo de la geometría; el implementer lo confirmó y explicó por qué el fix aplicado NO alcanza.
**Qué**: el círculo del FAB se dibuja **fuera de su celda** del tab bar (26px con los tokens de B4; 34px antes) vía `marginTop` negativo. En React Native los toques fuera de los límites del ancestro **no se entregan**: en Android `ViewGroup.dispatchTouchEvent` solo desciende a hijos cuyos bounds contienen el punto, y en iOS `hitTest:` devuelve `nil` si `pointInside:` es false. El tabBar descarta el toque **antes** de llegar al FAB. → la porción que sobresale del CTA más importante de la app no responde al tap en nativo.
**Por qué nunca se detectó**: en web el DOM no clipea los toques igual, y la app se validó SIEMPRE en web hasta el bring-up nativo del 2026-07-16 (ver memoria `project_frontend_web_only_native_bringup`).
**Mitigación YA aplicada (parcial)**: `hitSlop` vertical en el Pressable. **NO recupera los 26px que sobresalen** — `hitSlop` agranda el target *dentro* del ancestro. Lo que sí gana: el target baja hasta el pie de la celda, el label "Maniobra" pasa a ser tocable (antes no lo era) y el área útil in-bounds crece de 64×38 a 64×58.
**Descartado**: agrandar el tabBar (`height += fabRaise` + `tabBarBackground`). Dejaría una franja transparente de **412×26 a ancho completo** que en nativo igual captura toques (`BottomTabBar` monta con `pointerEvents="auto"`) → cambiaría una zona muerta de 64×26 por una que rompe botones y scroll en el borde inferior de TODAS las pantallas. Peor negocio.
**Fix real (pendiente)**: sacar el FAB del tabBar y montarlo como **overlay absoluto en el layout raíz** con `pointerEvents="box-none"`. Es un refactor de navegación con su propia spec — toca ADR-018 y el shell de `(tabs)`.
**⚠️ VERIFICADO EN DEVICE — el diagnóstico NO se confirmó (2026-07-19)**: Raf probó el tap en el iPhone y reportó **OK**. O sea que la zona muerta predicha por la geometría **no se manifiesta** en el uso real, al menos con los tokens de B4 (26px de protrusión) + el `hitSlop` ya aplicado. Posibles explicaciones, ninguna verificada: (a) el modelo de `hitTest:`/`pointInside:` no aplica igual acá porque el `hitSlop` del Pressable sí extiende el área efectiva más de lo que asumimos; (b) con solo 26px sobresaliendo, el pulgar naturalmente cae en la parte in-bounds y la zona muerta es real pero inalcanzable en la práctica; (c) el diagnóstico geométrico estaba directamente mal.
  **→ [2026-08-06] Era la (a), y estaba escrita acá desde el primer día.** El `hitSlop` del Pressable extiende el área efectiva 26 dp sobre el círculo, en Android, medido. La (b) y la (c) quedan descartadas: la premisa de recorte por el ancestro tampoco aplica (hecho 2 del bloque de arriba). Lo que faltaba no era una hipótesis mejor: era **medir el techo táctil**, que se hace con un barrido de `input tap` en 3 minutos.
**Estado**: ~~BAJA prioridad. El refactor de navegación (overlay absoluto) **ya no está justificado por esto** — era un cambio caro (ADR-018 + shell de `(tabs)`) para un problema que no se reproduce. NO hacerlo salvo que aparezca evidencia nueva.~~ **[2026-08-06] RESUELTO** por la unidad «el FAB le roba los taps a la banda de arriba del nav». El refactor de navegación sigue sin justificarse (no hay zona muerta), pero ahora está **verificado** en vez de supuesto.
**Si reaparece**: ~~el síntoma sería "toco el FAB y no pasa nada" tocando cerca del borde superior.~~ **[2026-08-06] Esta línea era el error de método.** Los dos síntomas posibles son *"toco el FAB y no pasa nada"* (target de menos) **y** *"toco otra cosa y me lleva a Maniobra"* (target de más) — el que se dio fue el segundo, que esta línea no nombraba y por eso nadie fue a buscarlo. Hoy los dos los cubre un guard determinista (bandas aritméticas + medición geométrica en E2E), así que no hace falta acordarse del síntoma.

## 2026-07-18 — `delete_account` no borra `user_private` → la PII de contacto sobrevive al borrado de cuenta

**Origen**: Gate 1 (spec) del delta de teléfono. Hallazgo **fuera del alcance del delta**, verificado por el gate al auditar retención/supresión.
**Qué**: `supabase/functions/delete_account/index.ts` escribe solo `public.users` (soft-delete) y `user_roles`. **No toca `public.user_private`**, que es justamente la tabla donde vive la PII de contacto (email + teléfono) aislada por ADR-025 / spec 14. Tras "eliminar mi cuenta", el email y el teléfono del usuario siguen en la DB.
**Por qué importa**: medio-alto. Es el propósito entero de ADR-025 (aislar PII para poder gestionarla) el que queda a medias, y choca con el derecho de supresión de la **Ley 25.326** de protección de datos personales. No es un hueco de seguridad explotable por terceros (la RLS sigue siendo self-only), es un problema de retención/compliance.
**Próximo paso sugerido**: extender `delete_account` para borrar (o anonimizar) la fila de `user_private` del usuario. Toca Edge Function + PII → **Gate 1 puntual** + test en `supabase/tests/user_private`. Decidir borrado duro vs anonimización según si alguna feature necesita el histórico.

## 2026-07-18 — `user_private.email` sin CHECK de formato (asimetría con `phone`)

**Origen**: Gate 1 (spec) del delta de teléfono, anexo LOW.
**Qué**: tras el delta de teléfono, `user_private.phone` va a tener CHECK de formato autoritativo (`user_private_phone_format_chk`) mientras que `user_private.email` sigue solo con cap de longitud (`users_email_len_chk` ≤320, `0070`). Queda una asimetría: una columna de contacto validada y la otra no.
**Por qué importa**: bajo. El email viene de `auth.users` vía `handle_new_auth_user` / `propagate_confirmed_email`, o sea que Supabase Auth ya lo validó antes de llegar; el riesgo de un email malformado es acotado. Pero un write directo por PostgREST con `service_role` lo podría ensuciar, igual que pasaba con el teléfono.
**Próximo paso sugerido**: evaluar un CHECK de formato para `email` cuando se toque `user_private` por otra razón. **Ojo con el mismo hazard de DP3 del delta de teléfono**: Postgres re-evalúa TODOS los CHECK de la fila en cualquier UPDATE, así que un CHECK nuevo sobre datos legacy sucios rompería `propagate_confirmed_email`. Mismo patrón: normalizar primero, residuo cero, después `VALIDATE`.

## 2026-07-10 — Defensa server-side del gating de eventos reproductivos por ATRIBUTOS del animal

**Origen**: delta-fix B (gating tacto preñez vs aptitud, `docs/correcciones-demo-facundo-padre-2026-07-10.md`). El implementer + reviewer lo flaguearon.
**Qué**: el fix B corrige el gating **cliente** (qué tactos OFRECER por animal: preñez solo a servidas, aptitud solo a vaquillonas-no-aptas, ternera a ninguno). Pero el trigger de gating capa 2 `0054` **NO valida sexo/categoría/estado-reproductivo del animal** contra el evento reproductivo — gatea por rodeo/`data_key`, no por atributos. Un cliente autenticado podría insertar un `reproductive_events` (`event_type='tacto'`) sobre una ternera, o `tacto_vaquillona` sobre una vaca preñada, vía API directa.
**Por qué importa**: bajo. Requiere auth + rol en el propio tenant; el daño es calidad de dato auto-infligida en su propio establecimiento (no cross-tenant, no escala privilegios). Hueco pre-existente (ya lo tenían tacto/tacto_vaquillona/raspado por sexo), NO lo introdujo el delta.
**Próximo paso sugerido**: cuando se toque el gating server-side por otra razón, agregar validación de atributos (sexo/categoría/estado repro) en el trigger de `reproductive_events`. Toca DB → Gate 1 puntual + test. No urgente.

## 2026-07-10 — Reversión fiel de `dientes`/CUT al SALTEAR un animal en la maniobra

**Origen**: delta-feature C (botón skip, `docs/correcciones-demo-facundo-padre-2026-07-10.md`). El implementer lo flagueó; el reviewer lo evaluó ACEPTABLE como limitación documentada (no blocker).
**Qué**: al saltear un animal, el descarte soft-borra las **filas de evento** que ese frame escribió (por ids de cliente estables). PERO la maniobra `dientes` es un **UPDATE de propiedad** (`animal_profiles.teeth_state` + posible CUT), no una fila de evento → NO se revierte al saltear (el frame no transporta el estado previo para restaurarlo). Es la única maniobra de propiedad; el resto (eventos + custom) sí se descartan. La transición de categoría del tacto+ SÍ se revierte (trigger `0063`/`0046` recomputa al subir el soft-delete).
**Por qué importa**: bajo. Escenario raro (confirmar dientes y DESPUÉS saltear el mismo animal; el skip se usa dominantemente ANTES de cargar nada). Si `dientes` disparó CUT, exige confirmación explícita del operario (R6.8) → decisión deliberada que razonablemente persiste. La observación de dientes es un dato legítimo (el operario miró la boca).
**Próximo paso sugerido**: si algún día se quiere reversión fiel, transportar el `teeth_state`/`is_cut` previo en el frame de la maniobra para poder restaurarlo al saltear. Frontend + posible ajuste de la captura del estado previo. No urgente.

## 2026-07-09 — 2 e2e legacy rojos latentes en main (614 electrónica maxLength, 777 birthdate midpoint) ✅ RESUELTO (2026-07-10, commit `e70eea5`)

**RESOLUCIÓN (2026-07-10, `e70eea5`)**: ambos verdes. **614** → se eliminó el `maxLength={TAG_ELECTRONIC_LENGTH}` del input EID manual en `TagScanSheet.tsx`; `sanitizeTagInput` (strip + `slice(0,15)`) queda como único limitador → el test pasa sin tocarlo (bug UX real corregido). **777** → confirmado TEST STALE (la app es correcta): la aserción del test año-solo pasó de `toBe('2022-07-01')` a `toMatch(/^2022-/)` (año-scoped); el path DD/MM EXACTO sigue en `2022-07-01`; precisión cubierta por unit deterministas. Reconciliado as-built en RCF.2.1 y RAF2.1.3. `check.mjs` verde + 3 e2e afectados pasan. **NOTA**: esto NO cierra la Puerta 2 de esos deltas (#6 bastoneo-ficha, #3 alta-form), que siguen ⏸ pendientes por separado.

**Origen**: sesión 2026-07-09, corriendo la suite e2e COMPLETA como Gate 2.5 del delta `identificadores-unificados` (reviewer read-only). Primer full-run en un tiempo → destapó 2 rojos DETERMINISTAS que NO son del delta identificadores (blame + fechas lo confirman; el delta propio pasa 8/8 y sus 4 reconciliaciones legacy quedaron verdes).
**Qué**:
- `app/e2e/animals.spec.ts:~614` — delta **bastoneo-ficha/captura (#6/RCF.6)**, commits `c402a38d`+`9a1d193` (2026-07-06): el input manual del EID en `TagScanSheet.tsx` tiene `maxLength={TAG_ELECTRONIC_LENGTH}` (15) + `onChangeText → sanitizeTagInput` (strip no-dígitos + `slice(0,15)`). Con `fill('abc…+dígitos')` el browser trunca el RAW a 15 chars ANTES de que el sanitizer saque las letras → quedan <15 dígitos (12). El test espera 15. Bug de orden: el `maxLength` cuenta letras que después se descartan. Fix candidato: sacar el `maxLength` del input (que el sanitizer acote la longitud) o sanitizar en el value binding, no solo en `onChangeText`.
- `app/e2e/animals.spec.ts:~777` — **NO es bug de la app, es un TEST VIEJO** (diagnóstico corregido 2026-07-09). El test da de alta una Vaquillona year-only 2022 y espera el midpoint CIEGO `2022-07-01`. Pero el alta year-only ya no usa el midpoint ciego: el delta **imputación-consciente-de-categoría** (`ac709d2`, Nivel A) lo cambió a `imputeBirthDateForCategory` (`animal-category.ts`), que devuelve el midpoint del cruce [año ∩ ventana-etaria de la categoría]. Para una Vaquillona con el año 2022 entero válido, el midpoint de `[1-ene..31-dic]` de 365 días = día 182 = **2-jul** (coincide EXACTO con lo observado). **NO hay timezone** — `birthYearToDate`/`validateBirthDate` construyen la fecha como string puro. Test de `alta-form (#3, 8926e16)` que quedó viejo cuando shippeó `ac709d2` sin correr la suite completa. **Impacto real: cero** (`2022-07-02` es la fecha consciente correcta e intencional).
**Por qué importa**: medio. Son 2 features ya commiteadas a main con estos e2e rojos que nadie vio — se cerraron con verificación PARCIAL (unit/typecheck o subset e2e) sin correr la suite completa verde (`reference_crashed_agent_recovery`: unit verde no basta). Hueco de proceso + 2 bugs: 614 es UX real (tipear letras en el EID come dígitos); 777 puede ser test stale o tz real.
**Próximo paso sugerido**: 614 → bastoneo-ficha: fix de 1 línea (sacar el `maxLength` del input; el `sanitizeTagInput` ya corta a 15) + el test queda verde. Impacto real bajo (solo pegado de contenido mezclado). 777 → alta-form: **actualizar la expectativa del test** (la app imputa bien `2022-07-02`; NO hay bug de producto que arreglar). Ambos en SU delta, NO en identificadores. Regla reforzada: correr la suite e2e COMPLETA verde antes de cantar `done` en cualquier delta con UI (Gate 2.5, ADR-029) — este par se coló por no hacerlo.

## 2026-07-07 — Cota de longitud del array `p_calves` en `register_birth` (defense-in-depth)

**Origen**: Gate 1 + Gate 2 del delta `parto-caravana-visual-por-ternero` (VERIFY-002). Ambos gates lo marcaron LOW / no-HIGH, pre-existente (no lo introdujo el delta).
**Qué**: `register_birth` valida `jsonb_array_length(p_calves) >= 1` pero NO tiene cota superior. Un caller autenticado con rol en su tenant podría mandar un array enorme → N inserts (`animals`+`animal_profiles`+`birth_calves`) en una sola transacción.
**Por qué importa**: bajo. Requiere auth + rol en el propio establecimiento; el daño es a su propio tenant (no escala privilegios, no cross-tenant). Es availability/DoS auto-infligido. Un parto real tiene 1-2 crías (raro 3-4). No urgente.
**Próximo paso sugerido**: agregar `if v_count > <N> then raise using errcode='22023'` (ej. N=10, holgado sobre cualquier parición real) la próxima vez que se toque `register_birth` por otra razón — o ya, si se prioriza hardening. NO se metió en `0121` para mantener la migración = exactamente los 3 cambios revisados por los gates (scope discipline). Toca DB → Gate 1 puntual + test.

## 2026-07-01 — Auto-seed SEGURO del dato "apodo" para establecimientos FUTUROS (DP2 diferida del delta nombre-apodo)

**Origen**: delta NOMBRE/APODO de spec 02 (`specs/active/02-modelo-animal/{context,requirements,design,tasks}-nombre-apodo.md`, DP2). El delta seedea el `field_definition` "apodo" (per-est, `data_type='propiedad'`, `ui_component='text'`, deshabilitado) **solo para los establecimientos EXISTENTES** (backfill de `0119`). Un establecimiento creado DESPUÉS de la migración NO queda auto-seedeado → su owner crea el "apodo" on-demand con el `+` de `editar-plantilla` (poca fricción; MVP tiene 1 est beta).
**Qué**: auto-seedear el "apodo" per-est al crear un establecimiento nuevo, de forma **segura**. Se evaluó y **descartó** un trigger separado `AFTER INSERT ON establishments`: el INSERT a `field_definitions` dispara el guard `tg_field_definitions_custom_guard` (0093, before insert), que con `auth.uid()` no-null (onboarding autenticado) exige `is_owner_of(new.id)`; ese rol lo crea el otro trigger `on_establishment_created` (0011), y Postgres dispara los AFTER ROW triggers en **orden alfabético de nombre** → el trigger del apodo dependería de sortear después de `on_establishment_created`. Un mis-ordering **rompe el alta de establecimientos** (spec 01). Riesgo inmediato de onboarding por valor diferido (2º+ est) → no va.
**Forma segura sugerida**: **foldear el seed dentro de `handle_new_establishment` (0011)** vía `CREATE OR REPLACE`, insertando el fd "apodo" **después** del `INSERT` del rol owner en la MISMA función (secuencia explícita intra-función: el 2º statement ve el 1º → `is_owner_of` true, sin depender del orden de nombres de triggers). Idempotente (`on conflict ... do nothing` sobre el índice parcial `field_definitions_data_key_per_est` de 0093).
**Por qué importa**: bajo hoy (1 est beta, y el on-demand cubre el caso), medio cuando haya multi-est real — sin esto, la feature "apodo" queda silenciosamente sin pre-seedear para cada campo nuevo. Cero riesgo de la forma foldeada; el diferido es por prioridad + para no cruzar el baseline de spec 01 desde este delta.
**Próximo paso sugerido**: migración que hace `CREATE OR REPLACE handle_new_establishment` (0011) agregando el INSERT del "apodo" tras el rol owner. Toca DB → **Gate 1 puntual** + test backend (crear un est por el path autenticado → apodo fd per-est + creación exitosa + rol owner). Foldear cuando se priorice multi-est o al tocar `handle_new_establishment` por otra razón.

## 2026-06-29 — Higiene de test: la suite E2E re-renderiza design/**/*.png (byte diffs espurios)

**Origen**: correr `pnpm -C app e2e` (full) o `e2e:build` re-genera 40+ screenshots de `design/maniobra-*/`, `design/veto-sigsa-*/`, etc. con diffs de bytes no-deterministas (anti-aliasing/timing) → se cuelan en `git add -A`. Pasó 2× en la sesión 2026-06-29.
**Qué**: identificar qué test/paso del e2e (o del build) escribe en `design/` y **dejarlo de hacer** (los `design/*.png` son referencia de los vetos de diseño, no output de e2e). Candidatos: un test de captura/veto que apunta a `design/` en vez de a `test-results/` o a un dir efímero.
**Por qué importa**: bajo, pero recurrente — obliga a revertir `design/` a mano antes de cada commit post-e2e (workaround en memoria `reference_e2e_design_png_rerender`). Ensucia diffs y arriesga commits con ruido.
**Próximo paso sugerido**: `grep` en `app/e2e/` por escrituras a `../design/` / `design/`; redirigir esas capturas a `test-results/` (gitignored) o a un flag explícito. Test-infra, no producto.



## 2026-06-29 — Guard server-side: rechazar servicio/inseminación sobre macho (defensa en profundidad)

**Origen**: Gate 0 del delta de aptitud reproductiva (`specs/active/02-modelo-animal/context-aptitud-reproductiva.md`, decisión 5). El fix de #1b (inseminación solo a hembra apta) se hace **client-side** para el MVP (igual que todo el gating de maniobra hoy).
**Qué**: agregar una barrera **server-side** que rechace un `reproductive_events` de `event_type='service'` (o tacto/inseminación) sobre un animal `sex='male'`. Hoy `appliesToAnimal` filtra client-side, pero un INSERT directo por PostgREST/PowerSync (que saltea el cliente) podría crear un servicio sobre un macho.
**Por qué importa**: bajo-medio. Integridad del dato reproductivo (un servicio sobre un toro es basura semántica que ensucia denominadores). NO explotable cross-tenant (la RLS ya scopea por establecimiento); es defensa en profundidad, misma clase que el cap de `work_lot_label` (2026-06-14).
**Próximo paso sugerido**: trigger `BEFORE INSERT` sobre `reproductive_events` que valide `sex='female'` para los event_types reproductivos de hembra. Como toca DB → **Gate 1 puntual**. Foldear en el primer delta que toque triggers de `reproductive_events`. Mientras tanto, el fix client-side de #1b cubre el flujo normal de la app.

## 2026-06-29 — Peso de destete: cómo se captura (gatea %destete de reportes)

**Origen**: correcciones del testeo en vivo con Facundo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`, #7 y #10). Raf lo dejó pendiente de charlar con Facundo.
**Qué**: definir cómo se carga el **peso de destete** del ternero al destetar: ¿en una maniobra de destete dedicada? ¿peso manual o por balanza? ¿obligatorio u opcional? Hoy el destete es solo un evento `weaning` en `reproductive_events` **sin columna de peso**.
**Por qué importa**: medio-alto. Es el **numerador** del %destete (#10, segmento B de las correcciones) y parte del historial de la madre (#7). Sin definirlo no se puede aterrizar el delta de %destete ni guardar el peso de destete junto a cada cría en la ficha de la madre. **Bloquea el cierre del segmento A (cluster ternero) y la parte de destete del segmento B.**
**Próximo paso sugerido**: refinar con Facundo (cómo lo hacen en el campo) → Gate 0 del delta del cluster ternero (delta-spec sobre 02 + 07). Migración nueva `weaning_weight` en `reproductive_events` (o tabla de destete). Foldear en el delta-02 "cluster ternero".

## 2026-06-20 — Opción A de R13.30 (spec 03 M7): preservar el histórico de un dato custom borrado en la ficha

**Origen**: fix-loop del chunk M7 de spec 03 (gestión de datos custom). El reviewer + el e2e cazaron que R13.30 ("la ficha sigue mostrando el valor de un dato custom borrado") NO se honra end-to-end: la sync-stream `est_field_definitions_custom` (`sync-streams/rafaq.yaml` l.243) filtra `deleted_at IS NULL` → al soft-deletear, la definición se prunea del device → el INNER JOIN del display no resuelve el `label` → el valor histórico desaparece. **Raf eligió la Opción B (MVP)**: no se cambia la stream; el cliente lo asume y la confirmación de borrado ADVIERTE que las cargas previas dejarán de verse (R13.30/R13.31 reconciliados al as-built).
**Qué**: **Opción A** — quitar el `AND deleted_at IS NULL` de la sync-stream `est_field_definitions_custom` para que la fila soft-deleteada SIGA sincronizando (dentro del MISMO `org_scope` del tenant) → el JOIN del display resolvería el `label`/`config_schema` histórico, y la ficha volvería a mostrar el valor de un dato borrado (read-only). Los forms/listas NUEVAS ya filtran `deleted_at` por su cuenta (sin cambio). Implica además volver a separar el read de display (sin filtro `deleted_at`) del de los forms.
**Por qué importa**: medio. El histórico de cargas de un dato custom borrado es valioso para analytics/trazabilidad (uno de los 3 pilares de RAFAQ), pero NO bloquea el MVP — la advertencia de Opción B es honesta y el dato sigue en la DB (no se pierde, solo deja de verse desde la app).
**Próximo paso sugerido**: cambio de sync-rules + deploy a PowerSync (gateado por Raf) → **reabre la frontera WAL → Gate 1** (riesgo bajo: dato lógicamente-borrado del mismo campo/tenant). Foldear como chunk M8 o sub-chunk de M7-fast-follow. Detalle: `specs/active/03-modo-maniobras/design.md §13.5` + `requirements.md` nota R13.30.

## 2026-06-20 — Bug pre-existente: editar in-place el valor de una propiedad custom falla con UNIQUE constraint — ✅ RESUELTO (2026-06-29)

**✅ RESUELTO (2026-06-29, e2e-fixes)**: la suite E2E en vivo lo destapó (`maniobra-custom-render.spec.ts:195`, editar una propiedad custom creada en el alta → `UNIQUE constraint failed: ps_data__custom_attributes.id`). Causa raíz confirmada: `setCustomAttribute` decidía UPDATE-vs-INSERT por `rowsAffected`, **no confiable sobre la VIEW de PowerSync** (SQLite no cuenta los cambios de un INSTEAD OF trigger; wa-sqlite reporta 0 en un UPDATE de fila sincronizada aunque matchee) → caía a INSERT plano → colisión de la PK sintética. **Fix (frontend, sin DB)**: SELECT de existencia determinista (`buildCustomAttributeExistsQuery`) en vez de `rowsAffected`; preserva LWW. + test de regresión (`maneuver-reads.test.ts`) + e2e verde. Reconciliado en `specs/active/03-modo-maniobras/design.md` §R13.12. Gateado (reviewer + Gate 2). Se mantiene la entrada por trazabilidad.

**Origen**: regresión cazada durante el re-review/fix-loop del chunk M7 de spec 03. NO es de M7 (su diff a `custom-attributes.ts` es solo docstring, verificado por el leader) — es de **M5-C.3** (`setCustomAttribute`, `app/src/services/custom-attributes.ts:54`).
**Qué**: editar in-place un `custom_attribute` (current-value de una propiedad custom ya cargada, R13.12) falla **determinísticamente** con `UNIQUE constraint failed: ps_data__custom_attributes.id` (e2e `maniobra-custom-render.spec.ts:195`). Causa: PowerSync expone la tabla como VIEW → no se puede UPSERT → el patrón es UPDATE-luego-INSERT-si-0-filas con un `id` SINTÉTICO (`animal_profile_id || ':' || field_definition_id`); una carrera/LWW entre el overlay y la fila synced hace que el UPDATE afecte 0 filas y el INSERT siguiente colisione el id sintético ya existente. El DISPLAY de un valor live SÍ funciona; solo rompe la EDICIÓN.
**Por qué importa**: medio-alto. R13.12 promete "editable en cualquier momento"; hoy esa edición se rompe de forma reproducible. User-facing en el feature custom ya entregado (M5), no en M7.
**Próximo paso sugerido**: fix-loop chico aparte sobre `setCustomAttribute` (revisar la lógica UPDATE-luego-INSERT contra la VIEW + overlay; quizás chequear existencia en synced+overlay antes de decidir UPDATE vs INSERT, o idempotencia por el id sintético). NO toca M7. Confirmar primero con un test rojo aislado.

## 2026-06-14 — Tensión token `touchMin=56` vs piso EARS ≥60px para CTAs de manga (decisión de DS)

**Origen**: OBS-1 del reviewer en Gate-review de M2.2 (spec 03), `progress/review_03-m2.2.md`. APPROVED — no bloqueante.
**Qué**: R5.2/R12.2 de spec 03 declaran tap mínimo **≥60px** para pantallas de manga. Los CTAs full-width de la carga rápida (ej. "Confirmar", "Confirmar y siguiente") usan `minHeight=$touchMin=56px` (`tamagui.config.ts:110`), 4px bajo el piso EARS. Los bloques de decisión DOMINANTES (PREÑADA/VACÍA, tamaño, keypad) usan `flex:1` y exceden 60px (cumplen R12.5) — la tensión es solo en los CTAs full-width.
**Por qué importa**: bajo. `touchMin=56` es el target canónico del DS usado en TODA la app (ya pasó Gate 2 + puertas humanas); los CTAs full-width son trivialmente tappables por ancho. Es tensión **EARS(≥60) vs token canónico(56)**, no defecto. Misma clase que la tensión `$chipMin=40` vs ≥44/48 (entrada 2026-06-12).
**Próximo paso sugerido**: decisión de DS de Raf — (a) bumpear `$touchMin` a 60 (afecta TODA la app, pasada de design system, re-veto de pantallas) y/o crear un token `$touchManga≥60` solo para CTAs de pantallas 🔴; o (b) aceptar 56 como piso real y ajustar el EARS de spec 03 a ≥56. NO bloquea M2.2 ni el MVP. Resolver junto con `$chipMin`.

## 2026-06-14 — Cota server-side de longitud para `work_lot_label` y `maneuver_presets.name` (hallazgo para Gate 1 puntual)

**Origen**: Gate 2 (security_analyzer, code) del chunk M1 de spec 03, `progress/security_code_03-m1.md`. PASS 0 HIGH. 2 MEDIUM de defensa en profundidad (NO explotables HOY en M1).
**Qué**: las columnas `sessions.work_lot_label` (`0050_sessions.sql:18`) y `maneuver_presets.name` (`0051_maneuver_presets.sql:16`) son `text` SIN cap de longitud máxima server-side (CHECK). El jsonb `config` que contiene el preconfig de tanda (único input editable expuesto en M1) SÍ tiene cota autoritativa (`CHECK octet_length(config::text) < 16384` en `0050:30`), así que el único campo cableado de M1 está cubierto — pero `work_lot_label` y `name` no.
**Por qué importa**: hoy NINGÚN input de M1 escribe esas dos columnas (`setWorkLotLabel`/`createPreset` existen en los servicios pero sin call-site en la UI). El día que se cableen — **M5 ("guardar como rutina" = crear preset) y/o el input de "lote de trabajo"** — un write directo por PostgREST/PowerSync (que saltea cualquier `maxLength` del cliente) podría meter un texto gigante sin tope autoritativo (storage abuse). Es la misma clase que el cap del jsonb `config`, que sí está.
**Próximo paso sugerido**: migración nueva con `CHECK char_length(work_lot_label) <= N` y `CHECK char_length(name) <= N` (N a definir, ej. 80/120) **ANTES** de exponer esos inputs en la UI. Como toca DB, la DDL pasa por **Gate 1 puntual** (no Gate 2). Foldear en el chunk que cablee el primero de esos inputs (probablemente M5). Mientras tanto, NO es bloqueante de M1.

## 2026-06-13 — Findings MED/LOW del Gate 2 del chunk "BLE global" de spec 09 (no bloquean)

**Origen**: Gate 2 (security_analyzer, code) del chunk BLE global de spec 09, `progress/security_code_09resto-ble-global.md`. PASS 0 HIGH.
- **MED-1 (pre-existente de spec 15, NO del chunk)**: `runLocalQuery`/`runLocalWrite` (`app/src/services/powersync/local-query.ts:53-54,99`) surfacean el `err.message` CRUDO del SQLite LOCAL a la UI. Info disclosure menor (motor local, no cruza server/tenant). El overlay lo hereda al mostrar `res.error.message` del lookup/transfer. Fix: copy genérico en esa capa (afecta a todo el data layer, no solo al chunk). Foldear cuando se toque `local-query.ts`.
- **LOW-1**: el transfer desde el overlay no tiene rate-limit propio (= MED-2 de spec 11, ya aceptado por Raf: online-only, per-user, self-scoped, sin abuso a escala).
- **LOW-2 (defense-in-depth)**: la marca de E2E del bastón (`window.__RAFAQ_BLE_E2E__` → `mode='mock'` + `BleE2EBridge`) hoy está bien aislada de prod por triple guard (mode='auto' nunca devuelve 'mock'; el bridge re-chequea `kind==='mock'`). NO explotable. Hardening opcional: gatear la marca TAMBIÉN por `__DEV__`/`NODE_ENV !== 'production'`, por si un release accidental llevara la marca seteada. 1 línea en `app/app/_components/ble-e2e-flag.ts`.

## 2026-06-12 — Riesgo latente: cleanup de tests no pagina el select de animal_profiles (3 suites hermanas)

**Origen**: fix del leak de huérfanos en `supabase/tests/import/run.cjs` (~829K filas basura en `animals` desde 2026-06-06). La causa fue que el `cleanup()` recuperaba los `animal_id` a borrar con un `select(...).in('establishment_id', ests)` SIN paginar, y PostgREST topa la respuesta a 1000 filas → con el test de borde de 5000 perfiles quedaban ~4000 `animals` huérfanos por corrida (`animals` NO tiene `establishment_id`, no cascadea del establishment). Arreglado SOLO en `import/run.cjs` con un helper `collectAllAnimalIds(ests)` (keyset por la PK `id`, páginas de 1000). Delta de huérfanos verificado = 0 contra el remoto.

**Qué (riesgo latente)**: el MISMO patrón sin paginar vive en otras suites:
- `supabase/tests/animal/run.cjs` (~216-219)
- `supabase/tests/maneuvers/run.cjs` (~289-290)
- `supabase/tests/operaciones_rodeo/run.cjs` (~230)

(`supabase/tests/sync_streams/run.cjs` NO tiene el riesgo: borra `animals` desde `createdAnimalIds` trackeado en proceso, no desde el select; el select de perfiles ahí solo saca `id` para `reproductive_events`.)

**Por qué importa**: HOY no leakean porque cada una crea <1000 animales por corrida (bien por debajo del cap de PostgREST). Si alguna sube su volumen de fixtures por encima de 1000 en una corrida, vuelve a aparecer el leak de huérfanos en el remoto compartido.

**Por qué NO se arregló acá (scope)**: el helper `collectAllAnimalIds` devuelve solo la lista de `animal_id` deduplicada. Las 3 suites hermanas necesitan ADEMÁS el `id` del perfil (para borrar `reproductive_events` por `animal_profile_id`/`calf_id`) del MISMO select, y cada una tiene una forma de retorno distinta (operaciones_rodeo mergea `createdAnimalIds`, sync_streams solo necesita `id`). Reutilizar el helper tal cual no es drop-in; generalizarlo a `{profileIds, animalIds}` y aplicarlo en 3 archivos heterogéneos es un cambio grande y riesgoso en test-infra que el fix acotado no pedía tocar. Se deja como riesgo latente documentado.

**Próximo paso sugerido**: cuando se toque cualquiera de esas suites (o si se sube su volumen de fixtures), extraer un helper compartido `selectAllPaged(table, cols, {column, values})` con keyset por `id` y reemplazar los selects sin paginar de las 3 (+ idealmente mover `collectAllAnimalIds` de import a ese helper común). Test-infra, no producción.

## 2026-06-12 — Anti-patrón "re-fetch que parpadea" en 3 pantallas (auditoría, receta en conventions.md) — RESUELTO

**Estado**: ✅ RESUELTO (impl_refetch-fixes, 2026-06-12). Las 3 instancias corregidas con la receta de
`docs/conventions.md` § "UI — actualización optimista en el lugar", plantilla `animal/[id].tsx`. Pendiente
reviewer + Gate 2.

**Origen**: Raf lo pegó en la ficha del animal (toggle Castrado/⭐ blankeaba + scrolleaba arriba). Pidió auditar el resto + dejar la receta. **Receta documentada en `docs/conventions.md` § "UI — actualización optimista en el lugar"**. La ficha (`animal/[id].tsx`) se está arreglando ya. Las otras 3 instancias encontradas (a corregir con la receta, en orden de prioridad):
- ✅ **ALTA — `app/app/lotes.tsx`** (`load()` línea ~82, render ~218): crear/renombrar/borrar lote → `await load()` → `setLoading(true)` → render muestra "Cargando lotes…" en vez de la lista montada → blank + scroll-reset. Las 3 acciones son cotidianas del owner. Fix: mutar el array `groups` optimista (insertar/renombrar/quitar el item) sin `setLoading(true)`, estilo `mas.tsx`/`applyOwnProfile`. **HECHO**: `groups: ManagementGroup[] | null` (blank solo en carga inicial `groups===null`); crear inserta el `{id,name}` que devuelve el service; renombrar patchea el name en sitio (RenameForm pasa el name validado al padre); borrar quita el item con snapshot + revert-si-falla; cada acción reconcilia con `load({silent:true})`. E2E `lotes.spec.ts`: "Cargando lotes…" no reaparece tras crear/renombrar.
- ✅ **MEDIA — `app/src/hooks/useGroupView.ts` + `GroupViewBits.tsx`** (consumido por `rodeo/[id]`/`lote/[id]`): al volver de una acción masiva, el `useFocusEffect` corre `load()` con `setLoading(true)` incondicional → la lista + barra + conteo blanquean y re-montan. Fix: no setear `loading=true` cuando `animals.length>0` (refresh en el lugar). **HECHO**: `load({silent})` + `didInitialLoadRef` (1ra carga blanquea; re-focus + sync posteriores silenciosos), igual que `animal/[id].tsx`. `GroupViewBits.tsx` no se tocó (el `loading=false` del refresh silencioso ya evita el placeholder). E2E `operaciones-castracion.spec.ts`: al volver de la masiva, "Cargando animales…" no aparece.
- ✅ **BAJA — `app/app/seleccion-masiva.tsx`** (`onRevertOverrides` → `load()` línea ~255): revertir override desde el sheet blankea la lista de selección. Poco frecuente. Mismo fix (revertir optimista sin recargar todo). **HECHO**: tras revertir, se limpia `category_override=false` en sitio sobre `candidates` + `selectionState.sections` (helper PURO `clearOverridesInSelection`, testeado) → el `overrideCount` baja solo y el aviso desaparece; la SELECCIÓN del usuario se preserva; sin re-fetch.

**Referencias OK** (ya lo hacen bien, no tocar): `mas.tsx` (ProfileSection optimista), `index.tsx` (loaders que no blanquean), `animales.tsx` (loading solo en header), `miembros.tsx`/`rodeos.tsx` (guard `loading && data===null`). **Norte de fondo**: migrar las lecturas de campo a `useQuery`/`watch` de PowerSync (backlog 2026-06-09) borra el re-fetch manual entero.

## 2026-06-12 — a11y: el checkbox de `AnimalRow` compacto no emite `aria-checked` (selección masiva)

**Origen**: chunk UI-D de spec 10 (E2E Playwright), `progress/impl_10-ui-d-e2e.md` (autorrevisión).
**Qué**: la fila compacta de `AnimalRow` (selección masiva castrar/destetar) pasa `accessibilityState={{checked}}`
crudo al `Pressable`. react-native-web NO lo traduce a `aria-checked` en el DOM del export de prod (el
`role="checkbox"` y el `aria-label` SÍ aparecen; `aria-checked` queda ausente). Verificado en los E2E de UI-D
(por eso verifican los defaults por el CONTADOR vivo, no por `aria-checked`).
**Por qué importa**: gap de a11y de lectores de pantalla — no anuncian tildado/destildado de la fila. NO es un
bug funcional (la selección opera bien; el contador/CTA/resaltado ⭐ son correctos). Mismo patrón que el bug que
motivó `src/utils/a11y.ts` (RN-web no mapea estado a11y crudo a ARIA en algunos elementos).
**Próximo paso sugerido**: pasada de a11y de `AnimalRow` — emitir el estado vía un helper tipo `switchA11y`
(que ya produce `aria-checked` correcto en web) en `RowCheckbox`/`AnimalRow`. Nada (info) hasta que se priorice
un chunk de pulido de a11y. NO es test-only-fixeable (toca el componente de producto).

## 2026-06-12 — 3 LOW del Gate 2 del UI-C (ficha castrado + borrado de eventos) de spec 10

**Origen**: Gate 2 del chunk UI-C, `progress/security_code_10-ui-c.md`. PASS 0 HIGH.
- **L1 (hardening, no explotable)**: el lookup de `DELETABLE_EVENT_TABLE` (en `deleteTypedEvent`/`local-reads.ts`) es un objeto plano → `kind='constructor'` heredaría de `Object.prototype` y daría truthy → SQL basura LOCAL (no explotable: el `kind` viene de un literal del SQL del timeline, no de input de usuario). Hardening sugerido: `Object.hasOwn(map, kind)` o `Map`. Defensivo.
- **L2 (pre-existente, fuera del diff)**: la policy RLS UPDATE de `sanitary_events`/`reproductive_events` no tiene restricción column-level → un owner|autor por curl directo podría tocar otras columnas además de `deleted_at`. Mismo-tenant, pre-existente de spec 02. Hardening futuro (column-level o RPC de soft-delete).
- **Comentario impreciso**: `events.ts` menciona "rollback del overlay" en el path CRUD plano (no aplica) — cosmético, corregir al tocar.

## 2026-06-12 — LOWs del UI-B2 (vacunación) de spec 10 + decisión de design token

**Origen**: Gate 2 + re-Gate 2 (fix VIA) del chunk UI-B2, `progress/security_code_10-ui-b2*.md`. PASS tras cerrar el HIGH VIA-ENUM-MISMATCH (el campo Vía pasó a chips del enum). LOWs/decisión:
- **DECISIÓN DE DISEÑO (Raf)**: el token `$chipMin` = **40px**, reusado por TODOS los filtros/chips de la app. El estándar mobile es ≥44px (iOS)/48dp (Android). Bumpearlo es un cambio de design token **app-wide** (confirm-gated). Por ahora se dejó en 40 (consistencia; los chips no son el CTA primario). Si se quiere subir a 44/48, es una pasada de design system, no de esta feature.
- **LOW**: el anti-drift de `sanitary-route.ts` ancla los 5 valores del enum por COPIA + test-oráculo (no parsea la migración 0027). Si el enum cambia, el test lo caza, pero podría parsear la migración para robustez total. Defensivo, no urgente.
- **LOW**: fixtures de tests de plomería (no-de-dominio) todavía usan `'subcutánea'` como string libre — cosmético, no afecta producto.
- **UX (no MVP-blocker)**: el "Producto" de vacunación es texto libre — tipear con guante en la manga es fricción. A futuro: autocomplete / productos recientes. (El cap server ≤160 ya está.)

## 2026-06-12 — Gate 2 del UI-B de spec 10 (selección masiva): 1 MED comentario + LOWs

**Origen**: Gate 2 (security_analyzer, code) del chunk UI-B, `progress/security_code_10-ui-b.md`. PASS 0 HIGH.
- **MED-1 (comentario engañoso, NO vuln)**: `app/app/seleccion-masiva.tsx:143/148` dicen que el fail-open del gating de destete (R7.2) lo respalda "la barrera server-side" — **falso para el GATING**: `0054_gating_db_layer.sql:21` excluye destete del enforcement (decisión de spec US-8). La RLS (autorización) sí está; el gating de destete es display-only y el server ACEPTA un destete en rodeo con `destete` deshabilitado. Mismo-tenant + decisión deliberada → no es hueco, pero el comentario puede hacer que un dev futuro confíe en una barrera inexistente. **Fix: corregir el comentario** (1 línea) — o decisión de producto si se quiere enforcement real del gating de destete server-side. Foldear en el próximo toque de ese archivo (UI-C).
- **LOW**: sin cap DURO al N total del fan-out de la masiva (el batching ~100 es del encolado, no un tope; mismo-tenant = N ops individuales). LOW: `onRevertOverrides` ignora errores por animal. LOW: `IN(...)` con miles de placeholders roza el límite de SQLite (grupos enormes). Evaluar en hardening.

## 2026-06-11 — 2 MED del Gate 2 del frontend Fase 2+3 de spec 10 (castración no-atómica)

**Origen**: Gate 2 (security_analyzer, code mode) de la base no-UI de spec 10, `progress/security_code_10-frontend-fase2-3.md`. PASS 0 HIGH. 2 MEDIUM (no bloquean — la no-atomicidad es decisión aceptada de R10.2/Gate 1):
- **MED-1 (gap de auditoría)**: la castración son **2 CrudEntries independientes** (UPDATE `animal_profiles.is_castrated` + INSERT observación "Castrado"). Si la 2da falla al subir, el animal queda castrado SIN la observación de auditoría (o viceversa). Aceptado por R10.2 (mutaciones independientes, sin rollback). Mitigación futura: detector server-side que reconcilie castrados sin observación, o un job que genere la observación faltante. No MVP.
- **MED-2 (correctness de reporte)**: `drainBulkPlan` puede reportar un animal como "rechazado" cuando su UPDATE de castración YA quedó encolado (la observación falló) → el operario ve "rechazado" para algo que se aplicó parcialmente. Cosmético/UX, no pérdida de dato. Al implementar la UI de progreso (Fase 4 T-UI.9), afinar el reporte para distinguir "aplicado sin observación" de "rechazado".
**Próximo paso sugerido**: evaluar al pulir la pantalla de progreso de la masiva (Fase 4) + posible detector server-side en una pasada de hardening. Nada urgente.

## 2026-06-11 — 3 LOW del Gate 1 puntual de spec 10 (LIM-2, no bloqueantes)

**Origen**: Gate 1 puntual (security_analyzer, spec mode) del delta LIM-2 de spec 10, `progress/security_spec_10-lim2-rechequeo.md`. PASS 0 HIGH/0 MED. 3 LOW para el momento de implementar/Gate 2:
- **L1** — race READ COMMITTED: si un rodeo se desactiva entre el scan del UPDATE de propagación y el BEFORE `rodeo_check` de esa fila, la cadena puede abortar igual (fail-closed, comportamiento viejo ya auditado, visible vía R10.3). Dirección fail-safe. Sin acción.
- **L2** — `v_skipped` del `RAISE LOG` puede contar perfiles soft-deleted del animal (ni el UPDATE ni el count filtran `ap.deleted_at`, coherente con 0079(3)). Exactitud cosmética del log; opcional anotar "incluye soft-deleted" al implementar T-DB.2.
- **L3** — perfiles soft-deleted con rodeo vivo SÍ se actualizan (pre-existente, idéntico a 0079). Defendible. Sin acción.
Verificar L2 al redactar la migración real (Gate 2 sobre T-DB.2 reproduce el predicado literal de 0021).

## 2026-06-11 — 2 LOW del Gate 2 del fix ProfileContext first-sync (no bloqueantes)

**Origen**: Gate 2 (security_analyzer, code mode) del fix de e2e rojos (Run e2e-rojos-fix), `progress/security_code_e2e-rojos-fix.md`.
**Qué**: (1) **Optimista pegado en multi-device** — el gate de reconciliación de `ProfileContext.tsx` (`pendingOptimisticNameRef`, ~líneas 118-122) que evita revertir el saludo recién editado también bloquea, durante esa ventana, un update de `phone` que venga por sync-down de OTRO device; `refresh()` no lo fuerza. Es staleness de data del PROPIO usuario (no leak), ya reconocido por el implementer. (2) **Ventana pre-existente** de `namePhone` in-flight en un switch de usuario sin null intermedio — teórica y ANTERIOR al diff (no la introduce este cambio).
**Por qué importa**: bajo — ninguno cruza frontera de usuario/tenant; es data propia con staleness acotada. El gate los clasificó LOW, no bloqueantes.
**Próximo paso sugerido**: ambos desaparecen con la migración del data layer a `useQuery`/`watch` (entrada 2026-06-09) — el watch reactivo re-renderiza ante cualquier cambio del SQLite local sin la maquinaria de re-eval manual ni el ref optimista. No tocar ahora; foldear en esa migración.

## 2026-06-11 — `created_by` spoofeable en eventos por INSERT directo a PostgREST (MED, pre-existente)

**Origen**: Gate 2 (security_analyzer, code mode) del fix del flake de estado repro (Run backlog-flake-repro).
Finding MEDIUM **fuera del diff** (pre-existente), anotado por recomendación del gate.
**Qué**: `tg_set_created_by_auth_uid()` (`supabase/migrations/0024…:8-10`) rellena `created_by` SOLO si viene
NULL → un cliente que pega directo a PostgREST (saltando la app) puede setear `created_by` a OTRO usuario.
De paso, como la policy UPDATE de `reproductive_events` (`0026:69`) habilita por `created_by = auth.uid()`,
atribuir el evento a otro usuario le daría a ese usuario derechos de UPDATE sobre la fila. Mismo patrón
aplica a las otras tablas de evento que usan ese trigger condicional.
**Por qué importa**: medio — es mismo-tenant (la policy INSERT exige `has_role_in` del establecimiento del
animal, no cruza frontera de tenant ni escala fuera del campo), pero ensucia la auditoría de autoría y
puede regalar permisos de edición. El trail regulatorio (ADR-017, `animal_category_history.changed_at`)
sigue sellado server-side, intacto.
**Próximo paso sugerido**: en una pasada de hardening, forzar `created_by` INCONDICIONAL estilo el
`establishment_id` de `0077:68` (`NEW.created_by := auth.uid()` siempre, SECURITY DEFINER) en el trigger
de las tablas de evento. No-breaking para la app (que nunca manda `created_by`). Nada urgente.

## 2026-06-11 — 2 LOW del Gate 2 de C6 (clase baseline, no bloqueantes)

Del reporte `progress/security_code_02-c6-categoria-espejo.md`: (1) `err.message` crudo de SQLite
local puede llegar a la card del revert vía `kind:'unknown'` — patrón baseline de `local-query.ts`,
no cruza trust boundary; unificar copy cuando se toque esa capa. (2) stale-auth en replay del revert
offline — clase ya aceptada en spec 15 (el server falla cerrado al subir). Sin acción inmediata.

## 2026-06-11 — `deriveCurrentState` desempata por UUID random los eventos repro del mismo día sin `created_at` (flake offline) ✅ RESUELTO

**✅ RESUELTO (2026-06-11, Run backlog-flake-repro)**: DOS cambios complementarios (frontend puro, sin schema/RLS/migraciones). (1) Los INSERT CRUD-plano de `reproductive_events` (tacto/service/abortion) ahora setean `created_at` de CLIENTE (`new Date().toISOString()`) → TODOS los determinantes repro (incluido el parto del overlay, que ya lo traía) tienen un instante REAL de creación. Server-side `created_at` es `default now()` SIN trigger de force (0026) → el valor de cliente persiste, y es semánticamente mejor (instante de CREACIÓN, no de subida) para un evento offline. (2) Se reemplazó el desempate por `eventId` (UUID v4 random) por un `seq` = orden de lectura de `buildTimelineQuery` (que ahora ordena `event_date ASC, created_at IS NULL ASC, created_at ASC` en un SELECT externo que envuelve el UNION; antes `DESC`, cosmético) → `fetchTimeline` asigna `seq`; `isNewerRepro`/`parseTimeline` lo usan como desempate estable. Con (1) el caso realista es "ambos created_at presentes" → el insertado DESPUÉS gana, DETERMINÍSTICO. **Diagnóstico clave (vía DIAG en e2e)**: el approach read-only puro NO alcanzaba — el parto del overlay tenía created_at de cliente mientras el tacto CRUD-plano quedaba NULL hasta sincronizar, y ni "null=más reciente" ni "presente gana" eran universalmente correctos; el created_at de cliente en (1) elimina la ambigüedad. Tests unit nuevos + guard de ORDER BY + 2 tests de comportamiento node:sqlite. e2e `events.spec.ts` (parto/aborto/parto-mellizos): verde y DETERMINÍSTICO con `--repeat-each=5` (10/10 parto-mellizos, 15/15 los otros 3). Detalle en `progress/impl_backlog-flake-repro.md`. Se mantiene la entrada por trazabilidad.

**Origen**: chunk C6 (espejo de categoría), re-verificando los e2e de events. El espejo de CATEGORÍA (badge) ya quedó robusto al caso offline (desempate por índice de array, RC6.1.4); el espejo de ESTADO REPRODUCTIVO (`deriveCurrentState` en `app/src/utils/event-timeline.ts`, la fila "Estado reproductivo: Preñada/Vacía") NO.
**Qué**: cuando dos eventos repro determinantes de preñez (tacto/birth/abortion) caen el MISMO `event_date` y ambos tienen `created_at = null` (caso REALISTA: se cargan offline por CRUD plano y el trigger sella el `created_at` recién al subir), `isNewerRepro` cae al desempate por `eventId` — que es un UUID v4 RANDOM → ~50/50 cuál "gana". Efecto: tras un PARTO o un ABORTO cargado offline el mismo día que el tacto previo, la fila "Estado reproductivo" muestra "Preñada" en vez de "Vacía" la mitad de las veces. El BADGE de categoría YA quedó correcto con C6 (deriva por índice de array); solo la fila de estado reproductivo arrastra el bug.
**Evidencia**: `events.spec.ts` tests "parto en hembra PREÑADA → Vacía" (rojo crónico en HEAD) y "aborto → Vacía" (verde/rojo intermitente según el UUID). Con C6 el badge de esos tests transiciona bien ("Vaca segundo servicio" / la categoría correcta); falla SOLO el `getByText(/^Vacía · /)`.
**Por qué importa**: es la misma clase de bug que C6 resolvió para categorías, en un módulo vecino; deja 1-2 e2e crónicamente flaky (la suite es el oráculo de regresión) y, en campo, muestra "Preñada" a una vaca que acaba de parir/abortar offline hasta el sync.
**Fix sugerido**: en `isNewerRepro` (event-timeline.ts), cuando `event_date` empata y `created_at` falta/empata en ambos, desempatar por la POSICIÓN en el timeline ya ordenado (`parseTimeline` ordena por día desc + createdAt desc) en vez de por `eventId` — espejo del fix de índice de array del espejo de categoría (RC6.1.4). O, de fondo: que las escrituras locales de evento (events.ts) seteen un `created_at` de cliente provisional. Fuera de scope de C6 (otro módulo, otra superficie).
**Próximo paso sugerido**: run chico (otro modelo) sobre `event-timeline.ts` + sus tests unit + re-verificar los 2 e2e. Relacionado con el triage de los 8 e2e rojos de abajo (los de events que NO eran el gap del badge).

## 2026-06-10 — 8 e2e rojos PRE-EXISTENTES en HEAD (account/events×3/profile×3/rodeos) — triage pendiente

**Origen**: run T7.9 de feature 15. El implementer los reportó como pre-existentes; el reviewer lo
CONFIRMÓ con worktree limpio sobre HEAD `55d5700` (8 failed / 12 passed, fallos de ASERCIÓN, no de
red — evidencia en `progress/review_15-powersync.md` § "Review — Run T7.9").
**Qué**: `account.spec.ts` (1), `events.spec.ts` (3), `profile.spec.ts` (3), `rodeos.spec.ts` (1)
fallan en HEAD. Al menos los de events incluyen el badge "vaquillona preñada" = el gap de transición
de categoría server-side (entrada 2026-06-10 arriba, DECIDIDO → chunk C6 de spec 02). El resto sin
diagnóstico individual; sospecha: flakiness sobre la DB beta contaminada y/o timing.
**Por qué importa**: la suite e2e es el oráculo de regresión del repo (regla: testear con Playwright,
no a mano) — con 8 rojos crónicos el verde deja de significar algo y los gates pierden señal.
**Próximo paso sugerido**: triage spec por spec tras cerrar feature 15: (a) los que cierra C6 →
verificar al implementar C6; (b) los de flakiness/data → arreglar asserts o aislar data; (c) si
alguno es bug real de producto → feature/fix con su propio ciclo.

## 2026-06-10 — Transiciones de categoría NO visibles offline (recálculo es server-side) ✅ DECIDIDO (2026-06-10)

**✅ Alcance decidido por Raf (2026-06-10)**: opción A — **espejo client-side display-only** de
`compute_category` (port a TS puro, solo vista, server sigue siendo la verdad) **+ badge de
override en la ficha + acción quitar fijación** (el caso "1212" NO era offline: tenía
`category_override=true` y el server no transiciona ni online, R4.9). Gate 0 escrito y aprobado:
`specs/active/02-modelo-animal/context-c6-categoria-espejo.md` (chunk C6 de spec 02, frontend
puro). Arranca al cerrar la feature 15 (WIP=1). Entrada original abajo para contexto:

**Origen**: testing en vivo de Raf post-fix del alta offline (sesión bugfix 15-powersync). Lo golpeó DOS
veces en el mismo día: (1) tactos+/servicios sobre "1212" (ahí además había override=true), (2) servicio
sobre una ternera año-2025 sin override — la categoría no cambia hasta reconectar.
**Qué**: `compute_category` corre como trigger server-side en el INSERT del evento (Tier 2, 0062/0063/0046);
offline el evento queda guardado local + encolado, pero la categoría visible es la vieja hasta que el ciclo
reconectar→subir evento→recalc→sync-down del perfil completa. Diseño vigente y correcto (LWW, estado
derivado server-side), pero la expectativa de campo es "la puse en servicio → la veo vaquillona AHORA".
**Por qué importa**: UX de manga — el operario carga eventos en el corral sin señal y no ve el efecto; puede
dudar de si "se guardó bien" (misma clase de desconfianza que el bug recién cerrado, aunque acá no se pierde
nada). Pilar "mejor en el primer try".
**Próximo paso sugerido**: evaluar un recálculo ESPEJO client-side (port de compute_category a TS puro,
aplicado solo a la VISTA local/overlay — el server sigue siendo la verdad y pisa al sincronizar; LWW lo hace
seguro) o, mínimo, un hint de UI ("categoría se actualiza al sincronizar") en la ficha cuando hay eventos
pendientes. Decidir alcance con Raf antes de especificar; relacionado con la migración a useQuery/watch
(entrada 2026-06-09).

## 2026-06-10 — 🐛 BUG: animal creado OFFLINE desaparece de la lista al navegar de tab ✅ RESUELTO (2 causas raíz)

**✅ CERRADO (2026-06-10, Run create-animal-rpc)**: la 2da causa (pérdida real en el upload, detalle abajo)
se cerró con la **RPC atómica `create_animal` (migración 0083, APLICADA al remoto)** — una sola transacción
server-side (sin half-state posible), idempotente por ids de cliente (`ON CONFLICT (id) DO NOTHING` solo-PK),
guards anti-IDOR (patrón 0081), y **healing**: un `animals` huérfano del camino viejo deja de bloquear (el
replay completa el perfil). Cliente: `upload.ts` mapea `create_animal` → RPC traduciendo el shape histórico
de los intents ya encolados; `connector.ts` elimina la rama de 2 upserts. Gates: Gate 1 PASS 0 HIGH +
reviewer APPROVED + Gate 2 PASS 0 HIGH. Verificación: suite backend "All tests passed" post-apply (7 tests
nuevos: happy/replay/**healing del half-state = el caso del bug**/cross-tenant/idv-dup/tag-dup/anti-IDOR) +
E2E con **oráculo de persistencia server-side nuevo** (`waitForServerAnimalProfile`) 2/2 verdes — y prueba
A/B en vivo del reviewer: contra el build viejo el oráculo cazó la cadena exacta (403→42501→"upload
rechazado"); con el build nuevo, verde. **Residuo NO auto-sanable**: los animales "12"/"211" de Raf
perdieron su intent (descartado) → irrecuperables; sus filas huérfanas en `animals` (sin perfil, invisibles)
quedan para la limpieza de la DB beta (entrada 2026-06-08). Re-crear los animales a mano.

**(2da causa, cerrada — pérdida real en el upload)** (diagnóstico original, 2026-06-10 — Raf re-reprodujo con IDV "211", multípara, mismo campo): el fix del
buscador stale era REAL pero parcial. La 2da causa raíz, confirmada por el leader con los logs de la API de
Supabase + estado de la DB remota: **el upsert de `create_animal` en `uploadData` NO es idempotente bajo RLS
y PIERDE el dato en el reintento**. Cadena: (1) `applyIntentTransaction` aplica el alta como 2 upserts HTTP
NO atómicos (`animals` → `animal_profiles`); (2) si el drenado se interrumpe ENTRE ambos (toggle de red al
testear, tab cerrada, fetch caído → transient → re-throw y reintento), queda `animals` insertado SIN perfil
(huérfano, invisible por RLS); (3) el REINTENTO del upsert de `animals` pega el **conflicto de PK → rama
`ON CONFLICT DO UPDATE` → la policy UPDATE de `animals` exige `EXISTS animal_profiles visible` → el perfil
no existe → 42501/403**; (4) `classifyIntentUploadError('42501')` = `permanent_reject` → `rollbackOverlay`
borra el overlay + descarta el intent → **el animal desaparece de la UI y NUNCA llega al server**; (5) los
eventos post-create encolados (condición corporal de la multípara) fallan después con FK 23503 → 409 y
también se descartan. Evidencia: logs API de la sesión real de Raf muestran `POST /rest/v1/animals → 403` +
`POST /rest/v1/condition_score_events → 409` SIN ningún POST de `animal_profiles` (la tx aborta antes); el
campo `037ac0a5…` tiene CERO `animal_profiles` server-side (ni "12" ni "211" llegaron jamás); quedan filas
huérfanas en `animals`. Los datos de "12"/"211" son IRRECUPERABLES (idv/categoría vivían en el perfil que
nunca llegó; el overlay fue borrado). **Por qué ningún test lo cazó**: los E2E offline nunca dejan correr el
upload; los E2E online asertan la UI (que muestra el OVERLAY) y no verifican persistencia server-side →
ninguna alta vía app aterriza en el server desde el swap a outbox (72b3239) sin que la suite lo note. El fix
DEBE incluir un oráculo de persistencia server-side post-alta online. Fix candidato: RPC `create_animal`
atómica server-side (patrón 0081 `create_rodeo`) o upserts `ignoreDuplicates` (ON CONFLICT DO NOTHING, sin
rama UPDATE) — decisión con Raf en curso. Lo de abajo documenta la 1ra causa (buscador stale), que SIGUE
arreglada.

**(1ra causa, cerrada — buscador stale)** (2026-06-10, Run bugfix-overlay-list de 15-powersync): causa raíz = **estado de UI stale del BUSCADOR**, NO pérdida de datos. El overlay local está SANO: el repro E2E instrumentado (export prod Y dev server Metro, `context.setOffline(true)` + dump del SQLite local + captura de consola) probó que el animal queda en `pending_animal_profiles`, que `buildAnimalsListQuery` lo devuelve, y que el upload offline clasifica **transient** en 10+ ciclos de retry (`TypeError: Failed to fetch`, `code:''` → cero `[powersync] upload rechazado`, cero rollback) — hipótesis 1/2/3/4 de abajo DESCARTADAS con evidencia. El defecto real: `animales.tsx` re-corría la LISTA al re-enfocar la tab pero NO la BÚSQUEDA activa → con un término en el buscador (el find-or-create de la manga: tipear el número → no-match → "Dar de alta este animal"), cada vuelta a la tab (p.ej. Más → Animales) mostraba el no-match VIEJO "No encontramos «N»" = "el animal ya no está". Fix: `runSearch` extraído a callback + re-corrido en `useFocusEffect` y en el efecto de `lastSyncedAt` (simétrico a `loadList`). E2E nuevos (`app/e2e/animals-offline.spec.ts`, primeros tests offline reales de la suite): repro literal de este backlog (verde ya en baseline — queda de red de regresión del overlay) + alta vía buscador no-match (ROJO en baseline → VERDE con el fix, verificado por stash en el mismo harness). Detalle en `progress/impl_15-powersync.md` (Run bugfix-overlay-list). Se mantiene el registro por trazabilidad.

**Origen**: validación en vivo de Raf (web, dev server `pnpm web`, código de hoy con commits 72b3239/05a7321/8ffbc80). Repro determinístico.
**Repro**: campo "nombre de campo de prueba" (`037ac0a5-aaea-4ede-8894-451540c8f3bd`; 2 rodeos: "Cria hembras" `845df40d`, "adsads" `36f40b6b`; 0 animales server-side). Network→Offline → crear animal con IDV "12" → ir a la tab "Más" → volver a "Animales" → **el animal "12" YA NO ESTÁ en la lista**.
**Naturaleza**: el animal es OFFLINE-ONLY → vive solo en el overlay local (`pending_animals`/`pending_animal_profiles` del SQLite de PowerSync en el browser); NO llega al servidor → NO se ve con `execute_sql`. Es un bug de **LECTURA/CONTEXTO LOCAL**, NO de pérdida de dato server-side. Campo2 (animales sincronizados) muestra OK → el fix de first-sync (05a7321) anda; ESTO es distinto.
**Hipótesis (a investigar, en orden)**:
1. **Filtro de RODEO activo de la tab Animales** (`app/app/(tabs)/animales.tsx` → `fetchAnimals(est, { rodeoId })`): el animal se crea en el rodeo activo al alta; al VOLVER, si el rodeo activo/filtro re-resuelve a OTRO de los 2 rodeos del campo (`RodeoContext`), la lista (scopeada a ese rodeo) no contiene el overlay → "desaparece". Ver `RodeoContext` + el default del filtro de la tab + estabilidad del rodeo activo entre navegaciones (el `useFocusEffect` re-corre `loadList`).
2. **INNER JOIN del overlay** en `buildAnimalsListQuery` (`local-reads.ts`, `LOCAL_LIST_SELECT_OVERLAY`): la rama overlay hace `JOIN rodeos` (tabla SINCRONIZADA) + `JOIN categories_by_system`. Si el rodeo del alta NO está en la tabla synced `rodeos` del local (p.ej. rodeo creado offline → vive en `pending_rodeos`, no en `rodeos`; o lag de sync de ese rodeo), el INNER JOIN descarta el animal → invisible. Verificar si el rodeo usado para el alta está synced en el local.
3. **establishment_id/rodeo_id del overlay** ≠ el contexto activo al volver (contexto de campo/rodeo stale entre crear y volver).
4. El `writeTransaction` de `enqueueCreateAnimal` (`outbox.ts`) no persiste, o un `clearOverlay`/`rollbackOverlay` espurio se dispara offline.
**Verificación preferida (NO testear a mano)**: test E2E (la suite ya es PowerSync-aware) con 1 campo + 2 rodeos: crear animal vía wizard → navegar a otra tab y volver → assertir que SIGUE en la lista. `context.setOffline(true)` para el caso offline puro.
**Archivos**: `app/app/(tabs)/animales.tsx`, `app/src/contexts/RodeoContext.tsx`, `app/src/contexts/EstablishmentContext.tsx`, `app/src/services/powersync/local-reads.ts` (`buildAnimalsListQuery` rama overlay), `app/src/services/powersync/outbox.ts` (`enqueueCreateAnimal`), `app/src/services/animals.ts` (`createAnimal`), `app/app/crear-animal.tsx`.
**Próximo paso**: una sesión nueva (otro modelo) lo diagnostica + arregla. Relacionado con el gap de reactividad del overlay descrito abajo (un write puro del overlay no re-renderiza sin re-foco — pero acá SÍ hay re-foco por la navegación, así que apuntá primero al filtro de rodeo / JOIN del overlay).

## 2026-06-10 — Surfacing en UI de los rechazos PERMANENTES de upload (hoy solo console.warn)

**Origen**: Run create-animal-rpc (15-powersync), al cerrar la cadena del bug de pérdida del alta.
**Qué**: cuando `uploadData` clasifica un rechazo como `permanent_reject` (42501, 23505 de tag/idv duplicado, FK 23503, intent corrupto), hace rollback del overlay + descarta el intent + `console.warn('[powersync] upload rechazado (descartado)')` — y NADA visible para el usuario: el animal/parto/baja simplemente desaparece de la UI sin explicación. R10.2 pide "registro observable" y R8.1 "superficiar el rechazo de forma legible"; el console.warn cumple lo primero pero no lo segundo. Con la RPC 0083 el caso espurio (el bug) ya no existe, pero los rechazos LEGÍTIMOS (caravana/IDV duplicada cargada offline, rol perdido `active_lost`) siguen siendo silenciosos — el operario cree que cargó el animal y lo pierde sin aviso.
**Por qué importa**: pérdida de dato PERCIBIDA como bug (aunque sea un rechazo legítimo). En la manga nadie mira la consola. Rompe "el mejor en el primer try".
**Próximo paso sugerido**: run chico de UX — canal de status ya existente (`status.ts` / `pending ops`): acumular los rechazos en una tablita local (o en memoria + badge en el header de sync) con copy es-AR accionable ("No pudimos guardar el animal 211: caravana duplicada"). Decisión de producto sobre dónde mostrarlo (toast al reconectar vs. bandeja de "pendientes con error"). NO implementado en este run (fuera de alcance).

## 2026-06-10 — ProfileContext queda en "Sin conexión: no pudimos actualizar tu perfil" si la carga corre antes del first-sync (y la tab Más lo muestra) ✅ RESUELTO (2026-06-11, Run e2e-rojos-fix)

**✅ CERRADO (2026-06-11, Run e2e-rojos-fix)**: era un bug FUNCIONAL determinístico (no solo cosmético): bloqueaba "Editar perfil" / "Cambiar email" en el arranque hasta un retry manual (triage `progress/triage_e2e_rojos.md` lo demostró con 4 e2e rojos deterministas: account:151 + profile:54/75/110, todos en `gotoTab('Más')`). Fix en `app/src/contexts/ProfileContext.tsx`: efecto reactivo que re-lee el perfil cuando AVANZA `lastSyncedAt` (vía `useStatus()` de `@powersync/react`, patrón canónico de `animales.tsx:192`/`index.tsx:415`) → al completar el first-sync se limpia el `error` espurio y carga el perfil; "Más" rendea la sección Perfil. Caso offline-puro intacto (sin sync nunca → `lastSyncedMs===0`, el efecto no dispara, fallback de saludo sigue, sin loop). Al destrabar el ancla `:54`, el e2e profile:38 reveló un SEGUNDO síntoma del mismo gap de reactividad: el saludo de la home no se actualizaba tras editar el nombre porque `saveProfile` es ONLINE-direct a `public.users` pero la lectura viene del SQLite local (lag de sync-down) → se cerró con aterrizaje OPTIMISTA (`applyOwnProfile`: el saludo refleja el valor recién guardado al instante; el sync-down reconcilia; un marcador `pendingOptimisticNameRef` evita que un sync-down de otras tablas revierta el saludo con el valor viejo). Verificación: profile.spec.ts + account.spec.ts 18/18 verde con `--repeat-each=3` (era 4 rojos det.). NO se tocaron los tests (sus asserts eran correctos). Detalle en `progress/impl_e2e-rojos-fix.md`. Entrada original abajo por trazabilidad:

**Origen**: Run bugfix-overlay-list (15-powersync), hallazgo lateral del repro E2E offline (el ancla "Editar perfil" de la tab Más no aparecía).
**Qué**: `ProfileContext` carga name/phone UNA vez al resolver `userId` (`useEffect [userId]`) — típicamente ANTES del first-sync de PowerSync → `runLocalQuerySingle` degrada "vacío + !hasSynced" a `kind:'network'` → `error` queda seteado y NO se re-evalúa solo (no escucha `statusChanged` ni re-corre al avanzar `lastSyncedAt`). En la tab "Más", la sección Perfil muestra el alert "Sin conexión: no pudimos actualizar tu perfil." + "Reintentar" y NO renderiza "Editar perfil" hasta que el usuario re-enfoca/reintenta (hay un `useFocusEffect` con `refresh()` que lo suele salvar al entrar a Más, pero la ventana existe y offline-post-sync el copy es engañoso). Misma clase que el fix T11 (consumir la degradación R5.4 re-evaluando en la transición first-sync), no aplicada a este contexto.
**Por qué importa**: cosmético/UX (el saludo cae al fallback y Más muestra un error transitorio falso) — no pierde datos. Rompe el "mejor en el primer try" si Raf lo ve en el arranque.
**Próximo paso sugerido**: run chico — en `ProfileContext`, retry en la transición first-sync false→true (mismo patrón `lastHasSynced` de `EstablishmentContext`) o `waitForUsableSync()` antes de la primera carga. Alternativa de fondo: la migración a `useQuery`/`watch` (entrada 2026-06-09) lo borra gratis.

## 2026-06-09 — Reactividad de lecturas PowerSync: migrar a `useQuery`/`watch` (follow-up del fix showstopper)

**Origen**: fix del showstopper de 15-powersync (la app aterrizaba en onboarding / listas vacías porque el gate y las lecturas resolvían el SQLite local one-shot ANTES del first-sync y no re-evaluaban).
**Qué**: el fix cerró el caso CRÍTICO (first-sync) con re-query reactivo acotado: (a) `EstablishmentContext`/`RodeoContext` se suscriben a `statusChanged` y re-resuelven SOLO en la transición first-sync false→true; (b) `animales.tsx` + el stepper del Inicio re-corren su carga cuando avanza `lastSyncedAt` (`useStatus()`). NO se migró el data layer (`services/*` → `runLocalQuery`) a hooks `useQuery`/`watch` del SDK — sería un refactor grande que tocaría la integración con el overlay/outbox (`pending_*` + UNION en las queries). Queda como follow-up: cuando se estabilice el overlay, evaluar mover las lecturas del camino de campo (lista/ficha/timeline/lotes/conteos) a `useQuery` watchable, que re-renderiza automáticamente ante cualquier cambio del SQLite local (first-sync, downloads incrementales, y escrituras del overlay) sin re-query manual por `lastSyncedAt`/`statusChanged`.
**Por qué importa**: el patrón actual cubre el first-sync y los downloads (avance de `lastSyncedAt`), PERO NO re-renderiza ante cambios PUROS del overlay local-only (un write optimista que no avanza `lastSyncedAt`) ni ante sync incremental de filas nuevas post-first-sync sin un re-foco/refresh manual. `useQuery`/`watch` lo haría gratis y borraría toda la maquinaria de re-query manual.
**Residuales conocidos que esto cerraría — ✅ LOS 3 CERRADOS (2026-06-09, run residuales-offline)**: `animals.spec.ts:52` (stepper post-alta), `animals.spec.ts:500` (badge "Vendido el {fecha}") y `establishments.spec.ts:29` (crear campo) ya pasan. Fixes: #1 `createEstablishment` genera el `id` en el cliente (sin read-back local que dependía del sync) + aterrizaje OPTIMISTA en `EstablishmentContext` (`applyCreatedEstablishment`, merge-until-confirmed); #2 `exit_date` de cliente en el overlay `pending_status_overrides` + `COALESCE` en `buildAnimalDetailQuery`; #3 ya cubierto por el `useFocusEffect`+`lastSyncedMs` del fix T11 (el count UNIONa el overlay y se refresca al re-enfocar — verificado determinístico corrido solo). Detalle en `progress/impl_15-powersync.md` (Run residuales-offline). La migración a `useQuery`/`watch` sigue como follow-up (borraría la maquinaria de re-query manual), pero ya NO es necesaria para estos 3.
**Próximo paso sugerido**: spec/ADR de migración del data layer de campo a `useQuery` watchable (post-estabilización del overlay) — opcional, ya no bloquea ningún residual. El camino CRÍTICO (home con datos, lista poblada, crear campo, baja con fecha, stepper) anda.

## 2026-06-09 — Primitiva de snackbar/toast reusable (confirmación post-acción)

**Origen**: cierre T9.9, decisión UX de "Guardar plantilla" (Raf). Recomendé "volver atrás + confirmación breve"; no existe primitiva de toast/snackbar en el repo, así que se shippeó `router.back()` silencioso (consistente con `editar-campo`).
**Qué**: agregar una primitiva de snackbar/toast reusable al design system (`@/components`) + un context/hook para dispararla desde cualquier flujo. Copy offline-aware ("Guardada — se sincroniza al reconectar").
**Por qué importa**: pulido ("mejor en el primer try" — Nielsen #1 visibilidad). Hoy la confirmación de guardado en flujos que vuelven atrás (editar-plantilla, editar-campo, etc.) depende del indicador global de sync, no de feedback local por-acción. App-wide, no solo plantilla.
**Próximo paso sugerido**: primitiva en el DS + wire en los flujos save-and-leave (editar-plantilla, editar-campo, crear-lote, edición de perfil). No bloqueante; el back silencioso es funcional y consistente.

## 2026-06-09 — Cap defensivo de `p_toggles` en `create_rodeo`/`set_rodeo_config` (LOW, Gate 1 T9.8/T9.9)

**Origen**: Gate 1 (security_analyzer, code mode) de `set_rodeo_config` (0082, Run T9.9). Misma observación aplica a `create_rodeo` (0081, T9.8) — el gemelo ya está en el remoto.
**Qué**: ambas RPC reciben `p_toggles jsonb` (array de `{field_definition_id, enabled}`) sin tope de cardinalidad server-side. Cada `field_definition_id` está FK-bound (23503 si no existe) y la PK compuesta `(rodeo_id, field_definition_id)` colapsa duplicados en UPSERTs sobre la misma fila → un array gigante no crece la tabla, solo cuesta CPU de la tx del **propio owner** (self-DoS acotado, sin amplificación ni cross-tenant).
**Por qué importa**: bajo — el gate lo clasificó **LOW, no bloqueante** y aprobó aplicar 0082 tal cual (consistente con 0081-live, ya gateado LOW). No es hueco de seguridad; es hardening defensivo uniforme.
**Próximo paso sugerido**: en una pasada de hardening, agregar `if jsonb_array_length(p_toggles) > 64 then raise ... using errcode = '22023'` al inicio del loop de toggles **en ambas** (0081 nueva migration que recrea `create_rodeo` + en `set_rodeo_config`), para mantener simetría. 64 es holgado para un catálogo de ~30-50 fields. Nada urgente.

## 2026-06-07 — Polish de C4 lotes (no bloqueantes, post puerta de código)

**Origen**: cierre de C4 lotes (frontend `management_groups`). Veto de diseño del leader + Gate 2 + feedback de Raf.
**Qué** (3 ítems chicos):
- **Error-copy crudo** (MEDIUM-1 de Gate 2): `createManagementGroup`/`renameManagementGroup` en `app/src/services/management-groups.ts` propagan `error.message` de PostgREST en la rama `kind:'unknown'`. Es la MISMA deuda transversal de la entrada 2026-06-01 "Mapear errores crudos del backend a copy genérico" — sumar estos 2 call-sites a esa pasada. No empeora nada (camino frío, errores esperables pre-gateados).
- **Member-count en la card colapsada de `/lotes`**: hoy hay que abrir el acordeón para ver cuántos animales tiene un lote. Un "N animales" en la fila colapsada ayudaría (Nielsen #1 visibilidad). Roza la vista de grupo de spec 10 — evaluar si va acá o se difiere a 10.
- **"Eliminar lote" siempre visible por card** (rojo) en `/lotes`: con muchos lotes repite la acción destructiva en cada card. Ya tiene confirmación destructiva; con pocos lotes (beta) es aceptable. Evaluar mover a overflow/menú si escala.
**Por qué importa**: pulido ("mejor en el primer try"); ninguno es MVP-blocker ni hueco de seguridad.
**Próximo paso sugerido**: foldear el error-copy en la pasada transversal de errores; el member-count decidirlo al implementar spec 10 (comparten la vista de grupo).
**Nota cerrada**: el "Crear lote nuevo" del combo de la ficha quedó como CTA centrada con divisor + "+" a la izq; el centrado no es perfecto pero Raf lo aceptó (no se reabre).

## 2026-06-07 — `exit_weight`/`exit_price` sin `CHECK > 0` a nivel DB (MED-01, Gate 2 C3.3)

**Origen**: sesión actual, Gate 2 (security_analyzer modo code) de C3.3 baja de animal — finding MEDIUM.
**Qué**: las columnas `animal_profiles.exit_weight` / `exit_price` (`0020`/`0044`) tienen como único backstop server el tipo `numeric` — no hay `CHECK (exit_weight > 0)` ni rango de precio a nivel DB. El cliente (`validateExitWeight`/`validateExitPrice`) ya valida `>0` y topes, pero un valor negativo/absurdo pegado directo al RPC `exit_animal_profile` (saltando la UI) se persistiría.
**Por qué importa**: bajo — no cruza frontera de seguridad (es dato de analytics del **propio** tenant, no leak ni escalación). Solo ensucia los reportes de venta del dueño. No se tocó backend en C3.3.
**Próximo paso sugerido**: en una pasada de hardening del modelo de animal, agregar `CHECK (exit_weight > 0)` + rango de `exit_price` en una migration nueva (junto con otras deudas de CHECK de dominio si las hay). Nada urgente.

## 2026-06-07 — `rodeos.spec.ts` e2e roja por el OnboardingImportOffer de feature 12 ✅ RESUELTO

**Resuelto** (2026-06-07, terminal feature 12): el helper `completeCrearRodeo` (`app/e2e/helpers/rodeos.ts`) ahora descarta la oferta de onboarding tocando "Más tarde, ir al inicio" (de forma tolerante para el alta no-bloqueante). Corrida real: 3/3 verdes. No se tocó la app (la oferta es intencional). Se mantiene el registro por trazabilidad.

**Nota (2026-06-11, Run e2e-rojos-fix)**: NO confundir con un flake DISTINTO de `rodeos.spec.ts:138` que apareció después y se cerró en este run. Causa raíz distinta: `createRodeo` pasó a ser OFFLINE-FIRST vía outbox (spec 15, T9.8) → la RPC server-side corre async al drenar la outbox; el test leía el remoto UNA vez tras `waitForHome` y race-eaba con el upload (flake 2/3, `rodeos.length` recibía 0). Fix TEST-only en `app/e2e/rodeos.spec.ts`: `expect.poll` por la persistencia server-side del rodeo (patrón `waitForServerAnimalProfile`). El producto está bien (offline-first es el diseño correcto); el test no debe asumir persistencia síncrona. 3/3 verde con `--repeat-each=3`. La oferta del OnboardingImportOffer NO estuvo involucrada (el helper ya la descarta).

**Origen**: sesión actual, mientras se implementaba C3.3 (baja de animal). El implementer lo detectó como hallazgo fuera de alcance; el leader lo confirmó por `git diff` (C3.3 NO toca `rodeos.spec.ts` ni `crear-rodeo.tsx` → el rojo es ajeno y pre-existente al chunk).
**Qué**: `crear-rodeo.tsx:221` muestra el `OnboardingImportOffer` (CTA "Importar rodeo", feature 12, commit `4e1b6d5`) tras crear el **primer** rodeo, con `router.replace('/import-rodeo')` / `router.replace('/(tabs)')`. La suite `app/e2e/rodeos.spec.ts` (BUG 1) crea un rodeo y espera aterrizar directo en home → la oferta de onboarding intercepta y el assert falla. 2 tests rojos. El `check.mjs` NO corre los Playwright e2e (corre las suites node de backend), por eso quedó verde igual y el rojo no se vio en el pipeline.
**Por qué importa**: feature 12 está `in_progress` esperando la **puerta de código humana de Raf**; este es un test desactualizado de SU frente, no un bug del flujo real (el onboarding nuevo es intencional). Conviene cerrarlo en el mismo paquete que la puerta de feature 12 para que la suite e2e quede 100% verde antes de marcarla `done`.
**Próximo paso sugerido**: actualizar `rodeos.spec.ts` para descartar el `OnboardingImportOffer` (tap en "Saltar/Continuar") antes de assertear la home — o verificar la oferta como parte del flujo esperado. Pertenece a feature 12 (otro frente), NO a C3.3. Nada más en este chunk.

## 2026-06-06 — Rate-limit de frecuencia de importación masiva (control diferido, feature 12)

**Origen**: sesión 23, Gate 1 (security) de feature 12 — finding MEDIUM-4.
**Qué**: los topes de la spec 12 (R3: 5 MB / 5000 filas / largo por campo) acotan **una** corrida de import, pero NO la **frecuencia** (un usuario autenticado podría disparar muchas corridas seguidas = DoW por reintentos). No hay rate-limit de import-por-usuario/establecimiento.
**Por qué importa**: bajo en MVP (es op de oficina, no endpoint público; mismo-tenant; la escala ya es posible vía alta unitaria), pero a escala de "decenas de miles de usuarios" un rate-limit de corridas conviene.
**Próximo paso sugerido**: evaluar si el abuso real lo amerita; si sí, rate-limit por (usuario, establecimiento) sobre `import_log` (ya registra cada corrida con `created_at` + `imported_by`) — contar corridas en ventana y bloquear. Anclado a R3.7 de la spec 12. Nada (info) hasta ver abuso.

## 2026-06-04 — ⏰ Keep-alive ping para evitar la pausa por inactividad de Supabase free (HACER PRONTO)

**Origen**: sesión 22, charla de infra al decidir las transiciones por edad (Raf preguntó cómo evitar la pausa).
**Qué**: un proyecto Supabase **free** se **pausa tras 7 días sin requests externos** (los datos quedan; se despausa con un click, pero la app no anda mientras tanto). El `pg_cron` interno **NO** cuenta como actividad. Solución: un **request externo programado** cada 2-3 días que le pegue a un endpoint del proyecto y resetee el timer.
**Por qué importa**: durante dev + beta temprano, evita que el proyecto se pause de la nada (testing de Raf/Facundo). NO reemplaza los backups (eso es Pro, US$25/mes, cuando haya datos de cliente que no se pueden perder).
**Próximo paso sugerido (concreto, listo para ejecutar)**:
- **GitHub Actions** (recomendado): `.github/workflows/keepalive.yml` con `on: schedule: - cron: '0 6 */2 * *'` (cada 2 días) que hace `curl -s "$SUPABASE_URL/rest/v1/<tabla_chica>?select=id&limit=1" -H "apikey: $SUPABASE_ANON_KEY"`. La **anon key** ya es pública (viaja en la app) → no expone secreto; igual conviene meterla como secret del repo. El request cuenta como actividad aunque RLS devuelva 0 filas.
- Alternativa cero-código: `cron-job.org` / UptimeRobot pegándole a la misma URL.
- El leader puede armar el workflow cuando Raf lo pida (es de ~5 líneas). **Marcado "hacer hoy más tarde" por Raf (2026-06-04).**

## 2026-05-28 — Pesaje de ternero: peso al pie vs peso al destete

**Origen**: sesión 15, refinamiento de contexto (Gate 0) de spec 03 MODO MANIOBRAS.
**Qué**: en MVP, pesaje de ternero = pesaje adulto + autocompleta categoría ternero/ternera (vínculo con la madre ya viene de `reproductive_events.calf_id`). Falta modelar peso al pie (lactancia) vs peso al destete como pesajes tipados distintos.
**Por qué importa**: son métricas productivas distintas para analítica de cría; pero la distinción no está validada con Facundo y modelarla a ciegas arriesga rehacer schema.
**Próximo paso sugerido**: refinar con Facundo post-MVP; si se confirma, agregar tipo/contexto al pesaje (posible data_key o columna de contexto en `weight_events`) vía migration, sin reabrir spec 03.

## 2026-05-29 — Estrategia de testing en device real (dev-build) — gap de Expo Go para SDK 56

**Origen**: sesión 17, intento de correr la app en el teléfono de Raf.
**Qué**: el proyecto está en Expo SDK 56 (salió 21-may-2026). Expo Go para SDK 56 **no está en App Store ni Play Store** (sin fecha) → la Expo Go de tienda (SDK 54) no carga el proyecto. Para device real hay 3 opciones: (a) sideload del APK Expo Go SDK 56 en **Android** (vía Expo CLI / expo.dev/go); (b) **iOS** vía TestFlight beta o `eas go` (necesita cuenta Apple Developer US$99/año); (c) **dev-build propio** (expo-dev-client + EAS build o build local) — el camino "correcto" para una app real, no Expo Go.
**Por qué importa**: el veredicto de "primer try" en hardware real (manga, sol, guante) es clave para RAFAQ, y el peón usa Android probablemente. Pero NO bloquea iterar diseño (eso va por web ahora).
**Próximo paso sugerido**: cuando importe device real, decidir entre dev-build (recomendado para app seria, alineado con ADR-013/EAS) vs sideload Android. Por ahora: **web** (`pnpm.cmd web`) para diseño. Sub-decisión latente: ¿quedarse en SDK 56 bleeding-edge o alinear a un SDK con Expo Go en tiendas? (rework si se baja).

## 2026-05-29 — Rollup de resumen por establecimiento (stats de la card "Mis campos")

**Origen**: sesión 17, diseño de la card `EstablishmentCard` (R6.6.2 de spec 01).
**Qué**: la card de cada campo muestra contadores (animales, rodeos) + métrica hero (% preñez último tacto, etc.). Calcularlos en vivo para N campos en el landing es costoso y poco offline-friendly.
**Por qué importa**: con pocos campos beta se computa en vivo sin problema; cuando un vet tenga 15-20 campos, N agregaciones en el landing = lento + mal offline.
**Próximo paso sugerido**: cuando escale, agregar un agregado cacheado por establecimiento (vista materializada o tabla de resumen), refrescado al cerrar una maniobra. No MVP.

## 2026-05-29 — Vista mapa de "Mis campos" (post-MVP)

**Origen**: sesión 17, diseño de "Mis campos".
**Qué**: los `establishments` ya tienen lat/long en el schema → vista mapa de los campos del usuario como alternativa a la lista.
**Por qué importa**: un vet que cubre una zona geográfica vería sus clientes en el mapa (UX potente para multi-campo). El dato ya existe.
**Próximo paso sugerido**: toggle lista/mapa en "Mis campos", post-MVP.

## 2026-05-29 — Benchmarking en la card de "Mis campos" (prender post-beta)

**Origen**: sesión 17, diseño de `EstablishmentCard`.
**Qué**: el slot de comparación ("% preñez 92% · +5 vs zona ▲") ya queda en el layout de la card (R6.6.2) pero VACÍO en MVP — requiere baseline (suficientes campos / datos de zona) que no existe con 1-3 campos beta.
**Por qué importa**: benchmarking es pilar de producto; para el vet con muchos campos, ver cada cliente vs promedio de zona es killer. Pero prometerlo sin datos sería humo.
**Próximo paso sugerido**: encender la comparación cuando haya baseline (post-beta). Posible vista derivada: "ranking de mis campos por % preñez vs zona" para el vet.

## 2026-05-29 — `entry_origin` como enum (analytics)

**Origen**: sesión 17, refi de edge cases de spec 02.
**Qué**: hoy `animal_profiles.entry_origin` es texto libre (ternero al pie usa `'born_here'` hardcodeado). Para analytics de "origen de ingreso" (compra vs nacido vs otro) conviene un enum consistente.
**Por qué importa**: analytics es pilar del producto; texto libre = estadísticas sucias. No bloquea MVP (cría-only, origen mayormente 'born_here' o compra).
**Próximo paso sugerido**: convertir a enum vía migration cuando se aborde el módulo de analytics/reportes (spec 07). NO tocar ahora. (Nota: `exit_reason` SÍ pasa a enum ya, por la decisión de baja/egreso de la misma refi — eso va en el delta backend de spec 02.)

## 2026-05-29 — Pantalla "Mis campos" + landing por rol (selección de establecimiento) — ✅ RESUELTO (misma sesión 17)

**Resolución (2026-05-29)**: Raf decidió la regla → landing por **cantidad de campos** (no por rol): ≥2 campos activos → pantalla "Mis campos" (selector, landing de vets y multi-campo); ==1 → home directa + "Mis campos" accesible vía switch del header. Folded en **spec 01** como `R6.6`–`R6.9` + flujo en `design.md`. No se creó ADR nuevo (es comportamiento de producto/navegación acoplado a la multi-tenancy de spec 01; realiza la mitigación que ADR-018 ya había anotado sobre el switch en el header). Memoria `project-mis-campos-landing` actualizada a "decidido". Se implementa en B.1 (frontend de spec 01).

**Origen**: sesión 17, design review de la home (Stitch). Al decidir reemplazar el menú hamburguesa por un switch de establecimiento en el header, Raf detectó que **nunca diseñamos ni pensamos la pantalla ANTERIOR a la home**: la que lista los establecimientos del usuario antes de entrar a uno.
**Qué**: definir (1) la pantalla **"Mis campos"** (listado de establecimientos donde el usuario tiene rol activo, multi-tenant de spec 01) y (2) **cuál es el landing por rol**:
- **Owner / dueño**: hipótesis = entrar directo a la home del **último campo abierto** (`last_establishment_opened`), con el switch en el header para ir a "Mis campos" manualmente. (Pocos campos, contexto estable.)
- **Veterinario**: hipótesis = el landing principal podría ser **"Mis campos"** directamente, porque probablemente tenga +10 campos para revisar. Pregunta abierta: ¿o también conviene abrirle el `last_establishment_opened` y que navegue al listado vía el switch?
**Por qué importa**: es un hueco de flujo de navegación de nivel app, no un detalle de UI. Afecta a spec 01 (multi-tenant / contexto activo) y al shell de navegación (ADR-018, que ya contempló "promover el switch de establecimiento al header de Inicio" como mitigación). Decidirlo mal obliga a rehacer el arranque de la app. Toca persistir `last_establishment_opened` por usuario.
**Próximo paso sugerido**: refinar en sesión dedicada (probable Gate 0 de contexto). Candidato a ajuste/extensión de spec 01 o nota en su design.md + posible actualización del shell de ADR-018. NO bloquea el design de la home actual: por ahora solo se implementa el **switch entre campos en el header** (reemplaza el hamburguesa); el switch además sirve de feedback de "en qué campo estás parado".

## 2026-05-30 — Stats reales de `EstablishmentCard` (hoy MOCK) + `last_establishment_opened` — backend

**Origen**: sesión 20, build del componente `EstablishmentCard` + preview "Mis campos" (frontend, spec 01 R6.6.2). La card ya está construida y vetada (ver `progress/impl_mis-campos-card.md`), pero alimentada con **mock data**.
**Qué**: la card consume hoy props con datos inventados. Necesitan venir del backend:
- **contadores**: `animalCount` (animales activos por establecimiento) + `rodeoCount` (rodeos por establecimiento).
- **métrica hero adaptativa**: `% de preñez` del último tacto (con período `mmm'aa`) · o `cabezas` + fecha de la última maniobra · o estado "vacío" (sin animales) → CTA. El cliente decide cuál mostrar según qué datos haya.
- **señal de atención** (ej. "tacto pendiente"): deriva de reglas de negocio del campo (tacto vencido, datos sin sincronizar).
- **`last_establishment_opened`** (R6.9, ya **requerido** en la spec): persistencia por usuario del último campo abierto + rastro de últimos visitados (alimenta orden de "Mis campos" R6.6.1, dropdown del switch R6.8.1, landing R6.7). El frontend del incremento 2 lo necesita.
**Por qué importa**: sin estas queries/rollup la card es una maqueta; con ellas es la pantalla de triage del vet multi-campo (pilar producto). Computar N campos en vivo en el landing no escala (ver entrada 2026-05-29 "Rollup de resumen por establecimiento" — misma raíz; este ítem es el corte concreto que la card destrabó).
**Próximo paso sugerido**: sub-tarea de la **terminal/backend** (otra terminal maneja supabase/). Definir la fuente de cada stat (query directa con pocos campos beta / rollup cacheado al escalar) + el almacenamiento de `last_establishment_opened` (columna por usuario o tabla de visitas). Frontend incremento 2 cablea la card a esos datos reemplazando los mocks de `app/app/mis-campos.tsx`.

## 2026-05-30 — Deuda de seguridad pre-existente: `soft_delete_event` omite `has_role_in` (L1)

**Origen**: sesión 20, Gate 1 (security modo spec) del delta Tier 1 de spec 02 (`progress/security_spec_02-modelo-animal.md`, anexo L1).
**Qué**: el RPC genérico `soft_delete_event` (`supabase/migrations/0041_soft_delete_rpcs.sql` ~l.110, **ya mergeado**) autoriza con `is_owner_of(v_est) or v_created_by = auth.uid()` — **omite** el `has_role_in(v_est)` que su hermano `soft_delete_animal_event` sí exige. Es la misma clase del finding SEC-SPEC-01 (autor cuyo rol fue desactivado sigue pudiendo borrar su evento). Quedó **fuera del alcance Tier 1** (no se reabre código ya cerrado en este fold), por eso se asienta acá.
**Por qué importa**: mismo-tenant authz: un usuario removido del establecimiento conserva la capacidad de soft-deletear los eventos que cargó. Bajo impacto (no cross-tenant, requiere haber tenido rol), pero inconsistente con el patrón canónico endurecido.
**Próximo paso sugerido**: al tocar `0041` o en un barrido de hardening, agregar `has_role_in(v_est) and (...)` a la guarda de `soft_delete_event` + test de no-bypass del autor-sin-rol (espejo de T2.18/T2.19). No urgente; no MVP-blocker.

## 2026-06-01 — Build web de producción no inyecta las env `EXPO_PUBLIC_*` (acceso dinámico) → pantalla en blanco

**Origen**: sesión 21, armado de la suite Playwright E2E (agente en worktree, `app/e2e/`). Al hacer `expo export -p web` para servir el estático, la app arrancaba en blanco.
**Qué**: `app/src/utils/env.ts → readPublicEnv(name)` lee `process.env[name]` de forma **dinámica** (índice por variable). `babel-preset-expo` solo **inlinea accesos ESTÁTICOS** (`process.env.EXPO_PUBLIC_FOO`) en el bundle exportado. Resultado: en el export web, `process.env[name]` queda `undefined` → `getEnv()` tira "Faltan variables EXPO_PUBLIC_*" → el cliente Supabase no se crea → **pantalla en blanco**. En `pnpm web` (dev) NO se nota porque ahí `process.env` está poblado en runtime. El harness E2E lo sortea con un `addInitScript` que define `globalThis.process.env.EXPO_PUBLIC_*` antes del bundle (NO toca código de la app).
**Por qué importa**: es un **bloqueante latente del deploy web real**. Y está ACOPLADO a las invitaciones: el `accept_url` apunta a `https://app.rafq.ar/invite?token=` — cuando ese dominio se hostee (build estático), si el bug sigue, el sitio queda en blanco y **los links de invitación no abren**. O sea: arreglar esto es prerequisito para que el deep-link/universal-link de spec 01 Fase 5 funcione en prod (hoy diferido).
**Próximo paso sugerido**: cuando se aborde el deploy web (o junto con el deep-link nativo de Fase 5), cambiar `env.ts` a accesos ESTÁTICOS (`process.env.EXPO_PUBLIC_SUPABASE_URL` etc., explícitos) o leer de `Constants.expoConfig.extra`. Cambio chico y aislado en `src/utils/env.ts` + verificar con `expo export -p web` + servir el estático. NO urgente para el MVP (se itera por `pnpm web` dev), pero NO olvidarlo antes de cualquier hosting web.

## 2026-06-01 — Type-check propio de la suite E2E (`app/e2e/`)

**Origen**: sesión 22, merge de la suite Playwright a main. Al traer `e2e/*` al árbol principal, el `tsc --noEmit` del app levantaba sus `.ts` (Node: `node:fs`/`__dirname`/`ws`/`node:crypto`) y fallaba.
**Qué**: se excluyó `e2e` + `playwright.config.ts` del `app/tsconfig.json` para que `check.mjs` quede verde sin meter `@types/node` en el árbol del app (al estar `node-linker=hoisted`, `@types/node` contaminaría el type-env del RN app y podría enmascarar usos de APIs de Node inexistentes en RN). Consecuencia: el código de los tests E2E hoy **no tiene type-check** (Playwright lo transpila en runtime sin chequear tipos).
**Por qué importa**: los helpers de e2e operan con `service_role` (admin) — un type bug ahí podría pasar silencioso. Bajo riesgo (suite chica + corre verde), pero RAFAQ apunta a "mejor en el primer try".
**Próximo paso sugerido**: agregar `app/e2e/tsconfig.json` con `types: ["node", "@playwright/test"]` (scopeado, sin filtrar a la app) + `@types/node`/`@types/ws` como devDeps + script `e2e:typecheck` (`tsc -p e2e/tsconfig.json --noEmit`). Opcional cablearlo a `check.mjs` (ojo: no debería pegarle a la red). Cuando se active `invitations.spec.ts` post-B.1.3 es buen momento.

## 2026-06-01 — Loop potencial al abrir `/invite?token=` con sesión iniciada (deep-link, DIFERIDO)

**✅ RESUELTO (2026-07-22, bugfixes invite — `progress/impl_invite-fixes.md`)**: `invite.tsx` ya NO persiste el token mientras `AuthState` está en `loading` — arranca en una fase `resolving` (núcleo puro `invitePhaseForAuth`) y espera a que auth RESUELVA antes de decidir `confirm`/`auth_required`. En el path authed-goto el token nunca se persiste → el RootGate no re-rutea → sin loop. Verificado por E2E `invitations.spec.ts` test "bug 1" (goto authed → aceptar → home, NO loopea) — que **falla contra el build con el bug** (queda atrapado en `/invite` confirm) y pasa con el fix (no-false-green) — más el test de regresión del path deslogueado. Rebrand-safe (independiente del dominio). Entrada original abajo por trazabilidad.

**Origen**: sesión 22, activación de `invitations.spec.ts` (E2E). Al hacer `page.goto('/invite?token=…')` (carga fresca) con un usuario ya logueado, el harness reprodujo un loop confirm→accept→confirm.
**Qué**: en una carga fresca, `AuthContext` arranca en `loading` → `invite.tsx` ve `isAuthed=false` → entra en `auth_required` y **persiste el token** (R5.13). Cuando auth resuelve, pasa a `confirm`; pero tras aceptar, el `RootGate` (re-ruteo centralizado R5.13) parece volver a `/invite` por el token persistido (timing del clear vs el guard) → loop. NO se reproduce por el flujo in-app (pegar link desde el wizard / "Pegar link de invitación") porque la sesión nunca cae a `loading` → va directo a `confirm`, sin persistir token. El E2E usa el flujo in-app (también un camino real) y queda verde.
**Por qué importa**: es un bug LATENTE del camino deep-link/universal-link con sesión activa — hoy DIFERIDO (sin dominio `app.rafq.ar`, device-blocked, scheme no asociado). Pero hay que arreglarlo ANTES de habilitar deep-links de Fase 5.
⚠️ **CORRECCIÓN (2026-07-27)**: este párrafo decía *"No es MVP-blocker (el camino usable hoy es pegar el link, que anda)"*. **Es falso y hay que verlo escrito**: nadie *pega* un link que acaba de recibir por WhatsApp — lo **toca**. Y al tocarlo cae en `app.rafq.ar`, que no existe. Raf lo descubrió usándolo desde un iPhone real (2026-07-27) después de que esto llevara semanas registrado como "diferido". Ver la entrada «Las invitaciones NO funcionan» más abajo.
**Próximo paso sugerido**: cuando se aborde el deep-link nativo/universal-link, revisar `invite.tsx` + el re-ruteo R5.13 del `RootGate`: no persistir el token si el estado es `loading` (esperar a que auth resuelva antes de decidir `auth_required`), o limpiar/guardar de forma que el accept no vuelva a disparar el re-ruteo. Reproducir con `goto('/invite?token=')` + sesión activa.

## 2026-06-01 — Cambio/verificación de email depende del envío de mails de Supabase (rate-limited) → SMTP propio para escala

**Origen**: sesión 22, E2E de cambio de email. `auth.updateUser({email})` contra el remoto devolvió `over_email_send_rate_limit` (429).
**Qué**: el cambio de email (R2.2) y la verificación de signup (R1.2) usan el **email built-in de Supabase Auth**, que tiene una cuota de envío baja (sin SMTP custom, ~2/hora por proyecto, compartida entre todos los flujos de auth). En el beta con pocos usuarios alcanza; a escala (o en ráfagas de testing) se satura → los usuarios no reciben el mail de verificación/cambio.
**Por qué importa**: el flujo de cambio de email y la verificación de signup son parte del producto; si el envío se rate-limitea, quedan rotos para el usuario final. Resend ya está configurado (notificación al owner, R5.10) pero NO como SMTP de Auth.
**Próximo paso sugerido**: antes de abrir a más usuarios, configurar **SMTP custom (Resend) en Supabase Auth** (Auth → SMTP settings) para que verificación + cambio de email + reset de password salgan por Resend (sin rate-limit del built-in). Cambio de config, sin código. Relacionado: testear el click del link de verificación en E2E necesita un inbox-tool (Inbucket/Mailosaur) — hoy el E2E solo verifica que el viejo email se mantiene (R2.2), no el click del link.

## 2026-06-01 — Mapear errores crudos del backend a copy genérico (cliente + edge functions)

**Origen**: Gate 2 de Fase 6 backend (edge `db_error` devuelve `err.message` de Postgres) y de C1 rodeos (errores `kind:'unknown'` muestran el `message` crudo de PostgREST en `crear-rodeo`/`rodeos`/`editar-plantilla`). LOW, no bloqueante, no explotable, pero es information disclosure de bajo impacto + UX pobre (el usuario ve jerga SQL).
**Qué**: dos clases del mismo patrón — (a) las 8 edge functions devuelven `err.message` crudo en el caso 500 `db_error`; (b) varios services del cliente clasifican errores no-red como `kind:'unknown'` con el `message` del server y la UI lo muestra tal cual.
**Por qué importa**: RAFAQ apunta a "mejor en el primer try" — un error con jerga de Postgres rompe la percepción de calidad. Riesgo de seguridad bajo (cliente autenticado, sin secretos en el message), pero conviene limpiar antes de beta real.
**Próximo paso sugerido**: en el cliente, mapear `kind:'unknown'` a copy genérico es-AR ("No pudimos completar la acción. Probá de nuevo.") en vez de pasar el `message` crudo; en las edge functions, devolver un code estable + copy genérico para 500 (loguear el detalle server-side, no exponerlo). Pasada transversal cuando se pula la capa de errores; no bloquea features nuevas.

## 2026-06-01 — `accessibilityLabel` crudo filtra al DOM en TODAS las pantallas (warning de React en DEV)

**Origen**: fix-loop de C1 rodeos (BUG 2). La causa REAL del toggle que "no respondía" en `pnpm web` era un warning de React — "does not recognize the `accessibilityLabel` prop on a DOM element" — porque se pasaba `accessibilityLabel` crudo a un `Pressable`/`View` de react-native-web (que NO lo traduce a `aria-label` cuando ya hay props ARIA crudas spreadeadas). En DEV ese warning monta el error-overlay/LogBox de Expo, que puede cubrir la pantalla e interceptar toques. En el export de PRODUCCIÓN el overlay no existe → invisible (por eso la E2E, que corre el export, no lo atrapa).
**Qué**: el patrón correcto (web → `aria-label`; native → `accessibilityLabel`) ahora está centralizado en `app/src/utils/a11y.ts` (`switchA11y`/`buttonA11y`, con tests) y aplicado a la SUPERFICIE DE C1 (FieldTemplateToggleList, crear-rodeo, rodeos, editar-plantilla). PERO el mismo leak crudo persiste en muchas otras pantallas fuera de scope: `mas.tsx`, `miembros.tsx`, `mis-campos.tsx`, `invitar.tsx`, `AnimalRow.tsx`, `EstablishmentCard.tsx`, `ShareLink.tsx`, `AuthBits.tsx`, `(tabs)/animales.tsx`, `(tabs)/_layout.tsx`, `EstablishmentSwitcherDropdown.tsx`, `FormField.tsx`. Raf probó esas pantallas en dev y "funcionaban", así que el overlay ahí no bloquea de forma evidente (posición del badge / elementos que sí traducen), pero el warning igual se emite y es deuda real.
**Por qué importa**: un overlay de error en dev degrada el testing manual (fuente recurrente de "no había acción") y es ruido de consola en cada pantalla. Si en algún caso el badge se posiciona sobre un control, lo bloquea (lo que pasó con el toggle). Limpia la base de a11y multiplataforma de una.
**Próximo paso sugerido**: pasada transversal usando `app/src/utils/a11y.ts` (ya existe) en todas las pantallas/componentes listados — reemplazar el `accessibilityLabel`/`accessibilityRole`/`accessibilityState` crudo por `buttonA11y(Platform.OS, …)` / `switchA11y(…)` o el branch web/native. No bloquea features nuevas; ideal antes de beta real o cuando se retome el frontend de spec 09. Idealmente, un lint que prohíba `accessibilityLabel=` literal en `app/app/**`/`app/src/components/**` (análogo al anti-hardcode) para no reintroducirlo.

## 2026-06-01 — Forzar `created_by` no-spoofeable en las tablas de evento (deuda sistémica SEC-SPEC-03)

**Origen**: sesión 22, Gate 1 (security modo spec) de spec 10 (`progress/security_spec_10-operaciones-rodeo.md`, finding H2 / decisión D7). Resuelto en spec 10 vía Path A (corregir la afirmación), no arreglando el sistémico.
**Qué**: las tablas de evento (`sanitary_events` 0027, `reproductive_events` 0026, `weight_events` 0025, `condition_score_events` 0028, `lab_samples` 0029) usan el trigger `tg_set_created_by_auth_uid` (0024, "setea **solo si NULL**") → un cliente puede mandar `created_by` con el id de **otro usuario del mismo establishment** y queda persistido (spoofing **intra-tenant** de autoría). El trigger no-spoofeable `tg_force_created_by_auth_uid` (0043, sobreescribe siempre) existe y ya lo usan `animal_profiles`/`sessions`/`maneuver_presets`, pero las tablas de evento nunca lo adoptaron. La distinción está documentada literal en 0043 (SEC-SPEC-03).
**Por qué importa**: atribución de autoría en datos regulados SENASA — quién cargó cada evento. **NO es brecha cross-tenant** (la RLS sigue impidiendo escribir sobre otro establecimiento); es integridad de auditoría intra-campo. Bajo impacto, pero inconsistente con el patrón ya endurecido en otras tablas. Afecta transversalmente a specs 02/03/09/10 (todas escriben eventos).
**Próximo paso sugerido**: barrido de hardening — cambiar el trigger `BEFORE INSERT` de las 5 tablas de evento de `tg_set_created_by_auth_uid` a `tg_force_created_by_auth_uid` (vía migration nueva, sin reabrir las viejas) + test de no-spoof por tabla (espejo del de `animal_profiles`/sessions). Decisión arquitectónica de Raf (toca backend done de spec 02). NO urgente, NO MVP-blocker.

## 2026-06-04 — `register_birth` sin tope superior de terneros (DoS intra-tenant) — Gate 2 de C3.2, VERIFY-001

**Origen**: Gate 2 (seguridad, modo code) del frontend C3.2 reproductivo (`progress/security_code_02-frontend-c3.2-reproductivo.md`, finding MEDIUM `VERIFY-001`). El frontend pasó PASS (0 HIGH); este es el único punto a verificar y vive en backend.
**Qué**: la RPC `register_birth` (migration `0045`) valida `jsonb_array_length(p_calves) >= 1` pero **no impone tope superior**, e itera el array completo creando `animals` + `animal_profiles` + `birth_calves` por cada elemento en una sola transacción. Un caller **autenticado y con rol** en el establishment podría mandar un `p_calves` gigante (miles de elementos) y forzar miles de inserts atómicos.
**Por qué importa**: es un **DoS intra-tenant** (no cross-tenant, no fuga de datos, no IDOR — la RLS y la derivación de tenant server-side siguen intactas). Bajo impacto real (requiere un caller ya autorizado actuando de mala fe dentro de su propio campo), pero el contrato de la RPC debería acotar el N. El form de C3.2 no es la barrera autoritativa (un atacante saltea la UI y llama la RPC directo).
**Próximo paso sugerido**: en la RPC `register_birth` (migration nueva, sin reabrir 0045), agregar `if v_count > 20 then raise exception ... using errcode='22023'; end if` (un parto de >20 terneros no existe biológicamente; 20 es holgado) + test. Owner del contrato `register_birth` = backend de spec 02. Opcional defensa-en-profundidad: cap blando en la lista de terneros del form (no autoritativo). NO urgente, NO MVP-blocker.

## 2026-06-04 — Barrido de "back robusto" (backOr) en el resto de las pantallas · ✅ RESUELTO (2026-07-23)

**Origen**: fix del bug de navegación (`router.back()` con stack vacío) que Raf vio en `pnpm web`, mientras se blindaban las pantallas del flujo ficha/alta/evento (spec 02 frontend).
**Qué**: el helper `app/src/utils/nav.ts` `backOr(router, fallback)` (canGoBack ? back : replace(fallback)) se aplicó SOLO a las 3 pantallas del flujo (`agregar-evento`, `animal/[id]`, `crear-animal`). Quedaban `router.back()` "pelados" en el resto de las pantallas.
**✅ RESUELTO (2026-07-23, barrido backOr — implementer)**: grep autoritativo de `router.back()` en `app/app` + `app/src` → **15 pantallas blindadas** (superó la lista de memoria del backlog: el grep encontró además `export-sigsa`, `editar-servicio`, `reportes/{sesiones,sesion/[id],comparar}`, `maniobra/jornada`). ⚠️ **`StickConnectionScreen` (BLE) EXCLUIDO** por el leader: es territorio de la terminal de BLE (feature 04, fuera de alcance de esta terminal — memoria `feedback_parallel_terminals`); su cambio se revirtió para no colisionar → lo blinda la terminal de BLE (queda como el único `router.back()` pelado pendiente). **↑ ACTUALIZADO 2026-07-29**: esa terminal murió y Raf pasó la titularidad de BLE → ya no es territorio ajeno; el pendiente pasó a ser deuda propia y tiene entrada propia arriba ("`StickConnectionScreen`: el único `router.back()` pelado que queda en la app"). Fallback = origen lógico por pantalla:
- → `/(tabs)/mas` (llegadas desde "Más"): `cambiar-email`, `editar-campo`, `miembros`, `rodeos`, `export-sigsa`.
- → `/rodeos` (llegadas desde RodeosScreen): `editar-plantilla`, `editar-servicio`, `crear-rodeo` (solo el `router.back()` final; se respetó el back condicional `if (!isBlockingEmptyState)`).
- → `/(tabs)/reportes` (llegadas desde la tab Reportes): `reportes/sesiones`, `reportes/comparar`, `reportes/sesion/[id]` (el padre `sesiones` requiere params rodeoId/name irrecuperables en frío → la tab es el origen lógico seguro).
- → `/miembros`: `invitar`.
- → `/maniobra`: `maniobra/jornada` (wizard PUSHEADO sobre el landing de MODO MANIOBRAS; ambos backs: onBack etapa 1 + onGuardarCambios del preset).
- → `/(tabs)` (home): `crear-campo` (3 orígenes — onboarding/index/mis-campos → neutral, el RootGate re-rutea por estado de establecimiento) y `maniobra` (modal, ver nota).
- **`maniobra` (modal `presentation:'modal'`)**: se aplicó backOr DEFENSIVO al "Cerrar" (X). NO rompe el cierre: en el caso normal (abierto vía FAB) `canGoBack()` es true → `router.back()` cierra el modal como siempre; solo blinda el cold-start/deep-link/web-refresh directo en `/maniobra` (stack vacío → back pelado fallaría silencioso y trabaría al usuario en el modal) reemplazando por `/(tabs)`.
- `invite` ya estaba hecho (2026-07-22, bugfixes invite). Frontend puro (typecheck + anti-hardcode verdes; `nav.test.ts` sigue 3/3; diff supabase/sync-streams vacío).
**Por qué importaba**: el mismo escenario (web-refresh / hot-reload / deep-link / cold-start en una ruta profunda → stack vacío → `router.back()` falla silencioso) dejaba al usuario trabado en cualquiera de esas pantallas.

## 2026-06-04 — Flag "Tuvo aborto" en la LISTA de animales (no solo en la ficha)

**Origen**: gating reproductivo C3.2 (frontend), tarea T3 (flag "marquita roja" A2 — dominio Facundo §1). El flag se implementó en la FICHA del animal (`animal/[id].tsx`, derivado de `hasAbortion(timeline)`), pero NO en la fila de la lista.
**Qué**: la fila de la lista (`AnimalRow`) la alimenta la query de la lista de animales (`services/animals.ts`), que hoy NO trae los eventos reproductivos de cada animal. Mostrar el flag "Tuvo aborto" en la lista requiere que la query del listado sepa, por animal, si tiene ≥1 evento `abortion` — un dato extra (subquery / flag agregado / join a `reproductive_events`).
**Por qué importa**: Facundo pidió la marquita roja "en la ficha/lista". En la ficha ya está (el timeline ya se carga); en la lista falta. Verla de un vistazo en la lista ayuda a identificar vacas problemáticas sin abrir cada ficha. No MVP-blocker (la ficha la cubre).
**Próximo paso sugerido**: extender la query de la lista con un flag `had_abortion` por animal (ej. `exists` sobre `reproductive_events` con `event_type='abortion'`, o un campo agregado en la vista/RPC del listado) + render del chip terracota en `AnimalRow` (reusar el patrón `AbortionFlag` de la ficha). Owner = frontend lista (C2) + posible delta de la query. NO urgente.

## 2026-06-04 — Baseline de seguridad: auditoría retroactiva contra el catálogo A–I (9 findings)

**Origen**: sesión de ampliación del `security_analyzer` (Raf pidió cubrir validación de inputs + rate limits, y luego las 9 clases de defecto del nuevo Catálogo A–I). Auditoría one-off del código YA MERGEADO contra el catálogo → reporte completo en **`progress/security_baseline_shipped.md`** (3 HIGH / 6 MEDIUM / 4 LOW, con tablas de inputs/rate-limits/service-role). Los 3 HIGH fueron re-verificados por el leader contra el source.
**Qué (triage de los 9)**:
- **INPUT-1 (HIGH)** — ninguna columna de texto de usuario tiene tope server-side (`varchar(n)`/`CHECK char_length`); los topes viven solo en el cliente (UX, bypasseable vía PostgREST directo). → **spec 13 hardening**.
- **A1-1 (MEDIUM)** — `animals_update` con `with check (true)` (`0022_rls_animals_and_profiles.sql:34-40`) permite a un user del campo A reescribir `tag_electronic`/`sex`/etc. de un animal compartido con el campo B (integridad cross-tenant). → **spec 13 hardening**.
- **F1-1 (MEDIUM)** — buscador (`animals.ts:341` `escapeIlike`): no neutraliza `.():*` de `.or()` (PostgREST filter injection, intra-tenant) + término sin tope de largo. → **spec 13 hardening**.
- **H1-1 (MEDIUM)** — sesión/JWT no se invalida al remover/degradar miembro (sigue válido hasta `jwt_expiry=1h`; RLS lo corta igual, por eso MEDIUM). → **spec 13 hardening**.
- **B1-1 (MEDIUM)** — `err.message` crudo de Postgres al cliente (32 ocurrencias / 8 EFs + `_shared/auth.ts:44`). **YA ESTABA EN BACKLOG** (entrada 2026-06-01 "Mapear errores crudos del backend a copy genérico") — la auditoría lo cuantificó. → se procesa en **spec 13 hardening** (cierra esa entrada).
- **B3-1 (HIGH)** — PII de coworkers (phone+email) legible por cualquier miembro vía PostgREST directo (`0006_rls_users.sql:16-31`, RLS es row-level no column-level). **RESUELTO por LLM Council (2026-06-04, veredicto unánime)**: patrón **D — separar PII de contacto a tabla `user_private` self-only** (las views/RPC/column-grants no protegen el canal realtime/PowerSync; solo la separación física sí). → **feature 14 `14-pii-user-private`** (registrada, Gate 0 escrito en `specs/active/14-pii-user-private/context.md`, pendiente aprobación de Raf). PRIORIDAD: 2º HIGH explotable-hoy; conviene hacerlo ANTES de wire PowerSync (barato ahora, caro después).
- **H2-1 (HIGH→leader lo ve MEDIUM)** — `minimum_password_length = 6` en `config.toml:177` vs 8 en el cliente. → **fix de config** (propuesto a Raf; aplicar también en Auth del proyecto remoto).
- **E2-1 (MEDIUM, latente)** — Edge Functions custom sin rate limit propio; la cadena `invite→accept` dispara Resend+push (denial-of-wallet). Hoy latente (Resend sin `RESEND_API_KEY`); **sube a HIGH al configurar la key**. → candidato a spec 13 o spec propia (requiere tabla `rate_limits` + lógica).
- **E3-1 (MEDIUM)** — captcha OFF + `enable_confirmations=false` (`config.toml`): registro masivo + `requireUser` acepta email no verificado. → **decisión producto/seguridad** (captcha = setup con provider+key; email-confirmation = trade-off UX de campo).
- **E4-1 / I1-1 / C3-1 / CORS-1 (LOW)** — enumeration de membresía; retención/borrado Ley 25.326 sin flujo; tokens en localStorage solo en web (target de verificación); CORS `*` en EFs (cerrar pre-prod). → backlog, no urgentes.
**No auditable hoy (excluido, re-auditar al implementarse)**: C (PowerSync sync rules/Realtime/SQLite-at-rest, no wired), G (BLE spec 04 sin shippear), F2/F3 (import CSV / SSRF, spec 12 sin código). Cruza con las deudas authz ya en backlog (`soft_delete_event` L1 2026-05-30; `created_by` no-spoofeable SEC-SPEC-03 2026-06-01; `register_birth` sin tope VERIFY-001 2026-06-04) — candidatas a barrer en el mismo hardening.
**Por qué importa**: B3-1 e INPUT-1 son explotables HOY solo con un JWT de miembro (no requieren service-role) y son exactamente lo que muerde a una app multi-tenant con datos privados a escala. El resto es defensa en profundidad / pre-prod.
**Próximo paso sugerido**: **feature 13 `13-hardening-seguridad`** (registrada en `feature_list.json`, status `pending`) agrupa el cluster code/DB (INPUT-1, B1-1, A1-1, F1-1, H1-1) por el flujo SDD. B3-1 y E3-1 = decisiones de Raf antes de specear. H2-1/CORS = fix de config.

## 2026-06-04 — Residuales del Gate 1 de spec 13 (para confirmar en Puerta 1)

**Origen**: Gate 1 (security_analyzer modo spec) de la feature 13 (`progress/security_spec_13-hardening-seguridad.md`). El veredicto fue NEEDS_CLARIFICATION por un solo bloqueante (SPEC-HIGH-1, INPUT-1 incompleto → resuelto por el leader vía Path A: ampliar R1 a las ~14 columnas faltantes en el mismo barrido). Estos dos son residuales MEDIUM que la propia spec ya reconoce/escala — NO bloquean Gate 1, pero la Puerta 1 humana los confirma.
**Qué**:
- **A1-1-resto (SPEC-MED-1)**: el fix de `animals_update` (re-validar `has_role_in` en el `with check`) + el trigger 0036 cierran el caso explotable-hoy (animal mono-perfil) y blindan el EID/IDV. Queda un residual: con un animal COMPARTIDO entre campos (perfil en A y en B), un co-tenant de A puede reescribir `sex`/`birth_date`/`breed`/`coat_color` de la fila global que el campo B también ve (acceso legítimo por rol en A; no lo bloquea ninguna policy). Requeriría **column-level write authz** sobre `animals`/`animal_profiles` — scope nuevo, NO se mete en spec 13.
- **H1-1-API (SPEC-MED-2)**: H1-1 (invalidar sesión del target al remover/degradar miembro) depende de que `auth.admin.signOut(userId, scope)` por user-id exista en la versión de `@supabase/supabase-js@2`/GoTrue del proyecto. La spec lo marca como incógnita a verificar al implementar (T16) con escalado obligatorio si no existe (no aceptar el fallback `active:false`-solo sin decisión de Raf).
**Por qué importa**: A1-1-resto es bajo impacto en MVP single-beta (no hay animales compartidos entre tenants aún); sube si se habilita la transferencia (feature 11). H1-1-API puede convertir H1-1 en un blocker de implementación si la API por-user-id no existe.
**Próximo paso sugerido**: A1-1-resto → barrido futuro de column-level write authz (junto con las otras deudas authz: L1, SEC-SPEC-03) cuando se aborde la transferencia o un hardening profundo. H1-1-API → **RESUELTO (2026-06-05)**: `signOut(userId)` no existe en supabase-js@2 y el ban finito se probó empíricamente inefectivo (no revoca el refresh token persistente); se implementó el RPC `revoke_user_sessions` (migración 0072, `DELETE FROM auth.sessions WHERE user_id=target` = signOut-global por user-id, verificado a mano). Queda solo el residual de que el access-token vive ~1h (stateless) cubierto por RLS — aceptable para MEDIUM.

## 2026-06-05 — Limpiar la data de e2e de producción antes del beta de Chascomús (HACER ANTES DE ONBOARDEAR)

**Origen**: deploy de feature 13 (INPUT-1). Al aplicar el CHECK de `tag_electronic` (tope 32), el pre-check encontró 179 animales con tags > 32 chars; resultaron ser fixtures de e2e (`animal_test_<ts>_<rand>_<SUFFIX>`, ej. `animal_test_1780000540101_s33chk_DUPCALF`, y un `120321...` de 36 díg sintético).
**Qué**: el proyecto Supabase **remoto** (prod) tiene ~**1800 `animals` + 747 `animal_profiles` + cientos de eventos de TEST** (de las corridas e2e/seed acumuladas), con tags basura. No es data real. Cuando se onboardee el beta de Chascomús (Facundo + el campo del padre), el cliente arrancaría con su data mezclada con basura de test.
**Por qué importa**: data sucia en prod = analytics sucio (pilar del producto), confusión, y riesgo de que el cliente vea animales fantasma. RAFAQ apunta a "el mejor en el primer try". Además, por culpa de esos tags largos, 2 columnas (`animals.tag_electronic`, `reproductive_events.calf_tag_electronic`) quedaron con su CHECK en `NOT VALID` sin `VALIDATE` (grandfather) y con tope 64 en vez de 32 — una limpieza permitiría validar el constraint y bajar el tope al valor real (15 díg FDX-B + holgura).
**Próximo paso sugerido**: antes del beta real, purgar la data de e2e del remoto (identificable por el prefijo `animal_test_` / emails `@rafaq-test.local` / `bantest_` etc.) con un script de limpieza cuidadoso (respetando FKs: events → profiles → animals → users). Después, opcionalmente, `VALIDATE CONSTRAINT` de los 2 tags + bajar el tope a 32. Coordinar con la suite e2e (que debe limpiar lo suyo; ver si el cleanup de los helpers está fallando y dejando residuo).
**Nota 2026-06-10 (Gate 2 T7, LOW-2)**: la suite nueva `sync_streams` limpia por ids trackeados, pero ante un kill duro puede dejar huérfanos namespaced (`@rafaq-test.local`) — el sweep de esta entrada los cubre; aplica a todas las suites contra remoto.

## 2026-06-08 — La DB beta contaminada con data de test rompió el sync de PowerSync + falta aislamiento de tests (ADR)

**Origen**: sesión PowerSync (feature 15), al conectar el primer cliente real contra la instancia. El server cerró el stream con `PSYNC_S2305` (too many buckets). La causa de fondo del conteo inflado: la DB beta remota tiene **106 establecimientos (103 vivos), 957 `animal_profiles`, 205 `user_roles`** de runs de test acumulados (misma raíz que la entrada **2026-06-05** "Limpiar la data de e2e de producción" — ~1800 animals; esto la re-confirma y la agrava).
**Qué** (dos ángulos nuevos sobre la misma raíz):
- **Consecuencia activa, no solo higiene**: las parameter queries de las sync streams evaluaban ~100 establecimientos por stream → el redesign con `with:` (bucket por campo del user) **esquiva el corte del sync**, pero cuando sincronice **Raf va a ver data de test mezclada** con su campo real (los pilares analytics/benchmarking se ensucian).
- **El usuario de Raf quedó enredado**: `78d35c28-…` tiene **5 roles activos / 2 establecimientos vivos** (3 roles apuntan a campos soft-deleteados = test). Conviene **limpiar sus roles espurios** además de la data.
- **Problema de proceso (lo nuevo)**: `node scripts/run-tests.mjs` corre las suites RLS/animal/import/etc. **contra la DB beta REMOTA** (necesitan `SUPABASE_SERVICE_ROLE_KEY` y le pegan al remoto) → cada corrida **acumula** data en la base que va a usar el cliente beta de Chascomús. Eso es un anti-patrón de aislamiento de tests.
**Por qué importa**: data sucia en la base de producción/beta = analytics sucio (pilar del producto) + confusión del cliente; y a futuro cada `check` ensucia más. Ya bloqueó (vía el bucket count) el primer sync real.
**Próximo paso sugerido**:
- **Corto**: purgar la data de e2e del remoto (prefijos `animal_test_` / `@rafaq-test.local` / `bantest_` + los establecimientos/roles de test) — coordinar con la entrada 2026-06-05; incluir la limpieza de los **roles espurios de Raf**.
- **Estructural (ADR)**: mover las suites a una **DB aislada** — Supabase **branching** (DB efímera por branch/PR) o un stack **local** (`supabase start`) — para que los tests NUNCA le peguen al proyecto beta. Decisión arquitectónica de Raf; candidato a ADR de "entorno de tests". No bloquea el fix de streams de PowerSync.
- **Nota de proceso**: las sync streams se Gate-1earon por autorización pero nunca se validaron en deploy/runtime contra una DB real hasta ahora → la explosión de buckets (límite operativo) se pasó. Sumar una validación de deploy de streams (bucket count + sin `PSYNC_S2xxx` en logs) al cierre de la feature 15.

## 2026-06-09 — `accept_invitation`: mensaje de error lindo al aceptar invitación a un campo borrado

**Origen**: Gate 1 (security) del modelo de sync JOIN-free de PowerSync (feature 15, V3). Finding HIGH-1 cerrado a nivel DB.
**Qué**: el invariante "`user_roles.active = true` ⇒ campo vivo" (del que dependen las streams JOIN-free) lo cierra ahora un **guard trigger en `user_roles`** (migración 0076): prohíbe activar/insertar un rol para un establecimiento soft-deleteado. Eso cierra el agujero de seguridad (un invitado que acepta el link de un campo recién borrado ya NO crea un rol activo → no se le sincroniza data del campo borrado). PERO: cuando `accept_invitation/index.ts` (~l.93) inserta el rol contra un campo borrado, el guard tira una **excepción cruda de Postgres** → la EF devuelve un error genérico/feo en vez de un mensaje claro ("Esta invitación ya no es válida: el campo fue eliminado").
**Por qué importa**: es UX de un edge-case raro (aceptar justo después de un borrado), no un hueco de seguridad (ese ya está cerrado por el guard). RAFAQ apunta a "mejor en el primer try" → un error con jerga SQL rompe la percepción.
**Próximo paso sugerido**: en `accept_invitation`, antes del insert del rol, chequear `establishments.deleted_at IS NOT NULL` → devolver un code estable + copy es-AR ("La invitación ya no es válida porque el establecimiento fue eliminado."). Defensa-en-profundidad sobre el guard DB (que sigue siendo la barrera autoritativa). Requiere redeploy de la EF. Cuando se toque la capa de EFs / errores (cruza con la entrada 2026-06-01 "Mapear errores crudos del backend a copy genérico").

## 2026-06-09 — Propagar el soft-delete del padre a `birth_calves` / `rodeo_data_config` (equivalencia stream↔RLS, paso 2)

**Origen**: Gate 1 (security) del paso 2 de PowerSync (`progress/security_spec_15-powersync-paso2.md`). Dos findings MEDIUM, **same-tenant correctness, NO cross-tenant** (Gate 1 PASS igual).
**Qué**: las streams JOIN-free `ev_birth_calves` y `est_rodeo_data_config` filtran solo `establishment_id IN org_scope`, pero su RLS as-built filtra además el `deleted_at` del PADRE que ellas no tienen: `birth_calves_select` filtra `reproductive_events.deleted_at IS NULL` (0045); `rodeo_data_config_select` filtra `rodeos.deleted_at IS NULL` (0018). Al soft-deletear un parto / un rodeo, sus filas hijas (links de parentesco / config del template — solo UUIDs/flags, **del propio campo**) siguen sincronizando al device, aunque la RLS las oculta.
**Por qué importa**: bajo — es **same-tenant** (no sale nada cross-tenant, no hay PII) y **invisible** (las filas huérfanas no se renderizan: su padre, el parto/rodeo soft-deleteado, no sincroniza). Es bloat menor del SQLite local + una desviación de la equivalencia stream↔RLS estricta. NO es MVP-blocker; el deploy del paso 2 procede con esto documentado.
**Próximo paso sugerido**: migración nueva que agregue `deleted_at` (o un flag) a `birth_calves` y `rodeo_data_config`, mantenido por un trigger que propague el soft-delete del padre (cuando `reproductive_events.deleted_at`/`rodeos.deleted_at` pasa a NOT NULL → marcar las hijas), + filtrar `deleted_at IS NULL` en las dos streams. Cierra la equivalencia. Patrón = el trigger de propagación de 0079/0080. Gate 1 sobre el delta. Quitar los comentarios ⚠️ de las dos streams en `rafaq.yaml` al cerrarlo.

## 2026-06-09 — Transición de categoría optimista offline (tacto/aborto) — PowerSync T5

**Origen**: T5 (escritura offline simple) de PowerSync. Los `add*` de eventos escriben local + suben al reconectar.
**Qué**: las transiciones de **categoría** del animal por un evento reproductivo (un tacto positivo → "preñada", un aborto → revierte) las hace un **trigger AFTER INSERT server-side** sobre `reproductive_events` (inserta `animal_category_history` + actualiza `animal_profiles.category`). Offline ese trigger NO corre → el **evento se graba y se ve en el timeline al instante**, pero el **badge/categoría** del animal (lista, ficha) NO se actualiza hasta que el evento sincroniza (reconexión → upload → trigger server → re-sync del perfil).
**Por qué importa**: bajo — el dato crítico (el evento) se graba offline sin pérdida; es solo el estado DERIVADO (categoría) el que lagea hasta el sync. En la manga el operador igual ve el tacto registrado. Pero para "mejor en el primer try", ver la categoría actualizada al instante offline sería más pulido.
**Próximo paso sugerido**: transición de categoría **optimista** offline — replicar la lógica del trigger en el cliente (un overlay/UPDATE local de la categoría al cargar el tacto/aborto, reconciliado al sync) o un `pending_status_overrides` de categoría (similar al overlay de T6). Evaluar al cerrar T6 (comparte el patrón de overlay). NO MVP-blocker.

## 2026-06-09 — `createRodeo` offline — ✅ RESUELTA (2026-06-09, Run T9.8) — PowerSync

**✅ RESUELTA (2026-06-09)**: Raf pidió explícito que `createRodeo` funcione OFFLINE (offline-first sin excepciones). Se implementó la **opción (b)** del "próximo paso" de abajo: outbox → RPC nueva `create_rodeo` (migración `0081`, NO aplicada aún — la aplica el leader tras Gate 1) que hace seed+diff atómico server-side (como `register_birth`), + overlay optimista (`pending_rodeos` + `pending_rodeo_data_config`, la plantilla COMPUTADA en el cliente desde `system_default_fields` ya sincronizado + el diff de toggles). El rodeo Y su plantilla aparecen offline al instante (UNION en `buildRodeosQuery`/`buildRodeoConfigQuery`). Idempotencia NATURAL (sin `client_op_id`: INSERT del rodeo `ON CONFLICT DO NOTHING` → el trigger de seed no re-dispara + UPSERT de toggles → replay = no-op total). Owner-only (`is_owner_of`, espeja `rodeos_insert`) + guard anti-IDOR (autorrevisión: p_id colisionado con rodeo ajeno → 42501, no toca su `rodeo_data_config`). Ver `specs/active/15-powersync/tasks.md` T9.8 + `progress/impl_15-powersync.md` (Run T9.8). Specs reconciliadas (design §1.2 un-defer, tasks T3.3/T9.8). El último write que faltaba offline queda cerrado.

**Origen** (histórico): reviewer de T5/T6 (escritura offline). Drift spec↔código: el design prometía `createRodeo` local; quedó ONLINE. Reconciliado documentando el diferimiento (design §1.2 + tasks T3.3).
**Qué**: crear un rodeo (`rodeos.createRodeo`) sigue requiriendo conexión. A diferencia de `createManagementGroup` (CRUD plano single-tabla, ya offline en T5), `createRodeo` NO es trivial offline: su **plantilla de datos** (`rodeo_data_config`) la **seedea un trigger server-side** (`tg_rodeos_seed_data_config`, 0018) con los defaults del sistema, y luego se aplica el diff de toggles del usuario. Offline el trigger no corre → la plantilla no se arma localmente → el rodeo quedaría sin su config hasta sincronizar, y el diff de toggles no tendría filas que actualizar.
**Por qué importa**: contradice el principio offline-first de Raf ("todo offline menos login/invitaciones/perfil"). PERO crear un rodeo es típicamente **setup** (al dar de alta el campo, con conectividad), no una operación de manga. El leader lo **difirió** por la complejidad real del seeding. **Decisión de Raf pendiente**: ¿aceptable online (setup), o se hace el trabajo de offline?
**Próximo paso sugerido (si se hace offline)**: rework del seeding de la plantilla para offline — opciones: (a) el cliente arma la `rodeo_data_config` completa localmente (defaults del catálogo ya sincronizado + toggles del usuario) y el trigger server usa `ON CONFLICT DO NOTHING` al subir (el cliente gana, sin duplicados); o (b) `createRodeo` por outbox→RPC nueva que haga seed+diff atómico server-side (como register_birth). Ambas tocan backend + Gate 1. Estimar cuando Raf confirme que lo quiere offline.

## 2026-06-05 — Sumar `deno check` de las Edge Functions al pipeline (`check.mjs`)

**Origen**: Gate 2 de feature 13. Un `serverError` se llamaba sin importar en 2 EFs (`invite_user`/`accept_invitation`) → `ReferenceError` en runtime en todo path 5xx. El bug llegó hasta el Gate 2 (en vez de fallar local) porque **`check.mjs` type-checkea solo el cliente (RN/TS), nunca las Edge Functions Deno**.
**Qué**: las EFs (`supabase/functions/**/index.ts` + `_shared/*`) son Deno/TS y NO tienen type-check en el pipeline. Un import faltante, un símbolo mal escrito o un type error solo se descubre al deployar o en runtime.
**Por qué importa**: las EFs corren con `service_role` (admin) y son la capa de auth/invitaciones — un type bug ahí es serio. Hoy la única red es el Gate 2 (tarde) o el runtime (peor).
**Próximo paso sugerido**: instalar `deno` localmente y sumar `deno check supabase/functions/**/index.ts` a `scripts/check.mjs` (y quizás al hook Stop si es rápido). Ojo: `deno` no estaba en el PATH de la máquina de Raf al cierre de esta sesión — requiere instalarlo. Cazaría imports/símbolos faltantes antes del deploy.

---

## 2026-06-13 — Higiene de test: el cleanup del animal suite no captura los grafos complejos de spec 11

**Origen**: cierre de feature 11 (transferencia). Tras aplicar 0087/0088 y correr la suite `transfer_animal RPC` (15 subtests con grafos madre+crías cross-campo), los `animals` huérfanos del remoto subieron de 3 a 36 (~33/run de esa suite).
**Qué**: el `cleanup()` de `supabase/tests/animal/run.cjs` (~líneas 214-242) colecta `animal_id` de `animal_profiles` en los test-establishments y los borra, pero los tests de transferencia crean grafos más complejos (un animal con perfil viejo archivado en X + perfil nuevo en Y + crías/descendencia con vínculos `calf_id`/`bull_id`/`birth_calves` cross-campo) que ese cleanup no limpia del todo → deja `animals` globales huérfanos (tag null, sin perfil — sin colisión ni impacto de sync, pero bloat). **NO es defecto de la RPC**: `transfer_animal` no crea `animals` (reusa el `animal_id` global), así que en producción no orfana nada.
**Relacionado**: misma clase que la nota del implementer sobre el cleanup sin paginar de las suites hermanas (animal/maneuvers/operaciones_rodeo). El leak grande (import, 4006/run) ya se arregló con keyset pagination.
**Por qué importa**: ~33/run reacumula bloat lento en `animals` (acabamos de purgar 829K). No urgente, pero conviene un pase de higiene de los cleanups de test.
**Próximo paso sugerido**: en el cleanup del animal suite, además de los `animal_id` de perfiles en test-ests, capturar los `animals` creados por los helpers de los tests de transferencia (trackear ids creados, o borrar por anti-join `animals` sin perfil cuyo `created_at` cae en la ventana del RUN_TAG). Considerar un helper compartido `selectAllPaged` + tracking explícito de animal_ids creados. Mientras tanto, purga manual ocasional: `DELETE FROM animals a WHERE NOT EXISTS (SELECT 1 FROM animal_profiles p WHERE p.animal_id = a.id);`.

## KpiCard label sin lineHeight explícito (endurecimiento baseline)
- **Origen**: reviewer del delta #8 (%parición-fix), 2026-07-01.
- `app/src/components/reports/KpiCard.tsx:49` — el label (p.ej. "Parición") usa `numberOfLines={1}` sin `lineHeight` explícito matcheado al `fontSize` (patrón que `feedback_descender_clipping` marca como riesgo de recorte de descendentes). Es código **baseline** (no tocado por el delta #8; el capture de #8 confirma empíricamente que hoy NO recorta "Parición"). No es regresión. Endurecerlo (agregar `lineHeight` matcheado) al pasar por reportes de nuevo.

## Test hygiene: INPUT-1 de la animal suite usa un tag fijo `'9'*64` (colisión entre corridas)
- **Origen**: flake que bloqueó el Gate 2.5 de #16 (2026-07-03).
- `supabase/tests/animal/run.cjs` (spec 13 INPUT-1, ~L1941): el test UPDATEa su animal-fixture a `tag_electronic = '9'.repeat(64)` (valor borde del CHECK de 64) esperando que **persista**. Pero el tag es **inmutable** (0036) → el cleanup del test NO puede resetearlo ni borra el fixture → queda un `animals` con `'9'*64`. La corrida SIGUIENTE colisiona en `animals_tag_unique` (23505) en vez de persistir → check.mjs rojo (no es regresión).
- **Workaround aplicado (2026-07-03)**: el leader borró el fixture leftover (`animals` con `'9'*64` + su perfil + 3 eventos de test) por MCP → animal suite 128/128.
- **Fix real (pendiente)**: que INPUT-1 use un tag **único por run** para el borde de 64 (p.ej. `RUN_TAG` + relleno hasta 64) en vez del fijo `'9'*64`, o que el cleanup del test borre el fixture del animal aunque el tag sea inmutable. Así no deja leftover que colisione. Relacionado con el bloat de `animals` huérfanos (otra entrada de este backlog).

## EAS: el perfil `development` no setea `APP_VARIANT=development`
- **Origen**: revisión del leader al wirear `eas.json` a prod (spec 16, Run F d, 2026-07-16).
- `app/app.config.ts` deriva la variante ".dev" (`name: "RAFAQ (Dev)"`, id `ar.rafq.app.dev`, R2.4) de `process.env.APP_VARIANT === 'development'`. Pero `app/eas.json` → `build.development.env` **no** setea `APP_VARIANT`, así que un `eas build --profile development` produciría la app con id/nombre de **prod** (`ar.rafq.app` / "RAFAQ"), no la `.dev` coinstalable.
- **No bloquea el beta**: el APK del peón sale del perfil `preview` (correctamente sin `APP_VARIANT` → id prod). Esto solo afecta al build `development` (dev-client), que hoy se usa vía `pnpm web`/local, no por EAS.
- **Fix (pendiente)**: agregar `"APP_VARIANT": "development"` al `build.development.env` de `eas.json` (o confirmar que el dev-client se buildea siempre local con la var seteada a mano y documentarlo). Verificar antes de depender del build `development` de EAS.

## UX: scroll affordance / scroll cue en pantallas con contenido que cae bajo el fold
- **Origen**: Raf probando el build nativo en iPhone (2026-07-16). En la pantalla de login/registro, contenido queda "muy debajo" y no se ve bien que hay que scrollear (ej. el link/acción de registro queda fuera de vista sin señal de scroll).
- **Qué evaluar (Raf decide alcance)**: agregar una señal de scroll (fade/gradient en el borde, indicador, o rediseño de layout para que el CTA clave entre en viewport). Definir si es SOLO en auth (login/registro) o un patrón a aplicar en TODO el proyecto (pantallas largas / sheets).
- **Estado**: anotado a pedido de Raf; NO tocar ahora. Él evalúa después qué, cómo y dónde. Relacionado con los básicos de UX de sheets/forms ya codificados en la skill design-review.

## ~~Teclado tapa el sheet: `TagScanSheet` queda fuera del fix de clase~~ → CERRADO (unidad «barrida de teclado», 2026-07-27)
- **Origen**: bug 🔴 manga reportado por Raf en device iOS (2026-07-25): al enfocar el input del sheet "Vacunación" el teclado tapa input + chips + sugerencias + los dos CTAs (solo sobrevive el título). Causa de CLASE: ningún bottom sheet del repo tenía keyboard-avoidance (patrón as-built copiado a mano: scrim absoluto + `YStack maxHeight 85%` anclado a `bottom:0`; en iOS el teclado se dibuja encima y no empuja nada).
- **Qué se arregló** (sesión 2026-07-25): primitivo de bottom-sheet keyboard-aware (KAV + header fijo / body `ScrollView flexShrink:1` / footer fijo + condensación con teclado arriba) aplicado a `ManeuverConfigSheet`, `CustomFieldSheet`, `SavePresetSheet`, `BreedPickerSheet`.
- **⚠️ ESTA ENTRADA ESTABA MAL Y HAY QUE APRENDER DE ESO.** Decía *"qué queda: `TagScanSheet`"*, en singular. Eran **SEIS** sheets hechos a mano con input, no uno: `TagScanSheet`, `FindOrCreateOverlay`, `SugerenciaVaciasSheet`, `TreatmentStartSheet`, `TreatmentApplicationSheet`, `LinkCalfPrompt`. Los otros cinco **no estaban registrados en ningún lado**. Y el universo real era más grande todavía: **23 superficies** con campo de texto y CERO mecanismo (7 de ellas 🔴 manga). Consecuencia concreta: un reviewer y el leader aceptaron *"es backlog legítimo"* mirando **1 caso** cuando había 6 — una lista de pendientes incompleta es peor que ninguna, porque se usa como evidencia de completitud. Regla que deja: un pendiente de CLASE se registra con el **criterio** ("todo sheet a mano con input"), no con la instancia que se vio ese día, y se cierra con un **guard que enumere**, no con una lista escrita a mano.
- **Cerrado por**: unidad «barrida de teclado» (2026-07-27) — 20 superficies envueltas con `KeyboardAvoidingShell` + `tabBarHideOnKeyboard` en las tabs + guard **dado vuelta** (`app/src/components/keyboard-avoiding-guard.test.ts` REGLA B): ahora enumera estáticamente todo archivo con entrada de texto y exige que esté clasificado (cubierto / parte / excepción). Un archivo nuevo con un input sin clasificar pone el guard en ROJO.

## Migrar los 6 sheets hechos a mano al primitivo `BottomSheetShell`
- **Origen**: unidad «barrida de teclado» (2026-07-27). Esos 6 sheets ya tienen keyboard-avoidance (se les envolvió el `KeyboardAvoidingShell` directo), pero siguen siendo **copias a mano** del esqueleto del sheet: scrim absoluto + backdrop `Pressable` + `YStack maxHeight 85%`.
- **Los 6**: `src/components/TagScanSheet.tsx`, `app/_components/FindOrCreateOverlay.tsx`, `app/maniobra/_components/SugerenciaVaciasSheet.tsx`, `src/components/TreatmentStartSheet.tsx`, `src/components/TreatmentApplicationSheet.tsx`, `src/components/LinkCalfPrompt.tsx`.
- **Qué se pierden hoy por no estar en el primitivo** (las responsabilidades que `BottomSheetShell` ya encapsula): guard anti "click huérfano" del backdrop en web, arrastre-para-cerrar con detectores disjuntos, **`BackHandler` de Android (ver la entrada dedicada de abajo — es la parte filosa)**, condensación con el teclado arriba, affordance de scroll (peek + fade + chevron) y X de cierre siempre visible.
- **Por qué NO se hizo en la barrida**: migrar 6 sheets a mano cambia estructura, headers, footers y testIDs — convierte una barrida revisable en un refactor de superficie enorme, justo cuando **nada de esto se puede verificar en web** (RNW no monta teclado virtual) y cada ida y vuelta le cuesta a Raf una sesión de device. Decisión explícita del leader: la barrida cierra la CLASE; la adopción es una unidad aparte.
- **Adopción pendiente, aparte**: `app/maniobra/identificar.tsx` encaja en `FooterActionShell` (header + hero `flex:1` + banda inferior) con un refactor chico. Mismo criterio: no se hizo para mantener el wrap mínimo.

## 🔴 El back de Android con un sheet a mano abierto hace POP DE LA RUTA (es la deuda más filosa de los 6)
- **Origen**: reviewer de la unidad «barrida de teclado» (2026-07-27), señalado como *la deuda más filosa* que queda. **Pre-existente** (los 6 sheets tampoco lo tenían en `fc4d164`): no lo introdujo la barrida, que solo les agregó keyboard-avoidance.
- **Qué pasa**: ninguno de los 6 sheets hechos a mano registra un `BackHandler` propio. En Android, el botón/gesto "atrás" con el sheet abierto **no cierra el sheet: hace pop de la ruta**, o sea saca al operario de la pantalla en la que estaba trabajando. El primitivo `BottomSheetShell` sí lo maneja; estos 6 no.
- **Por qué es 🔴 y no un nit**: el peor caso es `app/_components/FindOrCreateOverlay.tsx`, que es un overlay **GLOBAL** montado en `app/app/_layout.tsx:615` — puede aparecer sobre CUALQUIER pantalla, incluida la manga (`maniobra/identificar`, bastoneo). Un "atrás" reflejo con ese overlay abierto no cancela la búsqueda: **desarma la pantalla de abajo**. Es prevención de errores (Nielsen #5) en el flujo 🔴 de manga, con una mano y con guante.
- **No se puede ver desde web**: react-native-web no tiene botón "atrás" de Android. El veredicto es device.
- **Fix**: llega solo con la migración de los 6 al `BottomSheetShell` (entrada de arriba). Si esa migración se difiere otra vez, **al menos** `FindOrCreateOverlay` necesita su `useHardwareBack` propio en el interín — es una superficie global y el costo es una línea.

## 🔓 CLASE ABIERTA — todo contenido anclado al borde inferior que reserva con un token FIJO en vez del hook
- **Estado**: **ABIERTA, sin guard que la vea.** No es una lista de sheets: es un **criterio**. Todo lo que esté anclado al borde inferior (sheet, footer, barra sticky, indicador flotante) y escriba su reserva como un token fijo (`paddingBottom="$6"`, `paddingBottom={24}`) en vez de pedirla al hook compartido, está en esta clase — lo hayamos visto o no.
- **Por qué el guard de la reserva NO la ve**: `utils/safe-bottom-inset-guard.test.ts` prohíbe **re-implementar** la fórmula (un `Math.max(insets.bottom, …)`, un `$navBarGap` suelto). Una **OMISIÓN** —no nombrar el inset en ningún lado— no tiene firma que grepear, así que pasa en verde. Es el mismo modo de falla que tenía el guard del teclado antes de la REGLA B: preguntaba por el uso *incorrecto* de algo en vez de por su *ausencia*.
- **Consecuencia en device**: en Android con barra de 3 botones (inset 48) una reserva de 32 deja el CTA **debajo de la barra del sistema**; un toque bajo con guante cae en "atrás"/"home". En web e iOS casi no se nota → ninguna E2E lo caza.
- **⚠️ LECCIÓN QUE ESTA ENTRADA YA HABÍA INCUMPLIDO**: la versión anterior se titulaba *"quedaban **2** sheets fuera del hook"* — o sea registraba **las instancias que se vieron ese día** en lugar del criterio, exactamente el error que la entrada de arriba (`TagScanSheet`) documenta como lección. Efecto: el reviewer de la barrida barrió las 28 superficies ancladas al borde y encontró una **tercera** (`BulkConfirmSheet`) que la lista de 2 declaraba inexistente por omisión. Retitulada por criterio el 2026-07-27.
- **Instancias encontradas y cerradas hasta hoy** (3 — NO es la enumeración completa):
  - `src/components/TreatmentStartSheet.tsx` y `src/components/TreatmentApplicationSheet.tsx` (unidad «barrida de teclado»): tenían `paddingBottom="$6"` fijo → `useKeyboardAwareBottomInset({ floor: $6 })`.
  - `src/components/BulkConfirmSheet.tsx` (fix-loop de la misma unidad, encontrado por el reviewer): ídem, montado desde `app/seleccion-masiva.tsx` como HERMANO del shell (no sube con el teclado) → `useSafeBottomInset({ floor: $6 })`.
  - Delta de los 3, con el teclado cerrado: **web 32 (idéntico) · iOS 32 → 34 · Android gestos 32 → 48 · Android 3 botones 32 → 64** (`$6` de la escala `space` = 32; los cuatro números están fijados por test en `src/utils/footer-action.test.ts`).
- **PENDIENTE — la enumeración exhaustiva**: nadie barrió el árbol entero con este criterio de forma reproducible. Lo que hay son dos pasadas manuales (implementer + reviewer) sobre las superficies ancladas al borde inferior.
- **Próximo paso sugerido (cerrar la clase, no las instancias)**: regla análoga a la REGLA B del guard del teclado en `safe-bottom-inset-guard.test.ts` — enumerar estáticamente lo anclado al borde inferior (`position:'absolute'` + `bottom`, `justifyContent:'flex-end'`, footers de los shells) y exigir que su `paddingBottom` salga del hook o esté clasificado con motivo. Mientras eso no exista, **esta clase se cierra a mano y por lo tanto no está cerrada**.

## UX nit: los números de orden no se renumeran DURANTE el drag de reorder
- **Origen**: veto visual del leader sobre las capturas del bugfix del auto-scroll (2026-07-25, `design/`-equivalente en `app/e2e/captures/__shots__/reorder-autoscroll/04-*.png`).
- `ManeuverReorderList.tsx` → `SelectedRow` pinta el badge con `{index + 1}`, donde `index` es la posición **commiteada** (prop del padre). Mientras arrastrás, los hermanos SÍ se recolocan visualmente (shared value `positions`), pero sus badges siguen mostrando el número viejo → se ve "9" arriba de "8" en pleno drag hasta que soltás.
- **Pre-existente**, no lo introdujo el clamp del auto-scroll. Impacto: feedback confuso de dónde va a caer el ítem (Nielsen #1), pero el orden final es correcto.
- **Costo del fix**: el badge tendría que leer el shared value `positions` en el hilo de UI → texto animado (no hay `Animated.Text` con contenido reactivo barato en RN; habría que renderizar 10 dígitos superpuestos y togglear opacidad, o bajar el número al JS thread por frame). No vale hoy. Revisar si Raf lo reporta como molesto en device.

## `autoScrollDelta` no acota por el `maxScroll` del ScrollView (latente, no muerde hoy)
- **Origen**: reviewer del bugfix del auto-scroll del drag (2026-07-25), nit 3.
- `app/src/utils/reorder-autoscroll.ts` acota el paso por la VISIBILIDAD de la región (baja mientras el fondo de la región + margen no entre en el viewport), pero no conoce el `contentSize` del ScrollView. Hoy es inocuo: bajo la región siempre hay más contenido (pool + sección de custom + paddingBottom) y `scrollTo` clampea igual (RN acota a `maxRect`; en web `scrollTop` clampea). **Importa si el helper se reusa en una pantalla donde la región reordenable SEA el último contenido** → habría que pasarle `maxScroll` (contentSize − viewportHeight).

## Grip de reorder por debajo del target manga (pre-existente)
- **Origen**: reviewer del bugfix del auto-scroll (2026-07-25), nit 6 — verificado, NO introducido por ese delta.
- `ManeuverReorderList.tsx` → el grip mide ~32px de ancho (`paddingHorizontal="$1"` + icono 24) × 72 de alto: cumple en el eje vertical pero queda por debajo de 60dp en el horizontal. Los labels de fila son `$5` (16px < 18pt del estándar manga). Es la pantalla de configuración del wizard (🟡 mixta), no la manga 🔴, por eso no bloqueó. Endurecer al pasar de nuevo por el wizard.

## `/crear-animal` hereda la presentación modal del flujo de maniobra → sigue descartable por gesto
- **Origen**: bugfix 🔴 manga "el gesto de descarte destruía la jornada" (2026-07-25). Al arreglar `maniobra/jornada`, `maniobra/identificar` y `maniobra/carga` (`presentation:'fullScreenModal'` + `gestureEnabled:false` en `app/app/_layout.tsx`) quedó a la vista el resto del mecanismo.
- **Qué pasa**: expo-router 56 hereda modal hacia adelante (`getModalRoutesKeys.js`: toda ruta posterior a un modal SIN `presentation` explícita se presenta como modal). `/crear-animal` se empuja desde la identificación (find-or-create, R4.1) → en iOS se presenta como page-sheet con dismiss interactivo: un arrastre hacia abajo cancela el alta en curso sin confirmación.
- **Por qué no se arregló acá**: `/crear-animal` se usa desde varios flujos ajenos a maniobra (tab Animales, bastoneo, lista) y cambiarle la `presentation` global toca territorio de spec 02/09; el daño además es acotado (se pierde el alta a medio cargar, no la jornada).
- **Fix candidato**: `presentation:'fullScreenModal'` + `gestureEnabled:false` en `crear-animal` (y barrer las otras rutas empujadas desde un flujo modal: `agregar-evento`, `animal/[id]`, `lote/venta`…), verificando en device que ninguna de esas pantallas dependa hoy del swipe-down para salir.

## La etapa 2 del wizard se re-renderiza entera en cada tecla del preconfig `single`
- **Origen**: reviewer del auto-guardado del `ManeuverConfigSheet` (2026-07-25), F1 — el comentario del código afirmaba lo contrario y se corrigió.
- `jornada.tsx` → `onConfigCommit` tiene un guard de no-op que devuelve el MISMO objeto de estado cuando el valor trimmeado no cambió. Cubre ediciones de solo whitespace y el re-commit idempotente del flush de cierre, pero **no** el modo `single` (inseminación): cada tecla produce un valor distinto → objeto nuevo → re-render de `JornadaWizardScreen`, y con él `StageManeuvers` + `ManeuverReorderList`, que es un function component pelado sin memoizar. Tipear "Toro 456" = 8 re-renders de la etapa 2 completa.
- **Por qué no se arregló**: el costo real en device no está medido, la lista está tapada por el scrim mientras el sheet está abierto, y un `React.memo` con props de callback no memoizados no aportaría nada. Medir primero en device de gama baja; si molesta, memoizar la lista Y estabilizar sus callbacks en el mismo movimiento.

## Chips de "Usadas antes" por debajo del target manga (pre-existente)
- **Origen**: reviewer del auto-guardado (2026-07-25), observación 2.
- Los chips de autocompletar (`ManeuverConfigSheet`) miden ~36px de alto (`fontSize $4` + `paddingVertical $2`), por debajo de los 44 del mínimo iOS. Son el **gemelo constructivo** de la × del chip de vacuna, que en esta misma tanda se subió a 44×44 por estar bajo target — se agrandó una y no la otra.
- No bloqueó porque el wizard es pantalla 🟡 mixta y porque tocar el alto del chip de sugerencia afecta el wrap de la fila. Endurecer al pasar de nuevo por el sheet.

## Una coma dentro del nombre de una vacuna se parte en dos
- **Origen**: reviewer del auto-guardado (2026-07-25), observación 3.
- El preconfig multi persiste como string separado por comas (`joinMultiPreconfig`/`splitMultiPreconfig`), así que un valor con coma adentro ("Man,cha") se guarda como dos vacunas. Con el commit diferido la divergencia era invisible; con auto-guardado el chip muestra uno solo mientras la fila de atrás **ya muestra dos**, en vivo.
- **Pre-existente** (limitación del formato, no del auto-guardado). Cosmético hoy. Fix real = cambiar el formato de persistencia a un array JSON, lo que toca el round-trip con `maneuverDetail` y los presets ya guardados → migración. No vale hasta que alguien cargue una vacuna con coma.

## `TactoConfigSheet` quedó como el único sheet de la lista con Guardar/Cancelar
- **Origen**: reviewer del auto-guardado (2026-07-25), observación 4.
- El argumento que justificó auto-guardar los DOS modos de texto libre fue consistencia (Nielsen #4: dos sheets abiertos desde la misma lista no pueden comportarse distinto). Ese mismo argumento ahora apunta a `TactoConfigSheet`, que se abre desde la MISMA lista con el MISMO gesto y conserva commit diferido con Guardar/Cancelar.
- **No es equivalente**: el tacto configura un booleano ("¿medir tamaño?"), no texto libre acumulable — no hay "agregar" que ya sea el commit, y el descarte silencioso por scrim pierde un toggle, no cuatro vacunas cargadas a mano. Por eso quedó fuera del alcance que aprobó Raf. Decidir si se unifica la próxima vez que se toque el wizard.

## El peek del `BottomSheetShell` sobre chips puede leerse como "deshabilitado"
- **Origen**: veto visual del leader sobre `app/e2e/captures/__shots__/sheet-arrastre/06b-vacunacion-alto-recortado-peek.png` (2026-07-25).
- El affordance de scroll del shell (peek + degradado + chevron ▾, vía `shouldShowScrollPeek`) funciona bien sobre texto, pero al caer sobre **chips de color sólido** el degradado baja su opacidad, y opacidad reducida es la convención universal de "deshabilitado". Un operario podría leer las últimas vacunas como inactivas en vez de "hay más abajo".
- **No se cambió a propósito**: el chevron desambigua, y el affordance sale de la misma función pura que usan `FooterActionShell` y las listas de maniobra — inventar uno distinto solo para este sheet rompería la consistencia, que es peor que la ambigüedad. Revisar si Raf lo reporta como confuso en device.

## `tasks.md` de spec 03 tiene dos entradas "As-built v3" (pre-existente)
- **Origen**: chequeo de colisión de numeración del leader (2026-07-25) al reconciliar dos deltas en paralelo.
- `specs/active/03-modo-maniobras/tasks.md:184` (guardar-rutina, 2026-06-16) y `:185` (iteración UX 2, 2026-06-14) están ambas rotuladas "As-built v3". En `design.md` la primera figura como **v3-bis**, que es el rótulo correcto por fecha.
- No lo introdujo esta tanda y no confunde a nadie hoy (cada entrada cita su fecha y su sección de design). Alinear el rótulo de `:184` a v3-bis la próxima vez que se toque el archivo, sin cascada de renumeración.

## `maniobra-carga.spec.ts` 2/3 en rojo en HEAD desde el 10/07 (pre-existente, nadie lo reportó)
- **Origen**: revisión final de los bugfixes de gesto/auto-guardado (2026-07-25). El reviewer lo reprodujo **dos corridas consecutivas** — no es flake, y **no está en el diff** de esa tanda.
- **Síntoma**: los tests `:133` y `:277` mueren esperando `'· 1 de 2'`; el snapshot muestra `Pesaje · 1 de 1`.
- **Causa raíz**: `appliesToAnimal('tacto', …)` (`app/src/utils/maneuver-applicability.ts:167-177`, commit `a2354d9` del 2026-07-10, gating de tacto) limita el tacto de preñez a hembras **servidas**, pero el spec siembra una `vaquillona` pelada (`maniobra-carga.spec.ts:154-158`, último toque `5c658ff` del 09/07) con un comentario ya obsoleto: *"Hembra (el tacto aplica a hembras)"*. El gating cambió y el fixture no.
- **Por qué pasó desapercibido**: `maniobra-carga.spec.ts` no está en la lista de e2e que corre `check.mjs`, así que el verde de RC=0 nunca lo tocó. Vale revisar qué otros specs quedaron fuera de esa lista.
- **Fix candidato**: sembrar el fixture con `reproStatus` servida (o categoría probada) y actualizar el comentario. Barato; se dejó afuera por disciplina de alcance — es de spec 03 M2, no de estos bugfixes.

## El guard de worklets cubre la FIRMA que crasheó, no la CLASE del bug
- **Origen**: reviewer del fix del crash de worklet (2026-07-25), N1 — no bloqueante, el guard cumple su objetivo declarado.
- `app/src/components/worklet-callbacks-guard.test.ts` escanea **texto, línea por línea**, con una regex sobre `runOnJS(X.y)` / `scheduleOnRN(X.y)`. El reviewer probó bypasses reales contra la regex: `runOnJS(\n Keyboard.dismiss,\n)` multilínea, `import { runOnJS as ruj }`, `const f = Keyboard.dismiss; runOnJS(f)`, `runOnJS(obj["method"])`, y las dos que más importan: **`Keyboard.dismiss()` llamado directo adentro de un worklet** y **`Dimensions.get('window')` adentro de un worklet**.
- **Por qué importa**: la clase real del bug no es "`runOnJS` con un método de módulo", es **"leer cualquier propiedad de un objeto no-plano capturado en un worklet"** — el serializador lo reemplaza por un Proxy que tira ante cualquier acceso, y en release eso es un abort sin log.
- **Fix candidato** (del reviewer): escanear sobre el AST del archivo **compilado**, donde `__closure` ya está resuelto, en vez de sobre el texto fuente. Ahí se ve exactamente qué objetos captura cada worklet y se puede prohibir la clase entera. Hoy no urge: no hay alias de `runOnJS` en el árbol y la cobertura de raíces (`app/app` + `app/src`) es correcta.

## La contención de errores en worklets es local a `BottomSheetShell`
- **Origen**: reviewer del fix del crash (2026-07-25), N4.
- El `try/catch` que evita que una excepción en un worklet mate la app entera está solo en los 5 callbacks del gesto del shell. Siguen SIN contención los **9 worklets** de `ManeuverReorderList.tsx` (incluido el que llama `measure()` y `scrollTo()`) y los **2** de `WheelPicker.tsx` — superficie 🔴 manga del mismo wizard.
- `docs/design-system.md` dice "replicá ese patrón en cualquier gesto **nuevo**", así que no hay contradicción con el as-built, pero el riesgo residual existe y es de la misma familia que el crash que Raf cazó en device.

## Los `catch` de worklets degradan en SILENCIO en release
- **Origen**: reviewer del fix del crash (2026-07-25), N5.
- En release, si un worklet del gesto tira, el `catch` lo degrada a "el gesto no responde" y no queda ningún rastro: ni log, ni métrica, ni aviso. En campo eso es un operario diciendo "el grabber dejó de andar" sin nada que correlacionar.
- **Candidato a enganchar con spec 17 (observabilidad)** cuando exista un canal barato desde el hilo de UI. Antes de eso, cualquier intento de loguear desde el worklet agrega justamente el tipo de llamada que causó el crash original.

## Los gestos del sheet se reconstruyen en cada render (pre-existente)
- **Origen**: reviewer del fix del crash (2026-07-25), N8 — verificado pre-existente, ya estaba en el commit anterior.
- `buildDragGesture` depende de `onClose` (`BottomSheetShell.tsx:513`) y 3 de los 4 call-sites pasan una arrow NUEVA por render (`animal/[id].tsx:1123`, `crear-animal.tsx:894`, `editar-plantilla.tsx:423`) → los dos `Gesture.Pan()` se reconstruyen y los 5 worklets se re-serializan en cada render.
- No es bug de correctitud (RNGH actualiza in-place) y el costo no está medido. Se cierra estabilizando los `onClose` de los consumidores con `useCallback`, no tocando el shell.

## Acoplamiento `__DEV__` (JS) ↔ `NDEBUG` (C++) en el re-throw de los worklets
- **Origen**: reviewer del fix del crash (2026-07-25), N6 — escenario angosto, de tooling.
- El `catch` de los worklets re-lanza cuando `__DEV__`, apoyándose en que ahí existe el `callGuardDEV` de Reanimated que lo convierte en LogBox. Eso vale para los perfiles normales (EAS development = Debug + `__DEV__`; preview/production = Release + `!__DEV__`).
- **Rompe** en un binario compilado en Release sirviendo un bundle de dev (`expo run:ios --configuration Release` contra Metro): ahí `__DEV__===true` pero **no hay** `callGuard` (`WorkletRuntime.h:54-64`, `#ifndef NDEBUG`) → el re-throw abortaría igual que el crash original. Tenerlo presente si alguna vez se depura en esa combinación.

## Build local de Android: cadena armada y funcionando, pero impracticable en esta máquina
- **Origen**: sesión 2026-07-25. Raf preguntó por qué dependemos de EAS; se armó la cadena local para sacarle a Android la dependencia de la cuota (iOS es imposible localmente: necesita Xcode, que solo corre en macOS).
- **Lo que YA quedó hecho en la máquina de Raf** (no hay que rehacerlo):
  - SDK en `%LOCALAPPDATA%\Android\Sdk` — cmdline-tools `15859902` (descarga verificada contra el SHA-256 publicado), `platforms;android-36`, `build-tools;36.0.0`, `platform-tools` r37, licencias aceptadas.
  - JDK 17 (Amazon Corretto, `C:\Program Files\Amazon Corretto\jdk17.0.15_6`) ya estaba instalado y en el PATH.
  - **`JAVA_HOME` global apunta a JDK 1.8 y NO se tocó a propósito** (Raf lo necesita para el trabajo del banco). El build debe setear `JAVA_HOME` por invocación.
  - `app/android` e `app/ios` están gitignored (generación nativa continua) → hay que correr `expo prebuild --platform android` antes de compilar. **OJO**: `prebuild` reescribe los scripts `android`/`ios` de `package.json` de `expo start --X` a `expo run:X`; hay que revertirlo o el cambio se cuela al commit.
- **Verificado ejecutando**: Gradle 9.3.1 corre sobre Corretto 17, el proyecto resuelve dependencias y llega hasta `outputs/sdk-dependencies/release`. La configuración está sana. El release firma con la keystore de debug (default de la plantilla, sirve para distribución interna) y `app/.env.local` apunta al MISMO proyecto DEV que el perfil `preview-dev` de EAS.
- **Por qué se abandonó por ahora**: ningún intento llegó al APK. El antivirus corporativo escanea cada archivo (un `du` sobre el caché de Gradle no terminó en 2 minutos) y los procesos largos en segundo plano se cortaron **tres veces**. Cada corte dejó un demonio de Gradle huérfano; llegaron a ser 3 compitiendo por RAM (`./gradlew --stop` los limpió).
- **Si se retoma**: compilar solo `arm64-v8a` (`-PreactNativeArchitectures=arm64-v8a`, saca 3/4 del trabajo de C++), usar `--no-daemon` para no dejar huérfanos, y correrlo cuando nadie espere el resultado. Gradle es incremental, así que lo ya compilado en `app/android/app/build` se reaprovecha.

## 2026-07-26 — `check.mjs` verde NO cubre la suite E2E (y 22 rojos pre-existentes, 6 con un bug de oráculo común)

**Origen**: unidad «aire» (safe-area del borde inferior). Se dio por sentado que el semáforo `node scripts/check.mjs` incluía la suite E2E; no la incluye.

**Qué** (verificado, no supuesto):
- `scripts/check.mjs` y `scripts/run-tests.mjs` tienen **CERO** referencias a `e2e` / `playwright`. El RC=0 cubre: lint anti-hardcode, typecheck del cliente, unit de scripts, unit del cliente, y las ~17 suites de backend contra Supabase. **Nada de Playwright.**
- Corrida completa de `pnpm e2e` (269 tests, build fresco, ~38 min) en esa unidad: **247 passed / 22 failed**. Los 22 se atribuyeron **empíricamente** contra un worktree en el baseline (mismo build, mismos specs) → **todos pre-existentes**, ninguno de la unidad.
- De esos 22: **14 son la deuda ya conocida** del fixture desfasado del gating del tacto (`maniobra-carga` ×2, `preview-transicion` ×2, `tacto-adaptativo` ×4, `tacto-bugfix` ×3, `vacias-lote` ×3 — ver el ítem "el fixture del tacto quedó desfasado" más arriba).
- Los **6 restantes** (`animals-offline:73`, `animals:397`, `cut-ficha:54`, `events:703`, `lotes:61`, `treatments:36`) son un patrón **distinto y nuevo para el registro**: `getByText(...).first()` matchea un elemento **oculto de la pantalla de fondo** —react-navigation web deja la pantalla anterior montada con `display:none`— en vez del visible de la pantalla de arriba. Es un **bug de ORÁCULO del test**, no de la app; misma familia que la memoria `reference_e2e_sheet_no_nav_oracle`. Fix candidato: `.first()` → filtrar por visibilidad (`locator(':visible')` / `getByRole` con el scope de la pantalla activa).

**Por qué importa**: dos cosas distintas. (1) Cualquiera que lea "check verde" cree que la regresión E2E está cubierta y no lo está — hay que correr `pnpm e2e` aparte y atribuir los rojos a mano. (2) Con 22 rojos crónicos la suite dejó de ser un semáforo: no se distingue una regresión nueva del ruido de fondo sin re-correr el baseline (40 min por vuelta).

**Próximo paso sugerido**: nada acá (registro). Cuando se procese: decidir si la E2E entra a `check.mjs` (con un presupuesto de tiempo aparte, no en el camino del RC=0 de cada sesión) y limpiar las dos familias de rojos — el fixture del tacto y los 6 `.first()`.

## 2026-07-26 — comentario mentiroso en `export-sigsa`: la lista NO scrollea por detrás del sticky CTA

**Origen**: revisión de la unidad «aire» (hallazgo D3 del reviewer). **Ya era falso en el baseline** — no lo
introdujo esa unidad y no se arregló ahí (scope).

`app/app/export-sigsa.tsx:335-336` dice *"La lista scrollea **POR DETRÁS** del sticky CTA → padding inferior
generoso para que la última fila no quede tapada por la barra"*, y por eso el `contentContainerStyle` reserva
`insets.bottom + $10` cuando hay footer. Pero la barra **no** está superpuesta: es un **hermano flex** que se
renderiza DESPUÉS del `ScrollView` (`{footer ?? null}`, `:344-345`) dentro del mismo `YStack`, así que ocupa su
propio alto y el scroll termina arriba de ella. El padding extra no compensa una oclusión — es aire de más
(≈60px con footer) al final de la lista.

**Por qué importa**: es la clase de comentario que hace nacer bugs por copia (igual que el `max(inset, mínimo)`
que se copió 25 veces). El próximo que arme una pantalla con footer va a replicar el `+ $10` "porque la barra
tapa", y no tapa.

**Próximo paso sugerido**: corregir el comentario y decidir si el `$10` se justifica como slack de lectura
(probablemente sí, pero por otra razón) o baja a `$6` como el resto. Cambio cosmético, verificar en captura.


## 2026-07-26 — migrar el teclado de `useAnimatedKeyboard` a `react-native-keyboard-controller`

**Origen**: unidad «teclado Android» (el teclado tapaba el sheet entero en Android). El fix usa
`useAnimatedKeyboard` de Reanimated 4.3.1 para obtener el alto real del IME, y **ese hook está marcado
`@deprecated`** en la propia librería, que apunta a `react-native-keyboard-controller`.

**Por qué se eligió igual (decisión tomada, no omisión)**: deprecated ≠ roto — el hook funciona en la 4.3.1
que ya está instalada y su nativo hace exactamente la corrección que RN no hace bajo edge-to-edge
(`isNavigationBarTranslucent` → no le resta la barra de navegación al inset del IME). La alternativa es
meter un **módulo nativo nuevo** a validar contra RN 0.85 + new arch + Expo 56, justo en la ventana en la
que iOS no se puede re-testear en device (hasta el 1/8). Costo/riesgo desbalanceado para un bugfix 🔴.
Además el fix es **cero dependencias nuevas**.

**Qué mirar cuando se procese**:
- `react-native-keyboard-controller` reemplaza el hook por `useKeyboardHandler` / `KeyboardAvoidingView`
  propio y trae el mismo dato con soporte declarado a largo plazo.
- El cambio queda **acotado a UN archivo**: `app/src/components/KeyboardAvoidingShell.android.tsx`. Eso es
  precisamente lo que compra el primitivo — el guard `keyboard-avoiding-guard.test.ts` impide que el
  patrón se vuelva a repartir por la app.
- Disparadores para hacerlo antes: que Reanimated ELIMINE el hook en una major, o que aparezca un caso que
  el hook no cubra (p. ej. montar con el teclado ya abierto — hoy arranca en 0 hasta el próximo evento de
  insets, que es **paridad con el `KeyboardAvoidingView` de iOS**, no una regresión).

**Próximo paso sugerido**: nada urgente. Re-evaluar al próximo bump de Reanimated o si el veredicto de
device destapa un caso no cubierto.

## Guard faltante: un test que no está en la lista de `run-tests.mjs` NUNCA corre
- **Origen**: leader, 2026-07-27, durante la unidad «barrida de teclado».
- `scripts/run-tests.mjs` corre los unit del cliente con una **lista explícita de archivos, sin glob**. Su propio comentario lo advierte: *"un test que no figure acá NUNCA corre"*. La defensa hoy es la disciplina de quien agrega el test.
- **Estado actual: limpio** — 135 archivos `*.test.ts(x)` bajo `app/`, los 135 registrados (medido). No hay defecto vivo; falta la red.
- **Por qué importa**: es la misma clase que los tres bugs de esta serie — **un test que no se ejecuta se ve idéntico a un test que pasa**. Y pega justo donde más duele: los 5 guards estáticos son la ÚNICA cobertura de bugs que la E2E no puede ver desde web (teclado, safe-area, worklets). Un guard que no corre da falsa confianza, que es peor que no tenerlo.
- **Fix**: un test que enumere `app/**/*.test.ts(x)` y asserte que cada uno aparece en la lista de `run-tests.mjs`. Barato. Falsificarlo agregando un test suelto → rojo.
- **Emparentado** con la auto-verificación de cobertura que esta unidad agregó a los guards (que asserten cuántos archivos escanearon y que el blanqueo no se coma el archivo).

## 🔴 Las invitaciones NO funcionan: el link apunta a un dominio que no existe
- **Origen**: Raf, device iPhone real, 2026-07-27. Invitó desde el Android y el link abrió Safari en `app.rafq.ar` → *"Safari can't open the page because the server can't be found"*.
- **Estado verificado ese día**: `nslookup app.rafq.ar` → **Non-existent domain**. El dominio nunca se compró. `INVITE_BASE_URL = 'https://app.rafq.ar'` (`app/src/services/members.ts:45`) y el mismo default en el `APP_URL` de `invite_user` / `resend_invitation`.
- **No se manda mail** (modelo ADR-014: `sendInvitationEmail` se eliminó, el owner reparte el link por WhatsApp) → el único artefacto es el mensaje que arma `ShareLink`, y contiene una URL muerta.
- **Agujero mayor al dominio**: la app **no está en tiendas**. Aunque el dominio existiera, el invitado no tiene de dónde instalarla. Cualquier flujo por link necesita una landing que hoy no existe.
- **Lo que SÍ funciona**: la mitad receptora. `parseInviteToken` acepta el token crudo (UUID suelto) además de la URL, y está testeado.
- **DECISIÓN DE RAF (2026-07-27): no se arregla ahora.** Es sub-tarea del rebrand y se resuelve entera cuando desbloquee el nombre (dominio + deep links + submit a tiendas de una). Se descartaron el arreglo interino (compartir código + instrucciones en vez de link) y comprar el dominio bajo el nombre viejo.
- **LA LECCIÓN, que es lo que hay que no repetir**: esto estaba registrado desde el 2026-07-22 como *"U8a (deep links) DIFERIDO"* y sobrevivió semanas sin que nadie lo mirara. Las dos frases describen el mismo hecho, pero **solo una te hace mirarlo**:
  - "U8a (deep links) diferido" → suena a mejora pendiente.
  - "las invitaciones son inusables" → suena a lo que es.
  **Un diferimiento se nombra por su CONSECUENCIA para el usuario, no por la tarea técnica que queda pendiente.** El encuadre viejo incluso llevó a escribir en este mismo archivo que "no es MVP-blocker porque el camino usable hoy es pegar el link, que anda" — asumiendo que el destinatario pegaría en vez de tocar. Corregido in-place más arriba.

## La salida del vacío de `asignar-caravanas` es descriptiva, no accionable
- **Origen**: veto de diseño del leader (2026-07-29), sobre el fix "sin transporte el copy dice la verdad".
- El vacío sin bastón dice *"Podés cargar las caravanas de a una desde la ficha de cada animal"* — **cierto y verificado** (esa salida tiene E2E verde en `baston-ficha.spec.ts` con oráculo de server), pero **te la describe en vez de llevarte**. En una pantalla 🔴 de manga, Nielsen #3 (control y libertad) pide dar la salida, no explicarla.
- **No bloqueó el fix** y la mejora respecto del baseline es grande (antes decía *"Bastoneá para empezar"* para siempre, sin bastón posible). Esto es el escalón siguiente.
- **Por qué no se hizo ahí**: decidir a dónde navega es una decisión de producto aparte (¿a `/(tabs)/animales`? ¿al buscador con un filtro de "sin caravana"?), y el ahorro real es ~1 paso de ~4 — no es obvio que gane. Requiere pensarlo, no tipearlo.
- **Contraste verificado en la captura** (`11-masiva-sin-transporte-vacio-honesto.png`): título 18,36:1 · las dos líneas de apoyo 5,74:1, sobre AA. No hay deuda de accesibilidad en ESTE copy — la deuda de `$textFaint` es la entrada aparte.

## 2026-07-30 — MEDIUM-3 del Gate 2 del SPP: acumuladores sin cota en el camino de ingesta

**Origen**: `progress/security_code_04-spp-bloqueantes.md` (MEDIUM-3). Pre-existente; el fix-loop lo dejó afuera por decisión del leader.
**Qué**: ni el `StringBuffer` del nativo ni `LineFramer.push` (`line-framer.ts:19-20`, vivo en `adapter-web-serial`) tienen cota de largo. Un lector que escupa basura sin terminador los hace crecer sin límite, y el payload de `onDataReceived` llega a `splitSppPayload` **sin cota previa** (el formato lo acota después `^1000000(\d{15})\d{12}$`, pero el string ya se construyó).
**Por qué importa ahora más que antes**: R6.4 abre el canal **sin gesto** en cada apertura, así que la ventana de exposición dejó de depender de que alguien toque algo. Sigue siendo MEDIUM y no HIGH porque el RFCOMM es `secure: true` (exige emparejamiento previo), o sea que el peer tiene que estar bondeado con el teléfono.
**Próximo paso sugerido**: cota + descarte con log en los dos framers, con test. Es el mismo ítem que ⚪-3 de la review anterior; queda unificado acá.

## 2026-07-30 — Tres cosas que el fix-loop del SPP dejó anotadas (con el mecanismo escrito, para no re-derivarlo)

**Origen**: review + Gate 2 del fix-loop (`progress/review_baston-spp-bloqueantes.md` ⚪-K, más un nit del leader). Ninguna es alcanzable hoy; las tres son la misma clase (un guard escrito sobre la instancia y no sobre el invariante).

1. **`canCloseOrphanSocket` pregunta por la GENERACIÓN, no por la DIRECCIÓN** (⚪-K). El predicado actual es *"¿sigo siendo la generación vigente?"*, que es lo correcto cuando el intento nuevo va a la **misma** MAC (el nativo reusa la conexión existente, así que cerrarla le mataría el socket al que conectó). Pero con **direcciones distintas** —el operario elige otro bastón mientras el primero está abriendo— el socket huérfano de A queda **abierto y sin nadie drenando su `StringBuffer`**, que no tiene cota: la próxima reconexión a A se come su primera trama, que es el mecanismo exacto de BENCH-2. **El predicado que lo cierra, para no re-derivarlo**: cerrar también cuando la dirección del intento viejo **no** es la del vigente, o sea `this.closed || gen === this.connectGeneration || !sameAddress(target, this.inFlightTarget)`. Hoy no es alcanzable porque el único camino que cambia de dirección con un intento en vuelo (`pendingTarget`) hace `teardownStreams()` antes de abrir el nuevo.
2. **`onChooseDevice` escribe el `vendorId` del driver en la clave del bastón recordado, no una MAC** (`StickConnectionScreen.tsx`, la fila de capacidad de build del camino web/iOS). Era inocuo mientras nadie leía esa clave sin gesto; **R6.4 ahora la lee para auto-conectar**, así que si esa fila vuelve a ser accionable en un camino con `spp-android` montado, el arranque intentaría conectar a `"allflex-rs420"` y **moriría en silencio** (el nativo rechaza la MAC inválida, el error se captura, y el operario ve "no encontramos el bastón"). El comentario de ahí dice *"cuando el adapter SPP real aterrice, recordará la MAC"* — **ya aterrizó** (`dad711f`). **El invariante que hay que guardar** (el guard de esta unidad se escribió sobre `onChoosePaired`, que es la instancia arreglada, y no sobre esto): *nadie escribe la clave del bastón recordado antes de `'connected'`, y lo que se escribe es una MAC*. Cerrarlo es sacar esa escritura (el adapter ya persiste al conectar) + un guard de fuente que enumere **todas** las escrituras de la clave.
3. **Awaits de primitivas nativas sin techo, pre-existentes** (inventario del guard nuevo). `feedback-pref.ts` (escritura best-effort de una preferencia) y, fuera del territorio de spec 04, `establishment-store.ts`, `last-rodeo.ts`, `lockout-store.ts`, `pending-invitation.ts`, `rodeo-store.ts` — todos `await SecureStore.setItemAsync/deleteItemAsync` sin presupuesto. Ninguno está en un camino donde colgarse deje al operario sin poder hacer algo (eso era el caso del `signOut`, ya cerrado), pero son la misma clase. El mecanismo ya existe y es reusable: `withTimeout(…, DEFAULT_BRIDGE_TIMINGS.storage, '<label>')`, con el techo puesto **en el borde** que hace la llamada nativa y no en cada call site.
**Por qué importa**: las tres son "el guard cubre la instancia que arreglamos, no el invariante". Es el modo de falla que esta feature repitió cuatro veces.

## 2026-08-01 — Dos preguntas a SENASA que pueden cambiar la forma de la feature 08

**Origen**: re-verificación regulatoria de la sesión de modelo de negocio (`specs/active/08-export-sigsa/research-findings.md` §8 y §9). Ninguna de las dos es investigable con fuentes públicas: las dos se cierran con un mail a `hacelafacil@senasa.gob.ar` (el contacto técnico que el propio SENASA publica).

**1. ¿Existe una API y podemos usarla?** El manual de gestión de token de SENASA dice literal que el mecanismo *"permite crear una 'llave de acceso' segura y temporal para que **otras aplicaciones externas** puedan interactuar con la información registrada en el sistema oficial del Senasa"*, con permisos delegables de *"gestionar microchips de identificación y consulta de movimientos"*. Eso implica que hay una API detrás de SIGBIOTRAZA, y **contradice el supuesto "no hay API, el productor sube el archivo a mano" que atraviesa toda la spec 08**. La especificación no es pública (§9.7).
**Por qué importa más de lo que parece**: si la API existe y es accesible, 08 deja de ser "generá un archivo y andá a subirlo" y pasa a ser "declarás desde la app". Es otro producto — desaparece el paso manual que es justamente la fricción que hoy vendemos como resuelta a medias, y el moat se profundiza (SIGBIOTRAZA obliga a tipear raza/sexo/fecha en la manga; nosotros ya tenemos esos datos). No hace falta decidir nada: hace falta preguntar.

**2. ¿La TRI es obligatoria o no?** Discrepancia sin resolver: el manual oficial (dic-2025, pág. 8) dice literal que *"El RENSPA de origen puede optar (**no es obligatorio**) por confeccionar la TRI"*; la prensa del memorándum ME-2026-66264109 (jul-2026) dice que el sistema la exige. **El texto del memorándum no está publicado** y los tres manuales relevantes siguen con `Last-Modified: 7/1/2026`, o sea sin actualizar tras el memo (§9.2).
**Por qué importa**: de la respuesta depende si el delta de TRI (un TXT de RFIDs separados por espacio, barato) entra al scope de 08 o queda afuera. Comprometer scope sobre una nota de prensa es exactamente el error que ya nos costó el falso "deadline julio 2026" (§6 del mismo research).

**Riesgo de no preguntar**: bajo en lo inmediato, alto en lo estructural. Se puede lanzar sin las respuestas, pero la #1 puede volver obsoleta una parte del diseño de 08 y conviene saberlo antes de tratarla como `done`.

## 2026-08-02 — El build de EAS empaqueta basura del disco local y por eso NO devuelve un APK instalable

**Origen**: builds para las diseñadoras (sesión 2026-08-02). Arrancó como "el archive pesa 1.1 GB y el upload tarda 2m02s" (lo avisa el propio CLI) y terminó siendo un defecto con consecuencia visible.

**El síntoma que importa**: el build `3fb6b079` NO produjo un `.apk`, produjo un **`.tar.gz` con DOS APKs adentro** — y un `.tar.gz` no se instala desde un teléfono, así que **el link de EAS deja de servir para repartir el build**:

```
release/app-release.apk   121.036.467 B   2026-08-02 20:45   <- el de hoy, correcto (ar.rafq.app 0.1.0)
debug/app-debug.apk       264.777.703 B   2026-07-29 09:37   <- del 29/7, del disco de Raf
```

**La causa, verificada byte a byte**: `app/android/app/build/outputs/apk/debug/app-debug.apk` existe local con **exactamente** ese tamaño y ese timestamp. O sea **`app/android/` viaja a EAS aunque esté gitignoreado y tenga 0 archivos trackeados** — el `.gitignore` no gobierna el archive de EAS. EAS compiló su release, encontró el debug viejo ya presente en `outputs/`, y al haber dos APKs los empaquetó en un tar en vez de devolver el APK pelado.

⚠️ **Corrige una afirmación anterior de esta misma entrada**, que decía que `app/android/` "en teoría no viaja" y mandaba a medir de nuevo. Viaja. La hipótesis obvia era la correcta.

**Dos consecuencias, no una**:
1. **Reparto roto** (la que se siente): sin APK pelado no hay link instalable; hay que bajar el tar, extraerlo y subir el APK a otro lado.
2. **Riesgo de build sucio** (la peor): si `android/` viaja, EAS **usa el prebuild local en vez de regenerarlo**. Cualquier resto en el árbol de Raf entra al build, y cualquier cosa que él haya tocado a mano ahí es un input invisible que no está en git. Es la clase de "el verde no es del código que creés" que este proyecto ya comió varias veces.

**Cómo se cierra**: lo barato es borrar los `outputs/` viejos antes de buildear (1 APK → artifact `.apk` → link funciona). Lo correcto es un **`.easignore` que excluya `android/` e `ios/`** para forzar prebuild limpio en la nube. Ojo con el segundo: `.easignore` **reemplaza** al `.gitignore` para el archive, así que hay que re-listar `node_modules/`, `.git/`, `dist/`, `.expo/` y demás o el archive crece en vez de achicarse. Verificar después que el artifact vuelva a ser `.apk` y que los permisos del bastón sigan en el manifiesto (`aapt2 dump permissions`).


> **CERRADO 2026-08-02** con `.easignore` en la raíz del repo (commit abajo). Medido con
> `eas build:inspect --stage archive`, que copia el archive sin gastar un build:
> **3.9 GB → 72 MB**, upload **1m42s → 5s**, `app/android/` queda como directorio vacío → prebuild
> limpio en la nube. Build de verificación `f2f1eb16`: artifact `.apk` (no `.tar.gz`), permisos del
> bastón intactos (`BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`+`neverForLocation`, los tres topeados a
> SDK 30), backend DEV. **El APK pesa 121.036.491 bytes, idéntico al del build anterior hecho con el
> prebuild local**: compilar sin `android/` da el mismo binario, así que el prebuild local nunca
> aportó nada al resultado — solo upload y riesgo.
> Ojo al editar el `.easignore`: **reemplaza** al `.gitignore`, así que sacar una línea no la ignora,
> la SUBE. `.git/` sobrevive parcialmente (35 MB) porque EAS lo usa para resolver el commit del build.


---

## `/baston` cuenta como consumidor del bastón aunque no tenga el foco

**Abierto 2026-08-06** — 🟡-H del review de la unidad «dos 🔴 del barrido de edge cases del bastón».
**Diferido por alcance**, no por prioridad: el archivo (`app/src/features/ble-stick/screens/StickConnectionScreen.tsx`)
lo estaba editando la unidad hermana sin commitear.

`StickConnectionScreen` toma la propiedad exclusiva del listener con `useFocusEffect` —o sea, **al
enfocarse**— pero se **suscribe** a las lecturas con `useEffect([api])`, o sea **al montarse**. Las dos cosas
no son lo mismo en un Stack: la pantalla queda montada cuando le empujan otra encima.

**La consecuencia** (que es cómo hay que nombrarlo): mientras `/baston` esté en el stack, aunque el peón
esté dos pantallas más adelante, **cuenta como consumidor**. Por lo tanto `read_dropped_no_consumer` no
puede dispararse, y una lectura puede aterrizar en una lista que nadie está mirando. **No hay dato perdido
ni confirmación falsa** —la pantalla sí la muestra, y si volvés está ahí—, así que no es el 🔴-2 de vuelta;
es la misma clase de divergencia (montado ≠ dueño) del otro lado de la tabla.

**Cómo se cierra**: que `/baston` declare un `accepts` atado a su foco (el mismo `useFocusEffect` que ya
usa para el scanner acotado), y pase de `'always'` a `'declares-accepts'` en la tabla `CONSUMERS` de
`app/src/services/ble/read-dispatch.test.ts`.
