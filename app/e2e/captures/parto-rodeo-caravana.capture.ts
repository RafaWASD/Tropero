// e2e/captures/parto-rodeo-caravana.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el delta
// "PARTO: RODEO DEL PARTO" (#4, spec 02, RPRC.1). Recorre el form de Parto (agregar-evento, eventType='birth')
// y saca CAPTURAS NOMBRADAS de los estados del RODEO DEL PARTO (a nivel camada: el picker, la leyenda
// "(Mismo rodeo que la madre)", el cambio de rodeo) a `e2e/captures/__shots__/parto-rodeo-caravana/NN-estado.png`
// para que el leader las vete (design-review) y se las muestre a Raf en la Puerta 2 con evidencia visual.
// La caravana VISUAL del ternero (idv) YA NO se captura acá: migró a ser POR CRÍA (delta
// parto-caravana-visual-por-ternero) y su captura vive en parto-caravana-visual-por-ternero.capture.ts.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). La RED DE REGRESIÓN del delta vive
// en e2e/events.spec.ts (test "delta parto-rodeo-caravana: …"); este archivo SOLO captura estados, reusando
// los MISMOS helpers de setup/seed/navegación y los MISMOS selectores (a11y labels) de esa suite.
//
// Es la pantalla REAL (NO un mock): el form vive en app/agregar-evento.tsx (PartoForm), al que se llega
// desde la ficha del animal (animal/[id].tsx → "Agregar evento" → "Parto").
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/parto-rodeo-caravana.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/parto-rodeo-caravana/  (gitignoreado — app/.gitignore + ADR-029 §Artefactos).
//
// Estados capturados (RPRC.7.1):
//   01-parto-single-rodeo          — 1 ternero: picker de "Rodeo del parto" + leyenda "(Mismo rodeo que la madre)".
//   02-parto-mellizos-rodeo-camada — 2 terneros (mellizos): el "Rodeo del parto" NO se duplica por cría — sigue
//                                    habiendo UN SOLO picker a nivel camada + la leyenda sigue visible (RPRC.1).
//   03-rodeo-picker-open           — picker de rodeo abierto (rodeos del mismo sistema).
//   04-rodeo-cambiado              — rodeo cambiado a "Destete" → la leyenda desaparece.
//   (El campo idv del ternero NO se captura acá: migró a POR CRÍA — ver parto-caravana-visual-por-ternero.capture.ts.)
//   (05 validación inline — N/A en este delta: el rodeo siempre es válido por preselección/filtro. No se agrega
//    validación client-side nueva → no hay estado de error inline propio que capturar, design §8.4.)

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForHome, gotoAnimales } from '../helpers/ui';

// Path RELATIVO a app/ (cwd de Playwright) → resuelve a app/e2e/captures/__shots__/parto-rodeo-caravana/.
// page.screenshot crea los dirs padre solos.
const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'parto-rodeo-caravana');

test.afterAll(async () => {
  await cleanupAll();
});

/**
 * Saca una captura NOMBRADA tras un breve settle de layout. El llamador asegura un
 * expect(...).toBeVisible() del elemento clave ANTES de invocar esto (per ADR-029).
 */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

// Campo con 2 rodeos del MISMO sistema (cría) → el picker del parto ofrece "Destete" como destino editable.
// La madre va al rodeo "general" → la leyenda "(Mismo rodeo que la madre)" arranca visible y desaparece al
// elegir "Destete".
test('captura delta parto-rodeo-caravana: rodeo del parto a nivel camada (single / mellizos / picker)', async ({
  page,
}) => {
  test.setTimeout(210_000);

  const user = await createTestUser('partorccap');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo PartoRCcap'); // rodeo A "Rodeo general"
  await seedRodeo(establishmentId, 'Destete'); // rodeo B, mismo sistema → destino editable del ternero (RPRC.1.5/1.6)
  const motherIdv = `4413${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const motherRow = page.getByRole('button', { name: new RegExp(motherIdv) }).first();
  await expect(motherRow).toBeVisible({ timeout: 20_000 });
  await motherRow.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── Abrir el form de Parto. ──
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Parto', exact: true }).click();
  await expect(page.getByText('Ternero 1', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 01 — parto SINGLE: picker de "Rodeo del parto" (a nivel camada) + leyenda "(Mismo rodeo que la madre)".
  //         El campo idv del ternero vive DENTRO del CalfBlock y su captura es del capture nuevo (POR CRÍA):
  //         acá NO se asierta ni se tipea idv, este capture es solo del RODEO del parto. ──
  await expect(page.getByText('Rodeo del parto', { exact: true })).toBeVisible();
  await expect(page.getByText('(Mismo rodeo que la madre)', { exact: true })).toBeVisible();
  await shot(page, '01-parto-single-rodeo');

  // ── 02 — parto MELLIZOS: agregar un 2º ternero → el "Rodeo del parto" NO se duplica por cría: sigue habiendo
  //         UN SOLO picker a nivel camada (RPRC.1) y la leyenda sigue visible. (El idv es POR CRÍA → no se asierta.) ──
  await page.getByRole('button', { name: 'Agregar otro ternero', exact: true }).click();
  await expect(page.getByText('Ternero 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Elegir rodeo del parto' })).toHaveCount(1);
  await expect(page.getByText('(Mismo rodeo que la madre)', { exact: true })).toBeVisible();
  await shot(page, '02-parto-mellizos-rodeo-camada');

  // Volver a SINGLE (quitar el 2º ternero) para capturar el picker de rodeo abierto/cambiado.
  await page.getByRole('button', { name: 'Quitar ternero 2', exact: true }).click();
  await expect(page.getByText('Ternero 2', { exact: true })).toHaveCount(0);

  // ── 03 — picker de rodeo ABIERTO: lista de rodeos del mismo sistema (incluye "Destete") + leyenda. ──
  await page.getByRole('button', { name: 'Elegir rodeo del parto' }).click();
  await expect(page.getByRole('button', { name: /Rodeo .*Destete/i })).toBeVisible();
  await expect(page.getByText('(Mismo rodeo que la madre)', { exact: true })).toBeVisible();
  await shot(page, '03-rodeo-picker-open');

  // ── 04 — elegir "Destete" (mismo sistema) → la leyenda desaparece (RPRC.1.4). ──
  await page.getByRole('button', { name: /Rodeo .*Destete/i }).click();
  await expect(page.getByText('(Mismo rodeo que la madre)', { exact: true })).toHaveCount(0);
  await shot(page, '04-rodeo-cambiado');
});
