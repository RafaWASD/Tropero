// e2e/sigsa-breed-renspa.spec.ts — BreedPicker en el alta (spec 08, T13/T18) + RENSPA (T17 / R2.3, R13.3).
//
// Corre contra el export ESTÁTICO de prod en :8099 + Supabase remoto (mismo patrón que animals.spec.ts).
//
// Cubre (criticidad MIXTA):
//   1. BREEDPICKER en el ALTA: navegar al wizard → paso datos → abrir el sheet "Elegir raza" → BUSCAR →
//      elegir una raza del catálogo SENASA → crear el animal → la raza (nombre) quedó en la ficha. + el
//      caso "Sin raza" (la opción existe y es elegible). + ASSERT server-side de que `breed_id` se DERIVÓ
//      desde `breed` al subir (trigger 0113, T18) — el alta persiste el NOMBRE en `breed` (la RPC 0083 no
//      tiene p_breed_id) y el trigger pone el breed_id. ⚠ ese assert PASA recién tras el apply de 0113.
//   2. FICHA — editar la raza (T18): animal sin raza → CTA "Completá la raza para SIGSA" → BreedPickerSheet →
//      elegir Hereford → la raza queda en la ficha + ASSERT server-side breed='Hereford' + breed_id=H derivado.
//   3. RENSPA: campo sin RENSPA → banner "Completá tu RENSPA" en Más (owner) → tap → editar-campo → cargar
//      el RENSPA → guardar → persiste server-side (vía RPC update_renspa). + validación: > 20 chars.
//
// ⚠ Importa test/expect de ./helpers/fixtures (NO @playwright/test): si no, PowerSync bootea en blanco.

import { test, expect } from './helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** Camina el wizard de alta hasta el PASO DATOS (con 1 rodeo, el paso 1 auto-avanza al sexo). */
async function walkWizardToData(
  page: import('@playwright/test').Page,
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

test('BreedPicker en el alta: abrir el sheet → buscar → elegir una raza → la raza queda en la ficha + breed_id derivado (trigger 0113)', async ({
  page,
}) => {
  const user = await createTestUser('breedpick');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo BreedPick');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // El trigger de raza muestra el placeholder + el hint de SIGSA (no hay raza elegida).
  const breedTrigger = page.getByRole('button', { name: 'Elegir raza', exact: true });
  await expect(breedTrigger).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Completá la raza para poder exportar el animal a SIGSA.', { exact: true })).toBeVisible();

  // Abrimos el sheet. El título "Elegir raza" + la opción "Sin raza — a completar" aparecen.
  await breedTrigger.click();
  await expect(page.getByText('Sin raza — a completar', { exact: true })).toBeVisible({ timeout: 20_000 });

  // BÚSQUEDA: tipeamos "aberdeen" → la lista se filtra a Aberdeen Angus (y "Sin raza" sigue arriba).
  const search = page.getByLabel('Buscar raza por nombre o código', { exact: true });
  await search.fill('aberdeen');
  // La opción de la raza (su a11y label incluye nombre + código). La elegimos.
  const aaOption = page.getByRole('button', { name: 'Raza Aberdeen Angus, código AA', exact: true });
  await expect(aaOption).toBeVisible({ timeout: 10_000 });
  await aaOption.click();

  // El sheet se cierra y el trigger ahora muestra la raza elegida (nombre).
  await expect(page.getByText('Aberdeen Angus', { exact: true })).toBeVisible({ timeout: 10_000 });
  // El hint de "completá la raza" ya no debe estar (hay raza elegida).
  await expect(page.getByText('Completá la raza para poder exportar el animal a SIGSA.', { exact: true })).toHaveCount(0);

  // Nombre / seña (opcional): el alta EN BLANCO no precarga ningún identificador, pero el
  // server exige al menos UNO (animal_profiles_identity_check, 0021 / R6.2) — sin él, create_animal
  // rechaza con 23514 al subir y el alta NO aterriza en Postgres (el cliente ahora lo valida antes de
  // encolar, hasAtLeastOneIdentifier). Cargamos un visual para que el animal PERSISTA y el trigger 0113
  // pueda derivar breed_id sobre la fila real. Mismo gesto que animals.spec.ts (toda alta lleva un id).
  const visualLabel = `${RUN_TAG}-AA1`;
  await page.getByLabel('Nombre / seña (opcional)', { exact: true }).fill(visualLabel);

  // Creamos el animal.
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // La ficha muestra la raza (el NOMBRE persistió en `breed`).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Raza', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Aberdeen Angus', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // ✅ VERIFICACIÓN SERVER-SIDE DEL TRIGGER (spec 08, T18 / 0113): el alta persiste `breed`='Aberdeen Angus'
  // (texto) y el trigger tg_derive_breed_id_from_breed DERIVA `breed_id` = el id de AA al subir. Sin el
  // trigger, breed_id quedaría NULL (la RPC create_animal 0083 no lo setea) → el animal NO sería exportable.
  // Esperamos a que la cola de PowerSync suba el alta y el trigger corra (poll server-side).
  const { data: aaRow, error: aaErr } = await admin
    .from('breed_catalog')
    .select('id')
    .eq('senasa_code', 'AA')
    .single();
  if (aaErr) throw new Error(`breed_catalog AA: ${aaErr.message}`);

  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from('animal_profiles')
          .select('breed_id')
          .eq('establishment_id', establishmentId)
          .eq('breed', 'Aberdeen Angus')
          .maybeSingle();
        return data?.breed_id ?? null;
      },
      { timeout: 30_000, message: 'el trigger 0113 debe derivar breed_id=AA desde breed="Aberdeen Angus" al subir el alta' },
    )
    .toBe(aaRow.id);
});

test('Ficha: editar la raza (completar para SIGSA) → BreedPickerSheet → la raza queda en la ficha + breed_id derivado (T18)', async ({
  page,
}) => {
  const user = await createTestUser('fichabreed');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo FichaBreed');

  // Animal SIN raza (breed NULL) → en la ficha aparece el CTA "Completá la raza para SIGSA" (cierra el loop
  // "A completar → completar"). Lo buscamos por su IDV.
  const idv = `FB${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'vaquillona',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Buscar el animal por IDV → tocar el resultado → ficha.
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  // Ficha cargada. Sin raza → el CTA "Completá la raza para SIGSA" (afordancia de completar).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  const completarCta = page.getByRole('button', { name: 'Completá la raza para SIGSA', exact: true });
  await expect(completarCta).toBeVisible({ timeout: 20_000 });
  await completarCta.click();

  // El BreedPickerSheet abre. Elegimos Hereford.
  await expect(page.getByText('Sin raza — a completar', { exact: true })).toBeVisible({ timeout: 20_000 });
  const hOption = page.getByRole('button', { name: 'Raza Hereford, código H', exact: true });
  await expect(hOption).toBeVisible({ timeout: 10_000 });
  await hOption.click();

  // El sheet se cierra y la ficha muestra la raza elegida + el link "Cambiar" (ya hay raza).
  await expect(page.getByText('Hereford', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Cambiar la raza', exact: true })).toBeVisible();
  // El CTA "Completar" ya no debe estar (hay raza).
  await expect(page.getByRole('button', { name: 'Completá la raza para SIGSA', exact: true })).toHaveCount(0);

  // ✅ VERIFICACIÓN SERVER-SIDE: la edición persistió `breed`='Hereford' (vía UPDATE de animal_profiles, RLS
  // has_role_in) y el trigger 0113 DERIVÓ breed_id = el id de H al subir (el cliente NUNCA manda breed_id).
  const { data: hRow, error: hErr } = await admin
    .from('breed_catalog')
    .select('id')
    .eq('senasa_code', 'H')
    .single();
  if (hErr) throw new Error(`breed_catalog H: ${hErr.message}`);

  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from('animal_profiles')
          .select('breed, breed_id')
          .eq('id', profileId)
          .single();
        return { breed: data?.breed ?? null, breedId: data?.breed_id ?? null };
      },
      { timeout: 30_000, message: 'la edición de raza debe persistir breed="Hereford" + breed_id=H derivado por el trigger 0113' },
    )
    .toEqual({ breed: 'Hereford', breedId: hRow.id });
});

test('BreedPicker: la opción "Sin raza — a completar" existe y al elegirla deja el animal sin raza', async ({
  page,
}) => {
  const user = await createTestUser('breednone');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo BreedNone');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Macho', categoryName: 'Ternero' });

  // Abrimos el picker, elegimos una raza y luego "Sin raza" → el trigger vuelve al placeholder.
  await page.getByRole('button', { name: 'Elegir raza', exact: true }).click();
  await page.getByRole('button', { name: 'Raza Hereford, código H', exact: true }).click();
  await expect(page.getByText('Hereford', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Reabrimos y elegimos "Sin raza".
  await page.getByRole('button', { name: 'Elegir raza', exact: true }).click();
  await page.getByRole('button', { name: 'Sin raza, a completar', exact: true }).click();
  // El hint de SIGSA vuelve (no hay raza).
  await expect(page.getByText('Completá la raza para poder exportar el animal a SIGSA.', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
});

test('RENSPA: campo sin RENSPA → banner en Más → editar campo → guardar → persiste (vía RPC)', async ({
  page,
}) => {
  const user = await createTestUser('renspa');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Renspa');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Vamos a "Más" (ancla: el título de sección "Perfil").
  await gotoTab(page, 'Más', page.getByText('Perfil', { exact: true }));

  // El banner de RENSPA aparece (el campo no tiene RENSPA y el usuario es owner).
  const banner = page.getByRole('button', { name: 'Completá el RENSPA del campo para la exportación a SIGSA' });
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await banner.click();

  // Aterrizamos en "Editar campo" (el form tiene el campo RENSPA).
  const renspaField = page.getByLabel('RENSPA (opcional)', { exact: true });
  await expect(renspaField).toBeVisible({ timeout: 20_000 });

  // El campo CAPEA el largo a 20 (maxLength) → el tope no se puede violar tipeando (el >20 lo cubre el unit
  // test de validateRenspa). Tipeamos 25 chars y verificamos que el input los TRUNCA a 20.
  await renspaField.fill('0123456789012345678901234');
  await expect(renspaField).toHaveValue('01234567890123456789'); // 20 chars exactos

  // Cargamos un RENSPA válido y guardamos.
  const validRenspa = '01.001.0.00001';
  await renspaField.fill(validRenspa);
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();

  // Tras guardar, volvemos a "Más" (router.back). El banner ya NO debe estar (el campo tiene RENSPA).
  // ⚠ El RENSPA se guarda por la RPC update_renspa (online) → Postgres; el valor BAJA por la stream
  // est_establishments al SQLite local de forma asíncrona. El banner es REACTIVO al sync-down (re-lee en
  // cada statusChanged, fix s26) → desaparece cuando el valor recién guardado aterriza. Damos margen al
  // round-trip (20s) por eso.
  await expect(page.getByText('Perfil', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('button', { name: 'Completá el RENSPA del campo para la exportación a SIGSA' }),
  ).toHaveCount(0, { timeout: 20_000 });

  // Verificación server-side: el RENSPA persistió (vía la RPC update_renspa, owner-only).
  const { data, error } = await admin
    .from('establishments')
    .select('renspa')
    .eq('id', establishmentId)
    .single();
  if (error) throw new Error(`renspa check: ${error.message}`);
  expect(data?.renspa).toBe(validRenspa);
});
