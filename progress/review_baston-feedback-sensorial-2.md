# review 2 (acotada al delta) — «el bastón tiene que sonar y vibrar de verdad en la manga»

**Unidad**: 🟡-11 + 🟡-12 de `progress/sweep_bluetooth-edge-cases.md` · feature **04**
**Alcance**: **solo el delta del fix-loop** (`progress/impl_baston-feedback-sensorial.md` §11) contra
`progress/review_baston-feedback-sensorial.md`. No se re-audita la unidad entera.
**Base**: diff sin commitear sobre `297e523` (ignorado `docs/marketing/*`, de otra terminal)
**Fecha**: 2026-08-06

## Veredicto: CHANGES_REQUESTED

**El 🔴 y los tres 🟠 del review anterior están cerrados, y lo verifiqué EJECUTANDO, no leyendo.** Los 7
mutantes que yo había dejado vivos mueren los 7 (los corrí yo, incluido el `manga-buzz.ts` con
`expo-haptics` y con `Vibration`). Los cuatro caminos de la ausencia del canal táctil se ejercitan de
verdad y aguantaron **9 sondas adversariales propias** sobre `emitHaptic`. El fix es correcto.

Lo que frena la aprobación son **dos guards que no cubren el invariante que su propio comentario declara
cubrir** — la misma clase que esta unidad existe para cazar, encontrada con la suite entera en verde:

- **🟠-A**: el guard de R4.9 se burla con un **helper de firma síncrona** que adentro hace la I/O →
  **2852/2852 verde** con el cruce a SecureStore **por bastonazo** (🟡-11) restaurado entero.
- **🟠-B**: el respaldo táctil real puede **colapsar los dos patrones** de R4.8 y nadie se entera →
  67/67 verde. Pega justo en los APKs donde el respaldo es el ÚNICO canal táctil: el que Raf tiene hoy.

Los dos se cierran con pocas líneas y sin tocar producto. No es un re-do: es un fix-loop corto.

---

## Lo que verifiqué EJECUTANDO (no leyendo)

| Qué | Resultado |
|---|---|
| `node scripts/check.mjs` completo | **RC=0**, `All tests passed`, «Entorno listo» |
| Unit de la unidad (6 archivos) | **122/122** (coincide con el informe) |
| Unit COMPLETA (la línea de `run-tests.mjs`) | **2852/2852** |
| E2E `baston*` (7 specs) | **23/23 passed (1.3 m)**, RC=0 |
| E2E de los consumidores de lecturas (5 specs) | **19/19 passed (1.4 m)**, RC=0 |
| `git status -- design/` antes y después de las dos corridas E2E | **limpio las tres veces** (0 cambios) |
| **Los 7 mutantes que yo dejé VIVOS** en la primera pasada | **7 muertos** (detalle abajo) |
| **9 sondas adversariales propias** sobre `emitHaptic` | **9 pasan** (el respaldo corre en las 4 formas de fallar) |
| **6 mutantes propios NUEVOS** sobre el código del delta | **4 muertos, 2 VIVOS** -> 🟠-A y 🟠-B |
| Fuente de `expo-haptics` (`ExpoHaptics.ts` / `Haptics.ts`) | confirma `requireOptionalNativeModule` -> `null` + rechazo async |
| Fuente de `expo-audio` Android (`AudioModule.kt`) | confirma el hallazgo nuevo del implementer (ver §5) |
| Contraste de la nota, calculado sobre los tokens reales | **3,92 -> 5,58** exacto |
| Restauración post-mutantes | md5 de **777 archivos idéntico**, `git status` idéntico, `.wav` 9746/22096 |

---

## 1 · 🔴 EL PUNTO CRÍTICO — el camino de la ausencia se ejercita DE VERDAD (OK)

**Premisa del fix, verificada en la fuente**: `node_modules/expo-haptics/src/ExpoHaptics.ts` usa
`requireOptionalNativeModule` (devuelve `null`, no tira) y `Haptics.ts` hace
`if (!ExpoHaptics?.notificationAsync) throw ...` **dentro** de un `export async function` -> promesa
rechazada. Correcto.

**Los 7 tests EJERCITAN, no nombran.** Lo probé mutando el código:

| Mutante mío sobre `emitHaptic` | Resultado |
|---|---|
| **MUT-1** — se cae el `return` tras `await rich()` -> el respaldo corre SIEMPRE (doble vibración) | **MUERTO** por el CONTRAFACTUAL |
| **MUT-2** — no se espera el resultado (el bug original re-estructurado como fire-and-forget) | **MUERTO** x2 (rechazo + throw síncrono) |
| **MUT-4** — se cae el `require('react-native')` real del respaldo | **MUERTO** x2 (guard de texto + **chequeo de fantasmas** de `SENSORY_OWNERS`) |

**Mis 9 sondas propias — las cuatro que pediste y cinco más, las 9 en verde:**

| Sonda | Qué simula | Resultado |
|---|---|---|
| P1 | el cargador devuelve un **objeto no-callable** | respaldo OK |
| P1b | módulo resuelto **sin `notificationAsync`** (TypeError sync adentro del wrapper) | respaldo OK |
| P2 | el módulo existe pero **el método es `null`** | respaldo OK |
| P3 | **tira DESPUÉS de dos `await` + un `setTimeout`** (rechazo diferido) | respaldo OK |
| P4 | la promesa **resuelve `undefined`** | **sin** respaldo OK (es el camino de éxito real: `notificationAsync` es `Promise<void>`) |
| P5 | el canal rico devuelve un **no-thenable** | sin respaldo — límite estructural, ver ⚪-D |
| P6 | thenable que **nunca resuelve** | `emitHaptic` no vuelve — no bloquea nada, ver ⚪-D |
| P7 | **cargadores DEFAULT en node** (sin RN, sin nativo) | no tira OK |
| P8 | el cargador del respaldo tira tras un rico caído | no tira OK |

**El contrafactual muere si el respaldo corre de más** (MUT-1). Confirmado.

## 2 · Los 7 mutantes del review anterior — los corrí yo, mueren los 7 (OK)

| # | Mutante | Antes | Ahora | Quién lo mata |
|---|---|---|---|---|
| REV-1 | `void player.seekTo(0); play();` (orden roto) | VIVO | **MUERTO** | «el rebobinado se ESPERA» |
| REV-2 | `play()` sin seek | VIVO | **MUERTO** x3 | los tres tests de 🟠-2 |
| REV-3 | el I/O de la preferencia de vuelta en `handleReading` | VIVO | **MUERTO** | GUARD (R4.9) |
| REV-4 | `src/utils/manga-buzz.ts` con **`expo-haptics`**, llamado antes del gate | VIVO (2837 verde) | **MUERTO** | GUARD APP-WIDE |
| REV-5 | ídem con **`Vibration`** de RN | VIVO (2837 verde) | **MUERTO** | GUARD APP-WIDE |
| REV-6 | ídem con `expo-audio` | MUERTO | **MUERTO** | GUARD APP-WIDE |
| REV-7 | `expo-haptics` **dentro** de `services/ble/` | MUERTO | **MUERTO** x3 | los tres guards |

## 3 - 🟠-A — el guard de R4.9 se burla con un helper SÍNCRONO que adentro hace I/O

**Archivo**: `app/src/services/ble/read-dispatch.test.ts:379-420`.

**Es demasiado ancho?** No. Hoy `handleReading` es síncrono de punta a punta
(`BleStickListenerProvider.tsx:192-261`) y no hay nada legítimo que necesite `await` ahí: el despacho a
consumidores es `cb(candidate.eid)` y cada consumidor hace su trabajo asíncrono del otro lado. El mensaje
de fallo además da la salida explícita (lo asíncrono va al warm-up, o fire-and-forget aguas abajo del
punto único), así que el próximo que necesite algo asíncrono con razón no queda sin camino. **No lo cobro
por ancho.**

**Se burla con un helper síncrono que adentro hace I/O?** **SÍ.** Verificado ejecutando, no deducido:

    // feedback-pref.ts (agregado)
    export function refreshBeepPrefNow(): void { void readBeepEnabled(); }

    // BleStickListenerProvider.tsx, DENTRO de handleReading
    refreshBeepPrefNow();
    playFeedback(classifyReadOutcome(candidate), cachedBeepEnabled());

-> **unit COMPLETA 2852/2852 en verde**, y el cruce del puente nativo a `expo-secure-store` **por
bastonazo** está de vuelta: 🟡-11 entero, que es el requisito que esta unidad cierra.

Pasa las tres reglas: (a) no nombra ningún token de `HOT_PATH_IO`; (b) no tiene `await` ni `.then(` —la
asincronía está *adentro* del helper, invisible desde el call site—; (c) sigue llamando
`cachedBeepEnabled()`. La regla (b) solo ve la asincronía que se **escribe** en el cuerpo; un
`void helperNuevo()` la esconde con una indirección de una línea.

**Lo que contradice**: `read-dispatch.test.ts:391-392` — *(b) el cuerpo no puede tener NINGÚN `await` ni
`.then(` — **la regla general** de la que (a) es un caso. **Sin (b), volver a poner el I/O con otro nombre
(un helper nuevo) pasaría igual**.* Es exactamente lo que acabo de hacer pasar. La misma afirmación está
en el informe §11.2 (*la regla general, para que un helper nuevo con otro nombre tampoco pase*).

Es la misma forma del hallazgo 🟠-4 de mi review anterior: el guard cubre la instancia y no la clase, y la
indirección que lo esquiva cuesta una línea.

## 4 - 🟠-B — el respaldo táctil puede colapsar los dos patrones de R4.8, y nada se pone rojo

**Archivo**: `app/src/services/ble/feedback.ts:111-120` (`loadFallbackHaptic`).

Mutante **MUT-3**, aplicado al árbol real:

    - return (pattern: HapticPattern) => Vibration.vibrate(pattern === 'error' ? [0, 55, 70, 55, 70, 55] : 50);
    + return (_pattern: HapticPattern) => Vibration.vibrate(50);

-> **67/67 en verde.** Ningún test lo ve.

**Por qué importa y no es teoría**: en un APK **sin** el módulo nativo de `expo-haptics` —o sea el que Raf
tiene instalado hoy, y el parque entero hasta el próximo build de EAS— el respaldo es el **único** canal
táctil. Con el sonido apagado (el switch nuevo lo permite y R4.1 lo bendice), colapsar los patrones deja
"entró" y "no servía" **indistinguibles**: es 🟡-12 restaurado justo en los equipos donde el respaldo
existe para que R4.8 sobreviva.

**Por qué el test que suena a que lo cubre no lo cubre**: `feedback.test.ts:259` se llama *R4.8: el patrón
llega INTACTO al canal que termine emitiendo (rico o **respaldo**)* — pero le inyecta un `fallbackSpy()`.
Prueba que la **orquestación** pasa el patrón; no puede decir nada del respaldo REAL. Es literalmente el
argumento que el propio informe escribió para justificar conservar el guard de texto (§11.1: *un doble
inyectado no puede demostrar eso*). El argumento vale; acá falta el otro lado.

## 5 - Confirmado: `shouldPlayInSilentMode()` SUPRIME el `play()` en Android (OK)

El hallazgo nuevo del implementer (§11.4) es **cierto**, leído en la fuente:

- `node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioModule.kt:139-141`
  -> `shouldPlayInSilentMode() = playsInSilentMode || audioManager.ringerMode == RINGER_MODE_NORMAL`
- `AudioModule.kt:467-481`, dentro de `Function("play")`:
  `if (!shouldPlayInSilentMode()) { return@Function }`
  **No es manejo de foco: es un `return` antes de tocar.** Con `playsInSilentMode:false` y el timbre en
  **silencio o vibración**, el pip **no suena**. El mismo corte aparece en `:227`, `:307`, `:497`, `:792`.
- **Matiz que suma al costo, y que el implementer no dijo**: `AudioModule.kt:63` — el default del módulo
  en Android **ya es `playsInSilentMode = true`**, y solo pasa a `false` si alguien lo pide explícitamente
  (`:214`). O sea que revertir la clave no es "volver al default": es **activar** una supresión que hoy no
  existe.
- Coherente con lo del foco del review anterior: `requestAudioFocus()` (`:143-146`) retorna temprano con
  `MIX_WITH_OTHERS`.

**Consecuencia para la decisión de Raf**: revertir `playsInSilentMode: true` deja el aviso **mudo** para
todo peón que trabaje con el teléfono en silencio o vibración, que es como se trabaja. No es una
preferencia estética. Ver ⚪-A.

## 6 - La tabla `SENSORY_OWNERS`

**Chequeo de fantasmas (el caso inverso que preguntaste): SÍ funciona.** Verificado con MUT-4: al sacarle
el `Vibration` real a `feedback.ts` —que está declarado dueño— el test cae con "dueños declarados que ya
no lo usan" (`feedback-guard.test.ts:178-179`). Cubre también el caso "el archivo dueño ya no existe" (no
aparece en `found` -> fantasma).

**Agregarse a la tabla**: cuesta **una línea**. Lo probé:

| Mutante | Resultado |
|---|---|
| **REV-9** — `src/utils/manga-buzz.ts` con `Vibration`, **auto-agregado** a `SENSORY_OWNERS` | **MUERTO** — pero solo porque `feedback-guard.test.ts:187` hardcodea ese nombre de archivo como dueño prohibido |
| **REV-10** — lo mismo con **otro nombre** (`src/utils/read-tick.ts`) | **VIVO**, 67/67 verde, con un canal táctil corriendo antes del gate |

**No lo cobro como defecto**: es el contrato declarado del diseño (cabecera del guard: "el costo de
agregar uno legítimo es una línea acá con su motivo") y una allowlist por dueño es la forma correcta —
mueve el costo de cero a "una línea visible en el diff", que es lo que se pedía. Queda como ⚪-B por una
asimetría interna: en el archivo hermano, `PROVIDER_SENSORY_ALLOWED` está **fijada con un
`assert.deepEqual`** (`read-dispatch.test.ts:479`), así que tocarla obliga a romper dos asserts;
`SENSORY_OWNERS` no tiene ese pin y se modifica en un solo lugar.

**Otros límites del barrido, dichos para que no se descubran solos** (ninguno cobrado): solo mira
`.ts`/`.tsx` **no-test** bajo `app/app` y `app/src`; un `.js`, un archivo fuera de esas dos raíces, o un
nombre de módulo construido dinámicamente no lo ve.

## 7 - 🟡 `design.md` describe el guard de módulos con el alcance VIEJO (el que el review falsificó)

`specs/active/04-bluetooth-baston/design.md`, bullet **Guards** de la sección AS-BUILT, dice que
`feedback-guard.test.ts` vigila los MÓDULOS **"en `services/ble/**` solo el punto único puede importar
`expo-haptics|expo-audio|expo-av|expo-speech`"**.

Ese es **exactamente el alcance que el review demostró insuficiente** (🟠-4: `src/utils/manga-buzz.ts`, un
directorio afuera, con 2837 tests en verde). El fix-loop lo reemplazó por un barrido **app-wide con tabla
de dueños**, y ese cambio **no aparece en `design.md`**: buscar `SENSORY_OWNERS`, `app-wide` o `APP-WIDE`
en ese archivo devuelve **cero coincidencias**. Solo está en `progress/current.md`.

Es la regla de "las correcciones se reflejan en las specs" (paso 6 del protocolo de review): el
`design.md` quedó describiendo la estructura anterior al fix, y encima justo en la frase cuyo
razonamiento el review refutó. `tasks.md` T7.6 tampoco nombra el mecanismo (menciona el mutante
`manga-buzz.ts` como muerto, pero no qué lo mata).

## menores

- **⚪-A** — `feedback.ts:308-311`, la doc de `FEEDBACK_AUDIO_MODE` en `feedback-logic.ts`,
  `feedback-guard.test.ts:306-307` y `progress/current.md` siguen diciendo que `playsInSilentMode: true`
  es "reversible en una línea" / "decisión de producto" a secas. El propio fix-loop descubrió (y yo
  confirmé, §5) que revertirlo **suprime el `play()`** en Android con el timbre en silencio o vibración.
  El costo real está escrito en `design.md`, pero **no en los tres lugares que va a leer quien toque la
  clave**. Misma clase de "el comentario dice menos de lo que el código hace" que la unidad viene
  cerrando.
- **⚪-B** — `SENSORY_OWNERS` sin pin (`assert.deepEqual`), a diferencia de `PROVIDER_SENSORY_ALLOWED`
  (§6).
- **⚪-C** — `feedback-guard.test.ts:183-196` ("el guard APP-WIDE DETECTA el mutante EXACTO del review")
  hardcodea `src/utils/manga-buzz.ts`. Prueba el **caso**, no el invariante: con otro nombre de archivo
  ese test no aporta nada (REV-10). No es incorrecto —el barrido real sí es genérico— pero el nombre
  promete más de lo que verifica.
- **⚪-D** — límites de `emitHaptic` que **no** pido cerrar, dichos para el registro: si el canal rico
  **resuelve** sin emitir (P4/P5) no hay forma de saberlo desde JS (`notificationAsync` resuelve
  `undefined` también cuando funciona), y si la promesa **nunca resuelve** (P6) `emitHaptic` no vuelve,
  sin respaldo ni timeout. Verifiqué que **no bloquea la ingesta**: `feedback.ts:356` la invoca con
  `void ... .catch()` y `handleReading` no tiene un solo `await` (lo fija el guard de R4.9). Costo
  máximo: un bastonazo sin canal táctil. Aceptable.

---

## Lo que confirme del delta y esta BIEN

- **El 🔴 esta cerrado y sobre-verificado.** Cuatro formas de fallar + contrafactual + mis 9 sondas. La
  estructura "esperar el resultado y decidir por lo que PASO" es la correcta, y los cargadores
  inyectables son lo que hace ejecutable el camino de la ausencia sin telefono: el argumento del informe
  se sostiene.
- **🟠-2 cerrado.** `emitCueSound` exportada con player espia; el test de los "dos ticks adentro del seek"
  es el bueno, porque detecta el `play` corriendo DENTRO de la ventana del rebobinado, que es el bug real
  en device y no solo el orden textual. Mata REV-1 y REV-2.
- **🟠-4 cerrado en lo que importa.** El barrido app-wide mata las tres indirecciones (REV-4/5/6), que es
  el agujero que yo habia abierto. El chequeo de fantasmas funciona en las dos direcciones.
- **Guard de texto conservado junto al de comportamiento, con roles declarados y distintos.** Correcto: el
  de comportamiento prueba la orquestacion, el de texto prueba que el respaldo real siga cableado. MUT-4
  demuestra que el de texto NO es decorativo.
- **Veto de diseno, medido**: `$textMuted` #5C655F sobre `$surface` #F8F6F1 = **5,58:1** (era `$textFaint`
  #807A74 = **3,92:1**). Calculado por mi sobre los tokens reales de `tamagui.config.ts`. Cumple AA para
  13 px regular.
- **Conteos reconciliados**: **25 mutantes** en el informe 11.4, `tasks.md` T7.6 y `current.md` (antes
  18/14). Capturas: **6 nombres = 4 frames + 2 pares intencionales**, con el porque escrito en la cabecera
  del capture. El conteo ahora es honesto y los dos pares son evidencia, no descuido.
- **Los tres menores del review anterior, cerrados**: la cita de la E2E inexistente (`feedback.test.ts:13`
  ya dice `baston-feedback-sensorial.spec.ts`), `currentBeepEnabled()` **eliminado** (grep: cero
  ocurrencias fuera del comentario que lo explica), y `feedback-guard.test.ts:256` ahora strippea
  comentarios antes del chequeo del `require` de los assets.
- **Fundamento del modo de audio ya no es iOS-centrico**: `design.md` cita la via de Android con lineas.
- **El bastonazo normal sigue entrando, vibrando y sonando en todos los flujos**: `baston*` 23/23 + los 5
  consumidores 19/19, con `check.mjs` RC=0 y la unit completa 2852/2852. El orden del gate 🔴-2 sigue
  intacto (`BleStickListenerProvider.tsx:201-230`: gate, motor de ingesta, feedback, salidas tempranas,
  despacho) y el feedback sigue envuelto en `try/catch` con log.
- **Web sigue degradando en silencio sin romper**: en web el plan trae `haptic: null` (test), `emitHaptic`
  ni se invoca, `beepWebAudio` esta entero dentro de un `try`, y la E2E prueba por comportamiento que con
  el sonido apagado la lectura IGUAL entra (Lecturas (2) con los cues sin crecer).
- **`design/` limpio** antes y despues de las DOS corridas E2E (0 cambios). No hubo nada que revertir, y
  no toque nada ahi.
- **Sin backend**: `git diff supabase/ sync-streams/` vacio, o sea Gate 1 sigue N/A.

---

## Trazabilidad R<n> - test (estado tras el delta)

| Requisito | Test concreto | Verificado |
|---|---|---|
| R4.1 haptica siempre, no apagable | `feedback.test.ts` "R4.1 ... SIEMPRE, con sonido ON y con sonido OFF" + "INVARIANTE: la preferencia apaga el SONIDO y nunca el canal tactil" | OK |
| **R4.1 respaldo cuando el canal rico no emite** | `feedback.test.ts` **x5 de orquestacion** (rechaza / cargador null / cargador tira / throw sincrono / contrafactual) + `feedback-guard.test.ts` (el Vibration real sigue cableado) | OK **por COMPORTAMIENTO** (era el 🔴) |
| R4.2 sonido real en device | `feedback.test.ts` x2 + `feedback-guard.test.ts` (assets existen / PCM mono / no son silencio / duracion) | OK |
| **R4.2 el cue rebobina antes de tocar** | `feedback.test.ts` **x4** con player espia (secuencia real, espera del seek, seek fallido, sin player) | OK (era 🟠-2) |
| R4.2 sin microfono / sin plugin | `app.config.test.ts` | OK |
| R4.3 preferencia + UI + persistencia | `connection-view.test.ts` x4 + E2E "el switch ... silencia sin romper la ingesta, y persiste" | OK (E2E corrida) |
| R4.4 confirmacion visual <1s | E2E de la unidad + `baston.spec.ts` | OK |
| R4.5 degradacion web | `feedback.test.ts` x2 + "sin NINGUN canal tactil no tira" | OK |
| R4.6 / R15.2 no romper la ingesta | `read-dispatch.test.ts` + E2E `baston-lectura-sin-consumidor` + E2E de la unidad | OK |
| **R4.7 punto unico, app-wide** | `feedback-guard.test.ts` "GUARD APP-WIDE ... tabla de DUENOS" + el de `services/ble/` + `read-dispatch.test.ts` | OK (era 🟠-4; REV-4/5/6/7 muertos) |
| R4.8 negativo distinto (canal rico y sonoro) | `feedback.test.ts` x3 + `feedback-guard.test.ts` (negativo != positivo, duracion) + E2E [3150] vs [1300,850] | OK |
| **R4.8 negativo distinto (canal de RESPALDO)** | **ninguno** (el unico candidato usa un doble inyectado) | FALTA - **🟠-B** |
| **R4.9 fuera del camino caliente** | `read-dispatch.test.ts` "GUARD (R4.9)" + `beep-pref-cache.test.ts` (9 tests) | PARCIAL - **mata el mutante literal, no su clase -> 🟠-A** |
| R3.1 re-lectura muda | `feedback.test.ts` + E2E lado (c) | OK |
| modo de audio | `feedback-guard.test.ts` (sobre el VALOR, no el texto) | OK |

**Tasks completas**: si para las de esta unidad (**T6.4 cerrada**, **T7.6 completa**). Las `[ ]` que
quedan en spec 04 (T4.2, T4.4, T4.7, T5.0-T5.3, T6.5, T7.4, T7.5) son **preexistentes y justificadas en
el propio archivo** (hardware que no esta: RS420 real, rig HID, QA de campo). Ninguna es de esta unidad.

## CHECKPOINTS

- **C1** [x] - `check.mjs` **RC=0** ejecutado por mi.
- **C2** [x] - cero features en `in_progress`; `current.md` describe la sesion activa y el fix-loop.
- **C3** [x] - sin capas nuevas, sin deps nuevas en el delta, sin logs de debug, sin `establishment_id`
  hardcodeado.
- **C4** [ ] - el runner muestra 2852 verdes y todo modulo con logica tiene test, **pero dos invariantes
  declarados quedan sin oraculo efectivo** (🟠-A, 🟠-B). Es el box que cae.
- **C5** [ ] - `progress/history.md` sin entrada y nada commiteado. Es el cierre del leader, no del
  implementer: pendiente, no falta.
- **C6** [ ] - los 3 archivos existen y EARS se respeta en R4.8/R4.9, **pero `design.md` quedo viejo
  respecto del as-built del guard de modulos** (seccion 7).
- **C7** N/A - `git diff supabase/ sync-streams/` vacio.
- **C8** [x] / N/A - sin carga de datos nueva; la preferencia es de dispositivo, offline por construccion.
- **C9** [x] - E2E de regresion verde (23/23 + 19/19), capture file con 6 capturas y su conteo honesto,
  `__shots__/*.png` no commiteados. El Gate 2.5 con veto visual es del leader.

## Checklist RAFAQ-especifico

- **A. Multi-tenancy / RLS** - **N/A.** Cero SQL, cero tablas, cero migraciones.
- **B. Offline-first** - **N/A parcial / [x].** No hay carga ni edicion de datos de campo. La preferencia
  es local por diseno (ergonomia de dispositivo), no va a ningun bucket, no necesita conflict resolution,
  y la pantalla no hace requests sincronos a Supabase.
- **C. BLE** - aplica parcialmente:
  - [x] Desconexion repentina: no la toca el delta; el indicador sigue intacto.
  - [x] Modo manual de fallback en 1 tap: el `InfoNote` manual-first de `/baston` sigue en su lugar.
  - [x] Correlacion TAG-peso: N/A (sin balanza). La ventana de dedup de 3 s sigue documentada y su
    desenlace `duplicate` fundamentado en R4.8.
  - [x] Los logs BLE no bloquean: `logTransportEvent` no bloqueante y el feedback envuelto en `try/catch`
    con log (`BleStickListenerProvider.tsx:226-230`).
- **D. UI de campo** - aplica a la tarjeta:
  - [x] Target: fila entera `minHeight="$touchMin"` = 56 dp.
  - [~] Fuente: titulo `$5`=16 px, label `$4`=14 px, nota `$3`=13 px. Por debajo de los 18 pt del
    checkpoint, pero es la escala vigente de toda `StickConnectionScreen` y es una pantalla de ajustes, no
    la UI de manga. Consistente, no regresion. **Mejora del delta**: la nota paso a `$textMuted`
    (5,58:1), asi que el texto chico ahora cumple AA.
  - [x] Una decision por pantalla: un solo switch.
  - [x] Estado de loading: el valor inicial sale del cache **sincrono**, asi que el switch nunca aparece
    indeterminado.
- **E. Edge Functions** - **N/A.**

---

## Cambios requeridos (concretos)

1. **🟠-A - cerrar R4.9 sobre la CLASE, no sobre el mutante.**
   `app/src/services/ble/read-dispatch.test.ts:379-420`. Agregar una **allowlist de los identificadores
   invocables dentro de `handleReading`** (el patron que ya usan `PROVIDER_SENSORY_ALLOWED:271` y
   `CONSUMERS:531` en el mismo archivo), para que un nombre nuevo en el camino caliente nazca en rojo.
   Repro que tiene que morir: `refreshBeepPrefNow()`, un helper void-sincrono que adentro hace
   `void readBeepEnabled()`, hoy **2852/2852 verde** con el cruce a SecureStore por bastonazo restaurado.
   Y corregir la afirmacion de `read-dispatch.test.ts:391-392` y del informe 11.2: la regla del `await` /
   `.then(` **no** es general, no ve la asincronia escondida en un helper.

2. **🟠-B - dar oraculo a R4.8 en el canal de RESPALDO.**
   `app/src/services/ble/feedback.ts:116`. Mover el patron a una funcion pura de `feedback-logic.ts`
   (por ejemplo `fallbackVibrationPattern(pattern)`) y asertar que los dos patrones **difieren**; o un
   assert en `feedback-guard.test.ts` que exija que el argumento de `Vibration.vibrate(` **dependa de
   `pattern`**. Repro que tiene que morir: `Vibration.vibrate(50)` para los dos desenlaces, hoy **67/67
   verde**. Al hacerlo, ajustar el nombre de `feedback.test.ts:259` ("...rico o respaldo") para que no
   prometa mas de lo que su doble inyectado puede probar.

3. **🟡 - reconciliar `design.md` con el as-built del guard.**
   `specs/active/04-bluetooth-baston/design.md`, bullet "Guards" de la seccion AS-BUILT: hoy describe el
   barrido acotado a `services/ble/`, que es el alcance que el review falsifico. Escribir el barrido
   **app-wide con `SENSORY_OWNERS`** y por que el alcance anterior no alcanzaba. Idem una linea en
   `tasks.md` T7.6.

4. **Menor A - subir el costo escrito de revertir `playsInSilentMode`.**
   `feedback.ts:308-311`, la doc de `FEEDBACK_AUDIO_MODE` en `feedback-logic.ts`,
   `feedback-guard.test.ts:306-307` y `progress/current.md`: hoy dicen "reversible en una linea". Agregar
   la consecuencia verificada: en Android `AudioModule.kt:472` **suprime el `play()`** con el timbre en
   silencio o vibracion, y el default del modulo ya es `true`, asi que revertir **activa** una supresion
   que hoy no existe. Sigue siendo decision de Raf; lo que cambia es que se toma informada.

5. **Menor B (opcional, 1 linea)** - pinchar `SENSORY_OWNERS` con un `assert.deepEqual` de sus claves y
   duenos, igual que `PROVIDER_SENSORY_ALLOWED` en `read-dispatch.test.ts:479`, para que auto-agregarse
   cueste romper dos asserts y no uno.

## No verificado (no lo doy por bueno)

- **Que el pip de 3150 Hz se oiga sobre el ruido real de una manga, y que Success vs Error se distingan
  CON GUANTE.** Necesita device y campo (T7.4). Es lo unico que decide si la unidad cumplio su objetivo.
  **NO VERIFICADO** - lo cierra Raf con un build.
- **Que `seekTo(0)` seguido de `play()` reproduzca N veces en hardware**, y que el modo de audio no
  interrumpa una radio real. Leido en el nativo de las dos plataformas y ahora con red por comportamiento
  en CI, **pero no ejercido en un telefono**. **NO VERIFICADO.**
- **Que el respaldo `Vibration` se sienta y se distinga en el APK sin el modulo nativo.** La orquestacion
  esta probada; el efecto fisico no. **NO VERIFICADO.**
- **El comportamiento del APK con el modulo nativo presente** (hace falta un build de EAS, que no lance y
  no me corresponde pedir).

## Higiene de esta revision

Read-only para el producto: **ningun `git add`**, ningun build de EAS. Se aplicaron y revirtieron **16
mutantes** (10 propios + los 7 del review anterior, con solapamiento) y **9 sondas** en un archivo
temporal `__zz-probe.test.ts`, borrado. **Restauracion verificada**: `md5sum -c` sobre **777 archivos**
sin una sola discrepancia, `git status` identico al snapshot inicial, los `.wav` en 9746 / 22096 bytes, y
cero archivos residuales (`manga-buzz.ts`, `read-tick.ts`, `side-buzz.ts`, `__zz-probe.test.ts`: no
existen). Unit de la unidad re-corrida sobre el arbol restaurado: **122/122**. `design/` quedo **limpio**
antes y despues de las dos corridas E2E.
