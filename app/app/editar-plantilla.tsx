// app/editar-plantilla.tsx — "Editar plantilla del rodeo" (spec 02 frontend, C1 / T4.3 — R2.12).
//
// Owner-only (la RLS de rodeo_data_config es is_owner_of; a un no-owner los UPDATE/INSERT le dan
// count=0 / error). Reusa FieldTemplateToggleList con TODO el catálogo global (buildEditToggles):
// muestra los datos default del sistema + permite habilitar un dato NO-default (caso "tambo +
// preñez", R2.12). El timeline conserva el historial aunque se destilde (R2.12.1) — eso es de C3.
//
// Flujo: carga catálogo + defaults del sistema del rodeo + config efectiva → arma toggles →
// el owner ajusta → "Guardar" computa el diff contra el estado EFECTIVO (computeEditDiff) y aplica
// UPDATE/INSERT sobre rodeo_data_config. Sin DELETE (R2.12: deshabilitar = enabled=false).
//
// params: rodeoId (requerido), name (para el título). Llega desde RodeosScreen.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería. Voseo argentino.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, XStack, YStack } from 'tamagui';
import { getTokenValue } from 'tamagui';
import { ChevronLeft } from 'lucide-react-native';

import { Button, FieldTemplateToggleList, FormError, InfoNote } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import {
  fetchFieldCatalog,
  fetchSystemDefaults,
  fetchRodeoConfig,
  toggleRodeoField,
  enableNonDefaultField,
  type RodeoFieldConfig,
} from '@/services/rodeo-config';
import {
  buildEditToggles,
  groupTogglesByCategory,
  computeEditDiff,
  setToggle,
  type TemplateToggle,
} from '@/utils/rodeo-template';
import { buttonA11y } from '@/utils/a11y';

const OFFLINE_COPY = 'Necesitás conexión para guardar la plantilla. Conectate y volvé a intentar.';

const EDIT_HEADER =
  'Tildá los datos que querés registrar en este rodeo. Podés sumar datos que no son del sistema por defecto. Los que destildes dejan de pedirse, pero el historial ya cargado se conserva.';

export default function EditarPlantillaScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ rodeoId?: string; name?: string }>();
  const rodeoId = typeof params.rodeoId === 'string' ? params.rodeoId : null;
  const rodeoName = typeof params.name === 'string' ? params.name : 'Rodeo';

  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();
  const isOwner = estState.status === 'active' && estState.role === 'owner';
  const muted = getTokenValue('$textMuted', 'color');

  // Sistema del rodeo (lo sabemos del RodeoContext; los defaults se piden por systemId).
  const systemId = useMemo(() => {
    if (rodeoState.status !== 'active') return null;
    const r = rodeoState.available.find((x) => x.id === rodeoId);
    return r?.systemId ?? null;
  }, [rodeoState, rodeoId]);

  const [toggles, setToggles] = useState<TemplateToggle[] | null>(null);
  // Estado EFECTIVO de partida (para diffear al guardar). Se refresca tras guardar OK.
  const [baseConfig, setBaseConfig] = useState<RodeoFieldConfig[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const saveBusy = useRef(false);

  async function load() {
    if (!rodeoId || !systemId) {
      setLoadError('No pudimos identificar el rodeo.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const [catalogR, defaultsR, configR] = await Promise.all([
      fetchFieldCatalog(),
      fetchSystemDefaults(systemId),
      fetchRodeoConfig(rodeoId),
    ]);
    setLoading(false);
    if (!catalogR.ok || !defaultsR.ok || !configR.ok) {
      const err = !catalogR.ok ? catalogR.error : !defaultsR.ok ? defaultsR.error : configR.ok ? null : configR.error;
      setLoadError(
        err?.kind === 'network'
          ? 'Sin conexión: no pudimos cargar la plantilla.'
          : 'No pudimos cargar la plantilla del rodeo.',
      );
      return;
    }
    setBaseConfig(configR.value);
    setToggles(buildEditToggles(catalogR.value, defaultsR.value, configR.value));
  }

  // Carga al tener rodeoId + systemId. Dep primitiva: el systemId (string|null).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rodeoId, systemId]);

  const sections = useMemo(() => (toggles ? groupTogglesByCategory(toggles) : []), [toggles]);

  async function onSave() {
    if (!rodeoId || !toggles || saveBusy.current) return;
    saveBusy.current = true;
    setSaveError(null);
    setSavedOk(false);
    setSaving(true);

    const ops = computeEditDiff(toggles, baseConfig);
    let failed = false;
    for (const op of ops) {
      const r =
        op.kind === 'update'
          ? await toggleRodeoField(rodeoId, op.fieldDefinitionId, op.enabled)
          : await enableNonDefaultField(rodeoId, op.fieldDefinitionId);
      if (!r.ok) {
        failed = true;
        setSaveError(r.error.kind === 'network' ? OFFLINE_COPY : r.error.message);
        break;
      }
    }
    setSaving(false);
    saveBusy.current = false;
    if (failed) {
      // Re-leemos el estado real para que el siguiente guardado diffee contra lo persistido (no
      // re-intentar ops ya aplicadas). Best-effort.
      await load();
      return;
    }
    setSavedOk(true);
    // Persistido OK: re-leemos el estado efectivo del server para que el baseConfig del próximo
    // guardado sea la verdad (más robusto que recomputar a mano qué filas quedaron). load() resetea
    // savedOk en su arranque (setLoading no lo toca), así que lo seteamos arriba para el feedback
    // inmediato; tras recargar, el usuario ve la plantilla al día.
    await reloadBaseOnly();
  }

  /**
   * Re-lee SOLO el estado efectivo (rodeo_data_config) tras un guardado OK, para refrescar el
   * baseConfig contra el cual diffeará el próximo guardado. NO re-arma los toggles (no pisa la
   * interacción visual del usuario, que ya coincide con lo persistido). Best-effort: si falla, el
   * baseConfig queda en el estado previo y el próximo diff podría re-emitir alguna op idempotente
   * (UPDATE al mismo valor / INSERT que choca el PK — el caso de error se reporta y reintenta).
   */
  async function reloadBaseOnly() {
    if (!rodeoId) return;
    const configR = await fetchRodeoConfig(rodeoId);
    if (configR.ok) setBaseConfig(configR.value);
  }

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={() => router.back()} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <YStack flex={1} minWidth={0}>
            <Text numberOfLines={1} fontFamily="$body" fontSize="$7" fontWeight="700" color="$textPrimary">
              Plantilla de datos
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
        showsHorizontalScrollIndicator={false}
      >
        {!isOwner ? (
          <YStack gap="$2" marginTop="$2">
            <InfoNote>
              Solo el dueño del campo puede editar la plantilla. Te mostramos los datos que se
              registran en este rodeo.
            </InfoNote>
            {toggles ? (
              <FieldTemplateToggleList sections={sections} onToggle={() => {}} readOnly />
            ) : null}
          </YStack>
        ) : loading ? (
          <InfoNote>Cargando la plantilla…</InfoNote>
        ) : loadError ? (
          <YStack gap="$2" marginTop="$2">
            <FormError message={loadError} />
            <Button variant="secondary" fullWidth onPress={() => void load()}>
              Reintentar
            </Button>
          </YStack>
        ) : toggles ? (
          <YStack gap="$2" marginTop="$2">
            <FieldTemplateToggleList
              sections={sections}
              header={EDIT_HEADER}
              onToggle={(id, enabled) =>
                setToggles((prev) => (prev ? setToggle(prev, id, enabled) : prev))
              }
            />
          </YStack>
        ) : null}
      </ScrollView>

      {isOwner && toggles ? (
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
          {savedOk ? (
            <Text
              fontFamily="$body"
              fontSize="$3"
              fontWeight="500"
              color="$primary"
              {...(Platform.OS === 'web' ? { role: 'status' as const } : { accessibilityLiveRegion: 'polite' as const })}
            >
              Plantilla guardada.
            </Text>
          ) : null}
          <Button variant="primary" fullWidth disabled={saving} onPress={() => void onSave()}>
            {saving ? 'Guardando…' : 'Guardar plantilla'}
          </Button>
        </YStack>
      ) : null}
    </YStack>
  );
}
