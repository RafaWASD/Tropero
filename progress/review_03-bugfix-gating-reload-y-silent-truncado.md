# Review — 2 bugfixes frontend-only de spec 03 (MODO MANIOBRAS)

Reviewer. FIX 1 (hero silent_apply truncado/overflow web) + FIX 2 (recarga que blanquea la carga rapida y
pierde el peso). Ambos frontend-puro (sin schema/RLS/Edge). Feature 03 sigue in-progress (cliente) — NO se
marca done.

## Veredicto: CHANGES_REQUESTED

Motivo unico y acotado: FIX 2 cambio el comportamiento as-built de useManeuverGating (ciclo de vida de loading)
y agrego una defensa en carga.tsx (render del spinner), y NO quedo reconciliado en design.md. Es la regla dura
del repo (docs/specs.md "Reconciliacion de specs al as-built" + reviewer hard-rule: "Reconciliacion pendiente =
CHANGES_REQUESTED"). Todo lo demas (correctitud, tests, hardcode, es-AR, descenders, offline, los 2
consumidores) esta VERDE. Es un fix de docs, no de codigo.

## 1. Correctitud y regresiones — OK (ambos)

FIX 1 (hero length-aware web-safe)
- heroFontTokenForName (app/src/utils/hero-text-size.ts): step-down por buckets de longitud sobre trim(),
  devuelve {fontSize,lineHeight} con par matching (descenders). Buckets $11<=10 / $10<=16 / $9<=24 / $8<=40 /
  $7 piso. Tokens $7..$11 EXISTEN en tamagui.config.ts (20/23/30/38/64; lineHeight matching, $11=72) => cero
  hardcode. Funcion pura, total, caso patologico->piso.
- SilentSanitaryStep.tsx: quito adjustsFontSizeToFit+minimumFontScale (NO-OP en RN-web, root cause);
  fontSize/lineHeight del helper; width 100% + numberOfLines=2 + ellipsizeMode=tail + web-only
  {overflowWrap:anywhere,wordBreak:break-word}. heroName se deduce UNA vez (helper y render) => tamano siempre
  corresponde al texto. Inseminacion reusa el mismo hero => cubierta.
- e2e maniobra-sanitaria.spec.ts test 6 (R6.15): valida por boundingBox fit horizontal (x>=-1, x+w<=vp+1) y
  vertical (boton Cambiar dentro del alto) a 412 Y 360 con corto/medio/tipico/patologico/extremo(200ch).
  Inseminacion no se rompe: tests 4/5 verdes.

FIX 2 (stale-while-revalidate del gating)
- maneuver-gating-load.ts: shouldShowLoadingForLoad(target,loaded)=target!==null && loaded!==target;
  initialLoadingFor(r)=shouldShowLoadingForLoad(r,null). Puro, correcto.
- useManeuverGating.ts: loadedRodeoRef (ref) + flip de loading SOLO en carga inicial del rodeo; revalidacion
  del mismo rodeo silenciosa; rodeoId=null resetea loadedRodeoRef->null; reqIdRef last-request-wins; load deps
  [rodeoId] (no lee config => sin loop). Error en revalidacion no flipea loading; error en carga inicial apaga
  el spinner. Verificado.
- carga.tsx: hasRenderedContentRef (false->true idempotente en render); gatingSpinner =
  (gating.loading || gatingPending) && !hasRenderedContentRef.current => renderizado un paso, un flip
  transitorio NO vuelve al spinner => PesajeStep NO se desmonta => el peso tecleado sobrevive. Cierra el bug.
- Cambio de rodeo SI muestra loading: shouldShowLoadingForLoad(B,A)===true.

## 2. Los DOS consumidores de useManeuverGating — OK (mejora estricta para ambos)
- carga.tsx (carga rapida): useManeuverGating(animal?.rodeoId ?? null). Rodeo estable por route param => solo
  revalidacion del mismo rodeo => ahora silenciosa (antes parpadeaba y desmontaba el paso). Loading inicial
  intacto.
- jornada.tsx (wizard etapa 2): useManeuverGating(rodeo?.id ?? null), gatea la lista con loading=gating.loading
  (InfoNote linea 418). Rodeo cambia al elegir otro en etapa 1 => loading muestra correcto. Revalidacion del
  mismo rodeo por sync => ya no parpadea. Mejora estricta, loading inicial intacto.

## 3. Offline-first (R10.x) — INTACTO
load() sigue leyendo del SQLite local via fetchRodeoGating(rodeoId), sin red nueva ni cambio de scoping/path de
escritura. Solo cambia CUANDO se muestra loading. FIX 1 es puramente de presentacion.

## 4. Cero hardcode / es-AR / descenders — OK
- node scripts/check-hardcode.mjs => 0 violaciones.
- FIX 1: tokens $7..$11; lucide via getTokenValue; style web solo CSS de layout. lineHeight matching en el hero.
- es-AR: nombre de producto/pajuela es texto LIBRE => no se formatea. N/A correcto.

## 5. Tests — VERDES; el rojo de check.mjs es flake ajeno
- Unit de los 2 fixes (con el ts-ext-resolver.mjs del runner): hero-text-size 9/9 + maneuver-gating-load 12/12
  = 21/21. (node --test directo sin resolver falla por ERR_MODULE_NOT_FOUND del import extensionless de
  hero-text-size = artefacto de invocacion, NO del test; el runner lo resuelve.)
- node scripts/check.mjs: typecheck OK . client unit 1305/1305 (incluye los 2 nuevos) . RLS 22/22 . Edge 42/42 .
  Animal suite 2 fails = duplicate key animals_tag_unique (23505) = flake de seed concurrente de terminal
  paralela (memoria reference_check_red_rate_limit), suite BACKEND, fixes frontend-puro => NO regresion.
- e2e: especificaciones presentes y adecuadas (sanitaria test6 layout-based R6.15; carga regresion del frame).

## 6. CHECKPOINTS aplicables
- C1 [x]  C2 [x] (03 in-progress, no done)  C3 [x] (capas correctas; sin debug logs/TODOs)  C4 [x]
- C5 N/A (no se cierra sesion)  C6 [x] con salvedad de reconciliacion (RC-1)  C7 N/A  C8 [x]

## 7. Checklist RAFAQ-especifico
- A. RLS/multi-tenancy — N/A (frontend puro).
- B. Offline en campo — OK (lee SQLite local; sin request sincrono desde pantalla; LWW sin cambios).
- C. BLE — N/A.
- D. UI de campo: [x] botones (CTA $touchMin=56 en bloque dominante flex:1 >60; tension token-56 vs piso-60 ya
  al backlog) ; [x] fuente >=18pt en dato de manga (hero 20..64px) ; [x] una decision por pantalla ;
  [x] loading visible (inicial intacto; solo se suprime el flip transitorio de revalidacion).
- E. Edge Functions — N/A.

## CAMBIO REQUERIDO (unico)

RC-1 — Reconciliar FIX 2 en design.md (regla dura codigo->spec).
FIX 2 cambio el comportamiento as-built de componentes ya documentados:
1. app/src/hooks/useManeuverGating.ts — paso a stale-while-revalidate (loading SOLO en carga inicial del rodeo
   via loadedRodeoRef + shouldShowLoadingForLoad; revalidacion del mismo rodeo silenciosa). El §3 de design.md
   (Gating capa 1 cliente, ~lineas 397-405) describe el hook como "se re-carga al ENFOCAR y al avanzar el SYNC"
   sin el matiz de revalidacion-silenciosa => quedo incompleto vs el as-built.
2. app/app/maniobra/carga.tsx — nueva defensa hasRenderedContentRef en el render del spinner
   (carga.tsx:282-283,454).

Por que es bloqueante: misma categoria que el bugfix-tacto (frontend-puro, Raf lo cazo en pnpm web), que SI se
reconcilio como nota "AS-BUILT bugfix tacto" en design.md:702-704; y que el FIX 1 de este mismo lote,
reconciliado en §6.bis.6 (design.md:792-803). El argumento del impl ("la spec no define el ciclo de vida interno
del hook") es el que habria excusado al bugfix-tacto — y ese se reconcilio. Sin nota, design.md describe el
comportamiento de loading viejo (el que causaba el bug) => contradice el as-built.

Accion (implementer/leader, NO el reviewer): agregar a design.md una nota as-built (p. ej. §6.bis.7) con:
(a) sintoma (sync de fondo -> spinner -> desmonta PesajeStep -> pierde el peso); (b) fix stale-while-revalidate
en useManeuverGating (maneuver-gating-load.ts puro + loadedRodeoRef); (c) defensa hasRenderedContentRef en
carga.tsx; (d) frontend-puro, el QUE (R5.3/R5.5/R10.3) no cambio. Como en §6.bis.6: requirements.md y tasks.md
NO se tocan.

Re-review: con esa nota agregada => APPROVED. Codigo, tests y todo lo demas ya estan verdes.
