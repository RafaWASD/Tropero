// Select — combo reutilizable de RAFAQ (ADR-023 §0: el deliverable del frontend son los
// componentes). Patrón INLINE-ACCORDION: el trigger es un pill que, al tocarlo, despliega la
// lista de opciones JUSTO debajo (en el flujo del layout, no en un overlay/portal nativo). Esto
// garantiza que ande IGUAL en web (`pnpm web`, RN-web) y en native sin Modal/Portal específicos
// de plataforma — el mismo primitivo (Pressable + render condicional) en los dos.
//
// POR QUÉ un trigger PILL con afordancia fuerte (resuelve el defecto de UX del paso de mapeo del
// import): un trigger `$white` sobre `$bg` (#FFFFFF sobre #faf9f9) era casi el mismo color, sin
// señal de "esto se despliega". Acá el pill contrasta: ASIGNADO = verde claro ($greenLight) con
// texto $primary; SIN ASIGNAR = surface bone con borde $divider + texto muted. En ambos casos un
// chevron (down cerrado / up abierto) marca que es un combo (Nielsen #6: reconocer > recordar).
//
// CONTROLADO por el padre: `open` + `onToggle` los maneja el llamador para tener UN solo Select
// abierto a la vez (acordeón) sin estado global. `onChange(null)` = se eligió el placeholder
// (ej. "Ignorar"); `onChange(value)` = una opción concreta.
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens; el size/color de los íconos lucide
// (API no-Tamagui) se lee con getTokenValue.

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';

import { Card } from './Card';
import { buttonA11y } from '../utils/a11y';

/** Una opción del Select. `hint` = nota secundaria opcional al lado del label (ej. dónde está ya asignado). */
export type SelectOption = { value: string; label: string; hint?: string };

export type SelectProps = {
  /** El value de la opción elegida, o null = se muestra el placeholder. */
  value: string | null;
  /** Las opciones disponibles (lista FIJA, no depende del contenido). */
  options: SelectOption[];
  /** Texto del trigger cuando no hay selección (ej. "Ignorar"). */
  placeholder: string;
  /**
   * Texto de la PRIMERA opción de la lista (la que deselecciona → onChange(null)). Opcional: por
   * defecto usa `placeholder`. Útil cuando la opción quiere ser más explícita que el trigger (ej.
   * trigger "Ignorar" / opción "Ignorar (no importar)").
   */
  placeholderOptionLabel?: string;
  /** Si la lista está desplegada. CONTROLADO por el padre (uno abierto a la vez). */
  open: boolean;
  /** Alterna abierto/cerrado (lo decide el padre). */
  onToggle: () => void;
  /** Elige una opción. `null` = se eligió el placeholder (deseleccionar). */
  onChange: (value: string | null) => void;
  /** Estilo del trigger: 'assigned' (hay selección, resaltado) | 'muted' (sin selección). */
  tone?: 'assigned' | 'muted';
  /** Nombre accesible del control (ej. "Asignar campo a la columna Sexo"). */
  a11yLabel: string;
};

/** Label visible en el trigger: el de la opción elegida, o el placeholder. */
function triggerLabel(value: string | null, options: SelectOption[], placeholder: string): string {
  if (value === null) return placeholder;
  return options.find((o) => o.value === value)?.label ?? placeholder;
}

export function Select({
  value,
  options,
  placeholder,
  placeholderOptionLabel,
  open,
  onToggle,
  onChange,
  tone = value !== null ? 'assigned' : 'muted',
  a11yLabel,
}: SelectProps) {
  // Colores/size que cruzan a la API no-Tamagui de lucide (props `color`/`size`), leídos del token.
  const primary = getTokenValue('$primary', 'color');
  const muted = getTokenValue('$textMuted', 'color');
  const iconSize = getTokenValue('$navIcon', 'size'); // 24

  const assigned = tone === 'assigned';
  const label = triggerLabel(value, options, placeholder);
  const Chevron = open ? ChevronUp : ChevronDown;
  const chevronColor = assigned ? primary : muted;

  return (
    <YStack width="100%" gap="$2">
      {/* TRIGGER pill — afordancia de combo. Asignado = verde claro + $primary; muted = surface + borde. */}
      <Pressable onPress={onToggle} {...buttonA11y(Platform.OS, { label: a11yLabel, selected: open })}>
        <XStack
          width="100%"
          alignItems="center"
          gap="$2"
          minHeight="$chipMin"
          paddingHorizontal="$3"
          paddingVertical="$2"
          borderRadius="$pill"
          backgroundColor={assigned ? '$greenLight' : '$surface'}
          borderWidth={1}
          borderColor={assigned ? '$greenLight' : '$divider'}
          pressStyle={{ opacity: 0.85 }}
        >
          <Text
            flex={1}
            minWidth={0}
            numberOfLines={1}
            fontFamily="$body"
            fontSize="$4"
            fontWeight={assigned ? '600' : '400'}
            color={assigned ? '$primary' : '$textMuted'}
          >
            {label}
          </Text>
          <Chevron size={iconSize} color={chevronColor} strokeWidth={2} />
        </XStack>
      </Pressable>

      {/* LISTA desplegada (acordeón inline, debajo del trigger). Card con las opciones. */}
      {open ? (
        <Card width="100%" gap="$1" paddingVertical="$2">
          {/* Placeholder como primera opción "deseleccionar" (ej. "Ignorar (no importar)"). */}
          <Option
            label={placeholderOptionLabel ?? placeholder}
            selected={value === null}
            primary={primary}
            iconSize={iconSize}
            onPress={() => onChange(null)}
          />
          {options.map((opt) => (
            <Option
              key={opt.value}
              label={opt.label}
              hint={opt.hint}
              selected={opt.value === value}
              primary={primary}
              iconSize={iconSize}
              onPress={() => onChange(opt.value)}
            />
          ))}
        </Card>
      ) : null}
    </YStack>
  );
}

/** Una fila de opción de la lista. Target ≥ $chipMin; la elegida lleva un check $primary. */
function Option({
  label,
  hint,
  selected,
  primary,
  iconSize,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  primary: string;
  iconSize: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label, selected })}>
      <XStack
        alignItems="center"
        gap="$2"
        minHeight="$chipMin"
        paddingHorizontal="$2"
        pressStyle={{ opacity: 0.6 }}
      >
        <XStack flex={1} minWidth={0} alignItems="baseline" gap="$2">
          <Text
            flexShrink={1}
            numberOfLines={1}
            fontFamily="$body"
            fontSize="$4"
            fontWeight="500"
            color="$textPrimary"
          >
            {label}
          </Text>
          {hint != null && hint.trim().length > 0 ? (
            <Text
              flexShrink={0}
              numberOfLines={1}
              fontFamily="$body"
              fontSize="$3"
              fontWeight="400"
              color="$textFaint"
            >
              {hint}
            </Text>
          ) : null}
        </XStack>
        {selected ? <Check size={iconSize} color={primary} strokeWidth={2.5} /> : null}
      </XStack>
    </Pressable>
  );
}
