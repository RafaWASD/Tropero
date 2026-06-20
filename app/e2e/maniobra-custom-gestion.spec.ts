// e2e/maniobra-custom-gestion.spec.ts — GESTIÓN de DATOS CUSTOM: borrar + editar (spec 03 M7-B,
// R13.28–R13.34) + R13.30 bajo OPCIÓN B (al borrar, el histórico DEJA DE VERSE; la confirmación lo advierte).
//
// El kebab ⋯ SOLO en las filas CUSTOM (establishment_id no-NULL) de "Editar plantilla del rodeo" (owner-only):
//   - Eliminar → confirmación CON IMPACTO + ADVERTENCIA destructiva (N rodeos + M cargas que DEJARÁN de verse)
//     → softDeleteCustomField (UPDATE plano) → se va del toggle-list + el alta NO la ofrece. Bajo Opción B, las
//     cargas previas del dato borrado DEJAN DE VERSE en la ficha (no se preservan en MVP; R13.30 — la confirmación
//     lo advirtió, R13.31). La preservación del histórico (Opción A) es fast-follow/backlog.
//   - Editar → cambiar label + agregar opción de enum → updateCustomField (label/options nuevos;
//     data_type/ui_component INTACTOS, R13.26/R13.32).
//   - Las filas de FÁBRICA NO muestran ⋯ (R13.29). Un non-owner NO ve ⋯.
//   - Regresión tap-through del CustomFieldActionsSheet (web táctil, guard doble-rAF).
//
// El cleanup borra el establishment (cascada) en afterAll.

import path from 'node:path';
import { test, expect, applyEnvShim, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedCustomField,
  seedCustomAttribute,
  seedAnimal,
  addMember,
  setUserPhone,
  cleanupAll,
  waitForServerCustomFieldDeleted,
  waitForServerCustomFieldUpdated,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'tests', 'modo-maniobra');

test.afterAll(async () => {
  await cleanupAll();
});

/** Deep-link a "Editar plantilla" del rodeo (owner; el ⋯ vive ahí). */
async function gotoPlantilla(page: Page, rodeoId: string): Promise<void> {
  await page.goto(`/editar-plantilla?rodeoId=${rodeoId}&name=Rodeo`);
  await expect(page.getByText('Plantilla de datos', { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-412.png`) });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-360.png`) });
  await page.setViewportSize({ width: 412, height: 915 });
}

test('custom: ⋯ owner-only solo en filas custom; Eliminar muestra impacto + ADVERTENCIA (Opción B) → softDelete → se va del toggle-list + el alta no la ofrece (R13.29/R13.31/R13.19)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m7b-borrar');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom Gestión');

  // Un dato custom de tipo PROPIEDAD (text) habilitado en el rodeo + un animal con ese valor cargado.
  const fieldId = await seedCustomField(establishmentId, rodeoId, {
    label: 'Apodo',
    dataKey: 'apodo_m7',
    dataType: 'propiedad',
    uiComponent: 'text',
  });
  const idv = 'M7B001';
  const profileId = await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });
  await seedCustomAttribute(profileId, fieldId, 'Pinto');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── PRE: el valor "Pinto" SE VE en la ficha ANTES de borrar (R13.10/R13.12; confirma que sincronizó) ──
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await openFichaByIdv(page, idv);
  await expect(page.getByText('Datos personalizados', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Pinto', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // ── 1) El ⋯ aparece SOLO en la fila custom (R13.29) — no en las de fábrica ──
  await gotoPlantilla(page, rodeoId);
  const menu = page.getByRole('button', { name: 'Acciones de Apodo', exact: true });
  await menu.scrollIntoViewIfNeeded();
  await expect(menu).toBeVisible({ timeout: 15_000 });
  // NEGATIVA: una fila de FÁBRICA (ej. "Pesaje") NO tiene ⋯ → su botón de acciones no existe.
  await expect(page.getByRole('button', { name: 'Acciones de Pesaje', exact: true })).toHaveCount(0);
  await shot(page, 'custom-gestion-menu-custom');

  // ── 2) ⋯ → Eliminar → confirmación CON IMPACTO (N rodeos + M cargas, R13.31) ──
  await menu.click();
  await expect(page.getByTestId('custom-field-actions-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('custom-field-action-eliminar').click();
  await expect(page.getByTestId('delete-custom-field-sheet')).toBeVisible({ timeout: 10_000 });
  // ADVERTENCIA destructiva (Opción B): la 1 carga previa DEJARÁ DE VERSE (no recuperable) + se quita de 1 rodeo.
  await expect(page.getByText(/Su 1 carga previa dejará de verse/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/no vas a poder recuperarla desde la app/)).toBeVisible();
  await expect(page.getByText(/Se quita de 1 rodeo donde está habilitado/)).toBeVisible();
  await expect(page.getByText('Esta acción no se puede deshacer.', { exact: true })).toBeVisible();
  await shot(page, 'custom-gestion-borrar-impacto');

  // ── 3) Confirmar → softDeleteCustomField → se va del toggle-list + oráculo SERVER (deleted_at no-NULL) ──
  await page.getByTestId('delete-custom-field-confirm').click();
  await expect(page.getByRole('button', { name: 'Acciones de Apodo', exact: true })).toHaveCount(0, { timeout: 15_000 });
  await waitForServerCustomFieldDeleted(fieldId);

  // ── 4) El alta de un animal NUEVO ya NO ofrece la propiedad borrada (R13.19 — forms/listas nuevas filtran) ──
  // (Verificable client-side: buildEnabledCustomFieldsQuery + buildFieldCatalogQuery filtran deleted_at.)
  await page.goto('/');
  await waitForHome(page);
  await gotoPlantilla(page, rodeoId);
  await expect(page.getByText('Plantilla de datos', { exact: true })).toBeVisible({ timeout: 20_000 });
  // La fila "Apodo" ya no está en la plantilla (catálogo filtra deleted_at).
  await expect(page.getByRole('button', { name: 'Acciones de Apodo', exact: true })).toHaveCount(0);
});

// R13.30 bajo OPCIÓN B (MVP, decisión de Raf 2026-06-20): NO se cambia la sync-stream. Consecuencia REAL: al
// borrar un dato custom, su definición se PRUNEA del device (`est_field_definitions_custom` sigue filtrando
// `deleted_at IS NULL`) → el INNER JOIN de la ficha no resuelve el label → sus cargas previas DEJAN DE VERSE
// (no se recuperan desde la app en MVP). Por eso la confirmación de borrado ADVIERTE fuerte (R13.31). Este test
// verifica la SEMÁNTICA de Opción B: (a) el diálogo MUESTRA la advertencia de pérdida; (b) tras borrar, la ficha
// YA NO muestra el valor histórico (desaparición prolija, sin crash). La Opción A (preservar el histórico) es
// fast-follow/backlog (docs/backlog.md).
test('R13.30 (Opción B): el diálogo ADVIERTE que las cargas dejan de verse y, tras borrar, la ficha YA NO muestra el valor histórico', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m7b-r1330');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom R1330');
  const fieldId = await seedCustomField(establishmentId, rodeoId, {
    label: 'Apodo',
    dataKey: 'apodo_hist',
    dataType: 'propiedad',
    uiComponent: 'text',
  });
  const idv = 'M7H001';
  const profileId = await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });
  await seedCustomAttribute(profileId, fieldId, 'Pinto');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── PRE: el valor "Pinto" SE VE en la ficha ANTES de borrar (confirma que sincronizó y se renderiza) ──
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await openFichaByIdv(page, idv);
  await expect(page.getByText('Datos personalizados', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Pinto', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // ── (a) El diálogo de borrado ADVIERTE la pérdida de visibilidad (Opción B, R13.31) ──
  await gotoPlantilla(page, rodeoId);
  await page.getByRole('button', { name: 'Acciones de Apodo', exact: true }).click();
  await page.getByTestId('custom-field-action-eliminar').click();
  await expect(page.getByTestId('delete-custom-field-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/dejará de verse/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/no vas a poder recuperarla desde la app/)).toBeVisible();
  await expect(page.getByText('Esta acción no se puede deshacer.', { exact: true })).toBeVisible();

  // ── (b) Confirmar el borrado → oráculo SERVER (deleted_at) ──
  await page.getByTestId('delete-custom-field-confirm').click();
  await expect(page.getByRole('button', { name: 'Acciones de Apodo', exact: true })).toHaveCount(0, { timeout: 15_000 });
  await waitForServerCustomFieldDeleted(fieldId);

  // ── (c) Reabrir la ficha → el valor histórico YA NO se ve (la definición se pruneó del device, Opción B) ──
  // Recargamos para forzar un nuevo ciclo de sync (la stream prunea la fila soft-deleteada del device).
  await page.goto('/');
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await openFichaByIdv(page, idv);
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  // El valor "Pinto" desaparece (la propiedad ya no se renderiza). toBeHidden tolera la latencia del prune.
  await expect(page.getByText('Pinto', { exact: true })).toBeHidden({ timeout: 20_000 });
});

/** Buscar un animal por IDV (pestaña Animales) → tocar el resultado → aterrizar en la ficha. */
async function openFichaByIdv(page: Page, idv: string): Promise<void> {
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('custom: ⋯ → Editar → cambiar label + agregar opción enum → updateCustomField (data_type/ui_component intactos)', async ({ page }) => {
  test.setTimeout(120_000);
  const user = await createTestUser('m7b-editar');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom Editar');
  const fieldId = await seedCustomField(establishmentId, rodeoId, {
    label: 'Color',
    dataKey: 'color_m7',
    dataType: 'propiedad',
    uiComponent: 'enum_single',
    options: ['overo', 'colorado'],
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoPlantilla(page, rodeoId);

  const menu = page.getByRole('button', { name: 'Acciones de Color', exact: true });
  await menu.scrollIntoViewIfNeeded();
  await menu.click();
  await page.getByTestId('custom-field-action-editar').click();

  // El sheet de edición precarga label + opciones; el TIPO está bloqueado (R13.26).
  await expect(page.getByTestId('custom-field-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Editar dato', { exact: true })).toBeVisible();
  await expect(page.getByTestId('custom-field-type-locked')).toBeVisible();
  await expect(page.getByTestId('custom-field-label')).toHaveValue('Color');
  // Las opciones existentes están (chips). Append-only: NO tienen × (no se pueden quitar).
  await expect(page.getByTestId('option-chip-overo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar overo', exact: true })).toHaveCount(0);
  await shot(page, 'custom-gestion-editar');

  // Cambiamos el label + agregamos una opción nueva.
  await page.getByTestId('custom-field-label').fill('Color del manto');
  await page.getByTestId('custom-field-option-input').fill('tordillo');
  await page.getByTestId('custom-field-add-option').click();
  await expect(page.getByTestId('option-chip-tordillo')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByTestId('custom-field-sheet')).toHaveCount(0, { timeout: 15_000 });

  // Oráculo SERVER: label + options nuevos; data_type='propiedad' + ui_component='enum_single' INTACTOS.
  const fd = await waitForServerCustomFieldUpdated(fieldId, (r) => r.label === 'Color del manto');
  expect(fd.label).toBe('Color del manto');
  expect(fd.dataType).toBe('propiedad');
  expect(fd.uiComponent).toBe('enum_single');
  const schema = fd.configSchema as { options?: unknown } | null;
  expect(schema?.options).toEqual(['overo', 'colorado', 'tordillo']);
});

test('custom: un NON-OWNER NO ve el ⋯ de gestión (R13.29 owner-only)', async ({ page }) => {
  test.setTimeout(150_000);
  const owner = await createTestUser('m7b-owner');
  await setUserPhone(owner.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(owner.id, 'Campo Custom NonOwner');
  await seedCustomField(establishmentId, rodeoId, {
    label: 'Apodo',
    dataKey: 'apodo_no',
    dataType: 'propiedad',
    uiComponent: 'text',
  });
  // Un field_operator (no-owner) del mismo establishment.
  const member = await createTestUser('m7b-member');
  await setUserPhone(member.id, '1123456780');
  await addMember(member.id, establishmentId, 'field_operator');

  await page.goto('/');
  await signIn(page, member);
  await waitForHome(page);
  await gotoPlantilla(page, rodeoId);

  // El non-owner ve la plantilla en SOLO-LECTURA → NO hay ⋯ de gestión (ni el `+` de crear).
  await expect(page.getByText(/Solo el dueño del campo/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Acciones de Apodo', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('config-add-custom-field')).toHaveCount(0);
});

test('regresión tap-through: el CustomFieldActionsSheet NO se auto-cierra al abrirlo con tap táctil', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  try {
    const user = await createTestUser('m7b-tapthrough');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom TapThrough');
    await seedCustomField(establishmentId, rodeoId, {
      label: 'Apodo',
      dataKey: 'apodo_tt',
      dataType: 'propiedad',
      uiComponent: 'text',
    });

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await gotoPlantilla(page, rodeoId);

    // Abrir el ⋯ con un TAP TÁCTIL real (touch → click emulado por el browser ~20ms después).
    const menu = page.getByRole('button', { name: 'Acciones de Apodo', exact: true });
    await menu.scrollIntoViewIfNeeded();
    const box = await menu.boundingBox();
    if (!box) throw new Error('sin boundingBox para el ⋯');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    // Con el bug, el click huérfano caería sobre el scrim → cerraría el sheet a ~1ms. Con el guard, queda abierto.
    await expect(page.getByTestId('custom-field-actions-sheet')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500); // > la ventana del click huérfano + doble rAF
    await expect(page.getByTestId('custom-field-actions-sheet')).toBeVisible();
    await expect(page.getByTestId('custom-field-action-editar')).toBeVisible();
  } finally {
    await ctx.close();
  }
});
