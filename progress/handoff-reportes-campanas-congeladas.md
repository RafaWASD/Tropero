# HANDOFF — Los reportes de campañas pasadas se recalculan solos, y tienen que ser una foto

> ## ✅ CONSUMIDO (2026-08-07)
>
> Este handoff se tomó y se cerró. **No arranques desde acá**: arrancá desde
> [`docs/adr/ADR-032-campanas-cerradas-foto-inmutable.md`](../docs/adr/ADR-032-campanas-cerradas-foto-inmutable.md)
> (la decisión) y desde [`repro_reportes-campanas-congeladas.md`](repro_reportes-campanas-congeladas.md)
> (la evidencia empírica).
>
> El paso 1 de la §7 se cumplió: **el defecto está reproducido en la DB de DEV**, y salió más ancho que
> este documento. Las 3 preguntas de la §5 **están respondidas por Raf**. Lo que queda es la delta-spec.
>
> **Lo que este documento dice y la reproducción corrigió** — leelo con estas correcciones puestas:
> - la §6 lista 9 RPC: son **10**. Falta `rodeo_weaning_kpi` (`0118`), que tiene el mismo defecto.
> - la §2 dice que el año "no acota" el denominador natural. Es más fuerte: **el año es decorativo** — el
>   KPI de un año sin ningún evento devuelve el mismo número que el año con datos.
> - la §3 concluye que hacia atrás "no se puede reconstruir". Se puede **3 de 4**: fecha del tacto,
>   `exit_date` (21/21 poblado) y `animal_category_history`. La que falta es la membresía de rodeo.
> - la §3 marca la historia de `status` como NO VERIFICADA: **verificada**. No hay tabla de historia y el
>   audit de spec 18 cubre solo `user_roles` con 90 días de retención, pero `exit_date` la sustituye.
> - la §5 pregunta 3 sobre el fin de campaña con `service_months`: el problema real es peor y es
>   independiente del wrap — **una campaña sigue generando hechos hasta ~17 meses después del servicio**,
>   así que ninguna fecha del almanaque sirve como disparador.
> - la §9 pregunta cuántas campañas contaminadas hay: **una sola**, en La Facundina (el campo demo).

> **Para quién**: la terminal que tome el tema de reportes/campañas. **Autosuficiente**: no hace falta la
> conversación donde salió. Todo lo verificado está con `archivo:línea`; todo lo no verificado está marcado.
> **Escrito**: 2026-08-07, en una sesión saturada de Bluetooth y QA, a pedido de Raf, para sacarlo de ahí.

---

## 1. La decisión de producto (esto NO se re-discute)

Raf, 2026-08-07, textual:

> *"Los reportes de años anteriores son una foto de lo que pasó cuando se cerró la campaña e inició la nueva.
> No debería cambiar ningún reporte de 2025 luego de finalizar 2025; a partir del 1ro de enero de 2026 los
> reportes de 2025 se frizan y no se recalculan ni con ventas ni con nuevos datos sobre esas vacas ni con
> nada. Es muy importante que quede bien guardado todo para benchmarkings y comparativas año a año. Tenemos
> que tener los datos de esas campañas previas perfectamente guardados para luego comparar en el futuro y
> poder llegar a conclusiones y por qués de los cambios ya sean mejoras o empeoras."*

**Por qué importa más que un bug común**: el benchmarking es uno de los **tres pilares** del producto
(`CONTEXT/01-producto.md`). Los bugs de datos que el QA encontró son *datos que no llegan* — visibles y
finitos. Esto es distinto: **los números están, son creíbles, y cambian solos.** Un productor que compara la
preñez 2024 vs 2025 para decidir si le sirvió cambiar de toro está comparando dos consultas sobre el estado
de HOY, no dos campañas — y va a sacar una conclusión sobre un cambio que en parte no ocurrió.

**Con esta decisión, el comportamiento actual deja de ser una simplificación defendible de MVP y pasa a ser
un defecto.** Antes de la decisión era discutible; ahora no.

---

## 2. Qué encontré, leído en el SQL

Origen: el `spec_author` del delta `ficha-categoria-tacto` (spec 02) verificó si un tacto **sin jornada**
aparece en los reportes. **Sí aparece** — ninguna función de reporte referencia `session_id`. Ese camino
destapó lo de abajo. El leader después leyó el SQL completo y **el problema resultó más ancho que el primer
reporte** (la primera versión de la entrada de backlog estaba subestimada y quedó corregida).

### 2.1 El numerador ignora la fecha

`supabase/migrations/0106_reports_rpcs.sql`, `rodeo_pregnancy_kpi` (desde la línea 216):

```sql
with last_tacto as (
  select distinct on (t.animal_profile_id)
         t.animal_profile_id, t.pregnancy_status, t.event_date, t.created_at
  from public.rodeo_serviced_females(p_rodeo_id, p_year) s
  join public.reproductive_events t on t.animal_profile_id = s.animal_profile_id
  where t.event_type = 'tacto' and t.deleted_at is null
  order by t.animal_profile_id, t.event_date desc, t.created_at desc
)
```

**No hay ningún filtro por fecha sobre `t`.** Toma el último tacto del animal en toda su historia.
Un tacto de 2026 reescribe el %preñez de 2025.

### 2.2 El denominador es peor: solo una de sus dos ramas usa el año

`supabase/migrations/0105_repro_denominator.sql`, `rodeo_serviced_females(p_rodeo_id, p_year)`:

- **`ai_females`** (inseminación) **SÍ** acota: `extract(year from rv.event_date)::int = p_year`.
- **`eligible_natural`** (servicio natural) **NO usa `p_year` en ningún lado**. Filtra por:
  - `p.rodeo_id = p_rodeo_id` → el rodeo **actual** del animal
  - `p.status = 'active'` → su estado **actual**
  - `c.code in (...)` → su categoría **actual**
  - vaquillonas: el **último** `tacto_vaquillona = 'apta'` (sin límite de fecha), **o** `birth_date` contra
    **`current_date`** (umbral 365 días)

**Entonces "las servidas de 2025" no es *quiénes se sirvieron en 2025*: es *quiénes serían elegibles hoy*.**
El parámetro `p_year` solo mueve la rama de IA.

### 2.3 Consecuencias concretas

| acción | efecto sobre reportes YA CERRADOS |
|---|---|
| vender una vaca (`status` deja de ser `active`) | **desaparece del denominador de TODAS las campañas pasadas** |
| moverla de rodeo (transferencia) | se lleva su historia al rodeo nuevo y se la quita al viejo |
| cargarle un tacto nuevo | la reclasifica en campañas viejas (§2.1) |
| que cambie de categoría | puede entrar o salir de `eligible_natural` retroactivamente |

En **cría**, donde casi toda vaca se sirve todos los años, esto reescribe el histórico casi entero apenas
arranca la campaña siguiente.

**Y nada se lo dice al productor.** El reporte que imprimió el año pasado y el que abre hoy difieren, sin
explicación a la vista.

---

## 3. Lo que se puede y lo que NO — esto decide el diseño

**Verificado, no supuesto:**

| | |
|---|---|
| `animal_category_history` | ✅ **EXISTE** (`supabase/migrations/0030_animal_category_history.sql`), con fecha y `category_change_reason` |
| historia de membresía de rodeo | ❌ **NO EXISTE.** El propio código lo documenta en `0105_repro_denominator.sql:89-90`: *"El historial de membresía por fecha NO se modela en MVP (no hay tabla de historia de `rodeo_id`; transferencia = UPDATE in-place, spec 11)"* |
| historia de `status` (activo/vendido/archivado) | ⚠️ **NO VERIFICADO.** Hay `animal_events` y una tabla `audit` (spec 18) — **hay que mirarlo**, cambia el alcance de lo reconstruible |
| concepto de "cerrar campaña" | ❌ **NO EXISTE** nada en el árbol |

### Conclusión dura

**Hacia adelante se puede congelar.** Es viable y es el camino.

**Hacia atrás, no del todo.** Para los animales que ya cambiaron de rodeo o se vendieron, el dato de dónde
estaban **se perdió**. Se puede congelar *el número que la consulta devuelve hoy* —al menos deja de moverse—
pero **ese número ya está contaminado por el estado actual**: no es la foto de lo que pasó, es la foto de lo
que la app cree hoy que pasó. Quien tome esto tiene que decirlo explícitamente y no vender una foto que no lo es.

---

## 4. Arruga: la campaña NO es el año calendario

Raf dijo *"a partir del 1ro de enero de 2026"*, pero el rodeo tiene **`service_months`** y el código maneja
explícitamente el **wrap de fin de año** (`0106`, cabecera: *"Wrap de fin de año por set-membership (mes ∈
service_months), no BETWEEN (R7.5.8)"*). Un rodeo que sirve de noviembre a febrero tiene una campaña que
cruza el almanaque.

**"Cuándo se cierra 2025" depende del rodeo, no del calendario.** Definirlo probablemente requiera a Facundo
(ver `CONTEXT/07-pendientes.md`).

---

## 5. Preguntas abiertas para Raf (bloquean el ADR)

1. **¿El cierre lo dispara el productor o es automático?** (un botón "cerrar campaña" vs. un job por fecha)
2. **Las campañas ya pasadas**: ¿congelamos el número actual —imperfecto pero estable— o quedan marcadas
   como **no confiables** hasta que haya un cierre real?
3. **Derivada de §4**: ¿qué evento marca el fin de campaña de un rodeo con `service_months` que cruzan el año?

---

## 6. Superficie afectada — dónde mirar

**Migraciones** (leer en este orden):
- `supabase/migrations/0105_repro_denominator.sql` — `rodeo_serviced_females`, `rodeo_repro_denominator`,
  `rodeo_service_campaign`. **Acá está el núcleo del problema.**
- `supabase/migrations/0106_reports_rpcs.sql` — las 9 RPC de reportes. Su cabecera tiene el contrato de
  seguridad completo (Gate 1, §5.1-§5.10) que **hay que preservar** en cualquier rediseño.
- `supabase/migrations/0030_animal_category_history.sql` — la única historia que sí existe.
- `supabase/migrations/0104_compute_category_drop_service.sql` — `compute_category` RT2.7.5, la regla
  "tacto+ vigente" que `rodeo_pregnancy_kpi` espeja.

**Las 9 RPC** (de la cabecera de 0106) — las que llevan `p_year` son las afectadas:

| # | RPC | R |
|---|---|---|
| 3 | `rodeo_pregnancy_kpi(p_rodeo_id, p_year)` | R7.5 %preñez |
| 4 | `rodeo_calving_kpi(p_rodeo_id, p_year)` | R7.6 %parición |
| 5 | `rodeo_ccl_distribution(p_rodeo_id, p_year)` | R7.7 distribución CCL |
| 6 | `rodeo_calving_by_stage(p_rodeo_id, p_year)` | R7.8 cruce tacto↔nacimientos |

Las otras 5 (`session_event_summary`, `rodeo_sessions_list`, `rodeo_weight_by_category`,
`establishment_overdue_doses`, `establishment_unweighed`) **no** llevan `p_year`; hay que evaluar si tienen la
misma enfermedad por otra vía (las de alerta trabajan sobre el presente, que es correcto).

**UI**: `app/app/(tabs)/reportes.tsx` — `YearStepper` (:179), `useRodeoKpis(rodeoId, year)` (:105),
`defaultCampaignYear`. Ahí es donde habría que comunicar "campaña cerrada / foto" vs "en curso".

**Specs**: `specs/active/07-reportes-basicos/` (la feature está **done**: modelo reproductivo completo,
streams A+B+C cerrados el 2026-06-24). El cambio es un **delta** sobre una feature cerrada — ojo con la regla
de confirmar antes de tocar `specs/done/`.

---

## 7. Instrucciones para re-analizar (pasos concretos)

1. **Reproducir el defecto antes de diseñar nada.** No alcanza con leer el SQL. Armá el escenario en la DB de
   DEV: una vaca servida y tactada preñada en la campaña N; después cargale un tacto vacío en N+1 y
   **volvé a pedir el KPI de N**. Y por separado: marcá una vaca como vendida y volvé a pedir el KPI de N.
   **Los dos números tienen que moverse.** Si no se mueven, algo de este análisis está mal y hay que
   entender qué antes de seguir.
2. **Cerrar el punto NO VERIFICADO de §3**: ¿hay historia de `status`? Mirá `animal_events`, la tabla `audit`
   (spec 18) y `spec 10 / operaciones-rodeo` (bajas). De eso depende cuánto del pasado es reconstruible.
3. **Recién ahí, decidir el mecanismo.** Dos familias, y conviene elegir con la evidencia de (1) y (2):
   - **Snapshot al cierre**: persistir los resultados (y los hechos por animal que los sustentan) en una
     tabla nueva. Simple, cumple "se frizan", y no depende de historia que no existe. Contra: hay que definir
     el cierre, y lo ya pasado queda con el número contaminado.
   - **Reconstrucción histórica**: acotar cada query por fecha y reconstruir el estado del animal en la
     campaña. Más fiel, pero **hoy es imposible** para membresía de rodeo (§3) — requiere agregar esa historia
     primero, y aun así no arregla el pasado.
   La recomendación del leader es **snapshot**, por (§3): no se puede reconstruir lo que no se guardó.
4. **Preservar el contrato de seguridad.** Cualquier RPC nueva o modificada tiene que mantener §5.1-§5.10 de
   la cabecera de `0106` (guard `has_role_in` fail-closed como primera sentencia, `SECURITY DEFINER STABLE
   set search_path`, cota de `p_year`, tenant por el JOIN a `animal_profiles`, etc.). Toca DB → **Gate 1**.
5. **Escribir el ADR ANTES de la spec.** Define cómo el producto trata la historia; toca modelo de datos y es
   la base de un pilar del producto. Se va a referenciar en 6 meses → ADR (regla de `CLAUDE.md`).
6. **No romper lo que ya está verificado**: un tacto **sin jornada** debe seguir apareciendo en los reportes
   (ninguna función referencia `session_id`; el delta `ficha-categoria-tacto` de spec 02 depende de eso y dejó
   tests en `supabase/tests/reports/run.cjs`).

---

## 8. Lo que YA está verificado — no lo repitas

- Ninguna función de reporte referencia `session_id` → un tacto suelto (sin jornada) **sí** entra a los KPIs.
- `animal_category_history` existe (0030).
- **No** existe historia de membresía de rodeo (`0105:89-90`, documentado por el propio código).
- **No** existe ningún concepto de cierre de campaña.
- `eligible_natural` no usa `p_year`; `ai_females` sí.
- El numerador de `rodeo_pregnancy_kpi` no filtra por fecha.

## 9. Lo que NO está verificado — hacelo vos

- Si hay historia de `status` (vendido/archivado) recuperable.
- Si `rodeo_calving_kpi`, `rodeo_ccl_distribution` y `rodeo_calving_by_stage` tienen **exactamente** la misma
  forma del defecto (lo asumí por simetría con `rodeo_pregnancy_kpi`; **no** leí sus cuerpos).
- Si las 5 RPC sin `p_year` tienen alguna variante del problema.
- Cuántas campañas cerradas hay hoy con datos ya contaminados, y en qué establecimientos.

---

## 10. Contexto de la sesión donde salió

Entrada de backlog con el mismo contenido: `docs/backlog.md`, *"2026-08-07 — 🔴 Los reportes de campañas
pasadas se recalculan solos, y tienen que ser una FOTO"*. Commit `f897fed`.

Este handoff sale de una sesión dedicada a Bluetooth y QA de maniobras; el tema apareció de costado y se
sacó para no mezclarlo. Ver también `progress/qa_maniobras-device.md` (campaña de QA en device, 6 hallazgos
🔴 sin relación con esto) y `CONTEXT/07-pendientes.md` (preguntas abiertas para Facundo, incluidos los
mínimos etarios).
