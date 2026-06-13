# Security Review — Spec 08 / export-sigsa — Modo: spec (Gate 1)

**Fecha**: 2026-06-13
**Analista**: security_analyzer
**Input**: `specs/active/08-export-sigsa/{context,requirements,design,tasks}.md`
**Veredicto**: FAIL

---

## Veredicto y resumen ejecutivo

**FAIL — 2 findings HIGH, 3 MEDIUM.**

Dos problemas bloqueantes:
1. El schema de `export_log` y `sigsa_declarations` acepta que el cliente envíe `generated_by` / `declared_by` con cualquier UUID y no tiene trigger que lo fuerce a `auth.uid()`. La tabla análoga (`import_log`, migración 0073) resolvió exactamente este problema con `tg_force_imported_by_auth_uid`. La spec 08 omite ese patrón, creando un vector de audit spoofing.
2. El campo `export_log.file_content` (el TXT completo con RFID + datos de animales de otro tenant) no tiene tope de tamaño server-side, lo que expone un vector de storage exhaustion por amplificación (un export de N animales inserta el TXT completo en la DB sin límite).

Los tres MEDIUM son remediables en la spec antes de implementar.

---

## Findings HIGH

### HIGH-1 — Audit spoofing en `generated_by` / `declared_by`: ausencia del patrón `tg_force_*_auth_uid`

**Severidad**: HIGH
**Dominio**: A2 (mass assignment / over-posting) + I2 (audit tamper-evidence)
**Archivo**: `design.md` → Migrations 0093 y 0094; `tasks.md` → T5, T6

**Evidence**:

`design.md` líneas 200-228 (migración 0093, `sigsa_declarations`):
```sql
CREATE TABLE public.sigsa_declarations (
  ...
  declared_by  uuid NOT NULL REFERENCES auth.users(id),
  ...
);
```
No hay trigger `BEFORE INSERT` que fuerce `declared_by = auth.uid()`.

`design.md` líneas 234-278 (migración 0094, `export_log`):
```sql
CREATE TABLE public.export_log (
  ...
  generated_by  uuid NOT NULL REFERENCES auth.users(id),
  ...
);
```
No hay trigger `BEFORE INSERT` que fuerce `generated_by = auth.uid()`.

El INSERT va vía PowerSync desde el cliente (R14.2, `design.md` línea 421: "PowerSync INSERT export_log → PowerSync INSERT sigsa_declarations"). PowerSync serializa el payload del cliente y lo envía a Supabase. El campo `declared_by`/`generated_by` viene en ese payload tal como lo armó el cliente. Si el cliente puede poner un UUID arbitrario, pasa a `auth.users(id)` como FK válida (cualquier UUID registrado en `auth.users` es un target potencial).

**Patrón correcto ya existente en el repo** (migración 0073, `import_log`):
```sql
-- 0073: "imported_by se FUERZA server-side (no se confía del cliente)"
create trigger import_log_set_imported_by
  before insert on public.import_log
  for each row execute function public.tg_force_imported_by_auth_uid();
```
Y la función ya creada en 0043: `tg_force_created_by_auth_uid()`.

El comentario en `0073_import_log.sql` lo dice explícito: _"lección A1-1 / created_by 0043"_. La spec 08 no replica esta lección para sus dos tablas de audit trail.

**Por qué es HIGH y no MEDIUM**: las tablas `sigsa_declarations` y `export_log` son el audit trail regulatorio (Res. 841/2025). Si `declared_by`/`generated_by` son spoofeable desde el cliente, un usuario puede imputar declaraciones a otro usuario del mismo tenant (o de otro, si consigue su UUID), invalidando el trail de evidencia. En una declaración ante SENASA, el "quién declaró" tiene peso legal. Además, cualquier usuario con rol `owner`/`vet` puede INSERT directo vía PostgREST (no solo vía PowerSync), y el spoofing no requiere ningún exploit especial.

**Fix recomendado**:
En `design.md` migrations 0093 y 0094, agregar triggers análogos a `import_log`:
```sql
-- En migration 0093 (sigsa_declarations):
CREATE TRIGGER sigsa_declarations_set_declared_by
  BEFORE INSERT ON public.sigsa_declarations
  FOR EACH ROW EXECUTE FUNCTION public.tg_force_created_by_auth_uid();

-- En migration 0094 (export_log):
CREATE TRIGGER export_log_set_generated_by
  BEFORE INSERT ON public.export_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_force_created_by_auth_uid();
```
En `tasks.md` T5 y T6, agregar test: _"(h) `declared_by`/`generated_by` siempre refleja `auth.uid()` aunque el payload del cliente envíe un UUID diferente"_.

---

### HIGH-2 — `export_log.file_content` sin tope de tamaño server-side (storage exhaustion por amplificación)

**Severidad**: HIGH
**Dominio**: E1 (queries sin tope) + E2 (denial-of-wallet) + F (input injection)
**Archivo**: `design.md` línea 241; `requirements.md` R4.1, R4.3; patrón de referencia: `0070_check_text_length_caps.sql`

**Evidence**:

`design.md` líneas 237-247:
```sql
CREATE TABLE public.export_log (
  ...
  file_content  text NOT NULL,  -- contenido del TXT para re-descarga
  ...
);
```
No hay `CHECK` de largo sobre `file_content`. No hay ningún constraint en la spec ni en `tasks.md` T6.

El contenido del TXT es `N × 36 bytes/registro` (un registro RFID-SEXO-RAZA-MM/AAAA tiene 30-36 chars). Un tenant con 50.000 animales genera un TXT de ~1.8 MB por export. Cada generación inserta ese TXT completo en la DB (`export_log.file_content`). Con N exports (ej. un usuario genera el mismo export 100 veces, que la spec permite en R3.4/R10.1), se pueden insertar cientos de MB de texto de audit trail repetido en la misma tabla, sin ningún límite.

La migración `0070_check_text_length_caps.sql` establece el patrón de topes server-side para TODAS las columnas `text` escritas por el cliente. El header de esa migración lo dice: _"El cliente Expo es attacker-controlled (escribe a PostgREST directo), así que el CHECK de DB es la ÚNICA capa autoritativa contra abuso de largo (storage exhaustion)"_. `export_log.file_content` viene del cliente PowerSync (el mismo vector), y 0070 no lo cubre porque la tabla no existía aún.

Adicionalmente: `export_log.file_name` tampoco tiene tope en el schema de la spec (`requirements.md` R4.1 / `design.md` migración 0094). El patrón de `import_log` incluye `constraint import_log_file_name_len_chk check (char_length(file_name) <= 255)`.

**Por qué es HIGH y no MEDIUM**: `file_content` es el único campo de texto en todo el schema actual sin tope que puede crecer proporcionalmente al número de animales × número de exports. El vector de amplificación es real (un usuario owner/vet con muchos animales puede generar exports repetidos). El impacto no es solo costo (billing Supabase) sino que un llenado de la tabla puede degradar las queries de RLS que hacen full-scan de `export_log` para el historial (R12.2).

**Fix recomendado**:
En `design.md` migración 0094, agregar constraints:
```sql
-- Tope razonable para file_content: 5 MB (5.000.000 bytes = ~138.000 animales por export).
-- Si el establecimiento tiene más animales, deberán hacerse exports parciales por rodeo/fecha.
CONSTRAINT export_log_file_content_size_chk CHECK (octet_length(file_content) <= 5000000),
-- file_name viene del slug del establecimiento (R5.3); 255 chars como import_log.
CONSTRAINT export_log_file_name_len_chk     CHECK (char_length(file_name) <= 255)
```
En `requirements.md`, agregar a R4.1: _"El contenido del archivo (`file_content`) deberá tener un tope máximo de tamaño server-side (CHECK de DB) equivalente al máximo razonable por export."_
En `tasks.md` T6, agregar test: _"(g) INSERT con `file_content` > 5 MB es rechazado por la DB; INSERT con `file_name` > 255 chars es rechazado"_.

---

## Findings MEDIUM

### MEDIUM-1 — Escritura owner-only de `renspa`: la spec deja la implementación INDEFINIDA con "el implementer elige"

**Severidad**: MEDIUM
**Dominio**: A4 (function-level authz) + R2.3 enforcement
**Archivo**: `design.md` líneas 176-181; `requirements.md` R2.3; `tasks.md` T4

**Evidence**:

`design.md` líneas 176-181 (migración 0092):
```sql
-- Policy adicional: solo owner puede UPDATE renspa
-- NOTA: la implementación exacta depende de si Supabase soporta USING por columna;
-- la alternativa es una RPC 'update_renspa' que verifica is_owner_of() antes de UPDATE.
-- El implementer elige la opción más limpia con el patrón existente de spec 01.
```

La policy `establishments_update` existente (0007) ya permite UPDATE a `is_owner_of(id)`. Lo que R2.3 requiere es que `veterinarian` y `field_operator` **no puedan escribir `renspa`**. Pero la policy UPDATE de `establishments` (0007) aplica a la fila entera: `using (public.is_owner_of(id))`. Eso ya restringe el UPDATE a owners. El riesgo real es el camino contrario: ¿hay alguna política UPDATE más permisiva que pueda haberse agregado en specs anteriores que deje que veterinarian escriba establishments?

El problema real aquí es que la spec delega al implementer elegir entre dos aproximaciones con consecuencias de seguridad distintas:
- **Opción A** (column-level policy): Postgres/Supabase no soporta column-level RLS nativa. Se puede workaround con una policy que verifique el valor NUEVO vs. ANTIGUO de `renspa`, pero eso es complejo y propenso a bugs.
- **Opción B** (RPC `update_renspa`): más limpia, pero requiere revocar el UPDATE directo de `renspa` vía PostgREST, lo cual no está especificado.

Si el implementer usa la Opción A y lo hace mal (ej. permite UPDATE de cualquier columna excepto `renspa`), un veterinarian con acceso normal a establishments podría modificar `renspa`. Si usa la Opción B sin revocar el UPDATE directo, la RPC no es la única puerta.

La spec no define cuál es la opción correcta ni qué controles son necesarios como guardia.

**Fix recomendado**:
Decidir en la spec (no delegarlo al implementer). La opción más segura y consistente con el patrón del repo es: (a) el UPDATE de `renspa` se hace **solo** vía RPC `update_renspa` que llama `is_owner_of()`, y (b) **no hay nueva policy UPDATE más permisiva** que la existente en 0007 (que ya es owner-only). Agregar en `design.md` migración 0092: _"No se crea policy UPDATE nueva — la policy existente `establishments_update` (0007, `is_owner_of(id)`) ya restringe cualquier UPDATE de esta tabla a owners."_ Aclarar que el UPDATE directo de `renspa` vía PostgREST ya está cubierto por esa policy; agregar RPC es una conveniencia de UI, no el único control.

---

### MEDIUM-2 — PowerSync sync rules para `sigsa_declarations` y `export_log`: la spec no las define

**Severidad**: MEDIUM
**Dominio**: C1 (PowerSync sync rules como autorización paralela a RLS)
**Archivo**: `design.md` sección PowerSync, líneas 337-344; `tasks.md` T7

**Evidence**:

`design.md` líneas 337-344:
```
| `sigsa_declarations` | por `establishment_id` donde el usuario tiene rol | bidireccional |
| `export_log`         | por `establishment_id` donde el usuario tiene rol | bidireccional |
```

La spec indica que el scope es "por `establishment_id` donde el usuario tiene rol" pero no especifica las sync rules concretas. PowerSync sync rules son autorización PARALELA a RLS — una regla laxa replicaría datos de todos los tenants al SQLite local aunque RLS esté perfecta.

Para `export_log`, la sync rule debe garantizar que solo se sincronizan las filas del establecimiento activo del usuario (no todos sus establecimientos simultáneamente, que expondría el TXT de otro campo en la SQLite local). Un usuario con rol en N campos recibiría los `file_content` (TXT completos con RFID + raza + sexo + fecha de nacimiento) de TODOS sus campos en el SQLite local del dispositivo, incluso si solo está operando en uno.

`tasks.md` T7 dice: _"agregar `sigsa_declarations`, `export_log` al sync scope"_ pero no define el predicado del bucket de PowerSync. Sin predicado explícito, el implementer puede usar un bucket demasiado amplio.

**Fix recomendado**:
Agregar en `design.md` la definición explícita de la sync rule:
```yaml
# export_log y sigsa_declarations: scoped al establishment activo del usuario
# (NO todos los establecimientos del usuario — el TXT es sensible)
bucket: establishment_scoped
parameters: SELECT establishment_id FROM user_roles
            WHERE user_id = token_param('user_id')
              AND establishment_id = :establishment_id
              AND active = true
```
O si se usan multiple-establishments-at-once (patrón del repo): confirmar en la spec si `export_log.file_content` debe sincronizarse para TODOS los establecimientos del usuario o solo el activo. El TXT con RFIDs es el dato más sensible de la feature y debería tener el scope más acotado posible.

En `tasks.md` T7, agregar test: _"(d) un usuario con rol en 2 establecimientos solo recibe en SQLite local los exports del establecimiento activo"_.

---

### MEDIUM-3 — `markAsDeclared` (R10.2, T19) no tiene guard de rol en la spec

**Severidad**: MEDIUM
**Dominio**: A4 (function-level authz)
**Archivo**: `requirements.md` R10.2; `tasks.md` T19

**Evidence**:

`requirements.md` línea 154:
> El sistema deberá permitir marcar manualmente un animal como "ya declarado" (crear la fila en `sigsa_declarations` sin generar un archivo nuevo)

`tasks.md` T19:
> Implementar `markAsDeclared(animalProfileId, establishmentId)` en `SigsaExportService`

R7.1-R7.2 establecen que solo `owner` y `veterinarian` pueden generar el export. R3.5 establece que el INSERT en `sigsa_declarations` requiere `owner`/`vet` via RLS. Hasta acá está cubierto.

El problema: `markAsDeclared` (T19) inserta en `sigsa_declarations` **sin `export_log_id`** (declaración manual sin archivo). La RLS de `sigsa_declarations` cubre el INSERT. Sin embargo, el test descrito en T19 solo verifica que _"el animal marcado manualmente desaparece de la lista de pendientes"_ y que _"la fila tiene `export_log_id = NULL`"_. No hay test que verifique que un `field_operator` recibe error al llamar `markAsDeclared`. La spec no cita explícitamente que `markAsDeclared` está restringido a owner/vet, aunque se infiera de R3.5.

Dado que `markAsDeclared` marca un animal como "ya declarado ante SENASA" sin archivo probatorio, un field_operator que pudiera llamarlo dejaría un trail de declaración sin evidencia real. El control existe en RLS pero no está explicitado en la spec como requisito de test.

**Fix recomendado**:
En `tasks.md` T19, agregar test: _"(c) un usuario con rol `field_operator` que llama a `markAsDeclared` recibe error (RLS rechaza el INSERT)"_. En `requirements.md` R10.2, agregar: _"Solo usuarios con rol `owner` o `veterinarian` pueden marcar manualmente un animal como declarado (mismo gate que R7.2)"_.

---

## Tabla de inputs

| Campo | Límite (largo/charset/formato/rango) | Validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| `establishments.renspa` | 1-20 chars, string no vacío (R2.2) | Server (CHECK `char_length > 0 AND <= 20` en migration 0092, `design.md` línea 173) | OK |
| `animals.tag_electronic` para export | 15 dígitos numéricos (R8.2, R8.6) | Solo cliente (`SigsaValidator.validate()` en cliente) — no hay CHECK server-side de formato 15 dígitos (el CHECK existente en 0070 topa a 64 chars pero no valida formato numérico). La spec lo reconoce como "GATE DURO". El TXT con un RFID mal formado es un problema de integridad de la declaración SENASA. | RIESGO — ver nota |
| `animal_profiles.breed_id` para export | FK a `breed_catalog(id)` (referencia controlada) | Server (FK constraint en DB, migration 0090) | OK |
| Filtros de export: `rodeo_id` | UUID FK a rodeos | Server implícito (parámetro en query SQLite local, no input libre) | OK |
| Filtros de export: `date_from`/`date_to` | date (tipo DB) | Server implícito (tipo date en query) | OK |
| `export_log.file_content` | **SIN LÍMITE en la spec** | Ausente | FAIL — HIGH-2 |
| `export_log.file_name` | **SIN LÍMITE en la spec** | Ausente | FAIL — HIGH-2 |
| `export_log.generated_by` | UUID `auth.users(id)` | Solo FK (no trigger) — spoofeable desde el cliente | FAIL — HIGH-1 |
| `sigsa_declarations.declared_by` | UUID `auth.users(id)` | Solo FK (no trigger) — spoofeable desde el cliente | FAIL — HIGH-1 |
| `sigsa_declarations.export_log_id` | UUID FK nullable | Server (FK + ON DELETE SET NULL) | OK |

**Nota sobre `tag_electronic`**: la ausencia de validación server-side de "15 dígitos numéricos" en el path de export no expone un vector de ataque per se (el RFID en el TXT viene de la DB, no de un campo libre en el momento del export). El riesgo es de integridad de datos: si un animal fue creado con un `tag_electronic` que pasó el tope de 64 chars pero no tiene exactamente 15 dígitos, el `SigsaValidator` cliente lo bloquearía pero un atacante que bypassee el cliente podría forzar un TXT con RFID basura. En el contexto offline-first de RAFAQ (el TXT se genera desde SQLite local), el vector real requiere manipulación del SQLite local (ataque físico al device), que está fuera del threat model declarado. Se deja como MEDIUM si el auditor lo quiere escalar; acá se anota como RIESGO pero no se eleva a HIGH por el threat model del proyecto.

---

## Tabla de rate limits

| Acción | Rate limit (sí/no/n.a.) | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Generar export TXT + INSERT `export_log` | No (PostgREST directo o PowerSync sin cuota) | n/a | No | La generación del TXT es local (offline, sin round-trip). El INSERT a la DB va via PowerSync. No es un edge function, no hay costo por request externo → sin email/SMS/API externa. El riesgo de abuso es HIGH-2 (storage exhaustion). El rate limit apropiado es el CHECK de tamaño (HIGH-2), no un rate limit de API. |
| INSERT `sigsa_declarations` (N filas post-export) | No | n/a | No | Mismo análisis: mutación local via PowerSync. El único abuse vector es insertar N declaraciones falsas, pero RLS requiere owner/vet y la UNIQUE constraint limita a 1 por (establishment, animal). No hay fan-out amplificado. |
| Re-descarga de export (`redownload`) | n/a | n/a | n/a | Lee de SQLite local, sin round-trip. |
| Auth de usuario (login/signup) | Sí (nativo Supabase `[auth.rate_limit]`) | Per-IP / per-user | Sí | No modificado por esta spec. OK. |
| `markAsDeclared` (INSERT en `sigsa_declarations`) | No | n/a | No | Acotado por UNIQUE(establishment_id, animal_profile_id). Sin amplificación. No necesita rate limit. |

**Conclusión rate limits**: ninguna acción nueva de esta spec requiere rate limit adicional. El flujo es 100% offline-local → no hay endpoint de Edge Function nuevo ni llamada a API externa. El único riesgo de "abuso a escala" es el storage exhaustion de `file_content` (HIGH-2, se resuelve con CHECK de tamaño).

---

## Dominios revisados

- **A1 · Service-role bypass RLS**: no hay Edge Functions nuevas en esta spec → no aplica. El generador del TXT explícitamente descarta la opción Edge Function (`design.md` sección "Alternativa descartada"). OK.
- **A2 · Mass assignment / over-posting**: `declared_by`/`generated_by` son spoofables → HIGH-1.
- **A3 · IDOR por FK**: `sigsa_declarations.animal_profile_id` referencia `animal_profiles(id)`. La RLS de `sigsa_declarations` en INSERT exige `has_role_in(establishment_id)` + rol owner/vet. Pero el campo `establishment_id` de la fila a insertar viene del **cliente**. Si un cliente envía un `establishment_id` al que tiene rol pero manda el `animal_profile_id` de un animal de otro establishment, la RLS del INSERT en `sigsa_declarations` no verifica que `animal_profile_id` pertenece al `establishment_id` enviado. Sin embargo: (a) la UNIQUE (establishment_id, animal_profile_id) no previene esto; (b) la RLS de `sigsa_declarations` tampoco verifica la FK cruzada. → Esto es un IDOR potencial: un owner de campo A puede crear una `sigsa_declaration` falsa con `establishment_id = A` y `animal_profile_id = <animal de campo B>`. El efecto práctico es que ese animal de campo B aparece como "declarado" en campo A (aunque sin archivo real), y el campo B podría verlo via SELECT sobre su propio `sigsa_declarations` si el perfil está scoped correctamente. Se eleva a MEDIUM-4 (ver abajo).
- **A4 · Function-level authz**: MEDIUM-1 (renspa), MEDIUM-3 (markAsDeclared).
- **B1 · Information disclosure**: no hay Edge Functions nuevas → no aplica para esta spec.
- **B3 · Over-fetching column-level**: `export_log` usa `SELECT` scoped por establishment. El `file_content` es sensible pero scoped correctamente por RLS. OK.
- **C1 · PowerSync sync rules**: MEDIUM-2.
- **C3 · Data-at-rest local**: `file_content` en SQLite local incluye RFIDs de animales. Riesgo de device físico perdido. La spec no lo aborda (está fuera del scope de esta auditoría de spec → anotado como LOW).
- **D1 · service_role en cliente**: no hay secrets en cliente declarados en esta spec. OK.
- **E1 · Queries sin tope**: el `queryPendingAnimals` en `tasks.md` T11 no menciona `LIMIT` en la query SQLite local. Si un establecimiento tiene 100.000 animales pendientes, la query traería todas las filas al SQLite in-memory del hook. → Se eleva a LOW (fuera del scope de la auditoría de spec para findings reportables; se anota).
- **E2 · Storage exhaustion**: HIGH-2.
- **F1 · Filter injection**: los filtros de `queryPendingAnimals` son `rodeo_id` (UUID FK) y `date_from`/`date_to` (date). No hay concatenación de texto libre en la query SQLite. OK.
- **G · BLE**: no aplica (esta spec no toca BLE directamente).
- **H3 · Token en URL**: no hay tokens en URL en esta spec. OK.
- **I2 · Audit tamper-evidence**: HIGH-1 (declared_by/generated_by spoofeable).

---

### MEDIUM-4 — IDOR: INSERT en `sigsa_declarations` no verifica que `animal_profile_id` pertenece al `establishment_id`

**Severidad**: MEDIUM
**Dominio**: A3 (IDOR por FK)
**Archivo**: `design.md` líneas 196-227 (migración 0093, RLS INSERT de `sigsa_declarations`)

**Evidence**:

La policy INSERT en `sigsa_declarations` (`design.md` líneas 210-220):
```sql
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
    )
  );
```

Esta policy verifica que el `establishment_id` de la nueva fila es uno donde el caller tiene rol owner/vet. **No verifica** que el `animal_profile_id` pertenece a ese `establishment_id`.

Un owner de campo A puede insertar:
```json
{ "establishment_id": "<campo_A_id>", "animal_profile_id": "<animal_profile de campo B>" }
```

La fila se inserta correctamente (la RLS solo verifica `has_role_in(establishment_id)` = campo A). El animal del campo B aparece como "declarado" en el contexto del campo A. Aunque el daño práctico sea limitado (el campo B no ve esta fila porque su SELECT está scoped a su propio `establishment_id`), el marcador SENASA del campo B podría quedar contaminado si la query de pendientes no scopa bien el `animal_profile_id` al `establishment_id` correcto.

El patrón correcto es verificar la FK cruzada en la policy WITH CHECK:
```sql
AND EXISTS (
  SELECT 1 FROM public.animal_profiles ap
  WHERE ap.id = sigsa_declarations.animal_profile_id
    AND ap.establishment_id = sigsa_declarations.establishment_id
    AND ap.deleted_at IS NULL
)
```

**Fix recomendado**:
Agregar el predicado anterior al `WITH CHECK` de `sigsa_declarations_insert` en `design.md` migración 0093. Agregar test en `tasks.md` T5: _"(h) INSERT con `animal_profile_id` de otro establishment es rechazado aunque el `establishment_id` sea válido"_.

---

## Dominios excluidos

| Dominio | Justificación |
|---|---|
| D4 · CI/CD (GHA) | Spec no toca workflows de CI. |
| F2 · Import de archivos | Esta spec **genera** archivos (export), no importa. El import es spec 12, ya auditado. |
| F3 · SSRF | No hay `fetch()` a URLs externas en esta spec. |
| F4 · XSS en email | No hay templates de email en esta feature. |
| G · BLE | El export no depende de BLE. Los RFID vienen de `animals.tag_electronic` ya cargado en DB. |
| H1 · Invalidación de sesión | No hay cambios de sesión/rol en esta spec. |
| I3 · Mobile hardening (FLAG_SECURE) | La pantalla ExportSigsaScreen muestra RFIDs; podría ameritar FLAG_SECURE. Se anota como LOW. |

---

## Cobertura indirecta / gaps de la revisión de spec

- **PowerSync sync rules** no se pueden verificar completamente sin ver la configuración real de PowerSync del repo (archivo de reglas). T7 de `tasks.md` las delega al implementer sin especificarlas en la spec → MEDIUM-2.
- **Trigger de ternero al pie** (T2, T3): la spec dice "el implementer ajusta el trigger existente en esta misma migration" para heredar `breed_id`. La lógica del trigger de calf creation (migration 0032/0048) no fue revisada en esta auditoría. Si el trigger usa `SECURITY DEFINER` y el implementer lo modifica para incluir una query a `breed_catalog` sin scoping, podría exponer datos del catálogo via el trigger. Bajo riesgo dado que `breed_catalog` es read-only global, pero se recomienda que el reviewer verifique el trigger modificado en Gate 2.
- **Validación formato RFID server-side**: la spec reconoce explícitamente el "GATE DURO" de formato RFID y lo deja abierto. No se puede fallar la spec por una incógnita declarada y aceptada. Se anota como riesgo de integridad post-MVP.

---

## Anexo LOW (informativo, no bloqueante)

- **LOW-1 · `queryPendingAnimals` sin LIMIT en SQLite local** (E1): `tasks.md` T11 no especifica LIMIT. Para establecimientos grandes (>10k animales pendientes), la query trae todas las filas al cliente. No es un vector de ataque externo (es self-DoS), pero puede degradar la UX. Se recomienda agregar `LIMIT 500` con paginación y documentarlo en la spec.
- **LOW-2 · `file_content` en SQLite local** (C3): el TXT completo con RFIDs se sincroniza al dispositivo vía PowerSync. Si el dispositivo se pierde, todos los RFIDs del export quedan en claro en el SQLite local. El threat model actual no cubre cifrado de SQLite local (ADR pendiente). Se anota para futura decisión arquitectónica.
- **LOW-3 · FLAG_SECURE en ExportSigsaScreen** (I3): la pantalla muestra RFIDs + datos de animales. En pantallas con datos operativos sensibles, FLAG_SECURE evita capturas de pantalla del sistema (relevante en contexto de Android). No aplica a esta spec en particular pero el patrón debería definirse.
- **LOW-4 · RENSPA único global vs. tenant-único** (Decisión abierta 3): la spec tiene una decisión abierta sobre si la unicidad de RENSPA es global (entre TODOS los establecimientos) o solo entre no-borrados del mismo tenant. El diseño actual (`UNIQUE INDEX ... WHERE renspa IS NOT NULL AND deleted_at IS NULL`) lo hace global, lo que podría permitir enumerar si un RENSPA ya existe en otro tenant (error de violación de UNIQUE revela existencia). En MVP esto es aceptable dado el número pequeño de tenants; se anota para post-MVP.

---

## Re-run 2026-06-13

**Veredicto**: PASS (re-run) — 0 HIGH, 0 MEDIUM. Los 6 findings originales están correctamente cerrados. El fold no introdujo nuevos findings de severidad reportable.

---

### Verificacion de cierre: 6 findings originales

#### HIGH-1 — Audit spoofing declared_by/generated_by — CERRADO

**Evidence del cierre**:

`design.md` migration 0093 (lineas 260-273): `tg_force_declared_by_auth_uid` presente como funcion `plpgsql` con `NEW.declared_by := auth.uid()` + trigger `sigsa_declarations_set_declared_by BEFORE INSERT`. `requirements.md` R3.6 lo eleva a requisito: "forzar `sigsa_declarations.declared_by = auth.uid()` server-side mediante un trigger BEFORE INSERT, ignorando cualquier UUID que el cliente envie". `tasks.md` T5 test (h): "`declared_by` siempre refleja `auth.uid()` aunque el payload del cliente envie un UUID diferente".

`design.md` migration 0094 (lineas 332-345): `tg_force_generated_by_auth_uid` idem para `export_log.generated_by` + trigger `export_log_set_generated_by BEFORE INSERT`. `requirements.md` R4.4. `tasks.md` T6 test (h).

El patron matchea exactamente 0043 (`tg_force_created_by_auth_uid`) y 0073 (`tg_force_imported_by_auth_uid`). Las funciones de trigger no tienen `SECURITY DEFINER` (correcto: triggers de tabla no necesitan SECURITY DEFINER). No hay `SET search_path` en el cuerpo de las funciones de trigger, igual que 0043 y 0073 — aceptable porque el cuerpo es `NEW.col := auth.uid()` sin ningun lookup de objeto que requiera resolucion de esquema. **Veredicto: CERRADO.**

#### HIGH-2 — file_content sin tope de tamano — CERRADO

**Evidence del cierre**:

`design.md` migration 0094 (lineas 301-303):
```sql
CONSTRAINT export_log_file_content_size_chk CHECK (octet_length(file_content) <= 5000000),
CONSTRAINT export_log_file_name_len_chk     CHECK (char_length(file_name) <= 255)
```
`requirements.md` R4.1 incluye la restriccion narrativa. `tasks.md` T6 test (g): "INSERT con `file_content` > 5 MB es rechazado por la DB; INSERT con `file_name` > 255 chars es rechazado". El techo de 5 MB (~138.000 animales a 36 bytes/registro) es razonable y consistente con el patron 0070. **Veredicto: CERRADO.**

#### MEDIUM-1 — Escritura owner-only de renspa indefinida — CERRADO

**Evidence del cierre**:

`design.md` migration 0092 (lineas 183-205): RPC `update_renspa(p_establishment_id, p_renspa)` `SECURITY DEFINER SET search_path = public` con guard `IF NOT public.is_owner_of(p_establishment_id) THEN RAISE EXCEPTION ... ERRCODE = 42501` + `REVOKE EXECUTE FROM public, anon` + `GRANT EXECUTE TO authenticated`. `requirements.md` R2.3 ahora especifica la RPC como unico canal de escritura de `renspa`.

Verificacion adicional sobre `is_owner_of` (0005): el helper ya chequea `e.deleted_at is null`, cubriendo el caso de establecimiento soft-deleted. El UPDATE en la RPC tiene ademas `WHERE id = p_establishment_id AND deleted_at IS NULL` como doble guarda. No hay SQL dinamico; `p_renspa` va como parametro bindado. La constraint `chk_establishments_renspa_length` (migration 0092) valida el largo server-side aunque la RPC no lo haga explicitamente en su cuerpo. `tasks.md` T4 tests (b/c/d) prueban que `veterinarian` y `field_operator` reciben 42501 tanto por la RPC como por UPDATE directo. **Veredicto: CERRADO.**

#### MEDIUM-2 — Sync rules PowerSync no definidas — CERRADO

**Evidence del cierre**:

`design.md` seccion "Sync rules explicitas para rafaq.yaml" (lineas 428-448): tres bloques YAML definidos con patron JOIN-free `org_scope` — `sigsa_breed_catalog` (global, `active=true`), `sigsa_declarations` (`org_scope`), `sigsa_export_log` (`org_scope`). El `org_scope` usa `SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true` — mismo patron JOIN-free del repo. `requirements.md` R14.2 y R15.1 ahora especifican el scope explicito. `tasks.md` T7 test (d) exige prueba de aislamiento: usuario con rol en 2 establecimientos solo recibe datos de los establecimientos donde tiene rol activo. **Veredicto: CERRADO.**

#### MEDIUM-3 — markAsDeclared sin test de guard de rol — CERRADO

**Evidence del cierre**:

`tasks.md` T19 test (c): "un usuario con rol `field_operator` que llama a `markAsDeclared` recibe error (RLS rechaza el INSERT con 42501)". `requirements.md` R10.2: "Solo usuarios con rol `owner` o `veterinarian` pueden marcar manualmente un animal como declarado (mismo gate que R7.2)". **Veredicto: CERRADO.**

#### MEDIUM-4 — IDOR en INSERT de sigsa_declarations — CERRADO

**Evidence del cierre**:

`design.md` migration 0093 (lineas 246-253): el WITH CHECK ahora incluye un tercer EXISTS:
```sql
AND EXISTS (
  SELECT 1 FROM public.animal_profiles ap
  WHERE ap.id = sigsa_declarations.animal_profile_id
    AND ap.establishment_id = sigsa_declarations.establishment_id
    AND ap.deleted_at IS NULL
)
```

Analisis de bypasseabilidad: el EXISTS corre dentro de la policy WITH CHECK bajo la sesion del usuario autenticado. La tabla `animal_profiles` tiene RLS propia (`has_role_in(establishment_id)`), por lo que el subquery solo ve perfiles del establecimiento donde el caller tiene rol. Un atacante que envie un `animal_profile_id` de campo B: (a) la condicion `ap.establishment_id = sigsa_declarations.establishment_id` (campo A del caller) no se cumple para ese perfil, y (b) la RLS de `animal_profiles` tampoco mostraria la fila de campo B al atacante. Doble barrera; no bypasseable. `tasks.md` T5 test (i) lo prueba explicitamente. **Veredicto: CERRADO.**

---

### Pase fresco — hallazgos nuevos del fold

Se revisaron especificamente los elementos agregados por el fold: los 2 triggers, la RPC `update_renspa`, el nuevo EXISTS del IDOR-check, los CHECK de tamano y los bloques YAML de sync. **Ningun hallazgo HIGH ni MEDIUM encontrado.** Detalle:

**F1 — Trigger functions sin SET search_path (LOW, no reportable)**
`tg_force_declared_by_auth_uid` y `tg_force_generated_by_auth_uid` no tienen `SET search_path = public`. Las funciones solo ejecutan `NEW.col := auth.uid()` — sin lookups de esquema, sin SQL dinamico, sin acceso a objetos que requieran resolucion de nombre. El riesgo de `search_path` injection es teorico en ausencia de cualquier objeto referenciado por nombre. El patron de referencia 0043 y 0073 tampoco setean `search_path`. Consistente con el repo. No se eleva a finding.

**F2 — update_renspa: edge case establecimiento inexistente (descartado)**
Si `p_establishment_id` no existe en `establishments`, `is_owner_of()` retorna false y se lanza 42501 antes del UPDATE. La clausula `AND deleted_at IS NULL` en el WHERE del UPDATE es una guarda adicional. Sin gap.

**F3 — update_renspa: cross-tenant renspa (descartado)**
`is_owner_of(p_establishment_id)` (0005) verifica `user_roles.establishment_id = est_id AND role = owner AND active = true AND establishments.deleted_at IS NULL`. Si el caller no es owner del campo objetivo, el guard falla en 42501.

**F4 — EXISTS del IDOR-check bypasseable (descartado)**
La doble barrera (RLS de `animal_profiles` + condicion `ap.establishment_id = sigsa_declarations.establishment_id`) hace que el bypass requeriria control sobre la RLS de `animal_profiles` — que el atacante no tiene.

**F5 — CHECK constraints bien dimensionados (confirmado)**
5 MB para `file_content` (~138k animales a 36 bytes) es correcto y documentado con el calculo en el comentario de la migration. 255 chars para `file_name` es el mismo limite que `import_log.file_name` (0073).

**F6 — breed_catalog YAML filtra active=true (LOW, no reportable)**
La sync rule de `sigsa_breed_catalog` solo sincroniza razas activas. Si un animal tuviera `breed_id` de una raza bubalina (edge case improbable en MVP bovino, no prevenido por CHECK en `animal_profiles.breed_id`), esa raza no estaria disponible en local y apareceria con raza desconocida en el export. Integridad de datos, no vector de ataque. Se anota como LOW para post-MVP si se agregan especies.

---

### Tabla de inputs actualizada — estado post-fold

| Campo | Limite | Validacion (server / cliente) | OK? |
|---|---|---|---|
| `establishments.renspa` | 1-20 chars (CHECK migration 0092) | Server (CHECK DB + RPC guard `is_owner_of`) | OK |
| `export_log.file_content` | 5 MB max (CHECK `octet_length <= 5000000`, migration 0094) | Server (CHECK DB autoritativo) | OK — HIGH-2 cerrado |
| `export_log.file_name` | 255 chars (CHECK `char_length <= 255`, migration 0094) | Server (CHECK DB autoritativo) | OK — HIGH-2 cerrado |
| `export_log.generated_by` | Forzado a `auth.uid()` por trigger BEFORE INSERT | Server (trigger, no spoofeable) | OK — HIGH-1 cerrado |
| `sigsa_declarations.declared_by` | Forzado a `auth.uid()` por trigger BEFORE INSERT | Server (trigger, no spoofeable) | OK — HIGH-1 cerrado |
| `sigsa_declarations.animal_profile_id` | FK + EXISTS verifica pertenencia al `establishment_id` | Server (WITH CHECK policy) | OK — MEDIUM-4 cerrado |

---

### Tabla de rate limits — sin cambios

Sin cambios respecto al analisis original. Ninguna accion nueva de esta spec requiere rate limit adicional (flujo 100% offline-local, sin Edge Functions nuevas ni llamadas a API externa).

---

### Dominios revisados en el re-run

- **A2 (mass assignment / audit spoofing)**: HIGH-1 cerrado via triggers.
- **A3 (IDOR por FK)**: MEDIUM-4 cerrado via EXISTS en WITH CHECK.
- **A4 (function-level authz)**: MEDIUM-1 y MEDIUM-3 cerrados via RPC + test declarado.
- **C1 (PowerSync sync rules)**: MEDIUM-2 cerrado via YAML explicito en design.md.
- **E2 (storage exhaustion)**: HIGH-2 cerrado via CHECK constraints de DB.
- **D (secretos / SECURITY DEFINER)**: triggers no tienen SECURITY DEFINER (correcto para triggers de tabla). RPC `update_renspa` tiene SECURITY DEFINER con `SET search_path = public` (correcto).
