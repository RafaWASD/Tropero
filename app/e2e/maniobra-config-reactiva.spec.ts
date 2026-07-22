// e2e/maniobra-config-reactiva.spec.ts — feature 22 (d): el bucle CONFIG → MANIOBRA es REACTIVO.
//
// `useManeuverGating` dejó de disparar por `lastSyncedMs` (proxy NO determinista, ADR-030) y ahora observa
// `rodeo_data_config` + `pending_rodeo_data_config` con una watched query imperativa (`db.onChange`). Este
// spec prueba, en WEB (donde la descarga fluye ~1,5 s), que al habilitar un data_key en la config de un
// rodeo el POOL de maniobras del wizard lo refleja SIN reiniciar la app.
//
// ⚠️ REGLA DE ORO (heredada de reactividad-sync.spec.ts): ningún test hace `page.reload()` ni re-login tras el
// cambio de config. Reiniciar re-corre el bootstrap y "arregla" el bug (re-mount → re-lee el local) → daría
// verde sin la watched query. Todo se assertea con la MISMA página viva desde antes del cambio, parados en la
// etapa 2 del wizard (donde `offered = gating.filter(ALL_MANEUVERS)` depende de `gating.config`).
//
// El veredicto de "la descarga baja en vivo en NATIVO" (RC-1) es DEVICE (ADR-029) + la instrumentación
// (R22.23); acá se cubre la REACTIVIDAD de la watched query en web (el WIRING de (d)).
//
// Casos:
//   1. (R22.10/R22.16) — habilitar `inseminacion` (default OFF en cría, 0018) server-side aparece en el pool
//      del wizard SIN reiniciar (la maniobra INSEMINACIÓN se ofrece apenas la fila baja al SQLite local).
//   2. (R22.6/R22.21) — offline puro / app quieta: sin cambios de tabla el `db.onChange` no dispara → el pool
//      no cambia de estado por su cuenta (no aparece/desaparece nada, no se blanquea).

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setRodeoDataKey,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** Entra al wizard de jornada, elige el (único) rodeo y aterriza en la etapa 2 (pool de maniobras). */
async function gotoWizardPool(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
}

// ───────────────────────────────────────────────────────────────────────────────
// Caso 1 — CONFIG EN CALIENTE → POOL DE MANIOBRA. Es el criterio A1 (parte web): habilitar un dato en la
// config del rodeo se refleja en la maniobra sin reiniciar. `inseminacion` nace OFF en cría (0018 l.96) →
// la maniobra INSEMINACIÓN no está en el pool. Al prenderla server-side, la fila baja al SQLite local
// (~1,5 s), `db.onChange` sobre `rodeo_data_config` dispara → `useManeuverGating` re-corre la resolución →
// `offered` recomputa → `pool-row-inseminacion` aparece. SIN reload.
// ───────────────────────────────────────────────────────────────────────────────
test('R22.10/R22.16 — habilitar un data_key server-side aparece en el pool del wizard sin reiniciar', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('f22-config-reactiva');
  await setUserPhone(user.id, '1123456789');
  const { rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Config Reactiva');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoWizardPool(page);

  // Control de que el pool cargó (cría habilita `dientes` por default, 0018) — mismo ancla que
  // maniobra-elegir. Dwell implícito por el timeout: el rodeo_data_config del rodeo ya bajó al local.
  await expect(page.getByTestId('pool-row-dientes')).toBeVisible({ timeout: 30_000 });
  // INSEMINACIÓN nace OFF en cría → su maniobra NO está en el pool al arrancar.
  await expect(page.getByTestId('pool-row-inseminacion')).toHaveCount(0);

  // ── A MITAD DEL TEST, server-side: el owner habilita el data_key `inseminacion`. NADA de reload. ──
  await setRodeoDataKey(rodeoId, 'inseminacion', true);

  // La watched query (`db.onChange` sobre rodeo_data_config) dispara apenas la fila enabled=true baja al
  // SQLite local (~1,5 s determinista) → `useManeuverGating` recarga → INSEMINACIÓN entra al pool. Assert
  // DIRECTO, sin forzador de blip y sin reload (la app sigue montada en la etapa 2).
  await expect(page.getByTestId('pool-row-inseminacion')).toBeVisible({ timeout: 30_000 });

  // El pool no se blanqueó: el control (`dientes`) sigue ahí y seguimos en la etapa 2 (la lista de
  // reordenamiento sigue montada). La re-resolución fue en el lugar, no un re-mount.
  await expect(page.getByTestId('pool-row-dientes')).toBeVisible();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible();
});

// ───────────────────────────────────────────────────────────────────────────────
// Caso 2 — OFFLINE PURO / APP QUIETA. Sin red y sin cambios de tabla, `db.onChange` no dispara (solo dispara
// ante un cambio real de las tablas observadas) → el pool no cambia de estado por su cuenta. El trigger de
// conexión por red tampoco intenta nada (solo dispara en offline→online). Mismo oráculo que reactividad-sync
// T22, acotado al pool de maniobra (R22.6/R22.21).
// ───────────────────────────────────────────────────────────────────────────────
test('R22.6/R22.21 — offline puro: el pool de maniobra no cambia sin cambios de tabla', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('f22-offline-pool');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Offline Pool');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoWizardPool(page);
  // Estado de partida estable ONLINE: `dientes` presente (default), `inseminacion` ausente (default OFF).
  await expect(page.getByTestId('pool-row-dientes')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pool-row-inseminacion')).toHaveCount(0);

  await context.setOffline(true);
  try {
    // Un rato sin red y sin ningún cambio server-side: `db.onChange` no dispara y el trigger de conexión
    // por red no intenta nada (solo actúa en offline→online). El pool no cambia de estado por su cuenta.
    await page.waitForTimeout(10_000);
    await expect(page.getByTestId('pool-row-dientes')).toBeVisible();
    await expect(page.getByTestId('pool-row-inseminacion')).toHaveCount(0);
    // No se degradó a un estado de error/carga que blanquee el pool.
    await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
