// StickStatusIndicator — indicador GLOBAL del estado de conexión del bastón en el chrome de la app
// (delta multivendor, RMV3.5). Alimentado por `useBleConnectionStatus()` (implementado por el core de
// spec 04, NO redefinido). Reactivo al `connection_changed` que el provider ya emite.
//
// Montaje: en el host raíz (`app/app/_layout.tsx`, dentro del BleStickListenerProvider), como HERMANO
// del stack de navegación — NO toca ningún archivo/contrato de spec 09 (find-or-create).
//
// ── LA FORMA: CÍRCULO PERMANENTE QUE SE ESTIRA A PILL AL CAMBIAR (decisión de Raf, 2026-08-06) ───────
// Vive **arriba a la derecha**, permanente, como un **círculo con el ícono solo** (presencia sin ocupar
// lugar); cuando el estado CAMBIA se estira unos segundos a una **pill con el texto corto** y vuelve al
// círculo. Presencia permanente (el chrome nunca queda mudo) + el mensaje completo justo cuando importa.
// El CUÁNDO se decide en `../indicator-morph.ts` (puro, testeado): el ciclo del backoff de reconexión
// —que cicla `connecting`↔`scanning` durante minutos— es UNA sola noticia y no hace parpadear nada.
//
// **El estado NO va por color solo** (WCAG 1.4.1; y ~8 % de los varones no distingue rojo/verde, en un
// producto de usuarios mayoritariamente varones en el campo): lo lleva el **ícono** —`iconFor()`:
// bluetooth / bluetooth-conectado / bluetooth-buscando / triángulo de alerta— y el color lo REFUERZA. Es
// la misma regla que el nav ya aplica ("la pill suma 2 canales además del color", `(tabs)/_layout.tsx`).
//
// ── DÓNDE SE ANCLA, Y POR QUÉ AHÍ (medido) ──────────────────────────────────────────────────────────
// `top = insets.top + ALTO_FILA_HEADER`, `right = $4`: **DEBAJO de la fila del header**, no adentro.
//   · Adentro de la fila NO se puede: esa fila es donde la app pone su acción secundaria, y está ocupada
//     en la home (avatar `$avatar`, medido en x=[353,393] y=[13,52] @412), en `/maniobra` (la ✕ que cierra
//     el modal), en `mis-campos` ("+ Crear campo"), en `lote/[id]` en selección ("Todos/Ninguno") y en el
//     flujo de manga (`SpikeIdentityHeader`: "Saltear ‹maniobra›" + el "⋮", ahí A PROPÓSITO por Fitts).
//     Cederle el lugar en flujo tampoco: **37 pantallas arman su propio header** y no hay componente
//     compartido.
//   · El alto de la fila se DERIVA de tokens y no se elige a ojo: `$3` (su paddingVertical) ×2 + `$avatar`
//     (el elemento más alto que vive en ella). Con eso el círculo despeja la fila en TODAS las pantallas
//     que la arman con el patrón estándar.
//   · Debajo de esa fila la banda está libre en la mayoría (medido con Pillow sobre renders reales: home,
//     "Más", reportes, ficha, alta, listas…). Donde NO lo está —porque la pantalla mete algo a ancho
//     completo pegado al header (buscador, header de identidad de manga)— la pantalla RECLAMA el lugar
//     (`useStickStatusSurface`), igual que las que ya muestran el estado. La lista y la medición están en
//     `progress/impl_pill-arriba-derecha.md`.
//
// ── ⛔ NO ES TOCABLE, Y NO PUEDE SERLO. NO LE PONGAS `onPress` ──────────────────────────────────────
// Se intentó el 2026-08-06 (pedido de Raf: la app arrancaba con el pill ciclando "Conectando…" y el gesto
// natural —tocar lo que te informa el problema— no hacía nada) y **se revirtió el mismo día con evidencia
// medida**. Los números eran de cuando el pill vivía ABAJO (quedaba ENTERO adentro del CTA 'Arrancar
// jornada' del A07: `[34,1242]-[686,1362]` vs `[220,1244]-[500,1306]`, y era el elemento topmost sobre
// "Ir a Animales", "Eliminar campo" y tres maniobras de `/maniobra/jornada`). **Mudarse arriba NO reabre
// la discusión**: un elemento flotante del chrome que reclama toques ajenos es la misma clase de defecto
// —el `hitSlop.top` del FAB, en la otra dirección—, y acá abajo del círculo hay contenido de la pantalla
// (buscadores, cards, la primera línea del contenido). El acceso a `/baston` ya está resuelto sin esto: la
// fila de "Dispositivos" del tab "Más" (RMV3.1) y el `ConnectHero` de cada pantalla relevante.
// Lo hace cumplir `src/utils/tap-target-collision-guard.test.ts` → `(E)`: si aparece un `onPress` o se va
// el `pointerEvents="none"`, el guard se pone rojo. Y lo verifica por comportamiento
// `e2e/fab-target-geometry.spec.ts` (el indicador nunca es el elemento *topmost* en su centro).
//
// ── SUPRESIÓN ───────────────────────────────────────────────────────────────────────────────────────
//   - se AUTO-OCULTA en 'off' (el estado por defecto / sin bastón activo) → invisible en las pantallas
//     normales; solo aparece cuando hay actividad real del bastón. Durante una demo, es justo cuando se
//     lo quiere ver.
//   - se SUPRIME donde OTRA superficie ya muestra el estado (la card de `/baston`, el chip del header de
//     `(tabs)/animales` y `maniobra/identificar`) y donde la pantalla ya usa esa banda. Lo declara cada
//     superficie con `useStickStatusSurface()` mientras está enfocada — NO una lista de rutas acá adentro
//     (hasta el 2026-08-06 era `pathname === '/baston'`, la clase de lista que envejece mal: renombrás la
//     ruta y el indicador vuelve a duplicar en silencio). El porqué, en `services/ble/stick-status-surface.ts`.
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para el ícono lucide y la geometría. es-AR.

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, XStack } from 'tamagui';
import { Bluetooth, BluetoothConnected, BluetoothSearching, TriangleAlert } from 'lucide-react-native';

import { useBleProviderApi } from '@/services/ble/BleStickListenerProvider';
import { useBleConnectionStatus } from '@/services/ble/connection-status';
import { useStickStatusSurfaceClaimed } from '@/services/ble/stick-status-surface';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { INDICATOR_BORDER as BORDER, indicatorGeometry } from '../indicator-geometry';
import type { ConnectionStatus } from '@/services/ble/stick-adapter';
import { isDemoMode } from '@/services/ble/demo-gate';
import { labelA11y } from '@/utils/a11y';
import { connectionRowStatus, stickStateA11yName, toneColorToken } from '../connection-view';
import {
  MORPH_EXPANDED_MS,
  announceKeyFor,
  planMorph,
  type StickAnnounceKey,
} from '../indicator-morph';

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

/** El ícono ES el canal de estado (no el color): ver la cabecera. */
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

/** Duración del estirado/encogido. Corto: es un cambio de forma, no un espectáculo. */
const MORPH_MS = 220;

export function StickStatusIndicator() {
  const status = useBleConnectionStatus();
  // ¿Hay transporte instanciado? Sin transporte no hay NADA que reportar (el único estado alcanzable es
  // 'off', y el provider ni siquiera suscribe un onStatus) → el indicador no existe. Hoy es equivalente al
  // auto-oculto en 'off' de más abajo; se hace explícito para (a) alimentar la vista pura, que exige el
  // dato, y (b) cubrir el transitorio en que el transporte se desmonta en caliente con un status previo
  // pegado (cambio de `mode` del provider). Hooks arriba de todo: antes de cualquier return temprano.
  const hasTransport = useBleProviderApi()?.transport != null;
  // ¿Alguna superficie de la pantalla ENFOCADA ya está mostrando el estado, o ya usa esta banda?
  const surfaceClaimed = useStickStatusSurfaceClaimed();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const geometry = indicatorGeometry();

  // ── El morph ────────────────────────────────────────────────────────────────────────────────────────
  // `expanded` es estado de React (decide qué se muestra); el ANCHO es un shared value de reanimated (se
  // anima en el hilo de UI). El ancho natural de la pill se MIDE (`onLayout` de la fila de adentro): el
  // texto cambia con el estado y con el idioma, así que no puede ser una constante.
  const [expanded, setExpanded] = useState(false);
  const naturalWidth = useSharedValue(0);
  const expandedShared = useSharedValue(0);
  const prevKeyRef = useRef<StickAnnounceKey | null>(null);
  const lastAnnouncedAtRef = useRef<Partial<Record<StickAnnounceKey, number>>>({});

  const announceKey = announceKeyFor(status);
  const visible = !isNonDemoE2E() && !surfaceClaimed && hasTransport && status !== 'off';

  // Decide el aviso cuando cambia la CLASE de estado (no el estado crudo: el backoff no parpadea) y
  // programa la vuelta al círculo. El plan es puro y está testeado en `indicator-morph.test.ts`; acá solo
  // vive el reloj, la memoria de lo anunciado y el timer.
  useEffect(() => {
    if (!visible) {
      // Mientras no se muestra, no se anuncia nada y no se arrastra memoria de una sesión de bastón vieja:
      // si el indicador vuelve a aparecer, esa aparición ES una noticia.
      prevKeyRef.current = null;
      setExpanded(false);
      return;
    }
    const plan = planMorph({
      prevKey: prevKeyRef.current,
      nextKey: announceKey,
      now: Date.now(),
      lastAnnouncedAt: lastAnnouncedAtRef.current,
    });
    prevKeyRef.current = announceKey;
    if (!plan.expand) return;
    lastAnnouncedAtRef.current[announceKey] = Date.now();
    setExpanded(true);
    const timer = setTimeout(() => setExpanded(false), MORPH_EXPANDED_MS);
    return () => clearTimeout(timer);
  }, [announceKey, visible]);

  // El ancho: círculo ↔ natural. Con reduce-motion no hay recorrido (salta), que es exactamente lo que esa
  // preferencia pide — la información igual aparece. Mismo criterio que `Skeleton`.
  useEffect(() => {
    expandedShared.value = expanded ? 1 : 0;
  }, [expanded, expandedShared]);

  const circle = geometry.circle;
  const animatedStyle = useAnimatedStyle(() => {
    const target = expandedShared.value === 1 && naturalWidth.value > 0 ? naturalWidth.value : circle;
    return {
      width: reduceMotion ? target : withTiming(target, { duration: MORPH_MS, easing: Easing.out(Easing.cubic) }),
    };
  }, [reduceMotion, circle]);

  if (!visible) return null;

  const row = connectionRowStatus(status, { hasTransport });
  const colorToken = toneColorToken(row.tone);
  const iconColor = getTokenValue(colorToken, 'color');
  const Icon = iconFor(status);

  return (
    <View
      testID="stick-status-indicator"
      position="absolute"
      // DEBAJO de la fila del header y pegado al margen derecho. El alto de la fila se DERIVA de tokens
      // (`$3` ×2 = su paddingVertical + `$avatar` = el elemento más alto que vive ahí), no se elige a ojo:
      // si mañana el avatar del header cambia de tamaño, el indicador lo sigue solo. Ver la cabecera para
      // por qué no va DENTRO de la fila.
      top={insets.top + getTokenValue('$3', 'space') * 2 + getTokenValue('$avatar', 'size')}
      // ── EL CONTENEDOR VA A ANCHO COMPLETO Y ALINEA A LA DERECHA (no `right={$4}` a secas) ───────────
      // Con `right` en el contenedor, el bug que la captura del Gate 2.5 encontró: al estirarse, la pill
      // crecía hacia la DERECHA y se salía de la pantalla ("Conectado" cortado en el borde @412). El
      // contenedor tomaba su ancho del hijo COLAPSADO (40) y el ancho animado del hijo no lo re-dimensiona.
      // A ancho completo con `alignItems="flex-end"`, el que crece es un hijo alineado al final: la pill se
      // estira hacia la IZQUIERDA, que es lo que tiene que pasar. El `paddingRight` es el margen de la app.
      left="$0"
      right="$0"
      alignItems="flex-end"
      paddingRight={getTokenValue('$4', 'space')}
      // NO bloqueante (RMV3.6): los toques atraviesan el CONTENEDOR hacia la pantalla de abajo. Ahora que
      // mide todo el ancho, esto NO es opcional: sin `box-none` capturaría los toques de una banda entera.
      pointerEvents="box-none"
    >
      {/* EL INDICADOR. `pointerEvents="none"` — NO se toca (ver el bloque ⛔ de la cabecera): flota sobre
          contenido de la pantalla (buscadores, cards, la primera línea del contenido), así que tiene que
          dejar pasar el toque a lo que hay debajo. `none` explícito y no heredado: el contenedor es
          `box-none`, que en web emite `._pe-boxnone > * { pointer-events:auto }` — el hijo directo
          VOLVERÍA a capturar. Ese `none` es lo que sostiene RMV3.6.
          `overflow="hidden"` es el mecanismo del morph: la fila de adentro está SIEMPRE completa y lo que
          cambia es cuánto de ella se ve. */}
      <Animated.View
        testID="stick-status-pill"
        style={[
          {
            height: geometry.circle,
            borderRadius: geometry.circle / 2,
            borderWidth: BORDER,
            borderColor: getTokenValue('$divider', 'color'),
            backgroundColor: getTokenValue('$surface', 'color'),
            overflow: 'hidden',
            // Fila: el hijo conserva su ancho natural y lo que sobra se RECORTA (no se comprime). Con el
            // default (columna + `align-items: stretch`) el hijo heredaba el ancho del clipper y el texto
            // salía apretado; con `flexShrink: 0` (abajo) se desborda y el `overflow: hidden` lo tapa, que
            // es exactamente el mecanismo del morph.
            flexDirection: 'row',
            alignItems: 'center',
          },
          animatedStyle,
        ]}
        pointerEvents="none"
        {...labelA11y(Platform.OS, stickStateA11yName(status, { hasTransport }))}
      >
        {/* ── LA FILA, SIEMPRE COMPLETA ────────────────────────────────────────────────────────────────
            `flexShrink={0}` es lo que hace que mida su ancho NATURAL aunque el clipper esté en 40: sin eso
            el hijo se comprime y el texto sale apretado/cortado adentro de la pill en vez de quedar TAPADO
            por el recorte. Lo encontró la captura del Gate 2.5 (el primer intento la posicionaba absoluta,
            y en web `position:absolute; left:0` igual queda acotado por el ancho del contenedor → medía
            86 px donde el contenido pedía 111, y "Conectado" salía cortado). El `onLayout` de acá es el
            que le dice al morph hasta dónde estirarse: el texto cambia con el estado, así que el destino
            de la animación no puede ser una constante. */}
        <XStack
          flexShrink={0}
          height={geometry.content}
          alignItems="center"
          gap="$2"
          paddingLeft={geometry.pad}
          paddingRight="$3"
          onLayout={(e) => {
            naturalWidth.value = e.nativeEvent.layout.width + BORDER * 2;
          }}
        >
          <Icon size={geometry.icon} color={iconColor} strokeWidth={2.25} />
          <Text
            fontFamily="$body"
            fontSize="$2"
            lineHeight="$2"
            fontWeight="600"
            color={colorToken}
            numberOfLines={1}
            // `flexShrink={0}` TAMBIÉN acá, y no es redundante con el de la fila: el texto es el que se
            // comprimía. Con el clipper en 40 px, el `<Text>` se encogía a lo que "entraba" y arrastraba a
            // la fila con él (medido: la fila reportaba 84 px donde el contenido pide 111, y "Conectado"
            // salía cortado DENTRO de la pill en vez de quedar tapado por el recorte).
            flexShrink={0}
          >
            {row.text}
          </Text>
        </XStack>
      </Animated.View>
    </View>
  );
}

