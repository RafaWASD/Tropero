# Review — Feature 12 (Importación masiva de rodeo) — delta FINAL de UI

**Reviewer**: reviewer agent. **Fecha**: 2026-06-06 (sesión 23+).
**Alcance**: delta del run consolidado FINAL — 3 nits del wizard (ya APROBADO en run previo) + entry point (Fase 5, T5.1/T5.2). NO se re-revisa el wizard core (reviewer + Gate 2 PASS previo).

## Veredicto: APPROVED

---

## Trazabilidad R<n> ↔ test (delta)

| R<n> | Dónde (delta) | Test concreto |
|---|---|---|
| **R1.1** — entry point Rodeos, re-ejecutable | `app/app/rodeos.tsx` L182-205 (CTA owner/vet → `router.push('/import-rodeo')`, solo con ≥1 rodeo) | `import.run.cjs` T2.4/T2.5 (rol server-side); screen-level UI |
| **R1.2** — oferta onboarding tras 1er rodeo | `app/app/crear-rodeo.tsx` L202-227 (`OnboardingImportOffer` en success path del bloqueo total; CTA primario→import, secundario→tabs; oferta NO obligatoria) | screen-level UI |
| **R2.4** — owner/vet only; field_operator NO | `rodeos.tsx` `canImport` L47-49 (owner OR veterinarian) + `import-rodeo.tsx` gate L95-104 (BlockShell si field_operator) | `import.run.cjs` T2.4 "field_operator NO puede insertar"; T2.5 "field_operator → RECHAZADO (raise adentro del RPC)" — defensa en profundidad UI+DB |
| **R10.3 client-side** (badge "lo que dice tu archivo") | `import-ui.ts` `buildCategoryLabelByIndex` L267-280 + wire en `buildPreviewItems` → `import-rodeo.tsx` PreviewRow L748-750 (`CategoryBadge`) | `import-ui.test.ts` L191-247 (5 tests nuevos) |

> El contrato/seguridad pesado (R3.x límites, R7 dedup, R9 campos forzados, R10 escritura, R11 audit) lo cubren las suites de Fase 1 (utils), Fase 2 backend (`import.run.cjs` 25) y Fase 3 service (`import-write.test.ts` 32) — verde. La delta es UI sobre esa base, sin contrato nuevo.

## Tasks completas: SÍ (de la delta)
- T5.1 `[x]` — CTA en `rodeos.tsx` (verificado). T5.2 `[x]` — onboarding en `crear-rodeo.tsx` (verificado).
- Pendientes de la spec (NO de esta delta): T0.1 y T6.1/T6.2/T6.3 en `[ ]` con justificación documentada en tasks.md (T0.1 = Puerta 1 ya resuelta por Raf; T6.1 ya hecho/enganchado; T6.2 verde; T6.3 = autorrevisión hecha). No bloquean este run de entry point.

## CHECKPOINTS (aplicables a esta delta de UI)
- C1 `[x]` check.mjs exit 0.
- C2 `[x]` una feature in_progress (12); estado coherente.
- C3 `[x]` capas previstas (screens/hooks/utils); sin dep externa nueva injustificada (la delta no toca package.json salvo lo de xlsx del run previo); 0 hardcode; sin `establishment_id` hardcodeado (deriva del contexto).
- C4 `[x]` test por módulo con lógica (import-ui 20 tests); runner >0 verde; cross-tenant cubierto por import.run.cjs.
- C6 `[x]` 3 archivos de spec; EARS; R<n> de la delta con ≥1 test.
- C7 `[x]` el RPC re-valida `has_role_in` owner/vet; test cross-tenant (estA vs estB) verde en import.run.cjs T2.5.
- C8 `[~]` N/A para el import por diseño (online, op de oficina — R12.1/R12.2, documentado en design §280); no es carga de campo.
- C5 `[ ]` no aplica al reviewer de la delta (cierre de sesión = leader).

## Checklist RAFAQ-específico

### A. Multi-tenancy / RLS — APLICA (entry point gatea sobre rol)
- [x] El CTA de import en Rodeos y el wizard re-validan rol owner/vet; el RPC `SECURITY DEFINER` re-valida `has_role_in()` server-side.
- [x] Test cross-tenant: `import.run.cjs` T2.5 (caller con rol solo en otro est → RECHAZADO; p_rodeo_id de otro est → RECHAZADO). Verde.
- [x] field_operator bloqueado en UI (rodeos.tsx + wizard) Y en DB (RPC). Sin leak de UX.

### D. UI de campo — APLICA (entry point + badge)
- [x] Targets ≥ `$touchMin` (fila de acción import L191 `minHeight="$touchMin"`; cards de fuente; selectores).
- [x] Fuente legible (labels `$5`/`$6`/`$8`; conteos `$9`).
- [x] Una decisión por pantalla (wizard 4 pasos; oferta onboarding 2 CTAs claros).
- [x] Loading visible (`state.loading` → "Leyendo archivo…"/"Revisando…"/"Importando…").

### B/C/E — N/A
- B (offline-first carga de campo): N/A — el import es online por diseño (op de oficina, R12.1/R12.2, design §280).
- C (BLE): N/A — la delta no toca BLE.
- E (Edge Functions): N/A — la delta es UI; el RPC es de Fase 2 (ya revisado).

## Checklist específico del brief
- **Owner/vet gate (R2.4)**: ✅ SÓLIDO. `canImport = role==='owner' || role==='veterinarian'` (rodeos.tsx L47-49) excluye field_operator (tipo `UserRole = 'owner'|'field_operator'|'veterinarian'`, types/index.ts:1). Mismo patrón de lectura de `estState.role` que `isOwner` en la misma pantalla. Defensa en profundidad sobre el RPC (bloqueo server-side verde en tests). Sin leak de UX: si field_operator llegara a la ruta directo, el wizard rebota a BlockShell (import-rodeo.tsx L95-104).
- **CategoryBadge**: ✅ muestra `row.category` (texto crudo del archivo, NO la categoría resuelta por RPC — no duplica R10.3 server-side); null→sin badge (guard PreviewRow L748 `item.status==='valid' && item.categoryLabel` + null-guard en CategoryBadge L31-32); capeado a `CATEGORY_BADGE_MAX=32` + `numberOfLines={1}` (no rompe layout). Los 5 tests asertan reject real (no-válida NO entra, SIGSA mapa vacío), valor exacto trimmeado ("Torito"/"Vaquillona"), y el cap.
- **No reimplementa**: ✅ entry point cablado SOBRE rodeos.tsx/crear-rodeo.tsx sin duplicar pantallas/navegación. `_layout.tsx` ya tenía la ruta `import-rodeo` registrada + en `RODEO_DESTINATIONS` (del run 1 de UI; la delta de entry point NO lo tocó — confirmado por git diff).
- **Nit 1 (import muerto useMemo)**: ✅ RESUELTO — `import-rodeo.tsx` L27 importa solo `useState` de react (el `useMemo` vive en el hook, que sí lo usa).
- **Regresión**: ✅ rodeos.tsx (lista + crear + editar plantilla + eliminar) y crear-rodeo.tsx (3 pasos + bloqueo total) siguen funcionando para sus flujos originales; la oferta de onboarding solo aparece en el 1er rodeo (`isBlockingEmptyState`), el alta de 2do rodeo mantiene `replace('/rodeos')`.
- **Cero hardcode**: ✅ lint 0 violaciones; lucide `Upload size={20} color={primary}` con `getTokenValue('$primary','color')`; spacing/borde por tokens.

## Verificación
- `node scripts/check.mjs` — VERDE end-to-end.
  - client unit tests: **562/562** (incluye import-ui 20 tests, +5 del badge).
  - Anti-hardcode (ADR-023 §4): **0 violaciones**.
  - Animal suite: **47/47** (sin flake este run).
  - Import suite (spec 12): **25/25**.
- `git diff HEAD -- app/app/_layout.tsx`: solo registro de ruta `import-rodeo` + RODEO_DESTINATIONS (del run 1, no de la delta).

## Observación menor (NO bloqueante)
El implementer pidió reconciliar en requirements.md/design.md que (a) el CTA de import en Rodeos es una **fila de acción icono+texto** (el `Button` canónico es solo-texto, no soporta `icon`) y (b) la oferta de onboarding (R1.2) vive en `crear-rodeo.tsx` como `OnboardingImportOffer`, no en `onboarding.tsx`.

→ **NO hay contradicción spec↔código**: design L33 dice "CTA 'Importar rodeo'" + "flag de onboarding" sin prescribir Button-vs-fila ni el archivo concreto; las tasks.md T5.1/T5.2 ya documentan el as-built completo (fila icono+texto + OnboardingImportOffer en crear-rodeo.tsx). La nota en design/requirements es un nice-to-have de prolijidad, no un arreglo de contradicción. Lo deja el leader al reconciliar antes de cerrar (regla "correcciones en specs"). No bloquea el APPROVED.

## Cambios requeridos
Ninguno.
