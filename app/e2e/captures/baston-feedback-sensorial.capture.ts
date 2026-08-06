// e2e/captures/baston-feedback-sensorial.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para la unidad
// «el bastón tiene que sonar y vibrar de verdad en la manga» (🟡-11 y 🟡-12 del barrido de edge cases del
// Bluetooth, 2026-08-06).
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La red de regresión vive en
// e2e/baston-feedback-sensorial.spec.ts, que verifica el COMPORTAMIENTO (qué frecuencias sonaron).
//
// QUÉ HAY QUE VETAR ACÁ. La UI nueva es UNA tarjeta —«Aviso de lectura»— en la pantalla `/baston`, y es
// la casa de la única preferencia del bastón. Lo que se mira:
//   · dónde CAE en la pantalla (después de "Lecturas", antes del pie manual-first): que se lea como un
//     ajuste y no como un paso del flujo de conexión;
//   · los DOS estados del switch, en terna con el copy: con el sonido apagado el copy tiene que decir
//     que la vibración SIGUE, o el peón va a creer que rompió el bastón;
//   · la nota que enseña el vocabulario nuevo ("cuando lee algo que no sirve, el aviso es distinto"):
//     sin eso, el sonido de error es un ruido raro en la manga;
//   · que ningún título se recorte (descendentes: «Aviso de lectura» no tiene, pero «bastonazo» del
//     sub-copy sí, y va con `lineHeight` matcheado).
//
// El feedback en sí NO SE VE: es sonido y vibración. Por eso se capturan también los dos desenlaces en
// la lista de Lecturas —aceptada (entra) y rechazada (no entra, y la pantalla no cambia)—, que es
// exactamente el punto de 🟡-12: visualmente son casi lo mismo, y por eso hacía falta la señal sonora.
//
// ── CONTEO HONESTO DE FRAMES (🟡-6 del review) ───────────────────────────────────────────────────────
// La primera versión sacaba 8 capturas, pero **3 eran byte-idénticas entre sí**: la pantalla entera entra
// en un viewport de 412×915, así que "arriba", "la tarjeta" y "el vacío de lecturas" son EL MISMO frame.
// Se sacaron esos nombres redundantes. Quedan **6 capturas = 4 frames distintos + 2 pares idénticos A
// PROPÓSITO**, y los dos pares son la evidencia, no un descuido:
//   · `03-aviso-sonido-apagado` == `06-aviso-apagado-persiste-tras-recargar` → la prueba ES que el frame
//     no cambió DESPUÉS de recargar la app.
//   · `04-lectura-aceptada` == `05-lectura-rechazada` → **eso es el hallazgo 🟡-12**: los dos desenlaces
//     son visualmente indistinguibles, y por eso el aviso tiene que ser sonoro/táctil.
//
// Para correrlo:
//   cd app && pnpm exec playwright test e2e/captures/baston-feedback-sensorial.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/baston-feedback-sensorial/ (gitignoreado — app/.gitignore + ADR-029).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome, gotoTab } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'baston-feedback-sensorial');

test.afterAll(async () => {
  await cleanupAll();
});

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

async function bastonazo(page: Page, value: string): Promise<void> {
  await page.evaluate((v) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } })
      .__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible');
    h.connectMock();
    h.tagRead(v);
  }, value);
}

test('capturas: la tarjeta «Aviso de lectura» en sus dos estados + los dos desenlaces de una lectura', async ({
  page,
}) => {
  test.setTimeout(240_000);

  const user = await createTestUser('capfeed');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Feedback');

  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── (1) La RUTA REAL del operario: tab "Más" → la fila del bastón. La captura del recorrido importa
  //        tanto como la de la pantalla: si a la preferencia no se llega, no existe. ──
  const row = page.getByRole('button', { name: /^Bastón: / });
  await gotoTab(page, 'Más', row);
  await shot(page, '01-mas-fila-baston');
  await row.click();
  await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 30_000 });

  // ── (2) La pantalla entera con el sonido ENCENDIDO (default). En 412×915 entra completa, así que este
  //        único frame muestra a la vez la jerarquía (dónde cae la tarjeta), el vacío de Lecturas y la
  //        tarjeta con su copy + switch + nota del vocabulario. Es el estado en el que la va a encontrar
  //        todo el mundo la primera vez. ──
  const toggle = page.getByTestId('stick-beep-toggle');
  await toggle.scrollIntoViewIfNeeded();
  await expect(page.getByText('Aviso de lectura', { exact: true })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await shot(page, '02-aviso-sonido-encendido');

  // ── (3) APAGADO: el copy cambia y tiene que dejar clarísimo que la vibración NO se apagó. ──
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText(/Solo vibra en cada bastonazo/)).toBeVisible();
  await shot(page, '03-aviso-sonido-apagado');

  // Se vuelve a prender para las capturas de lectura (el estado por default del producto).
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  // ── (4) Lectura ACEPTADA: entra a la lista. Acá el teléfono hizo el pip agudo + la háptica de éxito.
  //        (En web solo suena; la háptica es de device — ver el informe.) ──
  const eid = makeEid();
  await bastonazo(page, eid);
  await expect(page.getByText(eid, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Lecturas (1)', { exact: true })).toBeVisible();
  await shot(page, '04-lectura-aceptada-entra-a-la-lista');

  // ── (5) Lectura RECHAZADA (trama que no es un EID): la pantalla NO CAMBIA. Esta captura y la anterior
  //        son casi idénticas, y ESO es el hallazgo 🟡-12: sin una señal sonora propia, el peón no tiene
  //        forma de distinguir "te escuché y no servía" de "no me enteré de nada". ──
  await bastonazo(page, 'ESTO-NO-ES-UN-EID');
  await page.waitForTimeout(1200);
  await expect(page.getByText('Lecturas (1)', { exact: true })).toBeVisible();
  await shot(page, '05-lectura-rechazada-la-pantalla-no-cambia');

  // ── (6) La preferencia PERSISTE: se apaga, se recarga la app, y sigue apagada. ──
  await page.getByTestId('stick-beep-toggle').scrollIntoViewIfNeeded();
  await page.getByTestId('stick-beep-toggle').click();
  await expect(page.getByTestId('stick-beep-toggle')).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await page.goto('/baston');
  await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('stick-beep-toggle').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('stick-beep-toggle')).toHaveAttribute('aria-checked', 'false');
  await shot(page, '06-aviso-apagado-persiste-tras-recargar');
});
