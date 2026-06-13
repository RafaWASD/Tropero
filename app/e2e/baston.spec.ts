// e2e/baston.spec.ts — red de seguridad de la PUERTA BLE de BUSCAR ANIMAL (spec 09 chunk "BLE global").
//
// Monta el listener global (BleStickListenerProvider en la raíz) + el FindOrCreateOverlay → un bastonazo
// desde cualquier pantalla abre el overlay con el EID legible arriba y resuelve a editar / alta / transferir.
//
// Cómo se inyecta el bastonazo sin hardware: en E2E el provider de la raíz monta el MockAdapter (mode='mock',
// activado por la marca DELIBERADA `window.__RAFAQ_BLE_E2E__` que ponemos vía addInitScript ANTES del bundle).
// El BleE2EBridge publica `window.__rafaqBle.tagRead(eid)` / `connectMock()`. FUERA de producción: sin la
// marca, ni el mock ni el handle existen (Gate 2).
//
// Los 4 escenarios del Gate 0 §9:
//   (a) bastonazo a un animal EXISTENTE del campo → overlay edit → "Ver ficha" → ficha correcta.
//   (b) bastonazo a un EID NUEVO → overlay create → "Dar de alta" → /crear-animal con el TAG precargado read-only.
//   (c) bastonazo con un form CREATE abierto → NO abre overlay (busyMode).
//   (d) bastonazo a un animal en OTRO campo del usuario → overlay transfer → transferir online → ficha nueva.
//
// El lookup es LOCAL (PowerSync SQLite): el animal sembrado server-side debe BAJAR por la stream antes de
// bastonear → esperamos a verlo en la lista (proxy de "ya sincronizó"). Usuarios + campos namespaced; cleanup
// en afterAll + global-teardown.

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// ─── EIDs FDX-B válidos (15 díg, prefijo país/fabricante). Únicos por corrida para no chocar con el
//     unique GLOBAL de animals.tag_electronic (cada test genera el suyo). ───
let eidCounter = 0;
function makeEid(): string {
  // Prefijo 982 (fabricante, aceptado por isValidTag) + 12 díg derivados de un contador + timestamp.
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/** Arranca la app con la marca de E2E del bastón SETEADA antes del bundle → mode='mock' + handle en window. */
async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

/** Conecta el mock + inyecta un bastonazo del EID dado (el handle lo publica BleE2EBridge bajo el flag). */
async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no está disponible (¿se montó el BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/** Formato legible del EID en el header del overlay (espeja utils/eid-format: PPP NNNN NNNN NNNN). */
function eidReadable(eid: string): string {
  return `${eid.slice(0, 3)} ${eid.slice(3, 7)} ${eid.slice(7, 11)} ${eid.slice(11, 15)}`;
}

// (a) EID existente → overlay edit → "Ver ficha" → ficha correcta.
test('(a) bastonazo a un animal del campo → overlay editar → "Ver ficha" → ficha', async ({ page }) => {
  const user = await createTestUser('baston-edit');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Baston Edit');
  const eid = makeEid();
  const visual = `${RUN_TAG}-EDIT`;
  await seedAnimal(establishmentId, rodeoId, { tag: eid, visualAlt: visual, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Esperamos a que el animal BAJE por la stream (visible en la lista = ya sincronizó al SQLite local).
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Bastonazo → overlay con el EID legible arriba + card del animal + "Ver ficha".
  await bastonazo(page, eid);
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();
  const verFicha = page.getByRole('button', { name: 'Ver ficha', exact: true });
  await expect(verFicha).toBeVisible({ timeout: 15_000 });
  await verFicha.click();

  // Aterriza en la ficha del animal bastoneado (bloque "Identificación" visible). El visual sembrado está
  // en el hero (DOM): lo verificamos por presencia (≥1), no por visibilidad estricta (el hero lo trunca con
  // overflow:hidden → react-native-web lo reporta "hidden" aunque sea el animal correcto).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(visual, { exact: true })).not.toHaveCount(0);
});

// (b) EID nuevo → overlay create → "Dar de alta" → /crear-animal con el TAG precargado read-only.
test('(b) bastonazo a un EID nuevo → overlay alta → "Dar de alta" → crear-animal con el TAG precargado', async ({ page }) => {
  const user = await createTestUser('baston-create');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baston Create');
  const eid = makeEid();

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Un EID que no existe en ningún campo → create. (Bastoneamos desde la home; el listener es global.)
  await bastonazo(page, eid);
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible();
  const darAlta = page.getByRole('button', { name: 'Dar de alta', exact: true });
  await expect(darAlta).toBeVisible();
  await darAlta.click();

  // Aterriza en el wizard de alta con el TAG precargado: el header "Creando: [TAG]" muestra el EID crudo
  // (read-only — el operario no re-tipea lo que ya leyó el bastón, RB6.3). Esa es la prueba del precargado.
  await expect(page.getByText(`Creando: ${eid}`, { exact: true })).toBeVisible({ timeout: 20_000 });
});

// (c) bastonazo con un form CREATE abierto → NO abre overlay (busyMode anti-stacking).
test('(c) bastonazo con un form de alta abierto → NO abre el overlay (busyMode)', async ({ page }) => {
  const user = await createTestUser('baston-busy');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Baston Busy');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Abrimos el form de alta (crear-animal) → useBusyWhileMounted suspende el listener.
  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Bastonazo con el form abierto → el MockAdapter NO propaga (listening=false por busyMode) → NO overlay.
  await bastonazo(page, makeEid());
  // Damos tiempo a que un overlay erróneo aparecería; verificamos que NO está.
  await page.waitForTimeout(1500);
  await expect(page.getByText('Caravana leída', { exact: true })).toHaveCount(0);
  // El form de alta sigue en pantalla (no se apiló nada encima).
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible();
});

// (d) EID de un animal en OTRO campo del usuario → overlay transfer → transferir online → ficha nueva.
test('(d) bastonazo a un animal en OTRO campo → overlay transferir → transferir online → ficha nueva', async ({ page }) => {
  const user = await createTestUser('baston-transfer');
  await setUserPhone(user.id, '1123456789');
  // Campo ACTIVO (destino) + 2º campo (origen, donde vive el animal). El usuario es owner de ambos →
  // ambos sincronizan al SQLite local. El landing con 2 campos es 'choosing'; fijamos el destino activo.
  const dest = await seedEstablishmentWithRodeo(user.id, 'Campo Destino');
  const origin = await seedEstablishmentWithRodeo(user.id, 'Campo Origen');
  const eid = makeEid();
  await seedAnimal(origin.establishmentId, origin.rodeoId, { tag: eid, visualAlt: `${RUN_TAG}-TR`, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);

  // Con 2 campos el usuario aterriza en "Mis campos" → elegimos el campo DESTINO como activo.
  const destCard = page.getByRole('button', { name: new RegExp('Campo Destino') }).first();
  await expect(destCard).toBeVisible({ timeout: 30_000 });
  await destCard.click();
  await waitForHome(page);

  // Esperamos a que el set (incluido el animal del 2º campo) baje al SQLite local: lo verificamos
  // navegando a Animales del campo activo (vacío) y dando margen al first-sync de ambos campos.
  await gotoAnimales(page);
  await page.waitForTimeout(4000);

  // Bastonazo del EID que vive en el OTRO campo → overlay transfer.
  await bastonazo(page, eid);
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Está en otro campo', { exact: true })).toBeVisible({ timeout: 15_000 });
  const transferir = page.getByRole('button', { name: /^Transferir a / });
  await expect(transferir).toBeVisible();
  await expect(transferir).toBeEnabled(); // online en E2E → CTA habilitado (RB7.3)
  await transferir.click();

  // Transfer online → aterriza en la ficha del perfil NUEVO en el campo activo (bloque "Identificación").
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 30_000 });
});
