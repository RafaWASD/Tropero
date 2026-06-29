baseline_commit: 8926e16064a93c6fd4b3bb7c6c5b0ef85cecad07

# Impl — Delta spec 02: Agregar caravana desde la ficha (parte manual: electrónica + visual)

> Delta Nivel B (ADR-028). **Frontend puro → Gate 1 N/A** (NO toca DB). Contrato:
> `specs/active/02-modelo-animal/{requirements,design,tasks}-caravana-ficha.md` (RCF.1–RCF.5).

## Estado: DONE (implementación + autorrevisión + reconciliación de specs). Pendiente: veto visual del leader + reviewer + Gate 2 + Puerta 2.

> **Nota de recuperación**: un run anterior murió por error de API DESPUÉS de escribir los módulos puros
> (T1–T7) y AGREGAR los imports en `[id].tsx`, pero ANTES de cablear (imports muertos + sección sin tocar).
> Este run **completó T8–T14** (el corazón) y verificó que la feature se MONTA de verdad (sin imports muertos).

## ¿Tocó DB? — NO. Gate 1 N/A confirmado.
- `idv` → **UPDATE local** sobre `animal_profiles.idv` (`buildSetIdvUpdate` → `runLocalWrite`). Offline-first.
  El path quedó **UPDATE-local** (no RPC, no policy, no migración). El trigger de inmutabilidad 0036 (permite
  NULL→valor) y el unique parcial 0020 ya estaban vigentes — no se tocó ninguno.
- `tag_electronic` → **RPC existente** `assign_tag_to_animal` (0089) vía `assignTagToAnimal` (sin service nuevo).
- Cero migraciones, cero DDL, cero DML a la DB compartida.

## Archivos tocados

**Nuevos:**
- `app/src/utils/identifier-assign.ts` — predicados puros `canAssignTag`/`canAssignIdv` (RCF.1.7). (T1)
- `app/src/utils/identifier-assign.test.ts` — 7 tests node:test de los predicados. (T2)
- `app/src/components/IdentifierAssignRow.tsx` — afordancia inline (CTA → FormField + Confirmar/Cancelar,
  validación inline, busy). Importa `Button`/`FormField` directo (no del barrel → evita ciclo). (T6)

**Modificados:**
- `app/src/services/powersync/local-reads.ts:1772-1796` — `+buildSetIdvUpdate(profileId, idv)`
  (`UPDATE animal_profiles SET idv = ? WHERE id = ? AND deleted_at IS NULL`, espejo de `buildSetCutUpdate`). (T3)
- `app/src/services/powersync/local-reads.test.ts:73,1957-1965` — import + test del shape SQL. (T4)
- `app/src/services/animals.ts:59 (import), 1613-1637` — `+setIdv(profileId, idv): ServiceResult<true>`
  (wrapper de `runLocalWrite(buildSetIdvUpdate(...))`). El TAG reusa `assignTagToAnimal` `:1176` + `lookupByTag`
  `:747` (sin service nuevo). (T5)
- `app/src/components/index.ts:66-67` — export `IdentifierAssignRow` + tipo. (T7)
- `app/app/animal/[id].tsx`:
  - imports `:46-71` — `IdentifierAssignRow`, `assignTagToAnimal`/`lookupByTag`/`setIdv`,
    `canAssignTag`/`canAssignIdv`, `IDV_MAX_LENGTH`/`TAG_ELECTRONIC_LENGTH`/`isValidTagElectronic`/
    `sanitizeIdvInput`/`sanitizeTagInput` (ya no hay imports muertos). (T8)
  - handlers `onAssignIdv` / `onAssignTag` `~:573-643` (tras `onUnsetCut`). (T9/T10)
  - sección "Identificación" `~:846-895` — render condicional por id (read-only `AttributeRow` si seteado /
    `IdentifierAssignRow` si vacío+activo / "—" si vacío+archivado). `visual_id_alt` sin cambios; sin "Detectar
    bastoneo". (T8)
- `app/e2e/animals.spec.ts:948-…` — 3 e2e (idv local, tag 15 díg + validación, read-only de lo seteado). (T12-T14)
- `scripts/run-tests.mjs:53` — agregado `identifier-assign.test.ts` a la lista del runner (entra en check.mjs).

## Diff conceptual de T8–T10 (lo crítico)

- **T8 (sección Identificación)** — antes: 3 `AttributeRow` fijos solo-lectura. Ahora, por cada id:
  `detail.<id> != null ? <AttributeRow value> : canAssign<X>(detail) ? <IdentifierAssignRow kind …> : <AttributeRow "—">`.
  `visual_id_alt` queda `AttributeRow value={detail.visualIdAlt ?? '—'}` (RCF.1.6).
- **T9 (`onAssignIdv`)** — optimismo en sitio (`setDetail({...d, idv})`) → `setIdv(detail.profileId, value)` →
  `load({silent:true})` (refresh local seguro: el UPDATE local ya escribió el idv). Revert + error inline si falla.
- **T10 (`onAssignTag`)** — `lookupByTag(value, detail.establishmentId)` [**establishmentId del PERFIL, RCF.2.5**];
  si `mode==='edit'||'transfer'` → `{ok:false, error:'Esa caravana ya está asignada a otro animal de tus campos.'}`
  SIN encolar; si no → optimismo en sitio → `assignTagToAnimal(detail.profileId, value)` (RPC). Revert si falla.
  **Sin refresh inmediato** (ver autorrevisión #1).

## Mapa RCF.n → archivo:test

| RCF.n | Verificación |
|---|---|
| RCF.1.1 | `identifier-assign.test.ts::RCF.1.1` + e2e RCF.2.* (CTA "Agregar caravana electrónica" visible) + wiring [id].tsx |
| RCF.1.2 | `identifier-assign.test.ts::RCF.1.2` + e2e RCF.1.2/1.4 (tag seteado → no CTA + read-only) |
| RCF.1.3 | `identifier-assign.test.ts::RCF.1.3` + e2e RCF.1.3/3.3/3.5 (CTA "Agregar caravana visual") |
| RCF.1.4 | `identifier-assign.test.ts::RCF.1.4` + e2e RCF.1.2/1.4 (idv seteado → no CTA + read-only) |
| RCF.1.5 | `identifier-assign.test.ts::RCF.1.5` (ambos predicados, no-activo→false) + wiring (rama `AttributeRow "—"`) |
| RCF.1.6 | wiring [id].tsx — `visual_id_alt` queda `AttributeRow` sin cambios; NO se agrega "Detectar bastoneo" (revisión estática) |
| RCF.1.7 | `identifier-assign.ts` (módulo PURO, sin RN/red) + toda la suite `identifier-assign.test.ts` (node:test) |
| RCF.2.1 | `animal-input.test.ts` (`sanitizeTagInput`, ≤15) + e2e (fill 14 díg queda 14, cap 15) |
| RCF.2.2 | e2e RCF.2.* (14 díg → error "La caravana electrónica tiene que tener 15 dígitos." sin invocar) + `animal-input.test.ts::isValidTagElectronic` |
| RCF.2.3 | handler `onAssignTag` (dup `edit`/`transfer` → error sin encolar) + `tag-lookup.test.ts` (modos de `resolveTagLookup`) |
| RCF.2.4 | handler `onAssignTag` (`assignTagToAnimal`) + e2e RCF.2.* (15 díg → optimismo) |
| RCF.2.5 | **autorrevisión #2** — `onAssignTag` pasa `detail.establishmentId` (perfil), NUNCA contexto activo (verificación estática) |
| RCF.2.6 | handler `onAssignTag` (revert + return error) + `IdentifierAssignRow` (muestra error inline, afordancia abierta) |
| RCF.2.7 | e2e RCF.2.* (tag read-only tras confirmar) + **reconciliación** (optimismo SIN refresh inmediato, autorrevisión #1) |
| RCF.3.1 | `animal-input.test.ts` (`sanitizeIdvInput`, ≤20) |
| RCF.3.2 | `IdentifierAssignRow` `validate` (no-vacío) + `onAssignIdv` (defensa no-vacío) |
| RCF.3.3 | `local-reads.test.ts::RCF.3.3/RCF.3.4 buildSetIdvUpdate` + `setIdv` (animals.ts) + e2e RCF.1.3/3.3/3.5 |
| RCF.3.4 | `local-reads.test.ts::RCF.3.3/RCF.3.4` (SET solo `idv`; `doesNotMatch` otras columnas; WHERE id + deleted_at) |
| RCF.3.5 | e2e RCF.1.3/3.3/3.5 (idv read-only tras confirmar, optimismo) + `setIdv` offline-first; unique al subir (no se inventa validación cliente) |
| RCF.3.6 | `onAssignIdv` (revert + return error) + `IdentifierAssignRow` (error inline) |
| RCF.4.1 | `node scripts/check-hardcode.mjs` 0 violaciones + `IdentifierAssignRow` (es-AR, `buttonA11y`, tokens, `getTokenValue` ícono) |
| RCF.4.2 | `IdentifierAssignRow` (CTA `minHeight=$touchMin`, `Button` `$touchMin`; una decisión por afordancia) |
| RCF.4.3 | `FormField error` (borde rojo + mensaje inline, sin banner global) + e2e (error inline visible) |
| RCF.4.4 | `IdentifierAssignRow` CTA `fontSize=$5 lineHeight=$5` (descender "g" de "Agregar") |
| RCF.4.5 | `keyboardType="number-pad"` + `sanitize` a dígitos (sin formato es-AR de coma/punto) |
| RCF.5.1 | `setIdv` → UPDATE local (offline-first) + `enqueueAssignTag` (encolado offline; efecto online) |
| RCF.5.2 | **autorrevisión #2** — `detail.establishmentId` (no hardcode); `buildSetIdvUpdate` WHERE `id` solo (RLS deriva tenant al subir) |

## Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

1. **🔴 ENCONTRADO Y CORREGIDO — el TAG se blanqueaba con el refresh.** Busqué que el optimismo no se pisara.
   `assignTagToAnimal` encola el RPC **SIN overlay local** (`enqueueAssignTag`, outbox.ts:395-405 — `animals`
   fuera del sync set, ADR-026; sin overlay sobre `animal_profiles.animal_tag_electronic`). Un
   `load({silent:true})` inmediato re-leería ese denorm NULL y **blanquearía el optimismo** del tag (rompiendo
   "sin blanquear la ficha", RCF.2.7). → **Quité el refresh inmediato del tag** (el idv SÍ lo conserva: su
   UPDATE local es legible al instante). Reconciliado en design §4.6 + nota bajo RCF.2.7. Re-typecheck verde.
2. **✅ establishmentId del PERFIL (RCF.2.5/RCF.5.2).** `onAssignTag` pasa `detail.establishmentId`, nunca el
   contexto activo ni un hardcode. `buildSetIdvUpdate` no lleva establishment_id (WHERE por id de perfil; la RLS
   deriva el tenant de la fila real al subir → anti-IDOR).
3. **✅ Solo se asigna lo VACÍO (R4.13).** La afordancia se renderiza solo cuando `<id> == null && status==='active'`
   (`canAssign*`); lo seteado cae a `AttributeRow` read-only. El trigger 0036 además rechaza valor→otro al subir
   (doble barrera). El e2e de read-only verifica que un id seteado no ofrece CTA.
4. **✅ Sección sin regresión.** `visual_id_alt` queda `AttributeRow` sin cambios; no se agrega "Detectar
   bastoneo" (RCF.1.6). Las otras secciones de la ficha intactas. Imports ya NO están muertos (la feature monta).
5. **✅ Descender clipping.** CTA "Agregar caravana …" (g) con `lineHeight=$5` matcheando `fontSize=$5`.
6. **✅ Tests no pasan por la razón equivocada.** El e2e de validación asegura que el error aparece Y el input
   sigue visible (no se confirmó); el de read-only asegura `toHaveCount(0)` del CTA + valor visible.
7. **✅ Ciclo de imports.** `IdentifierAssignRow` importa `Button`/`FormField` directo (no del barrel `@/components`,
   que lo re-exporta) → sin import circular.

## Reconciliación de specs al as-built

- **design §4.6 + RCF.2.7** — el "+ refresh silencioso" del TAG se **OMITE** (blanquearía el denorm no-propagado);
  optimismo en sitio alcanza el intento de la requirement. El `idv` (UPDATE local) sí conserva optimismo + refresh.
- **design §1** — props finales de `IdentifierAssignRow` documentados (CTA derivada de `kind`, `maxLength?` opcional,
  import directo de Button/FormField). Advertencias "cambios sin commitear de otra terminal" marcadas **espurias**
  (el leader verificó `git status` limpio).
- `tasks-caravana-ficha.md` — T1–T15 en `[x]`.

## Verificación (red a Supabase inestable → NO se corrió `check.mjs` completo, per instrucción del leader)

- `pnpm.cmd typecheck` → **VERDE** (tsc --noEmit, sin errores; imports usados, sin dead code).
- `node scripts/check-hardcode.mjs` → **0 violaciones** (app/app + app/src/components).
- Unit (runner node:test, sin red): nuevos `identifier-assign.test.ts` (7) + `local-reads.test.ts` (RCF.3.3/3.4)
  verdes; **283/283** en las suites puras representativas (validation/cut-eligibility/identifier-assign/
  cut-service-core/animal-input/animal-form/local-reads/tag-lookup/maneuver-applicability/repro-status).
- **e2e**: 3 tests nuevos en `animals.spec.ts` **reconciliados estáticamente** (NO corridos en vivo — red a
  Supabase flakea; clase `reference_check_red_rate_limit`). Aserciones alineadas al as-built de `[id].tsx`.
- **NO se tocó la DB** (Gate 1 N/A confirmado; path de `idv` = UPDATE-local).

## Folding pendiente (al cerrar en Puerta 2, per tasks §Notas)
- Puntero "caravana-ficha" al índice "Deltas posteriores" del `design.md` baseline de spec 02 + nota as-built bajo
  R4.13 / sección Identificación (afordancia de asignación NULL→valor desde la ficha). Lo hace el leader al folding.
