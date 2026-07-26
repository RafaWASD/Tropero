// e2e/captures/aire-safe-area.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para la unidad «aire»
// (separación entre el contenido inferior de la app y la barra del sistema).
//
// EL BUG (device Android, Samsung de 3 botones, build EAS 7402575a): la reserva inferior era
// `max(insets.bottom, $navBottomMin=12)`. Con una barra real de 48dp eso da 48 → la app reservaba
// EXACTAMENTE la barra y nada más, y el borde del CTA quedaba a 1dp de ella. Ahora la reserva es
// `max(insetVigente, insetArranque, $navBottomMin) + (Android ? $navBarGap : 0)`, pedida SIEMPRE con
// `useSafeBottomInset()`. El aire va SOLO en Android (ahí el inset ES la barra de navegación); en iOS
// el inset de 34pt ya es aire pintado con el fondo de la app, y en web manda el piso de 12.
//
// ⚠️ LÍMITE HONESTO DE ESTAS CAPTURAS (declarado, no maquillado): en WEB `insets.bottom = 0` — no hay
// barra del sistema, así que **acá la reserva es el piso de 12, exactamente igual que antes de esta
// unidad**. El bug NO es observable en web y estas capturas NO lo demuestran: el veredicto del aire es
// DEVICE (ADR-029). Lo que sí prueban —y es justo lo que hay que vetar— es que el barrido de 41 call
// sites al hook compartido **no rompió ni corrió NADA**: en web 40 de los 41 tienen el mismo píxel que
// en el baseline (verificado numéricamente call site por call site en
// `progress/impl_aire-safe-area.md`), así que cualquier diferencia visual acá sería un bug. La única
// excepción intencional en web es el pill del bastón (`StickStatusIndicator`), que sube de 93 a 105
// porque el pico del FAB (98) lo tapaba — no aparece en estas capturas (solo se muestra con el bastón
// activo). Las capturas llevan además DOS assertions de runtime (nav y footer de pantalla, ver abajo).
//
// Estados capturados:
//   01 home + BOTTOM-NAV            (computeTabBarInsetLayout) — assert 72px / 12px
//   02 tab Animales + bottom-nav    (idem, con lista larga detrás)
//   03 MANIOBRA — CTA "Nueva jornada" (LA pantalla del reporte de Raf)
//   04 wizard etapa 1 — footer fijo con el CTA sobre el borde inferior
//   05 BOTTOM SHEET de preconfig (BottomSheetShell) con su CTA "Listo"
//   06 crear-rodeo — uno de los 8 footers del `+ 12` hardcodeado — assert 12px
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/aire-safe-area.capture.ts \
//     --config playwright.capture.config.ts --workers=1
// Salida: app/e2e/captures/__shots__/aire-safe-area/ (gitignoreado — ADR-029 §Artefactos).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome, gotoTab } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'aire-safe-area');

test.afterAll(async () => {
  await cleanupAll();
});

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test('capturas «aire»: bottom-nav, CTA de maniobra, footers de wizard y bottom sheet', async ({ page }) => {
  test.setTimeout(240_000);
  const user = await createTestUser('aire');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Aire');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // ── 01 — HOME con el BOTTOM-NAV: su paddingBottom sale del hook compartido. ──
  await shot(page, '01-home-bottom-nav');

  // Cierre del lazo source→runtime: en WEB la reserva tiene que ser el PISO ($navBottomMin = 12) y el
  // nav 60+12=72 — EXACTAMENTE lo que medía antes de esta unidad. Si acá aparece 16 (o 76), volvió la
  // fórmula "aditiva en todas las plataformas" que se descartó: el aire es solo de Android.
  // El contenedor del nav es el PADRE del `role="tablist"` de react-navigation: ahí aterrizan el
  // `height` y el `paddingBottom` que sale de `computeTabBarInsetLayout` (tabBarStyle).
  const navBox = await page.getByRole('tablist').evaluate((el) => {
    const box = el.parentElement as HTMLElement;
    const cs = getComputedStyle(box);
    return { paddingBottom: cs.paddingBottom, height: cs.height };
  });
  expect(navBox.paddingBottom).toBe('12px');
  expect(navBox.height).toBe('72px');

  // ── 02 — Tab ANIMALES: la lista corre por detrás y el nav conserva su reserva. ──
  await gotoTab(page, 'Animales', page.getByLabel('Buscar animal por caravana o número', { exact: true }));
  await shot(page, '02-animales-bottom-nav');

  // ── 03 — MANIOBRA: la pantalla del reporte 🔴. El CTA "Nueva jornada" es el que en el device quedaba
  //         a 1dp de la barra del sistema. Acá se ve su separación del borde inferior. ──
  const fab = page.getByRole('button', { name: 'Abrir MODO MANIOBRAS', exact: true });
  await expect(fab).toBeVisible({ timeout: 30_000 });
  await fab.click();
  const nuevaJornada = page.getByRole('button', { name: 'Nueva jornada', exact: true });
  await expect(nuevaJornada).toBeVisible({ timeout: 20_000 });
  await shot(page, '03-maniobra-cta-nueva-jornada');

  // ── 04 — Wizard etapa 1 (elegir rodeo): footer fijo apoyado en el borde inferior. ──
  await nuevaJornada.click();
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(page, '04-jornada-etapa1-footer');

  // ── 05 — BOTTOM SHEET de preconfig (BottomSheetShell): su footer con "Listo" es lo que quedaba
  //         soldado a la barra del sistema en Android (mismo y=1508 que el CTA de la home). ──
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('selected-body-0').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 15_000 });
  await shot(page, '05-sheet-preconfig-cta-listo');

  // ── 06 — CREAR RODEO: uno de los 8 footers que sumaban un `+ 12` HARDCODEADO. Ese `+12` NO era aire
  //         de diseño (el repo ya lo tenía anotado como deuda: "hardcodean +12 en vez de usar
  //         $navBottomMin") → se plegó DENTRO de la reserva canónica en vez de conservarse como
  //         excepción. En web el número no se mueve (0+12 = 12 antes y después); en iOS baja de 46 a
  //         34 y en Android 3 botones sube de 60 a 64 — eso es veredicto de device. ──
  await page.goto('/crear-rodeo');
  const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
  await expect(continuar).toBeVisible({ timeout: 30_000 });
  // Con el cuerpo todavía en "Cargando sistemas productivos…" la captura no sirve para vetar nada:
  // se espera el contenido real para que el veto vea la pantalla, no el placeholder.
  await expect(page.getByText('Cargando sistemas productivos…')).toBeHidden({ timeout: 30_000 });

  // Segundo cierre source→runtime, esta vez sobre un footer de pantalla (el primero fue el nav): la
  // reserva de este footer en web tiene que valer 12px — el MISMO píxel que el `insets.bottom + 12` del
  // baseline. Si diera 24 (piso + extra) o 0, la armonización de los 8 outliers movió web, que es
  // justamente lo que NO tiene que pasar. Se sube por los ancestros hasta la barra (el único contenedor
  // con borde superior) para no depender de cuántos wrappers meta Tamagui.
  const footerPad = await continuar.evaluate((el) => {
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i++) {
      const cs = getComputedStyle(node);
      if (cs.borderTopWidth === '1px') return cs.paddingBottom;
      node = node.parentElement;
    }
    return null;
  });
  expect(footerPad).toBe('12px');

  await shot(page, '06-crear-rodeo-footer');
});
