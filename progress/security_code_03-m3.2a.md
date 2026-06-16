# security_code — spec 03 (MODO MANIOBRAS) — sub-chunk M3.2a — Gate 2 (ADR-019)

## Veredicto: **PASS**

Frontend puro (3 pantallas de "elegir un valor" + cableado) sobre M3.1 (orquestador gateado) + backend done (0091). Sin findings HIGH-confidence. El cliente NO es la única barrera en ningún punto crítico del foco obligatorio: cada write-path tiene su control server-side verificado (RLS `has_role_in` + 0021 categoría-sistema + 0054 gating fail-closed + CHECK discreto 0028). Todos los SQL builders están parametrizados (sin inyección). check.mjs rojo SOLO por flake de RLS en el setup del suite backend (documentado abajo — NO es finding).

---

## Foco obligatorio — resultado punto por punto

### 1. UPDATE de CUT (dientes → is_cut + category_id + category_override) — ¿IDOR / category_id arbitrario? → CUBIERTO server-side
Trazo del data flow: `DientesStep.pickTeeth` → `onConfirm(teethState, cut)` → `carga.tsx captureAndAdvance` resuelve `cutCategoryId` con `resolveCutCategory(profileId)` (animals.ts:1118, 100% SELECT del catálogo LOCAL por el `system_id` REAL del perfil, code='cut') → `persistManeuverEvent` → `buildManeuverEventQueries` case `dientes` (maneuver-event-query.ts:193) → `buildSetCutUpdate(profileId, catId)` (local-reads.ts:1540) → SQLite local → connector PATCH `table.update(op.opData).eq('id', op.id)`.

- **IDOR**: el UPDATE NO se scopea por establishment en el cliente (`.eq('id', op.id)` solo). La barrera REAL es la RLS `animal_profiles_update` (0022:13-15): `for update using (has_role_in(establishment_id)) with check (has_role_in(establishment_id))`. Un `profileId` de otro tenant → 42501 → `surfaceUploadRejection` (permanent reject, rollback). **El cliente NO es la única barrera.**
- **category_id arbitrario / de otro sistema-tenant**: `buildSetCutUpdate` fija `category_id = ?`. Aunque un cliente forjado mande un id arbitrario, el trigger `tg_animal_profiles_category_check` (0021:46-63, BEFORE INSERT **OR UPDATE**) valida `category_id ∈ categories_by_system WHERE system_id = rodeo.system_id` → 23514 si no cuadra. El catálogo de categorías es GLOBAL keyeado por sistema (no por tenant): la frontera de tenant la pone la RLS de la fila (ya pasada), la de sistema la pone 0021. **Confirmado: no se puede inyectar un category_id de otro sistema; lo rechaza el server (0021), no solo el cliente.**
- **Gating dientes (propiedad)**: `tg_animal_profiles_teeth_gating` (0054:148-171, BEFORE UPDATE OF teeth_state/is_cut/category_id) gatea el cambio ADITIVO (is_cut false→true) contra el data_key `'dientes'` enabled en el rodeo, FAIL-CLOSED (perfil irresoluble → 23514). R7.5 server-side. El gate de cliente (`shouldOfferCutPrompt`) es UX.

### 2. UPDATE de teeth_state — parametrizado, scopeado, sin mass-assignment → OK
`buildSetTeethStateUpdate` (local-reads.ts:1523): `UPDATE animal_profiles SET teeth_state = ? WHERE id = ? AND deleted_at IS NULL`, args `[teethState, profileId]`. Parametrizado. El PATCH sube SOLO `{teeth_state}` (PowerSync captura únicamente la columna cambiada del statement local) → sin over-posting de `establishment_id`/`category_id`/`created_by`. Server: RLS `has_role_in` + 0054 gating (additive teeth_state→no-NULL → requiere `dientes`, fail-closed).

### 3. Inputs — condición corporal + heifer_fitness → CON cota autoritativa server-side
- **Condición corporal**: el stepper cliente (`condition-stepper.ts`) clampa/snapea a 1,00–5,00 step 0,25 — esto es **UX (attacker-controlled, bypasseable)**. La cota AUTORITATIVA es server-side: `condition_score_events.score numeric(3,2) NOT NULL CHECK (score IN (1.00,1.25,…,5.00))` (0028:8-10) — whitelist discreta. Un valor fuera de grilla pegado directo al endpoint → 23514 reject. INSERT scopeado por `has_role_in(establishment_of_profile(...))` (0028:30); `created_by` lo fuerza el trigger `tg_set_created_by_auth_uid` (0028:22-24, no del cliente); gating `condicion_corporal` por 0054. **El valor escrito está validado server-side, no solo en el stepper.**
- **heifer_fitness**: `TactoVaquillonaStep` emite `'apta'|'no_apta'|'diferida'` (selector cerrado, tipo `HeiferFitness`). Persiste vía `buildAddManeuverTactoVaquillonaInsert` en `reproductive_events` con `heifer_fitness` enum cerrado (0053, write-path M3.1). Enum server-side = barrera real.

### 4. CUT-trigger derivado de single-source (`CUT_PROMPT_TEETH`) → OK (cliente decide UX, server decide seguridad)
`teeth-options.ts:33-40` DERIVA `cutTrigger` de `CUT_PROMPT_TEETH.has(...)` (maneuver-applicability.ts:74) — único set del umbral. `shouldOfferCutPrompt` (maneuver-applicability.ts:86) es predicado PURO de cliente (UX: muestra/no muestra el prompt, no-terneros). La barrera real de "no escribir CUT prohibido" es 0054 (gating server-side por rodeo). El prompt NO auto-persiste: requiere toque explícito en el sheet (`onMarkCut`/`onJustTeeth`).

### 5. Multi-tenant / secrets → OK
- Sin cross-tenant: todo profileId viene del contexto de la manga (`params.profileId` → `fetchAnimalDetail`, ya scopeado por la stream `est_animal_profiles` con `has_role_in`); los writes RLS-gateados por fila.
- Cero hardcode: anti-hardcode lint = **0 violaciones** en app/app + components. `$amber`/`$amberPress`/`$stepperBtn` son tokens (tamagui.config.ts), no literales. NUNCA se hardcodea establishment_id / system_id / category UUID (todo resuelto por `code` del catálogo local).
- Sin secrets en el diff. `surfaceUploadRejection` (connector.ts:164) loguea SOLO `{table, op, code}` — explícitamente NO `opData` (evita filtrar dato de campo / PII en logs). Sin `console.log` de secrets.

---

## Findings HIGH de Sentry (skill `sentry-skills:security-review`)
**Ninguno.** No high-confidence vulnerabilities identified. Categorías evaluadas y descartadas con evidencia:

| Vector | Resultado | Evidencia |
|---|---|---|
| SQL injection (builders locales) | No aplica | Todos los builders usan `?` + `args[]`; `runLocalWrite`/`runLocalQuery` ejecutan `db.execute(sql, args)` parametrizado (local-query.ts:97,51). Cero interpolación de string. |
| IDOR (teeth/CUT UPDATE) | Cubierto server-side | RLS `animal_profiles_update` USING+WITH CHECK `has_role_in` (0022:13-15). |
| Mass-assignment / over-posting | No aplica | El PATCH sube solo las columnas del statement local (teeth_state, o is_cut/category_id/category_override); no spread de input crudo del cliente. |
| category_id injection | Cubierto server-side | 0021 trigger BEFORE INSERT OR UPDATE (0021:46-63), 23514. |
| Info disclosure en logs | No aplica | connector.ts:164 loguea table/op/code, nunca opData. |

## Findings RAFAQ-SPECIFIC
**Ninguno.** Checklist específico verificado:
- RLS de las migrations tocadas (0091 deworming/treatment gating): no cambia el modelo de las 3 pantallas M3.2a (las 3 escriben en tablas con RLS+gating ya probados).
- Edge Functions nuevas: ninguna en M3.2a (frontend puro).
- Triggers nuevos en DB: ninguno en M3.2a (0021/0054/0028 son preexistentes, verificados como barrera).
- Secrets hardcodeados: ninguno.
- Inputs sin cota server-side: ninguno (ver tabla de inputs).
- Rate limiting: n.a. (sin acción abusable nueva — ver tabla).

## False positives descartados (trazabilidad)
- **`.eq('id', op.id)` sin filtro de tenant en el PATCH (connector.ts:83)**: parece IDOR, pero NO lo es — la RLS UPDATE (`has_role_in` USING+WITH CHECK) es el control de tenant; el `.eq('id')` solo identifica la fila. Es el patrón de PowerSync intencional (R6.2: "RLS + triggers + CHECKs siguen aplicando"). Fuera de scope M3.2a además (connector es contexto).
- **`shouldOfferCutPrompt` fail-OPEN con categoryCode null (maneuver-applicability.ts:90)**: parece bypass del gate no-terneros, pero es UX: el peor caso es OFRECER el prompt (el operario debe confirmar; no auto-marca CUT) y el server gatea el write por rodeo, no por categoría. Coherente con R6.8 (gate de UI). No explotable a dato no autorizado.
- **`resolveCutCategory` resuelve del catálogo local (animals.ts:1118)**: no spoofeable — resuelve por el `system_id` REAL del perfil; un id forjado igual lo rechaza 0021. Fail-safe: sin id → `cutCategoryId=null` → el orquestador OMITE el write de CUT (maneuver-event-query.ts:201, `if (value.cut && catId)`), solo setea teeth_state.

---

## Tabla de inputs (campos que el usuario "tipea"/elige en M3.2a)
| Campo | Límite | Validación | OK? |
|---|---|---|---|
| heifer_fitness (tacto vaquillona) | enum cerrado `apta\|no_apta\|diferida` (3 bloques, no es texto libre) | server: enum `heifer_fitness` (0053) | ✅ |
| condition score (stepper) | 1,00–5,00 step 0,25 (stepper, no texto libre) | **server: CHECK discreto numeric(3,2) IN (1.00..5.00) (0028:8-10)**; cliente = UX | ✅ |
| teeth_state (dientes) | 8 valores del enum (bloques, no texto libre) | server: enum `teeth_state_enum` (0020) + gating `dientes` (0054) | ✅ |
| CUT (sheet) | binario marcar/no (no texto libre) | server: gating additive is_cut (0054) + categoría 0021 | ✅ |

Ningún campo de M3.2a es texto libre — son selectores cerrados / stepper acotado. Cada uno tiene cota autoritativa server-side (enum o CHECK), no solo cliente.

## Tabla de rate limits
| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| UPDATE teeth_state / CUT, INSERT condition_score / vaquillona | n.a. | — | — | Escrituras CRUD-plano offline (PowerSync) sobre datos propios del tenant, gateadas por RLS+gating per-row. No son email/SMS, ni API externa, ni bulk/fan-out. M3.2a no agrega acción abusable; no aplica rate limit. |

---

## Archivos analizados (scope M3.2a)
- `app/app/maniobra/_components/TactoVaquillonaStep.tsx`
- `app/app/maniobra/_components/CondicionCorporalStep.tsx`
- `app/app/maniobra/_components/DientesStep.tsx`
- `app/app/maniobra/carga.tsx` (dispatcher + `captureAndAdvance` resolución de cutCategoryId)
- `app/src/utils/condition-stepper.ts`
- `app/src/utils/teeth-options.ts`
- `app/src/utils/maneuver-applicability.ts` (`CUT_PROMPT_TEETH`, `shouldOfferCutPrompt`)
- `app/src/utils/maneuver-event-query.ts` (case `dientes`)
- `app/src/services/animals.ts` (`resolveCutCategory`, `resolveRevertCategory`)
- `app/src/services/powersync/local-reads.ts` (`buildSetTeethStateUpdate`, `buildSetCutUpdate`, `buildUnsetCutUpdate`, `buildCategoryIdByCodeQuery`)
- CONTEXTO de exploitability (no scope de findings nuevos): `connector.ts`, `local-query.ts`, migraciones 0022 (RLS), 0021 (categoría), 0054 (gating), 0028 (CHECK score).

## Cobertura indirecta (Deno / RLS / PowerSync / RN)
- **RLS / triggers PG / PowerSync upload**: la skill de Sentry NO cubre directamente RLS de Supabase ni el modelo de upload de PowerSync — revisión MANUAL hecha y documentada arriba (0022/0021/0054/0028 + connector PATCH). El control de tenant/categoría/gating vive 100% server-side y está verificado.
- **Deno / Edge Functions**: n.a. (M3.2a no toca Edge Functions).
- **React Native**: las 3 pantallas son render puro (sin webview, sin `dangerouslySetInnerHTML`, sin deep-link nuevo) → sin superficie XSS/inyección de cliente.

## check.mjs (estado real)
RC=1 **por FLAKE conocido**, NO por findings: typecheck client **OK**, anti-hardcode **0 violaciones**, client unit (incl. `condition-stepper`, `teeth-options`, `maneuver-applicability`, `maneuver-event-query`, `local-reads`) en verde. El único rojo es el suite backend `supabase/tests/maneuvers/run.cjs` T2.11, que falla en el **setup** (`createRodeo insert(Rodeo sin dientes): new row violates row-level security policy for table "rodeos"`) — firma del flake de auth/RLS por terminales concurrentes sobre la DB remota compartida (memoria `reference_check_red_rate_limit`). Falla ANTES de llegar a la aserción de teeth/CUT (en la creación del fixture), no es una regresión del código M3.2a. Per instrucción del leader: flake/spec-12 NO son findings.

## NO marco done
Reporte de Gate 2 entregado. La decisión final (cierre/done) es del leader + Raf.
