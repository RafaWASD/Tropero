# Spec 02 — Delta VINCULAR LA CRÍA AL PIE (#15) — Tasks

**Status**: `spec_ready` · Delta Nivel B (ADR-028), CON BACKEND · Gate 1 OBLIGATORIO.
**Requirements**: `requirements-cria-al-pie-alta.md` (`RCAP.<n>`) · **Design**: `design-cria-al-pie-alta.md`.
**Orden de ejecución**: backend (migraciones + tests) **primero**, frontend después (decisión #2 del Gate 0). La migración la **aplica el leader** por Management API tras Gate 1 PASS + Gate 2 + reviewer; hasta entonces las suites nuevas FALLAN (`PGRST202`) — ESPERADO.

> El implementer marca `[x]`. El reviewer rechaza si queda `[ ]` sin justificación. Cada tarea cita los `RCAP.<n>` que cubre.

---

## Fase A — Backend: RPC `link_calf_to_mother` (0114)

- [x] **T1** — `supabase/migrations/0114_link_calf_to_mother_rpc.sql`: crear la RPC `link_calf_to_mother(p_mother_profile_id, p_calf_profile_id, p_event_date, p_client_op_id default null)` SECURITY DEFINER + `search_path=public`, con el orden de guards de design §2: derivar madre (a), `has_role_in` (b), ternero≠madre (c), derivar ternero scopeado al tenant de la madre (d), replay idempotente (e), "ya tiene madre" (f), insert evento+`birth_calves` (g/h). Reusa `reproductive_events.client_op_id` + índice de `0075` (NO crea schema). Cubre: RCAP.6.1, RCAP.6.2, RCAP.6.3, RCAP.6.4, RCAP.6.5, RCAP.6.6, RCAP.6.7, RCAP.6.8.
- [x] **T2** — En la misma migración: `revoke execute … (uuid,uuid,date,uuid) from public, anon` + `grant … to authenticated` + smoke-check fail-closed (patrón `0087:279`) + `comment on function` + `notify pgrst`. NO agregar policy INSERT a `birth_calves`. Cubre: RCAP.6.9, RCAP.6.10.

## Fase B — Backend: `register_birth` extendido (0115)

- [x] **T3** — `supabase/migrations/0115_register_birth_calf_rodeo.sql`: DROP `register_birth(uuid,date,jsonb,uuid)` + CREATE `register_birth(uuid,date,jsonb,uuid,uuid,text)` (6-arg) con `p_calf_rodeo_id` + `p_calf_idv` default null; resolver rodeo efectivo del ternero (NULL → rodeo de la madre; provisto → validar activo/del tenant de la madre/mismo sistema, else `23514`); usar ese rodeo en el loop; setear idv (LOW-1) + cap del tag (LOW-2) + cota de fecha (LOW-3). Cubre: RCAP.7.1, RCAP.7.2, RCAP.7.3, RCAP.7.4, RCAP.7.6. ⚠ SUPERSEDED por T4-bis (`0116`).
- [x] **T4** — En la misma migración: `revoke … (uuid,date,jsonb,uuid,uuid,text) from public, anon` + `grant … to authenticated` + `notify pgrst` (sin grant colgando de la firma vieja 4-arg). Cubre: RCAP.7.5.
- [x] **T4-bis** — `supabase/migrations/0116_register_birth_breed_id_fix.sql` *(fix Gate 2 HIGH)*: `CREATE OR REPLACE` de `register_birth` (6-arg) que **restaura la herencia de `breed_id`** de la madre al ternero (cuerpo de `0109` R1.7 + extensiones de `0115`) — `0115` se moldeó sobre `0075` y la había borrado. Aplicada por el leader. Verificada con suite SIGSA `T3 R1.7` + animal (200/200). Cubre: RCAP.7.7.

## Fase C — Backend: tests no-bypass (suite animal)

- [x] **T5** — Test happy `link_calf_to_mother`: crea 1 `reproductive_events`(birth) + 1 `birth_calves`; madre queda `nursing=true` (0067) y recomputa categoría (0046). Cubre: RCAP.10.1.
- [x] **T6** — Test re-link rechazado: ternero ya con madre → `23514`, sin filas nuevas. Cubre: RCAP.10.2 (RCAP.6.6).
- [x] **T7** — Test cross-tenant: caller sin rol en el tenant de la madre, o ternero de otro tenant → `42501`/`23503` sin tocar/revelar filas ajenas. Cubre: RCAP.10.3 (RCAP.6.3/6.4).
- [x] **T8** — Test anti-IDOR: el tenant se deriva de las filas reales; `p_mother_profile_id`/`p_calf_profile_id` ajeno rebota por authz; sin parentesco fabricado. Cubre: RCAP.10.4.
- [x] **T9** — Test idempotencia: dos invocaciones con el mismo `p_client_op_id` (misma madre) → un solo vínculo; la 2ª devuelve el id existente con `replay:true`. Cubre: RCAP.10.5 (RCAP.6.7/6.8).
- [x] **T10** — Test `register_birth` con rodeo: (a) `p_calf_rodeo_id=NULL` → ternero en rodeo de la madre (regresión); (b) rodeo válido del campo → ternero en ese rodeo; (c) rodeo de otro tenant o de otro sistema → `23514`. Cubre: RCAP.10.6 (RCAP.7.2/7.3/7.4).

## Fase D — Frontend: servicios + outbox + upload

- [x] **T11** — `outbox.ts`: `enqueueLinkCalfToMother` — intent `op_type='link_calf_to_mother'` { p_mother_profile_id, p_calf_profile_id, p_event_date } + overlay `pending_reproductive_events`(birth, madre) + `pending_birth_calves`(evento ↔ calfProfileId existente). Sin `pending_animals`/`pending_animal_profiles`. + test unitario del shape del intent/overlay. Cubre: RCAP.8.1.
- [x] **T12** — `upload.ts`: agregar `'link_calf_to_mother'` a `RPC_OP_TYPES` y a la rama de inyección de `p_client_op_id` (junto a `register_birth`/`assign_tag_to_animal`). + test de `mapIntentToRpc` (inyecta `p_client_op_id=op.id`). Cubre: RCAP.8.2, RCAP.8.3.
- [x] **T13** — `events.ts`: `linkCalfToMother(motherProfileId, calfProfileId, eventDate)` (thin sobre `enqueueLinkCalfToMother`); fecha = birth_date local del ternero ?? hoy. Extender `RegisterBirthInput` con `calfRodeoId?` → `p_calf_rodeo_id` en params + `rodeoId` del overlay del ternero. Cubre: RCAP.3.1, RCAP.3.2, RCAP.4.3.

## Fase E — Frontend: prompt + mini-form

- [x] **T14** — Prompt saltable post-create en `crear-animal.tsx`: render solo si `nursing===true`; "Ahora no" navega a la ficha sin re-crear la vaca; bloqueado si el alta falló. Cubre: RCAP.1.1, RCAP.1.2, RCAP.1.3, RCAP.1.4, RCAP.1.6.
- [x] **T15** — Captura del identificador + find-or-create: `classifyIdentifier` → `lookupByTag` (EID) / `findOrCreateLookup` (IDV); error inline si vacío/inválido; offline (lectura local). Cubre: RCAP.2.1, RCAP.2.2, RCAP.2.3, RCAP.2.4, RCAP.2.5, RCAP.1.5.
- [x] **T16** — Camino ENCONTRADO: `fetchMother` → si tiene madre, aviso sin re-vincular; si está en otro campo (`transfer`), aviso; si OK, `linkCalfToMother` + navegar con reflejo optimista. Cubre: RCAP.3.3, RCAP.3.4, RCAP.3.5.
- [x] **T17** — Camino NO ENCONTRADO: mini-form sexo(requerido, error inline si falta)/fecha(opc., es-AR)/rodeo → `registerBirth(madre,[{sex,birthDate?}],calfRodeoId)` → navegar con reflejo optimista. Cubre: RCAP.4.1, RCAP.4.2, RCAP.4.4, RCAP.4.5.
- [x] **T18** — `RodeoPicker` del ternero: rodeo de la madre preseleccionado + leyenda "(Mismo rodeo que la madre)"; editable a otro rodeo del campo del **mismo sistema**; no auto-mueve terneros existentes. Cubre: RCAP.5.1, RCAP.5.2, RCAP.5.3, RCAP.5.4, RCAP.5.5.
- [x] **T19** — MUSTs de forms: tokens (ADR-023), anti-recorte (`lineHeight`), validación inline (sin banner global que tape el título), una sola cría por invocación (cierra tras éxito). Cubre: RCAP.9.1, RCAP.9.2, RCAP.9.3, RCAP.9.4, RCAP.9.5.

## Fase F — Frontend: offline ordering + E2E

- [x] **T20** — Verificar/anotar el orden FIFO (vaca offline → `create_animal` antes que `link_calf_to_mother`) y la clasificación `permanent_reject` del rechazo de vínculo sin perder la vaca. + test de clasificación. Cubre: RCAP.8.4, RCAP.8.5.
- [x] **T21** — E2E (`app/e2e/animals.spec.ts` o suite nueva): prompt solo con cría al pie; skip preserva la vaca; vincular existente; crear+vincular con rodeo editable; aviso "ya tiene madre". Cubre: RCAP.10.7 (y sus RCAP referenciados).

## Fase G — Cierre

- [x] **T22** — Reconciliación: mapa `RCAP.<n> → archivo:test` en `progress/impl_cria-al-pie-alta.md`; reflejar cualquier fix de Gate 1/2 en estos 3 archivos antes de cerrar (regla dura `docs/specs.md`). El leader folda al baseline (puntero + bloque "Deltas posteriores") al cerrar la Puerta 2 — NO en este delta.

## Fase H — Delta bastoneo-cría-al-pie (Run 2, scan-para-llenar, 2026-07-06) · frontend puro, Gate 1 N/A

- [x] **T23** — `TagScanSheet.hideManualEntry?` (default false): con true, los controles de "¿Sin bastón?" hacen `onClose` (no `setManualMode`), `ManualTagEntry` nunca se muestra, copy "Cerrá y escribí la caravana". Default (false) NO cambia ficha/alta/parto. Ver `design-caravana-ficha.md §10.7`.
- [x] **T24** — Cablear el bastoneo en `LinkCalfPrompt` (fase ask): `TagScanCta` "Bastonear la caravana del ternero" arriba del campo; el CTA abre el `TagScanSheet` (captura + `hideManualEntry` + "Usar caravana"); `onSubmit(eid)` llena el `query` + dispara el find-or-create (`onSearch`→`runSearch(rawQuery)`); campo EID/IDV intacto como fallback / camino IDV. Ownership vía scoped scanner exclusivo (crear-animal suspende el listener global). Reconcilia RCAP.2.1. Ver `design-cria-al-pie-alta.md §11`.
- [x] **T25** — Tests: `e2e/cria-al-pie-bastoneo.spec.ts` (scan→create con oráculo server `waitForServerCalfTags`; scan→found con `waitForServerBirth`; ownership: overlay global ausente + re-suspensión al cerrar) + capture `e2e/captures/cria-al-pie-bastoneo.capture.ts` (Gate 2.5). Sin código PURO nuevo → sin unit nuevo (clasificación EID/IDV ya cubierta por `link-calf-query.test.ts`).

---

## Notas de ejecución

- **Migraciones NO se aplican desde el repo** — las aplica el leader por Management API tras Gate 1 PASS + Gate 2 + reviewer (Raf ya autorizó el deploy en Gate 0). Hasta entonces las suites backend nuevas FALLAN (`PGRST202`) — ESPERADO (patrón `0075`–`0089`).
- **Una sola feature `in_progress`**: este delta corre sobre spec 02; coordinar con el delta `alta-form-refinamiento` (también sobre spec 02) para no colisionar en `crear-animal.tsx`/`events.ts` (ambos tocan el alta). El leader gestiona el WIP.
- **Decisión de criterio propio #1** (extender `register_birth`): confirmar en Puerta 1 antes de implementar T3/T4 (ver `design` §8). Si Raf veta, sustituir por la alternativa #2 o #3.
