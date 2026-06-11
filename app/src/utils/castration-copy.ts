// Copy es-AR de la observación automática de castración (spec 10, R13.7 / design §3.5). PURO, sin I/O —
// fuente ÚNICA del texto, consumida por animals.setCastrated (ficha, 1+1) y bulk-operations (masiva,
// N+N). Tenerlo acá evita que el texto diverja entre los dos call-sites y permite pinearlo en un test.
//
// Modelo (R13.7 / R13.2): castrar/des-castrar NO crea un evento TIPADO (D10 firme); deja una OBSERVACIÓN
// genérica (animal_events 'observacion') como rastro atribuible (autor + fecha en el timeline), en TODOS
// los casos — incluido `ternero`, el caso default de la masiva, donde no hay transición ni fila de history.
// El revert TAMBIÉN deja observación (simetría: la corrección es tan auditable como el acto).

/** Texto de la observación al CASTRAR (is_castrated: false→true). */
export const OBSERVATION_CASTRATED = 'Castrado';

/** Texto de la observación al REVERTIR (is_castrated: true→false) — simetría (R13.7). */
export const OBSERVATION_UNCASTRATED = 'Corrección: marcado como no castrado';

/**
 * Texto de la observación automática para un flip de `is_castrated`. `value=true` (castrar) → "Castrado";
 * `value=false` (revertir) → "Corrección: marcado como no castrado". Determinístico, sin estado.
 */
export function castrationObservationText(value: boolean): string {
  return value ? OBSERVATION_CASTRATED : OBSERVATION_UNCASTRATED;
}
