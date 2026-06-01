// e2e/account.spec.ts — red de seguridad de la CUENTA (spec 01, Fase 6 / R2.2/R2.4/R2.5/R2.5.1).
//
// Cubre los flujos administrativos online de la cuenta (el edge `delete_account` ya deployado al
// remoto + el frontend de Fase 6 commiteado):
//   1. Eliminar cuenta — baja simple: la doble confirmación dispara el edge, el signOut local
//      cierra la sesión y el RootGate vuelve al login. (R2.4)
//   2. Eliminar cuenta — bloqueo único-owner: un usuario dueño ÚNICO de un campo NO puede darse
//      de baja → "No podés eliminar tu cuenta todavía" + el campo aparece en la lista. (R2.5/R2.5.1)
//   3. Cambiar email — request (NO el link): la pantalla dedicada dispara el cambio, muestra el copy
//      de confirmación ("Te mandamos un mail a …") y el email mostrado sigue siendo el VIEJO hasta
//      confirmar. (R2.2)
//
// LÍMITE CONOCIDO (documentado): dos cosas NO son automatizables contra el remoto compartido sin un
// servicio de inbox (Inbucket/Mailosaur):
//   1. El click en el LINK de verificación del email (cierra el cambio) — necesita leer el mail.
//   2. El éxito del REQUEST de cambio depende del rate-limit de envío de mails del proyecto remoto:
//      `auth.updateUser({email})` dispara un envío y, con la cuota consumida por otros tests/uso, el
//      remoto devuelve `over_email_send_rate_limit` (429). Por eso el test acepta AMBOS desenlaces
//      (confirmación OK / rechazo por rate-limit) y verifica la propiedad que SÍ es estable y es la
//      load-bearing de R2.2: el email VIEJO se mantiene vigente hasta confirmar el link.
// Lo automatizamos: "pidió el cambio + UI + el viejo sigue vigente". El cierre del cambio (link)
// queda manual / a un inbox-tool futuro.
//
// NOTA sobre "baja simple": un usuario SIN campos aterriza en /onboarding (RootGate) y NO tiene la
// tab "Más" (la zona de peligro vive en mas.tsx, solo accesible en estado 'active'). Para alcanzar la
// UI de baja SIN que la baja se bloquee, sembramos al usuario como MIEMBRO (no-owner) de un campo de
// otro dueño: aterriza en HOME, llega a "Más", y su baja NO se bloquea (no es dueño único de nada).
// Es la baja "no bloqueada" equivalente y el camino realista a la UI.
//
// Usuarios + campos namespaced; cleanup en afterAll + global-teardown. El usuario eliminado queda
// BANEADO + soft-deleted en public.users; cleanupAll lo hard-borra con admin.deleteUser (service_role
// borra usuarios baneados sin problema — verificado en la corrida).

import { test, expect } from './helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishment,
  seedEstablishmentWithRodeo,
  seedRodeo,
  setUserPhone,
  addMember,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, waitForSignIn, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// Login + invoke del edge → más aire que el default de 60s.
test.setTimeout(90_000);

/** Va a la tab "Más" → arranca la baja (botón "Eliminar cuenta") → 1er paso de la doble confirmación. */
async function gotoDeleteAccount(page: import('@playwright/test').Page) {
  const deleteBtn = page.getByRole('button', { name: 'Eliminar cuenta (acción destructiva)' });
  await gotoTab(page, 'Más', deleteBtn);
  await deleteBtn.click();
  // Primer paso de la doble confirmación: tarjeta "¿Eliminar tu cuenta?".
  await expect(page.getByText('¿Eliminar tu cuenta?', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

test('eliminar cuenta (baja simple) cierra sesión y vuelve al login', async ({ page }) => {
  // Dueño "ajeno" del campo + usuario de prueba como MIEMBRO (no-owner) → aterriza en home y su baja
  // NO se bloquea (no es dueño único de nada).
  const fieldOwner = await createTestUser('field-owner');
  const user = await createTestUser('baja');
  await setUserPhone(user.id, '1123456789');
  const estId = await seedEstablishment(fieldOwner.id, 'Campo Compartido');
  await seedRodeo(estId); // C1: sin rodeo el RootGate bloquea al miembro con el wizard de rodeo
  await addMember(user.id, estId, 'field_operator');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoDeleteAccount(page);

  // Segundo paso (doble confirmación, R2.4): "Sí, eliminar mi cuenta". Tras OK el edge da de baja,
  // signOut() local → AuthState 'unauthenticated' → RootGate re-rutea al login.
  await page
    .getByRole('button', { name: 'Sí, eliminar mi cuenta (acción destructiva)' })
    .click();

  // Vuelve a la pantalla de login (sesión cerrada). Damos aire (edge invoke + signOut + re-ruteo).
  await waitForSignIn(page);

  // Verificación server-side (no solo UI): el edge `delete_account` corrió de verdad — el usuario
  // quedó BANEADO + soft-deleted (no fue solo un logout). Así el test no pasa "por la razón
  // equivocada" (un signOut cualquiera también vuelve al login). cleanupAll lo hard-borra después.
  const { data: got, error } = await admin.auth.admin.getUserById(user.id);
  expect(error).toBeNull();
  // Supabase marca el ban con banned_until en el futuro (o 'none'/null si no baneado).
  const bannedUntil = (got?.user as { banned_until?: string | null } | undefined)?.banned_until ?? null;
  const isBanned = bannedUntil != null && bannedUntil !== 'none' && new Date(bannedUntil).getTime() > Date.now();
  expect(isBanned).toBe(true);
});

test('eliminar cuenta bloqueada: el usuario es dueño único de un campo (R2.5/R2.5.1)', async ({
  page,
}) => {
  const user = await createTestUser('soleowner');
  await setUserPhone(user.id, '1123456789');
  // Dueño ÚNICO de un campo → la baja se bloquea (sole_owner). +rodeo: si no, el RootGate (C1) lo
  // bloquea con el wizard de rodeo antes de llegar a home (el rodeo no cambia la propiedad del campo).
  await seedEstablishmentWithRodeo(user.id, 'Campo Unico');
  const fieldName = `${RUN_TAG} Campo Unico`;

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  await gotoDeleteAccount(page);
  await page
    .getByRole('button', { name: 'Sí, eliminar mi cuenta (acción destructiva)' })
    .click();

  // El edge responde sole_owner → la sección pasa a 'blocked'. NO se cerró la sesión.
  await expect(page.getByText('No podés eliminar tu cuenta todavía', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // El campo bloqueante aparece en la LISTA de bloqueantes: su fila trae un botón "Eliminar el campo
  // <name>" (aria-label único de esa lista) → prueba que el campo está listado, sin ambiguar con el
  // título de sección "Campo activo · <name>" (el nombre del campo aparece varias veces en la pantalla).
  await expect(
    page.getByRole('button', { name: `Eliminar el campo ${fieldName} (acción destructiva)` }),
  ).toBeVisible({ timeout: 10_000 });
  // El botón "Reintentar baja" existe pero está deshabilitado mientras queden campos bloqueantes.
  await expect(page.getByRole('button', { name: 'Reintentar baja' })).toBeVisible();
  // Seguimos logueados (no nos sacó al login): el saludo de la home se alcanza volviendo a Inicio.
  await gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/));
});

test('cambiar email: pide confirmación y mantiene el email VIEJO hasta confirmar (R2.2)', async ({
  page,
}) => {
  const user = await createTestUser('email');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Email');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // Más → fila Email → "Cambiar" → pantalla dedicada de cambio de email. (El email row tiene un
  // botón con aria-label "Cambiar email"; lo usamos como ancla de la tab "Más".)
  const cambiarEmailRow = page.getByRole('button', { name: 'Cambiar email' });
  await gotoTab(page, 'Más', cambiarEmailRow);
  await cambiarEmailRow.click();

  // Pantalla "Cambiar email": campo "Nuevo email" + el email actual (VIEJO) visible.
  await expect(page.getByLabel('Nuevo email', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`Email actual: ${user.email}`, { exact: true })).toBeVisible();

  // Pedimos el cambio a un email nuevo (namespaced para no chocar). NO clickeamos el link de
  // verificación (no automatizable contra el remoto sin inbox-tool — ver cabecera del archivo).
  const newEmail = `${RUN_TAG}_changed_${Date.now()}@rafaq-e2e.test`.toLowerCase();
  await page.getByLabel('Nuevo email', { exact: true }).fill(newEmail);
  await page.getByRole('button', { name: 'Cambiar email', exact: true }).click();

  // R2.2 — propiedad LOAD-BEARING que SÍ es automatizable contra el remoto: el email VIEJO se
  // mantiene como vigente. Dos desenlaces, según el rate-limit de envío de mails del remoto
  // compartido (ver cabecera + LÍMITE abajo):
  //   (a) request OK → estado de confirmación: "Te mandamos un mail a <new>" + "tu email sigue
  //       siendo <viejo>" (el viejo explícitamente vigente).
  //   (b) request rechazado por over_email_send_rate_limit (429) → el form queda con un error y el
  //       "Email actual: <viejo>" sigue visible (el viejo NUNCA cambió).
  // En AMBOS la garantía R2.2 se sostiene: el email viejo sigue activo hasta confirmar. Aceptamos
  // cualquiera de los dos y, en los dos, verificamos que el VIEJO persiste.
  const confirmCopy = page.getByText(new RegExp(`Te mandamos un mail a ${escapeRe(newEmail)}`));
  const stillCurrent = page.getByText(`Email actual: ${user.email}`, { exact: true });
  await expect(confirmCopy.or(stillCurrent).first()).toBeVisible({ timeout: 20_000 });

  if (await confirmCopy.isVisible()) {
    // Desenlace (a): el copy nombra explícitamente que el viejo sigue siendo el vigente (R2.2).
    await expect(
      page.getByText(new RegExp(`tu email sigue siendo ${escapeRe(user.email)}`)),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
  } else {
    // Desenlace (b): seguimos en el form; el email actual (VIEJO) sigue mostrándose intacto.
    await expect(stillCurrent).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  }

  // De vuelta en "Más": la fila de Email sigue mostrando el VIEJO (el session no cambió: R2.2). El
  // nuevo email NO quedó activo (no se confirmó el link). El botón "Cambiar email" es el ancla.
  await expect(page.getByRole('button', { name: 'Cambiar email' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
});

/** Escapa una string para usarla literal dentro de un RegExp (el email tiene `.` y `@`). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
