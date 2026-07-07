# Spec 02 — Delta PARTO: CARAVANA VISUAL DEL TERNERO **POR CRÍA** (mellizos incluidos) — Contexto (Gate 0)

**Status**: `context_ready` · Delta **Nivel B (ADR-028)** sobre spec 02 (feature `done`/`deferred`) · **backend + frontend**.
**Slug**: `parto-caravana-visual-por-ternero`.
**Fecha**: 2026-07-07.
**Origen**: decisión de alcance de Raf en sesión — la caravana visual (idv) del ternero al parto pasa a ser **POR CRÍA** (incluye mellizos), simétrica con la caravana **electrónica** que ya es per-calf (delta `bastoneo-captura-alta-parto`). **Revisa RPRC.2/RPRC.3** del delta `parto-rodeo-caravana`.
**Gate 0**: **aprobado por Raf** (decisión de alcance en sesión). Este delta traduce esa decisión — no re-decide alcance ni edge cases.

---

## Problema

El delta `parto-rodeo-caravana` (#1a) dejó la **caravana visual (idv)** del ternero como un campo **a nivel camada, SOLO con 1 ternero** (single-calf): con ≥2 terneros (mellizos) el campo se **oculta** y aparece la nota *"Las caravanas visuales de mellizos se asignan después desde la ficha de cada ternero."* (RPRC.2.3/2.4). Esa limitación **no era una regla de dominio** de Facundo — era una **restricción del RPC**: `register_birth` tomaba un `p_calf_idv` **escalar único** (un solo idv para toda la camada), diseñado para el camino mono-cría de #15.

Mientras tanto, la caravana **electrónica** (bastoneo) YA es **por ternero** (cada `CalfBlock` tiene su CTA de bastoneo; el `tag` viaja per-calf en el jsonb `p_calves`). La visual quedó asimétrica: se puede poner un tag distinto a cada mellizo pero no un idv distinto. En el campo muchas veces se ponen **ambas** caravanas a cada cría en el momento del nacimiento.

**Decisión de Raf**: levantar la restricción. La caravana visual pasa a ser **por cría**, simétrica con la electrónica. Se **revisan RPRC.2/RPRC.3**.

## Estado as-built relevante

- **RPC vigente**: `register_birth` (migración `0116`, firma **6-arg** `(p_mother_profile_id uuid, p_event_date date, p_calves jsonb, p_client_op_id uuid, p_calf_rodeo_id uuid, p_calf_idv text)`). Calcula `v_calf_idv := nullif(trim(coalesce(p_calf_idv,'')),'')` **UNA vez antes del loop**; dentro del loop lee `calf_tag_electronic` **por cría** de cada elemento de `p_calves`; al insertar `animal_profiles` pone `idv = v_calf_idv` (el único) y `visual_id_alt = case when v_calf_tag is null then '<fallback recién nacido>' else null end`.
- **Constraint de unicidad**: índice parcial `animal_profiles_idv_unique on (establishment_id, idv) where idv is not null and deleted_at is null` (`0020`) → **23505** si se repite un idv en el mismo campo. El check `at least one of tag/idv/visual_id_alt` (`0021`, R4.2) exige que cada perfil tenga **al menos una** de las tres identidades — hoy lo satisface el fallback `visual_id_alt` cuando no hay tag.
- **Frontend** (`app/app/agregar-evento.tsx`, `PartoForm`): la visual es UN `FormField` "Caravana visual del ternero (opcional)" a **nivel camada**, renderizado SOLO con `calves.length === 1`; con mellizos, un `InfoNote`. La electrónica ya es por `CalfBlock` (CTA bastoneo → captura a `tagRaw` del calf). El submit manda `calves: [{sex, weightKg, tag}]` (tag per-calf) + un `calfIdv` **único** (solo con 1 cría, vía `calfIdvForSubmit`).
- **Service** (`app/src/services/events.ts`, `registerBirth`/`RegisterBirthInput`): `calves: BirthCalfInput[]` (per-calf sex/weightKg/tag) + `calfIdv?: string|null` (único camada). El overlay pone `idv: calfIdv` (único) en cada cría; los params mandan `p_calf_idv` cuando `input.calfIdv` viene.
- **Backward-compat #15 (cría al pie)**: el camino CREATE de `LinkCalfPrompt` es **siempre 1 cría** y sigue mandando `p_calf_idv` (top-level). NO se toca.

## Decisiones (Gate 0)

**D1 — Caravana visual (idv) POR CRÍA, simétrica con la electrónica.** Cada `CalfBlock` gana su propio `FormField` "Caravana visual del ternero (opcional)", junto al bastoneo (mismo bloque del ternero). Se **elimina** el campo idv a nivel camada (single-calf) y el `InfoNote` de mellizos. Aplica a single **y** mellizos: cada cría con su idv independiente. → cada `calf` del payload lleva `calf_idv`.

**D2 — Ambas caravanas SIEMPRE OPCIONALES (CONSTRAINT DURO de Raf).** Se puede crear el ternero **sin ninguna de las dos** (ni visual idv ni electrónica). **NINGUNA validación client-side ni server-side debe forzar cargar idv ni tag.** Los labels siguen "(opcional)". (Es el comportamiento actual; se preserva textual.)

**D3 — RPC `register_birth`: idv por cría, MISMA FIRMA, con `p_calf_idv` conservado para backward-compat.** El cómputo del idv se mueve **adentro del loop, por cría**, leyendo `calf_idv` de cada elemento de `p_calves` (paralelo a `calf_tag_electronic`), con **precedencia per-calf sobre el param viejo**: `v_calf_idv := coalesce( nullif(trim(coalesce(v_calf->>'calf_idv','')),''), nullif(trim(coalesce(p_calf_idv,'')),'') )`. Así: el parto manda per-calf; la cría al pie (#15) manda `p_calf_idv` (top-level) y cae por el fallback; los mellizos nunca mandan `p_calf_idv` (cada cría trae su `calf_idv`). El fallback se refina: `visual_id_alt = case when v_calf_tag is null AND v_calf_idv is null then '<fallback>' else null end`. **NADA MÁS cambia**. → migración NUEVA (próximo número libre, `0121`), **Gate 1** + **DEPLOY GATEADO a Raf**.

**D4 — Mellizos: idv independiente por cría; duplicado rechazado server-side.** Cada cría con su idv; idvs distintos son válidos. Un idv **repetido dentro del mismo parto** (dos mellizos con el mismo idv) o **contra el rebaño** (`(establishment_id, idv)`) lo rechaza el índice parcial con **23505** → la RPC aborta **atómica** (rollback total). El rechazo se superficia con copy **es-AR** por el canal de status/error de la outbox (offline-first), **sin crash**.

**D5 — Backward-compat #15 (cría al pie).** El camino CREATE de `LinkCalfPrompt` (siempre 1 cría) **sigue funcionando** con `p_calf_idv` (top-level) — cae por el fallback del `coalesce`. `events.ts` **conserva** el param `calfIdv`/`p_calf_idv` para ese caller. Regresión obligatoria.

**D6 — Gate 2.5 (ADR-029) + E2E.** Es UI → capture del form de parto con la visual **por ternero** (single + mellizos). E2E de regresión: (a) 1 ternero con idv → persiste; (b) mellizos con idv **distinto** cada uno → ambos persisten con su idv; (c) **ambos vacíos** (sin idv ni tag) → parto OK, terneros sin caravana (constraint de opcionalidad D2).

## Edge cases

- **Mellizos, idvs distintos**: ambos persisten con su idv (D1/D4).
- **Mellizos, mismo idv (o idv ya usado en el campo)**: 23505 → rollback atómico → surface es-AR permanente por la outbox, sin crash (D4).
- **Ternero sin ninguna caravana (idv null + tag null)**: parto OK; el perfil satisface el check R4.2 porque la RPC pone el fallback `visual_id_alt` (both-null → fallback). Es el pilar de la opcionalidad (D2).
- **Ternero con idv pero sin tag**: `visual_id_alt = null` (el idv ya identifica) — el fallback ya NO aplica.
- **Cría al pie (#15)**: 1 cría, `p_calf_idv` top-level (sin `calf_idv` en el elemento) → cae por el `coalesce` (D5).
- **Offline**: lectura local; escritura por la outbox; rechazo 23505 clasificado permanente (D4).
- **Parto desde la ficha vs. maniobra**: misma pantalla (`agregar-evento.tsx`) → un solo cambio de frontend cubre ambos.

## Alcance / no-alcance

- **SÍ**: campo idv por `CalfBlock` (single + mellizos) en el parto; eliminación del campo camada + nota; migración `register_birth` (idv per-calf, misma firma, `p_calf_idv` conservado); reconciliación de RPRC.2/RPRC.3; capture file; E2E; regresión de cría al pie.
- **NO** (este delta): cambiar la firma del RPC (se conserva 6-arg); tocar el rodeo del parto (sigue escalar a nivel camada, RPRC.1 intacto); asignar visual desde la ficha (ya existe, delta `caravana-ficha`); cualquier validación que fuerce cargar caravana (D2 lo prohíbe).

## Reconciliación con `parto-rodeo-caravana`

- **RPRC.2.1/2.3/2.4** (idv single-calf only + nota de mellizos) → **SUPERADAS** por este delta: el idv es ahora **por cría**, no single-calf; la nota se elimina.
- **RPRC.3.2/3.3** (`calfIdv` camada solo single-calf, descartado con mellizos) → **SUPERADAS**: cada cría manda su `calf_idv`.
- **RPRC.1** (rodeo del parto a nivel camada) queda **intacto** — el rodeo sigue siendo escalar (los mellizos van juntos); solo la visual pasa a per-calf.
- **RPRC.2.5** (tag electrónico por ternero) queda **intacto** (ya era per-calf).

## Insumos para spec_author

- RPC vigente: `supabase/migrations/0116_register_birth_breed_id_fix.sql` (cuerpo a moldear — el implementer moldea sobre el cuerpo **VIGENTE del remoto** que le pasa el leader, no sobre esta migración; `reference_function_recreate_base`).
- Constraints de idv: `0020_animal_profiles.sql` (`animal_profiles_idv_unique`, R4.3) + `0021_animal_profiles_validations.sql` (check R4.2 at-least-one).
- Frontend: `app/app/agregar-evento.tsx` (`PartoForm`/`CalfBlock`), helpers `app/src/utils/calf-birth.ts`, service `app/src/services/events.ts` (`registerBirth`/`RegisterBirthInput`/`BirthCalfInput`).
- Delta madre: `requirements/design/tasks-parto-rodeo-caravana.md` (RPRC.*, a reconciliar).
- E2E: `app/e2e/events.spec.ts` (test parto-rodeo-caravana), `app/e2e/parto-bastoneo.spec.ts`, `app/e2e/helpers/admin.ts` (`waitForServerBirth`/`waitForServerCalfTags` — se necesita el análogo para idv).
- ADR-028 (delta-spec), ADR-029 (Gate 2.5), ADR-023 (tokens/sin hardcode), ADR-019 (gates), memorias `feedback_es_ar_number_format`/`reference_function_recreate_base`/`feedback_correcciones_en_specs`.

## Tareas para la spec

El spec_author redacta `{requirements,design,tasks}-parto-caravana-visual-por-ternero.md` (numeración `PCV.<n>`) traduciendo D1–D6 a EARS, con el contrato del RPC (idv per-calf, misma firma, fallback refinado), el mapa a los archivos as-built, la nota de reconciliación con RPRC.2/3, el capture file del Gate 2.5 y la regresión de cría al pie. Marca qué toca **backend (Gate 1 + deploy gateado)** vs **frontend**.
