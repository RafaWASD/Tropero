// EstablishmentCard — card de un establecimiento en la pantalla "Mis campos"
// (spec 01 R6.6.2). Variante A: banner-strip arriba.
//
// Es 🟡 mixta (design-review): "Mis campos" se accede tanto desde la oficina como
// desde el campo, así que hay margen para densidad de info, pero la card sigue siendo
// TAPPABLE con un target grande (se cambia de campo en la manga). Anatomía top→bottom
// fijada por R6.6.2:
//   1. banner-strip slim (~72px): gradiente verde botella + inicial; o foto custom.
//   2. nombre (hero, $7 / 700).
//   3. indicador de campo activo (● activo) + badge de rol (chip neutro).
//   4. 2 contadores (animales · rodeos), miles con separador.
//   5. métrica hero ADAPTATIVA (preñez | cabezas+últ.maniobra | CTA campo vacío),
//      con slot de benchmark reservado pero VACÍO en MVP.
//   6. señal de atención opcional (⚠ ...) en $terracota.
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens; lo que cruza a una API
// no-Tamagui (colors del LinearGradient) se lee con getTokenValue.

import { Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { shadows } from '../../tamagui.config';
import { roleLabel } from '../utils/establishment';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type EstablishmentRole = 'owner' | 'field_operator' | 'veterinarian';

// Métrica hero adaptativa: el componente decide cuál renderizar por la forma de la
// prop (discriminated union), no por flags sueltos. R6.6.2.
export type EstablishmentHeroMetric =
  // Con tacto reciente → "Preñez 92% · may'26".
  | { kind: 'pregnancy'; percent: number; period: string }
  // Sin tacto pero con animales → "1.240 cabezas · últ. maniobra 12 may".
  | { kind: 'headcount'; count: number; lastManeuver: string }
  // Campo vacío (sin animales) → CTA "Configurá tu rodeo" (no un número vacío).
  | { kind: 'empty' };

export type EstablishmentCardProps = {
  /** Nombre del establecimiento (hero + da la inicial del banner). */
  name: string;
  /** Rol del usuario en este campo (badge). */
  role: EstablishmentRole;
  /**
   * Localidad de desambiguación (Run 2 e): city o, en su defecto, province. Línea muted bajo
   * el nombre para distinguir campos homónimos. El rol NO va acá (ya está en el RoleBadge — no
   * se duplica). Opcional: si falta (campos sin localidad), no se renderiza la línea.
   */
  locality?: string;
  /** ¿Es el establecimiento activo actual? → indicador "● activo". */
  isActive?: boolean;
  /** Cantidad de animales activos (1er contador). */
  animalCount: number;
  /** Cantidad de rodeos (2do contador). */
  rodeoCount: number;
  /** Métrica hero adaptativa (una sola, según estado). */
  heroMetric: EstablishmentHeroMetric;
  /** Señal de atención opcional (ej. "tacto pendiente"); se muestra con ⚠ en terracota. */
  attention?: string;
  /** Foto custom del campo (Supabase Storage). Si no viene → gradiente + inicial. */
  imageUrl?: string;
  /** Toda la card es tappable → fija el campo activo y navega a su home (R6.6). */
  onPress?: () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Etiqueta de rol en español (UI en español, CLAUDE.md). FUENTE ÚNICA: roleLabel de
// utils/establishment (compartida con el dropdown del switch, Run 2 e) → no diverge la
// etiqueta entre la card y el switch (Nielsen #4 consistencia). EstablishmentRole y UserRole
// son la misma unión de strings, así que roleLabel(role) es type-safe.

// Formato de miles con separador "." (es-AR): 1240 → "1.240".
function formatThousands(n: number): string {
  return n.toLocaleString('es-AR');
}

// Inicial del campo para el banner por default (mayúscula, primer carácter visible).
function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() : '?';
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

/** Banner-strip slim de arriba: foto custom si hay `imageUrl`, si no gradiente + inicial. */
function BannerStrip({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const bannerHeight = getTokenValue('$bannerStrip', 'size'); // 76

  // Gradiente verde botella VISIBLE: $primaryLight (claro, arriba-izq) → $primary
  // (oscuro, abajo-der). Mismo hue brand, degradé claro→oscuro (no un bloque plano). Se
  // leen los hex de los tokens con getTokenValue (LinearGradient.colors es API no-Tamagui).
  const gradientFrom = getTokenValue('$primaryLight', 'color');
  const gradientTo = getTokenValue('$primary', 'color');
  const initialColor = getTokenValue('$white', 'color');

  if (imageUrl) {
    // Foto custom: ocupa el strip completo (cover). El borde superior redondeado lo da
    // el clip de la card (overflow hidden). NOTA: el render real de la imagen
    // (caché offline, placeholder de carga) se afina cuando exista el storage; acá el
    // path queda funcional con la URL provista.
    return (
      <View height={bannerHeight} width="100%" backgroundColor="$divider">
        <View
          height={bannerHeight}
          width="100%"
          // RN <Image> equivalente vía View con backgroundImage en web; en native se
          // reemplaza por <Image source>. Para el preview web alcanza con el background.
          // design-lint-disable-next-line -- la URL del campo es dato dinámico, no un token
          style={{ backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[gradientFrom, gradientTo]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ height: bannerHeight, width: '100%' }}
    >
      <View flex={1} justifyContent="center" paddingHorizontal="$4">
        <Text fontFamily="$body" fontSize="$10" fontWeight="700" color={initialColor as any}>
          {initialOf(name)}
        </Text>
      </View>
    </LinearGradient>
  );
}

/** Chip neutro del rol (borde $divider sobre $surface, texto $textMuted). */
function RoleBadge({ role }: { role: EstablishmentRole }) {
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$3"
      paddingVertical="$1"
    >
      <Text fontFamily="$body" fontSize="$2" fontWeight="500" color="$textMuted">
        {roleLabel(role)}
      </Text>
    </View>
  );
}

/** Indicador "● activo" del campo activo actual (en $primary). */
function ActiveIndicator() {
  const dotSize = getTokenValue('$dot', 'size'); // 8
  return (
    <XStack alignItems="center" gap="$1">
      <View width={dotSize} height={dotSize} borderRadius="$pill" backgroundColor="$primary" />
      <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$primary">
        activo
      </Text>
    </XStack>
  );
}

/**
 * Línea de la métrica hero adaptativa. Reserva SIEMPRE el slot de benchmark a la
 * derecha (R6.6.2) pero NO renderiza comparación en MVP (no hay baseline de zona). El
 * slot vacío evita que el layout salte cuando post-beta se encienda el "· +5 vs zona ▲".
 *
 * JERARQUÍA (re-vet iter-4, Nielsen #8 — match between system & real world / jerarquía
 * visual): la métrica hero es el TITULAR de la card (el dato por el que el vet la toca,
 * pilar analytics), así que NO puede leerse con el mismo peso que los contadores de
 * arriba. El VALOR (el "92%", el "860 cabezas") POP-EA: $textPrimary, weight 700, un
 * toque más grande ($5/16). La etiqueta y el período ("Preñez", "· may'26", "· últ.
 * maniobra 12 may") quedan $textMuted, tamaño normal ($3) — son contexto, no el dato.
 */
function HeroMetric({ metric }: { metric: EstablishmentHeroMetric }) {
  // Campo vacío → CTA visual (no un número). Engancha con el wizard de la home (R6.6.2).
  // NO es un Pressable propio: toda la card ya es tappable (Pressable externo) y dispara
  // el mismo onPress; anidar un <button> dentro del <button> de la card es HTML inválido
  // en web (RN-web mapea accessibilityRole="button" → <button>). Es un chip-CTA visual.
  if (metric.kind === 'empty') {
    return (
      <XStack
        alignSelf="flex-start"
        alignItems="center"
        gap="$2"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$primary"
        borderRadius="$pill"
        paddingHorizontal="$3"
        paddingVertical="$2"
      >
        <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$primary">
          + Configurá tu rodeo
        </Text>
      </XStack>
    );
  }

  // Partes de la métrica: VALOR destacado (pop) + etiqueta/período apagados (contexto).
  // pregnancy → "Preñez" [92%] "· may'26"  |  headcount → [860 cabezas] "· últ. maniobra 12 may".
  const prefix = metric.kind === 'pregnancy' ? 'Preñez ' : '';
  const value =
    metric.kind === 'pregnancy'
      ? `${metric.percent}%`
      : `${formatThousands(metric.count)} cabezas`;
  const suffix =
    metric.kind === 'pregnancy'
      ? ` · ${metric.period}`
      : ` · últ. maniobra ${metric.lastManeuver}`;

  return (
    // La fila ocupa el ancho: métrica a la izquierda, slot de benchmark reservado (flex)
    // a la derecha. El slot está VACÍO en MVP (no se promete comparación sin datos).
    // alignItems="baseline" → la etiqueta/período se sientan sobre la línea base del
    // valor grande (no centrados respecto a su caja más alta), así el "%" salta limpio.
    <XStack width="100%" alignItems="baseline" flexShrink={1} minWidth={0}>
      <Text
        fontFamily="$body"
        fontSize="$3"
        fontWeight="500"
        color="$textMuted"
        numberOfLines={1}
        flexShrink={0}
      >
        {prefix}
        {/* VALOR de la métrica: el dato que POP-EA (titular de la card). */}
        <Text fontFamily="$body" fontSize="$5" fontWeight="700" color="$textPrimary">
          {value}
        </Text>
        {suffix}
      </Text>
      {/* Slot de benchmark — reservado, vacío en MVP (R6.6.2). Se enciende post-beta. */}
      <View flex={1} minWidth={0} />
    </XStack>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function EstablishmentCard({
  name,
  role,
  locality,
  isActive = false,
  animalCount,
  rodeoCount,
  heroMetric,
  attention,
  imageUrl,
  onPress,
}: EstablishmentCardProps) {
  const hasLocality = locality != null && locality.trim().length > 0;
  const a11yLabel = `${name}, ${roleLabel(role)}${isActive ? ', campo activo' : ''}`;

  return (
    // Card tappable. overflow hidden → el banner-strip respeta el radio $card de la card
    // por arriba. La sombra se aplica al wrapper externo (un View clipeado no proyecta
    // sombra), así el clip no se come la elevación.
    <View borderRadius="$card" {...shadows.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={a11yLabel} onPress={onPress}>
        <YStack
          width="100%"
          backgroundColor="$surface"
          borderRadius="$card"
          overflow="hidden"
        >
          {/* 1. Banner-strip. */}
          <BannerStrip name={name} imageUrl={imageUrl} />

          {/* Cuerpo de la card. */}
          <YStack padding="$4" gap="$2">
            {/* 2. Nombre (hero) + 3. indicador activo + badge de rol.
                alignItems="baseline" (re-vet iter-4): el chip de rol y el "● activo"
                se sientan sobre la MISMA línea base del nombre — se leen como PAR del
                nombre, no flotando arriba-derecha. El chip queda anclado prolijo al
                tope-derecha del bloque, alineado a la línea del nombre. */}
            <XStack width="100%" alignItems="baseline" gap="$2">
              <Text
                fontFamily="$body"
                fontSize="$7"
                fontWeight="700"
                color="$textPrimary"
                flexShrink={1}
                minWidth={0}
                numberOfLines={1}
              >
                {name}
              </Text>
              {isActive ? <ActiveIndicator /> : null}
              {/* El badge de rol queda pegado a la derecha, alineado al nombre. */}
              <View flex={1} minWidth={0} />
              <RoleBadge role={role} />
            </XStack>

            {/* 3b. Localidad de desambiguación (Run 2 e): línea muted bajo el nombre para
                distinguir campos homónimos. El rol NO va acá (ya está en el RoleBadge). Solo
                si viene (no deja línea vacía). */}
            {hasLocality ? (
              <Text
                fontFamily="$body"
                fontSize="$3"
                fontWeight="400"
                color="$textMuted"
                numberOfLines={1}
                alignSelf="flex-start"
                textAlign="left"
              >
                {locality}
              </Text>
            ) : null}

            {/* 4. 2 contadores: animales · rodeos. */}
            <Text
              fontFamily="$body"
              fontSize="$4"
              fontWeight="400"
              color="$textMuted"
              alignSelf="flex-start"
              textAlign="left"
            >
              {formatThousands(animalCount)} vacas · {formatThousands(rodeoCount)} rodeos
            </Text>

            {/* 5. Métrica hero adaptativa (+ slot benchmark reservado). */}
            <View marginTop="$1">
              <HeroMetric metric={heroMetric} />
            </View>

            {/* 6. Señal de atención opcional (terracota). */}
            {attention ? (
              <XStack alignItems="center" gap="$1" marginTop="$1">
                <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$terracota">
                  ⚠ {attention}
                </Text>
              </XStack>
            ) : null}
          </YStack>
        </YStack>
      </Pressable>
    </View>
  );
}
