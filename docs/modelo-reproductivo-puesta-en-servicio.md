# Gate 0 — Modelo reproductivo / Puesta en servicio (cross-spec 02/03/07)

> Artefacto de refinamiento de contexto (ADR-022). Refinado por el leader con Raf (y Facundo) entre 2026-06-19 y 2026-06-23.
> **Es cross-spec**: toca el modelo de animal/rodeo (spec 02), MODO MANIOBRAS (spec 03) y reportes (spec 07). Por su impacto arquitectónico (cambia el motor de categorías deployado + define un patrón nuevo), **graduará a ADR cuando Facundo cierre sus puntos abiertos**.
> Insumo de dominio con fuentes: `specs/active/07-reportes-basicos/research-kpis-cria.md`.

## 0. Por qué existe este doc

Refinando los reportes (spec 07) apareció un cambio de modelo más grande: **cómo se representa la "puesta en servicio" y la dinámica reproductiva del rodeo**. Es el sustrato de los KPIs reproductivos (el diferencial del producto vs Control Ganadero). Como es transversal, se documenta una vez acá y las specs lo consumen.

## 1. Decisión central — el servicio se modela a NIVEL RODEO, no per-vaca

**Hoy** spec 03 tiene una maniobra de "servicio" que se carga vaca por vaca. **Decisión (Raf):** el servicio **deja de cargarse a mano por animal**; se define al **crear el rodeo** mediante los **meses en que ese rodeo hace servicio**, y eso define las "puestas en servicio" automáticamente.

**Por qué es correcto**: el servicio natural (toro con el rodeo) *ya es* a nivel grupo en la realidad — no se observa cada monta. Registrar "servicio" per-vaca siempre fue ficticio. Derivarlo de "este rodeo tuvo servicio en estos meses + esta hembra estaba en el rodeo" es **más fiel a la realidad**. (Validado por la literatura: Bavera recomienda *"dos servicios anuales: planillas separadas para cada servicio"* → config por rodeo/lote, no por establecimiento.)

**`servidas` (= todas las que se intentó preñar) =** vientres del rodeo presentes en la ventana de servicio **(servicio natural, derivado)** ∪ hembras con evento de **inseminación** registrado **(IA, sigue per-vaca)**. La maniobra de IA/IATF NO se toca (es una acción real con dato real).

## 2. Separación clave — CATEGORÍA vs ELEGIBILIDAD REPRODUCTIVA

Hoy están enredadas. Se separan:

| Concepto | Qué lo dispara | Dónde vive |
|---|---|---|
| **Categoría** (ternera→vaquillona→preñada→vaca…) | destete + tacto+ + parto + cortes de edad | `compute_category` (spec 02) — **casi sin tocar** |
| **Elegibilidad reproductiva** ("¿cuenta como servida/entorada?") | vaquillona: **apta + rodeo con ventana de servicio activa** · vaca: por default (vientre en rodeo con ventana) · IA: evento per-vaca | **capa nueva** (reportes/repro) — NO en `compute_category` |

→ **La aptitud y la puesta en servicio gatean el DENOMINADOR reproductivo, no la categoría.** Esto mantiene el motor de categorías simple.

### 2.1 Reconciliación de `compute_category` (impacto acotado)

El viejo backstop **`servicio→vaquillona` se ELIMINA**. Justificación: el **destete** ya es la vía canónica ternera→vaquillona, y los **cortes de edad** de `compute_category` cubren el caso "se olvidaron de destetar". Las transiciones grandes (**tacto+→preñada**, **parto→vaca**) **NO dependen del servicio per-vaca** → el ripple es chico. *(A verificar en el delta: que el corte de edad hembra ternera→vaquillona exista o se agregue como red de seguridad. Es backend deployado → Gate 1.)*

## 3. Aptitud reproductiva de la vaquillona

- **Qué es**: chequeo previo al primer servicio (maniobra `tacto_vaquillona` ya existe en spec 03). Criterios de dominio: desarrollo del tracto reproductivo (RTS 1-5), pelvimetría, y **peso objetivo** ≈ **66% del peso adulto** (canónico INTA 65%; cruzas índicas subtropicales 75% — **parametrizar por raza/región**).
- **Cómo se vincula**: la aptitud es el **gate de elegibilidad** de la vaquillona para entrar al denominador reproductivo. Una vaquillona **apta + en un rodeo con ventana de servicio activa** → cuenta como servida en esa campaña.
- **Lo resuelve la estructura de rodeos**: en cría, las vaquillonas de **reposición** (pre-servicio → aptitud) y las **entoradas** se manejan en **rodeos/lotes SEPARADOS** (ya anotado en `CONTEXT/07-pendientes.md`). Entonces: aptitud se chequea en el rodeo de reposición; al pasar la vaquillona apta al rodeo de entore (con ventana activa) → entra al denominador. Sin preguntarle nada al operario — lo resuelve el gating por rodeo.
  - **Fallback**: si un campo NO hace el chequeo de aptitud, caer a "vaquillona de edad de servicio en rodeo con ventana activa = servida" (default por edad), para no dejarlas fuera del denominador.
- **MVP = solo el veredicto de aptitud**: la maniobra `tacto_vaquillona` registra **APTA / NO_APTA / DIFERIDA** (veredicto del vet). **Semántica precisada por Facundo (2026-06-23)**: **APTA** = lista para servicio; **DIFERIDA** = *todavía le falta, pero PODRÁ ser apta en el futuro* → no cuenta ahora, **se re-evalúa** (transitoria, NO descarte); **NO_APTA** = *marcada como que NO lo será NUNCA* → **descarte permanente** (candidata a CUT/venta). Para el denominador reproductivo (Stream A) tanto NO_APTA como DIFERIDA se excluyen del "apta" — la distinción permanente/transitoria es para la **UI** (copy de los 3 estados) + un futuro hook **NO_APTA → sugerir descarte/CUT** (POST-MVP). El enum `heifer_fitness_result` ya tiene los 3 valores (0053).
- **POST-MVP**: el **diferencial de peso (66% / lo que corresponda por raza)** y su auto-validación. Depende del **catálogo de razas con peso adulto objetivo** (§7), que hoy NO tenemos sólido. En el MVP el vet ya pondera el peso al dar el veredicto; no lo automatizamos ni capturamos lógica de 66%.

## 4. Distribución cabeza / cuerpo / cola (CCL) — el diferencial diagnóstico

**Hallazgo de la investigación (Bavera)**: el % de preñez *total* "tiene poca relevancia para tomar decisiones"; **la distribución CCL es LA métrica diagnóstica** (dos rodeos con idéntico %preñez pueden tener problemas opuestos —mala nutrición vs venérea— que solo la distribución revela). → **Va al MVP de reportes.**

- **CCL = tamaño de preñez al tacto**: **cabeza = `large`** (preñez más avanzada → concebida primero, pare temprano), **cuerpo = `medium`**, **cola = `small`** (concebida último). Mapea **1:1** con el enum `pregnancy_status` (small/medium/large) → **sin cambio de schema**.
- **Regla de buckets según nº de meses de servicio del rodeo** (decisión Raf):
  - **1 mes** → sin distinción (todos misma edad) → tacto solo preñada/vacía.
  - **2 meses** → cabeza / cola (sin cuerpo).
  - **3 meses** → cabeza / cuerpo / cola.
  - **4 a 12 meses** → dividir en **tercios** → cabeza/cuerpo/cola de esos grupos de meses.
  - **Override** "sin distinción" elegible al crear el rodeo (provisional hasta que Facundo consulte a la universidad).
- **Tacto configurable (delta spec 03)**: al elegir la maniobra de tacto de preñez, un wizard pregunta **"¿tamaño de preñez? sí/no"**. El default **se deriva de la config del rodeo** (2-4 meses con distinción → SÍ; 1/12/"sin distinción" → NO). El operario puede override. `TactoStep` muestra los botones de tamaño según los buckets del rodeo.
- **Rodeos de 12 meses** (servicio continuo): preñada/vacía alcanza; **no** se ofrece tamaño por default ni reportes de CCL (faltan meses contra los cuales comparar). No se bloquea, pero no es el target.

## 5. Vinculación nacimiento ↔ servicio (cruce tacto vs pariciones)

- **Gestación = 284 días SIEMPRE** (decisión Facundo 2026-06-23: **NO** se parametriza por raza — 284 fijo para todos). *(Reemplaza la idea previa de "283-285 por raza" del research.)*
- **El mapeo nacimiento ↔ concepción es por MES, NO por día** (Facundo 2026-06-23): mes de concepción + ~9 meses = mes de parto (ej. **preñada en OCTUBRE → pare en JULIO**); inversamente, **mes de parto − 9 = mes de concepción**. Se trabaja a granularidad de **MES** (no se resta 284 días exactos a la fecha de parto). Eso ubica cada nacimiento en su mes de servicio (→ etapa CCL) y reconstruye la distribución real de pariciones por etapa. *(Lo implementa Stream C / reportes; Stream A ya trabaja por meses de `service_months`, no resta días → no se ve afectado.)*
- **El cruce de oro**: comparar el **%CCL del tacto** (lo que el vet diagnosticó) contra la **distribución real de nacimientos por etapa**. Sirve para:
  1. **Localizar las pérdidas, no solo contarlas** (si en tacto había 40% cabeza pero nació 25% en la ventana de cabeza → perdiste preñeces tempranas → apunta a aborto infeccioso/estrés vs, en la cola, baja fertilidad).
  2. **Cinética de preñez = calidad de manejo** (mucha cabeza = vacas en buen estado al inicio; mucha cola = problema de condición corporal previo).
  3. **Planificar la parición** (la cabeza pare primero → recorridas, personal, potreros).
  4. **Predecir el lote de terneros** (cabeza = nacen antes = más pesados/uniformes al destete = mejor precio).

## 6. Config de campaña por rodeo (selector de 12 meses)

- **Mecanismo (decisión Raf)**: al **crear un rodeo de cría**, el wizard (paso 4) pregunta los meses de servicio. Schema = `service_months smallint[]` (Stream A, `0102`, done); el **selector** es Stream B.
- **🔑 UN solo período CONTIGUO por rodeo (decisión Raf 2026-06-23)**: el selector **NO** debe permitir seleccionar **períodos separados/disjuntos** — un rodeo tiene **un** período de servicio (ej. primavera Oct/Nov/Dic, u otoño Jun/Jul, o continuo los 12). Un campo que hace primavera **Y** otoño los maneja en **rodeos/lotes SEPARADOS** (uno por período), **no** un rodeo con ambos. *(Corrige el "ambos" que esta sección decía antes.)* La contigüidad **admite wrap de fin de año** (ej. **Nov-Dic-Ene** es un período válido). La enforza el **selector de Stream B por construcción** (no se puede armar un set disjunto); server-side es defensa-en-profundidad opcional (backlog) — la derivación de Stream A usa set-membership y tolera cualquier set, así que la contigüidad es regla de **calidad de dato/UX**, no de seguridad/correctitud-de-membership. La contigüidad además hace que la **ventana de campaña** (`rodeo_service_campaign`) sea bien definida.
- **Default**: primavera (Oct/Nov/Dic) pre-tildado en el alta (caso dominante, no fricciona). **Editable**. Rodeos existentes sin config → los KPIs reproductivos invitan a configurarla. La edición arranca "sin configurar" (no pre-tilda; no inventar campañas).

## 7. Parámetros por raza + gaps de datos (de la investigación)

**Catálogo de razas con datos agronómicos = POST-MVP (decisión Raf 2026-06-23).** Hoy NO hay un catálogo de razas sólido con biotipo / peso adulto / gestación: la lista controlada de razas (con código SENASA) llega con **spec 08** (pendiente de implementar), y los parámetros agronómicos por raza son una enriquecedura posterior. Por eso en el MVP: **gestación = 284 único** + **aptitud = veredicto del vet** (sin cálculo de 66%). La parametrización por raza (gestación 283-285; peso adulto 66% templado / 75% subtropical-índico) se suma POST-MVP sobre ese catálogo.

**Gaps de datos → backlog**:
1. **Catálogo de razas con peso adulto objetivo** → habilita el % de entore auto-validable (POST-MVP). *(La gestación NO va por raza — Facundo: 284 fija siempre, mapeo por mes.)*
2. **Mortandad de terneros — matiz (corrige el reporte de research)**: **SÍ tenemos cómo marcar muerte** — la **baja con motivo `death`** (`exit_reason='death'`, spec 02 C3.3) sobre el perfil del ternero (que ya existe como animal desde el nacimiento — "ternero al pie"). → **la mortandad de terneros REGISTRADOS es computable** (conteo de bajas motivo muerte, categoría ternero/a). El **aborto es distinto**: pérdida de la PREÑEZ en la madre, antes de que el ternero nazca/exista. El gap fino restante es solo: (a) **nacidos muertos / muertos antes de registrarse** como animal, y (b) el **split peri/posnatal (48 h)** para esos KPIs específicos → requeriría un campo de mortalidad en el evento de parto o un evento de muerte con timestamp fino. NO bloquea la mortandad básica.
3. **Superficie en ha** (rodeo/establecimiento) → kg/ha + económicos.

**Tendencia/IEP/reposición/repetición** necesitan **historia multi-año** → la UI de reportes debe **degradar con gracia el primer año** ("se habilita con más campañas cargadas").

**Convención de denominador (Bavera)**: mostrar el denominador explícito en %preñez/parición/destete (toggle entoradas/preñadas/paridas). "Entoradas = entraron a servicio − retiradas".

## 8. Decomposición en 3 streams + dependencias

| Stream | Qué | Spec | Gate |
|---|---|---|---|
| **A — Modelo de puesta en servicio** (fundacional) | config `service_months` por rodeo (**se construye acá; no está en el repo**) + derivación de `servidas/entoradas` + reconciliar `compute_category` (sacar service→vaquillona) + `heifer_fitness` a 3 estados (APTA/NO_APTA/DIFERIDA) | **delta backend de spec 02** | 🔴 **Gate 1** (motor de categorías deployado + rodeo) |
| **B — Tacto configurable + baja del servicio manual** | wizard de config del tacto (tamaño sí/no, default desde rodeo) + `TactoStep` adapta buckets + captura de peso en aptitud + sacar/deprecar la maniobra de servicio manual | **delta de spec 03** | 🟡 frontend; Gate 2 |
| **C — Reportes reproductivos** | %preñez, %parición (paridas/servidas), **distribución CCL**, %destete, cruce tacto↔nacimientos, peso por categoría, comparativas, alertas, denominador explícito | **spec 07** | 🔴 **Gate 1** (vistas/RPC cross-tabla) |

**Orden**: A → B → C (C consume todo). Cerrar el **modelo (este Gate 0) primero** porque A/B/C están acoplados.

## 9. Pendiente de Facundo (consulta a la universidad) — defaults provisionales para no frenar

- **Bucketing CCL para 4-12 meses** (¿tercios exactos?). Default provisional: tercios.
- **Default de "sin distinción"**.
- **Política de tacto en rodeos de 12 meses** (default: solo preñada/vacía, sin CCL ni reportes CCL).
- **Umbral/alcance de la alerta "sin pesar"** (180 d / a qué categorías; en cría el adulto casi no se pesa) — ver `specs/active/07-reportes-basicos/context.md` §D2.
- **Confirmaciones de la investigación**: 75% peso adulto para índicos (sigue per-raza/región, POST-MVP). Gestación: **RESUELTO — 284 fija siempre (NO por raza), mapeo nacimiento↔concepción por MES** (Facundo 2026-06-23).

## 10. Gates

- **Gate 0**: este documento → ⏸ **Puerta 1 (aprobación humana del modelo + de la decomposición en 3 streams)**.
- **Gate 1**: obligatorio en Stream A (backend deployado: `compute_category` + rodeo) y Stream C (vistas/RPC cross-tabla scopeadas por tenant).
- **Gate 2**: por chunk de implementación.
- Veto de diseño del leader (`design-review`) sobre toda pantalla antes de mostrarla a Raf.
- **Graduación a ADR** cuando Facundo cierre §9 (decisión arquitectónica: servicio rodeo-level + impacto en el motor de categorías).
