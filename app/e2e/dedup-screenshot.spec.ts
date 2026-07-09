// e2e/dedup-screenshot.spec.ts — CAPTURA para el veto de diseño del leader (spec 09 chunk dedup).
//
// NO es un test de la Fase 6 (E2E formal, run posterior): son las capturas en 412×915 que el leader vetea
// con la skill design-review ANTES de mostrar a Raf (manga-crítico). Reusa el mock del bastón del chunk
// BLE global (`window.__rafaqBle.tagRead` bajo el flag E2E, igual que baston.spec.ts).
//
// Opción A (modo `assign_or_create` del bottom-sheet) — DOS estados:
//   1) la LISTA (≥3 candidatos sin caravana + el buscador visible, cada fila con su chevron de afford de tap)
//      → design/veto-dedup-opcionA/assign-or-create.png
//   2) la CONFIRMACIÓN tras tocar un candidato ("Le vas a asignar la caravana <EID> a este animal")
//      → design/veto-dedup-opcionA/assign-confirm.png
//
// Opción B (BulkTagAssignmentScreen, asignación MASIVA) — TRES estados:
//   3) la PANTALLA con ≥1 EID en cola + lista de candidatos + contador
//      → design/veto-dedup-opcionB/bulk-assign.png
//   4) el ESTADO VACÍO ("bastoneá para empezar")
//      → design/veto-dedup-opcionB/bulk-empty.png
//   5) el AVISO DE DUP (RD6.1): bastonear un EID que YA tiene caravana → banner "ya está asignada" + la cola
//      NO se mueve (el EID dup NO entra) → design/veto-dedup-opcionB/bulk-dup-warning.png
//
// Para correrla:  cd app && pnpm e2e:build && pnpm exec playwright test e2e/dedup-screenshot.spec.ts

import path from 'node:path';
import { test, expect, type Page } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  RUN_TAG,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// EIDs FDX-B válidos (15 díg). Únicos por corrida + por invocación: un EID hardcodeado leakea entre runs
// (animals.tag_electronic tiene un unique GLOBAL y animals NO se borra en cascada con el establishment →
// un run interrumpido deja la fila huérfana → el siguiente run choca el unique). makeEid() deriva del
// timestamp + un contador para no colisionar. Un EID SIN match → abre la intermedia (con candidatos).
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
    if (!h) throw new Error('window.__rafaqBle no está disponible (¿se montó el BleE2EBridge bajo el flag?)');
    h.connectMock();
    h.tagRead(e);
  }, eid);
}

test('captura: modo assign_or_create del bottom-sheet (≥3 candidatos + buscador) para el veto del leader', async ({ page }) => {
  const user = await createTestUser('dedup-shot');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Dedup Shot');

  // 4 animales SIN caravana electrónica (tag:null) → candidatos de la intermedia. Identificación por idv
  // variada (uno sin idv → "sin identificación") para que la lista se vea realista al vetear.
  const candidates = [
    { idv: '1024', sex: 'female' as const },
    { idv: '1077', sex: 'male' as const },
    { idv: '0319', sex: 'female' as const },
    { idv: null, sex: 'female' as const },
  ];
  for (const v of candidates) {
    await seedAnimal(establishmentId, rodeoId, { tag: null, idv: v.idv, sex: v.sex });
  }

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Esperamos a que los candidatos BAJEN por la stream (visibles en la lista = ya sincronizó al SQLite
  // local). El hero de IDV '0319' se renderiza completo.
  await gotoAnimales(page);
  await expect(page.getByText('0319', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Bastonazo de un EID SIN match → con ≥1 candidato sin caravana → modo assign_or_create (RD3.1).
  await bastonazo(page, makeEid());
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('¿Es uno de tus animales sin caravana?', { exact: true })).toBeVisible({ timeout: 15_000 });
  // El buscador + el CTA "es nuevo" deben estar visibles (criterios del veto: una decisión, CTA siempre a la vista).
  await expect(page.getByPlaceholder('Buscar por número o visual')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Es un animal nuevo → dar de alta' })).toBeVisible();

  // Captura 412×915 (el viewport del project) → al disco para el veto del leader (estado LISTA con chevrons).
  const outDir = path.join(__dirname, '..', '..', 'design', 'veto-dedup-opcionA');
  await page.screenshot({ path: path.join(outDir, 'assign-or-create.png') });

  // Estado de CONFIRMACIÓN: tocar un candidato (el de IDV '0319', a11y "Asignar caravana a 0319, …") →
  // aparece "Asignar caravana <EID> a este animal" con su CTA de confirmar. Capturamos para el re-veto.
  await page.getByRole('button', { name: /^Asignar caravana a 0319,/ }).click();
  await expect(page.getByText('Le vas a asignar la caravana', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Asignar caravana', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(outDir, 'assign-confirm.png') });
});

test('captura: BulkTagAssignmentScreen (opción B, asignación masiva) — vacío + con EID en cola', async ({ page }) => {
  const user = await createTestUser('bulk-shot');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Bulk Shot');

  // 4 animales SIN caravana electrónica → candidatos de la masiva.
  const candidates = [
    { idv: '2048', sex: 'female' as const },
    { idv: '2099', sex: 'male' as const },
    { idv: '0512', sex: 'female' as const },
    { idv: null, sex: 'female' as const },
  ];
  for (const v of candidates) {
    await seedAnimal(establishmentId, rodeoId, { tag: null, idv: v.idv, sex: v.sex });
  }

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Esperamos a que los candidatos bajen por la stream (visibles en la lista = sincronizado al local).
  await gotoAnimales(page);
  await expect(page.getByText('0512', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Filtro "Sin electrónica" → aparece el CTA "Asignar caravanas en masa" → entra a la pantalla masiva.
  await page.getByRole('button', { name: 'Filtrar animales sin electrónica' }).click();
  await page.getByRole('button', { name: 'Asignar caravanas en masa' }).click();

  // Estado VACÍO: cola vacía → "bastoneá para empezar" + contador en 0.
  await expect(page.getByText('Bastoneá para empezar', { exact: true })).toBeVisible({ timeout: 15_000 });
  const outDir = path.join(__dirname, '..', '..', 'design', 'veto-dedup-opcionB');
  await page.screenshot({ path: path.join(outDir, 'bulk-empty.png') });

  // Bastoneo de un EID → entra a la cola → muestra el EID actual + candidatos + buscador.
  await bastonazo(page, makeEid());
  await expect(page.getByText('Caravana leída', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('¿A cuál de tus animales sin caravana?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder('Buscar por número o visual')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bastoneé un animal nuevo, no está en la lista' })).toBeVisible();
  // Estado PRINCIPAL: cola con ≥1 EID + lista de candidatos + contador, para el veto del leader.
  await page.screenshot({ path: path.join(outDir, 'bulk-assign.png') });
});

// Prevención de dup al bastonear en la masiva (RD6.1): bastonear un EID que YA tiene caravana asignada (a
// otro animal del mismo campo del usuario) NO entra a la cola y muestra el aviso "ya está asignada". El
// progreso de la sesión no se pierde. Esto es F5.4 (reconciliada por el leader): defensa primaria
// client-side en vez de esperar el rechazo del sync (que solo hace console.warn, RD6.3).
test('opción B: bastonear un EID ya asignado NO encola y avisa (prevención client-side, RD6.1)', async ({ page }) => {
  const user = await createTestUser('bulk-dup');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Bulk Dup');

  // EID YA usado: lo sembramos en un animal CON caravana (mode 'edit' al bastonearlo). 15 díg FDX-B válido.
  // Único por corrida (makeEid) — un EID hardcodeado leakeaba el unique global de animals entre runs.
  const usedEid = makeEid();
  await seedAnimal(establishmentId, rodeoId, { tag: usedEid, idv: '3001', sex: 'male' });
  // Un candidato SIN caravana, para confirmar que la lista de candidatos NO se ofrece para el EID dup.
  await seedAnimal(establishmentId, rodeoId, { tag: null, idv: '3050', sex: 'female' });

  await gotoWithBle(page);
  await signIn(page, user);
  await waitForHome(page);

  // Esperamos a que el animal CON caravana baje al SQLite local (visible en la lista = ya sincronizó, así
  // lookupByTag lo encuentra localmente). El candidato sin caravana también baja.
  await gotoAnimales(page);
  await expect(page.getByText('3001', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('3050', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  // Entramos a la masiva (tab Más sirve también, pero reusamos el filtro + CTA de la tab Animales).
  await page.getByRole('button', { name: 'Filtrar animales sin electrónica' }).click();
  await page.getByRole('button', { name: 'Asignar caravanas en masa' }).click();
  await expect(page.getByText('Bastoneá para empezar', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Bastoneo del EID YA asignado → lookupByTag resuelve 'edit' → NO se encola + banner de dup.
  await bastonazo(page, usedEid);
  await expect(page.getByText('Esa caravana ya está asignada', { exact: true })).toBeVisible({ timeout: 15_000 });

  // INVARIANTE (RD6.1): la cola NO avanzó → seguimos en el estado vacío ("bastoneá para empezar"), NO en
  // la pantalla de candidatos ("¿A cuál de tus animales sin caravana?"). El EID dup nunca entró a la cola.
  await expect(page.getByText('Bastoneá para empezar', { exact: true })).toBeVisible();
  await expect(page.getByText('¿A cuál de tus animales sin caravana?', { exact: true })).toHaveCount(0);

  const outDir = path.join(__dirname, '..', '..', 'design', 'veto-dedup-opcionB');
  await page.screenshot({ path: path.join(outDir, 'bulk-dup-warning.png') });

  // Tras descartar el aviso, un EID NUEVO (sin match, distinto del sembrado) SÍ entra a la cola → confirma
  // que la prevención no rompe el flujo normal (solo bloquea el dup).
  await page.getByRole('button', { name: 'Entendido' }).click();
  await bastonazo(page, makeEid());
  await expect(page.getByText('¿A cuál de tus animales sin caravana?', { exact: true })).toBeVisible({ timeout: 15_000 });
});
