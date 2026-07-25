// e2e/maniobra-back-hardware.spec.ts — NO-REGRESIÓN del delta "BACK DE HARDWARE (Android)" en el flujo de
// MODO MANIOBRAS (spec 03). Hasta este delta la app NO interceptaba el botón físico de atrás en ningún
// lado: hacía `pop` de la ruta sin pasar por ninguna guarda (destruía la config del wizard desde la etapa
// 2/3, salteaba el `ExitJornadaSheet` de la jornada activa, abandonaba un animal con eventos ya
// persistidos).
//
// ── QUÉ NO PUEDE VERIFICAR ESTE SPEC (honestidad de cobertura, ADR-029) ─────────────────────────────
// El back de hardware **no existe en web**: `BackHandler` no emite, y el hook está gateado a Android
// (`shouldRegisterHardwareBack`). Playwright NO puede disparar el back físico → que el back retroceda de
// etapa / abra la guarda de salida es **veredicto de DEVICE Android**. La decisión y la precedencia con los
// sheets están testeadas como lógica PURA en `src/utils/maniobra-back.test.ts` (18 casos), y el orden de
// ejecución de los listeners está LEÍDO en la fuente de RN (`BackHandler.android.js`), no ejecutado.
//
// (Se probó y se DESCARTÓ un assert de "consola limpia" sobre el `console.error` del stub de BackHandler de
// react-native-web: sacando el gate de plataforma, ese error NO aparece en el export web de este repo — un
// probe en el mismo lugar SÍ se captura → el assert no podía fallar nunca. No se deja un test que da verde
// pase lo que pase.)
//
// ── QUÉ SÍ VERIFICA, Y ES REGRESIÓN REAL ────────────────────────────────────────────────────────────
// Que el chevron ‹ sigue haciendo EXACTAMENTE lo de antes en las dos pantallas donde existe — que es el
// comportamiento que el back de hardware ahora espeja, y el contrato que el delta no puede haber movido:
//   1. Wizard: ‹ desde la etapa 3 vuelve a la etapa 2 **con la configuración intacta** (no sale del wizard),
//      y otro ‹ vuelve a la etapa 1.
//   2. Identificación: ‹ NO navega atrás — abre el `ExitJornadaSheet` (cierre guardado de la jornada,
//      R10.7), y "Seguir en la jornada" lo cierra sin navegar.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

test('el chevron ‹ del wizard retrocede de etapa con la config INTACTA (contrato que el back de hardware espeja)', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const user = await createTestUser('back-hardware-wizard');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Back Hardware');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── Wizard: etapa 1 → etapa 2 ──
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Paso 2 de 3', { exact: true })).toBeVisible();

  // Config real que el back NO puede destruir: 2 maniobras + la vacuna de la tanda (D2 la exige).
  await page.getByTestId('pool-row-pesaje').click();
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-1')).toBeVisible();
  await page.getByTestId('selected-body-1').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('maneuver-config-input').fill('Brucelosis');
  await page
    .getByTestId('maneuver-config-sheet')
    .getByRole('button', { name: 'Listo', exact: true })
    .click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('selected-config-1')).toHaveText('Brucelosis');

  // ── Etapa 3 → el ‹ RETROCEDE de etapa (no sale del wizard) y la config SIGUE puesta ──
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByText('Paso 2 de 3', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('selected-row-1')).toBeVisible();
  await expect(page.getByTestId('selected-config-1')).toHaveText('Brucelosis');

  // Otro ‹ → etapa 1 (sigue DENTRO del wizard: no volvió al landing).
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByText('Paso 1 de 3', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible();
});

test('el chevron ‹ de la identificación abre el ExitJornadaSheet (guarda R10.7) en vez de navegar atrás', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const user = await createTestUser('back-hardware-identify');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Back Identify');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Jornada mínima (pesaje: sin preconfig obligatorio) → arrancar → identificación.
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── El ‹ NO navega atrás: abre la GUARDA de salida de la jornada (R10.7). Es lo que el back de
  //    hardware espeja en Android — antes el back popeaba la ruta y la salteaba con la jornada ACTIVA. ──
  await page.getByRole('button', { name: 'Volver', exact: true }).first().click();
  await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });

  // "Seguir en la jornada" cierra la guarda y NO navega (seguimos en la identificación).
  await page.getByTestId('exit-jornada-seguir').click();
  await expect(page.getByTestId('exit-jornada-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible();
});
