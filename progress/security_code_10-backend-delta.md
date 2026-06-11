# Gate 2 (modo `code`) — Spec 10 Fase 1 backend delta (0084/0085/0086 + suite)

**Veredicto: PASS** — 0 HIGH / 0 MEDIUM nuevos. El SQL real reproduce sin desviación el diseño que Gate 1 aprobó (incl. el delta LIM-2), y el estado DESPLEGADO en el remoto coincide byte a byte con el disco. **Condición de cierre del fold LIM-2 cumplida: el pre-filtro espeja el predicado de `rodeo_check` (0021) LITERAL, sin desviación** (verificado en disco Y en `pg_get_functiondef` del remoto). Anexo LOW abajo.

**Baseline**: `78c18083289f4cebe9a5aae3662352108d2a51a4` (de `progress/impl_10-backend-delta.md`). Diff = 3 migraciones nuevas + suite `operaciones_rodeo` + hook en `run-tests.mjs` + 1 aserción reconciliada en `tests/animal/run.cjs` + docs/specs/progress (fuera de alcance de código).

---

## Foco 1 — Pre-filtro de la propagación ≡ predicado de 0021: CONFIRMADO, sin desviación

Comparación literal:

- `0021_animal_profiles_validations.sql:28-34` (`tg_animal_profiles_rodeo_check`):
  `r.id = new.rodeo_id AND r.establishment_id = new.establishment_id AND r.active = true AND r.deleted_at is null`
- `0084_denormalize_is_castrated.sql:93-99` (pre-filtro de `tg_propagate_is_castrated_to_profiles`):
  `r.id = ap.rodeo_id AND r.establishment_id = ap.establishment_id AND r.active = true AND r.deleted_at is null`

Las 4 condiciones idénticas; única sustitución `new.` → `ap.` (correcta: la propagación no modifica `rodeo_id`/`establishment_id`). **Verificado además en el REMOTO**: `pg_get_functiondef` de ambas funciones coincide con el disco (query read-only por Management API, 2026-06-11). Sin asimetría de contexto: dentro de la cadena de propagación (SECURITY DEFINER), el `rodeo_check` anidado corre con los privilegios del owner igual que el pre-filtro → mismo conjunto evaluado por ambos EXISTS. El conjunto escrito por la versión nueva es **subconjunto** del target de la versión fail-closed (el pre-filtro solo ACHICA — no abre escritura nueva). El `RAISE LOG` (0084:106-107) lleva solo `v_skipped` (count) + `new.id` (UUID que el caller ya conoce); sin establishment_id ajeno, profile ids, caravanas ni nombres; nivel LOG no viaja al cliente con `client_min_messages` default. El test `T-DB.4 pre-filtro espeja rodeo_check` además lo asierta contra el catálogo en cada corrida de la suite (regresión permanente).

## Foco 2 — Análisis de poder del write-through (perfil→animals): SIN ESCALADA

`tg_profile_is_castrated_writethrough` (0084:62-72, SECURITY DEFINER) escribe `animals.is_castrated` cuando un UPDATE del perfil (RLS: `has_role_in(establishment_id)`) lo cambia. Comparado contra `animals_update` (0071): la policy `USING/WITH CHECK` exige `EXISTS (perfil del animal donde has_role_in(ap.establishment_id))` — el caller que pudo UPDATEar su perfil satisface ese EXISTS por ese mismo perfil → **el UPDATE directo a `animals` ya le estaba concedido**. El write-through no escribe nada que 0071 no permita, y solo toca la columna `is_castrated` (no spread, no otras columnas). El efecto sobre el perfil del campo B (animal compartido, ADR-004) es el acceso legítimo as-built documentado en 0071 y en design §4.2 "análisis de poder"; la categoría de B ya era afectada por la castración vía 0064 + `compute_category` (que lee `animals.is_castrated`). El clearing cross-perfil de `future_bull` al castrar es el comportamiento especificado (R12.4, testeado T-DB.6(c)).

## Foco 3 — No-loop: CONFIRMADO (estático + empírico)

Cadena: UPDATE perfil → write-through (guard `IS DISTINCT FROM` en perfil Y en el WHERE de animals) → animals → recompute 0086 (guard `IS NOT DISTINCT FROM`) + propagación (guard + pre-filtro; excluye al originante porque ya tiene el valor) → perfiles restantes → sus write-through encuentran `animals` ya igual → UPDATE de 0 filas → ningún trigger re-dispara → FIN. `apply_auto_transition` toca `category_id` (no escucha write-through ni normalize). Los checks always-on de 0021 son read-only. 0079-force no incluye `is_castrated`. Empírico: T-DB.4(d) — exactamente UNA fila nueva de history tras castrar (sin rebote), con margen de 800ms. Fan-out de la propagación acotado por perfiles-por-animal (unidades) — sin vector de amplificación.

## Foco 4 — Superficie de las 4 funciones nuevas: VERIFICADO EN VIVO

Query read-only al remoto (pg_proc + `has_function_privilege` + `proacl`, 2026-06-11), las 4 nuevas + `tg_animals_apply_castration`:

| función | secdef | search_path | EXECUTE authenticated/anon/public | ACL |
|---|---|---|---|---|
| `tg_force_is_castrated_on_profile_insert` | ✓ | `public` | false/false/false | `{postgres=X/postgres}` |
| `tg_profile_is_castrated_writethrough` | ✓ | `public` | false/false/false | `{postgres=X/postgres}` |
| `tg_propagate_is_castrated_to_profiles` | ✓ | `public` | false/false/false | `{postgres=X/postgres}` |
| `tg_normalize_future_bull` | ✓ | `public` | false/false/false | `{postgres=X/postgres}` |
| `tg_animals_apply_castration` (0086) | ✓ | `public` | false/false/false | `{postgres=X/postgres}` |

Revoke **efectivo** (no solo declarado): ACL solo-owner. Ninguna invocable como RPC (T-DB.10(b) lo asierta contra PostgREST con JWT real). Ninguna recibe parámetros del cliente — derivan de NEW/OLD de la fila ya filtrada por RLS. Todas referencian tablas con `public.` calificado + `search_path=public` → sin hijack. El revoke se emite dentro del mismo `begin/commit` que el `CREATE OR REPLACE` (sin ventana con el default EXECUTE-to-PUBLIC).

## Foco 5 — Columnas nuevas en el wire de sync: OK

`is_castrated`/`future_bull` son columnas de la propia fila per-establishment de `animal_profiles`; `est_animal_profiles` ya scopea por establishment (ADR-025). El valor de `is_castrated` refleja un hecho físico del animal global compartido — misma semántica ya aceptada para la identidad denormalizada (0079/ADR-026). Sin dato de otro tenant en el wire.

## Foco 6 — Reemplazo de `tg_animals_apply_castration` (0086): CONSERVA TODO

Diff funcional contra 0064 = SOLO el guard (`if not (old=false and new=true)` → `if new IS NOT DISTINCT FROM old`). Conserva: perfil-activo-único (`status='active' and deleted_at is null limit 1`, unique parcial 0020), respeto de override (`v_override is null or true → return`), delegación a `compute_category`/`apply_auto_transition` (revocadas de clientes, 0042/0065). Deriva de `NEW.id` de la fila real que la RLS de `animals` ya filtró — sin camino cross-tenant nuevo. El trigger `animals_apply_castration` NO se re-creó (verificado en `pg_get_triggerdef`: definición 0064 intacta, enabled). El guard dirección-agnóstico no amplía QUIÉN dispara nada — solo agrega la dirección true→false al MISMO caller que ya podía la otra.

## Foco 7 — Inputs / validación: sin superficie nueva de entrada

Ningún campo de texto/form/buscador/prompt nuevo. Las dos columnas son `boolean NOT NULL DEFAULT false` (type-constrained en DB = validación autoritativa); `future_bull` con normalize fail-safe a false (server-side); `is_castrated` con force-INSERT anti-spoof (nace fiel a `animals`, testeado T-DB.4(b) con payload mentiroso).

---

## Findings HIGH de la skill `sentry-skills:security-review`

Ninguno. "No high-confidence vulnerabilities identified."

## Findings RAFAQ-SPECIFIC

Ninguno HIGH/MEDIUM.

## False positives descartados (trazabilidad)

1. **"UPDATE cross-tenant en SECURITY DEFINER" (propagación, 0084:89-99)**: patrón que la metodología marca para investigar. Descartado como escalada: equivalencia de poder con 0071 (foco 2), hecho físico del animal global compartido (ADR-004), el efecto en la categoría de B ya existía vía 0064+`compute_category`, y el pre-filtro solo reduce el conjunto. Auditado y aceptado en Gate 1 + Gate 1 puntual + Puerta 1 (Raf).
2. **"Disclosure de `animals.is_castrated` vía force-INSERT" (0084:44-51)**: un user que inserta un perfil referenciando un `animal_id` ajeno recibe el boolean copiado en su fila. Descartado como finding nuevo: superficie PRE-EXISTENTE — 0079 ya copia `tag_electronic`/`sex`/`birth_date` (más sensibles) con el mismo patrón; requiere conocer un UUID inguessable; es el modelo de animal compartido/transferencia as-built. Anexo LOW.
3. **"RAISE LOG con datos de fila"**: payload mínimo (count + UUID propio del caller), server-side only. Validado en foco 1.
4. **"Password hardcodeada en tests" (`run.cjs:74`)**: fixture de usuarios de test descartables en proyecto beta, patrón idéntico a las suites animal/maneuvers; secrets reales vienen de `.env.local` (no commiteado). No es secret.
5. **"recursión de triggers = DoS"**: descartado, foco 3 (guards verificados desplegados + test empírico de no-rebote).

## Tabla de inputs

| campo | límite (tipo/charset/formato) | validación | OK? |
|---|---|---|---|
| `animal_profiles.is_castrated` | `boolean NOT NULL` (DB, autoritativo) | server: tipo + force-INSERT anti-spoof + write-through solo de esta columna | ✓ |
| `animal_profiles.future_bull` | `boolean NOT NULL` (DB, autoritativo) | server: tipo + normalize fail-safe a false (solo machos, auto-clear al castrar) | ✓ |

Sin forms/buscadores/texto libre/prompts nuevos en este delta (es server-side puro; la UI llega en Fases 2-4 y tendrá su propio gate).

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| UPDATE `animal_profiles.is_castrated`/`future_bull` (PostgREST) | n.a. | — | — | Sin endpoint/EF nuevo; sin email/SMS/API externa. Mutaciones por-fila gateadas por RLS, mismas que el CRUD as-built. El fan-out server-side por request es ~perfiles-por-animal (unidades), no un amplificador. |
| Operación masiva (N updates desde el cliente) | n.a. en este delta | — | — | La masiva es Fase 2+ (cliente); son N requests individuales por RLS, sin canal bulk privilegiado (design §5/§8.B). Re-evaluar tope de N/progreso en el gate de la fase cliente. |
| `[auth.rate_limit]` / `config.toml` | sin cambios | — | — | El diff no toca config de Auth. |

## Archivos analizados

- `supabase/migrations/0084_denormalize_is_castrated.sql` (completo)
- `supabase/migrations/0085_future_bull.sql` (completo)
- `supabase/migrations/0086_castration_recompute_symmetric.sql` (completo)
- `supabase/tests/operaciones_rodeo/run.cjs` (completo)
- `scripts/run-tests.mjs`, `supabase/tests/animal/run.cjs` (diffs)
- Referencias: `0021`, `0064`, `0065` (revoke original), `0071`, `0079`; `specs/active/10-operaciones-rodeo/design.md` §4-§6; `progress/security_spec_10-lim2-rechequeo.md`; `progress/impl_10-backend-delta.md`
- Remoto (read-only, Management API): `pg_proc`/`proacl`/`has_function_privilege`, `pg_get_functiondef` (6 funciones), `pg_get_triggerdef` (5 triggers)

## Cobertura indirecta

- La skill de Sentry no tiene guía nativa de plpgsql/RLS/triggers → la cobertura de ese dominio es la revisión manual de este reporte (checklist RAFAQ + verificación en vivo del catálogo), no la skill. Declarado.
- PowerSync sync rules: sin cambios en `rafaq.yaml` (`SELECT *` preexistente toma las columnas). La verificación operativa de re-publish de streams es nota del implementer (design §4.4), no de seguridad. C1 del catálogo queda cubierto por ADR-025/spec 15 as-built.

## Anexo LOW (no bloquea; backlog si se quiere)

- **L4 — Comentario impreciso en 0086:48**: dice "revoke ya emitido en 0064"; fue en `0065_check_grants.sql:20`. Cosmético (el re-emit idempotente es correcto igual).
- **L5 — Disclosure pre-existente vía force-INSERT** (false positive #2): consistente con 0079; si algún día se restringe el alta de perfiles sobre animales ajenos (SPEC-MED-1-adyacente), esto se cierra solo.
- **L1/L2/L3 del Gate 1 puntual LIM-2**: ya en `docs/backlog.md` (race READ COMMITTED fail-safe; `v_skipped` cuenta soft-deleted; perfiles soft-deleted con rodeo vivo se actualizan — pre-existente como 0079). El as-built las reproduce tal como se auditaron; sin cambios de veredicto.

---

Gate 2 cerrado: `PASS`. Queda Puerta 2 (humana, Raf). Reconciliación DOC de spec 02 (RT2.2.6 superseded) sigue leader-owned, ya señalada por el implementer.
