// provider.tsx — <PowerSyncProvider> por encima del árbol (T1.7 / R2.3).
//
// 1. Provee el DB local de PowerSync vía PowerSyncContext de @powersync/react → los hooks watchables
//    (useQuery, etc.) pueden suscribirse. (R2.3)
// 2. Orquesta connect/disconnect según la sesión Supabase: connect(connector) cuando el usuario está
//    authenticated + emailVerified (sesión válida → fetchCredentials devolverá token); disconnect()
//    en logout / sesión perdida. autoRefreshToken renueva el JWT vencido sin reconectar a mano (R3.2).
//
// La validación LIVE de la conexión (boot del DB WASM + sync real, T7.4) queda DIFERIDA hasta que se
// deployen las streams + esté la Instance URL en .env.local (disclaimer de la spec). El código queda
// wireado: monta sobre web hoy y sobre el dev build native mañana (factory por plataforma, database.ts).

import React, { useEffect, useMemo } from 'react';
import { PowerSyncContext } from '@powersync/react';
import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { useAuth } from '../../contexts';
import { getPowerSync } from './database';
import { SupabaseConnector } from './connector';

// Diagnóstico temporal (T3): conteos locales de tablas clave tras el primer sync. SOLO COUNT(*),
// JAMÁS el contenido (PII de user_private). Best-effort: un fallo de query no rompe nada.
// TODO(debug 15-powersync): quitar tras validar T3.
async function logFirstSyncCounts(db: AbstractPowerSyncDatabase): Promise<void> {
  const countOf = async (table: string): Promise<number | string> => {
    try {
      const rows = await db.getAll<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      return rows[0]?.n ?? 0;
    } catch {
      return 'err';
    }
  };
  const [establishments, categories, fields, rodeos, userPrivate] = await Promise.all([
    countOf('establishments'),
    countOf('categories_by_system'),
    countOf('field_definitions'),
    countOf('rodeos'),
    countOf('user_private'),
  ]);
  // eslint-disable-next-line no-console
  console.log(
    `[powersync] first sync done; local rows: establishments=${establishments}, ` +
      `categories_by_system=${categories}, field_definitions=${fields}, rodeos=${rodeos}, ` +
      `user_private=${userPrivate}`,
  );
}

export function PowerSyncProvider({ children }: { children: React.ReactNode }) {
  const { state: auth } = useAuth();
  const db = useMemo(() => getPowerSync(), []);
  const connector = useMemo(() => new SupabaseConnector(), []);

  // Sesión válida = authenticated + email verificado (mismo gate que el resto de la app antes de tocar
  // datos del establecimiento). Sin esto, fetchCredentials devolvería null y no habría sync.
  // emailVerified solo existe en el variant 'authenticated' de AuthState; narrow para no romper el type.
  const emailVerified = auth.status === 'authenticated' ? auth.emailVerified : false;
  const hasValidSession = auth.status === 'authenticated' && auth.emailVerified;

  useEffect(() => {
    // TODO(debug 15-powersync): quitar tras diagnosticar — traza el gate de sesión que decide connect/disconnect.
    // eslint-disable-next-line no-console
    console.log('[powersync] effect', {
      status: auth.status,
      emailVerified,
      hasValidSession,
    });
    if (hasValidSession) {
      // connect es idempotente del lado del SDK; si ya está conectado, no re-conecta. Best-effort:
      // un fallo de connect (sin red al boot) NO debe romper la UI — PowerSync reintenta solo.
      // TODO(debug 15-powersync): quitar tras diagnosticar.
      // eslint-disable-next-line no-console
      console.log('[powersync] connecting…');
      db.connect(connector).catch((err) => {
        // PERMANENTE (R10): un fallo de connect NUNCA debe tragarse en silencio — surface el error real
        // (si es el WASM de wa-sqlite, el mensaje lo va a mencionar). No rompe la UI; PowerSync reintenta.
        // eslint-disable-next-line no-console
        console.error('[powersync] connect FAILED:', err);
      });

      // Diagnóstico temporal del swap de lectura (T3): al completar el PRIMER sync, logueamos UNA vez
      // los CONTEOS locales de las tablas clave para confirmar que los datos bajaron a SQLite. NUNCA
      // se loguea contenido (PII de user_private: solo el COUNT). waitForFirstSync es API real del SDK.
      // TODO(debug 15-powersync): quitar tras validar T3.
      db.waitForFirstSync()
        .then(() => logFirstSyncCounts(db))
        .catch(() => {
          /* sin primer sync (offline/desconexión): el log de conteos no aplica, no es un error */
        });
    } else {
      // Logout / sesión perdida → cortar el sync. No borramos el DB local acá (el drop por scoping lo
      // maneja el sync set; el wipe en logout es decisión aparte, fuera de este run).
      // TODO(debug 15-powersync): quitar tras diagnosticar.
      // eslint-disable-next-line no-console
      console.log('[powersync] disconnect (no session)');
      db.disconnect().catch(() => {
        /* noop */
      });
    }
  }, [hasValidSession, db, connector, auth.status, emailVerified]);

  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>;
}
