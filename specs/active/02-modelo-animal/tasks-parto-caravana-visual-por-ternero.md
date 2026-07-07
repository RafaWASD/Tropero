# Spec 02 — Delta PARTO: CARAVANA VISUAL DEL TERNERO **POR CRÍA** — Tasks

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 02 (feature `done`/`deferred`) · **backend (RPC) + frontend** · **Gate 1 APLICA** · **DEPLOY gateado a Raf**.
**Requirements**: `requirements-parto-caravana-visual-por-ternero.md` (`PCV.<n>`) · **Design**: `design-parto-caravana-visual-por-ternero.md`.
**Orden**: backend (migración + Gate 1 + suites) → frontend (agregar-evento / events.ts / calf-birth) → E2E + capture → cierre. El **deploy** de la migración lo hace el **leader por Supabase MCP con autorización de Raf** — NO el implementer.

> El implementer marca `[x]`. El reviewer rechaza si queda `[ ]` sin justificación. Cada tarea cita los `PCV.<n>` que cubre. **Etiquetas**: **[BACKEND / Gate 1]** = toca `supabase/` (deploy gateado); **[FRONTEND]** = frontend puro. NO tocar `specs/done/` ni el `tasks.md` del baseline ni del delta madre.

---

## Fase A — Backend: RPC `register_birth` idv por cría (Gate 1 + deploy gateado)

- [ ] **T1** — **[BACKEND / Gate 1]** Antes de escribir, **obtener el cuerpo VIGENTE del RPC `register_birth` del remoto** (el leader lo pasa) y moldear sobre ÉL, no sobre `0116` a ciegas (`reference_function_recreate_base`). Confirmar que la base tenga: herencia de `breed_id` (R1.7), `p_calf_rodeo_id` (23514), idempotencia HIGH-D1, cota de `p_event_date`, cap del tag ≤15. Cubre: PCV.4.7.
- [ ] **T2** — **[BACKEND / Gate 1]** Crear `supabase/migrations/0121_register_birth_calf_idv_per_calf.sql`: `CREATE OR REPLACE FUNCTION public.register_birth(...)` con la **MISMA firma 6-arg** (sin `DROP`). (a) **sacar** el `v_calf_idv := nullif(trim(coalesce(p_calf_idv,'')),'')` de antes del loop; (b) **dentro** del loop, junto a la lectura de `calf_tag_electronic`, computar `v_calf_idv := coalesce( nullif(trim(coalesce(v_calf->>'calf_idv','')),''), nullif(trim(coalesce(p_calf_idv,'')),'') )`; (c) refinar `visual_id_alt = case when v_calf_tag is null and v_calf_idv is null then v_visual_fallback else null end`. Nada más cambia. Re-aplicar `revoke public/anon` + `grant authenticated` + `notify pgrst`. Banner "🔴 NO aplicar desde acá — lo aplica el leader por Supabase MCP con autorización de Raf". Cubre: PCV.4.1, PCV.4.2, PCV.4.3, PCV.4.4, PCV.4.5, PCV.4.6, PCV.2.3, PCV.2.4.
- [ ] **T3** — **[BACKEND / Gate 1]** Extender las suites backend de `register_birth` (donde vivan parto/mellizos — `supabase/tests/animal/` o equivalente): (a) mellizos con `calf_idv` **distinto** cada uno → ambos `animal_profiles.idv` persisten; (b) idv **duplicado** en el mismo parto (dos crías, mismo `calf_idv`) → **23505** + **rollback atómico** (0 eventos / 0 terneros, contraprueba); (c) idv que **colisiona con el rebaño** → 23505; (d) ternero **sin idv ni tag** → creado con `visual_id_alt = fallback` (opcionalidad; esto **guarda el trigger `animal_profiles_identity_check`** — sin el fallback el INSERT del profile sería `23514`, ver design §5); (e) ternero con idv sin tag → `visual_id_alt = null` (el idv satisface el trigger). Cubre: PCV.5.1, PCV.5.2, PCV.5.3, PCV.2.3, PCV.2.4, PCV.4.5.
- [ ] **T4** — **[BACKEND / Gate 1]** Regresión de **backward-compat cría al pie (#15)**: llamar al RPC con `p_calf_idv` top-level y **sin** `calf_idv` en el elemento (1 cría) → el ternero se crea con ese idv (cae por el `coalesce`). Cubre: PCV.6.1.
- [ ] **T5** — **[BACKEND / Gate 1]** Tras el deploy (leader), **re-correr TODAS las suites que tocan el RPC**: la de `register_birth`/parto/mellizos + **SIGSA** (verificar que la herencia de `breed_id` sigue intacta — el `CREATE OR REPLACE` no la borró, `reference_function_recreate_base`) + la regresión de cría al pie (#15). Cubre: PCV.4.6, PCV.6.1.

## Fase B — Frontend: idv per-calf en el form de parto

- [ ] **T6** — **[FRONTEND]** `app/src/utils/calf-birth.ts` (+ `calf-birth.test.ts`): reemplazar `calfIdvForSubmit(calvesLength, idvRaw)` (gateado por longitud de camada, obsoleto) por `calfIdvForSubmit(idvRaw: string): string | null` = `idvRaw.trim() || null` **per-calf** (sin gate de longitud). Actualizar los tests (los casos "mellizos → null" pasan a "cada cría con su idv"). `resolveEffectiveCalfRodeoId`/`resolveMotherSystemId`/`eligibleCalfRodeos`/`canEditCalfRodeo` **sin cambios**. Cubre: PCV.3.1, PCV.3.3.
- [ ] **T7** — **[FRONTEND]** `app/src/services/events.ts`: `BirthCalfInput` gana `idv?: string | null`; `calvesPayload` mapea `calf_idv` per-calf (`const idv = cleanStr(c.idv); if (idv) payload.calf_idv = idv;`); `overlayCalves` usa `idv: cleanStr(c.idv) ?? cleanStr(input.calfIdv)` (precedencia per-calf, espeja el `coalesce` del RPC); `visualFallback` refinado a `(tag == null && idvDeLaCría == null) ? '<fallback>' : null`. **CONSERVAR** `RegisterBirthInput.calfIdv` + `params.p_calf_idv` para el caller de cría al pie. Cubre: PCV.3.1, PCV.3.3, PCV.4.5, PCV.6.2.
- [ ] **T8** — **[FRONTEND]** `app/app/agregar-evento.tsx`: `CalfRow` gana `idvRaw: string`; `newCalf()` la inicializa `''`. **Eliminar** el estado `calfIdv`/`setCalfIdv` a nivel screen, el `FormField` de caravana visual a nivel camada y el `InfoNote` de mellizos del `PartoForm`; quitar las props `calfIdv`/`onCalfIdv` de `PartoForm`. Cubre: PCV.1.5.
- [ ] **T9** — **[FRONTEND]** `CalfBlock`: agregar un `FormField` "Caravana visual del ternero (opcional)" (idv) `keyboardType="number-pad"`, `placeholder="Ej. 0234"`, `onChangeText={(t) => onUpdate({ idvRaw: sanitizeIdvInput(t) })}`, **ubicado junto a la caravana electrónica** (bastoneo) del mismo bloque, con `testID={`calf-idv-${index}`}`. Aplica a single y mellizos (cada `CalfBlock` su idv). Cubre: PCV.1.1, PCV.1.2, PCV.1.3, PCV.1.4, PCV.1.6.
- [ ] **T10** — **[FRONTEND]** `onSubmit` (`eventType==='birth'`): dejar de pasar `calfIdv` a `registerBirth`; mapear el idv per-calf: `calves: v.value.map((c, i) => ({ sex: c.sex, weightKg: c.weightKg, tag: c.tag, idv: calfIdvForSubmit(calves[i].idvRaw) }))`. Conservar `calfRodeoId: effectiveCalfRodeoId` (RPRC.1 intacto). Cubre: PCV.3.1, PCV.3.2, PCV.3.3, PCV.3.4.

## Fase C — Opcionalidad + MUSTs de UI de campo

- [ ] **T11** — **[FRONTEND]** Confirmar que **ninguna** validación client-side fuerza idv ni tag: el submit valida solo fecha + sexo por ternero (`validateCalves`, sin cambios); idv/tag vacíos son válidos y se omiten. Sin banner global nuevo. Cubre: PCV.2.1, PCV.2.2, PCV.8.3.
- [ ] **T12** — **[FRONTEND]** MUSTs de forms sobre lo nuevo: **solo tokens** (ADR-023 §4, sin hex/px), **es-AR** voseo, **anti-recorte** (`lineHeight` matcheado en headings ≥`$6` y todo `Text` con `numberOfLines`), validación inline conservada. Cubre: PCV.8.1, PCV.8.2, PCV.8.3.

## Fase D — E2E + Gate 2.5 (D6)

- [ ] **T13** — **[FRONTEND]** `app/e2e/helpers/admin.ts`: crear `waitForServerCalfIdvs(motherProfileId, expectedIdvs)` — análogo a `waitForServerCalfTags` pero leyendo `animal_profiles.idv` (cadena `reproductive_events(birth) → birth_calves.calf_profile_id → animal_profiles.idv`). Cubre: PCV.8.5 (oráculo).
- [ ] **T14** — **[FRONTEND]** E2E de regresión en `app/e2e/events.spec.ts` (o `parto-bastoneo.spec.ts`), import de `test`/`expect` desde `./helpers/fixtures`: (a) **1 ternero con idv** → guardar → `waitForServerCalfIdvs([idv0])`; (b) **mellizos con idv DISTINTO** (calf-idv-0 / calf-idv-1) → guardar → `waitForServerCalfIdvs([idv0, idv1])` + `expect(idv0).not.toBe(idv1)`; (c) **ambos vacíos** (ningún idv ni tag) → guardar → `waitForServerBirth({expectedCalves})` OK + verificar que los terneros quedan sin idv (opcionalidad). Correr la suite. Cubre: PCV.8.5. Ojo `reference_e2e_design_png_rerender`: NO `git add -A` tras un e2e; revertir `design/**` antes de commitear.
- [ ] **T15** — **[FRONTEND]** Capture file `app/e2e/captures/parto-caravana-visual-por-ternero.capture.ts` (Gate 2.5, ADR-029) con capturas nombradas: (a) **parto single** con el campo idv dentro del bloque del ternero; (b) **parto mellizos** (2 terneros) con **un campo idv por cada ternero** (sin el viejo campo camada ni la nota). El leader veta visualmente antes de la Puerta 2. Cubre: PCV.8.4.

## Fase E — Cierre

- [ ] **T16** — Reconciliación (regla dura `docs/specs.md` + memoria `feedback_correcciones_en_specs`): mapa `PCV.<n> → archivo:test` en `progress/impl_parto-caravana-visual-por-ternero.md`; reflejar cualquier fix de la autorrevisión / Gate 1 / Gate 2 en estos 3 archivos **antes** de cerrar/commitear. El **fold al baseline + al delta madre** (nota de reconciliación bajo RPRC.2.1/2.3/2.4 y RPRC.3.2/3.3 = "SUPERADA por `parto-caravana-visual-por-ternero`"; marcar RESUELTA la alternativa #1 de `design-parto-rodeo-caravana.md §7`) lo hace el **leader** al cerrar la Puerta 2 — **NO** en este delta. Cubre: PCV.7.1, PCV.7.2, PCV.7.3, PCV.8.7.

---

## Notas de ejecución

- **Backend gateado**: la migración `0121` es la **única** parte con Gate 1 + deploy. NO se aplica desde el archivo; la aplica el **leader por Supabase MCP con autorización de Raf** (`project_supabase_mcp_write`). Hasta el deploy, la suite del RPC con `calf_idv` per-calf FALLA (comportamiento viejo) — esperado (patrón 0075-0089).
- **Moldear sobre el vigente** (T1): re-CREATE de función → base en el cuerpo **vigente del remoto**, no en una migración citada (`reference_function_recreate_base`). Re-correr **animal + SIGSA + cría al pie** tras el deploy (T5).
- **Firma inalterada**: `CREATE OR REPLACE` (no `DROP`+`CREATE`) — la firma 6-arg ya existe (`0116`). No se tocan grants/overloads.
- **Constraint duro de Raf (PCV.2)**: ambas caravanas SIEMPRE opcionales — ninguna validación (client ni server) fuerza cargarlas. La opcionalidad es segura por el fallback `visual_id_alt` en el caso both-null (§5 del design).
- **RPRC.1 / RPRC.2.5 intactos**: el rodeo del parto sigue escalar a nivel camada; el tag electrónico sigue por cría (bastoneo RCF.6). Solo la **visual** pasa a per-calf.
- **WIP**: coordinar con otros deltas sobre spec 02 que tocan `agregar-evento.tsx` / `events.ts` / `calf-birth.ts` para no colisionar (el leader gestiona el WIP; memoria `feedback_parallel_terminals`).
