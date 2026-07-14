# Contexto — 18-audit-log (Gate 0, ADR-022)

> Refinamiento de contexto previo a la spec. Cierra las decisiones de fondo para que `spec_author` no improvise.
> Estado: **propuesto** — pendiente de aprobación humana (Raf) para pasar a `context_ready` **Y** de ratificar el corte 17→18.
> Fecha: 2026-07-12. Origen: plan aprobado (Fase 4, "audit log server-side" — cortado de feature 17, ver `specs/active/17-observabilidad/context.md`).

## Objetivo

**Audit trail forense server-side, append-only**, para reconstruir **"qué pasó exactamente"** cuando un tester levante un incidente en la beta. Es distinto del **audit de DOMINIO** que ya existe (`import_log`, `export_log`, `category_history`, `animal_events`/timeline): eso es **producto** (le sirve al usuario); esto es **forense raw** (le sirve a Raf para debuggear un incidente, cruzándolo con Sentry y PostHog).

**Es la parte más autónoma del bloque**: 100% server-side, testeable contra dev, **sin cuenta externa** ni interacción con el build → puede llegar a `done` de forma independiente mientras Sentry/PostHog (feature 17) esperan el build verde de Fase 0 + las cuentas de Raf.

## Estado actual (verificado)

- **Existe audit de DOMINIO** (import/export_log, category_history, animal_events/timeline) — se queda **tal cual**.
- **Cero audit forense runtime** (nadie registra el old/new de cada UPDATE/DELETE con el usuario real).
- **as-built de migraciones llega a `0123`** → esta feature es la **migración 0124**.
- **PowerSync sube con el JWT del usuario** → en un trigger server-side, `auth.uid()` **ES el usuario real** (no un service role).

## Decisiones de Gate 0 (lo que se cierra)

### D1 — `supa_audit` vendoreado (la extensión NO está en el catálogo hosted)
- Schema `audit` estilo `supa_audit` **copiado al repo** (migración 0124): `audit.record_version` **append-only** (record_id **estable**, `old_record`/`record` JSONB, `auth.uid()`, `ts`) + `audit.enable_tracking()` / `audit.disable_tracking()`.
- **REVOKE** a `anon`/`authenticated`; schema **NO expuesto** por PostgREST; **lectura solo `service_role`**.

### D2 — Semántica temporal (verificado, va en el header de la migración)
- `auth.uid()` en el trigger = **el usuario real** (por el JWT de PowerSync).
- El `ts` del trigger = **hora del SYNC** (no de la acción). El **"cuándo pasó"** sale de la **fecha del device** que las tablas de evento ya llevan (patrón ya usado en el dominio). Documentar la distinción para no confundir hora-de-sync con hora-de-acción.

### D3 — Orden de tablas por valor (incremental; medir volumen antes de las masivas)
1. `user_roles` / membresías (quién tiene acceso a qué — lo más sensible).
2. `animals`.
3. `treatments`.
4. eventos (peso / sanitario / reproductivo).
5. `rodeos`, `establishments`.
- **NO prender** el tracking sobre tablas que el **import masivo** escribe por miles **sin medir volumen antes** (el free tier tiene 500 MB).

### D4 — Retención
- `pg_cron` mensual, **purge > 90 días**.

### D5 — Pre-requisito de infra (verificar en dev antes de la migración)
- Confirmar que la **publication de PowerSync es `FOR TABLE` explícita**. Si fuera `ALL TABLES`, el `audit.record_version` entraría al **WAL replicado** por PowerSync (leak + costo). (Este mismo punto está en el checklist de setup de PowerSync de feature 16 E.1.)

## Relación con lo existente (no se toca)

- `category_history`, `import_log`, `export_log`, `animal_events`/timeline quedan **tal cual** — son producto.
- No reemplaza `upload-rejections` (eso es surfacing de campo, no forense).

## Edge cases (a cubrir en requirements/tests)

- **Aplicar a dev primero** y correr **las 14 suites** (no debe romper nada existente).
- **Suite backend nueva**: CRUD sobre `animals` con un usuario de test → asserts en `audit.record_version` con el **uid correcto**; `anon`/`authenticated` **NO** pueden `SELECT` (fail-closed).
- **`auth.uid()` NULL** (op sin JWT, ej. un job): registrar igual con uid NULL, no romper el DML.
- **Volumen del import**: no prender tracking sobre las tablas del import masivo sin medir.

## Fuera de scope (NO-MVP)

- **Exponer el audit log en la app** (es forense, backend-only).
- **`pgaudit`** (loguea *statements*, no *filas* — no sirve para "qué cambió").
- **Particionado** del audit log (overkill para la beta).

## Dependencias externas

**NINGUNA.** 100% contra dev, con las herramientas que ya tenemos (MCP Supabase en modo escritura, gateado por el clasificador para el deploy). ← es lo que lo hace arrancable YA.

## Gate de seguridad

**Gate 1 (security_analyzer modo `spec`) OBLIGATORIO**: schema nuevo, `auth.uid()` en triggers, RLS/REVOKE, retención, frontera con el WAL de PowerSync. Foco: `record_version` no legible por `anon`/`authenticated`, schema no expuesto por PostgREST, el tracking no filtra al sync set, la retención no borra de más.

## Preguntas para la Puerta 0 (Raf)

1. **¿Ratificás crear la feature 18** (corte del audit log desde 17)? Si sí, la creo en `feature_list.json` y arranca en paralelo.
2. **¿El orden de tablas por valor** (user_roles → animals → treatments → eventos → rodeos/establishments) te cierra, o hay alguna tabla que quieras priorizar/excluir?
3. **¿Arrancamos con TODAS esas tablas o con un subconjunto** (ej. solo user_roles + animals) para el MVP de la beta y las demás incrementales?
