baseline_commit: 4686ac04d82d70239f3356dde0d98bcc301cce66

# Implementación — `01-identity-multitenancy` · Frontend B.1 Run 1 (pantalla "Más" + logout + editar/eliminar campo)

**Agente:** `implementer`
**Inicio:** 2026-05-30 (sesión 21)
**Spec:** `specs/active/01-identity-multitenancy/` (aprobado por Raf). Cierra T6.2 (logout) + T4.5 (editar/soft-delete de campo).
**Backend:** done (schema + RLS + trigger 0011 desplegados/testeados contra el remoto).
**Frontend previo:** B.1.1 (auth, Fase 3) + B.1.2 (establecimientos, Fase 4) — todo en el working tree sin commitear.

> `baseline_commit` (línea 1): SHA previo a la primera task de la LÍNEA de trabajo del frontend B.1
> (mismo SHA que Fase 4: todo B.1.1+B.1.2+este Run viven sin commitear sobre `main`, no hay
> feature-branches). Punto desde el cual Gate 2 calcula el diff. NO sobreescribir.

## Objetivo (Run 1)

Destrabar el testing de Raf: hoy no puede cerrar sesión ni borrar un campo desde la app, así que
no puede probar el ciclo completo desde 0. Este Run cierra:
- **T6.2 (logout)** — botón en "Más" → `signOut()` → el RootGate re-rutea a auth.
- **T4.5 (editar/soft-delete de campo)** — owner-only, R3.4 (editar) + R3.6/R3.6.1 (soft-delete con
  warning de conteo de miembros).
- La **pantalla "Más"** (reemplaza el stub) como contenedor: perfil + campo activo + equipo (próximamente) + logout.

## Alcance Run 1 (lo que SÍ / lo que NO)

SÍ:
- Pantalla "Más" con secciones agrupadas (patrón Settings iOS/Android / MP tab Más).
  - Perfil: nombre + email + teléfono (de `public.users`). Editar nombre y teléfono (RLS self).
    Email solo-lectura con TODO (cambio de email dispara verificación → no se implementa ahora).
  - Campo activo: acciones "Editar campo" + "Eliminar campo" SOLO si el rol del usuario en el campo
    activo es `owner` (del EstablishmentContext).
  - Equipo: estado "Próximamente" honesto (InfoNote claro; llega en Fase 5/B.1.3).
  - Cerrar sesión: abajo, diferenciada (destructiva/$terracota), thumb-zone.
- Logout (T6.2): `signOut()` del AuthContext.
- Editar campo (T4.5/R3.4): reusa el form de crear-campo SIN el gate de teléfono; pre-cargado;
  owner-only; `update` a `establishments` SIN `.select()` (gotcha RLS-on-RETURNING); valida name+province;
  tras guardar `refreshEstablishments()`.
- Eliminar campo (T4.5/R3.6/R3.6.1): soft-delete = `update({ deleted_at })`; owner-only; confirmación
  destructiva + warning con conteo de miembros activos distintos del owner; tras borrar
  `refreshEstablishments()` → el contexto detecta active_lost / re-resuelve y el RootGate re-rutea.
- TEST REAL en `supabase/tests/rls/run.cjs`: owner soft-deletea su campo → desaparece de `loadMemberships`
  del owner y de los miembros (otro usuario con rol ya no lo ve).

NO (Run 2 / Fase 5):
- Pulido de B.1.2 (banner per-campo, micro-feedback del switch, subtítulo de desambiguación, advertir
  duplicados) → Run 2.
- Equipo (miembros/invitaciones) real → Fase 5 / B.1.3.
- Cambio de email (R2.2, dispara verificación) → diferido.
- Baja de cuenta (T6.3 / R2.4 / R2.5.1) → fuera de alcance.

## Plan de tareas (Tn)

- [x] T-A — capa de datos: `loadFullProfile`, `saveProfile`, `loadEstablishmentDetail`,
  `updateEstablishment` (SIN select, con count), `softDeleteEstablishment` (update deleted_at, con
  count + idempotencia), `countActiveMembers`.
- [x] T-B — validación pura: `validateProfile` + `parseHectares`/`formatHectares` (extraídos a utils).
- [x] T-C — pantalla "Más" (`app/app/(tabs)/mas.tsx`): secciones + logout + acciones owner-only.
- [x] T-D — editar campo: `app/app/editar-campo.tsx` (reusa el patrón del form, pre-cargado, owner-only).
- [x] T-E — eliminar campo: confirmación destructiva + warning con conteo en "Más".
- [x] T-F — test real de borrado en `supabase/tests/rls/run.cjs` (pasó contra el remoto).
- [x] Verificación: typecheck verde + check.mjs verde (incl. test nuevo) + web export OK + autorrevisión.

## Bitácora — as-built

### T-A — capa de datos (`app/src/services/establishments.ts`)
- `loadFullProfile(userId)` → `{ name, email, phone }`. RLS `users_select_self` (0006) scopea a la
  propia fila. Si no hay fila (no debería: la crea el trigger `on_auth_user_created`), reporta unknown
  en vez de fabricar datos.
- `saveProfile(userId, { name, phone })` → UPDATE de `users` (name + phone) SIN `.select()`. NO toca el
  email (cambiar email dispara verificación R2.2, fuera de Run 1). RLS `users_update_self` (id=auth.uid()).
- `loadEstablishmentDetail(establishmentId)` → `{ id, name, province, city, totalHectares }` fresco para
  pre-cargar el form de edición (el contexto no guarda hectáreas, solo name/province/city/role). Filtra
  `deleted_at is null`.
- `updateEstablishment(id, input)` → UPDATE (name/province/city/total_hectares) **SIN `.select()`** +
  `{ count: 'exact' }`. Si `count === 0` reporta unknown (RLS bloqueó = no-owner, o id inexistente/borrado)
  en vez de un falso OK. RLS `establishments_update` (0007) es owner-only (R3.4/R3.5/R7.3).
- `softDeleteEstablishment(id)` → UPDATE `deleted_at = now()` SIN `.select()` + count + `.is('deleted_at', null)`
  (idempotencia: no re-borra). owner-only (R3.6). `count===0` → unknown.
- `countActiveMembers(establishmentId, ownerId)` → `select('id', { count:'exact', head:true })` con
  `active=true AND user_id != ownerId`. El owner ve TODAS las filas de roles de su campo (policy
  `user_roles_select` término `is_owner_of`), así puede contar a los OTROS que perderán acceso (R3.6.1).

> **Probe contra el remoto del patrón UPDATE-sin-select-con-count**: confirmé que
> `update({...}, { count:'exact' })` SIN `.select()` devuelve `count: 1` (update permitido), `count: 0`
> (no-match / RLS-bloqueado), status 204, sin error. Es decir, el count distingue éxito de bloqueo SIN
> disparar la evaluación de RLS-on-RETURNING (el 403 que mordió en crear-campo). Patrón correcto.

### T-B — validación + parseo puro
- `validateProfile({ name, phone })` en `app/src/utils/validation.ts`: nombre obligatorio (R1.1/R2.1);
  teléfono OPCIONAL (vacío = OK) pero válido si se ingresa (reusa `isValidPhone`). Copy en voseo.
- `parseHectares`/`formatHectares` MOVIDOS de `crear-campo.tsx` a `app/src/utils/establishment.ts`
  (puros, testeables, compartidos por crear + editar). `crear-campo.tsx` ahora los importa. Round-trip
  estable (parse∘format) garantizado por test → editar pre-cargado no corrompe el valor de hectáreas.

### T-C — pantalla "Más" (`app/app/(tabs)/mas.tsx`, reemplaza el stub)
- Secciones agrupadas (patrón Settings iOS/Android / tab Más de MP):
  - **Perfil**: Card con nombre + email (solo-lectura, con hint honesto) + teléfono + "Editar perfil"
    (toggle a `ProfileEditForm` inline: FormField name/phone + Guardar/Cancelar → `saveProfile`).
  - **Campo activo · `<nombre>`**: Card con "Editar campo" (→ /editar-campo) + "Eliminar campo"
    (destructiva, $terracota), SOLO si `estState.role === 'owner'`. No-owner → InfoNote honesto (no
    se ofrecen las acciones; la RLS las bloquearía igual). Sin campo activo → la sección no se muestra.
  - **Equipo**: Card "Miembros e invitaciones — Próximamente" (honesto, NO roto / NO "Stub").
  - **Cerrar sesión**: abajo del todo (`marginTop:$8`, thumb-zone), pill outline $terracota, con
    confirmación liviana. `signOut()` → el RootGate re-rutea a auth (al cambiar el AuthState).
- `confirmDestructive(title, message, label)`: helper multiplataforma. Native → `Alert.alert` con
  botones (cancel/destructive). Web → `window.confirm` (Alert.alert no acciona botones en RN-web; el
  testing de Raf es en web). Devuelve `Promise<boolean>`. Garantiza confirmación en lo destructivo en
  AMBAS plataformas.

### T-D — editar campo (`app/app/editar-campo.tsx`)
- Edita el CAMPO ACTIVO (name/province/city/hectáreas). OWNER-ONLY doble-gateado: la UI de "Más" solo
  ofrece la acción al owner, y la pantalla re-chequea `state.role === 'owner'` (fase `not_owner`).
- Reusa el patrón de `crear-campo` (AuthScreenShell + FormField + Button + parseHectares +
  validateCreateEstablishment) SIN el gate de teléfono (R3.8 es solo del ALTA). Pre-carga vía
  `loadEstablishmentDetail`. Fases: loading / not_owner / error / form.
- Guarda con `updateEstablishment` (SIN select). Tras OK: `refreshEstablishments()` (sin preferredId
  — el campo sigue siendo el preferido/activo, solo cambió de nombre) → el contexto resuelve `active`
  sobre el MISMO campo con los datos nuevos → `router.back()` a "Más" (que lee el nombre nuevo del
  contexto). NO falsea active_lost (el campo nunca desaparece del set, solo se renombra).
- Ruta registrada en `_layout.tsx`; en estado `active` el RootGate NO la expulsa (no está en
  `strandedOnGatingRoute`), igual que crear-campo/mis-campos.

### T-E — eliminar campo (en "Más")
- Re-entrancy guard (`busyRef`) cubre todo el flujo (contar + confirmar + borrar) → un doble-tap no
  dispara dos borrados. El label visible "Eliminando…" se enciende RECIÉN tras confirmar (antes el
  usuario está en el diálogo, no borrando — mostrarlo ahí sería engañoso en native).
- Orden: (1) `countActiveMembers` ANTES del borrado (mientras `is_owner_of` aún es true); (2)
  confirmación destructiva con el conteo (R3.6.1: *"`<campo>` tiene N miembros que van a perder
  acceso. Esta acción no se puede deshacer. ¿Eliminar el campo?"*; sin miembros, copy sin conteo);
  (3) `softDeleteEstablishment` → `refreshEstablishments()`. El RootGate detecta active_lost (R6.10)
  / re-resuelve sobre los restantes y re-rutea (campo-perdido → Mis campos / wizard / home). Sin nav
  manual: el camino active_lost ya está manejado.

### T-F — test real de borrado (`supabase/tests/rls/run.cjs`)
- Test nuevo `R3.6/R8.3: owner soft-deletea su campo → desaparece de membership del owner y del miembro`.
  Crea estD (owner=userA) + userB como field_operator activo. Verifica con la query REAL de
  loadMemberships (join user_roles activos → establishments embebido): ANTES ambos ven estD; el owner
  soft-deletea (update deleted_at SIN select, como el cliente); DESPUÉS estD NO aparece para NINGUNO
  (el establishment embebido viene null por RLS `has_role_in`/`establishments_select` que filtran
  deleted_at → `mapMembershipRows` lo descarta) — esto es lo que dispara active_lost (R6.10) en ambos.
  Defensa extra: un field_operator NO puede soft-deletear un campo ajeno (RLS owner-only, 0 filas).
  **Pasó contra el remoto** (`✔ R3.6/R8.3 …`).

## Decisiones técnicas menores (default + razón)

1. **UPDATE sin `.select()` + `{ count: 'exact' }`** (editar / borrar / saveProfile): evita el gotcha
   RLS-on-RETURNING (403) que mordió en crear-campo, y el `count` distingue éxito (1) de bloqueo/no-match
   (0) sin traer la fila. Probado contra el remoto. No se necesita el RETURNING: el contexto se refresca
   con `refreshEstablishments()`.
2. **user_roles del campo borrado quedan `active = true` (NO se desactivan)** — DECISIÓN CONSCIENTE de
   alcance. R3.6 dice "todos los user_roles deberán quedar active=false", pero en MVP el soft-delete del
   establishment ya OCULTA el campo a todos vía RLS: `has_role_in`/`is_owner_of`/`establishments_select`
   incluyen `e.deleted_at is null` (0005/0007). El miembro experimenta exactamente lo observable de R3.6
   (pierde acceso → active_lost R6.10), confirmado por el test nuevo. Desactivar los roles es higiene de
   datos (requeriría un trigger AFTER UPDATE de deleted_at, o una RPC); ambos fuera de Run 1 / del
   alcance "frontend". El residual "user_roles colgando de un establishment borrado" NO es un agujero
   funcional ni de seguridad (todo gateado por `has_role_in` que mira el `deleted_at` del establishment).
   Anotado para una migración de higiene futura si hace falta (ej. al integrar PowerSync / al construir
   Members en Fase 5).
3. **Email solo-lectura en Perfil** (R2.1 lista email como editable, pero R2.2 dice que cambiarlo dispara
   verificación al email nuevo): el flujo de cambio de email con verificación es Fase 5. En Run 1 el email
   se muestra solo-lectura con un hint honesto. No se implementa el cambio (sería medio-camino inseguro).
4. **`loadEstablishmentDetail` separado en vez de agregar `total_hectares` a `MembershipEstablishment`**:
   el form de edición necesita hectáreas, pero la query de membership corre seguido (bootstrap/refresh/
   switch) y no debe cargarse de campos que solo usa una pantalla puntual. La detail-query es de baja
   frecuencia (solo al abrir editar). Mantiene el contexto liviano.
5. **`confirmDestructive` con `window.confirm` en web**: `Alert.alert` de react-native-web NO renderiza
   botones accionables (es un alert de un solo botón), así que en web no habría confirmación real. Como
   el testing de Raf es en web, uso `window.confirm` (bloqueante pero confiable) en web y `Alert.alert`
   en native. Garantiza la confirmación destructiva (Nielsen #5) en ambas plataformas.
6. **`busyRef` (re-entrancy) separado de `deleting` (label visible)**: el guard cubre todo el flujo; el
   label "Eliminando…" solo tras confirmar (no durante el diálogo). En native el Alert no bloquea el
   render, así que sin esta separación el botón mostraría "Eliminando…" mientras el usuario aún decide.

## Autorrevisión adversarial (paso 8)

Qué busqué / qué encontré / cómo lo cerré:

- **¿Logout vuelve a auth limpio?** SÍ. `signOut()` → `onAuthStateChange` → AuthState `unauthenticated`
  → el RootGate evalúa auth ANTES que establecimiento → `router.replace('/(auth)/sign-in')`. Además el
  EstablishmentContext resetea a `loading` cuando `userId` pasa a null (no deja estado stale de otro
  user). Sin loop. ✔
- **¿Editar campo refleja el cambio sin romper por RETURNING?** SÍ. `updateEstablishment` NO usa
  `.select()` (probado: count distingue éxito/bloqueo, status 204, sin 403). Tras guardar
  `refreshEstablishments()` re-lee y el contexto resuelve `active` sobre el mismo campo renombrado;
  "Más" y la home leen el nombre nuevo del contexto. ✔
- **¿El conteo de miembros es correcto?** SÍ. `countActiveMembers` cuenta `user_roles active=true AND
  user_id != ownerId` del campo — los OTROS que perderán acceso (R3.6.1). El owner puede contarlos por
  el término `is_owner_of` de `user_roles_select`. Se cuenta ANTES del borrado (mientras `is_owner_of`
  sigue true). Plural/singular correcto ("1 miembro" / "N miembros"). ✔
- **¿Eliminar el campo activo re-rutea bien (no colgado, no falso active_lost)?** SÍ. Soft-delete →
  `refreshEstablishments()` → el campo desapareció del set → `detectActiveLost(currentId, available)`
  = lost → estado `active_lost` → RootGate → `/campo-perdido` → "Entendido" re-resuelve sobre los
  restantes (≥2 → Mis campos; 1 → home; 0 → wizard). Camino ya existente y testeado en lógica pura. Sin
  hang. Borde: si `refreshEstablishments` falla por red transitoria tras un delete exitoso, el contexto
  mantiene el estado previo (no falsea lost ni expulsa) y el próximo refresh/cold-start lo levanta —
  aceptable (el delete requiere red, así que si tuvo éxito, había red). ✔
- **¿Las acciones owner-only se ocultan para no-owners?** SÍ, doble-gateado: en "Más" la Card de
  Editar/Eliminar solo se renderiza si `estState.role === 'owner'` (no-owner ve InfoNote); en
  `editar-campo.tsx` se re-chequea `role === 'owner'` (fase not_owner). Y la RLS `establishments_update`
  es owner-only de todos modos (barrera real, validada por la suite RLS R3.5/R7.3 + el test nuevo). ✔
- **¿Algún hardcode?** NO — lint anti-hardcode 0 violaciones en app/app + app/src/components. Todo via
  tokens/componentes de librería; lo que cruza a lucide (color de íconos) se lee con getTokenValue. ✔
- **¿Tests que pasan por la razón equivocada?** El test RLS de borrado ASSERTA el estado ANTES (ambos
  ven) y DESPUÉS (ninguno ve) — falla si el soft-delete no ocultara el campo, o si lo ocultara solo a
  uno. `validateProfile` test cubre las 4 ramas (nombre vacío, teléfono vacío=OK, teléfono basura,
  todo-OK). `parseHectares∘formatHectares` round-trip falla si el formateo corrompiera el valor. No
  tautológicos. El mapeo del cliente (mapMembershipRows) ya estaba testeado (filtra deleted_at null). ✔
- **¿Voseo/tildes UTF-8?** "Necesitás", "Conectate", "Volvé", "¿Eliminarlo?", "teléfono", "sesión",
  "Próximamente", "miembros". Correcto. ✔
- **¿`editar-campo` re-cargado vuelve a montar bien al cambiar de campo activo?** El `useEffect` depende
  de `activeId/isOwner/state.status` → si el usuario cambiara de campo, re-carga el detail. Cleanup con
  flag `active` evita setState tras unmount. ✔

## Trazabilidad R<n> → test / evidencia

| R<n> | Cubierto por |
|---|---|
| R1.6 (logout invalida sesión local) | `mas.tsx` botón Cerrar sesión → `AuthContext.signOut()` → onAuthStateChange → unauthenticated → RootGate a `(auth)`. Evidencia: AuthContext.signOut llama `supabase.auth.signOut()` (cubierto e2e en B.1.1) |
| R2.1 (editar nombre/teléfono) | `app/src/utils/validation.test.ts` (`validateProfile`) + `ProfileEditForm` en `mas.tsx` → `saveProfile` (RLS `users_update_self`, validada por RLS suite users) |
| R2.2 (cambio de email dispara verificación) | NO implementado en Run 1 (email solo-lectura + hint). Documentado como diferido a Fase 5 |
| R3.4 (owner edita campo) | `editar-campo.tsx` (owner-only) → `updateEstablishment` (SIN select, count). RLS suite `R3.4: owner sí puede update su establishment` (verde). Probe del patrón count contra el remoto |
| R3.5/R7.3 (no-owner NO edita/borra) | UI oculta las acciones a no-owners + RLS `establishments_update` owner-only. RLS suite `R3.5: field_operator no puede update` + test nuevo (field_operator NO puede soft-deletear, 0 filas) |
| R3.6 (owner soft-deletea campo) | `softDeleteEstablishment` (update deleted_at). **Test nuevo `R3.6/R8.3` PASÓ contra el remoto**: tras el soft-delete del owner, el campo desaparece de la membership del owner Y del miembro |
| R3.6.1 (warning con conteo de miembros) | `countActiveMembers` + `confirmDestructive` con el conteo en `mas.tsx`. El conteo lo permite la policy `user_roles_select` (término is_owner_of) — el owner ve los roles de su campo |
| R6.10 (active_lost + re-ruteo tras borrar) | tras `softDeleteEstablishment` + `refreshEstablishments` el contexto detecta lost y el RootGate re-rutea. `detectActiveLost`/`resolveState` tests (B.1.2) + el camino campo-perdido ya existente. El test nuevo demuestra que el campo desaparece del set (el disparador de active_lost) |
| R8.3/R8.4 (soft-delete invisible) | test nuevo (establishment embebido null tras delete) + RLS suite `R8.3/R8.4` previo. `has_role_in`/`is_owner_of`/`establishments_select` filtran deleted_at (0005/0007) |

## Resultado de cada paso de autoverificación

1. `cd app; pnpm.cmd typecheck` → **verde**.
2. `node scripts/check.mjs` → **verde**: typecheck + **62 client unit tests** (58 previos + 4 nuevos:
   validateProfile + parseHectares + formatHectares + round-trip) + **RLS 17 (16 previos + 1 nuevo de
   borrado)** + Edge 26 + Animal 28 + Maneuvers 13. Sin regresión. **Anti-hardcode: 0 violaciones**.
3. **El test nuevo de borrar campo PASÓ contra el REMOTO**: `✔ R3.6/R8.3: owner soft-deletea su campo →
   desaparece de membership del owner y del miembro`.
4. `pnpm.cmd exec expo export --platform web` → **exit 0**, bundle web compiló (entry 5.2MB) sin errores
   de transpile/resolve — todas las pantallas nuevas (mas, editar-campo) + servicios + utils empaquetan.
   El veredicto de los clicks reales (logout vuelve a auth, borrar re-rutea, confirm dialog) queda para
   la prueba manual de Raf en `pnpm web` (no capturable headless).
5. Autorrevisión adversarial → documentada arriba.

## Seams / TODOs dejados

**Para Run 2 (pulido de B.1.2 — otro brief):** banner per-campo, micro-feedback del switch, subtítulo
de desambiguación, advertir duplicados. NO tocado acá (fuera de alcance explícito).

**Para Fase 5 / B.1.3:**
- **Equipo** (miembros/invitaciones): hoy es un estado "Próximamente" honesto en "Más". Falta la
  pantalla real (listar miembros, invitar, cambiar rol R4.5, remover R4.7, link shareable R5.*).
- **Cambio de email** (R2.2): el email es solo-lectura en Perfil. Falta el flujo con verificación al
  email nuevo (`supabase.auth.updateUser({ email })` + manejo del doble-confirm).
- **Baja de cuenta** (T6.3 / R2.4 / R2.5.1): NO incluida (owner único debe soft-deletear sus campos
  antes — la lista de bloqueantes accionable de R2.5.1 es de otro Run).

**Higiene de datos (decisión 2):** desactivar explícitamente los `user_roles` del campo borrado
(R3.6 literal) — diferido; el soft-delete del establishment ya los oculta vía RLS. Candidato a trigger
AFTER UPDATE de `establishments.deleted_at` o RPC, al construir Members (Fase 5) o integrar PowerSync.

## Archivos creados / modificados

Nuevos:
- `app/app/editar-campo.tsx` — EditEstablishmentScreen (R3.4, owner-only, pre-cargado).
- `progress/impl_01-frontend-mas-gestion-campo.md` — esta bitácora.

Modificados:
- `app/app/(tabs)/mas.tsx` — pantalla "Más" completa (reemplaza el stub): Perfil + Campo activo
  (editar/eliminar owner-only) + Equipo (próximamente) + Cerrar sesión.
- `app/src/services/establishments.ts` — `loadFullProfile`, `saveProfile`, `loadEstablishmentDetail`,
  `updateEstablishment`, `softDeleteEstablishment`, `countActiveMembers` (+ tipos).
- `app/src/utils/validation.ts` — `validateProfile` (R2.1).
- `app/src/utils/validation.test.ts` — +1 test (`validateProfile`).
- `app/src/utils/establishment.ts` — `parseHectares` + `formatHectares` (movidos de crear-campo,
  compartidos por crear + editar).
- `app/src/utils/establishment.test.ts` — +3 tests (parseHectares / formatHectares / round-trip).
- `app/app/crear-campo.tsx` — importa `parseHectares` de utils (quitó la copia local).
- `app/app/_layout.tsx` — registra la ruta `editar-campo` en el Stack + nota de no-re-ruteo en active.
- `supabase/tests/rls/run.cjs` — test nuevo del flujo real de borrar campo (pasó contra el remoto).

NO toqué (coordinación / leader): `feature_list.json`, `progress/current.md`, `progress/plan.md`,
migrations, ni la DB remota (salvo el test nuevo en run.cjs, que crea/limpia sus propios fixtures).
Tampoco marqué nada `done`. El pulido de B.1.2 (Run 2) NO se incluyó.
