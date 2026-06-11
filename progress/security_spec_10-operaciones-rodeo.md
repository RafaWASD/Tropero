# Gate 1 — Security review (modo `spec`) — Spec 10 Operaciones masivas por rodeo

**Veredicto (RE-RUN sesión 21): PASS**

**Fecha**: 2026-06-01 (sesión 21, re-run tras fix loop).
**Analista**: security_analyzer (modo `spec`, ADR-019).
**Input**: `specs/active/10-operaciones-rodeo/{requirements,design,tasks}.md` (refinados tras el FAIL previo).
**Sustrato re-verificado contra as-built** (no contra lo que dice la spec): 0014 (`systems_by_species` seed), 0018 (`system_default_fields` seed canónico), 0024 (`tg_set_created_by_auth_uid`), 0026 (`reproductive_events`), 0027 (`sanitary_events`), 0043 (`tg_force_created_by_auth_uid`, SEC-SPEC-03), 0054 (gating capa 2), 0055 (revoke check), 0020 (extensiones: solo `pg_trgm`, NO `unaccent`). Última migration as-built: **0058**.

> **⚠️ OBSOLETO (2026-06-11)**: este PASS auditó el delta viejo (data_key `castracion` + rama de gating + marcador), eliminado por la reconciliación Gate 0 v2. La corrida vigente es la sección **"Gate 1 — Spec reconciliada v2 (2026-06-11)"** al final de este archivo.

> **Resultado del re-run**: los **5 findings** del FAIL previo (H1, H2, M1, M2, L1) quedan **CERRADOS**. Cada fix fue verificado contra el código real, no contra la prosa de la spec. **No se detectaron findings nuevos** introducidos por los fixes. Quedan 2 observaciones no-bloqueantes (anexo) que no degradan seguridad. La spec puede pasar a Puerta 1.

---

## Estado de los 5 findings previos

| # | Finding original | Estado | Verificación |
|---|---|---|---|
| **H1** | `design §4` reescribía `tg_sanitary_gating` (inexistente) → castración fail-OPEN | **CERRADO** | El bloque SQL del design (§4 L175-189), tasks T-DB.3 y la prosa §5/§6 usan ahora **`tg_sanitary_events_gating`** — el nombre real verificado en 0054 L97/L108 y 0055 L18/L34. El `revoke execute` también apunta a la función real. No re-crea el trigger `sanitary_events_gating` (correcto: ya existe en 0054). |
| **H2** | R9.3 afirmaba `created_by` "forzado, no spoofeable" — falso contra as-built | **CERRADO (Path A)** | R9.3, design §5 (L210), acceptance global (L152) y T-DB.8 dicen ahora la verdad: `created_by` **defaultea si null** vía `tg_set_created_by_auth_uid` (0024, "solo si NULL"), **spoofeable intra-tenant**, **no** cross-tenant (RLS lo impide), SEC-SPEC-03 heredado. El fix transversal queda backlogged como **D7**, fuera de spec 10. No queda ninguna afirmación de "no spoofeable" colgada. |
| **M1** | Binding de castración por free-text `'castración'` → bypass por caso/acento | **CERRADO** | D4 cerrado (ya no "a gusto del implementer"). Marcador canónico constante `product_name='Castración'` seteado programáticamente; comparación robusta vía `translate()` portable. Verifiqué que la normalización **realmente cierra** el bypass de caso/acento y que el gating sigue fail-closed (ver detalle abajo). |
| **M2** | Idempotencia 100% client-side, id determinístico "opcional" → dup en sync concurrente | **CERRADO** | R6.1, design §7 (barrera 2), D5 y T-CL.5/T-CL.6 exigen el `id` PK determinístico (UUIDv5) **OBLIGATORIO** ("NO opcional", "barrera dura"). Dedup por la PK existente, sin unique constraint nuevo. |
| **L1** | Seed `system_default_fields` filtraba por `.name` (no matchearía) | **CERRADO** | design §4 (L141-146) y T-DB.2 usan `sp.code='bovino' and s.code='cria'`, idéntico al seed canónico de 0018 L88-92. Verificado contra 0014 (los `.code` son `'bovino'`/`'cria'`; los `.name` son `'Bovino'`/`'Cría'` — el `.name` efectivamente no matchearía). |

---

## Verificación detallada de cada fix

### H1 — CERRADO. Nombre real `tg_sanitary_events_gating`, cuerpo correcto.

`design.md §4` (L175-189) ahora emite:

```sql
create or replace function public.tg_sanitary_events_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_type = 'vaccination' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['vacunacion']);
  elsif new.event_type = 'treatment'
        and lower(translate(coalesce(new.product_name,''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'castracion' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['castracion']);
  end if;
  return new;
end; $$;
revoke execute on function public.tg_sanitary_events_gating () from public, authenticated, anon;
```

Verificado contra **0054 L97-108**: la función real se llama `tg_sanitary_events_gating` y el trigger `sanitary_events_gating` ya la bindea. Verificado contra **0055 L18/L34**: el nombre canónico re-revocado es `tg_sanitary_events_gating`. Confirmaciones puntuales:

- ✅ El `create or replace` apunta al **nombre real** → reemplaza el cuerpo de la función ligada al trigger existente (ya no crea una función huérfana). La castración **sí** se gateará.
- ✅ Preserva la rama de vacunación as-built (`if new.event_type='vaccination' → ['vacunacion']`), idéntica a 0054 L100-101.
- ✅ La rama de castración solo **llama** a `assert_data_keys_enabled` (no introduce early-return) → hereda el fail-closed de 0054 L42-46/L60-64.
- ✅ El `revoke execute` apunta a `tg_sanitary_events_gating` (idempotente, patrón 0055 L18). No reexpone como RPC.
- ✅ Design L188 instruye explícitamente **NO** re-crear el trigger (evita el error "trigger ya existe"). Correcto.
- ✅ tasks T-DB.3 nombra la función real, no "reemplazar `tg_sanitary_gating`".

Las menciones residuales de `tg_sanitary_gating` (requirements L193, design L172/L208, tasks L17) son todas **prosa correctiva** ("el nombre real es X, NO `tg_sanitary_gating` que no existe") — ninguna es una instrucción a reescribir esa función. Sin riesgo.

### H2 — CERRADO (Path A). Afirmación corregida, exacta contra as-built.

Verifiqué la nueva R9.3 (requirements L135) palabra por palabra contra el trigger real:

- As-built (0024 L5-12): `tg_set_created_by_auth_uid` hace `if new.created_by is null then new.created_by := auth.uid()` → **solo si null**, respeta payload no-NULL.
- As-built (0027 L31-33, 0026 L58-60): `sanitary_events` y `reproductive_events` ejecutan ese trigger (no el forzado).
- As-built (0027 L38-39, 0026 L65-66): la policy de INSERT es `with check (has_role_in(establishment_of_profile(animal_profile_id)))` — **no restringe `created_by`**.

La R9.3 corregida afirma exactamente eso: "defaultea a `auth.uid()` cuando el cliente lo omite … no se fuerza … spoofeable intra-tenant … no brecha cross-tenant … SEC-SPEC-03 heredado … forzar es transversal backlogged (D7)". **Exacto.** El trigger no-spoofeable `tg_force_created_by_auth_uid` (0043 L15-20) sigue reservado a `animal_profiles`/`sessions`/`maneuver_presets` — la corrección lo cita correctamente y NO afirma que las tablas de evento lo usen.

Barrido de afirmaciones colgadas: grep de `no spoofeable|forzado server|fuerza server|forzar created_by|sin permitir spoofear` sobre los 3 docs → **0 afirmaciones positivas de "no spoofeable"**. Las únicas ocurrencias (requirements L135/L194, design L210/L271) son la **negación honesta** ("NO es no-spoofeable", "es spoofeable") o el changelog/D7. ✅ Ninguna afirmación de seguridad falsa sobrevive.

T-DB.8 fue reescrito coherentemente: testea (a) default si-null y (b) tenant-isolation por RLS — y **explícitamente NO** testea "spoof sobrescrito" (que fallaría contra el as-built). El test ahora puede pasar.

### M1 — CERRADO. La normalización `translate()` cierra el bypass de caso/acento y el gating sigue fail-closed.

`unaccent` confirmado **ausente** (0020 L61 solo `create extension pg_trgm`). El uso de `translate()` portable está justificado.

Tracé la expresión `lower(translate(coalesce(product_name,''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'castracion'` contra todas las variantes plausibles del marcador:

| `product_name` | translate → | lower → | ¿= `'castracion'`? |
|---|---|---|---|
| `'Castración'` (canónico) | `'Castracion'` | `'castracion'` | ✅ gatea |
| `'Castracion'` (sin tilde) | `'Castracion'` | `'castracion'` | ✅ gatea |
| `'CASTRACIÓN'` | `'CASTRACION'` | `'castracion'` | ✅ gatea |
| `'castración'` | `'castracion'` | `'castracion'` | ✅ gatea |
| `'Ivermectina'` (curativo) | `'Ivermectina'` | `'ivermectina'` | ✅ NO gatea (correcto, no bloquea tratamiento curativo) |

- ✅ El orden `lower(translate(...))` es correcto: translate cubre acentuadas mayúsc. **y** minúsc. (`áéíóúÁÉÍÓÚ`→`aeiouAEIOU`), y el `lower` final colapsa el caso. Toda combinación de caso/acento del literal "castracion" matchea. La palabra "castración" no contiene `ñ`/`ü`/otras especiales → el set de translate es **completo** para este marcador.
- ✅ Fail-closed preservado: la rama solo **llama** a `assert_data_keys_enabled(['castracion'])`, que mantiene el `raise 23514` si el rodeo no resuelve o falta el data_key (0054 L42-64).
- ✅ Marcador seteado **programáticamente** por la op masiva (R3.3, design §2.1) — el operario no lo tipea → no hay input libre que escape por casualidad.
- ✅ Correctamente documentado como **defensa en profundidad, no frontera de authz** (design §2.1 L55) — un no-marcador deliberado escribe un `treatment` no-gateado del **propio** tenant, sin cruce ni escalada. Coincido con la clasificación.
- ✅ T-DB.5 ahora exige el test de la variante sin tilde (`'Castracion'`/`'CASTRACIÓN'` **también** gatean) + el falso-positivo inverso (curativo no gateado). Cubre el bypass.

Residual aceptado (ya documentado): un marcador **deliberadamente** distinto (`'capado'`) esquiva el gating de `castracion`, pero eso es config del propio owner, no authz. Correctamente fuera de scope de seguridad.

### M2 — CERRADO. Id determinístico OBLIGATORIO, firme en R/design/tasks.

- R6.1 (requirements L103): "**`id` (PK) determinístico OBLIGATORIO** derivado de `(animal_profile_id, tipo de operación, fecha)` — UUIDv5 sobre un namespace fijo — de modo que dos syncs concurrentes … colisionen en la PK". Firme, no "opcional".
- design §7 barrera 2 (L238): "**OBLIGATORIO, barrera dura** … **No es opcional ni 'a elección del implementer'**".
- D5 (L269): "**CERRADO** … obligatorio … Ya NO 'opcional/según implementer'".
- T-CL.5/T-CL.6: "determinístico **OBLIGATORIO** … NO un UUID random; NO 'opcional/chequeo-local a elección'" + test de determinismo (misma clave → mismo UUID → colisión de PK).

Mecanismo verificado conceptualmente: con el id derivado por UUIDv5 de la clave lógica, dos devices generan el **mismo** PK → el segundo insert colapsa en la fila existente (no duplica), sin necesidad de unique constraint nuevo. Cierra el escenario concurrente que la barrera 1 (skip local) no ve hasta sincronizar. ✅

### L1 — CERRADO. Seed por `.code`.

- design §4 L141-146 + T-DB.2: `where sp.code = 'bovino' and s.code = 'cria' and fd.data_key = 'castracion'`.
- Verificado contra **0018 L88-92** (seed canónico usa `sp.code='bovino' and s.code='cria'`) y **0014 L21** (`code='cria'`, `name='Cría'`). El `.code` matchea; el `.name` no habría matcheado. Corregido correctamente. El comentario del design L138-140 documenta el porqué (anti-regresión para el implementer).

---

## ¿Los fixes introdujeron algo nuevo? (chequeo adversarial)

Revisé los deltas por regresión. **No hay finding nuevo.** Detalle:

- **`translate()` + `security definer`**: la función mantiene `set search_path = public` (design L176) → `translate`/`lower` resuelven a `pg_catalog`, sin riesgo de search-path hijacking. ✅
- **Marcador canónico programático**: no abre input nuevo del operario; es un literal del cliente. No agrega superficie. ✅
- **Id determinístico UUIDv5**: no es un secreto ni un control de acceso; la dedup por PK es fail-safe (en la dirección de NO-crear, nunca de crear-de-más). No habilita a un atacante a suprimir el evento de otro: el namespace+clave incluye `animal_profile_id`, y la RLS de INSERT sigue exigiendo `has_role_in` → un atacante sin rol no puede ni insertar ni "pre-ocupar" la PK de un animal de otro tenant. ✅
- **D7 backlog**: el fix transversal de `created_by` queda fuera de spec 10 correctamente; no se intenta tocar tablas de spec 02 `done` desde acá. ✅
- **Numeración (D6)**: corregida a ≥0059 (0056 está tomado, última as-built 0058). ✅
- **IDs de R**: ninguno cambió; la cobertura context→R sigue intacta (verificado en el changelog L198). ✅

---

## Dominios re-revisados (trazabilidad)

| Dominio | Resultado re-run |
|---|---|
| Trigger de gating capa 2 (`tg_sanitary_events_gating`, rama castración) | ✅ H1 cerrado (nombre real) + M1 cerrado (normalización robusta). Fail-closed preservado. |
| Fail-closed de `assert_data_keys_enabled` | ✅ Intacto (la rama solo llama, no early-returna; 0054 sin cambios). |
| `revoke execute` sobre SECURITY DEFINER | ✅ Apunta al nombre real; idempotente; no reexpuesto como RPC. |
| Aislamiento multi-tenant en N mutaciones bulk | ✅ Sin cambios; RLS por animal intacta; sin endpoint bulk privilegiado. |
| `created_by` (foco #5) | ✅ H2 cerrado (afirmación honesta, Path A); D7 backlog. |
| Datos regulados SENASA / audit trail | ✅ M2 cerrado (no-duplicación por PK determinística); H2 documenta el límite intra-tenant honestamente. |
| Seed de catálogo (`field_definitions`/`system_default_fields`) | ✅ L1 cerrado (`.code`). Sin riesgo de seguridad. |

## Dominios excluidos (sin cambios respecto del FAIL previo)

- Edge Functions / RPC nuevas: R9.4 + T-DB.9 declaran y verifican que NO se crean. No aplica.
- Auth / tokens / sessions / secrets: la feature no los toca. No aplica.
- Endpoints públicos nuevos: toda escritura va por tablas existentes vía PostgREST/PowerSync con RLS. No aplica.
- PII nueva: no se agregan campos de PII. No aplica.

---

## Anexo — Observaciones no-bloqueantes (no degradan seguridad, no cambian el PASS)

- **O1 (informativo, no-security) — clave de idempotencia por `(animal, tipo, fecha)` sin discriminar producto/payload.** Para vacunación, dos vacunas **legítimamente distintas** (productos distintos) sobre el mismo animal el mismo día colapsarían a la misma PK si la op no folda el producto en la clave. El design §7 nota (L240) ya lo reconoce y delega al implementer afinar la clave por operación ("dos vacunas legítimas el mismo día tendrían distinta clave si la op las distingue"). **No es un hueco de seguridad**: la dirección de falla es **no-crear** (fail-safe para dedup), no fuga ni duplicación. Lo dejo como nota para que el implementer incluya el discriminante de producto/op en la derivación del UUIDv5 donde aplique. Sin impacto en el veredicto.

- **O2 (informativo) — verificación de `translate()` queda como test de implementación.** La portabilidad de `lower(translate(...))` se validó por inspección acá; conviene que T-DB.5 corra efectivamente las variantes `'CASTRACIÓN'`/`'Castracion'` contra la función real en el runner RLS (ADR-012) para blindar contra un typo en el set de `translate` al implementar. Ya está pedido en T-DB.5; solo subrayo que es el test que cierra M1 en código.

---

## Resumen ejecutivo para el leader

- **RE-RUN: PASS.** Los 5 findings del FAIL previo (H1, H2, M1, M2, L1) están **CERRADOS**, cada uno verificado contra el as-built (no contra la prosa de la spec).
- **H1** (fail-OPEN de castración por nombre de función inexistente): cerrado — usa `tg_sanitary_events_gating` real, cuerpo y revoke correctos.
- **H2** (afirmación falsa de `created_by` no-spoofeable): cerrado Path A — la spec ahora dice la verdad (spoofeable intra-tenant, no cross-tenant, SEC-SPEC-03 heredado); fix transversal backlogged como D7. Ninguna afirmación de "no spoofeable" sobrevive.
- **M1** (bypass de caso/acento del marcador): cerrado — `translate()` portable + `lower`, verificado que toda variante de caso/acento de "castracion" gatea y el curativo no se bloquea; fail-closed intacto.
- **M2** (dup en sync concurrente): cerrado — id UUIDv5 determinístico OBLIGATORIO (firme en R6.1/§7/D5/tasks), dedup por PK.
- **L1** (seed por `.name`): cerrado — `.code`, idéntico al seed canónico 0018.
- **Ningún finding nuevo** introducido por los fixes (chequeo adversarial de regresión: search_path, marcador programático, dedup fail-safe, D7 fuera de scope, IDs de R intactos).
- **2 observaciones no-bloqueantes** (O1 clave de idempotencia sin discriminar producto — fail-safe; O2 test de `translate` en runner — ya pedido). Ninguna cambia el PASS.
- **Decisión arquitectónica escalada en el FAIL previo (H2 Path B)**: correctamente backlogged como **D7** (forzar `created_by` en tablas de evento = transversal a specs 02/03/09). El leader/Raf decide si lo abre como spec propia; **no bloquea Puerta 1** de spec 10.

**La spec 10 puede avanzar a Puerta 1.**

---
---

# Gate 1 — Spec reconciliada v2 (2026-06-11) — RE-CORRIDA COMPLETA

**Veredicto: PASS** — 0 HIGH / 2 MEDIUM / 3 LOW.

**Fecha**: 2026-06-11.
**Analista**: security_analyzer (modo `spec`, ADR-019).
**Input**: `specs/active/10-operaciones-rodeo/{requirements,design,tasks}.md` reescritos 2026-06-11 (Gate 0 v2 `context-v2-seleccion.md` + staleness vs Tier 2). El PASS de sesión 21 (arriba) queda **obsoleto**: auditaba el delta `castracion` eliminado.
**Sustrato verificado contra as-built** (código real, no prosa): 0019/0020 (grants `select,insert,update` a authenticated en `animals`/`animal_profiles`), 0021 (validaciones BEFORE de `animal_profiles`), 0022 (RLS `animal_profiles_update` using=with check `has_role_in`; `animals_update` original), 0030 (`animal_category_history.changed_by = auth.uid()`), 0031/0042 (`apply_auto_transition` + revoke SEC-HIGH-01), 0036 (block tag change), 0040 (revert override), 0054 (gating: solo `vaccination` y tacto/tacto_vaquillona/service-ai — `weaning` SIN rama, confirmado), 0060 (`animals.is_castrated not null default false`), 0062 (`compute_category` lee `a.is_castrated` de `animals`, rama macho simétrica), 0063, 0064 (guard as-built L29-31 `false→true` only — confirmado), 0070 (caps de texto server-side), 0071 (`animals_update` using=with check sobre "algún perfil con `has_role_in`"), 0079 (patrón denorm: force + propagación), `sync-streams/rafaq.yaml` (`est_animal_profiles`: `SELECT * WHERE establishment_id IN org_scope AND deleted_at IS NULL`). Inventario completo de triggers reales sobre `animal_profiles` (14) y `animals` (5) levantado por grep para el análisis de orden e interacción.

---

## Verificación de los 8 focos pedidos por el leader

### Foco 1 — No-loop del trío write-through / propagación / recompute: ✅ CIERRA (con una imprecisión documental → M1)

Tracé todos los caminos contra los triggers reales:

1. **Cliente UPDATE `animal_profiles.is_castrated`** (perfil P1, campo A) → BEFORE: `normalize_future_bull` (auto-clear, solo NEW) → AFTER `OF is_castrated`: `writethrough` → `UPDATE animals … AND is_castrated IS DISTINCT FROM new.is_castrated` (1 fila).
2. **Sobre `animals`** (AFTER `OF is_castrated`, orden alfabético): `animals_apply_castration` (recompute del perfil activo → `apply_auto_transition` → UPDATE `OF category_id`, que NO dispara nada de `is_castrated`) y luego `animals_propagate_is_castrated` → UPDATE de los perfiles `WHERE is_castrated IS DISTINCT FROM` → **P1 ya tiene el valor → no se toca**; los demás perfiles (P2…Pn, multi-perfil/animal compartido) se actualizan.
3. **Write-through de P2…Pn**: dispara, pero su UPDATE a `animals` lleva `AND is_castrated IS DISTINCT FROM` → **0 filas** → ningún trigger row-level dispara → **fin de la cadena**. Cero recursión, incluso multi-perfil. La oscilación es imposible: cada paso solo escribe cuando hay diferencia y escribe el MISMO valor (convergencia monotónica dentro de la transacción).
4. **Camino inverso** (UPDATE directo a `animals.is_castrated`, permitido as-built por 0071): propagación → perfiles → write-through no-op. Simétrico, cierra igual.
5. Bonus verificado: la propagación de `is_castrated` dispara `normalize_future_bull` en TODOS los perfiles (`OF is_castrated` está en su lista de eventos) → el auto-clear de R12.4 es efectivamente transversal a todos los perfiles del animal, como afirma design §4.2.

**Pero**: la afirmación del design §6.1 "sin interacción con los triggers as-built de `animal_profiles` (0021 …, 0030, 0040, 0054 — ninguno escucha `OF is_castrated`/`future_bull`)" es **factualmente imprecisa** → ver **M1**. No invalida el no-loop (esos triggers no escriben otras tablas), pero uno de ellos puede ABORTAR la cadena.

### Foco 2 — Análisis de poder del write-through: ✅ SIN ESCALAMIENTO (verificado contra 0071 + grants)

- Precondición del write-through: el caller pasó la RLS `animal_profiles_update` (0022: `has_role_in(establishment_id)` del perfil que toca, using = with check).
- Predicado de `animals_update` as-built (0071, using **y** with check): `exists (perfil del animal con has_role_in(ap.establishment_id))`. **Todo caller que satisface la precondición satisface el predicado** (el perfil que actualizó ES un perfil del animal donde tiene rol). Además `authenticated` tiene `grant update on animals` (0019 L46 / 0038 L19) → el mismo usuario puede hoy hacer `UPDATE animals SET is_castrated` directo por PostgREST y disparar 0064. **El write-through no otorga ni un gramo de poder nuevo**; solo re-rutea por una vía offline-friendly.
- **Animal compartido A+B**: un user de A castrando desde SU perfil afecta la categoría del perfil activo (esté donde esté) — idéntico al as-built (UPDATE directo a `animals` + 0064). Semánticamente correcto (castración = hecho físico, DD-2/0060) y es exactamente el acceso legítimo documentado en 0071 L17-21. La acotación column-level para co-tenants sigue siendo SPEC-MED-1 (backlog pre-existente) — esta spec no la empeora ni la resuelve.
- El hardening A1-1 (0071 `with check` espejo) **no se erosiona**: el write-through corre SECURITY DEFINER pero su precondición equivale al predicado de la policy; no hay camino para que un user SIN perfil-con-rol del animal lo alcance (no puede pasar la RLS del perfil de partida).
- Nota verificada: la RLS `animal_profiles_update` no restringe a perfiles `status='active'` → un user puede castrar "vía" un perfil histórico no-activo; poder idéntico al UPDATE directo de `animals` que ya tiene. Sin delta.

### Foco 3 — Orden alfabético de triggers BEFORE en `animal_profiles`: ✅ CORRECTO (con recomendación L1)

Inventario real (grep sobre migrations) + nombres que la spec fija en el SQL de §4.1/§4.2. Postgres dispara same-event en orden de nombre:

| Orden | Trigger BEFORE relevante | Evento |
|---|---|---|
| 1 | `animal_profiles_force_animal_identity` (0079) | INSERT / UPDATE OF identidad |
| 2 | `animal_profiles_force_is_castrated` (nuevo) | INSERT |
| 3 | `animal_profiles_identity_check` (0021) | INSERT/UPDATE (siempre) |
| 4 | `animal_profiles_normalize_future_bull` (nuevo) | INSERT / UPDATE OF `future_bull, is_castrated, animal_sex` |

- `'force_animal_identity' < 'force_is_castrated'` (`a` < `i`) y ambos `< 'identity_check' < 'normalize_future_bull'` (`f` < `i` < `n`). ✅
- **INSERT**: el normalize lee `new.animal_sex` y `new.is_castrated` ya FORZADOS (anti-spoof de 0079 + force nuevo) → un alta con `future_bull=true` sobre hembra o sobre animal castrado se normaliza correctamente.
- **UPDATE con spoof combinado** (payload `animal_sex='male'` falso + `future_bull=true` sobre hembra): `force_animal_identity` dispara primero (el UPDATE toca `animal_sex`), re-deriva `female` desde `animals` → el normalize ve el sexo real → `future_bull=false`. **Cerrado.**
- **Corrección de sexo propagada por 0079** sobre perfil con `future_bull=true`: la propagación 0079 actualiza `animal_sex` → normalize dispara (`OF animal_sex`) → auto-clear. El descarte del CHECK declarativo (§8.D) es la decisión correcta: un CHECK habría roto esa propagación.
- La spec **fija los nombres** en el SQL (no los deja al implementer) y T-DB.1 pide verificar el orden. ✅

### Foco 4 — `revoke execute` en las funciones SECURITY DEFINER nuevas: ✅ COMPLETO

Las 4 funciones nuevas (`tg_normalize_future_bull`, `tg_force_is_castrated_on_profile_insert`, `tg_profile_is_castrated_writethrough`, `tg_propagate_is_castrated_to_profiles`) llevan cada una `revoke execute … from public, authenticated, anon` en el SQL del design (§4.1 L166, §4.2 L207/L228/L245) + re-emisión idempotente sobre `tg_animals_apply_castration` (§4.3 L301, patrón 0055). Todas `security definer set search_path = public`. Ninguna recibe parámetros del cliente (derivan de NEW/OLD post-RLS). T-DB.10 testea el revoke efectivo + cero policy/RPC nueva. Lección SEC-HIGH-01: **aplicada**.

### Foco 5 — Eliminación limpia del delta viejo: ✅ SIN INSTRUCCIONES FANTASMA

Barrí los 3 documentos: **ninguna** instrucción residual de modificar `tg_sanitary_events_gating`, seedear `castracion` en `field_definitions`/`system_default_fields`, ni setear `product_name='Castración'`. Todas las menciones son declaraciones de eliminación (R1.5, R3.3, R7.3, R9.4, design §1.2/§5/§8.C) o historial. T-DB.9 agrega el test de **no-regresión** (un `treatment` con marcador NO se gatea; `vaccination` sigue fail-closed; no existe el data_key). Limpio.

### Foco 6 — `is_castrated`/`future_bull` en el wire de sync: ✅ SIN EXPOSICIÓN NUEVA (ADR-025)

`est_animal_profiles` = `SELECT * FROM animal_profiles WHERE establishment_id IN org_scope AND deleted_at IS NULL` (rafaq.yaml L123-128). Las dos columnas nuevas son atributos de la **propia fila per-establishment**, no-PII, no referencian otro tenant. `is_castrated` denormalizado refleja un hecho físico ya visible al co-tenant vía `animals_select` as-built (0022) → cero delta de exposición. `future_bull` es per-perfil **sin propagación** (decisión de manejo de CADA campo, R12.1) → no viaja entre tenants. El `SELECT *` no arrastra nada más (las demás columnas ya viajaban). Nota operativa del design §4.4 (re-publish de streams) es correcta y no-security.

### Foco 7 — Masivas offline (N UPDATEs): ✅ ACOTADO POR CONSTRUCCIÓN

- **Sin superficie bulk nueva**: no hay RPC/EF de fan-out server-side; las N mutaciones son writes individuales del CRUD plano, **cada una re-validada por RLS** al subir (R9.2/R10.3). El "cap de selección" es estructural: los candidatos salen de la SQLite local, que solo contiene los animales del propio establishment (frontera de sync). Un atacante no puede inflar N más allá de su propio rodeo, y cada write es del mismo costo que la carga individual as-built.
- **Fan-out por write**: 1 UPDATE de perfil → a lo sumo 1 UPDATE de `animals` + #perfiles del animal (chico: # de campos por los que pasó el animal) + 1 recompute. Sin amplificación explotable.
- **La RLS de `animal_profiles` como única barrera de la castración masiva**: suficiente — es exactamente la misma barrera de la edición individual del perfil (R9.1, paridad de roles deliberada y as-built desde 0022), y el write-through no la excede (foco 2). El gating no aplica (castrado no es dato configurable, decisión D10 lockeada).
- Rate limiting adicional: **n.a.** — sin email/SMS/API externa/EF; el throughput de PostgREST con JWT es la condición pre-existente de TODO el write-path PowerSync, no un vector nuevo de esta spec. Ver tabla de rate limits.

### Foco 8 — Checklist estándar + catálogo A–I: ✅ (detalle en tablas y dominios)

Puntos no triviales verificados: `created_by` spoofeable intra-tenant correctamente declarado heredado (R9.3, SEC-SPEC-03, sin afirmación falsa); R5.6 (revert de override desde el bottom-sheet) reusa el camino as-built 0040/C6 (UPDATE del propio perfil bajo RLS, sin función nueva); reemplazo de 0064 conserva override + perfil-activo-único + `apply_auto_transition` (revocada de clientes, 0042) y deriva de `NEW.id` de la fila real → sin camino cross-tenant; `compute_category` (0062) ya es simétrico en la rama macho (verificado L46-60) → el cambio de guard es suficiente; el guard nuevo `IS NOT DISTINCT FROM` es seguro con `is_castrated NOT NULL` (0060).

---

## Findings MEDIUM

### M1 — La afirmación de "sin interacción con triggers as-built" del design §6.1 es falsa para los checks always-on de 0021; `rodeo_check` puede ABORTAR la castración legítima de un animal multi-perfil

**Evidencia**: design §6 punto 1: *"sin interacción con los triggers as-built de `animal_profiles` (0021 categoría-sistema, 0030 history, 0040 override, 0054 teeth-gating — ninguno escucha `OF is_castrated`/`future_bull`…)"*. Contra el as-built: `animal_profiles_identity_check`, `animal_profiles_rodeo_check` y `animal_profiles_category_check` (0021 L20-22/L41-43/L61-63) son `BEFORE INSERT OR UPDATE` **sin lista de columnas** → disparan en **TODOS** los UPDATEs de `is_castrated`/`future_bull`, incluidos los N de la masiva y los anidados de la propagación (4).

**Por qué importa**: no rompe el no-loop (ninguno escribe otras tablas) ni abre authz, pero `rodeo_check` exige `rodeos.active = true AND deleted_at IS NULL` del rodeo del perfil → si un animal compartido/transferido tiene un perfil viejo en el campo B cuyo rodeo fue desactivado/soft-deleteado, la propagación de `is_castrated` a ese perfil **RAISEA** y aborta TODA la cadena (la castración del user de A falla; offline, el rechazo aparece como error permanente de sync por R10.3). Dirección **fail-closed** (no es hueco — por eso MEDIUM y no HIGH), pero es un modo de falla real del camino de seguridad central de la spec, hoy ni documentado ni testeado. (0079 tiene la misma exposición teórica, pero su propagación solo dispara en re-tag/corrección de sexo — casi inalcanzable; esta spec la pone detrás de una acción cotidiana.)

**Fix propuesto (fix-loop del spec_author, sin cambio de diseño)**:
1. Corregir la afirmación de design §6.1/§4.2: los checks de 0021 SÍ disparan (always-on); son re-validaciones idempotentes sin escritura → el no-loop se sostiene, pero `rodeo_check` es un punto de aborto.
2. Agregar a T-DB.4 el caso: propagación hacia un perfil cuyo rodeo está inactivo/soft-deleted — documentar el comportamiento esperado (aborto fail-closed + error visible por animal vía R10.3) o decidir mitigación (p.ej. la propagación tolera/saltea perfiles con rodeo muerto — decisión de Raf/Puerta 1 si se quiere cambiar).

### M2 — R13.2 sobre-promete el rastro de auditoría: castrar/revertir un `ternero` no deja NINGÚN registro (ni autor, ni timestamp, ni timeline) hasta el destete

**Evidencia**: R13.2: *"la historia queda **implícita en el timeline** vía `animal_category_history`"*; R3.3: *"la historia queda en `animal_category_history` (visible en el timeline como cambio de categoría)"*. Contra el as-built: el history solo se escribe cuando **cambia `category_id`** (0030 L33, `record_category_change_upd` AFTER UPDATE OF `category_id`); en `ternero` la castración **no transiciona** (R5.7/0062: `compute_category` da `ternero` hasta destete/1 año) → `is_castrated` flipea **sin fila de history, sin evento, sin `created_by`** (el UPDATE de estado no tiene autoría, R9.3 lo reconoce). Y el caso `ternero` es justamente el **default pre-tildado** de la masiva (R11.3) — o sea, el caso MÁS común de castración no deja rastro de quién/cuándo hasta el destete (donde el `changed_by` será el del que cargue el weaning, no el del que castró).

**Por qué importa**: dominio I2 (audit trail de operación de manejo en producto multi-usuario): una masiva equivocada sobre terneros no es atribuible ni datable post-hoc; la única señal es `updated_at` del perfil (sin autor). Cuando SÍ hay transición (torito/toro), verifiqué que `animal_category_history.changed_by = auth.uid()` se preserva a través de la cadena SECURITY DEFINER (0030 L43; `auth.uid()` lee el JWT del request) → ese caso está bien. **No cuestiono D10** (sin evento — decisión lockeada): el finding es que la spec AFIRMA una trazabilidad que en el caso dominante no existe.

**Fix propuesto**: corregir R13.2/R3.3 a la verdad ("la historia queda en el timeline **cuando la castración produce transición**; en `ternero` el cambio de estado no deja registro atribuible hasta el destete — limitación aceptada de D10") y listarlo explícitamente para la re-aprobación de Puerta 1, para que Raf acepte el gap con los ojos abiertos (o decida una mínima señal, p.ej. registrar el flip en `animal_events`, si le importa la atribución — decisión suya, no mía).

---

## Anexo LOW

- **L1 — El orden de triggers se sostiene solo por convención de nombres**: la suposición force(0079) → force_is_castrated → normalize es correcta HOY (foco 3), pero un rename futuro la rompería en silencio. Sugerencia: que T-DB.4/T-DB.10 incluyan una aserción contra `pg_trigger` (orden alfabético de los BEFORE relevantes) además del test de comportamiento.
- **L2 — `tg_normalize_future_bull` no necesita `SECURITY DEFINER`**: solo manipula `NEW` (no lee/escribe otras tablas). Definer es inocuo acá (revoke presente, search_path fijo, sin parámetros) y consistente con el patrón de la casa — informativo, no pide cambio.
- **L3 — `tg_force_is_castrated_on_profile_insert` defaultea silencioso a `false` si `animal_id` no resuelve** (`coalesce(new.is_castrated, false)`), a diferencia del force 0079 que raisea 23503. En la práctica el force 0079 corre ANTES (orden alfabético) y raisea él, y la FK ataja igual — inalcanzable hoy. Nota de robustez por si 0079 cambiara.

---

## Tabla de inputs (cada campo que el usuario tipea/toca en esta spec)

| Campo | Límite (largo/charset/formato/rango) | Validación | OK? |
|---|---|---|---|
| Vacunación: `product_name` (pre-config, texto libre) | ≤160 chars | **Server (DB)**: CHECK `sanitary_events_product_name_len_chk` as-built (0070 L227) — autoritativo | ✅ |
| Vacunación: demás parámetros de pre-config (`active_ingredient`, `notes` si la UI los expone) | ≤160 / ≤4000 | **Server (DB)**: CHECKs 0070 L229-234 as-built | ✅ |
| Vacunación: fecha de la operación | tipo `date` | **Server (DB)**: tipo de columna | ✅ |
| Vacunación: filtro categoría/sexo | selectores cerrados (catálogo / enum `male\|female`) | **Server (DB)**: FK a `categories_by_system` + CHECK enum de sexo (0019) | ✅ |
| Selección: checkboxes / todos-ninguno / CTA | booleanos de UI; se traducen a N writes contra filas existentes | **Server**: RLS por fila + tipos | ✅ |
| Selección: búsqueda (lista >~20) | filtro **local** sobre SQLite (no viaja al server) | n.a. server; sin superficie de inyección remota | ✅ |
| Ficha: toggle "Castrado Sí/No" → `animal_profiles.is_castrated` | `boolean not null` | **Server (DB)**: tipo + normalize/force/write-through (§4) | ✅ |
| Ficha: toggle ⭐ → `animal_profiles.future_bull` | `boolean not null default false`; solo machos no castrados | **Server (DB)**: tipo + trigger `tg_normalize_future_bull` (autoritativo, anti-spoof verificado incl. spoof combinado de sexo) | ✅ |
| Destete: fecha del weaning | tipo `date` | **Server (DB)**: tipo de columna; `notes` capped 0070 | ✅ |

Sin campos de texto libre nuevos; todos los pre-existentes tienen cap server-side as-built (0070). **Requisito de Raf cumplido.**

## Tabla de rate limits (acciones abusables tocadas)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| N INSERTs de evento (vacunación/destete) vía PowerSync→PostgREST | n.a. (sin límite nuevo) | RLS per-row (establishment del perfil) | sí (RLS/constraints rechazan) | N acotado estructuralmente al propio rodeo (datos locales = solo su tenant); costo idéntico a la carga individual as-built; idempotencia UUIDv5 evita amplificación por re-intento |
| N UPDATEs de castración (`animal_profiles`) | n.a. (sin límite nuevo) | RLS per-row | sí | Fan-out por write acotado (1 animal + sus pocos perfiles); no-op por valor en re-aplicación |
| Auth (`[auth.rate_limit]` config.toml) | sin cambios | — | — | La spec no toca auth ✅ |
| Edge Functions / email / SMS / API externa | n.a. | — | — | La spec no crea ni usa ninguna (R9.4) ✅ |
| RPC bulk server-side | **no existe** (alternativa §8.B descartada) | — | — | Sin vector de amplificación server-side — es la propiedad de seguridad clave del modelo "N mutaciones individuales" |

## Dominios revisados (catálogo A–I)

- **A (authz objeto/función)**: A1 n.a. (sin service-role/EF); A2 sin spread de payload — writes campo-por-campo, columnas sensibles forzadas por triggers (identidad 0079, `is_castrated` en INSERT, `created_by` 0043 en perfiles); A3 cubierto (cada hijo pasa RLS del padre vía `establishment_of_profile`; lote = mismo establishment, spec 02 R2.14); A4 paridad de roles deliberada con la mutación individual (R9.1).
- **B (exposición)**: B1 n.a. (sin EF); B2 sin PII nueva (booleans); B3 `SELECT *` del stream verificado sin arrastre nuevo (foco 6).
- **C (offline/sync)**: C1/C2 stream scopeado JOIN-free verificado; C4 re-autorización server-side en replay declarada y correcta (R10.3 — el rechazo se superficia, no se aplica); espejo C6 display-only.
- **D (secretos/supply chain)**: n.a. — sin secretos, sin imports nuevos, sin EF.
- **E (escala)**: E1 listas locales (SQLite propio); E2-E4 n.a. (sin costo por request externo, sin signup, sin enumeración nueva).
- **F (inyección/ingesta)**: F1 sin texto de usuario en filtros server (búsqueda es local); F2-F4 n.a.
- **G (BLE)**: n.a. — la spec no toca el bastón.
- **H (auth/sesión)**: n.a. — sin cambios de auth/tokens.
- **I (compliance)**: I2 → **M2** (gap de atribución en castración de ternero, documentar y aceptar en Puerta 1).

## Dominios excluidos

- Edge Functions / RPC / policies RLS nuevas: R9.4 declara cero y T-DB.9/T-DB.10 lo testean — verificado que el design no contradice.
- Auth / tokens / secrets / endpoints públicos / PII nueva / BLE / CI-CD: la spec no los toca.

## Resumen ejecutivo para el leader

- **PASS — 0 HIGH / 2 MEDIUM / 3 LOW.** Los 8 focos pedidos verificados contra el as-built real (triggers, policies, grants, stream YAML), no contra la prosa.
- El núcleo de seguridad del delta (no-loop, no-escalamiento del write-through vs 0071, orden de triggers, revokes SEC-HIGH-01, eliminación limpia del delta viejo, wire de sync, masivas sin superficie bulk) **se sostiene**.
- **M1**: el design afirma "sin interacción con triggers as-built" — falso para los checks always-on de 0021; `rodeo_check` puede abortar (fail-closed) la castración de un animal multi-perfil con rodeo muerto. Corregir la prosa + testear el caso (T-DB.4).
- **M2**: R13.2/R3.3 sobre-prometen el audit trail — castrar un `ternero` (el caso default de la masiva) no deja registro atribuible hasta el destete. Corregir la prosa y listar el gap explícito para la re-aprobación de Raf en Puerta 1. No reabre D10.
- Ambos MEDIUM son **documentales + 1 test** — fix-loop corto del spec_author, sin cambio de diseño. Las 2 tablas exigidas (inputs / rate limits) están completas: todos los inputs con límite + validación autoritativa server-side as-built; sin acción abusable nueva sin control.
- La spec puede avanzar a Puerta 1 **una vez aplicadas las correcciones de M1/M2** (a criterio del leader si las gatea antes o las folda en la re-aprobación; ninguna es bloqueante de seguridad en sentido estricto).

---
---

# Gate 1 — Re-chequeo puntual propagación + R13.7 (fix-loop #2)

**Veredicto: PASS** — 0 HIGH / 0 MEDIUM / 2 LOW nuevos (L4, L5).

**Fecha**: 2026-06-11.
**Analista**: security_analyzer (modo `spec`, ADR-019). Re-chequeo PUNTUAL post-Puerta-1 (fix-loop #2, design §6 banner + T-G1.2). El PASS de la sección "Gate 1 — Spec reconciliada v2 (2026-06-11)" sigue vigente para todo lo no re-auditado acá.
**Alcance exclusivo**: (1) `tg_propagate_is_castrated_to_profiles` con pre-filtro tolerar-y-saltear (design §4.2(4), LIM-2/D13); (2) observación automática R13.7 (design §3.5, LIM-1/D12).
**Sustrato re-verificado contra as-built**: 0021 L25-43 (`tg_animal_profiles_rodeo_check`, predicado exacto), 0034 (tabla/RLS/triggers de `animal_events`: `tg_set_author_id_auth_uid` L32-43, `tg_animal_events_validate_est` L46-62, `tg_animal_events_enforce_edit_window` L66-90, policies L94-107), 0079 (force OF 3 columnas de identidad — NO dispara en el UPDATE de `is_castrated`), 0020 L16 (`rodeo_id not null`), 0017 L13 (`rodeos.active not null`), 0062 (`compute_category` lee de `animals`, no del perfil).

## Ítem 1 — Pre-filtro de `tg_propagate_is_castrated_to_profiles` (design §4.2(4))

### (a) Equivalencia exacta con el predicado de 0021: ✅ EQUIVALENTE

- Texto: el `EXISTS` del pre-filtro (design L261-267: `r.id = ap.rodeo_id AND r.establishment_id = ap.establishment_id AND r.active = true AND r.deleted_at is null`) es la sustitución literal `new→ap` del predicado de `tg_animal_profiles_rodeo_check` (0021 L28-34). Idéntico término a término.
- Semántica: la propagación solo escribe `is_castrated` → `NEW.rodeo_id`/`NEW.establishment_id` que `rodeo_check` evaluaría en el BEFORE del UPDATE anidado son exactamente los `ap.rodeo_id`/`ap.establishment_id` que el pre-filtro evaluó. Verifiqué que NINGÚN trigger BEFORE de la cadena muta esas columnas: el force 0079 es `OF animal_tag_electronic, animal_sex, animal_birth_date` (0079 L118 — no dispara acá); `normalize_future_bull` solo toca `NEW.future_bull`; los checks 0021 no modifican NEW. → **skip ⟺ `rodeo_check` habría raiseado**. Sin divergencia en ninguna dirección.
- Nulabilidad: `rodeo_id not null` (0020) y `active not null` (0017) → sin esquina NULL que haga divergir `= true` entre ambas evaluaciones.
- Cobertura parcial correcta por diseño: el pre-filtro NO espeja `identity_check`/`category_check` — esos siguen pudiendo abortar, y la justificación del design (L286: solo fallarían ante corrupción real, y eso DEBE abortar) es correcta. No es divergencia: es la semántica decidida (LIM-2 = tolerar solo rodeo muerto).
- Residual teórico → **L4** (race de snapshots, fail-closed; abajo).

### (b) ¿El skip abre camino cross-tenant nuevo?: ✅ NO

- El skip **reduce** escrituras (no escribe en el perfil del otro tenant); no agrega ningún write ni canal nuevo. La escritura cross-establishment que SÍ ocurre (perfiles con rodeo vivo) es la ya auditada y PASSeada en v2 foco 2 (poder idéntico al as-built 0071/0064).
- El perfil huérfano stale como vector: el valor stale es **display-only**. `compute_category` (0062) lee `animals.is_castrated` (fuente de verdad), no el perfil → el stale no alimenta recompute ni RLS ni autorización alguna. Tampoco se auto-propaga de vuelta: el write-through solo dispara si ALGUIEN updatea ese perfil, lo cual exige `rodeo_check` (rodeo vivo) + RLS propia — poder intra-tenant pre-existente. Cero oscilación, cero escalamiento.
- El atacante no controla la condición de skip (no puede matar el rodeo de OTRO tenant). No weaponizable.
- `v_skipped` (design L269-272): el count post-UPDATE captura exactamente los saltados (mismo filtro `animal_id + IS DISTINCT FROM`); no introduce escritura.

### (c) `RAISE LOG`: ✅ SIN ECO AL CLIENTE, SIN DATO SENSIBLE

- Severidad `LOG`: va al server log de Postgres; para el cliente, `LOG` rankea por debajo de `NOTICE` (default de `client_min_messages`) → no se envía al cliente, y PostgREST/Supabase no superficia mensajes no-error en la respuesta HTTP. Sin canal accesible al caller.
- Contenido (design L274-275): solo `count` + `animal_id` (UUID), placeholders `%` con valores no controlados por el usuario (sin texto libre en el format string → sin log injection). Sin PII, sin identificar al otro establishment. Aun en el peor caso hipotético de eco, el caller ya conoce el `animal_id` (es el animal que flipeó); el count de huérfanos sería el único bit nuevo — y no hay eco. ✅

### (d) Convergencia documentada: ✅ CORRECTA, con matiz de permanencia ya aceptado

- La afirmación (design L286: converge "en el próximo cambio de `is_castrated` del animal con su rodeo ya vivo" vía el guard `IS DISTINCT FROM`) es mecánicamente correcta — verificado: un flip posterior con el rodeo reactivado SÍ recoge el perfil stale.
- Matiz: la castración es de hecho one-way en la práctica → "el próximo flip" puede no llegar nunca y el stale ser **permanente**. Además el perfil huérfano no es corregible client-side mientras el rodeo siga muerto (`rodeo_check` always-on bloquea CUALQUIER update del perfil — propiedad as-built, fail-closed); con rodeo reactivado, un update directo del perfil converge (write-through no-op). **Sin efecto de seguridad**: el stale permanente no alimenta authz/recompute (ver (b)), y el design ya lo declara "inconsistencia aceptada" con `future_bull` stale incluido (decisión explícita de Raf en Puerta 1, D13). No exijo cambio; la permanencia probable queda anotada acá como trazabilidad de lo aceptado.

## Ítem 2 — Observación automática R13.7 (design §3.5)

### (a) Desfasaje UPDATE↔observación (sin atomicidad): ✅ SIN ABUSO NUEVO

- Las dos manipulaciones posibles del desfasaje — **observación sin UPDATE** (rastro "Castrado" falso) y **UPDATE sin observación** (flip silencioso) — no otorgan poder nuevo: (1) cualquier user con `has_role_in` ya puede escribir CUALQUIER texto en `animal_events` vía el `addObservation` as-built (0034: insert policy = solo `has_role_in`, texto libre) — el copy "Castrado" no tiene ningún significado server-side; (2) el flip sin observación es exactamente el estado pre-LIM-1 (gap de D10 ya documentado como LIM y aceptado). La verdad operativa es `animals.is_castrated`; la observación es informativa y nada la parsea (verificado: el gating por marcador de texto fue eliminado en la reconciliación v2 — ningún código matchea sobre `animal_events.text`).
- Dirección de falla del rechazo asimétrico de sync: visible vía R10.3, sin estado corrupto de seguridad (el UPDATE es idempotente por valor). Residual correctamente declarado en §3.5.

### (b) Copy fijo manipulable client-side: ✅ NO IMPORTA (con una nota de honestidad → L5)

- Inyectar/alterar el copy = escribir una observación libre, poder as-built intra-tenant. Sin consecuencia: no hay consumidor server-side del texto, no hay gating, no hay escape a otro tenant (`tg_animal_events_validate_est` 0034 L46-62 ata el evento al establishment del perfil; RLS `has_role_in`). `id` random (no UUIDv5) correcto para este caso: la dedup determinística no aplica a un rastro con autor y el INSERT no es amplificable cross-tenant.
- **Pero** §3.5 vende el rastro como "atribuible": ver **L5** — la atribución es best-effort as-built, no tamper-evident. No invalida la mitigación de LIM-1 (que se vendió como mitigación, no garantía), pero merece 1 línea de honestidad.

## Findings nuevos (ambos LOW — no bloquean)

- **L4 — Race de snapshots entre pre-filtro y `rodeo_check` (READ COMMITTED)**: el `EXISTS` del pre-filtro se evalúa con el snapshot del statement; el `SELECT` interno de `rodeo_check` en el BEFORE anidado toma snapshot propio → una desactivación de rodeo COMMITeada entre ambos puede hacer que el pre-filtro deje pasar un perfil que el check aborta. Ventana ínfima, dirección **fail-closed** (aborta la cadena = el comportamiento pre-LIM-2), no explotable ni direccionable por un atacante. Sin acción requerida; queda documentado para que un aborto esporádico bajo concurrencia no sorprenda.
- **L5 — "Rastro atribuible" de LIM-1 es best-effort, no tamper-evident (as-built heredado, cero delta de esta spec)**: (i) `author_id` es default-if-null (0034 L35-37) y la insert policy no lo restringe (L97-98) → spoofeable intra-tenant, familia SEC-SPEC-03/D7; (ii) `deleted_at` NO está en la lista de columnas inmutables ni ventaneadas de `enforce_edit_window` (0034 L70-84) y la update policy permite al autor (o al owner) → el autor puede soft-deletear su propia observación automática en cualquier momento, borrándola del timeline (`select … deleted_at is null`), y el texto es editable dentro de la ventana de 15 min. Sugerencia documental (1 línea en §3.5, estándar H2 de "ninguna afirmación de seguridad sobrevendida"): "atribuible best-effort — autoría default-if-null spoofeable intra-tenant (SEC-SPEC-03/D7) y observación borrable por su autor; no es tamper-evidence (I2)". No reabre D12: la mitigación sigue siendo válida para el caso honesto, que es el que LIM-1 ataca.

## Tabla de inputs (delta del fix-loop #2)

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| Observación automática: texto (copy fijo, NO tipeado por el usuario) | literal cliente; `animal_events.text` as-built | **Server (DB)**: RLS `has_role_in` + `validate_est` (0034); el texto no se parsea server-side | ✅ |

Sin campo tipeable nuevo. El pre-filtro de la propagación no introduce input de cliente (deriva de NEW/OLD post-RLS).

## Tabla de rate limits (delta del fix-loop #2)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| +1 INSERT `animal_events` por flip (N en masiva) | n.a. (sin límite nuevo) | RLS per-row | sí | Duplica CrudEntries de la masiva (2/animal); N sigue acotado estructuralmente al propio rodeo; sin EF/email/API externa |

## Cobertura

Skill `security-review` de Sentry: **no corrida** — modo `spec` sobre SQL/diseño plpgsql, fuera del sweet spot de la skill (cubierto por revisión manual contra as-built, arriba). PowerSync/stream: sin cambio respecto del foco 6 de v2 (las columnas ya auditadas; la observación viaja por `est_animal_events` as-built de spec 15).

## Resumen ejecutivo para el leader

- **PASS.** El delta del fix-loop #2 cierra: (1a) pre-filtro **exactamente equivalente** al predicado de `rodeo_check` 0021 (sustitución literal, sin trigger BEFORE que mute las columnas comparadas, sin esquina NULL); (1b) el skip no abre camino cross-tenant (reduce escrituras; stale display-only que no alimenta authz/recompute); (1c) `RAISE LOG` sin eco al cliente y sin dato sensible; (1d) convergencia correcta — stale probablemente permanente, sin efecto de seguridad, ya aceptado por Raf (D13). (2) R13.7: el desfasaje y la manipulación del copy son poder as-built intra-tenant sin consumidor server-side — no importan; la verdad es `is_castrated`.
- **2 LOW nuevos**: L4 (race fail-closed de snapshots, sin acción) y L5 (1 línea de honestidad en §3.5: autoría spoofeable + observación borrable por su autor — heredado 0034, no reabre D12).
- T-G1.2 puede marcarse cumplida. La condición de cierre del fold LIM-2 queda satisfecha.
