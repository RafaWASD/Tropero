# Spec 12 — Importación masiva de rodeo — Refinamiento de contexto (Gate 0)

**Status**: APROBADO por Raf (sesión 22, 2026-06-01).
**Fecha**: 2026-06-01 (sesión 22, terminal secundaria — trabajo colisión-safe: solo este directorio nuevo, sin tocar código ni coordinación).
**Conducido por**: leader + Raf (1 ronda de AskUserQuestion, 3 decisiones).
**Related**: spec 02 (`context-frontend.md` — de donde sale esta feature), spec 09 (find-or-create, dedup), spec 08 (catálogo de razas + formato TXT SIGSA), spec 04 (R8 normalize/isValidTag), ADR-005 (identificación flexible), ADR-020/ADR-021 (ejes ortogonales + plantilla), CONTEXT/04 (modelo de datos), CONTEXT/07 (pendientes), ADR-022 (este gate).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos. El `spec_author` lo lee como fuente de verdad y lo traduce a requirements/design/tasks — no re-decide nada de acá. Cada "Caso y decisión" debe quedar cubierto por ≥1 `R<n>`.

> **Numeración / alta en `feature_list.json`**: este `context.md` se redactó desde una terminal secundaria que NO toca archivos de coordinación. El id `12` y el nombre `12-import-rodeo` son **provisionales**: el alta de la entrada en `feature_list.json` (con su `status`, `acceptance`, `notes`) la hace la terminal dueña de la coordinación. Al darse de alta, la feature nace directo en `context_ready` si Raf aprueba este doc.

## Contexto validado

El importador es el camino **masivo** que `specs/active/02-modelo-animal/context-frontend.md` dejó explícitamente afuera del find-or-create: el **usuario nuevo con rodeo entero**. Es exactamente el caso del **beta** (campo del padre del socio en Chascomús): un rodeo ya existente que hay que cargar de una, no animal por animal. El find-or-create de spec 09 sirve al alta **progresiva** (1-2 animales, o en la manga); el importador sirve a la **carga inicial del padrón**.

**Encaje con la jornada de manga (insight validado en el refinamiento)**: el rodeo beta hoy típicamente tiene **caravana visual + planilla**, pero **todavía NO tiene los TAGs electrónicos** — esos se están colocando *ahora* por la obligación SENASA vigente (Res. 841/2025: terneros al destete desde 1/1/2026 + reposición natural). Secuencia coherente en dos pasos:
1. **Importar el censo visual** (idv / categoría / raza / sexo / fecha) desde la planilla del productor.
2. **Jornada de manga posterior** (find-or-create + bastón) que le agrega el **TAG electrónico** a cada animal del censo.

Por eso la fuente realista NO es un archivo RFID-keyed sino la **planilla propia** del productor, donde muchos animales aún **no tienen RFID** — válido por ADR-005 (alcanza con `idv`/`visual_id_alt`).

**Datos del modelo (verificado contra CONTEXT/04 / migrations spec 02)**: el importador escribe `animals` (id, tag_electronic nullable, species_id, sex, birth_date nullable) + `animal_profiles` (idv, visual_id_alt, category_id, category_override, breed, management_group_id, rodeo_id, establishment_id, status). No necesita schema nuevo salvo el `import_log` de audit (ver Caso 7).

## Alcance

**Dentro (MVP)**:
- Importar un archivo y dar de alta en lote `animals` + `animal_profiles` en **un rodeo** del establecimiento activo.
- **Dos fuentes** (decisión 1): planilla **Excel/CSV** con mapeo de columnas + archivo **TXT de SIGSA** (`RFID-SEXO-RAZA-MM/AAAA;…`).
- **Censo de identidad** por animal (decisión 3): TAG / IDV / visual_id_alt (≥1, ADR-005) + sexo + fecha de nacimiento + raza + categoría + lote opcional.
- **Categoría** desde columna con override (decisión 2).
- **Validación pre-import + preview** (válidos / errores / duplicados) con confirmación antes de escribir.
- **Import parcial** (skip-and-report): los válidos entran, los inválidos se reportan para corregir y reimportar.
- **Dedup** intra-archivo y contra animales existentes del establecimiento (skip + report).
- **Audit**: `import_log` (archivo, conteos, errores, quién, cuándo).
- **Entry point**: flag de **onboarding** (tras crear campo + rodeo) **+ re-ejecutable** desde la pantalla de Rodeos / Más.

**Fuera (post-MVP / backlog)**:
- **Importar eventos / historial** (pesos, sanitario, reproductivo). El import carga el padrón; el historial se acumula después por eventos/manga.
- **Vínculo madre-ternero / linaje** (referencias cruzadas entre filas del archivo).
- **Auto-marcar `sigsa_declared_at`** al importar (la declaración SIGSA es un acto por RENSPA del establecimiento — feature 08; un import no equivale a "ya declarado").
- **Bajar datos directo de SIGSA/RENSPA** (formato de descarga desconocido; quizás no exista export programático). Requiere research aparte.
- **Campos extendidos** (entry_*, pelaje, dientes, is_cut, birth_weight) y **datos de plantilla** (`rodeo_data_config`): el import es ortogonal a la plantilla — carga identidad, no datos de maniobra.
- **Offline**: el import del MVP es **online** (es setup; el parseo del archivo es local, la escritura de N animales es online). Consistente con ops de identidad (R9.2). PowerSync no entra acá.

**Depende de**: spec 02 (sustrato `animals`/`animal_profiles`, backend done), spec 09 (primitivas de dedup R5.5/R5.6), spec 04 R8 (`normalize`/`isValidTag` para validar RFID). Acoplado a spec 08 (catálogo de razas) para el mapeo de raza — ver Pendientes.

## Casos y decisiones

### Fuentes y formatos (decisión 1: Excel/CSV con mapeo + TXT de SIGSA)
- **Excel/CSV** (fuente primaria): la planilla del productor. Headers libres → **mapeo de columnas** (auto-detección de headers + ajuste manual del usuario). El mapeo define qué columna va a cada campo del censo.
- **TXT de SIGSA** (fuente secundaria, ya mapeada por el research de 08): `RFID-SEXO-RAZA-MM/AAAA`, registros separados por `;`. Estructura fija → sin mapeo manual.
  - **Implicación (documentada, no reabre la decisión)**: el TXT trae RFID + sexo + raza + MM/AAAA y **nada más** → el animal importado por esta vía queda con **TAG pero sin `idv` visual ni categoría** (válido por ADR-005; categoría = "a completar"). Su `RAZA` es un **código SENASA** (`H`/`AA`/`HA`/…) → para mapearlo a una raza interna depende del **catálogo de razas de la feature 08** (ver Pendientes); si 08 aún no aterrizó, se guarda el código/raza tal cual y se migra cuando 08 corra.
  - Sirve a un caso más angosto (productor que **ya** tiene RFIDs declarados) — secundario al CSV, pero "gratis" porque el formato ya está investigado.
- **RENSPA / descarga de SIGSA**: **fuera de MVP** (formato desconocido, research aparte).

### Mapeo de columnas (CSV) + normalización
- **Identificador obligatorio (ADR-005)**: cada fila debe resolver al menos uno de `tag_electronic` / `idv` / `visual_id_alt`. Fila sin ningún identificador → error "a completar".
- **Sexo**: mapeo tolerante a la planilla (`M`/`H`, `macho`/`hembra`, `toro`/`vaca` por inferencia básica del header de sexo) → enum `male`/`female`. Requerido.
- **Fecha de nacimiento**: parsear formatos comunes (DD/MM/AAAA, MM/AAAA, AAAA) → `birth_date` (o solo mes/año cuando es lo único disponible). Nullable.
- **RFID/TAG**: si la columna trae TAG, validar/normalizar con el insumo firme de spec 04 R8 (`normalize.ts`/`isValidTag` — ISO 11784/11785 FDX-B, 15 dígitos, prefijo país). TAG inválido → la fila entra sin TAG (si tiene otro identificador) o cae a "a completar".
- **idv**: caravana visual, **única por campo** → choque de unicidad = dedup (Caso dedup).
- **Raza**: texto de la planilla → cuando exista el catálogo de razas (08), match best-effort al catálogo; sin catálogo, `breed` texto libre (estado actual del modelo).

### Categoría (decisión 2: columna → category_id con override)
- Si la planilla trae columna de categoría, se mapea a `categories_by_system` del sistema del rodeo y se setea `animal_profiles.category_id` con **`category_override = true`**. Razón: en el import **no hay eventos** de los que el trigger de ADR-008 pueda auto-calcular el estado biológico; marcar override evita que una transición posterior pise la categoría declarada sin intención.
- Sin columna o sin match al sistema → categoría **"a completar"** (no se infiere por sexo/edad: inferencia frágil sin Facundo, riesgo de mal asignar en masa).
- Respeta la ortogonalidad de ADR-020: el import setea `category_id` sin tocar `rodeo_id` (lo fija el rodeo destino) ni `management_group_id` (lote, ver Caso campos).

### Campos importables (decisión 3: censo de identidad)
- Por animal: **TAG / IDV / visual_id_alt** (≥1) + **sexo** + **fecha de nacimiento** + **raza** + **categoría** + **lote** (opcional → `management_groups` por nombre; crear el lote si no existe es decisión de diseño menor, default: matchear por nombre existente, no crear).
- **No** entran eventos, pesos, sanitario, reproductivo, ni campos de plantilla (`rodeo_data_config`). El padrón se carga; el resto se acumula después.

### Validación pre-import + preview (validar-y-reportar, con confirmación)
- Pre-chequeo antes de escribir nada. La pantalla de preview muestra **conteos**: filas válidas, filas con error ("a completar"), duplicados.
- Reglas de validez por fila: ≥1 identificador (ADR-005); sexo presente y mapeable; TAG (si viene) válido por R8; fecha parseable (si viene); idv único en el campo.
- El usuario confirma → se escriben los válidos. Patrón consistente con la validación de 08 (validar-y-bloquear) y el skip-and-report de 10.

### Dedup (intra-archivo + contra existentes)
- **Intra-archivo**: mismo `idv` o `tag_electronic` repetido en dos filas → se reporta, se importa una (o ninguna) según resolución del usuario; default: marcar ambas como conflicto "a completar".
- **Contra existentes**: si el `idv`/`tag` ya existe en el establecimiento → **skip + report** (no update silencioso, no bloquear todo el lote). Reusa la **detección blanda** de spec 09 (R5.5/R5.6) y la regla **TAG no reusable** (R5.6 de spec 02). El usuario ve los skippeados y decide qué hacer (corregir el archivo y reimportar, o cargarlos a mano).

### Atomicidad / escritura
- Import **parcial**: los válidos entran en batch; los inválidos/duplicados se reportan; el usuario corrige y reimporta. NO all-or-nothing (un rodeo de cientos no debería fallar entero por 3 filas malas).
- Escritura respeta el gotcha **RLS-on-RETURNING**: split insert + select (no `.insert().select()` en un roundtrip), igual que el resto del frontend de spec 01/02.
- **Escala esperada**: cientos a bajos miles de animales → batching de la escritura (decisión de diseño/perf, no de contexto). Anotar el orden de magnitud para que el `spec_author`/`design` lo contemple.

### Rodeo destino + roles + entry point
- **Un rodeo por corrida**: el usuario elige el rodeo destino (1 rodeo → fijo; ≥2 → selección). Todos los animales del archivo heredan ese `rodeo_id`. Para otro sistema productivo, se corre de nuevo.
- **Roles**: **owner + veterinario** pueden importar (el vet es el canal de adquisición y onboardea al cliente). `field_operator`: no (default, confirmable).
- **Entry point**: flag de **onboarding** (después de crear campo + rodeo) **+ re-ejecutable** desde Rodeos / Más. **Dependencia de coordinación**: engancha con el onboarding (spec 01 Fase 4) y el wizard de rodeo (spec 02 C1) que se están construyendo en paralelo — el `spec_author`/implementer de 12 debe cablear el entry point sobre esos flujos ya cerrados, no reimplementarlos.

### Audit
- **`import_log`** (nuevo, propio de 12, espejando `lab_imports`/`export_log` que ya están en el modelo): `establishment_id`, `rodeo_id`, `file_name`, `file_format` (csv/xlsx/sigsa_txt), `total_records`, `imported_ok`, `imported_errors`, `error_details` (JSON), `imported_by`, `created_at`. Scoped por establishment (RLS).

### Offline-first + multi-tenant
- Import **online** en MVP (setup). Parseo local, escritura online.
- Todo **scoped por establishment** (RLS): el archivo carga en el establecimiento activo; `import_log` y los animales respetan multi-tenancy.

## Backend / Gates
- **Sin delta de schema/RLS esperado** más allá de la tabla `import_log` (audit). El import escribe `animals`/`animal_profiles` con las RLS/RPCs que ya existen (backend de spec 02 done).
- **Gate 1**: probablemente **NO aplica** si el `import_log` es la única tabla nueva y no introduce escritura cross-tenant ni RLS sensible (es write same-tenant, mismo patrón que el alta individual). A confirmar por el `spec_author`: si el diseño agrega un **RPC de bulk-insert** (por atomicidad/perf), revisar si es SECURITY DEFINER → eso sí dispararía Gate 1. **Gate 2 (code)** sí, como en todo run.

## Pendientes (CONTEXT/07)
- **Catálogo de razas (delta de feature 08)**: el TXT de SIGSA trae **código SENASA**; el CSV trae **texto**. El mapeo limpio raza→código depende del catálogo controlado que introduce 08 (delta sobre `animal_profiles.breed` texto→referencia). **Secuencia**: si 08 no está cuando se implemente 12, la raza importada queda como `breed` texto libre y se migra al catálogo cuando 08 aterrice. Dependencia, no bloqueante. **Validar con Facundo** el listado de razas relevantes de la zona (ya en CONTEXT/07).
- **Forma real de la planilla del productor**: qué columnas trae típicamente una planilla de campo de la zona (para afinar la auto-detección de headers y los defaults de mapeo). **TENTATIVO hasta validar con Facundo / con un archivo real del beta.**
- **`normalize`/`isValidTag` (spec 04 R8)**: insumo firme e independiente del transporte BLE — se reusa para validar el RFID importado. Disponible.
- **Formato exacto del TXT de SIGSA**: viene del research de 08 (no re-verificado contra upload real). Bajo riesgo para el import (solo se *lee*); el gate duro de upload real es de 08, no de 12.

## Insumos para spec_author
- **`specs/active/02-modelo-animal/context-frontend.md`** — de donde sale esta feature (el "masivo" separado del find-or-create).
- **CONTEXT/04** — modelo `animals`/`animal_profiles`, ejes ortogonales (rodeo/categoría/lote, ADR-020), regla de identificación (ADR-005).
- **spec 09 `context.md`** — find-or-create + dedup R5.5/R5.6 (reusar primitivas, no duplicar lógica).
- **spec 08 `context.md` + `research-findings.md` + `razas-senasa-codigos.md`** — formato TXT SIGSA (§2) + **tabla completa de 32 códigos de raza ya extraída y verificada** (sesión 22) de la que sale el seed del catálogo y el parse posicional del TXT.
- **spec 04 R8** — `normalize.ts`/`isValidTag` para el RFID.
- **Patrón `lab_imports` / `export_log`** (CONTEXT/04 §6 y context.md de 08) para `import_log`.
- **ADR-005** (identificación flexible), **ADR-020/021** (ortogonalidad + plantilla), **ADR-022** (este gate).

## Aprobación
- **APROBADO por Raf (2026-06-01, sesión 22).** **Pendiente (terminal de coordinación)**: dar de alta la entrada en `feature_list.json` (id provisional `12`, nombre `12-import-rodeo`, `sdd: true`) directamente en estado `context_ready`. Las 3 decisiones (fuentes Excel/CSV + TXT SIGSA · categoría columna+override · censo de identidad) + los defaults del leader (online MVP, owner+vet, un rodeo/corrida, skip-and-report, dedup blanda reusada de 09, import_log, eventos/linaje/SIGSA-declared fuera) quedan lockeados acá. La redacción de la spec (requirements/design/tasks) es just-in-time, cuando el pipeline la pida (no es critical-path hoy).
