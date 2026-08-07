// TreatmentApplicationSheet — bottom-sheet "Registrar aplicación" (delta spec 02 tratamientos, RTR.2).
//
// Sheet de una APLICACIÓN sobre un tratamiento EN CURSO: fecha (default hoy, RTR.2.2) + dosis/vía/próxima
// dosis (opcionales, RTR.2.3). El `product_name` de la aplicación por defecto es el del tratamiento (RTR.2.2)
// → NO se edita acá (se muestra como contexto). Al confirmar llama `onSubmit` (la ficha ejecuta
// registerApplication + refresh silencioso); en ok cierra, en error lo muestra inline. Solo se abre desde un
// tratamiento en curso (la sección no ofrece el CTA en tratamientos finalizados, RTR.2.5).
//
// Anatomía de sheet: scrim + header FIJO / body SCROLL / footer FIJO. Validación INLINE. es-AR. Cero hardcode.

import { useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { getTokenValue, ScrollView, Text, View, YStack } from 'tamagui';

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
  TREATMENT_ROUTE_OPTIONS,
  treatmentKindLabel,
  validateDose,
  validateNextDose,
} from '../utils/treatment-input';
import type { Treatment } from '../services/treatments';

// Estilo del `KeyboardAvoidingShell` (API no-Tamagui) — el MISMO que usa `BottomSheetShell` para este
// esqueleto. `flex`/`width` no son spacing/color → no aplica el lint anti-hardcode (ADR-023 §4).
const avoidStyle = { flex: 1, width: '100%', justifyContent: 'flex-end' } as const;

/** Lo que el sheet devuelve al confirmar (ya validado). El product_name lo pone la ficha (= el del header). */
export type TreatmentApplicationSubmit = {
  eventDate: string;
  doseMl: number | null;
  route: string | null;
  nextDoseDate: string | null;
};

export type TreatmentApplicationSheetProps = {
  /** El tratamiento EN CURSO al que se le registra la aplicación (para el contexto: producto/tipo). */
  treatment: Treatment;
  onClose: () => void;
  onSubmit: (submit: TreatmentApplicationSubmit) => Promise<{ ok: boolean; error?: string }>;
};

export function TreatmentApplicationSheet({ treatment, onClose, onSubmit }: TreatmentApplicationSheetProps) {
  // ABRIR EL SHEET BAJA EL TECLADO (bug 🔴 device Android): se abre desde la ficha del animal, que tiene
  // campos de texto. Además del lift, esto tapa el LÍMITE del montaje del `KeyboardAvoidingShell` de abajo
  // (monta con el teclado ya abierto → arranca en altura 0 hasta el próximo evento de insets).
  // Sus propios inputs no se ven afectados: el hook dispara SOLO en el flanco de apertura.
  useDismissKeyboardOnOpen();

  // Reserva inferior KEYBOARD-AWARE, con el MISMO criterio (y el mismo arrastre de la unidad «aire») que
  // `TreatmentStartSheet`: `floor: $6` (= 32 en la escala `space`) conserva el valor que estaba escrito a
  // mano y el hook le agrega el inset del sistema + el aire de Android, que a este sheet le faltaban.
  // Delta con el teclado CERRADO: **web 32 (idéntico) · iOS 32 → 34 · Android gestos 32 → 48 · Android 3
  // botones 32 → 64**, fijado por test en `utils/footer-action.test.ts`.
  const bottomPad = useKeyboardAwareBottomInset({ floor: getTokenValue('$6', 'space') });
  const [appDate, setAppDate] = useState(todayIsoLocal());
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState<string | null>(null);
  const [nextDose, setNextDose] = useState('');
  const [routeOpen, setRouteOpen] = useState(false);

  const [appDateErr, setAppDateErr] = useState<string | null>(null);
  const [doseErr, setDoseErr] = useState<string | null>(null);
  const [nextDoseErr, setNextDoseErr] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onConfirm = async () => {
    setAppDateErr(null);
    setDoseErr(null);
    setNextDoseErr(null);
    setFormError(null);

    const d = validateEventDate(appDate);
    const doseV = validateDose(dose);
    const nd = validateNextDose(nextDose);
    let hasError = false;
    if (!d.ok) {
      setAppDateErr(d.error);
      hasError = true;
    }
    if (!doseV.ok) {
      setDoseErr(doseV.error);
      hasError = true;
    }
    if (!nd.ok) {
      setNextDoseErr(nd.error);
      hasError = true;
    }
    if (hasError || !d.ok || !doseV.ok || !nd.ok) return;

    setSaving(true);
    const r = await onSubmit({
      eventDate: d.value,
      doseMl: doseV.value,
      route,
      nextDoseDate: nd.value,
    });
    setSaving(false);
    if (r.ok) {
      onClose();
    } else {
      setFormError(r.error ?? 'No pudimos registrar la aplicación.');
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
          <View
            alignSelf="center"
            width={getTokenValue('$icon', 'size')}
            height={getTokenValue('$progressTrack', 'size')}
            borderRadius="$pill"
            backgroundColor="$divider"
          />
          <YStack gap="$1">
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
              Registrar aplicación
            </Text>
            {/* Contexto: producto + tipo del tratamiento (el product_name de la aplicación es el del header). */}
            <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted" numberOfLines={1}>
              {treatment.productName} · {treatmentKindLabel(treatment.kind)}
            </Text>
          </YStack>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$3', 'space') }}>
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
                open={routeOpen}
                onToggle={() => setRouteOpen((v) => !v)}
                onChange={(v) => {
                  setRoute(v);
                  setRouteOpen(false);
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

            {formError ? (
              <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
                {formError}
              </Text>
            ) : null}
          </ScrollView>

          <YStack gap="$2">
            <Button variant="primary" fullWidth disabled={saving} onPress={() => void onConfirm()}>
              {saving ? 'Guardando…' : 'Registrar aplicación'}
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
