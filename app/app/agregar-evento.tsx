// app/agregar-evento.tsx — wizard "Agregar evento" (spec 02 frontend C3.1, R10/R14).
//
// Carga UNITARIA de un evento desde la ficha del animal. Patrón wizard de 2 pasos (mismo modelo
// mental que crear-rodeo, que funcionó):
//   PASO 1 — elegí el TIPO: 3 cards grandes con ícono (Peso / Condición corporal / Observación).
//   PASO 2 — el FORM del tipo elegido (con "Atrás" para cambiar de tipo). CTA confirmar grande
//            (zona pulgar). Al confirmar → insert (events.ts) → router.back() a la ficha (que
//            recarga el timeline por useFocusEffect, y el evento nuevo aparece arriba).
//
// Los 3 tipos de C3.1 son SIMPLES (sin efecto colateral de categoría/ternero): Peso, Condición
// corporal, Observación libre. Los reproductivos/sanitarios/lab/category_change son C3.2/C3.3.
//
// Recibe profileId + establishmentId por params (Expo Router). El establishmentId viene de la FICHA
// (derivado del PERFIL, no del contexto activo) — crítico para la observación: animal_events valida
// que su establishment_id coincida con el del perfil (error 23514 si no). Si faltan params, la
// pantalla no se rompe (muestra un error claro y solo deja volver).
//
// Criticidad 🟡. Validación EN EL CAMPO (prevenir, no errorear al submit): peso decimal vía
// sanitizeWeightInput, fecha vía maskDateInput, score por selector CERRADO (nunca texto libre),
// texto con maxLength. Cero hardcode (ADR-023 §4): tokens + componentes; íconos lucide con
// getTokenValue. Voseo es-AR. a11y por helper (utils/a11y).

import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Activity, ChevronLeft, ChevronRight, StickyNote, Weight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Button, FormField, FormError, InfoNote } from '@/components';
import { addWeight, addConditionScore, addObservation } from '@/services/events';
import {
  sanitizeWeightInput,
  maskDateInput,
} from '@/utils/animal-input';
import {
  CONDITION_SCORES,
  formatConditionScore,
  sanitizeObservationInput,
  validateWeight,
  validateEventDate,
  validateObservation,
  OBSERVATION_MAX_LENGTH,
} from '@/utils/event-input';
import { buttonA11y } from '@/utils/a11y';

const OFFLINE_COPY =
  'Necesitás conexión para cargar un evento. Conectate a internet y volvé a intentar.';

type EventType = 'weight' | 'condition_score' | 'observation';

// Fecha de hoy en ISO 'YYYY-MM-DD' (local) para pre-cargar el campo de fecha (el caso típico es
// "cargar el evento de hoy" — el operario rara vez cambia la fecha).
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function AgregarEventoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ profileId?: string; establishmentId?: string }>();
  const profileId = typeof params.profileId === 'string' ? params.profileId : null;
  const establishmentId =
    typeof params.establishmentId === 'string' ? params.establishmentId : null;

  const [step, setStep] = useState<1 | 2>(1);
  const [eventType, setEventType] = useState<EventType | null>(null);

  // Campos de peso.
  const [weightKg, setWeightKg] = useState('');
  const [weightDate, setWeightDate] = useState(todayIso());
  const [weightErr, setWeightErr] = useState<string | null>(null);
  const [weightDateErr, setWeightDateErr] = useState<string | null>(null);

  // Campos de condición corporal.
  const [score, setScore] = useState<number | null>(null);
  const [scoreDate, setScoreDate] = useState(todayIso());
  const [scoreErr, setScoreErr] = useState<string | null>(null);
  const [scoreDateErr, setScoreDateErr] = useState<string | null>(null);

  // Campos de observación.
  const [observation, setObservation] = useState('');
  const [observationErr, setObservationErr] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);

  const missingParams = !profileId;

  const muted = getTokenValue('$textMuted', 'color');

  const onChooseType = useCallback((t: EventType) => {
    setEventType(t);
    setFormError(null);
    setStep(2);
  }, []);

  const goBack = useCallback(() => {
    setFormError(null);
    if (step === 2) {
      setStep(1);
      return;
    }
    router.back();
  }, [step, router]);

  const finishSubmit = useCallback(
    (r: { ok: true } | { ok: false; error: { kind: string; message: string } }) => {
      setSubmitting(false);
      busyRef.current = false;
      if (!r.ok) {
        setFormError(r.error.kind === 'network' ? OFFLINE_COPY : r.error.message);
        return;
      }
      // Volvemos a la ficha: useFocusEffect recarga el timeline → el evento nuevo aparece arriba.
      router.back();
    },
    [router],
  );

  const onSubmit = useCallback(async () => {
    if (busyRef.current || !profileId || !eventType) return;
    setFormError(null);

    // Validación por tipo (espejo del DB; feedback inmediato sin round-trip).
    if (eventType === 'weight') {
      const w = validateWeight(weightKg);
      const d = validateEventDate(weightDate);
      setWeightErr(w.ok ? null : w.error);
      setWeightDateErr(d.ok ? null : d.error);
      if (!w.ok || !d.ok) return;
      busyRef.current = true;
      setSubmitting(true);
      const r = await addWeight({ profileId, weightKg: w.value, weightDate: d.value });
      finishSubmit(r);
      return;
    }

    if (eventType === 'condition_score') {
      const d = validateEventDate(scoreDate);
      setScoreDateErr(d.ok ? null : d.error);
      if (score == null) {
        setScoreErr('Elegí la condición corporal.');
      } else {
        setScoreErr(null);
      }
      if (score == null || !d.ok) return;
      busyRef.current = true;
      setSubmitting(true);
      const r = await addConditionScore({ profileId, score, eventDate: d.value });
      finishSubmit(r);
      return;
    }

    if (eventType === 'observation') {
      const o = validateObservation(observation);
      setObservationErr(o.ok ? null : o.error);
      if (!o.ok) return;
      if (!establishmentId) {
        // Sin el establishment del perfil no podemos insertar la observación de forma segura (el
        // trigger validaría 23514). No improvisamos con el contexto activo.
        setFormError('No pudimos determinar el campo del animal. Volvé a abrir la ficha.');
        return;
      }
      busyRef.current = true;
      setSubmitting(true);
      const r = await addObservation({ profileId, establishmentId, text: o.value });
      finishSubmit(r);
      return;
    }
  }, [
    eventType,
    profileId,
    establishmentId,
    weightKg,
    weightDate,
    score,
    scoreDate,
    observation,
    finishSubmit,
  ]);

  const title =
    step === 1
      ? 'Agregar evento'
      : eventType === 'weight'
        ? 'Pesaje'
        : eventType === 'condition_score'
          ? 'Condición corporal'
          : 'Observación';

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header con back + título. */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={goBack} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            {title}
          </Text>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$2', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$4', 'space'),
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {missingParams ? (
          <InfoNote>
            No pudimos cargar el animal. Volvé a la ficha y abrí "Agregar evento" de nuevo.
          </InfoNote>
        ) : step === 1 ? (
          <Step1ChooseType onChoose={onChooseType} />
        ) : eventType === 'weight' ? (
          <WeightForm
            weightKg={weightKg}
            onWeightKg={(t) => {
              setWeightKg(sanitizeWeightInput(t));
              if (weightErr) setWeightErr(null);
            }}
            weightErr={weightErr}
            date={weightDate}
            onDate={(t) => {
              setWeightDate(maskDateInput(t));
              if (weightDateErr) setWeightDateErr(null);
            }}
            dateErr={weightDateErr}
          />
        ) : eventType === 'condition_score' ? (
          <ConditionForm
            score={score}
            onScore={(s) => {
              setScore(s);
              if (scoreErr) setScoreErr(null);
            }}
            scoreErr={scoreErr}
            date={scoreDate}
            onDate={(t) => {
              setScoreDate(maskDateInput(t));
              if (scoreDateErr) setScoreDateErr(null);
            }}
            dateErr={scoreDateErr}
          />
        ) : (
          <ObservationForm
            value={observation}
            onChange={(t) => {
              setObservation(sanitizeObservationInput(t));
              if (observationErr) setObservationErr(null);
            }}
            error={observationErr}
          />
        )}
      </ScrollView>

      {/* CTA fijo abajo (thumb-zone). Solo en el paso 2. */}
      {!missingParams && step === 2 ? (
        <YStack
          width="100%"
          paddingHorizontal="$4"
          paddingTop="$3"
          paddingBottom={insets.bottom + 12}
          gap="$2"
          borderTopWidth={1}
          borderTopColor="$divider"
          backgroundColor="$bg"
        >
          <FormError message={formError} />
          <Button variant="primary" fullWidth disabled={submitting} onPress={() => void onSubmit()}>
            {submitting ? 'Guardando…' : 'Guardar evento'}
          </Button>
          <Button variant="secondary" fullWidth onPress={goBack}>
            Cambiar de tipo
          </Button>
        </YStack>
      ) : null}
    </YStack>
  );
}

// ─── Paso 1: elegí el tipo de evento (3 cards grandes) ────────────────────────────────────

function Step1ChooseType({ onChoose }: { onChoose: (t: EventType) => void }) {
  return (
    <YStack gap="$3">
      <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
        ¿Qué querés cargar?
      </Text>
      <TypeCard
        icon={Weight}
        title="Pesaje"
        subtitle="El peso del animal en kilos"
        onPress={() => onChoose('weight')}
      />
      <TypeCard
        icon={Activity}
        title="Condición corporal"
        subtitle="Escala de 1 a 5"
        onPress={() => onChoose('condition_score')}
      />
      <TypeCard
        icon={StickyNote}
        title="Observación"
        subtitle="Una nota libre sobre el animal"
        onPress={() => onChoose('observation')}
      />
    </YStack>
  );
}

function TypeCard({
  icon: Icon,
  title,
  subtitle,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  const faint = getTokenValue('$textFaint', 'color');
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: title })}>
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor="$divider"
        backgroundColor="$white"
        paddingHorizontal="$4"
        paddingVertical="$3"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <View
          width="$icon"
          height="$icon"
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Icon size={22} color={primary} strokeWidth={2.5} />
        </View>
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary" numberOfLines={1}>
            {title}
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        </YStack>
        <ChevronRight size={22} color={faint} strokeWidth={2} />
      </XStack>
    </Pressable>
  );
}

// ─── Form: Pesaje ──────────────────────────────────────────────────────────────────────────

function WeightForm({
  weightKg,
  onWeightKg,
  weightErr,
  date,
  onDate,
  dateErr,
}: {
  weightKg: string;
  onWeightKg: (t: string) => void;
  weightErr: string | null;
  date: string;
  onDate: (t: string) => void;
  dateErr: string | null;
}) {
  return (
    <YStack gap="$3">
      <FormField
        label="Peso en kilos"
        value={weightKg}
        onChangeText={onWeightKg}
        keyboardType="decimal-pad"
        placeholder="Ej. 320"
        error={weightErr}
      />
      <FormField
        label="Fecha (AAAA-MM-DD)"
        value={date}
        onChangeText={onDate}
        keyboardType="number-pad"
        placeholder="AAAA-MM-DD"
        error={dateErr}
      />
    </YStack>
  );
}

// ─── Form: Condición corporal (selector CERRADO de los 17 scores) ─────────────────────────

function ConditionForm({
  score,
  onScore,
  scoreErr,
  date,
  onDate,
  dateErr,
}: {
  score: number | null;
  onScore: (s: number) => void;
  scoreErr: string | null;
  date: string;
  onDate: (t: string) => void;
  dateErr: string | null;
}) {
  return (
    <YStack gap="$3">
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Condición corporal (1 a 5)
        </Text>
        <ScoreSelector value={score} onChange={onScore} />
        {scoreErr ? (
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
            {scoreErr}
          </Text>
        ) : null}
      </YStack>
      <FormField
        label="Fecha (AAAA-MM-DD)"
        value={date}
        onChangeText={onDate}
        keyboardType="number-pad"
        placeholder="AAAA-MM-DD"
        error={dateErr}
      />
    </YStack>
  );
}

/**
 * Selector CERRADO de los 17 scores válidos (1.00→5.00 paso 0.25) — chips grandes en grilla. NUNCA
 * texto libre (garantiza el CHECK del DB 0028). El chip seleccionado se marca con la firma de color.
 */
function ScoreSelector({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (s: number) => void;
}) {
  return (
    <XStack width="100%" flexWrap="wrap" gap="$2">
      {CONDITION_SCORES.map((s) => {
        const selected = value != null && Math.abs(value - s) < 1e-9;
        const label = formatConditionScore(s);
        return (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            {...buttonA11y(Platform.OS, { label: `Condición ${label}`, selected })}
          >
            <View
              minWidth="$chipMin"
              minHeight="$chipMin"
              alignItems="center"
              justifyContent="center"
              borderRadius="$pill"
              borderWidth={2}
              borderColor={selected ? '$primary' : '$divider'}
              backgroundColor={selected ? '$primary' : '$white'}
              paddingHorizontal="$3"
              pressStyle={{ opacity: 0.85 }}
            >
              <Text
                fontFamily="$body"
                fontSize="$5"
                fontWeight="600"
                color={selected ? '$white' : '$textPrimary'}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </XStack>
  );
}

// ─── Form: Observación libre (textarea con tope) ──────────────────────────────────────────

function ObservationForm({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (t: string) => void;
  error: string | null;
}) {
  // Estilo del <textarea> alineado al lenguaje de FormField (input pill blanco, redondeado, sin el
  // borde default del browser). Los valores cruzan a la API de estilo no-Tamagui del <TextInput> de
  // RN → se leen con getTokenValue (no literales, ADR-023 §4).
  const placeholder = getTokenValue('$textMuted', 'color'); // mismo placeholder que FormField
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const surface = getTokenValue('$white', 'color'); // input blanco sobre $bg (como FormField)
  const borderColor = getTokenValue(error ? '$terracota' : '$divider', 'color');
  // En web (<textarea>) sacamos el focus-ring cuadrado del browser: el estado de foco lo da el borde
  // redondeado del input; el outline default rompe el lenguaje de FormField. RN-web traduce
  // outlineWidth:0 a `outline: none` en el DOM (tipado en TextStyle, sin cast).
  const webOutlineReset: TextStyle = Platform.OS === 'web' ? { outlineWidth: 0 } : {};
  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        Observación
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Ej. Renguea de la pata derecha; revisar en la próxima."
        placeholderTextColor={placeholder}
        multiline
        maxLength={OBSERVATION_MAX_LENGTH}
        textAlignVertical="top"
        style={{
          minHeight: getTokenValue('$10', 'size'),
          borderRadius: getTokenValue('$card', 'radius'),
          borderWidth: 1,
          borderColor,
          backgroundColor: surface,
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingVertical: getTokenValue('$3', 'space'),
          fontFamily: 'Inter',
          fontSize: getTokenValue('$inputText', 'size'),
          color: textPrimary,
          ...webOutlineReset,
        }}
        {...observationA11y()}
      />
      <XStack width="100%" justifyContent="flex-end">
        <Text fontFamily="$body" fontSize="$2" fontWeight="400" color="$textFaint">
          {value.length} / {OBSERVATION_MAX_LENGTH}
        </Text>
      </XStack>
      {error ? (
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
          {error}
        </Text>
      ) : null}
    </YStack>
  );
}

// a11y del textarea ramificada por plataforma (label DOM-válido en web, accessibilityLabel en
// native) — NUNCA accessibilityLabel crudo al <input> de RN-web (lección C1).
function observationA11y() {
  return Platform.OS === 'web'
    ? { 'aria-label': 'Observación' }
    : { accessibilityLabel: 'Observación' };
}
