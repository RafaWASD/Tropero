// e2e/ficha-circunferencia-escrotal.spec.ts — TARJETA DE TENDENCIA de CIRCUNFERENCIA ESCROTAL (CE) en la
// ficha del animal + la CE en el timeline (spec 03 M6-C.2, US-14 R14.14). Backend M6 live (0098/0099/0100).
//
// Cubre el display read-only (frontend puro) de M6-C.2:
//   A) TORO ENTERO con ≥1 CE → la ficha muestra la tarjeta "Circunferencia escrotal" con la SERIE (cm + edad
//      + fecha, es-AR coma decimal "36,5 cm") + la mini-tendencia, y la CE aparece en el TIMELINE de eventos.
//   B) HEMBRA → NO se muestra la tarjeta (paridad con la fila repro solo-hembras, al revés).
//   C) CASTRADO (novillo) → NO se muestra la tarjeta (macho NO entero).
//
// Capturas web TÁCTIL (hasTouch, 412 + 360) → tests/modo-maniobra/:
//   - ficha-ce-tarjeta-{360,412}.png — la ficha del toro con la tarjeta de tendencia (serie + mini-tendencia)
//
// La CE se siembra DIRECTO por service_role (seedScrotalMeasurement) — el display lee el histórico LOCAL
// (fetchScrotalHistory) tras el sync. Web táctil real (memoria reference_rn_web_pitfalls). Cleanup en afterAll.

import path from 'node:path';
import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedScrotalMeasurement,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'tests', 'modo-maniobra');

// Viewport táctil (manga): la ficha se veta en web táctil real, no desktop.
test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test.afterAll(async () => {
  await cleanupAll();
});

/** Buscar un animal por su IDV en la lista → tocar el resultado → aterrizar en la ficha. */
async function openFichaByIdv(page: import('@playwright/test').Page, idv: string): Promise<void> {
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.tap();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── A: TORO ENTERO con ≥1 CE → tarjeta de tendencia (serie + mini-tendencia, es-AR) + CE en el timeline ──
test('ficha de un TORO entero con CE: tarjeta de tendencia (serie cm+edad+fecha es-AR) + CE en el timeline', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m6c2-toro');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CE ficha', {
    rodeoName: 'Cría toros',
    rodeoRawName: true,
  });
  // Toro ENTERO (is_castrated=false) con fecha de nacimiento → entero adulto (isBullEntire=true).
  const idv = `CEF${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'male',
    categoryCode: 'toro',
    isCastrated: false,
    birthDate: '2022-06-01',
  });
  // Serie longitudinal de 3 mediciones (la CE crece con la edad): 32 → 35,5 → 38 cm. La más reciente (38)
  // es la que la mini-tendencia resalta + la 1ra fila de la serie (más reciente primero).
  await seedScrotalMeasurement(profileId, { circumferenceCm: 32, ageMonths: 18, measuredAt: '2024-01-15' });
  await seedScrotalMeasurement(profileId, { circumferenceCm: 35.5, ageMonths: 24, measuredAt: '2024-07-20' });
  await seedScrotalMeasurement(profileId, { circumferenceCm: 38, ageMonths: 30, measuredAt: '2025-01-10' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFichaByIdv(page, idv);

  // La TARJETA "Circunferencia escrotal" está presente (solo machos enteros, R14.14).
  await expect(page.getByText('Circunferencia escrotal', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // La SERIE muestra las 3 mediciones en es-AR (coma decimal). La más reciente arriba ("38 cm"), luego
  // "35,5 cm" y "32 cm". El "35,5 cm" prueba la coma decimal es-AR.
  await expect(page.getByText('38 cm', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('35,5 cm', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('32 cm', { exact: true }).first()).toBeVisible();
  // La edad snapshot + fecha de la medición más reciente: "30 meses · 10 ene" (es-AR; el día depende del
  // formateo date-only). Verificamos al menos la edad en meses.
  await expect(page.getByText(/30\s*meses/).first()).toBeVisible();

  // Scrolleamos la tarjeta de CE a la vista para la captura (vive debajo del fold de la ficha).
  await page.getByText('Circunferencia escrotal', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'ficha-ce-tarjeta-412.png') });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByText('Circunferencia escrotal', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'ficha-ce-tarjeta-360.png') });
  await page.setViewportSize({ width: 412, height: 915 });

  // La CE aparece en el TIMELINE de eventos (riel) — el evento "Circunferencia escrotal" se compone en el
  // cliente. Hay al menos un nodo de CE con su valor (puede haber 3). El título "Historial" está presente.
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 15_000 });
  // En el riel el evento de CE lleva el título "Circunferencia escrotal" + el detalle "38 cm · 30 meses".
  const timelineNode = page.getByText(/38\s*cm\s*·\s*30\s*meses/).first();
  await expect(timelineNode).toBeVisible({ timeout: 15_000 });
  // Captura del riel con la CE (la más reciente arriba del historial).
  await timelineNode.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'ficha-ce-timeline-412.png') });
});

// ── A2: serie LARGA (>4 mediciones) → la lista scrollea con affordance (la card no crece sin fin) ──
test('ficha de un TORO con serie LARGA de CE: la lista scrollea (affordance), muestra la más reciente', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m6c2-long');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CE larga', {
    rodeoName: 'Cría toros',
    rodeoRawName: true,
  });
  const idv = `CEL${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv, sex: 'male', categoryCode: 'toro', isCastrated: false, birthDate: '2021-06-01',
  });
  // 7 mediciones (excede SCROTAL_VISIBLE_ROWS=4 → la lista se capa y scrollea con fade). La más reciente
  // (2025-12, 40 cm) debe ser visible al tope; una vieja (2022-01, 30 cm) queda bajo el fold (scroll).
  const series: Array<[number, number, string]> = [
    [30, 12, '2022-01-10'],
    [31.5, 15, '2022-04-10'],
    [33, 18, '2022-07-10'],
    [35, 21, '2022-10-10'],
    [36.5, 24, '2023-01-10'],
    [38, 30, '2024-01-10'],
    [40, 42, '2025-12-10'],
  ];
  for (const [cm, age, d] of series) {
    await seedScrotalMeasurement(profileId, { circumferenceCm: cm, ageMonths: age, measuredAt: d });
  }

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFichaByIdv(page, idv);

  await expect(page.getByText('Circunferencia escrotal', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  // La más reciente (40 cm) está arriba de la serie (visible sin scrollear la lista interna).
  await expect(page.getByText('40 cm', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  // Captura de la serie larga (lista capeada + fade de affordance abajo + mini-tendencia de 7 barras).
  await page.getByText('Circunferencia escrotal', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, 'ficha-ce-serie-larga-412.png') });
  // La más vieja (30 cm) existe pero está bajo el fold de la lista capeada → reachable por scroll interno.
  // scrollIntoViewIfNeeded fuerza el scroll del contenedor scrolleable → si NO scrolleara, no sería visible.
  const oldest = page.getByText('30 cm', { exact: true }).first();
  await oldest.scrollIntoViewIfNeeded();
  await expect(oldest).toBeVisible({ timeout: 10_000 });
});

// ── B: HEMBRA → NO se muestra la tarjeta de tendencia de CE ──
test('ficha de una HEMBRA: NO muestra la tarjeta de circunferencia escrotal', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('m6c2-hembra');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CE hembra', {
    rodeoName: 'Cría vacas',
    rodeoRawName: true,
  });
  const idv = `CEH${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'multipara',
    birthDate: '2020-03-01',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFichaByIdv(page, idv);

  // La sección "Datos del animal" confirma que la ficha cargó; la tarjeta de CE NO está (hembra).
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Circunferencia escrotal', { exact: true })).toHaveCount(0);
});

// ── C: CASTRADO (novillo) → NO se muestra la tarjeta (macho NO entero) ──
test('ficha de un CASTRADO (novillo): NO muestra la tarjeta de circunferencia escrotal', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('m6c2-cast');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CE cast', {
    rodeoName: 'Cría novillos',
    rodeoRawName: true,
  });
  const idv = `CEC${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'male',
    categoryCode: 'novillo',
    isCastrated: true,
  });
  // Aunque tuviera una CE histórica (caso borde: se castró después de medirla), la tarjeta NO se muestra a un
  // castrado (R14.2 — la tarjeta es solo para machos enteros; el dato existe pero no se surfacea acá).
  await seedScrotalMeasurement(profileId, { circumferenceCm: 34, ageMonths: 20, measuredAt: '2024-05-01' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFichaByIdv(page, idv);

  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Circunferencia escrotal', { exact: true })).toHaveCount(0);
});
