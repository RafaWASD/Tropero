// e2e/captures/spec10-uib2-screenshots.capture.ts — CAPTURA de pantallas para el design-review de spec 10
// chunk UI-B2 (pantalla de VACUNACIÓN MASIVA: pre-config + filtro + preview "N eventos sobre M animales" +
// skip-and-report).
//
// NO es un test de regresión: es un GENERADOR DE SCREENSHOTS fieles al código ACTUAL. Por eso el nombre
// es `.capture.ts` (NO `.spec.ts`) → NO lo recoge el `pnpm e2e` de regresión; se corre a mano:
//
//   pnpm exec playwright test e2e/captures/spec10-uib2-screenshots.capture.ts --config playwright.capture.config.ts
//
// Genera (design/spec10-ui-b2/):
//   - vacunacion-preview.png  → la pantalla de vacunación: producto + vía (3 chips CURADOS de vacuna —
//     Subcutánea/Intramuscular/Intranasal, "Subcutánea" seleccionada — NO las 6 del enum ni texto libre)
//     + filtro opcional (categoría/sexo) + preview "N eventos sobre M animales" (una vacunación por
//     animal) + CTA vivo "Vacunar M animales".
//   - vacunacion-skip.png     → el mismo flujo pero con un animal YA vacunado hoy → el preview muestra el
//     skip-and-report ("1 animal se saltea · ya tiene esta vacunación cargada hoy").
//
// Reusa el harness E2E al 100% (fixtures + helpers/admin + helpers/ui). Siembra un OWNER con teléfono
// (saltea el gate R3.8) + 1 rodeo de cría con `vacunacion` habilitado + animales variados. Viewport mobile
// 412 (config). Limpia todo al final.

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
import { bulkEventId } from '../../src/utils/bulk-idempotency';

// design/spec10-ui-b2/ vive en el repoRoot (un nivel arriba de app/).
const OUT_DIR = path.resolve(APP_ROOT, '..', 'design', 'spec10-ui-b2');

/** Habilita el data_key `vacunacion` en el rodeo (para que la vista de grupo ofrezca Vacunar). */
async function enableVaccination(rodeoId: string): Promise<void> {
  const { data: field, error: fErr } = await admin
    .from('field_definitions')
    .select('id')
    .eq('data_key', 'vacunacion')
    .maybeSingle();
  if (fErr) throw new Error(`enableVaccination (field): ${fErr.message}`);
  if (!field) throw new Error('enableVaccination: no existe el field_definition `vacunacion`.');
  const { error } = await admin
    .from('rodeo_data_config')
    .upsert(
      { rodeo_id: rodeoId, field_definition_id: field.id, enabled: true },
      { onConflict: 'rodeo_id,field_definition_id' },
    );
  if (error) throw new Error(`enableVaccination (upsert): ${error.message}`);
}

/**
 * Inserta una vacunación ya aplicada HOY para un perfil, con el id DETERMINÍSTICO (UUIDv5) que la masiva
 * generaría para ese (perfil, 'vaccination', hoy) — así la barrera idempotente local lo detecta como
 * already_applied (mismo criterio que un re-run real de la masiva: R6.1/R4.3).
 */
async function seedVaccinationToday(profileId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const id = bulkEventId({ animalProfileId: profileId, type: 'vaccination', date: today });
  const { error } = await admin.from('sanitary_events').insert({
    id,
    animal_profile_id: profileId,
    event_type: 'vaccination',
    product_name: 'Mancha-gangrena',
    event_date: today,
  });
  if (error) throw new Error(`seedVaccinationToday: ${error.message}`);
}

test.afterAll(async () => {
  await cleanupAll();
});

test('capturas spec 10 UI-B2 (vacunación masiva: preview + skip-and-report)', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  const today = new Date();
  const ageISO = (years: number, months = 0) => {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - years);
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };

  // ── Seed: owner + campo + rodeo de cría con `vacunacion` habilitado + animales variados ──────────
  const user = await createTestUser('uib2shots', 'Facundo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'La Vacuna');
  await enableVaccination(rodeoId);

  // Mezcla de categorías + sexos para mostrar el filtro opcional.
  await seedAnimal(establishmentId, rodeoId, { idv: '5001', sex: 'male', categoryCode: 'ternero', categoryOverride: true, birthDate: ageISO(0, 7) });
  await seedAnimal(establishmentId, rodeoId, { idv: '5002', sex: 'male', categoryCode: 'ternero', categoryOverride: true, birthDate: ageISO(0, 6) });
  await seedAnimal(establishmentId, rodeoId, { idv: '5003', sex: 'female', categoryCode: 'ternera', categoryOverride: true, birthDate: ageISO(0, 8) });
  await seedAnimal(establishmentId, rodeoId, { idv: '5101', sex: 'male', categoryCode: 'torito', categoryOverride: true, birthDate: ageISO(1, 6) });
  await seedAnimal(establishmentId, rodeoId, { idv: '5201', sex: 'female', categoryCode: 'vaquillona', categoryOverride: true, birthDate: ageISO(1, 8) });
  // Este YA tiene una vacunación cargada hoy → aparecerá en el skip-and-report.
  const alreadyVacc = await seedAnimal(establishmentId, rodeoId, { idv: '5009', sex: 'male', categoryCode: 'ternero', categoryOverride: true, birthDate: ageISO(0, 5) });
  await seedVaccinationToday(alreadyVacc);

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

  // ── Abrir la pantalla de VACUNACIÓN ─────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Vacunar', exact: true }).click();
  // Header "Vacunar" + el campo de producto + el bloque de filtro + el preview.
  await expect(page.getByText('Filtrar (opcional)', { exact: true })).toBeVisible({ timeout: 20_000 });

  // 1) PREVIEW por default (todos los activos): "N eventos sobre M animales". Cargar el producto para que
  //    el CTA quede habilitado (la pantalla se ve completa, lista para confirmar).
  await page.getByPlaceholder('Ej. Mancha-gangrena').fill('Mancha-gangrena');
  // Vía: selector de CHIPS (fix VIA-ENUM-MISMATCH — ya NO es texto libre). Verificar que están las 3
  // vías CURADAS de vacuna (SC/IM/Intranasal) y que las que NO son de vacuna (Oral/Tópica/Otra) YA NO
  // aparecen; seleccionar "Subcutánea" para que la captura muestre el chip activo (no texto a mano).
  await expect(page.getByText('Vía (opcional)', { exact: true })).toBeVisible({ timeout: 20_000 });
  for (const label of ['Subcutánea', 'Intramuscular', 'Intranasal']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible({ timeout: 20_000 });
  }
  for (const gone of ['Oral', 'Tópica', 'Otra']) {
    await expect(page.getByRole('button', { name: gone, exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Subcutánea', exact: true }).click();
  // El preview muestra "N eventos sobre M animales" (uno por animal). Esperamos que aparezca.
  await expect(page.getByText(/eventos sobre \d+ animales|evento sobre \d+ animal/)).toBeVisible({ timeout: 20_000 });
  // El skip-and-report depende de que el evento sembrado (admin) haya sincronizado al SQLite local del
  // cliente web. Le damos tiempo a que baje (el preview se recalcula al enfocar / cuando cambia el filtro).
  // Si llegó, lo capturamos; si hubo lag de sync, igual capturamos la pantalla del preview (sin romper).
  await expect(page.getByText(/se saltea|se saltean/)).toBeVisible({ timeout: 25_000 }).catch(() => {});
  // El CTA vivo abajo.
  await expect(page.getByRole('button', { name: /Vacunar \d+ animal/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'vacunacion-preview.png'), fullPage: false });

  // 2) FILTRO por categoría: tocar "Terneros" → el preview se recalcula al subconjunto. La captura del
  //    filtro aplicado (el preview muestra el subconjunto + el skip si el ya-vacunado cayó en la categoría).
  await page.getByRole('button', { name: /Ternero \(\d+\)/ }).first().click();
  await expect(page.getByText(/eventos sobre \d+ animales|evento sobre \d+ animal|Ningún animal nuevo/)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'vacunacion-skip.png'), fullPage: false });
});
