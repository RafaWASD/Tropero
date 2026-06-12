# review_refetch-fixes -- revision del reviewer

baseline_commit: 9992fea (== HEAD; cambios en working tree, sin commitear)
reporte_implementer: progress/impl_refetch-fixes.md

## Veredicto: APPROVED

Fix acotado (frontend puro) del anti-patron de re-fetch que blanquea + resetea scroll tras una accion.
No es feature SDD con requirements/design/tasks, asi que la trazabilidad Rn a test formal NO aplica;
la receta canonica vive en docs/conventions.md (no se cambio, se aplico); plantilla aprobada animal/[id].tsx.

## Trazabilidad (fix de backlog, no Rn EARS) -- cobertura por instancia
- FIX A (lotes) -> e2e/lotes.spec.ts crear/renombrar NO blanquea la lista (3/3 pass).
- FIX B (group view) -> e2e/operaciones-castracion.spec.ts assert al volver de la masiva torito visible + Cargando animales count 0 (1/1 pass).
- FIX C (seleccion) -> helper PURO clearOverridesInSelection con 4 unit en bulk-selection.test.ts.

## Tasks completas: si. CHECKPOINTS: N/A (fix de backlog, no feature SDD con CHECKPOINTS por-feature).

## Alcance del diff (frontend puro, CERO backend)
git diff HEAD --name-only -> 8 archivos, ningun .sql/migracion/edge/funcion:
- FIX A: app/app/lotes.tsx
- FIX B: app/src/hooks/useGroupView.ts
- FIX C: app/app/seleccion-masiva.tsx + app/src/utils/bulk-selection.ts (helper PURO nuevo)
- Tests: bulk-selection.test.ts (+4), e2e/lotes.spec.ts (+1), e2e/operaciones-castracion.spec.ts (+1 assert)
- Docs: docs/backlog.md (3 instancias RESUELTO)
Los e2e/helpers + operaciones-{destete,vacunacion}.spec.ts nuevos + RAFAQ-resumen-app.md del git status
son de OTRO trabajo (spec 10 UI-D E2E): NO estan en el diff de ESTE fix; ajenos.

## Foco 1 - Siguen la receta de conventions.md
Blank SOLO en carga inicial:
- FIX A: groups ManagementGroup[] | null; blank gateado por (loading && groups===null) L243, error por (error && groups===null) L236. Cargada, groups nunca vuelve a null. OK
- FIX B: didInitialLoadRef (1ra carga no-silenciosa; re-focus/sync silenciosos, L76-97). loading solo true en la 1ra carga -> GroupViewBits no re-muestra placeholder en refresh. OK
- FIX C: NO re-fetchea en el revert; muta en sitio -> no toca loading. OK
Patches funcionales setX(prev) sin stale closure: lotes crear L143, renombrar L269, borrar L179; seleccion candidates L265 + selectionState L268. OK
Snapshot ANTES del patch + revert-si-falla:
- Borrar lote: snapshot=groups L178 -> setGroups(filter) -> si !ok setGroups(snapshot) L185. OK
- Renombrar: confirmar-luego-patch; RenameForm.onSubmit solo llama onRenamed(valid.value) si write ok L529; si !ok muestra error y NO patchea. No deja estado mentido. OK
- Crear: createManagementGroup devuelve {id,name} REAL (uuid de cliente en SQLite local); NO llama load tras crear (sin duplicado al reconciliar). OK
Silent NO togglea el loading que desmonta: if (!silent) setLoading(...); fallo en silent conserva el estado montado. OK

## Foco 2 - FIX A (lotes)
- Crear inserta el id REAL del service; no hay load tras crear -> no duplica. OK
- Renombrar/borrar revierten bien si el service falla. OK
- load({silent}) de reconciliacion NO re-introduce el blank (!silent gatea setLoading/setGroups([])). OK
- Contrato interno onRenamed pasa de ()=>Promise<void> a (newName:string)=>void (no API publica; solo RenameForm/LoteCard en lotes.tsx). Aceptable. OK

## Foco 3 - FIX B (group view)
- rodeo/[id] y lote/[id] siguen andando: ambos loader son useCallback con deps PRIMITIVAS -> identidad estable entre re-focus -> didInitialLoadRef no se resetea -> re-focus silencioso. Reset por cambio de grupo/campo vuelve a carga inicial. OK
- Barra de acciones gateada por candidatos NO se rompio: GroupViewScreen.tsx gatea la card por actions && (vaccinate||wean||castrate) L95, NO por loading. El refresh silencioso actualiza actions con el valor recomputado por el loader; la barra se re-renderiza. Loader sigue devolviendo actions igual (fail-closed). OK
- 1ra carga aun muestra loading: GroupMetaHeader/GroupAnimalsList reciben loading=true solo en la 1ra carga. OK

## Foco 4 - FIX C (seleccion)
- clearOverridesInSelection PURO + correcto: set vacio -> MISMA referencia (no-op); demas -> estado nuevo inmutable (arrays + objetos perfil nuevos solo para los afectados); baja overrideCount de summarizeSelection (lee de state.sections) -> el aviso R5.6 desaparece. OK
- Preserva la seleccion: selected NO se toca en onRevertOverrides. OK
- Solo limpia los profileId ACEPTADOS por el service: junta reverted con los r.ok; un fallo de write local deja ese animal con su override (no miente). OK
- Patchea AMBAS fuentes: candidates + selectionState.sections; necesario porque divergen; inocuo. OK
- Tests del helper: 4 nuevos (limpia/baja overrideCount + seleccion intacta; PURO no muta; set vacio no-op identidad; ids ajenos no afectan). OK

## Foco 5 - Sin cambio de logica de negocio
Los services quedan as-built; solo cambio COMO se refleja en UI (optimismo en sitio + refresh silencioso). La AUTORIZACION sigue server-side (RLS/RPC). OK

## Verificacion ejecutada (de primera mano)
- pnpm typecheck (cliente) -> VERDE (tsc --noEmit, exit 0).
- client unit tests (988 del runner) -> 988 pass / 0 fail.
- bulk-selection.test.ts aislado -> 21 pass / 0 fail (incl. los 4 nuevos de clearOverridesInSelection).
- node scripts/check.mjs (completo, con keys de Supabase):
  - RLS 22/22 OK; Edge 42/42 OK.
  - Animal suite (spec 02, BACKEND): 80 pass / 2 fail -> AssertionError animals.tag_electronic borde 64,
    duplicate key value violates unique constraint animals_tag_unique (code 23505) en
    supabase/tests/animal/run.cjs:1881. Estado de la DB beta (filas huerfanas), NO el frontend. El diff toca
    0 backend/SQL -> AJENO y preexistente. check.mjs sale rojo SOLO por esto.
  - La parte CLIENTE (typecheck + 988 unit) esta VERDE; el rojo es exclusivamente la suite Animal backend.
- E2E (build de PROD expo export -p web rebuildeado + Supabase remoto):
  - lotes.spec.ts -> 3/3 pass (incl. el nuevo crear/renombrar NO blanquea la lista).
  - operaciones-castracion.spec.ts -> 1/1 pass (incl. el assert FIX B).
  - La linea Assertion failed UV_HANDLE_CLOSING es ruido de teardown de libuv en Windows, POSTERIOR al N passed -> no es un test rojo.

## Calidad de los tests (no falso-verde)
E2E FIX A/B anclan PRIMERO en el cambio reflejado (lote nuevo/renombrado visible; fila del torito visible) y RECIEN ahi asertan toHaveCount(0) del placeholder -> no pasan por timing vacio. Unit del helper cubre correctitud + pureza/inmutabilidad + no-op de identidad + ids ajenos. OK

## Reconciliacion de docs
docs/backlog.md: las 3 instancias marcadas RESUELTO con el como (sin borrar). No hay specs SDD que reconciliar (fix de backlog). La receta de conventions.md no se cambio. OK

## Checklist RAFAQ-especifico (secciones aplicables)
- A (multi-tenancy/RLS): N/A -- no toca tablas ni RLS (0 backend).
- B (offline-first): aplica parcial -- los 3 fixes son offline-first-friendly: mutan el estado local optimista (el write ya pega al SQLite local) y reconcilian con refresh silencioso; el fallo de write revierte (no miente). Conflictos via LWW (PowerSync). OK
- C (BLE): N/A.
- D (UI de campo): aplica -- seleccion-masiva es manga-critica; el fix MEJORA el feedback (la lista no parpadea ni salta al tope tras una accion). No degrada targets/fuente/loading. La barra de acciones gateada por candidatos sigue intacta. OK
- E (Edge Functions): N/A.

## Observaciones menores (NO bloqueantes)
- FIX A borrar: snapshot de clausura (snapshot=groups) en vez del prev del setter. Robustez teoricamente menor, pero deps incluyen groups, hay busyRef re-entrancy guard, y el optimismo usa forma funcional. Consistente con la plantilla aprobada animal/[id].tsx (snapshot=detail). Aceptable.
- GroupViewScreen gatea el placeholder por loading (no loading && animals===null); valido porque el hook garantiza loading=true equivale a carga inicial (via didInitialLoadRef). Variante correcta de la receta.

## Cambios requeridos: ninguno.

## Resultado
APPROVED. Parte cliente (typecheck + 988 unit + E2E afectados) verde; los 3 fixes siguen la receta canonica; sin cambio de logica de negocio; docs reconciliados. El unico rojo de check.mjs es la suite Animal backend por estado de la DB beta, ajeno al diff (0 archivos backend tocados).
