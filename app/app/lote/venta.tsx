// app/lote/venta.tsx — BAJA EN TANDA (venta/descarte) de un subconjunto de un lote (delta lotes-venta).
//
// Se llega desde el modo selección del lote (`app/lote/[id].tsx`) con `groupId` + `profileIds` (los animales
// tildados). Es un LOOP CLIENT-SIDE de la baja per-animal existente (`exit_animal_profile`, 0044, vía la
// outbox) — NO una RPC nueva (RLV.7.1). Dos pasos (mismo modelo que `app/animal/baja.tsx`):
//   PASO 1 — Motivo de la tanda: Venta / Muerte (RLV.4, "Venta simple" — sin culling).
//   PASO 2 — Fecha común (default hoy, a TODOS RLV.5.1) + (solo Venta) precio/peso comunes opcionales
//            (RLV.5) ajustables por animal (override, RLV.6) + resumen "N animales · Motivo" + aviso de
//            irreversibilidad (RLV.17) + botón destructivo "Registrar salida" (guard anti doble-tap,
//            disabled en vuelo — RLV.18/RLV.19). Al OK → exitAnimalsBatch → router.back() al lote.
//
// ANTI-IDOR (RLV.21.1): la lista operable se arma SOLO de `fetchGroupMembers` (RLS-scopeado al campo activo)
// intersecada con los profileIds recibidos → un profileId ajeno/tampereado que NO sea miembro del lote se
// DESCARTA (no se le da de baja). El cliente solo manda `p_profile_id`; el tenant lo deriva el RPC server-side
// por-llamada. NUNCA se hardcodea establishment_id (del contexto, RLV.20). Offline-first (RLV.22/RLV.23): todo
// local + outbox, efecto optimista al instante.
//
// Criticidad 🟡 (baja destructiva, authz-sensitive). Cero hardcode (ADR-023 §4): tokens + componentes; lucide
// con getTokenValue. Voseo es-AR. a11y por helper. Recorte de descendentes: lineHeight en headings/numberOfLines.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Banknote, ChevronLeft, ChevronRight, Skull } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Card, FormField, FormError, InfoNote } from '@/components';
import { useEstablishment } from '@/contexts';
import { fetchGroupMembers } from '@/services/management-groups';
import { exitAnimalsBatch } from '@/services/batch-exit';
import {
  BATCH_EXIT_MAPPINGS,
  batchExitReasonToStatus,
  validateExitWeight,
  validateExitPrice,
  sanitizePriceInput,
  type BatchExitChoice,
} from '@/services/exit-animal';
import type { BatchExitTarget } from '@/services/batch-exit';
import { sanitizeWeightInput, maskDateInput } from '@/utils/animal-input';
import { validateEventDate } from '@/utils/event-input';
import { pickHeroIdentifier } from '@/utils/animal-identifier';
import { formatEidReadable } from '@/utils/eid-format';
import { buttonA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

import { BatchSaleAnimalRow } from './_components/BatchSaleAnimalRow';

const REASON_ICON: Record<BatchExitChoice, LucideIcon> = { sale: Banknote, death: Skull };
const REASON_SUBTITLE: Record<BatchExitChoice, string> = {
  sale: 'Se vendieron y salen del campo',
  death: 'Murieron',
};

/** Fecha de hoy en ISO 'YYYY-MM-DD' (local). El caso típico: la baja es de hoy. */
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

type Target = { profileId: string; hero: string };
type OverrideState = { priceRaw: string; weightRaw: string; priceErr: string | null; weightErr: string | null };
const EMPTY_OVERRIDE: OverrideState = { priceRaw: '', weightRaw: '', priceErr: null, weightErr: null };

export default function LoteVentaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ groupId?: string; profileIds?: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : null;
  const requestedIds = useMemo(() => {
    const raw = typeof params.profileIds === 'string' ? params.profileIds : '';
    return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }, [params.profileIds]);

  const { state: estState } = useEstablishment();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  const muted = getTokenValue('$textMuted', 'color');

  // ── Carga de la selección: SOLO de fetchGroupMembers (RLS-scopeado) ∩ profileIds recibidos (anti-IDOR). ──
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!establishmentId || !groupId || requestedIds.length === 0) {
      setTargets([]);
      return;
    }
    let active = true;
    void fetchGroupMembers(establishmentId, groupId).then((r) => {
      if (!active) return;
      if (!r.ok) {
        setLoadError(
          r.error.kind === 'network'
            ? 'Sin conexión: no pudimos cargar los animales del lote.'
            : 'No pudimos cargar los animales del lote.',
        );
        setTargets([]);
        return;
      }
      const requested = new Set(requestedIds);
      const list: Target[] = r.value
        .filter((a) => requested.has(a.profileId))
        .map((a) => ({ profileId: a.profileId, hero: heroOf(a) }));
      setTargets(list);
    });
    return () => {
      active = false;
    };
  }, [establishmentId, groupId, requestedIds]);

  const [step, setStep] = useState<1 | 2>(1);
  const [choice, setChoice] = useState<BatchExitChoice | null>(null);
  const mapping = choice ? batchExitReasonToStatus(choice) : null;
  const showSaleData = mapping?.capturesSaleData ?? false;

  const [exitDate, setExitDate] = useState(todayIso());
  const [exitDateErr, setExitDateErr] = useState<string | null>(null);
  const [commonPrice, setCommonPrice] = useState('');
  const [commonPriceErr, setCommonPriceErr] = useState<string | null>(null);
  const [commonWeight, setCommonWeight] = useState('');
  const [commonWeightErr, setCommonWeightErr] = useState<string | null>(null);

  // Overrides por animal (RLV.6) + qué filas están expandidas.
  const [overrides, setOverrides] = useState<Record<string, OverrideState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false); // anti doble-tap (RLV.18): el botón sigue clickeable hasta el re-render

  const backFallback: Href = useMemo(
    () => (groupId ? { pathname: '/lote/[id]', params: { id: groupId } } : '/lotes'),
    [groupId],
  );

  const goBack = useCallback(() => {
    setFormError(null);
    if (step === 2) {
      setStep(1);
      return;
    }
    backOr(router, backFallback);
  }, [step, router, backFallback]);

  const onChooseReason = useCallback((c: BatchExitChoice) => {
    setChoice(c);
    setFormError(null);
    setStep(2);
  }, []);

  const setOverride = useCallback((profileId: string, patch: Partial<OverrideState>) => {
    setOverrides((prev) => ({ ...prev, [profileId]: { ...(prev[profileId] ?? EMPTY_OVERRIDE), ...patch } }));
  }, []);
  const toggleExpanded = useCallback((profileId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }, []);

  const onConfirm = useCallback(async () => {
    if (busyRef.current || !mapping || !targets || targets.length === 0) return;
    setFormError(null);

    // Validación (espejo del DB, feedback inmediato). Fecha común SIEMPRE; precio/peso solo en Venta.
    const d = validateEventDate(exitDate);
    setExitDateErr(d.ok ? null : d.error);
    const exitDateValue = d.ok ? d.value : exitDate;
    let ok = d.ok;

    let commonPriceValue: number | null = null;
    let commonWeightValue: number | null = null;
    const resolvedTargets: BatchExitTarget[] = targets.map((t) => ({ profileId: t.profileId }));

    if (mapping.capturesSaleData) {
      const cp = validateExitPrice(commonPrice);
      const cw = validateExitWeight(commonWeight);
      setCommonPriceErr(cp.ok ? null : cp.error);
      setCommonWeightErr(cw.ok ? null : cw.error);
      if (!cp.ok || !cw.ok) ok = false;
      else {
        commonPriceValue = cp.value;
        commonWeightValue = cw.value;
      }
      // Overrides por animal (RLV.6/RLV.6.1): validar cada uno; el vacío es válido (cae al común).
      const nextOverrides = { ...overrides };
      for (const t of targets) {
        const o = overrides[t.profileId] ?? EMPTY_OVERRIDE;
        const op = validateExitPrice(o.priceRaw);
        const ow = validateExitWeight(o.weightRaw);
        nextOverrides[t.profileId] = {
          ...o,
          priceErr: op.ok ? null : op.error,
          weightErr: ow.ok ? null : ow.error,
        };
        if (!op.ok || !ow.ok) {
          ok = false;
          // Abrir la fila con error para que se vea el mensaje inline.
          setExpanded((prev) => new Set(prev).add(t.profileId));
        } else {
          const target = resolvedTargets.find((rt) => rt.profileId === t.profileId);
          if (target) {
            target.overridePrice = op.value;
            target.overrideWeight = ow.value;
          }
        }
      }
      setOverrides(nextOverrides);
    }

    if (!ok) return;

    busyRef.current = true;
    setSubmitting(true);
    const r = await exitAnimalsBatch({
      common: {
        reason: mapping.choice,
        exitDate: exitDateValue,
        commonPrice: commonPriceValue,
        commonWeight: commonWeightValue,
      },
      targets: resolvedTargets,
    });
    setSubmitting(false);
    busyRef.current = false;

    if (!r.ok) {
      // Fail-closed: alguna escritura local falló → superficia + deja reintentar. Las ya encoladas quedan.
      setFormError(
        r.count > 0
          ? `Se registraron ${r.count} de ${targets.length}. Volvé a intentar para las que faltan.`
          : 'No se pudo registrar la salida. Volvé a intentar.',
      );
      return;
    }
    // OK → volvemos al lote, que se re-lee al enfocar y muestra menos cabezas (overlay + membresía limpia).
    backOr(router, backFallback);
  }, [mapping, targets, exitDate, commonPrice, commonWeight, overrides, router, backFallback]);

  const missing = !groupId || requestedIds.length === 0;
  const noTargets = targets !== null && targets.length === 0;
  const title = step === 1 ? 'Vender / Descartar' : (mapping?.label ?? 'Registrar salida');
  const count = targets?.length ?? 0;
  const animalsWord = count === 1 ? 'animal' : 'animales';

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
        {missing || loadError || noTargets ? (
          <InfoNote>
            {loadError ??
              (missing
                ? 'No pudimos cargar la selección. Volvé al lote y elegí los animales de nuevo.'
                : 'Estos animales ya no están activos en el lote.')}
          </InfoNote>
        ) : targets === null ? (
          <InfoNote>Cargando animales…</InfoNote>
        ) : step === 1 ? (
          <Step1ChooseReason count={count} onChoose={onChooseReason} />
        ) : (
          <YStack gap="$4">
            {/* Resumen: N animales + motivo (confirmación clara, RLV.17). */}
            <Card gap="$2">
              <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
                Vas a dar de baja
              </Text>
              <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                {count} {animalsWord}
              </Text>
              <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$terracota">
                Motivo: {mapping?.label ?? ''}
              </Text>
            </Card>

            <FormField
              label="Fecha de la salida (AAAA-MM-DD)"
              value={exitDate}
              onChangeText={(t) => {
                setExitDate(maskDateInput(t));
                if (exitDateErr) setExitDateErr(null);
              }}
              keyboardType="number-pad"
              placeholder="AAAA-MM-DD"
              error={exitDateErr}
            />

            {/* Precio + peso COMUNES (solo Venta, RLV.5): se aplican a todos; ajustables por animal abajo. */}
            {showSaleData ? (
              <YStack gap="$3">
                <FormField
                  label="Precio por animal en $ (opcional)"
                  value={commonPrice}
                  onChangeText={(t) => {
                    setCommonPrice(sanitizePriceInput(t));
                    if (commonPriceErr) setCommonPriceErr(null);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="Ej. 250000"
                  error={commonPriceErr}
                />
                <FormField
                  label="Peso por animal en kg (opcional)"
                  value={commonWeight}
                  onChangeText={(t) => {
                    setCommonWeight(sanitizeWeightInput(t));
                    if (commonWeightErr) setCommonWeightErr(null);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="Ej. 380"
                  error={commonWeightErr}
                />
                <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
                  Se aplican a todos. Podés ajustar un animal puntual abajo.
                </Text>
              </YStack>
            ) : null}

            {/* Lista de animales: con override (Venta) o solo lectura (Muerte). */}
            <YStack gap="$2">
              <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary">
                Animales ({count})
              </Text>
              {showSaleData
                ? targets.map((t) => {
                    const o = overrides[t.profileId] ?? EMPTY_OVERRIDE;
                    return (
                      <BatchSaleAnimalRow
                        key={t.profileId}
                        testID={`batch-row-${t.profileId}`}
                        hero={t.hero}
                        expanded={expanded.has(t.profileId)}
                        onToggleExpand={() => toggleExpanded(t.profileId)}
                        priceRaw={o.priceRaw}
                        onPrice={(text) => setOverride(t.profileId, { priceRaw: sanitizePriceInput(text), priceErr: null })}
                        priceErr={o.priceErr}
                        weightRaw={o.weightRaw}
                        onWeight={(text) => setOverride(t.profileId, { weightRaw: sanitizeWeightInput(text), weightErr: null })}
                        weightErr={o.weightErr}
                        commonPriceHint={commonPrice.trim().length > 0 ? `$${commonPrice}` : null}
                        commonWeightHint={commonWeight.trim().length > 0 ? `${commonWeight} kg` : null}
                      />
                    );
                  })
                : targets.map((t) => (
                    <View key={t.profileId} borderWidth={1} borderColor="$divider" borderRadius="$card" backgroundColor="$white" paddingHorizontal="$4" paddingVertical="$3">
                      <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                        {t.hero}
                      </Text>
                    </View>
                  ))}
            </YStack>

            {/* Aviso de irreversibilidad (RLV.17). */}
            <YStack width="100%" backgroundColor="$surface" borderRadius="$card" borderWidth={1} borderColor="$terracota" padding="$4" gap="$1">
              <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$terracota">
                Esta acción no se puede deshacer
              </Text>
              <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
                Los animales salen del rodeo activo y quedan archivados. Su historial se conserva, pero no vas a
                poder reactivarlos desde la app.
              </Text>
            </YStack>
          </YStack>
        )}
      </ScrollView>

      {/* CTA destructivo fijo abajo (thumb-zone), solo en el paso 2 con animales. */}
      {step === 2 && targets && targets.length > 0 ? (
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
            label={submitting ? 'Registrando…' : `Registrar salida (${count})`}
            disabled={submitting}
            onPress={() => void onConfirm()}
            testID="venta-registrar-salida"
          />
        </YStack>
      ) : null}
    </YStack>
  );
}

/** Identificador hero de un miembro del lote (apodo/idv/tag → "Animal"). */
function heroOf(a: {
  apodo: string | null;
  rodeoUsesApodo: boolean;
  idv: string | null;
  tagElectronic: string | null;
}): string {
  const r = pickHeroIdentifier({ apodo: a.apodo, rodeoUsesApodo: a.rodeoUsesApodo, idv: a.idv, tag: a.tagElectronic });
  if (r.kind === 'tag' && r.value) return formatEidReadable(r.value);
  return r.value ?? 'Animal';
}

// ─── Paso 1: motivo de la tanda (2 cards grandes) ─────────────────────────────────────

function Step1ChooseReason({ count, onChoose }: { count: number; onChoose: (c: BatchExitChoice) => void }) {
  const word = count === 1 ? 'animal' : 'animales';
  return (
    <YStack gap="$4">
      <YStack gap="$1">
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          ¿Qué pasó con estos animales?
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted" numberOfLines={1}>
          {count} {word} seleccionados
        </Text>
      </YStack>

      <YStack gap="$3">
        {BATCH_EXIT_MAPPINGS.map((m) => (
          <ReasonCard
            key={m.choice}
            icon={REASON_ICON[m.choice as BatchExitChoice]}
            title={m.label}
            subtitle={REASON_SUBTITLE[m.choice as BatchExitChoice]}
            onPress={() => onChoose(m.choice as BatchExitChoice)}
          />
        ))}
      </YStack>
    </YStack>
  );
}

function ReasonCard({ icon: Icon, title, subtitle, onPress }: { icon: LucideIcon; title: string; subtitle: string; onPress: () => void }) {
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
        <View width="$icon" height="$icon" borderRadius="$pill" backgroundColor="$surface" borderWidth={1} borderColor="$terracota" alignItems="center" justifyContent="center" flexShrink={0}>
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

// Botón DESTRUCTIVO (mismo patrón que app/animal/baja.tsx): relleno terracota, texto blanco, pill, ≥$touchMin.
// Disabled en vuelo (anti doble-tap visual, RLV.19). a11y por helper. Cero hardcode (tokens).
function DestructiveButton({ label, disabled, onPress, testID }: { label: string; disabled: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable style={{ width: '100%' }} onPress={disabled ? undefined : onPress} testID={testID} {...buttonA11y(Platform.OS, { label: 'Registrar salida', disabled })}>
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
