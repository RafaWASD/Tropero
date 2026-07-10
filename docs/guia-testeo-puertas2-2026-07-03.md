# Guía de testeo — Puertas 2 pendientes

> **Creada 2026-07-03 · Actualizada 2026-07-07.** La versión vieja tenía 7 ítems; desde entonces se agregó **bastoneo** en 4 superficies, se **unificaron los combos**, y el **parto caravana-visual** ya se deployó. Esta versión refleja lo que **realmente falta que apruebes** hoy.

Paso a paso para probar cada delta gateado antes de aprobar su Puerta 2. Cada uno tiene: **qué cambió**, **cómo llegar**, **pasos + qué esperar**, **casos borde**, y **decisiones a confirmar**.

---

## ✅ Ya aprobados (no hace falta que hagas nada)

| Delta | Cuándo |
|---|---|
| `#9 KPIs→Datos · #11 circunf. escrotal · #12 dientes` (Fase 1) | Raf, presente |
| `#5 badge repro · #6 prompt aptitud · #1b inseminación` (aptitud-reproductiva) | Raf, presente |
| `#15 cría al pie en el alta` (cria-al-pie-alta) | Raf, 2026-06-30 |
| `#3 fecha DD/MM · #13 stepper condición · #14 destildar` (alta-form-refinamiento) | Raf, 2026-07-05 |
| `#4 rodeo del parto · #1a caravana visual al parto` (parto-rodeo-caravana) | **Raf, 2026-07-07** |
| `parto — caravana visual POR CRÍA` (parto-caravana-visual-por-ternero) | Autorizaste el deploy 2026-07-07 (0121 aplicada + verificada) |
| `#6 caravana desde la ficha (manual + bastoneo)` (caravana-ficha) | **Raf, 2026-07-07 ("ya lo probé")** |

---

## Setup para testear

- **App web**: desde `app/` → `pnpm web` → viewport mobile en el browser. Usa tu cuenta real de Supabase.
- **Web vs. device**: en web táctil hay cosas distintas (tap-through, sheets, la rueda). Para lo táctil fino (**#16 tap-wheel**, sheets) el device/emulador es más fiel; el resto se prueba bien en web.
- **Sobre el BASTONEO (importante)**: el bastón físico (RS420/BLE) **NO** se puede probar en web ni sin el dev build de Android. **PERO** todo el bastoneo **degrada a carga manual** dentro del mismo sheet ("¿Sin bastón? Cargá la caravana a mano"). O sea: **podés testear toda la UX del bastoneo en la app** (que aparezca el botón, que abra el sheet, que el fallback manual cargue el EID) — lo único que queda para el hardware es el escaneo BLE real.
- **Backend deployado**: **#8/#10/#2** (migraciones `0117`/`0118`/`0119`), el **reorder de categorías** (`0120`) y **parto-visual** (`0121`) ya están **aplicados** en el remoto. No tenés que hacer nada — ya está vivo.
- **Commits locales en `main`, NO pusheados** (pusheás cuando quieras).

> Sugerencia de orden: agrupá por pantalla. **Alta** (#2, override, bastoneo-alta, cría-al-pie-bastoneo) → **Ficha** (#6 caravana + bastoneo) → **Parto** (bastoneo por ternero) → **Reportes** (#8, #10) → **Maniobra CE** (#16) → **Combos** (transversal).

---

# PENDIENTES DE APROBAR

## 1. ✅ `caravana-ficha` (#6) — APROBADO (Raf, 2026-07-07, "ya lo probé"). Foldeado al baseline. (Ficha → Identificación: bastonear/cargar la electrónica + cargar la visual, solo lo vacío.)

---

## 2. Bastoneo en el **ALTA** y el **PARTO** — commit `9a1d193`  ·  ⚠️ el lado **PARTO** ya lo probaste (OK); falta mirar el lado **ALTA**

**Qué cambió**: la caravana **electrónica** en el **alta** y en el **parto** ya no es un campo tipeable suelto: es un **botón "Bastonear la caravana"** que abre el mismo sheet (con fallback manual adentro). Simétrico con la ficha y la maniobra.

**Cómo llegar / pasos — ALTA:**
1. Dar de alta un animal → **paso 4** → en vez del campo de caravana electrónica tipeable, un **"Bastonear la caravana"**.
2. Tocá → sheet → "¿Sin bastón?" → cargá el EID a mano → **queda capturado** (aparece read-only con **"Cambiar"** por si te equivocaste).
3. La caravana **visual** sigue como campo tipeable normal (esa no la lee el bastón).

**Cómo llegar / pasos — PARTO:**
1. Ficha de una vaca → **Agregar evento → Parto** → cada **Ternero** tiene su **"Bastonear la caravana (opcional)"**.
2. Con **mellizos**: cada ternero tiene su **propio** botón → cada uno captura una caravana **independiente** (verificado).

**Casos borde:**
- Mistype: tocá **"Cambiar"** en el capturado → re-abre el sheet para corregir (no te obliga a abandonar).
- Ambas caravanas (visual + electrónica) **siempre opcionales**: podés crear el animal/ternero sin ninguna.

---

## 3. Bastoneo en **CRÍA AL PIE** (dentro del alta) — commit `27fc60f`

**Qué cambió**: cuando das de alta una vaca **con cría al pie**, el prompt para vincular al ternero (que busca por caravana) ahora tiene **"Bastonear la caravana del ternero"** → el bastoneo **llena el buscador** y avanza el find-or-create.

**Cómo llegar**: alta de una **vaca** con **"cría al pie"** tildado → aparece el prompt "¿Vincular su cría al pie?".

**Pasos + qué esperar:**
1. En el prompt, tocá **"Bastonear la caravana del ternero"** → sheet → "¿Sin bastón?" → cargá un EID → **"Usar caravana"**.
2. El EID **llena el buscador** y dispara la búsqueda: si el ternero existe → lo ofrece para vincular; si no → ofrece crearlo.
3. El campo de texto EID/IDV sigue disponible como **camino alternativo** (y para buscar por **IDV**, que el bastón no lee).

**Casos borde:**
- Buscar por **IDV** (visual) a mano → sigue funcionando (el bastón es solo para EID).

---

## 4. `override` — imputación consciente de categoría en el alta (año-solo) — commit `ac709d2`

**Qué cambió** (sutil, corrige un pin de más): cuando en el alta cargás **solo el año** de nacimiento (sin día/mes) y elegís una categoría, el sistema imputa una fecha **coherente con esa categoría** (en vez del midpoint fijo 01/07). Así la categoría elegida **no se "fija" de más** y las auto-transiciones (ADR-008) siguen andando.

**Cómo llegar / pasos:**
1. Dar de alta un **torito** con **solo el año** = un año que caiga cerca del borde (ej. el año que lo pondría entre 1 y 2 años). NO cargues día/mes.
2. Creá → abrí la **ficha** → la categoría debe quedar en **"torito"** (lo que elegiste), **no** saltar a "toro".
3. La categoría **no** debe mostrarse como "fijada/override" por el solo hecho de haber cargado el año (antes se fijaba de más).

**Por qué importa**: sin esto, el cron nocturno podía **flipear** la categoría elegida (torito→toro) al recomputar desde el midpoint. Ahora la fecha imputada hace que el cálculo **coincida** con lo elegido → sin flip.

> Es un cambio de lógica difícil de "ver" a ojo — se validó con 122 tests unitarios (invariante: la categoría computada de la fecha imputada == la elegida). El test en la app es el de arriba: que un torito año-solo quede torito y no se fije.

**Decisión a confirmar**: si la categoría elegida es **imposible** para el año (ej. "ternero" con un año de hace 5 años), el sistema cae al midpoint ciego **y sí fija** (override) — porque no hay forma de reconciliar. ¿Ok ese fallback?

---

## 5. `#8 %parición` (fix del 0% + estados) — commit `6adb820` · **backend deployado**

**Qué cambió**: la card **Parición** en Reportes ya **no muestra 0% engañoso**: distingue estados con un mensaje accionable.

**Cómo llegar**: **Reportes** → rodeo → sección **"Reproductivo"** → card **"Parición"**.

**Pasos + qué esperar (según el rodeo):**
1. Rodeo **con servicio + partos, en época** → el **%** (ej. `82,6 %`) + "N paridas / M servidas".
2. Rodeo **sin meses de servicio** → **"Sin meses de servicio configurados"** (NO `0 %`).
3. Rodeo **antes de la época de parto** → **"Todavía no es época de parición"** (NO `0 %`).
4. Rodeo **12 meses** (continuo) → **"No aplica (servicio todo el año)"**.
5. En época, con **preñadas sin parir** → leyenda **"Todavía hay vacas que no parieron, esto puede afectar el dato"**.

> Para ver el **%** real necesitás un rodeo con datos. Si no, verificá que **ya no aparece el 0%** en rodeos sin datos (era el bug). 5 vistas en las capturas que te mandé.

---

## 6. `#10 %destete` (KPI nuevo) — commit `fd5c7e2` · **backend deployado**

**Qué cambió**: card **nueva "Destete"** en Reportes (2ª fila, ancho completo). %destete = terneros destetados / vacas servidas.

**Cómo llegar**: **Reportes** → rodeo → **"Reproductivo"** → debajo de Preñez/Parición, la card **"Destete"**.

**Pasos + qué esperar:**
1. Rodeo con **destetes cargados** → **%** (ej. `87 %`) + "N destetados / M servidas".
2. Rodeo **antes del 1er destete de la campaña** → **"Todavía no empezó el destete"** (NO 0%).
3. Rodeo **sin meses de servicio** → "Sin meses de servicio configurados".
4. Rodeo **12 meses** → "No aplica (servicio todo el año)".
5. Con **crías al pie sin destetar** → **"Todavía hay crías sin destetar, esto puede afectar el dato"**.

> **Imputación por año de servicio**: el %destete de una campaña cuenta las crías **de esa campaña** que se destetaron, sin importar en qué año calendario (lo confirmaste en la charla).

---

## 7. `#2 nombre/apodo` (sacar built-in + apodo por rodeo) — commit `f3080eb` · **backend deployado**

**Qué cambió**: el "Nombre / seña" **ya no se muestra por default** en el alta; ahora es un campo custom **"apodo"** que cada rodeo **habilita si quiere**.

**Cómo llegar / pasos:**
1. **Alta** → paso 4 → confirmá que **NO** aparece "Nombre / seña" por default (quedan las 2 caravanas + año/día-mes/raza/pelaje).
2. **Habilitar el apodo**: **editar la plantilla** del rodeo → debe aparecer **"Nombre / apodo"** para habilitar (ya seedeado en tus campos) → prendelo → guardá.
3. Volvé a **dar de alta** un animal **de ese rodeo** → en **"Datos personalizados"** ahora aparece **"Nombre / apodo"** → cargalo.
4. Abrí la **ficha** → el apodo aparece en **"Datos personalizados"** (con "Editar").

**Casos borde:**
- Rodeo que **NO** habilitó el apodo → el campo **no aparece** en el alta (opt-in por rodeo, el punto).
- Animal viejo con "Nombre/seña" cargado → su valor **sigue viéndose** (no se pierde).

---

## 8. `#16 tap-wheel` (tapear la rueda) — commit `0841ffb`

**Qué cambió**: en la **rueda inercial**, **tapear** una opción visible la selecciona (antes solo arrastrando).

**Cómo llegar**: una maniobra con **circunferencia escrotal** (toros) → el paso de la **rueda de CE** (también la rueda de **edad en meses**).

**Pasos + qué esperar:**
1. Con la rueda en un valor (ej. `36`), **tapeá** una celda **visible** arriba/abajo del centro (ej. el `37`).
2. La rueda **anima suave** y **centra** ese valor → el número grande pasa a `37`.
3. Tapeá un fraccionario visible (ej. `36,5`) → centra `36,5`.
4. Tapear la celda **ya central** → no pasa nada (no-op).
5. **El arrastre sigue funcionando** (probá arrastrar después de tapear).

**Mejor en device/emulador** (el tap táctil es más fiel que en web con mouse).

---

## 9. `combo-eje-central` — unificación visual de los combos (5 superficies) — commits `7dda4aa` · `71625b7` · `35895bf`

**Qué cambió** (lo que reportaste): en los combos/listas donde se elige rodeo o lote, el nombre **seleccionado** se corría a la izquierda porque el tilde ✓ le comía espacio. Ahora **todos los nombres caen sobre el mismo eje central**, esté o no seleccionado. Un componente compartido (`ComboOptionRow`) unifica **5 lugares**.

**Cómo llegar / qué mirar (eyeball, no hay gate formal):**
1. **Rodeo del parto** (Agregar evento → Parto → abrí el picker de rodeo).
2. **Rodeo/lote en el alta** (dar de alta → picker de rodeo con ≥2 rodeos; y el de lote).
3. **Rodeo en cría al pie** (prompt del alta).
4. **Lote en la maniobra** (wizard de maniobra → resumen → "Lote (opcional)" → sheet).
5. **Lote en la ficha** (ficha → sección lote).

**Qué esperar**: en todos, el nombre seleccionado (con ✓ a la derecha) queda **centrado en el mismo eje** que los no seleccionados; ninguno se corre. En el sheet de lote de maniobra y en la ficha, la lista se ve como una **lista contenida** de filas planas, selección **solo por el tilde**.

> Medido con Playwright (`textCenter == rowCenter` en ambos estados). Es un fix visual — si algún combo no te cierra, decime cuál.

---

## Resumen de decisiones a confirmar

| Delta | Decisión (default que tomé) | Confirmás / cambiás |
|---|---|---|
| #6 caravana-ficha | Ficha muestra **solo "Bastonear"**; el manual va dentro del sheet | |
| override | Categoría **imposible** para el año → fallback a midpoint ciego + fija | |
| #2 nombre/apodo | Ests **futuros** NO auto-seedean el apodo (backlog); `category='identificacion'` | |
| #16 tap-wheel | El tap **cancela un fling en curso** y snapea al valor tapeado | |
| combos | Selección marcada **solo por el tilde** (sin resaltado de color/negrita) | |

## Cómo cerrás cada Puerta 2

Por cada delta que pruebes y te cierre: decime **"apruebo &lt;delta&gt;"** (o "cambiá X"). Cuando apruebes, **foldeo el delta al baseline** (ADR-028) y vuelvo la feature a su estado. Si algo no te cierra, lo re-itero con el implementer antes de cerrar.
