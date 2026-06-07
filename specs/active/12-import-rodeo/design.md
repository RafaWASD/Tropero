# Spec 12 — Importación masiva de rodeo — Design

**Status**: spec_ready — **Gate 1 PASS 0 HIGH** (2026-06-06); pendiente Puerta 1 (Raf). Findings MEDIUM/LOW foldeados (ver §6 + §3.2 + requirements R9.5/R11.5/R3.7).
**Fecha**: 2026-06-06 (sesión 23).
**Fuente**: `context.md` (Gate 0) + `requirements.md` de esta spec + los 7 reforzamientos del leader.
**Reusa as-built**: spec 02 (migrations 0019 `animals`, 0020/0021 `animal_profiles` + constraints, 0022 RLS, 0015/0059/0062 categorías post-Tier-2, 0043 `tg_force_created_by_auth_uid`, 0070 CHECK char_length), spec 04 R8 (`app/src/services/ble/parser-rs420.ts` — `normalizeTag`/`isValidTag`), spec 08 (`razas-senasa-codigos.md` — tabla de 32 códigos), spec 09/02 (find-or-create + dedup blanda R5.5/R5.6), spec 10 (patrón skip-and-report + preview + import parcial), `app/src/services/animals.ts` (patrón split insert+select + resolución de categoría por `(systemId, code)`).

> **Regla de oro de esta feature**: el import es el find-or-create de spec 09 **en lote**. NO crea un modelo de animal nuevo, NO crea un "evento colectivo", NO carga historial. La única tabla nueva es `import_log` (audit). El grueso del trabajo es **cliente** (parser puro + validación pura + UI de mapeo/preview); el delta de DB es mínimo (`import_log` + opcionalmente un RPC de bulk-insert si se valida la atomicidad/perf).

---

## 1. Resumen de capas y archivos

### 1.1 Cliente — parser/validación puros primero (testeables sin I/O), luego UI, luego escritura

| Archivo (kebab-case, `conventions.md`) | Capa | Qué hace | Cubre |
|---|---|---|---|
| `app/src/utils/import/parse-csv.ts` | util puro | Parsea CSV/Excel → `{ headers: string[], rows: string[][] }` con cap de filas/celdas ANTES de materializar todo (R3.3). Sin I/O. | R3.2, R3.3, R4.1 |
| `app/src/utils/import/parse-sigsa-txt.ts` | util puro | Parsea el TXT SIGSA (`RFID-SEXO-RAZA-MM/AAAA;…`) por **posición** → filas normalizadas. Sin I/O. | R6.2, R10.1 |
| `app/src/utils/import/column-mapping.ts` | util puro | Auto-detección de headers → campo del censo + aplicación del mapeo manual. | R4.1, R4.2 |
| `app/src/utils/import/normalize-row.ts` | util puro | Normaliza sexo (R4.3), fecha (R4.4), TAG (reusa `parser-rs420.ts` R4.5), raza (R6); aplica topes de largo (R3.4). | R3.4, R4.3, R4.4, R4.5, R6 |
| `app/src/utils/import/breed-senasa.ts` | util puro | Tabla de 32 códigos SENASA (seed inline de `razas-senasa-codigos.md`) → nombre best-effort; fallback al código. | R6.2 |
| `app/src/utils/import/validate-rows.ts` | util puro | Reglas de validez por fila (≥1 id ADR-005, sexo, topes) + dedup intra-archivo. | R5.1, R5.2, R7.1 |
| `app/src/utils/import/import-write.ts` (**as-built**) | util puro | Lógica PURA del armado/escritura (sin RN/expo/supabase, testeable `node:test`): merge del dedup contra existentes, `resolveCategory` (texto→code, el id lo resuelve el RPC), `normalizeLoteName`, `buildRpcRow` (shape del header `0074`), `chunkRows` (filas + IN-list del dedup), `summarizeErrorDetails` (presupuesto < CHECK 256KB), `checkFileSize` (R3.1), `escapeIlike` (R3.5). | R3.1, R3.5, R7, R10.3/R10.5, R11.5 |
| `app/src/services/import-rodeo.ts` | service (I/O) | Pre-check de dedup contra existentes (queries a Supabase, IN-list en sub-lotes URL-safe), escritura batch vía RPC `import_rodeo_bulk` en chunks, insert de `import_log` acotado, orquestación `confirmImport` (guard de conexión R12.2 → dedup → lotes → escritura → log). **Única capa que toca I/O.** Importa los utils puros de `import-write.ts`. | R7.2, R7.4, R8, R9, R11, R12.2 |

> **As-built (Fase 3) — split puro/I/O (patrón del repo `establishment-store.ts` ↔ `utils/establishment.ts`)**: la lógica testeable se extrajo a `import-write.ts` (sin imports RN/expo) porque el service importa `./supabase` → `expo-secure-store`, que NO carga bajo `node:test`. El service queda como capa I/O delgada. La orquestación end-to-end de la escritura (`confirmImport`) vive en el service y la llama el hook (Fase 4) tras la confirmación (R5.5); el hook le pasa las `CandidateRow[]` (ya parseadas/validadas con los utils puros) + un probe `isOnline` (NetInfo).
| `app/src/hooks/useImportRodeo.ts` | hook | Orquesta: pick archivo → parse → mapeo → validar → preview → confirmar → escribir → resultado. | R1.3, R5, R8 |
| `app/app/import-rodeo.tsx` (**as-built**: 1 ruta con 4 pasos internos, patrón `crear-rodeo`) | screen | Wizard completo: fuente+destino → mapeo (CSV/Excel) → preview → resultado. Una decisión por pantalla. | R1.3, R2, R4, R5, R8.3 |
| `app/src/components/Select.tsx` (**as-built**) | componente | Combo reutilizable (trigger pill + lista acordeón inline; web+native, sin portales). Lo consume el paso de mapeo. | R4.2 |
| `app/src/utils/import/import-ui.ts` (**as-built**) | util puro | Helpers de UI puros: normalización por mapeo, copy legible de errores (NUNCA sqlerrm crudo), modelo de preview, `buildColumnSamples` (muestra de datos por columna para el mapeo). | R4, R5.4 |
| Entry point en `RodeosScreen` (spec 02 C1, **reuso**) + flag de onboarding (spec 01/02, **reuso**) | screen (edición) | CTA "Importar rodeo". **No** se reimplementan los flujos. | R1.1, R1.2 |

> **Dependencia de coordinación (frontend en vuelo).** El entry point se cabla sobre la pantalla de Rodeos (spec 02 C1, committeada) y el onboarding (spec 01 Fase 4 / spec 02, committeados). Esta feature **reusa** esos flujos; si los nombres/firmas difieren al implementar, se adaptan los imports (no se duplica navegación). El pick de archivo usa `expo-document-picker` (managed workflow, ADR-002).

> **As-built (Fase 4) — mapeo SOURCE-DRIVEN (corrección de UX post-implementación).** La primera versión del paso de mapeo era FIELD-DRIVEN (una fila por campo del censo, el combo ofrecía los headers del archivo como opciones). Eso producía sinsentidos como "Caravana electrónica = sexo" (sexo es un header de la planilla), todos los combos ofrecían la misma lista de títulos, y el trigger `$white` sobre `$bg` no tenía afordancia de combo. Se reorientó al patrón estándar de import (estilo Expensify "Import categories"): **una fila por COLUMNA del archivo** (header + muestra de datos via `buildColumnSamples`) con un `Select` cuyas opciones son la lista FIJA de campos del censo + "Ignorar". Esto cumple mejor R4.1/R4.2 ("mapeo de cada columna del archivo a un campo del censo") y encaja con el modelo de datos (`mapping: (CensusField|null)[]` ya indexado por columna → `mapping[c]` es el campo de la columna `c`). El single-source lo sigue forzando `applyMappingOverride` (un campo en una sola columna); cuando un campo ya está en otra columna, su opción lleva un hint `en "<header>"`.

### 1.2 Backend (delta mínimo)

| Migration (**as-built**: `0073`/`0074`, aplicadas al remoto — el as-built en disco llegaba a `0072`) | Qué hace | Cubre |
|---|---|---|
| `0073_import_log.sql` | Tabla `import_log` (audit) + enum `import_file_format` + RLS scoped por establishment (SELECT `has_role_in`; INSERT owner/vet inline) + trigger `tg_force_imported_by_auth_uid` (`imported_by` forzado) + CHECK `char_length(file_name)≤255` + CHECK `octet_length(error_details::text)≤262144`. | R11 |
| `0074_import_rodeo_bulk_rpc.sql` (**FIRME** — Puerta 1 D2 = Escenario B, ver §6) | RPC `import_rodeo_bulk(p_rodeo_id, p_rows jsonb)` `SECURITY DEFINER` que re-valida owner/vet inline + deriva est/species/system∈rodeo, setea establishment_id/created_by/imported_by server-side, y hace el batch insert por fila (2 inserts animals→profile por animal). **Import parcial por-fila**: `begin...exception when unique_violation` por fila (una carrera se saltea + reporta, no aborta el chunk). `EXECUTE` revocado de public/anon, grant a `authenticated` + smoke-check fail-closed de grants (estilo `0055`/`0058`). Devuelve `jsonb { imported_ok, imported_errors, errors:[{row_index, reason}] }`. | R9.4, R8.1, R8.2, R8.4 |
| `supabase/tests/import/run.cjs` (runner Node, ADR-012) | **22 tests verde**: RLS de `import_log` (cross-tenant, imported_by forzado, field_operator/outsider rechazados, CHECKs) + RPC (owner/vet inserta; otro est / rodeo ajeno / rodeo inexistente / field_operator / anon rechazados; import parcial; TAG>64 dentro del definer). | R9, R11, R8.2 |

> **Contrato de `p_rows` (definido al implementar, ver `0074` header)**: cada fila lleva `row_index` (para reportar fallos) + los campos de identidad/censo (`sex`, `tag_electronic`, `birth_date`, `idv`, `visual_id_alt`, `breed`, `category_code`, `category_override`, `management_group_id`). El RPC **NO** lee `establishment_id`/`created_by`/`imported_by`/`species_id`/`system_id`/`rodeo_id` del payload — todo server-side desde el rodeo (A1-1/SEC-SPEC-03). El cliente (T3.3) arma este shape.

---

## 2. Modelo de datos

### 2.1 Escritura a `animals` / `animal_profiles` (sin schema nuevo)

El import escribe las MISMAS tablas que el alta individual de spec 02/09 (`animals.ts` `createAnimal`), por fila:

- **`animals`** (0019): `id` (UUID generado en cliente), `species_id` (del rodeo destino), `sex` (`male`/`female`), `tag_electronic` (válido o `NULL`), `birth_date` (o `NULL`).
- **`animal_profiles`** (0020): `id` (UUID cliente), `animal_id`, `establishment_id` (activo), `rodeo_id` (destino), `idv` (o `NULL`), `visual_id_alt` (o `NULL`), `breed` (texto libre), `category_id` (catálogo del sistema), `category_override` (true si vino de columna, false si "a completar"), `management_group_id` (o `NULL`), `status = 'active'`. `created_by` lo **fuerza** el trigger `tg_force_created_by_auth_uid` (0043).

**Constraints as-built que el dedup pre-chequea (R7) y la DB enforce (R9.5)**:
- `animals_tag_unique` (0019): `tag_electronic` único global donde no es `NULL` y no soft-deleted.
- `animal_profiles_idv_unique` (0020): `(establishment_id, idv)` único donde `idv` no es `NULL` y no soft-deleted.
- `animal_profiles_active_animal_unique` (0020): un solo perfil activo por `animal_id` (el import siempre crea `animals` nuevo, así que no colisiona salvo dedup contra existente).
- CHECK char_length (0070): `idv`≤64, `visual_id_alt`≤64, `breed`≤64, `coat_color`≤64, `tag_electronic`≤64 (en `animals`), `notes`≤4000, `entry_origin`≤120.

### 2.2 `import_log` (tabla nueva) — modelada sobre el patrón de tabla scoped de spec 02

Patrón tomado de `0029_lab_samples.sql` (tabla scoped por establishment con RLS + trigger de `created_by`/audit). SQL propuesto (el implementer ajusta el número de migration a ≥0073):

```sql
-- 00NN_import_log.sql  (spec 12 — R11)
-- Audit de cada corrida de importación masiva de rodeo. Scoped por establishment (RLS).
-- imported_by se FUERZA server-side (no se confía del cliente, lección A1-1 / created_by 0043).

create type public.import_file_format as enum ('csv', 'xlsx', 'sigsa_txt');

create table public.import_log (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  rodeo_id          uuid not null references public.rodeos(id),
  file_name         text not null,
  file_format       public.import_file_format not null,
  total_records     integer not null default 0,
  imported_ok       integer not null default 0,
  imported_errors   integer not null default 0,
  error_details     jsonb,
  imported_by       uuid references public.users(id),
  created_at        timestamptz not null default now(),
  -- R3.4 / R11.4: topes de largo server-side (espejo del patrón de 0070).
  constraint import_log_file_name_len_chk    check (char_length(file_name) <= 255),
  -- R11.4: tope del jsonb de detalle de errores (octet_length, mismo patrón que 0070 para jsonb).
  constraint import_log_error_details_size_chk check (octet_length(error_details::text) <= 262144)
);

comment on table public.import_log is
  'Audit de importaciones masivas de rodeo (spec 12). Scoped por establishment. imported_by forzado server-side.';

create index import_log_by_est on public.import_log (establishment_id, created_at desc);

-- R11.3: forzar imported_by = auth.uid() (no confiar el valor del cliente). Reusa el patrón
-- de tg_force_created_by_auth_uid (0043) pero sobre la columna imported_by.
create or replace function public.tg_force_imported_by_auth_uid ()
returns trigger language plpgsql as $$
begin
  new.imported_by := auth.uid();   -- ignora cualquier valor del payload del cliente
  return new;
end; $$;

create trigger import_log_set_imported_by
  before insert on public.import_log
  for each row execute function public.tg_force_imported_by_auth_uid();

alter table public.import_log enable row level security;

-- R11.2: solo owner/veterinarian (los que pueden importar, R2.4) pueden insertar; cualquier rol
-- activo puede leer el log de su establishment.
create policy import_log_select on public.import_log
  for select using (has_role_in(establishment_id));

create policy import_log_insert on public.import_log
  for insert with check (
    has_role_in(establishment_id)
    and (
      is_owner_of(establishment_id)
      -- No existe un helper genérico has_role(role, est) en el as-built (solo has_role_in /
      -- is_owner_of, verificado en 0005). El rol 'veterinarian' se chequea inline contra
      -- user_roles (mismo predicado que usan los helpers de 0005). Owner ya lo cubre is_owner_of.
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.establishment_id = import_log.establishment_id
          and ur.role = 'veterinarian'
          and ur.active = true
      )
    )
  );

grant select, insert on public.import_log to authenticated;
grant all on public.import_log to service_role;

notify pgrst, 'reload schema';
```

> **Helper de rol — verificado contra el as-built (no se inventa nada)**: el as-built (`0005`) define **solo** `has_role_in(est)` e `is_owner_of(est)`; **no** existe un `has_role(role, est)` genérico. Por eso la policy chequea `veterinarian` con un `exists (select 1 from user_roles ...)` inline (`user_roles` tiene `(user_id, establishment_id, role, active)`, unique-activo por par — `0003`). `is_owner_of` cubre el caso owner. **Alternativa de diseño** (si se adopta el RPC del Escenario B, §6): dejar la policy de INSERT en `has_role_in` y delegar la verificación owner/vet al RPC `SECURITY DEFINER`, que la hace antes de insertar — concentra la regla de rol en un solo lugar.

---

## 3. Flujo del importador (cliente)

```
ImportSourceScreen
  → elegir fuente: [CSV/Excel] | [TXT SIGSA]
  → pick archivo (expo-document-picker)
  → R3.1: rechazar si size > 5 MB (antes de leer contenido)
  → elegir rodeo destino (1 → fijo; ≥2 → selector)            [R2]
  → parse:
      CSV/Excel → parse-csv.ts (cap de filas R3.2/R3.3)
      TXT SIGSA → parse-sigsa-txt.ts (parse posicional R6.2)
  → R3.2: rechazar si #filas > 5000 (reporta, no trunca)
  → R3.6: si parse falla → abortar con mensaje, no escribir

Paso MAPEO del wizard (solo CSV/Excel) — SOURCE-DRIVEN (as-built)
  → auto-detección de headers (column-mapping.ts)             [R4.1]
  → una fila POR COLUMNA del archivo: header + muestra de
    datos (buildColumnSamples) + Select con los campos del
    censo (lista fija) — el operador ajusta el mapeo          [R4.2]

ImportPreviewScreen
  → normalize-row.ts por fila (sexo/fecha/TAG/raza/topes)     [R3.4, R4.3-4.5, R6]
  → validate-rows.ts: reglas por fila + dedup intra-archivo   [R5.1, R5.2, R7.1]
  → import-rodeo.ts: pre-check dedup contra existentes        [R7.2, R7.4]
  → preview: { válidas, errores (por motivo), duplicados }    [R5.3, R5.4]
  → confirmación explícita                                    [R5.5]
  → R5.6: si 0 válidas → informar, no escribir

(escritura)
  → import-rodeo.ts: escribe en batch las válidas+no-dup       [R8.1, R8.2]
  → insert import_log (conteos + error_details)               [R11]

ImportResultScreen
  → conteos finales + detalle de errores                      [R8.3]
```

### 3.1 Estrategia de escritura — split insert+select + batching (R8, RLS-on-RETURNING)

**Gotcha RLS-on-RETURNING (lección B.1.2/C1, documentada en `animals.ts`)**: NO usar `.insert().select()` en un roundtrip. El RETURNING evalúa la policy de SELECT sobre la fila antes de que sea visible (`animals_select` deriva de la existencia de un perfil con `has_role_in`) → riesgo de 403. **Mitigación**: generar los UUID en el cliente (`crypto.randomUUID()`, como `createAnimal`), insertar sin RETURNING, y no re-seleccionar. Esto resuelve además el find-or-create en lote sin roundtrips de lectura.

**Batching (escala cientos-a-miles, R3.2 tope 5000)**: las N filas válidas se escriben en **chunks** (ej. ~100-200 filas por request) para no mandar un payload gigante ni bloquear el hilo de UI. Entre chunks se cede el hilo (`InteractionManager`/microtask) y se muestra progreso ("escribiendo X de N…"). El import parcial (R8.2) se logra a nivel de chunk: si un chunk falla por una colisión que se coló por carrera (R8.4), se reporta esa fila y se sigue con el resto.

**Escritura por chunk — Escenario B (Puerta 1 D2): RPC `import_rodeo_bulk(p_rodeo_id, p_rows jsonb)` `SECURITY DEFINER`.** El cliente arma el chunk de filas válidas+no-dup (con UUIDs pre-generados que linkean perfil↔animal) y llama al RPC, que inserta el chunk **atómicamente server-side** (los 2 inserts `animals`→`animal_profiles` de cada animal en la misma transacción del statement → **sin huérfanos**, cierra el trade-off de `createAnimal`), re-validando authz adentro (§6-B: has_role_in owner/vet + rodeo∈establishment + campos forzados server-side + EXECUTE revocado de public/anon). El import parcial (R8.2) se logra a nivel de fila dentro del RPC: una fila que viola un unique (carrera, R8.4) se saltea y se reporta en el resultado del RPC, sin abortar el chunk (manejo por-fila con bloque de excepción, no un `insert ... select` que aborta todo el statement).

> **Descartado — inserts directos (Escenario A)**: dos statements por chunk reusando `animals_insert`/`animal_profiles_insert` de `0022`, sin SECURITY DEFINER. Dejaría `field_operator` habilitado a nivel DB (MEDIUM-3) y un `animals` huérfano si el insert del perfil falla. Raf eligió B en Puerta 1 por la atomicidad + el bloqueo de rol a nivel DB.

### 3.2 Dedup — pre-check contra constraints (R7)

```
intra-archivo (validate-rows.ts, puro):
  agrupar por idv no-vacío y por tag válido → grupos con >1 fila = conflicto "a completar" (R7.1)

contra existentes (import-rodeo.ts, I/O — reusa detección blanda spec 02 R5.5/R5.6 vía spec 09):
  - juntar todos los idv no-vacíos de las filas candidatas → 1 query:
      select idv from animal_profiles
       where establishment_id = $est and deleted_at is null and idv = any($idvs)
  - juntar todos los tag válidos → 1 query:
      select tag_electronic from animals
       where deleted_at is null and tag_electronic = any($tags)
  - marcar las filas cuyo idv/tag aparece en los resultados como duplicado-contra-existente (skip, R7.2)
  - TAG no reusable (R7.4): un tag que matchea un animal existente es SIEMPRE skip, nunca reasignación.
```

El pre-check usa `= any($array)` en lote (no una query por fila) para no martillar la DB con miles de roundtrips. La RLS scopea las queries de `idv` por `has_role_in`; el de `tag_electronic` es global (el unique de TAG es global por SENASA) — se chequea contra `animals` sin filtro de establishment, pero solo se lee la columna `tag_electronic` (no datos de otro tenant), consistente con el unique global de 0019.

> **As-built — IN-list en sub-lotes URL-safe**: el `.in($array)` de supabase-js arma un query-string GET; con hasta 5000 valores excedería el límite de URL de PostgREST. La IN-list se parte en sub-lotes de `DEDUP_IN_CHUNK=500` (lógica pura en `import-write.ts`) → unas pocas queries (10 para 5000 ids), URL-safe, SIGUE siendo en lote (no una por fila). El merge final lo hace `mergeDedupAgainstExisting` (puro, testeado): prioriza la colisión de TAG sobre la de IDV (TAG no reusable R7.4) y reporta una fila saltada UNA sola vez.

> **LOW-1 (Gate 1)**: el pre-check de TAG corre **bajo la RLS del usuario**, así que si un TAG ya existe en un `animals` de **otro** tenant (al que el usuario no tiene acceso), el pre-check da **falso-negativo** (no lo ve) y la fila intenta escribirse → la DB la rechaza por `animals_tag_unique` (global) y cae a R8.4 (skip + report de la fila). Esto es **correcto** (consistencia garantizada por el unique global, el usuario nunca ve data de otro tenant). El implementer NO debe "arreglar" este falso-negativo leyendo `animals` con **service-role** para anticipar la colisión cross-tenant — eso SÍ sería un leak de existencia de TAG entre tenants. Se deja como está: pre-check best-effort bajo RLS + la DB como red final (R9.5).

---

## 4. Parser de planillas — decisión + mitigación de seguridad (R3, reforzamiento 2)

> **Gate 1 va a mirar esto.** Parsear `.xlsx` en el cliente necesita una librería; SheetJS / `xlsx` tuvo CVEs reales (prototype pollution CVE-2023-30533, ReDoS). El design lo trata explícitamente como superficie de riesgo.

**DECISIÓN — Puerta 1 (Raf): `.xlsx` ENTRA al MVP, con parser vetado (R3.8). CSV primario; `.xlsx` con librería parcheada.**

1. **CSV es el camino primario y de menor riesgo.** Un parser CSV minimalista (split por líneas + comillas, sin eval) es trivial y sin dependencias pesadas. Se prefiere y se documenta en la UI ("exportá tu planilla a CSV") como ruta recomendada. **Alternativa de librería CSV**: `papaparse` (mantenida, streaming, sin la superficie de `.xlsx`), si el parser inline no cubre comillas/escapes raros.
2. **Excel (.xlsx) — SÍ en MVP (D1), con librería VETADA (R3.8)**: usar la distribución **oficial mantenida y parcheada** de SheetJS (`https://cdn.sheetjs.com/`, ≥0.20.2 — instalada por tarball del CDN, p.ej. `pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), **NO** la versión npm `xlsx` desactualizada/vulnerable (CVE-2023-30533 prototype pollution / CVE-2024-22363 ReDoS), o una librería equivalente auditada. Lectura en Expo: `expo-document-picker` da el URI → leer bytes (`expo-file-system`/fetch→arraybuffer) → `XLSX.read(data, { type: 'array' })`. Funciona en web + native (SheetJS es JS puro). **Gate 2 (code) verifica la versión sin CVE.** El enum `import_file_format` incluye `xlsx`.
3. **Cap defensivo ANTES de materializar (R3.3)**: el parser corta a `MAX_ROWS` (5000) y `MAX_CELLS_PER_ROW` durante la lectura, no después. Un archivo con 10^7 filas no se carga entero en memoria. Para `.xlsx`, acotar las dimensiones de la hoja (`!ref`) ANTES de iterar las celdas, no después de cargarlas.
4. **Todo valor parseado es no confiable (R3.5)**: no se interpreta como fórmula (un CSV con `=cmd()` es texto, no fórmula — no se reexporta a Excel), no se usa en `.or()`/filtros sin `escapeIlike`/neutralización de metacaracteres (mismo `escapeIlike` de `animals.ts` / F1-1 de spec 13), y los topes de largo (R3.4) lo acotan antes de tocar la DB.

**Riesgo + mitigación (tabla para Gate 1/Gate 2)**:

| Riesgo | Mitigación |
|---|---|
| CVE del parser `.xlsx` (prototype pollution / ReDoS) | **`.xlsx` en MVP (D1) → librería VETADA obligatoria** (SheetJS CDN ≥0.20.2, no npm vulnerable; R3.8) + cap de dimensiones de hoja antes de iterar + Gate 2 verifica la versión |
| DoW: archivo gigante congela la app / OOM | R3.1 (tope tamaño) + R3.3 (cap durante parseo, no después) |
| DoW: miles de filas martillan la DB | R3.2 (tope 5000) + escritura en chunks (§3.1) + pre-check de dedup en lote con `= any()` (§3.2) |
| Inyección vía valor de celda (filter injection) | R3.5 + `escapeIlike` (reuso F1-1) + topes server-side (0070) |
| Campo gigante (largo) que evade el cliente | R3.4 (cliente) + CHECK char_length 0070 (DB autoritativa, R9.5) |

---

## 5. Categorías — mapeo contra el catálogo AS-BUILT post-Tier-2 (R10.3/R10.5, reforzamiento 5)

El catálogo de `categories_by_system` para `(bovino, cría)` AS-BUILT (`0015` + `0059`) tiene estos `code`: `ternero`, `ternera`, `vaquillona`, `vaquillona_prenada`, `vaca_segundo_servicio`, `multipara`, `cut`, `vaca_cabana`, `toro`, `torito`, **`novillito`**, **`novillo`**. La resolución reusa el patrón de `animals.ts` `createAnimal`: `select id from categories_by_system where system_id = $sys and code = $code and active = true`.

- **Con columna de categoría que matchea un `code`** (R10.3): `category_id` = ese `code`, `category_override = true`. El override evita que el trigger de recálculo de ADR-008 (`compute_category`, `0062`) repinte la categoría declarada — correcto, porque en el import **no hay eventos** de los que derivar el estado biológico.
- **Sin columna / sin match** (R10.5): `category_id` debe ser una `category_id` válida del catálogo (la columna es `NOT NULL`). **Puerta 1 D3 = Raf lo cierra con Facundo.** Default **interino del implementer** hasta esa charla: usar la rama "sin birth_date, sin eventos" de `compute_category` (`0062`) por sexo — `torito`/`novillito` para machos, `vaquillona` para hembras — con `category_override = false` para que un evento posterior la pueda ajustar. **NO se infiere una categoría biológica fina en masa** (ternero vs vaca multípara) — el contexto lo prohíbe explícitamente ("no se infiere por sexo/edad… riesgo de mal asignar en masa"). El placeholder por sexo es solo para satisfacer el `NOT NULL`, marcado "a completar" vía `category_override = false`. Cuando Facundo defina el criterio (¿un code neutro único? ¿otra regla?), se ajusta sin reabrir la spec (es un default de una función pura + el RPC).

> **Match del nombre de categoría**: la columna del CSV trae texto del productor (ej. "vaca", "vaquillona", "novillo"). El match contra el `code`/`name` del catálogo es **best-effort** (normalizado a minúsculas/sin tilde, contra `code` y `name`); sin match → R10.5. La tabla de sinónimos es TENTATIVA hasta ver la planilla real (disclaimer, igual que R4.1).

---

## 6. Backend / Gates — ¿aplica Gate 1?

> Sección explícita pedida por el leader. Determinación de si el `security_analyzer` modo `spec` (Gate 1) aplica.

**El delta de DB tiene dos escenarios según la estrategia de escritura (§3.1):**

### Escenario A — inserts directos (sin RPC bulk)
- Delta de DB = **solo `import_log`** (tabla nueva + RLS + trigger `imported_by` + CHECK de largo).
- La escritura de `animals`/`animal_profiles` reusa las RLS/inserts ya existentes (`0022`), uno por uno por la policy de INSERT (mismo patrón que el alta individual de spec 02/09).
- **`rodeo_id ∈ establishment_id` lo enforça la DB en AMBOS escenarios** (Gate 1, verificado): el trigger `tg_animal_profiles_rodeo_check` (`0021`) valida que el `rodeo_id` pertenece al `establishment_id` del perfil a nivel DB, no-bypasseable. Por eso R9.2 (anti-cross-tenant) NO depende del RPC del Escenario B — vale igual con inserts directos.
- **Gate 1: SÍ aplica, pero acotado** (corrido 2026-06-06, **PASS 0 HIGH**, `progress/security_spec_12-import-rodeo.md`). Aunque no se introduce SECURITY DEFINER nuevo de escritura masiva, sí se crea una **tabla nueva con RLS** (`import_log`) y un trigger que fuerza autoría — superficie de multi-tenancy/authz que Gate 1 revisó (RLS scope OK, `imported_by` no spoofeable, policy de INSERT restringida a owner/vet).
- **MEDIUM-3 (Gate 1)**: en Escenario A, las RLS as-built de `animals`/`animal_profiles` (`0022`) dejan insertar a **cualquier rol con `has_role_in`** (incluido `field_operator`). La restricción "solo owner/vet importan" (R2.4) queda enforced en **UI + la policy de `import_log`**, NO a nivel DB para la escritura masiva de animales. Riesgo **bajo** (mismo-tenant; `field_operator` ya puede crear animales unitariamente por la misma policy). Es el **único** argumento de seguridad a favor del Escenario B. Si Raf quiere el bloqueo a nivel DB para la escritura masiva → Escenario B (RPC que re-valida owner/vet adentro).

### Escenario B — RPC `SECURITY DEFINER` de bulk-insert
- Delta de DB = `import_log` + **RPC `import_rodeo_bulk` SECURITY DEFINER**.
- **Gate 1: SÍ aplica, y es el punto MÁS sensible.** Un RPC SECURITY DEFINER que inserta en masa salteando las RLS por-fila debe re-validar adentro (R9.4):
  1. `has_role_in(p_establishment_id)` **con rol `owner` o `veterinarian`** (no cualquier rol);
  2. que `p_rodeo_id` pertenece a `p_establishment_id` (`select 1 from rodeos where id = p_rodeo_id and establishment_id = p_establishment_id`);
  3. que `establishment_id` y `created_by`/`imported_by` se setean **server-side** dentro del RPC (no se leen del payload de filas) — lección A1-1 / SEC-SPEC-03;
  4. que el RPC tiene `EXECUTE` revocado de `public`/`anon` y grant solo a `authenticated` (lección SEC-HIGH-01 de spec 02);
  5. que los topes de largo (0070) y los unique se siguen enforçando dentro del RPC (no se bypassean con `security definer`).
  6. *(Gate 2 SEC-12B-HIGH-01)* que el RPC enforça un **tope DURO de filas por llamada** (`jsonb_array_length(p_rows) <= 5000`, espejo de R3.2/D4) **después** de la re-validación de rol y **antes** del loop, rechazando el **batch entero** (no skip-and-report) si lo excede. El cap del cliente (R3.2/R3.3) es UX/bypasseable con curl; el RPC es la frontera server-side autoritativa contra DoW/amplificación (R9.5).

**DECISIÓN — Puerta 1 (Raf, 2026-06-06): Escenario B (RPC bulk `SECURITY DEFINER`).** Raf eligió B sobre la recomendación inicial del autor (A), priorizando atomicidad por animal (sin huérfanos) + bloqueo de `field_operator` a nivel DB para la escritura masiva (cierra MEDIUM-3 de Gate 1). El RPC `import_rodeo_bulk` es ahora parte FIRME del diseño (no condicional). **Los 6 controles del Escenario B (arriba — el 6to, el tope DURO de filas server-side, se agregó en Gate 2 SEC-12B-HIGH-01) son obligatorios y Gate 2 (code) los verifica**, con el matiz de Gate 1: el RPC lo llama el **cliente directo** → `grant execute to authenticated` + `revoke from public/anon` (NO service-role-only como el RPC de `0058`). Gate 1 ya revisó este escenario y dio **PASS** (los controles tienen precedente exacto en `0058`). **Gate 2 (code) aplica siempre**, como en todo run.

---

## 7. Offline-first y multi-tenant

- **Parseo/validación local, escritura online (R12.1)**: el parser y la validación corren en el cliente sin red (son utils puros). La escritura es online por diseño (es setup, no carga de campo) — **PowerSync no entra en esta feature**, consistente con ops de identidad de spec 09 R9.2. Si no hay conexión al confirmar, se informa y no se encola (R12.2).
- **Multi-tenant (R12.3)**: todo scoped al establecimiento activo del `EstablishmentContext`. `establishment_id` se fuerza del contexto (R9.1), el `rodeo_id` destino se valida ∈ establecimiento (R9.2), `import_log` y los animales respetan RLS. El archivo nunca dirige la escritura a otro establecimiento.
- **No offline ≠ viola offline-first**: el principio de offline-first aplica a **carga de datos en campo** (la manga sin señal). El import es una operación de **oficina/onboarding** (el productor sube su planilla con conexión), igual que crear campo/rodeo en spec 01/02 (online por spec). Documentado para el reviewer.

---

## 8. Alternativas descartadas (mínimo una, `docs/specs.md`)

**A. Un único insert masivo all-or-nothing (transacción única que aborta entera ante una fila mala) — DESCARTADA.** Modelar el import como una transacción que escribe todo o nada. Descartada porque: (1) el context lo prohíbe explícitamente ("un rodeo de cientos no debería fallar entero por 3 filas malas" → import parcial / skip-and-report); (2) obliga al productor a tener el archivo perfecto antes de cargar nada (fricción de onboarding inaceptable para el beta); (3) un archivo de miles de filas en una sola transacción es un lock largo + payload gigante (riesgo de timeout/DoW). El modelo elegido (chunks + skip-and-report + pre-check de dedup) deja entrar los buenos y reporta los malos.

**B. Importar también el historial (eventos/pesos/sanitario) en la misma corrida — DESCARTADA (fuera de MVP por Gate 0).** Modelar columnas de eventos en el archivo y escribir `weight_events`/`sanitary_events`/etc. al importar. Descartada porque: (1) el Gate 0 lo deja explícitamente fuera ("el import carga el padrón; el historial se acumula después por eventos/manga"); (2) los eventos disparan transiciones de categoría (ADR-008) — importar eventos en masa con `category_override` mezclado es una fuente de inconsistencia; (3) multiplica la complejidad de validación/dedup. El import es **censo de identidad**; el historial entra por la manga (spec 03) o carga unitaria (spec 09).

**C. Crear el lote (`management_group`) si no existe al mapear la columna — DESCARTADA (default Gate 0).** Auto-crear un `management_groups` por cada nombre de lote del archivo que no exista. Descartada porque el Gate 0 fijó el default "matchear por nombre existente, no crear" (crear lotes es owner-only y vive en la gestión de lotes de spec 02; auto-crearlos en masa desde un archivo no validado abre ruido de datos). Si el lote no existe, `management_group_id` queda `NULL` (R10.4) — el operador lo crea aparte y reasigna.

---

## 9. Decisiones abiertas / coordinación

| # | Tema | Decisión (Puerta 1, Raf, 2026-06-06) | Quién confirma |
|---|---|---|---|
| D1 | **Soporte `.xlsx` nativo en MVP** | **SÍ** — `.xlsx` entra al MVP con parser **vetado/parcheado** (SheetJS CDN ≥0.20.2, NO npm vulnerable), R3.8. CSV sigue primario. | ✅ Raf (Puerta 1) |
| D2 | **Estrategia de escritura: inserts directos vs RPC bulk** | **Escenario B** — RPC bulk `SECURITY DEFINER` (`import_rodeo_bulk`), R9.4 firme. Atomicidad por animal + bloqueo field_operator a nivel DB. | ✅ Raf (Puerta 1) |
| D3 | **Categoría placeholder "a completar"** (R10.5) | **Se cierra con Facundo.** Default interino del implementer: por sexo (torito/novillito | vaquillona) con `category_override = false`. | Raf / Facundo |
| D4 | **Topes de input** (R3.1/R3.2) | 5 MB / 5000 filas | ✅ Raf (Puerta 1, sin objeción) |
| D5 | **Roles que importan** | owner + veterinarian (field_operator NO) — del Gate 0 | confirmado (Gate 0) |
| D6 | **Helper de rol `veterinarian` en la policy de import_log** | confirmar `has_role`/inline contra as-built (0005/0006/0008); no inventar helper | implementer / Gate 1 |
| D7 | **Mapeo de columnas / sinónimos de la planilla real** | TENTATIVO hasta archivo del beta / validación con Facundo | Facundo |
| D8 | **Número de migration** | siguiente libre tras `0072` (≥ 0073) | implementer |

---

## 10. Trazabilidad design → requirements (resumen)

- §1.1 (cliente: parser/validación puros + UI) → R1.3, R3, R4, R5, R6, R7.1, R8, R10
- §1.2 + §2.2 (`import_log` + RPC condicional) → R9.4, R11
- §2.1 (escritura a animals/profiles + constraints) → R8.1, R9.5, R10.1, R10.2
- §3 (flujo + split insert+select + batching) → R5, R8, R12.1
- §3.2 (dedup pre-check) → R7
- §4 (parser + mitigación de seguridad) → R3.1, R3.2, R3.3, R3.5, R3.6
- §5 (categorías post-Tier-2) → R10.3, R10.5
- §6 (Backend / Gates — determinación Gate 1) → R9.4, condición de Puerta 1
- §7 (offline + multi-tenant) → R9.1, R9.2, R12
- §8/§9 (alternativas + decisiones abiertas) → R8.2, R10.4, R10.6
