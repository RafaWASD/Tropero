# ADR-025 — PII sensible va en una tabla `*_private` self-only, separada del perfil/entidad pública

**Status**: Accepted
**Fecha**: 2026-06-04
**Decisores**: Raf, con decisión técnica delegada al leader vía LLM Council (5 asesores + revisión por pares, veredicto unánime)

## Contexto

RAFAQ es multi-tenant con React Native (Expo) + Supabase (Postgres + RLS). El cliente móvil usa la anon key y lee/escribe a **PostgREST directo** — no hay una capa de API server intermedia para el CRUD. Por lo tanto **RLS es la única frontera de autorización** del lado de datos, y el proyecto va a **PowerSync** (ADR-002).

La auditoría baseline de seguridad (2026-06-04, `progress/security_baseline_shipped.md`, finding **B3-1**) encontró un patrón explotable: la tabla `public.users` mezcla datos de **identidad pública** (`id, name` — visibles a coworkers por diseño, para pantallas tipo "Miembros") con **datos de contacto privados** (`email, phone` — PII regulada por la Ley 25.326 AR, que solo debería ver el dueño). La RLS de Postgres es **row-level, no column-level**: una policy que deja a un coworker ver la fila expone la fila COMPLETA. El cliente "cumplía" pidiendo solo `select id, name`, pero eso es un control client-side bypasseable (cualquier miembro hace `GET /rest/v1/users?select=email,phone`).

Se evaluaron cuatro patrones para ocultar las columnas sensibles. El insight decisivo del council: **realtime y PowerSync sincronizan la tabla base por el WAL (replicación lógica, por fila) — no respetan views, RPCs ni column-GRANTs**. Como RAFAQ va a PowerSync, cualquier solución que viva en la capa PostgREST (view / RPC / column-grant) taparía la query REST pero **dejaría la PII sangrando por el canal de sync**. Solo la **separación física** de la PII a otra tabla cierra el dato en todos los canales (PostgREST + realtime + PowerSync).

Este ADR fija el patrón como canónico porque se va a **replicar en toda lectura de PII multi-miembro** del producto (perfil del vet visible entre campos, datos de contacto de owners/operarios, futuros datos sociales), y resolverlo caso por caso es una fuente de fugas sistémicas.

## Decisión

**Toda columna de PII sensible (contacto, identificadores personales, datos regulados) que viva en una tabla cuyas filas son visibles a otros usuarios del tenant se separa físicamente a una tabla compañera `<entidad>_private`, con `<entidad>_id` como PK/FK y RLS self-only.**

Regla operativa: **cuando una tabla mezcla atributos con políticas de acceso divergentes y permanentes** (unos visibles a coworkers, otros solo al dueño), los atributos privados NO son una propiedad de la entidad pública — son una entidad distinta y deben vivir en su propia fila/tabla. La entidad pública queda con lo que es visible por diseño; la privada con lo sensible y una policy trivial (`<entidad>_id = auth.uid()` o el scope mínimo que corresponda).

**Primera instancia (feature 14, `14-pii-user-private`)**: `email` y `phone` se mueven de `public.users` a `public.user_private (user_id PK, email, phone)` con RLS self-only. `public.users` queda como **perfil público** (`id, name`, timestamps, `deleted_at`). Los lectores legítimos de PII ajena (prechecks de Edge Functions) la leen vía **admin-client** (service-role, que bypassa RLS por diseño y ya se usa así). El email se mantiene en sincronía con `auth.users.email` (la fuente de verdad de auth) vía trigger que propaga solo el email **confirmado**.

Consideraciones de implementación que el patrón exige cada vez que se aplique:
- **GRANTs mínimos** sobre la tabla `*_private` (self-only, sin `anon`, sin auto-expose) — fail-closed.
- **Escritura**: definir cómo se puebla (trigger desde `auth.users`/la entidad, o el flujo de edición del dueño) de forma atómica.
- **PowerSync**: la tabla `*_private` nunca entra en el sync set de coworkers (PII-safe-by-construction en cada device).
- **Analytics**: la PII aislada en una tabla es una única frontera para anonimizar/agregar (pilar de benchmarking sin rozar la regulación).

## Alternativas consideradas

(Pasadas por el LLM Council; veredicto unánime a favor de la separación física. Transcript en la sesión del 2026-06-04.)

- **View `users_public` (id, name) con `security_invoker` + revocar SELECT directo.** Rechazada: las views no se replican por el WAL → la PII viaja por la tabla base en realtime/PowerSync. Además `security_invoker=false` corre como owner y bypassa RLS (riesgo de fuga total ante un bug en el `WHERE`).
- **RPC `get_coworkers()` SECURITY DEFINER.** Rechazada: rompe el modelo declarativo (no filtrable/paginable como un `select`), no escala a "toda la PII" (un RPC por caso), y tampoco protege el canal de sync (realtime sigue sobre la tabla base).
- **Column-level GRANTs (`GRANT SELECT (id, name)`).** Rechazada: PostgREST devuelve 403 para toda la fila si se pide una columna sin permiso (rompe `select=*` y el self), y los column-GRANTs **no aplican al WAL** → la PII se filtra por replicación lógica. Es la que un humano olvida actualizar al agregar una columna (nace visible por default).
- **Status quo (cliente pide solo id,name).** Rechazada: es el agujero (control client-side bypasseable).

## Consecuencias

### Positivas
- **PII-safe en todos los canales** (PostgREST + realtime + PowerSync), no solo en la query REST. Es la única opción que sobrevive al wire de PowerSync.
- **Patrón repetible y a prueba de distraídos**: un `ALTER TABLE ADD COLUMN pii` no re-expone nada, porque la PII vive en otra tabla con policy trivial. La regla de acceso es física, no una lista que alguien mantiene.
- **Minimización de datos** (Art. 4 Ley 25.326): la sensibilidad queda separada por diseño; una sola frontera para anonimizar en analytics.
- **La entidad pública queda limpia** como base correcta para features sociales/colaborativas (perfil del vet cross-campo, etc.) sin tocar la frontera de PII.

### Negativas
- **Una tabla extra por entidad con PII** + joins explícitos cuando el dueño necesita su perfil completo. Deuda barata, pagada una vez.
- **Escritura más compleja**: hay que poblar la `*_private` (trigger/flujo) de forma atómica; el caso `users` necesita un trigger de propagación de email desde `auth.users` (que además cierra un bug latente: hoy `users.email` queda stale tras un cambio de email).
- **Costo de migración** al separar una tabla con datos existentes (backfill → drop). **Barato hoy** (PowerSync no está wired); **caro después** (sync sets en vivo) → conviene aplicar el patrón ANTES de wire PowerSync.

### Reversibilidad
Media. La separación es una migración de schema reversible vía git en cuanto a archivos, pero una vez aplicada al remoto con datos, volver atrás implica otra migración (mover las columnas de vuelta). El patrón en sí (este ADR) es una guía, reversible.

**Relacionado**:
- Feature 14 `14-pii-user-private` — primera instancia del patrón.
- `progress/security_baseline_shipped.md` (finding B3-1) — origen.
- `progress/security_spec_14-pii-user-private.md` — Gate 1 PASS de la primera instancia.
- ADR-002 (tech stack / PowerSync) — la razón decisiva (canal WAL) deriva de la adopción de PowerSync.
- ADR-019 (security_analyzer) — el gate que encontró y validó el finding.
- ADR-014 (invitaciones bearer) — `invitations.email` se evaluó y NO es canal de fuga (RLS owner/self).
