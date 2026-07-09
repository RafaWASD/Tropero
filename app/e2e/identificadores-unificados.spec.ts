// e2e/identificadores-unificados.spec.ts — red de seguridad del delta IDENTIFICADORES UNIFICADOS
// (spec 02, IDU.<n>). Modelo de 3 identificadores TODOS opcionales: Caravana Electrónica (tag_electronic,
// 15 díg), Caravana Visual (idv, ALFANUMÉRICA ≤15), Nombre/Apodo (custom field data_key='apodo', opt-in
// por rodeo). El 4to histórico `visual_id_alt` se ELIMINÓ (columna + trigger de completitud + fallback).
//
// La migración 0122 YA está desplegada en el remoto. Estos e2e corren contra el export estático de prod
// (:8099) + Supabase remoto migrado. NO usan `visual_id_alt` en ningún seed (la columna no existe).
//
// Cubre:
//   E1 — búsqueda por los 3 (electrónica exacta 15 díg · idv ALFANUMÉRICO con letras · apodo) en:
//        (a) buscador GENERAL de animales, (b) CRÍA AL PIE (LinkCalfPrompt / classifyCalfQuery),
//        (c/d) MANIOBRA MANUAL "sin bastón" (identificar.tsx). IDU.4.3/4.4/4.6/4.7/4.8.
//   E2 — ALTA y PARTO sin NINGUNA caravana → el animal / la cría persiste (sin 23514). IDU.1.4.
//   E3 — NOMBRE como HERO: rodeo con apodo → apodo grande + caravana secundaria; rodeo sin apodo →
//        caravana grande. IDU.6.2/6.3/6.4.
//   E4 — WARNING-SOFT de apodo duplicado en el MISMO campo (aparece, NO bloquea); mismo apodo en OTRO
//        campo → sin aviso. IDU.5.4/5.5/5.7.
//
// Import de test/expect desde ./helpers/fixtures (NO @playwright/test): sin el shim de env el bundle con
// PowerSync bootea en blanco y el login timeoutea (memoria reference_e2e_fixtures_import).

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedRodeo,
  seedAnimal,
  seedCustomField,
  seedCustomAttribute,
  setUserPhone,
  waitForServerAnimalProfile,
  waitForServerBirth,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, waitForMisCampos, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────

let tagCounter = 0;
/** Caravana electrónica FDX-B de 15 dígitos, única por corrida (unique global de tag_electronic). */
function makeTag(): string {
  tagCounter += 1;
  return `982${Date.now()}${tagCounter}`.replace(/\D/g, '').slice(0, 15).padEnd(15, '0');
}

/** Habilita el campo `apodo` (data_key='apodo') en un rodeo (fd per-est propiedad/text + rodeo_data_config
 *  enabled), espejo del seed 0119 + el opt-in del owner por rodeo. Devuelve el field_definition_id. */
async function enableApodo(establishmentId: string, rodeoId: string): Promise<string> {
  return seedCustomField(establishmentId, rodeoId, {
    label: 'Nombre/Apodo',
    dataKey: 'apodo',
    dataType: 'propiedad',
    uiComponent: 'text',
  });
}

/** Camina el wizard del alta desde el paso 2 (sexo) hasta el paso 4 (datos). Con 1 rodeo el paso 1
 *  auto-avanza. Selectores por a11y (buttonA11y emite role=button + aria-label en web). */
async function walkWizardToData(page: Page, opts: { sex: 'Macho' | 'Hembra'; categoryName: string }) {
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Sexo ${opts.sex}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.categoryName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ─── BLE mock (para la maniobra manual — copia de maniobra-identify.spec.ts) ────────────────

async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

async function connectBaston(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
}

/** Arranca una jornada de manga real desde el wizard, elige el primer rodeo + Pesaje, y aterriza en la
 *  identificación con el bastón mock CONECTADO (hero "Acercá el bastón al animal"). */
async function startManiobraSession(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await connectBaston(page);
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Expande la entrada manual "sin bastón" + busca por el texto dado (idv/apodo/eid). */
async function manualSearch(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  await page.getByLabel('Número o caravana visual').fill(query);
  await page.getByRole('button', { name: 'Buscar animal' }).click();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// E1 — Búsqueda unificada por los 3 identificadores (IDU.4)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// E1a — buscador GENERAL: electrónica EXACTA (15 díg) · idv ALFANUMÉRICO (con letras) · apodo.
test('E1a (IDU.4.3/4.4/4.6): buscador general encuentra por electrónica exacta, idv alfanumérico y apodo', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('idu-search');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Búsqueda');
  const apodoFd = await enableApodo(establishmentId, rodeoId);

  // 3 animales, cada uno buscable por un canal distinto:
  const tag = makeTag();
  await seedAnimal(establishmentId, rodeoId, { idv: 'TAGME01', tag, sex: 'female' }); // electrónica exacta
  await seedAnimal(establishmentId, rodeoId, { idv: 'VAQ12AB', sex: 'female' }); // idv ALFANUMÉRICO (letras)
  const apodoProfile = await seedAnimal(establishmentId, rodeoId, { sex: 'female' }); // solo apodo
  await seedCustomAttribute(apodoProfile, apodoFd, 'Manchada');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Los 3 bajaron por la stream (visibles en la lista = ya sincronizaron al SQLite local). El animal de
  // solo-apodo tiene el APODO como hero (rodeo usa apodo + tiene apodo).
  await expect(page.getByText('TAGME01', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('VAQ12AB', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Manchada', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });

  // (1) Electrónica EXACTA (15 díg) → encuentra el animal T (su fila lleva el idv "TAGME01" en el a11y).
  await search.fill(tag);
  await expect(page.getByRole('button', { name: /TAGME01/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/No encontramos/)).toHaveCount(0);

  // (2) idv ALFANUMÉRICO (con letras) — el canal clave del delta: antes el idv solo-dígitos se encontraba;
  //     ahora un idv con letras también. Buscamos por un fragmento alfanumérico "VAQ12" (substring).
  await search.fill('VAQ12');
  await expect(page.getByRole('button', { name: /VAQ12AB/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/No encontramos/)).toHaveCount(0);

  // (3) APODO → encuentra el animal de solo-apodo por su Nombre/Apodo (custom_attributes, IDU.4.4).
  await search.fill('Manchada');
  await expect(page.getByRole('button', { name: /Manchada/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/No encontramos/)).toHaveCount(0);
});

// E1b — CRÍA AL PIE (LinkCalfPrompt / classifyCalfQuery): idv alfanumérico · apodo · electrónica (eid).
test('E1b (IDU.4.7): cría al pie encuentra por idv alfanumérico, apodo y electrónica (eid)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('idu-calf');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CríaPie');
  const apodoFd = await enableApodo(establishmentId, rodeoId);

  // 3 terneros candidatos (sin madre), uno por canal.
  const tag = makeTag();
  await seedAnimal(establishmentId, rodeoId, { idv: 'TERNE07', tag, sex: 'male' }); // eid → edit
  await seedAnimal(establishmentId, rodeoId, { idv: 'CR12XY', sex: 'female' }); // idv alfanumérico
  const apodoProfile = await seedAnimal(establishmentId, rodeoId, { sex: 'female' }); // solo apodo
  await seedCustomAttribute(apodoProfile, apodoFd, 'Lucera');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  // Esperar a que los 3 bajen al SQLite local (el find-or-create de la cría al pie lee LOCAL).
  await expect(page.getByText('TERNE07', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('CR12XY', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Lucera', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Alta de una MADRE (multípara CON cría al pie) → tras "Crear animal" se abre el LinkCalfPrompt.
  // Entramos al alta por el no-match del buscador (idv precargado read-only; la madre es un animal aparte).
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await search.fill('MADRE99');
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // El prompt de vinculación de cría al pie.
  const sheet = page.getByTestId('link-calf-sheet');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  const calfField = page.getByLabel('Caravana del ternero', { exact: true });

  // (1) idv ALFANUMÉRICO → encontrado (searchAnimals por idv). La card muestra "Ternero encontrado" + idv.
  await calfField.fill('CR12XY');
  await page.getByTestId('link-calf-search').click();
  await expect(sheet.getByText('Ternero encontrado', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByText('CR12XY', { exact: true })).toBeVisible();

  // Volver a la búsqueda (← Cambiar caravana) → (2) APODO → encontrado (searchAnimals por apodo). El animal
  // de solo-apodo se rotula por su apodo "Lucera" (idv/tag ausentes).
  await page.getByTestId('link-calf-back').click();
  await calfField.fill('Lucera');
  await page.getByTestId('link-calf-search').click();
  await expect(sheet.getByText('Ternero encontrado', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByText('Lucera', { exact: true })).toBeVisible();

  // Volver → (3) ELECTRÓNICA (eid, 15 díg) → classifyCalfQuery lo ve como `eid` → lookupByTag (edit) →
  // encontrado. El animal T se rotula por su idv "TERNE07".
  await page.getByTestId('link-calf-back').click();
  await calfField.fill(tag);
  await page.getByTestId('link-calf-search').click();
  await expect(sheet.getByText('Ternero encontrado', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByText('TERNE07', { exact: true })).toBeVisible();
});

// E1c — MANIOBRA MANUAL "sin bastón": idv ALFANUMÉRICO (con letras) → encontrado → auto-avance.
test('E1c (IDU.4.8): maniobra manual encuentra por idv ALFANUMÉRICO → auto-avance a la carga', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('idu-man-idv');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo ManIdv');
  await seedAnimal(establishmentId, rodeoId, { idv: 'VQ88AB', sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText('VQ88AB', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startManiobraSession(page);

  // Entrada manual por el idv alfanumérico exacto → 1 match → found → flash "Lectura recibida" → auto-avance.
  await manualSearch(page, 'VQ88AB');
  await expect(page.getByText('Lectura recibida', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
});

// E1d — MANIOBRA MANUAL "sin bastón": APODO → encontrado → auto-avance.
test('E1d (IDU.4.8): maniobra manual encuentra por APODO → auto-avance a la carga', async ({ page }) => {
  test.setTimeout(120_000);
  const user = await createTestUser('idu-man-apodo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo ManApodo');
  const apodoFd = await enableApodo(establishmentId, rodeoId);
  const profileId = await seedAnimal(establishmentId, rodeoId, { sex: 'female' });
  await seedCustomAttribute(profileId, apodoFd, 'Pinta');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText('Pinta', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startManiobraSession(page);

  // Entrada manual por el APODO → searchAnimals canal apodo → 1 match → found → auto-avance.
  await manualSearch(page, 'Pinta');
  await expect(page.getByText('Lectura recibida', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// E2 — Alta y parto SIN NINGUNA caravana → persiste sin 23514 (IDU.1.4)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Oráculo server-side (E2 alta): el establecimiento fresco tiene EXACTAMENTE 1 perfil activo tras el alta
 *  en blanco. Devuelve { id, idv, animal_id }. Pollea (el alta drena por la outbox online). */
async function waitForSoleProfile(
  establishmentId: string,
): Promise<{ id: string; idv: string | null; animal_id: string }> {
  for (let i = 0; i < 30; i++) {
    const { data, error } = await admin
      .from('animal_profiles')
      .select('id, idv, animal_id')
      .eq('establishment_id', establishmentId)
      .is('deleted_at', null);
    if (error) throw new Error(`waitForSoleProfile: ${error.message}`);
    if (data && data.length >= 1) {
      return data[0] as { id: string; idv: string | null; animal_id: string };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `waitForSoleProfile(${establishmentId}): el alta en blanco NUNCA llegó al server (30 intentos) — o se ` +
      `perdió (23514 del trigger de completitud, que este delta dropea) o no drenó la outbox.`,
  );
}

// E2a — alta SIN ninguna caravana (tag/idv/apodo ausentes) → persiste, sin error.
test('E2a (IDU.1.4): alta SIN ninguna caravana → el animal persiste (idv/tag NULL, sin 23514)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('idu-alta-blanco');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo AltaBlanco');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // NO cargamos ningún identificador (tag/idv ausentes; el rodeo no habilita apodo). Crear directo.
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Aterriza en la ficha (create OK, sin guard "al menos un identificador"): "Identificación" + "Historial".
  // El hero es el fallback "Animal" (sin ningún identificador de usuario, IDU.6.6).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Historial', { exact: true })).toBeVisible();
  await expect(page.getByText('Animal', { exact: true }).first()).toBeVisible();

  // ORÁCULO server: el perfil aterrizó de verdad con idv NULL y el animal con tag NULL (persiste sin 23514).
  const profile = await waitForSoleProfile(establishmentId);
  expect(profile.idv).toBeNull();
  const { data: animal, error } = await admin
    .from('animals')
    .select('tag_electronic')
    .eq('id', profile.animal_id)
    .maybeSingle();
  if (error) throw new Error(`E2a read animal: ${error.message}`);
  expect(animal?.tag_electronic ?? null).toBeNull();
});

// E2b — parto SIN ninguna caravana en la cría → la cría persiste (birth_calves creado, sin 23514).
test('E2b (IDU.1.4): parto de una cría SIN caravana → la cría persiste (birth_calves, sin 23514)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('idu-parto-blanco');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo PartoBlanco');
  const motherIdv = `MAD${Date.now().toString().slice(-6)}`;
  const motherProfileId = await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Abrimos la ficha de la madre.
  const motherRow = page.getByRole('button', { name: new RegExp(motherIdv) }).first();
  await expect(motherRow).toBeVisible({ timeout: 30_000 });
  await motherRow.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // La madre (vaquillona) no figura preñada → el parto dispara un AVISO SUAVE (window.confirm "registrar
  // el parto igual"). Lo aceptamos: el parto no se bloquea (es prueba de preñez).
  page.on('dialog', (d) => void d.accept());

  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Parto', exact: true }).click();

  // Un solo ternero (default). Elegimos SOLO el sexo; NO cargamos idv ni bastoneamos tag → cría sin caravana.
  await expect(page.getByText('Ternero 1', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Macho', exact: true }).first().click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // De vuelta en la ficha de la madre: el nodo "Parto" en el timeline (el evento se persistió).
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Parto', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ORÁCULO server: register_birth creó el evento + 1 cría (birth_calves es server-only; una cría existe
  // SOLO si la RPC corrió → el both-null NO fue rechazado con 23514, y la cría persiste con idv/tag NULL).
  const birth = await waitForServerBirth(motherProfileId, { expectedCalves: 1 });
  expect(birth.calfCount).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// E3 — Nombre como identificador HERO (IDU.6)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('E3 (IDU.6.2/6.3/6.4): apodo hero en rodeo con apodo (caravana secundaria) vs caravana hero sin apodo', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('idu-hero');
  await setUserPhone(user.id, '1123456789');
  // Un mismo campo con DOS rodeos: uno con apodo habilitado, otro sin.
  const { establishmentId, rodeoId: rodeoConApodo } = await seedEstablishmentWithRodeo(user.id, 'Campo Hero');
  const rodeoSinApodo = await seedRodeo(establishmentId, 'Rodeo sin nombre');
  const apodoFd = await enableApodo(establishmentId, rodeoConApodo); // solo el rodeo 1 usa apodo

  // Animal A1 (rodeo CON apodo): idv "AA111" + apodo "Manchada" → hero = apodo, caravana secundaria.
  const a1 = await seedAnimal(establishmentId, rodeoConApodo, { idv: 'AA111', sex: 'female' });
  await seedCustomAttribute(a1, apodoFd, 'Manchada');
  // Animal A2 (rodeo SIN apodo): idv "AA222", sin apodo → hero = idv (caravana grande).
  await seedAnimal(establishmentId, rodeoSinApodo, { idv: 'AA222', sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // ── LISTA (contraste apodo-hero vs caravana-hero, robusto: ambas filas en la misma lista) ──
  // A1: el HERO es el apodo "Manchada"; su fila lo lleva en el a11y label (category, hero, …). La caravana
  // idv baja a la línea secundaria muted "· #AA111" (formato EXCLUSIVO del hero-por-apodo).
  await expect(page.getByRole('button', { name: /Manchada/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('· #AA111', { exact: true })).toBeVisible();
  // A2: hero = idv "AA222" (rodeo sin apodo → caravana GRANDE, sin secundaria). Al ser HERO, NO existe la
  // línea secundaria "· #AA222" (diagnóstico determinístico: si el apodo fuera hero, aparecería).
  await expect(page.getByRole('button', { name: /AA222/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('· #AA222', { exact: true })).toHaveCount(0);

  // ── FICHA A1 (apodo hero) ──
  // La lista queda MONTADA (hidden) detrás de la ficha pusheada → filtramos por `visible:true` para apuntar
  // a la ficha y no a la fila oculta de la lista (memoria reference_e2e_sheet_no_nav_oracle).
  await page.getByRole('button', { name: /Manchada/ }).first().click();
  await expect(page.getByText('Identificación', { exact: true }).filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  // Hero grande = apodo; caravana secundaria muted "#AA111" (SIN el "· " de la lista → exact distingue del
  // "· #AA111" de la fila de la lista que queda montada detrás). Es el diagnóstico de que el apodo es hero.
  await expect(page.getByText('#AA111', { exact: true })).toBeVisible();
  await expect(page.getByText('Manchada', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('Datos personalizados', { exact: true }).filter({ visible: true }).first()).toBeVisible();

  // Volver a la lista → abrir A2.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.getByRole('button', { name: /AA222/ }).first().click();
  await expect(page.getByText('Identificación', { exact: true }).filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  // Hero = idv "AA222" (caravana grande). La Identificación muestra la caravana visual "AA222" como valor.
  await expect(page.getByText('AA222', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('Datos del animal', { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// E4 — Warning-soft de apodo duplicado por campo (IDU.5.4/5.5/5.7)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('E4 (IDU.5.4/5.5/5.7): aviso de apodo duplicado en el MISMO campo, no bloquea; otro campo → sin aviso', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('idu-warn');
  await setUserPhone(user.id, '1123456789');
  // Campo ACTIVO (field1) + otro campo (field2), ambos con apodo habilitado.
  const field1 = await seedEstablishmentWithRodeo(user.id, 'Campo WarnActivo');
  const field2 = await seedEstablishmentWithRodeo(user.id, 'Campo WarnVecino');
  const apodoFd1 = await enableApodo(field1.establishmentId, field1.rodeoId);
  const apodoFd2 = await enableApodo(field2.establishmentId, field2.rodeoId);

  // field1: un animal con apodo "Pinta" (el que el nuevo va a duplicar). field2: un animal con apodo
  // "Manchada" (existe en OTRO campo → NO debe avisar en field1, IDU.5.7).
  const x1 = await seedAnimal(field1.establishmentId, field1.rodeoId, { idv: 'FX001', sex: 'female' });
  await seedCustomAttribute(x1, apodoFd1, 'Pinta');
  const y2 = await seedAnimal(field2.establishmentId, field2.rodeoId, { idv: 'FY001', sex: 'female' });
  await seedCustomAttribute(y2, apodoFd2, 'Manchada');

  await page.goto('/');
  await signIn(page, user);
  // Con 2 campos aterriza en "Mis campos" → elegimos el campo ACTIVO (field1).
  await waitForMisCampos(page);
  await page.getByRole('button', { name: /Campo WarnActivo/ }).first().click();
  await waitForHome(page);
  await gotoAnimales(page);
  // Esperamos a que el apodo "Pinta" de field1 baje al SQLite local (el warning lee LOCAL, por campo).
  await expect(page.getByText('Pinta', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Entramos al alta de un animal NUEVO por el no-match del buscador (idv precargado; el apodo va aparte).
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await search.fill('NUEVO01');
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // "Datos personalizados" → el input del apodo (custom-prop-text).
  await expect(page.getByText('Datos personalizados', { exact: true })).toBeVisible({ timeout: 20_000 });
  const apodoInput = page.getByTestId('custom-prop-text').first();
  const warning = page.getByText('Ya hay otro animal con ese nombre en este campo.', { exact: true });

  // (1) "Pinta" ya lo usa OTRO animal de ESTE campo (field1) → aparece el aviso (IDU.5.4).
  await apodoInput.fill('Pinta');
  await expect(warning).toBeVisible({ timeout: 15_000 });

  // (2) "Manchada" existe SOLO en el OTRO campo (field2) → NO aparece el aviso (IDU.5.7, warning por campo).
  await apodoInput.fill('Manchada');
  await expect(warning).toHaveCount(0);

  // (3) Volvemos a "Pinta" (aviso de nuevo) y GUARDAMOS igual → el aviso NO bloquea (IDU.5.5). Aterriza en
  //     la ficha (create OK).
  await apodoInput.fill('Pinta');
  await expect(warning).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ORÁCULO server: el animal nuevo (idv precargado "NUEVO01") persistió pese al apodo duplicado.
  await waitForServerAnimalProfile(field1.establishmentId, { idv: 'NUEVO01' });
});
