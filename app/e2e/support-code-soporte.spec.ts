// e2e/support-code-soporte.spec.ts — CÓDIGO DE SOPORTE en las 2 superficies de UI (spec 23, US5 / R5.3–R5.9).
//
// Feature 23 surfacea un "Código de soporte" (id de correlación) cuando algo sale mal, para que el operario
// se lo dicte/pegue a soporte. Dos superficies REUSAN el MISMO componente presentacional (SupportCodeRow):
//
//   (T25) FALLBACK DE CRASH — RootErrorBoundaryFallback con `supportCode` = el requestId del crash. Se
//         renderiza sin fabricar un crash real vía el spike `observabilidad-spike?code=<uuid>` (DEV_WEB_ROUTES,
//         sin auth) → EL MISMO componente que producción. Asserta: "Código de soporte" + el valor + Copiar; y
//         que tocar Copiar NO rompe (best-effort: en web el clipboard puede estar bloqueado → degrada visible).
//
//   (T26) RECHAZO DE MANGA — SyncRechazoSheet: cada fila muestra el `id` de la op rechazada como código de
//         soporte. Se inyecta un rechazo con la marca SOLO-E2E (`__MITROPERO_SYNC_REJECT_E2E__`, gated fuera de
//         prod, mismo patrón que maniobra-rechazo-sync.spec.ts). Asserta: la fila muestra el id + Copiar.
//
// Fixtures desde ./helpers/fixtures (NO @playwright/test) → el shim de env web (si no, PowerSync bootea en blanco).

import { test, expect, type Page } from './helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// T25 — FALLBACK DE CRASH: "Código de soporte" + valor + Copiar; Copiar best-effort (no rompe).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('(T25) el fallback de crash muestra el código de soporte + Copiar y copiar no rompe', async ({ page }) => {
  const CODE = '9f3a1c2e-4b5d-6e7f-8a90-1b2c3d4e5f60';

  // Un crash de render NO debe dejar errores no capturados que rompan el fallback. Vigilamos pageerror.
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  // Spike DEV_WEB_ROUTES (sin auth) que renderiza EL MISMO RootErrorBoundaryFallback con el código.
  await page.goto(`/observabilidad-spike?code=${CODE}`);

  // Título del fallback (con descendente en "Algo") + el copy de código de soporte.
  await expect(page.getByText('Algo salió mal', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Código de soporte', { exact: true })).toBeVisible();
  // El valor del código: está en el DOM aunque numberOfLines lo recorte visualmente (ellipsis es CSS).
  await expect(page.getByText(CODE).first()).toBeVisible();
  // La afordancia Copiar existe.
  const copiar = page.getByText('Copiar', { exact: true }).first();
  await expect(copiar).toBeVisible();

  // Tocar Copiar: la fila entera es el target (onPress DIRECTO en la pieza Tamagui → un click dispara el
  // mismo handler en web; el context de regresión es Desktop sin touch). En web el clipboard puede estar
  // bloqueado → el componente cae al catch (best-effort). El invariante testeable es "NO rompe": el código y
  // el copy siguen a la vista después del tap (degradación best-effort, R5.4/R5.9). El veto TÁCTIL real
  // (hasTouch + touchscreen.tap) vive en el .capture.ts.
  const row = page.getByRole('button', { name: new RegExp(`Copiar código de soporte ${CODE}`) });
  await row.click();

  // Best-effort: si el clipboard anduvo, aparece "Copiado" (efímero); si no, degrada sin romper. Ninguno de
  // los dos caminos debe tirar un error no capturado ni desmontar el fallback.
  await page.waitForTimeout(300);
  await expect(page.getByText('Código de soporte', { exact: true })).toBeVisible();
  await expect(page.getByText(CODE).first()).toBeVisible();
  expect(pageErrors, `copiar no debe lanzar errores no capturados: ${pageErrors.join(' | ')}`).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// T26 — SyncRechazoSheet: la fila del rechazo muestra el `id` de la op como código de soporte + Copiar.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Arranca con la marca SOLO-E2E del rechazo de sync seteada ANTES del bundle (consume-y-desarma al enfocar). */
async function armSyncReject(
  page: Page,
  payload: { id: string; table: string; op: string; code: string },
): Promise<void> {
  await page.addInitScript((p) => {
    (window as unknown as Record<string, unknown>).__MITROPERO_SYNC_REJECT_E2E__ = p;
  }, payload);
}

test('(T26) el SyncRechazoSheet muestra el id de la op como código de soporte + Copiar', async ({ page }) => {
  const user = await createTestUser('sup-code-rechazo');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Codigo Soporte');

  // id de op legible → la fila lo muestra como código de soporte (mismo id que el evento upload_rejected de Sentry).
  const OP_ID = 'op-soporte-42';
  await armSyncReject(page, { id: OP_ID, table: 'weight_events', op: 'PUT', code: '23514' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await page.goto('/maniobra');
  await expect(page.getByText('Modo maniobras', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Banner → sheet.
  const banner = page.getByTestId('sync-rechazo-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await banner.click();
  const sheet = page.getByTestId('sync-rechazo-sheet');
  await expect(sheet).toBeVisible({ timeout: 10_000 });

  // La fila del rechazo trae el código de soporte con el id de la op + Copiar (SupportCodeRow, R5.5/R5.7).
  await expect(sheet.getByText('Código de soporte', { exact: true })).toBeVisible();
  await expect(sheet.getByText(OP_ID).first()).toBeVisible();
  await expect(sheet.getByText('Copiar', { exact: true }).first()).toBeVisible();
  // El id que ve el operario es el mismo que se busca en Sentry: a11y de la fila copiable lo lleva completo.
  await expect(
    sheet.getByRole('button', { name: new RegExp(`Copiar código de soporte ${OP_ID}`) }),
  ).toBeVisible();
});
