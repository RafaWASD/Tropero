// e2e/cta-siempre-visible.spec.ts — red de regresión de U2 "CTA siempre visible (teclado + scroll)".
//
// Verifica el primitivo FooterActionShell (src/components/FooterActionShell.tsx) aplicado al ALTA
// (crear-animal.tsx, paso 4 "Datos del animal" = form LARGO con teclado): el CTA primario "Crear animal"
// queda en un footer FIJO, SIEMPRE alcanzable (visible + tappable), NO scrollea con el body, y el body
// muestra el affordance de scroll (fade + chevron) cuando hay más contenido bajo el fold.
//
// ⚠️ El caso "el teclado tapa el CTA" NO se reproduce fielmente en WEB (Playwright/rn-web no monta el
// teclado virtual que en device SÍ solapa el contenido — memoria reference_rn_web_pitfalls). Lo que ESTA
// suite verifica en web es lo verificable: el footer es FIJO (no se va con el scroll), el CTA es tappable
// y el peek aparece con contenido largo. El lift real sobre el teclado (primitivo `KeyboardAvoidingShell`) + el encoje
// de la safe-area con el teclado abierto se validan en device (Raf) + en las capturas del Gate 2.5.
//
// hasTouch:true + tap() (no click): en Desktop Chrome el touch está enmascarado; para asertar que el CTA
// responde a un TOQUE real (no solo a un click de mouse) el contexto declara touch (memoria rn-web).

import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.use({ hasTouch: true });

test.afterAll(async () => {
  await cleanupAll();
});

/** Camina el wizard del alta hasta el paso 4 (datos). Robusto al nº de rodeos: si aparece el paso 1
 *  (rodeo), lo resuelve; con 1 rodeo el wizard arranca directo en el sexo. */
async function walkWizardToData(
  page: Page,
  opts: { sex: 'Macho' | 'Hembra'; categoryName: string },
) {
  // Paso 1 (rodeo) SOLO si hay ≥2 rodeos. Con 1 rodeo, crear-animal arranca en el sexo (setStep(2)).
  const rodeoPrompt = page.getByText('¿A qué rodeo va este animal?', { exact: true });
  if (await rodeoPrompt.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Rodeo /i }).first().click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  }
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Sexo ${opts.sex}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.categoryName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('U2: en el alta (paso 4) el CTA queda en footer FIJO, alcanzable y tappable + peek de scroll', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const user = await createTestUser('u2cta');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo U2'); // 1 rodeo cría → arranca en el sexo

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Alta por el buscador (una hembra Multípara → el paso 4 muestra MUCHOS campos = form largo que desborda).
  const idv = `9911${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill(idv);
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  // ── 1) El footer del shell está presente y el CTA "Crear animal" es VISIBLE sin scrollear (thumb-zone). ──
  const footer = page.getByTestId('footer-action');
  const cta = page.getByRole('button', { name: 'Crear animal', exact: true });
  await expect(footer).toBeVisible();
  await expect(cta).toBeVisible();

  // ── 2) PEEK de scroll: el form largo desborda el fold → el fade del affordance está visible. ──
  await expect(page.getByTestId('footer-scroll-fade-bottom')).toBeVisible();

  // ── 3) Foco de un campo de texto (en device abre el teclado): el CTA sigue visible (footer fijo). ──
  await page.getByLabel(/Año de nacimiento/).click();
  await expect(cta).toBeVisible();

  // ── 4) Scrollear el body hasta abajo NO se lleva el footer: el CTA sigue visible (fijo, fuera del scroll). ──
  await page.mouse.move(206, 500);
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(300);
  await expect(footer).toBeVisible();
  await expect(cta).toBeVisible();
  // En el fondo del contenido ya no hay nada oculto abajo → el peek se apaga (decisión pura shouldShowScrollPeek).
  await expect(page.getByTestId('footer-scroll-fade-bottom')).toHaveCount(0);

  // ── 5) El CTA responde a un TOQUE real (no solo mouse): tap → dispara el alta (label → "Creando…"/"Ver la
  //       ficha del animal"). Prueba de tappabilidad del footer fijo. ──
  await cta.tap();
  await expect(
    page.getByRole('button', { name: /Creando…|Ver la ficha del animal/, exact: false }),
  ).toBeVisible({ timeout: 30_000 });
});
