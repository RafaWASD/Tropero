# Security Gate 2 (modo `code`) — B.1.2.2 Fase 4 (establecimientos) · spec 01

**Agente:** `security_analyzer` (modo `code`)
**Fecha:** 2026-05-31 (sesión 21)
**Baseline:** `4686ac04d82d70239f3356dde0d98bcc301cce66` (registrado en `progress/impl_01-frontend-fase4.md` línea 1)
**Alcance:** SOLO el cliente nuevo de la capa de establecimientos (RN/Expo). Backend (RLS + trigger 0011 + Edge Functions) ya gateado y fuera de alcance; lo leí únicamente como anchor para evaluar explotabilidad del cliente.
**Skill corrida:** `sentry-skills:security-review` sobre el working tree (archivos nuevos untracked + modificados).

---

## Veredicto: PASS

No se identificaron findings HIGH-confidence. La superficie multi-tenant del cliente nuevo se apoya correctamente en RLS server-side scopeada por `auth.uid()` y NO en filtros client-side falsificables. La persistencia local guarda únicamente ids de campos, keyed por usuario. No hay secretos/tokens hardcodeados ni logueados en el diff.

---

## Findings HIGH de Sentry

Ninguno. La skill no levantó vulnerabilidades HIGH-confidence sobre el diff, y mi validación manual lo confirma.

## Findings RAFAQ-SPECIFIC

Ninguno HIGH. Detalle de los 6 focos auditados (todos PASS):

### Foco 1 — Aislamiento multi-tenant en el cliente · PASS
`loadMemberships()` (`app/src/services/establishments.ts:56-88`) hace `from('user_roles').select('role, establishment:establishments(...)').eq('active', true)` SIN filtro de `user_id` client-side. Esto es lo correcto: el aislamiento lo provee RLS server-side, no el cliente.
- Anchor verificado `supabase/migrations/0008_rls_membership.sql:11-17`: `user_roles_select` usa `using (user_id = auth.uid() or is_owner_of(establishment_id))`. El `.eq('active', true)` es un refinamiento UX, no la frontera de seguridad — aunque el atacante lo quitara, RLS no devuelve filas de otros tenants.
- Anchor verificado `supabase/migrations/0007_rls_establishments.sql:6-9`: `establishments_select` usa `has_role_in(id)`. Un id de otro campo embebido por el join no se materializa sin rol.
- No hay path que traiga campos de otro usuario: el set entero deriva de `auth.uid()`.
- El filtro `e.deleted_at == null` (línea 73) es defensa-en-profundidad cliente; la fuente de verdad es la RLS (`has_role_in` ya excluye soft-deleted). No es la frontera.

### Foco 1b — Switch de campo no deja datos del campo anterior expuestos · PASS
`switchEstablishment` (`EstablishmentContext.tsx:152-169`) resuelve LOCAL sobre `state.available` (que ya está scopeado por el `loadMemberships` previo). No trae datos nuevos ni mezcla. La home (`app/app/(tabs)/index.tsx:210-236`) lee TODO del contexto (`estState.current`, `recents`) sin estado local de campo, así que al cambiar el activo re-renderiza limpio. En Fase 4 no hay tablas de negocio (animals/rodeos) consultadas todavía, así que no existe el riesgo de "datos del campo viejo pegados"; el seam para filtrar por `current.id` queda documentado para specs posteriores (y RLS protegerá igual).

### Foco 2 — Crear establecimiento · PASS
`createEstablishment()` (`establishments.ts:110-141`) hace `insert(row).select(...).single()` donde `row` contiene SOLO name/province/city/total_hectares. NO setea `owner`, `user_id`, ni `establishment_id` (el id lo genera el server; el rol owner lo crea el trigger).
- Anchor verificado `supabase/migrations/0011_establishment_auto_owner.sql:11-33`: `handle_new_establishment` (SECURITY DEFINER, AFTER INSERT) inserta `user_roles(auth.uid(), new.id, 'owner', true)`. El owner se deriva de `auth.uid()` server-side — el cliente no puede forzarlo.
- El `role: 'owner'` hardcodeado en el return (línea 138) es solo el shape devuelto a la UI; no escribe nada ni concede privilegio (el privilegio real lo da el trigger + RLS). Incluso si un atacante manipulara ese valor en memoria, el rol efectivo lo dicta `user_roles` en el server.
- Anchor `0008_rls_membership.sql:23-30`: la única vía de insert client-side de `user_roles` exige `user_id = auth.uid() and role = 'owner' and active = true` — no se puede auto-conceder rol en un campo ajeno.

### Foco 3 — `active_lost` (R6.10) · PASS
- Sin exposición de datos del campo perdido: al detectar pérdida (`EstablishmentContext.tsx:99-116`) se limpian `preferredIdRef`/`currentIdRef`/`currentNameRef` y se transiciona a `active_lost`, conservando solo `lostEstablishmentName` (un string de display) y `available` (ya re-scopeado). `campo-perdido.tsx` solo muestra copy; no consulta datos del campo perdido.
- NO fuerza logout (R7.4): `acknowledgeActiveLost` (líneas 171-182) re-resuelve sobre `available` y nunca llama `signOut`. Verificado.
- No se puede burlar para conservar acceso: la detección es client-side para UX, pero el acceso real lo corta RLS — una vez revocado el rol, `loadMemberships` deja de devolver el campo y cualquier query a sus datos sería rechazada server-side. Mantener el estado en memoria no concede acceso a datos.
- Nota menor (NO finding): `refreshEstablishments` no expulsa por fallo de red transitorio (líneas 139-148). Esto es fail-safe correcto, no un bypass: el dato sigue protegido por RLS; lo único que persiste es el estado de UI.

### Foco 4 — Persistencia del rastro de visitados · PASS
`establishment-store.ts`: key `rafq.est_trail.<userId saneado>` (líneas 31-34) → rastro POR USUARIO. En device compartido un usuario NO lee el rastro de otro (la key incluye el UUID del usuario).
- Solo se guarda un array de ids de campos (líneas 62-92). No hay PII, tokens ni secretos.
- Mecanismo adecuado: web → localStorage, native → expo-secure-store (mismo patrón que B.1.1). Para ids de campos no-sensibles es más que suficiente; secure-store en native es de hecho más fuerte de lo necesario.
- `JSON.parse` (línea 66) está en try/catch + type-guard (`Array.isArray` + `typeof x === 'string'`, línea 68). No es sink de prototype pollution: el valor parseado nunca se spreadea/mergea en un objeto, solo se filtra a string[]. Sin explotabilidad.

### Foco 5 — Gate de teléfono (`saveOwnPhone`) · PASS
`saveOwnPhone(userId, phone)` (`establishments.ts:168-178`) hace `update({phone}).eq('id', userId)`.
- Anchor verificado `supabase/migrations/0006_rls_users.sql:34-38`: `users_update_self` usa `using (id = auth.uid()) with check (id = auth.uid())`. Doble protección: aunque el cliente pasara un `userId` ajeno, la RLS rechaza el update. El `userId` viene del `AuthContext` (sesión Supabase), no de input del usuario.
- Validación de input: `isValidPhone` (`validation.ts:51-54`) exige ≥8 dígitos antes de escribir (`crear-campo.tsx:118-119`). Se hace `.trim()` antes de persistir. No hay inyección (supabase-js parametriza; es un UPDATE de un solo campo de texto).

### Foco 6 — Secretos / logs · PASS
- 0 secretos/tokens hardcodeados en el diff.
- 0 `console.*` en los archivos del diff de Fase 4. (Los 2 `console.warn` del repo viven en `verify-email.tsx:64` y `AuthContext.tsx:121` — ambos Fase 3, fuera de este diff, y ninguno loguea secretos: uno es un mensaje estático, el otro un `error.kind`.)
- Router: todos los destinos son rutas constantes hardcodeadas (`/crear-campo`, `/(tabs)`, `/mis-campos`, `/onboarding`). Sin superficie de open-redirect (no se navega a URLs derivadas de input).

---

## False positives descartados (trazabilidad)

- **`loadMemberships` sin `.eq('user_id', ...)`** — a primera vista parece IDOR/missing-filter. Descartado: el aislamiento es responsabilidad de RLS (`user_roles_select`), no del cliente. Agregar el filtro client-side sería redundante y NO sería la frontera de seguridad. Patrón correcto para supabase-js + RLS.
- **`role: 'owner'` hardcodeado en `createEstablishment`** — parece auto-concesión de privilegio. Descartado: es solo el shape de retorno a la UI; el privilegio efectivo lo otorga el trigger 0011 server-side desde `auth.uid()`. Manipularlo en memoria no escala privilegios.
- **`JSON.parse` de storage** — posible prototype pollution / deserialización insegura. Descartado: type-guarded, en try/catch, el resultado es string[] que nunca se mergea en objetos.
- **`active_lost` solo client-side** — posible bypass de revocación. Descartado: es detección de UX; el corte de acceso real es server-side (RLS). Conservar el estado en memoria no da acceso a datos.

---

## Archivos analizados

NUEVOS: `app/src/contexts/EstablishmentContext.tsx`, `app/src/services/establishments.ts`, `app/src/services/establishment-store.ts`, `app/src/utils/establishment.ts`, `app/app/onboarding.tsx`, `app/app/crear-campo.tsx`, `app/app/campo-perdido.tsx`.

MODIFICADOS: `app/app/_layout.tsx`, `app/app/(tabs)/index.tsx`, `app/app/mis-campos.tsx`, `app/src/contexts/index.ts`, `app/src/utils/validation.ts`.

Anchors server-side leídos (out of scope, solo para explotabilidad): `supabase/migrations/0006_rls_users.sql`, `0007_rls_establishments.sql`, `0008_rls_membership.sql`, `0011_establishment_auto_owner.sql`.

---

## Cobertura indirecta de Deno / RLS / PowerSync / RN

- **RLS**: la skill de Sentry NO razona sobre RLS de Postgres. Lo cubrí manualmente leyendo las policies como anchor de explotabilidad del cliente. El cliente nuevo se apoya correctamente en RLS ya gateada (verde en check.mjs: RLS 15 + Edge 26). Sin policies nuevas en este diff (el alcance es solo cliente).
- **PowerSync**: diferido a Fase 7 — no hay código de sync en este diff. Sin superficie.
- **Deno / Edge Functions**: no hay Edge Functions nuevas en este diff (las queries son supabase-js directo). Sin superficie nueva.
- **React Native / Expo**: la skill cubre JS/TS y patrones React. Cubrí manualmente expo-secure-store/localStorage (persistencia local) y expo-router (open-redirect) — sin hallazgos.
- **BLE**: no aplica a esta feature.

**Recomendación de verificación manual para Raf** (no son findings, son confirmaciones de comportamiento en runtime que no se pueden cerrar headless): en device/`pnpm web`, confirmar que al cambiar de cuenta en el MISMO device el rastro de visitados NO muestra campos de la cuenta anterior (esperado: keys distintas por user_id lo previenen).
