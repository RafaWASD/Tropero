# Security Gate 2 — RE-GATE código COMPLETO: AGREGAR CARAVANA DESDE LA FICHA (spec 02 delta)

**Modo**: `code` (ADR-019) · **Veredicto**: **PASS — 0 HIGH** · **Fecha**: 2026-06-29
**Baseline**: `8926e16` · **Diff revisado**: `git diff 8926e16` (working tree) + archivos untracked del change set
**Skill**: `sentry-skills:security-review` corrida sobre el diff + checklist RAFAQ + Catálogo de dominios.

> Este pase REEMPLAZA el anterior (que fue sobre código a medio hacer, sin call-sites de write). Ahora
> existen los handlers `onAssignTag`/`onAssignIdv` y el render real de `IdentifierAssignRow` → hay
> call-sites de escritura reales. Re-auditado el camino completo end-to-end.

## Alcance verificado

- **Frontend puro CONFIRMADO**: `git diff 8926e16 -- supabase/` → **vacío**. Cero migraciones, cero Edge
  Functions, cero `config.toml`. Ningún `[auth.rate_limit]` tocado. Sin cambios de schema/RLS/RPC.
- Las barreras server-side (RPC `assign_tag_to_animal` 0089, trigger inmutabilidad idv 0036, unique parcial
  `(establishment_id, idv)` 0020, RLS `animal_profiles_update` = has_role_in) **ya existen y NO se modifican**
  — son la frontera real; este diff solo agrega afordancias de cliente que las consumen.

## Archivos analizados (superficie de la feature)

| Archivo | Cambio | Rol en security |
|---|---|---|
| `app/app/animal/[id].tsx` | M (+139) | `onAssignTag` / `onAssignIdv` — call-sites de write |
| `app/src/components/IdentifierAssignRow.tsx` | NUEVO (untracked) | UI de input inline (presentación pura) |
| `app/src/utils/identifier-assign.ts` | NUEVO (untracked) | `canAssignTag`/`canAssignIdv` (gate cliente R4.13) |
| `app/src/services/animals.ts` | M (+25) | wrapper `setIdv` |
| `app/src/services/powersync/local-reads.ts` | M (+24) | `buildSetIdvUpdate` (UPDATE local) |
| `app/src/utils/animal-input.ts` | sin cambios (preexistente, ahora wired) | sanitizers `sanitizeTagInput`/`sanitizeIdvInput`/`isValidTagElectronic` |
| `app/e2e/animals.spec.ts`, `*.test.ts`, `scripts/run-tests.mjs`, `progress/current.md` | M | tests/infra (fuera de superficie de ataque) |

## Findings HIGH de Sentry

**Ninguno.** La skill no identificó vulnerabilidades HIGH-confidence; coincido tras validación manual.

## Findings RAFAQ-SPECIFIC

**Ninguno.**

## Validación de los focos pedidos (todos PASS)

### 1. `onAssignTag` — anti cross-tenant (RCF.2.5) ✅
- `lookupByTag(trimmed, detail.establishmentId)` y `assignTagToAnimal(detail.profileId, trimmed)`
  (`[id].tsx`, handler `onAssignTag`). Ambos ids salen de **`detail.*`**, NUNCA del contexto activo.
- `detail.establishmentId` (animals.ts:1068) y `detail.profileId` (animals.ts:1066) los setea
  `fetchAnimalDetail(profileId)` leyendo **la fila del PERFIL en el SQLite local** (`row.establishment_id` /
  `row.id`), no el establishment activo. Confirmado: mirar la ficha del campo A con el campo B activo
  pre-checkea/encola contra A. Correcto.
- **Anti-IDOR**: el cliente solo pasa `p_profile_id` + `p_tag_electronic` al outbox (`enqueueAssignTag`,
  outbox.ts:379/402) — **cero `establishment_id` del cliente**; el RPC 0089 deriva el tenant server-side. El
  `detail.profileId` siempre es un perfil ya sincronizado al device del usuario (sync rules = has_role_in), y
  ante un id forjado la RLS/RPC del server rechaza. No se introduce IDOR nuevo desde el frontend.

### 2. `onAssignIdv` — UPDATE local parametrizado, sin mass-assignment ✅
- `setIdv(detail.profileId, trimmed)` → `runLocalWrite(buildSetIdvUpdate(profileId, idv))`.
- `buildSetIdvUpdate` (local-reads.ts): `UPDATE animal_profiles SET idv = ? WHERE id = ? AND deleted_at IS
  NULL`, `args: [idv, profileId]`. **Bound params** vía `db.execute(sql, args)` (local-query.ts:97). Escribe
  **solo la columna `idv`** — no hay spread de body → sin mass-assignment.
- Barrera al subir: RLS `animal_profiles_update` (has_role_in del campo del perfil). Correcto.

### 3. Solo se asigna lo VACÍO (R4.13) — doble gate ✅
- **Gate cliente**: `IdentifierAssignRow` se renderiza solo cuando `detail.tagElectronic == null` /
  `detail.idv == null` **Y** `canAssignTag/canAssignIdv` (status `active`) — si está seteado, `AttributeRow`
  read-only (`[id].tsx`, sección Identificación). `identifier-assign.ts:26,36` = `status==='active' && X==null`.
- **Gate server** (preexistente, no modificado): trigger inmutabilidad idv 0036 (permite NULL→valor, rechaza
  valor→otro con 23514) + RPC 0089/trigger 0079 para el tag. El cliente no es la barrera; solo evita ofrecer
  lo que el server rechazaría.

### 4. Input adversarial en sanitizers/validate — sin ReDoS, sin injection ✅
- `sanitizeTagInput` = `raw.replace(/\D/g,'').slice(0,15)` · `sanitizeIdvInput` =
  `raw.replace(/\D/g,'').slice(0,20)` · `isValidTagElectronic` = `/^\d{15}$/.test(t)` (animal-input.ts).
  Regexes **lineales** (clase de char negada + cuantificador fijo) → no hay backtracking catastrófico → **no
  ReDoS**. Son utils PURAS que producen un id de máquina (solo dígitos, acotado).
- Aunque un paste evada el sanitizer, el valor viaja como **bound param** (SQL local) o **JSON param del RPC**
  → sin vector de injection. `validate` del idv = `v.trim().length > 0` (trivial).

## False positives descartados (trazabilidad)

| Patrón candidato | Por qué NO es finding |
|---|---|
| `return { ok:false, error: r.error.message }` en `onAssignTag`/`onAssignIdv` (¿info disclosure B1?) | El `message` es un error **client-local** de `runLocalWrite`/enqueue (SQLite execute), no una respuesta de server/DB con PII/secreto. `enqueueAssignTag` siempre encola OK offline; el rechazo real (23505/23514/42501) lo superficia `uploadData` por el canal de status, no por este return. No cruza un trust boundary server→cliente. |
| `lookupByTag` → search con término del usuario (¿PostgREST filter injection F1?) | No usa `.or()/.filter()/ilike` con string interpolado: usa `buildSearchByTagQuery`/`buildLookupTagAcrossFieldsQuery` con `?` y `args:[tag]` (bound). Además el término ya está sanitizado a dígitos. |
| `buildLookupTagAcrossFieldsQuery` sin filtro de `establishment_id` (¿fuga cross-tenant?) | Intencional y seguro: el SQLite local ya está scopeado por la stream (has_role_in → solo campos del usuario); detecta el caso 'transfer' (EID en otro campo PROPIO). No amplía el set más allá de lo que el server ya replicó. Preexistente, no modificado por este diff. |
| Optimismo en sitio `setDetail((d)=>({...d, idv/tagElectronic}))` (¿estado mentido?) | Es estado de UI local con REVERT explícito (`setDetail(snapshot)`) si el write/encolado falla. No persiste ni se sube; el valor canónico baja por la stream. Sin impacto de seguridad. |

## Tabla de inputs (campos que el usuario tipea en este diff)

| Campo | Límite (largo/charset) | Validación | Autoritativa server-side | OK? |
|---|---|---|---|---|
| Caravana electrónica (`tag`) | 15 díg exactos, solo `[0-9]` (`sanitizeTagInput` + `maxLength=15` nativo) | `isValidTagElectronic` (15 díg) inline al confirmar | Sí — RPC 0089 + trigger 0079 + inmutabilidad; valor como JSON param | ✅ |
| Caravana / IDV (`idv`) | ≤20 díg, solo `[0-9]` (`sanitizeIdvInput` + `maxLength=20`) | no-vacío inline al confirmar | Sí — UPDATE `idv=?` bound + RLS `animal_profiles_update` + unique parcial `(establishment_id, idv)` 0020 + inmutabilidad 0036 | ✅ |

> El sanitizer del cliente es UX (attacker-controlled, bypasseable). La capa autoritativa es la DB/RPC
> server-side preexistente — presente para ambos campos. No hay texto libre nuevo, ni buscador nuevo, ni
> prompt LLM. `visual_id_alt` y "detectar bastoneo" quedaron explícitamente FUERA de alcance (RCF.1.6) —
> sin botón muerto, sin write nuevo.

## Tabla de rate limits (acciones abusables tocadas)

| Acción | Rate limit | Keyeo | Fail-closed | Nota |
|---|---|---|---|---|
| Asignar `idv` (UPDATE local→outbox) | n.a. | — | — | Write local offline-first; no manda email/SMS, no pega API externa, no es bulk. Drena por el outbox existente. Sin superficie de Denial-of-Wallet. |
| Asignar `tag` (encolar RPC 0089) | n.a. (hereda el del RPC preexistente) | per-perfil (tenant server-side) | sí (RLS/RPC) | El diff no agrega ni afloja límites; reusa el plumbing existente. No es endpoint de costo. |

> Ninguna Edge Function nueva, ningún `[auth.rate_limit]` tocado, ninguna operación bulk/import. No aplica
> rate limit adicional a este delta.

## Cobertura indirecta (Deno / RLS / PowerSync)

- **Deno / Edge Functions**: N/A — el diff no toca `supabase/functions/`.
- **RLS / triggers / RPC**: N/A para revisión de cambios — no se modifican; son la barrera preexistente que el
  cliente consume. Su corrección queda fuera de este diff (ya auditada en specs 02/09/11).
- **PowerSync**: la skill de Sentry NO cubre semántica de sync offline ni el modelo de outbox → revisado
  **manualmente**. `buildSetIdvUpdate` filtra `deleted_at IS NULL` y escribe una sola columna (1 CrudEntry
  PATCH); `enqueueAssignTag` no crea overlay (`animals` fuera del sync set, ADR-026). Stale-auth en replay
  (C4) lo cubre `uploadData` server-side al sincronizar. Sin hallazgos.

## Dominios del Catálogo revisados

A1 service-role bypass (n.a. — sin admin-client en el diff), A2 mass-assignment (✅ columna única / params
acotados), A3/A4 IDOR/BFLA (✅ ids del perfil + server deriva tenant), B1 info disclosure (✅ error
client-local), C1-C4 offline/sync (✅ manual), F1 filter injection (✅ bound params), E1 queries sin tope
(✅ LIMIT en lookups, write puntual). Excluidos por no aplicar al diff: B2/B3, D (secrets/supply chain — sin
imports nuevos ni secrets), E2-E4, F2/F3/F4, G (BLE — fuera de alcance RCF.1.6), H, I.

## Conclusión

**PASS — 0 findings HIGH.** Toda escritura está gobernada por RLS/RPC/trigger preexistentes; el frontend usa
ids del perfil (no del contexto activo), queries parametrizadas, columna única por write, e inputs acotados a
dígitos. Superficie exactamente la esperada. Listo para puerta humana (Gate 2 final).
