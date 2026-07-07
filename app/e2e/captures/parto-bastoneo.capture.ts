// e2e/captures/parto-bastoneo.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta
// bastoneo-captura-alta-parto (RCF.6 generalizado al PARTO, POR TERNERO): bastonear la caravana electrónica de
// cada ternero en el form de Parto. Recorre el flujo y saca CAPTURAS NOMBRADAS de cada estado clave a
// e2e/captures/__shots__/parto-bastoneo/NN-estado.png para que el leader las vete (design-review) y se las
// muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN vive en
// e2e/parto-bastoneo.spec.ts; este archivo SOLO captura estados, reusando el MISMO mock del bastón
// (__RAFAQ_BLE_E2E__ / window.__rafaqBle) y los MISMOS testIDs (tag-scan-* / tag-captured-<i>).
//
// Es la pantalla REAL: el sheet vive en src/components/TagScanSheet.tsx (modo captura), lo dispara el CTA
// TagScanCta de cada CalfBlock en el form de Parto (app/agregar-evento.tsx, eventType='birth').
//
// Para correrlo:
//   cd app && pnpm exec playwright test e2e/captures/parto-bastoneo.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/parto-bastoneo/  (gitignoreado — app/.gitignore + ADR-029).

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

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'parto-bastoneo');

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

async function openParto(page: Page, motherIdv: string): Promise<void> {
  await gotoAnimales(page);
  const motherRow = page.getByRole('button', { name: new RegExp(motherIdv) }).first();
  await expect(motherRow).toBeVisible({ timeout: 20_000 });
  await motherRow.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Parto', exact: true }).click();
  await expect(page.getByText('Ternero 1', { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function connectMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
}

async function tagRead(page: Page, eid: string): Promise<void> {
  await page.evaluate((e: string) => {
    const h = (window as unknown as { __rafaqBle?: { tagRead: (x: string) => void } }).__rafaqBle;
    h?.tagRead(e);
  }, eid);
}

test('captura RCF.6 parto: CTA por ternero / captura en un ternero / mellizos con caravanas distintas', async ({ page }) => {
  test.setTimeout(210_000);

  const user = await createTestUser('partobcap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo PartoBcap');
  const motherIdv = `6201${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openParto(page, motherIdv);

  await page.getByRole('button', { name: 'Macho', exact: true }).first().click();

  // ── 01 — Ternero 1: la caravana electrónica se ofrece como CTA "Bastonear la caravana (opcional)". ──
  await expect(page.getByTestId('tag-scan-open-0')).toBeVisible({ timeout: 15_000 });
  await shot(page, '01-parto-cta-por-ternero');

  // ── 02 — sheet abierto para el ternero 1 → conectar → escanear → lectura "Usar caravana … para este ternero". ──
  await page.getByTestId('tag-scan-open-0').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await connectMock(page);
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 10_000 });
  const eid0 = makeEid(1);
  await tagRead(page, eid0);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Usar caravana', exact: true })).toBeVisible();
  await shot(page, '02-lectura-usar-caravana-ternero');

  // ── 03 — capturado en el ternero 1: read-only con "Cambiar". ──
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-captured-0')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(eidReadable(eid0), { exact: true })).toBeVisible();
  await shot(page, '03-ternero1-capturado');

  // ── 04 — MELLIZOS: agregar un 2º ternero → cada uno su CTA independiente. ──
  await page.getByRole('button', { name: 'Agregar otro ternero', exact: true }).click();
  await expect(page.getByText('Ternero 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hembra', exact: true }).nth(1).click();
  await expect(page.getByTestId('tag-scan-open-1')).toBeVisible();
  await shot(page, '04-mellizos-cta-ternero2');

  // ── 05 — bastonear el ternero 2 (otra caravana) → los DOS terneros con SUS caravanas distintas. ──
  await page.getByTestId('tag-scan-open-1').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await connectMock(page);
  const eid1 = makeEid(2);
  await tagRead(page, eid1);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-captured-1')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(eidReadable(eid0), { exact: true })).toBeVisible();
  await expect(page.getByText(eidReadable(eid1), { exact: true })).toBeVisible();
  await shot(page, '05-mellizos-dos-caravanas');
});
