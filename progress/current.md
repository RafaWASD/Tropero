# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## 2026-07-29 — UNIDAD «el bastón funciona de verdad en Android» (implementer) — LISTA para review

Base `6d1fd74`. Pedido de Raf tras el fix cosmético anterior: *"Te pedí que lo desarrolles no que lo
escondas. Quería desarrollo completo de Bluetooth y conectar bastón para android"*. Cierra **T-MV.5.1**
(el veto de compatibilidad, que estaba `[ ]` con "RIESGO ALTO NO RESUELTO") y **T-MV.5.5** (montar el
adapter), y acota el gate de hardware a una task nueva, **T-MV.5.6** (stream de un RS420 físico).

**GATE 0 — COMPATIBLE, con evidencia contra el código instalado y un build real.** El riesgo del veto
liviano (2026-07-20: *"es la MISMA clase de fallo que quick-sqlite bajo bridgeless"*) **no se
materializó y la analogía era incorrecta**: quick-sqlite fallaba por **bindings JSI** puestos a mano
(para eso no hay interop); `react-native-bluetooth-classic` es un NativeModule legacy **sin una línea
de JSI ni de C++**, y RN 0.85.3 lo corre por el interop de módulos legacy, que está **ON justamente
cuando `newArchEnabled=true`** (`ReactNativeNewArchitectureFeatureFlagsDefaults.kt:35`:
`useTurboModuleInterop() = newArchitectureEnabled`). Confirmado además compilando:
`:react-native-bluetooth-classic:assembleDebug` → **BUILD SUCCESSFUL** (Gradle 9.3.1 + AGP 8.12.0 +
compileSdk 36 + JDK 17), autolinking OK, y `:app:assembleDebug` verde con la dep adentro.
**Hallazgo del veto: la lib NO trae config plugin** → se escribió uno propio.

**Tres bugs 🔴/🟠 en el código que ya estaba "escrito y testeado"** (los tres habrían aparecido recién
con el bastón en la mano): (1) el **framing estaba invertido** —se pasaba por `LineFramer` un payload
que el nativo entrega **ya delimitado y sin `\n`**, así que el adapter no habría emitido **una sola
lectura**; (2) `pairDevice()` en cada connect **cuelga para siempre** sobre un device ya emparejado
(el `createBond()` del nativo no dispara broadcast) → estado clavado en `'connecting'`; (3) la cadena
de reintentos **moría después del primer fallo** (el objetivo se anotaba solo al conectar bien).
Más: reconexión muerta si la app estaba en background, y un connect nuevo que no cancelaba el timer
pendiente y dejaba el guard trabado. Todos con test de regresión.

**Lo que baja el gate de hardware**: la I/O del adapter entra por `SppEnv` (inyección), así que la
máquina de estados completa se ejercita con dobles — permiso denegado, BT apagado con y sin
aceptación, device recordado vs explícito, stream, corte del SO, backoff creciente y su reset,
background/foreground, doble connect, teardown. `adapter-spp-android.test.ts` pasó de 8 a 36 tests.

**En el teléfono, SIN RS420, se puede verificar**: que la app arranca con la dep nativa; el diálogo de
permiso de Android 12+; que la pantalla **enumera los dispositivos emparejados reales** (auriculares,
auto); el error al conectar contra algo que no habla SPP; y que **el chip vuelve solo** (no se tocó el
guard: la condición sigue siendo `transport != null`, y ahora en Android hay transporte).
Queda gated **solo** el stream del RS420.

Detalle, tabla de evidencia del Gate 0, autorrevisión y dudas abiertas en
`progress/impl_baston-android-spp.md`.

## 2026-07-29 — BUGFIX 🔴 «el botón de conectar bastón en Android no funciona» (implementer) — LISTA para review

Base `d9a3eb0`. Raf en device. Diagnóstico ya cerrado por el leader: `react-native-ble-plx` no está
instalado → `selectTransportAdapter` devuelve `'manual'` en native → `instantiateTransport` devuelve `null`
→ `transport?.connect()` es un no-op. **El botón no está roto: no debería existir.** Titularidad de BLE
recién pasada desde la terminal que murió.

**Decisión (coincido con el leader): sin transporte, el chip NO se muestra.** Sin transporte el único estado
alcanzable es `'off'` —invariante para toda la vida del proceso—, así que un "indicador" que no puede
cambiar de estado no informa nada; ocupa el ángulo superior derecho de una tab para anunciar algo inusable, y
**contradecía** al hero de `identificar` dos elementos más abajo ("El bastón no está disponible en este
dispositivo"). Precedente propio: `StickStatusIndicator` ya se auto-oculta en `'off'` con ese mismo criterio.

**La condición es `hasTransport === false`, NO "es Android"** — no hay un solo `Platform.OS` en el fix; cuando
la Fase 4 aterrice el adapter SPP, todo vuelve solo. Vive en las funciones **puras**
(`bleConnectionView` → `null`; `connectionStatusView`/`deviceRowView`/`readsEmptyHint` → sin CTA), con el
corte **antes** del switch (cubre el transitorio del transporte desmontado en caliente) y `hasTransport`
como parámetro **obligatorio** (un default optimista es cómo se reintroduce un CTA muerto).

**Tres hallazgos que no estaban en el pedido**:
1. 🔴 **La fila del device de `/baston` es una trampa armada para la Fase 4**: decidía `actionable` por
   `binding.available` (capacidad de BUILD) y tocarla llama `transport.connect()` (instancia real) — **dos
   fuentes que hoy coinciden por casualidad**. El día que la Fase 4 agregue `'spp-android'` a
   `BUILT_ADAPTERS` sin tocar `selectTransportAdapter`, la fila diría "Tocá para conectar", no pasaría nada,
   **y la suite entera quedaría en verde**. Es la clase de bug que quemó a U7.
2. 🟡 **Lo encontré mirando la captura, no el código**: el vacío de "Lecturas" también decía "Conectá el
   bastón" (copy suelto en el JSX, invisible para una grep de `connect()`).
3. 🟡 **El fix se causaba a sí mismo una regresión de layout**: el slot `right` de `SpikeSessionHeader`
   envuelve al hijo en un `<View>` y el `XStack` da `gap="$2"` a todos sus items → un chip nulo dejaba 8dp
   de hueco muerto robándole ancho al nombre del rodeo (que trunca) en la pantalla 🔴 de manga.

**Y el módulo del chip no era testeable**: importaba `lucide-react-native` en runtime → no carga bajo
`node:test` (verificado ejecutándolo). Pasado a type-only (ícono como clave), el patrón que el repo ya usa.

**Verificado**: `check.mjs` **RC=0** (2526/2526 unit; alcance declarado: **no corre E2E**) · E2E BLE 6 specs
**32/32** · `animals.spec.ts` 35/2, los 2 **verdean en aislamiento sobre el mismo build** (flake, no
regresión, no tocan BLE) · capture Gate 2.5 **10 shots en 2 pasadas** (las 3 superficies × con/sin
transporte — el bug es "hay algo de más", una captura sola no probaría nada) · **falsificado en las dos
direcciones con rebuild**: quitar el guard → (a) rojo; ocultar siempre → (b) rojo · `design/` revertido ·
**nada commiteado**.

**Deuda heredada al backlog** (registrada, no arreglada): el stash `pressable-sweep-wip` (67 archivos, con la
premisa **en disputa** — 24 casos en el árbol, ninguno con `pressStyle`) y `StickConnectionScreen` como
**último `router.back()` pelado** (la entrada vieja que lo excluía "por territorio ajeno" quedó corregida).
Overflow encontrado y NO arreglado con argumento: `TagScanCta`.

**⏸ Veredicto en DEVICE**: en web el transporte SIEMPRE existe, así que el bug de Raf solo se ve en el
Android real. Detalle, trazabilidad y 5 dudas abiertas en `progress/impl_baston-chip-sin-transporte.md`.

## 2026-07-27 — UNIDAD «barrida de teclado» (implementer) — LISTA para review

Pedido de Raf tras verificar el fix anterior en device: *"falta replicar comportamiento al resto de todos
los campos de texto con una barrida, porque próximo paso con teclado ya volví a encontrar el error"*.
El commit `eabfd00` cerró los **4 archivos que montaban un `KeyboardAvoidingView` mal configurado**;
existía una **segunda población** —**23 superficies con AUSENCIA total de mecanismo**, 7 de ellas 🔴
manga— que el guard de aquella unidad **no podía ver por construcción** (busca el uso incorrecto de un
componente, no la falta de él). Base `fc4d164`.

**Hecho**: **20 superficies envueltas** con `KeyboardAvoidingShell` (+ las partes reusables cubiertas por
sus consumidores) · **hook nuevo `useKeyboardAwareBottomInset`** que resuelve la doble reserva de
safe-area en UN lugar (canónica con teclado cerrado, `$2` con teclado abierto) y al que migraron los 3
sitios de la unidad anterior → una sola grafía de la reserva · **`tabBarHideOnKeyboard: true`** en las
tabs (el bottom-nav vive fuera de la pantalla: ningún shell puede subirlo).

**El entregable que más importa: el guard DADO VUELTA.** A la REGLA A ("nadie monta el componente de RN
fuera del primitivo") se le suma la **REGLA B**: enumera estáticamente **todo** archivo con entrada de
texto y exige que esté clasificado — cubierto (**calculado por punto fijo desde el primitivo**, no por
lista escrita a mano), PARTE reusable con motivo, o EXCEPCIÓN con motivo **y marcador en la cabecera del
propio archivo**. **Un archivo nuevo con un input sin clasificar deja el guard en ROJO.** Falsificado con
3 mutaciones sobre el árbol real (archivo nuevo sin clasificar → rojo · sacarle el wrap a `identificar` →
rojo · que `AuthScreenShell` deje de montar el primitivo → **9 pantallas de auth** en rojo), las tres
revertidas y verde de nuevo.

**Dos hallazgos que no estaban en el pedido**:
1. **El blanqueo de comentarios de los guards dejaba líneas de código INVISIBLES**: un `/*` escrito dentro
   de un comentario de línea abría un bloque falso que se comía el archivo hasta el próximo cierre de
   bloque. **Medición, con la métrica declarada** — líneas de CÓDIGO que el escáner viejo dejaba
   invisibles (el blanqueo correcto les deja código, el viejo las deja enteras en blanco), sobre los
   `.ts`/`.tsx` de `app/app`+`app/src` sin `.test.*`, contra el árbol de `fc4d164`: **556 líneas en 6
   archivos** (341 `maniobra/identificar.tsx` · 113 `asignar-caravanas.tsx` · 84 `FindOrCreateOverlay.tsx`
   · 10 `_layout.tsx` · 6+2 los dos de SIGSA). *(La primera entrega reportó "1008 en 57 archivos": no
   reproduce con ninguna métrica y quedó corregido en los 3 guards, en la spec 03 y acá.)* Reemplazado por
   un escáner con estado (`utils/strip-comments.ts` + tests con contrafáctico) y los 3 guards existentes
   migrados — **no había violaciones escondidas**.
2. **`TreatmentStartSheet`/`TreatmentApplicationSheet` nunca pasaron por el hook de la reserva** (tenían
   `paddingBottom="$6"` fijo): la unidad «aire» no los tocó porque su guard prohíbe **re-implementar** la
   fórmula, no **omitirla**. En el fix-loop el reviewer encontró una **tercera** instancia,
   `BulkConfirmSheet` (montado desde `seleccion-masiva`), también arreglada. Los 3 plegados con
   `floor: $6` → **web 32 (idéntico) · iOS 32→34 · Android gestos 32→48 · Android 3 botones 32→64**
   (fijado por test en `utils/footer-action.test.ts`).

**El backlog mentía dos veces**: (a) decía *"qué queda: `TagScanSheet`"* — eran **SEIS** sheets a mano con
input; (b) la entrada que documentaba esa lección **cometía el mismo error**, titulada por las 2 instancias
vistas ese día en vez de por el criterio. Retitulada por CRITERIO ("todo contenido anclado al borde
inferior con reserva de token fijo en vez del hook"), declarada **CLASE ABIERTA sin guard que la vea** y
con la enumeración exhaustiva pendiente. Se sumó además una entrada 🔴 propia para el **back de Android con
un sheet a mano abierto** (hace pop de la ruta; el peor caso es `FindOrCreateOverlay`, overlay global).

**Verificado**: `check.mjs` **RC=0** (alcance declarado: **no corre E2E**) · guards del teclado 12/12 ·
E2E de las superficies tocadas **comparada contra el BASELINE corrido** (stash→build→run→pop): 17 specs,
**2 failed**, las 2 fallan igual en `fc4d164` · capture del Gate 2.5 3/3 con 7 estados y assertions de
no-regresión en web · `design/` intacto · **nada commiteado**.

**⏸ Veredicto en DEVICE (ADR-029), Android *e* iOS**: el bug es estructuralmente invisible en web y estas
23 superficies estaban rotas en las dos plataformas (**iOS también cambia, y está bien**: es
roto→arreglado). Detalle, tabla de las 23, razonamiento de la safe-area, diseño del guard y dudas
abiertas en `progress/impl_barrida-teclado.md`.

## 2026-07-28 — BUGFIX «abrir un sheet baja el teclado» — `615328d` — ✅ VERIFICADO EN DEVICE (Raf, 2026-07-29)

Raf sobre el APK `a3b8d804`: `identificar` ✅ (el input sube y se ve — el reporte original quedó
cerrado). **Pero** con el teclado abierto, tocar la flecha de atrás abre el `ExitJornadaSheet` y el
teclado NO baja: del sheet asomaban ~25px y los dos botones ("terminar maniobra" / "salir sin
terminar") quedaban tapados. Un diálogo de decisión destructiva invisible, en flujo 🔴.

**Mi diagnóstico fue FALSO y lo corrigió el implementer.** Lo atribuí al "límite conocido" de
`KeyboardAvoidingShell.android.tsx` (montar con el teclado abierto arranca en 0). El `ExitJornadaSheet`
**no monta ese shell** — no tiene inputs, así que la REGLA B del guard nunca se lo exigió: el lift ahí
nunca existió. Sonaba correcto y era otra cosa. Las dos afirmaciones falsas que quedaban en ese archivo
("paridad con iOS, no regresión" / "el flujo del bug reportado no lo toca") quedaron corregidas.

**Fix**: `useDismissKeyboardOnOpen` en `BottomSheetShell` + los 21 sheets a mano = 22 overlays. Es la
conducta correcta, no solo la más simple: tocar "atrás para terminar la jornada" es SALIR del contexto
de escritura. Capa 2 (sembrar la altura al montar) **rechazada con fundamento**: la única fuente es
`Keyboard.metrics()`, cuyo `height` es el que está mal bajo edge-to-edge, y el término de corrección no
es verificable — un lift equivocado es peor que ninguno.

**Lo que hizo el implementer sin que se lo pidieran** (vale registrarlo, es el estándar que quiero):
se cazó una regresión propia (el descarte mataba el `autoFocus` de `SavePresetSheet`) y **detectó que su
propio E2E era un falso verde** falsificándolo — el oráculo "el input pierde el foco" pasaba igual sin
el fix. Lo reescribió sobre el bastonazo, único disparador que no toca el foco por su cuenta.

**Lo que agregó el review**: el guard cubría **una sola dirección** de la excepción `claimsKeyboard` —
marcarla de más pasaba 9/9 en verde dejando el bug vivo en silencio. Y su semilla `$scrim` afirmaba algo
falso (existe un overlay sin `$scrim`). Ahora enumera por GEOMETRÍA y cubre las dos direcciones.

## 2026-07-27 — UNIDAD «barrida de teclado» — `56beff3` — ✅ VERIFICADO EN DEVICE (Raf, 2026-07-27/29)

**Cómo apareció**: Raf verificó `eabfd00` en device (teclado en Vacunación ✅, aire ✅, navbar ✅, crash
del worklet NO reapareció — eso cierra también el veredicto pendiente de la tanda del 25) y **a los
minutos encontró el mismo bug en `identificar.tsx`**.

**Mi error de razonamiento**: di la clase por cerrada arreglando los 4 sitios que montaban un
`KeyboardAvoidingView` MAL CONFIGURADO. Había una segunda población —**23 superficies sin ningún
mecanismo**— estructuralmente invisible para un guard que pregunta por el mal uso. El mismo error
apareció una tercera vez adentro de esta unidad: la unidad «aire» **también** tiene población por
ausencia (`BulkConfirmSheet`, reserva hardcodeada `$6`=32 → CTA bajo la barra en Android).

**Lo que se hizo**: 20 superficies envueltas (7 🔴 primero) + 7 declaradas como parte cubierta por su
consumidor + 2 excepciones. `useKeyboardAwareBottomInset` compone la reserva con la lógica de teclado
en un lugar. `tabBarHideOnKeyboard` porque en las tabs el bottom-nav vive fuera de la pantalla (~120dp
de hueco). Con teclado cerrado, valores idénticos a `fc4d164`.

**El entregable que importa — el guard invertido**: la pregunta pasa de *"¿alguien usa mal el
componente?"* a *"¿hay algún campo de texto que no esté adentro del primitivo?"*. Cobertura por punto
fijo desde el primitivo (42 proveedores, 4 nombres de cobertura). **Un archivo nuevo con input sin
clasificar nace en ROJO.** Falsificado de a una mutación; el reviewer agregó una propia (`<FormField>`).

**Y los guards ahora verifican su propia cobertura.** Lo motivó un bug real: un `/*` dentro de un
comentario de línea abría un bloque falso y dejaba **556 líneas invisibles en 6 archivos** (medido; el
informe decía "1008 en 57" y no reproducía con ninguna métrica → corregido, era bloqueante). Verificado
que **no tapaba violaciones** en lo ya commiteado: guards arreglados contra un worktree en `fc4d164` →
16/16. Van dos veces que un guard falla en silencio, por dos causas distintas — **un verificador roto y
uno que no encuentra nada se ven igual**.

**Correcciones del leader sobre la entrega**: (a) el implementer convirtió **LF→CRLF en 6 documentos**,
inflando el diff a 7500 líneas (4022 de churn solo en la spec 03) por 27 de contenido — revertido, el
cambio real es 1305; (b) tres cifras del informe no resistían verificación (el 1008/57, el conteo de
E2E y los `maxHeight` de los sheets). Regla nueva asentada: **las afirmaciones cuantitativas de un
subagente son reclamos a verificar, no datos** — se pide la métrica y el método.

**Backlog abierto que dejó esta unidad**: la clase de la reserva inferior por ausencia (sin guard que la
vea); los 6 sheets a mano sin `BackHandler` propio (el más filoso: `FindOrCreateOverlay` es overlay
global de manga 🔴 y el back hace pop de la ruta); y que `run-tests.mjs` usa **lista explícita sin glob**
→ un test no registrado nunca corre (hoy limpio, 135/135 medido, pero sin red).

## 2026-07-27 — CIERRE del leader: «aire» + «teclado» — ✅ VERIFICADAS EN DEVICE (Raf, 2026-07-27)

Las dos unidades de abajo están **cerradas y commiteadas**; los bloques que siguen quedan como acta del
trabajo, no como pendientes.

| commit | unidad | reviewer |
|---|---|---|
| `4f1f86b` | «aire» — 60 archivos | CHANGES REQUESTED → 3 bloqueantes resueltos |
| `eabfd00` | «teclado Android» — 25 archivos | APPROVED + 3 pedidos de docs aplicados |

**APK** `cdf838a6-8df0-486b-a210-679d0c8c055d` sobre `eabfd00` (perfil `preview-dev` → Release, **sin
`callGuard`** → sirve también para re-verificar el crash del worklet de la tanda anterior).

**Decisiones del leader en esta tanda** (las tres corrigen algo que yo mismo había dado por bueno):

1. **La fórmula aditiva que especifiqué era incoherente conmigo mismo.** Escribí en el diagnóstico que en
   iOS el inset *es* el aire y en Android es una losa opaca, y acto seguido pedí una fórmula aditiva en
   todas las plataformas. Resultado: tab bar de iOS 94 → 110pt. Corregido a
   `max(inset, piso) + (Android ? aire : 0)` → **iOS y web no se mueven**. Lo destapó la duda #1 del
   implementer, no yo.
2. **Los 8 footers con `+12` NO eran aire deliberado.** El reviewer encontró que el propio repo ya los
   había clasificado (`plan-mejoras-ux-2026-07-18.md:175`: *"hardcodean `+12` en vez de usar
   `$navBottomMin`"*) — grafía accidental de la reserva, deuda a plegar adentro. Se armonizan a la
   canónica (iOS 46 → 34). Releva mi instrucción "nadie pierde aire", que existía contra regresiones
   **silenciosas**, no contra armonizaciones con evidencia.
3. **Promoví a bloqueante que nada probaba que `$navBarGap` resolviera.** Los tests puros hardcodean
   `GAP = 16` y la única captura mide web, donde el token **nunca se lee**. Token mal escrito → término 0
   → **fix muerto en Android con la suite entera en verde**. Es literalmente cómo nos quemó U7. El guard
   ahora verifica el valor resuelto, no la cadena escrita.

**Hallazgo transversal que cambia cómo reportamos**: `check.mjs` y `run-tests.mjs` tienen **cero**
referencias a e2e/playwright. La suite E2E **nunca** estuvo adentro; venía diciendo "verde" apoyado solo
en el check. La suite completa da hoy **247 passed / 22 failed**, todos pre-existentes (verificado contra
un worktree en el baseline); 6 comparten un bug de oráculo `.first()`. De acá en más se reportan los dos
números por separado.

**⏸ Bloqueado en la Puerta 2**: los dos bugs son **estructuralmente invisibles en web** (RNW no monta
teclado virtual y `insets.bottom = 0`). No se inventaron tests que finjan cubrirlos. Raf es el único
oráculo. A mirar en device: (a) el sheet sube y el CTA queda a `$2` del teclado; (b) fluidez de la
animación; (c) el blip inicial de ~57px, que es **Android-only** (en iOS el `LayoutAnimation` del KAV
acopla los dos cambios en el mismo commit); (d) el aire de 16dp en CTAs y tab bar; (e) no-regresión del
crash del grabber y de los 4 casos del back; (f) el login, que no estaba reportado y también estaba roto.

## 2026-07-26 — UNIDAD «teclado Android» (el teclado tapa el sheet entero) — APPROVED, commiteada en `eabfd00`

Bug 🔴 de Raf (device Samsung, 3 botones, APK release `7402575a`), sobre la base `4f1f86b`: al enfocar el
input del sheet de Vacunación **el teclado tapa el sheet entero**; en iOS el mismo sheet sube bien.
Diagnóstico ya cerrado por el leader (no re-investigado): (1) `KeyboardAvoidingView` con
`behavior=undefined` en Android es un `<View>` pelado — "no hagas nada"; (2) el fallback `adjustResize`
está desactivado porque el build tiene **edge-to-edge forzado** (`setDecorFitsSystemWindows(false)`) y en
`ReactAndroid` nadie compensa el layout ante el inset del IME; (3) la altura que RN emite le **resta la
barra de navegación** (`ReactRootView:978`), así que tampoco alcanza con cambiarle el `behavior`.

**Fix**: primitivo `KeyboardAvoidingShell` con separación por extensión de plataforma — base (iOS/web)
byte-idéntica a hoy, `.android.tsx` con `useAnimatedKeyboard` de Reanimated 4.3.1 (ya instalado; bajo
edge-to-edge devuelve el inset COMPLETO del IME) aplicando `paddingBottom` al contenedor. Migrados los **4
call sites** (`BottomSheetShell`, `FooterActionShell`, `maniobra/carga`, `AuthScreenShell` = el login).
**Sin doble conteo**: el shell descuenta el teclado entero (que en Android ya incluye la barra de
navegación) y el footer aporta solo su `$2` → el CTA queda a **$2 del borde del teclado**.

**Guard de clase nuevo** (`app/src/components/keyboard-avoiding-guard.test.ts`, en `run-tests.mjs`, 7
tests): prohíbe el `KeyboardAvoidingView` de RN fuera del primitivo, exige que la base conserve el
`behavior='padding'` de iOS, que el `.android.tsx` aplique de verdad `paddingBottom: height.value`, y que
los 4 call sites sigan usando el shell. **Falsificado** rompiéndolo a propósito (3/7 en rojo con el
diagnóstico correcto) y revertido. Corregidos además los **9 comentarios** del repo que afirmaban que en
Android lo resolvía el `adjustResize`.

**Verificado**: `check.mjs` **RC=0** (con el alcance declarado: **no corre E2E**) + E2E acotada a las 4
specs de las superficies tocadas **11/11** + capture del Gate 2.5 (6 estados) con 3 assertions de
no-regresión en web. **`design/` intacto. Nada commiteado** (lo hace el leader).

**⚠️ Veredicto en DEVICE (ADR-029, Android)**: este bug es **estructuralmente invisible en web** (RNW no
monta teclado virtual) — ninguna captura puede mostrar el lift y no se inventó un test que finja cubrirlo.
Specs reconciliadas (03 design v11 / tasks v12, 08, `docs/design-system.md` §6) + backlog (migración a
`react-native-keyboard-controller`). Detalle, trazabilidad y dudas abiertas en
`progress/impl_teclado-android.md`.

## 2026-07-26 — UNIDAD «aire» (separación con la barra del sistema) — APPROVED tras fix-loop 2, commiteada en `4f1f86b`

Bug 🔴 de Raf (device Android, Samsung 3 botones, build `7402575a`): el CTA "Nueva jornada" —y el "Listo"
de los sheets— quedaban a **1dp** de la barra del sistema. Causa raíz (medida por el leader, no
re-investigada): la fórmula `max(insets.bottom, $navBottomMin=12)`, copiada a mano en ~25 archivos, con
un inset real de 48 devuelve 48 → reserva la barra **y nada más**. El mínimo solo podía ganar con inset 0
(web), por eso el preview nunca lo mostró. U7 (`initialWindowMetrics`) arregló otra cosa y se conserva.

**Fórmula final** (el primer intento, aditivo en TODAS las plataformas, se **descartó** en review: engordaba
iOS de 94 a 110pt y borraba el piso de web):

```
paddingBottom = max(insetVigente, insetArranque, $navBottomMin=12) + (Android ? $navBarGap=16 : 0)
```

Tres conceptos: **inset** (obligación del SO) · **piso** (respiro cuando no hay inset → web) · **aire**
(separación contra la barra de navegación, **solo Android**, donde el inset ES esa barra; en iOS los 34pt
ya son aire pintado con el fondo de la app). Resultado: **web 12 · iOS 34 → sin cambio · Android gestos 40
· Android 3 botones 64**.

**Hecho**: los dos tokens conviven en `tamagui.config.ts`; `computeSafeBottomInset` recibe `applyGap` por
parámetro (sigue pura, `node:test`) y el `Platform.OS === 'android'` vive en **un** solo archivo
(`useSafeBottomInset`); `computeTabBarInsetLayout` pasó a componer solo el alto; barrido de **41 call
sites** al hook, con `{ extra }` / `{ floor }` para las 5 superficies que ya tenían más aire deliberado;
**root `SafeAreaProvider` sembrado con `initialMetrics`** (el follow-up que U7 dejó flageado); **guard
estático** de 8 reglas. Hallazgo de la autorrevisión: `StickStatusIndicator` se posiciona RELATIVO a la
tab bar → si no migraba, el pico del FAB se lo comía.

**Fix-loop 2 (review del leader, 3 bloqueantes + 1 promovido)**:
1. **Los 8 outliers del `+12` se ARMONIZAN a la reserva canónica** (`animal/baja`, `crear-rodeo` ×2,
   `editar-plantilla`, `editar-servicio`, `import-rodeo`, `lote/[id]`, `lote/venta`). Fundamento
   documental, no estético: el propio repo ya había clasificado ese `+12` como deuda ("hardcodean `+ 12`
   **en vez de usar `$navBottomMin`**", `plan-mejoras-ux-2026-07-18.md`), o sea una grafía accidental de
   la reserva canónica. Conservarla dejaba la app con **dos** reservas de footer (Android 3 botones: 64
   vs 76). Efecto: **web 12 (sin cambio) · iOS 46 → 34 · Android 3 botones 60 → 64**.
2. **Guard endurecido**: `$navBottomMin` ya no puede aparecer fuera del hook ni como argumento.
3. **Guard nuevo (regla 8)**: los tokens tienen que **RESOLVER** — existir en el grupo `size` de
   `tamagui.config.ts` con número finito > 0, que el hook los pida de ese grupo, y que las constantes
   hardcodeadas de los tests puros coincidan. Cierra el agujero más serio de la unidad: `$navBarGap` mal
   escrito → `getTokenValue` = `undefined` → 0 → **el fix es un no-op en Android con toda la suite
   verde** (en web `applyGap` es false y el token ni se lee).
4. **Dos notas de reconciliación corregidas**: la de `specs/active/03` afirmaba un as-built falso
   (`floor: $4` en `ManeuverConfigSheet`, que en realidad delega en `BottomSheetShell` sin `floor`), y la
   de `specs/active/04` §7 no registraba el cambio del pill del bastón.

**Paridad recalculada** (verificador mecánico contra el baseline, 41 call sites): **web idéntico en
40/41** (la excepción intencional es el pill del bastón, 93 → 105, que antes tapaba el FAB) y **8
reducciones, todas en iOS, todas de 46 → 34** = la armonización deliberada del punto 1. Ninguna pérdida
en web ni en Android. La propiedad "0 pérdidas" del fix-loop 1 ya **no** aplica y está reportada como tal.

Verificación y estado en `progress/impl_aire-safe-area.md`. Capture file de Gate 2.5:
`app/e2e/captures/aire-safe-area.capture.ts` (con el límite declarado: en web `insets.bottom = 0` y la
reserva es el piso de 12, igual que antes → **el aire se veta en DEVICE**, ADR-029; la captura sí asserta
que el nav mida 72px/12px **y que el footer de `crear-rodeo` mida 12px**, o sea que nada se movió en web).
Nada commiteado (lo hace el leader).

## 2026-07-25 — TANDA de 4 bugfixes 🔴 (gesto de descarte + arrastre + auto-guardado + back de Android) — CÓDIGO CERRADO, veredicto de device pendiente

Raf reportó dos cosas sobre el sheet de Vacunación: que deslizar hacia abajo cerraba **el wizard entero** en vez del sheet, y que el grabber del sheet no hacía nada (arrastraba el de atrás). Propuso convertir "elegir maniobras" en screen y "vacunación" en sheet. **Diferí con fundamento**: ya son exactamente eso. `maniobra/jornada` es una ruta real y `ManeuverConfigSheet` es un sheet; el problema estaba en la presentación heredada y en que **ningún sheet del repo era dueño de su propio gesto**.

**Corrección de mi diagnóstico** (asentada porque se la di a Raf mal primero): yo dije que las pantallas vivían DENTRO del contenedor modal del landing. El implementer fue al código instalado y el mecanismo real es otro — expo-router 56 **propaga `modal` hacia adelante** (`getModalRoutesKeys.js`), así que `jornada`, `identificar` y `carga` eran **cada una su propio page-sheet** con su propio swipe-to-destroy. Mismo efecto, misma corrección, explicación distinta.

**Los 4 fixes** (2 implementers en paralelo con propiedad de archivos disjunta, 4 rondas de review + 5 fix-loops, todo `model: opus`):
1. **Presentación** — `fullScreenModal` + `gestureEnabled:false` en `maniobra/{jornada,identificar,carga}`. El landing `maniobra` queda `modal` a propósito (ahí el swipe-down es correcto: una pantalla sin estado que perder).
2. **Arrastre propio del `BottomSheetShell`** — detectores DISJUNTOS (header ↔ contenido del body), umbral 25% con piso 64px o flick ≥900px/s, con el teclado arriba baja el teclado y no cierra. El grabber dejó de mentir.
3. **Auto-guardado del `ManeuverConfigSheet`** — se van "Guardar" y "Cancelar". Mataba un **descarte silencioso**: de las cuatro salidas, tres llamaban `onClose` sin persistir (cargabas 4 vacunas, rozabas el scrim y se perdían sin aviso).
4. **Back de hardware de Android** (lo encontré yo, no estaba reportado) — **no había un solo `BackHandler` en toda la app**. El back destruía el wizard y salteaba el `ExitJornadaSheet` durante una jornada activa; en `carga` además dejaba filas de evento huérfanas. Es el gemelo Android del bug que Raf vio en iOS, en la plataforma donde el gesto no es un descubrimiento accidental sino el botón de siempre.

**Lo que cazaron las reviews y vale registrar** (dos hallazgos de la misma familia): delta A shippeó un **aserto que no podía fallar** (leía `touch-action` del scroller cuando RNGH-web lo escribe en la vista del detector → pasaba siempre, y si alguien borraba el `touchAction` moría el scroll táctil de los 4 sheets sin que nadie se enterara), y **citó como evidencia permanente** un archivo de test que no contenía el contrafáctico citado. Ambos cerrados: el oráculo se falsificó ejecutando (sacar el `touchAction` lo hace caer, reponerlo lo devuelve a verde) y las citas se bajaron a "medición ad-hoc". Delta B, en el mismo árbol, se había negado por su cuenta a shippear un aserto vacuo — el contraste quedó documentado.

**Veto visual del leader (Gate 2.5)**: reprobó dos veces antes de pasar. (a) El body del shell se cortaba **al ras del footer**, sin aire ni señal de scroll — defecto del primitivo, lo heredaban los 4 consumidores; resuelto con peek + fade + chevron ▾ vía la misma `shouldShowScrollPeek` que ya usan `FooterActionShell` y las listas. (b) Los chips inflados a `$touchMin`=56 competían en peso con el CTA; bajados a `$4`=44 conservando 44×44 de área tocable. Este segundo caso es de manual: el aserto medía `boundingBox`, `hitSlop` no aparece ahí, **así que la forma de medir terminó dictando el diseño**.

**Verificado ejecutando**: `check.mjs` **RC=0**, 2452 unit, e2e verde sobre build fresco, y las atribuciones de flake de los implementers re-verificadas por un reviewer en terminal limpia (no reprodujeron).

**Veredicto de DEVICE pendiente (ADR-029, iOS + Android)**: que el arrastre ya no descarte la jornada, el arrastre real con el dedo, la conducta con el teclado, el `maxHeight` de la envoltura en Yoga nativo, y el back de Android con su precedencia sheet↔pantalla (`BackHandler` no emite en web: la precedencia es lectura de la fuente de RN, no ejecución).

**Hallazgo aparte, NO de esta tanda**: `app/e2e/maniobra-carga.spec.ts` está **2/3 en rojo en HEAD desde el 10/07**, reproducible. Fixture desfasado de su gating (el tacto pasó a exigir hembras servidas, el spec siembra una vaquillona pelada). Pasó quince días desapercibido porque **ese spec no está en la lista de e2e de `check.mjs`** → el RC=0 que usamos de semáforo cubre menos de lo que parece. En backlog, con la recomendación de auditar qué otros specs quedaron fuera.

## 2026-07-25 — CIERRE del leader de los 2 bugfixes (reviews + fix-loop + specs) — EN PUERTA 2

Los dos bugfixes de abajo pasaron por **reviewer** (uno cada uno, `model: opus`):
- **auto-scroll del drag**: APPROVED en mérito, sin cambios de código. El reviewer verificó ejecutando (17/17 unit, anti-hardcode 0, babel real → el worklet se compila y captura `measure`/`regionRef`), revisó las capturas y trazó R1.12-a ↔ test.
- **teclado en sheets**: CHANGES_REQUESTED por 3 findings → los 3 cerrados. (1) `check.mjs` rojo, (2) specs sin reconciliar + colisión de "As-built v7", (3) **inconsistencia**: el fix había dejado input-arriba-de-chips en Vacunación pero chips-arriba en el custom field.

**Fix-loop** (implementer): unificado en **input arriba de los chips** en los dos sheets — decisión del leader (con el teclado abierto el área visible del sheet es ~150-250px y lo único que NO puede moverse es el input, donde está el caret; los ítems agregados crecen hacia abajo en el body scrolleable; misma interacción → misma forma, ley de Jakob). Eso obligó a **cambiar la geometría del scroll-al-campo** del `CustomFieldSheet` (los chips pasaron a ser la cola de la sección → se descuenta su alto medido, `chipsHRef`; con 0 chips el cálculo es idéntico al anterior, que es el caso del e2e). Re-revisión acotada: geometría **APROBADA** (sin caminos de staleness; sesgo residual ~18px en dirección segura), oráculos de los 3 tests nuevos aprobados. Verificación del fix-loop: typecheck + 2405/2405 unit + 16/16 e2e + `design/` intacto.

**Specs reconciliadas por el leader** (regla del repo, antes de commitear): `tasks.md` M1.4 con entrada **As-built v8** (teclado) + `Archivos:` actualizado + colisión de numeración resuelta (cada entrada cita su linaje en `design.md`); `design.md` corregido en 4 lugares que habían quedado mintiendo (NaN→`null` del `collapsable`; "cambios propios del sheet de preconfig" → aplican a los DOS sheets; "error inline y scroll-al-campo se conservan tal cual" → el contrato se conserva, la geometría NO; el cálculo del scroll-al-campo ahora descuenta la cola de chips).

**Veto visual del leader (Gate 2.5)**: PASS. Miré las capturas nuevas — el editor de opciones quedó idéntico en forma al de vacunación, y el error de duplicado cae pegado al input con los chips debajo.

**BLOQUEANTE — RESUELTO el 2026-07-25**: Raf rotó el token; verificado con un chequeo que imprime solo el código HTTP (200, 44 chars, prefijo `sbp_`) y `check.mjs` volvió a RC=0. Se deja el registro porque explica los rojos de esa jornada. Texto original: `SUPABASE_ACCESS_TOKEN` de `.env.local` **revocado** — 401 contra `api.supabase.com/v1/projects`, verificado por el leader y por los dos reviewers de forma independiente. Deja `check.mjs` en rojo con CUALQUIER código (la suite `operaciones_rodeo` pega a la Management API) y bloquea también `scripts/apply-migration.mjs`. **Acción de Raf: rotarlo.** Todo lo demás del check está verde.

**Límite honesto del Gate 2.5 (declarado)**: en react-native-web NO hay teclado nativo — `KeyboardAvoidingView` es un `<View>` inerte y `Keyboard` nunca emite → la E2E prueba el clamp de alto, el orden input/chips, el Enter que conserva foco y la X, pero **NO** que el sheet suba ni la condensación. Eso es veredicto en DEVICE (ADR-029), iOS **y Android** (edge-to-edge de SDK 56: misma apuesta que U2).

## 2026-07-25 — BUGFIX 🔴 auto-scroll del drag de reorder (spec 03, etapa 2) — implementer LISTO para review

Raf (device iOS, screen recording): sostener el grip de una maniobra cerca del borde inferior scrolleaba la
página **hasta el fondo de TODO el contenido** → la lista que estás ordenando desaparece. **Fix aplicado**: el
auto-scroll queda **acotado a la REGIÓN de seleccionadas**, medida en pantalla cada frame (`measure()` en el UI
thread sobre un `Animated.View` con `useAnimatedRef` + `collapsable={false}`) y computada por la función PURA
`autoScrollDelta` (`app/src/utils/reorder-autoscroll.ts`, 17 unit): baja solo mientras quede región por revelar,
sube solo mientras el tope esté fuera, aire de 24px, piso duro en 0, **fail-closed** si no hay medida.
Descartados a propósito (documentados en código): gate por bounds del ítem + hardcode de "más de 5 maniobras".
**Verificado**: typecheck + 2400/2400 unit + anti-hardcode 0 + E2E nueva `maniobra-reorder-autoscroll.spec.ts`
2/2 **falsificada** (con el código viejo caen: 249 vs <24 y 403 vs <343) + `maniobra-elegir` 2/2 y
`maniobra-config-reactiva` 2/2 sin regresión + capture Gate 2.5 (5 estados, con el grip sostenido). Los 2 rojos
de `maniobra-carga.spec.ts:133/:277` son los **pre-existentes** (tacto adaptativo) — confirmado revirtiendo al
baseline y reproduciéndolos. Specs reconciliadas (R1.12-a + design v3-bis + tasks as-built v7). **Pendiente:
veredicto en DEVICE de Raf (iOS + Android; en Android el `collapsable={false}` es lo que sostiene el fix).**
Detalle: `progress/impl_03-bugfix-autoscroll-reorder.md`. NADA commiteado (lo hace el leader).

## 2026-07-25 — BUGFIX 🔴 MANGA: el teclado tapaba TODO el bottom sheet (implementer)

Bug de **CLASE** (ningún sheet del repo tenía keyboard-avoidance). Fix = primitivo **`BottomSheetShell`**
(hermano de `FooterActionShell`: backdrop con guard anti click-huérfano + header fijo/body scroll/footer fijo
+ `KeyboardAvoidingView` + condensación con el teclado arriba + X de cierre siempre) + migración de los **4
sheets con input**: `ManeuverConfigSheet`, `CustomFieldSheet`, `SavePresetSheet`, `BreedPickerSheet`. Extras
del mismo bug: input ARRIBA de los chips y Enter que **no baja el teclado** en vacunación (multi).
Verificación: typecheck + anti-hardcode 0 + 123 unit del área + E2E 3/3 nuevos + 27 de regresión + 9 capturas
(Gate 2.5). **Lift real y condensación = veredicto DEVICE (ADR-029)**: web no monta teclado virtual.
Detalle, riesgos (Android edge-to-edge) y reconciliación de specs en `progress/impl_bugfix-sheet-teclado.md`.
Sin commitear. (Terminal paralela trabajando en `reorder-autoscroll` — file-sets disjuntos.)

## 2026-07-23 — Batch autónomo (Raf: "hacé todo lo que puedas, testeo todo junto")

3 items del backlog rebrand-safe, todos commiteados a `main` (implementer → reviewer/veto → commit):
1. **Watched-query migration** — `14b23e9`. Grep autoritativo (la lista del backlog estaba MAL): los que aún usaban el proxy `lastSyncedAt`/`statusChanged` eran animales/home/ProfileContext/useGroupView/mas-RenspaBanner → 5 migrados a `db.onChange`. use-reports (online-only) + focus-only NO migrados (correcto). Proxy eliminado de toda la UI. reviewer APPROVED (1 comentario stale corregido).
2. **backOr sweep** — `f3d26ba`. 15 pantallas con `router.back()` robusto (cold-start/deep-link → fallback). Casos especiales (modal maniobra, condicional crear-rodeo, jornada) verificados. **StickConnectionScreen (BLE) EXCLUIDO** (territorio de la otra terminal) → queda como único back pelado pendiente, lo hace esa terminal.
3. **Truncado de nombre largo** — `567fb0f`. Ellipsis en apretados + nombre completo en Mis campos/editar-campo, descender-safe. Veto visual PASS (5 capturas con 'p').

**NO incluido en el batch (decisión de scope):** a11y sweep (`accessibilityLabel` DOM leak, backlog:667-672) — es broad (~12 archivos) + regresiones de a11y difíciles de cazar por device-test → conviene effort aparte con reviewer, no batch ciego. Impacto mayormente DEV-overlay + ruido de consola, no prod-user-facing.

**Build iOS fresco con TODO**: `6d147d9a` (feature 22 + U6b + U5 + invite fixes + este batch) para que Raf testee todo junto. El veredicto de disparo-en-vivo de las watched queries es device (ADR-029).

## 2026-07-23 — U8a (deep links) DIFERIDO por rebrand + fixes rebrand-safe del invite

**Rebrand destapado (Raf, Gate 0 de U8a):** nombre NUEVO sin decidir ("RAFAQ no es final, cambia todo"), **sin dominio ni nada (0)**. → **U8a (deep links de invitación / multi-usuario) DIFERIDO**: toda la lógica de aceptación ya existe+testeada; solo falta la config de dominio (associatedDomains/.well-known/URLs) que depende del dominio+bundle FINAL, que el rebrand cambia. Backlogueado con el delta exacto. **El rebrand es el camino crítico del beta** (bloquea U8a + submit a stores; nombre/bundle/deep-links son dolorosos post-launch) y está bloqueado en la decisión de nombre de Raf. Backlogueado como effort propio grande.

**Fixes rebrand-safe del invite — DONE + commit `3185dc2`** (parte de U8a que NO depende del dominio): Bug 1 (loop confirm→accept→confirm al abrir /invite?token= ya logueado → fase `resolving` + core puro `invitePhaseForAuth`, no persiste token en `loading`; RootGate NO tocado) + Bug 2 (`backOr` en cold-start). reviewer APPROVED (auth-flow seguro) + 19 unit + E2E 3/3 no-falso-verde + specs 01 reconciliadas. Zona de auth, gateado con cuidado.

**Feature 22** ✅ device-verified iOS. **U6b** ✅. **U5** (fix sheet vacunas nativo, `8752592`) ⏸ device-test de Raf (build iOS `543975e9`). **Flake infra**: `check.mjs` rojo TODA la sesión por `createUser: JWT kid <nil> ES256` (firma JWT/service_role del proyecto DEV a reconciliar — NO regresión de ningún cambio).

## 2026-07-22 — Bug "vacunas no guarda" → feature 22 (sync-liveness nativo), Gate 0 aprobado

Raf reportó (device): habilitar vacunación en "Editar plantilla" de un rodeo "no guarda" (revierte al re-entrar; tampoco se puede usar en maniobra). **Diagnóstico (yo + Plan agent, evidencia en DB dev + código):**
- **NO es bug de guardado.** El save PERSISTE server-side (verificado: rodeo "Cria hembras" de Raf, `rodeo_data_config.enabled=true`, `updated_at`=momento del save, `establishment_id` OK, in-scope del stream `est_rodeo_data_config` auto_subscribe). `vacunacion` es default de cría (`default_enabled=true`).
- **El bug es sync-DOWN muerto en nativo en sesión viva.** El upload va por `supabase.rpc()` HTTP (canal aparte del stream WS de descarga) → sube aunque la descarga esté muerta. **RC-1**: `db.connect()` una sola vez (`provider.tsx:73`), sin NetInfo/AppState → nadie reengancha el socket colgado. **RC-2**: el overlay se limpia en el ACK HTTP (`connector.ts:157`) antes del eco → cae a la fila synced stale. **RC-3**: config/maniobra son lecturas one-shot, no watched queries (no migradas por la 21). Confirmado por Raf: tras cold restart aparece ON; ~5 datos quedaron off hasta reiniciar.
- Es el bug del backlog 2026-07-18, ahora **confirmado crítico** sobre el bucle config→maniobra (frecuente).

**Feature 22 (`22-sync-liveness-nativo`) — DONE + DEVICE-VERIFIED iOS (Raf, 2026-07-22).** ✅ Raf probó en iOS: habilitar dato en config → guardar → maniobra lo refleja SIN reiniciar → RC-1 confirmado (reconexión + watched query andan; caveat V1 no mordió en iOS). Android no device-verificado (mismo código; iOS es el caso duro → done). commit `d269d2b`. Pipeline SDD completo en una sesión: Gate 0 (context.md) → spec_author (Opus) → veto del leader (V1 hueco de triggers + V2 gate de instrumentación por const de módulo, no `__DEV__`) → Puerta 1 → implementer (Opus) → reviewer APPROVED (verificación independiente: typecheck + 206 unit + 8 E2E sin retries + git diff supabase/ sync-streams/ vacío + wiring línea por línea) → Gate 2 PASS 0 HIGH → Gate 2.5 (3 capturas, veto visual PASS) → **Puerta 2 aprobada por Raf**. Alcance **(a) reconexión NetInfo+AppState + (d) `useManeuverGating`→watched query + instrumentación**; CLIENTE PURO (sin Gate 1). **ADR-031** creado (liveness de conexión, contrapunto de ADR-030). Dep nueva `@react-native-community/netinfo@12.0.1`. **PENDIENTE (T11, ADR-029): veredicto en DEVICE** — Raf rebuildeaba `preview-dev` → probar bucle config→maniobra sin reiniciar + leer logs `[powersync][diag]`. Si la muerte del socket es mid-foreground → contingencia **(a′) watchdog** (mismo ciclo). Diferido **(c)** RC-2 (candidato Gate 1, backlog); contingente **(b)** HTTP streaming. Recordatorio de release: flipear `SYNC_DIAGNOSTICS_ENABLED=false` antes de cerrar prod.

**U6b (skeleton loaders) — CERRADO (2 incrementos).** `54c13ea` (primitivo `Skeleton.tsx` + animales/home-rodeos/lotes/reportes) + `745c0c2` (ficha/rodeos/miembros). Skeletons de 1ra-carga en TODAS las pantallas de carga, guard anti-parpadeo (`data===null`), pulse de opacidad (Reanimated, reduce-motion), CERO deps/tokens nuevos (MUI descartado: web-only). Gates: reviewer APPROVED ×2 + veto visual PASS (7 capturas) + typecheck + anti-hardcode 0 + frontend-puro. Home "Lotes" sin skeleton a propósito (evita flash).

**Otros de este arranque**: U9 sigue **solo en dev** (Raf: prod todavía no). Nombre de campo largo se trunca en toda la UI → decidido (ellipsis + nombre completo en Mis campos/editar-campo + descender-safe) y **backlogueado** (2026-07-21). Builds iOS+Android entregados (preview-dev). BLE en otra terminal (file-sets disjuntos; sync vive acá).

## 2026-07-21 — U2 commiteado + U9 DEPLOYADO (Raf aprobó ambos)

- **U2 (CTA siempre visible) — commit `1e0bec7`.** Raf aprobó visual (capturas) + code-review APPROVED. Primitivo `FooterActionShell` en maniobra/carga + alta + agregar-evento. ⏸ **device-test del teclado (iOS+Android) pendiente de Raf.**
- **U9 (binding email + verificado + TTL 72h + TOCTOU) — commit `fde904b` + DEPLOYADO.** Raf eligió "binding opcional + TTL más corto" y "hacelo vos". Deploy vía MCP (sin CLI) de las 3 EFs (accept_invitation v9 / invite_user v8 / resend_invitation v7, todas ACTIVE). **Verificado: `U9_DEPLOYED` edge suite 47/47 pass** (HIGH-1 server-side OK, TTL 72h, TOCTOU). ⏸ **Raf: confirmar `enable_confirmations=true` en dashboard PROD** (defensa en profundidad). El campo `emailVerified` de `_shared/auth.ts` es aditivo → los otros 5 EFs no se re-deployaron (no lo usan).

## 2026-07-21 — Tanda: batch autónomo (Raf: "seguí con lo que puedas")

Cerrados + commiteados (bugfixes, flujo lite implementer→reviewer→commit):
- **U8b (link WhatsApp duplicado) — `df8b2de`.** `inviteShareMessage` fuente única; share `{message}` (sin la rama iOS que pasaba `url`); Copiar intacto. Unit asserta URL ×1.
- **U9 (auditoría seguridad invitación) — `cf791e4`.** Veredicto ACEPTABLE con reservas. OK: expiry/single-use/revocable/entropía. **HIGH-1**: sin binding al email (bearer, ADR-014) → **decisión de Raf** (rec: binding opcional + TTL más corto). **MEDIUM-1**: single-use no atómico (TOCTOU) → fix + deploy. MEDIUM-2 (token en URL/localStorage web) diferido.
- **U4 (ficha incompleta) — `cf3b3c4`.** Paridad card↔ficha: agrega "Dientes" + ancla "Estado reproductivo" en `detail.reproStatus`. E2E paridad + 220/220 unit + Gate 2.5 capture. reviewer APPROVED.
- **U7 (navbar Android) — `6616449`.** Causa real: `initialWindowMetrics` no seedeado → inset 0 en frame-0 Android. Fix `max(live,startup,min)`. **⏸ device-test Android (Raf).** Follow-up: seedear el root `SafeAreaProvider` (canónico app-wide). `run-tests.mjs` commiteado acá (registra el test nuevo + los tests de feature 04 que la terminal BLE dejó sin registrar).

**⏸ Acciones de Raf acumuladas**: (1) rebuild + device-test **U5** (vacunas, ya fixeado 47a4b5c) y **U7** (navbar Android); (2) decisión **U9 HIGH-1** (binding al email); (3) autorizar deploy para **U9 MEDIUM-1** (TOCTOU) y **U6a** (reportes/campaña, + Facundo); (4) **U1** escala 1-9 espera granularidad de Facundo.

**Autónomo restante ~agotado**: U8a (deep links, necesita archivos de asociación en app.rafq.ar + config nativa), U2 (CTA teclado, inversión de design-system — disponible si Raf lo quiere), U6c (feature, área reportes en flujo con U6a), U6b (skeletons, backlog).

## 2026-07-20/21 — Reactividad (features 20+21) COMPLETAS + arranque de la tanda

**Feature 20 (`20-reactividad-sync`) — DONE + commit `1d456b4`.** Re-lectura reactiva de campos/rodeos/lotes en caliente (latch de un disparo → patrón `useStatus`+`lastSyncedAt`). Fue rechazada por el reviewer → remediada → verificada (reviewer APPROVED, Gate 2 seguridad PASS, Gate 2.5 E2E verde independiente) → Puerta 2 aprobada por Raf. **Hallazgo A/B**: `lastSyncedAt` es un proxy NO determinista del cambio de dato (fila llega ~1,5s, señal lagea ~90s+).

**Feature 21 (`21-watched-queries`) — DONE + commit `080100b`.** Migra los 3 consumidores de la 20 a watched queries reales (`db.onChange` en contextos + `useQuery` en lotes) → reactividad **determinista**, aviso de revocación **<350ms**. Cambio de disparador puro (resolución de la 20 con git diff 0). Gate 0→spec→Gate 1→Puerta 1→impl→reviewer APPROVED→Gate 2 PASS→Gate 2.5 (E2E determinista 18/18 confirmado por el leader, sin retries)→Puerta 2 aprobada. **ADR-030** (patrón + migración incremental; el resto de la app migra después). La E2E de la 20 quedó reconciliada (sin retries/forzador).

**Tanda `docs/plan-mejoras-2026-07-20.md` — arrancada por Tier-1:**
- **U3 (preñez duplicada en alta durante maniobra de tacto) — DONE + commit `9c51dd2`.** `sessionMeasuresPregnancy` gatea el campo de preñez del alta cuando la jornada tacta (suprime el `addTacto` post-create). reviewer APPROVED + Gate 2.5 capture. E2E oráculo server-side `countServerTactoEvents===1`.
- **U5 (vacunas tap nativo 🔴) — ⏸ ACCIÓN DE RAF: rebuild nativo + device-test.** El offensor Pressable+Tamagui ya estaba fixeado (`47a4b5c`, 2026-07-18); el reporte es casi seguro build viejo. Si sigue roto en build fresco → NO es el tap (prime suspect: preconfig persistence, escalar). (`progress/impl_U5-*`).
- **U6a (reportes por año) — ⏸ BLOQUEADO en Facundo + deploy.** No es bug de query: gap de MODELO (sin ancla temporal de campaña; limitación [TENTATIVO] 0105). Necesita definición de dominio de Facundo (opción A: anclar a evidencia fechada) + migración (Gate 1) + probable ADR. En `CONTEXT/07-pendientes.md`. Diagnóstico + plan E2E listos (`progress/impl_U6a-*`, commit `69c4e21`).

**Coordinación**: la terminal de BLE commiteó feature 04 (`acec3cd`) en paralelo; sin conflicto (file-sets disjuntos, stage selectivo). `scripts/run-tests.mjs` + `.claude/agents.zip` quedan sin commitear (loose ends de esa terminal, no míos).

**PRÓXIMO** (tanda, esperando a Raf): U8b (link WhatsApp duplicado, autónomo rápido) → Tier-2 (U7 navbar Android, U8a deep links, U9 seguridad token, U4 ficha) → Tier-3 (U2 CTA teclado, U1 escala 1-9, U6c años, U6b skeletons). Varias piden decisiones/device/Facundo. Acción inmediata de Raf: device-test U5 + llevar U6a a Facundo.

## 2026-07-19 — spec 10 DELTA «rodeo grande» — COMPLETO + Puerta 2 APROBADA

Delta-spec `rodeo-grande` (vista DENTRO del rodeo/lote: query scopeada + paginada por keyset/scroll infinito + FlatList virtualizada + count real + buscador/chips por categoría/sexo + masivas sobre el grupo entero + fix bug lote). **Fases 1-5 hechas, reviewer APPROVED, Gate 2 seguridad PASS, Gate 2.5 (E2E 6/6 + 10 capturas + veto visual PASS, ADR-029).** Race de `useGroupView.refreshWindow` al ensanchar filtro (destapado por el E2E) → **arreglado** (guard puro `shouldYieldWindowRefresh`; el refresh cede ante una carga de foreground) + regresión E2E que cae sin el fix. **Raf aprobó la Puerta 2** (capturas a la vista) → commiteado a `main`. Backlog: PowerSync reconnect (ALTO) + Animales tab no virtualizada (LIMIT 200). Polish pendiente (no bloqueante): botón "limpiar filtros" de un toque. Detalle en `progress/impl_10-rodeo-grande-*.md` + `review_10-rodeo-grande.md`.

## 2026-07-18 — spec 10 DELTA «rodeo grande» — Fases 3+4 (implementer, en curso)

Delta-spec `rodeo-grande` — **Fases 3 (hooks `useGroupView` paginado + buscador/chips, T-RG.19..21) + 4 (UI: FlatList en `GroupViewScreen` + `GroupSearchBar` + wiring rodeo/lote + baja en tanda, T-RG.22..27)**. Construye la UI sobre la capa de datos de Fases 1+2 (verde, sin commitear). NO E2E (Fase 5). Aditivo a la capa de datos: `buildGroupSexOptionsQuery`/`fetchGroupSexOptions`/`fetchGroupWindow` + `utils/group-view-model.ts` (puro). NO se tocan los archivos de la otra terminal (feature 19/teléfono). Plan + baseline + trazabilidad en `progress/impl_10-rodeo-grande-fase3-4.md`.

## 2026-07-18 — spec 10 DELTA «rodeo grande» — Fases 1+2 (implementer, en curso)

Delta-spec `rodeo-grande` (vista de grupo scopeada + paginada + count/buscador/chips + masivas sobre grupo entero + fix bug lote). Este run = **Fases 1 (builders `local-reads.ts` T-RG.1..9) + 2 (services `group-page.ts`/`management-groups`/`group-data`/`bulk-selection-data` T-RG.10..18)**. NO se toca UI/hooks/E2E. Plan + baseline + trazabilidad en `progress/impl_10-rodeo-grande-fase1-2.md`. Verificación network-free: unit tests in-memory afectados + tsc (NO check.mjs/E2E).

## 2026-07-12 — Bloque E: Ambientes + Observabilidad (ejecución del plan aprobado)

**Origen**: HANDOFF del plan `C:/Users/RAR20313/.claude/plans/quiero-planificar-la-implementacion-noble-journal.md` (aprobado por Raf en otra terminal, que solo planificó). Esta terminal ejecuta y es **dueña de los archivos de coordinación** (feature_list.json, progress/*) para este bloque. Subagentes con `model: "opus"`.

### Hecho hasta ahora
- ✅ Protocolo de arranque: CLAUDE.md + AGENTS.md + `check.mjs` **verde (exit 0, 14 suites)** + current/plan/feature_list leídos.
- ✅ Assumptions del plan verificadas contra `main` actual: `eas.json` embebe el mismo backend dev en los 3 profiles y NO tiene `channel`; `app.json` hardcodea `extra.supabaseUrl`; `env.ts` usa el reader dinámico `process.env[name]` (gotcha babel confirmado) + fallback a `Constants.expoConfig.extra`; `env-resolve.ts` tiene el set `{supabaseUrl, supabaseAnonKey, powersyncUrl}` (validación fail-closed).
- ✅ **Features 16 (`16-ambientes-y-release`) + 17 (`17-observabilidad`) creadas** en `feature_list.json` (`pending`, `sdd: true`). JSON validado, ninguna `in_progress`.
- ✅ **Bloque E (E.0–E.5) + changelog** agregados a `progress/plan.md`.
- ✅ **Puerta 0 APROBADA por Raf (2026-07-12)**: los 3 contextos (16 Fases 1+5, 17 Sentry+PostHog, 18 audit) → `context_ready`. Corte audit→18 RATIFICADO. `feature_list.json` reconciliado (17 angostada, 18 creada); `check --fast` verde (18 features).
- ✅ **16 y 18 → `spec_ready`** (ambas con requirements/design/tasks). 16 decompuesta en runs **A–E buildables-ya** (app.config/env/scripts default-dev/health/backup-YAML/runbook) + **F gated** por cuentas de Raf; 18 incremento 1 = `user_roles` + `animals`-condicionado-a-medición. **Gate 1: 16 = FAIL** (H1 backup PII→falta `.gitignore` + M1 REVOKE sin `FROM PUBLIC` + M2 rate-limit health + M3 data-at-rest + M4 auth prod + M5 guarda destino-aware + LOWs; todos aditivos) → ✅ **fix-loop de 16 cerrado** (H1→R5.10 backup gitignoreado/fuera-del-tree; M1→R7.7 REVOKE PUBLIC + GRANT service_role; M2→R7.8/9 accept+doc; M3→R8.6/7 gpg AES256; M4→R6.6b; M5→R5.12 guarda destino-aware; L1→R7.2 prefijo; publication→R6.7 FOR TABLES IN SCHEMA public). ✅ **Re-Gate 1 de 16 = PASS** (13/13 cerrados, sin HIGH nuevo; solo L7 LOW no-bloqueante: passphrase gpg por argv). **16 lista para Puerta 1** (presentada a Raf). **Gate 1 de 18 = NEEDS_CLARIFICATION** (H1: `user_roles` se muta por Edge Functions con `service_role`, NO por PowerSync-con-JWT → `auth.uid()`=NULL en el trigger → el audit registra QUÉ rol quedó pero no QUIÉN lo cambió, justo en la op más sensible. `animals` sí tiene auth.uid() real por las RPC SECURITY DEFINER. MEDIUMs de hardening: M1 smoke-check del muro de LECTURA, M2 el trigger AFTER no debe wedgear el write offline de `animals` + cap 500MB compartido, M3 PII de member_name en el audit). **H1 → Raf eligió A (propagación de actor)**: las 5 EFs (`invite_user`/`accept_invitation`/`change_member_role`/`remove_member`/`delete_account`) setean `set_config('rafaq.actor_id', <user_id_del_llamante>, true)` antes del DML; el trigger lee `coalesce(current_setting('rafaq.actor_id',true)::uuid, auth.uid())`. `user_roles` se MANTIENE en el incremento 1 con atribución real. → ✅ **fix-loop de 18 cerrado.** Mecanismo de actor: header **`X-Rafaq-Actor`** (NO GUC set_config — no sirve bajo el pooler: cada call de supabase-js es otra txn; el header de PostgREST sí es transaction-local, misma txn que el DML) seteado por cada EF desde el JWT, leído por el trigger SOLO si la sesión es `service_role` (anti-spoof). Scope corregido: **4 EFs** (accept_invitation/change_member_role/remove_member/delete_account; `invite_user` NO muta user_roles). M2: best-effort `animals` / estricto `user_roles` + T12 gate duro de volumen. ✅ **Re-Gate 1 de 18 = PASS** (header spoof-safe verificado: `resolve_actor()` confía en el header solo si `request.jwt.claims->>'role'='service_role'`, no forjable por `authenticated`; misma txn para las 4 EFs; scope 4 EFs correcto y completo). **18 lista para Puerta 1.** WATCH-ITEMS para Gate 2 (pasar al implementer): (a) M2 — `resolve_actor()` debe ser TOTAL (hoy `v_actor` se computa en DECLARE fuera del `exception` → si el parse del claim tirara, el write de `animals` abortaría; no explotable hoy pero romper el invariante offline); (b) TA.13 spoof-test sobre `user_roles` (via `user_roles_update_owner`), no `animals` (va por RPC); (c) T10 medir latencia de import además de storage (subtransacción por fila = cliff de bulk). 17 queda `context_ready` (buffer; depende de Fase 0 + cuentas Sentry/PostHog).
- 🔴 **Fase 0 sigue esperando el log del build EAS 68cc88d7** (cuenta Expo de Raf) para diagnosticar el Gradle.

### Hallazgo material — rama `apk-prep` STALE
`apk-prep` = `main`-de-2026-07-07 + 1 commit OTA (`5426d99`). `main` absorbió todo el batch de la 2da demo desde entonces (lotes-venta, tratamientos, identificadores-unificados, migraciones 0121-0123, powersync CLI deploys). Un merge de la rama divergente sería un lío → **decisión: re-aplicar la config OTA fresca sobre `main`** (app.json runtimeVersion/updates.url + eas.json channels + `expo-updates ~56.0.21`), NO mergear. La config OTA está documentada exacta en `docs/build-android.md:25`.

### Bloqueantes externos (cuenta de Raf) — por fase
- **E.0 (Fase 0)**: log del build EAS `68cc88d7` (cuenta Expo `rafaqsorg`). Sin el log no se diagnostica el fallo de Gradle. `eas-cli` NO está instalado local.
- **E.1 (Fase 1)**: crear proyecto Supabase PROD (misma región que dev) + provisionar instancia PowerSync "Production" `6a260fd10ef84ed6719fd6bf` + GitHub secret con connection string de prod.
- **E.2 / E.3 / E.5**: cuentas Sentry (DSN) / PostHog (key) / UptimeRobot. El código de Sentry/PostHog se diseña no-op sin credencial → construible antes de tener las cuentas.

### ✅ Puerta 1 APROBADA para 16 y 18 (Raf, 2026-07-13) — arranca implementación
WIP=1 → arranco por **18** (autónoma). **18 → `in_progress`**, implementer Run 1 lanzado (migración `0124` + suite `supabase/tests/audit` + 4 EFs con header `X-Rafaq-Actor`). **16 queda `spec_ready` encolada** (migración health = **`0125`** para no colisionar con la 0124 de la 18). Watch-items de Gate 2 para el implementer de 18: `resolve_actor()` total, TA.13 spoof-test sobre `user_roles`, T10 latencia de import.
**DEPLOY GATEADO**: aplicar `0124` a dev + deploy de las 4 EFs = escritura a la DB compartida → requiere autz de Raf en sesión ANTES de correr los tests (el implementer escribe + verifica estático; el leader coordina el deploy con Raf).
- ✅ **Implementer de 18 cerró** (código + estático + `check.mjs` verde, cambios inertes hasta aplicar). Watch-item M2-a cerrado (`resolve_actor()` total + actor/pk dentro del guard). **CAMBIO DE POSTURA a validar**: el implementer reconcilió R4.x/D5 de "convertir la publication" a **"aceptar el frontier de sync streams"** (`audit.*` no está en `rafaq.yaml` → no llega a device; la publication FOR ALL TABLES no leakea porque las streams son el filtro real). Como revierte mi guía previa y es seguridad, lo mando a Gate 2 a adjudicar. **Reviewer + Gate 2 (code) corriendo** sobre 18 (Gate 2 con foco en la decisión del frontier). Post-gates: reviso el SQL + pido autz de deploy a Raf → aplico 0124 + deploy 4 EFs → corro la suite audit + 14 suites.
- ✅ **Gate 2 (code) de 18 = PASS** (0 HIGH). **Frontier ADJUDICADO**: aceptar el streams-frontier es SEGURO (Gate 2 verificó `rafaq.yaml`: sin catch-all, ninguna stream referencia `audit` → PowerSync descarta ese WAL; convertir la publication no aporta seguridad y es más riesgoso). Los 6 focos PASS (`resolve_actor()` total, anti-spoof por `service_role` claim, fail-closed doble smoke-check, EFs sin IDOR, retención append-only). LOW no-bloqueante a folear: replicar el assert anti-`audit` (TA.11) en `scripts/powersync-deploy.sh` como validación pre-deploy (defensa en profundidad del frontier). **Reviewer aún corriendo.**
- ✅ **Revisión de leader del SQL `0124` = limpia** (leí la migración completa): `resolve_actor()` total confirmado (cuerpo en `exception` + doble fallback); guard best-effort airtight (pk+actor+insert adentro); REVOKEs USAGE/tablas/funciones + `service_role` SELECT-only + doble smoke-check que aborta si el muro quedó abierto; `animals` comentado/gateado por T12; retención pg_cron 90d. **Confío en aplicarlo a dev.** Falta solo el reviewer → ahí pido autz de deploy a Raf (aplicar `0124` + deploy de las 4 EFs → correr suite audit + 14 suites).
- ✅ **Reviewer de 18 = APPROVED** (condicionado a suite verde post-deploy). Trazabilidad R1–R8 completa, checklist RAFAQ OK. NIT no-bloqueante a sincronizar ANTES de done: `design.md` ~L108-109 tiene un comentario stale ("publication FOR TABLE / puballtables=false") que contradice el as-built (FOR ALL TABLES) — las partes autoritativas ya reconcilian; sincronizar el snippet. ✅ **sincronizado por el leader** (design.md L107-109 → as-built FOR ALL TABLES + frontier de streams). **TODOS los gates estáticos verdes** (reviewer APPROVED + Gate 2 PASS + leader SQL review limpio).
- ⏸ **PEDIDO A RAF: autorización de deploy a dev** (aplicar `0124` + deploy de las 4 EFs). Post-deploy: descomentar el hook de la audit suite en `run-tests.mjs` + correr `check.mjs` (15 suites: 14 sin regresión + audit). Si verde → sincronizar el nit de design.md → Puerta 2 (código + ratificación de la reconciliación del frontier). `animals` NO se prende (gate T12).
- ✅ **`0124` APLICADA a dev** (HTTP 201, smoke-check pasó). **Las 14 suites existentes = VERDES** → 0124 NO rompió dev, NO revertir. **La suite audit falló 2/15**: TA.4/5/6 `stableIds.size 2!=1`. **Diagnóstico del leader (verificado en vivo)**: `to_record_id` CORRECTO — cada fila de `user_roles` (PK=`id`) tiene UN record_id estable entre INSERT/UPDATE/DELETE. → **bug del TEST** (no de la migración; NO re-aplicar). ✅ **Test arreglado** (1 línea: el helper `auditRows` omitía `old_record_id` → en el DELETE `coalesce(record_id=null, old_record_id=undefined)=undefined` entraba al Set → size 2; migración confirmada correcta, sin re-aplicar). ✅ **4 EFs deployadas a dev** (accept_invitation/change_member_role/remove_member/delete_account, vía CLI supabase). ✅ **`check.mjs` VERDE (exit 0)**: **audit suite 15/15** + edge contra las EFs nuevas + las 14 sin regresión. La 18 verificada end-to-end en dev (0124 aplicada + 4 EFs deployadas). Gates: reviewer APPROVED + Gate 2 PASS + leader SQL review + nit design.md reconciliado; Gate 2.5 N/A (backend-only). ✅ **PUERTA 2 APROBADA (Raf, 2026-07-14) → feature 18 DONE.** Verificada por la suite (15/15) + prueba MANUAL de Raf (cambió rol en el web app → `audit.record_version` mostró su email como actor real vía el header). Frontier ratificado. Commit selectivo (feature 18 + specs 16/17/18 + Bloque E).

### 🔀 Hallazgo — feature 19 (login social) de Raf, en paralelo (2026-07-14)
Raf agregó **login social (Google + Apple)** como **feature 19**, committeada a main (`70df3ed`/`1189ae5`/`cf9c0be`): specs `specs/active/19-login-social/`, código en `app/` (AuthContext, google-auth/apple-auth, botones, sign-in/up), e2e social-login. **Apple pendiente** de aprobación de Apple Developer. **NO tiene entrada en `feature_list.json`** (Raf no la agregó). Ninguno de mis archivos colisiona (verificado: mis M files son "solo yo"). IMPLICANCIAS para el bloque: (a) **feature 16** — el checklist de setup de Auth de PROD debe sumar **el provider Google OAuth** (client IDs + redirect URLs) replicado a prod; además Raf tocó `app/src/utils/env-resolve.ts` (que la spec 16 referencia) → reconciliar al implementar 16; (b) **feature 17** — el `identify()` de PostHog se engancha en `AuthContext` (que la 19 modificó) → tenerlo en cuenta; (c) el audit (18) captura acciones de usuarios logueados por Google sin cambios (es el mismo `auth.uid()`).
**Acción (2026-07-14, Raf dio OK)**: feature 19 AGREGADA a `feature_list.json` (status **`blocked`** — código done+gateado+committeado; bloqueada por Google Cloud + Apple Developer pendiente + device test). **Feature 16 → `in_progress`**; implementer arrancando en **Run A** (config foundation: app.config.ts + env estático + EXPO_PUBLIC_ENV + fixtures), reconciliando sobre el as-built de la 19 (env-resolve.ts/app.json/eas.json). ✅ **Run A DONE** (`app.json`→`app.config.ts` con APP_VARIANT dev/prod, preservando OAuth-19 + expo-sharing-Fase0 + todo; `app-env.ts`/`isE2E`; env estático + `fixtures` EXPO_PUBLIC_ENV=e2e + flag; `app.json` borrado). Local verde (typecheck + 26 unit + expo export web). ✅ **Run A = reviewer APPROVED**: check.mjs verde (2139/2139 unit + 14 suites), `app.config.ts` FIEL al app.json borrado (nada perdido; solo sacó `extra.supabaseUrl`, 0 consumidores), E2E la app BOOTEA (61 specs verdes). **Gate 2 PASS 0 HIGH** → **Run A COMMITTEADO (`4f5f5aa`)** (ojo: el 1er intento salió roto —git add falló en app.json ya-deleted→abortó el staging del resto; commit `5e5205c` solo borró app.json; **corregido con --amend**, ahora completo). ✅ **Run B DONE**: scripts/lib/{env-target,ledger-plan,backup-cmd}.mjs (puros, 28 unit) + apply-migration-mgmt (--env, default dev byte-idéntico) + apply-all-migrations (ledger+replay) + backup-db (pg_dump→gzip→atomic, conn por env libpq, output fuera del árbol) + powersync-deploy --env + 0125_health_status.sql + .gitignore backups/. Typecheck + 28 unit verdes; nada corrido contra DB (gated). **Gate 2 de Run B = PASS 0 HIGH** (guarda de prod infalible ruta-por-ruta, secrets nunca en argv/logs, ledger REVOKEado, 0125 REVOKE+GRANT ok). **2 MEDIUM → tracking de Run F** (no bloquean): (M-1) backup LOCAL sin cifrar — el gpg AES256 va en la GitHub Action de Run F, verificar ahí que cifre + borre el plano; (M-2) la guarda destino-aware requiere `SUPABASE_PROJECT_REF_PROD` seteado → volverlo precondición explícita en Run F (la ruta `--env prod` ya está 100% guardada igual). ✅ **Reviewer de Run B APPROVED → Run B COMMITTEADO (`6b07bca`)**. **Feature 16 Runs A+B done+committeados** (config + scripts). PENDIENTE: Run C (health EF, **deploy gateado** = OK de Raf), Run D (backup GitHub Action, **GitHub secret** de Raf), Run E (runbook, autónomo), Run F (crear PROD + PowerSync Production + UptimeRobot, **cuentas de Raf**). → CHECKPOINT: el runway autónomo se agotó; lo que sigue necesita inputs de Raf. **Raf autorizó el deploy (2026-07-14)** → **Run C escrito** (health EF input-free {ok,schema_version,env} + config.toml verify_jwt=false acotado + suite health comentada); ✅ **Run C DONE+DEPLOYADO+VERIFICADO**: reviewer APPROVED + Gate 2 PASS 0 HIGH → `0125` aplicada a dev + `health` deployado (smoke HTTP 200 público `{ok:true,...}`) → hook descomentado → **`check.mjs` verde (16 suites)**. schema_version/env='unknown' en dev = esperado (ledger vacío en dev; se puebla en prod). Committeando. ⚠️ BACKLOG: 2 rojos E2E pre-existentes en `maniobra-carga.spec.ts:133/:277` (tacto adaptativo, spec 03 B2) — el reviewer los juzga estructuralmente imposibles de causar por Run A (nada consume las claves nuevas en runtime); VERIFICAR si vienen de Fase 0/feature 19 o son un red más viejo, y backloguear.

### 🔧 Fase 0 (Gradle) DIAGNOSTICADA (2026-07-13, Raf pegó el log)
**Root cause del fallo del build EAS `68cc88d7`**: la fase `Run gradlew` → `createBundleReleaseJsAndAssets` → **`hermesc` exit 2** en `index.android.bundle:419006` sobre `import(/* webpackIgnore *//* turbopackIgnore *//* @vite-ignore */ OTEL_PKG)`. **Culpable confirmado: `@supabase/supabase-js` (v2.106.x)** — trae un import dinámico opcional de OpenTelemetry que Hermes no parsea. Es un issue conocido supabase-js↔Hermes/Expo.
**+ expo doctor** (2 checks fallan, secundario pero a arreglar): (1) `@react-navigation/{bottom-tabs,native,native-stack}` instalados junto a expo-router (incompat SDK 56 → remover); (2) 9 paquetes expo desalineados del patch de SDK 56 (`npx expo install --check`).
**FIX CONFIRMADO (research con fuentes)**: supabase-js 2.106+ trae `import(@opentelemetry/api)` dinámico en su build ESM que Hermes no parsea; Metro (SDK 56, package-exports on) elige el ESM. Actualizar NO arregla (2.110.3 igual); el CJS de supabase-js es Hermes-safe. **Fix = `resolveRequest` en `app/metro.config.js`** que fuerza SOLO `@supabase/supabase-js` a resolver por CJS (package-exports off per-package; NO toca PowerSync, NO pierde features). Fallbacks: disable global (riesgo PowerSync) / pin 2.105.4. Fuentes: supabase-js#2380, expo#36551, docs Metro. ✅ **Chore Fase 0 DONE** (`progress/chore_fase0-gradle.md`): (T1) metro fix aplicado en `app/metro.config.js` (resolveRequest per-package → supabase-js por CJS); (T2a) `@react-navigation/*` removido (0 imports confirmado; expo-router 56.2.14 ya los forkeó); (T2b) 9 paquetes expo alineados (`expo install --fix`, todos patch; + config plugin expo-sharing en app.json). Verificación LOCAL verde: `pnpm -C app typecheck` + `expo export -p web` sin error, 0 cambios en design/*.png. OTA NO tocado (post-verde). Follow-up MENOR no-bloqueante: skew web/dev-only `@expo/metro-runtime` 56.0.13 vs ^56.0.16 (no se bundlea en Android/Hermes). ✅ **BUILD EAS VERDE** (build `5bc36ad7`, PRIMER APK instalable de RAFAQ; pasó `Run gradlew`/Hermes donde fallaba `68cc88d7`). **Fix committeado a main: `6f14895`** (selectivo, 5 archivos de Fase 0; WIP de la 18 intacto). PENDIENTE Fase 0: (1) **validar el APK en device** (escalón Facundo — es la 1ra validación del boot NATIVO de PowerSync, T8, el riesgo técnico del APK); (2) **OTA re-apply** (expo-updates + canales, toma efecto en el próximo build). Install link: expo.dev/accounts/rafaqsorg/projects/rafaq-app/builds/5bc36ad7-81b5-4891-bf3e-75187743d4f0

### 🚀 PROD bring-up — Run F ARRANCADO (2026-07-14, Raf creó el proyecto + autorizó)
Proyecto PROD Supabase creado por Raf: **`bcrsgekkfcdpwvkebsqe`** (São Paulo = dev, PG 17.6, auto-RLS + auto-expose ON = dev). ✅ **124 migraciones REPLAYADAS a prod** (`apply-all-migrations --env prod` con OK explícito de Raf; ledger `ops.applied_migrations` poblado). ✅ **DIFF dev vs prod IDÉNTICO** (7/7: tables 36 / cols 382 / funcs 149 / trigs 99 / policies 90 / enums 18 / rls_tables 35; excluido `ops` = ledger). ✅ **health EF deployado a prod + smoke HTTP 200** (`schema_version:"0125"` confirma el ledger). PENDIENTE de Run F (checklist manual que el replay NO cubre + deps de Raf): (a) **PowerSync "Production"** provisionar + conectar a prod DB + SQL manual (role + publication `FOR TABLES IN SCHEMA public` — cierra el frontier del audit) + deploy streams; (b) **EF secrets** en prod (Resend/etc.) → deploy de las 8 EFs de miembros; (c) **Auth config** prod (SMTP/Resend, templates es-AR, Site URL/redirects); (d) **EAS** preview/production → backend prod (app.config APP_VARIANT con URL/keys de prod); (e) **UptimeRobot** + **GitHub secret** del backup + los 2 MEDIUM de Run B; (f) **Run E runbook**.

### ✅ Run F (a) — PowerSync PROD ARRIBA y replicando (2026-07-16)
Instancia **Production** (`6a260fd10ef84ed6719fd6bf`) provisionada + conectada a prod DB (`db.bcrsgekkfcdpwvkebsqe.supabase.co`, `Status: connected`, initial replication done, **lag 0**) + **sync streams canónicas (`rafaq.yaml`) deployadas** (30+ tablas replicando; solo los 4 warnings cosméticos de `AS id, *`). Verificado con `powersync status --instance-id 6a260fd10ef84ed6719fd6bf`.
**Bug de tooling resuelto (no era la password):** `powersync validate` en el deploy script prueba la conexión del `service.yaml` **local**, que apunta a la DB de **dev** (`db.xrhlxxdnfzvdnztacofj`); con `--env prod` resolvía el secret de prod contra el host de dev → falso `password authentication failed`. Por eso el "Test connection" del dashboard (conexión real de prod) daba OK y el CLI no. **Fix:** `--env prod` corre `validate --skip-validations=connections` (schema + sync-config siguen validando; la conexión prod se gestiona en el dashboard —el script solo deploya sync-config— y se valida con `powersync status`). Implementer arreglando `scripts/powersync-deploy.sh`; README `powersync/` ya reconciliado. Deploy de streams a prod se hizo directo vía CLI (`deploy sync-config --instance-id … `, connection-test no aplica ahí). **Run F PENDIENTE restante:** (b) EF secrets → deploy 8 EFs miembros; (c) Auth config prod; (d) EAS → backend prod; (e) UptimeRobot + GitHub secret backup + 2 MEDIUM de Run B; (f) Run E runbook.

### ✅ Run F (d) — `eas.json` wireado a prod (2026-07-16)
Publishable key de prod traída vía Management API (Raf autorizó): `sb_publishable_fgWfl7UfCkVePYlM9ZL8Sg_tv9HqIz3` (pública). Perfiles EAS mapeados según R4.4: **`preview` + `production` → PROD** (`bcrsgekkfcdpwvkebsqe` + PowerSync `6a260fd10…`), **`development` → DEV** (intacto). `GOOGLE_WEB_CLIENT_ID` sin tocar en los 3 (OAuth Google prod = feature 19, pendiente; primer APK = login email/password). JSON válido, verificado por implementer + leader. **Falta:** Raf dispara el build (`eas build -p android --profile preview` → APK instalable contra prod) + crea cuenta de prueba en prod (Auth → Add user + Auto Confirm) para el smoke test del peón (Auth prod → JWT → PowerSync prod → DB prod), sin depender aún de EFs/SMTP.

### 📌 Constancia — Apple Developer APROBADA (2026-07-16)
Raf pagó los US$100 de Apple Developer y la cuenta **ya está aprobada**. Impacto:
- **Feature 19 (login social)**: se cierra el gate externo (b) "Apple Developer pendiente de aprobación". Resta solo la config in-account (capability Sign in with Apple + Services ID + Key). Los otros gates de la 19 siguen abiertos → sigue `blocked`: (a) Google Cloud, (c) Supabase Dashboard (habilitar Google+Apple + Client IDs + Redirects), (d) prueba en device.
- **iOS habilitado**: ahora se puede `eas build -p ios --profile preview` para probar en iPhone también (además del APK Android). Requiere login de Apple en EAS (maneja certs/provisioning) + device iOS/TestFlight. Raf lo propuso ("podríamos probarlo en iOS también") — se hace después de validar el smoke test Android.
- Recordatorio ya anotado en la nota de la 19: el checklist de Auth de PROD (item c de Run F) debe sumar el provider Google OAuth + Apple replicados a prod.
Build Android en curso mientras se anota esto.

### 🍏 Build iOS — fix pods google-signin (2026-07-16)
Primer build iOS del proyecto (para probar en iPhone de Raf, ya que no tiene el Android a mano). **Android APK ya buildeó VERDE** (perfil preview → prod, guardado en EAS dashboard). El build **iOS falló en "Install pods"**: `GoogleSignIn 9.x` (feature 19) arrastra `AppCheckCore` (Swift) → `GoogleUtilities` + `RecaptchaInterop`, que no definen módulos → no integrables como static libs. El config plugin de google-signin habilitó modular headers para `GoogleSignIn` pero NO para esas 3 transitivas de AppCheck. **Fix (implementer, verificado):** agregado plugin `expo-build-properties@~56.0.23` a `app.config.ts` con `ios.extraPods` = `modular_headers: true` para `GoogleUtilities`/`RecaptchaInterop`/`AppCheckCore` (lo que pide el propio error de CocoaPods; patrón estándar del caso Firebase/GoogleUtilities). Descartado `useFrameworks: static` (riesgoso con new-arch/prebuilt RN 0.85). Verificaciones verdes: `expo config` resuelve el plugin, typecheck, `app.config.test` 7/7. **El veredicto del pod install lo da el próximo `eas build -p ios --profile preview` de Raf** (no validable local). Beneficia a TODOS los builds iOS futuros (feature 19 incluida). Registro para device ad-hoc: iPhone de Raf UDID `00008130-000C6DA63E82001C` registrado (Team RAFAEL RAVENNA 5C9KYFJCU5). El UDID de Facundo (para que pruebe en su iPhone) queda pateado — se registra + re-buildea cuando se decida (o TestFlight para el beta continuo).

### 🔴 HALLAZGO MATERIAL — la app NUNCA corrió en device (bring-up nativo pendiente) (2026-07-16)
El build iOS instaló en el iPhone de Raf pero **crashea instantáneo al abrir**. Diagnóstico (leader, read-only): **la app se validó SIEMPRE en WEB** (los ~70 e2e corren en web con `@powersync/web`+WASM). El **camino nativo nunca se ejercitó** (ni Android —el APK tampoco se abrió— ni iOS). Gaps nativos confirmados:
- **Causa del crash instantáneo:** `@powersync/react-native@1.35.3` exige el peer NATIVO `@journeyapps/react-native-quick-sqlite@^2.5.2` (marcado `optional` en peerDependenciesMeta → pnpm nunca avisó). **No está instalado** (`node_modules/@journeyapps/` solo tiene `wa-sqlite`). `<PowerSyncProvider>` monta al arranque (`app/_layout.tsx:586` → `getPowerSync()` → `database.ts:59-64` `require('@powersync/react-native')` + `new PowerSyncDatabase`) → sin driver nativo → crash. En web nunca importó porque `database.ts` hace `require('@powersync/web')` guardado por `Platform.OS`.
- **`crypto.randomUUID`:** usado en ~10 services (`animals.ts`, `events.ts`, `establishments.ts`, etc.) con el comentario FALSO "crypto.randomUUID está en RN (Hermes)". Hermes NO trae `globalThis.crypto`. No crashea al boot (se llama dentro de funciones) pero **crashea al crear cualquier registro**. Fix: polyfill al entry (expo-crypto ya está instalado → shim de `globalThis.crypto.randomUUID`/`getRandomValues`, o `react-native-get-random-values`).
- **url-polyfill:** probable que `supabase-js` (`createClient` corre a nivel módulo en `services/supabase.ts:72`) necesite `react-native-url-polyfill/auto` en Hermes. A confirmar con el crash log (¿crash aún más temprano que PowerSync?).
- **BLE nativo:** `react-native-ble-plx` tampoco está instalado, pero `BleStickListenerProvider` mode='auto' NO auto-conecta el transporte (RB1.3) → no rompe el arranque (gap más adelante).
**Plan de bring-up (pendiente de OK de Raf + crash log):** instalar `@journeyapps/react-native-quick-sqlite` + polyfills (crypto, url) en una pasada → rebuild EAS → probar. Iterativo (cada build ~20 min; pueden aparecer más gaps a medida que la app avanza en el arranque). El APK de Android tiene los MISMOS gaps → este bring-up sirve para ambas plataformas. **NO bloquea el beta si se completa, pero cambia el supuesto "la app está lista, solo falta backend+build": faltaba TODO el runtime nativo.**

**Crash log analizado (`docs/RAFAQ-2026-07-16-121827.ips`):** `EXC_CRASH/SIGABRT` vía `RCTExceptionsManager reportFatal → RCTGetFatalHandler → objc_exception_rethrow → abort`, en la cola `com.meta.react.turbomodulemanager.queue`. = **excepción JS FATAL de arranque** (el bundle cargó y corrió, tiró un error no capturado → RN lo reporta fatal). Descarta causa nativa/dyld pura. El `.ips` no trae el texto del error JS (va en `extraDataAsJSON`, no expandido). Consistente con PowerSync sin driver nativo / supabase sin URL polyfill. BLE descartado como bloqueante de arranque: `src/services/ble/` NO importa `react-native-ble-plx` (solo web-serial/HID/mock).

**✅ Bring-up nativo — pasada 1 APLICADA (implementer, verificado en web):** instalados `@journeyapps/react-native-quick-sqlite@^2.5.2` (driver SQLite nativo = peer exacto de @powersync/react-native 1.35.3) + `react-native-url-polyfill@^4.0.0`. Nuevo `app/polyfills.ts` (import `react-native-url-polyfill/auto` + polyfill GUARDADO de `globalThis.crypto.randomUUID`/`getRandomValues` vía `expo-crypto`, no-op en web) + `app/index.js` custom entry (`import './polyfills'; import 'expo-router/entry';`) + `package.json` `main`→`index.js` (patrón oficial expo-router para polyfills). NO se tocó `app.config.ts`: el `app.plugin.js` de quick-sqlite es no-op sin `use_frameworks!` (RAFAQ usa `modular_headers`, no frameworks) → autolinking lo registra vía podspec. **Verificación web (única red hoy):** typecheck verde, `e2e:build` (expo export web) verde, **boot smoke e2e verde** (`auth.spec.ts` login pre-confirmado → ejercita polyfills → createClient nivel-módulo → PowerSyncProvider → login → routing a onboarding). Commit. **Pendiente:** Raf re-corre `eas build -p ios --profile preview` → el veredicto nativo (no validable local). Si al pasar PowerSync aparece otro gap, pasada 2.

**Resultado pasada 1 (2026-07-16): PowerSync OK, crash NUEVO/distinto.** El build lo tiró el leader vía `eas build` (Raf phone-only). `Status: finished` (pod install pasó con quick-sqlite). Instalado en el iPhone → **sigue crasheando** pero es OTRO crash (crash log `RAFAQ-2026-07-16-140336.ips`, slice_uuid `caadf1d2…` ≠ el viejo). En las imágenes cargadas aparece **`powersync-sqlite-core.framework`** → el driver nativo SÍ cargó (el fix de pasada 1 funcionó, la app arrancó más lejos). Mismo patrón (excepción JS fatal → RCTFatal→SIGABRT) pero **el `.ips` NO trae el texto del error JS** (RN no lo embebe en release) → ciegos. Sospechoso #1: throw en FASE DE RENDER al construir el DB nativo (`PowerSyncProvider` línea 50 `getPowerSync()` en `useMemo` → `new PowerSyncDatabase(...)`); el `connect()`/sync están en useEffect con `.catch()` (no crashean). BLE descartado (no importa ble-plx). **Estrategia: instrumentar, no adivinar** (cada build = ~1h de cola en free tier). **✅ `DiagnosticErrorBoundary` agregado** (`app/app/_components/DiagnosticErrorBoundary.tsx` + wrapper en `_layout.tsx`, DENTRO de SafeAreaProvider): en vez de crashear, MUESTRA el error JS en pantalla (name/message/stack/componentStack, seleccionable, solo primitivas RN, inerte en web) + handler global `ErrorUtils.setGlobalHandler` para async. TEMPORAL (marcado QUITAR). Verificado web (typecheck + e2e:build + boot smoke). Próximo build → Raf screenshotea el error exacto → fix preciso. **NOTA para iteración rápida:** cuando Raf esté en la PC, conviene dev build (`--profile development`) + `expo start` (redbox instantáneo + reload en segundos, sin rebuilds de 1h).

**✅ Error capturado + pasada 2 (op-sqlite) — 2026-07-16.** El build con el DiagnosticErrorBoundary mostró el error async exacto: **`Failed to install react-native-quick-sqlite: The native QuickSQLite Module could not be installed! ... JSI bindings: false`** (metroRequire/guardedLoadModule → module-load). Causa: **`@journeyapps/react-native-quick-sqlite@2.5.2` no instala sus JSI bindings bajo la New Architecture (bridgeless) de RN 0.85**. 2.5.2 es la ÚLTIMA versión de RNQS (sin fix). New arch no se puede apagar (reanimated@4 la exige). **Camino soportado por PowerSync para new arch = op-sqlite.** Investigación de compat (leader): el adapter `@powersync/op-sqlite` cap-ea op-sqlite en `^15` (max 15.2.14, mayo 2026) en TODAS sus versiones; elegido `@powersync/op-sqlite@0.9.9` (pide `common ^1.53.2` = nuestro exacto → NO se bumpea el sync engine) + `@op-engineering/op-sqlite@15.2.14`. **Switch aplicado (implementer):** removido quick-sqlite, `database.ts` rama native ahora usa `OPSqliteOpenFactory({ dbFilename })` (require guardado por Platform; API confirmada contra los .d.ts 0.9.9). Metro: NADA agregado (el config recomendado es solo bare-RN, no Expo; el fix CJS de supabase intacto). Verificado web: typecheck + e2e:build + boot smoke verdes. `@powersync/common` sigue en 1.53.2 (una sola copia). **RIESGO bleeding-edge:** op-sqlite 15 (mayo 2026) puede quedar corto para RN 0.85 (jul 2026) → puede no compilar/andar en el build; el DiagnosticErrorBoundary sigue puesto para ver el próximo error. **Plan B si op-sqlite 15 no anda en RN 0.85:** bajar Expo SDK a una versión que PowerSync soporte 100% en nativo (cambio grande, se charla). Build lo tira el leader vía eas. Reconciliar spec 15 (PowerSync) al cerrar el bring-up.

### 🎉 HITO — la app CORRE EN NATIVO (iOS), llega al login (2026-07-16)
El build con op-sqlite (pasada 2) **compiló contra RN 0.85** (el riesgo bleeding-edge NO se dio) y, instalado en el iPhone de Raf, **arrancó bien y mostró la pantalla de login**. De "crashea al instante" → "corre en device" en una sesión. **op-sqlite resolvió el driver SQLite nativo bajo New Architecture.** El bring-up nativo (quick-sqlite→op-sqlite + polyfills url/crypto + custom entry) FUNCIONA en iOS. El APK de Android tiene el mismo código → debería andar igual (a validar cuando Raf tenga el device Android que va a comprar).
**Pendiente de validar en device (email/password, sin depender de Google):** login → Auth prod → JWT → PowerSync prod → sync; crear un animal (ejercita el polyfill de `crypto.randomUUID`). El `DiagnosticErrorBoundary` SIGUE puesto (útil hasta validar el flujo completo — BLE nativo/otros gaps podrían aparecer más adelante; recién ahí se quita, marcado QUITAR).
**Google/Apple login NO anda en el build (esperado, NO es bug):** feature 19 bloqueada por config OAuth externa (Google Cloud + Supabase provider en prod + Apple Services ID/Key). Para probar el flujo ahora = email/password (cuenta prod con Auto Confirm). La config OAuth es un paso aparte (external-setup-raf.md).
**prod vs dev lo define `--profile`:** preview/production → PROD; development → DEV. El APK instalado (preview) = PROD.

### ✅ Login social nativo VALIDADO en device + botón Apple unificado (2026-07-17/18)
Probando el build `preview-dev` (DEV) en el iPhone de Raf: **email/password + Google + Apple andan los 3 en nativo.** Google fallaba (Apple no): causa = `GoogleSignin.configure` sin `iosClientId` (el plugin setea el URL scheme pero no el GIDClientID); fix = `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` wireado (commit `cd0f231`) → **Google anda**. Queda sacar el `[debug: code]` temporal de `auth-errors.ts` + la config OAuth de Google en PROD (external-setup-raf.md). **Botón Apple (pedido de Raf, comparado vs golds de Mobbin):** el `.native.tsx` usaba el botón NATIVO del sistema (SF font, "Continue with Apple" en inglés, logo/texto más grandes) → outlier vs el de Google. Mobbin (ChatGPT/Notion/Dropbox/MyFitnessPal/DoorDash/Withings): TODAS usan botones sociales custom armonizados, ninguna el nativo distinto. Fix: extraída la vista custom compartida (`AppleSignInButtonView.tsx`, ya existía en la variante web) → **iOS ahora renderiza el botón custom** (negro `$textPrimary`, Apple mono blanco, "Continuar con Apple", Inter `$5`, mismo alto/pill/logo que Google). **Flujo de auth de Apple INTACTO** (solo cambió el UI del botón; Apple sigue andando). Apple HIG permite botón custom si es reconocible (logo + texto aprobado) — se abandona la garantía "botón nativo" del design §D a propósito, pedido de Raf. Vetado por el leader en render web (par unificado, descendentes OK). **TODO reconciliar spec 19** (`design.md` §D / R4.3 native→custom + nota App Store) — NO tocado ahora porque otra terminal está editando specs/active/19-login-social/ (colisión-safe). Alternativa anotada: unificación total (Apple también blanco-borde, estilo ChatGPT/Notion) si Raf la prefiere.

### 🔎 Google login nativo — falso positivo → root cause por logs → skip_nonce_check (2026-07-18)
Google era falso positivo: el picker abría (fix iosClientId) pero al elegir cuenta NO creaba sesión (mismo banner de error; el `[debug: code]` no salía → el error venía sin `code`). **Diagnóstico por los logs de Auth de DEV (MCP get_logs)** — error server-side EXACTO: `invalid request: Passed nonce and nonce in id_token should either both exist or not` (`grant_type=id_token`, 400). Causa: el SDK nativo de Google mete un **nonce** en el idToken; la app llama `signInWithIdToken` **sin** nonce (diseño R1.6: "Google = firma+audience, sin nonce") → Supabase rechaza el mismatch. **Opción B (nonce propio) NO viable:** `@react-native-google-signin@16.1.2` (ÚLTIMA versión + la que banca Expo SDK 56) NO expone `nonce` en `SignInParams` (ni clásico ni One Tap); el nonce lo agrega el SDK nativo internamente y no lo devuelve → no se puede reenviar. Es el issue conocido #1176 del repo. **Fix (Raf autorizó, toca seguridad):** `external_google_skip_nonce_check=true` en Supabase **DEV** (PATCH Management API, 200) → valida por firma+audience, saltea solo el anti-replay del nonce (consistente con R1.6). **Apple NO se tocó** (mantiene nonce). **TODOs:** (a) replicar `skip_nonce_check=true` a **PROD** (`bcrsgekkfcdpwvkebsqe`) cuando se configure Google OAuth en prod; (b) reconciliar spec 19 (R1.6 + external-setup-raf.md: Google nativo requiere skip_nonce_check) — NO tocado por colisión con otra terminal; (c) **sacar los diagnósticos temporales** cuando el flujo esté validado: el `[debug: code]` de `auth-errors.ts` (marcado QUITAR) + el `DiagnosticErrorBoundary` (`_layout.tsx` + componente).

### 🛠️ Dev client + Metro (iteración nativa rápida) + 🐛 BUG DE TAPS sistémico + barrido (2026-07-18)
**Dev client + Metro:** instalado `expo-dev-client` + buildeado el perfil `development` (dev client iOS) + Metro corriendo en la PC (`expo start --dev-client`, LAN `192.168.0.93:8081`, watch/reload). Raf conecta el dev client → itera fixes JS con RELOAD instantáneo (sin builds de 5 min). `app/.env.local` (gitignored) tiene las 3 vars dev + **se le agregaron `EXPO_PUBLIC_GOOGLE_WEB/IOS_CLIENT_ID`** (Metro los inlinea; sin ellos Google fallaba en el dev client con "iosClientId was not provided" — los builds EAS los toman de eas.json).
**BUG DE TAPS (nativo, new arch):** los taps NO disparaban en filas/cards/botones de casi toda la app (fichas, selector de campos, Miembros, etc.). Causa: patrón `<Pressable onPress>` (RN core) envolviendo un componente Tamagui con `pressStyle` → en nativo el Tamagui interno reclama el responder de touch para su visual de press y el Pressable externo nunca recibe el release → `onPress` no dispara. En WEB anda (el click burbujea, no hay responder) → por eso nunca se detectó (app web-only). **Fix:** `onPress` + a11y (`buttonA11y`/`labelA11y`) en la MISMA pieza Tamagui que tiene `pressStyle`, sin Pressable externo (patrón de GoogleSignInButton). [[reference_rn_pressable_tamagui_tap]].
**Barrido (~120 conversiones, ~40 archivos):** el 1er intento app-wide-en-un-pase SE COLGÓ 1h30 + rompió sheets de maniobra (stasheado a `pressable-sweep-wip`, revertido). Re-hecho en **6 LOTES chicos** (verificados `tsc`-verde + committeados de a uno, sin git en el implementer, sin e2e lento por lote): cc73222 (4 archivos base) + fe8201b/a1bc9fe/a14fb5d/fb18c50/edd28b0/47a4b5c (lotes 1-6). Confirmado en device por Raf lote por lote (fichas/selector/manga/Miembros andan). Falsos positivos (backdrops/scrims/X/back/íconos sin pressStyle) vetados.
**E2e web final: 210 passed / 18 failed — SWEEP LIMPIA (cero regresiones).** Los 18 reds: (a) mayoría tacto-adaptativo/maniobra = **pre-existentes** (fallan en `getByRole('button',{name:'PREÑADA'})` de `TactoStep.tsx`, que la sweep NO tocó; área WIP spec 03 B2, ya incluía `maniobra-carga:133/277`); (b) treatments/cut-ficha = flake de **rate-limit de auth** (44 min de signups → "tab Animales no encontrada" = seed falló → onboarding sin tabs). Los tests que ejercitan componentes convertidos (animals/establishments/operaciones/lotes/social-login) **pasaron todos**. `design/` revertido tras el e2e (PNGs espurios).
**Pendiente:** validación de Raf del flujo maniobra en device; sacar los diagnósticos temporales (DiagnosticErrorBoundary + `[debug]`); reconciliar specs del bug de taps si aplica.

### 🔎 Hallazgo técnico (2026-07-12) — PowerSync publication es `FOR ALL TABLES`
Verificado en vivo contra dev: el `powersync` publication es **`FOR ALL TABLES`** (`puballtables=true`), NO `FOR TABLE` explícita como asumía el plan/context. Consecuencia: al crear `audit.record_version` (feature 18), entraría automáticamente al WAL que PowerSync replica (el riesgo que el plan quería evitar). Las 35 tablas de la app viven en `public`; no hay schema `audit`/`ops` aún; `cron` existe (pg_cron OK para retención).
**Mitigación recomendada** (a bajar a la design de 18 + runbook de 16): cambiar el publication a **`FOR TABLES IN SCHEMA public`** (PG15+) → mantiene el auto-include de tablas nuevas de `public` (cero riesgo de que a PowerSync le falte una tabla) y **excluye el schema `audit`** del WAL. Alternativa (Option B): dejar ALL TABLES y confiar en que `audit` no está en ninguna sync stream → nunca llega al device; documentar el residual (overhead de WAL). Recomiendo Option A. **El cambio de publication es un deploy gateado (autz de Raf en sesión).** Se reconcilia en el fix-loop del spec_author de 18 tras Gate 1.

### Orden de ejecución
E.0 (chore, desbloquea build) → E.1 (ambientes, SDD) → E.4 (audit log, la parte más autónoma) → E.2/E.3 (Sentry/PostHog, tras build verde) → E.5 (ops, cierra 16). El audit log (E.4) es 100% server-side y testeable contra dev sin cuenta externa.

### Gates pendientes de Raf (SDD)
Puerta 0 (contexto) de 16 → luego Puerta 1 (spec) → Puerta 2 (código). Feature 17 va detrás (buffer de refinamiento 2-3, ADR-022).

## 2026-07-29 — ✅ PUERTA 2 CERRADA: toda la serie «teclado + aire» verificada en device Android (Raf)

Veredictos de Raf en device (Samsung, barra de 3 botones), sobre los APK `a3b8d804` y `ca1ab604`:

| reporte original | commit | veredicto |
|---|---|---|
| el teclado tapa el sheet de Vacunación | `eabfd00` | ✅ |
| CTA "Nueva jornada" y navbar pegados a la barra | `4f1f86b` | ✅ |
| el teclado tapa `identificar` (el input y "Buscar") | `56beff3` | ✅ |
| la flecha de atrás con el teclado abierto no lo bajaba y tapaba el diálogo de salir | `615328d` | ✅ |
| crash del worklet al arrastrar el grabber con el teclado abierto | `8cc37f3` | ✅ no reapareció (build Release, sin `callGuard` → prueba válida) |

**Lo que cierra esto**: los 5 reportes de Raf de esta serie eran bugs **de CLASE**, no de instancia, y
**ninguno era observable desde la suite** (web no monta teclado virtual y `insets.bottom` es 0). La
cobertura durable que quedó son los guards estáticos, y su pregunta se dio vuelta: de *"¿alguien usa mal
el mecanismo?"* a *"¿hay alguna superficie sin él?"* — así una superficie nueva nace en ROJO.

**⏸ Sigue pendiente**: nada de esta serie está verificado en **iOS** (cuota de EAS agotada hasta el
**2026-08-01**). Las 23 superficies de la barrida estaban rotas ahí también, así que iOS cambió y no se
pudo mirar. Es la deuda de verificación más grande abierta.

**Falsado en device (Raf, 2026-07-29)**: el patrón `<Pressable>` envolviendo un Tamagui **SIN
`pressStyle`** NO mata el tap (probado con la flecha de atrás de `miembros.tsx:154`). Los 24 casos vivos
en 19 archivos están **sanos** → no hay barrido pendiente, y el stash `pressable-sweep-wip` que dejó la
terminal de BLE al morir queda **descartado** (premisa falsada + su contenido de feature 19 ya estaba
superado por HEAD).

## 2026-07-29 — BUGFIX «sin transporte, la UI deja de prometer el bastón» — `69ce945`, APK `b25064ab` — ⏸ PUERTA 2

**Cómo apareció**: Raf, device Android — *"el botón de conectar bastón no me está funcionando"*.

**No estaba roto: en Android nativo NO HAY TRANSPORTE, por diseño.** `react-native-ble-plx` no está
instalado; `adapter-selection.ts` devuelve `'manual'` en nativo e `instantiateTransport('manual')`
devuelve `null` (`spp-android` = Fase 4, gateada). El único transporte real es Web Serial. El defecto
era que el chip ofreciera "Conectar bastón" **sin mirar si hay transporte**, contradiciendo al hero de
su propia pantalla. Mismo Norman que el grabber que no arrastraba.

**Titularidad**: Raf pasó BLE a esta terminal (*"la terminal BLE murió, continuemos su trabajo acá"*).
Las exclusiones de `docs/backlog.md` del tipo "lo hace la terminal de BLE" quedaron obsoletas.

**Lo que aportó cada actor** (ninguno de los tres pasos fue redundante):
- El **implementer** encontró 3 cosas fuera del encargo — la **trampa de la Fase 4** (la fila del device
  decide si es tocable por capacidad de BUILD y al tocarla llama al transporte REAL: coinciden por
  casualidad), un copy suelto en JSX que ofrecía bastonear y que halló **mirando una captura, no el
  código**, y una regresión de layout que su propio fix causaba. Además se vetó a sí mismo `$textFaint`
  (4,03:1 sobre 14px = bajo AA en pantalla de manga).
- El **reviewer** encontró la superficie que la barrida **no vio, y era la peor**: `asignar-caravanas`,
  sin ninguna entrada manual, congelada en *"Bastoneá para empezar"*, a **2 taps del tab "Más"** —
  mientras que `/baston`, que sí se barrió, es deep-link-only.
- El **leader** midió la captura (título 18,36:1 · apoyos 5,74:1, sobre AA) y bajó a 🟡 la trampa de la
  Fase 4: es endurecimiento preventivo (hoy no-op en las 3 plataformas), no un defecto vivo. Si todo
  es 🔴, nada es 🔴.

**Decisión de diseño, con dos criterios distintos a propósito**: el **chip se oculta** (es un indicador
cuyo estado no puede cambiar sin transporte → etiqueta fija, ruido), pero la fila de
**`asignar-caravanas` NO se oculta y dice la verdad** (es entrada a una función real; ocultarla la
volvería indescubrible). El copy reusa la frase ya existente y ofrece una salida **verificada** (cargar
de a una desde la ficha, con E2E verde), no una supuesta.

**Deuda que dejó**: la salida del vacío es descriptiva, no accionable (falta CTA) · `$textFaint` tiene
60 usos, varios en 12/13/14px → clase de contraste a barrer · la Fase 4 sigue gateada (sin RS420).
