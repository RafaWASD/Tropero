# Spec 08 — Exportación SIGSA — Design

**Status**: spec_ready
**Fecha**: 2026-06-13

## ⚠ Notas de diseño críticas antes de leer

1. **Gate duro de formato**: el formato exacto del TXT (trailing `;`, espacios, validación exacta de RFID en servidor) NO está confirmado con upload real. El generador del TXT es un módulo **aislado** y **swappable**. Ver sección "Módulo generador de TXT".

2. **Deltas cross-spec**: esta spec toca tablas de specs anteriores (`done`). Las migrations cross-spec se numeran como 0089+, arrancan donde dejó 0088. El implementer debe aplicarlas con cuidado: no hay risk de migration destructiva en las columnas nuevas (todas nullable o nuevas tablas), pero las migraciones best-effort de breed requieren revisión.

3. **Offline-first**: la generación del TXT es 100% local (SQLite de PowerSync). Los inserts post-generación (`sigsa_declarations`, `export_log`) van por la cola de sync.

---

## Arquitectura general

```
┌─────────────────────────────────────────────────────────────┐
│  React Native (Expo) + TypeScript                            │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  ExportSigsaScreen                                    │    │
│  │  useExportSigsa hook (orquesta validación + gen + share) │    │
│  │  SigsaExportService (boundary de I/O)                │    │
│  │  SigsaTxtGenerator (módulo AISLADO, puro/swappable)  │    │
│  │  SigsaValidator (validación pre-export)              │    │
│  └──────────────────────────────────────────────────────┘    │
│                          ↓                                   │
│         supabase-js + PowerSync client (SQLite local)        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│  Supabase                                                    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Migrations 0089..0096+ (este spec):                 │    │
│  │   - breed_catalog (nuevo)                            │    │
│  │   - animal_profiles.breed_id FK (delta spec 02)      │    │
│  │   - reproductive_events.breed_id FK (delta spec 02)  │    │
│  │   - establishments.renspa (delta spec 01)            │    │
│  │   - sigsa_declarations (nuevo)                       │    │
│  │   - export_log (nuevo)                               │    │
│  │   - RLS policies por tabla nueva                     │    │
│  │   - PowerSync sync config                            │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## SQL — Schema completo

### Migration 0089 — `breed_catalog` (tabla nueva + seed)

```sql
-- Tabla de catálogo de razas con códigos SENASA oficiales
CREATE TABLE public.breed_catalog (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  senasa_code text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  species     text        NOT NULL DEFAULT 'bovine',  -- 'bovine' | 'bubaline' | 'generic'
  active      boolean     NOT NULL DEFAULT true,
  sort_order  int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Catálogo de solo lectura para clientes
ALTER TABLE public.breed_catalog ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.breed_catalog TO authenticated;

CREATE POLICY "breed_catalog_select_authenticated"
  ON public.breed_catalog
  FOR SELECT TO authenticated
  USING (true);

-- Seed: 28 razas bovinas (grafías LITERALES del manual SIGSA v2.42.80, tabla 1 de razas-senasa-codigos.md)
-- sort_order: razas pampeanas frecuentes van primero (para el picker)
INSERT INTO public.breed_catalog (senasa_code, name, species, active, sort_order) VALUES
  ('AA',  'Aberdeen Angus',    'bovine', true,  1),
  ('H',   'Hereford',          'bovine', true,  2),
  ('PH',  'Polled Hereford',   'bovine', true,  3),
  ('BG',  'Brangus',           'bovine', true,  4),
  ('BF',  'Braford',           'bovine', true,  5),
  ('SH',  'Shorthorn',         'bovine', true,  6),
  ('CH',  'Charolais',         'bovine', true,  7),
  ('L',   'Limousine',         'bovine', true,  8),
  ('LA',  'Limangus',          'bovine', true,  9),
  ('CR',  'Criolla',           'bovine', true,  10),
  ('GC',  'Ganado Cruza',      'bovine', true,  11),
  ('HA',  'Holando Argentino', 'bovine', true,  12),
  ('B',   'Brahman',           'bovine', true,  13),
  ('MG',  'Murray Grey',       'bovine', true,  14),
  ('G',   'Galloway',          'bovine', true,  15),
  ('W',   'Wagyu',             'bovine', true,  16),
  ('SF',  'Seneford',          'bovine', true,  17),
  ('SG',  'Santa Gertrudis',   'bovine', true,  18),
  ('SA',  'Senangus',          'bovine', true,  19),
  ('SP',  'Senepol',           'bovine', true,  20),
  ('FS',  'Simmental',         'bovine', true,  21),
  ('J',   'Jersey',            'bovine', true,  22),
  ('K',   'Kiwi',              'bovine', true,  23),
  ('BO',  'Bosmara',           'bovine', true,  24),  -- grafía del manual
  ('SRB', 'Sueca Roja y Blanca','bovine',true,  25),
  ('TL',  'Tuli',              'bovine', true,  26),
  ('SI',  'San Ignacio',       'bovine', true,  27),
  ('OR',  'Otra Raza',         'bovine', true,  28),
  -- Genérico y bubalinas (fuera de scope bovino MVP)
  ('S/E', 'Sin Especificar',   'generic', true,  99),
  ('ME',  'Mediterranea',      'bubaline', false, 100),
  ('JA',  'Jafarabadi',        'bubaline', false, 101),
  ('MU',  'Murrah',            'bubaline', false, 102);
```

### Migration 0090 — `animal_profiles.breed_id` (delta spec 02)

```sql
-- Agrega breed_id FK nullable (coexiste con breed texto libre legacy)
ALTER TABLE public.animal_profiles
  ADD COLUMN breed_id uuid REFERENCES public.breed_catalog(id);

-- Migración best-effort: intenta matchear el texto libre de breed al catálogo
-- Solo asigna cuando hay match exacto (case-insensitive, trim); sin match = NULL
UPDATE public.animal_profiles ap
SET breed_id = bc.id
FROM public.breed_catalog bc
WHERE ap.breed_id IS NULL
  AND ap.breed IS NOT NULL
  AND lower(trim(ap.breed)) = lower(trim(bc.name));

-- Índice para queries de export (filtra por establishment + breed_id)
CREATE INDEX idx_animal_profiles_breed_id ON public.animal_profiles(breed_id)
  WHERE breed_id IS NOT NULL;

-- RLS no cambia: breed_id hereda las policies de animal_profiles (ya scoped por establishment_id)
```

### Migration 0091 — `reproductive_events.breed_id` (delta spec 02)

```sql
-- Agrega breed_id para el ternero al parto (coexiste con breed texto libre)
ALTER TABLE public.reproductive_events
  ADD COLUMN breed_id uuid REFERENCES public.breed_catalog(id);

-- Migración best-effort análoga
UPDATE public.reproductive_events re
SET breed_id = bc.id
FROM public.breed_catalog bc
WHERE re.breed_id IS NULL
  AND re.breed IS NOT NULL
  AND lower(trim(re.breed)) = lower(trim(bc.name));

-- Actualiza trigger de ternero al pie para heredar breed_id de la madre
-- (el trigger existente 'tg_create_calf_on_birth' debe actualizarse para
--  copiar animal_profiles.breed_id de la madre al profile del ternero)
-- El implementer ajusta el trigger existente en esta misma migration.
```

### Migration 0092 — `establishments.renspa` (delta spec 01)

```sql
-- Campo RENSPA opcional en establecimientos
ALTER TABLE public.establishments
  ADD COLUMN renspa text;

-- Unicidad parcial (solo entre establecimientos no borrados)
CREATE UNIQUE INDEX idx_establishments_renspa_active
  ON public.establishments(renspa)
  WHERE renspa IS NOT NULL AND deleted_at IS NULL;

-- Validación de longitud básica
ALTER TABLE public.establishments
  ADD CONSTRAINT chk_establishments_renspa_length
  CHECK (renspa IS NULL OR (char_length(trim(renspa)) > 0 AND char_length(renspa) <= 20));

-- Policy adicional: solo owner puede UPDATE renspa.
-- DECISIÓN (MEDIUM-1, Gate 1): se implementa vía RPC SECURITY DEFINER `update_renspa`
-- (mismo patrón que soft_delete_rodeo / soft_delete_management_group en 0041).
-- NO se crea policy UPDATE nueva más permisiva: la policy existente `establishments_update`
-- (0007, `is_owner_of(id)`) ya restringe cualquier UPDATE de la tabla entera a owners.
-- La RPC es la puerta recomendada de UI; el UPDATE directo vía PostgREST ya está cubierto
-- por esa policy (veterinarian/field_operator reciben 42501 si lo intentan directamente).

CREATE OR REPLACE FUNCTION public.update_renspa (
  p_establishment_id uuid,
  p_renspa           text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Guard de rol: solo owner (mismo que la policy establishments_update 0007)
  IF NOT public.is_owner_of(p_establishment_id) THEN
    RAISE EXCEPTION 'only owner can update renspa' USING ERRCODE = '42501';
  END IF;
  UPDATE public.establishments
  SET renspa = p_renspa
  WHERE id = p_establishment_id AND deleted_at IS NULL;
END; $$;

COMMENT ON FUNCTION public.update_renspa(uuid, text) IS
  'RPC SECURITY DEFINER: actualiza establishments.renspa; solo owner (R2.3). '
  'Patrón: guard is_owner_of + UPDATE, mismo que soft_delete_rodeo (0041).';

-- Solo authenticated puede ejecutar; revocar a public/anon (PostgreSQL default no otorga, pero se hace explícito)
REVOKE EXECUTE ON FUNCTION public.update_renspa(uuid, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.update_renspa(uuid, text) TO authenticated;
```

### Migration 0093 — `sigsa_declarations` (tabla nueva)

```sql
CREATE TABLE public.sigsa_declarations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id  uuid        NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  animal_profile_id uuid        NOT NULL REFERENCES public.animal_profiles(id) ON DELETE CASCADE,
  declared_at       timestamptz NOT NULL DEFAULT now(),
  export_log_id     uuid,       -- FK a export_log; se agrega AFTER migration 0094
  declared_by       uuid        NOT NULL REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(establishment_id, animal_profile_id)
);

ALTER TABLE public.sigsa_declarations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.sigsa_declarations TO authenticated;

-- SELECT: cualquier rol activo en el establishment
-- (la tabla es append-only inmutable, R11.3 — no hay deleted_at que filtrar)
CREATE POLICY "sigsa_declarations_select"
  ON public.sigsa_declarations
  FOR SELECT TO authenticated
  USING (public.has_role_in(establishment_id));

-- INSERT: solo owner o veterinarian; + verifica que animal_profile_id pertenece al establishment_id
-- (MEDIUM-4, Gate 1: IDOR — sin este EXISTS un owner del campo A podría insertar un animal_profile_id del campo B)
CREATE POLICY "sigsa_declarations_insert"
  ON public.sigsa_declarations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_in(establishment_id) AND
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.establishment_id = sigsa_declarations.establishment_id
        AND ur.role IN ('owner', 'veterinarian')
        AND ur.active = true
    ) AND
    -- MEDIUM-4: verificar que el animal_profile_id pertenece al establishment_id de esta fila
    EXISTS (
      SELECT 1 FROM public.animal_profiles ap
      WHERE ap.id = sigsa_declarations.animal_profile_id
        AND ap.establishment_id = sigsa_declarations.establishment_id
        AND ap.deleted_at IS NULL
    )
  );

-- Sin UPDATE ni DELETE desde el cliente (append-only, R11.3)

-- HIGH-1 (Gate 1): forzar declared_by = auth.uid() server-side (no confiar el valor del cliente).
-- Mismo patrón que tg_force_created_by_auth_uid (0043) y tg_force_imported_by_auth_uid (0073):
-- "lección A1-1 / created_by 0043". Ignora cualquier UUID que venga en el payload del cliente.
CREATE OR REPLACE FUNCTION public.tg_force_declared_by_auth_uid()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.declared_by := auth.uid();  -- ignora cualquier valor del payload del cliente
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.tg_force_declared_by_auth_uid() IS
  'Trigger BEFORE INSERT: FUERZA declared_by = auth.uid() (ignora el valor del cliente). '
  'Audit trail SENASA no-spoofeable (R3.5, R11.2). Patrón: 0043 + 0073.';

CREATE TRIGGER sigsa_declarations_set_declared_by
  BEFORE INSERT ON public.sigsa_declarations
  FOR EACH ROW EXECUTE FUNCTION public.tg_force_declared_by_auth_uid();

-- Índice para la query de pendientes
CREATE INDEX idx_sigsa_declarations_est_profile
  ON public.sigsa_declarations(establishment_id, animal_profile_id);
```

> **Nota**: `sigsa_declarations` no tiene `deleted_at` porque es un registro inmutable append-only (R11.3). Si se quiere "desmarcar", es un caso de corrección administrativa fuera de scope MVP. El SELECT **no** filtra por `deleted_at` (la columna no existe); si se agrega soft-delete post-MVP, actualizar la policy. *(Fix de veto del leader 2026-06-13: la policy original referenciaba `deleted_at IS NULL` sobre columna inexistente → habría fallado al crear la tabla.)*

### Migration 0094 — `export_log` (tabla nueva) + FK en sigsa_declarations

```sql
CREATE TABLE public.export_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid        NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  generated_by     uuid        NOT NULL REFERENCES auth.users(id),
  animal_count     int         NOT NULL,
  file_name        text        NOT NULL,
  file_content     text        NOT NULL,  -- contenido del TXT para re-descarga
  rodeo_filter_id  uuid        REFERENCES public.rodeos(id) ON DELETE SET NULL,
  date_from        date,
  date_to          date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- HIGH-2 (Gate 1): topes server-side autoritativos contra storage exhaustion (patrón 0070).
  -- file_content: ~36 chars/animal × 138.889 animales ≈ 5 MB. Si el establecimiento supera ese
  -- techo, debe hacer exports parciales por rodeo o rango de fechas. Se usa octet_length
  -- (bytes del TXT UTF-8) en línea con el patrón de 0070 para columnas de crecimiento proporcional.
  CONSTRAINT export_log_file_content_size_chk CHECK (octet_length(file_content) <= 5000000),
  -- file_name viene del slug del establecimiento (R5.3); 255 chars como import_log (0073).
  CONSTRAINT export_log_file_name_len_chk     CHECK (char_length(file_name) <= 255)
);

ALTER TABLE public.export_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.export_log TO authenticated;

CREATE POLICY "export_log_select"
  ON public.export_log
  FOR SELECT TO authenticated
  USING (public.has_role_in(establishment_id));

CREATE POLICY "export_log_insert"
  ON public.export_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_in(establishment_id) AND
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.establishment_id = export_log.establishment_id
        AND ur.role IN ('owner', 'veterinarian')
        AND ur.active = true
    )
  );

-- Sin UPDATE ni DELETE desde el cliente

-- HIGH-1 (Gate 1): forzar generated_by = auth.uid() server-side (no confiar el valor del cliente).
-- Mismo patrón que tg_force_created_by_auth_uid (0043) y sigsa_declarations_set_declared_by (0093).
CREATE OR REPLACE FUNCTION public.tg_force_generated_by_auth_uid()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.generated_by := auth.uid();  -- ignora cualquier valor del payload del cliente
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.tg_force_generated_by_auth_uid() IS
  'Trigger BEFORE INSERT: FUERZA generated_by = auth.uid() (ignora el valor del cliente). '
  'Audit trail SENASA no-spoofeable (R4.2, R11.1). Patrón: 0043 + 0073.';

CREATE TRIGGER export_log_set_generated_by
  BEFORE INSERT ON public.export_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_force_generated_by_auth_uid();

-- Agrega FK de sigsa_declarations a export_log (ahora que export_log existe)
ALTER TABLE public.sigsa_declarations
  ADD CONSTRAINT fk_sigsa_declarations_export_log
  FOREIGN KEY (export_log_id) REFERENCES public.export_log(id) ON DELETE SET NULL;

CREATE INDEX idx_export_log_establishment ON public.export_log(establishment_id, generated_at DESC);
```

---

## RLS — Resumen de policies por tabla nueva

| Tabla | SELECT | INSERT | UPDATE | DELETE | Notas de seguridad |
|---|---|---|---|---|---|
| `breed_catalog` | `authenticated` (global) | ❌ cliente | ❌ cliente | ❌ cliente | — |
| `sigsa_declarations` | `has_role_in(est_id)` | `owner`/`vet` + IDOR-check | ❌ cliente | ❌ cliente | `declared_by` forzado por trigger (HIGH-1); WITH CHECK verifica que `animal_profile_id` pertenece al `establishment_id` (MEDIUM-4) |
| `export_log` | `has_role_in(est_id)` | `owner`/`vet` | ❌ cliente | ❌ cliente | `generated_by` forzado por trigger (HIGH-1); `file_content` tope 5 MB, `file_name` tope 255 chars (HIGH-2) |
| `establishments.renspa` | hereda policies spec 01 | — | solo `owner` vía RPC `update_renspa` (MEDIUM-1) | — | La policy existente 0007 ya bloquea UPDATE directo a no-owners; la RPC es la puerta de UI recomendada |
| `animal_profiles.breed_id` | hereda policies spec 02 | — | hereda spec 02 | — | — |

Todas las tablas nuevas con `establishment_id` usan el helper `has_role_in(establishment_id)` (patrón establecido en spec 01, ADR-004).

---

## Módulo generador de TXT (aislado y swappable)

El formato exacto de SIGSA no está verificado con upload real. Por eso el generador es un **módulo TypeScript puro** que:

1. Recibe `AnimalExportRecord[]` (datos ya validados y normalizados).
2. Devuelve `string` (el contenido del TXT).
3. Es **independiente del dominio**: no hace queries a DB, no conoce PowerSync, no tiene efectos.
4. Tiene una interfaz mínima para ser reemplazable cuando se confirme el formato exacto.

```typescript
// app/src/services/sigsa/sigsa-txt-generator.ts
export interface AnimalExportRecord {
  rfid: string;         // 15 dígitos numéricos (ya validado)
  sex: 'M' | 'H';
  breedCode: string;    // código SENASA exacto (ej. 'AA', 'H', 'BG')
  birthMonthYear: string; // formato 'MM/AAAA' (ej. '08/2025')
}

export interface SigsaTxtOptions {
  trailingSemicolon?: boolean;  // GATE DURO: false por default hasta confirmar
}

export function generateSigsaTxt(
  records: AnimalExportRecord[],
  options: SigsaTxtOptions = {}
): string {
  // implementar aquí
}
```

El `SigsaExportService` orquesta: leer de PowerSync → validar (`SigsaValidator`) → llamar al generador → escribir al sistema de archivos → share sheet → insertar en `sigsa_declarations` + `export_log`.

### Alternativa descartada: generar el TXT en una Edge Function

**Por qué se descartó**: la generación del TXT es puramente local (no requiere datos del server que no estén ya en el SQLite local); una Edge Function introduciría latencia, dependencia de red (viola offline-first), y complejidad innecesaria. La única razón para usar Edge Function aquí sería validar permisos server-side antes de generar, pero eso ya lo hace RLS al momento de insertar `export_log` + `sigsa_declarations`. El generador local + inserts vía PowerSync es el patrón correcto para este stack.

---

## PowerSync — sync scope

Tablas nuevas a agregar al scope de PowerSync:

| Tabla | Scope | Sync direction |
|---|---|---|
| `breed_catalog` | global (todos los usuarios autenticados) | read-only |
| `sigsa_declarations` | `establishment_id IN org_scope` (solo campos con rol activo) | bidireccional (insert local → sync) |
| `export_log` | `establishment_id IN org_scope` (solo campos con rol activo) | bidireccional (insert local → sync) |

`breed_catalog` usa el bucket global (mismo patrón que `species`, `categories_by_system` en spec 02).

### Sync rules explícitas para `rafaq.yaml` (MEDIUM-2, Gate 1)

Las sync rules deben definirse explícitamente en `sync-streams/rafaq.yaml` siguiendo el patrón JOIN-free
establecido en spec 15. `sigsa_declarations` y `export_log` contienen datos sensibles (TXT con RFIDs,
marcadores de declaración SENASA): el scope debe ser **el mismo `org_scope` que las demás tablas
per-establishment**, no más amplio.

```yaml
  # ── SIGSA (spec 08) ────────────────────────────────────────────────────────────────
  sigsa_breed_catalog:                         # catálogo global, read-only
    auto_subscribe: true
    queries:
      - SELECT * FROM breed_catalog WHERE active = true

  sigsa_declarations:                          # scoped por establishment (org_scope)
    auto_subscribe: true                       # el TXT con RFIDs NO debe sobre-sincronizarse
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - SELECT * FROM sigsa_declarations WHERE establishment_id IN org_scope

  sigsa_export_log:                            # scoped por establishment (org_scope)
    auto_subscribe: true                       # file_content (TXT completo) es dato sensible
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - SELECT * FROM export_log WHERE establishment_id IN org_scope
```

**Justificación de scope**: `export_log.file_content` contiene el TXT completo con todos los RFIDs del
lote exportado. Un usuario con rol en N campos recibiría los TXT de TODOS sus campos en el SQLite local
si se usara un scope más amplio o mal definido. El `org_scope` estándar del repo (join-free, trigger 0076
garantiza campos vivos) es el scope correcto y suficiente.

`sigsa_declarations` no tiene `deleted_at` (tabla append-only, R11.3): la stream no filtra `deleted_at`,
igual que `est_animal_category_history` en el YAML existente.

---

## Archivos a crear / modificar

### Nuevos

```
supabase/migrations/0089_breed_catalog.sql
supabase/migrations/0090_animal_profiles_breed_id.sql
supabase/migrations/0091_reproductive_events_breed_id.sql
supabase/migrations/0092_establishments_renspa.sql
supabase/migrations/0093_sigsa_declarations.sql
supabase/migrations/0094_export_log.sql

app/src/services/sigsa/sigsa-txt-generator.ts     (módulo puro, swappable)
app/src/services/sigsa/sigsa-validator.ts          (validación pre-export)
app/src/services/sigsa/sigsa-export-service.ts     (orquestador I/O)
app/src/services/sigsa/types.ts                    (AnimalExportRecord, SigsaTxtOptions, etc.)

app/src/screens/sigsa/ExportSigsaScreen.tsx        (pantalla principal)
app/src/hooks/useExportSigsa.ts                    (hook de orquestación)
app/src/components/sigsa/BreedPicker.tsx            (selector de catálogo)
app/src/components/sigsa/SigsaChecklistReminder.tsx (checklist post-export)
app/src/components/sigsa/ExportAnimalRow.tsx        (fila de animal en lista)

supabase/tests/rls/sigsa.test.cjs                  (tests RLS de tablas nuevas)
app/src/services/sigsa/__tests__/sigsa-txt-generator.test.ts
app/src/services/sigsa/__tests__/sigsa-validator.test.ts
```

### Modificados (deltas cross-spec)

```
supabase/migrations/  -- migration 0090 toca animal_profiles (spec 02)
                      -- migration 0091 toca reproductive_events + trigger (spec 02)
                      -- migration 0092 toca establishments (spec 01)
supabase/config.toml  -- agregar breed_catalog, sigsa_declarations, export_log al sync scope
app/src/services/powersync/schema.ts  -- agregar tablas nuevas al schema PowerSync
sync-streams/rafaq.yaml               -- agregar streams sigsa_breed_catalog, sigsa_declarations, sigsa_export_log (MEDIUM-2)
```

---

## Flujo de datos — Export

```
ExportSigsaScreen
  → useExportSigsa.prepareExport(filters)
    → SigsaExportService.queryPendingAnimals(establishmentId, filters)
      → PowerSync (SQLite local): 
          SELECT ap.id, a.tag_electronic, a.sex, a.birth_date,
                 bc.senasa_code, ap.breed_id
          FROM animal_profiles ap
          JOIN animals a ON a.id = ap.animal_id
          LEFT JOIN breed_catalog bc ON bc.id = ap.breed_id
          LEFT JOIN sigsa_declarations sd 
            ON sd.animal_profile_id = ap.id 
           AND sd.establishment_id = ap.establishment_id
          WHERE ap.establishment_id = :estId
            AND a.tag_electronic IS NOT NULL
            AND sd.id IS NULL  -- no declarados
            AND ap.status = 'active'
            AND ap.deleted_at IS NULL
            AND (:rodeoId IS NULL OR ap.rodeo_id = :rodeoId)
            AND (:dateFrom IS NULL OR a.birth_date >= :dateFrom)
            AND (:dateTo IS NULL OR a.birth_date <= :dateTo)
  → SigsaValidator.validate(animals)
    → separa exportables vs. "a completar"
  → [usuario decide exportar los que pasan]
  → SigsaTxtGenerator.generateSigsaTxt(exportableRecords, options)
    → string content
  → SigsaExportService.saveAndShare(content, fileName)
    → FileSystem.writeAsStringAsync (expo-file-system)
    → Sharing.shareAsync (expo-sharing) → share sheet nativa
  → SigsaExportService.persistDeclarations(exportableRecords, exportLogEntry)
    → PowerSync INSERT export_log (1 fila)
    → PowerSync INSERT sigsa_declarations (N filas, una por animal)
      → cola de sync → Supabase cuando hay internet
  → ExportSigsaScreen muestra checklist recordatorio (SigsaChecklistReminder)
```

---

## UX — Pantalla de exportación

La pantalla `ExportSigsaScreen` tiene tres secciones:

1. **Filtros** (rodeo, rango de fecha, colapsables): permite acotar el conjunto de pendientes.
2. **Lista de animales**: dos tabs o secciones — "Listos para exportar" y "A completar" (con indicación del dato faltante por animal). Cada fila tiene `ExportAnimalRow` con tag, categoría, rodeo y badge de estado.
3. **Botón de exportación**: habilitado cuando hay al menos un animal en "Listos". Genera el archivo y abre el share sheet.

Post-share, `SigsaChecklistReminder` se muestra en un modal o banner con los 4 datos que el productor debe completar en SIGSA web.

**Acceso al historial**: botón/tab "Historial" en la misma pantalla, lista las entradas de `export_log` con fecha, cantidad, quién generó, y botón de re-descarga.

### BreedPicker

El `BreedPicker` es el selector de raza para el form de animal. Lee el `breed_catalog` desde el SQLite local (PowerSync). Muestra las razas ordenadas por `sort_order` (pampeanas primero). Si el animal tiene `breed` texto libre legacy sin `breed_id`, muestra un aviso "completar raza para poder exportar a SIGSA" con el picker prefiltrado.

---

## Alternativa descartada

**Tabla `sigsa_declared_at` en `animal_profiles` (columna directa) vs. tabla `sigsa_declarations` separada**

Se evaluó agregar directamente `sigsa_declared_at timestamptz` + `sigsa_export_log_id` como columnas en `animal_profiles`. Ventaja: query más simple (un solo JOIN menos). Desventaja crítica: la declaración es por **(establecimiento, animal)**, no por animal global. `animal_profiles` ya está scoped por establecimiento, así que funcionaría en MVP (un perfil por animal). Pero el problema es que si el mismo animal se transfiere a otro campo (spec 11, tabla `animal_profiles` nueva en el campo destino), el campo destino nace con `sigsa_declared_at = NULL` correctamente — OK hasta acá. La complicación es que `animal_profiles` ya tiene muchas columnas y el marcador de declaración es un concepto nuevo de dominio SENASA que no tiene que ver con los datos biológicos del animal. Una tabla separada `sigsa_declarations` con `UNIQUE(establishment_id, animal_profile_id)` es más limpia, evita null columns, facilita la query de pendientes con un LEFT JOIN, y es extensible (se puede agregar status de declaración, fecha de revisión, etc.). **Se elige la tabla separada.**

---

## Changelog

> Audit trail. No se borra.

- **2026-06-13 — Redacción inicial**.
- **2026-06-13 — Fold de Gate 1 (FAIL 2 HIGH/4 MEDIUM)**:
  - **HIGH-1**: agregados triggers `sigsa_declarations_set_declared_by` (migration 0093) y `export_log_set_generated_by` (migration 0094) que fuerzan `declared_by`/`generated_by = auth.uid()` server-side, ignorando el payload del cliente. Patrón: `tg_force_created_by_auth_uid` (0043) + `tg_force_imported_by_auth_uid` (0073).
  - **HIGH-2**: agregados constraints `export_log_file_content_size_chk` (5 MB, ~138k animales) y `export_log_file_name_len_chk` (255 chars) en la definición de `export_log` (migration 0094). Patrón: 0070 + 0073.
  - **MEDIUM-1**: resuelto "el implementer elige" — se opta por RPC `update_renspa(p_establishment_id, p_renspa)` SECURITY DEFINER con guard `is_owner_of` (migration 0092). La policy existente 0007 ya restringe UPDATE directo a owners; la RPC es la puerta de UI. Patrón: `soft_delete_rodeo` (0041).
  - **MEDIUM-2**: sync rules explícitas para `sigsa_declarations`, `export_log` y `breed_catalog` en `sync-streams/rafaq.yaml` siguiendo el patrón JOIN-free del repo. Scope: `org_scope` estándar (establishment_id IN user_roles activos). `file_content` no sobre-sincroniza a campos ajenos.
  - **MEDIUM-4**: WITH CHECK de `sigsa_declarations_insert` endurecido con EXISTS que verifica que `animal_profile_id` pertenece al `establishment_id` de la fila (previene IDOR cross-tenant).
  - **MEDIUM-3**: resuelto en tasks.md (test de guard de rol en T19) — no requería cambio de design.
