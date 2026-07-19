// app/rodeo/[id].tsx — VISTA DE GRUPO de un RODEO (spec 10 T-UI.1 + delta «rodeo grande» T-RG.25).
//
// Se llega desde Inicio (card de rodeo, R2.2). Muestra, para el rodeo del establecimiento activo:
//   - metadatos del grupo (nombre + total REAL de cabezas activas — COUNT scopeado, RG2.1),
//   - buscador + chips de categoría/sexo scopeados al grupo (RG3.x),
//   - la lista de sus animales ACTIVOS PAGINADA (scroll infinito keyset, RG1.x) reusando AnimalRow COMPACTO,
//   - la GroupActionsBar: Castrar/Vacunar/Destetar gateadas por config + candidatos del GRUPO ENTERO (RG5.2).
//
// La lista y el gating salen de `useGroupView({ establishmentId, group })` (query SCOPEADA al rodeo, paginada,
// del SQLite local — offline-first, spec 15 / RG6.4), NO de `fetchAnimals({rodeoId})` (LIMIT 200 del campo).
// NUNCA se hardcodea establishment_id (ppio 6). Cero hardcode (ADR-023 §4): tokens; lucide con getTokenValue. Voseo.

import { useCallback, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Boxes } from 'lucide-react-native';

import { AnimalRow, GroupViewScreen } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import { useGroupView, type GroupViewParams } from '@/hooks';
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

  // Params del hook: campo activo + grupo (rodeo). `null` mientras no se resuelven → el hook expone el error.
  const viewParams = useMemo<GroupViewParams | null>(
    () => (establishmentId && rodeoId ? { establishmentId, group: { type: 'rodeo', id: rodeoId } } : null),
    [establishmentId, rodeoId],
  );
  const view = useGroupView(viewParams);

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
          apodo={a.apodo}
          rodeoUsesApodo={a.rodeoUsesApodo}
          tagElectronic={a.tagElectronic}
          category={a.categoryName || a.categoryCode}
          categoryCode={a.categoryCode}
          age={formatAnimalAge(a.animalBirthDate)}
          sex={a.sex}
          rodeo={a.rodeoName}
          futureBull={a.futureBull}
          inTreatment={a.inTreatment}
          onPress={() => router.push({ pathname: '/animal/[id]', params: { id: a.profileId } })}
        />
      )}
    />
  );
}
