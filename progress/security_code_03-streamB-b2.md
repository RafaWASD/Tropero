# Security review (Gate 2, ADR-019) — Stream B / B2 CABLEADO (spec 03, RPSC.4 / RPSC.5)

**Modo**: `code` · **Veredicto**: **PASS** · **Fecha**: 2026-06-24

> Auditoría del cableado de B2: tacto adaptativo conectado al flujo de jornada + config "¿medir tamaño?"
> + persistencia "preñada sin tamaño". Frontend puro (no toca schema/RLS/Edge). `baseline_commit`
> `e241e19c76e17aa4df3883eacf898704a2bafc0f` (de `progress/impl_03-streamB-b2-wiring.md`). El delta de B2
> está **sin commitear** (working tree), así que el diff se tomó de `git status --porcelain` + `git diff`
> (no `main...HEAD`, que daría vacío — trabajamos sobre `main`).

## Resumen

- **Findings HIGH**: 0
- **Findings RAFAQ-SPECIFIC**: 0
- **MEDIUM / LOW**: 0 (lista corta abajo: 1 nota informativa, no accionable)
- **Riesgo**: bajo. B2 es plomería de FRONTEND: agrega **una lectura local por id** (`service_months`
  del rodeo) + **un campo booleano** al config jsonb de la jornada (vía el camino de persistencia YA
  gateado) + lógica de presentación pura. **Cero write-paths nuevos, cero RPC nueva, cero tabla nueva,
  cero superficie de auth/red nueva.** Todo lo que escribe pasa por caminos previamente gateados.

## Archivos analizados (solo el surface de seguridad del diff)

- `app/app/maniobra/carga.tsx` — load de `rodeoServiceMonths` + `effectiveSizeBuckets` → `buckets` al `TactoStep`; `tactoMeasuredSize` al resumen.
- `app/app/maniobra/jornada.tsx` — `TactoConfigSheet` cableado; persiste `preconfig.tacto = { measureSize }`.
- `app/src/services/rodeos.ts` — `fetchRodeoServiceMonths` (reusa `parseServiceMonths`).
- `app/src/services/powersync/local-reads.ts` — `buildRodeoServiceMonthsQuery`.
- `app/src/utils/maneuver-config.ts` — `tactoMeasureSizeFromConfig`.
- `app/src/utils/maneuver-sequence.ts` — `describeStepValue`/`summaryRows` con `tactoMeasuredSize` (DD-PSC-8).

Excluidos del análisis (no son surface de seguridad de B2): `*.png` de `design/`, los `*.test.ts`/`*.spec.ts`
(test, no shipped), `app/e2e/helpers/admin.ts` (fixture e2e — ver nota abajo), y los archivos de otra feature
en el working tree (`specs/active/07-*`, `progress/security_spec_07-*`).

## Findings HIGH

Ninguno.

## Findings RAFAQ-SPECIFIC

Ninguno.

---

## Verificación por foco (los 5 puntos del dispatch)

### 1. Multi-tenant en la lectura de `service_months` — OK

`buildRodeoServiceMonthsQuery` (`local-reads.ts:408`):

```sql
SELECT service_months FROM rodeos WHERE id = ? LIMIT 1
```

No filtra `establishment_id` — pero **NO es un hueco cross-tenant**, por tres razones que se sostienen
en cadena (defensa en profundidad), trazadas en el data-flow:

1. **El SQLite local ya está tenant-scopeado en la capa de sync** (PowerSync sync rules + RLS de `rodeos`):
   la tabla local `rodeos` solo contiene rodeos de establishments donde el usuario es miembro. Un `id` de
   otro tenant simplemente **no existe** en su DB local → la query devuelve `null` → fail-safe a "sin
   configurar" (RPSC.4.4). Mismo modelo que `buildRodeosQuery` (`local-reads.ts:163`, que SÍ filtra
   `WHERE rd.establishment_id = ?` para la LISTA, donde el establishment es input).
2. **El `rodeoId` es server-resolved, no attacker-controlled**: viene de `animalRodeoId`, derivado del
   perfil ACTIVO del animal real (`buildActiveProfileRodeoQuery`, `local-reads.ts:424`), NO del contexto
   activo ni hardcodeado (`carga.tsx:364-381`, comentario "El establishment/rodeo sale del animal real").
   En `jornada.tsx`, el `serviceMonths` sale de `rodeo?.serviceMonths` (el rodeo elegido, que vino de
   `fetchRodeos(establishmentId)` — lista ya tenant-filtrada por `buildRodeosQuery`).
3. **Patrón establecido y aceptado**: este read by-id-sin-tenant-filter es IDÉNTICO en forma a los
   pre-existentes `buildRodeoSpeciesQuery` (`local-reads.ts:384`) y `buildRodeoSystemQuery`
   (`local-reads.ts:396`) — la convención del repo para lecturas de un recurso puntual por PK sobre el
   SQLite ya scopeado. B2 no introduce un patrón nuevo ni lo afloja.

Cero hardcode de `establishment_id` / `service_months` en el código shipped (verificado por grep).

### 2. Parseo no-injectable / tolerante — OK

- **`parseServiceMonths`** (REUSADO de B1, `service-months.ts:99`): usa `JSON.parse` **dentro de
  try/catch** (NO `eval`/`new Function`), corrupto → `null`. Salida SIEMPRE normalizada a `number[]`
  enteros 1–12, deduped + sorted, **acotada** (máx 12 enteros chicos). No-array/objeto/bool → `null`.
  Ningún path tira. El `coerceMonth` filtra fuera-de-rango/no-entero. Sin vector de inyección.
- **`tactoMeasureSizeFromConfig`** (`maneuver-config.ts:184`): guards `typeof`/`Array.isArray` en cada
  nivel (`pre`, `raw`, `measureSize`); devuelve el booleano SOLO si `typeof v === 'boolean'`, si no
  `undefined` (cae al default). jsonb no confiable → nunca tira, salida booleana acotada. Limpio.
- La nueva SQL es **parameterizada** (`args: [rodeoId]` → `db.getAll(sql, args)`, `local-query.ts:51`):
  cero interpolación de string → cero SQL injection (categoría `injection.md` del skill: el patrón de
  query con placeholder `?` + args está en la tabla de "safe").

### 3. Persistencia del config — OK, sin canal cross-tenant nuevo

- `onTactoConfigSave` (`jornada.tsx:303`) hace `setPreconfig((prev) => ({ ...prev, tacto: { measureSize } }))`
  — escribe un OBJETO estructurado `{ measureSize: boolean }`, **no** spreea input arbitrario del usuario
  (no es mass-assignment: `measureSize` es un booleano de un segmentado Sí/No, no texto libre).
- Ese `preconfig` fluye por el camino **YA gateado**: `buildJornadaConfig` (`maneuver-wizard.ts:151`)
  **whitelistea** las claves (`maniobras` / `customManiobras` / `preconfig`) → `createSession`
  (`sessions.ts:128`) hace `JSON.stringify(config)` a una columna TEXT vía `runLocalWrite` (SQLite local,
  offline) → la RLS server (`sessions` insert/update = `has_role_in`, tenant-check 0056) re-valida al
  subir. El `establishment_id`/`rodeo_id` de la sesión salen de `input` (contexto server-resolved), NUNCA
  del blob de config. **Agregar un booleano `tacto.measureSize` al jsonb pass-through NO abre ningún canal
  nuevo** — es display/preconfig data, no authorization-bearing.
- `pregnancy_status='large'` se persiste por la vía NORMAL del evento de tacto (`maneuver-events.ts`,
  **no tocado** por este diff — confirmado: no aparece en `git status`). El `TactoStep` con `buckets=[]`
  manda `'large'` por su lógica interna ya gateada (DD-PSC-2, su gate previo). **Sin bypass nuevo.**

### 4. Sin nuevo write-path inseguro — OK

Grep sobre los 6 archivos shipped: **cero** `.rpc(` (el único hit es un comentario pre-existente en
`rodeos.ts:370` sobre `soft_delete_rodeo`, ajeno a B2), **cero** `createAdminClient`/`service_role`/
`SUPABASE_SERVICE`. B2 solo CONSUME: (a) la lectura local del rodeo (nueva, read-only by-id), (b) el
config de jornada (camino `createSession` existente), (c) el evento de tacto (write-path intacto). No
agrega RPC ni tabla, como declara el impl.

### 5. Fallback sin-config — OK, fail-safe

`fetchRodeoServiceMonths` (`rodeos.ts:165`): sin fila / error / corrupto → `null`; `carga.tsx` mapea
error → `null` (`setRodeoServiceMonths(r.ok ? r.value : null)`, línea 375). `effectiveSizeBuckets(null, …)`
→ `[]` → la UI cae a binario PREÑADA/VACÍA (RPSC.4.4). NULL → `[]` **no produce estado inseguro**: solo
cambia la presentación a binario; una preñez sigue persistiendo `'large'` por convención (DD-PSC-2) por el
write-path ya gateado. `emptyIsSyncing:false` → "rodeo no bajó" degrada a `null` (no error que frene).

---

## Tabla de inputs (campos que el usuario tipea / toca, nuevos o modificados en B2)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| `tacto.measureSize` (segmentado Sí/No del `TactoConfigSheet`) | dominio booleano cerrado (2 opciones, no texto libre) | server-side autoritativo por TIPO: lectura guard `typeof v === 'boolean'` (`tactoMeasureSizeFromConfig`); persistido como jsonb pass-through cuya RLS de `sessions` ya gatea el write. No hay rango/charset que acotar (no es texto). | ✅ |

B2 **no agrega ningún campo de texto libre, buscador ni prompt.** El único input nuevo es un toggle binario,
que por construcción no admite valores fuera de `{true,false}` y se valida por tipo en la lectura.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `fetchRodeoServiceMonths` (lectura) | n.a. | n.a. | n.a. | Lectura LOCAL de SQLite (cero red, cero costo server). No es acción abusable. |
| persistir `preconfig.tacto` (config jornada) | n.a. (hereda el de `createSession`) | per-user/establishment vía RLS de `sessions` | sí (RLS server) | No es endpoint nuevo: es el write local de jornada ya existente (offline → upload queue → RLS). B2 no cambia su rate posture. |

B2 **no toca** ninguna Edge Function, email/SMS, API externa (SENASA/SIGSA), operación bulk/import, ni
`[auth.rate_limit]` de `config.toml`. No introduce superficie nueva de rate limiting.

## False positives descartados (trazabilidad)

- **`buildRodeoServiceMonthsQuery` sin filtro `establishment_id` → ¿IDOR cross-tenant?** Descartado: el
  SQLite local ya está tenant-scopeado al sync (la fila de otro tenant no existe localmente → `null`), el
  `rodeoId` es server-resolved (del perfil del animal), y es el mismo patrón aceptado de
  `buildRodeoSpeciesQuery`/`buildRodeoSystemQuery`. No explotable. (Foco 1.)
- **`seedRodeo` usa service-role para setear `service_months` directo (bypassa `create_rodeo`)** —
  `app/e2e/helpers/admin.ts:189`. Descartado: es código de **fixture e2e**, NO entra al bundle de la app
  (vive en `app/e2e/`, harness de test). No es un write-path de producción. (Patrón aceptado de los seeds
  e2e del repo; documentado en el propio diff.)
- **`config.preconfig.tacto` → ¿mass assignment?** Descartado: `onTactoConfigSave` escribe un objeto
  estructurado con un booleano, no spreea input del cliente; `buildJornadaConfig` whitelistea las claves.
  (Foco 3.)

## Lista corta MEDIUM / LOW

Ninguno accionable. Nota informativa (no es finding):

- **(INFO) Ventana de carga de `rodeoServiceMonths` (transitorio).** Mientras la lectura local está en
  vuelo (`undefined`), `tactoBuckets = []` → la UI muestra binario hasta que resuelva. No es un problema
  de **seguridad** (el peor caso es UX: binario por unos ms; y si el rodeo no sincronizó, `[]` ES la
  respuesta correcta per RPSC.4.4). El implementer ya lo evaluó (autorrevisión #11) y es consistente con
  el patrón no-bloqueante de `categoryCatalog`/`lastScrotalCm`. Sin acción de seguridad.

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno / Edge Functions**: N/A — B2 no toca Edge Functions.
- **RLS**: N/A para cambios — B2 no agrega/modifica policies ni migrations. La RLS pre-existente de
  `rodeos` (SELECT) y `sessions` (insert/update) sostiene los caminos que B2 consume; no se evaluó como
  cambio (no está en el diff) pero se confirmó que B2 no la elude ni introduce un camino paralelo.
- **PowerSync sync rules**: la tenant-isolation de la lectura `service_months` **depende** de que la sync
  rule de `rodeos` esté correctamente scopeada por establishment (igual que toda lectura local del repo).
  Eso es invariante de la arquitectura (no de B2) y B2 no lo afloja — pero queda anotado como la frontera
  real de la que cuelga el foco 1. La skill de Sentry **no cubre** sync rules de PowerSync ni RLS de
  Postgres → ese ángulo lo cubrió esta revisión manual (foco 1).
- **Sentry `security-review`**: aplicada con foco en `injection.md` (la nueva SQL — parameterizada, safe),
  `authorization.md` (la lectura by-id — tenant-scopeada en sync), `data-protection.md` (sin secrets/logs
  sensibles en los archivos tocados — grep limpio) y `modern-threats.md` (`JSON.parse` guardado, no eval;
  sin prototype pollution: los guards `typeof`/`Array.isArray` cortan claves no esperadas). **Sin findings
  HIGH-confidence.**

## Conclusión

**PASS.** B2 es un cableado de frontend de bajo riesgo: una lectura local por id (tenant-scopeada en el
sync, server-resolved id, patrón establecido), un booleano al config jsonb por el camino de persistencia
ya gateado, y lógica de presentación pura. Cero write-paths nuevos, cero RPC/tabla nueva, cero superficie
de auth/red/inputs-de-texto nueva. Parseo tolerante sin inyección. Todos los focos del dispatch verificados
limpios.
