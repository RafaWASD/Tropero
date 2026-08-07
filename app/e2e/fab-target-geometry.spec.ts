// e2e/fab-target-geometry.spec.ts — GUARD GEOMÉTRICO del borde inferior de la app.
//
// ── EL BUG QUE CIERRA (🔴 device Android, reporte de Raf, 2026-08-05) ────────────────────────────────
// El `Pressable` del FAB de Maniobra llevaba `hitSlop={{ top: $fabRaise }}`: su TARGET se extendía 26 dp
// por encima del círculo pintado, dentro de la banda donde el chrome ancla el pill del bastón. Tocar la
// mitad de abajo del pill abría MODO MANIOBRAS. Medido en device (barrido de `adb shell input tap`): el
// techo táctil estaba en y=1276 con el círculo pintado arrancando en y=1324 (48 px = 25,6 dp = $fabRaise).
//
// ── POR QUÉ ESTE TEST NO ES DE COMPORTAMIENTO ───────────────────────────────────────────────────────
// **En web el bug es invisible por construcción**: `hitSlop` es NO-OP en react-native-web 0.21.2
// (`Pressable` no lo implementa; la única aparición en el paquete está en el módulo legacy `Touchable`).
// Un "toco el pill y no voy a maniobra" pasa igual con el bug puesto → no prueba nada. Por eso el oráculo
// de acá es **la geometría**: se miden las cajas reales del DOM, se EXPANDE la del FAB por su `hitSlop`
// declarado (que web no aplica pero nativo sí) y se exige que el rect resultante no se cruce con ningún
// otro elemento interactivo de la pantalla.
//
// ⚠️ EL INDICADOR DEL BASTÓN YA NO VIVE ACÁ ABAJO (2026-08-06): se mudó arriba a la derecha. Este archivo
// se conserva entero igual, por el mismo motivo por el que se conserva el modelo de la banda inferior — el
// invariante es *"el target del FAB no invade territorio ajeno"*, y no depende de quién sea el vecino de
// turno. Lo que cambió es la aserción (2), que antes medía la separación pill↔FAB (hoy daría ~700 dp y
// pasaría por trivial) y ahora verifica que la banda del FAB quedó VACÍA y que el indicador aterrizó donde
// el modelo dice.
//
// La pata aritmética del mismo invariante (bandas derivadas de los tokens, sin navegador) vive en
// `src/utils/nav-target-bands.test.ts`; el inventario de clase (¿quién más declara un `hitSlop`? ¿quién
// más se ancla en la banda del FAB?) en `src/utils/tap-target-collision-guard.test.ts`. Este archivo es
// el que caza el DRIFT DE LAYOUT que la aritmética no puede ver.
//
// ⚠️ ACÁ NO HAY ESPEJO, Y ES DELIBERADO (2026-08-06). Hasta esta fecha el archivo declaraba
// `const FAB_HIT_SLOP = { top: 0, right: 0, bottom: 20, left: 0 }` copiado a mano de `_layout.tsx`, y ese
// era el agujero más grande del sistema: **un espejo no puede desmentir al código**. Con el mutante
// `hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}` puesto (o con el `top` metido en la misma línea del
// `const`, que fue el mutante que efectivamente pasó 35/35), este test seguía muestreando la franja de un
// slop que ya no existía y daba verde con el bug 🔴 adentro.
// Ahora el valor se RESUELVE del fuente de producción con `resolveFabHitSlop()` — la misma función que
// usa el guard estático `tap-target-collision-guard.test.ts`. Una sola traducción, dos oráculos.

import { test, applyEnvShim, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome, gotoTab } from './helpers/ui';
import {
  MIN_TAP_TARGET_SEPARATION,
  fabTargetBand,
  insetsWithDefaults,
  navGeometryFromConfig,
  resolveFabHitSlop,
  sizeTokenFromConfig,
  bottomAnchoredBand,
} from '../src/utils/nav-target-bands';

// ─── El VALOR REAL, leído del código de producción (sin copias) ───────────────────────────────────────
// `__dirname` y no `import.meta.url`: Playwright transpila estos specs a CJS, y un `import.meta` fuerza
// el archivo a salida ESM → los `require` que emite para el resto de los imports revientan al cargar
// ("require is not defined in ES module scope"). Es la convención del resto de los specs del repo.
const APP_ROOT = join(__dirname, '..');
const readApp = (p: string) => readFileSync(join(APP_ROOT, p), 'utf8');
const CONFIG_SRC = readApp('tamagui.config.ts');
const LAYOUT_SRC = readApp('app/(tabs)/_layout.tsx');
/** Tokens de space que el resolvedor pueda necesitar si el slop llegara a usarlos (hoy no usa ninguno). */
const SPACE_TOKENS: Record<string, number> = { '2': 7, '3': 13, '4': 18, '6': 32 };

/**
 * El `hitSlop` del FAB tal como lo escribe el componente HOY. Si el fuente usa una gramática que el
 * resolvedor no puede leer, esto TIRA y el test se pone rojo — que es lo correcto: un target que no se
 * puede leer no se puede verificar, y en web tampoco se puede medir (hitSlop es no-op en RNW 0.21.2).
 */
const FAB_HIT_SLOP = insetsWithDefaults(
  resolveFabHitSlop(LAYOUT_SRC, CONFIG_SRC, { spaceToken: (n) => SPACE_TOKENS[n] }).sides,
);
/** Geometría del nav leída de `tamagui.config.ts` (nada hardcodeado acá). */
const NAV = navGeometryFromConfig(CONFIG_SRC);
/** Separación pill↔FAB que predice el modelo aritmético, con el slop REAL y los tokens REALES. */
const MODEL_SEPARATION = (() => {
  const t = {
    safeBottomInset: 0,
    ...NAV,
    fabHitSlopTop: FAB_HIT_SLOP.top,
    fabHitSlopBottom: FAB_HIT_SLOP.bottom,
    tenantGap: SPACE_TOKENS['4'],
    tenantHeight: 0,
  };
  return bottomAnchoredBand(t).bottom - fabTargetBand(t).top;
})();
/** El `hitSlop.top` que el FAB tenía HASTA el bugfix (`$fabRaise`). Solo se usa como CONTRAFÁCTICO. */
const HISTORIC_TOP_SLOP = sizeTokenFromConfig(CONFIG_SRC, 'fabRaise');
/**
 * Alto de la FILA DEL HEADER, derivado de los tokens reales igual que en el componente: su
 * `paddingVertical` (`$3`) ×2 + el elemento más alto que vive en ella (`$avatar`). Es la coordenada donde
 * tiene que arrancar el indicador desde el 2026-08-06 (en web el inset superior es 0). Derivado, no
 * copiado: si el avatar cambia de tamaño, este test sigue midiendo lo correcto.
 */
const HEADER_ROW_HEIGHT = SPACE_TOKENS['3'] * 2 + sizeTokenFromConfig(CONFIG_SRC, 'avatar');

/** a11y de la fila "Bastón" del tab "Más" (el estado va dentro del nombre accesible). */
const STICK_ROW_NAME = /^Bastón: .+ Abrí la pantalla de conexión del bastón$/;

test.afterAll(async () => {
  await cleanupAll();
});

/** Las DOS marcas del bastón (E2E + DEMO) ANTES del bundle → simulador → el pill puede estar vivo. */
async function markBleDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__RAFAQ_BLE_E2E__ = true;
    w.__RAFAQ_BLE_DEMO__ = true;
  });
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  w: number;
  h: number;
}
interface Victim {
  /** Descripción del control al que el slop le robaría el toque. */
  label: string;
  /** Cuántos de los puntos muestreados del slop caen sobre él. */
  points: number;
}

/**
 * Mide, DENTRO del navegador: la caja del pill, la del FAB, y —lo importante— **a quién le robaría los
 * toques** el `hitSlop` declarado.
 *
 * ⚠️ POR QUÉ NO ALCANZA CON INTERSECTAR RECTÁNGULOS (se probó y da FALSO POSITIVO). El primer intento
 * comparaba el rect expandido del FAB contra el `getBoundingClientRect()` de todo control de la página.
 * En el tab "Más" reporta la card "Completá el RENSPA…" (x=[18,394] y=[848,934]): su rect cruza al FAB,
 * pero está **DETRÁS de la barra de navegación** en orden de pintura — ningún toque le llegaba ni antes
 * ni después. Un rect no sabe nada de z-order.
 *
 * El oráculo correcto es el HIT-TEST REAL: se muestrea la región del slop (lo que el `hitSlop` agrega
 * FUERA de la pintura del FAB) y en cada punto se pregunta `document.elementFromPoint()` — o sea, quién
 * recibiría hoy ese toque. Si el topmost es un control que no es el FAB, ese control **pierde** el punto
 * cuando el slop entra en juego (en nativo el slop gana). Es exactamente la semántica del bug.
 */
async function stolenBy(page: Page, slop: typeof FAB_HIT_SLOP) {
  return page.evaluate((s) => {
    const box = (e: Element | null) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height };
    };
    const fab = document.querySelector('[aria-label="Abrir MODO MANIOBRAS"]');
    const pill = document.querySelector('[data-testid="stick-status-pill"]');
    if (!fab) return { fab: null, pill: box(pill), victims: [], sampled: 0 };

    const f = fab.getBoundingClientRect();
    const INTERACTIVE = [
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="menuitem"]',
    ].join(',');

    const STEP = 2; // dp entre muestras: el slop más chico que nos importa (el `top` viejo) medía 26
    const victims = new Map<string, number>();
    let sampled = 0;

    const scan = (x0: number, x1: number, y0: number, y1: number) => {
      for (let y = Math.max(0, y0); y < Math.min(window.innerHeight, y1); y += STEP) {
        for (let x = Math.max(0, x0); x < Math.min(window.innerWidth, x1); x += STEP) {
          // Punto DENTRO de la pintura del FAB → no es territorio ganado por el slop.
          if (x >= f.left && x <= f.right && y >= f.top && y <= f.bottom) continue;
          sampled++;
          const top = document.elementFromPoint(x, y);
          if (!top) continue;
          if (top === fab || fab.contains(top) || top.contains(fab)) continue;
          const control = top.closest(INTERACTIVE);
          if (!control || control === fab || fab.contains(control) || control.contains(fab)) continue;
          const name =
            control.getAttribute('aria-label') ?? (control.textContent ?? '').trim().slice(0, 40) ?? '';
          const testId = control.getAttribute('data-testid') ?? '';
          const key =
            `<${control.tagName.toLowerCase()}` +
            `${control.getAttribute('role') ? ` role=${control.getAttribute('role')}` : ''}` +
            `${testId ? ` testid=${testId}` : ''}> "${name}"`;
          victims.set(key, (victims.get(key) ?? 0) + 1);
        }
      }
    };

    // Las cuatro franjas que el slop AGREGA alrededor de la pintura (la del medio se saltea arriba).
    scan(f.left - s.left, f.right + s.right, f.top - s.top, f.bottom + s.bottom);

    return {
      fab: box(fab),
      pill: box(pill),
      victims: [...victims.entries()].map(([label, points]) => ({ label, points })),
      sampled,
    };
  }, slop);
}

function describeVictims(victims: Victim[]): string {
  return victims.map((v) => `  · ${v.label}  (${v.points} puntos del slop)`).join('\n');
}

/**
 * Deja la app en el tab "Más" con la conexión del bastón VIVA → el pill del chrome montado. La ruta es la
 * del operario: fila de "Más" → `/baston` → lectura simulada → chevron de vuelta. Un `page.goto` remontaría
 * el provider raíz y apagaría la conexión.
 */
async function landOnMasWithLivePill(page: Page): Promise<void> {
  const stickRow = page.getByRole('button', { name: STICK_ROW_NAME });
  await gotoTab(page, 'Más', stickRow);
  await expect(stickRow).toBeVisible({ timeout: 30_000 });
  await stickRow.click();
  await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 40_000 });

  await expect(page.getByTestId('demo-simulate')).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    await page.getByTestId('demo-simulate').click();
    await expect(page.getByLabel(/^Caravana \d{15} DEMO$/).first()).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(stickRow).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 15_000 });
}

test('GUARD: el target del FAB (expandido por su hitSlop) no pisa ningún otro control @ 412×915', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  try {
    const user = await createTestUser('fabgeo');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Geometria');
    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await landOnMasWithLivePill(page);

    const g = await stolenBy(page, FAB_HIT_SLOP);
    const fab = g.fab as Rect | null;
    const pill = g.pill as Rect | null;
    if (!fab || !pill) throw new Error(`no se pudieron medir las cajas: ${JSON.stringify(g)}`);

    // Diagnóstico: cuando esto se ponga rojo, los números de acá son lo primero que se mira. El slop que
    // se imprime es el RESUELTO del componente, no una constante de este archivo.
    console.log(
      `[fab-geometry] hitSlop REAL de _layout.tsx = ${JSON.stringify(FAB_HIT_SLOP)} · modelo=${MODEL_SEPARATION} dp`,
    );
    console.log(
      `[fab-geometry] pill y=[${pill.top.toFixed(0)},${pill.bottom.toFixed(0)}] alto=${pill.h.toFixed(0)} · ` +
        `FAB y=[${fab.top.toFixed(0)},${fab.bottom.toFixed(0)}] · aire=${(fab.top - pill.bottom).toFixed(0)} dp · ` +
        `puntos de slop muestreados=${g.sampled}`,
    );

    // (0) El slop resuelto no crece hacia ARRIBA. Es el invariante en su forma más directa, y acá vale la
    // pena repetirlo aunque lo cubra el guard estático: si el `top` volviera, las aserciones de abajo
    // podrían pasar igual en una pantalla donde no haya nada debajo del pill, y este test es el que corre
    // sobre la app montada de verdad.
    expect(
      FAB_HIT_SLOP.top,
      `el hitSlop del FAB volvió a crecer hacia arriba (top=${FAB_HIT_SLOP.top} dp): es el bug 🔴 del ` +
        '2026-08-05, que se comía el 48 % inferior del pill del bastón',
    ).toBe(0);

    // (1) EL INVARIANTE: el slop declarado no le roba el toque a NADIE.
    expect(
      g.victims as Victim[],
      `el hitSlop del FAB ${JSON.stringify(FAB_HIT_SLOP)} le roba puntos a ${g.victims.length} control(es):\n` +
        `${describeVictims(g.victims as Victim[])}\n` +
        'Un hitSlop que invade a un vecino le roba los toques — es el bug 🔴 del 2026-08-05.',
    ).toEqual([]);

    // (1-bis) AUTO-FALSIFICACIÓN DEL ORÁCULO, sobre ESTE build. Un "no encontré víctimas" y un oráculo
    // roto se ven igual: verde. Acá se le pide al mismo medidor que reproduzca el bug histórico
    // (`top: $fabRaise`) y se exige que SÍ encuentre a quién le roba. Sin esto, (1) podría estar pasando
    // por no mirar.
    //
    // ⚠️ La víctima NO es el pill, y el motivo importa: el pill es `pointerEvents="none"`, así que el
    // hit-test lo atraviesa y devuelve el control que está DEBAJO (en el tab "Más", la fila "Eliminar
    // campo"). Eso ES el mecanismo del bug 🔴, medido: con el `top` puesto, un toque sobre el pill —o en
    // los 26 dp que hay encima del círculo— no llegaba al control de abajo, se lo quedaba el FAB y se
    // abría MODO MANIOBRAS. Que el pill no sea tocable nunca evitó nada.
    const counterfactual = await stolenBy(page, { ...FAB_HIT_SLOP, top: HISTORIC_TOP_SLOP });
    expect(counterfactual.sampled, 'el muestreo del slop no evaluó ni un punto').toBeGreaterThan(50);
    const stolenBack = (counterfactual.victims as Victim[]).map((v) => v.label);
    console.log(`[fab-geometry] contrafáctico (top=${HISTORIC_TOP_SLOP}): le robaría a ${stolenBack.join(' | ')}`);
    expect(
      stolenBack.length,
      'con el `hitSlop.top` histórico el oráculo TIENE que encontrar víctimas; si no encuentra ninguna, ' +
        'no está midiendo nada y la aserción (1) pasa por ceguera, no por corrección',
    ).toBeGreaterThan(0);

    // ── (2) LA BANDA DEL FAB QUEDÓ VACÍA, Y ESO SE VERIFICA (no se supone) ─────────────────────────
    // Hasta el 2026-08-06 acá se medía la separación pill↔FAB (as-built 20 dp). El indicador se mudó
    // ARRIBA A LA DERECHA, así que esa resta ahora da ~700 dp y pasaría **trivialmente**: exactamente el
    // falso verde que este archivo existe para no tener. La aserción se reemplaza por las dos que sí
    // dicen algo hoy:
    //   (2a) el indicador REALMENTE se fue de la banda del FAB (si alguien lo vuelve a anclar abajo, rojo);
    //   (2b) y aterrizó donde el modelo dice — `insets.top + $3*2 + $avatar` (en web el inset es 0, así
    //        que el número es el alto de la fila del header), o sea DESPEJANDO la fila donde viven el
    //        avatar de la home, la ✕ de MODO MANIOBRAS y el "+ Crear campo".
    const fabBandTop = fab.top - MIN_TAP_TARGET_SEPARATION;
    expect(
      pill.bottom,
      `el indicador vuelve a estar en la banda del FAB (su borde de abajo en y=${pill.bottom.toFixed(0)}, y la ` +
        `banda arranca en y=${fabBandTop.toFixed(0)}). Ahí abajo la pantalla pone sus CTA a ancho completo: ` +
        'es de donde lo sacamos.',
    ).toBeLessThan(fabBandTop);
    expect(
      Math.round(pill.top),
      'el indicador no está pegado debajo de la fila del header: el DOM mide ' +
        `${pill.top.toFixed(1)} y el modelo (tokens $3*2 + $avatar, con inset superior 0 en web) predice ` +
        `${HEADER_ROW_HEIGHT}. Si el DOM mide MENOS, se le está montando a la fila.`,
    ).toBe(HEADER_ROW_HEIGHT);
    // Y el modelo de la banda de abajo sigue vivo aunque no tenga inquilinos: si mañana alguien ancla algo
    // ahí, `MODEL_SEPARATION` es el número que ese inquilino tendría que respetar.
    expect(MODEL_SEPARATION, 'el modelo de la banda inferior dejó de calcular').toBeGreaterThanOrEqual(
      MIN_TAP_TARGET_SEPARATION,
    );
  } finally {
    await ctx.close();
  }
});

// ─── El pill NO intercepta toques — la aserción, no un console.log ───────────────────────────────────
//
// Se intentó hacerlo tocable el 2026-08-06 y se revirtió el mismo día: se superponía a CTAs de manga y
// les robaba el toque (A07: el pill queda ENTERO adentro de 'Arrancar jornada'; web: "Ir a Animales",
// "Eliminar campo", y tres maniobras tocables de `/maniobra/jornada` etapa 2).
//
// La versión anterior de este archivo MEDÍA eso y lo imprimía con un `console.log`. Un número que se
// imprime y no falla nunca es decoración — y en este caso además tapó el hallazgo: reportaba UNA víctima
// en UNA pantalla y se leyó como "es aceptable". Acá es una aserción.
//
// El oráculo es estructural y por eso vale para TODAS las pantallas, no solo para las que se visitan
// acá: con `pointerEvents="none"` el pill nunca puede ser el elemento topmost, así que `elementFromPoint`
// en su centro tiene que devolver **otra cosa**. Se verifica en dos pantallas (las dos donde el barrido
// del reviewer encontró víctimas) y el guard estático `(E)` impide que la prop se vaya.
test('el pill NO intercepta el toque: es transparente al hit-test y no navega @ 412×915', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  /** ¿Quién recibe el toque en el centro del pill? Tiene que ser CUALQUIER COSA menos el pill. */
  const topmostAtPillCenter = async () =>
    page.evaluate(() => {
      const pillEl = document.querySelector('[data-testid="stick-status-pill"]');
      if (!pillEl) return { found: false, isPill: false, pointerEvents: '', role: '', topmost: '' };
      const r = pillEl.getBoundingClientRect();
      const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return {
        found: true,
        isPill: top === pillEl || pillEl.contains(top),
        pointerEvents: window.getComputedStyle(pillEl).pointerEvents,
        role: pillEl.getAttribute('role') ?? '',
        topmost: `${top?.tagName.toLowerCase() ?? '—'}${top?.getAttribute('role') ? ` role=${top.getAttribute('role')}` : ''}`,
      };
    });

  try {
    const user = await createTestUser('fabnotap');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Pill Pasivo');
    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await landOnMasWithLivePill(page);

    for (const [screen, go] of [
      ['Más', async () => {}],
      ['Inicio', async () => gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/))],
    ] as const) {
      await go();
      await expect(page.getByTestId('stick-status-pill')).toBeVisible({ timeout: 20_000 });
      const probe = await topmostAtPillCenter();
      expect(probe.found, `el pill no está montado en ${screen}`).toBe(true);
      expect(probe.pointerEvents, `el pill tiene que ser transparente al hit-test en ${screen}`).toBe('none');
      expect(probe.role, `el pill NO es un botón (${screen})`).toBe('');
      expect(
        probe.isPill,
        `en ${screen} el pill es el elemento TOPMOST en su centro: se está quedando con un toque que le ` +
          `pertenece a la pantalla de abajo (topmost=${probe.topmost}). Ver el bloque ⛔ de ` +
          'StickStatusIndicator.tsx: esto se midió, se intentó y se revirtió.',
      ).toBe(false);
    }

    // Y el comportamiento: un tap táctil real en el centro del pill NO puede llevar a `/baston` (eso
    // sería el `onPress` de vuelta) ni a MODO MANIOBRAS (eso sería el `hitSlop.top` de vuelta).
    const box = await page.getByTestId('stick-status-pill').boundingBox();
    if (!box) throw new Error('el pill no tiene caja');
    const urlBefore = page.url();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(900);
    expect(page.url(), `un tap en el pill navegó (antes: ${urlBefore})`).not.toMatch(/\/baston$/);
    expect(page.url()).not.toMatch(/maniobra/);
  } finally {
    await ctx.close();
  }
});
