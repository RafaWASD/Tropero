// e2e/captures/fechas-es-ar.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para la corrección
// cross-cutting de FECHAS es-AR (dd/mm/aaaa). Recorre la ficha del animal y saca una captura NOMBRADA del
// estado clave — la sección "Datos del animal" con la fecha de NACIMIENTO ya en formato argentino
// dd/mm/aaaa (antes se veía el ISO crudo "2023-04-15") — a
// e2e/captures/__shots__/fechas-es-ar/NN-estado.png, para que el leader la vete (design-review) y se la
// muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La red de regresión de esta
// corrección son los UNIT tests del util (format-date-es-ar.test.ts) + las suites afectadas
// (event-timeline / reports-format / sigsa-display / exit-animal). El resto de displays migrados
// (timeline dd/mm, badge "Vendido el …", reportes, historial SIGSA, invitaciones) usan EL MISMO util
// centralizado, lockeado por esos unit tests y renderizado en pantallas con sus propias capturas.
//
// La ficha es la pantalla REAL; el birth_date se siembra vía seedAnimal (columna `date`) → formatDateEsAr
// lo formatea por string (tz-safe, sin drift −1 día).
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/fechas-es-ar.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/fechas-es-ar/  (gitignoreado — ver app/.gitignore + ADR-029).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, seedAnimal, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

// Path RELATIVO a app/ (cwd de Playwright) → app/e2e/captures/__shots__/fechas-es-ar/.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'fechas-es-ar');

test.afterAll(async () => {
  await cleanupAll();
});

/** Saca una captura NOMBRADA tras un breve settle de layout (el llamador asegura el expect visible antes). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test('captura fechas es-AR: ficha "Datos del animal" → Nacimiento en dd/mm/aaaa (no ISO crudo)', async ({
  page,
}) => {
  test.setTimeout(210_000);

  const user = await createTestUser('fechacap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo FechaCap');

  // birth_date con día/mes/año inequívocos → el formato dd/mm/aaaa se lee claro en la captura.
  const idv = `6130${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female', birthDate: '2023-04-15' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Abrimos la ficha del animal sembrado (buscar por idv → tap la fila).
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // ── 01 — sección "Datos del animal": Nacimiento = 15/04/2023 (dd/mm/aaaa es-AR, NO "2023-04-15"). ──
  const datos = page.getByText('Datos del animal', { exact: true });
  await expect(datos).toBeVisible({ timeout: 20_000 });
  await datos.scrollIntoViewIfNeeded();
  await expect(page.getByText('15/04/2023', { exact: true })).toBeVisible({ timeout: 15_000 });
  // Sanidad: el ISO crudo NO debe aparecer en ninguna parte de la ficha.
  await expect(page.getByText('2023-04-15', { exact: true })).toHaveCount(0);
  await shot(page, '01-ficha-nacimiento-dd-mm-aaaa');
});
