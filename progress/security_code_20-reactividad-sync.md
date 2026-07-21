# Security gate (code) — feature 20 `20-reactividad-sync`

**Modo**: `code` (Gate 2, ADR-019). **Veredicto**: **PASS** — sin findings HIGH-confidence.

Baseline: `3e7d35e` (árbol sin commitear; los commits sobre el baseline son feature 04/BLE, fenced-out y NO auditados). Skill: `sentry-skills:security-review` corrida sobre el diff de la feature + trazado manual RAFAQ-específico.

---

## Findings HIGH de Sentry
Ninguno. La skill no identificó vulnerabilidades HIGH-confidence en el diff en alcance.

## Findings RAFAQ-SPECIFIC
Ninguno.

---

## FOCO auditado (evidencia)

**1. Dirección fail-safe de la detección de pérdida-de-acceso — CORRECTA.**
- Lectura fallida del SQLite local → `hasActiveLocalRole` devuelve `'unknown'` (`establishments.ts:126-129`) → `assessDisappearance` devuelve `'inconclusive'` (`establishment.ts:250`, única puerta a `'confirmed'` es `'absent_or_inactive'`).
- `confirmDisappearance` con veredicto ≠ `confirmed` retorna sin tocar estado/recientes/`availableRef` (`EstablishmentContext.tsx:246-253`) → un fallo de lectura NO purga datos locales (design §4.3 cumplido) y NO emite `active_lost` espurio.
- En `RodeoContext`, un set de rodeos vacío solo concluye `no_rodeos` con evidencia `'active'`; `'absent_or_inactive'` (revocación) y `'unknown'` (ilegible) conservan el estado (`RodeoContext.tsx:229-252`) → un fallo de lectura NO purga rodeos a `no_rodeos`.
- A la inversa (revocado que se ve activo por lectura fallida): posible SOLO a nivel UX; el enforcement es server-side. Verificado `has_role_in` (`0005_rls_helpers.sql:16-24`) chequea `ur.active = true` + `e.deleted_at is null` EN VIVO en la DB en cada RLS → deniega apenas se revoca, independiente de la latencia del cliente y del vencimiento del JWT. La detección cliente es UX, no authz.

**2. Invariante RG-1 en `self_user_roles` (`rafaq.yaml`) — SIN fuga.**
- `SELECT * FROM user_roles WHERE user_id = auth.user_id()`: self-scoped al usuario autenticado. Devuelve solo filas de membership del propio caller (incluida la revocada con `active=0`, que es el punto: sobrevive al borrado del bucket para que el cliente DETECTE la pérdida). No expone filas de otro user ni de otro tenant. `SELECT *` expone solo metadata del rol propio.
- El diff SOLO agrega un comentario-candado; la query (sin filtro `active`/`org_scope`) es pre-existente y correcta. Ausencia de `active` es load-bearing, no un hueco.

**3. Latencia de propagación de revocación bajo mala conectividad — NO afecta la frontera de seguridad.**
- La latencia documentada (header `reactividad-sync.spec.ts:43-67`) es de la señal de reactividad del cliente (`lastSyncedAt` avanza no-determinista). La frontera real (RLS `has_role_in` server-side + `revoke_user_sessions` que borra `auth.sessions`, migración 0072) es independiente de esa latencia. Ninguna decisión de autorización depende del estado del cliente.

**4. `revoke_user_sessions` / migraciones / policies / Edge Functions — NO tocados.**
- `git status --porcelain -- supabase/` vacío. `database.ts` sin cambios. El YAML solo suma comentario. Confirmado.

**5. Ventana de `active_lost` espurio (eliminación del contador de secuencia en `confirmDisappearance`) — SIN impacto de seguridad.**
- Evaluaciones concurrentes del mismo campo son idempotentes, guardadas por `userIdRef`/`currentFieldRef` (`EstablishmentContext.tsx:232-234`). Peor caso: pantalla de aviso espuria auto-curable. No purga datos, no desloguea (R7.4), no filtra nada, no habilita DoS (todo client-local).

**6. Inputs de usuario / rate limits — ninguno nuevo.**
- Feature de re-lectura reactiva sobre SQLite local disparada por checkpoints de PowerSync. No agrega inputs de usuario, endpoints, ni Edge Functions. `buildActiveRoleQuery` es parametrizada. Sin superficie de rate-limit nueva.

---

## Tabla de inputs
| campo | límite | validación (server/solo-cliente/ausente) | OK? |
|---|---|---|---|
| (ninguno nuevo) | n.a. | n.a. — feature de re-lectura reactiva, sin input de usuario | OK |

Nota: `buildActiveRoleQuery(userId, establishmentId)` no recibe texto libre de usuario; `userId` = sub del JWT, `establishmentId` = id de membership sincronizada. Ambos van como args bound (`?`), no concatenados.

## Tabla de rate limits
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| re-lectura reactiva (checkpoint PowerSync) | n.a. | n.a. | n.a. | client-local, lee SQLite; sin llamada server nueva por checkpoint |
| `revokeMemberRole` (fixture e2e) | n.a. | n.a. | n.a. | test-only, service_role desde env, fuera del bundle |

---

## False positives descartados
- **service_role en `admin.ts`**: es helper e2e (`getE2EEnv()`, no hardcoded), test-only, explícitamente "NUNCA en el browser", fuera del bundle de Expo. No es exposición de secreto. La skill excluye test files por defecto.
- **`SELECT *` en `self_user_roles`**: no es over-fetch cross-tenant — self-scoped por `auth.user_id()`, solo filas del propio usuario.
- **`console.warn` en `warnUnreadableEvidence`**: no filtra PII/opData — solo `establishmentId` (id del propio campo) + clase de error genérica.

---

## Archivos analizados
`EstablishmentContext.tsx`, `RodeoContext.tsx`, `lotes.tsx`, `campo-perdido.tsx`, `utils/establishment.ts`, `services/establishments.ts`, `powersync/local-reads.ts`, `e2e/reactividad-sync.spec.ts`, `e2e/helpers/admin.ts`, `sync-streams/rafaq.yaml`. (`powersync/database.ts` sin cambios.)

## Cobertura indirecta (Deno / RLS / PowerSync / RN)
- **RLS / PowerSync sync rules**: NO cubierto por la skill Sentry — revisado a mano. `self_user_roles` self-scoped, sin fuga; `has_role_in` server-side chequea `active` en vivo (enforcement real).
- **React Native / expo-router**: `useSegments`/`useStatus` como señales de UX; sin superficie de inyección (RN `<Text>`, sin HTML).
- **Edge Functions / Deno / migraciones**: no tocadas por el diff.

## Checks confiables corridos
- Unitarios de la feature (`node:test`): 238 pass / 0 fail (incluye casos fail-safe R20.30 "evidencia unknown → NO emite"; `assessDisappearance`, `shouldEmitDeferredRevocation`, `buildActiveRoleQuery`).

**PASS** — sin findings HIGH-confidence.
