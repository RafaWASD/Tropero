// e2e/captures/barrida-teclado.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para la unidad
// «barrida de teclado» (replicar el keyboard-avoidance al RESTO de las superficies con campo de texto).
//
// EL BUG: la unidad anterior («teclado Android») creó el primitivo `KeyboardAvoidingShell` y arregló los
// 4 archivos que montaban un `KeyboardAvoiding`+`View` MAL configurado. Raf lo verificó en device y
// enseguida encontró el MISMO bug en `maniobra/identificar.tsx`, que **no montaba ningún** mecanismo: una
// segunda población de **23 superficies** con AUSENCIA total de keyboard-avoidance (7 de ellas 🔴 manga).
//
// ⚠️ LÍMITE HONESTO DE ESTAS CAPTURAS (declarado, no maquillado): **este bug es estructuralmente invisible
// en web**. react-native-web no monta teclado virtual (`Keyboard` nunca emite, el `KeyboardAvoiding`+`View`
// es un `<View>` inerte, y no hay hilo de UI donde corra el `useAnimatedKeyboard` de la implementación
// Android). Ninguna captura de acá puede mostrar el lift, y un test web que dijera "lo cubre" sería un
// FALSO VERDE. **El veredicto del fix es DEVICE (ADR-029) — Android e iOS.**
// Lo que estas capturas SÍ prueban —y es exactamente lo que hay que vetar— es la otra mitad del contrato:
// que **en web no se movió NADA**. Cada estado con un input enfocado trae una assertion de runtime que
// compara la caja del elemento clave contra la del MISMO estado sin foco: si envolver la columna con el
// shell hubiese corrido o colapsado algo, esa comparación cae. Y el ENFOQUE de la barrida (¿está todo
// clasificado?) lo cubre el guard estático `src/components/keyboard-avoiding-guard.test.ts` (REGLA B).
//
// Estados capturados:
//   01 IDENTIFICAR — hero de escaneo + banda inferior colapsada (LA pantalla del reporte de Raf)
//   02 IDENTIFICAR con la entrada manual EXPANDIDA (input + CTA "Buscar" en la banda inferior)
//   03 IDENTIFICAR con el INPUT ENFOCADO — assert: la caja del CTA "Buscar" es IDÉNTICA a la de 02
//   04 ANIMALES — buscador arriba + resultados (lo que el teclado tapaba eran los RESULTADOS)
//   05 ANIMALES con el buscador ENFOCADO y texto — assert: la lista arranca en el MISMO y que en 04
//   06 TAG SCAN SHEET — sheet HECHO A MANO (uno de los 6), con el shell envolviendo backdrop + hoja
//   07 TAG SCAN con la carga MANUAL y el input ENFOCADO — assert: la hoja NO se movió + reserva intacta
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/barrida-teclado.capture.ts \
//     --config playwright.capture.config.ts --workers=1
// Salida: app/e2e/captures/__shots__/barrida-teclado/ (gitignoreado — ADR-029 §Artefactos).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Locator, Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'barrida-teclado');

test.afterAll(async () => {
  await cleanupAll();
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Caja redondeada al píxel: el oráculo de "en web no se movió NADA" al enfocar un input. */
async function box(locator: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('sin boundingBox (elemento no visible)');
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}

/** Arranca la app con la marca de E2E del bastón SETEADA antes del bundle (mock + handle en window). */
async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

async function connectBaston(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
}

/**
 * Avanza el wizard de la jornada hasta "Arrancar jornada". La cantidad de pasos con "Continuar" varía
 * según la config del rodeo, así que se clickea mientras exista, con tope.
 */
async function avanzarHastaArrancar(page: Page): Promise<void> {
  const arrancar = page.getByRole('button', { name: 'Arrancar jornada', exact: true });
  for (let i = 0; i < 4; i++) {
    if (await arrancar.isVisible().catch(() => false)) break;
    const continuar = page.getByRole('button', { name: /^Continuar/ }).first();
    if (!(await continuar.isVisible().catch(() => false))) break;
    await continuar.click();
    await page.waitForTimeout(500);
  }
  await expect(arrancar).toBeVisible({ timeout: 20_000 });
  await arrancar.click();
}

test('capturas: IDENTIFICAR — banda de entrada manual (la pantalla del reporte 🔴)', async ({ page }) => {
  test.setTimeout(240_000);
  const user = await createTestUser('barr-id');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Barrida');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Wizard → jornada → identificación.
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await avanzarHastaArrancar(page);
  await connectBaston(page);
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 30_000 });

  // ── 01 — hero de escaneo + banda inferior COLAPSADA ("¿Sin chip? Ingresá la caravana"). ──
  await shot(page, '01-identificar-hero-banda-colapsada');

  // ── 02 — entrada manual EXPANDIDA: input + CTA "Buscar" anclados abajo. En device, ACÁ el teclado
  //         tapaba la banda entera (la pantalla no montaba ningún mecanismo). ──
  await page.getByRole('button', { name: 'Sin chip, ingresá la caravana a mano' }).click();
  const input = page.getByTestId('manual-entry-input');
  await expect(input).toBeVisible({ timeout: 15_000 });
  const ctaBuscar = page.getByRole('button', { name: 'Buscar animal' });
  await expect(ctaBuscar).toBeVisible();
  const ctaBefore = await box(ctaBuscar);
  await shot(page, '02-identificar-manual-expandida');

  // ── 03 — con el INPUT ENFOCADO. En web no hay teclado: lo que se veta es que envolver la columna con
  //         el `KeyboardAvoidingShell` NO haya corrido ni colapsado nada. ──
  await input.click();
  await input.fill('123');
  await page.waitForTimeout(300);
  expect(await box(ctaBuscar)).toEqual(ctaBefore);
  await shot(page, '03-identificar-input-enfocado');
});

test('capturas: ANIMALES — buscador arriba y RESULTADOS (lo que el teclado tapaba)', async ({ page }) => {
  test.setTimeout(240_000);
  const user = await createTestUser('barr-anim');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Barrida Lista');
  for (const idv of ['7001', '7002', '7003']) {
    await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female', categoryCode: 'multipara' });
  }

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 30_000 });
  const searchBefore = await box(search);

  // ── 04 — lista con resultados y el buscador arriba. ──
  await shot(page, '04-animales-lista');

  // ── 05 — buscador ENFOCADO con término. El fix real de esta pantalla NO es el input (que está arriba
  //         y nunca se tapa): es que la LISTA quede por encima del teclado. En web la assertion es de
  //         no-regresión: el buscador sigue exactamente donde estaba. ──
  await search.click();
  await search.fill('70');
  await page.waitForTimeout(600);
  expect(await box(search)).toEqual(searchBefore);
  await shot(page, '05-animales-buscador-enfocado');
});

test('capturas: TAG SCAN SHEET — sheet HECHO A MANO con el shell envolviendo backdrop + hoja', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const user = await createTestUser('barr-tag');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Barrida Sheet');
  // Animal SIN caravana electrónica → la ficha ofrece "Bastonear la caravana".
  const idv = `9301${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv, sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: new RegExp(idv) }).first().click();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 06 — el sheet ABIERTO. Es uno de los SEIS sheets hechos a mano (scrim absoluto + backdrop
  //         `Pressable` + `YStack maxHeight 85%`) que no tenían ningún mecanismo de teclado. El shell
  //         ahora envuelve la COLUMNA dentro del scrim, que sigue cubriendo la pantalla entera. ──
  await page.getByTestId('tag-scan-open').click();
  const sheet = page.getByTestId('tag-scan-sheet');
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await shot(page, '06-tag-scan-sheet-abierto');

  // ── 07 — carga MANUAL dentro del sheet, con el input ENFOCADO. En device, ACÁ el teclado tapaba el
  //         input y el CTA. En web la assertion es doble: la hoja NO se movió, y su reserva inferior
  //         sigue siendo la de siempre — `useKeyboardVisible` queda en false porque `Keyboard` de
  //         react-native-web nunca emite → `useKeyboardAwareBottomInset` devuelve la safe-area plena.
  //         En web eso es `max(inset 0 + el $6 propio de este sheet, piso 12)` = **32px** (el `extra` se
  //         suma al inset del sistema y recién ahí compite con el piso; `$6` de la escala `space` vale 32,
  //         y este 32px medido en runtime es justamente lo que lo confirma), igual que antes. ──
  // El link "¿Sin bastón? Cargá la caravana a mano" (estado CONECTABLE / escuchando) o el CTA
  // "Cargar la caravana a mano" (estado manual-promovido, sin transporte): cuál aparece depende del BLE.
  const linkManual = page.getByTestId('tag-scan-manual-link');
  const ctaManual = page.getByTestId('tag-scan-to-manual');
  if (await linkManual.isVisible().catch(() => false)) await linkManual.click();
  else await ctaManual.click();
  await expect(page.getByTestId('tag-scan-manual')).toBeVisible({ timeout: 15_000 });
  const tagInput = page.getByLabel('Caravana electrónica', { exact: true });
  // La caja se mide DESPUÉS de entrar al modo manual y ANTES de enfocar: el sheet es content-sized, así
  // que entre el hero de escaneo y la carga manual cambia de alto por CONTENIDO (410 → 344 en web) — eso
  // no es lo que este oráculo mira. Lo que tiene que quedar idéntico es la caja ANTES vs DESPUÉS del FOCO.
  await expect(tagInput).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);
  const sheetBefore = await box(sheet);
  await tagInput.click();
  await tagInput.fill('98212345678901');
  await page.waitForTimeout(300);
  expect(await box(sheet)).toEqual(sheetBefore);
  const sheetPad = await sheet.evaluate((el) => getComputedStyle(el).paddingBottom);
  expect(sheetPad).toBe('32px');
  await shot(page, '07-tag-scan-manual-input-enfocado');
});
