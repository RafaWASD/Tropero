// e2e/captures/parto-caravana-visual-por-ternero.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el
// delta "PARTO: CARAVANA VISUAL DEL TERNERO POR CRÍA" (spec 02, PCV.1/2/8.4). Recorre el form de Parto
// (agregar-evento, eventType='birth') y saca CAPTURAS NOMBRADAS de cada estado clave a
// `e2e/captures/__shots__/parto-caravana-visual-por-ternero/NN-estado.png` para que el leader las vete
// (design-review) y se las muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN del delta vive en
// e2e/events.spec.ts (tests "delta parto-caravana-visual: …"); este archivo SOLO captura estados, reusando los
// MISMOS helpers de setup/seed/navegación y los MISMOS selectores (testID/a11y labels) de esa suite.
//
// Es la pantalla REAL (NO un mock): el form vive en app/agregar-evento.tsx (PartoForm/CalfBlock), al que se
// llega desde la ficha del animal (animal/[id].tsx → "Agregar evento" → "Parto").
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/parto-caravana-visual-por-ternero.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/parto-caravana-visual-por-ternero/  (gitignoreado — app/.gitignore + ADR-029).
//
// Estados capturados (PCV.8.4):
//   01-parto-single-idv-vacio   — 1 ternero: el campo "Caravana visual del ternero (opcional)" DENTRO del
//                                 CalfBlock, junto a la electrónica (bastoneo). SIN campo idv a nivel camada
//                                 ni nota de mellizos (PCV.1.5).
//   02-parto-single-idv-lleno   — 1 ternero: idv tipeado en el campo del ternero (leading cero preservado).
//   03-parto-mellizos-2-idv     — 2 terneros (mellizos): UN campo idv por CADA ternero (PCV.1.2), cada uno con
//                                 SU valor distinto. SIN campo camada ni nota.

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

// Path RELATIVO a app/ (cwd de Playwright) → app/e2e/captures/__shots__/parto-caravana-visual-por-ternero/.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'parto-caravana-visual-por-ternero');

test.afterAll(async () => {
  await cleanupAll();
});

/**
 * Saca una captura NOMBRADA tras un breve settle de layout. El llamador asegura un expect(...).toBeVisible()
 * del elemento clave ANTES de invocar esto (per ADR-029).
 */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test('captura delta parto-caravana-visual-por-ternero: caravana visual POR CRÍA (single + mellizos)', async ({
  page,
}) => {
  test.setTimeout(210_000);

  const user = await createTestUser('pcvcap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo PCVcap');
  const motherIdv = `4416${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const motherRow = page.getByRole('button', { name: new RegExp(motherIdv) }).first();
  await expect(motherRow).toBeVisible({ timeout: 20_000 });
  await motherRow.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── Abrir el form de Parto. ──
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Parto', exact: true }).click();
  await expect(page.getByText('Ternero 1', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 01 — parto SINGLE: el campo idv vive DENTRO del CalfBlock (junto a la electrónica), sin campo camada ni nota. ──
  const idv0 = page.getByTestId('calf-idv-0');
  await expect(idv0).toBeVisible();
  await expect(page.getByText(/Las caravanas visuales de mellizos se asignan después/)).toHaveCount(0);
  await shot(page, '01-parto-single-idv-vacio');

  // ── 02 — parto SINGLE con idv tipeado (leading cero preservado). ──
  const calfIdv0 = `0${Date.now().toString().slice(-6)}`;
  await idv0.fill(calfIdv0);
  await expect(idv0).toHaveValue(calfIdv0);
  await shot(page, '02-parto-single-idv-lleno');

  // ── 03 — parto MELLIZOS: agregar un 2º ternero → UN campo idv por cada ternero, cada uno con su valor. ──
  await page.getByRole('button', { name: 'Agregar otro ternero', exact: true }).click();
  await expect(page.getByText('Ternero 2', { exact: true })).toBeVisible();
  const idv1 = page.getByTestId('calf-idv-1');
  await expect(idv1).toBeVisible();
  await expect(page.getByTestId('calf-idv-0')).toBeVisible(); // el del 1º ternero sigue presente (POR CRÍA)
  const calfIdv1 = `1${Date.now().toString().slice(-6)}`;
  await idv1.fill(calfIdv1);
  await expect(idv1).toHaveValue(calfIdv1);
  // El idv del ternero 1 NO se perdió al tipear el del ternero 2 (PCV.1.4).
  await expect(page.getByTestId('calf-idv-0')).toHaveValue(calfIdv0);
  await shot(page, '03-parto-mellizos-2-idv');
});
