// app/editar-plantilla.tsx — "Editar plantilla del rodeo" (spec 02 frontend, C1 / T4.3 — R2.12;
// OFFLINE-first vía spec 15 Run T9.9).
//
// Owner-only (la RPC set_rodeo_config 0082 es SECURITY DEFINER con guard is_owner_of sobre el establishment
// DERIVADO del rodeo; a un no-owner la RPC le da 42501 al drenar). Reusa FieldTemplateToggleList con TODO el
// catálogo global (buildEditToggles): muestra los datos default del sistema + permite habilitar un dato
// NO-default (caso "tambo + preñez", R2.12). El timeline conserva el historial aunque se destilde
// (R2.12.1) — eso es de C3.
//
// Flujo: carga catálogo + defaults del sistema del rodeo + config efectiva (todo LOCAL, el overlay ya está
// foldeado en buildRodeoConfigQuery) → arma toggles → el owner ajusta → "Guardar" computa el diff contra el
// estado EFECTIVO (computeEditDiff) y encola UN solo set_rodeo_config OFFLINE (outbox + overlay optimista).
// Sin DELETE (R2.12: deshabilitar = enabled=false). Encolar es 100% local → funciona sin red; el UPSERT real
// se aplica idempotente al drenar la cola (R6.10). Un rodeo recién creado offline (no sincronizado) también
// se edita: systemId/baseConfig salen del local (incluye el overlay del alta).
//
// params: rodeoId (requerido), name (para el título). Llega desde RodeosScreen.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería. Voseo argentino.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { getTokenValue } from 'tamagui';
import { ChevronLeft, Plus } from 'lucide-react-native';

import { Button, FieldTemplateToggleList, FormError, InfoNote } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import {
  fetchFieldCatalog,
  fetchSystemDefaults,
  fetchRodeoConfig,
  type RodeoFieldConfig,
} from '@/services/rodeo-config';
import { createCustomField } from '@/services/custom-fields';
import { enqueueSetRodeoConfig } from '@/services/powersync/outbox';
import {
  buildEditToggles,
  groupTogglesByCategory,
  computeEditDiff,
  setToggle,
  type TemplateToggle,
} from '@/utils/rodeo-template';
import type { CustomFieldDraft } from '@/utils/custom-field';
import { buttonA11y } from '@/utils/a11y';
import { CustomFieldSheet } from './maniobra/_components/CustomFieldSheet';

const SAVE_ERROR_COPY = 'No se pudo guardar la plantilla. Reintentá.';

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
  const saveBusy = useRef(false);
  // `+` crear dato personalizado (M5-C.2, R13.5/R13.6): owner-only. Abre el sheet en modo 'classify'
  // (pregunta propiedad/maniobra primero, R13.6).
  const [customSheetOpen, setCustomSheetOpen] = useState(false);
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

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
    setSaving(true);

    // Diff contra el estado EFECTIVO de partida (computeEditDiff): solo las filas que el usuario cambió.
    // Los fields `required` se ignoran (computeEditDiff los saltea → no emiten op). Si el diff es vacío
    // ("guardar sin cambios"), es un NO-OP: no encolamos nada y simplemente volvemos atrás (tocar
    // "Guardar" sin cambios = un "Listo"; consistente con el back terminal de editar-campo.tsx).
    const ops = computeEditDiff(toggles, baseConfig);
    if (ops.length === 0) {
      setSaving(false);
      saveBusy.current = false;
      router.back();
      return;
    }

    // UN solo intent OFFLINE: set_rodeo_config con el diff completo (UPSERT idempotente server-side al drenar).
    // p_toggles = el diff (insert ⇒ enabled true; update ⇒ su enabled — el UPSERT cubre ambos). configRows =
    // las filas EFECTIVAS cambiadas → overlay optimista (pisa la fila synced del mismo field en
    // buildRodeoConfigQuery). Encolar es 100% local → SIEMPRE OK offline; el único fallo posible es del DB
    // local (defensivo). El éxito/rechazo REAL de la RPC se resuelve al subir (connector.uploadData).
    const p_toggles = ops.map((o) => ({ field_definition_id: o.fieldDefinitionId, enabled: o.enabled }));
    const configRows = ops.map((o) => ({ fieldDefinitionId: o.fieldDefinitionId, enabled: o.enabled }));
    const r = await enqueueSetRodeoConfig({
      rodeoId,
      params: { p_rodeo_id: rodeoId, p_toggles },
      configRows,
    });

    setSaving(false);
    saveBusy.current = false;
    if (!r.ok) {
      // Fallo del DB local (no de red: encolar es local). Mensaje genérico; el estado de toggles queda como
      // está para que el usuario reintente sin re-tildar todo. NO navegamos: solo se vuelve atrás en ÉXITO.
      setSaveError(SAVE_ERROR_COPY);
      return;
    }
    // Encolado OK (acción terminal): volvemos a la pantalla de rodeos de donde se llega. El overlay
    // optimista ya pisa la plantilla local, así que el cambio se ve reflejado al volver; no hace falta
    // refrescar el baseConfig acá (nos vamos de la pantalla). Patrón consistente con editar-campo.tsx
    // (onSaved async → router.back()). Confirmación: no hay primitiva de toast/snackbar reusable en
    // @/components, así que back inmediato (mismo back silencioso que el equipo ya acepta en editar-campo).
    router.back();
  }

  // Crear un dato custom (R13.5/R13.6) desde el `+`: createCustomField (CRUD-plano offline; el server fuerza
  // owner + valida). Al OK: cerramos el sheet + RECARGAMOS la plantilla (el field nuevo aparece en el
  // catálogo local al instante, en su categoría "Personalizado", listo para tildar y Guardar). Devuelve un
  // mensaje es-AR al fallo (el sheet lo superficia y no se cierra).
  async function onCreateCustomField(draft: CustomFieldDraft): Promise<string | null> {
    if (!establishmentId) return 'No pudimos resolver el campo. Volvé a intentar.';
    const r = await createCustomField({ establishmentId, draft });
    if (!r.ok) return r.error.message;
    setCustomSheetOpen(false);
    await load(); // el field nuevo entra al catálogo local → aparece como toggle "Personalizado".
    return null;
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
          <YStack gap="$3" marginTop="$2">
            <FieldTemplateToggleList
              sections={sections}
              header={EDIT_HEADER}
              onToggle={(id, enabled) =>
                setToggles((prev) => (prev ? setToggle(prev, id, enabled) : prev))
              }
            />
            {/* `+` crear dato personalizado (R13.5/R13.6): pregunta propiedad/maniobra y arma el dato.
                El dato nuevo aparece en su categoría "Personalizado" para tildarlo y Guardar. Owner-only. */}
            <Pressable
              onPress={() => setCustomSheetOpen(true)}
              testID="config-add-custom-field"
              {...buttonA11y(Platform.OS, { label: 'Crear dato personalizado' })}
            >
              <XStack
                alignItems="center"
                gap="$2"
                minHeight="$touchMin"
                paddingHorizontal="$3"
                borderRadius="$card"
                borderWidth={1}
                borderColor="$primary"
                borderStyle="dashed"
                backgroundColor="$surface"
                pressStyle={{ backgroundColor: '$greenLight' }}
              >
                <View
                  width={28}
                  height={28}
                  borderRadius="$pill"
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="$primary"
                >
                  <Plus size={18} color={getTokenValue('$white', 'color')} strokeWidth={3} />
                </View>
                <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$primary" numberOfLines={1}>
                  Crear dato personalizado
                </Text>
              </XStack>
            </Pressable>
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
          <Button variant="primary" fullWidth disabled={saving} onPress={() => void onSave()}>
            {saving ? 'Guardando…' : 'Guardar plantilla'}
          </Button>
        </YStack>
      ) : null}

      {/* SHEET de creación de dato custom (R13.5/R13.6): modo 'classify' (pregunta propiedad/maniobra
          primero). Solo se ofrece si isOwner (el `+` ya está dentro del bloque owner-only). */}
      {isOwner && customSheetOpen ? (
        <CustomFieldSheet
          mode="classify"
          onCreate={onCreateCustomField}
          onClose={() => setCustomSheetOpen(false)}
        />
      ) : null}
    </YStack>
  );
}
