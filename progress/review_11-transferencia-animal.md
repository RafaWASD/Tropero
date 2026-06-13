# Review — 11-transferencia-animal (reviewer, sesion 23)

Veredicto: APPROVED (condicional al deploy 0088 antes que 0087 + re-run de la suite en Gate 2 — comportamiento esperado, ver Estado de verificacion).

Alcance revisado: Fases 1/2/3/5. Fase 4 (UI) DIFERIDA por dependencia del frontend de spec 09 (deferred). T4.1-T4.6 quedan [ ] con justificacion documentada en tasks.md lineas 51-60 y progress/impl_*. No bloquea.

## Trazabilidad Rn a test (DEFINITIVAS — 32 reqs backend/cliente)

Verificada contra supabase/tests/animal/run.cjs (suite spec 11 transfer_animal RPC, T2.1-T2.14) y app/src/services/transfer-animal.test.ts. Cada R definitiva tiene 1+ test concreto.

- R2.1 reusa animal_id global -> T2.1 (np.animal_id === animalId) OK
- R2.2 rodeo destino mismo system -> T2.9(a 23514 / b OK) OK
- R2.3 management_group_id NULL -> T2.1 OK
- R2.4 idv conservar/NULL colision -> T2.8(a/b) OK
- R2.5 idv_dropped en resultado -> T2.8(b) + transfer-animal.test.ts (mapTransferResult) OK
- R2.6 identidad denorm consistente (0079) -> trigger 0079 la fuerza; el RPC NO la setea (ausente en INSERT 0087:174-184) — verificado por inspeccion OK
- R2.7 is_castrated preserva (global) -> T2.14 OK
- R2.8 future_bull arranca false -> T2.14 (ambos casos false) OK
- R2.9 category_override false -> T2.1 OK
- R2.10 created_by forzado al caller (0043) -> T2.1 OK
- R2.11 status active / deleted_at NULL -> T2.1 OK
- R2.12 descriptivos viaja/resetea -> T2.1 (breed/coat/visual viajan; entry_*/notes reset; entry_date=hoy) OK
- R3.1 5 tablas tipadas -> T2.1 OK
- R3.2 animal_events -> T2.1 + T2.12 OK
- R3.3 animal_category_history -> T2.1 OK
- R3.4 vinculos calf_id/bull_id de OTROS -> T2.11 OK
- R3.5 birth_calves ternero -> T2.1 OK
- R3.6 establishment_id a Y en TODAS las hijas -> T2.1 + T2.12 (0 filas en X en 6 tablas) OK
- R3.7 animal_events re-apuntado sin rechazo (GUC) -> T2.12 OK
- R3.8 session_id a NULL en tipadas -> T2.1 OK
- R3.9 viejo sin eventos -> T2.1 OK
- R4.1 archiva (transferred, NO soft-delete) -> T2.1 OK
- R4.2 nunca 0 ni 2 activos -> T2.2 + T2.1 OK
- R4.3 atomicidad/rollback -> T2.3 OK
- R5.1 authz origen X paridad 0044 -> T2.6 (rol X+Y, no owner/creador -> 42501) OK
- R5.2 sin rol en X -> 42501 -> T2.4 OK
- R5.3 sin rol en Y -> 42501 -> T2.5 OK
- R5.4 deriva X de la fila real (anti-IDOR) -> T2.4/T2.6 OK
- R5.5 grants fail-closed -> T2.13 + smoke-check 0087:279-291 OK
- R5.6 origen inactivo/inexistente -> 23503 -> T2.7(a/b) OK
- R6.1 idempotencia replay -> T2.10 + transfer-animal.test.ts OK
- R6.2 id de cliente estable -> T2.10 + newTransferTargetProfileId() (animals.ts:1204) OK
- R6.3 carrera a 1 ganadora -> T2.7(b) + clasificacion 23505 OK
- R7.1 ONLINE-only -> animals.ts::transferAnimal (assertOnline) + transfer-animal.test.ts OK
- R7.2 un animal por invocacion -> por construccion OK
- R7.3 SIGSA no carga a Y -> por cardinalidad OK
- R8.1 linaje cruzado no se rompe -> T2.11 + T2.1 OK

R1.1-R1.6 y R8.2 son TENTATIVAS-UI (Fase 4 diferida) — sin test backend, justificado. Sin huecos en las 32 definitivas.

## Tasks completas
Si para el alcance del run: T1.1-T1.13 [x], T2.1-T2.15 [x], T3.1-T3.3 [x], T5.1-T5.3 [x]. T4.1-T4.6 [ ] con justificacion documentada (Fase 4 UI diferida, dep. spec 09). Aceptado.

## CHECKPOINTS
- C2 [x] una sola feature in_progress; [x] coherente.
- C3 [x] capas previstas (service puro transfer-animal.ts + I/O animals.ts, patron exit-animal); [x] sin deps nuevas (randomUuid usa crypto.randomUUID); [x] sin establishment_id hardcodeado (el RPC lo deriva de la fila real).
- C4 [x] test por modulo; [x] fixtures reales; [ ] runner verde BLOQUEADO por el deploy pendiente (14 PGRST202 esperados) — NO es defecto; [x] test cross-tenant (T2.4/T2.5/T2.6/T2.12).
- C6 [x] 3 archivos de spec, EARS estricto, cada R definitiva con 1+ test.
- C7 [x] establishment_id re-apuntado a Y en TODAS las hijas (R3.6); [x] helpers has_role_in/is_owner_of (no SQL inline); [x] test cross-tenant. NO crea tablas, RLS as-built intacta.

## Checklist RAFAQ-especifico
- A. Multi-tenancy/RLS: N/A parcial (NO crea tablas, no aplica enable RLS/policies nuevas). Si aplica el aislamiento del wire de sync: [x] helpers usados, paridad EXACTA con exit_animal_profile (0044:48-49 vs 0087:104-105, verbatim); [x] test cross-tenant (T2.12 + 3 vectores authz); [x] deleted_at IS NULL respetado (select active-only 0087:88; colision idv 0087:146).
- B. Offline-first: N/A por diseno (ONLINE-by-design R7.1). [x] NO toca PowerSync/outbox (assertOnline animals.ts:1230); [x] establishment_id denorm mantiene sync set scoped (R3.6). Last-write-wins N/A (atomica server-side).
- C. BLE: N/A.
- D. UI de campo: N/A (Fase 4 diferida).
- E. Edge Functions: N/A (es RPC Postgres; alternativa Edge descartada en design 6).

## Reconciliacion de specs (regla dura)
- [x] specs/active/02-modelo-animal/design.md (lineas 1866-1874) reconciliado con el delta del trigger (0088): early-return por GUC rafaq.is_transfer, ref a 0087/4.3/DEC-A1, molde 0031. Sin specs contradictorias.
- [x] specs/active/11-transferencia-animal/design.md 3.2 reconciliado con las 2 divergencias as-built (rodeo_id en SELECT (a); split 0087+0088). Authz 3.2(a)=paridad 0044; idempotencia 3.2(0) al inicio; R2.12 viaja/resetea; delta GUC 4.3. El design no quedo mintiendo.

## Verificacion estatica del SQL (deploy pendiente)
Validado contra el as-built: 0044 (paridad authz EXACTA), 0034 (cuerpo del trigger identico salvo early-return), 0077/0078 (force triggers BEFORE INSERT OR UPDATE convergen a Y; birth_calves force solo-INSERT, el UPDATE explicito madre a Y es la unica via, incluido), 0052 (session tenant-check early-returna con session_id NULL), 0031 (apply_auto_transition AFTER INSERT, el re-apuntado por UPDATE no re-dispara transiciones; molde GUC), 0020 (unique parcial active-animal + idv; archivar-viejo-antes-de-crear-nuevo respeta R4.2), 0021 (category_check 23514 sostiene T2.3), 0083 (molde idempotencia al inicio). Orden load-bearing correcto: (0) idempotencia, (a) derivar+authz, (b) mismo sistema, (c) idv, (d) archivar viejo, (e) crear nuevo, (f) re-apuntar, (g) vinculos.

## Honestidad de los tests (cazado y cerrado)
- assertRpcExists agregado a TODOS los negativos (T2.3/T2.4/T2.5/T2.6/T2.7/T2.9) — falla si error.code === PGRST202. Verificado: los 14 subtests fallan honestamente con PGRST202.
- Aserciones endurecidas a error.code EXACTO (42501/23503/23514), no regex laxo. Verificado.
- Limpieza: la suite usa RUN_TAG y el cleanup final pasa -> CERO huerfanos. T2.9 activa/restaura invernada en try/finally + borra el rodeo temporal. Verificado (Animal suite cleanup OK en check.mjs).

## Service cliente
[x] transferAnimal ONLINE-only (assertOnline, no PowerSync/outbox); [x] mapea 42501/23514/23503/23505 a copy es-AR accionable SIN leak de sqlerrm; [x] newTransferTargetProfileId() UUID estable para idempotencia.

## Estado de la verificacion (NO es defecto)
node scripts/check.mjs: typecheck VERDE, client unit 1002/1002 VERDE (incl. 14 de transfer-animal), RLS 22/22, Edge 42/42 VERDE. Animal suite: 84 pass / 14 fail — los 14 son EXACTAMENTE los subtests RPC de spec 11 con PGRST202 (funcion inexistente en el remoto, migracion NO aplicada — esperado, patron 0075-0086). T2.13 (grants) pasa sin la migracion. cleanup pasa (0 huerfanos). Estos PGRST202 NO se evaluan como rojo por instruccion del run; se resuelven al aplicar 0088 antes que 0087 en Gate 2.

## Cambios requeridos
Ninguno. Pasa a Gate 2 + deploy (0088 ANTES que 0087) + Puerta 2.
