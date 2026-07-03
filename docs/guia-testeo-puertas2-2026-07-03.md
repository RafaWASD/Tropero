# Guía de testeo — 7 Puertas 2 pendientes (2026-07-03)

Paso a paso para probar cada delta gateado antes de aprobar su Puerta 2. Cada uno tiene: **qué cambió**, **cómo llegar**, **pasos + qué esperar**, **casos borde**, y **decisiones a confirmar** (defaults que tomé y querés ratificar o cambiar).

---

## 0. Setup para testear

- **Levantar la app (web)**: desde `app/` → `pnpm web` → abre en el browser a viewport mobile. Es lo más rápido; usa tu cuenta real de Supabase.
- **Ojo web vs. device**: en web táctil hay cosas que se comportan distinto (tap-through, sheets, la rueda). Para lo táctil fino (#16 tap-wheel, sheets) el device o el emulador es más fiel; el resto se prueba bien en web.
- **Cuenta/datos**: logueate, elegí un campo y un rodeo con algunos animales. Para los KPIs de reportes (#8/#10) conviene un rodeo con **estación de servicio configurada** + vacas servidas + algún parto/destete (si no, vas a ver los estados "sin datos"/"todavía no es época", que también hay que verificar).
- **Backend ya deployado**: #8, #10 y #2 tocaron la DB y **ya están aplicados** en el remoto (migraciones 0117/0118/0119). No hace falta que hagas nada — ya está vivo.

> Sugerencia de orden: agrupá por pantalla. **Alta** (#3/#13/#14, #2) → **Ficha** (#6-caravana, #2) → **Parto** (#4/#1a) → **Reportes** (#8, #10) → **Maniobra CE** (#16).

---

## 1. `alta-form-refinamiento` (#3 fecha DD/MM · #13 stepper condición · #14 destildar) — commit `8926e16`

**Qué cambió**: en el **Alta de animal**, paso 4: fecha con día/mes separado del año, condición corporal como stepper +/−, y poder destildar opcionales.

**Cómo llegar**: Dar de alta un animal → completá rodeo/sexo/categoría → **Paso 4 de 4**.

**Pasos + qué esperar (#3 — fecha DD/MM):**
1. Mirá que haya **dos** campos: "Año de nacimiento (opcional, AAAA)" y **"Día y mes (opcional, DD/MM)"** (nuevo).
2. Cargá **solo el año** (ej. `2023`) → creá → el animal queda con fecha **midpoint** (01/07/2023). *(comportamiento viejo, no se rompe.)*
3. Cargá **año + día/mes** (ej. `2023` + `15/03`) → creá → fecha **exacta** 15/03/2023.

**Casos borde (#3) — todos deben dar error inline (borde rojo + scroll al campo), SIN crear:**
- Día/mes **sin año** → error.
- **Solo el día o solo el mes** (incompleto) → error (todo-o-nada).
- Fuera de rango: `31/02`, mes `13`, `00/00`, `31` en un mes de 30 → error, **sin clamp silencioso**.
- `29/02` en año no bisiesto (ej. 2023) → error.
- Fecha **futura** (ej. año que viene) → error.

**Pasos (#13 — stepper de condición):**
1. En una categoría que pida condición corporal, en vez de los 17 chips debés ver un **stepper +/−** con número grande (arranca en `3,00`).
2. Tocá **+** y **−** → cambia de a **0,25** (formato es-AR: `3,25`, `2,75`).

**Pasos (#14 — destildar opcionales):**
1. Tocá un opcional cerrado (ej. preñez, o cría al pie) → **re-tocá la misma opción** → se **deselecciona** (queda "sin cargar").
2. El stepper de condición: si lo tocaste, debe poder **limpiarse** (distingue "lo toqué" de "default 3,00" sin tocar).
3. Vaciá un input de texto → queda "sin cargar" → **no** se manda al crear (no se guarda un valor fantasma).

**Decisión a confirmar**: la **fecha futura se rechaza** (RAF2.1.9, default mío) — ¿ok, o querés permitir cargar una fecha futura?

---

## 2. `caravana-ficha` (#6 manual — agregar caravana desde la ficha) — commit `19f89bd`

**Qué cambió**: en la **ficha** de un animal, sección "Identificación", podés **asignar** la caravana **electrónica** y/o la **visual** cuando están vacías.

**Cómo llegar**: abrí la ficha de un animal **activo** que le falte alguna caravana → sección **"Identificación"**.

**Pasos + qué esperar:**
1. Si al animal le **falta la caravana electrónica** → aparece la acción **"Agregar caravana electrónica"** → tocá → tipeá un EID (15 dígitos) → guardá → queda asignada.
2. Si le **falta la visual (idv)** → aparece **"Agregar caravana visual"** → tocá → cargá el número → guardá.
3. Una caravana **ya seteada** → **solo lectura** (no debe ofrecer editarla ni re-asignarla — inmutabilidad).

**Casos borde:**
- Animal con **ambas** caravanas → la sección no ofrece ninguna acción de asignar (solo muestra los valores).
- **NO** debe haber botón de **bastoneo** (eso es hardware, quedó deferido).
- Offline: la visual (idv) se puede asignar sin señal (se sincroniza después); la electrónica usa el RPC.

---

## 3. `parto-rodeo-caravana` (#4 rodeo al parto · #1a caravana visual al parto) — commit `ce51ab3`

**Qué cambió**: al registrar un **Parto**, elegís el **rodeo del ternero** y (con 1 ternero) su **caravana visual**.

**Cómo llegar**: ficha de una **vaca** → **Agregar evento** → **Parto**.

**Pasos + qué esperar:**
1. Debajo de la fecha, un **"Rodeo del parto"** preseleccionado al **rodeo de la madre**, con la leyenda **"(Mismo rodeo que la madre)"**.
2. Abrí el picker → solo ofrece rodeos del **mismo sistema** del campo → elegí otro → la **leyenda desaparece** (ya no coincide).
3. Con **1 ternero**: debe aparecer el campo **"Caravana visual del ternero (opcional)"**. Cargalo.
4. Tocá **"Agregar otro ternero"** (mellizos) → el campo de caravana visual **desaparece** y aparece la **nota**: "Las caravanas visuales de mellizos se asignan después desde la ficha de cada ternero". *(La caravana **electrónica** sigue por ternero, sin cambios.)*
5. Confirmá → el/los ternero(s) quedan en el **rodeo elegido**; con 1 ternero, la visual cargada aparece en su ficha.

**Casos borde:**
- Un rodeo de **otro sistema** no debe aparecer en el picker.
- Si tipeaste una visual y después agregás un mellizo → la visual **no se manda** (se descarta, por la nota).

**Decisión a confirmar**: la caravana visual va **a nivel parto (arriba)**, la electrónica **dentro de la card de cada ternero** — ¿ok esa asimetría, o preferís la visual dentro de la card del Ternero 1?

---

## 4. `#8 %parición` (fix del 0% + estados) — commit `6adb820` · **backend ya deployado**

**Qué cambió**: la card **Parición** en Reportes ya **no muestra 0% engañoso**: distingue estados con un mensaje accionable.

**Cómo llegar**: **Reportes** → elegí un rodeo → sección **"Reproductivo"** → card **"Parición"**.

**Pasos + qué esperar (según el rodeo que elijas):**
1. Rodeo **con estación de servicio + partos, en época de parto** → muestra el **%** (ej. `82,6 %`) + "N paridas / M servidas".
2. Rodeo **sin meses de servicio configurados** → **"sin meses de servicio configurados"** (NO `0 %`).
3. Rodeo **antes de la época de parto** (servicio reciente, todavía no puede haber partos) → **"todavía no es época de parición"** (NO `0 %`).
4. Rodeo de **servicio 12 meses** (continuo) → **"no aplica (servicio todo el año)"**.
5. Si en época de parto **quedan vacas preñadas sin parir** → además la leyenda **"todavía hay vacas que no parieron, esto puede afectar el dato"**.

> Nota: para ver el **%** real necesitás un rodeo con datos. Si no tenés uno armado, verificá al menos que **ya no aparece el 0%** en los rodeos sin datos (que era el bug). Las 5 vistas están en las capturas que te mandé.

---

## 5. `#10 %destete` (KPI nuevo) — commit `fd5c7e2` · **backend ya deployado**

**Qué cambió**: card **nueva "Destete"** en Reportes (2ª fila, ancho completo). %destete = terneros destetados / vacas servidas.

**Cómo llegar**: **Reportes** → rodeo → sección **"Reproductivo"** → debajo de Preñez/Parición, la card **"Destete"**.

**Pasos + qué esperar:**
1. Rodeo con **destetes cargados** → **%** (ej. `87 %`) + "N destetados / M servidas".
2. Rodeo **antes del 1er destete de la campaña** → **"todavía no empezó el destete"** (NO 0%).
3. Rodeo **sin meses de servicio** → "sin meses de servicio configurados".
4. Rodeo **12 meses** → "no aplica (servicio todo el año)".
5. Con **crías al pie sin destetar** → leyenda **"todavía hay crías sin destetar, esto puede afectar el dato"**.

> Igual que #8: para ver el % necesitás datos; si no, verificá los estados-mensaje + mirá las capturas. **Imputación por año de servicio**: el %destete de una campaña cuenta las crías **de esa campaña** que se destetaron, sin importar en qué año calendario se las destetó (lo confirmaste en la charla).

---

## 6. `#2 nombre/apodo` (sacar built-in + apodo por rodeo) — commit `f3080eb` · **backend ya deployado**

**Qué cambió**: el "Nombre / seña" **ya no se muestra por default** en el alta; ahora es un campo custom **"apodo"** que cada rodeo **habilita si quiere**.

**Cómo llegar / pasos:**
1. **Alta de un animal** → paso 4 → confirmá que **NO** aparece el campo "Nombre / seña" por default (quedan las 2 caravanas + año/día-mes/raza/pelaje).
2. **Habilitar el apodo en un rodeo**: andá a **editar la plantilla** del rodeo (donde se prenden/apagan los datos del rodeo) → debe aparecer **"Nombre / apodo"** en la lista para habilitar (ya está seedeado en tus campos) → prendelo → guardá.
3. Volvé a **dar de alta** un animal **de ese rodeo** → en **"Datos personalizados"** ahora aparece el campo **"Nombre / apodo"** → cargalo.
4. Abrí la **ficha** de ese animal → el apodo aparece en **"Datos personalizados"** (con "Editar").

**Casos borde:**
- En un rodeo que **NO** habilitó el apodo → el campo **no aparece** en el alta (opt-in por rodeo, que era el punto).
- Un animal viejo que ya tenía "Nombre/seña" cargado → su valor **sigue viéndose** en la ficha (no se pierde).

> Nota: los establecimientos **nuevos** (2º+ campo) todavía no traen el "apodo" pre-cargado — hay que crearlo a mano (quedó en backlog el auto-seed seguro). Para tu campo actual, ya está.

---

## 7. `#16 tap-wheel` (tapear la rueda) — commit `0841ffb`

**Qué cambió**: en la **rueda inercial**, **tapear** una opción visible la selecciona (antes solo arrastrando).

**Cómo llegar**: una maniobra con **circunferencia escrotal** (toros) → el paso de la **rueda de CE**. (También aplica a la rueda de **edad en meses** del mismo paso.)

**Pasos + qué esperar:**
1. Con la rueda parada en un valor (ej. `36`), **tapeá** una celda **visible arriba o abajo** del centro (ej. el `37` que se ve dos abajo).
2. La rueda debe **animar suave** y **centrar** ese valor → el número grande arriba pasa a `37`.
3. Tapeá un fraccionario visible (ej. `36,5`) → centra `36,5`.
4. Tapear la celda **ya central** → no pasa nada (no-op).
5. **El arrastre sigue funcionando igual** (probá arrastrar después de tapear — no debe quedar raro).

**Mejor en device/emulador** (el tap táctil es más fiel que en web con mouse).

---

## Resumen de decisiones a confirmar (las junté acá)

| Delta | Decisión que tomé (default) | Confirmás o cambiás |
|---|---|---|
| #3 alta-form | Fecha **futura** rechazada en el alta | |
| #4/#1a parto | Caravana **visual a nivel parto**; electrónica en la card del ternero | |
| #2 nombre/apodo | Ests **futuros** NO auto-seedean el apodo (backlog); `category='identificacion'` | |
| #16 tap-wheel | El tap **cancela un fling en curso** y snapea al valor tapeado | |

## Cómo cerrás cada Puerta 2

Por cada delta que pruebes y te cierre: decime **"apruebo <delta>"** (o "cambiá X"). Cuando apruebes, yo **foldeo el delta al baseline** (ADR-028) y vuelvo la feature a su estado. Si algo no te cierra, lo re-itero con el implementer antes de cerrar.
