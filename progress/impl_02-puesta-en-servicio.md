baseline_commit: 980adf9dbafd90b423cbb620fff112333710d08f

# impl — Spec 02 Stream A: modelo de puesta en servicio (delta backend)

Feature `02-modelo-animal` (in_progress, Puerta 2 aprobada 2026-06-23). Chunk **Stream A — delta backend**.
Implementa `requirements-puesta-en-servicio.md` (RPS.x) + `design-puesta-en-servicio.md` + tasks (TPS.x).

> 🔴 **NO se aplica ninguna migración al remoto.** Solo se escriben los `.sql` + tests. El deploy lo gatea
> el leader post-Gate-2 + autorización de Raf. La suite de tests queda **roja-hasta-apply** (esperado,
> mismo patrón que `0075`–`0082` / `0093`–`0097`).

## Baseline / numeración (TPS.0)
- `git rev-parse HEAD` al arrancar = `980adf9` (commits previos = la spec de Stream A, NO implementación).
- As-built en disco llega a `0101`. `0102`–`0105` libres (verificado, sin terminales paralelas con migraciones en vuelo).
- Numeración: `0102` columna, `0103` RPC (+helper), `0104` compute_category, `0105` denominador.

## Plan (TPS.1 .. TPS.19)
- [ ] TPS.0 — confirmar techo de numeración (≥0102). [hecho: 0102-0105 libres]
- [x] TPS.1 — `0102_rodeo_service_months.sql`: columna + CHECK (rango/únicos/≤12) + comment (RPS.1, RPS.2.1). [escrito]
- [ ] TPS.2 — test DB del CHECK (NULL vs vacío, mes <1/>12, dup, >12, backfill NULL).
- [x] TPS.3 — `0103`: helper `assert_service_months_valid` (IMMUTABLE, revocado). [escrito]
- [x] TPS.4 — `0103`: `create_rodeo` DROP+CREATE con `p_service_months` (default primavera) + re-grant + smoke-check. [escrito]
- [x] TPS.5 — `0103`: `set_rodeo_service_months` (anti-IDOR por derivación, owner-only, idempotente) + grant + smoke-check. [escrito]
- [x] TPS.2 — test DB del CHECK (NULL vs vacío, mes <1/>12, dup, >12, backfill NULL). [escrito]
- [x] TPS.6 — test DB de las RPC (alta default/explícito/inválido; edición owner/idempotente/IDOR/NULL/inexistente). [escrito]
- [x] TPS.7 — `0104_compute_category_drop_service.sql`: diff quirúrgico de `0062` (saca `v_has_service`). [escrito]
- [x] TPS.8 — test DB compute_category post-cambio (solo service→NO vaquillona; destete/edad/tacto+/parto/aborto/castración; recompute con service histórico). [escrito]
- [x] TPS.9 — test DB de la IA (ternera + IA → sigue ternera; aparece en serviced_females rama ai). [escrito]
- [x] TPS.10 — test DB red de seguridad de edad (`refresh_age_categories` ternera@365→vaquillona). [escrito]
- [x] TPS.11 — `0105`: `rodeo_service_campaign` (ventana + is_configured + n_months + cota p_year). [escrito]
- [x] TPS.12 — `0105`: `rodeo_serviced_females` (unión distinct natural∪IA + fix del veto). [escrito]
- [x] TPS.13 — `0105`: `rodeo_repro_denominator` (serviced/retired/entoradas). [escrito]
- [x] TPS.14 — `0105`: grants/revokes + smoke-check fail-closed de las 3. [escrito]
- [x] TPS.15 — test DB del denominador (siembra completa + IDOR + read-only). [escrito]
- [x] TPS.16 — test DB heifer_fitness (3 valores + rechazo 4º + no categoriza + diferida no descarta). [escrito]
- [x] TPS.17 — enganchar la suite en `run-tests.mjs` (COMENTADA + nota DESCOMENTAR post-apply; roja-hasta-apply documentada).
- [x] TPS.18 — Gate 1 (ya PASS, `security_spec_02-puesta-en-servicio.md`). N/A re-correr (lo hizo el leader pre-Puerta 2).
- [x] TPS.19 — autorrevisión + reconciliación + check verde (typecheck/anti-hardcode/parseo libpg_query) + nota de cierre.

## Archivos creados / tocados
- **CREADOS** (migraciones, NO aplicadas):
  - `supabase/migrations/0102_rodeo_service_months.sql` — columna `service_months smallint[]` + CHECK + comment.
  - `supabase/migrations/0103_create_rodeo_service_months.sql` — helper `assert_service_months_valid` + `create_rodeo` DROP+CREATE (+`p_service_months`) + `set_rodeo_service_months` + grants/revokes + smoke-check.
  - `supabase/migrations/0104_compute_category_drop_service.sql` — `compute_category` reescrita (diff quirúrgico vs `0062`: saca `v_has_service`).
  - `supabase/migrations/0105_repro_denominator.sql` — `rodeo_service_campaign` / `rodeo_serviced_females` / `rodeo_repro_denominator` + grants/revokes + smoke-check.
  - `supabase/tests/puesta-en-servicio/run.cjs` — suite no-bypass (cobertura RPS.1-RPS.6).
- **TOCADOS**:
  - `scripts/run-tests.mjs` — hook de la suite nueva **COMENTADO** (DESCOMENTAR post-apply). Inserción quirúrgica.
  - `specs/active/02-modelo-animal/{tasks,design}-puesta-en-servicio.md` — checkboxes TPS.x + §8.1 reconciliación as-built.

## Mapa R<n> → archivo:test (trazabilidad)
Todos los tests viven en `supabase/tests/puesta-en-servicio/run.cjs` (subtests del `test('puesta-en-servicio suite — spec 02 Stream A')`).
- **RPS.1.1/.1.2** (NULL vs vacío distinguibles) → `TPS.2 CHECK service_months` (asserts `{}` ≠ NULL, ambos persisten distinto).
- **RPS.1.3** (rango 1-12) → `TPS.2` ({0}/{13} rechazados; {1}/{12} bordes OK).
- **RPS.1.4** (sin duplicados) → `TPS.2` ({10,10} rechazado).
- **RPS.1.5** (≤12 elementos) → `TPS.2` (13 elems rechazado; 12 sin dup OK).
- **RPS.1.6** (default primavera en alta) → `TPS.6 create_rodeo` (sin param → {10,11,12}).
- **RPS.1.7** (editable) → `TPS.6 set_rodeo_service_months` (owner edita {11}; re-aplica; NULL).
- **RPS.1.8** (ortogonal a categoría) → cubierto indirecto: `compute_category` (0104) no lee `service_months`; sin trigger que la toque (revisado en design §0).
- **RPS.2.1** (backfill NULL) → `TPS.2` (rodeo por camino viejo → service_months NULL).
- **RPS.2.2** (rodeo NULL no aporta natural) → `TPS.15` (bloque "rodeo NULL → rama natural vacía pero IA cuenta").
- **RPS.2.3** (is_configured consultable) → `TPS.15` (`rodeo_service_campaign.is_configured=false` para NULL).
- **RPS.3.1** (param en create_rodeo) → `TPS.6 create_rodeo` ({6,7}/{} explícito).
- **RPS.3.2/.3.6** (edición offline idempotente) → `TPS.6 set_rodeo_service_months` (re-aplicar {11} = no-op).
- **RPS.3.3** (owner-only) → `TPS.6` (field_operator → 42501, no toca nada).
- **RPS.3.4** (anti-IDOR por derivación) → `TPS.6` (owner A con rodeo de B → 42501; rodeo B intacto).
- **RPS.3.5** (re-validación en RPC) → `TPS.6` (create {13} → 23514; set {0} → 23514).
- **RPS.4.1** (quita backstop service→vaquillona) → `TPS.8 (a)` (hembra <365 con solo service → SIGUE ternera).
- **RPS.4.2** (destete → vaquillona) → `TPS.8 (b)`.
- **RPS.4.3** (transiciones intactas) → `TPS.8 (d)` (tacto+/aborto-revierte/1parto/2partos/castración).
- **RPS.4.4** (corte de edad + cron) → `TPS.8 (c)` (≥1año → vaquillona) + `TPS.10` (refresh_age_categories ternera@365→vaquillona, history auto_transition).
- **RPS.4.5** (recompute con service histórico = sin él) → `TPS.8 (e)` (DISCRIMINANTE: <365 con service+destete→vaquillona; borrar destete → TERNERA, no vaquillona).
- **RPS.4.6** (props de seguridad de compute_category) → diff quirúrgico verificado (SECURITY DEFINER STABLE + search_path + grant idénticos a 0062; ver §reconciliación) + behavior de TPS.8.
- **RPS.4.7** (consistencia incremental↔recompute) → por construcción (0063 sin tocar; ambos delegan en compute_category) + TPS.8 (e) (recompute on soft-delete).
- **RPS.4.8** (IA: ternera+IA sigue ternera, pero cuenta como servida) → `TPS.9`.
- **RPS.5.1** (servidas = natural ∪ IA) → `TPS.15` (vaca/vqApta/fallback + IA-en-campaña en el set; IA fuera NO).
- **RPS.5.2** (probadamente servidas SIN gate; FIX VETO vaquillona_prenada cuenta) → `TPS.15` (multipara + **vaquillona_prenada CUENTA**).
- **RPS.5.3** (aptitud: APTA cuenta / NO_APTA-DIFERIDA no) → `TPS.15`.
- **RPS.5.4** (fallback por edad) → `TPS.15` (vaquillona sin veredicto + ≥365 cuenta).
- **RPS.5.5** (entoradas = servidas − retiradas) → `TPS.15` (invariante + baja).
- **RPS.5.6** (tenant-scoped sin IDOR) → `TPS.15` (owner B → 42501 en las 3; field_operator de A SÍ lee).
- **RPS.5.7** (unión distinct) → `TPS.15` (hembra en ambas ramas cuenta 1, gana 'natural').
- **RPS.5.8** (campaña de service_months + año) → `TPS.15` (campaign + IA por mes/año) + `TPS.9`.
- **RPS.5.9** (read-only) → `TPS.15` (conteo de perfiles invariante tras llamar las 3).
- **RPS.5.10** (cota p_year en SQL de las 3) → `TPS.15` (p_year futuro/1800 → 22023 en las 3).
- **RPS.6.1/.6.4** (enum 3 + rechazo 4º) → `TPS.16`.
- **RPS.6.2** (DIFERIDA no descarta) → `TPS.16` (is_cut=false, status=active) + `TPS.15` (DIFERIDA no entra al denominador).
- **RPS.6.3** (heifer_fitness no categoriza) → `TPS.16` (categoría no cambia con ningún veredicto).
- **RPS.7.1** (multi-tenant transversal) → suma de RPS.3.3/.3.4/.5.6 (asserts 42501/IDOR).
- **RPS.7.2** (numeración ≥0102, no aplicar) → 0102-0105 escritas, suite roja-hasta-apply (hook comentado).
- **RPS.7.3** (design reconciliado) → §8.1 del design.
- **RPS.7.4** (espejo client-side) → DEPENDENCIA anotada (frontend, Stream B / slice C6 — NO este chunk).
- **RPS.7.5** (Gate 1 findings reflejados) → ya hecho por el leader (Gate 1 PASS, RPS.5.10 foldeado).

## Decisiones de criterio propio
1. **CHECK con `cardinality()`** (0102) en vez de `array_length()` del design → el array vacío `'{}'` se evalúa por lógica booleana definida (cardinality('{}')=0), no por la semántica "NULL pasa el CHECK". Mismo contrato; sin ambigüedad. (Reconciliado en design §8.1.)
2. **Rama IA de `rodeo_serviced_females` filtra `a.sex='female'`** (0105) → la función es serviced_FEMALES y RPS.5.1 dice "hembras"; defensa contra un service+ai sobre un macho. Sin cambio para datos válidos. (Reconciliado en design §8.1.)
3. **`set_rodeo_service_months` valida incondicional** (el helper short-circuitea NULL) → equivalente y más simple que el `if not null` del design.
4. **`create_rodeo` DROP+CREATE** (firma vieja `(uuid,uuid,text,uuid,uuid,jsonb)`) → default de diseño DD-PS-2 (cliente único caller, se actualiza en el mismo deploy; sin overloads ambiguos). Re-grant explícito sobre la firma de 7 args + smoke-check.
5. **0063 NO se toca** → recomendación firme DD-PS-4 (dejar `'service'` en el guard; recompute idempotente). El delta toca solo `compute_category`.
6. **Suite enganchada COMENTADA** en run-tests.mjs (no roja en check) → patrón M5/M6-BACKEND at-write-time; el leader descomenta al aplicar. Evita romper el check verde de terminales paralelas (memoria `feedback_parallel_terminals`).
7. **Test RPS.4.5 rediseñado a discriminante** (<365d) → distingue "service ignorado" (→ternera) de "service contado" (→vaquillona); un test ≥365 no lo probaría (sería vaquillona por edad igual). (Autorrevisión.)

## Autorrevisión adversarial (qué busqué / qué encontré / cómo lo cerré)
- **Diff de `0104` vs `0062`**: lo verifiqué con `diff` ignorando comentarios/blancos → ÚNICAS diferencias ejecutables = remoción de `v_has_service` (decl + SELECT EXISTS + término de rama). Precedencia LOAD-BEARING, rama macho, tacto+, conteo de partos, SECURITY DEFINER STABLE, search_path, grant: idénticos. ✓ (RPS.4.6/4.3 sin riesgo de reordenamiento).
- **Empty array en el CHECK/helper**: detecté que `array_length('{}',1)=NULL` hacía depender la validez del vacío de la semántica NULL-pasa-CHECK → lo cerré usando `cardinality()` en CHECK (0102) y helper (0103). Probé mentalmente los 3 casos (NULL/{}/{n}) → todos correctos. ✓
- **IDOR en la derivación**: las 3 funciones derivan `v_est` del rodeo + `has_role_in(v_est)` ANTES de leer + `p.establishment_id=v_est`/`p.rodeo_id=p_rodeo_id` en los CTEs. Un caller de otro tenant → 42501 sin lectura. Test explícito (owner B → 42501 en las 3). ✓
- **IA sobre macho infla denominador**: lo encontré (la rama AI no filtraba sexo) → agregué `a.sex='female'`. ✓
- **Idempotencia de replay de `create_rodeo` clobbereando service_months tras una edición**: lo analicé → `ON CONFLICT (id) DO NOTHING` protege `service_months` igual que protege los toggles (el replay no re-escribe la fila existente). No es bug. ✓
- **Tests que pasan por la razón equivocada**: (a) corregí el id del destete vía SELECT separado (no RETURNING, que da null bajo RLS-on-RETURNING) + assert duro `w.id` (antes un `if (w&&w.id)` saltaba el assert en silencio); (b) rediseñé RPS.4.5 a <365d para que sea discriminante. ✓
- **`tacto_vaquillona` no dispara recompute**: confirmé en `0063` que NO está en la lista del trigger incremental → RPS.6.3 es cierto por construcción; TPS.16 lo prueba igual (before==after). ✓
- **smoke-checks fail-closed**: 0103 verifica helper internal-only + RPC sin anon/public; 0105 verifica las 3 sin anon/public. Patrón 0066/0055/0097. ✓
- **search_path=public + SECURITY DEFINER STABLE en las 3 funciones de derivación**: presentes en cada `create function`. ✓
- **Parse**: las 4 migraciones parsean vía libpg_query (`pgsql-parser`); `$$`/begin-commit balanceados; `node --check` OK en la suite cjs y run-tests.mjs. ✓

## Reconciliación de specs
- `tasks-puesta-en-servicio.md`: TPS.0-TPS.19 marcadas `[x]` (TPS.18 = Gate 1 ya PASS por el leader).
- `design-puesta-en-servicio.md` §8.1 (NUEVO): numeración final 0102-0105 + 3 desviaciones as-built (cardinality, sex en AI, validación incondicional) + confirmación 0063-no-tocado / heifer_fitness-sin-migración / suite-comentada.
- `requirements-puesta-en-servicio.md`: NO requirió nota de reconciliación bajo ningún RPS — el *qué* (comportamiento/contrato) quedó EXACTAMENTE como los EARS; las 3 desviaciones son de *cómo* (implementación), foldeadas en design §8.1. (Las desviaciones no cambian ningún RPS: el CHECK sigue rechazando rango/dup/>12 y aceptando NULL/{}; serviced_females sigue siendo "hembras"; la validación sigue rechazando inválidos.)

## Estado de la suite + qué necesita el leader para el apply (post-Gate-2)
- **Suite roja-hasta-apply** (ESPERADO): `supabase/tests/puesta-en-servicio/run.cjs` corre contra el remoto y las migraciones NO están aplicadas → falla hasta el apply. Por eso su hook en `scripts/run-tests.mjs` está **COMENTADO**. `node scripts/check.mjs` queda **VERDE** (la suite no corre).
- **Para el apply (leader, post reviewer + Gate 2 + Puerta 2 + OK de Raf)**:
  1. Aplicar en orden por Management API: `0102` → `0103` → `0104` → `0105` (0102 antes de 0103/0105; 0104 independiente). Cada una corre su smoke-check fail-closed inline (si falla un grant → la migración aborta).
  2. **Regresión de datos de `0104`** (RPS.4.5, ver header de 0104): ANTES de aplicar 0104, consultar el remoto si existe alguna **hembra <365d con evento service/IA, sin destete, sin tacto+** (probablemente conjunto VACÍO). Si existen → decidir recompute targeted one-time vs lazy (próximo evento/cron). Documentar en el deploy.
  3. **DESCOMENTAR** el hook `Puesta-en-servicio suite (spec 02 Stream A)` en `scripts/run-tests.mjs` → correr `node scripts/check.mjs` → la suite debe quedar **VERDE** (confirma no-bypass / authz / fix del veto).
  4. **Encadenar el slice frontend del espejo** (RPS.7.4): quitar `hasService` de `app/src/utils/animal-category.ts` (C6) para no dejar drift transitorio del badge client-side. NO es de este chunk backend (lo ejecuta Stream B / slice C6).
  5. **PowerSync** (dependencia anotada en design §2): verificar que el schema de PowerSync (`AppSchema`) incluya `service_months` como columna TEXT del rodeo cuando se construya el selector de Stream B (no rompe nada ahora; el cliente aún no lee la columna).
- **Gate 1**: ya PASS (`progress/security_spec_02-puesta-en-servicio.md`, 0 HIGH, RPS.5.10 foldeado). Falta **reviewer + Gate 2 (modo code)** sobre este as-built + **Puerta 2** humana.

---

## FIX-LOOP (implementer Opus, 2026-06-23) — reconciliar la suite animal (spec 02 base) al modelo de Stream A YA aplicado (0102-0105 live)

**Contexto.** Stream A eliminó el backstop `service→vaquillona` de `compute_category` (RPS.4.1, `0104` aplicada). La suite animal vieja (`supabase/tests/animal/run.cjs`) seguía verde mientras las migraciones NO estaban aplicadas; ahora que están live, asertaba el comportamiento VIEJO. Verifiqué en aislamiento: **exactamente 2 leaf failures** (T2.23 línea 1500, T2.29 línea 1689; el "fail 3" del runner = el wrapper del suite padre, no un 3er leaf). Ambas deterministas (no flake de rate-limit: 0 "Request rate limit", 0 cascada de undefined; reproducidas idénticas en 2 corridas).

**Tests tocados (qué asertan AHORA):**
- **T2.23** (renombrado `servicio NO transiciona ternera (RT2.5.x SUPERSEDED por RPS.4.1)`): el 1er bloque ahora aserta **ternera + service → SIGUE ternera** (`profileCode==='ternera'`) + override sin tocar + **recompute coincide** (`computeCode==='ternera'`, RPS.4.5). Los otros 3 bloques (service sobre vaquillona → sin cambio; service sobre preñada → `vaquillona_prenada` por tacto+; service + override → sin cambio) NO se tocaron — siguen correctos bajo el modelo nuevo (RT2.5.2/RT2.5.3 vigentes).
- **T2.29** (consistencia trigger↔recompute): el 1er bloque `CN1` ahora usa **destete** (hembra ternera + `weaning` → vaquillona; soft_delete del weaning → ternera) en vez del `service` viejo — ejercita el MISMO invariante (un disparador VIVO que promueve + su soft-delete revierte) sobre una transición que sigue existiendo. Agregué `CN1b`: **service NO transiciona** ni incremental ni recompute (`trigger==recompute`, la alternativa explícita que pedía la tarea). `CN5` (service+tacto+birth → `vaca_segundo_servicio`) NO cambió de aserción — el `vaca` es por el **birth** (1 parto), el service es inerte; solo aclaré el comentario.

**Cobertura ternera→vaquillona por destete/edad NO se perdió:** sigue en **T2.24** (ternera + weaning → vaquillona, línea ~1537-1538) + **T2.22** (hembra ≥365d sin eventos → vaquillona) + el nuevo `CN1` por destete. El service dejó de cubrirla (correcto, RPS.4.1).

**Otros `event_type:'service'` auditados (sin cambio, NO dependían de la promoción):** T2.30 `OV_SV` (override, base vaquillona → sin cambio); T2.11 (transfer, `bull_id` re-pointing, categoría irrelevante); `seedAnimalWithHistory` (no inserta service). Grep exhaustivo `'service'` en toda la suite → 7 sitios, todos revisados.

**Reconciliación de specs (correcciones→specs):**
- `requirements-tier2-categorias.md`: nota **SUPERSEDED por RPS.4.1** sobre la sección RT2.5 (histórico preservado, EARS de RT2.5.1 tachado con la aclaración del as-built; RT2.5.2/RT2.5.3 marcados vigentes). + marcador inline en **RT2.4.4** (service tachado como disparador). Patrón idéntico al SUPERSEDED de RT2.2.6 ya en el archivo.
- `design-tier2-categorias.md`: nota SUPERSEDED arriba del SQL histórico de `0062` (apunta a `0104` + el espejo client-side `hasService` = drift esperado de Stream B/RPS.7.4) + marcador inline en la rama `or v_has_service`.
- **NO toqué** `app/src/utils/animal-category.ts` ni `animal-category.test.ts` (mirror con `hasService` a propósito — RPS.7.4 = slice frontend de Stream B; drift transitorio display-only documentado y esperado). NO toqué migraciones, ni `feature_list.json`, ni otros `progress/`.

**Estado de `node scripts/check.mjs`:**
- **Animal suite (spec 02): VERDE** — 109 pass / 0 fail (confirmado aislada Y dentro de `check.mjs`: `<<< Animal suite (spec 02) OK`).
- **Maneuvers suite (spec 03): VERDE** (`<<< Maneuvers suite (spec 03) OK`).
- client unit 1601/0, RLS 22/0, Edge 42/0, typecheck + anti-hardcode 0 — todos VERDES.
- **Puesta-en-servicio suite (spec 02 Stream A): VERDE** tras el fix de abajo (era 1 leaf determinista por un bug DEL TEST, no del deployado).

### ✅ CORRECCIÓN del diagnóstico previo de TPS.15 — NO había mismatch, NO hace falta `0106` (bug del test, ya arreglado)

> ⚠️ **El bloque que decía "🔴 MISMATCH REAL deployado↔on-disk en `0105` — requiere `0106`" era un diagnóstico ERRÓNEO.** Lo conservo reescrito acá para que el leader/futuro no lo persiga. La función deployada está bien; el `0106` NO existe ni hace falta.

**Test que fallaba:** `TPS.15` (línea **641**), aserción `una baja de rama natural sale del set serviced (membresía active)`: `after.serviced === before.serviced - 1`. Determinista (no flake).

**Causa raíz REAL (confirmada por el leader contra la DB):** el `admin.update` de la línea 637 usaba `exit_reason: 'venta'`, y **`'venta'` NO existe en el enum `exit_reason_enum`** (el remoto lo tiene en INGLÉS: `{sale,death,transfer,culling,theft,other}`). El update de `service_role` **tiraba error** (que el test NO chequeaba) → el `status='sold'` se revertía con el statement fallido → la `vacaBaja` quedaba `status='active'` → seguía contando en `rodeo_serviced_females` (rama natural) → `after.serviced` NO bajaba → fallaba el assert de la línea 641. El bug estaba **100% en el test** (literal de enum en español), no en la función.

**Por qué mi diagnóstico anterior estaba MAL:** concluí "el `rodeo_serviced_females` deployado NO filtra `status='active'`" SIN consultar la DB (estaba bloqueado por el clasificador y la tarea pedía parar+reportar). El leader LEYÓ la definición **deployada** con `pg_get_functiondef`: la rama `eligible_natural` SÍ tiene `and p.status = 'active'` — coincide exacto con el on-disk `0105` + design + Gate 2. **No hay drift deployado↔on-disk.** Mi inferencia "como no baja, el deployado no filtra" era falsa: la verdadera razón de que no bajara era que el `status` nunca llegaba a `'sold'` (update fallido por el enum inválido).

**Fix aplicado (lo único tocado en código):** `supabase/tests/puesta-en-servicio/run.cjs` línea 637 — `exit_reason: 'venta'` → `exit_reason: 'sale'` (valor válido, semánticamente = venta). `status='sold'` y `exit_date` quedan como estaban (válidos). Además robustecí el test con `assert.ifError(bajaErr)` sobre la respuesta del update, para que un enum inválido futuro falle ruidoso en vez de revertir silencioso. **NO se tocaron migraciones (0102-0105 quedan como están, correctas), ni `rodeo_serviced_females`, ni ninguna función. NO hay `0106`.**
