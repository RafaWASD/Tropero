// app/(tabs)/_layout.tsx — shell de navegación raíz de RAFAQ (ADR-018).
//
// Bottom tab bar de 5 items con FAB central elevado:
//   [Inicio]  [Animales]  [⚡ FAB Maniobra]  [Reportes]  [Más]
//
// - Item activo: ícono verde botella ($primary) DENTRO de una pill verde claro ($greenLight)
//   estilo Material-3 (active indicator). Inactivos: ícono gris ($textMuted), sin pill. La pill
//   suma 2 canales (forma + fondo) además del color → el activo se distingue al sol / de lejos /
//   con guante sin depender solo del color (WCAG 1.4.1, color como único canal era el problema).
// - El FAB central NO es una tab plana: es un botón elevado (círculo verde ~64px
//   que sobresale sobre la barra) que abre MODO MANIOBRAS (spec 03, stub /maniobra).
// - Iconos: lucide-react-native (icon set canónico, FRONTEND-STATUS.md).
//
// Regla ADR-023 §4: cero color/spacing hardcodeado acá. Los valores que cruzan a
// APIs no-Tamagui (React Navigation tabBarStyle, color de los íconos lucide) se
// leen de los TOKENS vía getTokenValue('$token', grupo) — siguen referenciando el
// design system, no son literales.

import { Tabs, useRouter } from 'expo-router';
import { BarChart3, Home, type LucideIcon, Menu, PawPrint, Zap } from 'lucide-react-native';
import { getTokenValue } from 'tamagui';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, View, type ColorValue } from 'react-native';
import { Text, YStack } from 'tamagui';

import { shadows } from '../../tamagui.config';
import { computeTabBarInsetLayout } from '@/utils/tab-bar-insets';

// Valores del design system (tokens) leídos en runtime para pasarlos a APIs
// no-Tamagui (React Navigation tabBarStyle, color de los íconos lucide). Se leen
// DENTRO de los componentes (no a nivel de módulo) para garantizar que el config
// (createTamagui) ya esté registrado cuando se ejecuten.
function navColors() {
  return {
    primary: getTokenValue('$primary', 'color'),
    white: getTokenValue('$white', 'color'),
    greenLight: getTokenValue('$greenLight', 'color'),
    // Halo verde pálido translúcido del FAB (= $greenLight @ 45%). Token de color
    // propio ($fabHalo) → la pantalla no hardcodea la rgba (ADR-023 §4).
    fabHalo: getTokenValue('$fabHalo', 'color'),
    textMuted: getTokenValue('$textMuted', 'color'),
    divider: getTokenValue('$divider', 'color'),
    fabSize: getTokenValue('$fab', 'size'),
    // Cuánto sobresale el FAB sobre la barra: fab*0.40 → 26 (iteración B4). El FAB FLOTA:
    // ~40% del círculo sólido asoma por encima de la línea superior del navbar y ~60%
    // queda solapado dentro. Antes 0.33→21 lo dejaba medio enterrado; 0.55→35 lo despegaba
    // de más y ocluía más contenido de la pantalla.
    fabRaise: getTokenValue('$fabRaise', 'size'),
    // Inset (magnitud) del anillo del halo respecto al círculo del FAB: 4px, DERIVADO
    // en el config de (fabHalo - fab)/2 = (72-64)/2. La pantalla aplica -fabHaloInset en
    // los 4 lados → no hardcodea el -4 (ADR-023 §4).
    fabHaloInset: getTokenValue('$fabHaloInset', 'size'),
    // Tamaño de los íconos de los 4 items planos del nav (lucide, API no-Tamagui).
    navIcon: getTokenValue('$navIcon', 'size'),
    // Tamaño del ícono ⚡ (Zap) dentro del FAB.
    fabIcon: getTokenValue('$fabIcon', 'size'),
    // Tamaño de fuente del label de los items (= 11px); cruza a tabBarLabelStyle.
    navLabel: getTokenValue('$navLabel', 'size'),
    // Padding superior de cada item del nav; cruza a tabBarItemStyle.
    navItemTop: getTokenValue('$navItemTop', 'size'),
    // Alto de contenido del bottom-nav (insets.bottom se suma aparte). Intermedio:
    // $navBar (60), targets más grandes que MP por uso con guante (manga-friendly).
    navHeight: getTokenValue('$navBar', 'size'),
    // Margen inferior MÍNIMO del nav cuando insets.bottom=0 (Android viejo con botones
    // físicos, o el preview web): garantiza un respiro contra el borde inferior.
    navBottomMin: getTokenValue('$navBottomMin', 'size'),
  };
}

/**
 * Ícono de un item PLANO del nav con "active indicator" pill estilo Material-3 (Run 2 b).
 * Cuando `focused`, el ícono lucide queda DENTRO de una pill verde claro ($greenLight); cuando
 * no, la pill es transparente. Suma forma + fondo al color (el `color` ya viene $primary cuando
 * focused, $textMuted si no, vía tabBarActive/InactiveTintColor) → el activo se distingue sin
 * depender solo del color (WCAG 1.4.1).
 *
 * Layout (RESTRICCIÓN: no romper la celda de 60px ni el label de abajo, ni a 360px):
 * la pill es CHICA y NO empuja el label — el ícono ya estaba en la mitad superior de la celda
 * (paddingTop $navItemTop) y la pill abraza el ícono con un padding mínimo ($3 horizontal / $1
 * vertical). El contenedor es del tamaño del ícono + padding, no fuerza ancho intrínseco que
 * empuje la fila (cabe en la celda de la tab). La pill es decorativa: no intercepta toques
 * (el Pressable de la tab de React Navigation envuelve todo).
 */
function NavTabIcon({ Icon, color, focused }: { Icon: LucideIcon; color: ColorValue; focused: boolean }) {
  const iconSize = getTokenValue('$navIcon', 'size');
  return (
    <YStack
      borderRadius="$pill"
      paddingHorizontal="$3"
      paddingVertical="$1"
      alignItems="center"
      justifyContent="center"
      backgroundColor={focused ? '$greenLight' : 'transparent'}
    >
      <Icon size={iconSize} color={color} />
    </YStack>
  );
}

/**
 * Botón central elevado del bottom nav = entrada a MODO MANIOBRAS.
 * Rompe el layout plano de los 5 items: círculo verde botella que sobresale
 * sobre la barra, ícono rayo blanco, label "Maniobra" debajo.
 */
function ManiobraFab() {
  const router = useRouter();
  const COLOR = navColors();
  const FAB_SIZE = COLOR.fabSize;
  // Elevación: el FAB FLOTA sobre la barra — ~40% del CÍRCULO SÓLIDO asoma por encima
  // de la línea superior del navbar y ~60% queda solapado dentro (el borde superior de
  // la barra cruza el FAB a ~60% desde arriba). A 0.33 (21px) quedaba "cortado a la
  // mitad" / medio enterrado; a 0.55 (35px) flotaba de más y ocluía contenido; B4 lo
  // dejó en 0.40 → 26px. El offset = -$fabRaise (token derivado de fab*0.40 = 26), no
  // literal, y va sobre el CONTENEDOR TOCABLE del FAB (el Pressable), que mide lo mismo
  // que el círculo sólido — no sobre un wrapper-halo (eso era el bug anterior: el halo
  // tomaba el offset y el círculo sólido asomaba mucho menos mientras el halo tapaba el
  // label). Al subir el FAB, el halo sube con él y deja de tocar el label → ya no hace
  // falta el knockout blanco detrás de "Maniobra".
  const FAB_RAISE = COLOR.fabRaise;
  // ── Zona tocable (FIX de la zona muerta de tap) ────────────────────────────────────
  // El círculo se dibuja PARCIALMENTE FUERA de su celda (marginTop:-$fabRaise = -26). En
  // NATIVO los toques que caen fuera de los límites de un ancestro NO se entregan a sus
  // hijos (Android: ViewGroup.dispatchTouchEvent solo desciende a hijos cuyos bounds
  // contienen el punto; iOS: hitTest: devuelve nil si pointInside: es false) → esos 26px
  // que sobresalen NO responden al tap. En WEB no reproduce (el DOM no recorta el
  // hit-testing igual), por eso nunca se detectó: la app se validó siempre en web hasta
  // el bring-up nativo.
  //
  // ELECCIÓN: hitSlop sobre el Pressable, NO reestructurar. Justificación:
  //  - hitSlop es la herramienta correcta para agrandar el target de ESTE botón y es
  //    100% seguro: no cambia una sola coordenada del layout ni de la pintura.
  //  - Reestructurar para que la parte que sobresale quede DENTRO de los bounds de un
  //    ancestro obliga a agrandar el propio tabBar (height += fabRaise + paddingTop
  //    compensatorio + tabBarBackground para no pintar la franja de más). Eso deja una
  //    franja TRANSPARENTE de 26px de ANCHO COMPLETO por encima del nav que, en nativo,
  //    igual captura los toques (una View transparente sigue recibiendo eventos y el
  //    BottomTabBar de React Navigation se monta con pointerEvents="auto", no
  //    "box-none") → los botones y el scroll del contenido en esos 26px dejarían de
  //    funcionar EN TODAS las pantallas. Cambiar una zona muerta de 64×26 por una de
  //    412×26 es peor.
  //  - ⚠️ HONESTO: lo ÚNICO que este hitSlop gana efectivamente es el `bottom`. Extiende el
  //    target hasta el pie de la celda → el label "Maniobra" pasa a ser tocable (antes NO lo
  //    era) y el área útil in-bounds crece de 64×38 a 64×58. Esa es la mitad accionable del
  //    problema, y por eso la mitigación se queda.
  //  - El `top` NO recupera un solo píxel HOY, en NINGUNA de las dos plataformas. Verificado
  //    (en node_modules), no asumido:
  //      · WEB: `hitSlop` es NO-OP. react-native-web (0.21.2) NO lo implementa en `Pressable`
  //        (ni en `usePressEvents`/`PressResponder`): la única aparición de `hitSlop` en el
  //        paquete está en el módulo LEGACY `Touchable`, que este árbol no usa. La prop ni
  //        siquiera figura en el `_excluded` de Pressable → cae en el spread al View y el
  //        whitelist de props del DOM la descarta en silencio. (En web igual no hay nada que
  //        recuperar: el DOM no recorta el hit-testing, la parte elevada ya es tocable.)
  //      · NATIVO: el ancestro recorta ANTES de que el evento llegue al Pressable (Android
  //        ViewGroup.dispatchTouchEvent, iOS hitTest:/pointInside:), así que el slop `top`
  //        tampoco rescata los 26px que sobresalen.
  //    Se deja igual a la elevación por CORRECCIÓN DECLARATIVA (describe el target real del
  //    botón, y si el FAB sale del tabBar el valor ya es el correcto), a costo cero: es
  //    documentación, no función.
  //  - El FIX REAL de la parte elevada (sacar el FAB del tabBar y montarlo como overlay
  //    absoluto en el layout raíz con pointerEvents="box-none" — refactor de navegación con su
  //    propia spec, fuera del alcance de este fix) está anotado en `docs/backlog.md`, entrada
  //    2026-07-18 "Zona muerta de tap en el FAB de Maniobra", con la verificación pendiente en
  //    device.
  //  - Sin slop horizontal a propósito: a 360px de ancho la celda mide 72 EXACTOS (360/5) y el
  //    círculo 64 → 4px de aire por lado, que el anillo del halo (⌀72) ya ocupa ENTEROS. Medido
  //    con Pillow sobre design/nav-iter-2/B4-360.png: el halo se pinta en x 144..215, o sea
  //    justo los bordes de la celda, cero desborde. Cualquier slop lateral le robaría toques a
  //    las tabs vecinas (Animales / Reportes).
  // Los valores se DERIVAN de tokens (no literales): bottom = alto útil de la celda
  // ($navBar - $navItemTop) menos lo que el círculo ya ocupa dentro de ella ($fab - $fabRaise).
  // `left`/`right` se OMITEN (Insets es parcial) en vez de mandarlos en 0: además de dejar
  // explícito que no hay slop horizontal, evita el falso positivo del lint anti-hardcode, que
  // marca `left:`/`right:` con número crudo como spacing sin token.
  const HIT_SLOP = {
    top: FAB_RAISE,
    bottom: Math.max(0, COLOR.navHeight - COLOR.navItemTop - (FAB_SIZE - FAB_RAISE)),
  };
  // Offset vertical del label "Maniobra": el halo verde pálido del FAB asomaba sobre el
  // TOPE del texto (puntito de la "i", tildes, tope de la "M") con bottom=$2 (7px). Medido
  // con CDP a 412px: con $2 el borde inferior del halo (y=883) caía 7px POR DEBAJO del tope
  // del texto (y=876) → solapaban. Bajamos el label a -$1 (-2px): el tope del texto cae ~2px
  // POR DEBAJO del borde inferior del halo (aire de ~2px, sin solape). El valor negativo se
  // arma con -getTokenValue('$1','space') → sigue referenciando el design token, NO es un px
  // literal (ADR-023 §4). Seguro: a -2px el texto queda ~10px del borde de pantalla, dentro
  // del paddingBottom del nav (max(insets,12) en web / inset ~34px en device) → no se corta
  // ni invade el home indicator.
  const LABEL_BOTTOM = -getTokenValue('$1', 'space');
  return (
    <YStack
      alignItems="center"
      justifyContent="flex-start"
      flex={1}
      // El FAB cabe en el ancho de la celda de la tab (no fuerza ancho intrínseco
      // que empuje el layout → evita overflow horizontal con los 5 items + FAB).
    >
      {/* CONTENEDOR TOCABLE del FAB. Mide exactamente lo que el círculo ($fab = 64) y lleva
          el marginTop:-$fabRaise → el conjunto asoma ~40% por encima de la línea superior
          del navbar. NO pinta nada: es solo el Pressable + el ancla de posicionamiento de
          las dos capas visuales (halo y círculo). overflow:'visible' para que el anillo
          del halo asome sin que el Pressable lo recorte.

          ⚠️ EL HALO VA COMO HERMANO ANTERIOR DEL CÍRCULO, NO COMO HIJO (as-built, fix del
          halo que pintaba ENCIMA). Antes el halo era hijo del Pressable con zIndex:-1
          asumiendo que así "pintaba detrás del círculo dark-green" — FALSO en las dos
          plataformas:
            · WEB (react-native-web): el <button> del Pressable computa position:relative +
              z-index:0 → CREA stacking context. Un hijo con z-index negativo se pinta por
              encima del BACKGROUND de su padre (solo queda por debajo del contenido en
              flujo, el ⚡). El halo translúcido quedaba de velo sobre el círculo.
            · NATIVO: un hijo NUNCA se pinta detrás del background de su padre, haga lo que
              haga el zIndex.
          Medido con Pillow sobre la captura real: el relleno daba rgb(82,142,112) = $primary
          velado por el halo, en vez del $primary puro rgb(30,90,62).
          Ahora el fondo NO vive en el Pressable: son dos hermanos, halo primero y círculo
          sólido después. Orden de pintura correcto en ambas plataformas — en web ambos son
          Views de RNW (position:relative, z-index:0) → manda el orden del DOM, y el zIndex:1
          explícito del círculo lo blinda; en nativo manda el orden de hijos (y en Android la
          elevation de shadows.fab refuerza lo mismo). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir MODO MANIOBRAS"
        onPress={() => router.push('/maniobra')}
        // Zona tocable: baja hasta el pie de la celda (el label "Maniobra" pasa a ser tocable)
        // y declara el círculo completo hacia arriba. Ver el bloque HIT_SLOP arriba — incluido
        // el LÍMITE verificado: el `bottom` es lo único que gana área; el `top` no rescata los
        // 26px elevados (nativo: el ancestro recorta antes; web: RNW ni implementa hitSlop en
        // Pressable).
        hitSlop={HIT_SLOP}
        style={{
          width: FAB_SIZE,
          height: FAB_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
          // El offset que eleva el botón vive en el CONTENEDOR TOCABLE (no en un wrapper
          // aparte): así el círculo, el halo y el área de tap suben juntos.
          marginTop: -FAB_RAISE,
          overflow: 'visible',
        }}
      >
        {/* CAPA 1 — anillo verde pálido DECORATIVO, DETRÁS del círculo (estilo Mercado Pago):
            $fabHalo = $greenLight translúcido (rgb verde claro @ 45%, token de color del
            config). position:'absolute' con inset -$fabHaloInset (4px, token derivado de
            (fabHalo-fab)/2) en los 4 lados → NO ocupa lugar en el layout (no empuja ni el
            círculo ni el label) y asoma 4px de verde claro alrededor del círculo de 64
            (diámetro efectivo 72 = fab+8, B4). Va PRIMERO en el orden de hermanos → se pinta
            debajo. Color/inset por TOKEN, no literales (ADR-023 §4). */}
        <YStack
          position="absolute"
          top={-COLOR.fabHaloInset}
          left={-COLOR.fabHaloInset}
          right={-COLOR.fabHaloInset}
          bottom={-COLOR.fabHaloInset}
          borderRadius="$pill"
          backgroundColor="$fabHalo"
        />
        {/* CAPA 2 — CÍRCULO SÓLIDO del FAB (diámetro $fab = 64), $primary OPACO: es el que
            lleva el color de marca y el ⚡ blanco. Va DESPUÉS del halo → se pinta encima, así
            que el verde botella queda puro (sin velo). zIndex:1 explícito: blinda el orden de
            pintura aunque cambie el orden del JSX o la plataforma.

            Es una View de RN con estilo CRUDO (no un YStack de Tamagui) A PROPÓSITO: el estilo
            es EXACTAMENTE el que tenía el Pressable antes del fix (mismo backgroundColor,
            borderRadius y shadows.fab), así el círculo se pinta idéntico y el fix queda acotado
            al ORDEN de las capas. Spreadear shadows.fab como props de Tamagui NO es equivalente:
            Tamagui trata `elevation` como shorthand propio y re-deriva la sombra, lo que ATENUÓ
            la sombra del FAB (medido con Pillow: la franja bajo el círculo pasó de (178,213,194)
            a (199,226,211), casi sin sombra). Con la View cruda, shadows.fab llega tal cual.
            Los valores siguen viniendo del config (shadows.fab / getTokenValue), no se hardcodean
            acá (ADR-023 §4 / docs/design-system.md §5). */}
        <View
          style={{
            width: FAB_SIZE,
            height: FAB_SIZE,
            borderRadius: FAB_SIZE / 2,
            backgroundColor: COLOR.primary,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
            ...shadows.fab,
          }}
        >
          <Zap size={COLOR.fabIcon} color={COLOR.white} fill={COLOR.white} />
        </View>
      </Pressable>
      {/* Label "Maniobra" anclado al FONDO de la celda. Posicionado absoluto contra el
          fondo: el FAB sube (fabRaise 26) sin arrastrar el texto. bottom={LABEL_BOTTOM} =
          -$1 (-2px), bajado para que el tope del texto despeje el borde inferior del halo
          (~2px de aire, medido con CDP — antes con $2 solapaban 7px). Su posición NO se
          alinea con los otros 4 labels: es una decisión deliberada, no un bug de layout.
          A DIFERENCIA de los otros 4 labels (gris/regular/11px), "Maniobra" tiene
          DISTINCIÓN INTENCIONAL porque etiqueta el FAB, la acción más importante del nav
          (ADR-018): negro ($textPrimary), negrita (700) y un toque más grande ($2 = 12px
          vs 11). */}
      <Text
        position="absolute"
        bottom={LABEL_BOTTOM}
        // zIndex alto (10): aunque el halo ya no toca el texto, se mantiene el stacking por
        // encima del anillo (que es un hermano ABSOLUTO dentro del Pressable) por si en algún
        // device el halo asomara un poco más. Sin costo visual.
        zIndex={10}
        // Distinción intencional del label del FAB (vs los otros 4: gris/500/11px).
        fontSize="$2"
        color="$textPrimary"
        fontWeight="700"
      >
        Maniobra
      </Text>
    </YStack>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const COLOR = navColors();

  // Safe area inferior del bottom-nav (bugfix U7 — navbar pegado a la barra del sistema en Android).
  // Respeta el inset real (home indicator iOS ~34 / gesture bar o 3 botones Android) con un mínimo
  // de respiro ($navBottomMin = 12) cuando no hay inset (web / Android viejo con botones físicos).
  //
  // Clave del fix: además del inset VIGENTE (useSafeAreaInsets, que en Android edge-to-edge puede
  // reportar 0 en el frame-cero porque el SafeAreaProvider raíz no está sembrado con
  // initialWindowMetrics y mide async), usamos como PISO el inset medido al ARRANQUE
  // (initialWindowMetrics, sincrónico desde getConstants en nativo). Así el nav arranca con el
  // respiro correcto y NO queda pegado a la gesture bar. En web initialWindowMetrics es null (→ 0)
  // y en iOS coincide con el vigente → ninguno de los dos cambia respecto del comportamiento previo.
  // El cálculo vive en @/utils/tab-bar-insets (función pura, testeada) — este archivo solo lee tokens
  // e insets y los pasa. iPhone: max(34,34,12)=34 (idéntico). Web: max(0,0,12)=12 (idéntico).
  const { height: navHeightTotal, paddingBottom: navBottom } = computeTabBarInsetLayout({
    liveInsetBottom: insets.bottom,
    initialInsetBottom: initialWindowMetrics?.insets.bottom ?? 0,
    navHeight: COLOR.navHeight,
    navBottomMin: COLOR.navBottomMin,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLOR.primary,
        tabBarInactiveTintColor: COLOR.textMuted,
        tabBarStyle: {
          backgroundColor: COLOR.white,
          borderTopColor: COLOR.divider,
          height: navHeightTotal,
          paddingBottom: navBottom,
        },
        // fontSize del label = $navLabel (11px, token leído con getTokenValue → no
        // literal; cruza a la API tabBarLabelStyle de React Navigation).
        tabBarLabelStyle: { fontSize: COLOR.navLabel, fontWeight: '500' },
        // Gap ícono↔label achicado un toque (nav "intermedio"): marginTop negativo
        // sobre el label lo acerca al ícono sin pegarlos (queda cómodo y legible,
        // NO tan junto como Mercado Pago — uso con guante / manga-friendly).
        tabBarLabelPosition: 'below-icon',
        // paddingTop = $navItemTop (2px, token) → separa el ícono del borde de la barra.
        tabBarItemStyle: { paddingTop: COLOR.navItemTop },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          // Active-indicator pill M3 (Run 2 b): NavTabIcon recibe `focused` para pintar la pill
          // verde claro detrás del ícono activo. El tamaño del ícono ($navIcon) vive en NavTabIcon.
          tabBarIcon: ({ color, focused }) => <NavTabIcon Icon={Home} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="animales"
        options={{
          title: 'Animales',
          tabBarIcon: ({ color, focused }) => <NavTabIcon Icon={PawPrint} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="maniobra-fab"
        options={{
          title: '',
          // El FAB central elevado: tabBarButton custom que rompe el layout plano.
          tabBarButton: () => <ManiobraFab />,
        }}
      />
      <Tabs.Screen
        name="reportes"
        options={{
          title: 'Reportes',
          tabBarIcon: ({ color, focused }) => <NavTabIcon Icon={BarChart3} color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="mas"
        options={{
          title: 'Más',
          tabBarIcon: ({ color, focused }) => <NavTabIcon Icon={Menu} color={color} focused={focused} />,
        }}
      />
    </Tabs>
  );
}
