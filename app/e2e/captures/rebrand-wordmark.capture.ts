// e2e/captures/rebrand-wordmark.capture.ts — CAPTURAS del veto visual (Gate 2.5, ADR-029) del
// REBRAND FASE 1, VUELTA 2: el wordmark "miTropero" en las pantallas de AUTH.
//
// ── QUÉ SE VETA ACÁ, Y POR QUÉ NO ALCANZA UN TEST FUNCIONAL ─────────────────────────────────────────
// El wordmark viejo era todo MAYÚSCULAS y no tenía ningún descendente. "miTropero" tiene la `p`. En
// Tamagui, un `<Text fontSize="$7">` SIN `lineHeight="$7"` matching no aplica el lineHeight del token y
// el glifo sale RECORTADO por abajo. Un test funcional no lo ve: el texto "está", el `toBeVisible()`
// pasa, el accessible name es correcto. La única señal es la FOTO, mirada a ojo y ampliada.
// (El guard estático de la firma en el código vive en `app/src/utils/brand-name-guard.test.ts`; esta
// captura es la contraparte empírica: prueba que en el pixel real la `p` sale entera.)
//
// ── LAS CAPTURAS ────────────────────────────────────────────────────────────────────────────────────
//   01 — login (sign-in) completo, con el wordmark arriba.
//   02 — el wordmark AMPLIADO (recorte de su caja + deviceScaleFactor 4 → ~4x de pixel real). Es la que
//        se mira para vetar el descendente: se tiene que ver la panza de la `p` entera y redondeada,
//        con aire debajo, no cortada en plano.
//   03 — sign-up: MISMA shell (AuthScreenShell), confirma que el wordmark es uno solo y no una copia.
//   04 — /invite?token=… deslogueado (fase `auth_required`): wordmark + el SUBTÍTULO rebrandeado
//        ("Te invitaron a un campo en miTropero."). Es la otra superficie de texto de esta vuelta.
//
// Render-only: no crea usuarios ni toca la DB. El token de la 04 es un UUID inexistente a propósito —
// esa fase se decide en el cliente (`invitePhaseForAuth`) SIN consultar al backend.
//
// NO corre en `pnpm e2e` (es un `.capture.ts`). Se dispara a mano:
//   pnpm exec playwright test e2e/captures/rebrand-wordmark.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, expect, type Page } from '../helpers/fixtures';
import { waitForSignIn } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'rebrand-wordmark');

/** El nombre de la marca, con su grafía canónica. */
const BRAND = 'miTropero';

/** Captura NOMBRADA tras un breve settle de layout. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

// deviceScaleFactor 4: el recorte del wordmark sale a 4x de densidad → se puede mirar el descendente
// sin interpolar. El LAYOUT no cambia (sigue 412 CSS px de ancho): es densidad, no zoom de página.
test.use({ deviceScaleFactor: 4 });

test('capturas rebrand — el wordmark "miTropero" en auth, con la `p` entera @ 412px', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await waitForSignIn(page);

  const wordmark = page.getByText(BRAND, { exact: true });
  await expect(wordmark).toBeVisible();

  // (01) el login entero.
  await shot(page, '01-login');

  // (02) el wordmark AMPLIADO — la foto que se veta. Se recorta su caja con un margen generoso ABAJO,
  // que es donde vive el descendente: si la `p` estuviera cortada, el corte cae justo en ese margen.
  // ⚠️ SE SACA ANTES DE LOS ASSERTS a propósito: cuando el oráculo numérico falla es JUSTO cuando hace
  // falta ver la foto. Un capture que asserta primero y fotografía después no deja evidencia del fallo.
  const box = await wordmark.boundingBox();
  if (!box) throw new Error('el wordmark no tiene caja: no se puede recortar la captura');
  await page.screenshot({
    path: path.join(SHOT_DIR, '02-login-wordmark-zoom.png'),
    clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
  });

  // ── El oráculo MEDIBLE que acompaña a la foto ───────────────────────────────────────────────────
  // No reemplaza mirar el PNG (un texto puede entrar en su caja y aun así estar clipeado por un padre),
  // pero fija por número las dos condiciones necesarias: (a) el lineHeight resuelto es MAYOR que el
  // fontSize —si Tamagui hubiera ignorado el token, `line-height` saldría igual al `font-size` o
  // 'normal'—, y (b) el contenido no desborda su propia caja.
  // Falsificado: quitando el `lineHeight="$7"` del shell, este bloque da `line-height: normal` y la
  // caja baja de 28 a 24 px → el test se pone ROJO. No es decorativo.
  const metrics = await wordmark.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      text: el.textContent,
      fontSize: parseFloat(cs.fontSize),
      lineHeight: cs.lineHeight,
      clientHeight: (el as HTMLElement).clientHeight,
      scrollHeight: (el as HTMLElement).scrollHeight,
      overflowY: cs.overflowY,
    };
  });
  console.log('[wordmark]', JSON.stringify(metrics));
  expect(metrics.text).toBe(BRAND);
  expect(parseFloat(metrics.lineHeight)).toBeGreaterThan(metrics.fontSize);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);

  // (03) sign-up: misma shell, mismo wordmark (Expo Router hace push → scopeamos con .last()).
  await page.getByRole('button', { name: /No tengo cuenta/ }).click();
  await expect(page.getByRole('button', { name: 'Crear cuenta', exact: true })).toBeVisible();
  await expect(page.getByText(BRAND, { exact: true }).last()).toBeVisible();
  await shot(page, '03-sign-up');

  // (04) invitación deslogueado: wordmark + subtítulo rebrandeado.
  await page.goto('/invite?token=00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Sumate al campo', { exact: true })).toBeVisible();
  const subtitle = page.getByText(/Te invitaron a un campo en/);
  await expect(subtitle).toBeVisible();
  await expect(subtitle).toHaveText(
    `Te invitaron a un campo en ${BRAND}. Creá tu cuenta o iniciá sesión para aceptar.`,
  );
  await shot(page, '04-invite-auth-required');
});
