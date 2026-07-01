# Spec 02 — Delta PARTO: RODEO + CARAVANA VISUAL DEL TERNERO (#4 / #1a) — Design

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)** sobre spec 02 (feature `done`) · **frontend-only** · **Gate 1 N/A**.
**Fuente de verdad**: `context-parto-rodeo-caravana.md`. **Requirements**: `requirements-parto-rodeo-caravana.md` (`RPRC.<n>`).
**Sin deploy**: NO se toca `supabase/`. El RPC `register_birth` **6-arg** (`0116`) y el servicio `registerBirth` (`calfRodeoId`/`calfIdv`) ya están deployados/listos por el delta #15. No hay migración que aplicar, no hay suites backend nuevas.

> **Multi-tenancy**: el picker de rodeo filtra client-side por el **sistema** del rodeo de la madre (anti-mezcla de categoría); la barrera real es server-side: `register_birth` deriva el tenant de la fila real de la madre y valida que el rodeo del ternero sea del **tenant de la madre** + activo + mismo sistema (`23514`) — el cliente **nunca** pasa `establishment_id` (ver §4, ya aprobado en el Gate 1 de #15).
> **Offline-first**: la carga ocurre en el campo, sin señal → la lectura de rodeos es **local** (`useRodeo()` sobre SQLite) y la escritura va por la **outbox** de `registerBirth` (ver §5). Sin red nueva.

---

## 0. Deltas posteriores (para el índice del baseline al cerrar)

Al cerrar la Puerta 2, el leader folda al `design.md` baseline de spec 02 un puntero bajo R9/R14 (parto):
- `parto-rodeo-caravana` — picker de rodeo a nivel parto (todos los terneros) + caravana visual (idv) del ternero solo cuando hay 1 ternero, ambos vía `register_birth` 6-arg. Frontend-only. Estado: (lo completa el leader al cerrar).

## 1. Archivos a crear / modificar

### Backend
- **NINGUNO.** Frontend-only (RPRC.5.1). El RPC `register_birth(uuid,date,jsonb,uuid,uuid,text)` (6-arg, `0116`) ya está deployado y valida rodeo (activo/tenant/sistema → `23514`) e idv (unicidad `(establishment_id, idv)` / inmutabilidad). `git diff supabase/` debe quedar **vacío**.

### Frontend (UI)
- **MODIFICAR** `app/app/agregar-evento.tsx` — el form de parto (`PartoForm` / `eventType='birth'`):
  1. **Estado nuevo** en el screen: `calfRodeoId: string | null` (rodeo elegido; `null` = usar el de la madre) y `calfIdv: string` (caravana visual del ternero, single-calf).
  2. **Rodeo del parto (RPRC.1)**: un selector de rodeo inline a **nivel parto** (arriba de la lista de terneros, dentro de `PartoForm`), preseleccionado al rodeo de la madre + leyenda "(Mismo rodeo que la madre)", editable a otro rodeo del **mismo sistema**. Rodeos desde `useRodeo()` (campo activo), filtrados por el `systemId` del rodeo de la madre.
  3. **Caravana visual (RPRC.2)**: un `FormField` de caravana visual **por parto** que se renderiza **solo cuando `calves.length === 1`**; con `≥2` terneros, se oculta y se muestra una `InfoNote` con la nota de mellizos.
  4. **Submit (`eventType==='birth'`, RPRC.3)**: pasar `calfRodeoId` (rodeo efectivo) y — solo si `calves.length === 1` y hay idv — `calfIdv` a `registerBirth`.
- **MODIFICAR** `app/app/animal/[id].tsx` — `goToAddEvent` (la navegación ficha → `agregar-evento`): agregar a los params **`rodeoId`** y **`rodeoName`** de la madre (ya disponibles en `detail.rodeoId`/`detail.rodeoName`), para preseleccionar el picker + mostrar la leyenda sin un fetch extra.
- **(Posible) MODIFICAR** el punto de entrada del parto **desde la maniobra** si pasa por otra ruta que `agregar-evento` con params distintos — verificar en implementación; si la maniobra usa la MISMA pantalla con los mismos params, **no hay cambio adicional** (RPRC.5.3). El implementer confirma el/los caller(s) de `eventType='birth'`.

> **[Reconciliación as-built — resolución del rodeo de la madre por READ LOCAL, veto leader #1]** El único caller real de `agregar-evento` con `eventType='birth'` es la ficha (`goToAddEvent`) — la maniobra (`app/maniobra/*`) **NO rutea** a `agregar-evento` para parto (grep confirmado: su flujo captura solo sanitario/tacto, no parto). Para que el rodeo de la madre se resuelva **uniforme para todo caller y offline sin depender de que cada caller pase el param**, el as-built agrega **`fetchMotherRodeoContext(profileId)`** (nueva función en `services/events.ts`, reusa `buildBirthOverlayContextQuery` — el MISMO read local que ya usa `registerBirth`) que devuelve `{ rodeoId, systemId }` de la madre desde el SQLite local. `agregar-evento` lo llama en un `useEffect` sobre `profileId` (ya param obligatorio). Los params `rodeoId`/`rodeoName` de la ficha **se conservan** (T1) pero como **seed/fallback del NOMBRE** del rodeo (evita el flash de "—" antes de que resuelva el read + provee el nombre en el fallback cross-field RPRC.1.8), no como fuente autoritativa de `rodeoId`/`systemId`. Ver §4 reconciliado.

### Frontend (reúso, NO crear de cero)
- `useRodeo()` (`RodeoContext`) → `available: Rodeo[]` del campo activo; `Rodeo.systemId` para el filtro (RPRC.1.6).
- `sanitizeIdvInput` (`utils/animal-input`) para la caravana visual (RPRC.2.2).
- El **patrón de selector de rodeo inline** (picker + `ChevronDown` + lista expandible + `RodeoOptionRow` + leyenda) del `CreateCalfForm` de `LinkCalfPrompt.tsx` (§ mapa de reúso).
- `registerBirth` (`services/events.ts`) con `RegisterBirthInput.calfRodeoId?`/`calfIdv?` **ya soportados** (events.ts:514/520, 627/628) — el cliente solo los completa.

### Frontend (tests)
- **CREAR** `app/e2e/captures/parto-rodeo-caravana.capture.ts` (Gate 2.5, RPRC.7.1).
- **EXTENDER** `app/e2e/animals.spec.ts` (o suite de eventos existente) con la regresión del parto (RPRC.7.2). Import de `test`/`expect` desde `./helpers/fixtures` (no `@playwright/test`) — lección `reference_e2e_fixtures_import`.
- Tests unitarios de la lógica pura nueva (ver §6): resolución del rodeo efectivo + del `systemId` de la madre + la regla "idv solo single-calf".

## 2. Mapa de reúso de #15 (`cria-al-pie-alta`)

El delta #15 (`RCAP.5`, `LinkCalfPrompt.tsx`) ya resolvió **exactamente** este par picker-de-rodeo + idv-del-ternero para el camino CREATE del prompt de cría al pie. Este delta **traslada esos patrones** al form de parto (misma UX, mismo backend), sin duplicar lógica de dominio:

| Necesidad de este delta | Pieza de #15 a reusar | Fuente |
|---|---|---|
| Selector de rodeo inline (trigger + `ChevronDown` + lista + `RodeoOptionRow`) | `CreateCalfForm` (subcomponente del prompt) | `app/src/components/LinkCalfPrompt.tsx:723-773`, `:824-844` |
| Filtro de rodeos por sistema de la madre | `calfRodeoOptions = rodeos.filter(r => r.systemId === motherSystemId)` | `LinkCalfPrompt.tsx:122-125` |
| Preselección al rodeo de la madre + rodeo efectivo | `effectiveCalfRodeoId = selectedCalfRodeoId ?? motherRodeoId` | `LinkCalfPrompt.tsx:126` |
| Leyenda "(Mismo rodeo que la madre)" condicional | `isSameRodeoAsMother = effectiveCalfRodeoId === motherRodeoId` | `LinkCalfPrompt.tsx:127`, `:748-752` |
| Rodeo efectivo → `registerBirth({ …, calfRodeoId })` | `onConfirmCreate` | `LinkCalfPrompt.tsx:349-361` |
| Caravana visual del ternero → `calfIdv` | `identifier.idv` → `registerBirth({ …, calfIdv })` | `LinkCalfPrompt.tsx:355-361` |
| Sanitizado de la caravana visual | `sanitizeIdvInput` | `utils/animal-input`, `LinkCalfPrompt.tsx:456` |
| Contrato `registerBirth` (calfRodeoId/calfIdv opcionales) | `RegisterBirthInput` | `services/events.ts:502-521`, `:579-628` |
| Rodeos del campo activo | `useRodeo().available` (`Rodeo.systemId`) | `contexts/RodeoContext.tsx:45`, `services/rodeos.ts` |

**Diferencia clave vs #15**: en #15 el prompt siempre maneja **1 ternero** (mono-cría), así que idv + rodeo van juntos. Acá el parto soporta **mellizos** (lista dinámica `calves: CalfRow[]`): el **rodeo aplica a todos** (escalar, RPRC.1.7), pero el **idv solo se ofrece con 1 ternero** (RPRC.2.3), porque `p_calf_idv` es un único escalar y ofrecer N idvs rompería el contrato del RPC (backend + deploy → fuera de alcance, ver `context.md` D2 y §7).

## 3. Layout del form de parto (as-designed)

```
PARTO (eventType='birth')
├─ Fecha del parto (AAAA-MM-DD)                      ← baseline, sin cambios
├─ Rodeo del parto  [ Rodeo madre ▾ ]               ← NUEVO (RPRC.1) — a nivel parto (toda la camada)
│    (Mismo rodeo que la madre)                       ← leyenda si selección == rodeo madre (RPRC.1.3)
│    └─ (abierto) lista de rodeos del mismo sistema   ← RPRC.1.5/1.6
├─ Caravana visual del ternero (opcional)  [____]    ← NUEVO (RPRC.2) — SOLO si calves.length===1
│    ── ó (con ≥2 terneros) ──
│    InfoNote: "Las caravanas visuales de mellizos    ← RPRC.2.4
│               se asignan después desde la ficha
│               de cada ternero."
├─ Ternero 1  [ Sexo* | Peso opc. | Caravana electrónica opc. ]   ← baseline (tag electrónico por ternero, RPRC.2.5)
├─ (Ternero 2 …)                                      ← baseline (mellizos)
└─ + Agregar otro ternero                             ← baseline
```

- El picker de rodeo se coloca **entre la fecha y el bloque de terneros** (nivel parto, no dentro de una card de ternero) — comunica visualmente que aplica a toda la camada.
- La caravana visual se coloca **a nivel parto** también (no dentro de la card del ternero), reflejando que es un único idv del parto; se muestra/oculta según `calves.length`.
- El **tag electrónico** permanece **dentro de cada `CalfBlock`** (sin cambios, RPRC.2.5).

## 4. Resolución del rodeo de la madre + su sistema (client-side)

> **[Reconciliado al as-built]** El diseño original resolvía `systemId` desde `useRodeo().available.find(r => r.id === motherRodeoId)?.systemId` (dependiendo del param `rodeoId`). El as-built lo resuelve por **READ LOCAL** del perfil de la madre (`fetchMotherRodeoContext`) — autoritativo, uniforme para todo caller, offline (veto leader #1). El `resolveMotherSystemId(available, motherRodeoId)` original **sigue existiendo** como **fallback** (por si el read aún no resolvió). Ver §1 reconciliación.

`agregar-evento.tsx` resuelve `rodeoId` + `systemId` de la madre así (helpers puros en §6 + el read local de §1):

- **Fuente autoritativa** (todo caller, offline): `fetchMotherRodeoContext(profileId)` → `{ rodeoId, systemId }` desde el SQLite local del perfil de la madre (`buildBirthOverlayContextQuery`). `motherRodeoId = motherCtx?.rodeoId ?? paramRodeoId`; `motherSystemId = motherCtx?.systemId ?? resolveMotherSystemId(available, motherRodeoId)` (fallback al helper si el read aún no resolvió).
- **Camino común** (parto sobre un animal del **campo activo**): el rodeo de la madre está en `useRodeo().available` → `eligibleCalfRodeos(available, motherSystemId)` ofrece los del mismo sistema (incluye el de la madre, preseleccionado). `canEditCalfRodeo(eligible, motherRodeoId) === true` → editable.
- **Fallback** (RPRC.1.8): si el rodeo de la madre **no figura** en `eligibleCalfRodeos` (parto sobre un animal de un campo **distinto** del activo, o `RodeoContext` en `loading`/`no_rodeos`) → `canEditCalfRodeo === false` → el picker queda **no editable** (trigger estático, sin chevron ni lista), preseleccionado al rodeo de la madre (nombre desde `available` ?? el param `rodeoName`), con la leyenda. El RPC es el backstop (`23514`). **Nota clave**: como `system_id` es un catálogo **global** (mismo UUID de 'cría' entre campos), el filtro por sistema solo NO alcanzaría para excluir los rodeos del campo activo cuando la madre es de otro campo; el guard `canEditCalfRodeo` (madre debe figurar entre los elegibles) es lo que evita ofrecer rodeos del **tenant equivocado**.

*(No se agrega `systemId` a los params ni a `AnimalDetail`: sale del read local del perfil + del `useRodeo()`. El param `rodeoName` se conserva solo como seed/fallback del nombre a mostrar.)*

## 5. Offline-first (PowerSync) — sin cambios de contrato

- **Lectura de rodeos**: `useRodeo()` ya sirve la lista **local** (SQLite) del campo activo → el picker funciona **offline** (RPRC.4.4).
- **Escritura**: `registerBirth` ya encola el parto por la **outbox** (`enqueueRegisterBirth`) con overlay optimista del evento + los terneros; `calfRodeoId`/`calfIdv` viajan en los params del intent `register_birth` (events.ts:627-628, ya implementado por #15). Al drenar, `mapIntentToRpc` inyecta `p_client_op_id` (idempotencia). **Sin overlay ni intent nuevos.**
- **Rechazo** (RPRC.4.3): un rodeo ajeno (`23514`) o un idv duplicado (`23505`) los clasifica el `uploadData` as-built como **permanente** (surface accionable, sin loop) — mismo camino que cualquier `registerBirth` rechazado. La caravana visual duplicada la resuelve el server; el cliente no la pre-valida.

## 6. Lógica pura testeable (para no meter dominio en el JSX)

Para que la regla "idv solo single-calf" y "rodeo efectivo" sean testeables sin render, extraer helpers puros (o inline con test de integración E2E — decisión menor del implementer, preferible puro):

- `resolveEffectiveCalfRodeoId(selected, motherRodeoId)` → `selected ?? motherRodeoId`.
- `resolveMotherSystemId(rodeos, motherRodeoId)` → `systemId | null` (fallback del read local, ver §4).
- `eligibleCalfRodeos(rodeos, motherSystemId)` → filtrado por sistema (o `[]` si `motherSystemId` null → dispara el fallback RPRC.1.8).
- `calfIdvForSubmit(calves.length, idvRaw)` → `calves.length === 1 && idvRaw.trim() ? idvRaw.trim() : null` (RPRC.3.2/3.3).
- **[as-built]** `canEditCalfRodeo(eligible, motherRodeoId)` → `eligible.some(r => r.id === motherRodeoId)` — el picker es editable solo si el rodeo de la madre figura entre los elegibles (RPRC.1.5); si no, fallback no-editable (RPRC.1.8). Se extrajo como helper puro (no inline en el JSX) porque encarna la decisión de criterio propio RPRC.1.8 y es más robusto testearlo.

Todos viven en `app/src/utils/calf-birth.ts` (+ `calf-birth.test.ts`, 17 casos node:test). Espejan la lógica que en #15 vive inline en `LinkCalfPrompt` (`:122-127`); extraerla acá la hace verificable por test unitario (trazabilidad RPRC.1.6/1.7/1.8/3.2/3.3).

## 7. Alternativas descartadas

1. **Campo de caravana visual (idv) POR ternero, también para mellizos.** Descartada (por ahora): `register_birth` toma un `p_calf_idv` **escalar único** (se diseñó para el camino mono-cría de #15). Ofrecer N idvs (uno por ternero del jsonb `p_calves`) exigiría **extender el jsonb + el RPC + deploy** → NO frontend-only, NO autónomo. Queda en backlog / iteración posterior (context.md D2, alcance NO). El mellizo asigna su visual después desde la ficha (delta `caravana-ficha`, ya existente) — de ahí la nota RPRC.2.4.
2. **Picker de rodeo POR ternero.** Descartada: mismo motivo (`p_calf_rodeo_id` escalar único). Además, en la práctica los mellizos van **al mismo rodeo** (nacen juntos) → un picker a nivel parto es el modelo correcto y más simple (una decisión por pantalla, CLAUDE.md ppio 4).
3. **No preseleccionar (picker vacío, obligar a elegir rodeo).** Descartada: rompe el happy-path (el 99% de los partos van al rodeo de la madre) y contradice #15. Preseleccionar + leyenda es cero-fricción y editable.
4. **Agregar `systemId` de la madre a los params / `AnimalDetail`.** Descartada: se resuelve del `useRodeo()` local (§4) sin ampliar el contrato de `AnimalDetail` ni los params; el camino cross-field cae al fallback RPRC.1.8 (que es lo correcto de todos modos — no ofrecer rodeos del tenant activo para un animal ajeno).

## 8. Decisiones de criterio propio (a confirmar en Puerta 1)

1. **Caravana visual SOLO con 1 ternero (RPRC.2.1/2.3), y descarte del idv si se agrega un mellizo (RPRC.2.5/3.3).** Es la decisión D2 del contexto (criterio propio del leader, ya marcada en Gate 0). Consecuencia del `p_calf_idv` escalar. Si Raf quiere idv para mellizos → alternativa #1 (backend + deploy, iteración posterior).
2. **Fallback no-editable cuando el rodeo de la madre no está en `useRodeo().available` (RPRC.1.8).** Cubre el parto sobre un animal de un campo **distinto** del activo (o `RodeoContext` no `active`). Preselecciona el rodeo de la madre (nombre por param) sin ofrecer opciones; el RPC re-valida. Evita ofrecer rodeos del tenant equivocado. A confirmar; alternativa sería fetchear los rodeos del campo de la madre (más I/O, no offline-trivial) — se descartó por simplicidad, dado que el caso normal es registrar el parto en el campo activo.
3. **Ubicación del picker de rodeo y del idv a nivel parto (entre fecha y terneros), no dentro de las cards de ternero (§3).** Comunica que aplican a toda la camada / al parto. Decisión de layout; el implementer puede ajustar el orden vertical exacto conservando la semántica.
4. **Sin validación client-side nueva.** El rodeo siempre es válido (preseleccionado, filtrado por sistema); el idv solo se **sanitiza** (`sanitizeIdvInput`), sin rechazo client-side de duplicado/formato (la unicidad la valida el server, patrón #15). Por eso la captura Gate 2.5 (e) "validación inline" queda **N/A** documentada (RPRC.7.1). Se conserva la validación inline existente del form (fecha, sexo de cada ternero).

## 9. Gate 1 — N/A (frontend-only)

Este delta **no dispara Gate 1**: no toca RLS, schema, Edge Functions, auth/tokens, secrets ni datos regulados vía DB. Toda la superficie de seguridad (RPC 6-arg: derivación de tenant, `23514` de rodeo ajeno, unicidad/inmutabilidad de idv, `revoke public/anon` + `grant authenticated`) **ya fue auditada y aprobada** en el Gate 1 de #15 (`progress/security_spec_02-cria-al-pie-alta.md`, PASS 0 HIGH). El cliente solo **completa** dos params opcionales ya existentes del contrato. Confirmación operativa: `git diff supabase/` vacío al cerrar. El **Gate 2** (code security, siempre) corre igual sobre el diff frontend.
