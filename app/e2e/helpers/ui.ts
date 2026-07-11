// e2e/helpers/ui.ts — helpers de interacción con la UI web (react-native-web + Tamagui).
//
// Cómo renderiza la app al DOM (relevante para los selectores):
//   - FormField (src/components/FormField.tsx) monta un <TextInput> de RN → en web es un
//     <input> con `aria-label={label}` (rama Platform.OS==='web'). Por eso ubicamos los
//     inputs por rol+nombre: getByLabel('Email'), getByLabel('Contraseña'), etc.
//   - Button (src/components/Button.tsx) en web pasa `role="button"` al <div> y el texto va
//     adentro → getByRole('button', { name: 'Iniciar sesión' }).
//   - Las confirmaciones destructivas (mas.tsx → confirmDestructive) usan window.confirm en
//     web → se manejan con page.on('dialog') en el test.
//
// El build es SPA (un solo index.html). Navegamos a '/' y dejamos que el AuthGate
// (app/_layout.tsx RootGate) re-rutee según el estado. Por eso los helpers esperan por
// TEXTO/ROL visible, no por URL.

import { expect, type Page } from '@playwright/test';
import type { TestUser } from './admin';

/** Espera a que el bundle monte y la pantalla de login esté visible (post-splash). */
export async function waitForSignIn(page: Page): Promise<void> {
  // exact:true en los labels — "Contraseña" sin exact también matchea el botón "Olvidé mi
  // contraseña" (su aria-label contiene "contraseña") → strict mode violation. El botón de
  // login se ubica por rol (no por texto suelto del título homónimo).
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
}

/**
 * Inicia sesión con un usuario pre-confirmado. NO navega a mano tras el submit: el AuthGate
 * re-rutea solo al cambiar el AuthState. El llamador espera por la pantalla destino
 * (onboarding / home / mis-campos) con su propio assert.
 */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await waitForSignIn(page);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
}

/** True si estamos en el wizard de onboarding (sin campos). */
export async function isOnOnboarding(page: Page): Promise<boolean> {
  return page.getByRole('button', { name: 'Crear mi primer campo' }).isVisible();
}

/**
 * Espera a aterrizar en la HOME (post-login con campo activo). La home tiene el wordmark
 * "RAFAQ" en el header y el saludo "¡Hola …! 👋". Anclamos al saludo (texto único de la home).
 */
export async function waitForHome(page: Page): Promise<void> {
  await expect(page.getByText(/¡Hola.*👋/)).toBeVisible({ timeout: 30_000 });
}

/** Espera el wizard de onboarding (estado no_establishments). */
export async function waitForOnboarding(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Crear mi primer campo' })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Navega a una tab del bottom-nav por su label y espera a aterrizar. El click del label de la tab
 * puede ser interceptado transitoriamente por el contenido del ScrollView durante la animación de
 * cambio de tab (react-native-web), así que reintentamos el click hasta que un ANCLA de la pantalla
 * destino esté visible. `anchor` es un locator de algo único de la pantalla destino.
 */
export async function gotoTab(
  page: Page,
  tabLabel: string,
  anchor: import('@playwright/test').Locator,
): Promise<void> {
  // El target clickeable de cada tab del bottom-nav es el `<a role="tab" href="/…">` (React
  // Navigation web), NO el <div> del label de texto. Clickear el LABEL hacía que un sibling absoluto
  // (el FAB elevado / capa de la barra) interceptara el puntero de forma intermitente; el `role=tab`
  // es el elemento accionable correcto y no se intercepta. Su nombre accesible = el texto del label.
  const tab = page.getByRole('tab', { name: tabLabel, exact: true });
  // Reintentamos el click hasta aterrizar (cubre cualquier transición de animación residual). ~5×.
  for (let i = 0; i < 5; i++) {
    await expect(tab).toBeVisible({ timeout: 15_000 });
    try {
      await tab.click({ timeout: 8_000 });
    } catch {
      await page.waitForTimeout(400);
      continue;
    }
    try {
      await expect(anchor).toBeVisible({ timeout: 5_000 });
      return;
    } catch {
      /* la tab no aterrizó todavía: reintenta el click */
    }
  }
  // Último intento: falla con el assert real si tampoco aterriza.
  await tab.click({ timeout: 10_000 });
  await expect(anchor).toBeVisible({ timeout: 10_000 });
}

/** Espera la pantalla "Mis campos" (landing con ≥2 campos). */
export async function waitForMisCampos(page: Page): Promise<void> {
  // Título "Mis campos" (heading) — hay también el accesibilidad-label del botón "Crear campo".
  await expect(page.getByText('Mis campos', { exact: true })).toBeVisible({ timeout: 30_000 });
}

/**
 * Navega a la tab "Animales" (puerta manual de BUSCAR ANIMAL, spec 09 R1) y espera el buscador
 * permanente (ancla única de la pantalla). Reusa gotoTab (esquiva el FAB que intercepta labels).
 */
export async function gotoAnimales(page: Page): Promise<void> {
  const searchBar = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await gotoTab(page, 'Animales', searchBar);
}

/**
 * Inicio rodeo-céntrico (spec 10 R2.1/R2.2): toca la card del rodeo `rodeoName` en la home y aterriza
 * en su VISTA DE GRUPO (rodeo/[id]). La card es un GroupSummaryCard → role="button" cuyo nombre
 * accesible es "{name}, {meta} · {N cabezas}" (buttonA11y) → matcheamos por el nombre del rodeo.
 *
 * La home carga las cards del RodeoContext (ya disponible al aterrizar) — el nombre del rodeo sembrado
 * va namespaced con el RUN_TAG, así que es único. La ancla de aterrizaje es la GroupActionsBar (botón
 * "Castrar" siempre presente, R1.5). Espera generosa: los animales del grupo bajan por first-sync.
 */
export async function gotoRodeoGroup(page: Page, rodeoName: string): Promise<void> {
  const card = page.getByRole('button', { name: new RegExp(escapeRegExp(rodeoName)) }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  // Aterrizaje: la vista de grupo siempre ofrece "Castrar" (R1.5, no se gatea).
  await expect(page.getByRole('button', { name: 'Castrar', exact: true })).toBeVisible({ timeout: 30_000 });
}

/**
 * Inicio rodeo-céntrico (spec 10 R2.2) → VISTA DE GRUPO de un LOTE (lote/[id]). La card del lote es un
 * GroupSummaryCard (role="button" cuyo nombre accesible incluye el nombre del lote). Aterriza en la vista de
 * grupo del lote; la ancla es la afordancia "Vender / Descartar" (delta lotes-venta, RLV.2 — presente con
 * ≥1 activo). El lote debe tener animales activos para figurar en la home.
 */
export async function gotoLoteGroup(page: Page, loteName: string): Promise<void> {
  const card = page.getByRole('button', { name: new RegExp(escapeRegExp(loteName)) }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page.getByTestId('lote-vender-descartar')).toBeVisible({ timeout: 30_000 });
}

/** Escapa los metacaracteres de regex de un literal (el RUN_TAG no los tiene, pero defensivo). */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lee el MAYOR `scrollTop` entre los contenedores scrolleables del DOM (spec 10 fix Raf 2026-06-12). El
 * ScrollView de la ficha (react-native-web) renderiza un <div> con overflow scrolleable; al accionar (toggle
 * castrado, ⭐, borrar evento) NO debe saltar al tope (scrollTop ~0). Esta lectura es robusta a la estructura
 * exacta del árbol RN-web: barre todos los elementos y devuelve el scrollTop máximo (el del scroller activo).
 * Sirve para asertar que un refresh post-acción PRESERVA la posición de scroll (no resetea al tope).
 */
export async function readMaxScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    let max = 0;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const e = el as HTMLElement;
      if (e.scrollTop > max) max = e.scrollTop;
    }
    return max;
  });
}
