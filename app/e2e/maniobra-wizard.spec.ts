// e2e/maniobra-wizard.spec.ts — CAPTURA del WIZARD de config de jornada (spec 03 M1.4) para el veto
// del leader con la skill design-review + smoke del flujo real.
//
// A diferencia del spike (M2.0, 100% mock, alcanzable sin auth), el wizard es una pantalla REAL: consume
// el establishment/rodeo del contexto + los servicios de M1 (gating capa 1, presets, createSession). Por
// eso este spec SÍ siembra usuario + establishment + rodeo y loguea (patrón baston.spec.ts). El rodeo
// sembrado trae su rodeo_data_config por el trigger 0018 (defaults de cría) → la etapa 2 ofrece las
// maniobras habilitadas (inseminación queda OFF por default → demuestra el gating capa 1, R1.4/R1.5).
//
// Capturas (412×915, viewport del project) → design/maniobra-wizard/*.png:
//   1) inicio.png      — pantalla de inicio: presets al tope (vacío → copy) + CTA "Nueva jornada"
//   2) etapa1.png      — elegir RODEO (filas grandes de rodeos activos)
//   3) etapa2.png        — elegir MANIOBRAS: LISTA UNIFICADA (seleccionadas-arriba con número+grip,
//                          pool-abajo tap para sumar) + preconfig INLINE (Vacunación · Brucelosis en la fila)
//   3a) etapa2-sheet.png  — BOTTOM SHEET de preconfig abierto (input grande + autocompletar) — UX 3
//   3b) etapa2-scroll.png — 8 maniobras elegidas, lista SCROLLEADA hasta el pool + el CTA (fix UX 2:
//                           con muchas maniobras la etapa 2 scrollea, todo alcanzable)
//   4) etapa2-drag.png   — estado "BURBUJA": una fila levantada (lift/sombra/esquinas) vía ?dragFreeze
//   5) etapa3.png        — RESUMEN: maniobras en el orden elegido (con detalle) + "Arrancar jornada"
//
// Además smoke-testea el camino feliz: tap de maniobras (suben al tope) → la lista no rompe → crea la
// sesión (la pantalla navega a la carga del spike). El cleanup borra el establishment (cascada) en afterAll.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedManeuverPreset,
  setUserPhone,
  cleanupAll,
  waitForServerPreset,
} from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'design', 'maniobra-wizard');

test.afterAll(async () => {
  await cleanupAll();
});

/** Abre MODO MANIOBRAS desde el FAB central elevado (push '/maniobra', modal). */
async function openManiobra(page: Page): Promise<void> {
  // El FAB es el target central elevado del bottom-nav (a11y label "Abrir MODO MANIOBRAS", (tabs)/_layout).
  // Tras el push, la pantalla de inicio (app/maniobra.tsx) muestra "Modo maniobras" + "Nueva jornada".
  const fab = page.getByRole('button', { name: 'Abrir MODO MANIOBRAS', exact: true });
  await expect(fab).toBeVisible({ timeout: 30_000 });
  await fab.click();
  await expect(page.getByRole('button', { name: 'Nueva jornada', exact: true })).toBeVisible({ timeout: 20_000 });
}

test('captura wizard de jornada: inicio → rodeo → maniobras (reorder) → resumen → arranca', async ({ page }) => {
  const user = await createTestUser('maniobra-wizard');
  await setUserPhone(user.id, '1123456789');
  // Un solo campo + un rodeo bovino/cría (su rodeo_data_config lo seedea el trigger 0018).
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Maniobra Wizard');
  // Dos presets previos con preconfig de vacunación → el wizard SIEMBRA el autocompletar (R1.8/DM1-UI-1)
  // de los valores usados antes: "Brucelosis" y "Aftosa" aparecerán como sugerencias en el sheet. Dos
  // valores distintos: así, agregando "Brucelosis" como chip, "Aftosa" sigue como "Usadas antes" en la
  // captura hero (chip + sugerencia distinta + Guardar habilitado a la vez).
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

  // ── 1) INICIO ──────────────────────────────────────────────────────────────────────────
  await openManiobra(page);
  await expect(page.getByText('Modo maniobras', { exact: true })).toBeVisible();
  await expect(page.getByText('Tus rutinas', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'inicio.png') });

  // ── 2) ETAPA 1 — RODEO ───────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Nueva jornada', exact: true }).click();
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Paso 1 de 3', { exact: true })).toBeVisible();
  // La fila del rodeo sembrado (nombre namespaced con RUN_TAG) es tappable.
  const rodeoRow = page.getByRole('button', { name: /Elegir rodeo / }).first();
  await expect(rodeoRow).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(OUT_DIR, 'etapa1.png') });

  // ── 3) ETAPA 2 — MANIOBRAS (lista unificada: tap para sumar + drag para ordenar) ────────────
  await rodeoRow.click();
  await expect(page.getByText('Elegí las maniobras', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Paso 2 de 3', { exact: true })).toBeVisible();
  // La lista unificada aparece. Sin nada elegido, el rótulo del pool invita a tocar.
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Tocá las maniobras de la jornada', { exact: true })).toBeVisible();
  // Las maniobras habilitadas en el rodeo de cría están en el pool (R1.4); inseminación NO (gating OFF).
  await expect(page.getByTestId('pool-row-tacto')).toBeVisible();
  await expect(page.getByTestId('pool-row-vacunacion')).toBeVisible();
  // Inseminación NO debe ofrecerse (su data_key inseminacion está OFF por default en cría → gating R1.5).
  await expect(page.getByTestId('pool-row-inseminacion')).toHaveCount(0);

  // Elegimos 3 maniobras EN UN ORDEN (tap → suben al tope) → quedan como seleccionadas numeradas.
  await page.getByTestId('pool-row-pesaje').click();
  await page.getByTestId('pool-row-tacto').click();
  await page.getByTestId('pool-row-vacunacion').click();

  // Las seleccionadas suben al tope con número + grip VISIBLE (R1.12) — un grip por fila elegida.
  await expect(page.getByText('En la jornada (arrastrá para ordenar)', { exact: true })).toBeVisible();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await expect(page.getByTestId('drag-handle-0')).toBeVisible();
  await expect(page.getByTestId('drag-handle-2')).toBeVisible();

  // ZONAS DE TOQUE (UX 3): el BADGE de una fila seleccionada = QUITAR la maniobra (deseleccionar). Lo
  // verificamos sobre Vacunación (#3, index 2, la última): tocar su badge la baja al pool; la re-sumamos
  // para RESTAURAR el orden original [Pesaje, Tacto, Vacunación] (Vacunación vuelve a ser la #3 / index 2).
  await page.getByTestId('selected-remove-2').click();
  await expect(page.getByTestId('pool-row-vacunacion')).toBeVisible();
  await expect(page.getByTestId('selected-row-2')).toHaveCount(0);
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-2')).toBeVisible();

  // PRECONFIG INLINE (UX 3): Vacunación es configurable → su fila muestra segunda línea. Sin cargar, D2
  // (endurecimiento etapa 2) muestra la marca "Faltan vacunas" (antes el hint "Tocá para elegir vacuna").
  // Tacto TAMBIÉN es configurable desde B2 (¿medir tamaño?) → muestra su propia 2da línea ("Sugerido: …");
  // Pesaje (no configurable) NO muestra segunda línea.
  await expect(page.getByText('Faltan vacunas', { exact: true })).toBeVisible();
  // Cargamos el preconfig DESDE EL SHEET: tocar el cuerpo de la fila de Vacunación lo abre (la fila de
  // vacunación es la #3 → index 2). Capturamos el sheet ABIERTO con el input + autocompletar para el veto.
  // NOTA: el race "el sheet se abre y se cierra al instante" (click huérfano del tap táctil sobre el scrim,
  // bug que Raf cazó en web) NO se reproduce en ESTE project (Desktop Chrome, hasTouch:false → sin la
  // emulación touch→mouse→click que lo dispara). La regresión vive en maniobra-config-sheet-race.spec.ts,
  // que abre un context con hasTouch:true y usa touchscreen.tap (única forma fiel de cazarlo en Playwright).
  await page.getByTestId('selected-body-2').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('maneuver-config-input')).toBeVisible();
  // AUTOCOMPLETAR (R1.8): los presets sembrados dejan "Brucelosis" y "Aftosa" como valores usados antes →
  // aparecen como sugerencias bajo "Usadas antes" (sin tipear nada, prefijo vacío = lista completa).
  await expect(page.getByText('Usadas antes', { exact: true })).toBeVisible();
  await expect(page.getByTestId('config-suggestion-Brucelosis')).toBeVisible();
  await expect(page.getByTestId('config-suggestion-Aftosa')).toBeVisible();
  // Tocar la sugerencia la agrega como chip (multi) → demuestra el autocompletar real. "Aftosa" se EXCLUYE
  // de las sugerencias sólo si fuera la agregada; como agregamos "Brucelosis", "Aftosa" sigue en "Usadas
  // antes" → la captura hero muestra a la vez: el chip, una sugerencia distinta y Guardar verde habilitado.
  await page.getByTestId('config-suggestion-Brucelosis').click();
  await expect(page.getByTestId('config-chip-Brucelosis')).toBeVisible();
  await expect(page.getByTestId('config-suggestion-Aftosa')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled();
  // Captura HERO del sheet: chip "Brucelosis" agregado (con su ×) + input grande + "Usadas antes" (Aftosa)
  // + "Guardar" en botella verde a full (habilitado), arriba de "Cancelar".
  await page.screenshot({ path: path.join(OUT_DIR, 'etapa2-sheet.png') });
  // Guardar → persiste en config.preconfig.vacunacion y se ve INLINE en la fila (round-trip).
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
  // El valor cargado aparece INLINE en la fila (segunda línea) = "Brucelosis".
  await expect(page.getByTestId('selected-config-2')).toHaveText('Brucelosis');
  await page.screenshot({ path: path.join(OUT_DIR, 'etapa2.png') });

  // LIMPIAR en MULTI (fix de canSave): reabrir el sheet con la vacuna ya cargada → quitar el chip con su
  // × → items=[] → "Guardar" SIGUE habilitado (antes quedaba deshabilitado y no había forma de borrar la
  // vacuna). Guardar con todo vacío persiste '' → el caller borra la clave → la fila vuelve al hint.
  await page.getByTestId('selected-body-2').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('config-chip-Brucelosis')).toBeVisible();
  await page.getByRole('button', { name: 'Quitar Brucelosis', exact: true }).click();
  await expect(page.getByTestId('config-chip-Brucelosis')).toHaveCount(0);
  // Guardar habilitado con el sheet vacío → limpia el preconfig (round-trip de borrado).
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
  // La fila vuelve a la marca "Faltan vacunas" (no el valor viejo) → config.preconfig.vacunacion quedó vacío.
  // D2: sin vacuna, la 2da línea es la MARCA de alto contraste (testID `selected-config-warn-2`), y el testID
  // del valor normal (`selected-config-2`) ya no está montado.
  await expect(page.getByTestId('selected-config-2')).toHaveCount(0);
  await expect(page.getByTestId('selected-config-warn-2')).toBeVisible();
  await expect(page.getByText('Faltan vacunas', { exact: true })).toBeVisible();
  // Restauramos "Brucelosis" para no alterar el resto del flujo (etapa 3 espera el valor cargado).
  await page.getByTestId('selected-body-2').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('config-suggestion-Brucelosis').click();
  await expect(page.getByTestId('config-chip-Brucelosis')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('selected-config-2')).toHaveText('Brucelosis');

  // ── 3a) SCROLL — con 8 maniobras elegidas la etapa 2 SCROLLEA hasta el pool + el CTA (fix UX 2) ──
  // Antes (bug de Raf): con muchas maniobras la lista absoluta ocupaba casi toda la pantalla y la 9na +
  // el pool + el "Detalle de la tanda" + el CTA "Continuar" quedaban inalcanzables (no scrolleaba).
  // Ahora la etapa 2 va dentro de un Animated.ScrollView → un swipe vertical alcanza todo. Capturamos
  // la lista scrolleada hasta abajo mostrando el pool ("Sumá más maniobras") + el CTA "Continuar".
  // Sumamos hasta 8 maniobras (el rodeo de cría ofrece 9; inseminación queda OFF) → quedan 8 arriba + 1
  // en el pool. Las que NO tocamos antes en el flujo de 3 (las 5 restantes ya están sumadas acá de cero).
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // Las 9 ofrecidas en cría (todas menos inseminación). Sumamos 8 → la 9na (pesaje_ternero) queda en pool.
  const eight = [
    'pool-row-pesaje',
    'pool-row-tacto',
    'pool-row-vacunacion',
    'pool-row-sangrado',
    'pool-row-condicion_corporal',
    'pool-row-dientes',
    'pool-row-raspado',
    'pool-row-tacto_vaquillona',
  ];
  for (const id of eight) {
    await page.getByTestId(id).click();
  }
  // Las 8 quedan arriba numeradas; la 9na (pesaje_ternero) sigue en el pool bajo "Sumá más maniobras".
  await expect(page.getByTestId('selected-row-7')).toBeVisible();
  await expect(page.getByTestId('pool-row-pesaje_ternero')).toBeAttached();
  // D2 (endurecimiento etapa 2): con Vacunación entre las elegidas, el continue exige ≥1 vacuna definida →
  // la definimos (Vacunación es la 3ra seleccionada = índice 2) para que el CTA quede "Continuar (8)".
  await page.getByTestId('selected-body-2').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('maneuver-config-input').fill('Brucelosis');
  await page.getByRole('button', { name: 'Agregar vacuna', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
  // Scrolleamos la lista hasta abajo: el pool + el CTA "Continuar (8)" deben quedar a la vista (eran
  // inalcanzables antes del fix). scrollIntoViewIfNeeded ejercita el scroll real del Animated.ScrollView.
  await page.getByTestId('pool-row-pesaje_ternero').scrollIntoViewIfNeeded();
  await expect(page.getByText('Sumá más maniobras', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Continuar/ })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'etapa2-scroll.png') });

  // ── 3b) ESTADO "BURBUJA" — fila levantada (lift/sombra) congelada vía ?dragFreeze (test hook) ──
  // Navegamos al wizard con la fila 1 congelada en estado burbuja para fotografiar el lift sin un
  // gesto real (gesture-handler no se simula en web). El resto del flujo no usa este hook.
  await page.goto('/maniobra/jornada?dragFreeze=1');
  // (El deep-link arranca en etapa 1; re-elegimos rodeo + 3 maniobras para tener la lista con la fila 1.)
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 20_000 });
  const rodeoRow2 = page.getByRole('button', { name: /Elegir rodeo / }).first();
  await rodeoRow2.click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await page.getByTestId('pool-row-tacto').click();
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-1')).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'etapa2-drag.png') });

  // Volvemos al flujo normal (sin freeze) con un deep-link limpio para continuar al resumen.
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pool-row-pesaje').click();
  await page.getByTestId('pool-row-tacto').click();
  await page.getByTestId('pool-row-vacunacion').click();
  await expect(page.getByTestId('selected-row-2')).toBeVisible();

  // Cargamos el DETALLE de tanda de la vacunación (R1.7) DESDE EL SHEET (tocar el cuerpo de la fila #3 →
  // input + Guardar) → el resumen lo muestra como "Brucelosis" bajo "Vacunación" (R1.9, maneuverDetail).
  await page.getByTestId('selected-body-2').click();
  await expect(page.getByTestId('maneuver-config-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('maneuver-config-input').fill('Brucelosis');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('maneuver-config-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('selected-config-2')).toHaveText('Brucelosis');

  // ── 4) ETAPA 3 — RESUMEN ─────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Paso 3 de 3', { exact: true })).toBeVisible();
  // Las 3 maniobras en el orden elegido (Pesaje · Tacto · Vacunación).
  await expect(page.getByText('Maniobras (3) — en este orden', { exact: true })).toBeVisible();
  // El detalle de preconfig (R1.9): "Brucelosis" bajo "Vacunación" (maneuverDetail lo resolvió del string).
  await expect(page.getByText('Brucelosis', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'etapa3.png') });

  // ── R2.1 — GUARDAR COMO RUTINA (acción secundaria de la etapa 3, INDEPENDIENTE de arrancar) ─────────
  // La acción "Guardar como rutina" convive con "Arrancar jornada" SIN competir (outline debajo del
  // primario). El primario sigue dominante (Arrancar no se degrada).
  await expect(page.getByRole('button', { name: 'Guardar como rutina', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, 'etapa3-guardar-rutina.png') });

  // Tap → sheet de nombre. "Guardar" ARRANCA DESHABILITADO (nombre vacío) — el CHECK no-vacío de 0051
  // lo exige; el sheet lo gatea de cliente (aria-disabled).
  await page.getByRole('button', { name: 'Guardar como rutina', exact: true }).click();
  await expect(page.getByTestId('save-preset-sheet')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('save-preset-input')).toBeVisible();
  const saveBtn = page.getByTestId('save-preset-sheet').getByRole('button', { name: 'Guardar', exact: true });
  await expect(saveBtn).toBeDisabled();
  // Sólo espacios → sigue deshabilitado (whitespace == vacío para el CHECK).
  await page.getByTestId('save-preset-input').fill('   ');
  await expect(saveBtn).toBeDisabled();
  await page.screenshot({ path: path.join(OUT_DIR, 'etapa3-sheet-rutina.png') });

  // Nombre válido → "Guardar" se habilita → crea el preset (CRUD-plano offline → upload queue).
  const presetName = 'Tacto de otoño';
  await page.getByTestId('save-preset-input').fill(presetName);
  await expect(saveBtn).toBeEnabled();
  await saveBtn.click();
  // OK → el sheet se cierra + aparece el feedback breve "Rutina guardada"; quedamos en la etapa 3.
  await expect(page.getByTestId('save-preset-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('preset-saved-toast')).toBeVisible();
  await expect(page.getByText('Revisá la jornada', { exact: true })).toBeVisible();

  // ORÁCULO server-side (no sólo la UI/overlay): el preset aterrizó REAL en maneuver_presets con su config
  // (las maniobras en orden de la jornada). El name va SIN RUN_TAG (lo guarda el usuario tal cual lo tipeó).
  const serverPreset = await waitForServerPreset(establishmentId, presetName);
  const cfg = serverPreset.config as { maniobras?: unknown };
  expect(Array.isArray(cfg.maniobras)).toBe(true);
  // La config persistida lleva las 3 maniobras EN EL ORDEN de la jornada (Pesaje · Tacto · Vacunación).
  expect(cfg.maniobras).toEqual(['pesaje', 'tacto', 'vacunacion']);

  // Smoke del camino feliz: arrancar crea la sesión (CRUD-plano offline) → navega a la IDENTIFICACIÓN
  // (M2.1-core, scan-first). El flujo completo de identify tiene su propio spec (maniobra-identify).
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  // Dejó el resumen y aterrizó en identify. Este spec NO setea el flag de E2E del bastón (sin mock) →
  // mode='auto' → en web el transporte es web-serial (conectable, desconectado) → el hero adaptativo
  // (M2.1, R3.6/R3.7) muestra el ConnectHero "Conectá el bastón" (no el ScanHero). La entrada manual
  // (banda inferior) sigue disponible. Alcanza para el smoke (aterrizó en identify).
  await expect(page.getByText('Revisá la jornada', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Conectá el bastón', { exact: true })).toBeVisible({ timeout: 20_000 });
});
