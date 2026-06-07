// e2e/helpers/rodeos.ts — helpers de interacción con el wizard "Crear rodeo" (spec 02 C1).
//
// Cómo renderiza al DOM (relevante para los selectores):
//   - Las cards de sistema (Step1System → SystemCard) son Pressable con role="button" +
//     aria-label "Sistema Cría" / "… (próximamente, no disponible)".
//   - El nombre del rodeo es un FormField → <input aria-label="Nombre del rodeo">.
//   - Cada fila de toggle (FieldTemplateToggleList → ToggleRow interactivo) es un Pressable con
//     role="switch" + aria-checked + aria-label={label del field}. Las filas required/readOnly
//     son <div> (no switch tappable) — por eso filtramos por el rol switch tappable.
//   - Los CTAs son Button → role="button" con el texto ("Continuar", "Crear rodeo").

import { expect, type Page, type Locator } from '@playwright/test';

/**
 * Avanza el wizard "Crear rodeo" hasta el paso 3 (plantilla de datos) y devuelve el locator de
 * la PRIMERA fila de toggle interactiva (role=switch). Sirve tanto para el modo bloqueo total
 * (empty-state, "Creá tu primer rodeo") como para el modo navegable ("Crear rodeo").
 */
export async function gotoCrearRodeoStep3(page: Page): Promise<Locator> {
  // Paso 1 — sistema productivo. El único activo (Cría) ya viene pre-seleccionado por el wizard,
  // pero lo clickeamos por robustez (idempotente). El botón "Continuar" avanza.
  const cria = page.getByRole('button', { name: /Sistema Cría/ });
  await expect(cria).toBeVisible({ timeout: 30_000 });
  await cria.click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Paso 2 — nombre del rodeo.
  const nameInput = page.getByLabel('Nombre del rodeo', { exact: true });
  await expect(nameInput).toBeVisible({ timeout: 15_000 });
  await nameInput.fill('Rodeo de prueba');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Paso 3 — plantilla. Esperamos a que aparezca al menos una fila de toggle interactiva.
  const firstToggle = page.getByRole('switch').first();
  await expect(firstToggle).toBeVisible({ timeout: 20_000 });
  return firstToggle;
}

/**
 * Completa el wizard "Crear rodeo" de punta a punta y dispara el create. Si `alreadyAtStep3` es
 * true, asume que ya estamos en el paso 3 (el caller navegó con gotoCrearRodeoStep3) y solo
 * clickea "Crear rodeo". Si no, recorre los 3 pasos con `name`.
 */
export async function completeCrearRodeo(
  page: Page,
  name: string,
  opts: { alreadyAtStep3?: boolean } = {},
): Promise<void> {
  if (!opts.alreadyAtStep3) {
    const cria = page.getByRole('button', { name: /Sistema Cría/ });
    await expect(cria).toBeVisible({ timeout: 30_000 });
    await cria.click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    const nameInput = page.getByLabel('Nombre del rodeo', { exact: true });
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    // Esperamos el paso 3 (la plantilla cargó).
    await expect(page.getByRole('switch').first()).toBeVisible({ timeout: 20_000 });
  }

  // Crear. El botón dice "Crear rodeo".
  const crear = page.getByRole('button', { name: 'Crear rodeo', exact: true });
  await expect(crear).toBeVisible({ timeout: 15_000 });
  await crear.click();

  // Oferta de onboarding (feature 12, R1.2): tras crear el PRIMER rodeo desde el empty-state de
  // bloqueo total, en vez de ir directo al inicio la app interpone OnboardingImportOffer (dos CTAs:
  // "Importar mi rodeo existente" / "Más tarde, ir al inicio"). La descartamos tocando "Más tarde,
  // ir al inicio" para aterrizar en home. En el alta NO-bloqueante (no empty-state) NO hay oferta
  // —va directo a /rodeos— así que esto es TOLERANTE: si no aparece, seguimos sin romper.
  const skipOffer = page.getByRole('button', { name: 'Más tarde, ir al inicio', exact: true });
  try {
    await skipOffer.waitFor({ state: 'visible', timeout: 15_000 });
    await skipOffer.click();
  } catch {
    // alta no-bloqueante: no hay oferta de onboarding, seguimos
  }
}
