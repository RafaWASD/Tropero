// e2e/captures/caravana-ficha-bastoneo.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta
// caravana-ficha BASTONEO (spec 02, RCF.6): bastonear la caravana electrónica desde la FICHA del animal.
// Recorre el flujo y saca CAPTURAS NOMBRADAS de cada estado clave a
// e2e/captures/__shots__/caravana-ficha-bastoneo/NN-estado.png para que el leader las vete (design-review) y
// se las muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN del RCF.6 vive en
// e2e/baston-ficha.spec.ts; este archivo SOLO captura estados, reusando el MISMO mecanismo de mock del bastón
// (marca __RAFAQ_BLE_E2E__ / handle window.__rafaqBle) y los MISMOS testIDs (tag-scan-*).
//
// Es la pantalla REAL (NO un mock): el sheet vive en src/components/TagScanSheet.tsx, lo dispara la ficha
// (app/animal/[id].tsx) al tocar "Bastonear la caravana" con la caravana electrónica vacía.
//
// Para correrlo:
//   cd app && pnpm exec playwright test e2e/captures/caravana-ficha-bastoneo.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/caravana-ficha-bastoneo/  (gitignoreado — ver app/.gitignore + ADR-029).

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

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'caravana-ficha-bastoneo');

test.afterAll(async () => {
  await cleanupAll();
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

function makeEid(seed: number): string {
  const tail = String(Date.now()).slice(-9) + String(1000 + seed).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

function eidReadable(eid: string): string {
  return `${eid.slice(0, 3)} ${eid.slice(3, 7)} ${eid.slice(7, 11)} ${eid.slice(11, 15)}`;
}

async function openFicha(page: Page, idv: string): Promise<void> {
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: new RegExp(idv) }).first().click();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ─── PASADA A (mock conectable/conectado): afordancia → connect hero → scan hero → lectura → post-asignación ──
test('captura RCF.6: bastoneo desde la ficha (afordancia / connect / scan / lectura / post-asignación)', async ({ page }) => {
  test.setTimeout(180_000);

  const user = await createTestUser('cfscap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CFScap');
  const idv = `9301${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv, visualAlt: `${RUN_TAG}-CAP`, sex: 'female' });

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openFicha(page, idv);

  // ── 01 — la sección "Identificación": ÚNICA afordancia de la electrónica vacía = "Bastonear la caravana"
  //         (la carga manual por teclado vive DENTRO del sheet, no en la ficha — UX Raf 2026-07-06). ──
  await expect(page.getByTestId('tag-scan-open')).toBeVisible({ timeout: 15_000 });
  await shot(page, '01-afordancia-ficha-bastonear');

  // ── 02 — sheet recién abierto, transporte CONECTABLE (mock desconectado) → hero "Conectá el bastón". ──
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible();
  await shot(page, '02-sheet-conectar');

  // ── 03 — conectado (connectMock) → hero de ESCANEO "Acercá el bastón al animal". ──
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 10_000 });
  await shot(page, '03-sheet-escaneando');

  // ── 04 — lectura recibida → confirmación pre-commit (EID legible + "Asignar caravana"). ──
  const eid = makeEid(1);
  await page.evaluate((e: string) => {
    const h = (window as unknown as { __rafaqBle?: { tagRead: (x: string) => void } }).__rafaqBle;
    h?.tagRead(e);
  }, eid);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();
  await shot(page, '04-lectura-confirmacion');

  // ── 05 — post-asignación: el sheet se cierra + la caravana queda en la ficha en solo-lectura (read-only). ──
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(eid, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await shot(page, '05-post-asignacion-readonly');
});

// ─── PASADA B (sin transporte, manual-promovido): el sheet degrada al prompt neutro + la carga MANUAL vive
//     DENTRO del sheet (detrás del CTA) — el campo de texto de 15 díg. ──
test('captura RCF.6: sheet manual-promovido + carga manual DENTRO del sheet', async ({ page }) => {
  test.setTimeout(150_000);

  const user = await createTestUser('cfscapm');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CFScapM');
  const idv = `9401${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv, visualAlt: `${RUN_TAG}-CAPM`, sex: 'female' });

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openFicha(page, idv);

  // ── 06 — sin transporte → hero manual-promovido: "Cargá la caravana a mano" + "El bastón no está
  //         disponible en este dispositivo" (tono NEUTRO) + CTA a la carga manual. ──
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('El bastón no está disponible en este dispositivo', { exact: true })).toBeVisible();
  await shot(page, '06-sheet-manual-promovido');

  // ── 07 — tap el CTA → la carga MANUAL vive DENTRO del sheet: campo de texto de 15 díg + "Asignar caravana". ──
  await page.getByTestId('tag-scan-to-manual').click();
  await expect(page.getByTestId('tag-scan-manual')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Caravana electrónica', { exact: true })).toBeVisible();
  await shot(page, '07-sheet-carga-manual');
});
