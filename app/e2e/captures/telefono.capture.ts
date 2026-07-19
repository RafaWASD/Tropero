// e2e/captures/telefono.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta TELÉFONO de
// spec 01. Recorre las DOS pantallas donde se captura el teléfono y saca una captura NOMBRADA de cada
// estado clave a e2e/captures/__shots__/telefono/NN-estado.png, para que el leader vete el diseño y se
// lo muestre a Raf en la Puerta 2 con evidencia visual.
//
// Estados capturados (RTEL.12.1 / RTEL.12.2):
//   01  gate de crear-campo, vacío (adorno +54 fijo + placeholder)
//   02  gate con la máscara EN VIVO a medio tipear
//   03  gate con un número completo de área de 2 dígitos (11 2345-6789)
//   04  gate con un número de área de 4 dígitos — 2241, CHASCOMÚS (el veto de DP1: con la agrupación
//       literal `AA NNNN-NNNN` el teléfono del primer cliente beta se vería roto: "22 4143-0000")
//   05  gate en ESTADO DE ERROR: borde $terracota + error inline, con el título "Tu teléfono" SIN tapar
//   06  gate con la SUGERENCIA de DP4 ("¿Quisiste decir 11 2345-6789?") ante un número escrito con 15
//   07  gate después de aceptar la sugerencia de un tap (el número ya corregido, sin error)
//   08  gate en modo INTERNACIONAL (el adorno +54 desaparece, sin máscara argentina)
//   09  perfil de "Más" en modo LECTURA: el teléfono guardado con formato de display (+54 11 2345-6789)
//   10  perfil en modo EDICIÓN: el MISMO componente que el gate (la paridad, de un vistazo)
//   11  perfil en estado de error, para comparar el tratamiento del error entre las dos pantallas
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`). La red de
// regresión del delta es e2e/telefono.spec.ts + los unit tests de phone.ts / classify-error.ts /
// phone-field-guard.ts + la suite backend del CHECK.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/telefono.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/telefono/  (gitignoreado — ver app/.gitignore + ADR-029).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, waitForOnboarding, gotoTab } from '../helpers/ui';

// Path RELATIVO a app/ (cwd de Playwright) → app/e2e/captures/__shots__/telefono/.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'telefono');

test.afterAll(async () => {
  await cleanupAll();
});

/** Captura NOMBRADA tras un breve settle de layout (el llamador asegura el expect visible antes). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test('capturas del gate de teléfono (crear-campo): máscara, error, sugerencia del 15 e internacional', async ({
  page,
}) => {
  test.setTimeout(210_000);

  // Usuario SIN teléfono → el gate de R3.8 se muestra al ir a crear el primer campo.
  const user = await createTestUser('telcap');

  await page.goto('/');
  await signIn(page, user);
  await waitForOnboarding(page);
  await page.getByRole('button', { name: 'Crear mi primer campo' }).click();
  await expect(page.getByText('Tu teléfono', { exact: true })).toBeVisible({ timeout: 20_000 });

  const phone = page.getByLabel('Teléfono', { exact: true });
  const continuar = page.getByRole('button', { name: 'Continuar', exact: true });

  // 01 — vacío: adorno +54 fijo + placeholder que enseña el formato.
  await expect(page.getByTestId('gate-phone-prefix')).toHaveText('+54');
  await shot(page, '01-gate-vacio');

  // 02 — máscara EN VIVO a medio tipear (sin separador colgando al final).
  await phone.pressSequentially('112345');
  await expect(phone).toHaveValue('11 2345');
  await shot(page, '02-gate-mascara-en-vivo');

  // 03 — número completo, área de 2 dígitos.
  await phone.pressSequentially('6789');
  await expect(phone).toHaveValue('11 2345-6789');
  await shot(page, '03-gate-completo-area-2');

  // 04 — ⭐ EL VETO DE DP1: área de 4 dígitos (2241, Chascomús — el primer cliente beta). Con la
  //      agrupación literal de D2 esto se vería "22 4143-0000", visiblemente roto para el usuario que
  //      más cuida el proyecto.
  await phone.fill('');
  await phone.pressSequentially('2241430000');
  await expect(phone).toHaveValue('2241 43-0000');
  await shot(page, '04-gate-completo-area-4-chascomus');

  // 05 — ESTADO DE ERROR: borde $terracota + error inline debajo del campo. El título "Tu teléfono"
  //      tiene que seguir visible y NO tapado (nada de banner global).
  await phone.fill('');
  await phone.pressSequentially('11234');
  await continuar.click();
  await expect(page.getByText('Ingresá los 10 dígitos, sin el 0 ni el 15.')).toBeVisible();
  await expect(page.getByText('Tu teléfono', { exact: true })).toBeVisible();
  await shot(page, '05-gate-error-inline');

  // 06 — SUGERENCIA de DP4 por el camino de TIPEO (el caso común en la manga, no el de pegar): el
  //      celular escrito con 15 entra ENTERO (12 dígitos) y la ayuda aparece SIN tocar "Continuar".
  //      Antes el tope de 10 lo recortaba a `11 1523-4567`, 10 dígitos válidos del número equivocado.
  //      A vetar: que el chip se lea como una oferta y no como un error, y que no empuje el botón
  //      primario fuera de alcance del pulgar.
  await phone.fill('');
  await phone.pressSequentially('111523456789');
  await expect(phone).toHaveValue('11 1523-456789');
  await expect(page.getByTestId('gate-phone-suggestion')).toHaveText('¿Quisiste decir 11 2345-6789?');
  await shot(page, '06-gate-sugerencia-15-tipeada');

  // 06b — el mismo caso ya con el error inline prendido (tras intentar continuar): mensaje específico
  //       del 15 + la sugerencia conviviendo, con el título de la pantalla SIN tapar.
  await continuar.click();
  await expect(page.getByText('Sacá el 15: no va dentro del número.')).toBeVisible();
  await expect(page.getByText('Tu teléfono', { exact: true })).toBeVisible();
  await shot(page, '06b-gate-sugerencia-15-con-error');

  // 07 — la sugerencia aplicada de UN TAP: el número corregido, sin error ni affordance.
  await page.getByTestId('gate-phone-suggestion').click();
  await expect(phone).toHaveValue('11 2345-6789');
  await expect(page.getByTestId('gate-phone-suggestion')).toHaveCount(0);
  await shot(page, '07-gate-sugerencia-aplicada');

  // 08 — modo INTERNACIONAL (el vet extranjero): el adorno +54 desaparece y no se aplica la máscara AR.
  await phone.fill('');
  await phone.pressSequentially('+34600123456');
  await expect(phone).toHaveValue('+34600123456');
  await expect(page.getByTestId('gate-phone-prefix')).toHaveCount(0);
  await shot(page, '08-gate-modo-internacional');
});

test('capturas del teléfono en el perfil de "Más": display de lectura, edición y error', async ({
  page,
}) => {
  test.setTimeout(210_000);

  const user = await createTestUser('telcapmas', 'Raf Quiroga');
  // El helper normaliza al canónico (+542241430000): la pantalla lo muestra con formato de display.
  await setUserPhone(user.id, '2241430000');
  await seedEstablishmentWithRodeo(user.id, 'Campo TelCap', { rodeoRawName: true });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoTab(page, 'Más', page.getByRole('button', { name: 'Editar perfil' }));

  // 09 — LECTURA: el canónico +542241430000 se muestra agrupado por código de área, nunca crudo.
  await expect(page.getByText('+54 2241 43-0000', { exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(page, '09-perfil-lectura-display');

  // 10 — EDICIÓN: el MISMO componente que el gate (misma anatomía, mismo adorno) → la paridad se ve.
  await page.getByRole('button', { name: 'Editar perfil' }).click();
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('profile-phone-prefix')).toHaveText('+54');
  await shot(page, '10-perfil-edicion');

  // 11 — ERROR en el perfil: mismo tratamiento que en el gate (borde + inline sobre el campo), con el
  //      error de CAMPO separado del error de guardado (que iría al FormError, debajo).
  const phone = page.getByLabel('Teléfono', { exact: true });
  await phone.fill('');
  await phone.pressSequentially('11234');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Ingresá los 10 dígitos, sin el 0 ni el 15.')).toBeVisible();
  await shot(page, '11-perfil-error-inline');
});
