// Creación + habilitación de DATOS/MANIOBRAS CUSTOM (spec 03 M5-C.2, R13.5–R13.9).
//
// Un dato custom = una fila de `field_definitions` con `establishment_id` del campo activo (0093). El owner
// la crea desde dos `+` que convergen (config de datos del rodeo / lista de maniobras del wizard). Acá vive:
//   - createCustomField: INSERT CRUD-plano OFFLINE (id de cliente; el server fuerza/valida con la RLS
//     owner-only + el guard tg_field_definitions_custom_guard al subir — owner, slug/≤64, ui_component ∈
//     los 7, data_type ∈ (maniobra,propiedad), options 1..50/≤60). El data_key se DERIVA del label (slug
//     único por establishment). config_schema {options} para enums; null para los demás.
//   - enableCustomFieldInRodeo: prende el field en un rodeo (rodeo_data_config) OFFLINE, REUSANDO el camino
//     de plantilla as-built (enqueueSetRodeoConfig → RPC set_rodeo_config 0082 + overlay optimista). NO se
//     hace un INSERT directo a rodeo_data_config (ese camino se removió en spec 15 T9.9: solo owner por RPC).
//   - fetchCustomDataKeys: los data_keys custom YA usados (para la unicidad del slug al crear).
//   - fetchEnabledCustomManeuvers: las maniobras custom enabled en un rodeo (tweak M1, §11.7).
//
// OFFLINE-first (spec 15): crear/habilitar son writes LOCALES → funcionan sin red; el gating/owner-check
// server-side re-valida al subir y un rechazo se superficia por R10.8/M4.2. NUNCA se hardcodea
// establishment_id (CLAUDE.md ppio 6): viene del contexto activo, el caller lo pasa.

import {
  buildCreateCustomFieldInsert,
  buildCustomDataKeysQuery,
  buildEnabledCustomFieldsQuery,
} from './powersync/local-reads';
import { runLocalQuery, runLocalWrite } from './powersync/local-query';
import { enqueueSetRodeoConfig } from './powersync/outbox';
import {
  buildCreateCustomFieldPayload,
  validateCustomFieldDraft,
  type CustomFieldDraft,
  type CustomUiComponent,
} from '../utils/custom-field';
import { parseCustomOptions } from '../utils/custom-render';

// ─── Error / Result uniforme (mismo shape que rodeo-config.ts / events.ts) ──────────────────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type { CustomFieldDraft, CustomUiComponent, CustomDataType } from '../utils/custom-field';

/**
 * Un dato CUSTOM enabled en un rodeo (spec 03 M5-C.3): su field_definition_id + data_key + label + el
 * ui_component que lo renderiza + las opciones (si es enum). M5-C.3 enriqueció el shape de M5-C.2 (que solo
 * traía id/data_key/label) con ui_component/options para el renderer genérico. Sirve tanto a maniobras
 * (CustomManeuverStep, escribe a custom_measurements) como a propiedades (CustomFieldInput de alta/ficha).
 */
export type EnabledCustomManeuver = {
  fieldDefinitionId: string;
  dataKey: string;
  label: string;
  uiComponent: CustomUiComponent;
  /** Opciones del enum (enum_single/enum_multi); [] para los demás. */
  options: string[];
};

/** Alias semántico: lo mismo, usado para las PROPIEDADES custom (alta/ficha) — el shape es idéntico. */
export type EnabledCustomProperty = EnabledCustomManeuver;

// ─── Lectura: data_keys custom ya usados (para la unicidad del slug) ────────────────────────────────

type DataKeyRow = { data_key: string };

/**
 * Lee los `data_key` de las field_definitions CUSTOM vivas del/los campo(s) del usuario (R13.5). Read-only,
 * local. Se usa para desambiguar el slug derivado al crear. Vacío legítimo (un campo sin datos custom aún)
 * NO degrada a "Sincronizando…" (emptyIsSyncing:false): "no hay custom todavía" es el estado de partida.
 */
export async function fetchCustomDataKeys(): Promise<ServiceResult<string[]>> {
  const r = await runLocalQuery<DataKeyRow>(buildCustomDataKeysQuery(), { emptyIsSyncing: false });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value.map((row) => row.data_key) };
}

// ─── Creación de un dato custom (R13.5–R13.9) ───────────────────────────────────────────────────────

export type CreateCustomFieldInput = {
  /** Establecimiento ACTIVO (del contexto; el guard server-side exige is_owner_of, nunca NULL). */
  establishmentId: string;
  /** Lo que el usuario tipeó en el form: label + clasificación + tipo de input + opciones (enum). */
  draft: CustomFieldDraft;
};

export type CreateCustomFieldResult = {
  /** id de cliente del field creado (para habilitarlo en el rodeo de una desde el `+` de maniobras). */
  fieldDefinitionId: string;
  /** El data_key derivado (slug único). */
  dataKey: string;
};

/**
 * Crea un dato/maniobra custom (R13.5–R13.9) OFFLINE. Valida el draft client-side (UX), deriva el data_key
 * único (slug del label desambiguado contra los custom existentes) y arma el payload EXACTO del INSERT 0093
 * (id de cliente; config_schema {options} para enums). Escribe CRUD-plano local → uploadData lo sube y la
 * RLS owner-only + el guard re-validan (owner, slug, ui_component, data_type, options). El `id`/`data_key`
 * vuelven para que el caller (el `+` de maniobras) lo habilite en el rodeo de una.
 *
 * Falla SOLO por validación client-side (draft inválido) o por error del DB local (defensivo). Un rechazo
 * server-side (no-owner, dup de data_key) ocurre al SUBIR → lo maneja uploadData (descarta + R10.8), NO el
 * return de acá. La UI ya gateó el `+` a owner (R13.2/R13.5), así que el rechazo de no-owner es el backstop.
 */
export async function createCustomField(
  input: CreateCustomFieldInput,
): Promise<ServiceResult<CreateCustomFieldResult>> {
  const valid = validateCustomFieldDraft(input.draft);
  if (!valid.ok) {
    return { ok: false, error: { kind: 'unknown', message: valid.message } };
  }
  // data_keys custom existentes → unicidad del slug. Si la lectura local falla, NO bloqueamos la creación:
  // el server tiene el UNIQUE (establishment_id, data_key) como barrera autoritativa (un raro choque
  // generaría un rechazo de sync, no un duplicado). Mejor crear con la mejor info local disponible.
  const existing = await fetchCustomDataKeys();
  const existingDataKeys = existing.ok ? existing.value : [];

  const id = randomUuid();
  const payload = buildCreateCustomFieldPayload({
    id,
    establishmentId: input.establishmentId,
    draft: input.draft,
    existingDataKeys,
  });

  const q = buildCreateCustomFieldInsert(
    payload.id,
    payload.establishment_id,
    payload.data_key,
    payload.label,
    payload.data_type,
    payload.ui_component,
    payload.category,
    payload.config_schema === null ? null : JSON.stringify(payload.config_schema),
  );
  const r = await runLocalWrite(q);
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: { fieldDefinitionId: payload.id, dataKey: payload.data_key } };
}

// ─── Habilitar un field custom en un rodeo (R13.5b / R13.10) ────────────────────────────────────────

export type EnableCustomFieldInput = {
  rodeoId: string;
  fieldDefinitionId: string;
  /** true = prender (default); false = apagar. */
  enabled?: boolean;
};

/**
 * Habilita (o deshabilita) un field custom en un rodeo (rodeo_data_config), REUSANDO el camino de plantilla
 * as-built (enqueueSetRodeoConfig → RPC set_rodeo_config 0082, owner-only, + overlay optimista). OFFLINE: el
 * toggle aparece al instante local (el form dinámico / la lista de maniobras lo ven) y el UPSERT idempotente
 * se aplica server-side al drenar la cola. NO hace un INSERT directo a rodeo_data_config (ese camino se
 * removió en spec 15 T9.9). Usado por el `+` de la lista de maniobras (R13.5b: crea la maniobra Y la prende
 * en el rodeo en el mismo paso).
 */
export async function enableCustomFieldInRodeo(
  input: EnableCustomFieldInput,
): Promise<ServiceResult<true>> {
  const enabled = input.enabled ?? true;
  const r = await enqueueSetRodeoConfig({
    rodeoId: input.rodeoId,
    params: {
      p_rodeo_id: input.rodeoId,
      p_toggles: [{ field_definition_id: input.fieldDefinitionId, enabled }],
    },
    configRows: [{ fieldDefinitionId: input.fieldDefinitionId, enabled }],
  });
  if (!r.ok) return { ok: false, error: { kind: 'unknown', message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Lectura: datos custom enabled en un rodeo (tweak M1 §11.7 + render genérico M5-C.3) ─────────────

type EnabledFieldRow = {
  id: string;
  data_key: string;
  label: string;
  ui_component: string;
  config_schema: unknown;
};

/** Los 7 ui_component válidos (R13.8). El server (CHECK 0093) ya restringe la fila custom a estos. */
const UI_COMPONENTS = new Set<string>([
  'numeric',
  'numeric_stepped',
  'enum_single',
  'enum_multi',
  'text',
  'boolean',
  'date',
]);

/** Mapea una fila enriquecida a EnabledCustomManeuver, parseando options del config_schema (TOLERANTE). */
function toEnabledCustomField(row: EnabledFieldRow): EnabledCustomManeuver {
  return {
    fieldDefinitionId: row.id,
    dataKey: row.data_key,
    label: row.label,
    // El server garantiza el dominio (CHECK 0093); el fallback 'text' es defensivo ante una fila vieja/rara.
    uiComponent: UI_COMPONENTS.has(row.ui_component) ? (row.ui_component as CustomUiComponent) : 'text',
    options: parseCustomOptions(row.config_schema),
  };
}

/**
 * Lee las field_definitions custom de tipo `maniobra` ENABLED en un rodeo (tweak M1 §11.7 + render genérico
 * M5-C.3): la lista de maniobras del wizard = 10 de fábrica gateadas + estas; la carga rápida las renderiza
 * por ui_component. Read-only, local (incluye el overlay del toggle offline). Vacío legítimo NO degrada a
 * "Sincronizando…".
 */
export async function fetchEnabledCustomManeuvers(
  rodeoId: string,
): Promise<ServiceResult<EnabledCustomManeuver[]>> {
  const r = await runLocalQuery<EnabledFieldRow>(buildEnabledCustomFieldsQuery(rodeoId, 'maniobra'), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value.map(toEnabledCustomField) };
}

/**
 * Lee las field_definitions custom de tipo `propiedad` ENABLED en un rodeo (spec 03 M5-C.3, R13.10): el form
 * de alta + la ficha del animal de ese rodeo las muestran (render por ui_component) → custom_attributes.
 * Read-only, local (overlay-aware). Vacío legítimo NO degrada a "Sincronizando…".
 */
export async function fetchEnabledCustomProperties(
  rodeoId: string,
): Promise<ServiceResult<EnabledCustomProperty[]>> {
  const r = await runLocalQuery<EnabledFieldRow>(buildEnabledCustomFieldsQuery(rodeoId, 'propiedad'), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value.map(toEnabledCustomField) };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────

/** UUID v4 de cliente. crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
