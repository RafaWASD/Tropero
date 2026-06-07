# Context C3.3 — Baja / egreso de animal desde la ficha (Gate 0)

> Chunk del **frontend de spec 02** (C3.3). Aterriza la UX de `R4.14` / `R4.15` / `R14.9`, que
> estaban marcadas TENTATIVAS "hasta cerrar el design system" — ya cerrado (A.1 done, sesión 20).
> El backend ya está 100% implementado y gateado: RPC `exit_animal_profile` (migration `0044`),
> Gate 1 PASS (SEC-SPEC-01). Este chunk es **frontend + un servicio** que llama ese RPC.
>
> **Gate 0 cerrado**: 2026-06-07 (decisiones de Raf vía AskUserQuestion + UX resuelta por el leader).
> **Gate 1 (security modo spec) NO aplica**: no toca schema/RLS/Edge nuevos (mismo caso que el
> frontend de spec 01). **Gate 2 (code) SÍ aplica** (el servicio de baja es authz-sensitive).

## Alcance

Dos mitades, ambas en la ficha (`app/app/animal/[id].tsx`) + el servicio (`app/src/services/animals.ts`):

1. **Acción de baja** — botón en la ficha → sheet de confirmación con motivo + fecha (+ datos de
   venta) → llama `exit_animal_profile`.
2. **Modo archivada de la ficha** — si el animal ya está de baja (`status ≠ active`), mostrar su
   estado y ocultar las acciones de mutación. Hoy la ficha **no distingue** un animal archivado del
   activo (el hero solo muestra el `status` de la madre, no el propio).

## Decisiones del Gate 0

### Decididas por Raf (producto/dominio)

- **D1 — 3 motivos de baja** (no los 6 del enum). `Venta / Muerte / Transferencia`, que mapean
  1:1 a `status` + `exit_reason`. Sin ambigüedad, una decisión por pantalla (campo-friendly).
  Razón de descartar los 6: `culling/theft/other` no mapean limpio a `sold/dead/transferred` —
  su semántica de reporte se valida con Facundo más adelante (el enum ya los soporta; agregarlos
  después es un cambio de UI, sin migración).
- **D2 — peso + precio de salida opcionales SOLO en Venta**. Alimenta analytics (precio/kg,
  ganancia de peso — pilar de RAFAQ). Ocultos en Muerte/Transferencia. Opcionales = sin fricción.

### Mapeo motivo → (status, exit_reason)

| Motivo (UI)     | `status`      | `exit_reason` | Campos extra        |
|-----------------|---------------|---------------|---------------------|
| Venta           | `sold`        | `sale`        | peso + precio (opc) |
| Muerte          | `dead`        | `death`       | —                   |
| Transferencia   | `transferred` | `transfer`    | —                   |

> Nota: la "Transferencia" de este sheet es la **baja simple** por egreso (el animal se fue del
> campo). NO es la transferencia con re-parenting de historia entre campos del mismo usuario —
> eso es la **feature 11** (`11-transferencia-animal`), aparte. Acá `transferred` es solo el
> estado de egreso, sin crear perfil en otro campo.

### Resueltas por el leader (UX, criterio de diseño)

- **Ubicación**: botón discreto **al fondo** de la ficha (terracota, outline), no un primario que
  compita con "Agregar evento". La baja es destructiva e infrecuente → la fricción de scrollear
  protege contra toques accidentales (Fitts inverso a propósito).
- **Patrón**: sheet/modal de confirmación liviano (lenguaje consistente con el resto del frontend
  de campo), no una pantalla pesada. Paso 1 = elegir motivo (3 opciones grandes); paso 2 = fecha
  (default hoy) + datos de venta si aplica + botón destructivo "Dar de baja". El implementer elige
  el componente más consistente con lo existente (Sheet de Tamagui o pantalla corta); el leader lo
  vetea contra `design-review` antes de mostrárselo a Raf.
- **No reversible desde la UI** en MVP (el RPC no tiene "reactivar"; consistente con la spec). Por
  eso la confirmación debe ser clara (resumen del animal + acción destructiva explícita). Revertir
  un error queda como operación manual (SQL) en MVP — documentado, no es caso de uso de campo.
- **Permisos (gating del botón)**: solo aparece si `status === 'active'` Y el usuario es **owner**
  del campo del animal **o** lo cargó (`created_by === userId`). Espejo del authz que el RPC ya
  enforça server-side (`has_role_in(est) AND (is_owner_of(est) OR created_by = auth.uid())`). El
  gating de cliente es best-effort (la barrera real es el RPC); cuando el animal pertenece al campo
  activo (caso ~99%) se usa `estState.role`; si el `establishmentId` del animal ≠ activo, ser
  conservador (mostrar solo por `created_by`). El RPC rechaza con `42501` → copy accionable.
- **Modo archivada (mínimo MVP)**: badge de estado en el hero ("Vendido el {exit_date}" /
  "Muerto el …" / "Transferido el …", según `status`+`exit_reason`+`exit_date`) + ocultar "Dar de
  baja" (ya está de baja) + ocultar "Agregar evento" (un animal archivado no recibe eventos nuevos
  en MVP). El resto de la ficha se muestra read-only igual. NO es un rediseño completo de la ficha.
- **Post-éxito**: refrescar el detalle (la ficha pasa a modo archivada in-situ) + feedback de
  confirmación. El animal desaparece de la lista de la tab Animales (que ya filtra `status='active'`).
- **Online-only** con guard de conexión (igual que el resto del frontend de campo; el offline real
  es PowerSync/C5). Sin red → error claro (`kind:'network'`).

## Edge cases

- **Animal ya archivado**: abrir su ficha NO ofrece baja; muestra el badge de estado. (cubierto por
  el gating `status === 'active'`).
- **Madre/toro dado de baja**: ya cubierto por `R4.15` + el `archivedLabel` existente en la ficha
  (la card "Madre" tolera `status ≠ active`). Este chunk no lo cambia, solo agrega el badge propio.
- **Field operator que no cargó el animal**: no ve el botón (gating); si forzara el RPC, `42501`.
- **Sin conexión**: el sheet muestra error de red y NO marca la baja (el RPC no llegó a correr).
- **Doble tap / reintento**: el botón se deshabilita mientras la baja está en vuelo (un solo write).

## Fuera de alcance (este chunk)

- Los 3 motivos extra (`culling/theft/other`) — pendientes de semántica de reporte con Facundo.
- Reactivar/deshacer una baja desde la UI.
- Transferencia con re-parenting de historia (feature 11).
- Rediseño completo de la "ficha archivada" más allá del badge + ocultar acciones.
- Offline (PowerSync = C5).
- Baja masiva por rodeo/lote (feature 10).

## Artefactos a tocar

- `app/src/services/animals.ts` — nuevo `exitAnimalProfile(...)` (ServiceResult, `supabase.rpc`);
  agregar `createdBy`, `exitDate`, `exitReason` al `fetchAnimalDetail` SELECT + al type `AnimalDetail`.
- `app/app/animal/[id].tsx` — botón de baja (gated) + sheet + modo archivada (badge + ocultar acciones).
- Componente de sheet/confirmación (reusar lo que exista; cero hardcode, tokens — ADR-023 §4).
- Tests: unit del servicio (mapeo de errores RPC `42501/23503/network`) + función pura del mapeo
  motivo→(status,exit_reason) + extender la suite E2E Playwright (dar de baja → sale de la lista activa).
- Reconciliar `requirements.md` (R14.9) + `design.md` + `tasks.md` al as-built (regla: spec no
  contradictoria con el código).
