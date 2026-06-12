// app/rodeo/[id].tsx — VISTA DE GRUPO de un RODEO (spec 10 T-UI.1 / R1.1, R1.2, R1.3, R1.4, R1.5, R1.6).
//
// Se llega desde Inicio (card de rodeo, R2.2). Muestra, para el rodeo del establecimiento activo:
//   - metadatos del grupo (nombre + cabezas activas),
//   - su configuración de datos resumida (qué se gatea — Vacunar/Destetar),
//   - la lista de sus animales ACTIVOS (R1.3) reusando AnimalRow COMPACTO (R1.2/R11.9),
//   - la GroupActionsBar: Castrar siempre (R1.5); Vacunar/Destetar gated por rodeo_data_config.
//
// Las acciones navegan al flujo de selección (seleccion-masiva) / vacunación (vacunacion-masiva) —
// esas pantallas son del PRÓXIMO chunk; acá solo se DISPARAN con los params del grupo + operación.
//
// Offline-first (spec 15): la lista sale de fetchAnimals(establishmentId, {rodeoId}) (SQLite local);
// el gating, de fetchRodeoGroupActions (config local). NUNCA se hardcodea establishment_id (ppio 6).
// Cero hardcode (ADR-023 §4): tokens + componentes; íconos lucide con getTokenValue. Voseo es-AR.

import { useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Boxes } from 'lucide-react-native';

import { AnimalRow, GroupViewScreen } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import { useGroupView, type GroupViewData } from '@/hooks';
import { fetchAnimals } from '@/services/animals';
import { fetchRodeoGroupActions } from '@/services/group-data';
import { formatAnimalAge } from '@/utils/animal-age';
import { navigateToGroupAction } from '@/utils/group-nav';
import type { GroupAction } from '@/utils/group-actions';

export default function RodeoGroupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const rodeoId = typeof params.id === 'string' ? params.id : null;

  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  const rodeoName =
    rodeoState.status === 'active'
      ? rodeoState.available.find((r) => r.id === rodeoId)?.name ?? 'Rodeo'
      : 'Rodeo';

  // Loader del grupo RODEO: animales activos de ESE rodeo + gating de su propia config (R1.5). Estable
  // (deps primitivas) para no re-disparar el hook de gusto.
  const loader = useCallback(
    async (): Promise<{ ok: true; data: GroupViewData } | { ok: false; message: string }> => {
      if (!establishmentId || !rodeoId) return { ok: false, message: 'No se encontró el rodeo.' };
      const [animalsR, actionsR] = await Promise.all([
        fetchAnimals(establishmentId, { rodeoId, status: 'active' }),
        fetchRodeoGroupActions(rodeoId),
      ]);
      if (!animalsR.ok) {
        return {
          ok: false,
          message:
            animalsR.error.kind === 'network'
              ? 'Sin conexión: no pudimos cargar el rodeo.'
              : 'No pudimos cargar el rodeo.',
        };
      }
      // Gating blando: si falla, ofrecemos solo Castrar (siempre disponible, R1.5).
      const actions = actionsR.ok ? actionsR.value : { castrate: true as const, vaccinate: false, wean: false };
      return { ok: true, data: { animals: animalsR.value, actions } };
    },
    [establishmentId, rodeoId],
  );

  const view = useGroupView(rodeoId ? loader : null);

  const onAction = useCallback(
    (action: GroupAction) => {
      if (!rodeoId) return;
      navigateToGroupAction(router, action, { groupType: 'rodeo', groupId: rodeoId });
    },
    [router, rodeoId],
  );

  return (
    <GroupViewScreen
      icon={Boxes}
      kindLabel="Rodeo"
      name={rodeoName}
      view={view}
      emptyCopy="Este rodeo todavía no tiene animales activos."
      onAction={onAction}
      renderRow={(a) => (
        <AnimalRow
          key={a.profileId}
          compact
          idv={a.idv ?? undefined}
          visualId={a.visualIdAlt ?? undefined}
          tagElectronic={a.tagElectronic}
          category={a.categoryName || a.categoryCode}
          categoryCode={a.categoryCode}
          age={formatAnimalAge(a.animalBirthDate)}
          sex={a.sex}
          rodeo={a.rodeoName}
          futureBull={a.futureBull}
          onPress={() => router.push({ pathname: '/animal/[id]', params: { id: a.profileId } })}
        />
      )}
    />
  );
}
