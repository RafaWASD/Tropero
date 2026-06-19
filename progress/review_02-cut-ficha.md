# Review -- Marcar CUT (descarte) desde la ficha + indicador amarillo (delta spec 02)

**Reviewer**: reviewer (Opus 4.8)
**Fecha**: 2026-06-18
**Baseline**: a03e593406da77096a239f7d54eb262ec1f9098f
**Scope**: SOLO el delta CUT-ficha (archivos listados por el leader). El resto del working tree
(spec 03/08, sin commitear, otra terminal) NO se revisa ni se reporta.

## Veredicto: APPROVED

Implementacion correcta, trazable y consistente con las specs (RCUT.1-RCUT.8). Los 4 puntos
criticos de atencion del leader estan bien resueltos. Unit nuevos verdes (141), hardcode 0.

---

## Trazabilidad R<n> -> test

| RCUT | Test concreto | Estado |
|---|---|---|
| RCUT.1.1 | cut-service-core.test.ts:22 (resuelve cutCategoryId => escribe ESE id, ok) | OK |
| RCUT.1.2 | cut-service-core.test.ts:33 (cutCategoryId null => error es-AR SIN escribir) | OK |
| RCUT.1.3 | cut-service-core.test.ts:60 (write falla => propaga) + local-reads.test.ts:1695 (builder) | OK |
| RCUT.1.4 | contrato ServiceResult<true> (animals.ts:1242); CoreResult estructuralmente compatible (typecheck) | OK |
| RCUT.2.1 | cut-service-core.test.ts:71 (escribe la DERIVADA) + local-reads.test.ts:1701 (builder) | OK |
| RCUT.2.2 | cut-service-core.test.ts:82 (derivedCategoryId null => error es-AR SIN escribir) | OK |
| RCUT.2.3 | cut-service-core.test.ts:118 (SET cutId / UNSET derivedId, distintos) + animals.ts:1258 usa buildUnsetCutUpdate (NO revert) | OK |
| RCUT.3.1 | cut-eligibility.test.ts:23,36,40 (hembra!=ternera true / ternera false / ya-CUT false) | OK |
| RCUT.3.2 | cut-eligibility.test.ts:31 (macho/null => false) | OK |
| RCUT.3.3 | cut-eligibility.test.ts:51 (categoryCode null/'' => conservador false) | OK |
| RCUT.4.1 | local-reads.test.ts:773 (ap.is_cut synced) + :774 (0 overlay) + animals.ts:938 mapeo toBool | OK |
| RCUT.4.2 | [id].tsx:432-438 usa detail.isCut (no infiere de categoryCode) -- revision | OK |
| RCUT.5.1/5.2/5.3 | cut-ficha.spec.ts:91-100 (confirmacion inline + consecuencia literal + marcar) | OK |
| RCUT.5.4 | cut-eligibility.test.ts:58 (canUnmarkCut) + cut-ficha.spec.ts:106 (afordancia Quitar CUT) | OK |
| RCUT.5.5 | [id].tsx:684 render rama hembras sin tocar machos (668-679) -- revision | OK |
| RCUT.5.6 | cut-eligibility.test.ts:44,72 (archivada => canMark/canUnmark false) | OK |
| RCUT.5.7 | [id].tsx:638 (categoryOverride && !detail.isCut) + cut-ficha.spec.ts:87,102-103 | OK |
| RCUT.6.1 | cut-ficha.spec.ts:100 (badge fondo cutBg rgb(251,230,174)) + CategoryBadge.tsx:51 | OK |
| RCUT.6.2 | cut-eligibility.test.ts:100-122 (isCutCategory por code / fallback label) | OK |
| RCUT.6.3 | contraste medido (node, design 2 + token comment: 5.27:1 / 6.49:1, ref 4.55) | OK |
| RCUT.6.4 | CategoryBadge.tsx:47 a11yLabel intacto (color es senal adicional) -- revision | OK |
| RCUT.6.5 | CategoryBadge.tsx:51,65 (verde no-CUT) + 6 call-sites markup intacto -- revision | OK |
| RCUT.7.1 | [id].tsx:436 (canMark ANDea dientesEnabled) + :176 fetchRodeoGating de rodeo-config | OK |
| RCUT.7.2 | [id].tsx:438 (canUnmark sin gate) + cut-eligibility.test.ts:66 | OK |
| RCUT.7.3 | [id].tsx:175-181 fail-safe false (inicial false, solo hembras) -- revision + e2e | OK |
| RCUT.8.1 | check-hardcode 0 violaciones + voseo + a11y helpers -- revision | OK |
| RCUT.8.2 | write local plano (animals.ts:1245/1261) sin red -- revision | OK |

Cada RCUT tiene >=1 test concreto. Sin huecos de cobertura.

## Puntos de atencion del leader (cuestionados)

1. RCUT.5.7 (CRITICO) -- RESUELTO. [id].tsx:638 = `detail.categoryOverride && !detail.isCut`. Un CUT
   no ofrece CategoryOverrideCard; un override no-CUT si. e2e asierta explicito (87, 102-103).
2. Gate dientes -- RESUELTO. Importa fetchRodeoGating de @/services/rodeo-config (58), no el privado de
   group-data.ts. Lee g.value['dientes']?.enabled === true. Fail-safe false (sin fila / falla / macho).
3. unsetCut vs revert -- RESUELTO. animals.ts:1258 usa buildUnsetCutUpdate (is_cut=0), nunca revert. Test 118.
4. canMarkCut puro -- RESUELTO. female+active+!isCut+categoryCode no en {null,'',ternera}. Conservador. Exclusion mutua exhaustiva (test 82).
5. Badge amarillo -- RESUELTO. isCutCategory (code='cut' o label 'CUT'). a11y intacta. No-CUT verdes en 6 call-sites.
6. cut-service-core.ts -- JUSTIFICADA Y RECONCILIADA. Contrato publico intacto. Cubre RCUT.1/2 con fakes.
   Reconciliado en design 1+3 y tasks TCUT.7. CoreError y AppError comparten kinds -> asignable.
7. Offline -- RESUELTO. 1 write local plano (una CrudEntry); RLS + gating 0054 son la barrera AL SUBIR.

## Tasks completas: si

TCUT.1-TCUT.15 en [x], verificadas contra el codigo. TCUT.16 (veto diseno) y TCUT.17 (cierre: check.mjs
+ reviewer + Gate 2) son del leader y quedan [ ] CON justificacion explicita en tasks.md -- no son tareas
del implementer, no bloquean la aprobacion del slice.

## CHECKPOINTS

- C3 codigo respeta arquitectura: [x] capas previstas; [x] sin deps nuevas; [x] sin logs/TODOs sueltos; [x] sin hardcode establishment_id.
- C4 verificacion real: [x] >=1 test por modulo; [x] fixtures reales (e2e siembra; unit con fakes); [x] runner 141 verdes; RLS N/A.
- C6 SDD: [x] specs + context; [x] EARS (WHEN/IF/THEN/SSI); [x] tasks [x] del implementer; [x] cada R<n> con test.
- C7 multi-tenant: N/A (sin tabla/RLS nueva); barrera = RLS animal_profiles_update existente AL SUBIR; sin hardcode.
- C8 offline-first: [x] funciona sin conexion (write local plano); [x] bucket animal_profiles ya sincronizado; [x] last-write-wins implicito del CRUD-plano.
- C1/C2/C5: fuera del scope del delta (cierre de sesion -- leader en TCUT.17).

## Checklist RAFAQ-especifico

- A. Tablas con establishment_id (RLS): N/A -- frontend puro, sin schema/RLS/Edge (Gate 1 N/A).
- B. Offline-first: APLICA.
  - [x] Funciona offline (1 write local plano, sin red).
  - [x] Bucket correcto (animal_profiles, mismo camino que setCastrated).
  - [x] Conflict resolution: last-write-wins implicito CRUD-plano (design 7).
  - [x] No hace requests sincronos a Supabase desde la pantalla (usa runLocalWrite local).
- C. BLE: N/A.
- D. UI de campo: APLICA.
  - [x] Botones >= 60dp: CutRow minHeight=$touchMin; Confirmar/Cancelar fullWidth.
  - [x] Fuente legible: actionLabel $5 (>=18pt), pregunta $4; lineHeight matcheado (descendentes g/j).
  - [x] Una decision por pantalla (confirmacion inline, no formulario).
  - [x] Loading visible: busy -> "Guardando..." en Confirmar.
- E. Edge Functions: N/A.

## Reconciliacion specs <-> codigo (paso 6)

design (1 tabla + 3 nota as-built) y tasks (TCUT.7) reflejan el nucleo puro cut-service-core.ts.
requirements.md no se toco (el que -- contrato/comportamiento/mensajes es-AR -- es identico; solo cambio
el como = factoring, nivel design). El design NO quedo mintiendo. APROBADO en este eje.

## Observaciones menores (NO bloqueantes)

- onUnsetCut ([id].tsx:473) optimiza isCut:false/override:false pero deja categoryCode='cut'/name='CUT'
  hasta el refresh. Como el badge detecta CUT por code==='cut' (no por isCut), el hero sigue amarillo ~1
  frame hasta load({silent:true}). El comentario linea 472 ("sale de amarillo al quitar isCut") es
  impreciso (sale al refresh). Flash transitorio sub-perceptible; e2e lo maneja con timeout (linea 116).
  Severidad: cosmetica. No requiere cambio.

## Cambios requeridos

Ninguno. APPROVED.
