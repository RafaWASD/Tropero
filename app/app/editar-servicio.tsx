// app/editar-servicio.tsx — "Meses de servicio del rodeo" (spec 03 Stream B / B1 — RPSC.3; OFFLINE-first).
//
// Owner-only (la RPC set_rodeo_service_months 0103 es SECURITY DEFINER con guard is_owner_of sobre el
// establishment DERIVADO del rodeo — anti-IDOR, RPS.3.4; a un no-owner la RPC le da 42501 al drenar). La
// barrera de UX es que solo el owner ve la gestión de rodeos (rodeos.tsx) → este screen es owner-only acá.
//
// Reusa el ServiceMonthsSelector APROBADO por Raf (mode='edicion'): muestra lo PERSISTIDO o, si es NULL,
// el estado explícito "SIN CONFIGURAR" (RPSC.3.2) — sin pre-tildar primavera en la edición (no se inventa una
// campaña que el productor no declaró; espejo de DD-PS-3). Período CONTIGUO por construcción.
//
// Flujo: lee el rodeo del RodeoContext (su serviceMonths ya parseado tolerante, RPSC.3.7) → el owner ajusta →
// "Guardar" sanea el array (toServiceMonthsArray — contiguo + único + en rango) y encola UN solo
// set_rodeo_service_months OFFLINE (outbox + overlay optimista pending_rodeo_service_months → la pantalla
// refleja el cambio al instante, RPSC.3.4). Idempotente (sin client_op_id, RPSC.3.5). Encolar es 100% local →
// funciona sin red; el UPDATE real se aplica idempotente al drenar (P0002 si el rodeo desapareció → rollback,
// RPSC.3.6). NO se permite guardar "sin configurar" (null): la edición exige una selección explícita.
//
// params: rodeoId (requerido), name (para el título). Llega desde RodeosScreen.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería. Voseo argentino.

import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, XStack, YStack } from 'tamagui';
import { ChevronLeft } from 'lucide-react-native';

import { Button, FormError, InfoNote } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import { setRodeoServiceMonths } from '@/services/rodeos';
import { toServiceMonthsArray } from '@/utils/service-months';
import { buttonA11y } from '@/utils/a11y';
import { ServiceMonthsSelector } from './_components/ServiceMonthsSelector';

const SAVE_ERROR_COPY = 'No se pudieron guardar los meses de servicio. Reintentá.';

export default function EditarServicioScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ rodeoId?: string; name?: string }>();
  const rodeoId = typeof params.rodeoId === 'string' ? params.rodeoId : null;
  const rodeoName = typeof params.name === 'string' ? params.name : 'Rodeo';

  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();
  const isOwner = estState.status === 'active' && estState.role === 'owner';
  const muted = getTokenValue('$textMuted', 'color');

  // El rodeo viene del RodeoContext (ya cargado, con serviceMonths parseado tolerante — RPSC.3.7).
  const rodeo = useMemo(() => {
    if (rodeoState.status !== 'active') return null;
    return rodeoState.available.find((r) => r.id === rodeoId) ?? null;
  }, [rodeoState, rodeoId]);

  // Estado controlado del selector. Arranca con lo PERSISTIDO (puede ser null = "sin configurar", RPSC.3.2).
  // `value === null` se mantiene como null hasta que el operario toque la grilla/atajos → recién ahí pasa a
  // un array (y se habilita Guardar). NO se pre-tilda primavera en la edición.
  const [value, setValue] = useState<number[] | null>(rodeo ? rodeo.serviceMonths : null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveBusy = useRef(false);

  async function onSave() {
    if (!rodeoId || value === null || saveBusy.current) return;
    saveBusy.current = true;
    setSaveError(null);
    setSaving(true);

    // Saneamos el array (contiguo viene del selector; toServiceMonthsArray ordena/dedup/filtra rango defensivo).
    // El [] explícito ("no hace servicio") se respeta. El establishment lo deriva la RPC del rodeo (no se
    // hardcodea — multi-tenant). UN solo intent OFFLINE; el éxito/rechazo REAL lo resuelve uploadData al subir.
    const months = toServiceMonthsArray(new Set(value));
    const r = await setRodeoServiceMonths(rodeoId, months);

    setSaving(false);
    saveBusy.current = false;
    if (!r.ok) {
      // Fallo del DB local (no de red: encolar es local). El estado del selector queda como está para reintentar.
      setSaveError(SAVE_ERROR_COPY);
      return;
    }
    // Encolado OK (acción terminal): volvemos a Rodeos. El overlay optimista ya pisa service_months del rodeo,
    // así que el cambio se ve reflejado al volver (RPSC.3.4). Patrón consistente con editar-plantilla.tsx.
    router.back();
  }

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={() => router.back()} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <YStack flex={1} minWidth={0}>
            <Text numberOfLines={1} fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary">
              Meses de servicio
            </Text>
            <Text numberOfLines={1} fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
              {rodeoName}
            </Text>
          </YStack>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {!isOwner ? (
          <YStack marginTop="$2">
            <InfoNote>
              Solo el dueño del campo puede configurar los meses de servicio del rodeo.
            </InfoNote>
          </YStack>
        ) : !rodeo ? (
          <YStack marginTop="$2">
            <InfoNote>No pudimos identificar el rodeo.</InfoNote>
          </YStack>
        ) : (
          <YStack marginTop="$2">
            <ServiceMonthsSelector mode="edicion" value={value} onChange={setValue} />
          </YStack>
        )}
      </ScrollView>

      {isOwner && rodeo ? (
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
          {saveError ? <FormError message={saveError} /> : null}
          {/* Guardar deshabilitado mientras el valor sea null ("sin configurar"): la edición exige una
              selección explícita (no se persiste null). */}
          <Button
            variant="primary"
            fullWidth
            disabled={saving || value === null}
            onPress={() => void onSave()}
          >
            {saving ? 'Guardando…' : 'Guardar meses de servicio'}
          </Button>
        </YStack>
      ) : null}
    </YStack>
  );
}
