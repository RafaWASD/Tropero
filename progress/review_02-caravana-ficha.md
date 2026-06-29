# Review (reviewer) — delta `02-caravana-ficha` (AGREGAR CARAVANA DESDE LA FICHA, parte manual)

**RE-REVIEW** tras CHANGES_REQUESTED previo (faltaba el cableado T8-T10 + e2e; antes solo módulos puros con imports muertos).
**Baseline**: `8926e16`. **Frontend puro -> Gate 1 N/A** (`git diff 8926e16 -- supabase/` = vacío, confirmado).

## Veredicto: APPROVED

El cableado que faltaba está PRESENTE y verificado; la asimetría TAG/idv del catch es correcta y está reconciliada
en specs; el invariante multi-tenant crítico (RCF.2.5) se cumple. Sin findings bloqueantes.

---

## Lo que faltaba en el CHANGES_REQUESTED previo -- ahora verificado

1. **Cableado (T8)** -- `app/app/animal/[id].tsx:835-885`: la sección "Identificación" renderiza por id
   `tagElectronic != null ? AttributeRow(value) : canAssignTag(detail) ? IdentifierAssignRow(kind=tag) : AttributeRow("—")`
   y simétrico para `idv` con `canAssignIdv`. `visual_id_alt` queda `AttributeRow` intacto (:884); sin "Detectar
   bastoneo" (solo aparece en comentario :841, nunca como botón) -> RCF.1.6 OK. Imports ya NO muertos: todos
   (IdentifierAssignRow, assignTagToAnimal, lookupByTag, setIdv, canAssignTag/canAssignIdv, IDV_MAX_LENGTH/
   TAG_ELECTRONIC_LENGTH/isValidTagElectronic/sanitizeIdvInput/sanitizeTagInput) se usan (typecheck VERDE, sin dead code).
2. **Handlers (T9/T10)** -- `onAssignIdv` ([id].tsx:574-602): optimismo en sitio setDetail({...d, idv}) ->
   setIdv(detail.profileId, value) -> void load({silent:true}) (refresh seguro: el UPDATE local ya escribió idv);
   revert al snapshot si falla (RCF.3.6). `onAssignTag` (:608-648): lookupByTag(value, detail.establishmentId)
   pre-check -> si mode edit/transfer error accionable SIN encolar (RCF.2.3) -> optimismo -> assignTagToAnimal ->
   revert si falla. Firmas verificadas: lookupByTag -> ServiceResult<TagLookupResult> (mode edit|transfer|create,
   tag-lookup.ts:21-24), assignTagToAnimal -> OutboxResult (r.error.message, outbox.ts:40-42), setIdv -> ServiceResult<true>.
3. **CRÍTICO multi-tenant (RCF.2.5/5.2)** -- onAssignTag pasa `detail.establishmentId` a lookupByTag.
   AnimalDetail.establishmentId (animals.ts:135-140) está documentado y mapeado como establishment_id del PERFIL
   ("se deriva de ACÁ (el perfil), no del contexto activo"; fetchAnimalDetail :1068 = row.establishment_id).
   NO es el contexto activo, NO hardcode. buildSetIdvUpdate WHERE por id de perfil, sin establishment_id. PASS.
4. **Catch del implementer (asimetría TAG/idv) -- CORRECTO.** idv = UPDATE local plano (buildSetIdvUpdate,
   local-reads.ts:1788) -> la lectura local refleja el idv al instante -> optimismo + load({silent}) es seguro.
   tag = assignTagToAnimal -> enqueueAssignTag ENCOLA el RPC sin overlay (animals fuera del sync set, ADR-026;
   sin overlay sobre animal_profiles.animal_tag_electronic) -> un refresh inmediato re-leería NULL y blanquearía
   el optimismo (violaría RCF.2.7) -> onAssignTag OMITE el refresh, solo optimismo en sitio. Verificado: el
   success path de onAssignTag hace `return {ok:true}` (:645) SIN load(); dep array [detail] sin load. Correcto.
5. **Solo lo VACÍO (R4.13)** -- canAssignTag/canAssignIdv = status==='active' && <id>==null (identifier-assign.ts:25,35);
   lo seteado cae a AttributeRow read-only. IdentifierAssignRow valida inline (validate -> error, sin invocar).

## Trazabilidad RCF.n <-> test

| RCF.n | Verificación |
|---|---|
| RCF.1.1 | identifier-assign.test.ts::RCF.1.1 (activo+tag null->true) |
| RCF.1.2 | identifier-assign.test.ts::RCF.1.2 + e2e read-only (tag seteado->sin CTA) |
| RCF.1.3 | identifier-assign.test.ts::RCF.1.3 + e2e idv |
| RCF.1.4 | identifier-assign.test.ts::RCF.1.4 + e2e read-only |
| RCF.1.5 | identifier-assign.test.ts::RCF.1.5 (no-activo->false, ambos predicados) |
| RCF.1.6 | Estático: [id].tsx visual_id_alt AttributeRow sin cambios (:884); "Detectar bastoneo" solo comentario (:841), nunca botón (requisito de AUSENCIA) |
| RCF.1.7 | identifier-assign.ts módulo PURO (sin RN/red/SDK) + suite completa bajo node:test |
| RCF.2.1 | animal-input.test.ts::sanitizeTagInput (<=15) + e2e (fill 14 díg queda 14) |
| RCF.2.2 | e2e tag (14 díg->error "...15 dígitos." sin invocar) + animal-input.test.ts::isValidTagElectronic |
| RCF.2.3 | tag-lookup.test.ts::resolveTagLookup (modos edit/transfer/create) + handler (dup->error sin encolar) |
| RCF.2.4 | e2e tag (15 díg->optimismo) + handler assignTagToAnimal |
| RCF.2.5 | Estático: onAssignTag pasa detail.establishmentId (PERFIL, animals.ts:135-140), nunca contexto activo |
| RCF.2.6 | IdentifierAssignRow.handleConfirm (error inline, afordancia abierta) + onAssignTag revert |
| RCF.2.7 | e2e tag (read-only tras confirmar) + reconciliación design 4.6 (optimismo sin refresh) |
| RCF.3.1 | animal-input.test.ts::sanitizeIdvInput (<=20) |
| RCF.3.2 | IdentifierAssignRow.validate (no-vacío) + onAssignIdv defensa no-vacío |
| RCF.3.3 | local-reads.test.ts::RCF.3.3/3.4 buildSetIdvUpdate + setIdv + e2e idv |
| RCF.3.4 | local-reads.test.ts::RCF.3.3/3.4 (SET solo idv; doesNotMatch otras columnas; WHERE id+deleted_at; args [idv,profileId]) |
| RCF.3.5 | e2e idv (read-only tras confirmar) + setIdv offline-first |
| RCF.3.6 | onAssignIdv revert + IdentifierAssignRow error inline |
| RCF.4.1 | check-hardcode.mjs 0 violaciones + es-AR/buttonA11y/getTokenValue en IdentifierAssignRow |
| RCF.4.2 | Estático: IdentifierAssignRow CTA minHeight=$touchMin, una decisión por afordancia |
| RCF.4.3 | FormField error (borde rojo + inline) + e2e (error inline visible) |
| RCF.4.4 | Estático: CTA fontSize=$5 lineHeight=$5 (descender g de Agregar) |
| RCF.4.5 | keyboardType=number-pad + sanitize a dígitos + animal-input.test.ts |
| RCF.5.1 | setIdv -> UPDATE local (offline) + enqueueAssignTag (encolado offline) |
| RCF.5.2 | Estático: detail.establishmentId no-hardcode; buildSetIdvUpdate WHERE id solo (RLS deriva tenant al subir) |

Cobertura: la lógica de decisión sustantiva (predicados, builder, lookup, sanitizers, validators) tiene UNIT
test concreto; la integración tiene E2E concreto; los requisitos de ausencia (RCF.1.6), multi-tenant estructural
(RCF.2.5/5.2) y MUSTs de UI de pantalla RN se verifican por revisión estructural (convención del repo: no hay
unit de pantallas RN). Ningún RCF queda sin medio de verificación.

## Tasks completas: SÍ
T1-T15 todas en [x] en tasks-caravana-ficha.md. T15 (autorrevisión + reconciliación) documentada en
progress/impl_02-caravana-ficha.md (7 ítems de autorrevisión adversarial; #1 = el catch del refresh del TAG).

## Exactitud de specs (código -> spec): OK
El único cambio de comportamiento del as-built (TAG NO hace refresh silencioso inmediato) está reconciliado en
DOS lugares: design-caravana-ficha.md 4.6 (lines 114-123) y la nota de reconciliación bajo RCF.2.7
(requirements lines 84-90). Las props finales de IdentifierAssignRow (CTA derivada de kind, maxLength?, import
directo de Button/FormField) están reconciliadas en design 1. Sin specs mintiendo respecto del código.

## CHECKPOINTS
N/A -- este delta (ADR-028 Nivel B) trae su propio ledger tasks-caravana-ficha.md; no hay un CHECKPOINTS.md de
feature separado para este incremento.

## Checklist RAFAQ-específico
- **A (multi-tenancy/RLS)**: N/A directo -- el delta NO crea/modifica tablas ni policies (frontend puro, supabase
  diff vacío). El aislamiento se apoya en lo existente: animal_profiles_update (idv) + authz del RPC
  assign_tag_to_animal (tag). El invariante de cliente (no hardcodear / no usar contexto activo para el tenant)
  se cumple (RCF.2.5/5.2, verificado).
- **B (offline-first)**: [x] idv funciona OFFLINE (UPDATE local plano, sin red). [x] sin requests síncronos a
  Supabase desde la pantalla (idv vía builder->runLocalWrite/SQLite local; tag vía outbox->RPC). [x] last-write
  documentado: idv NULL->valor inmutable (R4.13, 0036) + unique parcial (0020) rechaza al subir. [x] el tag tiene
  la asimetría documentada (encolado offline, efecto online -- ADR-026).
- **C (BLE)**: N/A -- el bastoneo está DEFERIDO explícitamente (feature 04); no se renderiza botón muerto (RCF.1.6).
- **D (UI de campo)**: [x] target táctil minHeight=$touchMin (CTA + Button fullWidth). [x] una decisión por
  afordancia. [x] estado de loading visible (busy -> "Guardando..."). [x] validación inline (FormField error,
  sin banner global). [x] lineHeight matching (CTA con descender).
- **E (Edge Functions)**: N/A -- no toca Edge Functions.

## Verificación ejecutada (per instrucción del leader -- red a Supabase flakea)
- pnpm typecheck -> VERDE (exit 0).
- node scripts/check-hardcode.mjs -> VERDE, 0 violaciones (exit 0).
- Unit locales (identifier-assign.test.ts + local-reads.test.ts + tag-lookup.test.ts + animal-input.test.ts)
  -> 159/159 PASS (exit 0); incluye los 7 nuevos RCF.1.* + el buildSetIdvUpdate shape test.

> **Caveat (no bloqueante)**: check.mjs COMPLETO y los e2e NO se corrieron en vivo por instrucción del leader
> (red a Supabase inestable; clase documentada reference_check_red_rate_limit -- flake de auth por 2 terminales,
> NO regresión). Los 3 e2e nuevos EXISTEN y son concretos, reconciliados estáticamente contra el as-built de
> [id].tsx. Gate 2 (seguridad, code) ya PASS (0 HIGH/0 MEDIUM, security_code_02-caravana-ficha.md). Lo único que
> el security gate marcó pendiente (cableado) es exactamente lo que este RE-REVIEW verificó resuelto.

## Cambios requeridos
Ninguno.
