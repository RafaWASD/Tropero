// KeyboardAvoidingShell.android — la implementación de ANDROID del primitivo (el bundler la elige por la
// extensión de plataforma; iOS y web usan `KeyboardAvoidingShell.tsx`, que quedó byte-idéntico a lo que
// había). El PORQUÉ del bug y de la separación por extensión está en el header del archivo base: leelo
// primero. Acá va lo propio de Android.
//
// ── QUÉ HACE ─────────────────────────────────────────────────────────────────────────────────────────
// Aplica al contenedor `paddingBottom = alto del teclado`, o sea la MISMA semántica que el
// `behavior='padding'` que iOS ya tiene verificado en device: el contenido se achica desde abajo y lo que
// esté anclado al fondo (el footer con el CTA, el sheet) queda justo por encima del teclado.
//
// ── DE DÓNDE SALE EL ALTO (y por qué NO se usa el de RN) ─────────────────────────────────────────────
// `useAnimatedKeyboard()` de Reanimated (4.3.1, ya instalado — cero dependencias nuevas) hace exactamente
// la corrección que a RN le falta bajo edge-to-edge. En su nativo (`keyboard/Keyboard.java`):
//     int systemBarBottomInset = isNavigationBarTranslucent ? 0 : insets.getInsets(SYSTEM_BAR_TYPE_MASK).bottom;
//     int keyboardHeightDip   = contentBottomInset - systemBarBottomInset;
// y `src/core.ts` le pasa `EDGE_TO_EDGE || (options.isNavigationBarTranslucentAndroid ?? false)`, con
// `EDGE_TO_EDGE = isEdgeToEdge()` que en Android resuelve por `DeviceInfoModule` (`"isEdgeToEdge" to
// isEdgeToEdgeFeatureFlagOn`) → **true en nuestro build** → `systemBarBottomInset = 0` → la altura es el
// **inset COMPLETO del IME**, sin restarle la barra de navegación.
// El de RN (`ReactRootView.java:978`, `imeInsets.bottom - barInsets.bottom`) sí se la resta: con la barra
// de 3 botones del device de Raf eso son ~48dp de menos, o sea el sheet quedaría 48dp POR DEBAJO del borde
// del teclado — todavía tapado. Por eso el fix no era cambiarle el `behavior` al KeyboardAvoidingView.
//
// ⚠️ NO se le pasan opciones al hook: la detección de edge-to-edge se OR-ea sola (arriba) y pasar un valor
// definido dispara un `console.warn` en DEV (`controlEdgeToEdgeValues`).
//
// ── EL TOTAL DEL PADDING: POR QUÉ NO HAY DOBLE CONTEO ────────────────────────────────────────────────
// Con el teclado ABIERTO se suman DOS reservas y ninguna repite un término (Samsung 3 botones, inset del
// sistema = 48dp; `K` = inset del IME medido desde el borde inferior de la PANTALLA, que bajo edge-to-edge
// **ya incluye la franja de la barra de navegación** porque el SO dibuja la barra ENCIMA del teclado):
//   · este shell            → `paddingBottom = K`  → el borde del contenedor cae EXACTO en el borde
//                             superior del teclado;
//   · el footer de adentro  → `resolveFooterPaddingBottom({ keyboardVisible: true, … })` devuelve SOLO
//                             `keyboardOpenGap` = `$2` (7dp) y **descarta** `useSafeBottomInset()`
//                             (= 48 + 16 = 64dp), justamente porque con el teclado arriba la safe-area
//                             está tapada.
//   → el CTA queda a **$2 = 7dp por encima del borde del teclado**, ni más ni menos.
// Los dos términos que PODRÍAN contarse dos veces no se cuentan: la barra de navegación viaja dentro de
// `K` y el footer no la vuelve a reservar; y el aire de `$navBarGap` no aplica con el teclado arriba
// (no hay barra que esquivar: la tapa el teclado).
// Con el teclado CERRADO, `height.value = 0` → este shell no aporta nada y la reserva vuelve a ser la
// canónica de `useSafeBottomInset()` (48 + 16 = 64). Tampoco hay doble conteo del otro lado.
//
// ── SEGURIDAD DEL WORKLET (este mismo shell crasheó la app hace dos días) ────────────────────────────
// El worklet de acá abajo captura **un solo shared value** (`height`, un mutable creado por `makeMutable`
// dentro del hook) y nada más: ni módulos de RN, ni instancias de clase, ni métodos pelados. Esa es la
// regla que dejó `runOnJS(Keyboard.dismiss)` cuando reventó nativo (SIGABRT sin redbox: el serializador
// convierte una instancia de clase en un Proxy que tira ante cualquier acceso, y en release no hay
// `callGuard` que lo atrape). Está lockeada por `src/components/worklet-callbacks-guard.test.ts`.
// SIN `try/catch`, con el mismo criterio que el `dragStyle` de `BottomSheetShell`: lo único que este
// worklet hace es leer `height.value`; si esa lectura tirara, el shared value estaría roto de raíz y un
// catch solo taparía el síntoma (no hay estado de recuperación mejor que `paddingBottom: 0`, que es
// exactamente el valor inicial).
//
// ── LÍMITE CONOCIDO: MONTAR CON EL TECLADO YA ABIERTO ────────────────────────────────────────────────
// Si el shell MONTA con el teclado YA abierto, arranca en 0 hasta el próximo evento de insets:
// `KeyboardAnimationManager` no le reproduce el estado actual al listener nuevo. `KeyboardAvoidingView` en
// iOS hace lo mismo (se suscribe a `keyboardWillChangeFrame` y iOS no re-emite por un montaje).
//
// ⚠️ CORRECCIÓN (2026-07-28). La primera versión de este bloque despachaba el límite como "paridad con
// iOS, no regresión" y afirmaba que "el flujo del bug reportado no lo toca". **Las dos cosas estaban mal**,
// y las falsificó Raf en device (APK a3b8d804): con el input de caravana enfocado, la ‹ de
// `maniobra/identificar` abría el `ExitJornadaSheet` DEBAJO del teclado — solo asomaba una franja de ~25px
// y sus dos botones ("Terminar jornada" / "Salir sin terminar") quedaban tapados. Que iOS esté igual de
// roto NO vuelve aceptable un diálogo de decisión inoperable en un flujo 🔴 de manga: la paridad describe
// el alcance del defecto, no lo justifica.
//
// ── CÓMO QUEDÓ CERRADO (y por qué no sembrando la altura acá) ────────────────────────────────────────
// El fix NO vive en este archivo: **abrir un overlay modal baja el teclado**
// (`hooks/useDismissKeyboardOnOpen`, adoptado por los 22 archivos que dibujan un `$scrim`, con el guard
// `components/sheet-keyboard-dismiss-guard.test.ts`). Si al abrirse el sheet no hay teclado, no hay nada
// que compensar. Es además la conducta correcta de producto —abrir un sheet es salir del contexto de
// escritura— y era la única salida posible para el sheet del reporte, que **ni siquiera monta este shell**
// (no tiene campos de texto, así que el guard del teclado no se lo exige).
//
// Se EVALUÓ y se DESCARTÓ sembrar `height` en el montaje con `Keyboard.metrics()`. Motivo: su `height` es
// la de RN, o sea la MISMA que está mal bajo edge-to-edge (`ReactRootView.java:978` hace
// `imeInsets.bottom - barInsets.bottom`), así que habría que sumarle de vuelta el inset inferior de
// `systemBars` — una aritmética que (a) no es verificable desde web ni desde el unit, (b) depende de que
// el inset de `react-native-safe-area-context` sea EXACTAMENTE el mismo término que RN resta (no está
// garantizado: gestos vs 3 botones, cutouts, y el frame-0 en 0 contra el que este repo ya tuvo que
// blindarse en `useSafeBottomInset`), y (c) escribe sobre un shared value cuyo dueño es el
// `KeyboardAnimationManager`. Un término de corrección equivocado da un lift EQUIVOCADO, que es peor que
// no levantar nada: el contenido salta a un lugar mal y recién se acomoda con el próximo evento del IME.
// Con la capa de arriba puesta, lo único que queda expuesto al límite es una superficie que monte con el
// teclado arriba SIN ser un overlay (navegar a otra pantalla mientras se tipea), que se auto-corrige al
// primer evento de insets. Queda anotado en `docs/backlog.md` con este razonamiento.
//
// ── DEPRECACIÓN, A CONCIENCIA ────────────────────────────────────────────────────────────────────────
// `useAnimatedKeyboard` está marcado `@deprecated` (apunta a `react-native-keyboard-controller`).
// Deprecated ≠ roto: funciona en la 4.3.1 que ya tenemos, y la alternativa es meter un módulo NATIVO nuevo
// a validar contra RN 0.85 + new arch + Expo 56 justo cuando iOS no se puede re-testear. La migración
// queda anotada en `docs/backlog.md` con el porqué.

import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

import type { KeyboardAvoidingShellProps } from './KeyboardAvoidingShell';

export function KeyboardAvoidingShell({ children, style }: KeyboardAvoidingShellProps) {
  const { height } = useAnimatedKeyboard();
  // El padding sigue al teclado FRAME A FRAME (el nativo actualiza la altura desde el callback de
  // animación de insets), así que el contenido acompaña la animación del IME en vez de saltar.
  const keyboardPadding = useAnimatedStyle(() => ({ paddingBottom: height.value }));

  return <Animated.View style={[style, keyboardPadding]}>{children}</Animated.View>;
}
