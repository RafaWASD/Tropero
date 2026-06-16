// e2e/captures/maniobra-exit-hero.capture.ts — CAPTURAS para el veto del leader (🔴 manga, web táctil) del
// chunk M2.1 exit+hero adaptativo (spec 03). Genera, a 360 y 412 px, context hasTouch + mobile viewport:
//   (1) hero CONECTADO (ScanHero)            — bastón conectado, "Acercá el bastón al animal".
//   (2) ConnectHero (desconectado+conectable) — disco = botón "Conectá el bastón" (web antes de elegir puerto).
//   (3) manual PROMOVIDO (transport==null)   — sin disco, "Ingresá la caravana del animal" (native manual-first).
//   (4) ExitJornadaSheet abierto             — Terminar / Salir sin terminar / Seguir en la jornada.
//   (5) paso de confirmación                 — "Jornada terminada · Procesaste N animales" + "Listo".
//
// Las capturas se guardan en tests/modo-maniobra/ con nombres claros (identify-<estado>-<width>.png).
//
// El sub-estado "manual promovido" (transport==null) NO es reproducible con el adapter-mock (siempre tiene
// transporte) → se fuerza con el flag SECUNDARIO de E2E `__RAFAQ_BLE_E2E_MANUAL__` (doble-gateado por
// `__RAFAQ_BLE_E2E__`, sin superficie de prod) → el provider monta SIN transporte (mode='manual').

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), '..', 'tests', 'modo-maniobra');
const WIDTHS = [360, 412] as const;

/** Marca el flag principal de E2E del bastón (mock) en una page con context propio. */
async function markBle(page: Page, manual = false): Promise<void> {
  await page.addInitScript(
    (isManual) => {
      const w = window as unknown as Record<string, unknown>;
      w.__RAFAQ_BLE_E2E__ = true;
      if (isManual) w.__RAFAQ_BLE_E2E_MANUAL__ = true;
    },
    manual,
  );
}

/** Conecta / inyecta el mock (solo cuando hay transporte mock — no en modo manual). */
async function connectMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
}

/** Lleva del wizard a la identificación con Pesaje elegido. NO conecta el bastón. */
async function startSession(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
}

for (const width of WIDTHS) {
  test(`capturas exit+hero adaptativo @ ${width}px`, async ({ browser }) => {
    // ── Contexto MOCK (conectable) para hero conectado / ConnectHero / exit-sheet / confirmación. ──
    const ctx = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const page = await ctx.newPage();
    await applyEnvShim(page);
    await markBle(page, false);

    try {
      const user = await createTestUser(`cap-exit-hero-${width}`);
      await setUserPhone(user.id, '1123456789');
      await seedEstablishmentWithRodeo(user.id, `Campo Cap ${width}`);

      await page.goto('/');
      await signIn(page, user);
      await waitForHome(page);
      await startSession(page);

      // (2) ConnectHero (desconectado + conectable): es el estado inicial con el mock sin conectar.
      await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `identify-connecthero-${width}.png`) });

      // (1) hero CONECTADO (ScanHero): conectamos el mock → el hero pasa a "Acercá el bastón al animal".
      await connectMock(page);
      await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `identify-connected-${width}.png`) });

      // (4) ExitJornadaSheet abierto: tocar ‹ → sheet de salida.
      await page.getByRole('button', { name: 'Volver', exact: true }).click();
      await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `identify-exit-sheet-${width}.png`) });

      // (5) paso de confirmación: "Terminar jornada" → "Jornada terminada · Procesaste N animales".
      await page.getByRole('button', { name: 'Terminar jornada', exact: true }).click();
      await expect(page.getByText('Jornada terminada', { exact: true })).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `identify-exit-confirmacion-${width}.png`) });
    } finally {
      await ctx.close();
    }

    // ── Contexto MANUAL (transport==null) para el sub-estado "manual promovido". ──
    const ctxM = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const pageM = await ctxM.newPage();
    await applyEnvShim(pageM);
    await markBle(pageM, true);

    try {
      const userM = await createTestUser(`cap-manualfirst-${width}`);
      await setUserPhone(userM.id, '1123456789');
      await seedEstablishmentWithRodeo(userM.id, `Campo CapM ${width}`);

      await pageM.goto('/');
      await signIn(pageM, userM);
      await waitForHome(pageM);
      await startSession(pageM);

      // (3) manual PROMOVIDO: sin transporte → "Ingresá la caravana del animal" + input expandido.
      await expect(pageM.getByText('Ingresá la caravana del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
      await pageM.screenshot({ path: path.join(SHOT_DIR, `identify-manual-promovido-${width}.png`) });
    } finally {
      await ctxM.close();
    }
  });
}
