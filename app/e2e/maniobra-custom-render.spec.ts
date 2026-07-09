// e2e/maniobra-custom-render.spec.ts — RENDER GENÉRICO de un dato/maniobra CUSTOM (spec 03 M5-C.3, R13.8/R13.10).
//
// Cubre el camino end-to-end que M5-C.2 dejó pendiente: una maniobra/propiedad custom CREADA + HABILITADA en un
// rodeo (acá sembrada por service_role con seedCustomField; la CREACIÓN por UI la testea maniobra-custom.spec.ts)
//   1) MANIOBRA custom (R13.8): aparece en el wizard → SELECCIONABLE → entra a la secuencia → su paso se
//      renderiza por ui_component (enum_single = bloques) → captura → custom_measurements (oráculo server, con
//      session_id). + un caso numeric (keypad) por separado para la captura PNG.
//   2) PROPIEDAD custom (R13.10): aparece en el form de ALTA (paso 4) → se carga → custom_attributes (oráculo).
//      + aparece en la FICHA del animal (ver + editar).
//
// Capturas (412 + 360, web táctil con hasTouch) → tests/modo-maniobra/:
//   - custom-render-enum-{360,412}.png      — paso de maniobra custom enum_single (bloques)
//   - custom-render-numeric-{360,412}.png   — paso de maniobra custom numeric (keypad)
//   - custom-prop-alta-{360,412}.png        — propiedad custom en el form de alta
//   - custom-prop-ficha-{360,412}.png       — propiedad custom en la ficha (ver/editar)
//
// El cleanup borra el establishment (cascada) en afterAll.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedCustomField,
  setUserPhone,
  cleanupAll,
  waitForServerAnimalProfile,
  waitForServerCustomMeasurement,
  waitForServerCustomAttribute,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'tests', 'modo-maniobra');

test.afterAll(async () => {
  await cleanupAll();
});

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-412.png`) });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-360.png`) });
  await page.setViewportSize({ width: 412, height: 915 });
}

/** Arranca una jornada eligiendo el rodeo + tildando la maniobra custom (por su label) → identificar. */
async function startSessionWithCustomManeuver(page: Page, customLabel: string): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByText('Elegí las maniobras', { exact: true })).toBeVisible({ timeout: 20_000 });
  // La maniobra custom aparece bajo "Maniobras personalizadas" (sincronizó del server) → tildarla.
  const customRow = page.getByText(customLabel, { exact: true });
  await expect(customRow).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500); // dwell: el rodeo_data_config custom se asienta antes de la carga rápida
  await customRow.click();
  // Con la custom elegida el CTA habilita (Continuar (1)).
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── PARTE A: maniobra custom enum_single seleccionable → secuencia → render (bloques) → captura ──
test('maniobra custom enum_single: seleccionable → secuencia → bloques → captura a custom_measurements', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m5c3-enum');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom Render', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const fieldId = await seedCustomField(establishmentId, rodeoId, {
    label: 'Ángulo de pezuñas',
    dataKey: 'angulo_pezunas',
    dataType: 'maniobra',
    uiComponent: 'enum_single',
    options: ['Adentro', 'Afuera', 'Normal'],
  });
  const eid = makeEid();
  const visual = '0512';
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    idv: visual,
    sex: 'female',
    categoryCode: 'vaquillona',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  // El animal + la maniobra custom bajaron por la stream (visible en la lista = sincronizó al SQLite local).
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionWithCustomManeuver(page, 'Ángulo de pezuñas');

  // Bastonazo → found → auto-avance a la carga rápida con la maniobra CUSTOM (· 1 de 1).
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  // La línea de maniobra muestra el LABEL del field custom (no un ManeuverKind).
  await expect(page.getByText('Ángulo de pezuñas', { exact: true }).first()).toBeVisible();
  // El render por ui_component enum_single = bloques full-width con las 3 opciones.
  await expect(page.getByTestId('custom-enum-block-Adentro')).toBeVisible();
  await expect(page.getByTestId('custom-enum-block-Afuera')).toBeVisible();
  await expect(page.getByTestId('custom-enum-block-Normal')).toBeVisible();
  await shot(page, 'custom-render-enum');

  // Elegir "Afuera" → captura + avanza al resumen.
  await page.getByTestId('custom-enum-block-Afuera').click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 15_000 });
  // El resumen muestra el label + el valor legible.
  await expect(page.getByText('Ángulo de pezuñas', { exact: true })).toBeVisible();
  await expect(page.getByText('Afuera', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Oráculo SERVER: la captura aterrizó en custom_measurements con session_id + value="Afuera" (jsonb string).
  const m = await waitForServerCustomMeasurement(profileId, fieldId, 'Afuera');
  expect(m.sessionId).toBeTruthy();
});

// ── PARTE A (numeric): captura del keypad de una maniobra custom numeric ──
test('maniobra custom numeric: render keypad → captura número a custom_measurements', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m5c3-num');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom Num', {
    rodeoName: 'Cría machos',
    rodeoRawName: true,
  });
  const fieldId = await seedCustomField(establishmentId, rodeoId, {
    label: 'Score propio',
    dataKey: 'score_propio',
    dataType: 'maniobra',
    uiComponent: 'numeric',
  });
  const eid = makeEid();
  const visual = '0777';
  const profileId = await seedAnimal(establishmentId, rodeoId, { tag: eid, idv: visual, sex: 'male', categoryCode: 'torito' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionWithCustomManeuver(page, 'Score propio');
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('custom-num-display')).toBeVisible();
  // Teclear 7 → display "7" → captura.
  await page.getByRole('button', { name: '7', exact: true }).first().click();
  await expect(page.getByTestId('custom-num-display').getByText('7', { exact: true })).toBeVisible();
  await shot(page, 'custom-render-numeric');
  await page.getByTestId('custom-confirm').click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  // Oráculo SERVER: la captura numérica aterrizó como NÚMERO jsonb (7, no "7").
  const m = await waitForServerCustomMeasurement(profileId, fieldId, 7);
  expect(m.sessionId).toBeTruthy();
});

// ── PARTE B: propiedad custom en alta → custom_attributes; + visible/editable en la ficha ──
test('propiedad custom: aparece en el alta (paso 4) → custom_attributes; visible + editable en la ficha', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m5c3-prop');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom Prop');
  const fieldId = await seedCustomField(establishmentId, rodeoId, {
    label: 'Apodo',
    dataKey: 'apodo',
    dataType: 'propiedad',
    uiComponent: 'text',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  await gotoAnimales(page);
  const emptyCta = page.getByRole('button', { name: 'Dar de alta tu primer animal' });
  await expect(emptyCta).toBeVisible({ timeout: 20_000 });
  // Dwell: la propiedad custom + su rodeo_data_config se asientan en el SQLite local antes del alta.
  await page.waitForTimeout(3000);
  await emptyCta.click();

  // Wizard alta: sexo → categoría → datos (con 1 rodeo, arranca en sexo).
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Categoría Vaquillona', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Identificador = caravana visual numérica (el built-in "Nombre / seña" fue removido, delta #2 RNA.2.1). El
  // establishment está aislado por usuario → el idv resuelve el perfil exacto en el oráculo server.
  const idv = `6194${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);

  // La SECCIÓN "Datos personalizados" del alta muestra la propiedad custom (text).
  await expect(page.getByText('Datos personalizados', { exact: true })).toBeVisible({ timeout: 15_000 });
  const apodoInput = page.getByTestId('custom-prop-text').first();
  await expect(apodoInput).toBeVisible();
  await apodoInput.fill('Pinto');
  await shot(page, 'custom-prop-alta');

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Aterriza en la ficha del recién creado. Resolvemos su profileId del server por el visual.
  await expect(page.getByText('Identificación', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Oráculo SERVER: el apodo aterrizó en custom_attributes (value="Pinto" jsonb string).
  // El profileId lo descubrimos por el idv del animal recién creado.
  const { id: profileId } = await waitForServerAnimalProfile(establishmentId, { idv });
  await waitForServerCustomAttribute(profileId, fieldId, 'Pinto');

  // ── La FICHA muestra "Datos personalizados" con el current-value + permite editar ──
  const fichaSection = page.getByText('Datos personalizados', { exact: true });
  await expect(fichaSection).toBeVisible({ timeout: 20_000 });
  // El apodo es HERO → la fila de la lista (montada hidden detrás de la ficha) tiene su propio <span>Pinto</span>;
  // filtramos por `visible:true` para apuntar al de la ficha, no al oculto (memoria reference_e2e_sheet_no_nav_oracle).
  await expect(page.getByText('Pinto', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
  await fichaSection.scrollIntoViewIfNeeded(); // la sección de custom va al fondo → scroll para la captura
  await shot(page, 'custom-prop-ficha');

  // Editar el apodo in-place: tocar "Editar" → cambiar → Guardar → custom_attributes se pisa (LWW).
  await page.getByRole('button', { name: 'Editar Apodo', exact: true }).click();
  const fichaInput = page.getByTestId('custom-prop-text').first();
  await expect(fichaInput).toBeVisible();
  await fichaInput.fill('Manchado');
  await page.getByTestId(`ficha-custom-save-${fieldId}`).click();
  await expect(page.getByText('Manchado', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await waitForServerCustomAttribute(profileId, fieldId, 'Manchado');
});
