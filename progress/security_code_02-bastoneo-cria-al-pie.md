# Security Gate 2 (code) — delta bastoneo en CRÍA AL PIE (scan-para-llenar)

**Feature**: `02-bastoneo-cria-al-pie` · Nivel B (frontend puro) · spec 02 (RCAP)
**Baseline**: `9a1d193` (HEAD == baseline; delta sin commitear)
**Skill**: `sentry-skills:security-review` (metodología JS/React aplicada al diff)
**Fecha**: 2026-07-07

## Veredicto: PASS — 0 findings HIGH

Delta frontend puro, aditivo. La validación del identificador, la clasificación
EID/IDV, el gate de confirmación pre-commit y la autoridad server-side quedan
INTACTOS. No se introduce ninguna superficie explotable.

---

## Archivos analizados (delta de producción)

- `app/src/components/TagScanSheet.tsx` — prop `hideManualEntry` (UI booleana, aditiva).
- `app/src/components/LinkCalfPrompt.tsx` — scan-para-llenar + refactor `onSearch` → `runSearch(rawQuery)`.

Test/capture (no shippean, fuera de foco de vuln): `app/e2e/cria-al-pie-bastoneo.spec.ts`,
`app/e2e/captures/cria-al-pie-bastoneo.capture.ts`.

`git diff 9a1d193 -- supabase/` → **vacío**. Gate 1 (schema/RLS/Edge) **N/A** para este delta.
Cambios de la terminal PARALELA (Android `app.json`/`eas.json`/`build-android.md`): **ausentes del delta**, no evaluados (fuera de alcance por instrucción).

---

## Foco 1 — EID → find-or-create: validación intacta, sin bypass

Trazado del data flow del EID escaneado:

1. **Origen (contract-validated).** El EID nace del contrato BLE, no de un parseo nuevo del
   componente. `TagScanSheet.onTagRead(eid)` recibe el EID **ya validado + dedupeado**:
   `contract.ts` → `ingestRawLine`/`ingestEid` aplican `parseRs420Line` + `isValidTag`
   (15 díg FDX-B) y `TagDedup` (ventana ~3 s). Un raw malformado se rechaza en el contrato
   (`invalid_eid`/`parse_failed`) y nunca llega a `onTagRead` (`contract.ts:32-62`).
2. **Confirmación pre-commit (G3, no-autopersistencia).** `onTagRead` solo setea `readEid` →
   renderiza `ReadConfirmation` (15 díg legibles + "Usar caravana"). El EID **no** avanza al
   find-or-create sin que el operario confirme con `onAssign` (`TagScanSheet.tsx:127-166,
   513-570`). El bastón no se vuelve verdad solo.
3. **Gate puro sin cambios.** `onAssign` → `onSubmit(readEid)` → `LinkCalfPrompt.onScanSubmit(eid)`
   → `runSearch(eid)`. `runSearch` invoca `classifyCalfQuery(rawQuery)` **idéntico** al path
   tipeado (`LinkCalfPrompt.tsx:217-323`). `classifyCalfQuery` (sin tocar en el delta,
   `link-calf-query.ts:43-49`) sigue siendo la barrera: `trim` + descarte de separadores +
   `^\d+$` + `<3` díg → `too-short` (error inline, no dispara motor); 15 díg → `eid`; resto → `idv`.
   Un paste con letras degrada a `too-short`, nunca alimenta el motor con basura.
4. **Refactor `runSearch(rawQuery)` — equivalente y correcto.** Antes `onSearch` leía `query` del
   closure; ahora `runSearch(rawQuery)` recibe el valor por parámetro y `onSearch = () =>
   runSearch(query)`. Los deps del `useCallback` pasan de `[query, establishmentId,
   motherProfileId]` a `[establishmentId, motherProfileId]` — **correcto**, `query` ya no se lee
   adentro. El path scan pasa el EID; el tipeado pasa `query`. No se introduce parseo sin acotar
   ni se pierde el sanitize/clasificación. El `setQuery(eid)` del scan solo afecta el display
   (EID de 15 díg, seguro); la búsqueda usa el parámetro directo, no el estado.
5. **Server sigue siendo autoridad.** Reads `lookupByTag`/`searchAnimals` son consultas LOCALES
   PowerSync **parametrizadas** (`animals.ts:554-623, 748-788`); `classifySearchQuery` acota el
   largo del término (R7.3) y `buildSearchLikeQuery` **escapa los comodines** → sin injection ni
   DoS. La escritura (`linkCalfToMother`/`registerBirth`) sigue por RPC con constraints
   server-side y **no se toca** en este delta. `lookupByTag` detecta cross-campo → modo
   `transfer` → `LinkCalfPrompt` bloquea el vínculo cross-tenant (RCAP.3.4, `LinkCalfPrompt.tsx:250-256`).

**Conclusión:** validación de forma intacta, sin parseo nuevo sin acotar, sin bypass del gate
ni de la autoridad server.

## Foco 2 — `hideManualEntry`: flag UI aditivo, sin impacto de seguridad

- Booleano del caller (default `false` → comportamiento ficha/alta/parto **idéntico**).
- Con `true`, `onManualAction = onClose` (no prende `manualMode`) + guard defensivo
  `manualMode && !hideManualEntry` → `ManualTagEntry` **nunca** se renderiza (`TagScanSheet.tsx:151,
  231`). Solo cambia labels/CTA de los heroes y la acción del link "¿Sin bastón?".
- **No** toca la adquisición/liberación del scoped scanner, **no** cruza lecturas, **no** deja el
  listener en estado distinto. El path de confirmación (`ReadConfirmation` → `onSubmit`) es el mismo.
  Cambio puramente aditivo.

## Foco 3 — Ownership del nested sheet: limpio, sin EID cruzado ni scanner colgado

- `TagScanSheet` adquiere el scoped scanner en `mount` y lo libera en el cleanup del effect
  (`useEffect(() => { const release = acquireScopedScanner(); return release; }, [...])`,
  `TagScanSheet.tsx:104-108`). Válido para cierre por X, backdrop, `onScanSubmit` ok, back-gesture
  o desmontaje del prompt.
- Ciclo de vida del montaje: `openScan` (guard `busyRef`) → `setScanOpen(true)`; `closeScan`/
  `onScanSubmit` ok:true → `onClose` → `setScanOpen(false)` → **desmonta** `TagScanSheet` → release.
  El effect de apertura del prompt resetea `setScanOpen(false)` (`LinkCalfPrompt.tsx:172`).
- Sin estado del EID compartido entre consumidores: `readEid` es estado **local** de `TagScanSheet`;
  `onScanSubmit` setea el `query` del padre y corre el find-or-create, devuelve ok, y el sheet se
  desmonta. No queda scanner acotado colgado ni `busyMode` inconsistente (patrón RCF.6 preexistente).
- El prompt vive sobre `crear-animal` (suspende el listener global vía `useBusyWhileMounted`); el
  scoped scanner exclusivo hace que el `FindOrCreateOverlay` global ignore la lectura
  (`scopedScannerActive`). Ownership consistente con el molde ya revisado del delta ficha/alta/parto.

## Foco 4 — supabase/ vacío

Confirmado por `git diff`. Sin migrations, RLS, triggers ni Edge Functions en el delta.

---

## Tabla de inputs (campos que el usuario aporta en el delta)

| campo | límite | validación | OK? |
|---|---|---|---|
| EID por bastón (scan-para-llenar, path nuevo) | 15 díg FDX-B, dedup ~3 s | **server/contrato**: `isValidTag` en `contract.ts` (rechazo pre-`onTagRead`) → `classifyCalfQuery` (gate puro) → reads locales parametrizados + acotados; escritura por RPC con constraints | Sí |
| Caravana del ternero (campo de texto, preexistente) | `sanitizeIdvInput` (solo díg) live + `classifyCalfQuery` (`^\d+$`, ≥3 díg) | **autoritativa** en `classifyCalfQuery` + `classifySearchQuery` (acota largo, escapa comodines) + RPC | Sí (sin cambios en el delta) |

Ambos caminos convergen en el MISMO gate puro (`classifyCalfQuery`) antes de tocar datos.
El sanitizer del form es UX; la autoridad real vive en el contrato BLE, `classify*` y los constraints de las RPC (no tocados).

## Tabla de rate limits (acciones abusables tocadas por el delta)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| find-or-create del ternero (read local) | n.a. | — | — | Read LOCAL PowerSync (SQLite), sin red; `busyRef` serializa; dedup BLE ~3 s evita ráfagas. Sin costo por request. |
| vínculo/creación (`linkCalfToMother`/`registerBirth`) | n.a. (este delta) | — | — | Encolado por outbox; RPC no tocada. Sin email/SMS/API externa ni bulk nuevo. Rate limit fuera del alcance de un delta frontend. |

Delta frontend puro: **no** agrega Edge Functions, email/SMS, APIs externas ni endpoints bulk/import → no introduce superficie de rate limiting.

---

## False positives descartados / notas de trazabilidad

- **`setActionError(r.error.message || …)`** (`LinkCalfPrompt.tsx:409`, onConfirmCreate): surfacea
  el mensaje de la RPC `registerBirth` al usuario (information disclosure teórico). **PREEXISTENTE**
  — línea NO tocada por este delta (revisada en el gate previo,
  `progress/security_code_02-cria-al-pie-alta-frontend.md`). Fuera del alcance del delta bastoneo. No es finding nuevo.
- **BLE trust boundary (catálogo G).** Un peripheral rogue podría inyectar una lectura EID; mitigado
  por el gate de confirmación pre-commit (`ReadConfirmation`, G3) + find-or-create con detección
  cross-campo + constraints server-side. Modelo de confianza preexistente y documentado
  (ADR-003/024), **inalterado** por este delta que solo agrega el camino de llenar-por-scan.
- **Mass assignment / `.insert(body)` spread**: no aplica. `registerBirth` se llama con campos
  explícitos (`motherProfileId`, `eventDate`, `calves:[{sex, tag}]`, `calfRodeoId`, `calfIdv`); sin
  spread de input del cliente. Sin cambios en el delta.
- **XSS/injection**: React Native `<Text>` auto-escapa; sin `dangerouslySetInnerHTML`/`v-html`/
  `innerHTML`; queries parametrizadas. Sin patrón.

## Cobertura indirecta (advertencia)

`sentry-skills:security-review` no cubre nativamente contratos Deno/RLS/PowerSync/BLE/RN. Esos
dominios se revisaron **manualmente** arriba (foco 1-3). Para este delta el resultado es el mismo:
sin hueco explotable. La autoridad server-side (RLS + constraints de RPC) no se ejerce en un delta
frontend puro y se mantiene intacta desde los gates previos.
