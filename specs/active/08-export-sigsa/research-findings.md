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
- [ ] **Validaciones server-side de SIGSA no documentadas** (rango de fechas, `;` final, espacios): conviene **probar un upload real** contra SIGSA antes de cerrar la feature. **Actualizado 1/8/2026**: la longitud de RFID sale de la lista (15 dígitos confirmado, §5 del manual); el resto sigue abierto y ahora hay un plan de prueba de una sola pasada en `context.md`. Ver §8.2.
- [ ] **Especie/categoría**: confirmar si el TXT distingue solo bovina o si el flujo cambia con bubalina/cérvida (MVP es bovino, así que probablemente no aplica).
- [ ] **Scope**: ¿08 cubre solo alta de dispositivos, o también reidentificación (§2) y declaración al cierre de DT-e? (Sugerencia original: MVP solo alta.) ⚠️ **La sugerencia dejó de ser obvia el 1/8/2026**: desde el **3/8** el cierre de DT-e es el punto donde SENASA bloquea el CUIG. Decisión de Raf, ver §8.5.

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

---

## 8. Re-verificación regulatoria — 1/8/2026 (sesión de modelo de negocio)

> **Motivo**: durante una revisión de modelo de negocio surgió la alarma de que la Res. 117/2026 (sistema "TRAZA") podía haber invalidado el formato de 08. **La alarma era falsa.** Se deja documentado para que nadie lo redescubra en pánico.

### 8.1 TRAZA no toca a 08

- La **Res. 117/2026** (BO 23/7/2026) **no es de SENASA**: la dictó la **Secretaría de Agricultura, Ganadería y Pesca** (Ministerio de Economía). Firmada 21/7/2026.
- Art. 1: TRAZA es "una herramienta informática de carácter **orientativo, de consulta y de aplicación optativa**". **No reemplaza a SIGSA ni a SIGBIOTRAZA, y no deroga nada.** SIGSA aparece una sola vez en la resolución, como sistema de emisión de DT-e.
- 3 módulos, en desarrollo y con habilitación gradual (Art. 4, "conforme al avance del desarrollo informático"): (i) info general de establecimientos (RENSPA, stock, caravanas); (ii) ingresos/egresos + resultados de faena + "Visor TRAZA"; (iii) autocontrol de stock afectado a garantías (prendas, warrants). **No hay cronograma de migración porque no hay migración.**
- **Impacto en 08: ninguno.** SIGSA sigue siendo el destino y el portal sigue vivo (`https://aps2.senasa.gov.ar/sigsa` → 200 + redirect al SSO JOSSO, verificado 1/8/2026).

### 8.2 Formato confirmado contra el manual oficial

- Manual **v2.42.80**, misma URL, `Last-Modified: 7/1/2026` → **sin cambios en 7 meses**. Bajado y extraído con `pdftotext -layout`.
- §6, cita literal: *"El formato del archivo debe ser: DISPOSITIVO-SEXO-RAZA-FECHA NACIMIENTO;DISPOSITIVO-SEXO-RAZA-FECHA NACIMIENTO. Los datos asociados a un dispositivo RIFD deben estar separados entre ellos con un GUIÓN DEL MEDIO y la separación entre dispositivos RFID es con PUNTO Y COMA."*
- §5 confirma **RFID = 15 dígitos numéricos**.
- Tabla de razas: coincide **1:1** con R1.2 (28 bovinas + `S/E` + 3 bubalinas). Sin cambios respecto de `razas-senasa-codigos.md`.
- Reidentificación (`ORIGINAL-NUEVO;…`): sin cambios.
- **Anomalías en el ejemplo del propio manual** (copiado literal): `032010000000000-M-H-08/2025; 032010000000001-H-AA8/2025;032010000000002-M-B-08/2025;032010000000003-M-B-08/2025` — hay un **espacio después del primer `;`** y un registro **`AA8/2025`** al que le falta el `-0`. Sin `;` final. No se sabe si son typos del PDF o tolerancia real del parser → **es exactamente por esto que el gate del upload real sigue abierto**.

### 8.3 Sin API (confirmado de nuevo)

Ni TRAZA ni SIGSA exponen API/webservice para declaración de dispositivos. La única API REST documentada de SENASA es la de trazabilidad de **fitosanitarios** (Res. 369/2021), otro dominio. La decisión de "archivo + upload manual" sigue siendo la correcta.

### 8.4 SIGBIOTRAZA: vigente y ampliado

TRAZA no lo absorbió. Ahora también en **iOS** (App Store `id6756583501`), además de Android. Tres funciones: declarar dispositivos, iniciar TRI, cerrar DT-e. **Sigue sin exportar archivo** → sigue siendo competidor no integrable, y el diferencial de 08 se mantiene.

### 8.5 El corte del 3/8/2026 — lo más relevante de esta re-verificación

**No es una resolución nueva.** Es el **Memorándum SENASA ME-2026-66264109-APN-DESYCG#SENASA**, que activa **dos controles automáticos en SIGSA** sobre movimientos de terneros alcanzados por la Res. 841/2025:

1. Al **emitir** el DT-e: el origen debe tener dispositivos declarados **y TRI (Tarjeta de Registro Individual) electrónica**.
2. Al **cerrar** el DT-e: el destino debe declarar el **100%** de los dispositivos recibidos.

Se termina el cierre manual de DT-e de terneros. **Sanción: bloqueo preventivo del CUIG** → el productor no puede emitir DT-e de ninguna categoría.

La obligación del Art. 8° (declarar en **10 días hábiles**) **no cambia**; la Res. 841/2025 sigue vigente sin modificatorias encontradas.

**Consecuencia para 08 y para el pitch comercial:**
- 08 cubre el **alta de dispositivos**. **NO cubre TRI ni cierre de DT-e**, que es donde desde el 3/8 se aplica la sanción.
- Por lo tanto **no se puede vender "cumplí la 841 con RAFAQ"**: se vende *"te generamos el archivo de declaración de dispositivos para SIGSA"*. Un productor que compre entendiendo lo primero y se coma un bloqueo de CUIG en su primer movimiento se lo va a atribuir a RAFAQ.
- Queda como **decisión de scope abierta para Raf** (ver `context.md`, sección Alcance): si el cierre de DT-e entra al roadmap y con qué prioridad.

### 8.6 Fuentes de esta sección

- Res. SAGyP 117/2026 (BO): https://www.boletinoficial.gob.ar/detalleAviso/primera/344825/20260723
- Ficha biblioteca SENASA 117/2026: https://biblioteca.senasa.gob.ar/items/show/8394
- Infobae/Revista Chacra — TRAZA: https://www.infobae.com/revista-chacra/2026/07/23/crean-el-sistema-traza-para-mejorar-el-acceso-a-la-informacion-del-ganado-y-fortalecer-la-gestion-productiva/
- Corte 3/8/2026 y controles DT-e: https://www.decamponoticias.com/identificacion-electronica-en-terneros/
- Fin del cierre manual de DT-e: https://www.noti-rio.com.ar/2026/07/revolucion-digital-en-los-corrales-el-senasa-le-pone-fin-al-cierre-manual-de-transito-de-terneros/
- Vías de declaración vigentes: https://www.decamponoticias.com/caravanas-electronicas-declaracion/
- SIGBIOTRAZA en iOS: https://apps.apple.com/ar/app/sigbiotraza/id6756583501

---

## 9. TRI y cierre de DT-e — dimensionamiento (1/8/2026)

> **Motivo**: §8.5 detectó que 08 cubre una de tres obligaciones. Este research mide las otras dos antes de decidir scope. Todos los PDFs bajados con `curl` + `pdftotext -layout`; los tres tienen `Last-Modified: 7/1/2026` — **ninguno se actualizó tras el memorándum del 3/8**.

### 9.1 Corrección al framing de §8.5 — quién carga cada obligación

§8.5 dio a entender que las tres obligaciones caen sobre nuestro cliente. **No es así**, y esto cambia la severidad:

| Obligación | Quién la carga | ¿Es nuestro ICP (criador de cría)? |
|---|---|---|
| Declarar dispositivos (10 días hábiles) | El productor que aplica la caravana | **Sí** — y es lo que hace 08 |
| **TRI** al emitir el DT-e | El **RENSPA de origen** | **Sí** — es la pata que falta |
| Declarar 100% de dispositivos al **cerrar** el DT-e | El **destino** (comprador / invernador / feedlot / feria) | **No** |

El riesgo propio del criador es el **caso C** del manual: *"El movimiento de terneros sin identificación electrónica podrá generar restricciones para el RENSPA remisor"* — y eso **se previene declarando los dispositivos**, o sea con lo que 08 ya hace. El bloqueo por cierre de DT-e es problema del comprador.

### 9.2 Qué es la TRI

**Tarjeta de Registro Individual (de Tropa)**. Vive en **SIGSA web**: `[MOVIMIENTOS][TRI+][Nueva TRI]`. No es de SIGBIOTRAZA.

- Contiene **RENSPA de origen** + **listado de RFID** de los terneros a movilizar. Produce un **Número TRI** con estado (`pendiente` = sin DT-e asociado). Se asocia al DT-e en la 3ª pantalla ("DATOS ESPECÍFICOS"). **Se imprime y acompaña físicamente al DT-e.** Anulable y rehacible.
- **⚠️ Discrepancia sin resolver**: el manual (dic-2025, pág. 8) dice literal *"El RENSPA de origen **puede optar (no es obligatorio)** por confeccionar la TRI…"*. La prensa del memorándum (jul-2026) dice que *"el sistema exige generar una TRI"*. **El texto del memorándum no está publicado.** La obligatoriedad se apoya solo en prensa.
- Consecuencia de NO usarla (manual, pág. 10): *"en el destino no aparecerán los dispositivos… y el productor/remate feria deberá proceder leerlos y declararlos al cierre"*. O sea: no es una sanción al criador, es fricción que se traslada al comprador.
- "TRI electrónica vs anterior": **NO ENCONTRADO** — ninguna fuente describe una TRI previa no-electrónica.

### 9.3 La TRI SÍ acepta archivo — layout distinto al del alta

Cita literal (manual de cierre de DT-e / gestión de TRI, pág. 9, punto 3):

> *"Si no desea tipear las caravanas puede subir un archivo formato TXT con el listado de dispositivo de identificación desde el botón celeste **[Subir Archivo]**. Los dispositivos del archivo TXT deben encontrarse separados entre ellos con un **ESPACIO**. Ej.: `032010000000000 032010000000001 032010000000002`"*

**Solo RFID separados por espacio.** Sin sexo, sin raza, sin fecha, sin `;`, sin guiones. **No** reusa el layout `RFID-SEXO-RAZA-MM/AAAA;` del alta. Único dato de pantalla: el RENSPA.

### 9.4 El cierre de DT-e NO acepta archivo

- **Quién**: el destino. *"el productor comprador/receptor del ganado en el RENSPA/FERIA de destino debe leer y registrar los dispositivos… y asociar sus números al cierre del DT-e"* (pág. 2).
- **Dónde**: `[MOVIMIENTOS][CONSULTAR MOVIMIENTOS][LISTADO DE MOVIMIENTOS BOVINOS]` → Acciones → `[Cerrar]`.
- **No hay importación.** Cita (pág. 4): *"En el recuadro de [Caravanas] se debe **pegar** los números de dispositivos…"*. El separador del pegado **NO ENCONTRADO**. La única carga masiva es `[Lote Microchips]`, y solo aparece si se gestionó el lote previamente **por SIGBIOTRAZA**.
- Validación server-side: *"Los dispositivos a informar al cierre del DT-e por el destinatario, deben haber sido declarados como aplicados en los animales en el RENSPA de origen. Caso contrario no dejara cerrar el DT-e."*
- Con TRI asociada, los dispositivos vienen pre-tildados en destino.

### 9.5 Emisión del DT-e

SIGSA web, autogestión (clave fiscal + CBU + RENSPA). El manual del autogestor **no menciona archivo, TXT, importar ni subir en ninguna línea** — todo por pantalla. La única importación de archivo en todo el flujo de movimiento es la de la TRI.

### 9.6 SIGBIOTRAZA — dónde nos gana y dónde le ganamos

Tres módulos; **todos terminan en un segundo paso obligatorio en SIGSA web**.

| Módulo | Qué pide en la manga | ¿RAFAQ agrega valor? |
|---|---|---|
| Declaración de dispositivos | **Raza, mes/año de nacimiento y sexo, a mano, dispositivo por dispositivo** | **Sí, por goleada** — RAFAQ ya tiene esos datos |
| Inicio de TRI | Nada (solo lee RFID) | Poco |
| Cierre de DT-e | Nada (escanea el código de barras del DT-e con la cámara) | Poco |

Fricción de SIGBIOTRAZA: requiere lector RFID Bluetooth externo (no lee sola); **token QR generado en SIGSA desde una computadora** con clave fiscal; CUIT propio y representado deben coincidir exacto; recomienda internet para validar y enviar; nunca cierra el trámite solo.

**Conclusión**: el diferencial de 08 sigue intacto **en el alta** (es donde SIGBIOTRAZA obliga a tipear), y **no se extiende naturalmente al cierre**.

### 9.7 Pista de API — el token no es exclusivo de SIGBIOTRAZA

El manual de gestión de token dice literal que el mecanismo *"permite crear una 'llave de acceso' segura y temporal para que **otras aplicaciones externas** puedan interactuar con la información registrada en el sistema oficial del Senasa"*, con permisos delegables de *"Gestionar microchips de identificación y consulta de movimientos"*.

**Eso implica que hay una API detrás.** Si existe y es accesible, cambia la feature de "generar archivo + upload manual" a "declarar desde la app", que es un producto distinto y bastante mejor.

**Especificación pública: NO ENCONTRADA.** No es una ruta transitable hoy — es una pregunta para `hacelafacil@senasa.gob.ar`. **Contradice el supuesto "no hay API" que atraviesa toda la spec 08**, así que conviene preguntarlo antes de dar la feature por cerrada.

### 9.8 Dimensionamiento

- **TRI → BARATO.** Layout más simple que el del alta, mismo patrón (generar TXT + share sheet). Lo único nuevo es modelar **qué animales salen en este movimiento** (lote/tropa de venta). No requiere modelar tránsitos, guías ni destino.
- **Cierre de DT-e → CARO y ajeno.** Sin importación de archivo, lo barato (una lista pegable) tiene valor marginal y separador no confirmado. Lo valioso exige entidades nuevas (DT-e recibido, origen/destino, conciliación enviado-vs-recibido) y **lo hace el comprador**, que no es nuestro ICP.
- **Recomendación**: sumar **solo el TXT de TRI**, dejar cierre de DT-e y modelado de tránsitos fuera.
- **Riesgo abierto**: la obligatoriedad de la TRI se apoya solo en prensa y el manual oficial dice lo contrario. **Pedir el texto del memorándum a `hacelafacil@senasa.gob.ar` antes de comprometer scope** — mismo mail donde conviene preguntar por la API del token (§9.7).

### 9.9 Fuentes de esta sección

- Declaración de dispositivos al cierre del DT-e y/o gestión de TRI: https://www.argentina.gob.ar/sites/default/files/2026/01/declaracion_de_dispositivos_de_identificacion_electronicos_al_cierre_del_dt-e.pdf
- Manual de uso SIGBIOTRAZA: https://www.argentina.gob.ar/sites/default/files/2026/01/manual_de_uso_-_sigbiotraza.pdf
- Gestión de token: https://www.argentina.gob.ar/sites/default/files/2026/01/gestion_de_token_para_vincular_la_app_sigbiotraza_con_sigsa.pdf
- Manual DT-e autogestor SIGSA (mismo directorio de SENASA)
- Prensa del memorándum: https://www.noti-rio.com.ar/2026/07/revolucion-digital-en-los-corrales-el-senasa-le-pone-fin-al-cierre-manual-de-transito-de-terneros/
