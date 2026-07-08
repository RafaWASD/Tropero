# Contexto (Gate 0, ADR-022) — Delta "IDENTIFICADORES UNIFICADOS"

**Feature**: spec 02 (modelo de animal) + spec 09 (BUSCAR ANIMAL). Delta Nivel B (ADR-028) **CON BACKEND + PowerSync**.
**Origen**: charla con Raf (2026-07-08) que arrancó por un bug (la caravana visual del parto se sanitizaba como numérica) y escaló a limpiar TODO el modelo de identificadores.
**Estado**: `context_ready` — **Gate 0 APROBADO por Raf (2026-07-08)** + laburo de PowerSync aceptado. Listo para `spec_author`.
**Revisa/toca**: los deltas `parto-caravana-visual-por-ternero` (su fallback `visual_id_alt` se elimina), `nombre-apodo` (#2, el apodo pasa a identificador de primera clase), `caravana-ficha`, y la heurística de búsqueda de spec 09.

---

## 1. Problema

El modelo de identificadores del animal creció desprolijo. **Hoy hay 4 campos** (no 3):

| Campo (DB) | UI | Formato hoy | Unicidad | Se ingresa | Se busca |
|---|---|---|---|---|---|
| `animals.tag_electronic` | Caravana electrónica | numérico 15 | única GLOBAL (`animals_tag_unique`, 0019) | bastoneo + manual | sí (exacto 15 + substring numérico) |
| `animal_profiles.idv` | Caravana visual | **alfanum ≤15** (recién corregido de numérico) | única por establecimiento (`animal_profiles_idv_unique`, 0020) | "Caravana visual" (parto/alta/ficha) | ⚠️ solo si es todo-dígitos → **el alfanumérico NO se encuentra** |
| `animal_profiles.visual_id_alt` | "Nombre / seña" | texto libre ≤30 | ninguna | ⚠️ casi no se ingresa (sacado del alta en #2, out-of-scope en la ficha); hoy = fallback "recién nacido — pendiente de caravana" | sí (fuzzy siempre) |
| `apodo` (custom, `custom_attributes`) | Nombre/apodo | texto libre | ninguna | "Datos personalizados", **opt-in por rodeo** | ❌ ningún buscador lo mira |

Defectos concretos: (a) el idv se sanitizaba numérico → comía las letras del formato real; (b) el idv alfanumérico no se puede buscar; (c) el apodo no se puede buscar; (d) `visual_id_alt` se superpone con el apodo (los dos "nombre/descripción libre") y quedó medio-muerto.

## 2. Modelo objetivo — **3 identificadores, TODOS OPCIONALES**

| # | Nombre | Campo | Formato | Unicidad | Scope |
|---|---|---|---|---|---|
| 1 | **Caravana Electrónica** | `tag_electronic` | numérica **15 dígitos** (FDX-B) | dura | **GLOBAL** (chip físico único en el mundo) |
| 2 | **Caravana Visual** | `idv` | **alfanumérica ≤15** (CUIG: 2 letras+3 números + individual `A000..ZZZ9` + verificador; SENASA Res.841/2025 binomio) | dura | **por campo** (establecimiento) |
| 3 | **Nombre/Apodo** | custom field `apodo` | **alfanumérico ≤15 + espacios/guiones** (Gate 0 lo puso en ≤10; Puerta 1 lo subió a ≤15 — "La Colorada"=11 cortaba) | **soft warning** (no bloquea) | **por campo** (establecimiento) |

- **Todas opcionales**: un animal puede tener 0..3. Siempre tiene su **PK interna** del sistema (`animals.id` / `animal_profiles.id`).
- **Apodo = opt-in por rodeo** (la app anda perfecto sin él); electrónica + visual = disponibles en todo rodeo (no obligatorias por animal, recomendables).
- **Modelo de unicidad coherente**: el chip físico (electrónica) = global; lo que asigna la persona (visual, apodo) = por campo.

## 3. Decisiones cerradas con Raf

1. **Borrar `visual_id_alt` (el 4to) del todo** — aunque sea más caro, para dejar limpio + documentado. Implica:
   - **Drop del trigger de identidad** `animal_profiles_identity_check` (0021→0039), que hoy obliga "≥1 de tag/idv/visual_id_alt". Sin el comodín `visual_id_alt`, y para respetar "todas opcionales", **el trigger se va** → un animal puede existir con **cero identificadores de usuario**.
   - **Sacar el fallback** de `register_birth` (el "recién nacido — pendiente de caravana" que se agregó en el delta parto — su única razón era satisfacer ese trigger).
   - **Drop físico de la columna** `visual_id_alt` (Raf **aceptó el laburo de PowerSync**: schema de sync + connector + reads/writes).
   - Limpiar TODOS sus usos (ver footprint §5): hero/`AnimalRow`, clasificadores de búsqueda, ficha, import, bulk-selection, trigger de inmutabilidad (0036).
2. **Apodo → warning-soft de duplicado POR CAMPO** (establecimiento), **no bloquea** (dos "Manchada" en campos distintos es válido; en el mismo campo se avisa pero se permite). Sin constraint DB nuevo → chequeo client-side sobre la lectura local.
3. **Rename**: "Nombre / seña" → **"Nombre/Apodo"** (el apodo es el único "nombre").
4. **Búsqueda unificada**: TODOS los buscadores encuentran por **los 3** (electrónica, visual, apodo). Aplica al buscador general de animales, cría al pie, y la **entrada manual "sin bastón" de maniobra**. El ÚNICO camino solo-electrónica es el **"Bastonear" de ficha/alta** (que es un *duplicate-check* del EID: busca aunque probablemente no exista, para no repetir).
5. **#2 — nombre como campo grande**: cuando el rodeo **usa apodo** Y el animal **tiene apodo** → el apodo es el **hero** (campo grande) en la lista + la ficha; la caravana baja a la línea secundaria. Si no (rodeo sin apodo, o animal sin apodo) → queda como está (caravana grande). Prioridad del hero: **apodo → visual → electrónica → "sin caravana"**.
6. **Chequeo de duplicados al setear** (coherente para los 3):
   - Electrónica: única global (23505) — ya existe.
   - Visual (idv): única por campo (23505) — ya existe.
   - Apodo: warning-soft por campo (nuevo, client-side).

## 4. Consecuencias / edge cases a resolver en la spec

- **Animales sin ningún identificador**: al irse el trigger, un animal puede quedar con tag/idv/apodo todos NULL. La UI ya tiene el chip **"sin caravana"** (lista) — se generaliza como fallback de display. El hero cae a "Animal" / "sin caravana".
- **Datos existentes de `visual_id_alt`**: al dropear la columna se pierden. Los placeholders ("recién nacido — pendiente de caravana") son basura → OK perderlos. **DECISIÓN ABIERTA**: si hubiera `visual_id_alt` con data REAL (seña/color), ¿se descarta o se migra al apodo? Recomendación del leader: **descartar** (escala beta, mínimo; el owner puede re-cargar como visual/apodo; migrar a apodo ensuciaría rodeos que no usan apodo). A confirmar en la spec.
- **Búsqueda del apodo (lo más "de fondo")**: el apodo vive en `custom_attributes` (PK compuesta animal_profile_id+field_definition_id). El buscador hoy NO toca esa tabla → hay que sumarla a la query de búsqueda (capa de lectura, PowerSync). Ídem el #2 (la LISTA tiene que leer el apodo por animal + si el rodeo lo habilita).
- **Desambiguación EID vs visual/apodo** en el clasificador: nueva regla → *exactamente 15 dígitos = candidato electrónica; con letras o ≤15 dígitos = candidato visual/apodo*. Se prueban en paralelo (un texto puede matchear varios), el motor prioriza el exacto.
- **Formato del apodo (alfanum ≤10 + espacios/guiones)**: el apodo es un custom field genérico (`data_type='propiedad'`, `ui_component='text'`). Darle un formato/tope específico requiere una regla apodo-específica (no la validación genérica de custom fields). A definir en la spec.
- **Inmutabilidad (0036)**: el trigger `tg_animal_profiles_...` de inmutabilidad referencia `visual_id_alt` → se ajusta/elimina con la columna.
- **register_birth**: se re-CREATE quitando el fallback. **Regla dura** `reference_function_recreate_base`: moldear sobre el cuerpo VIGENTE del remoto (que ya incluye el `calf_idv` per-cría de `0121`).

## 5. Footprint (dónde toca — para dimensionar)

- **Backend (Gate 1 + deploy gateado)**: `animal_profiles` (drop col `visual_id_alt`, 0020), trigger identidad (0021/0039 → drop), trigger inmutabilidad (0036 → ajuste), `register_birth` (re-CREATE sin fallback), posible `import_rodeo` RPC (0074, si mapea visual_id_alt), `create_animal` RPC (0083, si lo mapea). Migración nueva.
- **PowerSync**: `schema.ts` (quitar la columna del schema local), `local-reads.ts` (reads que la proyectan + **sumar apodo a la búsqueda + a la lista**), `upload.ts` (connector, si la mapea).
- **Frontend**: `AnimalRow` (sacar `visualId`, agregar `apodo`/hero-por-nombre), ficha `animal/[id].tsx` (hero + Identificación + sacar visual_id_alt), clasificadores `animal-identifier.ts` + `link-calf-query.ts` (alfanumérico + apodo), buscador general + cría al pie + maniobra-manual, `crear-animal` (apodo format + rename), `import-rodeo` (mapeo), `bulk-selection-data`, `animal-input.ts` (sanitizer/format del apodo).
- **Tests**: unit de los clasificadores + sanitizers + la lectura de búsqueda; suites backend (animal + SIGSA + parto/mellizos por register_birth); e2e (buscar por los 3 + alta/parto sin caravana + nombre como hero); capturas Gate 2.5.

## 6. Gates

- **Gate 1** (security spec): APLICA — toca RPC security-definer (`register_birth`), drop de trigger de integridad (`animal_profiles_identity_check`), y la búsqueda suma un canal (apodo). El auditor mira: que quitar el trigger no abra un hueco (no lo abre — era una regla de completitud de dato, no de tenant/authz), que la búsqueda por apodo no filtre cross-tenant (custom_attributes scopeado por el establishment del perfil), que el drop de columna no rompa RLS.
- **Deploy** de la migración: **GATEADO a Raf** (Supabase MCP) + coordinar el **deploy del schema de PowerSync** (que Raf gestiona).
- **Gate 2** (code, siempre) + **Gate 2.5** (E2E + capturas + veto visual, ADR-029) — hay UI (hero por nombre, búsqueda, alta/parto sin caravana).

## 7. Preguntas abiertas — RESUELTAS

1. **Datos reales de `visual_id_alt`**: **DESCARTAR** (decisión de Raf, 2026-07-08). Al dropear la columna se pierde todo (placeholders + cualquier seña real). No se migra a apodo.
2. **Formato del apodo** (alfanum + espacios/guiones): **regla apodo-específica** (decisión leader) — un `sanitizeApodoInput` propio (alfanumérico + espacio + guion), aplicado al input del campo apodo. NO se generaliza a todos los custom fields (solo el apodo tiene este formato de identificador). La spec lo define. **Cap**: Gate 0 lo puso en 10; **Puerta 1 lo subió a 15** ("La Colorada"=11 cortaba) — 15 es el valor firme (requirements IDU.5.1/5.1b + design §5 + código).
3. **Orden de deploy** (decisión leader, a detallar en la spec): coordinar para no dejar ventana rota. Secuencia segura: **(1)** frontend + schema PowerSync que ya NO referencian `visual_id_alt` (dejan de escribir/leer/proyectar la columna, tolerando que aún exista en el server), **(2)** luego la migración DB que dropea el trigger + la columna. Así nunca hay un lado esperando la columna que el otro ya sacó. El deploy de la migración y del schema PowerSync los coordina/gatea Raf.
4. **Warning-soft de apodo al EDITAR** (decisión leader): **SÍ** — el chequeo por campo corre al setear el apodo en el alta Y al editarlo desde la ficha (mismo helper). No bloquea; solo avisa "ya hay otro animal con ese nombre en el campo".
