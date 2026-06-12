# impl_refetch-fixes — anti-patrón "re-fetch que parpadea" en 3 pantallas

baseline_commit: 9992fea8fad27a9ca1408e21f40e0ae087f6bf47

Tarea acotada (frontend puro, no SDD-con-spec): corregir el anti-patrón de "re-fetch que blanquea +
resetea scroll tras una acción del usuario" en 3 pantallas que detectó la auditoría (backlog 2026-06-12).
Receta de `docs/conventions.md` § "UI — actualización optimista en el lugar"; plantilla committeada en
`app/app/animal/[id].tsx` (`load({silent})` + `didInitialLoadRef` + patch optimista + revert-si-falla).

Estado: implementado + verificado. NO marcado done — queda reviewer + Gate 2.

## Qué reusé de la plantilla `animal/[id].tsx`

- **`load(opts: { silent?: boolean })`**: `silent` saltea `setLoading(true/false)`. La carga inicial puede
  blanquear (no hay nada que preservar); el refresh post-acción es silencioso (no desmonta el contenido).
- **Fallo en silent NO vuela la vista montada**: en un refresh silencioso, un fallo transitorio del fetch
  conserva el estado actual y sale sin tocar el error de pantalla (el contenido optimista ya está montado).
- **`didInitialLoadRef`** (para los re-focus): 1ra carga no-silenciosa; re-focus posteriores silenciosos.
- **Patch optimista con forma funcional `setX(prev => …)`** + **snapshot antes del patch** + **revert si el
  write falla** (no dejar estado mentido).

---

## FIX A (ALTA) — `app/app/lotes.tsx`

**Problema**: `load()` hacía `setLoading(true)` siempre; el render usaba `loading` para mostrar "Cargando
lotes…" en vez de la lista montada. Crear / renombrar / borrar → `await load()` → blank + scroll-reset.

**Cómo resolví el optimismo/silent**:
- `groups: ManagementGroup[]` → `ManagementGroup[] | null`. `null` = carga inicial (el blank "Cargando
  lotes…" SOLO se muestra con `loading && groups === null`; una vez cargada la lista, nunca se vuelve a
  `null` ni se toggle-a el `loading` que blanquea).
- `load({ silent })`: silent saltea `setLoading`; fallo en silent conserva la lista (no la blanquea).
- **Crear** (`onSubmitCreate`): `createManagementGroup` devuelve el `{id, name}` REAL (uuid de cliente, ya
  en SQLite local) → `setGroups(prev => [...(prev ?? []), r.value])`. No hace falta re-leer para reconciliar
  el id (el return ya es ok). Optimista puro, sin re-fetch.
- **Renombrar** (`onRenamed`): el write ya sucedió en `RenameForm` → cambié su contrato a `onRenamed(newName)`
  (RenameForm pasa el `valid.value` validado/trimeado, el mismo que persistió el service). El padre patchea
  el `name` del item en sitio (`map` con `id` matching) + `load({ silent: true })` para reconciliar.
- **Borrar** (`onDelete`): snapshot de `groups` → quito el item optimista (`filter`) + cierro su acordeón →
  `softDeleteManagementGroup` → si `!ok`, REVERT (`setGroups(snapshot)`) + Alert; si ok, `load({ silent })`.
- Render: `error && groups===null` y `loading && groups===null` gatean el blank/error; el resto usa
  `(groups ?? [])`. `groups={groups ?? []}` al `LoteCard` (espera no-null).

**Lógica de negocio intacta**: qué se crea/renombra/borra (los services) no cambió; sólo CÓMO se refleja.
El `dupWarning` ahora lee `groups ?? []`.

---

## FIX B (MEDIA) — `app/src/hooks/useGroupView.ts`

**Problema**: `load()` seteaba `setLoading(true)` incondicional; al VOLVER de una masiva (Castrar/Vacunar/
Destetar → navega y vuelve), el `useFocusEffect` corría `load()` → blanqueaba la lista + barra + conteo +
reseteaba scroll. Consumido por `rodeo/[id].tsx` y `lote/[id].tsx`.

**Cómo resolví el optimismo/silent**:
- `load({ silent })`: silent saltea `setLoading`; fallo en silent conserva la vista montada.
- `didInitialLoadRef` (idéntico a `animal/[id].tsx`): la 1ra carga (mount) blanquea (no hay datos que
  preservar); los RE-FOCUS posteriores son SILENCIOSOS → la lista no parpadea ni salta al tope. El ref se
  resetea si cambia la identidad del `loader` (cambió grupo/campo → es otra vista → vuelve a carga inicial).
- El `useEffect` de avance-de-sync ahora llama `load({ silent: true })` SIEMPRE (es un refresh de fondo
  sobre una vista montada; nunca debe blanquearla).
- **`GroupViewBits.tsx` / `GroupViewScreen.tsx` NO se tocaron**: el `loading=false` del refresh silencioso ya
  hace que `GroupAnimalsList` ("Cargando animales…") y `GroupMetaHeader` ("Cargando…") no muestren el
  placeholder. El gating de la barra de acciones por candidatos (fix previo) no se rompe: el `loader` sigue
  devolviendo `actions` igual; sólo cambió cuándo se toggle-a `loading`.

**Consumidores verificados (E2E)**: `rodeo/[id]` (castración/vacunación) y `lote/[id]` (destete) — ambos
siguen andando; la barra gateada por candidatos intacta.

---

## FIX C (BAJA) — `app/app/seleccion-masiva.tsx`

**Problema**: `onRevertOverrides` → `await load()` → `setLoading(true)` → "Cargando animales…" blanqueaba la
lista de selección + reseteaba scroll, perdiendo la selección visible.

**Cómo resolví el optimismo/silent** (opción "mejor" del brief: optimista en sitio, sin re-fetch):
- Tras revertir cada override, junto los `profileId` que el service ACEPTÓ (`r.ok`) en un `Set` `reverted`
  (un fallo raro de write local deja ese animal con su override → no mentimos su estado).
- Actualizo `category_override=false` EN SITIO en:
  - `candidates` (fuente de `candidateById` + `selectedCandidates`): `setCandidates(prev => map…)`.
  - `selectionState.sections` (fuente del `overrideCount` del desglose → el aviso R5.6 desaparece solo): vía
    el helper PURO nuevo **`clearOverridesInSelection(state, revertedIds)`**.
- La **SELECCIÓN del usuario (`selected`) se preserva intacta** — no la toco. Sin re-fetch (`load` ya no se
  llama acá; sigue usándose en el `useEffect` de carga inicial).

**Helper puro nuevo** `clearOverridesInSelection` en `src/utils/bulk-selection.ts`: dado un estado + un set de
ids revertidos, devuelve un estado NUEVO (inmutable: arrays + objetos perfil nuevos sólo para los afectados)
con `categoryOverride=false`. Set vacío → devuelve la MISMA referencia (no-op, sin re-render de gusto).

---

## Trazabilidad de tests

- **Unit (lógica pura nueva)** — `src/utils/bulk-selection.test.ts` (corre en la suite client unit de
  `run-tests.mjs`; 988 client tests verdes, incl. estos 4):
  - `clearOverridesInSelection: limpia override de los revertidos → overrideCount baja, selección intacta`
  - `clearOverridesInSelection: PURO — no muta el estado de entrada`
  - `clearOverridesInSelection: set vacío → devuelve el MISMO estado (no-op, identidad estable)`
  - `clearOverridesInSelection: ids ajenos (no tildados / inexistentes) no afectan a nadie`
- **E2E (Playwright, build de PROD + Supabase remoto)**:
  - FIX A — `e2e/lotes.spec.ts` → nuevo test "crear/renombrar NO blanquea la lista (optimismo en sitio, sin
    'Cargando lotes…')": tras crear y tras renombrar, `getByText('Cargando lotes…').toHaveCount(0)` + el lote
    (nuevo / renombrado) visible. ✅ pasa.
  - FIX B — `e2e/operaciones-castracion.spec.ts` → assert agregado: al VOLVER de la masiva, la fila del
    torito ya está visible (la vista re-cargó en el lugar) y `getByText('Cargando animales…').toHaveCount(0)`.
    ✅ pasa.
  - FIX C: no hay assert E2E dedicado (la lógica del revert quedó cubierta por el unit del helper + el flujo
    de destete/castración E2E que ejerce el sheet). El revert de override desde el sheet es de baja frecuencia
    y su efecto (override → derivada) ya tiene cobertura E2E en el flujo de castración existente.

(Esto es un fix acotado, no una feature con `R<n>` EARS; el "mapa R→test" formal no aplica. La cobertura va
por instancia de fix A/B/C como arriba.)

## Verificación corrida

- `pnpm typecheck` → **verde** (tras cada bloque de edits).
- Client unit tests (`run-tests.mjs`) → **988 pass / 0 fail** (incluye los 4 nuevos).
- RLS suite 22/22, Edge 42/42 → verdes.
- `node scripts/check.mjs` → **FAIL por la suite Animal (spec 02), AJENO al frontend**: la causa es estado de
  la DB beta (`duplicate key value violates unique constraint "animals_tag_unique"` por filas huérfanas de
  corridas previas + un CHECK de `R2: INPUT-1 techo+1` a nivel DB). Re-corrí una vez; persiste porque es
  estado de la DB, no un flake de red que limpie en retry. Mi diff toca CERO backend/migraciones/SQL (sólo 4
  archivos frontend + 2 de test), así que es inequívocamente ajeno. La parte CLIENTE (typecheck + client unit)
  está verde sí o sí, como pedía el brief.
- E2E corridos (build rebuildeado con mis cambios): `lotes.spec.ts` (3/3), `operaciones-castracion.spec.ts`
  (1/1), `operaciones-destete.spec.ts` (2/2), `operaciones-vacunacion.spec.ts` (1/1) → **7/7 pass**. (La línea
  `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` que imprime Playwright al cerrar el `serve` en
  Windows es ruido de teardown de libuv, posterior al "N passed" — no es un test rojo.)

## Autorrevisión adversarial (qué busqué / encontré / cerré)

- **`groups` nullable (FIX A)**: barrí todas las refs de `groups` en `lotes.tsx` → las 4 del componente top
  quedaron null-guardeadas (`?? []` / `=== null`); las de `LoteCard`/`RenameForm` reciben `ManagementGroup[]`
  no-null. Typecheck (strict) lo confirma. **Edge**: si la carga inicial falla, `groups` queda `null` → se
  muestra error+Reintentar (no la lista); el CTA crear (owner) sigue afuera del guard, y crear desde ahí
  recupera la lista (`prev ?? []`) — comportamiento aceptable/mejor que antes.
- **Stale closure**: todos los patches usan forma funcional `setX(prev => …)`; el revert usa snapshot tomado
  ANTES del patch. Sin dep de estado adentro del setter.
- **Revert real (no mentir estado)**: borrar lote revierte con snapshot si `!ok`; revert de override sólo
  limpia los `profileId` que el service ACEPTÓ.
- **FIX B — no romper el gating por candidatos**: el `loader` devuelve `actions` igual; sólo cambió el toggle
  de `loading`. La barra gateada (rodeo sin terneros NO ofrece "Destetar") sigue verde en E2E (destete FIX 1).
- **FIX B — race de doble load en mount**: si el sync-effect (ahora silent) corre junto al 1er focus
  (no-silent), no agrega blank extra (el silent no toca `loading`); estrictamente MENOS parpadeo que antes.
- **FIX B — reset de `didInitialLoadRef` por identidad de `loader`**: `loader` es `useCallback` estable en
  ambos consumidores (deps primitivas) → re-focus sin cambio de grupo es silencioso; cambio de grupo/campo
  resetea → vuelve a carga inicial (blank correcto).
- **FIX C — `overrideCount` lee de `selectionState.sections`, NO de `candidates`**: por eso el patch toca
  AMBOS (sino el aviso del sheet no bajaba). Verificado leyendo `summarizeSelection`. La selección se preserva
  (no toco `selected`). Helper puro testeado incl. inmutabilidad + no-op de set vacío.
- **Test que pase por la razón correcta**: el assert de FIX A/B verifica que el placeholder NO aparece
  (`toHaveCount(0)`) DESPUÉS de anclar en el cambio reflejado (lote nuevo/renombrado visible; fila del torito
  visible) — no pasa por timing vacío; ejerce el path real (crear/renombrar/volver-de-masiva).

## Reconciliación de specs

No aplica reconciliación de specs SDD: es un fix acotado de un ítem de `docs/backlog.md`, no una feature con
`requirements.md`/`design.md`/`tasks.md` en `specs/active/`. La receta canónica ya vive en
`docs/conventions.md` (no la cambié — la apliqué). Documentación actualizada:
- `docs/backlog.md`: las 3 instancias marcadas ✅ RESUELTO con el cómo de cada fix (sin borrar la entrada).

## Archivos tocados

- **FIX A**: `app/app/lotes.tsx`
- **FIX B**: `app/src/hooks/useGroupView.ts`
- **FIX C**: `app/app/seleccion-masiva.tsx` + `app/src/utils/bulk-selection.ts` (helper puro nuevo)
- **Tests**: `app/src/utils/bulk-selection.test.ts` (4 tests del helper) · `app/e2e/lotes.spec.ts` (nuevo
  test FIX A) · `app/e2e/operaciones-castracion.spec.ts` (assert FIX B)
- **Docs**: `docs/backlog.md` (3 instancias → resueltas)

## Riesgos / notas para reviewer + Gate 2

- **Cambio de contrato interno** `onRenamed: () => Promise<void>` → `onRenamed: (newName: string) => void`
  (sólo `RenameForm`/`LoteCard` dentro de `lotes.tsx`; no es API pública exportada). Es la única firma que
  cambió; el resto son cambios internos de estado/render.
- **`useGroupView`**: la firma pública (`GroupViewState`) NO cambió; sólo el comportamiento de `loading`
  (ahora no blanquea en refresh). Cualquier consumidor que dependiera de `loading=true` en cada re-focus ya
  no lo verá — eso era justamente el bug.
- **Doble copia de objetos perfil en FIX C** (`candidates` vs `selectionState.sections` divergen tras el
  patch): inocuo, nada compara referencias entre ambos después; ambos leen `categoryOverride=false`.
- **DB beta**: el FAIL de `check.mjs` es backend (Animal suite, filas huérfanas / CHECK), ajeno a este diff.
