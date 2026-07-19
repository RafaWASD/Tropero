// e2e/captures/rodeo-grande.capture.ts — CAPTURAS para el veto visual del leader (Gate 2.5, ADR-029) del
// delta «rodeo grande» (spec 10, feature 10): la vista de grupo (rodeo/lote) pasó a query SCOPEADA +
// PAGINADA (scroll infinito) + COUNT real + buscador/chips in-grupo + acciones masivas sobre el grupo entero.
// ANTES: tope 200 del campo, sin buscador ni chips.
//
// Recorre los flujos del feature y saca capturas NOMBRADAS de cada estado clave a __shots__/rodeo-grande/:
//   01 — HERO: vista del rodeo GRANDE cargada (header con el count real "65 animales activos", buscador FIJO,
//        chips categoría/sexo, primeras filas de la lista paginada). Este es EL shot que justifica la feature.
//   02 — buscador activo: tipear un idv concreto → lista filtrada al match (búsqueda sobre el SET COMPLETO,
//        incluso un animal fuera de la 1ª página).
//   03 — popover del chip "Filtrar por categoría" abierto (Todas las categorías + las categorías presentes).
//   04 — popover del chip "Filtrar por sexo" abierto (Ambos sexos / Hembras / Machos).
//   05 — filtro combinado: dos chips activos a la vez (Hembras + Ternera), lista al subconjunto.
//   06 — búsqueda sin resultados: empty state del buscador ("No encontramos «…» en este grupo").
//   07 — scroll 2ª página: tras scrollear al fondo (loadMore), una fila de más allá de la 1ª página montada.
//   09 — barra de acciones del grupo con "Castrar" ofrecido (gating por el grupo entero → hay machos enteros).
//   10 — selección masiva de Castrar: candidatos (checkbox por animal) del set completo del grupo.
//   08 — vista del LOTE con TODOS sus miembros + count real + la acción "Vender / Descartar".
//
// Viewport mobile 412×915 (contexto propio, mismo patrón que lotes-venta.capture.ts). NO corras esto en
// `pnpm e2e` (es un `.capture.ts`); lo dispara el leader:
//   pnpm exec playwright test e2e/captures/rodeo-grande.capture.ts --config playwright.capture.config.ts
//
// SEED batch LOCAL (no toca e2e/helpers/admin.ts) con `created_at` EXPLÍCITO por perfil — el keyset ordena
// por `(in_treatment DESC, created_at DESC, id DESC)` y un batch comparte `now()` → sin control el orden
// caería en `id DESC` (UUID random) = no-determinístico; con `created_at` monótono controlo qué animal cae en
// la 1ª página y cuál queda afuera. Seeds MODESTOS (65) — bastan para MOSTRAR los estados, no para probar la
// regresión (de eso ya se encarga e2e/rodeo-grande.spec.ts). Datos namespaced (RUN_TAG); cleanup en afterAll.

import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { test, applyEnvShim, expect } from '../helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedManagementGroup,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from '../helpers/admin';
import { signIn, waitForHome, gotoLoteGroup, escapeRegExp } from '../helpers/ui';

// El rodeo default de seedEstablishmentWithRodeo va namespaced: `${RUN_TAG} Rodeo general`.
const RODEO_NAME = `${RUN_TAG} Rodeo general`;

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'rodeo-grande');

test.afterAll(async () => {
  await cleanupAll();
});

// Auto-aceptar cualquier confirmación destructiva (defensivo — ningún flujo confirma una masiva; el shot 10
// se detiene en la pantalla de selección).
test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
});

/** Captura NOMBRADA tras un breve settle de layout (el llamador ya asertó visible el elemento clave). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

// ─── Seed batch (LOCAL — no toca admin.ts; espeja e2e/rodeo-grande.spec.ts) ──────────────────────

type SeedSpec = {
  idv: string;
  sex: 'male' | 'female';
  /** code de categoría (default torito/vaquillona por sexo). */
  categoryCode?: string;
  /** created_at ISO EXPLÍCITO (controla el orden del keyset). Mayor = más nuevo = más arriba. */
  createdAt?: string;
  /** lote (management_group_id) del perfil (para el shot del lote). */
  managementGroupId?: string;
  /** birth_date ISO 'YYYY-MM-DD' (en `animals`; el trigger 0079 lo denormaliza al perfil) → muestra la edad. */
  birthDate?: string;
  /**
   * category_override del perfil. `true` = categoría FIJADA (la GUARDADA manda, RC6.3.3, animals.ts §305/330):
   * la lista NO recomputa por edad → la categoría sembrada se muestra fiel. SIN esto, una ternera sin edad se
   * mostraría como "Vaquillona" (el mirror por edad cae al default de hembra adulta).
   */
  categoryOverride?: boolean;
};

/**
 * Siembra N animales activos en un rodeo en pocas round-trips (patrón `seedAnimal` pero batch): resuelve el
 * rodeo (species/system) + las categorías UNA vez, arma los payloads y hace inserts chunked. `created_at`
 * explícito por perfil (ver cabecera). Todo se borra por CASCADE del establishment en cleanupAll.
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
    const animal: Record<string, unknown> = { id: animalId, sex: s.sex, species_id: speciesId };
    if (s.birthDate) animal.birth_date = s.birthDate; // denormalizado al perfil por el trigger 0079.
    animalsPayload.push(animal);
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
    if (s.categoryOverride) profile.category_override = true;
    profilesPayload.push(profile);
  }

  const CHUNK = 100;
  // `animals` PRIMERO: el trigger 0079 denormaliza sex/tag/birth al insertar el perfil leyendo `animals` por
  // `animal_id` → debe existir antes.
  for (let i = 0; i < animalsPayload.length; i += CHUNK) {
    const { error } = await admin.from('animals').insert(animalsPayload.slice(i, i + CHUNK));
    if (error) throw new Error(`batchSeedAnimals animals insert: ${error.message}`);
  }
  for (let i = 0; i < profilesPayload.length; i += CHUNK) {
    const { error } = await admin.from('animal_profiles').insert(profilesPayload.slice(i, i + CHUNK));
    if (error) throw new Error(`batchSeedAnimals profiles insert: ${error.message}`);
  }
}

/** Prefijo de idv único por test (índice único es `(establishment_id, idv)`). */
function idvPrefix(): string {
  return String(Date.now()).slice(-6);
}

/** idv de 9 chars: prefijo por-test + índice 3-dígitos. `idvOf(prefix, 1)` = "…001". */
function idvOf(prefix: string, i: number): string {
  return `${prefix}${String(i).padStart(3, '0')}`;
}

/** created_at ISO: base fija en el pasado + `sec` segundos. Mayor sec ⇒ más nuevo (más arriba en el keyset). */
function createdAtOf(baseMs: number, sec: number): string {
  return new Date(baseMs + sec * 1000).toISOString();
}

/** ISO 'YYYY-MM-DD' de una fecha de nacimiento `years`/`months` atrás (edad realista por categoría). */
function ageISO(years: number, months = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Categoría/sexo/edad de un animal por su índice `i` — mezcla determinística de 3 categorías y 2 sexos para que
 * los chips tengan opciones reales: i%5==0 → torito (macho ~14m); i%5==1 → ternera (hembra ~6m); resto →
 * vaquillona (hembra ~18m). ⇒ ~13 toritos (candidatos a castrar + sexo=Machos), ~13 terneras (categoría=Ternera),
 * ~39 vaquillonas. La `birthDate` es coherente con la categoría → con `categoryOverride:true` la lista la muestra
 * fiel (categoría + edad), sin caer al default de hembra adulta.
 */
function catFor(i: number): { sex: 'male' | 'female'; categoryCode: string; birthDate: string } {
  const r = i % 5;
  if (r === 0) return { sex: 'male', categoryCode: 'torito', birthDate: ageISO(1, 2) };
  if (r === 1) return { sex: 'female', categoryCode: 'ternera', birthDate: ageISO(0, 6) };
  return { sex: 'female', categoryCode: 'vaquillona', birthDate: ageISO(1, 6) };
}

// ─── Navegación / scroll (espeja e2e/rodeo-grande.spec.ts) ───────────────────────────────────────

/**
 * Abre la vista de grupo de un RODEO tocando su card en Inicio y aterriza cuando el buscador FIJO del grupo
 * está montado (RG4.4 — ancla robusta que NO depende de que se ofrezca "Castrar").
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
 * evento por sí solo en RN-web.)
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

/** Setea el `scrollTop` (px) del scroller MÁS ALTO (la FlatList) y dispara `scroll` — para encuadrar un shot. */
async function scrollGroupListBy(page: Page, px: number): Promise<void> {
  await page.evaluate((y) => {
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
      best.scrollTop = y;
      best.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  }, px);
  await page.waitForTimeout(400);
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

// ─── SHOTS 01..07 + 09 + 10 — RODEO GRANDE (>60 animales, mezcla de categorías/sexos) ────────────
test('capturas rodeo grande: lista paginada + buscador + chips + acción masiva @ 412px', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  page.on('dialog', (dialog) => dialog.accept());

  try {
    const user = await createTestUser('cap-rodeo-grande');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Rodeo Grande');

    // 65 animales (> GROUP_PAGE_SIZE=60). created_at monótono: idv …001 = MÁS VIEJO (fuera de la 1ª página);
    // idv …065 = MÁS NUEVO (arriba, 1ª página). Mezcla de categorías/sexos (catFor) → chips con opciones reales.
    const N = 65;
    const prefix = idvPrefix();
    const base = Date.now() - N * 1000 - 60_000;
    const specs: SeedSpec[] = [];
    for (let i = 1; i <= N; i++) {
      const { sex, categoryCode, birthDate } = catFor(i);
      specs.push({
        idv: idvOf(prefix, i),
        sex,
        categoryCode,
        birthDate,
        categoryOverride: true, // fija la categoría sembrada → la lista la muestra fiel (categoría + edad).
        createdAt: createdAtOf(base, i),
      });
    }
    await batchSeedAnimals(establishmentId, rodeoId, specs);

    const newestIdv = idvOf(prefix, N); // 1ª página (arriba) — torito (i=65, i%5==0)
    const oldestIdv = idvOf(prefix, 1); // fuera de la 1ª página (última fila) — ternera (i=1, i%5==1)
    const searchTargetIdv = idvOf(prefix, 3); // fuera de la 1ª página (búsqueda sobre el set completo)
    const noMatchIdv = idvOf(prefix, 900); // NO sembrado → empty state del buscador
    const terneraIdv = idvOf(prefix, 11); // i%5==1 → ternera (1ª página)
    const vaquillonaIdv = idvOf(prefix, 7); // i%5==2 → vaquillona (1ª página)

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);
    await openRodeoGroup(page, RODEO_NAME);

    // (01) HERO: count real + buscador + chips + primeras filas. El count "65 animales activos" resuelve cuando
    // el first-sync completó; el newest visible confirma que la 1ª página renderizó.
    await expect(page.getByText(`${N} animales activos`, { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(groupRow(page, newestIdv).first()).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1200); // dejar asentar el churn del first-sync (refresh silencioso) antes de capturar/filtrar.
    await shot(page, '01-rodeo-grande-lista');

    // (09) Acciones del grupo con "Castrar" ofrecido (hay machos enteros = toritos en el grupo entero). La card
    // vive en el header de la lista; scrolleamos un poco para ENCUADRARLA distinta del hero (meta header arriba,
    // card de acciones prominente + el arranque de la lista) — el gating por el grupo entero: aunque la 1ª página
    // tenga hembras, "Castrar" se ofrece porque hay toritos en el grupo.
    const castrar = page.getByRole('button', { name: 'Castrar', exact: true });
    await expect(castrar).toBeVisible({ timeout: 30_000 });
    await scrollGroupListBy(page, 120);
    await expect(castrar).toBeVisible();
    await shot(page, '09-castrar-ofrecido');
    await scrollGroupListBy(page, 0); // reset al tope antes del buscador.

    // (02) Buscador activo: tipear un idv de más allá de la 1ª página → aparece (búsqueda sobre el SET COMPLETO).
    await groupSearchInput(page).fill(searchTargetIdv);
    await expect(groupRow(page, searchTargetIdv).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, '02-buscador-activo');

    // (06) Búsqueda sin resultados: un idv inexistente → empty state del buscador.
    await groupSearchInput(page).fill(noMatchIdv);
    await expect(page.getByText(/No encontramos/)).toBeVisible({ timeout: 15_000 });
    await shot(page, '06-busqueda-sin-resultados');

    // Limpiar el buscador → volver a la lista completa.
    await groupSearchInput(page).fill('');
    await expect(groupRow(page, newestIdv).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(600);

    // (03) Popover del chip "Filtrar por categoría" abierto (Todas las categorías + las categorías presentes).
    await page.getByRole('button', { name: 'Filtrar por categoría', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Todas las categorías', exact: true })).toBeVisible({ timeout: 10_000 });
    await shot(page, '03-chip-categoria-abierto');

    // (04) Popover del chip "Filtrar por sexo" abierto (clickear el chip de sexo cierra el de categoría y abre este).
    await page.getByRole('button', { name: 'Filtrar por sexo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ambos sexos', exact: true })).toBeVisible({ timeout: 10_000 });
    await shot(page, '04-chip-sexo-abierto');

    // (05) Filtro combinado: sexo=Hembras (el popover de sexo ya está abierto) + categoría=Ternera → dos chips
    // activos, lista al subconjunto (terneras). Oráculo por PRESENCIA (toHaveCount): un torito queda fuera por
    // sexo, una vaquillona queda fuera por categoría, las terneras quedan.
    await page.getByRole('button', { name: 'Hembras', exact: true }).click();
    await expect(groupRow(page, newestIdv)).toHaveCount(0, { timeout: 15_000 }); // torito (macho) fuera
    await page.getByRole('button', { name: 'Filtrar por categoría', exact: true }).click();
    await page.getByRole('button', { name: 'Ternera', exact: true }).click();
    await expect(groupRow(page, vaquillonaIdv)).toHaveCount(0, { timeout: 15_000 }); // vaquillona (no ternera) fuera
    await expect(groupRow(page, terneraIdv).first()).toBeVisible({ timeout: 15_000 }); // terneras presentes
    await shot(page, '05-filtro-combinado');

    // Limpiar los dos chips → lista completa (necesario para el scroll: hace falta > 1 página).
    await page.getByRole('button', { name: 'Filtrar por categoría', exact: true }).click();
    await page.getByRole('button', { name: 'Todas las categorías', exact: true }).click();
    await page.getByRole('button', { name: 'Filtrar por sexo', exact: true }).click();
    await page.getByRole('button', { name: 'Ambos sexos', exact: true }).click();
    await expect(groupRow(page, newestIdv).first()).toBeVisible({ timeout: 20_000 }); // el torito reaparece (set completo)
    await page.waitForTimeout(800);

    // (07) Scroll 2ª página: al llegar al fondo, onEndReached → loadMore anexa la 2ª página → el más viejo (fuera
    // de la 1ª página) se vuelve visible.
    await scrollUntilRowVisible(page, groupRow(page, oldestIdv));
    await expect(groupRow(page, oldestIdv).first()).toBeVisible();
    await shot(page, '07-scroll-segunda-pagina');

    // (10) Acción masiva: traer "Castrar" al viewport (el header sigue montado) → tocar → pantalla de selección
    // masiva. Los candidatos se cargan del set COMPLETO del grupo (RG5.3): incluye toritos de MÁS ALLÁ de la 1ª
    // página. Tildamos "todos" para mostrar el estado de selección (checkboxes tildados) + el CTA habilitado.
    await castrar.scrollIntoViewIfNeeded();
    await expect(castrar).toBeVisible({ timeout: 15_000 });
    await castrar.click();
    await expect(page.getByRole('button', { name: /Castrar \d+ animal/ })).toBeVisible({ timeout: 30_000 });
    // Un torito de más allá de la 1ª página figura como candidato (checkbox) → prueba el set completo (RG5.3).
    const offPageCandidate = idvOf(prefix, 5); // torito i=5, fuera de la 1ª página
    await expect(
      page.getByRole('checkbox', { name: new RegExp(escapeRegExp(offPageCandidate)) }).first(),
    ).toBeVisible({ timeout: 20_000 });
    // Tildar todos los candidatos → estado de selección visible + CTA "Castrar 13 animales" habilitado.
    await page.getByRole('button', { name: /^Tildar todos los/ }).first().click();
    await expect(page.getByText('13 seleccionados', { exact: true })).toBeVisible({ timeout: 10_000 });
    await shot(page, '10-seleccion-masiva');
  } finally {
    await ctx.close();
  }
});

// ─── SHOT 08 — LOTE con TODOS sus miembros (campo grande, lote de ~8) ────────────────────────────
test('capturas lote: todos los miembros + count real + Vender/Descartar @ 412px', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await applyEnvShim(page);
  page.on('dialog', (dialog) => dialog.accept());

  try {
    const user = await createTestUser('cap-lote-grande');
    await setUserPhone(user.id, '1123456789');
    const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Lote Grande');
    const lote = await seedManagementGroup(establishmentId, 'Recría hembras');

    // Campo de 65 (contexto "campo grande") con un lote de 8 miembros: los idv …001..008 van al lote, el resto
    // queda suelto en el rodeo. La vista del lote está scopeada por management_group_id → muestra sus 8 miembros
    // + "8 animales activos" en el header (NO limitada por el viejo "200-del-campo").
    const N = 65;
    const MEMBERS = 8;
    const prefix = idvPrefix();
    const base = Date.now() - N * 1000 - 60_000;
    const specs: SeedSpec[] = [];
    const memberIdvs: string[] = [];
    for (let i = 1; i <= N; i++) {
      const { sex, categoryCode, birthDate } = catFor(i);
      const spec: SeedSpec = {
        idv: idvOf(prefix, i),
        sex,
        categoryCode,
        birthDate,
        categoryOverride: true,
        createdAt: createdAtOf(base, i),
      };
      if (i <= MEMBERS) {
        spec.managementGroupId = lote.id;
        memberIdvs.push(spec.idv);
      }
      specs.push(spec);
    }
    await batchSeedAnimals(establishmentId, rodeoId, specs);

    await page.goto('/');
    await signIn(page, user);
    await waitForHome(page);

    // La card del lote en Inicio aparece cuando el head-count del lote (≥1 miembro) bajó por first-sync. Con 65
    // animales el sync tarda → esperamos la card con un timeout amplio ANTES de navegar.
    await expect(
      page.getByRole('button', { name: new RegExp(escapeRegExp(lote.name)) }).first(),
    ).toBeVisible({ timeout: 90_000 });
    await gotoLoteGroup(page, lote.name);

    // (08) Vista del LOTE: count real (8) en el header + la acción "Vender / Descartar" (testId) + TODOS los
    // miembros montados (8 < 60 → una sola página).
    await expect(page.getByText(`${MEMBERS} animales activos`, { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('lote-vender-descartar')).toBeVisible();
    for (const idv of memberIdvs) {
      await expect(groupRow(page, idv).first()).toBeVisible({ timeout: 20_000 });
    }
    await page.waitForTimeout(400);
    await shot(page, '08-lote-todos-miembros');
  } finally {
    await ctx.close();
  }
});
