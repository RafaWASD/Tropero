// e2e/rodeos.spec.ts — red de seguridad del flujo de RODEOS (spec 02 frontend, C1).
//
// Cubre los 2 bugs de runtime que Raf vio probando en web (fix-loop):
//   BUG 1 — la home mostraba "Creá y configurá tu primer rodeo" como paso ACTIVO aunque el
//           RootGate ya garantiza ≥1 rodeo en la home (Stepper estático con estado hardcodeado +
//           CTA con TODO muerto). Test: empty-state → crear rodeo → aterrizar en home y NO ver el
//           CTA "Crear rodeo" del onboarding como pendiente.
//   BUG 2 — en el paso 3 del wizard los toggles no respondían al tap. CAUSA REAL: se pasaba
//           `accessibilityLabel` crudo al Pressable de RN-web → React tira el warning "does not
//           recognize the accessibilityLabel prop on a DOM element" → en DEV (Metro/`pnpm web`,
//           lo que probó Raf) ese warning monta el error-overlay/LogBox de Expo, que CUBRE la
//           pantalla e intercepta los toques. En el export de PRODUCCIÓN (lo que corre esta suite)
//           los warnings se eliminan y el overlay NO existe → el toggle SIEMPRE respondió acá. Por
//           eso esta suite NO reproducía el bug: el guard de regresión REAL de la causa es el unit
//           test app/src/utils/a11y.test.ts (en web nunca se emite accessibilityLabel). Este test
//           queda como regresión de que la fila de toggle SIGUE siendo interactiva.
//
// Estado de partida: un usuario con TELÉFONO (saltea el gate R3.8) + 1 establishment sembrado
// con 0 rodeos → el RootGate lo manda al wizard "Crear rodeo" en modo BLOQUEO TOTAL (R2.6).
//
// Usuarios + campos namespaced; cleanup en afterAll + global-teardown.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishment,
  setUserPhone,
  cleanupAll,
  anonClient,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';
import { gotoCrearRodeoStep3, completeCrearRodeo } from './helpers/rodeos';

test.afterAll(async () => {
  await cleanupAll();
});

test('BUG 2 — clickear una fila de toggle (paso 3) flippea su aria-checked', async ({ page }) => {
  const user = await createTestUser('toggle');
  await setUserPhone(user.id, '1123456789');
  // 1 campo sembrado con 0 rodeos → el RootGate manda al wizard en bloqueo total.
  await seedEstablishment(user.id, 'Campo Toggle');

  await page.goto('/');
  await signIn(page, user);

  // Llegamos al paso 3 (plantilla de datos) del wizard.
  const firstToggle = await gotoCrearRodeoStep3(page);

  // Reproduce/regresión del BUG 2: clickear la fila DEBE cambiar el aria-checked.
  const before = await firstToggle.getAttribute('aria-checked');
  expect(before === 'true' || before === 'false').toBe(true);
  await firstToggle.click();
  // Tras el tap, el estado debe haber flippeado (el re-render lo refleja).
  const expected = before === 'true' ? 'false' : 'true';
  await expect(firstToggle).toHaveAttribute('aria-checked', expected, { timeout: 10_000 });

  // Y vuelve a su estado original al tocar de nuevo (interacción real, no un latch de una vía).
  await firstToggle.click();
  await expect(firstToggle).toHaveAttribute('aria-checked', before!, { timeout: 10_000 });
});

test('BUG 1 — crear rodeo desde el empty-state aterriza en home sin el CTA "Crear rodeo" pendiente', async ({
  page,
}) => {
  const user = await createTestUser('empty');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishment(user.id, 'Campo Empty');

  await page.goto('/');
  await signIn(page, user);

  // Empty-state de bloqueo total: el wizard "Crear tu primer rodeo" (R2.6).
  await expect(page.getByText('Creá tu primer rodeo', { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // Completar el wizard (sistema cría → nombre → plantilla → crear).
  await completeCrearRodeo(page, `${RUN_TAG} Rodeo general`);

  // Tras crear, el RodeoContext pasa a 'active' → el RootGate destraba → aterriza en HOME.
  await waitForHome(page);

  // BUG 1: la home NO debe mostrar el paso del onboarding "Creá y configurá tu primer rodeo"
  // (era el Stepper estático con estado hardcodeado). Ese paso ya está hecho (el gate garantiza
  // ≥1 rodeo en la home), así que NO debe aparecer como pendiente/activo.
  await expect(page.getByText(/Creá y configurá tu primer rodeo/)).toHaveCount(0);
  // Y no debe haber un CTA "Crear rodeo" muerto (el del paso estático): la home ya no es el lugar de
  // crear el PRIMER rodeo (eso es el wizard de bloqueo total).
  await expect(page.getByRole('button', { name: 'Crear rodeo', exact: true })).toHaveCount(0);
  // Estado POSITIVO (el Stepper driveado por estado real): el paso de rodeo está HECHO y su CTA
  // lleva a la gestión ("Gestionar rodeos"), y el siguiente paso ("Cargá tu primer animal") ofrece
  // un CTA REAL navegable ("Ir a Animales") — ningún botón es un TODO muerto.
  await expect(page.getByRole('button', { name: 'Gestionar rodeos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ir a Animales', exact: true })).toBeVisible();
});

test('crear rodeo con un toggle destildado → la config queda con ese dato deshabilitado', async ({
  page,
}) => {
  const user = await createTestUser('config');
  await setUserPhone(user.id, '1123456789');
  const estId = await seedEstablishment(user.id, 'Campo Config');

  await page.goto('/');
  await signIn(page, user);

  const firstToggle = await gotoCrearRodeoStep3(page);
  // Tomamos el dato (data_key) de ese toggle por su label, y lo destildamos si está tildado.
  const label = (await firstToggle.getAttribute('aria-label')) ?? '';
  const wasOn = (await firstToggle.getAttribute('aria-checked')) === 'true';
  if (wasOn) {
    await firstToggle.click();
    await expect(firstToggle).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 });
  }

  await completeCrearRodeo(page, `${RUN_TAG} Rodeo config`, { alreadyAtStep3: true });
  await waitForHome(page);

  // Verificación server-side (anon + login del MISMO usuario para respetar RLS): el rodeo creado
  // tiene una fila de rodeo_data_config para ese field con enabled=false (el destilde persistió).
  const supa = anonClient();
  const { error: signErr } = await supa.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  expect(signErr).toBeNull();

  // Rodeo recién creado del establishment. ORÁCULO de persistencia server-side (patrón
  // `waitForServerAnimalProfile`, helpers/admin.ts): `createRodeo` es OFFLINE-FIRST vía OUTBOX
  // desde spec 15 (encola el intent create_rodeo + overlay optimista y devuelve al instante; la
  // RPC real corre async cuando PowerSync DRENA la outbox). La UI ya aterrizó en home con el rodeo
  // OPTIMISTA, pero el upload server-side puede no haber completado todavía → un read-back único
  // race-ea con el drenado (flake: el remoto devuelve 0 filas). Polleamos hasta que la fila REAL
  // aparezca server-side (RLS-respecting: anon + login del mismo usuario). El producto está bien
  // (offline-first es el diseño correcto, spec 15); es el test el que no debe asumir persistencia síncrona.
  let rodeoId = '';
  await expect
    .poll(
      async () => {
        // NO asertamos dentro del poll (un error transitorio de red abortaría el poll en vez de
        // reintentar): un fallo o un set vacío devuelve 0 → el poll reintenta hasta el timeout.
        const { data } = await supa
          .from('rodeos')
          .select('id, name')
          .eq('establishment_id', estId)
          .eq('active', true)
          .is('deleted_at', null);
        if (data && data.length > 0) {
          rodeoId = data[0].id as string;
          return data.length;
        }
        return 0;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  // El field_definition por su label (catálogo global).
  const { data: fields } = await supa
    .from('field_definitions')
    .select('id, label')
    .eq('label', label);
  expect(fields && fields.length).toBeGreaterThan(0);
  const fieldId = fields![0].id as string;

  // La config del rodeo para ese field debe estar enabled=false (el destilde se guardó).
  const { data: cfg } = await supa
    .from('rodeo_data_config')
    .select('enabled')
    .eq('rodeo_id', rodeoId)
    .eq('field_definition_id', fieldId)
    .maybeSingle();
  expect(cfg).not.toBeNull();
  expect(cfg!.enabled).toBe(false);

  await supa.auth.signOut();
});
