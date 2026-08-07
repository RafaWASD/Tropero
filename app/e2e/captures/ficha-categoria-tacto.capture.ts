// e2e/captures/ficha-categoria-tacto.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) del delta spec 02
// `ficha-categoria-tacto`. Recorre las DOS capacidades nuevas de la ficha y saca capturas NOMBRADAS de cada
// estado clave a e2e/captures/__shots__/ficha-categoria-tacto/NN-estado.png, para que el leader las vete
// (skill `design-review`) ANTES de mostrárselas a Raf.
//
// Estados capturados:
//   01 fila "Categoría" con el link "Cambiar" (en su sección "Datos del animal")
//   02 sheet de selección (opciones del mismo sexo, la vigente marcada)
//   03 confirmación NORMAL (pregunta + consecuencia de fijar)
//   04 ficha con la categoría FIJADA (badge del hero + card "Categoría fijada manualmente")
//   05 confirmación de VOLVER A AUTOMÁTICO (el copy cambia — RCM.5.3)
//   06 confirmación con AVISO DE EDAD (ternera de 8 meses → "Vaca multípara")
//   07 fila "Categoría" de un CUT: sin "Cambiar", con el hint
//   16 sheet de un MACHO CASTRADO (ternero/novillito/novillo — P1: nada de toro/torito)
//   08 CTA "Tacto de aptitud" en "Estado actual"
//   09 TactoVaquillonaStep lanzado desde la ficha (3 bloques + link "Fue otro día")
//   10 el campo de fecha desplegado por "Fue otro día"
//   11 ficha post-tacto de aptitud (Apta, sin CTA)
//   12 CTA "Tacto de preñez"
//   13 TactoStep desde la ficha (PREÑADA / VACÍA)
//   14 sub-paso de TAMAÑO (3 buckets del rodeo)
//   15 ficha post-tacto de preñez ("Preñada (cuerpo)")
//
// ⚠️ NO es regresión (`.capture.ts` → NO corre en `pnpm e2e`). La red de regresión vive en
// `e2e/ficha-categoria.spec.ts` + `e2e/ficha-tacto.spec.ts`. Reusa los MISMOS helpers/seed/selectores.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/ficha-categoria-tacto.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/ficha-categoria-tacto/ (gitignoreado — app/.gitignore + ADR-029).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  todayLocalIso,
  RUN_TAG,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'ficha-categoria-tacto');

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test.afterAll(async () => {
  await cleanupAll();
});

/** Captura NOMBRADA tras un settle de layout. El llamador asegura un expect(...).toBeVisible() antes. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Vuelve de la FICHA al listado: el bottom-nav no existe dentro de una ruta pusheada. */
async function backToList(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Volver', exact: true }).first().tap();
  await gotoAnimales(page);
}

async function openFicha(page: Page, idv: string): Promise<void> {
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.tap();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('capturas: fijar la categoría a mano (fila, sheet, confirmaciones, aviso de edad, CUT)', async ({
  page,
}) => {
  test.setTimeout(240_000);

  const user = await createTestUser('capcat');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CapCat', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });

  // (1) Hembra adulta sin eventos → el espejo deriva "Vaquillona", override=false.
  const idv = `CG${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2022-03-01',
  });
  // (2) Ternera de ~8 meses → dispara el aviso de incoherencia con la edad.
  const born = new Date();
  born.setDate(born.getDate() - 240);
  const calfIdv = `CE${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: calfIdv,
    sex: 'female',
    categoryCode: 'ternera',
    birthDate: todayLocalIso(born),
  });
  // (3) Hembra CUT → la fila queda solo lectura, con el hint.
  const cutIdv = `CC${RUN_TAG.slice(-6)}`;
  const cutProfileId = await seedAnimal(establishmentId, rodeoId, {
    idv: cutIdv,
    sex: 'female',
    categoryCode: 'cut',
    categoryOverride: true,
    birthDate: '2019-03-01',
  });
  const { error } = await admin.from('animal_profiles').update({ is_cut: true }).eq('id', cutProfileId);
  if (error) throw new Error(`seed is_cut: ${error.message}`);
  // (4) MACHO CASTRADO de 500 dias -> el selector le ofrece ternero/novillito/novillo (P1). Es un estado
  // visual que ninguna otra captura muestra: la rama de macho del filtro por castracion.
  const bornMale = new Date();
  bornMale.setDate(bornMale.getDate() - 500);
  const castrIdv = `CM${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: castrIdv,
    sex: 'male',
    isCastrated: true,
    categoryCode: 'novillo',
    categoryOverride: true,
    birthDate: todayLocalIso(bornMale),
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  // ── 01 — la fila "Categoría" con su afordancia "Cambiar", dentro de "Datos del animal". ──
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Vaquillona');
  await page.getByText('Datos del animal', { exact: true }).scrollIntoViewIfNeeded();
  await shot(page, '01-fila-categoria-cambiar');

  // ── 02 — el sheet de selección (opciones de HEMBRA, la vigente marcada). ──
  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  await shot(page, '02-sheet-opciones');

  // ── 03 — la confirmación NORMAL (sin aviso de edad): pregunta + consecuencia de FIJAR. ──
  await page.getByTestId('category-option-multipara').tap();
  await expect(page.getByTestId('category-sheet-confirm')).toBeVisible();
  await shot(page, '03-confirmacion-fijar');

  // ── 04 — la ficha con la categoría FIJADA: badge del hero + card "Categoría fijada manualmente". ──
  await page.getByRole('button', { name: 'Confirmar', exact: true }).tap();
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByText('Categoría fijada manualmente', { exact: true }).scrollIntoViewIfNeeded();
  await shot(page, '04-ficha-categoria-fijada');

  // ── 05 — la confirmación de VOLVER A AUTOMÁTICO (el copy de la consecuencia cambia, RCM.5.3). ──
  await page.getByText('Datos del animal', { exact: true }).scrollIntoViewIfNeeded();
  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('category-option-vaquillona').tap();
  await expect(page.getByTestId('category-confirm-consequence')).toContainText('vuelve a actualizarse sola');
  await shot(page, '05-confirmacion-volver-a-automatico');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).tap();
  await expect(page.getByTestId('category-sheet')).toHaveCount(0, { timeout: 15_000 });

  // ── 06 — la confirmación CON AVISO DE EDAD (ternera de 8 meses → "Multípara"). ──
  await backToList(page);
  await openFicha(page, calfIdv);
  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('category-option-multipara').tap();
  await expect(page.getByTestId('category-age-warning')).toBeVisible();
  await shot(page, '06-confirmacion-aviso-edad');
  // Cerramos sin escribir (la captura es del aviso, no del cambio).
  await page.getByTestId('category-sheet-cancelar').tap();
  await page.getByTestId('category-sheet-cerrar').tap();

  // ── 07 — la fila "Categoría" de un CUT: sin "Cambiar", con el hint que apunta a la acción correcta. ──
  await backToList(page);
  await openFicha(page, cutIdv);
  await expect(page.getByTestId('ficha-categoria-hint-cut')).toBeVisible();
  await page.getByText('Datos del animal', { exact: true }).scrollIntoViewIfNeeded();
  await shot(page, '07-fila-categoria-cut-solo-lectura');

  // -- 16 -- el sheet de un MACHO CASTRADO: ternero/novillito/novillo, SIN toro ni torito (P1). --
  await backToList(page);
  await openFicha(page, castrIdv);
  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('category-option-novillito')).toBeVisible();
  await expect(page.getByTestId('category-option-toro')).toHaveCount(0);
  await shot(page, '16-sheet-opciones-macho-castrado');
});

test('capturas: tacto desde la ficha (CTAs, pasos de la manga, "Fue otro día", ficha post-tacto)', async ({
  page,
}) => {
  test.setTimeout(240_000);

  const user = await createTestUser('captacto');
  await setUserPhone(user.id, '1123456789');
  // 3 meses de servicio → el sub-paso de tamaño muestra los 3 buckets.
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CapTacto', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    serviceMonths: [10, 11, 12],
  });
  const vaqIdv = `TA${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: vaqIdv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2024-01-10',
  });
  const multiIdv = `TP${RUN_TAG.slice(-6)}`;
  // `categoryOverride: true`: con override=false el espejo C6 mostraria la DERIVADA ('vaquillona', sin
  // eventos) y la ficha ofreceria APTITUD. Fijada en multipara, es una categoria PROBADA → tacto de prenez.
  await seedAnimal(establishmentId, rodeoId, {
    idv: multiIdv,
    sex: 'female',
    categoryCode: 'multipara',
    categoryOverride: true,
    birthDate: '2020-05-01',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, vaqIdv);

  // ── 08 — el CTA "Tacto de aptitud" en "Estado actual", debajo de las filas reproductivas. ──
  const estadoActual = page.getByText('Estado actual', { exact: true });
  await expect(estadoActual).toBeVisible({ timeout: 20_000 });
  await estadoActual.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('ficha-tacto-cta')).toBeVisible();
  await shot(page, '08-cta-tacto-aptitud');

  // ── 09 — el paso de la manga (TactoVaquillonaStep) lanzado desde la ficha + el link "Fue otro día". ──
  await page.getByRole('button', { name: 'Tacto de aptitud', exact: true }).tap();
  await expect(page.getByTestId('fitness-block-APTA')).toBeVisible({ timeout: 20_000 });
  await shot(page, '09-tacto-aptitud-paso');

  // ── 10 — el campo de fecha desplegado por "Fue otro día" (P3). ──
  await page.getByTestId('tacto-fue-otro-dia').tap();
  await expect(page.getByTestId('tacto-fecha')).toBeVisible();
  await shot(page, '10-tacto-fue-otro-dia');

  // ── 11 — la ficha post-tacto: "Aptitud reproductiva: Apta" y el CTA ya no está. ──
  await page.getByTestId('fitness-block-APTA').tap();
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText('Estado actual', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByTestId('ficha-tacto-cta')).toHaveCount(0, { timeout: 20_000 });
  await shot(page, '11-ficha-post-tacto-aptitud');

  // ── 12 — el CTA "Tacto de preñez" (hembra servida). ──
  await backToList(page);
  await openFicha(page, multiIdv);
  await page.getByText('Estado actual', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByTestId('ficha-tacto-cta')).toBeVisible();
  await shot(page, '12-cta-tacto-prenez');

  // ── 13 — TactoStep desde la ficha (PREÑADA / VACÍA). ──
  await page.getByRole('button', { name: 'Tacto de preñez', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'PREÑADA', exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(page, '13-tacto-prenez-paso');

  // ── 14 — el sub-paso de TAMAÑO (3 buckets del rodeo). ──
  await page.getByRole('button', { name: 'PREÑADA', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'CUERPO', exact: true })).toBeVisible({ timeout: 10_000 });
  await shot(page, '14-tacto-prenez-tamano');

  // ── 15 — la ficha post-tacto de preñez ("Preñada (cuerpo)"). ──
  await page.getByRole('button', { name: 'CUERPO', exact: true }).tap();
  await expect(page.getByText(/Preñada \(cuerpo\) · /)).toBeVisible({ timeout: 20_000 });
  await page.getByText('Estado actual', { exact: true }).scrollIntoViewIfNeeded();
  await shot(page, '15-ficha-post-tacto-prenez');
});
