// e2e/maniobra-rutinas-gestion.spec.ts — GESTIÓN de RUTINAS (presets): editar + borrar (spec 03 M7-A,
// R2.6–R2.11). Cabla la UI que faltaba sobre los servicios `updatePreset`/`softDeletePreset` ya existentes.
//
// El kebab ⋯ de cada fila de "Tus rutinas" (landing de MODO MANIOBRAS) abre el menú de acciones:
//   - Editar → Renombrar (sheet) → updatePreset (mismo id, nuevo name) — R2.7.
//   - Editar → Reconfigurar → wizard en modo edición (editPresetId) → "Guardar cambios" → updatePreset
//     (mismo id, nuevo config.maniobras) SIN crear sesión — R2.8.
//   - Eliminar → confirmación SIN "Deshacer" → softDeletePreset (deleted_at no-NULL) → se va de la lista — R2.9.
//   - R2.11: borrar una rutina NO afecta una jornada ya arrancada (snapshot en sessions.config).
//
// Capturas (412 + 360, web táctil con hasTouch) → tests/modo-maniobra/rutinas-*.png.
//
// El cleanup borra el establishment (cascada) en afterAll.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedManeuverPreset,
  seedActiveSession,
  setUserPhone,
  cleanupAll,
  waitForServerPresetDeleted,
  waitForServerPresetUpdated,
  readServerActiveSessionIds,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'tests', 'modo-maniobra');

test.afterAll(async () => {
  await cleanupAll();
});

/** Abre el landing de MODO MANIOBRAS por deep-link y espera "Tus rutinas". */
async function gotoLanding(page: Page): Promise<void> {
  await page.goto('/maniobra');
  await expect(page.getByText('Modo maniobras', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Tus rutinas', { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-412.png`) });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-360.png`) });
  await page.setViewportSize({ width: 412, height: 915 });
}

test('rutina: ⋯ → Eliminar → confirmación → softDeletePreset → se va de la lista + oráculo server', async ({ page }) => {
  const user = await createTestUser('m7a-borrar');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Rutinas Borrar');
  const presetId = await seedManeuverPreset(establishmentId, 'Tacto de otoño', {
    maniobras: ['pesaje', 'tacto'],
    preconfig: {},
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoLanding(page);

  // La rutina sembrada aparece (nombre con RUN_TAG). El ⋯ de su fila abre el menú (R2.6).
  const menu = page.getByTestId(`preset-menu-${presetId}`);
  await expect(menu).toBeVisible({ timeout: 20_000 });
  await shot(page, 'rutinas-lista');
  await menu.click();
  await expect(page.getByTestId('preset-actions-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('preset-action-editar')).toBeVisible();
  await expect(page.getByTestId('preset-action-eliminar')).toBeVisible();
  await shot(page, 'rutinas-menu');

  // Eliminar → confirmación SIN "Deshacer" (R2.9, decisión #2).
  await page.getByTestId('preset-action-eliminar').click();
  await expect(page.getByTestId('delete-preset-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Esta acción no se puede deshacer.', { exact: true })).toBeVisible();
  await shot(page, 'rutinas-borrar-confirm');
  await page.getByTestId('delete-preset-confirm').click();

  // Se va de la lista al instante (overlay + quita optimista) + oráculo SERVER (deleted_at no-NULL).
  await expect(page.getByTestId(`preset-menu-${presetId}`)).toHaveCount(0, { timeout: 15_000 });
  await waitForServerPresetDeleted(presetId);
});

test('rutina: ⋯ → Editar → Renombrar → updatePreset (mismo id, nuevo name)', async ({ page }) => {
  const user = await createTestUser('m7a-renombrar');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Rutinas Renombrar');
  const presetId = await seedManeuverPreset(establishmentId, 'Nombre viejo', {
    maniobras: ['pesaje'],
    preconfig: {},
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoLanding(page);

  await page.getByTestId(`preset-menu-${presetId}`).click();
  await expect(page.getByTestId('preset-actions-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('preset-action-editar').click();
  // Sub-menú: Renombrar / Reconfigurar.
  await expect(page.getByTestId('preset-action-renombrar')).toBeVisible();
  await page.getByTestId('preset-action-renombrar').click();

  // Sheet de nombre PRECARGADO con el nombre actual → cambiamos a uno nuevo → Guardar nombre.
  await expect(page.getByTestId('save-preset-sheet')).toBeVisible({ timeout: 10_000 });
  const newName = 'Tacto de primavera';
  await page.getByTestId('save-preset-input').fill(newName);
  await page.getByTestId('save-preset-sheet').getByRole('button', { name: 'Guardar nombre', exact: true }).click();
  await expect(page.getByTestId('save-preset-sheet')).toHaveCount(0, { timeout: 15_000 });

  // Oráculo SERVER: el MISMO preset cambió de nombre (no se creó otro). El config (maniobras) intacto.
  const row = await waitForServerPresetUpdated(presetId, (r) => r.name === newName);
  expect(row.name).toBe(newName);
  expect(row.config.maniobras).toEqual(['pesaje']);
});

test('rutina: ⋯ → Editar → Reconfigurar → wizard precargado → cambiar maniobras → Guardar cambios (mismo id, sin sesión)', async ({ page }) => {
  const user = await createTestUser('m7a-reconfig');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Rutinas Reconfig');
  const presetId = await seedManeuverPreset(establishmentId, 'Solo pesaje', {
    maniobras: ['pesaje'],
    preconfig: {},
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoLanding(page);

  await page.getByTestId(`preset-menu-${presetId}`).click();
  await page.getByTestId('preset-action-editar').click();
  await page.getByTestId('preset-action-reconfigurar').click();

  // Reabre el wizard en MODO EDICIÓN: etapa 1 (rodeo) → loadPreset precarga la maniobra.
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // pesaje ya viene seleccionado (precargado del preset). Sumamos tacto.
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByTestId('pool-row-tacto').click();
  await expect(page.getByTestId('selected-row-1')).toBeVisible();
  // El header refleja el modo edición.
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByText('Revisá la rutina', { exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(page, 'rutinas-reconfig-resumen');

  // El CTA terminal es "Guardar cambios" (NO "Arrancar jornada") — R2.8.
  await expect(page.getByRole('button', { name: 'Guardar cambios', exact: true })).toBeVisible();
  // NO se ofrece "Guardar como rutina" (redundante en edición).
  await expect(page.getByRole('button', { name: 'Guardar como rutina', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();

  // Vuelve al landing (el wizard estaba PUSHEADO sobre la pantalla de inicio → al guardar quedan 2
  // instancias en el DOM; la visible es la de arriba → .last()). La fila de la rutina vuelve con su ⋯.
  await expect(page.getByTestId(`preset-menu-${presetId}`).last()).toBeVisible({ timeout: 20_000 });

  // Oráculo SERVER: el MISMO preset cambió su config.maniobras (pesaje + tacto) — no creó uno nuevo.
  const row = await waitForServerPresetUpdated(presetId, (r) => {
    const m = r.config.maniobras;
    return Array.isArray(m) && m.includes('pesaje') && m.includes('tacto');
  });
  expect(row.config.maniobras).toContain('tacto');
  // Y NO se creó ninguna SESIÓN (el flujo de edición no arranca jornada, R2.8).
  const activeSessions = await readServerActiveSessionIds(establishmentId);
  expect(activeSessions.length).toBe(0);
});

test('R2.11: borrar una rutina NO afecta una jornada ya arrancada (snapshot en sessions.config)', async ({ page }) => {
  const user = await createTestUser('m7a-r211');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Rutinas R211');
  const presetId = await seedManeuverPreset(establishmentId, 'Rutina usada', {
    maniobras: ['pesaje'],
    preconfig: {},
  });
  // Una sesión ACTIVA (jornada en curso) — su config es un SNAPSHOT (no hay FK al preset).
  const sessionId = await seedActiveSession(establishmentId, rodeoId, { config: { maniobras: ['pesaje'] } });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoLanding(page);

  // Borramos la rutina.
  await page.getByTestId(`preset-menu-${presetId}`).click();
  await page.getByTestId('preset-action-eliminar').click();
  await page.getByTestId('delete-preset-confirm').click();
  await waitForServerPresetDeleted(presetId);

  // La SESIÓN ACTIVA sigue activa (no la tocó el borrado del preset).
  const activeSessions = await readServerActiveSessionIds(establishmentId);
  expect(activeSessions).toContain(sessionId);
});
