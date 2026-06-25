# impl 08 — T7 PowerSync config (schema local + sync streams)

> ⚠️ El run del implementer se cortó por un error de API (conexión cerrada) ANTES de escribir su
> bitácora. Esta la reconstruyó el LEADER verificando el as-built de los archivos (el clasificador de
> seguridad estaba caído en ese run → verificación manual del leader, ver más abajo).

## Scope (T7 — cubre R1.8, R14.2, R14.3, R15.1)
- `app/src/services/powersync/schema.ts` — schema local de PowerSync.
- `sync-streams/rafaq.yaml` — sync streams (NO deployado; lo deploya Raf en el dashboard).
- `app/src/services/powersync/schema.test.ts` — cobertura del schema local.

## As-built verificado por el leader

### schema.ts
- `animal_profiles`: + `breed_id: column.text` (columna nueva de 0108; baja por est_animal_profiles SELECT *).
- 3 tablas nuevas, columnas 1:1 con las migraciones:
  - `breed_catalog` (0107): senasa_code, name, species, active(int), sort_order(int), created_at.
  - `sigsa_declarations` (0111): establishment_id, animal_profile_id, declared_at, export_log_id, declared_by, created_at.
  - `export_log` (0112): establishment_id, generated_at, generated_by, animal_count(int), file_name, file_content, rodeo_filter_id, date_from, date_to, created_at.
- Las 3 registradas en `new Schema({...})`.

### rafaq.yaml (3 streams nuevos, patrón V3 JOIN-FREE)
- `catalog_breed`: GLOBAL read-only (sin `with:`, como catalog_species). **`SELECT * FROM breed_catalog`** — sincroniza TODO (sin `WHERE active=true`): 32 filas trivial, y evita el edge F6 (un breed_id de raza inactiva igual resuelve su nombre/código en el cliente).
- `sigsa_declarations`: `org_scope` + `WHERE establishment_id IN org_scope`. Sin filtro deleted_at (append-only, no existe la columna).
- `sigsa_export_log`: `org_scope` + `WHERE establishment_id IN org_scope`. **CONTROL DE SEGURIDAD CRÍTICO**: `file_content` (TXT con todos los RFIDs) acotado al `org_scope` estándar, NUNCA más amplio → no fuga cross-tenant. Mismo scope que las demás per-establishment.

## ⚠️ Deploy de sync rules = ACCIÓN DE RAF (no desde el repo)
El `rafaq.yaml` NO se deploya desde el repo (línea 5 del archivo): hay que pegarlo en el dashboard de
PowerSync → Validate → Deploy. ⚠️ Solo deployar DESPUÉS de las migraciones 0107/0111/0112 (ya aplicadas).
Hasta el deploy, las 3 tablas nuevas NO bajan al SQLite local → el servicio (T11) puede construirse y
unit-testearse, pero el E2E offline se verifica recién post-deploy. Gate 2 revisa el scope ANTES del deploy.

## Verificación (leader)
- Columnas del schema local ↔ migraciones: match 1:1 (verificado).
- Scope de los 3 streams ↔ patrón del repo: correcto (global / org_scope / org_scope).
- `node scripts/check.mjs`: ver corrida del leader (typecheck + schema.test.ts + suites remotas, sin regresión).
- NO se deployó el YAML.

## Pendiente del chunk
- Gate 2 (security_analyzer modo code) sobre los 3 streams — foco en el scope de `file_content`.
