baseline_commit: 638679fa61672e884fc75b3ae94a855bf9853642

# impl 03 — M3.0-BACKEND: delta de gating capa 2 para `deworming` + `treatment`

> Chunk del CLIENTE de spec 03 (MODO MANIOBRAS). Es el ÚNICO delta backend del bloque M3:
> extender el trigger `tg_sanitary_events_gating` (0054) para gatear también las 2 maniobras
> sanitarias nuevas — Antiparasitario (`deworming`) y Antibiótico (`treatment`) — fail-closed
> por rodeo real. Toca un trigger de spec 02 → schema-sensitive → **Gate 1 OBLIGATORIO**.

## ⚠️ PENDIENTE DEPLOY (regla dura)
El implementer **NO aplica** la migración a la DB compartida. Solo escribió `.sql` + tests.
El **leader** aplica `0091` vía MCP **tras Gate 1 + autorización explícita de Raf**
(memoria `project_supabase_mcp_write`). Por eso **es ESPERADO** que el test nuevo `T2.4c`
**FALLE** en `check.mjs` mientras `0091` no esté aplicada: el trigger viejo (0054) NO gatea
`deworming`/`treatment` → el INSERT que esperamos RECHAZADO **se acepta** → el assert de
rechazo falla con `actual: null` (error === null = insert OK). **Los N asserts de T2.4c pasan
recién POST-DEPLOY de `0091`.** Verificado: falla por "insert no rechazado" (pre-deploy), NO
por bug del test (ver "Estado de check.mjs" abajo).

## QUÉ SE ENTREGÓ

### T1 — Migración `supabase/migrations/0091_sanitary_gating_deworming_treatment.sql` (NO aplicada)
Número re-confirmado contra el árbol: el último archivo era `0090_sanitary_route_intranasal.sql`
→ `0091` libre. (Las migraciones M5-BACKEND propuestas en design §11 partían de `0090` — stale;
ese rango ya lo ocupó `0090` + ahora `0091`; lo reconcilia M5 cuando lo implementen.)

**Qué gatea y cómo resuelve la OR:**
- **`treatment` (Antibiótico, R6.15)** → `assert_data_keys_enabled(NEW.animal_profile_id, ['antibiotico'])`.
  Single key, EXACTO mismo patrón que `vaccination → ['vacunacion']`.
- **`deworming` (Antiparasitario, R6.13/R6.14)** → **OR pura** vía un helper nuevo
  `assert_any_data_key_enabled(NEW.animal_profile_id, ['antiparasitario_interno','antiparasitario_externo'])`.
  - **D10 CERRADO (Raf 2026-06-14): NO se distingue interno/externo** de forma estructurada/queryable;
    con que el rodeo real tenga **AL MENOS UNO** de los dos data_keys enabled, el INSERT pasa. La vía
    (si se quiere anotar) va como texto libre en `product_name`/notas, NO como `route` ni columna nueva.
  - **Por qué un helper nuevo y no `assert_data_keys_enabled`**: el helper existente (0054) exige que
    **TODOS** los data_keys del array estén enabled (`v_have = v_need`, semántica AND). Pasarle
    `['antiparasitario_interno','antiparasitario_externo']` exigiría AMBOS → incorrecto para la OR.
    `assert_any_data_key_enabled` es su hermano fail-closed: mismo cuerpo (resuelve rodeo inline del
    perfil ACTIVO, fail-closed si `v_rodeo IS NULL`), pero rechaza solo si `v_have < 1` (ninguno enabled).
    Con uno → `v_have=1` pasa; con ambos → `v_have=2` pasa; con ninguno → `v_have=0 < 1` rechaza con `23514`.
- **Rama `vaccination` EXACTA** a 0054 (no se alteró el gating existente). `test`/`other` NO se gatean.
- **No se agregó data_key nueva**; **no se ramifica por `route`** (D10). Solo `CREATE OR REPLACE` de la
  función del trigger `tg_sanitary_events_gating` (el trigger `sanitary_events_gating` ya existe de 0054
  → NO se redefine, el replace de la función basta). No toca el gating de las otras tablas.
- **Seguridad**: ambas funciones SECURITY DEFINER + `search_path = public` + EXECUTE revocado de
  public/authenticated/anon (R11.4, SEC-HIGH-01). Ninguna es RPC.

### T2 — Tests `supabase/tests/maneuvers/run.cjs` (bloque `T2.4c`, + extensión de T2.5)
Espejan T2.4 (vaccination) y T2.4b (fail-closed). Mapa test→R abajo.

### T3 — 2 LOW de housekeeping de M2.1-edge foldeados (comentarios stale, no-comportamiento)
- `app/src/services/powersync/maneuver-reads.test.ts:166,168` — el comentario de sección y el título
  del test atribuían `buildSetSessionRodeoUpdate` a **"R4.4"** → es **R4.7** (el fix-loop de M2.1-edge
  movió `setSessionRodeo` de R4.4 a R4.7; el move-de-animal real de R4.4 es `moveAnimalToRodeo`).
  Corregido a R4.7 en ambas líneas.
- `app/src/utils/maniobra-edge.ts:18` — el docblock mencionaba `evaluateMisconfiguredRodeo` → la función
  real es `shouldWarnMisconfiguredRodeo` (línea 140). Corregido.
- (NOTA: hay otras 2 menciones de "cambiar el rodeo de la jornada / R4.4" en `maniobra-edge.ts:45-62`
  sobre `isOtherRodeo`/`canChangeSessionRodeo` — NO se tocaron: son código de M2.1-edge ya revisado +
  Gate-2 verde, fuera del scope de los 2 LOW puntuales asignados; tocarlos sería scope-creep en otro chunk.)

### T4 — Reconciliación de specs al as-built
- `design.md §4.bis` — reemplazado el SQL placeholder (que ramificaba por `route` con un `else`
  PLACEHOLDER dependiente de D10-abierta) por el AS-BUILT: helper `assert_any_data_key_enabled` + OR pura
  + número real `0091`. Nota de tests reconciliada (T2.4c). Nota PENDIENTE DEPLOY explícita.
- `design.md §3` (mapa MANEUVER_DATA_KEYS) — afinada la nota del antiparasitario: D10 cerrado, sin
  sub-elección estructurada, capa 2 espeja la OR con `assert_any_data_key_enabled`.
- `design.md §9 D10` — de "ABIERTA, requiere confirmación" a **RESUELTO** (OR pura, opciones a/b/c
  descartadas; consecuencia para §4.bis documentada).
- `tasks.md M3.0-BACKEND` — marcada `[x]` (mi parte hecha) con nota AS-BUILT + ⚠️ PENDIENTE DEPLOY;
  número `0091`, OR pura, bloque de tests T2.4c. `tasks.md M3.1/M3.2` — reconciliadas las menciones de
  "sub-elección interno/externo según D10/route" a "una sola maniobra sin sub-elección estructurada (D10)".

## Trazabilidad — mapa R<n> → test
| R<n> | Test (supabase/tests/maneuvers/run.cjs, bloque T2.4c) |
|---|---|
| **R7.7** (gatear deworming/treatment fail-closed por rodeo real) | `T2.4c` completo: deworming 4 combos OR + treatment accept/reject |
| **R6.15** (Antibiótico → treatment, single key `antibiotico`) | `T2.4c` "treatment con antibiotico enabled → OK" / "disabled → reject" |
| **R6.13** (Antiparasitario → deworming, silent_apply) | `T2.4c` los 4 inserts de deworming (producto texto libre, event_type='deworming') |
| **R6.14** (D10: OR de interno/externo, sin distinción estructurada) | `T2.4c` "ninguno → reject", "solo interno → OK", "solo externo → OK", "ambos → OK" |
| **R7.3** (no-bypass: INSERT directo PostgREST/sync rechazado igual) | `T2.4c` "treatment por service_role sobre rodeo sin antibiotico → reject (no-bypass)" |
| **R7.6** (fail-closed: rodeo no resoluble → 23514) | `T2.4c` "deworming/treatment sobre perfil soft-deleted → reject (fail-closed)" |
| **R7.2** (binding data_key↔field_definitions explícito) | `T2.5` extendido: antiparasitario_interno/externo/antibiotico existen en field_definitions |
| (regresión — no rompió 0054) | `T2.4c` "vaccination sigue OK" + "event_type='other' no se gatea" |

## Autorrevisión adversarial (leí el SQL como atacante)
- **¿Bypass del gating de deworming/treatment?** El trigger es `BEFORE INSERT FOR EACH ROW` (de 0054, no
  redefinido) → corre para CUALQUIER rol (incl. service_role, verificado por el test no-bypass). El enum
  `sanitary_event_type` (0027) es estricto → no se puede colar `'Deworming'` ni un valor fuera del enum.
  Único "escape" posible: cargar un antiparasitario como `event_type='other'` para evadir el gating — pero
  entonces NO es un `deworming` queryable (no contamina el dataset de antiparasitario); es el MISMO
  trade-off que ya tiene `vaccination` en 0054, no un bypass del gating de deworming. Aceptable/consistente.
- **¿La OR está bien?** `count(distinct fd.data_key)` con `enabled=true` y `fd.data_key = any(array)`;
  rechaza si `< 1`. Ninguno→0 rechaza; uno→1 pasa; ambos→2 pasa. Correcto. Cubierto por las 4 combos.
- **¿Se rompió vaccination?** La rama vaccination es idéntica a 0054 (assert_data_keys_enabled,['vacunacion']).
  Test de regresión verde.
- **Fail-closed del helper OR**: resuelve el rodeo del perfil ACTIVO (`deleted_at is null`) ANTES de contar;
  `v_rodeo IS NULL` → `23514`, nunca pasa. (Mi helper valida el rodeo incluso antes del early-return de
  array vacío → estrictamente MÁS fail-closed que `assert_data_keys_enabled`; mi callsite siempre pasa un
  array de 2, nunca vacío.) `search_path=public` (sin hijack), SECURITY DEFINER, EXECUTE revocado (no RPC).
- **Gap menor anotado (no explotable, housekeeping)**: el smoke-check de grants (0055) NO incluye
  `assert_any_data_key_enabled` en su lista (0055 es anterior). El REVOKE está aplicado en 0091 (l.69), así
  que la función NO queda expuesta — pero un futuro `check_grants` debería agregarla a la lista de defensa
  en profundidad. Anotado para el leader (no bloquea; el revoke ya cierra la superficie).

## Estado de check.mjs (distinguiendo el rojo esperado)
- **typecheck client**: ✓ OK
- **client unit tests**: ✓ 1195/1195 pass (incl. `maneuver-reads.test.ts` y `maniobra-edge.test.ts`
  con los 2 LOW foldeados — verdes).
- **RLS / Edge / Animal suites**: ✓ verdes (24 RLS, Edge, 18 Animal).
- **Maneuvers suite (spec 03)**: ✖ `tests 14 / pass 12 / fail 2` → **el ÚNICO test rojo es `T2.4c`**
  (run.cjs:521). El assert que dispara: `"treatment con antibiotico disabled -> reject"` (run.cjs:535),
  `operator: 'notStrictEqual'`, `actual: null` → el INSERT de treatment sobre rodeo con antibiotico
  disabled **devolvió error === null (se aceptó)** cuando esperábamos rechazo. **Esa es la firma exacta
  del estado pre-deploy**: el trigger viejo 0054 no gatea treatment → el insert pasa → assert de rechazo
  falla. NO es bug del test (el test ejercita el path real; el rechazo no ocurre porque 0091 no está
  aplicada). `node --test` aborta el subtest en el primer reject fallido, por eso "fail 2" en el contador
  interno del subtest pero un solo subtest rojo. **Todos los demás T2.x verdes**: T2.4 (vaccination)
  verde, T2.5 (binding de los 3 nuevos data_keys) verde → confirma que las filas de config existen.
- **suites posteriores (user_private/import/sync_streams/operaciones_rodeo)**: NO corrieron — `run-tests.mjs`
  aborta en el primer `execSync` que falla (maniobras es la 4ta). Esperado por el abort de mi rojo intencional.
- **NO es rojo ajeno**: no hay "Request rate limit reached" ni cascada de undefined.id (no es el flake de
  rate-limit por terminales paralelas); no es spec-12 (la suite import ni corrió, y en el baseline
  pre-cambios `check.mjs` salió exit 0 verde de punta a punta, spec-12 incluida).

## POST-DEPLOY esperado (cuando el leader aplique 0091)
`T2.4c` pasa en verde (los 4 combos de deworming + treatment accept/reject + no-bypass + fail-closed +
regresión) → la suite de maniobras vuelve a verde → `check.mjs` exit 0 de punta a punta.

NO marco `done` — espera al reviewer + Gate 1 (security spec sobre el delta) + Gate 2 + OK de Raf para deploy.
