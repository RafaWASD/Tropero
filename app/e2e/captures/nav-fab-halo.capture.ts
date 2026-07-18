// e2e/captures/nav-fab-halo.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para los fixes del FAB
// central del bottom-nav canónico (app/(tabs)/_layout.tsx):
//
//   FIX 1 — el halo verde pálido se pintaba ENCIMA del círculo del FAB (estaba montado como HIJO con
//           zIndex:-1: en RN-web el <button> del Pressable crea stacking context → el hijo negativo
//           queda por encima del FONDO del padre; en nativo un hijo NUNCA se pinta detrás del background
//           de su padre). Resultado medido: relleno rgb(82,142,112) = $primary velado por el halo, en
//           vez del $primary puro rgb(30,90,62). El fix monta el halo como HERMANO ANTERIOR del círculo.
//   FIX 2 — hitSlop del Pressable (zona muerta de tap; NO reproducible en web, ver el comentario del
//           layout).
//
// Las capturas NOMBRADAS van a e2e/captures/__shots__/nav-fab-halo/NN-estado.png para que el leader
// vete el diseño (design-review) y mida el relleno del FAB con Pillow: el criterio de éxito del FIX 1
// es que el centro del círculo dé $primary (30,90,62) ±2, y que el anillo del halo (⌀72 = fab+4 por
// lado) siga VISIBLE alrededor.
//
// Estados clave capturados (el nav es cross-cutting: los "estados" son las tabs, no pantallas nuevas):
//   01 — home con la tab Inicio activa (FAB en reposo, el estado canónico del nav), 412.
//   02 — crop del FAB (medición del relleno + del anillo), 412.
//   03 — crop de la barra completa (relación FAB ↔ items planos ↔ label "Maniobra"), 412.
//   04 — tab Animales activa (el FAB no cambia; la pill M3 del active-indicator se mueve), 412.
//   05 — home a 360 (LA MANGA MÁS ANGOSTA): el ancho crítico del nav.
//   06 — crop de la barra completa a 360 (halo ⌀72 vs celda de 72 + los 5 labels).
//   07 — crop del FAB a 360 (relleno + anillo).
//   08 — el FAB sigue abriendo MODO MANIOBRAS (tap real, de vuelta a 412).
//
// ⚠️ POR QUÉ 360 ADEMÁS DE 412 (convenio del repo, ver e2e/maniobra-custom.spec.ts:47-53): 412 es el
// teléfono de referencia, 360 es el ancho más angosto que soportamos. En el nav el ancho es CRÍTICO
// porque la celda de cada item = ancho/5: a 412 mide 82.4 y a 360 mide 72 EXACTOS. Con el halo de B4
// (⌀72 = $fab 64 + 4 por lado) el anillo entra JUSTO en la celda a 360; con el halo anterior (⌀80)
// desbordaba 4px por lado sobre las celdas vecinas (Animales / Reportes). La captura a 360 es la
// EVIDENCIA VISUAL de esa mejora, no solo la cuenta.
//
// ⚠️ NO es un test de regresión (.capture.ts → NO corre en `pnpm e2e`). La red de regresión del FAB son
// los specs que lo tapean por su rol accesible (maniobra-custom.spec.ts, maniobra-config-sheet-race.spec.ts:
// getByRole('button', { name: 'Abrir MODO MANIOBRAS' })) — el fix preserva ese rol/label intactos.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/nav-fab-halo.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida:
//   - app/e2e/captures/__shots__/nav-fab-halo/  (gitignoreado — ver app/.gitignore + ADR-029).
//   - design/nav-iter-2/B4-360.png              (SÍ se versiona: el render de la variante elegida al
//     ancho angosto, hermano de B4.png a 412 — ver DESIGN_B4_360 abajo).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import { admin, createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll, RUN_TAG } from '../helpers/admin';
import { signIn, waitForHome, gotoTab } from '../helpers/ui';

// Path RELATIVO a app/ (cwd de Playwright) → app/e2e/captures/__shots__/nav-fab-halo/.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'nav-fab-halo');

// ÚNICO archivo de esta captura que SÍ se versiona: el render de la variante elegida (B4) al ancho
// angosto, hermano de design/nav-iter-2/B4.png (412). Vive en design/ —no en __shots__— porque no es
// un artefacto de corrida sino la EVIDENCIA de la iteración de diseño que Raf compara lado a lado
// (design/nav-iter-2/ guarda un render por variante: A1..A4, B1..B5, C1..C3, D1..D3).
// Path relativo a app/ (cwd de Playwright) → <repo>/design/nav-iter-2/B4-360.png.
const DESIGN_B4_360 = path.join('..', 'design', 'nav-iter-2', 'B4-360.png');

// Anchos capturados (convenio del repo: 412 de referencia + 360 la manga más angosta).
const W_REF = 412;
const H_REF = 915;
const W_NARROW = 360;
const H_NARROW = 915; // mismo alto que los renders de design/nav-iter-2/ → comparables lado a lado.

// Geometría de B4 que la captura ASSERTEA (espejo de tamagui.config.ts: $fab / $fabHalo - $fab).
// Acá van como literales A PROPÓSITO: el capture es el ORÁCULO EXTERNO del diseño; si alguien cambia
// el token, esta aserción tiene que fallar y obligar a re-vetar el nav a 360.
const FAB_DIAMETER = 64;
const HALO_GROWTH = 8; // $fabHalo (72) − $fab (64) → 4px de anillo por lado.
const NAV_ITEMS = 5;

// Nombre LIMPIO del campo para la captura demo (R12.4): el header de la home muestra el nombre del
// establecimiento y el prefijo RUN_TAG ("e2e_1763…") ensucia la pantalla que ve Raf. seedEstablishment
// SIEMPRE namespacea (la red de seguridad del barrido por nombre de cleanupAll es por `name like RUN_TAG%`),
// así que NO lo tocamos: sembramos namespaceado, renombramos a este nombre limpio SOLO para la captura y
// restauramos el nombre namespaceado en el finally, ANTES del cleanup. Así la red de seguridad cross-run
// queda intacta (si el proceso muere, el campo sigue teniendo el RUN_TAG y el barrido lo levanta).
const CLEAN_NAME = 'La Esperanza';

test.afterAll(async () => {
  await cleanupAll();
});

/** Saca una captura NOMBRADA tras un breve settle de layout. */
async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), ...(clip ? { clip } : {}) });
}

test('captura nav canónico: FAB $primary sólido + anillo del halo detrás', async ({ page }) => {
  test.setTimeout(240_000);

  const user = await createTestUser('navfab');
  await setUserPhone(user.id, '1123456789');
  const seededName = `${RUN_TAG} Campo NavFab`; // el nombre namespaceado que pone seedEstablishment
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo NavFab', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });

  // Nombre limpio SOLO para la captura (ver CLEAN_NAME).
  const { error: renameErr } = await admin
    .from('establishments')
    .update({ name: CLEAN_NAME })
    .eq('id', establishmentId);
  if (renameErr) throw new Error(`rename establishment: ${renameErr.message}`);

  // Guardia de sanidad del restructure: si RNW no reconociera alguna prop nueva (ej. hitSlop) o si
  // Tamagui se quejara del árbol, saldría por consola. Lo miramos al final del recorrido.
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
  });

  try {
    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    const fab = page.getByRole('button', { name: 'Abrir MODO MANIOBRAS', exact: true });
    await expect(fab).toBeVisible({ timeout: 30_000 });

    // ── 01 — home con Inicio activa: el nav canónico completo, FAB en reposo. ──
    await shot(page, '01-home-nav-inicio-activa');

    // ── 02 — crop del FAB: es LA captura que se mide con Pillow (relleno del círculo + anillo). ──
    // El box del Pressable es el círculo sólido (⌀64); ampliamos con margen para que entre el anillo
    // del halo (4px por lado) y la sombra.
    const box = await fab.boundingBox();
    if (!box) throw new Error('El FAB no tiene boundingBox (¿no se montó el bottom-nav?)');
    const MARGIN = 24;
    await shot(page, '02-fab-crop', {
      x: Math.max(0, box.x - MARGIN),
      y: Math.max(0, box.y - MARGIN),
      width: box.width + MARGIN * 2,
      height: box.height + MARGIN * 2,
    });

    // ── 03 — crop de la barra completa: FAB ↔ items planos ↔ label "Maniobra". ──
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('sin viewport');
    const barTop = Math.max(0, box.y - MARGIN);
    await shot(page, '03-nav-completo', {
      x: 0,
      y: barTop,
      width: viewport.width,
      height: viewport.height - barTop,
    });

    // ── 04 — tab Animales activa: el FAB NO cambia; se mueve la pill M3 del active-indicator. ──
    await gotoTab(page, 'Animales', page.getByLabel('Buscar animal por caravana o número', { exact: true }));
    await expect(fab).toBeVisible({ timeout: 20_000 });
    await shot(page, '04-nav-animales-activa');

    // ── 05/06/07 — EL ANCHO ANGOSTO (360): halo ⌀72 vs celda de 72 + los 5 labels. ──
    // Volvemos a Inicio para que el render a 360 sea comparable con design/nav-iter-2/B4.png (home).
    await gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/));
    await page.setViewportSize({ width: W_NARROW, height: H_NARROW });
    await expect(fab).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(400); // settle del relayout de la barra al cambiar de ancho.

    // Medición EN VIVO (no a ojo): el ancho real de la celda del FAB = el contenedor del Pressable,
    // que es el YStack flex:1 que React Navigation le da a la tab. A 360 debe dar 360/5 = 72.
    const boxNarrow = await fab.boundingBox();
    if (!boxNarrow) throw new Error('El FAB no tiene boundingBox a 360');
    const cellWidth = await fab.evaluate((el) => {
      const parent = (el as HTMLElement).parentElement;
      if (!parent) throw new Error('El FAB no tiene contenedor de celda');
      return parent.getBoundingClientRect().width;
    });
    console.log(
      `[nav-fab-halo] 360px → celda ${cellWidth}px · círculo ${boxNarrow.width}px · halo ⌀${FAB_DIAMETER + HALO_GROWTH}px ` +
        `· aire por lado ${(cellWidth - (FAB_DIAMETER + HALO_GROWTH)) / 2}px`,
    );

    await shot(page, '05-home-nav-360');
    // El MISMO frame va también a design/nav-iter-2/B4-360.png (el que se versiona y se compara con B4.png).
    await page.screenshot({ path: DESIGN_B4_360 });

    const barTopNarrow = Math.max(0, boxNarrow.y - MARGIN);
    await shot(page, '06-nav-completo-360', {
      x: 0,
      y: barTopNarrow,
      width: W_NARROW,
      height: H_NARROW - barTopNarrow,
    });
    await shot(page, '07-fab-crop-360', {
      x: Math.max(0, boxNarrow.x - MARGIN),
      y: Math.max(0, boxNarrow.y - MARGIN),
      width: boxNarrow.width + MARGIN * 2,
      height: boxNarrow.height + MARGIN * 2,
    });

    // Aserciones DESPUÉS de las capturas A PROPÓSITO: si la geometría se rompe, queremos la
    // evidencia visual en disco para diagnosticar, no solo el rojo.
    // El círculo mide $fab y el halo asoma HALO_GROWTH/2 por lado → el anillo tiene que ENTRAR en la
    // celda. Con el halo anterior (⌀80) esto daba negativo a 360: desbordaba sobre Animales/Reportes.
    expect(Math.round(boxNarrow.width)).toBe(FAB_DIAMETER);
    expect(Math.round(cellWidth)).toBe(Math.round(W_NARROW / NAV_ITEMS));
    expect(FAB_DIAMETER + HALO_GROWTH).toBeLessThanOrEqual(Math.round(cellWidth));

    // Vuelta al ancho de referencia para el tap de cierre.
    await page.setViewportSize({ width: W_REF, height: H_REF });
    await page.waitForTimeout(300);

    // ── 08 — el FAB SIGUE ABRIENDO MODO MANIOBRAS. ──
    // GUARDIA del restructure: el círculo sólido pasó a ser un HIJO del Pressable (antes el propio
    // Pressable pintaba el círculo). Si ese hijo interceptara el puntero o el Pressable perdiera el
    // responder, el CTA más importante del nav quedaría muerto y la captura seguiría viéndose bien.
    // Por eso se tapea de verdad y se assertea la navegación (mismo selector que usan los specs de
    // regresión: getByRole('button', { name: 'Abrir MODO MANIOBRAS' })).
    await fab.click();
    await expect(page).toHaveURL(/\/maniobra/, { timeout: 20_000 });
    await shot(page, '08-fab-abre-modo-maniobras');
  } finally {
    // Restaurar el nombre namespaceado ANTES del cleanup (la red de seguridad por nombre vuelve a aplicar).
    await admin.from('establishments').update({ name: seededName }).eq('id', establishmentId);
  }

  // Ruido de consola relevante al nav (props no reconocidas por react-native-web, etc.). Se reporta,
  // no se falla: la consola del bundle trae ruido ajeno (PowerSync, fuentes) que no es de este fix.
  const navNoise = consoleErrors.filter((m) => /hitSlop|zIndex|Pressable|unknown prop|not recognize/i.test(m));
  if (navNoise.length > 0) console.log('[nav-fab-halo] ruido de consola del nav:', navNoise);
});
