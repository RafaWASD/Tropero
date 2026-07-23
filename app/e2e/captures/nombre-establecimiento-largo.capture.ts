// e2e/captures/nombre-establecimiento-largo.capture.ts — CAPTURAS para el veto visual del leader
// (Gate 2.5, ADR-029) del POLISH de truncado/recorte del NOMBRE DE ESTABLECIMIENTO
// (backlog 2026-07-21). Decisión de diseño aplicada:
//   - Lugares APRETADOS (switch del header, filas del dropdown del switch) → truncan con ELLIPSIS
//     (numberOfLines={1}) + `lineHeight` matching (descender-safe).
//   - Lugar ROOMY (card de "Mis campos") → nombre COMPLETO (wrap a 2 líneas, numberOfLines={2}) +
//     `lineHeight="$7"` matching (descender-safe).
//   - editar-campo → nombre completo en el input.
//
// Vet de DESCENDENTES (bug recurrente g/p/j/q, memoria feedback_descender_clipping): el campo vetado
// se llama "nombre de campo de prueba" — tiene 'p' en "campo" y "prueba". Las capturas del lugar
// ROOMY ($7, el tamaño más propenso a recortar) muestran esos descendentes ENTEROS: si no se recortan,
// el fix funciona.
//
// Capturas NOMBRADAS a __shots__/nombre-establecimiento-largo/:
//   01 — Mis campos (landing ≥2 campos): la card del nombre largo con el nombre COMPLETO (wrap 2 líneas).
//   02 — home: header/switch con el nombre largo TRUNCADO con ellipsis.
//   03 — home: dropdown del switch abierto → fila del campo activo con el nombre TRUNCADO con ellipsis.
//   04 — Más: título de sección "Campo activo · <nombre>" (spot documentado; wrappea, no recorta).
//   05 — editar-campo: el input "Nombre del campo" con el nombre COMPLETO.
//
// Viewport mobile 412×915 (heredado de la base). NO corras esto en `pnpm e2e` (es un `.capture.ts`);
// lo dispara el leader:
//   pnpm exec playwright test e2e/captures/nombre-establecimiento-largo.capture.ts --config playwright.capture.config.ts

import path from 'node:path';

import { test, expect, type Page } from '../helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from '../helpers/admin';
import { signIn, waitForMisCampos, waitForHome, gotoTab } from '../helpers/ui';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'nombre-establecimiento-largo');

// El nombre largo VETADO: reproduce el caso reportado (backlog) y lleva descendentes ('p' en campo/prueba).
const LONG_NAME = 'nombre de campo de prueba';
const SHORT_NAME = 'La Juanita';

/** Captura NOMBRADA tras un breve settle de layout (el llamador ya asertó visible el elemento clave). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

test.afterAll(async () => {
  await cleanupAll();
});

test('capturas nombre-establecimiento-largo — switch/dropdown ellipsis + Mis campos/editar full @ 412px', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const owner = await createTestUser('capnombre', 'Rafa Owner');
  await setUserPhone(owner.id, '1123456789');

  // Campo A: nombre LARGO con descendentes (el vetado). Con rodeo → la home no bloquea (RootGate).
  const { establishmentId: longId } = await seedEstablishmentWithRodeo(owner.id, 'campo largo', {
    rodeoRawName: true,
    rodeoName: 'Cría general',
  });
  // Campo B: nombre corto (para tener ≥2 campos → landing "Mis campos").
  await seedEstablishmentWithRodeo(owner.id, 'la juanita corta', {
    rodeoRawName: true,
    rodeoName: 'Cría general',
  });

  // El seeder namespaced los nombres con el RUN_TAG (red de seguridad del barrido por nombre). Para la
  // captura demo los limpiamos al nombre real vía service_role — el cleanup sigue siendo por ID
  // (createdEstablishmentIds), así que borrar sigue funcionando. Se hace ANTES del login → el primer
  // sync-down baja ya el nombre limpio.
  await admin.from('establishments').update({ name: LONG_NAME }).eq('id', longId);
  {
    // El id del campo corto lo resolvemos por el owner (evita cambiar la firma del helper de seed).
    const { data } = await admin
      .from('user_roles')
      .select('establishment_id')
      .eq('user_id', owner.id)
      .neq('establishment_id', longId);
    for (const row of data ?? []) {
      await admin.from('establishments').update({ name: SHORT_NAME }).eq('id', row.establishment_id as string);
    }
  }

  await page.goto('/');
  await signIn(page, owner);

  // ── (01) Mis campos (≥2 campos) — la card del nombre largo con el nombre COMPLETO (wrap 2 líneas). ──
  await waitForMisCampos(page);
  // El nombre entero es un solo nodo de Text (numberOfLines={2}) → getByText matchea el string completo.
  await expect(page.getByText(LONG_NAME, { exact: true })).toBeVisible({ timeout: 30_000 });
  await shot(page, '01-mis-campos-nombre-completo');

  // Tap la card del campo largo → fija activo + navega a su home.
  await page.getByRole('button', { name: new RegExp(LONG_NAME) }).first().click();

  // ── (02) Home — header/switch con el nombre largo TRUNCADO (ellipsis, numberOfLines={1}). ──
  await waitForHome(page);
  await shot(page, '02-home-switch-ellipsis');

  // ── (03) Home — dropdown del switch abierto → fila del activo con el nombre TRUNCADO (ellipsis). ──
  await page.getByRole('button', { name: /Establecimiento activo:/ }).click();
  await expect(page.getByRole('button', { name: 'Ver todos mis campos' })).toBeVisible({ timeout: 15_000 });
  await shot(page, '03-switch-dropdown-ellipsis');
  // Cierra el dropdown tocando el BACKDROP a la DERECHA de la card del menú (que se ancla arriba-izq,
  // left="$4" width 280 → termina en x≈296) y por ENCIMA de la tab bar / FAB central. NO en el centro
  // (x≈206): ahí vive el FAB "Modo maniobras" y el tap-through web (touch→click al desmontar el overlay,
  // memoria reference_rn_web_pitfalls) lo dispararía. El overlay (zIndex 1000) tapa la tab bar → hay que
  // cerrarlo antes de navegar. (ESC por keyboard no dispara: el onKeyDown vive en el backdrop sin foco.)
  await page.mouse.click(390, 460);
  await expect(page.getByRole('button', { name: 'Ver todos mis campos' })).toHaveCount(0, { timeout: 10_000 });

  // ── (04) Más — título de sección "Campo activo · <nombre>" (spot documentado: wrappea, no recorta). ──
  await gotoTab(page, 'Más', page.getByText('Perfil', { exact: true }));
  await expect(page.getByText(/Campo activo ·/)).toBeVisible({ timeout: 15_000 });
  await shot(page, '04-mas-campo-activo-titulo');

  // ── (05) editar-campo — el input "Nombre del campo" con el nombre COMPLETO. ──
  await page.getByRole('button', { name: 'Editar campo' }).click();
  const nameInput = page.getByLabel('Nombre del campo', { exact: true });
  await expect(nameInput).toBeVisible({ timeout: 30_000 });
  await expect(nameInput).toHaveValue(LONG_NAME);
  await shot(page, '05-editar-campo-nombre-completo');
});
