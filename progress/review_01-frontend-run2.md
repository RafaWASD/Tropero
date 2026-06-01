# Review - Run 2 (pulido B.1.2, frontend spec 01)

**Fecha**: 2026-05-31
**Reviewer**: agente revisor
**Feature**: 01-identity-multitenancy (in_progress) - Run 2 de B.1.2 (pulido UX + 1 bug sobre codigo ya gateado)
**Baseline**: working tree sin commitear sobre 4728a7b
**Bitacora**: progress/impl_01-frontend-run2.md

## Veredicto: APPROVED

Run 2 es un pulido (6 puntos UX + 1 bug) sobre codigo de B.1.2 que ya paso reviewer + Gate 2. No introduce requirements nuevos ni toca schema/RLS/Edge. La logica nueva con decision esta aislada en helpers puros y testeada; check.mjs verde (anti-hardcode 0, typecheck OK, 80 unit cliente / 0 fail); las dos rutas best-effort (auth metadata + dismiss persistido) son tolerantes a red sin romper el flujo; y la fuente unica de roleLabel quedo consolidada. Los puntos visuales (medicion de la pill, pulso, 2da linea del Row) estan delegados al veto visual del leader (CDP) y no son blockers de correccion de codigo.

## Trazabilidad R-n vs test

Run 2 no agrega R nuevas; pule sobre R existentes. La logica con decision va a helpers puros testeados en app/src/utils/establishment.test.ts (41 tests, 18 nuevos):

- R6.6 / R6.8.1 (desambiguacion + etiqueta de rol del switch/card):
  - roleLabel: las 3 etiquetas canonicas en espanol.
  - localityOf: 4 tests (usa city, cae a province, trim de city, ambas vacias da vacio).
- R3.1 / R3.4 (advertir duplicados al crear/editar): hasDuplicateName, 9 tests (exacto, case, acentos, trim, distinto, vacio, lista vacia, excludeId propio, otro homonimo).
- R6.x banner per-campo: shouldShowReadyBanner, 4 tests (null da false, no-descartado da true, descartado da false, per-campo A distinto de B).
- R2.1 (editar nombre de perfil) - fix del saludo (a): wiring verificado por lectura (no testeable bajo node; coherente con el patron de la capa de servicios).

Las R de fondo de B.1.2 (R6.7 landing, R6.10 active_lost, R3.x alta, mapeo de membership) ya tienen cobertura de runs previos (suite RLS real 16 + 28 tests de utils/mapping) y no fueron modificadas por Run 2.

## Tasks completas

N/A como tasks.md granular: la tasks.md de spec 01 esta al nivel de fase (T0-T8). B.1.2/Run 1/Run 2 son runs de decomposicion trazados en progress/current.md, no entradas de tasks.md. Los 6 puntos del plan de Run 2 (a-f) estan todos ejecutados (verificado contra el diff). No quedan puntos sin justificacion. Housekeeping pendiente del leader (marcar T4.x en tasks.md) ya estaba anotado en B.1.2 y no es de este run.

## CHECKPOINTS

- C2 estado coherente: [x] una sola feature in_progress (01); current.md describe la sesion activa.
- C3 respeta arquitectura: [x] solo capas previstas (screens=app/, components, services, contexts, utils); [x] sin deps nuevas (la pill no agrego driver de animacion, usa toggle de fondo); [x] sin logs de debug sueltos (el unico console.warn en establishments.ts:262 esta gateado por NODE_ENV distinto de production); [x] TODOs con contexto (post-MVP / spec 02); [x] no se hardcodea establishment_id.
- C4 verificacion real: [x] al menos un test por modulo con logica nueva (4 helpers puros, 18 tests); [x] runner mayor a 0 verdes (80 unit cliente, 0 fail); el I/O de storage (loadDismissedBanners/addDismissedBanner) NO testeado pero sigue el precedente documentado (SecureStore/localStorage no cargable bajo node, la logica de decision se extrae a utils y SI se testea).
- C6 SDD: [x] specs/active/01 con los 3 archivos; [x] R que Run 2 toca cubiertos por al menos un test.
- C7 multi-tenant: [x] Gate 2 ya PASS en B.1.2 (0 HIGH); Run 2 no agrega query nueva ni columna; el subtitulo y hasDuplicateName consumen solo recents/estState.current (memberships ya accesibles bajo RLS), sin nueva exposicion.
- C8 offline-first: [x] dismiss persistido y auth.updateUser son best-effort tolerantes a red (ver foco 2). Crear/editar campo siguen online por R9.2 (sin cambio).

C1 y C5 son de cierre de sesion/harness, fuera del alcance de este run de codigo.

## Checklist RAFAQ-especifico

- A. multi-tenancy / RLS: N/A. Run 2 no toca tablas, policies ni helpers SQL. Sin delta backend.
- B. offline-first (carga de datos en campo): parcialmente aplicable (persistencia local del dismiss + sync de metadata Auth).
  - [x] No rompe offline: loadDismissedBanners/addDismissedBanner envuelven readRaw/writeRaw en try/catch y devuelven set valido aunque el storage falle; setDismissedBanners(next) oculta el banner en memoria igual.
  - [x] saveProfile tolerante: orden public.users luego auth.updateUser; si public.users falla corta con error; si updateUser falla por red, igual devuelve ok:true (el nombre quedo persistido en public.users), contrato SaveResult intacto.
  - N/A PowerSync bucket / conflict resolution: identidad es online por R9.2; el dismiss es estado local de UI per-usuario, no dato de campo sincronizable.
- C. BLE: N/A.
- D. UI de campo (manga, pantallas mixtas home/config):
  - [x] Targets: el Row del dropdown mantiene minHeight touchMin (56px) y crece con el subtitulo, nunca baja del target. El chip del switch y la pill del navbar no reducen targets (la pill es decorativa, el Pressable de la tab envuelve todo).
  - [x] Loading visible: el switch es local (sin round-trip), el pulso 450ms es el feedback explicito (decision council: micro-feedback, no skeleton).
  - [ ] Delegado al veto visual del leader (CDP, NO bloqueante de codigo): que la pill (b) no corte/empuje el label ni colisione con el halo del FAB a 360/412; que el pulso (d) se vea como pill prolijo; que la 2da linea del Row (e) no desalinee. Justificado: medicion exacta es CDP, no estatica; explicitamente delegado al leader.
- E. Edge Functions: N/A. Run 2 es 100% cliente.

## Foco de revision (los 6 puntos del leader)

1. Anti-hardcode (ADR-023 seccion 4): OK. Lint 0 violaciones. Lo nuevo usa tokens (pill, greenLight, espacios 1/2/3, touchMin, fontSize 3/5). El unico valor que cruza a API no-Tamagui es iconSize = getTokenValue navIcon size en NavTabIcon. El color de NavTabIcon viene tipado como ColorValue desde el tabBarIcon de React Navigation y se pasa a lucide, no es literal. No hay literal disfrazado ni valor magico.
2. Offline-first / best-effort: OK. saveProfile sigue devolviendo ok coherente; orden public.users luego updateUser correcto y tolerante. AuthContext (onAuthStateChange, linea 102) escucha TODOS los eventos, USER_UPDATED re-lee toAuthUser (lee user_metadata.name, linea 66-67), el saludo se refresca sin reload. El guard pushRegisteredForUser evita re-registro de push ante el re-render. Fix bien wireado.
3. Manga-friendly: OK a nivel codigo / medicion visual al leader. El Row no degrada touchMin; subtitulo numberOfLines 1 con ellipsis. Ver D.
4. Logica pura testeada: OK. Edges cubiertos: localityOf (city, province, vacio, trim, ambas vacias, objeto vacio); hasDuplicateName (vacio da false, case/acento, trim, excludeId propio vs otro homonimo, lista vacia); shouldShowReadyBanner (null-safe, descartado, per-campo A distinto B); roleLabel (3 etiquetas). Los tests ejercen el caso por la razon correcta (verifican el reject, no solo el happy path).
5. Sin regresion de seguridad/datos: OK. Sin query/columna nueva. Subtitulo y duplicados leen recents/estState.current (memberships ya bajo RLS, filtradas por user_id desde el fix de B.1.2). No hay nueva exposicion de owner-name (correctamente diferido a Facundo). Gate 2 de B.1.2 sigue valido (sin delta de superficie sensible).
6. Consistencia (roleLabel fuente unica): OK. EstablishmentCard borro su ROLE_LABEL local y ahora consume roleLabel de utils/establishment (RoleBadge + a11yLabel). El dropdown usa el mismo helper via switcherSubtitle. Una sola fuente, sin copia vieja sobreviviente.

## Observaciones menores (NO bloqueantes)

- addDismissedBanner duplica inline la logica de add idempotente a un set en lugar de extraerla a un helper puro testeable (como si se hizo con promoteInTrail para el trail). El comportamiento es trivialmente correcto y sigue el precedente de I/O de storage no testeable bajo node, y la decision de mostrar/ocultar SI esta testeada via shouldShowReadyBanner. Consistencia, no correccion, anotable para futuro pulido, no exige cambio.
- TODO (spec 02 frontend) gatear ademas por rodeoCount 0 en shouldShowReadyBanner: correcto no inventar estado de rodeo hoy; el TODO tiene contexto. Sin accion.

## Cambios requeridos

Ninguno.
