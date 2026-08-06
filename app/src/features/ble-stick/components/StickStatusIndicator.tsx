// StickStatusIndicator — indicador GLOBAL del estado de conexión del bastón en el chrome de la app
// (delta multivendor, RMV3.5). Alimentado por `useBleConnectionStatus()` (implementado por el core de
// spec 04, NO redefinido). Reactivo al `connection_changed` que el provider ya emite.
//
// Montaje: en el host raíz (`app/app/_layout.tsx`, dentro del BleStickListenerProvider), como HERMANO
// del stack de navegación — NO toca ningún archivo/contrato de spec 09 (find-or-create). NO BLOQUEANTE
// (RMV3.6):
//   - `pointerEvents="box-none"` en el CONTENEDOR absoluto → la banda a ancho completo NO captura
//     toques: pasan de largo a la pantalla de abajo. Esto NO se toca: el contenedor mide todo el ancho
//     y varias decenas de px de alto sobre el nav; si capturara, rompería el borde inferior de TODAS
//     las pantallas (es el mismo motivo por el que se descartó agrandar el tabBar).
//   - ANCLADO AL FONDO (estilo "toast"), por encima de la bottom tab bar y del pico del FAB central →
//     nunca pisa el título del header de ninguna pantalla (Gate 2.5 / ADR-029, veta visual resuelta).
//   - se AUTO-OCULTA en 'off' (el estado por defecto / sin bastón activo) → invisible en las pantallas
//     normales; solo aparece cuando hay actividad real del bastón (conectando/conectado/reintentando/
//     desconectado/sin permiso). Durante una demo, es justo cuando se lo quiere ver.
//   - se SUPRIME en la propia `/baston`: ahí la StickConnectionScreen ya muestra el estado en su card
//     (redundante) y el indicador competiría con el título de esa pantalla.
//
// ── ⛔ EL PILL NO ES TOCABLE, Y NO PUEDE SERLO. NO LE PONGAS `onPress` ──────────────────────────────
// Se intentó el 2026-08-06 (pedido de Raf: la app arrancaba con el pill ciclando "Conectando…" y el
// gesto natural —tocar lo que te informa el problema— no hacía nada) y **se revirtió el mismo día con
// evidencia medida**. Queda escrito acá para que el próximo que lo proponga se encuentre con los números
// y no con el silencio:
//
//   · **A07, build real** (720×1600): el CTA primario del asistente de jornada, `'Arrancar jornada'`,
//     ocupa `[34,1242]-[686,1362]`; el pill ocupa `[220,1244]-[500,1306]` — o sea el pill queda
//     **ENTERO ADENTRO del botón**. Hoy un tap en el centro del pill (360, 1275) atraviesa y arranca la
//     jornada, que es lo correcto. Con el pill tocable, ese mismo tap se lo lleva `/baston`: el botón
//     más importante del flujo de manga deja de responder donde el operario apoya el dedo.
//   · **Barrido en web @412×915** (pill `y=[759,799] x=[133,279]`), con el pill como elemento *topmost*
//     en su centro: se quedaba con los toques de `"Ir a Animales"` (tab Inicio), `"Eliminar campo
//     (acción destructiva)"` (tab Más) y **tres maniobras tocables de `/maniobra/jornada` etapa 2**
//     (`"Antibiótico"`, `"Circunferencia escrotal"`, `"Antiparasitario"`) — 🔴 manga.
//
// **La conclusión no es "elegimos mal el lugar": es que el lugar no existe.** La banda de abajo está
// disputada POR DISEÑO — todo CTA a ancho completo la cruza —, así que no hay ninguna posición en el eje
// x donde un pill flotante y tocable sea seguro ahí. Un elemento flotante que reclama toques ajenos es
// exactamente la clase de defecto que esta unidad vino a cerrar (el `hitSlop.top` del FAB), reintroducida
// en la otra dirección. Gatear por ruta ya se descartó aparte (una afordancia que aparece y desaparece
// según dónde estés es peor que una constante).
//
// El acceso a `/baston` ya está resuelto sin esto: la fila de la sección "Dispositivos" del tab "Más"
// (RMV3.1) y el `ConnectHero` que cada pantalla relevante ya monta. No se pierde nada.
//
// Lo hace cumplir `src/utils/tap-target-collision-guard.test.ts` → `(E)`: si aparece un `onPress` o se
// va el `pointerEvents="none"`, el guard se pone rojo.
//
// ── GEOMETRÍA: por qué el pill se ancla donde se ancla ──────────────────────────────────────────────
// El pill flota JUSTO encima del pico del FAB de Maniobra, y hasta el 2026-08-06 el `hitSlop.top` del FAB
// se comía el **48 % inferior** del pill: un toque ahí abría MODO MANIOBRAS (bugfix 🔴 de Raf en device).
// Ojo: que el pill sea `pointerEvents="none"` **no alcanzaba** para evitarlo — el toque atravesaba el
// pill y caía justo en el target inflado del FAB, que es lo que estaba abajo. El fix es del lado del FAB
// (sacarle el `top`), y de este lado se conserva el aire:
//   · el gap al pico del FAB es `$4` (18) y no `$2` (7) → **20 dp** de separación efectiva (el gap más el
//     `$navItemTop` del nav). Con 9-10 dp el pill y el círculo se leían como una sola pieza pegada, y
//     cualquier futuro slop del FAB se los comía de nuevo. El aire es visual Y es margen de seguridad.
//   · NO lleva `minHeight="$chipMin"`: 40 dp es el bar de un TARGET compacto, y esto no es un target. Su
//     alto es el de su contenido (~33 dp), como siempre.
// Lo verifica `src/utils/nav-target-bands.test.ts` (aritmética desde los tokens) y
// `e2e/fab-target-geometry.spec.ts` (cajas reales).
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para el ícono lucide y la geometría. es-AR.

import { usePathname } from 'expo-router';
import { getTokenValue, Text, View, XStack } from 'tamagui';
import { Bluetooth, BluetoothConnected, BluetoothSearching, TriangleAlert } from 'lucide-react-native';

import { useSafeBottomInset } from '@/hooks/useSafeBottomInset';
import { useBleProviderApi } from '@/services/ble/BleStickListenerProvider';
import { useBleConnectionStatus } from '@/services/ble/connection-status';
import type { ConnectionStatus } from '@/services/ble/stick-adapter';
import { isDemoMode } from '@/services/ble/demo-gate';
import { labelA11y } from '@/utils/a11y';
import { connectionStatusView, type ViewTone } from '../connection-view';
import { Platform } from 'react-native';

// ¿Estamos en una corrida E2E que NO es demo? (regresión de Playwright de OTRAS features / capturas).
// El indicador es un elemento NUEVO del chrome GLOBAL: si se montara en las corridas E2E existentes,
// duplicaría textos de estado ('Bastón conectado') que sus specs asertan `{ exact: true }` →
// strict-mode violation. Lo suprimimos SOLO ahí (E2E sin demo) para no perturbar la regresión, sin
// afectar producción (sin marcas → false → se muestra) ni la CAPTURA de esta feature (demo → false →
// se muestra). Lee el global directo (patrón demo-gate/ble-e2e-flag; sin import cross-capa).
function isNonDemoE2E(): boolean {
  try {
    return (globalThis as Record<string, unknown>).__RAFAQ_BLE_E2E__ === true && !isDemoMode();
  } catch {
    return false;
  }
}

function iconFor(status: ConnectionStatus): typeof Bluetooth {
  switch (status) {
    case 'connected':
      return BluetoothConnected;
    case 'connecting':
    case 'scanning':
      return BluetoothSearching;
    case 'permission_denied':
      return TriangleAlert;
    case 'disconnected':
    case 'off':
    default:
      return Bluetooth;
  }
}

function toneColorToken(tone: ViewTone): '$primary' | '$terracota' | '$textMuted' {
  switch (tone) {
    case 'success':
      return '$primary';
    case 'warning':
      return '$terracota';
    case 'progress':
      return '$primary';
    case 'idle':
    default:
      return '$textMuted';
  }
}

export function StickStatusIndicator() {
  const status = useBleConnectionStatus();
  // ¿Hay transporte instanciado? Sin transporte no hay NADA que reportar (el único estado alcanzable es
  // 'off', y el provider ni siquiera suscribe un onStatus) → el pill no existe. Hoy es equivalente al
  // auto-oculto en 'off' de más abajo; se hace explícito para (a) alimentar la vista pura, que exige el
  // dato, y (b) cubrir el transitorio en que el transporte se desmonta en caliente con un status previo
  // pegado (cambio de `mode` del provider). Hook arriba de todo: antes de cualquier return temprano.
  const hasTransport = useBleProviderApi()?.transport != null;
  // MISMA reserva inferior que el bottom-nav: este pill se posiciona RELATIVO a la tab bar, así que
  // tiene que leerla por el mismo hook o se desincroniza. Antes usaba el inset PELADO, que en web (inset
  // 0) lo dejaba 12px por debajo del paddingBottom real del nav y en Android quedaría 16px abajo al
  // sumarse el aire → el pico del FAB (que sube $fabRaise sobre el nav) se lo comía.
  const safeBottom = useSafeBottomInset();
  // Ruta actual del árbol de expo-router. BleHost (donde vive este componente) está DENTRO del contexto de
  // navegación — mismo tramo del árbol que RootGate, que usa useSegments — así que usePathname() resuelve
  // (para la ruta `app/baston.tsx` → '/baston').
  const pathname = usePathname();

  // Suprimido en la regresión E2E no-demo (evita duplicar textos de estado que sus specs asertan exact).
  if (isNonDemoE2E()) return null;

  // Suprimido en la PROPIA pantalla de conexión (/baston): ahí es REDUNDANTE (la StickConnectionScreen ya
  // muestra el estado en su card, con su CTA) y, montado sobre esa pantalla, el pill compite con el título.
  // El indicador GLOBAL (RMV3.5) se demuestra en las pantallas SIN card de estado propia (home, tabs, flujos).
  if (pathname === '/baston') return null;

  // Sin transporte instanciado (native manual-first hoy): nada que indicar → sin pill.
  if (!hasTransport) return null;

  // Auto-oculto en 'off' (sin actividad del bastón): no ensucia el chrome de las pantallas normales.
  if (status === 'off') return null;

  const view = connectionStatusView(status, { hasTransport });
  const colorToken = toneColorToken(view.tone);
  const iconColor = getTokenValue(colorToken, 'color');
  const Icon = iconFor(status);

  return (
    <View
      testID="stick-status-indicator"
      position="absolute"
      // Anclado al FONDO (estilo "toast"), centrado, POR ENCIMA de la bottom tab bar Y del pico del FAB
      // central elevado → nunca pisa el título de un header (en ninguna pantalla). Geometría 100% con tokens
      // (cero hardcode, ADR-023 §4): reserva inferior del nav (`useSafeBottomInset()`, EXACTAMENTE el
      // paddingBottom de la tab bar) + alto de contenido de la nav bar ($navBar=60) + cuánto sube el FAB
      // sobre la barra ($fabRaise=26) + un gap → el pill queda ese gap por encima del pico del FAB.
      // El gap es `$4` (18) desde el 2026-08-06, no `$2` (7): la separación EFECTIVA entre el borde de
      // abajo del pill y el techo del target del FAB es `gap + $navItemTop` = 20 dp (el nav mete 2 de
      // paddingTop antes del círculo). Con 9-10 dp los dos se leían como una sola pieza pegada, y
      // cualquier slop futuro del FAB se los volvía a comer. Lo fija `src/utils/nav-target-bands.test.ts`.
      // En pantallas SIN tab bar (Stack) flota ~navBar+fabRaise px sobre el fondo: aceptable (no hay
      // header abajo que pisar).
      bottom={
        safeBottom +
        getTokenValue('$navBar', 'size') +
        getTokenValue('$fabRaise', 'size') +
        getTokenValue('$4', 'space')
      }
      left="$0"
      right="$0"
      alignItems="center"
      // NO bloqueante (RMV3.6): los toques atraviesan el CONTENEDOR hacia la pantalla de abajo. Solo el
      // pill de adentro es tocable. Cambiar esto por 'auto'/'box-only' convertiría una banda de ancho
      // completo en un capturador de toques sobre el borde inferior de todas las pantallas.
      pointerEvents="box-none"
    >
      {/* EL PILL. `pointerEvents="none"` — NO se toca (ver el bloque ⛔ de la cabecera): el pill se
          superpone a CTAs a ancho completo en las pantallas de manga (medido: 'Arrancar jornada' en el
          A07, las 3 maniobras de jornada etapa 2, "Ir a Animales" en Inicio), así que tiene que dejar
          pasar el toque a lo que hay debajo. `none` y no heredar del contenedor: el contenedor es
          `box-none`, que en Tamagui web emite `._pe-boxnone > * { pointer-events:auto }` — o sea el hijo
          directo VOLVERÍA a capturar si no lo declarara. El `none` explícito es lo que sostiene RMV3.6. */}
      <XStack
        testID="stick-status-pill"
        alignItems="center"
        gap="$2"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$divider"
        borderRadius="$pill"
        paddingHorizontal="$3"
        paddingVertical="$2"
        pointerEvents="none"
        {...labelA11y(Platform.OS, view.label)}
      >
        <Icon size={getTokenValue('$dot', 'size')} color={iconColor} strokeWidth={2.25} />
        <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="600" color={colorToken}>
          {view.label}
        </Text>
      </XStack>
    </View>
  );
}
