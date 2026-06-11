# Gate 1 PUNTUAL — Spec 10, delta LIM-2 (propagación tolerar-y-saltear)

**Veredicto: PASS** — el pre-filtro espeja fielmente 0021, el poder de escritura no crece, el LOG no filtra cross-tenant, el no-loop sigue intacto y el blast radius está contenido a `tg_propagate_is_castrated_to_profiles`. **0 HIGH / 0 MEDIUM / 3 LOW (anexo).** Habilita la implementación; Gate 2 re-verifica sobre la migración real.

**Alcance**: SOLO el delta de LIM-2 (fold de Puerta 1 2026-06-11) sobre `specs/active/10-operaciones-rodeo/design.md` §4.2(4). El resto de la spec conserva el PASS del 2026-06-11 (no re-auditado).

## Foco 1 — Espejo fiel del predicado de `rodeo_check` (0021): SÍ, sin desviación

- **0021** (`supabase/migrations/0021_animal_profiles_validations.sql:28-34`): `EXISTS (SELECT 1 FROM rodeos r WHERE r.id = new.rodeo_id AND r.establishment_id = new.establishment_id AND r.active = true AND r.deleted_at is null)` — raisea `23514` si NOT EXISTS.
- **Pre-filtro** (design.md §4.2(4), líneas 262-268): `EXISTS (SELECT 1 FROM rodeos r WHERE r.id = ap.rodeo_id AND r.establishment_id = ap.establishment_id AND r.active = true AND r.deleted_at is null)`.

Las 4 condiciones son idénticas. La sustitución `new.` → `ap.` es exacta (el UPDATE de propagación solo escribe `is_castrated`; `rodeo_id`/`establishment_id` no se modifican). Caso borde `rodeo_id` NULL: EXISTS=false en ambos → mismo conjunto. Mismo contexto SECURITY DEFINER → sin asimetría de RLS entre ambos EXISTS. Conjunto que pasa el pre-filtro ≡ conjunto que NO abortaría en `rodeo_check`. Ni más laxo ni más estricto.

## Foco 2 — El skip NO amplía el conjunto de filas escritas: confirmado

Versión nueva escribe {perfiles distintos CON rodeo vivo} = subconjunto estricto o igual del target de la vieja; cada fila escrita pasa individualmente el mismo `rodeo_check`. El delta solo elimina el abort colateral (disponibilidad, no autoridad — LIM-2). El alcance cross-establishment (ADR-004) es pre-existente, ya auditado (equivalencia con `animals_update` 0071); el pre-filtro solo lo ACHICA. Guards `IS DISTINCT FROM` intactos.

## Foco 3 — `RAISE LOG` sin fuga cross-tenant: confirmado

Payload: `v_skipped` (count) + `new.id` (UUID del animal que el caller ya conoce). Sin establishment_id ajeno, sin profile ids, sin caravanas/nombres. `RAISE LOG` va al log del servidor (nivel LOG no viaja al cliente con `client_min_messages` default); el diseño NO superficia skip-report en UI por la razón cross-tenant correcta.

## Foco 4 — No-loop intacto: confirmado

El delta agrega solo construcciones read-only (EXISTS en WHERE, `SELECT count(*)`, `RAISE LOG`). Cadena preservada: perfil → write-through (guard doble `IS DISTINCT FROM`) → animals → 0064/§4.3 + propagación (guard + pre-filtro) → perfiles restantes → write-through encuentra animals ya igual → no-op → FIN. Perfiles salteados no disparan nada. Force de 0079 no escucha `is_castrated`. Cero recursión nueva.

## Foco 5 — Blast radius contenido: confirmado

El fold tocó exclusivamente `tg_propagate_is_castrated_to_profiles` (§4.2(4)) + prosa coherente (§4.2, §6.1, §9 D13, requirements §Limitaciones LIM-2, tasks T-DB.2/T-DB.4(e)/T-G1.2). Ítems 2-7 de §6 sin cambios: write-through idéntico, §4.1/§4.3 intactos, gating/catálogo intactos, wire de sync sin cambios, `SECURITY DEFINER` + `search_path` + `revoke execute` conservados (líneas 255, 280). LIM-1 (§3.5 observación) es client-side puro sobre 0034 — cero superficie server nueva.

## Anexo LOW (backlog, no bloquea)

- **L1 — Race READ COMMITTED pre-filtro vs re-check**: si un rodeo se desactiva concurrentemente entre el scan del UPDATE y el BEFORE `rodeo_check`, la cadena puede abortar igual (fail-closed, comportamiento viejo ya auditado, visible vía R10.3). Dirección fail-safe. Sin acción.
- **L2 — `v_skipped` puede contar perfiles soft-deleted del animal**: ni el UPDATE ni el count filtran `ap.deleted_at` (coherente con la versión vieja y 0079(3)). Exactitud cosmética del log; opcional anotar "incluye soft-deleted".
- **L3 — Perfiles soft-deleted con rodeo vivo SÍ se actualizan**: pre-existente (idéntico a 0079 y a la versión auditada). Defendible. Sin acción.

## Trazabilidad

- **Dominios revisados**: RLS/authz de triggers SECURITY DEFINER, information disclosure en logs, multi-tenant isolation en propagación cross-establishment, no-loop/recursión, blast radius.
- **Excluidos** (el delta no los toca): inputs/forms, rate limiting, Edge Functions, sync/PowerSync, BLE. Tablas de inputs y rate limits: n.a. para este delta (función de trigger server-side sin parámetros del cliente).
- **Archivos**: `specs/active/10-operaciones-rodeo/design.md` (§4, §6, §9), `requirements.md`, `tasks.md` (T-DB.2/T-DB.4/T-G1.2), `supabase/migrations/0021`, `0064`, `0079`.

---

`PASS`. Gate 2 sobre la migración real (al implementar T-DB.2) verifica que el SQL final reproduzca este predicado literal.
