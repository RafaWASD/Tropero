# impl — «el bastón tiene que sonar y vibrar de verdad en la manga»

**Unidad**: 🟡-11 + 🟡-12 de `progress/sweep_bluetooth-edge-cases.md` · feature **04** (bluetooth-bastón)
**Fecha**: 2026-08-06 · **baseline_commit: `a40e69b`** (= `HEAD` al arrancar; árbol limpio salvo
`docs/marketing/*`, que es de otra terminal y **no se tocó**)
**Estado**: **FIX-LOOP DEL REVIEW CERRADO** (ver §11 al final). **NADA COMMITEADO.**

> ⚠️ **§1 y §8 de este informe afirmaban que «el APK actual cae al fallback de `Vibration`». Era FALSO** y
> lo encontró el reviewer: ese respaldo era código muerto. Está corregido en el código y explicado en
> §11.1. Dejo la afirmación original en su lugar en vez de reescribirla en silencio, porque el error de
> método importa más que el error de código.

---

## 0. Resumen

| # | Pedido | Estado |
|---|---|---|
| 1 | Canal táctil real (`expo-haptics`) en el punto único | ✅ `notificationAsync` Success/Error + **fallback a `Vibration`** |
| 2 | Beep real en nativo (`expo-audio`) con asset en el repo | ✅ 2 WAV **generados** por `scripts/gen-baston-sounds.mjs` |
| 3 | Feedback NEGATIVO distinto para `eid_rejected` | ✅ háptica `Error` + doble pip grave descendente (R4.8) |
| 4 | UI de la preferencia (R4.3) con call site de `writeBeepEnabled` | ✅ tarjeta «Aviso de lectura» dentro de `/baston` (cierra T6.4) |
| 5 | `readBeepEnabled()` fuera del camino caliente | ✅ caché en memoria puro + invalidación al escribir (R4.9) |
| — | Corregir la justificación falsa de `haptics.ts` | ✅ + `feedback.ts` + spec 03 (×4 sitios). ADR-011 y CONTEXT/06 **no** la repetían |
| — | No debilitar el guard `read-dispatch` | ✅ se **amplió** (era burlable con `playRejectFeedback()`) + guard nuevo de módulos/assets |

**Dos defectos de campo aparecieron en la autorrevisión y se cerraron acá** (detalle en §6): el beep se
habría quedado **mudo del segundo bastonazo en adelante**, y habría **cortado la radio del peón** en cada
animal.

---

## 1. Verificación — «lo ejecuté y lo vi» vs. «lo leí»

### Lo EJECUTÉ y lo VI

| Qué | Resultado |
|---|---|
| `pnpm typecheck` | **verde** (RC=0) |
| `node scripts/check.mjs` **completo** | **RC=0**, `All tests passed` (incluye backend contra la DB remota) |
| Unit de la unidad (`feedback` + `feedback-guard` + `beep-pref-cache` + `read-dispatch` + `connection-view` + `app.config`) | **106/106** |
| **18 mutantes** contra los guards nuevos y ampliados | **18 muertos**, árbol restaurado a verde (§5) |
| E2E nueva `baston-feedback-sensorial.spec.ts` | **2/2** |
| E2E de regresión del bastón (`baston`, `-chip`, `-dedup`, `-ficha`, `-multivendor`, `-lectura-sin-consumidor`) | **21/21** |
| E2E que consumen lecturas (`alta-bastoneo`, `parto-bastoneo`, `cria-al-pie-bastoneo`, `asignar-caravanas-sin-transporte`, `identificadores-unificados`) | **19/19** |
| Capture del Gate 2.5 | **1/1**, 8 PNG generados |
| `npm view expo-haptics/expo-audio scripts dependencies` | `dependencies: {}`, **cero** postinstall/install/prepare |
| `pnpm install --frozen-lockfile` | sin "ignored build scripts"; `onlyBuiltDependencies` **sin cambios** en el diff |
| `git status -- design/` tras las corridas E2E | **limpio** (no se ensuciaron los PNG de diseño) |
| Los `.wav` generados | RIFF/WAVE PCM 16-bit mono 44,1 kHz, pico 0,890 FS, 110 ms / 250 ms, con el gap del doble pip |
| `metro-config` assetExts | incluye `wav` (verificado ejecutando `getDefaultConfig`) |
| Las 8 capturas | **miradas una por una**; re-iteré el diseño de la fila tras ver la primera tanda (§4) |

### Lo LEÍ (no lo pude ejecutar)

- **El código nativo de `expo-audio`** (`ios/AudioModule.swift`, `ios/AudioPlayer.swift`,
  `android/src/main/AndroidManifest.xml`, `plugin/src/withAudio.ts`). De ahí salen tres conclusiones que
  cambiaron la implementación: `play` es `Function` **síncrona** y `seekTo` `AsyncFunction`; el fin de
  reproducción deja `actionAtItemEnd = .pause`; y el config plugin agrega `RECORD_AUDIO` por default.
- **Que `requireNativeModule` tira al importar** cuando el módulo nativo no está (base del `try/catch`
  que hace esto OTA-safe). Es el patrón documentado de expo-modules, no lo ejercí sin el módulo.

### Lo que NO se puede verificar sin device — **queda abierto**

- **Que el pip de 3150 Hz se oiga de verdad sobre el ruido de una manga real**, y que los dos patrones
  hápticos se distingan **con guante**. Es lo único que decide si esta unidad cumplió su objetivo, y no
  hay forma de saberlo en CI ni en web. Va a T7.4 (QA de campo).
- **Nada de esto corre en el APK instalado hoy**: las dos deps traen módulo nativo → **cambia el
  fingerprint** y hace falta un build de EAS. **No lancé ninguno.** Mientras tanto el APK actual cae al
  fallback de `Vibration` y el audio queda apagado sin crashear.

---

## 2. Trazabilidad `R<n> → archivo:test`

| Requisito | Test concreto |
|---|---|
| **R4.1** (háptica siempre, no apagable) | `feedback.test.ts` → *«R4.1: en native la háptica se dispara SIEMPRE, con sonido ON y con sonido OFF»* + *«INVARIANTE: la preferencia apaga el SONIDO y nunca el canal táctil»* |
| **R4.1** (fallback si no está el módulo) | `feedback-guard.test.ts` → *«el punto único SÍ importa los dos canales»* (assert del `Vibration` de fallback) |
| **R4.2** (sonido real en device) | `feedback.test.ts` → *«R4.2/R4.3: el sonido se dispara SOLO con la preferencia habilitada»*, *«los cues mapean 1:1 a los assets»*; `feedback-guard.test.ts` → *«todo cue alcanzable… tiene su asset»*, *«los .wav son PCM 16-bit mono decodificables»* |
| **R4.2** (sin micrófono / sin plugin) | `app.config.test.ts` → *«`expo-audio` NO se engancha como config plugin»* |
| **R4.3** (preferencia + UI + persistencia) | `connection-view.test.ts` → 4 tests del copy; **E2E** `baston-feedback-sensorial.spec.ts` → *«R4.3: el switch de sonido existe, silencia el aviso SIN romper la ingesta, y persiste»* |
| **R4.5** (degradación web) | `feedback.test.ts` → *«R4.5: en web el canal táctil se degrada en silencio»*, *«R4.5: el canal del sonido es web-audio en web y native en device»* |
| **R4.7** (punto único ampliado) | `read-dispatch.test.ts` → *«el feedback SENSORIAL… se emite en UN SOLO punto»* + *«MUTANTES 2026-08-06»*; `feedback-guard.test.ts` → *«solo el punto único importa un módulo capaz de emitir»* |
| **R4.8** (negativo distinto) — NUEVO | `feedback.test.ts` → *«R4.8: "llegó algo y no servía" NO produce la misma señal que "entró" — en NINGÚN canal»* + *«…con el sonido APAGADO la distinción sobrevive por el canal táctil»*; `feedback-guard.test.ts` → *«el aviso NEGATIVO no es el mismo archivo que el positivo»*; **E2E** → *«el vocabulario tiene DOS palabras»* (`[3150]` vs `[1300,850]`) |
| **R4.9** (fuera del camino caliente) — NUEVO | `beep-pref-cache.test.ts` → 9 tests (default, `false` no pisado, invalidación, sincronía, la carrera) |
| **R3.1** (re-lectura muda) | `feedback.test.ts` → *«una re-lectura (duplicate) es MUDA en los dos canales y en las dos plataformas»*; **E2E** → lado (c) |
| **R4.6 / R15.2** (no romper la ingesta) | `read-dispatch.test.ts` (intacto, 🔴-2) + **E2E** `baston-lectura-sin-consumidor.spec.ts` (1/1) + **E2E** de esta unidad: con el sonido apagado, la lectura **igual entra** |
| — modo de audio (no cortar la radio) | `feedback-guard.test.ts` → *«el aviso NO pide foco de audio»* |

---

## 3. Decisiones (y sus porqués)

**3.1 · `notificationAsync`, no `impactAsync`.** Lo que falta en la manga no es "más fuerte" sino
**distinguible**. Los `NotificationFeedbackType` son *patrones* que el SO ya usa para "salió bien"/"salió
mal" en todo el teléfono: el peón los reconoce sin que nadie se los enseñe y no los confunde con un
mensaje entrante. En iOS además manejan el Taptic Engine, cosa que `Vibration.vibrate(ms)` ni alcanza (en
iOS ignora la duración y hace un zumbido crudo fijo).

**3.2 · Los sonidos se GENERAN, no se bajan.** `scripts/gen-baston-sounds.mjs` sintetiza los dos WAV. Un
asset bajado de un banco trae licencia que rastrear, ningún fundamento de por qué ese sonido, y cero
capacidad de ajuste. Acá **los parámetros de síntesis SON la documentación**:

- **`read-ok`**: un pip de **3150 Hz, 110 ms**. El parlante de un teléfono casi no emite bajo ~700 Hz y
  rinde mejor en 2–4 kHz, justo donde el oído humano es más sensible y donde el ruido de la manga (vacas,
  motor, portones) tiene menos energía — o sea, es **lo más fuerte que un teléfono puede hacer con la
  misma potencia**. Es además la banda del beep de un lector de código de barras: se lee como "el aparato
  leyó" sin que nadie lo explique.
- **`read-error`**: **dos pips descendentes, 1300 → 850 Hz, 250 ms** en total. Distinto en las tres
  dimensiones que se perciben con ruido: altura (más grave), cantidad (dos) y duración (más del doble).
  Descendente = convención universal de "no".
- Ambos con 3.º armónico al 28 % (un tono con armónicos impares se recorta sobre ruido de banda ancha
  mejor que una senoidal del mismo RMS) y envolvente suave (un corte cuadrado hace un click de banda
  ancha que ensucia el transitorio). **Normalizados al pico real** — la primera versión regalaba ~4 dB
  por dividir por una cota teórica en vez del máximo medido.

**3.3 · Solo `eid_rejected` recibe señal negativa.** Es el único caso en el que **sabemos que llegó algo
y no sirvió**. El resto sigue en silencio, y está fundamentado en R4.8: la re-lectura dentro de los 3 s
**ya entró** (avisarle "no sirvió" sería mentir en la otra dirección; confirmarla de nuevo sería el modo
de falla de 🔴-2); "bastón mudo" y "gatillo mal apretado" **no producen evento** y señalar una ausencia
exigiría un temporizador que alarme al peón que camina o abre un portón — un aviso que suena cuando no
pasa nada se aprende a ignorar. Ese hueco es del **indicador de conexión**, no del feedback de lectura.

**3.4 · La UI va en `/baston`** (ubicación que venía decidida; la confirmo con argumento). Es la casa del
bastón, es donde el operario ya está cuando el aviso le molesta o no le alcanza, y —lo que decide— es **la
única pantalla donde puede probar el cambio en el acto**: bastonea, escucha, y la lista de Lecturas le
confirma que la lectura entró igual con el sonido apagado. En "Más" sería un ajuste huérfano al lado de
"Eliminar cuenta".

**3.5 · La preferencia apaga TODO el sonido, nunca la háptica.** El motivo por el que alguien lo apaga
—ruido, molestia— no distingue desenlaces, y la distinción "entró"/"no sirvió" sobrevive por el canal
táctil, que no es apagable (R4.1). El copy lo dice explícitamente en los dos estados, y hay un test que
lo exige: si el peón cree que apagó "el aviso", va a pensar que rompió el bastón.

**3.6 · El config plugin de `expo-audio` NO se engancha** (decisión de seguridad, §7).

**3.7 · `playsInSilentMode: true` — decisión de producto, reversible en una línea.** El aviso suena
aunque el teléfono esté en silencio. El peón silencia el teléfono por WhatsApp, no para desactivar su
lector, y si le sobra tiene el switch. Respetar el silencio dejaría el beep muerto justo para quien más
lo necesita. **Si Raf prefiere lo contrario, es cambiar `true` por `false` en `FEEDBACK_AUDIO_MODE`** (y
el test de `feedback-guard.test.ts` obliga a hacerlo a conciencia).

---

## 4. Diseño (Gate 2.5)

`app/e2e/captures/baston-feedback-sensorial.capture.ts` → 8 capturas nombradas en
`app/e2e/captures/__shots__/baston-feedback-sensorial/` (gitignoreadas, **no** se hizo `git add`):

```
01-mas-fila-baston                     la RUTA real (si a la preferencia no se llega, no existe)
02-baston-arriba-estado-y-dispositivos dónde cae la tarjeta en la jerarquía
03-aviso-sonido-encendido              estado default
04-aviso-sonido-apagado                copy que cambia + el switch
05-lecturas-vacio-con-aviso            composición vacía
06-lectura-aceptada-entra-a-la-lista   desenlace positivo
07-lectura-rechazada-la-pantalla-no-cambia   ← casi idéntica a 06: ESO es el 🟡-12
08-aviso-apagado-persiste-tras-recargar
```

**Auto-veto y re-iteración**: en la primera tanda el ícono de volumen quedaba centrado sobre el bloque
entero, o sea a la altura del **segundo renglón del sub-copy** — por proximidad (Gestalt) se leía como
viñeta de la frase equivocada en vez de etiquetar el título. Lo moví **adentro de la fila del título** y
volví a generar. Anatomía final: título de tarjeta ($5/700) → `[🔊 Sonido al leer ————— switch]` →
sub-copy ($3, muted, 2 renglones) → nota del vocabulario ($3, faint). Fila entera tappable (≥`$touchMin`,
Fitts: con guante nadie acierta una pista de 48 dp), toggle con la anatomía canónica del repo
(`$toggleTrack`/`$toggleKnob`, igual que `FieldTemplateToggleList`), `switchA11y` con `role=switch` +
`aria-checked` (lo verifica la E2E), tokens-only, `lineHeight` matcheado en todo `Text`, es-AR voseo (hay
un test que rechaza tuteo).

---

## 5. Mutantes — 18 lanzados, 18 muertos

Cada uno se aplicó al árbol real, se corrió la suite, y se restauró. **El primero de la lista es el
agujero que el guard existente tenía y que había que cerrar, no inventar.**

| # | Mutante | Guard que lo mata |
|---|---|---|
| M3 | **`playRejectFeedback()` antes del gate** — el patrón viejo nombraba `playFeedback` LITERAL, así que este pasaba en verde | `SENSORY_EMIT` ampliado a `play[A-Z]\w*` |
| M1 | El punto único deja de usar `expo-haptics` | `feedback-guard` (el punto único SÍ importa los dos canales) |
| M2 | `Vibration.vibrate(50)` en el provider antes del gate | orden + punto único |
| M4 | El `.wav` de error es una **copia** del de ok | `feedback-guard` (negativo ≠ positivo) |
| M5 | `decideFeedback` devuelve el mismo patrón háptico para `rejected` | R4.8 (×3 tests) |
| M6 | Otro archivo de `services/ble/` importa `expo-audio` | guard de MÓDULOS |
| M7 | El `.wav` de error queda en **silencio** (muestras a cero) | assets (pico > 16384) |
| M8 | El `.wav` de error truncado a la cabecera | assets (tamaño + coherencia RIFF) |
| M9 | `playFeedback` invocado **dos** veces en el provider | `invocaciones === 1` |
| M10 | `primeFeedback` (warm-up) se cuela dentro de `handleReading` | guard nuevo |
| M11 | Un cue nuevo (`read-dup`) **sin asset** | assets derivados de la decisión (5 tests caen) |
| M12 | La preferencia apaga **también** la háptica | invariante R4.1 |
| M13 | El caché pisa el `false` con el default (`??` → `||`) | `beep-pref-cache` |
| M14 | El gate vuelve a contar **suscriptores** (regresión 🔴-2) | `read-dispatch` (intacto) |
| M15 | El modo de audio pide **foco** (`doNotMix`) → le corta la radio al peón | `feedback-guard` (modo de audio) |
| M16 | El punto único deja de fijar el modo de audio | idem |
| M17 | El modo se reescribe con un literal propio (la constante queda decorativa) | idem |
| M18 | Se cae el fallback a `Vibration` (APK viejo sin canal táctil) | `feedback-guard` |

**Cómo se burla lo que queda — dicho explícitamente.** El guard de NOMBRES no puede ver un emisor con un
nombre arbitrario (`avisar()`, `zumbar()`). Por eso existe el guard de **MÓDULOS**: no se puede hacer
sonar ni vibrar un teléfono sin importar algo, y ese conjunto es chico y enumerable
(`expo-haptics|expo-audio|expo-av|expo-speech` + `Vibration` de RN). **Lo que sigue sin ver**: un canal
que use un módulo que no está en esa lista (una lib de sonido de terceros nueva). Se cierra agregando una
línea a `SENSORY_MODULES`, y está anotado en la cabecera del guard.

---

## 6. Autorrevisión adversarial — qué busqué, qué encontré, cómo lo cerré

Busqué: desviaciones del pedido, bugs de plataforma no testeables en CI, edge cases (primer arranque,
ráfaga, storage caído, carreras), gaps de seguridad, offline-first, multi-tenant, y tests que pasan por la
razón equivocada.

**Encontrado y CORREGIDO (los tres primeros son defectos de campo reales):**

1. 🔴 **El beep habría quedado mudo del segundo bastonazo en adelante.** Escribí
   `void player.seekTo(0); player.play();`. Fui a leer el módulo nativo: `play` es una `Function`
   **síncrona** y `seekTo` una `AsyncFunction` → el `play()` corría **primero**, sobre un player parado en
   el final (`actionAtItemEnd = .pause`), y el seek después. En CI y en web no se nota (web usa Web
   Audio). **Fix**: encadenar `seekTo(0).then(play, play)` — cuesta un round-trip del puente (ms contra un
   cue de 110 ms) y si el seek falla igual se intenta reproducir.
2. 🔴 **Cada bastonazo le habría cortado la radio al peón.** Sin fijar el modo de audio, iOS deja la
   sesión en el default del SO (`soloAmbient`), que **interrumpe el audio de otras apps**. En una manga
   donde se trabaja con la radio prendida, el peón habría apagado el aviso el primer día → 🟡-11 de vuelta
   por la puerta de atrás. **Fix**: `FEEDBACK_AUDIO_MODE` con `interruptionMode: 'mixWithOthers'` (la
   propia doc de expo-audio lo recomienda para "sound effects, UI feedback, or short audio clips"),
   aplicado una vez desde `primeFeedback`, guardado **por valor**.
3. 🟠 **El switch se "des-tocaba" solo.** La lectura del storage es asíncrona y tiene **dos**
   disparadores (el warm-up del provider y la pantalla). Si el peón movía el switch con una lectura en
   vuelo, la lectura volvía con el valor viejo y pisaba el caché **y** la UI. **Fix**:
   `settleReadBeepEnabled(valor, writesAtStart)` — si hubo una escritura del operario desde que la lectura
   arrancó, **la lectura pierde**; el caller pinta con el retorno. Con su contrafáctico (sin carrera, la
   lectura SÍ asienta), porque "descartar siempre" pasaría el test principal.
4. 🟠 **Dos toques rápidos podían asentarse fuera de orden en el disco** (el caché quedaba bien, así que
   el síntoma aparecía recién en el arranque siguiente: diferido y sin causa visible). **Fix**: cola de
   escrituras (`writeQueue`), y `readBeepEnabled` la espera antes de leer.
5. 🟠 **El guard del punto único era burlable con el nombre que esta misma unidad necesitaba**
   (`playRejectFeedback`). Ampliado a `play[A-Z]\w*` + las APIs de los módulos nuevos, con la allowlist
   del provider verificada **token por token** (el filtro viejo, `!/\bplayFeedback\b/.test(line)`, se
   pasaba metiendo dos canales en el mismo renglón).
6. 🟠 **El warm-up (`primeFeedback`) podía colarse en el camino caliente** y devolver 🟡-11 con otra cara.
   Guard que lo prohíbe dentro de `handleReading`.
7. ⚪ **Ventana entre montar el provider y que conteste el storage**: un usuario con el sonido apagado
   podría oír un pip. Se acepta a propósito y está documentado: el warm-up corre al montar, muchísimo
   antes del primer bastonazo real (hay que conectar el bastón y acercarlo a un animal), y la alternativa
   —arrancar en OFF hasta saber— dejaría mudo el primer bastonazo de **todos** (el default es ON), que es
   el modo de falla peor.
8. ⚪ **Comentario obsoleto** en `baston-lectura-sin-consumidor.spec.ts` ("el feedback pasa por
   `readBeepEnabled()` (promesa)") → corregido; ya es síncrono.
9. ⚪ **Doble cast innecesario** (`as unknown as CuePlayer`) → sacado; el tipo de `expo-audio` encaja
   estructuralmente.

**Verificado y SIN hallazgo:**

- **Offline-first**: nada de esto toca la red. Assets empaquetados, háptica local, preferencia local
  (R14 intacto).
- **Multi-tenant**: la preferencia es de **dispositivo** (ergonomía, como el brillo), no de tenant. Cero
  `establishment_id` hardcodeado; la clave de storage no cambia entre campos y eso es correcto.
- **El feedback nunca rompe la ingesta** (R15.2/R4.5): cada canal envuelto, el `require` perezoso dentro
  de un `try`, y el `playFeedback` del provider además envuelto con su propio log. Verificado por
  comportamiento en la E2E (con el sonido apagado, la lectura **igual entra** a la lista).
- **OTA-safe**: un JS pusheado a un APK sin los módulos nativos no crashea — `requireNativeModule` tira al
  importar, se atrapa, y el canal queda apagado para la sesión sin reintentar por bastonazo.
- **Ráfaga**: el feedback ahora es **síncrono y en orden**; antes colgaba de una promesa por lectura y en
  una ráfaga el orden de los microtasks no estaba atado al de las lecturas.
- **Tests que pasarían por la razón equivocada**: la E2E tiene los **tres** lados (positivo suena y suena
  *lo que corresponde*, negativo suena *distinto*, duplicado no suena) — con solo el primero, "no sonar
  nunca" pasaba; con los dos primeros, "sonar siempre igual" pasaba.
- **`git status -- design/` limpio** tras todas las corridas E2E.

---

## 7. Seguridad — lo que va a mirar el Gate 2

- **Dos deps nuevas**, las dos de Expo, las dos con `dependencies: {}` y **cero scripts de
  postinstall/install/prepare** (verificado ejecutando `npm view`). El lockfile creció 32 líneas y
  `onlyBuiltDependencies` **no cambió** (ADR-011 intacto).
- **El config plugin de `expo-audio` NO se engancha.** Con sus defaults agrega `RECORD_AUDIO` (permiso
  **peligroso**, con diálogo al usuario), `NSMicrophoneUsageDescription`, `UIBackgroundModes:['audio']`,
  `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` y un `MediaSessionService` — todo para un pip
  de 110 ms de un asset empaquetado, que no necesita ningún permiso. Engancharlo "con todo apagado"
  tampoco aportaría: el único permiso que quedaría ya lo mergea la librería. **Fijado por
  `app.config.test.ts`** para que nadie "arregle el warning de expo-doctor" pegando la línea sin leer.
- **Lo que SÍ va a aparecer en el próximo APK**: `android.permission.MODIFY_AUDIO_SETTINGS`, que viene del
  `AndroidManifest.xml` **propio de `expo-audio`** y se mergea con o sin plugin. Es de nivel *normal* (sin
  diálogo). Lo digo acá porque va a saltar en el próximo `aapt2 dump permissions` y alguien va a preguntar.
- **Sin backend**: `git diff supabase/ sync-streams/` vacío → **Gate 1 N/A**. Sin red, sin PII, sin RLS,
  sin SQL, sin secrets. La preferencia es un `'1'`/`'0'` en `SecureStore`/`localStorage`.

---

## 8. Fingerprint y builds

**Las dos deps traen módulo nativo → cambia el fingerprint del build.** Para ver la háptica y el sonido en
el A07 hace falta un **build de EAS nuevo**. **No lancé ninguno** (lo gatea Raf, y es por plataforma).
Hasta entonces el APK instalado sigue funcionando: la háptica cae al fallback de `Vibration` y el audio
queda apagado, sin crashear.

---

## 9. Reconciliación de specs (hecha, antes del reviewer)

| Archivo | Qué se reconcilió |
|---|---|
| `specs/active/04-bluetooth-baston/requirements.md` | Notas de reconciliación bajo **R4.1** (canal táctil real + la corrección del motivo falso), **R4.2** (sonido real en device + assets + la decisión de permisos), **R4.3** (la UI que faltaba + alcance de la preferencia). **R4.8** y **R4.9 nuevos**, con el fundamento de por qué los otros desenlaces siguen mudos. |
| `specs/active/04-bluetooth-baston/design.md` | Sección **«AS-BUILT del feedback sensorial»** (vocabulario, invocación única, canales, `seekTo`+`play`, modo de audio, degradación/OTA, caché y sus dos carreras, UI, guards) + árbol de archivos actualizado. |
| `specs/active/04-bluetooth-baston/tasks.md` | **T6.4 cerrada** (con la ubicación y su porqué) + **T7.6 nueva** completa + tabla de trazabilidad (R4.1/4.2/4.5, R4.3/4.4, **R4.8/R4.9**) + nota de fase corregida. |
| `specs/active/03-modo-maniobras/{design,tasks}.md` | **Corrección del motivo FALSO** repetido en 4 sitios ("expo-haptics abriría superficie de postinstall"). Nota acotada: el motivo era falso, la dep ya está, y esos consumidores siguen con `Vibration` **por otra razón que sí vale** (ticks de 8–18 ms sin semántica de éxito/error). **No los refactoricé** — no son de esta unidad. |
| `app/src/utils/haptics.ts` | Cabecera reescrita: qué se verificó y cómo, que contradecía a **ADR-013 §Capa 4**, y cuál es el costo REAL (el fingerprint). Solo el comentario, como se pidió. |
| `app/src/services/ble/feedback.ts` | Ídem, en su cabecera. |

`ADR-011` y `CONTEXT/06` **no** repetían el motivo (verificado por grep) → no se tocaron. `ADR-013` ya
listaba `expo-haptics` en el stack, así que no hace falta ADR nuevo por la dep. **Queda una pregunta para
el leader**: si el *vocabulario sensorial* (qué patrón significa qué) merece ADR propio por ser un patrón
que otras features van a querer reusar. Yo no lo creé.

---

## 10. Archivos

**Nuevos**: `scripts/gen-baston-sounds.mjs` · `app/assets/sounds/{read-ok,read-error}.wav` ·
`app/src/services/ble/beep-pref-cache.ts` + `.test.ts` · `app/src/services/ble/feedback-guard.test.ts` ·
`app/e2e/baston-feedback-sensorial.spec.ts` · `app/e2e/captures/baston-feedback-sensorial.capture.ts`

**Modificados**: `app/package.json` + `pnpm-lock.yaml` · `app/app.config.test.ts` ·
`app/src/services/ble/{feedback.ts,feedback-logic.ts,feedback-pref.ts,feedback.test.ts,read-dispatch.test.ts,BleStickListenerProvider.tsx}` ·
`app/src/features/ble-stick/{connection-view.ts,connection-view.test.ts,screens/StickConnectionScreen.tsx}` ·
`app/src/utils/haptics.ts` (solo la cabecera) · `app/e2e/baston-lectura-sin-consumidor.spec.ts` (comentario) ·
`scripts/run-tests.mjs` · las 5 specs de §9.

**No se tocó**: `docs/marketing/*` (otra terminal), `feature_list.json`, `supabase/`, `sync-streams/`,
`design/`, ni los consumidores de `utils/haptics.ts`.

---

# 11. FIX-LOOP del review (2026-08-06) — CHANGES_REQUESTED cerrado

Review: `progress/review_baston-feedback-sensorial.md` (1 🔴 + 3 🟠 + 3 🟡 + ⚪) · veto de diseño del
leader sobre el contraste de la nota. **Todo abordado.** El reviewer confirmó ejecutando: `check.mjs`
RC=0, unit 2837/2837, E2E 42/42, los dos WAV medidos y distintos, y que el guard `read-dispatch` **se
amplió y no se aflojó**.

## 11.1 · 🔴 El respaldo a `Vibration` era CÓDIGO MUERTO — y degradé para peor

**El reviewer tiene razón, y lo verifiqué en la fuente antes de tocar nada:**

- `node_modules/expo-haptics/src/ExpoHaptics.ts` → `requireOptionalNativeModule('ExpoHaptics')`, la
  variante **OPCIONAL**: devuelve **`null`** y **no tira**.
- `node_modules/expo-haptics/src/Haptics.ts` → `notificationAsync` es `export async function` y hace
  `if (!ExpoHaptics?.notificationAsync) throw new UnavailabilityError(...)` **adentro** → el fallo sale
  como **promesa rechazada**, nunca como throw síncrono.

Camino real en un APK sin el módulo: `require` OK → promesa rechazada → mi `.catch(() => undefined)` se la
comía → `return;` → el bloque de `Vibration` **inalcanzable**. **No vibraba nada**, cuando antes de la
unidad vibraba 50 ms. Es lo contrario de la restricción que me dieron, y peor que el estado previo.

**La asimetría que se me pasó**: `expo-audio` usa `requireNativeModule` (**tira** al importar), y traté a
los dos paquetes igual. Mi razonamiento "OTA-safe" era correcto para el audio y falso para la háptica.

**Y mi guard pasaba igual**, porque verificaba que el TEXTO `Vibration } = require('react-native')`
existiera en el archivo — no que fuera **alcanzable**. Un test verde por la razón equivocada: exactamente
la clase que esta unidad decía cazar. Me la comí yo.

**Cómo quedó, y por qué así**: el error de fondo no fue una línea, fue **razonar sobre CÓMO falla el
canal**. Así que ahora no se razona:

- `emitHaptic(pattern, loadRich?, loadFallback?)` **espera el resultado** del canal rico y solo vuelve sin
  respaldo **después** de saber que emitió. Cubre las cuatro formas de fallar: el paquete no resuelve, el
  cargador tira, el módulo nativo no está (promesa rechazada), el nativo tira sincrónicamente.
- Está **exportada y con los cargadores inyectables a propósito**. No es comodidad de diseño: es la única
  forma de que un test EJECUTE el camino de la ausencia sin un teléfono. `feedback.ts` no importa RN/expo
  en el cuerpo del módulo (todo es `require` perezoso), así que node:test lo puede cargar de verdad.
- **7 tests nuevos** en `feedback.test.ts`, uno por forma de fallar + el **contrafactual** (si el canal
  rico SÍ emite, el respaldo NO corre — sin ese lado, "vibrar siempre por las dos vías" pasaría todo lo
  demás y el peón perdería la distinción de R4.8).
- El guard de texto **se conserva** además del de comportamiento, con roles ahora distintos y declarados:
  el de comportamiento prueba que la ORQUESTACIÓN llama al respaldo; el de texto prueba que el respaldo
  REAL sigue cableado (un doble inyectado no puede demostrar eso).

Corregido también donde lo había afirmado mal: `feedback.ts`, `design.md` §AS-BUILT, `requirements.md`
(nota bajo R4.1), `tasks.md` T7.6, `progress/current.md` y la cabecera de este informe.

## 11.2 · 🟠 Los tres arreglos sin red — ahora los tres tienen la suya

| # | Invariante | Red nueva | Mutante del reviewer que ahora muere |
|---|---|---|---|
| 🟠-2 | El cue **rebobina y recién después toca** | `emitCueSound` exportada + **player espía que registra la secuencia real**: `['seekTo(0)', 'play']`, más un caso con dos ticks adentro del seek que detecta el `play` corriendo *dentro* de la ventana del rebobinado | `void seekTo(0); play()` y `play()` sin seek |
| 🟠-3 | **R4.9**: el camino de la lectura es síncrono y sin I/O | Guard sobre el cuerpo de `handleReading`: (a) sin nombres de I/O de preferencia/storage, (b) **sin `await` ni `.then(`** —la regla general, para que un helper nuevo con otro nombre tampoco pase—, (c) el lado positivo: tiene que llamar `cachedBeepEnabled()` | `void readBeepEnabled().then(...)` dentro de `handleReading` |
| 🟠-4 | Un canal sensorial no puede entrar por la puerta de al lado | Guard **APP-WIDE con tabla de DUEÑOS** (`SENSORY_OWNERS`): los 4 módulos **y el símbolo `Vibration`** se barren en TODO el árbol, no solo en `services/ble/**`. Con chequeo de fantasmas (un dueño declarado que ya no lo usa también es rojo) | `src/utils/manga-buzz.ts` con `expo-haptics` **y** con `Vibration`, llamado antes del gate |

**Y corregí la afirmación falsa de mi §5.** Decía: *"lo que sigue sin ver: un canal que use un módulo que
no está en esa lista"*. **Era falso**: el agujero real era cualquiera de los módulos **ya enumerados**,
importado un directorio más allá del barrido. Lo que queda sin ver, dicho bien ahora: **un módulo
sensorial que no esté en `SENSORY_MODULES`** (una lib de sonido de terceros nueva) — y eso se cierra con
una línea, con el costo cobrado a quien la agregue.

## 11.3 · 🎨 Veto de diseño: el contraste de la nota

`$textFaint` está declarado en el config como **AA-large 4,03** (válido ≥18 px regular o ≥14 px bold) y la
nota es `$3` = **13 px regular**, donde WCAG AA pide 4,5:1. La entrada del backlog del 29/07 lo anticipó
—*"otros llevan información"*— y **este lleva información**: es el único lugar donde el peón aprende qué
significa el aviso distinto, en un producto que se usa a pleno sol.

- `$textFaint` → **`$textMuted`**. Contraste **calculado sobre los tokens reales** contra `$surface`
  (`#F8F6F1`): **3,92:1 → 5,58:1**.
- La jerarquía la da ahora la **separación** (hairline `$divider` + zona propia bajo la fila del switch),
  no el contraste. Verificado en la captura por **muestreo de píxeles**: la hairline renderiza en
  `(229,229,227)` sobre el surface `(248,246,241)` — existe y es sutil, que es lo que tiene que ser.
  Bajarle el contraste a la única explicación del vocabulario sería susurrar justo lo que hay que enseñar.
- **No toqué** *"Apagalo si el ruido molesta: la vibración sigue"*, que el leader aprobó explícitamente.

## 11.4 · 🟡 y ⚪ menores

- **Conteo de mutantes reconciliado**: **25** (18 propios + los 7 del reviewer), igual en este informe, en
  `tasks.md` T7.6 y en `current.md`. Antes decían 18 y 14.
- **Capturas**: eran 8 nombres con **5 frames**. Saqué los dos nombres redundantes (la pantalla entra
  completa en 412×915, así que "arriba", "la tarjeta" y "el vacío" eran EL MISMO frame). Quedan **6
  capturas = 4 frames distintos + 2 pares idénticos A PROPÓSITO**, verificado por md5, con el porqué
  escrito en la cabecera del capture: `apagado == apagado-tras-recargar` **es** la prueba de la
  persistencia, y `aceptada == rechazada` **es** el hallazgo 🟡-12.
- **Modo de audio, fundamento ya no iOS-céntrico**: el device de prueba es Android, así que ahora se cita
  la vía de Android en `design.md` — `Function("play")` → `requestAudioFocus()`, y con
  `interruptionMode == null` pide `AUDIOFOCUS_GAIN_TRANSIENT` (`AudioModule.kt:143-155`; con
  `MIX_WITH_OTHERS` retorna temprano en la **línea 144**). **Leí el Kotlin yo**, y encontré un motivo MÁS
  que el review no nombró: `shouldPlayInSilentMode()` — sin `playsInSilentMode: true`, en Android el
  `play()` se **suprime** con el timbre en silencio o vibración. O sea que la clave que había marcado como
  "decisión de producto reversible" es además la que hace que el beep exista para un peón que trabaja con
  el teléfono en silencio. Eso sube el costo de revertirla; sigue siendo decisión de Raf.
- **Cita de una E2E inexistente** en `feedback.test.ts` → corregida a `baston-feedback-sensorial.spec.ts`.
- **Dos nombres públicos para lo mismo** en `feedback-pref.ts` → eliminado `currentBeepEnabled()`; queda
  solo el re-export de `cachedBeepEnabled`, y la pantalla lo usa (`docs/conventions.md §Imports`).
- **`feedback-guard.test.ts` leía el efecto sin `stripSourceComments`** para el chequeo del `require` de
  los assets → un `require` comentado lo satisfacía. Corregido.

## 11.5 · Verificación del fix-loop — «lo ejecuté y lo vi»

| Qué | Resultado |
|---|---|
| Fuente de `expo-haptics` (`ExpoHaptics.ts` / `Haptics.ts`) | **leída**: confirma `requireOptionalNativeModule` + rechazo async |
| Fuente de `expo-audio` Android (`AudioModule.kt`) | **leída**: `requestAudioFocus` 143-155, `Function("play")`, `shouldPlayInSilentMode` |
| `pnpm typecheck` | **verde** |
| `node scripts/check.mjs` **completo** | **RC=0**, `All tests passed`, anti-hardcode 0 violaciones |
| Unit de la unidad | **122/122** |
| **Mutantes** (18 propios re-corridos + **los 7 del reviewer**) | **25/25 muertos**, árbol restaurado a verde |
| E2E `baston*` (7 specs, incluida la nueva) | **23/23** |
| Capture del Gate 2.5 | **1/1**, 6 PNG; md5 → 4 frames distintos + 2 pares intencionales |
| Contraste de la nota, calculado sobre los tokens reales | **5,58:1** (era 3,92:1) |
| Hairline del divider, muestreada en el PNG | `(229,229,227)` vs surface `(248,246,241)` → renderiza |
| `git status -- design/` tras el E2E | **limpio** |
| `git diff supabase/ sync-streams/` | **vacío** → Gate 1 sigue N/A |

**Sin commitear. Ningún build de EAS.**

## 11.6 · Lo que sigue abierto (sin cambios respecto de §1)

- Que el pip de 3150 Hz **se oiga** sobre el ruido real y que `Success` vs `Error` **se distingan con
  guante**: necesita device y campo (T7.4). Es lo único que decide si la unidad cumplió.
- Que `seekTo(0)` → `play()` reproduzca N veces **en hardware**, y que el modo de audio no interrumpa una
  radio real: verificado leyendo el nativo de las dos plataformas y ahora con red por comportamiento,
  **pero no ejercido en un teléfono**.
- **Cambia el fingerprint** → hace falta un build de EAS para ver cualquiera de las dos cosas en el A07.

## 11.7 · Archivos tocados en el fix-loop (1.ª vuelta)

`app/src/services/ble/feedback.ts` (orquestación de los dos canales, exportada e inyectable) ·
`app/src/services/ble/feedback.test.ts` (+13 tests de orquestación) ·
`app/src/services/ble/feedback-guard.test.ts` (guard app-wide con tabla de dueños + strip del efecto) ·
`app/src/services/ble/read-dispatch.test.ts` (guard de R4.9 + `SENSORY_EMIT` con los orquestadores) ·
`app/src/services/ble/feedback-pref.ts` (fuera el nombre duplicado) ·
`app/src/features/ble-stick/screens/StickConnectionScreen.tsx` (contraste + hairline) ·
`app/e2e/captures/baston-feedback-sensorial.capture.ts` (6 capturas honestas) ·
`specs/active/04-bluetooth-baston/{requirements,design,tasks}.md` · `progress/current.md` · este informe.

---

# 12. FIX-LOOP 2 (re-review) — dos guards que no cubrían lo que declaraban

Re-review: `progress/review_baston-feedback-sensorial-2.md`. Cerró el 🔴 y los tres 🟠 de la vuelta
anterior (verificados ejecutando: los 7 mutantes viejos muertos, 9 sondas propias sobre `emitHaptic` en
verde, `check.mjs` RC=0, unit 2852/2852, E2E 23/23 + 19/19) y encontró **dos guards que no cubrían el
invariante que su propio comentario declaraba** — la misma clase que la unidad existe para cazar, otra vez
en algo mío. Los dos tienen razón.

## 12.1 · 🟠-A · R4.9 se burlaba con una firma síncrona → el invariante ahora se OBSERVA

**Lo que estaba mal, y por qué era mío.** Escribí en el guard que la regla de `await`/`.then(` era *"la
regla general de la que (a) es un caso; sin (b), volver a poner el I/O con otro nombre pasaría igual"*.
**Falso.** El reviewer lo demostró con una indirección de una línea:

```ts
export function refreshBeepPrefNow(): void { void readBeepEnabled(); }  // firma SÍNCRONA
refreshBeepPrefNow();                                                    // en handleReading
```

→ **2852/2852 en verde** con el cruce a SecureStore **por bastonazo** restaurado entero. Mis tres reglas
miran la **forma de la llamada**; la asincronía vive **adentro** del helper y el call site se ve idéntico
a uno barato. Es literalmente el mismo error que acababa de arreglar en `emitHaptic` —razonar sobre *cómo
se manifiesta* el problema en vez de **observar el resultado**— cometido dos secciones más abajo.

**Cómo quedó: tres capas, y la que decide es la que MIDE.**

1. **OBSERVACIÓN (la que vale).** La E2E envuelve `Storage.prototype.getItem/setItem` y **cuenta los
   accesos reales a la clave de la preferencia** mientras entran **10 bastonazos** por el provider real →
   **tiene que ser CERO**. No infiere: mide. Con **contrafactual** (el warm-up SÍ lee: sin ese lado,
   "nunca leer la preferencia" pasaría el test principal y el valor persistido no se aplicaría nunca) y
   con los tres desenlaces (aceptada ×10, rechazada, duplicada). Cualquier indirección —tenga el nombre
   que tenga, sea sync o async— aparece acá.
2. **ALLOWLIST de lo invocable** en `handleReading` (`HOT_PATH_CALLABLE`, 10 entradas con su motivo). Es
   la versión "escrita sobre la ausencia": un nombre nuevo en el camino caliente **nace en rojo** aunque
   no nombre nada sospechoso. Mismo patrón que `CONSUMERS` y `PROVIDER_SENSORY_ALLOWED`. Con extractor de
   callees auto-verificado (su propio self-test me corrigió una expectativa equivocada: de `bar.baz(1)`
   sale `baz`, no `bar`).
3. **Las tres reglas de forma**, que quedan: baratas, corren en `check.mjs`, matan el mutante literal.

**Y corregí la afirmación falsa** en el comentario del guard y en §11.2 de este informe: la regla del
`await`/`.then(` **no es general** — ve la asincronía que se **escribe** en el cuerpo, no la escondida en
un helper. Está dicho ahora en los dos lugares.

## 12.2 · 🟠-B · El respaldo táctil podía colapsar los dos patrones de R4.8

Mutante del reviewer: `Vibration.vibrate(50)` para los dos desenlaces → **67/67 verde**. El único test que
sonaba a cubrirlo (*"el patrón llega INTACTO al canal que termine emitiendo (rico o respaldo)"*) le
inyecta un doble: prueba la **orquestación**, no puede decir nada del respaldo real. Es exactamente el
argumento que yo mismo había escrito en §11.1 para justificar conservar el guard de texto — y me faltaba
el otro lado.

**Por qué importa más de lo que parece**: en un APK **sin** el módulo nativo —el que Raf tiene hoy y todo
el parque hasta el próximo build— el respaldo es el **único** canal táctil. Con el sonido apagado (el
switch lo permite y R4.1 lo bendice), o con sol, ruido o presbiacusia, colapsar los patrones deja "entró"
y "no servía" indistinguibles: 🟡-12 restaurado justo donde el respaldo existía para evitarlo.

**Cómo quedó**: el patrón se movió a `fallbackVibrationPattern(pattern)` en `feedback-logic.ts` (puro), y
se verifica **ejecutándolo**: que los dos difieran, y que difieran **en lo que se percibe con guante** —
más pulsos y ≥1,5× de duración— porque `Vibration` no controla amplitud y un mutante 50→60 ms pasaría un
`notDeepEqual` siendo igual de indistinguible en la mano. Renombré el test del doble para que no prometa
más de lo que puede probar.

## 12.3 · El mutante que sobrevivió a MI primer intento de arreglo

**RR-B3 — re-inlinear el patrón en `feedback.ts`** (`Vibration.vibrate(50)`, esquivando la función pura):
**71/71 verde**. La función pura quedaba decorativa y los dos patrones colapsados igual. Es el mismo
agujero que el literal propio en lugar de `FEEDBACK_AUDIO_MODE` (mutante M17), que yo ya había cerrado
para el audio y no para la háptica. Cerrado con el assert simétrico: el efecto real tiene que pasar
`fallbackVibrationPattern(pattern)` a `Vibration.vibrate(`.

**Lo digo porque es el patrón de esta unidad entera**: un valor correcto en un módulo puro no sirve si el
efecto lo esquiva. Cada vez que muevo algo a "puro y testeable" hace falta también el assert de que el
efecto lo consume.

## 12.4 · Mutantes de esta vuelta — 5 lanzados, 5 muertos

| # | Mutante | Antes | Ahora | Quién lo mata |
|---|---|---|---|---|
| **RR-A** | `refreshBeepPrefNow()` — helper de firma síncrona con I/O adentro (**repro exacto del reviewer**) | VIVO (2852 verde) | **MUERTO** | E2E que MIDE (10 accesos en 10 bastonazos, mensaje exacto) + allowlist |
| **RR-A2** | La misma indirección con otro nombre y como método (`x.warmSomething()`) | — | **MUERTO** | allowlist (la clase, no la instancia) |
| **RR-B** | `fallbackVibrationPattern` devuelve lo mismo para los dos (**repro exacto**) | VIVO (67 verde) | **MUERTO** ×2 | los dos tests del patrón puro |
| **RR-B2** | Difieren pero de forma imperceptible (50 vs 60 ms) | — | **MUERTO** | el test de pulsos + duración ≥1,5× |
| **RR-B3** | Re-inlinear el patrón en `feedback.ts` (la función pura queda decorativa) | **VIVO en mi 1.er intento** | **MUERTO** | assert de que el efecto usa la función pura |

**Total de la unidad: 30 mutantes, 30 muertos** (18 míos + 7 del review 1 + 5 de esta vuelta).

**La E2E que mide, falsificada de verdad**: apliqué RR-A al árbol, reconstruí el bundle y la corrí →
falló con *«el camino de la lectura tocó el storage **10 veces en 10 bastonazos**. Tiene que ser CERO»*.
Árbol restaurado y verificado (grep de `refreshBeepPrefNow`: 0 ocurrencias en los dos archivos).

## 12.5 · Menores de la re-review

- **⚪ `design.md` con el alcance viejo del guard de módulos** → reconciliado: describe el barrido
  **app-wide con `SENSORY_OWNERS`**, incluye **por qué el alcance anterior no alcanzaba** (el
  `manga-buzz.ts` con 2837 tests en verde) y la tabla de dueños vigente. + una línea en `tasks.md` T7.6
  nombrando las tres capas de cada invariante.
- **Menor A — el costo escrito de revertir `playsInSilentMode`.** Tenía razón el reviewer y su matiz suma
  al mío: decía "reversible en una línea" en tres lugares. Lo verifiqué en el Kotlin —`AudioModule.kt:63`
  el default del módulo **ya es `true`**, y `:472` es un `return` **antes de tocar**— así que revertirlo
  **no es "volver al default": ACTIVA una supresión que hoy no existe**, y deja el aviso mudo para todo
  peón que trabaje con el timbre en silencio o vibración. Escrito ahora en `feedback-logic.ts`,
  `feedback.ts`, `feedback-guard.test.ts` y `current.md`. Sigue siendo decisión de Raf; ahora es informada.
- **Menor B — pin de `SENSORY_OWNERS`** con `assert.deepEqual` de claves y dueños (como
  `PROVIDER_SENSORY_ALLOWED`), + exigencia de que cada dueño tenga motivo escrito. Auto-agregarse ahora
  cuesta romper dos asserts, no uno.
- **⚪-C / ⚪-D** (el nombre del test que hardcodea `manga-buzz.ts`; los límites de `emitHaptic` con una
  promesa que resuelve-sin-emitir o que nunca resuelve): el reviewer explícitamente **no pidió cerrarlos**
  y coincido. El barrido real es genérico; el costo máximo del segundo es un bastonazo sin canal táctil y
  está probado que no bloquea la ingesta.

## 12.6 · Verificación del fix-loop 2 — «lo ejecuté y lo vi»

| Qué | Resultado |
|---|---|
| `pnpm typecheck` | **verde** |
| `node scripts/check.mjs` completo | **RC=0**, `All tests passed` |
| Unit de la unidad (4 suites BLE) | **72/72** · las 6 suites de la unidad: **127/127** |
| **5 mutantes nuevos** (los 2 repros del reviewer + 3 propios) | **5/5 muertos**; RR-B3 sobrevivió al primer intento y se cerró |
| **RR-A contra la E2E que mide** (bundle reconstruido) | **falla con el mensaje exacto**: 10 accesos en 10 bastonazos |
| E2E `baston-feedback-sensorial.spec.ts` (ahora 3 tests) | **3/3** |
| E2E `baston*` completa (7 specs) | **24/24** |
| Restauración post-mutantes | grep del helper del repro: **0 ocurrencias** |

**Sin commitear. Ningún build de EAS.**

## 12.7 · Archivos tocados en el fix-loop 2

`app/src/services/ble/feedback-logic.ts` (`fallbackVibrationPattern` + costo de `playsInSilentMode`) ·
`app/src/services/ble/feedback.ts` (usa el patrón puro + costo escrito) ·
`app/src/services/ble/feedback.test.ts` (+2 tests del patrón de respaldo, alcance del test del doble) ·
`app/src/services/ble/feedback-guard.test.ts` (assert del patrón puro en el efecto + pin de
`SENSORY_OWNERS` + costo escrito) ·
`app/src/services/ble/read-dispatch.test.ts` (`HOT_PATH_CALLABLE` + extractor auto-verificado + la
afirmación falsa corregida) ·
`app/e2e/baston-feedback-sensorial.spec.ts` (contador de storage + el test que MIDE R4.9) ·
`specs/active/04-bluetooth-baston/{design,tasks}.md` · `progress/current.md` · este informe.
