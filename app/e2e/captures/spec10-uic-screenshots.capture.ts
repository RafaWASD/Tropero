// e2e/captures/spec10-uic-screenshots.capture.ts — CAPTURA de pantallas para el design-review de spec 10
// chunk UI-C (la FICHA del animal: T-UI.7 Castrado Sí/No + ⭐ futuro torito + confirmación que anticipa el
// recálculo; y la verificación de que esos controles NO aparecen para HEMBRAS).
//
// NO es un test de regresión: es un GENERADOR DE SCREENSHOTS fieles al código ACTUAL. Por eso el nombre es
// `.capture.ts` (NO `.spec.ts`) → NO lo recoge el `pnpm e2e` de regresión; se corre a mano:
//
//   pnpm exec playwright test e2e/captures/spec10-uic-screenshots.capture.ts --config playwright.capture.config.ts
//
// Genera (design/spec10-ui-c/):
//   - ficha-macho-manejo.png   → ficha de un TORITO con la sección "Manejo": fila "Castrado: No" + "Cambiar"
//     + "Futuro torito: Sí" con el badge ⭐ + "Quitar". Solo-machos.
//   - ficha-macho-confirmar.png → la confirmación inline del toggle Castrado que ANTICIPA el recálculo
//     ("La categoría se recalcula: Novillito") — torito → novillito.
//   - ficha-hembra-sin-manejo.png → ficha de una VAQUILLONA confirmando que NO muestra la sección "Manejo"
//     (ni Castrado ni ⭐ futuro torito): esos controles son solo-machos.
//
// Reusa el harness E2E al 100% (fixtures + helpers/admin + helpers/ui). Siembra un OWNER con teléfono +
// 1 rodeo de cría + un torito (con future_bull=true) + una vaquillona. Viewport mobile 412 (config). Limpia
// todo al final.

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { test } from '../helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { APP_ROOT } from '../helpers/env';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';
import { expect } from '@playwright/test';

// design/spec10-ui-c/ vive en el repoRoot (un nivel arriba de app/).
const OUT_DIR = path.resolve(APP_ROOT, '..', 'design', 'spec10-ui-c');

/** Marca un perfil como "futuro torito" (future_bull, 0085) vía admin — la columna no la setea seedAnimal. */
async function setFutureBull(profileId: string): Promise<void> {
  const { error } = await admin.from('animal_profiles').update({ future_bull: true }).eq('id', profileId);
  if (error) throw new Error(`setFutureBull: ${error.message}`);
}

/** Abre la ficha de un animal por su IDV desde la tab Animales (busca + tap en la fila). */
async function openAnimalByIdv(page: import('@playwright/test').Page, idv: string): Promise<void> {
  await gotoAnimales(page);
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  // La ficha cargó cuando aparece "Datos del animal".
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test.afterAll(async () => {
  await cleanupAll();
});

test('capturas spec 10 UI-C (ficha: castrado + futuro torito + confirmación; hembra sin controles)', async ({
  page,
}) => {
  mkdirSync(OUT_DIR, { recursive: true });

  const today = new Date();
  const ageISO = (years: number, months = 0) => {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - years);
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };

  // ── Seed: owner + campo + rodeo de cría + un TORITO (future_bull) entero + una VAQUILLONA ─────────
  const user = await createTestUser('uicshots', 'Facundo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'La Ficha');

  // Torito macho 1-2 años, ENTERO (is_castrated=false), SIN override (para que el espejo C6 + el preview de
  // castración funcionen: torito → novillito). Lo marcamos future_bull para mostrar el badge ⭐ + "Quitar".
  const toritoId = await seedAnimal(establishmentId, rodeoId, {
    idv: '7001',
    sex: 'male',
    categoryCode: 'torito',
    birthDate: ageISO(1, 4),
  });
  await setFutureBull(toritoId);

  // Vaquillona hembra (control negativo: NO debe mostrar la sección "Manejo").
  await seedAnimal(establishmentId, rodeoId, {
    idv: '7501',
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: ageISO(1, 6),
  });

  // ── Login → home ──────────────────────────────────────────────────────────────────────────────
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── 1) Ficha del TORITO: sección "Manejo" (Castrado + ⭐ futuro torito) ──────────────────────────
  await openAnimalByIdv(page, '7001');
  // La sección "Manejo" (solo-machos): título + "Castrado" + "Futuro torito" + badge ⭐ ("Futuro torito").
  await expect(page.getByText('Manejo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Castrado', { exact: true })).toBeVisible();
  await expect(page.getByText('Futuro torito', { exact: true }).first()).toBeVisible();
  // El control "Cambiar" del castrado + "Quitar" del ⭐ (solo machos activos).
  await expect(page.getByText('Cambiar', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, 'ficha-macho-manejo.png'), fullPage: false });

  // ── 2) Confirmación del toggle Castrado que ANTICIPA el recálculo (torito → novillito) ───────────
  await page.getByRole('button', { name: 'Marcar como castrado', exact: true }).click();
  // La confirmación inline aparece con la línea de consecuencia "La categoría se recalcula: Novillito".
  await expect(page.getByText('¿Marcar este animal como castrado?', { exact: true })).toBeVisible({ timeout: 20_000 });
  // La consecuencia depende de que los eventos/catálogo hayan sincronizado al SQLite local del cliente web.
  // Si llegó, la capturamos con la línea; si hubo lag de sync, igual capturamos el diálogo (sin romper).
  await expect(page.getByText(/La categoría se recalcula:/)).toBeVisible({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, 'ficha-macho-confirmar.png'), fullPage: false });
  // Cancelamos (no queremos castrarlo realmente para la captura — el estado de la ficha queda intacto).
  await page.getByRole('button', { name: 'Cancelar', exact: true }).first().click();

  // Volver a la lista para abrir la hembra.
  await page.getByLabel('Volver', { exact: true }).click();

  // ── 3) Ficha de la VAQUILLONA: NO muestra la sección "Manejo" (controles solo-machos) ────────────
  await openAnimalByIdv(page, '7501');
  // Confirmación negativa: ni "Manejo" ni "Castrado" ni "Futuro torito" aparecen para una hembra.
  await expect(page.getByText('Manejo', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Castrado', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Futuro torito', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, 'ficha-hembra-sin-manejo.png'), fullPage: false });
});
