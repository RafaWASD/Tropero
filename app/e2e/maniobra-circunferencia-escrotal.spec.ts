// e2e/maniobra-circunferencia-escrotal.spec.ts — CIRCUNFERENCIA ESCROTAL (CE) en el FLUJO REAL de MODO
// MANIOBRAS (spec 03 M6-C.1, US-14). Backend M6 YA APLICADO al remoto (0098/0099/0100) → oráculo server real.
//
// Cubre el camino end-to-end de la maniobra de CE:
//   A) APLICABILIDAD (R14.2/R14.3/R14.4): en un rodeo de CRÍA (donde circunferencia_escrotal está seedeada
//      ENABLED por defecto, R14.18), la CE entra en la secuencia de un TORITO entero y se SALTEA en una
//      hembra / un ternero / un castrado (novillo). Castración DESCONOCIDA en un torito → la CE APARECE.
//   B) CARGA (R14.5/R14.10): la rueda de CE aparece → el campo editable + teclado funcionan → confirmar →
//      la fila aterriza en scrotal_measurements con session_id + establishment_id/recorded_by FORZADOS
//      (oráculo service_role).
//   C) EDAD (R14.6/R14.7): la edad se PRELLENA de animal_birth_date (≈ N meses) y es AJUSTABLE por la rueda
//      de meses del sheet.
//
// Capturas web TÁCTIL (hasTouch, 412 + 360) → tests/modo-maniobra/:
//   - ce-flujo-reposo-{360,412}.png  — la CE dentro del flujo real (header de identidad + rueda + edad)
//   - ce-flujo-input-{360,412}.png   — el campo editable con el teclado (tipeando)
//
// El cleanup borra los establishments (cascada) en afterAll.

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  waitForServerScrotalMeasurement,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

const OUT_DIR = path.join(__dirname, '..', '..', 'tests', 'modo-maniobra');

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
    if (!h) throw new Error('window.__rafaqBle no disponible (¿BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-412.png`) });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-360.png`) });
  await page.setViewportSize({ width: 412, height: 915 });
}

// ── SNAP/LOCK de la rueda (fix Raf 2026-06-18): al SOLTAR a mitad de camino, la rueda DEBE lockear EXACTO
//    en la celda más cercana (no quedar descansando entre dos valores). En react-native-web el snapToInterval
//    NO snapea → el lock es JS-driven (debounce de settle). El e2e ejercita el path real: encuentra el
//    contenedor scrolleable de RN-web bajo el testID de la rueda, lee el alto de celda (cell), posiciona el
//    scrollTop a un offset a MITAD de camino (cell*2,7 — NO múltiplo de cell) + dispara `scroll`, y verifica
//    que el lock asentó el scrollTop en un MÚLTIPLO EXACTO de cell.

/** Alto de celda de la rueda bajo `testID`. Robusto a los transforms de escala del drum: el scroller mide
 *  `clientHeight = 5 celdas visibles` (listHeight = $wheelCell × 5) → cell = clientHeight / 5. No depende
 *  del bounding-rect de las celdas (que la escala distorsiona). */
async function wheelGeometry(page: Page, testId: string): Promise<{ cell: number }> {
  return page.evaluate((id) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!root) throw new Error(`rueda ${id} no encontrada`);
    const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    const scroller = all.find((el) => {
      const st = getComputedStyle(el);
      return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 2;
    });
    if (!scroller) throw new Error(`scroller de ${id} no encontrado`);
    // 5 celdas visibles (CONTEXT_CELLS*2+1). clientHeight = listHeight = cell*5.
    const cell = Math.round(scroller.clientHeight / 5);
    return { cell };
  }, testId);
}

/** Posiciona el scroller de la rueda `testID` en `offset` px (vía scrollTop + evento scroll de RN-web) y
 *  devuelve el scrollTop REAL aplicado (rn-web clampa al contenido). Reusa el idiom de scrollListToBottom. */
async function setWheelOffset(page: Page, testId: string, offset: number): Promise<number> {
  return page.evaluate(
    ({ id, y }) => {
      const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!root) throw new Error(`rueda ${id} no encontrada`);
      let node: HTMLElement | null = root;
      // Buscá el descendiente con overflow-y scrolleable (el ScrollView de RN-web).
      const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
      const scroller = all.find((el) => {
        const st = getComputedStyle(el);
        return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 2;
      });
      node = scroller ?? null;
      if (!node) throw new Error(`scroller de ${id} no encontrado`);
      node.scrollTop = y;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
      return node.scrollTop;
    },
    { id: testId, y: offset },
  );
}

/** Lee el scrollTop ACTUAL del scroller de la rueda `testID`. */
async function getWheelScrollTop(page: Page, testId: string): Promise<number> {
  return page.evaluate((id) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!root) throw new Error(`rueda ${id} no encontrada`);
    const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    const scroller = all.find((el) => {
      const st = getComputedStyle(el);
      return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 2;
    });
    return scroller ? scroller.scrollTop : NaN;
  }, testId);
}

/** Espera a que el scrollTop de la rueda `testID` quede LOCKEADO (múltiplo exacto de `cell`, ±1px de
 *  sub-píxel) y lo devuelve. Falla si no lockea en `timeout`. */
async function expectWheelLocked(page: Page, testId: string, cell: number, timeout = 4000): Promise<number> {
  const start = Date.now();
  let top = await getWheelScrollTop(page, testId);
  while (Date.now() - start < timeout) {
    top = await getWheelScrollTop(page, testId);
    const rem = top % cell;
    const lockedRem = Math.min(rem, cell - rem); // distancia al múltiplo más cercano
    if (Number.isFinite(top) && lockedRem <= 1) return top;
    await page.waitForTimeout(80);
  }
  throw new Error(`la rueda ${testId} no lockeó: scrollTop=${top}, cell=${cell}, resto=${top % cell}`);
}

/**
 * Arranca una jornada de manga tildando SOLO la circunferencia escrotal (seedeada ENABLED en cría, R14.18) y
 * aterriza en la identificación. Una sola maniobra ⇒ el frame muestra "· 1 de 1" y el paso de la rueda directo.
 */
async function startSessionCE(page: Page): Promise<void> {
  await page.goto('/maniobra/jornada');
  await expect(page.getByText('Elegí el rodeo', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Elegir rodeo / }).first().click();
  await expect(page.getByTestId('maneuver-reorder-list')).toBeVisible({ timeout: 20_000 });
  // La CE aparece en el pool (data_key seedeado enabled en cría → capa 1 la ofrece). Su presencia prueba que
  // el rodeo_data_config bajó al SQLite local. Dwell para que el sync se asiente antes de la carga rápida.
  await expect(page.getByTestId('pool-row-circunferencia_escrotal')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await page.getByTestId('pool-row-circunferencia_escrotal').click();
  await expect(page.getByTestId('selected-row-0')).toBeVisible();
  await page.getByRole('button', { name: /^Continuar/ }).click();
  await expect(page.getByRole('button', { name: 'Arrancar jornada', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Arrancar jornada', exact: true }).click();
  await page.evaluate(() => {
    const h = (window as unknown as { __rafaqBle?: { connectMock: () => void } }).__rafaqBle;
    h?.connectMock();
  });
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── A+B+C: TORITO entero → CE aparece → rueda + campo editable + edad prellenada → scrotal_measurements ──
test('CE en un TORITO entero (cría): aparece en la secuencia → rueda + campo editable + edad → server', async ({ page }) => {
  test.setTimeout(220_000);
  const user = await createTestUser('m6c1-toro');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CE', {
    rodeoName: 'Cría toros',
    rodeoRawName: true,
  });
  const eid = makeEid();
  const visual = '0608';
  // Torito ENTERO con fecha de nacimiento → la edad se prellena (≈ meses desde la fecha). ~26 meses atrás.
  const birthDate = new Date(Date.now() - 26 * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    tag: eid,
    visualAlt: visual,
    sex: 'male',
    categoryCode: 'torito',
    isCastrated: false,
    birthDate,
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionCE(page);

  // Bastonazo → found → auto-avance a la carga rápida con la CE (· 1 de 1).
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Circunferencia escrotal', { exact: true }).first()).toBeVisible();

  // La rueda de CE + el campo editable + la pill de edad están presentes (R14.5/R14.6).
  await expect(page.getByTestId('ce-wheel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ce-input')).toBeVisible();
  // Edad PRELLENADA de birth_date (R14.6): la pill muestra "≈ N meses" (no "Edad sin definir").
  const ageControl = page.getByTestId('age-control');
  await expect(ageControl).toBeVisible();
  await expect(ageControl.getByText(/≈\s*\d+\s*mes/)).toBeVisible();
  await shot(page, 'ce-flujo-reposo');

  // CAMPO EDITABLE + TECLADO (R14.5 sub-cláusula): tipear "38,5" a mano → la rueda salta a ese valor.
  const input = page.getByTestId('ce-input');
  await input.click();
  await input.fill('38,5');
  await shot(page, 'ce-flujo-input');
  // Commit del campo SIN tocar la rueda: Enter dispara onSubmitEditing (returnKeyType done) → parseCmInput
  // valida/snapea (38,5 ∈ grilla) y mueve la rueda al valor. Tocar la rueda para blurr la movería (es scroll).
  await input.press('Enter');
  // El display ya NO está en foco → muestra el valor canónico formateado es-AR "38,5".
  await expect(page.getByTestId('ce-input')).toHaveValue('38,5');

  // Confirmar la CE → resumen.
  await page.getByTestId('confirm-step').click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 15_000 });
  // El resumen muestra la maniobra + el valor legible es-AR ("38,5 cm").
  await expect(page.getByText(/38,5\s*cm/).first()).toBeVisible();

  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ORÁCULO SERVER (R14.9/R14.10): la CE aterrizó en scrotal_measurements con session_id + establishment_id
  // y recorded_by FORZADOS server-side (el cliente nunca los mandó). La edad quedó como snapshot.
  const m = await waitForServerScrotalMeasurement(profileId, 38.5);
  expect(m.sessionId).toBeTruthy();
  expect(m.establishmentId).toBe(establishmentId);
  expect(m.recordedBy).toBe(user.id);
  expect(m.ageMonths).not.toBeNull(); // edad prellenada de birth_date → snapshot no nulo
});

// ── A: aplicabilidad — la CE se SALTEA en una HEMBRA y un TERNERO (R14.2/R14.4) ──
test('CE NO aparece para una HEMBRA ni un TERNERO (se saltea, R14.2/R14.4)', async ({ page }) => {
  test.setTimeout(200_000);
  const user = await createTestUser('m6c1-skip');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CE Skip', {
    rodeoName: 'Cría mixto',
    rodeoRawName: true,
  });
  // Hembra (vaquillona) + ternero (macho) — a ninguno aplica la CE.
  const cowEid = makeEid();
  const cowVisual = '0701';
  await seedAnimal(establishmentId, rodeoId, { tag: cowEid, visualAlt: cowVisual, sex: 'female', categoryCode: 'vaquillona' });
  const calfEid = makeEid();
  const calfVisual = '0702';
  // Ternero macho: el espejo client-side recomputa la categoría por sexo+birth_date+is_castrated (RT2.20), NO
  // por el category_code guardado. Un macho sin fecha caería a 'torito' (default conservador) y la CE aplicaría
  // → para un TERNERO real hay que darle un birth_date reciente (<1 año) → el espejo lo computa 'ternero'.
  const calfBirthDate = new Date(Date.now() - 4 * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await seedAnimal(establishmentId, rodeoId, {
    tag: calfEid, visualAlt: calfVisual, sex: 'male', categoryCode: 'ternero', birthDate: calfBirthDate,
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(cowVisual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionCE(page);

  // HEMBRA: ninguna maniobra de la jornada (solo CE) le aplica → secuencia vacía → "Sin maniobras para este animal".
  await bastonazo(page, cowEid);
  await expect(page.getByText('Sin maniobras para este animal', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // TERNERO (macho pero cría al pie, NO entero adulto): la CE también se saltea → secuencia vacía.
  await bastonazo(page, calfEid);
  await expect(page.getByText('Sin maniobras para este animal', { exact: true })).toBeVisible({ timeout: 30_000 });
});

// ── A: aplicabilidad — la CE se SALTEA en un CASTRADO (novillo); APARECE con castración DESCONOCIDA (R14.3) ──
test('CE: castrado (novillo) la saltea; castración desconocida en un torito la INCLUYE (R14.3)', async ({ page }) => {
  test.setTimeout(200_000);
  const user = await createTestUser('m6c1-cast');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CE Cast', {
    rodeoName: 'Cría castrados',
    rodeoRawName: true,
  });
  // CASTRADO: is_castrated=true → el espejo lo recategoriza a novillo → CE se saltea.
  const steerEid = makeEid();
  const steerVisual = '0801';
  await seedAnimal(establishmentId, rodeoId, {
    tag: steerEid, visualAlt: steerVisual, sex: 'male', categoryCode: 'novillo', isCastrated: true,
  });
  // ENTERO sin fecha de nacimiento (la edad NO se prellena → "Edad sin definir", R14.7) → CE aparece.
  const bullEid = makeEid();
  const bullVisual = '0802';
  const bullProfileId = await seedAnimal(establishmentId, rodeoId, {
    tag: bullEid, visualAlt: bullVisual, sex: 'male', categoryCode: 'toro', isCastrated: false,
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(steerVisual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionCE(page);

  // CASTRADO (novillo): la CE se saltea → secuencia vacía.
  await bastonazo(page, steerEid);
  await expect(page.getByText('Sin maniobras para este animal', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();
  await expect(page.getByText('Acercá el bastón al animal', { exact: true })).toBeVisible({ timeout: 15_000 });

  // ENTERO sin fecha: la CE APARECE; la edad arranca "sin definir" (R14.7) y se puede AJUSTAR por la rueda.
  await bastonazo(page, bullEid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ce-wheel')).toBeVisible({ timeout: 15_000 });
  // Sin birth_date → la pill de edad arranca "Edad sin definir".
  await expect(page.getByTestId('age-control').getByText('Edad sin definir', { exact: true })).toBeVisible();

  // AJUSTAR la edad (R14.7): abrir el sheet → "Usar esta edad" fija un valor de la rueda de meses.
  await page.getByTestId('age-control').click();
  await expect(page.getByText('Edad del toro', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('age-wheel')).toBeVisible();
  await page.getByTestId('age-confirm').click();
  // Tras fijarla, la pill ya NO dice "sin definir" (muestra "≈ N meses").
  await expect(page.getByTestId('age-control').getByText(/≈\s*\d+\s*mes/)).toBeVisible({ timeout: 10_000 });

  // Confirmar con el valor default de la rueda (36) → server. age_months snapshot del ajuste (no nulo).
  await page.getByTestId('confirm-step').click();
  await expect(page.getByText('Revisá la carga', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Confirmar y pasar al siguiente animal' }).click();

  const m = await waitForServerScrotalMeasurement(bullProfileId, 36);
  expect(m.sessionId).toBeTruthy();
  expect(m.establishmentId).toBe(establishmentId);
  expect(m.ageMonths).not.toBeNull(); // la edad ajustada quedó como snapshot
});

// ── SNAP/LOCK al soltar a MITAD de camino (fix Raf 2026-06-18, R14.5/R14.7) ──
// La rueda NO puede quedar descansando entre dos valores: al detenerse a mitad de camino, lockea EXACTO en
// la celda más cercana. Se verifica en la rueda de CE y en la de EDAD (mismo WheelPicker → un solo fix).
test('SNAP: la rueda de CE y la de EDAD lockean EXACTO al soltar a mitad de camino (R14.5/R14.7)', async ({ page }) => {
  test.setTimeout(200_000);
  const user = await createTestUser('m6-snap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CE Snap', {
    rodeoName: 'Cría snap',
    rodeoRawName: true,
  });
  const eid = makeEid();
  const visual = '0905';
  // Torito entero CON fecha → la CE aparece y la edad se prellena (para poder ajustar la rueda de meses).
  const birthDate = new Date(Date.now() - 26 * 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  await seedAnimal(establishmentId, rodeoId, {
    tag: eid, visualAlt: visual, sex: 'male', categoryCode: 'torito', isCastrated: false, birthDate,
  });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await expect(page.getByText(visual, { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await startSessionCE(page);
  await bastonazo(page, eid);
  await expect(page.getByText('· 1 de 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ce-wheel')).toBeVisible({ timeout: 15_000 });

  // ── RUEDA DE CE ──
  const { cell } = await wheelGeometry(page, 'ce-wheel');
  expect(cell).toBeGreaterThan(40); // sanity: el alto de celda es el del token $wheelCell.

  // Soltar a MITAD de camino: offset = cell*2,7 (NO múltiplo de cell). El índice más cercano es 3 → valor
  // de grilla = 20 + 3*0,5 = 21,5 cm (es-AR "21,5"). El requestAnimationFrame del scrollTo(animated) + el
  // debounce de settle hacen el lock; esperamos a que el scrollTop quede en múltiplo exacto de cell.
  await setWheelOffset(page, 'ce-wheel', cell * 2.7);
  const lockedCe = await expectWheelLocked(page, 'ce-wheel', cell);
  // (a) LOCKEÓ: scrollTop es múltiplo exacto de cell (la rueda NO quedó entre dos valores).
  const ceRem = lockedCe % cell;
  expect(Math.min(ceRem, cell - ceRem)).toBeLessThanOrEqual(1);
  // (b) Valor centrado = celda más cercana al punto donde soltó: índice 3 → "21,5" cm en el campo espejo.
  expect(Math.round(lockedCe / cell)).toBe(3);
  await expect(page.getByTestId('ce-input')).toHaveValue('21,5');
  await shot(page, 'ce-snap-lock');

  // Repetir con un offset que cae más cerca de la celda DE ABAJO (cell*2,4 → índice 2 → 21,0 "21").
  await setWheelOffset(page, 'ce-wheel', cell * 2.4);
  const lockedCe2 = await expectWheelLocked(page, 'ce-wheel', cell);
  expect(Math.round(lockedCe2 / cell)).toBe(2);
  await expect(page.getByTestId('ce-input')).toHaveValue('21');

  // ── RUEDA DE EDAD (mismo WheelPicker, mismo fix) ──
  await page.getByTestId('age-control').click();
  await expect(page.getByText('Edad del toro', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('age-wheel')).toBeVisible();
  const { cell: ageCell } = await wheelGeometry(page, 'age-wheel');

  // Soltar a mitad de camino en la rueda de meses: offset = ageCell*5,7 → índice 6 → 6+6 = 12 meses.
  await setWheelOffset(page, 'age-wheel', ageCell * 5.7);
  const lockedAge = await expectWheelLocked(page, 'age-wheel', ageCell);
  const ageRem = lockedAge % ageCell;
  expect(Math.min(ageRem, ageCell - ageRem)).toBeLessThanOrEqual(1); // lockeó exacto
  expect(Math.round(lockedAge / ageCell)).toBe(6); // celda más cercana
  // El encabezado live del sheet muestra el valor centrado en es-AR ("12 meses al medir").
  await expect(page.getByText(/12\s*meses al medir/)).toBeVisible({ timeout: 10_000 });
  await shot(page, 'age-snap-lock');
});
