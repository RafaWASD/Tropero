// app/(tabs)/index.tsx — Home de RAFAQ (post-creación de establecimiento).
//
// Construida a mano como TEST DE COBERTURA del design system (A.1, ADR-023 §5):
// reproduce el mockup canónico `design/stitch-iter-4/00-home-CANONICAL.png`
// ensamblándose con los componentes derivados (Button / Card / Stepper) + tokens.
// El tab tiene headerShown:false (ADR-018), así que el header es propio de la
// pantalla.
//
// Incremento 1 (colaborativo): header estático + saludo + banner descartable +
// wizard de 3 pasos + CTA del paso 1. FUERA DE SCOPE de este incremento (no se
// construye acá): el dropdown del switch de establecimiento (R6.8.1), "Mis campos"
// / EstablishmentCard, y la navegación real de los CTAs.
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens. Donde un valor
// cruza a una API no-Tamagui (tamaño de íconos lucide) se lee con getTokenValue.

import { useState } from 'react';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Building2, Check, ChevronDown, User, X } from 'lucide-react-native';

import { Button, Card, Stepper, type StepperStep } from '@/components';

// Datos estáticos del mockup (incremento 1). En incrementos posteriores vienen del
// contexto multi-tenant (establishment activo + usuario), nunca hardcodeados — ver
// CLAUDE.md principio 6. Acá son placeholders del mockup canónico.
const ESTABLISHMENT_NAME = 'La Juanita';
const USER_FIRST_NAME = 'Lucas';

const WIZARD_STEPS: StepperStep[] = [
  {
    state: 'active',
    title: 'Creá y configurá tu primer rodeo',
    body: 'Definí sistema productivo (cría / recría / invernada) y qué datos vas a cargar por animal.',
    // children (el CTA) se inyecta abajo para poder cablear su onPress.
  },
  {
    state: 'future',
    title: 'Cargá tu primer animal',
    body: 'Empezá registrando los animales de tu rodeo.',
  },
  {
    state: 'future',
    title: 'Invitá a tu vet o capataz',
    body: 'Sumá miembros con permisos específicos para tu equipo.',
  },
];

/** Header propio de la home (el tab no muestra header nativo, ADR-018). */
function HomeHeader() {
  const iconColor = getTokenValue('$primary', 'color');
  const avatarSize = getTokenValue('$avatar', 'size');
  const mutedColor = getTokenValue('$textMuted', 'color');

  return (
    // Fila a ancho completo. Los 3 bloques (switch · wordmark · avatar) se reparten
    // con space-between; sin width:100% la fila tomaría su ancho intrínseco y, como
    // los hijos RN no encogen por default (flexShrink:0), el avatar quedaba fuera de
    // pantalla a la derecha (Fix 1 — overflow horizontal, incremento 2).
    <XStack width="100%" alignItems="center" justifyContent="space-between" paddingVertical="$3">
      {/* Switch de establecimiento — ESTÁTICO en el incremento 1. Puede encoger
          (flexShrink) y el nombre trunca con ellipsis para no empujar la fila.
          TODO(R6.8.1): abrir el dropdown / pantalla "Mis campos" (incremento posterior). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Establecimiento activo: ${ESTABLISHMENT_NAME}`}
        // minWidth:0 además de flexShrink:1 — en react-native-web el min-width:auto
        // por default impide que el bloque encoja por debajo del ancho intrínseco del
        // nombre del campo; sin esto la fila del header se estira y empuja el avatar
        // fuera de pantalla a la derecha (Fix overflow web).
        style={{ flexShrink: 1, minWidth: 0 }}
        // onPress pendiente — dropdown del switch es incremento posterior (R6.8.1).
      >
        <XStack alignItems="center" gap="$2" flexShrink={1} minWidth={0}>
          <Building2 size={20} color={iconColor} />
          <Text
            fontFamily="$body"
            fontSize="$5"
            fontWeight="600"
            color="$primary"
            flexShrink={1}
            minWidth={0}
            numberOfLines={1}
          >
            {ESTABLISHMENT_NAME}
          </Text>
          <ChevronDown size={18} color={iconColor} />
        </XStack>
      </Pressable>

      {/* Wordmark RAFAQ. No encoge (flexShrink:0): es identidad de marca. */}
      <Text
        fontFamily="$body"
        fontSize="$7"
        fontWeight="700"
        color="$primary"
        letterSpacing={1}
        flexShrink={0}
        marginHorizontal="$2"
      >
        RAFAQ
      </Text>

      {/* Avatar (placeholder: círculo bone con ícono de usuario). No encoge: queda
          siempre visible en el extremo derecho. */}
      <View
        width={avatarSize}
        height={avatarSize}
        borderRadius={9999}
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$divider"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <User size={20} color={mutedColor} />
      </View>
    </XStack>
  );
}

/** Banner "establecimiento listo" — descartable (✕). */
function ReadyBanner({ onDismiss }: { onDismiss: () => void }) {
  const checkColor = getTokenValue('$primary', 'color');
  const iconBox = getTokenValue('$icon', 'size');
  const xColor = getTokenValue('$textMuted', 'color');

  return (
    // Card a ancho completo (alignSelf:stretch) para que el ✕ quede visible a la
    // derecha y no se corte (Fix 1 — overflow horizontal, incremento 2).
    <Card marginTop="$4" alignSelf="stretch">
      <XStack width="100%" alignItems="center" gap="$3">
        {/* Círculo verde claro con check verde botella. Ancho fijo, no encoge. */}
        <View
          width={iconBox}
          height={iconBox}
          borderRadius={9999}
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Check size={24} color={checkColor} strokeWidth={3} />
        </View>

        {/* El texto toma el espacio restante y wrappea (no empuja la fila). minWidth:0
            — en react-native-web el min-width:auto por default impide que el bloque de
            texto encoja por debajo de su ancho intrínseco; sin esto la fila del banner
            se estira y el ✕ queda fuera de pantalla a la derecha (Fix overflow web). */}
        <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" fontWeight="400" color="$textPrimary">
          Tu establecimiento{' '}
          <Text fontFamily="$body" fontWeight="600" color="$textPrimary">
            {ESTABLISHMENT_NAME}
          </Text>{' '}
          está listo.
        </Text>

        {/* ✕ siempre visible a la derecha (no encoge). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Descartar aviso"
          onPress={onDismiss}
          hitSlop={8}
          style={{ flexShrink: 0 }}
        >
          <X size={22} color={xColor} />
        </Pressable>
      </XStack>
    </Card>
  );
}

export default function InicioScreen() {
  const insets = useSafeAreaInsets();
  const [bannerVisible, setBannerVisible] = useState(true);

  // El CTA del paso 1 vive como `children` del paso activo (Button primary fullWidth).
  const steps: StepperStep[] = WIZARD_STEPS.map((step, i) =>
    i === 0
      ? {
          ...step,
          children: (
            <Button
              variant="primary"
              fullWidth
              onPress={() => {
                // TODO: navegar a "Crear rodeo" (spec 02) — fuera del incremento 1.
              }}
            >
              Crear rodeo
            </Button>
          ),
        }
      : step
  );

  return (
    // Raíz a ancho completo: flex:1 + width:100%. El padding horizontal es simétrico
    // ($4 a ambos lados) y vive en los contenedores internos, no acá, para que el
    // fondo $bg cubra todo el ancho (Fix 1 — overflow horizontal, incremento 2).
    // Defensa web (Fix overflow web): maxWidth:100% + overflow:hidden horizontal en la
    // raíz garantizan que NINGÚN hijo pueda exceder el viewport (último cinturón de
    // seguridad si algún flex item se resiste a encoger). El scroll vertical lo maneja
    // el ScrollView interno, así que clipear la raíz no lo rompe.
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Safe-area arriba: el header propio respeta el notch/status bar. */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <HomeHeader />
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          // El contenido nunca excede el ancho del ScrollView → sin scroll horizontal.
          width: '100%',
          maxWidth: '100%',
        }}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Saludo. */}
        <Text
          fontFamily="$body"
          fontSize="$9"
          fontWeight="700"
          color="$textPrimary"
          marginTop="$4"
        >
          ¡Hola {USER_FIRST_NAME}! 👋
        </Text>

        {/* Banner descartable. */}
        {bannerVisible ? <ReadyBanner onDismiss={() => setBannerVisible(false)} /> : null}

        {/* Wizard de 3 pasos. */}
        <YStack marginTop="$6" marginBottom="$8">
          <Stepper steps={steps} />
        </YStack>
      </ScrollView>
    </YStack>
  );
}
