# impl — cap server-side de `maneuver_presets.name` (hardening)

**Estado: BLOCKED** — el cap server-side **YA EXISTE en producción**. La premisa de la tarea (que `maneuver_presets.name` no tiene ningún cap de largo) es falsa. No escribo migración nueva ni aplico nada; pido decisión al leader/Raf.

## Tarea pedida
Agregar `ALTER TABLE public.maneuver_presets ADD CONSTRAINT maneuver_presets_name_max_len CHECK (char_length(name) <= 80);` en una migración nueva `00XX`, + test backend, + reconciliaciones. NO aplicar (lo aplica el leader).

## Hallazgo bloqueante
Migración **`0070_check_text_length_caps.sql`** (feature 13 — INPUT-1) ya cubre EXACTAMENTE esta columna. Líneas 269-270:

```sql
-- ─── R1.45: maneuver_presets (config jsonb YA topado 0051 → excluida) ───
alter table public.maneuver_presets add constraint maneuver_presets_name_len_chk check (char_length(name) <= 120) not valid;
alter table public.maneuver_presets validate constraint maneuver_presets_name_len_chk;
```

Es decir: ya hay un CHECK server-side autoritativo sobre `maneuver_presets.name`, **VALIDATED** (no solo `NOT VALID`), con techo **120**.

### Evidencia de que está en PRODUCCIÓN (no solo en el repo)
- `progress/history.md:493` — *"Feature 13 ... DONE + desplegada + committeada (`1da96a4`): INPUT-1 (CHECK char_length en 45 columnas/15 tablas, migración 0070) ... 3 migraciones + 8 EFs en prod."*
- `progress/current.md:80` y `:121` referencian los caps de `0070` como ya-VALIDATED y autoritativos (incl. el de `maneuver_presets`).
- `git log` confirma `0070` en el commit `1da96a4` de feature 13.

### El backlog que la tarea pide marcar RESUELTO ya fue cerrado por 0070
El ítem `docs/backlog.md` **2026-06-14 — "Cota server-side de longitud para `work_lot_label` y `maneuver_presets.name`"** proponía justo este cap, con *"N a definir, ej. 80/120"*. **`0070` lo resolvió eligiendo 120** (y también capeó `sessions.work_lot_label <= 120`, línea 263 de 0070). El backlog quedó desactualizado: NO refleja que 0070 ya cerró el ítem. (Esa stale-ness del backlog es probablemente lo que disparó esta tarea.)

## Conflicto concreto con la tarea
1. **Ya existe el cap** → una migración nueva con `maneuver_presets_name_max_len CHECK (<= 80)` sería un **segundo constraint redundante** sobre la misma columna.
2. **Contradice el valor vigente** → el cap vivo es **120**; el pedido es **80**. Tener `<= 120` y `<= 80` juntos hace que el efectivo sea 80, lo que **baja silenciosamente** un techo ya aprobado por Gate 1 + Puerta humana de feature 13, sin que nadie haya decidido bajarlo. El cliente tiene `maxLength=60` (UX), así que ningún nombre legítimo toca ni 80 ni 120 — pero cambiar el techo autoritativo es una decisión que NO me corresponde tomar de motu propio.
3. **Rompería la coherencia del patrón INPUT-1** → todo `design.md` de spec 03 (y specs 08/13) referencian `0070` como el cap autoritativo. Un constraint paralelo a 80 desalinea la única-verdad.

Por las reglas duras del implementer ("si no podés completar la task sin desviarte del spec, parás y reportás; pedís cambios al spec primero") → **PARO**.

## NO hice (a propósito)
- ❌ NO escribí la migración 0092 (sería redundante/contradictoria).
- ❌ NO apliqué nada a la DB (forbidden por la tarea; además el classifier bloqueó —correctamente— un probe de escritura que intenté contra el remoto; lo respeté).
- ❌ NO marqué `done`.
- ❌ NO toqué specs/backlog todavía (las reconciliaciones que pedía la tarea asumen una migración nueva que no debe existir; espero la decisión).

## Opciones para el leader/Raf (decisión requerida)
- **A (recomendada) — NO-OP de schema.** Reconocer que `0070` ya cubre el cap. NO hay migración nueva. Acción de doc: marcar **RESUELTO** el ítem de backlog 2026-06-14 apuntando a `0070` (techo 120, VALIDATED, en prod) y agregar a `design.md` §7 de spec 03 la fila del cap citando `0070_check_text_length_caps.sql:269-270` (no un constraint nuevo). El `maxLength=60` UX del cliente sigue como barrera de UX. Esto es edición de docs pura → el implementer la puede hacer si el leader confirma que NO se quiere migración nueva.
- **B — bajar el techo 120 → 80.** Si Raf realmente quiere 80 como techo autoritativo (no 120), la forma correcta NO es un constraint paralelo: es **dropear** `maneuver_presets_name_len_chk` y recrearlo a 80 (un solo CHECK por columna), reconciliando el design de INPUT-1/feature 13. Esto **modifica un control de seguridad ya aprobado** (Gate 1 + Puerta humana de feature 13) → necesita decisión explícita de Raf + probablemente re-Gate 1 puntual. NO lo hago sin esa decisión. (Nota: 80 < 120 nunca afecta input legítimo dado `maxLength=60`, así que el beneficio de seguridad de bajar a 80 sobre el 120 ya vivo es nulo — el 120 ya frena el storage-exhaustion. Recomiendo A.)

## Verificación
- `node scripts/check.mjs`: NO lo corrí como parte de un cambio porque NO hay cambio de código/SQL que verificar (paré antes de escribir). El rojo conocido `animals_tag_unique` por terminales paralelas no sería regresión de todos modos.

## Próximo paso
Decisión del leader/Raf entre A y B. Si A: el implementer (o el leader, es doc) cierra el backlog 2026-06-14 + agrega la fila a design §7 citando 0070. Si B: nueva tarea con drop+recreate del constraint a 80 + reconciliación de feature 13 + re-Gate 1 puntual.
