# Security review (code) — B.1.3 Fase 5 spec 01: invitaciones y miembros

**Modo**: `code` (Gate 2). **Baseline**: `1a5d6aa` (registrado en `progress/impl_01-frontend-fase5.md:1`).
**Superficie**: cambios SIN commitear del working tree de `C:\DEV\RAFAQ\app-ganado`. Cliente Expo (`app/`).
Backend NO tocado (confirmado: `git diff --name-only 1a5d6aa` no incluye `supabase/`).

## Veredicto: PASS

No se encontraron findings HIGH-confidence explotables en la superficie de cambio. El cliente delega
toda autorización al server (RLS + Edge Functions con `requireOwnerOf`), no asume permisos que el
backend no chequea, y no expone PII cross-tenant ni secretos en logs. Los puntos del modelo de amenaza
del brief se resolvieron como NO-HIGH (detalle abajo, con veredicto explícito en el #2 que pedías).

La decisión final es de Raf — esto es input para la puerta humana, no una aprobación.

---

## Metodología aplicada

- Leí los 9 archivos de la superficie + el progress del implementer.
- Para validar las SUPOSICIONES DE CONFIANZA del cliente (que delega autorización al server), leí los
  contratos server-side que NO están en scope pero que el cliente da por sentados: `_shared/auth.ts`
  (`requireUser`/`requireOwnerOf`), `accept_invitation/index.ts`, `invite_user/index.ts`, y las RLS
  `0006_rls_users.sql` / `0008_rls_membership.sql`. Esto es para verificar exploitability, no para
  auditar el backend (ajeno).
- Corrí la metodología de `sentry-skills:security-review` (data-flow + exploitability) + la guía
  JS/TS/React + la referencia de authorization/IDOR.
- Tracé el origen de cada input: ninguno de los sinks peligrosos clásicos (eval/innerHTML/
  dangerouslySetInnerHTML/SQL string-interp/exec) aparece en la superficie.

---

## Modelo de amenaza del brief — veredicto punto por punto

### 1. Aislamiento entre tenants (lo crítico de RAFAQ) — OK, no explotable desde el cliente

`loadMembers` (`app/src/services/members.ts:181-203`) y `loadPendingInvitations` (`:222-245`) filtran
por `establishment_id` (que llega del CONTEXTO del campo activo, `miembros.tsx:94-98`, NUNCA
hardcodeado ni atacante-controlado) **y** dependen de RLS server-side:

- `user_roles_select` (`0008:11-17`): un no-owner solo ve su propia fila; el owner ve todas las de SU
  campo (`is_owner_of`). No hay forma de que el `.eq('establishment_id', X)` del cliente devuelva filas
  de un campo donde el usuario no tiene rol: RLS lo corta server-side aunque un cliente modificado
  pasara un `establishment_id` ajeno (devolvería 0 filas, no un leak).
- `invitations_select` (`0008:46-55`): owner-only (o match por email del invitado). Mismo razonamiento.

**Enumeración de campos/miembros ajenos**: no es posible. Aunque un atacante reemplace el `establishment_id`
en la llamada (es un input que él controla en un cliente modificado), la RLS es el gate real y filtra por
`auth.uid()` / `is_owner_of()`. El cliente NO es la frontera de seguridad acá, y está bien que no lo sea.

### 2. Minimización de datos (hallazgo conocido #2) — veredicto explícito: NO es HIGH; hardening aceptable diferido

Pedías veredicto explícito. **No es HIGH.** Razones:

- **No es cross-tenant.** La `users_select_coworkers` (`0006:16-31`) solo expone filas de users con los
  que el atacante **comparte un establishment activo** — es decir, co-miembros del MISMO campo, gente
  que ya trabaja junta. No hay fuga entre tenants distintos. El peor caso es: un operario de un campo
  podría, con un cliente modificado, pedir `phone`/`email` de OTROS miembros de SU PROPIO campo.
- **El cliente honesto ya minimiza**: `loadMembers` hace `select('role, user_id, user:users ( id, name )')`
  (`members.ts:187`) — nunca pide phone/email. El tipo `Member` (`:39-46`) ni siquiera tiene esos campos.
- **Severidad real**: exposición de PII (teléfono/email) entre co-trabajadores de un mismo campo, que
  requiere un cliente modificado para explotarse. En el modelo de RAFAQ (campos chicos, gente que se
  conoce), es bajo impacto. Es un **defense-in-depth / minimización** legítimo, no un agujero explotable
  con impacto serio.
- **Ya está documentado y diferido conscientemente**: la propia migration `0006:13-15` dice que la view
  de columnas mínimas es trabajo futuro (T5.1), y el impl lo registra como TODO (`impl:160-162`).

**Recomendación (NO bloqueante)**: cuando se haga la view de columnas mínimas (id+name) de `users`,
cerrar este hardening. Mientras tanto, dejar registrado en `docs/backlog.md` si no está. Esto pertenece
al backend (RLS/migrations), no a esta superficie de cambio de cliente — el cliente ya hace lo correcto.

### 3. Modelo bearer (ADR-014) — OK, sin riesgo nuevo; el server valida todo

`accept_invitation` valida server-side y NO confía en el cliente:
- `requireUser` exige JWT válido (`auth.ts:9-25`).
- Lookup del token por admin client (`accept_invitation:42-52`) → 404 si no existe.
- Estado `pending` (`:54-60`) → single-use de facto (un token aceptado/cancelado da `invalid_state`).
- Expiración (`:62-70`).
- Bloqueo duro de doble-rol (`:75-91`, `already_member`).

El cliente (`acceptInvitation`, `members.ts:339-345`) solo manda el token; toda la lógica de validez
vive en el edge. El token es un secreto bearer por DISEÑO (cualquiera con el link acepta) — postura ya
aceptada en ADR-014, sin riesgo NUEVO introducido por esta superficie.

**Persistencia del token (secure-store native / localStorage web, `pending-invitation.ts`)**: en web el
token queda en `localStorage` (`:32`, `:40`). Esto es consistente con cómo el adapter de auth de Supabase
ya guarda la sesión (mismo dominio de exposición — un XSS en la app web ya comprometería la sesión, no
solo el token de invitación). No introduce una superficie peor que la ya existente. La app no tiene
sinks de XSS en esta superficie (ver "Sinks revisados"), así que no hay vector práctico para robar el
token vía la propia app. NO-HIGH.

### 4. Privilegios (vertical/horizontal escalation) — OK, server-enforced

- El cliente NUNCA asume autorización que el server no chequee. `invitar.tsx:42-43` gatea el form por
  `state.role === 'owner'`, pero es solo UX: el server re-valida con `requireOwnerOf` en `invite_user:71`,
  `cancel/resend/remove/change`. Un no-owner que invoque la función directo recibe 403 `forbidden`.
- **¿Invitar/promover a `owner` desde el cliente burlando el 400?** No. El tipo `InvitableRole`
  (`members.ts:250`) es `'field_operator' | 'veterinarian'` y `ROLE_OPTIONS` (`invitar.tsx:32-35`) no
  incluye owner. Aunque un cliente modificado mandara `role: 'owner'`, el server lo rechaza:
  `ALLOWED_ROLES` en `invite_user:22` excluye owner → 400 `invalid_input`. `change_member_role` toma
  `InvitableRole` también (`members.ts:324-334`) y el backend valida igual. El cliente NO es el gate, y
  el gate server-side existe y es correcto.
- **Self-actions del owner**: `canManage = isOwner && !isCurrentUser` (`miembros.tsx:220`) impide en UI
  que el owner se auto-remueva/degrade; el backend `last_owner` es el guard real (no se puede dejar el
  campo sin dueño). Defensa en profundidad correcta.

### 5. Re-ruteo R5.13 en RootGate — OK, no abre hueco de usar token de otro

El token persistido es del PROPIO flujo del dispositivo (lo escribió `invite.tsx` en `auth_required`,
estado deslogueado de ESE device). El re-ruteo (`_layout.tsx:194-214`) solo lo recupera tras
`authenticated && emailVerified` y lo pasa como param a `/invite`, que llama a `accept_invitation`. El
server hace el lookup por token y aplica TODAS sus validaciones (incluido `already_member`). No hay forma
de "usar el token de otro usuario": quien quede logueado en el device es quien acepta, y el server decide
si corresponde. Limpieza del state del token en logout (`_layout.tsx:135-143`) evita arrastrar un token
entre sesiones de cuentas distintas en el mismo proceso. NO-HIGH.

---

## Sinks peligrosos revisados (todos ausentes/seguros en la superficie)

- **XSS / DOM injection**: no hay `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`,
  `document.write`. Las URLs (`url`, `acceptUrl`) se renderizan como `{texto}` en `<Text>` de Tamagui
  (auto-escapado, `ShareLink.tsx:78-88`, `miembros.tsx:603-613`) y se pasan a `Clipboard.setStringAsync`
  / `Share.share` (no son sinks de ejecución). No se usan en `href`/`location`/`window.open`.
- **Inyección**: no hay SQL string-interp ni `child_process`/`exec`. Las queries son PostgREST
  parametrizado (`.eq(...)`), no string building.
- **Secret logging**: `grep` de `console.*` en los 9 archivos → 0 resultados. El token NO se loguea.
  (El backend sí tiene `console.warn/error` pero es ajeno y no loguea el token crudo.)
- **Prototype pollution**: no hay `Object.assign`/`_.merge`/`$.extend` con input de request.
- **parseInviteToken** (`utils/invite.ts:41-88`): lógica pura, `new URL` + regex acotada
  (`[^&\s]+`, sin backtracking catastrófico), `decodeURIComponent` envuelto en try/catch. El token
  extraído va al server, que es el validador real. Sin riesgo.

---

## Falsos positivos descartados (trazabilidad)

- **"loadMembers/loadPendingInvitations confían en un `establishment_id` controlado por el cliente"** →
  descartado: el `establishment_id` viene del contexto del campo activo, y aunque fuera tampering, RLS es
  el gate server-side. El cliente no es la frontera de seguridad y no se le pide que lo sea.
- **"El gating de owner en `invitar.tsx`/`miembros.tsx` es la única defensa"** → descartado: es UX; el
  server re-valida con `requireOwnerOf` en cada Edge Function. Verificado leyendo los index.ts.
- **"`role: 'owner'` se podría inyectar para auto-promoverse"** → descartado: `ALLOWED_ROLES` server-side
  excluye owner (400). El tipo del cliente también lo excluye (doble defensa).
- **"localStorage del token = leak"** → descartado como HIGH: mismo dominio de exposición que la sesión de
  auth ya persistida; sin sinks XSS en la app que permitan robarlo en la práctica.

---

## Cobertura indirecta / no cubierta por la skill (revisión manual aplicada)

`sentry-skills:security-review` no modela nativamente: **RLS de Postgres/Supabase**, **Edge Functions de
Deno**, **el modelo bearer de ADR-014**, ni **multi-tenancy de RAFAQ**. Esos dominios — que son
exactamente el modelo de amenaza del brief — los cubrí MANUALMENTE leyendo las migrations de RLS y los
contratos de las Edge Functions para verificar que las suposiciones de confianza del cliente se sostienen
server-side. Conclusión de esa revisión manual: las suposiciones del cliente son correctas; el backend
(ajeno a esta superficie) enforcea autorización y validación donde corresponde.

PowerSync / BLE / RN nativo no aplican a esta superficie (es flujo de invitaciones, no sync ni hardware).

---

## Archivos analizados (superficie de cambio)

- `app/src/services/members.ts`
- `app/app/invite.tsx`
- `app/src/services/pending-invitation.ts`
- `app/app/miembros.tsx`
- `app/app/invitar.tsx`
- `app/app/_layout.tsx`
- `app/src/components/ShareLink.tsx`
- `app/src/components/RoleBadge.tsx`
- `app/src/utils/invite.ts`
- (+ `app/src/utils/invite.test.ts`, `app/app/onboarding.tsx`, `app/app/verify-email.tsx`,
  `app/app/mis-campos.tsx` — tocados por el run, revisados; sin findings)

## Leídos para verificar exploitability (NO auditados, ajenos al diff)

`supabase/functions/_shared/auth.ts`, `supabase/functions/accept_invitation/index.ts`,
`supabase/functions/invite_user/index.ts`, `supabase/migrations/0006_rls_users.sql`,
`supabase/migrations/0008_rls_membership.sql`.

## Excluidos por instrucción del brief

`scripts/check.mjs`, `.claude/settings.json`, `specs/active/04-bluetooth-baston/` (cambios de otra
terminal / ajenos).
