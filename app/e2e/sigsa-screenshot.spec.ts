// e2e/sigsa-screenshot.spec.ts — CAPTURAS de la pantalla de exportación SIGSA para el veto de
// design-review (spec 08). NO es una red de seguridad de comportamiento (eso es sigsa-export.spec.ts):
// sólo siembra estados y captura PNG a 412×915 para vetear descendentes / jerarquía / criticidad.
// Throwaway: se puede borrar tras el veto.

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
import { signIn, waitForHome, gotoTab } from './helpers/ui';
import { expect } from '@playwright/test';

// Salida en design/veto-sigsa-export/ (convención del repo para capturas de veto, igual que
// dedup-screenshot.spec.ts). app/e2e → repo root → design/veto-sigsa-export.
const outDir = path.join(__dirname, '..', '..', 'design', 'veto-sigsa-export');

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

test('captura: lista listos / a-completar + historial', async ({ page }) => {
  const user = await createTestUser('sigsashot');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Captura', {
    rodeoRawName: true,
    rodeoName: 'Cría hembras',
  });

  // 2 listos (con raza) + 1 a completar (sin raza). Tags ÚNICOS por corrida Y entre sí (animals.
  // tag_electronic tiene unique GLOBAL y `animals` NO se borra en cascada → un tag fijo leakea entre runs).
  // Formato: '032' (prefijo país AR) + 11 díg del timestamp + 1 díg de suffix = 15 exactos (sin slice que
  // recorte el suffix → cada animal tiene un tag distinto).
  const base = Date.now().toString().slice(-11).padStart(11, '0');
  const mk = (n: number) => `032${base}${n}`;
  const p1 = await seedAnimal(establishmentId, rodeoId, { idv: 'A100', tag: mk(1), sex: 'female', birthDate: '2025-08-10' });
  const p2 = await seedAnimal(establishmentId, rodeoId, { idv: 'A101', tag: mk(2), sex: 'male', birthDate: '2025-09-01' });
  await seedAnimal(establishmentId, rodeoId, { idv: 'A102', tag: mk(3), sex: 'female', birthDate: '2025-07-20' });
  await setBreed(p1, 'AA');
  await setBreed(p2, 'H');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoTab(page, 'Más', page.getByText('Perfil', { exact: true }));
  await page.getByRole('button', { name: 'Exportar las caravanas electrónicas para declarar en SIGSA' }).click();
  await expect(page.getByRole('button', { name: 'Exportar 2 animales' })).toBeVisible({ timeout: 30_000 });

  await page.screenshot({ path: path.join(outDir, 'sigsa-listos.png'), fullPage: true });

  await page.getByRole('button', { name: 'A completar (1)' }).click();
  await expect(page.getByText('Falta la raza', { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(outDir, 'sigsa-a-completar.png'), fullPage: true });

  await page.getByRole('button', { name: 'Historial (0)' }).click();
  await expect(page.getByText('Sin exportaciones todavía', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(outDir, 'sigsa-historial-vacio.png'), fullPage: true });

  // Filtros abiertos.
  await page.getByRole('button', { name: 'Listos (2)' }).click();
  await page.getByRole('button', { name: 'Filtros' }).click();
  await expect(page.getByRole('button', { name: 'Filtrar los pendientes por rodeo' })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: path.join(outDir, 'sigsa-filtros.png'), fullPage: true });
});
