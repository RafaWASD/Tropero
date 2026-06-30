# Security Gate 2 (modo `code`) — delta #15 "cría al pie" (BACKEND)

**Veredicto: PASS** (tras fix 0116 — el HIGH-1 quedó RESUELTO)

> **Historial**: el primer pase dio **FAIL** por 1 finding HIGH de integridad/compliance (0115 dropeó la
> herencia de `breed_id` madre→ternero, regresión de dato regulado SIGSA R1.7). El leader emitió la migración
> correctiva **`0116_register_birth_breed_id_fix.sql`**, aplicada al remoto, que **restaura la herencia** sin
> introducir superficie nueva. Re-auditado el SQL de 0116 directamente (no sobre la palabra del coordinador):
> **HIGH-1 resuelto, 0116 limpio → PASS**.
>
> El posicionamiento de seguridad multi-tenant ya era SÓLIDO en 0114/0115 (aislamiento, authz, IDOR,
> idempotencia, anti-TOCTOU, grants fail-closed, inyección): todas las preguntas del leader dieron verde.

- **Baseline auditado**: `a25e21f` → working tree (`git diff a25e21f`) + migración correctiva `0116`.
- Migraciones 0114/0115/0116 aplicadas al remoto (confirmado por leader). El `register_birth` VIGENTE es el de **0116**.
- **Skill**: `sentry-skills:security-review` corrida sobre el diff. 0 findings explotables en el plumbing TS (parametrizado por supabase-js, sin interpolación SQL, sin URL/host attacker-controlled, sin `establishment_id` en el wire). Cobertura del SQL PL/pgSQL = **indirecta** (fuera del core JS/Py de la skill) → trazado manual.

---

## Resolución del finding HIGH-1 (verificada contra `0116`)

### [RAFAQ-SPECIFIC HIGH-1] Regresión de herencia de `breed_id` (SIGSA R1.7) — **RESUELTO por 0116**

- **Origen** (pase 1): `0115` se moldeó sobre `0075` (firma 4-arg, PRE-0109) en vez del as-built real `0109`. Su `DROP+CREATE` borró la herencia de `animal_profiles.breed_id` de la madre al ternero (spec 08 SIGSA R1.7) → todo ternero por `register_birth` (mellizos + cría-al-pie CREATE) nacía con `breed_id` NULL. Lo enmascaró que la suite ANIMAL no cubre raza (la asercia la suite SIGSA, `tests/sigsa/run.cjs` → `T3 R1.7`).
- **Fix** (`0116_register_birth_breed_id_fix.sql`, `CREATE OR REPLACE` de la 6-arg): combina el cuerpo de `0109` (herencia de breed_id) con las extensiones de `0115` (rodeo/idv/caps). Verificado en el SQL desplegado:
  - `0116:55-56` — el SELECT de auth lee `p.breed_id` → `v_mother_breed_id` (misma fila real de la madre; sin query extra).
  - `0116:145-163` — el INSERT de `animal_profiles` incluye la columna `breed_id` (`:148`) con valor `v_mother_breed_id` (`:158`). **Mapeo columnas↔valores verificado: 12↔12, `breed_id` en la posición correcta entre `category_override` y `birth_weight`** (idéntico orden que 0109 → sin off-by-one).
  - Madre sin breed_id → ternero NULL (`v_mother_breed_id` NULL se propaga). Comportamiento R1.7 caso-null preservado.
- **0116 no introduce superficie nueva** (re-auditado):
  - `CREATE OR REPLACE` sobre la firma 6-arg que **ya existía** (de 0115) → sin `DROP`, sin overload nuevo, sin grant colgando.
  - `revoke ... from public, anon` + `grant ... to authenticated` sobre la firma tipada (`0116:178-179`) → **fail-closed** e idempotente. (En `CREATE OR REPLACE` Postgres preserva el ACL existente —ya revocado por 0115— y NO re-otorga PUBLIC; el revoke explícito cierra cualquier borde.)
  - `security definer` + `set search_path = public` (`0116:29-30`) intactos.
  - Todas las propiedades de seguridad ya limpias en 0115 se preservan: auth derivada de la fila real de la madre, idempotencia HIGH-D1 scopeada a `(madre, client_op_id, tenant)` (`0116:68-81`), rodeo anti-IDOR `r.establishment_id = v_est` + mismo sistema (`0116:99-117`), unicidad idv `(establishment_id, idv)`, cap de tag ≤15 (`0116:133-135`), cota de fecha (`0116:83-89`).
  - El único agregado funcional —leer+escribir `breed_id`— es **server-derived de la fila real de la madre**, nunca del payload → sin IDOR/inyección/mass-assignment nuevo.
- **Migración tree coherente**: `0115` marcada `🔴🔴 SUPERSEDED POR 0116` (`0115:3-8`, "NO copiar este cuerpo — le falta breed_id"). El `register_birth` vigente = `0116`.
- **Nota sobre la suite**: no re-corrí los tests (fuera de mi rol y prohibido por el leader). El veredicto se apoya en el SQL desplegado, que self-evidently hace pasar `SIGSA T3 R1.7` (breed_id ahora heredado) y deja intactos los tests de #15. La claim del coordinador de "200/200" es consistente con el SQL pero NO es la base de mi PASS — la base es el SQL re-auditado.

---

## Checklist de seguridad RAFAQ — preguntas del leader (todas VERDE)

### `link_calf_to_mother` (0114) — sin cambios desde el pase 1
| Pregunta | Veredicto | Evidencia |
|---|---|---|
| ¿Tenant derivado SIEMPRE de filas reales, nunca del payload? | ✅ | madre: `0114:73-77` (`p.establishment_id` de la fila real, `deleted_at is null`); ternero: `0114:107-115` scopeado a `v_est`. El cliente nunca pasa `establishment_id`. |
| ¿`has_role_in` sobre el tenant derivado ANTES del replay? | ✅ | `0114:83` (`has_role_in(v_est)`, 42501) rige antes del replay `0114:129`. |
| ¿Replay anclado a (madre, client_op_id, tenant) sin oráculo global? | ✅ | `0114:130-137`. Sin lookup global por client_op_id. |
| ¿`FOR UPDATE` cierra el TOCTOU del re-link? | ✅ | `0114:115` `for update of p` tomado ANTES del guard "ya tiene madre" (`0114:147-153`). Serializa links concurrentes del mismo ternero → 2do aborta 23514. |
| ¿Revoke public/anon + smoke-check + search_path fijo? | ✅ | `0114:62`, `:185`, smoke-check `:188-200`, `notify pgrst` `:202`. |
| ¿`birth_calves` sin GRANT INSERT al cliente? | ✅ | `0045:39` solo `select` a authenticated; `0049:17` `select` a service_role. Poblada solo por el DEFINER. |
| (extra) ¿Error genérico sin oráculo cross-tenant? + guard de especie | ✅ | `0114:116-118` (23503 genérico); `:120-122` (especie → 23514). |

### `register_birth` extendido — ahora `0116` (firma 6-arg vigente)
| Pregunta | Veredicto | Evidencia |
|---|---|---|
| ¿Validación del rodeo del ternero anti-IDOR (tenant derivado de la madre)? | ✅ | `0116:104-115`: `r.establishment_id = v_est` + active + not deleted + mismo sistema. |
| ¿`CREATE OR REPLACE` no deja grant colgando / overload nuevo? | ✅ | misma firma 6-arg de 0115; sin DROP; revoke/grant re-aplicados `0116:178-179`. |
| ¿`p_calf_idv` respeta unicidad/inmutabilidad de idv? | ✅ | dup choca índice `(establishment_id, idv)` 0020 → 23505 en OTRO índice → `permanent_reject` (no `idempotent_discard`). Inmutabilidad 0036 no aplica (INSERT). |
| ¿Defaults NULL preservan el as-built? | ✅ | rodeo + idv + **breed_id (restaurado en 0116)** todos preservan as-built con NULL. |
| ¿Falta del smoke-check fail-closed = gap HIGH? | No (LOW) | el `revoke from public,anon` tipado es el control; presente en `0116:178`. |
| **¿Herencia `breed_id` (HIGH-1)?** | ✅ RESUELTO | `0116:55-56` (lee) + `:148, :158` (escribe). |

### Plumbing (`upload.ts` `idempotent_discard` ahora incluye `link_calf_to_mother`) — sin cambios desde el pase 1
| Pregunta | Veredicto | Evidencia |
|---|---|---|
| ¿`idempotent_discard` del 23505 sin abrir discard espurio de otros 23505? | ✅ | `upload.ts:222-228`: triple scoping (code 23505 + opType ∈ {register_birth, link_calf_to_mother} + regex `reproductive_events_client_op_id_uq\|client_op_id`). Índice compuesto `(animal_profile_id, client_op_id)` (`0075:52-54`); link solo inserta `reproductive_events`+`birth_calves` (sin idv/tag dup posible) → único 23505 = replay legítimo. |
| ¿`mapIntentToRpc` inyecta `p_client_op_id` solo donde la firma lo acepta? | ✅ | `upload.ts:147-152`; firma 0114 `(uuid,uuid,date,uuid)` lo acepta. |
| ¿El cliente manda `establishment_id` por el wire? | ✅ No | tenant 100% server-derived en events/outbox/upload. |

---

## Tabla de inputs (campos del cliente que tocan el backend)
| campo | límite | validación | OK? |
|---|---|---|---|
| `p_calf_rodeo_id` (0116) | FK uuid | server: activo + `establishment_id = v_est` + mismo sistema, else 23514 | ✅ |
| `p_calf_idv` (0116) | trim/nullif; unicidad `(establishment_id, idv)` | server (constraint DB) | ✅ |
| `p_event_date` (0114/0116) | 1900 ≤ year ≤ current+1 | server tras has_role_in | ✅ |
| `p_mother_profile_id` / `p_calf_profile_id` (0114) | uuid; derivación de fila real + scoping a `v_est` | server (anti-IDOR) | ✅ |
| `calf_tag_electronic` (0116) | ≤ 15 díg (FDX-B) | server (`0116:133-135`) | ✅ |

## Tabla de rate limits (acciones abusables tocadas por el diff)
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `link_calf_to_mother` RPC | n.a. | — | — | RPC autenticada vía outbox; sin email/SMS/API-externa/bulk; idempotente por client_op_id. Sin vector de amplificación nuevo. |
| `register_birth` (0116) | n.a. | — | — | Mismo perfil que el as-built; sin fan-out nuevo. |

---

## False positives / verificados-OK
- Smoke-check ausente en 0115/0116 → NO finding (el `revoke` tipado es el control; precedente 0075/0109).
- `CREATE OR REPLACE` de 0116 → NO deja grant colgando ni overload (misma firma; revoke re-aplicado fail-closed).
- `idempotent_discard` ampliado a link → NO abre discard espurio (scoping triple).
- Plumbing TS → sin inyección/IDOR (parametrizado, sin `establishment_id` en wire, RPC re-valida server-side).

## Archivos analizados
- `supabase/migrations/0114_link_calf_to_mother_rpc.sql` (nuevo)
- `supabase/migrations/0115_register_birth_calf_rodeo.sql` (nuevo, SUPERSEDED)
- `supabase/migrations/0116_register_birth_breed_id_fix.sql` (correctiva — restaura breed_id)
- `app/src/services/powersync/upload.ts`, `outbox.ts`, `app/src/services/events.ts` (diff)
- Referencia as-built: `0075`, `0109`, `0045`, `0049`
- Tests: `supabase/tests/sigsa/run.cjs` (T3 R1.7), `supabase/tests/animal/run.cjs` (diff)

## Cobertura indirecta de Deno / RLS / PowerSync
- La skill Sentry NO cubre semántica multi-tenant de PL/pgSQL (SECURITY DEFINER, RLS-bypass del DEFINER, FOR UPDATE) ni sync rules de PowerSync → análisis **manual**. La skill solo cubrió el plumbing TS (sin findings).
- PowerSync sync rules: no tocadas por este diff (overlay optimista local-only, se limpia en el ACK).

## Estado final
- **HIGH-1 RESUELTO** por `0116` (herencia breed_id restaurada, verificado en SQL).
- **0116 no introduce nada nuevo** (CREATE OR REPLACE limpio, grants fail-closed, propiedades de seguridad preservadas).
- Seguridad multi-tenant de 0114/0116 + plumbing = **PASS**.
