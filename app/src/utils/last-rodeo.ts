// Lógica PURA de la resolución del rodeo default del alta (spec 09 R6). Sin RN, sin red:
// testeable con node:test. El I/O (storage + query DB) vive en services/last-rodeo.ts, que
// importa este resolver puro (mismo split que utils/establishment.ts ↔ services/establishment-store.ts).

/**
 * Resuelve el rodeo default para el combo de alta (R6.2→R6.3→R6.4), dado el set de rodeos activos
 * YA cargado (del RodeoContext, ordenado created_at asc) + el lastRodeoSelected persistido +
 * el último rodeo usado en DB.
 *
 * Orden (R6):
 *   1. `persisted` (storage/memoria) si referencia un rodeo activo del set → usarlo (R6.2).
 *   2. `dbLastUsed` (último rodeo tocado, R6.3) si referencia un rodeo activo del set → usarlo.
 *   3. primer rodeo activo creado del set (R6.4) → el set viene ordenado por created_at asc → head.
 *   4. set vacío → null (la UI bloquea con CTA al wizard, R6.4).
 *
 * Validar contra el set vigente cubre el riesgo del design (lastRodeoSelected stale si el rodeo
 * fue borrado): un id que ya no está activo se ignora y cae al siguiente criterio.
 */
export function resolveDefaultRodeoId(
  activeRodeoIds: string[],
  persisted: string | null,
  dbLastUsed: string | null,
): string | null {
  const set = new Set(activeRodeoIds);
  if (persisted && set.has(persisted)) return persisted;
  if (dbLastUsed && set.has(dbLastUsed)) return dbLastUsed;
  return activeRodeoIds.length > 0 ? activeRodeoIds[0] : null;
}
