baseline_commit: 17596fb58cd80909c217d17a84b9335fc43a9d9d

# Impl — Delta PARTO: CARAVANA VISUAL DEL TERNERO POR CRÍA (`parto-caravana-visual-por-ternero`)

**Feature**: spec 02 (delta Nivel B, ADR-028) · **backend (RPC `register_birth`) + frontend** · Gate 1 PASS · **DEPLOY de `0121` GATEADO a Raf** (lo hace el leader).
**Spec**: `specs/active/02-modelo-animal/{context,requirements,design,tasks}-parto-caravana-visual-por-ternero.md` (`PCV.<n>`).

## Plan (T1–T16)

- T1 — Base sobre el cuerpo VIGENTE del RPC (lo pasó el leader; `reference_function_recreate_base`).
- T2 — Migración `0121` `CREATE OR REPLACE register_birth` (idv per-calf, misma firma 6-arg, fallback refinado). Banner 🔴 NO aplicar.
- T3 — Suites backend: mellizos idv distinto / dup mismo parto → 23505 rollback / dup rebaño / sin caravana → fallback / idv sin tag → visual null.
- T4 — Regresión backward-compat cría al pie (`p_calf_idv` top-level).
- T5 — (post-deploy leader) re-correr animal + SIGSA + cría al pie.
- T6 — `calf-birth.ts`: `calfIdvForSubmit(idvRaw)` per-calf + tests.
- T7 — `events.ts`: `BirthCalfInput.idv`, `calvesPayload.calf_idv` per-calf, `overlayCalves` idv per-calf precedencia, `visualFallback` refinado, conservar `calfIdv`/`p_calf_idv`.
- T8 — `agregar-evento.tsx`: `CalfRow.idvRaw`, sacar idv camada + InfoNote + props del `PartoForm`.
- T9 — `CalfBlock`: `FormField` idv per-calf `testID=calf-idv-${index}` junto al bastoneo.
- T10 — `onSubmit` birth: mapear idv per-calf, sin `calfIdv` camada.
- T11 — Opcionalidad: sin validación nueva.
- T12 — MUSTs UI (tokens, es-AR, anti-recorte, validación inline conservada).
- T13 — `waitForServerCalfIdvs` (e2e helper, oráculo).
- T14 — E2E regresión (single idv / mellizos idv distinto / ambos vacíos).
- T15 — Capture file Gate 2.5.
- T16 — Trazabilidad + reconciliación.

## Estado

**IMPLEMENTADO — pendiente reviewer + Gate 2 + DEPLOY de `0121` (leader) + Gate 2.5.**

Verificable SIN deploy (verde):
- `pnpm -C app exec tsc --noEmit` → **exit 0** (sin errores nuevos; e2e está excluido de tsc por `tsconfig.exclude`).
- `calf-birth.test.ts` (runner del proyecto, `ts-ext-resolver`) → **16/16 pass**.
- `node scripts/check.mjs --fast` → **anti-hardcode 0 violaciones**, entorno OK.

PENDIENTE del deploy de `0121` (lo hace el LEADER por Supabase MCP con autorización de Raf):
- **T3/T4** suites backend (`supabase/tests/animal/run.cjs`, suite `spec 02 delta parto-caravana-visual`) → FALLAN con el RPC viejo (idv escalar ignora `calf_idv` per-elemento) — ESPERADO. NO correr esperando verde.
- **T5** re-correr TODAS las suites que tocan el RPC (animal + SIGSA breed_id + cría al pie) POST-deploy.
- **T14** E2E de regresión (`events.spec.ts`, 3 tests nuevos) → el idv per-calf no persiste con el RPC viejo → FALLAN hasta el deploy.
- **T15** capture (`parto-caravana-visual-por-ternero.capture.ts`) → lo corre el leader para el veto visual del Gate 2.5.

## Archivos creados / modificados

**Backend (deploy gateado):**
- `supabase/migrations/0121_register_birth_calf_idv_per_calf.sql` — **CREADO**. `CREATE OR REPLACE register_birth` (misma firma 6-arg), 3 cambios exactos sobre el cuerpo vigente: (a) sacar idv de antes del loop; (b) idv per-cría dentro del loop con `coalesce(calf_idv, p_calf_idv)`; (c) fallback `visual_id_alt` refinado a both-null. Banner 🔴 NO aplicar.
- `supabase/tests/animal/run.cjs` — **MODIFICADO**: suite `spec 02 delta parto-caravana-visual — register_birth idv POR CRÍA (0121)` (9 tests) + regresión cría al pie.

**Frontend (verificable sin deploy):**
- `app/src/utils/calf-birth.ts` + `calf-birth.test.ts` — **MODIFICADO**: `calfIdvForSubmit(idvRaw)` per-calf (sin gate de longitud) + tests actualizados.
- `app/src/services/events.ts` — **MODIFICADO**: `BirthCalfInput.idv?`, `calvesPayload.calf_idv` per-calf, `overlayCalves` idv per-calf con precedencia + `visualFallback` refinado, conservado `calfIdv`/`p_calf_idv` para cría al pie.
- `app/app/agregar-evento.tsx` — **MODIFICADO**: `CalfRow.idvRaw`, sacado idv camada + InfoNote + props del `PartoForm`, `FormField` idv per-calf en `CalfBlock` (`testID=calf-idv-${index}`), `onSubmit` mapea idv per-calf.
- `app/src/components/FormField.tsx` — **MODIFICADO**: prop `testID?` OPCIONAL ADITIVO → `<TextInput>` (RN-web `data-testid`). Reconciliación as-built (design §1). Backward-compat: callers previos sin cambio.

**E2E (escrito, run gateado por deploy):**
- `app/e2e/helpers/admin.ts` — **MODIFICADO**: `waitForServerCalfIdvs(motherProfileId, expectedIdvs)` (oráculo, lee `animal_profiles.idv`).
- `app/e2e/events.spec.ts` — **MODIFICADO**: import de oráculos + 3 tests nuevos (PCV.8.5 a/b/c); REEMPLAZADO el viejo `delta parto-rodeo-caravana` test (asertaba UI SUPERADA).
- `app/e2e/captures/parto-caravana-visual-por-ternero.capture.ts` — **CREADO** (Gate 2.5): 3 capturas (single vacío / single lleno / mellizos 2 idv).

## Mapa de trazabilidad PCV.<n> → test/archivo (PCV.8.7)

| Requirement | Cobertura |
|---|---|
| PCV.1.1 idv por CalfBlock en el form | e2e `events.spec.ts` "1 ternero con idv" (`calf-idv-0` visible) + capture `01` |
| PCV.1.2 single Y mellizos | e2e "mellizos con idv DISTINTO" (`calf-idv-0`/`calf-idv-1`) + capture `03` |
| PCV.1.3 sanitizar en vivo | `agregar-evento.tsx` CalfBlock `onChangeText=sanitizeIdvInput`; e2e single (leading-zero preservado) |
| PCV.1.4 idv por ternero, no mezcla | e2e mellizos (`calf-idv-0` retiene su valor tras tipear `calf-idv-1`) + capture `03` |
| PCV.1.5 sin campo camada ni nota | e2e single/mellizos `toHaveCount(0)` de la nota + capture `01` |
| PCV.1.6 label "(opcional)" | CalfBlock `FormField label="Caravana visual del ternero (opcional)"`; capture `01` |
| PCV.2.1 confirmar sin caravana | e2e "parto SIN ninguna caravana" (case c) |
| PCV.2.2 sin validación client | `events.ts`/`event-input` `validateCalves` INTACTO (no valida idv/tag); e2e case c |
| PCV.2.3 server no exige idv/tag | backend `PCV.2.3/2.4: ternero sin idv ni tag → creado OK` |
| PCV.2.4 fallback both-null | backend `PCV.2.3/2.4: … visual_id_alt = fallback`; overlay `events.ts` |
| PCV.3.1 idv per-calf → registerBirth | `calf-birth.test.ts` `calfIdvForSubmit`; `events.ts calvesPayload.calf_idv`; e2e a/b (oráculo) |
| PCV.3.2 sin calfIdv camada del parto | `agregar-evento.tsx onSubmit` (no pasa `calfIdv`); `events.ts` params |
| PCV.3.3 idv vacío → omitido | `calf-birth.test.ts` `calfIdvForSubmit('') → null` |
| PCV.3.4 resto del payload intacto | e2e single (Rodeo "Destete" persiste; RPRC.1) |
| PCV.4.1 misma firma 6-arg | `0121` (CREATE OR REPLACE, sin DROP); todos los tests backend llaman la firma 6-arg |
| PCV.4.2 idv por cría dentro del loop | backend `PCV.5.1/5.2` (mellizos distinto) + `PCV.4.3` precedencia |
| PCV.4.3 precedencia per-calf → param | backend `PCV.4.3: el calf_idv del elemento GANA sobre p_calf_idv` |
| PCV.4.4 insert idv per-calf | backend `PCV.5.1/5.2` (ambos `animal_profiles.idv` persisten) |
| PCV.4.5 fallback refinado | backend `PCV.4.5: idv sin tag → visual_id_alt null`; overlay `events.ts` |
| PCV.4.6 nada más cambia | backend `PCV.4.6: regresión mellizos sin caravana` (fallback + rodeo madre) |
| PCV.4.7 moldear sobre el vigente | `0121` moldeado sobre el cuerpo vigente (leader) — banner + comentario |
| PCV.5.1/5.2 mellizos idv independiente/distintos | backend `PCV.5.1/5.2`; e2e mellizos |
| PCV.5.3 duplicado (parto/rebaño) → 23505 rollback | backend `PCV.5.3` (mismo parto) + `PCV.5.3` (rebaño) — 23505 + 0/0 |
| PCV.5.4 23505 permanente + surface es-AR sin crash | as-built `uploadData`/`upload-classify` (sin código nuevo; cubierto por `upload-rejections.test.ts`); el 23505 lo prueba backend `PCV.5.3` |
| PCV.6.1 cría al pie con p_calf_idv | backend `PCV.6.1: cría al pie` |
| PCV.6.2 events.ts conserva calfIdv/p_calf_idv | `events.ts` (caller `LinkCalfPrompt` INTACTO); backend `PCV.6.1` |
| PCV.7.1/7.2/7.3 reconciliación RPRC | tasks + reemplazo del test viejo; fold al baseline = leader (Puerta 2) |
| PCV.8.1 solo tokens | `check --fast` anti-hardcode 0 violaciones (idv reusa FormField tokens-only) |
| PCV.8.2 anti-recorte | FormField label sin `numberOfLines` (no trunca) → N/A en el campo nuevo |
| PCV.8.3 validación inline conservada, sin banner nuevo | sin validación de caravana nueva; `validateCalves` intacto |
| PCV.8.4 capture | `parto-caravana-visual-por-ternero.capture.ts` (3 shots) |
| PCV.8.5 E2E (single / mellizos distinto / ambos vacíos) | `events.spec.ts` 3 tests nuevos |
| PCV.8.6 regresión cría al pie | backend `PCV.6.1` |
| PCV.8.7 trazabilidad | esta tabla |

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:

1. **¿El overlay optimista matchea el `visual_id_alt` del RPC (both-null → fallback)?** SÍ. RPC: `case when v_calf_tag is null and v_calf_idv is null then '<fallback>' else null end` con `v_calf_idv = coalesce(calf_idv, p_calf_idv)`. Overlay `events.ts`: `const idv = cleanStr(c.idv) ?? calfIdv; visualFallback = tag == null && idv == null ? 'recién nacido — pendiente de caravana' : null`. Misma lógica, **misma string exacta**. Evita el flash inconsistente antes del ACK.
2. **¿El parto dejó de mandar `calfIdv` camada pero cría al pie lo conserva?** SÍ. `agregar-evento.tsx onSubmit` ya no pasa `calfIdv` (manda `calves[].idv`). `LinkCalfPrompt.tsx:400-405` sigue con `calfIdv: identifier.idv` y `calves:[{sex, tag}]` (sin idv per-calf) → `events.ts` cae por `cleanStr(c.idv) ?? calfIdv` = top-level, y `params.p_calf_idv = calfIdv`. El RPC lo resuelve por el `coalesce` (backward-compat #15).
3. **¿El `CalfBlock` idv tiene `testID` indexado?** SÍ, `testID={`calf-idv-${index}`}`. Requirió agregar `testID?` a `FormField` (aditivo; reconciliado en design §1).
4. **¿Imports muertos?** Verificado por grep: `calfIdvForSubmit` (1-arg) solo en `agregar-evento.tsx` + test; `registerBirth` en 2 callers coherentes; `sanitizeIdvInput`/`InfoNote`/`FormField` siguen usados. tsc exit 0.
5. **Precedencia per-calf (bug de precedencia).** Agregué un test backend explícito `PCV.4.3` (elemento gana sobre top-level) — el matriz del design §2 lo exige y es fácil de invertir por error.
6. **Rollback atómico (23505).** Contraprueba con `birthState()` before/after (0 eventos / 0 terneros) tanto para el dup del mismo parto como para la colisión con el rebaño.
7. **Opcionalidad = trigger, no column-check.** El test `PCV.2.3/2.4` verifica `visual_id_alt = FALLBACK` en el both-null: SIN ese fallback el INSERT del profile sería 23514 (el trigger `animal_profiles_identity_check`). El fallback es LOAD-BEARING (banner en `0121` + design §5).
8. **Multi-tenant.** El RPC deriva el tenant de la fila real de la madre + `has_role_in` (sin cambio); la unicidad del idv es `(establishment_id, idv)` scopeada; el cliente nunca pasa `establishment_id`. Cross-tenant ya cubierto por la suite existente `caso 2` (sin regresión — `PCV.4.6` no lo toca).
9. **Orden `v.value` vs `calves`.** `validateCalves` devuelve `v.value` en el MISMO orden que `calves` (los drafts se arman `calves.map`) → el zip por índice `calves[i].idvRaw` es correcto (design §1.4). El e2e mellizos lo ejercita (idv0/idv1 distintos por posición).

Hallazgos → todo consistente; sin fixes adicionales necesarios más allá del `testID` de FormField (previsto por el design).

## Reconciliación de specs (paso 9)

- **`design-...` §1** — anotada la reconciliación as-built: `FormField` ganó `testID?` opcional aditivo (el design asumía que ya lo aceptaba).
- **`tasks-...`** — T1–T16 marcadas con su estado (T5 pendiente del deploy del leader; T3/T4/T14/T15 escritas, run gateado).
- El *qué* declarado (PCV.<n>) NO cambió → sin nota de reconciliación en `requirements-...`.
- **Fold al baseline + al delta madre** (RPRC.2.1/2.3/2.4 + RPRC.3.2/3.3 "SUPERADA"; alternativa #1 de `design-parto-rodeo-caravana §7` RESUELTA; el capture viejo del delta madre a deprecar) = **lo hace el leader al cerrar la Puerta 2** (design §8) — NO en este delta.

## Notas para el leader

1. **DEPLOY de `0121`** (Supabase MCP, autorización de Raf) — sin él, T3/T4/T5 + los 3 E2E de PCV.8.5 fallan (RPC viejo). Post-deploy re-correr animal + SIGSA (breed_id) + cría al pie (T5).
2. **Gate 2.5**: correr `parto-caravana-visual-por-ternero.capture.ts` para el veto visual (single + mellizos con idv por cría).
3. **Capture viejo del delta madre** `parto-rodeo-caravana.capture.ts`: ahora aserta UI SUPERADA (idv camada single + nota mellizos). NO lo toqué (constraint "no tocar delta madre"). Deprecarlo/foldearlo al cerrar la Puerta 2 del delta madre.
4. `reference_e2e_design_png_rerender`: si se corre `e2e:build`, revertir `design/**/*.png` antes de commitear; NO `git add` de `__shots__/`.
