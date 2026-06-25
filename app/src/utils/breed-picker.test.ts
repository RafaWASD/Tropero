// Tests de la lógica PURA del picker de raza SENASA (spec 08, T13). node:test. Foco en:
//   - breedPickerOptions: "Sin raza" primero; solo bovine+active; orden por sort_order; OR NO promovido
//     (queda en sort_order 28); selección (null, código, código-sin-match → ninguna).
//   - filterBreedOptions: matchea por nombre/código; case/acentos-insensitive; "Sin raza" siempre presente.
//   - selectedBreedLabel: código → {code,name}; null/sin-match → null.
//   - normalizeForSearch: acentos + case.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  breedPickerOptions,
  filterBreedOptions,
  selectedBreedLabel,
  breedCodeForName,
  normalizeForSearch,
  SIN_RAZA_LABEL,
  type BreedCatalogEntry,
} from './breed-picker';

// ── Catálogo de prueba: subset del seed real (0107) — bovinas con sort_order + OR(28) + S/E(generic) +
//    1 bubalina (active=false). Verifica que el filtro deja SOLO bovine+active y respeta el orden. ──
const CATALOG: BreedCatalogEntry[] = [
  { id: 'id-aa', senasaCode: 'AA', name: 'Aberdeen Angus', species: 'bovine', active: true, sortOrder: 1 },
  { id: 'id-h', senasaCode: 'H', name: 'Hereford', species: 'bovine', active: true, sortOrder: 2 },
  { id: 'id-bg', senasaCode: 'BG', name: 'Brangus', species: 'bovine', active: true, sortOrder: 4 },
  { id: 'id-ch', senasaCode: 'CH', name: 'Charolais', species: 'bovine', active: true, sortOrder: 7 },
  { id: 'id-or', senasaCode: 'OR', name: 'Otra Raza', species: 'bovine', active: true, sortOrder: 28 },
  // FUERA del picker bovino:
  { id: 'id-se', senasaCode: 'S/E', name: 'Sin Especificar', species: 'generic', active: true, sortOrder: 99 },
  { id: 'id-mu', senasaCode: 'MU', name: 'Murrah', species: 'bubaline', active: false, sortOrder: 102 },
];

// ─── breedPickerOptions ────────────────────────────────────────────────────────────────────────────────

test('breedPickerOptions: "Sin raza — a completar" es la PRIMERA opción (id null)', () => {
  const opts = breedPickerOptions(CATALOG, null);
  assert.equal(opts[0].id, null);
  assert.equal(opts[0].name, SIN_RAZA_LABEL);
  assert.equal(opts[0].senasaCode, '');
});

test('breedPickerOptions: solo entran BOVINAS ACTIVAS (S/E generic y bubalina inactiva quedan fuera)', () => {
  const opts = breedPickerOptions(CATALOG, null);
  const codes = opts.filter((o) => o.id !== null).map((o) => o.senasaCode);
  assert.deepEqual(codes, ['AA', 'H', 'BG', 'CH', 'OR']); // 5 bovinas activas, EN ORDEN de sort_order
  assert.ok(!codes.includes('S/E'), 'S/E (generic) no debe aparecer');
  assert.ok(!codes.includes('MU'), 'MU (bubaline, active=false) no debe aparecer');
});

test('breedPickerOptions: orden por sort_order ASC (pampeanas primero)', () => {
  const opts = breedPickerOptions(CATALOG, null).filter((o) => o.id !== null);
  // sort_order: AA(1) < H(2) < BG(4) < CH(7) < OR(28)
  assert.deepEqual(opts.map((o) => o.senasaCode), ['AA', 'H', 'BG', 'CH', 'OR']);
});

test('decisión 1 (leader): OR NO se promueve — queda en su sort_order natural (último entre bovinas)', () => {
  const opts = breedPickerOptions(CATALOG, null).filter((o) => o.id !== null);
  assert.equal(opts[opts.length - 1].senasaCode, 'OR', 'OR debe quedar ÚLTIMO, no flotado al tope');
  assert.notEqual(opts[0].senasaCode, 'OR', 'OR NO debe ser la primera raza');
});

test('breedPickerOptions: selectedCode null → "Sin raza" seleccionada, ninguna raza', () => {
  const opts = breedPickerOptions(CATALOG, null);
  assert.equal(opts[0].selected, true);
  assert.equal(opts.filter((o) => o.id !== null && o.selected).length, 0);
});

test('breedPickerOptions: selectedCode de una raza → esa raza seleccionada, "Sin raza" NO', () => {
  const opts = breedPickerOptions(CATALOG, 'BG');
  assert.equal(opts[0].selected, false, '"Sin raza" no debe quedar seleccionada si hay código');
  const bg = opts.find((o) => o.senasaCode === 'BG');
  assert.ok(bg);
  assert.equal(bg!.selected, true);
  // exactamente una seleccionada
  assert.equal(opts.filter((o) => o.selected).length, 1);
});

test('breedPickerOptions: selectedCode sin match (legacy raro) → NINGUNA seleccionada, ni "Sin raza"', () => {
  const opts = breedPickerOptions(CATALOG, 'ZZZ');
  assert.equal(opts.filter((o) => o.selected).length, 0, 'un código sin match no debe marcar nada');
  assert.equal(opts[0].selected, false, 'NO se cae a "Sin raza" (el animal SÍ tiene un código)');
});

test('breedPickerOptions: catálogo vacío → solo "Sin raza"', () => {
  const opts = breedPickerOptions([], null);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].id, null);
});

test('breedPickerOptions: no muta el input (sort sobre copia)', () => {
  const before = CATALOG.map((b) => b.senasaCode);
  breedPickerOptions(CATALOG, null);
  assert.deepEqual(CATALOG.map((b) => b.senasaCode), before, 'el catálogo original no debe reordenarse');
});

test('breedPickerOptions: sort_order null va al final (tie-break por código)', () => {
  const withNulls: BreedCatalogEntry[] = [
    { id: 'a', senasaCode: 'ZZ', name: 'Z', species: 'bovine', active: true, sortOrder: null },
    { id: 'b', senasaCode: 'AA', name: 'A', species: 'bovine', active: true, sortOrder: 1 },
    { id: 'c', senasaCode: 'MM', name: 'M', species: 'bovine', active: true, sortOrder: null },
  ];
  const codes = breedPickerOptions(withNulls, null).filter((o) => o.id !== null).map((o) => o.senasaCode);
  // AA(1) primero; los dos nulls al final, ordenados por código (MM < ZZ).
  assert.deepEqual(codes, ['AA', 'MM', 'ZZ']);
});

// ─── filterBreedOptions ────────────────────────────────────────────────────────────────────────────────

test('filterBreedOptions: query vacía → lista completa', () => {
  const opts = breedPickerOptions(CATALOG, null);
  assert.equal(filterBreedOptions(opts, '').length, opts.length);
  assert.equal(filterBreedOptions(opts, '   ').length, opts.length);
});

test('filterBreedOptions: matchea por NOMBRE (case-insensitive, substring)', () => {
  const opts = breedPickerOptions(CATALOG, null);
  // "aberdeen" es único de Aberdeen Angus.
  const codes = filterBreedOptions(opts, 'aberdeen').filter((o) => o.id !== null).map((o) => o.senasaCode);
  assert.deepEqual(codes, ['AA'], 'solo Aberdeen Angus matchea "aberdeen"');
  // "angus" es SUBSTRING de Aberdeen Angus Y Brangus → matchea ambos (búsqueda por substring, correcto).
  const both = filterBreedOptions(opts, 'angus').filter((o) => o.id !== null).map((o) => o.senasaCode).sort();
  assert.deepEqual(both, ['AA', 'BG']);
});

test('filterBreedOptions: matchea por CÓDIGO', () => {
  const opts = breedPickerOptions(CATALOG, null);
  const codes = filterBreedOptions(opts, 'bg').filter((o) => o.id !== null).map((o) => o.senasaCode);
  assert.deepEqual(codes, ['BG']);
});

test('filterBreedOptions: acentos-insensitive (búsqueda "hereford" matchea aunque tuviera tilde)', () => {
  const opts = breedPickerOptions(
    [{ id: 'x', senasaCode: 'PH', name: 'Pólled Héreford', species: 'bovine', active: true, sortOrder: 3 }],
    null,
  );
  const r = filterBreedOptions(opts, 'hereford').filter((o) => o.id !== null);
  assert.equal(r.length, 1);
});

test('filterBreedOptions: "Sin raza" SIEMPRE presente aunque la query no la matchee', () => {
  const opts = breedPickerOptions(CATALOG, null);
  const r = filterBreedOptions(opts, 'angus');
  assert.equal(r[0].id, null, '"Sin raza" debe seguir primera tras filtrar');
  assert.equal(r[0].name, SIN_RAZA_LABEL);
});

test('filterBreedOptions: sin match → solo "Sin raza"', () => {
  const opts = breedPickerOptions(CATALOG, null);
  const r = filterBreedOptions(opts, 'noexisteestaraza');
  assert.equal(r.length, 1);
  assert.equal(r[0].id, null);
});

// ─── selectedBreedLabel ────────────────────────────────────────────────────────────────────────────────

test('selectedBreedLabel: código presente → {senasaCode, name}', () => {
  assert.deepEqual(selectedBreedLabel(CATALOG, 'AA'), { senasaCode: 'AA', name: 'Aberdeen Angus' });
});

test('selectedBreedLabel: null → null', () => {
  assert.equal(selectedBreedLabel(CATALOG, null), null);
});

test('selectedBreedLabel: código sin match → null (no inventa)', () => {
  assert.equal(selectedBreedLabel(CATALOG, 'ZZZ'), null);
});

// ─── breedCodeForName (ficha: nombre de breed → senasa_code para el selectedCode del picker) ─────────────

test('breedCodeForName: nombre exacto → su código', () => {
  assert.equal(breedCodeForName(CATALOG, 'Aberdeen Angus'), 'AA');
  assert.equal(breedCodeForName(CATALOG, 'Hereford'), 'H');
});

test('breedCodeForName: match case/trim/acentos-insensitive (espeja el trigger 0113)', () => {
  assert.equal(breedCodeForName(CATALOG, '  aberdeen angus  '), 'AA');
  assert.equal(breedCodeForName(CATALOG, 'HEREFORD'), 'H');
});

test('breedCodeForName: null o vacío → null', () => {
  assert.equal(breedCodeForName(CATALOG, null), null);
  assert.equal(breedCodeForName(CATALOG, '   '), null);
});

test('breedCodeForName: nombre legacy/raro sin match → null (ninguna opción preseleccionada)', () => {
  assert.equal(breedCodeForName(CATALOG, 'Cruza vieja sin código'), null);
});

test('breedCodeForName: un nombre de raza generic/bubaline del catálogo igual resuelve su código (el filtro bovine es del picker, no de acá)', () => {
  // breedCodeForName busca en TODO el catálogo recibido; el filtro bovine+active lo aplica breedPickerOptions.
  // Si el animal tuviera breed='Sin Especificar' (S/E), igual resolvemos el código (la opción no estará en la
  // lista bovina del picker, pero el selectedCode no miente: refleja lo guardado).
  assert.equal(breedCodeForName(CATALOG, 'Sin Especificar'), 'S/E');
});

// ─── normalizeForSearch ────────────────────────────────────────────────────────────────────────────────

test('normalizeForSearch: lowercase + sin acentos + trim', () => {
  assert.equal(normalizeForSearch('  Áñgus  '), 'angus');
  assert.equal(normalizeForSearch('HEREFORD'), 'hereford');
  assert.equal(normalizeForSearch(''), '');
});
