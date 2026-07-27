// e2e/captures/teclado-android.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para la unidad
// «teclado Android» (el teclado tapaba el sheet ENTERO en Android).
//
// EL BUG (device Samsung con barra de 3 botones, APK release 7402575a): al enfocar el input del sheet de
// Vacunación, el teclado tapaba el sheet completo; en iOS el mismo sheet subía bien. Fallaban dos
// mecanismos apilados: el `KeyboardAvoiding`+`View` de RN con `behavior={undefined}` es un `<View>` pelado
// en Android, y el `adjustResize` que lo cubría dejó de aplicar cuando el build pasó a **edge-to-edge**
// (la ventana ya no se encoge). El fix es el primitivo `KeyboardAvoidingShell`: base iOS/web idéntica a lo
// que había + `.android.tsx` con `paddingBottom` = alto del teclado (`useAnimatedKeyboard`).
//
// ⚠️ LÍMITE HONESTO DE ESTAS CAPTURAS (declarado, no maquillado): **este bug es estructuralmente invisible
// en web**. react-native-web no monta teclado virtual (`Keyboard` nunca emite, el `KeyboardAvoiding`+`View`
// es un `<View>` inerte) y no hay hilo de UI donde corra el `useAnimatedKeyboard`. Ninguna captura de acá
// puede mostrar el lift, y un test web que dijera "lo cubre" sería un FALSO VERDE. **El veredicto del fix
// es DEVICE (ADR-029), Android.**
// Lo que estas capturas SÍ prueban —y es exactamente lo que hay que vetar— es la otra mitad del contrato:
// que **iOS y web no se movieron ni un píxel**. Por eso cada estado con un input enfocado viene con una
// assertion de runtime que compara la caja del CTA contra la del MISMO estado sin foco: si el reemplazo del
// KAV por el shell hubiese corrido algo en web, esa comparación cae.
//
// Estados capturados:
//   01 LOGIN — AuthScreenShell, CTA "Iniciar sesión" (el 4to call site: en Android quedaba tapado)
//   02 LOGIN con la CONTRASEÑA enfocada — assert: la caja del CTA es IDÉNTICA a la de 01
//   03 WIZARD etapa 2 con el BOTTOM SHEET de Vacunación abierto (BottomSheetShell) — LA pantalla del reporte
//   04 SHEET con el INPUT enfocado — assert: la caja del sheet es IDÉNTICA a la de 03 + footer 12px
//   05 ALTA (crear-animal) — FooterActionShell con su footer fijo
//   06 ALTA con un campo enfocado — assert: la caja del CTA es IDÉNTICA a la de 05
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/teclado-android.capture.ts \
//     --config playwright.capture.config.ts --workers=1
// Salida: app/e2e/captures/__shots__/teclado-android/ (gitignoreado — ADR-029 §Artefactos).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Locator, Page } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'teclado-android');

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

test('capturas «teclado Android»: login + bottom sheet de vacunación (y web sin mover un píxel)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const user = await createTestUser('kbd');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Teclado');

  await page.goto('/');

  // ── 01 — LOGIN (AuthScreenShell). En Android, al enfocar la contraseña el CTA quedaba tapado: ahí el
  //         CTA no vive en un footer fijo, es un elemento más del scroll, y lo que lo mantiene alcanzable
  //         es que el viewport se ACHIQUE (si no, nada desborda y nada scrollea). ──
  const ctaLogin = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  await expect(ctaLogin).toBeVisible({ timeout: 30_000 });
  const loginBoxBefore = await box(ctaLogin);
  await shot(page, '01-login-cta');

  // ── 02 — LOGIN con la contraseña ENFOCADA (en device abre el teclado; en web no existe teclado
  //         virtual). La assertion es de NO-REGRESIÓN: en web el shell tiene que comportarse igual que el
  //         KeyboardAvoidingView que reemplazó, o sea no mover nada. ──
  await page.getByLabel('Contraseña', { exact: true }).click();
  await page.waitForTimeout(300);
  const loginBoxFocused = await box(ctaLogin);
  expect(loginBoxFocused).toEqual(loginBoxBefore);
  await shot(page, '02-login-password-enfocada');

  // ── 03 — BOTTOM SHEET de Vacunación (BottomSheetShell): LA superficie del reporte 🔴. ──
  await signIn(page, user);
  await waitForHome(page);
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('selected-body-0').click();
  const sheet = page.getByTestId('maneuver-config-sheet');
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  const sheetBoxBefore = await box(sheet);
  await shot(page, '03-sheet-vacunacion-abierto');

  // ── 04 — SHEET con el INPUT enfocado. En el device de Raf, ACÁ el teclado tapaba el sheet entero.
  //         En web no hay teclado: lo que se veta es que el sheet siga EXACTAMENTE donde estaba y que su
  //         footer conserve la reserva de 12px (el piso de web: `useKeyboardVisible` queda en false porque
  //         `Keyboard` de react-native-web nunca emite → `resolveFooterPaddingBottom` devuelve la
  //         safe-area plena, igual que antes de esta unidad). ──
  const input = page.getByTestId('maneuver-config-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await page.waitForTimeout(300);
  expect(await box(sheet)).toEqual(sheetBoxBefore);
  const sheetPad = await sheet.evaluate((el) => getComputedStyle(el).paddingBottom);
  expect(sheetPad).toBe('12px');
  await shot(page, '04-sheet-input-enfocado');
});

test('capturas «teclado Android»: alta — FooterActionShell con el footer fijo', async ({ page }) => {
  test.setTimeout(240_000);
  const user = await createTestUser('kbdalta');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Teclado Alta');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const idv = `9914${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill(idv);
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();

  const rodeoPrompt = page.getByText('¿A qué rodeo va este animal?', { exact: true });
  if (await rodeoPrompt.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Rodeo /i }).first().click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  }
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Categoría Multípara', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 05 — FooterActionShell: footer FIJO con "Crear animal" sobre un form largo. ──
  const footer = page.getByTestId('footer-action');
  await expect(footer).toBeVisible();
  const ctaAlta = page.getByRole('button', { name: 'Crear animal', exact: true });
  await expect(ctaAlta).toBeVisible();
  const altaBoxBefore = await box(ctaAlta);
  await shot(page, '05-alta-footer-fijo');

  // ── 06 — con un campo de texto ENFOCADO (en device abre el teclado). Misma assertion de
  //         no-regresión: en web el CTA no se mueve, y la reserva del footer sigue siendo el piso. ──
  await page.getByLabel(/Año de nacimiento/).click();
  await page.waitForTimeout(300);
  expect(await box(ctaAlta)).toEqual(altaBoxBefore);
  const footerPad = await footer.evaluate((el) => getComputedStyle(el).paddingBottom);
  expect(footerPad).toBe('12px');
  await shot(page, '06-alta-campo-enfocado');
});
