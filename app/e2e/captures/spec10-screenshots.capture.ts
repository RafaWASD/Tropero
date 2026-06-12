// e2e/captures/spec10-screenshots.capture.ts — CAPTURA de pantallas para el design-review de spec 10
// chunk UI-A (Inicio rodeo-céntrico + vista de grupo rodeo/lote + AnimalRow compacta).
//
// NO es un test de regresión: es un GENERADOR DE SCREENSHOTS fieles al código ACTUAL (con los 2 fixes
// del polish: header de GroupActionsBar reconciliado + "Cría · N cabezas" en la card de rodeo). Por eso
// el nombre es `.capture.ts` (NO `.spec.ts`) → NO lo recoge el `pnpm e2e` de regresión; se corre a mano:
//
//   pnpm exec playwright test e2e/captures/spec10-screenshots.capture.ts --config playwright.capture.config.ts
//
// (la config de captura amplía el testMatch para incluir `*.capture.ts` y deja el viewport mobile 412).
//
// Reusa el harness E2E al 100%: fixtures (shim de env del bundle web), helpers/admin (seed vía
// service_role) y helpers/ui (login). Siembra DOS usuarios OWNER con teléfono (saltean el gate R3.8):
//   - ONBOARDEADO ("La Esperanza"): 1 rodeo de cría con ~8 animales de categorías variadas (incluye
//     torito/toro/ternero/hembras + UNO marcado future_bull=true para el badge ⭐) + 1 lote + 1 OTRO
//     miembro (vet) → los 3 pasos del wizard de "primeros pasos" están done → el stepper NO aparece.
//     Genera: inicio-onboardeado.png (stepper oculto, cards visibles), mas.png (íconos rodeo=cubos /
//     lote=pila), vista-grupo-rodeo.png, vista-grupo-lote.png, animalrow-detalle.png.
//   - NUEVO ("El Comienzo"): 1 rodeo, SIN animales y SIN equipo → 2 pasos pendientes → el stepper SÍ
//     aparece. Genera: inicio-nuevo.png.
// Captura a viewport mobile (412 de ancho, definido en la config) y limpia todo al final (cleanupAll +
// teardown).

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { test } from '../helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  addMember,
  cleanupAll,
  RUN_TAG,
} from '../helpers/admin';
import { APP_ROOT } from '../helpers/env';
import { signIn, waitForHome, gotoTab } from '../helpers/ui';
import { expect } from '@playwright/test';

// design/spec10-ui-a/ vive en el repoRoot (un nivel arriba de app/).
const OUT_DIR = path.resolve(APP_ROOT, '..', 'design', 'spec10-ui-a');

test.afterAll(async () => {
  await cleanupAll();
});

/**
 * Crea un lote (management_group) vía service_role y le asigna `profileIds` como miembros (setea
 * animal_profiles.management_group_id). Bypassa RLS (fixture); el FK 0037 valida same-establishment.
 */
async function seedLote(establishmentId: string, name: string, profileIds: string[]): Promise<string> {
  const { data: ins, error: insErr } = await admin
    .from('management_groups')
    .insert({ establishment_id: establishmentId, name: `${RUN_TAG} ${name}` })
    .select('id')
    .single();
  if (insErr) throw new Error(`seedLote insert: ${insErr.message}`);
  const groupId = ins.id as string;
  if (profileIds.length > 0) {
    const { error: upErr } = await admin
      .from('animal_profiles')
      .update({ management_group_id: groupId })
      .in('id', profileIds);
    if (upErr) throw new Error(`seedLote assign: ${upErr.message}`);
  }
  return groupId;
}

/** Marca future_bull=true en un perfil vía service_role (el trigger 0085 lo respeta en machos enteros). */
async function markFutureBull(profileId: string): Promise<void> {
  const { error } = await admin.from('animal_profiles').update({ future_bull: true }).eq('id', profileId);
  if (error) throw new Error(`markFutureBull: ${error.message}`);
}

test('capturas spec 10 UI-A (Inicio + vista de grupo rodeo/lote + AnimalRow)', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  // ── Seed: usuario owner + campo + rodeo de cría + animales variados + 1 lote ──────────────────────
  const user = await createTestUser('shots', 'Facundo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'La Esperanza');

  // ~8 animales de categorías variadas (cría). birth_date para que la fila compacta muestre la edad.
  // Identificadores cortos/legibles para el design-review (no namespaced — el cleanup va por el campo).
  const today = new Date();
  const ageISO = (years: number, months = 0) => {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - years);
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };

  // Un torito (macho entero ≤2 años) que marcamos future_bull → badge ⭐ "Futuro torito".
  const toritoEstrella = await seedAnimal(establishmentId, rodeoId, {
    idv: '1042',
    sex: 'male',
    categoryCode: 'torito',
    categoryOverride: true,
    birthDate: ageISO(1, 2),
  });
  await markFutureBull(toritoEstrella);

  // Resto del rodeo: variedad de categorías (hembras + un toro + un ternero + más).
  await seedAnimal(establishmentId, rodeoId, {
    idv: '2210', sex: 'female', categoryCode: 'vaca_segundo_servicio', categoryOverride: true, birthDate: ageISO(5),
  });
  await seedAnimal(establishmentId, rodeoId, {
    idv: '2211', sex: 'female', categoryCode: 'vaquillona', categoryOverride: true, birthDate: ageISO(2),
  });
  await seedAnimal(establishmentId, rodeoId, {
    idv: '2212', sex: 'female', categoryCode: 'vaquillona_prenada', categoryOverride: true, birthDate: ageISO(2, 6),
  });
  await seedAnimal(establishmentId, rodeoId, {
    idv: '3301', sex: 'male', categoryCode: 'ternero', categoryOverride: true, birthDate: ageISO(0, 7),
  });
  await seedAnimal(establishmentId, rodeoId, {
    idv: '3302', sex: 'female', categoryCode: 'ternera', categoryOverride: true, birthDate: ageISO(0, 5),
  });
  await seedAnimal(establishmentId, rodeoId, {
    idv: '4401', sex: 'male', categoryCode: 'toro', categoryOverride: true, birthDate: ageISO(4),
  });
  const torito2 = await seedAnimal(establishmentId, rodeoId, {
    idv: '1043', sex: 'male', categoryCode: 'torito', categoryOverride: true, birthDate: ageISO(1, 8),
  });

  // 1 lote con algunos miembros (subset del rodeo: el torito⭐ + una vaca + un ternero).
  await seedLote(establishmentId, 'Lote destete', [toritoEstrella, torito2]);

  // 1 OTRO miembro (un vet) → cierra el paso de "equipo" del wizard de primeros pasos. Con rodeo +
  // animales + equipo, los 3 pasos quedan done → el stepper se OCULTA (cambio 2 de esta iteración).
  const vet = await createTestUser('shotsvet', 'Veterinario');
  await addMember(vet.id, establishmentId, 'veterinarian');

  // ── Login → home ──────────────────────────────────────────────────────────────────────────────
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── 1) Inicio rodeo-céntrico — campo ONBOARDEADO (stepper OCULTO) ──────────────────────────────
  // Esperamos a que la sección "Mis rodeos" + la card del rodeo (con "Cría · N cabezas" tras el sync)
  // estén visibles. El sub-título "Cría · N cabezas" confirma el Fix 2 (sistema en la card de rodeo).
  await expect(page.getByText('Mis rodeos', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Cría · \d+ cabezas/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Lotes', { exact: true })).toBeVisible({ timeout: 30_000 });
  // ORÁCULO del cambio 2: con los 3 pasos done el wizard de "primeros pasos" NO debe renderizarse.
  // Esperamos a que el conteo de animales y de equipo resuelvan (la home oculta el stepper cuando
  // hasAnimals===true && teamStarted): el título del primer paso del wizard NO debe quedar presente.
  await expect(page.getByText('Cargaste tu primer animal', { exact: true })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText('Configurá tu rodeo', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Cargá tu primer animal', { exact: true })).toHaveCount(0);
  // Pequeña espera para que termine de asentar el layout/animaciones antes del shot.
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'inicio-onboardeado.png'), fullPage: false });

  // ── 1b) "Más" — íconos unificados (Rodeos=cubos / Lotes=pila) ──────────────────────────────────
  // El cambio 1 unifica la convención de íconos. Capturamos la pantalla "Más" con las dos filas
  // ("Rodeos" / "Lotes") visibles. Ancla: el título de sección "Perfil" (primero de la pantalla).
  await gotoTab(page, 'Más', page.getByText('Perfil', { exact: true }));
  // Las filas "Rodeos"/"Lotes" son ActionRow (role=button) con a11y label propio → único, sin la
  // ambigüedad de getByText('Lotes') (que también matchea la sección "Lotes" de Inicio en el árbol).
  await expect(page.getByRole('button', { name: 'Ver y gestionar los rodeos del campo' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Ver y gestionar los lotes del campo' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, 'mas.png'), fullPage: false });

  // Volvemos a Inicio para las vistas de grupo.
  await gotoTab(page, 'Inicio', page.getByText('Mis rodeos', { exact: true }));

  // ── 2) Vista de grupo del RODEO ───────────────────────────────────────────────────────────────
  // Tocamos la card del rodeo (su a11y label es "<nombre del rodeo>, Cría · N cabezas" — el nombre va
  // namespaced con el RUN_TAG; el "Cría · N cabezas" es único de la única card de rodeo). Aterriza en
  // /rodeo/[id].
  const rodeoCard = page.getByRole('button', { name: /Cría · \d+ cabezas/ }).first();
  await expect(rodeoCard).toBeVisible({ timeout: 20_000 });
  await rodeoCard.click();

  // La vista de grupo: meta header + lista de AnimalRow compactas + GroupActionsBar (3 acciones).
  await expect(page.getByText('Acciones del grupo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Castrar', exact: true })).toBeVisible({ timeout: 20_000 });
  // El badge ⭐ del torito future_bull (a11y "Futuro torito") confirma el seed.
  await expect(page.getByText('Futuro torito', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, 'vista-grupo-rodeo.png'), fullPage: false });

  // ── 4) AnimalRow de cerca (recorte de la lista: arranca en el primer AnimalRow) ────────────────
  // Capturamos un recorte enfocando 2-3 filas (una con el badge ⭐). Ubicamos la fila del torito⭐, la
  // traemos a viewport y tomamos un clip que la incluya con la(s) vecina(s). El clip se CLAMPEA al
  // viewport (412×915) y se garantiza una altura mínima → evita el PNG degenerado de ~137 bytes que
  // salía si la fila quedaba en el borde y `box.y - box.height` daba un clip casi vacío.
  const VIEWPORT_W = 412;
  const VIEWPORT_H = 915;
  const starRow = page.getByRole('button', { name: /Torito, 1042/ }).first();
  await expect(starRow).toBeVisible({ timeout: 20_000 });
  await starRow.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await starRow.boundingBox();
  if (box) {
    // Una fila por encima como contexto, pero clampeado a 0 y al viewport.
    const clipTop = Math.max(0, Math.min(box.y - box.height, VIEWPORT_H - 1));
    const maxHeight = VIEWPORT_H - clipTop;
    const height = Math.max(box.height, Math.min(box.height * 3, maxHeight));
    await page.screenshot({
      path: path.join(OUT_DIR, 'animalrow-detalle.png'),
      clip: { x: 0, y: clipTop, width: VIEWPORT_W, height },
    });
  } else {
    // Fallback: si por algún motivo no hay box, capturamos el viewport entero (mejor que un clip vacío).
    await page.screenshot({ path: path.join(OUT_DIR, 'animalrow-detalle.png'), fullPage: false });
  }

  // ── 3) Vista de grupo del LOTE ────────────────────────────────────────────────────────────────
  // Volvemos a Inicio y entramos al lote (card secundaria). El back de la vista de grupo va a Inicio.
  await page.goBack();
  await expect(page.getByText('Mis rodeos', { exact: true })).toBeVisible({ timeout: 20_000 });
  const loteCard = page.getByRole('button', { name: new RegExp(`${RUN_TAG} Lote destete, \\d+ cabezas`) }).first();
  await expect(loteCard).toBeVisible({ timeout: 20_000 });
  await loteCard.click();

  await expect(page.getByText('Acciones del grupo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Castrar', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, 'vista-grupo-lote.png'), fullPage: false });
});

test('captura Inicio de un campo NUEVO (pasos incompletos → stepper VISIBLE)', async ({ page }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  // Campo NUEVO: rodeo creado (el RootGate lo exige para aterrizar en la home) pero SIN animales y
  // SIN equipo → 2 de los 3 pasos del wizard quedan pendientes → el stepper SÍ se muestra (con el paso
  // de rodeo tildado y los otros dos activos). Es el estado de un usuario recién arrancando.
  const user = await createTestUser('shotsnew', 'Nuevo');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'El Comienzo');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ORÁCULO del cambio 2 (lado positivo): con pasos pendientes el wizard SÍ se renderiza. Esperamos a
  // que el conteo de animales resuelva (count=0 → paso "Cargá tu primer animal" activo y visible).
  await expect(page.getByText('Cargá tu primer animal', { exact: true })).toBeVisible({ timeout: 30_000 });
  // El paso de rodeo está tildado/hecho (el gate garantiza ≥1 rodeo): su CTA "Gestionar rodeos".
  await expect(page.getByRole('button', { name: 'Gestionar rodeos', exact: true })).toBeVisible({ timeout: 20_000 });
  // Y el paso de equipo arranca pendiente (sin otros miembros / invitaciones).
  await expect(page.getByText('Invitá a tu vet o capataz', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'inicio-nuevo.png'), fullPage: false });
});
