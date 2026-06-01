# Review — spec 02 frontend · C1 RODEOS (crear rodeo)

**Reviewer**: reviewer (agente). **Alcance**: frontend de spec 02, chunk C1 (RODEOS). Codigo sin
commitear en el working tree. Backend de spec 02 done/deployado — NO se revisa (intacto).

## Veredicto: APPROVED

node scripts/check.mjs verde de punta a punta: anti-hardcode 0 violaciones; typecheck OK; client
unit 146/146 (128 previos + 18 nuevos de rodeo-template); RLS 17; Edge 36; Animal 28; Maniobras 13.
El backend no fue tocado (frontend-only, services swappables).

## Trazabilidad R<n> -> test

C1 es frontend sobre backend ya probado. La cobertura se cumple en dos planos: (a) la logica PURA
nueva (agrupado/diff/toggles) tiene unit tests propios; (b) el path cliente<->RLS (split
insert+select, UPDATE/INSERT de config owner-only) ya esta verificado contra DB remota por la suite
Animal (T2.9, T2.16), que autentica con anon-key + RLS igual que estos services. No se duplico un
test remoto redundante — el path SI esta cubierto.

- R2.2 (owner crea rodeo): Animal T2.9 (owner crea OK; split insert+select) <-> services/rodeos.ts::createRodeo.
- R2.3 (field_op/vet NO crean/editan): Animal T2.9 (field_operator crea -> falla RLS) + T2.16 caso 5/6 (UPDATE/INSERT config -> falla). UI oculta CTAs a no-owner (rodeos.tsx:151, editar-plantilla.tsx:190); services usan count:exact -> error si RLS bloquea (no falso OK).
- R2.4 (solo bovino,cria; resto inactivo): Animal T2.9 ((bovino,invernada) -> 23514). Wizard grisa active=false (crear-rodeo.tsx:404,438); createRodeo filtra .eq(active,true) (rodeos.ts:201).
- R2.5 (soft-delete owner; rechaza si tiene animales): Animal T2.9 (con/sin animales) <-> softDeleteRodeo (rodeos.ts:281); UI bloquea borrar el unico rodeo (rodeos.tsx:61).
- R2.6 (no default -> wizard + bloqueo total): Animal T2.9 (0 rodeos al crear campo). RootGate (_layout.tsx:262-288) + RodeoContext no_rodeos + crear-rodeo.tsx modo bloqueo.
- R2.8 (catalogo global agrupado): rodeo-template.test.ts (groupTogglesByCategory: orden canonico + sort_order; categoria no prevista al final).
- R2.9 (defaults/required por sistema): rodeo-template.test.ts (buildWizardToggles: default ON/OFF; required nunca emite op).
- R2.11 (trigger pre-pobla; cliente diffea): rodeo-template.test.ts (computeConfigDiff: 0 ops/UPDATE/INSERT) + Animal T2.9/T2.16 (trigger pre-pobla 26 filas, 23 ON).
- R2.12 (owner toggablea + habilita no-default; sin DELETE de cliente): rodeo-template.test.ts (computeEditDiff) + Animal T2.16 caso 6 (INSERT no-default OK) / caso 7 (no DELETE).
- R2.12.1 (timeline conserva historial al destildar): sustrato — el header de Editar plantilla lo explica (editar-plantilla.tsx:44). El aviso con conteo de N eventos es de C3 (necesita timeline). Documentado como limitacion no-bloqueante.

Tasks de C1 (T3.1 RodeoContext, T3.6 rodeo-config.ts, T4.3 RodeosScreen+wizard+editar+empty-state)
completas y documentadas. El resto de Fase 3/4 (C2-C5) queda [ ] por la decomposicion en chunks de
context-frontend.md — justificacion documentada, no es deuda oculta. No hay tasks de C1 a medias.

## Tasks completas: si (para el alcance C1)

## CHECKPOINTS
- C1 (harness): N/A (no se toco harness).
- C2 (estado coherente): [x] una feature in_progress; check verde.
- C3 (arquitectura): [x] solo capas previstas (contexts/services/utils/components/app); componentes NO importan de services; establishment_id nunca hardcodeado (viene de contexto; species/system por code, no UUID, rodeos.ts:183-202); sin logs/TODOs.
- C4 (verificacion real): [x] logica pura con 18 unit; path cliente<->RLS por fixtures reales (Animal T2.9/T2.16); runner verde; cross-tenant cubierto (T2.16 caso 9 / T2.8).
- C5 (sesion cerrada): [x] bitacora presente; sin artefactos temporales.
- C6 (SDD): [x] 3 docs; cada R<n> de C1 con >=1 test.
- C7 (multi-tenant): [x] escrituras via services que confian en RLS (is_owner_of/has_role_in); cross-tenant probado.
- C8 (offline-first): [x] con matiz — crear/editar rodeo es operacion ONLINE (como crear campo): sin red -> error accionable, NO falso bloqueo. PowerSync (offline real de datos de campo) es C5, diferido. Services swappables a proposito. Crear rodeo no es carga en manga.

## Checklist RAFAQ-especifico
- A. Tablas con establishment_id / RLS: N/A (no toca schema). Los services confian en RLS como barrera real (count-based), no solo UI.
- B. Carga/edicion en campo (offline-first): N/A con matiz (operacion de oficina ONLINE; PowerSync = C5). [x] pantallas llaman services, nunca supabase-js directo.
- C. BLE: N/A.
- D. UI de campo (wizard) — criticidad amarilla (oficina+campo) (oficina+campo, no manga roja (manga)):
  [x] una decision por pantalla (wizard 3 pasos discretos, un CTA por paso).
  [x] loading visible en cada borde (Cargando.../Creando.../Guardando...) + fallo de red con copy + Reintentar.
  [x] fuente legible (titulos $6/$8 = 20/30px; labels $5 = 16px; descripciones $3 secundarias).
  [x] targets: el tap real de cada toggle es la FILA completa (minHeight=$touchMin 56px), no la pista; cards de sistema $touchMin; CTAs primarios Button.
  Observacion no-bloqueante: filas de accion de RodeoCard (Editar/Eliminar, rodeos.tsx:218,238) usan $chipMin (40px) < 56/60dp. Pantalla de gestion de oficina del owner, acciones secundarias densas, estandar del proyecto = touchMin 56. Aceptable para amarilla (oficina+campo); anotar si se reusa en flujo de campo.
- E. Edge Functions: N/A (ADR-012 prefiere triggers, ya done).

## Puntos del pedido — verificados
1. Empty-state bloqueo total (R2.6): OK. Gate de rodeo dentro de est=active, DESPUES de auth/email/token/establecimiento; no toca gates de spec 01. no_rodeos -> /crear-rodeo bloquea todo (solo el wizard pasa). loading -> splash, no afirma bloqueo a ciegas (fallo de red -> loading+error reintentable, no no_rodeos, RodeoContext.tsx:117-127). Salida: tras crear, refreshRodeos -> active -> replace(/(tabs)).
2. Anti-loop: OK. Deps PRIMITIVAS (userId/establishmentId strings) en efecto de carga (RodeoContext.tsx:134-136); applyRodeos useCallback []; load estable; persistencia depende de currentId (string); loadSeq descarta cargas viejas. Sin deps inestables.
3. owner-only (R2.3): OK doble capa. UI oculta CTAs a no-owner; RLS (is_owner_of) es la barrera real; services reportan error si bloquea (count). Lista read-only para todos. Probado Animal T2.9/T2.16.
4. createRodeo: OK. Split insert+select (rodeos.ts:211-234) evita 403 RLS-on-RETURNING; species/system por code con active=true (sin UUID); diff via computeConfigDiff (solo lo que difiere; trigger pre-pobla). Falla parcial: no deshace el rodeo, reporta "rodeo creado, revisa la plantilla" (rodeos.ts:247-260) — no se pierde el rodeo.
5. Wizard (R2.6): OK. 3 pasos (sistema grisando no-MVP -> nombre trim+max60 validado -> plantilla agrupada con defaults pre-tildados). Una decision por pantalla. Reusa FieldTemplateToggleList en wizard paso 3 y en Editar plantilla (componente controlado, sin fetch — respeta capas).
6. Cero hardcode (ADR-023 §4): OK. check-hardcode 0 violaciones. Tokens JIT documentados (toggle*, progressTrack). contentContainerStyle usa getTokenValue. Hairlines borderWidth=1/height=1 y paddingBottom={insets.bottom + 12} exentos del scanner a proposito.
7. Housekeeping/tests puros: OK. 18 unit cubren agrupado+ambos diffs+toggles+labels+casos defensivos. Exports limpios; RodeoProvider montado dentro de EstablishmentProvider.

## Cambios requeridos: ninguno (bloqueante)

## Observaciones no-bloqueantes
- RodeoCard action rows en 40px ($chipMin) < 56/60dp. Pantalla amarilla (oficina+campo) de gestion, no manga. Pulir si se reusa en campo.
- R2.12.1 aviso de N eventos al destildar: conteo exacto es de C3 (necesita timeline). El header ya aclara que no borra historial.
- Conteo de animales por rodeo: diferido a C2 (no hay animales aun). Coherente.
