// app/src/utils/maniobra-resume.ts — lógica PURA del resumen de la TARJETA "Retomar la jornada de hoy"
// del landing de MODO MANIOBRAS (spec 03 M4, R10.5/R10.6). Sin RN, sin red, sin SDK: testeable con
// node:test. La pantalla (`app/app/maniobra.tsx`) resuelve el NOMBRE del rodeo via RodeoContext; este
// módulo arma los textos derivables del `Session` solo (maniobras, contador, fecha de inicio si no es hoy).

import { extractManeuvers, type ManeuverConfig } from './maneuver-config';
import { maneuverLabel } from './maneuver-wizard';
import { formatDateCompactEsAr } from './format-date-es-ar';

/**
 * Resumen legible de las maniobras de la jornada (R10.5): `extractManeuvers(config).map(maneuverLabel)`
 * coma-join con separador medio. Config vacío/corrupto → '' (la tarjeta cae a un copy neutro). NO tira.
 */
export function resumeManeuversSummary(config: ManeuverConfig): string {
  const maniobras = extractManeuvers(config);
  if (maniobras.length === 0) return '';
  return maniobras.map(maneuverLabel).join(' · ');
}

/** Contador "N animales" con pluralización es-AR (1 → "animal"). */
export function resumeAnimalCountLabel(animalCount: number): string {
  const n = Math.max(0, Math.trunc(animalCount));
  return `${n} ${n === 1 ? 'animal' : 'animales'}`;
}

/**
 * Etiqueta de fecha de inicio de la jornada SOLO si NO empezó hoy (R10.5: "fecha de inicio si startedAt no
 * es hoy"). Una jornada de hoy NO muestra fecha (es "la jornada de hoy", redundante); una que viene de
 * ayer/antes muestra la fecha corta es-AR ("12/06") para que el operario sepa que está reanudando algo viejo.
 *
 * Compara por DÍA CALENDARIO local (no por timestamp): `startedAt` es ISO (wall-clock del cliente al
 * crearla, sessions.ts). `now` es inyectable para testear determinísticamente. Devuelve null si:
 *   - startedAt es null/invalíd (no rompe: la tarjeta omite la fecha);
 *   - startedAt cae en el MISMO día calendario que `now` (= hoy → no se muestra).
 *
 * El formato lo da `formatDateCompactEsAr` (formato ÚNICO es-AR, anti-drift): dd/mm en el año corriente
 * (el caso normal de reanudar hoy/ayer) y dd/mm/aaaa si la jornada quedó abierta de otro año (más claro).
 */
export function resumeStartedDateLabel(startedAt: string | null, now: Date = new Date()): string | null {
  if (startedAt == null) return null;
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return null;
  if (isSameLocalDay(started, now)) return null;
  return formatDateCompactEsAr(startedAt, now);
}

/** ¿`a` y `b` caen en el mismo día calendario local? (año + mes + día). */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
