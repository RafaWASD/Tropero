# Contexto — 24 · Visor del audit log (interno miTropero) — Gate 0

> Refinamiento de contexto (ADR-022). Se aprueba ANTES de escribir la spec.
> Origen: Raf quiere una UI para navegar `audit.record_version` en vez de SQL a mano; filtros siempre
> parecidos (fecha, usuario/campo, operationId) + habilitar a Facundo/no-técnicos a revisar. 2026-08-15.

## Problema

El audit log (`audit.record_version`, spec 18, + `request_id` de spec 23) tiene los datos forenses "qué
cambió / quién / cuándo / con qué operationId", pero el único acceso es **SQL** (Management API / MCP,
service_role). No hay forma humana de navegar/filtrar, y las queries son siempre las mismas. Facundo o
alguien no-técnico no puede revisar.

## Objetivo

Un **visor web interno** para miTropero-staff que filtra y muestra el historial forense con los filtros fijos,
sin escribir SQL, sin exponer la tabla directamente al cliente.

## Decisiones cerradas (Raf, 2026-08-15)

- **Audiencia = miTropero interno.** Herramienta de ops/soporte para Raf + Facundo. Ven **TODO** el log
  (cross-tenant). NO es una feature per-tenant para owners (eso se descartó: mucho más complejo/riesgoso y
  no es lo que se necesita). Un solo círculo de confianza (staff).
- **Superficie = web interno.** Página web separada de la app del productor (mejor para navegar tablas; saca
  la herramienta forense de la app de manga). Hosteada donde vive la landing (Cloudflare).

## Arquitectura

```
Staff (Raf/Facundo)
  │  login Supabase (email/pass) → JWT
  ▼
Página web interna (Cloudflare)  ── fetch con Authorization: Bearer <JWT> ──▶
  ▼
Edge Function `audit_query` (vía serveEf → logging + request_id)
  1. requireUser(JWT) → user.id
  2. gate: user.id ∈ miTropero_STAFF (allowlist) — si no → 403
  3. valida filtros (server-side, autoritativo)
  4. SELECT scopeado + paginado sobre audit.record_version (createAdminClient / service_role)
  ▼
filas (op, ts, auth_uid, table_name, request_id, record/old_record) → render en la web
```

**El muro fail-closed del audit NO se toca:** el cliente sigue sin poder leer `audit.record_version` directo
(anon/authenticated revocados). El ÚNICO acceso nuevo es la EF `audit_query`, gateada a staff. La EF es la
frontera de seguridad.

## Alcance a specificar

1. **EF `audit_query`** (nueva, en `supabase/functions/`, usando `serveEf`):
   - `requireUser` + gate de staff por **allowlist en EF secret** `MITROPERO_STAFF_USER_IDS` (uuids separados por
     coma; Raf lo setea con su user_id + el de Facundo). Alternativa considerada (tabla `mitropero_staff`) =
     overkill para 2 personas; env secret es lo mínimo. Si no está en la lista → 403 `not_staff`.
   - **Filtros** (todos opcionales, validados server-side): `from`/`to` (rango de ts), `auth_uid` (uuid),
     `establishment_id` (uuid — se filtra por `record->>'establishment_id'`; hoy solo aplica a user_roles),
     `request_id` (uuid), `table_name` (de una allowlist de tablas trackeadas), `op` (INSERT/UPDATE/DELETE).
   - **Paginación**: `limit` (cap duro, p.ej. 100) + cursor por `id` DESC (o offset). Orden `ts DESC`.
   - **Rate limit**: aunque sea interno, la EF de query lleva un límite (evita abuso / scraping accidental).
   - Devuelve las columnas forenses incl. `record`/`old_record` (el diff es el punto). Sin transformar.
2. **Página web** (Cloudflare, liviana):
   - Login con Supabase (supabase-js, email/pass — Raf/Facundo ya tienen cuenta). Guarda el JWT en memoria.
   - Formulario de filtros (fecha, usuario, campo, operationId, tabla, op) + tabla de resultados con el
     antes/después expandible (JSON diff legible) + paginación.
   - es-AR. No necesita ser bonita como la app, pero legible y usable (filtros claros, diff diffeable).

## Lo que NO entra (diferido)

- Acceso per-tenant (owners viendo su propio audit) — descartado por decisión.
- Prender el audit sobre `animals`/eventos (gate T12) — cuando pase, el visor los muestra sin cambios (ya
  filtra por table_name genérico).
- Export a CSV / alertas — v2 si hace falta.

## Seguridad (Gate 1 OBLIGATORIO — foco)

- **La EF es el único camino de lectura**; el muro fail-closed de `audit.record_version` (spec 18) se
  preserva (verificar `git diff` no toca los grants). Gate 1 debe confirmarlo.
- **Gate de staff**: allowlist server-side (env), nunca del body/cliente. Un user autenticado NO-staff → 403.
- **Validación autoritativa de TODOS los filtros** server-side: uuids con regex+cast, `table_name` y `op`
  contra allowlist (evitar inyección / lectura de tablas no previstas si se ensancha), `limit` con cap duro,
  fechas parseadas. Sin construir SQL por string con input crudo (parametrizado / builder seguro).
- **Rate limit** en la EF.
- **PII**: los `record`/`old_record` pueden traer datos (hoy user_roles = poco; futuro animals = datos de
  campo). Se muestran a **staff** (círculo de confianza) — es forense, es el punto. Documentarlo; NO se
  loguea el body en el logging de la EF (el wrapper serveEf ya no loguea body).
- **La web guarda el JWT en memoria** (no en localStorage persistente si se puede evitar); HTTPS; sin secretos
  del lado cliente (la anon key de Supabase es pública, ok).

## Dependencias / gates

- **Gate 1 (security_analyzer modo spec) OBLIGATORIO** (EF nueva + expone el forense).
- **UI web** → veto de diseño del leader (es web, no RN — checklist adaptado) + capturas. Gate 2.5 aplica pero
  es web (no device).
- **De Raf**: (a) los user_ids de staff (Raf + Facundo) para el secret `MITROPERO_STAFF_USER_IDS`; (b) confirmar
  hosting en Cloudflare (o dónde). El deploy de la EF va gateado como siempre (script + OK en sesión).
- Migración: **ninguna nueva** (solo lee `audit.record_version` existente). Feature nueva **id 24**.

## Defaults del leader (a ratificar en Puerta 0)

- Staff allowlist por **EF secret** (no tabla).
- Frontend **liviano** (HTML + supabase-js + fetch; sin SPA pesada) en Cloudflare.
- Login **email/password** de Supabase (no magic link) para el staff.
- Paginación por cursor `id DESC`, `limit` cap 100, orden `ts DESC`.
