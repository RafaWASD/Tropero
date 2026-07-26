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
// TECLADO: esta es la reserva con el teclado CERRADO. Un footer keyboard-aware la combina con
// `resolveFooterPaddingBottom` (con el teclado abierto la safe-area la tapa el teclado y reservarla
// dejaría un hueco) — ver `FooterActionShell` / `BottomSheetShell` / `maniobra/carga`.

import { Platform } from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue } from 'tamagui';

import { computeSafeBottomInset } from '../utils/footer-action';

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
