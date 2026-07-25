// e2e/captures/config-sheet-autosave.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5,
// ADR-029) del delta UX 4 del sheet de PRECONFIG DE TANDA (spec 03, etapa 2 del wizard; R1.7/R1.8).
//
// ── QUÉ CAMBIÓ ────────────────────────────────────────────────────────────────────────────────────────
// El sheet tenía COMMIT DIFERIDO: los chips vivían en estado local y sólo se persistían con "Guardar".
// Dos defectos: (1) "Guardar" pedía CONFIRMAR lo ya confirmado ("Agregar"/Enter ya es el commit y el chip
// ya es el feedback — en 🔴 manga cada tap se paga); (2) de las CUATRO salidas del sheet (Guardar,
// Cancelar, la X del header y el tap en el scrim), TRES descartaban en silencio: cuatro vacunas cargadas
// se perdían de un roce del guante en el scrim, sin aviso (Nielsen #5).
// Ahora: AUTO-GUARDADO en los dos modos (multi/vacunación y single/inseminación), "Cancelar" eliminado,
// footer con un único CTA primario "Listo" que sólo cierra, texto tipeado sin agregar que se agrega AL
// CERRAR por cualquier vía, y la × del chip (única acción destructiva, ahora inmediata) con target
// $touchMin (56px, antes ~34px efectivos).
//
// NO corras esto en `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/config-sheet-autosave.capture.ts --config playwright.capture.config.ts
//
// Estados capturados (412×915 salvo los "alto recortado", 412×420 ≈ teclado abierto):
//   01 — etapa 2, Vacunación elegida SIN vacunas: marca "Faltan vacunas" + chevron terracota (punto de partida)
//   02 — sheet ABIERTO VACÍO: footer con UN solo CTA "Listo" (sin Guardar ni Cancelar) + X en el header
//   03 — UNA vacuna agregada: chip con la × grande ($touchMin) + "Usadas antes" con la otra sugerencia
//   04 — TRES vacunas agregadas: el flexWrap de los chips grandes, con el input clavado arriba
//   05 — TEXTO TIPEADO SIN "Agregar" (el estado que antes se perdía al cerrar; ahora se flushea)
//   06 — cerrado por SCRIM (el gesto hostil): el valor QUEDÓ, la fila lo muestra inline y el aviso se fue
//   07 — sheet REABIERTO con los 4 valores como chips (round-trip del string coma-separado)
//   08 — SIN CHIPS, con el sheet TODAVÍA abierto: la fila de atrás ya volvió a reclamar la vacuna
//        (el commit del borrado es inmediato — se ve el estado de la etapa detrás del scrim)
//   09 — ALTO RECORTADO con chips cargados: título + input + "Listo" siguen dentro del viewport
//   10 — INSEMINACIÓN (modo SINGLE): mismo footer "Listo", el input ES el valor (commitea al tipear)
//   11 — inseminación cerrada por la X: la pajuela quedó inline en la fila

import path from 'node:path';

import { test, applyEnvShim, expect, type Page, type Browser } from '../helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedManeuverPreset,
  setRodeoDataKey,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome } from '../helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

const SHOT_DIR = path.join(process.cwd(), 'e2e', 'captures', '__shots__', 'config-sheet-autosave');

const FULL = { width: 412, height: 915 } as const;
/** Alto útil que queda con el teclado abierto en un teléfono (≈45% de la pantalla). */
const KEYBOARD_UP = { width: 412, height: 420 } as const;

async function newMobilePage(browser: Browser): Promise<Page> {
  // hasTouch: el cierre por SCRIM se captura con un tap TÁCTIL real (es el gesto del guante que
  // destapó el bug), no con un click sintético.
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { ...FULL } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** CTA único del sheet (scopeado: "Listo" es un copy que otras pantallas del flujo también usan). */
function done(page: Page) {
  return page.getByTestId('maneuver-config-sheet').getByRole('button', { name: 'Listo', exact: true });
}

/** Tap TÁCTIL deliberado en la zona alta LIBRE del scrim (el sheet está anclado abajo). */
async function tapScrim(page: Page): Promise<void> {
  const box = await page.getByTestId('maneuver-config-scrim').boundingBox();
  if (!box) throw new Error('sin boundingBox para el scrim');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + 12);
}

test('capturas preconfig auto-guardado (UX 4): multi (vacunación) @ 412 + alto recortado', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-config-autosave');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Config Autosave');
    // Presets previos → siembran el autocompletar (R1.8): "Brucelosis"/"Aftosa" como "Usadas antes".
    await seedManeuverPreset(establishmentId, 'Sanitario otoño', {
      maniobras: ['vacunacion'],
      preconfig: { vacunacion: 'Brucelosis' },
    });
    await seedManeuverPreset(establishmentId, 'Sanitario primavera', {
      maniobras: ['vacunacion'],
      preconfig: { vacunacion: 'Aftosa' },
    });

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // ── 01) ETAPA 2 con Vacunación elegida y SIN vacunas (el aviso que el sheet tiene que resolver) ──
    await page.goto('/maniobra/jornada');
    await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
    await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('pool-row-vacunacion').click();
    await expect(page.getByTestId('selected-row-0')).toBeVisible();
    await expect(page.getByText('Faltan vacunas', { exact: true })).toBeVisible();
    await expect(page.getByTestId('selected-config-fix-0')).toBeVisible();
    await shot(page, '01-etapa2-faltan-vacunas');

    // ── 02) SHEET ABIERTO VACÍO — footer con UN solo CTA "Listo" + X en el header ──
    await page.getByTestId('selected-body-0').click();
    await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('maneuver-config-input')).toBeVisible();
    await expect(page.getByText('Usadas antes', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(done(page)).toBeVisible();
    await expect(page.getByTestId('maneuver-config-sheet-close')).toBeVisible();
    await shot(page, '02-sheet-vacio-cta-listo');

    // ── 03) UNA vacuna agregada — el chip con la × grande + la otra sugerencia sigue en "Usadas antes" ──
    await page.getByTestId('config-suggestion-Brucelosis').click();
    await expect(page.getByTestId('config-chip-Brucelosis')).toBeVisible();
    await expect(page.getByTestId('config-suggestion-Aftosa')).toBeVisible();
    await shot(page, '03-chip-uno-x-grande');

    // ── 04) TRES vacunas — el flexWrap de los chips grandes, con el input clavado arriba ──
    for (const vacuna of ['Aftosa', 'Mancha'] as const) {
      await page.getByTestId('maneuver-config-input').fill(vacuna);
      await page.getByTestId('maneuver-config-input').press('Enter');
      await expect(page.getByTestId(`config-chip-${vacuna}`)).toBeVisible({ timeout: 5_000 });
    }
    await shot(page, '04-tres-chips-wrap');

    // ── 05) TEXTO TIPEADO SIN "Agregar" — el estado que antes se perdía al cerrar ──
    await page.getByTestId('maneuver-config-input').fill('Carbunclo');
    await shot(page, '05-texto-tipeado-sin-agregar');

    // ── 06) CIERRE POR SCRIM (el gesto hostil) — el valor QUEDÓ, incluido lo tipeado sin agregar ──
    await tapScrim(page);
    await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('selected-config-0')).toHaveText(
      'Brucelosis, Aftosa, Mancha, Carbunclo',
    );
    await expect(page.getByText('Faltan vacunas', { exact: true })).toHaveCount(0);
    await shot(page, '06-cerrado-por-scrim-persistio');

    // ── 07) REABIERTO — los 4 valores vuelven como chips (round-trip del string coma-separado) ──
    await page.getByTestId('selected-body-0').click();
    await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('config-chip-Carbunclo')).toBeVisible();
    await shot(page, '07-reabierto-round-trip');

    // ── 09) ALTO RECORTADO (≈ teclado arriba) CON chips cargados: título + input + "Listo" a la vista ──
    // (Se captura antes de vaciar para que la foto tenga contenido real en el body.)
    await page.setViewportSize({ ...KEYBOARD_UP });
    await shot(page, '09-alto-recortado-con-chips');
    await page.setViewportSize({ ...FULL });

    // ── 08) SIN CHIPS, con el sheet TODAVÍA ABIERTO — la fila de atrás ya volvió a reclamar la vacuna ──
    for (const vacuna of ['Carbunclo', 'Mancha', 'Aftosa', 'Brucelosis'] as const) {
      await page.getByRole('button', { name: `Quitar ${vacuna}`, exact: true }).click();
      await expect(page.getByTestId(`config-chip-${vacuna}`)).toHaveCount(0);
    }
    await expect(page.getByTestId('selected-config-warn-0')).toBeVisible();
    await shot(page, '08-sin-chips-fila-reclama-detras');

    await done(page).click();
    await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await page.context().close();
  }
});

test('capturas preconfig auto-guardado (UX 4): single (inseminación) @ 412', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newMobilePage(browser);
  try {
    const user = await createTestUser('cap-config-autosave-single');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(
      user.id,
      'Campo Config Autosave Single',
    );
    // `inseminacion` nace OFF en la plantilla de cría (0018) → la prendemos para que el pool la ofrezca.
    await setRodeoDataKey(rodeoId, 'inseminacion', true);
    await seedManeuverPreset(establishmentId, 'IA primavera', {
      maniobras: ['inseminacion'],
      preconfig: { inseminacion: 'Toro 123' },
    });

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    await page.goto('/maniobra/jornada');
    await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
    await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
    // La fila en el pool prueba que el rodeo_data_config con inseminacion ENABLED ya bajó al SQLite.
    await expect(page.getByTestId('pool-row-inseminacion')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('pool-row-inseminacion').click();
    await expect(page.getByTestId('selected-row-0')).toBeVisible();

    // ── 10) SHEET SINGLE — mismo footer "Listo"; el input ES el valor y commitea al tipear ──
    await page.getByTestId('selected-body-0').click();
    await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('maneuver-config-input').fill('Toro 456');
    await expect(done(page)).toBeVisible();
    await shot(page, '10-inseminacion-single-listo');

    // ── 11) CERRADO POR LA X — la pajuela quedó inline en la fila (no hacía falta "Guardar") ──
    await page.getByTestId('maneuver-config-sheet-close').click();
    await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('selected-config-0')).toHaveText('Toro 456');
    await shot(page, '11-inseminacion-persistio-al-cerrar');
  } finally {
    await page.context().close();
  }
});
