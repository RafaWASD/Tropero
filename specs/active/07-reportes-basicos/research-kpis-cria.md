# Investigación: catálogo de KPIs de cría bovina (Argentina) — insumo para spec 07

> Reporte de dominio CON FUENTES para blindar la feature de reportes/analytics. Generado por research agent (2026-06-22), validado adversarialmente contra fuentes oficiales (INTA, AACREA, IPCVA, facultades de veterinaria). Insumo pre-spec, no es la spec.
>
> **Cada indicador**: definición, fórmula (numerador/denominador), benchmark argentino con fuente, y veredicto de **computabilidad** contra el modelo as-built (`reproductive_events`, `weight_events`, `sanitary_events`, `condition_score_events`, `scrotal_measurements`, `animal_events`; catálogo de categorías + `compute_category()`; `sessions`; config de meses de servicio por rodeo).

## Convención metodológica nuclear (Bavera, FAV UNRC)

Todos los porcentajes pueden calcularse sobre **distintos denominadores** (entoradas, palpadas, preñadas, paridas) y *siempre hay que aclarar cuál*. *"Lo más exacto es tomarlos a todos sobre las vacas entoradas, ya que lo estamos refiriendo al capital que pusimos en producción, y es la única forma en que podemos comparar y sumar las distintas pérdidas."*

→ **Recomendación para la spec: mostrar el denominador explícito en cada KPI** (toggle "sobre entoradas / preñadas / paridas" = práctica de campo correcta).

> **"Vacas entoradas"** = *"las que entraron en servicio menos las retiradas de servicio"* (retiradas = vendidas/consumo/invernada durante el servicio). NO es "todas las hembras del rodeo".

## 1. Reproductivos

- **% Preñez** — `preñadas / palpadas` o `preñadas / entoradas × 100`. Benchmark AR: nacional ≈ **82,4%** (Monitoreo INTA); con estacionamiento **>85%**; vaquillonas 90-96%. **Computable: SÍ, directo** (último tacto con `pregnancy_status≠empty` sin aborto posterior / hembras activas).
- **Distribución cabeza/cuerpo/cola** — `n_preñadas_en_tercio / total_preñadas × 100`. **Cabeza = preñez más avanzada = concebida primero** (pare temprano, mejor alimentación invernal); cola = chica/concebida último. Hallazgo fuerte (Bavera): **dos rodeos con idéntico %preñez (63,3%) pueden tener problemas OPUESTOS** (mala nutrición vs venérea) y solo la *distribución* lo revela → *"el dato de preñez total tiene poca relevancia para tomar decisiones"*. Objetivo: **cabeza >60%**. **Computable: SÍ, mapea 1:1** con `pregnancy_status` small/medium/large = cola/cuerpo/cabeza. **Recomendación: AL MVP** (alto ROI, prácticamente gratis; la spec hoy no lo lista explícito).
- **% Pérdidas a la preñez** — `(entoradas − preñadas)/entoradas` ≡ `100 − %preñez`. **Computable: SÍ, derivado.**
- **% Parición** — `paridas / entoradas` (o `/preñadas` para medir pérdida preñez→parición). Coincide con la def de Facundo (paridas/servidas). **Computable: SÍ**, con la salvedad de que num. y den. deben ser de la **misma campaña** (offset gestación ~283-285 d; lo resuelve `service_months` por rodeo).
- **Tasa de pérdidas preñez→parición / abortos** — `(preñadas − paridas)/entoradas`. Aceptable ≈ **2%** (>2-3% → sospechar aborto/venérea). **Computable: SÍ derivado**; separar aborto explícito necesita `event_type='abortion'`/marcador (dato extra).
- **Pérdidas peri/posnatales (predestete)** — perinatal 2-4%, posnatal 1-2%; total preñez→destete 5-9% (bien manejado <5%). **Computable: NO sin evento de muerte de ternero con fecha** (gap).
- **% Destete (KPI REY)** — `terneros destetados / entoradas` (o /paridas /preñadas). *"La productividad de un rodeo de cría se mide por este %, no por preñez ni parición"* (Bavera). Benchmark AR: nacional ≈ **63%** (estancado 60-63% hace 10 años), **meta INTA 68%** (*"del 63 al 68% más que duplica la exportación"*); Cuenca del Salado hasta 72%; mínimo de gestión = destetar **85% de las preñadas**. Coincide con la def de Facundo (weaning/terneros). **Computable: SÍ** (tendencia ⇒ histórico multi-año).
- **Índice destete / vaca entorada** — = %destete sobre entoradas. **Computable: SÍ.**
- **Intervalo Entre Partos (IEP)** — días entre 2 partos; objetivo **365 d** (abiertos ≤80 + gestación ~283). **Computable: SÍ pero requiere ≥2 partos/animal** (gap año 1).
- **% vaquillonas preñadas (1er servicio)** — `vaq. preñadas / vaq. entoradas`. Objetivo **>85-90%**. Práctica: entorar 30-50% más y quedarse con las de cabeza. **Computable: SÍ** (filtrado por categoría vaquillona).
- **Tasa de repetición (fallada recurrente)** — vacías en servicios consecutivos (criterio de refugo). **Computable: PARCIAL, requiere histórico multi-año.**

## 2. Productivos / peso

- **Peso al destete** — Benchmark AR **150-180 kg** pastoril. **Computable: SÍ.**
- **GDP (ganancia diaria)** — `(peso_final−peso_inicial)/días`. Recría tradicional 300-350 g/d; objetivo recría de reposición **~500 g/d**. **Computable: SÍ con ≥2 pesadas/animal.**
- **Peso/edad de entore de vaquillonas** — entore precoz (15 m, mín 13) umbral **65% del peso adulto** (≈260-270 kg Angus/cruzas); INTA Mercedes sostiene **75%** para cruzas índicas subtropicales. Pelvis >140 cm² (precoz)/>190 cm² (general), frame 3-5. **Computable: peso SÍ; % necesita peso adulto objetivo por raza (dato extra); pelvimetría/RTS/frame NO están en el modelo.**
- **Kg de ternero destetado / vaca entorada** — `Σ kg destete / entoradas`. Ej. canónico 148,5 kg/vaca. Mejor proxy físico-económico (combina %destete × peso destete). **Computable: SÍ.**
- **Kg de carne / ha** — Benchmark ≈ 157 kg/ha (ciclo completo). **Computable: NO sin superficie (ha).**

## 3. Estructura de rodeo

- **Composición / pirámide de categorías** — `COUNT GROUP BY category_id`. **Computable: SÍ, directo, alto valor visual.**
- **Relación toro:vaca** — **3-4% de toros**. **Computable: SÍ.**
- **% de reposición** — ~**20%** anual. **Computable: PARCIAL, requiere histórico.**
- **Tasa de descarte/refugo (incl. CUT)** — CUT = "Cría Último Ternero" (vacas viejas <1/4-1/2 diente). Selección anual **5-12%** del rodeo; vida útil ~9-10 años. **Computable: SÍ parcial** (dientes + categoría CUT existen; tasa anual ⇒ histórico).

## 4. Sanitarios

- **Cobertura de vacunación** — `vacunados con X / objetivo × 100`; objetivo 100% para obligatorias (aftosa/brucelosis). **Computable: SÍ.**
- **Próxima dosis vencida (alerta)** — `next_dose_date < hoy` sin dosis posterior. **Computable: SÍ** (ya confirmada por Facundo).
- **Mortandad** — **NO sin evento de muerte** (mismo gap que pérdidas peri/posnatales).

## 5. Económicos (alto nivel)

Margen bruto $/ha, kg/ha, carga animal → **NO computables sin superficie + costos/precios** (post-MVP). Único proxy económico "gratis": **kg ternero/vaca entorada** (§2.4).

## 6. Validación adversarial de los números del vet

| Afirmación | Veredicto | Matiz |
|---|---|---|
| Gestación = 284 d | ✅ correcto como cifra de trabajo | Es **por raza**: Angus 278, Hereford 285, Charolais 286, Brahman 292 (media europea 283). 284 cae entre Angus/Hereford (británicas dominantes en AR). **Recomendación: default 283-285 configurable por raza, no constante universal.** |
| Vaquillonas ~66% peso adulto pre-1er servicio | ✅ correcto | Canónico INTA = **65%** (Campero). INTA Mercedes: **75%** para cruzas índicas subtropicales (fertilidad sostenida). No es contradicción: 65% = umbral pubertad templado; 75% = óptimo subtropical. **Parametrizar por raza/región.** |
| Servicio primavera Oct-Dic ~90 d; otoño minoritario | ✅ correcto | 90 d estándar (60 en vaquillonas, 4 ciclos de 21 d). *"Dos servicios anuales: planillas separadas"* (Bavera) → **valida config de meses de servicio por rodeo/lote, no por establecimiento.** |
| Tacto cabeza/cuerpo/cola = tercios; cabeza = más avanzada/concebida primero | ✅ correcto | Mapea 1:1 con `pregnancy_status` large/medium/small. |
| Aptitud reproductiva (RTS, pelvimetría, peso) | ✅ correcto y bien fundado | RTS escala 1-5/1-3; pelvis >140/>190 cm². **Caveat: peso computable; RTS/pelvimetría/frame NO están en el modelo** (`scrotal_measurements` es del macho) → custom o schema nuevo, probablemente fuera de MVP. |

## 7. Tabla maestra de computabilidad

| KPI | Hoy | Dato extra |
|---|---|---|
| % preñez (total + vaquillonas) | ✅ | — |
| **Distribución cabeza/cuerpo/cola** | ✅ | — *(recomendado MVP)* |
| % pérdidas a la preñez | ✅ | — |
| % parición | ✅ | ventana de campaña (resuelta con `service_months`) |
| % destete + índice destete/entorada | ✅ | tendencia ⇒ histórico |
| kg ternero / vaca entorada | ✅ | — |
| Peso al destete / por categoría | ✅ | — |
| GDP | ✅ | ≥2 pesadas/animal |
| Peso de entore vs objetivo | ⚠️ | **peso adulto objetivo por raza**; edad ⇒ fecha de nacimiento |
| Composición / pirámide | ✅ | — |
| Relación toro:vaca | ✅ | — |
| Cobertura de vacunación | ✅ | — |
| Próxima dosis vencida (alerta) | ✅ | — |
| Animales sin pesar (alerta) | ✅ | umbral (consulta Facundo) |
| CUT / refugo (conteo) | ✅ | tasa anual ⇒ histórico |
| IEP | ⚠️ | histórico multi-año (≥2 partos) |
| Repetición / reposición | ⚠️ | histórico multi-año |
| Pérdidas peri/posnatales, mortandad | ❌ | **evento de muerte de ternero con fecha** |
| kg/ha, carga, márgenes $ | ❌ | **superficie (ha)** + costos/precios |

**Tres gaps de datos para backlog/spec:** (1) **evento de muerte/mortalidad** con fecha+causa; (2) **peso adulto objetivo por raza** (config del catálogo de razas); (3) **superficie en ha** por rodeo/establecimiento. Adicional menor: **fecha de nacimiento** del animal para edades exactas. Los KPIs de tendencia/IEP/reposición/repetición se habilitan con **historia multi-año** → diseñar la UI para degradar con gracia el primer año.

## Notas accionables para la spec

1. **Sumar cabeza/cuerpo/cola al MVP** — gratis (`pregnancy_status` ya existe), único KPI que la literatura marca como *diagnóstico* (el %preñez total "tiene poca relevancia" sin la distribución). Es la "capa de inteligencia" que diferencia de los PDF estáticos del competidor.
2. **Mostrar el denominador explícito** en %preñez/parición/destete (toggle entoradas/preñadas/paridas).
3. **Parametrizar por raza** gestación (283-285 d) y peso adulto objetivo (66% templado / 75% subtropical) — no hardcodear.
4. **3 gaps de datos a backlog** (muerte de ternero, peso adulto por raza, superficie ha). Tendencia/IEP/reposición ⇒ degradar con gracia el año 1.

## Fuentes

INTA-Bavera (producción/pérdidas/porcentajes, gestación por raza, diagnóstico precoz cabeza/cuerpo/cola, CUT); INTA-Campero (selección de vaquillonas 65%, pelvimetría); INTA Mercedes-Sampedro (peso entore 75%); INTA Informa (índice destete 63%, meta 68%); Bavera FAV-UNRC; IPCVA; AACREA/CREA; SAGyP márgenes; Intagri (IEP 365). URLs completas en el reporte original del research agent (sesión 2026-06-22). Documentos clave en `produccion-animal.com.ar` (Bavera 33/18/32, Campero 61) e `intagri.com`.
