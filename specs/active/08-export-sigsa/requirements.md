# Spec 08 — Exportación SIGSA — Requirements

**Status**: in_progress (capa DB) — Puerta 1 APROBADA (2026-06-13) + **las 4 decisiones abiertas CERRADAS (Raf, 2026-06-24)**. Capa pura T8/T9/T10 done (terminal paralela). Migraciones renumeradas **0107-0112** (la DB avanzó a 0106 desde la redacción).
**Fecha**: 2026-06-13 (decisiones cerradas 2026-06-24)
**Autor**: spec_author

## Resumen

Genera el archivo `.txt` importable en SIGSA web para declarar ante SENASA los dispositivos de identificación electrónica (Res. 841/2025, Art. 8°). La app produce el archivo; el productor lo sube manualmente. No hay API: RAFAQ es la alternativa a SIGBIOTRAZA para quien ya carga en RAFAQ y quiere cumplir sin re-cargar en otra app.

**⚠ GATE DURO — FORMATO EXACTO NO CONFIRMADO CON UPLOAD REAL**: el formato del archivo TXT viene de 2 fuentes de investigación (manual SIGSA v2.42.80 + sesión 16) pero NO se verificó con un upload real ni login a SIGSA con clave fiscal. Antes de cerrar la feature 08 como `done`, Raf o Facundo deben hacer un upload real a SIGSA web y verificar: (1) si hay o no `;` al final del último registro, (2) si hay espacios, (3) si hay restricción de rango de fechas (`birth_date`), (4) la longitud exacta y validaciones server-side del RFID, (5) si el sistema acepta mayúsculas/minúsculas mixtas o solo uno de los dos. Por eso el generador del TXT debe estar AISLADO en un módulo swappable (ver design) para absorber ajustes sin tocar el resto.

## Criterios de aceptación originales (feature_list.json id=8) — cobertura

| Criterio original | Cubierto por |
|---|---|
| Owner genera archivo de exportación | R3, R4, R5, R7 |
| Formato cumple con especificación SIGSA/SIGBIOTRAZA | R5, R6 |
| Archivo importable en sistemas SENASA sin errores | R6, R8 (gate duro) |
| Audit trail de qué se exportó y cuándo | R11, R12 |

## Requirements (EARS)

### R1. Catálogo de razas controlado (delta sobre spec 02)

> Delta sobre spec 02 (`animal_profiles.breed` texto libre → referencia controlada). Este bloque toca backend ya `done`. Requiere cuidado especial en las migrations.

**R1.1** El sistema deberá modelar la tabla `breed_catalog` con `(id uuid PK, senasa_code text NOT NULL UNIQUE, name text NOT NULL, species text NOT NULL DEFAULT 'bovine', active boolean NOT NULL DEFAULT true, sort_order int, created_at timestamptz NOT NULL DEFAULT now())`. El campo `senasa_code` deberá usar las grafías literales del manual SIGSA v2.42.80 (ver `razas-senasa-codigos.md`).

**R1.2** El sistema deberá sembrar `breed_catalog` con las 28 razas bovinas de la tabla oficial SIGSA, usando los códigos exactos del manual (grafías literales): `HA`, `PH`, `J`, `LA`, `FS`, `SG`, `OR`, `L`, `K`, `BO`, `SRB`, `SA`, `B`, `SH`, `SP`, `TL`, `SI`, `GC`, `H`, `W`, `SF`, `CH`, `AA`, `BG`, `BF`, `CR`, `MG`, `G`. El código `S/E` (Sin Especificar) se sembrará como fila adicional con `species = 'generic'`. Las 3 razas bubalinas (`ME`, `JA`, `MU`) se sembrarán con `species = 'bubaline'` y `active = false` (fuera de scope MVP bovino).

**R1.3** El sistema deberá enforce que `breed_catalog` sea de solo lectura para clientes autenticados (SELECT abierto a `authenticated`; sin INSERT/UPDATE/DELETE desde el cliente). Las modificaciones se hacen vía migration.

**R1.4** El sistema deberá agregar la columna `animal_profiles.breed_id` (FK nullable a `breed_catalog(id)`) en coexistencia con la columna existente `animal_profiles.breed` (texto libre) durante la migración. La columna `breed_id` se usará going forward; `breed` queda como legacy hasta la limpieza post-MVP.

> **Nota de reconciliación (as-built, Run 3 impl 2026-06-25, migración 0113).** La POBLACIÓN de `breed_id`
> going-forward (alta + import + edición) se centraliza en un **trigger** `tg_derive_breed_id_from_breed`
> (`BEFORE INSERT OR UPDATE OF breed ON animal_profiles`) que DERIVA `breed_id` desde `breed` (el nombre del
> catálogo) por match normalizado, en vez de que cada write-path (RPC `create_animal` 0083, import, ficha)
> setee `breed_id` directamente. Razón (decisión del leader): el BreedPicker setea `breed` (texto, nombre
> exacto), no `breed_id`, y la RPC `create_animal` no tiene `p_breed_id` → sin esto ningún animal nuevo era
> exportable. El trigger arregla alta + import + edición de forma uniforme sin cambiar firmas de RPC. El
> cliente escribe SIEMPRE solo `breed`; el trigger pone `breed_id`. Guard `breed IS NOT NULL` preserva el
> `breed_id` heredado del ternero al pie (R1.7). La UX de "completar la raza" (alta: BreedPicker en
> `crear-animal.tsx`; edición: `BreedRow` + `BreedPickerSheet` en la ficha `[id].tsx`) escribe `breed` →
> el trigger deriva `breed_id` → el animal pasa a exportable (cierra el loop "A completar → completar" de
> R8.2/R8.3). Detalle en `progress/impl_08-sigsa-breed-trigger.md` + `design.md` §"Migration 0113".

**R1.5** Cuando existe `animal_profiles.breed` (texto libre) y `breed_id` es `NULL`, el sistema deberá ejecutar una migración best-effort que haga matching por nombre normalizado (case-insensitive, trim) al catálogo `breed_catalog` y asigne `breed_id` si encuentra exactamente un match. Los registros sin match quedan con `breed_id = NULL` ("a completar").

**R1.6** El sistema deberá migrar `reproductive_events.breed` (raza del ternero al parto, migration 0026) de la misma manera: agregar `breed_id` FK nullable + migración best-effort de texto libre.

> **Nota de reconciliación (as-built, impl 2026-06-24, migración 0109).** `reproductive_events` (0026) **no tiene** columna `breed` (texto libre) — el supuesto de R1.6 era incorrecto (el `breed` texto libre vive en `animal_profiles`, 0020, cubierto por R1.5; el único `breed` en `reproductive_events`-adyacente es `semen_registry.breed`, otra tabla). Por lo tanto: la columna `breed_id` FK nullable **se agrega** (parte cumplida, la usa el sync de PowerSync T7) pero la **migración best-effort es un no-op** (no hay columna fuente que matchear; el `UPDATE` original habría abortado la migración). `reproductive_events.breed_id` queda como columna forward-compat sin path de población automática en MVP — la herencia de raza del ternero al pie que importa (R1.7) va al `animal_profiles.breed_id` **del ternero**, no a esta columna, y el código RAZA del TXT sale de ahí (R5.2). Detalle en `progress/impl_08-sigsa-db.md` §Reconciliación y `design.md` migración 0109.

**R1.7** Cuando se crea un ternero al pie (`R9` de spec 02), el sistema deberá heredar el `breed_id` de la madre en el `animal_profile` del ternero, en lugar de texto libre. Si la madre no tiene `breed_id`, el ternero nace con `breed_id = NULL`.

**R1.8** El sistema deberá exponer el `breed_catalog` en el PowerSync sync scope (lectura global, `authenticated`). El catálogo se carga al primer login y se refresca según TTL de PowerSync.

### R2. Campo RENSPA en establecimientos (delta sobre spec 01)

> Delta sobre spec 01 (`establishments`). Toca backend ya `done`.

**R2.1** El sistema deberá agregar la columna `establishments.renspa` (text, nullable, **SIN constraint de unicidad**) a la tabla `establishments`. *(Decisión 3 cerrada 2026-06-24: texto opcional sin unique. El RENSPA no va en el TXT — R2.4 — y un unique global causaría colisión/fuga cross-tenant en casos legítimos. La unicidad como señal anti-fraude queda POST-MVP, atada a la cardinalidad real del RENSPA que valida Facundo.)*

**R2.2** Cuando un usuario guarda un RENSPA en el establecimiento, el sistema deberá validar que el formato sea un string no vacío de hasta 20 caracteres. La validación de formato RENSPA más estricta (estructura SENASA) queda como mejora post-MVP.

**R2.3** El sistema deberá permitir que solo el `owner` del establecimiento lea y edite el campo `renspa`. El `field_operator` y el `veterinarian` no deberán poder modificar `renspa`. La escritura de `renspa` desde la app deberá realizarse exclusivamente vía la RPC `update_renspa(p_establishment_id, p_renspa)` SECURITY DEFINER, que verifica el rol `owner` server-side antes de ejecutar el UPDATE. El UPDATE directo vía PostgREST queda bloqueado por la policy `establishments_update` existente (spec 01, migration 0007).

**R2.4** El campo `renspa` NO deberá incluirse en el archivo TXT generado. Su rol es exclusivamente como recordatorio en pantalla al momento de la exportación.

### R3. Marcador de declaración SIGSA por (establecimiento, animal)

> Nuevo modelo propio de 08. No está en ninguna spec anterior.

**R3.1** El sistema deberá modelar la tabla `sigsa_declarations` con `(id uuid PK DEFAULT gen_random_uuid(), establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE, animal_profile_id uuid NOT NULL REFERENCES animal_profiles(id) ON DELETE CASCADE, declared_at timestamptz NOT NULL DEFAULT now(), export_log_id uuid REFERENCES export_log(id) ON DELETE SET NULL, declared_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(establishment_id, animal_profile_id))`. La unicidad `(establishment_id, animal_profile_id)` garantiza exactamente un marcador por par.

**R3.2** El marcador `sigsa_declarations` deberá ser scoped por establecimiento: un animal transferido a un campo nuevo (spec 11 / feature 11) NO deberá heredar automáticamente el marcador del campo origen. El campo destino puede declarar el mismo animal bajo su propio RENSPA.

**R3.3** El sistema no deberá almacenar el marcador de declaración en `animals` global ni en `animal_profiles` directamente. El marcador vive en `sigsa_declarations`.

**R3.4** El sistema deberá permitir que una declaración existente sea "re-exportada" (el usuario vuelve a generar el archivo para ese animal) sin modificar el marcador original. La tabla `export_log` registra cada generación; el marcador `sigsa_declarations` registra solo la primera declaración formal por establecimiento + animal.

**R3.5** El sistema deberá aplicar RLS a `sigsa_declarations` usando `has_role_in(establishment_id)` para SELECT, INSERT y DELETE; solo `owner` y `veterinarian` pueden INSERT (ver R7.2).

**R3.6** El sistema deberá forzar `sigsa_declarations.declared_by = auth.uid()` server-side mediante un trigger BEFORE INSERT, ignorando cualquier UUID que el cliente envíe en el payload. Ningún cliente deberá poder imputar una declaración a otro usuario.

**R3.7** El sistema deberá verificar en la policy WITH CHECK del INSERT de `sigsa_declarations` que el `animal_profile_id` pertenece al `establishment_id` de la fila a insertar (y que el perfil está activo). Un INSERT con `animal_profile_id` de un establecimiento ajeno deberá ser rechazado aunque el `establishment_id` sea válido para el caller.

### R4. Registro de exportaciones (export_log)

**R4.1** El sistema deberá modelar la tabla `export_log` con `(id uuid PK DEFAULT gen_random_uuid(), establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE CASCADE, generated_at timestamptz NOT NULL DEFAULT now(), generated_by uuid NOT NULL REFERENCES auth.users(id), animal_count int NOT NULL, file_name text NOT NULL, file_content text NOT NULL, rodeo_filter_id uuid REFERENCES rodeos(id) ON DELETE SET NULL, date_from date, date_to date, created_at timestamptz NOT NULL DEFAULT now())`. La columna `file_content` almacena el contenido del TXT generado para permitir re-descargas. El contenido del archivo (`file_content`) deberá tener un tope máximo de tamaño server-side (CHECK de DB, `octet_length(file_content) <= 5000000`) equivalente al máximo razonable por export (~138.000 animales). El `file_name` deberá tener un tope de 255 caracteres (CHECK de DB).

**R4.4** El sistema deberá forzar `export_log.generated_by = auth.uid()` server-side mediante un trigger BEFORE INSERT, ignorando cualquier UUID que el cliente envíe en el payload. Ningún cliente deberá poder imputar una generación de export a otro usuario.

**R4.2** El sistema deberá aplicar RLS a `export_log` usando `has_role_in(establishment_id)` para SELECT (todos los roles activos pueden ver el historial de exports); INSERT solo para `owner` y `veterinarian` (ver R7.2).

**R4.3** El sistema deberá registrar una fila en `export_log` en cada generación de archivo, incluyendo los filtros aplicados (rodeo, rango de fechas si los hubo) y el contenido del archivo generado.

### R5. Generación del archivo TXT

> El generador del TXT es un módulo AISLADO y SWAPPABLE. Ver design para la justificación.

**R5.1** El sistema deberá generar un archivo `.txt` cuyo contenido siga el formato `RFID-SEXO-RAZA-MM/AAAA` por animal, con los animales separados por `;` (punto y coma). Cada registro deberá tener exactamente 4 campos separados por guion del medio `-`.

**R5.2** El sistema deberá derivar los campos de cada registro de la siguiente manera:
- `RFID`: `animals.tag_electronic` (15 dígitos numéricos).
- `SEXO`: `animals.sex = 'male'` → `M`; `animals.sex = 'female'` → `H`.
- `RAZA`: código SENASA de `breed_catalog.senasa_code` derivado vía `animal_profiles.breed_id`. Si `breed_id` es `NULL`, no se exporta el animal (bloqueo de validación, ver R8).
- `FECHANACIMIENTO`: `animals.birth_date` formateado como `MM/AAAA` (mes en 2 dígitos, año en 4 dígitos).

**R5.3** El sistema deberá generar el nombre del archivo en el formato `sigsa_<establishment_name_slug>_<YYYYMMDD_HHMMSS>.txt`.

**R5.4** El sistema deberá generar el archivo de forma local (offline), sin requerir conectividad de red. La subida a SIGSA web la hace el productor fuera de la app.

**R5.5** El sistema no deberá incluir en el TXT ningún dato que no sea el RFID, el sexo, la raza y la fecha de nacimiento. En particular, RENSPA, especie, fecha de aplicación y motivo de declaración NO van en el archivo.

**R5.6** El sistema deberá producir el archivo codificado en UTF-8 sin BOM.

### R6. Formato exacto del registro — incógnitas con gate duro

> El formato del manual SIGSA es el siguiente (del ejemplo literal en la fuente primaria):
> `032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025;032010000000002-M-B-08/2025`

**R6.1** El sistema deberá generar los registros en el formato `{RFID}-{SEXO}-{RAZA}-{MM/AAAA}`, con el guion del medio `-` como separador de campos dentro de cada registro.

**R6.2** El sistema deberá separar los registros con `;` (punto y coma), sin espacios adicionales entre registros.

**R6.3** ⚠ **GATE DURO — a confirmar con upload real**: el comportamiento respecto al `;` final (si el último registro termina con `;` o no) NO está confirmado. El generador deberá ser configurable en este punto (parámetro `trailingSemicolon: boolean`, default `false` hasta confirmar). Lo mismo aplica a si hay newlines entre registros.

**R6.4** El sistema deberá formatear `MM/AAAA` con el mes en 2 dígitos con cero a la izquierda si corresponde (ej. `08/2025`), no `8/2025`.

**R6.5** El sistema deberá validar que los códigos de raza usados en el TXT coincidan exactamente con las grafías del catálogo oficial (`razas-senasa-codigos.md`). El implementer NO deberá inventar códigos de raza; si un código no está en el catálogo, es un error.

### R7. Roles — quién puede exportar

**R7.1** El sistema no deberá permitir que un usuario con rol `field_operator` genere el archivo de exportación SIGSA.

**R7.2** El sistema deberá permitir que usuarios con rol `owner` o `veterinarian` en el establecimiento activo generen el archivo de exportación.

**R7.3** Cuando un usuario sin los roles requeridos intenta generar el export, el sistema deberá rechazar la operación con un error claro y accionable.

### R8. Validación pre-export (validar y bloquear)

**R8.1** Antes de generar el archivo, el sistema deberá identificar y separar los animales seleccionados en dos conjuntos: (a) exportables (pasan todos los controles) y (b) "a completar" (fallan al menos un control).

**R8.2** Un animal deberá ser rechazado como "a completar" si cumple cualquiera de estas condiciones:
- `animals.tag_electronic` es `NULL` o no tiene exactamente 15 dígitos numéricos.
- `animals.birth_date` es `NULL`.
- `animal_profiles.breed_id` es `NULL` (sin raza asignada del catálogo).

**R8.3** El sistema deberá mostrar la lista de animales "a completar" con el o los datos faltantes por animal, de forma que el usuario pueda ir a completarlos y reintentar.

**R8.4** El sistema deberá generar el archivo solo cuando al menos un animal del lote seleccionado pase la validación (sea exportable). Si todos fallan, el sistema deberá rechazar la generación con error claro.

**R8.5** Si algunos animales del lote fallan y otros pasan, el sistema deberá permitir que el usuario elija entre: (a) completar los datos faltantes y reintentar, o (b) exportar solo los que ya pasan (excluyendo explícitamente los incompletos del lote actual).

**R8.6** El sistema deberá validar la longitud y el carácter numérico de `tag_electronic` (15 dígitos numéricos) antes de incluirlo en el TXT. ⚠ **GATE DURO**: la validación exacta del RFID por SIGSA (si acepta ceros a la izquierda, si valida el checkdigit ISO 11784, otros formatos) no está confirmada; se valida longitud/numeric por ahora.

### R9. Selección de animales para el export

**R9.1** El sistema deberá ofrecer por defecto el conjunto de animales "pendientes de declarar": animales del establecimiento activo con `tag_electronic` no nulo y sin fila en `sigsa_declarations` para ese establecimiento.

**R9.2** El sistema deberá permitir acotar el conjunto de pendientes por rodeo (filtro opcional: solo los pendientes de un rodeo específico).

**R9.3** El sistema deberá permitir acotar el conjunto de pendientes por rango de fechas de nacimiento (filtro opcional: `birth_date BETWEEN date_from AND date_to`).

**R9.4** El sistema no deberá filtrar por categoría del animal: cualquier animal con RFID no declarado es candidato (cubre terneros al destete Y adultos por reposición natural).

**R9.5** Cuando el conjunto de pendientes esté vacío (todos los animales ya declarados), el sistema deberá informarlo con un mensaje claro y ofrecer acceso al historial de exports (R12).

### R10. Re-export

**R10.1** El sistema deberá permitir que un usuario con los roles requeridos (R7) re-descargue un archivo ya generado desde el historial de exports (`export_log`), sin generar una nueva fila en `sigsa_declarations`.

**R10.2** El sistema deberá permitir marcar manualmente un animal como "ya declarado" (crear la fila en `sigsa_declarations` sin generar un archivo nuevo), para cubrir el caso de declaraciones realizadas por otros medios (ej. en oficina SENASA, o por SIGBIOTRAZA directamente). Solo usuarios con rol `owner` o `veterinarian` pueden marcar manualmente un animal como declarado (mismo gate que R7.2).

**R10.3** *(POST-MVP — diferida en el veto del leader 2026-06-13.)* La **re-declaración por corrección** (incluir en un TXT nuevo animales ya declarados y actualizar su `export_log_id`) queda **fuera del MVP**: contradice R3.4 (el marcador registra solo la primera declaración y no se modifica) y agrega complejidad sin caso de uso confirmado. En MVP: un animal ya declarado no reaparece en pendientes (R9.1) y solo se puede re-descargar el archivo original (R10.1). Si surge la necesidad real, se refina en un Gate 0 aparte.

### R11. Audit trail

**R11.1** El sistema deberá registrar en `export_log` cada generación de archivo: qué establishment, quién generó, cuándo, cuántos animales, qué filtros se aplicaron, y el contenido del archivo.

**R11.2** El sistema deberá registrar en `sigsa_declarations` la primera declaración de cada par (establecimiento, animal), incluyendo la referencia al `export_log` que la originó y quién la declaró.

**R11.3** El sistema no deberá borrar entradas de `export_log` ni de `sigsa_declarations` desde el cliente. Estas tablas son de solo-append desde la app.

### R12. Historial de exports y lista de pendientes

**R12.1** El sistema deberá exponer una pantalla de "Exportar SIGSA" que muestre:
- La lista de animales pendientes de declarar (filterable por rodeo y por rango de fecha, R9).
- Un botón para generar el archivo de los pendientes seleccionados.
- Acceso al historial de exports pasados (`export_log`).

**R12.2** En el historial de exports, el sistema deberá mostrar para cada entrada: fecha/hora, quién generó, cantidad de animales, y la opción de re-descargar (R10).

**R12.3** El sistema deberá mostrar el badge de "declarados" en la lista de animales del establecimiento para que sea visible qué animales ya están cubiertos.

### R13. Share sheet + checklist recordatorio

**R13.1** Cuando el archivo TXT esté generado, el sistema deberá presentarlo vía share sheet nativa del SO (iOS Share Sheet / Android Share Intent), permitiendo al usuario guardarlo en archivos, enviarlo por mail o WhatsApp, o abrirlo en cualquier app compatible.

**R13.2** Junto con el share sheet, el sistema deberá mostrar un checklist recordatorio de los 4 datos que el productor debe completar en pantalla en SIGSA web (NO van en el archivo):
1. RENSPA del establecimiento.
2. Especie (bovinos, para el MVP).
3. Fecha de aplicación.
4. Motivo de declaración (acta de vacunación aftosa, novedad de nacimiento o reinscripción RENSPA).

**R13.3** Si el establecimiento tiene `renspa` guardado (R2), el checklist deberá pre-popularlo en el ítem 1 para facilitar la tarea del productor. Si no tiene RENSPA guardado, deberá mostrar un CTA para completarlo en la configuración del establecimiento.

**R13.4** El checklist deberá incluir una nota sobre el plazo: "Recordá declararlos dentro de los 10 días hábiles de ocurrida la novedad (Art. 8°, Res. 841/2025)".

### R14. Offline-first

**R14.1** El sistema deberá generar el archivo TXT de forma local (sin internet), leyendo los datos del SQLite local de PowerSync. La generación no deberá requerir un round-trip al servidor.

**R14.2** El sistema deberá registrar la fila en `sigsa_declarations` y en `export_log` vía PowerSync (cola de sync); si el dispositivo está offline, esos inserts quedan en cola y se sincronizan al volver la conexión. Las sync rules de `sigsa_declarations` y `export_log` deberán escopar la sincronización al `establishment_id` donde el usuario tiene rol activo (`org_scope`), usando el patrón JOIN-free del repo (ver `sync-streams/rafaq.yaml`). El `export_log.file_content` (TXT con RFIDs) no deberá sincronizarse más allá del establecimiento del usuario.

**R14.3** Mientras el cliente esté offline, el sistema deberá poder mostrar el historial de exports que ya estén sincronizados en el SQLite local.

### R15. Multi-tenant

**R15.1** Todas las tablas nuevas de esta spec (`breed_catalog`, `sigsa_declarations`, `export_log`) deberán tener `establishment_id` (directo o transitivo) y RLS scoped por `has_role_in(establishment_id)`. El scope de PowerSync para `sigsa_declarations` y `export_log` deberá definirse explícitamente en `sync-streams/rafaq.yaml` usando el `org_scope` estándar del repo (no más amplio).

**R15.2** El sistema deberá garantizar que un usuario no pueda ver ni generar exports de un establecimiento donde no tiene rol activo.

**R15.3** La columna `establishments.renspa` (R2) deberá estar sujeta a las mismas RLS policies que el resto de `establishments` (ya cubierto por spec 01 + RLS existente), más la restricción adicional de escritura a solo `owner` (R2.3).

---

## Decisiones abiertas para Puerta 1 (resolver al aprobar)

> Surgidas del veto del leader (2026-06-13). No bloquean la redacción; Raf las cierra al revisar la spec.
>
> **ESTADO (2026-06-13, sesión de pre-resolución, terminal paralela)**: Raf cerró 1, 2 y 4. La 3 queda **ABIERTA** (Raf pidió explicación + consulta a Facundo). Ítems de Facundo anotados en `CONTEXT/07-pendientes.md`.

1. **Raza desconocida: ¿bloquear o `OR`?** → ✅ **RESUELTA (Raf, 2026-06-13): soft-block + `OR` de un tap.** Se mantiene el bloqueo por `breed_id` NULL (animal queda "a completar", nunca se exporta silencioso, R8.2) PERO el `BreedPicker` bovino expone `OR` (Otra Raza) como opción de un tap (ya está en el seed bovino; `S/E` queda fuera del picker bovino por ser `generic`). Así "no sé la raza" no choca con el plazo de 10 días hábiles. **Pendiente Facundo** (no bloquea): confirmar si SENASA espera `OR` o `S/E` para desconocida en el flujo de declaración de dispositivos (ambos son códigos oficiales; riesgo bajo). Afecta T13 (BreedPicker), capa de UI diferida.
2. **R10.2 (marcar declarado a mano)**: → ✅ **RESUELTA (Raf, 2026-06-13): ENTRA al MVP.** Owner/vet pueden marcar un animal como ya declarado sin generar archivo (declaraciones hechas por oficina SENASA / SIGBIOTRAZA directo). Razón: sin esto, esos animales aparecen como "pendientes" para siempre → ruido que mina la lista de pendientes (el valor central de la feature). El backend ya lo soporta entero (INSERT en `sigsa_declarations`, gateado); se cablea la UI al construir la capa diferida (T19). R10.2 queda firme (no tentativa).
3. **RENSPA único global**: → ✅ **RESUELTA (Raf, 2026-06-24): texto opcional, SIN unique de ningún tipo.** El `renspa` queda como columna nullable validada solo por largo (CHECK 1-20 chars) + escritura owner-only vía RPC `update_renspa`. **Sin** unique global ni por-dueño. Razón: el unique global causaba colisión cross-tenant (usuario A bloqueado por un RENSPA de B que no ve → error confuso + fuga de existencia, LOW-4 de Gate 1) en casos legítimos (venta del campo, contador+dueño), y el RENSPA **ni va en el TXT** (R2.4, es solo recordatorio en pantalla). Recomendación del leader (más fuerte que "único por dueño"): un dueño podría tener legítimamente el mismo RENSPA en dos registros — no lo sabemos hasta Facundo — y no hay caso de uso MVP para unicidad; es trivial agregar el índice post-MVP, doloroso sacarlo si la data ya lo violó. La unicidad como **señal anti-fraude** queda POST-MVP (`CONTEXT/07-pendientes.md`), atada a que Facundo confirme si el RENSPA es 1:1 estricto o repetible/transferible. Decisión que **desacopla el MVP de Facundo** (su respuesta solo importa para el anti-fraude futuro). Relajar NO reabre Gate 1 (saca superficie, no agrega).
4. **GATE DURO de formato**: → ✅ **RESUELTA (Raf, 2026-06-13): lo hace Facundo.** Facundo hace un upload de prueba (2-3 animales) a SIGSA web con su clave fiscal y reporta las 5 incógnitas (¿`;` final?, ¿espacios?, ¿rango de fechas?, validación exacta del RFID, ¿mayúsc/minúsc?). Gatea el flip a `done` de feature 08 (NO bloquea construir las capas restantes contra los defaults documentados; el generador es swappable). Anotado en `CONTEXT/07-pendientes.md`. ⚠ La tabla de razas se saca de la pantalla de DECLARACIÓN DE DISPOSITIVOS, no la de movimiento (trampa del código `SI`, ver `razas-senasa-codigos.md` s25). ⚠ **RIESGO a confirmar ANTES del upload (leader, 2026-06-24)**: SIGSA es el sistema de compliance del gobierno — hay que confirmar si el upload con clave fiscal es un **preview/dry-run** o una **declaración legal firme** ante SENASA (Art. 8°, plazo de 10 días hábiles). Si es firme, Facundo NO debe usar RFIDs inventados (quedarían declarados); debe usar caravanas reales que efectivamente quiera declarar de su campo, o credenciales de test de SENASA. Esto condiciona el timing del gate.

## Historial de refinamiento

> Audit trail de refinamientos. No se borra.

- **2026-06-13 — Fold de Gate 1 (FAIL 2 HIGH/4 MEDIUM)**: aplicados 6 findings del security_analyzer (modo spec). Cambios en requirements: (1) **R2.3** ampliado — escritura de `renspa` se canaliza vía RPC `update_renspa` SECURITY DEFINER (MEDIUM-1). (2) **R3.6** nuevo — trigger server-side que fuerza `declared_by = auth.uid()` (HIGH-1). (3) **R3.7** nuevo — WITH CHECK de `sigsa_declarations_insert` verifica que `animal_profile_id` pertenece al `establishment_id` (MEDIUM-4). (4) **R4.1** ampliado — `file_content` tope 5 MB y `file_name` tope 255 chars por CHECK de DB (HIGH-2). (5) **R4.4** nuevo — trigger server-side que fuerza `generated_by = auth.uid()` (HIGH-1). (6) **R10.2** ampliado — restricción explícita a owner/vet para `markAsDeclared` (MEDIUM-3). (7) **R14.2** ampliado — sync rules explícitas con `org_scope` para `sigsa_declarations` y `export_log` (MEDIUM-2). (8) **R15.1** ampliado — sync scope PowerSync explícito (MEDIUM-2). Cambios en design.md: migrations 0092/0093/0094 y sección PowerSync actualizadas (ver Changelog de design.md). Cambios en tasks.md: tests de HIGH-1/HIGH-2/MEDIUM-3/MEDIUM-4 agregados a T5/T6/T7/T19.
- **2026-06-13 — Puerta 1 APROBADA por Raf (terminal paralela)**: Raf aprobó la spec 08 (`spec_ready` + Gate 1 PASS). La aprobación es a nivel requirements/design; las 4 "Decisiones abiertas para Puerta 1" NO se cerraron acá — quedan documentadas para resolverse al implementar (Ola 4). En particular, el **GATE DURO de formato** sigue exigiendo upload real / login SIGSA con clave fiscal (Raf/Facundo) antes de cerrar 08 como `done`. El flip de `feature_list.json` (`context_ready`→`spec_ready`, con nota "Puerta 1 aprobada") sigue **diferido a reconvergencia de terminales** (la otra terminal está editando el JSON con feature 9). Si las decisiones 1/2 cambian la superficie de seguridad al implementar, re-correr Gate 1 puntual sobre el delta.
- **2026-06-13 — Veto del leader (terminal paralela)**: tras la redacción, el leader vetó la spec. Fixes aplicados directamente: (1) **bug de RLS** en `sigsa_declarations` — la policy de SELECT referenciaba `deleted_at IS NULL` sobre una columna inexistente → habría fallado al crear la tabla (corregido en design.md, migration 0093). (2) **R10.3** (re-declaración por corrección) DIFERIDA a post-MVP por contradecir R3.4 y no tener caso de uso confirmado (tasks T11 + tabla de trazabilidad actualizadas). Verificado: los 28 códigos de raza coinciden 1:1 con `razas-senasa-codigos.md` (sin invención). 4 decisiones abiertas registradas arriba para Puerta 1.
- **2026-06-13 — Redacción inicial (terminal paralela)**: spec_author redactó los 3 archivos de spec 08 en modo terminal paralela mientras feature 09 estaba activa en otra terminal. Status flip a `spec_ready` en `feature_list.json` **DIFERIDO** a reconvergencia de terminales (no se tocó `feature_list.json` para evitar conflicto con la otra terminal dueña de feature 09). La spec está completa y lista para revisión humana; el flip de status es el único paso pendiente.
