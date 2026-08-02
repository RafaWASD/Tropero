# Security Gate 2 (modo `code`, ADR-019) — crash-worklet-gesto-guard

**Veredicto: PASS**

`PASS -> progress/security_code_crash-worklet-gesto-guard.md`

Bug fix defensivo de un crash nativo (SIGABRT / `std::terminate` por excepción JS sin
catch en worklets de gesto/scroll del UI runtime). Frontend puro. **Cero findings
HIGH-confidence.** El cambio *reduce* superficie (elimina un vector de DoS local: cualquier
throw en un worklet de evento mataba la app entera).

## Alcance y baseline

- `baseline_commit: aead27c01babff1d6770b8046cde86a266fdf7eb` (leído de `progress/impl_crash-worklet-gesto-guard.md`).
- Trabajo sin commitear en working tree. Diff obtenido con `git diff aead27c -- <archivos>`.

## Archivos analizados

- `app/app/maniobra/_components/ManeuverReorderList.tsx` — Pan drag-reorder + Taps (badge/body/PoolRow) envueltos en try/catch.
- `app/app/maniobra/_components/WheelPicker.tsx` — `useAnimatedScrollHandler({onScroll})` envuelto en try/catch.
- `app/src/components/worklet-callbacks-guard.test.ts` — guard estático de clase (REGLA 2).

Fuera de alcance por instrucción del leader (no son del fix): `docs/marketing/*`, `docs/backlog.md`.

## Findings HIGH-confidence (Sentry + RAFAQ-SPECIFIC)

Ninguno.

No corrí un pase completo de la skill `sentry-skills:security-review` porque su modelo de
amenaza (injection / XSS / authn / authz / crypto / SSRF / deserialización / path traversal /
secrets) no tiene ningún *sink* aplicable en este diff: es manejo de errores en el UI thread
de Reanimated, sin data flow hacia DB, red, filtros PostGREST, prompts LLM ni salida al
cliente. Evalué el diff manualmente contra cada categoría de la skill y contra el Catálogo
RAFAQ (abajo). El leader scopeó explícitamente 3 concerns HIGH-confidence; los tres quedan
verificados y cerrados.

## Verificación de los 3 concerns del leader

### 1. ¿El `catch … { if(__DEV__) throw }` oculta un error que comprometa integridad? ¿Reorder fantasma en `onEnd`? — NO

Trazado (`ManeuverReorderList.tsx`):
- `onEnd` (L285-301): el `try` ejecuta `runOnJS(commit)(index, myPos.value)` **como primera
  sentencia**, luego resetea shared values.
  - Si el throw ocurre AL agendar `runOnJS(commit)` → `commit` no se agenda → no hay reorder →
    la fila vuelve a su slot por el spring de `positions`. **Fail-closed correcto.**
  - Si `commit` se agendó y una sentencia posterior tira (solo hay writes de `useSharedValue`,
    que en la práctica no tiran) → el reorder agendado es el **legítimo** (`index → myPos.value`),
    no un reorder fantasma.
- `commit` (L188-193) = `hapticDrop()` + `if (to !== from) onReorder(from, to)`. Solo dispara
  el reorder si el destino difiere del origen. `myPos.value` se lee sincrónicamente; no hay
  estado parcial "a mitad".
- El `catch` (L292-296) NO commitea: solo resetea `dragY`/`activeKey`/`autoScrollDir`. El
  comentario "ante la duda NO commiteamos" es levemente impreciso (el commit es la 1ª línea del
  `try`, no del `catch`), pero el comportamiento observable es seguro: en el catch nunca se
  llama `commit`.
- El reorder persiste vía `onReorder → config` (orden de **presets de maniobra**): estado
  local del propio usuario, sin `establishment_id` cruzado, sin PII, sin escritura a tabla con
  RLS relevante. Blast radius máximo ante un throw improbable entre dos writes de shared value:
  el orden queda un slot corrido en la config del propio usuario. Eso es **correctness de UI,
  no seguridad** (coincide con el encuadre del leader). No hay integridad de datos regulados ni
  cross-tenant en juego.

Conclusión: no hay reorder parcial/fantasma explotable. El `catch` degrada a gesto inerte; en
DEV re-lanza (`if(__DEV__) throw err`) → el bug no queda tapado para el desarrollador.

### 2. ¿Estado inconsistente explotable o swallow que enmascare validación de input? — NO

- No se introduce ningún input de usuario libre nuevo. Los worklets consumen eventos de gesto
  (traslación del dedo) y de scroll (offset), no texto.
- `WheelPicker.onScroll` (L285-308): el único valor acotado (`idx`) se clampa a `[0, count-1]`
  **dentro del `try`, antes** de `runOnJS(notifyIndex)(idx)`. Si el handler tira, el `catch`
  solo hace `if(__DEV__) throw`: se salta la notificación entera (rueda quieta, el SETTLE/lock
  nativo asienta al soltar). No hay forma de que un throw haga notificar un índice fuera de
  rango ni de saltear el clamp → **no enmascara ninguna validación**; al revés, falla cerrado.
- Ningún `catch` mete la app en un estado autenticado/autorizado distinto: solo escribe shared
  values de UI (posición/animación).

### 3. ¿El guard de test toca algo sensible? — NO

`worklet-callbacks-guard.test.ts` es análisis **estático**: `readdirSync`/`readFileSync`/
`statSync` + regex sobre el árbol de fuentes, con `stripSourceCommentsAndStrings`. Grep de
`eval|child_process|exec|require(|import(|fetch|process.env|writeFile|network`: sin coincidencias
reales (los hits son `regexp.exec()` y un `refetch()` dentro de un string sintético de test). No
ejecuta código del árbol, no hace red, no escribe archivos, no lee secrets/env. No sensible.

## Cobertura del Catálogo de dominios RAFAQ

- **A (authz / service-role / mass assignment / IDOR):** N/A — sin Edge Functions, sin
  `createAdminClient()`, sin `.insert/.update` con body del cliente.
- **B1 (information disclosure):** verificado OK — los `catch` **no** devuelven `err.message` al
  cliente/UI ni lo loggean; solo `if(__DEV__) throw err` (redbox en dev) o degrade silencioso en
  release. Sin `console.log(err)` ni telemetry del error.
- **B2 (PII en logs):** N/A — no se loggea nada.
- **C (offline/sync / PowerSync / data-at-rest):** N/A — el guard excluye explícitamente
  `db.onChange` de PowerSync (assert sintético lo confirma); el reorder no toca sync rules.
- **D (secrets / supply chain):** N/A — sin secrets, sin imports nuevos remotos.
- **E (abuso a escala / DoS):** el fix **mejora** este eje (evita el crash-de-app por throw en
  worklet). Sin queries nuevas.
- **F (inyección / SSRF / import):** N/A — sin filtros PostGREST, sin `fetch`, sin parseo de
  archivos.
- **G (BLE):** N/A — no toca el trust boundary del bastón.
- **H/I:** N/A — sin auth/sesión/retención/compliance nuevos.

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| (ninguno nuevo/modificado) | n.a. | n.a. | n.a. |

El diff no agrega ni modifica formularios, buscadores, texto libre ni prompts. Los worklets
consumen eventos de gesto/scroll (no input tipeado). El único valor derivado (índice de rueda)
se clampa server-of-truth-local `[0, count-1]` dentro del `try`.

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| (ninguna acción abusable tocada) | n.a. | n.a. | n.a. | Sin Edge Functions, email/SMS, API externa ni bulk. Todo corre en el UI thread del dispositivo. |

## False positives descartados

Ninguno que reportar (no se corrió la skill completa; ver justificación arriba). El único punto
de fricción semántico es el comentario "ante la duda NO commiteamos" en el `catch` de `onEnd`,
que sugiere una lógica anti-commit en el catch que no existe (el commit vive en el `try`). No es
un bug ni un finding — el comportamiento es fail-closed correcto — pero queda anotado por
trazabilidad para que no se lea como una garantía que el código no da.

## Cobertura indirecta (Deno / RLS / PowerSync / native UI runtime)

- La skill de Sentry **no** cubre el UI runtime nativo de Reanimated ni el trust model de RNGH;
  la revisión de este dominio fue **manual** (trazado de data flow de cada `catch`).
- No hay Deno / RLS / PowerSync tocados por el diff (el guard *excluye* PowerSync a propósito).
- La confirmación empírica del no-crash requiere build de device (fuera de alcance de security;
  el guard estático es la red que corre en `check.mjs`). Esto es correctness/QA, no un gap de
  seguridad.
