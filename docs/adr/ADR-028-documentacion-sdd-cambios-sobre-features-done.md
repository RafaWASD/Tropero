# ADR-028 — Documentación SDD de cambios sobre features `done`: reconciliación in-place vs delta-spec

**Status**: Accepted
**Fecha**: 2026-06
**Decisores**: Raf, con análisis del leader

## Contexto

El flujo SDD (ADR-001 + ADR-022) cubre bien la **construcción inicial** de una feature: `pending → context_ready → spec_ready → in_progress → done`, con sus tres documentos Kiro (`requirements`/`design`/`tasks`) en `specs/active/<name>/`. Y `docs/specs.md` ya tiene la regla **"Reconciliación de specs al as-built"**: toda corrección que cambie el comportamiento **dentro del ciclo de una spec activa** (fix de la autorrevisión, fix de un FAIL de gate, decisión en un gate) se refleja en los tres documentos antes de cerrar.

Lo que **no estaba resuelto** es el caso que apareció con las 15 correcciones del testeo en vivo con Facundo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`): **cambios nuevos sobre features que ya están `done` y committeadas**. La pregunta concreta de Raf:

- Si **reescribís las specs viejas**, el `tasks.md` queda raro (los pasos ya están tildados, no hay que "hacer todo de vuelta") y se pierde el registro histórico de ese incremento.
- Si **hacés specs nuevas**, el `design.md` y el `requirements.md` originales quedan desactualizados / mintiendo por omisión.

Dos datos del propio repo orientan la respuesta:

1. **El patrón delta-spec ya se usa de hecho, sin convención escrita.** Spec 02 tiene `requirements-cut-ficha.md`, `design-tier2-categorias.md`, `tasks-puesta-en-servicio.md`, `context-c6-categoria-espejo.md`, etc. Spec 09 tiene `09resto-dedup` y `09resto-ble-global`. Spec 03 tiene `m5-custom-maniobras`, `m6-circunferencia-escrotal`. Funciona, pero nadie lo documentó como regla → cada terminal improvisa.
2. **La regla de reconciliación de `docs/specs.md` está pensada para el ciclo activo**, no para un cambio sobre algo `done`. No dice qué hacer con el baseline cuando el cambio es un incremento posterior.

La práctica externa de SDD converge en lo mismo: los cambios se capturan como **spec deltas** (qué se agrega/modifica/elimina respecto del sistema actual) que con el tiempo se mergean a un **living spec**; y los fixes triviales se documentan liviano (un párrafo), reservando el ciclo completo para cambios no triviales.

## Decisión

Formalizar una **regla de dos niveles** para documentar cambios sobre features `done`. Es ortogonal al ciclo de vida SDD (no agrega estados): elige **cuánta** documentación produce un cambio según su tamaño.

### Nivel A — Reconciliación in-place (sin spec nueva)

Para cambios que **no cambian el *qué* declarado**, solo corrigen o pulen el *cómo*: copy/textos, reordenar opciones, sacar o relabelar un elemento de UI, ajustar un formato.

- **No se crea spec.** Se edita el `design.md` baseline de la feature donde el cambio toca + una línea en su changelog. Si el cambio deja el wording de un `R<n>` mintiendo, se agrega una **nota de reconciliación** bajo ese `R<n>` (no se reescribe el EARS por gusto).
- Igual pasa por **implementer → reviewer → Gate 2** (código). No hay Gate 0 ni Gate 1.
- Es la generalización de la regla **"Reconciliación al as-built"** que ya existe en `docs/specs.md`, ahora aplicada también a incrementos posteriores al `done`.

### Nivel B — Delta-spec

Para **cambio sustancial o capacidad nueva** sobre una feature `done`: el patrón que el repo ya usa, ahora canónico.

- Set nuevo `{context,requirements,design,tasks}-<slug>.md` en la **misma carpeta** `specs/active/<name>/`. `<slug>` describe el incremento (`cut-ficha`, `tier2-categorias`, `alta-form`…).
- **El baseline NO se reescribe.** Sus `requirements.md`/`design.md`/`tasks.md` originales quedan intactos como registro del incremento original.
- **El `tasks.md` original es intocable** — es el ledger histórico de ese incremento (ya tildado, ya revisado). El delta trae su **propio** `tasks`. Esto elimina el "hay que hacer todo de vuelta".
- Gates **proporcionales**: Gate 0 (context) siempre; Gate 1 (security spec) si toca RLS / schema / Edge Functions / RPC / datos regulados; Gate 2 (security code) siempre.
- Un cambio puede generar deltas en **más de una feature** a la vez cuando cruza (ej. un flag que toca el modelo de spec 02 y la maniobra de spec 03 → un delta en cada carpeta, coordinados por un mismo `context`).

### Reconciliación de cierre + índice de deltas

Para que el baseline no mienta por omisión (el único gap del patrón de-facto):

- Al **cerrar** un delta (su Puerta 2 aprobada), se folda al baseline una reconciliación **de alto nivel**: un puntero al delta + una nota as-built bajo el/los `R<n>` afectados. No es reescritura.
- Cada `design.md` baseline lleva, **al inicio**, un bloque **"Deltas posteriores"**: lista de `<slug>` + una línea + estado. Quien lee el baseline ve el panorama completo sin cazar archivos sueltos. El baseline pasa a ser un índice vivo de su propia evolución.

### Cómo elegir el nivel

Regla práctica (ante la duda, Nivel B — es más barato equivocarse hacia más documentación que hacia un baseline que miente):

- ¿Cambia el comportamiento declarado, agrega una capacidad, o toca schema/RLS/RPC? → **Nivel B**.
- ¿Solo corrige/pule presentación sin cambiar lo que el sistema *hace*? → **Nivel A**.

## Alternativas consideradas

### Reescribir los tres documentos baseline en su lugar
- **Pros**: un solo set de specs siempre "actual"; no se acumulan archivos.
- **Contras**: el `tasks.md` reescrito pierde el ledger histórico (qué se hizo en el incremento original y en qué orden); la Puerta 1 pasaría a aprobar un diff enorme sobre un doc largo; rompe la trazabilidad "qué se pensó cuándo".
- **Razón de descarte**: es exactamente el dolor que Raf describió ("el tasks queda raro / no hacer todo de vuelta").

### Una feature nueva en `feature_list.json` por cada cambio
- **Pros**: cada cambio con su ciclo completo y aislado.
- **Contras**: explota el backlog con micro-features; pierde el vínculo con la feature madre; vuelve ruidoso el `one_feature_at_a_time`.
- **Razón de descarte**: desproporcionado. Se reserva **solo** para capacidad genuinamente nueva que no pertenece a ninguna feature existente.

### In-place para todo (sin deltas)
- **Pros**: máxima simplicidad de archivos.
- **Contras**: los cambios grandes quedan sin su propio `requirements`/`tasks` trazables y sin Gate 0/1 propio; un incremento que toca RLS entraría sin spec de seguridad.
- **Razón de descarte**: pierde el rigor donde más importa (cambios sustanciales y schema-sensitive).

### Carpeta de cambio separada + archivar al mergear (estilo spec-kit)
- **Pros**: el `specs/active/` queda siempre limpio.
- **Contras**: overhead de mover archivos por cambio; el repo ya tiene el patrón "sufijo en la misma carpeta" funcionando y entendido.
- **Razón de descarte**: adoptamos una versión liviana del mismo espíritu — sufijo en la carpeta + índice de deltas — sin la maquinaria de mover a archive. (`specs/done/` ya existe para features cerradas **enteras**.)

## Consecuencias

### Positivas
- **Cero "hacer de vuelta"**: el `tasks.md` original nunca se toca; el delta trae el suyo.
- **Baseline vivo**: el índice "Deltas posteriores" + la reconciliación de cierre evitan que el `design.md` mienta por omisión.
- **Gates proporcionales**: un copy-change no arrastra Gate 0/1; un cambio de schema sí.
- **Formaliza lo de-facto**: lo que ya hacían las terminales queda con convención y naming, sin improvisar por sesión.
- **Trazabilidad histórica preservada**: cada incremento (original y deltas) queda como registro de qué se decidió y cuándo.

### Negativas
- **Acumulación de archivos** en `specs/active/<name>/`. Mitigación: el índice "Deltas posteriores" al inicio del baseline da el mapa; cuando una feature se cierra entera, todo el set (baseline + deltas) se mueve a `specs/done/`.
- **Disciplina de foldear al cerrar**: la tentación es cerrar el delta y no actualizar el índice del baseline. Mitigación: el leader lo exige como pre-condición de `done` (igual que la reconciliación al as-built); el reviewer lo verifica.
- **Riesgo de elegir mal el nivel**: un cambio que parecía A resulta tocar comportamiento. Mitigación: la regla "ante la duda, Nivel B".

### Notas de implementación
- `docs/specs.md`: sección nueva "SDD sobre features `done`: in-place vs delta-spec" que operacionaliza esta regla (naming, índice de deltas, criterio de nivel).
- `check.mjs`: **sin cambios** — los deltas no son estados nuevos; siguen colgando del estado de la feature madre en `feature_list.json`.
- `.claude/agents/spec_author.md` y `leader.md`: pueden referenciar este ADR cuando el trabajo es un delta sobre una feature `done` (no re-decide; redacta el delta desde su `context-<slug>.md`).
- Primera aplicación real: las 15 correcciones del testeo en vivo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`) — Nivel A para #9/#11/#12, Nivel B para el resto.

### Reversibilidad
Alta. Es una convención de proceso/archivos, reversible vía git. No genera artefactos de código. Si resultara overhead, se vuelve a improvisar caso por caso (status quo previo).

**Relacionado**:
- ADR-001 (SDD) y ADR-022 (Gate 0 + pipeline): este ADR extiende el flujo al **mantenimiento** de features ya construidas.
- ADR-019 (gates de seguridad): los deltas Nivel B respetan los mismos gates, proporcionales a lo que tocan.
- `docs/specs.md` § "Reconciliación de specs al as-built": esta regla la generaliza del ciclo activo al incremento posterior.
