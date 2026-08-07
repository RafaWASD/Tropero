// e2e/qa-fixes-datos.spec.ts — red de regresión END-TO-END de los tres 🔴 de CORRECCIÓN DE DATOS que el QA
// de maniobras encontró en device (A07, 2026-08-06 — ver `progress/qa_maniobras-device.md`).
//
//   A.1 — tipear la caravana COMO ESTÁ IMPRESA (`PERF-00500`) no encontraba al animal y la app ofrecía
//         "Dar de alta" (= animal duplicado con la historia partida en dos). Dos superficies medidas por el
//         QA (manga + buscador global) y una TERCERA que encontró esta unidad (buscador dentro del rodeo).
//   A.2 — todo lo cargado después de las 21:00 (AR, UTC−3) quedaba fechado MAÑANA, porque "hoy" se derivaba
//         con `toISOString()` (UTC) hacia una columna Postgres `date`. El dato entraba corrido.
//   A.5 — con dos cargas del MISMO día, el "valor vigente" de peso/condición se decidía por UUID (~50/50).
//
// Corre contra el export estático de prod (:8099) + Supabase remoto + PowerSync. Import de test/expect desde
// ./helpers/fixtures (NO @playwright/test): sin el shim de env el bundle con PowerSync bootea en blanco.

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales, gotoRodeoGroup } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** El identificador del bug, con el sufijo de corrida para no chocar entre runs. Conserva el GUION. */
const conGuion = (n: string): string => `PERF-${n}${RUN_TAG.slice(-4)}`;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A.1 — buscador GLOBAL (tab Animales)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('A.1 buscador global: tipear la caravana CON GUION encuentra al animal (no ofrece darlo de alta)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('a1-global');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo A1');

  const idv = conGuion('00500'); // el idv GUARDADO conserva el guion, como en el campo real
  // SEÑUELO: un animal que NO matchea ninguno de los términos de abajo. Es lo que vuelve OBSERVABLE que la
  // búsqueda corrió — sin él, el test pasa MIRANDO LA LISTA SIN FILTRAR (la fila del target ya está en
  // pantalla antes de tipear, así que `toBeVisible` resuelve al instante y el debounce ni llegó a correr).
  // Medido: la primera versión de este test daba VERDE con el bug entero puesto. Con el señuelo, la
  // secuencia es "el señuelo desaparece ⇒ la lista YA muestra resultados de búsqueda" y recién ahí se
  // pregunta por el target.
  const senuelo = `ZZZ-99${RUN_TAG.slice(-4)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'male' });
  await seedAnimal(establishmentId, rodeoId, { idv: senuelo, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(senuelo, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  const senueloRow = page.getByText(senuelo, { exact: true });
  const targetRow = page.getByRole('button', { name: new RegExp(escapeRe(idv)) });

  // Las formas de tipearlo que el QA midió en ROJO en el A07 (todas devolvían "Animal nuevo"), + las 2
  // que ya andaban (control de no-regresión: los términos que caen de UN lado del guion).
  const numero = `00500${RUN_TAG.slice(-4)}`;
  const casos = [
    idv, //                  la caravana COMPLETA, tal cual está impresa  ← el caso que reportó el QA
    idv.toLowerCase(), //    la misma en minúsculas
    idv.slice(0, 6), //      'PERF-0'    — fragmento que CRUZA el guion
    idv.slice(0, 8), //      'PERF-005'  — idem
    idv.slice(3, 8), //      'F-005'     — idem, arrancando en medio del prefijo
    'PERF', //               de un solo lado del guion (ya andaba)
    numero.slice(0, 5), //   '00500'     — del otro lado (ya andaba)
  ];

  for (const termino of casos) {
    // (0) Limpiar y esperar a que la lista COMPLETA vuelva: así el estado observado en (1) es de ESTA
    //     búsqueda y no el que dejó la anterior.
    await search.fill('');
    await expect(senueloRow.first()).toBeVisible({ timeout: 20_000 });

    await search.fill(termino);
    // (1) La lista ya está filtrada (el señuelo se fue) ⇒ lo que se vea ahora son resultados de búsqueda.
    await expect(senueloRow, `«${termino}» tiene que filtrar la lista`).toHaveCount(0, { timeout: 20_000 });
    // (2) …y el animal buscado está entre ellos.
    await expect(
      targetRow.first(),
      `tipear «${termino}» tiene que encontrar a ${idv}`,
    ).toBeVisible({ timeout: 20_000 });
    // (3) Y NO puede ofrecer el alta: ese botón es el que produce el animal duplicado.
    await expect(page.getByRole('button', { name: 'Dar de alta este animal' })).toHaveCount(0);
  }

  // CONTROL NEGATIVO: la búsqueda no se volvió permisiva de más. Un identificador que NO existe sigue
  // dando el no-match (si esto fallara, el fix habría convertido el buscador en un comodín).
  await search.fill(conGuion('99999'));
  await expect(page.getByText(/No encontramos/)).toBeVisible({ timeout: 20_000 });
  await expect(targetRow).toHaveCount(0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A.1 — buscador DENTRO DEL RODEO (la 3ra superficie: `searchGroupAnimals`, mismo motor)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('A.1 buscador del rodeo (3ra superficie): la caravana con guion también encuentra ahí', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('a1-grupo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo A1G');

  const idv = conGuion('00700');
  // Señuelo (mismo rol que en el test de arriba): que el señuelo se vaya es lo que PRUEBA que la lista ya
  // muestra resultados de búsqueda; sin eso, el `toBeVisible` del target lo resuelve la lista sin filtrar.
  const senuelo = `ZZZ-11${RUN_TAG.slice(-4)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });
  await seedAnimal(establishmentId, rodeoId, { idv: senuelo, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoRodeoGroup(page, `${RUN_TAG} Rodeo general`);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(senuelo, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Ojo: el buscador del GRUPO tiene su propio label (no es el de la tab Animales).
  const search = page.getByLabel('Buscar animal en el grupo por caravana o número', { exact: true });
  await search.fill(idv);
  // (1) la lista se filtró de verdad…
  await expect(page.getByText(senuelo, { exact: true })).toHaveCount(0, { timeout: 20_000 });
  // (2) …y el animal buscado sigue ahí (con el bug, la búsqueda quedaba vacía).
  await expect(page.getByRole('button', { name: new RegExp(escapeRe(idv)) }).first()).toBeVisible({
    timeout: 20_000,
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A.1 — MANGA (entrada manual de la jornada). La superficie donde el duplicado hace más daño.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('A.1 manga: la entrada manual con la caravana con guion carga sobre el animal, no ofrece el alta', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const user = await createTestUser('a1-manga');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo A1M');

  const idv = conGuion('03000');
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'male' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  // Esperar a que el animal baje al SQLite local (la manga busca LOCAL, offline-first).
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startPesajeSession(page);

  // Entrada manual con el identificador TAL CUAL está impreso.
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  await page.getByLabel('Número o caravana visual').fill(idv);
  await page.getByRole('button', { name: 'Buscar animal' }).click();

  // Match EXACTO → auto-avance a la carga rápida (el camino rápido de manga se conserva).
  await expect(page.getByTestId('weight-display')).toBeVisible({ timeout: 20_000 });
  // Y en ningún momento apareció el hero de "Animal nuevo" (el que lleva al duplicado).
  await expect(page.getByText('Animal nuevo', { exact: true })).toHaveCount(0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A.5 — dos cargas del MISMO día: el "Estado actual" muestra la ÚLTIMA
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('A.5 ficha: con dos cargas del MISMO día, "Estado actual" muestra la última (no la vieja)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('a5-ficha');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo A5');

  const idv = `A5${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  // EL CASO MEDIDO EN EL A07 (`PERF-02001`): 2,25 en la 1ra pasada y 3,75 en la 2da, el MISMO día.
  // Los UUIDs están elegidos para que el evento VIEJO tenga el id lexicográficamente MAYOR: con el
  // desempate por `eventId` (el bug) la ficha mostraba 2,25 — exactamente lo que el QA vio en la ficha.
  const hoy = todayLocalIso();
  const VIEJO = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const NUEVO = '00000000-0000-4000-8000-000000000001';
  await insertScore(profileId, VIEJO, hoy, 2.25, '2026-08-06T22:13:00Z');
  await insertScore(profileId, NUEVO, hoy, 3.75, '2026-08-06T22:40:00Z');
  // Y lo mismo con el peso (la otra rama que compartía el desempate roto).
  await insertWeight(profileId, VIEJO, hoy, 312, '2026-08-06T22:13:00Z');
  await insertWeight(profileId, NUEVO, hoy, 318, '2026-08-06T22:40:00Z');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  const row = page.getByRole('button', { name: new RegExp(escapeRe(idv)) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();

  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible({ timeout: 30_000 });
  // El riel conserva las dos cargas (el historial nunca perdió nada) — lo que estaba mal era el vigente.
  await expect(page.getByText('Historial', { exact: true })).toBeVisible();

  // ⚠️ El valor solo NO sirve de oráculo: el riel muestra las DOS cargas, así que "2,25 / 5" y "312 kg"
  // están en la pantalla legítimamente. Lo que distingue al vigente es que la fila de "Estado actual" lo
  // muestra CON SU FECHA (`<valor> · <fecha>`), y el riel no. Por eso se matchea con el separador.
  // Peso vigente = el segundo (318, no 312).
  await expect(page.getByText(/318 kg · /)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/312 kg · /)).toHaveCount(0);
  // Condición vigente = 3,75 (coma decimal es-AR), NO el 2,25 viejo que mostraba el bug.
  await expect(page.getByText(/3,75 \/ 5 · /)).toBeVisible();
  await expect(page.getByText(/2,25 \/ 5 · /)).toHaveCount(0);
  // Y las dos cargas SIGUEN en el historial (el fix es del vigente, no borra nada).
  await expect(page.getByText('2,25 / 5', { exact: true })).toHaveCount(1);
  await expect(page.getByText('3,75 / 5', { exact: true })).toHaveCount(1);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A.2 — "hoy" es el día LOCAL, no el UTC. El reloj de la página se congela a las 22:54 (AR).
// ─────────────────────────────────────────────────────────────────────────────────────────────

// El huso se FIJA en el contexto del browser (no se hereda del host): sin esto el test mediría el
// desfasaje de la máquina que lo corre, que en otra podría ser UTC y dejaría el caso vacío.
test.describe(() => {
  test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

  test('A.2 vacunación masiva a las 22:54: el evento queda fechado HOY, no mañana', async ({ page }) => {
    test.setTimeout(180_000);
    const user = await createTestUser('a2-fecha');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo A2');
    const profileId = await seedAnimal(establishmentId, rodeoId, {
      idv: `A2${RUN_TAG.slice(-6)}`,
      sex: 'female',
    });

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await gotoRodeoGroup(page, `${RUN_TAG} Rodeo general`);

    // ── El instante del bug ──────────────────────────────────────────────────────────────────
    // 22:54 hora de Argentina (la hora exacta del A07 cuando el QA lo midió) = 01:54 UTC del día
    // SIGUIENTE. Se usa `setFixedTime` y NO `install`: `Date` queda congelado pero los timers siguen
    // corriendo, así que ni PowerSync ni el sync se frenan.
    const LOCAL_2254 = new Date('2026-08-07T01:54:00.000Z'); // = 2026-08-06 22:54 en AR (UTC−3)
    await page.clock.setFixedTime(LOCAL_2254);

    await page.getByRole('button', { name: 'Vacunar', exact: true }).click();
    const productInput = page.getByLabel('Producto', { exact: true });
    await expect(productInput).toBeVisible({ timeout: 30_000 });
    await productInput.fill('Aftosa-A2');
    // El copy es singular-aware (1 animal → "1 evento sobre 1 animal", no la forma plural).
    await expect(page.getByText('1 evento sobre 1 animal', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Vacunar 1 animal', exact: true }).click();
    await expect(page.getByText('1 animal listo', { exact: true })).toBeVisible({ timeout: 30_000 });

    // Descongelamos ANTES de esperar la subida: la fecha del evento ya se computó y se escribió local.
    await page.clock.setFixedTime(new Date());

    // ── EL ORÁCULO: la fila REAL en el server ───────────────────────────────────────────────
    // Con el bug, `event_date` valía `2026-08-07` (el día UTC). Es una columna `date`, así que el dato
    // entraba corrido: no era un problema de display.
    const eventDate = await waitForSanitaryEventDate(profileId, 'Aftosa-A2');
    expect(eventDate, 'la vacunación de las 22:54 se fecha el día LOCAL, no el UTC').toBe('2026-08-06');
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `AAAA-MM-DD` local de hoy (para sembrar dos eventos "del mismo día" desde el runner). */
function todayLocalIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function insertScore(
  profileId: string,
  id: string,
  eventDate: string,
  score: number,
  createdAt: string,
): Promise<void> {
  const { error } = await admin
    .from('condition_score_events')
    .insert({ id, animal_profile_id: profileId, score, event_date: eventDate, created_at: createdAt });
  if (error) throw new Error(`insertScore: ${error.message}`);
}

async function insertWeight(
  profileId: string,
  id: string,
  weightDate: string,
  weightKg: number,
  createdAt: string,
): Promise<void> {
  const { error } = await admin.from('weight_events').insert({
    id,
    animal_profile_id: profileId,
    weight_kg: weightKg,
    weight_date: weightDate,
    created_at: createdAt,
  });
  if (error) throw new Error(`insertWeight: ${error.message}`);
}

/** Pollea `sanitary_events` hasta que la vacunación suba, y devuelve su `event_date` (columna `date`). */
async function waitForSanitaryEventDate(profileId: string, productName: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const { data } = await admin
      .from('sanitary_events')
      .select('event_date')
      .eq('animal_profile_id', profileId)
      .eq('product_name', productName)
      .is('deleted_at', null)
      .limit(1);
    if (data && data.length > 0) return String(data[0].event_date);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`la vacunación "${productName}" no llegó al server en 60 s`);
}

/** Arranca una jornada de manga con Pesaje sobre el único rodeo y aterriza en la identificación. */
async function startPesajeSession(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('button', { name: /Elegir rodeo / })
    .first()
    .click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Sin bastón conectado la pantalla ofrece la entrada manual, que es justo el camino de este test.
  await expect(page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' })).toBeVisible({
    timeout: 20_000,
  });
}
