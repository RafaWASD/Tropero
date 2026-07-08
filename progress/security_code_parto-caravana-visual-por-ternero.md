# Gate 2 (ADR-019) — Security code review · `parto-caravana-visual-por-ternero`

**Modo**: `code` · **Feature**: spec 02, delta Nivel B (ADR-028) `parto-caravana-visual-por-ternero`.
**Fecha**: 2026-07-07 · **Auditor**: security_analyzer (Opus 4.8) · **Registrado por**: leader (el agente devolvió el review inline; se persiste acá para el audit trail).
**Scope**: `supabase/migrations/0121_register_birth_calf_idv_per_calf.sql`, `app/src/services/events.ts`, `app/src/utils/calf-birth.ts`, `app/app/agregar-evento.tsx`, `app/src/components/FormField.tsx` (tests/e2e/spec/progress excluidos).

## Veredicto: **PASS — 0 findings (0 Critical / 0 High / 0 Medium explotable)** · Risk Low · Confidence High

Data-flow del único canal nuevo attacker-controlled (`calf_idv` per-calf):
`CalfBlock` input → `sanitizeIdvInput` (clamp UX, dígitos, ≤20) → `calf.idvRaw` → `calfIdvForSubmit` (trim, empty→null) → `BirthCalfInput.idv` → `cleanStr` → `payload.calf_idv` (asignación field-by-field, **sin** spread del body) → `p_calves[i].calf_idv` (jsonb) → RPC `v_calf->>'calf_idv'` → `trim`/`nullif`/`coalesce` → **INSERT parametrizado** en `animal_profiles.idv`.

| Concern | Resultado | Evidencia |
|---|---|---|
| SQL injection / dynamic SQL | SAFE | `0121` es plpgsql estático; `calf_idv` llega solo como variable ligada a un `INSERT VALUES` parametrizado (`0121:106-128`). Sin `EXECUTE`/`format()`/`quote_*`/`\|\|`-a-SQL (los 2 hits de `execute` son DDL grant/revoke). |
| Cross-tenant / IDOR | SAFE | `v_est` derivado de la fila real de la madre (`0121:53-58`); `has_role_in(v_est)`→42501 (`0121:60`); insert de cría fuerza `establishment_id = v_est`; unique index `animal_profiles_idv_unique(establishment_id, idv)` per-tenant → un `calf_idv` solo colisiona dentro del propio est. `p_calf_rodeo_id` re-validado same-tenant+same-system. |
| Mass assignment | SAFE | Insert enumera columnas explícitas; est/category/breed/status/entry_origin server-derivados; `events.ts` arma `payload` field-by-field (nunca spread del body). |
| Unbounded input sink | SAFE | `animal_profiles.idv` acotado por `animal_profiles_idv_len_chk (char_length(idv)<=64)` (0070, enforça todo INSERT incl. SECURITY DEFINER). El cambio de firma de `calfIdvForSubmit` sacó un **gate de tamaño de camada**, NO un bound de caracteres. `calf_tag` capeado ≤15 in-RPC. |
| Authz / Idempotencia / Grants | SAFE | `has_role_in` sin cambios (pre-write); dedup `client_op_id` upstream del loop (intacto); `revoke public,anon` + `grant authenticated` firma 6-arg byte-idéntica; `CREATE OR REPLACE` preserva grants. |
| Information disclosure | SAFE | RPC solo raises estáticos; frontend sin `console.*`/`err.message` nuevos. |
| `security definer` + `set search_path=public` | PRESENTE | `0121:42-43`. |
| FormField `testID` | SAFE | Prop opcional aditivo → `<TextInput data-testid>`; display puro, valor derivado del índice del loop. |

## Needs Verification (no bloqueantes)
- **VERIFY-001**: el bound del idv (64) vive en el column-CHECK 0070, fuera del diff. Confirmado presente en el remoto por el leader. Sin acción.
- **VERIFY-002**: `p_calves` sin cota superior de array (`0121:76-78` solo `>=1`). Pre-existente (este delta no tocó la validación del array). Auth + rol en el propio tenant; DoS auto-infligido, no escala privilegios. Defense-in-depth → anotado en `docs/backlog.md` (2026-07-07); NO se metió en `0121` para mantener la migración = los 3 cambios revisados.

**Conclusión**: sin vulnerabilidades HIGH-confidence. Gate 2 PASS. Habilitado a la puerta de deploy (autorización de Raf) + Puerta 2.
