// e2e/maniobra-offline.spec.ts — red de seguridad OFFLINE de una JORNADA DE MANIOBRA completa (spec 03 M4.3).
//
// Cierra la verificación R10.1/R10.2/R10.3/R10.7 del chunk M4.3: una jornada de manga funciona 100% OFFLINE
// (sesión + identificación MANUAL + ≥2 eventos de maniobra de DOS tablas distintas + CIERRE) y sincroniza al
// reconectar, con oráculo SERVER-SIDE (service_role) + assert "cero `upload rechazado`" en la consola del page.
//
// Patrón: igual que animals-offline.spec.ts → `context.setOffline(true)` (corte de red CDP) → escribir offline
// (overlay/lectura local de PowerSync) → `setOffline(false)` → oráculos de admin.ts. La diferencia con el
// offline de maniobra-carga.spec.ts: aquel usa el BASTÓN (BLE mock) + solo pesaje/tacto + NO cierra la sesión.
// ESTE camina el MANUAL (sin BLE, manual-first promovido), toca DOS tablas de evento (weight_events +
// sanitary_events vía vacunación silent_apply) y CIERRA la jornada (ExitJornadaSheet → closeSession), probando
// el ORDEN de cierre offline (design §5): los eventos se encolan ANTES del close (FIFO de la upload queue) →
// la sesión cerrada server-side TIENE sus eventos con su `session_id` FK (no quedaron huérfanos).
//
// Cubre:
//   - R10.1 — carga 100% offline de una jornada (sesión + identificación manual + 2 eventos).
//   - R10.2 — sync posterior + cero rechazo en el happy-path (el rechazo OBSERVABLE real lo cubre M4.2).
//   - R10.3 — gating offline desde el cache local de `rodeo_data_config`: OFFLINE el wizard ofrece solo las
//     maniobras HABILITADAS del rodeo (pesaje + vacunación presentes; inseminación AUSENTE = off-by-default
//     en cría) — la resolución del gating capa 1 corre SIN red.
//   - R10.7 — cierre explícito (status='closed') con el orden correcto: los eventos suben ANTES del close →
//     la sesión cerrada conserva sus eventos (session_id FK contra la MISMA sesión) + cero `upload rechazado`.
//
// Usuarios + campos namespaced; cleanup en afterAll + global-teardown.

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
  waitForServerSessionClosed,
  waitForServerWeightEventWithSession,
  waitForServerSanitaryWithSession,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/**
 * Camina el wizard de jornada por el RODEO sembrado y elige {vacunación, pesaje} (ambas habilitadas en cría),
 * dejándolo LISTO para arrancar (etapa 3, botón "Arrancar jornada" visible). Esta parte navega a la pantalla
 * `/maniobra/jornada` (carga de página SPA) → necesita el server → se corre ONLINE. El corte de red y el
 * createSession (Arrancar) + identify + carga + cierre se hacen DESPUÉS, offline (ver el test).
 *
 * De paso verifica el GATING desde el cache local (R10.3): el pool de maniobras se arma desde el cache local
 * de `rodeo_data_config` (la MISMA fuente que se lee sin red) → ofrece las habilitadas (vacunación + pesaje) y
 * NO ofrece una deshabilitada (inseminación, off-by-default en cría, 0018). La prueba de que el gating corre
 * SIN red la completa el test: el frame de carga re-resuelve la secuencia ESTANDO OFFLINE a exactamente esas
 * 2 maniobras (`· 1 de 2`/`· 2 de 2`), confirmando que la resolución no depende del server.
 */
async function configureSessionVacPesaje(page: Page, vaccine: string): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });

  // ── R10.3 (gating desde el cache local) ── El pool con las maniobras prueba que el rodeo_data_config del
  // rodeo YA está en el SQLite local y que la resolución del gating capa 1 corre sobre ESE cache (no contra
  // el server): las habilitadas SE OFRECEN y una deshabilitada (inseminación, off-by-default en cría) NO.
  await expect(page.getByTestId('pool-row-vacunacion')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pool-row-pesaje')).toBeVisible();
  // NEGATIVA (R1.5/R10.3): la inseminación NACE deshabilitada en la plantilla de cría (0018) → el pool NO la
  // ofrece (el gating se resolvió contra el cache local). Si el gating estuviera roto (p. ej. cayéndose a
  // "todas" sin config), esta maniobra aparecería.
  await expect(page.getByTestId('pool-row-inseminacion')).toHaveCount(0);

  // Dwell: la fila recién sembrada por service_role se asienta en la stream antes de la carga rápida.
  await page.waitForTimeout(3000);
  // Orden de selección = orden de secuencia (R5.14): vacunación primero, pesaje después.
  await page.getByTestId('pool-row-vacunacion').click();
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-1')).toBeVisible();

  // Delta D2 (endurecimiento etapa 2): la Vacunación EXIGE ≥1 vacuna definida antes de continuar. Vacunación
  // es el índice 0 (primera seleccionada) → abrir su config (selected-body-0) y definir la vacuna de la tanda.
  await page.getByTestId('selected-body-0').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('maneuver-config-input').fill(vaccine);
  await page.getByRole('button', { name: 'Agregar vacuna', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });

  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
}

/**
 * Identifica un animal a mano (R3.5). En el build web hay un transporte BLE/web-serial conectable → el hero de
 * escucha es el ConnectHero y la entrada manual va COLAPSADA (botón "¿Sin chip? Ingresá la caravana"). La
 * expandimos, tipeamos la caravana y buscamos. El manual está SIEMPRE disponible (manual-first), conectado o no.
 */
async function manualIdentify(page: Page, query: string): Promise<void> {
  // Si la banda manual está colapsada (ConnectHero), expandirla. Si ya está promovida/expandida, el input ya
  // está visible → el click del "Sin chip" no existe y lo salteamos.
  const expandBtn = page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' });
  if (await expandBtn.isVisible().catch(() => false)) {
    await expandBtn.click();
  }
  await page.getByLabel('Número o caravana visual', { exact: true }).fill(query);
  await page.getByRole('button', { name: 'Buscar animal', exact: true }).click();
}

/** Teclea un peso entero en el keypad de PesajeStep (dígito por dígito). */
async function typeWeight(page: Page, kg: string): Promise<void> {
  for (const d of kg) {
    await page.getByRole('button', { name: d, exact: true }).first().click();
  }
}

// ── JORNADA OFFLINE COMPLETA: manual → vacunación (sanitary) + pesaje (weight) → cerrar → sync. ──
test('offline: jornada por manual → vacunación + pesaje → cerrar la jornada → todo aterriza con session_id (R10.1/R10.2/R10.3/R10.7)', async ({
  page,
}) => {
  // Polling de oráculos (drenado de la upload queue tras reconectar) → margen amplio.
  test.setTimeout(200_000);

  // Consola del page: si el overlay se rollbackeara o un evento se rechazara al subir, acá aparecería el warn
  // "[powersync] upload rechazado (descartado)" (connector.ts) — se imprime al fallar para diagnóstico.
  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

  const user = await createTestUser('m43-offline');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Offline M43');
  // Animal YA sincronizado (seedAnimal server-side) → baja por la stream antes de cortar la red. Hembra con
  // idv (identificable a mano por el idv exacto, R3.5). El pesaje aplica (categoría no-ternero); la vacunación
  // aplica siempre en cría (vacunacion enabled por default).
  const idv = '4815';
  const profileId = await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });
  // Peso único e improbable de colisionar (oráculo server-side por establishment + peso).
  const weightKg = 300 + (Date.now() % 90); // 300–389
  const vaccine = `Aftosa-${RUN_TAG.slice(-6)}`; // product_name único → oráculo server-side determinista

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // El animal baja por la stream (visible en la lista = ya sincronizó al SQLite local) ANTES de cortar la red.
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Configurar la jornada (elegir rodeo + maniobras + verificar el gating del cache local, R10.3). Esta parte
  // navega a `/maniobra/jornada` (carga de página SPA) → necesita el server → ONLINE. Deja "Arrancar jornada"
  // visible. El corte de red se hace JUSTO ANTES de crear la sesión.
  await configureSessionVacPesaje(page, vaccine);

  // ── OFFLINE (igual que DevTools → Network → Offline). TODO lo que sigue corre SIN red: createSession (la
  // jornada NACE offline), identificación manual, carga de las 2 maniobras y el CIERRE de la jornada. ──
  await page.context().setOffline(true);

  // Arrancar la jornada OFFLINE → createSession (CRUD-plano local, R1.11). La sesión vive en el SQLite local;
  // sube al reconectar. Sin BLE-mock el build web igual expone un transporte conectable (web-serial) → el hero
  // de escucha es el ConnectHero ("Conectá el bastón"); NO lo conectamos (vamos por el MANUAL, manual-first).
  // Esperamos a aterrizar en la identificación (el botón de entrada manual colapsado es el ancla estable).
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }),
  ).toBeVisible({ timeout: 20_000 });

  // Identificar el animal a mano (lookup LOCAL, R3.5) → found → flash "Lectura recibida" → auto-avance a carga.
  await manualIdentify(page, idv);
  await expect(page.getByText('Lectura recibida', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ── CARGA RÁPIDA OFFLINE — paso 1: VACUNACIÓN (D2: checklist APLICA/NO-APLICA, · 1 de 2). La vacuna de la
  // tanda ya está definida (etapa 2) y TILDADA (APLICA) por default → Aplicar y seguir → escribe sanitary_events. ──
  await expect(page.getByText('· 1 de 2', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`vaccine-check-${vaccine}`)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Aplicar y seguir' }).click();

  // ── Paso 2: PESAJE (keypad, · 2 de 2) → escribe weight_events. ──
  await expect(page.getByText('· 2 de 2', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('weight-display')).toBeVisible();
  await typeWeight(page, String(weightKg));
  await expect(page.getByTestId('weight-display').getByText(String(weightKg), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar peso' }).click();

  // ── RESUMEN del animal (offline) → confirmar → vuelve a identificar (manual promovido). ──
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(`${weightKg} kg`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  // Vuelve a la identificación (ConnectHero + entrada manual colapsada) → el botón de manual es el ancla.
  await expect(
    page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }),
  ).toBeVisible({ timeout: 15_000 });

  // ── CERRAR LA JORNADA OFFLINE (R10.7): ‹ (Volver) → ExitJornadaSheet → "Terminar jornada" → closeSession. ──
  // El cierre se encola DESPUÉS de los eventos (FIFO de la upload queue, design §5 / sessions.ts) → al drenar,
  // los eventos suben con la sesión todavía 'active' y el close sube último. Todo OFFLINE (UPDATE local).
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByTestId('exit-jornada-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Terminar jornada', exact: true }).click();
  await expect(page.getByText('Jornada terminada', { exact: true })).toBeVisible({ timeout: 10_000 });
  // El cierre de confirmación muestra el contador (lectura LOCAL del estado de la sesión, offline). El conteo
  // exacto es informativo (no es el oráculo de R10.7) y depende del re-load del foco → assert tolerante: que
  // aparezca "Procesaste N animal(es)" (≥1 esperado), sin pinear el número para no acoplar al timing del foco.
  await expect(page.getByText(/Procesaste\s*\d+\s*animal/)).toBeVisible();

  // ── RECONEXIÓN → ORÁCULO server-side: la sesión + ambos eventos aterrizan, con el FK correcto. ──
  await page.context().setOffline(false);
  try {
    // (R10.1 + R5.11) El PESAJE aterriza en weight_events con session_id NO nulo → ese FK ES la jornada. No
    // polleamos `status='active'` (el close puede haber drenado primero → no la veríamos activa); el id real
    // de la sesión lo da el session_id de los eventos, que apuntan a ELLA.
    const w = await waitForServerWeightEventWithSession(establishmentId, weightKg, { tries: 40 });
    // (segunda tabla de evento) La VACUNACIÓN aterriza en sanitary_events con session_id NO nulo.
    const vac = await waitForServerSanitaryWithSession(profileId, 'vaccination', {
      productName: vaccine,
      tries: 40,
    });

    // (R10.7 — FK + orden de cierre) Ambos eventos comparten EL MISMO session_id (la MISMA jornada)…
    expect(vac.sessionId, 'el pesaje y la vacunación deben llevar el MISMO session_id (misma jornada)').toBe(
      w.sessionId,
    );
    // … y ese session_id es el de una sesión que quedó CERRADA server-side (no huérfana). Esto prueba el FK
    // real (no solo que el evento existe): la sesión cerrada TIENE sus eventos → el close subió DESPUÉS de
    // los eventos (si hubiera subido antes, el tenant-check 0056 habría rechazado los eventos por sesión
    // 'closed' → habría `upload rechazado`).
    await waitForServerSessionClosed(w.sessionId, { tries: 40 });

    // (R10.2) Cero rechazo del upload durante el drenado (ni eventos ni close). La señal de un orden de cierre
    // ROTO (close antes que eventos) sería el warn "upload rechazado" de connector.ts.
    const rejected = consoleLines.filter((l) => l.includes('upload rechazado'));
    expect(rejected, `el drenado de la jornada NO debe rechazar nada:\n${rejected.join('\n')}`).toEqual([]);
  } catch (err) {
    console.log('[diag] consola del page al fallar (drenado jornada):\n' + consoleLines.join('\n'));
    throw err;
  }
});
