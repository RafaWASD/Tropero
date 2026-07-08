# Spec 02 — Delta IDENTIFICADORES UNIFICADOS — Design

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** · **backend (migración + RPC) + PowerSync + frontend** · **Gate 1 APLICA** · **Gate 2.5 APLICA (UI)** · **DEPLOY gateado a Raf**.
**Fuente de verdad**: `context-identificadores-unificados.md`. **Requirements**: `requirements-identificadores-unificados.md` (`IDU.<n>`).

> **Multi-tenancy / dato regulado**: el idv y el apodo son identidad del animal (el idv cae en la superficie SIGSA). La barrera es server-side y NO cambia: la unicidad del idv la garantiza el índice parcial `animal_profiles_idv_unique (establishment_id, idv)`; el apodo vive en `custom_attributes` scopeado por el `establishment_id` del perfil (RLS + stream `est_custom_attributes` per-establishment). Eliminar el trigger de completitud (`animal_profiles_identity_check`) **no** abre un hueco de tenant/authz — era una regla de completitud de dato, no de aislamiento. El drop de la columna + el re-create de RPC va a **Gate 1** antes de la Puerta 1.
> **Offline-first**: la búsqueda, la lista, el hero y el warning-soft del apodo son lecturas LOCALES (SQLite de PowerSync). El alta/parto/edición del apodo escriben por los caminos ya existentes (outbox `custom_attributes` / RPC). Sin red nueva.

---

## 0. Deltas posteriores (para el índice del baseline al cerrar)

Al cerrar la Puerta 2, el leader folda un puntero al `design.md` baseline de spec 02 (bajo R4.2/R4.13 identificadores y el parto) y al `design.md` de spec 09 (bajo R5, búsqueda):
- `identificadores-unificados` — modelo final de 3 identificadores opcionales (electrónica global · idv por campo · apodo por campo con soft-warning). **Elimina `visual_id_alt`** del todo (trigger de identidad `animal_profiles_identity_check`, columna, fallback de `register_birth`, footprint PowerSync/frontend). **Búsqueda unificada** por los 3 en todos los buscadores (menos el "Bastonear" duplicate-check, solo-electrónica). **Nombre como hero**. **SUPERA** `PCV.2.4` (fallback load-bearing), `RCF.1.6` (display de visual_id_alt en ficha), `nombre-apodo D3`. Estado: (lo completa el leader al cerrar).

Bloque **"Deltas posteriores"** a agregar a ambos baselines: `identificadores-unificados` — 1 línea + estado.

---

## 1. Archivos a crear / modificar (footprint as-designed)

### Backend (Gate 1 + DEPLOY gateado a Raf)
- **CREAR** `supabase/migrations/0122_drop_visual_id_alt.sql` (próximo número libre — el último es `0121`). Migración **atómica** (`begin/commit`) que:
  1. Dropea el trigger `animal_profiles_identity_check` + su función `tg_animal_profiles_identity_check` (IDU.2.1).
  2. Re-crea `register_birth`, `create_animal`, `import_rodeo`, `transfer_animal` y las 2 funciones de reportes, sin `visual_id_alt` (IDU.2.2 / IDU.2.5) — **moldeando sobre el cuerpo VIGENTE del remoto** (`reference_function_recreate_base`; el leader se los pasa al implementer).
  3. Renombra el `label` del `field_definition` `apodo` → "Nombre/Apodo" (IDU.7.1).
  4. Dropea físicamente la columna `animal_profiles.visual_id_alt` + sus objetos dependientes (IDU.2.3).
  - **Banner `🔴 NO aplicar desde acá`**: el deploy lo hace el **leader por Supabase MCP** tras Gate 1 PASS + reviewer + Gate 2 + autorización de Raf (memoria `project_supabase_mcp_write`). Hasta el deploy, las suites backend que asumen la columna/RPC nuevos reflejan el comportamiento viejo — esperado (patrón `0119`/`0121`).

### PowerSync (schema coordinado con Raf)
- **MODIFICAR** `app/src/services/powersync/schema.ts` — quitar `visual_id_alt` de las tablas locales `animal_profiles` y `pending_animal_profiles` (IDU.3.1).
- **MODIFICAR** `app/src/services/powersync/local-reads.ts`:
  - Quitar `visual_id_alt` de `LOCAL_LIST_SELECT` / `LOCAL_LIST_SELECT_OVERLAY`, de las ramas de búsqueda (`buildSearchLikeQuery` whitelist), y de la lectura de la madre en el vínculo cría-al-pie (IDU.3.2).
  - **Agregar** el canal de búsqueda por apodo (`buildApodoSearchQuery`, §7) y el enriquecimiento de la lista con `apodo` + `apodo_enabled` por animal (§8) — IDU.4.4 / IDU.6.5.
- **MODIFICAR** `app/src/services/powersync/upload.ts` — el connector deja de mapear `visual_id_alt` (INSERT/PATCH de `animal_profiles`) y `p_visual_id_alt` (replay del RPC `create_animal`) — IDU.3.3.

### Frontend (dominio + UI)
- **MODIFICAR** servicios: `animals.ts` (quitar `visualIdAlt` de `LocalAnimalRow`/`NewAnimalInput`/`createAnimal`/`searchAnimals` + sumar canal apodo), `events.ts` (overlay de cría + label de madre), `bulk-selection-data.ts`, `import-rodeo.ts`, `reports.ts` (IDU.3.4).
- **MODIFICAR** utils: `animal-identifier.ts` (clasificadores, §6), `link-calf-query.ts` (`classifyCalfQuery` alfanum + apodo), `maniobra-identify.ts` (`ManualCandidate` + `candidateMatchesExactly`), `reports-format.ts` (`animalLabel`), `selection-display.ts`, `import/*` (mapeo, IDU.3.7).
- **CREAR** utils PUROS testeables: `animal-input.ts::sanitizeApodoInput` (§5), un helper de warning-soft (§9), `pickHeroIdentifier` (§10) — ubicación en `animal-identifier.ts` o un `hero-identifier.ts` nuevo (decisión del implementer; PURO, sin RN).
- **MODIFICAR** componentes/pantallas: `AnimalRow.tsx` (quitar `visualId`, aplicar `pickHeroIdentifier`), `animal/[id].tsx` (hero + Identificación, quitar fila "Nombre / seña", warning apodo), `crear-animal.tsx` (apodo format + warning), `CustomFieldInput.tsx` (hook del formato/ warning del apodo por `data_key`), `identificar.tsx` + `CandidatePicker.tsx` + `FindOrCreateOverlay.tsx` (búsqueda por los 3, sin visual), `animales.tsx` / `seleccion-masiva.tsx` / `asignar-caravanas.tsx` (props de fila), `reportes.tsx` / `AlertList.tsx` (label sin visual).

### Tests
- **Unit (node:test)**: `sanitizeApodoInput`, `pickHeroIdentifier`, el warning-soft, `classifySearchQuery`/`classifyIdentifier` (nuevo plan), `classifyCalfQuery`, `animalLabel`, la query de búsqueda por apodo (SQL builder).
- **Suites backend** (`supabase/tests/`): `register_birth` (parto/mellizos sin fallback + cría sin caravana persiste con `idv/visual_id_alt` NULL sin 23514), `create_animal`/`import_rodeo`/`transfer_animal` (sin la columna), reportes (sin la columna), y una aserción de que un `animal_profile` con los 3 identificadores NULL persiste (IDU.1.4).
- **E2E**: buscar por los 3 (electrónica exacta, idv alfanumérico, apodo) en general + cría al pie + maniobra manual; alta/parto sin caravana; nombre como hero (rodeo con apodo). Capturas Gate 2.5.

---

## 2. Contrato del RPC `register_birth` (as-designed) — diff sobre el cuerpo VIGENTE

**REGLA DURA `reference_function_recreate_base`**: el implementer moldea sobre el **cuerpo VIGENTE del RPC en el remoto** (el leader se lo pasa). El contexto §4 afirma que la vigente ya incluye el `calf_idv` per-cría de `0121` (este delta asume que `parto-caravana-visual-por-ternero` se deployó antes; si no, la base sería `0116` y el diff sería equivalente pero sobre otro fallback — en cualquier caso **el fallback se elimina**). Se conserva TODO lo demás: idv por cría, `has_role_in`, idempotencia (`client_op_id`), cota de fecha, cap tag ≤15, rodeo de la cría, herencia de `breed_id`.

**Firma INALTERADA (6-arg)** → `CREATE OR REPLACE` (sin `DROP`, sin tocar grants/overloads).

**Los 3 únicos cambios internos vs. `0121`:**

**(a)** Quitar la declaración del fallback:
```
-  v_visual_fallback text := 'recién nacido — pendiente de caravana';
```

**(b)** En el `INSERT INTO public.animal_profiles`, quitar la columna `visual_id_alt` de la lista de columnas:
```
   insert into public.animal_profiles (
-      animal_id, establishment_id, rodeo_id, idv, visual_id_alt, category_id, category_override,
+      animal_id, establishment_id, rodeo_id, idv, category_id, category_override,
       breed_id, birth_weight, entry_date, entry_origin, status
   ) values (
```

**(c)** En el `VALUES`, quitar la expresión del fallback (la línea del `case when v_calf_tag is null and v_calf_idv is null then v_visual_fallback else null end,`):
```
       v_calf_animal_id, v_est, v_calf_rodeo_id, v_calf_idv,
-      case when v_calf_tag is null and v_calf_idv is null then v_visual_fallback else null end,
       v_calf_category_id, false, v_mother_breed_id, v_calf_weight, p_event_date, 'born_here', 'active'
```

Cierre idempotente (misma firma exacta):
```
revoke execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) from public, anon;
grant  execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) to authenticated;
```

**Por qué es seguro quitar el fallback (coherencia crítica)**: en `0121` el fallback era **load-bearing** (design §5 de `parto-caravana-visual`: el trigger `animal_profiles_identity_check` exigía ≥1 de tag/idv/`visual_id_alt`; una cría sin tag ni idv pasaba el trigger **por** el fallback). Este delta **elimina ese trigger en la misma migración** (IDU.2.1). Sin el trigger, la cría both-null persiste con `idv`/`tag` NULL y **sin** `visual_id_alt` — no hay 23514. **El fallback solo puede quitarse porque el trigger se va: son inseparables** (IDU.2.7). El column-CHECK `animal_profiles_local_id_check` era un NO-OP (`... OR true`) → no enforçaba nada y también se elimina con la columna.

**Matriz de resolución por cría (as-designed, sin fallback):**

| `calf_idv` | `p_calf_idv` | `calf_tag` | `idv` resultante | otros identificadores |
|---|---|---|---|---|
| "0234" | — | — | 0234 | — |
| — | — | "982…" | null | tag=982… |
| — | — | — | null | **ninguno** → persiste igual (sin 23514) |
| — | "0500" (cría al pie) | — | 0500 | — |
| "0234"/"0235" (mellizos) | — | — | 0234/0235 | — |
| "0234"/"0234" (mellizos) | — | — | **23505 → rollback atómico** | — |

## 3. Otras funciones re-creadas (IDU.2.5) — as-designed

Todas se moldean sobre su **cuerpo vigente del remoto** (`reference_function_recreate_base`), quitando SOLO las referencias a `visual_id_alt`:

- **`create_animal` (`0083`)** — **DROP + CREATE** (cambia la firma: se quita el parámetro `p_visual_id_alt`). Quitar `visual_id_alt` de la lista de columnas + del `VALUES` del `INSERT INTO animal_profiles`. Re-emitir `revoke public/anon` + `grant authenticated` con la firma NUEVA. *(El connector deja de pasar `p_visual_id_alt` en el paso 1 del deploy — §11 — así que cuando llega la firma nueva ya nadie lo manda.)*
- **`import_rodeo` (`0074`)** — `CREATE OR REPLACE` (firma intacta). Quitar `visual_id_alt` del contrato jsonb `p_rows` (comentario) + del `INSERT INTO animal_profiles` (columna + `nullif(trim(coalesce(v_row->>'visual_id_alt','')),'')`).
- **`transfer_animal` (`0087`)** — `CREATE OR REPLACE` (firma intacta). Quitar `visual_id_alt` del `SELECT` de la fila origen (variable `v_source_visual_id`) y del `INSERT INTO animal_profiles` del perfil destino.
- **Reportes (`0106`)** — **DROP + CREATE** de las dos funciones que retornan `visual_id_alt` en su `RETURNS TABLE` (cambio de tipo de retorno → no admite `CREATE OR REPLACE`): quitar `visual_id_alt text` del `returns table (...)` y `p.visual_id_alt` del `SELECT`. Re-grant. El frontend (`reports.ts`/`reports-format.ts`) deja de leerlo (§11 paso 1). *(Decisión: los reportes NO adoptan hero-por-apodo — queda fuera de alcance, ver §12 alt. 5; degradan a `idv → "Sin identificación"`.)*

## 4. Migración `0122_drop_visual_id_alt.sql` (esqueleto, GATEADO a Raf)

```sql
-- 🔴 NO aplicar desde acá — lo aplica el LEADER por Supabase MCP con autorización de Raf.
begin;

-- (1) IDU.2.1 — drop del trigger de completitud + su función. Un animal puede quedar con 0 identificadores
--     de usuario (siempre tiene su PK interna). No abre hueco de tenant/authz (Gate 1).
drop trigger  if exists animal_profiles_identity_check on public.animal_profiles;
drop function if exists public.tg_animal_profiles_identity_check();

-- (1b) IDU.2.6 (gap cazado por el leader en la verificación al remoto, 2026-07-08): la función
--      tg_reproductive_events_create_calf (0032) referencia visual_id_alt pero está MUERTA — NINGÚN trigger
--      activo la usa (register_birth tomó la creación de crías; la función quedó huérfana, confirmado por
--      pg_trigger vacío). Se dropea para "borrar del todo" (no rompería en runtime porque nunca se llama,
--      pero deja de referenciar la columna). Si el implementer encuentra que SÍ está atada a un trigger vivo,
--      PARAR y avisar (no debería, pero es la regla de moldear-sobre-el-vigente).
drop function if exists public.tg_reproductive_events_create_calf() cascade;

-- (2) IDU.2.2 / IDU.2.5 — re-create de los RPC SIN visual_id_alt (moldear sobre el cuerpo VIGENTE del remoto).
--     register_birth: CREATE OR REPLACE (§2). create_animal: DROP+CREATE (quita p_visual_id_alt, §3).
--     import_rodeo: CREATE OR REPLACE (§3). transfer_animal: CREATE OR REPLACE (§3).
--     reportes: DROP+CREATE (RETURNS TABLE, §3). Re-grants fail-closed en cada una.
--     [cuerpos completos → los redacta el implementer sobre el remoto vigente]

-- (2b) M1 (Gate 1, Puerta 1) — validación SERVER-AUTORITATIVA del apodo. Re-crear assert_custom_value_valid
--      (0096, CREATE OR REPLACE sobre el cuerpo VIGENTE) agregando: cuando el field es el apodo
--      (data_key='apodo'), enforçar char_length(value) <= 15 Y el charset (letras/dígitos/ñ/tildes/espacio/
--      guion). raise con errcode propio si no cumple. Resto de la validación (type=string, cap 4096) intacto.
--      [cuerpo → el implementer sobre el vigente; confirmar cómo la función resuelve el data_key del field]

-- (3) IDU.7.1 — rename del label del apodo.
update public.field_definitions set label = 'Nombre/Apodo'
 where data_key = 'apodo' and label is distinct from 'Nombre/Apodo';

-- (4) IDU.2.3 — drop físico de la columna. Postgres auto-dropea los objetos "involving the column":
--     el CHECK animal_profiles_local_id_check (0020, no-op), el CHECK animal_profiles_visual_id_alt_len_chk
--     (0070) y el índice trigram animal_profiles_visual_alt_trgm (0020). Se dropean EXPLÍCITOS antes (auditable)
--     y luego la columna (el explicit-drop es defensivo; el DROP COLUMN igual los cubriría).
drop index    if exists public.animal_profiles_visual_alt_trgm;
alter table   public.animal_profiles drop constraint if exists animal_profiles_visual_id_alt_len_chk;
alter table   public.animal_profiles drop constraint if exists animal_profiles_local_id_check;
alter table   public.animal_profiles drop column     if exists visual_id_alt;

-- (5) IDU.2.4 — inmutabilidad (0036): NO se toca la lógica (solo referencia visual_id_alt en un comentario).

notify pgrst, 'reload schema';
commit;
```

> **Nota sobre `animal_profiles_local_id_check`**: hoy referencia `idv` **y** `visual_id_alt`. Es un NO-OP (`... OR true`, verificado en `parto-caravana-visual` §5). Al eliminarlo NO se pierde ninguna garantía (la completitud la enforçaba el trigger, ya dropeado; la unicidad del idv la enforça el índice, intacto). No se re-crea una versión "solo idv".

## 5. `sanitizeApodoInput` (PURO, en `animal-input.ts`)

```ts
export const APODO_MAX_LENGTH = 15;   // Puerta 1: subido de 10 (cortaba nombres de 2 palabras, "La Colorada"=11).

/**
 * Nombre/Apodo: letras + dígitos + espacios + guiones, cap 10. Formato de IDENTIFICADOR específico del apodo
 * (NO la validación genérica de custom fields). Filtra en vivo (onChangeText) — PREVENIR, no errorear.
 */
export function sanitizeApodoInput(raw: string): string {
  return raw.replace(APODO_DISALLOWED, '').slice(0, APODO_MAX_LENGTH);
}
```

- **Charset (DECIDIDO en Puerta 1)**: `APODO_DISALLOWED = /[^A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ \-]/g` — **incluye letras acentuadas + `ñ`** (es-AR: el apodo es un nombre en español; ASCII estricto comería la `ñ`/tildes de "Toño"/"Ñata"). Espacios y guiones permitidos, cap **15**, otros símbolos descartados.
- **Validación SERVER-AUTORITATIVA (M1 de Gate 1, DECIDIDO en Puerta 1)**: el sanitizer de cliente es UX/attacker-controlled → hay que enforçar el formato del apodo **server-side** también (regla dura de Raf). En la migración `0122` se **re-crea `assert_custom_value_valid` (0096)** (moldeando sobre el cuerpo VIGENTE) agregando: cuando el `field_definition` es el apodo (`data_key='apodo'`), validar `char_length(value) <= 15` **y** el charset (letras/dígitos/ñ/tildes/espacio/guion) — `raise` con errcode propio si no cumple. El resto de la validación (type=string, cap genérico 4096) intacto. Así el largo/charset del apodo son autoritativos en el server, no solo en el input. El implementer confirma cómo `assert_custom_value_valid` recibe/resuelve el `data_key` del field (si no lo tiene a mano, lo joinea a `field_definitions`).
- **Aplicación (IDU.5.2/5.3)**: el `CustomFieldInput` (rama `text`) gana un hook por `data_key`. El caller (`crear-animal` `CustomPropertiesForm` y la ficha) sabe el `data_key` de cada field: cuando `data_key === 'apodo'`, pasa `sanitizeApodoInput` como transformador del `onChangeText` (paralelo a como el `date` usa `maskDateInput`). Se agrega a `CustomFieldInputProps` una prop OPCIONAL y ADITIVA (ej. `sanitize?: (raw: string) => string`) — backward-compat: los callers sin `sanitize` no cambian de comportamiento.

## 6. Clasificadores de búsqueda (PUROS, `animal-identifier.ts` + `link-calf-query.ts`)

### `classifySearchQuery` (nuevo plan — IDU.4.1/4.2/4.3/4.5)

Se reemplaza el `SearchPlan` para el modelo de 3:

```ts
export type SearchPlan = {
  /** compact = 15 dígitos → candidato a match EXACTO de Caravana Electrónica. */
  tryTagExact: boolean;
  /** término no vacío → match EXACTO de idv (alfanumérico, case-insensitive). */
  tryIdvExact: boolean;
  /** término no vacío → match PARCIAL (ilike) sobre idv + tag_electronic denormalizado. */
  tryIdvSubstring: boolean;
  /** término no vacío → match PARCIAL (ilike) sobre el apodo (custom_attributes join). NUEVO. */
  tryApodo: boolean;
  normalized: string;   // trim + cap SEARCH_TERM_MAX_LENGTH (64)
  compact: string;      // normalized sin separadores de formato
};
```

- **Cambios vs. hoy**: (a) `tryIdvExact`/`tryIdvSubstring` dejan de gatear por `isDigits` — se habilitan para **todo término no vacío** (así un idv alfanumérico o su prefijo se encuentra; hoy solo dígitos disparaban idv). (b) Se **elimina** `tryVisual` (visual_id_alt). (c) Se **agrega** `tryApodo` (todo término no vacío). (d) `tryTagExact` = compact es 15 dígitos (sin cambio conceptual).
- **Desambiguación (IDU.4.2)**: `tryTagExact` y `tryIdvExact` pueden dispararse ambos para un texto de 15 dígitos (un idv puede ser 15 dígitos) — se prueban en paralelo; el motor (`searchAnimals`) **prioriza los exactos** (tag/idv) sobre los substring/apodo, concatenándolos arriba y deduplicando por `profileId` (comportamiento vigente conservado).
- `SEARCH_TERM_MAX_LENGTH = 64` (cap autoritativo server-side, spec 13) **se conserva**.

### `classifyIdentifier` (precarga al alta — IDU.4.10)

Hoy devuelve `'idv' | 'visual'` para decidir el campo de precarga tras un no-match. Como `visual_id_alt` desaparece y el `idv` es alfanumérico, el destino de precarga **colapsa a `idv`** (el texto tipeado se precarga en el campo idv, sanitizado por `sanitizeIdvInput` a alfanum ≤15). El tipo `IdentifierKind` se reduce a `'idv'` (o la función se elimina si el caller ya no necesita ramificar). Misma reducción en la réplica de `maniobra-identify.ts` (`resolvePrefillIdentifier`).

### `classifyCalfQuery` (`link-calf-query.ts` — IDU.4.7)

Hoy solo acepta numérico (`eid` 15 díg / `idv` ≥3 díg). Se amplía para aceptar **idv alfanumérico** y **apodo** en la rama de búsqueda (no-eid):
- `eid` (15 dígitos puros) → `lookupByTag` (sin cambio).
- término alfanumérico no vacío que NO sea 15 dígitos → rama `search` (dispara `searchAnimals`, que ahora cubre idv alfanumérico + apodo). Se relaja el gate `too-short`/`^\d+$` para permitir letras (el apodo puede ser "Manchada").
- vacío → `empty` (error inline, sin motor).

### `candidateMatchesExactly` (`maniobra-identify.ts` — IDU.4.11)

`ManualCandidate` cambia `visualIdAlt` → `apodo`. La comparación exacta pasa a: `normalizeId(c.idv) === t || normalizeId(c.apodo) === t || normalizeId(c.tagElectronic) === t`.

## 7. Búsqueda por apodo — data-layer (`buildApodoSearchQuery`, IDU.4.4)

El apodo vive en `custom_attributes` (PK compuesta `animal_profile_id, field_definition_id`, columna `value` jsonb-as-TEXT) → el `field_definition` es el `apodo` per-establecimiento (`data_key='apodo'`, `establishment_id` no-NULL; seed `0119`). Query local (whitelist de columna, term parametrizado — anti-injection):

```sql
SELECT ap.id AS id, ap.animal_id AS animal_id, ap.idv AS idv,
       ap.category_id AS category_id, ap.rodeo_id AS rodeo_id, ap.status AS status,
       ap.management_group_id AS management_group_id,
       ap.animal_tag_electronic AS tag_electronic, ap.animal_sex AS sex, ...
FROM custom_attributes ca
JOIN field_definitions fd ON fd.id = ca.field_definition_id
JOIN animal_profiles ap    ON ap.id = ca.animal_profile_id
WHERE fd.data_key = 'apodo' AND fd.establishment_id IS NOT NULL
  AND ap.establishment_id = ?         -- scope de tenant (Gate 1)
  AND ap.deleted_at IS NULL AND ap.status = 'active'
  AND ca.value LIKE ? ESCAPE '\'      -- '%' || escaped(term) || '%'
```

- **Encoding del value**: para un custom `text`, el `value` se guarda como JSON-string (`"Manchada"`, con comillas — `serializeCustomValue` hace `JSON.stringify`). El `LIKE '%term%'` matchea el interior sin problema (las comillas están en los extremos). El escape de `%`/`_`/`\` del término lo hace el mismo helper que `buildSearchLikeQuery` ya usa.
- **Proyección**: devuelve `LocalListRow` (mismas columnas que las otras ramas de `searchAnimals`) para que el motor concatene/dedupe por `profileId` uniformemente. `visual_id_alt` NO se proyecta.
- **Overlay pendiente**: el apodo recién cargado offline (aún no ACK) vive en `pending_custom_attributes` (si existe esa stream) — el implementer verifica si la rama overlay es necesaria para que un apodo recién tipeado sea buscable antes del sync; si `custom_attributes` local ya refleja el write optimista, no hace falta rama extra. (Decisión del implementer, verificable con un test.)
- **Gate 1**: el `WHERE ap.establishment_id = ?` + el scope per-establishment de la stream `est_custom_attributes` cierran cross-tenant. El `data_key='apodo'` no es input de usuario (constante) → sin injection.

## 8. Enriquecimiento de la lista con apodo + apodo_enabled (IDU.6.5)

La lista (`LOCAL_LIST_SELECT` / `_OVERLAY`) suma dos proyecciones por animal:
- **`apodo`** — LEFT JOIN a `custom_attributes` (join `field_definitions` por `data_key='apodo'`) sobre `ca.animal_profile_id = ap.id`. Devuelve el `value` jsonb-TEXT (el frontend lo decodifica con `parseCustomValueJson`, `custom-render.ts`).
- **`apodo_enabled`** — si el rodeo del animal tiene el campo apodo habilitado. Se resuelve con la MISMA mecánica que `buildEnabledCustomFieldsQuery` (LEFT JOIN a `rodeo_data_config` por `(rodeo_id, apodo_fd_id)`, con **overlay** `pending_rodeo_data_config` que PISA al synced — un toggle offline debe reflejarse). El `apodo_fd_id` se resuelve por subconsulta (`SELECT id FROM field_definitions WHERE data_key='apodo' AND establishment_id IS NOT NULL`).

Es la parte **más "de fondo"** (contexto §4/§5): toca la query central de la lista + su overlay. El frontend (`animales.tsx` → `AnimalRow`) pasa `apodo` + `rodeoUsesApodo` a `pickHeroIdentifier`.

> **Alternativa (más simple) considerada**: computar `rodeoUsesApodo` a nivel screen (una vez por rodeo) en vez de per-row join. Descartada para el MVP porque la lista general mezcla rodeos (no hay un único "rodeo activo") → el per-row join es lo correcto. Si el costo de la query pesa, el implementer puede cachear el set de rodeos-con-apodo y resolver `apodo_enabled` en memoria (optimización, no cambia el contrato).

## 9. Warning-soft de duplicado de apodo (PURO + lectura local, IDU.5.4–5.7)

**Helper puro (testeable):**
```ts
/** ¿El apodo candidato ya lo usa OTRO animal del campo? Case-insensitive, trim. `others` = apodos de los
 *  demás animales activos del establecimiento (el propio excluido por el caller). */
export function isApodoDuplicateInField(candidate: string, others: readonly string[]): boolean {
  const c = candidate.trim().toLowerCase();
  if (c.length === 0) return false;
  return others.some((o) => o.trim().toLowerCase() === c);
}
```

**Lectura local (`buildApodoListQuery`)**: todos los apodos activos del establecimiento (decodificados por el caller), con su `animal_profile_id` para excluir el propio (IDU.5.6):
```sql
SELECT ca.animal_profile_id AS profile_id, ca.value AS value
FROM custom_attributes ca
JOIN field_definitions fd ON fd.id = ca.field_definition_id
JOIN animal_profiles ap    ON ap.id = ca.animal_profile_id
WHERE fd.data_key='apodo' AND fd.establishment_id IS NOT NULL
  AND ap.establishment_id = ? AND ap.deleted_at IS NULL AND ap.status='active'
```
- El caller decodifica cada `value` (`parseCustomValueJson`), excluye el `profile_id` del animal en edición (IDU.5.6), y llama `isApodoDuplicateInField`. El scope `ap.establishment_id = ?` cubre IDU.5.7 (por campo).
- **UI**: el warning es un texto inline muted bajo el input del apodo (no un banner global que tape el título — memoria `feedback_ux_basicos_sheets_forms`), no bloquea el submit (IDU.5.5). Corre en el alta (`crear-animal`) y en la edición de la ficha (mismo helper + misma lectura).

## 10. Lógica del hero (PURO, `pickHeroIdentifier`, IDU.6.1/6.4/6.6)

```ts
export type HeroKind = 'apodo' | 'idv' | 'tag' | 'none';
export type HeroResult = {
  kind: HeroKind;
  value: string | null;                 // el texto hero (null si kind==='none')
  secondary: { kind: 'idv' | 'tag'; value: string } | null;  // caravana a mostrar chica cuando el hero es apodo
};

export function pickHeroIdentifier(input: {
  apodo: string | null;
  rodeoUsesApodo: boolean;
  idv: string | null;
  tag: string | null;
}): HeroResult {
  const apodo = clean(input.apodo);
  const idv = clean(input.idv);
  const tag = clean(input.tag);
  if (input.rodeoUsesApodo && apodo) {
    const secondary = idv ? { kind: 'idv', value: idv } : tag ? { kind: 'tag', value: tag } : null;
    return { kind: 'apodo', value: apodo, secondary };
  }
  if (idv) return { kind: 'idv', value: idv, secondary: null };
  if (tag) return { kind: 'tag', value: tag, secondary: null };
  return { kind: 'none', value: null, secondary: null };
}
```

- **Fallback de display (IDU.6.6)**: el call site elige el texto para `kind==='none'` — `AnimalRow` usa "sin caravana" (el chip neutro ya existente), la ficha usa "Animal". La función pura NO hardcodea el copy (lo pasa el caller), así se testea sin acoplar a la UI.
- **`AnimalRow`**: reemplaza `hero = idv ?? visualId ?? '—'` + `showSecondaryVisual` por `pickHeroIdentifier(...)`. Gana props `apodo?: string | null` + `rodeoUsesApodo?: boolean`; pierde `visualId`. El secundario (cuando el hero es apodo) se muestra inline muted (`· #<caravana>`), reusando el idiom actual del secundario visual.
- **Ficha** (`animal/[id].tsx`): `heroLabel` pasa de `idv ?? visualIdAlt ?? tagElectronic ?? 'Animal'` a `pickHeroIdentifier({ apodo, rodeoUsesApodo, idv, tag }).value ?? 'Animal'`; la ficha ya lee `custom_attributes` (datos personalizados) → tiene el apodo; el `rodeoUsesApodo` sale del set de fields habilitados que la ficha ya consulta.

## 11. Orden de deploy (contexto §7.3) — para no dejar ventana rota

El riesgo es una ventana donde un lado espera la columna que el otro ya sacó. Secuencia segura (la coordina/gatea Raf):

**PASO 1 — Frontend + schema PowerSync que YA NO referencian `visual_id_alt` (deploy del bundle app + coordinación del schema PowerSync con Raf).**
Todo lo que **deja de** leer/escribir/proyectar la columna, **tolerando que aún exista en el server**:
- `schema.ts` (quita la columna del schema local — PowerSync ignora columnas server que no están en el schema local; y el connector deja de mandarla).
- `local-reads.ts` (quita `visual_id_alt` de las proyecciones + agrega apodo/hero), `upload.ts` (deja de mapear `visual_id_alt` y `p_visual_id_alt`), servicios/utils/componentes (§1).
- El connector **deja de pasar `p_visual_id_alt`** a `create_animal` (el RPC viejo aún tiene el param con default NULL → llamarlo sin él es válido). El flujo de import deja de mapear la columna.
- **Estado intermedio seguro**: el server todavía tiene la columna + los RPC viejos (que la escriben con NULL). Nadie del cliente la lee ni la manda. Cero ventana rota.

**PASO 2 — Migración DB `0122` (leader por Supabase MCP, autorización de Raf).**
Dropea el trigger de identidad, re-crea los RPC sin la columna (incluida la firma nueva de `create_animal` sin `p_visual_id_alt`, que el connector ya no manda desde el paso 1), renombra el label del apodo, y dropea la columna + dependientes. Tras `reload schema`, PostgREST expone las firmas nuevas.

- **Coordinación PowerSync**: el cambio de `schema.ts` (schema LOCAL del cliente) viaja en el bundle del paso 1. Si las **sync-rules** del servicio PowerSync referencian `visual_id_alt` explícitamente (no `SELECT *`), Raf las actualiza en coordinación con el paso 2. El leader NO deploya PowerSync — lo gestiona Raf (contexto §6).
- **Rollback**: si el paso 2 falla, el paso 1 ya está vivo y es tolerante (no lee la columna) → no hay que revertir el frontend; se corrige la migración y se re-aplica.

## 12. Alternativas descartadas

1. **Migrar `visual_id_alt` con data real → `apodo`.** Descartada (contexto §7.1, decisión de Raf): escala beta mínima, los placeholders son basura, migrar a apodo ensuciaría rodeos que NO usan apodo (el apodo es opt-in) y forzaría habilitarlo. Al dropear la columna se descarta todo.
2. **Conservar la columna `visual_id_alt` y solo ocultarla en la UI.** Descartada (contexto §3.1): el objetivo es limpiar el modelo del todo y documentado; una columna muerta se superpone conceptualmente con el apodo y vuelve a confundir en 6 meses.
3. **Generalizar `sanitizeApodoInput` a TODOS los custom fields `text`.** Descartada (contexto §7.2): solo el apodo tiene formato de identificador (alfanum ≤10 + espacios/guiones); los demás custom `text` son texto libre. Se aplica por `data_key==='apodo'`, no al genérico.
4. **`create_animal`: mantener `p_visual_id_alt` como no-op (ignorarlo) en vez de DROP+CREATE.** Descartada: dejaría un parámetro muerto en la firma pública (contradice "borrar del todo"). El costo del DROP+CREATE (re-grant) es bajo y el paso 1 del deploy ya garantiza que el connector no lo manda. Se elige la firma limpia.
5. **Extender los reportes (`0106`) a hero-por-apodo.** Descartada: el contexto §5 restringe el hero-por-nombre a **lista + ficha**. Los reportes solo pierden la columna `visual_id_alt` del retorno y `animalLabel` degrada a `idv → "Sin identificación"` (cambio mecánico, sin decisión de producto).
6. **Constraint DB de unicidad para el apodo.** Descartada (contexto §2/§6): el apodo es soft-warning (dos "Manchada" en el mismo campo se permiten). El chequeo es client-side sobre la lectura local; sin constraint nuevo.
7. **Clasificar el término de búsqueda en un solo canal (heurística exclusiva EID vs idv vs apodo).** Descartada (contexto §4): un mismo texto puede matchear varios (15 dígitos = tag y/o idv); se prueban en **paralelo** y el motor prioriza el exacto — evita "no encontramos" por una desambiguación demasiado rígida.

## 13. Gate 1 — qué audita (APLICA)

Este delta dispara Gate 1 (RPC security-definer + drop de trigger de integridad + canal de búsqueda nuevo). El `security_analyzer` modo `spec` verifica:
- **Drop del trigger `animal_profiles_identity_check`**: que sea una regla de **completitud de dato** (≥1 identificador), NO de tenant/authz — quitarla no habilita ver/escribir datos de otro campo. La identidad server-side sigue forzada por `tg_force_animal_identity_on_profile` (`0079`, anti-spoof) y la unicidad del idv por el índice — intactos.
- **`register_birth` sin fallback**: que quitar el fallback sea seguro **porque** el trigger se elimina en la misma migración (coherencia atómica IDU.2.7); que se conserven idempotencia, `has_role_in`, herencia de `breed_id`, atomicidad; que no se degrade `revoke public/anon` + `grant authenticated`.
- **Drop de la columna + re-create de `create_animal`/`import_rodeo`/`transfer_animal`/reportes**: que no rompa RLS (las policies de `animal_profiles` no dependen de `visual_id_alt`) ni la firma pública de forma insegura (grants fail-closed en las funciones re-creadas; `create_animal` con firma nueva re-grantea).
- **Canal de búsqueda por apodo**: que la query esté scopeada por `establishment_id` (no filtra cross-tenant — `custom_attributes` scopeado por el establecimiento del perfil; `data_key='apodo'` es constante, no input de usuario → sin injection).

Output: `progress/security_spec_identificadores-unificados.md` (PASS / NEEDS_CLARIFICATION / FAIL). **Gate 2** (code) corre sobre el diff (migración + PowerSync + frontend). El **DEPLOY** de `0122` + el schema PowerSync los coordina/gatea Raf.

## 14. Gate 2.5 — capturas (hay UI)

Hay UI nueva/afectada → Gate 2.5 (E2E + capturas + veto visual, ADR-029):
- Búsqueda por los 3 (electrónica exacta, idv alfanumérico, apodo) en el buscador general + cría al pie + maniobra manual.
- Alta y parto de un animal **sin ninguna caravana** (no rompe; persiste).
- **Nombre como hero**: lista + ficha de un animal con apodo en un rodeo que usa apodo (apodo grande, caravana secundaria); y el contraste con un rodeo sin apodo (caravana grande).
- Warning-soft de apodo duplicado (aparece el aviso, NO bloquea el guardado).
- Ficha sin la fila "Nombre / seña".
