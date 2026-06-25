# Gate 1 — Security (modo spec) — Delta `tg_derive_breed_id_from_breed` (spec 08)

**Agente**: security_analyzer
**Modo**: `spec`
**Fecha**: 2026-06-25
**Input**: `specs/active/08-export-sigsa/design.md` → changelog entry **"2026-06-25 — GAP de breed_id (T18 parcial) → plan Run 3"** (último entry del changelog, líneas ~644).
**Skill usada**: `sentry-skills:security-review` (metodología trace-data-flow + verify-exploitability; refs `injection.md`, `business-logic.md`, `authorization.md`).

---

## Veredicto: **PASS** (con 1 finding MEDIUM no bloqueante — recomendación de robustez para la migración Run 3)

El trigger es **seguro** en los 5 ejes de seguridad pedidos (privilegio/escalación, cross-tenant, inyección, recursión, integridad del export). No introduce privilegio nuevo, no cruza tenants, no tiene SQL dinámico, no recursiona, y su guard de herencia del ternero es **correcto y suficiente** (verificado contra el schema real de los dos caminos de creación del ternero al pie).

El único finding es **MEDIUM**: el trigger, ante un `breed` texto-libre que NO matchea el catálogo, setea `breed_id := NULL` **silenciosamente**, lo que en un UPDATE puede **borrar un `breed_id` previamente correcto**. La dirección de falla es *fail-safe* para el export regulado (NULL → "a completar" → el animal queda EXCLUIDO del TXT, no entra con un código equivocado), por eso no es HIGH ni bloquea el gate. Es una recomendación de endurecimiento + un test a declarar en `tasks.md` de Run 3.

---

## Qué se verificó contra el repo (data flow)

| Hecho del schema | Verificado en | Resultado |
|---|---|---|
| `breed_catalog` global, sin `establishment_id`, SELECT abierto a `authenticated` `USING(true)`, read-only | `0107_breed_catalog.sql:19-44` | ✅ confirmado |
| `animal_profiles.breed` (texto libre) coexiste con `breed_id` FK | `0020_animal_profiles.sql:22` + `0108_animal_profiles_breed_id.sql:17-18` | ✅ confirmado |
| Ternero MONO entra con `breed_id = madre`, **sin** setear `breed` (→ `breed = NULL`) | `0108_animal_profiles_breed_id.sql:93-110` (INSERT del ternero: setea `breed_id`, NO `breed`) | ✅ confirmado — el guard lo protege |
| Ternero MELLIZOS entra con `breed_id = madre`, **sin** setear `breed` | `0109_reproductive_events_breed_id.sql:154-171` (idem) | ✅ confirmado — el guard lo protege |
| Alta normal setea `breed = nullif(trim(p_breed),'')` (non-NULL si el usuario eligió raza) | `0083_create_animal_rpc.sql:138-154` | ✅ confirmado — el trigger deriva el id |
| El BreedPicker es **lista cerrada** (no hay free-text de raza en la UI); `onSelect` devuelve el `name`/`senasa_code` EXACTOS del catálogo | `app/src/components/sigsa/BreedPickerSheet.tsx:53,211-218` | ✅ en el camino feliz, `lower(trim(name))=lower(trim(NEW.breed))` SIEMPRE matchea |
| `breed` es columna `text` con `GRANT INSERT,UPDATE TO authenticated` + RLS UPDATE `has_role_in(establishment_id)` | `0020:77`, `0022_rls_animals_and_profiles.sql:13-15` | ✅ `breed` es escribible con texto ARBITRARIO vía PostgREST directo (origen del finding MEDIUM) |
| Stack de triggers BEFORE INSERT/UPDATE ya existente en `animal_profiles` | grep migraciones (0021, 0030, 0036, 0037, 0043, 0047, 0054, 0079, 0084, 0085, 0108) | ✅ revisado para ordering — sin dependencia de orden (ver §Recursión/ordering) |

---

## Análisis por eje de seguridad

### 1. Privilegio / escalación — OK (sin hallazgo)

El trigger **NO debe ser** `SECURITY DEFINER`, y el diseño correctamente lo deja como `SECURITY INVOKER` (default). Razonamiento:

- Lo único que la función lee es `SELECT id FROM breed_catalog WHERE ...`. `breed_catalog` ya tiene `GRANT SELECT TO authenticated` + policy `USING(true)` (`0107:35-42`). Cualquier writer autenticado de `animal_profiles` (rol `has_role_in`) **ya puede** leer ese catálogo por su cuenta. → el trigger NO necesita ningún privilegio que el writer no tenga. Correr como INVOKER es suficiente y es lo correcto (mínimo privilegio).
- **Riesgo SI fuera `SECURITY DEFINER`** (no debe serlo): sería privilegio innecesario y, peor, una función SECURITY DEFINER sin `SET search_path` fijo es el patrón de search-path hijacking. El resto del repo que SÍ es DEFINER (0043, 0083, 0108, 0109) siempre fija `SET search_path = public`. **Recomendación dura para la migración Run 3**: el trigger debe ser INVOKER explícitamente (o sea, NO escribir `SECURITY DEFINER`). Si por algún motivo se lo hiciera DEFINER, DEBE llevar `SET search_path = public` (refs cualifican `breed_catalog`/`public.breed_catalog` de todas formas). Para la derivación local, INVOKER es la decisión correcta — anotado para que el implementer no lo "promueva" a DEFINER por costumbre.
- El catálogo es read-only para el cliente (sin policies INSERT/UPDATE/DELETE), así que no hay forma de que un atacante envenene `breed_catalog` para que el trigger derive un id manipulado. La única escritura es vía migración (service_role).

### 2. Interacción con la herencia del ternero (0108/0109) — OK, guard correcto y suficiente

Esta era la preocupación central. **El guard `NEW.breed IS NOT NULL` es correcto y suficiente.** Trace:

- Ambos caminos de creación del ternero al pie (MONO trigger `0108:93-110`, MELLIZOS RPC `0109:154-171`) insertan el `animal_profiles` del ternero con `breed_id := v_mother_breed_id` y **nunca tocan la columna `breed`** → el ternero nace con `breed = NULL`.
- El trigger se dispara en ese INSERT (es `BEFORE INSERT OR UPDATE OF breed`; un INSERT siempre evalúa todas las columnas), pero el guard `IF NEW.breed IS NOT NULL` es **falso** (`breed` es NULL) → el cuerpo NO ejecuta → `NEW.breed_id` (= el heredado de la madre) **se preserva intacto**. ✅ No lo pisa.
- **Ordering de triggers (BEFORE) — sin riesgo de rotura.** Postgres ejecuta los `FOR EACH ROW BEFORE` triggers en **orden alfabético por nombre de trigger** dentro del mismo evento. El stack actual en `animal_profiles` incluye `animal_profiles_set_created_by` (0043), `_identity_check`/`_rodeo_check`/`_category_check` (0021), `animal_profiles_force_animal_identity` (0079), etc. El nuevo trigger derivador puede correr en cualquier posición relativa a esos **sin consecuencia**, porque:
  - Ninguno de los triggers existentes lee ni escribe `breed` ni `breed_id` (son sobre identidad, rodeo, categoría, created_by, denormalización de tag/sex/birth). → no hay dependencia de lectura intermedia.
  - El derivador solo depende de `NEW.breed`, que lo fija el INSERT/UPDATE del caller, **no** otro trigger. Como `breed` no es producido por ningún otro trigger del stack, el valor que ve el derivador es estable sea cual sea el orden.
  - **Recomendación menor de naming**: nombrar el trigger de modo que su orden alfabético sea predecible (p. ej. `animal_profiles_derive_breed_id`); aunque hoy no hay dependencia, deja el comportamiento determinista si a futuro algún trigger empieza a leer `breed_id`. No bloqueante.

### 3. Cross-tenant / integridad de datos — OK en cross-tenant; 1 finding MEDIUM en integridad

- **Cross-tenant: sin hallazgo.** `breed_catalog` es **global, sin `establishment_id`** — es información pública del manual SIGSA (32 filas). Derivar `breed_id` de él **no puede cruzar tenants**: no hay scoping de tenant que romper, y el id resultante es un puntero a una fila global compartida por diseño. No existe forma de que el trigger asigne un `breed_id` "ajeno": el universo de `breed_id` es común a todos los campos. ✅
- **El trigger NO toca el scoping de `animal_profiles`.** Solo escribe `NEW.breed_id` en la MISMA fila que ya está siendo insertada/actualizada por un caller que pasó la RLS de `animal_profiles` (`has_role_in(establishment_id)`). No hace ningún cross-write a otras filas/tablas.
- **Finding de integridad (MEDIUM) → ver §Findings.** El único punto donde un `breed_id` puede quedar "incorrecto" es el caso `breed` no-NULL **sin match en el catálogo**: el escalar `(SELECT id ... LIMIT 1)` devuelve NULL → `NEW.breed_id := NULL`. En un UPDATE de `breed`, esto **borra silenciosamente** un `breed_id` que antes era correcto. Para el export SENASA, esto es *fail-safe* (el animal cae a "a completar" y queda EXCLUIDO del TXT — `sigsa-validator` lo marca incompleto, no lo exporta con código equivocado), pero merece endurecimiento porque (a) puede degradar UX/analytics silenciosamente y (b) `breed` es escribible con texto arbitrario fuera del picker.

### 4. Inyección / SQL dinámico — OK (sin hallazgo)

Sin SQL dinámico. El match es una comparación **estática** `lower(trim(name)) = lower(trim(NEW.breed))` dentro de un `SELECT` plpgsql normal: `NEW.breed` es un **valor bindeado** (variable de la fila), no concatenación de string. No hay `EXECUTE`, no hay `format()`, no hay `quote_*`. No es inyectable aunque `NEW.breed` sea atacante-controlado (lo es — texto libre): el peor caso de un `breed` malicioso es simplemente "no matchea ninguna fila" → `breed_id := NULL`. ✅ Confirmado contra `injection.md` (patrón SAFE: comparación parametrizada, no string-building).

### 5. Recursión / loop — OK (sin hallazgo)

El trigger es `BEFORE INSERT OR UPDATE **OF breed**` y solo modifica `NEW.breed_id` (columna distinta). En un trigger **BEFORE**, modificar `NEW.*` es una mutación in-memory de la fila ANTES de escribirla — **no** emite un nuevo UPDATE, así que no re-dispara nada. Aun si fuera AFTER (no lo es), el evento está acotado a `OF breed`: escribir `breed_id` no calza ese filtro. → **sin recursión**. ✅

### 6. DoS / performance (anotado, NO es seguridad)

- Un `SELECT ... LIMIT 1` sobre `breed_catalog` (32 filas) por cada INSERT/UPDATE-of-breed de `animal_profiles`. Costo trivial a esta escala. Un import masivo (spec 12) que inserta N animales hace N lookups de 32 filas — sigue siendo despreciable (seq scan de 32 filas).
- **Nota de perf (no de seguridad, no bloqueante)**: el match es sobre `lower(trim(name))`, expresión que NO usa el índice por defecto. A 32 filas da igual (seq scan es óptimo). Si a futuro el catálogo creciera mucho, un índice de expresión `CREATE INDEX ON breed_catalog (lower(trim(name)))` lo cubriría — innecesario hoy. Anotado para el design, no para el gate.

---

## Findings

### [MEDIUM-1] Derivación silenciosa a `breed_id := NULL` ante `breed` no-NULL sin match (puede BORRAR un `breed_id` previamente correcto)

- **Tipo**: Business-logic / integridad de dato regulado (CWE-840). **NO** es escalación ni cross-tenant.
- **Confianza**: Alta (el comportamiento es determinista por la semántica del escalar `(SELECT ... LIMIT 1)` → NULL sin match, asignado incondicionalmente dentro del guard).
- **Ubicación**: diseño del cuerpo del trigger, changelog `design.md` entry "2026-06-25 — GAP de breed_id".
- **Cita del diseño**:
  > "un **trigger** `BEFORE INSERT OR UPDATE OF breed ON animal_profiles` que DERIVA `breed_id` desde `breed` por match de nombre exacto al catálogo (`lower(trim(name)) = lower(trim(NEW.breed))`), con **guard `NEW.breed IS NOT NULL`** para NO pisar el `breed_id` heredado de la madre"
- **El gap**: el guard `NEW.breed IS NOT NULL` cubre el caso ternero (`breed = NULL` → no pisa). Pero NO cubre el caso `breed` no-NULL **sin match**. Como `breed_id` se asigna con el resultado del SELECT escalar **sin condicionar a que haya match**, un `breed` que no calza ninguna grafía del catálogo produce `NEW.breed_id := NULL`. En un **UPDATE de `breed`** (la afordancia de "editar raza" que Run 3 agrega en `[id].tsx`, y cualquier `PATCH /animal_profiles` directo a PostgREST), esto **sobreescribe a NULL un `breed_id` que antes era válido**.
- **Por qué es atacante-/usuario-alcanzable** (no solo teórico): `breed` es columna `text` con `GRANT UPDATE TO authenticated` y RLS UPDATE `has_role_in(establishment_id)` (`0022:13-15`). El BreedPicker es lista cerrada, pero `breed` **se puede escribir con texto arbitrario salteando la UI** (PATCH directo a PostgREST, import CSV vía `p_breed`, o datos legacy pre-0107). Ese texto arbitrario llega al trigger como `NEW.breed`. No es un exploit de robo de datos — es un sumidero silencioso de integridad.
- **Impacto**: dirección **fail-safe** para el TXT SENASA (NULL → `sigsa-validator` marca "falta la raza" → EXCLUIDO del export; nunca entra al TXT con un código equivocado). El daño real es: (a) un animal que estaba listo para exportar puede volverse "a completar" sin aviso tras un edit de `breed` con un typo; (b) degradación silenciosa de analytics/benchmarking (uno de los 3 pilares del producto). Por ser fail-safe regulatoriamente, es MEDIUM, no HIGH.
- **Fix recomendado** (para la migración Run 3 — elegir UNA; el implementer/leader decide):
  1. **Solo derivar cuando hay match (preferida)** — no pisar `breed_id` si el texto no calza:
     ```sql
     IF NEW.breed IS NOT NULL THEN
       NEW.breed_id := COALESCE(
         (SELECT id FROM public.breed_catalog
          WHERE lower(trim(name)) = lower(trim(NEW.breed)) LIMIT 1),
         NEW.breed_id   -- sin match → conserva el breed_id actual, no lo borra a NULL
       );
     END IF;
     ```
     ⚠ Trade-off: si el usuario *cambia* a una raza distinta no-catalogada, `breed_id` queda apuntando a la raza vieja (stale). Para evitar stale, condicionar a "el texto cambió": derivar solo si `NEW.breed IS DISTINCT FROM OLD.breed` (en UPDATE) y, si no hay match, decidir explícitamente entre conservar o NULL-ear. La decisión de producto (¿typo en edición debe vaciar la raza, o conservar la anterior?) la toma el leader/Facundo — **declararla en el design**, no dejarla implícita.
  2. **Derivar a NULL explícito + documentarlo como comportamiento intencional** — mantener el `:= (SELECT ...)` actual (NULL sin match) PERO dejar constancia en el comentario de la migración de que un `breed` no-catalogado vacía `breed_id` a propósito (alta no-exportable hasta corregir). Aceptable porque es fail-safe; requiere que la UI de edición use SIEMPRE el picker (texto cerrado) para que el camino feliz nunca caiga acá.
- **Test a declarar en `tasks.md` de Run 3** (sin esto el gate de código no podrá verificar el guard):
  1. INSERT de ternero al pie (vía `register_birth` y vía trigger mono) con madre que tiene `breed_id` → el ternero **conserva** el `breed_id` heredado (`breed` NULL, guard lo salta). **[cubre el guard principal — imprescindible]**
  2. INSERT/UPDATE de `breed` = nombre EXACTO del catálogo → `breed_id` deriva al id correcto.
  3. UPDATE de `breed` = texto que NO matchea (typo) → comportamiento **igual al fix elegido** (conserva el `breed_id` previo, o lo NULL-ea — según decisión, pero TESTEADO explícitamente, no accidental).
  4. UPDATE de `breed` con `lower/trim` distinto (mayúsculas, espacios) → matchea (case-insensitive + trim).

---

## Anexo LOW (no bloqueante)

- **[LOW-1] Naming determinista del trigger.** Nombrar el trigger con un prefijo que fije su orden alfabético entre el stack BEFORE de `animal_profiles` (p. ej. `animal_profiles_derive_breed_id`). Hoy no hay dependencia de orden (ningún otro trigger lee `breed_id`), pero deja el comportamiento determinista a futuro.
- **[LOW-2] INVOKER explícito.** No marcar el trigger `SECURITY DEFINER`. Si por costumbre del repo (0043/0083/0108/0109 son DEFINER) alguien lo hiciera, DEBE llevar `SET search_path = public`. Para esta derivación local, INVOKER es lo correcto — el catálogo ya es legible por el writer.
- **[LOW-3] Índice de expresión en `breed_catalog (lower(trim(name)))`** — perf-only, innecesario a 32 filas. Solo si el catálogo crece mucho post-MVP.

---

## Dominios de seguridad revisados (trazabilidad)

| Dominio (catálogo RAFAQ) | Aplica | Resultado |
|---|---|---|
| A1 — service-role bypassa RLS | No | El trigger es INVOKER, no usa `createAdminClient`. `breed_catalog` global sin tenant que scopear. |
| A2 — mass assignment / over-posting | Parcial | `breed_id` lo deriva el server (no lo confía del cliente) — **mejora** la postura: aunque un cliente mande `breed_id` en el payload, el INSERT/UPDATE de `breed` lo re-deriva server-side. (Si solo se hace UPDATE de OTRA columna sin tocar `breed`, el trigger `OF breed` no corre y un `breed_id` del payload pasaría por la RLS normal — pero eso es el estado actual de 0108, no lo empeora este delta.) |
| A3 — IDOR por FK | No | `breed_id` apunta a `breed_catalog` global (no a dato per-tenant) → no hay objeto padre ajeno que referenciar. |
| A4 — function-level authz (BFLA) | No | El trigger no cambia quién puede insertar/actualizar `animal_profiles` (sigue rigiendo la RLS de 0022). |
| Inyección (F1/SQLi) | Sí | OK — comparación estática parametrizada, sin SQL dinámico. |
| Recursión / loop de trigger | Sí | OK — BEFORE + `OF breed`, modifica `breed_id` (otra columna), no re-dispara. |
| Cross-tenant / multi-tenant isolation | Sí | OK — catálogo global sin `establishment_id`; el trigger no cross-escribe. |
| Integridad de dato regulado (SENASA) | Sí | **MEDIUM-1** — derivación silenciosa a NULL; fail-safe pero merece endurecimiento + test. |
| Privilegio / search_path hijack (DEFINER) | Sí | OK — debe ser INVOKER (lo es por diseño); LOW-2 si se promoviera. |
| Performance / DoS | Sí | Trivial (32 filas). LOW-3 índice innecesario hoy. |

## Dominios excluidos (con justificación)

- **B (exposición de datos / info disclosure)**: el trigger no devuelve nada al cliente (es un BEFORE trigger interno); no hay `err.message` ni payload de respuesta. N/A.
- **C (offline/sync/PowerSync)**: el delta es una migración de DB; el sync de `breed_catalog`/`animal_profiles` ya fue revisado en el Gate 1 previo de spec 08 (MEDIUM-2, sync rules JOIN-free). El trigger corre server-side al drenar la outbox (mismo contexto auth.uid del caller bajo las RPC SECURITY DEFINER, patrón validado 0083) — no cambia el scope de sync. N/A para este delta.
- **D (secretos / supply chain)**: el trigger no maneja secretos ni imports. N/A.
- **E (abuso a escala) / rate limiting**: el delta no agrega endpoint ni acción abusable nueva; corre dentro del write-path de `animal_profiles` ya existente (cubierto por los rate limits de Auth + el patrón de outbox). No hay acción nueva que rate-limitear. N/A.
- **G (BLE)**: no toca el trust boundary BLE. N/A.
- **H (auth/sesión) / I (compliance/mobile)**: sin cambios de sesión, retención o hardening mobile en este delta. La auditabilidad SENASA del export la dan los triggers force-auth.uid de 0111/0112 (ya gateados), no este delta. N/A.

---

## Tabla de inputs (campos que el usuario tipea, relevantes a este delta)

| Campo | Límite (largo/charset/formato) | Validación | OK? |
|---|---|---|---|
| `animal_profiles.breed` (texto libre; lo setea el BreedPicker con nombre EXACTO del catálogo, o un PATCH directo/import con texto arbitrario) | `CHECK ≤ 64` (0070, cap de largo server-side); charset libre | **Server**: el cap de largo (0070) + el trigger deriva `breed_id` server-side (no confía el `breed_id` del cliente). El picker (cliente) restringe a lista cerrada = UX, **no** es el control (bypasseable por PATCH directo). | ⚠ Parcial — ver MEDIUM-1: el trigger acepta cualquier texto y deriva NULL sin match (fail-safe, pero puede borrar `breed_id` previo en UPDATE). El cap de largo existe; falta la decisión explícita de qué hacer ante no-match. |

> No hay buscadores ni prompts LLM en este delta. El campo de búsqueda del `BreedPickerSheet` filtra **en memoria** la lista ya sincronizada (no pega a DB con el término) → no hay enumeración ni inyección por ahí.

## Tabla de rate limits (acciones abusables tocadas por este delta)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| (ninguna nueva) | n.a. | n.a. | n.a. | El delta es un trigger DB dentro del write-path de `animal_profiles` ya existente. No agrega Edge Function, endpoint, ni operación bulk nueva. El INSERT/UPDATE de `animal_profiles` ya está cubierto por el rate-limit de Auth + el connector de outbox. |

---

## Resumen para el leader

- **PASS.** El trigger es seguro: INVOKER (no escala privilegio, no debe ser DEFINER), `breed_catalog` global (no cruza tenants), sin SQL dinámico (no inyectable), sin recursión, y el **guard `NEW.breed IS NOT NULL` es correcto y suficiente** para no pisar el `breed_id` heredado del ternero al pie (verificado contra los DOS caminos reales 0108/0109).
- **1 finding MEDIUM (no bloqueante)**: derivación silenciosa a `breed_id := NULL` ante `breed` no-catalogado, que en UPDATE puede borrar un `breed_id` correcto. Es fail-safe para el TXT SENASA (excluye, no exporta mal), por eso no bloquea — pero **la migración Run 3 debería**: (1) elegir explícitamente el comportamiento ante no-match (COALESCE-conservar vs NULL-ear, decisión de producto a documentar en el design), y (2) declarar en `tasks.md` los 4 tests del guard (sobre todo el de herencia del ternero, imprescindible).
- **Sin REQUIERE_DECISION_ARQUITECTONICA**: la única decisión pendiente (qué hacer ante `breed` no-catalogado en edición) es de producto/UX, no arquitectónica — el leader puede resolverla con un default + nota en el design, no necesita ADR.
