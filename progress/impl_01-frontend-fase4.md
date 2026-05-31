baseline_commit: 4686ac04d82d70239f3356dde0d98bcc301cce66

# Implementación — `01-identity-multitenancy` · Frontend B.1.2 (Fase 4 — establecimientos)

**Agente:** `implementer`
**Inicio:** 2026-05-30 (sesión 21)
**Spec:** `specs/active/01-identity-multitenancy/` (aprobado por Raf). Foco: T4.1, T4.3, T4.4 + cablear pantallas mock a datos reales.
**Backend:** done (schema + RLS + Edge Functions + trigger 0011 auto-owner desplegados/testeados contra el remoto).
**Fase 3 (auth):** done y aprobada (commits `1893513` + `4686ac0`).

> `baseline_commit` (línea 1): SHA previo a la primera task de Fase 4. Es el punto desde el cual Gate 2 (security_analyzer modo `code`) calcula el diff. Trabajamos sobre `main` (no feature-branches). NO sobreescribir.

## Alcance B.1.2 (lo que SÍ / lo que NO)

SÍ:
- T4.1 — `EstablishmentContext` real: estados loading/no_establishments/choosing/active/active_lost (design.md). Query directa supabase-js (sin PowerSync). Persiste campo activo + rastro de visitados (`last_establishment_opened`, R6.9). `switchEstablishment` + `refreshEstablishments` + `useEstablishment()`.
- Landing por cantidad (R6.7) en el AuthGate + manejo de `active_lost` (R6.10) sin logout.
- T4.3 — OnboardingWizard (R6.5): CTA dual; "pegar link" = stub Fase 5.
- T4.4 — CreateEstablishmentScreen (R3.1/3.2/3.3/3.8) con gate de teléfono (CompletePhoneScreen) + crear campo requiere conexión (R9.2).
- Cablear home `(tabs)/index.tsx` + `mis-campos.tsx` a datos reales (resuelve los 4 bugs de Raf).

NO (diferido):
- T4.5 editar/soft-delete de campo (R3.6/3.6.1) → B.1.2b (pero el ESTADO active_lost SÍ acá).
- Pegar/aceptar link de invitación (Fase 5/B.1.3) → solo el stub del CTA.
- PowerSync (Fase 7) → queries directas.
- Stats reales de las cards (rollup) → backlog.

## Plan de tareas (Tn)

- [ ] T4.1a — `app/src/services/establishment-store.ts`: persistencia del activo + rastro de visitados (patrón storage de B.1.1).
- [ ] T4.1b — `app/src/services/establishments.ts`: capa de datos (query supabase-js de roles activos + establishments; insert de campo; update de phone).
- [ ] T4.1c — `app/src/contexts/EstablishmentContext.tsx`: estado + switchEstablishment + refreshEstablishments + useEstablishment. Lógica pura testeable extraída.
- [ ] T4.1d — montar el provider en `_layout.tsx` dentro de la rama authenticated+verificada + gating (landing por cantidad R6.7 + active_lost R6.10).
- [ ] T4.3 — `app/app/onboarding.tsx` (OnboardingWizard): CTA dual (crear / pegar link stub).
- [ ] T4.4 — `app/app/crear-campo.tsx` (CreateEstablishmentScreen) + `CompletePhoneScreen` (gate de teléfono).
- [ ] Cablear home `(tabs)/index.tsx` a AuthContext + EstablishmentContext.
- [ ] Cablear `mis-campos.tsx` al EstablishmentContext.
- [ ] Tests (lógica pura: orden R6.6.1, active_lost detection, rastro de visitados, landing por cantidad).
- [ ] Autoverificación: typecheck + check.mjs + pnpm web + autorrevisión adversarial.

> Todas las tasks quedaron hechas. As-built abajo.

## Bitácora — as-built

### Storage del rastro de visitados (`app/src/services/establishment-store.ts`)
- Persiste por-usuario un rastro de ids (más reciente primero) — `last_establishment_opened` (R6.9). Mismo patrón de storage que B.1.1: web→localStorage, native→expo-secure-store. Key `rafq.est_trail.<userId>` (saneada) → rastro POR USUARIO (device compartido no mezcla cuentas). `loadTrail`/`saveTrail`/`recordOpened`. Recorta a `MAX_TRAIL` (8).
- La lógica PURA del rastro (`promoteInTrail`, `MAX_TRAIL`) vive en `utils/establishment.ts` (sin imports RN/expo) para ser testeable con node:test — el store solo hace I/O. (Mismo split que `lockout.ts` vs `lockout-store.ts` en B.1.1.)

### Capa de datos (`app/src/services/establishments.ts`)
- Queries DIRECTAS supabase-js (PowerSync diferido a Fase 7). `loadMemberships()`: join `user_roles(active=true) → establishments`, filtra soft-deleted, devuelve `{id,name,province,city,role}[]`. RLS scopea por `auth.uid()`; el cliente no mezcla campos (R7.2).
- `createEstablishment()`: `insert().select().single()` en UNA roundtrip — el trigger 0011 (AFTER INSERT) crea el `user_roles` owner antes del RETURNING (R3.2). NUNCA se hardcodea owner ni establishment_id.
- `loadOwnProfile()`/`saveOwnPhone()`: gate de teléfono (R3.8), RLS `users_*_self`.
- Clasificación de error `network|unknown` para el copy de R9.2 (crear campo requiere conexión).

### Lógica pura del contexto (`app/src/utils/establishment.ts`)
- `EstablishmentState` (5 estados, incl. `active_lost{reason,lostEstablishmentName,available}`, design.md).
- `resolveState(available, preferredId)`: landing por cantidad (R6.7) + auto-activo con 1 (R6.4) + preferido presente (R6.3/R6.9) + preferido inaccesible se ignora (R6.9).
- `detectActiveLost(currentId, available)`: el activo desapareció del set → lost (R6.10). currentId null → no lost (bootstrap nunca falsea lost).
- `sortMyEstablishments(list, headId)`: activo/último primero, resto alfabético es-AR acento-insensitive (R6.6.1).
- `buildRecents(trail, available)`: recientes del rastro (descarta inaccesibles) + resto alfabético al final (R6.8.1/R6.9). Robusto con rastro vacío.

### EstablishmentContext (`app/src/contexts/EstablishmentContext.tsx`)
- Estado + `recents` + `switchEstablishment(id)` + `refreshEstablishments()` + `acknowledgeActiveLost()` + `useEstablishment()`.
- Bootstrap por user_id: lee rastro persistido → fija preferido (head = last_establishment_opened) → carga memberships → `applyMemberships`. Re-corre si cambia el user. Reset a loading en logout (no deja estado stale).
- `applyMemberships` centraliza: detecta active_lost, resuelve estado, deriva recents, sincroniza refs. `switchEstablishment` promueve en el rastro (saliente sigue en recientes → bug (b)) y resuelve LOCAL (R9.2: cambiar de campo es offline). `refreshEstablishments` no expulsa al usuario por fallo de red transitorio (mantiene estado previo).
- Poda perezosa del rastro persistido cuando un id deja de ser accesible (R6.9).
- Provider montado en `_layout.tsx` DENTRO de la rama authenticated+verificada (se auto-inhabilita sin sesión: sin user_id queda en loading y no consulta).

### Gating raíz (`app/app/_layout.tsx`)
- `AuthGate` → `RootGate` (unifica auth + establecimiento). Orden: auth loading→splash; unauth→sign-in; !verif→verify-email; verif → est.status: loading→splash; no_establishments→/onboarding; choosing→/mis-campos; active→(tabs); active_lost→/campo-perdido.
- En `active`, solo forzamos a (tabs) si el usuario quedó varado en una ruta de gating que ya no aplica (auth/onboarding/campo-perdido). NO se saca al usuario de (tabs)/mis-campos/crear-campo (navegación legítima → sin loops). `crear-campo` nunca se re-rutea fuera mientras se está creando.
- Splash: el RootGate lo oculta tras re-rutear (FIX 1 heredado) + fallback 5s. Mantiene el splash mientras est.status==='loading' (no flashea (tabs) en cold start de un usuario con campos).
- Nuevas rutas en el Stack: onboarding, crear-campo, campo-perdido.

### Pantallas nuevas
- `app/app/onboarding.tsx` (T4.3/R6.5): CTA dual. Primario "Crear mi primer campo" → /crear-campo. Secundario "Pegar link de invitación" → STUB Fase 5 (InfoNote honesto, NO construye el flujo). Saludo con primer nombre real (AuthContext).
- `app/app/crear-campo.tsx` (T4.4/R3.1/3.2/3.3/3.8/R9.2): 2 fases en la misma ruta. Fase gate de teléfono (CompletePhoneScreen) si `users.phone` vacío → guarda phone. Fase form (name+province obligatorios; city+hectáreas opcionales) → createEstablishment → refreshEstablishments → switchEstablishment(newId) → replace a (tabs). Error de red → copy accionable (R9.2). Si no se pudo leer el perfil (red), entra al gate de teléfono por seguridad.
- `app/app/campo-perdido.tsx` (R6.10): aviso legible según `reason` (role_revoked: "Ya no tenés acceso a <campo>"; establishment_deleted: "<campo> fue eliminado"). "Entendido" → acknowledgeActiveLost() re-resuelve sobre los restantes y el gate navega (sin logout, R7.4; sin nav manual para no flashear).

### Pantallas cableadas a datos reales (resuelven los 4 bugs de Raf)
- `app/app/(tabs)/index.tsx`: fuera ESTABLISHMENT_NAME/USER_FIRST_NAME/ACTIVE_FIELD/RECENT_FIELDS. Nombre ← AuthContext (firstNameOf). Campo activo ← EstablishmentContext. Switch: active=campo real; visited=`pickVisited(recents_reales, activeId)`. `onSelectVisited`→switchEstablishment (bug a). `onCreate`→/crear-campo (bug d). Guarda de transición: sin campo activo, lienzo vacío (no mock).
- `app/app/mis-campos.tsx`: fuera MOCK_ESTABLISHMENTS/ACTIVE_ID. Lista de `state.available` ordenada con `sortMyEstablishments` (R6.6.1). `onPress`→switchEstablishment+replace a (tabs) (R6.3/R6.7). Search bar >8. Stats de cards = NEUTRAS/honestas (animalCount 0, rodeoCount 0, heroMetric 'empty' → CTA "Configurá tu rodeo") — el rollup es backlog, NO se inventan números. "Crear campo"→/crear-campo. "Pegar link"→STUB Fase 5.

### Tests (lógica pura)
- `app/src/utils/establishment.test.ts` — 18 tests: resolveState (R6.7/R6.4/R6.3/R6.9), detectActiveLost (R6.10), sortMyEstablishments (R6.6.1), buildRecents (R6.8.1/R6.9).
- `app/src/services/establishment-store.test.ts` — 6 tests: promoteInTrail (R6.9, incl. bug (b): saliente reaparece).
- `app/src/utils/validation.test.ts` — +2 tests: isValidPhone (R3.8), validateCreateEstablishment (R3.3).
- Cableados en `scripts/run-tests.mjs` (corren dentro de check.mjs). Total client unit tests: 48 (22 B.1.1 + 26 nuevos).

## Decisiones técnicas menores (default + razón)

1. **Storage del rastro = secure-store/localStorage por-usuario** (no fila propia en DB ni AsyncStorage): la spec dejó el mecanismo abierto (design.md §"Nota de implementación pendiente"). Reuso el patrón único de storage de B.1.1 para no divergir. Key por user_id → multi-cuenta en un device no mezcla.
2. **active_lost reason = 'role_revoked' por default**: desde el cliente NO se puede distinguir con certeza "rol revocado" vs "campo borrado" (en ambos la fila desaparece del set por RLS). R6.10 lista role_revoked como el caso más común (a/d); el copy de ambos es legible. Si más adelante hace falta precisión, el server podría exponer el motivo.
3. **refresh no expulsa por fallo de red transitorio**: si `loadMemberships` falla con red y ya teníamos estado válido, lo mantenemos (no falseamos active_lost). Solo en bootstrap (loading) sin nunca haber cargado caemos a no_establishments (recuperable: refrescar reintenta).
4. **Gate de teléfono fail-safe**: si no se pudo leer el perfil (red), entramos al gate de teléfono igual (mejor pedirlo que crear el campo sin contacto). El guardado también es online → el copy de R9.2 aparece ahí si sigue sin red.
5. **Stats de cards neutras** (animalCount 0 / heroMetric 'empty'): el rollup por establecimiento no existe (backlog). No inventamos números (sería data falsa al usuario). El estado 'empty' muestra el CTA "Configurá tu rodeo", honesto para un campo recién creado y placeholder aceptable hasta el rollup.
6. **crear-campo es una ruta, no un modal**: consistente con onboarding/campo-perdido (todas AuthScreenShell). El gate la trata como destino navegable que no se re-rutea mientras está abierta.

## Autorrevisión adversarial (paso 8)

Qué busqué / qué encontré / cómo lo cerré:

- **¿El contexto filtra bien por campo activo?** En Fase 4 las únicas tablas que consulto son las de membership (`user_roles`/`establishments`/`users` self), scopeadas por `auth.uid()` vía RLS — no hay tabla de negocio keyed por UN establishment_id activo todavía. El filtrado por `current.id` aplica a queries de negocio (animals/rodeos) de specs posteriores; lo dejé como SEAM. No hay mezcla de campos: `loadMemberships` solo trae los del usuario. ✔
- **¿El switch deja datos del campo viejo pegados?** La home lee TODO del contexto (`activeField`, `recents`); al hacer `switchEstablishment` el estado cambia y la home re-renderiza con el campo nuevo (no hay estado local de campo en la pantalla). No queda nada pegado. ✔
- **¿active_lost re-rutea sin logout?** Sí: `acknowledgeActiveLost` re-resuelve sobre `available` y NUNCA llama signOut (R7.4). El gate navega al destino correcto (choosing/active/no_establishments). Verificado el orden de routing (no flashea (tabs) cuando quedan 0 o ≥2). ✔
- **¿El rastro de visitados sobrevive reload?** Sí: persiste en secure-store/localStorage por-usuario; en bootstrap se relee y fija el preferido (head). El saliente sigue en el rastro (promoteInTrail no lo borra) → reaparece como visitado (bug (b) testeado). ✔
- **¿Crear campo maneja el caso sin red?** Sí: `createEstablishment` clasifica el error de red; la pantalla muestra OFFLINE_COPY accionable (R9.2). El gate de teléfono también es online y muestra el mismo copy. ✔
- **¿Loop de re-ruteo?** Revisado: el gate solo hace replace cuando el segmento NO coincide con el destino del estado; en `active` no saca al usuario de (tabs)/mis-campos/crear-campo. crear-campo nunca se re-rutea fuera mientras se crea. No hay loop. ✔
- **¿Bootstrap falsea active_lost?** No: `currentIdRef` arranca null → detectActiveLost devuelve no-lost en la primera carga (testeado). ✔
- **¿Tests que pasan por la razón equivocada?** Los tests ejercen las ramas reales (0/1/≥2 campos, preferido presente/ausente/inaccesible, lost/no-lost, orden con/sin head, rastro con ids inaccesibles/duplicados). No tautológicos. La capa de datos (queries reales) no se testea con node (toca red/RN) — cubierta por las suites Edge/RLS existentes (verde en check.mjs) que validan el mismo trigger 0011, RLS y soft-delete.
- **¿Anti-hardcode?** 0 violaciones. Todo via tokens/componentes de librería; lo que cruza a API no-Tamagui (lucide, TextInput) via getTokenValue. Los nuevos servicios/contextos/utils NO están en el alcance del lint (solo app/app + app/src/components) pero igual no llevan color/spacing. ✔
- **¿Voseo/tildes UTF-8?** "Ingresá", "Necesitás", "Conectate", "Pegá", "Bienvenido", "teléfono", "conexión", "Ángel" (test). Correcto. ✔

## Trazabilidad R<n> → test / evidencia

| R<n> | Cubierto por |
|---|---|
| R3.1 (crear campo) | `createEstablishment` (insert().select().single()) + evidencia: Edge suite `createEstablishmentAs` valida insert+select real contra el remoto (verde en check.mjs). `crear-campo.tsx` |
| R3.2 (owner automático) | trigger 0011 (AFTER INSERT, ya desplegado/testeado) — `createEstablishment` devuelve role 'owner'. Edge suite valida el owner auto-creado |
| R3.3 (nombre+provincia obligatorios) | `validateCreateEstablishment` test (validation.test.ts) + form en `crear-campo.tsx` |
| R3.8 (teléfono al crear) | `isValidPhone` test + CompletePhoneScreen (gate en `crear-campo.tsx`) + `loadOwnProfile`/`saveOwnPhone` (RLS users_*_self, verde en RLS suite) |
| R6.3 (campo activo por default) | `resolveState` (preferido presente → active) test + `switchEstablishment` |
| R6.4 (auto-activo con 1) | `resolveState` ("exactamente 1 → active") test |
| R6.5 (wizard CTA dual) | `onboarding.tsx` (primario crear / secundario pegar-link stub) |
| R6.6/6.6.1 (Mis campos + orden) | `sortMyEstablishments` tests (activo primero, alfabético, acento-insensitive) + `mis-campos.tsx` (lista real + search >8) |
| R6.7 (landing por cantidad) | `resolveState` (0→no_establishments, 1→active, ≥2→choosing) tests + RootGate |
| R6.8.1 (dropdown switch) | `buildRecents` tests + home cableada (active real + pickVisited(recents reales)) |
| R6.9 (last_establishment_opened + rastro) | `promoteInTrail` tests (incl. bug b) + `buildRecents` tests + establishment-store (persistencia) |
| R6.10 (active_lost + re-ruteo) | `detectActiveLost` tests (lost/no-lost/bootstrap) + `acknowledgeActiveLost` (re-resuelve sobre restantes) + `campo-perdido.tsx` (aviso por reason, sin logout) + RootGate. Revocación de rol → desaparece del set: validado por RLS suite (acceso invalidado en próxima query, R7.4) |
| R7.2/R7.4 (aislamiento / invalidación en próxima query) | RLS suite (verde) + `loadMemberships` solo trae campos del usuario; sin logout en active_lost |
| R9.2 (crear campo requiere conexión) | clasificación de error network en `createEstablishment`/`saveOwnPhone` + OFFLINE_COPY en `crear-campo.tsx`. Cambiar de campo = local (switchEstablishment no hace round-trip) |

## Resultado de cada paso de autoverificación

1. `cd app; pnpm.cmd typecheck` → **verde**.
2. `node scripts/check.mjs` (raíz) → **verde**: typecheck + **48 client unit tests** (22 previos + 26 nuevos) + RLS (15) + Edge (26) + Animal (28) + Maneuvers (13). Sin regresión. **Anti-hardcode: 0 violaciones**.
3. `pnpm.cmd web` (puerto 8088) → dev server levantó leyendo `app/.env.local` (`env: export EXPO_PUBLIC_SUPABASE_*`); bundle web compiló (**13.58 MB**, HTTP 200, sin Metro build-errors — `originModulePath`/`Unable to resolve` que aparecen son templates de error de Metro, no fallos). Rutas nuevas resuelven 200 (home/onboarding/crear-campo/mis-campos/campo-perdido). Módulos nuevos presentes en el bundle (EstablishmentProvider, loadMemberships, crear-campo).
4. Autorrevisión adversarial → documentada arriba.

### Cómo verifiqué cada uno de los 4 bugs de Raf

- **(a) Cambiar de campo cambia el contexto** (no solo el label): la home lee `activeField` del EstablishmentContext y `onSelectVisited`→`switchEstablishment(id)`. Al cambiar el estado, la home re-renderiza con el campo nuevo (nombre, banner, saludo, recents). No hay estado local de campo. Verificado por construcción (cableado al contexto) + typecheck + bundle. La transición de estado está cubierta por los tests de `resolveState`/`switchEstablishment` (lógica pura).
- **(b) El campo que dejaste reaparece en visitados**: `switchEstablishment`→`recordOpened`→`promoteInTrail` deja el saliente en el rastro (sube el nuevo al frente, el viejo baja un puesto, NO se borra). `buildRecents` lo mapea de vuelta a visitado y `pickVisited` lo muestra. Testeado: `promoteInTrail(['a','b','c'],'c') = ['c','a','b']` (b sigue ahí). El activo siempre es seleccionable (es el head del dropdown).
- **(c) "Ver todos mis campos" va a Mis campos**: `onSeeAll`→`router.push('/mis-campos')` (sin cambios, seguía andando).
- **(d) "Crear nuevo campo +" abre el wizard de crear campo**: `onCreate`→`router.push('/crear-campo')` (antes era no-op). Ruta resuelve 200 en web.

> Nota de verificación: el flujo E2E que mutaba la DB remota (crear/borrar users de prueba, revocar roles con service-role) lo INTENTÉ pero quedó correctamente bloqueado por el límite "NO toques la DB remota". El comportamiento backend que quería confirmar (trigger 0011 owner, soft-delete filtrado, revocación→invalidación en próxima query) YA está cubierto por las suites Edge (26) + RLS (15) que corren verdes en check.mjs y ejercen exactamente esos paths con el mismo cliente supabase-js/RLS. Lo que no se puede cerrar headless en web (clicks reales, comportamiento en device) queda para verificación manual de Raf en `pnpm web`.

## Seams / TODOs dejados

**Para B.1.2b (T4.5 — editar/soft-delete de campo, R3.6/3.6.1):**
- La pantalla de editar/soft-delete NO se construyó (diferida). El ESTADO `active_lost` (R6.10) SÍ está y se dispara correctamente cuando el campo activo desaparece del set (por soft-delete del owner o revocación de rol). Falta: `EditEstablishmentScreen` (R3.4, solo owner) + soft-delete con warning de conteo de miembros (R3.6.1) + la baja de cuenta del owner único (R2.5.1).
- El `reason` de active_lost hoy es 'role_revoked' por default (el cliente no distingue revocación de borrado). Cuando exista la UI de borrado, se puede pasar 'establishment_deleted' con mejor evidencia (ej. el server marca el motivo, o el cliente recuerda que él mismo borró el campo).

**Para B.1.3 (Fase 5 — invitaciones/miembros):**
- El CTA "Pegar link de invitación" del wizard (onboarding.tsx) y de mis-campos.tsx es STUB (InfoNote honesto). Falta el input de pegar + extracción de token (expo-linking) + AcceptInvitationScreen + persistir token (pending-invitation.ts ya existe) + re-ruteo desde verify-email (seam ya marcado en B.1.1).
- El re-ruteo desde el gate de verificación a AcceptInvitation cuando hay token pendiente sigue siendo TODO B.1.3 (marcado en verify-email.tsx desde B.1.1).

**Para specs de negocio posteriores (filtrado multi-tenant de datos):**
- Las queries a tablas de negocio (animals, rodeos, maniobras) deberán filtrar por `current.id` del EstablishmentContext (multi-tenant cliente; RLS protege server-side igual). En Fase 4 no hay tablas de negocio que consultar (solo las de membership, scopeadas por auth.uid()), así que el filtrado por campo activo no aplica todavía. El contexto ya expone el `current` para cuando se construyan.

**Para Fase 7 (PowerSync, diferida):**
- La capa de datos (`establishments.ts`) usa supabase-js directo. Al integrar PowerSync, las queries de `loadMemberships` pasan a SQLite local (los buckets `est_membership`/`est_data` ya están en el design). `switchEstablishment` ya es offline (R9.2); `createEstablishment` seguirá online.

**Edge case menor conocido:**
- Si `switchEstablishment` se llamara mientras el estado es 'loading'/'no_establishments' (available=[]) con un currentId previo set, `detectActiveLost` reportaría lost falsamente. La UI NO expone ese path (switch solo se ve en active/choosing, donde available es real). Documentado por si se reusa el método en otro contexto.

## Archivos creados / modificados

Nuevos:
- `app/src/services/establishment-store.ts` — persistencia del rastro de visitados (R6.9)
- `app/src/services/establishment-store.test.ts` — tests de promoteInTrail
- `app/src/services/establishments.ts` — capa de datos (loadMemberships/createEstablishment/loadOwnProfile/saveOwnPhone)
- `app/src/utils/establishment.ts` — lógica pura del contexto (resolveState/detectActiveLost/sort/buildRecents/promoteInTrail)
- `app/src/utils/establishment.test.ts` — tests de la lógica pura
- `app/src/contexts/EstablishmentContext.tsx` — EstablishmentContext
- `app/app/onboarding.tsx` — OnboardingWizard (R6.5)
- `app/app/crear-campo.tsx` — CreateEstablishmentScreen + gate de teléfono (R3.1/3.8)
- `app/app/campo-perdido.tsx` — aviso active_lost (R6.10)

Modificados:
- `app/src/contexts/index.ts` — export del EstablishmentContext
- `app/src/utils/validation.ts` — isValidPhone (R3.8) + validateCreateEstablishment (R3.3)
- `app/src/utils/validation.test.ts` — +2 tests
- `app/app/_layout.tsx` — gating unificado auth+establecimiento (RootGate) + EstablishmentProvider + rutas nuevas
- `app/app/(tabs)/index.tsx` — home cableada a AuthContext + EstablishmentContext (bugs a/b/d)
- `app/app/mis-campos.tsx` — cableada al EstablishmentContext (orden real, switch, crear campo)
- `scripts/run-tests.mjs` — cablea los 2 nuevos archivos de test al check

NO toqué (coordinación / leader): `feature_list.json`, `progress/current.md`, `progress/plan.md`, ni la DB remota. Tampoco marqué nada `done`.

## Fix loop (reviewer): filtro user_id en loadMemberships

**Contexto.** El reviewer encontró 1 bloqueante real (`progress/review_01-frontend-fase4.md`): `loadMemberships()` hacía `.from('user_roles').select(...).eq('active', true)` SIN filtrar por `user_id`. La policy `user_roles_select` (`0008_rls_membership.sql:11-17`) es `user_id = auth.uid() OR is_owner_of(establishment_id)` → un **owner ve TODAS las filas de roles de su campo** (es para la pantalla Members). Resultado para un owner con N miembros invitados (escenario beta: Facundo como vet en el campo del owner): N+1 filas del MISMO campo → (a) el campo se duplica N veces en "Mis campos" (rompe R6.6); (b) el `.find()` que recuperaba el rol agarraba el del primer match, que podía ser `veterinarian`/`field_operator` de otro miembro (rompe R6.6.2); (c) `available.length` inflado mandaba a un owner de UN campo a `choosing`/"Mis campos" en vez de la home (rompe R6.4/R6.7). El gap por el que pasó: la suite RLS valida el SQL/policies, no el mapeo del cliente, y `loadMemberships` no tenía test.

**Fix aplicado (quirúrgico).**
1. **Filtro por usuario** — `loadMemberships(userId: string)`: agregué `.eq('user_id', userId)` para traer SOLO los roles del propio usuario (no todos los visibles por RLS). Con R4.3 (unique index: 1 rol activo por `(user, establishment)` — verde en RLS suite) cada campo aparece exactamente UNA vez con el rol correcto del usuario. Actualicé los 2 call sites del `EstablishmentContext` (bootstrap `:210` y `refreshEstablishments` `:138`); ambos ya tienen el `userId` del AuthContext en scope (el refresh con su guard `if (!userId)` lo estrecha a `string`).
2. **Mapeo PURO testeable** — extraje `mapMembershipRows(rows: RoleRow[]) → MembershipEstablishment[]` (+ los tipos `MembershipEstablishment` y `RoleRow`) a `app/src/utils/establishment.ts`. ¿Por qué a `utils` y no a `establishments.ts`? Porque `establishments.ts` importa `./supabase` → `expo-secure-store`/`react-native`, que no carga bajo `node:test` (un test que importara desde ahí explota con `ERR_MODULE_NOT_FOUND`, lo verifiqué). `establishments.ts` re-exporta `mapMembershipRows`/`MembershipEstablishment` y los usa, sin cambio de contrato para los importadores (`mis-campos.tsx` sigue importando el tipo desde `@/services/establishments`). El mapeo, además de mapear, hace **dedup defensivo por `establishment.id`** (se queda con la PRIMERA fila): red de seguridad redundante con el filtro por user_id + R4.3, para que este bug NO reaparezca aunque en el futuro lleguen filas repetidas.
3. **Test nuevo** — `app/src/utils/establishment-mapping.test.ts` (8 tests, cableado en `scripts/run-tests.mjs`): 1 fila por campo → 1 establishment con su rol; rol owner se preserva; dedup ≥2 filas del mismo id → 1 campo quedándose con la del propio usuario (owner, no la de otro miembro); dedup en set mezclado; filtra soft-deleted (`deleted_at != null`); filtra `establishment` null; lista vacía; preserva province/city.

**Autorrevisión del fix (contra policy 0008).**
- *¿El filtro rompe el caso normal (user con 1 rol)?* No: la policy permite `user_id = auth.uid()`, la fila propia siempre pasa; `.eq('user_id', userId)` solo recorta a las filas del usuario. Tests `resolveState` (1 campo → active) y mapping "1 por campo → owner" verdes.
- *¿El dedup es por establishment.id?* Sí (`seen` sobre `e.id`); test dedicado lo cubre y verifica que se queda con la primera (rol propio).
- *¿Un owner con miembros ahora ve su campo UNA vez con rol owner?* Sí: antes la query traía owner + N miembros (por el término `is_owner_of`); ahora `WHERE user_id = ownerId` deja solo la fila owner → 1 establishment, role owner. El término `is_owner_of` de la policy ya no contamina el resultado porque el `eq('user_id')` lo recorta. El dedup es backstop.
- *¿Tests que pasan por la razón equivocada?* No: el de dedup falla si se quitara el `seen` (devolvería length 2/3); el de filtro de rol verifica que `out[0].role === 'owner'` y no el del 2º miembro.

**Verificación.** `cd app; pnpm.cmd typecheck` → verde. `node scripts/check.mjs` → verde: 56 client unit tests (48 previos + 8 nuevos del mapeo) + RLS 15 + Edge 26 + Animal 28 + Maneuvers 13. Sin regresión. Anti-hardcode 0 violaciones. RLS suite corrobora los supuestos del fix: `R4.3 unique index impide dos roles activos para el mismo par` y `R6.1 userB con roles en 2 establishments ve ambos`.

**Archivos tocados en el fix (solo estos):**
- `app/src/services/establishments.ts` — `loadMemberships(userId)` con `.eq('user_id', userId)`; tipos/mapeo movidos a utils y re-exportados.
- `app/src/utils/establishment.ts` — `MembershipEstablishment`/`RoleRow`/`mapMembershipRows` (puros, testeables).
- `app/src/utils/establishment.test.ts` — import del tipo ahora desde `./establishment.ts` (consistencia; antes lo traía de services por type-only).
- `app/src/utils/establishment-mapping.test.ts` — nuevo (8 tests del mapeo).
- `app/src/contexts/EstablishmentContext.tsx` — los 2 call sites pasan `userId`.
- `scripts/run-tests.mjs` — cablea el test nuevo del mapeo.

NO toqué pantallas, RootGate, ni nada fuera de lo listado. NO marqué `done`.

## Fix loop (Raf en web): 403 RLS-on-RETURNING en crear campo

**Bug bloqueante (confirmado por Raf probando en web).** Crear campo fallaba con
`POST /rest/v1/establishments?select=id,name,province,city → 403 (Forbidden)`.

**Causa raíz (confirmada, no hipótesis).** `createEstablishment()` usaba
`.insert(row).select('id, name, province, city').single()`. El `.select()` post-insert hace
que PostgREST evalúe la policy `establishments_select` (`has_role_in(id)`, 0007) sobre la
fila del RETURNING → **403**: en ese punto de la transacción el rol owner que crea el trigger
0011 todavía NO es visible para la policy de select. El comentario de
`0011_establishment_auto_owner.sql` afirma que `insert().select()` es seguro acá; **es FALSO
en la práctica** (lo demuestra el 403 real y ahora el test nuevo). NO se tocó la migration
0011 (ya aplicada al remoto; cambiarla generaría drift).

**Por qué pasó el gap.** La suite RLS usaba `createEstablishmentAs` como helper (insert sin
select + select separado), pero NINGÚN test validaba EXPLÍCITAMENTE el flujo real del cliente
ni que `insert().select()` falla. El helper "escondía" el patrón correcto sin probar que el
viejo rompía.

**Fix aplicado.**
1. **`app/src/services/establishments.ts` → `createEstablishment(userId, input)`** — split
   insert + select. Insert SIN `.select()`; el id del campo nuevo se recupera **diffeando el
   SET de memberships del usuario** (lo leo con `loadMemberships` ANTES del insert y DESPUÉS;
   el id que aparece en el after-set y no estaba en el before-set es el nuevo).
   - **Mecanismo elegido y por qué.** Descarté `.eq('name').single()` (como el helper del
     test): dos campos del mismo usuario pueden llamarse igual → `single()` explotaría o
     traería el equivocado. Descarté `order('created_at').limit(1)` (frágil ante concurrencia
     / reads stale). Descarté **uuid generado en cliente**: NO hay generador confiable sin
     agregar dep — `uuid` está en node_modules pero solo como transitiva (no dep directa) y
     `crypto.randomUUID` en RN necesita el polyfill `react-native-get-random-values` que NO
     está instalado; forzarlo violaría "sin agregar deps". El **diff de membership-ids** es lo
     más sólido y simple: identifica la fila exacta sin ambigüedad por nombre, reusa
     `loadMemberships` (ya filtra por user_id + dedup + soft-delete, testeado), y el campo
     nuevo ya trae `role: 'owner'` (creado por el trigger) en el after-set. La firma pasó a
     recibir `userId` (necesario para el diff).
   - Documenté en el código POR QUÉ es split (nota grande sobre RLS-on-RETURNING + 403
     confirmado) para que nadie reintroduzca `insert().select()`.
   - Edge conocido: si el insert OK pero el after-`loadMemberships` falla por red, devuelvo
     ese error de red (el campo SÍ se creó, pero no lo confirmamos en esa roundtrip; el user
     reintenta y el refresh lo levanta). NO invento un id. Aceptable para op online (R9.2).
2. **`app/app/crear-campo.tsx`** — `CreateForm` ahora recibe `userId` y lo pasa a
   `createEstablishment(userId, …)`. Guard: si `userId` es null, copy accionable (no llamamos
   la query sin identidad). El encadenamiento posterior intacto: `onCreated(result.establishment.id)`
   → `refreshEstablishments()` + `switchEstablishment(newId)` (el id devuelto es el real del
   campo, viene de `loadMemberships`).
3. **`supabase/tests/rls/run.cjs`** — test nuevo `R3.1/R3.2: crear-establishment desde cliente
   (split insert+select + owner auto)`. Crea `userC` (cliente autenticado, no service_role),
   y valida en UN test las dos mitades del fix:
   - (a) el patrón VIEJO `insert().select().single()` devuelve `data === null` + error
     (RLS-on-RETURNING) → **reproduce la causa raíz del 403**. La fila igual se inserta (falla
     el RETURNING, no el insert); la recupero por service_role y la trackeo para cleanup.
   - (b) el patrón CORRECTO (insert sin select + SELECT separado por name) trae la fila, y el
     trigger 0011 dejó a userC como `user_roles` **owner activo** del campo. Usa los helpers
     existentes (`createTestUser`/`getUserClient`/`cleanup`); limpia lo que crea.

**Autorrevisión del fix.**
- *¿Robusto ante 2 campos con el mismo nombre?* Sí: el diff NO filtra por name; diffea ids.
  Cada campo tiene id propio; el nuevo es el id ausente del before-set.
- *¿El id devuelto es el correcto?* Sí: viene de `loadMemberships` (fila real, filtrada por
  user_id, deduped, soft-delete). Incluye id+name+province+city+role 'owner'.
- *¿`crear-campo.tsx` encadena bien?* Sí: refresh + switch con el id real. Redundancia menor
  (3 `loadMemberships` entre create+refresh) aceptable para op online; correcto.
- *¿El test fallaría con el patrón viejo y pasa con el nuevo?* Sí, lo prueba explícitamente:
  asserta `data === null` + error para `insert().select()` y la fila + owner para el split.
  Ambas mitades pasaron contra el REMOTO.
- *¿El test pasa por la razón equivocada?* No: la mitad (a) falla si `insert().select()`
  empezara a funcionar (data dejaría de ser null); la (b) falla si el trigger no creara el
  owner (roles.length ≠ 1) o el select separado no trajera la fila.

**Verificación.**
- `cd app; pnpm.cmd typecheck` → **verde**.
- `node scripts/check.mjs` → **verde**: 56 client unit tests + **RLS 16 (15 previos + 1 nuevo)**
  + Edge 26 + Animal 28 + Maneuvers 13. Anti-hardcode 0 violaciones. Sin regresión.
- **El test nuevo del flujo de crear-establishment PASÓ contra el remoto** (prueba real del
  fix; el camino RLS no se puede ejercer en web headless). Salida:
  `✔ R3.1/R3.2: crear-establishment desde cliente (split insert+select + owner auto)`.

**Archivos tocados en este fix loop (solo estos):**
- `app/src/services/establishments.ts` — `createEstablishment(userId, input)` split insert+select.
- `app/app/crear-campo.tsx` — `CreateForm` recibe `userId`; guard + nuevo call.
- `supabase/tests/rls/run.cjs` — test nuevo del flujo real de crear-establishment.

NO toqué la migration 0011, `feature_list.json`, `progress/current.md`, `progress/plan.md`,
ni otras pantallas/contexto. NO marqué `done`.

## Fix loop (Raf en web): falso active_lost al crear campo

**Bug bloqueante (confirmado por Raf probando en web).** Con el insert ya funcionando (fix
anterior), al crear un campo la app NO aterriza en la home: cae en `/campo-perdido`
(`active_lost`, "Ya no tenés acceso a …"). Bug de ORQUESTACIÓN de estado en
`EstablishmentContext`, NO de backend. El insert OK, el campo se crea, pero el wiring posterior
falsea la pérdida del activo.

**Causa raíz (confirmada leyendo el código, no hipótesis).** `crear-campo.tsx → onCreated`
encadenaba DOS llamadas: `await refreshEstablishments()` + `await switchEstablishment(newId)`.
`switchEstablishment` tomaba el set `available` del **closure de `state`**. Secuencia al crear
el PRIMER campo (estado previo `no_establishments`):
1. `refreshEstablishments()` resuelve a `active` y setea `currentIdRef.current = newId` vía
   `applyMemberships` — pero `setState` es async, así que el `state` capturado por el closure
   de `switchEstablishment` **sigue siendo `no_establishments`**.
2. `switchEstablishment(newId)`: como el `state` del closure es `no_establishments`, calculaba
   `available = []`. Llamaba `applyMemberships([])` con `currentIdRef = newId` ya seteado →
   `detectActiveLost(newId, [])` ⇒ el activo "desapareció del set" ⇒ **falso `active_lost`**.

Es exactamente el edge case que yo mismo había documentado ("Edge case menor conocido:
switchEstablishment con estado no_establishments + currentId set falsearía lost… la UI no lo
expone"). **Resultó que crear-campo SÍ lo exponía** — el supuesto de que "la UI no lo expone"
era falso. Las funciones puras (`resolveState`/`detectActiveLost`) eran y siguen siendo
correctas; el bug era 100% del WIRING (orden + lectura de set stale del closure).

**Fix aplicado (3 cambios, solo `EstablishmentContext.tsx` + `crear-campo.tsx` + tests).**
1. **`refreshEstablishments(preferredId?: string)`** — acepta un `preferredId` opcional. Si
   viene, se setea `preferredIdRef.current = preferredId` ANTES de `applyMemberships(freshSet)`.
   Tras recargar del server (set fresco que YA incluye el campo nuevo), `applyMemberships →
   resolveState` resuelve a `active` sobre el campo nuevo en UNA sola operación. Como el refresh
   solo AGREGA campos (no quita ninguno), `detectActiveLost(currentId, freshSet)` da no-lost
   tanto para el 1er campo (currentId null) como para el 2º (el activo previo sigue en el set).
   Firma del tipo en el contexto actualizada a `(preferredId?: string) => Promise<void>`.
2. **`crear-campo.tsx → onCreated`** — reemplazadas las DOS llamadas por UNA: `await
   refreshEstablishments(newId)`. **Eliminé el `switchEstablishment(newId)`** del flujo de
   creación (era la fuente del bug: resolvía sobre `available` stale/vacío). El `useEstablishment()`
   ya no destructura `switchEstablishment` en esta pantalla. Mantuve el `router.replace('/(tabs)')`
   posterior. Actualicé el comentario del header del archivo (describía el flujo viejo).
3. **Endurecí `switchEstablishment`** (defensa para el resto de call sites — home
   `onSelectVisited`, mis-campos `onPress`): ya NO lee `available` del closure de `state`
   (puede estar stale). Agregué un `availableRef` (actualizado dentro de `applyMemberships` con
   el set vigente, al inicio de la función, antes de cualquier branch) y `switchEstablishment`
   lee `availableRef.current`. Guard defensivo: si `availableRef.current` está vacío, retorna
   no-op (NO resuelve a `active_lost`: sin set sobre el cual decidir pérdida, sería un falso
   positivo). Quité `state` de las deps del `useCallback` de switch (ya no lo usa).

**Verificación.**
- `cd app; pnpm.cmd typecheck` → **verde**.
- `node scripts/check.mjs` → **verde**: **58 client unit tests** (56 previos + 2 nuevos del
  invariante "crear campo") + RLS 16 + Edge 26 + Animal 28 + Maneuvers 13. Anti-hardcode 0
  violaciones. Sin regresión.
- **Test de lógica pura del invariante** (`app/src/utils/establishment.test.ts`, +2 tests):
  modelan la composición exacta del wiring de `refreshEstablishments(nuevoId)` — el set fresco
  solo agregó el campo nuevo y se fija el preferido en él:
  - PRIMER campo: `detectActiveLost({currentId:null, available:[nuevo]})` = no-lost +
    `resolveState({available:[nuevo], preferredId:nuevo})` = active sobre nuevo.
  - SEGUNDO campo: `detectActiveLost({currentId:campo1, available:[campo1,nuevo]})` = no-lost +
    `resolveState({available:[campo1,nuevo], preferredId:nuevo})` = active sobre nuevo.
  Los building blocks ya estaban cubiertos por tests sueltos de `resolveState`/`detectActiveLost`;
  estos NUEVOS fijan el INVARIANTE compuesto (la secuencia real del wiring) y nombran el
  escenario del bug, para que si alguien toca esas primitivas el contrato del fix no se rompa
  en silencio. NO son tautológicos: fallan si se invirtiera la regla de lost o el preferido no
  se respetara. **Importante:** el bug NO era de las funciones puras — era del WIRING (refs/
  closure/orden), que NO hay infra para testear con node:test (es un seam de proceso conocido,
  sin render-testing). La verificación REAL del wiring es la prueba en web de Raf.

**Autorrevisión del fix.**
- *¿El PRIMER campo cae en `active` (home), no en `active_lost`?* Sí. Estado previo
  `no_establishments` → `currentIdRef.current = null`. `refreshEstablishments(newId)` setea
  `preferredIdRef = newId`, luego `applyMemberships([nuevo])`: `detectActiveLost(null, [nuevo])`
  = no-lost (no entra al branch de lost), `resolveState([nuevo], newId)` = active sobre nuevo.
  El RootGate ve `active` → (tabs). ✔
- *¿El 2º campo queda activo sobre el nuevo?* Sí. Estado previo `active` sobre campo1 →
  `currentIdRef = campo1`. El set fresco es `[campo1, nuevo]`: `detectActiveLost(campo1,
  [campo1,nuevo])` = no-lost (campo1 sigue), `preferredIdRef = nuevo`, `resolveState` = active
  sobre nuevo. ✔
- *¿`switchEstablishment` desde home/mis-campos sigue andando?* Sí. Ambos call sites
  (`(tabs)/index.tsx:onSelectVisited`, `mis-campos.tsx:onPress`) se invocan SOLO en estados
  `active`/`choosing`, donde `applyMemberships` ya pobló `availableRef` con el set real (no
  vacío). El switch lee `availableRef.current` (mismo set que antes leía del closure, pero
  ahora sincrónico y nunca stale), promueve el rastro y resuelve sobre ese set. El guard de set
  vacío NO se dispara en esos call sites (siempre hay ≥1 campo cargado). Comportamiento
  idéntico al previo, sin la trampa del closure stale. ✔
- *¿Algún otro call site llamaba `refreshEstablishments()` sin args?* `crear-campo.tsx` era el
  ÚNICO call site (grep). El parámetro es opcional → si en el futuro se llama sin args (sync,
  aceptar invitación), funciona igual que antes (no fija preferido nuevo, resuelve sobre el
  preferido vigente). ✔
- *¿`availableRef` queda desincronizado en algún path?* No: se asigna al INICIO de
  `applyMemberships` (línea 104), antes del branch de lost y antes de resolver — todo set que
  pasa por el contexto (bootstrap, refresh, switch) actualiza el ref. En logout el efecto de
  reset deja el estado en `loading`; `availableRef` no se limpia explícitamente pero
  `switchEstablishment` ya retorna por `if (!userId)` antes de leerlo, y el próximo
  `applyMemberships` lo sobrescribe. Sin riesgo de leer un set de otro usuario en el path de
  switch. ✔
- *¿El guard de set vacío rompe el caso de 1 campo?* No: con 1 campo `availableRef.current`
  tiene length 1 → no entra al guard. El guard solo corta el no-op de "switch sin nada
  cargado" (loading/no_establishments), que es justo el falso positivo que causaba el bug. ✔
- *¿`acknowledgeActiveLost` afectado?* No lo toqué. Sigue leyendo `state.available` del closure,
  pero ahí es correcto: solo corre en estado `active_lost` (estable, no encadenado tras otro
  setState async en el mismo tick), no tiene la condición de carrera del switch post-refresh. ✔

**Archivos tocados en este fix loop (solo estos):**
- `app/src/contexts/EstablishmentContext.tsx` — `availableRef`; `applyMemberships` lo sincroniza;
  `refreshEstablishments(preferredId?)`; `switchEstablishment` lee `availableRef` + guard de set
  vacío; firma del tipo `refreshEstablishments` actualizada.
- `app/app/crear-campo.tsx` — `onCreated` usa una sola `refreshEstablishments(newId)` (sin el
  `switchEstablishment` posterior); destructuring y comentario de header actualizados.
- `app/src/utils/establishment.test.ts` — +2 tests del invariante "crear campo" (PRIMER/SEGUNDO
  campo no falsea lost y deja active sobre el nuevo).

NO toqué otras pantallas, services, migrations, `feature_list.json`, `progress/current.md`,
`progress/plan.md`, ni la DB. NO marqué `done`.
