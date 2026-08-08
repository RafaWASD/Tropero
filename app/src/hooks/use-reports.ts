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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  fetchCampaignStatus,
  closeCampaign,
  reopenCampaign,
  type CampaignStatus,
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
import { campaignStateView } from '../utils/reports-format';

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

// ─── Delta CAMPAÑAS CONGELADAS: estado + cierre + reapertura + cierre masivo ─────────────────────────

/** Un rodeo del campo, para el cierre masivo (RCC.10.6). Lo provee la pantalla desde `RodeoContext`. */
export type CampaignRodeoRef = { id: string; name: string };

/** Resultado del cierre masivo, por rodeo (RCC.5.10 / RCC.10.6): la falla parcial es VISIBLE. */
export type BulkCloseResult = {
  /** Nombres de los rodeos que quedaron cerrados. */
  ok: string[];
  /** Rechazados por CICLO INCOMPLETO (G3, reconocible): se listan con lo que les falta y se re-intentan. */
  incomplete: { id: string; name: string; missing: string[] }[];
  /** Rechazados por cualquier otra causa (G1/G2/permiso/red): NO se re-intentan con reconocimiento. */
  failed: { name: string; message: string }[];
};

/**
 * El estado ETIQUETADO con la clave `(rodeoId|year)` que lo produjo. Sin esta etiqueta, el `data` retenido
 * por el anti-parpadeo de `useReport` se muestra como si fuera el de la campaña que el usuario acaba de
 * elegir — ver el comentario de `useCampaignStatus`.
 */
type KeyedCampaignStatus = { key: string; value: CampaignStatus | null };

export type CampaignController = {
  status: ReportPhase<CampaignStatus | null>;
  /** true mientras corre una acción de escritura (deshabilita los botones). */
  busy: boolean;
  /** Error de la última acción de escritura (no de la carga del estado). */
  actionError: ReportError | null;
  closeAction: (acknowledgeIncomplete: boolean) => Promise<ReportResult<string | null>>;
  reopenAction: () => Promise<ReportResult<string | null>>;
  closeAllAction: (rodeos: CampaignRodeoRef[], acknowledgeIncomplete: boolean) => Promise<BulkCloseResult>;
};

/**
 * Estado de la campaña + las acciones de escritura (RCC.7.6, RCC.10.1, RCC.5.10).
 *
 * `onChanged` lo llama la pantalla para recargar los 6 KPI además del estado: una campaña recién cerrada
 * pasa a leerse del snapshot, y los números tienen que coincidir con los que estaban en pantalla — si no
 * coincidieran, se ve en el acto (que es exactamente lo que queremos que pase).
 *
 * El cierre masivo NO usa una RPC de establecimiento (DP-11): itera los rodeos que la pantalla ya tiene en
 * `RodeoContext` y llama N veces, cada una re-guardada server-side. Evita una segunda superficie IDOR con
 * `p_establishment_id` del cliente y hace la falla parcial visible ("se cerraron 3 de 4").
 */
export function useCampaignStatus(
  rodeoId: string | null,
  year: number | null,
  onChanged?: () => void,
): CampaignController {
  const ready = rodeoId !== null && year !== null;
  const key = `${rodeoId ?? ''}|${year ?? ''}`;

  // ── LA ETIQUETA NO SOBREVIVE A UN CAMBIO DE (rodeo, año) ────────────────────────────────────────────
  // `useReport` NO blanquea `data` al cambiar de fetcher: es anti-parpadeo, y para los NÚMEROS está bien
  // (mostrar los de la campaña anterior un instante mientras llegan los nuevos es preferible a un salto en
  // blanco). Para la etiqueta que los CALIFICA está mal: el `data` retenido pertenece a OTRA campaña, así
  // que al cambiar de año la barra afirmaba "Campaña cerrada · Foto del 14/03/2026" sobre los números de una
  // campaña abierta. Se resuelve sin tocar el hook genérico: el resultado viaja ETIQUETADO con la clave que
  // lo produjo, y acá se descarta si no es la clave vigente → `campaignStateView(null)` → estado
  // `desconocido`, que no afirma nada.
  const fetcher = useCallback(async (): Promise<ReportResult<KeyedCampaignStatus>> => {
    const r = await fetchCampaignStatus(rodeoId as string, year as number);
    if (!r.ok) return r;
    return { ok: true, value: { key: `${rodeoId ?? ''}|${year ?? ''}`, value: r.value } };
  }, [rodeoId, year]);
  const phase = useReport<KeyedCampaignStatus>(ready ? fetcher : null);
  const status: ReportPhase<CampaignStatus | null> = useMemo(
    () => ({
      data: phase.data && phase.data.key === key ? phase.data.value : null,
      loading: phase.loading,
      error: phase.error,
      reload: phase.reload,
    }),
    [phase.data, phase.loading, phase.error, phase.reload, key],
  );

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ReportError | null>(null);

  const afterWrite = useCallback(
    (r: ReportResult<string | null>) => {
      if (r.ok) {
        setActionError(null);
        status.reload();
        onChanged?.();
      } else {
        setActionError(r.error);
      }
      return r;
    },
    [status, onChanged],
  );

  const closeAction = useCallback(
    async (acknowledgeIncomplete: boolean) => {
      if (!ready) return { ok: false as const, error: { kind: 'server' as const, message: 'Sin campaña seleccionada.' } };
      setBusy(true);
      try {
        // `acknowledgeIncomplete` viaja explícito hasta la RPC: no hay default en ningún eslabón (§7.1).
        return afterWrite(await closeCampaign(rodeoId as string, year as number, acknowledgeIncomplete));
      } finally {
        setBusy(false);
      }
    },
    [ready, rodeoId, year, afterWrite],
  );

  const reopenAction = useCallback(async () => {
    if (!ready) return { ok: false as const, error: { kind: 'server' as const, message: 'Sin campaña seleccionada.' } };
    setBusy(true);
    try {
      return afterWrite(await reopenCampaign(rodeoId as string, year as number));
    } finally {
      setBusy(false);
    }
  }, [ready, rodeoId, year, afterWrite]);

  const closeAllAction = useCallback(
    async (rodeos: CampaignRodeoRef[], acknowledgeIncomplete: boolean): Promise<BulkCloseResult> => {
      const out: BulkCloseResult = { ok: [], incomplete: [], failed: [] };
      if (year === null) return out;
      setBusy(true);
      try {
        for (const r of rodeos) {
          const res = await closeCampaign(r.id, year, acknowledgeIncomplete);
          if (res.ok) {
            out.ok.push(r.name);
            continue;
          }
          if (res.error.kind !== 'conflict') {
            out.failed.push({ name: r.name, message: res.error.message });
            continue;
          }
          // `conflict` = 23514, y los TRES gates duros usan ese código. Lo RECONOCIBLE se distingue por
          // `canClose` + `cycleComplete` del estado (§5.C), NUNCA parseando el texto del error: si
          // `canClose` es falso, el rechazo vino de G1 (el servicio no terminó) o G2 (no hay hembras
          // servidas) y NO hay reintento posible — meterlo en `incomplete` haría que la segunda pasada
          // vuelva a fallar y entrenaría al usuario a clickear el reconocimiento.
          const st = await fetchCampaignStatus(r.id, year);
          const s = st.ok ? st.value : null;
          if (s && s.canClose && !s.cycleComplete) {
            out.incomplete.push({
              id: r.id,
              name: r.name,
              missing: campaignStateView(s).missing,
            });
          } else {
            out.failed.push({ name: r.name, message: res.error.message });
          }
        }
        status.reload();
        onChanged?.();
        return out;
      } finally {
        setBusy(false);
      }
    },
    [year, status, onChanged],
  );

  return { status, busy, actionError, closeAction, reopenAction, closeAllAction };
}
