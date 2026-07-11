// e2e/maniobra-vacias-lote.spec.ts — SUGERENCIA POST-TACTO de las VACÍAS (delta lotes-venta, RLV.10–RLV.14).
//
// Al terminar una jornada con TACTO que diagnosticó ≥1 vacía, el ExitJornadaSheet (fase 'terminated') sugiere
// agregarlas a un lote (saltable). Casos:
//   (1) CREAR "Descarte": Elegir lote → Crear lote nuevo (default "Descarte") → Crear y agregar → la vaca
//       queda en el lote nuevo (oráculo server: management_group_id apunta a un lote llamado "Descarte").
//   (2) ELEGIR EXISTENTE: Elegir lote → tap un lote sembrado → la vaca queda en ese lote (RLV.12).
//   (3) "AHORA NO" (saltar, RLV.11): la sugerencia se salta → sale del flujo → la vaca sigue SIN lote.
//
// Reusa el bastón mock (__RAFAQ_BLE_E2E__) y el flujo de tacto real (jornada con tacto → VACÍA → confirmar).
// El animal se siembra SERVIDO (seedReproductiveServiceEvent) para que el tacto de PREÑEZ aplique. Rodeo de
// 1 mes de servicio → VACÍA va directo al resumen (sin sub-paso de tamaño). Importa `test` de
// './helpers/fixtures' (NO de '@playwright/test' — el shim de env con PowerSync).

import { test, expect, type Page } from './helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedReproductiveServiceEvent,
  seedManagementGroup,
  setUserPhone,
  waitForServerProfileManagementGroup,
  readServerProfileManagementGroup,
  RUN_TAG,
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

/** Arranca una jornada de manga con TACTO (habilitado en cría) y aterriza en la identificación. */
async function startSessionTacto(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-tacto')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta antes de la carga rápida
  await page.getByTestId('pool-row-tacto').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Bastonea un animal, lo diagnostica VACÍA y confirma → vuelve a "Acercá el bastón" (animalCount=1). */
async function tactoVacia(page: Page, eid: string): Promise<void> {
  await bastonazo(page, eid);
  await expect(page.getByRole('button', { name: 'VACÍA', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'VACÍA', exact: true }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Abre el ExitJornadaSheet (‹) → Terminar jornada → llega a la sugerencia de vacías (RLV.10). */
async function terminarConSugerencia(page: Page, count: number): Promise<void> {
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Terminar jornada', exact: true }).click();
  await expect(page.getByText('Jornada terminada', { exact: true })).toBeVisible({ timeout: 10_000 });
  // La sugerencia aparece con el conteo (RLV.10.2).
  await expect(page.getByTestId('sugerencia-vacias')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(new RegExp(`Encontramos\\s*${count}\\s*(vaca vacía|vacías)`))).toBeVisible();
}

// ── (1) CREAR "Descarte": la vaca vacía queda en un lote nuevo llamado "Descarte" (RLV.13/RLV.14). ──
test('vacías post-tacto → crear lote "Descarte" → la vaca queda en el lote nuevo (RLV.13/RLV.14)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('vac-crear');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Vacías Crear', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    serviceMonths: [10],
  });
  const eid = makeEid();
  const idv = `${RUN_TAG}-VC`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { tag: eid, idv, sex: 'female', categoryCode: 'vaca' });
  await seedReproductiveServiceEvent(profileId);

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

  await startSessionTacto(page);
  await tactoVacia(page, eid);
  await terminarConSugerencia(page, 1);

  // Elegir lote → Crear lote nuevo → nombre default "Descarte" → Crear y agregar.
  await page.getByRole('button', { name: 'Elegir lote', exact: true }).click();
  await expect(page.getByTestId('sugerencia-vacias-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('sugerencia-vacias-crear-nuevo').click();
  await expect(page.getByTestId('sugerencia-vacias-nombre')).toHaveValue('Descarte');
  await page.getByTestId('sugerencia-vacias-crear').click();

  // Sale del flujo → home. La vaca quedó en un lote llamado "Descarte" (oráculo server).
  await waitForHome(page);
  const groupId = await waitForAnimalInLoteNamed(profileId, 'Descarte');
  expect(groupId).toBeTruthy();
});

// ── (2) ELEGIR EXISTENTE: la vaca vacía queda en un lote ya sembrado (RLV.12/RLV.14). ──
test('vacías post-tacto → elegir un lote existente → la vaca queda en ese lote (RLV.12/RLV.14)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('vac-elegir');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Vacías Elegir', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    serviceMonths: [10],
  });
  const grupo = await seedManagementGroup(establishmentId, 'Descarte otoño', { rawName: true });
  const eid = makeEid();
  const idv = `${RUN_TAG}-VE`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { tag: eid, idv, sex: 'female', categoryCode: 'vaca' });
  await seedReproductiveServiceEvent(profileId);

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

  await startSessionTacto(page);
  await tactoVacia(page, eid);
  await terminarConSugerencia(page, 1);

  // Elegir lote → tap el lote existente.
  await page.getByRole('button', { name: 'Elegir lote', exact: true }).click();
  await expect(page.getByTestId('sugerencia-vacias-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(`sugerencia-lote-${grupo.id}`).click();

  await waitForHome(page);
  await waitForServerProfileManagementGroup(profileId, grupo.id, { tries: 40 });
});

// ── (3) "AHORA NO" (saltar, RLV.11): la vaca sigue SIN lote. ──
test('vacías post-tacto → "Ahora no" → sale del flujo y la vaca sigue sin lote (RLV.11)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('vac-skip');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Vacías Skip', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    serviceMonths: [10],
  });
  const eid = makeEid();
  const idv = `${RUN_TAG}-VS`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { tag: eid, idv, sex: 'female', categoryCode: 'vaca' });
  await seedReproductiveServiceEvent(profileId);

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 45_000 });

  await startSessionTacto(page);
  await tactoVacia(page, eid);
  await terminarConSugerencia(page, 1);

  // "Ahora no" → salta la sugerencia (RLV.11) → sale del flujo (home) sin agregar a ningún lote.
  await page.getByTestId('sugerencia-vacias-ahora-no').click();
  await waitForHome(page);

  // La vaca sigue SIN lote (no se asignó nada).
  expect(await readServerProfileManagementGroup(profileId)).toBeNull();
});

/**
 * ORÁCULO del CREAR "Descarte": pollea hasta que el `management_group_id` del perfil sea no-null Y su lote
 * se llame `name` (el lote se crea con un id de cliente que el test no conoce a priori → se resuelve por
 * el nombre). Devuelve el group id.
 */
async function waitForAnimalInLoteNamed(
  profileId: string,
  name: string,
  tries = 40,
): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const gid = await readServerProfileManagementGroup(profileId);
    if (gid) {
      const { data } = await admin.from('management_groups').select('name').eq('id', gid).maybeSingle();
      if ((data?.name as string | undefined) === name) return gid;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`waitForAnimalInLoteNamed(${profileId}, "${name}"): la vaca nunca quedó en un lote con ese nombre.`);
}
