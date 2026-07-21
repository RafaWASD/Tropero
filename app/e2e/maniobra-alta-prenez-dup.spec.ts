// e2e/maniobra-alta-prenez-dup.spec.ts — U3 (docs/plan-mejoras-2026-07-20.md): preñez duplicada al dar de
// alta una hembra DURANTE una maniobra de tacto.
//
// El bug: el alta guiada preguntaba la preñez (evento `tacto` post-create) sin saber que la jornada activa
// va a tactar a ese MISMO animal → dos eventos `tacto` el mismo día (dato duplicado en la carga). El fix:
// si el alta se lanzó desde una jornada que MIDE PREÑEZ (incluye la maniobra `tacto`), se SUPRIME el campo
// de preñez del alta — la maniobra es la dueña de ese dato. Fuera de una jornada de tacto, el alta sigue
// preguntando preñez como siempre.
//
// Se llega igual que maniobra-identify.spec.ts (M2.2): arrancar una jornada → identificar una caravana
// DESCONOCIDA a mano → "Dar de alta" → wizard de /crear-animal con el sessionId de la jornada.
//
// Cobertura:
//   (A) jornada de TACTO → alta de una Multípara (categoría que normalmente pide preñez) → el campo de
//       preñez NO aparece; el resto del paso 4 (condición / cría al pie) SÍ (fix quirúrgico). Se completa
//       la maniobra (PREÑADA → CABEZA) y el oráculo server-side confirma EXACTAMENTE 1 evento `tacto`.
//   (B) CONTROL — jornada SIN tacto (solo Pesaje) → alta de una Multípara → el campo de preñez SÍ aparece
//       (estar en una maniobra no suprime; solo una jornada de tacto lo hace).

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  waitForServerAnimalProfile,
  waitForServerTactoWithSession,
  countServerTactoEvents,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

/** Conecta el bastón mock (el hero adaptativo pasa de ConnectHero a ScanHero — camino conectado). */
async function connectBaston(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
}

/**
 * Arranca una jornada eligiendo el (único) rodeo del campo + las maniobras dadas (por su testID pool-row-*),
 * en ese orden → "Arrancar jornada" → identificación con el hero de escaneo listo.
 */
async function startSession(page: Page, maneuvers: readonly string[]): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // El pool con las maniobras prueba que el rodeo_data_config ya está en el SQLite local + dwell para que
  // el sync se asiente (mismo patrón que maniobra-carga.spec.ts: la fila recién sembrada tarda en propagar).
  await expect(page.getByTestId(`pool-row-${maneuvers[0]}`)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  for (const m of maneuvers) {
    await page.getByTestId(`pool-row-${m}`).click();
  }
  await expect(page.getByTestId(`selected-row-${maneuvers.length - 1}`)).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await connectBaston(page);
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

/** Expande la entrada manual + busca por el texto dado (idv). Reusa el idiom de maniobra-identify.spec.ts. */
async function manualSearch(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  await page.getByLabel('Número o caravana visual').fill(query);
  await page.getByRole('button', { name: 'Buscar animal' }).click();
}

/**
 * Desde la identificación: buscar una caravana DESCONOCIDA a mano → "Dar de alta" → wizard con el idv
 * precargado → sexo Hembra → categoría → paso 4 (datos). Deja la pantalla en "Datos del animal" para
 * asertar la (in)visibilidad del campo de preñez ANTES de crear.
 */
async function altaFromManga(page: Page, opts: { idv: string; category: string }): Promise<void> {
  await manualSearch(page, opts.idv);
  await expect(page.getByText('Animal nuevo', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Dar de alta', exact: true }).click();
  await expect(page.getByText(`Creando: ${opts.idv}`, { exact: true })).toBeVisible({ timeout: 20_000 });

  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.category}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── (A) jornada de TACTO → el alta NO pregunta preñez + el server queda con 1 solo tacto (no duplicado). ──
test('(A) alta de una hembra durante una jornada de tacto → NO pregunta preñez → 1 solo tacto en el server', async ({ page }) => {
  test.setTimeout(150_000); // el drenado de la upload queue + los oráculos server pueden tardar.
  const user = await createTestUser('u3-tacto');
  await setUserPhone(user.id, '1123456789');
  // serviceMonths [10,11,12] → el TactoStep ofrece el sub-paso de tamaño (CABEZA/CUERPO/COLA), camino
  // determinista y ya probado en maniobra-carga.spec.ts. La Multípara recién creada es PROVEN → el tacto le aplica.
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo U3 Tacto', {
    serviceMonths: [10, 11, 12],
  });
  const idv = `9001${Date.now().toString().slice(-6)}`;

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Jornada de TACTO (única maniobra → "· 1 de 1" en la carga del nuevo animal).
  await startSession(page, ['tacto']);

  await altaFromManga(page, { idv, category: 'Multípara' });

  // CLAVE del fix (U3): la Multípara normalmente pide preñez en el alta; acá NO, porque la jornada la
  // va a tactar. El resto del paso 4 (condición + cría al pie) SÍ aparece → el fix es quirúrgico (solo preñez).
  await expect(page.getByText('Estado de preñez (opcional)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Condición corporal (opcional, 1 a 5)', { exact: true })).toBeVisible();
  await expect(page.getByText('Cría al pie (opcional)', { exact: true })).toBeVisible();
  // NEGATIVA extra: tampoco el botón de un estado de preñez (p. ej. "Preñez Cabeza") está montado.
  await expect(page.getByRole('button', { name: 'Preñez Cabeza', exact: true })).toHaveCount(0);

  // Crear → en contexto maniobra CONTINÚA a la carga del nuevo animal (/maniobra/carga), sin re-identificarlo.
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // La carga del nuevo animal: única maniobra Tacto → "· 1 de 1" + el paso PREÑADA/VACÍA.
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('PREÑADA', { exact: true })).toBeVisible();

  // Completar el ÚNICO tacto (el de la maniobra): PREÑADA → CABEZA (large) → resumen → confirmar.
  await page.getByRole('button', { name: 'PREÑADA', exact: true }).click();
  await expect(page.getByText('CABEZA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'CABEZA', exact: true }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Preñada · Cabeza', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ORÁCULO server-side: el animal llegó + su ÚNICO tacto es el de la maniobra (large, con session_id).
  const profile = await waitForServerAnimalProfile(establishmentId, { idv });
  await waitForServerTactoWithSession(profile.id, 'large');
  // Y NO hay duplicado: exactamente 1 evento tacto para ese animal (con el bug eran 2 — alta + maniobra).
  expect(await countServerTactoEvents(profile.id)).toBe(1);
});

// ── (B) CONTROL — jornada SIN tacto (solo Pesaje) → el alta SIGUE preguntando preñez (no se suprime). ──
test('(B) control: alta durante una jornada SIN tacto (solo Pesaje) → SÍ pregunta preñez', async ({ page }) => {
  const user = await createTestUser('u3-control');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo U3 Control');
  const idv = `9002${Date.now().toString().slice(-6)}`;

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Jornada SIN tacto (solo Pesaje) → estar en una maniobra NO debe suprimir la preñez del alta.
  await startSession(page, ['pesaje']);

  await altaFromManga(page, { idv, category: 'Multípara' });

  // El campo de preñez SIGUE apareciendo (el fix solo lo suprime cuando la jornada incluye `tacto`).
  await expect(page.getByText('Estado de preñez (opcional)', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preñez Cabeza', exact: true })).toBeVisible();
});
