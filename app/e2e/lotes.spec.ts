// e2e/lotes.spec.ts — red de seguridad del flujo C4: LOTES (management_groups, ADR-020 / spec 02).
//
// Corre contra el export ESTÁTICO de prod servido en :8099 + Supabase remoto (mismo patrón que
// rodeos/animals/events.spec.ts). Estado de partida: usuario OWNER con teléfono (saltea el gate
// R3.8) + 1 campo con 1 rodeo + 1 animal sembrado.
//
// Cubre el flujo de C4 (criterios del context-c4-lotes):
//   1. Crear un lote desde la pantalla /lotes (entry point junto a Rodeos, D2).
//   2. Asignar el animal a ese lote DESDE LA FICHA (cualquier rol; acá owner). La ficha refleja el
//      lote asignado al instante.
//   3. Ver los miembros del lote (tap en el lote → lista de animales activos, D3).
//   4. Borrar el lote → el animal queda reasignado a NULL (D1). El soft-delete del lote va por el RPC
//      SECURITY DEFINER `soft_delete_management_group` (0041, owner-only), NO por UPDATE directo: un
//      `update management_groups set deleted_at = now()` vía PostgREST daría 42501 porque la fila sale
//      de la SELECT-policy (`deleted_at is null`) tras el UPDATE (gotcha ESPERADO, no bug de backend).
//
// NOTA de navegación: /lotes es un Stack.Screen pusheado SOBRE (tabs) (sin bottom-nav). RN-web deja
// AMBAS pantallas en el DOM (la de abajo oculta) → no asertamos por textos ambiguos como "Lotes"
// (existe el título del screen Y el ActionRow de "Más"); usamos anclas únicas (el CTA "Crear lote",
// los lotes por nombre con RUN_TAG) y volvemos con "Volver" antes de cambiar de tab.
//
// La E2E corre el export de PROD → es CIEGA a overlays de DEV; el a11y helper es obligatorio. Las
// confirmaciones destructivas usan window.confirm en web → page.on('dialog'). Usuarios + campos
// namespaced; cleanup en afterAll + teardown.

import { test, expect } from './helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedManagementGroup,
  setUserPhone,
  cleanupAll,
  waitForServerExit,
  waitForServerProfileManagementGroup,
  readServerProfileManagementGroup,
  getServerProfileStatus,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales, gotoLoteGroup, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// Auto-aceptar las confirmaciones destructivas (window.confirm en web).
test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
});

// Abre la pantalla /lotes desde "Más" (ActionRow "Lotes"). Espera el CTA "Crear lote" (ancla única
// de la pantalla cuando es owner, no ambigua con el título del screen).
async function gotoLotes(page: import('@playwright/test').Page): Promise<void> {
  const lotesRow = page.getByRole('button', { name: 'Ver y gestionar los lotes del campo' });
  await gotoTab(page, 'Más', lotesRow);
  await lotesRow.click();
  await expect(page.getByRole('button', { name: 'Crear lote', exact: true })).toBeVisible({ timeout: 20_000 });
}

test('crear lote → asignar desde la ficha → ver miembros', async ({ page }) => {
  const user = await createTestUser('lotes');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Lotes');
  const idv = `8822${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  const loteName = `${RUN_TAG} Otoño`;

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── 1. Ir a /lotes desde "Más" → crear el lote. ───────────────────────────────────────
  await gotoLotes(page);
  await page.getByRole('button', { name: 'Crear lote', exact: true }).click();
  const nameInput = page.getByLabel('Nombre del lote', { exact: true });
  await expect(nameInput).toBeVisible({ timeout: 20_000 });
  await nameInput.fill(loteName);
  // Cuando el form está abierto hay un único "Crear lote" (el submit del Card); `.last()` por robustez.
  await page.getByRole('button', { name: 'Crear lote', exact: true }).last().click();

  // El lote aparece en la lista (tappable para ver miembros — ancla única por RUN_TAG).
  await expect(
    page.getByRole('button', { name: `Ver los animales del lote ${loteName}`, exact: true }),
  ).toBeVisible({ timeout: 20_000 });

  // ── 2. Volver a (tabs) → ficha del animal → asignar el lote. ──────────────────────────
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await gotoAnimales(page);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // Ficha: sección "Lote" con "Sin lote" + CTA "Asignar a un lote".
  await expect(page.getByText('Lote actual', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Sin lote', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Asignar a un lote', exact: true }).click();

  // Selector: elegir el lote creado → la ficha refleja el lote asignado al instante (queda como
  // "Lote actual" y el trigger pasa a "Cambiar lote"). El nombre con RUN_TAG es único en el DOM.
  await page.getByRole('button', { name: `Lote ${loteName}`, exact: true }).click();
  await expect(page.getByText(loteName, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Cambiar lote', exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 3. Volver a /lotes → ver miembros (D3): el animal asignado aparece en el acordeón. ─
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await gotoLotes(page);
  await page.getByRole('button', { name: `Ver los animales del lote ${loteName}`, exact: true }).click();
  await expect(page.getByRole('button', { name: new RegExp(idv) }).first()).toBeVisible({ timeout: 20_000 });
});

// Anti-patrón "re-fetch que parpadea" (fix Raf 2026-06-12, FIX A): crear + renombrar un lote NO debe volver
// a mostrar el placeholder "Cargando lotes…" (la lista ya está montada → se muta en sitio + refresh silencioso,
// nunca se blanquea). Asertamos que el spinner NUNCA reaparece tras cada acción y que el cambio se refleja.
test('crear/renombrar NO blanquea la lista (optimismo en sitio, sin "Cargando lotes…")', async ({ page }) => {
  const user = await createTestUser('lotesopt');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo LotesOpt');

  const loteName = `${RUN_TAG} Invierno`;
  const renamed = `${RUN_TAG} Invierno B`;

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoLotes(page);
  const spinner = page.getByText('Cargando lotes…', { exact: true });

  // ── Crear: la lista NO debe blanquear (el lote nuevo aterriza optimista). ──
  await page.getByRole('button', { name: 'Crear lote', exact: true }).click();
  await page.getByLabel('Nombre del lote', { exact: true }).fill(loteName);
  await page.getByRole('button', { name: 'Crear lote', exact: true }).last().click();
  await expect(
    page.getByRole('button', { name: `Ver los animales del lote ${loteName}`, exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  // Tras crear, el placeholder de carga inicial NO reaparece (mutación en sitio, no re-fetch que blanquea).
  await expect(spinner).toHaveCount(0);

  // ── Renombrar: el item se actualiza en su lugar, sin blanquear. ──
  await page.getByRole('button', { name: `Renombrar el lote ${loteName}`, exact: true }).click();
  const renameInput = page.getByLabel('Nombre del lote', { exact: true });
  await expect(renameInput).toBeVisible({ timeout: 20_000 });
  await renameInput.fill(renamed);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  // El lote aparece con el nombre nuevo (ancla única por RUN_TAG) y el spinner NO reaparece.
  await expect(
    page.getByRole('button', { name: `Ver los animales del lote ${renamed}`, exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(spinner).toHaveCount(0);
});

// D1 end-to-end: crear lote → asignar 1 animal → borrar el lote → el animal queda SIN lote y el lote
// desaparece de la lista. El soft-delete del lote pasa por el RPC `soft_delete_management_group`
// (0041, owner-only); el clear-NULL del paso 1 va por UPDATE directo. No hay bug de backend: el RPC
// existe y está desplegado exactamente para este gotcha de visibilidad SELECT.
test('borrar lote → su animal queda reasignado a NULL (D1)', async ({ page }) => {
  const user = await createTestUser('lotesdel');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo LotesDel');
  const idv = `7733${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });
  const loteName = `${RUN_TAG} Primavera`;

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Crear + asignar (idéntico al test de arriba, condensado).
  await gotoLotes(page);
  await page.getByRole('button', { name: 'Crear lote', exact: true }).click();
  await page.getByLabel('Nombre del lote', { exact: true }).fill(loteName);
  await page.getByRole('button', { name: 'Crear lote', exact: true }).last().click();
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await gotoAnimales(page);
  await page.getByRole('button', { name: new RegExp(idv) }).first().click();
  await page.getByRole('button', { name: 'Asignar a un lote', exact: true }).click();
  await page.getByRole('button', { name: `Lote ${loteName}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cambiar lote', exact: true })).toBeVisible({ timeout: 20_000 });

  // Borrar el lote (confirmación auto-aceptada) → debería reasignar el animal a NULL y soft-deletear.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await gotoLotes(page);
  await page
    .getByRole('button', { name: `Eliminar el lote ${loteName} (acción destructiva)`, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: `Ver los animales del lote ${loteName}`, exact: true }),
  ).toHaveCount(0, { timeout: 20_000 });

  // El animal volvió a "Sin lote" (D1).
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await gotoAnimales(page);
  await page.getByRole('button', { name: new RegExp(idv) }).first().click();
  await expect(page.getByText('Lote actual', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Sin lote', { exact: true }).first()).toBeVisible();
});

// ── delta lotes-venta (RLV.2/RLV.3/RLV.7/RLV.9): BAJA EN TANDA desde el lote. Vender/Descartar → modo
//    selección → tildar UN subconjunto → Venta → registrar salida → el lote queda con MENOS cabezas, el
//    animal vendido queda archivado (status 'sold') y SIN lote (management_group_id NULL), y el que NO se
//    seleccionó sigue activo en el lote (no-atomicidad correcta). Oráculo SERVER (tras drenar la outbox). ──
test('vender en tanda un subconjunto del lote → menos cabezas + archivado sin lote (RLV.2/3/7/9)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('lotevta');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Venta');
  const grupo = await seedManagementGroup(establishmentId, 'Venta');
  const idvA = `5551${Date.now().toString().slice(-5)}`;
  const idvB = `5552${Date.now().toString().slice(-5)}`;
  const pA = await seedAnimal(establishmentId, rodeoId, { idv: idvA, sex: 'female' });
  const pB = await seedAnimal(establishmentId, rodeoId, { idv: idvB, sex: 'female' });
  // Ambas hembras en el lote (estado de partida).
  {
    const { error } = await admin.from('animal_profiles').update({ management_group_id: grupo.id }).in('id', [pA, pB]);
    if (error) throw new Error(`seed assign lote: ${error.message}`);
  }

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Vista de grupo del lote (card de Inicio). Ambos animales activos visibles.
  await gotoLoteGroup(page, grupo.name);
  await expect(page.getByText(idvA, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(idvB, { exact: true }).first()).toBeVisible();

  // Vender / Descartar → modo selección → tildar SOLO A (subconjunto).
  await page.getByTestId('lote-vender-descartar').click();
  await expect(page.getByText('Elegí los animales', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('checkbox', { name: new RegExp(idvA) }).first().click();
  await expect(page.getByText('1 seleccionado', { exact: true })).toBeVisible();

  // Registrar salida → paso 1 motivo Venta → paso 2 registrar (fecha default hoy, sin precio/peso).
  await page.getByTestId('lote-registrar-salida').click();
  await expect(page.getByText('¿Qué pasó con estos animales?', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Venta', exact: true }).click();
  await expect(page.getByText('Vas a dar de baja', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('venta-registrar-salida').click();

  // Volvemos al lote (modo normal, re-leído): A ya no está; B sigue.
  await expect(page.getByTestId('lote-vender-descartar')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(idvB, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(idvA, { exact: true })).toHaveCount(0, { timeout: 20_000 });

  // ORÁCULO SERVER (tras drenar la outbox): A archivado (sold) + SIN lote; B intacto (activo, en el lote).
  await waitForServerExit(pA, 'sold', { tries: 40 });
  await waitForServerProfileManagementGroup(pA, null, { tries: 40 });
  expect(await readServerProfileManagementGroup(pB)).toBe(grupo.id);
  expect((await getServerProfileStatus(pB)).status).toBe('active');
});
