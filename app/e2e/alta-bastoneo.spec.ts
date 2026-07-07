// e2e/alta-bastoneo.spec.ts — red de seguridad del BASTONEO de la caravana electrónica en el ALTA (delta
// bastoneo-captura-alta-parto, RCF.6 generalizado a modo CAPTURA). En el alta el animal NO existe todavía:
// el EID leído se CAPTURA al estado del form (setTag) y viaja a create_animal — NO hay RPC assign (a diferencia
// de la ficha). El TagScanSheet es el MISMO componente que la ficha, en modo captura (onSubmit setea + ok:true).
//
// El punto CRÍTICO (RCF.6): el alta suspende el listener global (useBusyWhileMounted); el sheet de scan toma la
// propiedad EXCLUSIVA del bastón → la lectura entra al sheet y el FindOrCreateOverlay global NO se abre encima.
//
// Inyección sin hardware: mismo mecanismo que baston-ficha.spec.ts — el provider monta el MockAdapter bajo la
// marca __RAFAQ_BLE_E2E__; window.__rafaqBle.connectMock/tagRead lo publica el BleE2EBridge.
//
// Oráculos:
//   - "capturado" → CapturedTagRow (testID tag-captured) con el EID legible.
//   - "el overlay global NO se abrió" → AUSENCIA del testID EXCLUSIVO find-or-create-overlay.
//   - "el alta persistió con la caravana" → server-side: waitForServerAnimalProfile (por idv) +
//     waitForServerTagAssigned(profileId, eid) (animals.tag_electronic + denorm 0079).

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  waitForServerAnimalProfile,
  waitForServerTagAssigned,
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

async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
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

/** Camina el wizard de alta desde empty hasta el paso 4 (datos), Hembra → Vaquillona (1 rodeo auto-avanza P1). */
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (a) ALTA → CTA "Bastonear" → sheet acotado → lectura CAPTURADA al form + overlay global NO abierto →
//     confirmar alta → el animal creado tiene esa tag_electronic (RCF.6 en modo captura).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a) RCF.6 captura: alta → bastonear → EID capturado al form + overlay global NO se abre → alta con esa caravana', async ({ page }) => {
  const user = await createTestUser('altascan');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo AltaScan');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await walkAltaToData(page);

  // Un idv (identificador para localizar el perfil en el server) + el tag por bastoneo.
  const idv = `7001${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);

  // El campo electrónico tipeable suelto YA NO existe: solo el CTA "Bastonear la caravana (opcional)".
  await expect(page.getByLabel('Caravana electrónica (recomendado, 15 dígitos)', { exact: true })).toHaveCount(0);
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });

  // Bastonazo CON el sheet abierto → entra al scanner ACOTADO → confirmación pre-commit ("Usar caravana").
  const eid = makeEid();
  await bastonazo(page, eid);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usar caravana', exact: true })).toBeVisible();

  // ORÁCULO CRÍTICO (RCF.6): el FindOrCreateOverlay GLOBAL NO se abrió (el scoped scanner consumió la lectura).
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);

  // Confirmar → captura al form (sin RPC) → el sheet cierra → el EID queda read-only (CapturedTagRow).
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('tag-captured')).toBeVisible();
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();

  // Crear el animal → el tag capturado viaja a create_animal.
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // ORÁCULO SERVER: el alta aterrizó con esa caravana (animals.tag_electronic + denorm 0079 en el perfil).
  const { id: profileId } = await waitForServerAnimalProfile(establishmentId, { idv });
  await waitForServerTagAssigned(profileId, eid);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (a-bis) MIS-SCAN CORREGIBLE: en el form el EID NO es inmutable (a diferencia de la ficha) → "Cambiar"
//         limpia el capturado y re-aparece el CTA → un 2º bastonazo captura otra caravana. El alta usa la
//         ÚLTIMA (prueba que un mis-scan se corrige antes de confirmar).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a-bis) RCF.6 captura: mis-scan → "Cambiar" limpia → re-bastonear captura otra → el alta usa la última', async ({ page }) => {
  const user = await createTestUser('altarescan');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo AltaRescan');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await walkAltaToData(page);

  const idv = `7101${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);

  // 1er bastonazo (caravana equivocada) → capturado.
  const eidWrong = makeEid();
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await bastonazo(page, eidWrong);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-captured')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(eidReadable(eidWrong), { exact: true })).toBeVisible();

  // "Cambiar" → limpia el capturado → re-aparece el CTA (el EID del form NO es inmutable).
  await page.getByTestId('tag-captured-clear').click();
  await expect(page.getByTestId('tag-captured')).toHaveCount(0);
  await expect(page.getByTestId('tag-scan-open')).toBeVisible();

  // 2º bastonazo (la correcta) → capturado.
  const eidRight = makeEid();
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await bastonazo(page, eidRight);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByText(eidReadable(eidRight), { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // ORÁCULO SERVER: el alta usó la ÚLTIMA caravana (eidRight), NO la equivocada (eidWrong).
  const { id: profileId } = await waitForServerAnimalProfile(establishmentId, { idv });
  await waitForServerTagAssigned(profileId, eidRight);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (b) CLEANUP: al cerrar el sheet SIN capturar, el alta RE-SUSPENDE el listener global → un bastonazo
//     posterior en el form no dispara NADA (ni sheet ni overlay). Verifica el release del scoped scanner.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(b) RCF.6 captura: al cerrar el sheet, un bastonazo posterior en el alta no dispara nada (listener re-suspendido)', async ({ page }) => {
  const user = await createTestUser('altaclose');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo AltaClose');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await walkAltaToData(page);

  // Abrir el sheet y cerrarlo con la X → el scoped scanner se libera.
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('tag-scan-close').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });

  // Bastonazo con el sheet CERRADO (alta con busyMode prendido de nuevo) → NADA se apila.
  await bastonazo(page, makeEid());
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('tag-scan-read')).toHaveCount(0);
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0);
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);
  // El form sigue en pantalla (el capturado nunca apareció: no se bastoneó dentro del sheet).
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible();
  await expect(page.getByTestId('tag-captured')).toHaveCount(0);
});
