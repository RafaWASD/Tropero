// e2e/social-login.spec.ts — render de los botones de LOGIN SOCIAL en web (spec 19, T20).
//
// Red de seguridad de RENDER (el happy-path real de Google/Apple NO es automatizable: exige
// credenciales reales + UI de terceros + la config externa de Raf). Acá se verifica que, en el bundle
// web estático (`expo export -p web`), sign-in y sign-up montan:
//   - el divisor "o" (AuthDivider, testID auth-divider)
//   - el botón "Continuar con Google"
//   - el botón "Continuar con Apple" (web SÍ muestra Apple — Platform.OS === 'web', R4.3)
//
// NO se hace click-through: tocar un botón dispararía un redirect OAuth real al proveedor (fuera de
// alcance E2E). Solo se asserta presencia + wiring montado. Cubre R4.1, R4.2(web), R4.3(web), R4.6
// (presencia; el branding sin recolorear se veta con capturas en Gate 2.5), R4.7, R3.1/R3.2 (presencia).
//
// Importa `test`/`expect` de ./helpers/fixtures (shim de env) o las pantallas con PowerSync bootean en
// blanco (memoria e2e_fixtures_import).

import { test, expect } from './helpers/fixtures';
import { waitForSignIn } from './helpers/ui';

test('sign-in muestra divisor + botón Google + botón Apple (web)', async ({ page }) => {
  await page.goto('/');
  await waitForSignIn(page);

  // Divisor "o" (ancla estable por testID; la letra suelta no es scopeble por texto).
  await expect(page.getByTestId('auth-divider')).toBeVisible();
  // Botón de Google (branding + label es-AR con la "g" con descendente).
  await expect(page.getByRole('button', { name: 'Continuar con Google', exact: true })).toBeVisible();
  // Botón de Apple: web SÍ lo muestra (redirect OAuth), a diferencia de Android.
  await expect(page.getByRole('button', { name: 'Continuar con Apple', exact: true })).toBeVisible();
});

test('sign-up muestra el MISMO bloque social (mismo layout, R4.7)', async ({ page }) => {
  await page.goto('/');
  await waitForSignIn(page);

  // Expo Router hace push (no replace): sign-in QUEDA montado debajo de sign-up → hay DOS de cada botón
  // social en el DOM. Scopeamos con .last() (sign-up se montó ÚLTIMO, queda al final del DOM), igual que
  // auth.spec.ts hace con los campos compartidos.
  await page.getByRole('button', { name: /No tengo cuenta/ }).click();
  await expect(page.getByRole('button', { name: 'Crear cuenta', exact: true })).toBeVisible();

  await expect(page.getByTestId('auth-divider').last()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Continuar con Google', exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Continuar con Apple', exact: true }).last(),
  ).toBeVisible();
});
