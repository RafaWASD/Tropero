// e2e/sigsa-run3-screenshot.spec.ts — CAPTURAS del run 3 (spec 08, T18) para el veto del leader: la EDICIÓN
// DE RAZA en la ficha (cierre del GAP breed_id). Estados: (1) ficha de un animal SIN raza → CTA "Completá la
// raza para SIGSA"; (2) BreedPickerSheet abierto desde la ficha; (3) ficha con la raza elegida + link "Cambiar".
// NO es red de seguridad (sigsa-breed-renspa lo es): sólo siembra estados y captura PNG a 412×915. Throwaway.
//
// ⚠ Importa test de ./helpers/fixtures (NO @playwright/test): si no, PowerSync bootea en blanco. La edición de
// raza muestra el NOMBRE optimista al instante (no depende del trigger 0113 — que sólo deriva breed_id al subir).

import path from 'node:path';
import { test } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';
import { expect } from '@playwright/test';

const outDir = path.join(__dirname, '..', '..', 'design', 'veto-sigsa-run3');

test.afterAll(async () => {
  await cleanupAll();
});

test('captura: edición de raza en la ficha (CTA completar → BreedPickerSheet → raza elegida)', async ({ page }) => {
  const user = await createTestUser('shotficha');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo ShotFicha');

  // Animal SIN raza → la ficha muestra el CTA "Completá la raza para SIGSA".
  const idv = `SF${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female', categoryCode: 'vaquillona' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  // (1) Ficha SIN raza → CTA "Completá la raza para SIGSA" en la sección "Datos del animal".
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  const completarCta = page.getByRole('button', { name: 'Completá la raza para SIGSA', exact: true });
  await expect(completarCta).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(outDir, '01-ficha-sin-raza-cta.png'), fullPage: true });

  // (2) BreedPickerSheet abierto desde la ficha.
  await completarCta.click();
  await expect(page.getByText('Sin raza — a completar', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(outDir, '02-ficha-breedpicker-abierto.png'), fullPage: true });

  // (3) Elegimos Hereford → la ficha muestra la raza + el link "Cambiar".
  await page.getByRole('button', { name: 'Raza Hereford, código H', exact: true }).click();
  await expect(page.getByText('Hereford', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Cambiar la raza', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(outDir, '03-ficha-con-raza-cambiar.png'), fullPage: true });
});
