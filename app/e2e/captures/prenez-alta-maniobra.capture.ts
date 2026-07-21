// e2e/captures/prenez-alta-maniobra.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// del bugfix U3 (docs/plan-mejoras-2026-07-20.md): el alta guiada lanzada DESDE una jornada que mide TACTO
// NO pregunta preñez (la maniobra es la dueña de ese dato → evita el registro duplicado).
//
// El cambio visual es una SUPRESIÓN condicional de un campo del paso 4 del alta. Los estados clave a vetar:
//   01 — paso 4 del alta lanzada desde una jornada de TACTO, categoría Multípara: el campo "Estado de
//        preñez" NO aparece; el resto del paso (condición corporal / cría al pie) SÍ (fix quirúrgico).
//   02 — CONTROL: paso 4 del alta lanzada desde una jornada SIN tacto (solo Pesaje), misma categoría:
//        el campo "Estado de preñez" SÍ aparece (estar en una maniobra no suprime; solo el tacto lo hace).
//
// NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/prenez-alta-maniobra.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page, type Browser } from '../helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', 'prenez-alta-maniobra');

async function newMobilePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  return page;
}

async function connectMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
}

/** Arranca una jornada eligiendo el (único) rodeo + las maniobras dadas → identificación lista. */
async function startSession(page: Page, maneuvers: readonly string[]): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`pool-row-${maneuvers[0]}`)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  for (const m of maneuvers) await page.getByTestId(`pool-row-${m}`).click();
  await expect(page.getByTestId(`selected-row-${maneuvers.length - 1}`)).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await connectMock(page);
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Identificar una caravana desconocida → dar de alta → wizard hasta el paso 4 (Multípara). */
async function altaHasta(page: Page, idv: string): Promise<void> {
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  await page.getByLabel('Número o caravana visual').fill(idv);
  await page.getByRole('button', { name: 'Buscar animal' }).click();
  await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Dar de alta', exact: true }).click();
  await expect(page.getByText(`Creando: ${idv}`, { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Categoría Multípara', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// (01) Jornada de TACTO → el alta NO muestra el campo de preñez (fix quirúrgico: condición/cría siguen).
test('(01) alta desde jornada de tacto → preñez suprimida @ 412px', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-u3-tacto');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo U3 Cap Tacto', { serviceMonths: [10, 11, 12] });

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await startSession(page, ['tacto']);
    await altaHasta(page, `9101${Date.now().toString().slice(-6)}`);

    await expect(page.getByText('Estado de preñez (opcional)', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Condición corporal (opcional, 1 a 5)', { exact: true })).toBeVisible();
    await expect(page.getByText('Cría al pie (opcional)', { exact: true })).toBeVisible();
    // El paso 4 scrollea en un ScrollView interno (RN-Web) → `fullPage` no lo captura. Scrolleamos la
    // sección "Datos de la categoría" a la vista (última fila = cría al pie) para que el veto vea que
    // entre CONDICIÓN y CRÍA AL PIE NO hay campo de preñez.
    await page.getByText('Cría al pie (opcional)', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT_DIR, '01-alta-tacto-sin-prenez.png') });
  } finally {
    await page.context().close();
  }
});

// (02) CONTROL: jornada SIN tacto (solo Pesaje) → el alta SÍ muestra el campo de preñez.
test('(02) control: alta desde jornada SIN tacto → preñez presente @ 412px', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-u3-control');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo U3 Cap Control');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await startSession(page, ['pesaje']);
    await altaHasta(page, `9102${Date.now().toString().slice(-6)}`);

    await expect(page.getByText('Estado de preñez (opcional)', { exact: true })).toBeVisible();
    // Misma sección scrolleada a la vista que (01): acá el campo de preñez SÍ aparece (entre condición y cría).
    await page.getByText('Cría al pie (opcional)', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT_DIR, '02-alta-sin-tacto-con-prenez-control.png') });
  } finally {
    await page.context().close();
  }
});
