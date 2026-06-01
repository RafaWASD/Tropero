// e2e/profile.spec.ts — red de seguridad del PERFIL (spec 01, Fase 6 / R2.1).
//
// Cubre los flujos de perfil donde Raf vio bugs de runtime (el saludo "Hola Raf" que no se
// actualizaba; la validación de teléfono; la edición que persistía al salir de "Más"):
//   1. El saludo de la home se actualiza al editar el nombre (ProfileContext = fuente única, Fase 6).
//   2. Validación de teléfono: el campo NO acepta letras (sanitizado en vivo); guardar con teléfono
//      inválido muestra error; uno válido guarda OK.
//   3. La edición se descarta al salir de "Más" (useFocusEffect → vuelve a modo lectura, Fix 1).
//
// Usuarios + campos namespaced (@rafaq-e2e.test, RUN_TAG); cleanup en afterAll + global-teardown.
// Cada usuario se siembra con teléfono + un campo → aterriza en HOME (no en onboarding) y puede ir
// a la tab "Más".

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishment,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// Login + round-trips a Supabase remoto → un poco más de aire que el default de 60s.
test.setTimeout(90_000);

/** Va a la tab "Más" (espera a que cargue el perfil) → entra en modo "Editar perfil" (con "Guardar"). */
async function gotoEditProfile(page: import('@playwright/test').Page) {
  await gotoTab(page, 'Más', page.getByRole('button', { name: 'Editar perfil' }));
  await page.getByRole('button', { name: 'Editar perfil' }).click();
  // El form de edición monta "Guardar" + los campos Nombre/Teléfono.
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible({ timeout: 15_000 });
}

test('el saludo de la home se actualiza al editar el nombre (fuente única — Fase 6)', async ({
  page,
}) => {
  // El usuario se crea con name "E2E saludo" → el saludo muestra el PRIMER nombre: "E2E".
  const user = await createTestUser('saludo', 'E2E saludo');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishment(user.id, 'Campo Saludo');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Saludo inicial: primer nombre del name sembrado.
  await expect(page.getByText('¡Hola E2E! 👋', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Editar perfil → cambiar el nombre → Guardar.
  await gotoEditProfile(page);
  await page.getByLabel('Nombre', { exact: true }).fill('Raf Probado');
  await page.getByRole('button', { name: 'Guardar' }).click();

  // Tras guardar volvemos a modo lectura (el form desaparece). El ProfileContext se refresca.
  await expect(page.getByRole('button', { name: 'Editar perfil' })).toBeVisible({ timeout: 15_000 });

  // Volver a la home: el saludo refleja el nombre NUEVO (bug "Hola Raf" — fuente única public.users).
  await gotoTab(page, 'Inicio', page.getByText('¡Hola Raf! 👋', { exact: true }));
});

test('el campo teléfono no acepta letras (sanitizado en vivo) y valida al guardar', async ({
  page,
}) => {
  const user = await createTestUser('tel', 'E2E tel');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishment(user.id, 'Campo Tel');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoEditProfile(page);

  const phone = page.getByLabel('Teléfono', { exact: true });

  // 1. Sanitizado en vivo: tipear letras → NO quedan en el campo (sanitizePhoneInput descarta lo no
  //    numérico/separador). Limpiamos primero y escribimos basura mixta.
  await phone.fill('');
  await phone.pressSequentially('abc12de34');
  await expect(phone).toHaveValue('1234');

  // 2. Guardar con teléfono inválido (muy corto: < 8 dígitos) → error de validación, NO guarda.
  await phone.fill('');
  await phone.pressSequentially('123');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Ingresá un teléfono válido (8 a 15 dígitos).')).toBeVisible({
    timeout: 10_000,
  });
  // Sigue en modo edición (no guardó): el botón "Guardar" persiste.
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();

  // 3. Teléfono válido → guarda OK y vuelve a modo lectura.
  await phone.fill('');
  await phone.pressSequentially('11 2345 6789');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('button', { name: 'Editar perfil' })).toBeVisible({ timeout: 15_000 });
});

test('la edición se descarta al salir de Más (vuelve a modo lectura, Fix 1)', async ({ page }) => {
  const user = await createTestUser('reset', 'E2E reset');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishment(user.id, 'Campo Reset');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoEditProfile(page);

  // Cambiar un campo SIN guardar.
  await page.getByLabel('Nombre', { exact: true }).fill('Nombre Sin Guardar');

  // Navegar a la home (sale de "Más" → blur de la pantalla) y volver a "Más".
  await gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/));
  // useFocusEffect reseteó editing=false → al volver estamos en modo LECTURA: el botón "Editar
  // perfil" (ancla de la pantalla en lectura) está visible y el "Guardar" del form NO.
  await gotoTab(page, 'Más', page.getByRole('button', { name: 'Editar perfil' }));
  await expect(page.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
  // Y la edición SE DESCARTÓ (no solo se colapsó): el modo lectura muestra el nombre ORIGINAL, no el
  // que tipeamos sin guardar. (Re-entrar a editar re-lee profile.name, que nunca se persistió.)
  await expect(page.getByText('E2E reset', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Nombre Sin Guardar', { exact: true })).toHaveCount(0);
});
