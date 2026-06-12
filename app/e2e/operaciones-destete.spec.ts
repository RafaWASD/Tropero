// e2e/operaciones-destete.spec.ts — red de regresión END-TO-END del DESTETE MASIVO (spec 10 chunk UI-D,
// T-UI.10 / R11.4, R3.2, R3.5, R5.5, R5.6).
//
// Corre contra el export ESTÁTICO de prod (:8099) + Supabase remoto + PowerSync. Estado de partida:
// usuario con teléfono + 1 campo con 1 rodeo de cría (destete enabled por default) + terneros/as
// sembrados:
//   - 2 TERNEROS machos (representan los mellizos — R3.5: se desteta el ternero, no el parto → cada uno
//     genera SU propio weaning). Sin destete previo → pre-tildados (R11.4). Al destetar → TORITO (R5.5).
//   - 1 TERNERA hembra, sin destete previo → pre-tildada. Al destetar → VAQUILLONA (R5.5).
//   - 1 TERNERA con category_override=true: aparece pre-tildada igual (R11.4) pero el bottom-sheet AVISA
//     "1 animal tiene la categoría fijada manualmente…" (R5.6) y, al confirmar, su weaning se aplica pero
//     la categoría NO transiciona (sigue Ternera — el override manda, 0063).
//
// Flujo: home → card del rodeo → vista de grupo → "Destetar" → selección (todos pre-tildados, R11.4) →
// CTA → bottom-sheet (aviso de override, R5.6) → confirmar → transiciones visibles (vaquillona/torito) +
// el animal con override avisado y SIN transición.
//
// TEST-ONLY: la transición la hace el server (0062/0063); el espejo C6 la refleja offline (R5.5/R10.6).
// Datos namespaced (RUN_TAG); cleanup en afterAll. Aserta SOLO sobre datos propios.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoRodeoGroup } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

/** birth_date ISO de hace ~`months` meses. ternero/a = < 12 meses (sin destete previo). */
function birthDateMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

test('destete masivo: todos pre-tildados → mellizos 1 weaning c/u → transición visible → override sin transición', async ({
  page,
}) => {
  const user = await createTestUser('destete');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Destete');

  const calfBirth = birthDateMonthsAgo(7); // < 1 año → ternero/a sin destete

  // Mellizos: 2 terneros machos (R3.5: cada uno se desteta por separado → cada uno → torito).
  const idvTwin1 = `T1${RUN_TAG.slice(-6)}`;
  const idvTwin2 = `T2${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvTwin1, sex: 'male', categoryCode: 'ternero', birthDate: calfBirth,
  });
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvTwin2, sex: 'male', categoryCode: 'ternero', birthDate: calfBirth,
  });
  // Ternera sin override → al destetar → vaquillona.
  const idvHeifer = `H1${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvHeifer, sex: 'female', categoryCode: 'ternera', birthDate: calfBirth,
  });
  // Ternera con category_override → el weaning se aplica pero NO transiciona (sigue Ternera, R5.6).
  const idvOverride = `OV1${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvOverride, sex: 'female', categoryCode: 'ternera', birthDate: calfBirth, categoryOverride: true,
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Inicio rodeo-céntrico → vista de grupo → "Destetar".
  await gotoRodeoGroup(page, `${RUN_TAG} Rodeo general`);
  await page.getByRole('button', { name: 'Destetar', exact: true }).click();

  // La selección de destete agrupa por categoría (Terneros / Terneras). Esperamos a que bajen por sync
  // (las 4 filas aparecen). R11.4: TODOS los terneros/as arrancan PRE-TILDADOS → contador = 4 (la señal
  // user-facing de la selección; el aria-checked NO lo emite RN-web sobre el Pressable — ver progress).
  const twin1 = page.getByRole('checkbox', { name: new RegExp(idvTwin1) });
  const twin2 = page.getByRole('checkbox', { name: new RegExp(idvTwin2) });
  const heifer = page.getByRole('checkbox', { name: new RegExp(idvHeifer) });
  const override = page.getByRole('checkbox', { name: new RegExp(idvOverride) });
  await expect(twin1).toBeVisible({ timeout: 30_000 });
  await expect(twin2).toBeVisible();
  await expect(heifer).toBeVisible();
  await expect(override).toBeVisible();

  // Los 4 terneros/as PRE-TILDADOS (R11.4) → contador = 4 + CTA con el número vivo.
  await expect(page.getByText('4 seleccionados', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Destetar 4 animales', exact: true }).first().click();

  // Bottom-sheet de destete: aviso de override (R5.6) + copy reversible (R11.8).
  await expect(page.getByText('Confirmar destete', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText('1 animal tiene la categoría fijada manualmente y no va a cambiar de categoría.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Podés corregirlo después desde la ficha de cada animal.', { exact: true }),
  ).toBeVisible();

  // Confirmar (NO revertimos el override → debe quedar SIN transición). Con el sheet abierto hay DOS
  // "Destetar 4 animales" (la pantalla detrás + el sheet, último en el árbol) → el del sheet es el último.
  await page.getByRole('button', { name: 'Destetar 4 animales', exact: true }).last().click();

  // Progreso → "4 animales listos" → Listo. El back nos devuelve a la VISTA DE GRUPO (no a home), que se
  // re-carga al enfocar (useGroupView) → las filas ya muestran las categorías recalculadas (espejo C6).
  await expect(page.getByText('4 animales listos', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Listo', exact: true }).click();

  // ── Transiciones visibles en las filas del grupo (R5.5 / R10.6, espejo C6 offline). ───────────────
  // El nombre accesible de cada fila compacta es "{categoría}, {idv}, {edad}…" → asertamos categoría+idv.
  // Ternera SIN override → VAQUILLONA.
  await expect(
    page.getByRole('button', { name: new RegExp(`Vaquillona.*${idvHeifer}`) }),
  ).toBeVisible({ timeout: 20_000 });
  // Mellizos (R3.5: cada uno destetado por separado → cada uno) → TORITO.
  await expect(page.getByRole('button', { name: new RegExp(`Torito.*${idvTwin1}`) })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`Torito.*${idvTwin2}`) })).toBeVisible();
  // Ternera con OVERRIDE → SIGUE Ternera (el override bloquea la transición, R5.6) — el weaning igual se aplicó.
  await expect(page.getByRole('button', { name: new RegExp(`Ternera.*${idvOverride}`) })).toBeVisible();

  // R3.5: cada mellizo generó SU PROPIO weaning. Abrimos la ficha de un mellizo (desde la fila del grupo)
  // y verificamos que el evento "Destete" está en su timeline (prueba directa del evento por ternero).
  await page.getByRole('button', { name: new RegExp(`Torito.*${idvTwin1}`) }).click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Destete', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Torito', { exact: true }).first()).toBeVisible();
  // Volvemos a la vista de grupo (router.back de la ficha) para abrir el animal con override.
  await page.getByRole('button', { name: 'Volver', exact: true }).first().click();

  // El animal con override: su weaning SÍ se aplicó (Destete en el timeline, R5.6 "la mutación igual se
  // aplica") pero la categoría NO transicionó (sigue Ternera + "Categoría fijada manualmente" — el
  // override sigue puesto, no se revirtió). Lo abrimos desde su fila del grupo.
  await page.getByRole('button', { name: new RegExp(`Ternera.*${idvOverride}`) }).click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Destete', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toBeVisible();
  await expect(page.getByText('Ternera', { exact: true }).first()).toBeVisible();
});

// ─── FIX 1 (Raf 2026-06-12): la acción "Destetar" se ofrece solo si HAY CANDIDATOS, no solo por config ──
//
// Un rodeo de cría tiene `destete` habilitado por config (default 0018) PERO si no hay ningún ternero/a sin
// destetar, NO debe ofrecer "Destetar" (abriría una pantalla de selección vacía). Sembramos un rodeo con
// SOLO un macho ADULTO (torito, entero): es candidato a CASTRACIÓN (→ "Castrar" sí aparece, sirve de ancla)
// pero NO es candidato a destete (solo ternero/ternera lo son) → "Destetar" NO debe aparecer aunque la
// config lo habilite. Vacunar tampoco se gatea por candidatos (aplica a todos los activos) → sí aparece.
test('FIX 1: un rodeo sin terneros NO ofrece "Destetar" (gating por candidatos, no solo config)', async ({
  page,
}) => {
  const user = await createTestUser('gating-destete');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Sin Terneros');

  // SOLO un torito adulto (entero): candidato a castración, NO a destete. Sin ningún ternero/a en el grupo.
  const idvBull = `NB${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvBull, sex: 'male', categoryCode: 'torito', birthDate: birthDateMonthsAgo(18),
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Vista de grupo: gotoRodeoGroup ancla en "Castrar" (presente: hay un macho entero candidato → prueba
  // que el grupo cargó y que el gating por candidatos ofrece Castrar).
  await gotoRodeoGroup(page, `${RUN_TAG} Rodeo general`);

  // "Castrar" presente (candidato de castración) → confirma que las acciones se resolvieron con candidatos.
  await expect(page.getByRole('button', { name: 'Castrar', exact: true })).toBeVisible();
  // "Vacunar" presente (no se gatea por candidatos — aplica a todos los activos).
  await expect(page.getByRole('button', { name: 'Vacunar', exact: true })).toBeVisible();
  // FIX 1: "Destetar" AUSENTE aunque la config del rodeo de cría lo habilite — no hay terneros candidatos.
  await expect(page.getByRole('button', { name: 'Destetar', exact: true })).toHaveCount(0);
});
