// e2e/animals-offline.spec.ts — red de seguridad OFFLINE del flujo de alta (spec 15 PowerSync +
// spec 09 R1.4). Nace del bug "animal creado OFFLINE desaparece de la lista al navegar de tab"
// (docs/backlog.md 2026-06-10, Run bugfix-overlay-list de 15-powersync).
//
// Primeros tests offline reales de la suite: `context.setOffline(true)` emula el DevTools→Offline
// del repro en vivo (mismo mecanismo CDP). El animal creado offline es OFFLINE-ONLY: vive solo en
// el overlay local de PowerSync (pending_animals / pending_animal_profiles, localOnly) hasta
// reconectar — estos tests verifican que la UI lo siga mostrando a través de navegaciones de tab.
//
// Cubre:
//   1. Alta por el empty-state CTA (repro literal del backlog): ficha → Volver → lista → Más →
//      Animales → el animal SIGUE visible. (Verde ya en baseline; queda como red de regresión del
//      overlay + de la clasificación transient del upload offline.)
//   2. Alta por el BUSCADOR no-match (find-or-create real de la manga, R1.4): al volver de la ficha
//      con el término aún tipeado, la búsqueda se RE-CORRE y muestra el animal — NO el no-match
//      stale. (ROJO en baseline: causa raíz del bug — searchResults no se re-computaba al re-foco.)
//   3. (Run create-animal-rpc, 2da causa raíz REABIERTA del backlog) PERSISTENCIA al reconectar: el
//      test 1 termina volviendo online y aserta vía admin que el alta aterrizó SERVER-SIDE en
//      animal_profiles (RPC atómica create_animal, 0083) + que el animal sigue en la lista + cero
//      "upload rechazado". ROJO contra un remoto sin 0083 aplicada (la aplica el leader).
//
// La señal de un rollback espurio del overlay (si esto volviera a romperse) es el warn
// "[powersync] upload rechazado (descartado)" en la consola del page (connector.ts).
//
// Usuarios + campos namespaced; cleanup en afterAll + global-teardown.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedRodeo,
  setUserPhone,
  waitForServerAnimalProfile,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// Diagnóstico: permite apuntar estos tests al DEV SERVER de Metro (el entorno del repro en vivo)
// con RAFAQ_E2E_BASE_URL=http://localhost:8082/. Sin la env corre contra el export estático (default).
const BASE_URL = process.env.RAFAQ_E2E_BASE_URL ?? '/';

// Camina el wizard de alta con DOS rodeos (paso 1 NO auto-avanza) hasta el paso de datos.
async function walkWizardWithTwoRodeos(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByText('¿A qué rodeo va este animal?', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: `Rodeo ${RUN_TAG} Rodeo general`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Categoría Vaquillona', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('offline: el animal creado (overlay) SIGUE en la lista tras navegar Más → Animales', async ({
  page,
}) => {
  // Consola del page: si el overlay se rollbackeara espurio, acá aparecería el warn
  // "[powersync] upload rechazado (descartado)" — se imprime al fallar para diagnóstico.
  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

  const user = await createTestUser('offlinelist');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo OfflineList');
  // 2do rodeo server-side: replica el campo del repro (2 rodeos, 0 animales).
  await seedRodeo(establishmentId, 'Rodeo dos');

  await page.goto(BASE_URL);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Estado REAL post-first-sync: empty-state del campo (0 animales). Si el first-sync no bajó
  // todavía, acá se vería el error "Sincronizando…" — el CTA visible ES el gate de sync.
  const emptyCta = page.getByRole('button', { name: 'Dar de alta tu primer animal' });
  await expect(emptyCta).toBeVisible({ timeout: 30_000 });

  // ── OFFLINE (igual que DevTools → Network → Offline del repro en vivo). ──
  await page.context().setOffline(true);

  await emptyCta.click();
  await walkWizardWithTwoRodeos(page);

  // Paso 4 — datos: IDV "12" (el identificador del repro).
  await page.getByLabel('Caravana / IDV (recomendado)', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Ficha del recién creado, servida 100% del overlay local (sin red).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('12', { exact: true }).first()).toBeVisible();

  // "Volver" cae en la tab Animales (replace) → el animal SE VE en la lista (como en el repro).
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByText('12', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // La navegación del repro: tab "Más" → volver a "Animales". Ancla: "Cerrar sesión" (siempre
  // presente en Más; "Editar perfil" NO aparece offline — la sección Perfil degrada a "Sin conexión",
  // hallazgo lateral en backlog). El dwell deja correr ≥1 ciclo de retry del upload offline (debe
  // clasificar transient y NO tocar el overlay).
  await gotoTab(page, 'Más', page.getByRole('button', { name: 'Cerrar sesión' }));
  await page.waitForTimeout(6_000);
  await gotoAnimales(page);

  // ── ORÁCULO del bug: el animal "12" SIGUE en la lista (offline-first, CLAUDE.md ppio 3). ──
  try {
    await expect(page.getByText('12', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  } catch (err) {
    console.log('[diag] consola del page al fallar:\n' + consoleLines.join('\n'));
    throw err;
  }

  // ── ORÁCULO de PERSISTENCIA al reconectar (Run create-animal-rpc, 2da causa raíz del backlog
  // 2026-06-10): volver online → el drenado de la outbox aplica la RPC ATÓMICA create_animal (0083)
  // → el alta aterriza server-side. Con el camino viejo (2 upserts no atómicos) un drenado
  // interrumpido dejaba animals huérfano y el reintento moría 42501 → rollback del overlay → el
  // animal desaparecía de la UI y NUNCA llegaba al server (pérdida real). Este bloque queda ROJO
  // contra un remoto SIN 0083 aplicada (PGRST202 → permanent_reject → mismo síntoma) — esperado
  // hasta que el leader la aplique.
  await page.context().setOffline(false);
  try {
    await waitForServerAnimalProfile(establishmentId, { idv: '12' });

    // Y el animal SIGUE en la lista: overlay → fila real (clearOverlay en el ACK + download de la
    // stream) sin desaparición permanente. toBeVisible tolera la ventana de reconciliación.
    await expect(page.getByText('12', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Ningún rechazo permanente durante el drenado (la señal de la cadena vieja del bug era el warn
    // "[powersync] upload rechazado (descartado)" + rollback del overlay).
    const rejected = consoleLines.filter((l) => l.includes('upload rechazado'));
    expect(rejected, `el drenado NO debe rechazar el alta:\n${rejected.join('\n')}`).toEqual([]);
  } catch (err) {
    console.log('[diag] consola del page al fallar (drenado):\n' + consoleLines.join('\n'));
    throw err;
  }
});

test('offline: alta vía BUSCADOR no-match → al volver de la ficha el animal se ve (no queda el no-match stale)', async ({
  page,
}) => {
  // Causa raíz del bug (Run bugfix-overlay-list): si el alta nace del no-match del buscador, el
  // término queda en el search bar y `searchResults` NO se re-computaba al re-enfocar la tab →
  // `visible` mostraba el no-match VIEJO ("No encontramos «N»") aunque el animal recién creado SÍ
  // estaba en el overlay local. Camino find-or-create REAL de la manga (spec 09 R1.4): tipear el
  // número → no-match → "Dar de alta este animal".
  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

  const user = await createTestUser('offlinesearch');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo OfflineSearch');
  await seedRodeo(establishmentId, 'Rodeo dos');

  await page.goto(BASE_URL);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(
    page.getByRole('button', { name: 'Dar de alta tu primer animal' }),
  ).toBeVisible({ timeout: 30_000 });

  await page.context().setOffline(true);

  // Buscar "34" → no-match → CTA "Dar de alta este animal" (id precargado, R1.4).
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill('34');
  const noMatchCta = page.getByRole('button', { name: 'Dar de alta este animal' });
  await expect(noMatchCta).toBeVisible({ timeout: 20_000 });
  await noMatchCta.click();

  // Wizard con el id precargado ("Creando: 34"). Paso 1 (2 rodeos) → sexo → categoría → datos.
  await expect(page.getByText('Creando: 34', { exact: true })).toBeVisible({ timeout: 20_000 });
  await walkWizardWithTwoRodeos(page);

  // El id vino precargado (read-only). "34" tiene 2 dígitos (<3) → classifyIdentifier lo manda a
  // VISUAL (R1.4), no a IDV. Solo crear.
  await expect(page.getByLabel('Identificación visual (no editable)', { exact: true })).toHaveValue('34');
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Ficha del recién creado (overlay local).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });

  // "Volver" cae en la tab Animales, que todavía tiene "34" en el buscador. La búsqueda activa se
  // RE-CORRE al re-enfocar → el animal recién creado se ve; el no-match stale NO queda en pantalla.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByLabel('Buscar animal por caravana o número', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  try {
    await expect(page.getByText('No encontramos «34».', { exact: true })).toHaveCount(0);
    await expect(page.getByText('34', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    // Y la navegación del repro de Raf con el término aún en el buscador: tab "Más" → volver a
    // "Animales" → el animal SIGUE visible (cada re-foco re-corre la búsqueda activa, no el stale).
    await gotoTab(page, 'Más', page.getByRole('button', { name: 'Cerrar sesión' }));
    await gotoAnimales(page);
    await expect(page.getByText('No encontramos «34».', { exact: true })).toHaveCount(0);
    await expect(page.getByText('34', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  } catch (err) {
    console.log('[diag] consola del page al fallar:\n' + consoleLines.join('\n'));
    throw err;
  }
});
