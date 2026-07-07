// e2e/captures/cria-al-pie-bastoneo.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta
// bastoneo-cría-al-pie ("scan-para-llenar"): bastonear la caravana del ternero en el prompt VINCULAR LA CRÍA AL
// PIE. Recorre el flujo y saca CAPTURAS NOMBRADAS de cada estado clave a
// e2e/captures/__shots__/cria-al-pie-bastoneo/NN-estado.png para que el leader las vete (design-review) y se las
// muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN vive en
// e2e/cria-al-pie-bastoneo.spec.ts; este archivo SOLO captura estados, reusando el MISMO mock del bastón
// (__RAFAQ_BLE_E2E__ / window.__rafaqBle) y los MISMOS testIDs (link-calf-scan-open / tag-scan-*).
//
// Es la pantalla REAL: el prompt vive en src/components/LinkCalfPrompt.tsx; el CTA "Bastonear la caravana del
// ternero" abre el TagScanSheet (modo captura, hideManualEntry) sobre el prompt.
//
// Para correrlo:
//   cd app && pnpm exec playwright test e2e/captures/cria-al-pie-bastoneo.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/cria-al-pie-bastoneo/  (gitignoreado — app/.gitignore + ADR-029).

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

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'cria-al-pie-bastoneo');

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

/** Camina el wizard de alta desde el paso 2 (sexo) al paso 4 (datos). Con 1 rodeo auto-avanza P1. */
async function walkWizardToData(page: Page, opts: { sex: 'Macho' | 'Hembra'; categoryName: string }): Promise<void> {
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Sexo ${opts.sex}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.categoryName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Alta de una vaca con cría al pie hasta disparar el prompt de vinculación. Deja el prompt en fase ask. */
async function openLinkPrompt(page: Page, seed: number): Promise<void> {
  await gotoAnimales(page);
  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`551${Date.now().toString().slice(-6)}${seed}`.slice(0, 12));
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ─── PASADA A (mock conectable/conectado): prompt ask con CTA → connect/scan hero → lectura "Usar caravana" →
//     resultado tras llenar por scan (fase create para un EID nuevo). ──
test('captura scan-para-llenar: prompt ask con CTA / sheet conectar-escanear / lectura / resultado create', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const user = await createTestUser('criabcap');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo CriaBCap');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openLinkPrompt(page, 1);

  // ── 01 — prompt (fase ask): el CTA "Bastonear la caravana del ternero" ARRIBA del campo de texto (EID o IDV). ──
  await expect(page.getByTestId('link-calf-scan-open')).toBeVisible();
  await expect(page.getByLabel('Caravana del ternero', { exact: true })).toBeVisible();
  await shot(page, '01-prompt-ask-con-cta');

  // ── 02 — sheet abierto, transporte CONECTABLE (mock desconectado) → hero "Conectá el bastón" + link "¿Sin
  //         bastón? Cerrá y escribí la caravana" (hideManualEntry: sin carga manual EID adentro). ──
  await page.getByTestId('link-calf-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible();
  await expect(page.getByText('¿Sin bastón? Cerrá y escribí la caravana', { exact: true })).toBeVisible();
  await shot(page, '02-sheet-conectar');

  // ── 03 — conectado → hero de ESCANEO. ──
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 10_000 });
  await shot(page, '03-sheet-escaneando');

  // ── 04 — lectura → confirmación pre-commit con la copy de captura ("Usar caravana"). ──
  const eid = makeEid(1);
  await page.evaluate((e: string) => {
    const h = (window as unknown as { __rafaqBle?: { tagRead: (x: string) => void } }).__rafaqBle;
    h?.tagRead(e);
  }, eid);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Usar caravana', exact: true })).toBeVisible();
  await shot(page, '04-lectura-usar-caravana');

  // ── 05 — confirmar → el sheet cierra + el EID LLENÓ el buscador + el find-or-create avanzó a la fase CREATE
  //         (EID nuevo, no existe). Es el "resultado tras llenar por scan". ──
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('Sexo del ternero', { exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(page, '05-resultado-create-llenado-por-scan');
});

// ─── PASADA B (sin transporte, manual-promovido): el sheet degrada al prompt neutro con el CTA "Cerrá y
//     escribí la caravana" (hideManualEntry: el operario tipea en el campo EXTERNO del buscador, no adentro). ──
test('captura scan-para-llenar: sheet sin transporte → "Cerrá y escribí la caravana"', async ({ page }) => {
  test.setTimeout(150_000);

  const user = await createTestUser('criabcapm');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo CriaBCapM');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openLinkPrompt(page, 2);

  // ── 06 — sin transporte → hero manual-promovido (tono NEUTRO) con el CTA "Cerrá y escribí la caravana"
  //         (con hideManualEntry el sheet NO carga la electrónica adentro: se cierra para tipear afuera). ──
  await page.getByTestId('link-calf-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('El bastón no está disponible en este dispositivo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrá y escribí la caravana', exact: true })).toBeVisible();
  await shot(page, '06-sheet-sin-transporte-cerra-y-escribi');
});
