# Contexto — 15-powersync (Gate 0, ADR-022)

> Refinamiento de contexto previo a la spec. Cierra las decisiones de fondo para que `spec_author` no improvise.
> Estado: **propuesto** — pendiente de aprobación humana (Raf) para pasar a `context_ready`.
> Fecha: 2026-06-08.

## Objetivo

Integrar **PowerSync** (ADR-002) como la capa offline-first del MVP: SQLite local en el device + sync con Supabase. Cierra **C5 de spec 02** y **Fase 7 de spec 01**, pero el scope cubre **todo el schema as-built**, no solo las tablas de identidad de spec 01.

La instancia Cloud (`rafaq-beta`, región BR) ya está **provisionada** (sesión 2026-06-08, con Raf): rol de replicación `powersync_role` (BYPASSRLS + REPLICATION), publicación `powersync FOR ALL TABLES`, conexión a Supabase con `verify-full`, auth = **Supabase Auth vía JWKS** (el proyecto usa JWT signing keys asimétricas ECC P-256, sin legacy secret). Instance URL guardada por Raf.

## Decisiones de Gate 0

### D1 — Scope del swap: **Data offline / identidad online**
- **Lectura**: se sincroniza **todo el schema** de datos del establecimiento → la app lee de SQLite local y anda offline en todas las pantallas.
- **Escritura offline**: el **camino de campo** (animals/animal_profiles, las 5 tablas de evento, `sessions`, `management_groups`/lotes, `rodeos`) escribe a SQLite local + cola de upload. Es donde el offline-first es no-negociable (la manga sin señal).
- **Online (NO por sync, quedan como hoy)**: las ops de **identidad y administración** — crear establecimiento, invitar, aceptar invitación (Edge Function), gestión de cuenta/email. Spec 01 R9.2 ya las define online; no las tocamos. La invitación se **acepta** server-side (EF), no por sync. **Excepción (Raf, Gate 0):** el **listado de invitaciones pendientes del owner** SÍ se sincroniza para lectura offline (solo la aceptación queda online).
- **Por qué**: menor riesgo (no reescribe flujos ya cerrados y gateados de auth/campos/invitaciones), y entrega offline-first donde de verdad importa.

### D2 — Plataforma: **dual SDK (web ahora + native en dev build)**
- `@powersync/web` (wa-sqlite / WASM) para el navegador = **banco de pruebas de desarrollo** (es lo único disponible sin dev build; Expo Go SDK 56 no soporta módulos nativos). Queda como harness permanente.
- `@powersync/react-native` para device = **target de producción**; veredicto final en el **dev build Android** cuando Raf lo tenga.
- La lógica de sync se escribe agnóstica de plataforma; solo el factory del DB adapter difiere por plataforma.

## Decisiones ya cerradas (heredadas, no se re-abren)

- **Scoping de streams** = por `establishment_id` donde el usuario tiene **rol activo** (spec 01). El contenido de las streams es la **frontera de autorización** → **Gate 1 OBLIGATORIO** sobre la spec antes de deployar a producción.
- **`user_private` self-only**: nunca entra al sync set de un coworker (ADR-025, razón WAL). Solo el dueño recibe su email/phone.
- **Catálogos globales** (`field_definitions`, `system_default_fields`, species/systems/categories): referencia **read-only** sincronizada a todos.
- **Conflictos**: los eventos son **append-only** → sin conflicto. Para filas editables (ej. `animal_profiles`) = **last-write-wins** (default de PowerSync), suficiente para MVP.
  - **Expansión post-MVP** (nota de diseño, NO-MVP): (1) **surfacing** del conflicto en vez de pisada silenciosa; (2) **árbitro server-side** rutando ediciones sensibles por RPCs `SECURITY DEFINER` con reglas de dominio (patrón `exit_animal_profile`/`register_birth`); (3) concurrencia optimista (`version`/`updated_at` + rechazo de stale + audit); (4) merge a nivel campo (CRDT) — overkill para ganadería. Realista para RAFAQ: capas 1+2.

## Clases de sincronización por tabla (insumo para design.md)

> El detalle de cada query de stream lo define `design.md`. Acá solo la clasificación.

| Clase | Tablas | Regla |
|---|---|---|
| **Self-only** | `user_private` | `user_id = auth.user_id()` |
| **Global read-only** | `field_definitions`, `system_default_fields`, species/systems/categories config | sin filtro (referencia) |
| **Per-establishment (rol activo)** | `establishments`, `user_roles`, `users` (perfil público de coworkers), `invitations` (pendientes del owner, lectura), `rodeos`, `animals`, `animal_profiles`, las 5 tablas de evento, `birth_calves`, `category_history`, `sessions`, `maneuver_presets`, `management_groups`, `rodeo_data_config` | `establishment_id ∈` {campos con rol activo} |
| **Online, NO en el sync set** | aceptación de invitación (EF), creación de establecimiento, gestión de cuenta, `import_log` (historial), registro de push tokens | quedan en PostgREST/EF directos |

## Estrategia de retrofit

- Los services del frontend ya están escritos **swappables** (prep del leader). El swap PostgREST→SQLite local debe quedar **localizado** en la capa de services, sin tocar pantallas/hooks.
- Las **mutaciones** del camino de campo se reescriben para ir contra el DB local de PowerSync (con upload queue), preservando la firma del service.
- Las **lecturas** del camino de datos pasan a queries watchables sobre SQLite local (reactividad).

## Edge cases offline (a cubrir en requirements)

- **Mutación encolada de un campo al que se pierde el rol** (`active_lost`): la sube y el server la rechaza por RLS → surfacing del rechazo (alineado con spec 01 R6.10 y spec 03 R10.8).
- **Cambiar de campo activo offline**: funciona si el destino ya sincronizó (spec 01 R9.2); si no, se avisa.
- **Primer login**: el catálogo global se cachea al sincronizar; sin red en el primer arranque = degradación avisada.
- **Tamaño del sync set**: scoping correcto por establecimiento evita bajar data ajena (perf + costo + PII).
- **Token expirado / refresh**: el connector renueva el JWT desde la sesión de Supabase (`access_token`).

## Fuera de scope (NO-MVP)

- Sync de `invitations` para aceptación (sigue por EF).
- Resolución de conflictos custom más allá de LWW.
- Sync de adjuntos/Storage (fotos, PDFs de labs) — feature aparte.
- Hard-delete / retención (esperando SENASA, ya diferido).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Stream mal scopeada → leak cross-tenant o PII por WAL | **Gate 1 obligatorio** + tests de no-bypass por device (espejo de los tests RLS existentes). |
| El swap rompe flujos ya gateados (auth/campos/eventos) | Scope D1 deja identidad online; swap localizado en services; suite E2E + unit corre en cada run. |
| `@powersync/web` con el bundler de Expo web (WASM) | De-riskear temprano con un smoke test de boot del DB local en web. |
| Costo/limites del free tier de PowerSync Cloud | Scoping ajustado + beta de un solo campo; monitorear. |

## Gate de seguridad

**Gate 1 (security_analyzer modo `spec`) OBLIGATORIO** antes de la Puerta 1 humana: las sync streams son frontera de autorización (schema/RLS/auth-sensitive). Foco: cada stream scopea por `establishment_id` + rol activo; `user_private` self-only; sin leak cross-tenant por el canal WAL.
