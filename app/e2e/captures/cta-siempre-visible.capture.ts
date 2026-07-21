// e2e/captures/cta-siempre-visible.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para U2 "CTA siempre
// visible (teclado + scroll)". Recorre las pantallas TOCADAS por el primitivo FooterActionShell y saca
// capturas NOMBRADAS de cada estado clave a e2e/captures/__shots__/cta-siempre-visible/NN-estado.png
// para que el leader las vete (design-review) antes de la Puerta 2.
//
// Pantallas capturadas:
//   - MANIOBRA 🔴 (carga.tsx): paso de ANTIPARASITARIO (silent_apply de texto) — el CTA gigante "Aplicar y
//     seguir" queda FIJO abajo (thumb-zone) con el input de texto arriba; y el hero del producto al corregir.
//   - ALTA (crear-animal.tsx, paso 4 "Datos"): form LARGO con el footer FIJO "Crear animal" + el affordance
//     de scroll (fade + chevron); estado con un campo enfocado; estado scrolleado al fondo (footer sigue fijo).
//
// ⚠️ El teclado virtual del SO NO se monta en WEB (Playwright/rn-web — memoria reference_rn_web_pitfalls),
// así que estas capturas muestran el CTA en su footer FIJO y el affordance de scroll (lo verificable en web).
// El lift real sobre el teclado (KeyboardAvoidingView) se ve en device (Raf).
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/cta-siempre-visible.capture.ts \
//     --config playwright.capture.config.ts --workers=1
// Salida: app/e2e/captures/__shots__/cta-siempre-visible/ (gitignoreado — ADR-029 §Artefactos).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'cta-siempre-visible');

test.use({ hasTouch: true });

test.afterAll(async () => {
  await cleanupAll();
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

let eidCounter = 0;
function makeEid(): string {
  eidCounter += 1;
  const tail = String(Date.now()).slice(-9) + String(1000 + eidCounter).slice(-3);
  return `982${tail}`.slice(0, 15).padEnd(15, '0');
}

async function gotoWithBle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
  });
  await page.goto('/');
}

async function bastonazo(page: Page, eid: string): Promise<void> {
  await page.evaluate((e) => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } })
      .__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/** Arranca una jornada con las maniobras dadas (orden = orden de secuencia) y aterriza en la identificación
 *  con el bastón conectado (mock). Copia acotada del helper de maniobra-sanitaria.spec.ts. */
async function startSession(page: Page, maniobras: readonly string[]): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`pool-row-${maniobras[0]}`)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  for (const m of maniobras) {
    await page.getByTestId(`pool-row-${m}`).click();
  }
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function walkWizardToData(
  page: Page,
  opts: { sex: 'Macho' | 'Hembra'; categoryName: string },
) {
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

// ── MANIOBRA 🔴 (carga.tsx): paso de texto (antiparasitario) con el CTA "Aplicar y seguir" FIJO abajo. ──
test('captura U2: maniobra — CTA fijo en el paso de texto (antiparasitario) + hero al corregir', async ({
  page,
}) => {
  test.setTimeout(210_000);
  const user = await createTestUser('u2man');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo U2 Maniobra');
  const eid = makeEid();
  const visual = '0713';
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    idv: visual,
    sex: 'female',
    categoryCode: 'multipara',
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSession(page, ['antiparasitario']);
  await bastonazo(page, eid);

  // ── 01 — paso de ANTIPARASITARIO en modo edición: input de texto arriba + CTA gigante "Aplicar y seguir"
  //         FIJO abajo (thumb-zone). En device el KeyboardAvoidingView lo sube por encima del teclado. ──
  await expect(page.getByTestId('silent-product-input')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Aplicar y seguir' })).toBeVisible();
  await shot(page, '01-maniobra-antiparasitario-cta-fijo');

  // ── 02 — con el input ENFOCADO (en device abre el teclado): el CTA sigue accesible abajo. ──
  await page.getByTestId('silent-product-input').click();
  await page.getByTestId('silent-product-input').fill('Ivermectina');
  await expect(page.getByRole('button', { name: 'Aplicar y seguir' })).toBeVisible();
  await shot(page, '02-maniobra-input-enfocado-cta-visible');

  // Confirmar → resumen → corregir → hero del producto + CTA fijo.
  await page.getByRole('button', { name: 'Aplicar y seguir' }).click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('summary-row-antiparasitario').click();
  await expect(page.getByTestId('silent-product-hero')).toBeVisible({ timeout: 10_000 });
  // ── 03 — hero del producto (modo lectura) con el CTA "Aplicar y seguir" FIJO abajo. ──
  await shot(page, '03-maniobra-hero-producto-cta-fijo');
  void profileId;
});

// ── ALTA (crear-animal.tsx, paso 4): footer FIJO "Crear animal" + affordance de scroll en form largo. ──
test('captura U2: alta — footer fijo + peek de scroll (form largo)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('u2alta');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo U2 Alta');

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const idv = `9913${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill(idv);
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  // ── 04 — paso 4 con MUCHOS campos: footer FIJO "Crear animal" + fade/chevron del affordance de scroll. ──
  await expect(page.getByTestId('footer-action')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear animal', exact: true })).toBeVisible();
  await shot(page, '04-alta-footer-fijo-peek');

  // ── 05 — con un campo de texto ENFOCADO (en device abre el teclado): el CTA sigue fijo y visible. ──
  await page.getByLabel(/Año de nacimiento/).click();
  await shot(page, '05-alta-campo-enfocado-cta-visible');

  // ── 06 — scrolleado al FONDO: el footer NO se fue (fijo) y el peek se apaga (ya no hay nada oculto abajo). ──
  await page.mouse.move(206, 500);
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('footer-action')).toBeVisible();
  await shot(page, '06-alta-scrolleado-footer-fijo');
});
