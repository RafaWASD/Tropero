# Review — Delta identificadores-unificados (spec 02+09)

Reviewer: agente revisor. Commits: 865e954 (Fase B) + 98fd836/fix (migracion 0122, hand-written).

---

## RE-REVIEW FOCALIZADO (migracion 0122 — post-fix del BLOCKER B1)

### Veredicto (migracion 0122): APPROVED

El unico blocker (B1) esta RESUELTO. Re-escaneo completo del .sql: NO hay otro error de premisa del mismo tipo (drop que mate un dependiente vivo / re-create divergente del cuerpo vigente). Orden transaccional correcto. Sin hallazgos accionables bloqueantes.

### B1 — RESUELTO
- Antes: drop function ... tg_reproductive_events_create_calf () cascade bajo premisa falsa de funcion muerta. Tiraba el trigger VIVO reproductive_events_create_calf (BEFORE INSERT) que crea la cria mono-ternero (casos 4 y 6 L2-mono de supabase/tests/animal/run.cjs).
- Ahora (0122:39-89): create or replace function public.tg_reproductive_events_create_calf () — NO drop. El trigger se preserva. Moldeado sobre el cuerpo VIGENTE (0108, ultima definicion; 0109/0113 solo lo citan en comentarios). Verificado fiel salvo los 3 cambios de visual_id_alt:
  - (a) decl v_visual_fallback eliminada (0122 declare = 9 vars; 0108 tenia 10). Sin uso residual.
  - (b) column-list del INSERT a animal_profiles = 10 columnas (animal_id, establishment_id, rodeo_id, category_id, category_override, breed_id, birth_weight, entry_date, entry_origin, status) — visual_id_alt fuera.
  - (c) VALUES = 10 valores, alineados 1:1 con las 10 columnas; la expresion case-when v_visual_fallback else null end eliminada.
  - Resto BYTE-identico a 0108: guards (event_type/calf_id/calf_sex), SELECT de la madre (species/est/rodeo/system/breed_id), resolucion de categoria, INSERT animals, herencia breed_id R1.7, asignacion new.calf_id, exception when others then raise (R9.4). Firma / language plpgsql / security definer / search_path=public identicos.
- Comentarios corregidos: 0122:13-15 y :35-38 ahora describen la funcion como trigger VIVO re-CREATE. Coherente con el as-built.

### Re-escaneo del archivo — sin otro error de premisa (direccion inversa de B1)
- DROP FUNCTION en el archivo: solo 4. Ninguno mata un dependiente vivo en silencio:
  - tg_animal_profiles_identity_check (0122:33) — DELIBERADO (IDU.2.1). El trigger animal_profiles_identity_check se dropea PRIMERO (0122:32). Drop NON-cascade: si hubiera OTRO trigger colgado, la migracion aborta (fail-closed), no regresiona en silencio. Unico usuario es 0021:20. OK.
  - create_animal (20 tipos) (0122:193) — RPC, sin trigger/vista dependiente. Firma del DROP = exactamente la firma vigente (0083, unica definicion; sin re-def posterior). DROP+CREATE a 19 params sin p_visual_id_alt; grants 19 tipos alineados. Sin overload huerfano. OK.
  - establishment_overdue_doses / establishment_unweighed (0122:429/459) — RPCs sin dependientes; DROP+CREATE por cambio de RETURNS TABLE. Firmas del DROP = vigentes (0106, unica def). int y integer son alias del mismo int4, el DROP matchea. OK.
- Re-CREATE vs cuerpo VIGENTE (reference_function_recreate_base) — cada uno moldeado sobre su ULTIMA migracion (no una intermedia):
  - register_birth: base 0121 (ultima; 0115/0116 previas). 6-arg. Verificado: 3 cambios visual_id_alt (decl fallback, columna, expresion case), 12 a 11 col / 12 a 11 val alineados. idv per-cria coalesce, rodeo cria+mismo-sistema, cota fecha, cap tag 15, breed_id, birth_calves intactos. OK.
  - tg_reproductive_events_create_calf: base 0108 (ultima). Ver B1. OK.
  - import_rodeo_bulk: base 0074 (unica). visual_id_alt fuera del INSERT, resto intacto. OK.
  - transfer_animal: base 0087 (unica). Sin decl/SELECT/INSERT de visual_id_alt, 16 cols alineadas. OK.
  - assert_custom_value_valid: base 0096 (0097 solo re-revoke, no re-def). Mas validacion apodo (<=15 + charset). OK.
  - reportes overdue/unweighed: base 0106. RETURNS TABLE + SELECT sin visual_id_alt. OK.

### DROP COLUMN visual_id_alt (0122:553, NON-cascade) — dependientes duros cubiertos
- CHECK animal_profiles_local_id_check (0020:41) drop 0122:552. OK.
- CHECK animal_profiles_visual_id_alt_len_chk (0070:190) drop 0122:551. OK.
- Indice gin trgm animal_profiles_visual_alt_trgm (0020:62) drop 0122:550. OK.
- Sin vistas / FK / columnas generadas / policies que referencien la columna (footprint completo grepeado: 19 migraciones; todas funciones/constraints/index, mas un do-block one-time en 0070:77-133 que NO persiste objeto). Los cuerpos plpgsql ya re-creados no crean dependencia de catalogo. NON-cascade = fail-closed si algo quedara colgado.

### Orden transaccional
- begin (0122:29) -> (1) drop trigger+fn completitud -> (1b) re-CREATE tg mono -> (2/2b) 7 funciones sin la columna -> (3) rename label apodo -> (4) drop index+2 CHECK+columna (0122:550-553) -> notify pgrst -> commit (0122:556). TODAS las re-creaciones ANTES del drop de columna. El 1b (linea 39) precede al drop (linea 553). OK.

### Pendientes NO bloqueantes de esta migracion (fuera del scope focalizado)
- Suites backend A7-A8 (incl. caso 4 / caso 6 L2-mono / T2.25 tras el deploy) — deploy-gateadas, re-correr en Gate 2.5/deploy.
- IDU.5.1b (apodo server-autoritativo, 0122 assert_custom_value_valid) sin test backend aun — deploy-gateado.
- Menor (paridad, no bloquea): comments on function de create_animal/import_rodeo_bulk/transfer_animal; reconciliar marcas de tasks.md Fase A (A1/A3/A4/A5 en x; A2/A6 corregidas por el fix). Grants ya fail-closed.

---

## Review original (Fase B + primer pase migracion) — historico

## Veredicto (original): CHANGES_REQUESTED

Un blocker de correctitud en la migracion hand-written 0122. El frontend/PowerSync (Fase B) esta completo y correcto. El resto de la migracion (7 funciones) moldea bien sobre los cuerpos vigentes.

## BLOCKER B1 [RESUELTO] — tg_reproductive_events_create_calf NO esta muerta
- Archivo: supabase/migrations/0122_drop_visual_id_alt.sql:35 (drop function ... tg_reproductive_events_create_calf () cascade) + comentarios :13-14 y :34.
- La afirmacion funcion MUERTA / pg_trigger vacio / ningun trigger activo la usa era FALSA:
  - El trigger reproductive_events_create_calf (BEFORE INSERT on reproductive_events) se crea en 0032:70 y NUNCA se dropea en ninguna migracion. 0108:55 lo trata como activo; la funcion (0108:58) SEGUIA referenciando visual_id_alt (0108:95,102).
  - La suite backend supabase/tests/animal/run.cjs ejercita el path mono por INSERT directo de birth con calf_sex y ASSERTA que el trigger crea la cria/fila-puente: caso 4 (:1241-1250) assert birth_calves.length===1; caso 6 L2-mono (:1318-1329) assert ev.calf_id seteado + cria con categoria ternero; T2.25 (:1560-1567) transiciones de la madre.
  - Suite reportada verde 128/128 => el trigger esta activo hoy.
- Impacto: el drop cascade rompia la suite animal tras el deploy y eliminaba una capacidad DB vigente.
- Fix pedido: RE-CREAR la funcion SIN visual_id_alt moldeando sobre 0108. RESUELTO en el re-review de arriba: 0122:39-89 es create or replace fiel a 0108 menos los 3 cambios de visual_id_alt. El trigger se preserva.

## Migracion 0122 — resto verificado CORRECTO (moldeo sobre cuerpo vigente)
- register_birth (vs 0121): CREATE OR REPLACE, firma 6-arg. 3 cambios exactos. Resto intacto: idv per-cria coalesce(calf_idv,p_calf_idv), has_role_in, idempotencia, cota fecha, cap tag 15, rodeo cria + mismo-sistema, breed_id. Grants OK.
- create_animal (vs 0083): DROP+CREATE. DROP firma vieja 20 tipos (:193), CREATE 19 params sin p_visual_id_alt, grant 19 tipos (:261-262). Guards intactos. OK (menor: sin comment on function).
- import_rodeo_bulk (vs 0074): CREATE OR REPLACE, firma intacta, visual_id_alt fuera INSERT, authz owner/vet + cap 5000 + por-fila intactos. OK.
- transfer_animal (vs 0087): CREATE OR REPLACE, quita v_source_visual_id (decl+SELECT+INSERT, 16 cols alineadas), authz asimetrica + mismo-sistema + re-apuntado intactos. OK.
- Reportes overdue_doses/unweighed (vs 0106): DROP+CREATE, RETURNS TABLE sin visual_id_alt, SELECT sin p.visual_id_alt, has_role_in + re-grant. OK.
- assert_custom_value_valid (vs 0096): CREATE OR REPLACE, agrega data_key + validacion apodo (<=15 + charset que espeja el cliente), ACL preservado. OK.
- Drop trigger identidad 0021/0039 OK. Rename label apodo OK. Drop columna + trgm index + 2 CHECK, funciones ANTES del drop, begin/commit OK.
- Footprint: 19 migraciones con visual_id_alt cubiertas. Sin vistas/policies colgadas.

## Frontend / PowerSync (Fase B, 865e954) — CORRECTO
- Grep visual_id_alt/visualIdAlt/visualId en app/src + app/app = solo comentarios.
- upload.ts create_animal = 19 params nombrados sin p_visual_id_alt. OK.
- classifySearchQuery 3 canales; buildApodoSearchQuery (EXISTS correlado, scope establishment_id, LIKE escapado, LIMIT 20); classifyCalfQuery idv alfanum+apodo; candidateMatchesExactly idv/apodo/tag. OK.
- pickHeroIdentifier (apodo->idv->tag->none) usado en lista+ficha+overlays; isApodoDuplicateInField + fetchFieldApodos en alta+ficha. No dead-imports (tsc verde).

## Verificaciones (sin deploy)
- tsc --noEmit exit 0. Unit relevantes con resolver del proyecto exit 0. check.mjs --fast exit 0 (0 violaciones). Suites backend/e2e NO corridas (deploy gateado).

## Trazabilidad IDU.n vs test (Fase B/C/D)
- IDU.1.3/5.1->animal-input.test; 1.4/1.5->animal-form.test; 3.1->schema.test; 3.2/4.5->local-reads+animal-identifier.test; 3.3->upload.test; 3.4->tsc+selection-display/reports-format.test; 3.7->import/*.test; 4.1/4.2/4.3->animal-identifier.test; 4.4->local-reads.test; 4.7->link-calf-query.test; 4.8/4.10/4.11->maniobra-identify.test; 5.4/5.6/5.7->animal-identifier+local-reads.test; 6.1/6.4/6.6->animal-identifier.test.
- IDU.5.1b (apodo server-autoritativo): cubierto por 0122 (assert_custom_value_valid) pero SIN test backend (A7-A8, deploy-gateado). Pendiente.

## Tasks
- Fase B/C/D todas en x (verificadas). Fase A: migracion escrita, A1-A6 sin marcar; A7-A8 (suites backend) no escritas (deploy-gateado); A2/A6 corregidas por el fix B1. Fase E/F: deploy-gateado/Puerta 2 (justificado).

## CHECKPOINTS
- C1 x C2 x C3 x C4 ~ (unit verde; cross-tenant apodo = deploy) C6 abierto (IDU.2.2 ahora completo por el fix; IDU.5.1b sin test aun) C7 x C8 x C9 abierto (Fase E capturas Gate 2.5 pendientes).

## Checklist RAFAQ-especifico
- A (RLS/multi-tenant): aplica. x sin tablas nuevas; x has_role_in/is_owner_of en RPC; x apodo scopeado establishment_id; x deleted_at is null en SELECT reportes. Drop trigger completitud no abre hueco tenant.
- B (offline-first): aplica. x busqueda/hero/warning reads SQLite local; x apodo stream est_custom_attributes; x escrituras outbox/RPC.
- C (BLE): N/A.
- D (UI campo): aplica. veto visual pendiente (capturas Gate 2.5 Fase E, deploy-gateado).
- E (Edge Functions): N/A (RPC de DB, Gate 1).

## Cambios requeridos (original — estado)
1. HECHO: 0122:35 reemplazar el drop cascade por CREATE OR REPLACE sin visual_id_alt (moldear sobre 0108). Verificado en el re-review.
2. DEPLOY-GATEADO: Re-verificar suite animal (caso 4, caso 6 L2-mono, T2.25/T2.26) en el deploy.
3. MENOR: Reconciliar tasks.md Fase A.
4. MENOR: Re-agregar smoke-check/comment de import_rodeo_bulk/transfer_animal para paridad.
