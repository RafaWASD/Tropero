// e2e/captures/nombre-apodo.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta #2 NOMBRE/APODO
// por rodeo (spec 02, RNA.1–RNA.8). Recorre el alta con el "apodo" habilitado por rodeo y saca CAPTURAS
// NOMBRADAS de cada estado clave a `e2e/captures/__shots__/nombre-apodo/NN-estado.png` para que el leader las
// vete (design-review) y se las muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN del delta #2 vive
// en e2e/animals.spec.ts (bloque `delta #2 nombre/apodo`); este archivo SOLO captura estados, reusando los
// MISMOS helpers de setup/seed/navegación y los MISMOS selectores de esa suite.
//
// El E2E NO depende de la migración 0119: siembra su propio fd "apodo" per-est vía seedCustomField (espejo del
// seed 0119 + set_rodeo_config del owner) y lo habilita en el rodeo. Es la pantalla REAL (crear-animal + la
// sección "Datos personalizados" de CustomPropertiesForm), no un mock.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/nombre-apodo.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/nombre-apodo/  (gitignoreado — ver app/.gitignore + ADR-029 §Artefactos).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedCustomField,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

// Path RELATIVO a app/ (cwd de Playwright) → resuelve a app/e2e/captures/__shots__/nombre-apodo/.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'nombre-apodo');

test.afterAll(async () => {
  await cleanupAll();
});

/** Saca una captura NOMBRADA tras un breve settle de layout. El llamador asegura un expect(...).toBeVisible()
 *  del elemento clave ANTES de invocar esto (per ADR-029). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Camina el wizard del alta desde el paso 2 (sexo) hasta el paso 4 (datos). COPIA de animals.spec.ts. */
async function walkWizardToData(page: Page, opts: { sex: 'Macho' | 'Hembra'; categoryName: string }) {
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Sexo ${opts.sex}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.categoryName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('captura delta #2: alta SIN "Nombre / seña" built-in + "apodo" por rodeo (Datos personalizados) + ficha', async ({
  page,
}) => {
  test.setTimeout(210_000);

  const user = await createTestUser('apodocap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo ApodoCap');
  // Habilitamos el "apodo" en el rodeo (fd per-est propiedad/text + rodeo_data_config enabled), espejo del
  // seed 0119 + el opt-in del owner por rodeo.
  await seedCustomField(establishmentId, rodeoId, {
    label: 'Nombre / apodo',
    dataKey: 'apodo',
    dataType: 'propiedad',
    uiComponent: 'text',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const emptyCta = page.getByRole('button', { name: 'Dar de alta tu primer animal' });
  await expect(emptyCta).toBeVisible({ timeout: 20_000 });
  // Dwell: el fd apodo + su rodeo_data_config se asientan en el SQLite local antes del alta.
  await page.waitForTimeout(3000);
  await emptyCta.click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // ── 01 — paso 4 (sección "Identificación"): SIN el input editable "Nombre / seña" por default (RNA.2.1);
  //         el identificador libre es la caravana visual. ──
  await expect(page.getByLabel('Caravana visual (recomendado)', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Nombre / seña (opcional)', { exact: true })).toHaveCount(0);
  await shot(page, '01-alta-paso4-sin-nombre-sena');

  // ── 02 — alta EN BLANCO → "Crear animal" → mensaje de identificador mínimo (sin "nombre/seña", RNA.3.1). ──
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();
  await expect(
    page.getByText('Cargá al menos un identificador: caravana electrónica o caravana visual.', { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await shot(page, '02-mensaje-identificador-minimo');

  // ── 03 — el "apodo" habilitado aparece en el alta bajo "Datos personalizados"; lo cargamos (RNA.2.2). ──
  const idv = `6120${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);
  const apodoSection = page.getByText('Datos personalizados', { exact: true });
  await expect(apodoSection).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nombre / apodo', { exact: true }).first()).toBeVisible();
  const apodoInput = page.getByTestId('custom-prop-text').first();
  await apodoInput.fill('Pinto');
  await apodoSection.scrollIntoViewIfNeeded();
  await shot(page, '03-apodo-en-datos-personalizados');

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // ── 04 — ficha del recién creado: el "apodo" se muestra por "Datos personalizados" (RNA.4.2). ──
  await expect(page.getByText('Identificación', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const fichaSection = page.getByText('Datos personalizados', { exact: true });
  await expect(fichaSection).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Pinto', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await fichaSection.scrollIntoViewIfNeeded();
  await shot(page, '04-ficha-apodo-datos-personalizados');
});
