# review — «el bastón tiene que sonar y vibrar de verdad en la manga»

**Unidad**: 🟡-11 + 🟡-12 de `progress/sweep_bluetooth-edge-cases.md` · feature **04**
**Base**: diff sin commitear sobre `297e523` (ignorado `docs/marketing/*`, de otra terminal)
**Informe revisado**: `progress/impl_baston-feedback-sensorial.md`
**Fecha**: 2026-08-06

## Veredicto: CHANGES_REQUESTED

Cuatro hallazgos con acción. El más caro es de campo y contradice al informe: **el fallback a
`Vibration` es código muerto**, así que en el APK que Raf tiene instalado hoy un bastonazo queda **sin
ningún canal táctil** — es un retroceso contra el `Vibration.vibrate(50)` anterior, exactamente lo que la
unidad decía estar evitando. El resto de la unidad es sólido y verifiqué a mano casi todo lo que afirma.

---

## Lo que verifiqué EJECUTANDO (no leyendo)

| Qué | Resultado |
|---|---|
| `node scripts/check.mjs` sobre el árbol restaurado | **RC=0**, `All tests passed` |
| Suite unit completa (`run-tests.mjs`) | **2837/2837** |
| E2E `baston*` (7 specs) + los 5 consumidores de lecturas | **42/42 passed (4.4 m)**, RC=0 |
| `git status -- design/` antes y después del E2E | **limpio las dos veces** (no hubo nada que revertir) |
| Decodificación de los dos `.wav` (Goertzel + pico + RMS + segmentación) | ver abajo |
| **12 mutantes propios** contra los guards nuevos y ampliados | **8 muertos, 4 vivos** (ver hallazgos) |
| Restauración post-mutantes | md5 de **59 archivos idéntico**, `git status` idéntico al snapshot inicial |

**Assets, medidos**: `read-ok.wav` = 1 segmento, 110,0 ms, fundamental **3150 Hz**, pico 29163/32767
(0,890 FS), RMS 0,669. `read-error.wav` = 2 segmentos (95 ms @ **1300 Hz** + gap + 110 ms @ **850 Hz**),
250,0 ms, pico 0,890 FS. **No son silencio, y son distintos en altura, cantidad y duración.**
**Procedencia / licencia**: se sintetizan con `scripts/gen-baston-sounds.mjs` (leí el script y verifiqué
que la salida coincide) → **licencia propia, sin banco de sonidos de terceros que rastrear.**

---

## 🔴 1 — El fallback a `Vibration` NUNCA se ejecuta: el APK instalado queda sin canal táctil

**Archivo**: `app/src/services/ble/feedback.ts:69-92` (`hapticNative`).

El código asume que `require('expo-haptics')` **tira** cuando falta el módulo nativo. No es así:

- `node_modules/expo-haptics/src/ExpoHaptics.ts:3` → `requireOptionalNativeModule('ExpoHaptics')`, que
  **devuelve `null` y no tira** (`expo-modules-core/src/requireNativeModule.ts:32-42`).
- `node_modules/expo-haptics/src/Haptics.ts:14-21` → `notificationAsync` es `export async function`; su
  `UnavailabilityError` sale como **promesa rechazada**, no como throw síncrono.

Camino real en un APK sin el módulo: `require` OK → `notificationAsync(...)` devuelve promesa rechazada →
`.catch(() => undefined)` se la come → **`return;` de la línea 78** → el bloque de `Vibration` (líneas
84-91) queda inalcanzable. **Antes de esta unidad ese bastonazo vibraba 50 ms; ahora no pasa nada.**

Reproducido, no deducido: copia literal de `hapticNative` contra la semántica real del paquete →
`¿se llamó al fallback Vibration? -> false`.

Lo contradicho: informe §1 y §8 ("el APK actual cae al fallback de `Vibration`"), `progress/current.md`,
el comentario de `feedback.ts:80-82` ("degradar a silencio acá dejaría al APK instalado hoy sin NINGÚN
feedback táctil… es un retroceso, no una degradación") y `design.md` §AS-BUILT ("con fallback a
`Vibration` si el módulo nativo no está en el APK").

El guard `feedback-guard.test.ts:113-117` pasa porque verifica que el **texto**
`Vibration } = require('react-native')` exista en el archivo, no que sea **alcanzable**. Es un test verde
por la razón equivocada — justo la clase que esta unidad dice cazar.

**Asimetría que se pasó por alto**: `expo-audio` sí usa `requireNativeModule`
(`node_modules/expo-audio/build/AudioModule.js:5`), que **tira al importar**, así que ahí el `try/catch`
de `ensureCuePlayers` funciona. El razonamiento OTA-safe es correcto para el audio y falso para la
háptica.

**Qué hace falta**: detectar la ausencia en vez de esperar un throw, un mutante que lo mate **por
comportamiento** (el M18 actual solo prueba que el texto siga ahí), y corregir las cuatro afirmaciones de
arriba en informe / `current.md` / `feedback.ts` / `design.md`.

## 🟠 2 — El otro 🔴 del informe (el beep mudo del 2.º bastonazo) no tiene ningún guard

Mutantes aplicados sobre `feedback.ts:207`, los dos **sobrevivieron** los 52 tests de
`read-dispatch + feedback-guard + feedback + beep-pref-cache`:

- `void player.seekTo(0); start();` (el orden roto original) → **verde**.
- `start();` sin seek → **verde**.

Asimetría con el 🔴 hermano, que sí tiene red: `interruptionMode: 'doNotMix'` **muere**, y reescribir el
modo con un literal propio en vez de `FEEDBACK_AUDIO_MODE` **muere**. Falta el assert simétrico en
`feedback-guard.test.ts` sobre el encadenado `seekTo(0).then(...)`, con el porqué en el mensaje.

## 🟠 3 — R4.9 sin guard: volver a poner el I/O en el camino caliente deja todo verde

Mutante: `void readBeepEnabled().then((b) => playFeedback(classifyReadOutcome(candidate), b));` dentro de
`handleReading` → **52/52 verde**. La E2E tampoco lo ve (sigue sonando, solo que async).

Es literalmente el 🟡-11 que la unidad cierra, y R4.9 es el único requisito nuevo sin red de regresión.
`read-dispatch.test.ts` ya tiene `handleReadingBody()` y ya lo usa para prohibir `primeFeedback` ahí
adentro — falta el assert simétrico para `readBeepEnabled` / cualquier `await` en ese cuerpo.

## 🟠 4 — El guard de MÓDULOS se burla con una indirección de un archivo (y el informe dice que no)

Informe §5: *"no se puede hacer sonar ni vibrar un teléfono sin importar algo, y ese conjunto es chico y
enumerable… Lo que sigue sin ver: un canal que use un módulo que no está en esa lista"*. **Falso.** Los
dos guards están acotados a `rel.startsWith('src/services/ble/')` (`feedback-guard.test.ts:93`).

| Mutante | Resultado |
|---|---|
| `src/utils/manga-buzz.ts` con `expo-haptics` + `buzzManga()` **antes del gate** en `handleReading` | **VIVO** — 52/52 y **suite unit completa 2837/2837 verde** |
| Ídem con `Vibration` de `react-native` | **VIVO** |
| Ídem con `expo-audio` | **MUERTO** (el guard app-wide de `expo-audio`, líneas 120-126, sí es global) |
| `expo-haptics` importado **dentro** de `services/ble/` | **MUERTO** (2 tests) |

O sea: el agujero no es "una lib de terceros nueva", es **cualquiera de los módulos ya enumerados,
importado un directorio más allá**, y con eso se restaura 🔴-2 para el canal táctil con la suite entera en
verde. Se cierra extendiendo el guard app-wide que ya existe para `expo-audio` a `expo-haptics` (y a
`Vibration`, con allowlist explícita de `utils/haptics.ts` y sus consumidores de UI, que es lo que hoy
justifica el recorte de scope).

## 🟡 5 — El conteo de mutantes no coincide entre documentos

Informe §5 y `progress/current.md`: **18 mutantes, 18 muertos**. `specs/active/04-bluetooth-baston/tasks.md`
T7.6: *"Falsificado con **14** mutantes, 14 muertos"*.

## 🟡 6 — Tres de las ocho capturas del Gate 2.5 son el mismo archivo

md5 idéntico (`676872f6…`) para `02-baston-arriba-estado-y-dispositivos.png`,
`03-aviso-sonido-encendido.png` y `05-lecturas-vacio-con-aviso.png`. También `04`/`08` (`79f925a4…`,
esperable) y `06`/`07` (`049182bd…`, **intencional y documentado**: ese es el punto de 🟡-12). Quedan
**5 frames distintos sobre 8 nombres**. Los estados clave están cubiertos y la tarjeta se ve bien; lo que
está inflado es el conteo de §4.

## 🟡 7 — El fundamento del modo de audio es iOS-céntrico y el device de prueba es Android

El informe justifica `mixWithOthers` solo por iOS/`soloAmbient`. En Android el problema es igual de real
por otra vía: `expo-audio/android/.../AudioModule.kt:467-478` — `play()` llama `requestAudioFocus()`, y
`requestAudioFocus` (líneas 143-155) con `interruptionMode == null` (el default si nadie llama
`setAudioModeAsync`) pide `AUDIOFOCUS_GAIN_TRANSIENT` → **le pausa la radio al peón**. El fix elegido es
correcto en las dos plataformas (línea 144: con `MIX_WITH_OTHERS` retorna temprano y no pide foco), pero
la spec debería decirlo, porque el A07 es donde se va a probar.

## ⚪ menores

- `app/src/services/ble/feedback.test.ts:4` cita una E2E inexistente (`baston-feedback-negativo.spec.ts`;
  es `baston-feedback-sensorial.spec.ts`).
- `app/src/services/ble/feedback-pref.ts` expone **dos** nombres públicos para lo mismo: re-exporta
  `cachedBeepEnabled` y además define `currentBeepEnabled()`, que solo lo llama. El provider usa uno y la
  pantalla el otro. Contra `docs/conventions.md §Imports` ("sin re-exports innecesarios").
- `feedback-guard.test.ts:184` lee `EFFECT_FILE` **sin** `stripSourceComments` para el chequeo
  `effect.includes('assets/sounds/<cue>.wav')` → un `require` comentado lo satisface. Los demás asserts
  del mismo archivo sí strippean.

---

## Lo que confirmé y está BIEN

- **El guard `read-dispatch` se amplió, no se aflojó.** `playFeedback` literal → `play[A-Z]\w*` (lo sigue
  cubriendo, más `playSound`/`playBeep`/`playRejectFeedback`) + las APIs de los dos módulos nuevos, y el
  filtro del provider pasó de "¿la línea menciona `playFeedback`?" a **token por token** con allowlist
  explícita. El renglón mixto `playFeedback(...); Vibration.vibrate(50);` que antes se colaba ahora cae.
- **Guards de assets**: matan la copia del positivo sobre el negativo, el silencio, el truncado, y **hasta
  una atenuación a −20 dB** (el umbral `peak > 16384` cubre el "pip que en realidad no se oye").
- **Guard del modo de audio**: mata `doNotMix` y mata el literal propio en lugar de la constante.
- **Permisos** (mirado el manifiesto, no solo el config): sin plugin, `expo-audio` aporta exactamente
  **`MODIFY_AUDIO_SETTINGS`** (nivel normal, de su `AndroidManifest.xml`). `expo-haptics` declara
  `VIBRATE`, que **ya estaba** en el manifiesto mergeado previo
  (`android/app/build/intermediates/merged_manifests/debug/…`, 29/07) → **no hay ningún permiso nuevo sin
  declarar**. El aviso del informe es correcto y completo.
- **No enganchar el config plugin se sostiene y funciona igual**: con defaults, `plugin/build/withAudio.js`
  agrega `RECORD_AUDIO`, `NSMicrophoneUsageDescription`, `UIBackgroundModes:['audio']`,
  `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` y el `MediaSessionService`. El autolinking va
  por `expo-module.config.json`, no por el plugin, así que el módulo nativo se registra igual.
  `app.config.test.ts` lo fija en los tres variants.
- **Deps**: `dependencies: {}` y cero scripts de `install`/`postinstall`/`prepare` en las dos.
  `onlyBuiltDependencies` sin cambios. ADR-011 intacto.
- **Camino caliente**: `handleReading` usa `cachedBeepEnabled()` (síncrono, sin I/O). `readBeepEnabled()`
  queda en el `useEffect` de montaje del provider y en el de la pantalla. **Cero I/O por bastonazo.**
- **Caché rancio**: quitar `rememberBeepEnabled` de `writeBeepEnabled` sobrevive las unit pero **lo mata la
  E2E** (apagar → bastonear → no suena). Cubierto, aunque por la red de arriba y no por la de abajo.
- **Orden del gate 🔴-2 preservado**: gate → motor de ingesta → feedback
  (`BleStickListenerProvider.tsx:192-230`), y el feedback envuelto en `try/catch` con log.
- **Degradación web**: `resolvePlatform()` → `'web'` ⇒ `decideFeedback` devuelve `haptic: null` y
  `channel: 'web-audio'`; `beepWebAudio` entero dentro de un `try`. Sin `AudioContext` no rompe nada.
  La E2E prueba por comportamiento que con el sonido apagado **la lectura igual entra** (R15.2/R4.5).
- **UI (R4.3)**: fila entera tappable con `minHeight="$touchMin"` (56 dp) ≥ `$chipMin` (40);
  `lineHeight` matcheado en todos los `Text`; voseo es-AR ("Apagalo", "Prendelo", "no la sentís"); el copy
  dice explícitamente qué queda prendido en **los dos** estados ("la vibración sigue" / "Solo vibra"), y la
  nota enseña el vocabulario nuevo. Miré las 5 capturas distintas: el ícono `Volume2`/`VolumeX` dentro de
  la fila del título etiqueta lo correcto, y nada se recorta.
- **Reconciliación de specs**: `requirements.md` (notas as-built bajo R4.1/R4.2/R4.3 + **R4.8 y R4.9
  nuevos**), `design.md` (§AS-BUILT + árbol), `tasks.md` (**T6.4 cerrada**, T7.6 nueva, tabla de
  trazabilidad), `03-modo-maniobras` (motivo falso corregido). El único punto donde el `design.md` **miente
  respecto del as-built** es el fallback táctil del 🔴-1.

---

## Trazabilidad `R<n> ↔ test`

| Requisito | Test concreto | Verificado |
|---|---|---|
| R4.1 háptica siempre, no apagable | `feedback.test.ts` «R4.1: en native la háptica se dispara SIEMPRE…» + «INVARIANTE: la preferencia apaga el SONIDO y nunca el canal táctil» | ✅ |
| R4.1 fallback sin módulo nativo | `feedback-guard.test.ts` «el punto único SÍ importa los dos canales» | ⚠️ **verifica el texto, no el comportamiento → 🔴-1** |
| R4.2 sonido real en device | `feedback.test.ts` «R4.2/R4.3: el sonido se dispara SOLO con la preferencia habilitada», «los cues mapean 1:1»; `feedback-guard.test.ts` «todo cue alcanzable tiene su asset», «los .wav son PCM 16-bit mono decodificables» | ✅ (assets medidos por mí) |
| R4.2 sin micrófono / sin plugin | `app.config.test.ts` «`expo-audio` NO se engancha como config plugin» | ✅ (contrastado con el manifiesto mergeado) |
| R4.3 preferencia + UI + persistencia | `connection-view.test.ts` ×4 (copy) + E2E «el switch de sonido existe, silencia el aviso SIN romper la ingesta, y persiste» | ✅ (E2E corrida) |
| R4.4 confirmación visual <1s | E2E de la unidad + `baston.spec.ts` (regresión) | ✅ |
| R4.5 degradación web | `feedback.test.ts` «en web el canal táctil se degrada en silencio», «el canal es web-audio en web» | ✅ |
| R4.6 / R15.2 no romper la ingesta | `read-dispatch.test.ts` (intacto) + E2E `baston-lectura-sin-consumidor` + E2E de la unidad | ✅ |
| R4.7 punto único ampliado | `read-dispatch.test.ts` «UN SOLO punto» + «MUTANTES 2026-08-06»; `feedback-guard.test.ts` «solo el punto único importa un módulo capaz de emitir» | ⚠️ **burlable con indirección → 🟠-4** |
| R4.8 negativo distinto (nuevo) | `feedback.test.ts` ×2 + `feedback-guard.test.ts` «el negativo no es el mismo archivo» + E2E «el vocabulario tiene DOS palabras» (`[3150]` vs `[1300,850]`) | ✅ |
| R4.9 fuera del camino caliente (nuevo) | `beep-pref-cache.test.ts` (9 tests) | ⚠️ **cubre el caché puro, no el invariante del camino → 🟠-3** |
| R3.1 re-lectura muda | `feedback.test.ts` «una re-lectura es MUDA…» + E2E lado (c) | ✅ |
| — modo de audio | `feedback-guard.test.ts` «el aviso NO pide foco de audio» | ✅ (mutantes muertos) |
| — el beep suena N veces (🔴 #1 del informe) | **ninguno** | ❌ **🟠-2** |

**Tasks completas**: sí para las de esta unidad. **T6.4 cerrada** con as-built; **T7.6 nueva** completa.
Las `[ ]` que quedan en spec 04 (T4.2, T4.4, T4.7, T5.0-T5.3, T6.5, T7.4, T7.5) son **preexistentes y
justificadas en el propio archivo**: dependen de hardware que no está (RS420 real, rig HID, QA de campo).
Ninguna es de esta unidad.

## CHECKPOINTS

- **C1** [x] — base + docs + 5 agentes; `check.mjs` **RC=0** verificado por mí.
- **C2** [x] — cero features en `in_progress` (04 es `deferred`, patrón de unidades delta de este repo);
  `current.md` describe la sesión activa.
- **C3** [x] — capas respetadas (los `@/services/ble/*` desde la pantalla son el patrón ya establecido en
  ese archivo: 10 imports iguales preexistentes, ninguno nuevo de otra clase); 2 deps nuevas justificadas
  (ADR-013 §Capa 4 ya listaba `expo-haptics`); sin logs de debug, sin TODOs; sin `establishment_id`
  hardcodeado.
- **C4** [x] — todo módulo con lógica tiene test; fixtures reales; runner con 2837 tests verdes.
  *Salvedad*: dos invariantes de la unidad quedaron sin oráculo (🟠-2, 🟠-3).
- **C5** [ ] — `progress/history.md` sin entrada y nada commiteado. Es el cierre del leader, no del
  implementer; queda marcado como pendiente, no como falta.
- **C6** [x] — los 3 archivos existen; EARS respetado en R4.8/R4.9; cada `R<n>` con ≥1 test (ver tabla, con
  las dos salvedades).
- **C7** N/A — sin tablas, sin SQL, sin RLS. `git diff supabase/ sync-streams/` vacío.
- **C8** [x]/N/A — no hay carga de datos nueva; la preferencia es de **dispositivo** (no de tenant) y vive
  en `SecureStore`/`localStorage`, o sea offline por construcción. No toca red.
- **C9** [x] — E2E de regresión verde (42/42), capture file presente con 8 estados nombrados
  (⚠️ 5 frames distintos, 🟡-6), `__shots__/*.png` **no commiteados** (gitignore verificado). El paso del
  leader (Gate 2.5 con veto visual) no es mío.

## Checklist RAFAQ-específico

- **A. Multi-tenancy / RLS** — **N/A.** Cero migraciones, cero SQL, cero tablas. Diff de `supabase/` y
  `sync-streams/` vacío.
- **B. Offline-first** — **N/A parcial / [x].** No hay carga ni edición de datos de campo. La preferencia
  es local por diseño (ergonomía de dispositivo, como el brillo), no va a ningún bucket y no necesita
  resolución de conflictos. La pantalla no hace requests síncronos a Supabase.
- **C. BLE** — aplica parcialmente:
  - [x] Desconexión repentina: no la toca esta unidad; el indicador de conexión sigue intacto (y el propio
    `feedback-logic.ts` argumenta por qué "bastón mudo" es problema del indicador, no del feedback).
  - [x] Modo manual de fallback en ≤1 tap: el `InfoNote` manual-first de `/baston` sigue en su lugar
    (visible en las capturas).
  - [x] Correlación TAG↔peso por ventana temporal: no aplica (sin balanza); la ventana de dedup de 3 s
    (`DEDUP_WINDOW_MS`) sigue documentada y su desenlace `duplicate` está fundamentado en R4.8.
  - [x] Los logs BLE no bloquean el flujo: `logTransportEvent` sigue no bloqueante y el feedback está
    envuelto en `try/catch` con log propio.
- **D. UI de campo** — aplica a la tarjeta nueva:
  - [x] Target: fila entera `minHeight="$touchMin"` = **56 dp** (el canon del repo; ≥ `$chipMin` = 40).
  - [~] Fuente: título `$5`=16 px, label `$4`=14 px, hint/nota `$3`=13 px. **Por debajo de los 18 pt** que
    pide el checkpoint, pero **es la escala ya vigente en toda `StickConnectionScreen`** y esto es una
    pantalla de ajustes, no la UI de manga. Consistente, no regresión — anotado, no cobrado.
  - [x] Una decisión por pantalla: un solo switch, sin formulario.
  - [x] Estado de loading: el valor inicial sale del caché **síncrono**, así que el switch nunca aparece
    en un estado indeterminado.
- **E. Edge Functions** — **N/A.** Ninguna.

## No verificado (no lo doy por bueno)

- **Que el pip de 3150 Hz se oiga sobre el ruido real de una manga, y que `Success` vs `Error` se
  distingan CON GUANTE.** Necesita device y campo (T7.4). Es lo único que decide si la unidad cumplió su
  objetivo. El informe lo declara abierto y coincido.
- **Que `seekTo(0).then(play)` reproduzca N veces en hardware.** Lo verifiqué **leyendo el nativo de las
  dos plataformas** —iOS: `play` es `Function` síncrona (`ios/AudioModule.swift:212`), `seekTo` es
  `AsyncFunction` (línea 280), `actionAtItemEnd = .pause` sin loop (`ios/AudioPlayer.swift:38,103`);
  Android: `seekTo` es `AsyncFunction(...).runOnQueue(Queues.MAIN)` → `player.seekTo(ms)` de ExoPlayer
  (`Playable.kt:31`)— y el encadenado es correcto en ambas. **No lo ejercí en un teléfono.**
- **Que el modo de audio no interrumpa una radio real en segundo plano.** Verificado por lectura del
  nativo de Android (`AudioModule.kt:144`) e iOS. No ejecutado.
- **El comportamiento del APK con el módulo nativo presente** (hace falta un build de EAS, que no lancé y
  no me corresponde pedir).

## Higiene de esta revisión

Read-only para el producto: **ningún `git add`**, ningún build de EAS. Los 12 mutantes se aplicaron y se
revirtieron; restauración verificada con **md5 de 59 archivos idéntico** al snapshot previo, `git status`
idéntico, y los `.wav` con su tamaño original (9746 / 22096 bytes). `design/**` quedó limpio antes y
después del E2E — no hubo nada que revertir.
