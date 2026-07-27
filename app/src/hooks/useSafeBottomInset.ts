// useSafeBottomInset — LA fuente única de la reserva inferior de la app (unidad «aire»).
//
// Devuelve cuánto padding inferior tiene que dejar cualquier cosa anclada al fondo (footer con CTA,
// bottom sheet, barra sticky, indicador flotante, el bottom-nav) para que:
//   (a) la barra del sistema no la tape        → INSET del SO (con blindaje del frame-0),
//   (b) no quede al ras del borde de pantalla  → PISO ($navBottomMin = 12) cuando no hay inset,
//   (c) no quede SOLDADA a la barra de navegación del SO → AIRE ($navBarGap = 16), solo en Android.
//
//   reserva = max(insetVigente, insetArranque, piso) + (Android ? aire : 0)
//
// ── Por qué el aire es SOLO Android (el condicional que vive acá y en ningún otro lado) ─────────
// En Android el inset inferior vale EXACTAMENTE el alto de la barra de navegación (3 botones o
// gestos), que el SO dibuja como una losa opaca SOBRE el contenido: reservar el inset deja el
// contenido apoyado sobre su borde. Medido en device (Samsung, 3 botones, inset 48, build EAS
// 7402575a): el CTA "Nueva jornada" terminaba a 1dp de la barra, y un toque bajo con guante cae en
// "atrás"/"home" y saca al operario de la jornada (Nielsen #5, pantalla 🔴 manga).
// En iOS el inset de 34pt es espacio PINTADO CON EL FONDO DE LA APP con una pildorita fina adentro
// (el home indicator): el inset ya *es* el aire. Sumarle 16 más haría la tab bar un 33% más alta que
// la nativa de iOS y le comería zona de pulgar a cada CTA — por eso la versión "aditiva en todas las
// plataformas" se descartó. En web no hay barra del sistema: manda el piso.
//
// ── Por qué un hook compartido y no la fórmula copiada ──────────────────────────────────────────
// La fórmula estaba copiada a mano en ~25 archivos (más otras ~12 variantes con un aire hardcodeado).
// Con la fórmula repartida, arreglarla en un lado no arregla nada; con el hook, hay UN lugar donde
// cambiarla. El guard `utils/safe-bottom-inset-guard.test.ts` impide que vuelva a aparecer una copia.
//
// El blindaje del frame-0 de Android edge-to-edge (U7) viaja acá adentro: `useSafeAreaInsets().bottom`
// puede reportar 0 en los primeros frames, así que también se lee `initialWindowMetrics` (sincrónico
// desde getConstants en nativo; `null` en web → 0). Desde esta unidad el `SafeAreaProvider` raíz
// además se siembra con `initialMetrics` (app/app/_layout.tsx), que es el fix canónico app-wide.
//
// TECLADO: `useSafeBottomInset` es la reserva con el teclado CERRADO. La versión keyboard-aware es
// `useKeyboardAwareBottomInset` (abajo, en este mismo archivo): la usa TODA superficie cuyo borde
// inferior queda por encima del teclado gracias a un `KeyboardAvoidingShell`.

import { Platform } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue } from 'tamagui';

import { computeSafeBottomInset, resolveFooterPaddingBottom } from '../utils/footer-action';
import { useKeyboardVisible } from './useKeyboardVisible';

/**
 * ¿Esta plataforma dibuja una BARRA DE NAVEGACIÓN opaca ocupando todo el inset inferior?
 * Solo Android (ver cabecera). Es el ÚNICO `Platform.OS` de toda la reserva inferior: si aparece
 * otro, la fórmula se bifurcó.
 */
const OS_DRAWS_NAV_BAR = Platform.OS === 'android';

/** Aire/piso PROPIOS de una superficie que necesita más que el canónico (ver `computeSafeBottomInset`). */
export interface SafeBottomOwnSpacing {
  /**
   * Aire propio que se SUMA al inset del sistema, además del canónico. Se pasa con un token
   * (`getTokenValue('$6', 'space')`), nunca un número suelto (ADR-023 §4).
   */
  extra?: number;
  /** Piso propio, cuando la superficie quiere más que $navBottomMin con inset 0. También por token. */
  floor?: number;
}

/**
 * Reserva inferior (inset del sistema + piso + aire de Android) para cualquier contenido anclado al
 * fondo. Cruza los tokens a números con `getTokenValue` porque terminan en props/estilos que piden
 * número (ADR-023 §4: cero spacing hardcodeado).
 *
 * Sin argumentos = la reserva CANÓNICA (web 12 · iOS 34 · Android gestos 40 · Android 3 botones 64).
 * Con `{ extra }` / `{ floor }` = superficies que YA tenían más aire que el resto antes de esta
 * unidad y no lo pueden perder (esta unidad agrega aire, nunca lo saca).
 */
export function useSafeBottomInset({ extra = 0, floor = 0 }: SafeBottomOwnSpacing = {}): number {
  const insets = useSafeAreaInsets();
  return computeSafeBottomInset({
    liveInsetBottom: insets.bottom,
    initialInsetBottom: initialWindowMetrics?.insets.bottom ?? 0,
    minInset: getTokenValue('$navBottomMin', 'size'),
    gap: getTokenValue('$navBarGap', 'size'),
    applyGap: OS_DRAWS_NAV_BAR,
    extra,
    floor,
  });
}

/**
 * Reserva inferior de una superficie que vive DENTRO de un `KeyboardAvoidingShell` (o de uno de los
 * shells que lo montan: `FooterActionShell`, `BottomSheetShell`, `AuthScreenShell`):
 *
 *   - teclado CERRADO → la reserva canónica de `useSafeBottomInset(opts)`, idéntica a hoy;
 *   - teclado ABIERTO → SOLO un respiro chico (`$2`).
 *
 * ── POR QUÉ NO ALCANZA CON `useSafeBottomInset()` ────────────────────────────────────────────────────
 * Con el teclado abierto se apilan DOS reservas: el shell ya subió el contenedor el alto ENTERO del
 * teclado (que en Android, bajo edge-to-edge, incluye la franja de la barra de navegación), así que la
 * safe-area del SO queda TAPADA por el teclado. Si la superficie sigue reservándola, quedan ~64dp de
 * **hueco muerto** entre el contenido y el borde del teclado. Este hook es esa resta, y es exactamente
 * la composición que los 4 sitios de la unidad anterior ya tienen verificada en device por Raf:
 * `resolveFooterPaddingBottom({ keyboardVisible, safeInset, keyboardOpenGap: $2 })`.
 *
 * ── POR QUÉ ACÁ Y NO ADENTRO DE `useSafeBottomInset` ─────────────────────────────────────────────────
 * Porque la reserva keyboard-aware SOLO es correcta para lo que efectivamente sube con el teclado. El
 * bottom-nav de `(tabs)/_layout` NO sube (lo dibuja el Navigator, fuera de todo shell) y las ~40 llamadas
 * restantes del hook base son de superficies sin input. Encoger la reserva ahí sería mentir sobre una
 * barra que sigue estando, en un cambio que **web no puede ver** (`Keyboard` de RNW nunca emite → el flag
 * queda en `false` y todo es idéntico) y que por lo tanto solo se detectaría en device. Dos hooks
 * distintos = el call site declara si su borde inferior sube con el teclado o no.
 */
export function useKeyboardAwareBottomInset(own: SafeBottomOwnSpacing = {}): number {
  const keyboardVisible = useKeyboardVisible();
  const safeInset = useSafeBottomInset(own);
  return resolveFooterPaddingBottom({
    keyboardVisible,
    safeInset,
    // Respiro entre el contenido y el borde del teclado. `$2` = el MISMO que usan los 4 sitios
    // verificados en device (FooterActionShell / BottomSheetShell / maniobra-carga / auth).
    keyboardOpenGap: getTokenValue('$2', 'space'),
  });
}
