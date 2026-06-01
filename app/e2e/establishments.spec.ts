// e2e/establishments.spec.ts — red de seguridad del flujo de ESTABLECIMIENTOS (spec 01, Fase 4).
//
// Cubre los caminos críticos donde Raf ya vio bugs de runtime (403 RLS al crear, listas que no
// refrescan, el switch que no cambiaba el activo):
//   - Crear campo desde el onboarding, pasando por el GATE DE TELÉFONO (R3.8) → aterriza en
//     HOME con ese campo activo (el saludo + el nombre del campo en el header del switch).
//   - Con ≥2 campos sembrados, el login aterriza en "Mis campos" (landing) y elegir uno
//     fija el activo y lleva a su home (R6.7).
//
// Usuarios + campos namespaced; cleanup en afterAll + global-teardown. Los campos creados por
// la UI se barren por RUN_TAG en el nombre (cleanupAll), así no dejamos basura.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishment,
  seedRodeo,
  setUserPhone,
  trackEstablishmentsByNameLike,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, waitForOnboarding, waitForMisCampos } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

test('crear campo desde onboarding (con gate de teléfono) → bloqueo total de rodeo (C1, R2.6)', async ({
  page,
}) => {
  const user = await createTestUser('crear');
  // NO seteamos teléfono: queremos ejercitar el gate de teléfono (R3.8) en el flujo de UI.

  await page.goto('/');
  await signIn(page, user);
  await waitForOnboarding(page);

  // CTA primario del wizard → flujo de alta.
  await page.getByRole('button', { name: 'Crear mi primer campo' }).click();

  // GATE DE TELÉFONO (R3.8): la pantalla pide el teléfono antes del form de alta.
  await expect(page.getByText('Tu teléfono', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Teléfono', { exact: true }).fill('11 2345 6789');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // FORM DE ALTA: nombre + provincia obligatorios. Nombre namespaced para barrerlo después.
  const fieldName = `${RUN_TAG} La Juanita`;
  const crearCampoBtn = page.getByRole('button', { name: 'Crear campo', exact: true });
  await expect(crearCampoBtn).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Nombre del campo', { exact: true }).fill(fieldName);
  await page.getByLabel('Provincia', { exact: true }).fill('Buenos Aires');
  await crearCampoBtn.click();

  // POST-C1 (R2.6): tras crear el PRIMER campo, el campo activo tiene 0 rodeos → el RootGate bloquea
  // TODA la app con el wizard "Creá tu primer rodeo" (no aterriza en home hasta crear un rodeo). Esto
  // ejercita el encadenado de gates establecimiento → rodeo desde el flujo de UI real (antes de C1
  // este test terminaba en home; ahora termina, correctamente, en el bloqueo total de rodeo).
  await expect(page.getByText('Creá tu primer rodeo', { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // Aseguramos que el campo creado por UI quede trackeado para cleanup (por si el sweep por
  // RUN_TAG cambiara). El nombre arranca con el RUN_TAG.
  await trackEstablishmentsByNameLike(`${RUN_TAG} La Juanita`);
});

test('con ≥2 campos el login aterriza en "Mis campos" y elegir uno lleva a su home', async ({
  page,
}) => {
  const user = await createTestUser('multi');
  await setUserPhone(user.id, '1123456789');
  // Dos campos sembrados (estado 'choosing' → landing "Mis campos", R6.7).
  const norteId = await seedEstablishment(user.id, 'Campo Norte');
  await seedEstablishment(user.id, 'Campo Sur');
  // C1: el campo elegido (Norte) necesita un rodeo para aterrizar en home y no en el bloqueo total de
  // rodeo (este test va de landing/switch de establecimiento, no de rodeos).
  await seedRodeo(norteId);

  await page.goto('/');
  await signIn(page, user);

  // Con ≥2 campos y ninguno fijado, RootGate manda a "Mis campos".
  await waitForMisCampos(page);
  const norte = `${RUN_TAG} Campo Norte`;
  const sur = `${RUN_TAG} Campo Sur`;
  await expect(page.getByText(norte, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(sur, { exact: true })).toBeVisible();

  // Elegir un campo → switchEstablishment(id) + navega a su home (R6.3/R6.7).
  await page.getByText(norte, { exact: true }).first().click();
  await waitForHome(page);
  // La home del campo elegido muestra su nombre en el switch del header.
  await expect(page.getByText(norte, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});
