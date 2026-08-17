// e2e/captures/baston-spp-bloqueantes.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5,
// ADR-029) de la unidad «bloqueantes del camino SPP del bastón» (review adversarial de `dad711f` + banco
// contra el ESP32 del 2026-07-30).
//
// ── QUÉ HAY PARA VETAR, Y QUÉ NO ────────────────────────────────────────────────────────────────────
// La unidad tiene TRES pasadas. De sus arreglos, casi todos son de transporte y no tienen superficie
// visual propia (timeouts del puente, filtro del evento de desconexión por dirección, sonda de liveness,
// gate de foreground al disparar, cola del connect a otro bastón, guard de re-entrada de la lista,
// terminador desde el driver, tabla de modo de ingesta, R6.4 y el tope de la cadena sin gesto). Su efecto
// se ve en el ESTADO de la card de conexión, que ya está capturado en `baston-multivendor.capture.ts`.
//
// Cambios VISIBLES, y qué hace este archivo con cada uno:
//
//   1. **BENCH-3** (2ª pasada): la lectura entra UNA sola vez en `/baston`, sin el sheet global encima.
//      → **CAPTURADO acá** (shots 01-04).
//   2. **El estado "No encontramos el bastón"** (3ª pasada): copy + CTA nuevos de la card de conexión,
//      para cuando el auto-connect del arranque agota su tope sin encontrar el bastón recordado.
//      → **N/A del E2E web, por construcción.** Ese estado sale de `transport.autoConnectExhausted`, que
//      **solo existe en `SppAndroidAdapter`** (los otros cuatro adapters no implementan `autoConnect`, y
//      no por olvido: ver `StickAdapter.autoConnect`). El E2E/las capturas corren en **web**, donde el
//      transporte es `simulator` (demo) o `mock`: la propiedad es `undefined` y el flag siempre `false`.
//      Para renderizarlo habría que mockear `Platform.OS` o inyectar un adapter falso en el provider —
//      o sea, cambiar producción para poder sacarle una foto. Se usa el precedente que esta misma spec
//      ya fijó en `T-MV.7.2`, que declaró N/A `available:false` (RMV3.7) y `unrecognized` (RMV3.8) por
//      el mismo motivo y los dejó cubiertos por `connection-view.test.ts`. Acá igual: la decisión de
//      presentación es PURA y tiene **4 tests** propios (copy distinto del virgen, CTA presente, tono
//      `idle`, y que el flag no contamine ningún otro estado). Lo que el veredicto visual habría
//      agregado —que el hint largo no recorte— está cubierto por construcción: se renderiza con
//      `lineHeight` matcheado y **sin** `numberOfLines` (`StickConnectionScreen.tsx`, la card de
//      estado), que es la regla que el propio proyecto se dio para los descendentes.
//      El día que el bastón se pruebe en device con un bastón vendido, esa pantalla es un screenshot de
//      `adb` — y ahí sí es evidencia real, no una simulación en web.
//   3. **El CTA "Olvidar el bastón guardado"** (fix-loop, R6.6): botón nuevo en la sección Dispositivos.
//      → **N/A del E2E web, por el mismo motivo estructural.** Ese bloque se renderiza solo cuando
//      `transport.kind === 'spp-android'` (`isSpp`); en web el transporte es `web-serial`/`mock`/
//      `simulator`, así que la sección de emparejados —y su CTA— no existen. Nota de diseño que sí se
//      puede vetar leyendo: el botón está condicionado a que HAYA algo guardado
//      (`hasRemembered`), para no dejar una afordancia muerta en la primera instalación — el mismo
//      defecto que cerró el bugfix del chip. Reusa el `Button variant="secondary" fullWidth` ya vetado,
//      así que no introduce geometría nueva.
//
// Lo que estas capturas prueban (BENCH-3):
//
//   ANTES — cada bastonazo en /baston se consumía DOS VECES: entraba en la lista de Lecturas de la
//   pantalla **y** abría el sheet global «Caravana leída / ¿Es uno de tus animales sin caravana?»
//   TAPÁNDOLA. Medido en el A07 real. Y pega justo donde más incomoda: `context-multivendor.md` §3
//   define esta pantalla como la cara de la demo a los fabricantes de bastones — tocás conectar,
//   bastoneás, y un modal te tapa lo que estabas mostrando.
//
//   AHORA — la pantalla toma la PROPIEDAD EXCLUSIVA del bastón mientras está enfocada (scanner acotado,
//   RCF.6) y el overlay global se auto-suprime: un solo consumidor efectivo.
//
// Las capturas van a __shots__/baston-spp-bloqueantes/:
//   01 — /baston recién abierta (estado 'off'): la referencia del "antes de bastonear".
//   02 — DESPUÉS de la lectura: la pantalla ENTERA, **sin ningún sheet encima** (es la captura que
//        falsifica el bug: si el overlay volviera, se vería acá).
//   03 — banda de la card "Lecturas" con el read-row del EID + el badge DEMO (la confirmación que SÍ
//        corresponde a esta pantalla).
//   04 — banda de la card de estado: "Bastón conectado" + CTA "Desconectar", legible y sin nada encima.
//
// Viewport mobile 412×915 (lo hereda de playwright.config). NO corre en `pnpm e2e` (es un `.capture.ts`):
//   pnpm exec playwright test e2e/captures/baston-spp-bloqueantes.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, applyEnvShim, expect } from '../helpers/fixtures';
import type { Page, Locator } from '@playwright/test';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'baston-spp-bloqueantes');

/** Fila de una lectura confirmada en la lista en vivo de /baston (aria-label del read-row). */
const DEMO_READ_ROW = /^Caravana \d{15} DEMO$/;

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Banda vertical entre dos elementos (aísla un componente en vez de repetir la pantalla entera). */
async function shotBand(page: Page, name: string, topLoc: Locator, bottomLoc: Locator, pad = 16): Promise<void> {
  await page.waitForTimeout(200);
  const top = await topLoc.boundingBox();
  const bottom = await bottomLoc.boundingBox();
  if (!top || !bottom) {
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
    return;
  }
  const y = Math.max(0, top.y - pad);
  const height = Math.min(915 - y, bottom.y + bottom.height + pad - y);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), clip: { x: 0, y, width: 412, height } });
}

/** Las DOS marcas del bastón (E2E + DEMO) ANTES del bundle → isDemoMode() true → simulador. */
async function markBleDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__MITROPERO_BLE_E2E__ = true;
    w.__MITROPERO_BLE_DEMO__ = true;
  });
}

test('capturas: un bastonazo en /baston entra UNA sola vez (sin sheet global encima) @ 412px', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  await markBleDemo(page);

  try {
    const user = await createTestUser('cap-spp-block');
    await setUserPhone(user.id, '1123456789');
    await seedEstablishmentWithRodeo(user.id, 'Campo Baston Bloq');

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // Deep-link a la pantalla de conexión. Desde el 2026-08-05 "Más" TIENE una fila a `/baston`, así que
    // el deep-link ya no es el único camino — se conserva acá A PROPÓSITO: esta captura documenta el
    // arreglo de la doble ingesta (BENCH-3), no el punto de entrada, y el `goto` la deja independiente de
    // la nav. La ruta por la fila la cubre `baston-multivendor.capture.ts`.
    await page.goto('/baston');
    await expect(page.getByTestId('stick-devices-section')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('stick-device-row')).toBeVisible({ timeout: 20_000 });

    // (01) Referencia: la pantalla antes de bastonear.
    await expect(page.getByText('Bastón sin conectar', { exact: true })).toBeVisible();
    await shot(page, '01-antes-de-bastonear');

    // Bastonazo simulado. Se reintenta porque tras el deep-link los contextos están en warm-up; cada
    // emisión es un EID sintético fresco (seq++), así que reintentar no choca con la dedup.
    await expect(page.getByTestId('demo-simulate')).toBeVisible();
    await expect(async () => {
      await page.getByTestId('demo-simulate').click();
      await expect(page.getByLabel(DEMO_READ_ROW).first()).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 60_000 });

    // (02) LA CAPTURA QUE IMPORTA: la pantalla entera después de la lectura. Sin sheet encima.
    // La aserción va ANTES del shot para que, si el bug volviera, el test falle en vez de dejar una
    // captura mentirosa.
    await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);
    await page.waitForTimeout(1_500); // y sigue sin abrirse (no es una carrera ganada por poco)
    await expect(page.getByTestId('find-or-create-overlay')).toHaveCount(0);
    await shot(page, '02-lectura-sin-sheet-encima');

    // (03) La confirmación que SÍ corresponde a esta pantalla: el read-row con el EID + badge DEMO.
    const demoRow = page.getByLabel(DEMO_READ_ROW).first();
    await demoRow.scrollIntoViewIfNeeded();
    await shotBand(page, '03-lectura-en-la-lista', page.getByText(/^Lecturas/).first(), demoRow);

    // (04) La card de estado, legible y despejada: "Bastón conectado" + CTA "Desconectar".
    const connected = page.getByText('Bastón conectado', { exact: true }).first();
    await connected.scrollIntoViewIfNeeded();
    await expect(connected).toBeVisible({ timeout: 10_000 });
    await shotBand(page, '04-card-estado-conectado', connected, page.getByTestId('stick-status-cta'));
  } finally {
    await ctx.close();
  }
});
