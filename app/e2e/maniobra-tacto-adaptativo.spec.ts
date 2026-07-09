// e2e/maniobra-tacto-adaptativo.spec.ts — TACTO ADAPTATIVO por los meses de servicio del rodeo (spec 03
// Stream B / B2 — CABLEADO de RPSC.4/RPSC.5). Diseño ya APROBADO por Raf (spike); esto verifica la PLOMERÍA
// end-to-end: el flujo real de jornada deriva los botones de TAMAÑO del `service_months` del rodeo y el
// override "¿medir tamaño?" del config de la tanda, y persiste/resume acorde.
//
// Casos:
//   (1) Rodeo de 2 MESES de servicio → al marcar PREÑADA aparecen CABEZA y COLA (sin CUERPO, RPSC.5.3).
//       Tap CABEZA → resumen "Preñada · Cabeza" + el tacto llega al server como `large` (mapeo 1:1, RPSC.5.6).
//   (2) Rodeo de 1 MES de servicio → al marcar PREÑADA NO hay sub-paso de tamaño (RPSC.5.2): va DIRECTO al
//       resumen, que dice solo "Preñada" (DD-PSC-8) y el server recibe `large` por convención (DD-PSC-2).
//   (3) OVERRIDE: rodeo de 3 meses (default = medir SÍ) pero el operario pone "¿medir tamaño? = NO" en el
//       config de la tanda → PREÑADA va directo + resumen "Preñada" (el override invierte, RPSC.4.3).
//
// Web TÁCTIL 360/412 (memoria reference_rn_web_pitfalls: vetar manga en web táctil real). Importa `test` de
// './helpers/fixtures' (NO de '@playwright/test' — el shim de env; gotcha que mordió en B1).

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
  waitForServerTactoWithSession,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/** Arranca la app con la marca de E2E del bastón (mock) seteada antes del bundle. */
async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/**
 * Anti-recorte de descendentes (memoria feedback_descender_clipping: la ñ de "PREÑADA" se corta si el
 * lineHeight no matchea el fontSize). Mide scrollHeight vs clientHeight del nodo de texto exacto: si el
 * contenido desborda la caja por abajo, el descendente se recorta. Tolerancia 1px (sub-pixel de rn-web).
 */
async function assertTextNotClipped(page: Page, text: string): Promise<void> {
  const clipped = await page.evaluate((frag) => {
    const nodes = Array.from(document.querySelectorAll('div, span'));
    for (const el of nodes) {
      const e = el as HTMLElement;
      if (e.children.length === 0 && (e.textContent || '').trim() === frag) {
        if (e.scrollHeight > e.clientHeight + 1) return { clipped: true, scrollH: e.scrollHeight, clientH: e.clientHeight };
      }
    }
    return { clipped: false };
  }, text);
  expect(clipped.clipped, `"${text}" se recorta (scrollH ${clipped.scrollH} > clientH ${clipped.clientH})`).toBe(false);
}

/**
 * Arranca una jornada de manga con TACTO (habilitada en cría) y aterriza en la identificación. Si
 * `setMeasureSize` viene definido, ANTES de continuar abre el config "¿medir tamaño?" del tacto y lo fija
 * (true=Sí / false=No) → ejercita el override del config (RPSC.4.3).
 */
async function startSessionTacto(page: Page, setMeasureSize?: boolean): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-tacto')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000); // dwell: el rodeo_data_config + service_months se asientan antes de la carga
  await page.getByTestId('pool-row-tacto').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();

  if (setMeasureSize !== undefined) {
    // Tocar el CUERPO de la fila del tacto → abre el config "¿medir tamaño?". Fijar la opción + Guardar.
    await page.getByTestId('selected-body-0').click();
    await expect(page.getByTestId('tacto-config-sheet')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(setMeasureSize ? 'tacto-config-yes' : 'tacto-config-no').click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByTestId('tacto-config-sheet')).toHaveCount(0, { timeout: 10_000 });
    // La 2da línea inline refleja la elección.
    await expect(page.getByText(`Medí tamaño: ${setMeasureSize ? 'Sí' : 'No'}`, { exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Hero adaptativo (M2.1): con el mock conectable arranca ConnectHero → conectamos → ScanHero.
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── (1) Rodeo de 2 meses → PREÑADA ofrece CABEZA y COLA (sin CUERPO); CABEZA → resumen "· Cabeza" + server large ──
test('(1) rodeo de 2 meses de servicio → tacto preñada ofrece CABEZA y COLA (sin CUERPO); CABEZA persiste large', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('tadap-2m');
  await setUserPhone(user.id, '1123456789');
  // Rodeo con 2 meses de servicio (octubre, noviembre) → la regla CCL da cabeza/cola, sin cuerpo (RPSC.5.3).
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Tacto 2m', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    serviceMonths: [10, 11],
  });
  const eid = makeEid();
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    idv: `${RUN_TAG}-2M`,
    sex: 'female',
    categoryCode: 'vaquillona',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(`${RUN_TAG}-2M`, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

  await startSessionTacto(page);
  await bastonazo(page, eid);

  // Sub-paso binario (RPSC.5.1) → tap PREÑADA.
  await expect(page.getByRole('button', { name: 'PREÑADA', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'PREÑADA', exact: true }).click();

  // Sub-paso de TAMAÑO: 2 meses → CABEZA y COLA, SIN CUERPO (RPSC.5.3).
  await expect(page.getByRole('button', { name: 'CABEZA', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'COLA', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CUERPO', exact: true })).toHaveCount(0);

  // CABEZA → resumen "Preñada · Cabeza" (mapeo 1:1, RPSC.5.6) + server large.
  await page.getByRole('button', { name: 'CABEZA', exact: true }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Preñada · Cabeza', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  await waitForServerTactoWithSession(profileId, 'large');
});

// ── (1b) WEB TÁCTIL 360: el mismo flujo de 2 meses con touch real + anti-recorte de "PREÑADA" (ñ) y de los
//    bloques de tamaño (memoria reference_rn_web_pitfalls: el mouse sintético de Desktop ENMASCARA el touch;
//    feedback_descender_clipping: la ñ se recorta sin lineHeight matching). El test.use va DENTRO del describe
//    para no afectar a los demás (que corren en 412). Mismo patrón que la edición de B1. ──
test.describe('tacto adaptativo (web táctil 360)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 800 } });

  test('(1b) rodeo de 2 meses en 360 táctil → CABEZA/COLA sin recorte; tap CABEZA persiste large', async ({ page }) => {
    test.setTimeout(150_000);
    const user = await createTestUser('tadap-360');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Tacto 360', {
      rodeoName: 'Cría hembras',
      rodeoRawName: true,
      serviceMonths: [10, 11],
    });
    const eid = makeEid();
    const profileId = await seedAnimal(establishmentId, rodeoId, {
      tag: eid,
      idv: `${RUN_TAG}-360`,
      sex: 'female',
      categoryCode: 'vaquillona',
    });

    await gotoWithBle(page);
    await signIn(page, user);
    await waitForHome(page);
    await gotoAnimales(page);
    await expect(page.getByText(`${RUN_TAG}-360`, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

    await startSessionTacto(page);
    await bastonazo(page, eid);

    // PREÑADA (táctil) — y anti-recorte del label con ñ.
    const prenada = page.getByRole('button', { name: 'PREÑADA', exact: true });
    await expect(prenada).toBeVisible({ timeout: 30_000 });
    await assertTextNotClipped(page, 'PREÑADA');
    await prenada.tap();

    // 2 meses → CABEZA y COLA (sin CUERPO), ambos legibles sin recorte.
    const cabeza = page.getByRole('button', { name: 'CABEZA', exact: true });
    await expect(cabeza).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'COLA', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'CUERPO', exact: true })).toHaveCount(0);
    await assertTextNotClipped(page, 'CABEZA');
    await cabeza.tap();

    await expect(page.getByText('Preñada · Cabeza', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).tap();
    await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

    await waitForServerTactoWithSession(profileId, 'large');
  });
});

// ── (2) Rodeo de 1 mes → PREÑADA va DIRECTO (sin sub-paso de tamaño); resumen "Preñada"; server large ──
test('(2) rodeo de 1 mes de servicio → PREÑADA sin sub-paso de tamaño; resumen "Preñada"; persiste large (DD-PSC-2)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('tadap-1m');
  await setUserPhone(user.id, '1123456789');
  // 1 mes de servicio → sin distinción de tamaño (RPSC.5.2): preñada/vacía, preñada persiste large (DD-PSC-2).
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Tacto 1m', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    serviceMonths: [10],
  });
  const eid = makeEid();
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    idv: `${RUN_TAG}-1M`,
    sex: 'female',
    categoryCode: 'vaquillona',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(`${RUN_TAG}-1M`, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

  await startSessionTacto(page);
  await bastonazo(page, eid);

  // PREÑADA → NO aparece sub-paso de tamaño (sin CABEZA/CUERPO/COLA): va directo al resumen.
  await expect(page.getByRole('button', { name: 'PREÑADA', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'PREÑADA', exact: true }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'CABEZA', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'COLA', exact: true })).toHaveCount(0);
  // DD-PSC-8: el resumen muestra solo "Preñada" (sin "· Cabeza"), aunque persista large.
  await expect(page.getByText('Preñada', { exact: true })).toBeVisible();
  await expect(page.getByText('Preñada · Cabeza', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Server: la preñez sin tamaño persiste como large (DD-PSC-2), positivo para la categoría.
  await waitForServerTactoWithSession(profileId, 'large');
});

// ── (3) OVERRIDE: rodeo de 3 meses (default medir SÍ) + "¿medir tamaño?=NO" → PREÑADA directo + "Preñada" ──
test('(3) override "no medir" sobre un rodeo de 3 meses → PREÑADA va directo; resumen "Preñada" (RPSC.4.3)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('tadap-ovr');
  await setUserPhone(user.id, '1123456789');
  // 3 meses → el default sería medir SÍ (cabeza/cuerpo/cola); el override del config lo invierte a NO.
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Tacto Ovr', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    serviceMonths: [10, 11, 12],
  });
  const eid = makeEid();
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    idv: `${RUN_TAG}-OVR`,
    sex: 'female',
    categoryCode: 'vaquillona',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(`${RUN_TAG}-OVR`, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

  // En el wizard, fijar "¿medir tamaño? = NO" antes de arrancar (override del default Sí de un rodeo de 3m).
  await startSessionTacto(page, false);
  await bastonazo(page, eid);

  // PREÑADA → DIRECTO al resumen (el override NO mide tamaño), aunque el rodeo de 3 meses lo admitiría.
  await expect(page.getByRole('button', { name: 'PREÑADA', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'PREÑADA', exact: true }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'CUERPO', exact: true })).toHaveCount(0);
  await expect(page.getByText('Preñada', { exact: true })).toBeVisible();
  await expect(page.getByText('Preñada · Cabeza', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  await waitForServerTactoWithSession(profileId, 'large');
});
