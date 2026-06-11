# Context v2 — Re-Gate-0 del chunk de masivas: selección explícita + futuro torito + castrado reversible

> **APROBADO por Raf (2026-06-11)** — refinado eje por eje en chat (2026-06-10/11).
> Reemplaza parcialmente el modelo "todo + filtro" del context.md original para castración y
> destete. Surge de: (a) charla Raf+Facundo (la masiva "castrar todos" asusta; en la práctica se
> eligen los animales; ya de terneros se marca cuáles serán los toritos), y (b) el análisis de
> staleness de spec 10 vs Tier 2 as-built (2026-06-10).

## Decisiones LOCKEADAS

### Modelo de operación
- **D1 — Castrar y Destetar pasan a SELECCIÓN EXPLÍCITA**: botón "Castrar"/"Destetar" (verbo
  pelado, sin "todos") → pantalla de selección con checkbox por animal. **Vacunación NO cambia**:
  mantiene "todo el grupo + filtro + preview + skip-report" del Gate 0 original.
- **D3 — Alcance castración: TODOS los machos no castrados** (terneros + adultos), defaults
  protegen (solo terneros comunes pre-tildados). Cubre el caso raro (toro de descarte) sin riesgo.
- **D4 — Destete: pre-tildar TODOS los terneros/as (ambos sexos)**. Al aplicar, la categoría
  transiciona sola al crear el `weaning` (as-built Tier 2 0062/0063, cerrado con Facundo:
  ternera→vaquillona, ternero→torito/novillito). El ⭐ NO avisa en destete.

### Flag "futuro torito"
- **D2** — `animal_profiles` (decisión de manejo del campo, NO viaja en venta/transferencia),
  solo machos. Se marca **solo desde la ficha** (toggle, MVP; no en el alta). Badge visible
  **solo cuando positivo** (ficha + fila). **Auto-clear al castrarlo**. Badge **se oculta cuando
  la categoría ya es toro**.

### Pantalla de selección (iterada eje por eje, mockups en el historial del chat 2026-06-10/11)
- **D6 (eje 1) — Secciones por categoría**: Terneros arriba (pre-tildados; ⭐ adentro sin tildar)
  / Adultos abajo (sin tildar). "Todos/ninguno" POR sección + contador vivo en header.
- **D7 (eje 2) — Warning ⭐ SIN modal**: al tildar un futuro torito la fila queda resaltada
  (terracota) y el resumen final agrupa "⚠ N futuros toritos incluidos". Una sola confirmación.
- **D8 (eje 3) — CTA fijo abajo con número en vivo**: "CASTRAR 12 ANIMALES" (patrón Apple
  Wallet); deshabilitado con 0.
- **D9 (eje 4) — Confirmación = bottom-sheet** sobre la misma pantalla: desglose por categoría +
  ⚠ futuros toritos + CONFIRMAR/Volver. **Copy de reversibilidad** ("Podés corregirlo después
  desde la ficha de cada animal") — NUNCA "no se puede deshacer" (decisión de Raf: el copy
  amenazante asusta, exactamente lo que se quiere evitar).
- **D11 (eje 5) — Fila = AnimalRow compacto** (glifo sexo + ID hero + categoría · edad + ⭐) con
  checkbox, fila entera tappeable ≥56px; orden por ID dentro de sección; **búsqueda arriba solo
  si la lista supera ~20** (mismo patrón que Mis campos >8).

### Castrado reversible (individual)
- **D10 — Castrado = ESTADO editable en la ficha, NO evento**: fila "Castrado Sí/No" con
  confirmación ("la categoría se recalcula: Novillito → Torito"). La historia queda implícita en
  el timeline vía `category_history` (ya es un origen de la cronología) — sin evento CASTRAR,
  sin "descastrar", sin ruido. Una sola fuente de verdad (`is_castrated`). La corrección de una
  masiva equivocada = animal por animal desde la ficha (sin undo masivo, consistente con el Gate 0
  original "cada evento individualmente corregible" y spec 03 D2 "sin reversión de jornada").

## Implicancias técnicas (para la spec, post-aprobación)

- **Ya NO hace falta** (simplificación por D10): seed del data_key `castracion`, rama de gating en
  `tg_sanitary_events_gating`, evento sanitario marker. La masiva = UPDATE `is_castrated` por
  animal seleccionado; el trigger 0064 transiciona.
- **Delta backend (Gate 1 obligatorio)**:
  1. `animal_profiles.future_bull` (boolean default false, solo machos — CHECK o trigger).
  2. **Denormalizar `is_castrated` a `animal_profiles`** (estilo 0079; hoy `animals` está fuera
     del sync set → cierra el finding F1 de la spec C6: el espejo de categorías lo usa exacto en
     vez de inferirlo del code).
  3. **Recompute simétrico**: 0064 dispara en `false→true`; el revert (`true→false`) también debe
     recalcular categoría (novillito→torito) — verificar/extender el trigger.
  4. La masiva offline: N UPDATEs encolados (PowerSync CRUD plano), patrón ya validado.
- **Reconciliación del RESTO de spec 10** en la misma pasada del spec_author: vacunación (sin
  cambios de modelo), vista de grupo/Inicio rodeo-céntrico, destete (texto "no transiciona" →
  as-built transiciona solo), Puerta 1 contradictoria → se RESETEA y se re-aprueba la spec entera
  reconciliada.
