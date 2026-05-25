# ADR-005 — Identificación Flexible de Animales

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

La identificación de animales en Argentina vive un período de transición regulatoria:

- **Pre-julio 2026**: caravana visual (IDV) es lo dominante. TAG electrónico opcional.
- **Desde julio 2026** (SENASA): TAG electrónico **obligatorio** para todos los nacimientos
- **Cabañas y producción de élite**: identificación por tatuaje, marca a fuego, descripción detallada

Adicionalmente, hay productores pequeños con animales sin caravana visible, identificados solo por características descriptivas o señas particulares (color, defectos, hierro).

Si forzamos que todo animal tenga TAG electrónico, dejamos fuera a una porción significativa del mercado actual. Si forzamos IDV, dejamos fuera a productores tradicionales.

## Decisión

**Cada animal debe tener al menos UNA de tres formas de identificación**:

1. `tag_electronic` — chip RFID electrónico (estándar ISO 11784/11785). Único globalmente.
2. `idv` — caravana visual con código numérico. Único por establecimiento.
3. `visual_id_alt` — identificación alternativa libre (tatuaje, hierro, descripción tipo "vaca blanca con mancha negra en pata izquierda").

**Validación**: insertar un animal sin ninguno de los tres rechaza la operación.

**Prioridad de identificación al cargar maniobra**:
1. Si hay TAG escaneado por bastón → match por `tag_electronic`
2. Si no, usuario tipea IDV → match por `idv` dentro del establishment
3. Si no, usuario busca por `visual_id_alt` (búsqueda fuzzy)
4. Si no encuentra, opción de crear animal nuevo en el momento

## Alternativas consideradas

### Solo TAG electrónico obligatorio
- **Pros**: alineado con ley futura, datos limpios
- **Contras**: deja fuera mercado actual hasta julio 2026, deja fuera cabañas con tatuaje, deja fuera ganado pre-existente sin chip

### Solo IDV obligatorio
- **Pros**: refleja realidad actual del campo
- **Contras**: no se alinea con regulación SENASA 2026, fricción para productores que adoptan TAG temprano

### TAG O IDV (sin tercera opción)
- **Pros**: schema más simple
- **Contras**: deja fuera identificación por descripción (cabañas, productores tradicionales)

### Identificador único arbitrario (UUID interno) con todos los demás opcionales
- **Pros**: máxima flexibilidad
- **Contras**: usuario no puede buscar por nada en campo, fricción operativa inaceptable

## Consecuencias

**Positivas**:
- Cubre el 100% del mercado actual y futuro
- Migración gradual de productores: empiezan con IDV, suman TAG cuando obligan, mantienen continuidad
- Cabañas con tatuaje pueden usar el producto
- Productores muy chicos (10-20 cabezas) pueden usarlo sin invertir en hardware

**Negativas**:
- Validación más compleja (constraint check: al menos uno de tres)
- Búsqueda de animal requiere intentar múltiples columnas
- Riesgo de duplicación si un mismo animal se carga con dos identificaciones distintas en momentos distintos

**Mitigaciones**:
- UI sugiere completar TAG cuando existe (incentiva buena data)
- Reporte de "animales con identificación incompleta" para que el productor vaya completando
- Función de "consolidar duplicados" para resolver dobles cargas

**Notas de implementación**:
- `tag_electronic` único globalmente vía constraint
- `(establishment_id, idv)` único compuesto
- `visual_id_alt` libre, sin unicidad enforced
- Búsqueda fuzzy de `visual_id_alt` con índice GIN trigram en Postgres
