baseline_commit: 78c18083289f4cebe9a5aae3662352108d2a51a4

# impl 10 — Fase 1 (backend delta) — operaciones-rodeo

**Feature**: 10-operaciones-rodeo (Fase 1 backend SOLO). Puerta 1 v2 APROBADA (Raf 2026-06-11),
Gate 1 + Gate 1 puntual LIM-2 PASS. Implementer = esta sesión. NO marco done (queda reviewer + Gate 2 + Puerta 2).

## Baseline para Gate 2
`baseline_commit: 78c18083289f4cebe9a5aae3662352108d2a51a4` (SHA previo a la primera task — trabajamos sobre `main`, sin feature-branch; el Gate 2 calcula el diff desde acá, NO `main...HEAD`).

## Plan (T-DB.1 … T-DB.10) — TODO HECHO
- [x] T-DB.1 — `0085_future_bull.sql` (design §4.1)
- [x] T-DB.2 — `0084_denormalize_is_castrated.sql` (design §4.2, pre-filtro LIM-2)
- [x] T-DB.3 — `0086_castration_recompute_symmetric.sql` (design §4.3)
- [x] T-DB.4 — Test write-through + fidelidad + no-loop + SKIP rodeo muerto (e) + orden pg_trigger (f)
- [x] T-DB.5 — Test recompute simétrico
- [x] T-DB.6 — Test future_bull
- [x] T-DB.7 — Test RLS / tenant
- [x] T-DB.8 — Test destete de sustrato (regresión)
- [x] T-DB.9 — Test no-regresión del gating (delta viejo eliminado)
- [x] T-DB.10 — Test superficie / revokes de las 4 funciones nuevas
- [x] Suite nueva enganchada en `scripts/run-tests.mjs` (`Operaciones-rodeo suite (spec 10 Fase 1)`)
- [x] Aplicada al remoto (Management API) + schema verificado después
- [x] `node scripts/check.mjs` exit 0 (todas las suites verdes, incl. la nueva + animal reconciliada)
- [x] Autorrevisión adversarial (abajo)
- [x] Reconciliación de specs (abajo)

## Archivos del diff (lo que cambié yo)
- **Migraciones nuevas** (disco; aplicadas al remoto vía `scripts/apply-migration.mjs`):
  - `supabase/migrations/0084_denormalize_is_castrated.sql` (§4.2: columna espejo + backfill + force-INSERT + write-through up + propagación down con pre-filtro LIM-2 + RAISE LOG + revokes)
  - `supabase/migrations/0085_future_bull.sql` (§4.1: columna + normalize trigger silencioso + revoke)
  - `supabase/migrations/0086_castration_recompute_symmetric.sql` (§4.3: CREATE OR REPLACE del cuerpo de `tg_animals_apply_castration`, guard simétrico, NO re-crea el trigger, revoke idempotente)
- **Tests**: `supabase/tests/operaciones_rodeo/run.cjs` (nuevo, T-DB.4..T-DB.10) + `scripts/run-tests.mjs` (hook).
- **Reconciliación de test as-built**: `supabase/tests/animal/run.cjs` T2.27 — 1 aserción (`des-castración NO revierte`) reconciliada a `torito` (R13.5 supersede RT2.2.6). La nota DOC de spec 02 la coordina el LEADER (D10).
- **Specs**: `specs/active/10-operaciones-rodeo/design.md` (§4 nota as-built de numeración/orden) + `tasks.md` (T-DB.* en `[x]` + notas as-built).

## Trazabilidad R<n> → test (todos contra la DB remota beta `xrhlxxdnfzvdnztacofj`)
| R<n> | Test (en `supabase/tests/operaciones_rodeo/run.cjs`, salvo nota) |
|---|---|
| R13.3 (denorm fiel) | T-DB.4(a) write-through, (b) force-INSERT, (c) propagación down |
| R13.4 (write-through up, no force en UPDATE) | T-DB.4(a) true/false, T-DB.7 (paridad de poder) |
| R13.5 (recompute simétrico) | T-DB.5 (torito↔novillito, toro↔novillo, ternero no-transiciona, override, history auto_transition) + `tests/animal/run.cjs` T2.27 (revert → torito) |
| R5.6 (override no transiciona) | T-DB.5 override |
| R5.7 (efecto de castración as-built) | T-DB.5 |
| R12.1 (future_bull solo machos) | T-DB.6(a) macho, (b) hembra normaliza, (d) default false |
| R12.4 (auto-clear al castrar) | T-DB.6(c) (own profile directo + propagación a perfil compartido) |
| R9.1 / R9.2 (roles / tenant) | T-DB.7 (sin rol no muta; field_operator sí) |
| R5.5 (destete sustrato) | T-DB.8 (ternera→vaquillona, ternero castrado→novillito, override, soft-delete recalcula) |
| R7.3 / R9.4 (no-regresión gating, sin data_key castracion) | T-DB.9 |
| R9.4 (superficie: revokes + secdef + search_path + no RPC nueva) | T-DB.10 + T-DB.4(f) orden pg_trigger + T-DB.4 pre-filtro espeja 0021 |
| LIM-2 (tolerar-y-saltear) | T-DB.4(e) SKIP rodeo muerto + convergencia |

## Verificación de schema DESPUÉS (vía Management API)
- `animal_profiles.future_bull` (bool, default false, NOT NULL) ✓ + `animal_profiles.is_castrated` (bool, default false, NOT NULL) ✓.
- 4 funciones nuevas: `tg_normalize_future_bull`, `tg_force_is_castrated_on_profile_insert`, `tg_profile_is_castrated_writethrough`, `tg_propagate_is_castrated_to_profiles` — todas SECURITY DEFINER + `search_path=public` + EXECUTE revocado a authenticated/anon/public ✓.
- `tg_animals_apply_castration` reemplazada con guard simétrico (`is not distinct from old.is_castrated`) ✓; trigger `animals_apply_castration` NO re-creado; revoke re-emitido idempotente ✓.
- BEFORE triggers de `animal_profiles` (orden de disparo = alfabético): `...force_animal_identity` → `force_is_castrated` → `identity_check` → `normalize_future_bull` → `rodeo_check` ✓ (T-DB.4f contra `pg_trigger`).
- AFTER trigger de `animals`: `animals_propagate_is_castrated` ✓.
- Pre-filtro de la propagación = predicado LITERAL de `rodeo_check` (0021): `r.id=ap.rodeo_id AND r.establishment_id=ap.establishment_id AND r.active=true AND r.deleted_at is null` ✓ (comparado contra el source de 0021 en T-DB.4 pre-filtro).

## Autorrevisión adversarial (paso 8)
Busqué activamente, como revisor hostil:
- **Pre-filtro espeja 0021 sin desviación**: ✓ — comparé el source de `tg_propagate_is_castrated_to_profiles` contra `tg_animal_profiles_rodeo_check` (0021) campo por campo (test dedicado). Las 4 condiciones idénticas, solo `new.`→`ap.`.
- **No-loop termina (guards en ambos sentidos)**: ✓ — T-DB.4(d) confirma EXACTAMENTE una fila de history nueva (sin rebote). Razoné la cadena: perfil→write-through(guard)→animals→apply_castration + propagación(guard+pre-filtro)→perfiles→write-through encuentra animals igual→no-op→FIN. La propagación a un perfil dispara su write-through (no-op por guard) y su normalize (limpia future_bull) — sin recursión.
- **4 funciones nuevas con revoke + SECURITY DEFINER + search_path**: ✓ (T-DB.10 + verificación de catálogo).
- **Recompute simétrico respeta override y no toca el trigger**: ✓ (T-DB.5 override; 0086 solo CREATE OR REPLACE de la función).
- **Orden de triggers BEFORE el esperado**: ✓ (T-DB.4f contra pg_trigger, no por convención).
- **Aplicación idempotente sin schema a medias**: ✓ — todas `if not exists`/`create or replace`/`drop+create`/`revoke` re-emitible, en `begin;`/`commit;`. Aplicadas OK; re-aplicables.
- **HALLAZGO CORREGIDO (dependencia de orden)**: el primer apply (future_bull=0084 antes de denorm=0085) FALLÓ con `42703: column "is_castrated" does not exist` — el normalize de future_bull LEE `new.is_castrated`. **Cerré** renumerando: denorm=0084 ANTES, future_bull=0085 DESPUÉS. Reconciliado en design §4 + headers de las migraciones + tasks.
- **HALLAZGO CORREGIDO (constraint unique parcial)**: el modelado del "animal compartido entre campos" chocaba con `animal_profiles_active_animal_unique` (`(animal_id) WHERE status='active'`) — solo UN perfil active por animal global. **Cerré** modelando el segundo perfil como NO-activo (`status='transferred'`): la propagación (sin filtro de status, estilo 0079) lo alcanza igual; el escenario LIM-2/compartido sigue siendo fiel (el perfil viejo de otro campo es típicamente transferred/sold).
- **HALLAZGO CORREGIDO (regresión spec 02)**: 0086 (simétrico) rompió 1 aserción de `tests/animal/run.cjs` T2.27 que esperaba el comportamiento VIEJO (`true→false` no revierte, RT2.2.6). Es la supersesión INTENCIONAL de R13.5. **Cerré** reconciliando la aserción del test al as-built (`torito`) con comentario que cita R13.5/0086 + nota de que el LEADER coordina la reconciliación DOC de spec 02 (D10).
- **Tests que pasan por la razón equivocada**: revisé que cada SKIP/reject ejercite el path real — T-DB.4(e) verifica que el perfil propio SÍ se aplica Y el huérfano queda stale (no solo "no aborta"); T-DB.7 verifica que el UPDATE devuelve 0 filas Y el estado no cambió; T-DB.9 inserta un `treatment 'Castración'` real y verifica que NO se gatea + vaccination fail-closed real.

## Reconciliación de specs (paso 9)
- `design.md §4`: nota as-built con números finales (0084/0085/0086), el ORDEN invertido (denorm antes que future_bull, por la dependencia del normalize), el `begin;/commit;` y la idempotencia, y el mecanismo de apply (Management API).
- `tasks.md`: T-DB.1..T-DB.10 marcadas `[x]` con notas as-built (números finales, modelado transferred, supersesión RT2.2.6).
- `tests/animal/run.cjs` (spec 02): 1 aserción reconciliada al as-built (no es doc de spec 02; es test que mi migración cambió por diseño).
- **NO toqué** docs de spec 02 (requirements/design/tasks tier2, comentario de 0064) — la nota RT2.2.6↔recompute simétrico la coordina el LEADER (D10, restricción explícita).

## Riesgos residuales / para Gate 2 + leader
1. **DOC de spec 02 sin reconciliar (leader-owned, D10)**: `requirements-tier2-categorias.md` RT2.2.6, `design-tier2-categorias.md`, `tasks-tier2-categorias.md` T8.h, y el COMENTARIO de `0064_castration_transition.sql` ("true->false NO revierte") quedan AHORA stale vs el as-built simétrico (0086). No los edité (restricción). **El leader debe reconciliar la nota.** El comportamiento real ya es simétrico; los tests reflejan el as-built.
2. **Ledger del remoto**: las 3 migraciones se aplicaron vía `database/query` (Management API), NO vía `apply_migration` — por diseño (mismo mecanismo que 0068-0083, para no arriesgar estado a medias). El ledger de `apply_migration` sigue sin 0068-0086; el disco es la fuente de verdad de la secuencia. Sin cleanup nuevo requerido (consistente con el estado pre-existente). Si en algún momento se quiere alinear el ledger, es un cleanup transversal de 0068-0086, no de esta feature.
3. **3 LOW del Gate 1 puntual LIM-2** (ya en `docs/backlog.md`, leader): L1 race READ COMMITTED (fail-safe), L2 `v_skipped` cuenta soft-deleted (cosmético del log), L3 perfiles soft-deleted con rodeo vivo se actualizan (pre-existente como 0079). Ninguno bloquea; el as-built reproduce el predicado literal de 0021 como pedía Gate 2.
4. **Flakes de timing**: la suite usa `eventually(...)` (read-after-write lag del remoto compartido). Corrió verde de punta a punta; si una corrida flakea por rate-limit de la DB beta, re-correr (patrón animal/maneuvers).

## NO marco done
Queda reviewer + Gate 2 (security_analyzer modo `code`, baseline arriba) + Puerta 2 de Raf. Esto es SOLO Fase 1 (backend); Fases 2-4 (cliente/UI) no se tocaron.

## Verificación de schema ANTES (pre-flight, vía Management API database/query)
- `animal_profiles.is_castrated`: NO existe → la creo (0085).
- `animal_profiles.future_bull`: NO existe → la creo (0084).
- `animals.is_castrated`: EXISTE (boolean default false) — fuente de verdad física (0060). ✓
- `tg_animals_apply_castration` + trigger `animals_apply_castration`: EXISTEN (0064). Cuerpo as-built
  == cita del design (guard `if not (old.is_castrated = false and new.is_castrated = true)`). ✓ Sin contradicción.
- BEFORE triggers de `animal_profiles` (orden alfabético = orden de disparo): block_idv_change,
  category_check, force_animal_identity, identity_check, management_group_check, rodeo_check,
  rodeo_same_system_check, set_created_by(INSERT), set_override, set_updated_at, teeth_gating.
- `tg_animal_profiles_rodeo_check` (0021): predicado `r.id=new.rodeo_id AND r.establishment_id=new.establishment_id
  AND r.active=true AND r.deleted_at is null` — lo espejo LITERAL en el pre-filtro de la propagación (T-DB.2).

## Numeración / aplicación al remoto
- Disco: hasta `0083_create_animal_rpc.sql`. Mis 3 migraciones: **0084 / 0085 / 0086**.
- Re-glob de `supabase/migrations/` antes de escribir: sin 0084 de terminales paralelas.
- Apply: `scripts/apply-migration.mjs` (Management API `database/query` — MISMO mecanismo que dejó 0068-0083;
  NO ensucia el ledger de `apply_migration`; idempotente → re-aplicable). El archivo `.sql` queda en disco como fuente de la secuencia.
