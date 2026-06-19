// e2e/cut-ficha.spec.ts — red E2E del delta CUT-ficha (spec 02, TCUT.14 → RCUT.1/RCUT.2/RCUT.5/RCUT.6).
//
// Corre contra el export ESTÁTICO de prod (:8099) + Supabase remoto + PowerSync (mismo patrón que
// animals.spec.ts / operaciones-castracion.spec.ts). Estado de partida: usuario con teléfono (saltea el gate
// R3.8) + 1 campo con 1 rodeo de CRÍA (el data_key `dientes` nace ENABLED por default en cría, ADR-021 → el
// gate de cliente RCUT.7 deja ofrecer "Marcar como CUT") + 1 hembra MULTÍPARA (≠ ternera → elegible).
//
// Flujo: home → Animales → buscar la multípara → ficha → sección "Manejo" → "Marcar como CUT (descarte)" →
// confirmación inline (consecuencia "La categoría pasará a CUT (descarte).") → Confirmar → la categoría pasa
// a CUT, el badge del hero se pinta AMARILLO (aserción de color vs el verde de partida) + NO aparece la card
// genérica "Quitar fijación" (RCUT.5.7) → "Quitar CUT" → Confirmar → vuelve a la categoría derivada + el
// badge vuelve a VERDE.
//
// Web táctil real (memoria reference_rn_web_pitfalls): hasTouch + touchscreen.tap() para no enmascarar el
// touch (el desktop emularía click). Datos namespaced (RUN_TAG); cleanup en afterAll + global-teardown.
// Aserta SOLO sobre datos propios.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

// Forzamos un viewport táctil (manga): el badge/afordancia CUT se vetan en web táctil real (no desktop).
test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test.afterAll(async () => {
  await cleanupAll();
});

// Tokens del par del badge (tamagui.config.ts): rgb del fondo AMARILLO (CUT, $cutBg #FBE6AE) y del fondo
// VERDE ($greenLight #93cfac). El test asierta el color de FONDO del badge (la señal de descarte de un
// vistazo, RCUT.6.1) — distingue inequívocamente CUT de no-CUT.
const CUT_BG_RGB = 'rgb(251, 230, 174)'; // #FBE6AE
const GREEN_BG_RGB = 'rgb(147, 207, 172)'; // #93cfac

/**
 * Lee el background-color computado del CategoryBadge del HERO de la ficha. El badge es un <div> con
 * aria-label "Categoría …" (labelA11y) que contiene el <Text> de la categoría. Subimos al contenedor con
 * el aria-label y leemos su backgroundColor (rgb()). Robusto a la estructura RN-web (el aria-label vive en
 * el View raíz del badge, que es justamente el que lleva el backgroundColor del token).
 */
async function readHeroBadgeBg(page: import('@playwright/test').Page, categoryName: string): Promise<string> {
  const badge = page.getByLabel(`Categoría ${categoryName}`, { exact: true }).first();
  await expect(badge).toBeVisible({ timeout: 20_000 });
  return badge.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
}

test('ficha de una hembra ≠ ternera: marcar CUT → badge amarillo → quitar CUT → badge verde', async ({ page }) => {
  const user = await createTestUser('cut');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CUT');

  // Hembra MULTÍPARA con fecha vieja (computaría multípara/vaquillona) + override para fijarla como multípara
  // — lo importante es que NO sea ternera (→ elegible) y que arranque NO-CUT (verde). Categoría 'multipara'.
  const idv = `CUT${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'multipara',
    categoryOverride: true, // override no-CUT: la card "Quitar fijación" se mostraría… hasta marcar CUT (RCUT.5.7)
    birthDate: '2019-03-01',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Buscar la multípara por su IDV → tocar el resultado → ficha.
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.tap();

  // Ficha cargada. Badge de partida = "Multípara" VERDE (no-CUT). Override no-CUT → la card "Quitar fijación"
  // SÍ aparece todavía (RCUT.5.7: solo se suprime para un CUT).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await readHeroBadgeBg(page, 'Multípara, fijada manualmente')).toBe(GREEN_BG_RGB);
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toBeVisible();

  // Sección "Manejo" (hembra) → "Marcar como CUT (descarte)".
  await expect(page.getByText('Manejo', { exact: true })).toBeVisible();
  const markBtn = page.getByRole('button', { name: 'Marcar como CUT (descarte)', exact: true });
  await expect(markBtn).toBeVisible();
  await markBtn.tap();

  // Confirmación inline: la consecuencia FIJA (RCUT.5.2) + Confirmar.
  await expect(page.getByText('La categoría pasará a CUT (descarte).', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).tap();

  // Tras marcar: el badge del hero pasa a "CUT" AMARILLO (RCUT.6.1) — aserción de COLOR.
  expect(await readHeroBadgeBg(page, 'CUT, fijada manualmente')).toBe(CUT_BG_RGB);
  // RCUT.5.7: un CUT NO ofrece la card genérica "Quitar fijación" (su único desmarcado es "Quitar CUT").
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Quitar fijación', exact: true })).toHaveCount(0);

  // "Quitar CUT" (RCUT.5.4): la afordancia de desmarcado de un CUT.
  const unmarkBtn = page.getByRole('button', { name: 'Quitar CUT', exact: true });
  await expect(unmarkBtn).toBeVisible({ timeout: 15_000 });
  await unmarkBtn.tap();
  await expect(page.getByText('¿Quitar la marca CUT de este animal?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).tap();

  // Tras quitar: ya NO hay categoría CUT (el badge "CUT" desaparece) y el badge del hero (la categoría
  // derivada, no-CUT — la derivada exacta depende del espejo C6 de la hembra) vuelve a VERDE. Asertamos por
  // el color de fondo del badge del hero (verde) — la señal de "no es descarte", RCUT.6 — sin acoplarnos al
  // NAME exacto de la derivada (que el espejo computa según los eventos/edad).
  await expect(page.getByText('CUT', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  const heroBadge = page.getByLabel(/^Categoría /).first();
  await expect(heroBadge).toBeVisible({ timeout: 20_000 });
  expect(await heroBadge.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor)).toBe(
    GREEN_BG_RGB,
  );
});

