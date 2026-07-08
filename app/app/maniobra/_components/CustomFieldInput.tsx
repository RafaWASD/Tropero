// app/maniobra/_components/CustomFieldInput.tsx — INPUT GENÉRICO de un dato CUSTOM por ui_component, en estilo
// FORMULARIO (spec 03 M5-C.3, R13.10): lo usan el ALTA (crear-animal paso 4) y la FICHA (ver/editar) para una
// PROPIEDAD custom (custom_attributes). NO es el paso de manga gigante (eso es CustomManeuverStep): acá el
// lenguaje es el del form (label muted arriba + control compacto debajo, mismo idiom que FormField/FieldGroup
// de crear-animal). Es CONTROLADO: recibe `value` (CustomCaptureValue|null) y reporta `onChange(value|null)`.
//   - numeric / numeric_stepped → input numérico (FormField decimal-pad). El stepped agrega −/+ chicos.
//   - enum_single                → filas full-width de opción única (idiom OptionRows de crear-animal).
//   - enum_multi                 → chips multi-select.
//   - text                       → input de texto (FormField).
//   - boolean                    → 2 chips Sí / No.
//   - date                       → input con máscara es-AR (maskDateInput → AAAA-MM-DD, formato de máquina).
//
// Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. es-AR (coma decimal en numéricos). Recorte de
// descendentes: lineHeight matching en todo Text con numberOfLines.

import { useMemo } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, Minus, Plus } from 'lucide-react-native';

import { buttonA11y, labelA11y } from '@/utils/a11y';
import { maskDateInput } from '@/utils/animal-input';
import type { CustomUiComponent } from '@/utils/custom-field';
import type { CustomCaptureValue } from '@/utils/custom-render';

export type CustomFieldInputProps = {
  label: string;
  uiComponent: CustomUiComponent;
  options: readonly string[];
  value: CustomCaptureValue | null;
  /** Reporta el nuevo valor (o null = vacío/limpio). El caller decide cuándo persistir. */
  onChange: (value: CustomCaptureValue | null) => void;
  /** read-only (la ficha archivada lo deshabilita). Default editable. */
  editable?: boolean;
  /**
   * Transformador OPCIONAL/ADITIVO del tipeo EN VIVO de la rama `text` (delta IDU §5.2). El caller lo setea a
   * `sanitizeApodoInput` cuando `data_key==='apodo'` (formato de identificador: alfanum + ñ/tildes + espacio +
   * guion, cap 15). Sin `sanitize` la rama `text` no cambia de comportamiento (backward-compat). Solo aplica a
   * `ui_component==='text'` (los demás controles tienen su propio saneo).
   */
  sanitize?: (raw: string) => string;
};

export function CustomFieldInput({
  label,
  uiComponent,
  options,
  value,
  onChange,
  editable = true,
  sanitize,
}: CustomFieldInputProps) {
  return (
    <YStack gap="$2" opacity={editable ? 1 : 0.6}>
      <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={2}>
        {label}
      </Text>
      <FieldControl
        uiComponent={uiComponent}
        options={options}
        value={value}
        onChange={onChange}
        editable={editable}
        sanitize={sanitize}
      />
    </YStack>
  );
}

function FieldControl({
  uiComponent,
  options,
  value,
  onChange,
  editable,
  sanitize,
}: Omit<CustomFieldInputProps, 'label'> & { editable: boolean }) {
  switch (uiComponent) {
    case 'numeric':
      return <NumericField value={value} onChange={onChange} editable={editable} stepped={false} options={options} />;
    case 'numeric_stepped':
      return <NumericField value={value} onChange={onChange} editable={editable} stepped options={options} />;
    case 'enum_single':
      return <EnumSingleRows options={options} value={value} onChange={onChange} editable={editable} />;
    case 'enum_multi':
      return <EnumMultiChips options={options} value={value} onChange={onChange} editable={editable} />;
    case 'boolean':
      return <BooleanChips value={value} onChange={onChange} editable={editable} options={options} />;
    case 'date':
      return <DateField value={value} onChange={onChange} editable={editable} options={options} />;
    case 'text':
    default:
      return <TextField value={value} onChange={onChange} editable={editable} sanitize={sanitize} />;
  }
}

// ─── numeric / numeric_stepped ─────────────────────────────────────────────────────────────────────────

const DECIMAL_SEP = ',';

function numToText(v: CustomCaptureValue | null): string {
  if (!v || v.kind !== 'number' || !Number.isFinite(v.value)) return '';
  return Number.isInteger(v.value) ? String(v.value) : String(v.value).replace('.', DECIMAL_SEP);
}

function textToNum(raw: string): number | null {
  const t = raw.trim();
  if (t.length === 0) return null;
  const n = Number(t.replace(DECIMAL_SEP, '.'));
  return Number.isFinite(n) ? n : null;
}

function NumericField({
  value,
  onChange,
  editable,
  stepped,
}: Omit<CustomFieldInputProps, 'label' | 'uiComponent'> & { editable: boolean; stepped: boolean }) {
  const text = numToText(value);
  const current = value && value.kind === 'number' ? value.value : 0;
  const emit = (raw: string) => {
    const n = textToNum(raw);
    onChange(n == null ? null : { kind: 'number', value: n });
  };
  return (
    <XStack gap="$2" alignItems="center">
      <View flex={1}>
        <PlainInput
          value={text}
          onChangeText={(t) => emit(sanitizeNumeric(t))}
          keyboardType="decimal-pad"
          placeholder="0"
          editable={editable}
          testID="custom-prop-numeric"
        />
      </View>
      {stepped ? (
        <>
          <StepBtn dir="minus" disabled={!editable} onPress={() => onChange({ kind: 'number', value: current - 1 })} />
          <StepBtn dir="plus" disabled={!editable} onPress={() => onChange({ kind: 'number', value: current + 1 })} />
        </>
      ) : null}
    </XStack>
  );
}

/** Sanitiza el tipeo numérico es-AR: dígitos + un solo separador decimal (coma o punto) + signo opcional. */
function sanitizeNumeric(raw: string): string {
  let out = raw.replace(/[^0-9.,-]/g, '');
  // un solo separador decimal: normalizamos puntos a coma y dejamos solo el primero.
  out = out.replace(/\./g, DECIMAL_SEP);
  const firstSep = out.indexOf(DECIMAL_SEP);
  if (firstSep >= 0) {
    out = out.slice(0, firstSep + 1) + out.slice(firstSep + 1).replace(/,/g, '');
  }
  // signo solo al inicio.
  out = (out.startsWith('-') ? '-' : '') + out.replace(/-/g, '');
  return out;
}

function StepBtn({ dir, disabled, onPress }: { dir: 'minus' | 'plus'; disabled: boolean; onPress: () => void }) {
  const WHITE = getTokenValue('$white', 'color');
  return (
    <View
      testID={`custom-prop-step-${dir}`}
      width="$touchMin"
      height="$touchMin"
      backgroundColor={disabled ? '$divider' : '$primary'}
      borderRadius="$card"
      alignItems="center"
      justifyContent="center"
      opacity={disabled ? 0.5 : 1}
      pressStyle={disabled ? undefined : { backgroundColor: '$primaryPress' }}
      onPress={disabled ? undefined : onPress}
      {...buttonA11y(Platform.OS, { label: dir === 'minus' ? 'Bajar' : 'Subir', disabled })}
    >
      {dir === 'minus' ? (
        <Minus size={getTokenValue('$navIcon', 'size')} color={WHITE} strokeWidth={3} />
      ) : (
        <Plus size={getTokenValue('$navIcon', 'size')} color={WHITE} strokeWidth={3} />
      )}
    </View>
  );
}

// ─── text ─────────────────────────────────────────────────────────────────────────────────────────────

function TextField({
  value,
  onChange,
  editable,
  sanitize,
}: Omit<CustomFieldInputProps, 'label' | 'uiComponent' | 'options'> & { editable: boolean }) {
  const text = value && value.kind === 'string' ? value.value : '';
  // delta IDU §5.2: `sanitize` (ej. sanitizeApodoInput para data_key='apodo') filtra el tipeo EN VIVO. Sin
  // `sanitize` (la mayoría de los custom text libres) el valor entra tal cual (backward-compat).
  const emit = (raw: string) => {
    const t = sanitize ? sanitize(raw) : raw;
    onChange(t.length === 0 ? null : { kind: 'string', value: t });
  };
  return (
    <PlainInput
      value={text}
      onChangeText={emit}
      placeholder="Escribí el dato"
      autoCapitalize="sentences"
      editable={editable}
      testID="custom-prop-text"
    />
  );
}

// ─── date (AAAA-MM-DD, formato de máquina; no es-AR display) ───────────────────────────────────────────

function DateField({
  value,
  onChange,
  editable,
}: Omit<CustomFieldInputProps, 'label' | 'uiComponent' | 'options'> & { editable: boolean; options: readonly string[] }) {
  const text = value && value.kind === 'string' ? value.value : '';
  return (
    <PlainInput
      value={text}
      onChangeText={(t) => {
        const masked = maskDateInput(t);
        onChange(masked.length === 0 ? null : { kind: 'string', value: masked });
      }}
      placeholder="AAAA-MM-DD"
      keyboardType="number-pad"
      editable={editable}
      testID="custom-prop-date"
    />
  );
}

// ─── boolean → 2 chips Sí / No ─────────────────────────────────────────────────────────────────────────

function BooleanChips({
  value,
  onChange,
  editable,
}: Omit<CustomFieldInputProps, 'label' | 'uiComponent' | 'options'> & { editable: boolean; options: readonly string[] }) {
  const current = value && value.kind === 'boolean' ? value.value : null;
  return (
    <XStack gap="$2">
      {[
        { v: true, label: 'Sí' },
        { v: false, label: 'No' },
      ].map((o) => {
        const selected = current === o.v;
        return (
          <Pressable
            key={o.label}
            disabled={!editable}
            onPress={() => onChange({ kind: 'boolean', value: o.v })}
            testID={`custom-prop-bool-${o.label}`}
            {...buttonA11y(Platform.OS, { label: o.label, selected, disabled: !editable })}
          >
            <View
              minWidth="$chipMin"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              borderRadius="$pill"
              borderWidth={2}
              borderColor={selected ? '$primary' : '$divider'}
              backgroundColor={selected ? '$primary' : '$white'}
              paddingHorizontal="$4"
            >
              <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color={selected ? '$white' : '$textPrimary'} numberOfLines={1}>
                {o.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </XStack>
  );
}

// ─── enum_single → filas full-width de opción única (idiom OptionRows) ──────────────────────────────────

function EnumSingleRows({
  options,
  value,
  onChange,
  editable,
}: Omit<CustomFieldInputProps, 'label' | 'uiComponent'> & { editable: boolean }) {
  const current = value && value.kind === 'string' ? value.value : null;
  return (
    <YStack gap="$2">
      {options.map((opt) => {
        const selected = current === opt;
        return (
          <Pressable
            key={opt}
            disabled={!editable}
            onPress={() => onChange({ kind: 'string', value: opt })}
            testID={`custom-prop-enum-${opt}`}
            {...buttonA11y(Platform.OS, { label: opt, selected, disabled: !editable })}
          >
            <XStack
              minHeight="$touchMin"
              alignItems="center"
              borderRadius="$card"
              borderWidth={2}
              borderColor={selected ? '$primary' : '$divider'}
              backgroundColor={selected ? '$primary' : '$white'}
              paddingHorizontal="$4"
              gap="$3"
            >
              {selected ? <Check size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} /> : null}
              <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color={selected ? '$white' : '$textPrimary'} numberOfLines={1}>
                {opt}
              </Text>
            </XStack>
          </Pressable>
        );
      })}
    </YStack>
  );
}

// ─── enum_multi → chips multi-select ────────────────────────────────────────────────────────────────────

function EnumMultiChips({
  options,
  value,
  onChange,
  editable,
}: Omit<CustomFieldInputProps, 'label' | 'uiComponent'> & { editable: boolean }) {
  const selected = value && value.kind === 'multi' ? value.value : [];
  const selSet = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);
  const toggle = (opt: string) => {
    const next = selSet.has(opt.toLowerCase())
      ? selected.filter((s) => s.toLowerCase() !== opt.toLowerCase())
      : [...selected, opt];
    onChange(next.length === 0 ? { kind: 'multi', value: [] } : { kind: 'multi', value: next });
  };
  return (
    <XStack flexWrap="wrap" gap="$2">
      {options.map((opt) => {
        const isOn = selSet.has(opt.toLowerCase());
        return (
          <Pressable
            key={opt}
            disabled={!editable}
            onPress={() => toggle(opt)}
            testID={`custom-prop-multi-${opt}`}
            {...buttonA11y(Platform.OS, { label: opt, selected: isOn, disabled: !editable })}
          >
            <XStack
              minHeight="$chipMin"
              alignItems="center"
              gap="$2"
              borderRadius="$pill"
              borderWidth={2}
              borderColor={isOn ? '$primary' : '$divider'}
              backgroundColor={isOn ? '$primary' : '$white'}
              paddingHorizontal="$3"
            >
              {isOn ? <Check size={16} color={getTokenValue('$white', 'color')} strokeWidth={3} /> : null}
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color={isOn ? '$white' : '$textPrimary'} numberOfLines={1}>
                {opt}
              </Text>
            </XStack>
          </Pressable>
        );
      })}
    </XStack>
  );
}

// ─── input plano (TextInput tokenizado, idiom de FormField sin label) ──────────────────────────────────

function PlainInput({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = 'none',
  editable,
  testID,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'decimal-pad' | 'number-pad' | 'default';
  autoCapitalize?: 'none' | 'sentences';
  editable: boolean;
  testID: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={getTokenValue('$textMuted', 'color')}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      editable={editable}
      testID={testID}
      style={{
        minHeight: getTokenValue('$touchMin', 'size'),
        borderRadius: getTokenValue('$card', 'radius'),
        borderWidth: 1,
        borderColor: getTokenValue('$divider', 'color'),
        backgroundColor: getTokenValue('$white', 'color'),
        paddingHorizontal: getTokenValue('$4', 'space'),
        fontSize: getTokenValue('$inputText', 'size'),
        fontFamily: 'Inter',
        color: getTokenValue('$textPrimary', 'color'),
        opacity: editable ? 1 : 0.5,
      }}
      {...labelA11y(Platform.OS, placeholder ?? 'Dato personalizado')}
    />
  );
}
