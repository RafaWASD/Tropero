// e2e/captures/spec10-uib-screenshots.capture.ts — CAPTURA de pantallas para el design-review de spec 10
// chunk UI-B (pantalla de SELECCIÓN MASIVA explícita + bottom-sheet de confirmación + vista de grupo SIN
// la card "Datos que se cargan acá").
//
// NO es un test de regresión: es un GENERADOR DE SCREENSHOTS fieles al código ACTUAL. Por eso el nombre
// es `.capture.ts` (NO `.spec.ts`) → NO lo recoge el `pnpm e2e` de regresión; se corre a mano:
//
//   pnpm exec playwright test e2e/captures/spec10-uib-screenshots.capture.ts --config playwright.capture.config.ts
//
// Genera (design/spec10-ui-b/):
//   - seleccion-castracion.png   → pantalla de selección de CASTRACIÓN: secciones Terneros/Adultos,
//     defaults pre-tildados (terneros comunes), un ⭐ futuro torito TILDADO y RESALTADO en terracota,
//     CTA con número vivo.
//   - bottom-sheet.png           → el bottom-sheet de confirmación: desglose por categoría, "⚠ N futuros
//     toritos incluidos" + copy reversible ("Podés corregirlo después desde la ficha de cada animal").
//   - vista-grupo-sin-card.png   → la vista de grupo SIN la card "Datos que se cargan acá".
//
// Reusa el harness E2E al 100% (fixtures + helpers/admin + helpers/ui). Siembra un OWNER con teléfono
// (saltea el gate R3.8) + 1 rodeo de cría con animales variados (terneros comunes + un ternero ⭐ +
// adultos toritos/toro + terneras). Viewport mobile 412 (config). Limpia todo al final.

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { test } from '../helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { APP_ROOT } from '../helpers/env';
import { signIn, waitForHome } from '../helpers/ui';
import { expect } from '@playwright/test';

// design/spec10-ui-b/ vive en el repoRoot (un nivel arriba de app/).
const OUT_DIR = path.resolve(APP_ROOT, '..', 'design', 'spec10-ui-b');

/** Marca future_bull=true en un perfil vía service_role (el trigger 0085 lo respeta en machos enteros). */
async function markFutureBull(profileId: string): Promise<void> {
  const { error } = await admin.from('animal_profiles').update({ future_bull: true }).eq('id', profileId);
  if (error) throw new Error(`markFutureBull: ${error.message}`);
}

test.afterAll(async () => {
  await cleanupAll();
});

test('capturas spec 10 UI-B (selección masiva + bottom-sheet + vista de grupo sin card)', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  const today = new Date();
  const ageISO = (years: number, months = 0) => {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - years);
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };

  // ── Seed: owner + campo + rodeo de cría con animales variados ──────────────────────────────────
  const user = await createTestUser('uibshots', 'Facundo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'La Esperanza');

  // Terneros COMUNES (machos) → pre-tildados por default en castración.
  await seedAnimal(establishmentId, rodeoId, { idv: '3301', sex: 'male', categoryCode: 'ternero', categoryOverride: true, birthDate: ageISO(0, 7) });
  await seedAnimal(establishmentId, rodeoId, { idv: '3302', sex: 'male', categoryCode: 'ternero', categoryOverride: true, birthDate: ageISO(0, 6) });
  await seedAnimal(establishmentId, rodeoId, { idv: '3303', sex: 'male', categoryCode: 'ternero', categoryOverride: true, birthDate: ageISO(0, 8) });
  // Ternero ⭐ FUTURO TORITO → arranca SIN tildar; al tildarlo se RESALTA en terracota (R11.6).
  const ternEstrella = await seedAnimal(establishmentId, rodeoId, { idv: '1042', sex: 'male', categoryCode: 'ternero', categoryOverride: true, birthDate: ageISO(0, 9) });
  await markFutureBull(ternEstrella);
  // Adultos (toritos/toro) → sección "Adultos", sin tildar por default.
  await seedAnimal(establishmentId, rodeoId, { idv: '1101', sex: 'male', categoryCode: 'torito', categoryOverride: true, birthDate: ageISO(1, 6) });
  await seedAnimal(establishmentId, rodeoId, { idv: '4401', sex: 'male', categoryCode: 'toro', categoryOverride: true, birthDate: ageISO(4) });
  // Hembras (terneras) → NO son candidatas de castración (no aparecen); sí de destete.
  await seedAnimal(establishmentId, rodeoId, { idv: '3401', sex: 'female', categoryCode: 'ternera', categoryOverride: true, birthDate: ageISO(0, 7) });

  // ── Login → home ──────────────────────────────────────────────────────────────────────────────
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await expect(page.getByText('Mis rodeos', { exact: true })).toBeVisible({ timeout: 30_000 });

  // ── Entrar a la vista de grupo del rodeo ───────────────────────────────────────────────────────
  const rodeoCard = page.getByRole('button', { name: /Cría · \d+ cabezas/ }).first();
  await expect(rodeoCard).toBeVisible({ timeout: 20_000 });
  await rodeoCard.click();
  await expect(page.getByText('Acciones del grupo', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 3) Vista de grupo SIN la card "Datos que se cargan acá" ────────────────────────────────────
  // ORÁCULO de la remoción: el título de la card vieja NO debe existir.
  await expect(page.getByText('Datos que se cargan acá', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'vista-grupo-sin-card.png'), fullPage: false });

  // ── 1) Pantalla de selección de CASTRACIÓN ─────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Castrar', exact: true }).click();
  // El header "Castrar" + el contador vivo + las secciones por categoría. Esperamos a que carguen los
  // candidatos (las filas de los terneros pre-tildados).
  await expect(page.getByText('Terneros', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Adultos', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  // Tildamos el ternero ⭐ (1042) para mostrar el RESALTADO terracota (R11.6, sin modal).
  const starRow = page.getByRole('checkbox', { name: /1042/ }).first();
  await expect(starRow).toBeVisible({ timeout: 20_000 });
  await starRow.click();
  // El CTA con número vivo abajo ("Castrar N animales").
  await expect(page.getByRole('button', { name: /Castrar \d+ animal/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'seleccion-castracion.png'), fullPage: false });

  // ── 2) Bottom-sheet de confirmación ────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Castrar \d+ animal/ }).click();
  // El sheet: título + desglose + ⚠ futuros toritos + copy reversible.
  await expect(page.getByText('Confirmar castración', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/futuro torito incluido|futuros toritos incluidos/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Podés corregirlo después desde la ficha de cada animal.', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'bottom-sheet.png'), fullPage: false });
});
