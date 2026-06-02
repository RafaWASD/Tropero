# Spec 10 — Operaciones masivas por rodeo + vista de grupo — Design

**Status**: borrador para Puerta 1 (status flip de `feature_list.json` pendiente de coordinación).
**Fecha**: 2026-06-01 (sesión 21).
**Fuente**: `context.md` (Gate 0) + `requirements.md` de esta spec + overrides del leader (sesión 21).
**Reusa as-built**: spec 02 (migrations 0013-0049: tablas de evento, `rodeo_data_config`, `field_definitions`/`system_default_fields`, `management_groups`, transiciones, RLS), spec 03 (migration 0054 gating capa 2 `assert_data_keys_enabled`), spec 09 (`AnimalListItem`, find-or-create, path de error de sync R11.5).

> **Regla de oro de esta feature**: una operación masiva = **N eventos individuales idénticos a los que ya se cargan uno por uno**, generados en batch. **No** crea entidades nuevas, **no** crea un "evento colectivo", **no** abre autorización nueva. El grueso del trabajo es **cliente** (UI de vista de grupo + preview + skip-and-report + encolado offline + reporte de sync). El **único delta de DB** es el catálogo del `data_key castracion` + su rama de gating.

---

## 1. Resumen de capas y archivos

### 1.1 Cliente (grueso de la feature) — TENTATIVO en layout, firme en lógica

| Archivo (kebab-case, ver `conventions.md`) | Capa | Qué hace | Cubre |
|---|---|---|---|
| `app/src/screens/home/HomeScreen.tsx` (evolución, spec 01/02) | screen | Inicio rodeo-céntrico: cards de rodeo + cards de lote | R2.1, R2.2 |
| `app/src/screens/group/GroupViewScreen.tsx` | screen | Vista de grupo: config + lista de animales + acciones masivas | R1.1, R1.4, R1.5, R1.6 |
| `app/src/components/GroupActionsBar.tsx` | component | Botonera de las 3 ops masivas (gated) | R1.4, R1.5, R1.6 |
| `app/src/screens/group/BulkOperationScreen.tsx` | screen | Filtro de alcance + preview + confirmación + reporte | R4.1, R4.2, R4.3, R5.6, R10.3, R10.4 |
| `app/src/hooks/useGroupAnimals.ts` | hook | Lista animales activos del grupo (rodeo o lote) vía service | R1.2, R1.3 |
| `app/src/hooks/useBulkOperation.ts` | hook | Orquesta preview → aplicar → encolar → reportar | R3.x, R4.x, R6.x, R10.x |
| `app/src/services/bulk-operations.ts` | service | I/O: arma el conjunto candidato, calcula skip-and-report, genera N mutaciones PowerSync (batch), expone progreso de sync | R3.x, R4.3, R6.x, R10.1, R10.2, R10.5 |
| `app/src/utils/bulk-candidates.ts` | util puro | Filtro candidatos (status active + categoría/sexo + ya-aplicado + gating por rodeo real) — testeable sin I/O | R1.3, R4.1, R4.3, R7.2 |
| `app/src/utils/bulk-idempotency.ts` | util puro | Clave idempotente por animal+tipo+fecha; dedup de re-intentos | R6.1, R6.2, R6.3 |
| `app/src/components/AnimalListItem.tsx` (spec 09, **reuso**) | component | Item de la lista de animales — **no se redefine** | R1.2 |
| `app/src/contexts/RodeoContext.tsx` + `app/src/services/rodeo-config.ts` (spec 02 C1/C2, **reuso**) | context/service | Rodeo activo + `rodeo_data_config` cacheado para gating offline | R1.2, R1.5 |

> **Dependencia de coordinación (frontend en vuelo).** `AnimalListItem` (spec 09), `RodeoContext` + `rodeo-config` (spec 02 chunk C1/C2 — ver `progress/impl_02-frontend-c1-rodeos.md`) y la **home de spec 01** se están construyendo en paralelo. Esta feature **reusa** esos componentes/servicios y **no** los redefine. Si los nombres/firmas finales difieren al implementar, se adaptan los imports (no se duplica lógica). El Inicio rodeo-céntrico es **evolución** de la home ya construida (realiza el rol que ADR-018 ya le asignó; **no** reabre ADR-018).

### 1.2 Backend (delta mínimo)

| Archivo / migration | Qué hace | Cubre |
|---|---|---|
| `supabase/migrations/0056_castracion_data_key.sql` (numeración tentativa, el implementer la fija a la siguiente libre) | Seed del `data_key='castracion'` en `field_definitions` + `system_default_fields` de `(bovino, cría)` + rama de gating `castracion` en el trigger de `sanitary_events` | R3.3, R5.7, R7.3 |
| `supabase/tests/rls/` (runners Node, ADR-012) | Tests RLS/gating del delta de castración + tenant-safety de las N mutaciones | R7.3, R9.2, R9.3 |

> **No hay tabla nueva, ni Edge Function nueva, ni RPC nueva, ni policy RLS nueva.** Toda la persistencia reusa las tablas de evento de spec 02 y el gating de spec 03 (0054). El delta es seed de catálogo + una rama de gating (ver §4).

---

## 2. Modelo de datos — sin tablas nuevas; reuso + un delta de catálogo

### 2.1 Destinos de escritura de cada operación masiva

| Operación masiva | Tabla destino (spec 02 as-built) | `event_type` / forma | `data_key` requerido (gating) | Estado del data_key |
|---|---|---|---|---|
| **Vacunación masiva** | `sanitary_events` (0026) | `event_type = 'vaccination'`, `product_name` de pre-config | `vacunacion` | ✅ ya seedeado (spec 02) |
| **Destete masivo** | `reproductive_events` (0025) | `event_type = 'weaning'`, sobre el perfil del **ternero** | `destete` | ✅ ya seedeado (spec 02) |
| **Castración masiva** | `sanitary_events` (0026) | `event_type = 'treatment'`, `product_name = 'Castración'` (marcador) | `castracion` | ❌ **DELTA de esta spec** (ver §4) |

**Decisión de modelado de la castración (default del autor de spec, dentro del enum existente).** No se crea una tabla `castration_events` ni un `event_type` nuevo en el enum `sanitary_event_type` (`vaccination|deworming|treatment|test|other`). La castración se persiste como `sanitary_events` con `event_type = 'treatment'` (es un procedimiento sanitario), marcada por un **marcador canónico constante** `product_name = 'Castración'` (D4 **cerrado**, ver §4). **Razón**: agregar un valor al enum o una tabla es un delta de schema mayor que el caso de uso MVP no justifica — la castración masiva del MVP solo necesita **dejar el registro del evento** (el **efecto de categoría es Tier 3 DEFERIDO pendiente de Facundo**, R5.7). *(Si Facundo decide que la castración merece su propia categoría/tabla, eso es un refinamiento post-confirmación, no MVP.)*

> **El marcador es defensa en profundidad, no una frontera de autorización (M1, Gate 1 s21).** El gating se ata al `data_key='castracion'` (catálogo) vía el trigger por-animal, no al `event_type`. El marcador `product_name='Castración'` es **load-bearing para la clasificación/UX del gating** (que el trigger sepa que este `treatment` es una castración), **no** para una frontera de tenant/authz. El marcador es **canónico y constante** (lo inyecta programáticamente la op masiva, no lo tipea el operario) y el trigger lo compara **robusto a acento y caso** (§4) para que variantes accidentales no lo esquiven. Pero, honestamente: un cliente que **deliberadamente** mande un no-marcador (ej. `product_name='capado'`) escribe un evento de castración **no-gateado** — sin embargo **no** cruza tenants ni escala privilegios (la RLS por-animal sigue valiendo, R9.2); lo único que logra es saltarse una preferencia de config del **propio** owner del rodeo (¿este rodeo trackea castración?). Por eso es defensa en profundidad, no autorización.

> **Aclaración sobre `sanitary_campaigns`.** El `context.md` dice "vacunación masiva ya tiene sustrato (`sanitary_campaigns` + `sanitary_events`)". Verificado contra el as-built de spec 02 (0026): **`sanitary_campaigns` NO existe todavía** — `sanitary_events.campaign_id` es una columna `uuid` suelta con comentario "FK a sanitary_campaigns que se introduce en feature posterior". Esta spec **no depende** de `sanitary_campaigns`: la vacunación masiva escribe `sanitary_events` directamente (con `campaign_id = NULL`). Si una feature futura introduce `sanitary_campaigns`, la vacunación masiva podrá poblarlo, pero **no es requisito de MVP**. Se documenta para que el implementer no asuma que la tabla existe.

### 2.2 Filtro de candidatos (`status = 'active'`, R1.3)

El conjunto candidato de toda operación masiva se computa en `bulk-candidates.ts` (util puro, testeable):

```ts
// pseudo: candidatos del grupo
candidates = animalProfiles
  .filter(p => p.status === 'active' && p.deleted_at == null)   // R1.3
  .filter(byGroupScope(group))                                  // rodeo_id == group | management_group_id == group
  .filter(byOptionalFilter(filter))                             // categoría / sexo (R4.1)
```

Sobre ese conjunto se aplican los **skips** (R4.3): sexo/categoría incompatible con la operación, gating por rodeo real (R7.2), y ya-aplicado (idempotencia R6.x).

---

## 3. Lógica de aplicación (cliente) — el corazón de la feature

### 3.1 Flujo de una operación masiva

```
GroupViewScreen
  → tap acción masiva (gated por R1.5/R1.6 contra rodeo_data_config del grupo)
  → BulkOperationScreen
      1. filtro de alcance (categoría/sexo opcional)               [R4.1]
      2. computar preview vía useBulkOperation:                    [R4.2]
           - candidatos = bulk-candidates(group, filter)
           - aplicables = candidatos − skips
           - skips agrupados por motivo (ya-aplicado | sexo/cat | rodeo-sin-datakey)  [R4.3]
           - override-warning: animales con category_override que no transicionarán    [R5.6]
      3. mostrar "N eventos sobre M animales" + "K saltados (motivos)" + confirmación  [R4.2]
      4. al confirmar → applyBulkOperation:                        [R3.x, R10.1]
           por cada animal aplicable → generar 1 mutación PowerSync (insert evento)
           batch/encolado (R10.5), idempotencia por animal+tipo+fecha (R6.x)
      5. pantalla de progreso: contador "X de N sincronizados" + rechazos por animal   [R10.3, R10.4]
```

### 3.2 Skip-and-report — categorías de skip (R4.3)

`bulk-candidates.ts` devuelve `{ applicable: Profile[], skipped: { reason, profiles }[] }` con `reason ∈`:
- `already_applied` — el animal ya tiene el evento de esta operación para la fecha (idempotencia, R6.1/R6.2).
- `wrong_sex_or_category` — ej. una hembra en castración masiva; un adulto en destete (no es ternero/a).
- `rodeo_data_key_disabled` — el rodeo real del animal no tiene el `data_key` `enabled` (lote cross-rodeo, R7.2).

El reporte (UI, TENTATIVO) muestra el conteo por motivo. Ningún skip bloquea a los demás (R4.4).

### 3.3 Gating en cliente (capa 1)

- **Grupo = rodeo (R1.5/R1.6)**: la acción se ofrece si el `data_key` está `enabled` en el `rodeo_data_config` del rodeo (cacheado offline vía `rodeo-config` de spec 02, reuso).
- **Grupo = lote cross-rodeo (R7.1)**: la acción se ofrece si **algún** rodeo representado en el lote tiene el `data_key` `enabled`. Al aplicar, `bulk-candidates.ts` resuelve el **rodeo real de cada animal** (`animal_profiles.rodeo_id`) y saltea (`rodeo_data_key_disabled`) los que no lo tienen (R7.2).
- El cliente **nunca** es la única defensa: la capa DB (0054) revalida por animal (R7.3, §4).

### 3.4 `category_override` y destete (R5.6)

Para el destete masivo (única op MVP con efecto de transición, R5.5):
- Un animal con `category_override = true` **no** transiciona (spec 02 R4.9). El preview lo lista en un grupo aparte ("N animales tienen categoría manual y no van a transicionar") y ofrece **revertir el override** (set `category_override = false`, spec 02 R4.10) para incluirlos. El evento `weaning` igual se crea para esos animales (el override solo afecta la **categoría**, no la creación del evento).

---

## 4. Delta de backend (DB) — `data_key castracion` + rama de gating (SCHEMA-SENSITIVE)

> **Esta feature ES SCHEMA-SENSITIVE.** El delta toca `field_definitions` (catálogo, seed), `system_default_fields` (defaults por sistema) y el **trigger de gating capa 2** de `sanitary_events` (migration 0054 de spec 03). Por tocar gating/datos regulados → **requiere Gate 1 (`security_analyzer` modo `spec`) antes de Puerta 1**, igual que spec 03. Justificación de por qué SÍ aplica Gate 1: el delta agrega un `data_key` que **gatea** la escritura de un tipo de evento (defensa en profundidad ADR-021) y debe mantener la propiedad **fail-closed** + tenant-safety de `assert_data_keys_enabled`; un binding mal hecho `castracion`↔destino rompería el gating silenciosamente (riesgo ADR-021 / spec 03 R7.2). Ver §6.

> **Mismo patrón que el delta de razas de la feature 08**: es un delta de catálogo/seed sobre un backend de spec 02 ya `done` (Tier 3 de spec 02 dejó `castracion` explícitamente **fuera** del fold — "no se agrega `castracion`"). Esta spec lo agrega como su propio delta, en migration nueva, sin reabrir spec 02.

```sql
-- 0056_castracion_data_key.sql  (numeración tentativa; el implementer usa la siguiente libre tras 0054/0055)
-- Delta de catálogo de spec 10: data_key 'castracion' para gatear la castración masiva.
-- Es Tier 3 que spec 02 dejó fuera ("no se agrega castracion"); spec 10 lo introduce.

-- (1) Catálogo global (field_definitions): el data_key existe una sola vez (ADR-021).
insert into public.field_definitions (data_key, label, description, category, data_type, ui_component) values
  ('castracion', 'Castración', 'Castración de machos (evento sanitario; efecto de categoría pendiente)',
   'manejo', 'evento_grupal', 'silent_apply')
on conflict (data_key) do nothing;

-- (2) Default por sistema (system_default_fields) para (bovino, cría).
--     default_enabled = false: NO viene tildado por default (el productor lo habilita si castra).
--     required_for_system = false (en cría nada es required, spec 02 R2.9).
--     L1 (Gate 1 s21): el join filtra por .code ('bovino'/'cria'), igual que el seed canónico
--     de 0018 (L88-93) y 0014 (L20-21). NO usar .name ('Bovino'/'Cría', con mayúscula y tilde):
--     el WHERE por name no matchearía ninguna fila y la castración nunca se ofrecería.
insert into public.system_default_fields (system_id, field_definition_id, default_enabled, required_for_system, sort_order)
select s.id, fd.id, false, false, 200
from public.systems_by_species s
join public.species sp on sp.id = s.species_id
cross join public.field_definitions fd
where sp.code = 'bovino' and s.code = 'cria' and fd.data_key = 'castracion'
on conflict (system_id, field_definition_id) do nothing;

-- (3) Rama de gating capa 2 (extiende el trigger de sanitary_events de la 0054 de spec 03).
--     La castración masiva escribe sanitary_events con event_type='treatment' marcado por el
--     MARCADOR CANÓNICO CONSTANTE product_name = 'Castración' (D4 CERRADO).
--
--     MARCADOR CANÓNICO (D4, cerrado en Gate 1 s21 — ya NO a gusto del implementer):
--       product_name = 'Castración'  (constante exacta).
--     El cliente NO la tipea a mano: la op masiva la setea PROGRAMÁTICAMENTE en la pre-config
--     (design §3.1, R3.1) — es un literal del código del cliente, no input libre del operario.
--
--     PROBLEMA de binding (ADR-021 / spec 03 R7.2): event_type='treatment' también lo usan
--     tratamientos curativos NO gateados por 'castracion'. Por eso el gating NO puede ramificar
--     solo por event_type — discrimina por el marcador.
--
--     NORMALIZACIÓN ROBUSTA A ACENTO Y CASO (M1, Gate 1 s21): la comparación NO puede ser
--     `lower(product_name)='castración'` literal — 'Castracion' sin tilde lo esquivaría
--     (fail-open del marcador). La extensión `unaccent` NO está habilitada en este proyecto
--     (verificado: solo `pg_trgm`, 0020), así que se usa una normalización PORTABLE inline con
--     translate() que mapea las vocales acentuadas a su forma sin tilde antes de comparar.
--     Resultado: variantes accidentales de caso/acento ('Castracion', 'CASTRACIÓN', 'castracion')
--     NO esquivan el gating.
--
-- Forma del trigger (reescritura de la FUNCIÓN REAL tg_sanitary_events_gating de la 0054 —
-- H1, Gate 1 s21: el nombre real es tg_sanitary_events_gating, verificado en 0054 L97/L108 y
-- re-revocado en 0055; NO existe ninguna `tg_sanitary_gating`. Reemplazar SOLO el cuerpo de
-- la función; el trigger `sanitary_events_gating` de la 0054 ya bindea a esta función y NO se
-- re-crea acá — preserva la rama de vacunación as-built + el fail-closed):
create or replace function public.tg_sanitary_events_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_type = 'vaccination' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['vacunacion']);
  elsif new.event_type = 'treatment'
        and lower(translate(coalesce(new.product_name,''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'castracion' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['castracion']);
  end if;
  -- otros event_type sanitarios (deworming/test/other/treatment no-castración) no se gatean por esta spec.
  return new;
end; $$;
-- Re-emisión idempotente del revoke (defensa en profundidad, patrón 0055) sobre la función REAL.
-- NO se redefine el trigger sanitary_events_gating (ya existe en 0054) — sería error "trigger ya existe".
revoke execute on function public.tg_sanitary_events_gating () from public, authenticated, anon;
```

**Propiedades preservadas del gating (heredadas de spec 03 / 0054):**
- **Fail-closed** (spec 03 R7.6): `assert_data_keys_enabled` levanta `23514` si el rodeo no se resuelve o falta el `data_key` enabled. La rama de castración lo hereda — un insert de castración sobre un rodeo sin `castracion` enabled se **rechaza por animal** (R7.3).
- **Tenant-safe**: `assert_data_keys_enabled` resuelve el rodeo inline desde `animal_profiles.rodeo_id` del perfil del propio evento; no cruza tenants (spec 03 R7.4).
- **EXECUTE revocado** (SEC-HIGH-01 de spec 02): no se expone como RPC.
- **Riesgo de binding (ADR-021 / spec 03 R7.2) — defensa en profundidad, D4 cerrado**: el marcador `product_name='Castración'` es load-bearing para la **clasificación** del gating (no para authz — ver §2.1). **Mitigación** (D4 cerrado, no opcional): (a) marcador **canónico constante** seteado programáticamente por la op masiva; (b) comparación del trigger **robusta a acento y caso** vía `translate()` portable (la 'Castracion' sin tilde TAMBIÉN se gatea); (c) tests: castración en rodeo con/sin `castracion` → accept/reject; variante de caso/acento (`'Castracion'`) también se gatea; `castracion` existe en `field_definitions`; un `treatment` NO-castración (curativo) no queda gateado por `castracion`. Ver tasks T-DB.3/T-DB.5/T-DB.6.

---

## 5. RLS / seguridad — NO hay superficie de autorización nueva

> Sección explícita pedida por el leader. La operación masiva **no** abre autorización nueva.

**Roles (R9.1).** Disparar una operación masiva de un tipo está permitido a **exactamente los mismos roles** que pueden insertar ese evento individualmente. Verificado contra el as-built de spec 02:
- `sanitary_events` (0026) y `reproductive_events` (0025): grant `insert` a `authenticated` + policy de INSERT `has_role_in(establishment_of_profile(animal_profile_id))` (spec 02 R6.8 / R11.5 — cualquier rol operativo activo: owner, field_operator, veterinarian). La castración (`sanitary_events`) y el destete (`reproductive_events`) heredan esa autorización **sin cambios**.
- La operación masiva genera N inserts que pasan **uno por uno** por esa misma policy de INSERT (R9.2). No hay un endpoint "bulk" privilegiado que la saltee.

**Por qué NO hay policy RLS nueva (R9.4).** No se crea ninguna tabla nueva (las N filas van a `sanitary_events` / `reproductive_events` existentes, con su RLS de spec 02). No se crea ninguna función `SECURITY DEFINER` nueva (se reusa `assert_data_keys_enabled` de 0054; la migration de esta spec solo **reemplaza el cuerpo** de la función real del trigger de gating de `sanitary_events`, `tg_sanitary_events_gating` (0054 L97/L108 — H1, no `tg_sanitary_gating` que no existe), para sumar la rama de castración, manteniendo `revoke execute`). No hay Edge Function. El único delta es seed de catálogo + rama de gating.

**`created_by` se auto-rellena si viene null — NO es no-spoofeable en las tablas de evento (R9.3, corregido H2 Gate 1 s21).** Cada uno de los N eventos hereda el trigger `tg_set_created_by_auth_uid` (0024, "solo si NULL"): `created_by` **defaultea a `auth.uid()` cuando el cliente lo omite** (que es lo que hace la op masiva — no envía `created_by`), pero el trigger **no lo fuerza**: un payload que envíe `created_by` no-NULL **lo respeta**. Por lo tanto un cliente con rol activo en el establishment **puede** spoofear la autoría de un evento, atribuyéndolo a **otro usuario del MISMO establishment**. Esto **no es una brecha cross-tenant** (la RLS `sanitary_events_insert`/`reproductive_events_insert` con `has_role_in(...)` sigue impidiendo escribir sobre otro establishment, R9.2) — es solo **atribución intra-campo**. Es una **condición sistémica pre-existente, documentada como SEC-SPEC-03 (migration 0043)**, que afecta a **todas** las tablas de evento de specs 02/03/09 (usan `tg_set_created_by_auth_uid`, no el `tg_force_created_by_auth_uid` no-spoofeable que sí usan `animal_profiles`/`sessions`/`maneuver_presets`). La feature 10 la **hereda** (escribe los mismos eventos individuales), **no la introduce**. Forzar `created_by` no-spoofeable en las tablas de evento es una decisión arquitectónica transversal, **backlogged** (§9 D7), fuera del scope de spec 10.

**Aislamiento por animal (R9.2).** Cada insert evalúa `has_role_in(establishment_of_profile(animal_profile_id))`. Como los animales de un lote cross-rodeo pertenecen todos al **mismo establishment** (`management_groups.establishment_id`, spec 02 R2.14), no hay cruce de tenants posible vía la operación masiva. Un animal de otro establishment no puede estar en el lote ni en el rodeo del grupo.

**Defensa en profundidad / gating capa 2 (R7.3).** Aunque el cliente filtre (R7.2), cada insert pasa por el trigger de gating (0054 + delta castración): un insert directo por PostgREST/sync de un evento gateado sobre un rodeo sin el `data_key` se **rechaza fail-closed** (spec 03 R7.3/R7.6). La operación masiva no introduce un camino que evite este check.

---

## 6. Gate 1 (security_analyzer modo `spec`) — APLICA

**Conclusión: esta feature requiere Gate 1 antes de Puerta 1.** Es SCHEMA-SENSITIVE: el delta de la 0056 toca el **trigger de gating** (defensa en profundidad ADR-021) de una tabla de evento + datos que alimentan analytics regulado (SENASA). Igual que spec 03, el Gate 1 debe verificar:
- que `assert_data_keys_enabled` sigue **fail-closed** tras sumar la rama de castración (no se introdujo un early-return fail-open);
- que el binding `castracion`↔destino (`event_type='treatment'` + marcador) **no** abre un bypass (un `treatment` curativo legítimo no debe quedar accidentalmente bloqueado, ni un evento de castración debe poder esquivar el gating cambiando `product_name`);
- que el trigger conserva `revoke execute` (no se expone como RPC);
- que no se agregó ninguna policy/función que cruce tenants.

> **Si Gate 1 concluyera que NO aplica**: no es el caso. Hay delta de gating (trigger) sobre tabla de evento + binding nuevo → Gate 1 aplica. No es un puro delta de seed inerte (eso solo —agregar la fila de `field_definitions`— no gatillaría Gate 1; pero la rama de gating del trigger sí). Documentado para no saltearlo.

---

## 7. Offline-first y performance de N mutaciones

**Todo offline (R10.1).** El armado del conjunto, el preview y el `applyBulkOperation` corren sobre la copia local de PowerSync (SQLite) sin red. Los N eventos se insertan localmente (cada uno una mutación PowerSync) y se encolan; al volver la red, PowerSync sincroniza. Reusa exactamente el camino de carga individual de spec 02 (R13.2) — no hay un canal de sync especial para "bulk".

**Mutaciones independientes, no atómicas (R10.2).** Cada uno de los N eventos es una mutación PowerSync independiente. Si la sync falla a mitad, los que entraron quedan; **no** se hace rollback de los exitosos (sería peor offline — context). No se usa una transacción única ni un RPC "bulk transaccional".

**Idempotencia / no-duplicación (R6.x).** `bulk-idempotency.ts` define una clave idempotente por **(animal_profile_id, tipo de operación, fecha de la operación)**. Mecanismo de **dos barreras** (la segunda es obligatoria, M2 Gate 1 s21):
- **Barrera 1 (skip-and-report, primera línea):** al armar el conjunto, se excluyen (skip `already_applied`, R6.2) los animales que **ya tienen** un evento de esa operación en esa fecha (query local: ej. para vacunación masiva, ¿existe `sanitary_events` con `event_type='vaccination'` + `product_name` de la op + `event_date` = fecha de la op + `deleted_at IS NULL` para ese animal?). El criterio exacto de "mismo evento" lo afina el implementer por operación; la propiedad requerida es: **re-ejecutar la misma op sobre el mismo animal en la misma fecha no crea un segundo evento** (R6.1, R6.3).
- **Barrera 2 (id determinístico — OBLIGATORIO, barrera dura):** el `id` (PK) de cada evento se genera **cliente-side de forma determinística** (UUIDv5 sobre un namespace fijo + la clave `(animal_profile_id, tipo de operación, fecha de la operación)`; ver ADR-012). Así, dos syncs concurrentes del **mismo evento lógico** (ej. dos dispositivos del mismo operario aplicando la op offline en paralelo) generan el **mismo UUID** → colisionan en la **PK existente** de la tabla de evento → Postgres/PowerSync trata la segunda como la misma fila (no inserta un duplicado). Esto da dedup **a nivel DB vía la PK ya existente**, **sin** unique constraint nuevo. **No es opcional ni "a elección del implementer"**: el id determinístico es la barrera que cierra el escenario concurrente que la barrera 1 (skip local) no ve hasta sincronizar.

> **Nota**: el MVP no agrega un unique constraint DB de idempotencia adicional (sería un delta de schema sobre tablas de spec 02 con riesgo de falsos positivos en cargas individuales legítimas — ej. dos vacunas el mismo día). No hace falta: la **PK con id determinístico** ya es la barrera DB (dos eventos lógicamente idénticos colapsan en la misma PK; dos vacunas legítimas el mismo día tendrían distinta clave si la op las distingue, o se cargan por el flujo individual que no usa esta clave). Documentado como límite consciente.

**Performance / volumen (R10.5).** Un rodeo grande = cientos a miles de animales → cientos a miles de mutaciones. Estrategia:
- generar las mutaciones en **batches** (ej. chunks de ~100) con `requestIdleCallback`/`InteractionManager` para no bloquear el hilo de UI;
- mostrar progreso ("generando N eventos…") durante el armado y "X de N sincronizados" durante la sync (R10.4);
- el encolado en PowerSync ya hace el upload incremental — no se fuerza un upload sincrónico.

**Reporte de rechazos por animal (R10.3).** Si un evento es rechazado al sincronizar (gating capa 2, tenant-check, race), se reusa el path de error de sync de spec 09 R11.5 (captura el error de sync, lo hace visible al operario con contexto), agregado por animal: la pantalla de progreso lista los animales cuyo evento falló + el motivo, y el contador "X de N" refleja los que sí entraron. Nada se descarta en silencio.

---

## 8. Alternativas descartadas (mínimo una, `docs/specs.md`)

**A. Evento colectivo único (una fila "operación masiva" + N vínculos) — DESCARTADA.** Modelar la operación como **un** registro colectivo (`bulk_operations` con `animal_count`, `config`) en vez de N eventos individuales. Descartada porque: (1) el context lo prohíbe explícitamente ("un evento por animal, NO un evento colectivo"); (2) rompe la corrección individual (R4.5 / spec 02 R6.8.1 — cada evento debe editarse/borrarse solo); (3) rompe la cronología por animal (cada animal debe ver su propio evento en su timeline, spec 02 R10); (4) las transiciones de categoría se disparan por evento individual (spec 02 R7) — un evento colectivo no las dispararía por animal; (5) sería una tabla nueva con RLS nueva (superficie de autorización extra) contra el principio de "no abrir autorización nueva". El costo de N filas es aceptable y consistente con la carga individual.

**B. RPC `SECURITY DEFINER` "bulk" transaccional server-side — DESCARTADA.** Un RPC que reciba el conjunto + la op y haga los N inserts en una transacción atómica en el server. Descartada porque: (1) rompe offline-first (requiere red para ejecutar; el peón en la manga no la tiene — principio 3 de CLAUDE.md); (2) "todo-o-nada" es **peor** offline (context R10.2 — si falla a mitad se pierde todo); (3) abre una superficie `SECURITY DEFINER` nueva que habría que blindar (contra R9.4 y la lección SEC-HIGH-01 de spec 02); (4) duplica el gating (habría que re-implementarlo en el RPC en vez de reusar el trigger por-fila). El modelo elegido (N mutaciones PowerSync independientes + gating por trigger) es offline-first, idempotente y reusa todo el sustrato.

**C. Tabla `castration_events` dedicada + `event_type` nuevo en el enum sanitario — DESCARTADA (para MVP).** Modelar la castración con su propia tabla o un `event_type='castration'`. Descartada para MVP porque el efecto de categoría está **pendiente de Facundo** (R5.7) y agregar tabla/enum es un delta de schema mayor que el caso de uso ("dejar el registro del evento") no justifica todavía. Se usa `sanitary_events` `event_type='treatment'` + marcador. Reabrible cuando Facundo confirme el efecto de categoría (post-MVP).

---

## 9. Decisiones abiertas / coordinación

| # | Tema | Default propuesto | Quién confirma |
|---|---|---|---|
| D1 | **Efecto de categoría de la castración** (R5.7) | NO se implementa en MVP; opciones (novillo / solo sanitario / novillo→invernada) listadas sin elegir | Facundo (CONTEXT/07) |
| D2 | **Transición de destete masivo** (R5.5) | Evento `weaning` se crea; transición de categoría es Tier 2 DEFERIDO (targets `ternera→vaquillona`, `ternero→torito` a confirmar) | Facundo (spec 02 DEFERIDO Tier 2) |
| D3 | **Marca en la madre al destetar** | Fuera de MVP; no se implementa | Facundo |
| D4 | **Marcador de castración en `sanitary_events`** (§2.1, §4) | **CERRADO (Gate 1 s21)**: marcador canónico constante `event_type='treatment'` + `product_name='Castración'` seteado programáticamente por la op masiva; trigger compara robusto a acento/caso (`translate()` portable, `unaccent` no disponible). Defensa en profundidad, no frontera de authz. Ya NO a elección del implementer | cerrado |
| D5 | **Idempotencia: cliente vs unique DB** (§7) | **CERRADO (Gate 1 s21)**: id determinístico (UUIDv5 sobre `(animal, tipo, fecha)`) **obligatorio** → dedup por la PK existente, sin unique constraint nuevo. El skip-and-report es la primera línea. Ya NO "opcional/según implementer" | cerrado |
| D6 | **Numeración de la migration** (`0056_..` está TOMADO; última as-built = 0058) | El implementer fija la siguiente libre (≥ `0059`) tras la última migration mergeada | implementer |
| D7 | **`created_by` no-spoofeable en las tablas de evento** (H2, Gate 1 s21) | **BACKLOGGED, fuera de spec 10.** Forzar `created_by` con `tg_force_created_by_auth_uid` (como `sessions` 0050 / `animal_profiles` 0043) en `sanitary_events`/`reproductive_events`/etc. es una decisión arquitectónica **transversal** (afecta specs 02/03/09 — todas las tablas de evento). Riesgo actual: atribución **intra-tenant** spoofeable (SEC-SPEC-03), **NO** cross-tenant. Spec 10 lo hereda, no lo arregla | Raf (backend transversal) |

---

## 10. Trazabilidad design → requirements (resumen)

- §1.1 (cliente) → R1.x, R2.x, R4.x, R5.6, R10.x
- §2 (destinos + filtro candidatos) → R3.x, R1.3
- §3 (lógica de aplicación, skip-and-report, gating cliente, override) → R4.x, R5.6, R7.1, R7.2
- §4 (delta `castracion` + gating) → R3.3, R5.7, R7.3
- §5 (RLS/seguridad, roles, created_by, tenant) → R9.1, R9.2, R9.3, R9.4
- §6 (Gate 1) → condición de Puerta 1
- §7 (offline + idempotencia + performance + reporte) → R6.x, R10.x
- §8/§9 (alternativas + decisiones abiertas) → R3.4, R5.5, R5.7, R6.1
