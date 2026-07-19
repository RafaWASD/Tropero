// e2e/telefono.spec.ts — red de seguridad del delta TELÉFONO (spec 01, RTEL.14.3 / RTEL.14.7-UI).
//
// El bug reportado por Raf: los DOS inputs de teléfono de la app no eran equivalentes. En
// `crear-campo` (gate de R3.8) se podían tipear LETRAS y el campo no tenía tope de largo; en el perfil
// de "Más" sí. Ahora los dos montan el mismo `PhoneField`, así que estos tests verifican el
// comportamiento en las DOS pantallas — si volvieran a divergir, una de las dos mitades se pone roja.
//
// Cubre:
//   T16 (RTEL.3.6, RTEL.3.7, RTEL.4.2, RTEL.6.1, RTEL.5.3) — gate de crear-campo: no entran letras, no
//        se pasan los 12 dígitos TIPEABLES, y el submit con un número corto muestra el error inline y NO
//        navega. Ojo: 12 es el tope de TIPEO (RTEL.4.2); la VALIDACIÓN sigue siendo de 10 exactos
//        (RTEL.5.1), así que 11 y 12 dígitos nunca son válidos ni se persisten.
//   T17 (RTEL.3.3, RTEL.3.4) — paridad: el input del perfil se comporta igual.
//   DP4 (RTEL.6.6, RTEL.6.7, RTEL.6.9) — el 15 pegado propone el número corregido y el tap lo aplica.
//
// Usuarios namespaced (@rafaq-e2e.test, RUN_TAG); cleanup en afterAll + global-teardown.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, waitForOnboarding, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// Login + round-trips a Supabase remoto.
test.setTimeout(90_000);

/** Lleva al GATE DE TELÉFONO de crear-campo (usuario SIN teléfono → el gate se muestra). */
async function gotoPhoneGate(page: import('@playwright/test').Page, label: string) {
  const user = await createTestUser(label);
  // A propósito NO seteamos teléfono: es lo que dispara el gate (R3.8).
  await page.goto('/');
  await signIn(page, user);
  await waitForOnboarding(page);
  await page.getByRole('button', { name: 'Crear mi primer campo' }).click();
  await expect(page.getByText('Tu teléfono', { exact: true })).toBeVisible({ timeout: 15_000 });
  return user;
}

/** Va a "Más" y entra en modo edición del perfil. */
async function gotoEditProfile(page: import('@playwright/test').Page) {
  await gotoTab(page, 'Más', page.getByRole('button', { name: 'Editar perfil' }));
  await page.getByRole('button', { name: 'Editar perfil' }).click();
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible({ timeout: 15_000 });
}

test('RTEL.3.6/3.7/4.2: el gate de crear-campo no acepta letras ni pasa los 12 dígitos tipeables', async ({
  page,
}) => {
  await gotoPhoneGate(page, 'gate-tel');
  const phone = page.getByLabel('Teléfono', { exact: true });

  // El adorno +54 es fijo y NO editable: el usuario tipea los 10 dígitos nacionales (RTEL.4.1).
  await expect(page.getByTestId('gate-phone-prefix')).toHaveText('+54');

  // (a) LETRAS — el bug reportado: en esta pantalla se podían tipear. Ahora no queda NINGÚN carácter.
  await phone.pressSequentially('abcdef');
  await expect(phone).toHaveValue('');

  // Mezcladas con dígitos: sobreviven solo los dígitos, agrupados por la máscara.
  await phone.pressSequentially('11abc23de45');
  await expect(phone).toHaveValue('11 2345');

  // (b) TOPE DE 12 DÍGITOS (el otro medio bug: acá no había maxLength). Tipeamos 14 dígitos.
  // Son 12 y no 10 a propósito: con el tope en 10, un celular tipeado con el 15 se recortaba a
  // `11 1523-4567` —10 dígitos VÁLIDOS del número equivocado— y se guardaba sin aviso. Con 12, ese
  // caso llega entero al diagnóstico y a la sugerencia de DP4. La VALIDACIÓN sigue siendo 10 exactos.
  await phone.fill('');
  await phone.pressSequentially('11234567890000');
  // Se quedan los primeros 12, con la máscara del área de 2 dígitos (el excedente va al último grupo).
  await expect(phone).toHaveValue('11 2345-678900');

  // (c) La máscara agrupa según el código de área — 4 dígitos (Chascomús), no `AA NNNN-NNNN` fijo.
  await phone.fill('');
  await phone.pressSequentially('2241430000');
  await expect(phone).toHaveValue('2241 43-0000');
});

test('RTEL.5.3/6.1: el gate con un teléfono corto muestra el error inline y NO avanza', async ({
  page,
}) => {
  await gotoPhoneGate(page, 'gate-err');
  const phone = page.getByLabel('Teléfono', { exact: true });

  // Un número a medio cargar (no 10 dígitos).
  await phone.pressSequentially('11234');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Error INLINE sobre el campo (no banner global que tape el título).
  await expect(page.getByText('Ingresá los 10 dígitos, sin el 0 ni el 15.')).toBeVisible({
    timeout: 10_000,
  });
  // NO navegó: seguimos en el gate (su título es exclusivo de esta pantalla). Se chequea la PRESENCIA
  // del gate y no la ausencia del form de alta: el form nunca llegó a montarse, pero anclarse a una
  // ausencia haría pasar el test por la razón equivocada.
  await expect(page.getByText('Tu teléfono', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear campo', exact: true })).toHaveCount(0);

  // Vacío también se rechaza (el teléfono es obligatorio acá, a diferencia del perfil).
  await phone.fill('');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Ingresá tu teléfono.')).toBeVisible({ timeout: 10_000 });

  // Completo → avanza al form de alta.
  await phone.pressSequentially('1123456789');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crear campo', exact: true })).toBeVisible({
    timeout: 20_000,
  });
});

test('DP4: un número con 15 propone el corregido y el tap lo aplica (RTEL.6.6/6.7/6.9)', async ({
  page,
}) => {
  await gotoPhoneGate(page, 'gate-15');
  const phone = page.getByLabel('Teléfono', { exact: true });

  // Forma corriente de escribir un celular en AR: 11 15 2345 6789 (12 dígitos). No normaliza —el 15
  // NUNCA se remueve al escribir (RTEL.2.8)— pero el sistema PROPONE el número sin el 15.
  await phone.fill('11 15 2345 6789');

  // La sugerencia (AYUDA) no espera al submit; el mensaje de error (RETO) sí. Son dos cosas distintas.
  const suggestion = page.getByTestId('gate-phone-suggestion');
  await expect(suggestion).toHaveText('¿Quisiste decir 11 2345-6789?', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Sacá el 15: no va dentro del número.')).toBeVisible({
    timeout: 10_000,
  });
  // Nada se escribió todavía: la sugerencia PROPONE, no aplica sola (RTEL.6.8).
  await expect(phone).toHaveValue('11 1523-456789');

  // Un tap la aplica; el valor vuelve a entrar por el camino normal y queda válido (RTEL.6.9).
  await suggestion.click();
  await expect(phone).toHaveValue('11 2345-6789');
  await expect(page.getByTestId('gate-phone-suggestion')).toHaveCount(0);

  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crear campo', exact: true })).toBeVisible({
    timeout: 20_000,
  });
});

test('DP4: TIPEAR el 15 dígito a dígito también propone el corregido (RTEL.4.2/6.6/6.7)', async ({
  page,
}) => {
  await gotoPhoneGate(page, 'gate-15-tipeo');
  const phone = page.getByLabel('Teléfono', { exact: true });

  // El caso REAL de la manga: el peón TIPEA su celular como se dice, con el 15. Antes el tope de 10
  // lo recortaba a `11 1523-4567` —10 dígitos formalmente válidos— y el número equivocado se guardaba
  // sin un solo aviso: DP4 solo se disparaba al PEGAR. Ahora los 12 dígitos entran enteros.
  await phone.pressSequentially('111523456789');
  await expect(phone).toHaveValue('11 1523-456789');

  // La sugerencia aparece al terminar de tipear, SIN tocar "Continuar": el mensaje de error espera al
  // intento de guardado (no se reta a mitad del número), pero la AYUDA llega cuando sirve.
  const suggestion = page.getByTestId('gate-phone-suggestion');
  await expect(suggestion).toHaveText('¿Quisiste decir 11 2345-6789?', { timeout: 10_000 });

  // Y hasta que el usuario no la acepte, el número NO pasa: sigue inválido (RTEL.5.1 intacta).
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Sacá el 15: no va dentro del número.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Tu teléfono', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear campo', exact: true })).toHaveCount(0);

  // Un tap corrige y recién ahí avanza.
  await suggestion.click();
  await expect(phone).toHaveValue('11 2345-6789');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Crear campo', exact: true })).toBeVisible({
    timeout: 20_000,
  });
});

test('RTEL.3.3/3.4: el input de teléfono del perfil se comporta IGUAL que el del gate', async ({
  page,
}) => {
  const user = await createTestUser('paridad', 'E2E paridad');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Paridad');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Display de solo lectura: el canónico se muestra agrupado, nunca crudo (RTEL.10.1).
  await gotoTab(page, 'Más', page.getByRole('button', { name: 'Editar perfil' }));
  await expect(page.getByText('+54 11 2345-6789', { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Editar perfil' }).click();
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible({ timeout: 15_000 });
  const phone = page.getByLabel('Teléfono', { exact: true });

  // Mismo adorno, mismo rechazo de letras, mismo tope: es el MISMO componente.
  await expect(page.getByTestId('profile-phone-prefix')).toHaveText('+54');
  await phone.fill('');
  await phone.pressSequentially('abcdef');
  await expect(phone).toHaveValue('');
  await phone.pressSequentially('11abc23de45');
  await expect(phone).toHaveValue('11 2345');
  await phone.fill('');
  await phone.pressSequentially('11234567890000');
  await expect(phone).toHaveValue('11 2345-678900');

  // Guardar con un número incompleto → error inline, no guarda.
  await phone.fill('');
  await phone.pressSequentially('11234');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Ingresá los 10 dígitos, sin el 0 ni el 15.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();

  // RTEL.5.4 — a diferencia del gate, acá el VACÍO sí es válido (el teléfono es opcional en el perfil).
  await phone.fill('');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('button', { name: 'Editar perfil' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Sin teléfono', { exact: true })).toBeVisible();
});
