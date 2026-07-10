# Triage — Demo con Facundo + su padre (posible usuario final real) — 2026-07-10

> Segunda ronda de feedback en vivo (la primera fue `correcciones-prueba-en-vivo-2026-06-27.md`). El padre de
> Facundo es un **productor real** = posible usuario final; encontró varias cosas a mejorar. El leader hizo el
> triage y grounding del código (4 exploradores read-only). Convención de cierre: cada ítem se corrige como
> **delta-spec** (ADR-028), Nivel A/B según toque backend. Los 2 pesados (A lotes de venta, E tratamientos)
> pasan por **Gate 0** antes de spec.

Severidad: 🔴 correctitud / 🟡 UX-visible / 🟢 mejora. Los file:line vienen de la exploración.

---

## Índice

| # | Ítem | Tipo | Severidad | Backend? | Estado |
|---|---|---|---|---|---|
| **B** | Gating tacto preñez vs aptitud (ternera pasa por ambos) | Bug | 🔴 | No (frontend) | listo para spec |
| **F** | Recorte del "%" en KPI cards (anchos angostos) | Bug | 🟡 | No (frontend) | listo para spec |
| **C** | Botón SKIP en maniobra (saltear un animal) | Feature chica | 🟢 | No (frontend) | listo para spec |
| **D1** | Vacunas: dejar continuar sin aplicar ninguna | Bug | 🔴 | No (frontend) | listo para spec |
| **D2** | Vacunas: rediseño APLICA/NO-APLICA + endurecer pre-maniobra | Feature/UX | 🟡 | No (frontend) | Gate 0 liviano |
| **A** | Lotes de venta/descarte (cola de descarte + venta en tanda) | Feature grande | 🟡 | **Sí** (Gate 1) | **Gate 0** |
| **E** | Tratamientos en la ficha (iniciar/aplicar/finalizar + pin) | Feature grande | 🟡 | **Sí** (Gate 1) | **Gate 0** |

**Orden sugerido:** primero los 4 quick fixes (B, F, C, D1) — son correctitud/UX que pegó un usuario real, bajo esfuerzo. Después D2 (rediseño de vacunas). Los 2 grandes (A, E) van por Gate 0 → spec en paralelo/después.

---

## B — 🔴 Gating de tacto: preñez vs aptitud sobre el animal equivocado

**Síntoma (Facundo):** en una maniobra con *tacto de preñez* Y *tacto de aptitud reproductiva*, al ingresar una **ternera** pasa por AMBOS tactos. Mal.

**Reglas de dominio correctas:**
- **Tacto de preñez** → SOLO **hembras servidas**. Servida = fue apta primero + estuvo servida en los meses de servicio del rodeo **o** fue inseminada (IA).
- **Tacto de aptitud** → SOLO **vaquillonas que aún NO son aptas**.
- **Ternera** → **ninguno** de los dos.

**Causa raíz:** `app/src/utils/maneuver-applicability.ts:122-125` — ambos tactos devuelven solo `animal.sex === 'female'`, sin distinguir servida vs vaquillona-no-apta:
```ts
case 'tacto':
case 'tacto_vaquillona':
  return animal.sex === 'female';   // ← no distingue estado repro
```
El gating por rodeo (`maneuver-gating.ts:69-87`) está bien; el hueco es la capa por-animal. Los datos ya existen en `AnimalDetail` (`reproStatus`, `reproAptitude`) y se pasan a `toApplicabilityInfo` (`carga.tsx:1088-1098`) pero **no se usan** para los tactos. Referencia de gating correcto: la inseminación (`maneuver-applicability.ts:126-137`) sí filtra por hembra+apta.

**⚠ Tests falsos:** `maneuver-applicability.test.ts:85-107` codifican el comportamiento MALO (verde-falso) → hay que corregirlos como parte del fix.

**Propuesta (frontend puro, Nivel A):** enriquecer `AnimalApplicabilityInfo` con `reproStatus` y separar el switch:
- `tacto` (preñez): `female` AND (`categoryCode ∈ PROVEN_FEMALE_CATEGORY_CODES` OR `reproStatus.kind ∈ {served_untested, pregnant, empty}`).
- `tacto_vaquillona` (aptitud): `female` AND `categoryCode === 'vaquillona'` AND `reproAptitude !== 'apta'` (o sin veredicto).
Fuente única de la regla en `repro-status.ts` (ya tiene `PROVEN_FEMALE_CATEGORY_CODES`, `deriveCurrentState`). Sin backend (Gate 1 N/A).

**Duda a validar con Facundo:** ¿una vaquillona **ya apta** pero **aún no servida** debería poder tactarse de preñez? Por la regla "preñez solo servidas" → NO hasta que haya servicio. Confirmar el borde apta-pero-sin-servicio.

---

## F — 🟡 Recorte del "%" en las KPI cards

**Síntoma (Raf, devtools con anchos chicos):** el número con coma (ej. "89,1 %") no entra y sale `...`.

**Causa raíz:** `app/src/components/reports/KpiCard.tsx:58` `numberOfLines={1}` + `:40` `minWidth={0}` + `adjustsFontSizeToFit` **no-op en react-native-web** (memoria `reference_rn_web_pitfalls`) → en vez de encoger, **trunca con ellipsis**. El token de tamaño (`kpiValueFontToken`, `reports-format.ts:273`) elige `$9`/`$10` por cantidad de chars pero **no mira el ancho real** del dispositivo. Layout: 2 cards por fila (`reportes.tsx:379-395`, `XStack gap="$3" flex=1`); a ≤360px útiles cada card queda ~111px de texto y "89,1 %" no entra a `$9`.

**Opciones de fix (elegir en spec):**
- **(rec) permitir 2ª línea** para el valor (`numberOfLines={2}` o quitarlo) → "89,1" / "%" quiebra en anchos chicos. Bajo riesgo; leve pérdida de jerarquía.
- bucket de fuente más chico (`$8`) para 7+ chars.
- reducir `gap`/`padding` para ganar ancho.
- medir el ancho en runtime y bajar decimal ("89 %") — la más "perfecta" pero cara.

Frontend puro, Nivel A. **Ojo:** el "%" ya viene pegado al número en el string formateado (`formatPercentAR`), come ancho — considerar separarlo.

---

## C — 🟢 Botón SKIP en la carga rápida de maniobra

**Pedido (Facundo):** un botón en una esquina para **saltear** un animal (no cargar ninguna maniobra) y seguir.

**Estado actual:** la secuencia por animal se arma en `carga.tsx:424-429` (`buildSequence`). No hay un "saltear todo el animal" hoy.

**Propuesta (frontend, Nivel A):** afordancia "Saltear" (esquina del header de la carga rápida) que cierra la secuencia del animal sin persistir eventos y vuelve al identify-first para el próximo. Confirmar micro-copy y si pide confirmación (para no saltear por accidente en la manga). Se coordina con D1/D2 (el "no aplica" de vacunas es distinto de "saltear el animal entero").

---

## D — Vacunas en maniobra (D1 bug + D2 rediseño)

### D1 — 🔴 Dejar continuar sin aplicar ninguna vacuna
**Síntoma (Facundo):** si por X motivo la vacuna no aplica a un animal y tocás la cruz para quitarla, **no te deja continuar** sin aplicar al menos una (bloquea el botón).

**Causa raíz:** `app/app/maniobra/_components/SilentVaccinationStep.tsx:94` `const canApply = items.length > 0 || trimmed.length > 0;` + `:224` `disabled={!canApply}`. Si quitás todas las pre-cargadas y no tipeás → botón bloqueado. El comentario lo justifica (evitar un "Aplicada" que no persiste filas), pero el productor necesita **poder no vacunar** a un animal puntual.

### D2 — 🟡 Rediseño: definir vacunas SOLO pre-maniobra + APLICA/NO-APLICA por animal
**Pedido (Facundo):** las vacunas se definen **antes** de la maniobra (pantalla de seleccionar/reordenar). Dentro de cada animal NO se cargan vacunas nuevas: por cada vacuna definida elegís **APLICA / NO APLICA**.

**Estado actual:**
- Pre-maniobra: `jornada.tsx:519-536` el continue solo exige ≥1 **maniobra** elegida — **no** valida que vacunación tenga ≥1 vacuna. El sheet de preconfig (`ManeuverConfigSheet.tsx:342`) guarda con "Guardar" **siempre habilitado**, incluso con 0 vacunas.
- Por animal: `SilentVaccinationStep.tsx` permite **agregar/quitar** vacunas (chips + input libre).

**Propuesta (frontend, Nivel A — probablemente el rediseño más grande de este batch):**
1. **Pre-maniobra (endurecer, `jornada.tsx` + `ManeuverConfigSheet.tsx`):** si "Vacunación" está elegida, exigir **≥1 vacuna definida** para poder continuar (bloquear el continue de etapa 2) + **marca visual de alto contraste** en la fila de la maniobra ("faltan vacunas" — color/badge distinto) señalando qué maniobra y dónde completar.
2. **Por animal (`SilentVaccinationStep.tsx`):** reemplazar chips+input por un **checklist grande** de las vacunas definidas en la maniobra, **todas tildadas (APLICA) por default**; tap para **destildar (NO APLICA)**. Continue **siempre habilitado** (todas destildadas = no aplica ninguna, y así se resuelve D1). Solo escribe `sanitary_events` de las tildadas.
   - Esto matchea tu idea ("listado en grande, todas tildadas, destildar/tildar") y es el patrón correcto de manga (botones grandes, una mirada, sin teclado).

**Duda:** ¿mantener alguna vía para "agregar una vacuna que faltó definir" sin volver a empezar la jornada? Propongo NO (endurecimiento pedido); si falta una vacuna, se corrige en la config pre-maniobra. Confirmar.

---

## A — Lotes de venta/descarte — **Gate 0 (necesita tu decisión)**

**Pedido (Facundo/productor):** al terminar una maniobra con tacto de preñez, **si hay vacías**, sugerir agregar todos los ejemplares vacíos a un **lote de venta/descarte**; después ese lote se vende/descarta **todo junto** cuando quieras. **Solo vacías por ahora** (sin dientes/CUT = futuro).

### Hallazgo estructural que condiciona el diseño
- Los lotes de hoy (`management_groups`, 0037) son **membresía única** (`animal_profiles.management_group_id` = una sola columna, no array) y **genéricos** (sin "tipo"/propósito).
- → Si el lote de venta fuera un `management_group` más, meter una vacía al lote de venta la **saca de su lote de manejo** (potrero/rotación). Perdés el dato "está en el potrero X **Y** marcada para venta".

### Mi recomendación: **cola de descarte ORTOGONAL, no un lote de manejo**
- **Modelo:** un estado en `animal_profiles` tipo `cull_pending_at timestamptz` (+ `cull_reason`: `vacia` | `manual` | futuro `dientes`/`edad`), NULL = no está en cola. Ortogonal al `management_group_id` (la vaca conserva su potrero). Espeja el patrón de `is_cut`/exit.
- **La "lista de venta/descarte" es virtual** = todos los animales del campo con `cull_pending_at` no nulo. Se muestra como si fuera un lote especial en la UI, pero por debajo es el flag (evita el conflicto de membresía única).
- **NO se conflaciona con CUT** (`is_cut` = descarte por dientes/estructura, con efecto de categoría). Una vacía sana no es CUT. La cola de descarte tiene `cull_reason` de primera clase, y CUT/edad podrían **alimentar la misma cola** más adelante (por eso el `reason`).

### Ciclo de vida propuesto (mente del productor)
1. **Sugerencia post-tacto:** al cerrar una jornada con tacto de preñez, si hay N vacías → en el resumen: *"Encontramos N vacías. ¿Agregarlas a la lista de venta/descarte?"* (saltable). Confirmar → setea `cull_pending_at` a esas N.
2. **La cola persiste y se acumula** (tacto de otoño + ad-hoc). Se puede agregar/quitar manual desde la ficha ("Marcar para venta/descarte" / "Quitar de la lista").
3. **Vender/descartar en tanda:** abrís la lista → seleccionás todo o un subconjunto (una venta puede ser parcial, medio camión) → **"Vender/descartar"** → aplica el **flujo de baja que YA existe** (`exit_animal_profile`, motivos venta/muerte/descarte + fecha/peso/precio de C3.3) en tanda → los animales se archivan y **salen de la cola** solos.
4. **Una sola cola por campo que se vacía** (no un lote nuevo por cada tacto — evita decenas de lotes chiquitos/año). Frecuencia real: ~1-2 tactos/año + ad-hoc → una cola evolutiva es el modelo correcto.

### Decisiones abiertas para vos (Gate 0)
1. **Estructura:** ¿cola ortogonal (flag, conserva potrero — **recomendado**) vs. lote de venta real (membresía única, pierde potrero)?
2. **Alcance:** una cola por **campo** (recomendado — la venta es decisión de campo) vs. por rodeo.
3. **Venta:** ¿reusar el flujo de baja existente (venta/muerte/descarte con fecha/peso/precio) en tanda? (recomendado). ¿Permitir vender un **subconjunto** de la cola? (recomendado — camión parcial).
4. **Nombre:** "Descarte", "Para vender", "Venta/Descarte"?
5. Confirmar: **solo vacías** por ahora; CUT/edad quedan como `reason` futuro sobre la misma cola.

**Backend:** columna nueva + posible RPC de baja en tanda → **Gate 1**. Delta Nivel B.

---

## E — Tratamientos en la ficha del animal — **Gate 0 (necesita tu decisión)**

**Pedido (Facundo/productor):** función de **TRATAMIENTOS** en la ficha: **iniciar** tratamiento (qué antibiótico/antiparasitario + comentario) / **marcar cada aplicación** / **finalizar**. El animal en tratamiento queda con una **marca de color** y **arriba de todo** en la lista del rodeo y la general (prioridad); al finalizar se desmarca y sale de prioridad. Caso de uso: muy común en terneros diarreicos que el peón trata varios días. El productor quiere vigilar **QUÉ, CUÁNTO, CADA CUÁNTO y A QUÉ ANIMAL** se aplica — control del peón.

### Hallazgo estructural
- Ya existe `sanitary_events` (0027) con tipos `treatment` (antibiótico) / `deworming` (antiparasitario), `product_name`, `active_ingredient`, `dose_ml`, `route`, `event_date`, **`next_dose_date`**, `result`, `adverse_reaction`.
- Pero son **eventos puntuales SIN estado**: no hay "tratamiento en curso" (inicio→N aplicaciones→fin) ni flag "en tratamiento" en `animal_profiles`.
- Las listas ordenan por `created_at DESC` (`local-reads.ts:723`), **sin pin ni marca** hoy.

### Mi recomendación: capa de **estado de tratamiento** sobre el evento que ya existe
- **Tabla nueva `treatments` (header):** `animal_profile_id`, `kind` (antibiotico|antiparasitario|otro), `product_name`, `notes` (comentario), `started_at`, `ended_at` (NULL = **en curso**), `created_by`, `deleted_at`.
- **Aplicaciones = `sanitary_events`** (reusa el tipo `treatment`/`deworming`, ya tiene dosis/vía/fecha/próxima dosis) **linkeadas** por un `treatment_id` FK nuevo → cada aplicación es una fila, el header agrupa.
- **"En tratamiento" = existe un `treatment` con `ended_at IS NULL`** (derivado, sin flag redundante) → marca de color en ficha + lista + **pin arriba** (nuevo `ORDER BY` que pone los en-tratamiento primero).
- **Flujo:** *Iniciar tratamiento* (kind + producto + comentario, opcional 1ª aplicación) → *Registrar aplicación* (cada día que el peón aplica) → *Finalizar* (setea `ended_at`) → desmarca + despinnea.
- **Vigilancia:** la ficha muestra el timeline del tratamiento (qué/cuánto/cada cuánto); la lista muestra los en-tratamiento arriba con la marca.

### Decisiones abiertas para vos (Gate 0)
1. **Estructura:** ¿tabla `treatments` header + aplicaciones linkeadas (recomendado, soporta inicio/fin) vs. algo más liviano (solo flag + filtrar `sanitary_events`)?
2. **Quién puede** iniciar/aplicar/finalizar: ¿cualquier rol del campo (incluido el peón, que es quien aplica)? (recomendado).
3. **Marca:** color del pin/badge (¿rojo/naranja? — coordinar con tokens); pin arriba en **ambas** listas (rodeo + general). Confirmar.
4. **Alcance de tipos:** antibiótico + antiparasitario + "otro" con comentario? (recomendado).
5. ¿La marca/pin también dispara algo en reportes (ej. "N animales en tratamiento")? (posible, post-MVP).

**Backend:** tabla nueva + FK en `sanitary_events` + cambio de orden de listas → **Gate 1**. Delta Nivel B (el más grande del batch).

---

## Notas de proceso
- B/C/D1/F: frontend puro → Gate 1 N/A; van directo a spec/implementación tras tu OK.
- D2: rediseño de UX → Gate 0 liviano (confirmar el patrón checklist) + spec.
- A/E: **Gate 0 con vos** (decisiones de arriba) → Gate 1 (tocan schema) → spec → implementación.
- Todos con Gate 2.5 (capturas) por ser UI.
