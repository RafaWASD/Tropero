// e2e/titulos-sweep.spec.ts — VERIFICACIÓN del barrido tipográfico de títulos (fix sistémico del clip
// de descendentes). NO es un test de la Fase 6: son capturas 412×915 que confirman que ningún título con
// descendente (g/q/p/j/y) se recorta abajo tras setear lineHeight="$N" matching en los headings >=$6.
//
// Causa raíz (confirmada por el leader): en Tamagui, setear fontSize="$N" directo NO aplica el lineHeight
// del token → el line-box cae al `normal` del browser (~1.2×) y con numberOfLines (= -webkit-line-clamp:1
// + overflow:hidden) se recortan las descendentes. El fix: setear lineHeight="$N" (el token matching, ya
// dimensionado con lugar para descendentes: $8 = 23/31 = 1.35). Acá lo verificamos visualmente.
//
// Capturamos el HEADER de las pantallas cuyo título CONTIENE descendente (las que el fix protege ACTIVA-
// mente). Los títulos sin descendente (Animales, Rodeos, Lotes, Castrar, …) reciben el fix de forma
// PREVENTIVA y no necesitan captura.
//
// Reusa los helpers de auth/seed/navegación de e2e/helpers (mismos que dedup-screenshot.spec.ts).
//
// Para correrla:  cd app && pnpm e2e:build && pnpm exec playwright test e2e/titulos-sweep.spec.ts

import path from 'node:path';
import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedEstablishment,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, waitForMisCampos, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'design', 'veto-titulos-sweep');

test.afterAll(async () => {
  await cleanupAll();
});

// "Agregar evento" (descendente: la 'g' de Agregar) — header del wizard de eventos, paso 1.
test('título "Agregar evento" (g) no recorta la descendente', async ({ page }) => {
  const user = await createTestUser('titulo-evento');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Titulo Evento');
  const idv = '7301';
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Abrir la ficha del animal → "Agregar evento" → paso 1 (título "Agregar evento" en el header $8).
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  // Ancla del paso 1: el subtítulo "¿Qué querés cargar?". El título "Agregar evento" del header ($8) y el
  // back-button homónimo (su a11y-label) ambos matchean el texto → no aserto por texto exacto (strict-mode
  // violation); el ancla del subtítulo confirma que estamos en el paso 1, con el título arriba en la captura.
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(OUT_DIR, 'agregar-evento.png') });
});

// "Mis campos" (descendente: la 'p' de campos) — landing con >=2 campos.
test('título "Mis campos" (p) no recorta la descendente', async ({ page }) => {
  const user = await createTestUser('titulo-campos');
  await setUserPhone(user.id, '1123456789');
  // Dos campos → RootGate aterriza en "Mis campos" (landing).
  await seedEstablishment(user.id, 'Campo Norte Titulo');
  await seedEstablishment(user.id, 'Campo Sur Titulo');

  await page.goto('/');
  await signIn(page, user);
  await waitForMisCampos(page);
  await expect(page.getByText('Mis campos', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'mis-campos.png') });
});

// "Animales" NO tiene descendente, pero es la tab base — la capturamos para confirmar que el fix
// PREVENTIVO no rompió el header (regresión de layout). El título $8 "Animales" debe verse intacto.
test('header de la tab "Animales" intacto tras el fix preventivo (sin descendente)', async ({ page }) => {
  const user = await createTestUser('titulo-animales');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Titulo Animales');
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv: '8800', sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText('Animales', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(OUT_DIR, 'animales.png') });
});
