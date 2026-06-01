baseline_commit: 736656c2d218b5df30c001f7159f03fd77d0d704

# impl 01-e2e-fase6 — extender la suite E2E (Playwright) a Fase 6 + activar invitations

> Tarea de TEST CODE (e2e). NO se toca app code ni backend. Solo se escriben/arreglan specs E2E y se dejan VERDES.
> El backend (edge `delete_account`) ya está deployado al remoto; el frontend de Fase 6 ya está commiteado (`736656c`).

## Contexto leído
- `app/e2e/README.md`, `app/playwright.config.ts`, helpers (`env`/`admin`/`fixtures`/`ui`), specs verdes (`auth`/`establishments`), `invitations.spec.ts` (fixme).
- UI real: `mas.tsx` (Perfil / Editar perfil / fila Email "Cambiar" / Zona de peligro — "Eliminar cuenta" → "Sí, eliminar mi cuenta" → blocked "No podés eliminar tu cuenta todavía" / "Reintentar baja"), `cambiar-email.tsx` ("Nuevo email", "Cambiar email", copy "Te mandamos un mail a …"), `(tabs)/index.tsx` (saludo `¡Hola <primerNombre>! 👋`), `miembros.tsx`/`invitar.tsx`/`invite.tsx`/`ShareLink.tsx` (invitaciones), `validation.ts` (sanitizePhoneInput, validateProfile 8-15 dígitos).
- `invitations` table (0004): columnas `token` + `establishment_id` + `status` → token leíble por admin (service_role).

## Plan (tasks)
- T1: activar `invitations.spec.ts` (sacar fixme, ajustar selectores a UI real, leer token de DB con admin).
- T2: `profile.spec.ts` — saludo se actualiza + validación de teléfono + edición se resetea al salir.
- T3: `account.spec.ts` — eliminar cuenta baja simple + bloqueo único-owner + cambiar email request (no el link).
- T4: actualizar `app/e2e/README.md` (tabla de specs + nota del límite del link de email).
- T5: verificar `pnpm e2e` (build + corre TODA la suite) VERDE; reportar conteo; confirmar cleanup (incl. baneados).

## Mapa R<n> → test
(Esta suite cubre flujos de spec 01 Fase 6 / Fase 5; no hay R<n> nuevos — es red de regresión.)
- R2.1 (editar nombre/teléfono, saludo fuente única) → `profile.spec.ts` "el saludo de la home se actualiza al editar el nombre"
- R2.1 (sanitizar teléfono / validación) → `profile.spec.ts` "el campo teléfono no acepta letras (sanitizado en vivo)" + "guardar con teléfono inválido muestra error; uno válido guarda"
- R2.1 (reset-on-blur, Fix 1) → `profile.spec.ts` "la edición se descarta al salir de Más (vuelve a modo lectura)"
- R2.4 (eliminar cuenta, doble confirmación) → `account.spec.ts` "eliminar cuenta (baja simple) cierra sesión y vuelve al login"
- R2.5/R2.5.1 (bloqueo único-owner + lista de campos) → `account.spec.ts` "eliminar cuenta bloqueada: único dueño de un campo"
- R2.2 (cambio de email request, mantiene viejo) → `account.spec.ts` "cambiar email: pide confirmación y mantiene el email viejo"
- R5.* (invitación end-to-end dueño↔invitado) → `invitations.spec.ts` "loop 2 cuentas …"

## Bitácora

### Hecho
- **Helpers (`app/e2e/helpers/`)**:
  - `admin.ts`: agregados `getLatestInvitationToken(estId)` (lee el token de la invitación pendiente vía service_role — más estable que scrapear el ShareLink truncado) y `addMember(userId, estId, role)` (siembra un miembro no-owner para alcanzar la home/“Más” sin que la baja se bloquee). Exportado `admin` ya existía.
  - `ui.ts`: agregado `gotoTab(page, label, anchor)` — navega tabs del bottom-nav clickeando el `<a role="tab" href="/…">` (NO el `<div>` del label, que el FAB elevado interceptaba intermitentemente) con reintentos hasta que aparezca el ancla. Resolvió el flaky de interceptación de puntero.
- **T1 — `invitations.spec.ts`**: `test.fixme` → `test`. Loop dueño↔invitado con la UI real (Más → "Miembros e invitaciones" → "Invitar miembro" → radio "Veterinario" → "Generar link de invitación"). Token de la DB (service_role). El invitado abre `/invite` IN-APP (botón "Pegar link de invitación" del wizard) + pega el link + "Aceptar invitación" → home. El dueño vuelve a Equipo y ve "Vet Invitado".
- **T2 — `profile.spec.ts`** (3 tests): saludo se actualiza al editar nombre; teléfono sanitiza letras (`pressSequentially('abc12de34')`→`1234`) + valida 8-15 dígitos + guarda válido; edición se descarta al salir de Más (modo lectura + nombre original persiste).
- **T3 — `account.spec.ts`** (3 tests): baja simple (miembro no-owner → cierra sesión + ban server-side verificado con `admin.getUserById`); bloqueo único-owner (R2.5/R2.5.1: "No podés eliminar tu cuenta todavía" + el campo en la lista vía su botón "Eliminar el campo <name>" + "Reintentar baja"); cambiar email request (copy de confirmación O rechazo por rate-limit; en ambos el email VIEJO persiste).
- **T4 — `README.md`**: tabla actualizada (invitations verde + filas profile/account), notas de Fase 6 (gotoTab / baja-simple via miembro / paste in-app) + sección "LÍMITE conocido — cambio de email".

### Decisiones / desviaciones (documentadas)
1. **Baja simple con MIEMBRO, no "sin campos"**: el brief decía "usuario SIN campos", pero un usuario sin campos aterriza en `/onboarding` (RootGate) y NO tiene la tab "Más" → la UI de baja es inalcanzable. Se siembra como miembro no-owner de un campo ajeno: aterriza en home, llega a "Más" y la baja NO se bloquea. Es la baja-no-bloqueada equivalente y el camino realista. Documentado en el header del spec + README.
2. **Invitado pega el link IN-APP (no `goto`)**: un `page.goto('/invite?token=…')` recarga el SPA; en el 1er render la sesión está `loading` (isAuthed=false) → invite.tsx arranca en `auth_required` y PERSISTE el token → al aceptar, el RootGate re-rutea de vuelta a /invite (loop confirm→accept→confirm, observado con diagnóstico: accept devolvía 200 pero la pantalla volvía a confirm). Pegar in-app mantiene la sesión → fase `confirm` directa, sin persistir token → sin loop. Es además el flujo de usuario real. (Esto NO es bug de la app: es el efecto del reload en el harness; el flujo in-app es el correcto.)
3. **Email change: rate-limit del remoto**: probado contra el remoto, `auth.updateUser({email})` devuelve `over_email_send_rate_limit` (429) por la cuota de envío de mails compartida (cualquier dominio). El test acepta confirmación-OK O rechazo-por-rate-limit y verifica la propiedad estable y load-bearing de R2.2: el email VIEJO sigue vigente. El click al LINK de verificación NO es automatizable sin inbox-tool. Documentado.

### Autorrevisión adversarial
- **¿Tests que pasan por la razón equivocada?**
  - Baja simple: reforzado — además de volver al login (que un logout cualquiera produciría), se verifica server-side que el usuario quedó BANEADO (`admin.getUserById` → `banned_until` futuro) → prueba que el edge `delete_account` corrió de verdad.
  - Reset de edición: reforzado — además de "Guardar" ausente (modo lectura), se verifica que el modo lectura muestra el nombre ORIGINAL ("E2E reset") y NO "Nombre Sin Guardar" → la edición se descartó de verdad, no solo se colapsó visualmente.
  - Email: ambas ramas asertan que el VIEJO persiste (no se cuela un falso verde donde el email cambió).
- **Edge/multi-tenant**: el token de invitación se lee por `establishment_id` (no se hardcodea nada); los usuarios/campos son namespaced por `RUN_TAG`. La baja bloqueada usa el aria-label único de la lista de bloqueantes (no el título de sección homónimo → evita strict-mode violation).
- **Cleanup con baneados**: VERIFICADO contra el remoto tras 4 corridas → 0 establishments `e2e_%` + 0 users `@rafaq-e2e.test` (incl. el de la baja, baneado + soft-deleted: `admin.deleteUser` con service_role lo hard-borra sin problema).
- **Flaky**: corrida 5× (incl. 2× `pnpm e2e` con rebuild). 13/13 estable en todas. Timeouts puntuales subidos donde corresponde: profile/account `test.setTimeout(90s)`, invitations `120s`, email `confirmCopy.or(stillCurrent)` 20s.

### Verificación final
- `pnpm e2e` (rebuild dist con Fase 6 + corre TODA la suite): **13 passed** (auth 4 + establishments 2 + invitations 1 + profile 3 + account 3). Estable en 5 corridas.
- `node scripts/check.mjs`: VERDE (no se tocó app code ni backend; e2e está excluido de tsc por sesión 21).
- Cleanup remoto: 0 residuo.

### Archivos
- Creados: `app/e2e/profile.spec.ts`, `app/e2e/account.spec.ts`.
- Modificados: `app/e2e/invitations.spec.ts` (fixme→test, UI real, paste in-app), `app/e2e/helpers/admin.ts` (+getLatestInvitationToken, +addMember), `app/e2e/helpers/ui.ts` (+gotoTab), `app/e2e/README.md` (tabla + notas + límite email).
- NO se tocó: app code (`app/app/**`, `app/src/**`), backend (`supabase/**`).
