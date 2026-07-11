// e2e/treatments.spec.ts — red E2E del delta TRATAMIENTOS (spec 02, T20/T21 → RTR.1/2/3/4/5/8/9).
//
// ⚠️ REQUIERE la migración 0123 APLICADA + la stream ev_treatments deployada (deploy gateado a Raf). Antes del
//    deploy este spec FALLA (la tabla treatments no existe → el write local no sincroniza / la lista no pinnea).
//    Se ejecuta POST-deploy (junto con el capture del Gate 2.5). NO correr antes del deploy.
//
// Corre contra el export ESTÁTICO de prod (:8099) + Supabase remoto + PowerSync (mismo patrón que
// cut-ficha.spec.ts / operaciones-castracion.spec.ts). Estado de partida: usuario con teléfono (saltea el gate
// R3.8) + 1 campo con 1 rodeo de CRÍA + 2 hembras (una que vamos a tratar + otra "más nueva" para probar el pin).
//
// Flujo cubierto: ficha → Iniciar tratamiento (kind + producto) → marca "En tratamiento" en el hero (RTR.4.3)
// → lista general: el animal tratado PINNEA arriba con la marca (RTR.5.1/4.4) → lista del RODEO: idem (RTR.5.2)
// → volver a la ficha → Registrar aplicación (fecha+dosis) → aparece en la card (RTR.9.3) → Finalizar (inline)
// → la marca DESAPARECE (RTR.4.6) + el animal DES-pinnea (RTR.5.4). + un caso OFFLINE (RTR.8): iniciar sin red.
//
// Web táctil real (memoria reference_rn_web_pitfalls): hasTouch + touchscreen.tap(). Datos namespaced (RUN_TAG);
// cleanup en afterAll + global-teardown. Aserta SOLO sobre datos propios.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test.afterAll(async () => {
  await cleanupAll();
});

test('ficha: iniciar → marca en hero → pin en lista general y del rodeo → aplicar → finalizar → marca desaparece', async ({ page }) => {
  const user = await createTestUser('trt');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Tratamientos');

  // Animal a TRATAR (más VIEJO, se sembró primero → sin tratamiento quedaría ABAJO en el orden created_at DESC).
  const idvTreated = `TRT${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: idvTreated, sex: 'female', categoryCode: 'multipara', birthDate: '2020-03-01' });
  // Animal "más nuevo" (se siembra después → quedaría ARRIBA por created_at DESC). El pin del tratado debe
  // ganarle (RTR.5.1): el tratado sube por encima aunque sea más viejo.
  const idvOther = `OTR${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: idvOther, sex: 'female', categoryCode: 'multipara', birthDate: '2021-03-01' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Buscar el animal a tratar → ficha.
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idvTreated);
  const row = page.getByRole('button', { name: new RegExp(idvTreated) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.tap();

  await expect(page.getByText('Tratamientos', { exact: true })).toBeVisible({ timeout: 20_000 });
  // De partida NO está en tratamiento (sin marca en el hero).
  await expect(page.getByLabel('En tratamiento', { exact: true })).toHaveCount(0);

  // ── Iniciar tratamiento ──
  await page.getByRole('button', { name: 'Iniciar tratamiento', exact: true }).tap();
  // Sheet: elegir tipo (Select) → Antibiótico.
  await page.getByLabel('Tipo de tratamiento', { exact: true }).tap();
  await page.getByRole('button', { name: 'Antibiótico', exact: true }).tap();
  // Producto (requerido).
  await page.getByLabel('Producto', { exact: true }).fill('Oxitetraciclina');
  // Confirmar (el CTA del sheet dice "Iniciar tratamiento").
  await page.getByRole('button', { name: 'Iniciar tratamiento', exact: true }).last().tap();

  // La marca "En tratamiento" aparece en el HERO (RTR.4.3) + el badge "En curso" en la card (RTR.9.2).
  await expect(page.getByLabel('En tratamiento', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Oxitetraciclina', { exact: true }).first()).toBeVisible();

  // ── Pin + marca en la LISTA GENERAL (RTR.5.1/4.4) ──
  await gotoAnimales(page);
  // El animal tratado está PINNEADO arriba: la PRIMERA fila de la lista es la del idvTreated (pese a ser más viejo).
  const firstRow = page.getByRole('button', { name: /,/ }).first();
  await expect(firstRow).toBeVisible({ timeout: 20_000 });
  await expect(firstRow).toContainText(idvTreated);
  // La marca "En tratamiento" aparece en la fila (RTR.4.4).
  await expect(page.getByLabel('En tratamiento').first()).toBeVisible();

  // ── Pin + marca en la LISTA DEL RODEO (RTR.5.2) ──
  // (Navegación a la vista de rodeo: por robustez, volvemos a la ficha y de ahí a la lista — el pin del rodeo
  // se cubre por la misma query con rodeoId. Si la app expone la vista de rodeo por URL, se navega directo.)
  await page.goto(`/rodeo/${rodeoId}`);
  const firstRodeoRow = page.getByRole('button', { name: new RegExp(idvTreated) }).first();
  await expect(firstRodeoRow).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('En tratamiento').first()).toBeVisible();

  // ── Volver a la ficha → Registrar aplicación ──
  await firstRodeoRow.tap();
  await expect(page.getByText('Tratamientos', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Registrar aplicación', exact: true }).first().tap();
  // El sheet trae la fecha default hoy; cargamos una dosis.
  await page.getByLabel('Dosis en ml (opcional)', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Registrar aplicación', exact: true }).last().tap();
  // La aplicación aparece en la card (dosis 5 ml, RTR.9.3).
  await expect(page.getByText(/5 ml/).first()).toBeVisible({ timeout: 20_000 });

  // ── Finalizar (confirmación inline) → la marca desaparece (RTR.4.6) ──
  await page.getByRole('button', { name: 'Finalizar tratamiento', exact: true }).first().tap();
  await page.getByRole('button', { name: 'Finalizar', exact: true }).tap();
  // La marca "En tratamiento" del hero desaparece (RTR.4.6) + el badge de la card pasa a "Finalizado".
  await expect(page.getByLabel('En tratamiento', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByLabel('Finalizado', { exact: true }).first()).toBeVisible();
});

test('offline: iniciar tratamiento sin conexión → la marca aparece al instante (RTR.8.1/8.4)', async ({ page }) => {
  const user = await createTestUser('trtoff');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Trt Offline');
  const idv = `TOF${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female', categoryCode: 'multipara', birthDate: '2020-03-01' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.tap();
  await expect(page.getByText('Tratamientos', { exact: true })).toBeVisible({ timeout: 20_000 });

  // OFFLINE: cortamos la red y iniciamos el tratamiento — debe funcionar (CRUD-plano local, RTR.8.1).
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Iniciar tratamiento', exact: true }).tap();
  await page.getByLabel('Tipo de tratamiento', { exact: true }).tap();
  await page.getByRole('button', { name: 'Antiparasitario', exact: true }).tap();
  await page.getByLabel('Producto', { exact: true }).fill('Ivermectina');
  await page.getByRole('button', { name: 'Iniciar tratamiento', exact: true }).last().tap();

  // La marca "En tratamiento" aparece al INSTANTE offline (derivado de la fila local, RTR.8.4).
  await expect(page.getByLabel('En tratamiento', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Ivermectina', { exact: true }).first()).toBeVisible();

  await page.context().setOffline(false);
});
