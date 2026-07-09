// e2e/maniobra-lote.spec.ts — LOTE opcional/manual desde el wizard de maniobra (spec 03 R9.1/R9.2/R9.3).
//
// El lote (management_group, ADR-020) es el TERCER eje del animal: per-animal, MANUAL, NUNCA auto-asignado
// por la sesión (R9.1 — una jornada puede tocar 2 lotes). El resumen del animal ofrece una afordancia
// "Lote (opcional)" que abre un sheet para elegir/cambiar/quitar el lote.
//
// Caso 1 (R9.2): identificar → resumen → abrir el sheet de lote → elegir un grupo → el display del lote en
// el resumen cambia al grupo elegido → confirmar → ORÁCULO SERVER: animal_profiles.management_group_id ==
// el grupo elegido (tras sync). + offline-first: la asignación funciona sin red, sube al reconectar.
//
// Caso 2 (R9.1/R9.3): correr una maniobra SIN tocar el lote → el management_group_id queda IGUAL (sin
// cambio) — el sistema NO auto-asigna lote desde la sesión.
//
// Cómo se llega: jornada SOLO PESAJE (rodeo de cría → peso habilitado) → /maniobra/identificar; bastonazo
// (MockAdapter bajo __RAFAQ_BLE_E2E__) a un animal del campo → auto-avance a /maniobra/carga.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedManagementGroup,
  setUserPhone,
  RUN_TAG,
  waitForServerProfileManagementGroup,
  waitForServerWeightEventWithSession,
  readServerProfileManagementGroup,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'design', 'maniobra-carga');

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

/** Arranca una jornada SOLO PESAJE (rodeo de cría → peso habilitado) y aterriza en la identificación. */
async function startSessionPesaje(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-pesaje')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta antes de la carga rápida
  await page.getByTestId('pool-row-pesaje').click();
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

/** Teclea un peso entero en el keypad de PesajeStep (dígito por dígito). */
async function typeWeight(page: Page, kg: string): Promise<void> {
  for (const d of kg) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

// ── Caso 1 (R9.2): asignar un lote desde el resumen → el display cambia → persiste en el server (offline). ──
test('lote opcional: elegir un lote desde el resumen lo asigna al animal (R9.2, offline)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('r9-assign');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Lote R9');
  // Un lote ACTIVO del campo. rawName:true → nombre LIMPIO sin el prefijo RUN_TAG (que, yendo primero,
  // empujaría el nombre real fuera del recorte de una línea del sheet/resumen). Con descendentes a propósito:
  // "Engorde primavera" (g/p) → la captura sirve para vetar recorte de g/p/q/y/j en el sheet de lote.
  const grupo = await seedManagementGroup(establishmentId, 'Engorde primavera', { rawName: true });
  const eid = makeEid();
  const visual = `${RUN_TAG}-L`;
  // Animal SIN lote (management_group_id null) → el resumen muestra "Sin lote" hasta que se asigne.
  const profileId = await seedAnimal(establishmentId, rodeoId, { tag: eid, idv: visual, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionPesaje(page);

  // CORTAMOS LA RED: la asignación de lote (UPDATE local) debe funcionar OFFLINE (CLAUDE.md ppio 3).
  await page.context().setOffline(true);

  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Pesaje 405 → resumen.
  await typeWeight(page, '405');
  await page.getByRole('button', { name: 'Confirmar peso' }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });

  // El resumen muestra la afordancia de lote con "Sin lote" (el animal aún no tiene lote, R9.3).
  const loteRow = page.getByTestId('summary-lote-row');
  await expect(loteRow).toBeVisible();
  await expect(loteRow.getByText('Lote (opcional)', { exact: true })).toBeVisible();
  await expect(loteRow.getByText('Sin lote', { exact: true })).toBeVisible();

  // Abrir el sheet de lote → elegir el grupo → el sheet cierra y el display del resumen cambia al grupo.
  await loteRow.click();
  await expect(page.getByTestId('lote-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('lote-option-none')).toBeVisible(); // "Sin lote" primero
  await page.getByTestId(`lote-option-${grupo.id}`).click();
  await expect(page.getByTestId('lote-sheet')).toHaveCount(0, { timeout: 10_000 });
  // El display de la afordancia ahora muestra el grupo elegido (R9.2).
  await expect(loteRow.getByText(grupo.name, { exact: true })).toBeVisible();
  await expect(loteRow.getByText('Sin lote', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT_DIR, 'resumen-lote.png') });

  // QUITAR el lote (R9.3): reabrir el sheet → "Sin lote" (null) → el display vuelve a "Sin lote".
  await loteRow.click();
  await expect(page.getByTestId('lote-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('lote-option-none').click();
  await expect(page.getByTestId('lote-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(loteRow.getByText('Sin lote', { exact: true })).toBeVisible();
  await expect(loteRow.getByText(grupo.name, { exact: true })).toHaveCount(0);

  // Volver a asignar el grupo (el estado final esperado por el oráculo server) → display = grupo.
  await loteRow.click();
  await page.getByTestId(`lote-option-${grupo.id}`).click();
  await expect(loteRow.getByText(grupo.name, { exact: true })).toBeVisible();

  // CAPTURA design-veto: reabrir el sheet (el animal ya tiene el grupo asignado) → muestra "Sin lote"
  // primero (sin check) + los grupos del campo con el seleccionado marcado (borde primary + check). Se
  // cierra con "Cancelar" para NO alterar el estado final que el oráculo server verifica abajo.
  await loteRow.click();
  await expect(page.getByTestId('lote-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('lote-option-none')).toBeVisible();
  await expect(page.getByTestId(`lote-option-${grupo.id}`)).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'resumen-lote-sheet.png') });
  await page.getByTestId('lote-sheet-cancelar').click();
  await expect(page.getByTestId('lote-sheet')).toHaveCount(0, { timeout: 10_000 });
  // Tras cancelar, el display sigue mostrando el grupo (no se tocó el estado).
  await expect(loteRow.getByText(grupo.name, { exact: true })).toBeVisible();

  // Confirmar el animal → el peso + el lote suben por la upload queue al reconectar.
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // RECONEXIÓN → ORÁCULO SERVER (R9.2): el management_group_id del perfil quedó en el grupo elegido (el
  // estado final tras asignar → quitar → re-asignar; las 3 escrituras subieron, LWW deja el último).
  await page.context().setOffline(false);
  await waitForServerWeightEventWithSession(establishmentId, 405, { tries: 40 });
  await waitForServerProfileManagementGroup(profileId, grupo.id, { tries: 40 });
});

// ── Caso 2 (R9.1/R9.3): correr una maniobra SIN tocar el lote → el management_group_id NO cambia. ──
test('lote NO auto-asignado: una maniobra sin tocar el lote deja el management_group_id igual (R9.1/R9.3)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('r9-noauto');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo NoAuto R9');
  // El animal NACE sembrado en un lote (management_group_id = grupo). Si la sesión auto-asignara, lo pisaría.
  const grupo = await seedManagementGroup(establishmentId, 'Recría');
  const eid = makeEid();
  const visual = `${RUN_TAG}-N`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { tag: eid, idv: visual, sex: 'female' });
  // Asignarlo al lote vía service_role (estado de partida: ya tiene lote).
  {
    const { error } = await admin
      .from('animal_profiles')
      .update({ management_group_id: grupo.id })
      .eq('id', profileId);
    if (error) throw new Error(`seed assign lote: ${error.message}`);
  }
  // Sanity del estado de partida.
  expect(await readServerProfileManagementGroup(profileId)).toBe(grupo.id);

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionPesaje(page);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Cargar el pesaje y confirmar SIN tocar nunca la afordancia de lote.
  await typeWeight(page, '410');
  await page.getByRole('button', { name: 'Confirmar peso' }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  // El resumen muestra el lote ACTUAL (el sembrado), no "Sin lote" ni otro — pero NO lo tocamos.
  await expect(page.getByTestId('summary-lote-row').getByText(grupo.name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // El peso subió con session_id (prueba que la maniobra REALMENTE corrió y sincronizó)...
  await waitForServerWeightEventWithSession(establishmentId, 410, { tries: 40 });
  // ...y el management_group_id quedó EXACTAMENTE igual (R9.1: la sesión no auto-asignó nada).
  expect(await readServerProfileManagementGroup(profileId)).toBe(grupo.id);
});
