// e2e/captures/alta-bastoneo.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta
// bastoneo-captura-alta-parto (RCF.6 generalizado al ALTA): bastonear la caravana electrónica al dar de alta un
// animal. Recorre el flujo y saca CAPTURAS NOMBRADAS de cada estado clave a
// e2e/captures/__shots__/alta-bastoneo/NN-estado.png para que el leader las vete (design-review) y se las
// muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN vive en
// e2e/alta-bastoneo.spec.ts; este archivo SOLO captura estados, reusando el MISMO mock del bastón
// (__RAFAQ_BLE_E2E__ / window.__rafaqBle) y los MISMOS testIDs (tag-scan-* / tag-captured).
//
// Es la pantalla REAL: el sheet vive en src/components/TagScanSheet.tsx (modo captura), lo dispara el CTA
// TagScanCta del paso 4 del alta (app/crear-animal.tsx).
//
// Para correrlo:
//   cd app && pnpm exec playwright test e2e/captures/alta-bastoneo.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/alta-bastoneo/  (gitignoreado — app/.gitignore + ADR-029).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'alta-bastoneo');

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

async function walkAltaToData(page: Page): Promise<void> {
  await gotoAnimales(page);
  const emptyCta = page.getByRole('button', { name: 'Dar de alta tu primer animal' });
  await expect(emptyCta).toBeVisible({ timeout: 20_000 });
  await emptyCta.click();
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Categoría Vaquillona', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ─── PASADA A (mock conectable/conectado): CTA en el alta → connect/scan hero → lectura "Usar caravana" →
//     capturado read-only con "Cambiar". ──
test('captura RCF.6 alta: CTA / sheet / lectura "Usar caravana" / capturado read-only', async ({ page }) => {
  test.setTimeout(180_000);

  const user = await createTestUser('altacap');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo AltaCap');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await walkAltaToData(page);

  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`700${Date.now().toString().slice(-6)}`);

  // ── 01 — el paso de DATOS: la caravana electrónica se ofrece como CTA "Bastonear la caravana (opcional)"
  //         (no un campo tipeable suelto). ──
  await expect(page.getByTestId('tag-scan-open')).toBeVisible({ timeout: 15_000 });
  await shot(page, '01-alta-cta-bastonear');

  // ── 02 — sheet abierto, transporte CONECTABLE (mock desconectado) → hero "Conectá el bastón". ──
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible();
  await shot(page, '02-sheet-conectar');

  // ── 03 — conectado → hero de ESCANEO. ──
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 10_000 });
  await shot(page, '03-sheet-escaneando');

  // ── 04 — lectura → confirmación pre-commit con la copy de CAPTURA ("Usar caravana … para el animal"). ──
  const eid = makeEid(1);
  await page.evaluate((e: string) => {
    const h = (window as unknown as { __rafaqBle?: { tagRead: (x: string) => void } }).__rafaqBle;
    h?.tagRead(e);
  }, eid);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Usar caravana', exact: true })).toBeVisible();
  await shot(page, '04-lectura-usar-caravana');

  // ── 05 — capturado: el sheet cierra + la caravana queda read-only en el form con "Cambiar" (mis-scan corregible). ──
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-captured')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();
  await shot(page, '05-capturado-readonly-cambiar');
});

// ─── PASADA B (sin transporte, manual-promovido): el sheet degrada al prompt neutro + la carga MANUAL vive
//     DENTRO del sheet — el campo de texto de 15 díg con el botón "Usar caravana". ──
test('captura RCF.6 alta: sheet manual-promovido + carga manual DENTRO del sheet', async ({ page }) => {
  test.setTimeout(150_000);

  const user = await createTestUser('altacapm');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo AltaCapM');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await walkAltaToData(page);

  // ── 06 — sin transporte → hero manual-promovido (tono NEUTRO). ──
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('El bastón no está disponible en este dispositivo', { exact: true })).toBeVisible();
  await shot(page, '06-sheet-manual-promovido');

  // ── 07 — la carga MANUAL vive DENTRO del sheet: campo de 15 díg + "Usar caravana". ──
  await page.getByTestId('tag-scan-to-manual').click();
  await expect(page.getByTestId('tag-scan-manual')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Caravana electrónica', { exact: true })).toBeVisible();
  await shot(page, '07-sheet-carga-manual');

  // ── 08 — validación inline: 8 díg → "Usar caravana" → error de largo (fail-closed, sigue en manual). ──
  await page.getByLabel('Caravana electrónica', { exact: true }).fill('12345678');
  await page.getByTestId('tag-scan-manual-assign').click();
  await expect(page.getByText('La caravana electrónica tiene que tener 15 dígitos.')).toBeVisible({ timeout: 10_000 });
  await shot(page, '08-manual-error-largo');
});
