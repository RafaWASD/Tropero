# Review — spec 02 C4 (Lotes / frontend de management_groups)

**Fecha**: 2026-06-07
**Revisor**: reviewer (agente)
**Fuente de verdad**: `specs/active/02-modelo-animal/context-c4-lotes.md` (Gate 0 aprobado por Raf, D1 corregida a RPC), `progress/impl_02-c4-lotes.md`, ADR-020, CHECKPOINTS.md, docs/{architecture,conventions}.md.

## Veredicto: APPROVED

Frontend puro (backend 0037 + RPC 0041 ya desplegados; Gate 1 N/A). Todo verificado, nada asumido.

---

## Trazabilidad R<n> ↔ test

- **R2.14** (modelar/gestionar `management_groups`: crear/renombrar/borrar owner-only)
  ↔ unit `app/src/utils/management-group.test.ts:51` (`canManageGroups: solo owner`) + e2e `app/e2e/lotes.spec.ts:55` (crea lote vía UI) + backend `T2.17` (RLS owner-only, ya gateado en 0037).
- **R2.16** (regla de display "lote si tiene / si no categoría")
  → SUSTRATO expuesto (`AnimalDetail.managementGroupName`, `fetchGroupMembers`); el agrupamiento global de display es spec 10 (scope narrowing documentado en context-c4-lotes y tasks.md:518). N/A para C4 como feature visible — correcto.
- **R2.17** (crear/editar/soft-delete owner; asignar cualquier rol)
  ↔ unit `management-group.test.ts:58` (`canAssignGroup: cualquier rol operativo`) + `:51` (gestión owner-only) + e2e `lotes.spec.ts:92-98` (asigna desde la ficha y verifica efecto) + e2e `:111` (borra → reasigna a NULL).
- **R14.8** (asignar/cambiar/quitar lote desde la ficha)
  ↔ e2e `lotes.spec.ts:89-98` (selector "Sin lote" → asigna → "Lote actual" + trigger "Cambiar lote") + `:145-150` (vuelve a "Sin lote" tras borrado).
- **D1** (borrar con reasignación a NULL, orden anti-FK)
  ↔ e2e `lotes.spec.ts:111` — assertea EFECTO real: lote desaparece de la lista (count 0) Y animal vuelve a "Sin lote".
- **D3** (ver-miembros)
  ↔ e2e `lotes.spec.ts:100-104` — el AnimalRow del idv sembrado aparece dentro del acordeón.

Validación pura de nombre (espeja CHECK `length(trim(name))>0` + tope 80): `management-group.test.ts:14-49` (6 casos: normal/trim, vacío, solo-espacios, límite exacto, pasado límite, trim-antes-de-medir).

**Tests ejecutados por el revisor:**
- `node scripts/check.mjs` → VERDE (typecheck 0 err; 628 unit pass / 0 fail; anti-hardcode 0 violaciones; backend RLS/Edge/Import verdes).
- `pnpm e2e:build` + `npx playwright test e2e/lotes.spec.ts` → **2 passed (18.6s)**, ambos contra el export estático de prod + Supabase remoto.

## Tasks completas: SÍ
- T3.7 `[x]` (servicio management-groups.ts: create/rename/softDelete-vía-RPC + assign/clear + fetchGroupMembers; scope C4 documentado, groupAnimalsForDisplay a spec 10).
- T4.2 selector de lote `[x]` (LoteControl en animal/[id].tsx).
- T4.5 `[x]` (LotesScreen + ruta /lotes + D1/D2/D3).
- Sin tasks `[ ]` de C4 pendientes. El resto de tasks `[ ]` de spec 02 son de otros chunks (C5/PowerSync, etc.) — fuera de alcance, justificadas.

## CHECKPOINTS
- C3 (arquitectura): `[x]` — capas respetadas (screens→services, sin fetch directo en JSX); sin hardcode de establishment_id; sin logs/TODOs sueltos.
- C4 (verificación real): `[x]` — unit por lógica pura + e2e con fixtures reales (no mocks de I/O); runner > 0 tests, todos verdes.
- C6 (SDD): `[x]` — cada R<n> de C4 con ≥1 test; tasks C4 en `[x]`.
- C7 (multi-tenant): `[x]` — scoping por RLS verificado (animal_profiles_update = has_role_in, 0022:13); cross-tenant cubierto por T2.17 (backend) + clear-NULL seguro por RLS.
- C8 (offline-first): `[ ]` aplicable pero JUSTIFICADO N/A — C4 es online-first detrás de services swappables (mismo patrón C1-C3); PowerSync es C5 (documentado en context-c4-lotes "Fuera").

## Checklist RAFAQ-específico
### A. Multi-tenancy / RLS — N/A nuevo schema (backend 0037/0041 ya gateado). Verificado igual:
- [x] El frontend SIEMPRE filtra por el establishment correcto: LotesScreen lee `EstablishmentContext` (campo activo); la ficha lee `detail.establishmentId` (campo del PERFIL, no el activo — mismo cuidado que canExit).
- [x] NUNCA se hardcodea establishment_id.
- [x] UI no ofrece lo que RLS prohíbe: `canManageGroups` (owner) gatea crear/renombrar/borrar; `canAssignGroup` (cualquier rol) gatea asignar.
- [x] `deleted_at IS NULL` filtrado en lecturas (fetchManagementGroups + el join `management_groups ( name )` left).

### B. Offline-first — N/A (C5). Documentado.

### C. BLE — N/A.

### D. UI de campo — aplicable (ficha + lotes):
- [x] Targets: triggers/options usan `$touchMin`/`$chipMin` (tokens manga-friendly).
- [x] Confirmación destructiva con copy D1 ("sus N animales quedan sin lote").
- [x] Estados de loading visibles ("Cargando lotes…", "Creando…", "Eliminando…").
- [x] a11y por helper (buttonA11y/labelA11y) — NUNCA accessibilityLabel crudo en Pressable/View de Tamagui que filtre al DOM. (mas.tsx ActionRow usa accessibilityLabel en Pressable de RN, que SÍ mapea a aria-label — correcto, no es View de Tamagui.)

### E. Edge Functions — N/A.

## Checklist específico del brief
1. **D1**: orden correcto — clear-NULL (UPDATE directo de animal_profiles, sin filtro status → cero FK colgante) PRIMERO (mgmt-groups.ts:206-210), RPC `soft_delete_management_group({p_group_id})` DESPUÉS (:215-217). Nombre/param exactos vs 0041:50-65. Error 42501/P0002 → `classifyDeleteError` (:56-68) mapea a copy es-AR; nunca el sqlerrm crudo. Estado recuperable si el RPC falla (clear idempotente, lote vivo). ✔
2. **D2/D3**: entry point junto a Rodeos (rodeos.tsx:216 "Otros grupos del campo" + mas.tsx:801 ActionRow). Ver-miembros reusa `AnimalRow` de C2 (lotes.tsx:589), no redefine. ✔
3. **Multi-tenant**: scoping correcto, sin hardcode, UI honesta vs RLS. ✔
4. **Anti-hardcode**: 0 color/spacing literal en lotes.tsx / [id].tsx (grep + check.mjs); getTokenValue para íconos lucide (cruce a API no-Tamagui). ✔
5. **a11y**: switchA11y/buttonA11y/labelA11y; fix de triggerLabel dinámico (aria-label == texto visible) verificado en autorrevisión + e2e. ✔
6. **RLS-on-RETURNING**: 0 `.insert().select()`/`.update().select()` (create diffea before/after; rename/assign usan count:'exact' sin select). ✔
7. **Scope discipline**: NO se metió vista rodeo-céntrica / agrupamiento en Inicio / aviso "N sin lote" (spec 10); NO se tocó backend (RPC pre-existente). ✔
8. **Tests**: unit cubren lógica pura (validación + gating); e2e cubre crear→asignar→ver-miembros→borrar y assertea EFECTO real. ✔
9. **check.mjs**: VERDE (corrido por el revisor). ✔

## Observaciones menores (NO bloqueantes, no requieren acción)
- Copy D1 cuenta solo miembros ACTIVOS (N); un archivado que apuntaba al lote no se cuenta pero SÍ se limpia su FK (correcto). Ya anotado por el implementer; aceptable.
- Discrepancia de numeración 0036 (tasks.md) vs 0037 (disco as-built) de la migración de management_groups — documentada en current.md; no afecta C4 (frontend).
- `fetchGroupMembers` filtra client-side por management_group_id sobre fetchAnimals (límite 200). Aceptable para rodeos de cientos; refinamiento server-side posterior si hiciera falta. Documentado en el JSDoc.
