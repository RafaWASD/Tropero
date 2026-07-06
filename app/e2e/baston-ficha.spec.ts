// e2e/baston-ficha.spec.ts — red de seguridad del BASTONEO desde la FICHA del animal (delta caravana-ficha
// bastoneo, RCF.6). Distinto de baston.spec.ts (la PUERTA BLE global de BUSCAR ANIMAL): acá el bastoneo es
// ACOTADO a ESTE animal (el de la ficha) — lee el EID y lo ASIGNA a este perfil, sin find-or-create, sin
// picker. El punto CRÍTICO: la ficha suspende el listener global (busyMode); el sheet de scan toma la
// propiedad EXCLUSIVA del bastón → la lectura entra al sheet y el FindOrCreateOverlay global NO se abre.
//
// Inyección sin hardware: mismo mecanismo que baston.spec.ts — el provider de la raíz monta el MockAdapter
// bajo la marca `__RAFAQ_BLE_E2E__` (addInitScript antes del bundle); `window.__rafaqBle.tagRead/connectMock`
// lo publica el BleE2EBridge. La marca SECUNDARIA `__RAFAQ_BLE_E2E_MANUAL__` fuerza el modo SIN transporte
// (manual-promovido) para el test de degradación.
//
// Oráculos:
//   - "el overlay global NO se abrió" → AUSENCIA del testID EXCLUSIVO `find-or-create-overlay` (NO ausencia de
//     texto: la ficha de fondo sigue montada y podría tener textos del overlay — memoria del proyecto).
//   - "el assign persistió" → server-side (service_role): waitForServerTagAssigned (outbox → RPC → animals →
//     propagación 0079), NO la ficha (lectura local no-reactiva, staleness documentada).

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  waitForServerTagAssigned,
  RUN_TAG,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// EIDs FDX-B válidos (15 díg, prefijo fabricante 982), únicos por corrida (unique global de tag_electronic).
let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/** Formato legible del EID (espeja utils/eid-format: PPP NNNN NNNN NNNN). */
function eidReadable(eid: string): string {
  return `${eid.slice(0, 3)} ${eid.slice(3, 7)} ${eid.slice(7, 11)} ${eid.slice(11, 15)}`;
}

/** Arranca la app con el mock del bastón (mode='mock' + handle en window). */
async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

/** Arranca la app en modo SIN transporte (manual-promovido): el hero del sheet cae a "El bastón no está
 *  disponible en este dispositivo" (transport==null). NO hay handle (el mock no se monta en 'manual'). */
async function gotoWithBleManual(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
}

/** Conecta el mock + inyecta un bastonazo del EID dado. */
async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e: string) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no está disponible (¿se montó el BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/** Abre la ficha de un animal (por su idv, que es el hero) + espera la sección "Identificación". */
async function openFicha(page: Page, idv: string): Promise<void> {
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: new RegExp(idv) }).first().click();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (a) BASTONEO DESDE LA FICHA → sheet acotado → la lectura se asigna a ESTE animal + el overlay global NO se
//     abre (RCF.6, el punto crítico de propiedad exclusiva).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a) RCF.6: bastoneo desde la ficha → sheet acotado asigna a ESTE animal + el overlay global NO se abre', async ({ page }) => {
  const user = await createTestUser('cfscan');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CFScan');
  // Animal ACTIVO SIN caravana electrónica (tag null) → la afordancia "Bastonear la caravana" se ofrece.
  const idv = `9001${Date.now().toString().slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { tag: null, idv, visualAlt: `${RUN_TAG}-CFS`, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await openFicha(page, idv);

  // Abrir el sheet de bastoneo (afordancia PROMINENTE de la sección Identificación).
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });

  // Bastonazo CON el sheet abierto → la lectura entra al scanner ACOTADO (la ficha des-suspendió el listener
  // solo para él). El sheet muestra la confirmación pre-commit (EID legible + "Asignar caravana").
  const eid = makeEid();
  await bastonazo(page, eid);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();

  // ORÁCULO CRÍTICO (RCF.6): el FindOrCreateOverlay GLOBAL NO se abrió — el scanner acotado consumió la
  // lectura. Chequeamos por AUSENCIA del testID EXCLUSIVO del overlay (no por ausencia de texto).
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);

  // Confirmar → encola el RPC (offline-safe) → el sheet se cierra (optimismo en sitio → afordancia read-only).
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('tag-scan-open')).toHaveCount(0);

  // ORÁCULO SERVER: el assign persistió end-to-end (outbox → RPC assign_tag_to_animal → animals.tag_electronic
  // → propagación 0079 a animal_profiles.animal_tag_electronic) en ESTE perfil.
  await waitForServerTagAssigned(profileId, eid);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (b) Al CERRAR el sheet, la ficha RE-SUSPENDE el listener global (scoped scanner liberado → busyMode manda
//     de nuevo) → un bastonazo POSTERIOR en la ficha no hace NADA (ni sheet ni overlay). Verifica el cleanup.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(b) RCF.6: al cerrar el sheet, un bastonazo posterior en la ficha no dispara nada (listener re-suspendido)', async ({ page }) => {
  const user = await createTestUser('cfclose');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CFClose');
  const idv = `9101${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv, visualAlt: `${RUN_TAG}-CFC`, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await openFicha(page, idv);

  // Abrir el sheet y CERRARLO sin asignar (la X del header) → el scanner acotado se libera.
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('tag-scan-close').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });

  // Bastonazo con el sheet CERRADO (ficha con busyMode prendido de nuevo) → NADA: ni el sheet se reabre, ni
  // el overlay global aparece (el listener quedó suspendido, como antes de abrir el sheet).
  await bastonazo(page, makeEid());
  await page.waitForTimeout(1500); // margen para que un sheet/overlay erróneo apareciera
  await expect(page.getByTestId('tag-scan-read')).toHaveCount(0);
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0);
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);
  // La ficha sigue en pantalla (nada se apiló encima).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (c) DEGRADACIÓN sin transporte (manual-promovido): el sheet muestra el prompt NEUTRO y deriva a la carga
//     MANUAL de la ficha (piso siempre presente) → el input de 15 díg sigue funcionando (RCF.6 + RCF.2).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(c) RCF.6: sin transporte el sheet degrada a "no disponible" + deriva a la carga manual (piso), que sigue funcionando', async ({ page }) => {
  const user = await createTestUser('cfman');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CFMan');
  const idv = `9201${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv, visualAlt: `${RUN_TAG}-CFM`, sex: 'female' });

  await gotoWithBleManual(page);
  await signIn(page, user);
  await waitForHome(page);
  await openFicha(page, idv);

  // Abrir el sheet → sin transporte cae al hero manual-promovido (tono NEUTRO, no es un error).
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('El bastón no está disponible en este dispositivo', { exact: true })).toBeVisible();

  // "Cargar la caravana a mano" → cierra el sheet → la afordancia manual de la ficha queda a la vista.
  await page.getByTestId('tag-scan-to-manual').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });

  // La carga MANUAL (piso siempre presente) sigue funcionando: expandir → 15 díg → confirmar → optimismo.
  await page.getByRole('button', { name: 'Agregar caravana electrónica', exact: true }).click();
  const tagInput = page.getByLabel('Caravana electrónica', { exact: true });
  await expect(tagInput).toBeVisible();
  const tag = `98209${Date.now().toString().slice(-10)}`.slice(0, 15).padEnd(15, '0');
  await tagInput.fill(tag);
  await page.getByTestId('assign-tag-confirm').click();
  // Optimismo en sitio (RCF.2.7): el tag aparece en solo-lectura → ya no se ofrece ni scan ni carga manual.
  await expect(page.getByText(tag, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('tag-scan-open')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agregar caravana electrónica', exact: true })).toHaveCount(0);
});
