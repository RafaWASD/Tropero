# security_code_refetch-fixes — Gate 2 (modo code)

**Veredicto: PASS** — sin delta de seguridad.

- Baseline: `9992fea` (== HEAD; todo el delta está sin commitear, verificado con `git status --porcelain`).
- Naturaleza del cambio confirmada: optimismo de **estado local** + helper **puro** + **cero writes nuevos** + revert **local**. Coincide 1:1 con `progress/impl_refetch-fixes.md`.
- Verificación clave: `git diff 9992fea -- app/src/services/ supabase/` → **vacío**. Los 4 services de escritura (`createManagementGroup`, `renameManagementGroup`, `softDeleteManagementGroup`, `revertCategoryOverride`) quedan as-built (ya gateados); RLS sigue siendo el control real de toda mutación.

## Respuesta a las 4 preguntas del leader

1. **Optimismo = estado LOCAL, sin write nuevo ni columna server-forzada**: SÍ. Todos los patches son `setState` con valores que el server/SQLite local ya confirmó: el create usa `r.value` devuelto por el service (`lotes.tsx` — `setGroups(prev => [...(prev ?? []), r.value])`); el rename usa `valid.value`, el mismo string validado/trimeado que persistió `renameManagementGroup` dentro de `RenameForm` (write pre-existente, no movido); el delete solo filtra el array local. Ningún `.insert`/`.update` nuevo, ningún spread de input de cliente hacia el server.
2. **Revert seguro**: SÍ. En borrar lote, `snapshot` se toma ANTES del patch optimista y el revert es `setGroups(snapshot)` — puro setState, **no re-emite ningún write**. En `seleccion-masiva`, el "revert" del estado es por omisión: los `profileId` cuyo write falló simplemente no entran al set `reverted` y conservan su override visible (no se miente estado no confirmado).
3. **`clearOverridesInSelection` (bulk-selection.ts:174-189)**: PURO. Solo transforma estado de UI (inmutable: spreads sobre claves fijas, lookup vía `Set.has(profileId)` — sin asignación de clave dinámica, sin superficie de prototype pollution). Solo limpia los ids que el service ACEPTÓ (`if (r.ok) reverted.add(c.profileId)` en `seleccion-masiva.tsx:255`); set vacío → misma referencia. 4 unit tests cubren pureza/no-op/ids ajenos.
4. **Sin autorización client-side nueva**: correcto. El gating `isOwner` de lotes es pre-existente y es UX; RLS sigue siendo la frontera. El optimismo solo adelanta en pantalla lo que el service/SQLite local ya aceptó.

## Findings HIGH de Sentry (skill `sentry-skills:security-review`)

**Ninguno.** "No high-confidence vulnerabilities identified."

Trace de data flow del diff: el único input de usuario que fluye por el código nuevo es `newName` (crear/renombrar lote), que (a) ya pasaba por `validateGroupName` + service antes de este cambio (path de validación intacto), y (b) en el patch optimista solo termina en `<Text>` de React Native (auto-escapado, sin sink HTML/SQL/URL). Grep de líneas agregadas (incl. tests E2E): cero `console.*`, secretos, URLs, `innerHTML`/`dangerouslySetInnerHTML`, `eval`, `fetch`.

## Findings RAFAQ-SPECIFIC

**Ninguno.** Catálogo recorrido contra el diff:
- **A (service-role/mass assignment/IDOR)**: n.a. — cero Edge Functions, cero queries nuevas, cero payloads nuevos.
- **B (exposición)**: n.a. — no se agregó logging ni mensajes de error nuevos hacia el usuario (los `r.error.message` que se muestran son pre-existentes y vienen de services locales, no de respuestas server crudas nuevas).
- **C (offline/sync)**: sin cambio de semántica de sync; `useGroupView` sigue leyendo del SQLite local vía el mismo `loader`; el efecto de `lastSyncedMs` solo cambió a `silent` (mismo trigger, mismo dato).
- **D/E/F/G/H/I**: no tocados por el diff.

## False positives descartados (trazabilidad)

1. **"Fail-open" en `load({silent})`** (`useGroupView.ts` y `lotes.tsx`): en refresh silencioso un fallo del fetch conserva la vista montada sin surfacear error. NO es fail-open de seguridad: es una LECTURA de datos locales que el usuario ya tenía legítimamente en pantalla; no salta ningún control de autorización (la autorización de lecturas/writes sigue server-side). El caso "miembro revocado sigue viendo datos cacheados offline" es inherente al modelo offline-first (dominio C3/C4, pre-existente, no alterado por este diff).
2. **Optimistic rename "confía" en el valor del hijo**: `RenameForm` pasa `valid.value` — el mismo string que el service persistió, validado upstream. Render vía `Text`. No exploitable.
3. **Divergencia de copias `candidates` vs `selectionState.sections` tras el patch (FIX C)**: inconsistencia potencial de UI, no de seguridad — nada autoriza ni escribe en base a esas copias.

## Tabla de inputs

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| Nombre de lote (crear/renombrar, `lotes.tsx`) | Pre-existente (`validateGroupName`, no tocado por el diff) | Sin cambio: mismo path cliente + service/RLS as-built (ya gateado) | Sí — el diff no agrega ni modifica ningún campo de entrada |

No hay campos de entrada nuevos ni modificados en su validación.

## Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| (ninguna acción server nueva/modificada) | n.a. | n.a. | n.a. | El diff ELIMINA re-fetches de lista completa post-acción → reduce amplificación de lecturas; no introduce ninguna acción abusable. |

## Archivos analizados

- `app/app/lotes.tsx` (FIX A)
- `app/src/hooks/useGroupView.ts` (FIX B)
- `app/app/seleccion-masiva.tsx` + `app/src/utils/bulk-selection.ts` (FIX C)
- Tests: `app/e2e/lotes.spec.ts`, `app/e2e/operaciones-castracion.spec.ts`, `app/src/utils/bulk-selection.test.ts` (escaneados por secretos/patrones — limpios)
- Docs: `docs/backlog.md` (sin relevancia de seguridad)
- Verificado vacío: `app/src/services/`, `supabase/` (migrations + Edge Functions intactos)

## Cobertura indirecta

- La skill de Sentry no tiene guía específica de React Native / RLS / PowerSync; el diff es 100% estado de UI cliente, así que la revisión manual del catálogo RAFAQ (arriba) cubre el gap. Sin dominios críticos sin revisar.

## Anexo LOW (no bloquea — backlog opcional)

- **LOW**: si el `load({silent})` de reconciliación falla persistentemente, el estado optimista queda sin reconciliar hasta el próximo focus/sync. Consistencia de UI pura, no seguridad. No requiere acción.
- **Nota fuera de scope**: hay un archivo untracked `RAFAQ-resumen-app.md` en la raíz del repo que NO pertenece a este fix (probable otra terminal). No revisado como parte de este gate; el leader debería confirmar su origen antes del commit para que no entre colado.
