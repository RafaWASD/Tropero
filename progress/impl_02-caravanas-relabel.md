baseline_commit: 34856cabb01600601ee8fa2d5bbbace4a0432315

# impl — Corrección #2 (testeo en vivo): "3 caravanas" → 2 caravanas + nombre/seña

Nivel A (ADR-028), frontend puro, sin DB. Relabel + 1 condicional. Labels confirmados por Raf.
Las 3 columnas del modelo NO se tocan (`tag_electronic`, `idv`, `visual_id_alt`). Solo cambia la
PRESENTACIÓN: `idv` → "Caravana visual", `visual_id_alt` → "Nombre / seña" (y ya no se presenta
como caravana — fila condicional en la ficha).

## Tasks
- [x] T1 — Ficha (`app/app/animal/[id].tsx`): fila `idv` → label "Caravana visual" (los 3 estados:
  solo-lectura, IdentifierAssignRow, "—"). Fila `visual_id_alt` → "Nombre / seña", render SOLO si
  `detail.visualIdAlt != null`. Afordancia de asignar idv vacío intacta (CTA "Agregar caravana
  visual" derivado de `kind="idv"`, no del label).
- [x] T2 — Alta (`app/app/crear-animal.tsx`): `idv` → "Caravana visual (recomendado)" / "(no
  editable)"; `visual_id_alt` → "Nombre / seña (opcional)" / "(no editable)". Error de identidad
  mínima relabelado (caravana visual / nombre/seña).
- [x] T3 — Grep de consistencia + JSDoc IdentifierAssignRow. e2e reconciliados a los labels nuevos.

## Cambios concretos (archivo:línea → label)
Ficha `app/app/animal/[id].tsx` (sección "Identificación"):
- 867 / 871 / 880: `"Caravana / IDV"` → `"Caravana visual"` (AttributeRow solo-lectura, label del
  IdentifierAssignRow, AttributeRow "—").
- 883-885: `visual_id_alt` ahora `label="Nombre / seña"` y render condicional `detail.visualIdAlt
  != null ? <AttributeRow .../> : null` (antes siempre `value={detail.visualIdAlt ?? '—'}`).

Alta `app/app/crear-animal.tsx`:
- 514: error → `"Cargá al menos un identificador: caravana electrónica, caravana visual o
  nombre/seña."`
- 1223: `"Caravana / IDV (no editable)"` → `"Caravana visual (no editable)"` (prefill idv).
- 1230: `"Identificación visual (no editable)"` → `"Nombre / seña (no editable)"` (prefill visual).
- 1239: `"Caravana / IDV (recomendado)"` → `"Caravana visual (recomendado)"`.
- 1248: `"Identificación visual (recomendado)"` → `"Nombre / seña (opcional)"`.

`app/src/components/IdentifierAssignRow.tsx:30`: JSDoc de ejemplo refrescado ("Caravana visual").

## e2e reconciliados (assert al label nuevo, NO debilitados)
- `app/e2e/animals.spec.ts`: 14× `'Identificación visual (recomendado)'` → `'Nombre / seña
  (opcional)'`; `'Caravana / IDV*'` (no editable / recomendado / exact 993 / comentario 991) →
  `'Caravana visual*'`.
- `app/e2e/animals-offline.spec.ts`: 104 idv recomendado; 194 visual no-editable.
- `app/e2e/maniobra-custom-render.spec.ts:230`, `app/e2e/maniobra-identify.spec.ts:152`,
  `app/e2e/sigsa-breed-renspa.spec.ts:93` (+comentario 87): visual recomendado → "Nombre / seña
  (opcional)".

## Verificación
- `pnpm.cmd typecheck` → OK (tsc --noEmit, 0 errores).
- `node scripts/check-hardcode.mjs` → OK (0 violaciones ADR-023 §4).
- (Por instrucción) NO se corrió check.mjs completo ni e2e en vivo.

## Autorrevisión adversarial
- 2 caravanas + nombre/seña condicional: ficha = electrónica + "Caravana visual" + "Nombre / seña"
  (solo si hay valor → con vacío quedan 2 filas). Alta = electrónica + "Caravana visual" + "Nombre /
  seña". OK.
- Afordancia idv vacío NO rota: IdentifierAssignRow sigue gateado por `detail.idv == null &&
  canAssignIdv`; el CTA "Agregar caravana visual" sale de `kind="idv"` (no del label) → intacto.
  Solo cambió el label del FormField expandido → e2e 993 actualizado a `getByLabel('Caravana
  visual', {exact:true})`. Verificado que "Caravana visual" exacto es único en la ficha (electrónica
  = "Caravana electrónica", alt = "Nombre / seña").
- Búsqueda NO tocada: searchAnimals / local-reads / animal-identifier / placeholder "Buscar animal
  por caravana o número" sin cambios.
- Edge `visualIdAlt`: el alta normaliza `visual.trim() || null` → null para vacío, así que `!=
  null` (tal cual el spec) no deja filas "Nombre / seña" vacías. Seguí el `!= null` literal del
  task.
- No se asserta en e2e el texto del error de alta ni la fila alt de la ficha → el relabel + el
  condicional no rompen tests existentes.

## Reconciliación de specs (para el leader — requiere confirmación, son specs done/active)
- Delta `caravana-ficha` (RCF.1.6) dejaba `visual_id_alt` "solo lectura / fuera de alcance" y la
  fila `idv` como "Caravana / IDV". Esta corrección supersede esa nota: la fila alt pasa a "Nombre /
  seña" condicional y el idv a "Caravana visual". No la edité (CLAUDE.md: confirmar antes de tocar
  specs done/active) — queda para que el leader reconcilie en la spec del delta.

## Ambiguos / a decidir por Raf/leader (UI)
- `idv` en el alta conservó el calificador "(recomendado)"; `visual_id_alt` se bajó a "(opcional)"
  (literal del task). Decisión de criterio: no descartar la info de "recomendado" del idv. Reversible.
- FUERA del alta+ficha hay otras presentaciones user-facing del identificador con terminología
  vieja, NO tocadas (eran out-of-scope del task = alta+ficha):
  - `app/app/import-rodeo.tsx:526` (wizard de import CSV): "...(caravana electrónica, IDV u otro ID
    visual)...".
  - `app/src/utils/import/import-ui.ts` (subsistema import): `idv → "Caravana visual (IDV)"` + copys
    de error. Ya usa "Caravana visual"; no tiene label para `visual_id_alt`.
  ¿Querés que extienda el relabel al flujo de import también, o lo dejamos como subsistema aparte?
