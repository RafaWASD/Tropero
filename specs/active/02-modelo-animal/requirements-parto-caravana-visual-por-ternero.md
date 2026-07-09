# Spec 02 — Delta PARTO: CARAVANA VISUAL DEL TERNERO **POR CRÍA** — Requirements (EARS)

**Status**: `spec_ready` — delta **Nivel B (ADR-028)** sobre spec 02 (feature `done`/`deferred`). **Toca backend** (RPC `register_birth`) **+ frontend**. El baseline NO se reescribe; este delta trae su propio set `{context,requirements,design,tasks}-parto-caravana-visual-por-ternero.md`.
**Fecha**: 2026-07-07.
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/02-modelo-animal/context-parto-caravana-visual-por-ternero.md` (Gate 0 **aprobado por Raf** — decisión de alcance en sesión). Las decisiones D1–D6 vienen lockeadas en ese contexto; acá NO se re-deciden, se traducen a EARS.
**Revisa**: `requirements-parto-rodeo-caravana.md` — **RPRC.2.1/2.3/2.4** y **RPRC.3.2/3.3** quedan **SUPERADAS** por este delta (ver PCV.7 + "Historial de refinamiento").

> **Gate 1 APLICA** (ADR-019): este delta **toca el RPC `register_birth`** (schema/función + **dato regulado** — el idv es identidad del animal, cae en la superficie SIGSA). El `security_analyzer` modo `spec` audita el cambio del RPC antes de la Puerta 1. El **DEPLOY de la migración está GATEADO a Raf** (Supabase MCP). El frontend (agregar-evento.tsx / events.ts) es puro (sin superficie de seguridad nueva).

> **Notación EARS** (`docs/specs.md`). **Numeración `PCV.<n>`** ("Parto Caravana Visual") para no colisionar con `R<n>` (baseline), `RPRC.<n>`, `RCAP.<n>`, `RCF.<n>`, `RAF2.<n>`, `RAR.<n>`, etc. IDs estables; cada hoja `PCV.<n>.<m>` verificable por ≥1 test.

---

## Resumen

Un solo cambio de capacidad, en tres capas coordinadas:

1. **Frontend** — la **caravana visual (idv)** del ternero al parto pasa de ser un campo a **nivel camada solo con 1 ternero** a un campo **POR CRÍA** (dentro de cada `CalfBlock`), **simétrico** con la caravana **electrónica** (bastoneo, ya per-calf). Aplica a single y mellizos.
2. **Backend** — el RPC `register_birth` (**MISMA firma 6-arg**) computa el idv **por cría** (leyendo `calf_idv` de cada elemento de `p_calves`), con **precedencia per-calf** sobre el param `p_calf_idv` (conservado para backward-compat del camino cría al pie #15). Migración NUEVA (`0121`), **Gate 1 + deploy gateado a Raf**.
3. **Constraint duro** — **ambas caravanas (visual + electrónica) son SIEMPRE OPCIONALES**; ninguna validación (client ni server) fuerza cargarlas.

---

## PCV.1 — Caravana visual (idv) POR CRÍA en el form de parto (D1)

**PCV.1.1** Cuando el operario esté en el form de parto (`agregar-evento.tsx`, `eventType='birth'`), el sistema deberá mostrar, dentro del bloque de **cada ternero** (`CalfBlock`), un campo **opcional** de **caravana visual del ternero (idv)**, junto a la caravana electrónica (bastoneo) del mismo ternero.

**PCV.1.2** El sistema deberá mostrar el campo de caravana visual de cada ternero **tanto con 1 ternero como con ≥2 terneros (mellizos)** — un campo idv independiente por cada `CalfBlock`.

**PCV.1.3** El sistema deberá **sanitizar en vivo** el input de caravana visual de cada ternero con `sanitizeIdvInput` (reúso, sin clamp que oculte un error de tipeo).

**PCV.1.4** El sistema deberá conservar el valor de caravana visual **por ternero** en el estado de la lista de terneros (cada `calf` lleva su idv), de forma que agregar o quitar un mellizo **no** mezcle ni pierda los idv de los demás terneros.

**PCV.1.5** El sistema **no deberá** renderizar el campo de caravana visual a **nivel camada** (single-calf) ni el `InfoNote` de mellizos ("Las caravanas visuales de mellizos se asignan después…"): ambos se **eliminan** (superan RPRC.2, ver PCV.7).

**PCV.1.6** El label del campo de caravana visual de cada ternero deberá mantener el sufijo **"(opcional)"** (constraint de opcionalidad, PCV.2).

## PCV.2 — Ambas caravanas SIEMPRE OPCIONALES (CONSTRAINT DURO de Raf, D2)

> **Textual del constraint de Raf**: *Ambas caravanas (visual idv + electrónica) son SIEMPRE OPCIONALES. Se puede crear el ternero sin ninguna de las dos. NINGUNA validación client-side ni server-side debe forzar cargar idv ni tag.*

**PCV.2.1** El sistema deberá permitir **confirmar el parto y crear el ternero sin ninguna de las dos caravanas** (ni idv ni tag electrónico).

**PCV.2.2** El sistema **no deberá** introducir ninguna validación **client-side** que exija cargar el idv o el tag de un ternero (ni bloqueo de submit, ni error inline por caravana vacía).

**PCV.2.3** El RPC `register_birth` **no deberá** exigir server-side el idv ni el tag de un ternero (sin `NOT NULL`, sin check de obligatoriedad): un ternero con `calf_idv` vacío/ausente y `calf_tag_electronic` vacío/ausente deberá crearse con éxito.

**PCV.2.4** Cuando un ternero se cree **sin idv y sin tag**, el RPC deberá poner el **fallback** `visual_id_alt = '<fallback recién nacido>'` para satisfacer el check "al menos una identidad" (R4.2, `0021`), sin que el operario haya tenido que cargar nada.
> **SUPERADA por `identificadores-unificados` (2026-07-09, delta CON BACKEND, `0122`)**: se **eliminó `visual_id_alt`** (columna + fallback) y se **dropeó** el trigger de identidad (R4.2 / `0021`) → todas las identidades pasan a ser **opcionales**, un ternero puede crearse con cero. `register_birth` se re-CREATE **sin** el fallback (ya no hay check que satisfacer). Cubre también los refs de `visual_id_alt` en la tabla de decisiones (D2) y en la sección Edge. Ver `requirements-identificadores-unificados.md` IDU.1.4/IDU.1.5.

## PCV.3 — Paso del idv per-calf a `registerBirth` (D1)

**PCV.3.1** Al confirmar el parto, el sistema deberá pasar el idv de **cada ternero** (sanitizado, no vacío) como **`calf_idv`** en el elemento correspondiente del payload `calves` de `registerBirth`.

**PCV.3.2** El sistema **no deberá** pasar un `calfIdv` **único a nivel camada** desde el camino del parto (se deja de usar el param top-level `calfIdv` para el parto; el idv viaja per-calf).

**PCV.3.3** Cuando el idv de un ternero esté **vacío**, el sistema **no deberá** incluir `calf_idv` para ese ternero (omitido/`null`) — sin forzar (PCV.2).

**PCV.3.4** El sistema **no deberá** alterar el resto del payload de `registerBirth`: `sex`/`weightKg`/`tag` por ternero (via `validateCalves`), `eventDate`, `motherProfileId` y `calfRodeoId` (rodeo del parto, RPRC.1) quedan sin cambios.

## PCV.4 — RPC `register_birth`: idv por cría, MISMA firma, `p_calf_idv` conservado (D3)

**PCV.4.1** El RPC `register_birth` deberá conservar la **MISMA firma 6-arg** `(p_mother_profile_id uuid, p_event_date date, p_calves jsonb, p_client_op_id uuid, p_calf_rodeo_id uuid, p_calf_idv text)` — la firma **no cambia** (el param `p_calf_idv` se **conserva** para backward-compat del camino cría al pie #15).

**PCV.4.2** El RPC deberá computar el idv del ternero **adentro del loop de terneros, por cría**, leyendo `calf_idv` de **cada elemento** de `p_calves` (paralelo a como ya lee `calf_tag_electronic`), en vez de computarlo una sola vez antes del loop.

**PCV.4.3** El RPC deberá aplicar **precedencia del idv per-calf sobre el param top-level**: `v_calf_idv := coalesce( nullif(trim(coalesce(v_calf->>'calf_idv','')),''), nullif(trim(coalesce(p_calf_idv,'')),'') )` — el `calf_idv` del elemento gana; si es vacío/ausente, cae al `p_calf_idv` (cría al pie).

**PCV.4.4** El RPC deberá insertar `idv = v_calf_idv` en el `animal_profiles` de **cada** ternero (el valor per-calf resuelto en PCV.4.3).

**PCV.4.5** El RPC deberá refinar el fallback del `visual_id_alt` a: `visual_id_alt = case when v_calf_tag is null AND v_calf_idv is null then '<fallback recién nacido>' else null end` — si el ternero tiene idv (aunque no tenga tag), **no** aplica el placeholder (ya está identificado).

**PCV.4.6** El RPC **no deberá** cambiar **nada más** respecto del cuerpo vigente (`0116`): tenant-check derivado de la fila real de la madre, `has_role_in` (42501), idempotencia por `p_client_op_id` (HIGH-D1), cota de `p_event_date`, validación del array `p_calves`, rodeo del ternero (`p_calf_rodeo_id` → 23514), categoría por sistema, cap del tag (≤15), herencia de `breed_id` de la madre (R1.7/SIGSA), inserts en `birth_calves`, `calf_id` del primer ternero, atomicidad, `revoke public/anon` + `grant authenticated`.

**PCV.4.7** El implementer deberá **moldear el `CREATE OR REPLACE` sobre el cuerpo VIGENTE del RPC en el remoto** (que le pasa el leader), NO sobre una migración vieja (`reference_function_recreate_base`) — la firma 6-arg ya existe, así que es `CREATE OR REPLACE` (no `DROP`+`CREATE`).

## PCV.5 — Mellizos: idv independiente por cría; duplicado rechazado server-side (D4)

**PCV.5.1** Cuando la camada tenga **≥2 terneros (mellizos)**, el sistema deberá permitir cargar un idv **independiente** para cada ternero.

**PCV.5.2** Cuando dos (o más) mellizos tengan idvs **distintos** (y válidos), el sistema deberá crear **ambos** terneros, cada uno con **su** idv persistido en `animal_profiles.idv`.

**PCV.5.3** Si dos terneros del **mismo parto** traen el **mismo idv**, o el idv de un ternero **colisiona** con un idv ya existente en el campo (`(establishment_id, idv)`), entonces el RPC deberá **rechazar** el parto con **23505** (índice parcial `animal_profiles_idv_unique`) y **revertir todo el parto atómicamente** (ningún ternero ni evento persistido).

**PCV.5.4** Si el parto es rechazado con **23505** al subir (offline-first), entonces el sistema deberá clasificar el rechazo como **permanente** (sin loop de reintento) y superficiarlo con copy **es-AR** por el canal de status/error de la outbox (camino as-built de `registerBirth`/`uploadData`), **sin crash** y **sin perder** el resto del trabajo.

## PCV.6 — Backward-compat: cría al pie (#15) sigue con `p_calf_idv` (D5)

**PCV.6.1** El camino **cría al pie** (#15, `LinkCalfPrompt` CREATE, siempre 1 cría) deberá **seguir funcionando** pasando el idv por `p_calf_idv` (top-level): como su único ternero **no** trae `calf_idv` en el elemento, el `coalesce` (PCV.4.3) cae al `p_calf_idv` y el ternero se crea con ese idv.

**PCV.6.2** El servicio `events.ts` deberá **conservar** el param `calfIdv` / `RegisterBirthInput.calfIdv` y su mapeo a `p_calf_idv`, para el caller de cría al pie (no se rompe su contrato).

## PCV.7 — Reconciliación con `parto-rodeo-caravana` (RPRC.2/RPRC.3)

**PCV.7.1** El sistema deberá reflejar que **RPRC.2.1**, **RPRC.2.3** y **RPRC.2.4** (caravana visual SOLO single-calf + nota de mellizos) quedan **SUPERADAS**: la visual es ahora **por cría** (PCV.1), no single-calf; la nota se elimina (PCV.1.5).

**PCV.7.2** El sistema deberá reflejar que **RPRC.3.2** y **RPRC.3.3** (`calfIdv` a nivel camada solo con 1 ternero, descartado con mellizos) quedan **SUPERADAS**: cada cría manda su `calf_idv` (PCV.3.1).

**PCV.7.3** El sistema **no deberá** alterar **RPRC.1** (rodeo del parto a nivel camada, escalar), **RPRC.2.5** (tag electrónico por ternero) ni el resto del delta madre — solo la caravana **visual** pasa a per-calf.

> **[Reconciliación]** El fold al baseline (`requirements-parto-rodeo-caravana.md`: nota bajo RPRC.2/RPRC.3 apuntando a este delta) lo hace el **leader** al cerrar la Puerta 2 de este delta (no se reescribe el EARS de RPRC — nota de reconciliación, patrón `docs/specs.md`).

## PCV.8 — MUSTs de UI de campo + Gate 2.5 + E2E (D6)

**PCV.8.1** El campo de caravana visual de cada ternero deberá usar **solo tokens** del design system (sin hex/px hardcodeado, ADR-023 §4) y **es-AR** voseo en todo copy nuevo/afectado.

**PCV.8.2** Todo label / valor con descendentes (g/p/y/j/q) del campo idv deberá renderizarse **sin recortarse** (`lineHeight` matcheado en headings ≥`$6` y todo `Text` con `numberOfLines`).

**PCV.8.3** El sistema deberá conservar la **validación inline** existente del form (borde rojo + error junto al campo, sin banner global que tape el título) y **no deberá** introducir un banner global de error nuevo ni una validación de caravana (PCV.2.2).

**PCV.8.4** El implementer deberá entregar un **capture file** (Gate 2.5, ADR-029) con capturas nombradas del form de parto con la caravana visual **por ternero**: (a) **parto single** con el campo idv dentro del bloque del ternero; (b) **parto mellizos** (2 terneros) con **un campo idv por cada ternero** (y **sin** el viejo campo camada ni la nota).

**PCV.8.5** El sistema deberá tener cobertura **E2E de regresión** del parto que verifique: (a) **1 ternero con idv** → el ternero creado persiste con **su** idv (oráculo server-side); (b) **mellizos con idv DISTINTO cada uno** → **ambos** terneros persisten con su respectivo idv; (c) **ambos vacíos** (ningún ternero con idv ni tag) → el parto se registra OK y los terneros quedan **sin caravana** (constraint de opcionalidad PCV.2).

**PCV.8.6** El sistema deberá tener cobertura de **regresión de backward-compat de cría al pie** (#15): el camino CREATE con `p_calf_idv` sigue creando el ternero con ese idv (PCV.6).

**PCV.8.7** Cada `PCV.<n>.<m>` deberá quedar mapeado a ≥1 test (unitario, backend y/o E2E) en `progress/impl_parto-caravana-visual-por-ternero.md` (trazabilidad `docs/specs.md`).

---

## Trazabilidad context → requirements

| Caso / decisión del `context.md` | Requirement(s) |
|---|---|
| **D1** — caravana visual idv POR CRÍA (single + mellizos), en cada `CalfBlock`, simétrica con la electrónica; elimina el campo camada + nota | PCV.1.1, PCV.1.2, PCV.1.3, PCV.1.4, PCV.1.5, PCV.1.6, PCV.3.1 |
| **D2** — ambas caravanas SIEMPRE opcionales; sin validación client ni server que fuerce | PCV.2.1, PCV.2.2, PCV.2.3, PCV.2.4, PCV.3.3, PCV.8.3 |
| **D3** — RPC idv por cría, MISMA firma, precedencia per-calf, `p_calf_idv` conservado, fallback refinado, nada más cambia, moldear sobre el vigente | PCV.4.1, PCV.4.2, PCV.4.3, PCV.4.4, PCV.4.5, PCV.4.6, PCV.4.7 |
| **D4** — mellizos: idv independiente; distintos válidos; duplicado (mismo parto o rebaño) → 23505 rollback atómico → surface es-AR permanente sin crash | PCV.5.1, PCV.5.2, PCV.5.3, PCV.5.4 |
| **D5** — backward-compat cría al pie (#15) con `p_calf_idv`; `events.ts` conserva el param | PCV.6.1, PCV.6.2 |
| **D6** — Gate 2.5 capture (single + mellizos) + E2E (1 con idv / mellizos distintos / ambos vacíos) + regresión cría al pie | PCV.8.4, PCV.8.5, PCV.8.6, PCV.8.7 |
| Reconciliación — RPRC.2.1/2.3/2.4 y RPRC.3.2/3.3 SUPERADAS; RPRC.1/2.5 intactos | PCV.7.1, PCV.7.2, PCV.7.3 |
| MUSTs UI de campo (tokens, es-AR, anti-recorte, validación inline conservada) | PCV.8.1, PCV.8.2, PCV.8.3 |
| Edge — ternero sin ninguna caravana → fallback visual_id_alt satisface R4.2 | PCV.2.4 |
| Edge — ternero con idv sin tag → fallback NO aplica | PCV.4.5 |

---

## Historial de refinamiento

- 2026-07-07 — Redacción inicial del delta (Gate 0 **aprobado por Raf** — decisión de alcance en sesión). Este delta **revisa** el delta madre `parto-rodeo-caravana`:
  - **RPRC.2.1 / RPRC.2.3 / RPRC.2.4 SUPERADAS** — la caravana visual (idv) ya **no es single-calf-only**: es **por cría** (incluye mellizos). El `InfoNote` de mellizos ("se asignan después desde la ficha…") se **elimina**. Cubierto por PCV.1 + PCV.7.1.
  - **RPRC.3.2 / RPRC.3.3 SUPERADAS** — ya no hay un `calfIdv` único a nivel camada enviado solo con 1 ternero: cada cría manda su `calf_idv`. Cubierto por PCV.3 + PCV.7.2.
  - La restricción original (idv single-calf) era una **limitación del RPC** (`p_calf_idv` escalar único), **no** una regla de dominio de Facundo → se **levanta**. El RPC pasa a leer el idv **por cría** conservando la firma (backward-compat con cría al pie #15).
  - **RPRC.1** (rodeo del parto, escalar a nivel camada) y **RPRC.2.5** (tag electrónico por ternero) quedan **intactos**.
