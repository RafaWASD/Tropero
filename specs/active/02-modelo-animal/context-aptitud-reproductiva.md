# Contexto (Gate 0) — Aptitud reproductiva + estado reproductivo visible

> Delta Nivel B (ADR-028) sobre spec 02 (modelo/alta/ficha) con un slice de spec 03 (aplicabilidad de
> inseminación). Cubre las correcciones del testeo en vivo **#6** (prompt de aptitud en el alta), **#1b**
> (inseminación solo a hembra apta) y **#5** (indicador de preñez/estado reproductivo visible). Origen:
> `docs/correcciones-prueba-en-vivo-2026-06-27.md` + decisiones de dominio con Raf (2026-06-29).

## Contexto validado (as-built)

El mapeo del código confirmó que **la mayor parte del modelo de aptitud que se quería ya existe en el backend**:

- **`heifer_fitness`** (`apta`/`no_apta`/`diferida`, enum de `0053`) vive **solo** como columna en
  `reproductive_events` cuando `event_type='tacto_vaquillona'`. **No hay flag persistente** en
  `animal_profiles`; la "aptitud vigente" se **deriva on-read** del último evento `tacto_vaquillona`.
- **`rodeo_serviced_females`** (`0105`, derivación de "servidas") **ya cumple el modelo pedido**:
  - es **en vivo** (función `STABLE` sobre el estado actual, no un batch del día 1);
  - las hembras **probadas** (`vaquillona_prenada`/`vaca_segundo_servicio`/`multipara`/`vaca_cabana`) cuentan
    **sin gate** (= "altas grandes se asumen aptas");
  - las **vaquillonas** se gatean por aptitud: último `heifer_fitness='apta'` → servida; `no_apta`/`diferida`
    → **NO** servida; con **fallback** por edad (≥365 d sin veredicto → servida, para campos que no tactean);
  - **CUT** queda afuera (su categoría pasa a `cut`, que no está en el set de servidas).
- La **inseminación** (`appliesToAnimal`, `maneuver-applicability.ts`) cae a `default: return true` → **deja
  inseminar machos** (root cause de #1b) y no filtra por aptitud.
- El **alta** (`crear-animal.tsx`) marca categoría en el paso 3 y gatea campos por categoría; **no** captura
  aptitud hoy. Ya crea eventos post-create con patrón soft-fail (condición, preñez) → el mismo patrón sirve
  para crear un `tacto_vaquillona`.
- El **estado reproductivo no se muestra en ningún lado** fuera del timeline — ni aptitud ni preñez tienen
  badge en lista/ficha. **Esto es lo que faltaba** (sensación de Raf de que "no hay marca").

## Alcance

**Entra:**
1. **Alta — prompt de aptitud** para `vaquillona` (#6): tras marcar la categoría, preguntar *"¿Esta vaquillona
   está apta para poner en servicio? SÍ / AÚN NO SÉ / NO ES APTA"* → crea un evento `tacto_vaquillona` con
   `heifer_fitness` = `apta` / `diferida` / `no_apta` (post-create, patrón soft-fail; reusa el UI de
   `TactoVaquillonaStep`).
2. **Indicador unificado de estado reproductivo** (#5 + aptitud): un **único badge** en la **lista de rodeo**
   y desglosado en la **ficha**. Derivado de eventos existentes (sin columna nueva).
3. **Inseminación — fix de aplicabilidad** (#1b): `appliesToAnimal('inseminacion')` = hembra **+ apta**
   (excluye machos, ternera, `no_apta`/`diferida`). Client-side (igual que todo el gating de maniobra hoy).
4. **Espejo client-side de "aptitud vigente"** (derivación del último `tacto_vaquillona` + categoría probada +
   `is_cut`) para alimentar el badge y la aplicabilidad — análogo al espejo de categoría (C6).

**No entra:**
- Columna persistente de aptitud (decisión 1: se mantiene **derivado**).
- Guard **server-side** de macho en servicio/inseminación → **backlog** (decisión 5).
- Cualquier cambio al **denominador de servidas** (ya correcto en `0105`).
- Peso de destete / cluster ternero (otro delta).

## Casos y decisiones (cerradas con Raf, 2026-06-29)

1. **Aptitud DERIVADA, sin columna nueva.** El alta crea un evento `tacto_vaquillona`; el sistema muestra el
   estado derivado del último evento. Es en vivo, sin migración, fuente única (los eventos). ✅
2. **"AÚN NO SÉ" = `diferida`** → crea evento `diferida` → **NO servida hasta un tacto `apta` real**. El
   veredicto explícito **gana sobre el fallback de edad**: una vaquillona grande marcada "AÚN NO SÉ" no se
   cuenta como servida aunque tenga la edad. ✅
3. **Display: UN badge en la lista, desglosado en la ficha** (decisión delegada al leader, ojo vet/productor).
   Aptitud y preñez son **fases secuenciales del mismo eje** (readiness reproductiva), nunca "actuales" a la
   vez → un solo chip por hembra:
   - **vaquillona pre-servicio** → `Apta` / `Diferida` / `No apta`;
   - **servida/diagnosticable** → `Preñada` / `Vacía` / `Servida sin tacto`;
   - **macho / ternera** → sin badge (no aplica; el toro tiene su circunferencia escrotal, fuera de scope).
   Razón: en la **lista** se escanean muchos animales → un chip = bajo costo cognitivo (Hick) y dos badges
   dejarían un slot vacío/redundante casi siempre; en la **ficha** se desglosa (aptitud + preñez + timeline),
   donde el detalle sí cabe (progressive disclosure). Colores por estado (se definen en el design;
   ej. preñada=verde, vacía=ámbar/terracota, apta=verde, no apta=gris/terracota, diferida=ámbar). ✅
4. **CUT → "No apta"** en el indicador (ya queda fuera de servidas por su categoría `cut`). Sin columna de
   flag; el badge deriva `no apta` cuando `is_cut`. ✅
5. **Inseminación = hembra + apta**, fix **client-side** para el MVP. El **guard server-side** (rechazar
   servicio/inseminación sobre macho, defensa en profundidad, sería Gate 1) → **backlog**. ✅
6. **Fallback de edad** (vaquillona ≥365 d sin veredicto → servida) se **mantiene** tal cual (campos que no
   tactean aptitud). ✅

**Edge cases resueltos:**
- **Vaquillona apta → servida → vacía**: el badge transiciona `Apta` → (post-servicio sin tacto) `Servida sin
  tacto` → (post-tacto) `Vacía`/`Preñada`. Secuencial, un solo slot.
- **Diferida → apta a mitad de ventana** (tacto real, o compra/alta de una apta): entra a servidas **en vivo**
  — `0105` ya lo hace (función sobre estado actual). ✅
- **Un-CUT**: vuelve a su aptitud derivada (categoría/eventos actuales); el badge refleja el estado vigente.
- **`no_apta` ≠ CUT automático**: son ejes distintos (`no_apta` = reproductivo; CUT = descarte). Raf: una
  hembra grande no apta "**debería** marcarse CUT" = sugerencia al operario, **no** automático. (Posible
  afordancia futura: ofrecer "marcar CUT" desde una hembra `no_apta` — no en este delta.)

## Pendientes (CONTEXT/07)
- Ninguno nuevo bloqueante. (El guard server-side de macho queda en `docs/backlog.md`.)

## Insumos para spec_author
- **As-built a respetar**: `0105_repro_denominator.sql` (`rodeo_serviced_females` — NO tocar el denominador),
  `0053_tacto_vaquillona.sql` (enum `heifer_fitness`), `app/src/utils/maneuver-applicability.ts`
  (`appliesToAnimal`), `app/app/crear-animal.tsx` (Step3 categoría + Step4 datos + post-create soft-fail),
  `app/app/maniobra/_components/TactoVaquillonaStep.tsx` (UI a reusar para el prompt del alta),
  `app/src/utils/cut-eligibility.ts`, el espejo de categoría de C6 (patrón para el espejo de aptitud).
- **Specs relacionadas**: spec 02 (`requirements-puesta-en-servicio.md` RPS.5/RPS.6 — aptitud es elegibilidad,
  NO categoría; modelo de categorías), spec 03 (R6.2/R6.3 tacto + inseminación), spec 07 (denominador, done).
- **ADRs**: ADR-021 (gating de data por rodeo), ADR-028 (delta-spec), ADR-008 (categorías).
- **Migración**: se estima **sin migración** → **Gate 1 N/A**. Si el diseño introduce cualquier trigger/
  constraint/RPC nuevo (ej. si el alta crea el evento server-side en vez de client post-create), re-evaluar
  Gate 1 puntual. El espejo client-side y el fix de aplicabilidad son frontend puro.

## Aprobación
- ⏸ **Puerta 0 — pendiente (Raf).** Fecha: ____. Aprobado por: ____.
