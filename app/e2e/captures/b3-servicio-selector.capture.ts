// e2e/captures/b3-servicio-selector.capture.ts — CAPTURA del SELECTOR DE TIPO DE SERVICIO de "Agregar
// evento" tras la baja de la MONTA NATURAL (spec 03 Stream B / B3, RPSC.6.1 / DD-PSC-6) para el VETO
// LIVIANO del leader (design-review): que sacar la opción `natural` NO desbalancee el layout / no recorte
// (el selector queda con DOS filas: "Inseminación (IA)" + "Transferencia embrionaria (TE)").
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts). Es la pantalla REAL (NO un mock): el selector de servicio vive
// en `agregar-evento.tsx` y necesita auth + un animal HEMBRA sembrado → hace el flujo de login completo
// (mismo patrón que las e2e specs: helpers/admin + helpers/ui). Web TÁCTIL REAL (hasTouch:true) para vetar
// el truncado/tap-through que solo se ve ahí (memoria reference_rn_web_pitfalls).
//
// Salida: tests/stream-b/  (gitignoreado).
//
// Para correrla:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/b3-servicio-selector.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

const SHOT_DIR = path.join(process.cwd(), '..', 'tests', 'stream-b');
const WIDTHS = [360, 412] as const;

test.afterAll(async () => {
  await cleanupAll();
});

/**
 * Verifica que NINGÚN <Text> que contenga el fragmento se RECORTE en su caja (memoria
 * feedback_descender_clipping: g/j/p/q/y se cortan si el lineHeight no matchea el fontSize). Mide
 * scrollHeight vs clientHeight del nodo de texto. Tolerancia 1px (sub-pixel rounding de rn-web).
 */
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

for (const width of WIDTHS) {
  test(`captura B3 selector de servicio sin monta natural (web táctil) @ ${width}px`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const page = await ctx.newPage();
    // El context propio (browser.newContext) NO hereda el auto-shim de la fixture `page` → lo aplicamos a
    // mano ANTES del goto (si no, el bundle web de producción crashea por las EXPO_PUBLIC_* faltantes).
    await applyEnvShim(page);

    const user = await createTestUser(`b3cap${width}`);
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, `Campo B3Cap${width}`);
    const idv = `5599${Date.now().toString().slice(-5)}`;
    await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

    try {
      await page.goto('/');
      await signIn(page, user);
      await waitForHome(page);
      await gotoAnimales(page);

      const row = page.getByRole('button', { name: new RegExp(idv) }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 30_000 });

      // Abrir el alta de servicio → el selector de tipo (paso 2 del wizard "Agregar evento").
      await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
      await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Servicio', exact: true }).click();

      // El selector resultante: SÍ IA + TE, NO monta natural.
      await expect(page.getByText('Tipo de servicio', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Inseminación (IA)', exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Transferencia embrionaria (TE)', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Monta natural', exact: true })).toHaveCount(0);

      // Anti-recorte: el título de la pantalla "Servicio" y el label largo "Transferencia embrionaria (TE)"
      // (con descendentes g/p/j/q) no se cortan.
      await assertTextNotClipped(page, 'Servicio');
      await assertTextNotClipped(page, 'Transferencia embrionaria (TE)');

      await page.screenshot({ path: path.join(SHOT_DIR, `b3-servicio-selector-${width}.png`) });
    } finally {
      await ctx.close();
    }
  });
}
