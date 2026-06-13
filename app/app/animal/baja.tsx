// app/animal/baja.tsx — baja / egreso de animal desde la ficha (spec 02 C3.3, R4.14 / R14.9).
//
// Pantalla corta de 2 pasos (mismo modelo mental que agregar-evento.tsx, que funcionó):
//   PASO 1 — ¿Qué pasó con este animal? 3 opciones grandes (Venta / Muerte / Transferencia),
//            una decisión por pantalla (campo-friendly, ≥$touchMin).
//   PASO 2 — Fecha (default HOY) + (SOLO Venta) peso + precio opcionales + el resumen del animal
//            (su identificador hero + el motivo) + el botón DESTRUCTIVO "Dar de baja". Copy claro
//            de que NO es reversible. El botón se deshabilita mientras el write está en vuelo.
//
// Recibe profileId + hero (el identificador grande del animal) por params (Expo Router) — la ficha
// los pasa al navegar. Al confirmar → exitAnimalProfile(animals.ts) → router.back() a la ficha, que
// recarga el detalle por useFocusEffect y pasa a modo archivada in-situ (el animal ya sale de la tab
// Animales por el filtro status='active'). Si faltan params, la pantalla no se rompe (error + volver).
//
// Online-only (C3.3): sin red → error claro (kind:'network'), la baja NO se marca. Authz: el RPC es la
// barrera real (gating del botón en la ficha = best-effort); un 42501 → copy accionable.
//
// Criticidad 🟡 (baja destructiva, authz-sensitive). Cero hardcode (ADR-023 §4): tokens + componentes;
// íconos lucide con getTokenValue. Voseo es-AR. a11y por helper (utils/a11y).

import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  Skull,
  Truck,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Card, FormField, FormError, InfoNote } from '@/components';
import { exitAnimalProfile } from '@/services/animals';
import {
  EXIT_REASON_MAPPINGS,
  exitReasonToStatus,
  validateExitWeight,
  validateExitPrice,
  sanitizePriceInput,
  type ExitReasonChoice,
} from '@/services/exit-animal';
import { sanitizeWeightInput, maskDateInput } from '@/utils/animal-input';
import { validateEventDate } from '@/utils/event-input';
import { buttonA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

const OFFLINE_COPY =
  'Sin conexión: no pudimos dar de baja el animal. Conectate a internet y volvé a intentar.';

// Ícono por motivo (paso 1). Banknote (venta), Skull (muerte), Truck (transferencia/egreso).
const REASON_ICON: Record<ExitReasonChoice, LucideIcon> = {
  sale: Banknote,
  death: Skull,
  transfer: Truck,
};

// Subtítulo por motivo (qué implica cada baja, es-AR).
const REASON_SUBTITLE: Record<ExitReasonChoice, string> = {
  sale: 'Se vendió y salió del campo',
  death: 'Murió',
  transfer: 'Se fue del campo',
};

/** Fecha de hoy en ISO 'YYYY-MM-DD' (local) — el caso típico es "la baja es de hoy". */
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function BajaAnimalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ profileId?: string; hero?: string }>();
  const profileId = typeof params.profileId === 'string' ? params.profileId : null;
  // El identificador hero del animal (idv → visual → caravana → "Animal"), para el resumen del paso 2.
  const hero =
    typeof params.hero === 'string' && params.hero.trim().length > 0 ? params.hero : 'Animal';

  const [step, setStep] = useState<1 | 2>(1);
  const [choice, setChoice] = useState<ExitReasonChoice | null>(null);

  const [exitDate, setExitDate] = useState(todayIso());
  const [exitDateErr, setExitDateErr] = useState<string | null>(null);
  const [weightRaw, setWeightRaw] = useState('');
  const [weightErr, setWeightErr] = useState<string | null>(null);
  const [priceRaw, setPriceRaw] = useState('');
  const [priceErr, setPriceErr] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Re-entrancy guard: un doble-tap del botón destructivo NO dispara dos bajas (un solo write).
  const busyRef = useRef(false);

  const missingParams = !profileId;
  const muted = getTokenValue('$textMuted', 'color');

  const mapping = choice ? exitReasonToStatus(choice) : null;
  const showSaleData = mapping?.capturesSaleData ?? false;

  // Destino de fallback del "Volver" robusto (backOr): la FICHA del animal (de donde se llega acá). Si
  // faltan params, caemos a la tab Animales en vez de romper. Solo se usa si el stack está vacío.
  const backFallback: Href = useMemo(
    () =>
      profileId ? { pathname: '/animal/[id]', params: { id: profileId } } : '/(tabs)/animales',
    [profileId],
  );

  const onChooseReason = useCallback((c: ExitReasonChoice) => {
    setChoice(c);
    setFormError(null);
    setStep(2);
  }, []);

  const goBack = useCallback(() => {
    setFormError(null);
    if (step === 2) {
      setStep(1);
      return;
    }
    backOr(router, backFallback);
  }, [step, router, backFallback]);

  const onConfirm = useCallback(async () => {
    if (busyRef.current || !profileId || !mapping) return;
    setFormError(null);

    // Validación (espejo del DB / feedback inmediato sin round-trip).
    const d = validateEventDate(exitDate);
    setExitDateErr(d.ok ? null : d.error);

    // Peso + precio solo aplican (y solo se validan) en Venta; en Muerte/Transferencia se ignoran.
    let weightValue: number | null = null;
    let priceValue: number | null = null;
    let saleDataOk = true;
    if (mapping.capturesSaleData) {
      const w = validateExitWeight(weightRaw);
      const p = validateExitPrice(priceRaw);
      setWeightErr(w.ok ? null : w.error);
      setPriceErr(p.ok ? null : p.error);
      if (!w.ok || !p.ok) saleDataOk = false;
      else {
        weightValue = w.value;
        priceValue = p.value;
      }
    } else {
      setWeightErr(null);
      setPriceErr(null);
    }

    if (!d.ok || !saleDataOk) return;

    // Guard ANTES de cualquier await (anti doble-tap; el botón sigue clickeable hasta el re-render).
    busyRef.current = true;
    setSubmitting(true);
    const r = await exitAnimalProfile({
      profileId,
      status: mapping.status,
      exitReason: mapping.exitReason,
      exitDate: d.value,
      exitWeight: weightValue,
      exitPrice: priceValue,
    });
    setSubmitting(false);
    busyRef.current = false;
    if (!r.ok) {
      setFormError(r.error.kind === 'network' ? OFFLINE_COPY : r.error.message);
      return;
    }
    // Volvemos a la ficha: useFocusEffect recarga el detalle → la ficha pasa a modo archivada in-situ
    // y el animal ya no aparece en la tab Animales (filtra status='active'). backOr cubre el stack
    // vacío (web-refresh / deep-link / cold-start) cayendo a la ficha.
    backOr(router, backFallback);
  }, [profileId, mapping, exitDate, weightRaw, priceRaw, router, backFallback]);

  const title = step === 1 ? 'Dar de baja' : (mapping?.label ?? 'Dar de baja');

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
          <InfoNote>No pudimos cargar el animal. Volvé a la ficha y abrí "Dar de baja" de nuevo.</InfoNote>
        ) : step === 1 ? (
          <Step1ChooseReason hero={hero} onChoose={onChooseReason} />
        ) : (
          <Step2Confirm
            hero={hero}
            reasonLabel={mapping?.label ?? ''}
            showSaleData={showSaleData}
            date={exitDate}
            onDate={(t) => {
              setExitDate(maskDateInput(t));
              if (exitDateErr) setExitDateErr(null);
            }}
            dateErr={exitDateErr}
            weight={weightRaw}
            onWeight={(t) => {
              setWeightRaw(sanitizeWeightInput(t));
              if (weightErr) setWeightErr(null);
            }}
            weightErr={weightErr}
            price={priceRaw}
            onPrice={(t) => {
              setPriceRaw(sanitizePriceInput(t));
              if (priceErr) setPriceErr(null);
            }}
            priceErr={priceErr}
          />
        )}
      </ScrollView>

      {/* CTA destructivo fijo abajo (thumb-zone), solo en el paso 2. */}
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
          <DestructiveButton
            label={submitting ? 'Dando de baja…' : 'Dar de baja'}
            disabled={submitting}
            onPress={() => void onConfirm()}
          />
        </YStack>
      ) : null}
    </YStack>
  );
}

// ─── Paso 1: elegí el motivo (3 cards grandes) ────────────────────────────────────────

function Step1ChooseReason({
  hero,
  onChoose,
}: {
  hero: string;
  onChoose: (c: ExitReasonChoice) => void;
}) {
  return (
    <YStack gap="$4">
      <YStack gap="$1">
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          ¿Qué pasó con este animal?
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted" numberOfLines={1}>
          {hero}
        </Text>
      </YStack>

      <YStack gap="$3">
        {EXIT_REASON_MAPPINGS.map((m) => (
          <ReasonCard
            key={m.choice}
            icon={REASON_ICON[m.choice]}
            title={m.label}
            subtitle={REASON_SUBTITLE[m.choice]}
            onPress={() => onChoose(m.choice)}
          />
        ))}
      </YStack>
    </YStack>
  );
}

// Card de motivo: ícono en halo terracota suave (señal de baja, no la firma verde de las acciones
// positivas) + título + subtítulo + chevron. ≥$touchMin. a11y por helper. Cero hardcode (tokens).
// Como no hay token terracota-claro en la paleta (igual que AbortionFlag/TimelineEvent), usamos
// $surface de fondo del halo + borde/ícono $terracota.
function ReasonCard({
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
  const terracota = getTokenValue('$terracota', 'color');
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
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$terracota"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Icon size={22} color={terracota} strokeWidth={2.5} />
        </View>
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary" numberOfLines={1}>
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

// ─── Paso 2: fecha + (solo Venta) datos de venta + resumen + (botón destructivo abajo) ────

function Step2Confirm({
  hero,
  reasonLabel,
  showSaleData,
  date,
  onDate,
  dateErr,
  weight,
  onWeight,
  weightErr,
  price,
  onPrice,
  priceErr,
}: {
  hero: string;
  reasonLabel: string;
  showSaleData: boolean;
  date: string;
  onDate: (t: string) => void;
  dateErr: string | null;
  weight: string;
  onWeight: (t: string) => void;
  weightErr: string | null;
  price: string;
  onPrice: (t: string) => void;
  priceErr: string | null;
}) {
  return (
    <YStack gap="$4">
      {/* Resumen del animal + motivo elegido (confirmación clara: qué animal, qué baja). */}
      <Card gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Vas a dar de baja
        </Text>
        <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          {hero}
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$terracota">
          Motivo: {reasonLabel}
        </Text>
      </Card>

      <FormField
        label="Fecha de la baja (AAAA-MM-DD)"
        value={date}
        onChangeText={onDate}
        keyboardType="number-pad"
        placeholder="AAAA-MM-DD"
        error={dateErr}
      />

      {/* Peso + precio SOLO en Venta (D2): opcionales, alimentan analytics (precio/kg, ganancia de peso). */}
      {showSaleData ? (
        <YStack gap="$3">
          <FormField
            label="Peso de salida en kg (opcional)"
            value={weight}
            onChangeText={onWeight}
            keyboardType="decimal-pad"
            placeholder="Ej. 380"
            error={weightErr}
          />
          <FormField
            label="Precio de venta en $ (opcional)"
            value={price}
            onChangeText={onPrice}
            keyboardType="decimal-pad"
            placeholder="Ej. 250000"
            error={priceErr}
          />
        </YStack>
      ) : null}

      {/* Aviso de irreversibilidad (no reversible desde la UI en MVP — el copy lo sugiere). */}
      <YStack
        width="100%"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$terracota"
        padding="$4"
        gap="$1"
      >
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$terracota">
          Esta acción no se puede deshacer
        </Text>
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
          El animal sale del rodeo activo y queda archivado. Su historial se conserva, pero no vas a
          poder reactivarlo desde la app.
        </Text>
      </YStack>
    </YStack>
  );
}

// Botón DESTRUCTIVO a medida (el Button canónico no tiene variante destructiva): relleno terracota,
// texto blanco, pill, ≥$touchMin. Disabled mientras el write está en vuelo (anti doble-tap visual).
// a11y por helper (NUNCA accessibilityLabel crudo en el Pressable de RN-web). Cero hardcode (tokens).
function DestructiveButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const white = getTokenValue('$white', 'color');
  return (
    <Pressable
      style={{ width: '100%' }}
      onPress={disabled ? undefined : onPress}
      {...buttonA11y(Platform.OS, { label: 'Dar de baja', disabled })}
    >
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        borderRadius="$pill"
        backgroundColor="$terracota"
        paddingHorizontal="$5"
        opacity={disabled ? 0.5 : 1}
        pressStyle={{ opacity: 0.85 }}
      >
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$white">
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}
