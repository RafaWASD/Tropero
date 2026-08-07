// e2e/ficha-tacto.spec.ts — red E2E del TACTO desde la ficha, animal por animal
// (delta spec 02 `ficha-categoria-tacto`, TCT.28 → RTF.3/RTF.4/RTF.5/RTF.6/RTF.7/RTF.2.3/RTF.9).
//
// Corre contra el export ESTÁTICO de prod (:8099) + Supabase remoto + PowerSync. WEB TÁCTIL REAL
// (`hasTouch: true` + `tap()`, memoria `reference_rn_web_pitfalls`): con viewport desktop Playwright emula
// click y enmascara los defectos táctiles.
//
// Cubre:
//   (a) vaquillona SIN veredicto → CTA "Tacto de aptitud" → APTA → vuelve a la ficha → "Aptitud
//       reproductiva: Apta" + el CTA YA NO ESTÁ (RTF.7.5) + el evento en el historial;
//   (b) hembra SERVIDA (multípara, rodeo con 3 meses de servicio) → CTA "Tacto de preñez" → PREÑADA →
//       sub-paso de TAMAÑO → "Estado reproductivo: Preñada (cuerpo)" + el badge del hero transiciona;
//   (b-bis) el link "Fue otro día" (P3) despliega el campo de fecha y el evento queda fechado EN EL PASADO
//       (verificado contra el SERVER, no contra la pantalla);
//   (c) un MACHO y una TERNERA no muestran ningún CTA de tacto (RTF.2.3);
//   (d) "Agregar evento" YA NO ofrece "Tacto" y sigue ofreciendo Servicio / Parto / Aborto (RTF.9).
//
// Datos namespaced (RUN_TAG); cleanup en afterAll + global-teardown. Aserta SOLO sobre datos propios.

import { test, expect } from './helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedReproductiveServiceEvent,
  setUserPhone,
  cleanupAll,
  todayLocalIso,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test.afterAll(async () => {
  await cleanupAll();
});

async function openFicha(page: import('@playwright/test').Page, idv: string): Promise<void> {
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.tap();
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/**
 * Oráculo SERVER del tacto SUELTO: pollea `reproductive_events` hasta encontrar el evento del perfil con el
 * `event_type` esperado y **`session_id` NULL** (RTF.5.3: la ficha NO crea jornada). Devuelve la fila para
 * poder asertar además su `event_date` (RTF.6).
 */
async function waitForServerLooseEvent(
  profileId: string,
  eventType: 'tacto' | 'tacto_vaquillona',
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ id: string; eventDate: string; pregnancyStatus: string | null; heiferFitness: string | null }> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 2000;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await admin
      .from('reproductive_events')
      .select('id, event_type, event_date, pregnancy_status, heifer_fitness, session_id')
      .eq('animal_profile_id', profileId)
      .eq('event_type', eventType)
      .is('session_id', null)
      .is('deleted_at', null)
      .limit(1);
    if (error) throw new Error(`waitForServerLooseEvent: ${error.message}`);
    if (data && data.length > 0) {
      return {
        id: data[0].id as string,
        eventDate: data[0].event_date as string,
        pregnancyStatus: (data[0].pregnancy_status as string | null) ?? null,
        heiferFitness: (data[0].heifer_fitness as string | null) ?? null,
      };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `waitForServerLooseEvent(${profileId}, ${eventType}): el evento NUNCA llegó al server con session_id ` +
      `NULL (${tries} intentos).`,
  );
}

test('vaquillona sin veredicto: CTA "Tacto de aptitud" → APTA → la ficha muestra "Apta" y el CTA desaparece', async ({
  page,
}) => {
  const user = await createTestUser('tactoapt');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo TactoApt');
  // Vaquillona sin ningún evento reproductivo → reproStatus 'unknown' → corresponde el tacto de APTITUD.
  // El data_key `tacto_vaquillona` nace ENABLED por default en cría (0018) → la capa rodeo pasa.
  const idv = `APT${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2024-01-10',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  // La ficha ofrece EXACTAMENTE un CTA, y es el de aptitud (RTF.2.1: nunca dos).
  await expect(page.getByText('Aptitud reproductiva', { exact: true })).toBeVisible();
  await expect(page.getByTestId('ficha-tacto-cta')).toHaveCount(1);
  const cta = page.getByRole('button', { name: 'Tacto de aptitud', exact: true });
  await expect(cta).toBeVisible();
  await cta.tap();

  // Pantalla de captura: identidad del animal + el paso de la manga, SIN rediseñar (3 bloques gigantes).
  await expect(page.getByTestId('tacto-hero')).toHaveText(idv, { timeout: 20_000 });
  await expect(page.getByTestId('fitness-block-APTA')).toBeVisible();
  await expect(page.getByTestId('fitness-block-NO APTA')).toBeVisible();
  await expect(page.getByTestId('fitness-block-DIFERIDA')).toBeVisible();
  // Por default el tacto es de HOY: el campo de fecha NO está a la vista, solo el link (RTF.6.1 / P3).
  await expect(page.getByTestId('tacto-fue-otro-dia')).toBeVisible();
  await expect(page.getByTestId('tacto-fecha')).toHaveCount(0);

  await page.getByTestId('fitness-block-APTA').tap();

  // Vuelve a la ficha (RTF.7.1) y el estado se actualizó OFFLINE por el espejo (RTF.7.2).
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Apta', { exact: true }).filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  // RTF.7.5: el CTA deja de aplicar solo (la vaquillona ya es apta) — sin intervención del usuario.
  // ANCLA (misma leccion que el bloqueante 2): "Marcar como CUT" sale del MISMO `rodeoGating` que el CTA, asi
  // que su presencia prueba que el gating YA resolvio tras volver; sin eso, el `toHaveCount(0)` mediria t=0.
  await expect(page.getByRole('button', { name: 'Marcar como CUT (descarte)', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('ficha-tacto-cta')).toHaveCount(0, { timeout: 20_000 });

  // El evento aterrizó en el server SIN session_id (RTF.5.2/RTF.5.3) y fechado HOY (RTF.6.1).
  const ev = await waitForServerLooseEvent(profileId, 'tacto_vaquillona');
  expect(ev.heiferFitness).toBe('apta');
  expect(ev.eventDate).toBe(todayLocalIso());

  // Y NO se creó ninguna jornada por el camino (RTF.5.3).
  const { count } = await admin
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('establishment_id', establishmentId);
  expect(count ?? 0).toBe(0);
});

test('hembra servida: CTA "Tacto de preñez" → PREÑADA → tamaño → "Preñada (cuerpo)" en la ficha', async ({
  page,
}) => {
  const user = await createTestUser('tactopre');
  await setUserPhone(user.id, '1123456789');
  // 3 meses de servicio → el sub-paso de TAMAÑO ofrece Cabeza / Cuerpo / Cola (RTF.4.3).
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo TactoPre', {
    serviceMonths: [10, 11, 12],
  });
  const idv = `PRE${RUN_TAG.slice(-6)}`;
  // `categoryOverride: true` es NECESARIO: con override=false el espejo C6 muestra la categoria DERIVADA
  // (esta hembra no tiene eventos → 'vaquillona'), y una vaquillona sin veredicto pide APTITUD, no prenez.
  // Con la categoria FIJADA en multipara, la ficha la ve como PROBADA (servida) → corresponde el de prenez.
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'multipara',
    categoryOverride: true,
    birthDate: '2020-05-01',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  await expect(page.getByTestId('ficha-tacto-cta')).toHaveCount(1);
  await page.getByRole('button', { name: 'Tacto de preñez', exact: true }).tap();

  // Sub-paso 1: PREÑADA / VACÍA (los dos bloques gigantes de la manga, sin rediseñar).
  await expect(page.getByTestId('tacto-hero')).toHaveText(idv, { timeout: 20_000 });
  const prenada = page.getByRole('button', { name: 'PREÑADA', exact: true });
  await expect(prenada).toBeVisible();
  await expect(page.getByRole('button', { name: 'VACÍA', exact: true })).toBeVisible();
  await prenada.tap();

  // Sub-paso 2: TAMAÑO (3 buckets del rodeo). Elegimos CUERPO → pregnancy_status 'medium'.
  const cuerpo = page.getByRole('button', { name: 'CUERPO', exact: true });
  await expect(cuerpo).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'CABEZA', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'COLA', exact: true })).toBeVisible();
  await cuerpo.tap();

  // De vuelta en la ficha: "Estado reproductivo → Preñada (cuerpo) · …" (RTF.7.2).
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Preñada \(cuerpo\) · /)).toBeVisible({ timeout: 20_000 });

  const ev = await waitForServerLooseEvent(profileId, 'tacto');
  expect(ev.pregnancyStatus).toBe('medium');
  expect(ev.eventDate).toBe(todayLocalIso());

  // RTF.7.4 — la categoría está FIJADA a mano (`category_override = true`): un tacto POSITIVO NO la mueve,
  // ni en el espejo ni en el server. Es la consecuencia que la confirmación de RCM.4.2 anticipa, y la razón
  // por la que las dos capacidades del delta tienen que ser consistentes entre sí.
  // `.filter({visible:true})`: la pantalla de la LISTA queda montada aria-hidden detrás (Expo Router web)
  // con su propio badge de categoría → sin el filtro, `.first()` puede resolver a un nodo oculto.
  await expect(
    page.getByLabel(/^Categoría Multípara/).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel(/Categoría Vaquillona pre[ñn]ada/i)).toHaveCount(0);
  const { data: prof, error: profErr } = await admin
    .from('animal_profiles')
    .select('category_override, categories_by_system!inner(code)')
    .eq('id', profileId)
    .single();
  if (profErr) throw new Error(`read profile: ${profErr.message}`);
  expect(prof.category_override).toBe(true);
  expect((prof as unknown as { categories_by_system: { code: string } }).categories_by_system.code).toBe(
    'multipara',
  );
});

test('OFFLINE: fijar la categoría y cargar un tacto SIN RED; al reconectar los dos aterrizan', async ({
  page,
}) => {
  const user = await createTestUser('tactooff');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo TactoOff');
  const idv = `OFF${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2023-01-10',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  // El animal tiene que estar en el SQLite local ANTES de cortar la red (igual que maniobra-offline).
  await openFicha(page, idv);

  // ── SIN RED (equivale a DevTools → Network → Offline). Todo lo que sigue corre offline. ──
  await page.context().setOffline(true);

  // (1) TACTO de aptitud offline: write local plano → la ficha refleja "Apta" al instante (RTF.10.2).
  await page.getByRole('button', { name: 'Tacto de aptitud', exact: true }).tap();
  await expect(page.getByTestId('fitness-block-APTA')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('fitness-block-APTA').tap();
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Apta', { exact: true }).filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  // (2) FIJAR la categoría offline: UPDATE local plano → el badge y la card cambian al instante (RCM.9.2).
  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('category-option-multipara').tap();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).tap();
  await expect(page.getByTestId('category-sheet')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Multípara', { timeout: 15_000 });
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // ── RECONEXIÓN → ORÁCULO SERVER: los dos writes aterrizan (el evento sin session_id + el pin). ──
  await page.context().setOffline(false);
  const ev = await waitForServerLooseEvent(profileId, 'tacto_vaquillona', { tries: 40 });
  expect(ev.heiferFitness).toBe('apta');

  let landed: { override: boolean; code: string } | null = null;
  for (let i = 0; i < 40; i++) {
    const { data, error } = await admin
      .from('animal_profiles')
      .select('category_override, categories_by_system!inner(code)')
      .eq('id', profileId)
      .single();
    if (error) throw new Error(`read profile: ${error.message}`);
    const row = { override: data.category_override as boolean, code: (data as unknown as { categories_by_system: { code: string } }).categories_by_system.code };
    landed = row;
    if (row.override === true && row.code === 'multipara') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  expect(landed).toEqual({ override: true, code: 'multipara' });
});

test('"Fue otro día": el link despliega la fecha y el tacto queda fechado en el PASADO', async ({ page }) => {
  const user = await createTestUser('tactofecha');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo TactoFecha');
  const idv = `FEC${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2024-01-10',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  await page.getByRole('button', { name: 'Tacto de aptitud', exact: true }).tap();
  await expect(page.getByTestId('tacto-hero')).toHaveText(idv, { timeout: 20_000 });

  // P3: el link secundario despliega el campo de fecha (que arranca en HOY).
  await page.getByTestId('tacto-fue-otro-dia').tap();
  const dateField = page.getByTestId('tacto-fecha');
  await expect(dateField).toBeVisible();
  await expect(dateField).toHaveValue(todayLocalIso());

  // Fechamos 10 días atrás y cargamos el veredicto.
  const past = new Date();
  past.setDate(past.getDate() - 10);
  const pastIso = todayLocalIso(past);
  await dateField.fill(pastIso);
  await page.getByTestId('fitness-block-DIFERIDA').tap();

  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible({ timeout: 20_000 });
  const ev = await waitForServerLooseEvent(profileId, 'tacto_vaquillona');
  expect(ev.heiferFitness).toBe('diferida');
  expect(ev.eventDate).toBe(pastIso);
});

// -- RTF.2.3 - a quien NO se le ofrece tacto. --------------------------------------------------------
//
// ESTE TEST NACIO CIEGO Y ASI QUEDO REESCRITO (bloqueante 2 del review). La version anterior era
// `expect(cta).toHaveCount(0)` apenas montada la ficha, y pasaba en VERDE **con la capa ANIMAL del gating
// borrada**. El motivo es el mismo que ya habia cazado el test de CUT: el CTA depende de `rodeoGating`, una
// lectura ASINCRONA; en t=0 el mapa esta vacio => NO hay CTA para NADIE => la ausencia matchea al instante y
// no distingue "el gating funciona" de "todavia no cargo".
//
// -- EL ANCLA DETERMINISTICA -------------------------------------------------------------------------
// "Marcar como CUT (descarte)" sale del MISMO mapa (`rodeoGating['dientes']`) y se ofrece a toda hembra
// ACTIVA que NO sea ternera ni CUT (`canMarkCut`). O sea: su presencia PRUEBA que el gating del rodeo ya
// resolvio en ESTA ficha. Con eso, la ausencia del CTA pasa a ser una afirmacion sobre la capa ANIMAL y no
// sobre el timing. Por eso el caso principal es una **vaquillona YA APTA** (que RTF.2.3 nombra
// explicitamente) y no la ternera: a la ternera `canMarkCut` la excluye, asi que no tiene ancla propia.
//
// -- LO QUE ESTE TEST *NO* VE, dicho de frente -------------------------------------------------------
// El caso del MACHO **no discrimina la capa animal**: la ficha resuelve el gating SOLO para hembras
// (`rodeoGating` queda `{}` en un macho), asi que un macho esta protegido por DOS vias independientes y el
// test no puede decir cual lo salvo. Se conserva porque cubre el requisito de producto ("un toro no se
// tacta"), no como oraculo del gating.
test('sin CTA de tacto: vaquillona APTA, ternera y macho (RTF.2.3) — con ancla del gating', async ({
  page,
}) => {
  const user = await createTestUser('tactonocta');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo TactoNoCta');
  const maleIdv = `MAC${RUN_TAG.slice(-6)}`;
  const calfIdv = `TER${RUN_TAG.slice(-6)}`;
  const aptaIdv = `APT${RUN_TAG.slice(-6)}`;
  const ctrlIdv = `CTR${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: maleIdv, sex: 'male', categoryCode: 'torito' });
  // `birthDate` OBLIGATORIA para que sea una ternera DE VERDAD. Sin fecha, el espejo C6 deriva el default
  // conservador de la rama hembra (**vaquillona**) y el animal deja de ser el caso que el test dice cubrir:
  // pasa a merecer el CTA de aptitud. La version anterior de este test tenia justamente ese fixture, y
  // pasaba en verde por la carrera de t=0 — dos ceguera superpuestas. Lo caza esta misma aserción, ahora
  // que espera a que el gating resuelva.
  await seedAnimal(establishmentId, rodeoId, {
    idv: calfIdv,
    sex: 'female',
    categoryCode: 'ternera',
    birthDate: todayLocalIso(new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)),
  });
  // Vaquillona con veredicto 'apta' -> `needsFitnessEvaluation` false y no esta servida => NINGUN tacto le
  // corresponde. Es el caso de RTF.2.3 que SI discrimina la capa animal (con ella rota, le tocaria prenez).
  const aptaProfileId = await seedAnimal(establishmentId, rodeoId, {
    idv: aptaIdv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2024-01-10',
  });
  const { error: aptaErr } = await admin.from('reproductive_events').insert({
    animal_profile_id: aptaProfileId,
    event_type: 'tacto_vaquillona',
    heifer_fitness: 'apta',
    event_date: todayLocalIso(),
  });
  if (aptaErr) throw new Error(`seed tacto_vaquillona apta: ${aptaErr.message}`);
  // CONTROL DE NO-VACUIDAD: una vaquillona SIN veredicto, en el MISMO rodeo, que SI tiene que ofrecer CTA.
  // Sin este control, "no aparece el CTA" podria significar que el CTA no funciona en ningun lado.
  await seedAnimal(establishmentId, rodeoId, {
    idv: ctrlIdv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2024-01-10',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // -- CONTROL: en este rodeo el CTA SI aparece cuando corresponde. --
  await openFicha(page, ctrlIdv);
  await expect(page.getByRole('button', { name: 'Tacto de aptitud', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Volver', exact: true }).first().tap();

  // -- (1) VAQUILLONA YA APTA - el caso con ancla deterministica. --
  await gotoAnimales(page);
  await openFicha(page, aptaIdv);
  // El ancla: sale del MISMO `rodeoGating` que el CTA => si esta, el gating YA resolvio en esta ficha.
  await expect(page.getByRole('button', { name: 'Marcar como CUT (descarte)', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('ficha-tacto-cta')).toHaveCount(0);
  // Y su estado es el esperado (no es que la ficha este a medio cargar).
  await expect(page.getByText('Apta', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Volver', exact: true }).first().tap();

  // -- (2) TERNERA - sin ancla propia (`canMarkCut` la excluye): settle explicito. --
  await gotoAnimales(page);
  await openFicha(page, calfIdv);
  // El control de arriba ya probo que el CTA aparece en este rodeo; aca esperamos a que el gating de ESTA
  // ficha resuelva antes de afirmar la ausencia (si no, se mide t=0 y el test no ve nada).
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('ficha-tacto-cta')).toHaveCount(0);
  await page.getByRole('button', { name: 'Volver', exact: true }).first().tap();

  // -- (3) MACHO - cubre el requisito, NO el gating (ver la cabecera del test). --
  await gotoAnimales(page);
  await openFicha(page, maleIdv);
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('ficha-tacto-cta')).toHaveCount(0);
});

test('RTF.9: "Agregar evento" ya NO ofrece "Tacto" y sigue ofreciendo Servicio / Parto / Aborto', async ({
  page,
}) => {
  const user = await createTestUser('tactoretiro');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo TactoRetiro');
  const idv = `RET${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2023-01-10',
  });
  // La hembra está SERVIDA (evento `service`) → antes del delta, la card "Tacto" del wizard le ofrecía el
  // tacto igual que a una ternera. Ahora la única entrada es el CTA de la ficha (RTF.9.3).
  // `natural` (el default) y NO `ai`: el trigger de gating 0054 exige el data_key `inseminacion` para un
  // service+ai, y ese data_key nace DESHABILITADO en cria (0018). El servicio natural no gatea.
  await seedReproductiveServiceEvent(profileId);

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  await page.getByRole('button', { name: 'Agregar evento', exact: true }).tap();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });

  // La sección Reproductivo SIGUE existiendo, con sus otras tres cards…
  await expect(page.getByText('Reproductivo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Servicio', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Parto', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aborto', exact: true })).toBeVisible();
  // …pero la card "Tacto" (la que ofrecía el tacto de preñez a CUALQUIER hembra, sin gating) NO está.
  await expect(page.getByRole('button', { name: 'Tacto', exact: true })).toHaveCount(0);
  // Ni tampoco su subtítulo.
  await expect(page.getByText('Diagnóstico de preñez', { exact: true })).toHaveCount(0);
});
