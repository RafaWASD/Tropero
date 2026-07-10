# Correcciones de la prueba en vivo con Facundo — 2026-06-27

> Triage + plan de ejecución de las 15 correcciones que salieron de testear la app en vivo con Facundo
> (fase PRE-campo, sin datos reales, **bastón todavía no probado**). Documento de coordinación: cada
> segmento que toca DB pasa por su Gate 0 + spec antes de implementar. No es spec en sí mismo.

## Cómo leer la dificultad

- **S** (chico): UI/copy pura o reordenar un array. Sin migración. Gate 1 N/A. 1 run de implementer.
- **M** (medio): lógica cliente + UI, o un filtro nuevo. A veces un RPC chico. Gate 2 sí, Gate 1 según toque.
- **L** (grande): migración + RPC + RLS + UI nueva + flujo nuevo. Gate 0 → spec → Gate 1 → Gate 2.

**Capas**: `UI` (presentación) · `cliente` (lógica/estado) · `DB` (migración/schema) · `RPC` · `RLS` · `BLE`.

## Tabla maestra (las 15, mapeadas a código)

| # | Corrección | Segmento | Dif. | Capas | Gate 1 |
|---|---|---|---|---|---|
| 7 | Madre → crías al pie + destete a historial + peso de destete | A | **L** | DB·RPC·RLS·cliente·UI | sí |
| 4 | Elegir rodeo del ternero al nacer desde la madre | A | **L** | RPC·RLS·cliente·UI | sí |
| 15 | "Con cría al pie" en el alta → pedir/crear ternero y vincular | A | **L** | RPC·cliente·UI | sí |
| 1a | Caravana visual del ternero en el parto | A | M | RPC·cliente·UI | quizá |
| 8 | %parición = 0% (bug) + meses de parto + no en servicio 12m + solo si hay partos | B | **L** | RPC·cliente·UI | sí |
| 10 | %destete desde el 1er destete del año + cartel destete parcial | B | **L** | RPC nuevo·cliente·UI | sí |
| 9 | "KPIs" → "Datos" en reportes | B | **S** | UI/copy | no |
| 6 | Agregar caravana (visual+electrónica) desde la ficha + botón bastoneo | C | M | cliente·UI·BLE (·RPC) | quizá |
| 1b | Inseminación solo a hembras aptas | D | M | cliente (·UI) | no |
| 5 | Indicador de estado reproductivo (preñada/vacía) en lista de rodeo + ficha | D | M | cliente·UI | no |
| 3 | Fecha de nacimiento opcional dd/mm en campo separado del año | E | M | cliente·UI | no |
| 13 | Condición corporal en el alta como en maniobra (stepper +/−) | E | M | UI (reusa `condition-stepper.ts`) | no |
| 14 | Poder destildar los datos opcionales del alta | E | M | cliente·UI | no |
| 12 | Dientes en el alta ordenados mayor→menor (revisar maniobra) | E | **S** | UI (1 array) | no |
| 2 | 3 tipos de caravana → 2; `visual_id_alt`→"Nombre/apodo" por toggle de rodeo | E | M | cliente·UI·DB(config) | quizá |
| 11 | Circunferencia escrotal: sacar barra verde, mostrar todas con edad, años tras 24m | F | **S** | UI | no |
| 16 | Wheels (CE + edad en meses): poder **tapear** las opciones visibles arriba/abajo, no solo scrollear | G | M | cliente·UI | no |

---

## Segmentos ordenados por importancia / dificultad (mayor → menor)

### A · Vínculo madre–cría (el corazón del modelo de cría) — **L**

El más importante (es la razón de ser de una app de cría) y el más difícil. Todo el cluster del ternero:
crearlo bien, vincularlo a la madre, asignarle rodeo y caravana, y cerrar el ciclo con el destete +
peso de destete. **Dependencia clave**: el peso de destete (#7) es insumo del %destete (#10, segmento B).

- **#7 — Madre → crías al pie + destete a historial + peso de destete**
  - Hoy: `app/app/animal/[id].tsx:1528-1603` (`MotherCard`) resuelve **ternero → madre** vía `birth_calves`
    (0045) → `reproductive_events.birth`. **No existe la inversa** madre → crías, ni botones a las crías al
    pie, ni peso de destete (`reproductive_events` tipo `weaning` **no tiene columna de peso**).
  - Cambiar: (a) card inversa en la ficha de la madre listando crías al pie con botón "ir al ternero"
    (query sobre `birth_calves`); (b) al destetar, sacar el botón pero conservar el vínculo + peso en el
    historial; (c) **migración nueva**: columna `weaning_weight` en `reproductive_events` (o tabla de destete).
  - Capas: `DB` (weaning_weight) · `RPC` (registrar destete con peso) · `RLS` (hereda `birth_calves_select`) · `cliente` · `UI`.

- **#4 — Elegir rodeo del ternero al nacer desde la madre**
  - Hoy: `enqueueRegisterBirth` (`app/src/services/powersync/outbox.ts:289-334`) crea el ternero con
    tag/sexo/fecha pero **sin rodeo**. El parto NO es maniobra de manga: vive en `app/app/agregar-evento.tsx`.
  - Cambiar: selector de rodeo en el form del ternero → pasar `rodeo_id` por cría al RPC `register_birth`;
    validar server-side que el rodeo es del mismo establecimiento.
  - Capas: `RPC` · `RLS` · `cliente` · `UI`.

- **#15 — "Con cría al pie" en el alta → pedir/crear ternero y vincular**
  - Hoy: `app/app/crear-animal.tsx:1240-1252` solo setea `nursing=true`. **No hay acción post-create**: no
    pide caravana del ternero, no lo vincula, no ofrece crearlo.
  - Cambiar: flujo post-alta cuando `nursing=true` → pedir IDV/electrónica del ternero (manual o bastón) →
    find-or-create (reusa el motor de spec 09) → vincular vía `birth_calves`/`register_birth`. Se conecta con #4
    (¿el ternero hereda el rodeo de la madre o se elige?).
  - Capas: `RPC` · `cliente` · `UI`.

- **#1a — Caravana visual del ternero en el parto**
  - Hoy: el ternero del parto recibe tag electrónico/sexo/fecha; la caravana **visual** se asigna después,
    por ruta aparte (`asignar-caravanas.tsx`).
  - Cambiar: campo de caravana visual opcional en el form del ternero al registrar el parto.
  - Capas: `cliente` · `UI` (· `RPC` si `register_birth` no acepta visual hoy).

> **Forma de entrega**: 1 Gate 0 (context refinado del cluster ternero) → probablemente 2 specs (delta backend
> sobre 02 para `weaning_weight` + `register_birth(rodeo)`, y delta frontend ficha/alta/parto). Gate 1 + Gate 2.

### B · Reportes reproductivos (que los números no mientan) — **L**

Importancia alta: un %parición en 0% con partos cargados rompe la confianza en el toque. Dificultad alta:
toca el RPC `0106_reports_rpcs.sql` + un RPC nuevo + **semántica que tiene que cerrar Facundo**.

- **#8 — %parición = 0% + lógica de meses de parto**
  - Hoy: `rodeo_calving_kpi` (`supabase/migrations/0106_reports_rpcs.sql:285-343`). La fórmula cuenta partos
    cuya **concepción** (`event_date − 9 meses`) cae en `service_months` del año. **Raíz del 0%**: si
    `service_months` está NULL/`{}`, la guarda de la línea 337-339 nunca deja contar → 0%. (Causa probable:
    el rodeo de prueba no tiene meses de servicio configurados, o los partos se cargaron con fechas fuera de
    la ventana servicio+9.)
  - Cambiar: (a) arreglar el caso `service_months` vacío para que no devuelva 0 silencioso (mostrar "sin
    meses de servicio configurados" en vez de 0%); (b) **mostrar parición solo si hay pariciones**; (c) **no
    mostrar parición en rodeos de servicio 12 meses** (servicio continuo → no hay "mes de parto"); (d) mostrar
    el dato **solo en los meses de parto** = meses de servicio + ~9 (gestación 284 d). ← **definición a
    confirmar con Facundo**.
  - Capas: `RPC` · `cliente` · `UI`.

- **#10 — %destete desde el 1er destete del año + cartel de destete parcial**
  - Hoy: **no existe** RPC de destete (`rodeo_weaning_kpi`). El destete es solo un evento individual.
  - Cambiar: RPC nuevo `rodeo_weaning_kpi` (análogo a parición) + KpiCard + lógica: mostrar %destete **solo
    desde que hubo el primer destete del año**; si fue **parcial**, cartel "todavía hay crías al pie, esto
    puede afectar el número". **Depende de #7** (sin captura de destete + peso, no hay numerador robusto).
  - Capas: `RPC nuevo` · `cliente` · `UI`.

- **#9 — "KPIs" → "Datos"**
  - Hoy: texto literal en `app/app/(tabs)/reportes.tsx:340` ("Calculando KPIs…") y `:355` ("los KPIs
    reproductivos"). Trivial.
  - Cambiar: copy → "Datos" / "Calculando los datos…". Revisar también títulos de sección por consistencia.
  - Capas: `UI/copy`.

> **Forma de entrega**: delta-spec sobre 07. Gate 1 (toca RPC cross-tabla scopeado por tenant) + Gate 2.
> El #9 se folda como copy trivial dentro del mismo run.

### C · Identificación desde la ficha — **M**

- **#6 — Agregar caravana (visual + electrónica) desde la ficha + botón bastoneo**
  - Hoy: `app/app/animal/[id].tsx:748-...` muestra los 3 identificadores **solo lectura**. Existe el servicio
    `assignTagToAnimal` (`animals.ts:1031` → RPC `assign_tag_to_animal`, 0089, guard NULL→valor, valida 15
    díg). El BLE existe entero en `app/src/services/ble/` pero **hoy solo se usa en maniobra**, no en la ficha.
  - Cambiar: afordancia en la ficha para asignar/editar caravana electrónica (RPC existe) y visual
    (`visual_id_alt`, editable por R4.13) + botón "Detectar bastoneo" que lee el EID y lo asigna a ESE animal.
  - **Gated por hardware**: el botón bastoneo necesita el adaptador `spp-android` real (dev build que Raf aún
    no armó) — **el bastón todavía no se probó**. La parte **manual** (tipear caravana) es buildable ya; el
    bastoneo se cablea contra el mock y se valida en device después.
  - Capas: `cliente` · `UI` · `BLE` (· `RPC` si falta path para visual).

### D · Maniobra reproductiva (gating de aptitud) — **M / a confirmar**

- **#1b — Inseminación solo a hembras aptas**
  - Hoy: `InseminacionStep.tsx` aplica a **cualquier hembra** si el rodeo habilita el data-key `inseminacion`
    (`maneuver-applicability.ts:103-127` devuelve `true` sin filtro de aptitud).
  - Cambiar: en `appliesToAnimal()` agregar rama que exija aptitud. **Definición a confirmar con Facundo**:
    ¿"apta" = hembra con `tacto_vaquillona='apta'` previo? ¿las vacas multíparas/2º servicio son aptas por
    default? ¿qué excluye exactamente?
  - Capas: `cliente` (· `UI` para un hint "solo aptas").

- **#5 — Vaca 2º servicio + multípara: marcar preñez/vacía si tuvo tacto**
  - Hoy: el `TactoStep.tsx` **ya permite** PREÑADA/VACÍA para **cualquier hembra** (el único gating es
    sexo=hembra; no hay restricción por categoría). **Necesito screenshot**: ¿en qué pantalla y con qué
    categoría no te lo ofreció? Posible causa: el rodeo no tenía el data-key `prenez` habilitado, o lo viste
    en el **alta** (campo `showPregnancy`), no en la maniobra.
  - Capas: a determinar tras el screenshot (probablemente config/gating, no código nuevo).

### E · Pulido del alta de animal — **S/M (varios, casi todo UI)**

Importancia menor (no rompen nada) pero suman fricción en la manga; casi todo UI puro. Se baten juntos.

- **#12 — Dientes ordenados mayor→menor (revisar maniobra)** — **S**
  - Hoy: `app/src/utils/teeth-options.ts:32-41`, orden `2d/4d/6d/boca_llena/3-4/1-2/1-4/sin_dientes`
    (= exactamente **al revés** de lo pedido). El array lo comparten el alta (`crear-animal.tsx`) **y** la
    maniobra (`DientesStep.tsx`) → reordenar el array **arregla los dos a la vez**.
  - Cambiar: orden `sin_dientes / 1-4 / 1-2 / 3-4 / boca_llena / 6d / 4d / 2d`.
  - Capas: `UI` (1 array). Verificar que ningún test fije el orden viejo.

- **#13 — Condición corporal como en maniobra (stepper +/−)** — **M**
  - Hoy: el alta usa `ScoreChips` (17 chips). La maniobra usa `CondicionCorporalStep.tsx` (valor hero + botones
    − / + gigantes), con la aritmética pura ya en `app/src/utils/condition-stepper.ts`.
  - Cambiar: reemplazar los chips del alta por el stepper (reusa `condition-stepper.ts`; quizá extraer el
    componente del paso de maniobra a uno compartido).
  - Capas: `UI`.

- **#3 — Fecha de nacimiento opcional dd/mm separada del año** — **M**
  - Hoy: solo año (`crear-animal.tsx:182`, `animal-birth-year.ts`) → se guarda `AAAA-07-01` (mitad de año para
    minimizar sesgo de edad). `animals.birth_date` ya es `DATE` → **sin migración**.
  - Cambiar: campo opcional dd/mm separado; si lo cargan, usar la fecha exacta; si no, mantener el midpoint.
  - Capas: `cliente` · `UI`.

- **#14 — Poder destildar los datos opcionales del alta** — **M**
  - Hoy: los opcionales son estado React; una vez tocados se editan/vacían a mano, **no hay "quitar este
    dato"** explícito (riesgo: tocás sin querer y se carga).
  - Cambiar: afordancia para limpiar/desmarcar cada opcional. **Decisión propuesta** (a validar): una "✕" por
    campo que lo vuelve a "sin cargar" (más rápido en manga que un checkbox por campo).
  - Capas: `cliente` · `UI`.

- **#2 — Caravana visual "doble" → dejar 1** — **S / a confirmar**
  - Hoy: en el código **no hay duplicado literal** — el campo de identificación es condicional por
    `prefillKind` (visual read-only **vs.** visual editable, nunca los dos juntos), y hay 3 filas distintas
    (electrónica / IDV / visual). **Necesito screenshot**: puede ser que dos labels se lean como lo mismo, o un
    path de prefill que sí lo repite. Barato de arreglar una vez ubicado.
  - Capas: `UI`.

### F · Ficha: circunferencia escrotal — **S (lo más fácil)**

- **#11 — CE: sacar barra verde, mostrar todas con edad, años tras 24 meses**
  - Hoy: `app/app/animal/[id].tsx:2107-2318`. `ScrotalSparkline` (barras de colores, última en verde) +
    `ScrotalSeriesList` (lista de mediciones con edad en meses vía `formatAgeMonthsAR`).
  - Cambiar: **sacar la barra/sparkline**; dejar solo la lista de todas las CE con su edad; **edad en años
    después de los 24 meses** (ajustar `formatAgeMonthsAR` o el call-site).
  - Capas: `UI` (sin migración).
  - ✅ **HECHO** (Fase 1, 2026-06-29, Puerta 2 aprobada).

### G · UX de los wheels (rueda inercial) — **M** (agregada 2026-06-29, hacer después)

- **#16 — Tapear las opciones visibles del wheel, no solo scrollear**
  - Hoy: el `CircunferenciaEscrotalStep.tsx` (rueda inercial de CE) y el wheel de **edad en meses** solo
    cambian de valor **arrastrando**. Si estás parado en 30 y tapeás el "29,5" que se ve arriba/abajo, no pasa
    nada — tenés que arrastrar a mano hasta el valor.
  - Cambiar: que **tapear** una opción visible (arriba o abajo del valor central) anime/seleccione ese valor.
  - Capas: `cliente` · `UI` (touch handling sobre el componente de wheel inercial; ubicar ambos wheels —
    CE en maniobra, y dónde vive el de "edad en meses").

---

## Decisiones de dominio confirmadas (ronda 2026-06-29, con Raf/Facundo)

- **(#8) Meses de parto = meses de servicio + 9** (NO 284 días). Razón: el servicio se anota por **mes**, no
  por día (monta natural). La insem. artificial se piensa aparte más adelante, pero el dato de pajuela es solo
  "de qué pajuela"; la vaca apta ya queda incluida en los meses de servicio igual.
- **(#8) %parición se muestra SOLO en los meses de parto.** Evaluado como productor/vet: es correcto — antes
  de la ventana la parición es estructuralmente 0% (todavía no hubo partos en la campaña), y un 0%/bajísimo
  asusta al dueño que entra desde la ciudad a mirar cómo va el campo. No se reporta una métrica de campaña
  antes de que sus eventos puedan ocurrir.
- **(#8) Leyenda OBLIGATORIA al activarse el mes de parto**: si todavía hay vacas **preñadas que no parieron
  ni abortaron**, mostrar aviso "Todavía hay vacas que no parieron, esto puede afectar el dato" (casing corregido a sentence-case, 2026-07-10). (Mismo patrón
  que el cartel de destete parcial de #10 — denominador incompleto.)
- **(#8/servicio 12 m)**: los campos de servicio continuo 12 m **no hacen tacto ni controlan preñez** → los
  reportes reproductivos no les sirven. No mostrar parición (ni la mayoría de KPIs repro) para esos rodeos.
  Usan la app sobre todo para consultar/cargar animales más fácil. (Caso típico: campo chico, ~30 vacas.)
- **(#1b + aptitud) Modelo de aptitud reproductiva** (corrección importante, yo lo tenía mal): la aptitud
  (`apta`/`no_apta`) es un flag de **toda hembra**, no solo de vaquillonas. La maniobra de aptitud
  (`tacto_vaquillona`) se hace **solo en vaquillonas** porque son las nuevas del rodeo; el resto se asume
  **apta** por default. Reglas:
  - Al iniciar el mes de servicio, todas las **aptas** quedan marcadas **"servidas"** (insumo del denominador
    de parición). El indicador apta/no_apta es lo que decide quién entra.
  - Marcar una hembra **CUT** debe poner el flag en **NO APTA**.
  - Hembras dadas de alta ya grandes (vaquillona 2º servicio, multípara, etc.) → se asumen **aptas**; si no lo
    son, deberían marcarse CUT.
  - La maniobra de **inseminación artificial solo aplica a hembras con flag APTA** (y obviamente **no a
    machos** — el bug que disparó #1b fue que dejó inseminar un toro/torito).
  - Implica un flag persistente de aptitud por `animal_profile` que consultan: la derivación de "servidas"
    (0105, Stream A), la maniobra de inseminación (#1b) y el trigger de CUT. Es un delta backend, no solo un
    filtro de cliente.
- **(#2) Caravana: hay 3 tipos en la UI y debe haber 2** (electrónica + visual). El modelo tiene 3 columnas
  (`tag_electronic` = electrónica; `idv` = visual oficial numerada, única por campo, inmutable; `visual_id_alt`
  = texto libre). **Resolución (Raf 2026-06-29)**: `visual_id_alt` se relabela a **"Nombre / apodo"** pero **NO
  se muestra por default** — pocos campos le ponen nombre, y aun "opcional" molesta a quien nunca lo usa. Se
  **ata a un boolean del rodeo** ("¿usa nombres/apodos?", patrón de `rodeo_data_config`/ADR-021): solo los
  rodeos que opten lo ven, y aun ahí es opcional. → Esto sube #2 de Nivel A a **Nivel B** (toca config de rodeo).
- **(#5) Indicador de estado reproductivo en lista de rodeo + ficha** (re-scope): NO era un bug de la maniobra
  (el tacto ya marca preñada/vacía). El problema es que **no hay ninguna marca de preñez al revisar el rodeo ni
  la ficha** para vaca/multípara — solo se veía vía categoría "vaquillona preñada". Es un dato importante a
  mostrar en **ambos lugares**, para toda hembra. Raf duda de meterlo en la categoría → mejor un **flag/badge
  aparte con color**. **Propuesta del leader**: badge de estado reproductivo (Preñada / Vacía / sin tacto)
  derivado del último tacto, con color propio (no sobrecargar la categoría), en la lista y en la ficha. Display
  puro derivado de eventos existentes → sin migración. **Nivel B** (display delta sobre 02).
- **(#6/aptitud en el alta)** Tras marcar la categoría de una vaquillona de 1er servicio dada de alta,
  **preguntar**: *"¿Esta vaquillona está apta para poner en servicio? SÍ / AÚN NO SÉ (queda pendiente, se valida
  en el tacto de aptitud) / NO ES APTA"* → mapea al enum `apta` / `diferida` / `no_apta`.
- **(#6/servidas en vivo, buen catch)** "Servidas" **no puede ser un batch congelado** del primer día del mes
  de servicio. Debe **recalcularse en vivo**: si una vaquillona `diferida` pasa a `apta` a mitad de mes, o si
  comprás/das de alta hembras `apta` dentro de la ventana, deben contarse como **servidas** igual. La derivación
  actual (0105, Stream A) ya es una **función** (live por naturaleza) → solo hay que **filtrarla por el flag
  `apta`** e incluir las altas/compras dentro de la ventana. La `diferida` NO cuenta como servida hasta ser apta.

## Estado de las preguntas (cerrado al 2026-06-29)

- **(#5) Badge de estado reproductivo** (Preñada / Vacía / sin tacto, color propio, separado de la categoría,
  en lista + ficha) → **APROBADO por Raf**. Se aterriza así en el delta D.
- **(#6) Prompt de aptitud en el alta** (SÍ / AÚN NO SÉ / NO ES APTA) + servidas en vivo → **APROBADO por Raf**.
- **(#7/#10) Peso de destete** → **movido a `docs/backlog.md`** (2026-06-29). Gatea el cierre del segmento A
  (cluster ternero) y la parte de destete del segmento B; se refina con Facundo antes de su Gate 0.

No quedan preguntas de dominio abiertas para empezar; el único pendiente externo (peso de destete) está
parkeado en backlog y no bloquea la Fase 1 ni los segmentos C/D.

---

## Estrategia de documentación SDD para estos fixes (propuesta)

El problema: estos 15 fixes tocan features ya `done`. ¿Reescribir las specs viejas (el `tasks.md` queda raro,
y "no hay que hacer todo de vuelta") o hacer specs nuevas (el `design`/`requirements` original queda viejo)?

**Recomendación — regla de 2 niveles** (formaliza lo que el repo ya hace de hecho + coincide con la práctica
externa de "spec deltas que se mergean a un living spec"):

- **Nivel A — Reconciliación in-place (sin spec nueva).** Para cambios que NO cambian el *qué*, solo corrigen/
  pulen el *cómo*: copy, reordenar un array, sacar un elemento de UI, relabelar. → No se crea spec. Se edita el
  `design.md` baseline + 1 línea de changelog (+ nota bajo el `R<n>` si su wording quedó mintiendo). Igual pasa
  por implementer → reviewer → Gate 2. **Es la regla "Reconciliación al as-built" que ya existe** en
  `docs/specs.md` §128.
  - Acá entran: **#9, #12, #11**.

- **Nivel B — Delta-spec.** Para cambio sustancial o capacidad nueva sobre una feature `done`: set nuevo
  `{context,requirements,design,tasks}-<slug>.md` en la carpeta de la feature. **Exactamente lo que ya hacés**
  (`cut-ficha`, `tier2-categorias`, `puesta-en-servicio`, `09resto-dedup`…). El baseline NO se reescribe.
  Gates según toque (Gate 0 siempre; Gate 1 si RLS/schema/RPC; Gate 2 siempre).
  - Acá entran: **A** (delta-02 cluster ternero), **B** (delta-07 parición/destete), **C** (delta-02/09 caravana
    desde ficha), **D** (delta-02+03 flag de aptitud + gating + #5 badge repro), **#2** (delta-02 nombre/apodo
    por toggle de rodeo), **#3/#13/#14** (un solo delta-02 "alta-form").

**Por qué resuelve tus dos miedos:**
- *"El `tasks.md` queda raro / no hacer todo de vuelta"* → **nunca se toca el `tasks.md` original**. Es el
  ledger histórico de ese incremento (ya tildado, ya revisado por el reviewer). El delta trae su **propio**
  `tasks`. Cero "hacer de vuelta".
- *"El `design`/`requirements` quedan desactualizados"* → se resuelve con la **reconciliación de cierre**: el
  delta es la fuente de verdad del comportamiento nuevo, y al cerrarlo se folda un puntero + nota as-built de
  alto nivel al baseline (no reescritura). El baseline pasa a ser un doc vivo con un **índice de deltas**.

**Una mejora sobre lo que hacés hoy** (el único gap vs. la práctica externa): los deltas se acumulan pero no
siempre se "vuelven a foldear" al baseline → con el tiempo el `design.md` baseline miente por omisión. Fix
barato: un bloque **"Deltas posteriores"** al inicio de cada `design.md` baseline (lista de slugs + 1 línea +
estado), así quien lee el baseline ve el panorama sin cazar archivos sueltos.

**Dónde documentarlo:** agregar una sección a `docs/specs.md` ("SDD sobre features `done`: in-place vs
delta-spec") — es el hogar natural y el patrón ya es de-facto. Como es una regla que se referencia siempre,
conviene además fijarla en un ADR corto (¿ADR-025?). Si te cierra, lo redacto.

> Fuentes externas que validan el enfoque: [Augment Code — SDD & AI Agents](https://www.augmentcode.com/guides/spec-driven-development-ai-agents-explained)
> (spec deltas → living spec, archivar el delta al mergear) · [intent-driven.dev — SDD](https://intent-driven.dev/knowledge/spec-driven-development/)
> (spec versionada como contrato vivo; cada cambio cita o actualiza la spec) · práctica común: fixes chicos =
> spec liviana de un párrafo, SDD completo solo para cambios no triviales.

## Plan de ejecución recomendado (corregir de a 1)

> El ranking de arriba es por **importancia/dificultad**. El **orden de ejecución** que recomiendo difiere a
> propósito por dos razones: (1) los segmentos A y B están **gatados por respuestas de Facundo** (latencia
> externa) — conviene mandarle las preguntas YA; (2) hay **quick wins** de alto valor/esfuerzo que se pueden
> cerrar mientras tanto y dan pulido visible sin riesgo. Una feature a la vez (regla del check).

- **Fase 0 — Mandar las preguntas a Facundo/Raf (hoy).** Sin esto, A/B/D quedan a medias. Es el desbloqueo más barato.

- **Fase 1 — Quick wins UI (sin Facundo, sin DB, Gate 1 N/A).** En 1–2 runs de implementer:
  - #12 dientes (1 array, arregla alta+maniobra) · #9 KPIs→Datos · #11 CE (sacar barra + años) ·
    #13 condición stepper · #3 fecha dd/mm · #14 destildar opcionales.
  - (#2 entra acá apenas mandes el screenshot.)

- **Fase 2 — Segmento B parcial: el bug visible del %parición (#8).** Apenas Facundo confirme la ventana
  de meses de parto. Arreglar el 0% silencioso + el gating de display (solo si hay partos / no en 12 m).

- **Fase 3 — Segmento A: cluster ternero (#4, #15, #1a, #7).** El bloque pesado, SDD completo (Gate 0 →
  spec → Gate 1 → Gate 2). Cierra el modelo de cría. Habilita el numerador de #10.

- **Fase 4 — Segmento B resto: %destete (#10).** Después de A (necesita la captura de destete + peso).

- **Fase 5 — Segmentos C y D.** #6 (caravana desde ficha — parte manual ya; bastoneo cuando haya device) +
  #1b/#5 (gating de maniobra, según respuestas de Facundo). C y F comparten `[id].tsx`, conviene baterlos juntos.

**Por qué este orden y no "el más difícil primero":** A es lo más importante pero está Facundo-gated y es
2–3 sesiones de SDD; arrancar por ahí dejaría 6 fixes de 10 minutos sin shippear y la app sin mejoras
visibles mientras esperás a Facundo. Front-loadear las preguntas + los quick wins maximiza el progreso por día.
