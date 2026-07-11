// e2e/captures/vacunas-checklist.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// del delta D2 `vacunas-aplica-no-aplica` (spec 03 R6.1, triage demo-facundo-padre 2026-07-10): rediseño
// APLICA/NO-APLICA por checklist + endurecimiento de la pre-maniobra (etapa 2 exige ≥1 vacuna definida).
//
// Recorre el flujo del feature y saca capturas NOMBRADAS de cada estado clave a __shots__/vacunas-checklist/:
//   01 — etapa 2: Vacunación ELEGIDA SIN vacunas → marca "Faltan vacunas" (terracota) en la fila +
//        el CHEVRON de la fila coloreado en TERRACOTA (D2 enhancement Puerta 2 — CTA "tocá acá para
//        completar") + mensaje + continue BLOQUEADO ("Completá las vacunas").
//   02 — sheet de preconfig de Vacunación: 2 vacunas cargadas (Aftosa + Mancha).
//   03 — etapa 2: Vacunación CON vacunas → fila con "Aftosa, Mancha" + continue habilitado.
//   04 — carga rápida (por animal): checklist con TODAS tildadas (APLICA por default) → CTA "Aplicar y seguir".
//   05 — una destildada (Mancha = NO APLICA, pill terracota) → CTA sigue "Aplicar y seguir".
//   06 — TODAS destildadas (0 aplican) → CTA "Seguir sin aplicar" (path honesto D1).
//
// Setup espejado de skip-animal-maniobra.capture.ts: rodeo "Cría hembras" (0018 habilita `vaccination` por
// default) + hembra vaquillona con EID → identificación por bastonazo del MockAdapter (flag __RAFAQ_BLE_E2E__,
// fuera de prod). Jornada con SOLO Vacunación → la carga rápida tiene un único paso = el checklist. NO corras
// esto en `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/vacunas-checklist.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page } from '../helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', 'vacunas-checklist');

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

async function markBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
}

async function connectMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
}

async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

test('capturas vacunas APLICA/NO-APLICA (checklist + pre-maniobra) @ 412px', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 412, height: 915 },
  });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBle(page);

  try {
    const user = await createTestUser('cap-vacunas-checklist');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Vacunas', {
      rodeoName: 'Cría hembras',
      rodeoRawName: true,
    });
    const eid = makeEid();
    const visual = '0385';
    await seedAnimal(establishmentId, rodeoId, {
      tag: eid,
      idv: visual,
      sex: 'female',
      categoryCode: 'vaquillona',
    });

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // El animal baja por la stream (visible en la lista = sincronizado al SQLite local).
    await gotoAnimales(page);
    await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

    // ── WIZARD etapa 2: elegir SOLO Vacunación. ──
    await page.goto('/maniobra/jornada');
    await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
    await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pool-row-vacunacion')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta
    await page.getByTestId('pool-row-vacunacion').click();

    // (01) Vacunación elegida SIN vacunas → marca "Faltan vacunas" + CHEVRON terracota (CTA) + continue bloqueado.
    await expect(page.getByTestId('selected-config-warn-0')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Faltan vacunas', { exact: true })).toBeVisible();
    // D2 enhancement (Puerta 2): el chevron '>' de la fila es un CTA terracota ("tocá acá para completar").
    await expect(page.getByTestId('selected-config-fix-0')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Completá las vacunas', exact: true })).toBeVisible();
    await expect(page.getByText(/Falta definir la vacuna de la tanda/)).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '01-etapa2-faltan-vacunas.png') });

    // ── Abrir el sheet de preconfig y cargar 2 vacunas (Aftosa + Mancha). ──
    await page.getByTestId('selected-body-0').click();
    await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('maneuver-config-input').fill('Aftosa');
    await page.getByRole('button', { name: 'Agregar vacuna', exact: true }).click();
    await page.getByTestId('maneuver-config-input').fill('Mancha');
    await page.getByRole('button', { name: 'Agregar vacuna', exact: true }).click();
    await expect(page.getByTestId('config-chip-Aftosa')).toBeVisible();
    await expect(page.getByTestId('config-chip-Mancha')).toBeVisible();
    // (02) Sheet con las 2 vacunas de la tanda.
    await page.screenshot({ path: path.join(SHOT_DIR, '02-sheet-preconfig-2-vacunas.png') });
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });

    // (03) Etapa 2 con la vacuna definida → fila muestra "Aftosa, Mancha" + continue habilitado.
    await expect(page.getByTestId('selected-config-warn-0')).toHaveCount(0);
    await expect(page.getByText('Aftosa, Mancha', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Continuar/ })).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '03-etapa2-vacuna-definida.png') });

    // ── Arrancar la jornada → carga rápida. ──
    await page.getByRole('button', { name: /^Continuar/ }).click();
    await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();

    // Hero adaptativo (M2.1): con el mock conectable arranca en ConnectHero → conectamos → ScanHero.
    await connectMock(page);
    await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });

    // ── CARGA RÁPIDA: bastonazo → found → auto-avance al paso de VACUNACIÓN (checklist). ──
    await bastonazo(page, eid);
    await expect(page.getByTestId('vaccine-check-Aftosa')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('vaccine-check-Mancha')).toBeVisible();

    // (04) Checklist con TODAS tildadas (APLICA por default) → CTA "Aplicar y seguir".
    await expect(page.getByText('Aplicar y seguir', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '04-checklist-todas-aplica.png') });

    // (05) Destildar Mancha (NO APLICA, pill terracota) → CTA sigue "Aplicar y seguir".
    await page.getByTestId('vaccine-check-Mancha').click();
    await expect(page.getByTestId('vaccine-noaplica-Mancha')).toBeVisible();
    await expect(page.getByText('Aplicar y seguir', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '05-checklist-una-no-aplica.png') });

    // (06) Destildar Aftosa también → 0 aplican → CTA "Seguir sin aplicar" (path honesto D1).
    await page.getByTestId('vaccine-check-Aftosa').click();
    await expect(page.getByTestId('vaccine-noaplica-Aftosa')).toBeVisible();
    await expect(page.getByText('Seguir sin aplicar', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '06-checklist-cero-seguir-sin-aplicar.png') });
  } finally {
    await ctx.close();
  }
});
