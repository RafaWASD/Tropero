// e2e/events.spec.ts — red de seguridad del flujo C3.1: FICHA + CRONOLOGÍA (spec 02 R10/R14).
//
// Corre contra el export ESTÁTICO de prod servido en :8099 + Supabase remoto (mismo patrón que
// animals.spec.ts). Estado de partida: usuario con teléfono (saltea gate R3.8) + 1 campo con 1
// rodeo + 1 animal sembrado (find-or-create / seedAnimal).
//
// Cubre:
//   1. Abrir la ficha del animal → el timeline muestra al menos el evento `initial` de categoría
//      (todo animal tiene un category_change con reason 'initial' por el trigger 0030) — en C3.1
//      se ve como el empty/sparse cálido ("Todavía no hay eventos").
//   2. Agregar un PESO → aparece en el timeline ("Pesaje" + kg) arriba.
//   3. Agregar una OBSERVACIÓN → aparece en el timeline arriba.
//
// La E2E corre el export de PROD → es CIEGA a overlays de DEV; por eso el a11y helper es obligatorio
// (los Pressables del wizard usan buttonA11y). Usuarios + campos namespaced; cleanup en afterAll.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

test('ficha → timeline (sparse inicial) → agregar peso y observación → aparecen arriba', async ({
  page,
}) => {
  const user = await createTestUser('timeline');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Timeline');
  // Animal sembrado con un IDV único y buscable (para abrir su ficha desde la lista).
  const idv = `7711${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // El animal aparece en la lista → tocarlo abre la ficha.
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // Ficha: el bloque "Historial" + el empty/sparse cálido (solo está el `initial`, que no se
  // muestra como nodo solitario → empty cálido).
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Todavía no hay eventos', { exact: true })).toBeVisible();

  // ── Agregar un PESO. ──────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();

  // Paso 1: elegir el tipo. Tocamos "Pesaje".
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Pesaje', exact: true }).click();

  // Paso 2: cargar el peso (la fecha viene precargada con hoy).
  const weightInput = page.getByLabel('Peso en kilos', { exact: true });
  await expect(weightInput).toBeVisible({ timeout: 20_000 });
  await weightInput.fill('320');
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // De vuelta en la ficha: el timeline ahora muestra "Pesaje" + "320 kg" (el empty cálido se fue).
  await expect(page.getByText('Pesaje', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('320 kg', { exact: true })).toBeVisible();
  await expect(page.getByText('Todavía no hay eventos', { exact: true })).toHaveCount(0);

  // FIX C: "Estado actual" surfacea el peso vigente (el del último weight_event) como ATRIBUTO del
  // animal — "Peso actual" + el valor con su timestamp ("320 kg · Hoy", el peso se cargó recién).
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible();
  await expect(page.getByText('Peso actual', { exact: true })).toBeVisible();
  await expect(page.getByText(/320 kg · /)).toBeVisible();
  // La condición corporal todavía no se cargó → "Sin registrar" (la sección se muestra siempre).
  await expect(page.getByText('Condición corporal', { exact: true })).toBeVisible();
  await expect(page.getByText('Sin registrar', { exact: true })).toBeVisible();

  // ── Agregar una OBSERVACIÓN. ──────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Observación', exact: true }).click();

  const obsText = 'Renguea de la pata derecha, revisar';
  const obsInput = page.getByLabel('Observación', { exact: true });
  await expect(obsInput).toBeVisible({ timeout: 20_000 });
  await obsInput.fill(obsText);
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // De vuelta en la ficha: la observación aparece arriba (más reciente), y el pesaje sigue.
  await expect(page.getByText(obsText, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Pesaje', { exact: true })).toBeVisible();
});

test('agregar-evento: validación EN VIVO + rechazo de submit inválido (peso vacío)', async ({
  page,
}) => {
  const user = await createTestUser('eventvalid');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo EventValid');
  const idv = `6611${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'male' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Pesaje', exact: true }).click();

  // El peso filtra basura EN VIVO (solo decimal): tipeamos letras → queda vacío.
  const weightInput = page.getByLabel('Peso en kilos', { exact: true });
  await expect(weightInput).toBeVisible({ timeout: 20_000 });
  await weightInput.fill('abc');
  await expect(weightInput).toHaveValue('');

  // FIX B: la parte entera se acota a 4 cifras EN VIVO (ningún bovino llega a 5 cifras). Tipear
  // "12345" deja "1234" (el 5to dígito entero se descarta).
  await weightInput.fill('12345');
  await expect(weightInput).toHaveValue('1234');
  // Volvemos a vaciar el campo para probar abajo el rechazo de submit con peso vacío.
  await weightInput.fill('');
  await expect(weightInput).toHaveValue('');

  // Submit con el peso vacío → error, NO navega (seguimos en el wizard).
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();
  await expect(page.getByText('Ingresá el peso en kilos.', { exact: true })).toBeVisible({ timeout: 10_000 });
  // Sigue en el wizard (el campo de peso sigue visible; no aterrizó en la ficha).
  await expect(weightInput).toBeVisible();
});
