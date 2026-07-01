// use-reports.ts — hooks que orquestan `services/reports.ts` y exponen estado a la pantalla Reportes
// (spec 07 Stream C — FRONTEND, design §4, T5.4). Los hooks orquestan services (architecture.md); la
// pantalla consume el estado (loading/online/error/data). NO tocan I/O directo (eso es `reports.ts`).
//
// ONLINE-ONLY (R7.2): el service detecta offline ANTES de llamar la RPC → devuelve `{kind:'offline'}`. El
// hook lo expone como un estado `offline` claro (la pantalla muestra "necesitás conexión" + reintentar,
// R7.2.2/R7.2.4). Anti-parpadeo (conventions.md UI / design §4): el spinner que reemplaza el contenido se
// muestra SOLO en la primera carga sin datos (`loading && data === null`); al cambiar de rodeo/campaña el
// refresh NO blanquea el contenido previo (se mantiene montado hasta que llega el nuevo resultado).
//
// Recarga automática (R7.1.3): los efectos dependen del `rodeoId` + `year` (+ implícitamente del
// establecimiento, porque el rodeo activo cambia con el campo) → al cambiar cualquiera, se recarga y nunca
// se mezclan datos de un rodeo/campaña con otro (guard de secuencia descarta resultados viejos en vuelo).

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchPregnancyKpi,
  fetchCalvingKpi,
  fetchWeaningKpi,
  fetchCclDistribution,
  fetchCalvingByStage,
  fetchWeightByCategory,
  fetchOverdueDoses,
  fetchUnweighed,
  fetchRodeoSessions,
  fetchSessionSummary,
  type PregnancyKpi,
  type CalvingKpi,
  type WeaningKpi,
  type CclDistribution,
  type CalvingByStage,
  type WeightByCategory,
  type OverdueDose,
  type UnweighedAnimal,
  type SessionListItem,
  type SessionEventCount,
  type ReportError,
  type ReportResult,
} from '../services/reports';

// ─── Estado genérico de un reporte (anti-parpadeo) ──────────────────────────────────────────────────

export type ReportPhase<T> = {
  /** Datos del último resultado OK (se conservan durante un refresh → no se blanquea). null = nunca cargó. */
  data: T | null;
  loading: boolean;
  /** Error del último intento (offline/network/server/forbidden), o null. */
  error: ReportError | null;
  /** Re-dispara la carga (botón "reintentar", R7.2.4). */
  reload: () => void;
};

/**
 * Estado derivado para la UI: ¿mostrar el spinner full (primera carga sin datos)?, ¿el estado offline?,
 * ¿el estado de error reintentable? Centraliza la regla anti-parpadeo (loading && data===null) para que
 * todas las secciones la apliquen igual.
 */
export function reportView<T>(phase: ReportPhase<T>): {
  showSpinner: boolean;
  showOffline: boolean;
  showError: boolean;
} {
  const firstLoad = phase.loading && phase.data === null;
  const offline = !phase.loading && phase.error?.kind === 'offline' && phase.data === null;
  const errored =
    !phase.loading &&
    phase.error !== null &&
    phase.error.kind !== 'offline' &&
    phase.data === null;
  return { showSpinner: firstLoad, showOffline: offline, showError: errored };
}

// ─── Hook genérico de UN reporte ────────────────────────────────────────────────────────────────────

/**
 * Orquesta la carga de UN reporte. `fetcher` es estable (envuelto en useCallback por el caller con sus
 * deps); cuando cambia, re-carga. Guard de secuencia: un resultado de una carga vieja (rodeo/año previo)
 * se descarta si llegó tarde. `enabled=false` → no carga (ej. rodeo sin elegir): queda en `data:null,
 * loading:false`. Anti-parpadeo: NO blanquea `data` al re-cargar (solo togglea `loading`).
 */
function useReport<T>(
  fetcher: (() => Promise<ReportResult<T>>) | null,
): ReportPhase<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(fetcher !== null);
  const [error, setError] = useState<ReportError | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    if (!fetcher) {
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    const r = await fetcher();
    // Descartamos un resultado de una carga superada (cambió rodeo/año mientras estaba en vuelo).
    if (seq !== seqRef.current) return;
    setLoading(false);
    if (r.ok) {
      setData(r.value);
      return;
    }
    // Anti-parpadeo: en error NO borramos `data` (si había contenido previo, se conserva). La regla de
    // mostrar offline/error la decide `reportView` (solo full-state cuando data===null).
    setError(r.error);
  }, [fetcher]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload };
}

// ─── KPIs del rodeo (preñez + parición + CCL + cruce + peso) ────────────────────────────────────────

export type RodeoKpis = {
  pregnancy: ReportPhase<PregnancyKpi | null>;
  calving: ReportPhase<CalvingKpi | null>;
  weaning: ReportPhase<WeaningKpi | null>;
  ccl: ReportPhase<CclDistribution | null>;
  calvingByStage: ReportPhase<CalvingByStage | null>;
  weight: ReportPhase<WeightByCategory[]>;
};

/**
 * Carga los 6 reportes de un rodeo+campaña (R7.5–R7.9 + delta #10 destete). Cada uno es independiente (un
 * fallo de destete no tumba %preñez). `rodeoId`/`year` null → todos deshabilitados (rodeo sin elegir).
 * Recarga al cambiar rodeo/año (R7.1.3/R7.5.7). Los fetchers se memoizan por (rodeoId, year) → estables.
 */
export function useRodeoKpis(rodeoId: string | null, year: number | null): RodeoKpis {
  const ready = rodeoId !== null && year !== null;

  const pregnancyFetcher = useCallback(
    () => fetchPregnancyKpi(rodeoId as string, year as number),
    [rodeoId, year],
  );
  const calvingFetcher = useCallback(
    () => fetchCalvingKpi(rodeoId as string, year as number),
    [rodeoId, year],
  );
  const weaningFetcher = useCallback(
    () => fetchWeaningKpi(rodeoId as string, year as number),
    [rodeoId, year],
  );
  const cclFetcher = useCallback(
    () => fetchCclDistribution(rodeoId as string, year as number),
    [rodeoId, year],
  );
  const stageFetcher = useCallback(
    () => fetchCalvingByStage(rodeoId as string, year as number),
    [rodeoId, year],
  );
  const weightFetcher = useCallback(
    () => fetchWeightByCategory(rodeoId as string),
    [rodeoId],
  );

  return {
    pregnancy: useReport(ready ? pregnancyFetcher : null),
    calving: useReport(ready ? calvingFetcher : null),
    weaning: useReport(ready ? weaningFetcher : null),
    ccl: useReport(ready ? cclFetcher : null),
    calvingByStage: useReport(ready ? stageFetcher : null),
    weight: useReport(ready ? weightFetcher : null),
  };
}

// ─── Alertas del establecimiento (dosis vencida + sin pesar) ────────────────────────────────────────

export type EstablishmentAlerts = {
  overdue: ReportPhase<OverdueDose[]>;
  unweighed: ReportPhase<UnweighedAnimal[]>;
};

/**
 * Carga las 2 alertas del establecimiento (R7.10/R7.11). `establishmentId` null → deshabilitadas. Recarga
 * al cambiar de establecimiento (R7.1.3). `categoryCodes` (alcance sin-pesar, [SUPUESTO]/Facundo) se pasa
 * tal cual; null = todas las categorías (default server).
 */
export function useEstablishmentAlerts(
  establishmentId: string | null,
  opts?: { unweighedCategoryCodes?: string[] | null },
): EstablishmentAlerts {
  const codes = opts?.unweighedCategoryCodes;

  const overdueFetcher = useCallback(
    () => fetchOverdueDoses(establishmentId as string),
    [establishmentId],
  );
  const unweighedFetcher = useCallback(
    () =>
      fetchUnweighed(establishmentId as string, codes !== undefined ? { categoryCodes: codes } : undefined),
    [establishmentId, codes],
  );

  return {
    overdue: useReport(establishmentId ? overdueFetcher : null),
    unweighed: useReport(establishmentId ? unweighedFetcher : null),
  };
}

// ─── Lista de sesiones de un rodeo (R7.3.6) ─────────────────────────────────────────────────────────

export function useRodeoSessions(rodeoId: string | null): ReportPhase<SessionListItem[]> {
  const fetcher = useCallback(() => fetchRodeoSessions(rodeoId as string), [rodeoId]);
  return useReport(rodeoId ? fetcher : null);
}

// ─── Resumen de UNA sesión (R7.3.1) ──────────────────────────────────────────────────────────────────

export function useSessionSummary(sessionId: string | null): ReportPhase<SessionEventCount[]> {
  const fetcher = useCallback(() => fetchSessionSummary(sessionId as string), [sessionId]);
  return useReport(sessionId ? fetcher : null);
}
