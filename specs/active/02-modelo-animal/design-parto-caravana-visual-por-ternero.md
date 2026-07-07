# Spec 02 — Delta PARTO: CARAVANA VISUAL DEL TERNERO **POR CRÍA** — Design

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 02 (feature `done`/`deferred`) · **backend (RPC) + frontend** · **Gate 1 APLICA** · **DEPLOY gateado a Raf**.
**Fuente de verdad**: `context-parto-caravana-visual-por-ternero.md`. **Requirements**: `requirements-parto-caravana-visual-por-ternero.md` (`PCV.<n>`).
**Revisa**: `parto-rodeo-caravana` (RPRC.2/RPRC.3 superadas — ver §0 y §8).

> **Multi-tenancy / dato regulado**: el idv es identidad del animal (cae en la superficie SIGSA). La barrera es server-side: `register_birth` deriva el tenant de la fila real de la madre y la **unicidad** del idv la garantiza el índice parcial `animal_profiles_idv_unique (establishment_id, idv)` — el cliente **nunca** pasa `establishment_id`. El cambio del RPC va a **Gate 1** (security_analyzer modo spec) antes de la Puerta 1.
> **Offline-first**: el form es de campo. La lectura (rodeos, catálogo) es local; la escritura del parto va por la **outbox** de `registerBirth` (sin red nueva). El rechazo 23505 lo clasifica `uploadData` como permanente.

---

## 0. Deltas posteriores (para el índice del baseline al cerrar)

Al cerrar la Puerta 2, el leader folda al `design.md` baseline de spec 02 (bajo R9/R14, parto) y al `design-parto-rodeo-caravana.md` (bajo RPRC.2/RPRC.3) un puntero:
- `parto-caravana-visual-por-ternero` — la caravana visual (idv) del ternero al parto pasa a ser **POR CRÍA** (mellizos incluidos), simétrica con la electrónica. Revisa RPRC.2/RPRC.3 (idv ya no es single-calf-only). RPC `register_birth` computa el idv por cría (misma firma 6-arg, `p_calf_idv` conservado para cría al pie). **SUPERA** RPRC.2.1/2.3/2.4 y RPRC.3.2/3.3. Estado: (lo completa el leader al cerrar).

## 1. Archivos a crear / modificar

### Backend (Gate 1 + DEPLOY gateado a Raf)
- **CREAR** `supabase/migrations/0121_register_birth_calf_idv_per_calf.sql` (próximo número libre — el último es `0120`). `CREATE OR REPLACE FUNCTION public.register_birth(...)` con la **MISMA firma 6-arg** (`0116` ya la definió → `CREATE OR REPLACE`, sin `DROP`). Cambios internos: idv por cría dentro del loop + fallback refinado (§2). Re-aplica `revoke public/anon` + `grant authenticated` (idempotente) + `notify pgrst`.
  - **REGLA DURA (PCV.4.7)**: moldear sobre el **cuerpo VIGENTE del RPC en el remoto** (el leader se lo pasa al implementer), NO sobre `0116` tal cual — una migración posterior pudo re-definirlo (`reference_function_recreate_base`). Confirmar que la base tenga: herencia de `breed_id` (R1.7), `p_calf_rodeo_id` (23514), idempotencia HIGH-D1, cota de fecha, cap del tag ≤15.
  - **NO aplicar desde la migración**: el deploy lo hace el **leader por Supabase MCP** tras Gate 1 PASS + reviewer + Gate 2 + **autorización de Raf** (memoria `project_supabase_mcp_write`). Hasta el deploy, las suites backend que llaman al RPC nuevo con `calf_idv` per-calf reflejan el comportamiento viejo (idv escalar) — esperado.

### Frontend (puro — sin superficie de seguridad nueva)
- **MODIFICAR** `app/app/agregar-evento.tsx`:
  1. `CalfRow` (tipo local) gana `idvRaw: string`; `newCalf()` la inicializa en `''`.
  2. **Eliminar** el estado `calfIdv`/`setCalfIdv` a **nivel screen** y el `FormField` de caravana visual a nivel camada + el `InfoNote` de mellizos del `PartoForm` (PCV.1.5). Quitar las props `calfIdv`/`onCalfIdv` de `PartoForm`.
  3. En `CalfBlock`: agregar un `FormField` "Caravana visual del ternero (opcional)" (idv), `keyboardType="number-pad"`, `placeholder="Ej. 0234"`, `onChangeText={(t) => onUpdate({ idvRaw: sanitizeIdvInput(t) })}` (PCV.1.1/1.3), **ubicado junto a la caravana electrónica** (bastoneo) del mismo bloque (simétrico). `testID={`calf-idv-${index}`}` para desambiguar mellizos en E2E (paralelo a `tag-scan-open-${index}`).
  4. En `onSubmit` (`eventType==='birth'`): dejar de pasar `calfIdv` a `registerBirth`; mapear el idv **per-calf** en el payload `calves`. Como `validateCalves` devuelve `v.value` **en el mismo orden** que `calves` (los drafts se arman `calves.map(...)`), zippear por índice: `calves: v.value.map((c, i) => ({ sex: c.sex, weightKg: c.weightKg, tag: c.tag, idv: calfIdvForSubmit(calves[i].idvRaw) }))`. Conservar `calfRodeoId: effectiveCalfRodeoId` (RPRC.1 intacto, PCV.3.4).
- **MODIFICAR** `app/src/services/events.ts`:
  1. `BirthCalfInput` gana `idv?: string | null` (PCV.3.1).
  2. `registerBirth`: `calvesPayload` mapea `calf_idv` per-calf cuando viene (`const idv = cleanStr(c.idv); if (idv) payload.calf_idv = idv;`), paralelo a como mapea `calf_tag_electronic`.
  3. `overlayCalves`: el `idv` optimista de cada cría pasa a ser **per-calf** con precedencia sobre el top-level (espeja el `coalesce` del RPC): `idv: cleanStr(c.idv) ?? cleanStr(input.calfIdv)`. (Antes usaba solo `input.calfIdv` único.)
  4. `visualFallback` del overlay: refinar a `(tag == null && idvDeLaCría == null) ? '<fallback>' : null` para que el overlay optimista matchee el `visual_id_alt` del RPC (PCV.4.5) — evita un flash inconsistente antes del ACK.
  5. **CONSERVAR** `RegisterBirthInput.calfIdv` + `params.p_calf_idv = calfIdv` (top-level) para el caller de **cría al pie** (#15, PCV.6.2). El parto ya no lo setea (manda idv per-calf).
- **MODIFICAR** `app/src/utils/calf-birth.ts` (+ `calf-birth.test.ts`):
  - El helper `calfIdvForSubmit(calvesLength, idvRaw)` **gateado por longitud de camada** queda **obsoleto** (la regla "solo single-calf" desaparece). Reemplazarlo por un `calfIdvForSubmit(idvRaw: string): string | null` **per-calf** = `idvRaw.trim() || null` (sin gate de longitud). Actualizar los tests unitarios (los casos "mellizos → null" pasan a "cada cría con su idv → su idv"). `resolveEffectiveCalfRodeoId`/`resolveMotherSystemId`/`eligibleCalfRodeos`/`canEditCalfRodeo` **sin cambios** (RPRC.1 intacto).

### Frontend (reúso, NO crear de cero)
- `FormField` (`@/components`), `sanitizeIdvInput` (`utils/animal-input`) — ya usados por el campo idv camada actual; se **mueven** al `CalfBlock`.
- El `TagScanCta`/`CapturedTagRow`/`TagScanSheet` del bastoneo por ternero (RCF.6) quedan **intactos** — el idv se ubica junto a ellos.

### Tests (backend + E2E)
- **EXTENDER** las suites backend de `register_birth` (donde vivan los tests de parto/mellizos — `supabase/tests/animal/` o equivalente): idv per-calf (mellizos con idv distinto persisten con su idv); **23505** por idv duplicado en el mismo parto → rollback atómico (0/0); backward-compat `p_calf_idv` (cría al pie 1 cría). Re-correr **todas** las suites que tocan el RPC (animal + SIGSA por el `breed_id`).
- **CREAR** helper de oráculo `waitForServerCalfIdvs(motherProfileId, expectedIdvs)` en `app/e2e/helpers/admin.ts` — análogo a `waitForServerCalfTags` pero leyendo `animal_profiles.idv` (el idv vive en `animal_profiles`, no en `animals`): cadena `reproductive_events(birth) → birth_calves.calf_profile_id → animal_profiles.idv`.
- **EXTENDER** `app/e2e/events.spec.ts` (o `parto-bastoneo.spec.ts`) con la regresión de PCV.8.5 (single con idv / mellizos idv distinto / ambos vacíos). Import de `test`/`expect` desde `./helpers/fixtures`.
- **CREAR** `app/e2e/captures/parto-caravana-visual-por-ternero.capture.ts` (Gate 2.5, PCV.8.4).

## 2. Contrato del RPC `register_birth` (as-designed) — diff sobre `0116`

Firma **INALTERADA** (6-arg). Cambios **solo internos**:

**(a) Sacar** el cómputo único del idv de **antes** del loop (hoy `0116:119`):
```
-  v_calf_idv := nullif(trim(coalesce(p_calf_idv, '')), '');   -- LOW-1  (se ELIMINA de acá)
```

**(b) Dentro del loop**, junto a la lectura de `calf_tag_electronic` (hoy `0116:132`), computar el idv **por cría** con precedencia per-calf → param:
```
   v_calf_tag := nullif(trim(coalesce(v_calf ->> 'calf_tag_electronic', '')), '');
   ...
+  -- idv POR CRÍA (PCV.4.2/4.3): el calf_idv del elemento gana; si vacío/ausente, cae al p_calf_idv
+  -- (backward-compat cría al pie #15 — 1 cría, top-level). Los mellizos nunca mandan p_calf_idv.
+  v_calf_idv := coalesce(
+      nullif(trim(coalesce(v_calf ->> 'calf_idv', '')), ''),
+      nullif(trim(coalesce(p_calf_idv, '')), '')
+  );
```

**(c)** El insert de `animal_profiles` ya pone `idv = v_calf_idv` (`0116:154`) — ahora con el valor **per-calf** (sin cambio de línea). **Refinar** el fallback `visual_id_alt` (hoy `0116:155`):
```
-      case when v_calf_tag is null then v_visual_fallback else null end,
+      case when v_calf_tag is null and v_calf_idv is null then v_visual_fallback else null end,
```

**Nada más** cambia (PCV.4.6). `v_calf_idv` sigue declarado (ya existe en el `declare`). Cierre con:
```
revoke execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) from public, anon;
grant  execute on function public.register_birth (uuid, date, jsonb, uuid, uuid, text) to authenticated;
notify pgrst, 'reload schema';
```

**Contrato de `p_calves` (jsonb) — ampliado**:
```
[{ "calf_sex": "male|female", "calf_weight": num?, "calf_tag_electronic": text?, "calf_idv": text? }, ...]
```
`calf_idv` es **opcional** (PCV.2.3): ausente/vacío → cae al `p_calf_idv` top-level → si también vacío, el ternero se crea sin idv (con el fallback `visual_id_alt`).

**Matriz de resolución del idv/visual_id_alt por cría**:

| `calf_idv` (elem) | `p_calf_idv` (top) | `calf_tag` | `idv` resultante | `visual_id_alt` |
|---|---|---|---|---|
| "0234" | — | — | 0234 | null |
| "0234" | — | "982…" | 0234 | null |
| — | — | "982…" | null | null |
| — | — | — | null | `<fallback recién nacido>` |
| — | "0500" (cría al pie #15) | — | 0500 | null |
| "0234" (cría A) / "0235" (cría B) | — | — | 0234 / 0235 | null / null |
| "0234" (cría A) / "0234" (cría B) | — | — | **23505 → rollback atómico** (índice parcial) | — |

## 3. Layout del form de parto (as-designed)

```
PARTO (eventType='birth')
├─ Fecha del parto (AAAA-MM-DD)                      ← baseline, sin cambios
├─ Rodeo del parto  [ Rodeo madre ▾ ]  (Mismo rodeo…) ← RPRC.1 (a nivel camada) — INTACTO
├─ Ternero 1                                          ← CalfBlock
│    ├─ Sexo*                                         ← baseline
│    ├─ Peso al nacer (opcional)                      ← baseline
│    ├─ Caravana visual del ternero (opcional) [___]  ← NUEVO (PCV.1) — POR CRÍA, testID calf-idv-0
│    └─ Caravana electrónica  [ Bastonear… (opcional) ] ← RCF.6 (bastoneo) — INTACTO, por cría
├─ (Ternero 2 …)                                      ← mellizos: MISMA estructura, con SU idv (calf-idv-1)
└─ + Agregar otro ternero                             ← baseline
```

- **Se elimina** el bloque camada `¿single? FormField idv : InfoNote mellizos` de entre el rodeo y los terneros (PCV.1.5).
- El idv queda **dentro de cada `CalfBlock`**, junto a la electrónica → simetría visual "cada ternero, sus dos caravanas, ambas opcionales".
- El **rodeo del parto** sigue a nivel camada (RPRC.1) — no baja a per-calf (los mellizos van juntos; el RPC toma `p_calf_rodeo_id` escalar). Solo la **visual** se vuelve per-calf.

## 4. Offline-first (PowerSync) — sin cambios de contrato de outbox

- **Escritura**: `registerBirth` sigue encolando el parto por la **outbox** (`enqueueRegisterBirth`), overlay optimista + intent `register_birth`. El único cambio es que cada elemento de `p_calves` ahora puede llevar `calf_idv`, y el overlay usa el idv per-calf. `mapIntentToRpc` inyecta `p_client_op_id` (idempotencia) sin cambios.
- **Rechazo (PCV.5.4)**: un idv duplicado (mismo parto o rebaño) → **23505** → `uploadData` as-built lo clasifica **permanente** (surface accionable es-AR, sin loop). Igual que cualquier `registerBirth` rechazado (hoy ya maneja el 23505 del tag). El cliente **no** pre-valida la unicidad del idv (la valida el server) — coherente con PCV.2 (no forzar).

## 5. Constraint de opcionalidad (PCV.2) — por qué es seguro

**Verificado en el remoto (2026-07-07, leader — corregido tras Gate 1, MEDIUM-1):** el at-least-one-identifier se enforça por DOS objetos, hay que distinguirlos:
1. El **column-CHECK** `animal_profiles_local_id_check` (0020/0021) hoy es un **NO-OP**: su def vigente es `((COALESCE(NULLIF(TRIM(idv),''), NULLIF(TRIM(visual_id_alt),'')) IS NOT NULL) OR true)` — el `OR true` lo hace siempre verdadero. Este check NO enforça nada.
2. PERO existe un **TRIGGER ACTIVO** `animal_profiles_identity_check` (BEFORE INSERT/UPDATE, fn `tg_animal_profiles_identity_check`, `SECURITY DEFINER`; 0021 → redefinido en 0039; **confirmado por `pg_trigger`**) que SÍ enforça: `if coalesce(nullif(trim(animals.tag_electronic),''), nullif(trim(new.idv),''), nullif(trim(new.visual_id_alt),'')) is null then raise 23514`. (Mi verificación previa por `pg_constraint`/`pg_index` tenía un punto ciego: los triggers no aparecen ahí.)

→ Por eso el **fallback** `visual_id_alt = '<fallback recién nacido>'` en el caso both-null es **LOAD-BEARING** (PCV.2.4), NO cosmético: es lo que hace pasar el trigger cuando la cría no tiene tag ni idv. La opcionalidad de **ambas** caravanas (PCV.2.1) es segura **precisamente porque** la refinación de §2c setea el fallback en el both-null. ⚠️ **Un delta futuro NO debe borrar el fallback creyéndolo display** — rompería el trigger (23514) en la cría sin caravana.

Nota: el trigger lee el `tag_electronic` de `public.animals` (no del payload del profile). En `register_birth` el `animals` de la cría se inserta ANTES que el `animal_profiles`, así que cuando el trigger corre ya ve el tag de la cría. Matriz (cría → resultado del trigger):
- tag presente, idv null → `visual_id_alt = null`; trigger PASA por el **tag**.
- idv presente, tag null → `visual_id_alt = null`; trigger PASA por el **idv**.
- ambos null → `visual_id_alt = fallback`; trigger PASA por el **fallback** (load-bearing).
- ambos presentes → `visual_id_alt = null`; trigger PASA por tag/idv.

→ **ninguna** validación de UI fuerza cargar caravana (el fallback server-side cubre el both-null). El otro guard es la **unicidad** del idv (23505) — no es "forzar cargar", es "no repetir".

## 6. Alternativas descartadas

1. **Cambiar la firma del RPC (agregar `p_calf_idvs` array, o quitar `p_calf_idv`).** Descartada: rompería la backward-compat del camino cría al pie (#15) que manda `p_calf_idv` top-level, y obligaría a versionar la firma (drop+create, grants nuevos, riesgo de overload). Con el `coalesce(per-calf, top-level)` se cubre todo con la **misma firma 6-arg** (`CREATE OR REPLACE`, sin drop) — mínimo blast radius.
2. **Mantener el idv a nivel camada pero permitir "aplicar a todos los mellizos".** Descartada: no es lo que pidió Raf (idvs **distintos** por cría) y no tiene sentido de dominio (dos caravanas visuales iguales chocan el índice unique — sería 23505 garantizado).
3. **Validar client-side la unicidad del idv (entre mellizos y contra la lista local).** Descartada: contradice el constraint de opcionalidad/no-forzar (PCV.2) y duplicaría la lógica del server; además la lista local puede estar desincronizada (offline). La unicidad la valida el server (23505) y se superficia por la outbox (patrón #15 para el tag). El campo solo **sanitiza** (`sanitizeIdvInput`).
4. **Poner el idv per-calf pero seguir mandando también el `calfIdv` camada desde el parto.** Descartada: sería ambiguo (el `coalesce` daría precedencia al per-calf, pero mandar ambos confunde el intent y el overlay). El parto manda **solo** per-calf; el top-level `p_calf_idv` queda **exclusivo** de cría al pie.

## 7. Gate 1 — APLICA (backend / RPC + dato regulado)

Este delta **dispara Gate 1** (a diferencia del delta madre `parto-rodeo-caravana`, que era frontend-only): toca el **RPC `register_birth`** (función security-definer) y **dato regulado** (el idv es identidad del animal → superficie SIGSA). El `security_analyzer` modo `spec` audita:
- que el idv per-calf **no** abra un vector de escritura cross-tenant (la unicidad sigue scopeada a `establishment_id` derivado de la fila real de la madre; el cliente nunca pasa `establishment_id`);
- que el `coalesce` no rompa la idempotencia (HIGH-D1), la herencia de `breed_id` (R1.7/SIGSA) ni la atomicidad;
- que la opcionalidad (idv/tag null) sea segura: el at-least-one lo enforça el **trigger** `animal_profiles_identity_check` (no el column-CHECK, que es no-op) → el fallback `visual_id_alt` en el both-null es **load-bearing** para pasar ese trigger (§5, PCV.2.4); la refinación §2c lo setea justo ahí;
- que no se degrade el `revoke public/anon` + `grant authenticated`.

Output esperado: `progress/security_spec_parto-caravana-visual-por-ternero.md` (PASS / NEEDS_CLARIFICATION / FAIL). El **Gate 2** (code security, siempre) corre sobre el diff (migración + frontend). El **DEPLOY** de `0121` lo hace el **leader por Supabase MCP** con **autorización explícita de Raf** — la migración lleva el banner "🔴 NO aplicar desde acá".

## 8. Reconciliación con `parto-rodeo-caravana` (as-built)

Al cerrar la Puerta 2, el leader folda al **delta madre**:
- `requirements-parto-rodeo-caravana.md`: nota bajo **RPRC.2.1/2.3/2.4** y **RPRC.3.2/3.3** → *"SUPERADA por el delta `parto-caravana-visual-por-ternero` (idv por cría, mellizos incluidos)"* (no se reescribe el EARS — nota de reconciliación, patrón `docs/specs.md`, igual que la nota de RPRC.2.5 ya existente por `bastoneo-captura-alta-parto`).
- `design-parto-rodeo-caravana.md` §7 (alternativa #1 "idv por ternero para mellizos, backlog") → marcar **RESUELTA** por este delta.
- `RPRC.1` (rodeo escalar a nivel camada) y `RPRC.2.5` (tag electrónico por cría) **no se tocan**.
