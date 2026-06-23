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
- **El 66% en el MVP**:
  1. **Activar la captura de peso junto a la maniobra de aptitud** (`tacto_vaquillona`): peso + veredicto de tracto en una pasada.
  2. **"Apta / no apta" = veredicto del vet** (que ya pondera el 66% + el tracto). No se automatiza el cálculo todavía.
  3. El 66% como **guía visual, no gate duro**, hasta tener un config de **peso adulto objetivo por raza** (data gap, §7). Ahí se podrá auto-validar.

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

- **Gestación = 284 días** (cifra de trabajo; **por raza**: Angus 278, Hereford 285 → usar **283-285 configurable por raza**, no constante).
- **A la fecha de parto se le restan ~284 días → mes de concepción → cae en un mes de servicio → etapa CCL.** Eso permite reconstruir la distribución **real** de pariciones por etapa.
- **El cruce de oro**: comparar el **%CCL del tacto** (lo que el vet diagnosticó) contra la **distribución real de nacimientos por etapa**. Sirve para:
  1. **Localizar las pérdidas, no solo contarlas** (si en tacto había 40% cabeza pero nació 25% en la ventana de cabeza → perdiste preñeces tempranas → apunta a aborto infeccioso/estrés vs, en la cola, baja fertilidad).
  2. **Cinética de preñez = calidad de manejo** (mucha cabeza = vacas en buen estado al inicio; mucha cola = problema de condición corporal previo).
  3. **Planificar la parición** (la cabeza pare primero → recorridas, personal, potreros).
  4. **Predecir el lote de terneros** (cabeza = nacen antes = más pesados/uniformes al destete = mejor precio).

## 6. Config de campaña por rodeo (selector de 12 meses)

- **Mecanismo (decisión Raf)**: al **crear un rodeo de cría**, un **selector/tilde de los 12 meses** — el usuario marca en qué meses ese rodeo hace servicio (primavera Oct/Nov/Dic; otoño Jun/Jul; ambos; o continuo). **Raf ya lo está construyendo** (delta de rodeo, spec 02) → spec 07/03 lo **consumen, no lo construyen**. *(Pendiente: confirmar nombre + shape del campo, ej. `service_months smallint[]` o bitmask.)*
- **Default**: primavera (Oct/Nov/Dic) pre-tildado (caso dominante, no fricciona el alta). **Editable**. Rodeos existentes sin config → los KPIs reproductivos invitan a configurarla (o asumen el default). A definir en la spec.

## 7. Parámetros por raza + gaps de datos (de la investigación)

**Parametrizar por raza (no hardcodear)**: gestación (283-285 d) y peso adulto objetivo (66% templado / 75% subtropical-índico).

**3 gaps de datos → backlog** (habilitan KPIs hoy imposibles):
1. **Evento de muerte de ternero** (con fecha/causa) → mortandad peri/posnatal.
2. **Peso adulto objetivo por raza** (config del catálogo de razas) → % de entore auto-validable.
3. **Superficie en ha** (rodeo/establecimiento) → kg/ha + económicos.

**Tendencia/IEP/reposición/repetición** necesitan **historia multi-año** → la UI de reportes debe **degradar con gracia el primer año** ("se habilita con más campañas cargadas").

**Convención de denominador (Bavera)**: mostrar el denominador explícito en %preñez/parición/destete (toggle entoradas/preñadas/paridas). "Entoradas = entraron a servicio − retiradas".

## 8. Decomposición en 3 streams + dependencias

| Stream | Qué | Spec | Gate |
|---|---|---|---|
| **A — Modelo de puesta en servicio** (fundacional) | config de meses de servicio por rodeo (en curso, Raf) + regla de buckets CCL + "sin distinción" + derivación de `servidas` + reconciliar `compute_category` (sacar service→vaquillona) + flag/captura de aptitud | **delta backend de spec 02** | 🔴 **Gate 1** (motor de categorías deployado + rodeo) |
| **B — Tacto configurable + baja del servicio manual** | wizard de config del tacto (tamaño sí/no, default desde rodeo) + `TactoStep` adapta buckets + captura de peso en aptitud + sacar/deprecar la maniobra de servicio manual | **delta de spec 03** | 🟡 frontend; Gate 2 |
| **C — Reportes reproductivos** | %preñez, %parición (paridas/servidas), **distribución CCL**, %destete, cruce tacto↔nacimientos, peso por categoría, comparativas, alertas, denominador explícito | **spec 07** | 🔴 **Gate 1** (vistas/RPC cross-tabla) |

**Orden**: A → B → C (C consume todo). Cerrar el **modelo (este Gate 0) primero** porque A/B/C están acoplados.

## 9. Pendiente de Facundo (consulta a la universidad) — defaults provisionales para no frenar

- **Bucketing CCL para 4-12 meses** (¿tercios exactos?). Default provisional: tercios.
- **Default de "sin distinción"**.
- **Política de tacto en rodeos de 12 meses** (default: solo preñada/vacía, sin CCL ni reportes CCL).
- **Umbral/alcance de la alerta "sin pesar"** (180 d / a qué categorías; en cría el adulto casi no se pesa) — ver `specs/active/07-reportes-basicos/context.md` §D2.
- **Confirmaciones de la investigación**: 75% peso adulto para índicos; gestación por raza.

## 10. Gates

- **Gate 0**: este documento → ⏸ **Puerta 1 (aprobación humana del modelo + de la decomposición en 3 streams)**.
- **Gate 1**: obligatorio en Stream A (backend deployado: `compute_category` + rodeo) y Stream C (vistas/RPC cross-tabla scopeadas por tenant).
- **Gate 2**: por chunk de implementación.
- Veto de diseño del leader (`design-review`) sobre toda pantalla antes de mostrarla a Raf.
- **Graduación a ADR** cuando Facundo cierre §9 (decisión arquitectónica: servicio rodeo-level + impacto en el motor de categorías).
