baseline_commit: 1a5d6aac649133dadac6e380dfa916ba5cedd069

# Impl B.1.3 — Fase 5 spec 01: invitaciones y miembros (cliente Expo)

Feature: `01-identity-multitenancy` (in_progress). Run: B.1.3 — frontend de invitar/aceptar/listar
miembros + cambiar rol + remover, cableado a las Edge Functions de Fase 2 (ya done, 26 tests). NO
toca backend (sin deploys, sin migrations). Spec 01 R5.x + ADR-014 (email opcional, token por link).

## Estado: DONE + FIX LOOP R5.13 aplicado (esperando reviewer + Gate 2). check.mjs verde.
## (El fix del orphan del token de invitación está documentado al final, sección "FIX LOOP".)

## Qué se hizo por tarea

### Lógica pura testeable — `app/src/utils/invite.ts` (+ `invite.test.ts`, 11 tests)
- `parseInviteToken(input)`: extrae el token de URL universal (`https://app.rafq.ar/invite?token=`),
  deep-link (`rafq://invite?token=`), o token crudo (UUID suelto). Estrategia: UUID directo → `new URL`
  + searchParams → fallback regex `token=`. Basura/vacío → null. Tests: 3 formas válidas + params
  extra + percent-encoded + garbage/vacío + fallback regex.
- `inviteErrorCopy(code)`: mapea códigos de las Edge Functions (`already_member`, `expired`,
  `not_found`, `invalid_state`, `forbidden`, `last_owner`, `pending_exists`, `no_change`,
  `invalid_input`, `unauthorized`) a copy legible en español + fallback genérico. Tests del mapeo +
  fallback (null/undefined/desconocido).
- `alreadyMemberCopy(role)`: copy de R5.9 que nombra el rol actual ("...como <rol>... Miembros →
  Cambiar rol"); sin rol cae al copy genérico de already_member.

### Service layer — `app/src/services/members.ts` (nuevo)
- `invokeFn<T>` (helper): normaliza `supabase.functions.invoke` a `Result<T>` con el `code` del error.
  Desempaqueta el shape de supabase-js: en no-2xx, `{ data:null, error: FunctionsHttpError }` y el
  body (`{ error: { code, message } }`) queda en `error.context` (Response) → `await context.json()`.
  Maneja red (try/catch del invoke), defensa de 2xx-con-error-en-body (patrón push-notifications.ts).
- Lecturas RLS: `loadMembers(establishmentId, currentUserId)` (`select role, user_id, user:users(id,
  name)` — SOLO id+name, hallazgo #2) y `loadPendingInvitations(establishmentId)` (owner-only).
- Wrappers tipados (Result con code): `createInvitation`, `cancelInvitation`, `regenerateInvitation`,
  `removeMember`, `changeMemberRole`, `acceptInvitation`.
- `INVITE_BASE_URL` + `inviteUrlForToken(token)`: reconstruye el accept_url de invitaciones pendientes
  (que solo traen el token en la fila) a partir de la misma base que el backend (`https://app.rafq.ar`,
  = APP_URL del edge; comentado). Las recién creadas/regeneradas usan el `accept_url` del backend.

### Componentes — `app/src/components/`
- `ShareLink.tsx` (nuevo): bloque "compartí el link" reutilizable — el accept_url destacado
  (seleccionable, guard de overflow horizontal: maxWidth 100% + overflow hidden + numberOfLines +
  ellipsizeMode "middle") + Copiar (expo-clipboard) + Compartir (RN Share). Targets ≥ $touchMin.
- `RoleBadge.tsx` (nuevo, EXTRAÍDO de EstablishmentCard): chip de rol como FUENTE ÚNICA compartida por
  EstablishmentCard y la pantalla Miembros (Nielsen #4). EstablishmentCard ahora lo importa.

### T5.1 + T5.3 + T5.5 + T5.6 — `app/app/miembros.tsx` (nuevo, ruta standalone)
- Header (safe-area): back + "Equipo" + (owner) "Invitar" (→ /invitar).
- Lista de miembros: nombre + RoleBadge + marcador "vos" en el propio. Owner ve la lista completa;
  no-owner ve solo SU fila (RLS hallazgo #1) + nota "Solo el dueño gestiona el equipo".
- Owner, por fila (no sobre sí mismo): menú inline → "Cambiar rol" (T5.5, picker Operario/Veterinario)
  / "Remover" (T5.6, confirmDestructive). Error legible (incl. last_owner).
- Owner: sección "Invitaciones pendientes" (T5.3): card por pending con rol + fechas + email-anotación
  + el link reconstruido + acciones Copiar/Compartir/Regenerar (confirm + advierte que el viejo muere)
  /Cancelar (confirm). Refresca la lista tras cada acción.
- Cableado el item "Equipo" de `mas.tsx` (era "Próximamente") → `/miembros` (solo si hay campo activo).

### T5.2 — `app/app/invitar.tsx` (nuevo)
- Form: selector de rol OBLIGATORIO (Operario/Veterinario — NO owner, R5.1) + email OPCIONAL
  (anotación, solo se valida formato si lo escriben). → createInvitation.
- Éxito → vista "Listo, compartí el link": ShareLink con el accept_url + nota "vence en 7 días,
  cancelable/regenerable desde Miembros". Error → copy del code (inviteErrorCopy).
- Defensa: si el contexto no es 'active'+owner, muestra nota y no el form.

### T5.4 — `app/app/invite.tsx` (nuevo)
- Fases: paste (input de pegar link) → confirm (logueado) / auth_required (no logueado) → accepting →
  error. Token inicial del query param (`?token=`) parseado con parseInviteToken.
- Confirm GENÉRICO (sin preview — hallazgo RLS #3: el invitado no puede leer la invitación antes de
  aceptar; preview pre-accept requeriría un edge público lookup-by-token, fuera de scope MVP).
- No logueado: persiste el token (R5.13, efecto al entrar a auth_required, cubre paste Y deep-link) +
  Registrarme/Iniciar sesión (router.replace al grupo de auth). Al verificar, verify-email/onboarding
  re-rutean a `/invite?token=` con el token persistido.
- Éxito → clearPendingInvitationToken + refreshEstablishments(establishment_id) → router.replace
  '/(tabs)' (home del campo nuevo, sin dejar el accept en el back-stack). Error TERMINAL (kind 'fn':
  expired/not_found/invalid_state/already_member) limpia el token; red NO (reintentable).
- Entradas: wizard onboarding (T4.3) y stub PasteInviteLink de mis-campos → ambos navegan a /invite.

### Cableado de gating y SEAM R5.13
- `app/app/_layout.tsx`: registradas las rutas `miembros`/`invitar`/`invite` en el Stack. `invite`
  agregada a PUBLIC_ROUTES (no se rebota a sign-in al no-logueado) + a FASE5_DESTINATIONS (no se rebota
  desde no_establishments/choosing/active_lost — un invitado nuevo con 0 campos abre /invite desde el
  wizard; rebotarlo a onboarding rompería la aceptación).
- `app/app/verify-email.tsx`: SEAM R5.13 CABLEADO — al quedar emailVerified con token pendiente,
  router.replace('/invite?token=…'). Ref guard contra loop.
- `app/app/onboarding.tsx`: SEAM R5.13 red de seguridad — si cae acá con token pendiente (carrera
  gate-vs-verify-email), re-rutea a /invite. CTA "Pegar link" → /invite.
- `app/app/mis-campos.tsx`: stub PasteInviteLink → /invite.

## Decisiones técnicas
- **Helper de invoke + parsing de error**: centralizado en `invokeFn` (members.ts). Lee el `code` del
  body de error que supabase-js esconde en `error.context` (Response). Result tipado con
  kind('network'|'fn'|'unknown') + code → la UI mapea con inviteErrorCopy. Patrón espejado de
  push-notifications.ts (chequea error || data?.error).
- **Base URL del link**: una constante `INVITE_BASE_URL = 'https://app.rafq.ar'` (= APP_URL del
  backend). Reconstruye el accept_url de las pendientes (que solo traen token). Comentado que sale de
  APP_URL del edge; si cambia en secrets, actualizar acá.
- **Manejo de no-owner** (hallazgo RLS #1): no se fuerza la lista completa. loadMembers devuelve la
  lista completa al owner (policy is_owner_of) y {solo-mi-fila} al no-owner (policy user_id=auth.uid).
  La pantalla se adapta: owner = lista + acciones + pendientes; no-owner = su fila + nota honesta.
- **Email del miembro NO se muestra** (hallazgo #2): loadMembers solo trae id+name (la coworkers
  policy 0006 expone la fila completa pero el comentario de la migration manda select id,name; la
  view de columnas mínimas es hardening futuro). El email de la INVITACIÓN sí se muestra al owner
  (está en invitations, anotación).
- **Confirm genérico en accept** (hallazgo #3): sin preview de nombre/rol del campo (RLS de
  invitations es owner-only; el invitado no la lee antes de aceptar). Recién al aceptar OK aterriza
  en la home del campo.
- **Auth-con-token (R5.13)**: el token se persiste en expo-secure-store (pending-invitation.ts, ya
  existía el seam de B.1.1) al entrar a auth_required, sobrevive signup+verificación+kill, y
  verify-email/onboarding lo recuperan. Doble red de seguridad (verify-email + onboarding) contra la
  carrera con el RootGate.
- **confirmDestructive** espeja el de mas.tsx (window.confirm web / Alert native) — el testing de Raf
  es en web.
- **expo-clipboard** instalado pineado a SDK 56 (`~56.0.3`, de bundledNativeModules) con `pnpm.cmd add`.
  Único cambio en package.json (+1 línea).

## Autorrevisión adversarial (paso 8)
Busqué activamente, como revisor hostil, y corregí antes de declarar done:
- **R5.13 incompleto en el deep-link logueado-fuera**: la fase inicial `auth_required` (vía ?token=
  estando deslogueado) NO persistía el token (solo lo hacía onSubmitPaste). → Movido a un efecto que
  persiste SIEMPRE que la fase sea auth_required (cubre paste Y deep-link). Re-verificado typecheck.
- **Carrera gate-vs-verify-email en R5.13**: cuando emailVerified flipea, el RootGate puede rebotar al
  invitado (0 campos) a /onboarding antes de que verify-email re-rutee a /invite. → Agregué el mismo
  SEAM en onboarding.tsx como red de seguridad + invite en FASE5_DESTINATIONS (no se rebota desde
  no_establishments).
- **Código muerto**: rama `accepted` en invite.tsx nunca se alcanzaba (al ok hago router.replace
  directo) → eliminada. `currentRoleInTarget` no-op → inline a alreadyMemberCopy(null). `muted` sin
  usar en MiembrosScreen → removido.
- **invalid_state vs already-used**: el backend devuelve 409 `invalid_state` (no un código "used") para
  invitación accepted/cancelled → lo mapeé explícitamente a "Este link ya fue usado o fue cancelado"
  (R5.6 copy). No estaba en la lista de códigos del brief; lo agregué leyendo accept_invitation/index.ts.
- **Limpieza de token solo en errores terminales**: error de RED no es terminal (reintentable) → NO
  borro el token ahí; solo en kind 'fn' (expired/not_found/invalid_state/already_member). Documentado.
- **Selección de columnas / multi-tenant**: loadMembers nunca trae phone/email de otros; filtra por
  establishment_id (del contexto, NO hardcode). loadPendingInvitations solo se llama si isOwner.
- **Self-actions del owner**: canManage = isOwner && !isCurrentUser → el owner nunca ve acciones sobre
  sí mismo (no auto-removal/auto-demote en UI; backend last_owner es el guard real).
- **Overflow del link a 360px**: ShareLink y la card de pending usan maxWidth 100% + overflow hidden +
  numberOfLines + ellipsizeMode "middle" + selectable (guard de overflow como en la home).

## Trazabilidad R<n> → test / verificación
Los R5.x son flujos de UI cableados a Edge Functions YA testeadas (Fase 2, 26 tests verdes). El
oráculo de los flujos es Raf en web (council/aprendizaje s21: los bugs cliente↔RLS solo se ven
corriendo la app). La lógica pura sí tiene tests concretos:
- R5.4 / R6.5 (extraer token del link pegado) → `app/src/utils/invite.test.ts` :: "parseInviteToken: …"
  (URL universal, deep-link, token crudo, params extra, percent-encoded, garbage→null, fallback regex).
- R5.6 / R5.9 (copy legible de errores: ya usado/expirado/no encontrado/último dueño/ya miembro) →
  `app/src/utils/invite.test.ts` :: "inviteErrorCopy: …" + "alreadyMemberCopy: …".
- R5.1/R5.2/R5.3 (crear + compartir link), R5.5 (aceptar), R5.7 (cancelar), R5.8 (regenerar), R5.12
  (listar pendientes), R4.5 (cambiar rol), R4.7 (remover) → cableado a las Edge Functions cubiertas por
  `supabase/tests/edge/run.cjs` (26 tests). Verificación de cliente: typecheck + wiring + el loop
  coherente para probar en web con 2 cuentas (owner invita → copia link → 2da cuenta pega+acepta →
  owner ve/gestiona).
- R5.13 (persistencia del token cross-cold-start) → seam de pending-invitation.ts (B.1.1) + re-ruteo
  cableado en verify-email/onboarding; verificable en web.

## TODOs / diferido (con razón)
- **Deep-link nativo** (apple-app-site-association / assetlinks + verificación on-device): DIFERIDO —
  device-blocked (Expo Go SDK 56 fuera de tiendas) + el dominio app.rafq.ar no existe. `scheme: 'rafq'`
  ya está en app.json; el loop se prueba en web pegando el link. (T5.4)
- **Preview pre-accept** (mostrar nombre del campo/rol antes de aceptar): requeriría un edge público
  lookup-by-token (RLS de invitations es owner-only). Fuera de scope MVP (hallazgo #3).
- **View de columnas mínimas de users** (id+name como view, en vez de confiar en select id,name):
  hardening futuro (0006 lo documenta). Hoy el cliente ya hace select id,name.
- **already_member que nombra el rol**: el 409 del backend no trae el establishment_id/rol del campo
  destino, así que el copy cae al genérico. Si el edge lo expusiera, alreadyMemberCopy(role) ya está
  listo para usarlo.

## Resultado check.mjs (completo, verde)
- Anti-hardcode (ADR-023 §4): 0 violaciones.
- typecheck client: OK.
- client unit tests: 91 pass / 0 fail (80 previos + 11 de invite.test.ts).
- RLS suite: 17 pass. Edge Functions: 26 pass. Animal (spec 02): 28 pass. Maneuvers (spec 03): 13 pass.
- All tests passed.

## FIX LOOP (sesión posterior) — orphan del token de invitación (R5.13)

### El bug
Un usuario **EXISTENTE con campos, deslogueado** que acepta una invitación quedaba con el token
huérfano: abre `/invite?token=X` deslogueado → `auth_required` persiste el token → toca "Ya tengo
cuenta · Iniciar sesión" → `invite.tsx` se desmonta → inicia sesión (ya verificado) → RootGate lo
rutea a `(tabs)`/`mis-campos`. **Ningún seam corría**: `verify-email` no se muestra (ya verificado) y
`onboarding` tampoco (tiene campos). El token quedaba en secure-store y la invitación NUNCA se
aceptaba. Es el flujo multi-tenant central (un vet/usuario existente se suma a OTRO campo).

Causa raíz: el re-ruteo R5.13 a `/invite?token=` estaba esparcido SOLO en los seams de
`verify-email.tsx` (no-verificado) y `onboarding.tsx` (sin campos). Cubrían al invitado NUEVO, no el
aterrizaje post-auth de un usuario que YA está verificado y YA tiene campos.

### Estrategia elegida: Opción A (fuente única en RootGate)
Centralicé el re-ruteo del token pendiente en `RootGate` (`app/app/_layout.tsx`), **después** del
check de `emailVerified` y **antes** del gating de establecimiento (paso 3.5), así toma precedencia
sobre el ruteo a home/mis-campos/onboarding/campo-perdido y cubre TODOS los aterrizajes post-auth en
CUALQUIER estado de establecimiento. Elegí A sobre B (extender el seam a home + mis-campos) porque
deja la lógica en UN solo lugar en vez de esparcirla en 4-5 pantallas — más fácil de razonar y sin
riesgo de doble-ruteo entre seams.

Mecánica (la lectura del token es async, el efecto de gating es sync):
- Un efecto chico lee `getPendingInvitationToken()` y lo guarda en `state` (`pendingInviteToken`)
  cuando el usuario es `authenticated && emailVerified`; lo **limpia del state** (y resetea el guard)
  si deja de estarlo (logout / sesión perdida), para que un token viejo no re-dispare en otra sesión.
- El efecto de gating, tras el check de `emailVerified`: si hay `pendingInviteToken`, no estamos ya
  en `/invite` (`top !== INVITE_ROUTE`) y un guard one-shot (`useRef reroutedForInvite`) no se
  consumió → `router.replace({ pathname:'/invite', params:{ token } })` + `hideSplashOnce()` +
  `return`. Marca el guard para no loopear.
- **Eliminé los seams redundantes** de `verify-email.tsx` y `onboarding.tsx` (ya los cubre RootGate)
  para que no haya doble-ruteo. Quité también imports/vars que quedaron sin uso (`useRouter`/`router`
  y `getPendingInvitationToken` en verify-email; `useEffect`/`useRef`/`getPendingInvitationToken` en
  onboarding). Dejé un comentario en cada header apuntando a RootGate.

### Matriz de 7 casos (cómo queda cubierta cada una; documentada también en comentario de RootGate)
1. **Nuevo usuario (registro → verificar email) con token** → al verificar, `isAuthedVerified` flipea
   → el efecto lee el token persistido → gating: token set, `top` ≠ invite, guard false → `/invite`.
   (Antes lo hacía el seam de verify-email; ahora RootGate. No se rompe.)
2. **Nuevo usuario sin campos (onboarding) con token** → mismo camino: RootGate re-rutea a `/invite`
   ANTES de resolver `no_establishments`, así nunca aterriza en el wizard. (Antes: seam de onboarding.)
3. **Usuario existente con campos, deslogueado → inicia sesión** → EL BUG: ahora `isAuthedVerified`
   queda true, el efecto lee el token persistido (lo dejó `auth_required`), y el gating re-rutea a
   `/invite` ANTES de mandarlo a `(tabs)`/`mis-campos`. **Arreglado.**
4. **Usuario ya logueado+verificado abre `/invite` directo** → confirm directo, sin re-ruteo extra.
   Doble protección: (a) un usuario logueado en `invite.tsx` va directo a `confirm` y NUNCA persiste
   el token (solo se persiste en `auth_required`, que es estado-deslogueado) → `getPendingInvitationToken()`
   devuelve null → `pendingInviteToken` null → el re-ruteo no aplica; (b) aunque hubiera token,
   `top === INVITE_ROUTE` corta el re-empuje.
5. **"Ahora no" en `/invite`** (`router.replace('/(tabs)')`) → NO rebota. En el flujo del caso 3 el
   guard one-shot ya se consumió cuando RootGate empujó a `/invite`, así que al volver el gating ve
   `pendingInviteToken` aún seteado pero `reroutedForInvite.current === true` → no re-rutea. El token
   queda en storage (acepta más tarde); en un cold-start futuro (mount nuevo, guard reseteado) un
   re-prompt a `/invite` es aceptable por el brief.
6. **Tras aceptar OK** → `invite.tsx` limpia el token (`clearPendingInvitationToken`) +
   `refreshEstablishments` + `replace('/(tabs)')`. No rebota: el guard one-shot ya está consumido (se
   marcó en el caso 3/1/2 al empujar a invite), así que aunque el `pendingInviteToken` del state esté
   momentáneamente stale, el gating no re-rutea.
7. **Error terminal (expirado/ya-miembro/not_found/invalid_state)** → `invite.tsx` ya limpia el token
   en `kind:'fn'` → en el próximo arranque `getPendingInvitationToken()` devuelve null → no re-prompt.
   (La red NO es terminal: ahí se conserva el token para reintentar.)

### Autorrevisión adversarial del fix
- **Loop en caso 5** (el riesgo central de Opción A): verificado que el guard one-shot lo corta — el
  re-route solo se dispara una vez por mount; "Ahora no" no rebota. El re-prompt solo reaparece en un
  cold-start nuevo (guard reseteado), que el brief acepta.
- **Caso 4 sin token persistido**: confirmado que un usuario logueado en invite.tsx NO persiste el
  token (el `setPendingInvitationToken` vive solo en el efecto de la fase `auth_required`, que es
  estado-deslogueado). Igual, el guard `top === INVITE_ROUTE` protege si alguna vez hubiera token.
- **Token stale tras accept (caso 6)**: el `pendingInviteToken` del state no se re-lee tras
  `clearPendingInvitationToken` (el efecto solo re-lee al togglear `isAuthedVerified`). No importa: el
  guard ya consumido impide el rebound. No hay flash.
- **Interacción con `est.loading`**: el re-route R5.13 va ANTES del early-return de `est.loading`, así
  el usuario existente cae en `/invite` sin flashear un frame de home mientras cargan las memberships.
- **Limpieza del state en logout**: si el usuario se desloguea (o pierde sesión), el efecto pone
  `pendingInviteToken = null` y resetea el guard, para no arrastrar un token entre sesiones de cuentas
  distintas en el mismo proceso.
- **check.mjs**: typecheck OK, anti-hardcode 0, todos los suites verdes (los unused imports eliminados
  evitan que el typecheck rompiera por noUnusedLocals).

### Archivos tocados por el fix
`app/app/_layout.tsx` (RootGate: import + state/efecto de lectura del token + paso 3.5 de re-ruteo +
dep del efecto de gating), `app/app/verify-email.tsx` (seam eliminado + limpieza de imports),
`app/app/onboarding.tsx` (seam eliminado + limpieza de imports). NO se tocó `invite.tsx` ni
`pending-invitation.ts` (su contrato sigue igual). NO se tocaron archivos ajenos.

## FIX LOOP (sesión posterior 2) — loop infinito de fetches en miembros.tsx + título cortado + ruido push web

Raf corriendo en WEB encontró 3 bugs. Los 3 cerrados; `node scripts/check.mjs` verde.

### BUG 1 (CRÍTICO) — loop infinito de requests en `app/app/miembros.tsx`
**Síntoma**: cientos de `GET .../user_roles?... net::ERR_INSUFFICIENT_RESOURCES` en consola web +
la invitación fallaba con "no pudimos completar la acción" (las requests del invoke morían porque el
navegador agotó las conexiones disponibles).

**Causa raíz** (bug de runtime, NO lo atrapan los tests): `activeField` se construía como un OBJETO
NUEVO en cada render (`{ id, name, role }`). `load = useCallback(..., [activeField, userId])` dependía
de ese objeto de identidad inestable → en cada render `load` era una referencia NUEVA →
`useEffect(() => void load(), [load])` veía un `load` distinto → re-ejecutaba `load()` → `load` hace
`setLoading/setMembers/setPending/setLoadError` → re-render → nuevo `activeField` → nuevo `load` →
efecto otra vez → **loop infinito**. El `useCallback` no servía de nada porque su propia dep cambiaba
de identidad cada render.

**Fix — estabilizar deps con PRIMITIVOS, no el objeto**:
- Derivé `activeId` / `activeName` / `activeRole` (`string | null`) directamente del `estState`, más
  `hasActiveField` (boolean) e `isOwner` (derivado de `activeRole`). Eliminé el objeto `activeField`.
- `load = useCallback(..., [activeId, activeRole, userId])` — SOLO primitivos. `useCallback` ahora
  devuelve la MISMA referencia entre renders mientras esos valores no cambien → `useEffect([load])`
  corre UNA vez al montar (loadMembers + loadPendingInvitations en owner) y solo re-corre si cambia el
  campo activo / rol / usuario (comportamiento deseado). El `setState` interno ya no genera deps nuevas.
- `activeName` queda FUERA de las deps de `load` a propósito (un rename del campo no debe re-fetchear
  miembros); se usa solo en render/handlers (`SectionTitle`, `PendingInvitationCard`, copy de remover)
  con `?? ''` / `?? 'este campo'` como defensa de tipos.
- Ajusté `onChangeRole`/`onRemove` y el render para usar los primitivos (`activeId`/`activeName`) en
  vez de `activeField.id/name/role`. Cero referencias residuales a `activeField`.
- Quité `useMemo` del import (estaba importado pero nunca se usó — `noUnusedLocals` rompería el typecheck).

**Por qué ya NO loopea**: las deps del efecto (`load`) ahora solo cambian de identidad cuando un VALOR
primitivo cambia, no en cada render. Resultado: al entrar a `/miembros` se dispara UNA sola tanda
(loadMembers + loadPendingInvitations si owner), no un loop.

### BUG 2 (visual) — título "Equipo" cortado (descendentes 'q'/'p') en `miembros.tsx`
El `<Text fontSize="$8" … numberOfLines={1}>Equipo</Text>` recortaba los descendentes porque con
`numberOfLines={1}` + sin `lineHeight` explícito la caja de línea no reservaba alto para 'q'/'p'.
Fix: agregué `lineHeight="$8"` — el token de la escala que corresponde a `fontSize $8` (en
`tamagui.config.ts`: size 8 = 23px, lineHeight 8 = 31px). Sin hardcode de px. Las otras pantallas
`$8` (Más, Mis campos, Animales) no usan `numberOfLines={1}`, por eso el recorte se notaba solo acá;
el patrón consistente es usar el lineHeight de la escala pareado al fontSize.

### BUG 3 (cleanup) — ruido de push en web en `app/src/services/push-notifications.ts`
`getExpoPushTokenSafe`: en web `Device.isDevice` puede dar true y caer en el catch como `unexpected`,
logueando `[push] registro best-effort no realizado: unexpected`. Agregué un guard temprano: si
`Platform.OS === 'web'` → devuelvo `{ ok: false, error: { kind: 'not_a_device' } }` ANTES de tocar
permisos/token. Mismo shape y comportamiento (best-effort no-op, ok:false) que el path no-device, sin
warning. (Los warnings de `expo-notifications` "listening to push token changes" y `shadow*`→
`boxShadow` son de librería/deprecación — NO se tocan, benignos.)

### Revisión del MISMO footgun en las otras pantallas de Fase 5
- **`app/app/invitar.tsx`**: recrea `activeField` (`{ id, name }`) en render PERO no hay
  `useEffect`/`useCallback` que dependa de él — no carga nada en mount, solo lee del contexto y usa el
  objeto en render / `onSubmit`. Sin loop. NO se tocó.
- **`app/app/invite.tsx`**: los efectos dependen de `[phase]` (state) e `[isAuthed]` (primitivo
  derivado de `authState.status`). Ninguno depende de un objeto recreado en cada render. Sin footgun.
  NO se tocó.

### Verificación del fix
`node scripts/check.mjs` verde: typecheck OK, anti-hardcode 0 violaciones, 91 tests cliente + RLS 17 +
Edge 26 + Animal 28 + Maneuvers 13, todos pass. El loop es runtime (no testeable por unit) → el
entregable es el cuidado en las deps: deps de `load` = primitivos estables.

### Archivos tocados por este fix
`app/app/miembros.tsx` (primitivos activeId/activeName/activeRole + load con deps primitivas +
lineHeight $8 en el título + ajuste de handlers/render + quité useMemo del import),
`app/src/services/push-notifications.ts` (guard de web en getExpoPushTokenSafe). NO se tocaron
`invitar.tsx`, `invite.tsx`, ni archivos ajenos (`scripts/check.mjs`, `.claude/settings.json`,
`docs/`, `specs/.../04-bluetooth-baston/`).

## FIX LOOP (sesión posterior 3) — `/miembros` no refresca al volver de `/invitar`

Raf (web): crea una invitación en `/invitar`, toca "Volver" → vuelve a `/miembros` y dice "No hay
invitaciones pendientes". Solo saliendo a Más y re-entrando a Equipo aparece la invitación nueva.
`node scripts/check.mjs` verde tras el fix.

### Causa
`/miembros` cargaba sus datos UNA vez en mount (`useEffect(() => { void load(); }, [load])`). Al
navegar a `/invitar` y volver, la pantalla `/miembros` sigue MONTADA en el stack (no se re-monta) →
el efecto de mount no re-corre → lista vieja. Recién al salir/re-entrar se re-monta y recarga.

### Fix — re-fetch al recuperar el foco (`useFocusEffect`)
- `import { useFocusEffect, useRouter } from 'expo-router'` (se sumó `useFocusEffect`).
- Reemplacé `useEffect(() => { void load(); }, [load])` por
  `useFocusEffect(useCallback(() => { void load(); }, [load]))`. `useFocusEffect` re-corre el callback
  en cada evento de FOCO (entrar a Miembros, volver de Invitar), no solo en mount → al volver de
  `/invitar` la pantalla re-fetcha y muestra la invitación nueva.
- NO dejé un `useEffect([load])` ADEMÁS (sería doble fetch). Quedó SOLO el `useFocusEffect`.

### Por qué NO reintroduce el loop infinito del fix anterior
`load` sigue dependiendo SOLO de primitivos estables (`[activeId, activeRole, userId]`, sin cambios)
→ su identidad es estable entre renders. `useFocusEffect` corre el callback en eventos de foco
(DISCRETOS), NO en cada render → no hay realimentación render→fetch→setState→render. El loop del fix
2 era render-driven (objeto recreado cada render); este efecto es focus-driven (identidad de `load`
estable).

### Verificación mental (3 puntos pedidos)
1. **Al entrar a Miembros carga una vez**: el foco inicial dispara `useFocusEffect` → `load()` una vez.
2. **Al volver de Invitar refresca**: la pantalla sigue montada, pero recupera el foco → `useFocusEffect`
   re-corre `load()` → la invitación recién creada aparece sin salir/re-entrar.
3. **No hay loop**: `load` estable (deps primitivas) + foco discreto (no por render) → una tanda por
   evento de foco, nunca un bucle.

### Nota sobre el import de `useEffect`
`useEffect` sigue importado y EN USO en `PendingInvitationCard` (línea ~519: re-sincroniza la URL al
cambiar `invitation.token`). No se eliminó el import → typecheck (`noUnusedLocals`) no rompe.

### Archivos tocados por este fix
`app/app/miembros.tsx` (import de `useFocusEffect` + reemplazo del `useEffect([load])` de mount por
`useFocusEffect(useCallback(load, [load]))`). NO se tocaron `invitar.tsx`, `invite.tsx`, ni archivos
ajenos.

## Archivos tocados (scope)
Nuevos: `app/app/miembros.tsx`, `app/app/invitar.tsx`, `app/app/invite.tsx`,
`app/src/services/members.ts`, `app/src/utils/invite.ts`, `app/src/utils/invite.test.ts`,
`app/src/components/ShareLink.tsx`, `app/src/components/RoleBadge.tsx`.
Modificados: `app/app/_layout.tsx`, `app/app/(tabs)/mas.tsx`, `app/app/mis-campos.tsx`,
`app/app/onboarding.tsx`, `app/app/verify-email.tsx`, `app/src/components/EstablishmentCard.tsx`,
`app/src/components/index.ts`, `app/package.json` (+expo-clipboard), `app/pnpm-lock.yaml`,
`scripts/run-tests.mjs` (+invite.test.ts), `specs/active/01-identity-multitenancy/tasks.md`.
NO se tocaron archivos ajenos (`scripts/check.mjs`, `.claude/settings.json`,
`specs/active/04-bluetooth-baston/field-findings.md`, `docs/`, `progress/current.md`,
`feature_list.json`). Esos diffs en git status son pre-existentes / de otra terminal.
