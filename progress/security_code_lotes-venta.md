# Gate 2 (security_analyzer modo `code`) — feature A · LOTES OPERABLES (venta/descarte en tanda)

**Veredicto: PASS — 0 findings HIGH.** Delta spec 02 (ADR-028 Nivel B), frontend puro, sin cambios en `supabase/`/RLS/RPC. Baseline `42f76c5`. (Reporte inline del analyzer; persistido por el leader.)

## Focos verificados (design §7) — todos OK
1. **Anti-IDOR de la tanda**: `venta.tsx:104-108` = `fetchGroupMembers(est, group)` (SQLite local RLS-scopeado) ∩ `Set(requestedIds)` → un `profileId` tampereado que no sea miembro del lote en el campo activo se descarta antes del loop. Defensa en profundidad: la RPC `exit_animal_profile` (0044:38-51) re-deriva `establishment_id`/`created_by` de la fila real y exige `has_role_in AND (owner OR creator)` → cross-tenant rebota 42501. El cliente solo manda `p_profile_id`.
2. **No fabricar `establishment_id`**: `exitAnimalsBatch` no recibe group/est; la RPC los deriva. Cero hardcode.
3. **Rechazo parcial (RLV.8)**: `runBatchExit` = loop de intents independientes; fail-closed solo ante fallo de escritura LOCAL; el rechazo server-side lo maneja la outbox por-intent (rollback del overlay 'exited' de ESE animal). No-atomicidad intencional; UI superficia "N de M".
4. **Clear sobre archivado**: `assignAnimalToGroup(id,null)` válido (baja NO es soft-delete → fila matchea; trigger 0037 early-return con NULL).
5. **"Crear lote" owner-only**: gateado en UI (`canManageGroups`=owner) + barrera RLS `management_groups_insert = is_owner_of`.
6. **`buildSessionEmptyFemalesQuery`**: 100% parametrizada (solo `sessionId` como arg `?`); scoping session_id + activos + no borrados; sin fuga cross-sesión/tenant.
7. **Inputs de texto libre**: fecha/precio/peso (común + override) + nombre de lote → todos con límite cliente + validación server/DB-authoritative (tabla completa en el reporte). 

## False positives descartados
Prototype pollution (keys = UUIDs de `fetchGroupMembers`, no input crudo), info disclosure (UI muestra strings genéricos por `kind`, nunca `err.message`), mass assignment (`planBatchExit` arma params campo por campo, sin spread de input).

## Rate limits
Loop `exitAnimalsBatch`/`assignVacias` acotado por N de datos PROPIOS del tenant (miembros del lote / vacías de la sesión), todas operaciones ya autorizadas al rol, escrituras locales→outbox sin costo externo → no amerita rate-limit propio (patrón as-built de operaciones masivas offline).
