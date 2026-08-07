// e2e/captures/qa-fixes-datos.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// de la unidad «los tres 🔴 de corrección de datos del QA de maniobras en device».
//
// ── ALCANCE, DICHO DE FRENTE ─────────────────────────────────────────────────────────────────────────
// Esta unidad NO tocó una sola línea de JSX, ni un token, ni un layout: los tres arreglos son de LÓGICA
// (qué se busca, qué fecha se escribe, cuál de dos eventos es el vigente). Pero SÍ cambia lo que el
// operario VE en tres pantallas, y ahí el cambio es de los que se vetan mirando: donde antes decía
// "Animal nuevo · Dalo de alta" ahora aparece el animal, y donde antes decía "2,25" ahora dice "3,75".
// Por eso las capturas son de ESTADOS DE CONTENIDO, no de layout, y cada una viene con su PAR de
// contraste (lo que se veía con el bug) donde el par se puede producir sin re-buildear.
//
// Shots a __shots__/qa-fixes-datos/:
//   01 — Buscador global, la caravana tipeada TAL CUAL ESTÁ IMPRESA (`PERF-00500…`) → el animal aparece.
//        Es el estado que el QA no pudo obtener en el A07: ahí esta misma pantalla mostraba 04.
//   02 — Buscador global, un fragmento que CRUZA el guion (`PERF-005`) → sigue encontrándolo. Prueba que
//        el arreglo no es un caso especial del string completo.
//   03 — Buscador global, la misma caravana en MINÚSCULAS → también.
//   04 — CONTRASTE (el estado del bug, provocado a propósito con un identificador que NO existe): el
//        cartel "No encontramos…" + el botón **"Dar de alta este animal"**. Eso —sobre un animal que SÍ
//        existe— es lo que producía el duplicado. Se lee CONTRA 01.
//   05 — Manga, entrada manual abierta con la caravana con guion tipeada, antes de buscar.
//   06 — Manga, resultado: la carga rápida de Pesaje sobre el animal correcto (auto-avance). Con el bug,
//        acá salía el hero "Animal nuevo".
//   07 — Ficha, "Estado actual" con las DOS cargas del mismo día ya hechas: peso 318 y condición 3,75
//        (los valores NUEVOS). Con el bug la condición mostraba 2,25.
//   08 — Ficha, el HISTORIAL: las dos cargas siguen ahí (2,25 y 3,75). Es el control de que el arreglo
//        cambia cuál es el VIGENTE y no borra nada. Se lee junto a 07.
//
// ⚠️ La fecha (A.2) NO tiene captura: el bug era el VALOR de una columna `date` del server, y la pantalla
// de la vacunación masiva no muestra la fecha en ninguna parte. Su oráculo es la fila real en la DB
// (`e2e/qa-fixes-datos.spec.ts`, que la lee con service_role). Decirlo acá es parte del entregable: una
// captura de esa pantalla se vería idéntica con el bug puesto y sería un verde mentiroso.
//
// Viewport mobile 412×915 (lo hereda de playwright.config). NO corre en `pnpm e2e` (es un `.capture.ts`):
//   pnpm exec playwright test e2e/captures/qa-fixes-datos.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'qa-fixes-datos');

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test('capturas: búsqueda por caravana impresa · manga · estado actual del mismo día', async ({ page }) => {
  test.setTimeout(240_000);
  const user = await createTestUser('cap-qafix');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Capturas');

  const idv = `PERF-00500${RUN_TAG.slice(-4)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });
  // Un par de vecinos para que la lista no se vea vacía en las capturas.
  await seedAnimal(establishmentId, rodeoId, { idv: `PERF-00501${RUN_TAG.slice(-4)}`, sex: 'female' });
  await seedAnimal(establishmentId, rodeoId, { idv: `ZZZ-990${RUN_TAG.slice(-4)}`, sex: 'male' });

  // Las dos cargas del MISMO día del hallazgo A.5 (el viejo con el UUID más alto: el que ganaba con el bug).
  const hoy = todayLocalIso();
  await insertScore(profileId, 'ffffffff-ffff-4fff-8fff-ffffffffffff', hoy, 2.25, '2026-08-06T22:13:00Z');
  await insertScore(profileId, '00000000-0000-4000-8000-000000000001', hoy, 3.75, '2026-08-06T22:40:00Z');
  await insertWeight(profileId, 'ffffffff-ffff-4fff-8fff-fffffffffffe', hoy, 312, '2026-08-06T22:13:00Z');
  await insertWeight(profileId, '00000000-0000-4000-8000-000000000002', hoy, 318, '2026-08-06T22:40:00Z');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  const senuelo = page.getByText(`ZZZ-990${RUN_TAG.slice(-4)}`, { exact: true });

  // 01 — la caravana COMPLETA, como está impresa.
  await search.fill(idv);
  await expect(senuelo).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, '01-buscador-caravana-completa-con-guion');

  // 02 — un fragmento que cruza el guion.
  await search.fill('');
  await expect(senuelo.first()).toBeVisible({ timeout: 20_000 });
  await search.fill(idv.slice(0, 8));
  await expect(senuelo).toHaveCount(0, { timeout: 20_000 });
  await shot(page, '02-buscador-fragmento-cruza-el-guion');

  // 03 — la misma caravana en minúsculas.
  await search.fill('');
  await expect(senuelo.first()).toBeVisible({ timeout: 20_000 });
  await search.fill(idv.toLowerCase());
  await expect(senuelo).toHaveCount(0, { timeout: 20_000 });
  await shot(page, '03-buscador-minusculas');

  // 04 — CONTRASTE: el estado que el bug producía sobre un animal EXISTENTE. Acá se provoca con uno que
  //      de verdad no existe, porque con el fix puesto ya no hay forma de sacarle esta cara al animal real.
  await search.fill(`PERF-99999${RUN_TAG.slice(-4)}`);
  await expect(page.getByRole('button', { name: 'Dar de alta este animal' })).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, '04-contraste-no-encontramos-y-dar-de-alta');

  // ── Manga ────────────────────────────────────────────────────────────────────────────────────
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

  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  await page.getByLabel('Número o caravana visual').fill(idv);
  // 05 — la caravana tipeada tal cual, todavía sin buscar.
  await shot(page, '05-manga-entrada-manual-tipeada');

  await page.getByRole('button', { name: 'Buscar animal' }).click();
  await expect(page.getByTestId('weight-display')).toBeVisible({ timeout: 20_000 });
  // 06 — el auto-avance a la carga rápida sobre el animal correcto.
  await shot(page, '06-manga-carga-rapida-sobre-el-animal');

  // ── Ficha ────────────────────────────────────────────────────────────────────────────────────
  await page.goto('/');
  await waitForHome(page);
  await gotoAnimales(page);
  const row = page.getByRole('button', { name: new RegExp(escapeRe(idv)) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/318 kg · /)).toBeVisible({ timeout: 20_000 });
  // ⚠️ `toBeVisible` de Playwright NO implica "dentro del viewport": la sección vive abajo de todo en una
  // ficha larga y la primera versión de esta captura salió mostrando el encabezado. Hay que scrollear.
  await page.getByText('Estado actual', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText(/318 kg · /)).toBeInViewport();
  await expect(page.getByText(/3,75 \/ 5 · /)).toBeInViewport();
  // 07 — "Estado actual" con los valores NUEVOS de las dos cargas del mismo día.
  await shot(page, '07-ficha-estado-actual-valores-nuevos');

  // 08 — el historial, con las dos cargas intactas. Se scrollea hasta que la fila vieja esté a la vista.
  await page.getByText('2,25 / 5', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText('2,25 / 5', { exact: true })).toBeInViewport({ timeout: 20_000 });
  await expect(page.getByText('3,75 / 5', { exact: true })).toBeInViewport();
  await shot(page, '08-ficha-historial-conserva-las-dos-cargas');
});

// ─── Helpers (espejo de los de e2e/qa-fixes-datos.spec.ts) ────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
