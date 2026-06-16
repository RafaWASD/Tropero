# Review — chunk M3.0-BACKEND (spec 03 MODO MANIOBRAS): gating capa 2 de deworming + treatment

**Reviewer**: reviewer (Opus 4.8) - **Fecha**: 2026-06-14
**Artefacto**: supabase/migrations/0091_sanitary_gating_deworming_treatment.sql (NO aplicada, deploy gateado por Raf) + tests supabase/tests/maneuvers/run.cjs (T2.4c + T2.5) + 2 LOW foldeados + reconciliacion de specs.
**Insumos**: progress/impl_03-m3.0-backend.md, progress/security_spec_03-m3.0-backend.md (Gate 1 PASS), 0054_gating_db_layer.sql, requirements.md, design.md, tasks.md.

---

## VEREDICTO: CHANGES_REQUESTED

El SQL, los tests y los 2 LOW foldeados estan correctos, y el rojo de check.mjs es el esperado pre-deploy (no bug). El motivo del rechazo es uno solo y acotado: la reconciliacion de specs al as-built quedo incompleta (regla dura, paso 6 / docs/specs.md "Reconciliacion de specs al as-built"). La decision D10 (Raf 2026-06-14: el Antiparasitario es UNA sola maniobra SIN sub-eleccion estructurada interno/externo) cambio el comportamiento, y se reconcilio bien en design.md sec 3 / sec 4.bis / sec 9-D10, en tasks.md M3.0-BACKEND, y en requirements.md R6.14 + tabla R5.4 — pero quedaron 3 lugares de las specs que todavia afirman la version vieja "con sub-eleccion interno/externo", contradiciendo el as-built. Specs que mienten = no se aprueba hasta reconciliar.

El delta de seguridad es solido: Gate 1 ya dio PASS (0 HIGH / 0 MEDIUM) sobre el mismo SQL. Una vez reconciliadas las specs, este chunk queda listo para que Raf autorice el deploy de 0091.

---

## Trazabilidad R<n> <-> test (verificada contra el codigo)

| R<n> | Test concreto (supabase/tests/maneuvers/run.cjs) | OK |
|---|---|---|
| R7.7 (gatear deworming/treatment fail-closed por rodeo real) | T2.4c completo (run.cjs:521-602): 4 combos OR de deworming + treatment accept/reject | si |
| R6.15 (Antibiotico -> treatment, single key antibiotico) | run.cjs:529-537 (treatment antibiotico enabled->OK / disabled->23514) | si |
| R6.13 (Antiparasitario -> deworming, silent_apply) | run.cjs:545-565 (los 4 inserts event_type=deworming, producto texto libre) | si |
| R6.14 (D10: OR interno/externo, sin distincion estructurada) | run.cjs:543-565 (ninguno->23514; solo interno->OK; solo externo->OK; ambos->OK) | si |
| R7.3 (no-bypass: INSERT directo service_role rechazado igual) | run.cjs:571-577 (admin/service_role sobre rodeo sin antibiotico -> 23514) | si |
| R7.6 (fail-closed: rodeo no resoluble -> 23514) | run.cjs:580-589 (perfil soft-deleted -> 23514 para deworming y treatment) | si |
| R7.2 (binding data_key <-> field_definitions) | T2.5 run.cjs:606 (antiparasitario_interno/externo/antibiotico presentes en field_definitions) | si |
| regresion (no rompio 0054) | run.cjs:592-601 (vaccination sigue OK; event_type=other no se gatea) | si |

Cada R<n> del chunk tiene >=1 test concreto. Mapa razonable. Los tests de RECHAZO pasan post-deploy de 0091 (ver "check.mjs" abajo).

## Tasks completas: parcial — correcto para el alcance
- tasks.md M3.0-BACKEND -> [x] (linea 239). Es la unica task del chunk; M3.1/M3.2 son frontend de otro chunk, legitimamente [ ] (fuera de alcance, justificado). OK.

## CHECKPOINTS
- C1 [x] harness completo (check corre; falla solo por el rojo intencional pre-deploy).
- C2 [x] una feature in_progress (03); el rojo es intencional, no incoherencia.
- C3 [x] respeta arquitectura (migracion SQL en supabase/migrations/, helper + trigger; sin capas nuevas; sin establishment_id hardcodeado — el tenant se deriva del perfil).
- C4 [x] verificacion real: tests con fixtures reales contra DB remota (no mocks), runner muestra >0 tests. El rojo es pre-deploy esperado.
- C5 [ ] no aplica al cierre (no se marca done; deploy pendiente de Raf).
- C6 [ ] SDD — falla en "design.md/requirements.md no quedo viejo": cada R<n> tiene test (si), EARS estricto (si), pero la reconciliacion codigo->spec quedo incompleta (ver Cambios requeridos). ESTE es el box que bloquea.
- C7 [x] multi-tenant: el gating deriva el rodeo del propio animal_profile (tenant-safe, R7.4); test no-bypass cross-rol presente. Sin tabla nueva (sin RLS nueva que evaluar).
- C8 N/A directo al delta (es backend de enforcement; el offline del cliente es M3.1/M3.2).

## Checklist RAFAQ-especifico
- A (multi-tenancy/RLS): el delta NO crea tablas nuevas ni toca RLS policies — solo reemplaza el cuerpo de un trigger y agrega un helper SECURITY DEFINER. "enable row level security"/policies -> N/A (sin tabla nueva). Tenant-isolation del gating: el rodeo se resuelve inline desde animal_profiles.rodeo_id del perfil activo (deleted_at is null), nunca cruza config de otro tenant -> si (R7.4). deleted_at IS NULL filtrado en la resolucion de rodeo -> si (0091:43). Helper privilegiado correctamente (SECURITY DEFINER + search_path=public + EXECUTE revocado de public/authenticated/anon, 0091:69,98) -> si.
- B (offline-first): N/A al delta (el cliente offline es M3.1/M3.2). El gating capa 2 corre al sincronizar; el surfacing de rechazos (R10.8) es M4.
- C (BLE): N/A.
- D (UI de campo): N/A (backend puro).
- E (Edge Functions): N/A (no es Edge Function; es trigger DB). Equivalente RAFAQ aqui: fail-closed verificado (si), no-bypass service_role verificado (si), errores 23514 con mensaje claro (si), test backend ejecutado (rojo pre-deploy esperado).

---

## FOCO (lo que se me pidio escrutar) — resultado

1. Fidelidad a spec + D10 — si. El SQL gatea deworming con OR pura (assert_any_data_key_enabled(['antiparasitario_interno','antiparasitario_externo']), 0091:85-88) y treatment con ['antibiotico'] (0091:91). NO agrega data_key nueva, NO ramifica por route (0090 solo agrego el valor de enum intranasal, no se usa para gating). El mapeo coincide con requirements.md tabla R5.4 (linea 142), R6.14, R6.15, R7.7. Los 3 data_keys existen en field_definitions (0018:47-49).
2. Espejo correcto de 0054 — si. La rama vaccination queda byte-identica a 0054 (0091:79-80 == 0054:100-101). El helper nuevo assert_any_data_key_enabled (0091:35-68) espeja assert_data_keys_enabled (0054:33-65) exactamente: misma resolucion de rodeo inline del perfil activo, mismo fail-closed (v_rodeo IS NULL -> 23514), misma query count(distinct fd.data_key). La unica diferencia es el umbral: v_have < 1 (OR) vs v_have < v_need (AND). Correcto. Gate 1 confirmo la paridad byte-a-byte.
3. Cobertura de tests — si. T2.4c cubre los 4 combos deworming (ninguno->reject, interno->OK, externo->OK, ambos->OK), treatment accept/reject, no-bypass (service_role), fail-closed (perfil soft-deleted), regresion (vaccination OK + other no-gateado). T2.5 cubre el binding R7.2. Mapa test->R razonable.
4. 2 LOW foldeados — si correctos:
   - maneuver-reads.test.ts:166,168 — comentario de seccion + titulo del test ahora R4.7 (era R4.4). Correcto: buildSetSessionRodeoUpdate = "cambiar rodeo de la jornada" = R4.7 (requirements.md:114), no el move-de-animal de R4.4. Verificado contra maniobra-edge.ts:15-18.
   - maniobra-edge.ts:18 — docblock ahora menciona shouldWarnMisconfiguredRodeo (funcion real, def. linea ~140), no evaluateMisconfiguredRodeo. Correcto.
5. Reconciliacion de specs — INCOMPLETA (ver Cambios requeridos). design.md sec 3 / sec 4.bis / sec 9-D10 si; tasks.md M3.0-BACKEND si; requirements.md R6.14 + tabla R5.4 si — pero R6.13, M3.2-Aceptacion y R7.7 quedaron con texto viejo.
6. Numero de migracion 0091 — si libre (el arbol llegaba a 0090_sanitary_route_intranasal.sql). Conflicto con design.md sec 11.2 / tasks.md:299 (0091_custom_measurements.sql de M5) -> no es conflicto real: M5 es spec de diseno NO aplicada, su sec 11 ya advierte "CONFIRMAR antes de fijar numeros" y impl_03-m3.0-backend.md lo declara explicitamente diferido ("lo reconcilia M5 cuando lo implementen"). El chunk que se ejecuta primero gana el numero. Aceptado como no-bloqueante.

---

## Estado de check.mjs — el rojo es el ESPERADO pre-deploy (confirmado, NO bug)

Corrido completo. Verde hasta maniobras:
- typecheck client OK - client unit tests OK (incl. maneuver-reads.test.ts + maniobra-edge.test.ts con los 2 LOW — verdes) - RLS OK - Edge OK - Animal (spec 02) OK.
- Maneuvers suite (spec 03): FAIL tests 14 / pass 12 / fail 2. Unico subtest rojo: T2.4c (run.cjs:521). El assert que dispara es run.cjs:535 ("treatment con antibiotico disabled -> reject"), operator notStrictEqual, actual null -> el INSERT de treatment sobre rodeo con antibiotico disabled devolvio error === null (se ACEPTO) cuando esperabamos rechazo 23514.
- Esa es la firma EXACTA del estado pre-deploy: el trigger viejo 0054 solo gatea vaccination -> el INSERT de treatment/deworming que esperamos rechazado se acepta -> el assert de 23514 falla con actual null. NO es bug del test (el test ejercita el path real; el rechazo no ocurre porque 0091 no esta aplicada). NO es el flake de rate-limit (no hay "Request rate limit reached" ni cascada de undefined.id). node --test aborta el subtest en el primer reject fallido -> "fail 2" en el contador interno, un solo subtest rojo.
- Suites posteriores no corrieron (el runner aborta en el primer execSync que falla) — esperado.
- POST-DEPLOY de 0091: T2.4c pasa -> suite de maniobras verde -> check.mjs exit 0.

---

## CAMBIOS REQUERIDOS (concretos, archivo:linea)

Todos son reconciliacion de specs al as-built (la decision D10 ya tomada por Raf). NO se toca codigo ni tests — el SQL y los tests estan correctos. El implementer reconcilia el markdown y vuelve.

### CR-1 (BLOQUEANTE) — requirements.md R6.13 (linea 197) contradice D10
Dice: "...ofrecer la maniobra Antiparasitario como una sola maniobra con una sub-eleccion interno/externo (NO dos maniobras separadas)...". Esto contradice R6.14 (linea 199: "una sola maniobra SIN sub-eleccion estructurada", "Supersede la version previa con sub-eleccion") y el as-built del SQL (OR pura, sin distincion). Fix: quitar la clausula "con una sub-eleccion interno/externo" de R6.13 (dejar "una sola maniobra"), o nota inline apuntando a R6.14/D10 como la version vigente. La spec no puede afirmar dos comportamientos opuestos para la misma maniobra.

### CR-2 (BLOQUEANTE) — tasks.md M3.2 Aceptacion (linea 260) contradice D10
Dice: "...antiparasitario es una maniobra con sub-eleccion interno/externo y escribe deworming...". Contradice D10 y el propio Detalle de M3.2 (linea 259) que ya dice "SIN sub-eleccion estructurada interno/externo". Fix: en la linea de Aceptacion 260, cambiar "con sub-eleccion interno/externo" por "sin sub-eleccion estructurada interno/externo (D10)" para alinear con el detalle 259.

### CR-3 (menor, recomendado en la misma pasada) — requirements.md R7.7 (linea 221), residuo de "sub-eleccion"
Dice: "...deworming -> al menos uno de [antiparasitario_interno, antiparasitario_externo] (segun la sub-eleccion, R6.14)..." y mas abajo "El gating de la sub-eleccion interno/externo (R6.14)...". El "segun la sub-eleccion" quedo ambiguo (ya no hay sub-eleccion). El enforcement OR descrito es correcto; solo sobra la referencia a "sub-eleccion". Fix: reemplazar "(segun la sub-eleccion, R6.14)" por "(OR pura, R6.14/D10)" y ajustar la frase final para que no implique una sub-eleccion que ya no existe.

### CR-4 (LOW, housekeeping) — design.md sec 4.bis "Nota de coordinacion" (linea 618), numero stale
Dice: "...Va en migracion nueva 0054...". Es copy/paste heredado; el delta va en 0091. Fix: corregir "0054" -> "0091" en esa nota (el resto de sec 4.bis ya usa 0091 correctamente).

---

## Notas (no bloquean)

- LOW de defensa en profundidad (ya anotado por implementer y por Gate 1, coincide): assert_any_data_key_enabled no esta en la lista v_funcs del smoke-check de grants de 0055_check_grants.sql (es posterior). NO deja gap — el REVOKE esta aplicado en 0091:69. Recomendacion opcional: agregarla a una 009x futura de check_grants. No bloquea este chunk.
- Conflicto de numero 0091 con M5 (sec 11.2 / tasks:299): M5 reconcilia sus numeros cuando se implemente (su sec 11 ya lo advierte). Anotar para cuando se levante M5, no para este chunk.
- NO marcar done: el deploy de 0091 lo autoriza Raf tras Gate 1 (ya PASS) + esta reconciliacion. Post-reconciliacion + deploy, check.mjs queda verde.
