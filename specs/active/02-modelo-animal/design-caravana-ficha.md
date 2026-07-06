# Design (delta spec 02) — Agregar caravana desde la ficha (electrónica + visual)

**Status**: `spec_ready` (delta de spec 02 — frontend puro). Cubre `requirements-caravana-ficha.md`
(RCF.1–RCF.5).
**Fecha**: 2026-06-29

> Delta chico, plumbing casi todo existente. **No toca el backend**: la caravana electrónica reusa el RPC
> `assign_tag_to_animal` (0089) y el `idv` se asigna por UPDATE local sobre `animal_profiles` (tabla, trigger de
> inmutabilidad y unique parcial ya vigentes). No crea schema, RLS, RPC ni Edge → **Gate 1 N/A** (sección 8).
>
> **Ampliación (delta bastoneo, 2026-07-06)**: se agregó el **bastoneo de la caravana electrónica desde la
> ficha** (RCF.6) reusando la infraestructura BLE de ADR-024 (el MISMO listener/contrato de ingesta que MODO
> MANIOBRAS y el FindOrCreateOverlay). Sigue siendo **frontend puro** (Gate 1 N/A). Detalle en **§10**.

## 1. Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `app/src/utils/identifier-assign.ts` | **NUEVO** — módulo PURO: `canAssignTag({ status, tagElectronic })` + `canAssignIdv({ status, idv })` (predicados de elegibilidad activo+null, RCF.1.7). Testeable con `node:test`, sin RN/red. |
| `app/src/services/powersync/local-reads.ts` | **+`buildSetIdvUpdate(profileId, idv)`** (RCF.3.3/RCF.3.4) — espejo de `buildSetCutUpdate` (`:1746`): `UPDATE animal_profiles SET idv = ? WHERE id = ? AND deleted_at IS NULL`. Una CrudEntry PATCH. |
| `app/src/services/animals.ts` | **+`setIdv(profileId, idv)`** (RCF.3.3): orquestador delgado `ServiceResult<true>` que delega en `runLocalWrite(buildSetIdvUpdate(...))` (mismo patrón que `setCastrated`/`setFutureBull`). El TAG **no** agrega service nuevo (reusa `assignTagToAnimal` `:1176` + `lookupByTag` `:747`). ⚠️ archivo con cambios sin commitear de otra terminal — editar con cuidado. |
| `app/src/components/IdentifierAssignRow.tsx` | **NUEVO** — fila de asignación inline parametrizada por `kind` (`'tag'` \| `'idv'`): muestra el CTA "Agregar caravana …", expande un `FormField` (numérico) + Confirmar/Cancelar (espejo del patrón inline de `CastrationRow`/`CutRow`), validación inline (`error`), `busy`. Recibe `onConfirm(value)` y `validate(value)`. **As-built (impl)**: props finales = `kind, label, placeholder?, keyboardType?='number-pad', sanitize, maxLength?, validate, onConfirm`; la copy del CTA se **deriva de `kind`** ("Agregar caravana electrónica"/"Agregar caravana visual", RCF.1.1/1.3 — no es prop); importa `Button`/`FormField` directo (no del barrel) para evitar el ciclo con `index.ts`. `maxLength?` (opcional, belt-and-suspenders del `sanitize`) se agregó para topear el input nativo. |
| `app/app/animal/[id].tsx` | En la sección "Identificación" (`:749-754`): por cada identificador, render condicional **valor solo-lectura** (`AttributeRow`, si `!= null`) **o** `IdentifierAssignRow` (si `== null && status==='active'`, RCF.1). Cablear: idv → `setIdv` (local; optimismo en sitio **+ refresh silencioso**); tag → pre-check `lookupByTag(detail.establishmentId)` + `assignTagToAnimal` (optimismo en sitio, **refresh del tag se OMITE** — ver §4.6 reconciliación: un refresh inmediato blanquearía el denorm no-propagado). ⚠️ advertencia "cambios sin commitear de otra terminal" = **espuria** (el leader verificó `git status` limpio; se editó con normalidad). |
| `app/src/components/index.ts` | Export del nuevo `IdentifierAssignRow` (+ `TagScanSheet`, delta bastoneo). ⚠️ archivo modificado por otra terminal — append-only. |
| `app/src/services/powersync/local-reads.test.ts` (o el suite de builders) | Unit del shape SQL de `buildSetIdvUpdate`. |
| `app/src/utils/identifier-assign.test.ts` | **NUEVO** — unit de los predicados. |
| `app/e2e/animals.spec.ts` | E2E asignar idv (offline-local) + asignar tag (15 díg) + validación + read-only de lo seteado. |
| **Delta bastoneo (2026-07-06) — §10:** | |
| `app/src/services/ble/listener-gate.ts` (+`.test.ts`) | **NUEVO** — `resolveListening({ scopedScannerActive, enabled, busy })` PURO (RCF.6.7) + unit. |
| `app/src/services/ble/BleStickListenerProvider.tsx` | **+`acquireScopedScanner()` + `scopedScannerActive`** en el `ProviderApi`; `listening` pasa a usar `resolveListening` (un scanner acotado fuerza la escucha aunque busyMode esté prendido). |
| `app/src/services/ble/stick.ts` | **+`useScopedScannerControls()`** (devuelve el `acquireScopedScanner` estable del provider). |
| `app/app/_components/FindOrCreateOverlay.tsx` | **Guard `scopedScannerActive`** en `onTagRead` (retorno temprano, paralelo a `BLE_OWNED_ROUTES`) + `testID="find-or-create-overlay"` (oráculo E2E) + cierre defensivo si un scanner acotado se activa con el overlay abierto. |
| `app/src/components/TagScanSheet.tsx` | **NUEVO** — bottom-sheet de scan ACOTADO (RCF.6): adquiere la propiedad exclusiva del listener, hero adaptativo (scan/connect/manual-promovido), **carga manual DENTRO del sheet** (`ManualTagEntry`, detrás de "¿Sin bastón?"), confirmación pre-commit + assign a ESTE animal. |
| `app/app/animal/[id].tsx` | En la caravana electrónica vacía: **una única** afordancia "Bastonear la caravana" (`TagScanCta`); NO hay carga manual directa de la electrónica en la ficha (UX Raf 2026-07-06). Monta `TagScanSheet` al root, condicional a `scanOpen && canAssignTag`. (El `idv` conserva su `IdentifierAssignRow` inline.) |
| `app/e2e/baston-ficha.spec.ts` + `app/e2e/captures/caravana-ficha-bastoneo.capture.ts` | **NUEVOS** — E2E de regresión (mock) + capture del Gate 2.5. |

## 2. Afordancia en la sección "Identificación" (criterio: inline vs sheet)

**Decisión (default del leader, confirmable en Puerta 2): afordancia INLINE en la sección "Identificación"**,
una `IdentifierAssignRow` por identificador vacío — NO un sheet. Razones:

- Es **un solo campo por identificador** → un sheet con header-fijo/body-scroll/footer-fijo es overhead; el
  patrón inline (CTA → expande input + Confirmar/Cancelar) ya es el canónico del repo para acciones de un campo
  en la ficha (`CastrationRow`, `CutRow`, `LoteControl`). Mantiene "una decisión por afordancia" (RCF.4.2).
- El campo queda **en vista** al expandirse → el MUST de "scroll-al-campo en validación" se satisface
  trivialmente (el campo ya está visible; RCF.4.3). Si en review de diseño se prefiere sheet, el contrato de
  `IdentifierAssignRow` no cambia (mismo `onConfirm`/`validate`), solo su contenedor.

Estructura de la sección "Identificación" tras el cambio (pseudo):

```
<DetailSection icon={Tag} title="Identificación">
  {/* Caravana electrónica */}
  {detail.tagElectronic != null
    ? <AttributeRow label="Caravana electrónica" value={detail.tagElectronic} />
    : canAssignTag(detail)
      ? <IdentifierAssignRow kind="tag"
          label="Caravana electrónica"
          placeholder="982 0001 2345 6789"
          keyboardType="number-pad"
          sanitize={sanitizeTagInput}
          validate={(v) => isValidTagElectronic(v) && v.trim().length === TAG_ELECTRONIC_LENGTH
            ? null : 'La caravana electrónica tiene que tener 15 dígitos.'}
          onConfirm={onAssignTag} />
      : <AttributeRow label="Caravana electrónica" value="—" />}

  {/* Caravana visual (idv) — label "Caravana visual" desde el relabel #2 (ver reconciliación abajo) */}
  {detail.idv != null
    ? <AttributeRow label="Caravana visual" value={detail.idv} />
    : canAssignIdv(detail)
      ? <IdentifierAssignRow kind="idv"
          label="Caravana visual"
          placeholder="Número de caravana oficial"
          keyboardType="number-pad"
          sanitize={sanitizeIdvInput}
          validate={(v) => v.trim().length > 0 ? null : 'Ingresá el número de caravana.'}
          onConfirm={onAssignIdv} />
      : <AttributeRow label="Caravana visual" value="—" />}

  {/* visual_id_alt → "Nombre / seña", CONDICIONAL: solo si tiene valor (relabel #2). Vacío → no se renderiza
      (así quedan 2 caravanas + opcionalmente nombre/seña). NO es una caravana ni lleva IdentifierAssignRow. */}
  {detail.visualIdAlt != null
    ? <AttributeRow label="Nombre / seña" value={detail.visualIdAlt} />
    : null}
</DetailSection>
```

- `canAssignTag`/`canAssignIdv` = `status === 'active' && <id> == null` (módulo puro §3). Si el animal está
  archivado y el id está vacío → cae al `AttributeRow value="—"` (no se ofrece, RCF.1.5).
- "Detectar bastoneo" NO se agrega (RCF.1.6, deferido a hardware). `visual_id_alt` no lleva afordancia de
  asignación (RCF.1.6 sigue vigente: no se "asigna" como caravana) — **PERO** se relabeló a "Nombre / seña" y se
  hace condicional (`!= null`) por la corrección **#2** (caravana 3→2); ver reconciliación abajo.

> **Reconciliación as-built (corrección #2, 2026-06-30 — relabel de caravanas 3→2)**: el modelo presenta 2
> caravanas + nombre/seña. Labels actualizados: `idv` = **"Caravana visual"** (era "Caravana / IDV"),
> `visual_id_alt` = **"Nombre / seña"** y **condicional** (solo se renderiza si tiene valor; era siempre con
> `?? '—'`). La afordancia `IdentifierAssignRow` de `idv` vacío NO cambió (solo su label). RCF.1.6 (no se asigna
> `visual_id_alt` como caravana) sigue cierto. Hecho Nivel A (ADR-028) en `[id].tsx`/`crear-animal.tsx`; gateado
> (reviewer + Gate 2). Pendiente: gating por toggle de rodeo de "Nombre / seña" (necesita `rodeo_data_config`, DB).

## 3. Módulo puro `identifier-assign.ts` (RCF.1.7)

```ts
type IdentifierEligibility = { status: 'active' | 'sold' | 'dead' | 'transferred' };

export function canAssignTag(a: IdentifierEligibility & { tagElectronic: string | null }): boolean {
  return a.status === 'active' && a.tagElectronic == null;
}
export function canAssignIdv(a: IdentifierEligibility & { idv: string | null }): boolean {
  return a.status === 'active' && a.idv == null;
}
```

Sin red ni SDK → testeable con `node:test`. La elección de qué afordancia mostrar cuelga de estos predicados +
del valor del identificador (no se infiere de otra cosa).

## 4. Caravana electrónica — RPC existente (RCF.2)

Reuso TOTAL, cero backend nuevo:

1. **Sanitización en vivo** (RCF.2.1): `onChangeText={(t) => setTag(sanitizeTagInput(t))}` — solo dígitos ≤15
   (`animal-input.ts:32`).
2. **Validación al confirmar** (RCF.2.2): `isValidTagElectronic(tag)` AND largo exacto 15 → si no, `error`
   inline "La caravana electrónica tiene que tener 15 dígitos." (mismo copy que el alta, `crear-animal.tsx:504`).
3. **Pre-check de dup** (RCF.2.3): `const r = await lookupByTag(tag, detail.establishmentId)` — si
   `r.value.mode === 'edit'` o `'transfer'` (el TAG ya resuelve a un animal del usuario) → error accionable
   "Esa caravana ya está asignada a otro animal de tus campos." y NO encolar. (Misma señal que
   `asignar-caravanas.tsx:321-324`, reuso de R5.6.) El pre-check es **prevención** (best-effort, solo ve lo
   sincronizado); la barrera real es server-side al subir.
4. **Encolado** (RCF.2.4): `await assignTagToAnimal(detail.profileId, tag)` → `enqueueAssignTag` → RPC
   `assign_tag_to_animal` (0089) al drenar. `animals` no existe en el SQLite local (ADR-026) → NO hay UPDATE
   local; el efecto baja a `animal_profiles.animal_tag_electronic` por el trigger 0079 al sincronizar.
5. **Error de encolado** (RCF.2.6): surface inline, afordancia abierta para reintentar.
6. **Éxito** (RCF.2.7): optimismo en sitio (mostrar el valor recién tipeado en la fila). El dup/race/sin-rol
   reales (23505/23514/42501) los clasifica `uploadData` como `permanent_reject` y los superficia (RD6 spec 09)
   al subir.

   > **Reconciliación as-built (impl, 2026-06-29) — el TAG NO dispara refresh silencioso inmediato.** A diferencia
   > del `idv` (UPDATE local → la lectura local lo refleja al instante, por eso SÍ lleva `load({silent:true})`),
   > `assignTagToAnimal` solo ENCOLA el RPC SIN overlay (`enqueueAssignTag` no escribe nada en el SQLite local —
   > `animals` está fuera del sync set, ADR-026; y no hay overlay sobre `animal_profiles.animal_tag_electronic`).
   > Por eso `animal_profiles.animal_tag_electronic` sigue **NULL localmente** hasta que el RPC drene ONLINE + el
   > trigger 0079 propague + baje por la stream. Un `load({silent:true})` INMEDIATO re-leería ese NULL y
   > **blanquearía el optimismo** — violando el propio "sin blanquear la ficha" de RCF.2.7. → El handler `onAssignTag`
   > hace optimismo en sitio y **omite** el refresh inmediato; el valor canónico (mismos dígitos) entra en el
   > próximo re-focus DESPUÉS de sincronizar. (El `idv` mantiene optimismo + refresh silencioso, que para un UPDATE
   > local es seguro y no blanquea.)

`establishmentId` se deriva de `detail.establishmentId` (el del **perfil**, `animals.ts:139`), nunca del
contexto activo (RCF.2.5) — el usuario podría mirar la ficha del campo A con el campo B activo.

## 5. Caravana visual / `idv` — UPDATE local (RCF.3) — **la pregunta clave**

`idv` vive en `animal_profiles` (sincronizada). Se asigna por **UPDATE local plano**, mismo camino offline-first
que `setCastrated`/`setFutureBull`/CUT.

### 5.1 Builder nuevo `buildSetIdvUpdate` (`local-reads.ts`)

```ts
/**
 * UPDATE local de asignación inicial de IDV / caravana visual (RCF.3.3/RCF.3.4): NULL→valor, una CrudEntry
 * PATCH, offline-first. Espejo de buildSetCutUpdate. Escribe SOLO `idv` — no toca otras columnas. La
 * inmutabilidad R4.13 (tg_animal_profiles_block_idv_change, 0036) PERMITE NULL→valor al subir; el unique
 * parcial (establishment_id, idv) (animal_profiles_idv_unique, 0020) la enforza al sincronizar. Filtra
 * deleted_at IS NULL.
 */
export function buildSetIdvUpdate(profileId: string, idv: string): LocalQuery {
  return {
    sql: 'UPDATE animal_profiles SET idv = ? WHERE id = ? AND deleted_at IS NULL',
    args: [idv, profileId],
  };
}
```

### 5.2 Service `setIdv` (`animals.ts`)

```ts
/** Asigna la caravana visual (idv) de un animal sin idv (NULL→valor) por UPDATE local (RCF.3.3). */
export async function setIdv(profileId: string, idv: string): Promise<ServiceResult<true>>;
//  return runLocalWrite(buildSetIdvUpdate(profileId, idv))  → { ok:true, value:true } | propaga error
```

Wrapper de una línea (no necesita núcleo puro tipo `cut-service-core`: no hay decisión id→write/error, solo
ejecuta el write — la validación de "no vacío" vive en la UI, RCF.3.2). El builder (puro, en `local-reads.ts`)
es lo testeable por `node:test`; el service value-importa el SDK (no importable bajo el runner), igual que
`setCastrated`.

### 5.3 Verificación del trigger R4.13 y el unique (RCF.3.4) — **as-built citado**

| Garantía | Dónde | Veredicto |
|---|---|---|
| Inmutabilidad de `idv` permite `NULL → valor` | `supabase/migrations/0036_immutability_identifiers.sql:30-32` (`if old.idv is null then return new;`) | ✅ el UPDATE local NULL→valor pasa el trigger al subir |
| `valor → otro` / `valor → NULL` bloqueados | `0036:33-37` (`raise … 23514`) | ✅ irrelevante acá (solo asignamos lo vacío; RCF.1.4 además no ofrece editar) |
| Unicidad por campo | `0020_animal_profiles.sql:50-53` (`animal_profiles_idv_unique on (establishment_id, idv) where idv is not null and deleted_at is null`) | ✅ un idv duplicado en el campo se rechaza al sincronizar (RCF.3.5) |
| `idv` es columna de tabla sincronizada | `0020:18` (`idv text`) | ✅ UPDATE local viable (a diferencia de `tag_electronic`, que vive en `animals`, no sincronizada) |

**Conclusión: el path de `idv` es UPDATE-local 100% frontend → no requiere RPC nuevo ni policy nueva ni
migración.** Si la implementación encontrara lo contrario (p. ej. que PowerSync no captura el PATCH de `idv` por
alguna razón estructural), se detiene y se eleva a Gate 1 — pero el as-built dice que es el mismo patrón
probado de CUT/castrado.

### 5.4 Manejo del idv duplicado (RCF.3.5)

No se inventa validación de unicidad en cliente. El UPDATE local tiene éxito inmediato; si el `idv` colisiona
con otro del mismo campo, el índice único parcial lo rechaza **al subir** y `uploadData` lo superficia
(`duplicate_idv`, mismo tratamiento que el alta, `animals.ts:88`). El optimismo en sitio + refresh muestran el
idv localmente; un rechazo posterior se comunica por el canal de errores de sync existente (no hay regresión de
ese plumbing en este delta).

## 6. Decisión de offline-sync

- **`idv`** → escritura **local plana** sobre `animal_profiles` (CRUD-plano, una CrudEntry PATCH) → offline-first
  nativo de PowerSync. La RLS `animal_profiles_update` y la inmutabilidad/unique re-validan al SUBIR. Funciona
  100% sin red (RCF.5.1).
- **`tag_electronic`** → `animals` está FUERA del sync set (ADR-026 b1, no existe en el SQLite local) → **no hay
  UPDATE local posible**; la única vía es el RPC vía outbox. El **encolado** tiene éxito offline (la intención
  queda en la outbox); el RPC se ejecuta al SUBIR (online). Es la asimetría documentada del context #2: visual
  offline-safe, electrónica online (RCF.5.1).

## 7. RLS / multi-tenancy

No se crean ni modifican policies. La barrera real al subir:

- `idv` (UPDATE local): la policy existente `animal_profiles_update` (cualquier rol con `has_role_in` del
  establishment del perfil) gobierna el UPDATE. La afordancia solo expone un UPDATE que la RLS ya gobierna.
- `tag` (RPC): `assign_tag_to_animal` (0089) deriva el tenant de la fila real del perfil (anti-IDOR) y re-chequea
  `has_role_in`; el cliente nunca pasa `establishment_id` ni `animal_id`, solo `profileId` (RCF.5.2).

El delta no debilita el aislamiento multi-tenant: un usuario sin rol en el campo no puede asignar ninguno de los
dos (el write/RPC se rechaza al subir).

## 8. ¿Toca DB? — NO · Gate 1 N/A

| Vector de Gate 1 | ¿Toca? |
|---|---|
| Schema (tablas/columnas/índices) | NO — `idv`, el trigger y el unique ya existen; `tag` por RPC existente |
| RLS policies | NO — reusa `animal_profiles_update` (idv) y la authz del RPC (tag) |
| Edge Functions | NO |
| RPC nuevo / modificado | NO — `assign_tag_to_animal` (0089) sin cambios |
| Migración | NINGUNA |
| Datos regulados (SENASA/PII) | Solo lectura/asignación de identificadores ya gobernados por specs 02/09; sin nuevo flujo regulado |

→ **Frontend puro → Gate 1 N/A.** (Disparador de escalada: si el path de `idv` requiriera un RPC/policy/migración
nuevos, el delta se detiene y va a Gate 1. El as-built verificado dice que no.)

## 9. Alternativa descartada

- **`idv` por un RPC nuevo `assign_idv_to_animal`** (espejo de `assign_tag_to_animal`). Descartada: `idv` vive en
  una tabla **sincronizada** (`animal_profiles`) con el trigger de inmutabilidad ya permitiendo `NULL→valor` y el
  unique parcial ya vigente → el UPDATE local es offline-first, sin red, y reusa el camino probado de CUT/castrado.
  Un RPC agregaría una migración (Gate 1), requeriría online y rompería la simetría con `setCastrated`/`setCut`
  sin ningún beneficio (la authz ya la da la RLS `animal_profiles_update` al subir). Costo evitado: 1 migración +
  1 Edge/RPC + Gate 1.
- **Un editor genérico de identificadores en la ficha** (poder cambiar cualquier identificador, incluso los
  seteados). Descartada: fuera del Gate 0 (`context-caravana-ficha.md` §No entra) y contra R4.13 (inmutabilidad
  post-completitud) — solo se asigna lo VACÍO.
- **Resolver la afordancia manual en un sheet** en vez de inline. Sigue siendo el default para el `idv` (patrón
  inline canónico de la ficha, `CastrationRow`/`CutRow`). Para la **caravana ELECTRÓNICA**, en cambio, Raf pidió
  (2026-07-06) que la ficha ofrezca SOLO "Bastonear" y que la carga manual viva DENTRO del sheet (menos ruido en
  la ficha; el scan es el path principal, el teclado es su fallback) → la electrónica NO usa `IdentifierAssignRow`
  inline; su manual es la vista `ManualTagEntry` del sheet (§10.2). El `idv` mantiene el `IdentifierAssignRow` inline.
- **(bastoneo) El sheet togglea `busy` directamente** para des-suspender el listener global, en vez del scanner
  acotado. Descartada: `busy` tiene un solo dueño (`useBusyWhileMounted` de la ficha); dos escritores del mismo
  booleano es frágil (orden de efectos, re-runs). El scanner acotado (contador propio + `resolveListening`) deja
  a `busy` intacto y devuelve la escucha EXACTA al soltar → sin estado colgado (§10.1).
- **(bastoneo) Refactorizar los heroes de `maniobra/identificar.tsx` a un módulo compartido**. Descartada: tocar
  un archivo de una feature `done` para extraer ~200 líneas arriesga regresiones en la suite de maniobra. Se
  REPLICÓ el lenguaje visual a escala de sheet en `TagScanSheet` (RCF.6.2 permite "replicalo/compartilo").

## 10. Bastoneo de la caravana electrónica desde la ficha (RCF.6) — delta 2026-07-06

Reuso TOTAL de la infraestructura BLE de ADR-024 (contrato de ingesta + provider global + adaptadores). Cero
backend nuevo (Gate 1 sigue N/A). El sheet asigna a ESTE animal por el MISMO `assignTagToAnimal` que la carga
manual (RCF.2) — no es find-or-create, no hay picker.

### 10.1 El punto CRÍTICO — propiedad EXCLUSIVA del listener

La ficha suspende el listener global con `useBusyWhileMounted` (busyMode → `listening = enabled && !busy` =
false) para que un bastonazo no dispare el `FindOrCreateOverlay` encima. El sheet de scan necesita lo INVERSO
**pero exclusivo**: la lectura debe entrar al sheet, y el overlay global NO debe procesarla.

**Solución (la más limpia / menos invasiva)**: un **"scanner acotado"** en el provider — un CONTADOR
(`scopedCount`, tolerante a re-montajes/StrictMode) expuesto como `scopedScannerActive` + `acquireScopedScanner()`
(devuelve un `release` idempotente). El sheet lo adquiere en un efecto (acquire al montar / release en el
cleanup, incl. back-gesture). Con ≥1 scanner acotado activo:

1. **La escucha se FUERZA** — `listening = resolveListening({ scopedScannerActive, enabled, busy }) =
   scopedScannerActive || (enabled && !busy)` (módulo puro `listener-gate.ts`, RCF.6.7). Así el listener entrega
   la lectura aunque busyMode esté prendido. Se eligió esto por sobre "el sheet togglea `busy`": `busy` tiene un
   solo dueño (`useBusyWhileMounted` de la ficha) → el sheet NUNCA lo toca (evita el estado compartido frágil de
   dos escritores). Cuando el scanner se libera, `listening` vuelve EXACTAMENTE a `enabled && !busy` → la ficha
   re-suspende sola (un bastonazo posterior no hace nada) — **sin transporte colgado ni busyMode inconsistente**.
2. **El FindOrCreateOverlay IGNORA la lectura** — `onTagRead` chequea `scopedScannerActiveRef.current` y retorna
   temprano (paralelo EXACTO a `onBleOwnedRouteRef`). La ficha no es una `BLE_OWNED_ROUTE` (y encima apaga
   busyMode via el scanner) → el flag de contexto es la señal correcta, no la ruta.

Así hay UN solo consumidor efectivo del bastón (el sheet), sin doble proceso del EID.

### 10.2 El sheet (`TagScanSheet.tsx`)

- **Ownership**: `useScopedScannerControls()` → acquire en un efecto (mount) / release (unmount). Se monta
  CONDICIONAL a `scanOpen` en la ficha → mount/unmount mapea 1:1 al acquire/release (limpieza robusta).
- **Suscripción**: `useBleStickListener({ enabled: true, onTagRead })` (el EID llega YA validado+dedupeado del
  contrato). `useBleProviderApi()` para `transport` (conectable) + `connect()`.
- **Hero adaptativo** (RCF.6.2, REPLICADO de `maniobra/identificar.tsx`, sin refactorizarlo — menor riesgo de
  regresión en la maniobra): `resolveListenConnState({ isConnected, conectable })` → `connected` (ScanHero
  pulso + link "¿Sin bastón?") / `connectable` (ConnectHero disco tappable + badge Bluetooth, tap = gesto que
  web-serial exige, + link "¿Sin bastón?") / `manual` (prompt NEUTRO "El bastón no está disponible en este
  dispositivo" + CTA "Cargar la caravana a mano").
- **Carga MANUAL DENTRO del sheet** (RCF.6.6, UX Raf 2026-07-06): estado `manualMode` → vista `ManualTagEntry`
  (un `FormField` numérico: `sanitizeTagInput` en vivo, `maxLength=TAG_ELECTRONIC_LENGTH`; al confirmar valida
  `isValidTagElectronic && len===15` con la copy "La caravana electrónica tiene que tener 15 dígitos." ANTES de
  asignar; luego `onAssignTag(value)` — el MISMO path que el BLE; [Asignar caravana] / [Volver]). Se entra por
  el link "¿Sin bastón?" (scan/connect) o el CTA (manual-promovido). En `manualMode`, `onTagRead` **ignora** las
  lecturas del bastón (`manualModeRef`) — el usuario está tipeando; el scoped scanner sigue activo (no se suelta
  la propiedad, solo no se actúa sobre las lecturas).
- **Lectura → confirmación pre-commit** (RCF.6.3, integridad SENASA ADR-024): `formatEidReadable` (15 díg
  legibles) + "Asignar esta caravana a este animal" + [Asignar caravana] / [Volver a escanear]. Un bastonazo
  nuevo reemplaza la lectura a confirmar (live-rescan), salvo assign en vuelo (`assigningRef`).
- **Assign** (RCF.6.4): `onAssignTag(eid)` (el MISMO del host: pre-check `lookupByTag(detail.establishmentId)` +
  `assignTagToAnimal` + optimismo en sitio). Éxito → `onClose()` (el optimismo deja la fila read-only → el sheet
  ya no aplica). Error → inline, sheet ABIERTO (fail-closed).

### 10.3 Afordancia en la ficha (`[id].tsx`)

Con `canAssignTag(detail)` (tag null + activo), la caravana electrónica muestra el label "Caravana electrónica"
+ **una única** afordancia: `TagScanCta` "Bastonear la caravana" (prominente, StickIcon + `$greenLight`, ≥
`$touchMin`) → abre el sheet. **NO hay carga manual directa de la electrónica en la ficha** (UX Raf 2026-07-06):
la carga manual por teclado vive DENTRO del sheet (§10.2). El sheet se monta al root condicional a `scanOpen &&
canAssignTag`. (El `idv`/RCF.3 mantiene su `IdentifierAssignRow` inline en la ficha, sin cambios.)

### 10.4 Degradación sin transporte (native Expo Go hoy)

En native no hay transporte buildable todavía (`spp-android` es Fase 4 de spec 04) → `transport == null` →
`resolveListenConnState` da `manual` → el sheet muestra el prompt NEUTRO y su CTA abre la carga MANUAL **dentro
del sheet** (§10.2). NO es un botón muerto: es una degradación honesta con tono neutro. En WEB (web-serial) y en
el mock de E2E el transporte existe → el scan funciona.

### 10.5 Verificación del punto crítico (a/b/c)

- **(a)** con el sheet abierto, una lectura se asigna a ESTE animal y el overlay NO se abre → E2E
  `baston-ficha.spec.ts (a)` (oráculo server `waitForServerTagAssigned` + ausencia del testID
  `find-or-create-overlay`).
- **(b)** al cerrar el sheet, la ficha re-suspende el listener (un bastonazo posterior no hace nada) → E2E `(b)`
  + unit `resolveListening` (al liberar, vuelve a `enabled && !busy`).
- **(c)** no queda transporte escuchando de más ni busyMode mal seteado → el `release` idempotente + el
  `listening` effect (`if (listening) transport.enable(); else transport.disable()`) apagan el transporte al
  cerrar; `busy` nunca lo toca el sheet (un solo dueño).
