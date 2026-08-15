// e2e/captures/23-request-id-correlation.capture.ts — CAPTURAS del Gate 2.5 (ADR-029) de la feature 23:
// la superficie UI "Código de soporte" en sus DOS estados (spec 23, US5 / R5.10).
//
// ⚠️ NO es regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`). Se dispara a mano:
//   cd app && pnpm e2e:build && \
//     pnpm exec playwright test e2e/captures/23-request-id-correlation.capture.ts --config playwright.capture.config.ts
//
// Estados capturados (× 360 y 412, web táctil real = context hasTouch + isMobile):
//   01-crash-fallback-<w>.png — el fallback del RootErrorBoundary con "Código de soporte" + valor + Copiar
//        (vía el spike `observabilidad-spike?code=<uuid>`, EL MISMO componente que producción, sin auth).
//   02-sync-rechazo-sheet-<w>.png — el SyncRechazoSheet con la fila del rechazo mostrando el id de la op como
//        código de soporte + Copiar (rechazo inyectado con la marca SOLO-E2E, gated fuera de prod).
//
// Veto visual del leader: título con descendentes ("Algo salió mal" tiene la `g`; "Código de soporte" tiene
// `g`/`p`) sin recorte; sheet header-fijo/body-scroll/footer-fijo; targets manga grandes.
//
// Salida: e2e/captures/__shots__/23-request-id-correlation/ (gitignored).

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', '23-request-id-correlation');
const WIDTHS = [360, 412] as const;
const CODE = '9f3a1c2e-4b5d-6e7f-8a90-1b2c3d4e5f60';

/** Verifica que ningún <Text> con `frag` se recorte (g/j/p/q/y sin lineHeight matcheado). Tol 1px. */
async function assertTextNotClipped(page: Page, frag: string): Promise<void> {
  const clipped = await page.evaluate((f) => {
    const nodes = Array.from(document.querySelectorAll('div, span'));
    for (const el of nodes) {
      const e = el as HTMLElement;
      if (e.children.length === 0 && (e.textContent || '').includes(f)) {
        if (e.scrollHeight > e.clientHeight + 1) {
          return { found: true, scrollH: e.scrollHeight, clientH: e.clientHeight };
        }
      }
    }
    return { found: false };
  }, frag);
  expect(clipped.found, `texto recortado (scrollHeight>clientHeight): ${JSON.stringify(clipped)}`).toBe(false);
}

/** Tap TÁCTIL real sobre un testID (web táctil real). */
async function touchTapTestId(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).first().boundingBox();
  if (!box) throw new Error(`sin boundingBox para testID "${testId}"`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

for (const width of WIDTHS) {
  // ── (01) FALLBACK DE CRASH con "Código de soporte" + Copiar ──
  test(`captura crash-fallback con código de soporte @ ${width}px`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width, height: 915 } });
    const page = await ctx.newPage();
    await applyEnvShim(page);
    try {
      await page.goto(`/observabilidad-spike?code=${CODE}`);
      await expect(page.getByText('Algo salió mal', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Código de soporte', { exact: true })).toBeVisible();
      await expect(page.getByText(CODE).first()).toBeVisible();
      await expect(page.getByText('Copiar', { exact: true }).first()).toBeVisible();
      // Anti-recorte: la `g` de "Algo" y la `g`/`p` de "Código de soporte" no se recortan (lineHeight matching).
      await assertTextNotClipped(page, 'Algo salió mal');
      await assertTextNotClipped(page, 'Código de soporte');
      await page.screenshot({ path: path.join(SHOT_DIR, `01-crash-fallback-${width}.png`), fullPage: true });
    } finally {
      await ctx.close();
    }
  });

  // ── (02) SyncRechazoSheet con el id de la op como código de soporte + Copiar ──
  test(`captura sync-rechazo-sheet con código de soporte @ ${width}px`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width, height: 915 } });
    const page = await ctx.newPage();
    await applyEnvShim(page);
    const OP_ID = 'op-soporte-42';
    await page.addInitScript((id) => {
      (window as unknown as Record<string, unknown>).__RAFAQ_SYNC_REJECT_E2E__ = {
        id,
        table: 'weight_events',
        op: 'PUT',
        code: '23514',
      };
    }, OP_ID);
    try {
      const user = await createTestUser(`cap-sup-code-${width}`);
      await setUserPhone(user.id, '1123456789');
      await seedEstablishmentWithRodeo(user.id, `Campo Codigo ${width}`, {
        rodeoName: 'Cría general',
        rodeoRawName: true,
      });

      await page.goto('/');
      await signIn(page, user);
      await waitForHome(page);

      await page.goto('/maniobra');
      await expect(page.getByText('Modo maniobras', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('sync-rechazo-banner')).toBeVisible({ timeout: 20_000 });

      // Abrir el sheet (tap táctil real) + esperar > la ventana del click huérfano (doble rAF del guard).
      await touchTapTestId(page, 'sync-rechazo-banner');
      const sheet = page.getByTestId('sync-rechazo-sheet');
      await expect(sheet).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500);

      await expect(sheet.getByText('Código de soporte', { exact: true })).toBeVisible();
      await expect(sheet.getByText(OP_ID).first()).toBeVisible();
      await expect(sheet.getByText('Copiar', { exact: true }).first()).toBeVisible();
      // Anti-recorte del título del sheet (descendentes) + del copy del código.
      await assertTextNotClipped(page, 'Código de soporte');
      await page.screenshot({ path: path.join(SHOT_DIR, `02-sync-rechazo-sheet-${width}.png`), fullPage: true });
    } finally {
      await ctx.close();
    }
  });
}
