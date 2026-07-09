// e2e/maniobra-custom-bugfix.spec.ts — REPRO + FIX de los 2 defectos visuales de la maniobra CUSTOM (M5-CLIENTE).
//
// Cazados EN VIVO por Raf en la maniobra personalizada (M5, ya en prod):
//   BUG 1 — el TÍTULO del paso de maniobra custom (label largo) se RECORTA (gotcha de truncado/lineHeight).
//   BUG 2 — en las listas enum_single/enum_multi NO se nota que se puede SCROLLEAR (el operario cree que las
//           opciones visibles son TODAS).
//
// Sembramos una maniobra custom patológica: (a) label LARGO con descendentes ("Ángulo de inclinación de pezuña
// posterior") + (b) un enum de 12 opciones que excede el viewport. Cargamos en una jornada y capturamos a 360 y
// 412 web TÁCTIL (hasTouch + isMobile) → tests/modo-maniobra/custom-bug-*.
//
// El cleanup borra el establishment (cascada) en afterAll.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedCustomField,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'tests', 'modo-maniobra');

// Web TÁCTIL fiel (memoria reference_rn_web_pitfalls): hasTouch + isMobile → el browser emula touch→click y los
// gestos verticales son scroll real (no drag de mouse). Imprescindible para que el affordance de scroll (y el
// peek/fade) se vean como en el device de Raf. El viewport por shot lo fija `shot()`.
test.use({ hasTouch: true, isMobile: true });

// Label LARGO con descendentes (g/p/q/ñ-cola) — el caso que Raf reportó recortado.
const LONG_LABEL = 'Ángulo de inclinación de pezuña posterior';
// Enum SINGLE de 12 opciones (excede el viewport → reproduce el bug de "no se nota que scrollea").
const MANY_SINGLE = [
  'Muy hacia adentro',
  'Hacia adentro',
  'Levemente adentro',
  'Neutro centrado',
  'Levemente afuera',
  'Hacia afuera',
  'Muy hacia afuera',
  'Aplomo perfecto',
  'Patología leve',
  'Patología moderada',
  'Patología severa',
  'No evaluable',
];

test.afterAll(async () => {
  await cleanupAll();
});

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
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void; tagRead: (x: string) => void } }).__rafaqBle;
    if (!h) throw new Error('window.__rafaqBle no disponible');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

/**
 * Scrollea hasta el FONDO el contenedor scrolleable que contiene el ítem `firstOption`. Sube por el DOM
 * buscando el ancestro con overflow-y scrolleable (el ScrollView de RN-web) y le setea scrollTop al máximo +
 * dispara el evento `scroll` → el ScrollView corre su `onScroll` → recomputa los fades. (scrollIntoViewIfNeeded
 * no mueve el contenedor de RN-web de forma fiable.)
 */
async function scrollListToBottom(page: Page, firstOption: string): Promise<void> {
  await page.evaluate((label) => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="custom-enum-block-"]'));
    const start = items.find((el) => el.textContent?.includes(label)) ?? items[0];
    let node: HTMLElement | null = start;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const scrollable = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2;
      if (scrollable) {
        node.scrollTop = node.scrollHeight;
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
        return;
      }
      node = node.parentElement;
    }
  }, firstOption);
  await page.waitForTimeout(150); // dejar correr el onScroll + el re-render del fade.
}

/** Captura a 412 y 360 (web táctil; el viewport ya viene mobile+touch de la fixture). */
async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-412.png`) });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-360.png`) });
  await page.setViewportSize({ width: 412, height: 915 });
}

/** Arranca una jornada eligiendo el rodeo + tildando la maniobra custom (por su label) → identificar. */
async function startSessionWithCustomManeuver(page: Page, customLabel: string): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByText('Elegí las maniobras', { exact: true })).toBeVisible({ timeout: 20_000 });
  const customRow = page.getByText(customLabel, { exact: true });
  await expect(customRow).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500); // dwell: el rodeo_data_config custom se asienta antes de la carga rápida
  await customRow.click();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── BUG 1 + BUG 2 (enum_single): título largo + lista de 12 opciones → render del paso de maniobra custom ──
test('custom enum_single: título largo SIN recorte + lista con affordance de scroll (360/412)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m5bug-enum');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom Bug', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  await seedCustomField(establishmentId, rodeoId, {
    label: LONG_LABEL,
    dataKey: 'angulo_pezuna_post',
    dataType: 'maniobra',
    uiComponent: 'enum_single',
    options: MANY_SINGLE,
  });
  const eid = makeEid();
  const visual = '0611';
  await seedAnimal(establishmentId, rodeoId, { tag: eid, idv: visual, sex: 'female', categoryCode: 'vaquillona' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionWithCustomManeuver(page, LONG_LABEL);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // BUG 1 — el título (label largo) entra COMPLETO (no recortado a "Ángulo de inclinación…"). El texto completo
  // debe ser leíble en pantalla (sin ellipsis del recorte de 1 línea).
  await expect(page.getByText(LONG_LABEL, { exact: true }).first()).toBeVisible();

  // BUG 2 — los bloques del enum existen (la lista es scrolleable: la 1ra opción y una intermedia visibles).
  await expect(page.getByTestId(`custom-enum-block-${MANY_SINGLE[0]}`)).toBeVisible();
  // El affordance de scroll (fade abajo) está presente cuando hay más opciones que el viewport.
  await expect(page.getByTestId('custom-enum-scroll-fade-bottom')).toBeVisible();

  await shot(page, 'custom-bug-enum');

  // En reposo (arriba de todo) NO hay fade ARRIBA (no se scrolleó aún) — solo abajo.
  await expect(page.getByTestId('custom-enum-scroll-fade-top')).toHaveCount(0);

  // El operario SÍ puede llegar a la última opción scrolleando (afordancia funciona). Scrolleamos el contenedor
  // hasta el fondo (scrollTop = scrollHeight) → dispara el onScroll del ScrollView → recomputa los fades.
  await scrollListToBottom(page, MANY_SINGLE[0]);
  const last = page.getByTestId(`custom-enum-block-${MANY_SINGLE[MANY_SINGLE.length - 1]}`);
  await expect(last).toBeVisible();
  // Scrolleado al fondo: aparece el fade ARRIBA (hay contenido oculto arriba) y desaparece el de ABAJO.
  await expect(page.getByTestId('custom-enum-scroll-fade-top')).toBeVisible();
  await expect(page.getByTestId('custom-enum-scroll-fade-bottom')).toHaveCount(0);
  // Captura del estado scrolleado (412 fijo — NO usamos shot() porque cambiar el viewport re-layoutea y
  // resetea el scroll, ensuciando la evidencia). El fade ARRIBA confirma "venís de más arriba".
  await page.screenshot({ path: path.join(OUT_DIR, 'custom-bug-enum-scrolled-412.png') });
});

// ── BUG 1 + BUG 2 (enum_multi): mismo título largo + 12 opciones en el multi-select ──
test('custom enum_multi: título largo SIN recorte + multi-select con affordance de scroll (360/412)', async ({ page }) => {
  test.setTimeout(180_000);
  const user = await createTestUser('m5bug-multi');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom Bug Multi', {
    rodeoName: 'Cría machos',
    rodeoRawName: true,
  });
  await seedCustomField(establishmentId, rodeoId, {
    label: LONG_LABEL,
    dataKey: 'hallazgos_pezuna',
    dataType: 'maniobra',
    uiComponent: 'enum_multi',
    options: MANY_SINGLE,
  });
  const eid = makeEid();
  const visual = '0822';
  await seedAnimal(establishmentId, rodeoId, { tag: eid, idv: visual, sex: 'male', categoryCode: 'torito' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionWithCustomManeuver(page, LONG_LABEL);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  // BUG 1 — título completo.
  await expect(page.getByText(LONG_LABEL, { exact: true }).first()).toBeVisible();
  // BUG 2 — multi-select scrolleable con fade abajo.
  await expect(page.getByTestId(`custom-multi-${MANY_SINGLE[0]}`)).toBeVisible();
  await expect(page.getByTestId('custom-multi-scroll-fade-bottom')).toBeVisible();

  await shot(page, 'custom-bug-multi');

  const last = page.getByTestId(`custom-multi-${MANY_SINGLE[MANY_SINGLE.length - 1]}`);
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();
});
