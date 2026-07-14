// scripts/lib/ledger-plan.mjs — lógica PURA del replay ordenado + diff-contra-ledger de
// apply-all-migrations.mjs (spec 16 Run B, B3 / R5.4/R5.5/R5.6). Sin red: solo ordena y planifica.

/** Prefijo numérico de 4 dígitos del filename de migración (`0125_health_status.sql` → 125). */
export function numericPrefix(filename) {
  const m = /^(\d{4})/.exec(filename);
  return m ? Number.parseInt(m[1], 10) : Number.POSITIVE_INFINITY; // sin prefijo → al final, determinístico
}

/** Ordena migraciones por prefijo numérico y, a igualdad, por filename (estable, R5.4). */
export function sortMigrations(files) {
  return [...files].sort((a, b) => {
    const na = numericPrefix(a);
    const nb = numericPrefix(b);
    if (na !== nb) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Planifica el catch-up incremental contra el ledger. PURA (R5.4/R5.5/R5.6).
 * @param {{files:string[], applied:Iterable<string>, backfill?:boolean}} p
 * @returns {{toApply: {filename:string, execute:boolean}[], toSkip: string[]}}
 *   - `toApply`: migraciones AUSENTES del ledger, en orden. `execute=false` en `--backfill` (registra
 *      sin ejecutar SQL — R5.6); `execute=true` en modo normal (ejecuta y registra — R5.4).
 *   - `toSkip`: migraciones YA en el ledger (idempotencia por release — R5.5).
 */
export function planMigrations({ files, applied, backfill = false }) {
  const appliedSet = new Set(applied);
  const sorted = sortMigrations(files);
  const toApply = [];
  const toSkip = [];
  for (const f of sorted) {
    if (appliedSet.has(f)) {
      toSkip.push(f);
      continue;
    }
    toApply.push({ filename: f, execute: !backfill });
  }
  return { toApply, toSkip };
}
