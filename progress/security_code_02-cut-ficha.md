# Security (modo `code`) — Marcar CUT (descarte) desde la ficha + indicador amarillo (delta spec 02)

**Veredicto: PASS (0 HIGH)**

Feature frontend-puro: marcar/quitar CUT es un UPDATE local plano sobre `animal_profiles` vía builders parametrizados; la autorización real es 100% server-side (RLS `animal_profiles_update` + trigger gating 0054) y se valida al subir, no en el cliente. No introduce input de texto libre, RPC, RLS/migración ni Edge Function. No hay vector explotable nuevo. Detalle abajo.

- **baseline_commit**: `a03e593406da77096a239f7d54eb262ec1f9098f`
- **Skill**: `sentry-skills:security-review` corrida sobre el diff (working-tree, delta CUT). 0 findings HIGH.
- **Estado de los cambios**: todos uncommitted (working tree). El diff vs baseline (committed) está vacío; se trabajó sobre `git status --porcelain` filtrado al delta CUT.

---

## Findings HIGH de Sentry

Ninguno. La skill no identificó vulnerabilidades de alta confianza en el delta CUT.

## Findings RAFAQ-SPECIFIC

Ninguno.

---

## Verificaciones del rol (lo que pidió el prompt)

### 1. Input de usuario sin cota/validación server-side → NINGUNO NUEVO (confirmado)
CUT es botón + confirmación inline. `CutRow` (`app/app/animal/[id].tsx:1034-1130`) no tiene `TextInput` ni `onChangeText` ni ningún campo libre — solo un `Pressable` que expande una confirmación con botones Confirmar/Cancelar. El único `onChangeText` del archivo (`[id].tsx:1688`) NO pertenece al delta CUT (working-tree diff: 0 líneas `onChangeText` agregadas). No hay payload de texto que cotar/validar.

### 2. IDOR sobre `profileId` → la RLS es la barrera; el cliente NO asume autorización (confirmado)
- Callsites: `setCut(detail.profileId)` (`[id].tsx:451`) y `unsetCut(detail.profileId)` (`[id].tsx:474`). El `profileId` es siempre el del perfil que el usuario está mirando — nunca un id arbitrario inyectado.
- `setCut`/`unsetCut` (`animals.ts:1242`/`:1258`) delegan en el núcleo puro y ejecutan UN UPDATE local. NO chequean rol — y NO deben: el comentario de cabecera (`animals.ts:5-9`, `:1196-1197`) y los del builder (`local-reads.ts:1541`) documentan explícitamente que "la RLS `animal_profiles_update` es la barrera real al subir (la autorización se valida ahí, no acá)".
- Modelo confirmado: un usuario sin rol en el establishment del perfil puede generar el CRUD entry local (offline-first), pero al sincronizar la RLS `animal_profiles_update` (`has_role_in(establishment_id)`) rechaza el write; `uploadData` descarta + superficia (R10.8). No hay fuga cross-tenant ni escritura no autorizada persistida server-side.

### 3. SQL parametrizado en los builders → SÍ, placeholders `?` (confirmado)
- `buildSetCutUpdate` (`local-reads.ts:1546-1553`): `'UPDATE animal_profiles SET is_cut = 1, category_id = ?, category_override = 1 WHERE id = ? AND deleted_at IS NULL'`, `args: [cutCategoryId, profileId]`.
- `buildUnsetCutUpdate` (`local-reads.ts:1563-1570`): `'... SET is_cut = 0, category_id = ?, category_override = 0 WHERE id = ? AND deleted_at IS NULL'`, `args: [derivedCategoryId, profileId]`.
- `buildCategoryIdByCodeQuery` (usado por `resolveCutCategory`, `local-reads.ts:342-347`): `'... WHERE system_id = ? AND code = ? AND active = 1 LIMIT 1'`, `args: [systemId, code]`.
- `buildAnimalDetailQuery` (`local-reads.ts:840`, proyección `is_cut`): `args: [profileId, profileId]`.
- Cero interpolación de string / template-literal de valores en el SQL del path CUT (grep vacío). Ambos builders filtran `deleted_at IS NULL`.

### 4. Multi-tenant: `establishment_id` nunca hardcodeado ni del cliente (confirmado)
El path CUT no toca `establishment_id` en ningún builder ni callsite. El scoping de tenant lo aplica enteramente la RLS server-side a partir del perfil. `animals.ts:9` reafirma el principio 6 ("NUNCA se hardcodea establishment_id"). No aplica `createAdminClient()` / service-role (es client-side puro).

### 5. Gate de `dientes` fail-safe → solo UX, no abre bypass del gating server-side (confirmado)
- `dientesEnabled` (`[id].tsx:124`) sale de un read local de gating del rodeo y **falla cerrado**: default `false`, y en error → `false` (`[id].tsx:177`, `:180`). Solo se usa para decidir si se OFRECE "Marcar CUT" (`canMark = ... && dientesEnabled`, `[id].tsx:436`).
- Es prevención de UX. La barrera real es el trigger server-side `tg_animal_profiles_teeth_gating` (0054), que re-valida `dientes` enabled en el cambio aditivo `is_cut false→true` al subir. Aun si un cliente forzara el CRUD entry sin pasar por la afordancia, 0054 lo rechaza server-side (y, antes, la RLS si no hay rol). El desmarcado (`is_cut true→false`, sustractivo) NO se gatea por diseño (0054 §D8), consistente con `buildUnsetCutUpdate`. No hay bypass.

---

## False positives descartados

| Lo que podría disparar un escáner | Por qué NO aplica |
| --- | --- |
| `runLocalWrite` devuelve `err.message` crudo al caller (`local-query.ts:99-103`) → posible information disclosure | Es el error del motor SQLite **local** de PowerSync (no una respuesta server/red). El path CUT solo lo surface si el `execute` local revienta (offline-safe). Los rechazos de autorización/gating server-side NO vuelven por acá: ocurren en el upload async y los maneja `uploadData` (R10.8), no el return de `setCut`/`unsetCut`. No es vector de fuga server-side. Además, fuera del scope (archivo no tocado por el delta). |
| `CategoryBadge` renderiza `label`/`code` de catálogo | React/Tamagui `<Text>{trimmed}</Text>` auto-escapa; no hay `dangerouslySetInnerHTML`. `code` solo decide un color (`isCutCategory`). No-XSS. |
| Tokens `cutText`/`cutBg` en `tamagui.config.ts` | Constantes de color hardcodeadas (design tokens) — no secretos. |
| Ruido spec 03 en `tamagui.config.ts` / `run-tests.mjs` (wheel-picker, scrotal/CE) | Working-tree de la terminal paralela (fuera de scope CUT). Son registros de test + tokens de diseño, sin contenido de seguridad. |

---

## Tabla de inputs (campos que el usuario tipea, nuevos/modificados por el delta)

| campo | límite | validación | OK? |
| --- | --- | --- | --- |
| — (ninguno) | n.a. | n.a. | ✅ CUT es botón + confirmación; sin input de texto libre nuevo |

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
| --- | --- | --- | --- | --- |
| marcar/quitar CUT (UPDATE local) | n.a. | n.a. (RLS por `establishment_id`) | sí (server-side) | Write local offline-first; sin Edge Function/email/SMS/API externa/bulk. La defensa de abuso es RLS + trigger 0054 al subir, no rate limit. No aplica. |

---

## Archivos analizados (delta CUT)

- `app/src/utils/cut-eligibility.ts` (NEW) — predicados puros, sin I/O.
- `app/src/services/cut-service-core.ts` (NEW) — núcleo puro inyectable, sin SDK/red. Mensajes de error son constantes es-AR fijas.
- `app/e2e/cut-ficha.spec.ts` (NEW) — sin credenciales/secrets hardcodeados.
- `app/src/services/animals.ts` (MOD) — `setCut`/`unsetCut`/`resolveCutCategory` + `AnimalDetail.isCut`.
- `app/src/services/powersync/local-reads.ts` (MOD) — `buildSetCutUpdate`/`buildUnsetCutUpdate` (parametrizados) + proyección `is_cut`.
- `app/src/components/CategoryBadge.tsx` (MOD) — prop `code?`, color amarillo CUT; render auto-escapado.
- `app/src/components/AnimalRow.tsx` (MOD) — pasa `code={categoryCode}` al badge.
- `app/app/animal/[id].tsx` (MOD) — `CutRow`, `onSetCut`/`onUnsetCut` (optimismo en sitio + revert), gate `dientesEnabled` (UX, fail-closed).
- `app/tamagui.config.ts` (MOD) — tokens `cutText`/`cutBg`.
- `scripts/run-tests.mjs` (MOD) — registro de los tests nuevos.

---

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: N/A — el delta no toca ninguna.
- **RLS / triggers**: no se modificaron policies ni migraciones. La barrera de autorización (`animal_profiles_update`, trigger 0054) es preexistente (specs 02/03) y **no fue revisada en este pase** — es la dependencia de seguridad de la que cuelga el modelo. Recomendación de trazabilidad: el aislamiento cross-tenant de `animal_profiles_update` y el gating fail-closed de 0054 deben estar cubiertos por la suite no-bypass server-side (responsabilidad de las specs 02/03, fuera de este delta frontend).
- **PowerSync sync rules**: el delta confía en que la sync rule de `animal_profiles` ya scopea por establishment (preexistente). No introduce nueva proyección cross-tenant (`is_cut` es columna del mismo perfil ya sincronizado). Sin cambios a revisar acá.
