# review_08-sigsa-ui-run2 -- Revision "UI Run 2 + fix del connector" (spec 08)

**Feature**: 08-export-sigsa (in_progress)
**Revisor**: reviewer (Opus 4.8)  -  **Fecha**: 2026-06-25  -  **Baseline**: 5598644
**Bitacora**: progress/impl_08-sigsa-ui-run2.md

## Veredicto: CHANGES_REQUESTED

El CODIGO de este chunk es correcto y de alta calidad: el fix del connector es quirurgico,
retry-safe y arquitectonicamente correcto; la seguridad del RENSPA esta bien cerrada; las 5
decisiones de UI estan aplicadas; los tests existen y pasan (66/66 en las suites puras tocadas,
via el runner canonico del repo). Pero NO se aprueba por dos motivos duros del protocolo, ambos
de RECONCILIACION (no de codigo):

1. El fix del connector (cambio de contrato de upload) NO esta reflejado en design.md -- la spec
   quedo vieja respecto del as-built (paso 6, trazabilidad inversa).
2. Las tasks que ESTE run completo (T13, T17, T18, T19) siguen sin marcar en tasks.md, y T18 quedo
   como entrega PARCIAL (no setea breed_id) que contradice el test de R1.4 sin que la spec lo reconcilie.

El propio implementer documento la reconciliacion como pendiente del leader al cierre (impl, seccion
"Reconciliacion de specs pendiente"). La regla dura (MEMORY: Correcciones se reflejan en specs) exige
hacerlo ANTES de aprobar/cerrar. Es la unica barrera; resueltos los 2 puntos es APPROVED directo sin
tocar una linea de codigo.

---

## FOCO PRINCIPAL -- fix del connector (VERIFICADO OK en codigo)

### 1. Quirurgico? -- SI
- isAppendOnlyInsertTable (upload-classify.ts:109-114) matchea SOLO sigsa_declarations y export_log.
- buildCrudUpsert (upload-classify.ts:206-224) evalua en orden: (a) COMPOSITE_PK PRIMERO
  (custom_attributes, rama intacta), (b) append-only -> insertOnly, (c) default -> upsert por id.
  weight_events y custom_attributes NO cambian de rama. Tests: upload-classify.test.ts:85-89
  (weight_events normal, insertOnly undefined), :131-169 (custom_attributes onConflict + value jsonb
  intacto), :94-99 (isAppendOnlyInsertTable solo las 2). connector.ts:87-92 ramifica
  insertOnly -> insert() : (onConflict -> upsert(onConflict) : upsert()) -- preserva el path de
  custom_attributes exacto.

### 2. Retry-safe? -- SI
- Reintento at-least-once del mismo INSERT -> 23505. isPermanentServerCode 23505 -> true
  (regex de clases 22/23/42, upload-classify.ts:257), tested :56 y :76. isTransientUploadError con
  23505 -> false, tested :55-59. El connector descarta permanentes: connector.ts:118-128 --
  transitorio: throw (re-cola); permanente: surfaceUploadRejection + transaction.complete() (DESCARTA,
  no re-throw, no loop). Fila ya server-side = idempotente, sin outbox trabada. CORRECTO.

### 3. Otro path roto por el mismo motivo? -- REVISADO, no hay
- animal_category_history (0030): grant select SOLO (line 60), insertada por trigger SECURITY DEFINER.
  Es el perfil de tabla que romperia con upsert... PERO NO se escribe desde el cliente (no hay
  supabase.from sobre animal_category_history ni write local; el schema la declara solo para lectura
  del timeline, local-reads.ts:1072). No genera CrudEntry -> no pasa por uploadData -> el bug NO la
  toca. El schema.ts:495 ya la nombra como par append-only. NO es un finding.
- Resto de eventos (weight_events, etc.): tienen grant update + policy UPDATE (0025+) -> el upsert
  funciona. Sin cambio. Conclusion: el fix cubre exactamente las 2 tablas que lo necesitan.

### Premisa del bug -- CONFIRMADA en grants reales
- 0111_sigsa_declarations.sql:47: grant select, insert to authenticated (sin UPDATE).
- 0112_export_log.sql:49: grant select, insert to authenticated (sin UPDATE).
- -> upsert (INSERT ON CONFLICT DO UPDATE) exigiria UPDATE -> 42501 -> descarte silencioso. El fix
  (.insert()) es correcto y PRESERVA R11.3 (la alternativa, grant UPDATE, romperia la auditoria
  no-spoofeable). Fix arquitectonicamente correcto.

---

## FOCO UI -- verificado

- A1 (muted): export-sigsa.tsx:365-374 textMuted en conteos; terracota solo en flag por-fila. OK.
- A2 (sticky CTA): ExportStickyBar via Shell footer (:176-183, :382-414), full-width,
  Math.max(insets.bottom, navBottomMin), borderTop divider, lista scrollea detras (:335). OK.
- A3 (markAsDeclared): tap "Listos" -> setMarkTarget (:287); MarkDeclaredSheet overlay (:186-197);
  onConfirmMarkDeclared -> markDeclared(id) (:141-146) -> el hook refresca; "a completar" -> ficha
  directo (:272). Copy EXACTO ("Marcar como ya declarado por otro medio") verificado en el e2e. OK.
- A4 (filtro fecha + validacion inline): FiltersSection usa isValidBirthDateRange, error en el campo
  "hasta" (:544), NO banner. OK.
- Sin metadata de fila (rfid/sex/reasons). OK.
- Titulo descender-safe: "Exportar a SENASA" fontSize 8 + lineHeight 8 (:322). OK.

### RENSPA -- escritura owner-gated VERIFICADA (no hay path para un no-owner)
- updateRenspa (establishments.ts:433-461) va EXCLUSIVAMENTE por rpc update_renspa. NO hay UPDATE
  directo de renspa en ningun lado.
- RPC update_renspa (0110:44-58): SECURITY DEFINER + set search_path=public + guard is_owner_of (raise
  42501 si no) + returns void (sin RLS-on-RETURNING leak). revoke execute from public/anon + grant a
  authenticated (:65-66).
- Defensa en profundidad: aun sin la RPC, la policy establishments_update (0007) es is_owner_of en
  USING+WITH CHECK -> UPDATE de no-owner devuelve 0 filas. No hay path de escritura de renspa para
  no-owner. OK.

### BreedPicker -- GAP CONOCIDO confirmado (no finding nuevo), NO rompe el alta
- onSelectBreed (crear-animal.tsx:375-387) recibe _breedId (prefijo underscore = sin uso) y setea breed
  (TEXTO) con selectedBreedLabel(...).name (NOMBRE EXACTO del catalogo). :487 manda breed.trim() a
  createAnimal -> setea el nombre, NO breed_id.
- El nombre es el EXACTO de breed_catalog.name (sale de selectedBreedLabel) -> el trigger derive-breed_id
  de Run 3 lo matchea. Confirmado.
- Alta NO se rompe: cambio ADITIVO (swap input texto -> trigger+sheet). OK.

---

## Trazabilidad R<n> <-> test (requisitos que ESTE chunk toca)

- R10.2 (markAsDeclared): e2e sigsa-export.spec.ts:224-282 (action-sheet -> marca -> ASSERT SERVER-SIDE
  sigsa_declarations.export_log_id IS NULL) + upload-classify.test.ts:101-129 (insertOnly). OK -- el e2e
  server-side es el que cazo el bug del connector (test por la razon correcta).
- R11.3 (append-only, no UPDATE cliente): upload-classify.test.ts:94-129 (insertOnly + ausencia de
  declared_by/generated_by en payload). OK.
- R3.4/R3.5 (clasificacion transitorio/permanente): upload-classify.test.ts:39-81. OK.
- R2.1/R2.2/R2.3 (RENSPA owner-only): renspa-validate.test.ts + local-reads.test.ts (renspa en query) +
  schema.test.ts (col) + sigsa-breed-renspa.spec.ts (banner->editar->guardar via RPC + verif server). OK.
- R9.3 (filtro rango fecha): sigsa-filters.test.ts + sigsa-export.spec.ts (acota + error inline). OK.
- R1.4 (UX raza / BreedPicker): breed-picker.test.ts + sigsa-breed-renspa.spec.ts. PARCIAL -- los tests
  verifican breed TEXTO, NO breed_id; el test del tasks.md ("seleccionar una raza setea breed_id") NO se
  cumple as-built (ver Cambio #2). No es falta de test, es contradiccion spec vs as-built.
- R13.3 (renspa prepoblado): export-sigsa.tsx:213-219 pasa renspa al SigsaChecklistReminder. OK.

Resultado: cada R<n> de este chunk tiene al menos un test (R1.4 con la salvedad del Cambio #2).

## Tasks completas: NO
tasks.md tiene sin marcar TODAS salvo T8/T9/T10. Las que ESTE run completo (T13, T17, T18, T19) siguen
sin marcar. (T1-T7/T11-T12/T14-T16/T20 tambien, pero se cerraron en chunks previos -- deuda de bookkeeping
pre-existente; los 4 de este run son responsabilidad de este chunk.)

## CHECKPOINTS
No existe CHECKPOINTS.md en el repo -> N/A.

## Checklist RAFAQ-especifico

### B. Offline-first (markAsDeclared / export / RENSPA-read) -- APLICA
- [x] Funciona offline: export/markAsDeclared escriben al SQLite local via CRUD plano (la cola drena con
      el fix del connector); renspa/catalogo se LEEN local. El e2e prueba el flujo.
- [x] Sync bucket correcto: sigsa_declarations/export_log scoped org_scope (0111/0112); breed_catalog
      global read-only.
- [x] Resolucion de conflictos: append-only INSERT; reintento = 23505 = descarte idempotente (documentado
      y testeado). RENSPA = ONLINE-only por diseno (admin de campo, no manga).
- [x] No hace requests sincronos a Supabase desde la pantalla: usa el hook + services; el unico round-trip
      directo (loadEstablishmentDetail + rpc update_renspa) esta en services, no en JSX.

### D. UI de campo -- APLICA PARCIAL (pantalla oficina/big-touch, criticidad mixta marcada en el codigo)
- [x] Targets: chipMin/touchMin; sticky CTA Button fullWidth. OK para el contexto (no manga con guante).
- [x] Fuente: conteo 9, cuerpo 4. OK.
- [x] Una decision por pantalla: CTA primario unico (Exportar); filtros colapsados. OK.
- [x] Loading visible: isGenerating -> "Generando..." + disabled. OK.

### A (RLS/multi-tenancy), C (BLE), E (Edge Functions) -- N/A
- A: este chunk NO crea tablas nuevas con establishment_id (se crearon en chunks de DB previos, revisados
  en review_08-sigsa-db.md). El unico cambio backend-adyacente es client-side (schema.ts local + connector).
- C: la feature no toca BLE.
- E: no se tocan Edge Functions (update_renspa es SQL, revisada en el chunk de DB).

---

## Cambios requeridos

### #1 -- Reflejar el fix del connector en design.md [BLOQUEANTE, paso 6]
design.md describe el upload de sigsa_declarations/export_log solo como "insertar via PowerSync" (generico,
~linea 422) y la propiedad append-only solo del lado SERVER (RLS/grants, lineas 247/276/491). NO documenta
que el connector CLIENTE sube esas 2 tablas por .insert() (no .upsert()) porque el upsert exigiria grant
UPDATE -> 42501 -> descarte silencioso. Es un cambio de CONTRATO de upload descubierto en este chunk; la
spec quedo vieja.
- Accion: nota AS-BUILT en design.md (seccion PowerSync/sync o Changelog): el connector clasifica
  sigsa_declarations/export_log como append-only y las sube por .insert(); idempotencia = descarte de 23505
  como permanente; preserva R11.3 client-side. Referenciar upload-classify.ts (isAppendOnlyInsertTable /
  insertOnly) + connector.ts:87-92.
- El implementer lo senalo en impl:110-111,156-161 como pendiente del leader.

### #2 -- Reconciliar T18 (alta setea breed texto, NO breed_id) en tasks.md + requirements.md [BLOQUEANTE, paso 6]
As-built del alta setea animal_profiles.breed (texto = nombre del catalogo), NO breed_id (la RPC
create_animal 0083 no lleva p_breed_id). Pero tasks.md T13 test (a) dice "seleccionar una raza setea
breed_id" y T18 queda sin marcar sin la nota de que breed_id-desde-el-alta es follow-up (Run 3, trigger
derive-breed_id). La combinacion deja la spec mintiendo sobre lo que el alta hace hoy.
- Accion: (a) marcar T13/T17/T18/T19 como hechas; (b) en T18 (y/o T13) nota AS-BUILT: el alta setea breed
  (nombre del catalogo, persiste por la RPC 0083); breed_id desde el alta = follow-up (patchear
  create_animal con p_breed_id + 1 linea de upload.ts) -- Run 3 (trigger derive-breed_id). Igual que la nota
  AS-BUILT de R1.6 ya en requirements.md. El razonamiento ya esta en impl, seccion "BLOQUEO PARCIAL
  DESCUBIERTO" -- falta volcarlo a la spec.

### (No bloqueante, informativo) -- bookkeeping de tasks de chunks previos
T1-T7/T11-T12/T14-T16/T20 estan sin marcar pero fueron implementadas/revisadas antes (review_08-sigsa-db.md,
review_08-sigsa-service.md, impl_08-sigsa-ui-export.md). Recomiendo que el leader las marque en la misma
pasada. No lo cuento como bloqueante de ESTE chunk (no son sus tasks), pero la feature no deberia ir a done
con ese tasks.md.

---

## Verificacion ejecutada
- Unit (runner canonico ts-ext-resolver.mjs): upload-classify + breed-picker + renspa-validate +
  sigsa-filters -> 66/66 pass, 0 fail. (Un primer intento con node --test --import tsx dio rojo por loader
  inexistente -- falso-rojo; el repo NO usa tsx. Re-corrido con el resolver del repo: verde.)
- check.mjs: NO ejecutado (instruccion del brief -- flake conocido del Animal suite, ajeno).
- typecheck + 299 unit + 9 e2e: reportados verdes por el implementer; los 66 unit re-corridos confirman el
  nucleo de este chunk; el e2e de markAsDeclared con assert server-side valida el fix end-to-end.

## Resumen para el leader
Codigo: APROBABLE. Specs: VIEJAS. Resolve Cambios #1 y #2 (edicion de design.md / tasks.md /
requirements.md -- el implementer ya escribio el razonamiento en su bitacora, es volcarlo) y pasa a APPROVED
sin tocar codigo.
