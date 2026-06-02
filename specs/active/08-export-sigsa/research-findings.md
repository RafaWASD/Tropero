# 08 — Export SIGSA/SIGBIOTRAZA — Research findings (pre-Gate 0)

> **Estado**: research, NO spec. Este documento es el **insumo** para el futuro `context.md` de la feature 08 (Gate 0 de ADR-022). No es una decisión cerrada.
> **Fecha**: 2026-05-28 (sesión 16). **Autor**: leader (research autónomo, 2 agentes web).
> **Naturaleza de las fuentes**: normativa y manuales oficiales de SENASA + boletín oficial + prensa agropecuaria. Donde hay incertidumbre está marcado explícitamente.

---

## TL;DR — Hallazgos clave

1. **El formato de importación está CONFIRMADO y es simple.** SIGSA web acepta un archivo **TXT** con la estructura `RFID-SEXO-RAZA-MM/AAAA` por animal, animales separados por `;`. Documentado con ejemplo literal en el manual oficial de SENASA. La feature 08 es **viable hoy con info pública**.
2. **Corrección de un supuesto base del proyecto: el "deadline julio 2026" NO existe en la norma vigente** (verificado contra el articulado, §3). El cronograma real arranca **1/1/2026 (terneros al destete)** + reposición natural del rodeo, no una fecha de corte fija para adultos. **Aplicado en docs base** en sesión 16 (CLAUDE.md/CONTEXT/feature_list/plan); los ADRs quedaron pendientes de una pasada aparte (ver §6).
3. **No es una API** — es upload manual de archivo por el productor en SIGSA web. RAFAQ genera el `.txt`; el productor lo sube.
4. **SIGBIOTRAZA es competidor, no integrable.** Es una app Android de SENASA que lee RFID por Bluetooth y sincroniza directo a SIGSA (no expone archivo). La oportunidad de RAFAQ es ser **alternativa** a SIGBIOTRAZA generando el TXT importable.

---

## 1. Sistemas SENASA relevantes

| Sistema | Qué es | Plataforma | Rol en la integración |
|---|---|---|---|
| **SIGSA** (Sistema Integrado de Gestión de Sanidad Animal) | Sistema central de SENASA. Donde se declaran oficialmente los dispositivos RFID. | **Web** (autogestión con clave fiscal, `aps2.senasa.gov.ar/sigsa`) | **Destino de nuestro export.** Tiene "Subir Archivo" para importación masiva. |
| **SIGBIOTRAZA** | App oficial que lee caravanas RFID por Bluetooth en la manga, arma lotes y los envía directo a SIGSA (vincula vía token QR). | **App móvil Android** | NO integrable (no genera archivo). Es competidor funcional de la feature. |
| **SIGSA App Vacunación / App Actas** | App para cargar actas de vacunación antiaftosa/brucelosis. | **App móvil Android** | No documenta formato de archivo importable. Fuera de scope de 08. |

---

## 2. Formato de exportación — CONFIRMADO

**Fuente primaria**: Manual SIGSA *"Declaración de dispositivos de identificación electrónicos…"*, versión 2.42.80, diciembre 2025 (PDF oficial de SENASA), sección 6.

### Estructura del archivo
- **Tipo de archivo**: `.txt` plano.
- **Un registro por dispositivo**: `DISPOSITIVO-SEXO-RAZA-FECHANACIMIENTO`
- **Separador de campos** (dentro del registro): guion del medio `-`
- **Separador entre dispositivos**: punto y coma `;`
- **Ejemplo literal del manual**:
  ```
  032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025;032010000000002-M-B-08/2025
  ```

### Campos del registro
| Campo | Formato | Notas |
|---|---|---|
| `DISPOSITIVO` (RFID) | 15 dígitos numéricos | Número del botón/bolo/chip electrónico. |
| `SEXO` | `M` / `H` | Macho / Hembra. |
| `RAZA` | código 1-3 letras | `H`=Hereford, `AA`=Aberdeen Angus, `HA`=Holando Argentino, `B`=Brahman, `BG`=Brangus, `BF`=Braford, `OR`=Otra raza, `S/E`=Sin especificar… **tabla completa en págs. 7-8 del manual** (no extraída entera todavía). |
| `FECHANACIMIENTO` | `MM/AAAA` | Mes/año. |

### Contexto que NO va en el archivo (se elige en pantalla al subir)
Estos los selecciona el productor en SIGSA, no en el TXT:
- **RENSPA** (unidad productiva del establecimiento).
- **Especie** (bovina / bubalina / cérvida).
- **Fecha de aplicación**.
- **Motivo de declaración**, asociado a un registro previo: código de Acta de vacunación aftosa, o Novedad de nacimiento, o Reinscripción RENSPA (DDJJ).

> La app puede mostrar estos campos como recordatorio/checklist, pero no formarían parte del archivo generado.

### Reidentificación (reemplazo de dispositivo perdido)
Usa **otro** formato TXT (sección 8 del manual): `DISPOSITIVO_ORIGINAL-DISPOSITIVO_NUEVO;…`. Posible scope futuro de 08.

---

## 3. Marco regulatorio — CONFIRMADO (con una corrección importante)

### Normativa: tres resoluciones encadenadas
- **Res. SAGyP/ME 71/2024** — norma marco: incorpora bubalinos/cérvidos y fija el uso obligatorio de dispositivos electrónicos (cronograma original).
- **Res. SENASA 530/2025** (BO 21/07/2025) — define el **binomio** (tarjeta visual + dispositivo electrónico) y la obligatoriedad desde **1/1/2026**.
- **Res. SENASA 841/2025** (BO 03/11/2025) — **procedimiento técnico operativo**: cómo se aplica, cómo/dónde se declara, plazos. **Es la norma más relevante para la feature.**

### Cronograma confirmado
- **1/12/2025**: prohibida la comercialización de caravanas exclusivamente visuales.
- **1/1/2026**: obligatorio identificar electrónicamente **terneros/as** (al destete o antes del primer movimiento). Empieza la obligatoriedad plena para nuevos nacimientos. El rodeo adulto se cubre **por reposición natural** (cada camada nueva).

### ⚠️ Corrección al supuesto "deadline julio 2026" — VERIFICADA contra el articulado
El proyecto asume en varios lugares (`CLAUDE.md`, `CONTEXT/01`, `CONTEXT/08`, `plan.md`, `feature_list.json`) un *"deadline SENASA julio 2026"*. **Tras leer el articulado completo del BO (Arts. 1°–30° de la Res. 841/2025), se confirma que esa fecha NO existe en la norma vigente.**
- **Art. 3°** (cita textual): *"A partir del 1 de enero de 2026, ningún ternero o ternera de la especie bovina o bubalina… podrá ser movilizado ni permanecer en el establecimiento ganadero de nacimiento luego del destete, sin contar con la identificación individual electrónica…"*. El hito es **1/1/2026 para terneros al destete** + reposición natural del rodeo.
- **Art. 19°**: 1/12/2025 cesa la comercialización de dispositivos solo visuales. **Art. 28°**: período de coexistencia 1–31/12/2025.
- El articulado **no menciona** ninguna fecha de julio 2026 ni un corte para categorías adultas. La fecha "julio 2026" provenía del cronograma **original** de la Res. 71/2024, reemplazado por la 530 y la 841.
- **Implicancia**: la urgencia no desaparece — al contrario, la obligación de terneros **ya está vigente (1/1/2026)**. Pero el framing "tenemos hasta julio 2026" es incorrecto. **Decisión de Raf**: cómo y dónde actualizar la referencia (probablemente cambiar el "deadline contextual" por "obligación vigente desde 1/1/2026, escalonada por reposición natural").

### Trámite de declaración (Res. 841/2025, Art. 8°) — VERIFICADO con cita textual
- **Plazo: 10 días HÁBILES** desde la novedad. Art. 8° (cita): *"el productor debe, dentro de los DIEZ (10) días hábiles de ocurrida la novedad, realizar la declaración ante el SENASA"*. El Art. 10° fija el mismo plazo para bajas por muerte. (Son **hábiles**, no corridos.)
- **Responsable: el productor** del establecimiento de nacimiento. Art. 5° (cita): *"El productor del establecimiento ganadero de nacimiento de los animales es el responsable de la identificación individual oficial de todos los terneros y las terneras… al destete o antes del primer movimiento."* No requiere veterinario acreditado para declarar.
- **Tres vías de declaración** (Art. 8°): (1) **Oficina Local del SENASA** (planilla impresa), (2) **autogestión SIGSA** (nuestro target), (3) **app SIGBIOTRAZA**.

### Campos que exige la normativa por animal (Art. 8°) — VERIFICADO con cita textual
Art. 8° (cita): *"El productor debe asociar cada número de dispositivo oficial de identificación individual electrónica al **sexo, raza, fecha de nacimiento, o bien, mes/año de nacimiento** del animal."* → RFID + sexo + raza + fecha (o mes/año) de nacimiento. **Coincide exactamente con el formato TXT del §2.**
- **RENSPA**: NO aparece citado en el Art. 8° del texto accedido — la identidad del establecimiento opera vía **registro previo en SIGSA** (Art. 9°: el proveedor pre-carga RENSPA, cantidad, tipo y rango de numeración de dispositivos entregados). Por eso el RENSPA se elige en pantalla al subir, no va en el archivo (consistente con §2).
- Nota: el Anexo (planilla de identificación, Art. 7°, IF-2025-118413923-APN-DNSA#SENASA) se publica aparte en la edición web del BORA — no transcripto todavía; posible fuente adicional de campos.

### Diferencias provinciales
**No hay.** Es norma nacional uniforme. Sin excepciones para Buenos Aires/Chascomús.

---

## 4. Glosario

- **RENSPA**: registro/código del establecimiento ganadero y su titular ante SENASA.
- **CUIG**: codificación abreviada del RENSPA impresa en la caravana visual = lugar de nacimiento. Sistema visual previo, en transición.
- **CUIT**: clave tributaria del titular.
- **DT-e / DTA**: Documento de Tránsito electrónico; ampara todo movimiento de hacienda. Vincula identificación con trazabilidad. (Hay un flujo de "declaración de dispositivos al cierre del DT-e" — posible scope futuro.)
- **Binomio / doble caravana**: tarjeta visual (oreja izquierda) + dispositivo electrónico —botón RFID, bolo ruminal o microchip— (oreja derecha).
- **SIGSA / SIGBIOTRAZA**: ver §1.

---

## 5. Implicancias para la feature 08 (a aterrizar en el context.md)

1. **Qué construye 08**: un generador de archivo `.txt` con la estructura `RFID-SEXO-RAZA-MM/AAAA;…` a partir de los animales del rodeo/establecimiento, descargable/compartible para que el productor lo suba a SIGSA web.
2. **Problema de mapeo de razas** (única pieza de "negocio" real): hay que mapear las razas internas de RAFAQ → códigos SENASA (tabla del manual). Falta extraer la tabla completa.
3. **Dependencia de datos del modelo de animal (spec 02)**: el TXT necesita **RFID (tag_electronic), sexo, raza, fecha de nacimiento** por animal. **A verificar**: ¿el modelo de spec 02 captura `raza` y `sexo` y `fecha de nacimiento` para todos los animales? (sexo/categoría/fecha probablemente sí; **raza es la incógnita** — quizás vive en `field_definitions`/plantilla, quizás no se modela hoy). Esto condiciona si 08 puede generar el archivo sin pedir datos extra.
4. **RENSPA por establecimiento**: el productor lo elige en SIGSA, no va en el TXT — pero conviene que RAFAQ lo conozca para el flujo/recordatorio. **A verificar**: ¿`establishments` modela RENSPA? (CONTEXT/07 lo menciona como validación anti-fraude opcional post-MVP).
5. **Audit trail**: los acceptance de 08 piden "audit trail de qué se exportó y cuándo" — alineado con que el productor tiene plazo de 10 días hábiles y necesita saber qué ya declaró.
6. **UX = upload manual, no API**: la feature termina en "generá y descargá/compartí este archivo + acá están los 4 datos (RENSPA, especie, fecha aplicación, motivo) que vas a tener que elegir en SIGSA". No hay submit programático.
7. **Posicionamiento**: alternativa a SIGBIOTRAZA. Quien ya usa SIGBIOTRAZA (Bluetooth→SIGSA directo) no necesita el archivo; el diferencial de RAFAQ es para quien carga en RAFAQ y quiere cumplir sin re-cargar en otra app.

---

## 6. Incertidumbres abiertas — a cerrar antes de escribir la spec

- [x] ~~**Decisión de Raf sobre el framing del deadline**~~ ✅ **APLICADO en docs base (sesión 16)**: Raf aprobó actualizar solo docs base (no ADRs). Reword en `CLAUDE.md`, `feature_list.json` (×2), `CONTEXT/01`, `CONTEXT/08` (×3), `plan.md` (×4): "julio 2026" → "obligación vigente desde 1/1/2026 + reposición natural, declaración 10 días hábiles, Res. 841/2025".
- [x] ~~**Pasada aparte sobre los ADRs**~~ ✅ **HECHO (sesión 16)**: Raf confirmó que "julio 2026" fue un error (la Res. 530/2025 se anunció en julio 2025 — BO 21/07/2025 — y la obligación rige desde 1/1/2026) y autorizó corregir. Corregidos `ADR-002`, `ADR-005` (reword semántico: visual dominante hasta fines 2025 / electrónica obligatoria terneros al destete desde 1/1/2026 + reposición natural), `ADR-009`, `ADR-017` (reword semántico: identificación + declaración exigidas desde 1/1/2026). Ya no queda ninguna referencia a "julio 2026" fuera de las líneas que documentan la corrección.
- [x] ~~**Leer el articulado completo de la Res. 841/2025**~~ ✅ **HECHO (sesión 16)**: accedido el texto Arts. 1°–30° en el BO. Plazo (10 días hábiles, Art. 8°), cronograma (sin julio 2026, Art. 3°), campos (Art. 8°), vías (Art. 8°) y responsable (Art. 5°) confirmados con cita textual en §3. Pendiente menor: el Anexo (planilla, Art. 7°) para campos adicionales.
- [x] ~~**Extraer la tabla completa de códigos de raza** (págs. 7-8 del manual SIGSA)~~ ✅ **HECHO (sesión 22, 2026-06-01)**: tabla completa (32 códigos, 28 bovinas) extraída con `pdftotext -layout` (el PDF SÍ tiene capa de texto — el caveat "imágenes no extraíble" era falso; `WebFetch` falla por el stream comprimido). Verificada a mano; cross-check 100% con las 8 confirmadas en s16. Ver **`razas-senasa-codigos.md`** (este directorio). Falta solo definir el mapeo raza-RAFAQ→código (es trabajo de la spec de 08) y validar el subset relevante con Facundo.
- [ ] **Verificar contra spec 02**: ¿el modelo captura raza, sexo, fecha de nacimiento por animal? ¿`establishments` tiene RENSPA?
- [ ] **Validaciones server-side de SIGSA no documentadas** (rango de fechas, `;` final, espacios, longitud RFID): conviene **probar un upload real** contra SIGSA antes de cerrar la feature.
- [ ] **Especie/categoría**: confirmar si el TXT distingue solo bovina o si el flujo cambia con bubalina/cérvida (MVP es bovino, así que probablemente no aplica).
- [ ] **Scope**: ¿08 cubre solo alta de dispositivos, o también reidentificación (§2) y declaración al cierre de DT-e? (Sugerencia: MVP solo alta.)

---

## 7. Fuentes

**Manuales oficiales SENASA (formato):**
- Manual declaración SIGSA (el clave, con el formato TXT): https://www.argentina.gob.ar/sites/default/files/2026/01/declaracion_de_dispositivos_de_identificacion_electronicos_en_sigsa_.pdf
- Manual app SIGBIOTRAZA: https://www.argentina.gob.ar/sites/default/files/2026/01/manual_de_uso_-_sigbiotraza.pdf
- Gestión de Token (vincular app↔SIGSA): https://www.argentina.gob.ar/sites/default/files/2026/01/gestion_de_token_para_vincular_la_app_sigbiotraza_con_sigsa.pdf
- Declaración al cierre DT-e: https://www.argentina.gob.ar/sites/default/files/2026/01/declaracion_de_dispositivos_de_identificacion_electronicos_al_cierre_del_dt-e.pdf
- Página índice SENASA (lista todos los PDFs): https://www.argentina.gob.ar/senasa/sistema-de-identificacion-electronica-de-animales
- Contacto técnico SENASA: hacelafacil@senasa.gob.ar

**Normativa (regulatorio):**
- BO Res. 841/2025: https://www.boletinoficial.gob.ar/detalleAviso/primera/333885/20251103
- BO Res. 530/2025: https://www.boletinoficial.gob.ar/detalleAviso/primera/328620/20250721
- CVPBA — puntos clave Res. 841/2025: https://cvpba.org/identificacion-electronica-obligatoria-puntos-clave-de-la-resolucion-841-20255/
- Infocampo — cronograma desde 1/1/2026: https://www.infocampo.com.ar/trazabilidad-electronica-bovina-punto-por-punto-como-es-el-sistema-que-se-aplicara-desde-el-1-de-enero/
- Bichos de Campo — Res. 841: https://bichosdecampo.com/desde-el-campo-de-cria-al-frigorifico-salio-la-norma-que-explica-como-se-deberan-aplicar-los-dispositivos-de-identificacion-individual-electronica/
