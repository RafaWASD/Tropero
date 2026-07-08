// app/lote/[id].tsx — VISTA DE GRUPO de un LOTE / management_group (spec 10 T-UI.1 / R1.1–R1.6, R7.1).
//
// Se llega desde Inicio (card de lote, R2.2). Muestra, para un lote del establecimiento activo:
//   - metadatos del grupo (nombre + cabezas activas),
//   - su configuración resumida (acciones gateadas disponibles según ALGÚN rodeo del lote — R7.1),
//   - la lista de sus animales ACTIVOS (R1.3) reusando AnimalRow COMPACTO (R1.2/R11.9),
//   - la GroupActionsBar: Castrar siempre (R1.5); Vacunar/Destetar si ALGÚN rodeo del lote la tiene (R7.1).
//
// Lote = agrupación cross-rodeo posible (ADR-020): el gating se resuelve sobre los rodeos REALES de los
// miembros (fetchLoteGroupActions). El skip/exclusión por rodeo real al APLICAR es del próximo chunk.
//
// Offline-first (spec 15): la lista sale de fetchGroupMembers (SQLite local); el gating, de la config
// local de los rodeos miembro. NUNCA se hardcodea establishment_id (ppio 6). Cero hardcode (ADR-023 §4).

import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Layers } from 'lucide-react-native';

import { AnimalRow, GroupViewScreen } from '@/components';
import { useEstablishment } from '@/contexts';
import { useGroupView, type GroupViewData } from '@/hooks';
import { fetchGroupMembers, fetchManagementGroups } from '@/services/management-groups';
import { fetchLoteGroupActions } from '@/services/group-data';
import { formatAnimalAge } from '@/utils/animal-age';
import { navigateToGroupAction } from '@/utils/group-nav';
import type { GroupAction } from '@/utils/group-actions';

export default function LoteGroupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === 'string' ? params.id : null;

  const { state: estState } = useEstablishment();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  // Nombre del lote: no hay un context de lotes → lo resolvemos del SQLite local (blando: "Lote" si
  // todavía no bajó). Se re-resuelve al cambiar de campo/lote.
  const [loteName, setLoteName] = useState('Lote');
  useEffect(() => {
    if (!establishmentId || !groupId) return;
    let active = true;
    void fetchManagementGroups(establishmentId).then((r) => {
      if (!active) return;
      if (r.ok) setLoteName(r.value.find((g) => g.id === groupId)?.name ?? 'Lote');
    });
    return () => {
      active = false;
    };
  }, [establishmentId, groupId]);

  // Loader del grupo LOTE: animales activos del lote + gating sobre los rodeos REALES de los miembros
  // (R7.1: la acción gateada se ofrece si ALGÚN rodeo del lote la tiene). Estable (deps primitivas).
  const loader = useCallback(
    async (): Promise<{ ok: true; data: GroupViewData } | { ok: false; message: string }> => {
      if (!establishmentId || !groupId) return { ok: false, message: 'No se encontró el lote.' };
      const membersR = await fetchGroupMembers(establishmentId, groupId);
      if (!membersR.ok) {
        return {
          ok: false,
          message:
            membersR.error.kind === 'network'
              ? 'Sin conexión: no pudimos cargar el lote.'
              : 'No pudimos cargar el lote.',
        };
      }
      const members = membersR.value;
      // Gating cross-rodeo (R7.1) + por candidatos (fix Raf 2026-06-12): la función deriva los rodeos
      // reales y los candidatos de los miembros. Gating blando: si falla la query de flags, no ofrecemos
      // ninguna acción (fail-closed — no sabemos si hay candidatos).
      const actionsR = await fetchLoteGroupActions(members);
      const actions = actionsR.ok ? actionsR.value : { castrate: false, vaccinate: false, wean: false };
      return { ok: true, data: { animals: members, actions } };
    },
    [establishmentId, groupId],
  );

  const view = useGroupView(groupId ? loader : null);

  const onAction = useCallback(
    (action: GroupAction) => {
      if (!groupId) return;
      navigateToGroupAction(router, action, { groupType: 'lote', groupId });
    },
    [router, groupId],
  );

  return (
    <GroupViewScreen
      icon={Layers}
      kindLabel="Lote"
      name={loteName}
      view={view}
      emptyCopy="Este lote todavía no tiene animales activos."
      onAction={onAction}
      backFallback="/lotes"
      renderRow={(a) => (
        <AnimalRow
          key={a.profileId}
          compact
          idv={a.idv ?? undefined}
          apodo={a.apodo}
          rodeoUsesApodo={a.rodeoUsesApodo}
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
