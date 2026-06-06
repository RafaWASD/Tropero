# Bitácora de redacción — spec 12 (Importación masiva de rodeo)

**Autor**: spec_author. **Fecha**: 2026-06-06 (sesión 23).
**Entregables**: `specs/active/12-import-rodeo/{requirements,design,tasks}.md`. `feature_list.json` feature 12 → `spec_ready`. `check.mjs` verde (EXIT=0, 19 tests user_private + suite completa sin regresión).

## Qué se hizo

Traducción del `context.md` (Gate 0 aprobado por Raf, 2026-06-01) a EARS/design/tasks, SIN reabrir las 3 decisiones lockeadas ni los defaults del leader. 12 requirements (R1-R12, ~50 criterios) + 26 tasks en 7 fases. Trazabilidad de cada "Caso y decisión" del Gate 0 a ≥1 `R<n>` (tabla al pie de `requirements.md`).

Los 7 reforzamientos críticos del leader se hornearon como requirements explícitas (no quedaron solo en prosa de design):
1. Límites de input/anti-DoW → **R3** (tope 5MB / 5000 filas, cap durante el parseo no después, topes de largo por campo que ESPEJAN los CHECK char_length de `0070`).
2. Seguridad del parser → **design §4** + R3.5/R3.6 (MVP = CSV + TXT, `.xlsx` diferido por los CVEs de SheetJS/`xlsx`; cap defensivo antes de materializar; valor parseado = no confiable).
3. Campos forzados server-side → **R9** (establishment_id/imported_by/created_by + rodeo∈establishment; lección A1-1 / `tg_force_created_by_auth_uid` de `0043`).
4. Dedup pre-check contra constraints → **R7** (pre-chequea `animals_tag_unique` + `animal_profiles_idv_unique` en lote con `= any()`, reusa detección blanda de spec 02 R5.5/R5.6).
5. Categorías post-Tier-2 → **R10.3/R10.5** (catálogo as-built `0059`/`0062`: `novillito`/`novillo`; `category_override = true` desde columna).
6. Reuso de artefactos reales → **R4.5** (`isValidTag`/`normalizeTag` de `app/src/services/ble/parser-rs420.ts`, NO un módulo fantasma) + **R6.2** (tabla de razas de `specs/active/08-export-sigsa/razas-senasa-codigos.md`).
7. Entry point sobre flujos cerrados → **R1.1/R1.2** (cabla sobre Rodeos de spec 02 C1 + onboarding de spec 01, NO reimplementa).

## Verificaciones contra el as-built (para que el implementer no asuma)

- **Helper de rol**: el as-built (`0005`) tiene SOLO `has_role_in(est)` e `is_owner_of(est)`. **No** existe `has_role(role, est)` genérico. La policy de INSERT de `import_log` chequea `veterinarian` con un `exists (select 1 from user_roles ... role='veterinarian' active)` inline (verificado contra `0003`: `user_roles(user_id, establishment_id, role, active)`). Documentado en design §2.2 — no se inventó helper.
- **Catálogo de categorías**: confirmados los 12 `code` de `(bovino, cría)` as-built (`0015` + `0059`), incl. `novillito`/`novillo`. Usé el patrón exacto de resolución `(systemId, code)` de `animals.ts createAnimal`.
- **CHECK char_length** (`0070`): idv/visual/breed/coat ≤ 64, entry_origin ≤ 120, notes ≤ 4000, tag_electronic ≤ 64. R3.4 los espeja en el cliente; R9.5 los declara capa autoritativa.
- **Constraints de unicidad**: `animals_tag_unique` (global, `0019`), `animal_profiles_idv_unique` (`(establishment_id, idv)`, `0020`), `animal_profiles_active_animal_unique` (`0020`).
- **Migrations**: as-built en disco llega a `0072`. Design/tasks proponen `≥ 0073` TBD-al-implementer. NO reclamé números usados.
- **Split insert+select / RLS-on-RETURNING**: confirmado el gotcha en `animals.ts createAnimal` (UUIDs cliente, sin `.insert().select()`). Lo reusé en design §3.1.

## Criterio propio que Raf debería validar en la Puerta 1 (decisiones abiertas, design §9)

1. **`.xlsx` en MVP (D1)** — Recomiendo **NO** soportar `.xlsx` nativo en MVP: CSV + TXT SIGSA solamente. Razón: el parser `.xlsx` (SheetJS/`xlsx`) tuvo CVEs reales (prototype pollution, ReDoS) y es la mayor superficie de Gate 1; un parser CSV inline es trivial y sin dependencias. El enum `import_file_format` YA incluye `xlsx` para agregarlo después sin migrar. Si Raf quiere `.xlsx` en MVP, hay que vetar la librería.
2. **Estrategia de escritura (D2): inserts directos vs RPC bulk** — Recomiendo **inserts directos** (Escenario A) en MVP: reusa todo el patrón ya gateado de `createAnimal`, y el trade-off "animal huérfano si el perfil falla" ya está aceptado en el alta individual. El RPC `SECURITY DEFINER` bulk (Escenario B) da atomicidad por animal pero dispara un Gate 1 pesado (re-validar owner/vet + rodeo∈establishment adentro). **Esta decisión cambia el peso del Gate 1** y si la Fase 2 T2.3/T2.5 aplican.
3. **Categoría placeholder "a completar" (D3)** — Propuse usar la rama por-sexo de `compute_category` (torito/novillito | vaquillona) solo para satisfacer el `NOT NULL`, con `category_override = false`. NO se infiere categoría biológica fina en masa (lo prohíbe el contexto). Si Raf/Facundo prefieren un único code-placeholder neutro, es un ajuste menor.

## TODOs / dependencias (no bloqueantes)

- **Forma real de la planilla del productor**: la auto-detección de headers (R4.1) y los sinónimos de categoría (design §5) son TENTATIVOS hasta ver un archivo real del beta / validar con Facundo. Disclaimer aplicado (patrón R14 spec 02 / UI tentativa spec 09).
- **Catálogo de razas (feature 08)**: NO implementado → la raza importada degrada a `breed` texto libre (R6.1); se migra cuando 08 aterrice. Dependencia documentada, ya resuelta en el contexto.
- **Gate 1**: APLICA en ambos escenarios (acotado en A por `import_log`; pesado en B por el RPC). Correr antes de la Puerta 1.
- **Coordinación de entry point**: cablea sobre Rodeos (spec 02 C1) + onboarding (spec 01) committeados. Si las firmas finales difieren, se adaptan imports (no se duplica nav).

## Estado
- spec_ready. PARÉ. No invoqué implementer. Espera Gate 1 + aprobación humana (Puerta 1).
