// e2e/asignar-caravanas-sin-transporte.spec.ts — red de regresión del ESTADO VACÍO de la asignación
// masiva de caravanas (spec 09 chunk dedup opción B, RD5.1/RD5.2) frente al bugfix 2026-07-29.
//
// EL BUG (misma clase que el chip del header, encontrado por el reviewer en el fix-loop): la
// `BulkTagAssignmentScreen` tiene UNA sola entrada de datos —`useBleStickListener`— y NINGUNA entrada
// manual. Sin transporte instanciado (el Android de hoy: el adapter SPP es Fase 4) no puede llegar jamás
// un tag, así que la pantalla queda congelada para siempre en su estado vacío… que decía "Bastoneá para
// empezar / Pasá el bastón por la caravana del animal": le pedía al operario lo único que su dispositivo
// no puede hacer. Y está a DOS TAPS del tab "Más". (Cuando se escribió esto, `/baston` era deep-link-only
// y esta pantalla era por lejos la más accesible de las dos; desde el 2026-08-05 "Más" también tiene una
// fila a `/baston`, así que ahora están a la par — lo que no cambia es que este vacío mentía.)
//
// EL FIX: el vacío DICE LA VERDAD. La fila de "Más" NO se oculta (a diferencia del chip): el chip es un
// indicador de estado que sin transporte no informa nada; esto es una funcionalidad REAL que existe y
// funciona con el bastón — ocultarla la volvería indescubrible. Ver `utils/bulk-assign-empty.ts`.
//
// CÓMO SE REPRODUCE EN WEB (sin device): marca secundaria `__RAFAQ_BLE_E2E_MANUAL__` → el provider monta
// `mode='manual'` → `instantiateTransport('manual')` devuelve null, EXACTAMENTE el estado del Android de
// hoy. Con solo `__RAFAQ_BLE_E2E__` monta el MockAdapter → transporte presente (paridad con web real).
//
// ORÁCULOS (los dos lados, para que el test no pueda pasar por la razón equivocada):
//   - SIN transporte → la fila SIGUE en "Más" (que ocultarla era la alternativa descartada), la pantalla
//     abre, dice la frase canónica y NO dice "Bastoneá para empezar".
//   - CON transporte → el vacío queda EXACTAMENTE como antes ("Bastoneá para empezar") y NO aparece el
//     aviso de "no disponible". Sin este lado, "decir siempre que no hay bastón" pasaría el primero.

import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** La frase canónica de "sin bastón" — la MISMA que usan `identificar` y el `TagScanSheet`. */
const SIN_BASTON = 'El bastón no está disponible en este dispositivo';
/** El copy de la espera normal de un bastoneo (el que NO debe aparecer sin transporte). */
const ESPERANDO = 'Bastoneá para empezar';
/** a11y label de la fila de entrada en el tab "Más" (`mas.tsx`, sección "Campo activo"). */
const ROW_NAME = 'Asignar caravanas electrónicas en masa con el bastón';

/**
 * Recorre la ruta REAL del operario: tab "Más" → fila "Asignar caravanas en masa" → la pantalla. Es a
 * propósito y no un `page.goto('/asignar-caravanas')`: la fila es parte del veredicto (la decisión fue
 * NO ocultarla), así que el test tiene que fallar también si alguien la esconde.
 */
async function gotoAsignarCaravanasDesdeMas(page: Page): Promise<void> {
  const row = page.getByRole('button', { name: ROW_NAME });
  await gotoTab(page, 'Más', row);
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.getByText('Asignar caravanas', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (a) SIN TRANSPORTE → la pantalla dice la verdad en vez de pedir un bastoneo imposible.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(a) RD5.2: SIN transporte, el vacío de la masiva dice la verdad (y la fila de "Más" sigue)', async ({
  page,
}) => {
  const user = await createTestUser('bulknt');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo BulkNT');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoAsignarCaravanasDesdeMas(page);

  // ORÁCULO 1 (el bug): el vacío YA NO pide bastonear en un dispositivo donde no puede llegar un tag.
  await expect(page.getByText(ESPERANDO, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Pasá el bastón por la caravana/)).toHaveCount(0);
  // ORÁCULO 2 (la verdad, con la MISMA frase que las otras superficies): el operario aprende algo cierto.
  await expect(page.getByText(SIN_BASTON, { exact: true })).toBeVisible();
  // ORÁCULO 3 (la salida real): apunta a la ficha del animal, que SÍ carga el EID a mano sin transporte.
  await expect(page.getByText(/desde la ficha de cada animal/)).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (b) CON TRANSPORTE → el vacío queda como antes (web / Fase 4). Contrafáctico de (a).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(b) RD5.2: CON transporte, el vacío sigue siendo "Bastoneá para empezar" (web no se toca)', async ({
  page,
}) => {
  const user = await createTestUser('bulkct');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo BulkCT');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoAsignarCaravanasDesdeMas(page);

  await expect(page.getByText(ESPERANDO, { exact: true })).toBeVisible();
  await expect(page.getByText(/Pasá el bastón por la caravana/)).toBeVisible();
  // Y NO aparece el aviso de "no disponible": con bastón sería mentira.
  await expect(page.getByText(SIN_BASTON, { exact: true })).toHaveCount(0);
});
