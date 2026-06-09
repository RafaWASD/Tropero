# Gate 1 — security_spec — 15-powersync (V3 JOIN-FREE)

> **RE-GATE 1 (2026-06-09) — VEREDICTO: PASS.** Cierre verificado del único finding bloqueante
> (HIGH-1) del pase anterior, mediante el guard a nivel DB añadido a la migración `0076` (partes (4)/(5)).
> El detalle del re-Gate está en la sección **"RE-GATE 1 — verificación del cierre del HIGH-1"** (abajo).
> El FAIL original y su análisis completo quedan ARCHIVADOS más abajo (trazabilidad — no borrar).

---

## RE-GATE 1 — verificación del cierre del HIGH-1 (2026-06-09)

**Artefacto del fix:** `supabase/migrations/0076_deactivate_roles_on_establishment_soft_delete.sql`,
partes (4) `prevent_active_role_on_soft_deleted_establishment()` + (5) trigger
`user_roles_block_active_on_soft_deleted_establishment` (`BEFORE INSERT OR UPDATE OF active ON public.user_roles`).

**Veredicto: PASS.** El HIGH-1 queda cerrado a NIVEL DB por TODOS los write-paths, sin regresión. El invariante
"`user_roles.active = true` ⇒ campo vivo (`deleted_at IS NULL`)" pasa a ser real para el flujo secuencial
explotable, lo que restaura la garantía de no-leak que el `INNER JOIN establishments` de V2 daba a las 8 streams
per-est dependientes. Queda una ventana de carrera concurrente fortuita NO dirigible (LOW, anexo) que NO reabre el HIGH-1.

### Las 5 preguntas del re-Gate

**1 — ¿El guard cierra el vector de `accept_invitation`? → SÍ.**
El insert de `accept_invitation/index.ts:94-101` pone `active: true`. El trigger es `BEFORE INSERT OR UPDATE OF active`
(`0076:174-177`): en un **INSERT dispara SIEMPRE** (Postgres no filtra el INSERT por `OF active`; el filtro por columna
solo aplica a la rama UPDATE). `new.active = true` no sale por el early return (`0076:133-135`, que solo perdona
`active IS DISTINCT FROM true`), y el `EXISTS (… establishments … deleted_at IS NOT NULL)` (`0076:141-145`) hace
`raise exception … errcode '23514'` (`:146-149`) **ANTES de persistir** (BEFORE). El insert de `accept_invitation`
sobre un campo con `deleted_at IS NOT NULL` queda rechazado en la DB → la EF lo recibe como error y devuelve
`serverError('db_error', insErr)` (`accept_invitation/index.ts:102-104`). Vector cerrado.

**2 — ¿Cierra TODOS los paths, no solo accept_invitation? → SÍ. No queda hueco.**
Enumeré exhaustivamente los write-paths que pueden dejar `user_roles.active = true` (grep `active.*true` sobre
`supabase/functions` + triggers/policies sobre `user_roles`). El guard es `BEFORE` y a nivel DB → intercepta a TODOS:

| Path | Mecanismo | ¿Lo agarra el guard? |
|------|-----------|----------------------|
| (a) INSERT directo PostgREST | policy `user_roles_insert_self_owner` (0008): `user_id=auth.uid() AND role='owner' AND active=true` | ✅ BEFORE INSERT dispara para `authenticated` igual. Un insert manual de `active=true` sobre un campo `deleted_at IS NOT NULL` → 23514. (En la práctica este path se usa solo para el campo recién creado por el propio user, vivo.) |
| (b) UPDATE `active=true` (`change_member_role:121` rollback) | admin-client UPDATE | ✅ BEFORE UPDATE OF active dispara. Sobre campo borrado → 23514. |
| (b') INSERT `active=true` (`change_member_role:107-113`) | admin-client INSERT | ✅ BEFORE INSERT. Además el path ya da 404 antes: exige rol activo preexistente (`change_member_role:60 .eq('active',true)`) que el trigger de deactivate (1) ya puso en `false` al borrar el campo. Doble cierre. |
| (c) service_role / Edge Functions | `accept_invitation`, `change_member_role` usan admin-client (RLS-bypass) | ✅ Los triggers BEFORE **disparan para service_role** (solo `session_replication_role=replica` los saltea, y RAFAQ no lo usa). El guard NO depende de RLS → el bypass de RLS del admin-client NO bypassea el trigger. |
| `handle_new_establishment` (0011:30-33) | trigger AFTER INSERT, inserta `active=true` sobre `new.id` | ✅ NO es vector: el campo recién creado tiene `deleted_at NULL` → el `EXISTS` no matchea → permitido. |

No hay otro code-path que escriba `active=true` (verificado: las 4 ocurrencias en `supabase/functions` son
`accept_invitation:100`, `change_member_role:101` [=false], `:113` [insert], `:121` [rollback] — todas cubiertas).

**3 — ¿El invariante queda cerrado por ambos lados? → SÍ para el flujo secuencial explotable (que es el del HIGH-1).**
Trigger (1) `deactivate_roles_on_establishment_soft_delete` desactiva los roles EXISTENTES en la transición
`deleted_at` NULL→NOT NULL, en la **misma transacción atómica** del soft-delete (AFTER UPDATE, sin commit
intermedio — verificado en el pase anterior). Guard (4) impide CREAR/activar uno nuevo. Juntos cierran el HIGH-1
secuencial (invitar → borrar campo → aceptar, en cualquier orden temporal con commits separados): si el delete
commiteó antes de que el statement del INSERT del accept tome su snapshot, el `EXISTS` lo ve borrado → 23514.

> **Caso borde de concurrencia (LOW, NO reabre el HIGH-1 — ver Anexo L-3):** bajo `READ COMMITTED` (default de
> Postgres/Supabase) existe una ventana teórica si T_delete (soft-delete) y T_accept (insert del rol) corren
> **simultáneamente** y ninguna ve el commit de la otra: el `EXISTS` del guard valida contra el snapshot de T_accept
> (campo aún vivo) → permite el insert, y el `UPDATE … SET active=false` de T_delete no toca una fila que aún no
> commiteó → podría quedar un rol `active=true` espurio. Esta carrera NO es dirigible por un atacante (requiere que
> el owner borre el campo en la misma ventana de milisegundos en que el invitado acepta, sin coordinación posible) y
> es una limitación intrínseca de cualquier guard cross-row basado en `EXISTS` sin `SERIALIZABLE`/lock explícito. Es
> defensa-en-profundidad, no el flujo determinista del HIGH-1. Severidad LOW.

**4 — ¿El guard introduce una regresión? → NO. Los 4 flujos legítimos siguen permitidos (verificado línea por línea).**

| Flujo legítimo | Por qué pasa el guard | Evidencia |
|----------------|------------------------|-----------|
| Crear campo (auto-owner) | inserta `active=true` sobre `new.id` con `deleted_at NULL` → `EXISTS` no matchea | `0011:30-33`; guard `0076:141-145` |
| Aceptar invitación a campo VIVO | `establishments.deleted_at IS NULL` → `EXISTS` no matchea | `accept_invitation:94-101`; guard `0076:141-145` |
| Deactivate (1) + backfill (3) + remover miembro (`active=false`) | early return `new.active IS DISTINCT FROM true` | `0076:133-135` |
| Reactivar tras restore (R8.3/R8.4) | el restore pone `deleted_at=null` PRIMERO → al reactivar `active=true` el campo ya está vivo → `EXISTS` no matchea | comentario `0076:138-140` + nota de límite `:33-41`; test `estG/userG/userH` declarado en `tasks.md` T6.6 |

Errcode elegido (`23514` check_violation) es coherente con el precedente del repo (`soft_delete_rodeo` 0041 usa el
mismo para un guard de estado de dominio) y NO se confunde con una negación de privilegio (42501). `security definer`
+ `set search_path = public` (mismo patrón que 0011) → sin hijack de search_path, sin escalada (el guard solo NIEGA,
nunca otorga).

**5 — Con el invariante cerrado, ¿las 17 streams V3 JOIN-free quedan correctas? → SÍ.**
Con `active=true ⇒ campo vivo` restaurado como invariante real (flujo secuencial), las 8 streams per-est que en V3
dependen solo de `establishment_id IN org_scope` (sin JOIN a establishments) recuperan la garantía de no-leak de
campo borrado que el `INNER JOIN establishments … deleted_at IS NULL` de V2 daba. La equivalencia stream↔RLS de las
17 streams (verificada exhaustivamente en el pase anterior, sección (B), no re-derivada acá) queda **restaurada sin
condicionantes**: la nota "(con dependencia HIGH-1)" de esas 8 streams se levanta. `est_establishments` además se
auto-protege (filtra su propio `establishments.deleted_at`). El fix no alteró el YAML ni las streams.

### Confirmación de no-alteración de lo ya-verificado
- El trigger de deactivate (1)+(2)+backfill (3) NO se tocó — sigue idéntico al pase anterior (`0076:46-106`). El fix
  es **aditivo** ((4)+(5) en `:108-179`).
- Las 17 streams de `sync-streams/rafaq.yaml` NO se tocaron. La equivalencia stream↔RLS sigue valiendo.

### Test del invariante declarado
`tasks.md` T6.6 declara el test del guard en `supabase/tests/rls/run.cjs` (`estG`/`userG`/`userH` dedicados,
autocontenido): INSERT/UPDATE `active=true` sobre campo borrado → FALLA con 23514; sobre campo vivo y cualquier
`active=false` → PASA. (Espera fallar hasta que el leader aplique `0076` por Management API — mismo patrón que el
test de deactivate.) **Requisito de cierre cumplido en la spec.**

### Anexo L-3 (carrera concurrente — defensa en profundidad, NO bloquea)
La ventana de la pregunta 3 (T_delete ∥ T_accept bajo READ COMMITTED) es LOW y no dirigible. Si en el futuro se
quiere blindarla al 100%, las opciones son: (i) el fix (b) del análisis original — cancelar `invitations` pendientes
en el mismo trigger AFTER del soft-delete (cierra el vector de accept en origen, atómico con el delete, y además limpia
`est_invitations`); o (ii) tomar un `FOR SHARE`/lock sobre la fila de `establishments` dentro del guard. **No es
bloqueante para el PASS**: el flujo determinista del HIGH-1 (el único explotable a voluntad) está cerrado, y la app
online tiene el backstop de `has_role_in`/`is_owner_of` (0005, filtran `deleted_at`). Lo dejo agendado para el leader
como cinturón-y-tiradores, dado que en V3 el invariante de `active` es la única barrera de "campo vivo" en el wire.

### Tabla de inputs (sin cambios respecto del pase anterior)
| campo | límite | validación | OK? |
|-------|--------|------------|-----|
| accept_invitation.token | string | server (`typeof`, `:35`) + lookup exacto | ✅ (no es el vector; el vector era el insert, ahora cerrado por el guard DB) |

El fix no agrega formularios, campos de texto libre ni prompts. No afloja `[auth.rate_limit]` ni agrega Edge Functions.

### Qué destrabó el PASS
El guard a nivel DB (partes (4)/(5) de `0076`) cierra el HIGH-1 por TODOS los write-paths (no solo `accept_invitation`,
también INSERT directo PostgREST, UPDATE de change_member_role, y service-role), sin regresión sobre los 4 flujos
legítimos, con el test declarado en `tasks.md`. El invariante "`active=true` ⇒ campo vivo" pasa a ser real para el
flujo explotable → las 17 streams V3 JOIN-free equivalen a su RLS con el `deleted_at` del campo cubierto.

---

> ⬇️⬇️⬇️  ARCHIVO HISTÓRICO — pase anterior (FAIL). NO BORRAR (trazabilidad del re-Gate).  ⬇️⬇️⬇️

---

## [ARCHIVADO] Pase anterior — VEREDICTO: FAIL

**Artefactos auditados (UN sistema de autorización):**
- (A) `supabase/migrations/0076_deactivate_roles_on_establishment_soft_delete.sql` — trigger schema-sensitive (R11.4).
- (B) `sync-streams/rafaq.yaml` — 17 streams V3 JOIN-FREE (frontera de autorización del sync; no hay RLS sobre el wire, ADR-025).

**Veredicto: FAIL**

Razón en una línea: el trigger (A) cierra correctamente la transición `deleted_at` NULL→NOT NULL, pero el modelo V3 JOIN-FREE de (B) descansa **enteramente** en el invariante "`user_roles.active = true` ⇒ campo vivo", y existe un write-path que lo viola (`accept_invitation` sobre una invitación pendiente de un campo soft-deleteado), reabriendo el viejo HIGH-1. En V2 el `INNER JOIN establishments` lo tapaba; V3 lo quitó y NO hay backstop.

> **CERRADO en el re-Gate 1 (2026-06-09)** por el guard a nivel DB (partes (4)/(5) de `0076`). Ver sección de arriba.

---

## Findings HIGH

### HIGH-1 — `accept_invitation` puede crear un `user_roles.active = true` sobre un establishment soft-deleteado → reabre el leak cross-campo-borrado que el trigger debía cerrar

**[ESTADO: CERRADO en re-Gate 1 — el guard `prevent_active_role_on_soft_deleted_establishment` (0076:123-177) rechaza el insert a nivel DB.]**

**Dónde se rompe el invariante:**
`supabase/functions/accept_invitation/index.ts:93-101`

```ts
// R5.5 — insert del user_roles nuevo.
const { error: insErr } = await adminClient
  .from('user_roles')
  .insert({
    user_id: user.id,
    establishment_id: inv.establishment_id,
    role: inv.role,
    active: true,            // ← active:true SIN verificar establishments.deleted_at IS NULL
  });
```

**Por qué es explotable (timeline, todos pasos legítimos):**
1. Owner invita a un operador X al campo E. Se crea `invitations` con `status='pending'`, `expires_at` = +7 días (`invite_user/index.ts:132-149`). E está vivo.
2. Owner soft-deletea E: `softDeleteEstablishment` hace `UPDATE establishments SET deleted_at = now()` (`app/src/services/establishments.ts:422-427`). El trigger 0076 dispara → desactiva los `user_roles` activos de E. **Pero la invitación pendiente NO se toca**: nada cancela `invitations` al soft-deletear el campo.
3. X (que tiene el link) llama `accept_invitation`:
   - `inv.status === 'pending'` → pasa (`:54`).
   - no expirada → pasa (`:63`).
   - X no tiene rol activo en E → pasa (`:75-91`).
   - **inserta `user_roles {establishment_id: E, active: true}`** (`:93-101`) — para un campo con `deleted_at IS NOT NULL`.

**Resultado:** queda un `user_roles.active = true` apuntando a un campo soft-deleteado. El invariante de la migración 0076 ("un rol activo siempre apunta a un campo vivo", comentario `rafaq.yaml:18-19`) queda FALSO. Entonces TODAS las 10 streams `est_*` (que en V3 hacen `establishment_id IN org_scope` SIN JOIN a establishments) replican al dispositivo de X los datos del campo borrado E.

**Por qué V3 lo agrava respecto de V2 (clave):**
En V2 cada per-est hacía `... INNER JOIN establishments ON ... AND establishments.deleted_at IS NULL`. Ese JOIN era un **backstop**. V3 **eliminó ese JOIN a propósito** (anti-PSYNC_S2305) y trasladó el 100% de la responsabilidad de "campo vivo" al `active=true` de org_scope. Por eso un invariante que en V2 era defensa-en-profundidad, en V3 es **la única** barrera — y este path la perfora.

**Fix mínimo (original — el leader optó por una 3ra vía, más fuerte que (a)/(b): guard a nivel DB):**
- (a) Guard en `accept_invitation` (1 query previa al insert, chequear `establishments.deleted_at`).
- (b) Cancelar invitaciones pendientes en el soft-delete del campo (trigger hermano).
- **(c) [ELEGIDA por el leader] Guard a nivel DB sobre `user_roles`** — `prevent_active_role_on_soft_deleted_establishment` (0076 parte (4)/(5)). Más fuerte que (a)/(b): cierra TODOS los write-paths a nivel DB, no solo `accept_invitation`. **Verificada y aprobada en el re-Gate 1.**

> Nota de trazabilidad: el otro write-path de roles, `change_member_role`, NO es vector — exige un rol **activo** preexistente (`change_member_role/index.ts:60` `.eq('active', true)`), que el trigger 0076 ya puso en false al borrar el campo → devuelve 404. Se auto-cierra post-trigger.

---

## Findings MEDIUM

Ninguno bloqueante adicional.

---

## (A) Trigger 0076 — análisis punto por punto (las 4 preguntas)

| # | Pregunta | Veredicto | Evidencia |
|---|----------|-----------|-----------|
| 1 | ¿Cierra la brecha NULL→NOT NULL? ¿backfill correcto? | ✅ SÍ | `:64-69` desactiva TODOS los `active=true` de `new.id` en la transición real. Backfill `:100-106` limpia los ya-activos de campos ya-borrados, idempotente. |
| 2 | ¿Atomicidad / ventana de leak? | ✅ SÍ, atómico | `AFTER UPDATE OF deleted_at` corre en la MISMA transacción del `UPDATE establishments`. No hay commit intermedio. |
| 3 | ¿Bypass / escalación? (es `security definer`) | ✅ Seguro | UPDATE scopeado a `where establishment_id = new.id`, gateado por la RLS owner-only del UPDATE de establishments. `set search_path = public`. Solo PONE roles en `false`. |
| 4 | ¿No-reactivación en restore = problema de seguridad? | ✅ No es leak | NOT NULL→NULL no reactiva (guard `:64`). Es el lado SEGURO (restrictivo de más). |

---

## (B) Streams V3 — equivalencia stream ↔ RLS, tabla por tabla (las 17 activas)

`org_scope` = `user_roles WHERE user_id=auth.user_id() AND active=true`; `owner_scope` = idem `+ role='owner'`.

### Globales read-only (5) — ✅ correctas
species / systems_by_species / categories_by_system / field_definitions / system_default_fields: tenant-free, read-only, sin `establishment_id` ni PII → `SELECT *` global = exactamente lo que la RLS permite leer.

### Self-only (2) — ✅ correctas
- `self_user_private` — `WHERE user_id = auth.user_id()` ↔ `user_private_select_self` (0068). PII self-only. EXACTA.
- `self_user_roles` — `WHERE user_id = auth.user_id()` ↔ rama propia de `user_roles_select` (0008). Los roles ajenos los trae `est_members_roles`.

### Per-establishment (10) — ✅ estructura correcta; las 8 marcadas dependían del invariante (HIGH-1, ahora CERRADO)
- `est_establishments` — `id IN org_scope AND deleted_at IS NULL`. Único per-est con backstop directo de `deleted_at`.
- `est_members_roles` — `active=true AND establishment_id IN owner_scope` ↔ rama `is_owner_of` de `user_roles_select`.
- `est_invitations` — `owner_scope AND status='pending' AND deleted_at IS NULL` ↔ rama owner de `invitations_select`.
- `est_rodeos` / `est_management_groups` / `est_animal_profiles` / `est_sessions` / `est_maneuver_presets` / `est_semen_registry` / `est_animal_events` — `establishment_id IN org_scope AND deleted_at IS NULL` ↔ `has_role_in(est) AND deleted_at IS NULL` de cada RLS. **Recuperan el no-leak de campo borrado al cerrarse HIGH-1.**

(Preguntas 6–10 del pase anterior: equivalencia confirmada; el único leak nuevo del modelo JOIN-free era la dependencia del invariante de `active`, materializada en HIGH-1, ahora cerrada por el guard DB.)

---

## Dominios revisados (trazabilidad)
- **A1/A4 — authz service-role / function-level**: trigger `security definer` scopeado; `accept_invitation` admin-client (RLS-bypass) → el guard DB lo agarra igual (no depende de RLS).
- **A3 — IDOR por FK**: el rol creado por accept referenciaba un `establishment_id` borrado sin validar el padre vivo → cerrado por el guard.
- **C1 — PowerSync sync rules como autorización paralela a RLS**: 17 streams auditadas contra su RLS. Equivalencia OK con el invariante cerrado.
- **C4 — stale-auth / integridad del par (active, deleted_at)**: el invariante que sostiene el modelo, ahora enforced por ambas mitades de 0076.
- **Multi-tenant isolation**: el leak de HIGH-1 (cross-tenant, datos de campo borrado a un dispositivo) cerrado.

## Dominios excluidos (con justificación)
- **B / inyección / SSRF / BLE / import**: estos artefactos no tocan respuestas de error nuevas, parsers, fetch externo, BLE ni import. No aplican.
- **Rate limiting de Auth**: no se modifica `config.toml`. No aplica.
- **PII (B2/B3)**: `self_user_private` separa email/phone self-only (0068/ADR-025); las streams no exponen PII de coworkers.
- **D (secretos)**: el trigger no maneja secretos; el YAML no se deploya desde repo.

---

## Anexo LOW (no bloquea)

- **L-1 (drift de doc, NO seguridad):** `specs/active/15-powersync/design.md` §2.2 todavía describe el YAML V2 con `INNER JOIN establishments`, reemplazado por el V3 JOIN-FREE de `sync-streams/rafaq.yaml`. Conviene reconciliar design.md §2.2 al modelo V3 + documentar el invariante "active=true ⇒ campo vivo" y sus write-paths (incluido el guard DB) ANTES de cerrar la feature.
- **L-2 (defensa en profundidad):** considerar también el fix (b) (cancelar invitaciones pendientes al soft-deletear) como cinturón-y-tiradores. (Folded en L-3 del re-Gate.)
- **L-3 (carrera concurrente — re-Gate 1):** ventana READ COMMITTED no dirigible (T_delete ∥ T_accept). Ver detalle en la sección del re-Gate. No bloquea.
