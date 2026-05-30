# Spec 11 — Transferencia de animal entre campos (re-parenting de historia) — Refinamiento de contexto (Gate 0)

**Status**: Decisiones aprobadas por Raf (sesión 18). Pendiente lectura/aprobación final del `context.md`.
**Fecha**: 2026-05-29 (sesión 18)
**Conducido por**: leader + Raf + scan cruzado (3 agentes, verificado).
**Origen**: audit de spec 09 D2. Raf eligió la transferencia que **preserva historia** (re-apunta eventos) sobre la versión mínima; por su peso se extrajo como sub-spec propia.
**⚠️ Gate 1 OBLIGATORIO**: write cross-tenant + re-parenting masivo. La spec dispara revisión de seguridad.
**Related**: spec 09 (D2, find-or-create, R4.11), spec 02 (animal_profiles, eventos, R4.11/R4.13/R4.14/R4.15, RLS), spec 08 (marcador SIGSA), spec 03 (sessions), spec 01 (roles multi-campo).

> Contrato humano del Gate 0 (ADR-022). El `spec_author` lo lee como fuente de verdad.

## Contexto validado

Un animal (entidad global, `animals`) puede estar activo en un solo campo a la vez (spec 02 **R4.11**). Cuando un usuario, parado en su campo Y, bastonea/busca un TAG de un animal **activo en otro campo X donde el usuario también tiene rol**, se le ofrece **transferirlo a Y preservando su historia**. La transferencia: **crea un `animal_profile` nuevo en Y** (reusa el `animal_id` global) **+ re-apunta la historia del perfil viejo (X) al nuevo + archiva el perfil viejo**, todo **atómicamente**. Se descartó la versión "mínima" (perfil nuevo limpio + viejo huérfano) porque dejaba al animal sin historial visible en Y — inaceptable con analytics como pilar.

## Alcance

**Dentro (MVP)**: el flujo de transferencia con re-parenting de historia, atómico, online, con las resoluciones de abajo. Se ofrece desde el find-or-create de spec 09 (puerta manual o BLE) cuando el animal está activo en otro campo del usuario.

**Fuera**: transferencia cuando el usuario NO tiene rol en el campo de origen (cae en el camino de "informar / unique-violation", spec 09 R4.8 / R5.6); historial de transferencias (`movements`) como entidad — MVP solo deja el estado actual; transferencia masiva (de a un animal en MVP); transferencia offline.

**Depende de**: spec 02 (R4.11 pasa de "futura" a MVP + RPC atómico; tablas de evento + RLS), spec 09 (punto de entrada find-or-create D2), spec 01 (roles en ambos campos).

## Casos y decisiones

### Qué se re-apunta (el "preserva historia")
Del `animal_profile` viejo (X) al nuevo (Y), en la misma transacción atómica:
- Los **5 eventos tipados** (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`) — `UPDATE animal_profile_id`.
- Las **observaciones** (`animal_events`) — `UPDATE animal_profile_id` (y su `establishment_id` denormalizado → al de Y).
- El **historial de categoría** (`animal_category_history`) — `UPDATE animal_profile_id`.
- Los **vínculos reproductivos**: `reproductive_events.calf_id` / `bull_id` que apunten al perfil viejo se re-apuntan al nuevo (el animal sigue siendo madre/toro de su descendencia).
Tras el re-parenting, el perfil viejo queda **sin eventos** y se **archiva** (soft-delete o `status='transferred'` con `exit_reason='transfer'` — definir en design cuál preserva mejor el rastro en X).

### Resoluciones de los campos conflictivos (decisiones Raf + defaults del leader)
- **`management_group_id` (lote) → `NULL`** (decisión Raf). El animal llega a Y sin lote (consistente con el ternero al pie que no hereda lote, R9.1). El productor de Y lo asigna si quiere.
- **`idv` (único por establecimiento)** → intentar **conservarlo** en Y; si **colisiona** con un `idv` existente en Y, dejarlo **NULL** y avisar al operario que lo complete (R4.13.a permite `NULL→valor` después). El `tag_electronic` (identidad global) se preserva siempre.
- **`session_id` de los eventos re-apuntados** → **nullear**. Esos `session_id` apuntan a sesiones de MODO MANIOBRAS del campo viejo (X), cross-tenant; conservarlos dejaría un puntero inaccesible por RLS. Se pierde el link a la sesión original (aceptable; el evento conserva su `event_date`/`created_by`).
- **Rodeo destino en Y** → misma lógica que CREATE de spec 09 (R4.4): si Y tiene 1 rodeo activo → fijo; si ≥2 → combo con default `lastRodeoSelected`. **Solo rodeos del mismo sistema** que el de origen (consistente con R4.5.1 relajada — no cae en dead-end de categoría cross-sistema).
- **Marcador SIGSA**: el marcador vive por **(establecimiento, animal)** (spec 08). Como está keyeado por establishment, **no carga** al perfil de Y: el animal arranca **no declarado** en Y (declara bajo el RENSPA de Y). El registro de declaración de X queda como histórico de X. **Nada que resetear** — la cardinalidad lo resuelve.

### Linaje cruzado (complejidad flagged para design/Gate 1)
Si el animal es madre/toro y su descendencia **queda** en X (no se transfiere), tras la transferencia el `calf_id`/`bull_id` de los eventos re-apuntados vincula un evento ahora en Y con terneros en X. La navegación "ternero (X) → su madre" resuelve vía el `animal_id` global a la madre, ahora en Y. **Visibilidad por RLS**: si el viewer del ternero (X) no tiene rol en Y, ve "madre en otro campo" (mismo patrón que el caso cross-establishment de spec 09). **No se rompe el vínculo** (consistente con R4.15: las fichas toleran madre/toro inaccesible/archivado). El design debe definir el copy/UX de ese caso.

### Atomicidad, roles, online
- **Atómica**: RPC / Edge Function que hace crear-perfil + re-apuntar-todo + archivar-viejo en una transacción. **Nunca** deja el animal con cero ni dos perfiles activos (R4.11 sigue valiendo).
- **Roles**: solo se ofrece si el usuario tiene **rol activo en X y en Y**. Si solo en Y, el animal de X no es visible/escribible vía RLS → cae en el camino de informar (spec 09 R4.8/R5.6). **Gate 1** valida que el write cross-tenant exige rol en ambos.
- **Online**: la transferencia **requiere conexión** (toca datos de X que deben estar firmes; análogo a crear-campo, spec 01 R9.2). No se encola offline.

### Punto de entrada (spec 09)
- Desde el find-or-create (D2): TAG/ID de un animal activo en otro campo del usuario → en vez del error, ofrecer **"Transferir a este campo"**. Confirmación con preview ("vas a traer este animal con su historia desde el campo X").

## Pendientes (CONTEXT/07 / Gate 1)
- **Gate 1 de seguridad** sobre el RPC/Edge Function de transferencia (cross-tenant write).
- Design: copy/UX del linaje cruzado (descendencia que queda en X); elección archivar-vs-soft-delete del perfil viejo; manejo de colisión de `idv`.
- Performance del re-parenting (animal con mucha historia = muchos UPDATEs en una transacción).

## Insumos para spec_author
- spec 09 `context.md` D2 (decisión + complejidades). spec 02 R4.11 (pasa a MVP + RPC), R4.13 (TAG inmutable, idv NULL→valor), R4.14/R4.15 (baja/vínculos), tablas de evento + RLS R11. spec 08 (marcador SIGSA por establecimiento-animal). spec 03 (sessions). spec 01 (roles multi-campo, R9.2 online).

## Aprobación
- **Decisiones aprobadas por Raf (sesión 18)**: re-parenting que preserva historia; lote→NULL; idv conservar-o-NULL; session_id→null; rodeo destino como CREATE mismo-sistema; SIGSA por cardinalidad; linaje cruzado tolerado (RLS); atómica + roles-en-ambos + online. **APROBADO por Raf (sesión 18, 2026-05-29)** → 11 pasa a `context_ready`. **Gate 1 obligatorio al redactar la spec.**
