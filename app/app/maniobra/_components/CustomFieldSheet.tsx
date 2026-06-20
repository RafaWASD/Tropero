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
// ── LAYOUT ROBUSTO (fix M5-CUSTOMFIELDSHEET-FIX, Raf lo cazó EN VIVO) ──────────────────────────────────
// El sheet es HEADER FIJO (grip + título, flexShrink:0) + CUERPO scrolleable (ScrollView flex:1, minHeight:0)
// + FOOTER FIJO (Crear/Cancelar, flexShrink:0). Antes el ScrollView NO tenía flex:1 y el error era un banner
// entre el scroll y los botones → al crecer el contenido o aparecer el error, el sheet superaba maxHeight:90%
// y el clip caía sobre el TOPE (el título se recortaba contra el borde). Con header/footer fijos + cuerpo que
// absorbe el alto y scrollea INTERNO, el título queda SIEMPRE completo por más que crezca el contenido.
//
// ── ERROR A NIVEL DE CAMPO (no banner al fondo) ───────────────────────────────────────────────────────
// Al tocar "Crear" inválido (`validateCustomFieldDraft` da el mensaje; `customFieldErrorTarget` da el campo):
// (a) scrolleamos el cuerpo hasta el campo culpable, (b) le ponemos BORDE terracota ($terracota, token), y
// (c) el mensaje va INLINE justo en ese campo. Se limpia al editar el campo. El usuario sabe EXACTAMENTE qué
// completar sin que un banner le tape el título.
//
// Modelado sobre BulkConfirmSheet/ManeuverConfigSheet: backdrop $scrim tappable que cierra (con guard
// anti tap-through doble-rAF, BUG web) + YStack anclado abajo con grip + safe-area inferior. Targets
// manga ≥$touchMin. Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. Voseo argentino.
//
// RECORTE DE DESCENDENTES (regla dura): títulos y Text con numberOfLines llevan lineHeight matching.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, type ScrollView as RNScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Plus, X, Check } from 'lucide-react-native';

import { Button, InfoNote } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import {
  UI_COMPONENT_OPTIONS,
  uiComponentNeedsOptions,
  validateCustomFieldDraft,
  customFieldErrorTarget,
  LABEL_MAX,
  OPTIONS_MAX,
  OPTION_LABEL_MAX,
  type CustomUiComponent,
  type CustomDataType,
  type CustomFieldDraft,
  type CustomFieldErrorTarget,
} from '@/utils/custom-field';

export type CustomFieldSheetMode = 'classify' | 'maniobra' | 'edit';

/** Datos iniciales para el modo EDIT (spec 03 M7, R13.32): el dato que se está editando. */
export type CustomFieldEditInitial = {
  label: string;
  /** El ui_component del dato (INMUTABLE, R13.26 — se muestra deshabilitado). */
  uiComponent: CustomUiComponent;
  /** Las opciones EXISTENTES del enum (append-only: NO se pueden quitar; sí agregar/renombrar, R13.33). */
  options: string[];
};

export type CustomFieldSheetProps = {
  /**
   * 'classify' = pregunta propiedad/maniobra primero (crear, R13.6); 'maniobra' = data_type fijo, sin
   * pregunta (crear, R13.7); 'edit' = EDITAR un dato existente (M7, R13.32): precarga label + opciones,
   * BLOQUEA el tipo de dato (inmutable, R13.26), append-only en opciones (R13.33) → "Guardar cambios".
   */
  mode: CustomFieldSheetMode;
  /** Crea el dato custom con el draft (modos classify/maniobra). Devuelve null al OK, o un mensaje es-AR al fallo. */
  onCreate?: (draft: CustomFieldDraft) => Promise<string | null>;
  /** Datos iniciales del dato a editar (modo 'edit'). */
  editInitial?: CustomFieldEditInitial;
  /** Guarda los cambios de label + opciones (modo 'edit'). Devuelve null al OK, o un mensaje es-AR al fallo. */
  onUpdate?: (label: string, options: string[]) => Promise<string | null>;
  /** Cerrar sin crear/guardar. */
  onClose: () => void;
};

type Step = 'classify' | 'form';

export function CustomFieldSheet({ mode, onCreate, editInitial, onUpdate, onClose }: CustomFieldSheetProps) {
  const insets = useSafeAreaInsets();
  // Modo edición (M7, R13.32): el tipo de dato es INMUTABLE; las opciones son append-only.
  const isEdit = mode === 'edit';
  // Las opciones EXISTENTES (modo edit) que NO se pueden quitar (append-only, R13.33). Las nuevas agregadas en
  // esta sesión SÍ se pueden quitar (todavía no persistidas). Se compara case-insensitive por valor.
  const lockedOptions = isEdit ? (editInitial?.options ?? []) : [];

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

  // mode 'maniobra'/'edit' → arranca en el form (sin pregunta de clasificación). mode 'classify' → pregunta
  // primero (R13.6); el data_type se setea al elegir. En 'edit' el data_type NO importa para el payload (no
  // se persiste; es inmutable) — lo fijamos a 'propiedad' como placeholder neutro.
  const [step, setStep] = useState<Step>(mode === 'classify' ? 'classify' : 'form');
  const [dataType, setDataType] = useState<CustomDataType>(mode === 'maniobra' ? 'maniobra' : 'propiedad');

  // En modo edición precargamos label + ui_component + opciones del dato existente (R13.32).
  const [label, setLabel] = useState(isEdit ? (editInitial?.label ?? '') : '');
  const [uiComponent, setUiComponent] = useState<CustomUiComponent>(
    isEdit ? (editInitial?.uiComponent ?? 'numeric') : 'numeric',
  );
  const [options, setOptions] = useState<string[]>(isEdit ? (editInitial?.options ?? []) : []);
  const [optionDraft, setOptionDraft] = useState('');
  // Error de validación: el MENSAJE (de validateCustomFieldDraft) + el CAMPO culpable (de customFieldErrorTarget).
  // El campo decide el resalte + el scroll + dónde va el mensaje inline. `null` = sin error.
  const [error, setError] = useState<{ message: string; target: CustomFieldErrorTarget | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitBusy = useRef(false);

  const needsOptions = uiComponentNeedsOptions(uiComponent);

  const draft: CustomFieldDraft = useMemo(
    () => ({ label, dataType, uiComponent, options: needsOptions ? options : undefined }),
    [label, dataType, uiComponent, options, needsOptions],
  );

  // ── Scroll-al-campo del error: DETERMINISTA por geometría MEDIDA (no por un defer de frame fijo). ──────────
  // El problema del defer fijo: el mensaje inline se agrega en el MISMO render que dispara el error → CRECE el
  // contenido DESPUÉS de que el scroll corrió. Un `scrollToEnd` diferido 1 frame quedaba corto a 360 (el texto
  // wrapea más → el contenido es más alto → el mensaje quedaba below-the-fold). En vez de adivinar el frame,
  // ENCADENAMOS el scroll a la MEDICIÓN REAL del campo culpable: capturamos por onLayout (relativo al
  // contentContainer) el rect {y, height} de cada sección; el onLayout de la sección culpable se vuelve a
  // disparar cuando el mensaje inline crece su alto → ahí consumimos el pedido de scroll pendiente y scrolleamos
  // a la posición CALCULADA que mete el campo + su borde + su mensaje COMPLETOS dentro del viewport. Robusto en
  // web y native, e independiente del ancho (360/412): se basa en alto medido, no en un defer arbitrario.
  const scrollRef = useRef<RNScrollView | null>(null);
  // Rect {y, height} (dentro del contentContainer) de cada sección culpable, capturado/actualizado por su onLayout.
  // Cuando el mensaje inline crece la sección, su onLayout re-dispara con el nuevo `height` → bottom actualizado.
  const fieldRectRef = useRef<{ label: { y: number; height: number }; options: { y: number; height: number } }>({
    label: { y: 0, height: 0 },
    options: { y: 0, height: 0 },
  });
  // Alto del viewport scrolleable (la propia ScrollView), capturado por su onLayout. Lo necesitamos para alinear
  // el FONDO de la sección culpable contra el fondo del viewport (traer input + borde + mensaje a la vista).
  const viewportHRef = useRef(0);
  // Pedido de scroll PENDIENTE: lo setea handleCreate al detectar el error; lo CONSUME el onLayout de la sección
  // culpable (que se re-dispara tras crecer con el mensaje), de modo que el scroll corre con la geometría YA
  // medida y completa — no en un frame adivinado.
  const pendingScrollRef = useRef<CustomFieldErrorTarget | null>(null);
  // Pedido de scroll AL FONDO pendiente (error general/residual del server, que renderiza al final del cuerpo):
  // lo CONSUME onContentSizeChange — que dispara JUSTO cuando el contenido crece con el mensaje. Misma robustez
  // que el scroll al campo: encadenado al crecimiento real del contenido, no a un frame adivinado.
  const pendingBottomScrollRef = useRef(false);

  // Scroll determinista a la sección `target` con su geometría YA medida (post-mensaje). Trae la sección COMPLETA
  // (input + borde + mensaje) a la vista: alinea su FONDO contra el fondo del viewport si no entra entera, o su
  // TOPE si entra. PURO respecto del timing — el caller decide CUÁNDO llamarlo (post-layout).
  const runScrollToField = useCallback((target: CustomFieldErrorTarget) => {
    const rect = fieldRectRef.current[target];
    const viewportH = viewportHRef.current;
    const pad = getTokenValue('$3', 'space');
    const sv = scrollRef.current;
    if (!sv) return;
    // Si no tenemos alto de viewport todavía (no debería), caemos a llevar el TOPE de la sección a la vista.
    if (viewportH <= 0) {
      sv.scrollTo({ y: Math.max(0, rect.y - pad), animated: true });
      return;
    }
    const sectionBottom = rect.y + rect.height;
    const fitsWhole = rect.height + pad <= viewportH;
    // fitsWhole → alineamos el TOPE de la sección (con holgura) para verla entera desde arriba.
    // !fitsWhole (sección más alta que el viewport, p.ej. muchas opciones) → alineamos el FONDO (input+mensaje
    // son lo último) contra el fondo del viewport, así el campo a completar + su mensaje quedan SIEMPRE visibles.
    const y = fitsWhole
      ? Math.max(0, rect.y - pad)
      : Math.max(0, sectionBottom + pad - viewportH);
    sv.scrollTo({ y, animated: true });
  }, []);

  // Encola un scroll al campo culpable: se ejecuta cuando el onLayout de esa sección reporte su geometría
  // DEFINITIVA (post-mensaje inline). Fallback de doble-rAF por si el onLayout no re-dispara (alto no cambió):
  // en ese caso la geometría ya estaba completa y scrolleamos igual. Determinista en ambos caminos.
  const scrollToField = useCallback(
    (target: CustomFieldErrorTarget) => {
      pendingScrollRef.current = target;
      const fallback = () => {
        // Si el onLayout ya consumió el pedido, no hacemos nada (evita doble scroll/jitter).
        if (pendingScrollRef.current !== target) return;
        pendingScrollRef.current = null;
        runScrollToField(target);
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(fallback));
      } else {
        setTimeout(fallback, 0);
      }
    },
    [runScrollToField],
  );

  // onLayout de una sección culpable: actualiza su rect medido y, si hay un scroll pendiente PARA ESTA sección,
  // lo consume ACÁ — con la geometría recién medida (que ya incluye el mensaje inline que creció el alto).
  const onFieldLayout = useCallback(
    (target: CustomFieldErrorTarget, y: number, height: number) => {
      fieldRectRef.current[target] = { y, height };
      if (pendingScrollRef.current === target) {
        pendingScrollRef.current = null;
        runScrollToField(target);
      }
    },
    [runScrollToField],
  );

  // Encola un scroll al FONDO del cuerpo (error general/residual del server). Se ejecuta cuando el contenido
  // realmente creció (onContentSizeChange), no en un frame adivinado.
  const scrollToBottom = useCallback(() => {
    pendingBottomScrollRef.current = true;
    const fallback = () => {
      if (!pendingBottomScrollRef.current) return;
      pendingBottomScrollRef.current = false;
      scrollRef.current?.scrollToEnd({ animated: true });
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(fallback));
    } else {
      setTimeout(fallback, 0);
    }
  }, []);

  // onContentSizeChange de la ScrollView: consume el scroll-al-fondo pendiente JUSTO cuando el contenido creció
  // con el mensaje general (determinista). Si no hay nada pendiente, no hace nada.
  const onContentSizeChange = useCallback(() => {
    if (pendingBottomScrollRef.current) {
      pendingBottomScrollRef.current = false;
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, []);

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
      setError({ message: `No podés tener más de ${OPTIONS_MAX} opciones.`, target: 'options' });
      return;
    }
    if (v.length > OPTION_LABEL_MAX) {
      setError({ message: `Cada opción puede tener hasta ${OPTION_LABEL_MAX} caracteres.`, target: 'options' });
      return;
    }
    if (options.some((o) => o.toLowerCase() === v.toLowerCase())) {
      setError({ message: 'Esa opción ya está.', target: 'options' });
      return;
    }
    setOptions((prev) => [...prev, v]);
    setOptionDraft('');
    setError(null);
  };

  // Una opción se puede QUITAR solo si NO es una opción EXISTENTE del dato (append-only, R13.33): las
  // existentes están bloqueadas (no se orfanan capturas que las referencian); las agregadas en esta sesión sí.
  const isLockedOption = (o: string) => lockedOptions.some((l) => l.toLowerCase() === o.toLowerCase());
  const removeOption = (target: string) => {
    if (isLockedOption(target)) return; // existente: no se quita (append-only).
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
      const target = customFieldErrorTarget(draft);
      setError({ message: valid.message, target });
      // Scrolleá al campo culpable para que el usuario lo vea (no lo dejamos buscándolo).
      if (target) scrollToField(target);
      return;
    }
    submitBusy.current = true;
    setSubmitting(true);
    setError(null);
    // Modo EDIT (M7, R13.32): solo label + opciones (el resto es inmutable). Modo crear: el draft completo.
    const message = isEdit
      ? await (onUpdate ?? (async () => 'No se pudo guardar.'))(draft.label.trim(), needsOptions ? options : [])
      : await (onCreate ?? (async () => 'No se pudo crear.'))(draft);
    setSubmitting(false);
    submitBusy.current = false;
    if (message) {
      // Fallo (validación residual / DB local). NO cerramos: el usuario corrige sin perder lo tipeado. El
      // server no nos dice cuál campo es → mostramos el mensaje a nivel de form (sin target → al FINAL del
      // cuerpo, nunca tapa el título) y scrolleamos al fondo para que el usuario lo vea (es lo último).
      // El scroll se encadena al crecimiento real del contenido (onContentSizeChange), no a un frame fijo.
      setError({ message, target: null });
      scrollToBottom();
      return;
    }
    // OK (acción terminal): el caller cierra el sheet + navega/refresca.
  };

  const placeholderColor = getTokenValue('$textMuted', 'color');
  const textColor = getTokenValue('$textPrimary', 'color');
  const borderColor = getTokenValue('$divider', 'color');
  const alertColor = getTokenValue('$terracota', 'color');
  const surfaceColor = getTokenValue('$white', 'color');
  const inputFontSize = getTokenValue('$inputText', 'size');
  const inputMinHeight = getTokenValue('$searchBarLg', 'size');
  const radius = getTokenValue('$card', 'radius');
  const padH = getTokenValue('$4', 'space');
  const PRIMARY = getTokenValue('$primary', 'color');
  const FAINT = getTokenValue('$textFaint', 'color');
  const iconSize = getTokenValue('$navIcon', 'size');
  const bottomPad = Math.max(insets.bottom, getTokenValue('$4', 'space'));

  const labelInvalid = error?.target === 'label';
  const optionsInvalid = error?.target === 'options';
  // El mensaje "general" (target null = error residual del server al crear): se muestra al final del cuerpo.
  const generalError = error && error.target === null ? error.message : null;

  const title =
    step === 'classify'
      ? '¿Qué tipo de dato es?'
      : isEdit
        ? 'Editar dato'
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
        {/* ── HEADER FIJO (grip + título). flexShrink:0 → NUNCA se comprime ni se recorta. ── */}
        <YStack flexShrink={0} gap="$4">
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
        </YStack>

        {step === 'classify' ? (
          // ── PASO 1: clasificación (R13.6). Dos bloques grandes; no se infiere el data_type. ──
          // Cuerpo scrolleable (flex:1) por si el contenido no entra en pantallas chicas; el header de arriba
          // ya es fijo, así el título no se recorta.
          <ScrollView flex={1} style={{ minHeight: 0 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$3', 'space') }}>
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
          </ScrollView>
        ) : (
          // ── PASO 2: form (label + tipo de input + opciones si enum) → Crear. ──
          <>
            {/* ── CUERPO scrolleable (flex:1 + minHeight:0 web) → absorbe el alto y scrollea INTERNO. ── */}
            <ScrollView
              ref={scrollRef}
              flex={1}
              style={{ minHeight: 0 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: getTokenValue('$4', 'space') }}
              // testID en el viewport scrolleable para el ORÁCULO de geometría del e2e: afirma que el bounding box
              // del input inválido cae DENTRO de este viewport visible (no solo "visible en algún lado").
              testID="custom-field-scroll"
              // Alto del viewport scrolleable: lo usa el scroll determinista para alinear el FONDO de la sección
              // culpable contra el fondo visible (traer input + borde + mensaje a la vista) a cualquier ancho.
              onLayout={(e) => {
                viewportHRef.current = e.nativeEvent.layout.height;
              }}
              // Consume el scroll-al-fondo pendiente (error general) cuando el contenido crece de verdad.
              onContentSizeChange={onContentSizeChange}
            >
              {/* NOMBRE (label) */}
              <YStack
                gap="$2"
                onLayout={(e) => {
                  onFieldLayout('label', e.nativeEvent.layout.y, e.nativeEvent.layout.height);
                }}
              >
                <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                  Nombre
                </Text>
                <TextInput
                  value={label}
                  onChangeText={(t) => {
                    setLabel(t.slice(0, LABEL_MAX));
                    // Limpiamos el error si era de este campo (o general) cuando el usuario lo edita.
                    if (labelInvalid || generalError) setError(null);
                  }}
                  placeholder={mode === 'maniobra' ? 'Ej.: Ángulo de pezuñas' : 'Ej.: Apodo'}
                  placeholderTextColor={placeholderColor}
                  autoCapitalize="sentences"
                  maxLength={LABEL_MAX}
                  testID="custom-field-label"
                  style={{
                    minHeight: inputMinHeight,
                    borderRadius: radius,
                    borderWidth: labelInvalid ? 2 : 1,
                    borderColor: labelInvalid ? alertColor : borderColor,
                    backgroundColor: surfaceColor,
                    paddingHorizontal: padH,
                    fontSize: inputFontSize,
                    fontFamily: 'Inter',
                    color: textColor,
                  }}
                  {...labelA11y(Platform.OS, 'Nombre del dato')}
                />
                {/* Error INLINE del campo Nombre. */}
                {labelInvalid ? <FieldError message={error!.message} testID="custom-field-label-error" /> : null}
              </YStack>

              {/* TIPO DE INPUT (los 7 ui_component, R13.8). En modo EDIT (M7, R13.26) el tipo es INMUTABLE → se
                  muestra SOLO el tipo actual, deshabilitado, con una nota: re-tipar = borrar + recrear. */}
              {isEdit ? (
                <YStack gap="$2">
                  <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                    Tipo de dato
                  </Text>
                  <XStack
                    alignItems="center"
                    gap="$3"
                    minHeight="$touchMin"
                    paddingHorizontal="$3"
                    borderRadius="$card"
                    borderWidth={1}
                    backgroundColor="$surface"
                    borderColor="$divider"
                    opacity={0.7}
                    testID="custom-field-type-locked"
                  >
                    <YStack flex={1} minWidth={0}>
                      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                        {UI_COMPONENT_OPTIONS.find((o) => o.uiComponent === uiComponent)?.label ?? uiComponent}
                      </Text>
                    </YStack>
                  </XStack>
                  <Text fontFamily="$body" fontSize="$3" lineHeight="$4" color="$textMuted" numberOfLines={2}>
                    El tipo no se puede cambiar. Si te equivocaste de tipo, eliminá el dato y creá uno nuevo.
                  </Text>
                </YStack>
              ) : (
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
              )}

              {/* EDITOR DE OPCIONES (solo enum_single / enum_multi, R13.8) */}
              {needsOptions ? (
                <YStack
                  gap="$2"
                  // Medimos toda la sección de Opciones (título + nota + editor + mensaje inline). Su onLayout
                  // se RE-dispara cuando el mensaje inline crece el alto → ahí consumimos el scroll pendiente con
                  // la geometría DEFINITIVA (input + borde terracota + mensaje completos a la vista, a 360 y 412).
                  onLayout={(e) => {
                    onFieldLayout('options', e.nativeEvent.layout.y, e.nativeEvent.layout.height);
                  }}
                >
                  <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                    {`Opciones (${options.length})`}
                  </Text>
                  <InfoNote>Agregá las opciones que se van a poder elegir. Ej.: adentro, afuera, normal.</InfoNote>

                  {/* Editor de opciones: si está inválido, lo envolvemos en un marco terracota para que el operario
                      vea EXACTAMENTE qué completar (borde de alerta a nivel de editor, no a nivel de un input suelto). */}
                  <YStack
                    gap="$2"
                    borderRadius="$card"
                    borderWidth={optionsInvalid ? 2 : 0}
                    borderColor={optionsInvalid ? '$terracota' : 'transparent'}
                    padding={optionsInvalid ? '$2' : '$0'}
                    testID="custom-field-options-editor"
                  >
                    {/* Chips de opciones; la × quita. Una opción EXISTENTE (modo edit) NO tiene × (append-only,
                        R13.33): se muestra fija (no se puede quitar para no orfanar capturas). Las agregadas en
                        esta sesión sí se pueden quitar. */}
                    {options.length > 0 ? (
                      <XStack flexWrap="wrap" gap="$2">
                        {options.map((it) => {
                          const locked = isLockedOption(it);
                          return (
                            <XStack
                              key={it}
                              backgroundColor="$greenLight"
                              borderRadius="$pill"
                              paddingLeft="$3"
                              paddingRight={locked ? '$3' : '$2'}
                              paddingVertical="$2"
                              alignItems="center"
                              gap="$2"
                              testID={`option-chip-${it}`}
                            >
                              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary" numberOfLines={1}>
                                {it}
                              </Text>
                              {locked ? null : (
                                <Pressable
                                  onPress={() => removeOption(it)}
                                  hitSlop={8}
                                  {...buttonA11y(Platform.OS, { label: `Quitar ${it}` })}
                                >
                                  <X size={18} color={PRIMARY} strokeWidth={3} />
                                </Pressable>
                              )}
                            </XStack>
                          );
                        })}
                      </XStack>
                    ) : null}

                    {/* Input + "Agregar". */}
                    <XStack gap="$2" alignItems="center">
                      <View flex={1}>
                        <TextInput
                          value={optionDraft}
                          onChangeText={(t) => {
                            setOptionDraft(t.slice(0, OPTION_LABEL_MAX));
                            // Editar opciones limpia el error de opciones (o el general).
                            if (optionsInvalid || generalError) setError(null);
                          }}
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

                    {/* Error INLINE del editor de Opciones. */}
                    {optionsInvalid ? <FieldError message={error!.message} testID="custom-field-options-error" /> : null}
                  </YStack>
                </YStack>
              ) : null}

              {/* Error GENERAL (residual del server al crear; no mapea a un campo) — al final del cuerpo,
                  NUNCA tapa el título. */}
              {generalError ? <FieldError message={generalError} testID="custom-field-general-error" /> : null}
            </ScrollView>

            {/* ── FOOTER FIJO (Crear/Guardar cambios + Cancelar). flexShrink:0 → siempre abajo, nunca fuera. ── */}
            <YStack flexShrink={0} gap="$2">
              <Button variant="primary" fullWidth disabled={submitting} onPress={() => void handleCreate()}>
                {submitting ? (isEdit ? 'Guardando…' : 'Creando…') : isEdit ? 'Guardar cambios' : 'Crear'}
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

// Error INLINE de un campo: texto terracota (token), lineHeight matching (recorte de descendentes), role=alert.
function FieldError({ message, testID }: { message: string; testID: string }) {
  const a11y =
    Platform.OS === 'web'
      ? { role: 'alert' as const }
      : { accessibilityLiveRegion: 'polite' as const };
  return (
    <Text
      fontFamily="$body"
      fontSize="$3"
      lineHeight="$4"
      fontWeight="600"
      color="$terracota"
      numberOfLines={2}
      testID={testID}
      {...a11y}
    >
      {message}
    </Text>
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
