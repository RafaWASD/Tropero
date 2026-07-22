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

import React, { useEffect, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { PowerSyncContext } from '@powersync/react';
import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { useAuth } from '../../contexts';
import { getPowerSync } from './database';
import { SupabaseConnector } from './connector';
import { subscribeSyncDiagnostics } from './status';

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

  // spec 22 (a) — LIVENESS de la conexión de descarga. Los listeners de NetInfo/AppState viven en un efecto
  // separado que se suscribe UNA vez (deps estables db/connector) y lee la sesión vigente por REF (fresco sin
  // re-suscribir → cleanup StrictMode-safe simple). `reconnectingRef` es el guard de reentrada (patrón
  // `reconnectScheduled` de adapter-web-serial.ts:158): impide apilar disconnect/connect concurrentes cuando
  // varios triggers llegan juntos (NetInfo + AppState, o el doble-mount de StrictMode). R22.4/R22.8.
  const reconnectingRef = useRef(false);
  const hasValidSessionRef = useRef(hasValidSession);
  hasValidSessionRef.current = hasValidSession;

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

  // spec 22 (a) — RECONEXIÓN / REVALIDACIÓN de la descarga (RC-1). El gate de sesión de arriba conecta UNA
  // vez al login; si el socket de descarga se cuelga (típico en nativo al volver de background o tras un blip
  // de red), nadie lo reengancha → los cambios del server (incl. el eco del propio write) no bajan hasta un
  // cold start. Este efecto suscribe:
  //   · NetInfo `offline→online` (R22.1/R22.6): asegura la conexión (connect idempotente) SIN teardown. Sin
  //     red = sin intentos (solo actúa en la transición a con-red). No agrega loop propio (el SDK reintenta).
  //   · AppState `background→active` (R22.2/R22.3/R22.9): en NATIVO fuerza `disconnect()`+`connect()` (teardown
  //     del socket zombie — connect() es idempotente y NO reengancha un socket colgado-pero-no-cerrado); en
  //     WEB solo `ensure` idempotente (sin teardown agresivo, que causaría resyncs espurios / rompería la E2E).
  // Deps estables (db/connector memoizados) → el efecto corre una vez; el cleanup libera AMBOS listeners de
  // forma idempotente (dispose devuelto), StrictMode-safe (R22.5). La sesión se lee por ref (R22.8: nunca
  // conecta sin sesión válida). El refresh de token queda cubierto por fetchCredentials + esta revalidación
  // de foreground (R22.7).
  useEffect(() => {
    // Reconexión con guard de reentrada. `teardown` = matar el socket antes de reconectar (nativo foreground).
    const reconnect = async (teardown: boolean): Promise<void> => {
      if (reconnectingRef.current) return; // ya hay una reconexión en curso (R22.4)
      if (!hasValidSessionRef.current) return; // sin sesión válida no se conecta (R22.8)
      reconnectingRef.current = true;
      try {
        if (teardown) {
          await db.disconnect(); // teardown real del socket zombie (R22.2/R22.3)
        }
        await db.connect(connector);
      } catch (err) {
        // Un fallo de reconexión NO rompe la UI; el SDK reintenta solo. Se surface (no se traga).
        // eslint-disable-next-line no-console
        console.error('[powersync][liveness] reconnect FAILED:', err);
      } finally {
        // Libera el guard SIEMPRE — incluso si connect/disconnect throwean (si no, quedaría trabado).
        reconnectingRef.current = false;
      }
    };

    // ensure: conectar solo si NO está ya conectado NI conectando (idempotente). El `connecting` evita
    // correr contra el connect inicial del efecto de sesión al bootear (NetInfo dispara al suscribirse).
    const ensureConnected = (): void => {
      if (db.connected || db.connecting) return;
      void reconnect(false);
    };

    // NetInfo dispara con el estado ACTUAL al suscribirse y luego en cada cambio. Solo actuamos en con-red
    // (offline→online): sin red no intentamos nada (R22.6) — no hay loop propio.
    const netInfoUnsub = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (!online) return;
      ensureConnected();
    });

    // AppState 'change' NO dispara al suscribirse (solo en transiciones reales) → sin race de boot.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (Platform.OS === 'web') {
        ensureConnected(); // web: sin teardown agresivo (R22.9)
      } else {
        void reconnect(true); // nativo: teardown+reconnect (mata el zombie, R22.2/R22.3)
      }
    });

    return () => {
      netInfoUnsub(); // dispose idempotente de NetInfo (R22.5)
      appStateSub.remove(); // dispose idempotente de AppState (R22.5)
    };
  }, [db, connector]);

  // spec 22 — INSTRUMENTACIÓN de diagnóstico (R22.23/R22.24). Loguea los flags de liveness en cada
  // statusChanged para confirmar en DEVICE que la descarga reengancha tras los triggers de (a). Desactivable
  // por const de módulo (status.ts), sin PII. Cleanup del listener al desmontar.
  useEffect(() => {
    const dispose = subscribeSyncDiagnostics(db);
    return () => dispose();
  }, [db]);

  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>;
}
