// e2e/parto-bastoneo.spec.ts — red de seguridad del BASTONEO de la caravana electrónica en el PARTO, POR
// TERNERO (delta bastoneo-captura-alta-parto, RCF.6 generalizado a modo CAPTURA). Cada CalfRow captura el EID
// leído a su `tagRaw` (el ternero NO existe todavía) → viaja a registerBirth({ calves:[{ tag }] }). MELLIZOS:
// cada ternero su afordancia independiente, UN solo sheet a la vez (scanCalfLocalId).
//
// El punto CRÍTICO (RCF.6): el form de parto suspende el listener global (useBusyWhileMounted); el sheet toma
// la propiedad EXCLUSIVA del bastón → la lectura entra al sheet y el FindOrCreateOverlay global NO se abre.
//
// Inyección sin hardware: __RAFAQ_BLE_E2E__ (MockAdapter) + window.__rafaqBle.connectMock/tagRead.
//
// Oráculos:
//   - "capturado en ESE ternero" → CapturedTagRow por índice (testID tag-captured-<i>) con el EID legible.
//   - "el parto persistió con las caravanas" → server-side: waitForServerBirth (1 evento + N terneros) +
//     waitForServerCalfTags (animals.tag_electronic de los terneros vía birth_calves).

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  waitForServerBirth,
  waitForServerCalfTags,
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

function eidReadable(eid: string): string {
  return `${eid.slice(0, 3)} ${eid.slice(3, 7)} ${eid.slice(7, 11)} ${eid.slice(11, 15)}`;
}

async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e: string) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no está disponible (¿se montó el BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/** Abre la ficha de la madre + el form de Parto (paso 2, con "Ternero 1"). */
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

/** Bastonea la caravana de un ternero (por índice de CalfBlock) → confirmación → capturado read-only. */
async function bastoneaTernero(page: Page, index: number, eid: string): Promise<void> {
  await page.getByTestId(`tag-scan-open-${index}`).click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await bastonazo(page, eid);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId(`tag-captured-${index}`)).toBeVisible({ timeout: 10_000 });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (a) PARTO 1 TERNERO → bastonear su caravana → capturado + overlay global NO abierto → guardar → el ternero
//     creado por register_birth tiene esa tag_electronic (RCF.6 en modo captura, POR ternero).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a) RCF.6 captura parto: 1 ternero → bastonear → capturado + overlay NO se abre → register_birth con esa caravana', async ({ page }) => {
  const user = await createTestUser('partoscan');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo PartoScan');
  const motherIdv = `6001${Date.now().toString().slice(-6)}`;
  const motherProfileId = await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await openParto(page, motherIdv);

  // Sexo del ternero (requerido).
  await page.getByRole('button', { name: 'Macho', exact: true }).first().click();

  // El campo electrónico tipeable suelto YA NO existe: solo el CTA por ternero.
  await expect(page.getByLabel('Caravana electrónica (opcional, 15 dígitos)', { exact: true })).toHaveCount(0);
  await page.getByTestId('tag-scan-open-0').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });

  const eid = makeEid();
  await bastonazo(page, eid);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Usar caravana', exact: true })).toBeVisible();

  // ORÁCULO CRÍTICO (RCF.6): el FindOrCreateOverlay global NO se abrió.
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);

  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-captured-0')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();

  // Guardar (madre sembrada NO preñada → aviso suave window.confirm → aceptar).
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // ORÁCULO SERVER: 1 evento birth + 1 ternero, y ese ternero tiene la caravana bastoneada.
  await waitForServerBirth(motherProfileId, { expectedCalves: 1 });
  await waitForServerCalfTags(motherProfileId, [eid]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (b) MELLIZOS → cada ternero su CTA independiente → dos caravanas DISTINTAS capturadas (una por ternero) →
//     guardar → los 2 terneros creados tienen SUS respectivas caravanas (RCF.6, por ternero, UN sheet a la vez).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(b) RCF.6 captura parto: mellizos → cada ternero su caravana distinta → register_birth con ambas', async ({ page }) => {
  const user = await createTestUser('partomell');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo PartoMell');
  const motherIdv = `6101${Date.now().toString().slice(-6)}`;
  const motherProfileId = await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await openParto(page, motherIdv);

  // Agregar un 2º ternero (mellizos).
  await page.getByRole('button', { name: 'Agregar otro ternero', exact: true }).click();
  await expect(page.getByText('Ternero 2', { exact: true })).toBeVisible();

  // Sexo de cada ternero (hay 2 de cada botón → por orden con .nth()).
  await page.getByRole('button', { name: 'Macho', exact: true }).first().click();
  await page.getByRole('button', { name: 'Hembra', exact: true }).nth(1).click();

  // Bastonear cada ternero su caravana (UN sheet a la vez; el testID por índice enruta la captura).
  const eid0 = makeEid();
  const eid1 = makeEid();
  await bastoneaTernero(page, 0, eid0);
  await bastoneaTernero(page, 1, eid1);

  // Cada ternero muestra SU caravana (distintas).
  await expect(page.getByText(eidReadable(eid0), { exact: true })).toBeVisible();
  await expect(page.getByText(eidReadable(eid1), { exact: true })).toBeVisible();
  expect(eid0).not.toBe(eid1);

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // ORÁCULO SERVER: 1 evento birth + 2 terneros, cada uno con su caravana bastoneada.
  await waitForServerBirth(motherProfileId, { expectedCalves: 2 });
  await waitForServerCalfTags(motherProfileId, [eid0, eid1]);
});
