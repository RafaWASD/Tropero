# Security Gate 1 (modo `spec`) — Feature 14 `14-pii-user-private`

**Modo**: `spec` (Gate 1, ADR-019). SCHEMA/RLS/PII-SENSITIVE → obligatorio antes de Puerta 1 humana.
**Input**: `specs/active/14-pii-user-private/{context,requirements,design,tasks}.md`.
**Fecha**: 2026-06-04.
**Origen**: cierre del finding HIGH **B3-1** (`progress/security_baseline_shipped.md`): PII de coworkers (email+phone) legible vía PostgREST directo por RLS row-level.
**Premisa**: el patrón (opción D, separación física a `user_private`) está decidido por council y NO se re-litiga. Se valida la IMPLEMENTACIÓN del patrón en la spec.

---

## Veredicto: **PASS (con 2 condiciones de fix obligatorias para el implementer)**

La spec **cierra B3-1 de verdad en TODOS los canales** (PostgREST + realtime/PowerSync por el WAL), no abre huecos nuevos de autorización, y el mapeo de lectores/escritores es **casi completo y correcto**. Verifiqué el mapeo contra el source real y encontré **2 escritores/condiciones que la spec no contempló** y que romperían o degradarían el flujo si no se atienden. Ninguno reabre B3-1 ni introduce una fuga de PII; son **gaps de completitud del move**, no de seguridad del modelo. Por eso PASS, pero las 2 condiciones son obligatorias (sin ellas, FAIL a nivel código: T-suite no pasaría / e2e roto).

El veredicto sería FAIL solo si la separación física dejara una via de re-exposición; **no la deja** (confirmado: cero views/RPCs/policies que lean `users.email`/`phone`, columnas dropeadas físicamente).

---

## 1. ¿Cierra B3-1 de verdad? — **SÍ, verificado**

| Verificación | Resultado | Evidencia |
|---|---|---|
| Policy de `user_private` estrictamente self (`user_id = auth.uid()`) | ✅ | design §2 (`user_private_select_self` / `user_private_update_self`, `using` + `with check` = `auth.uid()`); R2.1–R2.4 |
| `public.users` deja de tener `email`/`phone` (drop físico, no view/filtro) | ✅ | design §2 `alter table public.users drop column email, drop column phone`; R3.1, T6 |
| NO queda ninguna **view/materialized view** que re-exponga PII | ✅ | grep `create.*view` en las 66 migrations → **0 matches**. No hay capa de view que sangre el WAL |
| NO queda ningún **RPC/función** que lea `users.email`/`phone` | ✅ | `delete_account_tx` (`0058:40`) solo hace `update users set deleted_at`; ninguna función SQL lee email/phone |
| NO queda otra **policy** que exponga columnas de PII de coworkers | ✅ | `users_select_coworkers` (`0006:16-31`) ya no tiene columnas de PII para exponer (cierre por SUSTRACCIÓN de columnas, no por cambiar el predicado) — correcto |
| `invitations.email` NO es un canal de re-fuga | ✅ | `0008:46-55`: RLS de `invitations` es owner-of OR `email = lower(auth.jwt()->>'email')` (el invitado por SU PROPIO email del JWT). Un coworker no-owner no lee el email anotado de otros. No re-abre B3-1 |
| Argumento del council (WAL) válido | ✅ | confirmado: la separación física es la única que cubre PostgREST + realtime + PowerSync (la tabla base se replica por el WAL, ignora views/column-GRANTs). Spec deja `user_private` fuera de cualquier bucket multi-miembro (design §5). PowerSync NO wired hoy → migración barata ahora (timing correcto) |

**Conclusión**: tras el move, un coworker que pegue `GET /rest/v1/user_private?select=email,phone&user_id=eq.<otro>` recibe **0 filas** (RLS self-only), y `GET /rest/v1/users?select=email,phone` recibe **columnas inexistentes** (se dropearon). B3-1 cerrado en el canal explotable-hoy (PostgREST) y blindado para el canal futuro (WAL/PowerSync). El test T17/T-NOBYPASS lo cubre exactamente.

---

## 2. ¿Rompe lectores/escritores reales? — Mapeo verificado contra el source

Grep exhaustivo de `users.email`/`users.phone` (EFs + app/src + migrations + e2e). Mapeo de la spec vs. realidad:

### Lectores/escritores que la spec SÍ mapeó (correctos)

| Sitio | Lee/escribe | Mapeo spec | OK |
|---|---|---|---|
| `invite_user/index.ts:79,82` precheck `users!inner(email)` | lee `users.email` cross-user | R8.1 / T10 → `user_private` admin-client (forma 2 pasos §1.2b) | ✅ |
| `accept_invitation/index.ts:122-125` lookup owner `select('id,name,email')` | lee `users.email` cross-user | R8.2 / T11 → `name` de `users`, `email` de `user_private` admin-client | ✅ |
| `accept_invitation/index.ts:131-135` `newMember select('name')` | lee solo `name` | design §1.2: NO cambia (name se queda en `users`) | ✅ |
| `_shared/auth.ts:16` `data.user.email` | lee del **JWT**, no de `public.users` | design §1.2 nota: no se toca | ✅ |
| `profile.ts:40` `loadProfileNamePhone select('name,phone')` | lee `users.phone` self | R6.1,R6.3 / T12 → `phone` de `user_private` | ✅ |
| `establishments.ts:155` `loadOwnProfile select('phone')` | lee `users.phone` self | R6.4 / T13 → `user_private` | ✅ |
| `establishments.ts:173` `saveOwnPhone update({phone})` | escribe `users.phone` self | R6.4 / T13 → `user_private` | ✅ |
| `establishments.ts:198` `loadFullProfile select('name,email,phone')` | lee `users.email`+`phone` self | R6.1 / T14 → `name` de `users`, `email`+`phone` de `user_private` | ✅ |
| `establishments.ts:237` `saveProfile update({name,phone})` | escribe `users.phone` self | R6.2 / T15 → `phone` a `user_private` | ✅ |
| `members.ts:187` `user:users(id,name)` | lee solo `id,name` de coworkers | R3.3 / T16: NO cambia (ya internalizado) | ✅ |
| `delete_account/index.ts:58-62` `select('deleted_at')` | lee solo `deleted_at` | NO necesita cambio (`deleted_at` se queda en `users`) | ✅ |

`invitations.email` (`invite_user:100,126`, `accept_invitation:44`, `resend_invitation:43`, tests) → columna de la tabla **`invitations`**, NO de `users`. No afectada por el move. ✅

### GAP 1 (condición de fix obligatoria) — escritor de `users.phone` NO mapeado: helper e2e

- **`app/e2e/helpers/admin.ts:82`** — `setUserPhone()` hace `admin.from('users').update({ phone }).eq('id', userId)`.
- Tras el drop de `users.phone` (T6), **este helper falla** (columna inexistente) y rompería cualquier test e2e que lo use para saltear el gate de teléfono (R3.8 de spec 01).
- La spec NO lo lista en design §1.2/§1.3 ni en tasks (T12–T16 cubren `app/src/services`, no `app/e2e/helpers`).
- **Severidad**: MEDIUM (no es un hueco de seguridad — es service_role en harness de test — pero ROMPE la suite e2e, que el implementer debe correr verde antes del reviewer, T27).
- **Fix**: re-rutear `setUserPhone` a `admin.from('user_private').update({ phone }).eq('user_id', userId)`. Agregar a tasks como T-extra del frontend/harness.

### Búsqueda de lectores fantasma — negativa (bien)

- **Views**: 0 en todas las migrations (grep `create.*view`). No hay capa de view que el move deje colgada o que re-exponga PII.
- **RPCs/funciones SQL**: ninguna lee `users.email`/`phone` (`delete_account_tx` solo toca `deleted_at`).
- **Otros services app**: solo `profile.ts` + `establishments.ts` tocan email/phone de `users` (todos mapeados). `account.ts changeEmail` usa `auth.updateUser({email})` (toca `auth.users`, mapeado en R7/§3).
- **Tests existentes** (`tests/rls/run.cjs`, `tests/edge/run.cjs`): NO leen `public.users.email`/`phone`; usan `email` del fixture de `auth.admin.createUser` y de `invitations`. El test `edge T2.1 R5.9` (invitar `member.email` → 409 `already_member`) ejercita el precheck re-ruteado → cubierto por T21. No se rompe ningún test existente por el move (solo el helper de GAP 1).

**Conclusión punto 2**: mapeo correcto y completo salvo **GAP 1** (helper e2e). Ningún lector de PII queda huérfano ni re-expuesto.

---

## 3. Trigger de propagación de email (R7.1, opción 3A) — **SEGURO con la salvedad que la spec ya reconoce**

Hallazgo de la spec confirmado: `changeEmail` (`account.ts:48`) usa `supabase.auth.updateUser({email})` → toca `auth.users`, NO `public.users`. **Hoy `users.email` ya queda stale tras un cambio de email** (el trigger viejo solo escribe en signup, `0001:62-63`; nadie re-sincroniza). La spec cierra ese bug preexistente.

| Criterio de seguridad del trigger | Evaluación |
|---|---|
| `SECURITY DEFINER` + `search_path` fijo | ✅ design §3(A) + T9 lo exigen (patrón consistente con `handle_new_auth_user`, `0001:51-52`). Necesario: el trigger corre desde contexto `auth` y debe escribir saltando RLS en `user_private` |
| Solo propaga el email **CONFIRMADO**, no el pendiente (R7.2) | ⚠️ **válido pero shape-dependiente**: design §3(A) y T9 reconocen EXPLÍCITAMENTE que el trigger debe distinguir "email confirmado" vs "cambio pendiente" y que **el shape exacto de `auth.users` (columnas `email` / `new_email` / `email_change` / `email_confirmed_at`) debe validarse contra la versión de Supabase del proyecto**. Confirmé que NO hay referencia previa a esas columnas en el repo → es código nuevo |
| Riesgo de desincronización | bajo si el trigger se ancla al evento de confirmación (`email` de `auth.users` pasa a ser el nuevo recién al confirmar). `auth.users` = fuente de verdad; `user_private.email` = copia consultable mantenida por trigger (design §3 cierra el pendiente del context.md) |

**Veredicto trigger**: el modelo es seguro y la opción (A) es la correcta (rechaza bien (B) escritura self-service de email — reintroduciría 2 fuentes y violaría R7.2). La **única condición** es que el implementer valide el shape de `auth.users` y dispare la propagación SOLO en la transición a confirmado (T9 ya lo manda; T23/T-EMAIL-SYNC lo testea: pendiente-sin-confirmar → no cambia; confirmado → refleja). **No es un finding de seguridad** — es trabajo de implementación que la spec ya delegó correctamente con la advertencia. Lo dejo anotado como riesgo a verificar en Gate 2 (code), no como bloqueante de spec.

> Nota menor (LOW): el trigger nuevo sobre `auth.users AFTER UPDATE OF email` es un trigger sobre el schema `auth` (propiedad de Supabase). Si Supabase reescribe su flujo de email en una actualización de plataforma, el trigger podría desincronizarse silenciosamente. Mitiga el test T23 + el hecho de que `auth.users.email` sigue siendo fuente de verdad (un `user_private.email` stale solo afecta el precheck de invitación, que es soft y recuperable). Aceptable; documentar en el ADR-025.

---

## 4. Unique index — **OK, con decisión de semántica a confirmar (la spec ya la expone)**

- El parcial `where deleted_at is null` de `users_email_active` (`0001:23-25`) **no es portable** a `user_private` (que no tiene `deleted_at`), y el design §2 detecta correctamente que **un índice parcial NO admite subquery en el WHERE** (el ejemplo con `where user_id in (select ...)` NO es válido en Postgres → bien marcado como NOTA-IMPLEMENTER).
- Opción recomendada **(a) índice único total sobre `(email)`**: justificación sólida — `auth.users` ya impone unicidad global de email; el parcial-por-soft-delete existía para permitir **re-alta del mismo email tras baja**, caso de borde **no requerido por ninguna feature actual** (verificado: `delete_account` es soft-delete + ban 100 años + el FK a `auth.users on delete cascade` no se ejercita en el flujo de baja).
- **Semántica de re-alta**: con (a), el email de un usuario soft-deleted **bloquea re-registro de ese email**. Pero eso **ya es el comportamiento de hoy a nivel `auth.users`** (Supabase no permite dos `auth.users` con el mismo email vivo; un soft-delete de `public.users` NO libera el email en `auth.users`). Es decir, (a) **no introduce una restricción nueva** respecto del estado actual del sistema completo — solo respecto del índice parcial aislado de `public.users`, que nunca llegaba a ejercitarse porque `auth.users` ya bloqueaba antes.
- **Veredicto**: (a) es seguro y no rompe ningún flujo existente. Si Raf quiere preservar la posibilidad futura de re-alta del mismo email tras baja, ir por (b) (columna espejo `deleted_at` + parcial). **Decisión de producto, no de seguridad** — la spec la expone correctamente. No bloquea.

---

## 5. Backfill + migración — **OK, fail-closed**

| Criterio | Evaluación |
|---|---|
| Mueve datos sin pérdida | ✅ design §2 / R4.1 / T5: `insert into user_private (user_id,email,phone) select id,email,phone from users` ANTES del drop. Incluye soft-deleted (R4.2 — preserva contacto histórico) |
| Sin ventana de exposición | ✅ orden atómico (design §1.1): backfill → drop columns → **reescritura del trigger en la MISMA migration** (no hay ventana donde el trigger viejo inserte en `users(email)` ya inexistente). Una sola transacción todo-o-nada |
| Falla atómica si hay dato inconsistente | ✅ R4.3 / T5: `email` es `not null` en `users` hoy → el `not null` de `user_private.email` no se viola; si alguna fila lo violara, el insert aborta la migración entera |
| GRANTs fail-closed (mínimos, self-only, sin auto-expose) | ✅ R9 / design §2: `grant select, update on user_private to authenticated` (sin insert/delete), `all to service_role`, **nada a anon** (R9.3). Insert solo vía trigger `security definer`. RLS enable + self-only policies. `notify pgrst reload schema` (R9.4) |
| `on delete cascade` del FK | ✅ `user_id ... references users(id) on delete cascade` — la PII sigue el ciclo de vida del perfil; no quedan filas huérfanas |

**Una observación menor (no bloqueante)**: R2.5 dice "no otorgar insert/delete al rol authenticated". Correcto. Pero conviene que el implementer **verifique que `revoke` explícito de insert/delete** quede aplicado si algún `grant all`/default previo los hubiera otorgado (defensa en profundidad — el patrón de `0055_check_grants.sql` y `0058` ya hace smoke-checks de grants fail-closed; sugerir reusar ese patrón para `user_private`). LOW.

---

## 6. Tests de no-bypass — **cobertura adecuada**

| Test | Cubre | Suficiente para B3-1 |
|---|---|---|
| **T17/T-NOBYPASS** | coworker A pide `user_private?select=email,phone&user_id=eq.<B>` → 0 filas; `users?select=email,phone` → columnas inexistentes | ✅ es el test clave; ejercita el canal explotable (PostgREST directo) |
| **T18/T-SELF** | A lee su propio email/phone; A actualiza su phone OK; A intenta update fila de B → 0 filas | ✅ confirma que el perfil propio sigue leyendo/escribiendo su contacto |
| **T19/T-SIGNUP** | crear user en `auth.users` → fila en `users(id,name)` Y `user_private(user_id,email)` misma tx | ✅ atomicidad del trigger |
| **T21/T-INVITE-PRECHECK** | invitar email de miembro activo → `already_member` (resuelto vía `user_private`); no-miembro → OK | ✅ confirma que el precheck sigue andando vía admin-client |
| **T22/T-ACCEPT-NOTIFY** | aceptar → lookup email owner vía `user_private` sin romper | ✅ |
| **T20/T-BACKFILL** | tras migrar, cada user con email tiene su fila; conteo consistente | ✅ |
| **T23/T-EMAIL-SYNC** | confirmar cambio email → `user_private.email` refleja; pendiente → no cambia | ✅ (condicionado a T9) — clave para validar R7.2 |

**Recomendación de robustez (no bloqueante)**: T17 debería **además** verificar que, como coworker, `GET /rest/v1/users?select=*` (estrella) sobre la fila de B **no devuelva ninguna columna de contacto** (defensa contra el caso de que el implementer dejara accidentalmente una columna). Con el drop físico esto es automático, pero el assert explícito sobre `select=*` es barato y cierra la duda. Sugerido, no obligatorio.

---

## Findings

### HIGH
Ninguno. El modelo de la spec cierra B3-1 sin reabrir vías de exposición.

### MEDIUM

**M-1 — Escritor de `users.phone` no mapeado: `app/e2e/helpers/admin.ts:82` (`setUserPhone`)**
- Evidencia: `const { error } = await admin.from('users').update({ phone }).eq('id', userId);`
- Por qué: tras el drop de `users.phone` (T6), este helper falla (columna inexistente). Rompe la suite e2e que el implementer debe correr verde (T27). NO es un hueco de seguridad (service_role en harness), pero es un escritor real de la columna migrada que la spec no contempló en su mapeo.
- Fix: re-rutear a `admin.from('user_private').update({ phone }).eq('user_id', userId)`. Agregar tarea explícita (T-frontend/harness) y citar en el mapa de trazabilidad.

### LOW (anexo)

- **L-1 (R9 defensa en profundidad)**: aplicar `revoke insert, delete on user_private from authenticated` explícito + smoke-check de grants fail-closed reusando el patrón de `0055`/`0058`. La spec ya excluye insert/delete por omisión de grant; el revoke explícito + check lo blinda contra un `grant all` accidental futuro.
- **L-2 (trigger sobre schema `auth`)**: el trigger `auth.users AFTER UPDATE OF email` depende del shape interno de `auth.users` de Supabase, que la plataforma puede cambiar. Mitigado por `auth.users.email` = fuente de verdad y test T23. Documentar el riesgo y el contrato en ADR-025.
- **L-3 (test T17)**: sumar assert de `users?select=*` como coworker → sin columnas de contacto (barato, cierra la duda del move físico).

---

## Tabla de inputs (campos del usuario tocados por esta spec)

Leyenda: **server** = CHECK/varchar de DB o guard de EF (autoritativa) · **solo-cliente** = sanitizador RN (UX, bypasseable) · **ausente**.

| Campo | Límite (largo/charset/formato) | Validación | OK? |
|---|---|---|---|
| `user_private.email` (signup/cambio email) | formato regex (Supabase Auth) + unicidad (unique index) | **server** (Auth valida formato; `not null` + unique index en DB). Largo superior sin tope (heredado de baseline INPUT-1, **fuera de scope de esta spec**) | ⚠️ parcial (no regresión: igual que hoy en `users.email`) |
| `user_private.phone` (perfil) | 20 chars / 8–15 díg (cliente `PHONE_MAX_DIGITS`) | **solo-cliente** — DB sigue siendo `text` sin CHECK (heredado de INPUT-1, **fuera de scope**) | ⚠️ parcial (no regresión) |

**Nota**: esta spec **mueve** PII existente; NO agrega formularios ni campos nuevos de entrada. El gap de tope server-side de `email`/`phone` es el finding **INPUT-1 del baseline** (HIGH, transversal), explícitamente asignado a spec 13 / backlog, NO a esta spec (context.md §Fuera). El move a `user_private` **no empeora ni mejora** ese gap (la columna sigue siendo `text` sin CHECK, ahora en otra tabla). No es regresión y no bloquea este Gate 1. **Recomendación oportunista**: dado que la migración ya recrea las columnas en `user_private`, sería barato sumar `CHECK (char_length(phone) <= 20)` y `CHECK (char_length(email) <= 254)` acá mismo (single source of truth con el cliente) y adelantar parte de INPUT-1 — pero es decisión del leader si se mete en scope o se deja a spec 13.

---

## Tabla de rate limits (acciones abusables tocadas por esta spec)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| `invite_user` precheck (re-ruteado a `user_private`) | n.a. (sin cambio) | — | — | el re-ruteo no agrega superficie abusable; el finding E2-1 del baseline (EF sin cuota propia) es preexistente y fuera de scope |
| cambio de email → trigger propagación | n.a. | — | — | el rate de cambio de email lo cubre `[auth.rate_limit]` nativo de Supabase Auth (no aflojado por esta spec); el trigger es server-driven, sin input directo de rate |
| update `user_private` (self, perfil) | n.a. | per-user (RLS self) | sí (RLS) | escritura self-only acotada por RLS; abuso bajo (solo afecta la propia fila) |

**Veredicto rate limits**: esta spec **no afloja** ningún `[auth.rate_limit]` de `config.toml` ni introduce una acción abusable nueva. El cambio de email sigue cubierto por el rate nativo de Auth. Sin findings de rate limit propios de esta spec.

---

## Dominios revisados (catálogo A–I)

- **B (exposición de datos)** — foco principal: B3-1 (cierre verificado), B3 column-level (resuelto por separación física). ✅
- **A (authz objeto/función)** — A1 service-role: los lectores cross-user de PII van por admin-client correctamente scopeado (precheck por `establishment_id`+`active`; lookup owner por `inv.invited_by` derivado del token). A2 mass-assignment: el trigger y los services arman el insert/update campo por campo, no spread. ✅
- **C (offline/sync)** — C1/C2: la razón decisiva del patrón. La spec deja `user_private` fuera de buckets multi-miembro (habilitador, no implementación; PowerSync no wired). ✅
- **H (auth/sesión)** — H: cambio de email vía flujo nativo (doble confirmación preservada, R7.2). ✅
- **I (compliance)** — I1: PII (Ley 25.326) separada y self-only; soft-delete con cascade preserva el modelo. ✅
- **Validación de inputs** — sin campos nuevos; gap de tope heredado fuera de scope (ver tabla). ✅
- **Rate limits** — sin regresión (ver tabla). ✅

## Dominios excluidos (con justificación)

- **D (secretos/supply chain)** — N/A: la spec no agrega secrets, imports Deno nuevos, ni service_role en cliente. El admin-client de las EFs ya existía.
- **E (abuso/escala)** — N/A propio: E2-1 (EF sin cuota) y E3-1 (captcha off) son findings preexistentes del baseline, no introducidos ni agravados por esta spec.
- **F (inyección/ingesta)** — N/A: el precheck re-ruteado usa `.eq('email', $)` parametrizado (no concatena en `.or()`); sin import de archivos ni `fetch` a URL de usuario.
- **G (BLE)** — N/A: la spec no toca el canal BLE.

---

## Escalamientos al leader

Ninguno requiere decisión arquitectónica no cubierta por ADR. El patrón ya fue decidido por council (context.md) y la spec propone ADR-025 (T24) para fijarlo. Las 2 decisiones abiertas que la spec expone (unique index (a) vs (b); meter o no `CHECK` de largo oportunista) son **decisiones de producto menores**, no bloqueantes de seguridad — el leader/Raf las resuelve en Puerta 1.

## Condiciones de fix para el implementer (a verificar en Gate 2 code)

1. **(M-1, obligatoria)** Re-rutear `app/e2e/helpers/admin.ts:82` `setUserPhone` a `user_private` — sin esto la suite e2e (T27) no pasa.
2. **(R7.1/T9, obligatoria — ya en la spec)** Validar el shape real de `auth.users` y disparar la propagación SOLO en la transición a email confirmado (R7.2). Test T23 debe verificar ambos casos.
3. **(L-1, recomendada)** `revoke insert, delete` explícito + smoke-check de grants fail-closed (patrón `0055`/`0058`) sobre `user_private`.
