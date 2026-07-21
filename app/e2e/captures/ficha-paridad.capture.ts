// e2e/captures/ficha-paridad.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el bugfix U4 (paridad
// card↔ficha, tanda docs/plan-mejoras-2026-07-20.md Tier-2). Recorre el listado y la ficha de una hembra
// VACÍA con dientes y saca CAPTURAS NOMBRADAS de cada estado clave a
// e2e/captures/__shots__/ficha-paridad/NN-estado.png para que el leader las vete (design-review) y las
// muestre a Raf con evidencia visual del cierre de la brecha.
//
// ⚠️ NO es regresión (.capture.ts → NO corre en `pnpm e2e`). La red de regresión vive en
// e2e/ficha-paridad.spec.ts. Reusa los MISMOS helpers/seed/selectores.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/ficha-paridad.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/ficha-paridad/ (gitignoreado — app/.gitignore + ADR-029 §Artefactos).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedReproductiveTactoEvent,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'ficha-paridad');

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test.afterAll(async () => {
  await cleanupAll();
});

/** Captura NOMBRADA tras un settle de layout. El llamador asegura un expect(...).toBeVisible() antes. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test('captura U4: card con chip "Vacía" + ficha "Estado actual" con Dientes y Estado reproductivo', async ({
  page,
}) => {
  test.setTimeout(150_000);

  const user = await createTestUser('fichacap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo FichaCap', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const idv = `FI${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'multipara',
    birthDate: '2019-03-01',
    teethState: 'boca_llena',
  });
  await seedReproductiveTactoEvent(profileId, { pregnancyStatus: 'empty' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);

  // ── 01 — LISTADO: la card muestra el chip "Vacía" (fuente de paridad). ──
  await expect(page.getByLabel('Estado reproductivo: Vacía').first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '01-listado-card-vacia');

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.tap();

  // ── 02 — FICHA (hero + secciones superiores). ──
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(page, '02-ficha-hero');

  // ── 03 — "Estado actual" con la fila "Dientes: Boca llena" + "Estado reproductivo: Vacía · …". ──
  const estadoActual = page.getByText('Estado actual', { exact: true });
  await expect(estadoActual).toBeVisible({ timeout: 20_000 });
  await estadoActual.scrollIntoViewIfNeeded();
  await expect(page.getByText('Dientes', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Boca llena', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Vacía ·/).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, '03-estado-actual-dientes-vacia');
});
