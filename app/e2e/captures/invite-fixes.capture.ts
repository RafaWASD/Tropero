// e2e/captures/invite-fixes.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029)
// de los 2 bugfixes del flujo de INVITACIÓN (loop de /invite?token= + backOr en la fase paste).
//
// El fix NO reestiliza ninguna pantalla; recorre los ESTADOS VISIBLES de /invite para vetarlos tal
// cual quedan tras el cambio. Saca capturas NOMBRADAS a __shots__/invite-fixes/:
//   01 — paste: sin token → "Pegá tu invitación" (acá vive el botón "Cancelar" = backOr(router,'/(tabs)')).
//   02 — auth_required: /invite?token= DESLOGUEADO → "Sumate al campo" (Registrarme / Iniciar sesión).
//   03 — confirm: /invite?token= LOGUEADO (carga fresca, el path que antes loopeaba) → "¿Aceptar esta
//        invitación?" (confirm genérico sin preview, hallazgo RLS #3).
//
// La fase 'resolving' (loading breve mientras auth resuelve) NO se captura: es transitoria (flash de
// milisegundos) y reusa el MISMO shell ya vetado que 'accepting' (AuthScreenShell + InfoNote).
//
// Viewport mobile 412×915 (heredado de la base). NO corras esto en `pnpm e2e` (es un `.capture.ts`);
// lo dispara el leader:
//   pnpm exec playwright test e2e/captures/invite-fixes.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, expect, applyEnvShim, type Page } from '../helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedInvitation,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForOnboarding } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'invite-fixes');

/** Captura NOMBRADA tras un breve settle de layout (el llamador ya asertó visible el elemento clave). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test.afterAll(async () => {
  await cleanupAll();
});

test('capturas invite-fixes — paste / auth_required / confirm @ 412px', async ({ page, browser }) => {
  test.setTimeout(120_000);

  const owner = await createTestUser('capowner');
  const invitee = await createTestUser('capinvitee', 'Invitado Captura');
  await setUserPhone(owner.id, '1123456789');
  await setUserPhone(invitee.id, '1198765432');
  const { establishmentId } = await seedEstablishmentWithRodeo(owner.id, 'Campo Captura');
  const token = await seedInvitation(establishmentId, owner.id, { role: 'veterinarian' });
  const inviteUrl = `/invite?token=${encodeURIComponent(token)}`;

  // (01) + (02) en un contexto DESLOGUEADO aparte: la fase 'auth_required' PERSISTE el token (R5.13),
  // así que hacemos estas dos capturas en su propio contexto para que ese token NO se filtre al de
  // confirm (si no, tras el login el RootGate re-rutearía a /invite por el token persistido).
  const deslog = await browser.newContext();
  const dp = await deslog.newPage();
  await applyEnvShim(dp);

  // (01) paste — sin token. El botón "Cancelar" usa backOr(router, '/(tabs)').
  await dp.goto('/invite');
  await expect(dp.getByRole('button', { name: 'Continuar', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(dp.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
  await shot(dp, '01-paste');

  // (02) auth_required — /invite?token= deslogueado (persiste el token, R5.13).
  await dp.goto(inviteUrl);
  await expect(dp.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(dp.getByRole('button', { name: 'Ya tengo cuenta · Iniciar sesión' })).toBeVisible();
  await shot(dp, '02-auth-required');
  await deslog.close();

  // (03) confirm — carga fresca de /invite?token= con sesión ACTIVA (el path que loopeaba). Contexto
  // LIMPIO (`page` por defecto): login in-app → onboarding → goto fresco → fase confirm (sin persistir
  // el token → sin loop).
  await page.goto('/');
  await signIn(page, invitee);
  await waitForOnboarding(page);
  await page.goto(inviteUrl);
  await expect(page.getByRole('button', { name: 'Aceptar invitación' })).toBeVisible({ timeout: 30_000 });
  await shot(page, '03-confirm');
});
