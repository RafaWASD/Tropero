# E2E (Playwright) — build WEB de RAFAQ contra Supabase REMOTO

Red de seguridad de regresión para los flujos críticos del cliente (auth + establecimientos).
Es donde aparecen bugs de runtime que `tsc --noEmit` y los unit tests no atrapan: loops de
render, 403 RLS al crear campo, listas que no refrescan, el switch que no cambia el activo.

## Qué prueba (y qué NO)

- **Testea el build WEB** (`expo export -p web` → `app/dist`), servido estático con `serve -s`.
- **Corre contra el Supabase REMOTO** (mismo proyecto que la app), con usuarios de test
  pre-confirmados creados/borrados vía `service_role`.
- **NO testea nativo**: BLE, push notifications, deep-links nativos y secure-store quedan
  fuera (son específicos de device/RN, no del bundle web). En web, secure-store cae a
  `localStorage` (ver `src/services/supabase.ts`), así la sesión funciona igual.

## Cómo se corre

Desde `app/` (pnpm; en PowerShell usá `pnpm.cmd`):

```bash
pnpm e2e          # build estático + corre la suite (recomendado)
pnpm e2e:build    # solo el build web (genera app/dist)
pnpm e2e:test     # solo corre Playwright (reusa el app/dist ya generado)
```

- El build se hace una vez (`e2e:build`); `pnpm e2e:test` lo reusa para iteraciones rápidas.
- El servidor estático corre en **http://localhost:8099** (NO el 8081 de Metro/Raf).
- Un solo project: **chromium headless**. Soporta múltiples browser contexts (para el loop de
  2 cuentas de `invitations.spec.ts`).

Primera vez en una máquina nueva: `pnpm exec playwright install chromium`.

## Qué env necesita

La suite carga `.env.local` igual que `supabase/tests/rls/run.cjs` (sin pisar `process.env`):

1. `<repoRoot>/.env.local` — tiene `SUPABASE_SERVICE_ROLE_KEY` (crea/borra usuarios de test) y
   también las `EXPO_PUBLIC_*`.
2. `app/.env.local` — tiene `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (también
   se hornean en el bundle web al exportar).

Vars requeridas (si falta alguna, la suite tira con un mensaje claro):

- `EXPO_PUBLIC_SUPABASE_URL` (o `SUPABASE_URL`)
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (o `SUPABASE_ANON_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY`

> Ambos `.env.local` están gitignored — no se commitean. En un worktree nuevo, copialos del
> árbol principal:
> `cp C:/DEV/RAFAQ/app-ganado/.env.local <worktree>/.env.local`
> `cp C:/DEV/RAFAQ/app-ganado/app/.env.local <worktree>/app/.env.local`

## DB compartida — limpieza

El remoto se comparte con el testing manual de Raf, así que la suite es **colisión-safe**:

- Usuarios namespaced bajo `@rafaq-e2e.test` con un `RUN_TAG` único por corrida.
- Campos namespaced con el `RUN_TAG` en el nombre.
- Todo se borra en `afterAll` de cada spec **y** en `global-teardown.ts` (barrido final por
  `service_role` con CASCADE). No deja basura ni pisa datos reales.

## Specs

| Spec | Estado | Cubre |
|------|--------|-------|
| `auth.spec.ts` | ✅ verde | login (pre-confirmado → onboarding), validación de sign-up en cliente, login con credenciales malas, logout → login |
| `establishments.spec.ts` | ✅ verde | crear campo desde onboarding con gate de teléfono → home; ≥2 campos → "Mis campos" → elegir → home |
| `invitations.spec.ts` | ✅ verde | loop de 2 cuentas (dueño invita por link → token leído de la DB con service_role → invitado **pega el link in-app** y acepta → dueño ve al miembro) |
| `profile.spec.ts` | ✅ verde | Fase 6 R2.1: el saludo de la home se actualiza al editar el nombre (fuente única); el teléfono sanitiza letras + valida 8-15 dígitos; la edición se descarta al salir de "Más" (modo lectura) |
| `account.spec.ts` | ✅ verde | Fase 6 R2.2/R2.4/R2.5: eliminar cuenta — baja no bloqueada (cierra sesión + ban server-side); bloqueo único-owner (R2.5/R2.5.1, lista de campos); cambiar email — request + el viejo sigue vigente (NO el link) |

Total: **13 tests** (`pnpm e2e`).

### Notas de los specs de Fase 6

- **Navegación de tabs** (`helpers/ui.ts → gotoTab`): el target clickeable del bottom-nav es el
  `<a role="tab" href="/…">` (React Navigation web), NO el `<div>` del label de texto — clickear el
  label hacía que el FAB elevado interceptara el puntero de forma intermitente. `gotoTab` clickea el
  `role=tab` y reintenta hasta que un ancla de la pantalla destino esté visible.
- **`account.spec.ts` "baja simple"**: un usuario SIN campos aterriza en `/onboarding` y NO tiene la
  tab "Más" (la zona de peligro vive en `mas.tsx`, estado `active`). Para alcanzar la UI de baja SIN
  que la baja se bloquee, el usuario se siembra como MIEMBRO (no-owner) de un campo de otro dueño:
  aterriza en HOME y su baja no se bloquea. Es la baja "no bloqueada" equivalente y el camino real.
- **`invitations.spec.ts`**: el invitado abre `/invite` por NAVEGACIÓN IN-APP (botón "Pegar link de
  invitación" del wizard) y pega el link — NO con `page.goto('/invite?token=…')`. Un `goto` recarga el
  SPA y, en el primer render, la sesión está `loading` (isAuthed=false) → `invite.tsx` arranca en
  `auth_required` y PERSISTE el token → al aceptar, el RootGate re-rutea de vuelta a /invite (loop).
  Pegar in-app mantiene la sesión → fase `confirm` directa, sin persistir token, sin loop.

## LÍMITE conocido — cambio de email (link de verificación)

El test `account.spec.ts` "cambiar email" automatiza **el request + la UI + que el email VIEJO siga
vigente** (la propiedad load-bearing de R2.2: Supabase mantiene el viejo hasta confirmar). NO clickea
el LINK de verificación: cerrar el cambio requiere LEER el mail, lo que no es automatizable contra el
remoto sin un servicio de inbox (Inbucket / Mailosaur). Además, el ÉXITO del request depende del
rate-limit de envío de mails del proyecto remoto compartido: con la cuota consumida por otros
tests/uso, `auth.updateUser({email})` devuelve `over_email_send_rate_limit` (429). Por eso el test
acepta AMBOS desenlaces (confirmación OK / rechazo por rate-limit) y, en los dos, verifica que el
email viejo persiste. Cerrar el cambio (click al link) queda manual / a un inbox-tool a futuro.

## Notas / fricciones de testear web

- La app es SPA (un solo `index.html`): `serve -s` hace fallback de cualquier ruta a
  `index.html` porque el routing es client-side (Expo Router). Los specs navegan a `/` y el
  AuthGate (`app/_layout.tsx` → `RootGate`) re-rutea según el estado; por eso esperamos por
  TEXTO/ROL visible, no por URL.
- Selectores: `FormField` monta un `<input>` con `aria-label={label}` en web → `getByLabel`.
  `Button` pasa `role="button"` + el texto → `getByRole('button', { name })`. Las
  confirmaciones destructivas usan `window.confirm` en web → se manejan con `page.on('dialog')`.
- Timeouts amplios (splash + carga del bundle de 5.3 MB + round-trips a Supabase remoto). Si
  algún flujo resulta flaky headless, está documentado en el reporte de la corrida.
```
