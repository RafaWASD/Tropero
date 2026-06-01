// app/(tabs)/index.tsx — Home de RAFAQ (post-creación de establecimiento).
//
// Construida a mano como TEST DE COBERTURA del design system (A.1, ADR-023 §5):
// reproduce el mockup canónico `design/stitch-iter-4/00-home-CANONICAL.png`
// ensamblándose con los componentes derivados (Button / Card / Stepper) + tokens.
// El tab tiene headerShown:false (ADR-018), así que el header es propio de la
// pantalla.
//
// Incremento 1 (colaborativo): header estático + saludo + banner descartable +
// wizard de 3 pasos + CTA del paso 1.
//
// Incremento (R6.8.1): el switch del header pasa de ESTÁTICO a DROPDOWN funcional
// (EstablishmentSwitcherDropdown): campo activo ● → últimos 2 visitados → "Ver todos
// mis campos" (→ /mis-campos) → "Crear nuevo campo +" (→ /crear-campo).
//
// B.1.2 (Fase 4): la home se CABLEA a datos reales — fuera el mock data. El nombre del
// usuario viene de AuthContext; el campo activo y los visitados, de EstablishmentContext.
// El switch refleja el campo activo REAL; al elegir un visitado, switchEstablishment(id)
// cambia el contexto y la home re-renderiza con el campo nuevo (bug (a) de Raf). NUNCA se
// hardcodea establishment_id (CLAUDE.md ppio 6).
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens. Donde un valor
// cruza a una API no-Tamagui (tamaño de íconos lucide) se lee con getTokenValue.

import { useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Building2, Check, ChevronDown, User, X } from 'lucide-react-native';

import {
  Button,
  Card,
  EstablishmentSwitcherDropdown,
  Stepper,
  pickVisited,
  type StepperStep,
  type SwitcherField,
} from '@/components';
import { useAuth, useEstablishment } from '@/contexts';
import { localityOf, shouldShowReadyBanner } from '@/utils/establishment';
import { addDismissedBanner, loadDismissedBanners } from '@/services/establishment-store';

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
function HomeHeader({
  activeName,
  isOpen,
  highlight,
  onSwitchPress,
}: {
  activeName: string;
  isOpen: boolean;
  /** Pulso de confirmación al cambiar de campo (Run 2 d): fondo $greenLight breve en el chip. */
  highlight: boolean;
  onSwitchPress: () => void;
}) {
  const iconColor = getTokenValue('$primary', 'color');
  const avatarSize = getTokenValue('$avatar', 'size');
  const mutedColor = getTokenValue('$textMuted', 'color');

  return (
    // Fila a ancho completo. Los 3 bloques (switch · wordmark · avatar) se reparten
    // con space-between; sin width:100% la fila tomaría su ancho intrínseco y, como
    // los hijos RN no encogen por default (flexShrink:0), el avatar quedaba fuera de
    // pantalla a la derecha (Fix 1 — overflow horizontal, incremento 2).
    <XStack width="100%" alignItems="center" justifyContent="space-between" paddingVertical="$3">
      {/* Switch de establecimiento — al tocarlo DESPLIEGA el dropdown inline (R6.8.1).
          Puede encoger (flexShrink) y el nombre trunca con ellipsis para no empujar la
          fila. `aria-expanded` comunica el estado abierto a tecnologías de asistencia. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Establecimiento activo: ${activeName}. Tocá para cambiar de campo.`}
        aria-expanded={isOpen}
        onPress={onSwitchPress}
        // minWidth:0 además de flexShrink:1 — en react-native-web el min-width:auto
        // por default impide que el bloque encoja por debajo del ancho intrínseco del
        // nombre del campo; sin esto la fila del header se estira y empuja el avatar
        // fuera de pantalla a la derecha (Fix overflow web).
        style={{ flexShrink: 1, minWidth: 0 }}
      >
        {/* Chip del switch. Lleva el pulso de confirmación al cambiar de campo (Run 2 d):
            fondo $greenLight breve (~450ms) que aparece y se desvanece, dejando el chip en
            su estado normal (transparente). borderRadius $pill + padding chico para que el
            realce se vea como una pill, no un bloque cuadrado. El pulso es DECORATIVO: no
            mueve el layout (el padding está siempre presente) ni bloquea toques. Sin driver
            de `animations` en el config (tamagui.config.ts) → toggle de fondo con timeout. */}
        <XStack
          alignItems="center"
          gap="$2"
          flexShrink={1}
          minWidth={0}
          borderRadius="$pill"
          paddingHorizontal="$2"
          paddingVertical="$1"
          backgroundColor={highlight ? '$greenLight' : 'transparent'}
        >
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
            {activeName}
          </Text>
          {/* El chevron rota 180° cuando el dropdown está abierto (feedback de estado,
              Nielsen #1). rotate cruza a transform; no es color/spacing → sin token. */}
          <View style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}>
            <ChevronDown size={18} color={iconColor} />
          </View>
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
        borderRadius="$pill"
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
function ReadyBanner({
  establishmentName,
  onDismiss,
}: {
  establishmentName: string;
  onDismiss: () => void;
}) {
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
          borderRadius="$pill"
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
            {establishmentName}
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
  const router = useRouter();
  const { state: authState } = useAuth();
  const { state: estState, recents, switchEstablishment } = useEstablishment();

  const userId = authState.status === 'authenticated' ? authState.user.id : null;

  // ── Datos reales (Fase 4) ────────────────────────────────────────────────────
  // Nombre del usuario ← AuthContext (primer nombre del perfil). Campo activo ← contexto
  // multi-tenant (R6.3). NUNCA se hardcodea (CLAUDE.md ppio 6).
  const userFirstName =
    authState.status === 'authenticated' ? firstNameOf(authState.user.name) : null;

  // El campo activo real. La home solo se renderiza cuando el gating ya garantizó estado
  // 'active' (RootGate), pero defendemos por si se monta en transición. Lleva localidad + rol
  // (Run 2 e) para el subtítulo de desambiguación del dropdown del switch.
  const activeField: SwitcherField | null =
    estState.status === 'active'
      ? {
          id: estState.current.id,
          name: estState.current.name,
          locality: localityOf(estState.current),
          role: estState.current.role,
        }
      : null;
  const activeId = activeField?.id ?? null;

  // ── Banner "establecimiento listo" per-campo + dismiss persistido (Run 2 c) ──
  // El banner se controlaba con un useState(true) local → NO era per-campo (se mantenía
  // visible al cambiar de campo y el descarte no era por-campo). Ahora: per-campo, dismiss
  // persistido per-usuario (establishment-store). Cargamos el set de descartados al montar
  // (por userId) y lo mantenemos en estado; el banner se muestra SOLO para el campo activo y
  // SOLO si su id no está descartado (shouldShowReadyBanner, null-safe). Al cambiar de campo,
  // el banner se re-evalúa contra el activo nuevo. Descartar en A no afecta a B (per-campo) y
  // volver a A no lo resucita (persistido).
  const [dismissedBanners, setDismissedBanners] = useState<string[]>([]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadDismissedBanners(userId).then((ids) => {
      if (active) setDismissedBanners(ids);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const bannerVisible = shouldShowReadyBanner(activeId, dismissedBanners);

  async function dismissBanner() {
    if (!userId || !activeId) return;
    // Persistimos el descarte per-campo y actualizamos el estado para ocultar de inmediato.
    const next = await addDismissedBanner(userId, activeId);
    setDismissedBanners(next);
  }

  // ── Switch de establecimiento (R6.8.1) ──────────────────────────────────────
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Alto del header medido en runtime (insets + fila) para anclar el dropdown JUSTO
  // debajo. onLayout → número derivado del layout, no un literal de spacing.
  const [headerBottom, setHeaderBottom] = useState(0);

  // ── Micro-feedback al cambiar de campo (Run 2 d) ─────────────────────────────
  // Pulso breve (~450ms) de fondo $greenLight en el chip del switch del header que confirma
  // el cambio (SIN skeleton / SIN pantalla de carga: el switch es local, no hay round-trip).
  // Dispara SOLO cuando activeId pasa de un campo REAL a OTRO campo real estando la home
  // MONTADA (caso dropdown del switch). NO dispara: (1) en el montaje inicial; (2) cuando el
  // activo "aparece" por primera vez (null → id, ej. una carrera de render donde el contexto
  // resuelve un tick tarde) — eso no es un cambio que el usuario haya pedido confirmar. Por
  // eso comparamos contra el activeId PREVIO real (ref), no contra un flag de montaje.
  // Caso "Mis campos" → home: onSelect hace switch + router.replace → la home MONTA fresca; en
  // montaje fresco el prev arranca null → no hay pulso, y está BIEN (el cambio de pantalla
  // completo ya es feedback suficiente). NO forzamos el pulso cross-screen (complejidad
  // innecesaria).
  const [switchHighlight, setSwitchHighlight] = useState(false);
  const prevActiveIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    const prev = prevActiveIdRef.current;
    prevActiveIdRef.current = activeId;
    // Solo pulso si había un activo real distinto del nuevo (cambio genuino de campo).
    if (!activeId || !prev || prev === activeId) return;
    setSwitchHighlight(true);
    const t = setTimeout(() => setSwitchHighlight(false), 450);
    return () => clearTimeout(t);
  }, [activeId]);

  // Los "últimos 2 visitados" distintos del activo (R6.8.1), derivados del rastro REAL de
  // visitados (R6.9). Al hacer switch, el saliente entra a recientes → reaparece como
  // visitado (bug (b) de Raf). Mapeamos los recents del contexto a SwitcherField, con
  // localidad + rol para el subtítulo de desambiguación (Run 2 e).
  const recentFields: SwitcherField[] = recents.map((e) => ({
    id: e.id,
    name: e.name,
    locality: localityOf(e),
    role: e.role,
  }));
  const visited = activeField ? pickVisited(recentFields, activeField.id) : [];

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

  // Guarda de transición: la home solo tiene sentido con un campo activo. El gating
  // (RootGate) garantiza estado 'active' antes de mostrar (tabs); si por una carrera de
  // render no hay campo activo todavía, no pintamos la home mock — devolvemos un lienzo
  // vacío con el fondo de marca (el gate reubica en el próximo tick).
  if (!activeField) {
    return <YStack flex={1} width="100%" backgroundColor="$bg" />;
  }

  return (
    // Raíz a ancho completo: flex:1 + width:100%. El padding horizontal es simétrico
    // ($4 a ambos lados) y vive en los contenedores internos, no acá, para que el
    // fondo $bg cubra todo el ancho (Fix 1 — overflow horizontal, incremento 2).
    // Defensa web (Fix overflow web): maxWidth:100% + overflow:hidden horizontal en la
    // raíz garantizan que NINGÚN hijo pueda exceder el viewport (último cinturón de
    // seguridad si algún flex item se resiste a encoger). El scroll vertical lo maneja
    // el ScrollView interno, así que clipear la raíz no lo rompe.
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Safe-area arriba: el header propio respeta el notch/status bar. onLayout mide
          el alto real (insets + fila) para anclar el dropdown del switch justo debajo. */}
      <YStack
        width="100%"
        paddingTop={insets.top}
        paddingHorizontal="$4"
        onLayout={(e) => setHeaderBottom(e.nativeEvent.layout.height)}
      >
        <HomeHeader
          activeName={activeField.name}
          isOpen={switcherOpen}
          highlight={switchHighlight}
          onSwitchPress={() => setSwitcherOpen((v) => !v)}
        />
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
        {/* Saludo. Nombre real del usuario (AuthContext); sin nombre, saludo neutro. */}
        <Text
          fontFamily="$body"
          fontSize="$9"
          fontWeight="700"
          color="$textPrimary"
          marginTop="$4"
        >
          {userFirstName ? `¡Hola ${userFirstName}! 👋` : '¡Hola! 👋'}
        </Text>

        {/* Banner descartable per-campo (Run 2 c): solo para el campo activo y solo si su id
            no fue descartado (persistido per-usuario). Al cerrar, se persiste el descarte. */}
        {bannerVisible ? (
          <ReadyBanner
            establishmentName={activeField.name}
            onDismiss={() => void dismissBanner()}
          />
        ) : null}

        {/* Wizard de 3 pasos. */}
        <YStack marginTop="$6" marginBottom="$8">
          <Stepper steps={steps} />
        </YStack>
      </ScrollView>

      {/* Dropdown del switch de establecimiento (R6.8.1). Se monta SOBRE todo (overlay
          absoluto con backdrop) al abrir; se ancla justo bajo el header (headerBottom).
          Vive al nivel de la raíz para que el backdrop cubra la pantalla completa. */}
      {switcherOpen ? (
        <EstablishmentSwitcherDropdown
          active={activeField}
          visited={visited}
          anchorTop={headerBottom}
          onClose={() => setSwitcherOpen(false)}
          onSelectActive={() => {
            // Tocar el campo activo no hace nada más que cerrar (R6.8.1).
          }}
          onSelectVisited={(field) => {
            // Fija el campo como activo (R6.3) + cambia el contexto multi-tenant (R6.8.1).
            // switchEstablishment promueve el saliente en el rastro de visitados (R6.9) y
            // dispara el re-render de la home con el campo nuevo (bug (a) de Raf). La home
            // sigue siendo la misma ruta; el contexto manda el nuevo activo.
            void switchEstablishment(field.id);
          }}
          onSeeAll={() => {
            // "Ver todos mis campos" → pantalla "Mis campos" (R6.6).
            router.push('/mis-campos');
          }}
          onCreate={() => {
            // "Crear nuevo campo +" → flujo de alta de establecimiento (R3.1) — bug (d) de Raf.
            router.push('/crear-campo');
          }}
        />
      ) : null}
    </YStack>
  );
}

/** Primer nombre del nombre completo guardado en el perfil (para el saludo). */
function firstNameOf(name: string | null): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}
