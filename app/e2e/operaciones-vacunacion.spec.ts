// e2e/operaciones-vacunacion.spec.ts — red de regresión END-TO-END de la VACUNACIÓN MASIVA (spec 10
// chunk UI-D, T-UI.11 / R3.1, R4.2, R6.3).
//
// Corre contra el export ESTÁTICO de prod (:8099) + Supabase remoto + PowerSync. Estado de partida:
// usuario con teléfono + 1 campo con 1 rodeo de cría (vacunacion enabled por default) + algunos animales
// activos sembrados.
//
// Flujo (modelo Gate 0 ORIGINAL — filtro + preview, NO selección por checkbox):
//   home → card del rodeo → vista de grupo → "Vacunar" → tipear un producto → seleccionar una vía por chip
//   → preview "N eventos sobre M animales" (R4.2) → confirmar → N eventos encolados (R3.1) → Listo.
//   RE-EJECUTAR la misma vacunación (mismo producto, misma fecha) → preview = 0 nuevos: TODOS saltados por
//   idempotencia (R6.3 / already_applied) → el CTA queda deshabilitado.
//
// TEST-ONLY: la idempotencia es UUIDv5 (animal_profile_id + tipo + fecha) + barrera local; re-ejecutar no
// duplica. La 2da corrida lee los ids ya aplicados del SQLite local (la 1ra los encoló) → preview 0 nuevos.
// Datos namespaced (RUN_TAG); cleanup en afterAll. Aserta SOLO sobre datos propios.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoRodeoGroup } from './helpers/ui';
// waitForHome se usa una sola vez (post-login); el back de la masiva vuelve a la vista de grupo, no a home.

test.afterAll(async () => {
  await cleanupAll();
});

test('vacunación masiva: producto + vía → preview N/M → confirmar → N eventos → re-ejecutar = 0 nuevos (skip)', async ({
  page,
}) => {
  const user = await createTestUser('vacunacion');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Vacunacion');

  // 3 animales activos del grupo (sin filtro → preview "3 eventos sobre 3 animales").
  for (let i = 1; i <= 3; i++) {
    await seedAnimal(establishmentId, rodeoId, {
      idv: `V${i}${RUN_TAG.slice(-6)}`,
      sex: i % 2 === 0 ? 'female' : 'male',
    });
  }

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Inicio rodeo-céntrico → vista de grupo → "Vacunar".
  await gotoRodeoGroup(page, `${RUN_TAG} Rodeo general`);
  await page.getByRole('button', { name: 'Vacunar', exact: true }).click();

  // Esperamos la pantalla de vacunación (el campo "Producto") y que los animales bajen por sync.
  const productInput = page.getByLabel('Producto', { exact: true });
  await expect(productInput).toBeVisible({ timeout: 30_000 });

  // Tipear el producto (obligatorio).
  await productInput.fill('Mancha-gangrena');

  // Seleccionar una VÍA por chip (opcional → enum sanitary_route; "Subcutánea" es un valor del enum).
  // El chip es role="button" con su label; al tocarlo queda seleccionado (aria-pressed).
  const subcutaneousChip = page.getByRole('button', { name: 'Subcutánea', exact: true });
  await expect(subcutaneousChip).toBeVisible();
  await subcutaneousChip.click();
  await expect(subcutaneousChip).toHaveAttribute('aria-pressed', 'true');

  // ── Preview obligatorio (R4.2): "3 eventos sobre 3 animales". El preview baja con los animales sync. ──
  await expect(page.getByText('3 eventos sobre 3 animales', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Una vacunación por animal.', { exact: true })).toBeVisible();

  // Confirmar (CTA con el número vivo).
  await page.getByRole('button', { name: 'Vacunar 3 animales', exact: true }).click();

  // R3.1: 3 eventos encolados → "3 animales listos" → Listo. Al tocar "Listo" volvemos a la VISTA DE
  // GRUPO (backOr → router.back() pop-ea la pantalla de vacunación), no a la home.
  await expect(page.getByText('3 animales listos', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Listo', exact: true }).click();

  // ── RE-EJECUTAR la MISMA vacunación → 0 nuevos (R6.3 / idempotencia). Ya estamos en la vista de grupo. ──
  await expect(page.getByRole('button', { name: 'Vacunar', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Vacunar', exact: true }).click();
  const productInput2 = page.getByLabel('Producto', { exact: true });
  await expect(productInput2).toBeVisible({ timeout: 30_000 });

  // Mismo producto. La clave idempotente es (animal_profile_id, tipo, fecha) — el producto NO entra en la
  // clave: la 2da corrida del MISMO día sobre los mismos animales se saltea entera, sin importar el producto.
  await productInput2.fill('Mancha-gangrena');

  // El preview ahora reporta TODOS saltados (already_applied) → "Ningún animal nuevo para vacunar".
  await expect(page.getByText('Ningún animal nuevo para vacunar', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // Skip-and-report (R4.3/R6.3): los 3 ya tienen la vacunación cargada hoy.
  await expect(page.getByText('3 animales ya tienen esta vacunación cargada hoy', { exact: true })).toBeVisible();

  // El CTA queda DESHABILITADO (0 animales nuevos) → no se puede re-aplicar (R4.4: no se encola un saltado).
  // En la pantalla de vacunación el único role=button "Vacunar" es el CTA (el back es "Volver", el título
  // "Vacunar" es Text, no button). Con 0 toApply, `ctaLabel` cae a "Vacunar" y `canApply=false` → disabled.
  const cta = page.getByRole('button', { name: 'Vacunar', exact: true });
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('aria-disabled', 'true');
});
