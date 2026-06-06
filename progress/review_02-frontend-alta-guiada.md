# Review — Frontend spec 02 alta guiada (sub-chunks A + B juntos)

Reviewer. Frontend-puro (sustrato de dominio ya en backend). Gate 2 (code) — alta security-sensitive.
Fuentes: context-alta-guiada.md (Gate 0/scope), dominio-categorias-facundo-2026-06-03.md sec.2,
ADR-008 enmendado. Bitacoras impl_02-frontend-alta-guiada-A.md / -B.md.

## Veredicto: APPROVED

Con 2 findings menores de DOCUMENTACION (no de codigo, no bloqueantes) que el leader debe reconciliar
antes de cerrar/commitear (regla correcciones se reflejan en specs).

---

## Trazabilidad (R/RT a test) — completa

| Requisito | Test |
|---|---|
| RT2.20 macho ternero/torito/toro (corte 2 anios) + null->torito | animal-category.test.ts (RT2.20 macho) OK |
| RT2.20 hembra ternera/vaquillona + null->vaquillona | animal-category.test.ts (RT2.20 hembra) OK |
| RT2.20 novillito/novillo en el type | InitialCategoryCode + override novillito/novillo->true OK |
| #4 override=false (coincide) | animal-category.test.ts + E2E COINCIDE vaquillona sin anio OK |
| #4 override=true (difiere, A5 vaca comprada) | animal-category.test.ts + E2E DIFIERE Multipara fecha vieja OK |
| Override refinado B vaq.prenada+prenez->false | animal-category.test.ts + E2E VAQUILLONA PRENADA sin override OK |
| Override refinado B multipara/vaca2serv->true | animal-category.test.ts (multipara/vaca_segundo_servicio->TRUE) OK |
| computeInitialCategoryCode(hembra,pregnant)->vaquillona_prenada | animal-category.test.ts (B pregnant) OK |
| pregnant NO afecta al macho | animal-category.test.ts (B pregnant NO afecta macho) OK |
| Categoria filtrada por (sistema,sexo) | animal-category-picker.test.ts + E2E Multipara solo Hembra OK |
| Mapeo sec.2 datos por categoria | animal-category-fields.test.ts (recria/vacas/toro/vaq.prenada/otros) OK |
| ternero NUNCA dientes; multipara NUNCA peso | animal-category-fields.test.ts + E2E MULTIPARA/TERNERO OK |
| Lista dientes (enum 0020 + labels Facundo) | animal-category-fields.test.ts (TEETH_OPTIONS 8 valores) OK |
| Anio-only -> AAAA-07-01 clampeado a no-futuro | animal-birth-year.test.ts (clamp 01-01 futuro / null) OK |
| Validacion anio (vacio/4dig/no-futuro/cota) | animal-birth-year.test.ts OK |
| Vacia = no prenada (no crea tacto) | animal-birth-year.test.ts (isPregnantStatus) + screen pregnantCaptured OK |
| Wizard rodeo->sexo->categoria->datos + find-or-create intacto | E2E empty + INEXISTENTE 77123 read-only OK |
| Form dinamico multipara/ternero/vaq.prenada | E2E B MULTIPARA / B TERNERO / B VAQUILLONA PRENADA OK |
| Validacion en vivo (caravana 15dig, anio 4dig, peso) | E2E FIX2 LIMITA inputs + rechaza submit invalido OK |

Cada R/RT del scope tiene >=1 test concreto. Sin huecos.

## Tasks completas: SI (con matiz documental)

La alta guiada es Gate 0 propio (sin requirements/tasks propios; decomposicion A/B en el context). Las
tasks del implementer (A T1-T5; B T1-T6) estan ejecutadas segun bitacora y verificadas contra el codigo.
El tasks.md general de spec 02 no tiene tasks de alta guiada (sus wizard son de Crear rodeo C1). Sin tasks
pendientes del scope sin justificar.

## CHECKPOINTS

No hay CHECKPOINTS.md en la raiz aplicable a este sub-chunk (coordinacion en progress/plan.md +
feature_list.json). N/A.

## Tests ejecutados por el reviewer

- pnpm typecheck (app/) -> VERDE (tsc --noEmit, 0 errores).
- Unit en scope: animal-category + animal-category-picker + animal-category-fields + animal-birth-year
  -> 49 pass / 0 fail.
- E2E 40 passed verificado por el implementer (multipara/ternero/vaq.prenada/override/coincide).
- node scripts/check.mjs: el FAIL conocido de la suite Animal (7/7, animals_tag_electronic_len_chk) es por
  la migracion 0070 de feature 13 (otra terminal), NO regresion del alta guiada (verificado con git stash;
  es backend, esta feature no inserta tags). NO se cuenta como falla del scope.

## Checklist RAFAQ-especifico (secciones aplicables)

### A. Multi-tenancy (alta toca animal_profiles con establishment_id) — APLICA
- [x] No hardcodea establishment_id/species/system/category UUID: todo por contexto activo y por code
  (fetchSystemCategories, resolucion category_id por (systemId,code), species_id del rodeo). animals.ts 506-545.
- [x] RLS barrera real: createAnimal usa split insert (no insert+select, RLS-on-RETURNING documentado).
  Eventos post-create sin establishmentId (tenant por RLS del profileId).
- [x] No se escriben policies nuevas (frontend-puro; sustrato RLS ya existe). N/A enable RLS / policies.
- N/A test aislamiento cross-tenant nuevo: no se crean tablas/policies; cubierto por suite RLS/Animal backend.

### B. Offline-first — N/A JUSTIFICADO
El alta es operacion administrativa ONLINE por diseno documentado (context-alta-guiada; animals.ts 12-13).
Mismo patron que C1. Maneja sin-red con kind network + copy accionable (OFFLINE_COPY). PowerSync/buckets/
conflict-resolution/SQLite local -> C5. No aplica a este chunk.

### C. BLE — N/A (puerta manual no bastonea; rama TAG/BLE es spec 04, documentado animals.ts 402-409).

### D. UI de campo (wizard) — APLICA (pantalla amarilla por context: entra desde tab Animales, no manga)
- [~] Targets: filas sexo/categoria/rodeo/dientes/prenez/cria usan minHeight touchMin = 56px (token canonico
  manga-friendly del DS, tamagui.config 103). Chips condicion = chipMin 40px (escalon deliberado documentado).
  El checklist generico pide >=60dp; el proyecto adopto 56 como minimo canonico (no regresion: usa tokens del
  DS, no hardcodea menos). Pantalla amarilla (no-manga) por el context.
- [~] Fuente: decision sexo 20pt; titulos paso 18pt; opciones categoria/dientes 16pt (token de fila de opcion
  del DS, <18pt del ideal generico pero consistente con toda la app; pantalla amarilla). No nuevo de la feature.
- [x] Una decision por pantalla en los pasos de seleccion; paso 4 corto y relevante por categoria.
- [x] Loading visible: paso 3 loading/error/empty; CTA Creando en submit; gating de CTA por paso.

### E. Edge Functions — N/A (frontend-puro; no toca supabase/functions).

## Verificacion del checklist del brief

1. Wizard rodeo (1 auto-avanza one-shot; >=2 OptionRows)->sexo->categoria(cerrado)->datos. Find-or-create
   intacto: id precargado read-only + header Creando [id]. Back paso a paso (goBack 4..1 -> backOr lista). OK
2. Datos por categoria = sec.2 EXACTO: fieldsForCategory recria->weight; vaca2serv/multipara->teeth+CC+
   prenez+nursing; toro->teeth+CC; vaq.prenada->prenez+CC. Ternero NO dientes, multipara NO peso. CE diferida. OK
3. Override #4 + refinamiento B: categoryOverrideFor compara elegida vs computada(sexo,edad,prenez). RT2.20
   espejo arroja toro>=2 + type novillito/novillo. OK
4. Columna-vs-evento: teeth_state + nursing columnas del insert (gateados por show*); condicion + prenez
   eventos post-create (addConditionScore/addTacto) con profileId devuelto, fechados HOY. Prenez Vacia NO
   crea tacto. Fallo post-create tolerante: createdProfileId -> CTA Ver la ficha, sin duplicado. OK
5. Anio-only: birthYearToDate -> AAAA-07-01 con clamp a 01-01 si futuro; vacio -> null -> default por sexo. OK
6. Multi-tenant/specs: createAnimal NO hardcodea ids; split insert+select conservado. OK
7. Tests: unit cubren fieldsForCategory + override refinado + anio-only + RT2.20; e2e caminan los casos.
   49 unit del scope verdes; typecheck verde. OK
8. Validacion en vivo: caravana 15dig, peso decimal>0, anio 4dig, selectores cerrados. E2E FIX2. OK

## Findings (menores, NO bloqueantes — reconciliacion documental antes de cerrar)

1. [LOW doc] tasks-tier2-categorias.md:110 (T9) sigue marcado pendiente. Ese T9 es el recordatorio de
   alinear el espejo cliente computeInitialCategoryCode cuando el frontend agregue el picker novillito/
   novillo — exactamente lo que el sub-chunk A implemento (RT2.20). Regla correcciones-en-specs: el leader
   debe marcar T9 hecho (o anotar que se cerro en alta-guiada-A). No afecta el codigo entregado.

2. [INFO doc] El doc de dominio sec.3 lista 7 valores del enum (omite 3/4). Verifique la migracion 0020
   (fuente de verdad real del DB): teeth_state_enum tiene los 8 valores INCLUYENDO 3/4. TEETH_OPTIONS (8) es
   CORRECTO. El sec.3 del doc es el incompleto. No es finding de codigo; opcional agregar 3/4 al sec.3.

## Razones por las que NO se rechaza
- 0 tests rojos en el scope (49 unit + typecheck verdes; 40 E2E verificados; el fail de la suite Animal es
  ajeno — migracion 0070 de feature 13, verificado con stash).
- Todos los R/RT del scope tienen test.
- Sin tasks pendientes del scope sin justificar.
- Secciones RAFAQ aplicables (A multi-tenant, D UI campo) cumplen; B/C/E N/A justificado.
- Los 2 findings son de documentacion (reconciliacion de spec), no de codigo entregado.
