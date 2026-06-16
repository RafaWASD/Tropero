// e2e/maniobra-sanitaria.spec.ts — red de seguridad de las pantallas de paso RESTANTES de MODO MANIOBRAS
// (spec 03 M3.2b): SANITARIAS silent_apply (VACUNACIÓN R6.1, ANTIPARASITARIO R6.13, ANTIBIÓTICO R6.15),
// SANGRADO (1 tubo → lab_samples blood, R6.4), RASPADO (2 tubos → 2 lab_samples scrape_*, R6.11; solo
// machos R6.12) y PESAJE de TERNERO (R6.10).
//
// Tests:
//  1) MACHO con jornada {vacunación, antiparasitario, antibiótico, sangrado, raspado}: recorre las 5,
//     verifica server-side cada escritura CON session_id (deworming SIN route — D10; treatment; 2 vacunas →
//     2 sanitary_events vaccination; blood con tube; 2 scrape_* con sus tubos). Capturas sanitaria-silent /
//     sangrado / raspado.
//  2) HEMBRA con jornada {raspado, antiparasitario}: el raspado SE SALTA (R6.12 — applicability) → la
//     secuencia muestra solo el antiparasitario (· 1 de 1). Prueba positiva: nunca aparece el paso de raspado
//     y NO hay lab_samples scrape_* en el server.
//  3) TERNERA con jornada {pesaje}: pesaje de ternero (keypad) → weight_events; el header muestra la
//     categoría ternera (autocompletada por el espejo C6). Captura pesaje-ternero.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  setRodeoDataKey,
  RUN_TAG,
  waitForServerSanitaryWithSession,
  waitForServerLabSampleWithSession,
  waitForServerWeightEventWithSession,
  waitForServerInseminationWithSession,
  countScrapeSamples,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'design', 'maniobra-sanitaria');
// Capturas entregables del fix del hero truncado (para el veto de diseño del leader).
const FIX_OUT_DIR = path.join(__dirname, '..', '..', 'tests', 'modo-maniobra');

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
    if (!h) throw new Error('window.__rafaqBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/**
 * Arranca una jornada eligiendo el rodeo + las maniobras indicadas (en ese orden de selección = orden de
 * secuencia, R5.14) y aterriza en la identificación. Las maniobras se tocan por su `pool-row-<maniobra>`.
 */
async function startSession(page: Page, maniobras: readonly string[]): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // El pool con la 1ra maniobra prueba que el rodeo_data_config ya bajó al SQLite local. Dwell para asentar.
  await expect(page.getByTestId(`pool-row-${maniobras[0]}`)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  for (const m of maniobras) {
    await page.getByTestId(`pool-row-${m}`).click();
  }
  await expect(page.getByTestId(`selected-row-${maniobras.length - 1}`)).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Hero adaptativo (M2.1): con el mock conectable, el estado inicial es ConnectHero. Conectamos el mock →
  // pasa a ScanHero ("Acercá el bastón"), el camino conectado que este flujo asume.
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── 1) MACHO: las 5 maniobras restantes persisten con session_id. ──
test('sanitarias + sangrado + raspado sobre un macho persisten con session_id', async ({ page }) => {
  test.setTimeout(240_000);
  const user = await createTestUser('m32b-male');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Sanitaria M32b', {
    rodeoName: 'Cría machos',
    rodeoRawName: true,
  });
  const eid = makeEid();
  const visual = '0512';
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    visualAlt: visual,
    sex: 'male',
    categoryCode: 'toro',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Orden: vacunación → antiparasitario → antibiótico → sangrado → raspado.
  await startSession(page, ['vacunacion', 'antiparasitario', 'antibiotico', 'sangrado', 'raspado']);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 5', { exact: true })).toBeVisible({ timeout: 30_000 });

  // ── VACUNACIÓN (· 1 de 5): agregar 2 vacunas → Aplicar y seguir → 2 sanitary_events. ──
  await expect(page.getByTestId('vaccine-input')).toBeVisible();
  await page.getByTestId('vaccine-input').fill('Aftosa');
  await page.getByRole('button', { name: 'Agregar vacuna' }).click();
  await page.getByTestId('vaccine-input').fill('Mancha');
  await page.getByRole('button', { name: 'Agregar vacuna' }).click();
  await expect(page.getByTestId('vaccine-chip-Aftosa')).toBeVisible();
  await expect(page.getByTestId('vaccine-chip-Mancha')).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'vacunacion.png') });
  await page.getByRole('button', { name: 'Aplicar y seguir' }).click();

  // ── ANTIPARASITARIO (· 2 de 5): silent de 1 producto. Sin preconfig → arranca en edición → tipear. ──
  await expect(page.getByText('· 2 de 5', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('silent-product-input')).toBeVisible();
  await page.getByTestId('silent-product-input').fill('Ivermectina');
  await page.getByRole('button', { name: 'Aplicar y seguir' }).click();

  // ── ANTIBIÓTICO (· 3 de 5): silent de 1 producto. ──
  await expect(page.getByText('· 3 de 5', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('silent-product-input').fill('Oxitetraciclina');
  await page.getByRole('button', { name: 'Aplicar y seguir' }).click();

  // ── SANGRADO (· 4 de 5): 1 número de tubo → Confirmar. ──
  await expect(page.getByText('· 4 de 5', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('tube-input')).toBeVisible();
  await page.getByTestId('tube-input').fill('A-104');
  await page.screenshot({ path: path.join(OUT_DIR, 'sangrado.png') });
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();

  // ── RASPADO (· 5 de 5): 2 números de tubo (tricho + campylo) → Confirmar. ──
  await expect(page.getByText('· 5 de 5', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('tube-tricho')).toBeVisible();
  await page.getByTestId('tube-tricho').fill('TR-1');
  await page.getByTestId('tube-campylo').fill('CA-2');
  await page.screenshot({ path: path.join(OUT_DIR, 'raspado.png') });
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();

  // ── RESUMEN. ──
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  // Corregir el ANTIPARASITARIO desde el resumen (R5.9) → re-entra al silent_single con el producto ya
  // cargado → muestra el HERO del producto ("Ivermectina" GRANDE + "Cambiar producto"). Captura sanitaria-silent.
  await page.getByTestId('summary-row-antiparasitario').click();
  await expect(page.getByTestId('silent-product-hero')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Ivermectina', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'sanitaria-silent.png') });
  // Re-confirmar (sin cambiar) vuelve al resumen — prueba el round-trip de corrección del silent_single.
  await page.getByRole('button', { name: 'Aplicar y seguir' }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── PERSISTENCIA server-side (R5.11). ──
  // Vacunación: 2 sanitary_events vaccination con session.
  const vac = await waitForServerSanitaryWithSession(profileId, 'vaccination', { minCount: 2 });
  expect(vac.count).toBeGreaterThanOrEqual(2);
  expect(vac.productNames.sort()).toEqual(['Aftosa', 'Mancha']);
  // Antiparasitario → deworming (D10: SIN route → producto libre).
  const dew = await waitForServerSanitaryWithSession(profileId, 'deworming', { productName: 'Ivermectina' });
  // Antibiótico → treatment.
  const trt = await waitForServerSanitaryWithSession(profileId, 'treatment', { productName: 'Oxitetraciclina' });
  // Sangrado → lab_samples blood con el tubo.
  const blood = await waitForServerLabSampleWithSession(profileId, 'blood', { tubeNumber: 'A-104' });
  // Raspado → 2 lab_samples scrape_* con sus tubos.
  const tricho = await waitForServerLabSampleWithSession(profileId, 'scrape_tricho', { tubeNumber: 'TR-1' });
  const campylo = await waitForServerLabSampleWithSession(profileId, 'scrape_campylo', { tubeNumber: 'CA-2' });
  // Todos en la MISMA jornada.
  for (const s of [dew.sessionId, trt.sessionId, blood.sessionId, tricho.sessionId, campylo.sessionId]) {
    expect(s).toBe(vac.sessionId);
  }
});

// ── 2) HEMBRA: el raspado SE SALTA (R6.12) → solo corre la otra maniobra. ──
test('raspado se salta para una hembra (R6.12); el resto de la jornada corre', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m32b-female');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Hembra M32b');
  const eid = makeEid();
  const visual = `${RUN_TAG}-F`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    visualAlt: visual,
    sex: 'female',
    categoryCode: 'multipara',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Jornada {raspado, antiparasitario}: sobre una hembra el raspado se salta → secuencia de 1 paso.
  await startSession(page, ['raspado', 'antiparasitario']);
  await bastonazo(page, eid);

  // La secuencia muestra · 1 de 1 (solo el antiparasitario; el raspado NO entra a la secuencia de una hembra).
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  // El paso de raspado (2 tubos) NUNCA aparece.
  await expect(page.getByTestId('tube-tricho')).toHaveCount(0);
  // Cargar el antiparasitario para cerrar el animal.
  await page.getByTestId('silent-product-input').fill('Ivermectina');
  await page.getByRole('button', { name: 'Aplicar y seguir' }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // El antiparasitario persistió; NO hay scrape_* (el raspado nunca corrió).
  await waitForServerSanitaryWithSession(profileId, 'deworming', { productName: 'Ivermectina' });
  expect(await countScrapeSamples(profileId)).toBe(0);
});

// ── 3) TERNERA: pesaje de ternero (keypad) → weight_events; header con categoría ternera. ──
test('pesaje de ternero persiste con session_id (R6.10)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('m32b-calf');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Ternero M32b', {
    rodeoName: 'Cría',
    rodeoRawName: true,
  });
  const eid = makeEid();
  const visual = '0077';
  const recentBirth = new Date();
  recentBirth.setMonth(recentBirth.getMonth() - 5); // 5 meses → ternera (< 1 año)
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    visualAlt: visual,
    sex: 'female',
    categoryCode: 'ternera',
    birthDate: recentBirth.toISOString().slice(0, 10),
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // La jornada elige PESAJE DE TERNERO (no el pesaje genérico): para una ternera, el pesaje genérico se
  // SALTA y el de ternero APLICA (excluyentes por categoría, R6.9/R6.10 — mata el doble pesaje). Si la
  // jornada hubiera elegido `pesaje`, la secuencia para esta ternera quedaría VACÍA (· 0 pasos).
  await startSession(page, ['pesaje_ternero']);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // El header muestra la categoría TERNERA (autocompletada por el espejo C6; R6.10 no la re-captura). El
  // header la pinta como "<rodeo> · <categoría>" en un solo nodo → match por substring.
  await expect(page.getByText(/· Ternera$/).first()).toBeVisible();

  // Keypad: 95 kg → Confirmar.
  await expect(page.getByTestId('weight-display')).toBeVisible();
  await page.getByRole('button', { name: '9', exact: true }).click();
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.screenshot({ path: path.join(OUT_DIR, 'pesaje-ternero.png') });
  await page.getByRole('button', { name: 'Confirmar peso' }).click();

  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Server: weight_events 95 kg con session_id (el oráculo busca por establishment_id).
  const w = await waitForServerWeightEventWithSession(establishmentId, 95);
  expect(w.sessionId).toBeTruthy();
});

/**
 * Arranca una jornada SOLO de inseminación y configura la pajuela de la tanda (preconfig, R1.7) vía el
 * bottom sheet del wizard. `pajuela` puede ser coma-separado ("Toro 123, Toro 456") → pajuelasFor produce
 * >1 → InseminacionStep muestra el SELECTOR (R6.5); un valor simple → 1 → confirmar de un toque.
 */
async function startInseminacionSession(page: Page, pajuela: string): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // El pool con inseminación prueba que el rodeo_data_config (con inseminacion ENABLED) ya bajó al SQLite.
  await expect(page.getByTestId('pool-row-inseminacion')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await page.getByTestId('pool-row-inseminacion').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  // Abrir el sheet de preconfig (tocar el cuerpo de la fila seleccionada) → setear la pajuela de la tanda.
  await page.getByTestId('selected-body-0').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('maneuver-config-input').fill(pajuela);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0);
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Hero adaptativo (M2.1): conectamos el mock → ScanHero ("Acercá el bastón"), el camino conectado.
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── 4) INSEMINACIÓN — 1 pajuela preconfigurada → confirmar de un toque (R6.5). ──
test('inseminación con 1 pajuela preconfigurada confirma de un toque (R6.5)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m32b-ia1');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo IA1 M32b', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  // Inseminación nace DESHABILITADA en la plantilla de cría (0018) → prenderla para que el wizard la ofrezca.
  await setRodeoDataKey(rodeoId, 'inseminacion', true);
  const eid = makeEid();
  const visual = '0631';
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    visualAlt: visual,
    sex: 'female',
    categoryCode: 'multipara',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startInseminacionSession(page, 'Toro 123');
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // 1 pajuela → modo SINGLE: el HERO muestra la pajuela "Toro 123" + "Aplicar y seguir" (un toque).
  await expect(page.getByTestId('silent-product-hero')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Toro 123', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'inseminacion.png') });
  await page.getByRole('button', { name: 'Aplicar y seguir' }).click();

  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Server: reproductive_events service ai con la pajuela en notes + session_id (R5.11/R6.5).
  const ia = await waitForServerInseminationWithSession(profileId, { semenName: 'Toro 123' });
  expect(ia.sessionId).toBeTruthy();
  expect(ia.notes).toBe('Toro 123');
});

// ── 5) INSEMINACIÓN — >1 pajuela disponible → SELECTOR (R6.5). ──
test('inseminación con >1 pajuela ofrece selector (R6.5)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m32b-ia2');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo IA2 M32b');
  await setRodeoDataKey(rodeoId, 'inseminacion', true);
  const eid = makeEid();
  const visual = `${RUN_TAG}-IA2`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    visualAlt: visual,
    sex: 'female',
    categoryCode: 'multipara',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // >1 pajuela: coma-separado → pajuelasFor produce 2 → SELECTOR.
  await startInseminacionSession(page, 'Toro 123, Toro 456');
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // >1 pajuela → SELECTOR: 2 bloques + "Otra pajuela". El hero single NO aparece.
  await expect(page.getByTestId('pajuela-block-Toro 123')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('pajuela-block-Toro 456')).toBeVisible();
  await expect(page.getByTestId('pajuela-other')).toBeVisible();
  await expect(page.getByTestId('silent-product-hero')).toHaveCount(0);
  // Elegir la 2da pajuela de un toque → aplica y avanza al resumen.
  await page.getByTestId('pajuela-block-Toro 456').click();

  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Server: la pajuela ELEGIDA ("Toro 456") quedó en notes con session_id.
  const ia = await waitForServerInseminationWithSession(profileId, { semenName: 'Toro 456' });
  expect(ia.sessionId).toBeTruthy();
  expect(ia.notes).toBe('Toro 456');
});

// ── 6) HERO del producto silent_apply: NINGÚN nombre overflowea horizontal a 360 NI 412 (bugfix web). ──
//
// El truncado/overflow es VISUAL (CSS): el `textContent` del hero ve el string COMPLETO aunque se corte por
// pantalla → NO se puede assertear por texto. Se verifica por LAYOUT: el boundingBox del hero
// (`silent-product-hero`) tiene que quedar DENTRO del viewport (x>=0 y x+width<=ancho) para corto/medio/
// largo/patológico, a 360 Y 412 px. Antes del fix ($11=64px fijo + adjustsFontSizeToFit NO-OP en web), un
// nombre largo sin espacios se salía por ambos lados (`tests/modo-maniobra/antibiotico-cortado.png`).
test('el hero del producto silent_apply nunca overflowea horizontal a 360 ni 412 (R6.15)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m32b-hero');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Hero M32b', {
    rodeoName: 'Cría machos',
    rodeoRawName: true,
  });
  const eid = makeEid();
  const visual = '0900';
  await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    visualAlt: visual,
    sex: 'male',
    categoryCode: 'toro',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Jornada SOLO de antibiótico → el paso silent_apply (sin preconfig → arranca en el input).
  await startSession(page, ['antibiotico']);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('silent-product-input')).toBeVisible();

  // Tipea un nombre → Enter (onSubmitEditing → commitTyped) → entra al modo HERO (sin avanzar la maniobra).
  // Mide el hero y verifica que su caja queda DENTRO del ancho del viewport. Después vuelve al input
  // ("Cambiar producto") para el siguiente caso.
  async function assertHeroFits(name: string, viewportW: number, shotPath?: string): Promise<void> {
    await page.getByTestId('silent-product-input').fill(name);
    await page.getByTestId('silent-product-input').press('Enter');
    const hero = page.getByTestId('silent-product-hero');
    await expect(hero).toBeVisible({ timeout: 10_000 });
    const box = await hero.boundingBox();
    if (!box) throw new Error(`sin boundingBox del hero para "${name}"`);
    // Fit HORIZONTAL: la caja del hero NO se sale por izquierda ni por derecha (tolerancia 1px sub-pixel).
    expect(box.x, `hero "${name}" @${viewportW}: borde izquierdo dentro`).toBeGreaterThanOrEqual(-1);
    expect(
      box.x + box.width,
      `hero "${name}" @${viewportW}: borde derecho dentro (x=${box.x.toFixed(1)} w=${box.width.toFixed(1)})`,
    ).toBeLessThanOrEqual(viewportW + 1);
    // Fit VERTICAL: un nombre extremo no debe empujar "Cambiar producto" fuera de la card (numberOfLines={2}
    // lo elipsa). El botón sigue visible y dentro del viewport alto → la card no rebalsó hacia abajo.
    const change = page.getByTestId('silent-edit-product');
    await expect(change).toBeVisible();
    const changeBox = await change.boundingBox();
    if (!changeBox) throw new Error(`sin boundingBox del botón Cambiar para "${name}"`);
    const viewportH = page.viewportSize()?.height ?? 0;
    expect(
      changeBox.y + changeBox.height,
      `botón Cambiar "${name}" @${viewportW}: dentro del alto (y+h=${(changeBox.y + changeBox.height).toFixed(1)})`,
    ).toBeLessThanOrEqual(viewportH + 1);
    if (shotPath) await page.screenshot({ path: shotPath });
    // Volver a edición para el próximo caso.
    await change.click();
    await expect(page.getByTestId('silent-product-input')).toBeVisible({ timeout: 10_000 });
  }

  const TIPICO = 'Oxitetraciclina'; // 15 ch — nombre real de vet, debe entrar COMPLETO y grande.
  const PATOLOGICO = 'Ivermectina' + 'a'.repeat(40); // string largo SIN espacios (lo que tipeó Raf).
  const EXTREMO = 'x'.repeat(200); // absurdo: 200 ch sin espacios → token piso + word-break + elipsis a 2 líneas.
  const MEDIO = 'Closantel + Ivermectina'; // 23 ch — combinación de dos principios.
  const CORTO = 'Aftosa'; // 6 ch — el más grande.

  // ── A 412 px (viewport default de la suite). ──
  await assertHeroFits(CORTO, 412);
  await assertHeroFits(MEDIO, 412);
  await assertHeroFits(TIPICO, 412, path.join(FIX_OUT_DIR, 'antibiotico-fix-412.png'));
  await assertHeroFits(PATOLOGICO, 412, path.join(FIX_OUT_DIR, 'antibiotico-largo-412.png'));
  await assertHeroFits(EXTREMO, 412);

  // ── A 360 px (el ancho de pantalla más chico que soportamos). ──
  await page.setViewportSize({ width: 360, height: 800 });
  await assertHeroFits(CORTO, 360);
  await assertHeroFits(MEDIO, 360);
  await assertHeroFits(TIPICO, 360, path.join(FIX_OUT_DIR, 'antibiotico-fix-360.png'));
  await assertHeroFits(PATOLOGICO, 360, path.join(FIX_OUT_DIR, 'antibiotico-largo-360.png'));
  await assertHeroFits(EXTREMO, 360);
});
