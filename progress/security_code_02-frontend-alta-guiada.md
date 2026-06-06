# Gate 2 (security code) — alta guiada A+B — **PASS**

**Fecha**: 2026-06-05
**Feature**: rediseño frontend "alta guiada" (wizard rodeo→sexo→categoría→datos por categoría), sub-chunks A+B.
**Modo**: `code` (revisión del código del set alta-guiada; no toca schema/RLS/Edge → sin Gate 1).
**Veredicto**: **PASS** — sin vulnerabilidades HIGH-confidence. Apto para la puerta humana de código.

> Nota de método: se verificó el **sustrato server** (RLS + triggers + CHECK) en vez de creerle al implementer.
> La skill `sentry-skills:security-review` no cubre RLS de Postgres / triggers PL/pgSQL → esa parte se validó
> a mano leyendo migraciones (0022 RLS, 0021 triggers de integridad, 0070 CHECK caps).

## Archivos analizados
- `app/src/services/animals.ts` (`fetchSystemCategories`, `createAnimal`)
- `app/app/crear-animal.tsx` (wizard 4 pasos + submit + eventos post-create)
- `app/src/utils/animal-category.ts`, `animal-category-picker.ts`, `animal-category-fields.ts`, `animal-birth-year.ts`
- `app/src/services/events.ts` (`addConditionScore`, `addTacto`)
- Sustrato server: `0022_rls_animals_and_profiles.sql`, `0021_animal_profiles_validations.sql`, `0070_check_text_length_caps.sql`

## Foco 1 — Multi-tenant / IDOR: limpio
- `createAnimal` deriva `establishmentId`/`rodeoId`/`systemId` del contexto activo (`crear-animal.tsx:341,393-396`), nunca hardcodea. Si un cliente forjara un `establishment_id` ajeno, la policy `animal_profiles_insert ... with check (has_role_in(establishment_id))` (`0022:9-11`) lo rechaza server-side. La RLS es la barrera real y el código no la elude.
- Resolución de `category_id` scopeada por `(system_id, code, active)` (`animals.ts:508-514`); el trigger `tg_animal_profiles_category_check` (`0021:46-63`) exige que `category_id` pertenezca al system del rodeo, y `tg_animal_profiles_rodeo_check` (`0021:25-43`) que el rodeo pertenezca al `establishment_id`. Sin camino para crear en rodeo/establishment ajeno.
- `addConditionScore`/`addTacto` insertan con el `profileId` del recién creado (`crear-animal.tsx:427,432,439`); aunque se forjara, el tenant lo deriva la RLS de `condition_score_events`/`reproductive_events` vía `has_role_in(establishment_of_profile(...))`. No inyectable a tenant ajeno.

## Foco 2 — Inputs (gate duro): cada campo con límite + validación autoritativa server-side

| campo | límite (cliente) | validación autoritativa server | OK |
|---|---|---|---|
| caravana electrónica (`tag`) | 15 díg (`sanitizeTagInput`+`isValidTagElectronic`) | CHECK `char_length(tag_electronic)<=64` (`0070:185`) | sí |
| IDV (`idv`) | 20 díg (`sanitizeIdvInput`) | CHECK `idv<=64` (`0070:188`) | sí |
| visual (`visual`) | 30 chars (`VISUAL_MAX_LENGTH`) | CHECK `visual_id_alt<=64` (`0070:190`) | sí |
| año nacimiento | 4 díg + no-futuro + ≥1980 (`validateBirthYear`) | columna `date` (parse falla → rechaza) | sí |
| raza (`breed`) | 40 chars (`BREED_MAX_LENGTH`) | CHECK `breed<=64` (`0070:192`) | sí |
| pelaje (`coatColor`) | 40 chars (`COAT_MAX_LENGTH`) | CHECK `coat_color<=64` (`0070:194`) | sí |
| peso (`entryWeight`) | `parseWeight>0` (`crear-animal.tsx:361-373`) | columna `numeric` | sí |
| dientes/condición/preñez/cría al pie | selectores CERRADOS (`TEETH_OPTIONS`/`CONDITION_SCORES`/`PREGNANCY_OPTIONS`) | enum `teeth_state_enum`, CHECK score (0028), enum pregnancy, boolean `nursing` | sí |

El sanitizador cliente es UX; el cap autoritativo lo da la **migration 0070** (feature 13, aplicada al remoto) que cubre las 4 columnas free-text del alta + el tag. Los selectores cerrados garantizan enums válidos aun pegándole al endpoint. Ningún input sin tope server-side.

## Foco 3 — Inyección: limpio
Las queries nuevas (`fetchSystemCategories`, resolución de categoría) usan `.eq()` con valores parametrizados (`systemId`, `categoryCode`) — sin interpolación en filtros. `searchAnimals` (reusado) mantiene `.ilike(column, pattern)` parametrizado + `escapeIlike` (`animals.ts:317-323,346-348`). No se reintrodujo filter-injection.

## Foco 4 — Eventos post-create: sin hueco
El patrón tolerante (`crear-animal.tsx:446-456`) guarda `createdProfileId`; si un evento falla, el CTA pasa a "Ver la ficha" sin re-crear → evita duplicado. Re-tocar cortocircuita a `router.replace` (`329-336`). El estado "animal creado, evento faltante" no es explotable (solo un dato secundario ausente, sin cruce de tenant ni escalada).

## Foco 5 — Override: data-integrity, no security
`category_override=true` con categoría arbitraria solo afecta la etiqueta del propio animal del usuario, dentro de su tenant — el insert ya está gateado por `has_role_in` + el trigger categoría-pertenece-al-system. Un `field_operator` ya podía setear cualquier categoría válida de su animal. No cruza frontera de tenant → no es finding de security.

## Mass assignment: descartado
`createAnimal` arma `animalPayload`/`profilePayload` campo por campo con allowlist explícita (`animals.ts:538-545,552-580`) — sin `.insert(body)` ni spread de input. `created_by` no se manda (trigger desde `auth.uid()`, 0043); `establishment_id`/`status`/`category_id` derivados o RLS-gated. Sin over-posting.

## False positives descartados
- "RLS es la barrera, el cliente no la fuerza" → confirmado válido (0022 + 0021), no asunción ciega.
- `animals_insert with check (auth.uid() is not null)` permite a cualquier autenticado insertar un `animals` huérfano → por diseño (invisible por RLS hasta que existe perfil; `animals_select` deriva de existencia de perfil). Documentado en `animals.ts:494-501`. No explotable.

## Cobertura / n.a.
PowerSync diferido (C5) → vector offline/sync no aplica aún. BLE no toca el alta (la puerta manual nunca precarga TAG). Rate limiting: escritura autenticada gateada por RLS, sin email/SMS/API-externa/bulk en este diff; las queries de lista/búsqueda ya tienen `.limit()` → n.a.
