# Gate 1 (ADR-019) — Security spec review · `parto-caravana-visual-por-ternero`

**Modo**: `spec` · **Feature**: spec 02, delta Nivel B (ADR-028) `parto-caravana-visual-por-ternero`.
**Fecha**: 2026-07-07 · **Auditor**: security_analyzer (Opus 4.8).
**Input**: `context/requirements/design/tasks-parto-caravana-visual-por-ternero.md`.
**Disparó Gate 1**: toca el RPC security-definer `register_birth` + dato regulado (idv = identidad del animal, superficie SIGSA).

## Veredicto: **NEEDS_CLARIFICATION**

Los 7 focos de riesgo del mandato **PASAN** — el cambio (idv per-calf, misma firma 6-arg, `coalesce(per-calf, top-level)`, fallback refinado) **no introduce ningún hueco explotable**. La implementación **tal como está especificada** (PCV.4.5 refinado) produce código seguro y no requiere cambios de lógica.

El único bloqueo es **documental pero load-bearing**: el **design §5** contiene una afirmación factual **incorrecta** ("Verificado en el remoto … no existe NINGÚN otro constraint que exija 'al menos un identificador'") que además **contradice al requirement PCV.2.4**. Existe un **trigger ACTIVO** (`tg_animal_profiles_identity_check`, 0021 + 0039) que sí enforça "al menos una identidad", y el fallback `visual_id_alt` es **load-bearing** para satisfacerlo en el caso both-null — NO una "nicety de display removible" como lo clasifica §5. Como esta afirmación es el sustento de seguridad del **constraint DURO de Raf** (opcionalidad, PCV.2.1), debe corregirse antes de la Puerta 1 para no dejar una trampa a un delta futuro. Ver **MEDIUM-1**.

---

## Resolución del leader (2026-07-07) — MEDIUM-1 cerrado → **Gate 1 = PASS**

MEDIUM-1 era un error MÍO en el design §5 (verifiqué at-least-one solo por `pg_constraint`/`pg_index`, punto ciego: los triggers no aparecen ahí). Resuelto:

1. **Trigger confirmado por `pg_trigger`** (remoto, 2026-07-07): `animal_profiles_identity_check` (BEFORE INSERT/UPDATE, fn `tg_animal_profiles_identity_check`, `SECURITY DEFINER`) enforça `coalesce(nullif(trim(animals.tag_electronic),''), nullif(trim(new.idv),''), nullif(trim(new.visual_id_alt),'')) is null → 23514`. El column-CHECK `animal_profiles_local_id_check` sí es no-op (`OR true`), pero el TRIGGER no.
2. **Design §5 reescrito**: distingue el column-CHECK no-op del trigger activo; el fallback `visual_id_alt` en el both-null queda declarado **LOAD-BEARING** (consistente con PCV.2.4), con warning explícito de "no borrar creyéndolo display". **§7** actualizado igual.
3. **Tasks T3(d)** ahora nombra el trigger explícito (sin el fallback → 23514) como regresión de la opcionalidad.

Runtime del delta **inalterado** (PCV.4.5 ya seteaba el fallback en both-null → pasa el trigger; los 7 focos HIGH ya estaban PASS). No hubo cambio de lógica, solo corrección documental + regresión explícita. **Gate 1 cerrado como PASS** — habilitado a implementer + Gate 2 (code, sobre el diff real). El LOW pre-existente (`p_calves` sin cota de array) queda anotado para Gate 2 / backlog; no bloquea.

---

## Findings HIGH

**Ninguno.** Los 7 focos del mandato se auditaron contra los objetos reales de la DB (migraciones + cuerpo vigente del RPC) y todos pasan:

| # | Foco | Resultado | Evidencia |
|---|---|---|---|
| 1 | Cross-tenant / IDOR por idv per-calf | **PASS** | `v_est` deriva de la **fila real** de la madre (`0116:55-60`, `where p.id = p_mother_profile_id`); `has_role_in(v_est)` (`0116:64-66`, 42501). El insert de cría usa `establishment_id = v_est` (server-derivado, `0116:152`). El índice único `animal_profiles_idv_unique (establishment_id, idv)` (`0020:51-53`) está scopeado al tenant server-derivado → un `calf_idv` del payload **solo** puede colisionar dentro del propio establishment del caller; **no** puede escribir ni pisar el idv de otro tenant ni filtrar su existencia. El cliente nunca pasa `establishment_id`. El nuevo canal `v_calf->>'calf_idv'` no cambia el scoping. |
| 2 | Idempotencia (HIGH-D1) | **PASS** | El guard de idempotencia (`0116:69-81`, dedup por `(client_op_id, animal_profile_id, establishment_id)`) corre **antes del loop** y antes de todo cómputo de idv. El `coalesce` per-calf es lectura del payload dentro del loop de inserts — no toca `p_client_op_id` ni la de-dup. Mover el cómputo del idv adentro del loop no afecta el guard, que es upstream. |
| 3 | Bound server-side del idv (mandato del gate) | **PASS (cubierto)** | Verificado por mí en `0070:188-189`: `animal_profiles_idv_len_chk CHECK (char_length(idv) <= 64)` con `not valid` **+ `validate constraint`** → validado y enforça **todo INSERT futuro**. El único *sink* del idv es el INSERT en `animal_profiles.idv` (`0116:154`), que dispara ese CHECK (los CHECK se enforçan siempre, aun bajo SECURITY DEFINER). Un idv >64 → check violation → rollback atómico. El RPC **no necesita** su propio cap. El sanitizador cliente `sanitizeIdvInput` (cap `IDV_MAX_LENGTH=20`, `animal-input.ts:40-42`) es UX/attacker-controlled; el CHECK de columna es la capa autoritativa. **No hay** otro *sink* (sin log, sin concat en `.or()/.filter()`, sin `ilike`, sin prompt LLM). |
| 4 | Opcionalidad (idv/tag null) sin romper invariantes | **PASS runtime** (ver **MEDIUM-1** por la justificación del design) | El fallback refinado `case when v_calf_tag is null and v_calf_idv is null then v_visual_fallback else null end` deja `visual_id_alt` **no-null en todo caso both-null** → el trigger `tg_animal_profiles_identity_check` (activo, ver MEDIUM-1) **pasa** en las 4 ramas de la matriz. Ninguna rama produce un perfil que viole el trigger. El trigger de inmutabilidad `tg_animal_profiles_block_idv_change` (`0036:27-42`) es BEFORE **UPDATE** — el RPC solo INSERTa, no aplica. |
| 5 | Atomicidad / rollback en 23505 | **PASS** | Todo el RPC es una función `plpgsql` única (una transacción). Dos mellizos con el mismo idv, o colisión con el rebaño → el 2º INSERT viola `animal_profiles_idv_unique` → **23505** → rollback total (0 eventos / 0 terneros). PCV.5.3 correcto. |
| 6 | Backward-compat cría al pie (#15) | **PASS** | El `coalesce(nullif(trim(v_calf->>'calf_idv')), nullif(trim(p_calf_idv)))` cae al `p_calf_idv` top-level cuando el elemento no trae `calf_idv` (1 cría de #15). `events.ts` conserva `RegisterBirthInput.calfIdv → p_calf_idv` (PCV.6.2). Contrato del caller intacto. |
| 7 | No degradar `revoke public/anon` + `grant authenticated` | **PASS** | El cierre del design §2 re-aplica `revoke execute … from public, anon` + `grant execute … to authenticated` + `notify pgrst` — idéntico a `0116:178-179`. Superficie de ejecución sin degradar. `CREATE OR REPLACE` (no DROP) preserva grants existentes de todos modos. |

---

## Findings MEDIUM

### MEDIUM-1 — El design §5 afirma (falsamente) que "no existe ningún constraint que exija al menos un identificador" y clasifica el fallback como removible; hay un trigger ACTIVO que lo exige, y el fallback es load-bearing. Contradice a PCV.2.4.

**Severidad**: MEDIUM (no explotable hoy — el runtime es seguro; es una trampa latente + contradicción interna del spec que socava la justificación de un **constraint duro de Raf**).

**Cita literal (design §5, líneas 125-135)**:
> "**Verificado en el remoto (2026-07-07, leader):** el check histórico 'R4.2' (`animal_profiles_local_id_check`, 0021) hoy es un **NO-OP**. … **No existe NINGÚN otro constraint** que exija 'al menos un identificador' (verificado por `pg_constraint`/`pg_index` sobre `animal_profiles`). … El **fallback** `visual_id_alt = '<fallback recién nacido>'` … se **conserva** … pero como **nicety de DISPLAY** …, **NO** como satisfacción de un constraint."

**Por qué es incorrecto (evidencia)**:
1. El objeto no-op citado (`animal_profiles_local_id_check`, `... OR true`) está en **0020:41-44** (una **column CHECK**), no en 0021. El design conflaciona el nombre.
2. La verdadera mecánica de "R4.2" es un **TRIGGER**, no un check: `tg_animal_profiles_identity_check` creado en **0021:6-22** y **redefinido como SECURITY DEFINER en 0039:10-23**. Está **activo** (`create trigger animal_profiles_identity_check before insert or update … `, 0021:20-22; 0039 solo hizo `create or replace function`, sin dropear el trigger). Levanta `23514` si `coalesce(animals.tag_electronic, new.idv, new.visual_id_alt) is null`.
3. Un **trigger no aparece en `pg_constraint` ni en `pg_index`** — la metodología de verificación citada ("verificado por pg_constraint/pg_index") tiene un **punto ciego** exacto donde vive el enforcement real.
4. Por lo tanto el fallback **NO es cosmético**: es **load-bearing** para pasar ese trigger en el caso both-null. Esto es literalmente lo que dice el requirement **PCV.2.4**: *"el RPC deberá poner el fallback `visual_id_alt = '<fallback recién nacido>'` **para satisfacer el check 'al menos una identidad' (R4.2, 0021)**"*. → **design §5 contradice a requirements PCV.2.4.**

**Riesgo concreto (por qué no es cosmético el fix)**: un delta futuro que lea §5 ("el fallback es solo display, removible; no hay constraint que lo requiera") y **elimine el fallback** rompería el INSERT del caso both-null con `23514` → rollback del parto completo → **quiebra el constraint duro de Raf (PCV.2.1: crear el ternero sin ninguna caravana)**. §5 es justamente la sección que *justifica la seguridad de la opcionalidad*, y la justifica con una razón falsa.

**Nota de alcance**: la implementación de **este** delta NO cambia — PCV.4.5 (fallback refinado `when v_calf_tag is null and v_calf_idv is null`) ya es correcta y load-bearing. El bug es **solo del texto del design §5**.

**Recomendación accionable (corrección de spec, no de código)**:
- Corregir design §5 para: (a) distinguir la **column CHECK no-op** (`animal_profiles_local_id_check`, 0020, `OR true`) del **trigger activo** (`tg_animal_profiles_identity_check`, 0021+0039); (b) declarar que el trigger **SÍ** enforça "al menos una identidad" (23514) y que la verificación previa (pg_constraint/pg_index) **no lo cubrió** (falta `pg_trigger`); (c) **reclasificar el fallback `visual_id_alt` como load-bearing** (satisface el trigger en el caso both-null), consistente con PCV.2.4 — no como "nicety de display removible".
- Confirmar el estado del trigger en el remoto vía `pg_trigger` (no solo `pg_constraint`/`pg_index`) antes de cerrar la Puerta 1, para cerrar el punto ciego de la metodología.
- (Opcional) Agregar a `tasks.md` T3 un caso explícito: *both-null → el perfil se crea con `visual_id_alt = fallback` y el trigger identity-check pasa* — ya está implícito en T3(d), hacerlo explícito como regresión del trigger.

---

## Anexo LOW (informativo — no bloquea; para el Gate 2 / hardening futuro)

- **LOW-1 (pre-existente, fuera del blast radius de este delta) — `p_calves` sin cota de longitud de array.** `0116:91-97` valida `jsonb_typeof = 'array'` y `v_count >= 1`, pero **no** hay tope superior. Un caller autenticado podría mandar un array enorme (N terneros) → N inserts animal+profile en una transacción (lente "decenas de miles", catálogo E1/E5). **No lo introduce este delta** (el array ya era ilimitado; este delta solo agrega la lectura per-elemento de `calf_idv`). Recomendación de hardening futuro (no en este delta): cota `v_count <= N` razonable (ej. ≤ 20) en un fix separado.
- **LOW-2 (se verifica en Gate 2, no en spec) — surface del 23505 al cliente.** PCV.5.4 indica clasificar el 23505 como permanente y superficiar copy **es-AR** por la outbox. En el gate de código (Gate 2) hay que confirmar que el handler **no** vuelca `err.message` crudo de Postgres al usuario (information disclosure, catálogo B1) sino un mensaje mapeado. El 23505 no filtra datos cross-tenant (el índice es per-establishment), así que el riesgo es bajo; igual verificar el mapeo en el diff.

---

## Tabla de inputs (campos que el usuario tipea, tocados por este delta)

| campo | límite (largo/charset/formato/rango) | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| Caravana visual del ternero (idv) — `calf-idv-<index>`, por cría | Largo ≤ **64** (autoritativo) · solo dígitos + ≤20 (cliente, UX) | **Server**: CHECK `animal_profiles_idv_len_chk <= 64` (0070) sobre el sink INSERT. **Cliente**: `sanitizeIdvInput` (dígitos, ≤20) = UX bypasseable. Unicidad `(establishment_id, idv)` server-side (23505). Opcional (PCV.2). | **Sí** |
| Caravana electrónica (tag) — bastoneo, por cría (intacto, RCF.6) | Largo ≤ **64** (columna) + cap **≤15** en el RPC (`0116:133`, FDX-B) | **Server**: cap ≤15 en RPC + CHECK `<=64` (0070) + inmutabilidad (0036). **Cliente**: `sanitizeTagInput` (15 díg) = UX. Opcional. | Sí (no tocado por el delta) |

Nota: el delta **no** agrega campos de texto libre nuevos con otro *sink* (log/`.or()`/`ilike`/prompt LLM). El idv fluye cliente → jsonb `p_calves[].calf_idv` → `trim` → INSERT `animal_profiles.idv` (capeado). Bounded en el sink.

## Tabla de rate limits (acciones abusables tocadas por este delta)

| acción | rate limit (sí/no/n.a.) | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `register_birth` (RPC, escritura de parto) | **no** (RPC PostgREST, Supabase no rate-limitea RPCs por defecto) | — | n.a. | **Pre-existente, no introducido por este delta.** Requiere `has_role_in(v_est)` (autenticado + rol en el tenant). El delta no cambia el perfil de abuso. El vector de amplificación real es LOW-1 (array `p_calves` sin cota), no el idv per-calf. Sin acción en este delta; anotar para hardening. |
| Envío de email/SMS / API externa | n.a. | — | — | El delta no toca ningún canal con costo por request (no email/SMS/SENASA/SIGSA en el path del RPC). |

---

## Dominios revisados (trazabilidad)

- **A1/A3 (authz objeto/función, IDOR por FK)** — tenant y rodeo del ternero derivados/revalidados server-side (`v_est` de la fila real; `p_calf_rodeo_id` → 23514 same-tenant/same-system, `0116:101-117`). El idv per-calf no abre vector. Foco #1.
- **A2 (mass assignment)** — el insert de `animal_profiles` arma los campos uno a uno; `establishment_id`, `category_id`, `breed_id`, `status` son server-derivados, **no** vienen del payload del cliente. `calf_idv`/`calf_tag`/`calf_sex`/`calf_weight` son los únicos campos del cliente y van a columnas acotadas. Sin spread de `body`.
- **Input bound autoritativo (mandato)** — CHECK de columna `<=64`. Foco #3.
- **Idempotencia (HIGH-D1)** — guard upstream intacto. Foco #2.
- **Opcionalidad / trigger identity-check** — trigger activo (0021+0039); fallback load-bearing. Foco #4 + MEDIUM-1.
- **Atomicidad / rollback (23505)** — función única, transacción atómica. Foco #5.
- **Backward-compat / contrato de firma** — `CREATE OR REPLACE` misma firma 6-arg; coalesce cubre cría al pie. Foco #6.
- **Grants / superficie de ejecución** — revoke public/anon + grant authenticated re-aplicados. Foco #7.
- **B1 (information disclosure)** — sin `err.message` crudo en el path server; surface del 23505 se verifica en Gate 2 (LOW-2).
- **Inmutabilidad de identidad (0036)** — trigger BEFORE UPDATE, no aplica al INSERT-only del RPC. Sin regresión.
- **Dato regulado (SIGSA / R1.7)** — la herencia de `breed_id` de la madre (`0116:158`) queda intacta por PCV.4.6/T5; el delta no la toca (moldeo sobre cuerpo vigente, `reference_function_recreate_base`).

## Dominios excluidos (con justificación)

- **C (offline/sync PowerSync/Realtime/data-at-rest)** — la escritura va por la outbox as-built (`registerBirth`/`uploadData`), sin cambio de contrato de sync ni de reglas PowerSync; el delta no crea superficie offline nueva. La clasificación del 23505 como permanente es as-built.
- **D (secretos / supply chain)** — el delta no toca secrets, imports Deno ni CI/CD. Migración SQL + frontend puro.
- **E2-E4 (denial-of-wallet / bot / enumeration)** — sin endpoints con costo por request nuevos; la enumeración por 23505 es intra-tenant (sin leak). E1/E5 (array sin cota) = LOW-1, pre-existente.
- **F2-F4 (import CSV / SSRF / XSS email)** — no hay import de archivos, `fetch()` a URL de usuario, ni templates de email en este delta.
- **G (BLE)** — el bastoneo (RCF.6) queda **intacto**; el delta no cambia el trust boundary BLE (solo agrega el campo idv de texto junto al bastoneo).
- **H/I (sesión / compliance / mobile)** — sin cambios de auth/sesión, retención/borrado ni hardening mobile.

---

## Cierre

- **Veredicto**: **NEEDS_CLARIFICATION**. Los 7 focos HIGH pasan; la lógica a implementar es segura y no requiere cambios. El bloqueo es **MEDIUM-1**: corregir el design §5 (trigger `tg_animal_profiles_identity_check` activo; fallback load-bearing; contradicción con PCV.2.4; punto ciego de la metodología pg_constraint/pg_index → falta pg_trigger).
- **Acción del leader antes de la Puerta 1**: aplicar la corrección de §5 (documental, sin tocar la lógica del RPC ni de PCV.4.5), confirmar el trigger vía `pg_trigger` en el remoto, y — si querés — hacer explícito el caso both-null en T3 como regresión del trigger. Con eso, re-veredicto → PASS.
- **Cobertura de la skill `sentry-skills:security-review`**: NO ejecutada en este pase. Es una skill code-review orientada a **diff**, y en modo `spec` **no existe aún** el diff (la migración `0121` no está escrita). Correrla sobre archivos no modificados violaría la regla dura del rol ("nunca corrés la skill sobre archivos NO modificados"). La skill corre en **Gate 2 (code)** sobre el diff real (migración `0121` + frontend). Este pase es revisión de dominio manual (protocolo modo `spec`) fundamentada contra los objetos reales de la DB.
- **DEPLOY** de `0121`: gateado a Raf por Supabase MCP tras Gate 1 PASS + reviewer + Gate 2, con el banner "🔴 NO aplicar desde acá" (design §7).
