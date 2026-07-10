// e2e/captures/guardar-rutina.capture.ts — CAPTURAS para el veto del leader (web táctil, mobile) del
// cableado de R2.1 "Guardar como rutina" (spec 03 MODO MANIOBRAS, etapa 3 del wizard).
//
// Dos capturas a 360 y 412 px (context hasTouch + mobile = web táctil real, los gotchas de rn-web aplican):
//   (1) guardar-rutina-etapa3-<w>.png — la etapa 3 (resumen) con la acción SECUNDARIA "Guardar como rutina"
//       visible JUNTO al CTA primario "Arrancar jornada" (el primario sigue dominante, no se degrada).
//   (2) guardar-rutina-sheet-<w>.png  — el sheet de nombre abierto (input "Nombre de la rutina" + Guardar/
//       Cancelar), con un nombre tipeado (Guardar habilitado).
//
// Setup espejado de maniobra-wizard.spec.ts: rodeo bovino/cría (0018 habilita las maniobras de cría) +
// elegir 3 maniobras en orden → etapa 3. NO arranca la jornada (guardar es independiente de arrancar).

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
  test(`capturas guardar como rutina (etapa 3 + sheet) @ ${width}px`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width, height: 915 },
    });
    const page = await ctx.newPage();
    await applyEnvShim(page);

    try {
      const user = await createTestUser(`cap-guardar-rutina-${width}`);
      await setUserPhone(user.id, '1123456789');
      await seedEstablishmentWithRodeo(user.id, `Campo Guardar Rutina ${width}`, {
        rodeoName: 'Cría general',
        rodeoRawName: true,
      });

      await page.goto('/');
      await signIn(page, user);
      await waitForHome(page);

      // ── WIZARD: rodeo → 3 maniobras en orden → etapa 3 ──
      await page.goto('/maniobra/jornada');
      await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
      await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('pool-row-pesaje').click();
      await page.getByTestId('pool-row-tacto').click();
      await page.getByTestId('pool-row-vacunacion').click();
      await expect(page.getByTestId('selected-row-2')).toBeVisible();
      // D2 (endurecimiento etapa 2): Vacunación exige ≥1 vacuna definida → la definimos (índice 2) para
      // poder continuar. Sheet abierto con .click() sintético (sin el race del click huérfano táctil).
      await page.getByTestId('selected-body-2').click();
      await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('maneuver-config-input').fill('Brucelosis');
      await page.getByRole('button', { name: 'Agregar vacuna', exact: true }).click();
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
      await page.getByRole('button', { name: /^Continuar/ }).click();
      await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible({ timeout: 20_000 });

      // (1) Etapa 3 con AMBAS acciones: "Arrancar jornada" (primario) + "Guardar como rutina" (secundario).
      await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Guardar como rutina', exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(SHOT_DIR, `guardar-rutina-etapa3-${width}.png`) });

      // (2) Sheet de nombre abierto (tap táctil real → el guard anti tap-through lo mantiene abierto).
      await touchTapButton(page, 'Guardar como rutina');
      await expect(page.getByTestId('save-preset-sheet')).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500); // > la ventana del click huérfano + el doble rAF
      await expect(page.getByTestId('save-preset-sheet')).toBeVisible();
      await page.getByTestId('save-preset-input').fill('Tacto de otoño');
      await expect(
        page.getByTestId('save-preset-sheet').getByRole('button', { name: 'Guardar', exact: true }),
      ).toBeEnabled();
      await page.screenshot({ path: path.join(SHOT_DIR, `guardar-rutina-sheet-${width}.png`) });
    } finally {
      await ctx.close();
    }
  });
}
