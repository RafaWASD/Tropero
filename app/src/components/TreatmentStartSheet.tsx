// TreatmentStartSheet — bottom-sheet "Iniciar tratamiento" (delta spec 02 tratamientos, RTR.1).
//
// Sheet de creación del HEADER: selector de tipo (kind, CERRADO 3 opciones RTR.1.3) + producto (requerido,
// validado con el sanitizer/validador de treatment-input, RTR.1.4/1.9) + comentario (opcional, RTR.1.5/1.10) +
// una PRIMERA aplicación OPCIONAL (RTR.1.6: fecha default hoy + dosis/vía/próxima dosis). Al confirmar llama
// `onSubmit` (la ficha ejecuta startTreatment + refresh silencioso); en ok cierra, en error lo muestra inline.
//
// Anatomía de sheet (memoria UX): scrim + header FIJO (título no se recorta) / body SCROLL / footer FIJO.
// Validación INLINE (borde rojo + error bajo el campo, scroll-al-campo por orden). es-AR (voseo, coma decimal,
// fecha AAAA-MM-DD via maskDateInput). Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide.

import { useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check } from 'lucide-react-native';

import { useDismissKeyboardOnOpen } from '../hooks/useDismissKeyboardOnOpen';
import { useKeyboardAwareBottomInset } from '../hooks/useSafeBottomInset';
import { KeyboardAvoidingShell } from './KeyboardAvoidingShell';
import { Button } from './Button';
import { FormField } from './FormField';
import { Select } from './Select';
import { buttonA11y } from '../utils/a11y';
import { maskDateInput } from '../utils/animal-input';
import { validateEventDate } from '../utils/event-input';
import { todayIsoLocal } from '../utils/today-iso';
import {
  TREATMENT_KIND_OPTIONS,
  TREATMENT_ROUTE_OPTIONS,
  TREATMENT_PRODUCT_MAX_LENGTH,
  TREATMENT_NOTES_MAX_LENGTH,
  sanitizeTreatmentProductInput,
  sanitizeTreatmentNotesInput,
  validateTreatmentProduct,
  validateTreatmentNotes,
  validateDose,
  validateNextDose,
  type TreatmentKind,
} from '../utils/treatment-input';

// Estilo del `KeyboardAvoidingShell` (API no-Tamagui) — el MISMO que usa `BottomSheetShell` para este
// esqueleto. `flex`/`width` no son spacing/color → no aplica el lint anti-hardcode (ADR-023 §4).
const avoidStyle = { flex: 1, width: '100%', justifyContent: 'flex-end' } as const;

/** Lo que el sheet devuelve al confirmar (ya validado). firstApplication null = solo el header. */
export type TreatmentStartSubmit = {
  kind: TreatmentKind;
  productName: string;
  notes: string | null;
  firstApplication: {
    eventDate: string;
    doseMl: number | null;
    route: string | null;
    nextDoseDate: string | null;
  } | null;
};

export type TreatmentStartSheetProps = {
  onClose: () => void;
  onSubmit: (submit: TreatmentStartSubmit) => Promise<{ ok: boolean; error?: string }>;
};

export function TreatmentStartSheet({ onClose, onSubmit }: TreatmentStartSheetProps) {
  // ABRIR EL SHEET BAJA EL TECLADO (bug 🔴 device Android): se abre desde la ficha del animal, que tiene
  // campos de texto. Además del lift, tapa el LÍMITE del montaje del `KeyboardAvoidingShell` de abajo
  // (monta con el teclado ya abierto → arranca en altura 0 hasta el próximo evento de insets).
  useDismissKeyboardOnOpen();

  // Reserva inferior de la hoja. KEYBOARD-AWARE: con el teclado arriba el `KeyboardAvoidingShell` ya subió
  // la hoja el alto entero del teclado → la reserva se encoge al respiro de `$2`.
  // ⚠️ `floor: $6` = el valor FIJO que este sheet tenía escrito (`paddingBottom="$6"` = **32** en la escala
  // `space`). El sheet nunca pasó por el hook compartido —la unidad «aire» no lo tocó porque no tenía la
  // fórmula copiada, tenía un token suelto— así que en Android su CTA quedaba a 32dp del borde de PANTALLA,
  // o sea DEBAJO de una barra de navegación de 48. Al pasarlo por el hook con ese piso: **web 32
  // (idéntico) · iOS 32 → 34 · Android gestos 32 → 48 · Android 3 botones 32 → 64**. Los cuatro números
  // están fijados por test en `utils/footer-action.test.ts`. Es la corrección de la unidad «aire» que a
  // este archivo le faltaba.
  const bottomPad = useKeyboardAwareBottomInset({ floor: getTokenValue('$6', 'space') });
  const [kind, setKind] = useState<TreatmentKind | null>(null);
  const [productName, setProductName] = useState('');
  const [notes, setNotes] = useState('');
  const [includeFirstApp, setIncludeFirstApp] = useState(false);
  const [appDate, setAppDate] = useState(todayIsoLocal());
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState<string | null>(null);
  const [nextDose, setNextDose] = useState('');

  const [openSelect, setOpenSelect] = useState<'kind' | 'route' | null>(null);

  const [kindErr, setKindErr] = useState<string | null>(null);
  const [productErr, setProductErr] = useState<string | null>(null);
  const [notesErr, setNotesErr] = useState<string | null>(null);
  const [appDateErr, setAppDateErr] = useState<string | null>(null);
  const [doseErr, setDoseErr] = useState<string | null>(null);
  const [nextDoseErr, setNextDoseErr] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onConfirm = async () => {
    // Reset de errores.
    setKindErr(null);
    setProductErr(null);
    setNotesErr(null);
    setAppDateErr(null);
    setDoseErr(null);
    setNextDoseErr(null);
    setFormError(null);

    let hasError = false;
    if (kind == null) {
      setKindErr('Elegí el tipo de tratamiento.');
      hasError = true;
    }
    const prod = validateTreatmentProduct(productName);
    if (!prod.ok) {
      setProductErr(prod.error);
      hasError = true;
    }
    const notesV = validateTreatmentNotes(notes);
    if (!notesV.ok) {
      setNotesErr(notesV.error);
      hasError = true;
    }

    let firstApplication: TreatmentStartSubmit['firstApplication'] = null;
    if (includeFirstApp) {
      const d = validateEventDate(appDate);
      if (!d.ok) {
        setAppDateErr(d.error);
        hasError = true;
      }
      const doseV = validateDose(dose);
      if (!doseV.ok) {
        setDoseErr(doseV.error);
        hasError = true;
      }
      const nd = validateNextDose(nextDose);
      if (!nd.ok) {
        setNextDoseErr(nd.error);
        hasError = true;
      }
      if (d.ok && doseV.ok && nd.ok) {
        firstApplication = {
          eventDate: d.value,
          doseMl: doseV.value,
          route,
          nextDoseDate: nd.value,
        };
      }
    }

    if (hasError || kind == null || !prod.ok || !notesV.ok) return;

    setSaving(true);
    const r = await onSubmit({
      kind,
      productName: prod.value,
      notes: notesV.value,
      firstApplication,
    });
    setSaving(false);
    if (r.ok) {
      onClose();
    } else {
      setFormError(r.error ?? 'No pudimos iniciar el tratamiento.');
    }
  };

  return (
    <View position="absolute" top="$0" left="$0" right="$0" bottom="$0" backgroundColor="$scrim" justifyContent="flex-end">
      {/* El shell del teclado envuelve la COLUMNA (backdrop libre + hoja): con el teclado arriba encoge
          el alto útil desde abajo → el backdrop (flex:1) absorbe y la hoja SUBE por encima del teclado.
          El scrim de AFUERA sigue cubriendo la pantalla ENTERA (también detrás del teclado). Mismo
          esqueleto y mismo estilo que `BottomSheetShell`: este sheet está hecho a mano y su migración
          al primitivo queda anotada en `docs/backlog.md`. */}
      <KeyboardAvoidingShell style={avoidStyle}>
        <Pressable style={{ flex: 1, width: '100%' }} onPress={onClose} {...buttonA11y(Platform.OS, { label: 'Cerrar' })} />

        <YStack
          width="100%"
          maxHeight="90%"
          backgroundColor="$bg"
          borderTopLeftRadius="$card"
          borderTopRightRadius="$card"
          paddingHorizontal="$4"
          paddingTop="$4"
          paddingBottom={bottomPad}
          gap="$3"
        >
          {/* HEADER FIJO. */}
          <View
            alignSelf="center"
            width={getTokenValue('$icon', 'size')}
            height={getTokenValue('$progressTrack', 'size')}
            borderRadius="$pill"
            backgroundColor="$divider"
          />
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            Iniciar tratamiento
          </Text>

          {/* BODY SCROLL. */}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$3', 'space') }}>
            {/* Tipo (kind) — selector CERRADO 3 opciones (RTR.1.3). */}
            <YStack gap="$2">
              <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
                Tipo de tratamiento
              </Text>
              <Select
                value={kind}
                options={TREATMENT_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                placeholder="Elegí el tipo"
                open={openSelect === 'kind'}
                onToggle={() => setOpenSelect(openSelect === 'kind' ? null : 'kind')}
                onChange={(v) => {
                  setKind((v as TreatmentKind | null) ?? null);
                  if (kindErr) setKindErr(null);
                  setOpenSelect(null);
                }}
                a11yLabel="Tipo de tratamiento"
              />
              {kindErr ? (
                <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
                  {kindErr}
                </Text>
              ) : null}
            </YStack>

            {/* Producto (requerido, RTR.1.4). */}
            <FormField
              label="Producto"
              value={productName}
              onChangeText={(t) => {
                setProductName(sanitizeTreatmentProductInput(t));
                if (productErr) setProductErr(null);
              }}
              placeholder="Ej. Oxitetraciclina"
              maxLength={TREATMENT_PRODUCT_MAX_LENGTH}
              error={productErr}
            />

            {/* Comentario (opcional, RTR.1.5). Multilínea. */}
            <FormField
              label="Comentario (opcional)"
              value={notes}
              onChangeText={(t) => {
                setNotes(sanitizeTreatmentNotesInput(t));
                if (notesErr) setNotesErr(null);
              }}
              placeholder="Ej. ternero diarreico, tratamiento de 3 días"
              maxLength={TREATMENT_NOTES_MAX_LENGTH}
              multiline
              numberOfLines={3}
              error={notesErr}
            />

            {/* Toggle: registrar la primera aplicación ahora (RTR.1.6, opcional). */}
            <Pressable
              onPress={() => setIncludeFirstApp((v) => !v)}
              {...buttonA11y(Platform.OS, { label: 'Registrar la primera aplicación ahora', selected: includeFirstApp })}
            >
              <XStack alignItems="center" gap="$2" paddingVertical="$1">
                <View
                  width={getTokenValue('$navIcon', 'size')}
                  height={getTokenValue('$navIcon', 'size')}
                  borderRadius="$4"
                  borderWidth={2}
                  borderColor={includeFirstApp ? '$primary' : '$divider'}
                  backgroundColor={includeFirstApp ? '$primary' : 'transparent'}
                  alignItems="center"
                  justifyContent="center"
                >
                  {includeFirstApp ? <Check size={16} color={getTokenValue('$white', 'color')} strokeWidth={3} /> : null}
                </View>
                <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
                  Registrar la primera aplicación ahora
                </Text>
              </XStack>
            </Pressable>

            {/* Campos de la 1ª aplicación (solo si el toggle está activo). */}
            {includeFirstApp ? (
              <YStack gap="$3">
                <FormField
                  label="Fecha (AAAA-MM-DD)"
                  value={appDate}
                  onChangeText={(t) => {
                    setAppDate(maskDateInput(t));
                    if (appDateErr) setAppDateErr(null);
                  }}
                  keyboardType="number-pad"
                  placeholder="AAAA-MM-DD"
                  error={appDateErr}
                />
                <FormField
                  label="Dosis en ml (opcional)"
                  value={dose}
                  onChangeText={(t) => {
                    setDose(t);
                    if (doseErr) setDoseErr(null);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="Ej. 5"
                  error={doseErr}
                />
                <YStack gap="$2">
                  <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
                    Vía (opcional)
                  </Text>
                  <Select
                    value={route}
                    options={TREATMENT_ROUTE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    placeholder="Elegí la vía"
                    open={openSelect === 'route'}
                    onToggle={() => setOpenSelect(openSelect === 'route' ? null : 'route')}
                    onChange={(v) => {
                      setRoute(v);
                      setOpenSelect(null);
                    }}
                    a11yLabel="Vía de aplicación"
                  />
                </YStack>
                <FormField
                  label="Próxima dosis (opcional)"
                  value={nextDose}
                  onChangeText={(t) => {
                    setNextDose(maskDateInput(t));
                    if (nextDoseErr) setNextDoseErr(null);
                  }}
                  keyboardType="number-pad"
                  placeholder="AAAA-MM-DD"
                  error={nextDoseErr}
                />
              </YStack>
            ) : null}

            {formError ? (
              <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
                {formError}
              </Text>
            ) : null}
          </ScrollView>

          {/* FOOTER FIJO. */}
          <YStack gap="$2">
            <Button variant="primary" fullWidth disabled={saving} onPress={() => void onConfirm()}>
              {saving ? 'Guardando…' : 'Iniciar tratamiento'}
            </Button>
            <Button variant="secondary" fullWidth disabled={saving} onPress={onClose}>
              Cancelar
            </Button>
          </YStack>
        </YStack>
      </KeyboardAvoidingShell>
    </View>
  );
}
