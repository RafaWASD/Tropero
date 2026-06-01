// EstablishmentSwitcherDropdown — dropdown inline del switch de establecimiento del
// header (spec 01 R6.8.1). Se despliega al tocar el switch "<campo activo> ▾" de la
// home; NO navega directo a "Mis campos" (eso es "Ver todos mis campos").
//
// Patrón (Jakob): popover/menú que BAJA desde el switch (anclado top-left bajo el
// header) con un BACKDROP sutil a pantalla completa que CIERRA al tocar afuera. Es el
// modelo mental del overflow-menu / account-switcher de iOS/Android/Mercado Pago — no
// se reinventa. Elegido sobre Tamagui Popover/Adapt: la home es una pantalla
// hand-crafted (ADR-023) con control total de layout, así que un overlay absoluto +
// Pressable de backdrop es el primitivo más predecible y sin deps extra que cierra al
// tocar afuera y se siente nativo. Cierre por ESC en web vía onKeyDown del backdrop.
//
// Anatomía (orden EXACTO de R6.8.1):
//   1. Campo ACTIVO actual — diferenciado (check $primary + "● activo"). Tap = cierra.
//   2. Últimos 2 campos VISITADOS distintos del activo (de last_establishment_opened,
//      R6.9). Tap = fija como activo + navega a su home. Con <3 campos, los que haya.
//   3. ── divider ($divider) ──
//   4. "Ver todos mis campos" → abre la pantalla "Mis campos" (R6.6).
//   5. "Crear nuevo campo +" → inicia el flujo de creación de establecimiento (R3.1).
//
// Manga-friendly 🟡 (el switch también se toca en campo): cada ítem es un target
// grande (alto ≥ $touchMin, 56px), buen gap, una decisión por toque, legible (Inter).
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens; lo que cruza a una API
// no-Tamagui (size de íconos lucide) se lee con getTokenValue.

import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack, type ColorTokens } from 'tamagui';
import { Building2, Check, LayoutGrid, Plus } from 'lucide-react-native';
import { shadows } from '../../tamagui.config';
import { roleLabel } from '../utils/establishment';
import type { UserRole } from '../types';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/** Un campo mostrado en el dropdown (activo o visitado). */
export type SwitcherField = {
  /** Id del establecimiento. En prod = establishment_id del contexto (NUNCA hardcodeado). */
  id: string;
  /** Nombre del campo (lo que se lee en la fila). */
  name: string;
  /**
   * Localidad de desambiguación (Run 2 e): city o, en su defecto, province. Opcional para no
   * romper llamadas previas; el llamador la deriva con `localityOf(e)`.
   */
  locality?: string;
  /** Rol del usuario en este campo (Run 2 e): alimenta el subtítulo "<localidad> · <rol>". */
  role?: UserRole;
};

/**
 * Subtítulo de desambiguación de un campo (Run 2 e): "<localidad> · <rol>". Con campos del
 * mismo nombre, el switch "se ve muy confuso" (Raf) → esta 2da línea los distingue. Si falta
 * la localidad o el rol, no deja "·" colgando: devuelve solo la parte disponible, o '' si
 * ambas faltan (el llamador no renderiza la línea). Pura/local — el dropdown la consume.
 */
export function switcherSubtitle(field: SwitcherField): string {
  const loc = field.locality?.trim() ?? '';
  const rol = field.role ? roleLabel(field.role) : '';
  if (loc && rol) return `${loc} · ${rol}`;
  return loc || rol;
}

export type EstablishmentSwitcherDropdownProps = {
  /** Campo activo actual (R6.8.1 punto 1). */
  active: SwitcherField;
  /**
   * Campos a mostrar como "últimos visitados" (R6.8.1 punto 2): hasta 2, ya filtrados
   * para excluir el activo y recortados a 2 por el llamador (ver `pickVisited`). Con
   * menos de 3 campos en total, vienen menos (los que haya).
   */
  visited: SwitcherField[];
  /** Tocar el activo no hace nada salvo cerrar (R6.8.1). */
  onSelectActive?: () => void;
  /** Tocar un visitado: fijarlo como activo (R6.3) + navegar a su home (R6.8.1). */
  onSelectVisited: (field: SwitcherField) => void;
  /** "Ver todos mis campos" → pantalla "Mis campos" (R6.6). */
  onSeeAll: () => void;
  /** "Crear nuevo campo +" → flujo de creación de establecimiento (R3.1). */
  onCreate: () => void;
  /** Cerrar el dropdown (tap en backdrop, ESC, o tras elegir el activo). */
  onClose: () => void;
  /**
   * Offset vertical (px) desde el tope de la pantalla al que se ancla la card del menú,
   * para que caiga JUSTO bajo el switch del header. Lo computa el llamador con la
   * safe-area (insets.top + alto del header). Es un número derivado del runtime, no un
   * literal de spacing en la pantalla → no es hardcode (ADR-023 §4).
   */
  anchorTop: number;
};

// ─── Lógica pura (testeable) ──────────────────────────────────────────────────

/**
 * Selecciona los "últimos 2 campos visitados" del dropdown (R6.8.1 punto 2): de la lista
 * de visitados más recientes (orden: más reciente primero, derivada de
 * last_establishment_opened, R6.9), excluye el campo activo y recorta a `max` (2 por
 * default). Con menos de 3 campos en total, devuelve los que haya (incluso 0). No muta la
 * entrada.
 *
 * @param recents campos por recencia (más reciente primero); puede incluir al activo.
 * @param activeId id del campo activo a excluir.
 * @param max tope de visitados a mostrar (default 2).
 */
export function pickVisited(
  recents: SwitcherField[],
  activeId: string,
  max = 2
): SwitcherField[] {
  return recents.filter((f) => f.id !== activeId).slice(0, max);
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

/**
 * Fila genérica del dropdown. Target grande (alto ≥ $touchMin) manga-friendly: ícono a
 * la izquierda + label (+ subtítulo opcional de desambiguación) + slot trailing opcional
 * (ej. "● activo"). `tone='active'` diferencia el campo activo (contenedor verde claro +
 * texto/ícono en $primary).
 *
 * `subtitle` (Run 2 e): 2da línea muted "<localidad> · <rol>" para distinguir campos
 * homónimos. Cuando viene, el bloque de texto pasa de 1 línea a label + subtítulo; el alto
 * sigue respetando minHeight=$touchMin (la fila crece si hace falta, nunca baja del target).
 */
function Row({
  icon,
  label,
  subtitle,
  labelColor = '$textPrimary',
  fontWeight = '500',
  tone = 'default',
  trailing,
  accessibilityLabel,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  subtitle?: string;
  labelColor?: ColorTokens;
  fontWeight?: '400' | '500' | '600' | '700';
  tone?: 'default' | 'active';
  trailing?: ReactNode;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const hasSubtitle = subtitle != null && subtitle.trim().length > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
    >
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        paddingHorizontal="$4"
        paddingVertical="$2"
        backgroundColor={tone === 'active' ? '$greenLight' : 'transparent'}
        pressStyle={{ backgroundColor: '$surface' }}
      >
        {/* Ícono guía (reconocer > recordar, Nielsen #6). Ancho fijo, no encoge. */}
        <View width="$icon" alignItems="center" flexShrink={0}>
          {icon}
        </View>
        {/* Bloque de texto LEFT-ALIGNED (Jakob: los menús son left-aligned). Toma el espacio
            restante para truncar a 1 línea sin empujar la fila. label (hero) + subtítulo
            (secundario muted) cuando viene. */}
        <YStack flex={1} minWidth={0}>
          <Text
            textAlign="left"
            numberOfLines={1}
            fontFamily="$body"
            fontSize="$5"
            fontWeight={fontWeight}
            color={labelColor}
          >
            {label}
          </Text>
          {/* Subtítulo de desambiguación: "<localidad> · <rol>" (Run 2 e). Secundario, muted,
              más chico; 1 línea con ellipsis. Solo si viene (no deja línea vacía). */}
          {hasSubtitle ? (
            <Text
              textAlign="left"
              numberOfLines={1}
              fontFamily="$body"
              fontSize="$3"
              fontWeight="400"
              color="$textMuted"
            >
              {subtitle}
            </Text>
          ) : null}
        </YStack>
        {/* Slot trailing (ej. "● activo"); no encoge. */}
        {trailing ? (
          <View flexShrink={0} alignItems="flex-end">
            {trailing}
          </View>
        ) : null}
      </XStack>
    </Pressable>
  );
}

/** Indicador "● activo" del campo activo (en $primary). Espeja el de EstablishmentCard. */
function ActivePill() {
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

// ─── Componente principal ─────────────────────────────────────────────────────

export function EstablishmentSwitcherDropdown({
  active,
  visited,
  onSelectActive,
  onSelectVisited,
  onSeeAll,
  onCreate,
  onClose,
  anchorTop,
}: EstablishmentSwitcherDropdownProps) {
  // Colores que cruzan a la API no-Tamagui de lucide (prop `color`), leídos del token.
  const primary = getTokenValue('$primary', 'color');
  const muted = getTokenValue('$textMuted', 'color');
  const iconSize = getTokenValue('$navIcon', 'size'); // 24 — ícono de fila

  // ESC cierra (web): el backdrop a pantalla completa recibe el foco/teclado.
  const backdropKey =
    Platform.OS === 'web'
      ? {
          // onKeyDown es válido en RN-web sobre un Pressable (se mapea al DOM).
          onKeyDown: (e: { key?: string }) => {
            if (e?.key === 'Escape') onClose();
          },
        }
      : {};

  return (
    // Overlay a pantalla completa por encima del contenido. position:absolute + inset 0
    // a los 4 lados vía StyleSheet.absoluteFill (RN — geometría, no escala de spacing del
    // DS, fuera del lint). El backdrop sutil cierra al tocar afuera; la card del menú se
    // ancla arriba-izq (bajo el header). zIndex alto para superar al ScrollView de la home.
    <View style={StyleSheet.absoluteFill} zIndex={1000}>
      {/* Backdrop: Pressable a pantalla completa (StyleSheet.absoluteFill), tinte sutil.
          Tap/ESC = cerrar. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cerrar menú de campos"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
        {...backdropKey}
      >
        <View flex={1} backgroundColor="$textPrimary" opacity={0.18} />
      </Pressable>

      {/* Card del menú anclada arriba-izquierda, JUSTO bajo el switch del header: `top`
          = anchorTop (insets.top + alto del header, computado por el llamador con la
          safe-area). Como la card está FUERA del Pressable de backdrop, un tap sobre
          ella no cierra el dropdown (el backdrop sólo cubre lo que la card no tapa). */}
      <YStack
        position="absolute"
        top={anchorTop}
        left="$4"
        width={getTokenValue('$dropdownWidth', 'size')}
        maxWidth="100%"
        backgroundColor="$white"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        overflow="hidden"
        paddingVertical="$2"
        {...shadows.card}
      >
        {/* 1. Campo ACTIVO — diferenciado (verde claro + check $primary + "● activo").
            Tap = cierra (no hace nada más). Subtítulo de desambiguación (Run 2 e). */}
        <Row
          tone="active"
          icon={<Check size={iconSize} color={primary} strokeWidth={2.5} />}
          label={active.name}
          subtitle={switcherSubtitle(active)}
          labelColor="$primary"
          fontWeight="600"
          trailing={<ActivePill />}
          accessibilityLabel={`${active.name}, campo activo`}
          onPress={() => {
            onSelectActive?.();
            onClose();
          }}
        />

        {/* 2. Últimos 2 campos VISITADOS distintos del activo (R6.9). Tap = fija activo
            + navega a su home. Con <3 campos totales, los que haya (puede ser 0).
            Subtítulo "<localidad> · <rol>" para distinguir homónimos (Run 2 e). */}
        {visited.map((field) => (
          <Row
            key={field.id}
            icon={<Building2 size={iconSize} color={muted} strokeWidth={2} />}
            label={field.name}
            subtitle={switcherSubtitle(field)}
            accessibilityLabel={`Cambiar a ${field.name}`}
            onPress={() => {
              onSelectVisited(field);
              onClose();
            }}
          />
        ))}

        {/* 3. Divider: separa los CAMPOS (arriba) de las ACCIONES (abajo). */}
        <View height={1} backgroundColor="$divider" marginVertical="$2" marginHorizontal="$4" />

        {/* 4. "Ver todos mis campos" → pantalla "Mis campos" (R6.6). */}
        <Row
          icon={<LayoutGrid size={iconSize} color={muted} strokeWidth={2} />}
          label="Ver todos mis campos"
          onPress={() => {
            onClose();
            onSeeAll();
          }}
        />

        {/* 5. "Crear nuevo campo +" → flujo de creación de establecimiento (R3.1). */}
        <Row
          icon={<Plus size={iconSize} color={primary} strokeWidth={2.5} />}
          label="Crear nuevo campo"
          labelColor="$primary"
          fontWeight="600"
          onPress={() => {
            onClose();
            onCreate();
          }}
        />
      </YStack>
    </View>
  );
}
