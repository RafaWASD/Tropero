// Lógica PURA del rodeo + caravana visual del ternero AL PARTO (spec 02 delta parto-rodeo-caravana,
// RPRC.1/RPRC.2/RPRC.3). Sin RN, sin red: testeable con node:test (mismo patrón que event-input.ts /
// animal-input.ts). Espeja la lógica que en #15 (cría al pie) vive inline en LinkCalfPrompt.tsx:122-127;
// extraerla acá la hace verificable por test unitario sin render (trazabilidad RPRC.1.6/1.7).
//
// Diferencia clave vs #15: acá el parto soporta MELLIZOS (lista dinámica de N terneros). El RODEO aplica a
// TODA la camada (p_calf_rodeo_id escalar → un valor), pero la CARAVANA VISUAL (idv) es POR CRÍA (delta
// parto-caravana-visual-por-ternero, PCV.3: cada elemento de p_calves lleva su calf_idv — el RPC lo lee por
// cría; SUPERA RPRC.3.2/3.3 que la enviaban single-calf-only). Simétrica con la caravana electrónica.
//
// NO value-import de un sibling: solo `import type` (el runner node:test carga estos utils sin bundler;
// la resolución de extensiones difiere de Metro — lección event-input.ts).

import type { Rodeo } from '../services/rodeos';

/**
 * Rodeo EFECTIVO del ternero: el elegido en el picker (`selected`), o el de la madre (`motherRodeoId`)
 * si el operario no lo editó (`selected == null`). Es lo que se pasa como `calfRodeoId` a registerBirth
 * (RPRC.3.1). Espeja `effectiveCalfRodeoId = selectedCalfRodeoId ?? motherRodeoId` de #15.
 */
export function resolveEffectiveCalfRodeoId(
  selected: string | null,
  motherRodeoId: string | null,
): string | null {
  return selected ?? motherRodeoId;
}

/**
 * systemId del rodeo de la madre resuelto DESDE la lista de rodeos (fallback cuando el read local del
 * perfil de la madre no lo trajo). `null` si la madre no tiene rodeo o su rodeo no figura en la lista
 * (p.ej. parto sobre un animal de un campo distinto del activo → dispara el fallback RPRC.1.8).
 */
export function resolveMotherSystemId(
  rodeos: Rodeo[],
  motherRodeoId: string | null,
): string | null {
  if (!motherRodeoId) return null;
  return rodeos.find((r) => r.id === motherRodeoId)?.systemId ?? null;
}

/**
 * Rodeos ELEGIBLES para el ternero (RPRC.1.5/1.6): del campo activo + del MISMO SISTEMA productivo que el
 * de la madre (la categoría ternero/ternera se resuelve por el sistema del rodeo; otro sistema rompería la
 * resolución). El rodeo de la madre queda incluido (mismo sistema) y preseleccionado. `[]` si el sistema
 * no se pudo resolver (`motherSystemId` null) → dispara el fallback no-editable (RPRC.1.8).
 */
export function eligibleCalfRodeos(rodeos: Rodeo[], motherSystemId: string | null): Rodeo[] {
  if (motherSystemId == null) return [];
  return rodeos.filter((r) => r.systemId === motherSystemId);
}

/**
 * ¿El picker de rodeo es EDITABLE? (RPRC.1.5 vs. fallback RPRC.1.8). Solo si el rodeo de la madre FIGURA
 * entre los elegibles del campo activo. Si no figura (parto sobre animal de un campo distinto del activo,
 * o sistema irresoluble) → no editable: se preselecciona el de la madre sin ofrecer otras opciones (el RPC
 * re-valida con 23514). Nota: como el `system_id` es un catálogo GLOBAL (mismo UUID de 'cría' entre campos),
 * este guard es lo que evita ofrecer rodeos del campo ACTIVO para una madre de OTRO campo — el filtro por
 * sistema solo no alcanzaría.
 */
export function canEditCalfRodeo(eligible: Rodeo[], motherRodeoId: string | null): boolean {
  if (!motherRodeoId) return false;
  return eligible.some((r) => r.id === motherRodeoId);
}

/**
 * Caravana visual (idv) POR CRÍA a ENVIAR a registerBirth (delta parto-caravana-visual-por-ternero, PCV.3.1/
 * 3.3). Se aplica al idv de CADA ternero (dentro de su `CalfBlock`), single Y mellizos: un valor no vacío →
 * el idv; vacío → `null` (omitido — sin forzar, PCV.2). SUPERA el gate por longitud de camada del delta madre
 * (RPRC.3.2/3.3): ya no hay "solo single-calf" — cada cría manda su calf_idv. El valor ya viene sanitizado por
 * `sanitizeIdvInput` en el campo (solo dígitos); acá solo se recorta el whitespace defensivo.
 */
export function calfIdvForSubmit(idvRaw: string): string | null {
  const trimmed = idvRaw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
