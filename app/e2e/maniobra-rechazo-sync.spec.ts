// e2e/maniobra-rechazo-sync.spec.ts — SURFACING de RECHAZOS DE SYNC en el landing de MODO MANIOBRAS
// (spec 03 M4.2, R10.8). Una maniobra cargada OFFLINE que el server RECHAZA al sincronizar (gating capa 2
// `23514` / RLS `42501` / tenant-check) se DESCARTA en connector.uploadData para no trabar la cola, pero NO
// debe perderse en silencio: el landing muestra un BANNER terracota "N maniobras no se sincronizaron" → tap
// → un SHEET que lista cada rechazo (tipo + motivo + cuándo) + "Entendido" que las marca como vistas.
//
// Cómo se inyecta el rechazo: un hook SOLO-E2E (`window.__RAFAQ_SYNC_REJECT_E2E__`, gated fuera de prod,
// mismo patrón que `__RAFAQ_MANEUVER_FAULT__` / `__RAFAQ_BLE_E2E__`) que el landing consume al enfocar y
// registra en el store de rechazos (vía recordUploadRejection) — sin forzar un rechazo server-side real
// (frágil/lento). En prod/dev la marca no existe → el banner nunca aparece sin un rechazo real.
//
// Escenarios:
//   (a) con un rechazo armado → banner aparece → tap → sheet con tipo+motivo → "Entendido" → desaparece.
//   (b) SIN rechazo armado → no hay banner (regresión: el landing normal no lo muestra).

import { test, expect, type Page } from './helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** Arranca con la marca SOLO-E2E del rechazo de sync seteada ANTES del bundle (consume-y-desarma al enfocar). */
async function armSyncReject(
  page: Page,
  payload: { id: string; table: string; op: string; code: string } | true,
): Promise<void> {
  await page.addInitScript((p) => {
    (window as unknown as Record<string, unknown>).__RAFAQ_SYNC_REJECT_E2E__ = p;
  }, payload);
}

/** Abre el landing de MODO MANIOBRAS por deep-link y espera el header + el CTA "Nueva jornada". */
async function gotoLanding(page: Page): Promise<void> {
  await page.goto('/maniobra');
  await expect(page.getByText('Modo maniobras', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Nueva jornada', exact: true })).toBeVisible({ timeout: 20_000 });
}

// (a) con un rechazo de maniobra armado → banner → sheet → "Entendido" → desaparece.
test('(a) un rechazo de sync de maniobra se SUPERFICIA: banner → sheet con motivo → "Entendido" lo limpia', async ({ page }) => {
  const user = await createTestUser('m42-reject');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo M42 Reject');

  // Rechazo de un PESAJE por gating capa 2 (23514 = el rodeo dejó de habilitar la maniobra / animal movido).
  await armSyncReject(page, { id: 'rej-1', table: 'weight_events', op: 'PUT', code: '23514' });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoLanding(page);

  // El BANNER terracota aparece arriba: "1 maniobra no se sincronizó" (singular, verbo conjugado).
  const banner = page.getByTestId('sync-rechazo-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('1 maniobra no se sincronizó', { exact: true })).toBeVisible();

  // Tap → el SHEET de detalle con el tipo + motivo (Pesaje + gating 23514).
  await banner.click();
  await expect(page.getByTestId('sync-rechazo-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Pesaje:/).first()).toBeVisible();
  await expect(page.getByText(/rodeo dejó de habilitar|cambió de rodeo\/campo/).first()).toBeVisible();

  // "Entendido" → marca vistos + cierra + el banner desaparece.
  await page.getByTestId('sync-rechazo-entendido').click();
  await expect(page.getByTestId('sync-rechazo-sheet')).toHaveCount(0);
  await expect(page.getByTestId('sync-rechazo-banner')).toHaveCount(0);
});

// (b) SIN rechazo armado → no hay banner (el landing normal no lo muestra).
test('(b) sin rechazos el landing NO muestra el banner', async ({ page }) => {
  const user = await createTestUser('m42-noreject');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo M42 NoReject');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoLanding(page);
  await expect(page.getByTestId('sync-rechazo-banner')).toHaveCount(0);
});

// (c) un rechazo de OTRA tabla (no de maniobra) NO se muestra en esta UI (filtro isManeuverRejection).
test('(c) un rechazo de una tabla NO de maniobra no dispara el banner de manga', async ({ page }) => {
  const user = await createTestUser('m42-other');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo M42 Other');

  await armSyncReject(page, { id: 'rej-x', table: 'animal_profiles', op: 'PATCH', code: '42501' });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoLanding(page);
  await expect(page.getByTestId('sync-rechazo-banner')).toHaveCount(0);
});
