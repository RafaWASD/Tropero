// e2e/captures/sheet-arrastre.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029) de
// los dos fixes 🔴 MANGA de "quién es dueño del gesto de descarte" (Raf, device iOS, build f9b943f7):
//
//   FIX 1 (`app/app/_layout.tsx`): el arrastre hacia abajo DESTRUÍA la jornada entera sin confirmación
//          (salteando incluso el `ExitJornadaSheet` de cierre guardado, R10.7). Las pantallas del flujo
//          (`maniobra/jornada`, `maniobra/identificar`, `maniobra/carga`) heredaban la presentación modal
//          del landing → cada una era un page-sheet con su propio swipe-to-destroy. Ahora van
//          `presentation: 'fullScreenModal'` + `gestureEnabled: false`.
//   FIX 2 (`src/components/BottomSheetShell.tsx`): el shell dibujaba un grabber SIN gesto (el arrastre caía
//          al gesto del modal de abajo y cerraba la pantalla, no el sheet). Ahora el sheet es dueño de su
//          arrastre: sigue al dedo, cierra pasando el umbral, vuelve si no, y no le roba el scroll al body.
//
// ── QUÉ MUESTRAN Y QUÉ NO ────────────────────────────────────────────────────────────────────────────
// El FIX 1 NO es observable en web: `NativeStackView` web ignora `presentation` salvo para las
// presentaciones transparentes, y el gesto modal de iOS no existe en react-native-web. Lo que sí se
// fotografía es su CONSECUENCIA funcional en el flujo (08: la jornada sigue viva después de cerrar el sheet
// por arrastre) y todo el FIX 2, que en web corre con el mismo gesture-handler que en device.
// El veredicto del gesto REAL con el dedo (iOS/Android) y de la conducta con el TECLADO ARRIBA (web no monta
// teclado virtual) es de DEVICE (Raf).
//
// Estados capturados:
//   01 — picker de razas EN REPOSO: el grabber (que ahora sí hace lo que promete) + header + lista
//   02 — ARRASTRE EN CURSO desde el grabber (dedo abajo): el sheet sigue al dedo y aparece el scrim detrás
//   03 — tras soltar un arrastre CORTO (bajo el umbral): el sheet VOLVIÓ a su lugar
//   04 — tras el arrastre LARGO: el sheet cerrado y "Datos del animal" INTACTO detrás (no navegó atrás)
//   05 — con la lista SCROLLEADA, arrastre en curso desde el CUERPO: el sheet NO se mueve (manda el scroll)
//   06 — sheet "Vacunación" (el del reporte de Raf) en la etapa 2 del wizard, con su grabber; el contenido
//        entra entero → SIN fade (el affordance no miente)
//   06b — el MISMO sheet con el alto útil recortado (412×420 ≈ teclado abierto) y contenido que DESBORDA:
//        peek (aire al final) + fade + chevron ▾ en vez del último chip rebanado al ras del CTA
//   07 — ese mismo sheet EN ARRASTRE: el gesto mueve EL SHEET, no la pantalla de abajo
//   08 — la etapa 2 DESPUÉS de cerrarlo por arrastre: la jornada configurada SIGUE VIVA (lo que el bug
//        destruía). Es la foto clave del par de fixes.
//
// NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/sheet-arrastre.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect, type Page, type Browser } from '../helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', 'sheet-arrastre');
const FULL = { width: 412, height: 915 } as const;

async function newMobilePage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { ...FULL } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Centro del grabber de un sheet (el ancla del arrastre). Con timeout explícito: sin él, un
 *  `boundingBox()` sobre un sheet que ya no está espera para SIEMPRE y el caso muere por timeout de test. */
async function grabberCenter(page: Page, sheetTestId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(`${sheetTestId}-grip`).boundingBox({ timeout: 10_000 });
  if (!box) throw new Error(`${sheetTestId}-grip sin boundingBox`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Arrastra hacia abajo y deja el dedo ABAJO (para fotografiar el gesto en curso). */
async function dragDownAndHold(page: Page, from: { x: number; y: number }, distance: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await dragFurtherTo(page, from, distance, 0);
}

/** Continúa un arrastre YA en curso (dedo abajo) desde `fromDistance` hasta `distance`. */
async function dragFurtherTo(
  page: Page,
  from: { x: number; y: number },
  distance: number,
  fromDistance: number,
): Promise<void> {
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x, from.y + fromDistance + ((distance - fromDistance) * i) / steps);
    await page.waitForTimeout(16);
  }
}

test('capturas arrastre-para-cerrar: picker de razas (reposo / en curso / vuelve / cerrado / gate de scroll)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-sheet-arrastre');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Sheet Arrastre');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await gotoAnimales(page);

    await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
    await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Categoría Vaquillona', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Elegir raza', exact: true }).click();
    await expect(page.getByTestId('breed-sheet')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('breed-option-none')).toBeVisible();

    // 01) REPOSO — el grabber arriba de todo: ahora es un significante honesto.
    await shot(page, '01-razas-reposo');

    // 02) ARRASTRE EN CURSO (dedo abajo, 140px): el sheet sigue al dedo y destapa scrim.
    const grip = await grabberCenter(page, 'breed-sheet');
    await dragDownAndHold(page, grip, 140);
    await shot(page, '02-razas-arrastre-en-curso');
    await page.mouse.up();

    // 03) VOLVIÓ — 140px no alcanza el umbral (25% del alto del sheet) → spring a su lugar.
    await expect(page.getByTestId('breed-sheet')).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, '03-razas-volvio-tras-arrastre-corto');

    // 04) CERRADO POR ARRASTRE — 300px pasa el umbral. Detrás queda "Datos del animal" INTACTO: el gesto
    //     cerró EL SHEET, no la pantalla (que es exactamente lo que hacía mal antes).
    const grip2 = await grabberCenter(page, 'breed-sheet');
    await dragDownAndHold(page, grip2, 300);
    await page.mouse.up();
    await expect(page.getByTestId('breed-sheet')).toHaveCount(0, { timeout: 10_000 });
    await shot(page, '04-razas-cerrado-por-arrastre');

    // 05) GATE DE SCROLL — reabrimos, scrolleamos la lista y arrastramos DESDE EL CUERPO: el sheet no se
    //     mueve (el arrastre es del operario que está scrolleando, no del sheet).
    await page.getByRole('button', { name: 'Elegir raza', exact: true }).click();
    await expect(page.getByTestId('breed-sheet')).toBeVisible({ timeout: 20_000 });
    const sheetBox = await page.getByTestId('breed-sheet').boundingBox();
    if (!sheetBox) throw new Error('breed-sheet sin boundingBox');
    const bodyPoint = { x: sheetBox.x + sheetBox.width / 2, y: sheetBox.y + sheetBox.height * 0.6 };
    await page.mouse.move(bodyPoint.x, bodyPoint.y);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    await dragDownAndHold(page, bodyPoint, 200);
    await shot(page, '05-razas-cuerpo-scrolleado-no-arrastra');
    await page.mouse.up();
  } finally {
    await page.context().close();
  }
});

test('capturas arrastre-para-cerrar: sheet "Vacunación" y la jornada que SOBREVIVE al gesto', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-sheet-arr-vac');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Arrastre Vacunas');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // Etapa 2 del wizard con Vacunación elegida → sheet de preconfig (el del reporte de Raf).
    await page.goto('/maniobra/jornada');
    await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
    await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('pool-row-vacunacion').click();
    await expect(page.getByTestId('selected-row-0')).toBeVisible();
    await page.getByTestId('selected-body-0').click();
    await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });

    // Cargamos una vacuna para que el sheet tenga contenido real (y la jornada, estado que perder).
    await page.getByTestId('maneuver-config-input').fill('Brucelosis');
    await page.getByTestId('maneuver-config-input').press('Enter');
    await expect(page.getByTestId('config-chip-Brucelosis')).toBeVisible({ timeout: 5_000 });

    // 06) REPOSO con su grabber. El contenido ENTRA entero → NO hay fade ni chevron (el affordance no
    //     miente: solo aparece cuando queda algo oculto abajo).
    await shot(page, '06-vacunacion-reposo');

    // 06b) PEOR CASO del veto visual: alto útil recortado (412×420 ≈ lo que queda con el teclado abierto)
    //      + contenido que DESBORDA. Antes, el body se cortaba al ras del CTA "Listo" (un chip rebanado
    //      pegado al botón, sin aire ni señal). Ahora hay peek (aire al final) + fade + chevron ▾.
    for (const vacuna of ['Aftosa', 'Carbunclo', 'Mancha', 'Gangrena', 'Queratoconjuntivitis']) {
      await page.getByTestId('maneuver-config-input').fill(vacuna);
      await page.getByTestId('maneuver-config-input').press('Enter');
      await expect(page.getByTestId(`config-chip-${vacuna}`)).toBeVisible({ timeout: 5_000 });
    }
    await page.setViewportSize({ width: 412, height: 420 });
    await page.waitForTimeout(300);
    await shot(page, '06b-vacunacion-alto-recortado-peek');
    await page.setViewportSize({ ...FULL });
    await page.waitForTimeout(300);

    // 07) ARRASTRE EN CURSO: lo que se mueve es EL SHEET (antes, este mismo gesto se llevaba puesta la
    //     jornada entera porque lo atendía el modal de abajo). Es UN SOLO gesto continuo: fotografiamos a
    //     mitad de camino y seguimos hasta pasar el umbral, sin soltar (este sheet es más BAJO que el
    //     picker de razas → su umbral es menor, y soltar a mitad de camino podría cerrarlo).
    const grip = await grabberCenter(page, 'maneuver-config-sheet');
    await dragDownAndHold(page, grip, 120);
    await shot(page, '07-vacunacion-arrastre-en-curso');

    // 08) LA JORNADA SIGUE VIVA — terminamos el arrastre (pasa el umbral) y la etapa 2 queda tal cual:
    //     rodeo elegido, Vacunación seleccionada y su preconfig cargado. Es lo que el bug destruía.
    await dragFurtherTo(page, grip, 400, 120);
    await page.mouse.up();
    await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible();
    await shot(page, '08-jornada-viva-tras-cerrar-por-arrastre');
  } finally {
    await page.context().close();
  }
});
