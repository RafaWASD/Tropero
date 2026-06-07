# review_12-ui — Feature 12 (Importacion masiva de rodeo), Fase 4 (UI)

Reviewer agent. Fecha 2026-06-07. Alcance: SOLO la capa UI de spec 12 (T4.1-T4.5 + routing).
Backend (Fase 1/2/3) ya revisado y verde. Se revisa adherencia + calidad de la UI vs requirements
[UI TENTATIVA] (R1.3/R1.4, R2.1-R2.4, R4.1/R4.2, R5.3-R5.6, R8.3, R12.2) + design 1.1 + tasks.

## Veredicto: APPROVED (3 notas menores no bloqueantes para el leader).

## Verificacion independiente
- node scripts/check.mjs: VERDE (exit 0). 1er run dio rojo por FLAKE de timeout en la Animal suite
  (remota, 71s sola); re-corrida aislada 47/47 verde y check.mjs completo re-corrido cierra verde.
  NO es regresion de esta feature.
- import-ui.test.ts (via harness ts-ext-resolver): 15/15 verde, asserts reales (no verde-falso).
- Anti-hardcode (check-hardcode.mjs): 0 violaciones en app/app + app/src/components.
- Tokens del screen: todos resuelven en tamagui.config.ts. Suite enganchada en run-tests.mjs L53.

## Trazabilidad R<n> -> verificacion (Fase 4)
- R1.3 4 pasos source/mapping/preview/result + ProgressBar 4 seg.
- R1.4 bloqueo sin rodeo L107-118 -> CTA /crear-rodeo.
- R2.1 effectiveRodeoId -> confirmImport; RPC fuerza rodeo_id (T2.5).
- R2.2 1 rodeo read-only StepSource L330-338. R2.3 RodeoSelector L420-471 (hasMultiple).
- R2.4 gate isFieldOperator L95-104 + RPC a nivel DB (T2.5).
- R4.1 autoDetectMapping (pickFile L335). R4.2 setColumnMapping -> applyMappingOverride.
- R5.3 StepPreview 3 CountColumn + conteos EXACTOS hook L390-397.
- R5.4 buildPreviewItems + rowErrorCopy/intraDuplicateCopy/existingDuplicateCopy (tests).
- R5.5 CTA Importar N L215-225. R5.6 disabled validCount===0 L219 + guard hook L404 + service.
- R8.3 StepResult + writeErrorCopy. R12.2 confirmImport resolveOnline -> offline copy, NO encola.
- SIGSA saltea mapeo: pickFile rama sigsa -> normalizeSigsaRows -> setStep(preview).
- R3.x/R7/R9/R10/R11 (contrato/seguridad): cubiertas por suites Fase 1 (72+14) y Fase 2/3 (25/25).

## Tasks Fase 4 completas: SI (T4.1-T4.5 [x] + routing en _layout L103/108-113/367).
T5.1/T5.2 + T6.1-T6.3 NO son de este run ([ ] JUSTIFICADO en bitacora: entry point/cierre = otro run).

## CHECKPOINTS
C1 [x] (check.mjs exit 0 tras descartar flake). C2 [x]. C3 [x] (capas previstas, sin logs/TODOs,
no hardcodea establishment_id). C4 [x] (import-ui.test.ts 15/15; screen/hook = UI sin suite propia,
patron del repo, logica testeable en import-ui.ts). C6 [x]. C7 [x] (N/A UI; forzado server-side).
C5/C8 N/A a este run.

## Checklist RAFAQ-especifico
### A. Multi-tenancy / RLS — N/A en la UI
La Fase 4 no crea tablas ni policies (viven en Fase 2/3, import suite cross-tenant 25/25 verde). La UI
toma establishment_id del EstablishmentContext (hook L186) y no lo manda al RPC (lo deriva del rodeo).

### B. Offline-first — aplica (R12.2)
- [x] Import online POR DISENO (R12.1; no viola offline-first, es op de oficina/onboarding, design 7).
- [x] Offline al confirmar -> resolveOnline -> copy accionable, NO encola (R12.2).
- N/A PowerSync/conflict-resolution: no entra (R12.1).

### C. BLE — N/A (no toca BLE; reusa isValidTag/normalizeTag como lib pura, sin device).

### D. UI de campo (manga-friendly) — aplica
- [x] Botones minHeight=touchMin (56). NOTA: 56dp es menor a los 60dp del checklist D. Es el estandar
  CANONICO del proyecto (token touchMin=56, justificado en tamagui.config.ts, usado en TODOS los wizards
  committeados: crear-rodeo, crear-animal). NO es regresion de esta feature; subirlo seria tocar el DS
  (requiere ADR, fuera de alcance). Observacion de DS, no cambio requerido a esta feature.
- [x] Fuente: titulos t8, conteos t9, labels t4/t5 (mayor o igual a 18pt). Motivos de error t3 son
  secundarios/informativos, no decision primaria.
- [x] Una decision por pantalla: 4 pasos, un CTA primario por paso.
- [x] Loading visible: CTA cambia copy (Leyendo/Revisando/Importando) y disabled con state.loading.

### E. Edge Functions — N/A (bulk-insert es RPC SQL, cubierto por Fase 2/3; no hay Edge Function nueva).

## Los 3 carry-forwards de seguridad (confirmados independientemente)
1. checkFileSize ANTES de leer/parsear — CONFIRMADO. pickFile L254: corre tras el picker y ANTES de
   readFileText/readFileBytes/parse*; si falla retorna sin leer (L255-258). Tapa el char-flood de 1 celda
   gigante que el cap de filas NO cubre.
2. Ningun error.message/sqlerrm crudo al operador — CONFIRMADO. Todo motivo pasa por copy legible
   (rowErrorCopy/existingDuplicateCopy/intraDuplicateCopy); sqlerrm de escritura (R8.4) -> writeErrorCopy
   (test L128-139: NO filtra animals_tag_unique/constraint/does-not-exist); errores de service ->
   mapErrorToCopy. El screen solo muestra state.error via FormError ya mapeado.
3. field_operator NO ve el wizard — CONFIRMADO. import-rodeo.tsx L95-104: role===field_operator ->
   BlockShell (Solo el dueno o el veterinario pueden importar) ANTES de cualquier paso. RPC re-bloquea (T2.5).

## Notas para el leader (no bloqueantes)
1. BITACORA INCOMPLETA — progress/impl_12-ui.md quedo con la seccion Progreso VACIA (timeout antes del
   mensaje final + autorrevision del implementer). El leader debe completarla al cerrar (mapa R->archivo:test,
   orden del size-check, nota del flake de check.mjs).
2. Import muerto useMemo — import-rodeo.tsx L27 importa useMemo sin usarlo (typecheck no lo flagea: sin
   noUnusedLocals; sin ESLint pinneado). Nit de 1 linea.
3. CategoryBadge del preview nunca se ve — PreviewRow L748-750 lo renderiza si item.categoryLabel, pero el
   hook NUNCA pasa categoryLabelByIndex a buildPreviewItems, asi que categoryLabel siempre es null. Coherente
   con el diseno (la categoria la resuelve el RPC server-side, el cliente solo manda category_code, T3.2),
   pero queda UI muerta + pequena perdida de UX. Quitar el branch o resolver el label client-side. No bloquea.

### Nota de diseno/UX (positiva)
El wizard IGUALA el esqueleto de crear-rodeo.tsx (ProgressBar progressTrack, header back+titulo, footer fijo
borderTop + paddingBottom insets.bottom+12 + bg, Button full-width, validacion antes de avanzar, reuso de
Button/Card/CategoryBadge/FormError/InfoNote). Jerarquia del preview correcta (3 conteos grandes con tono
semantico). Copy en voseo, accionable. Cap visual de preview (50) y resultado (50) evita renderizar miles.
