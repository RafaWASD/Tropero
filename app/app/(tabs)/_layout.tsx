// app/(tabs)/_layout.tsx — shell de navegación raíz de RAFAQ (ADR-018).
//
// Bottom tab bar de 5 items con FAB central elevado:
//   [Inicio]  [Animales]  [⚡ FAB Maniobra]  [Reportes]  [Más]
//
// - Item activo en verde botella ($primary), inactivos en gris ($textMuted).
// - El FAB central NO es una tab plana: es un botón elevado (círculo verde ~64px
//   que sobresale sobre la barra) que abre MODO MANIOBRAS (spec 03, stub /maniobra).
// - Iconos: lucide-react-native (icon set canónico, FRONTEND-STATUS.md).
//
// Regla ADR-023 §4: cero color/spacing hardcodeado acá. Los valores que cruzan a
// APIs no-Tamagui (React Navigation tabBarStyle, color de los íconos lucide) se
// leen de los TOKENS vía getTokenValue('$token', grupo) — siguen referenciando el
// design system, no son literales.

import { Tabs, useRouter } from 'expo-router';
import { BarChart3, Home, Menu, PawPrint, Zap } from 'lucide-react-native';
import { getTokenValue } from 'tamagui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from 'react-native';
import { Text, YStack } from 'tamagui';

// Valores del design system (tokens) leídos en runtime para pasarlos a APIs
// no-Tamagui (React Navigation tabBarStyle, color de los íconos lucide). Se leen
// DENTRO de los componentes (no a nivel de módulo) para garantizar que el config
// (createTamagui) ya esté registrado cuando se ejecuten.
function navColors() {
  return {
    primary: getTokenValue('$primary', 'color'),
    white: getTokenValue('$white', 'color'),
    greenLight: getTokenValue('$greenLight', 'color'),
    textMuted: getTokenValue('$textMuted', 'color'),
    divider: getTokenValue('$divider', 'color'),
    fabSize: getTokenValue('$fab', 'size'),
    // Cuánto sobresale el FAB sobre la barra: fab*0.55 → 35. El FAB FLOTA, la mayor
    // parte del círculo sólido (~55%) asoma por encima del navbar (antes 0.33→21 lo
    // dejaba cortado a la mitad / medio enterrado).
    fabRaise: getTokenValue('$fabRaise', 'size'),
    // Alto de contenido del bottom-nav (insets.bottom se suma aparte). Intermedio:
    // $navBar (60), targets más grandes que MP por uso con guante (manga-friendly).
    navHeight: getTokenValue('$navBar', 'size'),
    // Margen inferior MÍNIMO del nav cuando insets.bottom=0 (Android viejo con botones
    // físicos, o el preview web): garantiza un respiro contra el borde inferior.
    navBottomMin: getTokenValue('$navBottomMin', 'size'),
  };
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
  // Elevación: el FAB FLOTA sobre la barra — ~55% del CÍRCULO SÓLIDO asoma por encima
  // de la línea superior del navbar y ~45% queda solapado dentro (el borde superior de
  // la barra cruza el FAB a ~45% desde arriba). A 0.33 (21px) quedaba "cortado a la
  // mitad" / medio enterrado; a 0.55 (35px) flota claro, sin exagerar. El offset =
  // -$fabRaise (token derivado de fab*0.55 = 35), no literal, y va sobre el CÍRCULO
  // SÓLIDO del FAB — no sobre un wrapper-halo (eso era el bug anterior: el halo tomaba
  // el offset y el círculo sólido asomaba mucho menos mientras el halo tapaba el label).
  // Al subir el FAB, el halo sube con él y deja de tocar el label → ya no hace falta
  // el knockout blanco detrás de "Maniobra".
  const FAB_RAISE = COLOR.fabRaise;
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
      {/* CÍRCULO SÓLIDO del FAB (diámetro $fab = 64). ESTE lleva el marginTop:-$fabRaise
          → asoma ~33% por encima de la línea superior del navbar (idéntico a
          home-fab33.png). El halo es un hijo ABSOLUTO detrás (no ocupa layout, no
          empuja ni el FAB ni el label). overflow:'visible' para que el anillo asome
          sin que el Pressable lo recorte. La sombra vive en el FAB (como en
          home-fab33). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir MODO MANIOBRAS"
        onPress={() => router.push('/maniobra')}
        style={{
          width: FAB_SIZE,
          height: FAB_SIZE,
          borderRadius: FAB_SIZE / 2,
          backgroundColor: COLOR.primary,
          alignItems: 'center',
          justifyContent: 'center',
          // El offset que eleva el botón vive en el CÍRCULO SÓLIDO (no en un wrapper).
          marginTop: -FAB_RAISE,
          // El anillo absoluto asoma 8px alrededor; sin esto el Pressable lo recortaría.
          overflow: 'visible',
          // Sombra (provisional; se canoniza como token de elevación en A.1).
          shadowColor: COLOR.primary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 6,
        }}
      >
        {/* Anillo verde pálido DECORATIVO detrás del FAB (estilo Mercado Pago):
            $greenLight translúcido. position:'absolute' con inset -8px en los 4 lados
            → NO ocupa lugar en el layout (no empuja FAB ni label) y asoma ~8px de
            verde claro alrededor del círculo de 64 (diámetro ≈80 = fab+16). zIndex:-1
            → pinta DETRÁS del círculo dark-green y del ⚡; solo asoma el anillo de 8px.
            Opacidad ~0.45 (más sutil que el 0.55 anterior). */}
        <YStack
          position="absolute"
          top={-8}
          left={-8}
          right={-8}
          bottom={-8}
          borderRadius={9999}
          backgroundColor="rgba(147, 207, 172, 0.45)"
          zIndex={-1}
        />
        <Zap size={28} color={COLOR.white} fill={COLOR.white} />
      </Pressable>
      {/* Label "Maniobra" anclado al FONDO de la celda. Posicionado absoluto contra el
          fondo: el FAB sube (fabRaise 35) sin arrastrar el texto. bottom={LABEL_BOTTOM} =
          -$1 (-2px), bajado para que el tope del texto despeje el borde inferior del halo
          (~2px de aire, medido con CDP — antes con $2 solapaban 7px).
          A DIFERENCIA de los otros 4 labels (gris/regular/11px), "Maniobra" tiene
          DISTINCIÓN INTENCIONAL porque etiqueta el FAB, la acción más importante del nav
          (ADR-018): negro ($textPrimary), negrita (700) y un toque más grande ($2 = 12px
          vs 11). */}
      <Text
        position="absolute"
        bottom={LABEL_BOTTOM}
        // zIndex alto (10): aunque el halo ya no toca el texto, se mantiene el stacking por
        // encima del anillo (zIndex:-1 DENTRO del Pressable) por si en algún device el halo
        // asomara un poco más. Sin costo visual.
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

  // Respeta la safe area (home indicator iOS ~34px / gesture bar Android) pero
  // garantiza un margen MÍNIMO ($navBottomMin = 12) cuando insets.bottom=0 (Android
  // viejo con botones físicos, o el preview web): así el nav nunca queda al ras del
  // borde. iPhone: max(34,12)=34 (sin cambio). Web/Android-sin-inset: max(0,12)=12.
  const navBottom = Math.max(insets.bottom, COLOR.navBottomMin);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLOR.primary,
        tabBarInactiveTintColor: COLOR.textMuted,
        tabBarStyle: {
          backgroundColor: COLOR.white,
          borderTopColor: COLOR.divider,
          height: COLOR.navHeight + navBottom,
          paddingBottom: navBottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        // Gap ícono↔label achicado un toque (nav "intermedio"): marginTop negativo
        // sobre el label lo acerca al ícono sin pegarlos (queda cómodo y legible,
        // NO tan junto como Mercado Pago — uso con guante / manga-friendly).
        tabBarLabelPosition: 'below-icon',
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          // Íconos lucide bajados de ~26 → 24 (nav "intermedio", más compacto sin
          // exagerar): tamaño explícito, no el default del tab bar.
          tabBarIcon: ({ color }) => <Home size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="animales"
        options={{
          title: 'Animales',
          tabBarIcon: ({ color }) => <PawPrint size={24} color={color} />,
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
          tabBarIcon: ({ color }) => <BarChart3 size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mas"
        options={{
          title: 'Más',
          tabBarIcon: ({ color }) => <Menu size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
