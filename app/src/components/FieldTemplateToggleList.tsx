// FieldTemplateToggleList — lista agrupada de toggles de la plantilla de datos del rodeo
// (spec 02 frontend, C1 / ADR-021). REUTILIZABLE: la usa el paso 3 del wizard "Crear rodeo"
// y la pantalla "Editar plantilla del rodeo".
//
// Anatomía (patrón settings agrupado):
//   - Header tranquilizador opcional arriba (el wizard lo pasa; editar plantilla puede omitir).
//   - Por categoría: un header de sección (uppercase, $textMuted) + sus filas.
//   - Cada fila: label (Inter 600) + descripción corta ($textMuted) a la izquierda + un toggle
//     a la derecha. Filas required se muestran tildadas y NO tappables (no se pueden destildar).
//
// El componente es CONTROLADO: recibe las `sections` (ya agrupadas/ordenadas por la lógica pura
// rodeo-template.ts) + un callback onToggle(fieldDefinitionId, enabled). NO conoce la fuente de
// datos ni persiste nada — eso lo hace la pantalla con los services. `readOnly` (no-owner, R2.3)
// muestra los toggles sin permitir cambios.
//
// Cero hardcode (ADR-023 §4): tokens-only; el toggle es un control propio tokenizado (no hay
// primitivo Switch en la base v4 del proyecto). a11y: cada fila expone role switch + estado.

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { MoreVertical } from 'lucide-react-native';

import { categoryLabel, isCustomField, type TemplateSection, type FieldDefinition } from '../utils/rodeo-template';
import { buttonA11y, switchA11y } from '../utils/a11y';

export type FieldTemplateToggleListProps = {
  /** Secciones agrupadas por categoría (de groupTogglesByCategory). */
  sections: TemplateSection[];
  /** Cambia el estado de un toggle. No se llama para filas required ni en readOnly. */
  onToggle: (fieldDefinitionId: string, enabled: boolean) => void;
  /** Texto tranquilizador arriba de la lista (el wizard lo usa; editar plantilla puede omitir). */
  header?: string;
  /** Modo solo-lectura (no-owner, R2.3): muestra los toggles sin permitir cambios. */
  readOnly?: boolean;
  /**
   * Menú de acciones (⋯) por fila para los datos CUSTOM (spec 03 M7, R13.29). Si se pasa, las filas CUSTOM
   * (`establishment_id` no-NULL) muestran un kebab ⋯ a la derecha (Editar/Eliminar viven en el caller); las
   * filas de FÁBRICA (NULL) NO lo muestran (catálogo global inmutable, R13.4). Owner-only: el caller solo lo
   * pasa cuando isOwner (hereda la puerta del bloque owner-only de la pantalla). Si se omite (wizard "Crear
   * rodeo"), NINGUNA fila muestra el ⋯. El ⋯ NO interfiere con el tap del toggle (zona aparte, target XL).
   */
  onCustomAction?: (field: FieldDefinition) => void;
};

// ─── Toggle tokenizado (pista + thumb) ───────────────────────────────────────────
//
// Control propio: pista pill ($pill) que cambia de $primary (on) a $divider (off); thumb blanco
// que se alinea a un extremo según el estado. Sin animación (suficiente para MVP; los anchos
// vienen de tokens de size para no hardcodear px). Deshabilitado/readOnly baja la opacidad.

function ToggleControl({
  on,
  disabled,
}: {
  on: boolean;
  disabled: boolean;
}) {
  return (
    <View
      width="$toggleTrack"
      height="$toggleThumb"
      borderRadius="$pill"
      backgroundColor={on ? '$primary' : '$divider'}
      justifyContent="center"
      paddingHorizontal="$1"
      opacity={disabled ? 0.5 : 1}
      flexShrink={0}
    >
      <View
        width="$toggleKnob"
        height="$toggleKnob"
        borderRadius="$pill"
        backgroundColor="$white"
        alignSelf={on ? 'flex-end' : 'flex-start'}
      />
    </View>
  );
}

function SectionHeader({ category }: { category: string }) {
  return (
    <Text
      fontFamily="$body"
      fontSize="$3"
      fontWeight="600"
      color="$textMuted"
      letterSpacing={1}
      marginTop="$5"
      marginBottom="$2"
    >
      {categoryLabel(category).toUpperCase()}
    </Text>
  );
}

function ToggleRow({
  label,
  description,
  enabled,
  required,
  readOnly,
  onPress,
  onMenu,
}: {
  label: string;
  description: string | null;
  enabled: boolean;
  required: boolean;
  readOnly: boolean;
  onPress: () => void;
  /** Si se pasa, esta fila (custom) muestra un ⋯ que abre el menú de acciones (M7, R13.29). */
  onMenu?: () => void;
}) {
  const interactive = !required && !readOnly;
  // a11y: role switch + estado + label, ramificado por plataforma (switchA11y). En web SOLO atributos
  // ARIA DOM-válidos; en native SOLO accessibility*. CRÍTICO: pasar `accessibilityLabel` crudo al
  // Pressable de RN-web lo filtra como atributo DOM desconocido → React tira el warning "does not
  // recognize the accessibilityLabel prop on a DOM element", que en DEV monta el error-overlay de Expo
  // que cubre la pantalla e INTERCEPTA los toques → el toggle no respondía al tap (BUG 2; invisible en
  // el export de prod, donde el overlay no existe — por eso la E2E no lo atrapaba). Ver utils/a11y.ts.
  const a11y = switchA11y(Platform.OS, { label, checked: enabled, disabled: !interactive });

  const content = (
    <XStack
      width="100%"
      alignItems="center"
      gap="$3"
      minHeight="$touchMin"
      paddingVertical="$2"
    >
      <YStack flex={1} minWidth={0} gap="$1">
        <XStack alignItems="center" gap="$2">
          <Text
            flexShrink={1}
            minWidth={0}
            fontFamily="$body"
            fontSize="$5"
            fontWeight="600"
            color="$textPrimary"
          >
            {label}
          </Text>
          {required ? (
            <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$textFaint">
              OBLIGATORIO
            </Text>
          ) : null}
        </XStack>
        {description ? (
          <Text
            fontFamily="$body"
            fontSize="$3"
            fontWeight="400"
            color="$textMuted"
            lineHeight="$4"
          >
            {description}
          </Text>
        ) : null}
      </YStack>
      <ToggleControl on={enabled} disabled={!interactive} />
    </XStack>
  );

  // El cuerpo de la fila (label + descripción + toggle) tappable para el toggle; el ⋯ (si hay) va APARTE a la
  // derecha (zona de tap propia, target XL) para no robar el toggle. El ⋯ se muestra solo en filas custom
  // owner (M7, R13.29) — affordance EXPLÍCITA (no swipe/long-press).
  const row = !interactive ? (
    // Required o readOnly: no tappable. Igual exponemos a11y (label + estado) para el lector.
    <View flex={1} minWidth={0} {...a11y}>
      {content}
    </View>
  ) : (
    <Pressable style={{ flex: 1, minWidth: 0 }} onPress={onPress} {...a11y}>
      {content}
    </Pressable>
  );

  if (!onMenu) return row;

  return (
    <XStack width="100%" alignItems="center" gap="$2">
      {row}
      <Pressable
        onPress={onMenu}
        hitSlop={8}
        {...buttonA11y(Platform.OS, { label: `Acciones de ${label}` })}
      >
        <View
          width="$touchMin"
          height="$touchMin"
          alignItems="center"
          justifyContent="center"
          borderRadius="$pill"
          pressStyle={{ backgroundColor: '$greenLight' }}
        >
          <MoreVertical size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} />
        </View>
      </Pressable>
    </XStack>
  );
}

export function FieldTemplateToggleList({
  sections,
  onToggle,
  header,
  readOnly = false,
  onCustomAction,
}: FieldTemplateToggleListProps) {
  return (
    <YStack width="100%">
      {header ? (
        <View
          width="100%"
          backgroundColor="$surface"
          borderRadius="$card"
          borderWidth={1}
          borderColor="$divider"
          paddingHorizontal="$4"
          paddingVertical="$3"
        >
          <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted" lineHeight="$5">
            {header}
          </Text>
        </View>
      ) : null}

      {sections.map((section) => (
        <YStack key={section.category} width="100%">
          <SectionHeader category={section.category} />
          {section.toggles.map((t, i) => {
            // ⋯ solo en filas CUSTOM (establishment_id no-NULL) y solo si el caller pasó onCustomAction
            // (owner-only, R13.29). Las de fábrica (NULL) o el wizard (sin callback) → sin ⋯.
            const showMenu = onCustomAction != null && isCustomField(t.field);
            return (
              <YStack key={t.field.id} width="100%">
                {i > 0 ? <View height={1} backgroundColor="$divider" /> : null}
                <ToggleRow
                  label={t.field.label}
                  description={t.field.description}
                  enabled={t.enabled}
                  required={t.required}
                  readOnly={readOnly}
                  onPress={() => onToggle(t.field.id, !t.enabled)}
                  onMenu={showMenu ? () => onCustomAction!(t.field) : undefined}
                />
              </YStack>
            );
          })}
        </YStack>
      ))}
    </YStack>
  );
}
