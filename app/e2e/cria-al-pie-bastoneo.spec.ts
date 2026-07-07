// e2e/cria-al-pie-bastoneo.spec.ts — red de seguridad del BASTONEO de la caravana del ternero en el prompt
// VINCULAR LA CRÍA AL PIE (delta bastoneo-cría-al-pie, "scan-para-llenar"). A diferencia del alta/parto —donde
// el bastón CAPTURA el EID a un estado del form— acá el prompt es un BUSCADOR find-or-create que acepta EID **o**
// IDV: el bastón LLENA el campo de búsqueda con el EID leído y AVANZA el mismo find-or-create existente
// (classifyCalfQuery lo ve como `eid` → lookupByTag → found | create). El camino de tipear (IDV incluido) queda
// INTACTO; el bastón solo agrega el camino de llenar-por-scan.
//
// El punto CRÍTICO (ownership, RCF.6): el prompt vive SOBRE crear-animal, que suspende el listener global
// (useBusyWhileMounted); el TagScanSheet (montado sobre el prompt con hideManualEntry) toma la propiedad
// EXCLUSIVA del bastón → la lectura entra al sheet y el FindOrCreateOverlay global NO se abre encima.
//
// Inyección sin hardware: mismo mecanismo que alta-bastoneo.spec.ts — el provider monta el MockAdapter bajo la
// marca __RAFAQ_BLE_E2E__; window.__rafaqBle.connectMock/tagRead lo publica el BleE2EBridge.
//
// Oráculos:
//   - "scan-para-llenar" → tras confirmar el scan, el campo "Caravana del ternero" queda con el EID leído y el
//     find-or-create avanzó (fase create para un EID nuevo / fase found para un ternero sembrado con esa tag).
//   - "el overlay global NO se abrió" → AUSENCIA del testID EXCLUSIVO find-or-create-overlay.
//   - "el vínculo/creación aterrizó" → server-side: waitForServerBirth (found) / waitForServerCalfTags (create:
//     el EID escaneado viajó a register_birth → animals.tag_electronic del ternero creado).

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  waitForServerAnimalProfile,
  waitForServerBirth,
  waitForServerCalfTags,
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

/** Camina el wizard de la alta guiada desde el paso 2 (sexo) hasta el paso 4 (datos). Con 1 rodeo auto-avanza P1. */
async function walkWizardToData(page: Page, opts: { sex: 'Macho' | 'Hembra'; categoryName: string }): Promise<void> {
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Sexo ${opts.sex}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.categoryName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (a) CREATE: prompt → "Bastonear la caravana del ternero" → sheet acotado → lectura de un EID NUEVO → el
//     query se llena con el EID + el find-or-create avanza a la fase CREATE (no existe) + overlay global NO
//     abierto. "Cambiar caravana" prueba que el campo quedó con el EID (scan-para-llenar). Crear+vincular →
//     el EID escaneado viaja a register_birth → animals.tag_electronic del ternero creado.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a) scan-para-llenar CREATE: bastonear la caravana del ternero → EID nuevo llena el buscador → fase create + overlay global NO se abre → crear+vincular con esa caravana', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const user = await createTestUser('criabastcr');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo CriaBastCr');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Campo vacío → el alta arranca por el CTA de empty. 1 rodeo → auto-avanza el paso 1 → sexo.
  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  // Identificador de la madre (para localizar su perfil server-side).
  const motherIdv = `5514${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(motherIdv);

  // Con cría al pie → Crear animal → dispara el prompt.
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Prompt (fase ask): el CTA de bastoneo + el campo de texto conviven.
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('link-calf-scan-open')).toBeVisible();
  await expect(page.getByLabel('Caravana del ternero', { exact: true })).toBeVisible();

  // Tocar "Bastonear la caravana del ternero" → abre el TagScanSheet acotado (sobre el prompt).
  await page.getByTestId('link-calf-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });

  // Bastonazo de un EID NUEVO (no existe en el campo) → confirmación pre-commit ("Usar caravana").
  const eid = makeEid();
  await bastonazo(page, eid);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usar caravana', exact: true })).toBeVisible();

  // ORÁCULO CRÍTICO (ownership): el FindOrCreateOverlay GLOBAL NO se abrió (el scoped scanner consumió la lectura).
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);

  // Confirmar → el sheet cierra + el query se llena con el EID + el find-or-create avanza. EID nuevo → fase CREATE.
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('Sexo del ternero', { exact: true })).toBeVisible({ timeout: 20_000 });

  // "Cambiar caravana" (control & freedom) → vuelve a ask CONSERVANDO lo que llenó el bastón → el campo tiene el EID.
  await page.getByTestId('link-calf-back').click();
  const calfField = page.getByLabel('Caravana del ternero', { exact: true });
  await expect(calfField).toBeVisible();
  await expect(calfField).toHaveValue(eid); // scan-para-llenar: el buscador quedó lleno con el EID leído

  // Re-buscar el MISMO EID → vuelve a la fase create (sigue sin existir).
  await page.getByTestId('link-calf-search').click();
  await expect(page.getByText('Sexo del ternero', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Sexo requerido → elegir → "Crear y vincular".
  await page.getByRole('button', { name: 'Sexo Macho', exact: true }).click();
  await page.getByTestId('link-calf-create').click();

  // Navega a la ficha de la vaca (reflejo optimista). Oráculo server: el EID escaneado quedó como la
  // tag_electronic del ternero creado por register_birth (cadena birth → birth_calves → animals).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  const { id: motherId } = await waitForServerAnimalProfile(establishmentId, { idv: motherIdv });
  const tags = await waitForServerCalfTags(motherId, [eid]);
  expect(tags).toContain(eid);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (b) FOUND: un ternero EXISTENTE (sembrado con esa tag electrónica) → bastonear su EID → el query se llena
//     + el find-or-create lo ENCUENTRA (fase found) → vincular → parto + birth_calf en el server.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(b) scan-para-llenar FOUND: bastonear la caravana de un ternero existente → find-or-create lo encuentra → vincular', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const user = await createTestUser('criabastfd');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CriaBastFd');
  // Ternero EXISTENTE con caravana ELECTRÓNICA (el bastón la lee) + idv (gate de sync + visibilidad en la lista).
  const eid = makeEid();
  const calfIdv = `7712${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: calfIdv, tag: eid, sex: 'male' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  // Gate de sync: el ternero sembrado aparece en la lista → bajó al SQLite local → el find-or-create lo verá por tag.
  await expect(page.getByText(calfIdv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // El campo ya tiene un animal → el alta arranca por el buscador (un id fresco no-match → "Dar de alta este animal").
  const motherIdv = `5515${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill(motherIdv);
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Prompt → "Bastonear la caravana del ternero" → sheet.
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('link-calf-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });

  // Bastonazo del EID del ternero sembrado → confirmación.
  await bastonazo(page, eid);
  await expect(page.getByTestId('tag-scan-read')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(eidReadable(eid), { exact: true })).toBeVisible();
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0); // ownership

  // Confirmar → el query se llena + el find-or-create ENCUENTRA al ternero (fase found).
  await page.getByTestId('tag-scan-assign').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('Ternero encontrado', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('link-calf-confirm').click();

  // Navega a la ficha de la vaca. Oráculo server: 1 parto con 1 birth_calf.
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  const { id: motherId } = await waitForServerAnimalProfile(establishmentId, { idv: motherIdv });
  const birth = await waitForServerBirth(motherId, { expectedCalves: 1 });
  expect(birth.birthEventCount).toBe(1);
  expect(birth.calfCount).toBe(1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (c) CLEANUP: al cerrar el sheet SIN confirmar, el prompt (sobre crear-animal) re-suspende el listener global
//     → un bastonazo posterior no dispara NADA (ni sheet ni overlay). Verifica el release del scoped scanner.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(c) ownership: al cerrar el sheet del ternero, un bastonazo posterior no dispara nada (listener re-suspendido)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const user = await createTestUser('criabastcl');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo CriaBastCl');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`5516${Date.now().toString().slice(-6)}`);
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  // Abrir el sheet y cerrarlo con la X → el scoped scanner se libera.
  await page.getByTestId('link-calf-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('tag-scan-close').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });

  // Bastonazo con el sheet CERRADO (el prompt sobre crear-animal re-suspendió el listener) → NADA se apila.
  await bastonazo(page, makeEid());
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('tag-scan-read')).toHaveCount(0);
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0);
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);
  // El prompt sigue en pantalla, fase ask (no avanzó por un bastonazo fuera del sheet).
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible();
  await expect(page.getByTestId('link-calf-scan-open')).toBeVisible();
});
