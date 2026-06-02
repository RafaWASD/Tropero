# Spec 08 — Exportación SIGSA — Refinamiento de contexto (Gate 0)

**Status**: Pendiente de aprobación de Raf.
**Fecha**: 2026-05-29 (sesión 18)
**Conducido por**: leader + Raf (1 ronda de AskUserQuestion, 4 decisiones).
**Related**: `research-findings.md` (insumo primario, sesión 16), spec 02 (modelo de animal — sexo/raza/fecha/RFID), spec 01 (establishments — RENSPA), ADR-005 (identificación flexible), CONTEXT/07 (RENSPA anti-fraude), CONTEXT/08 (roadmap).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos. El `spec_author` lo lee como fuente de verdad y lo traduce a requirements/design/tasks — no re-decide nada de acá. Cada "Caso y decisión" debe quedar cubierto por ≥1 `R<n>`.

## Contexto validado

08 genera un archivo **`.txt`** que el productor sube manualmente a **SIGSA web** para declarar ante SENASA los dispositivos de identificación electrónica (obligación vigente desde 1/1/2026, Res. 841/2025; plazo **10 días hábiles** por novedad). NO es una API: RAFAQ produce el archivo, el productor lo sube. Es el **diferencial competitivo** frente a SIGBIOTRAZA (app oficial Bluetooth→SIGSA que NO genera archivo): RAFAQ sirve a quien ya carga en RAFAQ y quiere cumplir sin re-cargar en otra app.

**Capacidad de importar archivo CORROBORADA** (verificación s18): la documentación de SENASA confirma que en SIGSA web se puede declarar **por importación de archivo** —incluyendo un archivo "generado por un lector de dispositivos RFID" con un formato específico— como una de las 3 vías (presencial / autogestión SIGSA web / app SIGBIOTRAZA). 2 fuentes independientes (research s16 + búsqueda s18). **Caveat**: el manual oficial (v2.42.80) es un PDF de **imágenes** no extraíble automáticamente, así que el **formato exacto** y las validaciones server-side NO los pude re-verificar yo directamente — vienen del research s16. **GATE DURO antes de cerrar la spec**: validar el formato exacto con un **upload real** o login a SIGSA con clave fiscal (Raf/Facundo).

**Formato (del research s16, a confirmar con upload real)**: un registro por dispositivo `RFID-SEXO-RAZA-MM/AAAA`, registros separados por `;`.
- `RFID` = 15 dígitos numéricos.
- `SEXO` = `M`/`H`.
- `RAZA` = código 1-3 letras (`H`/`AA`/`HA`/`B`/`BG`/`BF`/`OR`/`S-E`…; tabla completa págs. 7-8 del manual, **a extraer**).
- `MM/AAAA` = mes/año de nacimiento.
- Ejemplo del manual: `032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025`.

**Datos en el modelo actual** (verificado contra migrations 0019-0026):
- ✅ `animals.sex` (`male`/`female`, NOT NULL) → mapea a `M`/`H`.
- ✅ `animals.tag_electronic` (text, **nullable**) → el RFID; solo exportable si existe.
- ⚠️ `animals.birth_date` (date, **nullable**) → formatear a MM/AAAA; puede faltar.
- ⚠️ `animal_profiles.breed` = **texto libre nullable** → NO hay catálogo ni mapeo a código SENASA (el corazón del trabajo de 08).
- ❌ RENSPA → **no existe** en `establishments`.

## Alcance

**Dentro (MVP)**: generación del `.txt` de **alta de dispositivos** (`RFID-SEXO-RAZA-MM/AAAA;…`) para los animales de un establishment con RFID y aún no declarados; validación pre-export (los 3 datos exigidos); marcador de "declarado" por animal + lista de pendientes; audit trail de exports; share sheet para sacar el archivo del teléfono + checklist recordatorio de los 4 datos de pantalla SIGSA; catálogo de razas con código SENASA; RENSPA opcional en el establecimiento.

**Fuera (post-MVP / backlog)**:
- **Reidentificación** (reemplazo de dispositivo perdido) — usa otro formato TXT (`ORIGINAL-NUEVO;…`, §2 del research).
- **Declaración al cierre de DT-e** — flujo distinto.
- Especies no bovinas (bubalina/cérvida) — MVP solo bovino.
- Submit programático a SIGSA (no hay API).
- Integración con SIGBIOTRAZA (competidor, no integrable).

**Depende de**: spec 02 (sexo/raza/fecha/RFID por animal — **requiere el delta de catálogo de razas**), spec 01 (delta RENSPA opcional en establishments). NO depende de hardware ni de specs BLE.

## Casos y decisiones

### Raza → código SENASA (decisión 1: catálogo controlado)
- Se agrega un **catálogo controlado de razas** de cría bovina con su **código SENASA** (`H`/`AA`/`HA`/`B`/`BG`/`BF`/`OR`/`S-E`…). El animal referencia el catálogo (FK/enum); el export mapea 1:1 al código.
- **Delta sobre spec 02 (backend done)**: `animal_profiles.breed` pasa de **texto libre → referencia controlada** + migración de los datos libres existentes (best-effort match al catálogo; sin match → `OR` "otra raza" o queda a completar). **También** migra `reproductive_events.breed` (raza del ternero al parto, migration 0026) y el **trigger de ternero al pie** (migration 0032, R9 de spec 02): el ternero recién creado hereda/recibe la raza del catálogo, no texto libre. El form del evento `birth` (spec 09 R5.4) ofrece el picker del catálogo.
- Fallback: raza sin especificar → `S-E`. El catálogo es **reusable** más allá del export (reportes, filtros, benchmarking) — por eso vive en el modelo, no como lookup de export.
- **Sub-tarea pre-spec**: ✅ **HECHA (sesión 22)** — tabla completa de 32 códigos (28 bovinas) extraída y verificada en `razas-senasa-codigos.md` (este directorio). El catálogo se siembra con las 28 bovinas (grafías literales del manual). Queda validar con Facundo el subset relevante de la zona (solo para ordenar/defaultear el picker, no recorta el enum).

### RENSPA (decisión 2: campo opcional en establishments)
- Se agrega **`renspa` (opcional)** a `establishments`. RAFAQ lo muestra como recordatorio al exportar y queda disponible para validación anti-fraude futura (CONTEXT/07).
- **NO va en el archivo TXT** — el productor lo elige en pantalla en SIGSA. RAFAQ solo lo conoce para el flujo/recordatorio.
- **Cardinalidad (decidida sesión 18): un RENSPA por establecimiento en MVP** (campo único). El beta (Chascomús) es un campo. Si un establecimiento tuviera varias unidades productivas (RENSPA), el flujo de export deja **tipear/elegir** el RENSPA aunque no esté guardado. Ampliable post-MVP a lista de RENSPA por establecimiento.
- **Delta sobre spec 01 (backend done)**: campo `renspa` nullable (único) en `establishments`.

### Qué animales se exportan + tracking (decisión 3: marcador 'declarado' + pendientes)
- El **marcador de declaración SIGSA** vive por **(establecimiento, animal)** — en el `animal_profile` o en una tabla de declaraciones por campo (`sigsa_declarations`) — **NO** en el `animals` global. Razón (refinada sesión 18): la declaración es un acto **por RENSPA/establecimiento** (cada productor declara bajo su RENSPA). Así una **transferencia** entre campos (spec 09 D2) **no** marca al animal como "ya declarado" en el campo destino: el campo nuevo declara bajo su propio RENSPA.
- El export ofrece **por defecto los pendientes**: animales del establishment **con RFID** y **no declarados**. El usuario puede acotar (rodeo / rango de fecha) sobre ese conjunto.
- **No se filtra por categoría**: cualquier animal con RFID no declarado es candidato (cubre terneros al destete Y adultos por reposición natural).
- **Audit trail = `export_log`**: qué animales, qué archivo, cuándo, quién. Habilita saber qué se declaró y respetar el plazo de 10 días hábiles.
- Re-export permitido (el usuario puede re-descargar un archivo ya generado desde el log); pero un animal ya declarado **no reaparece** en la lista de pendientes.
- **Delta de modelo (nuevo, propio de 08)**: registro de declaración por **(establecimiento, animal)** (`sigsa_declared_at` + ref export, en `animal_profiles` o tabla nueva `sigsa_declarations`) + tabla `export_log`. **NO** en el animal global.

### Validación pre-export (decisión 4: validar y bloquear)
- Pre-chequeo antes de generar. Animales **no exportables** se listan "a completar":
  - sin RFID válido (**15 dígitos numéricos** — `tag_electronic` es texto libre, hay que validar longitud/formato),
  - sin `birth_date`,
  - sin raza mapeable.
- El usuario completa los datos y reintenta. Garantiza que el archivo no falle en SIGSA (los 3 datos los exige el Art. 8°).
- El archivo se genera solo cuando todos los seleccionados pasan (o el usuario excluye explícitamente los incompletos del lote actual).

### Roles
- **Owner + veterinario** pueden generar el export. El productor (owner) es el responsable legal de la declaración (Art. 5°), pero el vet es el canal y puede producir el archivo. `field_operator`: no (default; confirmable).

### Entrega (UX) + recordatorio
- App mobile-only: el `.txt` sale por **share sheet** (guardar en archivos / mandar por mail-WhatsApp a uno mismo / abrir SIGSA web). La subida a SIGSA la hace el productor **fuera de la app**.
- El flujo muestra un **checklist recordatorio** de los 4 datos que el productor elige en pantalla SIGSA y que NO van en el archivo: **RENSPA, especie, fecha de aplicación, motivo** (acta vacunación aftosa / novedad de nacimiento / reinscripción RENSPA).

### Offline-first + multi-tenant
- La **generación** del archivo funciona offline (es data local → archivo). La **subida** a SIGSA requiere internet y ocurre fuera de la app.
- Export **scoped por establishment** (RLS). El `export_log` y el marcador respetan multi-tenancy.

### Formato — detalles a respetar
- Especie = bovina (no va en el archivo). MVP no distingue bubalina/cérvida.
- `MM/AAAA` derivado de `birth_date` (mes/año).
- Sexo `male→M`, `female→H`.

## Pendientes (CONTEXT/07)
- **Extraer la tabla completa de códigos de raza** (manual SIGSA págs. 7-8) para sembrar el catálogo → sub-tarea pre-spec. Listado de razas relevantes a validar con Facundo (TENTATIVO, ajustable por migration).
- **Validaciones server-side de SIGSA no documentadas** (trailing `;`, espacios, rango de fechas, longitud exacta de RFID): **probar un upload real** contra SIGSA con un archivo generado antes de cerrar la spec. Incógnita abierta — no bloquea el `context.md`, sí conviene resolverla antes de dar 08 por `done`.
- **Anexo de la Res. 841/2025** (planilla, Art. 7°): no transcripto; posible fuente de campos adicionales. Bajo riesgo (el formato TXT ya está confirmado).
- **RENSPA como validación anti-fraude**: post-MVP (CONTEXT/07); en MVP es solo recordatorio.

## Insumos para spec_author
- **`research-findings.md`** (este directorio) — formato confirmado §2, regulatorio §3, implicancias §5, incertidumbres §6. Fuente primaria.
- **spec 02** (`animals.sex`/`birth_date`/`tag_electronic`, `animal_profiles.breed`) — sustrato; **incluye el delta de catálogo de razas** (breed texto libre → controlado + migración).
- **spec 01** (`establishments`) — incluye el delta RENSPA opcional.
- ADR-005 (identificación flexible — no todo animal tiene RFID), CONTEXT/07 (RENSPA), CONTEXT/08 (posicionamiento, scope).
- **Deltas cross-spec a coordinar** (tocan backend ya `done`, igual que el delta de edge cases de spec 02): catálogo de razas + migración de breed (spec 02) y `renspa` en establishments (spec 01). El spec_author los referencia; el implementer los ejecuta como incrementos acotados al implementar 08.

## Aprobación
- **Pendiente de aprobación de Raf.** Al aprobar, 08 pasa a `context_ready`. La redacción de la spec se hace just-in-time (Ola 4 del plan; obligación ya vigente, aterrizar pronto). Las 4 decisiones (catálogo de razas, RENSPA opcional, marcador declarado + pendientes, validar-y-bloquear) quedan lockeadas acá.
