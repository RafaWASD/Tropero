// e2e/captures/sync-rechazo-banner.capture.ts — CAPTURAS para el veto del leader (web táctil, mobile) del
// SURFACING de RECHAZOS DE SYNC en el landing de MODO MANIOBRAS (spec 03 M4.2, R10.8).
//
// Dos capturas a 360 y 412 px (context hasTouch + mobile = web táctil real, los gotchas de rn-web aplican):
//   (1) sync-rechazo-banner-<w>.png — el landing con el BANNER terracota "N maniobras no se sincronizaron"
//       arriba de la tarjeta de retomar / "Tus rutinas".
//   (2) sync-rechazo-sheet-<w>.png  — el SHEET de detalle con un rechazo (tipo + motivo + cuándo) + "Entendido".
//
// Setup: un usuario con campo + un rechazo de maniobra INYECTADO con la marca SOLO-E2E
// (`__RAFAQ_SYNC_REJECT_E2E__`, gated fuera de prod) que el landing consume al enfocar (sin forzar un
// rechazo server-side real). Sembramos DOS rechazos (pesaje + sanitaria) para que el plural y la lista se vean.

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), '..', 'tests', 'modo-maniobra');
const WIDTHS = [360, 412] as const;

/** Tap TÁCTIL real sobre un testID (web táctil real). */
async function touchTapTestId(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).first().boundingBox();
  if (!box) throw new Error(`sin boundingBox para testID "${testId}"`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

for (const width of WIDTHS) {
  test(`capturas rechazos de sync (banner + sheet) @ ${width}px`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const page = await ctx.newPage();
    await applyEnvShim(page);
    // Inyectamos UN rechazo (pesaje, gating 23514) → la lista muestra el motivo es-AR real. (El hook E2E
    // consume un solo payload; con uno alcanza para mostrar el banner singular + el sheet con su motivo.)
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__RAFAQ_SYNC_REJECT_E2E__ = {
        id: 'cap-rej-1',
        table: 'weight_events',
        op: 'PUT',
        code: '23514',
      };
    });

    try {
      const user = await createTestUser(`cap-rechazo-${width}`);
      await setUserPhone(user.id, '1123456789');
      await seedEstablishmentWithRodeo(user.id, `Campo Rechazo ${width}`, {
        rodeoName: 'Cría general',
        rodeoRawName: true,
      });

      await page.goto('/');
      await signIn(page, user);
      await waitForHome(page);

      // ── (1) LANDING con el banner de rechazos ──
      await page.goto('/maniobra');
      await expect(page.getByText('Modo maniobras', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('sync-rechazo-banner')).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: path.join(SHOT_DIR, `sync-rechazo-banner-${width}.png`) });

      // ── (2) SHEET de detalle ──
      await touchTapTestId(page, 'sync-rechazo-banner');
      await expect(page.getByTestId('sync-rechazo-sheet')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500); // > la ventana del click huérfano + el doble rAF (guard tap-through)
      await expect(page.getByText(/Pesaje:/).first()).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `sync-rechazo-sheet-${width}.png`) });
    } finally {
      await ctx.close();
    }
  });
}
