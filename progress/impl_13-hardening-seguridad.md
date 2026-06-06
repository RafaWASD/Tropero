# Implementación — Feature 13 `13-hardening-seguridad`

baseline_commit: 6a92ceb1773fb3a4dce9e4b3ebb565209f9f8c0d

> Punto desde el cual Gate 2 (security_analyzer modo `code`) calcula el diff.
> Trabajamos sobre `main` (no feature-branches) → NO se usa `main...HEAD`.
> NO sobreescribir si ya existe (feature multi-sesión: SHA previo a la primera task).

**Spec**: `specs/active/13-hardening-seguridad/{requirements,design,tasks}.md`.
**Insumo seguridad**: `progress/security_spec_13-hardening-seguridad.md` (Gate 1 PASS).
**Estado**: `in_progress` (Puerta 1 aprobada por Raf, Gate 1 PASS).

## Reglas de ejecución de esta sesión (del leader)

1. **Migración 0070** (en disco 0068 = feature 14 committeada; otra terminal tomó 0069 para timeline). Verificado: `Glob supabase/migrations/*.sql` → máx en disco = **0069** → 0070 libre. Asignado **0070** (INPUT-1) y **0071** (A1-1), independientes entre sí.
2. **NO aplicar NINGUNA migración al remoto** ni redeploy de EFs. El deploy lo hace el LEADER (gateado, MCP read-only → Management API). Ver §Pendiente del apply del leader.
3. **OJO COLISIÓN**: otra terminal activa en feature 2 (frontend timeline, ya tocó `event-timeline.ts`, agregó 0069). Toques en archivos compartidos (`animals.ts`, EFs) quirúrgicos; el leader hace commit selectivo.
4. **Verificación sin remoto**: `node scripts/check.mjs` (tests puros/cliente + typecheck + anti-hardcode). El FAIL "2 features in_progress" es preexistente (feature 1 + 13), NO regresión. Tests CHECK/RLS/EF que requieren la migración aplicada: escritos pero corren verde recién post-apply.

## Plan (T1..T21)

- **INPUT-1**: T1 pre-check datos legados · T2 migración 0070 (45 CHECKs / 15 tablas) · T3 test PostgREST/SQL directo (subconjunto representativo + ≥3 tablas nuevas).
- **B1-1**: T4 helper `serverError` · T5 `_shared/auth.ts:44` genérico · T6 reemplazo de ~32 ocurrencias en 8 EFs · T7 test no-leak.
- **A1-1**: T8 migración 0071 (`animals_update with check`) · T9 verificar trigger 0036 · T10 test cross-tenant.
- **F1-1**: T11 `SEARCH_TERM_MAX_LENGTH` · T12 parametrizar `.or()` + tope término · T13 `maxLength` TextInput · T14 test filter-injection + tope · T15 test puro.
- **H1-1**: T16 verificar API por-user-id · T17 remove_member · T18 change_member_role · T19 test invalidación.
- **Cierre**: T20 check.mjs + suites · T21 autorrevisión adversarial.

## Bitácora

### T16 (resuelto temprano — SPEC-MED-2, incógnita técnica de la tarea)

**Verificación de la API GoTrue por-user-id en `@supabase/supabase-js@2` (auth-js `2.106.1`).**

Leí la superficie pública de `GoTrueAdminApi` (`app/node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.{d.ts,js}`):

- `signOut(jwt, scope)` → **solo acepta un JWT** (access token de la sesión a revocar): `POST /logout?scope=...` con el `jwt` en el header `Authorization`. **NO acepta user id.** El caller (owner) NO posee el access token del target → `signOut(targetUserId)` trataría el UUID como JWT y fallaría / no-op. **No sirve para R9.**
- Métodos que aceptan user id: `getUserById(uid)`, `updateUserById(uid, attrs)`, `deleteUser(id)`. **NO hay** ningún `logout/revoke/sessions by user id` en la superficie.
- Mecanismo per-user-id que SÍ revoca sesiones: `updateUserById(targetUserId, { ban_duration })`. GoTrue, al setear `ban_duration`, revoca los refresh tokens activos del usuario en el servidor (las sesiones dejan de poder refrescar). `delete_account` ya documenta y usa exactamente este patrón (`index.ts:18-27, 40, 170-179`): comentario "El ban (`updateUserById(user.id, {ban_duration})`) SÍ toma user.id y es la barrera real".

**Conclusión sobre el "escalamiento" del brief**: el brief dice "si la API por-user-id NO existe, NO aceptes el fallback `active:false`-solo → escalá al leader". La API `signOut(userId)` **NO existe**, pero **SÍ existe** un mecanismo de revocación de sesión **por user id** (`updateUserById` + `ban_duration`). Por lo tanto **NO** estoy en el caso "no hay API → fallback `active:false`-solo": R9 SÍ se puede cumplir por user id. **No bloqueo ni acepto el fallback degradado.**

**Decisión que SÍ escalo al leader (no la invento)**: `delete_account` usa un ban de **100 años** (el usuario nunca debe re-loguear). Para remove/degrade eso es **incorrecto**: un miembro removido conserva roles en OTROS campos y debe poder seguir usando la app; un miembro degradado debe seguir con el rol nuevo. Necesito **revocar la sesión actual sin lock-out permanente**. La vía limpia con esta lib es un **ban finito y corto** (ej. `'1s'`): revoca los refresh tokens activos del target AL setear el ban (R9 cumplido: el próximo refresh falla) y permite re-loguear pasada la ventana. El residual que el leader debe confirmar conscientemente: **el ban finito introduce una ventana de lock-out de login** (≈1s) para el target — trade-off aceptable (revocación inmediata de sesión vs micro-ventana de no-login). Implementado con `BAN_DURATION_REVOKE = '1s'` (constante en cada EF, documentada). Esto es **mejor** que `active:false`-solo (cumple R9) y **acotado** vs el ban permanente de `delete_account`. Marcado para la Puerta humana / SPEC-MED-2.

### Archivos entregados (NINGUNO aplicado/deployado al remoto)

**Migraciones nuevas (NO aplicadas — apply gateado por el leader):**
- `supabase/migrations/0070_check_text_length_caps.sql` — INPUT-1: 45 CHECKs sobre 15 tablas (R1.1–R1.45). `char_length(col) <= N` para text; `octet_length(col::text) <= N` para los 3 jsonb (`plan_limits` 16384, `custom_config` 16384, `structured_payload` 32768). Patrón `add constraint ... not valid` + `validate constraint`. **Pre-check de datos legados (T1/R1.46)**: un `DO`-block al tope cuenta filas fuera de rango por columna y **aborta visible** (23514) con la lista de columnas/cuántas antes de tocar el schema → el apply es todo-o-nada. Excluidas (R1.48) documentadas en cabecera. `tag_electronic`/`calf_tag_electronic` solo largo, NO formato (R1.49). Cierra con `notify pgrst`.
- `supabase/migrations/0071_animals_update_with_check.sql` — A1-1: `drop policy if exists animals_update` + recrea con `using` IDÉNTICO al as-built (0022:35-39) y `with check` = misma condición `has_role_in`. Cabecera documenta R5.5 (trigger 0036 `animals_block_tag_change` cubre la inmutabilidad del EID, verificado: `before update of tag_electronic ... for each row` → dispara en PostgREST directo, no solo RPC). `notify pgrst`.

**Edge Functions (NO redeployadas — deploy gateado por el leader):**
- `_shared/errors.ts` — helper `serverError(code, detail)`: `console.error` del detalle + `jsonError(500, code, 'Error interno, probá de nuevo.')`. Reusa `jsonError` (headers/CORS). (R3.1)
- `_shared/auth.ts` (`requireOwnerOf:44`) — `HttpError(500, 'db_error', error.message)` → `console.error('[requireOwnerOf]', error)` + `HttpError(500, 'db_error', 'Error interno, probá de nuevo.')`. Cierra el leak transversal: el catch de cada EF re-tira `jsonError(err.status, err.code, err.message)`, ahora el message del 500 es genérico. (R3.3)
- 8 EFs (`accept_invitation`, `cancel_invitation`, `change_member_role`, `delete_account`, `invite_user`, `register_push_token`, `remove_member`, `resend_invitation`) — 32 ocurrencias `jsonError(500, 'db_error'|'unexpected', X.message)` → `serverError('db_error'|'unexpected', X)`. `console.error` de cada catch unificado en `serverError` (R3.5: el detalle sigue yendo a logs). Los `console.error('... signOut ...')` de `delete_account` (logs, no respuesta) intactos. **Verificado por grep**: 0 `jsonError(5xx, ..., .message)` y 0 `HttpError(5xx, ...)` no-genérico restante. (R3.2, R3.4)
- `remove_member/index.ts` + `change_member_role/index.ts` — H1-1: tras el write de `user_roles`, `updateUserById(targetUserId, { ban_duration: '1s' })` fail-soft (`console.error` si falla, NO revierte el rol, NO expone al cliente). (R9.1/R9.2/R9.4/R9.5)

**Cliente (frontend):**
- `app/src/utils/animal-identifier.ts` — `SEARCH_TERM_MAX_LENGTH = 64` (fuente única) + recorte autoritativo del término en `classifySearchQuery` (`query.slice(0, 64)` antes del `.trim()` → topa normalized + compact → todas las sub-queries). **Por qué la constante vive acá y no en `animal-input.ts`**: un import de VALOR cross-file rompe el type-stripping de node:test (no resuelve extensionless; con `.ts` explícito `tsc` lo rechaza por `allowImportingTsExtensions` off). Vivir donde se consume (classifySearchQuery) evita el cross-import. El design dice "ej. junto a animal-input.ts" (ejemplo, no mandato); `animal-identifier.ts` es el módulo compartido natural. (R7.1, R7.3)
- `app/src/services/animals.ts` — rama `.or(\`visual_id_alt.ilike.%...%\`)` → `.ilike('visual_id_alt', \`%${escapeIlike(term)}%\`)` parametrizado (el valor viaja fuera del string de filtro → filter injection de `.or()` neutralizado de raíz). `escapeIlike` retenido solo para comodines `% _` del patrón. `.or(` ya NO existe en el archivo. (R7.1, R7.2, R7.5)
- `app/app/(tabs)/animales.tsx` — `maxLength={SEARCH_TERM_MAX_LENGTH}` en el TextInput del buscador (UX). (R7.4)

**Tests:**
- `app/src/utils/animal-identifier.test.ts` — +5 tests puros F1-1 (R7.3/R8.2/R8.3): recorte a 64 (normalized+compact), dígitos largos recortados antes de clasificar TAG, término <=64 intacto (R7.5), metacaracteres de `.or()` clasificados como texto literal (R7.2). **Corren VERDE ya** (puros, sin red). Wired en run-tests.mjs.
- `supabase/tests/animal/run.cjs` — nuevo bloque `spec 13 — INPUT-1/A1-1/F1-1 (DB layer)`, **GATED por `SPEC13_APPLIED`** (skip hasta el apply de 0070+0071): T3/R2 (INPUT-1 techo+1→23514 + borde persiste, muestreo por clase/tipo incl. `sanitary_events.notes`, `weight_events.notes`, `animal_events.structured_payload` jsonb-bytes, `animal_profiles.{notes,coat_color}`, `animals.tag_electronic`, `establishments.name`), T10/R6 (A1-1 cross-tenant: A no puede UPDATE animal solo-de-B → 0 filas; control positivo B sí), T14/R8.1 (F1-1 `.ilike` parametrizado no cruza columna vs término malicioso). Fixtures service-role + assertions JWT real de miembro, vía PostgREST directo.
- `supabase/tests/edge/run.cjs` — nuevo bloque `spec 13 — B1-1/H1-1`, **GATED por `SPEC13_APPLIED`** (skip hasta redeploy): T7/R4.1 (5xx db_error por uuid inválido → body trae copy genérico + code estable, NO filtra `.message`/schema; control negativo: 4xx conserva copy a mano), T19/R10.1+R10.2 (remove/change_member → refresh token previo del target revocado).

### Trazabilidad R<n> → test concreto

| R<n> | Test | Archivo | Corre |
|------|------|---------|-------|
| R1.1–R1.45 / R1.47 / R1.48 / R1.49 (INPUT-1 CHECK) | `R2: INPUT-1 CHECK rechaza techo+1 (23514) y acepta el borde` | `supabase/tests/animal/run.cjs` | post-apply |
| R1.46 (pre-check datos legados) | `DO`-block del pre-check en la migración (aborta visible) | `0070_check_text_length_caps.sql` | en el apply |
| R2.1–R2.4 (test INPUT-1 muestreo) | mismo test R2 (clases + text/jsonb + ≥3 tablas refinamiento) | `animal/run.cjs` | post-apply |
| R3.1 (helper) / R3.2 / R3.3 / R3.4 / R3.5 (B1-1) | `R4.1: 5xx no filtra .message` + `R4: 4xx conserva copy` | `edge/run.cjs` | post-deploy |
| R4.1 (test B1-1) | `R4.1: un 5xx (db_error por uuid inválido) NO filtra el .message` | `edge/run.cjs` | post-deploy |
| R5.1 / R5.4 (A1-1 policy) | `R6.1: miembro de estA NO puede UPDATE animal solo-de-B` | `animal/run.cjs` | post-apply |
| R5.2 / R5.3 (A1-1 semántica) | mismo R6.1 (reject) + control positivo R6.2 | `animal/run.cjs` | post-apply |
| R5.5 (inmutabilidad tag) | verificado contra 0036 + documentado en `0071` (cabecera) | `0071` | estático |
| R6.1 / R6.2 / R6.3 (test A1-1) | `R6.1` (reject 0 filas vía PostgREST) + control positivo | `animal/run.cjs` | post-apply |
| R7.1 / R7.2 / R7.5 (F1-1 parametrización) | `R8.1: .ilike parametrizado no cruza columna` + 5 puros | `animal/run.cjs` + `animal-identifier.test.ts` | mixto |
| R7.3 (tope término) | `F1-1 (R7.3): recorte a 64` (×2) + R8.1 DB | `animal-identifier.test.ts` (verde ya) | ya |
| R7.4 (maxLength UX) | `maxLength={SEARCH_TERM_MAX_LENGTH}` (capa UX, no autoritativa) | `animales.tsx` | estático |
| R8.1 / R8.2 / R8.3 (test F1-1) | `R8.1` DB + 5 puros (recorte/metacaracteres) | `animal/run.cjs` + `animal-identifier.test.ts` | mixto |
| R9.1 / R9.2 / R9.4 / R9.5 (H1-1) | `R10.1` + `R10.2` (refresh revocado) | `edge/run.cjs` | post-deploy |
| R9.3 (API por user id) | verificado en §T16 (updateUserById por uid) + documentado en las EFs | impl §T16 | estático |
| R10.1 / R10.2 / R10.3 (test H1-1) | `R10.1` (remove) + `R10.2` (change_role) en la suite edge | `edge/run.cjs` | post-deploy |

### Autorrevisión adversarial (paso 8 / T21) — qué busqué, qué encontré, cómo lo cerré

Pasada hostil sobre mi propio trabajo (NO pasamanos):

1. **¿Algún 5xx sigue filtrando `.message`/schema?** Re-grep `jsonError\(5[0-9][0-9]` y `HttpError\(5[0-9][0-9]` y `(err as Error).message` devuelto al cliente → **0 restantes** (el único `jsonError(500,...)` es el interno de `serverError` con copy fijo; el único `HttpError(500,...)` es el genérico de `auth.ts`). El catch `jsonError(err.status, err.code, err.message)` quedó seguro porque tras T5 el único 500 que llega como HttpError es el genérico. **Cerrado.**
2. **¿El `with check` recreado debilita el `using`?** Re-leí 0071: el `using` es byte-idéntico al de 0022; el `with check` pasa de `true` a la misma condición. No debilita; defensa en profundidad. **OK.**
3. **¿Los tests pegan a PostgREST/SQL directo (no UI)?** Verificado: el bloque animal usa `clientA.from('...').update(...).eq(...)` (PostgREST directo con JWT de miembro), el bloque edge usa `functions.invoke` + `refreshSession` (no UI). **OK.**
4. **Edge: NULL en CHECKs (R1.47).** `char_length(NULL) <= N` = NULL → CHECK pasa, no rechaza NULL; la migración NO agrega NOT NULL. **OK.**
5. **Edge: inmutabilidad de tag_electronic vs mi test INPUT-1.** El animal del test se crea con IDV (tag NULL) → el trigger 0036 permite NULL→valor; el CHECK de largo fira igual sobre la asignación inicial (33 chars → 23514; 32 → persiste). No hay falso negativo por el trigger. **OK.**
6. **Edge: jsonb por bytes — ¿el techo+1 realmente supera?** `{"k":"<32768 a>"}` = 32776 bytes > 32768 → 23514; `{"k":"<32000 b>"}` = 32008 < 32768 → persiste. Matemática verificada. **OK.**
7. **Test que pasa por la razón equivocada.** El test B1-1 R4.1 además de assertar el code/copy, barre el body por fragmentos de schema/driver (`uuid`, `22p02`, `postgres`, `pgrst`, `relation`, `column`, `select`, ...) → no pasa solo por code. El A1-1 valida `affected === []` (reject real) Y el control positivo (no es un falso bloqueo). El F1-1 DB compara malicioso vs literal (no solo "no rompe"). **OK.**
8. **H1-1 — ¿el ban finito realmente revoca el refresh?** El test captura el refresh ANTES, remueve, e intenta `refreshSession({refresh_token})` con cliente fresco → espera fallo. GoTrue revoca los refresh tokens al setear `ban_duration`; la revocación PERSISTE aunque el ban (1s) ya haya expirado al momento del assert (un token revocado no "revive"). El target puede re-loguear con credenciales pasada la ventana (no permanente). **OK — pero el residual de la micro-ventana de lock-out queda escalado al leader (§T16), no es un bug, es una decisión de producto.**
9. **¿Algún 4xx con copy a mano se rompió?** No toqué ningún `jsonError(4xx, ...)`; el control negativo del test edge (R4) lo confirma (`new_role inválido.` intacto). **OK.**
10. **Gating de tests: ¿check.mjs queda verde?** Los 2 bloques nuevos remote-dependent están `{ skip: spec13Skip }` (gated por `SPEC13_APPLIED`) → check.mjs verde (323 unit, 17 RLS, 36 edge + 1 skip, 42 animal + 1 skip, 13 maniobras, 19 user_private; anti-hardcode 0). El leader habilita post-apply con `SPEC13_APPLIED=1`. **OK.**

**No quedó nada abierto de la autorrevisión.** El único punto que NO cierro yo (por diseño) es la decisión de producto del ban finito (H1-1) → escalada al leader/Puerta humana (SPEC-MED-2).

## Pendiente del apply del leader (gateado, MCP read-only → Management API)

1. **Aplicar `0070_check_text_length_caps.sql`** al remoto. El pre-check (DO-block) aborta visible si hay datos legados fuera de rango (esperado: ninguno en el beta). En disco es 0070; el remoto registra con su propia numeración (divergencia con la otra terminal que aplicó Tier 2 con timestamps → NO `supabase db push`; usar Management API `/database/query` envuelto en BEGIN/COMMIT, mismo patrón que 0068).
2. **Aplicar `0071_animals_update_with_check.sql`** al remoto (drop+create de la policy + `notify pgrst`).
3. **Redeploy de las 8 EFs** (`accept_invitation`, `cancel_invitation`, `change_member_role`, `delete_account`, `invite_user`, `register_push_token`, `remove_member`, `resend_invitation`) — todas tocan `_shared/errors.ts`/`_shared/auth.ts`; `remove_member`/`change_member_role` además el signOut. `verify_jwt=true` (config.toml). `npx supabase functions deploy` (bundlea `_shared`).
4. **Habilitar los tests gated**: correr las suites animal + edge con `SPEC13_APPLIED=1` (env) → los 2 bloques skipped deben quedar verdes. Confirmar 23514 en INPUT-1, 0-filas en A1-1, copy genérico en B1-1, refresh revocado en H1-1.
5. **Decisión de producto pendiente (Puerta humana / SPEC-MED-2)**: confirmar el ban finito `'1s'` de H1-1 (micro-ventana de lock-out de login del target tras remove/degrade). Alternativas si Raf lo objeta: ban aún más corto, o documentar la deuda. NO es bug; es trade-off.

---

## Fix-loop Gate 2 — HIGH-1 (B1-1 functional break: `serverError` usado sin importar)

**Insumo**: `progress/security_code_13-hardening-seguridad.md` → FAIL, HIGH-1. Los otros 4 fixes (INPUT-1 / A1-1 / F1-1 / H1-1) quedaron OK — NO se tocaron.

### El bug
`invite_user/index.ts` y `accept_invitation/index.ts` llamaban `serverError(...)` (5 veces c/u, B1-1) pero NO lo importaban de `../_shared/errors.ts`. En Deno eso es `ReferenceError: serverError is not defined` en runtime en TODO path 5xx: las llamadas dentro del `try` caen al `catch (err)` final → `return serverError('unexpected', err)` → **re-tira ReferenceError sin catch** → la EF no devuelve `Response` controlada, sino el 500 genérico del runtime (information disclosure reintroducida, lo opuesto al fix B1-1). No lo agarró ni `check.mjs` (no type-checkea Deno) ni la autorrevisión previa (grepeó `.message` devuelto, no `serverError` importado donde se llama).

### Fix aplicado (1 línea de import por archivo)
- `invite_user/index.ts:12` → `import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';`
- `accept_invitation/index.ts:13` → `import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';`

Consistente con las 6 EFs que ya lo importaban. NO se tocó ninguna llamada ni ningún otro fix.

### Matriz uso/import de `serverError` (8 EFs + `_shared/auth.ts`), verificada por grep `serverError` (uso) vs `import {…serverError…}` (import)

| archivo | usa `serverError` (líneas) | importa `serverError` | consistente |
|---|---|---|---|
| `accept_invitation/index.ts` | 48, 83, 103, 115, 191 | **sí (l.13, AÑADIDO)** | ✓ (fixeado) |
| `invite_user/index.ts` | 88, 100, 121, 151, 167 | **sí (l.12, AÑADIDO)** | ✓ (fixeado) |
| `cancel_invitation/index.ts` | 41, 65, 73 | sí (l.9) | ✓ |
| `change_member_role/index.ts` | 68, 91, 109, 128, 150 | sí (l.11) | ✓ |
| `delete_account/index.ts` | 65, 84, 100, 114, 145, 187 | sí (l.30) | ✓ |
| `register_push_token/index.ts` | 76, 84 | sí (l.9) | ✓ |
| `remove_member/index.ts` | 65, 84, 103, 125 | sí (l.10) | ✓ |
| `resend_invitation/index.ts` | 47, 76, 91 | sí (l.14) | ✓ |
| `_shared/auth.ts` | **no** (usa su propia clase `HttpError`, self-contained) | n.a. | ✓ (no aplica) |

**Resultado**: 8/8 EFs consistentes (uso ⇒ import). `_shared/auth.ts` no usa `serverError` (no requiere import). Solo `invite_user` + `accept_invitation` estaban rotas — confirmado que no había más de 2 (se grepeó uso vs import en TODAS, no se asumió).

### Auditoría manual extra de símbolos (sustituto de `deno check`)
`deno` NO está disponible localmente (`deno --version` → `command not found` en Bash; `where.exe deno` → no encontrado; no está en PATH de PowerShell). **NO se instaló nada.** En su lugar, lectura completa de los 2 archivos fixeados verificando que TODO símbolo referenciado esté importado o sea built-in:
- `invite_user`: `handleOptions`, `jsonError`, `jsonOk`, `serverError`, `createAdminClient`, `createUserClient`, `HttpError`, `requireOwnerOf`, `requireUser` — todos importados; `Deno`, `crypto`, `Date`, `Set` built-ins. Sin gap.
- `accept_invitation`: `handleOptions`, `jsonError`, `jsonOk`, `serverError`, `createAdminClient`, `createUserClient`, `HttpError`, `requireUser`, `sendInvitationAcceptedEmail`, `sendExpoPush` — todos importados; `Deno`, `Date` built-ins. Sin gap.
Ningún otro símbolo no importado en estos 2 archivos. (Las otras 6 EFs ya estaban verificadas por el Gate 2 como correctas; no se re-auditaron en profundidad porque su import de `serverError` ya estaba presente.)

### Re-verificación
`node scripts/check.mjs`: typecheck cliente OK + 323 unit + 17 RLS + 36 edge (+1 skip SPEC13) + 42 animal (+1 skip SPEC13) + 13 maniobras + 19 user_private → **todo verde**, anti-hardcode 0. Los 2 bloques skipped siguen gated por `SPEC13_APPLIED` (esperado hasta el apply/redeploy del leader). El único `[FAIL]` es **"2 features en in_progress"** — preexistente (otra terminal), NO de este fix.

NO se aplicó nada al remoto. NO se tocaron los otros fixes ni archivos de otras features/terminales. Listo para re-Gate 2 + redeploy de las 8 EFs.

---

## Fix-loop REVIEWER #1 — H1-1 (R9): el ban finito NO invalida la sesión (BLOCKER, confirmado empíricamente por el leader)

**Insumo**: `progress/review_13-hardening-seguridad.md` #1 (CHANGES_REQUESTED) + verificación empírica del leader: tras ban 1s + 2.5s de espera, `refreshSession` con el token original VUELVE A FUNCIONAR → el ban solo bloquea ~1s, NO revoca el refresh token persistente. Los otros 4 fixes (INPUT-1/B1-1/A1-1/F1-1) quedaron APROBADOS — **NO se tocaron**.

### El defecto
`updateUserById(targetUserId, {ban_duration:'1s'})` setea `banned_until = now()+1s`; GoTrue rechaza login/refresh mientras `banned_until > now()`, pero NO borra/revoca los refresh tokens existentes. Expirado el ban, el refresh token original sigue vigente → `refreshSession` posterior produce sesión válida. R9.1/R9.2 exigen invalidación **persistente** de la sesión. La premisa load-bearing de mi autorrevisión previa (T21 punto 8: "la revocación PERSISTE aunque el ban haya expirado") era **incorrecta para un ban finito** — asumí en vez de verificar. El test R10 anterior era timing-based (condición de carrera: verde solo dentro de la ventana de 1s).

### Mecanismo correcto (decisión del leader): replicar `signOut(global)` pero por USER-ID
`signOut(global)` —que `delete_account` usa y SÍ funciona— internamente borra las sesiones del usuario en `auth.sessions`; al borrar las filas, los refresh tokens dejan de poder canjearse → revocación PERSISTENTE. supabase-js@2 NO expone `signOut(userId)` (`signOut(jwt,scope)` solo acepta el ACCESS TOKEN, que el owner no posee). Solución: una RPC `SECURITY DEFINER` que haga el `DELETE FROM auth.sessions WHERE user_id = X` por user id. El access-token vigente del target vive hasta su `exp` (~1h), cubierto por RLS (`user_roles.active=false` ya niega datos en cada request) — lo que R9/R10 aceptan para MEDIUM.

### VERIFICACIÓN EMPÍRICA DEL MECANISMO (obligatoria, NO asumida — lección del ban)
Script throwaway en `app/_throwaway_verify_revoke.cjs` (creado, corrido, **borrado** después). Contra el remoto: creó un user `@example.com` (admin), lo logueó, capturó el refresh token, confirmó el control PRE-DELETE (refresh OK), borró `auth.sessions` del user vía Management API `/database/query` (`DELETE FROM auth.sessions WHERE user_id=X` — la migración 0072 aún sin aplicar, así que se probó el DELETE crudo, que es lo que el RPC ejecutará adentro), esperó 2s e intentó `refreshSession` con el token original. Resultado:

```
[2b] control PRE-DELETE refresh: OK (sesión válida)
[3a] auth.sessions del user ANTES del delete: [{"n":2}]
[3b] auth.sessions del user DESPUÉS del delete: [{"n":0}]
[4] refresh POST-DELETE (esperado FALLO): ERROR 400 Invalid Refresh Token: Refresh Token Not Found
==== VEREDICTO ==== PASS: DELETE FROM auth.sessions REVOCA el refresh token de forma PERSISTENTE.
[cleanup] deleteUser: OK
```

**El refresh FALLÓ persistente** (400 "Refresh Token Not Found") tras 2s — confirmado que el DELETE revoca de verdad, a diferencia del ban. User de prueba borrado. Script throwaway borrado (verificado: ya no existe en `app/`).

### Cambios aplicados (NINGUNO al remoto — apply/deploy gateado por el leader)

1. **`supabase/migrations/0072_revoke_user_sessions_rpc.sql`** (NUEVO, en disco; 0072 libre — máx en disco era 0071): RPC `public.revoke_user_sessions(target_uid uuid)` `SECURITY DEFINER` `set search_path = public` → `delete from auth.sessions where user_id = target_uid;` (esquema explícito `auth.sessions`, fuera del search_path). **Blindaje de grants** (patrón 0042/0055/0058, lección SEC-HIGH-01): `revoke all ... from public, authenticated, anon` + `grant execute ... to service_role` + smoke-check fail-closed que ABORTA la migración si quedara EXECUTE-able por cliente (sería un logout-de-cualquiera invocable vía PostgREST con `target_uid` arbitrario → DoS de sesión). `notify pgrst`.
2. **`remove_member/index.ts`**: saqué la constante `BAN_DURATION_REVOKE` y reemplacé el `updateUserById(...,{ban_duration})` por `adminClient.rpc('revoke_user_sessions', { target_uid: targetUserId })`. Mantenido R9.4 (fail-soft: try/catch + console.error, NO revierte el rol) y R9.5 (no expone el error). Comentario actualizado (cita la verificación empírica + 0072).
3. **`change_member_role/index.ts`**: ídem (constante eliminada + RPC). Fail-soft + no-expose intactos.
4. **`supabase/tests/edge/run.cjs`** (R10.1/R10.2): reemplazados los 2 tests timing-based por **deterministas**: (a) CONTROL explícito PRE-invoke (el refresh DEBE producir sesión antes → descarta falso positivo), (b) invoca la EF, (c) el refresh POST-invoke DEBE fallar (`refreshErr && !session`) — sin `sleep`, sin ventana temporal (el DELETE es persistente). Siguen gated por `SPEC13_APPLIED` (corren post-redeploy + apply de 0072).

**NO toqué**: `delete_account` (su ban de 100 años + signOut(global) sigue igual — es el caso auto-baja, donde el caller ES el target y tiene el access token; aprobado), ni los otros 4 fixes, ni archivos de otras terminales.

### Re-verificación
`node scripts/check.mjs` → **verde, exit 0** ("Entorno listo. Podés trabajar."). El FAIL "2 features in_progress" **YA NO ESTÁ** (feature 1 pasó a `deferred`; `feature_list.json`: único `in_progress` = feature 13). Edge suite sin `SPEC13_APPLIED`: 36 pass / 0 fail / **1 skip** (el bloque spec 13, gated, esperado hasta el redeploy). Typecheck OK, anti-hardcode 0.

### Autorrevisión adversarial del fix
1. **¿El RPC queda invocable por cliente?** Smoke-check fail-closed en la propia migración (aborta si authenticated/anon/public tienen EXECUTE). Es un riesgo HIGH si se filtra (logout-de-cualquiera). **Cerrado por el patrón 0058.**
2. **¿`auth.sessions` accesible desde la función?** `SECURITY DEFINER` corre con el dueño de la función (postgres/supabase_admin → acceso a `auth`); esquema explícito porque `auth` no está en `search_path = public`. La verificación empírica corrió el DELETE crudo con el rol de Management API (equivalente o mayor privilegio) → funcionó. **OK** (el leader confirma al aplicar).
3. **¿El test pasa por la razón correcta?** El control PRE-invoke garantiza que el refresh FUNCIONABA antes (si no, el test falla en el control, no en el assert final → no hay falso positivo por token ya inválido). El assert final exige `refreshErr && !session` (no `||`) → falla real, no "sin sesión" ambiguo. **OK.**
4. **¿Fail-soft preservado?** Sí: try/catch alrededor del `.rpc(...)`, console.error, sin revertir el write de `user_roles`. La barrera primaria sigue siendo `active=false` + RLS. **OK** (R9.4).
5. **¿No-expose?** El error del RPC nunca sale en la respuesta (va a console.error). **OK** (R9.5).
6. **¿Otra cosa que rompa el caso de uso?** Un miembro removido conserva sesiones en OTROS dispositivos / refresh tokens — el DELETE borra TODAS sus `auth.sessions`, no solo la del campo. Es correcto para R9 (invalidar la sesión del target tras perder/cambiar el rol; re-loguea con el estado nuevo). El target puede re-loguear (no es ban permanente). **OK — alineado con R9.**

### Trazabilidad actualizada (H1-1)
| R<n> | Test | Archivo | Corre |
|------|------|---------|-------|
| R9.1 (remove invalida sesión) | `R10.1` (control PRE + refresh post FALLA, determinista) | `edge/run.cjs` | post-deploy+apply |
| R9.2 (change_role invalida sesión) | `R10.2` (ídem determinista) | `edge/run.cjs` | post-deploy+apply |
| R9.3 (por user id) | RPC `revoke_user_sessions(target_uid)` + verif. empírica (DELETE persistente) | `0072` + impl §fix-loop | estático + verificado |
| R9.4 (fail-soft) | try/catch + console.error, no revierte | `remove_member`/`change_member_role` | estático |
| R9.5 (no expone) | RPC en try/catch silencioso | ídem | estático |
| R10.1/R10.2/R10.3 (test) | refresh revocado **determinista** (DELETE persistente, no timing) | `edge/run.cjs` | post-deploy+apply |

### Pendiente del apply del leader (ACTUALIZADO)
- Aplicar **0070, 0071, 0072** al remoto (Management API `/database/query`, BEGIN/COMMIT — divergencia de numeración con la otra terminal). 0072 trae su propio smoke-check fail-closed.
- Redeploy de las 8 EFs (incluye remove_member/change_member_role con la nueva llamada al RPC).
- Correr animal + edge con `SPEC13_APPLIED=1` → los bloques gated verdes (R10 determinista incluido).
- **SPEC-MED-2 RESUELTO**: el ban finito (micro-ventana de lock-out) **YA NO APLICA** — el DELETE de sesiones no banea, el target re-loguea sin ventana. No queda decisión de producto pendiente por este punto.

---

## Fix-loop apply 0070 — colisión de schema con feature 14 (0068 user_private_pii, YA aplicada al remoto)

**Insumo**: el apply de `0070_check_text_length_caps.sql` al remoto abortó con `ERROR: column "phone" does not exist` en el pre-check (`char_length(phone)` sobre `public.users`). **Causa**: la feature 14 (migración **0068 `user_private_pii`**, YA APLICADA al remoto) movió `email` y `phone` de `public.users` a la tabla nueva `public.user_private`. 0070 se había escrito contra el schema viejo. Fix-loop acotado a UNA migración (0070); **NO se tocaron 0071/0072 (ya aplicadas), ni EFs, ni otras features**.

### Schema real post-feature-14 (verificado contra `0068_user_private_pii.sql`)
- `public.users` = `id, name, created_at, updated_at, deleted_at` (SIN `email`/`phone`; `name` sigue).
- `public.user_private` = `user_id (PK FK→users), email (text NOT NULL), phone (text), created_at, updated_at`. RLS self-only (`user_private_select_self` / `user_private_update_self`); grant `select, update` a `authenticated`; sin insert/delete a cliente.

### Cambios en `0070_check_text_length_caps.sql` (NO aplicado al remoto — re-apply gateado por el leader)
1. **Pre-check (DO-block, R1.46)**: saqué las dos entradas `users.phone`/`users.email` y agregué `user_private.email` (>320) + `user_private.phone` (>32). Mantuve `users.name` (>120). Mismo patrón de conteo de over-cap que aborta visible (23514) antes de tocar el schema.
2. **Constraints**: el bloque `-- R1.1–R1.3: users` ahora es `-- R1.1: users` con SOLO `users_name_len_chk` (techo 120). Agregué un bloque nuevo `-- R1.2–R1.3: user_private` con `user_private_email_len_chk` (`char_length(email) <= 320`, RFC 5321) + `user_private_phone_len_chk` (`char_length(phone) <= 32`), ambos con el patrón `add constraint ... not valid` + `validate constraint` idéntico al resto.
3. **Cabecera/comentarios**: agregué un bloque ⚠️ RECONCILIACIÓN POST-FEATURE-14 que documenta el movimiento de columnas y deja explícito que **el conteo total NO cambia: -2 en users, +2 en user_private = 45 columnas / 15 tablas igual**. (Sigue siendo 15 tablas: `users` no desaparece — conserva `name` —, y `user_private` ya cuenta como tabla escribible nueva con sus 2 columnas de texto.)
4. **Test (`supabase/tests/animal/run.cjs`)**: el bloque INPUT-1 (DB layer) **NO referencia `users.email`/`users.phone`** — muestrea `animal_profiles`, `animals`, `establishments`, `sanitary_events`, `weight_events`, `animal_events` (por clase y tipo, R2.1/R2.2). Los fixtures usan `auth.admin.createUser` (email de `auth.users`, no de `public.users`). **No requirió cambio** (brief punto 5: si muestrea otra tabla, se deja).
5. **Trazabilidad R1 (requirements.md)**: agregué una nota de reconciliación bajo R1.3/R1.2 (no reescribí los EARS): R1.2 (phone 32) y R1.3 (email 320) ahora se materializan sobre `public.user_private.{phone,email}`, no sobre `public.users`. Misma clase de techo, misma justificación, conteo 45/15 sin cambios.

### Autorrevisión del fix
1. **¿Quedó alguna referencia a `users.email`/`users.phone` activa?** Grep en 0070 → solo en el comentario explicativo (línea 13, intencional). Pre-check y constraints apuntan a `user_private`. **Cerrado.**
2. **¿`user_private.phone` admite NULL sin romper el CHECK?** `phone` es nullable; `char_length(NULL) <= 32` = NULL → el CHECK pasa (no rechaza NULL), igual que el resto (R1.47). **OK.**
3. **¿El pre-check puede leer `user_private` (RLS self-only)?** El apply corre como rol privilegiado (Management API `/database/query`, owner/postgres) → RLS no aplica a superusuario/owner; el DO-block cuenta todas las filas. Igual que el backfill de 0068 que insertó toda la tabla. **OK.**
4. **¿El test escribe `user_private` con RLS self-only?** El bloque INPUT-1 no toca `user_private` (muestrea otras tablas) → no hay problema de RLS self-only para el fixture. **OK.**
5. **¿Conteo realmente 45?** Antes: users.name + users.phone + users.email = 3 en users. Ahora: users.name (1 en users) + user_private.email + user_private.phone (2 en user_private) = 3 columnas igual, repartidas en 2 tablas. Total de columnas sin cambio (45), total de tablas sin cambio (15: users sigue, user_private ya era tabla escribible objetivo). **OK.**

### Re-verificación
`node scripts/check.mjs` → **verde, exit 0** ("Entorno listo. Podés trabajar."). El test de spec 14 `T17 R3.1/R3.2: public.users ya no tiene columnas email/phone` confirma empíricamente el schema post-0068. Los bloques DB de spec 13 siguen `{ skip }` gateados por `SPEC13_APPLIED` (corren post re-apply de 0070). NO se aplicó nada al remoto.

### Pendiente del leader (re-apply de 0070 corregida)
- Re-aplicar `0070_check_text_length_caps.sql` al remoto (Management API, BEGIN/COMMIT). El pre-check ahora cuenta `user_private.{email,phone}` (no `users`) → no vuelve a abortar por columna inexistente. 0071/0072 YA aplicadas: NO re-aplicar.
- Tras el apply, correr animal con `SPEC13_APPLIED=1` (el bloque INPUT-1 valida 23514 + borde; no incluye user_private en el muestreo, así que los nuevos CHECK de user_private quedan cubiertos solo por el apply del pre-check/validate, no por un test PostgREST dedicado — aceptable: misma clase de CHECK ya ejercitada por establishments.name/animal_profiles.coat_color).

---

## Fix-loop apply 0070 — 3er ajuste: basura de e2e bloquea el `VALIDATE` de 2 columnas de tag

**Insumo**: el re-apply de `0070` al remoto volvió a abortar — pero ahora NO por columna inexistente (eso lo cerró el ajuste anterior), sino porque el pre-check `RAISE EXCEPTION` cuenta filas legadas de e2e fuera de rango. Verificado contra data real: SOLO 2 columnas violan el techo, ambas con tags sintéticos de test de 36–42 chars:
- `animals.tag_electronic` — **179 filas** (ej. `animal_test_1780000540101_s33chk_DUPCALF`, 36 díg).
- `reproductive_events.calf_tag_electronic` — **18 filas** (mismo origen e2e).

Tags REALES son 15 díg (FDX-B), bien bajo el tope de 32. Las otras 43 columnas están LIMPIAS. **Fix-loop acotado a UNA migración (0070); NO se tocaron 0071/0072 (ya aplicadas), ni EFs, ni otras features.**

### Clave conceptual que resuelve el bloqueo
Un CHECK `NOT VALID` **igual enforça TODOS los INSERT/UPDATE futuros** — Postgres solo saltea la validación de las filas EXISTENTES al crearlo. O sea: el objetivo de seguridad de INPUT-1 (capear input de usuario de acá en más, contra storage-exhaustion) se cumple con `NOT VALID` SOLO. El `VALIDATE CONSTRAINT` es únicamente un re-chequeo retroactivo de filas viejas; ahí la basura de e2e lo bloquea sin aportar ninguna seguridad.

### Cambios en `0070_check_text_length_caps.sql` (NO aplicado al remoto — re-apply gateado por el leader)
1. **`animals.tag_electronic` + `reproductive_events.calf_tag_electronic`**: se dejó SOLO `add constraint ... not valid` y se **quitó** el `validate constraint` de ambas (grandfather de las 179+18 filas legadas de e2e; capeadas a futuro por el NOT VALID). Comentario inline en cada bloque explicando el porqué (basura e2e + el NOT VALID basta para la seguridad).
2. **Otras 43 columnas (limpias)**: se mantuvo `not valid` + `validate constraint` → quedan validadas. (Conteo verificado por grep anclado: **45** `add constraint ... not valid` / **43** `validate constraint` → 45 − 2 = 43. Correcto.)
3. **Pre-check DO-block**: `RAISE EXCEPTION` (abortaba) → **`RAISE NOTICE`** que LISTA los violadores y NO aborta. Elegí NOTICE en vez de whitelist de columnas esperadas porque es más limpio y robusto: la seguridad la da el NOT VALID, no el pre-check; no hay whitelist frágil que mantener; y el NOTICE deja traza visible de QUÉ filas quedaron grandfathereadas, para auditoría. El DO-block sigue contando TODAS las columnas (no se recortó) → si en el futuro apareciera una violación inesperada en otra columna, queda VISIBLE en el NOTICE del apply (no silenciada), aunque ya no aborte.
4. **Cabecera**: bloque nuevo que documenta la clave conceptual (NOT VALID enforça el futuro), las 2 columnas grandfathereadas con su conteo, y la decisión NOTICE-vs-EXCEPTION.

### Por qué el test INPUT-1 sigue válido (no se tocó)
El test `R2` (`supabase/tests/animal/run.cjs:1917-1926`) escribe un valor **NUEVO** over-cap (33 nueves) sobre el `tag_electronic` de un animal creado en la corrida (NULL→valor) y espera **23514**; después el borde (32 nueves) y espera persistir. Esto es exactamente la garantía del `NOT VALID` (enforça todo INSERT/UPDATE futuro) → el test no depende de la validación retroactiva de filas legadas. **Sin cambios.**

### Autorrevisión del fix
1. **¿Quedó algún `validate constraint` para las 2 columnas de tag?** Grep anclado → 0. **Cerrado.**
2. **¿Quedó algún `raise exception` activo?** Grep → solo la mención en el comentario explicativo (intencional). El único statement es `raise notice`. **Cerrado.**
3. **¿Las 43 columnas limpias siguen validadas?** Sí (43 `validate constraint`). Solo toqué los 2 bloques de tag. **OK.**
4. **¿El NOTICE silencia una violación inesperada futura en otra columna?** No la aborta, pero la LISTA en el NOTICE (el DO-block cuenta todas las columnas) → queda visible en el log del apply. La seguridad de esas columnas la da igual su CHECK `NOT VALID` (rechaza el input nuevo). El trade-off (no fail-closed en el apply) es consciente y documentado: el pre-check ya no es la barrera de seguridad, el CHECK lo es. **OK — decisión documentada.**
5. **¿El INPUT-1 test ejercita el reject real?** Sí, valor nuevo over-cap → 23514, sobre animal fresco (no fila legada). **OK.**
6. **¿check.mjs verde?** Sí, exit 0; anti-hardcode 0; los 2 bloques DB de spec 13 siguen `{ skip }` gateados por `SPEC13_APPLIED` (corren post re-apply de 0070). **OK.**

### Pendiente del leader (re-apply de 0070, 3er ajuste)
- Re-aplicar `0070_check_text_length_caps.sql` al remoto (Management API, BEGIN/COMMIT). El pre-check ahora emite `RAISE NOTICE` (lista los 179+18 violadores de tag) y NO aborta → el apply pasa entero. Las 2 columnas de tag quedan con CHECK `NOT VALID` (sin validar) → enforça el input futuro, grandfatherea la basura de e2e. Las otras 43 quedan validadas. 0071/0072 YA aplicadas: NO re-aplicar.
- Tras el apply, correr animal con `SPEC13_APPLIED=1` (el bloque INPUT-1 valida 23514 + borde sobre `tag_electronic` con valor nuevo → el NOT VALID lo rechaza igual).

---

## Fix-loop apply 0070 — 4to ajuste: techo de tag 32 → 64 (decisión de Raf, 2026-06-05)

**Insumo**: con la versión previa de `0070` (techo 32) YA APLICADA al remoto, **7 tests** de la suite animal (`supabase/tests/animal/run.cjs`, fixtures de spec 02 — NO gated por `SPEC13_APPLIED`) fallaban con `23514 animals_tag_electronic_len_chk` / `..._calf_tag_electronic_len_chk`. **Causa**: la convención de fixtures de test `animal_test_<timestamp_13>_<rand_6>_<SUFFIX>` (`RUN_TAG` en `run.cjs:52`) produce tags de 36–45 chars (ej. `animal_test_1780705143863_qslnzx_CALFTAG` = 40 díg) → el techo de 32 los rechazaba. Fix-loop acotado a UNA migración (0070); **NO se tocaron 0071/0072 (ya aplicadas), ni EFs, ni otras features. NO se aplicó nada al remoto.**

### Cambio (solo en disco — re-apply gateado por el leader)
Subí el techo de DOS columnas de **32 → 64** en `0070_check_text_length_caps.sql`:
- `animals.tag_electronic` → `char_length(...) <= 64` (constraint l.185 + conteo del pre-check l.95).
- `reproductive_events.calf_tag_electronic` → `char_length(...) <= 64` (constraint l.224 + conteo del pre-check l.109).

Ambas siguen **`NOT VALID` SIN `VALIDATE`** (grandfather de la data legada de e2e — sin cambio en ese patrón). RAZÓN documentada en el SQL (cabecera + inline): los fixtures de test producen tags de hasta ~45 chars → 32 rompía 7 tests de spec 02; 64 los acomoda y sigue capeando abuso real (un FDX-B real son 15 díg; 64 no permite payloads multi-KB de storage-exhaustion). Decisión de Raf, 2026-06-05.

**NINGÚN otro techo cambió** (verificado por grep `<= 32` / `<= 320`): `user_private.phone` sigue 32, `user_private.email` 320, `invitations.email` 320, etc. Las otras 43 columnas intactas.

**Test gated INPUT-1 ajustado al nuevo techo** (`supabase/tests/animal/run.cjs:1917-1927`, bloque `{ skip: spec13Skip }`): el cap de `animals.tag_electronic` pasó de probar `33`/`32` (techo+1/borde de 32) a `65`/`64` (techo+1/borde de 64) → sigue ejercitando el reject real (23514 sobre techo+1) y el borde que persiste, ahora contra el techo correcto. Sin este ajuste el test daría falso negativo (`'9'.repeat(33)` ya no supera 64). Es el único cap de tag en el bloque gated (`calf_tag_electronic` no se capea ahí; las otras menciones son fixtures funcionales de parto que caben en 64).

### Verificación
- `git stash` (revertir a techo 32 en disco, = estado del remoto) → suite animal: **35 pass / 7 fail / 0 skip**. Los 7 fails son **preexistentes** (la constraint con techo 32 ya está aplicada en el remoto y rechaza los fixtures de spec 02). Mi edición NO introduce ni remueve fails contra el remoto.
- Con el cambio (techo 64 en disco) → `node scripts/check.mjs` sigue **rojo**: los mismos 7 fails de la suite animal **persisten porque el remoto todavía tiene el techo 32 aplicado**. NO se puede dejar `check.mjs` verde sin re-aplicar la 0070 corregida al remoto, y el brief lo prohíbe explícitamente. Es el mismo patrón documentado arriba (CHECK que requiere la migración aplicada → verde recién post-apply). Una vez que el leader re-aplique la 0070 con techo 64, los 7 tests pasan (sus fixtures de 36–45 chars caben en 64).
- `RUN_TAG` = `animal_test_` (12) + `<ms 13>` + `_` + `<rand 6>` = 32 chars base; con sufijos (`_CB5`, `_CALFTAG`, etc.) llega a 36–45. Confirmado contra el `details` del 23514 (`animal_test_1780705143863_qslnzx_CALFTAG`, 40 díg).

### Autorrevisión del fix
1. **¿Toqué algún techo que NO debía?** Grep `<= 32`/`<= 320` → solo `user_private.phone` (32) y los dos `email` (320) intactos; únicas líneas con `tag_electronic`/`calf_tag_electronic` en 64. **Cerrado.**
2. **¿Las 2 columnas siguen `NOT VALID` sin `VALIDATE`?** Sí, no toqué ese patrón (sigue grandfathereando la data de e2e). **OK.**
3. **¿64 sigue capeando abuso?** Sí: un FDX-B real son 15 díg; 64 chars no habilita storage-exhaustion (orden de magnitud por debajo de un payload multi-KB). El objetivo de INPUT-1 se mantiene. **OK.**
4. **¿check.mjs queda verde?** NO sin re-apply al remoto (prohibido por el brief). Los 7 fails son del techo 32 vivo en el remoto, no de mi edición. Verde garantizado tras el re-apply del leader (los fixtures caben en 64). **Escalado al leader como pendiente de re-apply.**

### Pendiente del leader (re-apply de 0070, 4to ajuste — techo 64)
- Re-aplicar `0070_check_text_length_caps.sql` al remoto con el techo 64 en las 2 columnas de tag (Management API, BEGIN/COMMIT; las constraints existentes con techo 32 hay que **DROPpearlas antes** o el `add constraint` choca por nombre duplicado — `alter table public.animals drop constraint if exists animals_tag_electronic_len_chk;` + ídem `reproductive_events_calf_tag_electronic_len_chk`, luego el `add constraint ... not valid` con 64). 0071/0072 YA aplicadas: NO re-aplicar.
- Tras el re-apply, la suite animal queda verde sin `SPEC13_APPLIED` (los 7 fixtures de 36–45 chars caben en 64) y el bloque INPUT-1 gated valida 23514 sobre techo+1 (=65 chars) cuando se corra con `SPEC13_APPLIED=1`.

---

## Fix-loop cierre de deploy — DES-GATEO de los tests de spec 13 (2026-06-05)

**Insumo (del leader)**: las migraciones 0070/0071/0072 quedaron APLICADAS al remoto y las 8 EFs REDEPLOYADAS → el gate `SPEC13_APPLIED` (que saltaba los bloques de spec 13 hasta el apply) ya no tiene sentido. Hay que des-gatear para que esos tests corran SIEMPRE, como el resto de la suite (que ya corre contra el remoto cuando hay `SUPABASE_SERVICE_ROLE_KEY`). Acotado a 2 archivos de test; **NO se tocó migraciones / EFs / specs / feature_list ni otros tests.**

### Cambios (solo en disco, 2 archivos de test)
1. **`supabase/tests/animal/run.cjs`**: removí la constante `SPEC13_APPLIED` + `spec13Skip` (l.55-62) y la opción `{ skip: spec13Skip }` del `test('spec 13 — INPUT-1 / A1-1 / F1-1 (DB layer)')` → el bloque INPUT-1 (R2) / A1-1 (R6.1) / F1-1 (R8.1) corre siempre. Comentarios actualizados (el gate se removió; ya no hay "FALLA hasta el apply").
2. **`supabase/tests/edge/run.cjs`**: ídem — removí `SPEC13_APPLIED` + `spec13Skip` (l.64-67) y el `{ skip: spec13Skip }` del `test('spec 13 — B1-1 copy genérico (R4) + H1-1 invalidar sesión (R10)')` → B1-1 (R4.1) / H1-1 (R10.1, R10.2) corren siempre.

Verificado por grep: NO quedan lecturas de `process.env.SPEC13_APPLIED` ni referencias vivas a `spec13Skip` (solo menciones en comentarios explicando la remoción). NO se tocó ningún otro test de esas suites.

### Verificación (`node scripts/check.mjs`, SIN setear SPEC13_APPLIED)
**VERDE, exit 0** ("Entorno listo. Podés trabajar."). Los bloques de spec 13 ahora **CORREN y PASAN** (ya no skipped):
- Edge: `spec 13 — B1-1 copy genérico (R4) + H1-1 invalidar sesión (R10)` → `R4.1` (5xx no filtra .message), `R10.1` (remove invalida sesión, refresh revocado), `R10.2` (change_role invalida sesión) → 3/3 pass.
- Animal: `spec 13 — INPUT-1 / A1-1 / F1-1 (DB layer)` → `R2` (CHECK 23514 techo+1 + borde), `R6.1` (A1-1 cross-tenant UPDATE rechazado), `R8.1` (F1-1 .ilike parametrizado) → 3/3 pass.

`skipped 0` en TODAS las suites (confirmado por grep del output). Sin `fetch failed`/`ECONNRESET` en esta corrida → no hizo falta reintentar. El des-gateo quedó bien: los tests de spec 13 corren contra el remoto vivo (con 0070/0071/0072 aplicadas + EFs redeployadas) y pasan.
