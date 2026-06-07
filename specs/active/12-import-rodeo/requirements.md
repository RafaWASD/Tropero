# Spec 12 — Importación masiva de rodeo — Requirements

**Status**: spec_ready — **Gate 1 (security) PASS 0 HIGH** (2026-06-06, `progress/security_spec_12-import-rodeo.md`); pendiente Puerta 1 humana (Raf).
**Fecha**: 2026-06-06 (sesión 23).
**Autor**: spec_author. Findings de Gate 1 (4 MEDIUM + 1 LOW, ninguno bloquea) foldeados por el leader: MEDIUM-1→R9.5, MEDIUM-2→R11.4/R11.5, MEDIUM-4→R3.7 (+backlog); MEDIUM-3/LOW-1→design §6/§3.2.
**Fuente de verdad**: `specs/active/12-import-rodeo/context.md` (Gate 0 APROBADO por Raf, 2026-06-01). Las 3 decisiones lockeadas (fuentes Excel/CSV + TXT SIGSA · categoría columna+override · censo de identidad) y los defaults del leader (online MVP, owner+vet, un rodeo/corrida, skip-and-report, dedup blanda reusada de 09, `import_log`, eventos/linaje/SIGSA-declared fuera) NO se reabren acá: se traducen a EARS.

## Historial de refinamiento

- **2026-06-06 — Creación inicial.** Traducción del `context.md` (Gate 0) a EARS/design/tasks. Cada "Caso y decisión" del Gate 0 quedó cubierto por ≥1 `R<n>` (mapa en §Trazabilidad). El leader detectó 7 reforzamientos de seguridad/diseño que el contexto sub-pondera (límites de input/anti-DoW, seguridad del parser de planillas, campos forzados server-side, dedup pre-check contra constraints, modelo de categorías post-Tier-2, reuso de artefactos reales, entry point sobre flujos cerrados); se hornean como requirements explícitas (R3 límites de input, R9 escritura/campos forzados, R7 dedup) y secciones de design. **Disclaimers de tentatividad**: la **forma real de la planilla del productor** (qué columnas trae) está sin validar con Facundo / sin archivo real del beta → la auto-detección de headers (R4) y los defaults de mapeo llevan disclaimer (mismo patrón que R14 de spec 02 / UI tentativa de spec 09). El **catálogo controlado de razas** depende de feature 08 (no implementada) → la raza importada degrada a `breed` texto libre (R6); cuando 08 aterrice se migra (dependencia, no bloqueante, ya resuelta en el contexto).

## Resumen

Camino **masivo** de carga inicial del padrón que el find-or-create de spec 02/09 deja explícitamente afuera: el **usuario nuevo con rodeo entero** (caso del beta de Chascomús — rodeo existente con caravana visual + planilla, TAGs electrónicos aún sin colocar). El operador sube **un archivo** (Excel/CSV con mapeo de columnas, o TXT de SIGSA ya mapeado), el sistema **parsea local**, valida por fila, muestra un **preview** (válidos / errores / duplicados), y al confirmar **escribe en lote** `animals` + `animal_profiles` en **un rodeo** del establecimiento activo, con **import parcial** (skip-and-report). Queda audit en `import_log`.

**Censo de IDENTIDAD, no de historial**: por animal entran TAG / IDV / visual_id_alt (≥1, ADR-005) + sexo + fecha de nacimiento + raza + categoría + lote (opcional). **NO** entran eventos, pesos, sanitario, reproductivo, vínculo madre-ternero, ni campos de plantilla. El historial se acumula después por manga.

**Online en MVP** (es setup): el parseo del archivo es local; la escritura de N animales es online. PowerSync no entra en esta feature (consistente con ops de identidad de spec 09 R9.2).

Esta spec **consume** el sustrato as-built de spec 02 (tablas `animals`/`animal_profiles`, constraints de unicidad, RLS de 0022, categorías de cría post-Tier-2 de 0059/0062, CHECK char_length de 0070), la **detección blanda de duplicados** de spec 02 R5.5/R5.6 (reusada vía spec 09), `isValidTag`/`normalizeTag` de `app/src/services/ble/parser-rs420.ts` (spec 04 R8), y la **tabla de 32 códigos de raza SENASA** ya extraída en `specs/active/08-export-sigsa/razas-senasa-codigos.md`. **No** redefine el modelo de datos salvo la tabla nueva `import_log` (audit).

## Decisiones tomadas (del Gate 0, no se reabren)

- **Dos fuentes**: (1) Excel/CSV con mapeo de columnas (auto-detección + ajuste manual) — fuente primaria, la planilla del productor; (2) TXT de SIGSA (`RFID-SEXO-RAZA-MM/AAAA;…`) — estructura fija, sin mapeo manual. **RENSPA/descarga directa de SIGSA = fuera de MVP.**
- **Categoría desde columna con `category_override = true`** (en el import no hay eventos de los que el trigger de ADR-008 pueda auto-calcular el estado biológico; el override evita que un recálculo posterior pise la categoría declarada).
- **Censo de identidad** (no eventos): TAG/IDV/visual_id_alt (≥1) + sexo + fecha + raza + categoría + lote opcional.
- **Un rodeo por corrida**: el operador elige el rodeo destino (1 rodeo → fijo; ≥2 → selección); todos los animales del archivo heredan ese `rodeo_id`. Para otro sistema productivo se corre de nuevo.
- **Roles**: owner + veterinario pueden importar. `field_operator`: no (default, confirmable).
- **Import parcial (skip-and-report)**: los válidos entran; los inválidos/duplicados se reportan para corregir y reimportar. NO all-or-nothing.
- **Dedup intra-archivo + contra existentes**: skip + report (no update silencioso, no abortar el lote).
- **Entry point**: flag de onboarding (tras crear campo + rodeo) + re-ejecutable desde Rodeos / Más.
- **Audit**: tabla `import_log` (archivo, conteos, errores, quién, cuándo), scoped por establishment (RLS).
- **Fuera de MVP**: importar eventos/historial, vínculo madre-ternero/linaje, auto-marcar `sigsa_declared_at`, descarga directa de SIGSA/RENSPA, campos extendidos (`entry_*`, pelaje, dientes, `is_cut`, `birth_weight`) y datos de plantilla, offline.

### Puerta 1 (Raf, 2026-06-06) — decisiones de las 3 abiertas del design §9

- **D1 = SÍ, `.xlsx` en el MVP** (no solo CSV/TXT). Implica: parser de Excel **vetado/parcheado obligatorio** (R3.8) — NO la versión npm de `xlsx` con CVEs. CSV sigue siendo el camino primario/recomendado en la UI; `.xlsx` se soporta con la librería vetada.
- **D2 = Escenario B — RPC bulk `SECURITY DEFINER`** (no inserts directos). El RPC `import_rodeo_bulk` es ahora parte FIRME del diseño (R9.4 deja de ser condicional): atomicidad por animal (sin huérfanos) + bloqueo de `field_operator` a nivel DB para la escritura masiva. Dispara los 5 controles de Gate 1 (design §6-B, ya revisados PASS) que Gate 2 (code) va a verificar.
- **D3 = se cierra con Facundo** (placeholder de categoría "a completar"). El implementer usa el default **por sexo** (`torito`/`novillito` machos, `vaquillona` hembras; `category_override = false`) mientras tanto (R10.5); se ajusta cuando Raf lo cierre con Facundo. No bloquea la implementación.

## Requirements (EARS)

> **Convención de tentatividad UI**: las requirements de UI/UX concretas (layout del flujo de import, render del preview, copy) son **TENTATIVAS** hasta cerrar el design system (mismo patrón que R14 de spec 02 / R1-R8 de spec 09). Llevan el marcador `[UI TENTATIVA]`. Las requirements de **contrato de datos, validación, límites de input, seguridad y comportamiento** son **definitivas**.

### R1. Entry point del importador

**R1.1** El sistema deberá exponer el flujo de importación masiva desde la pantalla de Rodeos (o "Más") del establecimiento activo, re-ejecutable las veces que el operador quiera. *(El entry point se cablea sobre los flujos ya cerrados: la pantalla de Rodeos de spec 02 C1 y la nav de spec 01 — esta spec NO los reimplementa.)*

**R1.2** Cuando el operador completa el onboarding inicial creando su primer campo y su primer rodeo (spec 01 Fase 4 + spec 02 C1, ya committeados), el sistema deberá ofrecerle un CTA explícito para importar su rodeo existente (flag de onboarding), que abre el mismo flujo de R1.1.

**R1.3** `[UI TENTATIVA]` El sistema deberá presentar el flujo de importación en pasos discretos (una decisión por pantalla, principio de velocidad operativa): elegir fuente/archivo → mapear columnas (solo CSV/Excel) → revisar preview → confirmar → ver resultado.

**R1.4** Mientras el establecimiento activo no tenga al menos un rodeo activo, el sistema deberá bloquear el flujo de importación con un mensaje accionable que lleve al wizard de creación de rodeo (no existe rodeo autogenerado; consistente con R6.4 de spec 09).

### R2. Selección de rodeo destino y roles

**R2.1** El sistema deberá requerir que el operador seleccione exactamente **un** rodeo destino del establecimiento activo antes de escribir, y todos los animales importados en esa corrida deberán heredar ese `rodeo_id`.

**R2.2** Si el establecimiento activo tiene exactamente un rodeo activo, el sistema deberá preseleccionarlo y mostrarlo read-only (sin selección).

**R2.3** Si el establecimiento activo tiene dos o más rodeos activos, el sistema deberá ofrecer un control de selección de rodeo destino.

**R2.4** El sistema deberá permitir iniciar una corrida de importación únicamente a usuarios con rol `owner` o `veterinarian` activo en el establecimiento de destino. Si el usuario tiene únicamente rol `field_operator`, el sistema no deberá ofrecer el flujo de importación.

**R2.5** El sistema deberá derivar el `system_id` para la resolución de categoría exclusivamente del rodeo destino seleccionado (no del archivo, no del cliente), respetando la ortogonalidad de ADR-020 (el import setea `category_id` sin tocar `rodeo_id` por animal ni inferir el sistema de los datos).

### R3. Límites de input / anti-DoW (definitiva — reforzamiento crítico)

> El archivo importado es **input no confiable a escala**. El parseo en el cliente NO es la capa autoritativa contra abuso: la DB lo es (CHECK char_length de la migración `0070`, R9.5). Estos topes son DUROS: el sistema rechaza-y-reporta, NO trunca en silencio.

**R3.1** El sistema deberá rechazar todo archivo cuyo tamaño en bytes exceda un tope máximo configurable (default propuesto: **5 MB**), mostrando un mensaje accionable, antes de parsear su contenido.

**R3.2** El sistema deberá rechazar toda importación cuyo archivo contenga más filas de datos que un tope máximo de filas por corrida (default propuesto: **5000** filas), mostrando un mensaje accionable que indique el tope y la cantidad detectada, sin truncar el archivo en silencio. *(Gate 2 SEC-12B-HIGH-01: este tope de 5000 filas se enforça **también server-side en el RPC `import_rodeo_bulk`** (R9.4-d), no solo en el cliente — el cliente es UX/bypasseable con curl, la DB/RPC es la capa autoritativa contra DoW/amplificación, consistente con R9.5. Si el cliente chunkea por debajo de 5000, cada chunk respeta el mismo tope.)*

**R3.3** El sistema deberá aplicar el tope de filas de R3.2 **antes** de materializar todas las filas en memoria (cap durante el parseo, no después), para que un archivo gigante no congele la app ni la deje sin memoria. *(El cap del cliente es la primera barrera de UX/performance; el RPC lo replica como tope DURO autoritativo — R3.2/R9.4-d.)*

**R3.4** Por cada campo de texto parseado de cada fila, el sistema deberá validar en el cliente que su largo no exceda el tope server-side autoritativo de la columna destino (espejo de los CHECK `char_length` de la migración `0070`: `idv` ≤ 64, `visual_id_alt` ≤ 64, `breed` ≤ 64, `coat_color` ≤ 64, `tag_electronic` ≤ 64, `notes` ≤ 4000, `entry_origin` ≤ 120). Una fila con un campo que excede su tope deberá marcarse como error de fila (R5) y NO escribirse.

**R3.5** El sistema deberá tratar todo valor parseado del archivo (headers, celdas, registros del TXT) como **no confiable**: no deberá ejecutarlo, interpretarlo como fórmula, ni usarlo para construir queries/filtros sin neutralizar metacaracteres, consistente con la defensa del buscador (spec 13 F1-1).

**R3.6** Si el parseo del archivo falla (formato corrupto, encoding inválido, archivo no reconocido como CSV/XLSX/TXT-SIGSA), entonces el sistema deberá abortar la corrida con un mensaje accionable y no deberá escribir ningún animal.

**R3.8** *(Puerta 1 D1 = `.xlsx` en MVP.)* Donde el sistema parsee `.xlsx`, deberá usar una librería de parseo **vetada y parcheada** contra los CVEs conocidos (prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363) — concretamente la distribución oficial mantenida de SheetJS (`https://cdn.sheetjs.com/`, ≥0.20.2) **NO** la versión npm `xlsx` desactualizada/vulnerable, o una librería equivalente auditada. El parseo `.xlsx` deberá aplicar el mismo cap de filas/celdas ANTES de materializar (R3.3) y tratar todo valor como no confiable (R3.5). Gate 2 (code) deberá verificar que no se usa una versión con CVE conocido. CSV sigue siendo el camino primario/recomendado (menor superficie).

**R3.7** *(Control diferido — Gate 1 MEDIUM-4.)* Los topes R3.1-R3.4 acotan **una** corrida, pero NO la **frecuencia** de corridas (un usuario autenticado podría disparar muchas seguidas = DoW por reintentos). Para MVP esto es **aceptable** (es una op de oficina, no un endpoint público; mismo-tenant; la escala ya es posible vía alta unitaria). Queda anotado como control diferido (rate-limit de frecuencia de import por usuario/establecimiento) en `docs/backlog.md`; se evalúa si el abuso real lo amerita.

**R3.9** *(As-built — robustez es-AR.)* Donde el sistema parsee CSV, deberá **auto-detectar el delimitador de campos** mirando el primer registro (header): elige entre coma, punto y coma o tabulación el de mayor frecuencia FUERA de comillas, con default a coma ante empate o ausencia (retrocompat total). Excel en locale es-AR/es-ES exporta CSV con `;` como separador de listas; sin esta detección, la planilla real del productor del beta se leería como una sola columna. El sniff respeta el quoting RFC-4180 y está acotado (`SNIFF_LIMIT`, anti-DoW consistente con R3.3). Implementado en `detectDelimiter` de `parse-csv.ts`.

### R4. Fuente CSV/Excel: mapeo de columnas

> `[UI TENTATIVA]` para layout/copy del mapeo; **definitiva** para el contrato de campos mapeables y la normalización.

**R4.1** Cuando el operador elige la fuente CSV/Excel y sube un archivo, el sistema deberá leer la fila de headers y **auto-detectar** un mapeo tentativo de cada columna del archivo a un campo del censo (`tag_electronic`, `idv`, `visual_id_alt`, `sex`, `birth_date`, `breed`, `category`, `lote`), por coincidencia de nombre de header. *(La heurística de auto-detección y sus sinónimos son TENTATIVOS hasta validar la forma real de la planilla del productor con Facundo / un archivo del beta — disclaimer.)*

**R4.2** El sistema deberá permitir al operador **ajustar manualmente** el mapeo de cada columna (incluyendo dejar columnas sin mapear) antes de validar, y deberá persistir el mapeo elegido para la corrida.

**R4.3** El sistema deberá mapear la columna de **sexo** de forma tolerante a la planilla (al menos `M`/`H`, `macho`/`hembra`, `toro`/`vaca` y sus variantes de caso) al enum `male`/`female`. Una fila cuyo valor de sexo no resuelve a `male`/`female` deberá marcarse como error de fila (R5).

**R4.4** El sistema deberá parsear la columna de **fecha de nacimiento** tolerando al menos los formatos `DD/MM/AAAA`, `MM/AAAA` y `AAAA`, produciendo un `birth_date` (`YYYY-MM-DD`; cuando solo hay mes/año o año, se completa al primer día del período). Una fecha que no parsea con ninguno de los formatos soportados deberá dejar `birth_date` en `NULL` (la fecha es nullable, no bloquea la fila).

**R4.5** El sistema deberá normalizar la columna de **TAG/RFID** (si está mapeada) con `normalizeTag` y validarla con `isValidTag` de `app/src/services/ble/parser-rs420.ts` (ISO 11784/11785 FDX-B, 15 dígitos). Si el TAG no pasa `isValidTag`, entonces el sistema no deberá usar ese valor como `tag_electronic` y la fila deberá resolverse por otro identificador (R5.1); si la fila no tiene otro identificador, deberá marcarse como error "a completar".

### R5. Validación por fila + preview

**R5.1** El sistema deberá marcar como **error "a completar"** toda fila que no resuelva al menos uno de `tag_electronic` (válido por R4.5), `idv` o `visual_id_alt` no vacíos (ADR-005 — requisito de identificación).

**R5.2** El sistema deberá marcar como **error de fila** toda fila a la que le falte el sexo o cuyo sexo no sea mapeable a `male`/`female` (R4.3 — el sexo es requerido).

**R5.3** El sistema deberá producir, antes de escribir nada, un **preview** con los conteos: filas **válidas** (escribibles), filas con **error** (no escribibles, con el motivo por fila), y filas **duplicadas** (R7).

**R5.4** `[UI TENTATIVA]` El sistema deberá presentar el preview con el desglose por motivo de cada fila no escribible (identificador faltante, sexo faltante/no mapeable, campo fuera de tope R3.4, duplicado intra-archivo, duplicado contra existente) para que el operador corrija el archivo y reimporte.

**R5.5** El sistema deberá requerir una **confirmación explícita** del operador sobre el preview antes de iniciar la escritura. Ninguna fila deberá escribirse antes de esa confirmación.

**R5.6** Si todas las filas del archivo resultan no escribibles (0 válidas), entonces el sistema deberá informarlo y no deberá iniciar escritura ni crear un `import_log` de éxito vacío con conteo `imported_ok > 0`.

### R6. Mapeo de raza

**R6.1** El sistema deberá guardar la raza importada en `animal_profiles.breed` como **texto libre** (estado as-built del modelo: `breed` es `text`, el catálogo controlado de razas de feature 08 aún no está implementado). *(Disclaimer: cuando feature 08 aterrice el catálogo controlado, las razas importadas se migran best-effort al catálogo — dependencia documentada, no bloqueante.)*

**R6.2** Cuando la fuente es el **TXT de SIGSA**, el sistema deberá leer el campo `RAZA` por **posición** (no por contenido — la letra `H` significa Hembra en posición SEXO y Hereford en posición RAZA), y deberá resolver el código SENASA a un nombre de raza legible best-effort usando la tabla de `specs/active/08-export-sigsa/razas-senasa-codigos.md`; si el código no está en la tabla, deberá guardar el código tal cual en `breed`.

**R6.3** El sistema no deberá rechazar una fila por raza ausente o no reconocida: `breed` es opcional y nunca bloquea la fila.

### R7. Dedup (intra-archivo + contra existentes) — pre-check contra constraints

> Reusa la **detección blanda** de spec 02 R5.5/R5.6 (vía spec 09) y la regla **TAG no reusable** (R5.6 de spec 02). El dedup PRE-CHEQUEA contra los constraints de unicidad as-built (`animal_profiles.idv` único por establishment — índice `animal_profiles_idv_unique` de `0020`; `animals.tag_electronic` único global — índice `animals_tag_unique` de `0019`) **antes** del batch insert, para que una colisión reporte-y-saltee en vez de abortar el lote.

**R7.1** El sistema deberá detectar **duplicados intra-archivo**: dos o más filas del mismo archivo con el mismo `idv` (no vacío) o el mismo `tag_electronic` (válido). Por default, todas las filas de un grupo de colisión intra-archivo deberán marcarse como conflicto "a completar" (ninguna se escribe sin resolución del operador).

**R7.2** El sistema deberá pre-chequear cada fila válida contra los animales **existentes** del establecimiento activo: si su `idv` ya existe en un `animal_profiles` activo del establecimiento, o su `tag_electronic` ya existe en un `animals` (global, no soft-deleted), entonces la fila deberá marcarse como **duplicado contra existente** y saltearse (skip), sin actualizar el animal existente ni abortar el lote.

**R7.3** El sistema deberá reportar las filas saltadas por R7.1/R7.2 en el preview (R5.3) y en el resultado (R8), distinguiendo duplicado intra-archivo de duplicado contra existente, para que el operador decida (corregir el archivo y reimportar, o cargarlas a mano).

**R7.4** El sistema no deberá reutilizar un `tag_electronic` que ya está asignado a otro `animals` (R5.6 de spec 02 — TAG no reusable): una colisión de TAG contra un animal existente es siempre skip + report, nunca reasignación.

### R8. Escritura en lote (import parcial) + resultado

**R8.1** Cuando el operador confirma el preview (R5.5), el sistema deberá escribir en lote únicamente las filas válidas y no-duplicadas, creando por cada una un `animals` (global) + un `animal_profiles` (presencia en el rodeo destino) — el censo de identidad de R10.

**R8.2** El sistema deberá realizar la escritura como **import parcial**: las filas escribibles entran aunque otras fallen; una falla puntual de escritura (ej. una colisión de unicidad que se cuela por carrera) deberá saltearse y reportarse, sin abortar las demás (NO all-or-nothing).

**R8.3** El sistema deberá producir, al finalizar, un **resultado** con los conteos: total de filas del archivo, escritas OK, con error, duplicadas/saltadas, y el detalle de errores por fila.

**R8.4** Si una fila escribible falla en la escritura por una violación de unicidad detectada recién en el server (carrera entre el pre-check de R7 y el insert), entonces el sistema deberá registrar esa fila como error en el resultado (R8.3) y en `error_details` del `import_log` (R11), sin afectar las filas ya escritas.

### R9. Campos forzados server-side + escritura segura (definitiva — reforzamiento crítico)

> Lección A1-1 / `created_by` de feature 13 + Gate 2 de spec 02: `establishment_id`, autoría y el binding del rodeo destino NO se confían del cliente.

**R9.1** El sistema deberá asociar cada `animal_profiles` importado al `establishment_id` del establecimiento activo (del `EstablishmentContext`), nunca a un `establishment_id` provisto en el archivo. El archivo no deberá poder dirigir la escritura a otro establecimiento.

**R9.2** El sistema deberá garantizar que el `rodeo_id` destino de toda fila escrita **pertenece al establecimiento activo**: una corrida no deberá poder escribir `animal_profiles` con un `rodeo_id` de otro establecimiento, aun si el cliente lo intentara.

**R9.3** El sistema deberá registrar la autoría del import (`imported_by` en `import_log`, R11) y el `created_by` de cada `animal_profiles` con la identidad autenticada del operador (`auth.uid()`), forzada server-side por el trigger `tg_force_created_by_auth_uid` ya existente (`0043`), ignorando cualquier valor de autoría que viniera en el payload.

**R9.4** *(FIRME — Puerta 1 D2 = Escenario B.)* El RPC de bulk-insert `import_rodeo_bulk` `SECURITY DEFINER` deberá re-validar adentro `has_role_in(establishment_id)` con rol `owner` o `veterinarian` (R2.4) y deberá verificar que el `rodeo_id` destino pertenece a ese `establishment_id`, antes de insertar; un caller sin ese rol deberá ser rechazado. Además el RPC deberá: (a) setear `establishment_id`/`created_by`/`imported_by` **server-side** dentro del RPC (no leerlos del payload de filas — lección A1-1/SEC-SPEC-03); (b) tener `EXECUTE` **revocado de `public`/`anon`** y `grant execute to authenticated` (lo llama el cliente directo, NO es service-role-only como el RPC de `0058` — matiz de Gate 1); (c) seguir enforçando los CHECK `char_length` (`0070`) y los unique adentro (no bypassarlos con `security definer`); (d) *(Gate 2 SEC-12B-HIGH-01)* enforçar un **tope DURO de filas por llamada server-side** (`jsonb_array_length(p_rows) <= 5000`, espejo de R3.2), **después** de la re-validación de rol y **antes** del loop, rechazando el **batch entero** (no skip-and-report) si lo excede. El cap del cliente (R3.2/R3.3) es UX/bypasseable con curl; el RPC `SECURITY DEFINER` es la frontera server-side autoritativa contra DoW/amplificación (consistente con R9.5: la DB es la capa autoritativa, no el cliente). *(Los 6 controles están en design §6-B; Gate 2 los verifica.)*

**R9.5** El sistema deberá apoyarse en los CHECK `char_length` server-side de la migración `0070` y en los constraints de unicidad (`animals_tag_unique`, `animal_profiles_idv_unique`) como **capa autoritativa final**: la validación del cliente (R3.4, R7) es barrera de UX/performance, pero la DB es la que enforce. Una fila que escape la validación del cliente deberá ser rechazada por la DB sin corromper datos. *(Gate 1 MEDIUM-1: el CHECK de `tag_electronic` (`0070`) está como `NOT VALID` — grandfather de data e2e legacy — pero **igual enforça los INSERTs nuevos** del import, así que sigue siendo capa autoritativa para esta feature. El implementer NO debe "arreglarlo" a `VALIDATE` (rompería la data legacy) ni omitir el test de que un TAG >64 es rechazado en el insert del import.)*

### R10. Censo de identidad (qué se escribe por animal)

**R10.1** El sistema deberá escribir por cada fila válida, en `animals`: `species_id` (derivado del rodeo destino, no del archivo), `sex` (`male`/`female`, R4.3), `tag_electronic` (si la fila trae un TAG válido por R4.5; `NULL` si no), `birth_date` (si parsea, R4.4; `NULL` si no).

**R10.2** El sistema deberá escribir por cada fila válida, en `animal_profiles`: `animal_id` (del `animals` recién creado), `establishment_id` (activo, R9.1), `rodeo_id` (destino, R2.1), `idv` (si viene), `visual_id_alt` (si viene), `breed` (texto libre, R6), `category_id` (R10.3), `category_override` (R10.3), `management_group_id` (lote, R10.4), `status = 'active'`.

**R10.3** Cuando la fila trae una columna de categoría que mapea a un `code` del catálogo `categories_by_system` del `system_id` del rodeo destino (modelo post-Tier-2 as-built: `ternero`, `ternera`, `vaquillona`, `vaquillona_prenada`, `vaca_segundo_servicio`, `multipara`, `cut`, `vaca_cabana`, `toro`, `torito`, `novillito`, `novillo`), el sistema deberá setear `category_id` a ese `code` y `category_override = true` (para que el trigger de recálculo de ADR-008 no repinte la categoría declarada). *(Mapeo contra el catálogo AS-BUILT — `0059`/`0062` —, NO el modelo de categorías pre-Tier-2.)*

**R10.4** Donde la fila trae una columna de **lote**, el sistema deberá matchear ese valor contra los `management_groups` activos del establecimiento por nombre y, si existe, setear `management_group_id`; si no existe un lote con ese nombre, el sistema **no** deberá crear el lote (default Gate 0: matchear, no crear) y deberá dejar `management_group_id` en `NULL`.

**R10.5** Cuando la fila no trae columna de categoría, o su valor no matchea ningún `code` del catálogo del sistema del rodeo destino, el sistema deberá resolver una categoría inicial de catálogo válida (la `category_id` es `NOT NULL`) **sin inferir por sexo/edad** la categoría declarada, marcando esa categoría como **"a completar"** (`category_override = false`, para que el recálculo del server la pueda ajustar después). *(El detalle de qué `category_id` concreta se usa como placeholder "a completar" — el default conservador del catálogo — se define en design; NO se infiere una categoría biológica específica en masa.)*

**R10.6** El sistema no deberá escribir eventos (peso, sanitario, reproductivo, condición, lab, observación), vínculos madre-ternero, ni campos extendidos (`entry_*`, `coat_color` salvo si se decide mapear, `teeth_state`, `is_cut`, `birth_weight`) ni datos de plantilla (`rodeo_data_config`): el import carga identidad, el resto se acumula después.

### R11. Audit: `import_log`

**R11.1** El sistema deberá registrar cada corrida de importación (incluyendo las que terminan con 0 escritas) en una tabla `import_log` con: `establishment_id`, `rodeo_id`, `file_name`, `file_format` (`csv` | `xlsx` | `sigsa_txt`), `total_records`, `imported_ok`, `imported_errors`, `error_details` (JSON con el detalle por fila), `imported_by`, `created_at`.

**R11.2** El sistema deberá scopear `import_log` por establishment vía RLS: un usuario solo deberá ver/escribir registros de `import_log` de establecimientos donde tiene rol activo (mismo patrón que las tablas scoped de spec 02).

**R11.3** El sistema deberá forzar `imported_by = auth.uid()` server-side al insertar un `import_log` (no confiar el valor del cliente), consistente con R9.3.

**R11.4** El sistema deberá topar el tamaño de `error_details` (jsonb) server-side con un CHECK `octet_length` (mismo patrón que `0070` para columnas jsonb), para que un archivo con miles de filas con error no genere un `error_details` sin límite. El sistema deberá topar también `file_name` server-side (CHECK `char_length(file_name) <= 255`) — viene del cliente.

**R11.5** El cliente deberá **acotar/truncar** el `error_details` antes de insertar el `import_log` para no chocar el CHECK de R11.4 (con miles de filas con error, el detalle por-fila completo puede exceder el tope): deberá guardar un resumen acotado (ej. conteo por motivo + un sample de las primeras N filas con error) en vez del detalle exhaustivo. *(Gate 1 MEDIUM-2: si el cliente manda un `error_details` que excede el CHECK, el INSERT del `import_log` falla y se pierde el audit de la propia corrida — el detalle exhaustivo de errores vive en el resultado en pantalla (R8.3), no necesariamente entero en el log.)*

### R12. Online + multi-tenant

**R12.1** El sistema deberá ejecutar el **parseo y la validación** del archivo localmente en el cliente (sin red), y la **escritura** de los animales online (es setup; PowerSync no entra en esta feature — consistente con R9.2 de spec 09).

**R12.2** Si el cliente está sin conexión al momento de confirmar la escritura (R5.5), entonces el sistema deberá informar que la importación requiere conexión y no deberá encolar la escritura para sync diferido (a diferencia de la carga de campo, el import es online por diseño).

**R12.3** El sistema deberá scopear toda la corrida al establecimiento activo del `EstablishmentContext` (R9.1): el archivo carga en el establecimiento activo; `import_log` y los animales respetan multi-tenancy vía RLS.

## Criterios de aceptación globales

Esta spec se considera implementada cuando:

- El operador sube un Excel/CSV, ajusta el mapeo de columnas (auto-detectado) y ve un preview de válidos/errores/duplicados antes de escribir (R4, R5).
- El operador sube un TXT de SIGSA (`RFID-SEXO-RAZA-MM/AAAA`) y se importa sin mapeo manual, leyendo RAZA por posición (R6.2).
- Cada fila resuelve ≥1 identificador (ADR-005); las inválidas se reportan y se saltan (skip-and-report), los válidos entran (R5.1, R8.2).
- El dedup intra-archivo y contra existentes pre-chequea los constraints de unicidad y saltea-y-reporta sin abortar el lote (R7).
- Un archivo que excede el tope de tamaño o de filas se rechaza con mensaje accionable, sin truncar en silencio ni congelar la app (R3.1, R3.2, R3.3).
- Un campo más largo que el tope server-side de su columna marca error de fila y no se escribe; la DB enforce el largo aunque el cliente fallara (R3.4, R9.5).
- `establishment_id`, autoría e `imported_by` se fuerzan server-side; el archivo no puede dirigir la escritura a otro establecimiento ni a un rodeo de otro establecimiento (R9.1, R9.2, R9.3).
- La categoría de columna setea `category_id` (catálogo post-Tier-2) + `category_override = true`; sin columna/sin match queda "a completar" sin inferir por sexo/edad (R10.3, R10.5).
- Queda audit de cada corrida en `import_log` (archivo, conteos, errores, quién, cuándo), scoped por establishment (R11).
- El entry point está disponible como flag de onboarding y re-ejecutable desde Rodeos/Más (R1).
- Conteo final: **R1..R12** (~50 criterios), con las requirements de UI/UX marcadas `[UI TENTATIVA]` y las de contrato/seguridad definitivas.

## Trazabilidad — cada "Caso y decisión" del Gate 0 → R<n>

| Caso / decisión del `context.md` | Cubierto por |
|---|---|
| Fuentes y formatos (decisión 1): Excel/CSV con mapeo | R4.1, R4.2 |
| Fuentes y formatos (decisión 1): TXT de SIGSA estructura fija | R6.2 (+ parse posicional), R10.1 |
| TXT trae RFID/sexo/raza/MM-AAAA, sin idv ni categoría → "a completar" | R5.1, R10.5 |
| RENSPA / descarga SIGSA = fuera de MVP | (alcance — no se construye; sin R) |
| Identificador obligatorio (ADR-005) | R5.1 |
| Sexo tolerante → enum, requerido | R4.3, R5.2 |
| Fecha de nacimiento: formatos comunes, nullable | R4.4 |
| RFID/TAG: validar/normalizar con spec 04 R8 | R4.5 |
| idv único por campo → choque = dedup | R7.2, R7.4 |
| Raza: texto libre hasta catálogo 08; TXT = código SENASA | R6.1, R6.2 |
| Categoría (decisión 2): columna → category_id + override=true | R10.3 |
| Categoría sin columna/sin match → "a completar", no inferir | R10.5 |
| Ortogonalidad ADR-020 (category sin tocar rodeo/lote) | R2.5, R10.2 |
| Campos importables (decisión 3): censo de identidad | R10.1, R10.2 |
| Lote opcional → management_groups por nombre, no crear | R10.4 |
| No entran eventos/plantilla | R10.6 |
| Validación pre-import + preview con conteos | R5.3, R5.4 |
| Confirmación antes de escribir | R5.5 |
| Reglas de validez por fila | R5.1, R5.2, R4.4, R4.5, R7 |
| Dedup intra-archivo | R7.1 |
| Dedup contra existentes (skip + report, detección blanda 09) | R7.2, R7.3 |
| TAG no reusable (R5.6 spec 02) | R7.4 |
| Atomicidad: import parcial, no all-or-nothing | R8.1, R8.2 |
| RLS-on-RETURNING: split insert + select | R8 (design §flujo de escritura) |
| Escala cientos-a-miles → batching | R3.2 (tope), R8 (design §batching) |
| Un rodeo por corrida | R2.1, R2.2, R2.3 |
| Roles owner + vet | R2.4 |
| Entry point: onboarding + re-ejecutable | R1.1, R1.2 |
| Audit: import_log | R11.1, R11.2, R11.3 |
| Offline-first / multi-tenant (online MVP, scoped por est.) | R9.1, R12.1, R12.2, R12.3 |
| Backend / Gates: import_log única tabla nueva; RPC bulk → Gate 1 | R9.4, R11, design §Backend / Gates |
| **Reforzamiento 1 — límites de input / anti-DoW** | R3.1, R3.2, R3.3, R3.4 |
| **Reforzamiento 2 — seguridad del parser de planillas** | R3.3, R3.5, R3.6, design §parser |
| **Reforzamiento 3 — campos forzados server-side** | R9.1, R9.2, R9.3, R9.4 |
| **Reforzamiento 4 — dedup pre-check contra constraints** | R7.1, R7.2, R9.5 |
| **Reforzamiento 5 — categorías post-Tier-2** | R10.3, R10.5 |
| **Reforzamiento 6 — reuso de artefactos reales** | R4.5 (parser-rs420), R6.2 (tabla razas 08) |
| **Reforzamiento 7 — entry point sobre flujos cerrados** | R1.1, R1.2 |
