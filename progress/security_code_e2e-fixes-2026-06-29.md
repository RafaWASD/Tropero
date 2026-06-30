# Security Gate (Gate 2, ADR-019) — e2e-fixes-2026-06-29

**Modo**: `code`
**Baseline**: `7d43b4d` (working-tree diff: `git diff 7d43b4d`)
**Skill**: `sentry-skills:security-review` corrida + checklist RAFAQ.

## Veredicto: PASS — 0 HIGH

Cambio acotado: arreglos de 10 fallas E2E tras la 1ra corrida en vivo de 4 deltas. Un fix de
producto en un service ya gobernado por RLS + trigger de audit, + arreglos de archivos e2e + un
test de regresión + 1 línea de reconciliación de spec + re-render de PNGs de diseño. **Frontend
puro — `git diff 7d43b4d -- supabase/` vacío (verificado).** No toca migrations, RLS, Edge
Functions, ni `config.toml`.

## Superficie de seguridad del fix de producto

El cambio sustantivo reemplaza la decisión UPDATE-vs-INSERT por `rowsAffected` (no confiable sobre
la VIEW de PowerSync vía INSTEAD OF trigger) por un SELECT de existencia determinista sobre el id
sintético. Es **una lectura local más + reorden de control de flujo** — no agrega superficie de
red, no cambia el contrato de upload, no toca el modelo de audit/RLS.

### 1. SQL injection en el nuevo SELECT — DESCARTADO

`buildCustomAttributeExistsQuery` (`app/src/services/powersync/local-reads.ts:1893-1901`):

```
sql: 'SELECT 1 AS one FROM custom_attributes WHERE id = ? LIMIT 1',
args: [customAttributeSyntheticId(profileId, fieldDefinitionId)],
```

- Query **parametrizada** con placeholder `?`; el id sintético va como bind arg, NO interpolado en
  el string SQL. `customAttributeSyntheticId` (`local-reads.ts:1857-1859`) arma
  `` `${profileId}:${fieldDefinitionId}` `` con template literal, pero el resultado se liga por
  parámetro → aunque `profileId`/`fieldDefinitionId` trajeran caracteres SQL, no hay vector de
  inyección.
- **Solo lee** (`SELECT 1 ... LIMIT 1`), no muta. View-safe.
- La SQLite local solo contiene filas sincronizadas para el establishment del usuario (sync rules
  de PowerSync) → el SELECT es tenant-scoped por construcción.

### 2. Mass-assignment / IDOR en el path INSERT/UPDATE — DESCARTADO

`setCustomAttribute` (`app/src/services/custom-attributes.ts:59-94`):

- **Audit forzado server-side intacto.** El INSERT (`local-reads.ts:1876-1881`) manda solo
  `(id, animal_profile_id, field_definition_id, value)`; el UPDATE (`local-reads.ts:1914-1917`)
  setea solo `value`. `updated_by` (=auth.uid()), `establishment_id` (=del PERFIL, anti-spoof) y
  `updated_at` los FUERZA el trigger 0095 en INSERT *y* UPDATE → el write local NUNCA los manda.
  Sin mass-assignment de campos de audit/tenant.
- **Sin IDOR nuevo.** El id sintético es `animal_profile_id:field_definition_id`, scopeado por el
  perfil. La decisión existencia → UPDATE/INSERT no cambia a qué fila se escribe; solo cómo se
  elige la rama. La barrera al subir es la RLS owner-only + el trigger anti-spoof (establishment_id
  derivado del perfil) — **sin cambios por este diff**. Un INSERT local crafteado para un perfil de
  otro tenant lo rechaza la RLS en el upload, como antes.
- **Information disclosure (B1) — N/A.** Los `error.message` que propaga `setCustomAttribute` son
  errores de SQLite LOCAL devueltos en el `ServiceResult` interno de la app, no respuestas de
  servidor reenviadas a otro cliente. No es el patrón "`err.message` crudo del server al cliente".

### 3. Secretos/credenciales en archivos e2e — DESCARTADO

`app/e2e/animals.spec.ts` y `app/e2e/maniobra-sanitaria.spec.ts`: los cambios son (a) truncar
labels visuales de test a ≤4 chars de sufijo (el form aplica `VISUAL_MAX_LENGTH=30` vía
`sanitizeVisualInput` — el sanitizer recorta al tipear, dato de UX consistente con convenciones
RAFAQ); (b) `categoryOverride: true` en el seed (alinea el setup con la corrección #1b RAR.6); (c)
selectores `.filter({ visible: true })` para desambiguar filas montadas-ocultas bajo overlay.
**Ningún secreto, token ni credencial nueva.** No se agregó ningún `console.log`.

## Checklist RAFAQ-específico

| Dominio | Resultado |
|---|---|
| RLS (policies nuevas/modificadas) | N/A — supabase/ sin cambios |
| Edge Functions (`auth.uid()` + `has_role_in()`) | N/A — ninguna tocada |
| `createAdminClient()` / service-role bypass | N/A — ninguna query admin tocada |
| Triggers DB / SECURITY DEFINER | N/A — sin migrations; audit 0095 intacto, write local no manda audit |
| Mass assignment (`.insert(body)`/`.update(body)` spread) | OK — INSERT/UPDATE con columnas whitelisteadas explícitas, sin spread |
| IDOR por FK / id sintético | OK — id = perfil:field, scopeado; RLS+trigger al subir sin cambios |
| Secrets hardcodeados / `console.log` | OK — ninguno |
| Información disclosure (`err.message` al cliente) | N/A — errores SQLite locales, no respuesta server-a-cliente |
| Validación de inputs (límite + server-side) | Sin campos nuevos; `value` lo re-valida 0096 al subir (sin cambios) |
| Rate limiting | N/A — sin acción abusable nueva (write local offline → upload queue gobernada por RLS) |
| Offline/sync (C) — sync rules / data-at-rest | Sin cambios en sync rules; solo se agrega 1 lectura local |
| BLE (G) | N/A — no tocado |

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| (ninguno nuevo/modificado en el diff) | — | — | — |

El fix reordea control de flujo sobre inputs YA existentes (`animalProfileId`, `fieldDefinitionId`,
`value`). `value` se re-valida server-side al subir (constraint 0096), sin cambios.

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| (ninguna acción abusable nueva) | n.a. | — | — | write local offline → upload queue bajo RLS; sin endpoint/email/SMS/bulk nuevo |

## False positives descartados

Ninguno reportado por la skill. La superficie (1 SELECT parametrizado local + reorden de ramas
INSERT/UPDATE) no dispara los patrones HIGH del catálogo (injection, mass-assignment, IDOR,
secrets, SSRF, info-disclosure) tras trazar el data flow.

## Archivos analizados

- `app/src/services/custom-attributes.ts` (fix de producto: `setCustomAttribute`)
- `app/src/services/powersync/local-reads.ts` (`buildCustomAttributeExistsQuery` nuevo + comments)
- `app/src/services/powersync/maneuver-reads.test.ts` (test de regresión + helper `setAttr`)
- `app/e2e/animals.spec.ts` (labels truncados + selectores visibles)
- `app/e2e/maniobra-sanitaria.spec.ts` (`categoryOverride` en seed)
- `specs/active/03-modo-maniobras/design.md` (+1 línea, reconciliación)
- `design/**/*.png` (binarios re-renderizados; sin impacto de seguridad)

## Cobertura indirecta (Deno / RLS / PowerSync)

La skill de Sentry no modela RLS de Supabase ni el INSTEAD-OF-trigger de PowerSync. Esos dominios
los cubrí a mano: el modelo de audit/RLS/anti-spoof **no cambió** (sigue forzándose en el trigger
0095; el write local jamás manda audit), y el diff backend está vacío. La única novedad —un SELECT
local parametrizado— no introduce superficie nueva en esos dominios.
