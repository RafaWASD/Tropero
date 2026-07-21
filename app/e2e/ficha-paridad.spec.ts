// e2e/ficha-paridad.spec.ts — red E2E del bugfix U4 (tanda docs/plan-mejoras-2026-07-20.md, Tier-2):
// PARIDAD entre la CARD del listado y la FICHA del animal. Reporte de Raf:
//   (a) los DIENTES no se muestran en el "Estado actual" de la ficha;
//   (b) datos que SÍ aparecen en la card (ej. el chip "Vacía") NO aparecen en la ficha.
//
// El test siembra una hembra MULTÍPARA con:
//   - teeth_state='boca_llena' (dientes) → antes: la ficha NUNCA lo mostraba (no estaba ni en AnimalDetail);
//   - un TACTO 'empty' → estado reproductivo VACÍA (el chip de la card).
// Verifica que la CARD del listado (tab Animales, AnimalRow no-compact) muestra el chip "Vacía" (fuente de
// paridad) y que la FICHA, en "Estado actual", ahora muestra la fila "Dientes: Boca llena" (gap a, NUEVO) y
// "Estado reproductivo: Vacía · …" (gap b, paridad con la card).
//
// Corre contra el export ESTÁTICO de prod (:8099) + Supabase remoto + PowerSync (mismo patrón que
// cut-ficha.spec.ts). Web táctil real (reference_rn_web_pitfalls): hasTouch + tap(). Datos namespaced
// (RUN_TAG); cleanup en afterAll + global-teardown. Aserta SOLO sobre datos propios.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedReproductiveTactoEvent,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

// Viewport táctil (manga): la ficha/card se vetan en web táctil real (no desktop).
test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test.afterAll(async () => {
  await cleanupAll();
});

test('paridad card↔ficha: una hembra VACÍA con dientes → el chip "Vacía" en la card + la ficha muestra Dientes y Estado reproductivo Vacía', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const user = await createTestUser('ficha');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Ficha');

  // Hembra MULTÍPARA (≠ vaquillona → NO se muestra la fila "Aptitud"; el estado reproductivo es el eje) con
  // boca llena (dientes) y fecha vieja. El tacto 'empty' la deja VACÍA (deriveReproStatus → {kind:'empty'}).
  const idv = `FI${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'multipara',
    birthDate: '2019-03-01',
    teethState: 'boca_llena',
  });
  await seedReproductiveTactoEvent(profileId, { pregnancyStatus: 'empty' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Buscar la multípara por su IDV.
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);

  // PARIDAD (fuente): la CARD del listado (AnimalRow no-compact) muestra el chip de estado reproductivo
  // "Vacía" (a11y "Estado reproductivo: Vacía"). Esto es lo que Raf ve en el listado.
  await expect(page.getByLabel('Estado reproductivo: Vacía').first()).toBeVisible({ timeout: 30_000 });

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.tap();

  // Ficha cargada.
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });

  // "Estado actual": la sección que Raf reportó incompleta. La traemos a la vista.
  const estadoActual = page.getByText('Estado actual', { exact: true });
  await expect(estadoActual).toBeVisible({ timeout: 20_000 });
  await estadoActual.scrollIntoViewIfNeeded();

  // (a) DIENTES — fila NUEVA en "Estado actual" (antes NO existía en la ficha). Label "Dientes" + valor
  //     es-AR del enum ("Boca llena", teethLabel('boca_llena')).
  await expect(page.getByText('Dientes', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Boca llena', { exact: true })).toBeVisible();

  // (b) ESTADO REPRODUCTIVO — paridad con la card: la ficha muestra "Vacía · …" (antes podía caer en "Sin
  //     registrar"). El "· " es el separador de la fila de "Estado actual" (valor + fecha) → distingue esta
  //     fila del nodo del timeline.
  await expect(page.getByText('Estado reproductivo', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Vacía ·/).first()).toBeVisible({ timeout: 15_000 });
});
