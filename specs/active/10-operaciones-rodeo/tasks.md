# Spec 10 — Operaciones masivas por rodeo + vista de grupo — Tasks

**Status**: reconciliado 2026-06-11 (Gate 0 v2 + staleness). Gate 1 re-corrido 2026-06-11: **PASS 0H/2M/3L**; M1/M2/L1 foldeados (T-DB.4 e/f + prosa de design/requirements). **Puerta 1 APROBADA por Raf (2026-06-11) — LIM-1=mitigar con observación / LIM-2=tolerar-y-saltear foldeadas** (R13.7 + design §3.5/§4.2(4)). ⚠ Re-chequeo puntual de Gate 1 sobre el delta de LIM-2 pendiente (lo lanza el leader — design §6).
**Fuente**: `requirements.md` + `design.md` reconciliados (2026-06-11).

> Reglas (`docs/specs.md`): pasos discretos en orden, cada uno con `[ ]` + los `R<n>` que cubre. El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificación. Cada `R<n>` mapea a ≥1 test.
>
> **Fases**: el backend (Fase 1) es ejecutable ya y es **pre-requisito del cliente** (la denorm debe existir antes de cablear castración offline y el espejo). El cliente construye SOBRE el as-built DONE de spec 02 C1–C4 + spec 09 (`AnimalRow`) + spec 15 (PowerSync). La estética fina de UI es TENTATIVA (design system); el **modelo de interacción NO** (lockeado por Gate 0 v2). Numeración de migraciones: TBD al implementar (as-built en disco = 0083 → ≥0084; coordinar con el leader/terminales paralelas, design §9 D6).

---

## Fase 1 — Backend: delta `future_bull` + denorm `is_castrated` + recompute simétrico (pre-requisito)

- [ ] T-DB.1 — Migration `00NN_future_bull.sql` (design §4.1): columna `animal_profiles.future_bull boolean not null default false` + comment + trigger `animal_profiles_normalize_future_bull` (BEFORE INSERT OR UPDATE OF `future_bull, is_castrated, animal_sex`; normaliza a `false` si no-macho o castrado) + `revoke execute` de la función. Verificar el orden alfabético respecto del force de 0079. Cubre: R12.1, R12.4.
- [ ] T-DB.2 — Migration `00NN_denormalize_is_castrated.sql` (design §4.2): columna espejo + backfill idempotente + force-INSERT (`animal_profiles_force_is_castrated`) + write-through up (`animal_profiles_is_castrated_writethrough`, guard `IS DISTINCT FROM`) + propagación down (`animals_propagate_is_castrated`, guard `IS DISTINCT FROM` + **pre-filtro de rodeo vivo espejo de `rodeo_check` 0021 + `RAISE LOG` del skip** — tolerar-y-saltear, LIM-2/Puerta 1, design §4.2(4)) + `revoke execute` en las 3 funciones. Cubre: R13.3, R13.4.
- [ ] T-DB.3 — Migration `00NN_castration_recompute_symmetric.sql` (design §4.3): `create or replace` SOLO del cuerpo de la función REAL `tg_animals_apply_castration` (0064) con guard dirección-agnóstico (`IS NOT DISTINCT FROM` → return); conservar perfil-activo-único, respeto de override, delegación a `compute_category` y `apply_auto_transition`. NO re-crear el trigger `animals_apply_castration`. Re-emitir `revoke execute` idempotente. Cubre: R13.5, R5.7.
- [ ] T-DB.4 — Test (runner ADR-012) del **write-through y la fidelidad**: (a) UPDATE `animal_profiles.is_castrated true/false` se refleja en `animals.is_castrated`; (b) un INSERT de perfil nuevo nace fiel a `animals` aunque el payload mienta (force-INSERT); (c) la propagación down actualiza TODOS los perfiles del animal; (d) **no-loop**: la cadena completa termina (el UPDATE no rebota; contadores de history sin duplicados); (e) **propagación con rodeo muerto = SKIP esperado (LIM-2 resuelta: tolerar-y-saltear, Puerta 1 2026-06-11)**: animal con dos perfiles, uno cuyo rodeo está inactivo o soft-deleted → el UPDATE de `is_castrated` desde el otro perfil **NO aborta**: el perfil propio queda aplicado (y `animals.is_castrated` actualizado vía write-through), el perfil huérfano queda **salteado** por el pre-filtro (conserva su valor stale — y su `future_bull`, que tampoco se auto-limpia) y el trigger emite `RAISE LOG`; sub-aserción de convergencia: reactivar el rodeo huérfano + nuevo flip de `is_castrated` del animal ⇒ el perfil antes salteado se actualiza (design §4.2(4), requirements §Limitaciones LIM-2); (f) **orden de triggers contra `pg_trigger` (Gate 1 v2 L1)**: aserción de que los BEFORE relevantes de `animal_profiles` quedan en orden alfabético `animal_profiles_force_animal_identity` → `animal_profiles_force_is_castrated` → `animal_profiles_identity_check` → `animal_profiles_normalize_future_bull` (consultando `pg_trigger`, no solo por convención de nombres — blinda contra un rename futuro silencioso). Cubre: R13.3, R13.4.
- [ ] T-DB.5 — Test del **recompute simétrico**: macho >1 año `torito` → `is_castrated=true` ⇒ `novillito`; revert `false` ⇒ `torito`; macho ≥730d `toro` → castrar ⇒ `novillo`, revert ⇒ `toro`; en `ternero` no transiciona en ninguna dirección; con `category_override=true` no transiciona y el history no registra; cada transición queda en `animal_category_history` como `auto_transition`. Cubre: R13.5, R5.6, R5.7.
- [ ] T-DB.6 — Test de **`future_bull`**: (a) set `true` sobre macho persiste; (b) sobre hembra se normaliza a `false`; (c) al castrar (UPDATE `is_castrated=true`, por cualquier path incl. propagación) `future_bull` queda `false` en todos los perfiles del animal; (d) default `false` en alta. Cubre: R12.1, R12.4.
- [ ] T-DB.7 — Test RLS / tenant: un usuario sin rol activo en el establishment NO puede (a) UPDATEar `is_castrated`/`future_bull` del perfil, (b) insertar vacunación/destete sobre animales de ese establishment. Un usuario con rol sí (cualquier rol activo — paridad con la mutación individual). Cubre: R9.1, R9.2.
- [ ] T-DB.8 — Test del **destete as-built sobre el que esta spec se apoya** (regresión de sustrato, no re-implementación): INSERT `weaning` sobre `ternera` ⇒ `vaquillona`; sobre `ternero` castrado ⇒ `novillito`; con override ⇒ no transiciona; soft-delete del weaning ⇒ recalcula (0046/0063). Cubre: R5.5.
- [ ] T-DB.9 — Test de **no-regresión del gating** (delta viejo eliminado): `tg_sanitary_events_gating` NO tiene rama de castración (un `treatment` con `product_name='Castración'` NO se gatea por ningún data_key); `vaccination` sigue fail-closed contra rodeo sin `vacunacion`; NO existe `castracion` en `field_definitions`. Cubre: R7.3, R9.4.
- [ ] T-DB.10 — Test de superficie (R9.4): las 4 funciones nuevas con `revoke execute` efectivo para `public/authenticated/anon` (patrón smoke-check 0055/0066); ninguna policy RLS nueva, ninguna RPC nueva expuesta. Cubre: R9.4.

## Gate 1 — Security (spec) — RE-CORRIDA obligatoria antes de Puerta 1

- [x] T-G1.1 — Correr `security_analyzer` modo `spec` sobre el delta reconciliado (design §4/§6): no-loop, análisis de poder del write-through (vs 0071), orden de triggers BEFORE, revokes, eliminación completa del delta viejo, columnas nuevas en el wire de sync (ADR-025), reemplazo de 0064 sin abrir cross-tenant. Output: `progress/security_spec_10-operaciones-rodeo.md` (nueva corrida; el PASS 2026-06-01 quedó obsoleto). **HECHO 2026-06-11: PASS 0H/2M/3L; Puerta 1 aprobada por Raf 2026-06-11 con D8/D9 validadas.**
- [ ] T-G1.2 — **Re-chequeo puntual de Gate 1 (lo lanza el leader)** sobre el delta de LIM-2 (Puerta 1): el pre-filtro de la propagación (design §4.2(4)) — espeja `rodeo_check` 0021 sin desviación, el skip no abre escritura nueva, el `RAISE LOG` no filtra datos cross-tenant (solo ids + count). Alcance acotado a `tg_propagate_is_castrated_to_profiles`; la observación automática (§3.5) no agrega superficie (as-built 0034). Cubre: condición de cierre del fold LIM-2.

## Fase 2 — Cliente: utils puros (sin design system; requiere Fase 1 para los tipos)

- [ ] T-CL.1 — `bulk-candidates.ts`: base activos del grupo (rodeo/lote) + candidatos por operación: vacunación (todo + filtro categoría/sexo), castración (machos `is_castrated=false`, terneros+adultos), destete (`ternero`/`ternera` sin weaning no borrado; en lote cross-rodeo excluye rodeos sin `destete` con contador). Cubre: R1.3, R4.1, R11.2, R11.4, R7.2.
- [ ] T-CL.2 — Tests de candidatos: solo `status='active'`/no-soft-deleted; hembras/castrados fuera de castración; ya-destetados fuera de destete; exclusión cross-rodeo reportada; mellizos aparecen cada uno como candidato. Cubre: R1.3, R11.2, R11.4, R7.2, R3.5.
- [ ] T-CL.3 — `bulk-selection.ts`: secciones por categoría (castración: Terneros/Adultos; destete: Terneros/Terneras), defaults pre-tildados (castración: solo `ternero` con `future_bull=false`; destete: todos), todos/ninguno por sección, contador vivo, desglose por categoría + conteo ⭐ + conteo override para el bottom-sheet. Cubre: R11.3, R11.4, R11.5, R11.7, R11.8, R5.6.
- [ ] T-CL.4 — Tests de selección: defaults exactos por operación (⭐ y adultos sin tildar en castración; todos tildados en destete); contadores correctos al togglear sección; CTA count == seleccionados; desglose del sheet suma bien. Cubre: R11.3, R11.4, R11.5, R11.7.
- [ ] T-CL.5 — `bulk-idempotency.ts` (solo ops de evento): clave `(animal_profile_id, tipo, fecha)` + `id` UUIDv5 determinístico sobre namespace fijo. Test: misma clave ⇒ mismo id; claves distintas ⇒ ids distintos. Cubre: R6.1.
- [ ] T-CL.6 — Tests de exclusión/no-duplicación local: re-ejecutar la misma op excluye los ya procesados (vacunación: skip `already_applied`; destete/castración: ya no son candidatos); el conteo del preview/CTA refleja solo mutaciones nuevas. Cubre: R6.2, R6.3, R4.3, R4.4.
- [ ] T-CL.7 — `animal-category.ts` (espejo C6): cablear el input real `isCastrated` desde `animal_profiles.is_castrated` local (retirar/degradar la inferencia RC6.2.1 con nota); test: castración offline ⇒ espejo da `novillito` sin sync; revert ⇒ `torito`. Cubre: R13.6, R10.6.

## Fase 3 — Cliente: services + hooks (PowerSync as-built de spec 15)

- [ ] T-CL.8 — `bulk-operations.ts`: genera y encola N mutaciones locales en batches (~100, sin bloquear UI): vacunación → INSERTs `sanitary_events 'vaccination'` (id UUIDv5, `campaign_id NULL`, patrón `events.ts`); destete → INSERTs `reproductive_events 'weaning'` (id UUIDv5, uno por ternero); castración → UPDATEs `animal_profiles SET is_castrated=1, future_bull=0` **+ observación automática "Castrado" por animal** (reuso `addObservation`/`buildAddObservationInsert`, `establishment_id` del perfil, id random — design §3.5) → **2 CrudEntries por animal**. Cubre: R3.1, R3.2, R3.3, R3.4, R3.5, R13.7, R10.1, R10.5.
- [ ] T-CL.9 — `bulk-operations.ts`: progreso "X de N sincronizados" + rechazos por animal con motivo, sobre el canal de status/error de `uploadData` (spec 15); mutaciones independientes (sin rollback de exitosas). Cubre: R10.2, R10.3, R10.4.
- [ ] T-CL.10 — Test: fallo de sync a mitad ⇒ exitosas persisten, fallidas reportadas por animal; re-intento no duplica (UUIDv5 / no-op de estado). Cubre: R10.2, R10.3, R6.1, R6.3.
- [ ] T-CL.11 — `animals.ts`: `setCastrated(profileId, value)` (incluye `future_bull=0` cuando `value=true`; **encadena la observación automática de design §3.5 — UPDATE + INSERT, 1+1 CrudEntries**) + `setFutureBull(profileId, value)` (sin observación). Tests unit de los statements generados. Cubre: R13.1, R13.4, R13.7, R12.2, R12.4.
- [ ] T-CL.12 — `powersync/schema.ts`: declarar `is_castrated` y `future_bull` en `animal_profiles` local; verificar que `est_animal_profiles` (SELECT *) las trae (nota operativa design §4.4). Cubre: R13.3, R12.1.
- [ ] T-CL.13 — Tests de la **observación automática** (R13.7, design §3.5): (a) castrar (vía `setCastrated(true)` y vía la masiva) ⇒ se encola un INSERT `animal_events` `event_type='observacion'` con texto "Castrado", `establishment_id` del perfil, **sin** `author_id` en el payload (lo fuerza el trigger 0034 al subir → autor = usuario actual); (b) revertir (`setCastrated(false)`) ⇒ observación "Corrección: marcado como no castrado" (simetría); (c) la observación aparece en el timeline local (fetchTimeline) offline; (d) masiva de N animales ⇒ exactamente N observaciones + N UPDATEs; (e) `setFutureBull` NO genera observación. Cubre: R13.7, R13.2.

## Fase 4 — Cliente: UI (interacción lockeada Gate 0 v2; estética con design system)

- [ ] T-UI.1 — Vista de grupo (`rodeo/[id]`, `lote/[id]`): metadatos + config + lista (reusa `AnimalRow`) + `GroupActionsBar` (Vacunar/Destetar gated por `rodeo_data_config`; lote: "algún rodeo"; Castrar siempre; verbos pelados). Cubre: R1.1, R1.2, R1.4, R1.5, R1.6, R7.1.
- [ ] T-UI.2 — Inicio rodeo-céntrico (evolución de `(tabs)/index.tsx`): cards de rodeo + cards de lote → vista de grupo. Tab `Animales` intacta (verificación explícita). Cubre: R2.1, R2.2, R2.3.
- [ ] T-UI.3 — `AnimalRow` variante compacta: ≥56px, checkbox, "categoría · edad" (de `animal_birth_date`), badge ⭐ (solo positivo; oculto si categoría `toro`). Sin redefinir el componente. Cubre: R11.9, R12.3.
- [ ] T-UI.4 — Pantalla de selección (`seleccion-masiva`): secciones por categoría + todos/ninguno + contador vivo en header + orden por ID + búsqueda solo si >~20 + resaltado terracota de ⭐ tildado SIN modal (solo castración) + CTA fijo con número vivo (disabled en 0). Cubre: R11.1, R11.5, R11.6, R11.7, R11.9.
- [ ] T-UI.5 — Bottom-sheet de confirmación: desglose por categoría + "⚠ N futuros toritos incluidos" (castración) + aviso override con acción de revertir (patrón C6) + CONFIRMAR/Volver + **copy reversible** ("Podés corregirlo después desde la ficha de cada animal") — prohibido "no se puede deshacer". Cubre: R11.8, R5.6.
- [ ] T-UI.6 — Vacunación masiva (`vacunacion-masiva`): pre-config + filtro + preview "N eventos sobre M animales" + "K saltados (motivos)" + confirmación + pantalla de progreso. Cubre: R4.1, R4.2, R4.3, R4.4, R10.4.
- [ ] T-UI.7 — Ficha: fila "Castrado Sí/No" (solo machos) con confirmación que anticipa el recálculo (espejo C6) + toggle ⭐ futuro torito (solo ficha, no alta) + sin evento **tipado** en el timeline: el flip aparece como **observación automática** ("Castrado" / "Corrección: marcado como no castrado" — R13.7) y, cuando hubo transición, además como cambio de categoría. Cubre: R13.1, R13.2, R13.7, R12.2, R12.3.
- [ ] T-UI.8 — Corrección individual: evento de vacunación/destete editable/borrable por owner/autor desde la ficha (reuso spec 02 R6.8.1, recalcula categoría); castración corregible vía T-UI.7. Cubre: R4.5.
- [ ] T-UI.9 — E2E (Playwright, `app/e2e/`): castración masiva — selección (defaults: terneros comunes tildados, ⭐ y adultos no) → tildar un ⭐ (resaltado, sin modal) → CTA con número → bottom-sheet (desglose + ⚠ + copy reversible) → confirmar → categoría visible novillito **+ observación "Castrado" visible en el timeline del animal**; revert desde la ficha → torito **+ observación "Corrección: marcado como no castrado"**. Cubre: R11.x, R13.1, R13.5, R13.7, R10.6.
- [ ] T-UI.10 — E2E: destete masivo — todos los terneros/as pre-tildados, mellizos generan un weaning cada uno, transición visible (vaquillona/torito), animal con override avisado y sin transición. Cubre: R11.4, R3.2, R3.5, R5.5, R5.6.
- [ ] T-UI.11 — E2E: vacunación masiva — preview → confirmar → N eventos; re-ejecutar ⇒ 0 nuevos (skip). Cubre: R3.1, R4.2, R6.3.

## Mapa de cobertura R → tasks

| R<n> | Tasks |
|---|---|
| R1.1 / R1.2 / R1.4 / R1.5 / R1.6 | T-UI.1 |
| R1.3 | T-CL.1, T-CL.2 |
| R2.1 / R2.2 / R2.3 | T-UI.2 |
| R3.1 | T-CL.8, T-UI.11 |
| R3.2 / R3.5 | T-CL.8, T-CL.2, T-UI.10 |
| R3.3 / R3.4 | T-CL.8 |
| R4.1 / R4.2 | T-CL.1, T-UI.6, T-UI.11 |
| R4.3 / R4.4 | T-CL.6, T-UI.6 |
| R4.5 | T-UI.8 |
| R5.5 | T-DB.8, T-UI.10 |
| R5.6 | T-DB.5, T-CL.3, T-UI.5, T-UI.10 |
| R5.7 | T-DB.3, T-DB.5 |
| R6.1 / R6.2 / R6.3 | T-CL.5, T-CL.6, T-CL.10, T-UI.11 |
| R7.1 | T-UI.1 |
| R7.2 | T-CL.1, T-CL.2 |
| R7.3 | T-DB.9 |
| R9.1 / R9.2 | T-DB.7 |
| R9.3 | (heredado SEC-SPEC-03 — sin task nueva; verdad documentada en design §5) |
| R9.4 | T-DB.9, T-DB.10 |
| R10.1 / R10.5 | T-CL.8 |
| R10.2 / R10.3 / R10.4 | T-CL.9, T-CL.10, T-UI.6 |
| R10.6 | T-CL.7, T-UI.9 |
| R11.1 / R11.5 / R11.6 / R11.7 / R11.9 | T-CL.3, T-CL.4, T-UI.4 |
| R11.2 / R11.4 | T-CL.1, T-CL.2, T-UI.10 |
| R11.3 | T-CL.3, T-CL.4 |
| R11.8 | T-CL.3, T-UI.5 |
| R12.1 | T-DB.1, T-DB.6, T-CL.12 |
| R12.2 / R12.3 | T-UI.3, T-UI.7 |
| R12.4 | T-DB.1, T-DB.6, T-CL.11 |
| R13.1 / R13.2 | T-CL.11, T-CL.13, T-UI.7 |
| R13.3 | T-DB.2, T-DB.4, T-CL.12 |
| R13.4 | T-DB.2, T-DB.4, T-CL.11 |
| R13.5 | T-DB.3, T-DB.5, T-UI.9 |
| R13.6 | T-CL.7 |
| R13.7 | T-CL.8, T-CL.11, T-CL.13, T-UI.7, T-UI.9 |

## Changelog

- **2026-06-01 (s21)**: versión original (delta `castracion` + marcador + N eventos para las 3 ops) + fixes del Gate 1 s21.
- **2026-06-11 — RECONCILIACIÓN COMPLETA**: Fase 1 reescrita al delta nuevo (future_bull / denorm is_castrated / recompute simétrico; eliminadas T-DB.1–T-DB.3 viejas del data_key `castracion` — reemplazadas por test de no-regresión T-DB.9); eliminada la sección "TENTATIVO/DEFERIDO Facundo" (T-DEF.1/2 resueltas as-built 0059–0064; T-DEF.3 sigue fuera de MVP, nota en requirements US-2); Fase 2–4 reescritas al modelo de selección explícita (Gate 0 v2) + as-built (AnimalRow, Expo Router, spec 15, C6); Gate 1 marcado para re-corrida.
- **2026-06-11 — Fix-loop Gate 1 v2 (PASS 0H/2M/3L)**: T-DB.4 ampliada con (e) propagación con rodeo inactivo/soft-deleted → aborto fail-closed esperado, visible vía R10.3 (M1/LIM-2) y (f) aserción del orden de triggers BEFORE contra `pg_trigger` (L1). Sin tasks nuevas ni cambios de diseño.
- **2026-06-11 — Fix-loop #2 (Puerta 1 APROBADA por Raf — LIM-1/LIM-2)**: **LIM-1**: T-CL.8 y T-CL.11 ampliadas con la observación automática (2 CrudEntries/animal en masiva, 1+1 en ficha); nueva **T-CL.13** (tests: castrar → observación "Castrado" con autor; revert → "Corrección: marcado como no castrado"; N obs en masiva; `setFutureBull` sin obs); T-UI.7/T-UI.9 verifican la observación en el timeline; R13.7 en el mapa. **LIM-2**: T-DB.2 incorpora el pre-filtro + `RAISE LOG`; **T-DB.4(e) reescrita** de "aborto esperado" a "skip esperado + perfil propio aplicado + huérfano stale + log + convergencia al reactivar". T-G1.1 cerrada (PASS + Puerta 1); nueva **T-G1.2**: re-chequeo puntual de Gate 1 sobre el delta de LIM-2 (lo lanza el leader).
