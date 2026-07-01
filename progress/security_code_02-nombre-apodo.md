# security_code — Delta #2 NOMBRE/APODO (spec 02) — Gate 2 modo `code`

**Veredicto: PASS**

baseline_commit: `fd5c7e2` · diff = working tree sin commitear (rama `main`, sin feature-branch).
Skill corrida: `sentry-skills:security-review` sobre el diff. Complemento: checklist RAFAQ + catálogo A/B/C/F.
Migración `0119` YA aplicada al remoto (leader) — se audita el SQL as-built.

---

## Findings HIGH

**Ninguno.** No high-confidence vulnerabilities identified.

El delta es de superficie mínima: un INSERT de catálogo per-est deshabilitado, la remoción de un input del alta, y migración de fills e2e (test-only). Ningún cambio abre RLS, instala trigger, agrega RPC, relaja validación, ni crea camino de escritura nuevo.

## Findings RAFAQ-SPECIFIC

**Ninguno.**

## False positives descartados (skill + verificación manual)

- **`run.cjs` usa `admin.from(...)` (service_role → RLS bypass)**: es un archivo de TEST (`supabase/tests/custom/run.cjs`), scoped a la fixture `estA`. La skill excluye test files; el service-role acá es setup de fixture, no superficie de producto. No aplica el criterio A1 (que es para Edge Functions de producción). Descartado.
- **Migración inserta `active: true`**: verificado que `active=true` a nivel `field_definitions` NO renderiza el campo. El render exige `cfg.enabled = 1` desde `rodeo_data_config`/`pending_rodeo_data_config` (`buildEnabledCustomFieldsQuery`, `local-reads.ts:1995`). El seed no toca `rodeo_data_config` ni `system_default_fields` → ningún rodeo lo tiene enabled sin opt-in explícito del owner. `active=true` = "no archivado", no "habilitado". Descartado.

---

## Auditoría de los 4 focos del scope

**1. El seed no abre superficie (`0119_seed_apodo_field_definition.sql`)**
- (a) `on conflict (establishment_id, data_key) where establishment_id is not null and deleted_at is null` (L38) — reproduce EXACTO el predicado del índice parcial vigente `field_definitions_data_key_per_est` (0101:41-42). Sin el `and deleted_at is null` Postgres no infiere el índice-árbitro y aborta con `42P10` (no es security, pero rompe). Presente. ✓
- (b) NO instala trigger: la migración es solo `insert ... select` + `notify pgrst` (L26-41). Sin `create trigger`/`create function`. ✓
- (c) NO habilita nada: no toca `system_default_fields` ni `rodeo_data_config`. El seed de rodeos nuevos (`tg_rodeos_seed_data_config`, 0018) solo pre-puebla los `system_default_fields` (globales `establishment_id IS NULL`) → no alcanza al apodo. ✓
- (d) cada fila lleva `e.id` real de `establishments` (L29) — establishment_id no-NULL por fila, sin hardcode ni NULL global → sin fuga cross-tenant. ✓
- Corre por service_role en migración (`auth.uid()` NULL) → `tg_field_definitions_custom_guard` (0093:87-88) hace `return new`. Correcto y esperado. ✓

**2. Cross-tenant del "apodo"** — un tenant NO puede ver/cargar el apodo de otro:
- SELECT en `field_definitions` (0093:161-165): filas custom (`establishment_id not null`) visibles solo con `has_role_in(establishment_id)`. Tenant B ni siquiera SELECTea la fila apodo de tenant A. El seed NO toca esta policy. ✓
- El valor (`custom_attributes`): RLS `has_role_in(establishment_id)` (0095:47-52) + `establishment_id` forzado server-side desde el perfil (`establishment_of_profile`, 0095:37) → anti-spoof. ✓
- Gating por rodeo del animal: `assert_custom_field_enabled` (0096:18-36) resuelve el rodeo desde `animal_profiles` y exige `rodeo_data_config.enabled = true` — FAIL-CLOSED (rodeo no resoluble → 23514). El seed no toca esto. ✓

**3. Remoción del built-in (frontend, `crear-animal.tsx`)** — sin relajar validación de identificador:
- `hasAtLeastOneIdentifier(tag, idv, visual)` sin cambios (helper `animal-form.ts` no tocado por el diff; verificado). ✓
- Remover el input editable "Nombre / seña" hace el alta-en-blanco MÁS ESTRICTA (ya no se puede satisfacer "al menos un identificador" tipeando texto libre) — no la relaja. ✓
- `visual` pasó de `useState` a `const` derivado read-only (L154), poblado SOLO por `prefillKind === 'visual'` (camino find-or-create-por-texto, spec 09; identificador ya comprometido upstream). Sin nuevo camino de escritura. ✓
- La columna `visual_id_alt` persiste con su RLS intacta; el mensaje de validación (L541) solo enumera los identificadores editables vigentes. ✓

**4. Fills e2e migrados (4 archivos + capture)** — test-only, sin tocar código de app:
- `animals.spec.ts`, `maniobra-custom-render.spec.ts`, `maniobra-identify.spec.ts`, `sigsa-breed-renspa.spec.ts`, `captures/nombre-apodo.capture.ts` — todos bajo `app/e2e/`. Diff-stat = solo fills de test (idv en vez del built-in) + oráculos server. Sin cambio en `app/app` ni `app/src`. Sin implicancia de seguridad de producto. ✓

---

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| "Nombre / seña" (`visual_id_alt`) editable en alta | — | **REMOVIDO** del alta (ya no es input de usuario) | ✓ (superficie eliminada) |
| "apodo" (custom_attribute, reemplazo) | `octet_length(value::text) < 4096` (CHECK DB, 0095:27) | server-side autoritativa: `assert_custom_value_valid` exige `jsonb_typeof='string'` para `ui_component='text'` (0096:70-72); número → 23514 | ✓ |
| `visual` (read-only prefill) | n.a. (no editable; viene del buscador spec 09, ya comprometido) | no muta desde el alta | ✓ |

Nota: el reemplazo (apodo custom) tiene control server-side MÁS fuerte que el built-in removido (que solo tenía sanitize client-side UX). El cap 4096 B es generoso pero es una cota DB real anti storage-exhaustion + type-check server-side. Cumple el requisito "límite claro + validación autoritativa server-side por campo".

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Seed `0119` (INSERT catálogo) | n.a. | n.a. | n.a. | one-shot de migración por el leader; no es endpoint |
| Escritura de apodo (`custom_attributes` upsert) | n.a. | n.a. | n.a. | write PostgREST autenticado gateado por RLS + triggers; no manda email/SMS, no pega a API externa, no es bulk. Sin superficie de abuso a escala nueva |
| Alta de animal | n.a. (sin cambio) | n.a. | n.a. | el delta solo REMUEVE un input; no agrega acción abusable |

Ninguna acción del diff manda email/SMS, pega a API externa, ni es bulk/import → no requiere rate limit propio. Sin cambios a `[auth.rate_limit]` de `config.toml`.

---

## Archivos analizados

- `supabase/migrations/0119_seed_apodo_field_definition.sql` (seed as-built)
- `supabase/tests/custom/run.cjs` (subtest `(p)`, test-only)
- `app/app/crear-animal.tsx` (remoción del built-in)
- `app/e2e/{animals,maniobra-custom-render,maniobra-identify,sigsa-breed-renspa}.spec.ts` + `app/e2e/captures/nombre-apodo.capture.ts` (test-only)
- Contexto (sin cambio, para trazar data flow): `0093_field_definitions_custom.sql` (RLS + guard), `0095_custom_attributes.sql` (RLS + CHECK 4096 + audit), `0096_custom_gating.sql` (assert_custom_field_enabled / assert_custom_value_valid fail-closed), `0101_field_definitions_data_key_partial.sql` (índice parcial), `app/src/services/powersync/local-reads.ts` (`buildEnabledCustomFieldsQuery`), `app/src/utils/animal-form.ts` (`hasAtLeastOneIdentifier`, sin cambio).

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: no aplica — el delta no toca `supabase/functions/*`.
- **RLS**: la skill Sentry no razona RLS de Postgres; cubierto por revisión manual arriba (foco 1-2). El seed no crea/modifica policies; el aislamiento per-tenant lo dan las policies preexistentes (0093/0095) sobre las que el seed inserta filas ya scopeadas por `establishment_id`.
- **PowerSync / streams**: el apodo fluye por el patrón custom existente (`est_field_definitions_custom` per-tenant + `custom_attributes`); el seed no crea camino de sync nuevo. Sin regla de sync nueva que auditar.
- **BLE**: no aplica.

## Dominios del catálogo revisados / excluidos

- Revisados: A1 (service-role — solo en test, descartado), A2 (mass assignment — el seed arma columnas explícitas, `custom_attributes` fuerza `establishment_id`/`updated_by` server-side), A3 (IDOR por FK — gating resuelve rodeo desde el perfil), B1/B3 (info disclosure — sin cambio de respuestas al cliente), F1 (filter injection — el apodo no se concatena en `.or()/.filter()`; el valor es string tipado server-side).
- Excluidos: C (offline/sync — sin camino nuevo), D (secrets/supply-chain — sin imports/env nuevos), E (abuso a escala — sin endpoint costoso/bulk nuevo), F2/F3 (import/SSRF — no aplica), G (BLE — no tocado), H/I (auth/compliance — sin cambio).
