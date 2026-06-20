# Review — Spec 03 MODO MANIOBRAS, chunk M7 — RE-REVIEW del fix-loop

**Reviewer**: reviewer
**Fecha**: 2026-06-20 (re-review del fix-loop)
**Veredicto**: CHANGES_REQUESTED

El HIGH quedo cerrado bien (migracion 0101 parcial correcta + test backend (o) correcto, pending-deploy OK) y la Opcion B esta bien implementada en codigo, tests y en la parte NORMATIVA de las specs. NO hay regresion (9/9 e2e M7 verde; 251/251 unit M7 verde). Rechazo por un unico motivo, severidad baja pero que dispara la regla dura: quedaron residuos de la 1ra pasada (Opcion A) en superficies que se leen como AS-BUILT — un heading de design, una fila de la tabla de cobertura design->requirements, el titulo+header de un e2e, y una nota adosada a R13.19 vivo — que afirman lo contrario de lo construido (lectura historica PRESERVADA / el JOIN NO filtra deleted_at / las cargas SE CONSERVAN / la ficha SIGUE mostrando el valor). Las notas de reconciliacion posteriores las contradicen -> el spec queda en dos voces. Falta cerrar esa reconciliacion; el codigo esta bien.

---

## 1. HIGH (R13.26 borrar+recrear) — RESUELTO

Verificado sobre supabase/migrations/0101_field_definitions_data_key_partial.sql:
- (a) Predicado parcial correcto: drop index if exists ... + create unique index ... where establishment_id is not null and deleted_at is null (l.39-42). Una fila soft-deleteada sale del indice -> libera el slot (establishment_id, data_key) -> recrear con el mismo slug ENTRA; dos VIVAS siguen colisionando. notify pgrst. Transaccional.
- (b) No toca el indice global ni nada mas: field_definitions_data_key_global (globales establishment_id IS NULL, 0093 l.38-39) INTACTO; solo drop+recreate del indice custom. Sin cambios de RLS/policies/guard/columnas.
- (c) Test borrar->recrear-mismo-slug: supabase/tests/custom/run.cjs caso (o) (l.784+): crea -> control NEGATIVO (segunda VIVA mismo data_key -> assert 23505) -> soft-delete -> recrear-mismo-data_key -> assert sin error + id NUEVO. Bien marcado PENDING-DEPLOY (recrear-tras-borrar verde solo con 0101 aplicada; control negativo con o sin ella). Migracion NO aplicada al remoto (deploy gateado por Raf) -> aceptable.

Conclusion: HIGH cerrado. Reabre Gate de schema para 0101 (lo corre el leader), anotado en design 13.3 / requirements R13.35 / tasks M7-B.5 / context-m7 5.

## 2. Opcion B (R13.30/R13.31) — bien en CODIGO y TESTS (residuo de doc, ver 3)

- Copy = ADVERTENCIA, no se conservan: custom-field.ts buildCustomFieldDeleteImpactLines (l.192+): N>0 -> Sus N cargas previas dejaran de verse y no vas a poder recuperarlas; N=1 singular; N=0 liviano; + Se quita de M rodeos. Cierre Esta accion no se puede deshacer en ConfirmDeleteSheet (l.184-186). NO promete preservacion.
- Split revertido sin codigo muerto: grep limpio (no queda buildCustomAttributesViewQuery ni isDeleted en codigo, solo 1 referencia en docstring que documenta el descarte). buildCustomAttributesQuery volvio a filtrar deleted_at IS NULL AND active = 1 (INNER JOIN). CustomPropertiesSection.tsx removio el plumbing display-only.
- Ficha NO crashea con custom_attribute huerfano: INNER JOIN sin fila -> no llega a rows -> desaparicion prolija. e2e test 2 lo prueba (toBeHidden tras borrar+recargar).
- Ex-test.fixme ahora real y verde: maniobra-custom-gestion.spec.ts:122 (R13.30 Opcion B). Sin test.fixme/test.skip en el repo.

## 3. Specs reconciliadas — PARCIAL (motivo del rechazo)

La parte NORMATIVA esta reconciliada (R13.30 tachado + nota Opcion B; R13.31 nota advertencia; R13.35 nuevo; design 13.4/13.5 BODY + 13.7 DM7-3 resuelto; tasks M7-B.2/B.4/B.5; backlog Opcion A fast-follow; context-m7 4). PERO sobreviven residuos de Opcion A en superficies que se leen como as-built (ver Cambios requeridos).

## 4. No regresion
- e2e M7: maniobra-custom-gestion 5/5 + maniobra-rutinas-gestion 4/4 = 9/9 passed (corrido en esta re-review).
- Unit M7: local-reads+maneuver-reads+custom-field+rodeo-template+custom-value+custom-render = 251 pass / 0 fail.

---

## Trazabilidad R <-> test (completa)
- R2.6 -> maniobra.tsx PresetRow -> e2e rutinas. OK
- R2.7 -> SavePresetSheet+updatePreset -> e2e Renombrar. OK
- R2.8 -> jornada.tsx editPresetId+updatePreset -> e2e Reconfigurar (0 sesiones). OK
- R2.9 -> ConfirmDeleteSheet+softDeletePreset -> e2e Eliminar. OK
- R2.10 -> sin gating de rol en UI (RPC 0057 has_role_in). OK implicito
- R2.11 -> snapshot sessions.config -> e2e R2.11. OK
- R13.19 -> buildFieldCatalogQuery/buildCustomDataKeysQuery/buildEnabledCustomFieldsQuery filtran deleted_at -> e2e. OK
- R13.28 -> softDeleteCustomField+buildSoftDeleteCustomFieldUpdate (idempotente) -> unit + e2e. OK
- R13.29 -> FieldTemplateToggleList onCustomAction + editar-plantilla.tsx isOwner -> e2e (solo custom + non-owner NO ve + fabrica sin kebab). OK
- R13.30 (Opcion B) -> buildCustomAttributesQuery filtra deleted_at + dialogo advierte -> e2e (advierte + toBeHidden). OK
- R13.31 -> buildCustomFieldDeleteImpactLines+fetchCustomFieldDeleteImpact+ConfirmDeleteSheet -> unit + e2e. OK
- R13.32 -> updateCustomField+CustomFieldSheet modo edit (tipo locked) -> e2e (data_type/ui_component intactos). OK
- R13.33 -> CustomFieldSheet modo edit -> e2e Editar. OK
- R13.34 -> guard 0093 before insert OR UPDATE + validateCustomFieldDraft. OK
- R13.35 -> 0101 -> test backend (o) (PENDING-DEPLOY, correcto). OK

Todos los R con >=1 test. R13.35 pending-deploy (aceptable, gateado por Raf).

## Tasks completas: SI
M7-A.1/A.2/A.3, M7-B.1/B.2/B.3/B.4/B.5 -> [x]. M7-B.5 nuevo (indice) con nota de re-Gate de schema. Sin [ ] huerfanos.

## CHECKPOINTS
- check.mjs verde -> [ ] ROJO, pero ROJO = FLAKE conocido (animals_tag_unique 23505 en supabase/tests/animal/run.cjs:1924, spec-08 cross-terminal). NO toca la superficie de M7. Suites M7 verifican verde por separado (251 unit + 9 e2e). NO es regresion.

## Checklist RAFAQ-especifico
- A (RLS): aplica parcial. 0101 NO crea tablas/RLS/policies — solo el predicado del indice UNIQUE custom; RLS field_definitions_update owner-only + guard 0093 siguen siendo la barrera. [x] (sin tabla nueva; aislamiento cross-tenant cubierto por RLS preexistente, no regresada).
- B (offline-first): [x] UPDATE plano CRUD-plano local + sync despues; idempotente. Sin requests sincronos desde la pantalla. LWW PowerSync. borrar+recrear end-to-end tras 0101 (pending-deploy).
- C (BLE): N/A.
- D (UI de manga): [x] 3 sheets targets >=touchMin; titulos lineHeight matching (ConfirmDeleteSheet l.170/184); una decision por pantalla; loading visible (Eliminando..., l.225); guard tap-through doble-rAF + e2e regresion verde.
- E (Edge Functions): N/A.

## Exactitud de specs (codigo -> spec) — DONDE FALLA
La normativa principal describe Opcion B. Pero un heading, la tabla de cobertura, el titulo/header de un e2e y una nota viva de R13.19 todavia describen Opcion A como as-built. Reconciliacion pendiente -> CHANGES_REQUESTED.

---

## Cambios requeridos (bloqueantes — reconciliacion de doc; cero cambio de codigo de produccion)

1. design.md:1809 — heading de 13.5 contradice el as-built: "13.5 Lectura historica preservada (R13.30) — el JOIN de display no filtra deleted_at". El BODY (l.1815-1819) ya es Opcion B (el JOIN SI filtra; el historico DEJA DE VERSE). Renombrar a la semantica Opcion B.
2. design.md:1884 — fila de la tabla de cobertura describe la solucion DESCARTADA: "13.5 lectura historica preservada (JOIN display no filtra deleted_at; fix buildCustomAttributesViewQuery)". El split se DESCARTO y el JOIN SI filtra. Reescribir a Opcion B.
3. app/e2e/maniobra-custom-gestion.spec.ts:2, 7, 51 — header del archivo + titulo del primer test mienten sobre lo que el test verifica (l.2/l.7 lectura historica preservada / SIGUE mostrando; l.51 titulo ficha SIGUE mostrando el valor). El test 1 NUNCA re-verifica el valor tras borrar (es el test 2 el de Opcion B, con toBeHidden). Renombrar titulo/header a la semantica Opcion B.
4. requirements.md:394 — nota de reconciliacion adosada a R13.19 (vivo) afirma Opcion A como garantia: "(c) la garantia de lectura historica preservada en el JOIN de display ... un ajuste del read de display para no filtrar deleted_at". Eso es Opcion A, descartada; se lee como vigente. Reconciliar a Opcion B o remitir a la nota de R13.30.
5. requirements.md:672 — historial fold 2026-06-19: "cuantas cargas se conservan" + "lectura historica preservada (JOIN de display no filtra deleted_at)". Entrada datada sin marca de superado por el fix-loop 2026-06-20. Agregar marca o reconciliar.
6. design.md:1930-1931 — fold 2026-06-19: "M cargas que se conservan" (l.1930) + "13.5 Lectura historica preservada ... NO debe filtrar deleted_at ... M7 separa la variante de VISTA (sin filtro)" (l.1931). Marcar superado o reconciliar.
7. context-m7-gestion-rutinas-custom.md:25 — seccion 2 (alcance): "cuantas cargas se conservan". La seccion 4 (l.38) ya esta reconciliada a Opcion B; alinear la 2 con la 4.

Justificacion del bloqueo: el codigo esta correcto y los tests pasan; falta cerrar la reconciliacion codigo->spec que dejo dos voces. Items 1-4 se leen como as-built; 5-7 son entradas datadas a marcar como superadas. Es la direccion inversa de la trazabilidad (que el design no quede mintiendo) — por eso CHANGES_REQUESTED. El implementer reconcilia; no toca produccion.
