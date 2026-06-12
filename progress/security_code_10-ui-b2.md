# Security review (modo code) — spec 10 chunk UI-B2: vacunación masiva

> Gate 2. Baseline: `b1bd0a0` (cambios sin commitear en working tree). Skill `sentry-skills:security-review`
> corrida sobre el diff + checklist RAFAQ-específico. Fecha: 2026-06-12.

## Veredicto: FAIL

Un (1) finding HIGH RAFAQ-SPECIFIC de integridad de datos en el camino normal del usuario (campo "Vía" vs
enum del server). Todo lo demás del foco prioritario está limpio (detalle abajo). El fix es acotado (UI-side,
sin migración) → fix-loop corto con el implementer.

---

## Findings HIGH de Sentry (skill)

**Ninguno.** La skill no encontró vulnerabilidades explotables HIGH-confidence: sin injection (queries
parametrizadas), sin XSS (RN `<Text>` auto-escapa; no hay `dangerouslySetInnerHTML`/`v-html`), sin secrets,
sin SSRF, sin deserialización insegura, sin mass assignment (INSERT con whitelist de columnas explícita).

## Findings RAFAQ-SPECIFIC

### [HIGH] VIA-ENUM-MISMATCH — el campo "Vía" (texto libre) choca contra el enum del server → TODA la vacunación del animal se rechaza y se DESCARTA al sincronizar

- **Ubicación**: `app/app/vacunacion-masiva.tsx:324-331` (FormField "Vía (opcional)", texto libre,
  placeholder `"Ej. Subcutánea"`) → `:220` (`route: route.trim() || null`) →
  `app/src/services/powersync/local-reads.ts:1168-1182` (`buildAddVaccinationInsert` mete el string crudo
  en la columna `route`).
- **Confianza**: HIGH (cadena completa verificada, sin mapeo intermedio en ningún punto).
- **Evidencia de la cadena**:
  1. En DB `sanitary_events.route` es el **enum** `public.sanitary_route`
     (`supabase/migrations/0027_sanitary_events.sql:5,16`): valores válidos SOLO
     `'intramuscular'|'subcutaneous'|'oral'|'topical'|'other'`.
  2. La pantalla manda el texto tipeado tal cual (es-AR: "Subcutánea", "IM", lo que sea). No existe mapeo
     label→código en el diff ni upstream (`humanizeRoute` de `event-timeline.ts:835` es el mapeo INVERSO,
     solo display).
  3. El connector sube el CRUD plano crudo: `table.upsert({ ...op.opData, id })`
     (`connector.ts:78`) → Postgres responde `22P02 invalid input value for enum sanitary_route`.
  4. `isTransientUploadError` clasifica clase 22 como rechazo PERMANENTE
     (`upload-classify.ts:42,74`) → el connector **descarta la op** (`connector.ts:101-105`).
- **Impacto**: cada vez que el operario completa "Vía" (el placeholder lo invita), **los N eventos de la
  masiva se rechazan y se pierden server-side** — el INSERT entero, producto incluido, no solo la vía. La
  UI ya le dijo "Vacunando ✓"; el rechazo aparece después como registro observable, pero el dato sanitario
  (dominio SENASA) nunca llega al server ni a otros dispositivos. En un producto offline-first esto es
  pérdida masiva de datos en el happy path, no un edge case. (No es explotable por un atacante — el server
  valida fail-closed, que es lo correcto — pero el contrato cliente↔server está roto: el cliente genera
  valores que SIEMPRE fallan la validación autoritativa.)
- **Fix recomendado**: NO pedir texto libre. Reemplazar el FormField "Vía" por chips/picker con las 5
  opciones del enum, labels es-AR → código enum (`'Subcutánea'→'subcutaneous'`, etc. — existe el mapa
  inverso en `humanizeRoute`, `event-timeline.ts:835-840`). Mantener opcional (null). Alternativa (peor,
  requiere migración + decisión): cambiar la columna a `text` con CHECK de largo — NO recomendada, el enum
  es la validación autoritativa correcta.
- **Nota de alcance**: la firma `route: string | null` de `applyBulkVaccination` (Fase 3, ya gateada) es
  agnóstica; el valor inválido lo introduce ESTA pantalla. El finding pertenece a este chunk.

## False positives descartados (trazabilidad)

| Candidato | Por qué NO es finding |
|---|---|
| IN-list dinámico en `buildExistingVaccinationIdsQuery` (`local-reads.ts:1255-1267`) | Genera `?` placeholders por elemento; los valores van en `args`. Parametrizado, sin concatenación de input. |
| `groupId`/`groupType` desde params de ruta (`vacunacion-masiva.tsx:67-69`) | `groupType` se normaliza a `'rodeo'|'lote'`; `groupId` solo fluye a queries locales parametrizadas sobre datos YA scopeados al tenant por la stream. |
| Fail-OPEN del gating de display (`resolveVaccGatingPredicate`, `vacunacion-masiva.tsx:558-569`) | Es display-only; la barrera real es `tg_sanitary_events_gating` (0054:97-108) que gatea `vaccination` fail-closed server-side en cada INSERT. Verificado en la migración. |
| `productName` interpolado en el preview/CTA | RN `<Text>` auto-escapa; no hay render HTML. |
| `eventDate` del reloj del cliente (`todayISO`) | Mismo patrón ya gateado en las otras masivas (clave idempotente UUIDv5 por fecha local); sin vector nuevo. |

## Tabla de INPUTS (foco del chunk)

| Campo | Límite cliente | Validación server | OK? |
|---|---|---|---|
| **Producto** (`product_name`) | `maxLength={80}` (PRODUCT_NAME_MAX, `vacunacion-masiva.tsx:61,322`; `FormField` lo delega al TextInput nativo, `FormField.tsx:97`) + obligatorio (trim no vacío) | **SÍ, autoritativa**: `sanitary_events_product_name_len_chk CHECK (char_length ≤ 160)` VALIDADO (`0070_check_text_length_caps.sql:227-228`) + `not null` (0027:13). Cliente 80 ≤ server 160 ✓. Parametrizado ✓. | ✅ |
| **Vía** (`route`) | `maxLength={40}` (ROUTE_MAX), opcional → null | **SÍ, autoritativa y MÁS estricta**: enum `sanitary_route` (0027:5,16) — pero el cliente manda texto libre que NO pertenece al enum → rechazo permanente garantizado. | ❌ **VIA-ENUM-MISMATCH (HIGH)** |
| Filtro categoría/sexo (chips) | Valores cerrados derivados de los datos locales (no tipeables) | n/a (solo filtran el conjunto local; no viajan al server) | ✅ |

**Confirmación explícita pedida por el leader**: SÍ, `sanitary_events.product_name` tiene cap server-side
autoritativo (CHECK ≤160 de 0070, constraint validado). El `maxLength` del cliente es UX; el control real
es el CHECK + RLS + trigger de gating.

## El INSERT (foco 2)

- `buildAddVaccinationInsert` (`local-reads.ts:1175-1181`): SQL con placeholders `?`, valores en `args` —
  **parametrizado**, cero concatenación.
- Columnas enviadas: `id, animal_profile_id, event_type('vaccination' literal), product_name, route,
  event_date`. **NO** manda `created_by` (lo fuerza `tg_set_created_by_auth_uid`, 0027:31-33) ni
  establishment alguno (`sanitary_events` no tiene `establishment_id`; el tenant se deriva server-side vía
  `establishment_of_profile(animal_profile_id)` en la RLS). Sin mass assignment (objeto armado campo a campo).

## Autorización server-side (foco 3)

- Cada uno de los N INSERTs sube por el cliente Supabase AUTENTICADO (CRUD plano → PostgREST) → RLS
  `sanitary_events_insert: has_role_in(establishment_of_profile(animal_profile_id))` (0027:38-39) corre por
  fila. Un `animal_profile_id` cross-tenant falla la policy (cubre IDOR-por-FK).
- Capa 2: `tg_sanitary_events_gating` → `assert_data_keys_enabled(['vacunacion'])` fail-closed por INSERT
  (0054:97-108) — el fail-open del display NO es la barrera.
- El preview opera SOLO sobre el SQLite local (`fetchGroupSelectionProfiles`, datos ya scopeados por la
  stream del establishment) — no enumera nada fuera del tenant.
- Sin `createAdminClient()` en el diff (es 100% client-side). Dominio A del catálogo: limpio.

## Fix de comentario en `seleccion-masiva.tsx` (foco 4)

- Diff verificado: **solo líneas de comentario** (~140-158), cero cambio de lógica.
- Veracidad verificada contra `0054_gating_db_layer.sql`: `tg_reproductive_events_gating` gatea
  `tacto`/`tacto_vaquillona`/`inseminacion` (líneas 128-143) — **`weaning` NO se gatea** server-side, y la
  RLS de autorización no mira el data_key. El comentario corregido ahora dice la verdad. ✅

## Tabla de RATE LIMITS

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Vacunación masiva (N INSERTs `sanitary_events`) | NO (sin tope explícito de N) | n/a — sube como CRUD plano del usuario autenticado | La authz sí (RLS + gating por fila) | **LOW** (consistente con castración/destete masivas ya gateadas): N está acotado por el tamaño del grupo del PROPIO tenant, los datos ya están sincronizados localmente, cada fila paga RLS, y no hay endpoint nuevo ni costo externo (email/SMS/API). Sin vector de amplificación cross-tenant. Queda anotado como deuda compartida de las masivas (tope de N por request) — no bloquea este chunk. |
| `previewVaccination` | n/a | n/a | n/a | Solo lectura del SQLite LOCAL; cero requests al server. |

## Archivos analizados

- `app/app/vacunacion-masiva.tsx` (nuevo)
- `app/src/utils/vaccination-preview.ts` (nuevo, puro)
- `app/src/utils/vaccination-preview.test.ts` (nuevo — no auditado como superficie, solo como evidencia)
- `app/src/services/bulk-operations.ts` (`previewVaccination`)
- `app/app/seleccion-masiva.tsx` (comment-only)
- Upstream verificado (no modificado, para trace): `local-reads.ts` (insert/ids-query builders),
  `connector.ts` + `upload-classify.ts` (camino de upload y clasificación de rechazos),
  `FormField.tsx` (maxLength), migraciones `0027`, `0054`, `0070`.

## Cobertura indirecta

- La skill de Sentry no cubre RLS/Postgres ni el modelo PowerSync — esos dominios se revisaron a mano
  contra las migraciones y el connector (arriba). BLE/Deno: no aplican a este diff.
- C4 (stale-auth en replay): cubierto por diseño — cada INSERT se re-autoriza al subir (RLS por fila);
  sin cambios en este chunk.

## Anexo LOW (no bloquea)

- Tope de N (fan-out) por masiva: deuda compartida de TODAS las operaciones masivas de spec 10 (ya señalada
  en gates anteriores como LOW). Si algún día la masiva pasa a una RPC server-side, ahí sí exigir cap de N.
- `humanizeRoute` con valor fuera del mapa muestra el string crudo en el timeline — cosmético, y desaparece
  solo con el fix del finding HIGH.
