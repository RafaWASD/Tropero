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
  seedAnimal,
  setUserPhone,
  waitForServerAnimalProfile,
  waitForServerWeightEvent,
  waitForServerBirth,
  getServerBirthState,
  waitForServerExit,
  getServerProfileStatus,
  softDeleteProfile,
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
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill('12');
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
  await expect(page.getByLabel('Nombre / seña (no editable)', { exact: true })).toHaveValue('34');
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

// T7.3 — EVENTO SIMPLE OFFLINE end-to-end: con un animal ya sincronizado, OFFLINE → abrir su ficha
// (lectura local) → cronología (lectura local) → agregar un PESO (CRUD plano: INSERT local + upload
// queue, T5.1) → el peso aparece en el timeline offline (overlay/local) → RECONEXIÓN → el drenado de
// la upload queue sube el weight_event por PostgREST → ORÁCULO server-side: la fila REAL aterriza en
// `weight_events` con su establishment_id forzado por el trigger 0077. Cubre R5.1 (lectura local de
// ficha/timeline), R6.1 (escritura de evento simple offline), R6.2 (re-validación server al subir).
test('offline: agregar un PESO offline → reconexión → el weight_event aterriza en Supabase (T7.3)', async ({
  page,
}) => {
  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

  const user = await createTestUser('offlineevent');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo OfflineEvent');
  // Animal sembrado server-side: ya sincronizado al device cuando abrimos la app (lo abrimos por la lista).
  const idv = `9911${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });
  // Un peso único e improbable de colisionar con la data contaminada de la beta (oráculo server-side).
  const weightKg = 300 + (Date.now() % 90); // 300–389, entero

  await page.goto(BASE_URL);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // El animal sincronizado aparece en la lista → abrir su ficha (lectura local del detalle).
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── OFFLINE (DevTools → Network → Offline). ──
  await page.context().setOffline(true);

  // Agregar un PESO offline. El wizard "Agregar evento" → "Pesaje" → cargar el peso → Guardar.
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Pesaje', exact: true }).click();
  const weightInput = page.getByLabel('Peso en kilos', { exact: true });
  await expect(weightInput).toBeVisible({ timeout: 20_000 });
  await weightInput.fill(String(weightKg));
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // De vuelta en la ficha: el peso se ve OFFLINE (lectura local del timeline — INSERT local ya aplicado).
  try {
    await expect(page.getByText('Pesaje', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`${weightKg} kg`, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  } catch (err) {
    console.log('[diag] consola del page al fallar (offline):\n' + consoleLines.join('\n'));
    throw err;
  }

  // ── RECONEXIÓN → ORÁCULO server-side: el weight_event aterriza REALMENTE en Supabase. ──
  await page.context().setOffline(false);
  try {
    await waitForServerWeightEvent(establishmentId, weightKg);
    // Y el peso SIGUE en la ficha tras el drenado (sin desaparición espuria).
    await expect(page.getByText(`${weightKg} kg`, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    // Cero rechazo del upload (la señal de un drenado fallido sería el warn de connector.ts).
    const rejected = consoleLines.filter((l) => l.includes('upload rechazado'));
    expect(rejected, `el drenado del evento NO debe rechazar:\n${rejected.join('\n')}`).toEqual([]);
  } catch (err) {
    console.log('[diag] consola del page al fallar (drenado evento):\n' + consoleLines.join('\n'));
    throw err;
  }
});

// El label visual del ternero SIN tag en la lista/ficha (RPC + overlay usan el mismo fallback, R9.1).
const CALF_FALLBACK = 'recién nacido — pendiente de caravana';

// Abre la ficha de un animal YA sincronizado desde la lista por su idv (lectura local del detalle).
// La ficha /animal/[id] es un screen PUSHEADO (sin bottom-nav): se sale con "Volver" (no con la tab).
async function openProfileByIdv(page: import('@playwright/test').Page, idv: string): Promise<void> {
  await gotoAnimales(page);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// Vuelve de la ficha (o de un wizard que ya cayó en la ficha) a la LISTA Animales. La ficha no tiene
// bottom-nav → hay que pulsar "Volver" para reaparecer la tab; luego el buscador confirma la lista.
async function backToAnimalesList(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByLabel('Buscar animal por caravana o número', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

// FUERZA un re-fetch de la lista Animales rebotando por "Más" y volviendo (la lista lee one-shot via
// getAll → re-clickear la tab ya activa NO re-dispara useFocusEffect; el rebote SÍ). Necesario para ver
// el efecto de un cambio de OVERLAY que ocurrió mientras la tab ya estaba en foco (ej. el rollback que
// limpia pending_* tras reconectar). Mismo patrón que el test 1 (Más → Animales).
async function refreshAnimalesList(page: import('@playwright/test').Page): Promise<void> {
  await gotoTab(page, 'Más', page.getByRole('button', { name: 'Cerrar sesión' }));
  await gotoAnimales(page);
}

// Desde la ficha (abierta), camina "Agregar evento" → "Parto" → carga N terneros (sexo por defecto
// Hembra; sin tag → fallback visual) → Guardar. Acepta el aviso suave (la madre no figura preñada).
async function registerBirthFromProfile(
  page: import('@playwright/test').Page,
  calfCount: number,
): Promise<void> {
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Parto', exact: true }).click();
  await expect(page.getByText('Fecha del parto (AAAA-MM-DD)', { exact: true })).toBeVisible({ timeout: 20_000 });

  // 1 ternero por defecto; sumamos los que falten (mellizos, R9.5).
  for (let i = 1; i < calfCount; i++) {
    await page.getByRole('button', { name: 'Agregar otro ternero', exact: true }).click();
  }
  // Cada card "Ternero N": elegir sexo (REQUERIDO). El OptionSelector del parto rotula la opción con su
  // label crudo ("Hembra"/"Macho") — NO "Sexo Hembra" (ese es el wizard de alta). Hembra para todos
  // (sin tag → la lista los muestra con el fallback visual de la RPC, R9.1).
  for (let i = 0; i < calfCount; i++) {
    await page.getByRole('button', { name: 'Hembra', exact: true }).nth(i).click();
  }
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();
}

// T7.9 — PARTO OFFLINE end-to-end (mono y mellizos): con la madre ya sincronizada, OFFLINE → registrar
// el parto desde su ficha → el parto (evento) + N terneros viven en el OVERLAY local-only (la cronología
// muestra "Parto"; los terneros aparecen en la lista) y se encola UNA intención op_intents → RECONEXIÓN →
// el drenado corre register_birth ATÓMICO server-side → el ACK limpia el overlay y las filas reales bajan
// por la stream. ORÁCULO server-side: en Supabase hay EXACTAMENTE UN evento de parto (no duplicado, R6.12)
// + N terneros (birth_calves, server-only → solo existen si la RPC corrió) + la ficha NO muestra duplicados.
// Cubre R6.6 (parto offline), R6.8 (overlay), R6.12 (no doble-upload), R6.10 (idempotencia: 1 solo parto).
for (const { label, calves } of [
  { label: 'mono', calves: 1 },
  { label: 'mellizos', calves: 2 },
]) {
  test(`offline: PARTO ${label} → overlay en la ficha → reconexión → un solo parto + ${calves} ternero(s) en Supabase (T7.9)`, async ({
    page,
  }) => {
    const consoleLines: string[] = [];
    page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
    // El parto sobre una hembra que NO figura preñada dispara el aviso suave (window.confirm en web) →
    // lo aceptamos para proceder (la madre sembrada es vaquillona, sin tacto → "Sin registrar").
    page.on('dialog', (d) => void d.accept());

    const user = await createTestUser(`offlinebirth${label}`);
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, `Campo OfflineBirth ${label}`);
    // La MADRE: hembra con idv (visible y buscable en la lista). register_birth NO exige preñez/categoría;
    // el aviso suave se acepta arriba.
    const motherIdv = `7711${Date.now().toString().slice(-5)}`;
    const motherProfileId = await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

    await page.goto(BASE_URL);
    await signIn(page, user);
    await waitForHome(page);
    await openProfileByIdv(page, motherIdv);

    // ── OFFLINE ──
    await page.context().setOffline(true);
    await registerBirthFromProfile(page, calves);

    // De vuelta en la ficha: el PARTO se ve OFFLINE en la cronología (overlay pending_reproductive_events).
    try {
      await expect(page.getByText('Parto', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    } catch (err) {
      console.log('[diag] consola del page al fallar (parto offline):\n' + consoleLines.join('\n'));
      throw err;
    }

    // El/los ternero(s) optimista(s) aparecen en la lista (overlay pending_animal_profiles, fallback visual).
    // La ficha es un screen pusheado → "Volver" para reaparecer la tab Animales antes de ver la lista.
    await backToAnimalesList(page);
    await expect(page.getByText(CALF_FALLBACK, { exact: true })).toHaveCount(calves, { timeout: 20_000 });

    // ── RECONEXIÓN → ORÁCULO server-side: UN solo parto + N terneros REALES. ──
    await page.context().setOffline(false);
    try {
      const birth = await waitForServerBirth(motherProfileId, { expectedCalves: calves });
      // No duplicado (R6.12/R6.10): EXACTAMENTE un evento de parto y N terneros (no 2 partos / 2N terneros).
      expect(birth.birthEventCount, 'debe haber UN SOLO evento de parto server-side').toBe(1);
      expect(birth.calfCount, `deben ser exactamente ${calves} ternero(s) server-side`).toBe(calves);

      // La ficha de la madre NO muestra el parto DUPLICADO tras el ACK (overlay limpiado + fila real por
      // la stream): exactamente UN nodo "Parto" en su cronología.
      await openProfileByIdv(page, motherIdv);
      await expect(page.getByText('Parto', { exact: true })).toHaveCount(1, { timeout: 20_000 });

      // Cero rechazo del upload durante el drenado.
      const rejected = consoleLines.filter((l) => l.includes('upload rechazado'));
      expect(rejected, `el drenado del parto NO debe rechazar:\n${rejected.join('\n')}`).toEqual([]);
    } catch (err) {
      console.log('[diag] consola del page al fallar (drenado parto):\n' + consoleLines.join('\n'));
      throw err;
    }
  });
}

// T7.9 — BAJA OFFLINE (exitAnimalProfile): con el animal ya sincronizado, OFFLINE → dar de baja (Venta)
// desde su ficha → el overlay (pending_status_overrides effect 'exited') lo OCULTA de la lista activa +
// la ficha pasa a modo archivada → RECONEXIÓN → el drenado corre exit_animal_profile → ORÁCULO server-side:
// el status/exit_reason REAL aterriza en animal_profiles (status='sold', exit_reason). Cubre R6.10 (baja
// offline + idempotencia natural por transición de status).
test('offline: BAJA (Venta) → overlay oculta de la lista → reconexión → status real en Supabase (T7.9)', async ({
  page,
}) => {
  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

  const user = await createTestUser('offlineexit');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo OfflineExit');
  const idv = `6611${Date.now().toString().slice(-5)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto(BASE_URL);
  await signIn(page, user);
  await waitForHome(page);
  await openProfileByIdv(page, idv);

  // ── OFFLINE ──
  await page.context().setOffline(true);

  // "Dar de baja" (al fondo de la ficha) → paso 1: Venta → paso 2: fecha (prefill hoy) → Dar de baja.
  await page.getByRole('button', { name: 'Dar de baja', exact: true }).click();
  await expect(page.getByText('¿Qué pasó con este animal?', { exact: true })).toBeVisible({ timeout: 20_000 });
  // La card de Venta: su título es "Venta" (EXIT_REASON_MAPPINGS). a11y label = el título.
  await page.getByRole('button', { name: 'Venta', exact: true }).click();
  // Paso 2: el botón destructivo "Dar de baja" (la fecha viene prefill HOY).
  const confirmBtn = page.getByRole('button', { name: 'Dar de baja', exact: true });
  await expect(confirmBtn).toBeVisible({ timeout: 20_000 });
  await confirmBtn.click();

  // De vuelta en la ficha (archivada in-situ): el animal SALE de la lista activa OFFLINE (overlay
  // pending_status_overrides lo oculta). "Volver" reaparece la tab Animales → la lista NO lo trae.
  await backToAnimalesList(page);
  try {
    await expect(page.getByRole('button', { name: new RegExp(idv) })).toHaveCount(0, { timeout: 20_000 });
  } catch (err) {
    console.log('[diag] consola del page al fallar (baja offline):\n' + consoleLines.join('\n'));
    throw err;
  }

  // ── RECONEXIÓN → ORÁCULO server-side: el status egresado REAL aterriza. ──
  await page.context().setOffline(false);
  try {
    const exited = await waitForServerExit(profileId, 'sold');
    expect(exited.exit_reason, 'la venta debe persistir exit_reason').not.toBeNull();
    // Sigue fuera de la lista activa tras el drenado (overlay → fila real status='sold', ambas lo ocultan).
    await gotoAnimales(page);
    await expect(page.getByRole('button', { name: new RegExp(idv) })).toHaveCount(0, { timeout: 20_000 });
    const rejected = consoleLines.filter((l) => l.includes('upload rechazado'));
    expect(rejected, `el drenado de la baja NO debe rechazar:\n${rejected.join('\n')}`).toEqual([]);
  } catch (err) {
    console.log('[diag] consola del page al fallar (drenado baja):\n' + consoleLines.join('\n'));
    throw err;
  }
});

// T7.8 (cierre in-vivo) — ROLLBACK del overlay ante un rechazo PERMANENTE real del server: registrar un
// PARTO offline (overlay: parto + ternero visibles) → mientras el cliente está OFFLINE, romper la
// precondición server-side (soft-deletear la MADRE vía admin) → RECONEXIÓN → el drenado corre
// register_birth → la madre ya no existe → 23503 ('mother animal_profile not found') →
// classifyIntentUploadError → permanent_reject → rollbackOverlay. ORÁCULO: (a) el overlay se BORRA (el
// ternero desaparece de la lista, el parto de la cronología), (b) NADA quedó escrito server-side (0 partos,
// 0 terneros), (c) el rechazo es OBSERVABLE (warn "upload rechazado"). Cubre R6.9 (reject permanente
// superficia), R6.11 (rollback del overlay), R8.1 (server re-valida y rechaza), R10.2 (rechazo observable).
test('offline: PARTO offline + madre soft-deleteada server-side → reconexión → rollback del overlay (nada en Supabase) (T7.8)', async ({
  page,
}) => {
  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('dialog', (d) => void d.accept()); // aviso suave del parto sobre hembra no preñada.

  const user = await createTestUser('offlinerollback');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo OfflineRollback');
  const motherIdv = `5511${Date.now().toString().slice(-5)}`;
  const motherProfileId = await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

  await page.goto(BASE_URL);
  await signIn(page, user);
  await waitForHome(page);
  await openProfileByIdv(page, motherIdv);

  // ── OFFLINE → registrar el parto (overlay: parto + 1 ternero). ──
  await page.context().setOffline(true);
  await registerBirthFromProfile(page, 1);
  // El parto se ve offline (cronología) y el ternero en la lista (overlay): la BASE que el rollback borra.
  await expect(page.getByText('Parto', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await backToAnimalesList(page);
  await expect(page.getByText(CALF_FALLBACK, { exact: true })).toHaveCount(1, { timeout: 20_000 });

  // ── Romper la precondición server-side MIENTRAS el cliente sigue offline: la madre deja de existir. ──
  // (El soft-delete viaja recién al reconectar; server-side la madre YA está borrada → la RPC fallará 23503.)
  await softDeleteProfile(motherProfileId);

  // ── RECONEXIÓN → el drenado corre register_birth → 23503 → permanent_reject → rollbackOverlay. ──
  await page.context().setOffline(false);
  try {
    // (c) El rechazo es OBSERVABLE (warn de connector.ts) — esperamos a que el drenado lo emita.
    await expect
      .poll(() => consoleLines.filter((l) => l.includes('upload rechazado')).length, {
        timeout: 40_000,
        message: 'el drenado debe SUPERFICIAR el rechazo permanente del parto',
      })
      .toBeGreaterThan(0);

    // (a) El overlay se BORRÓ: el ternero optimista YA NO está en la lista (rollbackOverlay por
    //     client_op_id). La lista lee one-shot → rebotamos por "Más" para forzar el re-fetch tras el
    //     rollback (que ocurrió mientras la tab ya estaba en foco).
    await refreshAnimalesList(page);
    await expect(page.getByText(CALF_FALLBACK, { exact: true })).toHaveCount(0, { timeout: 20_000 });

    // (b) NADA quedó escrito server-side: la RPC abortó ATÓMICA → 0 eventos de parto, 0 terneros para la madre.
    const serverState = await getServerBirthState(motherProfileId);
    expect(serverState.birthEventCount, 'NO debe haber ningún evento de parto server-side (rollback)').toBe(0);
    expect(serverState.calfCount, 'NO debe haber ningún ternero server-side (rollback)').toBe(0);

    // La intención se descartó (no loop): tras un nuevo ciclo de retry el overlay sigue vacío y no
    // re-aparece el ternero (el intent corrupto/rechazado NO vuelve a la cola).
    await page.waitForTimeout(6_000);
    await refreshAnimalesList(page);
    await expect(page.getByText(CALF_FALLBACK, { exact: true })).toHaveCount(0);
  } catch (err) {
    console.log('[diag] consola del page al fallar (rollback in-vivo):\n' + consoleLines.join('\n'));
    throw err;
  }
});

// T7.8 (contraprueba) — un error TRANSITORIO (sin red) NO borra el overlay ni descarta la intención: el
// dato optimista PERSISTE y la intención queda en cola. Es el espejo negativo del rollback: registrar un
// PARTO offline → quedarse OFFLINE (sin reconectar) un ciclo de retry → el overlay SIGUE (el parto en la
// cronología, el ternero en la lista) y NO hay warn "upload rechazado". Solo al reconectar (precondición
// intacta) el parto aterriza — confirmando que el transitorio nunca tocó el overlay. Cubre R6.9/R10.2
// (transitorio reintenta, NO superficia ni rollbackea).
test('offline: PARTO offline + sigue sin red (transitorio) → el overlay NO se borra, la intención queda en cola (T7.8 contraprueba)', async ({
  page,
}) => {
  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('dialog', (d) => void d.accept());

  const user = await createTestUser('offlinetransient');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo OfflineTransient');
  const motherIdv = `4411${Date.now().toString().slice(-5)}`;
  const motherProfileId = await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

  await page.goto(BASE_URL);
  await signIn(page, user);
  await waitForHome(page);
  await openProfileByIdv(page, motherIdv);

  // ── OFFLINE → registrar el parto (overlay: parto + 1 ternero). ──
  await page.context().setOffline(true);
  await registerBirthFromProfile(page, 1);
  await expect(page.getByText('Parto', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Seguimos OFFLINE un ciclo de retry del upload (el connector intenta drenar, la red está caída →
  // clasifica TRANSITORIO → re-throw → la tx queda en cola, el overlay NO se toca).
  await page.waitForTimeout(8_000);

  try {
    // El overlay PERSISTE: el ternero sigue en la lista, el parto en la cronología.
    await backToAnimalesList(page);
    await expect(page.getByText(CALF_FALLBACK, { exact: true })).toHaveCount(1, { timeout: 20_000 });
    // Y NO se superficó ningún rechazo (un transitorio NO emite el warn — eso es del permanente).
    const rejected = consoleLines.filter((l) => l.includes('upload rechazado'));
    expect(rejected, `un transitorio NO debe superficiar un rechazo:\n${rejected.join('\n')}`).toEqual([]);
    // Server-side todavía no hay nada (no se drenó): la intención sigue EN COLA (no se descartó).
    const before = await getServerBirthState(motherProfileId);
    expect(before.birthEventCount, 'sin red, el parto NO debe haber llegado al server aún').toBe(0);
  } catch (err) {
    console.log('[diag] consola del page al fallar (transitorio):\n' + consoleLines.join('\n'));
    throw err;
  }

  // ── RECONEXIÓN (precondición intacta) → la intención EN COLA drena → el parto aterriza (no se perdió). ──
  await page.context().setOffline(false);
  try {
    const birth = await waitForServerBirth(motherProfileId, { expectedCalves: 1 });
    expect(birth.birthEventCount, 'el parto encolado debe aterrizar al reconectar (no se descartó)').toBe(1);
    expect(birth.calfCount).toBe(1);
    // La madre sigue activa (no la tocamos en esta contraprueba).
    const m = await getServerProfileStatus(motherProfileId);
    expect(m.deleted_at, 'la madre de la contraprueba NO se soft-deletea').toBeNull();
  } catch (err) {
    console.log('[diag] consola del page al fallar (drenado tras transitorio):\n' + consoleLines.join('\n'));
    throw err;
  }
});
