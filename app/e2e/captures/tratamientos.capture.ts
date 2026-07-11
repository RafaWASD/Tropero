// e2e/captures/tratamientos.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta TRATAMIENTOS
// (spec 02, RTR.1–RTR.9). Recorre el ciclo iniciar → aplicar → finalizar desde la ficha + la marca/pin en la
// lista, y saca CAPTURAS NOMBRADAS de cada estado clave a e2e/captures/__shots__/tratamientos/NN-estado.png
// para que el leader las vete (design-review, veto del token de color sanitario, RTR.4.5) y se las muestre a
// Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN vive en
// e2e/treatments.spec.ts; este archivo SOLO captura estados, reusando los MISMOS helpers de setup/seed/
// navegación y los MISMOS selectores (a11y labels) de esa suite.
//
// ⚠️ REQUIERE la migración 0123 aplicada + la stream ev_treatments deployada (deploy gateado a Raf). El leader
// lo corre POST-deploy en el Gate 2.5.
//
// Es la pantalla REAL (NO un mock): la sección vive en src/components/TreatmentsSection.tsx + los sheets
// TreatmentStartSheet/TreatmentApplicationSheet, montados por app/app/animal/[id].tsx.
//
// Para correrlo (POST-deploy):
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/tratamientos.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/tratamientos/  (gitignoreado — ver app/.gitignore + ADR-029 §Artefactos).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'tratamientos');

test.afterAll(async () => {
  await cleanupAll();
});

/** Saca una captura NOMBRADA tras un breve settle de layout. El llamador asegura visibilidad ANTES. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test('capturas: ciclo iniciar → aplicar → finalizar + marca/pin', async ({ page }) => {
  const user = await createTestUser('trtcap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Tratamientos');

  const idvTreated = `TRT${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: idvTreated, sex: 'female', categoryCode: 'vaca', birthDate: '2020-03-01' });
  const idvOther = `OTR${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: idvOther, sex: 'female', categoryCode: 'vaca', birthDate: '2021-03-01' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Lista general SIN marca (estado de partida).
  await expect(page.getByRole('button', { name: new RegExp(idvTreated) }).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '01-lista-sin-marca');

  // Ficha del animal a tratar.
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill(idvTreated);
  const row = page.getByRole('button', { name: new RegExp(idvTreated) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.tap();
  await expect(page.getByText('Tratamientos', { exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(page, '02-ficha-seccion-vacia');

  // ── Sheet Iniciar tratamiento: abierto, con el selector de tipo desplegado, y validación (producto vacío) ──
  await page.getByRole('button', { name: 'Iniciar tratamiento', exact: true }).tap();
  await expect(page.getByText('Iniciar tratamiento', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, '03-sheet-iniciar');

  // Selector de tipo abierto (3 opciones cerradas).
  await page.getByLabel('Tipo de tratamiento', { exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Antibiótico', exact: true })).toBeVisible();
  await shot(page, '04-sheet-selector-tipo');

  // Estado de validación: intentar iniciar sin producto → errores inline.
  await page.getByRole('button', { name: 'Antibiótico', exact: true }).tap();
  await page.getByRole('button', { name: 'Iniciar tratamiento', exact: true }).last().tap();
  await expect(page.getByText('Ingresá qué producto se aplicó.', { exact: true })).toBeVisible();
  await shot(page, '05-sheet-validacion');

  // Con la 1ª aplicación expandida (toggle) + producto cargado.
  await page.getByLabel('Producto', { exact: true }).fill('Oxitetraciclina');
  await page.getByRole('button', { name: 'Registrar la primera aplicación ahora', exact: true }).tap();
  await expect(page.getByLabel('Dosis en ml (opcional)', { exact: true })).toBeVisible();
  await page.getByLabel('Dosis en ml (opcional)', { exact: true }).fill('5');
  await shot(page, '06-sheet-con-primera-aplicacion');

  // Confirmar → la ficha con la marca "En tratamiento" en el hero + la card con la aplicación.
  await page.getByRole('button', { name: 'Iniciar tratamiento', exact: true }).last().tap();
  await expect(page.getByLabel('En tratamiento', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Oxitetraciclina', { exact: true }).first()).toBeVisible();
  await shot(page, '07-ficha-en-tratamiento');

  // ── Lista general: el animal tratado PINNEA arriba con la marca ──
  await gotoAnimales(page);
  await expect(page.getByLabel('En tratamiento').first()).toBeVisible({ timeout: 20_000 });
  await shot(page, '08-lista-pin-y-marca');

  // ── Lista del RODEO: idem (RTR.5.2) ──
  await page.goto(`/rodeo/${rodeoId}`);
  await expect(page.getByRole('button', { name: new RegExp(idvTreated) }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('En tratamiento').first()).toBeVisible();
  await shot(page, '09-lista-rodeo-pin');

  // ── Volver a la ficha → Sheet Registrar aplicación ──
  await page.getByRole('button', { name: new RegExp(idvTreated) }).first().tap();
  await expect(page.getByText('Tratamientos', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Registrar aplicación', exact: true }).first().tap();
  await expect(page.getByText('Registrar aplicación', { exact: true }).first()).toBeVisible();
  await shot(page, '10-sheet-aplicacion');

  await page.getByLabel('Dosis en ml (opcional)', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Registrar aplicación', exact: true }).last().tap();
  await expect(page.getByText(/4 ml/).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, '11-ficha-varias-aplicaciones');

  // ── Finalizar (confirmación inline) ──
  await page.getByRole('button', { name: 'Finalizar tratamiento', exact: true }).first().tap();
  await expect(page.getByText(/¿Finalizar este tratamiento\?/).first()).toBeVisible();
  await shot(page, '12-finalizar-confirmacion');

  await page.getByRole('button', { name: 'Finalizar', exact: true }).tap();
  await expect(page.getByLabel('En tratamiento', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByLabel('Finalizado', { exact: true }).first()).toBeVisible();
  await shot(page, '13-ficha-finalizado');
});
