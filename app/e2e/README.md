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
| `invitations.spec.ts` | ⏸ `test.fixme` | loop de 2 cuentas (dueño invita por link, invitado acepta, dueño ve al miembro) |

## Habilitar `invitations.spec.ts` (post-B.1.3)

El frontend de invitaciones (Más → Equipo → Invitar, `/invite`, AcceptInvitation) **aún no está
commiteado en este branch** — hoy "Equipo" es un stub "Próximamente". Cuando se commitee B.1.3:

1. En `invitations.spec.ts`, cambiá `test.fixme(...)` por `test(...)`.
2. Ajustá los selectores marcados como TENTATIVOS a la UI real de invitaciones/miembros.
3. Corré `pnpm e2e` y verificá verde.

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
