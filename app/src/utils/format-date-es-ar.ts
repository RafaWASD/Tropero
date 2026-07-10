// format-date-es-ar.ts — formateo ÚNICO de fechas para MOSTRAR al usuario, en formato argentino
// dd/mm/aaaa (contextual dd/mm cuando el año es obvio). PURO (sin RN, sin red, sin SDK): testeable con
// node:test. Corrección cross-cutting aprobada por Raf (2026-07): centraliza el display de fechas para
// que no queden ISO crudos ("2026-06-07") ni meses abreviados ("15 abr") sueltos por la app.
//
// Espeja el precedente del formato numérico es-AR (coma decimal / punto miles): un único módulo puro de
// presentación, sin tocar los formatos de MÁQUINA (SIGSA/CSV/DB/RPC son ISO por diseño).
//
// ⚠️ TZ-SAFETY (lección del rojo e2e 777): para una fecha DATE-ONLY (`AAAA-MM-DD`, columna Postgres
// `date`) NO se usa `new Date(iso)` — parsea como UTC-medianoche y en huso local (AR, UTC-3) corre −1 día.
// Se formatea por MANIPULACIÓN DE STRING (split del prefijo ISO → reordenar). Para un INSTANTE real
// (timestamptz con hora, ej. `started_at`/`generated_at` = `now()`), sí se usa `new Date` + getters
// LOCALES: el día calendario que el operario espera ver es el LOCAL (mismo criterio que el path
// no-dateOnly de `formatEventDate` en event-timeline.ts).
//
// NOTA: los valores date-only que la RPC animal_timeline castea a UTC-medianoche
// (`2026-06-02T00:00:00+00:00`) NO pasan por este util — los formatea `formatEventDate` con su flag
// `dateOnly` (getters UTC). Este util recibe date-only CRUDO (`AAAA-MM-DD`) o instantes reales.

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Extrae {año, mes, día} de un ISO de forma TZ-SAFE, distinguiendo date-only de instante real:
 *   - `AAAA-MM-DD` puro (sin componente horario) → se toman los componentes por STRING (el día
 *     calendario que el usuario tipeó; NUNCA `new Date`, que driftea −1 día en husos al oeste de UTC).
 *   - con componente horario (`...T...`, instante real / timestamptz) → `new Date` + getters LOCALES
 *     (el día calendario LOCAL del dispositivo, lo que el operario llama "hoy").
 * null / vacío / no parseable → null. `mm`/`dd` ya vienen zero-padded a 2 dígitos; `y` es número.
 */
function dateParts(iso: string | null | undefined): { y: number; mm: string; dd: string } | null {
  if (iso == null) return null;
  const s = String(iso).trim();
  if (s.length === 0) return null;

  // Date-only puro (`AAAA-MM-DD`): extracción por string, sin `new Date` (tz-safe).
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    return { y: Number(dateOnly[1]), mm: dateOnly[2], dd: dateOnly[3] };
  }

  // Instante real (con hora): día calendario LOCAL del dispositivo.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return { y: d.getFullYear(), mm: pad2(d.getMonth() + 1), dd: pad2(d.getDate()) };
}

/**
 * Fecha es-AR completa `dd/mm/aaaa` para mostrar al usuario (ej. '2026-06-07' → '07/06/2026').
 * null / undefined / vacío / no parseable → '—' (nunca "null", nunca ISO crudo). Para date-only usa
 * formateo por string (tz-safe); para instantes usa el día LOCAL (ver `dateParts`).
 */
export function formatDateEsAr(iso: string | null | undefined): string {
  const p = dateParts(iso);
  if (!p) return '—';
  return `${p.dd}/${p.mm}/${p.y}`;
}

/**
 * Fecha es-AR CONTEXTUAL: `dd/mm` cuando el año del `iso` == año de `now` (el año es obvio), si no
 * `dd/mm/aaaa`. Para displays donde el año suele ser el corriente (invitaciones, retomar la jornada).
 * `now` es inyectable para tests deterministas. null / inválido → '—'.
 */
export function formatDateCompactEsAr(iso: string | null | undefined, now: Date = new Date()): string {
  const p = dateParts(iso);
  if (!p) return '—';
  if (p.y === now.getFullYear()) return `${p.dd}/${p.mm}`;
  return `${p.dd}/${p.mm}/${p.y}`;
}

/**
 * Fecha + hora es-AR `dd/mm/aaaa · HH:MM` para un INSTANTE real (timestamptz con hora, ej.
 * `export_log.generated_at`). Usa getters LOCALES (el instante en la hora del dispositivo). Sin
 * segundos (ruido). null / undefined / vacío / no parseable → '—'.
 */
export function formatDateTimeEsAr(iso: string | null | undefined): string {
  if (iso == null) return '—';
  const s = String(iso).trim();
  if (s.length === 0) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  const date = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${date} · ${time}`;
}
