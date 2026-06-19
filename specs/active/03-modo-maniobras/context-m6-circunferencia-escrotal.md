# Gate 0 — Contexto: Circunferencia escrotal (spec 03, chunk M6)

> Refinamiento de contexto (ADR-022) de una **maniobra nueva** de MODO MANIOBRAS.
> Estado: **cerrado, pendiente OK de Raf** (2026-06-17). Al aprobarse → `spec_author` redacta requirements/design/tasks.

## 1. Qué es y para qué

**Circunferencia escrotal (CE)** del toro: medida central de **aptitud reproductiva** (componente del examen/BSE), en **centímetros**. Fuertemente correlacionada con la **edad** y con la producción espermática; mayor CE del padre → hijas púberes más temprano. Se mide ~3-4 veces a lo largo de la vida y después anualmente (destete → selección al sobreaño ~365 d → revisación pre-servicio → re-test por temporada de servicio). Pantalla **🔴 manga** (se carga en el brete): targets XL, una decisión, operable con una mano + guante.

## 2. Decisiones lockeadas (Gate 0)

1. **Aplicabilidad**: solo **toritos y toros ENTEROS** (machos sin castrar). Lee el estado de castración **actual** (`is_castrated`, denorm de spec 10 — reversible). Excluye ternero, novillito/novillo y cualquier castrado. Categoría `torito`/`toro` ∧ `is_castrated = false`.
   - Edge: castración **desconocida** → se trata como entero (incluir) — la aplicabilidad es UX, no seguridad; mostrar la maniobra no daña. A confirmar en spec si conviene fail-safe distinto.
2. **Edad en meses (acompaña a la CE, visible al lado del número)**: **auto + manual de respaldo**.
   - Animal con **fecha exacta** de nacimiento → se calcula sola.
   - Animal con solo **año** de nacimiento o sin fecha → **rueda manual de meses** en esa carga (el año solo daría ±12 meses, demasiado impreciso para esto).
   - La edad se guarda **congelada (snapshot)** con cada medida (registro puntual; no se recalcula después).
3. **Carga = solo el número** (CE en cm + edad). **NO** se clasifica apto/no-apto al cargar (ver §5, diferido). No setea ningún estado del animal.
4. **Histórico**: **tarjeta de tendencia en la ficha** del animal — serie de medidas (CE + edad en meses + fecha) + mini-tendencia. También aparece en el timeline de eventos.

## 3. Parámetros de la rueda (research-informed, confianza ALTA salvo nota)

- **UI = wheel picker inercial** (drum/barrel picker): scroll con momentum (fling rápido pasa muchos números, drag lento = precisión) + snap al valor + **tick háptico por número** (manga: operable sin mirar fijo). `ui_component` nuevo **"rueda"**, **factory-only** por ahora (generalizar a datos custom de M5 = opción futura, fuera de scope).
- **Rango**: **20–50 cm** (mín. real adultos ~26, piso jóvenes/anormales ~20-22, techo documentado ~48 → 50 con holgura; banda de trabajo 30-40).
- **Paso**: **0,5 cm** (superset: evaluación genética BIF/BREEDPLAN registra a 0,5 y permite redondear a entero para umbrales BSE).
- **Valor inicial**: centrado en la **última medida** del animal; si es la primera, en **~36 cm** (promedio toro maduro) — la spec puede afinar a un normal por edad.
- **Formato es-AR**: coma decimal — "36,5 cm".

## 4. Modelo de datos (lean — lo cierra el design)

- Tabla **typed nueva** `scrotal_measurements` (append-only, longitudinal): `animal_profile_id`, `session_id`, `circumference_cm` (numeric, CHECK rango), `age_months` (int snapshot, nullable si desconocida), `measured_at`, `recorded_by` (forzado por trigger), audit. Espeja el patrón de `weight_events`/`condition_score_events` (no el genérico de M5: la edad-acompañante + el seguimiento + futura clasificación quieren hogar tipado).
- **Gating capa 2**: data_key nuevo `circunferencia_escrotal` en el catálogo (`field_definitions`) + toggle por rodeo (`rodeo_data_config`) + trigger fail-closed (patrón `assert_data_keys_enabled`). Habilitado por defecto en el sistema **cría** (a confirmar con el seed).
- **Aplicabilidad per-animal** en `maneuver-applicability.ts` (`appliesToAnimal`): nueva regla `circunferencia_escrotal` → macho entero no-ternero.
- **Corrección** de una medida cargada = patrón R5.9 (UPDATE/split del as-built).
- **Offline-first**: CRUD-plano (INSERT local → sync). Sin RPC nueva si se puede.

## 5. Fuera de MVP (diferido a la capa de analytics/benchmarking)

La **clasificación apto/dudoso/bajo** (semáforo). El research la desaconseja al cargar porque:
- Es **ruidosa a edad joven** (CE temprana descarta toros buenos; ~50% de sobreaños "diferidos" terminan satisfactorios).
- **Depende de la raza**: Bos indicus (Brahman, Nelore) corre ~4-5 cm por debajo de Bos taurus a igual edad → una tabla única **sobre-rechaza** cebú.
- La CE sola es **screening**, no veredicto: el BSE real exige también semen (motilidad/morfología).

Cuando se construya esa capa:
- Modelo de **3 estados** (satisfactorio / a recontrolar / no satisfactorio), etiquetado **"screening de CE"**, no "aptitud reproductiva".
- Tabla de umbrales **configurable** por `(grupo racial, edad en meses)`, NO hardcodeada. Default Bos taurus = SFT (≤15→30, >15-18→31, >18-21→32, >21-24→33, >24→34 cm); columna Bos indicus (Brahman ACV 20/23/25/27/29/30); override AR/INTA (32@18, 33@24).
- `grupo_racial` (taurus/indicus/sintético) es **derivable de la raza del animal** (ya en spec 02) → no hace falta snapshotearlo en la medida en MVP.

## 6. Riesgos / pendientes

- **Números argentinos (INTA / produccion-animal) en confianza MEDIA**: salieron de extractos de búsqueda (WebFetch bloqueado, sin full-text). Antes de hardcodear umbrales AR (fase analytics), leer full-text `repositorio.inta.gob.ar/handle/20.500.12123/12793` + produccion-animal. **No bloquea M6** (la clasificación está diferida).
- Brangus/Braford (~3/8 indicus) se comportan cerca de taurus → el mapeo raza→grupo no es trivial; problema de la fase analytics, no de M6.

## 7. Gates y secuencia

1. **Gate 1 obligatorio** (security spec): toca schema (tabla nueva + data_key + gating capa 2 + RLS + sync rules).
2. **Design spike de la rueda** primero (UI nueva 🔴 manga, visual antes de plomería) → veto design-review del leader → mostrar a Raf.
3. Implementación (backend M6-BACKEND + cliente) → reviewer + Gate 2.
4. **Deploy a la DB compartida gateado por Raf** (tabla + data_key + sync rules de PowerSync).
