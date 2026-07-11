// Capa de datos del ciclo de TRATAMIENTOS del animal (spec 02 delta tratamientos, RTR.1/2/3/9).
//
// Service DELGADO y SWAPPABLE (espeja events.ts): mismo ServiceResult<T>/AppError. Capa de ESTADO sobre
// sanitary_events — `treatments` (header, ciclo started_at→ended_at) + aplicaciones = sanitary_events
// linkeadas por treatment_id. "En tratamiento" = DERIVADO (existe un treatment del animal con ended_at NULL).
//
// ESCRITURA OFFLINE — CRUD plano (RTR.8): startTreatment / registerApplication / finalizeTreatment son INSERT/
// UPDATE LOCALES sobre las tablas SINCRONIZADAS (treatments / sanitary_events) vía runLocalWrite. PowerSync
// encola UNA CrudEntry → uploadData la sube al reconectar (RLS + triggers + CHECKs re-validan). El write local
// SIEMPRE tiene éxito offline → el service devuelve ok apenas la fila está en SQLite; el rechazo REAL (RLS/
// CHECK/tenant-check) lo maneja uploadData (superficia por el canal de status, NO por el return, RTR.8.5).
//
// id de CLIENTE (crypto.randomUUID). established_by/created_by/establishment_id los FUERZA el trigger server-
// side al subir → NO se mandan en el INSERT local. `started_at` = wall-clock de cliente (offline, criterio 7).
// `event_type` de la aplicación se deriva del `kind` del tratamiento (RTR.2.2, treatmentEventType).

import { treatmentEventType } from '../utils/treatment-input';
import {
  buildStartTreatmentInsert,
  buildRegisterApplicationInsert,
  buildFinalizeTreatmentUpdate,
  buildAnimalTreatmentsQuery,
  buildTreatmentApplicationsQuery,
} from './powersync/local-reads';
import { runLocalQuery, runLocalWrite } from './powersync/local-query';

// ─── Error / Result uniforme (mismo shape que events.ts) ────────────────────────────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

// ─── Tipos de dominio ────────────────────────────────────────────────────────────────────────

/** Una APLICACIÓN de un tratamiento (sanitary_event linkeado) — RTR.9.3. */
export type TreatmentApplication = {
  id: string;
  eventType: string;
  productName: string | null;
  /** Dosis en ml (null si no se cargó). */
  doseMl: number | null;
  /** Vía de aplicación (string guardado; el label lo resuelve treatmentRouteLabel). null si no se cargó. */
  route: string | null;
  /** ISO 'YYYY-MM-DD'. */
  eventDate: string;
  /** Próxima dosis (ISO 'YYYY-MM-DD') si se cargó — RTR.9.3 "CADA CUÁNTO". null si no. */
  nextDoseDate: string | null;
};

/** Un TRATAMIENTO (header) con sus aplicaciones agrupadas — RTR.9.1/9.2. */
export type Treatment = {
  id: string;
  kind: string;
  productName: string;
  notes: string | null;
  /** ISO instante de inicio. */
  startedAt: string;
  /** ISO instante de fin, o null = EN CURSO (RTR.4.1). */
  endedAt: string | null;
  /** ¿En curso? = ended_at IS NULL (derivado). */
  inProgress: boolean;
  createdBy: string | null;
  /** Aplicaciones del tratamiento, recientes primero (RTR.9.2). */
  applications: TreatmentApplication[];
};

// ─── Filas crudas del SQLite local ─────────────────────────────────────────────────────────────

type LocalTreatmentRow = {
  id: string;
  kind: string;
  product_name: string;
  notes: string | null;
  started_at: string;
  ended_at: string | null;
  created_by: string | null;
};

type LocalApplicationRow = {
  id: string;
  event_type: string;
  product_name: string | null;
  dose_ml: number | null;
  route: string | null;
  event_date: string;
  next_dose_date: string | null;
};

// ─── Lectura: tratamientos del animal (RTR.9) ────────────────────────────────────────────────

/**
 * Lee los tratamientos de un animal (en curso primero, RTR.9.1) con sus aplicaciones agrupadas (RTR.9.2),
 * desde el SQLite local (offline-first). Por cada header, una query local de sus aplicaciones (N queries, N
 * chico — un animal tiene poquísimos tratamientos). Tolerante: si la lectura de aplicaciones de un tratamiento
 * falla, ese tratamiento queda con applications=[] (no rompe la sección). El scoping ya lo aplicó la stream.
 */
export async function fetchTreatments(profileId: string): Promise<ServiceResult<Treatment[]>> {
  // emptyIsSyncing:false — un animal sin tratamientos es un resultado legítimamente vacío (la ficha lo maneja).
  const headers = await runLocalQuery<LocalTreatmentRow>(buildAnimalTreatmentsQuery(profileId), {
    emptyIsSyncing: false,
  });
  if (!headers.ok) return { ok: false, error: { kind: headers.error.kind, message: headers.error.message } };

  const out: Treatment[] = [];
  for (const h of headers.value) {
    const appsRes = await runLocalQuery<LocalApplicationRow>(buildTreatmentApplicationsQuery(h.id), {
      emptyIsSyncing: false,
    });
    const applications: TreatmentApplication[] = appsRes.ok
      ? appsRes.value.map((a) => ({
          id: a.id,
          eventType: a.event_type,
          productName: a.product_name,
          doseMl: a.dose_ml,
          route: a.route,
          eventDate: a.event_date,
          nextDoseDate: a.next_dose_date,
        }))
      : [];
    out.push({
      id: h.id,
      kind: h.kind,
      productName: h.product_name,
      notes: h.notes,
      startedAt: h.started_at,
      endedAt: h.ended_at,
      inProgress: h.ended_at == null,
      createdBy: h.created_by,
      applications,
    });
  }
  return { ok: true, value: out };
}

// ─── Escritura: iniciar tratamiento (RTR.1) ────────────────────────────────────────────────────

/** La 1ª aplicación OPCIONAL al iniciar (RTR.1.6). Todos los datos opcionales salvo eventDate. */
export type FirstApplicationInput = {
  /** ISO 'YYYY-MM-DD'. Requerido si se carga la 1ª aplicación (default hoy en la UI). */
  eventDate: string;
  doseMl?: number | null;
  route?: string | null;
  nextDoseDate?: string | null;
};

export type StartTreatmentInput = {
  profileId: string;
  kind: string;
  /** Ya validado (no vacío, ≤ 120) por validateTreatmentProduct en el caller. */
  productName: string;
  /** Ya validado (≤ 1000) por validateTreatmentNotes en el caller. null si vacío. */
  notes?: string | null;
  /** 1ª aplicación opcional (RTR.1.6). Ausente → solo el header. */
  firstApplication?: FirstApplicationInput | null;
};

/**
 * Inicia un tratamiento LOCAL (RTR.1.2, offline) → upload queue. id/started_at de cliente. Crea el header y,
 * opcionalmente, la 1ª aplicación linkeada (RTR.1.6). establishment_id/created_by por trigger (no se mandan).
 * Devuelve el treatmentId (de cliente) por si el caller quiere navegar/refrescar. Si la 1ª aplicación falla el
 * write local, el header ya quedó ok (offline-first, el error es solo si el execute local rompe).
 */
export async function startTreatment(
  input: StartTreatmentInput,
): Promise<ServiceResult<{ treatmentId: string }>> {
  const treatmentId = randomUuid();
  const startedAt = nowIso();
  const headerRes = await runLocalWrite(
    buildStartTreatmentInsert(
      treatmentId,
      input.profileId,
      input.kind,
      input.productName,
      cleanStr(input.notes),
      startedAt,
    ),
  );
  if (!headerRes.ok) {
    return { ok: false, error: { kind: headerRes.error.kind, message: headerRes.error.message } };
  }

  if (input.firstApplication) {
    const appRes = await registerApplication({
      profileId: input.profileId,
      treatmentId,
      kind: input.kind,
      productName: input.productName,
      eventDate: input.firstApplication.eventDate,
      doseMl: input.firstApplication.doseMl ?? null,
      route: input.firstApplication.route ?? null,
      nextDoseDate: input.firstApplication.nextDoseDate ?? null,
    });
    if (!appRes.ok) return { ok: false, error: appRes.error };
  }

  return { ok: true, value: { treatmentId } };
}

// ─── Escritura: registrar aplicación (RTR.2) ────────────────────────────────────────────────────

export type RegisterApplicationInput = {
  profileId: string;
  treatmentId: string;
  /** kind del tratamiento (para derivar el event_type de la aplicación, RTR.2.2). */
  kind: string;
  /** product_name de la aplicación. Default = el del header (RTR.2.2). */
  productName: string;
  /** ISO 'YYYY-MM-DD'. Default hoy en la UI. */
  eventDate: string;
  doseMl?: number | null;
  route?: string | null;
  nextDoseDate?: string | null;
};

/**
 * Registra una aplicación LOCAL (RTR.2.2, offline) → upload queue. Un sanitary_event con treatment_id +
 * event_type derivado del kind (antibiotico→treatment, etc). id de cliente. El tenant-check del treatment_id
 * (mismo animal, anti-IDOR SEC-TRT-03) + la exención de gating re-validan al subir. Solo se ofrece sobre un
 * tratamiento EN CURSO (la UI lo garantiza, RTR.2.1/2.5); un intento sobre uno finalizado no rebota local (el
 * server no lo bloquea porque no hay estado en el evento) pero la UI no ofrece el CTA en tratamientos cerrados.
 */
export async function registerApplication(
  input: RegisterApplicationInput,
): Promise<ServiceResult<true>> {
  const r = await runLocalWrite(
    buildRegisterApplicationInsert(
      randomUuid(),
      input.profileId,
      input.treatmentId,
      treatmentEventType(input.kind),
      input.productName,
      input.eventDate,
      input.doseMl ?? null,
      cleanStr(input.route),
      cleanStr(input.nextDoseDate),
    ),
  );
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Escritura: finalizar tratamiento (RTR.3) ────────────────────────────────────────────────────

/**
 * Finaliza un tratamiento LOCAL (RTR.3.2, offline) → upload queue. UPDATE de ended_at = datetime('now'),
 * IDEMPOTENTE (guard ended_at IS NULL, RTR.3.4). El trigger de inmutabilidad server-side permite EXACTAMENTE
 * esta mutación; la RLS UPDATE amplia deja finalizar a cualquier rol activo (D-2, RTR.6.3). Al finalizar el
 * último tratamiento en curso, la marca/pin se quitan (derivado, RTR.4.6/5.4) — el caller re-fetchea.
 */
export async function finalizeTreatment(treatmentId: string): Promise<ServiceResult<true>> {
  const r = await runLocalWrite(buildFinalizeTreatmentUpdate(treatmentId));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────

function cleanStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** UUID v4 de cliente. crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}

/** Instante de creación (wall-clock de cliente) para started_at — offline-first (criterio 7). */
function nowIso(): string {
  return new Date().toISOString();
}
