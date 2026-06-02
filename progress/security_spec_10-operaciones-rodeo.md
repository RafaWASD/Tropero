# Gate 1 — Security review (modo `spec`) — Spec 10 Operaciones masivas por rodeo

**Veredicto (RE-RUN sesión 21): PASS**

**Fecha**: 2026-06-01 (sesión 21, re-run tras fix loop).
**Analista**: security_analyzer (modo `spec`, ADR-019).
**Input**: `specs/active/10-operaciones-rodeo/{requirements,design,tasks}.md` (refinados tras el FAIL previo).
**Sustrato re-verificado contra as-built** (no contra lo que dice la spec): 0014 (`systems_by_species` seed), 0018 (`system_default_fields` seed canónico), 0024 (`tg_set_created_by_auth_uid`), 0026 (`reproductive_events`), 0027 (`sanitary_events`), 0043 (`tg_force_created_by_auth_uid`, SEC-SPEC-03), 0054 (gating capa 2), 0055 (revoke check), 0020 (extensiones: solo `pg_trgm`, NO `unaccent`). Última migration as-built: **0058**.

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
