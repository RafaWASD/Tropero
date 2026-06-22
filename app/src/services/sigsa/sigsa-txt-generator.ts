// Generador PURO del TXT de declaración de dispositivos SIGSA (spec 08, T9).
//
// Inverso EXACTO de app/src/utils/import/parse-sigsa-txt.ts: produce el mismo wire format
// que ese parser lee. Sin I/O, sin efectos, sin imports de PowerSync/Supabase/expo — corre
// bajo node:test (mismo patrón que parser-rs420.ts / src/utils/*).
//
// Wire format (CONFIRMED — manual oficial SENASA SIGSA v2.42.80, ver
// specs/active/08-export-sigsa/razas-senasa-codigos.md §"Formato del archivo TXT"):
//
//   {RFID}-{SEXO}-{RAZA}-{MM/AAAA}  ; ...   (registros separados por ';', campos por '-')
//
//   e.g. 032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025;032010000000002-M-B-08/2025
//          ^^^^^^^^^^^^^^^                  RFID = 15 dígitos numéricos
//                          ^                SEXO = M | H
//                            ^              RAZA = código SENASA (Tabla 1, grafía literal)
//                              ^^^^^^^      MM/AAAA = mes 2 dígitos / año 4 dígitos
//
// ⚠ GATE DURO (R6.3): el `;` final NO está confirmado con upload real → `trailingSemicolon`
// (default false). UTF-8 sin BOM (R5.6): este módulo devuelve un string JS plano; quien lo
// escriba a disco NO debe anteponer BOM. No incluye RENSPA/especie/fecha-aplicación (R5.5).
//
// Validación de raza (R6.5): el código DEBE estar en el catálogo oficial. Reusamos
// isKnownBreedCode de import/breed-senasa.ts (la MISMA tabla de 32 códigos) — NO re-sembramos
// ni inventamos códigos. El generador LANZA ante datos inválidos (RFID no-15-dígitos, raza
// vacía o desconocida, MM/AAAA mal formado): la validación pre-export (sigsa-validator.ts) ya
// debió filtrar esos animales; si igual llega uno malo, fail-closed (mejor lanzar que emitir
// un TXT que SIGSA rechace o, peor, que mis-declare una raza).

import { isKnownBreedCode } from '../../utils/import/breed-senasa';
import type { AnimalExportRecord, SigsaTxtOptions } from './types';

/** RFID = 15 dígitos numéricos GENÉRICOS (igual que RFID_RE en parse-sigsa-txt.ts).
 *  NO se exige prefijo 982 (Allflex): los TAG argentinos válidos usan prefijo 032
 *  (el ejemplo oficial del manual es 032010000000000). Para SIGSA solo importa "15 dígitos". */
const RFID_RE = /^\d{15}$/;

/** MM/AAAA: mes 01-12 con cero a la izquierda, año de 4 dígitos (R6.4). */
const MONTH_YEAR_RE = /^(0[1-9]|1[0-2])\/\d{4}$/;

/**
 * Genera el contenido del TXT SIGSA a partir de registros YA validados y normalizados (R5.1, R6.1).
 *
 * - Une los registros con `;` sin espacios (R6.2).
 * - `trailingSemicolon` (default false, R6.3): si true, agrega un `;` al final.
 * - Lanza si algún `rfid` no son 15 dígitos numéricos (R8.6, fail-closed).
 * - Lanza si algún `breedCode` está vacío o no está en el catálogo oficial (R6.5).
 * - Lanza si `birthMonthYear` no respeta MM/AAAA con mes 2 dígitos (R6.4).
 * - Lista vacía → string vacío (sin `;` aunque trailingSemicolon sea true: no hay registros).
 *
 * Puro: no lee disco, no toca red, no muta los inputs. El string resultante es UTF-8 sin BOM
 * por construcción (es un string JS; el caller que lo escriba NO debe anteponer BOM, R5.6).
 */
export function generateSigsaTxt(
  records: AnimalExportRecord[],
  options: SigsaTxtOptions = {},
): string {
  if (!Array.isArray(records)) {
    throw new TypeError('generateSigsaTxt: se esperaba un array de AnimalExportRecord');
  }

  const trailingSemicolon = options.trailingSemicolon ?? false;

  // Lista vacía → string vacío. No emitimos un `;` solitario aunque trailingSemicolon sea true:
  // un TXT con solo `;` no representa ningún registro y SIGSA no tiene qué importar.
  if (records.length === 0) {
    return '';
  }

  const parts = records.map((rec, i) => formatRecord(rec, i));
  const body = parts.join(';');
  return trailingSemicolon ? `${body};` : body;
}

/** Formatea UN registro a `{RFID}-{SEXO}-{RAZA}-{MM/AAAA}`, validando fail-closed (nunca emite basura). */
function formatRecord(rec: AnimalExportRecord, index: number): string {
  // Defensa contra inputs malformados (null/undefined campos): la capa de validación debió
  // entregar registros completos; si no, lanzamos con el índice para diagnóstico.
  if (rec == null) {
    throw new Error(`generateSigsaTxt: registro #${index} es null/undefined`);
  }

  const rfid = typeof rec.rfid === 'string' ? rec.rfid.trim() : '';
  if (!RFID_RE.test(rfid)) {
    // R8.6 — RFID debe ser exactamente 15 dígitos numéricos (genérico, no prefijo 982).
    throw new Error(
      `generateSigsaTxt: RFID inválido en registro #${index} (se esperan 15 dígitos): ${JSON.stringify(rec.rfid)}`,
    );
  }

  if (rec.sex !== 'M' && rec.sex !== 'H') {
    // SEXO ya debe venir mapeado a 'M'/'H' por el validador. Cualquier otra cosa es un bug aguas arriba.
    throw new Error(
      `generateSigsaTxt: SEXO inválido en registro #${index} (se espera 'M' o 'H'): ${JSON.stringify(rec.sex)}`,
    );
  }

  const breedCode = typeof rec.breedCode === 'string' ? rec.breedCode.trim() : '';
  if (breedCode.length === 0) {
    // R6.5 / T9 test f — raza vacía no se exporta (el animal debió quedar como incomplete).
    throw new Error(`generateSigsaTxt: código de raza vacío en registro #${index}`);
  }
  if (!isKnownBreedCode(breedCode)) {
    // R6.5 — el implementer NO inventa códigos; si no está en el catálogo oficial, es un error.
    // Usamos la grafía exacta del catálogo (no uppercaseamos: SIGSA valida case-exacto, ej. 'S/E').
    throw new Error(
      `generateSigsaTxt: código de raza desconocido en registro #${index}: ${JSON.stringify(rec.breedCode)} (no está en el catálogo SENASA oficial)`,
    );
  }

  const birthMonthYear = typeof rec.birthMonthYear === 'string' ? rec.birthMonthYear.trim() : '';
  if (!MONTH_YEAR_RE.test(birthMonthYear)) {
    // R6.4 — mes en 2 dígitos con cero a la izquierda ('08' no '8'), año de 4 dígitos.
    throw new Error(
      `generateSigsaTxt: fecha MM/AAAA inválida en registro #${index} (ej. '08/2025'): ${JSON.stringify(rec.birthMonthYear)}`,
    );
  }

  return `${rfid}-${rec.sex}-${breedCode}-${birthMonthYear}`;
}
