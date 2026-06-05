baseline_commit: 049638732960bcdfb43d7b5bdea03ad6e5102acd

# impl 02-frontend-timeline-orden — BUG de orden del timeline

Feature en curso: **fix de orden del historial de la ficha** (RPC `animal_timeline` + cliente
`event-timeline.ts`/`events.ts`). Frontend + 1 migración (re-emite la RPC). NO toca `0035`.

## El bug (diagnóstico del leader, confirmado)
Un evento **tipado** (servicio/tacto/parto/aborto/peso/condición) cargado HOY aparece **por DEBAJO**
de los eventos del mismo día que tienen hora real (Alta, "Cambió a…", observaciones). La RPC ordena por
`event_date`: los tipados tienen columna `date` → vuelven UTC-medianoche (`00:00`); los de timestamp
real (category_change=`changed_at`, observacion=`created_at`) tienen la hora real (`15:45`). Como
`00:00 < 15:45`, el tipado de hoy cae al fondo del día. El cliente `parseTimeline` RE-ordena por
`Date.parse(eventDate)` → perpetúa el problema.

## El fix — ordenar por (día calendario desc, created_at desc, eventId desc)
Dentro de un mismo día, lo recién registrado (`created_at` más nuevo) queda arriba; entre días, el más
reciente arriba; un evento con fecha vieja (backdated) aparece en SU día (no al tope por cargarse recién).

## Plan (tasks)
- [x] T0 — baseline + progress (este archivo).
- [x] T1 — migración 0069: re-emitir `animal_timeline` con `created_at` top-level (7 orígenes). APLICADA al remoto dev.
- [x] T2 — `event-timeline.ts`: `TimelineRow`+`created_at`, `TimelineItem`+`createdAt` en TODOS los kinds,
       `parseTimelineRow` lo lee; `parseTimeline` ordena por (día calendario desc, createdAt desc, eventId desc).
       Reconciliado el enriquecimiento reproductivo (solo `service_type`; created_at ahora viene de la RPC).
- [x] T3 — `events.ts`: `fetchTimeline` mapea `created_at` (vía parseTimeline); enriquecimiento reproductivo solo `service_type`.
- [x] T4 — tests unit `event-timeline.test.ts` (casos a/b/c/d + backdated + inválido + defensivo) + actualizados los de applyReproMeta. 83/83 verde.
- [x] T5 — e2e `events.spec.ts`: servicio cargado HOY sobre vaquillona → nodo "Servicio" ARRIBA del "Alta"/"Cambió a…" del mismo día (aserción por `boundingBox().y` — arriba = y menor).
- [x] T6 — `node scripts/check.mjs` verde (salvo el FAIL preexistente "2 in_progress", cross-terminal) + `pnpm.cmd e2e` **35/35** verde. Conteos abajo.
- [x] T7 — autorrevisión adversarial (abajo).

## Cómo se aplicó la migración (remoto dev)
La conexión DIRECTA a la DB (pooler :5432) está BLOQUEADA en este entorno y no hay `SUPABASE_DB_PASSWORD`
(`supabase db push`/`migration list` fallan con timeout de socket). Se aplicó vía **Management API**
(`POST https://api.supabase.com/v1/projects/<ref>/database/query`, solo el access token, HTTPS :443) —
el método documentado para entornos remote-only. Detalle:
- `create or replace` falló (42P13: no se puede cambiar el return type al agregar una columna) → la
  migración hace `drop function if exists` antes del `create` (en la misma migración; el grant se
  re-otorga). Idempotente.
- Verificado post-apply: `pg_get_function_result` = `TABLE(event_kind text, event_id uuid, event_date
  timestamptz, created_at timestamptz, payload jsonb)`, `prosecdef=true` (security definer conservado),
  grant a `authenticated` presente, ejecuta sin error bajo el contexto management (devuelve [] porque
  has_role_in filtra sin JWT → prueba que el guard sigue activo). PostgREST recargó el schema (`notify
  pgrst`): el RPC responde [] vía el endpoint REST con la anon key (expuesto y callable). La suite e2e
  (35/35) ejercita el RPC por el cliente real → confirma el path end-to-end con la columna nueva.

## Conteos finales (T6)
- `node scripts/check.mjs`: anti-hardcode **0**, typecheck **OK**, client unit **319/319**, RLS **17/17**,
  Edge **36/36**, Animal **42/42**, Maneuvers **13/13**, User_private **19/19**. Único FAIL = "2 features
  in_progress" — PREEXISTENTE y cross-terminal (01 + 13 de otra terminal; no toqué `feature_list.json`).
- `event-timeline.test.ts` aislado: **83/83** (incluye los 4 casos del bug a/b/c/d + backdated + inválido
  + defensivo + applyReproMeta reconciliado).
- `pnpm.cmd e2e`: **35/35** (incluye el test nuevo "orden del timeline … bug 0069").

## Autorrevisión adversarial (T7) — qué busqué, qué encontré, cómo lo cerré
Revisé como revisor hostil:
- **Comparator de sort consistente / sin NaN**: el `.sort` usa 3 tiers (día desc → createdAt desc →
  eventId). Riesgo de NaN: `-Infinity - (-Infinity)`. CERRADO: cada resta está GUARDADA por un `!==`
  previo (`if (dayA !== dayB)` / `if (msA !== msB)`) → cuando ambos son -Infinity se saltan, no se resta.
  Día/createdAt inválido → -Infinity → cae al fondo sin corromper el orden. Test "eventDate inválido cae
  al fondo" lo cubre. Orden total estable por eventId.
- **Backdated NO salta al tope**: el día manda sobre createdAt. Test (b) lo verifica (peso con fecha vieja
  + createdAt nuevo → va ABAJO de una obs de hoy). El bug "el recién cargado siempre arriba" NO se
  reintroduce: solo arriba DENTRO de su día.
- **date-only de hoy ARRIBA de su día**: test (a) — servicio date-only (00:00 UTC, createdAt 18:30) gana
  al category_change (changed_at 09:00) del mismo día. Es exactamente el bug.
- **Timezone**: `dayKey` usa el MISMO criterio que `formatEventDate`/`isDateOnlyKind` (UTC para date-only,
  local para instantes) → sort y label de fecha SINCRONIZADOS (no podría pasar que un nodo se vea "Hoy"
  pero se ordene en otro día). Test (d) TZ-independiente SIN mutar `process.env.TZ` (V8 cachea el huso;
  construye los instantes con componentes locales + el date-only como literal UTC).
- **deriveCurrentState no se rompe**: no lo toqué; el createdAt repro ahora viene de la RPC (antes de la
  query suplementaria) — MISMA fuente, mismo valor → el desempate tacto-vs-parto del mismo día sigue
  determinístico (tests pasan). Es un cleanup, no un cambio de semántica.
- **Tests que pasan por la razón equivocada**: el e2e usa `boundingBox().y` (posición VISUAL real), no el
  orden del DOM a ciegas; con el sort viejo (event_date desc) el servicio 00:00 caería DEBAJO del Alta
  (hora real) → la aserción FALLARÍA. Es un guard real de la regresión.
- **RLS/multi-tenant/fail-closed**: la migración conserva security definer + has_role_in en los 7 orígenes
  + el grant; verificado por catálogo. No agrego exposición de datos (created_at ya era legible por quien
  lee los eventos; no es PII). PostgREST reload confirmado.
- **Comentarios stale**: cacé y corregí 2 referencias a "createdAt lo enriquece applyReproMeta" (ahora
  viene de la RPC) en `event-timeline.ts` (doc de deriveCurrentState) + el tipo `ReproMeta`/`applyReproMeta`.
- **Scope**: solo toqué `event-timeline.ts`/`events.ts` (+ sus tests + el e2e) + la migración 0069 + esta
  bitácora. NO `0035`, NO `feature_list.json`, NO archivos de otras features (04/PII 0068/EFs/agents), NO
  el resto de `app/`. Sin commitear (puerta humana).

## Estado: LISTO para reviewer + Gate 2 (code). NO marco done (espera reviewer).

## Decisión: día-calendario en el sort (TIMEZONE) — RESUELTA
**Problema**: dos clases de evento conviven en el timeline con representaciones de tiempo distintas:
- **date-only** (weight/condition_score/sanitary/lab_sample/reproductive): columna Postgres `date` →
  la RPC la castea a `timestamptz` → vuelve como **UTC-medianoche** del día tipeado (`2026-06-02T00:00:00+00`).
  Sus **componentes UTC** SON la fecha calendario.
- **instante real** (observacion=`created_at`, category_change=`changed_at`): timestamptz real → su día
  calendario es el **día LOCAL** del dispositivo (lo que el operario llama "hoy").

**Decisión**: el sort extrae el día con un helper `dayKey(item)` que aplica EL MISMO criterio que
`formatEventDate`/`isDateOnlyKind` (la fuente de verdad del display ya consolidada en el FIX1 de C3.1):
- date-only → `getUTCFullYear/Month/Date` (componentes UTC).
- instante real → `getFullYear/Month/Date` (día local).
Devuelve un entero `AAAAMMDD` ordenable. Así un date-only de hoy y un timestamp de hoy caen en EL MISMO
día calendario en cualquier huso, y el orden DENTRO del día lo decide `created_at` (instante real de
inserción) desc. Si NO usáramos el mismo criterio que el display, el sort y el label de fecha quedarían
desincronizados (un evento "Hoy" podría ordenarse como si fuera de otro día). PURA, sin `Date.now()`,
TZ-independiente para la comparación entre días (solo el día importa, no la hora local del instante).
Orden final: **(día calendario desc, createdAt desc, eventId desc)**. Verificado con un test que NO muta
`process.env.TZ` (V8 cachea el huso → mutarlo mid-proceso no es confiable; mismo criterio que los tests
existentes de `formatEventDate`).

## Baseline check (T0)
`node scripts/check.mjs` verde: anti-hardcode 0, typecheck OK, client unit OK, RLS/Edge/Animal/Maniobras/
user_private suites verdes. (Una corrida inicial dio un FAIL transitorio por un cleanup del remoto; la
re-corrida cerró "Entorno listo".)
