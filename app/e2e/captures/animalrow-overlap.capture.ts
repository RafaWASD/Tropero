// e2e/captures/animalrow-overlap.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el FIX de
// LAYOUT "overlap AnimalRow": en la lista de Animales, el chip "Sin electrónica" (derecha) se superponía
// con el chip de estado reproductivo "Servida sin tacto" cuando la categoría era larga ("Vaca segundo
// servicio"). Bug Nivel A (ADR-028, sin delta-spec).
//
// Recorre la lista REAL de la tab "Animales" (pantalla real, NO un mock) y saca CAPTURAS NOMBRADAS del
// caso del bug (fila apretada) y del caso normal (categoría corta + chevron) a
// e2e/captures/__shots__/animalrow-overlap/NN-estado.png — para que el leader vete el diseño contra las
// capturas en el Gate 2.5 antes de la Puerta 2.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). Reusa los MISMOS helpers de
// setup/seed/navegación que animals.spec.ts.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/animalrow-overlap.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/animalrow-overlap/  (gitignoreado — ver app/.gitignore + ADR-029 §Artefactos).

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

// Path RELATIVO a app/ (cwd de Playwright) → resuelve a app/e2e/captures/__shots__/animalrow-overlap/.
// page.screenshot crea los dirs padre solos.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'animalrow-overlap');

const VIEWPORT_W = 412;
const VIEWPORT_H = 915;

test.afterAll(async () => {
  await cleanupAll();
});

/** Captura NOMBRADA de todo el viewport, tras un breve settle de layout. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false });
}

/** Captura CLIPEADA a una fila (para ver el detalle sin ruido). Clampa el clip al viewport. */
async function shotRow(page: Page, row: import('@playwright/test').Locator, name: string): Promise<void> {
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await row.boundingBox();
  if (!box) {
    await shot(page, name);
    return;
  }
  const y = Math.max(0, Math.min(box.y, VIEWPORT_H - 1));
  const height = Math.max(box.height, Math.min(box.height + 8, VIEWPORT_H - y));
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), clip: { x: 0, y, width: VIEWPORT_W, height } });
}

test('capturas fix overlap AnimalRow (fila apretada sin superposición + fila normal)', async ({ page }) => {
  // ── Seed: owner con teléfono (saltea el gate R3.8) + 1 campo con 1 rodeo de cría ──────────────────
  const user = await createTestUser('rowoverlap', 'Facundo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'La Esperanza');

  // Caravanas electrónicas ÚNICAS por corrida (tag_electronic es único global): timestamp → 15 díg, con el
  // último díg distinto por animal para no colisionar entre sí ni con corridas previas.
  const stamp = Date.now().toString();
  const tagTernero = `${('38' + stamp).slice(0, 14)}1`; // 15 díg, termina en 1
  const tagMultipara = `${('38' + stamp).slice(0, 14)}2`; // 15 díg, termina en 2

  // (a) FILA APRETADA = el caso del bug: hembra con categoría LARGA "Vaca segundo servicio" (badge) +
  //     estado reproductivo "Servida sin tacto" (categoría PROBADA → served_untested, sin eventos) +
  //     SIN caravana electrónica (→ chip "Sin electrónica" a la derecha). categoryOverride=true FIJA la
  //     categoría de display en vaca_segundo_servicio (si no, el espejo C6 la recomputaría a vaquillona
  //     sin partos → cambiaría badge Y estado). idv '2210' identifica la fila.
  await seedAnimal(establishmentId, rodeoId, {
    idv: '2210',
    sex: 'female',
    categoryCode: 'vaca_segundo_servicio',
    categoryOverride: true,
  });

  // (b) FILA NORMAL = categoría corta + chevron: macho ternero CON caravana electrónica (→ chevron, no
  //     chip "Sin electrónica"). Sin chip repro (macho). Debe verse idéntica al comportamiento previo.
  await seedAnimal(establishmentId, rodeoId, {
    idv: '3301',
    sex: 'male',
    categoryCode: 'ternero',
    categoryOverride: true,
    tag: tagTernero,
  });

  // (c) CONTROL = categoría corta + chip repro + chevron (no apretado): multípara CON caravana → "Multípara"
  //     + "Servida sin tacto" + chevron. Confirma que el chip repro se ve COMPLETO cuando hay lugar (chevron
  //     ~24px deja mucho más ancho que el chip "Sin electrónica"), i.e. el caso normal NO cambió.
  await seedAnimal(establishmentId, rodeoId, {
    idv: '5501',
    sex: 'female',
    categoryCode: 'multipara',
    categoryOverride: true,
    tag: tagMultipara,
  });

  // ── Login → home → tab Animales ───────────────────────────────────────────────────────────────
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Esperamos a que las 3 filas estén en la lista (el first-sync bajó los animales sembrados).
  const tightRow = page.getByRole('button', { name: /Vaca segundo servicio, 2210/ }).first();
  const normalRow = page.getByRole('button', { name: /Ternero, 3301/ }).first();
  const controlRow = page.getByRole('button', { name: /Multípara, 5501/ }).first();
  await expect(tightRow).toBeVisible({ timeout: 30_000 });
  await expect(normalRow).toBeVisible({ timeout: 30_000 });
  await expect(controlRow).toBeVisible({ timeout: 30_000 });

  // ── ORÁCULO de NO-SUPERPOSICIÓN (el corazón del fix). En la fila apretada, el borde DERECHO del chip
  //    de estado repro ("Servida sin tacto") NO debe cruzar el borde IZQUIERDO del chip "Sin electrónica".
  //    Scopeamos ambos DENTRO de la fila del bug (hay otro "Servida sin tacto" en la multípara). ──
  const reproChip = tightRow.getByLabel('Estado reproductivo: Servida sin tacto');
  const noTagChip = tightRow.getByLabel('Sin electrónica');
  await expect(reproChip).toBeVisible();
  await expect(noTagChip).toBeVisible();
  const reproBox = await reproChip.boundingBox();
  const noTagBox = await noTagChip.boundingBox();
  expect(reproBox).not.toBeNull();
  expect(noTagBox).not.toBeNull();
  if (reproBox && noTagBox) {
    // Sin superposición horizontal: fin del chip repro ≤ inicio del chip "Sin electrónica" (tolerancia 0.5px
    // por redondeo sub-pixel del layout web).
    expect(reproBox.x + reproBox.width).toBeLessThanOrEqual(noTagBox.x + 0.5);
  }

  // ── Capturas ──────────────────────────────────────────────────────────────────────────────────
  // 01 — la lista completa: la fila apretada (bug) + la normal + el control, todas sin superposición.
  await shot(page, '01-lista-sin-overlap');
  // 02 — detalle de la fila APRETADA (el caso del bug): badge "Vaca segundo servicio" completo + chip
  //      repro truncado si hace falta + chip "Sin electrónica" completo, SIN pisarse.
  await shotRow(page, tightRow, '02-fila-apretada-sin-overlap');
  // 03 — detalle de la fila NORMAL (categoría corta + chevron): sin cambios respecto al comportamiento previo.
  await shotRow(page, normalRow, '03-fila-normal-chevron');
  // 04 — detalle del CONTROL (categoría corta + chip repro COMPLETO + chevron): confirma que el chip repro
  //      NO trunca cuando hay lugar (el caso normal quedó intacto).
  await shotRow(page, controlRow, '04-fila-control-chip-completo');
});
