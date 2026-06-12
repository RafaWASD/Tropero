// e2e/operaciones-castracion.spec.ts — red de regresión END-TO-END de la CASTRACIÓN MASIVA (spec 10
// chunk UI-D, T-UI.9 / R11.x, R13.1, R13.5, R13.7, R10.6).
//
// Corre contra el export ESTÁTICO de prod (:8099) + Supabase remoto + PowerSync (mismo patrón que
// animals.spec.ts/events.spec.ts). Estado de partida: usuario con teléfono (saltea gate R3.8) + 1 campo
// con 1 rodeo de cría (vacunacion/destete enabled por default) + varios machos sembrados:
//   - 2 terneros COMUNES (ternero, future_bull=false): pre-tildados por default (R11.3).
//   - 1 ternero ⭐ FUTURO TORITO (ternero, future_bull=true): NO pre-tildado (R11.3); al tildarlo,
//     su fila se RESALTA sin modal (R11.6) y el bottom-sheet avisa "1 futuro torito incluido" (R11.8).
//   - 1 TORITO adulto (1–2 años, entero): NO pre-tildado (adultos arrancan sin tildar, R11.3). Lo
//     tildamos a mano para ejercitar la TRANSICIÓN real (torito → novillito, R13.5) — un `ternero`
//     castrado NO transiciona (sigue ternero, 0062), así que la transición visible se prueba sobre el adulto.
//
// Flujo: home → card del rodeo → vista de grupo → "Castrar" → pantalla de selección (asertamos los
// defaults) → tildar el ⭐ + el torito → CTA con el número → bottom-sheet (desglose + ⚠ + copy reversible,
// y que NO dice "no se puede deshacer") → confirmar → el torito queda NOVILLITO + observación "Castrado"
// en su timeline → REVERT desde la ficha (Castrado → No) → vuelve a TORITO + observación "Corrección…".
//
// TEST-ONLY: no se toca producto. El espejo C6 (offline) refleja la transición al instante (R10.6); la
// observación se inserta en animal_events local (R13.7) → aparece en el timeline sin esperar el sync-down.
// Datos namespaced (RUN_TAG); cleanup en afterAll + global-teardown. Aserta SOLO sobre datos propios.

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

/** birth_date ISO de hace ~`months` meses. ternero = <12m; torito = 12–24m; toro = ≥24m (corte de 2 años). */
function birthDateMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

test('castración masiva: defaults → ⭐ resaltado → bottom-sheet reversible → novillito + observación → revert', async ({
  page,
}) => {
  const user = await createTestUser('castracion');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Castracion');

  // Terneros (machos ~6 meses, enteros). Los 2 comunes se pre-tildan; el ⭐ NO.
  const calfBirth = birthDateMonthsAgo(6); // < 1 año → categoría ternero
  const idvCalf1 = `C1${RUN_TAG.slice(-6)}`;
  const idvCalf2 = `C2${RUN_TAG.slice(-6)}`;
  const idvStar = `STAR${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvCalf1, sex: 'male', categoryCode: 'ternero', birthDate: calfBirth,
  });
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvCalf2, sex: 'male', categoryCode: 'ternero', birthDate: calfBirth,
  });
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvStar, sex: 'male', categoryCode: 'ternero', birthDate: calfBirth, futureBull: true,
  });
  // Torito adulto (~18 meses, entero) → castrarlo TRANSICIONA a novillito (R13.5). NO pre-tildado.
  const idvBull = `BULL${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv: idvBull, sex: 'male', categoryCode: 'torito', birthDate: birthDateMonthsAgo(18),
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Inicio rodeo-céntrico → vista de grupo del rodeo sembrado.
  await gotoRodeoGroup(page, `${RUN_TAG} Rodeo general`);

  // Vista de grupo → "Castrar" → pantalla de selección.
  await page.getByRole('button', { name: 'Castrar', exact: true }).click();

  // Cada fila es un AnimalRow con checkbox → role="checkbox" + aria-label (incluye el idv).
  // Esperamos a que los animales bajen por first-sync y se arme la selección (la 1ra fila aparece).
  const calf1 = page.getByRole('checkbox', { name: new RegExp(idvCalf1) });
  const star = page.getByRole('checkbox', { name: new RegExp(idvStar) });
  const bull = page.getByRole('checkbox', { name: new RegExp(idvBull) });
  await expect(calf1).toBeVisible({ timeout: 30_000 });
  await expect(bull).toBeVisible();

  // DEFAULTS (R11.3): el estado de selección se verifica por el CONTADOR + el CTA en vivo (la señal
  // user-facing de la selección). Al abrir, SOLO los 2 terneros COMUNES están pre-tildados (el ⭐ y el
  // torito adulto NO) → contador inicial = 2. (Nota a11y: el aria-checked del checkbox NO lo emite RN-web
  // sobre el Pressable; el contador + el resaltado ⭐ son la verificación funcional — ver progress.)
  await expect(page.getByText('2 seleccionados', { exact: true })).toBeVisible({ timeout: 20_000 });
  // El CTA fijo abajo refleja el número vivo (R11.7).
  await expect(page.getByRole('button', { name: 'Castrar 2 animales', exact: true })).toBeVisible();

  // ── Tildar el ternero ⭐ → resaltado SIN modal (R11.6) + el contador sube de 2 a 3. ───────────────
  // Que el contador suba (no baje ni se quede) PRUEBA que el ⭐ NO estaba pre-tildado (default R11.3).
  await star.click();
  await expect(page.getByText('3 seleccionados', { exact: true })).toBeVisible();
  // No se interpone NINGÚN modal de advertencia al tildar (R11.6): la advertencia agregada NO aparece
  // todavía (recién en el bottom-sheet, R11.6/R11.8).
  await expect(page.getByText(/futuro torito incluido/)).toHaveCount(0);

  // ── Tildar el torito adulto → 4 seleccionados (este es el que TRANSICIONA a novillito). ────────
  // Que suba de 3 a 4 PRUEBA que el torito adulto tampoco estaba pre-tildado (default R11.3: adultos sin tildar).
  await bull.click();
  await expect(page.getByText('4 seleccionados', { exact: true })).toBeVisible();

  // ── CTA con el número vivo → bottom-sheet de confirmación (R11.7/R11.8). ───────────────────────
  // El CTA fijo de la pantalla abre el sheet. (Hay UN solo "Castrar 4 animales" hasta abrir el sheet.)
  await page.getByRole('button', { name: 'Castrar 4 animales', exact: true }).first().click();

  // Bottom-sheet: título + desglose + ⚠ futuro torito + copy reversible.
  await expect(page.getByText('Confirmar castración', { exact: true })).toBeVisible({ timeout: 15_000 });
  // ⚠ "1 futuro torito incluido" (R11.8: el ⭐ tildado se avisa acá, no antes).
  await expect(page.getByText('1 futuro torito incluido', { exact: true })).toBeVisible();
  // Copy REVERSIBLE obligatorio (R11.8) — y PROHIBIDO el lenguaje amenazante.
  await expect(
    page.getByText('Podés corregirlo después desde la ficha de cada animal.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/no se puede deshacer/i)).toHaveCount(0);

  // Confirmar la masiva (el CTA del sheet repite el número). Con el sheet abierto hay DOS "Castrar 4
  // animales" (el de la pantalla detrás + el del sheet, que se renderiza al final del árbol) → el del
  // sheet es el último.
  await page.getByRole('button', { name: 'Castrar 4 animales', exact: true }).last().click();

  // Panel de progreso → "4 animales listos" (encolado local, offline-first).
  await expect(page.getByText('4 animales listos', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Listo', exact: true }).click();

  // ── Verificar la TRANSICIÓN + la OBSERVACIÓN en la ficha del TORITO castrado. ───────────────────
  // Al tocar "Listo" volvemos a la VISTA DE GRUPO (backOr → router.back() pop-ea la selección), que se
  // re-carga al enfocar (useGroupView) → la fila del torito ya muestra Novillito. La abrimos desde ahí.
  await openAnimalFichaFromGroup(page, idvBull);

  // R13.5 + R10.6: el espejo C6 (offline) muestra la categoría recalculada → Novillito (torito → novillito).
  await expect(page.getByText('Novillito', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  // R13.7: la observación automática aparece en el timeline (animal_events local). El nodo "Observación"
  // (título del TimelineEvent) existe SOLO en el timeline, no en la sección Manejo → su presencia prueba que
  // se creó una observación. Su detalle "Castrado" aparece DOS veces en la ficha (la label de Manejo +
  // el detalle de la observación) → asertamos ≥2 ocurrencias: la 2da es la del timeline.
  await expect(page.getByText('Observación', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Castrado', { exact: true })).toHaveCount(2);

  // ── REVERT desde la ficha: Castrado → No (R13.1). ──────────────────────────────────────────────
  // La sección "Manejo" (solo machos) muestra "Castrado: Sí" + "Cambiar".
  await expect(page.getByText('Manejo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Marcar como no castrado', exact: true }).click();
  // Confirmación inline que anticipa el recálculo (espejo C6): "La categoría se recalcula: Torito".
  await expect(page.getByText(/La categoría se recalcula: Torito/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();

  // Tras el revert: vuelve a TORITO (recompute simétrico, R13.5) + observación de corrección (R13.7).
  await expect(page.getByText('Torito', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText('Corrección: marcado como no castrado', { exact: true }).first(),
  ).toBeVisible();
});

// ─── Helpers locales ──────────────────────────────────────────────────────────────────────────

/**
 * Abre la ficha de un animal por su idv desde la VISTA DE GRUPO (donde aterrizamos tras el back de la
 * masiva). La fila del grupo (AnimalRow compacto) es role="button" con el idv en su nombre accesible →
 * la tocamos → ficha. Esperamos a que la lista re-cargue (useFocusEffect) antes de buscar la fila.
 */
async function openAnimalFichaFromGroup(page: import('@playwright/test').Page, idv: string): Promise<void> {
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  // Ancla de la ficha: el bloque "Historial".
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
}
