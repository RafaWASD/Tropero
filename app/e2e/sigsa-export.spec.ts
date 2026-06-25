// e2e/sigsa-export.spec.ts — red de seguridad de la pantalla FLAGSHIP de exportación SIGSA (spec 08,
// T16 / R7, R8, R9, R10, R12, R13).
//
// Corre contra el export ESTÁTICO de prod servido en :8099 + Supabase remoto (mismo patrón que
// animals.spec.ts). Estado de partida: usuario con teléfono (saltea gate R3.8) + 1 campo con 1 rodeo
// (aterriza en home). Se navega a la pantalla por Más → "Exportar a SENASA".
//
// Cubre (criticidad MIXTA, oficina):
//   1. EMPTY + botón deshabilitado: campo sin caravanas pendientes → resumen "0" + botón disabled +
//      empty positivo "Todo al día" (R9.5).
//   2. LISTOS / A-COMPLETAR: animales sembrados con/ sin raza → tabs con su conteo; "A completar"
//      muestra el motivo faltante (R8.3) + tap → ficha del animal.
//   3. HISTORIAL: una entrada de export_log sembrada aparece en la tab Historial con su cantidad +
//      afordancia de re-descarga (R10.1 / R12.2).
//   4. EXPORT: el botón "Exportar N animales" dispara el flujo. ⚠ El write del TXT (expo-file-system)
//      es STUB en web (react-native-web pitfall) → el happy-path archivo+checklist es NATIVE-only +
//      cubierto por los unit tests del servicio; en web asertamos que el botón está habilitado y dispara
//      el flujo (observamos el outcome de degradación graciosa, no un download imposible en web).
//
// ⚠ Importa test/expect de ./helpers/fixtures (NO @playwright/test): si no, PowerSync bootea en blanco
// → login timeout (gotcha del repo).
//
// Usuarios + campos namespaced; cleanup en afterAll + global-teardown.

import { test, expect } from './helpers/fixtures';
import {
  admin,
  anonClient,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
  cleanupAll,
  type TestUser,
} from './helpers/admin';
import { signIn, waitForHome, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// ── Helpers locales (usan el cliente admin ya exportado — no tocan admin.ts) ──

/** Resuelve el id de una raza del catálogo por su código SENASA (sembrado por la migración 0107). */
async function breedIdByCode(senasaCode: string): Promise<string> {
  const { data, error } = await admin
    .from('breed_catalog')
    .select('id')
    .eq('senasa_code', senasaCode)
    .single();
  if (error) throw new Error(`breedIdByCode(${senasaCode}): ${error.message}`);
  return data.id as string;
}

/** Asigna breed_id a un animal_profiles (lo que un animal "listo para SIGSA" necesita, R8.2). */
async function setProfileBreed(profileId: string, senasaCode: string): Promise<void> {
  const breedId = await breedIdByCode(senasaCode);
  const { error } = await admin.from('animal_profiles').update({ breed_id: breedId }).eq('id', profileId);
  if (error) throw new Error(`setProfileBreed(${profileId}, ${senasaCode}): ${error.message}`);
}

/**
 * Siembra una entrada de export_log (historial) como el USUARIO AUTENTICADO (no service_role).
 *
 * ⚠ Por qué autenticado y no admin: `export_log.generated_by` es NOT NULL + el trigger 0112
 * (tg_force_generated_by_auth_uid) lo FUERZA = auth.uid() incondicionalmente. Bajo service_role
 * auth.uid() es NULL → el INSERT violaría el NOT NULL. Firmando como el owner del campo, el trigger
 * setea generated_by = su uid (válido) y la RLS owner/vet (0112) pasa. Es el MISMO camino que la app.
 * `.select()` evita el RLS-on-RETURNING usando un read-back con el mismo cliente autenticado.
 */
async function seedExportLog(
  user: TestUser,
  establishmentId: string,
  opts: { animalCount: number; fileName: string; fileContent: string },
): Promise<string> {
  const client = anonClient();
  const { error: authErr } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (authErr) throw new Error(`seedExportLog signIn: ${authErr.message}`);

  const id = globalThis.crypto.randomUUID();
  // INSERT sin .select() (RLS-on-RETURNING): generated_by lo fuerza el trigger = auth.uid() del owner.
  const { error } = await client.from('export_log').insert({
    id,
    establishment_id: establishmentId,
    animal_count: opts.animalCount,
    file_name: opts.fileName,
    file_content: opts.fileContent,
  });
  await client.auth.signOut();
  if (error) throw new Error(`seedExportLog: ${error.message}`);
  return id;
}

/** Navega a la pantalla de exportación: Más → "Exportar a SENASA". Espera el título de la pantalla. */
async function gotoExportSigsa(page: import('@playwright/test').Page): Promise<void> {
  // Ancla del aterrizaje en "Más": el título de sección "Perfil" (único de esa pantalla; el texto
  // "Más" choca entre el header y el label del tab → ambiguo en strict mode).
  const masAnchor = page.getByText('Perfil', { exact: true });
  await gotoTab(page, 'Más', masAnchor);
  const link = page.getByRole('button', { name: 'Exportar las caravanas electrónicas para declarar en SIGSA' });
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();
  // Ancla del aterrizaje: el subtítulo de la pantalla (único; el TÍTULO "Exportar a SENASA" choca con el
  // label de la fila de "Más", que queda montada bajo la pantalla pusheada → ambiguo en strict mode).
  await expect(
    page.getByText('Generá el archivo para declarar las caravanas electrónicas en SIGSA web.', { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}

test('empty: campo sin caravanas pendientes → resumen 0 + botón deshabilitado + "Todo al día"', async ({
  page,
}) => {
  // Owner + campo con rodeo, SIN animales con caravana → 0 pendientes.
  const user = await createTestUser('sigsaempty');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo SigsaEmpty');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoExportSigsa(page);

  // El botón de exportar está deshabilitado (exportableCount = 0) y muestra el copy de "sin animales".
  const exportBtn = page.getByRole('button', { name: 'Sin animales para exportar' });
  await expect(exportBtn).toBeVisible({ timeout: 20_000 });
  await expect(exportBtn).toHaveAttribute('aria-disabled', 'true');

  // Empty positivo de "Listos" (R9.5).
  await expect(page.getByText('Todo al día', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Los filtros colapsables abren sin romper (R9.2): el Select de rodeo aparece con la opción "Todos
  // los rodeos". (No filtramos animales acá porque el campo está vacío; sólo verificamos el render.)
  await page.getByRole('button', { name: 'Filtros' }).click();
  await expect(page.getByRole('button', { name: 'Filtrar los pendientes por rodeo' })).toBeVisible({
    timeout: 10_000,
  });
});

test('listos / a-completar: animales con y sin raza → tabs con conteo; "A completar" muestra el motivo + tap → ficha', async ({
  page,
}) => {
  const user = await createTestUser('sigsalist');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo SigsaList');

  // Animal LISTO: caravana 15 díg + fecha de nacimiento + raza (Aberdeen Angus). El IDV lo hace
  // identificable en la ficha tras el tap.
  const tagReady = `032010${Date.now().toString().slice(-9)}`.slice(0, 15).padEnd(15, '0');
  const idvReady = `SIGR${Date.now().toString().slice(-5)}`;
  const readyProfile = await seedAnimal(establishmentId, rodeoId, {
    idv: idvReady,
    tag: tagReady,
    sex: 'female',
    birthDate: '2025-08-10',
  });
  await setProfileBreed(readyProfile, 'AA');

  // Animal A COMPLETAR: caravana 15 díg + fecha, pero SIN raza (breed_id NULL) → motivo "Falta la raza".
  const tagIncomplete = `032099${Date.now().toString().slice(-9)}`.slice(0, 15).padEnd(15, '0');
  const idvIncomplete = `SIGI${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvIncomplete,
    tag: tagIncomplete,
    sex: 'male',
    birthDate: '2025-09-01',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoExportSigsa(page);

  // Tab "Listos (1)": el resumen muestra al menos 1 listo y el botón habilita "Exportar 1 animal".
  await expect(page.getByRole('button', { name: 'Listos (1)' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Exportar 1 animal' })).toBeVisible({ timeout: 20_000 });
  // El TAG del listo aparece enmascarado (primeros6·últimos4).
  const maskedReady = `${tagReady.slice(0, 6)}·${tagReady.slice(-4)}`;
  await expect(page.getByText(maskedReady, { exact: true })).toBeVisible({ timeout: 20_000 });

  // Tab "A completar (1)": al tocarla, aparece el animal incompleto con su motivo.
  await page.getByRole('button', { name: 'A completar (1)' }).click();
  await expect(page.getByText('Falta la raza', { exact: false })).toBeVisible({ timeout: 20_000 });
  const maskedIncomplete = `${tagIncomplete.slice(0, 6)}·${tagIncomplete.slice(-4)}`;
  await expect(page.getByText(maskedIncomplete, { exact: true })).toBeVisible({ timeout: 20_000 });

  // Tap en la fila "a completar" → ficha del animal (para completar la raza, R8.3). La fila es un
  // button cuyo a11y label arranca con el TAG enmascarado.
  await page.getByRole('button', { name: new RegExp(escapeRegExp(maskedIncomplete)) }).first().click();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(idvIncomplete, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});

test('historial: una exportación previa sembrada aparece en la tab Historial con su cantidad + re-descarga', async ({
  page,
}) => {
  const user = await createTestUser('sigsahist');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo SigsaHist');
  // Sembramos una entrada de historial (3 animales) como el owner autenticado. El file_content es un
  // TXT mínimo válido.
  await seedExportLog(user, establishmentId, {
    animalCount: 3,
    fileName: `sigsa_campo_${RUN_TAG}_20260301_101500.txt`,
    fileContent: '032010000000000-H-AA-08/2025;032010000000001-M-H-09/2025;032010000000002-H-AA-07/2025',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoExportSigsa(page);

  // Vamos a la tab Historial (1) y verificamos la entrada: "3 animales" + el botón de re-descarga.
  await page.getByRole('button', { name: 'Historial (1)' }).click();
  await expect(page.getByText('3 animales', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Re-descargar la exportación/ })).toBeVisible({
    timeout: 20_000,
  });
});

test('markAsDeclared (R10.2): tap en un animal "Listo" → action-sheet → "Marcar como ya declarado por otro medio" → sale de pendientes', async ({
  page,
}) => {
  const user = await createTestUser('sigsamark');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo SigsaMark');

  // Un animal LISTO (caravana + fecha + raza). Tras marcarlo, debe salir de pendientes.
  const tag = `032077${Date.now().toString().slice(-9)}`.slice(0, 15).padEnd(15, '0');
  const profile = await seedAnimal(establishmentId, rodeoId, {
    idv: `SIGM${Date.now().toString().slice(-5)}`,
    tag,
    sex: 'female',
    birthDate: '2025-08-20',
  });
  await setProfileBreed(profile, 'AA');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoExportSigsa(page);

  // El animal aparece en "Listos (1)".
  await expect(page.getByRole('button', { name: 'Listos (1)' })).toBeVisible({ timeout: 30_000 });
  const masked = `${tag.slice(0, 6)}·${tag.slice(-4)}`;
  // Tap en la fila "Listo" → abre el action-sheet (NO va directo a la ficha como las "a completar").
  await page.getByRole('button', { name: new RegExp(escapeRegExp(masked)) }).first().click();

  // El action-sheet ofrece marcar (COPY EXACTO) + ver ficha. Tocamos "Marcar como ya declarado por otro medio".
  const markAction = page.getByRole('button', { name: 'Marcar como ya declarado por otro medio' });
  await expect(markAction).toBeVisible({ timeout: 10_000 });
  await markAction.click();

  // Fase de confirmación breve → confirmamos.
  const confirm = page.getByRole('button', { name: /Confirmar: marcar como ya declarado/ });
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.click();

  // Tras marcar, el animal desaparece de pendientes → "Listos (0)" + empty "Todo al día".
  await expect(page.getByRole('button', { name: 'Listos (0)' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Todo al día', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Verificación server-side: la declaración existe con export_log_id NULL (marca manual, no export con
  // archivo). El INSERT local entra a la cola de sync de PowerSync → SUBE async; polleamos hasta que llega
  // (la UI ya lo refleja optimista desde el SQLite local; el upload es eventually-consistent).
  let rows: Array<{ export_log_id: string | null }> = [];
  for (let i = 0; i < 60; i++) {
    const { data, error } = await admin
      .from('sigsa_declarations')
      .select('animal_profile_id, export_log_id')
      .eq('establishment_id', establishmentId)
      .eq('animal_profile_id', profile);
    if (error) throw new Error(`markAsDeclared check: ${error.message}`);
    rows = data ?? [];
    if (rows.length > 0) break;
    await page.waitForTimeout(1000);
  }
  expect(rows.length).toBe(1);
  expect(rows[0].export_log_id).toBeNull(); // marca manual (no export con archivo)
});

test('filtro de fechas (R9.3): rango de nacimiento acota los pendientes; desde > hasta muestra error inline', async ({
  page,
}) => {
  const user = await createTestUser('sigsadate');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo SigsaDate');

  // Dos animales listos con fechas de nacimiento DISTINTAS (uno 2024, uno 2025).
  const tag2024 = `032024${Date.now().toString().slice(-9)}`.slice(0, 15).padEnd(15, '0');
  const p2024 = await seedAnimal(establishmentId, rodeoId, {
    idv: `SD24${Date.now().toString().slice(-5)}`,
    tag: tag2024,
    sex: 'female',
    birthDate: '2024-03-10',
  });
  await setProfileBreed(p2024, 'AA');
  const tag2025 = `032025${Date.now().toString().slice(-9)}`.slice(0, 15).padEnd(15, '0');
  const p2025 = await seedAnimal(establishmentId, rodeoId, {
    idv: `SD25${Date.now().toString().slice(-5)}`,
    tag: tag2025,
    sex: 'male',
    birthDate: '2025-09-01',
  });
  await setProfileBreed(p2025, 'H');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoExportSigsa(page);

  // Ambos pendientes → "Listos (2)".
  await expect(page.getByRole('button', { name: 'Listos (2)' })).toBeVisible({ timeout: 30_000 });

  // Abrimos los filtros y acotamos a 2025 (desde 2025-01-01) → solo el de 2025 queda listo.
  await page.getByRole('button', { name: 'Filtros' }).click();
  const desde = page.getByLabel('Desde (AAAA-MM-DD)', { exact: true });
  await expect(desde).toBeVisible({ timeout: 10_000 });
  await desde.fill('2025-01-01');
  // El filtro se aplica al completar la fecha → el conteo baja a 1.
  await expect(page.getByRole('button', { name: 'Listos (1)' })).toBeVisible({ timeout: 30_000 });

  // Validación de rango incoherente: hasta < desde → error inline (NO banner global). Ponemos hasta = 2023.
  const hasta = page.getByLabel('Hasta (AAAA-MM-DD)', { exact: true });
  await hasta.fill('2023-01-01');
  await expect(page.getByText('La fecha "desde" no puede ser posterior a "hasta".', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
});

test('export: con un animal listo, el botón "Exportar" está habilitado y dispara el flujo', async ({
  page,
}) => {
  // ⚠ El write del TXT (expo-file-system) es STUB en web (RN-web pitfall) → el archivo+checklist es
  // NATIVE-only (cubierto por unit tests del servicio). Acá verificamos que el botón está HABILITADO y
  // que al tocarlo el flujo responde (sin colgarse): la pantalla sigue usable. Esto prueba el WIRING
  // (hook → generateExport) sin asertar un download imposible en web.
  const user = await createTestUser('sigsaexport');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo SigsaExport');

  const tag = `032055${Date.now().toString().slice(-9)}`.slice(0, 15).padEnd(15, '0');
  const profile = await seedAnimal(establishmentId, rodeoId, {
    idv: `SIGE${Date.now().toString().slice(-5)}`,
    tag,
    sex: 'female',
    birthDate: '2025-08-15',
  });
  await setProfileBreed(profile, 'H');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoExportSigsa(page);

  // El botón habilitado refleja el conteo de exportables.
  const exportBtn = page.getByRole('button', { name: 'Exportar 1 animal' });
  await expect(exportBtn).toBeVisible({ timeout: 30_000 });
  await expect(exportBtn).toHaveAttribute('aria-disabled', 'false');
  await exportBtn.click();

  // El flujo respondió (no se colgó): en web el File API es stub → degradación graciosa con error
  // accionable (ReportError). En NATIVE el mismo click produce el checklist (R13). Aceptamos cualquiera
  // de los dos resultados — ambos prueban que el botón disparó el flujo y la pantalla quedó usable.
  const checklist = page.getByText('Archivo generado', { exact: true });
  const errorCard = page.getByText('No se pudo cargar', { exact: true });
  await expect(checklist.or(errorCard)).toBeVisible({ timeout: 20_000 });
});

/** Escapa los metacaracteres de regex de un literal (igual que helpers/ui.ts). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
