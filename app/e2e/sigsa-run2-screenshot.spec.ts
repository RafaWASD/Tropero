// e2e/sigsa-run2-screenshot.spec.ts — CAPTURAS del run 2 de la UI de SIGSA para el veto del leader (spec 08):
// flagship refinado (sticky CTA + "a completar" en muted), action-sheet markAsDeclared, BreedPicker (abierto +
// con búsqueda), filtros con rango de fecha, banner RENSPA, RENSPA en edición. NO es red de seguridad
// (sigsa-export / sigsa-breed-renspa lo son): sólo siembra estados y captura PNG a 412×915. Throwaway.

import path from 'node:path';
import { test } from './helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoTab, gotoAnimales } from './helpers/ui';
import { expect } from '@playwright/test';

const outDir = path.join(__dirname, '..', '..', 'design', 'veto-sigsa-run2');

test.afterAll(async () => {
  await cleanupAll();
});

async function breedId(code: string): Promise<string> {
  const { data, error } = await admin.from('breed_catalog').select('id').eq('senasa_code', code).single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
async function setBreed(profileId: string, code: string): Promise<void> {
  const { error } = await admin.from('animal_profiles').update({ breed_id: await breedId(code) }).eq('id', profileId);
  if (error) throw new Error(error.message);
}

test('captura: flagship refinado (sticky CTA + muted) + action-sheet markAsDeclared + filtros con fecha', async ({
  page,
}) => {
  const user = await createTestUser('shotflag');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo ShotFlag', {
    rodeoRawName: true,
    rodeoName: 'Cría hembras',
  });

  const base = Date.now().toString().slice(-11).padStart(11, '0');
  const mk = (n: number) => `032${base}${n}`;
  const p1 = await seedAnimal(establishmentId, rodeoId, { idv: 'F100', tag: mk(1), sex: 'female', birthDate: '2025-08-10' });
  const p2 = await seedAnimal(establishmentId, rodeoId, { idv: 'F101', tag: mk(2), sex: 'male', birthDate: '2024-09-01' });
  await seedAnimal(establishmentId, rodeoId, { idv: 'F102', tag: mk(3), sex: 'female', birthDate: '2025-07-20' });
  await setBreed(p1, 'AA');
  await setBreed(p2, 'H');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoTab(page, 'Más', page.getByText('Perfil', { exact: true }));
  await page.getByRole('button', { name: 'Exportar las caravanas electrónicas para declarar en SIGSA' }).click();
  await expect(page.getByRole('button', { name: 'Exportar 2 animales' })).toBeVisible({ timeout: 30_000 });

  // A1 + A2: card-resumen con "1 animal a completar" en muted + el CTA en la barra sticky de abajo.
  await page.screenshot({ path: path.join(outDir, '01-flagship-sticky-cta.png'), fullPage: true });

  // A3: tap en un animal "Listo" → action-sheet markAsDeclared (menú).
  const maskedReady = `${mk(1).slice(0, 6)}·${mk(1).slice(-4)}`;
  await page.getByRole('button', { name: new RegExp(escapeRegExp(maskedReady)) }).first().click();
  await expect(page.getByRole('button', { name: 'Marcar como ya declarado por otro medio' })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: path.join(outDir, '02-mark-declared-menu.png'), fullPage: true });

  // A3 fase confirm: tras tocar marcar → la confirmación breve.
  await page.getByRole('button', { name: 'Marcar como ya declarado por otro medio' }).click();
  await expect(page.getByRole('button', { name: /Confirmar: marcar como ya declarado/ })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: path.join(outDir, '03-mark-declared-confirm.png'), fullPage: true });
  // Cerramos el sheet por el scrim (testID) para seguir con los filtros.
  await page.getByTestId('mark-declared-scrim').click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('button', { name: 'Marcar como ya declarado por otro medio' })).toHaveCount(0, { timeout: 10_000 });

  // A4: filtros abiertos con el rango de fecha de nacimiento.
  await page.getByRole('button', { name: 'Filtros' }).click();
  await expect(page.getByLabel('Desde (AAAA-MM-DD)', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Desde (AAAA-MM-DD)', { exact: true }).fill('2025-01-01');
  await page.screenshot({ path: path.join(outDir, '04-filtros-fecha.png'), fullPage: true });

  // A4 validación: rango incoherente → error inline en "hasta".
  await page.getByLabel('Hasta (AAAA-MM-DD)', { exact: true }).fill('2023-01-01');
  await expect(page.getByText('La fecha "desde" no puede ser posterior a "hasta".', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: path.join(outDir, '05-filtros-fecha-error.png'), fullPage: true });
});

test('captura: BreedPicker (abierto + con búsqueda) en el alta', async ({ page }) => {
  const user = await createTestUser('shotbreed');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo ShotBreed');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();

  // Wizard → paso datos (1 rodeo auto-avanza al sexo).
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Categoría Vaquillona', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });

  // El trigger de raza en el form (con el hint de SIGSA).
  await page.screenshot({ path: path.join(outDir, '06-alta-breed-trigger.png'), fullPage: true });

  // BreedPicker abierto (lista completa).
  await page.getByRole('button', { name: 'Elegir raza', exact: true }).click();
  await expect(page.getByText('Sin raza — a completar', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(outDir, '07-breedpicker-abierto.png'), fullPage: true });

  // BreedPicker con búsqueda ("ang" → Aberdeen Angus + Brangus).
  await page.getByLabel('Buscar raza por nombre o código', { exact: true }).fill('ang');
  await expect(page.getByRole('button', { name: 'Raza Aberdeen Angus, código AA', exact: true })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: path.join(outDir, '08-breedpicker-busqueda.png'), fullPage: true });
});

test('captura: banner RENSPA en Más + RENSPA en edición del campo', async ({ page }) => {
  const user = await createTestUser('shotrenspa');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo ShotRenspa');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoTab(page, 'Más', page.getByText('Perfil', { exact: true }));

  // Banner RENSPA (informativo) en la sección SENASA.
  const banner = page.getByRole('button', { name: 'Completá el RENSPA del campo para la exportación a SIGSA' });
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(outDir, '09-renspa-banner-mas.png'), fullPage: true });

  // Tap → editar campo → el campo RENSPA en el form.
  await banner.click();
  const renspaField = page.getByLabel('RENSPA (opcional)', { exact: true });
  await expect(renspaField).toBeVisible({ timeout: 20_000 });
  await renspaField.fill('01.001.0.00001');
  await page.screenshot({ path: path.join(outDir, '10-renspa-edicion.png'), fullPage: true });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
