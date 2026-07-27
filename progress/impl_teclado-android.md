baseline_commit: 4f1f86bacb6661ff9281fbf46fd01a16e2403da8

# UNIDAD «teclado Android» — el teclado tapaba el sheet ENTERO en Android

> Bug 🔴 de Raf (device Samsung, barra de 3 botones, APK release `7402575a`): al enfocar el input del
> sheet de Vacunación, el teclado tapa el sheet ENTERO. En iOS el mismo sheet sube bien.
> Base: `4f1f86b` (unidad «aire»). **Nada commiteado** (lo hace el leader).

## Estado

LISTO para review. `node scripts/check.mjs` verde (alcance declarado abajo — **no corre E2E**).

## Plan (T1..T7) — todas cerradas

- [x] T1. Primitivo `KeyboardAvoidingShell` (base iOS/web + `.android.tsx` con `useAnimatedKeyboard`) + export.
- [x] T2. Guard de clase: ningún `KeyboardAvoidingView` fuera del primitivo + registro en `run-tests.mjs`.
- [x] T3. Migración de los 4 call sites.
- [x] T4. Corrección de los 9 comentarios que afirmaban algo falso (todos citaban el `adjustResize`).
- [x] T5. Reconciliación de specs + `docs/design-system.md` §6 + nota de backlog.
- [x] T6. Capture file del Gate 2.5, con el límite declarado.
- [x] T7. `check.mjs` verde + falsificación del guard.

---

## 1. El diagnóstico (dado por el leader, NO re-investigado) y lo que sí verifiqué yo

El leader entregó la cadena completa: (1) `KeyboardAvoidingView` con `behavior={undefined}` es un `<View>`
pelado en Android; (2) el `adjustResize` está desactivado por el **edge-to-edge forzado** del build; (3) la
altura de teclado que RN emite le **resta la barra de navegación** (`ReactRootView.java:978`), así que
tampoco alcanzaba con cambiarle el `behavior`.

Lo que **leí yo en el código instalado** (no ejecuté nada en device — imposible desde acá):

| Afirmación | Dónde la verifiqué | Resultado |
|---|---|---|
| `useAnimatedKeyboard` NO le resta la barra de navegación bajo edge-to-edge | `react-native-reanimated/android/.../keyboard/Keyboard.java` | ✔ `isNavigationBarTranslucent → systemBarBottomInset = 0` |
| El flag de edge-to-edge llega solo (no hay que pasar opciones) | `react-native-reanimated/src/core.ts:136` | ✔ `EDGE_TO_EDGE \|\| (options… ?? false)` |
| Varios shells montados a la vez son seguros | `keyboard/KeyboardAnimationManager.java` | ✔ `ConcurrentHashMap`, observa en el 1ro, corta en el último, broadcast a todos |
| Montar/desmontar un listener no mueve el layout de la app | `keyboard/WindowsInsetsManager.java` | ✔ con ambos flags translucent, `setMargins(0,0,0,0)`; `stopObservingChanges` NO revierte el decor |
| **El `paddingBottom` animado no se descarta en el camino nativo** | `reanimated/src/common/style/config.ts:72` + `updateProps/updateProps.ts` | ✔ `paddingBottom: true` en `STYLE_PROPERTIES_CONFIG` → pasa por `stylePropsBuilder` al commit de Fabric (Reanimated 4 es new-arch only: ese es el único camino, y ahí los props de LAYOUT sí re-layoutean) |
| `keyboardDidShow`/`DidHide` **siguen disparando** con edge-to-edge (de eso depende que el footer encoja su reserva) | `react-native/ReactAndroid/.../ReactRootView.java:970-980` | ✔ se emiten ante el cambio de **visibilidad** del IME (`rootInsets.isVisible(ime())`), que no depende de que la ventana se encoja |

Ese último punto era el riesgo silencioso: si `keyboardDidShow` no disparara, `resolveFooterPaddingBottom`
seguiría reservando la safe-area completa **y** el shell descontaría el teclado → el CTA quedaría 57px más
arriba de lo debido. No es el caso.

## 2. Qué cambié, archivo por archivo

### Nuevos

| Archivo | Qué es |
|---|---|
| `app/src/components/KeyboardAvoidingShell.tsx` | **Base (iOS + web)**. `KeyboardAvoidingView` con `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` — **exactamente** lo que había en los 4 call sites. Header largo con el diagnóstico completo (por qué el KAV es un no-op en Android, la cadena del edge-to-edge, por qué la altura de RN no sirve, por qué la separación es por extensión de plataforma y no por `if`) + la **precondición: no se anidan dos shells**. |
| `app/src/components/KeyboardAvoidingShell.android.tsx` | **Android**. `useAnimatedKeyboard()` (sin argumentos) + `useAnimatedStyle(() => ({ paddingBottom: height.value }))` sobre un `Animated.View`. Documenta el total del padding (punto 4), la seguridad del worklet, el límite conocido y la deprecación asumida. |
| `app/src/components/keyboard-avoiding-guard.test.ts` | **Guard de clase** (7 tests). Registrado en `scripts/run-tests.mjs`. |
| `app/e2e/captures/teclado-android.capture.ts` | Capture del Gate 2.5 (6 estados) con el límite declarado + 3 assertions de no-regresión en web. |

### Modificados

| Archivo | Cambio |
|---|---|
| `app/src/components/BottomSheetShell.tsx` | Call site 1. `KeyboardAvoidingView` → `KeyboardAvoidingShell` (mismo `avoidStyle`). Header §2 corregido. Nota nueva sobre el `maxHeight:'85%'` bajo un padre padeado. |
| `app/src/components/FooterActionShell.tsx` | Call site 2. Ídem (mismo `fillStyle`). Header §2 corregido; el import de `react-native` quedó `import type` (ya no se usa `Platform` ahí). |
| `app/app/maniobra/carga.tsx` | Call site 3. Ídem; el `{ flex: 1 }` inline pasó a la const de módulo `stepFillStyle` (misma geometría, un objeto menos por render). Dos comentarios corregidos (`:845` y `:990`). |
| `app/src/components/AuthScreenShell.tsx` | Call site 4 (**el login**). Ídem + bloque nuevo que explica **por qué acá el mecanismo es distinto**: el CTA no está en un footer fijo, es un elemento del scroll; lo que lo mantiene alcanzable es que el viewport se ACHIQUE (si no, nada desborda → nada scrollea → el CTA se queda quieto debajo del teclado). La reserva del `contentContainer` NO se tocó (vive dentro del scroll). |
| `app/src/components/index.ts` | Export del primitivo + su tipo. |
| `app/src/utils/footer-action.ts` | 2 comentarios (`:25`, `:133`). El de `resolveFooterPaddingBottom` ahora dice el resultado: el footer queda a `keyboardOpenGap` del borde del teclado. |
| `app/src/utils/sheet-shell.ts` | Comentario `:10`. |
| `app/src/hooks/useKeyboardVisible.ts` | Comentario `:3` + **aviso nuevo**: este hook aporta el FLAG, nunca la ALTURA (la de RN en Android está mal) + por qué el flag sí es confiable con edge-to-edge. |
| `app/src/utils/sheet-gestures.ts` | Comentario `:168` (justificaba una decisión de gesto con "el sheet está LEVANTADO por el KeyboardAvoidingView"). Ahora además avisa que en Android ese re-layout corre en el MISMO hilo de UI que el gesto. |
| `scripts/run-tests.mjs` | Registra el guard nuevo + nota de por qué los guards estáticos están en la lista. |
| `app/e2e/{sheet-teclado,cta-siempre-visible}.spec.ts` + `app/e2e/captures/{sheet-teclado,cta-siempre-visible}.capture.ts` | **Solo comentarios** (4 menciones al `KeyboardAvoidingView` como "lo que sube el contenido en device" — ahora nombran el shell). No estaban en la lista del encargo; los sumé porque son exactamente la clase de comentario que hace nacer bugs por copia. Verificado que los 4 archivos siguen parseando (`playwright --list`, 4 + 6 tests recogidos). |
| `specs/active/03-modo-maniobras/{design,tasks}.md` | Reconciliación (ver §5). |
| `specs/active/08-export-sigsa/design.md` | La mención del lift del `BreedPickerSheet` apuntaba al `KeyboardAvoidingView`. |
| `docs/design-system.md` | §6: entrada nueva del primitivo + las 2 responsabilidades que decían "`adjustResize` en Android". |
| `docs/backlog.md` | Migración a `react-native-keyboard-controller`, con el porqué de no hacerla ahora. |
| `progress/current.md` | Bloque de la unidad. |

## 3. El total del padding (punto 4 del encargo): por qué NO hay doble conteo

Numerado sobre el device del reporte (Samsung, 3 botones, inset del sistema = 48dp). Sea **K** = inset del
IME medido desde el borde inferior de la **pantalla**. Bajo edge-to-edge, **K ya incluye la franja de la
barra de navegación**: el SO dibuja la barra ENCIMA del teclado, no al lado.

**Teclado ABIERTO**

```
shell (Android)   paddingBottom = K              → el borde inferior del content box cae EXACTO
                                                   en el borde superior del teclado
footer de adentro paddingBottom = $2 = 7dp       → resolveFooterPaddingBottom({keyboardVisible:true})
                                                   devuelve SOLO keyboardOpenGap y DESCARTA
                                                   useSafeBottomInset() (= 48 + 16 = 64)
────────────────────────────────────────────────────────────────────────────────────────
CTA: borde inferior a K + 7 del borde de la pantalla = **7dp por encima del borde del teclado**
```

Los dos términos que podrían contarse dos veces, no se cuentan:
- **la barra de navegación (48)**: viaja *dentro* de K y el footer no la vuelve a reservar (es justo lo que
  hace la rama `keyboardVisible` de `resolveFooterPaddingBottom`, que ya existía);
- **el aire `$navBarGap` (16)** de la unidad «aire»: tampoco aplica con el teclado arriba — no hay barra
  que esquivar, la tapa el teclado.

Y es también la razón por la que **no servía** la altura de RN: `imeInsets.bottom - barInsets.bottom` =
K − 48 → el CTA habría quedado 48dp **por debajo** del borde del teclado, o sea todavía tapado (41dp
adentro del teclado). El síntoma habría sido "mejoró pero sigue tapado", que es peor que el bug original
porque parece arreglado.

**Teclado CERRADO**: `height.value = 0` → el shell no aporta nada y la reserva vuelve a ser la canónica
(`useSafeBottomInset()` = 48 + 16 = 64). Sin doble conteo del otro lado tampoco.

**iOS**: idéntico por construcción — `behavior='padding'` hace lo mismo (contenedor achicado por el alto
del teclado) y el footer aporta el mismo `$2`. Esa es la razón de haber elegido "padding en el contenedor"
y no "translateY": Android **converge** a la geometría que Raf ya verificó en iOS, en vez de inventar otra.

**Nit conocido (ANDROID-ONLY, no bug)**: `keyboardVisible` es un booleano de evento y el padding del
shell es una animación. Al abrir el teclado, la reserva del footer cae 64 → 7 de golpe mientras el padding
del shell recién arranca a crecer → hay un desplazamiento hacia abajo de ~57px en los primeros frames de
una animación de ~250ms.

⚠️ **CORREGIDO en la review**: la versión original de este párrafo afirmaba "iOS tiene exactamente el mismo
desfasaje". **Es falso, y la corrección importa** porque el argumento "es paridad" es justamente lo que
haría descartar el síntoma sin mirarlo. En iOS el `KeyboardAvoidingView` llama
`LayoutAnimation.configureNext({duration, type: easing})` (`KeyboardAvoidingView.js:169-180`) en el MISMO
tick de `keyboardWillShow` que dispara `useKeyboardVisible` → los dos cambios (padding del contenedor +
reserva del footer) caen en el mismo commit de React y **animan juntos** con la duración del teclado, sin
blip. En Android están desacoplados por construcción: el footer cambia en un commit de React mientras el
`paddingBottom` rampea en el hilo de UI vía reanimated. **El blip es Android-only.**

Sigue siendo cosmético (la geometría de reposo es correcta) y corregirlo obligaría a volver la reserva del
footer un valor animado en TODOS los consumidores, lo que cambiaría iOS — que es lo único que esta unidad
no puede tocar. Si el veredicto en device lo destapa como molesto, anotarlo como límite Android-only en
la sección "LÍMITE CONOCIDO" de `KeyboardAvoidingShell.android.tsx`.

## 4. Trazabilidad — qué verifica qué

No hay `R<n>` de spec (es un bugfix de unidad, como «aire»). Mapa requisito-de-la-unidad → verificación:

| Requisito de la unidad | Verificación | Tipo |
|---|---|---|
| El primitivo existe y separa por plataforma | `keyboard-avoiding-guard.test.ts` › "la implementación de Android aplica de verdad el alto del teclado" (exige el path `.android.tsx`, el hook, el `useAnimatedStyle`, el `paddingBottom: height.value` y el `Animated.View`) | test estático |
| iOS **no** se movió | mismo guard › "la base conserva el `behavior=padding` de iOS" (exige la línea EXACTA) | test estático |
| Web **no** se movió | `teclado-android.capture.ts` › 3 assertions: la caja del CTA del login, la del sheet y la del CTA del alta son **idénticas** antes y después de enfocar un input; + `paddingBottom` del sheet y del footer = `12px` (el piso de web, igual que en el baseline) | E2E (runtime) |
| Ningún call site se quedó con el patrón roto | mismo guard › "los 4 call sites siguen usando el primitivo" | test estático |
| El patrón no puede volver a aparecer | mismo guard › "el componente de RN solo se monta dentro del primitivo" (**falsificado**, ver §6) | test estático |
| No hay una segunda fuente del alto del teclado | mismo guard › "la altura real del teclado se lee en UN solo archivo" | test estático |
| El worklet no puede crashear como el de hace dos días | `worklet-callbacks-guard.test.ts` (sigue verde; el worklet nuevo captura **solo** el shared value `height`) | test estático |
| Sin regresión en las superficies tocadas | `sheet-teclado` 3/3, `sheet-arrastre` 3/3, `cta-siempre-visible` 1/1, `auth` 4/4 = **11/11** | E2E |
| **Que el sheet SUBA en Android** | **imposible de verificar acá** — ver §7 | ⚠️ DEVICE |

## 5. Reconciliación de specs (regla dura)

- **`specs/active/03-modo-maniobras/design.md`** — la **As-built v7** afirmaba que en Android el lift lo
  resolvía "el `adjustResize` del `softwareKeyboardLayoutMode` default de Expo, verificado sin override en
  `app.config.ts`". Esa verificación era real pero **incompleta** (el manifest sí dice `adjustResize`; lo
  que la anula es el edge-to-edge, que no se mira en `app.config.ts`). Corregido en el lugar con la cita
  textual de lo que decía + puntero, y agregada la **As-built v11** con el diagnóstico completo, el fix, el
  total del padding, el guard y el límite. También la **v9** (arrastre), que justificaba una decisión de
  gesto nombrando al `KeyboardAvoidingView`.
- **`specs/active/03-modo-maniobras/tasks.md`** — misma corrección en la **As-built v8** + **As-built v12**
  nueva con los archivos tocados.
- **`specs/active/08-export-sigsa/design.md`** — la nota del `BreedPickerSheet` atribuía el lift al
  `KeyboardAvoidingView`.
- **`docs/design-system.md` §6** — entrada nueva de `KeyboardAvoidingShell` (contrato + precondición de no
  anidar + el razonamiento del no-doble-conteo) y corregidas las responsabilidades 2 de `FooterActionShell`
  y de `BottomSheetShell`, que decían "`adjustResize` en Android".
- **`docs/backlog.md`** — migración a `react-native-keyboard-controller` con el porqué de no hacerla ahora
  y el detalle de que el cambio queda acotado a UN archivo gracias al primitivo.

## 6. Falsificación del guard (ejecutada, no argumentada)

Rompí dos cosas a propósito, **a la vez**, sobre el árbol real:

1. `AuthScreenShell` revertido al patrón viejo (import + JSX del `KeyboardAvoidingView` de RN);
2. el `.android.tsx` degradado a `paddingBottom: 0` (el modo de falla peligroso: compila, typechequea, y en
   web ni se carga).

Resultado: **3 de 7 tests en rojo**, cada uno con el diagnóstico correcto —

```
✖ el componente de RN solo se monta dentro del primitivo (afuera es un no-op en Android)
  + "src/components/AuthScreenShell.tsx:25  import { KeyboardAvoidingView, Platform } from 'react-native';"
  + "src/components/AuthScreenShell.tsx:43  <KeyboardAvoidingView style={fillStyle} behavior={…}>"
  + "src/components/AuthScreenShell.tsx:86  </KeyboardAvoidingView>"
✖ la implementación de Android aplica de verdad el alto del teclado (no es un no-op decorativo)
  expected: /paddingBottom:\s*height\.value/
✖ los 4 call sites del bug siguen usando el primitivo
  + 'src/components/AuthScreenShell.tsx'
ℹ tests 7 · pass 4 · fail 3
```

Revertido → **7/7 verde**, y `git diff` del archivo revertido idéntico al de antes de romperlo.

## 7. Límites (declarados, no maquillados)

- **El fix es estructuralmente invisible desde web.** react-native-web no monta teclado virtual (`Keyboard`
  nunca emite, el KAV es un `<View>` inerte) y no hay hilo de UI donde corra `useAnimatedKeyboard`. **No
  inventé un test web que "lo cubra"**: sería un falso verde. El veredicto es **DEVICE (ADR-029), Android**.
  Lo que la capture sí verifica es la otra mitad del contrato: que iOS/web no se movieron.
- **iOS no se re-testeó** (Raf no puede hasta el 1/8). El argumento de que no se movió es: la
  implementación base es la MISMA línea que había, lockeada por el guard, y las cajas medidas en web no
  cambiaron. No es una verificación en device de iOS.
- **`check.mjs` NO corre E2E** (cero referencias a e2e/playwright en `check.mjs` ni en `run-tests.mjs`). El
  verde de abajo cubre lint anti-hardcode + typecheck + unit + las suites de backend. La E2E la corrí
  aparte, **acotada a las 4 specs de las superficies tocadas** (11/11). No corrí `pnpm e2e` completa
  (~38 min con **22 rojos pre-existentes en HEAD**, ver `docs/backlog.md`): las 4 specs elegidas son las que
  ejercen los 4 call sites, y la capture agrega las 3 mediciones de no-regresión.
- **Montar el shell con el teclado YA abierto** (p. ej. abrir un sheet mientras se tipeaba detrás): arranca
  en 0 hasta el próximo evento de insets. Es **paridad con el `KeyboardAvoidingView` de iOS** (que tampoco
  recibe un evento por montarse), no una degradación de Android. Documentado en el `.android.tsx`.
- **No hay ningún caso de shells ANIDADOS hoy** (lo verifiqué: los 4 sheets con `BottomSheetShell` se
  montan como HERMANOS del shell de su pantalla — `crear-animal` ↔ `BreedPickerSheet`, `maniobra/carga` ↔
  `LotePickerSheet`, `jornada` ↔ los 3 sheets, `editar-plantilla` ↔ `CustomFieldSheet`, `animal/[id]` ↔
  `BreedPickerSheet`). Queda como precondición escrita en el shell y en `docs/design-system.md`.

## 8. Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

1. **¿El `paddingBottom` animado llega al nativo, o Reanimated lo filtra?** Era EL modo de falla que dejaba
   todo verde con el fix muerto. Fui al código instalado: `STYLE_PROPERTIES_CONFIG` tiene
   `paddingBottom: true` y el update va por el commit de Fabric (Reanimated 4 es new-arch only). **OK.**
2. **¿`keyboardDidShow` sigue disparando con edge-to-edge?** Si no, el footer no encogería su reserva y el
   CTA quedaría 57px alto. Leído en `ReactRootView.java`: se emite ante el cambio de **visibilidad** del
   IME. **OK** (y lo dejé escrito en `useKeyboardVisible`, que era donde faltaba).
3. **¿Doble lift por shells anidados?** Auditados los 6 lugares donde conviven un shell de pantalla y un
   sheet: todos son hermanos. **OK**, más precondición escrita (era un agujero real del contrato).
4. **¿El worklet puede crashear como el de hace dos días?** Destructuré `height` a propósito para que el
   closure capture **solo** un shared value y no el objeto `{state, height}`. El guard de worklets sigue
   verde. **OK.**
5. **¿`try/catch` en el worklet?** Decidí que **no**, con el mismo criterio ya escrito para el `dragStyle`
   de `BottomSheetShell`: lo único que hace es leer un shared value; un catch solo taparía un shell roto de
   raíz, y el estado de recuperación sería `paddingBottom: 0`, que es el valor inicial.
6. **¿Afirmé algo que no verifiqué?** Sí, una: escribí que Yoga resuelve el `maxHeight:'85%'` contra el
   content box del padre padeado. Es lectura, no ejecución → **reescribí el comentario** para decirlo como
   lectura Y agregar por qué da igual si me equivoco (el `flexShrink:1` clampea la columna de todos modos,
   el cap es un techo, no un piso).
7. **¿El guard puede pasar verde sin mirar nada?** Falsificado (§6). Además tiene el test de "recorre el
   árbol real" y las firmas se arman por **concatenación** para que un grep de aceptación sobre
   `app/app` + `app/src` devuelva exactamente UN archivo (el primitivo) y no se reporte a sí mismo.
8. **¿La capture prueba lo que dice probar?** La reescribí para que no sea decorativa: cada estado con foco
   compara la caja contra el mismo estado sin foco. Si el reemplazo hubiera corrido algo en web, cae. Y el
   límite ("acá no se puede ver el fix") está declarado arriba de todo, no escondido.
9. **¿Sobra algo de `Platform` tras sacar el KAV?** `FooterActionShell` se quedó sin ningún uso →
   `import type` puro. `carga.tsx` y `BottomSheetShell` sí lo siguen usando (a11y / back handler).

## 9. Verificación

### `node scripts/check.mjs` — output literal

**Alcance (importante, no lo tapo)**: `check.mjs` **NO corre E2E** — cero referencias a `e2e`/`playwright`
en `check.mjs` y en `run-tests.mjs`. Este verde cubre: archivos del harness, `feature_list.json`, lint
anti-hardcode, **typecheck del cliente**, unit de scripts, **2477 unit del cliente** (incluye los 7 del
guard nuevo) y las 17 suites de backend contra la DB remota.

```
-- 1. Archivos base del harness ----------------------
[OK]    Existe AGENTS.md
[OK]    Existe CLAUDE.md
[OK]    Existe CHECKPOINTS.md
[OK]    Existe feature_list.json
[OK]    Existe progress/current.md
[OK]    Existe progress/history.md
[OK]    Existe progress/plan.md
[OK]    Existe docs/architecture.md
[OK]    Existe docs/conventions.md
[OK]    Existe docs/verification.md
[OK]    Existe docs/specs.md
[OK]    Existe .claude/agents/leader.md
[OK]    Existe .claude/agents/spec_author.md
[OK]    Existe .claude/agents/implementer.md
[OK]    Existe .claude/agents/reviewer.md
[OK]    Existe .claude/agents/security_analyzer.md

-- 2. Validando feature_list.json y specs ------------
[OK]    feature_list.json válido (22 features)
[OK]    context.md presente en context_ready; specs presentes en spec_ready+

-- 2b. Higiene de progress/current.md ----------------
[WARN]  current.md parece inflado (0 bloque(s) de sesión, 324 líneas). Al cerrar sesión, mové el resumen a history.md y dejá current.md limpio (AGENTS.md §6).

-- 2c. Lint anti-hardcode (ADR-023 §4) ---------------
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components

-- 3. Ejecutando tests -------------------------------
    > node scripts/run-tests.mjs
>>> typecheck client
<<< typecheck client OK
>>> scripts unit tests (spec 16 Run B)          [28/28]
<<< scripts unit tests (spec 16 Run B) OK
>>> client unit tests                           [2477/2477]
<<< client unit tests OK
>>> RLS suite
<<< RLS suite OK
>>> Edge Functions suite
<<< Edge Functions suite OK
>>> Animal suite (spec 02)
<<< Animal suite (spec 02) OK
>>> Maneuvers suite (spec 03)
<<< Maneuvers suite (spec 03) OK
>>> Puesta-en-servicio suite (spec 02 Stream A)
<<< Puesta-en-servicio suite (spec 02 Stream A) OK
>>> Reports suite (spec 07 Stream C)
<<< Reports suite (spec 07 Stream C) OK
>>> Custom suite (spec 03 M5)
<<< Custom suite (spec 03 M5) OK
>>> Scrotal/CE suite (spec 03 M6)
<<< Scrotal/CE suite (spec 03 M6) OK
>>> User_private suite (spec 14 + delta TELÉFONO)
<<< User_private suite (spec 14 + delta TELÉFONO) OK
>>> Import suite (spec 12)
<<< Import suite (spec 12) OK
>>> Sync streams no-bypass suite (spec 15)
<<< Sync streams no-bypass suite (spec 15) OK
>>> Operaciones-rodeo suite (spec 10 Fase 1)
<<< Operaciones-rodeo suite (spec 10 Fase 1) OK
>>> SIGSA suite (spec 08 capa DB)
<<< SIGSA suite (spec 08 capa DB) OK
>>> Treatments suite (spec 02 delta tratamientos)
<<< Treatments suite (spec 02 delta tratamientos) OK
>>> Audit suite (spec 18)
<<< Audit suite (spec 18) OK
>>> Health EF suite (spec 16 Run C)
<<< Health EF suite (spec 16 Run C) OK

All tests passed.
[OK]    Tests verdes

-- 4. Resumen ----------------------------------------
[OK]    Entorno listo. Podés trabajar.
```

(Las líneas `✔` por test se elidieron por volumen — el log completo son 3.300 líneas. Los marcadores
`>>> / <<< OK` de cada suite y los totales sí son literales; `RC=0`.)

**Honestidad sobre el primer intento**: la PRIMERA corrida del check quedó roja en la Animal suite con
`TypeError: fetch failed` / `createUser(...): fetch failed` — caída de RED contra Supabase (misma familia
que los flakes ya registrados de la DB compartida), no una regresión: esta unidad es **frontend puro** y no
toca ni una línea de `supabase/`. Re-corrida completa desde cero → el verde de arriba. Lo dejo asentado en
vez de esconder el intento.

**El `[WARN]` de `current.md`** es pre-existente (el archivo viene inflado de sesiones anteriores; lo
vacía el leader al cerrar), no lo introdujo esta unidad.

**Lo que cambió DESPUÉS de esa corrida**: 4 menciones al `KeyboardAvoidingView` en archivos de `e2e/` (que
no entran ni al typecheck —`e2e` está excluido de `tsconfig.json`— ni a ningún runner del check), **y
además `app/src/components/BottomSheetShell.tsx`**, que la redacción original omitía. Los 4 archivos de
`e2e/` se verificaron con `playwright test --list` (4 tests en los 2 `.spec.ts`, 6 en los 3 `.capture.ts`).

⚠️ **CORREGIDO en la review**: la frase decía "lo único que cambió son comentarios", y no era exacta. El
diff neto de `BottomSheetShell.tsx` posterior al verde es comentario + el swap del primitivo, así que el
efecto es nulo — pero la afirmación tal como estaba escrita daba por verificado un árbol que no era el
final. **El reviewer re-corrió `check.mjs` (RC=0), `e2e:build`, las 4 specs (11/11) y el capture (2/2)
sobre el árbol final**, que es lo que cierra el hueco de frescura.

### E2E acotada a las superficies tocadas (aparte, `check.mjs` no corre E2E)

```
Running 11 tests using 1 worker
  ok  1 [chromium] › e2e\auth.spec.ts:19:5 › login con usuario pre-confirmado y SIN campos aterriza en onboarding (6.4s)
  ok  2 [chromium] › e2e\auth.spec.ts:32:5 › sign-up valida los inputs en cliente sin pegarle al server (3.8s)
  ok  3 [chromium] › e2e\auth.spec.ts:61:5 › login con credenciales inválidas muestra error y no navega (4.1s)
  ok  4 [chromium] › e2e\auth.spec.ts:75:5 › logout desde Más vuelve a la pantalla de login (7.8s)
  ok  5 [chromium] › e2e\cta-siempre-visible.spec.ts:55:5 › U2: en el alta (paso 4) el CTA queda en footer FIJO, alcanzable y tappable + peek de scroll (8.9s)
  ok  6 [chromium] › e2e\sheet-arrastre.spec.ts:114:5 › arrastrar el grabber: corto NO cierra (y el sheet vuelve), largo SÍ cierra (10.0s)
  ok  7 [chromium] › e2e\sheet-arrastre.spec.ts:152:5 › con la lista SCROLLEADA, arrastrar desde el cuerpo no cierra el sheet (el header sí) (11.0s)
  ok  8 [chromium] › e2e\sheet-arrastre.spec.ts:220:5 › el FOOTER no es ancla de arrastre (ahí viven los CTAs) (7.8s)
  ok  9 [chromium] › e2e\sheet-teclado.spec.ts:85:5 › sheet de vacunas: Enter agrega SIN perder el teclado, el input queda arriba de los chips, y con poco alto útil el título + input + CTA siguen visibles (9.1s)
  ok 10 [chromium] › e2e\sheet-teclado.spec.ts:158:5 › la X del header cierra el sheet de maniobra custom y el de "Guardar como rutina" (9.8s)
  ok 11 [chromium] › e2e\sheet-teclado.spec.ts:229:5 › picker de razas: el buscador sigue filtrando y la X cierra el sheet (7.5s)
  11 passed (1.6m)
```

### Capture del Gate 2.5

```
Running 2 tests using 1 worker
  ok 1 [chromium] › e2e\captures\teclado-android.capture.ts:59:5 › capturas «teclado Android»: login + bottom sheet de vacunación (y web sin mover un píxel) (13.0s)
  ok 2 [chromium] › e2e\captures\teclado-android.capture.ts:116:5 › capturas «teclado Android»: alta — FooterActionShell con el footer fijo (8.9s)
  2 passed (29.7s)
```

6 PNG generadas en `app/e2e/captures/__shots__/teclado-android/` (gitignoreadas):
`01-login-cta` · `02-login-password-enfocada` · `03-sheet-vacunacion-abierto` · `04-sheet-input-enfocado` ·
`05-alta-footer-fijo` · `06-alta-campo-enfocado`.

**`design/` intacto** tras correr E2E + capture (`git status` sin ningún `design/**/*.png` — la trampa
conocida de `reference_e2e_design_png_rerender`). Nada stageado, nada commiteado.

## 10. Qué me quedó dudoso

1. **El nit del desfasaje de ~57px al abrir el teclado** (§3). No lo corregí a propósito: la corrección
   toca iOS. Si en el device se ve feo, la salida sería alimentar la reserva del footer desde el mismo
   `height.value` (solo en Android), que ya no es un cambio de una línea.
2. **Que la animación quede fluida en un device real.** Animar `paddingBottom` re-layoutea en el hilo de UI
   cada frame; es más caro que un `translateY`. Elegí `padding` porque converge con iOS. Si en el Samsung
   se ve entrecortado, la alternativa (`translateY` en Android) es un cambio local al `.android.tsx`, pero
   cambia la geometría (el contenedor no se achica → el body scrolleable no gana viewport).
3. **El login con el teclado abierto**: el CTA queda **alcanzable** (el viewport se achica → el contenido
   desborda → scrollea), pero **no necesariamente visible sin scrollear**. Es exactamente lo que hace iOS
   hoy, que es lo que Raf aprobó, así que no lo cambié. Si el veredicto de device pide "visible sin
   scrollear", eso es un cambio de diseño del `AuthScreenShell` (footer fijo, como las otras pantallas) y
   afectaría a las 5 pantallas de auth en las dos plataformas.
4. **Los `TagScanSheet` y demás sheets hechos a mano** (los que no adoptaron `BottomSheetShell`) siguen sin
   keyboard-avoidance en ninguna plataforma. Ya estaba en el backlog desde el bugfix de iOS; el guard nuevo
   **no** los caza (no montan un `KeyboardAvoidingView`: directamente no tienen nada).
