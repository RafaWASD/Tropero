// e2e/captures/identificadores-unificados.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta
// IDENTIFICADORES UNIFICADOS (spec 02, IDU.<n>). Recorre el modelo de 3 identificadores opcionales y saca
// CAPTURAS NOMBRADAS de cada estado clave a e2e/captures/__shots__/identificadores-unificados/NN-estado.png
// para que el leader las VETE (design-review) antes de mostrárselas a Raf en la Puerta 2.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`). La red de regresión
// vive en e2e/identificadores-unificados.spec.ts; este archivo SOLO captura estados, reusando los MISMOS
// helpers de setup/seed/navegación y los MISMOS selectores.
//
// Para correrlo:
//   cd app && pnpm exec playwright test e2e/captures/identificadores-unificados.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/identificadores-unificados/  (gitignoreado — ver app/.gitignore +
// ADR-029 §Artefactos). Los .png NO se commitean; el .capture.ts SÍ. Viewport mobile 412×915 (heredado).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedRodeo,
  seedAnimal,
  seedCustomField,
  seedCustomAttribute,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

// Path RELATIVO a app/ (cwd de Playwright) → resuelve a app/e2e/captures/__shots__/identificadores-unificados/.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'identificadores-unificados');

test.afterAll(async () => {
  await cleanupAll();
});

/** Saca una captura NOMBRADA tras un breve settle de layout. El llamador asegura un expect(...).toBeVisible()
 *  del elemento clave ANTES de invocar esto (per ADR-029). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Habilita el campo `apodo` en un rodeo (fd per-est + rodeo_data_config enabled). Devuelve el fd id. */
async function enableApodo(establishmentId: string, rodeoId: string): Promise<string> {
  return seedCustomField(establishmentId, rodeoId, {
    label: 'Nombre/Apodo',
    dataKey: 'apodo',
    dataType: 'propiedad',
    uiComponent: 'text',
  });
}

async function walkWizardToData(page: Page, opts: { sex: 'Macho' | 'Hembra'; categoryName: string }) {
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Sexo ${opts.sex}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.categoryName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

let tagCounter = 0;
function makeTag(): string {
  tagCounter += 1;
  return `982${Date.now()}${tagCounter}`.replace(/\D/g, '').slice(0, 15).padEnd(15, '0');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A — Búsqueda por los 3 + NOMBRE como HERO (lista + ficha) + ficha SIN "Nombre / seña"
// ═══════════════════════════════════════════════════════════════════════════════════════════════
test('captura: búsqueda por los 3 + hero por apodo (lista + ficha) + ficha sin "Nombre / seña"', async ({
  page,
}) => {
  test.setTimeout(210_000);
  const user = await createTestUser('idu-cap-a');
  await setUserPhone(user.id, '1123456789');
  // Rodeos con nombres LIMPIOS para la captura (rodeoRawName): "Cría hembras" (usa apodo) + "Vaquillonas".
  const { establishmentId, rodeoId: rodeoApodo } = await seedEstablishmentWithRodeo(user.id, 'Campo Demo IDU', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const rodeoSinApodo = await seedRodeo(establishmentId, 'Vaquillonas', { rawName: true });
  const apodoFd = await enableApodo(establishmentId, rodeoApodo);

  // Animales del rodeo CON apodo → hero = apodo (caravana secundaria):
  const manchada = await seedAnimal(establishmentId, rodeoApodo, { idv: 'AB123A0001', sex: 'female' });
  await seedCustomAttribute(manchada, apodoFd, 'Manchada');
  const colorada = await seedAnimal(establishmentId, rodeoApodo, { idv: 'AR0457', sex: 'female' });
  await seedCustomAttribute(colorada, apodoFd, 'La Colorada'); // apodo de 2 palabras (11 chars, cap 15)
  const tag = makeTag();
  await seedAnimal(establishmentId, rodeoApodo, { idv: 'AR0912', tag, sex: 'female' }); // idv hero (sin apodo)
  // Animal del rodeo SIN apodo → hero = caravana grande (contraste):
  await seedAnimal(establishmentId, rodeoSinApodo, { idv: 'AR1050', sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  // Dwell: el fd apodo + rodeo_data_config + custom_attributes se asientan en el SQLite local.
  await page.waitForTimeout(3000);
  await gotoAnimales(page);

  await expect(page.getByText('Manchada', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('AR1050', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // ── 01 — LISTA: NOMBRE como HERO. "Manchada" / "La Colorada" grandes (apodo), caravana secundaria muted;
  //         "AR0912"/"AR1050" con la caravana grande (sin apodo). Contraste apodo-hero vs caravana-hero. ──
  await shot(page, '01-lista-hero-por-apodo-vs-caravana');

  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });

  // ── 02 — BÚSQUEDA por ELECTRÓNICA EXACTA (15 díg) → encuentra el animal de la caravana electrónica. ──
  //    Esperamos el FILTRO YA APLICADO (no el estado pre-debounce): la búsqueda por el tag electrónico reduce
  //    la lista al ÚNICO match (AR0912) → los distractores ("Manchada"/"AR1050") DESAPARECEN. Sin esto, el shot
  //    cazaba la lista completa sin filtrar: `isSearching` seguía false hasta que el debouncedQuery disparaba, y
  //    el assert de "AR0912" pasaba de una porque ese hero YA estaba en la lista completa. Mismo criterio que
  //    03/04 (esperar el resultado filtrado), reforzado con la ausencia de los distractores.
  await search.fill(tag);
  await expect(page.getByText('Manchada', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('AR1050', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: /AR0912/ }).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, '02-busqueda-electronica-exacta');

  // ── 03 — BÚSQUEDA por idv ALFANUMÉRICO (con letras) → "AR04" encuentra "AR0457"/"La Colorada". ──
  await search.fill('AR04');
  await expect(page.getByRole('button', { name: /La Colorada/ }).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, '03-busqueda-idv-alfanumerico');

  // ── 04 — BÚSQUEDA por APODO → "Manchada" encuentra por Nombre/Apodo (custom_attributes). ──
  await search.fill('Manchada');
  await expect(page.getByRole('button', { name: /Manchada/ }).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, '04-busqueda-por-apodo');

  // ── FICHA de "Manchada": hero por apodo + caravana secundaria + Datos personalizados. La lista queda
  //    montada (hidden) detrás → filtramos por visible:true para apuntar a la ficha, no a la fila oculta. ──
  await page.getByRole('button', { name: /Manchada/ }).first().click();
  await expect(page.getByText('Identificación', { exact: true }).filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Manchada', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('#AB123A0001', { exact: true })).toBeVisible();
  // ── 05 — FICHA (hero): "Manchada" grande + "#AB123A0001" secundario muted (IDU.6.3). ──
  await shot(page, '05-ficha-hero-por-apodo');

  // ── 06 — FICHA (Identificación): SIN la vieja fila "Nombre / seña" (IDU.3.6). Solo caravana electrónica
  //         (afordancia de bastoneo, vacía) + caravana visual (valor "AB123A0001"). El Nombre/Apodo vive en
  //         "Datos personalizados", no acá. ──
  await expect(page.getByText('Nombre / seña', { exact: false })).toHaveCount(0);
  await page.getByText('Identificación', { exact: true }).filter({ visible: true }).first().scrollIntoViewIfNeeded();
  await shot(page, '06-ficha-identificacion-sin-nombre-sena');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B — ALTA sin ninguna caravana → el animal persiste (hero "Animal")
// ═══════════════════════════════════════════════════════════════════════════════════════════════
test('captura: alta SIN ninguna caravana → el animal persiste (hero "Animal")', async ({ page }) => {
  test.setTimeout(210_000);
  const user = await createTestUser('idu-cap-b');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Demo Blanco', { rodeoName: 'Cría hembras', rodeoRawName: true });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // ── 07 — PASO 4 sin ningún identificador cargado (tag/idv ausentes; no hay "Nombre / seña"). El botón
  //         "Crear animal" está habilitado (el guard "al menos un identificador" se eliminó, IDU.1.4). ──
  await expect(page.getByLabel('Caravana visual (recomendado)', { exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(page, '07-alta-paso4-sin-caravana');

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // ── 08 — FICHA del recién creado SIN caravana: el hero es el fallback "Animal" (IDU.6.6); la sección
  //         Identificación ofrece bastonear/agregar caravana. Persistió sin 23514. ──
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Animal', { exact: true }).first()).toBeVisible();
  await shot(page, '08-ficha-alta-sin-caravana-hero-animal');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// C — WARNING-SOFT de apodo duplicado en el MISMO campo (aparece, NO bloquea)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
test('captura: warning-soft de apodo duplicado en el mismo campo (aviso inline, no bloquea)', async ({
  page,
}) => {
  test.setTimeout(210_000);
  const user = await createTestUser('idu-cap-c');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Demo Warn', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
  });
  const apodoFd = await enableApodo(establishmentId, rodeoId);
  // Un animal existente con apodo "Manchada" → el nuevo que tipee "Manchada" verá el aviso.
  const existing = await seedAnimal(establishmentId, rodeoId, { idv: 'AR0500', sex: 'female' });
  await seedCustomAttribute(existing, apodoFd, 'Manchada');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await page.waitForTimeout(3000);
  await gotoAnimales(page);
  await expect(page.getByText('Manchada', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Alta de un animal NUEVO por el no-match del buscador.
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await search.fill('AR0777');
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  await expect(page.getByText('Datos personalizados', { exact: true })).toBeVisible({ timeout: 20_000 });
  const apodoInput = page.getByTestId('custom-prop-text').first();
  await apodoInput.fill('Manchada'); // duplica al existente del MISMO campo
  const warning = page.getByText('Ya hay otro animal con ese nombre en este campo.', { exact: true });
  await expect(warning).toBeVisible({ timeout: 15_000 });
  // Traemos el AVISO a la vista (no el header de sección) → el shot enmarca el input + el aviso muted, sin
  // que el footer "Crear animal" lo recorte.
  await warning.scrollIntoViewIfNeeded();
  // ── 09 — El aviso inline muted bajo el input del apodo (NO bloquea el guardado, IDU.5.5). ──
  await shot(page, '09-warning-apodo-duplicado');
});
