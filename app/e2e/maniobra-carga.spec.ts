// e2e/maniobra-carga.spec.ts — red de seguridad del FRAME de CARGA RÁPIDA de MODO MANIOBRAS (spec 03 M2.2).
//
// Vertical slice DEMOABLE end-to-end: identify (M2.1-core) → CARGA RÁPIDA (frame real: secuencia de
// maniobras en orden de config) → TACTO (binario PREÑADA + tamaño CABEZA) → PESAJE (keypad) → RESUMEN por
// animal (corregible) → CONFIRMAR → siguiente animal + contador de progreso. Persistencia VERIFICABLE: los
// eventos aterrizan en el server CON `session_id` (R5.11), probado con los oráculos de service_role. + un
// test OFFLINE (toda la secuencia + escrituras sin red → reconexión → drenado → eventos en Supabase).
//
// Cómo se llega: se arranca una jornada con TACTO + PESAJE en el wizard (rodeo de cría → ambas
// habilitadas) → /maniobra/identificar; el bastonazo (MockAdapter bajo el flag __RAFAQ_BLE_E2E__) a un
// animal del campo → auto-avance a /maniobra/carga con el sessionId + profileId reales.
//
// Capturas 412×915 (viewport del project) para el reporte del implementer: carga rápida con identidad real,
// paso tacto, paso pesaje, RESUMEN del animal → design/maniobra-carga/.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
  waitForServerWeightEventWithSession,
  waitForServerTactoWithSession,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'design', 'maniobra-carga');

test.afterAll(async () => {
  await cleanupAll();
});

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/**
 * Espejo del `formatEidReadable` del cliente (src/utils/eid-format.ts): EID 15 díg → "PPP NNNN NNNN NNNN".
 * Se inlinea (los e2e no importan de `src/` — los aliases `@/` no se resuelven bajo Playwright) para
 * aseverar que el tag electrónico aparece MUTED y AGRUPADO en el header (mismo formato que la UI).
 */
function eidReadable(eid: string): string {
  if (!/^\d{15}$/.test(eid)) return eid;
  const rest = eid.slice(3);
  return `${eid.slice(0, 3)} ${rest.slice(0, 4)} ${rest.slice(4, 8)} ${rest.slice(8, 12)}`;
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
 * Arranca una jornada de manga con TACTO + PESAJE (ambas habilitadas en cría) y aterriza en la
 * identificación. Devuelve cuando el hero de escaneo está visible.
 */
async function startSessionTactoPesaje(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // El pool con las maniobras prueba que el rodeo_data_config del rodeo YA está en el SQLite local (mismo
  // gating que usará la carga rápida). Esperamos a verlas + un dwell para que el sync se asiente (la fila
  // recién sembrada por service_role tarda en propagarse por la stream → el frame la necesita estable).
  await expect(page.getByTestId('pool-row-tacto')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  // Orden de selección = orden de la secuencia (R5.14): tacto primero, pesaje después.
  await page.getByTestId('pool-row-tacto').click();
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-1')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Hero adaptativo (M2.1): con el mock conectable, el estado inicial es ConnectHero ("Conectá el bastón").
  // Conectamos el mock → pasa a ScanHero ("Acercá el bastón"), el camino conectado que estos flujos asumen.
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/**
 * Arranca una jornada con SOLO PESAJE (foco en flujos donde el tacto no aporta — corrección R5.9). Una
 * sola maniobra ⇒ el frame muestra "· 1 de 1" y el paso de pesaje directo.
 */
async function startSessionPesaje(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-pesaje')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta antes de la carga rápida
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Hero adaptativo (M2.1): con el mock conectable, el estado inicial es ConnectHero ("Conectá el bastón").
  // Conectamos el mock → pasa a ScanHero ("Acercá el bastón"), el camino conectado que estos flujos asumen.
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Teclea un peso entero en el keypad de PesajeStep (dígito por dígito). */
async function typeWeight(page: Page, kg: string): Promise<void> {
  for (const d of kg) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

// ── Flujo completo online: identify → carga → tacto → pesaje → resumen → siguiente, con persistencia. ──
test('flujo completo: identify → carga rápida (tacto + pesaje) → resumen → siguiente, persiste con session_id', async ({ page }) => {
  // El polling de los oráculos de server (drenado de la upload queue) puede tardar → margen amplio.
  test.setTimeout(150_000);
  const user = await createTestUser('m22-full');
  await setUserPhone(user.id, '1123456789');
  // Identidad LIMPIA para las capturas del demo (R12.4): rodeo "Cría hembras" sin el prefijo e2e + caravana
  // visual humana "0385" + categoría Vaquillona → consistente con identify-found.png. El campo está aislado
  // por usuario, así que "0385" no colisiona en la lista. La caravana electrónica (eid) va MUTED en el header.
  // B2: rodeo con 3 meses de servicio → el tacto ofrece el sub-paso de tamaño cabeza/cuerpo/cola (RPSC.5.4).
  // (Antes de B2 el tacto SIEMPRE mostraba los 3 bloques; ahora depende del service_months del rodeo → un
  // rodeo configurado a 3 meses preserva ese flujo. Un rodeo sin configurar iría directo, DD-PSC-2/RPSC.4.4.)
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Carga M22', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    serviceMonths: [10, 11, 12],
  });
  const eid = makeEid();
  const visual = '0385';
  // Hembra (el tacto aplica a hembras) → categoría Vaquillona. Con caravana electrónica → se identifica por bastonazo.
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    idv: visual,
    sex: 'female',
    categoryCode: 'vaquillona',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // El animal baja por la stream (visible en la lista = ya sincronizó al SQLite local).
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionTactoPesaje(page);

  // Bastonazo → found → auto-avance a la carga rápida REAL.
  await bastonazo(page, eid);
  await expect(page.getByText('Lectura recibida', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── CARGA RÁPIDA: identidad real + primer paso (Tacto de preñez · 1 de 2). Header con la caravana VISUAL. ──
  await expect(page.getByText('· 1 de 2', { exact: true })).toBeVisible({ timeout: 30_000 });
  // La línea de maniobra muestra el label es-AR (MANEUVER_LABELS): el tacto de preñez fue renombrado.
  await expect(page.getByText('Tacto de preñez', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('PREÑADA', { exact: true })).toBeVisible();
  await expect(page.getByText('VACÍA', { exact: true })).toBeVisible();
  // JERARQUÍA DE IDENTIDAD (R12.4, fix de jerarquía): la caravana VISUAL "0385" es la identidad DOMINANTE
  // (la que el operario lee en la oreja), NO el RFID. El tag electrónico (eid) va MUTED debajo, y la línea
  // rodeo·categoría muestra "Cría hembras · Vaquillona". Confirma datos REALES + el orden visual correcto.
  await expect(page.getByText('0385', { exact: true })).toBeVisible();
  await expect(page.getByText('Cría hembras · Vaquillona', { exact: true })).toBeVisible();
  // El tag electrónico aparece (muted) como confirmación de la lectura BLE — formateado legible (PPP NNNN…).
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'carga-tacto.png') });

  // ── Paso TACTO: PREÑADA → sub-paso de tamaño → CABEZA (large). ──
  await page.getByRole('button', { name: 'PREÑADA', exact: true }).click();
  await expect(page.getByText('CABEZA', { exact: true })).toBeVisible();
  await expect(page.getByText('CUERPO', { exact: true })).toBeVisible();
  await expect(page.getByText('COLA', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'carga-tacto-tamano.png') });
  await page.getByRole('button', { name: 'CABEZA', exact: true }).click();

  // ── Paso PESAJE (· 2 de 2): teclear 412 → Confirmar. ──
  await expect(page.getByText('· 2 de 2', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
  await typeWeight(page, '412');
  await expect(page.getByTestId('weight-display').getByText('412', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'carga-pesaje.png') });
  await page.getByRole('button', { name: 'Confirmar peso' }).click();

  // ── RESUMEN del animal: las 2 maniobras con su valor; corregible. ──
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Preñada · Cabeza', { exact: true })).toBeVisible();
  await expect(page.getByText('412 kg', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'resumen.png') });

  // ── CONFIRMAR → siguiente animal (vuelve a identificar; el contador subió a "Animal 2"). ──
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── PERSISTENCIA VERIFICABLE (R5.11): el tacto y el pesaje aterrizaron en el server CON session_id. ──
  const w = await waitForServerWeightEventWithSession(establishmentId, 412);
  const t = await waitForServerTactoWithSession(profileId, 'large');
  // Mismo session_id en ambos eventos (los dos se cargaron en la MISMA jornada).
  expect(w.sessionId).toBe(t.sessionId);
});

// ── Corrección desde el resumen (R5.9): tocar una maniobra vuelve a su paso. ──
test('resumen corregible: tocar el pesaje vuelve al keypad y reescribe el valor', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('m22-fix');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Fix M22');
  const eid = makeEid();
  const visual = `${RUN_TAG}-FIX`;
  await seedAnimal(establishmentId, rodeoId, { tag: eid, idv: visual, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Jornada SOLO PESAJE → el foco es la corrección del pesaje (R5.9), sin acoplar al gating del tacto.
  await startSessionPesaje(page);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Pesaje 300 → resumen.
  await typeWeight(page, '300');
  await page.getByRole('button', { name: 'Confirmar peso' }).click();
  await expect(page.getByText('300 kg', { exact: true })).toBeVisible({ timeout: 10_000 });

  // CORREGIR el pesaje: tocar su fila → vuelve al keypad CON el valor previo (300) cargado → borrar TODO
  // → reescribir 350. El display arranca mostrando "300" (corrección R5.9: el paso re-lee su valor).
  await page.getByTestId('summary-row-pesaje').click();
  await expect(page.getByTestId('weight-display')).toBeVisible();
  await expect(page.getByTestId('weight-display').getByText('300', { exact: true })).toBeVisible();
  // Borrar hasta que el display muestre "0" (vacío) — DETERMINISTA: re-chequeamos el estado tras cada tap
  // y esperamos a que el display lo refleje (el keypad borra un dígito por tap; el valor previo es "300").
  const del = page.getByRole('button', { name: 'Borrar' });
  const display = page.getByTestId('weight-display');
  for (let i = 0; i < 8; i++) {
    if (await display.getByText('0', { exact: true }).isVisible().catch(() => false)) break;
    await del.click();
    // Esperar a que el tap se refleje en el display antes del próximo (evita perder taps por timing).
    await page.waitForTimeout(80);
  }
  await expect(display.getByText('0', { exact: true })).toBeVisible({ timeout: 5_000 });
  await typeWeight(page, '350');
  await expect(display.getByText('350', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar peso' }).click();

  // El resumen refleja el valor corregido.
  await expect(page.getByText('350 kg', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('300 kg', { exact: true })).toHaveCount(0);

  // Persiste el valor CORREGIDO (el id de cliente es estable por animal+maniobra → LWW lo pisa).
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await waitForServerWeightEventWithSession(establishmentId, 350);
});

// ── OFFLINE (R10.1): toda la secuencia + escrituras sin red → reconexión → eventos en Supabase. ──
test('offline: cargar maniobras sin red → reconexión → los eventos aterrizan con session_id', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m22-offline');
  await setUserPhone(user.id, '1123456789');
  // B2: 3 meses de servicio → el tacto ofrece el sub-paso de tamaño (cabeza/cuerpo/cola), como pre-B2.
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Offline M22', {
    serviceMonths: [10, 11, 12],
  });
  const eid = makeEid();
  const visual = `${RUN_TAG}-OFF`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { tag: eid, idv: visual, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionTactoPesaje(page);

  // CORTAMOS LA RED. La identificación (lookup local) + la secuencia + las escrituras deben funcionar igual.
  await page.context().setOffline(true);

  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 2', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Tacto PREÑADA → CUERPO (medium); pesaje 388. Todo OFFLINE.
  await page.getByRole('button', { name: 'PREÑADA', exact: true }).click();
  await page.getByRole('button', { name: 'CUERPO', exact: true }).click();
  await expect(page.getByText('· 2 de 2', { exact: true })).toBeVisible({ timeout: 10_000 });
  await typeWeight(page, '388');
  await page.getByRole('button', { name: 'Confirmar peso' }).click();

  // Resumen + confirmar — todo sin red (offline-first, CLAUDE.md ppio 3).
  await expect(page.getByText('388 kg', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Preñada · Cuerpo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // RECONEXIÓN → la upload queue se drena → los eventos aterrizan en el server CON session_id.
  await page.context().setOffline(false);
  const w = await waitForServerWeightEventWithSession(establishmentId, 388, { tries: 40 });
  const t = await waitForServerTactoWithSession(profileId, 'medium', { tries: 40 });
  expect(w.sessionId).toBe(t.sessionId);
});
