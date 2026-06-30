# Review — Corrección #2 (Nivel A): "3 caravanas" → 2 caravanas + nombre/seña

baseline_commit: 34856cabb01600601ee8fa2d5bbbace4a0432315
reviewer: reviewer (Opus 4.8)
fecha: 2026-06-30

## Veredicto: APPROVED

> **Actualización 2026-06-30 — re-review express tras reconciliación.** El leader reconcilió
> `design-caravana-ficha.md` (verificado por `git diff`): pseudo-código de "Identificación" con
> `label="Caravana visual"` en los 3 estados del idv; fila `visual_id_alt` ahora
> `{detail.visualIdAlt != null ? <AttributeRow label="Nombre / seña" .../> : null}` (condicional,
> sin `?? '—'`); viñeta RCF.1.6 corregida (bastoneo deferido; visual_id_alt sin afordancia pero
> relabelado/condicional por #2) + bloque "Reconciliación as-built (corrección #2)" con labels
> nuevos, aclaración de que RCF.1.6 sigue cierto (sin reescribir el EARS) y el pendiente del toggle
> de rodeo. El pseudo-código ahora matchea el as-built; sin scope creep. **Bloqueo resuelto** →
> el diff está confinado al design del delta, el código no cambió desde el review. APPROVED.

## Veredicto original: CHANGES_REQUESTED (resuelto)

El **código** está correcto y limpio (los 4 puntos de verificación pasan, typecheck verde,
check-hardcode 0 violaciones, e2e reconciliados sin debilitar, búsqueda/columnas/afordancia
intactas). **El único bloqueo** es la reconciliación de specs Nivel A que manda ADR-028: el
`design-caravana-ficha.md` quedó viejo y ahora **contradice el as-built** tras esta corrección
(hard rule #6 del reviewer + memory "correcciones se reflejan en specs ANTES de commitear").
La corrección Nivel A NO crea spec, pero SÍ exige editar in-place el `design.md` baseline que
toca + nota de reconciliación bajo el R<n> afectado (ADR-028 §"Nivel A"). Eso no se hizo: el
implementer lo defirió explícitamente al leader (impl_02-caravanas-relabel.md:68-72).

## Diff confirmado
- `git diff 34856ca -- supabase/` → **vacío** (OK, frontend puro, sin DB).
- 8 archivos tocados (3 src + 5 e2e), todos labels. Sin renombres de columnas/variables.

## Verificación punto por punto (instrucción del leader)
1. **Afordancia `IdentifierAssignRow` idv vacío intacta** → OK. `IdentifierAssignRow.tsx:70`
   `ctaLabel = kind === 'tag' ? '...electrónica' : 'Agregar caravana visual'` deriva de `kind`,
   NO del `label`. Cambió solo el `label` prop (jsdoc :30 actualizado). CTA "Agregar caravana
   visual" sigue saliendo de `kind="idv"`. testID `assign-idv-cta`/`assign-idv-confirm` sin cambios.
2. **Condicional `visual_id_alt`** → OK. `app/app/animal/[id].tsx:887-893`
   `{detail.visualIdAlt != null ? <AttributeRow label="Nombre / seña" value={detail.visualIdAlt}/> : null}`.
   vacío(null)→no se renderiza la fila; con valor→"Nombre / seña". El alta normaliza `visual.trim() || null`,
   así que no quedan filas "Nombre / seña" vacías. Correcto.
3. **NO tocado** → OK. `idv`/`visual_id_alt` (columnas) y `detail.idv`/`detail.visualIdAlt`/`onIdv`/`onVisual`
   (variables) sin renombrar. Unicidad/inmutabilidad/find-or-create no aparecen en el diff. Búsqueda
   intacta: searchAnimals/local-reads/animal-identifier/placeholder "Buscar animal..." fuera del diff.
4. **e2e reconciliados (no debilitados)** → OK. Swap 1:1 del string viejo→nuevo manteniendo
   `getByLabel(..., {exact:true})` + `.fill()`/`.toHaveValue()`/`.toHaveCount(0)`:
   - `animals.spec.ts`: 14× "Identificación visual (recomendado)"→"Nombre / seña (opcional)";
     "Caravana / IDV (no editable|recomendado)"→"Caravana visual ..."; :991-993 comentario+exact idv.
   - `animals-offline.spec.ts:104` idv recomendado; `:194` visual no-editable.
   - `maniobra-custom-render.spec.ts:230`, `maniobra-identify.spec.ts:152`,
     `sigsa-breed-renspa.spec.ts:87,93` visual recomendado→"Nombre / seña (opcional)".
   Estructura de asserts intacta — verifican el mismo flujo real.

## Trazabilidad R<n> ↔ test
N/A directa para esta corrección Nivel A (relabel sin nuevo R<n>). Los R del delta caravana-ficha
(RCF.1.3/RCF.3.x) siguen cubiertos por `animals.spec.ts:988+` (CTA "Agregar caravana visual" →
tipear idv → Confirmar), actualizado al label nuevo. R de identidad mínima del alta cubierto por
las altas e2e (todas cargan un visual = "Nombre / seña (opcional)"). Sin pérdida de cobertura.

## Tasks completas: sí
T1/T2/T3 de impl_02-caravanas-relabel.md en [x]. La sub-acción "e2e reconciliados" (T3) está hecha.
La sub-acción de reconciliar la spec del delta NO está hecha (ver bloqueo abajo) — está marcada como
follow-up del leader en el impl, no como task tildada.

## CHECKPOINTS
- [x] typecheck (`pnpm.cmd typecheck`) verde — 0 errores.
- [x] anti-hardcode (`node scripts/check-hardcode.mjs`) verde — 0 violaciones ADR-023 §4.
- [x] supabase diff vacío.
- [x] specs as-built reconciliadas (design-caravana-ficha.md reconciliado, verificado por git diff 2026-06-30).
- (N/A) check.mjs completo / e2e en vivo: NO corridos por instrucción del leader.

## Checklist RAFAQ-específico
- A. Multi-tenancy/RLS → N/A (no toca tablas con establishment_id; supabase diff vacío).
- B. Offline-first → N/A (relabel puro; no cambia repos/escrituras; afordancia idv sigue por UPDATE local intacta).
- C. BLE → N/A.
- D. UI de campo → labels en ficha/alta; sin cambios de target/font; `lineHeight="$5"` del CTA preservado
  (IdentifierAssignRow:138). Una decisión por pantalla sin cambios. OK.
- E. Edge Functions → N/A.

## CAMBIO REQUERIDO (único bloqueo)
Reconciliar el baseline al as-built (ADR-028 Nivel A: editar el `design.md` que el cambio toca +
nota bajo el R<n> que quedó mintiendo). Hoy `design-caravana-ficha.md` muestra los labels VIEJOS:

- `specs/active/02-modelo-animal/design-caravana-ficha.md:57` — pseudo-código `label="Caravana / IDV"`
  (as-built: "Caravana visual").
- `:60` — `IdentifierAssignRow ... label="Caravana / IDV"` (as-built: "Caravana visual").
- `:66` — `AttributeRow label="Caravana / IDV" value="—"` (as-built: "Caravana visual").
- `:68-69` — comentario "Identificación visual (visual_id_alt): SIN cambios — solo lectura..." +
  `<AttributeRow label="Identificación visual" value={detail.visualIdAlt ?? '—'} />` SIEMPRE renderizado.
  As-built: relabel a "Nombre / seña" y render CONDICIONAL (`!= null`). El comentario "SIN cambios" es falso.
- `:75` — "`visual_id_alt` ... NO se tocan / NO se agregan (RCF.1.6)" — falso ahora (relabel + condicional).

Además, por ADR-028 Nivel A: agregar la línea de changelog y, si se usa, la entrada en el bloque
"Deltas posteriores" del design baseline. Nota: `requirements-caravana-ficha.md:28` ya nombra el idv
como "Caravana visual" (no contradice); RCF.1.6 ("no afordancia para visual_id_alt") sigue cierto
(no se agregó IdentifierAssignRow para visual_id_alt) → NO requiere reescribir el EARS, solo la nota
as-built de que la fila pasó a "Nombre / seña" condicional.

Quién lo hace: el implementer reconcilia (o el leader edita la spec directamente, que está habilitado
por CLAUDE.md) ANTES de commitear esta corrección. Una vez reconciliado → re-review express (solo el
design del delta) y APPROVED.

## Fuera de scope (confirmado, NO es falta)
Terminología IDV en el flujo de IMPORT (`import-rodeo.tsx`, `import-ui.ts`/`.test.ts`) — feature 12,
excluida a propósito. Comentarios internos de dominio en `animal-input.ts:19,45` y
`dedup-screenshot.spec.ts:71` ("Identificación visual" descriptivo, no label user-facing) — fuera del
relabel de labels alta/ficha; aceptable dejarlos.
