// e2e/sheet-arrastre.spec.ts — REGRESIÓN del ARRASTRE-PARA-CERRAR del primitivo `BottomSheetShell`.
//
// BUG 🔴 MANGA (Raf, device iOS): el shell DIBUJABA un grabber pero NO tenía ningún gesture handler. El
// arrastre caía al gesto de descarte del modal de iOS → cerraba la PANTALLA DE ABAJO (la jornada entera)
// en vez del sheet de arriba. Ahora el shell es dueño de su gesto (`src/components/BottomSheetShell.tsx` +
// las decisiones puras de `src/utils/sheet-gestures.ts`), y el fix hermano de `app/app/_layout.tsx` le sacó el
// gesto de descarte a las pantallas del flujo de jornada.
//
// ── POR QUÉ SE EJERCE SOBRE EL PICKER DE RAZAS Y NO SOBRE "VACUNACIÓN" ────────────────────────────────
// El fix vive en el PRIMITIVO: los 4 sheets con input lo heredan igual. Se elige `breed-sheet`
// (crear-animal) porque su pantalla y su componente están FUERA del file-set que otra terminal está
// tocando en paralelo (ManeuverConfigSheet/jornada) → este spec no compite con ese trabajo. El sheet de
// vacunas queda cubierto por `sheet-teclado.spec.ts` (X, layout con poco alto útil) y por el capture.
//
// ── QUÉ PUEDE VERIFICAR WEB Y QUÉ NO (honestidad de cobertura, ADR-029) ───────────────────────────────
// SÍ (y es regresión real, con el gesto manejado por react-native-gesture-handler igual que en device):
//   1. Arrastrar el GRABBER hacia abajo pasando el umbral CIERRA el sheet.
//   2. Un arrastre CORTO (bajo el umbral) NO lo cierra y el sheet VUELVE a su lugar → el umbral existe de
//      verdad (si el gesto cerrara con cualquier roce, este caso caería).
//   3. Anti-falso-verde: durante el arrastre el sheet SIGUE AL DEDO (su transform translateY crece) → el
//      Pan se activó; el "se cerró" no vino de otra cosa (un tap al scrim, un re-render).
//   4. El arrastre iniciado DENTRO del body con la lista SCROLLEADA no cierra el sheet (no le robamos el
//      scroll al operario) — y el header, en cambio, sigue arrastrando (prueba de que lo que frenó al
//      cuerpo fue el gate y no que el gesto esté muerto).
// NO: el gesto REAL con el dedo (iOS/Android), que el modal de la jornada ya no se descarte por arrastre
// (en react-native-web no existe el gesto modal de iOS), y la conducta con el TECLADO ARRIBA (web no monta
// teclado virtual → `useKeyboardVisible` queda false). Eso es veredicto de DEVICE de Raf; la decisión del
// teclado está lockeada por unit (`src/utils/sheet-gestures.test.ts`).

import { test, expect, type Page } from './helpers/fixtures';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHEET = 'breed-sheet';

/**
 * translateY REAL del sheet, leído del DOM: el estilo animado vive en el `Animated.View` que ENVUELVE al
 * contenedor con testID → subimos unos ancestros y nos quedamos con el mayor desplazamiento vertical.
 * En reposo es 0; mientras el dedo arrastra, ≈ lo que se movió el dedo.
 */
async function sheetTranslateY(page: Page): Promise<number> {
  return page.getByTestId(SHEET).evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    let ty = 0;
    for (let i = 0; i < 3 && node; i += 1) {
      const cs = getComputedStyle(node);
      if (cs.transform && cs.transform !== 'none') {
        const m = new DOMMatrixReadOnly(cs.transform);
        if (Math.abs(m.f) > Math.abs(ty)) ty = m.f;
      }
      node = node.parentElement;
    }
    return ty;
  });
}

/** Centro del grabber del sheet (el ancla del arrastre). Con timeout explícito: sin él, un `boundingBox()`
 *  sobre un sheet que ya se cerró espera para SIEMPRE y el caso muere por timeout de test en vez de por el
 *  assert que importa. */
async function grabberCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(`${SHEET}-grip`).boundingBox({ timeout: 10_000 });
  if (!box) throw new Error(`${SHEET}-grip sin boundingBox`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Arrastra desde (x,y) `distance` px hacia abajo en pasos, MIDE el translateY con el dedo todavía abajo, y
 * recién ahí suelta. `settleMs` antes de soltar deja la velocidad en ~0 (así el caso "corto" se juzga por
 * DISTANCIA y no se cuela por el camino del flick).
 */
async function dragDownAndRelease(
  page: Page,
  from: { x: number; y: number },
  distance: number,
  opts: { stepMs?: number; settleMs?: number } = {},
): Promise<number> {
  const { stepMs = 16, settleMs = 0 } = opts;
  const steps = 12;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x, from.y + (distance * i) / steps);
    await page.waitForTimeout(stepMs);
  }
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  const translated = await sheetTranslateY(page);
  await page.mouse.up();
  return translated;
}

/** Deja el alta de animal en el paso "Datos del animal" y ABRE el picker de razas. */
async function openBreedSheet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Elegir raza', exact: true }).click();
  await expect(page.getByTestId(SHEET)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('breed-option-none')).toBeVisible();
}

async function gotoDatosDelAnimal(page: Page): Promise<void> {
  await gotoAnimales(page);
  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Categoría Vaquillona', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('arrastrar el grabber: corto NO cierra (y el sheet vuelve), largo SÍ cierra', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('sheet-gestures-grip');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Sheet Arrastre');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoDatosDelAnimal(page);
  await openBreedSheet(page);

  // CONTROL en reposo: el sheet está en su lugar (línea de base del oráculo de gesto).
  expect(await sheetTranslateY(page)).toBeLessThan(1);

  // ── (1) ARRASTRE CORTO (40px, lento y con el dedo quieto antes de soltar) ──
  // 40px está MUY por debajo del umbral (25% del alto del sheet, con piso de 64px) y sin velocidad de
  // flick → NO debe cerrar. Con el dedo abajo, el sheet YA se movió ≈40px: el gesto tomó de verdad.
  const grip = await grabberCenter(page);
  const shortTranslate = await dragDownAndRelease(page, grip, 40, { stepMs: 30, settleMs: 250 });
  expect(shortTranslate, 'el sheet no siguió al dedo (el Pan no se activó)').toBeGreaterThan(20);
  await expect(page.getByTestId(SHEET), 'un arrastre corto NO debe cerrar el sheet').toBeVisible();
  // Y vuelve a su lugar con el spring (le damos unos frames).
  await expect
    .poll(async () => Math.abs(await sheetTranslateY(page)), { timeout: 5_000 })
    .toBeLessThan(2);

  // ── (2) ARRASTRE LARGO (300px > 25% del alto del sheet) → CIERRA ──
  const grip2 = await grabberCenter(page);
  const longTranslate = await dragDownAndRelease(page, grip2, 300);
  expect(longTranslate, 'el sheet no siguió al dedo en el arrastre largo').toBeGreaterThan(150);
  await expect(page.getByTestId(SHEET)).toHaveCount(0, { timeout: 10_000 });
  // Cerró SIN elegir raza: el form sigue reclamándola (no se coló una selección por el gesto).
  await expect(
    page.getByText('Completá la raza para poder exportar el animal a SIGSA.', { exact: true }),
  ).toBeVisible();
});

test('con la lista SCROLLEADA, arrastrar desde el cuerpo no cierra el sheet (el header sí)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('sheet-gestures-scroll');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Sheet Scroll');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoDatosDelAnimal(page);
  await openBreedSheet(page);

  // WEB: el detector del cuerpo va con `touch-action: pan-y` (el default de gesture-handler es `none`, que
  // le comería al navegador el scroll TÁCTIL del contenido del sheet — clase 🔴 manga). gesture-handler-web
  // escribe ese estilo sobre la vista del PROPIO detector (`GestureHandlerWebDelegate`: `this.view.style
  // ['touchAction']`), que es el contenedor del contenido del body → hay que leerlo AHÍ, no en el scroller
  // (el scroller computa el default `auto` y un aserto contra él pasa siempre, aunque el fix no exista).
  // FALSIFICADO: sacando `touchAction="pan-y"` del `GestureDetector` del cuerpo, este aserto cae con
  // `touch-action: none`. El mouse no sufre `touch-action` (solo aplica a input táctil), por eso los casos
  // de arrastre de este spec siguen valiendo con `page.mouse`.
  const dragSurfaceTouchAction = await page
    .getByTestId(`${SHEET}-body-drag`)
    .evaluate((el) => getComputedStyle(el as HTMLElement).touchAction);
  expect(
    dragSurfaceTouchAction,
    'el detector del cuerpo se comería el scroll táctil del sheet en web',
  ).toBe('pan-y');

  const sheetBox = await page.getByTestId(SHEET).boundingBox();
  if (!sheetBox) throw new Error('breed-sheet sin boundingBox');
  const bodyPoint = { x: sheetBox.x + sheetBox.width / 2, y: sheetBox.y + sheetBox.height * 0.6 };

  // ── CONTROL (la variable de este test es EL SCROLL, no "si el cuerpo arrastra") ──
  // Con la lista EN EL TOPE, arrastrar desde el CUERPO sí mueve el sheet (40px, bajo el umbral → no cierra).
  // Sin este control, el caso de abajo pasaría igual si el arrastre desde el cuerpo no funcionara NUNCA.
  // Se arranca sobre el BUSCADOR (primer elemento del cuerpo) y no sobre una fila de raza: en web, soltar
  // el mouse sobre la MISMA fila donde se apretó dispara igual el `click` del DOM (elegiría la raza y
  // cerraría el picker por una razón ajena al gesto). Con 300px de recorrido eso no pasa — el `click` cae
  // en el ancestro común, no en la fila —, por eso el caso scrolleado de abajo sí arranca en el cuerpo.
  const searchBox = await page.getByTestId('breed-sheet-search').boundingBox();
  if (!searchBox) throw new Error('breed-sheet-search sin boundingBox');
  const searchPoint = { x: searchBox.x + searchBox.width / 2, y: searchBox.y + searchBox.height / 2 };
  const atTopTranslate = await dragDownAndRelease(page, searchPoint, 40, { stepMs: 30, settleMs: 250 });
  expect(atTopTranslate, 'con la lista en el tope, el cuerpo debe arrastrar el sheet').toBeGreaterThan(20);
  await expect(page.getByTestId(SHEET)).toBeVisible();
  await expect
    .poll(async () => Math.abs(await sheetTranslateY(page)), { timeout: 5_000 })
    .toBeLessThan(2);

  // Scrolleamos la lista de razas DENTRO del sheet (rueda sobre el cuerpo del sheet, como haría el dedo).
  await page.mouse.move(bodyPoint.x, bodyPoint.y);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);

  // ── El arrastre iniciado en el CUERPO con la lista scrolleada NO mueve ni cierra el sheet ──
  const bodyTranslate = await dragDownAndRelease(page, bodyPoint, 300);
  expect(bodyTranslate, 'el sheet se arrastró desde el cuerpo scrolleado (le robó el scroll al operario)').toBeLessThan(
    2,
  );
  await expect(page.getByTestId(SHEET), 'el arrastre desde el cuerpo scrolleado cerró el sheet').toBeVisible();

  // ── ANTI-FALSO-VERDE: el gesto NO está muerto — desde el HEADER sigue arrastrando y cierra ──
  const grip = await grabberCenter(page);
  const headerTranslate = await dragDownAndRelease(page, grip, 300);
  expect(headerTranslate, 'el header dejó de arrastrar').toBeGreaterThan(150);
  await expect(page.getByTestId(SHEET)).toHaveCount(0, { timeout: 10_000 });
});

test('el FOOTER no es ancla de arrastre (ahí viven los CTAs)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('sheet-gestures-footer');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Sheet Footer');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoDatosDelAnimal(page);
  await openBreedSheet(page);

  // Los detectores son DISJUNTOS (header ↔ ScrollView del body): el footer no queda cubierto por ninguno.
  // Con el sheet EN EL TOPE (donde el body SÍ arrastraría), un arrastre largo desde el CTA secundario no
  // mueve ni cierra el sheet. Si alguien volviera a montar el detector del cuerpo sobre el sheet entero,
  // este caso cae.
  const footerBox = await page.getByTestId('breed-sheet-cancelar').boundingBox({ timeout: 10_000 });
  if (!footerBox) throw new Error('breed-sheet-cancelar sin boundingBox');
  const footerPoint = { x: footerBox.x + footerBox.width / 2, y: footerBox.y + footerBox.height / 2 };
  const footerTranslate = await dragDownAndRelease(page, footerPoint, 300);
  expect(footerTranslate, 'el footer arrastró el sheet').toBeLessThan(2);
  await expect(page.getByTestId(SHEET), 'el arrastre desde el footer cerró el sheet').toBeVisible();

  // Y el CTA del footer sigue siendo un CTA (el gesto no le comió el tap).
  await page.getByTestId('breed-sheet-cancelar').click();
  await expect(page.getByTestId(SHEET)).toHaveCount(0, { timeout: 10_000 });
});
