// app/maniobra/_components/CustomPropertiesSection.tsx — PROPIEDADES CUSTOM en alta + ficha (spec 03 M5-C.3,
// R13.10/R13.12). Una `propiedad` custom enabled en el rodeo del animal aparece en el form de ALTA
// (crear-animal paso 4) y en la FICHA (ver + editar) → custom_attributes (current-value, R13.12).
//
// DOS componentes que comparten CustomFieldInput (render por ui_component):
//   - CustomPropertiesForm (ALTA): carga las propiedades enabled del rodeo elegido, maneja su estado LOCAL y
//     expone los valores capturados por un ref imperativo (collectValues). El submit de crear-animal los
//     persiste POST-create (mismo patrón soft-fail que condición/preñez: el animal ya existe; si una falla,
//     se avisa y se sigue). Cualquier rol captura (R13.13).
//   - CustomPropertiesFicha (FICHA): carga las propiedades enabled + sus current-values, edita una → guarda al
//     instante (setCustomAttribute, editable anytime R13.12). En modo archivado (no editable) solo muestra.
//
// Cero hardcode (ADR-023 §4): tokens. es-AR. Recorte de descendentes: lineHeight matching.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { Platform } from 'react-native';
import { getTokenValue, Spinner, Text, View, XStack, YStack } from 'tamagui';
import { Check, SlidersHorizontal } from 'lucide-react-native';

import { Card } from '@/components';
import { buttonA11y } from '@/utils/a11y';
import {
  fetchEnabledCustomProperties,
  type EnabledCustomProperty,
} from '@/services/custom-fields';
import {
  fetchCustomAttributes,
  setCustomAttribute,
  type CustomAttributeValue,
} from '@/services/custom-attributes';
import { describeCustomValue, type CustomCaptureValue } from '@/utils/custom-render';
import { CustomFieldInput } from './CustomFieldInput';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ALTA — form de propiedades custom (estado local + ref para que el submit las recolecte)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Un valor custom recolectado del form de alta (para persistir post-create). */
export type CollectedCustomValue = { fieldDefinitionId: string; label: string; value: CustomCaptureValue };

/** API imperativa del form de alta: el submit la llama para recolectar los valores cargados (no vacíos). */
export type CustomPropertiesFormHandle = {
  collectValues: () => CollectedCustomValue[];
};

export type CustomPropertiesFormProps = {
  /** Rodeo elegido en el alta (paso 1). Las propiedades custom enabled de ESE rodeo se ofrecen. */
  rodeoId: string | null;
};

/**
 * Form de propiedades custom del ALTA (crear-animal paso 4). Carga las propiedades enabled del rodeo y guarda
 * su valor en estado LOCAL; el submit recolecta los valores cargados (no-null) por el ref → los persiste
 * post-create. Si el rodeo no tiene propiedades custom, NO renderiza nada (cero ruido en el form normal).
 */
export const CustomPropertiesForm = forwardRef<CustomPropertiesFormHandle, CustomPropertiesFormProps>(
  function CustomPropertiesForm({ rodeoId }, ref) {
    const [props, setProps] = useState<EnabledCustomProperty[]>([]);
    const [values, setValues] = useState<Record<string, CustomCaptureValue | null>>({});

    useEffect(() => {
      if (!rodeoId) {
        setProps([]);
        return;
      }
      let active = true;
      void fetchEnabledCustomProperties(rodeoId).then((r) => {
        if (!active) return;
        setProps(r.ok ? r.value : []);
      });
      return () => {
        active = false;
      };
    }, [rodeoId]);

    useImperativeHandle(
      ref,
      () => ({
        collectValues: () =>
          props
            .map((p) => {
              const v = values[p.fieldDefinitionId];
              return v ? { fieldDefinitionId: p.fieldDefinitionId, label: p.label, value: v } : null;
            })
            .filter((x): x is CollectedCustomValue => x != null),
      }),
      [props, values],
    );

    if (props.length === 0) return null;

    return (
      <YStack gap="$4">
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          Datos personalizados
        </Text>
        {props.map((p) => (
          <CustomFieldInput
            key={p.fieldDefinitionId}
            label={p.label}
            uiComponent={p.uiComponent}
            options={p.options}
            value={values[p.fieldDefinitionId] ?? null}
            onChange={(v) => setValues((prev) => ({ ...prev, [p.fieldDefinitionId]: v }))}
          />
        ))}
      </YStack>
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// FICHA — propiedades custom (ver + editar in-place, persiste al instante)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export type CustomPropertiesFichaProps = {
  profileId: string;
  rodeoId: string;
  /** false en modo archivado (un animal de baja no se edita): solo muestra los valores. */
  editable: boolean;
};

/**
 * Sección "Datos personalizados" de la FICHA (R13.10/R13.12): muestra el current-value de cada propiedad
 * custom enabled del rodeo (custom_attributes) y deja EDITAR una in-place (setCustomAttribute, editable
 * anytime). La lista = unión de las propiedades enabled del rodeo (aunque sin valor aún) + las que ya tienen
 * valor (aunque se hayan deshabilitado luego — no perdemos el dato cargado). Si no hay ninguna, no renderiza.
 */
export function CustomPropertiesFicha({ profileId, rodeoId, editable }: CustomPropertiesFichaProps) {
  const [enabled, setEnabled] = useState<EnabledCustomProperty[]>([]);
  const [attrs, setAttrs] = useState<CustomAttributeValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomCaptureValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [e, a] = await Promise.all([
      fetchEnabledCustomProperties(rodeoId),
      fetchCustomAttributes(profileId),
    ]);
    setEnabled(e.ok ? e.value : []);
    setAttrs(a.ok ? a.value : []);
    setLoading(false);
  }, [profileId, rodeoId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Lista UNIFICADA: propiedades enabled del rodeo (aunque sin valor) + las con valor cargado (aunque ya no
  // enabled). Indexada por field_definition_id; el valor (si hay) viene de attrs. Conserva el orden de enabled,
  // luego las "huérfanas con valor" (deshabilitadas tras cargarse). Bajo Opción B (M7, R13.30 MVP), un dato
  // SOFT-DELETEADO ya no llega acá: su definición se prunea del device y `fetchCustomAttributes` (INNER JOIN a
  // field_definitions, filtra `deleted_at IS NULL`) ya no devuelve su valor → la propiedad desaparece prolija
  // de la ficha (la confirmación de borrado lo advierte, R13.31). No hay rama display-only de borrados en MVP.
  const byId = new Map<string, { id: string; label: string; ui: EnabledCustomProperty | CustomAttributeValue; value: CustomCaptureValue | null }>();
  for (const p of enabled) {
    byId.set(p.fieldDefinitionId, { id: p.fieldDefinitionId, label: p.label, ui: p, value: null });
  }
  for (const a of attrs) {
    const existing = byId.get(a.fieldDefinitionId);
    if (existing) {
      existing.value = a.value;
    } else {
      byId.set(a.fieldDefinitionId, { id: a.fieldDefinitionId, label: a.label, ui: a, value: a.value });
    }
  }
  const rows = Array.from(byId.values());

  const onStartEdit = (id: string, current: CustomCaptureValue | null) => {
    setEditingId(id);
    setDraft(current);
    setSaveError(null);
  };

  const onSave = async (id: string) => {
    if (saving) return;
    if (draft == null) {
      // Nada cargado → no persistimos un vacío (no hay "borrar atributo" en MVP); solo cerramos el editor.
      setEditingId(null);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const r = await setCustomAttribute({ animalProfileId: profileId, fieldDefinitionId: id, value: draft.value });
    setSaving(false);
    if (!r.ok) {
      setSaveError(r.error.message);
      return;
    }
    setEditingId(null);
    setDraft(null);
    await load();
  };

  if (loading) {
    return (
      <Card gap="$3">
        <SectionHeader />
        <XStack alignItems="center" gap="$2" paddingVertical="$2">
          <Spinner size="small" color="$primary" />
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" color="$textMuted" numberOfLines={1}>
            Cargando datos personalizados…
          </Text>
        </XStack>
      </Card>
    );
  }

  // Sin propiedades custom (ni enabled ni con valor) → no renderizamos la sección (cero ruido).
  if (rows.length === 0) return null;

  return (
    <Card gap="$3">
      <SectionHeader />
      <YStack gap="$3">
        {rows.map((row) => {
          const ui = row.ui;
          // Bajo Opción B (M7, R13.30 MVP), las filas que llegan acá son TODAS de datos vivos (las borradas se
          // pruneanan + el INNER JOIN las filtra → no llegan). El editable depende solo del modo de la ficha.
          const rowEditable = editable;
          const isEditing = editingId === row.id && rowEditable;
          return (
            <YStack key={row.id} gap="$2" testID={`ficha-custom-${row.id}`}>
              {isEditing ? (
                <YStack gap="$3">
                  <CustomFieldInput
                    label={row.label}
                    uiComponent={ui.uiComponent}
                    options={ui.options}
                    value={draft}
                    onChange={setDraft}
                  />
                  {saveError ? (
                    <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="600" color="$terracota" numberOfLines={2}>
                      {saveError}
                    </Text>
                  ) : null}
                  <XStack gap="$2">
                    <View
                      flex={1}
                      testID={`ficha-custom-save-${row.id}`}
                      backgroundColor={saving ? '$divider' : '$primary'}
                      borderRadius="$pill"
                      minHeight="$touchMin"
                      flexDirection="row"
                      alignItems="center"
                      justifyContent="center"
                      gap="$2"
                      opacity={saving ? 0.7 : 1}
                      pressStyle={saving ? undefined : { backgroundColor: '$primaryPress' }}
                      onPress={saving ? undefined : () => void onSave(row.id)}
                      {...buttonA11y(Platform.OS, { label: 'Guardar', disabled: saving })}
                    >
                      <Check size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
                      <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$white" numberOfLines={1}>
                        Guardar
                      </Text>
                    </View>
                    <View
                      testID={`ficha-custom-cancel-${row.id}`}
                      backgroundColor="$white"
                      borderWidth={1}
                      borderColor="$divider"
                      borderRadius="$pill"
                      minHeight="$touchMin"
                      alignItems="center"
                      justifyContent="center"
                      paddingHorizontal="$5"
                      pressStyle={{ backgroundColor: '$greenLight' }}
                      onPress={() => {
                        setEditingId(null);
                        setDraft(null);
                      }}
                      {...buttonA11y(Platform.OS, { label: 'Cancelar' })}
                    >
                      <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                        Cancelar
                      </Text>
                    </View>
                  </XStack>
                </YStack>
              ) : (
                <FichaRow
                  label={row.label}
                  value={describeCustomValue(row.value)}
                  editable={rowEditable}
                  onEdit={() => onStartEdit(row.id, row.value)}
                />
              )}
            </YStack>
          );
        })}
      </YStack>
    </Card>
  );
}

function SectionHeader() {
  const primary = getTokenValue('$primary', 'color');
  return (
    <XStack alignItems="center" gap="$2">
      <View width={28} height={28} borderRadius="$pill" backgroundColor="$greenLight" alignItems="center" justifyContent="center">
        <SlidersHorizontal size={16} color={primary} strokeWidth={2.5} />
      </View>
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
        Datos personalizados
      </Text>
    </XStack>
  );
}

/** Fila de lectura de una propiedad: label muted + valor; tocable para editar (si editable). */
function FichaRow({
  label,
  value,
  editable,
  onEdit,
}: {
  label: string;
  value: string;
  editable: boolean;
  onEdit: () => void;
}) {
  const content = (
    <YStack gap="$1" flex={1} minWidth={0}>
      <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={2}>
        {label}
      </Text>
      <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={2}>
        {value}
      </Text>
    </YStack>
  );
  if (!editable) return content;
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap="$2"
      minHeight="$touchMin"
      borderRadius="$card"
      pressStyle={{ backgroundColor: '$greenLight' }}
      onPress={onEdit}
      {...buttonA11y(Platform.OS, { label: `Editar ${label}` })}
    >
      {content}
      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary" numberOfLines={1}>
        Editar
      </Text>
    </View>
  );
}
