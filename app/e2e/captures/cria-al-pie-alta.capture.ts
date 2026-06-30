// e2e/captures/cria-al-pie-alta.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta #15
// "VINCULAR LA CRÍA AL PIE" (spec 02, RCAP.1–RCAP.5). Recorre el flujo del prompt SALTABLE post-alta y
// saca CAPTURAS NOMBRADAS de cada estado clave a `e2e/captures/__shots__/cria-al-pie-alta/NN-estado.png`
// para que el leader las vete (design-review) y se las muestre a Raf en la Puerta 2 con evidencia visual.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN del #15 vive
// en e2e/animals.spec.ts (bloques `delta #15`); este archivo SOLO captura estados, reusando los MISMOS
// helpers de setup/seed/navegación y los MISMOS selectores (testIDs link-calf-*, a11y labels) de esa suite.
//
// Es la pantalla REAL (NO un mock): el prompt vive en src/components/LinkCalfPrompt.tsx, lo dispara
// crear-animal.tsx tras el alta de una vaca con cría al pie → hace el flujo de login + alta completo.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/cria-al-pie-alta.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/cria-al-pie-alta/  (gitignoreado — ver app/.gitignore + ADR-029 §Artefactos).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  anonClient,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

// Path RELATIVO a app/ (cwd de Playwright) → resuelve a app/e2e/captures/__shots__/cria-al-pie-alta/.
// page.screenshot crea los dirs padre solos.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'cria-al-pie-alta');

test.afterAll(async () => {
  await cleanupAll();
});

/**
 * Saca una captura NOMBRADA tras un breve settle de layout (el prompt no anima, pero la transición
 * alta→prompt y el scroll del body pueden dejar un frame en vuelo). El llamador asegura un
 * expect(...).toBeVisible() del elemento clave ANTES de invocar esto (per ADR-029 / instrucción).
 */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/**
 * Camina el wizard de la alta guiada desde el paso 2 (sexo) hasta el paso 4 (datos), eligiendo
 * sexo + categoría. COPIA EXACTA del helper homónimo de animals.spec.ts (mismos selectores a11y).
 */
async function walkWizardToData(
  page: Page,
  opts: { sex: 'Macho' | 'Hembra'; categoryName: string },
) {
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Sexo ${opts.sex}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.categoryName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ─── PASADA PRINCIPAL: encadena los estados 01,02,03,05,06,08,09,07,10 en un solo flujo ──────────────
//
// Campo con 2 rodeos del MISMO sistema (cría) → el picker del ternero (08/09) ofrece "Destete" como
// destino editable + un ternero EXISTENTE sin madre (05). El alta arranca por el BUSCADOR (el campo ya
// tiene el ternero sembrado → no es empty). La madre va al rodeo "general" → la leyenda "(Mismo rodeo que
// la madre)" arranca visible y desaparece al elegir "Destete".
test('captura #15: flujo del prompt VINCULAR LA CRÍA AL PIE (ask / error / found / create / picker)', async ({
  page,
}) => {
  test.setTimeout(210_000);

  const user = await createTestUser('criacap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CriaCap'); // rodeo A "Rodeo general"
  await seedRodeo(establishmentId, 'Destete'); // rodeo B, mismo sistema → destino editable del ternero (RCAP.5.3/5.4)
  // Ternero EXISTENTE SIN madre → el find-or-create lo encuentra (fase found, 05).
  const calfIdv = `7711${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: calfIdv, sex: 'male' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  // Gate de sync: el ternero sembrado está en la lista → bajó al SQLite local → el find-or-create lo verá.
  await expect(page.getByText(calfIdv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // ── Alta de la MADRE (vaca con cría al pie) por el buscador (campo no-empty) ──
  const motherIdv = `5512${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill(motherIdv);
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  // 2 rodeos → el wizard pide el rodeo (paso 1). La madre va al rodeo "general".
  await expect(page.getByText('¿A qué rodeo va este animal?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Rodeo .*general/i }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  // ── 01 — alta con el toggle "Con cría al pie" elegido (ANTES de crear → muestra el disparador del prompt). ──
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear animal', exact: true })).toBeVisible();
  await shot(page, '01-alta-con-cria-al-pie');

  // Crear → dispara el prompt (happy path, nursing=true).
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // ── 02 — prompt recién abierto (fase ask), campo "Caravana del ternero" vacío. ──
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  const caravana = page.getByLabel('Caravana del ternero', { exact: true });
  await expect(caravana).toBeVisible();
  await expect(caravana).toHaveValue('');
  await shot(page, '02-prompt-ask');

  // ── 03 — "Buscar ternero" sin tipear → error inline "Ingresá la caravana del ternero." ──
  await page.getByTestId('link-calf-search').click();
  await expect(page.getByText('Ingresá la caravana del ternero.', { exact: true })).toBeVisible();
  await shot(page, '03-ask-error-vacio');

  // ── 05 — ternero EXISTENTE sin madre → buscar → fase found con la card "Ternero encontrado". ──
  await caravana.fill(calfIdv);
  await page.getByTestId('link-calf-search').click();
  await expect(page.getByText('Ternero encontrado', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(calfIdv, { exact: true }).first()).toBeVisible();
  await shot(page, '05-found-card');

  // Desde found → "← Cambiar caravana" → ask (conserva lo tipeado) → re-tipear una caravana NO ENCONTRADA.
  await page.getByTestId('link-calf-back').click();
  const caravana2 = page.getByLabel('Caravana del ternero', { exact: true });
  await expect(caravana2).toBeVisible();
  const newCalfIdv = `8811${Date.now().toString().slice(-6)}`;
  await caravana2.fill(newCalfIdv);
  await page.getByTestId('link-calf-search').click();

  // ── 06 — caravana NO encontrada → fase create con el mini-form (sexo / año / día-mes / rodeo). ──
  await expect(page.getByText('Sexo del ternero', { exact: true })).toBeVisible({ timeout: 20_000 });
  // RCAP.5.1/5.2: el rodeo del ternero arranca PRESELECCIONADO al de la madre, con la leyenda visible.
  await expect(page.getByText('(Mismo rodeo que la madre)', { exact: true })).toBeVisible();
  await shot(page, '06-create-form');

  // ── 08 — abrir el picker de rodeo del ternero → lista del mismo sistema + leyenda visible. ──
  // (Picker pristine, sin errores: capturamos las dos vistas del picker ANTES del error de sexo, 07.)
  await page.getByRole('button', { name: 'Elegir rodeo del ternero' }).click();
  await expect(page.getByRole('button', { name: /Rodeo .*Destete/i })).toBeVisible();
  await expect(page.getByText('(Mismo rodeo que la madre)', { exact: true })).toBeVisible();
  await shot(page, '08-rodeo-picker-open');

  // ── 09 — elegir OTRO rodeo (Destete, mismo sistema) → la leyenda desaparece (RCAP.5.3). ──
  await page.getByRole('button', { name: /Rodeo .*Destete/i }).click();
  await expect(page.getByText('(Mismo rodeo que la madre)', { exact: true })).toHaveCount(0);
  await shot(page, '09-rodeo-cambiado');

  // ── 07 — "Crear y vincular" sin elegir sexo → error inline "Elegí el sexo del ternero." (RCAP.4.2). ──
  await page.getByTestId('link-calf-create').click();
  await expect(page.getByText('Elegí el sexo del ternero.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('link-calf-create')).toBeVisible(); // sigue en CREATE (no navegó)
  await shot(page, '07-create-error-sexo');

  // ── 10 — "← Cambiar caravana" desde create → vuelve a ask CONSERVANDO lo tipeado (RCAP control & freedom). ──
  await page.getByTestId('link-calf-back').click();
  const caravana3 = page.getByLabel('Caravana del ternero', { exact: true });
  await expect(caravana3).toBeVisible();
  await expect(caravana3).toHaveValue(newCalfIdv);
  await shot(page, '10-cambiar-caravana');
});

// ─── PASADA SEPARADA: estado 04 ("ya tiene madre"), que requiere un seed propio (madre+ternero vinculados) ──
//
// Reusa el seed del test de regresión RCAP.3.3: una madre PRE-EXISTENTE + un ternero, vinculados por un
// parto vía la RPC REAL link_calf_to_mother (birth_calves es server-only — sin GRANT de INSERT a nadie
// salvo el DEFINER, RCAP.6.10 — así que el vínculo lo crea la RPC desde el cliente autenticado del owner).
test('captura #15: aviso "ya tiene una madre registrada" (ternero con madre, RCAP.3.3)', async ({ page }) => {
  test.setTimeout(180_000);

  const user = await createTestUser('criacapm');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CriaCapM');
  const pmIdv = `4411${Date.now().toString().slice(-6)}`;
  const calfIdv = `6611${Date.now().toString().slice(-6)}`;
  const motherProfileId = await seedAnimal(establishmentId, rodeoId, { idv: pmIdv, sex: 'female' });
  const calfProfileId = await seedAnimal(establishmentId, rodeoId, { idv: calfIdv, sex: 'male' });
  const authed = anonClient();
  const { error: signErr } = await authed.auth.signInWithPassword({ email: user.email, password: user.password });
  if (signErr) throw new Error(`seed sign-in: ${signErr.message}`);
  const { error: linkErr } = await authed.rpc('link_calf_to_mother', {
    p_mother_profile_id: motherProfileId,
    p_calf_profile_id: calfProfileId,
    p_event_date: '2026-01-15',
  });
  if (linkErr) throw new Error(`seed link_calf_to_mother: ${linkErr.message}`);
  await authed.auth.signOut();

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Gate de sync DETERMINISTA: la ficha del ternero muestra la card "Madre" (fetchMother LOCAL) → el
  // birth_calf sembrado YA bajó al SQLite local → el prompt lo verá como "ya tiene madre" (sin race).
  await expect(page.getByText(calfIdv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: new RegExp(calfIdv) }).first().click();
  await expect(page.getByLabel(`Ver la ficha de la madre: ${pmIdv}`)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Volver', exact: true }).click();

  // Alta de una NUEVA vaca con cría al pie → prompt → buscar el ternero que YA tiene madre.
  const newMotherIdv = `5513${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill(newMotherIdv);
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Caravana del ternero', { exact: true }).fill(calfIdv);
  await page.getByTestId('link-calf-search').click();

  // ── 04 — aviso "ya tiene una madre registrada" (RCAP.3.3); NO se ofrece confirmar el vínculo. ──
  await expect(page.getByText(/ya tiene una madre registrada/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('link-calf-confirm')).toHaveCount(0);
  await shot(page, '04-ask-aviso-ya-tiene-madre');
});
