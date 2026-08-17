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
// CÓMO SE REPRODUCE EN WEB (sin device): marca secundaria `__MITROPERO_BLE_E2E_MANUAL__` → el provider monta
// `mode='manual'` → `instantiateTransport('manual')` devuelve null, EXACTAMENTE el estado del Android de
// hoy. Con solo `__MITROPERO_BLE_E2E__` monta el MockAdapter → transporte presente (paridad con web real).
//
// ── 🔴-3 (barrido de edge cases del Bluetooth, 2026-08-06): LA DIMENSIÓN QUE FALTABA ─────────────────
// El corte original miraba SOLO `hasTransport`. Con el adapter SPP de la Fase 4 eso es `true` en TODO
// Android, aunque el bastón esté apagado, sin emparejar o nunca conectado — y ahí la pantalla volvía a
// decir "Bastoneá para empezar" en un teléfono donde bastonear no hace nada. Medido en device (A07 +
// ESP32): tras agotarse la cadena de reconexión (~132 s) el peón bastonea 20 animales y no pasa NADA, en
// la ÚNICA pantalla BLE-only SIN entrada manual, sin chip en el header y con el pill global auto-oculto
// justo en 'off'. Ahora el vacío distingue TRES estados y el desconectado TRAE UNA SALIDA (CTA a /baston).
//
// ORÁCULOS (los tres lados, para que el test no pueda pasar por la razón equivocada):
//   - SIN transporte → la fila SIGUE en "Más" (que ocultarla era la alternativa descartada), la pantalla
//     abre, dice la frase canónica y NO dice "Bastoneá para empezar".
//   - CON transporte y DESCONECTADO → dice que el bastón no está conectado, NO pide bastonear, NO usa la
//     frase de "no disponible" (el bastón existe), y ofrece el CTA que LLEVA a `/baston`.
//   - CON transporte y CONECTADO → el vacío queda EXACTAMENTE como antes ("Bastoneá para empezar") y no
//     aparece ningún aviso. Sin este lado, "decir siempre que hay un problema" pasaría los dos primeros.

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
/** El copy de la espera normal de un bastoneo (el que solo vale con el bastón CONECTADO). */
const ESPERANDO = 'Bastoneá para empezar';
/** El título del estado 🔴-3: hay bastón en este dispositivo, pero no está conectado. */
const DESCONECTADO = 'El bastón no está conectado';
/** El CTA de salida del estado desconectado (lleva a `/baston`). */
const CTA_CONECTAR = 'Conectar el bastón';
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
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E_MANUAL__ = true;
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
  // ORÁCULO 4 (🔴-3): sin transporte NO se ofrece "conectar" — no hay nada que conectar en este
  // dispositivo, y un CTA ahí sería otra promesa vacía (el mismo error que el chip que se ocultó).
  await expect(page.getByRole('button', { name: CTA_CONECTAR })).toHaveCount(0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (b) 🔴-3 · CON TRANSPORTE PERO DESCONECTADO → el pozo mudo pasa a decir la verdad y traer una salida.
//     Reproducción en web sin device: con `__MITROPERO_BLE_E2E__` el provider monta el MockAdapter, que
//     arranca DESCONECTADO — exactamente el Android con el bastón apagado (hay transporte, no hay link).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(b) 🔴-3: con transporte pero DESCONECTADO, el vacío lo dice y el CTA lleva a /baston', async ({
  page,
}) => {
  const user = await createTestUser('bulkdc');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo BulkDC');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoAsignarCaravanasDesdeMas(page);

  // ORÁCULO 1 (el bug): NO le pide bastonear a un peón cuyo bastón no está conectado.
  await expect(page.getByText(ESPERANDO, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Pasá el bastón por la caravana/)).toHaveCount(0);
  // ORÁCULO 2 (qué pasa): lo dice sin jerga… y NO lo confunde con "no existe en este dispositivo".
  await expect(page.getByText(DESCONECTADO, { exact: true })).toBeVisible();
  await expect(page.getByText(SIN_BASTON, { exact: true })).toHaveCount(0);
  // ORÁCULO 3 (qué tocar): el CTA existe Y NAVEGA de verdad a la pantalla del bastón. Un estado que
  // describe el problema sin llevar a ningún lado sigue siendo un pozo.
  const cta = page.getByRole('button', { name: CTA_CONECTAR });
  await expect(cta).toBeVisible();
  await cta.click();
  // Ancla por testID y no por el texto "Bastón": la pantalla de origen queda MONTADA detrás (Stack) y el
  // tab "Más" también nombra el bastón → un getByText matchearía de más.
  // (No se asevera la AUSENCIA del copy de origen: en el Stack la pantalla anterior queda montada detrás,
  // así que su texto sigue en el DOM. El oráculo de "navegó" es la presencia de algo EXCLUSIVO del destino.)
  await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 20_000 });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (c) CON TRANSPORTE Y CONECTADO → el vacío queda como siempre. Contrafáctico de (a) y (b).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('(c) RD5.2: con el bastón CONECTADO, el vacío sigue siendo "Bastoneá para empezar"', async ({
  page,
}) => {
  const user = await createTestUser('bulkct');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo BulkCT');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__MITROPERO_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // El bastón conectado ES la precondición de este estado (antes del 🔴-3 el test no lo pedía y estaba
  // asertando "Bastoneá para empezar" sobre un mock desconectado — o sea, sobre el propio bug).
  await page.evaluate(() => {
    const h = (window as unknown as { __mitroperoBle?: { connectMock: () => void } }).__mitroperoBle;
    if (!h) throw new Error('window.__mitroperoBle no está disponible (¿se montó el BleE2EBridge bajo el flag?)');
    h.connectMock();
  });

  await gotoAsignarCaravanasDesdeMas(page);

  await expect(page.getByText(ESPERANDO, { exact: true })).toBeVisible();
  await expect(page.getByText(/Pasá el bastón por la caravana/)).toBeVisible();
  // Y NO aparece ningún aviso de problema: con el bastón conectado sería mentira.
  await expect(page.getByText(SIN_BASTON, { exact: true })).toHaveCount(0);
  await expect(page.getByText(DESCONECTADO, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: CTA_CONECTAR })).toHaveCount(0);
});
