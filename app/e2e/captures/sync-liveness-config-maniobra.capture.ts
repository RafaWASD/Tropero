// e2e/captures/sync-liveness-config-maniobra.capture.ts — CAPTURAS para el veto visual del leader
// (Gate 2.5, ADR-029) de la feature 22 (d): el bucle CONFIG → MANIOBRA reactivo.
//
// La feature 22 NO cambia el DISEÑO de ninguna pantalla — cambia CUÁNDO el contenido aparece (watched query
// en vez de disparador por-sync). Por eso el veto visual es del BUCLE (el estado de la maniobra antes/después
// del cambio de config), no de un layout nuevo. Estados clave:
//   01 — "Editar plantilla" (config del rodeo, owner): la pantalla de config desde donde el owner habilita
//        un dato (lado CONFIG del bucle). Diseño sin cambios; se captura para el veto del bucle.
//   02 — Wizard de jornada, etapa 2 (pool de maniobras) ANTES: INSEMINACIÓN ausente (default OFF en cría).
//   03 — Wizard de jornada, etapa 2 DESPUÉS de habilitar el data_key server-side, SIN reiniciar: INSEMINACIÓN
//        aparece en el pool (la watched query `db.onChange` re-resolvió el gating en vivo). Es el veredicto
//        visual del bucle "habilitar un dato se ve en la maniobra sin reiniciar".
//
// El veredicto de "la descarga baja en vivo en NATIVO" es DEVICE (ADR-029) + la instrumentación; acá se
// muestra la reactividad de la watched query en WEB (donde la descarga fluye).
//
// NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/sync-liveness-config-maniobra.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page, type Browser } from '../helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setRodeoDataKey,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', 'sync-liveness-config-maniobra');

async function newMobilePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  return page;
}

/** Entra al wizard de jornada, elige el (único) rodeo y aterriza en la etapa 2 (pool de maniobras). */
async function gotoWizardPool(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-dientes')).toBeVisible({ timeout: 30_000 });
}

// (01) La pantalla "Editar plantilla" (lado CONFIG del bucle) — owner ve la lista de datos tildables.
test('(01) editar plantilla del rodeo (config) @ 412px', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-f22-config');
    await setUserPhone(user.id, '1123456789');
    const { rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo F22 Config', {
      rodeoName: 'Cría hembras',
      rodeoRawName: true,
    });

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    await page.goto(`/editar-plantilla?rodeoId=${rodeoId}&name=${encodeURIComponent('Cría hembras')}`);
    await expect(page.getByText('Plantilla de datos', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Guardar plantilla' })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '01-editar-plantilla-config.png') });
  } finally {
    await page.context().close();
  }
});

// (02)+(03) El bucle reactivo: el pool ANTES (sin inseminación) y DESPUÉS del cambio server-side (con
// inseminación), SIN reiniciar la app.
test('(02+03) bucle config→maniobra reactivo: inseminación aparece en el pool sin reiniciar @ 412px', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-f22-bucle');
    await setUserPhone(user.id, '1123456789');
    const { rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo F22 Bucle', {
      rodeoName: 'Cría hembras',
      rodeoRawName: true,
    });

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    await gotoWizardPool(page);
    // (02) ANTES: INSEMINACIÓN ausente (default OFF en cría).
    await expect(page.getByTestId('pool-row-inseminacion')).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOT_DIR, '02-pool-sin-inseminacion.png') });

    // Server-side: el owner habilita el data_key `inseminacion`. SIN reload.
    await setRodeoDataKey(rodeoId, 'inseminacion', true);

    // (03) DESPUÉS: la watched query re-resolvió el gating en vivo → INSEMINACIÓN entra al pool.
    await expect(page.getByTestId('pool-row-inseminacion')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '03-pool-con-inseminacion-reactivo.png') });
  } finally {
    await page.context().close();
  }
});
