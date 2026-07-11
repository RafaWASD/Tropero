// e2e/captures/skip-animal-maniobra.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// del delta `skip-por-paso-v2` (spec 03 R5.15, Puerta 2 demo-facundo-padre): REDISEÑO del SALTEAR en la carga
// rápida de MODO MANIOBRA. El skip pasa de per-animal (v1, rechazado) a POR-PASO (primario) + animal-entero
// (secundario).
//
// Recorre el flujo del feature y saca capturas NOMBRADAS de cada estado clave a __shots__/skip-por-paso/:
//   01 — carga rápida (paso 1, tacto de aptitud) con la afordancia PRIMARIA "Saltear aptitud" (pill) + la
//        SECUNDARIA "⋯" (overflow, saltar animal) en el header. Jerarquía clara: el pill domina, el "⋯" no.
//   02 — tras tocar "Saltear aptitud": el frame avanza al SIGUIENTE paso del MISMO animal (pesaje · 2 de 2) —
//        el animal NO se abandonó, se saltó SOLO ese paso.
//   03 — resumen del animal: la maniobra salteada muestra "Salteado" (decisión tomada, corregible), el pesaje
//        su valor. El "⋯" (saltar animal, secundario) sigue disponible en el header del resumen.
//   04 — SkipAnimalSheet (SECUNDARIO) abierto desde el "⋯": tono AVISO con datos → terracota "Se descarta lo
//        cargado (1 maniobra)".
//   05 — vuelta al identify-first tras saltar el animal (el próximo animal; el contador NO se incrementó:
//        "0 hoy").
//
// Setup espejado del original: rodeo "Cría hembras" (0018 habilita tacto_vaquillona por default) + hembra
// vaquillona con EID → identificación por bastonazo del MockAdapter (flag __RAFAQ_BLE_E2E__, fuera de prod).
// Secuencia tacto_vaquillona + pesaje → 2 pasos. NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo
// dispara el leader:
//   pnpm exec playwright test e2e/captures/skip-animal-maniobra.capture.ts --config playwright.capture.config.ts

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

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', 'skip-por-paso');

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

/** Teclea un peso entero en el keypad de PesajeStep (dígito por dígito). */
async function typeWeight(page: Page, kg: string): Promise<void> {
  for (const d of kg) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

test('capturas saltear POR-PASO + animal secundario (carga rápida) @ 412px', async ({ browser }) => {
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
    const user = await createTestUser('cap-skip-paso');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Saltear', {
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

    // ── WIZARD etapa 2: tacto_vaquillona + pesaje (secuencia de 2 pasos). ──
    await page.goto('/maniobra/jornada');
    await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
    await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pool-row-tacto_vaquillona')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta antes de la carga rápida
    await page.getByTestId('pool-row-tacto_vaquillona').click();
    await page.getByTestId('pool-row-pesaje').click();
    await expect(page.getByTestId('selected-row-1')).toBeVisible();
    await page.getByRole('button', { name: /^Continuar/ }).click();
    await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();

    // Hero adaptativo (M2.1): con el mock conectable arranca en ConnectHero → conectamos → ScanHero.
    await connectMock(page);
    await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });

    // ── CARGA RÁPIDA: bastonazo → found → auto-avance al paso 1 (tacto_vaquillona, · 1 de 2). ──
    await bastonazo(page, eid);
    await expect(page.getByText('· 1 de 2', { exact: true })).toBeVisible({ timeout: 30_000 });
    // (01) Header con la PRIMARIA "Saltear aptitud" (pill) + la SECUNDARIA "⋯" (overflow saltar animal).
    await expect(page.getByTestId('skip-step')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Saltear aptitud', { exact: true })).toBeVisible();
    await expect(page.getByTestId('skip-animal')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '01-carga-skip-por-paso-header.png') });

    // ── (02) Saltear ESE paso (aptitud) → el frame avanza al SIGUIENTE paso del MISMO animal (pesaje · 2 de 2).
    //     El animal NO se abandonó — se saltó SOLO el paso. ──
    await page.getByTestId('skip-step').click();
    await expect(page.getByText('· 2 de 2', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('weight-display')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '02-siguiente-paso-mismo-animal.png') });

    // ── Cargar el pesaje (400) → resumen. ──
    await typeWeight(page, '400');
    await page.getByRole('button', { name: 'Confirmar peso' }).click();

    // ── (03) Resumen: la maniobra salteada muestra "Salteado" (corregible); el pesaje su valor. ──
    await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Salteado', { exact: true })).toBeVisible();
    await expect(page.getByText('400 kg', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '03-resumen-salteado.png') });

    // ── (04) SALTAR ANIMAL (SECUNDARIO): desde el "⋯" del resumen → SkipAnimalSheet con datos (terracota). ──
    await page.getByTestId('skip-animal').click();
    await expect(page.getByTestId('skip-animal-sheet')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Se descarta lo cargado/)).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '04-sheet-saltar-animal-secundario.png') });

    // ── (05) Confirmar el salteo del animal → descarta + vuelve al identify-first del PRÓXIMO animal. ──
    await page.getByTestId('skip-animal-confirm').click();
    await connectMock(page);
    await expect(page.getByTestId('skip-animal-sheet')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/bastón/)).toBeVisible({ timeout: 20_000 });
    // Saltar el animal NO lo cuenta: el progreso de la jornada sigue en "0 hoy".
    await expect(page.getByText('0 hoy', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '05-vuelta-identify.png') });
  } finally {
    await ctx.close();
  }
});
