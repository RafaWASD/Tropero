# Gate 0 — Contexto: LOTES OPERABLES (venta/descarte en tanda) — delta spec 02

> Refinamiento de contexto (ADR-022) del ítem **A** del triage `docs/correcciones-demo-facundo-padre-2026-07-10.md`.
> Pedido de Facundo + su padre (productor real). **Dirección y decisiones cerradas con Raf (2026-07-10, charla
> una-por-una).** Toca `management_groups` + el flujo de baja → **Gate 1 (schema/RPC) + deploy gateado a Raf.**
> Delta Nivel B (ADR-028).

## 1. Problema / pedido + reframe

**Pedido:** al terminar una maniobra con tacto de preñez, si hay **vacías**, sugerir agregarlas a un **lote de
venta/descarte**; después vender/descartar ese lote **todo junto** (o parte) cuando se quiera. Registrar mejor
las ventas/salidas.

**Reframe clave (charla con Raf):** los **lotes (`management_groups`, ADR-020) no tenían una finalidad real hoy**
— agrupar animales cross-rodeo sin una acción asociada es débil. Raf lo notó y propuso darles utilidad. El leader
coincidió: **casi todos los usos legítimos de "lote" en el campo terminan siendo *operar sobre un grupo en tanda*
(venderlo, descartarlo, registrar su salida por comprador/destino).** → **Se repropone el lote como GRUPO
OPERABLE.** El "lote de venta" no es un tipo especial: es **cualquier lote sobre el que registrás una salida en
tanda.** Esto entrega el pedido **y** le da a los lotes el propósito que les faltaba.

> Nota de modelo (corregido con Raf): **rodeo y lote son independientes**. Un animal está en **un rodeo** +
> opcionalmente **un lote** (membresía única de lote; un lote puede cruzar rodeos). Meter una vaca a un lote de
> venta **no toca su rodeo**. Como los lotes no tenían otro uso, la membresía única no cuesta nada.

## 2. Decisiones cerradas (Gate 0, Raf una-por-una)

| # | Decisión | Resuelto |
|---|---|---|
| **A-1 Estructura** | **Lotes = grupos operables** (no una marca/flag separada). El lote gana la capacidad de vender/descartar/registrar la salida de varios o todos sus animales juntos. "Lote de venta" = un lote que vendés. |
| **A-2 Entrada de las vacías** | Tras el tacto con vacías → sugerencia saltable "Encontramos N vacías, ¿agregarlas a un lote?" → **el usuario ELIGE en el momento** un lote existente **o crea uno nuevo** ahí mismo (con **"Descarte"** sugerido por default). |
| **A-3 La venta/descarte** | Abrís el lote → **tildás todos o un subconjunto** (camión parcial) → registrás la salida **reusando la baja que ya existe** (`exit_animal_profile`: motivo venta/muerte/descarte + fecha; peso/precio opcionales). Los que salen se **archivan y dejan el lote**. |
| **A-4 Datos de la venta** | **Comunes para la tanda, ajustables por animal**: cargás una vez (fecha + precio/kg o total; peso si querés) y aplica a todos; podés ajustar un animal puntual. |
| **A-5 Alcance** | **Auto-sugerencia SOLO para vacías** (tras el tacto). **Manual: cualquier animal** se puede agregar a un lote de venta/descarte desde la ficha/lote (los lotes ya permiten asignar). Viejas/CUT → a mano hoy; **auto-sugerencia para ellas = v2**. |
| **A-6 Nombre** | Los lotes los nombra el usuario (genéricos). La app sugiere **"Descarte"** al crear el lote de venta desde el flujo del tacto. |

## 3. Flujo (mente del productor)

1. **Detección** (fin de jornada con tacto de preñez): la app junta las **vacías** de la sesión → sugiere agregarlas a un lote (elegir existente / crear "Descarte"). Saltable.
2. **Acumulación**: el lote de venta se llena (este tacto + ad-hoc). Se agregan/quitan animales a mano desde la ficha o el lote (cualquier animal, cualquier rodeo).
3. **Venta/descarte en tanda**: abrís el lote → seleccionás todos o algunos → "Vender / Descartar" → un formulario con datos comunes (fecha + precio/peso, ajustable por animal) + motivo → **baja en tanda** (reusa `exit_animal_profile` por animal). Los archivados salen del lote.
4. El lote persiste y se vacía a medida que vendés (o lo borrás si era de un solo evento — a criterio del usuario, son genéricos).

## 4. Impacto técnico (a definir en design/Gate 1)

- **`management_groups`**: probablemente NO necesita columna de "tipo" (cualquier lote es operable). Evaluar si conviene un flag opcional para el "sugerido de descarte" (o solo por nombre).
- **Operación de salida en tanda**: reusa `exit_animal_profile` (0044, ya existe, per-animal). Definir si se hace **loop client-side** (N llamadas, offline-friendly) o un **RPC nuevo de baja en tanda** (atómico) → **decisión de design + Gate 1 si hay RPC nuevo**. El peso/precio comunes-ajustables mapean a `exit_weight`/`exit_price` per-animal (ya existen).
- **Entrada de vacías**: derivar el conjunto "vacías de la sesión" (estado reproductivo `empty` de la jornada) + `assignAnimalToGroup` (ya existe).
- **Multi-tenant / RLS**: el patrón de `management_groups` + `exit_animal_profile` ya está scopeado por establishment.

## 5. Alcance

**Dentro (v1)**: lotes operables (vender/descartar/registrar salida en tanda, subconjunto) + sugerencia de vacías post-tacto (elegir/crear lote) + datos comunes-ajustables + reuso de la baja + los archivados dejan el lote.
**Fuera (v2/post-MVP)**: auto-sugerencia para viejas/CUT/edad; "tipos" de lote rígidos; reportes de ventas agregadas; precio/kg de mercado.

## 6. Gates
- **Gate 1** (si hay RPC nuevo de baja en tanda o cambio de schema en `management_groups`). Deploy gateado a Raf.
- Delta Nivel B (ADR-028): `{context,requirements,design,tasks}-lotes-venta.md`.
- Gate 2.5 (capturas): sugerencia post-tacto · lote con acción vender/descartar · selección de subconjunto · form de venta · post-venta (lote más chico).
