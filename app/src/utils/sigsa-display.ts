// sigsa-display.ts — lógica PURA de presentación de la UI de exportación SIGSA (spec 08, T14/T15/T16).
//
// Sin React, sin RN, sin I/O: toma datos crudos y devuelve strings/labels para la pantalla. Testeable
// en Node nativo (run-tests.mjs). Aísla las 3 piezas con bordes (formato del RFID legible, labels de
// los motivos faltantes, fecha del historial) para que la pantalla quede declarativa y las reglas se
// testeen sin montar componentes.

import type { ExportValidationReason } from '../services/sigsa/types';
import { formatDateTimeEsAr } from './format-date-es-ar';

// ─── RFID legible (R12.1 / design §"ExportAnimalRow") ────────────────────────────────────────────────

/**
 * Formatea un RFID de 15 dígitos como TAG legible para la fila: primeros 6 + "·" + últimos 4
 * (`032010·0000` para `032010000000000`). El bloque del medio se elide: el operario reconoce el
 * dispositivo por su prefijo de país/fabricante (032… AR) y el sufijo único — los 5 dígitos del medio
 * son ruido visual a pleno sol. NO valida (el validador ya separó exportables); solo presenta.
 *
 * Casos borde:
 *   - null/vacío → "Sin caravana" (no debería llegar a un exportable, pero la fila "a completar" sí
 *     puede mostrarlo si el motivo es missing_rfid).
 *   - longitud != 15 (RFID inválido, motivo invalid_rfid): se muestra TAL CUAL (no se enmascara un
 *     valor que el usuario tiene que corregir — ver el valor completo ayuda a entender por qué falla).
 */
export function formatRfidMasked(rfid: string | null | undefined): string {
  const v = (rfid ?? '').trim();
  if (v.length === 0) return 'Sin caravana';
  if (v.length !== 15) return v; // inválido → se muestra completo (el usuario lo va a corregir)
  return `${v.slice(0, 6)}·${v.slice(-4)}`;
}

// ─── Labels de los motivos faltantes (R8.3) ──────────────────────────────────────────────────────────

/** Label es-AR de un único motivo de "a completar" (R8.2/R8.3). */
export function incompleteReasonLabel(reason: ExportValidationReason): string {
  switch (reason) {
    case 'missing_rfid':
      return 'Falta la caravana electrónica';
    case 'invalid_rfid':
      return 'Caravana electrónica inválida';
    case 'missing_birth_date':
      return 'Falta la fecha de nacimiento';
    case 'missing_breed':
      return 'Falta la raza';
    default:
      // exhaustividad: si se agrega un motivo nuevo al type y no se mapea acá, TS lo marca arriba.
      return 'Datos incompletos';
  }
}

/**
 * Labels de TODOS los motivos de un animal "a completar", en el orden en que vienen (R8.3 — "el o los
 * datos faltantes", plural). Dedup defensivo (el validador no debería repetir, pero un set evita un
 * label duplicado si dos chequeos colapsaran al mismo motivo). Vacío → [] (la fila no muestra motivos).
 */
export function incompleteReasonLabels(reasons: ExportValidationReason[]): string[] {
  const seen = new Set<ExportValidationReason>();
  const out: string[] = [];
  for (const r of reasons) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(incompleteReasonLabel(r));
  }
  return out;
}

// ─── Fecha del historial (R10.1 / R12.2) ─────────────────────────────────────────────────────────────

/**
 * Fecha + hora es-AR de una entrada del historial de exports (`export_log.generated_at`, timestamptz). El
 * productor reconoce "cuándo lo generé" → dd/mm/aaaa · HH:MM (hora:minuto, sin segundos ruidosos). Delega
 * en `formatDateTimeEsAr` (formato ÚNICO es-AR, zona local del dispositivo). null / fecha inválida →
 * "Sin fecha" (copy específico de esta pantalla; no se inventa una fecha).
 */
export function exportLogDateLabel(generatedAtIso: string | null | undefined): string {
  const s = formatDateTimeEsAr(generatedAtIso);
  return s === '—' ? 'Sin fecha' : s;
}

/**
 * Texto de cantidad de animales de una entrada de historial (singular/plural es-AR). El conteo es el
 * dato duro de "qué exporté" (R12.2). 1 → "1 animal"; N → "N animales".
 */
export function animalCountLabel(count: number): string {
  const n = Math.max(0, Math.trunc(count));
  return n === 1 ? '1 animal' : `${n} animales`;
}
