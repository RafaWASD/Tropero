# Spec 08 — Exportación SIGSA — Design

**Status**: spec_ready
**Fecha**: 2026-06-13

## ⚠ Notas de diseño críticas antes de leer

1. **Gate duro de formato**: el formato exacto del TXT (trailing `;`, espacios, validación exacta de RFID en servidor) NO está confirmado con upload real. El generador del TXT es un módulo **aislado** y **swappable**. Ver sección "Módulo generador de TXT".

2. **Deltas cross-spec**: esta spec toca tablas de specs anteriores (`done`). Las migrations cross-spec se numeran **0107-0112** (la DB avanzó a `0106` desde la redacción del design — modelo reproductivo specs 02/03/07; los números 0089-0094 del design original ya están tomados). El implementer debe aplicarlas con cuidado: no hay risk de migration destructiva en las columnas nuevas (todas nullable o nuevas tablas), pero las migraciones best-effort de breed requieren revisión. **Mapa de renumeración**: 0107 breed_catalog · 0108 animal_profiles.breed_id · 0109 reproductive_events.breed_id · 0110 establishments.renspa · 0111 sigsa_declarations · 0112 export_log.

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
│  │  Migrations 0107..0112 (este spec):                  │    │
│  │   - breed_catalog (nuevo, 0107)                      │    │
│  │   - animal_profiles.breed_id FK (delta spec 02, 0108)│    │
│  │   - reproductive_events.breed_id FK (spec 02, 0109)  │    │
│  │   - establishments.renspa (delta spec 01, 0110)      │    │
│  │   - sigsa_declarations (nuevo)                       │    │
│  │   - export_log (nuevo)                               │    │
│  │   - RLS policies por tabla nueva                     │    │
│  │   - PowerSync sync config                            │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## SQL — Schema completo

### Migration 0107 — `breed_catalog` (tabla nueva + seed)

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

### Migration 0108 — `animal_profiles.breed_id` (delta spec 02)

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

> **AS-BUILT (reconciliado, impl 2026-06-24).** La herencia de R1.7 para el camino **MONO-ternero** se
> implementa AQUÍ (no en 0109): `CREATE OR REPLACE` del trigger `tg_reproductive_events_create_calf`
> (último as-built 0048) agregando `p.breed_id` al SELECT de la madre + `breed_id` al INSERT del
> `animal_profiles` del ternero. Byte-idéntico a 0048 salvo esas adiciones (preserva SECURITY DEFINER,
> search_path, y el `exception ... raise` de rollback atómico R9.4). El camino MELLIZOS (`register_birth`)
> se actualiza en 0109. Ver `progress/impl_08-sigsa-db.md` §Reconciliación.

### Migration 0109 — `reproductive_events.breed_id` (delta spec 02)

> **AS-BUILT (reconciliado, impl 2026-06-24).** Dos correcciones contra el schema real (ver
> `progress/impl_08-sigsa-db.md` §Reconciliación):
> 1. **`reproductive_events.breed` (texto libre) NO existe** → el `UPDATE` best-effort del diseño
>    original habría abortado con `column re.breed does not exist`. Verificado: `reproductive_events`
>    (0026) se creó sin `breed`; ninguna migración la agrega; el único `breed` cercano es
>    `semen_registry.breed`, otra tabla. La columna `breed_id` se agrega igual (R1.6 lo pide + la usa
>    el sync de PowerSync, T7), pero **se OMITE el UPDATE best-effort** (no hay columna fuente). Queda
>    forward-compat sin path de población automática en MVP.
> 2. **El trigger NO es `tg_create_calf_on_birth`** (no existe). El ternero al pie se crea por DOS
>    caminos: (a) MONO = trigger `tg_reproductive_events_create_calf` (último as-built 0048,
>    actualizado en **0108**); (b) MELLIZOS = RPC `register_birth` (último as-built 0075, actualizado
>    aquí en **0109**). La herencia de R1.7 va al `animal_profiles.breed_id` DEL TERNERO (texto de
>    R1.7), no a `reproductive_events.breed_id`. `register_birth` se redefine MÍNIMO (agrega
>    `p.breed_id` al SELECT de la madre + `breed_id` al INSERT de cada ternero), preservando byte-a-byte
>    el guard de idempotencia HIGH-D1, la authz de la fila real y los GRANT/REVOKE de 0075.

```sql
-- (1) breed_id FK nullable (R1.6). Forward-compat; coexiste con NADA (reproductive_events no tiene
-- breed texto libre, a diferencia de animal_profiles 0020).
ALTER TABLE public.reproductive_events
  ADD COLUMN IF NOT EXISTS breed_id uuid REFERENCES public.breed_catalog(id);

-- (2) Best-effort: NO-OP documentado. reproductive_events NO tiene columna `breed` → no hay nada que
-- matchear. El UPDATE del diseño original (WHERE re.breed IS NOT NULL ...) se OMITE (abortaría).

-- (3) Herencia de breed_id de la madre al ternero — camino MELLIZOS (R1.7): CREATE OR REPLACE de
-- register_birth (firma de 4 args de 0075) agregando p.breed_id al SELECT de la madre y breed_id al
-- INSERT de cada ternero del loop. (El camino MONO se actualiza en 0108.) Ver el .sql para el cuerpo
-- completo (idéntico a 0075 salvo las adiciones de breed_id).
```

### Migration 0110 — `establishments.renspa` (delta spec 01)

```sql
-- Campo RENSPA opcional en establecimientos
ALTER TABLE public.establishments
  ADD COLUMN renspa text;

-- ✅ DECISIÓN 3 CERRADA (Raf, 2026-06-24): texto opcional, SIN constraint de unicidad.
-- NO se crea índice unique (ni global ni por-dueño). El unique global causaba colisión + fuga
-- de existencia cross-tenant (LOW-4 de Gate 1) en casos legítimos (venta del campo, contador+dueño),
-- y el RENSPA NI VA EN EL TXT (R2.4, es solo recordatorio en pantalla). La unicidad como señal
-- anti-fraude queda POST-MVP, atada a la cardinalidad real del RENSPA (Facundo). Ver requirements.md
-- §"Decisiones abiertas" #3 + CONTEXT/07-pendientes.

-- Validación de longitud básica (única validación server-side de renspa)
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

### Migration 0111 — `sigsa_declarations` (tabla nueva)

```sql
CREATE TABLE public.sigsa_declarations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id  uuid        NOT NULL REFERENCES public.establishments(id) ON DELETE CASCADE,
  animal_profile_id uuid        NOT NULL REFERENCES public.animal_profiles(id) ON DELETE CASCADE,
  declared_at       timestamptz NOT NULL DEFAULT now(),
  export_log_id     uuid,       -- FK a export_log; se agrega AFTER migration 0112
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

### Migration 0112 — `export_log` (tabla nueva) + FK en sigsa_declarations

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
-- Mismo patrón que tg_force_created_by_auth_uid (0043) y sigsa_declarations_set_declared_by (0111).
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

### Migration 0113 — `derive breed_id from breed` (trigger, cierre del GAP breed_id / T18)

> **AS-BUILT (Run 3, impl 2026-06-25).** Cierra el GAP documentado en el changelog 2026-06-25 (el BreedPicker
> setea `animal_profiles.breed` TEXTO pero NO `breed_id` → ningún animal nuevo es exportable). Trigger
> `BEFORE INSERT OR UPDATE OF breed ON public.animal_profiles` que DERIVA `breed_id` desde `breed` por match
> de nombre normalizado contra `breed_catalog` (mismo criterio que la migración best-effort de 0108). El
> cliente (alta + ficha + import) escribe SOLO `breed` (el nombre); el trigger pone el `breed_id`. Centraliza
> la derivación en un solo lugar (no cambia firmas de RPC; arregla alta + import + edición uniformemente).
>
> **Guard de la herencia del ternero al pie (riesgo #1, verificado por test T18(c)):** el guard
> `NEW.breed IS NOT NULL` asegura que el trigger NO pise el `breed_id` heredado de la madre en el ternero al
> pie (que entra con `breed` NULL + `breed_id` seteado por 0108/0109). Con `breed` NULL NO se toca `breed_id`
> (sin rama ELSE que lo anule).
>
> **NO SECURITY DEFINER** (corre en contexto del writer; `breed_catalog` tiene SELECT abierto a authenticated)
> + `revoke execute` (defensa: no invocable como RPC, alinea con el patrón de las trigger-fns de 0084).
> **NO interfiere con compute_category** (`breed_id` no entra en el cálculo de categoría) ni con los otros
> `BEFORE ... OF <col>` (ortogonales por columna). **Sin recursión** (setear `NEW.breed_id` no re-dispara
> `OF breed`). Idempotente (`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`).

```sql
create or replace function public.tg_derive_breed_id_from_breed ()
returns trigger language plpgsql as $$
begin
  if new.breed is not null then
    new.breed_id := (
      select bc.id from public.breed_catalog bc
      where lower(trim(bc.name)) = lower(trim(new.breed))
      limit 1
    );
  end if;
  return new;
end; $$;

revoke execute on function public.tg_derive_breed_id_from_breed () from public, authenticated, anon;

drop trigger if exists animal_profiles_derive_breed_id on public.animal_profiles;
create trigger animal_profiles_derive_breed_id
  before insert or update of breed on public.animal_profiles
  for each row execute function public.tg_derive_breed_id_from_breed();
```

**Edición de raza en la ficha (parte B del cierre):** la ficha (`app/app/animal/[id].tsx`) agrega una fila
"Raza" editable (`BreedRow`) que abre el `BreedPickerSheet` (ya existente) → al elegir, hace un UPDATE
offline-safe de `animal_profiles.breed` (patrón CUT/0040: `buildSetBreedUpdate` → `runLocalWrite` → CrudEntry
PATCH → uploadData; service `setBreed`). El cliente actualiza SOLO `breed` (NUNCA `breed_id` — lo deriva el
trigger). Sin raza → CTA "Completá la raza para SIGSA". El RLS `animal_profiles_update` (has_role_in, 0022)
ya permite el UPDATE de `breed` a cualquier rol activo (mismo path que la CUT-ficha) — NO se crea policy nueva.

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

> **AS-BUILT (reconciliado, impl T7 2026-06-24).** Dos diferencias menores contra el snippet original
> (ver `progress/impl_08-sigsa-t7-powersync.md`):
> 1. **Nombre de la stream del catálogo: `catalog_breed`** (no `sigsa_breed_catalog`). Alinea con la
>    convención YA establecida de las globales del YAML, que TODAS empiezan con `catalog_`
>    (`catalog_species`, `catalog_systems`, `catalog_categories`, `catalog_field_definitions`,
>    `catalog_system_default_fields`). Las dos scope-establishment conservan `sigsa_declarations` /
>    `sigsa_export_log` (la primera espeja el nombre de su tabla; el design nombraba la 2da `sigsa_export_log`).
> 2. **El catálogo se sincroniza COMPLETO — se OMITE el `WHERE active = true`** (sugerencia del leader).
>    Razón: `breed_catalog` son 32 filas (volumen trivial); con el filtro, un animal con `breed_id` de una
>    raza inactiva (las 3 bubalinas `active=false`, o cualquier futura desactivación) NO recibiría su fila
>    en el SQLite local → el JOIN de la query de pendientes resolvería `senasa_code = NULL` → la UI mostraría
>    "raza desconocida" (edge F6 de Gate 1). Sincronizar todas evita ese edge sin costo de buckets (es 1
>    bucket global, independiente de campos). No expone nada: el catálogo es información pública del manual
>    SIGSA, sin `establishment_id`.

```yaml
  # ── SIGSA (spec 08) ────────────────────────────────────────────────────────────────
  catalog_breed:                               # catálogo GLOBAL read-only (convención catalog_*, sin `with:`)
    auto_subscribe: true
    queries:
      - SELECT * FROM breed_catalog            # COMPLETO (sin WHERE active = true): evita el edge F6 (32 filas)

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
supabase/migrations/0107_breed_catalog.sql
supabase/migrations/0108_animal_profiles_breed_id.sql
supabase/migrations/0109_reproductive_events_breed_id.sql
supabase/migrations/0110_establishments_renspa.sql
supabase/migrations/0111_sigsa_declarations.sql
supabase/migrations/0112_export_log.sql

app/src/services/sigsa/sigsa-txt-generator.ts     (módulo puro, swappable)
app/src/services/sigsa/sigsa-validator.ts          (validación pre-export)
app/src/services/sigsa/sigsa-export-service.ts     (orquestador I/O)
app/src/services/sigsa/types.ts                    (AnimalExportRecord, SigsaTxtOptions, etc.)

app/src/screens/sigsa/ExportSigsaScreen.tsx        (pantalla principal)
app/src/hooks/useExportSigsa.ts                    (hook de orquestación)
app/src/components/sigsa/BreedPicker.tsx            (selector de catálogo)
app/src/components/sigsa/SigsaChecklistReminder.tsx (checklist post-export)
app/src/components/sigsa/ExportAnimalRow.tsx        (fila de animal en lista)

supabase/tests/sigsa/run.cjs                       (tests RLS de tablas nuevas — convención REAL del repo: <area>/run.cjs registrado en scripts/run-tests.mjs, NO un .test.cjs suelto en rls/. AS-BUILT 2026-06-24)
app/src/services/sigsa/__tests__/sigsa-txt-generator.test.ts
app/src/services/sigsa/__tests__/sigsa-validator.test.ts
```

### Modificados (deltas cross-spec)

```
supabase/migrations/  -- migration 0108 toca animal_profiles (spec 02)
                      -- migration 0109 toca reproductive_events + trigger (spec 02)
                      -- migration 0110 toca establishments (spec 01)
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
          -- ⚠ RECONCILIACIÓN OFFLINE (leader 2026-06-24): la tabla `animals` (global) NO entra al
          -- sync set de PowerSync (ADR-026 / rafaq.yaml §"Entidades compartidas") → NO está en el
          -- SQLite local → un `JOIN animals` rompería la generación offline (viola R14). La identidad
          -- (tag_electronic/sex/birth_date) se lee de las columnas DENORMALIZADAS sobre animal_profiles
          -- (animal_tag_electronic/animal_sex/animal_birth_date, migración 0079, "swap T4"). El query
          -- usa SOLO animal_profiles + breed_catalog (global, sí sincroniza) + sigsa_declarations.
          SELECT ap.id, ap.animal_tag_electronic, ap.animal_sex, ap.animal_birth_date,
                 bc.senasa_code, ap.breed_id
          FROM animal_profiles ap
          LEFT JOIN breed_catalog bc ON bc.id = ap.breed_id
          LEFT JOIN sigsa_declarations sd
            ON sd.animal_profile_id = ap.id
           AND sd.establishment_id = ap.establishment_id
          WHERE ap.establishment_id = :estId
            AND ap.animal_tag_electronic IS NOT NULL
            AND sd.id IS NULL  -- no declarados
            AND ap.status = 'active'
            AND ap.deleted_at IS NULL
            AND (:rodeoId IS NULL OR ap.rodeo_id = :rodeoId)
            AND (:dateFrom IS NULL OR ap.animal_birth_date >= :dateFrom)
            AND (:dateTo IS NULL OR ap.animal_birth_date <= :dateTo)
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

**Decisión 1 (raza desconocida) — refinamiento del leader 2026-06-24**: `OR` (Otra Raza) está disponible como opción de un tap pero **NO se promueve** — se renderiza en su `sort_order` natural (28 = último entre las bovinas), con AA/H/PH/BG/BF arriba. Razón: bajo presión de manga, un `OR` promovido como "atajo rápido" se convertiría en el default perezoso y degradaría el benchmarking/analytics (uno de los 3 pilares del producto). El picker NO debe flotar `OR` al tope ni ofrecerlo como CTA destacada. `S/E` (Sin Especificar, `species='generic'`) queda **fuera** del picker bovino. (Pendiente Facundo, no bloqueante: ¿SENASA espera `OR` o `S/E` para desconocida en el flujo de declaración de dispositivos? Default interino: `OR`.)

---

## Alternativa descartada

**Tabla `sigsa_declared_at` en `animal_profiles` (columna directa) vs. tabla `sigsa_declarations` separada**

Se evaluó agregar directamente `sigsa_declared_at timestamptz` + `sigsa_export_log_id` como columnas en `animal_profiles`. Ventaja: query más simple (un solo JOIN menos). Desventaja crítica: la declaración es por **(establecimiento, animal)**, no por animal global. `animal_profiles` ya está scoped por establecimiento, así que funcionaría en MVP (un perfil por animal). Pero el problema es que si el mismo animal se transfiere a otro campo (spec 11, tabla `animal_profiles` nueva en el campo destino), el campo destino nace con `sigsa_declared_at = NULL` correctamente — OK hasta acá. La complicación es que `animal_profiles` ya tiene muchas columnas y el marcador de declaración es un concepto nuevo de dominio SENASA que no tiene que ver con los datos biológicos del animal. Una tabla separada `sigsa_declarations` con `UNIQUE(establishment_id, animal_profile_id)` es más limpia, evita null columns, facilita la query de pendientes con un LEFT JOIN, y es extensible (se puede agregar status de declaración, fecha de revisión, etc.). **Se elige la tabla separada.**

---

## Changelog

> Audit trail. No se borra.

- **2026-06-13 — Redacción inicial**.
- **2026-06-13 — AS-BUILT capa pura (T8/T9/T10)**: implementada la capa pura (terminal paralela colisión-safe). Precisión de contrato sobre el §"Módulo generador de TXT": el design solo tipaba el **generador** (`AnimalExportRecord` → `string`). AS-BUILT se agregó el contrato del **validador**: `validateForExport(animals: PendingAnimalInfo[]) → { exportable: AnimalExportRecord[]; incomplete: Array<{animalProfileId, reasons: ExportValidationReason[]}> }`, donde `PendingAnimalInfo` es la fila CRUDA de la query de pendientes (animals JOIN animal_profiles LEFT JOIN breed_catalog; campos nullables) y el validador la normaliza (sex `male`→`M`/`female`→`H`, `birth_date` ISO → `MM/AAAA` sin corrimiento de TZ, breedCode del catálogo). RFID validado con `/^\d{15}$/` (genérico, prefijo 032; **no** el `isValidTag` 982-prefijo del RS420). Razas reusan `isKnownBreedCode` de `import/breed-senasa.ts`. Tests **colocados** (no en `__tests__/` como decía §"Archivos a crear"). Reviewer APPROVED + Gate 2 PASS 0 HIGH. Detalle en `tasks.md` §AS-BUILT. Las capas de DB/PowerSync/UI (migrations 0089+, T7, T11-T20) siguen DIFERIDAS y gateadas.
- **2026-06-13 — Fold de Gate 1 (FAIL 2 HIGH/4 MEDIUM)**:
  - **HIGH-1**: agregados triggers `sigsa_declarations_set_declared_by` (migration 0093) y `export_log_set_generated_by` (migration 0094) que fuerzan `declared_by`/`generated_by = auth.uid()` server-side, ignorando el payload del cliente. Patrón: `tg_force_created_by_auth_uid` (0043) + `tg_force_imported_by_auth_uid` (0073).
  - **HIGH-2**: agregados constraints `export_log_file_content_size_chk` (5 MB, ~138k animales) y `export_log_file_name_len_chk` (255 chars) en la definición de `export_log` (migration 0094). Patrón: 0070 + 0073.
  - **MEDIUM-1**: resuelto "el implementer elige" — se opta por RPC `update_renspa(p_establishment_id, p_renspa)` SECURITY DEFINER con guard `is_owner_of` (migration 0092). La policy existente 0007 ya restringe UPDATE directo a owners; la RPC es la puerta de UI. Patrón: `soft_delete_rodeo` (0041).
  - **MEDIUM-2**: sync rules explícitas para `sigsa_declarations`, `export_log` y `breed_catalog` en `sync-streams/rafaq.yaml` siguiendo el patrón JOIN-free del repo. Scope: `org_scope` estándar (establishment_id IN user_roles activos). `file_content` no sobre-sincroniza a campos ajenos.
  - **MEDIUM-4**: WITH CHECK de `sigsa_declarations_insert` endurecido con EXISTS que verifica que `animal_profile_id` pertenece al `establishment_id` de la fila (previene IDOR cross-tenant).
  - **MEDIUM-3**: resuelto en tasks.md (test de guard de rol en T19) — no requería cambio de design.
- **2026-06-24 — Cierre de las 4 decisiones abiertas + renumeración de migraciones (leader, terminal dueña)**:
  - **Renumeración 0089-0094 → 0107-0112**: la DB avanzó a `0106` desde la redacción (modelo reproductivo specs 02/03/07); los números originales del design ya estaban tomados. Mapa: 0107 breed_catalog · 0108 animal_profiles.breed_id · 0109 reproductive_events.breed_id · 0110 establishments.renspa · 0111 sigsa_declarations · 0112 export_log. Actualizadas todas las cabeceras de migración, el diagrama de arquitectura, los cross-refs internos (incl. el comentario del trigger en 0112 → 0111) y la lista de "Archivos a crear". Los números 0089-0094 en el **changelog histórico** (entradas del 2026-06-13) se dejan como estaban (audit trail no se reescribe); esta entrada los supersede.
  - **Decisión 3 (RENSPA) CERRADA — relajada a texto opcional sin unique**: removido el `CREATE UNIQUE INDEX idx_establishments_renspa_active` de la migración 0110. Queda solo el `CHECK` de largo (1-20) + la RPC `update_renspa` (sin cambios). Razón: colisión/fuga cross-tenant en casos legítimos + el RENSPA no va en el TXT. Anti-fraude por unicidad = POST-MVP (Facundo). NO reabre Gate 1 (saca superficie).
  - **Decisión 1 (raza desconocida)**: refinamiento en §BreedPicker — `OR` disponible pero NO promovido (sort_order natural, no degradar analytics).
  - **Decisiones 2 y 4**: sin cambio de design (2 = backend ya cubierto; 4 = proceso/gate de `done`). Copy de markAsDeclared y riesgo "upload real = declaración legal" anotados en requirements + tasks.
- **2026-06-24 — AS-BUILT capa DB (migraciones 0107-0112, T1-T6)**: implementadas las 6 migraciones + la suite RLS `supabase/tests/sigsa/run.cjs` (hook **comentado** en run-tests.mjs hasta el apply del leader). `node scripts/check.mjs` verde. **NO aplicadas al remoto** (deploy gateado por el leader). Dos reconciliaciones contra el schema real (detalle en `progress/impl_08-sigsa-db.md`):
  - **El trigger del design (`tg_create_calf_on_birth`) NO existe.** El ternero al pie se crea por DOS caminos: MONO = trigger `tg_reproductive_events_create_calf` (último as-built 0048) → herencia de R1.7 inyectada en **0108**; MELLIZOS = RPC `register_birth` (último as-built 0075, firma 4 args) → herencia inyectada en **0109**. Ambas redefiniciones verificadas con `diff` contra el as-built: minimales (solo `breed_id`), preservan la lógica de seguridad (guard idempotencia HIGH-D1, authz de la fila real de la madre, rollback atómico R9.4, GRANT/REVOKE). La herencia va al `animal_profiles.breed_id` DEL TERNERO (texto de R1.7).
  - **`reproductive_events.breed` (texto libre) NO existe** → el `UPDATE` best-effort de R1.6/0109 era un no-op que habría abortado la migración (`column re.breed does not exist`). Se agrega la columna `breed_id` (R1.6 lo pide + la usa el sync T7) pero se **omite el UPDATE**. Columna forward-compat sin populación automática en MVP. Reconciliado en §"Migration 0109", nota bajo R1.6 en requirements.md.
  - **Cross-check del seed (breed_catalog ↔ `import/breed-senasa.ts` ↔ razas-senasa-codigos.md)**: PASA 1:1, 32 pares código↔nombre idénticos en los 3, sin discrepancia.
  - **Idempotencia**: todas las migraciones re-corribles (`IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP ... IF EXISTS` / `ON CONFLICT DO NOTHING`).
  - **RLS (read-only catalog)**: `breed_catalog` con SELECT-only a authenticated + `grant all` a service_role, sin policies de escritura — mismo patrón verificado contra `categories_by_system` (0015).
- **2026-06-25 — AS-BUILT capa de servicio + hook (T11/T12/T19/T20)**: implementado el boundary de I/O `app/src/services/sigsa/sigsa-export-service.ts` + el hook `app/src/hooks/useExportSigsa.ts` + los SQL builders puros en `powersync/local-reads.ts` + suite `app/src/services/sigsa/sigsa-export-service.test.ts` (23 tests node:sqlite, registrada en run-tests.mjs). `pnpm typecheck` verde + 23/23 tests nuevos + 217/217 de las suites adyacentes (local-reads/maneuver-reads/schema/sigsa puras). NO se corrió `check.mjs` completo (flake conocido del leader en el Animal suite — huérfano `tag_electronic='9'`). Reconciliaciones contra el design (detalle en `progress/impl_08-sigsa-service.md`):
  - **Query de pendientes SIN `JOIN animals`** (ya reconciliado por el leader en §"Flujo de datos"): `buildPendingSigsaAnimalsQuery` lee SOLO `animal_profiles` (identidad denormalizada b1/0079: `animal_tag_electronic`/`animal_sex`/`animal_birth_date`) + `LEFT JOIN breed_catalog` + `LEFT JOIN sigsa_declarations` (sd.id IS NULL = pendiente). Verificado por test que el SQL NO contiene `\banimals\b`. El `animal_birth_date` es `date` (0079) → PowerSync lo materializa como `YYYY-MM-DD` → el filtro de rango por string es chronológico-correcto e inclusivo (R9.3). NO consulta el overlay `pending_*` (la declaración aplica sobre el inventario REAL sincronizado).
  - **`saveAndShare` usa el File API v56** (`new File(Paths.cache, name).create()/.write(content)` + `Sharing.shareAsync(file.uri)`), NO el `FileSystem.writeAsStringAsync` legacy que citaba §"Flujo de datos" (deprecado en expo-file-system 56; el repo ya usa el File API en useImportRodeo). UTF-8 sin BOM (R5.6): `File.write(string)` no antepone BOM. Se **agregó la dependencia `expo-sharing` (~56.0.16 → 56.0.18)** al `app/package.json` (no estaba instalada; el design la asumía). `Sharing.isAvailableAsync()` evita lanzar donde no hay share (web).
  - **`persistDeclarations(profileIds, exportLog, establishmentId)`** — el design tipaba `persistDeclarations(animals, exportLogEntry, …)`, pero el `AnimalExportRecord` limpio (de `validateForExport`) NO porta `animalProfileId`. AS-BUILT: recibe `profileIds: string[]` (los ids de los exportables, que el hook deriva alineados 1:1 con los records = pendientes cuyo id NO está en `incomplete`, en orden) + `ExportLogInput` (metadata). Inserta 1 `export_log` (con `id` de cliente) y N `sigsa_declarations` ligadas a ese `export_log_id`, en ese orden (FIFO de la upload queue). **NO manda `declared_by`/`generated_by`** (los fuerzan los triggers 0111/0112; verificado por test que las columnas no aparecen en el INSERT).
  - **`markAsDeclared` (T19)**: INSERT de 1 `sigsa_declarations` con `export_log_id = NULL` (distingue la marca manual del export con archivo). Copy de la UI fijado en el código: "Marcar como ya declarado por otro medio" (decisión 2, leader 2026-06-24). El RLS owner/vet + IDOR-check + 42501 a field_operator (MEDIUM-3) son la barrera al SUBIR (no el cliente).
  - **`redownload` (T20)**: `buildExportLogContentQuery` (SELECT read-only de `file_content`/`file_name` por id) → `saveAndShare`. NO inserta declaraciones (verificado por test: el SQL no contiene INSERT/UPDATE/DELETE). Métodos de soporte agregados: `fetchExportHistory` + `buildExportLogHistoryQuery` (lista del historial sin `file_content`, orden `generated_at DESC`, R10.1) — la UI del historial (T16) los consumirá.
  - **Nombre de archivo (R5.3)**: `buildFileName` produce `sigsa_<slug>_<YYYYMMDD_HHMMSS>.txt` (con SEGUNDOS → único por export del día, evita colisión; slug NFD+lowercase+hyphenate acotado a 80 chars, dentro del CHECK ≤255). Corregido contra una primera versión que usaba `-` y solo la fecha.
  - **Contrato del local write (T5/spec 15)**: el write local SIEMPRE devuelve ok offline (R14.1); el reject de RLS (field_operator que intenta exportar/declarar — owner/vet only) lo resuelve `uploadData` (descarta + superficia por status), NO el return del service. Mismo patrón que management-groups.ts/sessions.ts. NUNCA se hardcodea `establishment_id` (CLAUDE.md ppio 6): llega por param del EstablishmentContext.
- **2026-06-25 — ⚠ FIX DE CONTRATO DE UPLOAD (superficie COMPARTIDA del connector PowerSync)**: el connector subía TODO el CRUD-plano por `.upsert()` (= `INSERT … ON CONFLICT DO UPDATE`), que EXIGE privilegio UPDATE aunque no haya conflicto. `sigsa_declarations`/`export_log` son append-only (`GRANT SELECT, INSERT` solamente, sin policy UPDATE — R11.3) → el upsert daba **42501 → descarte silencioso → la feature 08 estaba ROTA end-to-end** (ninguna declaración ni export_log llegaba al server; cazado al agregar un assert server-side al e2e de markAsDeclared, no quedándose en la UI). **Fix**: `isAppendOnlyInsertTable` (Set de 2 tablas) en `upload-classify.ts` → `buildCrudUpsert` marca `insertOnly` → el connector ejecuta `.insert()` plano (solo grant INSERT). **Retry-safe**: un reintento PowerSync (at-least-once) del mismo INSERT da 23505 → `isPermanentServerCode` lo clasifica permanente → el connector lo DESCARTA (no re-lanza, no loop) → la fila ya está = idempotente en efecto (sin outbox trabada). **Quirúrgico**: ninguna otra tabla cambia de rama (custom_attributes PK-compuesta y el resto mantienen su `.upsert()`/`onConflict`). Preserva la auditoría no-spoofeable (sin UPDATE de cliente + triggers force-auth.uid). **Nota de diseño**: el GRANT-sin-UPDATE de 0111/0112 (correcto para R11.3) es INCOMPATIBLE con el `.upsert()` default de PowerSync — toda tabla append-only sincronizada debe rutearse por insert en el connector. reviewer APPROVED + Gate 2 PASS sobre el cambio (superficie compartida verificada: no afecta otras tablas, 23505-discard no filtra datos).
- **2026-06-25 — AS-BUILT UI (T13-T18 + R10.2 + R9.3)**: pantalla flagship `app/app/export-sigsa.tsx` (card-resumen + filtros colapsables rodeo+fecha + tabs Listos/A-completar/Historial + estados + **CTA sticky-bottom** + checklist post-export) + `ExportAnimalRow` + `SigsaChecklistReminder` (4 datos SENASA + plazo 10 días hábiles, prepopula RENSPA si está, R13.3) + `BreedPickerSheet` (buscable, `sort_order`, "sin raza" primero, `OR` no promovido — decisión 1) + integración en `crear-animal.tsx` (T18) + CTA/edición de RENSPA (campo en editar-campo vía RPC `update_renspa` + banner en `/mas`, T17) + `renspa` en el schema LOCAL de establishments. **Decisiones de diseño del leader** (Raf delegó: "elegí la mejor y seguí"): terracota "N a completar" → `$textMuted` (no es alerta); CTA export → sticky-bottom (acción primaria, lista potencialmente larga, thumb-zone); markAsDeclared → action-sheet por fila Listos (R10.2 MVP); filtro fechas R9.3 con validación inline (no banner global); metadata categoría/rodeo en fila → diferida post-MVP. Veto design-review del leader PASS (capturas `design/veto-sigsa-{export,run2}/`). reviewer APPROVED + Gate 2 PASS.
- **2026-06-25 — GAP de breed_id (T18 parcial) → plan Run 3 (migración + Gate 1)**: el BreedPicker en el alta setea el `breed` TEXTO-LIBRE (nombre exacto del catálogo), NO `breed_id` — la RPC `create_animal` (0083, pre-spec-08) no tiene `p_breed_id` y `upload.ts` no lo pasa; además no hay pantalla de edición de animal para fijar `breed_id` en animales existentes. **Sin esto, ningún animal nuevo obtiene `breed_id` → aparece "Falta la raza" → no exportable, y el link "A completar → ficha" no tiene dónde completar.** **Decisión del leader (la mejor, centralizada — evita cambiar firmas de RPC y arregla alta+import+edición uniformemente)**: una migración nueva (Run 3) con un **trigger** `BEFORE INSERT OR UPDATE OF breed ON animal_profiles` que DERIVA `breed_id` desde `breed` por match de nombre exacto al catálogo (`lower(trim(name)) = lower(trim(NEW.breed))`), con **guard `NEW.breed IS NOT NULL`** para NO pisar el `breed_id` heredado de la madre en el ternero al pie (que entra con `breed` NULL + `breed_id` seteado). El BreedPicker setea el nombre EXACTO → el trigger deriva el id. + afordancia de editar raza en la ficha (`[id].tsx`) que hace un UPDATE de `breed` offline-safe (patrón CUT/0040) → el trigger deriva `breed_id`. La migración toca el write-path de animal_profiles → **Gate 1 obligatorio** + deploy gateado. (T18 se cierra con Run 3.)
- **2026-06-25 — AS-BUILT Run 3 (cierre del GAP breed_id / T18)**: implementado el plan de arriba.
  - **Migración 0113** `0113_derive_breed_id_from_breed.sql`: trigger `tg_derive_breed_id_from_breed`
    (`BEFORE INSERT OR UPDATE OF breed ON animal_profiles`) — DERIVA `breed_id` del `breed` (nombre) por match
    normalizado contra `breed_catalog`. Guard `NEW.breed IS NOT NULL` preserva el `breed_id` heredado del
    ternero al pie. NO SECURITY DEFINER + `revoke execute`. Idempotente. Sección SQL agregada arriba (Migration
    0113). **NO aplicada al remoto** (deploy gateado por el leader; pendiente Gate 1 puntual + apply).
  - **Edición de raza en la ficha**: `app/app/animal/[id].tsx` — `BreedRow` (fila "Raza" editable: CTA
    "Completá la raza para SIGSA" si no hay raza, valor + link "Cambiar" si la hay) → abre el `BreedPickerSheet`
    (reusado de Run 2) → `onSelectBreed` persiste `breed` (nombre) vía `setBreed` (animals.ts) →
    `buildSetBreedUpdate` (local-reads.ts, patrón CUT/0040, UPDATE offline-safe de `animal_profiles.breed`,
    NUNCA breed_id). Optimismo en sitio + revert + refresh silencioso (mismo patrón que onAssignLote/onSetCastrated).
    Catálogo de razas cargado con `fetchBreedCatalog` (one-shot `useEffect`). RLS `animal_profiles_update`
    (has_role_in, 0022) ya permite el UPDATE de `breed` — verificado, NO se inventa policy.
  - **Helper puro `breedCodeForName`** (breed-picker.ts): name → senasa_code (espeja el match del trigger),
    para resolver el `selectedCode` del picker desde el `breed` (nombre) guardado en la ficha.
  - **Tests**: trigger (6 casos: match/nomatch/guard-herencia/UPDATE-re-deriva/UPDATE-a-NULL/case-insensitive)
    en `supabase/tests/sigsa/run.cjs` (§T18) — **gated al apply de 0113** (igual que T1-T6 esperaron 0107-0112).
    Unit: `breedCodeForName` (breed-picker.test.ts) + `buildSetBreedUpdate` (local-reads.test.ts) — verdes ahora.
    e2e (`sigsa-breed-renspa.spec.ts`): alta con raza → server-side assert breed_id=AA derivado + ficha-edit
    completa raza → server-side assert breed='Hereford'+breed_id=H — **los asserts de breed_id gated al apply**
    (el flujo UI funciona ya; capturado en `design/veto-sigsa-run3/`). `pnpm typecheck` verde. NO se corrió
    check.mjs completo (flake Animal suite + el suite SIGSA §T18 falla hasta el apply de 0113).
  - **R1.4** queda CUBIERTO end-to-end (alta + ficha setean breed → trigger deriva breed_id → exportable);
    cierra el loop "A completar → completar" (R8.2/R8.3). El `breed_id` en el SQLite local queda stale tras el
    UPDATE local hasta el re-sync (benigno: la ficha muestra `breed`, el export lee el set sincronizado).
