// app/maniobra/_components/CustomFieldSheet.tsx — FORM de creación de un dato/maniobra CUSTOM
// (spec 03 M5-C.2, R13.5–R13.9). Bottom sheet enfocado (idiom ManeuverConfigSheet + guard tap-through).
//
// DOS MODOS de entrada (R13.5):
//   - 'classify' (desde el `+` de config de datos del rodeo): primero la PREGUNTA DE CLASIFICACIÓN (R13.6)
//     — propiedad (dato fijo, se carga una vez, tipo apodo) vs maniobra (se mide y se sigue, tipo ángulo de
//     pezuñas) — y DESPUÉS el form. No se infiere el data_type (R13.6).
//   - 'maniobra' (desde el `+` de la lista de maniobras del wizard): data_type='maniobra' fijo, SIN la
//     pregunta (por construcción, R13.7) → arranca directo en el form.
//
// FORM (R13.8): nombre (label, ≤80 UX) + picker de TIPO DE INPUT (los 7 ui_component, labels es-AR) +
// editor de OPCIONES (solo enum_single/enum_multi: agregar/quitar, ≤50 / ≤60 UX) → "Crear". Los caps
// client-side son UX; el server (0093) re-valida TODO. 1 dato = 1 campo (R13.9; no hay multi-campo en la UI).
//
// Modelado sobre BulkConfirmSheet/ManeuverConfigSheet: backdrop $scrim tappable que cierra (con guard
// anti tap-through doble-rAF, BUG web) + YStack anclado abajo con grip + safe-area inferior. Targets
// manga ≥$touchMin. Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. Voseo argentino.
//
// RECORTE DE DESCENDENTES (regla dura): títulos y Text con numberOfLines llevan lineHeight matching.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Plus, X, Check } from 'lucide-react-native';

import { Button, FormError, InfoNote } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import {
  UI_COMPONENT_OPTIONS,
  uiComponentNeedsOptions,
  validateCustomFieldDraft,
  LABEL_MAX,
  OPTIONS_MAX,
  OPTION_LABEL_MAX,
  type CustomUiComponent,
  type CustomDataType,
  type CustomFieldDraft,
} from '@/utils/custom-field';

export type CustomFieldSheetMode = 'classify' | 'maniobra';

export type CustomFieldSheetProps = {
  /** 'classify' = pregunta propiedad/maniobra primero; 'maniobra' = data_type fijo, sin pregunta (R13.7). */
  mode: CustomFieldSheetMode;
  /** Crea el dato custom con el draft. Devuelve null al OK, o un mensaje es-AR al fallo (no cierra el sheet). */
  onCreate: (draft: CustomFieldDraft) => Promise<string | null>;
  /** Cerrar sin crear. */
  onClose: () => void;
};

type Step = 'classify' | 'form';

export function CustomFieldSheet({ mode, onCreate, onClose }: CustomFieldSheetProps) {
  const insets = useSafeAreaInsets();

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web) ──
  // Idéntico a ManeuverConfigSheet: el scrim ignora presses hasta el 2do frame (doble rAF). Así el click
  // DOM nativo que dejó el tap del `+` no cierra el sheet recién montado, pero un tap deliberado sí.
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      readyToDismissRef.current = true;
    };
    if (typeof requestAnimationFrame === 'function') {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(arm);
      });
    } else {
      timer = setTimeout(arm, 0);
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const onBackdropPress = () => {
    if (!readyToDismissRef.current) return;
    onClose();
  };

  // mode 'maniobra' → data_type fijo + arranca en el form (sin pregunta, R13.7).
  // mode 'classify' → pregunta primero (R13.6); el data_type se setea al elegir.
  const [step, setStep] = useState<Step>(mode === 'maniobra' ? 'form' : 'classify');
  const [dataType, setDataType] = useState<CustomDataType>(mode === 'maniobra' ? 'maniobra' : 'propiedad');

  const [label, setLabel] = useState('');
  const [uiComponent, setUiComponent] = useState<CustomUiComponent>('numeric');
  const [options, setOptions] = useState<string[]>([]);
  const [optionDraft, setOptionDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitBusy = useRef(false);

  const needsOptions = uiComponentNeedsOptions(uiComponent);

  const draft: CustomFieldDraft = useMemo(
    () => ({ label, dataType, uiComponent, options: needsOptions ? options : undefined }),
    [label, dataType, uiComponent, options, needsOptions],
  );

  // Elegir la clasificación (R13.6) → fija data_type y pasa al form. NO se infiere.
  const pickClassification = (t: CustomDataType) => {
    setDataType(t);
    setError(null);
    setStep('form');
  };

  const optTrimmed = optionDraft.trim();
  const addOption = () => {
    const v = optTrimmed;
    if (v.length === 0) return;
    if (options.length >= OPTIONS_MAX) {
      setError(`No podés tener más de ${OPTIONS_MAX} opciones.`);
      return;
    }
    if (v.length > OPTION_LABEL_MAX) {
      setError(`Cada opción puede tener hasta ${OPTION_LABEL_MAX} caracteres.`);
      return;
    }
    if (options.some((o) => o.toLowerCase() === v.toLowerCase())) {
      setError('Esa opción ya está.');
      return;
    }
    setOptions((prev) => [...prev, v]);
    setOptionDraft('');
    setError(null);
  };

  const removeOption = (target: string) => {
    setOptions((prev) => prev.filter((o) => o !== target));
  };

  // Al cambiar de tipo de input, si deja de ser enum limpiamos las opciones (no ensuciar el payload).
  const pickType = (c: CustomUiComponent) => {
    setUiComponent(c);
    setError(null);
    if (!uiComponentNeedsOptions(c)) {
      setOptions([]);
      setOptionDraft('');
    }
  };

  const handleCreate = async () => {
    if (submitBusy.current) return;
    const valid = validateCustomFieldDraft(draft);
    if (!valid.ok) {
      setError(valid.message);
      return;
    }
    submitBusy.current = true;
    setSubmitting(true);
    setError(null);
    const message = await onCreate(draft);
    setSubmitting(false);
    submitBusy.current = false;
    if (message) {
      // Fallo (validación residual / DB local). NO cerramos: el usuario corrige sin perder lo tipeado.
      setError(message);
      return;
    }
    // OK (acción terminal): el caller cierra el sheet + navega/refresca.
  };

  const placeholderColor = getTokenValue('$textMuted', 'color');
  const textColor = getTokenValue('$textPrimary', 'color');
  const borderColor = getTokenValue('$divider', 'color');
  const surfaceColor = getTokenValue('$white', 'color');
  const inputFontSize = getTokenValue('$inputText', 'size');
  const inputMinHeight = getTokenValue('$searchBarLg', 'size');
  const radius = getTokenValue('$card', 'radius');
  const padH = getTokenValue('$4', 'space');
  const PRIMARY = getTokenValue('$primary', 'color');
  const FAINT = getTokenValue('$textFaint', 'color');
  const iconSize = getTokenValue('$navIcon', 'size');
  const bottomPad = Math.max(insets.bottom, getTokenValue('$4', 'space'));

  const title =
    step === 'classify'
      ? '¿Qué tipo de dato es?'
      : mode === 'maniobra'
        ? 'Nueva maniobra'
        : 'Nuevo dato';

  return (
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={onBackdropPress}
        testID="custom-field-scrim"
        {...buttonA11y(Platform.OS, { label: 'Cerrar' })}
      />

      <YStack
        width="100%"
        maxHeight="90%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="custom-field-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          {title}
        </Text>

        {step === 'classify' ? (
          // ── PASO 1: clasificación (R13.6). Dos bloques grandes; no se infiere el data_type. ──
          <YStack gap="$3">
            <Text fontFamily="$body" fontSize="$4" lineHeight="$5" color="$textMuted">
              ¿Es un dato fijo del animal (se carga una vez, tipo un apodo o un score) o algo que medís y
              seguís en el tiempo (tipo ángulo de pezuñas)?
            </Text>
            <ClassificationOption
              label="Un dato fijo"
              hint="Se carga una vez. Ej.: apodo, score de un solo registro."
              onPress={() => pickClassification('propiedad')}
              testID="classify-propiedad"
            />
            <ClassificationOption
              label="Algo que medís y seguís"
              hint="Se registra cada vez. Ej.: ángulo de pezuñas, una medición repetida."
              onPress={() => pickClassification('maniobra')}
              testID="classify-maniobra"
            />
            <Button variant="secondary" fullWidth onPress={onClose}>
              Cancelar
            </Button>
          </YStack>
        ) : (
          // ── PASO 2: form (label + tipo de input + opciones si enum) → Crear. ──
          <>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$4', 'space') }}>
              {/* NOMBRE (label) */}
              <YStack gap="$2">
                <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                  Nombre
                </Text>
                <TextInput
                  value={label}
                  onChangeText={(t) => {
                    setLabel(t.slice(0, LABEL_MAX));
                    if (error) setError(null);
                  }}
                  placeholder={mode === 'maniobra' ? 'Ej.: Ángulo de pezuñas' : 'Ej.: Apodo'}
                  placeholderTextColor={placeholderColor}
                  autoCapitalize="sentences"
                  maxLength={LABEL_MAX}
                  testID="custom-field-label"
                  style={{
                    minHeight: inputMinHeight,
                    borderRadius: radius,
                    borderWidth: 1,
                    borderColor,
                    backgroundColor: surfaceColor,
                    paddingHorizontal: padH,
                    fontSize: inputFontSize,
                    fontFamily: 'Inter',
                    color: textColor,
                  }}
                  {...labelA11y(Platform.OS, 'Nombre del dato')}
                />
              </YStack>

              {/* TIPO DE INPUT (los 7 ui_component, R13.8) */}
              <YStack gap="$2">
                <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                  Tipo de dato
                </Text>
                <YStack gap="$2">
                  {UI_COMPONENT_OPTIONS.map((opt) => {
                    const selected = opt.uiComponent === uiComponent;
                    return (
                      <Pressable
                        key={opt.uiComponent}
                        onPress={() => pickType(opt.uiComponent)}
                        testID={`type-${opt.uiComponent}`}
                        {...buttonA11y(Platform.OS, { label: opt.label, selected })}
                      >
                        <XStack
                          alignItems="center"
                          gap="$3"
                          minHeight="$touchMin"
                          paddingHorizontal="$3"
                          borderRadius="$card"
                          borderWidth={1}
                          backgroundColor={selected ? '$greenLight' : '$surface'}
                          borderColor={selected ? '$primary' : '$divider'}
                          pressStyle={{ opacity: 0.85 }}
                        >
                          <YStack flex={1} minWidth={0}>
                            <Text
                              fontFamily="$body"
                              fontSize="$4"
                              lineHeight="$4"
                              fontWeight={selected ? '700' : '500'}
                              color={selected ? '$primary' : '$textPrimary'}
                              numberOfLines={1}
                            >
                              {opt.label}
                            </Text>
                            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
                              {opt.hint}
                            </Text>
                          </YStack>
                          {selected ? <Check size={iconSize} color={PRIMARY} strokeWidth={2.5} /> : null}
                        </XStack>
                      </Pressable>
                    );
                  })}
                </YStack>
              </YStack>

              {/* EDITOR DE OPCIONES (solo enum_single / enum_multi, R13.8) */}
              {needsOptions ? (
                <YStack gap="$2">
                  <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                    {`Opciones (${options.length})`}
                  </Text>
                  <InfoNote>Agregá las opciones que se van a poder elegir. Ej.: adentro, afuera, normal.</InfoNote>

                  {/* Chips de opciones agregadas; la × quita. */}
                  {options.length > 0 ? (
                    <XStack flexWrap="wrap" gap="$2">
                      {options.map((it) => (
                        <XStack
                          key={it}
                          backgroundColor="$greenLight"
                          borderRadius="$pill"
                          paddingLeft="$3"
                          paddingRight="$2"
                          paddingVertical="$2"
                          alignItems="center"
                          gap="$2"
                          testID={`option-chip-${it}`}
                        >
                          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary" numberOfLines={1}>
                            {it}
                          </Text>
                          <Pressable
                            onPress={() => removeOption(it)}
                            hitSlop={8}
                            {...buttonA11y(Platform.OS, { label: `Quitar ${it}` })}
                          >
                            <X size={18} color={PRIMARY} strokeWidth={3} />
                          </Pressable>
                        </XStack>
                      ))}
                    </XStack>
                  ) : null}

                  {/* Input + "Agregar". */}
                  <XStack gap="$2" alignItems="center">
                    <View flex={1}>
                      <TextInput
                        value={optionDraft}
                        onChangeText={(t) => setOptionDraft(t.slice(0, OPTION_LABEL_MAX))}
                        placeholder="Nueva opción"
                        placeholderTextColor={placeholderColor}
                        autoCapitalize="sentences"
                        returnKeyType="done"
                        maxLength={OPTION_LABEL_MAX}
                        onSubmitEditing={addOption}
                        testID="custom-field-option-input"
                        style={{
                          minHeight: inputMinHeight,
                          borderRadius: radius,
                          borderWidth: 1,
                          borderColor,
                          backgroundColor: surfaceColor,
                          paddingHorizontal: padH,
                          fontSize: inputFontSize,
                          fontFamily: 'Inter',
                          color: textColor,
                        }}
                        {...labelA11y(Platform.OS, 'Nueva opción')}
                      />
                    </View>
                    <Pressable
                      onPress={addOption}
                      disabled={optTrimmed.length === 0}
                      testID="custom-field-add-option"
                      {...buttonA11y(Platform.OS, { label: 'Agregar opción', disabled: optTrimmed.length === 0 })}
                    >
                      <View
                        width={inputMinHeight}
                        height={inputMinHeight}
                        borderRadius="$card"
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor={optTrimmed.length === 0 ? '$surface' : '$primary'}
                        borderWidth={1}
                        borderColor={optTrimmed.length === 0 ? '$divider' : '$primary'}
                      >
                        <Plus size={24} color={optTrimmed.length === 0 ? FAINT : surfaceColor} strokeWidth={3} />
                      </View>
                    </Pressable>
                  </XStack>
                </YStack>
              ) : null}
            </ScrollView>

            {error ? <FormError message={error} /> : null}

            <YStack gap="$2">
              <Button variant="primary" fullWidth disabled={submitting} onPress={() => void handleCreate()}>
                {submitting ? 'Creando…' : 'Crear'}
              </Button>
              <Button variant="secondary" fullWidth disabled={submitting} onPress={onClose}>
                Cancelar
              </Button>
            </YStack>
          </>
        )}
      </YStack>
    </View>
  );
}

// Un bloque de clasificación (R13.6): título + hint, target grande, tappable.
function ClassificationOption({
  label,
  hint,
  onPress,
  testID,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable onPress={onPress} testID={testID} {...buttonA11y(Platform.OS, { label })}>
      <YStack
        gap="$1"
        paddingVertical="$3"
        paddingHorizontal="$4"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        backgroundColor="$surface"
        minHeight="$touchMin"
        justifyContent="center"
        pressStyle={{ backgroundColor: '$greenLight', borderColor: '$primary' }}
      >
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          {label}
        </Text>
        <Text fontFamily="$body" fontSize="$3" lineHeight="$4" color="$textMuted" numberOfLines={2}>
          {hint}
        </Text>
      </YStack>
    </Pressable>
  );
}
