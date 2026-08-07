# QA intensivo de maniobras en device — bitácora

**Pedido de Raf (2026-08-06)**: *"que pruebes maniobras reales y casos de uso de por ej modo maniobra con 100
animales, lo guardes en un .md para revisar qué anotaste en cada uno, y luego vayas a la ficha de cada uno a
revisar que CADA DATO de CADA MANIOBRA de las que hiciste se registre y se muestre correctamente."*

**Rig**: A07 (`SM_A075M`, 720×1600 @ densidad 300) · APK `46503ea5` (= commit `a40e69b`; **NO** incluye la
unidad de sonido `08eab75`) · ESP32 emulando el RS420 por SPP en COM7 · cuenta con `Rodeo General`, Cría,
5001 cabezas.

**Cómo leer las etiquetas**: **[MEDIDO]** = ejecutado en el A07 y visto. **[LEÍDO]** = verificado en el
código. **[HIPÓTESIS]** = sin verificar, con el oráculo que lo dirimiría.

---

## 0. Inventario previo — qué captura cada maniobra y si vuelve a la ficha

Hecho **antes** de tocar el teléfono, a propósito: si arreglamos primero lo que Raf encontró (pezuñas),
arreglamos la instancia. La pregunta correcta es **qué otros datos que el peón carga no vuelven a ninguna
pantalla**, y eso es un inventario, no una corazonada.

Método: cruzar cada `INSERT INTO` de `src/services/powersync/local-reads.ts` contra las lecturas de display.

| tabla donde escribe una maniobra | ¿vuelve a la ficha? | dónde |
|---|---|---|
| `weight_events` | ✅ | timeline (`local-reads.ts:1593`) |
| `condition_score_events` | ✅ | timeline |
| `lab_samples` | ⚠️ **parcial** | timeline, pero **sin el `tube_number`** — ver la corrección en A.3 |
| `reproductive_events` | ✅ | timeline |
| `sanitary_events` | ✅ | timeline |
| `scrotal_measurements` | ✅ | sección propia ("Circunferencia escrotal") |
| `treatments` | ✅ | sección propia ("Tratamientos") |
| `custom_attributes` | ✅ | leída en 4 lugares |
| **`custom_measurements`** | ❌ **NO** | — |

### 🔴 HALLAZGO 0.1 — el dato personalizado de maniobra entra y no sale nunca

**[LEÍDO], sin huecos.** `custom_measurements` es la tabla append-only donde va toda captura custom de
maniobra (spec 03 M5, migración 0094). Se **escribe** en `local-reads.ts:2437`. La **única** lectura en
producción es un `COUNT(*)` (`:2748`) para avisar cuántas cargas se verían afectadas al borrar la definición
del dato. **Ninguna lectura la muestra.** Y el `UNION ALL` del timeline de la ficha cubre exactamente seis
tipos —`category_change`, `condition_score`, `lab_sample`, `observacion`, `reproductive`, `sanitary`— entre
los que no está.

**Qué vive el peón**: mide 100 pezuñas en la manga, el dato se guarda, y **ninguna pantalla lo lee**. No es
dato perdido: es dato invisible, que para él es lo mismo y peor, porque cree que quedó registrado.

**No es un bug de pezuñas**: es todo el tipo "dato personalizado de maniobra". Cualquier dato que el campo
cree mañana cae en el mismo pozo.

**Falsa alarma descartada en el camino**: sospeché lo mismo de `weight_events` porque no aparecía en mi
primer grep del timeline. **Sí se lee** (`:1593`); el grep estaba mal recortado. El pesaje se muestra bien.

### 🟠 HALLAZGO 0.2 — los tubos existen pero no tienen sección propia

Pedido de Raf. Los `lab_samples` **sí** están en el timeline con todos sus campos, así que el dato existe y
se ve como eventos sueltos. Falta la vista agrupada: *"Muestras de laboratorio"* con los tubos y la fecha de
cada maniobra, sea brucelosis (1 tubo) o raspado de toro (2 tubos, R6.11 escribe `scrape_tricho` +
`scrape_campylo`). Es mejora de vista, no agujero de datos — distinto de 0.1 y hay que no confundirlos.

> ⚠️ **CORREGIDO EN LA FASE A (ver A.3).** Esta conclusión estaba mal y se armó mirando la *query*, no la
> *vista*. Medido en el teléfono: el **número de tubo NO se muestra en ninguna parte**. La query lo trae y
> `event-timeline.ts` lo parsea, pero `TimelineEvent.tsx:121` no lo pone en el detalle. O sea que 0.2 no es
> "falta agrupar": es **el mismo agujero que 0.1** — dato capturado que no vuelve. La agrupación sigue siendo
> deseable, pero primero hay que pintar el tubo.

---

## 1. Plan de la campaña

**Fase A — integridad de datos (primero).** Una jornada con **todos** los tipos de maniobra sobre **pocos**
animales (5-8). Se registra acá cada valor cargado, animal por animal. Después se abre la ficha de cada uno y
se verifica **dato por dato**. Encuentra la clase "lo cargué y no vuelve" mucho más rápido que 100 animales
de un tipo.

**Fase B — escala (después).** Jornada de 100 animales. Busca lo que la Fase A no puede ver: estado que se
degrada, memoria, lentitud, la sesión que se corta, el resumen final que no cuadra.

**Fase C — edge cases de flujo.** Salir a mitad y retomar · sin señal · animal repetido · saltear · corregir
un dato ya cargado · cerrar la app en medio · cambiar de rodeo con jornada abierta.

---

## 2. Bitácora

### Observaciones sueltas antes de arrancar

- **[MEDIDO]** Quedó una **jornada sin terminar de anoche** ("Rodeo General · Pesaje · 0 animales") de las
  pruebas del FAB, y la app la ofrece retomar al día siguiente. El comportamiento es correcto (no se pierde
  trabajo), pero **una jornada con CERO animales sobreviviendo un día** merece decidirse: ¿se ofrece retomar
  algo donde no se cargó nada? Para el peón, "Retomar la jornada de hoy · 0 animales" es ruido.

---

## 3. FASE A — integridad de datos

**Ejecutada el 2026-08-06 desde las 21:44.** Rig: A07 en exclusiva, `stayon usb` activo.

### 3.1 Inventario de maniobras que ofrece `Rodeo General` (Cría)

**[MEDIDO]** — leído del paso 2 de 3 del asistente de jornada nueva, scrolleando hasta el fondo.

| # | Maniobra | grupo |
|---|---|---|
| 1 | Tacto de preñez | estándar |
| 2 | Tacto de aptitud reproductiva | estándar |
| 3 | Sangrado (brucelosis) | estándar |
| 4 | Vacunación | estándar |
| 5 | Inseminación | estándar |
| 6 | Condición corporal | estándar |
| 7 | Dientes | estándar |
| 8 | Pesaje | estándar |
| 9 | Pesaje de ternero | estándar |
| 10 | Raspado de toros | estándar |
| 11 | Antiparasitario | estándar |
| 12 | Antibiótico | estándar |
| 13 | Circunferencia escrotal | estándar |
| 14 | **Angulo de pezuñas** ★ | **personalizada** (sección "Maniobras personalizadas") |

Total **14**. La #14 es la que dispara el hallazgo 0.1 (`custom_measurements`) — es el control de que
el método de esta campaña detecta lo que ya sabemos que está roto.

**Configuración de la jornada** (paso 2/3, [MEDIDO]): las 14 seleccionadas, en este orden —
1 Pesaje de ternero · 2 Condición corporal · 3 Dientes · 4 Tacto de preñez · 5 Tacto de aptitud
reproductiva · 6 Inseminación · 7 Sangrado · 8 Raspado de toros · 9 Circunferencia escrotal ·
10 Vacunación · 11 Antiparasitario · 12 Antibiótico · 13 Pesaje · 14 Angulo de pezuñas.
Pre-configuraciones de tanda: **Vacunas = Aftosa + Carbunclo** · **Pajuela = Toro Angus RJ-88** ·
**Medir tamaño de preñez = SÍ** (sugerido: el rodeo tiene 3 meses de servicio).
El bastón **no** estuvo conectado (el ESP32 no respondía en el puerto serie y la app quedó en
"Conectando…/Reintentando…" toda la sesión) → identificación 100 % por caravana visual, sin EID.

### 3.2 Lo que cargué, animal por animal

Valores elegidos a propósito distintos entre animales, para que un cruce de datos se note.

#### Animal 1 — `PERF-03000` · Toro · Rodeo General

Pasos aplicables: **10 de 14**. Salteó solo Pesaje de ternero, Tacto de preñez, Tacto de aptitud
reproductiva e Inseminación → el gating por sexo/categoría **funciona** ✅ [MEDIDO].

| # | maniobra | valor cargado |
|---|---|---|
| 1 | Condición corporal | **3,50** |
| 2 | Dientes | **Boca llena** |
| 3 | Sangrado (brucelosis) | tubo **A-101** |
| 4 | Raspado de toros | Trico **T-101** · Campylo **C-101** |
| 5 | Circunferencia escrotal | **38,5 cm** · **49 meses** |
| 6 | Vacunación | **Aftosa** + **Carbunclo** (las dos "Aplica") |
| 7 | Antiparasitario | **Ivermectina 3,15** |
| 8 | Antibiótico | **Oxitetraciclina LA** |
| 9 | Pesaje | **685 kg** |
| 10 | Angulo de pezuñas (custom) | **Afuera** |

El resumen "Revisá la carga" mostró los 10 valores exactos. [MEDIDO]

#### Animal 2 — `PERF-02001` · Vaquillona · Rodeo General

Pasos aplicables: **10 de 14**. Salteó Pesaje de ternero, **Tacto de preñez** (vaquillona sin
servicio), Raspado de toros y Circunferencia escrotal. Gating correcto ✅ [MEDIDO].

| # | maniobra | valor cargado |
|---|---|---|
| 1 | Condición corporal | **2,25** |
| 2 | Dientes | **2 dientes** |
| 3 | Tacto de aptitud reproductiva | **APTA** |
| 4 | Inseminación | **Toro Angus RJ-88** (pajuela por defecto de la tanda) |
| 5 | Sangrado (brucelosis) | tubo **B-202** |
| 6 | Vacunación | **solo Aftosa** — Carbunclo marcado **"No aplica"** a mano |
| 7 | Antiparasitario | **Cydectin 10** |
| 8 | Antibiótico | **Penicilina LA** |
| 9 | Pesaje | **312 kg** |
| 10 | Angulo de pezuñas (custom) | **Adentro** |

#### Animal 3 — `PERF-00500` · Toro · Rodeo General (con salteos a propósito)

| # | maniobra | valor cargado |
|---|---|---|
| 1 | Condición corporal | **4,00** |
| 2 | Dientes | **1/2** → apareció el prompt CUT, respondí **"No, solo registrar dientes"** |
| 3 | Sangrado (brucelosis) | **SALTEADO** (botón "Saltear sangrado") |
| 4 | Raspado de toros | Trico **T-303** · Campylo **C-303** |
| 5 | Circunferencia escrotal | **34 cm**, edad **"No sé la edad"** (sin edad) |
| 6 | Vacunación | **ninguna** — marqué Aftosa y Carbunclo como "No aplica" → CTA cambió a "Seguir sin aplicar" |
| 7 | Antiparasitario | **SALTEADO** |
| 8 | Antibiótico | **Tulatromicina** |
| 9 | Pesaje | **742 kg** |
| 10 | Angulo de pezuñas (custom) | **Afuera** |

Resumen: `Salteado` / `Sin vacuna` se muestran bien como tales. [MEDIDO]

#### Animal 4 — `PERF-04321` · Vaquillona · Rodeo General (acepta CUT)

| # | maniobra | valor cargado |
|---|---|---|
| 1 | Condición corporal | **1,00** (bajé 9 veces desde 3,00 → **clampea en 1,00** ✅) |
| 2 | Dientes | **1/4** + **"Marcar CUT" ACEPTADO** |
| 3 | Tacto de aptitud reproductiva | **NO APTA** |
| 4 | Inseminación | pajuela cambiada a **Toro Brangus 77** |
| 5 | Sangrado (brucelosis) | tubo **D-404** |
| 6 | Vacunación | **Aftosa + Carbunclo** |
| 7 | Antiparasitario | **Ricobendazol 15** |
| 8 | Antibiótico | **Florfenicol 30** |
| 9 | Pesaje | **289 kg** |
| 10 | Angulo de pezuñas (custom) | **Adentro** |
| — | Lote | intenté asignar uno → **no hay ninguno y la hoja no deja crearlo** (ver A.10) |

#### Animal 5 — `PERF-01717` · Vaquillona · Rodeo General (dos correcciones desde el resumen)

| # | maniobra | valor cargado |
|---|---|---|
| 1 | Condición corporal | **5,00** (subí 10 veces → **clampea en 5,00** ✅) |
| 2 | Dientes | **Boca llena** |
| 3 | Tacto de aptitud reproductiva | **DIFERIDA** |
| 4 | Inseminación | **Toro Angus RJ-88** |
| 5 | Sangrado (brucelosis) | tubo **E-505** |
| 6 | Vacunación | **Aftosa + Carbunclo** |
| 7 | Antiparasitario | **Doramectina 1** |
| 8 | Antibiótico | **Enrofloxacina 10** |
| 9 | Pesaje | cargué **1 kg**, después lo **corregí a 355 kg** desde el resumen → **vale 355 kg** |
| 10 | Angulo de pezuñas (custom) | cargué **Afuera**, después lo **corregí a Adentro** → **vale Adentro** |

El keypad aceptó **1 kg** sin chistar (la única validación es `kg > 0`, sin techo ni piso razonable).
La corrección desde el resumen precarga el valor viejo y hay tecla **Borrar** ✅.

#### Animal 6 — `PERF-02001` · Vaquillona (**SEGUNDA pasada del MISMO animal**, ver A.9)

Lo re-escaneé a propósito para llegar al **Tacto de preñez**: tras la inseminación de la pasada 1,
la app ya lo considera servido y el paso aparece. El gating **sí** reacciona al estado nuevo ✅.

| # | maniobra | valor cargado |
|---|---|---|
| 1 | Condición corporal | **3,75** |
| 2 | Dientes | **4 dientes** |
| 3 | **Tacto de preñez** | **PREÑADA · CUERPO** |
| 4 | Inseminación | **SALTEADO** |
| 5 | Sangrado (brucelosis) | tubo **F-606** |
| 6 | Vacunación | **Aftosa + Carbunclo** |
| 7 | Antiparasitario | **Levamisol 6** |
| 8 | Antibiótico | **Ceftiofur 5** |
| 9 | Pesaje | **318 kg** |
| 10 | Angulo de pezuñas (custom) | **Afuera** |

Nota: en esta pasada **desapareció** "Tacto de aptitud reproductiva" (ya quedó apta en la pasada 1)
y **apareció** "Tacto de preñez". El gating es dinámico dentro de la misma jornada ✅.

---

### 🔴 HALLAZGO A.1 — tipear la caravana COMO ESTÁ IMPRESA no encuentra al animal, y la app ofrece duplicarlo

**[MEDIDO] en el A07, reproducido 2 veces, + [LEÍDO] la causa exacta en el código.**

En la entrada manual de la jornada tipeé `PERF-00500` — el string **exacto** que la propia app
muestra como caravana en su lista de resultados. La app contestó:

> **Animal nuevo** · "No hay ningún animal con esta caravana. Dalo de alta y seguí con las maniobras."
> `[ Dar de alta ]`

El animal **existe**: buscando `500` aparece `PERF-00500 · Rodeo General · Toro`.

**Barrido que aísla la causa** (cada fila es una búsqueda real en el teléfono):

| tipeado | resultado |
|---|---|
| `PERF` | ✅ 20 candidatos |
| `PERF-` | ✅ 20 candidatos |
| `PERF-0` | ❌ "Animal nuevo" |
| `PERF-005` | ❌ "Animal nuevo" |
| `PERF-0050` | ❌ "Animal nuevo" |
| `PERF-00500` | ❌ "Animal nuevo" |
| `perf-00500` | ❌ "Animal nuevo" |
| `F-005` | ❌ "Animal nuevo" |
| `00500` | ✅ encuentra `PERF-00500` |
| `500` | ✅ 6 candidatos |

**Causa** — `app/src/utils/animal-identifier.ts:34,73`:

```ts
const STRUCTURED_SEPARATORS = /[\s\-./]/g;
const compact = normalized.replace(STRUCTURED_SEPARATORS, '');
```

`compact` (espacio, **guion**, punto y barra borrados) es el término con el que se hacen el match
exacto y el LIKE de **idv**. Pero el idv guardado **conserva** el guion. Entonces `PERF-00500` se
compara como `PERF00500` contra `PERF-00500` → no matchea. Todo término que **cruce** el separador
falla; los que quedan de un solo lado (`PERF`, `00500`) andan. Eso explica las 10 filas de arriba
sin excepción.

El borrado de separadores tiene sentido para la caravana **electrónica** (el operario tipea
`982 000 364…` en grupos). Está mal aplicarlo al canal **idv**, donde el separador es parte del
valor guardado. Y el guion es lo más común en una caravana visual argentina (CUIG-número, binomio).

**Qué vive el peón**: lee la caravana de la oreja, la tipea **como está impresa**, y la app le dice
que ese animal no existe y le ofrece el botón **"Dar de alta"**. Un toque y hay dos registros del
mismo animal — con las maniobras del día repartidas entre los dos. Es la peor clase de pérdida de
datos: silenciosa y que se descubre meses después.

**Propuesta de arreglo** (no la apliqué — soy QA): correr el canal **idv** con `normalized` (con
separadores) **además** de con `compact`, o comparar compactado de los **dos** lados
(`replace(idv, SEP)` en la query). El canal tag_electronic puede seguir usando `compact`.

**El buscador GLOBAL de animales tiene el mismo agujero** [MEDIDO]: en la pestaña *Animales*,
`PERF-00500` → *"No encontramos «PERF-00500». ¿Es un animal nuevo? Cargalo en un toque."* con botón
**"Dar de alta este animal"**. `00500` lo encuentra al toque. Mismo `classifySearchQuery`, mismo fix.

---

### 🔴 HALLAZGO A.2 — todo lo que se carga después de las 21:00 queda fechado MAÑANA

**[MEDIDO] + [LEÍDO] la línea exacta.**

Reloj del A07 al terminar la jornada: `Thu Aug 6 22:54 -03 2026` (verificado con `adb shell date`,
`auto_time=1`). Los **7** eventos que acabo de cargar en `PERF-00500` aparecen en la ficha fechados
**07/08**. El único evento viejo del animal (el Alta) muestra **18/07**, correcto.

```
Estado actual → Peso actual            742 kg · 07/08
Estado actual → Condición corporal     4 / 5 · 07/08
Circunferencia escrotal                34 cm   07/08
Historial → Pesaje / Tratamiento / Muestra ×2 / Condición corporal   todos 07/08
Historial → Alta                       18/07     ← el viejo, bien
```

**Causa** — `app/app/maniobra/carga.tsx:140-143`:

```ts
/** ISO 'YYYY-MM-DD' de hoy (wall-clock del dispositivo) para event_date. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
```

El comentario dice *wall-clock del dispositivo* y el código hace **UTC**. En Argentina (UTC−3),
entre las **21:00 y las 23:59** hora local, `toISOString()` ya devuelve el día siguiente. Este
`todayIso()` es el que alimenta `eventDate` en `carga.tsx:627`, y de ahí sale la fecha de **todas**
las maniobras: `weight_events.weight_date`, `condition_score_events.event_date`,
`sanitary_events.event_date`, `lab_samples.collection_date`, `reproductive_events.event_date`,
`scrotal_measurements.measured_at`.

**No es un bug de display, es el dato.** Prueba por el signo: las columnas son `date` (sin hora). Un
error de *renderizado* de una fecha date-only en UTC−3 daría **−1 día** (el clásico
`new Date('2026-08-06')` → medianoche UTC → 5/8 local). Acá el corrimiento es **+1**, que solo puede
venir de que el valor **guardado** sea `2026-08-07`. Corrobora: el riel muestra `07/08` en vez de
**"Hoy"** — o sea que la app misma no reconoce esos eventos como de hoy.

Ya existe el helper correcto en el repo (`app/src/utils/link-calf-query.ts:53 todayIsoLocal(now)`), y
la regla está en la memoria del proyecto ("date-only por string, NUNCA `new Date`"). Este call site
la incumple. Mismo patrón en `app/src/utils/maneuver-category-preview.ts:138`.

**Qué vive el peón**: aprieta el último animal a las 21:30 de un día largo, y toda esa tanda queda
cargada con la fecha de mañana. Rompe la ventana de 10 días hábiles de SENASA, rompe cualquier
ganancia diaria de peso entre dos pesajes, rompe los filtros "de hoy", y en la ficha ve sus propios
datos fechados en el futuro.

**Propuesta de arreglo**: reemplazar `todayIso()` por el `todayIsoLocal()` que ya existe
(`getFullYear`/`getMonth`/`getDate` locales) y barrer **todos** los `toISOString().slice(0,10)` del
repo, no solo este (regla "barrer la ausencia": el guard va sobre el patrón, no sobre la instancia).

---

### 🔴 HALLAZGO A.3 — el número de tubo se guarda, se parsea… y se tira antes de pintarlo

**[MEDIDO] en la ficha + [LEÍDO] la línea.** **Corrige el hallazgo 0.2 de esta misma bitácora**, que
había concluido por lectura de la *query* que "los lab_samples SÍ están en el timeline con todos sus
campos". La query los trae; la **vista** no los pinta.

En `PERF-00500` cargué Raspado con **Trico T-303** y **Campylo C-303**. La ficha muestra:

```
Muestra
Raspaje (campylobacter)
07/08
```

Sin `C-303`. Idem trichomonas, idem el tubo `A-101` del sangrado de brucelosis del animal 1. Las
filas del riel **no son tocables**, así que no hay ningún detalle donde el número aparezca.

**Causa** — `app/src/components/TimelineEvent.tsx:120-127`:

```ts
case 'lab_sample': {
  const parts = [humanizeSampleType(item.sampleType), item.result].filter(Boolean) as string[];
  return { icon: FlaskConical, accent: 'primary', title: 'Muestra',
           detail: parts.length > 0 ? parts.join(' · ') : null };
}
```

`item.tubeNumber` **existe** en el modelo (`event-timeline.ts:188` lo declara, `:329` lo parsea desde
la RPC) y no entra en `parts`. Se pierde en el último centímetro.

**Qué vive el peón**: el número de tubo es **lo único** que tipea en el sangrado y en el raspado, y
es la llave con la que después se aparea el resultado del laboratorio. Lo carga y no lo puede volver
a ver en ninguna pantalla. Si el laboratorio le manda "tubo A-101: positivo", no tiene cómo saber de
qué animal era.

**Propuesta de arreglo**: sumar `item.tubeNumber` a `parts` (`Raspaje (trichomonas) · Tubo T-303`).
Es una línea. Y recién ahí tiene sentido la sección agrupada de "Muestras de laboratorio" del
hallazgo 0.2 original.

---

### 🔴 HALLAZGO A.4 — la maniobra DIENTES congela la categoría del animal para siempre

**[MEDIDO] con un A/B controlado de una sola variable.** Este arrancó como una anomalía que vi de
costado y casi reporto mal: dos vaquillonas de la jornada grande salieron con un
`category_change` de **hoy** marcado **"(manual)"** que yo nunca pedí, y una con el badge
**"Categoría fijada manualmente"** en la ficha.

**Primera hipótesis: FALSIFICADA.** Sospeché del "Tacto de aptitud reproductiva". Corrí una jornada
de **una sola maniobra** (aptitud = APTA) sobre `PERF-00007`, un animal con el historial **vacío**
(control perfecto). Resultado: aparece "Aptitud reproductiva: Apta" y **ningún cambio de categoría**.
No es la aptitud. Lo dejo escrito para que nadie vuelva a correr este experimento.

**Bisección, dos jornadas de control sobre animales con historial vacío:**

| jornada | animal | resultado en la ficha |
|---|---|---|
| **solo Inseminación** | `PERF-01999` | "Cambió a Vaquillona **(automático)**" · **sin** badge de fijación |
| **Dientes + Inseminación** | `PERF-02999` | "Cambió a Vaquillona **(manual)**" · **"Categoría fijada manualmente / Quitar fijación"** |

Una sola variable de diferencia: **Dientes**. Y reproduce lo que ya había pasado sin querer con
`PERF-02001` (22:13) y `PERF-01717` (22:42) en la jornada grande.

**Por qué importa** — `supabase/migrations/0031_category_transitions.sql:97`:

```sql
if v_override is null or v_override = true then
  return new;  -- override activo => no tocamos (R4.9)
end if;
```

Con `category_override = true`, **ninguna transición automática de categoría vuelve a dispararse en
ese animal, nunca**. Ni vaquillona → vaquillona preñada, ni vaquillona preñada → vaca de 2º servicio,
ni → multípara. El animal queda clavado en la categoría que tenía el día que le miraron la boca.

El stamp lo pone `0021_animal_profiles_validations.sql:66-76`: cualquier UPDATE que cambie
`category_id` **sin** el GUC `rafaq.is_auto_transition='on'` marca override. El SQL del cliente para
dientes (`local-reads.ts:2311 buildSetTeethStateUpdate`) escribe **solo** `teeth_state`, así que el
cruce pasa del lado del server, al subir: **dos hipótesis de mecanismo, ninguna verificada** —
(a) el PATCH de `animal_profiles` que sube PowerSync hace que el recálculo de categoría caiga fuera
de la ventana con el GUC prendido, o (b) el PATCH viaja con un `category_id` propio y dispara el
trigger de override. **Esto último hay que dirimirlo leyendo el server, no lo hice.**

**Qué vive el peón**: "Dientes" es una maniobra de rutina — cualquier tanda de destete o de repaso la
lleva. Después de esa jornada, la composición por categoría del rodeo **deja de actualizarse sola**
para todos los animales que pasaron. Y la composición por categoría es la base del pilar de
analytics/benchmarking. No hay ningún aviso: el peón ve un badge que dice "fijada manualmente", que
va a leer como que alguien la fijó a propósito.

**Cómo confirmarlo en 1 minuto**: jornada con Dientes + Inseminación sobre un animal limpio → ficha →
badge. Cómo desactivarlo hoy: "Quitar fijación" animal por animal.

---

### 🔴 HALLAZGO A.5 — con dos cargas del mismo día, "Peso actual" y "Condición corporal" salen a cara o ceca

**[MEDIDO] + [LEÍDO] la línea.** `PERF-02001` pasó dos veces por la manga hoy:

| | pasada 1 | pasada 2 | qué muestra la ficha |
|---|---|---|---|
| Pesaje | 312 kg | **318 kg** | **318 kg** ✅ (el nuevo) |
| Condición corporal | 2,25 | **3,75** | **2,25** ❌ (el **viejo**) |

Las dos filas del riel están y en el orden correcto (3,75 arriba de 2,25). Lo que está mal es
**"Estado actual"**. Verificado dos veces, en dos lecturas separadas de la ficha.

**Causa** — `app/src/utils/event-timeline.ts:612-622`, el desempate de peso y condición:

```ts
const isNewer = (candDate, candId, best) => {
  if (!best) return true;
  const cand = Date.parse(candDate);
  if (Number.isFinite(cand) && cand !== best.ms) return cand > best.ms;
  // Empate (o fecha inválida) → desempate estable por eventId.
  return candId > best.item.eventId;
};
```

`eventDate` es una columna `date` **sin hora** → dos cargas del mismo día **siempre** empatan, y el
desempate es `candId > best.item.eventId`: una comparación de **UUIDs aleatorios**. Es determinístico
pero arbitrario — **50 % de las veces gana el evento viejo**. Salió bien en el peso y mal en la
condición, que es exactamente lo que predice una moneda.

La rama reproductiva de la MISMA función ya tiene este bug arreglado (`isNewerRepro`, desempate por
`seq` / `created_at`), y el comentario del código lo dice con todas las letras: *"reemplazando el
`eventId` UUID random (~50/50)"*. **A peso y condición nunca les llegó ese arreglo.**

**Qué vive el peón**: repesar un animal es rutina (se movió en la balanza, alguien se apoyó, el
primer número no cerraba). Después de repesar, la ficha muestra el número viejo la mitad de las
veces. Y "Peso actual" es de lo que se alimenta el pilar de analytics.

**Ojo, no confundir con la corrección desde el resumen**: esa hace UPDATE de la misma fila y anda
bien — verificado en `PERF-01717`, cargué 1 kg, corregí a 355 kg, y en la ficha hay **una sola** fila
de pesaje con 355 kg ✅. El bug es con **dos capturas distintas** del mismo día.

**Propuesta de arreglo**: darle a `isNewer` el mismo desempate que ya tiene `isNewerRepro`
(`seq` → `created_at` → `eventId`). El patrón ya está escrito en el archivo, 10 líneas más abajo.

---

## 4. Verificación dato por dato en la ficha

**60 datos cargados · 60 verificados · 41 ✅ · 19 ❌.** Abrí las 5 fichas.

### Los ✅ (nada que hacer)

- **Pesaje** — 685 / 742 / 289 / 355 / 318 kg: los 5 en "Peso actual" y en el riel, con el valor exacto.
- **Condición corporal** — 3,50 → `3,5 / 5`; 4,00 → `4 / 5`; 1,00 → `1 / 5`; 5,00 → `5 / 5`. Formato
  es-AR correcto. (El caso de la doble carga es el hallazgo A.5.)
- **Dientes** — Boca llena / 1/2 / 1/4 / 4 dientes: los 5 en "Estado actual → Dientes". Como es
  propiedad y no evento, **no** aparece en el riel: es el diseño, no un agujero.
- **CUT** — `PERF-04321` quedó con categoría **CUT**, badge, "Quitar CUT" y el evento
  "Cambió a CUT (manual)" en el riel. Y el CUT que **rechacé** en `PERF-00500` no dejó rastro ✅.
- **Circunferencia escrotal** — 38,5 cm con `49 meses` renderizado **"4 años 1 mes"** (conversión
  correcta); 34 cm **sin** edad cuando elegí "No sé la edad" (no inventa un valor) ✅. Tarjeta propia
  + fila en el riel.
- **Vacunación** — una fila por vacuna. Y el **"No aplica"** se respeta: `PERF-02001` pasada 1 tiene
  **solo Aftosa**, sin Carbunclo ✅. `PERF-00500` con las dos en "No aplica" **no escribió ninguna** ✅.
- **Antiparasitario / Antibiótico** — los 8 nombres de producto, exactos, en el riel como
  "Desparasitación" y "Tratamiento".
- **Tacto de aptitud** — Apta / No apta / Diferida, los 3 en "Estado actual".
- **Tacto de preñez** — "Preñada (cuerpo)" ✅, y disparó la transición automática a **Vaquillona
  preñada** ✅.
- **Salteos** — los 2 pasos salteados (`Sangrado` y `Antiparasitario` de `PERF-00500`) **no dejaron
  ninguna fila**. Control negativo pasado ✅.
- **Correcciones desde el resumen** — 1 kg→355 kg y Afuera→Adentro: pisan, no duplican ✅.

### Los ❌ (19 datos que cargué y no vuelven)

| dato | cuántos | hallazgo |
|---|---|---|
| Dato personalizado de maniobra ("Angulo de pezuñas") | **6** | 0.1 — **confirmado en device** |
| Número de tubo (5 sangrados + 4 raspados) | **9** | A.3 |
| Pajuela de la inseminación | **3** | A.6 (abajo) |
| Condición corporal vigente equivocada | **1** | A.5 |

**El control del método funcionó**: cargué el dato personalizado en los 6 pases y **no aparece en
ninguna parte** de ninguna ficha — no hay sección "Datos personalizados", no está en el riel, no está
en "Estado actual". El hallazgo 0.1, que estaba solo [LEÍDO], queda **[MEDIDO]**.

---

## 5. El resto de los hallazgos

### 🟠 A.6 — la pajuela de la inseminación tampoco se muestra

Cargué `Toro Angus RJ-88`, `Toro Brangus 77`, `Toro Control 99`, `Toro Control 88`. El riel muestra
siempre **"Servicio · Inseminación (IA)"**, sin el toro. Causa —
`app/src/components/TimelineEvent.tsx:117`: `detail: preg ?? svc ?? (item.notes ?? null)`. La pajuela
viaja en `notes`, y `svc` ("Inseminación (IA)") **siempre** está, así que `notes` nunca se alcanza.
Misma clase que A.3: dato capturado, persistido, y descartado en el render. Para el productor, "a qué
toro la serví" es *el* dato de la inseminación.
**Arreglo**: concatenar en vez de encadenar con `??` — `Inseminación (IA) · Toro Angus RJ-88`.

### 🟠 A.7 — "Tratamientos" dice que no hay, y tres líneas más abajo el riel lista el antibiótico

En las 5 fichas: *"Este animal todavía no tiene tratamientos registrados"* mientras el riel muestra
"Tratamiento · Tulatromicina". Son dos tablas distintas (`treatments` vs `sanitary_events`), pero al
peón le queda una pantalla que se contradice sola. O el antibiótico de manga abre un `treatment`, o
la sección se renombra a algo que no prometa lo que no cubre.

### 🟠 A.8 — el autocompletar de productos mezcla pajuelas y vacunas con antiparasitarios

En el paso de **Antiparasitario**, "Usadas antes" ofrece `Toro Angus RJ-88` (la pajuela), `Aftosa` y
`Carbunclo` (las vacunas). Lo mismo en **Antibiótico**. Un toque equivocado escribe un
`sanitary_events` con `event_type='deworming'` y `product_name='Toro Angus RJ-88'`. Hay que scopear
las sugerencias por tipo de producto.
**Y encima la lista está vieja**: después de cargar Ivermectina, Cydectin, Oxitetraciclina y
Penicilina en esta misma jornada, el paso del animal 3 seguía ofreciendo las mismas tres de siempre.
En una tanda de 100, el peón retipea el mismo producto 100 veces.

### 🟠 A.9 — re-escanear el mismo animal no avisa, y el contador cuenta pasadas

Pasé `PERF-02001` dos veces en la misma jornada, con minutos de diferencia. **Cero aviso.** Arrancó
de cero con los valores por defecto, y el cierre dijo *"Procesaste 6 animales"* cuando eran **5**. En
la manga un animal que vuelve a dar la vuelta al corral es normal: se lleva dos pesajes, dos tandas
de vacuna y dos tubos de sangre distintos, en silencio. Y el conteo de la jornada miente.

### 🟠 A.10 — "Elegir lote" sin lotes es un callejón sin salida

Toqué "Lote (opcional)" en el resumen: la hoja abre con el título, el subtítulo *"Asignar este animal
a un lote es opcional"* y **nada más que "Cancelar"**. Ni lista, ni "todavía no hay lotes", ni crear
uno. Compará con la configuración de vacunas de la tanda, que sí deja tipear una nueva ahí mismo.

### 🟠 A.11 — el prompt de CUT ("vaca CUT") se ofrece sobre un TORO

En `PERF-00500` (macho) elegí "1/2" y saltó *"¿Marcar como CUT? Esta boca indica **vaca** CUT (de
descarte). Si la marcás, su **categoría pasa a CUT**."* CUT es de hembra. El gate del prompt excluye
terneros pero no machos. No acepté (habría corrompido el animal), así que **no sé a qué categoría lo
mandaría** — eso queda por probar.

### 🟡 Menores

- **A.12 — el pill del bastón tapa contenido. NO es hallazgo nuevo**: Raf ya lo levantó y hay una
  unidad en vuelo en otra terminal (`progress/impl_pill-arriba-derecha.md`, sin commitear; el APK del
  A07 es anterior). Lo anoto solo como **evidencia adicional de radio de daño**, medida en esta
  campaña: el pill "Conectando…/Reintentando…" se dibujó **encima** de cuatro cosas distintas — el
  botón **"Guardar"** de la hoja "¿Medir tamaño de preñez?", la opción **"4 dientes"** de la lista,
  el título de la hoja **"Elegir lote"** y una fila del resumen del animal. Dos de esas cuatro son
  controles tocables, no texto.
- **A.13 — la maniobra personalizada queda fuera del encabezado.** El subtítulo de la jornada lista
  13 maniobras y **no** incluye "Angulo de pezuñas". Tampoco recibe número de orden en el paso 2 (las
  de fábrica van 1..13, la custom queda suelta en su sección) ni etiqueta de accesibilidad
  equivalente ("seleccionada, posición N").
- **A.14 — la maniobra personalizada no se puede saltear sola.** Todos los pasos de fábrica tienen
  "Saltear <maniobra>"; en el paso custom el único botón es **"Saltear el animal entero"**. Si el
  peón no puede medir esa pezuña, pierde el animal completo.
- **A.15 — el paso de ANTIBIÓTICO tiene de placeholder "Ej.: Ivermectina"**, que es un
  antiparasitario. Copy sin especializar por paso.
- **A.16 — ofrece inseminar justo después de diagnosticar PREÑADA.** En `PERF-02001` el paso 3 dio
  "Preñada · Cuerpo" y el paso 4 abrió la inseminación con la pajuela cargada. La secuencia se fija
  al entrar el animal y no reacciona al resultado del tacto.
- **A.17 — el pesaje no tiene techo ni piso.** Cargué **1 kg** en una vaquillona y pasó sin un
  parpadeo. La única validación es `kg > 0`.
- **A.18 — la edad de la CE sigue diciendo "≈" después de elegirla a mano.** Elegí 49 meses en la
  rueda y la fila quedó en *"≈ 49 meses"*. No se distingue el valor derivado del que puso el operario.

### Notas de método (para que nadie repita el paso en falso)

- **`uiautomator` no ve las hojas recién abiertas.** Toqué "1/2" en dientes, el dump no mostró la
  hoja de CUT, toqué de nuevo, el segundo toque cayó en el backdrop y la cerró — y por un rato creí
  que el botón "1/2" estaba muerto. **No lo está.** La captura de pantalla es la fuente de verdad;
  el dump del árbol de accesibilidad llega tarde. Mismo efecto en la hoja de tamaño de preñez, donde
  los botones SÍ/NO/Guardar/Cancelar nunca aparecieron en el árbol.
- **El bastón no estuvo conectado** en toda la campaña (el ESP32 no respondía en el puerto serie —
  el `COM7` documentado ya no es el suyo; hay un "Dispositivo serie USB (COM10)"). Toda la
  identificación fue manual. **Ningún animal de esta fase tiene EID**, así que la ruta de
  identificación por bastón queda sin cubrir.
- **Supabase MCP contestó `Unauthorized`** toda la sesión → cero verificación contra la base. Todo lo
  de acá se midió en la pantalla del teléfono o se leyó en el código del repo.
- El rodeo de prueba solo tiene **Vaquillona** y **Toro** (un toro cada 100 caravanas). **"Pesaje de
  ternero" no se pudo ejercitar** — no hay terneros en `Rodeo General`.



---

## 6. Cierre de la Fase A — hallazgos por daño al peón en la manga

**Recorrido**: 6 pasadas sobre 5 animales distintos en la jornada principal (las 14 maniobras que
ofrece el rodeo, incluida la personalizada) + 3 animales de control en jornadas de bisección.
**60 datos cargados, 60 verificados en la ficha: 41 ✅ / 19 ❌.**

### 🔴 Pierde datos o deja al animal roto

| # | hallazgo | por qué duele |
|---|---|---|
| **A.1** | Tipear la caravana **como está impresa** (`PERF-00500`) no encuentra al animal y ofrece **"Dar de alta"** | Un toque = animal duplicado, con la jornada repartida entre los dos. Afecta la manga **y** el buscador global. Cualquier IDV con guion, punto, barra o espacio. |
| **A.4** | La maniobra **Dientes** deja la categoría **fijada manualmente** | Todo animal que pase por una jornada con Dientes **deja de transicionar solo para siempre**. Silencioso y acumulativo; se come el pilar de analytics. |
| **A.2** | Todo lo cargado **después de las 21:00** queda fechado **mañana** (`toISOString()` = UTC) | La fecha es el dato, no el display. Rompe la ventana de SENASA, las ganancias diarias y los filtros "de hoy". |
| **A.5** | Con **dos cargas del mismo día**, "Peso actual" y "Condición corporal" eligen entre ellas **por UUID** (~50/50) | Repesar un animal es rutina; la mitad de las veces la ficha muestra el número viejo. El arreglo ya existe en la misma función, para la rama reproductiva. |
| **0.1** | El **dato personalizado de maniobra** no se muestra en ninguna pantalla — **confirmado en device** | 6 de 6 cargas invisibles. El peón cree que quedó registrado. |
| **A.3** | El **número de tubo** se captura, se persiste, se parsea… y no se pinta | Es la llave con la que se aparea el resultado del laboratorio. Sin ella, "tubo A-101: positivo" no se puede atribuir. |

### 🟠 Fricción real

**A.6** la pajuela de la inseminación tampoco se muestra · **A.7** "Tratamientos" dice que no hay
mientras el riel lista el antibiótico · **A.8** el autocompletar mezcla pajuelas y vacunas con
antiparasitarios, y no incorpora lo cargado en la jornada · **A.9** re-escanear el mismo animal no
avisa y el contador cuenta pasadas, no animales · **A.10** "Elegir lote" sin lotes es un callejón sin
salida · **A.11** el prompt de CUT ("vaca CUT") se ofrece sobre un toro.

### 🟡 Mejoras

**A.12** el pill del bastón tapa contenido en 4 pantallas (**ya conocido**, unidad en vuelo en otra
terminal — acá solo suma evidencia) · **A.13** la maniobra personalizada queda
fuera del encabezado y sin número de orden · **A.14** no se puede saltear solo la maniobra
personalizada · **A.15** placeholder "Ej.: Ivermectina" en el paso de antibiótico · **A.16** ofrece
inseminar justo después de diagnosticar preñada · **A.17** el pesaje acepta 1 kg · **A.18** la edad de
la CE sigue con "≈" después de elegirla a mano.

### Lo que la Fase A NO cubrió

- **Identificación por bastón** (el ESP32 no respondía; toda la sesión fue caravana manual, sin EID).
- **Pesaje de ternero** y **Tacto de preñez sobre vaca probada** — el rodeo de prueba solo tiene
  vaquillonas y toros.
- **Reporte de jornada** (Reportes → Jornadas): no lo abrí. El conteo por tipo es online y ahí se
  vería si "Personalizados" cuenta lo que la ficha no muestra.
- **Verificación contra la base**: el MCP de Supabase estuvo `Unauthorized` toda la sesión.

Fases **B** (100 animales) y **C** (edge cases de flujo) **no empezadas** — a la espera del OK.
