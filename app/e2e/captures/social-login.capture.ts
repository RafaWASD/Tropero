// e2e/captures/social-login.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// del feature 19 `login-social`: botones de login social (Google/Apple) + divisor en sign-in y sign-up.
//
// Recorre el render de las dos pantallas de auth y saca capturas NOMBRADAS de cada estado clave a
// __shots__/social-login/:
//   01 — sign-in: CTA "Iniciar sesión" + divisor "o" + botón "Continuar con Google" (logo 4 colores,
//        SIN recolorear, R4.6) + botón "Continuar con Apple" (web muestra Apple). Ojo al recorte de la
//        "g" de "Google" (descendente) → NO debe clipearse.
//   02 — sign-up: MISMO bloque social bajo "Crear cuenta" (mismo layout, R4.7).
//
// Render-only: NO se crea usuario ni se toca la DB (el happy-path real de Google/Apple no es
// automatizable). NO se hace click-through (dispararía un redirect OAuth real). Viewport mobile 412×915
// heredado de la base. NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/social-login.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, expect, type Page } from '../helpers/fixtures';
import { waitForSignIn } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'social-login');

/** Captura NOMBRADA tras un breve settle de layout (el llamador ya asertó visible el elemento clave). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test('capturas login social — sign-in y sign-up @ 412px', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await waitForSignIn(page);

  // (01) sign-in con el bloque social completo.
  await expect(page.getByTestId('auth-divider')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con Google', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con Apple', exact: true })).toBeVisible();
  await shot(page, '01-sign-in-social');

  // (02) sign-up con el MISMO bloque (mismo layout, R4.7). Expo Router hace push → sign-in queda debajo,
  // por eso scopeamos con .last() (sign-up montó último).
  await page.getByRole('button', { name: /No tengo cuenta/ }).click();
  await expect(page.getByRole('button', { name: 'Crear cuenta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con Google', exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con Apple', exact: true }).last()).toBeVisible();
  await shot(page, '02-sign-up-social');
});
