// Lógica PURA del rodeo + caravana visual del ternero AL PARTO (spec 02 delta parto-rodeo-caravana,
// RPRC.1/RPRC.2/RPRC.3). Sin RN, sin red: testeable con node:test (mismo patrón que event-input.ts /
// animal-input.ts). Espeja la lógica que en #15 (cría al pie) vive inline en LinkCalfPrompt.tsx:122-127;
// extraerla acá la hace verificable por test unitario sin render (trazabilidad RPRC.1.6/1.7/3.2/3.3).
//
// Diferencia clave vs #15: acá el parto soporta MELLIZOS (lista dinámica de N terneros). El RODEO aplica a
// TODA la camada (p_calf_rodeo_id escalar → un valor), pero la CARAVANA VISUAL (idv) solo se ofrece/envía
// con 1 ternero (p_calf_idv escalar → ofrecer N idvs rompería el contrato del RPC — ver design §7).
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
 * Caravana visual (idv) a ENVIAR a registerBirth (RPRC.3.2/3.3). Solo con EXACTAMENTE 1 ternero y un valor
 * no vacío; `null` con ≥2 terneros (mellizos) o con el campo vacío. Descartar el idv cuando hay mellizos es
 * intencional (D2): `p_calf_idv` es un escalar único → no se puede repartir a N terneros; el mellizo asigna
 * su visual después desde la ficha. El valor ya viene sanitizado por `sanitizeIdvInput` en el campo; acá
 * solo se recorta el trailing/leading whitespace defensivo (sanitizeIdvInput ya deja solo dígitos).
 */
export function calfIdvForSubmit(calvesLength: number, idvRaw: string): string | null {
  const trimmed = idvRaw.trim();
  return calvesLength === 1 && trimmed.length > 0 ? trimmed : null;
}
