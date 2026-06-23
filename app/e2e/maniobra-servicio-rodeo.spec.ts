// e2e/maniobra-servicio-rodeo.spec.ts — CABLEADO de los MESES DE SERVICIO del rodeo (spec 03 Stream B / B1,
// RPSC.2 / RPSC.3). Red de seguridad del selector enchufado al alta (paso 4 del wizard) y a la edición real
// del rodeo, por el camino OFFLINE (outbox → RPC create_rodeo p_service_months / set_rodeo_service_months).
//
// Stream A (backend) ya deployado: columna rodeos.service_months (0102) + RPC create_rodeo(p_service_months)
// (0103) + RPC set_rodeo_service_months(p_rodeo_id, p_service_months) (0103). Este chunk es FRONTEND puro.
//
// Cubre:
//   1. ALTA con el selector (paso 4, primavera pre-tildada → RPSC.2.2): crear un rodeo dejando la primavera
//      por defecto → el rodeo creado tiene service_months={10,11,12} server-side (RPSC.2.4/RPSC.2.5). Oráculo
//      server-side (waitForServerRodeoServiceMonths) — el alta es OFFLINE-FIRST vía outbox.
//   2. EDICIÓN OFFLINE de los meses (RPSC.3.3/RPSC.3.4): un rodeo sembrado SIN meses ("sin configurar") →
//      desde Rodeos → "Meses de servicio" → el selector muestra "sin configurar" (RPSC.3.2) → elegir un
//      período → guardar OFFLINE → el overlay optimista refleja el cambio en la lista de Rodeos (RPSC.3.4) →
//      reconexión → el service_months REAL aterriza server-side. + idempotencia natural (re-guardar el mismo
//      período no cambia nada — RPSC.3.5, lo da el UPDATE de la RPC).
//
// Web táctil (hasTouch + touchscreen.tap) a 360/412: el selector es UI nueva de manga (gotcha
// reference_rn_web_pitfalls). Usuarios + campos namespaced; cleanup en afterAll + global-teardown.

// `test`/`expect` van por ./helpers/fixtures (NO @playwright/test): el `test` de fixtures sobrescribe la
// fixture `page` con un addInitScript que inyecta EXPO_PUBLIC_* en globalThis.process.env ANTES del bundle.
// El build web de prod lee el env de forma DINÁMICA (process.env[name], no inlineable por Metro) → sin el
// shim, getEnv()/resolveEnv tira "Faltan variables de entorno" en el boot → pantalla en blanco → el login
// nunca renderiza (getByLabel('Email') timeout 30s). Es el patrón que usan los 40 specs verdes (ver fixtures.ts).
import { test, expect } from './helpers/fixtures';

import {
  admin,
  createTestUser,
  seedEstablishment,
  seedEstablishmentWithRodeo,
  seedRodeo,
  setUserPhone,
  waitForServerRodeoServiceMonths,
  readServerRodeoServiceMonths,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, waitForSignIn, gotoTab } from './helpers/ui';
import { completeCrearRodeo } from './helpers/rodeos';

test.afterAll(async () => {
  await cleanupAll();
});

// ─── 1. ALTA con el selector (paso 4, primavera pre-tildada) ────────────────────────────────────────────

test('alta: el wizard tiene el paso 4 (meses de servicio) con primavera pre-tildada → el rodeo creado tiene service_months={10,11,12}', async ({
  page,
}) => {
  const user = await createTestUser('svcalta');
  await setUserPhone(user.id, '1123456789');
  // Campo sembrado con 0 rodeos → el RootGate manda al wizard "Crear tu primer rodeo" en bloqueo total.
  const estId = await seedEstablishment(user.id, 'Campo SvcAlta');

  await page.goto('/');
  await signIn(page, user);

  // Bloqueo total: el wizard. Paso 1 (sistema, cría pre-seleccionado) → 2 (nombre) → 3 (plantilla) → 4 (meses).
  await expect(page.getByText('Creá tu primer rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });

  const cria = page.getByRole('button', { name: /Sistema Cría/ });
  await expect(cria).toBeVisible({ timeout: 30_000 });
  await cria.click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  const nameInput = page.getByLabel('Nombre del rodeo', { exact: true });
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  await nameInput.fill(`${RUN_TAG} Rodeo primavera`);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Paso 3 — plantilla (la lista de toggles cargó). El CTA dice "Continuar" (ya no "Crear rodeo").
  await expect(page.getByRole('switch').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Paso 4 — meses de servicio. La grilla aparece + la primavera está PRE-TILDADA (RPSC.2.2): el resumen
  // dice "Oct → Dic · 3 meses" y los chips 10/11/12 están en el run (aria-pressed). NO tocamos nada → RPSC.2.5.
  await expect(page.getByTestId('service-months-grid')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('service-months-summary-detail')).toContainText('Oct → Dic', {
    timeout: 10_000,
  });
  // Chips de oct/nov/dic seleccionados (in-the-run = aria-pressed true); un chip fuera (ene) NO.
  await expect(page.getByTestId('month-chip-10')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('month-chip-12')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('month-chip-1')).toHaveAttribute('aria-pressed', 'false');

  // Crear con la primavera por defecto.
  const crear = page.getByRole('button', { name: 'Crear rodeo', exact: true });
  await expect(crear).toBeVisible({ timeout: 15_000 });
  await crear.click();

  // Onboarding offer (primer rodeo desde el bloqueo total): saltamos al inicio.
  const skipOffer = page.getByRole('button', { name: 'Más tarde, ir al inicio', exact: true });
  try {
    await skipOffer.waitFor({ state: 'visible', timeout: 15_000 });
    await skipOffer.click();
  } catch {
    /* alta no-bloqueante: sin oferta */
  }

  // ── ORÁCULO server-side (RPSC.2.4/RPSC.2.5): el rodeo creado tiene service_months = {10,11,12}. ──
  // El alta es OFFLINE-FIRST vía outbox → la RPC create_rodeo corre async al drenar → polleamos por el
  // establishment hasta que aparezca un rodeo con service_months={10,11,12} (es el único del campo).
  let rodeoId = '';
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from('rodeos')
          .select('id, service_months')
          .eq('establishment_id', estId)
          .eq('active', true)
          .is('deleted_at', null);
        const hit = (data ?? []).find(
          (r) =>
            Array.isArray(r.service_months) &&
            [...(r.service_months as number[])].sort((a, b) => a - b).join(',') === '10,11,12',
        );
        if (hit) {
          rodeoId = hit.id as string;
          return 1;
        }
        return 0;
      },
      { timeout: 25_000 },
    )
    .toBe(1);

  // Confirmación dura por el oráculo dedicado (set ordenado): el alta persistió la primavera por defecto.
  const persisted = await waitForServerRodeoServiceMonths(rodeoId, [10, 11, 12]);
  expect(persisted).toEqual([10, 11, 12]);
});

// ─── 2. EDICIÓN OFFLINE de los meses (optimista + server oracle + idempotente) ──────────────────────────

// Web TÁCTIL fiel a 360 (la edición es UI de manga; vetar en web táctil real, reference_rn_web_pitfalls). El
// test.use va DENTRO del describe para que NO afecte al test 1 (el alta corre en el viewport default 412). NO
// se spreadea devices[...] (su defaultBrowserType forzaría un worker nuevo, prohibido dentro de un describe);
// hasTouch + isMobile + viewport alcanzan para el táctil fiel (mismo patrón que maniobra-customfield-validacion).
test.describe('edición offline de meses (web táctil 360)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 800 } });

  test('edición offline: rodeo "sin configurar" → elegir un período → guardar offline (optimista) → reconexión → service_months real en Supabase', async ({
  page,
}) => {
  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

  const user = await createTestUser('svcedit');
  await setUserPhone(user.id, '1123456789');
  // Campo con UN rodeo sembrado SIN meses de servicio (service_months NULL = "sin configurar", RPSC.3.2).
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo SvcEdit');
  // Un 2do rodeo para que borrar/editar no choque con el bloqueo total (no relevante acá, pero realista).
  await seedRodeo(establishmentId, 'Rodeo dos');

  // Estado de partida verificado: el rodeo sembrado NO tiene meses (el seed no los setea).
  expect(await readServerRodeoServiceMonths(rodeoId)).toBeNull();

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Ir a Rodeos (desde "Más"). gotoTab al tab "Más", luego la fila "Rodeos" (su a11y label es
  // "Ver y gestionar los rodeos del campo", mas.tsx).
  await gotoTab(page, 'Más', page.getByRole('button', { name: 'Cerrar sesión' }));
  const rodeosEntry = page.getByRole('button', { name: 'Ver y gestionar los rodeos del campo' });
  await expect(rodeosEntry).toBeVisible({ timeout: 20_000 });
  await rodeosEntry.tap();

  // En Rodeos: la card del rodeo sembrado tiene la fila "Meses de servicio" con subtexto "sin configurar".
  await expect(page.getByText('Meses de servicio').first()).toBeVisible({ timeout: 20_000 });
  // Abrir la edición de meses del rodeo sembrado (el primero, RUN_TAG Rodeo general).
  const editServicio = page
    .getByRole('button', { name: new RegExp(`Editar los meses de servicio de ${RUN_TAG} Rodeo general`) })
    .first();
  await expect(editServicio).toBeVisible({ timeout: 20_000 });
  await editServicio.tap();

  // ── OFFLINE (la edición debe funcionar sin red, RPSC.3.3 offline-first). ──
  await page.context().setOffline(true);

  // El selector en mode='edicion' muestra el banner "sin configurar" (RPSC.3.2) y NO pre-tilda primavera.
  await expect(page.getByTestId('service-months-unconfigured')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('service-months-grid')).toBeVisible();
  // Sin selección → "Guardar meses de servicio" deshabilitado (la edición exige una selección explícita).

  // Elegir el atajo "Otoño" (= Jun/Jul, contiguo) — un toque.
  const otono = page.getByTestId('shortcut-otono');
  await expect(otono).toBeVisible({ timeout: 10_000 });
  await otono.tap();
  // El resumen pasa a "Jun → Jul · 2 meses".
  await expect(page.getByTestId('service-months-summary-detail')).toContainText('Jun → Jul', {
    timeout: 10_000,
  });

  // Guardar OFFLINE → vuelve a Rodeos.
  const guardar = page.getByRole('button', { name: 'Guardar meses de servicio', exact: true });
  await expect(guardar).toBeEnabled({ timeout: 10_000 });
  await guardar.tap();

  // ── Overlay optimista (RPSC.3.4): la card del rodeo en Rodeos ahora muestra "Jun → Jul" SIN red. ──
  try {
    await expect(page.getByText('Jun → Jul', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  } catch (err) {
    console.log('[diag] consola del page al fallar (overlay edición):\n' + consoleLines.join('\n'));
    throw err;
  }

  // ── RECONEXIÓN → ORÁCULO server-side: service_months REAL = {6,7}. ──
  await page.context().setOffline(false);
  try {
    const persisted = await waitForServerRodeoServiceMonths(rodeoId, [6, 7]);
    expect(persisted).toEqual([6, 7]);
    // Cero rechazo del upload durante el drenado (la señal de un drenado fallido = warn de connector.ts).
    const rejected = consoleLines.filter((l) => l.includes('upload rechazado'));
    expect(rejected, `el drenado de la edición NO debe rechazar:\n${rejected.join('\n')}`).toEqual([]);
  } catch (err) {
    console.log('[diag] consola del page al fallar (drenado edición):\n' + consoleLines.join('\n'));
    throw err;
  }

  // ── IDEMPOTENCIA (RPSC.3.5): re-guardar el MISMO período no rompe nada (UPDATE idempotente). ──
  // Re-abrimos la edición y re-guardamos Jun/Jul (que ya está persistido) → sigue {6,7}, sin rechazo.
  await editServicio.tap();
  await expect(page.getByTestId('service-months-grid')).toBeVisible({ timeout: 15_000 });
  // Ya no es "sin configurar": el banner no está y el resumen muestra el período persistido.
  await expect(page.getByTestId('service-months-unconfigured')).toHaveCount(0);
  await page.getByTestId('shortcut-otono').tap(); // re-selecciona el mismo período (idempotente).
  await page.getByRole('button', { name: 'Guardar meses de servicio', exact: true }).tap();
  // Sigue {6,7} server-side tras el re-guardado (no se duplicó ni cambió).
  const stillSame = await waitForServerRodeoServiceMonths(rodeoId, [6, 7]);
  expect(stillSame).toEqual([6, 7]);
  });
});
