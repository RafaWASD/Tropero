# ADR-017 — Timeline append-only de eventos del animal (no nota plana sobreescribible)

**Status**: Accepted
**Fecha**: 2026-05-26
**Decisores**: Raf

## Contexto

A lo largo de la vida de un animal en RAFAQ, distintos usuarios capturan información sobre él: observaciones del peón en el campo ("la vaca 247 parió esta mañana"), eventos sanitarios del vet ("vacunación brucelosis, dosis 5cc"), registros reproductivos ("celo detectado", "tacto positivo cabeza", "parto"), movimientos de traslado ("pasó del rodeo de cría al rodeo de vaquillonas"), eventos de identificación ("agregada caravana electrónica"), pesajes en manga, y observaciones libres.

La pregunta arquitectónica abierta: ¿estos datos viven como un campo `comments: text` sobreescribible en la tabla `animals`, o como una **tabla aparte de eventos** con timestamp, autor y tipado?

Durante el discovery de BUSCAR ANIMAL (2026-05-26), Raf mencionó "permitir agregar comentarios" en la pantalla de edit del animal sin haber resuelto cuál es el modelo. El leader propuso explícitamente evaluar entre las dos opciones. Varios factores específicos de RAFAQ empujan hacia eventos estructurados:

1. **SENASA exige identificación electrónica individual y su declaración** desde el 1/1/2026 (Res. 530/2025 + 841/2025), base de la trazabilidad individual del bovino. Un historial granular y auditable es requisito regulatorio, no opcional. Si se empieza con nota plana, habrá que migrar y reconstruir cuando crezca la exigencia de trazabilidad.
2. **Multi-usuario con roles distintos**: el owner (productor), el vet, los peones (`field_operator`) y eventualmente el cliente vet con múltiples campos (post-MVP) dejan información con autoridad y propósito distintos. Que el peón sobreescriba lo que dejó el vet es un bug de producto, no una feature.
3. **Reproducción ganadera necesita consultar eventos meses después**: el vet marca "celo detectado el 5/3", y nueve meses más tarde, cuando esa vaca pare, alguien tiene que poder ir hacia atrás y verificar el ciclo. Una nota plana no preserva esa cronología.
4. **Pilar de analytics + benchmarking** del producto (uno de los 3 pilares en el posicionamiento, ver memoria `product_positioning`): requiere **eventos estructurados** que se puedan contar, filtrar y graficar. Texto libre suelto es invisible al motor de análisis.
5. **Alertas y recordatorios futuros** salen "gratis" si los eventos están tipados. Ejemplo: "hace 21 días esta vaca fue marcada sospechada preñada, programar tacto" se computa trivialmente sobre `animal_events` filtrando por `event_type = 'reproducción'` y `created_at < now() - interval '21 days'`. Sobre texto libre, ese feature requiere NLP o no existe.
6. **Audit trail nativo**: saber quién hizo qué cuándo es base de cualquier conversación con un cliente reclamando algo. Multi-tenant SaaS sin audit es deuda técnica desde el día 1.

El **costo** de la opción event-driven es schema y UI más complejos. El **costo** de la opción nota plana es deuda que se paga con interés cuando se agreguen los features que el contexto ya promete.

## Decisión

**Los comentarios y observaciones sobre un animal se modelan como `animal_events`, append-only, con tipado, autor, timestamp y payload estructurado opcional.**

Schema canónico (sujeto a refinamiento de detalle en spec 02):

```sql
create table public.animal_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_id          uuid not null references public.animals(id) on delete cascade,
  establishment_id   uuid not null references public.establishments(id) on delete cascade,  -- denormalizado para RLS performant
  author_id          uuid not null references public.users(id),                              -- quién creó el evento
  created_at         timestamptz not null default now(),
  event_type         text not null,                                                          -- enum: 'observacion' | 'salud' | 'reproduccion' | 'traslado' | 'pesaje' | 'identificacion' | 'otro'
  text               text,                                                                   -- libre, opcional según tipo
  structured_payload jsonb,                                                                  -- opcional, tipado según event_type
  edit_window_until  timestamptz not null default (now() + interval '15 minutes'),           -- autor puede corregir hasta acá; después congelado
  deleted_at         timestamptz                                                             -- soft-delete con misma política que el resto
);

create index animal_events_animal on public.animal_events (animal_id, created_at desc);
create index animal_events_author on public.animal_events (author_id, created_at desc);
create index animal_events_establishment on public.animal_events (establishment_id, created_at desc);
```

Reglas de comportamiento:

- **Append-only en intent**. Los eventos no se sobreescriben con el tiempo. El campo `edit_window_until` (sugerido 15 min) permite **correcciones honestas inmediatas** del autor (typos, retoque de payload, error obvio), pero pasada esa ventana, el evento queda congelado.
- **Soft-delete permitido pero auditable**. Un evento creado por error se puede marcar `deleted_at`, pero la fila permanece en DB. Política de visibilidad: queries normales filtran `deleted_at IS NULL` (consistente con el resto del sistema, ver decisiones de spec 01).
- **Tipos del enum reconocidos en MVP** (lista cerrada): `observacion`, `salud`, `reproduccion`, `traslado`, `pesaje`, `identificacion`, `otro`. Si en uso real aparece un tipo recurrente que no encaja, se agrega vía migration explícita — no se abre el enum a strings arbitrarios.
- **`structured_payload`** lleva los datos específicos del tipo cuando los hay: ej. evento `reproduccion` con `{ subtype: 'tacto', resultado: 'positivo', tamaño: 'cabeza' }`; evento `pesaje` con `{ peso_kg: 320, balanza: 'vesta-3516' }`. Para tipo `observacion` el payload puede estar vacío y solo se usa `text`.
- **RLS**: visibilidad de eventos sigue la regla del animal: si el usuario tiene rol activo en el establishment del animal, ve sus eventos. Mutaciones gated por rol (owner/operator/vet escriben; vet con rol en el establecimiento también escribe).

Reglas de UX (no parte del schema, pero acoplado):

- En la pantalla de edit del animal, **el timeline va como sección aparte abajo, scrollable, con botón "+ agregar evento"**. NO mezclar con los campos editables del animal (que sí son sobreescribibles, porque son atributos del animal en sí — peso, categoría, etc.).
- Al agregar un evento, la UI guía al usuario a elegir tipo primero, después renderiza el form específico de ese tipo (payload estructurado + texto opcional).
- Heurística para futuros datos: **si un dato se va a contar / filtrar / graficar después → campo o evento estructurado. Si es genuinamente observación humana sin schema → texto libre dentro de evento `observacion`.**

## Alternativas consideradas

### Campo `comments: text` sobreescribible en `animals`
- **Pros**: simple, una migración, UI trivial (textarea).
- **Contras**: viola los 6 factores del contexto. Pierde historial, no escala a multi-usuario, no audita, no soporta analytics, no soporta alertas futuras, no cumple SENASA. Falsa simplicidad que se paga después.

### Híbrido: timeline tipado + campo `current_notes: text` libre adicional
- **Pros**: deja al productor una "pizarra" de notas vigentes para el día a día.
- **Contras**: complejidad innecesaria. Una nota "vigente" no es distinta a un evento `observacion` con `text`, salvo que el usuario quiera que se sobreescriba — y ese es precisamente el bug que queremos evitar.

### Tabla `animal_events` con edición libre (sin ventana de corrección)
- **Pros**: el usuario puede arrepentirse y corregir.
- **Contras**: rompe el audit trail. Trazabilidad SENASA requiere que el historial sea fiable, no editable.

### Tabla `animal_events` completamente inmutable (sin `edit_window_until`)
- **Pros**: máxima trazabilidad.
- **Contras**: en la práctica, los usuarios cometen typos y errores obvios al instante. Forzar a crear un evento nuevo "anulando" el anterior es fricción innecesaria para el caso 99% (corrección de algo recién escrito). La ventana de 15 min es un compromiso: corregir en caliente sí, revisionismo a posteriori no.

### Eventos separados por tabla según tipo (`reproductive_events`, `sanitary_events`, etc.)
- **Pros**: schema más fuerte, tipos compilados.
- **Contras**: complejidad de UI (renderizar timeline mezclando N tablas), complejidad de querying (unions), peor para evolución. Una tabla con `event_type` + `structured_payload jsonb` da prácticamente la misma garantía con flexibilidad mayor.

## Consecuencias

**Positivas**:

- **Trazabilidad granular nativa**. La exigencia SENASA (vigente desde el 1/1/2026) queda cubierta sin trabajo adicional.
- **Audit completo multi-usuario**. Quién dijo qué cuándo es base de datos consultable.
- **Pilar de analytics habilitado desde el día 1**. Cualquier dashboard de reproducción, sanidad o productividad lee `animal_events` filtrando por tipo.
- **Alertas y recordatorios escalables**. Features tipo "vacas a tactar en los próximos 7 días" o "animales sin movimiento en 60 días" son queries SQL, no proyectos.
- **Soft-delete consistente** con el resto del sistema. La política de retención (cuándo hard-deletar) se decide a nivel proyecto cuando SENASA publique requerimientos formales (ver `CONTEXT/08-roadmap.md`).

**Negativas**:

- **Schema y RLS más complejos en spec 02**: tabla nueva con policy de visibilidad y mutación, indexes, tests.
- **UI más rica**: timeline rendering, filtros por tipo, ordenamiento, posiblemente paginación si un animal acumula cientos de eventos en producción. Tamagui + listas virtualizadas resuelven esto, pero es más componente que un textarea.
- **Calibración del enum de tipos**: si los 7 tipos iniciales (`observacion | salud | reproduccion | traslado | pesaje | identificacion | otro`) resultan mal divididos en uso real, refactor de datos. Mitigación: incluir `otro` como escape hatch, y revisar los tipos antes de cerrar spec 02 con el vet socio.
- **`structured_payload` jsonb sin schema fuerte**: bug surface si el frontend escribe un payload mal formado. Mitigación: tipar fuerte en TypeScript del lado cliente + validación de schema en Edge Function al insertar (zod o similar).

**Notas de implementación**:

- Durante el refinamiento de spec 02 (item A.5 del plan): validar que la tabla `animal_events` está incluida con este schema y las RLS policies correspondientes.
- Durante la redacción de spec 09 BUSCAR ANIMAL (item A.7): el flujo "agregar comentario" desde la pantalla edit del animal se conecta a este timeline. La UI del timeline es responsabilidad de spec 09 (o spec 02 frontend cuando se aborde).
- Considerar batch insert para el caso MODO MANIOBRAS (spec 03): un mismo evento de "vacunación masiva" puede generar N eventos sanitarios en serie (uno por animal procesado). Performance check pendiente.
- Validación del `event_type` enum en runtime: usar text + check constraint en DB en lugar de un enum Postgres "duro" para que sumar tipos no requiera ALTER TYPE (que es más restrictivo). Decisión de detalle, validar en spec 02.

**Reversibilidad**: baja. Una vez que hay eventos cargados en producción, migrar a otro modelo requiere transformar datos y refactor de UI/queries. Por eso vale cerrar la decisión ahora, antes de implementar spec 02.

**Relacionado**:
- ADR-005 (identificación flexible): consistente — los eventos de tipo `identificacion` cubren el caso de "se agregó caravana electrónica a un animal que solo tenía visual".
- ADR-008 (transiciones automáticas de categoría): consistente — las transiciones de categoría pueden registrarse automáticamente como evento de tipo `otro` o crearse un tipo `transicion_categoria` adicional si se quiere granularidad.
- Memoria `product-feature-buscar-animal`: la pantalla de edit del animal en BUSCAR ANIMAL consume y produce eventos en este timeline.
