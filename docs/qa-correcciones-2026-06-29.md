# QA manual — correcciones del testeo en vivo (cerradas al 2026-06-29)

> Checklist para probar en la app las 6 correcciones cerradas (4 deltas + Fase 1). Cada flujo tiene su **E2E
> automatizado** (no corrido en vivo aún por la red a Supabase inestable; lo corre el leader). Esta lista es
> sobre todo para el **"feel" visual** y confirmar los defaults que tomó el leader en modo autónomo.
> Leyenda: ⬜ por probar · ✅ ok · ❌ algo mal (anotá qué).

---

## A. Reportes — #9 "KPIs" → "Datos"

- ⬜ Tab **Reportes** → mientras calcula, el spinner dice **"Calculando los datos…"** (no "KPIs").
- ⬜ En un rodeo **sin meses de servicio** configurados → el cartel dice "…ni los **datos** reproductivos" (no "KPIs").
- ⬜ **Esperado**: la palabra "KPIs" NO aparece en ningún texto visible de Reportes.

## B. Ficha — #11 circunferencia escrotal

> Necesitás un **macho entero** (torito/toro NO castrado) con ≥1 medición de circunferencia escrotal (cargada en una maniobra de CE).

- ⬜ Ficha del toro → sección **"Circunferencia escrotal"**: **NO hay barra/gráfico verde** (sparkline) — solo la **lista** de mediciones.
- ⬜ Cada medición muestra: cm + **edad** + fecha. Edad **< 24 meses** → "18 meses"; **≥ 24 meses** → "2 años 6 meses".
- ⬜ En el **historial/timeline** de la ficha, el evento de CE muestra la edad en **años** igual que la lista (consistente).

## C. Alta + Maniobra — #12 orden de dientes

- ⬜ **Alta** de un animal con dientes (vaca 2º servicio / multípara / toro) → selector de dientes en orden:
  **sin dientes · 1/4 · 1/2 · 3/4 · boca llena · 6 dientes · 4 dientes · 2 dientes**.
- ⬜ **Maniobra** de dientes → **mismo orden**.

---

## D. Aptitud reproductiva — #6 prompt en el alta · #5 badge · #1b inseminación

### #6 — Prompt de aptitud en el alta de vaquillona
- ⬜ Alta de **hembra → categoría Vaquillona** → en el paso de datos aparece **"¿Apta para servicio?"** con
  **Sí, apta / Aún no sé / No es apta** (opcional).
- ⬜ El prompt **NO aparece** para otras categorías (vaca, multípara, ternera) ni para machos.

### #5 — Badge de estado reproductivo (lista + ficha)
- ⬜ **Lista de animales**: cada **hembra** muestra **un solo** chip de estado:
  - Vaquillona pre-servicio → **Apta** (verde) / **Diferida** (ámbar) / **No apta** (gris).
  - Servida/diagnosticada → **Preñada** (verde) / **Vacía** (ámbar) / **Servida sin tacto** (gris).
  - **Macho / ternera** → sin chip.
- ⬜ Alta vaquillona **"Sí, apta"** → en la lista chip **"Apta"**; **"Aún no sé"** → **"Diferida"**.
- ⬜ Una hembra marcada **CUT** → chip **"No apta"**.
- ⬜ **Ficha** de una hembra → desglose: fila **"Aptitud reproductiva"** + fila **"Estado reproductivo"**.
- ⬜ 👁 **MIRÁ ESTO** (lo dejé flagueado): en pantalla angosta, una **multípara** con **"Servida sin tacto"** + nombre
  de rodeo largo → el **rodeo se recorta** (los chips quedan completos). Decime si te molesta.

### #1b — Inseminación solo a hembra apta
> En una jornada de maniobra que incluya **inseminación**, sobre distintos animales:
- ⬜ **Macho** (toro/torito) → la inseminación **NO** se le ofrece/aplica (era el bug: antes dejaba).
- ⬜ Vaquillona **No apta / Diferida** → no se ofrece.
- ⬜ Vaquillona **Apta** o vaca **probada** (multípara / 2º servicio) → **sí** se ofrece.
- ⬜ Vaquillona **≥ 365 días sin tacto de aptitud** (vieja/importada) → **sí** se ofrece (fallback de edad, tu decisión).

---

## E. Alta de animal — #3 fecha dd/mm · #13 condición stepper · #14 destildar

### #3 — Fecha de nacimiento DD/MM opcional
- ⬜ En el alta, **Año** + un campo nuevo **"Día / Mes (DD/MM)"** opcional.
- ⬜ Solo **año** → se guarda como mitad de año (igual que antes).
- ⬜ Año + **DD/MM** → fecha exacta.
- ⬜ DD/MM **sin año** → error inline (no hay fecha sin año).
- ⬜ DD/MM inválido (**31/02**, 00/00) → error inline, no guarda. **29/02 año no bisiesto** → error. **Fecha futura** → error.
- ⬜ El error **pinta el campo en rojo + scrollea** al campo.

### #13 — Condición corporal stepper
- ⬜ En el alta (vaca 2º / multípara / toro / vaquillona preñada) → la condición es un **stepper +/−** (como en la
  maniobra), **no** los chips viejos.
- ⬜ Arranca en **3,00 atenuado** ("sin cargar"); el primer **+/−** lo marca cargado; hay **"Sin cargar"** para limpiar.
- ⬜ **Regresión**: la **maniobra** de condición corporal sigue **igual** (no se rompió).

### #14 — Destildar opcionales
- ⬜ Datos opcionales (dientes / preñez / cría al pie / aptitud) → **re-tocar** la opción elegida la **deselecciona** (vuelve a sin cargar).
- ⬜ Condición corporal → **"Sin cargar"** la limpia.
- ⬜ **Requeridos** (rodeo, categoría) → **NO** se deseleccionan al re-tocar.
- ⬜ Un dato deseleccionado/sin cargar **no se guarda**.

---

## F. Ficha — #6 (manual) agregar caravana

> Necesitás un animal **activo** sin caravana electrónica y/o sin caravana visual (idv).

- ⬜ Ficha → sección **"Identificación"** → animal sin electrónica: **"Agregar caravana electrónica"** → tipear
  **15 dígitos** → Confirmar. Menos de 15 → error inline. Caravana ya usada en otro animal → "ya está asignada a otro animal".
- ⬜ Animal sin visual (idv): **"Agregar caravana visual"** → tipear → Confirmar (anda **offline**).
- ⬜ Un identificador **ya seteado** → solo lectura (no se edita — inmutable).
- ⬜ **NO** hay botón "Detectar bastoneo" (deferido al hardware).
- ⬜ (Multi-tenant) Si mirás la ficha de un animal del campo A con el campo B activo y asignás → se asigna al animal correcto (del campo A).

---

## Defaults del leader a confirmar (modo autónomo — equivalen a las 2 Puertas 2 post-hoc)
- **alta-form**: fecha futura rechazada · stepper compartido con la maniobra · "3,00 atenuado" = sin cargar · scroll-al-campo también en año/peso.
- **caravana-ficha**: afordancia inline (no sheet) · el TAG no refresca al instante (se ve al sincronizar) · el idv sí (es local).
