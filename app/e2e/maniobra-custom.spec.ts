// e2e/maniobra-custom.spec.ts — UI de CREACIÓN de datos/maniobras CUSTOM (spec 03 M5-C.2, R13.5–R13.9).
//
// Cubre los DOS `+` que convergen en field_definitions (0093) + el server-oráculo (offline → sync →
// CRUD-plano → 0093):
//   1) `+` en la CONFIG DE DATOS DEL RODEO (editar-plantilla): pregunta de clasificación (propiedad|maniobra,
//      R13.6) → form (label + tipo de input + opciones si enum) → Crear → el dato aparece en la plantilla.
//   2) `+` en la LISTA DE MANIOBRAS del wizard (jornada etapa 2): SIN pregunta (data_type='maniobra' fijo,
//      R13.7) → form → Crear → la maniobra custom aparece habilitada en el rodeo.
//
// Capturas (412 + 360, web táctil con hasTouch) → tests/modo-maniobra/custom-*.png:
//   - custom-config-plus-{360,412}.png   — el `+` en la config de datos del rodeo
//   - custom-classify-{360,412}.png      — la pregunta de clasificación
//   - custom-form-{360,412}.png          — el form con el picker de tipo de input
//   - custom-enum-options-{360,412}.png  — el editor de opciones de un enum
//   - custom-maneuver-plus-{360,412}.png — el `+` en la lista de maniobras del wizard
//
// El cleanup borra el establishment (cascada) en afterAll.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
  waitForServerCustomField,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'tests', 'modo-maniobra');

test.afterAll(async () => {
  await cleanupAll();
});

/** Abre MODO MANIOBRAS desde el FAB central elevado y entra al wizard de jornada. */
async function openWizard(page: Page): Promise<void> {
  const fab = page.getByRole('button', { name: 'Abrir MODO MANIOBRAS', exact: true });
  await expect(fab).toBeVisible({ timeout: 30_000 });
  await fab.click();
  await page.getByRole('button', { name: 'Nueva jornada', exact: true }).click();
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function shot(page: Page, name: string): Promise<void> {
  // 412 (default del project) + 360 (la manga más angosta). Sin overflow / el sheet entra entero.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-412.png`) });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-360.png`) });
  await page.setViewportSize({ width: 412, height: 915 });
}

test('config `+`: clasificación → form (propiedad/enum) → crear → aterriza en el server (offline→sync→0093)', async ({ page }) => {
  const user = await createTestUser('m5c2-config');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom Config');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Deep-link a "Editar plantilla" del rodeo (owner; el `+` vive ahí).
  await page.goto(`/editar-plantilla?rodeoId=${rodeoId}&name=Rodeo`);
  await expect(page.getByText('Plantilla de datos', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 1) El `+` de crear dato personalizado (owner-only) ──────────────────────────────────────
  const plus = page.getByTestId('config-add-custom-field');
  await plus.scrollIntoViewIfNeeded();
  await expect(plus).toBeVisible({ timeout: 15_000 });
  await shot(page, 'custom-config-plus');

  // ── 2) Pregunta de CLASIFICACIÓN (R13.6): propiedad vs maniobra ──────────────────────────────
  await plus.click();
  await expect(page.getByTestId('custom-field-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('¿Qué tipo de dato es?', { exact: true })).toBeVisible();
  await expect(page.getByTestId('classify-propiedad')).toBeVisible();
  await expect(page.getByTestId('classify-maniobra')).toBeVisible();
  await shot(page, 'custom-classify');

  // Elegimos PROPIEDAD (dato fijo) → pasa al form. El data_type queda 'propiedad' (no se infiere).
  await page.getByTestId('classify-propiedad').click();
  await expect(page.getByTestId('custom-field-label')).toBeVisible({ timeout: 10_000 });

  // ── 3) FORM: nombre + picker de tipo de input (los 7) ────────────────────────────────────────
  await page.getByTestId('custom-field-label').fill('Apodo del animal');
  // Los 7 tipos se ofrecen.
  for (const t of ['numeric', 'numeric_stepped', 'enum_single', 'enum_multi', 'text', 'boolean', 'date']) {
    await expect(page.getByTestId(`type-${t}`)).toBeVisible();
  }
  await shot(page, 'custom-form');

  // ── 4) EDITOR DE OPCIONES de un enum ─────────────────────────────────────────────────────────
  await page.getByTestId('type-enum_single').click();
  await expect(page.getByTestId('custom-field-option-input')).toBeVisible();
  // Agregar 3 opciones; cada una se vuelve un chip con su ×.
  for (const opt of ['adentro', 'afuera', 'normal']) {
    await page.getByTestId('custom-field-option-input').fill(opt);
    await page.getByTestId('custom-field-add-option').click();
    await expect(page.getByTestId(`option-chip-${opt}`)).toBeVisible();
  }
  await expect(page.getByText('Opciones (3)', { exact: true })).toBeVisible();
  // Quitar una con la × y re-agregarla (el editor maneja agregar/quitar).
  await page.getByRole('button', { name: 'Quitar normal', exact: true }).click();
  await expect(page.getByTestId('option-chip-normal')).toHaveCount(0);
  await page.getByTestId('custom-field-option-input').fill('normal');
  await page.getByTestId('custom-field-add-option').click();
  await expect(page.getByTestId('option-chip-normal')).toBeVisible();
  await shot(page, 'custom-enum-options');

  // ── 5) CREAR → el sheet se cierra; la fila aterriza en el server (offline → sync → 0093) ──────
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByTestId('custom-field-sheet')).toHaveCount(0, { timeout: 15_000 });

  // Oráculo SERVER: el dato custom llegó a field_definitions con data_type='propiedad', enum_single y las
  // opciones (config_schema decodificado a jsonb, NO double-encodeado). El label es el que tipeó el usuario.
  const fd = await waitForServerCustomField(establishmentId, 'Apodo del animal');
  expect(fd.dataType).toBe('propiedad');
  expect(fd.uiComponent).toBe('enum_single');
  expect(fd.dataKey).toMatch(/^[a-z0-9_]+$/);
  // config_schema.options llegó como array jsonb nativo (la prueba del anti-doble-encoding del connector).
  const schema = fd.configSchema as { options?: unknown } | null;
  expect(Array.isArray(schema?.options)).toBe(true);
  expect(schema?.options).toEqual(['adentro', 'afuera', 'normal']);
});

test('maniobra `+`: SIN clasificación (data_type maniobra fijo, R13.7) → crear → habilita en el rodeo + aterriza', async ({ page }) => {
  const user = await createTestUser('m5c2-maniobra');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Custom Maniobra');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Wizard → elegir rodeo → etapa 2.
  await openWizard(page);
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByText('Elegí las maniobras', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 1) El `+` de crear maniobra personalizada (owner-only), bajo "Maniobras personalizadas" ──
  await expect(page.getByText('Maniobras personalizadas', { exact: true })).toBeVisible();
  const plus = page.getByTestId('maneuver-add-custom');
  await plus.scrollIntoViewIfNeeded();
  await expect(plus).toBeVisible({ timeout: 15_000 });
  await shot(page, 'custom-maneuver-plus');

  // ── 2) El sheet arranca DIRECTO en el form (sin pregunta de clasificación, R13.7) ─────────────
  await plus.click();
  await expect(page.getByTestId('custom-field-sheet')).toBeVisible({ timeout: 10_000 });
  // NO hay pregunta de clasificación (mode='maniobra' → data_type fijo).
  await expect(page.getByTestId('classify-propiedad')).toHaveCount(0);
  await expect(page.getByText('Nueva maniobra', { exact: true })).toBeVisible();
  await expect(page.getByTestId('custom-field-label')).toBeVisible();

  // Numérico (ej. ángulo de pezuñas) → sin opciones.
  await page.getByTestId('custom-field-label').fill('Ángulo de pezuñas');
  await page.getByTestId('type-numeric').click();
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByTestId('custom-field-sheet')).toHaveCount(0, { timeout: 15_000 });

  // ── 3) La maniobra custom aparece en la lista (habilitada en el rodeo) ────────────────────────
  await expect(page.getByText('Ángulo de pezuñas', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Oráculo SERVER: la maniobra custom llegó a field_definitions con data_type='maniobra', numeric, sin
  // config_schema. (El enable en rodeo_data_config va por la RPC set_rodeo_config — su efecto es offline +
  // se ve en la lista; el server-check del field cubre la creación, que es el corazón de C.2.)
  const fd = await waitForServerCustomField(establishmentId, 'Ángulo de pezuñas');
  expect(fd.dataType).toBe('maniobra');
  expect(fd.uiComponent).toBe('numeric');
  expect(fd.configSchema).toBeNull();
});
