// online-guard.ts — capa de I/O del fast-fail de las mutaciones ONLINE-only cuando el device está
// OFFLINE (fix UX/robustez, follow-up de spec 15).
//
// Regla de Raf: el camino de campo (animales/eventos/lotes/alta/parto/baja/crear-rodeo) es
// offline-first (outbox + overlay). Pero la identidad/admin (login/invitaciones/perfil/admin de
// campo/email) es ONLINE-only por spec (R9.2). Esas mutaciones llaman a `supabase.from(...).update/
// insert/delete` o `supabase.auth`/Edge directo; sin red, esas promesas NO resuelven rápido → la
// pantalla se queda colgada ("Guardando…" para siempre). En vez de colgar, FALLAMOS RÁPIDO con un
// error `kind:'network'` accionable ("Necesitás conexión") que la pantalla ya sabe mostrar.
//
// Este archivo importa `getPowerSync` (SDK, vía ./database → react-native) → NO debe entrar al grafo
// de node:test. La parte PURA testeable (`offlineError`) vive en online-guard-pure.ts; los tests
// importan SOLO de ahí. Acá re-exportamos `offlineError` por conveniencia para los call-sites que ya
// tienen una instancia de DB / leen `currentStatus.connected` por su cuenta (account.ts/members.ts).
//
// `currentStatus.connected` es la señal del socket de PowerSync (true sólo con conexión a la
// instancia). Offline → false. En una reconexión breve puede dar false momentáneamente → el usuario
// reintenta (aceptable; el costo es un reintento, no un cuelgue). No reemplaza a la RLS server-side.

import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { getPowerSync } from './database';
import { offlineError, type NetworkError } from './online-guard-pure';

export { offlineError };
export type { NetworkError };

/**
 * I/O: chequea la conexión de PowerSync ANTES de un write ONLINE-only. Si está OFFLINE, devuelve el
 * resultado de error que usan los services (`{ ok:false, error:{kind:'network', message} }`); si está
 * online, devuelve `null` (seguí con el call real).
 *
 * Uso (un return temprano al inicio de la mutación, antes del primer supabase/auth call):
 *
 *     const off = assertOnline('Necesitás conexión para editar tu perfil.');
 *     if (off) return off;
 *
 * @param db  inyectable para tests; por defecto la instancia singleton de PowerSync.
 */
export function assertOnline(
  message: string,
  db: AbstractPowerSyncDatabase = getPowerSync(),
): { ok: false; error: NetworkError } | null {
  const error = offlineError(db.currentStatus?.connected, message);
  return error ? { ok: false, error } : null;
}
