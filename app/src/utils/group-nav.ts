// group-nav.ts — navegación de las acciones masivas de la vista de grupo (spec 10, T-UI.1).
//
// Centraliza el ruteo de Castrar/Destetar/Vacunar al flujo correspondiente, con los params del grupo
// (groupType + groupId + op). El DESTINO real (la pantalla de selección explícita / vacunación masiva)
// es del PRÓXIMO chunk — por ahora `seleccion-masiva` / `vacunacion-masiva` son rutas stub navegables.
//
// PURO respecto de React (no usa hooks): recibe el `router` ya resuelto (ImperativeRouter de expo-router),
// igual que utils/nav.ts. Las dos pantallas de grupo (rodeo/[id], lote/[id]) lo reusan.

import type { ImperativeRouter } from 'expo-router';

import type { GroupAction } from './group-actions';

/** Identidad del grupo sobre el que se aplica la acción masiva (rodeo o lote + su id). */
export type GroupRef = { groupType: 'rodeo' | 'lote'; groupId: string };

/**
 * Navega al flujo de la acción masiva elegida con los params del grupo (R1.4):
 *   - Vacunar           → /vacunacion-masiva (modelo todo+filtro+preview+skip-report, design §3.1).
 *   - Castrar / Destetar → /seleccion-masiva (selección explícita por checkbox, op='castrate'|'wean').
 * Las rutas destino son STUB en este chunk (la selección/vacunación reales son del próximo).
 */
export function navigateToGroupAction(
  router: ImperativeRouter,
  action: GroupAction,
  group: GroupRef,
): void {
  if (action === 'vaccinate') {
    router.push({ pathname: '/vacunacion-masiva', params: { ...group } });
    return;
  }
  router.push({
    pathname: '/seleccion-masiva',
    params: { ...group, op: action === 'castrate' ? 'castrate' : 'wean' },
  });
}
