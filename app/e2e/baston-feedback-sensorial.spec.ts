// e2e/baston-feedback-sensorial.spec.ts — red de regresión de 🟡-11 y 🟡-12 del barrido de edge cases
// del Bluetooth (2026-08-06): «en device el feedback es SOLO una vibración de 50 ms» y «"no entró" no
// tiene señal».
//
// EL ORÁCULO, Y POR QUÉ EXISTE EN WEB. En device el feedback es háptica + un .wav, y Playwright no ve
// ninguno de los dos. Pero el MISMO `playFeedback` toca en web el canal `web-audio` con los MISMOS
// tonos que el asset nativo (`WEB_TONES` en feedback.ts espeja `scripts/gen-baston-sounds.mjs`), así que
// stubeamos `AudioContext` con un GRABADOR: cada confirmación queda como una lista de frecuencias.
// Eso convierte "¿qué le dijo el producto al peón?" en un dato observable — no solo *si* sonó, sino QUÉ
// sonó, que es exactamente la pregunta de 🟡-12 (antes los cuatro desenlaces eran el mismo silencio o el
// mismo buzz).
//
//   lectura ACEPTADA  → [3150]        un pip agudo
//   lectura RECHAZADA → [1300, 850]   dos pips graves descendentes
//   re-lectura (<3 s) → nada          silencio deliberado (R3.1)
//
// LOS TRES LADOS (para que no pase por la razón equivocada):
//   (a) el positivo suena, y suena LO QUE CORRESPONDE (sin esto, "no sonar nunca" pasaría el resto);
//   (b) el negativo suena DISTINTO (sin esto, "sonar siempre igual" pasaría el (a));
//   (c) el duplicado no suena (sin esto, "sonar en todo" pasaría (a) y (b)).
//
// Y el segundo test cubre R4.3 de punta a punta —el switch que hasta hoy NO EXISTÍA (`writeBeepEnabled`
// no tenía un solo call site)—: apagarlo silencia el aviso, NO rompe la ingesta, y sobrevive al reload.

// `test`/`expect` SIEMPRE de `./helpers/fixtures` (no de `@playwright/test`): sin esas fixtures las
// pantallas con PowerSync bootean en blanco y el login se cuelga. El tipo `Page` sí viene de Playwright.
import { test, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** Frecuencias del cue positivo y del negativo (espejo de `WEB_TONES` en `services/ble/feedback.ts`). */
const CUE_OK = [3150];
const CUE_ERROR = [1300, 850];

/** La clave del storage de la preferencia (espejo de `STORAGE_KEY` en `services/ble/feedback-pref.ts`). */
const BEEP_PREF_KEY = 'rafq.ble.beep_enabled';

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

/**
 * Arranca la app con la marca de E2E del bastón + el GRABADOR de avisos sonoros. El fake de AudioContext
 * es completo (no delega en el real) para no depender de la política de autoplay de Chromium: lo único
 * que importa es qué pidió sonar el código de feedback, y con qué frecuencias.
 */
async function gotoWithToneRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__MITROPERO_BLE_E2E__ = true;
    const tones: { frequency: { value: number } }[][] = [];
    w.__mitroperoTones = tones;

    // ── CONTADOR DE ACCESOS AL STORAGE DE LA PREFERENCIA (R4.9) ──────────────────────────────────────
    // El invariante de 🟡-11 no es "no hay `await` en el camino caliente": es **"leer la preferencia no
    // toca el storage por bastonazo"**. Eso no se infiere del texto —un helper de firma síncrona que
    // adentro hace la I/O lo esconde en una línea, y así se burló el guard estático (🟠-A de la
    // re-review)—: se MIDE. En web el storage de la preferencia es `localStorage`, así que se envuelve
    // `getItem`/`setItem` y se cuenta cuántas veces se tocó ESA clave.
    let reads = 0;
    let writes = 0;
    w.__mitroperoPrefStorage = { get reads() { return reads; }, get writes() { return writes; } };
    const proto = Storage.prototype;
    const origGet = proto.getItem;
    const origSet = proto.setItem;
    proto.getItem = function patchedGetItem(key: string) {
      if (key === 'rafq.ble.beep_enabled') reads += 1;
      return origGet.call(this, key);
    };
    proto.setItem = function patchedSetItem(key: string, value: string) {
      if (key === 'rafq.ble.beep_enabled') writes += 1;
      return origSet.call(this, key, value);
    };
    class RecordingAudioContext {
      currentTime = 0;
      destination = {};
      private oscs: { frequency: { value: number } }[] = [];
      constructor() {
        tones.push(this.oscs);
      }
      createOscillator() {
        const osc = {
          frequency: { value: 0 },
          connect: () => undefined,
          start: () => undefined,
          stop: () => undefined,
          onended: null as null | (() => void),
        };
        this.oscs.push(osc);
        return osc;
      }
      createGain() {
        return { gain: { value: 0 }, connect: () => undefined };
      }
      close() {
        return undefined;
      }
    }
    w.AudioContext = RecordingAudioContext;
    w.webkitAudioContext = RecordingAudioContext;
  });
  await page.goto('/');
}

/** Un aviso por elemento, cada uno con las frecuencias que pidió sonar. `[[3150],[1300,850]]`. */
function cues(page: Page): Promise<number[][]> {
  return page.evaluate(() =>
    (window as unknown as { __mitroperoTones: { frequency: { value: number } }[][] }).__mitroperoTones.map((oscs) =>
      oscs.map((o) => o.frequency.value),
    ),
  );
}

/** Cuántas veces se tocó el storage de la preferencia desde que arrancó la página. */
function prefStorage(page: Page): Promise<{ reads: number; writes: number }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __mitroperoPrefStorage: { reads: number; writes: number } }).__mitroperoPrefStorage;
    return { reads: s.reads, writes: s.writes };
  });
}

async function bastonazo(page: Page, value: string): Promise<void> {
  await page.evaluate((v) => {
    const h = (window as unknown as { __mitroperoBle?: { connectMock: () => void; tagRead: (x: string) => void } })
      .__mitroperoBle;
    if (!h) throw new Error('window.__mitroperoBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(v);
  }, value);
}

/** Entra a `/baston` (la pantalla que LISTA las lecturas en vivo → oráculo visible de qué entró). */
async function gotoBaston(page: Page): Promise<void> {
  await page.goto('/baston');
  await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 30_000 });
}

test('🟡-12: el vocabulario tiene DOS palabras — "entró" suena distinto de "no servía", y el repetido calla', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('cuevoc');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Vocabulario');

  await gotoWithToneRecorder(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoBaston(page);

  // Piso limpio: entrar a la pantalla no le dice nada al peón.
  expect(await cues(page)).toEqual([]);

  // ── (a) ACEPTADA: entra a la lista Y el producto lo dice con el pip agudo. ──
  const eid = makeEid();
  await bastonazo(page, eid);
  await expect(page.getByText(eid, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Lecturas (1)', { exact: true })).toBeVisible();
  await expect.poll(() => cues(page), { timeout: 10_000 }).toEqual([CUE_OK]);

  // ── (b) RECHAZADA: llegó una trama y no servía. NO entra a la lista, y el aviso es OTRO. ──
  // Esto es 🟡-12 entero: antes acá no pasaba absolutamente nada, igual que si el bastón estuviera mudo
  // o el peón no hubiese apretado el gatillo — tres causas distintas con el mismo silencio.
  await bastonazo(page, 'ESTO-NO-ES-UN-EID');
  await expect.poll(() => cues(page), { timeout: 10_000 }).toEqual([CUE_OK, CUE_ERROR]);
  await expect(page.getByText('Lecturas (1)', { exact: true })).toBeVisible();
  await expect(page.getByText('Lecturas (2)', { exact: true })).toHaveCount(0);

  // ── (c) DUPLICADA (mismo EID dentro de la ventana de 3 s): SILENCIO deliberado. ──
  // Ese animal ya entró y el producto ya lo confirmó hace un segundo. Un segundo positivo sería
  // confirmar dos veces una captura; el negativo sería mentir sobre un animal que sí está.
  await bastonazo(page, eid);
  await page.waitForTimeout(1500);
  expect(
    await cues(page),
    'la re-lectura dentro de la ventana de dedup emitió un aviso (tiene que ser muda, R3.1)',
  ).toEqual([CUE_OK, CUE_ERROR]);
  await expect(page.getByText('Lecturas (1)', { exact: true })).toBeVisible();
});

test('R4.9: el storage de la preferencia NO se toca por bastonazo (se MIDE, no se infiere)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  // ── EL INVARIANTE, OBSERVADO ─────────────────────────────────────────────────────────────────────
  // 🟡-11 era `readBeepEnabled()` EN CADA LECTURA: un cruce del puente nativo a `expo-secure-store` (el
  // KeyStore de Android) POR BASTONAZO, para alimentar un booleano que no cambia salvo que alguien toque
  // un switch. Los guards estáticos matan el mutante literal, pero un helper de firma síncrona que
  // adentro hace la I/O se los pasa en una línea (🟠-A de la re-review): la asincronía vive ADENTRO del
  // helper y el call site se ve idéntico a uno barato.
  // Este test no mira el texto: **cuenta los accesos reales al storage** mientras entran N lecturas por
  // el provider REAL. Cualquier indirección —tenga el nombre que tenga, sea sync o async— aparece acá.
  const user = await createTestUser('cuehot');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo CaminoCaliente');

  await gotoWithToneRecorder(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoBaston(page);

  // CONTRAFACTUAL: el warm-up SÍ lee el storage (una vez al montar el provider, otra al abrir la
  // pantalla). Sin este lado, "nunca leer la preferencia" pasaría el test principal y la preferencia
  // persistida no se aplicaría jamás.
  const base = await prefStorage(page);
  expect(base.reads, 'el warm-up no leyó la preferencia ni una vez: el valor persistido no se aplica').toBeGreaterThan(0);

  // 10 bastonazos con EIDs distintos (nada de dedup): el ritmo de una manga de verdad.
  const eids = Array.from({ length: 10 }, () => makeEid());
  for (const eid of eids) await bastonazo(page, eid);
  await expect(page.getByText('Lecturas (10)', { exact: true })).toBeVisible({ timeout: 30_000 });
  // Sonaron las 10: el camino recorrido es el real, no uno que se cortó antes de consultar nada.
  await expect.poll(() => cues(page), { timeout: 10_000 }).toHaveLength(10);

  const after = await prefStorage(page);
  expect(
    after.reads - base.reads,
    `el camino de la lectura tocó el storage ${after.reads - base.reads} veces en 10 bastonazos. Tiene que ` +
      'ser CERO: la preferencia sale del caché en memoria (R4.9 / 🟡-11).',
  ).toBe(0);
  expect(after.writes - base.writes, 'una lectura escribió la preferencia').toBe(0);

  // Y una lectura RECHAZADA y una DUPLICADA tampoco: los tres desenlaces pasan por el mismo punto.
  await bastonazo(page, 'ESTO-NO-ES-UN-EID');
  await bastonazo(page, eids[0]);
  await page.waitForTimeout(1200);
  const final = await prefStorage(page);
  expect(final.reads - base.reads, 'el desenlace rechazado o el duplicado tocaron el storage').toBe(0);
});

test('R4.3: el switch de sonido existe, silencia el aviso SIN romper la ingesta, y persiste', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('cuepref');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Preferencia');

  await gotoWithToneRecorder(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoBaston(page);

  // El switch EXISTE y arranca en ON (BEEP_DEFAULT_ENABLED). Hasta esta unidad, `writeBeepEnabled` no
  // tenía un solo call site en toda la app: R4.3 estaba incumplido por AUSENCIA de UI.
  const toggle = page.getByTestId('stick-beep-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Aviso de lectura', { exact: true })).toBeVisible();

  // Con el sonido ON, un bastonazo suena.
  await bastonazo(page, makeEid());
  await expect.poll(() => cues(page), { timeout: 10_000 }).toEqual([CUE_OK]);

  // ── APAGAR ──
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  // El copy cambia y sigue diciendo que la vibración NO se apagó (si no, el peón cree que rompió algo).
  await expect(page.getByText(/Solo vibra en cada bastonazo/)).toBeVisible();

  // El bastonazo siguiente NO suena… y AUN ASÍ ENTRA. Es la mitad que importa: la preferencia es un
  // ajuste de comodidad, no un interruptor de la ingesta (R4.5 / R15.2 — el feedback nunca la rompe).
  const silencioso = makeEid();
  await bastonazo(page, silencioso);
  await expect(page.getByText(silencioso, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Lecturas (2)', { exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await cues(page), 'con el sonido apagado, el bastonazo igual sonó').toEqual([CUE_OK]);

  // ── PERSISTE ENTRE SESIONES (R4.3) ──
  // El reload re-monta la app entera (provider incluido) y vuelve a correr el init script, así que el
  // grabador arranca de cero: si la preferencia no se hubiera guardado, el switch volvería a ON.
  await page.reload();
  await gotoBaston(page);
  await expect(page.getByTestId('stick-beep-toggle')).toHaveAttribute('aria-checked', 'false');
  await bastonazo(page, makeEid());
  await page.waitForTimeout(1200);
  expect(await cues(page), 'la preferencia no sobrevivió al reload').toEqual([]);

  // ── VOLVER A PRENDER: no es un camino de ida. ──
  await page.getByTestId('stick-beep-toggle').click();
  await expect(page.getByTestId('stick-beep-toggle')).toHaveAttribute('aria-checked', 'true');
  await bastonazo(page, makeEid());
  await expect.poll(() => cues(page), { timeout: 10_000 }).toEqual([CUE_OK]);
});
