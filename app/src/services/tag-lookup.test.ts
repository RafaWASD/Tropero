// Tests de la lógica PURA de la rama BLE del find-or-create (spec 09 chunk "BLE global", RB4 /
// design §3.2). node:test + type-stripping nativo, sin Jest. La decisión de las 3 ramas vive en
// services/tag-lookup.ts (sin imports de RN/expo/supabase); el servicio I/O (animals.ts::lookupByTag)
// importa `./supabase` → expo-secure-store y NO carga bajo node:test, así que testeamos el módulo puro
// (mismo patrón que transfer-animal.test.ts ↔ animals.ts::transferAnimal).
//
// `lookupByTag` (en animals.ts) es un orquestador delgado: corre buildSearchByTagQuery (campo activo) y,
// si vino vacío, buildLookupTagAcrossFieldsQuery (cross-campo), y delega la DECISIÓN a resolveTagLookup.
// Por eso estos tests cubren las 3 ramas que `lookupByTag` devuelve, alimentando resolveTagLookup con las
// mismas filas que cada query produciría.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCreateOrAssign, resolveTagLookup, type CrossFieldTagRow } from './tag-lookup.ts';

const EST_ACTIVE = 'est-A';

// ─── Rama 1 — EDIT: match activo en el campo ACTIVO (RB4.3) ──────────────────────────

test('resolveTagLookup: rama EDIT — match activo en el campo activo → { mode:edit, profileId }', () => {
  const r = resolveTagLookup({
    activeFieldRows: [{ id: 'p-1' }],
    crossFieldRows: [], // lookupByTag corta-circuito: no corre la query cross-campo si hay match activo
    establishmentId: EST_ACTIVE,
  });
  assert.deepEqual(r, { mode: 'edit', profileId: 'p-1' });
});

test('resolveTagLookup: rama EDIT — toma el PRIMER match activo (≤1 por campo por unicidad global, defensivo si llegan varios)', () => {
  const r = resolveTagLookup({
    activeFieldRows: [{ id: 'p-first' }, { id: 'p-second' }],
    crossFieldRows: [],
    establishmentId: EST_ACTIVE,
  });
  assert.deepEqual(r, { mode: 'edit', profileId: 'p-first' });
});

test('resolveTagLookup: rama EDIT GANA sobre transfer — si hay match en el campo activo, NO mira cross-campo', () => {
  // Defensivo: aunque crossFieldRows trajera una fila de otro campo, la rama 1 (edit) tiene prioridad.
  const r = resolveTagLookup({
    activeFieldRows: [{ id: 'p-activo' }],
    crossFieldRows: [{ profile_id: 'p-otro', establishment_id: 'est-B', establishment_name: 'El Ombú' }],
    establishmentId: EST_ACTIVE,
  });
  assert.deepEqual(r, { mode: 'edit', profileId: 'p-activo' });
});

// ─── Rama 2 — TRANSFER: activo en OTRO campo del usuario (RB4.4 / DEC-3) ──────────────

test('resolveTagLookup: rama TRANSFER — sin match activo, pero activo en OTRO campo → { mode:transfer, sourceProfileId, otherFieldName }', () => {
  const r = resolveTagLookup({
    activeFieldRows: [],
    crossFieldRows: [{ profile_id: 'p-src', establishment_id: 'est-B', establishment_name: 'El Ombú' }],
    establishmentId: EST_ACTIVE,
  });
  assert.deepEqual(r, { mode: 'transfer', sourceProfileId: 'p-src', otherFieldName: 'El Ombú' });
});

test('resolveTagLookup: rama TRANSFER — ignora DEFENSIVAMENTE una fila cross-campo que sea del campo ACTIVO', () => {
  // Caso patológico: la query cross-campo trae una fila del campo activo (no debería; la rama 1 ya la
  // tomaría). Acá activeFieldRows está vacío (p.ej. una fila que el overlay sí tendría pero el cross-campo
  // synced no, o un edge de sync). Esa fila del campo activo NO debe contarse como "otro campo".
  const crossFieldRows: CrossFieldTagRow[] = [
    { profile_id: 'p-mismo-campo', establishment_id: EST_ACTIVE, establishment_name: 'La Querencia' },
    { profile_id: 'p-otro-campo', establishment_id: 'est-B', establishment_name: 'El Ombú' },
  ];
  const r = resolveTagLookup({ activeFieldRows: [], crossFieldRows, establishmentId: EST_ACTIVE });
  assert.deepEqual(r, { mode: 'transfer', sourceProfileId: 'p-otro-campo', otherFieldName: 'El Ombú' });
});

test('resolveTagLookup: rama TRANSFER — name del otro campo NULL → fallback genérico (la UI siempre tiene algo que mostrar)', () => {
  const r = resolveTagLookup({
    activeFieldRows: [],
    crossFieldRows: [{ profile_id: 'p-src', establishment_id: 'est-B', establishment_name: null }],
    establishmentId: EST_ACTIVE,
  });
  assert.equal(r.mode, 'transfer');
  if (r.mode !== 'transfer') return;
  assert.equal(r.sourceProfileId, 'p-src');
  assert.equal(r.otherFieldName, 'otro campo');
});

test('resolveTagLookup: rama TRANSFER — si la ÚNICA fila cross-campo es del campo activo → NO es transfer (cae a create)', () => {
  // Toda fila cross-campo es del campo activo (todas a ignorar) y no hubo match en la rama 1 → create.
  const r = resolveTagLookup({
    activeFieldRows: [],
    crossFieldRows: [
      { profile_id: 'p-mismo', establishment_id: EST_ACTIVE, establishment_name: 'La Querencia' },
    ],
    establishmentId: EST_ACTIVE,
  });
  assert.deepEqual(r, { mode: 'create' });
});

// ─── Rama 3 — CREATE: sin match en NINGÚN campo (RB4.5 / DEC-2) ───────────────────────

test('resolveTagLookup: rama CREATE — sin match en ningún campo → { mode:create } (DIRECTO, sin intermediate)', () => {
  const r = resolveTagLookup({
    activeFieldRows: [],
    crossFieldRows: [],
    establishmentId: EST_ACTIVE,
  });
  assert.deepEqual(r, { mode: 'create' });
});

// ─── Opción A — resolveCreateOrAssign: ¿intermedia o CREATE directo? (RD8 / design §3.2) ──────

test('resolveCreateOrAssign: 0 candidatos noTag → { mode:create } (CREATE directo, sin intermedia vacía — RD3.2)', () => {
  assert.deepEqual(resolveCreateOrAssign(0), { mode: 'create' });
});

test('resolveCreateOrAssign: 1 candidato noTag → { mode:assign_or_create } (abre la intermedia — RD3.1)', () => {
  assert.deepEqual(resolveCreateOrAssign(1), { mode: 'assign_or_create' });
});

test('resolveCreateOrAssign: ≥2 candidatos noTag → { mode:assign_or_create }', () => {
  assert.deepEqual(resolveCreateOrAssign(7), { mode: 'assign_or_create' });
});

test('resolveCreateOrAssign: count negativo (no debería ocurrir) → fail-safe a CREATE directo, nunca intermedia vacía', () => {
  // Defensa de borde: un COUNT(*) jamás es negativo, pero la regla `> 0` garantiza que cualquier valor
  // ≤0 cae a create — nunca abrimos una intermedia sin candidatos verificados.
  assert.deepEqual(resolveCreateOrAssign(-1), { mode: 'create' });
});
