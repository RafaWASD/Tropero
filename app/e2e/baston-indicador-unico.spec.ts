// e2e/baston-indicador-unico.spec.ts — EL ESTADO DEL BASTÓN SE DICE UNA SOLA VEZ POR PANTALLA.
//
// ── QUÉ VERIFICA, Y POR QUÉ NO ALCANZAN LOS GUARDS ESTÁTICOS ────────────────────────────────────────
// El indicador global del chrome (`StickStatusIndicator`, RMV3.5) ahora se calla cuando la pantalla
// ENFOCADA ya muestra el estado del bastón: la superficie lo declara con `useStickStatusSurface()` (ver
// `src/services/ble/stick-status-surface.ts`). El guard estático
// (`stick-status-surface-guard.test.ts`) verifica QUIÉN declara qué; lo que NO puede ver es el
// comportamiento en un árbol de navegación real, que es donde vive el modo de falla peligroso:
//
//   ⚠️ **EL RECLAMO ATADO AL MONTAJE APAGA EL INDICADOR PARA SIEMPRE.** Las tabs visitadas quedan
//   MONTADAS el resto de la sesión y las pantallas del stack quedan montadas al navegar encima. Con un
//   `useEffect` en vez de un `useFocusEffect`, entrar UNA vez a "Animales" dejaría el reclamo vivo y el
//   indicador global no volvería a aparecer en NINGUNA pantalla — sin un solo síntoma, sin error, y con
//   todos los tests de una sola pantalla en verde. Por eso el caso (c) de acá vuelve a una pantalla sin
//   superficie propia y exige que el indicador HAYA VUELTO.
//
// El recorrido es el del operario y NO usa `page.goto` después de conectar: una navegación "cruda"
// remonta el provider raíz y apaga la conexión (el indicador se auto-oculta en 'off' y el test mediría
// otra cosa). Se llega a la conexión viva por Más → fila "Bastón" → /baston → lectura simulada → chevron.
//
// El segundo test de este archivo mide **la banda nueva**: desde el 2026-08-06 el indicador vive arriba a
// la derecha, DEBAJO de la fila del header, como un círculo que se estira a pill al cambiar el estado. Lo
// que hay que poder afirmar —y que ningún guard estático puede— es que ahí no le cae encima a nada
// legible: se listan los elementos que INTERSECAN su caja en cada pantalla visitada y se exige que no haya
// texto ni controles. Con auto-falsificación in-place: se inyecta un elemento en esa caja y se exige que
// el medidor lo encuentre (si no, la aserción anterior pasaba por ceguera).
//
// Modo DEMO (triple-guard RMV4.3/4.4/4.5): las dos marcas globales ANTES del bundle → simulador.
// Datos namespaced (RUN_TAG) + cleanup en afterAll. No escribe nada en la DB compartida.

import { test, applyEnvShim, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** a11y de la fila "Bastón" del tab "Más" (el estado va dentro del nombre accesible). */
const STICK_ROW_NAME = /^Bastón: .+ Abrí la pantalla de conexión del bastón$/;

/** Las DOS marcas (E2E + DEMO) ANTES del bundle → simulador → el indicador puede estar vivo. */
async function markBleDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__RAFAQ_BLE_E2E__ = true;
    w.__RAFAQ_BLE_DEMO__ = true;
  });
}

test('el estado del bastón se dice UNA vez: el chrome se calla donde hay chip propio, y VUELVE al salir', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  try {
    const user = await createTestUser('indunico');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Indicador Unico');
    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // ── Dejar la conexión VIVA por la ruta del operario ────────────────────────────────────────────
    const stickRow = page.getByRole('button', { name: STICK_ROW_NAME });
    await gotoTab(page, 'Más', stickRow);
    await stickRow.click();
    await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 40_000 });

    // En /baston el indicador global está SUPRIMIDO — y desde esta unidad, por el RECLAMO que la propia
    // pantalla emite (`useStickStatusSurface('screen-card')`), no por un `pathname === '/baston'` adentro
    // del indicador. El comportamiento observable es el mismo; lo que cambió es que ya no depende del
    // nombre de la ruta. Se asserta ANTES de conectar y DESPUÉS (abajo, implícito al volver).
    await expect(page.getByTestId('demo-simulate')).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      await page.getByTestId('demo-simulate').click();
      await expect(page.getByLabel(/^Caravana \d{15} DEMO$/).first()).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 60_000 });
    // Conectado, y la card de la pantalla lo dice — con el indicador global callado encima de ella.
    await expect(page.getByText('Bastón conectado', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('stick-status-indicator')).toHaveCount(0);

    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(stickRow).toBeVisible({ timeout: 20_000 });

    // ── (a) Pantalla SIN superficie propia → el indicador global SÍ se muestra ─────────────────────
    // Es el rol de RMV3.5: el chrome informa donde la pantalla no informa. Si esto fallara, la supresión
    // se habría comido el indicador en toda la app (que es exactamente el riesgo del mecanismo).
    await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 15_000 });

    // ── (b) Pantalla CON chip propio → el estado aparece UNA sola vez ──────────────────────────────
    const searchBar = page.getByLabel('Buscar animal por caravana o número', { exact: true });
    await gotoTab(page, 'Animales', searchBar);
    // El chip del header está (es el que informa acá)…
    await expect(page.getByTestId('ble-connection-chip')).toBeVisible({ timeout: 20_000 });
    // …y el indicador global se calló. Las dos aserciones juntas son el invariante: el oráculo no es
    // "no hay indicador" (eso también pasaría si el chip se hubiera roto y no hubiera NADA), sino "hay
    // exactamente una superficie diciendo el estado".
    await expect(page.getByTestId('stick-status-indicator')).toHaveCount(0);
    await expect(page.getByText('Bastón conectado', { exact: true })).toHaveCount(1);

    // ── (c) AL SALIR, EL INDICADOR VUELVE ──────────────────────────────────────────────────────────
    // El caso que ningún test de una sola pantalla puede ver. La tab "Animales" queda MONTADA para
    // siempre: si el reclamo estuviera atado al montaje (`useEffect`) en vez de al foco
    // (`useFocusEffect`), acá el indicador ya no volvería nunca — en ninguna pantalla, en silencio.
    await gotoTab(page, 'Más', stickRow);
    await expect(
      page.getByTestId('stick-status-indicator'),
      'el indicador global no volvió al salir de una pantalla con chip propio: el reclamo quedó pegado ' +
        '(¿se ató al montaje en vez de al foco?) y el chrome quedó mudo para el resto de la sesión',
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await ctx.close();
  }
});


/**
 * Qué hay PINTADO debajo del indicador, en la pantalla que se está viendo.
 *
 * El oráculo NO es "¿se solapan dos rectángulos?" (un rect no sabe de z-order ni de si el elemento tiene
 * algo adentro): se listan los elementos que intersecan la caja del indicador y se filtran a los que
 * **importan** — controles interactivos y nodos con TEXTO visible propio. Un contenedor, un fondo o una
 * card vacía no cuentan: el criterio del veto es "¿tapa algo legible o algo que se toca?".
 */
async function paintedUnderIndicator(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="stick-status-pill"]');
    if (!el) return { found: false, box: null, victims: [] as string[] };
    const r = el.getBoundingClientRect();

    /** ¿La caja `b` cruza la del indicador? Devuelve el centro del solape (o null si no se tocan). */
    const overlapCenter = (b: DOMRect | DOMRectReadOnly): { x: number; y: number } | null => {
      const left = Math.max(b.left, r.left);
      const right = Math.min(b.right, r.right);
      const top = Math.max(b.top, r.top);
      const bottom = Math.min(b.bottom, r.bottom);
      if (right <= left || bottom <= top) return null;
      return { x: (left + right) / 2, y: (top + bottom) / 2 };
    };

    /**
     * ¿Ese punto le pertenece de verdad a este nodo? Es el filtro que hace fiable al oráculo: intersecar
     * cajas NO alcanza porque el DOM tiene pantallas MONTADAS que no se ven — react-navigation deja la tab
     * anterior en el árbol, y su buscador (mismo lugar, misma caja) se reportaba como víctima estando en
     * otra pantalla (medido: `<input> "Buscar animal…"` de la tab Animales apareciendo en Inicio).
     * `checkVisibility` no lo cazaba. El hit-test sí: si el nodo no recibe el punto, no se está viendo ahí.
     * El indicador es `pointerEvents="none"`, así que nunca es él el que contesta.
     */
    const ownsPoint = (node: Element, p: { x: number; y: number }): boolean => {
      const top = document.elementFromPoint(p.x, p.y);
      if (top === null) return false;
      if (top === node || node.contains(top)) return true;
      return top.contains(node) && top !== document.body && top !== document.documentElement;
    };

    const INTERACTIVE =
      'button,a[href],input,textarea,select,[role="button"],[role="link"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitem"]';
    const victims: string[] = [];

    for (const node of Array.from(document.querySelectorAll('body *'))) {
      if (node === el || el.contains(node) || node.contains(el)) continue;

      // (1) CONTROLES: su caja ES su target, así que la caja alcanza (más el hit-test).
      if (node.matches(INTERACTIVE)) {
        const center = overlapCenter(node.getBoundingClientRect());
        if (center && ownsPoint(node, center)) {
          victims.push(
            `<${node.tagName.toLowerCase()}${node.getAttribute('role') ? ` role=${node.getAttribute('role')}` : ''}> ` +
              `"${(node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 40)}"`,
          );
          continue;
        }
      }

      // (2) TEXTO: se miden los RENGLONES REALES (`Range.getClientRects`), no la caja del contenedor. La
      // diferencia no es un detalle: en "Más" el label "Perfil" es un `<div>` a ancho completo con el texto
      // pegado a la izquierda — su CAJA cruza el indicador y sus LETRAS están a 300 px. Reportar la caja
      // sería un falso positivo, y un guard con falsos positivos se termina apagando.
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== Node.TEXT_NODE) continue;
        const text = (child.textContent ?? '').trim();
        if (text === '') continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        const touching = Array.from(range.getClientRects())
          .map((rect) => overlapCenter(rect))
          .find((c) => c !== null);
        range.detach();
        if (touching && ownsPoint(node, touching)) victims.push(`<texto> "${text.slice(0, 40)}"`);
      }
    }
    return {
      found: true,
      box: { top: r.top, left: r.left, width: r.width, height: r.height },
      victims: [...new Set(victims)],
    };
  });
}

test('la banda nueva: el indicador no le cae encima a nada legible, y se estira solo al cambiar', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  try {
    // ── FIXTURE DE PEOR CASO, NO EL BENIGNO ───────────────────────────────────────────────────────
    // La primera versión de este sondeo dio la banda LIBRE en la home… con un usuario llamado "E2E". El
    // saludo crece con el nombre y a los ~14 caracteres se metía debajo del indicador (medido: x=355 vs
    // banda x=354). El criterio quedó: **"¿esto puede crecer?", no "¿choca hoy?"** — así que los textos de
    // ancho variable que comparten pantalla con la banda (nombre del usuario, del campo, del rodeo) se
    // siembran LARGOS. Con esto, "sin víctimas" significa algo.
    const user = await createTestUser('indbanda', 'Maximiliano-José Etchegoyen');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(
      user.id,
      'Establecimiento La Constancia de los Cerrillos',
      { rodeoName: 'Rodeo de cría vaquillonas de reposición' },
    );
    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    const stickRow = page.getByRole('button', { name: STICK_ROW_NAME });
    await gotoTab(page, 'Más', stickRow);
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

    // ── (a) LA FORMA: al rato de estabilizarse, es un CÍRCULO ─────────────────────────────────────
    // El aviso dura unos segundos y vuelve solo. `toPass` espera esa vuelta en vez de dormir un número
    // mágico: lo que se afirma es que el estado de reposo del indicador es el círculo.
    await expect(async () => {
      const g = await paintedUnderIndicator(page);
      expect(g.found).toBe(true);
      expect(
        Math.round(g.box!.width),
        `el indicador quedó estirado (ancho ${g.box!.width}): en reposo tiene que volver al círculo`,
      ).toBe(Math.round(g.box!.height));
    }).toPass({ timeout: 20_000 });

    // ── (a-bis) LA PILL NO SE SALE DE LA PANTALLA AL ESTIRARSE ────────────────────────────────────
    // EL BUG QUE ESTO CIERRA (lo encontró la captura del Gate 2.5, no un test): con el contenedor anclado
    // `right={$4}`, al estirarse la pill crecía hacia la DERECHA y se iba del viewport — "Conectado" salía
    // cortado contra el borde. El contenedor tomaba su ancho del hijo COLAPSADO (40) y el ancho animado no
    // lo re-dimensionaba. Se arregló con contenedor a ancho completo + `alignItems="flex-end"`; acá queda
    // la red, porque un veto visual no corre en cada commit y esto sí.
    await gotoTab(page, 'Animales', page.getByLabel('Buscar animal por caravana o número', { exact: true }));
    await expect(page.getByTestId('stick-status-indicator')).toHaveCount(0);
    await page.waitForTimeout(9_000); // pasa el piso anti-parpadeo: la reaparición vuelve a ser noticia
    await gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/));
    await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 20_000 });
    // Se espera a que el estirado TERMINE, y el oráculo es que NO RECORTE: `scrollWidth <= clientWidth`.
    // "Es más ancho que alto" ya es cierto a los 60 ms de una animación de 220 y dejaba pasar una pill a
    // medio abrir con el texto cortado (así se veía en la primera captura del Gate 2.5).
    await expect(async () => {
      const fits = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="stick-status-pill"]') as HTMLElement | null;
        return el ? el.scrollWidth <= el.clientWidth + 1 && el.clientWidth > el.clientHeight + 20 : false;
      });
      expect(fits, 'la pill no se estiró del todo (o recorta el texto)').toBe(true);
    }).toPass({ timeout: 10_000 });
    const grown = await paintedUnderIndicator(page);
    expect(
      Math.round(grown.box!.left + grown.box!.width),
      `la pill estirada llega a x=${grown.box!.left + grown.box!.width} y el viewport mide 412: se está ` +
        'saliendo de la pantalla (tiene que crecer hacia la IZQUIERDA, no hacia el borde)',
    ).toBeLessThanOrEqual(412 - 18);

    // ── (b) LA BANDA: en tres pantallas, nada legible debajo del CÍRCULO ──────────────────────────
    // Se mide el estado de REPOSO (el círculo), que es el permanente y el que hay que garantizar. La pill
    // expandida vive 4 s y es un aviso deliberado: lo que roce durante ese rato se imprime como
    // diagnóstico (abajo), no se asserta — si se exigiera lo mismo de la pill, el indicador no podría
    // decir nada en ninguna parte.
    for (const [screen, go] of [
      ['Inicio', async () => {}],
      ['Más', async () => gotoTab(page, 'Más', stickRow)],
      // Pantalla de Stack (no tab) y con contenido pegado arriba: el "Paso N de 4" del alta.
      ['alta', async () => {
        await gotoTab(page, 'Animales', page.getByLabel('Buscar animal por caravana o número', { exact: true }));
        await page.getByRole('button', { name: /Dar de alta/ }).first().click();
        await expect(page.getByText(/^Paso \d de 4$/)).toBeVisible({ timeout: 20_000 });
      }],
    ] as const) {
      await go();
      await expect(page.getByTestId('stick-status-indicator')).toBeVisible({ timeout: 20_000 });
      // Esperar el REPOSO: sin esto se mediría a veces la pill y a veces el círculo (y el test sería un
      // generador de flakes en vez de un oráculo).
      let resting = await paintedUnderIndicator(page);
      await expect(async () => {
        resting = await paintedUnderIndicator(page);
        expect(Math.round(resting.box!.width)).toBe(Math.round(resting.box!.height));
      }).toPass({ timeout: 20_000 });

      expect(resting.found, `el indicador no está montado en ${screen}`).toBe(true);
      expect(
        resting.victims,
        `en ${screen} el CÍRCULO (caja ${JSON.stringify(resting.box)}) se pinta ENCIMA de ` +
          `${resting.victims.length} elemento(s) con texto o tocables:\n  ${resting.victims.join('\n  ')}\n` +
          'La banda debajo de la fila del header tiene que quedar libre; si esta pantalla ahora mete algo ' +
          'ahí, que RECLAME el lugar (`useStickStatusSurface(\'screen-band\')`), como hacen la vista de ' +
          'grupo, el header de identidad de la manga y Reportes.',
      ).toEqual([]);
      console.log(`[banda] ${screen}: círculo en ${JSON.stringify(resting.box)} — sin víctimas`);
    }

    // ── (c) AUTO-FALSIFICACIÓN: si el medidor no ve nada, no está midiendo ─────────────────────────
    // Se inyecta un texto EXACTAMENTE en la caja del indicador y se exige que el sondeo lo encuentre. Sin
    // esto, (b) pasaría igual con el medidor roto — que es el modo de falla que este repo ya se comió dos
    // veces ("no encontré víctimas" y "no miré" se ven idénticos: verde).
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="stick-status-pill"]');
      const r = el!.getBoundingClientRect();
      const probe = document.createElement('div');
      probe.textContent = 'SONDA';
      probe.setAttribute('data-probe', '1');
      Object.assign(probe.style, {
        position: 'fixed',
        top: `${r.top + 4}px`,
        left: `${r.left + 4}px`,
        font: '10px sans-serif',
        zIndex: '1',
      });
      document.body.appendChild(probe);
    });
    const withProbe = await paintedUnderIndicator(page);
    expect(
      withProbe.victims.join('|'),
      'el sondeo NO encontró un elemento puesto a propósito dentro de la caja del indicador: está ciego, y ' +
        'entonces la aserción (b) no probó nada',
    ).toContain('SONDA');
    await page.evaluate(() => document.querySelector('[data-probe]')?.remove());
  } finally {
    await ctx.close();
  }
});
