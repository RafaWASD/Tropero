// e2e/auth.spec.ts — red de seguridad de los flujos de AUTENTICACIÓN (spec 01).
//
// Cubre el camino crítico donde aparecen bugs de runtime que escapan a typecheck/unit:
//   - Login con usuario pre-confirmado → aterriza en ONBOARDING (no tiene campos todavía).
//   - Validación de inputs de sign-up (cliente: nombre/email/password) sin tocar el server.
//   - Logout vuelve a login (re-ruteo del AuthGate al cambiar el AuthState).
//
// Todos los usuarios son namespaced (@rafaq-e2e.test) y se borran en afterAll + global-teardown.

import { test, expect } from './helpers/fixtures';
import { createTestUser, cleanupAll, type TestUser } from './helpers/admin';
import { signIn, waitForSignIn, waitForOnboarding, waitForHome } from './helpers/ui';

test.afterAll(async () => {
  // Limpieza de los usuarios creados por este archivo (idempotente; global-teardown re-barre).
  await cleanupAll();
});

test('login con usuario pre-confirmado y SIN campos aterriza en onboarding', async ({ page }) => {
  const user: TestUser = await createTestUser('login');

  await page.goto('/');
  await signIn(page, user);

  // Usuario verificado sin user_roles activos → EstablishmentState 'no_establishments' →
  // RootGate re-rutea a /onboarding (wizard R6.5). No navegamos a mano: esperamos el destino.
  await waitForOnboarding(page);
  // El CTA secundario del wizard también debe estar (puerta de invitación, stub).
  await expect(page.getByRole('button', { name: 'Pegar link de invitación' })).toBeVisible();
});

test('sign-up valida los inputs en cliente sin pegarle al server', async ({ page }) => {
  await page.goto('/');
  await waitForSignIn(page);

  // Vamos a la pantalla de crear cuenta. OJO: Expo Router hace router.push (no replace), así que
  // la pantalla de sign-in QUEDA MONTADA en el back-stack debajo de sign-up → hay DOS inputs
  // "Email" / "Contraseña" en el DOM. Por eso scopeamos al form de sign-up por su único campo
  // "Nombre" (solo existe en sign-up) y usamos .last() para los campos compartidos (sign-up se
  // montó ÚLTIMO, queda al final del DOM).
  await page.getByRole('button', { name: /No tengo cuenta/ }).click();
  const crearCuentaBtn = page.getByRole('button', { name: 'Crear cuenta', exact: true });
  await expect(crearCuentaBtn).toBeVisible();

  // Submit vacío → la validación de cliente (validateSignUp) marca errores y NO hay sesión.
  await crearCuentaBtn.click();
  // El form sigue mostrando el botón "Crear cuenta" (no avanzó al estado "Verificá tu email").
  await expect(crearCuentaBtn).toBeVisible();
  // No debe haber aterrizado en el estado post-signup (título "Verificá tu email" de ese estado).
  await expect(page.getByText('Verificá tu email', { exact: true })).toHaveCount(0);

  // Password demasiado corta (≥8 requerido) con nombre + email válidos → sigue sin avanzar.
  await page.getByLabel('Nombre', { exact: true }).fill('Tester E2E');
  await page.getByLabel('Email', { exact: true }).last().fill('alguien@example.com');
  await page.getByLabel('Contraseña', { exact: true }).last().fill('123');
  await crearCuentaBtn.click();
  await expect(crearCuentaBtn).toBeVisible();
  await expect(page.getByText('Verificá tu email', { exact: true })).toHaveCount(0);
});

test('login con credenciales inválidas muestra error y no navega', async ({ page }) => {
  const user: TestUser = await createTestUser('badpass');

  await page.goto('/');
  await waitForSignIn(page);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill('PasswordEquivocada!9');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();

  // Sigue en la pantalla de login (no aterrizó en onboarding/home). El botón de login persiste.
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear mi primer campo' })).toHaveCount(0);
});

test('logout desde Más vuelve a la pantalla de login', async ({ page }) => {
  // Usuario con un campo sembrado → al login aterriza en HOME (estado active).
  const user = await createTestUser('logout');
  // Le damos un campo para que caiga en home (no en onboarding) y podamos ir a la tab "Más".
  const { seedEstablishment, setUserPhone } = await import('./helpers/admin');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishment(user.id, 'Campo Logout');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Vamos a la tab "Más" (bottom nav) y cerramos sesión. La confirmación es window.confirm en web.
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByText('Más', { exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // signOut() → AuthState 'unauthenticated' → RootGate re-rutea al grupo de auth.
  await waitForSignIn(page);
});
