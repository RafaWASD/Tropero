# Review — Delta PARTO: CARAVANA VISUAL DEL TERNERO POR CRIA (parto-caravana-visual-por-ternero)

Reviewer: reviewer (Opus 4.8) - Fecha: 2026-07-07 - Baseline: 17596fb
Spec: specs/active/02-modelo-animal/{context,requirements,design,tasks}-parto-caravana-visual-por-ternero.md (PCV.n)

## Veredicto: APPROVED

Delta Nivel B (ADR-028), backend (RPC) + frontend, DEPLOY de 0121 GATEADO a Raf. Verifique la CORRECTITUD
del codigo (migracion + tests escritos), no su ejecucion backend/e2e (esperado rojo con el RPC viejo, no es
motivo de rechazo per el contexto de gates). Lo verificable sin deploy quedo verde.

## Verificaciones ejecutadas (sin deploy)

- pnpm -C app exec tsc --noEmit  -> exit 0.
- calf-birth.test.ts (runner ts-ext-resolver desde raiz) -> 16/16 pass.
- node scripts/check.mjs --fast  -> exit 0, anti-hardcode 0 violaciones (app/app + app/src/components).
- Suites backend / e2e / e2e:build -> NO corridas (deploy-gated; correctitud verificada por lectura).

## 1. Migracion 0121 (PCV.4)

Comparada linea a linea contra el cuerpo vigente (0116, ultima definicion; no hay migracion intermedia que lo
redefina). Solo los 3 cambios previstos + comentarios/reformateo del declare (semanticamente identico):
- (a) 0121:90 - el v_calf_idv pre-loop SACADO (queda comentario). OK, PCV.4.2.
- (b) 0121:106-109 - coalesce(calf_idv del elemento, p_calf_idv) DENTRO del loop, junto a
  calf_tag_electronic. OK exacto al design seccion 2b, PCV.4.3.
- (c) 0121:126 - fallback visual_id_alt solo cuando v_calf_tag is null AND v_calf_idv is null. OK exacto al
  design seccion 2c, PCV.4.5.
- Firma 6-arg INALTERADA (CREATE OR REPLACE, sin DROP). PCV.4.1.
- revoke ... from public, anon + grant ... to authenticated misma firma 6-arg + notify pgrst. OK.
- Banner NO-aplicar + nota LOAD-BEARING del fallback (trigger animal_profiles_identity_check). OK.
- PCV.4.6 (nada mas cambia): auth de la fila real / has_role_in 42501 / idempotencia HIGH-D1 / cota fecha /
  validacion array / rodeo del ternero 23514 / cap tag <=15 / herencia breed_id / inserts / atomicidad intactos.

## 2. Frontend (design seccion 1)

- calf-birth.ts:72 - calfIdvForSubmit(idvRaw) = idvRaw.trim() OR null (sin gate de longitud). Tests 16/16.
  PCV.3.1/3.3.
- events.ts - BirthCalfInput.idv OK; calvesPayload mapea calf_idv per-calf OK; overlayCalves idv =
  cleanStr(c.idv) ?? calfIdv (precedencia per-calf) OK; visualFallback = tag null AND idv null ? fallback :
  null (misma string exacta que el RPC) OK; RegisterBirthInput.calfIdv + params.p_calf_idv CONSERVADOS para
  cria al pie OK. PCV.3.1/3.3/4.5/6.2.
- agregar-evento.tsx - CalfRow.idvRaw + newCalf init vacio OK; estado calfIdv/setCalfIdv + FormField camada +
  InfoNote mellizos + props calfIdv/onCalfIdv + singleCalf ELIMINADOS del PartoForm OK; FormField idv en
  CalfBlock (testID calf-idv-index, sanitizeIdvInput en vivo, junto al bastoneo) OK; onSubmit mapea idv
  per-calf zippeando por indice calves[i].idvRaw, sin calfIdv camada OK. PCV.1.1-1.6/3.2.

## 3. Oraculo de completitud (imports/props muertos)

- calfIdv/onCalfIdv/setCalfIdv/singleCalf -> 0 residuos en agregar-evento.tsx (solo comentarios).
- InfoNote -> sigue usado (linea 618, error missing params, uso legitimo distinto de la nota de mellizos).
- calfIdvForSubmit (1-arg) -> call-sites: agregar-evento.tsx:508 + calf-birth.test.ts. 0 llamadas 2-arg viejas.
- CalfBlock recibe index + onUpdate; onUpdate idvRaw -> updateCalf(localId, patch) merge inmutable -> no
  mezcla mellizos (PCV.1.4).
- Caller cria al pie LinkCalfPrompt.tsx:400-405 -> calves [sex,tag] (sin idv per-calf) + calfIdv top-level ->
  coalesce cae al p_calf_idv (backward-compat #15). PCV.6.
- waitForServerBirth / getServerBirthState existen con el shape usado; seedAnimal devuelve profileId.

## 4. Constraint de Raf (PCV.2)

- validateCalves (event-input.ts:241) INTACTO: no agrega idv, no valida idv/tag; 1:1 en orden (sin filtrar).
- idv/tag vacio -> omitido (calfIdvForSubmit de vacio -> null; tag trim vacio -> null).
- Fallback both-null LOAD-BEARING (server + overlay), documentado en migracion + design seccion 5 (trigger,
  no el column-check no-op).
- Sin validacion client-side nueva ni banner global.

## 5. FormField testID (componente compartido)

FormField.tsx - prop testID OPCIONAL y ADITIVO, pasado al TextInput (RN-web -> data-testid). Backward-compat:
callers previos sin testID -> comportamiento identico. Reconciliado en design seccion 1. OK.

## 6. Exactitud specs (codigo -> spec)

design.md seccion 1 reconciliado con el as-built (FormField testID). requirements.md sin cambios (el que
PCV.n no cambio). El design NO quedo mintiendo: los 3 cambios del RPC, el frontend per-calf, la conservacion
de calfIdv/p_calf_idv y la matriz de resolucion coinciden con el codigo. Sin contradiccion.

## 7. Trazabilidad PCV.n <-> test (completa)

- PCV.1.1 idv por CalfBlock            -> e2e (a) calf-idv-0 visible + capture 01
- PCV.1.2 single Y mellizos            -> e2e (b) calf-idv-0/calf-idv-1 + capture 03
- PCV.1.3 sanitizar en vivo            -> agregar-evento.tsx:1587 sanitizeIdvInput; e2e leading-zero
- PCV.1.4 no mezcla per-calf           -> e2e (b) calf-idv-0 retiene tras tipear calf-idv-1; updateCalf merge
- PCV.1.5 sin campo camada ni nota     -> e2e (a)/(b) toHaveCount(0) nota + capture 01/03
- PCV.1.6 label (opcional)             -> CalfBlock FormField label; capture 01
- PCV.2.1 confirmar sin caravana       -> e2e (c) parto sin ninguna caravana
- PCV.2.2 sin validacion client        -> validateCalves intacto; e2e (c)
- PCV.2.3 server no exige idv/tag       -> backend PCV.2.3/2.4
- PCV.2.4 fallback both-null           -> backend PCV.2.3/2.4 (visual_id_alt=fallback); overlay events.ts
- PCV.3.1 idv per-calf -> registerBirth-> calf-birth.test.ts; events.ts calvesPayload; e2e (a)/(b) oraculo
- PCV.3.2 sin calfIdv camada           -> agregar-evento onSubmit (no pasa calfIdv); events.ts params
- PCV.3.3 idv vacio omitido            -> calf-birth.test.ts calfIdvForSubmit de vacio -> null
- PCV.3.4 resto payload intacto        -> e2e (a) Rodeo Destete persiste (RPRC.1)
- PCV.4.1 misma firma 6-arg            -> 0121 CREATE OR REPLACE
- PCV.4.2/4.4 idv por cria loop/insert -> backend PCV.5.1/5.2
- PCV.4.3 precedencia per-calf         -> backend PCV.4.3 (elemento gana sobre p_calf_idv)
- PCV.4.5 fallback refinado            -> backend PCV.4.5 (idv sin tag -> visual null)
- PCV.4.6 nada mas cambia              -> backend PCV.4.6 (regresion mellizos) + diff vs 0116
- PCV.4.7 moldear sobre el vigente     -> 0121 = 0116 + 3 cambios (verificado por diff)
- PCV.5.1/5.2 mellizos distinto        -> backend PCV.5.1/5.2; e2e (b)
- PCV.5.3 dup (parto/rebano) -> 23505  -> backend PCV.5.3 x2 (rollback 0/0 contraprueba)
- PCV.5.4 23505 permanente + surface   -> upload-classify.ts (23505 clase 23 -> permanente as-built) +
                                          upload-rejections.test.ts; el 23505 lo prueba backend PCV.5.3
- PCV.6.1 cria al pie con p_calf_idv   -> backend PCV.6.1
- PCV.6.2 events.ts conserva calfIdv   -> LinkCalfPrompt.tsx:400-405 intacto; backend PCV.6.1
- PCV.7.1/7.2/7.3 reconciliacion RPRC  -> reemplazo del test viejo; fold al baseline = leader (Puerta 2)
- PCV.8.1 solo tokens                  -> check --fast 0 violaciones
- PCV.8.2 anti-recorte                 -> FormField label sin numberOfLines -> N/A campo nuevo
- PCV.8.3 validacion inline conservada -> sin validacion nueva; validateCalves intacto
- PCV.8.4 capture                      -> parto-caravana-visual-por-ternero.capture.ts (3 shots)
- PCV.8.5 E2E a/b/c                     -> events.spec.ts 3 tests con waitForServerCalfIdvs/waitForServerBirth
- PCV.8.6 regresion cria al pie        -> backend PCV.6.1
- PCV.8.7 trazabilidad                 -> esta tabla + impl_...md

Cada PCV.n tiene >=1 test concreto.

## 8. Tasks completas: SI

T1-T4, T6-T16 en [x]. T5 en [ ] con justificacion documentada: paso post-deploy del LEADER (re-correr animal +
SIGSA + cria al pie tras aplicar 0121), explicitamente NO del implementer. Justificacion valida -> no bloquea.

## 9. CHECKPOINTS

- C1 harness completo - [x] (check --fast exit 0; suite completa gateada por deploy)
- C2 estado coherente - [x]
- C3 arquitectura - [x] (sin capas nuevas; sin establishment_id hardcodeado; migracion bien comentada; sin logs)
- C4 verificacion real - [x] (tests escritos; ejecucion backend/e2e gateada por deploy, esperado)
- C5 sesion - [ ] N/A (lo cierra el leader en la Puerta 2)
- C6 SDD - [x] (3 docs de spec, EARS, cada PCV mapeado, T5 justificada)
- C7 multi-tenant - [x] (sin tablas nuevas; idv unique (establishment_id, idv) server-side derivado de la fila
  real; cross-tenant cubierto por suite existente caso 2)
- C8 offline-first - [x] (outbox enqueueRegisterBirth intacta; 23505 permanente as-built)
- C9 E2E + visual - [x] con caveat deploy-gate (suite de regresion escrita, capture file presente, __shots__
  gitignoreado, Gate 2.5 lo corre el leader)

## 10. Checklist RAFAQ-especifico

- A. Multi-tenancy/RLS - N/A tablas nuevas. Tenant-safety verificado: idv unique (establishment_id, idv)
  server-side; cliente nunca pasa establishment_id; has_role_in(v_est) -> 42501.
- B. Offline-first - [x] outbox intacta; rechazo 23505 clasificado permanente (upload-classify.ts); el form no
  hace requests sincronos (usa registerBirth -> outbox).
- C. BLE - N/A (no toca BLE; el bastoneo electronico RCF.6 queda intacto).
- D. UI de campo - [x] FormField reusado (tokens-only, ADR-023 certificado); es-AR; una decision por card;
  anti-recorte OK (label sin numberOfLines); loading (submitting) visible.
- E. Edge Functions - N/A (es RPC security-definer, no Edge Function; igual valida has_role_in antes de operar).

## 11. Notas para el leader

- Aplicar 0121 por Supabase MCP (autorizacion de Raf); luego re-correr T5 (animal + SIGSA breed_id + cria al
  pie) + los 3 e2e de PCV.8.5.
- Gate 2.5: correr parto-caravana-visual-por-ternero.capture.ts para el veto visual.
- Fold al baseline + delta madre (RPRC.2.1/2.3/2.4 + RPRC.3.2/3.3 SUPERADA; alternativa 1 de
  design-parto-rodeo-caravana RESUELTA; deprecar el capture viejo del delta madre) - pendiente del leader.
- reference_e2e_design_png_rerender: tras un e2e/e2e:build, revertir design png antes de commitear; no git add
  de __shots__.

## Cambios requeridos

Ninguno. APPROVED.
