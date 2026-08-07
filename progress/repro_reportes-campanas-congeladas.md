# Reproducción del defecto «los reportes de campañas pasadas se recalculan solos»

> Evidencia empírica del paso 1 de la §7 del handoff. **Ejecutado contra la DB de DEV**
> (`xrhlxxdnfzvdnztacofj`), 2026-08-07, con fixtures propias creadas y borradas en la misma corrida.
> No es una lectura del SQL: son las salidas de las RPC reales.
>
> Método: dos probes standalone (scratchpad, no quedan en el repo) con el patrón de fixtures de
> `supabase/tests/reports/run.cjs` — usuario de test real, JWT real, RPC llamadas por PostgREST como
> `authenticated` (o sea, pasando por el guard `has_role_in`). Sustento del **ADR-032**.

---

## Probe 1 — las cuatro mutaciones

**Escenario**: campo nuevo, rodeo de cría con `service_months = {6,7}` (servicio jun-jul), 3 multíparas
activas, las 3 con **tacto preñada** el 2025-09-15, la vaca B con **parto** el 2026-03-15
(concepción 2025-06 → campaña 2025).

### T0 — el reporte de la campaña 2025, "el que el productor imprimió"

```
serviced_females         natural,natural,natural (n=3)
denominator              {"serviced":3,"retired":0,"entoradas":3}
rodeo_pregnancy_kpi      {"is_configured":true,"serviced":3,"entoradas":3,"pregnant":3,"empty":0}
rodeo_calving_kpi        {"serviced":3,"pregnant":3,"calved":1,"status":"ok","pending_pregnant":2}
rodeo_ccl_distribution   {"n_months":2,"head":3,"body":0,"tail":0,"total":3}
rodeo_calving_by_stage   {"n_months":2,"head_born":1,"body_born":0,"tail_born":0,"total_born":1}
rodeo_weaning_kpi        {"serviced":3,"weaned":0,"pending_weaning":1,"status":"not_weaning_season"}
```

### T0-bis — el mismo pedido, pero para **2020**

Año en el que el campo no existía y sin un solo evento cargado:

```
serviced_females         natural,natural,natural (n=3)
rodeo_pregnancy_kpi      {"is_configured":true,"serviced":3,"entoradas":3,"pregnant":3,"empty":0}
```

**Idéntico a 2025.** Para un rodeo de servicio natural puro, `p_year` no cambia nada salvo la rama de IA y
los partos: no hay campañas, hay una sola foto de hoy replicada en todos los años.

### T1 — se carga un tacto **vacío fechado en 2026** sobre la vaca A

Se vuelve a pedir el KPI de **2025**. Cambian **3** de los 7 reportes:

```
rodeo_pregnancy_kpi     pregnant 3 → 2   ·   empty 0 → 1        (100 % → 67 % de preñez en 2025)
rodeo_calving_kpi       pregnant 3 → 2   ·   pending_pregnant 2 → 1
rodeo_ccl_distribution  head 3 → 2       ·   total 3 → 2
```

### T2 — se **vende** la vaca B (`status='sold'`, con `exit_date`)

Cambian **7** campos. La venta no solo saca del denominador: también borra su parto del numerador.

```
serviced_females        n=3 → n=2
denominator             serviced 3 → 2   ·   retired 0 → 0   ·   entoradas 3 → 2
rodeo_pregnancy_kpi     serviced 3 → 2   ·   pregnant 2 → 1
rodeo_calving_kpi       calved 1 → 0
rodeo_calving_by_stage  total_born 1 → 0
rodeo_weaning_kpi       serviced 3 → 2   ·   pending_weaning 1 → 0
```

### T3 — se **mueve** la vaca C a otro rodeo del mismo campo

KPI **2025** del rodeo que la tuvo todo 2025:

```
serviced 2 → 1   ·   pregnant 1 → 0   ·   ccl total 1 → 0
```

Y el KPI **2025 del rodeo destino** —que en 2025 no la tuvo— devuelve:

```
{"serviced":1,"entoradas":1,"pregnant":1,"empty":0}
```

**La historia migra de rodeo con el animal.** Un rodeo hereda tactos de campañas en las que no participó.

### T4 — cambio de categoría (multípara → vaquillona)

**Sin cambios.** No porque el mecanismo no exista, sino porque esa vaquillona cae en el **fallback por edad**
de `rodeo_serviced_females` (`0105:136-142`) y sigue siendo elegible. El probe 2 cierra el punto.

### Neto del probe 1

| mutación | campos del reporte 2025 que cambiaron |
|---|---|
| tacto de la campaña siguiente | 3 |
| venta | 7 |
| transferencia de rodeo | 6 |

```
KPI 2025 inicial : serviced 3, pregnant 3      →   100 % de preñez
KPI 2025 final   : serviced 1, pregnant 0      →     0 % de preñez
```

Ninguna de las tres acciones es un error del usuario. Son las tres cosas que un campo de cría hace todos
los años.

---

## Probe 2 — categoría, y el `retired` que nunca resta

### (A) El cambio de categoría **sí** reescribe el pasado

Mismo escenario, 2 vientres tactados preñados en sep-2025 (una multípara, una vaquillona que entra por el
fallback por edad):

```
T0  multípara + vaquillona            kpi={"serviced":2,"pregnant":2}   denom={"serviced":2,"retired":0}
T1  la multípara pasa a CUT           kpi={"serviced":1,"pregnant":1}   ¿cambió 2025? SÍ
T2  la vaquillona recibe un
    NO_APTA fechado en 2026           kpi={"serviced":0,"pregnant":0}   ¿cambió 2025? SÍ
```

En T2 la campaña 2025 no cambia de número: **desaparece** (`serviced: 0` → la UI muestra "—"). Un veredicto
de aptitud de la campaña **siguiente** borra a la vaquillona de la campaña anterior en la que sí se sirvió
y se preñó.

### (B) `entoradas = servidas − retiradas` nunca resta nada en cría natural

```
T3  1 vientre activo                  kpi={"serviced":1,"pregnant":1}   denom={"serviced":1,"retired":0}
T4  se vende                          kpi={"serviced":0,"pregnant":0}   denom={"serviced":0,"retired":0}
```

`serviced` baja y `retired` **se queda en 0**. Causa: `rodeo_repro_denominator` (`0105:207-210`) cuenta las
retiradas *sobre el conjunto servidas*, pero la rama natural ya filtra `status='active'` (`0105:122`) → la
vendida nunca entra al conjunto, así que nunca puede contarse como retirada. El comentario de `0105:187-189`
que justifica el diseño solo es cierto para la rama de **IA**.

**Es un defecto distinto** al de este ADR: el número está mal **hoy**, no solo en el pasado. Va a
`docs/backlog.md`, no a esta spec.

---

## Lo que se cerró de la §9 del handoff («no verificado»)

| pregunta | respuesta, verificada |
|---|---|
| ¿Hay historia de `status` recuperable? | **No hay tabla de historia.** El audit de spec 18 (`0124`) tiene **un solo** trigger `audit_i_u_d` y está sobre `user_roles` (consultado en `pg_trigger` de DEV); además su retención es de 90 días. **Pero sí hay un sustituto de un salto**: `animal_profiles.exit_date` + `exit_reason`, y la RPC `exit_animal_profile` (0044) recibe `p_exit_date` como **parámetro sin default** → toda baja lo escribe. En DEV: **21 de 21** perfiles no-activos lo tienen poblado. No está protegido por constraint ni trigger — es una convención del flujo de baja, no un invariante de la DB. |
| ¿Las otras RPC tienen la misma forma del defecto? | **Sí, las 4 con `p_year`**, medido: `rodeo_calving_kpi`, `rodeo_ccl_distribution`, `rodeo_calving_by_stage` y **`rodeo_weaning_kpi`** — esta última (`0118`) **no estaba en el inventario del handoff**. Todas heredan el defecto por el denominador común `rodeo_serviced_females`, y las que reimplementan el "último tacto" heredan además el numerador sin fecha. |
| ¿Las RPC sin `p_year` están afectadas? | **No.** `session_event_summary`, `rodeo_sessions_list`, `rodeo_weight_by_category`, `establishment_overdue_doses` y `establishment_unweighed` trabajan sobre el presente por diseño (alertas y estado actual). Correcto que lo hagan. |
| ¿Cuántas campañas cerradas hay contaminadas, y dónde? | **Una sola, en un solo campo**: "La Facundina" (el demo de Facundo), 2 rodeos (`Servicio Invierno {6,7,8}` y `Servicio Primavera {10,11,12}`) con tactos de 2025 **y** 2026. Todos los demás rodeos con datos tienen eventos de un único año (2026) o son fixtures de suites. **Ningún cliente productivo con histórico.** |

### Historia disponible para reconstruir, por dimensión

| dimensión | ¿reconstruible hacia atrás? |
|---|---|
| fecha del tacto (numerador) | **sí**, `reproductive_events.event_date` ya está — es un filtro que falta |
| estado / baja | **sí**, `exit_date` (21/21 poblado) |
| categoría | **sí**, `animal_category_history` (0030): `from_category_id` / `to_category_id` / `changed_at` |
| **membresía de rodeo** | **NO.** `moveAnimalToRodeo` (`app/src/services/animals.ts:1683`) es un UPDATE plano de `rodeo_id`, sin evento ni fila de historia. Y el rodeo es la llave de partición de **todo** reporte. |

---

## Entorno

- `node scripts/check.mjs` → **RC=0** al arrancar la sesión.
- Los dos probes limpian sus fixtures (usuarios, establecimiento, animales, eventos) en el `finally`;
  verificado `cleanup ok` en ambas corridas.
- **No se tocó** ningún dato preexistente de DEV. Las mutaciones (venta, transferencia, cambio de categoría)
  se aplicaron **solo** sobre los animales creados por el probe.
