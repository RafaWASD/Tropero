# Design (delta spec 02) — Marcar CUT (descarte) desde la ficha + indicador amarillo

**Status**: `spec_ready` (delta de spec 02 — frontend). Cubre `requirements-cut-ficha.md` (RCUT.1–RCUT.8).
**Fecha**: 2026-06-18

> Delta chico, plumbing existente. NO toca el backend (CUT ya existe: `is_cut`, `category_override`, los
> builders `buildSetCutUpdate`/`buildUnsetCutUpdate` y `resolveCutCategory`, el gating 0054). No toca RLS ni
> migraciones. Frontend puro → **Gate 1 N/A** (sin schema/RLS/Edge nuevo).

## 0. Reconciliación con ADR-008 / espejo C6

CUT es una **marca de descarte ortogonal** (ADR-008 enmienda), no un estado de la máquina de categorías. El
as-built ya **reemplaza el display de categoría por "CUT"** cuando `is_cut`/`category_override=true` (la
categoría guardada es la `code='cut'`). Esto es exactamente lo que pide el usuario ("al mostrar la categoría
CUT…"): no inventamos una categoría — pintamos de amarillo la que el modelo ya muestra. El espejo C6
(`computeMirrorOverrides`) NO recalcula categoría cuando `category_override=true` (el caso de un CUT), así
que el badge del hero recibe `categoryCode='cut'`/`categoryName='CUT'` de la fila guardada — sin divergencia.

## 1. Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `app/tamagui.config.ts` | **+2 tokens de color**: `cutText` (amber oscuro, texto) + `cutBg` (amber pálido, fondo) en `palette` + en el grupo `color`. ⚠️ colisión: archivo con cambios sin commitear de otra terminal. |
| `app/src/utils/cut-eligibility.ts` | **NUEVO** — módulo PURO: `canMarkCut(info)` + `canUnmarkCut(info)` (predicados de eligibilidad, RCUT.3) + `isCutCategory({ code?, label? })` (detección CUT del badge, RCUT.6.2). Testeable con node:test, sin RN/red. |
| `app/src/services/cut-service-core.ts` | **NUEVO (as-built, reconciliación §3)** — núcleo PURO `decideSetCut`/`decideUnsetCut` (la DECISIÓN id→write : error-sin-write de RCUT.1/RCUT.2, inyectable) + los mensajes es-AR + tipos. Permite testear el contrato de los servicios con FAKES sin SDK/SQLite (TCUT.7) — `mock.module` requiere un flag que el runner no pasa. Mismo patrón que `resolveTagLookup` (núcleo de `lookupByTag`). |
| `app/src/services/animals.ts` | **+`setCut`/`unsetCut`** (RCUT.1/RCUT.2): orquestadores delgados que resuelven `resolveCutCategory` + delegan en `decideSetCut`/`decideUnsetCut` (núcleo puro), inyectando `runLocalWrite(buildSetCutUpdate/buildUnsetCutUpdate)`. **+`isCut`** en el tipo `AnimalDetail` y en el mapeo de `fetchAnimalDetail` (RCUT.4). ⚠️ colisión: archivo sin commitear de otra terminal. |
| `app/src/services/powersync/local-reads.ts` | `buildAnimalDetailQuery`: **proyectar `is_cut`** en ambas ramas del UNION (synced: `ap.is_cut AS is_cut`; overlay: `0 AS is_cut`). ⚠️ colisión: archivo sin commitear de otra terminal. |
| `app/src/components/CategoryBadge.tsx` | **+prop `code?`**; cuando `isCutCategory({ code, label })` → variante amarilla (`$cutBg`/`$cutText`); a11y intacta. |
| `app/app/animal/[id].tsx` | Afordancia CUT de hembras en la rama "Manejo" (nueva `CutRow`, espejo de `CastrationRow`); cablear `setCut`/`unsetCut`/preview + gate `dientes`; pasar `code={detail.categoryCode}` al `CategoryBadge` del hero; **suprimir la `CategoryOverrideCard` genérica cuando `detail.isCut`** (cambiar la condición de render `categoryOverride ?` → `categoryOverride && !isCut ?`, RCUT.5.7). |
| `app/src/components/AnimalRow.tsx` | Pasar `code={categoryCode}` al `CategoryBadge` (ya tiene `categoryCode` en props). |
| `app/e2e/animals.spec.ts` (o spec nuevo `cut-ficha.spec.ts`) | E2E marcar/quitar CUT + color del badge. ⚠️ la suite engancha en `scripts/run-tests.mjs` (archivo sin commitear de otra terminal). |

## 2. Par de tokens amber (D1, RCUT.6.1/RCUT.6.3)

Se agrega un **par nuevo** (NO se reusa el `$amber` existente — ver alternativa descartada §7). Espejo del par
`$primary` (texto oscuro) / `$greenLight` (fondo pálido) del badge verde.

```
cutText: '#855300',  // amber oscuro — TEXTO del badge CUT (y del ícono/borde de la CutRow)
cutBg:   '#FBE6AE',  // amber pálido — FONDO del badge CUT
```

**Contraste medido (WCAG 2.1, fórmula relativa-luminance):**

| Par | Ratio | Objetivo |
|---|---|---|
| `$cutText` #855300 sobre `$cutBg` #FBE6AE | **5.27:1** | ≥ 4.5:1 ✅ |
| `$cutText` #855300 sobre blanco #FFFFFF | **6.49:1** | ≥ 4.5:1 ✅ |
| (referencia: `$primary` sobre `$greenLight`) | 4.55:1 | — |

El par CUT supera la referencia verde (4.55) en texto-sobre-fondo → más legible, alineado con "el CUT debe
leerse claro/legible" (criticidad 🟡 mixta de la ficha). El fondo `#FBE6AE` se distingue inequívocamente del
`$greenLight` (#93cfac) y lee como amarillo de advertencia/descarte (no verde, no rojo de baja). Se VERIFICA
con la skill `design-review` (captura del badge en la ficha + en la lista) antes del gate de diseño.

Comentario de token (atado a la decisión, ADR-023 §4): `cutText`/`cutBg` documentan que son el par de la
marca de descarte CUT (RCUT.6), espejo del par verde del badge, contraste medido ≥4.5:1.

## 3. Contrato de servicios (`animals.ts`, RCUT.1/RCUT.2)

```ts
/** Marca un animal como CUT (descarte) desde la ficha (RCUT.1). Female-only lo gatea la UI (canMarkCut). */
export async function setCut(profileId: string): Promise<ServiceResult<true>>;
//  1) const { cutCategoryId } = await resolveCutCategory(profileId)  → si !ok, propaga error
//  2) if (cutCategoryId == null) return { ok:false, error:{ kind:'unknown',
//       message:'No se pudo resolver la categoría CUT de este rodeo. Probá de nuevo cuando termine de sincronizar.' } }
//  3) const w = await runLocalWrite(buildSetCutUpdate(profileId, cutCategoryId))  → si !ok, propaga
//  4) return { ok:true, value:true }

/** Quita la marca CUT (corrección, RCUT.2). SÍ resetea is_cut (a diferencia de revertCategoryOverride). */
export async function unsetCut(profileId: string): Promise<ServiceResult<true>>;
//  1) const { derivedCategoryId } = await resolveCutCategory(profileId)  → si !ok, propaga error
//  2) if (derivedCategoryId == null) return { ok:false, error:{ kind:'unknown',
//       message:'No se pudo resolver la categoría a la que volver. Probá de nuevo cuando termine de sincronizar.' } }
//  3) const w = await runLocalWrite(buildUnsetCutUpdate(profileId, derivedCategoryId))  → si !ok, propaga
//  4) return { ok:true, value:true }
```

- Reuso TOTAL de `resolveCutCategory` (ya offline-safe, ya fail-safe a `null` cuando no resuelve) + los dos
  builders. Cero SQL nuevo en `animals.ts`.
- Shape `ServiceResult<true>` idéntico a `setCastrated`/`setFutureBull` → el caller (la `CutRow`) lo adapta a
  `{ ok, error? }` igual que `onSetCastrated`.

> **Reconciliación as-built (núcleo puro, TCUT.7).** La DECISIÓN de cada servicio (¿hay id resuelto? →
> escribir : error es-AR sin escribir) se factorizó en un módulo PURO `cut-service-core.ts`
> (`decideSetCut`/`decideUnsetCut`), que recibe el resolve-result + un `write` inyectado. `setCut`/`unsetCut`
> quedan como wrappers de una línea que resuelven `resolveCutCategory` y delegan, inyectando
> `runLocalWrite(buildSetCutUpdate/buildUnsetCutUpdate)`. Motivo: los servicios value-importan el SDK de
> Supabase/PowerSync → no son importables bajo `node:test`, y `mock.module` exige el flag
> `--experimental-test-module-mocks` que el runner del repo no pasa. El núcleo puro hace el contrato
> testeable con fakes (resuelve+escribe el id correcto / falla sin escribir / propaga el error del write)
> sin tocar el SDK. El **contrato público** (`setCut`/`unsetCut`: `Promise<ServiceResult<true>>`) NO cambia.
> Mismo patrón que `resolveTagLookup` (núcleo puro de `lookupByTag`) / `maniobra-identify.ts`. Los mensajes
> es-AR de §3 viven ahora como constantes en el núcleo (`CUT_RESOLVE_FAIL_MESSAGE`/`UNCUT_RESOLVE_FAIL_MESSAGE`,
> textuales idénticos).
- **Sin observación automática** (a diferencia de `setCastrated`): marcar CUT no genera evento en el timeline
  (consistente con el as-built de la maniobra dientes+CUT, que tampoco encola un evento por el flag).

### Preview de consecuencia (RCUT.5.2)

La consecuencia de marcar CUT es FIJA ("La categoría pasará a **CUT (descarte)**") → NO necesita un
`preview*` que consulte el catálogo (a diferencia de la castración, cuyo destino varía). Se renderiza como
texto literal es-AR en la confirmación. (Opcional/no-MVP: anticipar la derivada al QUITAR CUT — se omite, la
línea de consecuencia del "Quitar CUT" no aporta como en el revert genérico; se deja solo el "¿Quitar la
marca CUT?").

## 4. `AnimalDetail.isCut` (RCUT.4)

- `local-reads.ts` `buildAnimalDetailQuery`: agregar `ap.is_cut AS is_cut` a la rama **synced** (junto a
  `is_castrated`/`future_bull`, mismo lugar) y `0 AS is_cut` a la rama **overlay** (alta optimista nace
  no-CUT; constante para alinear las columnas del UNION ALL).
- `LocalDetailRow`: `+ is_cut?: number | boolean | null`.
- `AnimalDetail`: `+ isCut: boolean`.
- `fetchAnimalDetail`: `isCut: toBool(row.is_cut ?? 0)` (mismo patrón que `isCastrated`/`futureBull`).
- Por qué `is_cut` y no inferir de `categoryCode==='cut'`: el flag es la fuente de verdad denormalizada (un
  CUT con override) y desacopla la elección de afordancia del display de categoría (RCUT.4.2).

## 5. `CategoryBadge` — cambios mínimos (RCUT.6) y los call-sites

### 5.1 Componente

- **+prop opcional `code?: string`** en `CategoryBadgeProps`.
- Detección: `const isCut = isCutCategory({ code, label });` (módulo puro, §6).
- Colores condicionales: `backgroundColor={isCut ? '$cutBg' : '$greenLight'}`; el `<Text>` y el punto de
  override `color={isCut ? '$cutText' : '$primary'}`; el `pressStyle`/borde que hoy usa `$primary`/`$greenLight`
  en otros componentes NO aplica acá (el badge no es pressable). a11y: `a11yLabel` no cambia (sigue
  "Categoría {trimmed}" + ", fijada manualmente" si `manual`) — el color es señal adicional (RCUT.6.4).
- Sin `code`, una categoría llamada literalmente "CUT" igual cae amarilla por el fallback de label
  (RCUT.6.2) → cobertura de los call-sites sin code.

### 5.2 Cómo pasa el `code` cada call-site (6 lógicos / 8 físicos)

| Call-site | ¿Tiene `code`? | Cómo detecta CUT |
|---|---|---|
| `app/app/animal/[id].tsx` (hero) | Sí — `detail.categoryCode` | `code={detail.categoryCode}` (preferido) |
| `app/src/components/AnimalRow.tsx` (lista) | Sí — ya recibe `categoryCode` prop | `code={categoryCode}` (preferido) |
| `app/app/asignar-caravanas.tsx` (×2) | No — el candidato solo trae `categoryName` | fallback por `label === 'CUT'` |
| `app/app/import-rodeo.tsx` | No — solo `categoryLabel` | fallback por `label === 'CUT'` |
| `app/app/maniobra/_components/CandidatePicker.tsx` | No — `candidate.categoryName` | fallback por `label === 'CUT'` |
| `app/app/_components/FindOrCreateOverlay.tsx` (×3) | Parcial — el `detail` del match tiene code; los candidatos solo name | hero del match: `code={detail.categoryCode}`; candidatos: fallback por label |

> El fallback por `label === 'CUT'` es seguro: `name='CUT'` es un valor FIJO del seed del catálogo (0015),
> no texto libre. Solo los call-sites de identidad rica (hero de la ficha, fila de lista) pasan `code` — es
> opcional; el resto no se toca salvo que se quiera la ruta preferida. **Para MVP del delta**: pasar `code`
> en hero + AnimalRow (RCUT.6.5); los demás quedan en fallback (cambio cero en su markup).

## 6. Módulo puro `cut-eligibility.ts` (RCUT.3 / RCUT.6.2)

```ts
export type CutEligibilityInfo = {
  sex: 'male' | 'female' | null;
  status: 'active' | 'sold' | 'dead' | 'transferred';
  categoryCode: string | null;   // 'ternera' | 'cut' | … | null si irresoluble
  isCut: boolean;                 // detail.isCut (fuente de verdad del estado CUT)
};

/** ¿Se ofrece "Marcar como CUT"? (RCUT.3). Conservador con categoryCode null → false. */
export function canMarkCut(a: CutEligibilityInfo): boolean {
  return a.sex === 'female'
    && a.status === 'active'
    && !a.isCut
    && a.categoryCode != null && a.categoryCode !== '' && a.categoryCode !== 'ternera';
}

/** ¿Se ofrece "Quitar CUT"? (RCUT.5.4): hembra activa que YA es CUT. */
export function canUnmarkCut(a: CutEligibilityInfo): boolean {
  return a.sex === 'female' && a.status === 'active' && a.isCut;
}

/** Detección CUT del badge (RCUT.6.2): code preferido, fallback por label fijo 'CUT'. */
export function isCutCategory(args: { code?: string | null; label?: string | null }): boolean {
  if (args.code != null && args.code !== '') return args.code === 'cut';
  return (args.label ?? '').trim().toUpperCase() === 'CUT';
}
```

Nota: el **gate de `dientes`** (RCUT.7) NO va en el predicado puro (necesita I/O del rodeo) — vive en la
ficha como un flag async adicional (§7 del flujo), AND-eado con `canMarkCut`. Así el predicado puro queda
sin red y la ficha compone `canMarkCut(info) && dientesEnabled`.

## 7. Flujo en la ficha + gate de `dientes` (RCUT.5 / RCUT.7)

1. En `AnimalDetailScreen`, tras cargar `detail`, calcular:
   - `canMark = canMarkCut({ sex, status, categoryCode, isCut })`
   - `canUnmark = canUnmarkCut(...)`
   - `dientesEnabled` (async, best-effort): leer el gating del rodeo del animal con
     `fetchRodeoGating(detail.rodeoId)` y tomar `gating.value['dientes']?.enabled === true`.
     **Fail-safe (RCUT.7.3)**: si la lectura falla, no resuelve, o no hay fila `dientes` → `dientesEnabled =
     false` (conservador). Estado inicial `false` hasta que resuelva (no se ofrece marcar a ciegas).
2. Render en la rama de "Manejo":
   - Hoy: `detail.sex === 'male'` → `<ManagementSection …>` (castrado + futuro torito).
   - **Nuevo**: `detail.sex === 'female'` → `<DetailSection icon={…} title="Manejo">` con una `<CutRow>` si
     `canMark && dientesEnabled` (afordancia "Marcar como CUT") **o** `canUnmark` (afordancia "Quitar CUT",
     SIN gate de dientes, RCUT.7.2). Si ninguna aplica, no se renderiza la sección para esa hembra.
   - **Suprimir la card genérica (RCUT.5.7)**: el render existente `{detail.categoryOverride ?
     <CategoryOverrideCard …/> : null}` pasa a `{detail.categoryOverride && !detail.isCut ?
     <CategoryOverrideCard …/> : null}`. Un CUT (override=true + isCut=true) NO ofrece "Quitar fijación"
     (que no resetea `is_cut`); su único desmarcado es "Quitar CUT". Un override NO-CUT (vaca comprada fijada
     manual) la sigue mostrando igual que hoy.
3. `CutRow` = espejo estructural de `CastrationRow` (confirmación inline, optimismo en sitio, error inline,
   `busy`), parametrizada por modo:
   - **mark**: copy "Marcar como CUT (descarte)" + consecuencia literal "La categoría pasará a CUT
     (descarte)." → `onConfirm = () => setCut(profileId)`.
   - **unmark**: copy "Quitar CUT" + pregunta "¿Quitar la marca CUT de este animal?" → `onConfirm = () =>
     unsetCut(profileId)`.
   - Optimismo en sitio (no recarga blanqueando) + refresh silencioso del `detail` (mismo handler que
     `onSetCastrated` ya usa) para que el badge del hero pase a amarillo / vuelva a verde al toque.
4. El ícono lucide de la `CutRow`/sección se lee con `getTokenValue('$cutText','color')` (o `$terracota` si
   se prefiere una señal médica neutra — **default propuesto: `$cutText`** para coherencia con el badge;
   queda a veto de diseño). Cero hardcode.

### Decisión de offline-sync

Marcar/quitar CUT son **escrituras locales planas** sobre `animal_profiles` (CRUD-plano, una CrudEntry cada
una) → offline-first nativo de PowerSync (mismo camino que `setCastrated`/`setFutureBull`). El gating capa 2
(`dientes`, 0054) y la RLS `animal_profiles_update` re-validan **al subir**; un rechazo lo maneja `uploadData`
(descarte + surfacing, R10.8 de spec 03). El gate de cliente (RCUT.7) es PREVENCIÓN (no ofrecer lo que el
server rechazaría), no la barrera de seguridad — esa es la RLS. **Multi-tenant**: nunca se hardcodea
`establishment_id`; el animal trae su establishment vía el perfil y la RLS deriva el acceso.

## 8. RLS / multi-tenancy

No se crean ni modifican policies. La barrera real al subir el UPDATE es la policy existente
`animal_profiles_update` (cualquier rol con `has_role_in` del establishment del perfil). El delta no debilita
el aislamiento multi-tenant: la afordancia solo expone un UPDATE que la RLS ya gobierna; un usuario sin rol
en el campo no puede marcar CUT (el write se rechaza al subir).

## 9. Alternativa descartada

- **Reusar el `$amber` existente (#9A6206)** como par de color del badge. Descartada: (a) `$amber` está
  documentado como semántica "DIFERIDA / espera-pausa" del tacto vaquillona, con uso de **texto blanco
  encima** (5.0:1) — semántica y patrón de uso distintos; (b) #9A6206 sobre un fondo amber pálido da solo
  ~4.0–4.45:1 (< 4.5 objetivo, RCUT.6.3) → no alcanza el contraste pedido. Un par propio (`$cutText`/`$cutBg`)
  da 5.27:1 texto-sobre-fondo y 6.49:1 sobre blanco, y deja `$amber` con su semántica intacta. Costo: 2
  tokens nuevos vs 0 — aceptable y alineado con el espejo `$primary`/`$greenLight` del badge.
- **Inferir CUT del `categoryCode`/`categoryName` en la ficha** (sin exponer `is_cut`). Descartada: un
  `is_cut=1` con categoría no-CUT (estado roto que justamente RCUT.2.3 evita) quedaría mal clasificado, y la
  elección de afordancia debe colgar del flag, no del display (RCUT.4.2).
- **Editor genérico de categoría en la ficha** (elegir cualquier categoría). Fuera de alcance del Gate 0
  (context-cut-ficha.md §Fuera de alcance): esto es SOLO la afordancia CUT.
