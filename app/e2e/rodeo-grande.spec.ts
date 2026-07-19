// e2e/rodeo-grande.spec.ts — red de regresión END-TO-END del delta «rodeo grande» de spec 10 (Fase 5,
// T-RG.28..33 / design §8). La vista de grupo (rodeo/[id] + lote/[id]) pasó a: query SCOPEADA al grupo +
// PAGINADA por keyset (scroll infinito) + COUNT real + buscador/chips in-grupo + FlatList virtualizada, y
// las acciones masivas + su gating operan sobre el GRUPO ENTERO (no la página). Estos 6 casos ejercen eso
// end-to-end contra el export de prod (:8099) + Supabase remoto + PowerSync.
//
// Los 6 casos (design §8):
//   1. T-RG.28 — rodeo > 1 página → scroll infinito carga más (RG1.2/1.3/1.5).
//   2. T-RG.29 — buscar DENTRO del grupo un animal más allá de la 1ª página (RG3.1/3.2 — set completo).
//   3. T-RG.30 — filtrar por categoría/sexo; combinar dos chips; ENSANCHAR re-puebla la lista (RG3.3/3.4/3.5 +
//      regresión del race de `useGroupView.refreshWindow` al ensanchar un filtro).
//   4. T-RG.31 — count real del grupo en el header (RG2.1/2.2), > filas de la 1ª página.
//   5. T-RG.32 — lote muestra TODOS sus miembros: regresión del bug "200-del-campo" (RG5.4).
//   6. T-RG.33 — acción masiva sobre el grupo entero: gating por COUNT del grupo + selección de candidatos
//      de más allá de la 1ª página (RG5.1/5.2/5.3).
//
// SEED (batch, sin tocar `e2e/helpers/admin.ts`): `batchSeedAnimals` es LOCAL a este spec y usa el `admin`
// (service_role) exportado. Inserta `animals` PRIMERO (el trigger 0079 denormaliza sex/tag/birth al insertar el
// perfil, leyendo `animals` por `animal_id`) y luego `animal_profiles` con `created_at` EXPLÍCITO — el keyset
// ordena por `(in_treatment DESC, created_at DESC, id DESC)` y un batch comparte `now()` (mismo timestamp de
// transacción para todas las filas), así que SIN `created_at` explícito el orden caería en `id DESC` (UUID
// random) = no-determinístico. Con `created_at` monótono controlo qué animales caen en la 1ª página y cuáles
// quedan afuera. DG8: seed REAL (default de la spec), NO reduzco `GROUP_PAGE_SIZE` (no toco producción).
//
// Datos namespaced (RUN_TAG); cleanup en afterAll + global-teardown. `idv` único por establishment (índice
// `(establishment_id, idv)`, 0020) → prefijo por-test + índice. Aserta SOLO sobre datos propios.

import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';

import { test, expect } from './helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedManagementGroup,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoLoteGroup, escapeRegExp } from './helpers/ui';

// El rodeo default de seedEstablishmentWithRodeo va namespaced: `${RUN_TAG} Rodeo general`.
const RODEO_NAME = `${RUN_TAG} Rodeo general`;

// `GROUP_PAGE_SIZE` de producción (group-page.ts). Los casos de paginación siembran > esto (seed real, DG8).
const GROUP_PAGE_SIZE = 60;

test.afterAll(async () => {
  await cleanupAll();
});

// Auto-aceptar cualquier confirmación destructiva (window.confirm en web) — defensivo (ningún caso confirma
// una masiva; T-RG.33 se detiene en la pantalla de selección).
test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
});

// ─── Seed batch (LOCAL — no toca admin.ts) ─────────────────────────────────────────────────────

type SeedSpec = {
  idv: string;
  sex: 'male' | 'female';
  /** code de categoría (default torito/vaquillona por sexo). */
  categoryCode?: string;
  /** created_at ISO EXPLÍCITO (controla el orden del keyset). Mayor = más nuevo = más arriba. */
  createdAt?: string;
  /** lote (management_group_id) del perfil (para el caso 5). */
  managementGroupId?: string;
};

/**
 * Siembra N animales activos en un rodeo en pocas round-trips (patrón `seedAnimal` pero batch): resuelve el
 * rodeo (species/system) + las categorías UNA vez, arma los payloads y hace inserts chunked. Devuelve nada
 * (los idvs los conoce el caller). `created_at` explícito por perfil (ver cabecera del archivo). Todo se borra
 * por CASCADE del establishment en cleanupAll.
 */
async function batchSeedAnimals(establishmentId: string, rodeoId: string, specs: SeedSpec[]): Promise<void> {
  const { data: rodeo, error: rErr } = await admin
    .from('rodeos')
    .select('species_id, system_id')
    .eq('id', rodeoId)
    .single();
  if (rErr || !rodeo) throw new Error(`batchSeedAnimals rodeo: ${rErr?.message ?? 'no rodeo'}`);
  const speciesId = rodeo.species_id as string;
  const systemId = rodeo.system_id as string;

  const codes = [...new Set(specs.map((s) => s.categoryCode ?? (s.sex === 'male' ? 'torito' : 'vaquillona')))];
  const { data: cats, error: cErr } = await admin
    .from('categories_by_system')
    .select('id, code')
    .eq('system_id', systemId)
    .in('code', codes);
  if (cErr || !cats) throw new Error(`batchSeedAnimals categories: ${cErr?.message ?? 'no cats'}`);
  const catId = new Map<string, string>(cats.map((c) => [c.code as string, c.id as string]));
  for (const code of codes) {
    if (!catId.has(code)) throw new Error(`batchSeedAnimals: categoría "${code}" no existe en system ${systemId}`);
  }

  const animalsPayload: Record<string, unknown>[] = [];
  const profilesPayload: Record<string, unknown>[] = [];
  for (const s of specs) {
    const animalId = randomUUID();
    animalsPayload.push({ id: animalId, sex: s.sex, species_id: speciesId });
    const code = s.categoryCode ?? (s.sex === 'male' ? 'torito' : 'vaquillona');
    const profile: Record<string, unknown> = {
      id: randomUUID(),
      animal_id: animalId,
      establishment_id: establishmentId,
      rodeo_id: rodeoId,
      category_id: catId.get(code),
      status: 'active',
      idv: s.idv,
    };
    if (s.createdAt) profile.created_at = s.createdAt;
    if (s.managementGroupId) profile.management_group_id = s.managementGroupId;
    profilesPayload.push(profile);
  }

  const CHUNK = 100;
  // `animals` PRIMERO (todas): el trigger 0079 denormaliza sex/tag/birth al insertar el perfil leyendo la fila
  // de `animals` por `animal_id` → debe existir antes.
  for (let i = 0; i < animalsPayload.length; i += CHUNK) {
    const { error } = await admin.from('animals').insert(animalsPayload.slice(i, i + CHUNK));
    if (error) throw new Error(`batchSeedAnimals animals insert: ${error.message}`);
  }
  for (let i = 0; i < profilesPayload.length; i += CHUNK) {
    const { error } = await admin.from('animal_profiles').insert(profilesPayload.slice(i, i + CHUNK));
    if (error) throw new Error(`batchSeedAnimals profiles insert: ${error.message}`);
  }
}

/** Prefijo de idv único por test (índice único es `(establishment_id, idv)`, así que basta con distinguir dentro del test). */
function idvPrefix(): string {
  return String(Date.now()).slice(-6);
}

/** idv de 9 chars: prefijo por-test + índice 3-dígitos. `idv(prefix, 1)` = "…001". */
function idvOf(prefix: string, i: number): string {
  return `${prefix}${String(i).padStart(3, '0')}`;
}

/** created_at ISO: base fija en el pasado + `sec` segundos. Mayor sec ⇒ más nuevo (más arriba en el keyset). */
function createdAtOf(baseMs: number, sec: number): string {
  return new Date(baseMs + sec * 1000).toISOString();
}

// ─── Navegación / scroll ────────────────────────────────────────────────────────────────────

/**
 * Abre la vista de grupo de un RODEO tocando su card en Inicio y aterriza cuando el buscador FIJO del grupo
 * está montado (RG4.4 — presente aunque los animales aún sincronicen; ancla robusta que NO depende de que se
 * ofrezca "Castrar", a diferencia de `gotoRodeoGroup` de ui.ts, porque algunos casos siembran solo hembras).
 */
async function openRodeoGroup(page: Page, rodeoName: string): Promise<void> {
  const card = page.getByRole('button', { name: new RegExp(escapeRegExp(rodeoName)) }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(
    page.getByLabel('Buscar animal en el grupo por caravana o número', { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

/** El buscador FIJO de la vista de grupo (RG3.1). */
function groupSearchInput(page: Page): Locator {
  return page.getByLabel('Buscar animal en el grupo por caravana o número', { exact: true });
}

/** Fila (AnimalRow compacto, role="button") de la vista de grupo por su idv (parte del nombre accesible). */
function groupRow(page: Page, idv: string): Locator {
  return page.getByRole('button', { name: new RegExp(escapeRegExp(idv)) });
}

/**
 * Scrollea al FONDO el contenedor scrolleable MÁS ALTO (la FlatList de la vista de grupo) y dispara el evento
 * `scroll` → RN-web corre su `onScroll` → `onEndReached` → `loadMore` (RG1.3). (Setear scrollTop no dispara el
 * evento por sí solo en RN-web; patrón de maniobra-custom-bugfix.)
 */
async function scrollGroupListToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    let best: HTMLElement | null = null;
    let bestH = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(el);
      const scrollable = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2;
      if (scrollable && el.scrollHeight > bestH) {
        best = el;
        bestH = el.scrollHeight;
      }
    }
    if (best) {
      best.scrollTop = best.scrollHeight;
      best.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  });
  await page.waitForTimeout(700); // dejar correr onEndReached → loadMore (fetch de la próxima página) + el render.
}

/** Scrollea la FlatList al fondo en un loop hasta que `row` sea visible (drive del scroll infinito, RG1.3/1.5). */
async function scrollUntilRowVisible(page: Page, row: Locator, tries = 14): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if ((await row.count()) > 0) {
      try {
        await row.first().scrollIntoViewIfNeeded({ timeout: 1500 });
      } catch {
        /* la fila puede estar en el buffer de virtualización pero aún no medible; seguimos scrolleando */
      }
      if (await row.first().isVisible()) return;
    }
    await scrollGroupListToBottom(page);
  }
  await expect(row.first()).toBeVisible({ timeout: 10_000 });
}

// ─── T-RG.28 — scroll infinito carga más (RG1.2/1.3/1.5) ────────────────────────────────────

test('T-RG.28 rodeo > 1 página → scroll infinito: un animal fuera de la 1ª página se vuelve visible al scrollear', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('rgscroll');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Scroll');

  // 65 hembras (> GROUP_PAGE_SIZE=60). created_at monótono: idv …001 = MÁS VIEJO (última fila, fuera de la 1ª
  // página); idv …065 = MÁS NUEVO (arriba, 1ª página). 1ª página = las 60 más nuevas (065..006); fuera de la 1ª
  // página = 005..001.
  const N = 65;
  const prefix = idvPrefix();
  const base = Date.now() - N * 1000 - 60_000;
  const specs: SeedSpec[] = [];
  for (let i = 1; i <= N; i++) {
    specs.push({ idv: idvOf(prefix, i), sex: 'female', categoryCode: 'vaquillona', createdAt: createdAtOf(base, i) });
  }
  await batchSeedAnimals(establishmentId, rodeoId, specs);

  const newestIdv = idvOf(prefix, N); // 1ª página (arriba)
  const oldestIdv = idvOf(prefix, 1); // fuera de la 1ª página (última fila)

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openRodeoGroup(page, RODEO_NAME);

  // 1ª página cargada: el animal MÁS NUEVO (arriba) es visible (ancla de que el first-sync + la 1ª página cargaron).
  await expect(groupRow(page, newestIdv).first()).toBeVisible({ timeout: 40_000 });

  // El MÁS VIEJO está FUERA de la 1ª página → todavía NO montado (paginación keyset: 60 filas). (Con virtualización
  // una fila off-screen tampoco está en el DOM; lo que importa es el ANTES/DESPUÉS: aparece SOLO tras scrollear.)
  await expect(groupRow(page, oldestIdv)).toHaveCount(0);

  // Scroll infinito: al llegar al fondo, `onEndReached` → `loadMore` anexa la 2ª página → el más viejo se vuelve visible.
  await scrollUntilRowVisible(page, groupRow(page, oldestIdv));
  await expect(groupRow(page, oldestIdv).first()).toBeVisible();
});

// ─── T-RG.29 — buscar dentro del grupo, más allá de la 1ª página (RG3.1/3.2) ────────────────

test('T-RG.29 buscar dentro del grupo: la caravana de un animal fuera de la 1ª página aparece (set completo)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('rgsearch');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Search');

  const N = 65;
  const prefix = idvPrefix();
  const base = Date.now() - N * 1000 - 60_000;
  const specs: SeedSpec[] = [];
  for (let i = 1; i <= N; i++) {
    specs.push({ idv: idvOf(prefix, i), sex: 'female', categoryCode: 'vaquillona', createdAt: createdAtOf(base, i) });
  }
  await batchSeedAnimals(establishmentId, rodeoId, specs);

  const newestIdv = idvOf(prefix, N); // 1ª página
  const targetIdv = idvOf(prefix, 3); // fuera de la 1ª página (fila ~63)

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openRodeoGroup(page, RODEO_NAME);

  // Sync + 1ª página cargadas (el más nuevo visible). El target (fuera de la 1ª página) NO está montado aún.
  await expect(groupRow(page, newestIdv).first()).toBeVisible({ timeout: 40_000 });
  await expect(groupRow(page, targetIdv)).toHaveCount(0);

  // Buscar la caravana del target → la búsqueda corre sobre el SET COMPLETO del grupo (no la página) → aparece.
  await groupSearchInput(page).fill(targetIdv);
  await expect(groupRow(page, targetIdv).first()).toBeVisible({ timeout: 20_000 });
  // La búsqueda NARROW-eó al grupo: el animal de la 1ª página (que no matchea) desaparece → probamos que se filtró
  // por la query scopeada (no que quedó la lista completa).
  await expect(groupRow(page, newestIdv)).toHaveCount(0);
});

// ─── T-RG.30 — filtrar por categoría/sexo; combinar dos chips (RG3.3/3.4/3.5) ───────────────

test('T-RG.30 filtrar por categoría y sexo; combinar dos chips; ENSANCHAR re-puebla (regresión del race)', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('rgfilter');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Filter');

  // 6 animales: 2 vaquillonas (hembra), 2 terneras (hembra), 2 toritos (macho). Categorías presentes:
  // Vaquillona / Ternera / Torito (chip categoría). Ambos sexos → chip sexo disponible (RG3.9).
  // `created_at` EXPLÍCITO monótono (el keyset ordena por `created_at DESC, id DESC`) → ORDEN CONTROLADO. De más
  // NUEVO a más VIEJO: tor1 > tor2 > ter1 > ter2 > vaq1 > vaq2. Esto vuelve la aserción de ENSANCHAR determinística
  // (ver el tramo (c)): las vaquillonas son las hembras MÁS VIEJAS → con el race (bug) quedarían FUERA de una
  // ventana truncada al tamaño angosto (limit=2 = las 2 hembras más nuevas = terneras); con el fix, re-pueblan.
  const prefix = idvPrefix();
  const base = Date.now() - 120_000;
  const vaq1 = idvOf(prefix, 11);
  const vaq2 = idvOf(prefix, 12);
  const ter1 = idvOf(prefix, 21);
  const ter2 = idvOf(prefix, 22);
  const tor1 = idvOf(prefix, 31);
  const tor2 = idvOf(prefix, 32);
  await batchSeedAnimals(establishmentId, rodeoId, [
    { idv: tor1, sex: 'male', categoryCode: 'torito', createdAt: createdAtOf(base, 60) }, // más nuevo
    { idv: tor2, sex: 'male', categoryCode: 'torito', createdAt: createdAtOf(base, 55) },
    { idv: ter1, sex: 'female', categoryCode: 'ternera', createdAt: createdAtOf(base, 50) },
    { idv: ter2, sex: 'female', categoryCode: 'ternera', createdAt: createdAtOf(base, 45) },
    { idv: vaq1, sex: 'female', categoryCode: 'vaquillona', createdAt: createdAtOf(base, 40) }, // hembra más vieja
    { idv: vaq2, sex: 'female', categoryCode: 'vaquillona', createdAt: createdAtOf(base, 35) }, // hembra más vieja
  ]);

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openRodeoGroup(page, RODEO_NAME);

  // Sync ASENTADO antes de filtrar: el total real (6) en el header + una fila presente ⇒ las 6 filas bajaron.
  // Oráculo por PRESENCIA en la data (toHaveCount): una fila filtrada FUERA no está en `pages` → no se renderiza →
  // count 0; una fila incluida en un set chico (≤6 < GROUP_PAGE_SIZE) se renderiza → count 1 (robusto al alto de la
  // card de acciones + virtualización, sin depender de que esté en el viewport).
  await expect(page.getByText('6 animales activos', { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(groupRow(page, vaq1)).toHaveCount(1);
  const categoryChip = page.getByRole('button', { name: 'Filtrar por categoría', exact: true });
  const sexChip = page.getByRole('button', { name: 'Filtrar por sexo', exact: true });
  await expect(categoryChip).toBeVisible({ timeout: 20_000 });
  await expect(sexChip).toBeVisible();
  await page.waitForTimeout(1500); // dejar asentar el churn del first-sync (refresh silencioso) antes de filtrar.

  // ── (a) UN chip: sexo "Hembras" (narrow 6→4) → subconjunto correcto: los machos (toritos) quedan fuera. ──
  await sexChip.click();
  await page.getByRole('button', { name: 'Hembras', exact: true }).click();
  await expect(groupRow(page, tor1)).toHaveCount(0, { timeout: 15_000 }); // torito (macho) fuera
  await expect(groupRow(page, tor2)).toHaveCount(0);
  await expect(groupRow(page, vaq1)).toHaveCount(1); // hembras presentes
  await expect(groupRow(page, ter1)).toHaveCount(1);

  // ── (b) COMBINAR dos chips (RG3.4): sexo "Hembras" (activo) + categoría "Ternera" (narrow 4→2) → solo terneras. ──
  // Con sexo=Hembras ya activo, agregar categoría=Ternera SACA a las vaquillonas (hembras pero no terneras) → queda
  // la intersección (dos chips activos a la vez). loadedCount queda en 2 (el tamaño ANGOSTO — clave para (c)).
  await categoryChip.click();
  await page.getByRole('button', { name: 'Ternera', exact: true }).click();
  await expect(groupRow(page, vaq1)).toHaveCount(0, { timeout: 15_000 }); // vaquillona: hembra pero no ternera → fuera
  await expect(groupRow(page, tor1)).toHaveCount(0); // torito: macho → fuera
  await expect(groupRow(page, ter1)).toHaveCount(1); // terneras presentes
  await expect(groupRow(page, ter2)).toHaveCount(1);

  // ── (c) ENSANCHAR — REGRESIÓN DEL RACE (fix de `useGroupView.refreshWindow`): limpiar el chip de categoría
  //    ("Todas las categorías") ANCHA el filtro (Hembras+Ternera → Hembras) de 2 → 4 filas. El ensanche dispara,
  //    en el mismo commit, `loadFirstPage` (1ª página fresca de 4) Y un `refreshWindow` de FONDO (foco/sync, su
  //    identidad cambia con el filtro). Con el BUG, ese refresh lee `loadedCount` STALE = 2, fetchea `limit=2` (las
  //    2 hembras MÁS NUEVAS = terneras) y, bumpeando `listSeq` último, clobber-ea la página fresca → la lista queda
  //    PEGADA en 2 (solo terneras) → las vaquillonas (hembras MÁS VIEJAS) NO re-pueblan. Con el FIX, el refresh de
  //    fondo CEDE (hay un loadFirstPage en vuelo) → la lista se RE-PUEBLA a las 4 hembras. Oráculo determinístico:
  //    vaq1/vaq2 (hembras más viejas, FUERA de una ventana truncada a 2) DEBEN reaparecer.
  await categoryChip.click();
  await page.getByRole('button', { name: 'Todas las categorías', exact: true }).click();
  await expect(groupRow(page, vaq1)).toHaveCount(1, { timeout: 15_000 }); // RE-PUEBLA (bug: quedaría en 0)
  await expect(groupRow(page, vaq2)).toHaveCount(1); // RE-PUEBLA (hembra más vieja, fuera de la ventana truncada)
  await expect(groupRow(page, ter1)).toHaveCount(1); // terneras siguen (hembras)
  await expect(groupRow(page, ter2)).toHaveCount(1);
  await expect(groupRow(page, tor1)).toHaveCount(0); // toritos (machos) siguen fuera (sexo=Hembras activo)

  // ── (d) ENSANCHAR al MÁXIMO: limpiar el chip de sexo ("Ambos sexos") → sin filtro → las 6 filas. Los toritos
  //    (machos, fuera del set anterior) RE-PUEBLAN. Cierra el simétrico total angosto → ancho → todo. ──
  await sexChip.click();
  await page.getByRole('button', { name: 'Ambos sexos', exact: true }).click();
  await expect(groupRow(page, tor1)).toHaveCount(1, { timeout: 15_000 }); // macho RE-PUEBLA
  await expect(groupRow(page, tor2)).toHaveCount(1);
  await expect(groupRow(page, vaq1)).toHaveCount(1); // el set completo de 6
  await expect(groupRow(page, vaq2)).toHaveCount(1);
});

// ─── T-RG.31 — count real del grupo en el header (RG2.1/2.2) ────────────────────────────────

test('T-RG.31 count real en el header: el total del grupo supera las filas de la 1ª página', async ({ page }) => {
  test.setTimeout(150_000);
  const user = await createTestUser('rgcount');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Count');

  const N = 65; // > GROUP_PAGE_SIZE (60): el header debe mostrar 65, no ~60 (list.length de la 1ª página).
  const prefix = idvPrefix();
  const base = Date.now() - N * 1000 - 60_000;
  const specs: SeedSpec[] = [];
  for (let i = 1; i <= N; i++) {
    specs.push({ idv: idvOf(prefix, i), sex: 'female', categoryCode: 'vaquillona', createdAt: createdAtOf(base, i) });
  }
  await batchSeedAnimals(establishmentId, rodeoId, specs);

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openRodeoGroup(page, RODEO_NAME);

  // El header muestra el TOTAL REAL del grupo (COUNT scopeado overlay-aware, RG2.1) = 65 > 60 (1ª página) — NO el
  // largo de la lista cargada. Timeout amplio: el count se resuelve cuando el first-sync completa las 65 filas.
  await expect(page.getByText(`${N} animales activos`, { exact: true })).toBeVisible({ timeout: 45_000 });
});

// ─── T-RG.32 — lote muestra TODOS sus miembros (regresión del bug del lote, RG5.4) ──────────

test('T-RG.32 lote muestra TODOS sus miembros aunque queden fuera del viejo "200-del-campo" (regresión)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const user = await createTestUser('rglote');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo LoteGrande');
  const lote = await seedManagementGroup(establishmentId, 'Lote Grande');

  // El bug (RG5.4): el viejo `fetchGroupMembers` traía los 200 animales MÁS NUEVOS del CAMPO y filtraba client-side
  // por lote → en un campo > 200 los miembros del lote más VIEJOS quedaban afuera. Reproducción: 205 filler (más
  // nuevos, SIN lote) + 5 miembros del lote (más VIEJOS → fuera de los 200-más-nuevos del campo). Con la query
  // scopeada por `management_group_id` (fix) el lote muestra los 5; con el bug mostraría 0.
  const FILLER = 205;
  const MEMBERS = 5;
  const prefix = idvPrefix();
  const base = Date.now() - (FILLER + MEMBERS) * 1000 - 60_000;

  const memberIdvs: string[] = [];
  const specs: SeedSpec[] = [];
  // Miembros del lote: los MÁS VIEJOS (sec 1..5).
  for (let i = 1; i <= MEMBERS; i++) {
    const idv = idvOf(prefix, i);
    memberIdvs.push(idv);
    specs.push({
      idv,
      sex: 'female',
      categoryCode: 'vaquillona',
      createdAt: createdAtOf(base, i),
      managementGroupId: lote.id,
    });
  }
  // Filler del campo: los MÁS NUEVOS (sec 1000..1204), SIN lote → empujan a los miembros fuera de los 200-más-nuevos.
  for (let i = 1; i <= FILLER; i++) {
    specs.push({
      idv: idvOf(prefix, 300 + i),
      sex: 'female',
      categoryCode: 'vaquillona',
      createdAt: createdAtOf(base, 1000 + i),
    });
  }
  await batchSeedAnimals(establishmentId, rodeoId, specs);

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // La card del lote en Inicio aparece cuando el head-count del lote (≥1 miembro) bajó por first-sync. Con 210
  // animales el sync tarda más → esperamos la card con un timeout amplio ANTES de navegar (el timeout interno de
  // gotoLoteGroup es 30s, insuficiente para este seed).
  await expect(
    page.getByRole('button', { name: new RegExp(escapeRegExp(lote.name)) }).first(),
  ).toBeVisible({ timeout: 180_000 });

  // Vista de grupo del LOTE (card de Inicio; ancla = testID "lote-vender-descartar", presente con ≥1 activo).
  await gotoLoteGroup(page, lote.name);

  // El header muestra el COUNT REAL del lote (scopeado overlay-aware) = 5 miembros (NO 0, que daría el bug).
  await expect(page.getByText(`${MEMBERS} animales activos`, { exact: true })).toBeVisible({ timeout: 60_000 });

  // Y la LISTA del lote muestra a TODOS sus miembros (los 5 caben en una página < 60 → todos montados).
  for (const idv of memberIdvs) {
    const row = groupRow(page, idv);
    await expect(row.first()).toBeVisible({ timeout: 20_000 });
  }
});

// ─── T-RG.33 — acción masiva sobre el grupo entero (RG5.1/5.2/5.3) ──────────────────────────

test('T-RG.33 acción masiva sobre el grupo entero: gating por COUNT + candidatos de más allá de la 1ª página', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const user = await createTestUser('rgmasiva');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Masiva');

  // 61 hembras (vaquillona, NO candidatas a castración) MÁS NUEVAS = llenan la 1ª página (60) → la página cargada
  // de la vista de grupo NO tiene candidatos. 5 machos ENTEROS (torito) MÁS VIEJOS = candidatos, FUERA de la 1ª
  // página. Si el gating contara sobre la página (bug E1), "Castrar" NO se ofrecería; el fix cuenta sobre el GRUPO
  // ENTERO (COUNT scopeado, RG5.2) → 5 candidatos → "Castrar" se ofrece. Y la selección masiva carga el set
  // completo (RG5.3) → los machos de más allá de la 1ª página figuran como candidatos.
  const FEMALES = 61;
  const MALES = 5;
  const prefix = idvPrefix();
  const base = Date.now() - (FEMALES + MALES) * 1000 - 60_000;

  const specs: SeedSpec[] = [];
  // Machos enteros: los MÁS VIEJOS (sec 1..5) → fuera de la 1ª página.
  const maleIdvs: string[] = [];
  for (let i = 1; i <= MALES; i++) {
    const idv = idvOf(prefix, i);
    maleIdvs.push(idv);
    specs.push({ idv, sex: 'male', categoryCode: 'torito', createdAt: createdAtOf(base, i) });
  }
  // Hembras: las MÁS NUEVAS (sec 100..160) → llenan la 1ª página.
  for (let i = 1; i <= FEMALES; i++) {
    specs.push({ idv: idvOf(prefix, 100 + i), sex: 'female', categoryCode: 'vaquillona', createdAt: createdAtOf(base, 100 + i) });
  }
  await batchSeedAnimals(establishmentId, rodeoId, specs);

  const newestFemaleIdv = idvOf(prefix, 100 + FEMALES); // 1ª página
  const candidateMaleIdv = maleIdvs[0]; // macho candidato, fuera de la 1ª página

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await openRodeoGroup(page, RODEO_NAME);

  // 1ª página cargada (una hembra visible). Un macho candidato está FUERA de la 1ª página → NO montado.
  await expect(groupRow(page, newestFemaleIdv).first()).toBeVisible({ timeout: 45_000 });
  await expect(groupRow(page, candidateMaleIdv)).toHaveCount(0);

  // GATING por COUNT del GRUPO ENTERO (RG5.2): "Castrar" se OFRECE porque hay 5 machos enteros en el grupo, aunque
  // la 1ª página cargada (60 hembras) no tenga ninguno. (Con gating por página — el bug — estaría oculto.)
  const castrar = page.getByRole('button', { name: 'Castrar', exact: true });
  await expect(castrar).toBeVisible({ timeout: 45_000 });

  // Acción masiva sobre el GRUPO ENTERO (RG5.1/5.3): la pantalla de selección carga TODOS los miembros → el macho
  // candidato de más allá de la 1ª página figura como candidato (checkbox por idv). La selección es un ScrollView
  // (no virtualiza) → con 5 candidatos, la fila está montada; scrollIntoView por robustez.
  await castrar.click();
  const candidateCheckbox = page.getByRole('checkbox', { name: new RegExp(escapeRegExp(candidateMaleIdv)) });
  await expect(candidateCheckbox.first()).toBeVisible({ timeout: 30_000 });
});
