// e2e/captures/maniobra-reanudar.capture.ts — CAPTURAS para el veto del leader (web táctil, mobile) de la
// REANUDACIÓN de la jornada en el landing de MODO MANIOBRAS (spec 03 M4, R10.5/R10.6).
//
// Dos capturas a 360 y 412 px (context hasTouch + mobile = web táctil real, los gotchas de rn-web aplican):
//   (1) retomar-jornada-landing-<w>.png — el landing con la TARJETA "Retomar la jornada de hoy" arriba de
//       "Tus rutinas" (rodeo + maniobras + N animales) + el CTA "Nueva jornada".
//   (2) nueva-jornada-confirm-<w>.png   — el sheet de confirmación de "Nueva jornada" CON una jornada
//       abierta ("Ya tenés una jornada abierta" + Empezar una nueva / Retomar la abierta / Cancelar).
//
// Setup: rodeo bovino/cría (0018 habilita las maniobras de cría) → arrancar una jornada de verdad desde el
// wizard (queda abierta, local) → volver al landing. El bastón mock (flag E2E) hace que la identificación se
// comporte igual que en los specs.

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), '..', 'tests', 'modo-maniobra');
const WIDTHS = [360, 412] as const;

/** Tap TÁCTIL real sobre un botón accesible por su nombre. */
async function touchTapButton(page: Page, name: string): Promise<void> {
  const box = await page.getByRole('button', { name, exact: true }).first().boundingBox();
  if (!box) throw new Error(`sin boundingBox para el botón "${name}"`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

for (const width of WIDTHS) {
  test(`capturas reanudación (landing retomar + sheet nueva jornada) @ ${width}px`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const page = await ctx.newPage();
    await applyEnvShim(page);
    // Bastón mock (igual que los specs): la identificación se comporta como en producción de test.
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
    });

    try {
      const user = await createTestUser(`cap-reanudar-${width}`);
      await setUserPhone(user.id, '1123456789');
      await seedEstablishmentWithRodeo(user.id, `Campo Reanudar ${width}`, {
        rodeoName: 'Cría general',
        rodeoRawName: true,
      });

      await page.goto('/');
      await signIn(page, user);
      await waitForHome(page);

      // ── Arrancar una jornada de verdad (rodeo + 2 maniobras en orden) → queda ABIERTA ──
      await page.goto('/maniobra/jornada');
      await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
      await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('pool-row-pesaje').click();
      await page.getByTestId('pool-row-tacto').click();
      await expect(page.getByTestId('selected-row-1')).toBeVisible();
      await page.getByRole('button', { name: /^Continuar/ }).click();
      await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
      await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });

      // ── (1) LANDING con la tarjeta "Retomar la jornada de hoy" ──
      await page.goto('/maniobra');
      await expect(page.getByText('Modo maniobras', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Retomar la jornada de hoy', { exact: true })).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `retomar-jornada-landing-${width}.png`) });

      // ── (2) SHEET de confirmación de "Nueva jornada" con la abierta ──
      await touchTapButton(page, 'Nueva jornada');
      await expect(page.getByTestId('nueva-jornada-sheet')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500); // > la ventana del click huérfano + el doble rAF (guard tap-through)
      await expect(page.getByText('Ya tenés una jornada abierta', { exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `nueva-jornada-confirm-${width}.png`) });
    } finally {
      await ctx.close();
    }
  });
}
