// e2e/baston-lectura-sin-consumidor.spec.ts — red de regresión del 🔴-2 del barrido de edge cases del
// Bluetooth (2026-08-06): **en `maniobra/carga` la lectura CONFIRMABA (feedback) y no la recibía nadie**.
//
// EL BUG. El provider disparaba el feedback sensorial apenas el EID era válido, ANTES del bucle de
// despacho y sin mirar si había alguien. En `maniobra/carga` no hay `useBleStickListener` propio y el
// overlay global se auto-suprime en TODO el árbol `maniobra/*` (`BLE_OWNED_ROUTES`), así que el peón
// —cargando el peso en el cepo, con el siguiente animal ya entrando, que es el ritmo real de la manga—
// bastonea, el teléfono le CONFIRMA, y el dato no llega a ningún lado. La vibración es *la* señal que
// este producto le enseñó a leer como "entró": una confirmación falsa sobre un dato perdido.
//
// EL ORÁCULO (y por qué existe en web). En device el feedback es háptica + un .wav, que Playwright no
// ve. Pero en web el MISMO `playFeedback` toca el canal `web-audio` (`decideFeedback('web', beep=ON,
// 'accepted')` → `sound.channel:'web-audio'` → `new AudioContext()`), y el sonido viene habilitado por
// default (`BEEP_DEFAULT_ENABLED`). Así que stubeamos `AudioContext` con un CONTADOR: cada confirmación
// del bastón incrementa `window.__rafaqBeeps`. Eso convierte "¿el producto le confirmó al peón?" en un
// número observable, que es exactamente la pregunta del bug.
//
// Este test cuenta CUÁNTAS veces habló el producto; el que verifica QUÉ dijo (pip agudo de "entró" vs.
// doble pip grave de "no servía") es `baston-feedback-sensorial.spec.ts`, de la unidad del 🟡-12.
//
// LOS DOS LADOS (para que no pase por la razón equivocada):
//   (a) CONTRAFACTUAL — en `maniobra/identificar` (que SÍ consume) el bastonazo confirma: el contador
//       sube. Sin este lado, "no confirmar nunca" pasaría el test principal.
//   (b) EL BUG — en `maniobra/carga` (nadie consume) el bastonazo NO confirma: el contador NO se mueve.
//
// ⚠️ Si algún día `carga.tsx` recibe su propia cola de bastonazos (decisión de producto de Raf, anotada
// como pendiente), este test cae — y tiene que caer: en ese momento la confirmación pasaría a ser
// VERDADERA y hay que actualizar el oráculo a propósito, no por accidente.

// `test`/`expect` SIEMPRE de `./helpers/fixtures` (no de `@playwright/test`): sin esas fixtures las
// pantallas con PowerSync bootean en blanco y el login se cuelga. El tipo `Page` sí viene de Playwright.
import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
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

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/**
 * Arranca la app con la marca de E2E del bastón + el CONTADOR DE CONFIRMACIONES. El fake de AudioContext
 * es completo (no delega en el real) para no depender de la política de autoplay de Chromium: lo único
 * que importa es cuántas veces el código de feedback pidió sonar.
 */
async function gotoWithBeepCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__RAFAQ_BLE_E2E__ = true;
    w.__rafaqBeeps = 0;
    class CountingAudioContext {
      currentTime = 0;
      destination = {};
      constructor() {
        (window as unknown as { __rafaqBeeps: number }).__rafaqBeeps += 1;
      }
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
          onended: null as null | (() => void),
        };
      }
      createGain() {
        return { gain: { value: 0 }, connect: () => undefined };
      }
      close() {
        return undefined;
      }
    }
    w.AudioContext = CountingAudioContext;
    w.webkitAudioContext = CountingAudioContext;
  });
  await page.goto('/');
}

async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/** Cuántas veces el producto le CONFIRMÓ una lectura al operario desde que arrancó la página. */
function beeps(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __rafaqBeeps: number }).__rafaqBeeps);
}

/** Arranca una jornada con SOLO PESAJE y aterriza en la identificación con el mock conectado. */
async function startSessionPesaje(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-pesaje')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000); // dwell: el rodeo_data_config se asienta antes de la carga rápida
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('🔴-2: en `maniobra/carga` el bastonazo NO confirma (nadie lo recibe); en `identificar` SÍ', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('nocons');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo SinConsumidor');

  // A = el animal que se identifica y lleva a la carga rápida. B = el "siguiente animal que ya entró",
  // el que el peón bastonea mientras carga el peso de A. B EXISTE de verdad: si la lectura se procesara,
  // habría algo real que mostrar — el test no pasa porque el EID sea basura.
  const eidA = makeEid();
  const eidB = makeEid();
  await seedAnimal(establishmentId, rodeoId, { tag: eidA, idv: '0401', sex: 'female', categoryCode: 'vaquillona' });
  await seedAnimal(establishmentId, rodeoId, { tag: eidB, idv: '0402', sex: 'female', categoryCode: 'vaquillona' });

  await gotoWithBeepCounter(page);
  await signIn(page, user);
  await waitForHome(page);

  // Los animales bajan por la stream (visibles en la lista = ya sincronizaron al SQLite local).
  await gotoAnimales(page);
  await expect(page.getByText('0401', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('0402', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionPesaje(page);
  // Piso limpio: hasta acá nadie bastoneó nada.
  expect(await beeps(page)).toBe(0);

  // ── (a) CONTRAFACTUAL: en `identificar` HAY consumidor → la lectura entra y el producto CONFIRMA. ──
  await bastonazo(page, eidA);
  await expect(page.getByText('Lectura recibida', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => beeps(page), { timeout: 10_000 }).toBe(1);

  // Auto-avance a la CARGA RÁPIDA (una sola maniobra: pesaje).
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('0401', { exact: true })).toBeVisible();

  // ── (b) EL BUG: en `maniobra/carga` NADIE consume el bastón (la pantalla no tiene listener propio y el
  //        overlay global está suprimido en todo `maniobra/*`). El bastonazo del "siguiente animal" NO
  //        puede confirmar: sería una mentira sobre un dato que se pierde. ──
  await bastonazo(page, eidB);
  // Dwell generoso: el feedback ya es SÍNCRONO (desde 🟡-11 la preferencia sale de un caché en memoria,
  // no de un `await` a SecureStore por bastonazo), así que si fuera a sonar ya habría sonado. La ventana
  // se mantiene igual de holgada a propósito: el test tiene que fallar por el bug, no por ir apurado.
  // Antes del fix del 🔴-2, acá el contador valía 2.
  await page.waitForTimeout(2500);
  expect(
    await beeps(page),
    'el bastonazo en `maniobra/carga` CONFIRMÓ una lectura que no recibió nadie (🔴-2)',
  ).toBe(1);

  // Invariantes de apoyo (comportamiento que NO cambia): el overlay global sigue suprimido por ruta y la
  // pantalla no se movió. Se chequea la presencia del testID EXCLUSIVO del overlay, no la ausencia de un
  // texto del destino (la pantalla de fondo sigue montada detrás del scrim).
  await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible();
  await expect(page.getByText('0401', { exact: true })).toBeVisible();
});
