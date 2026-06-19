// Lógica PURA de la plantilla de datos del rodeo (spec 02 frontend, C1 — ADR-021).
// Sin RN, sin red, sin supabase-js: testeable con node:test (mismo patrón que
// establishment.ts / validation.ts de spec 01).
//
// Cubre el armado del wizard "Crear rodeo" paso 3 (R2.6 plantilla) y "Editar plantilla":
//   - agrupar field_definitions por categoría con orden estable (R2.8),
//   - calcular el estado inicial de los toggles desde system_default_fields (R2.9/R2.11),
//   - computar el DIFF de los toggles del usuario contra los defaults pre-poblados por el
//     trigger (R2.11/R2.12) → solo lo que cambió se persiste sobre rodeo_data_config.
//
// El diff es la pieza crítica del flujo de creación: el trigger tg_rodeos_seed_data_config
// (0018) ya pre-pobla rodeo_data_config con default_enabled por cada system_default_field;
// el cliente NO debe re-escribir las 27 filas (cría; +1 por circunferencia_escrotal, spec 03 R14.18, seed 0099), solo las que el usuario tildó/destildó
// distinto del default (UPDATE) o habilitó siendo no-default (INSERT).

// ─── Tipos de dominio (espejan las tablas, sin acoplar a supabase-js) ────────────

/** Una fila del catálogo global field_definitions (R2.8). */
export type FieldDefinition = {
  id: string;
  dataKey: string;
  label: string;
  description: string | null;
  /** reproductivo | productivo | sanitario | manejo | comercial | identificacion */
  category: string;
  dataType: string;
  uiComponent: string | null;
};

/** Una fila de system_default_fields para un sistema (R2.9). */
export type SystemDefaultField = {
  fieldDefinitionId: string;
  defaultEnabled: boolean;
  requiredForSystem: boolean;
  sortOrder: number;
};

/** Una fila efectiva de rodeo_data_config (R2.10), para "Editar plantilla". */
export type RodeoFieldConfig = {
  fieldDefinitionId: string;
  enabled: boolean;
};

/**
 * Un toggle renderizable en la UI: la definición del field + su estado actual + metadatos
 * que el render necesita (required no se puede destildar; isDefault distingue INSERT de
 * UPDATE al persistir).
 */
export type TemplateToggle = {
  field: FieldDefinition;
  enabled: boolean;
  /** No se puede destildar a nivel rodeo (R2.9 required_for_system). En cría MVP: ninguno. */
  required: boolean;
  /** El field pertenece a los system_default_fields del sistema (existe fila pre-poblada). */
  isDefault: boolean;
  sortOrder: number;
};

/** Una sección de la lista agrupada por categoría (header + sus toggles). */
export type TemplateSection = {
  category: string;
  toggles: TemplateToggle[];
};

// ─── Orden canónico de las categorías (UI: settings-style) ───────────────────────
//
// Orden de presentación de los headers de sección. El que no esté listado va al final
// (defensivo: si se seedea una categoría nueva sin tocar este orden, igual se muestra).
const CATEGORY_ORDER = [
  'reproductivo',
  'productivo',
  'sanitario',
  'manejo',
  'comercial',
  'identificacion',
] as const;

/** Etiqueta humana (es-AR) de cada categoría para el header de sección. */
export function categoryLabel(category: string): string {
  switch (category) {
    case 'reproductivo':
      return 'Reproductivo';
    case 'productivo':
      return 'Productivo';
    case 'sanitario':
      return 'Sanitario';
    case 'manejo':
      return 'Manejo';
    case 'comercial':
      return 'Comercial';
    case 'identificacion':
      return 'Identificación';
    default:
      // Categoría no prevista: capitalizamos la primera letra para no mostrar el raw.
      return category.length > 0 ? category[0].toUpperCase() + category.slice(1) : category;
  }
}

function categoryRank(category: string): number {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// ─── Construcción del estado de toggles ──────────────────────────────────────────

/**
 * Construye la lista de toggles del WIZARD (crear rodeo): para el sistema elegido, cada
 * field que tenga system_default_field arranca con `enabled = default_enabled`. Los fields
 * del catálogo que NO son default del sistema NO se muestran en el wizard por defecto (el
 * caso "habilitar un dato no-default" es de "Editar plantilla", post-creación; el wizard se
 * enfoca en ajustar los defaults del sistema, R2.6). El resultado es la fuente de la lista
 * agrupada y, tras los toggles del usuario, del diff a persistir.
 */
export function buildWizardToggles(
  catalog: FieldDefinition[],
  defaults: SystemDefaultField[],
): TemplateToggle[] {
  const byId = new Map(catalog.map((f) => [f.id, f]));
  const toggles: TemplateToggle[] = [];
  for (const d of defaults) {
    const field = byId.get(d.fieldDefinitionId);
    if (!field) continue; // field inactivo/ausente del catálogo: lo saltamos (defensivo).
    toggles.push({
      field,
      enabled: d.defaultEnabled,
      required: d.requiredForSystem,
      isDefault: true,
      sortOrder: d.sortOrder,
    });
  }
  return toggles;
}

/**
 * Construye la lista de toggles de "EDITAR PLANTILLA" (post-creación): combina el estado
 * efectivo (rodeo_data_config) con TODO el catálogo global, así el owner puede habilitar un
 * field que no es default del sistema (caso "tambo + preñez", R2.12). Cada field del catálogo
 * se muestra con su `enabled` actual (si tiene fila en config) o `false` (si nunca se habilitó).
 * El `sortOrder` usa el de system_default_fields si existe, si no cae al orden por label dentro
 * de la categoría (se resuelve en groupTogglesByCategory por el tie-break de label).
 */
export function buildEditToggles(
  catalog: FieldDefinition[],
  defaults: SystemDefaultField[],
  config: RodeoFieldConfig[],
): TemplateToggle[] {
  const defaultById = new Map(defaults.map((d) => [d.fieldDefinitionId, d]));
  const enabledById = new Map(config.map((c) => [c.fieldDefinitionId, c.enabled]));
  const toggles: TemplateToggle[] = [];
  for (const field of catalog) {
    const d = defaultById.get(field.id);
    const hasConfig = enabledById.has(field.id);
    toggles.push({
      field,
      // Estado efectivo: lo que dice rodeo_data_config; si no hay fila, el field no está
      // habilitado en este rodeo (no-default nunca tildado).
      enabled: hasConfig ? Boolean(enabledById.get(field.id)) : false,
      required: d?.requiredForSystem ?? false,
      isDefault: Boolean(d),
      // Los default-fields conservan su sortOrder; los no-default van después (gran número)
      // y se ordenan por label dentro de la categoría (tie-break en el sort).
      sortOrder: d?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    });
  }
  return toggles;
}

// ─── Agrupado por categoría (R2.8 — headers de sección, orden por sort_order) ────

/**
 * Agrupa los toggles por categoría en el orden canónico de CATEGORY_ORDER, y DENTRO de cada
 * categoría los ordena por `sortOrder` ascendente (tie-break por label es-AR). Devuelve solo
 * las secciones que tienen al menos un toggle.
 */
export function groupTogglesByCategory(toggles: TemplateToggle[]): TemplateSection[] {
  const byCategory = new Map<string, TemplateToggle[]>();
  for (const t of toggles) {
    const arr = byCategory.get(t.field.category) ?? [];
    arr.push(t);
    byCategory.set(t.field.category, arr);
  }

  const sections: TemplateSection[] = [];
  for (const [category, arr] of byCategory) {
    arr.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.field.label.localeCompare(b.field.label, 'es');
    });
    sections.push({ category, toggles: arr });
  }

  sections.sort((a, b) => {
    const ra = categoryRank(a.category);
    const rb = categoryRank(b.category);
    if (ra !== rb) return ra - rb;
    return a.category.localeCompare(b.category, 'es');
  });

  return sections;
}

// ─── Diff de toggles → operaciones sobre rodeo_data_config ───────────────────────

/**
 * Una operación a aplicar sobre rodeo_data_config tras crear el rodeo (o al editar plantilla).
 *   - 'update': la fila existe (field default, pre-poblada por el trigger) pero el usuario la
 *     dejó distinta del default → UPDATE enabled.
 *   - 'insert': el field NO es default del sistema y el usuario lo habilitó → INSERT
 *     (enabled=true). Solo se inserta para habilitar (R2.12: deshabilitar un no-default que
 *     nunca tuvo fila es un no-op — no existe fila que tocar).
 */
export type ConfigOp = {
  kind: 'update' | 'insert';
  fieldDefinitionId: string;
  enabled: boolean;
};

/**
 * Computa el set MÍNIMO de operaciones para llevar rodeo_data_config al estado deseado por el
 * usuario, partiendo del estado pre-poblado por el trigger tg_rodeos_seed_data_config (0018):
 * una fila por cada system_default_field con enabled = default_enabled.
 *
 * Reglas (R2.11/R2.12):
 *   - Field DEFAULT (existe fila pre-poblada): si el usuario lo dejó distinto de default_enabled
 *     → UPDATE. Si lo dejó igual → no-op (no tocamos la fila que el trigger ya puso).
 *   - Field NO-DEFAULT (sin fila pre-poblada): si el usuario lo habilitó (enabled=true) → INSERT.
 *     Si lo dejó en false → no-op (no hay fila; insertar enabled=false sería ruido).
 *   - Field REQUIRED: se ignora (no se puede destildar; el render lo bloquea). Aun si llegara un
 *     toggle required con enabled=false (UI buggeada), NO emitimos op que lo apague.
 *
 * `desired` son los toggles tal como quedaron tras la interacción del usuario; `defaults` son los
 * system_default_fields del sistema (fuente del estado pre-poblado). Solo necesitamos `defaults`
 * para saber qué fields tienen fila y con qué default_enabled comparar.
 */
export function computeConfigDiff(
  desired: TemplateToggle[],
  defaults: SystemDefaultField[],
): ConfigOp[] {
  const defaultById = new Map(defaults.map((d) => [d.fieldDefinitionId, d]));
  const ops: ConfigOp[] = [];

  for (const t of desired) {
    const d = defaultById.get(t.field.id);
    if (d) {
      // Field default: el trigger ya puso una fila con enabled = d.defaultEnabled.
      if (t.required) continue; // required: nunca se apaga, nada que diffear.
      if (t.enabled !== d.defaultEnabled) {
        ops.push({ kind: 'update', fieldDefinitionId: t.field.id, enabled: t.enabled });
      }
    } else {
      // Field no-default: no hay fila pre-poblada. Solo lo insertamos si el usuario lo habilitó.
      if (t.enabled) {
        ops.push({ kind: 'insert', fieldDefinitionId: t.field.id, enabled: true });
      }
    }
  }

  return ops;
}

/**
 * Diff para "EDITAR PLANTILLA": compara el estado deseado contra el estado EFECTIVO actual
 * (rodeo_data_config), no contra los defaults. Acá cada field default ya tiene fila (UPDATE),
 * y un no-default puede tener fila (si se habilitó antes → UPDATE) o no (primera vez → INSERT).
 *
 *   - Field con fila existente (en `current`): si cambió enabled → UPDATE. Si no → no-op.
 *   - Field SIN fila (no-default nunca tocado): si el usuario lo habilita → INSERT. Si lo deja
 *     en false → no-op (sigue sin fila; el modelo trata "sin fila" como deshabilitado).
 *   - Required: se ignora (no se apaga).
 *
 * No emitimos DELETE: el modelo no permite DELETE de cliente (R2.12); deshabilitar = enabled=false.
 */
export function computeEditDiff(
  desired: TemplateToggle[],
  current: RodeoFieldConfig[],
): ConfigOp[] {
  const enabledById = new Map(current.map((c) => [c.fieldDefinitionId, c.enabled]));
  const ops: ConfigOp[] = [];

  for (const t of desired) {
    if (t.required) continue;
    const hasRow = enabledById.has(t.field.id);
    if (hasRow) {
      const currentEnabled = Boolean(enabledById.get(t.field.id));
      if (t.enabled !== currentEnabled) {
        ops.push({ kind: 'update', fieldDefinitionId: t.field.id, enabled: t.enabled });
      }
    } else if (t.enabled) {
      ops.push({ kind: 'insert', fieldDefinitionId: t.field.id, enabled: true });
    }
  }

  return ops;
}

/** Una fila efectiva de la plantilla del rodeo (id del field + su estado), para el overlay optimista. */
export type EffectiveConfigRow = { fieldDefinitionId: string; enabled: boolean };

/**
 * Computa la PLANTILLA EFECTIVA del rodeo (las filas que tendría `rodeo_data_config` tras el trigger de seed
 * 0018 + la RPC create_rodeo), para el OVERLAY OPTIMISTA del alta de rodeo OFFLINE (spec 15, Run T9.8). El
 * trigger 0018 seedea una fila por cada system_default_field con `enabled = default_enabled`; la RPC aplica
 * el diff (UPDATE de los defaults cambiados + INSERT de los no-defaults habilitados). El resultado neto:
 *   - una fila por cada toggle del wizard (los default-fields del sistema con su estado FINAL elegido por el
 *     usuario — buildWizardToggles cubre exactamente los default-fields);
 *   - + una fila por cada no-default habilitado (diff kind 'insert', que NO está en los toggles del wizard).
 * Pura (sin I/O) → testeable con node:test, igual que computeConfigDiff.
 */
export function buildEffectiveConfigRows(
  toggles: TemplateToggle[],
  diffOps: ConfigOp[],
): EffectiveConfigRow[] {
  const rows: EffectiveConfigRow[] = toggles.map((t) => ({ fieldDefinitionId: t.field.id, enabled: t.enabled }));
  const seen = new Set(rows.map((r) => r.fieldDefinitionId));
  for (const op of diffOps) {
    if (op.kind === 'insert' && !seen.has(op.fieldDefinitionId)) {
      rows.push({ fieldDefinitionId: op.fieldDefinitionId, enabled: op.enabled });
      seen.add(op.fieldDefinitionId);
    }
  }
  return rows;
}

/** Aplica un cambio de un toggle (por id) sobre la lista, devolviendo una nueva lista (inmutable). */
export function setToggle(
  toggles: TemplateToggle[],
  fieldDefinitionId: string,
  enabled: boolean,
): TemplateToggle[] {
  return toggles.map((t) =>
    t.field.id === fieldDefinitionId && !t.required ? { ...t, enabled } : t,
  );
}
