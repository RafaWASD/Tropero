# Review - delta bastoneo-captura-alta-parto (spec 02, RCF.6 generalizado a modo CAPTURA)

baseline_commit: c402a38 (HEAD real 97f559b = commit del workstream Android, IGNORADO). Nivel B, frontend puro, Gate 1 N/A.

## Veredicto: CHANGES_REQUESTED

Motivo unico y acotado: reconciliacion de specs UNILATERAL (se reconcilio el design, NO las requirements del parto). El codigo, el ownership, el ruteo per-ternero y los tests estan correctos. Es un fix de 2 notas en un .md, no toca codigo.

---

## Trazabilidad (comportamiento del delta / requirement as-built vs test)

- Captura del EID en el ALTA (BLE, modo captura) -> app/e2e/alta-bastoneo.spec.ts:83 (a): CTA tag-scan-open -> tag-scan-sheet -> bastonazo -> tag-scan-read visible -> tag-captured + oraculo server waitForServerAnimalProfile + waitForServerTagAssigned(profileId, eid).
- Mis-scan corregible en el form (EID NO inmutable) -> app/e2e/alta-bastoneo.spec.ts:131 (a-bis): scan A -> tag-captured-clear -> scan B -> oraculo usa eidRight, no eidWrong.
- Cleanup del scoped scanner en el alta -> app/e2e/alta-bastoneo.spec.ts:179 (b): cerrar sheet -> bastonazo posterior no dispara tag-scan-read/tag-scan-sheet/find-or-create-overlay.
- Limite 15 dig + rechazo de la carga manual DENTRO del sheet (alta) -> app/e2e/animals.spec.ts:589 FIX2: 40 dig->15; 8 dig-> error "15 digitos" + sigue en tag-scan-manual (fail-closed).
- Captura por ternero (PARTO, 1 ternero, BLE) -> app/e2e/parto-bastoneo.spec.ts:88 (a): tag-scan-open-0 -> bastonazo -> tag-captured-0 + overlay count 0 -> waitForServerBirth(1) + waitForServerCalfTags(eid).
- Mellizos: cada ternero su caravana distinta (ruteo per-localId) -> app/e2e/parto-bastoneo.spec.ts:133 (b): 2 CTAs -> 2 EIDs distintos (tag-captured-0/-1) -> waitForServerBirth(2) + waitForServerCalfTags(eid0, eid1).
- Ownership exclusivo (no doble-consumo del EID) -> tag-scan-read visible (el read solo llega al sheet si el scoped scanner fuerza listening pese a busy) + find-or-create-overlay count 0, en (a) de ambas specs.
- Copy de captura Usar caravana -> asertada en alta (a):107 y parto (a):111.
- Logica pura reusada (sanitizeTagInput / isValidTagElectronic / formatEidReadable / resolveListening / resolveListenConnState) -> animal-input.test.ts, eid-format.test.ts, listener-gate.test.ts, maniobra-listen-state.test.ts: 134/134 verdes.

Nota: el delta NO introduce Rn nuevos (generalizacion as-built de RCF.6; el tag sigue opcional y fluye a los mismos contratos createAnimal/registerBirth). Los Rn involucrados (RCF.6.x, RPRC.2.5) estan cubiertos por baseline (baston-ficha.spec.ts) + las specs nuevas.

## Tasks completas
N/A - el delta no tiene tasks.md propio (delta-spec sobre feature done, ADR-028). No quedan boxes sin justificar.

## CHECKPOINTS (aplicables)
- C1 [x] harness completo; check.mjs --fast exit 0 (suite backend/RLS ORTOGONAL - Gate 1 N/A, 0 migraciones - y con terminal paralela arriesga rate-limit flake; no se corrio por diseno).
- C2 [x] estado coherente.
- C3 [x] respeta capas (components/screens/services); sin logs sueltos; no hardcodea establishment_id.
- C4 [x] test por modulo con logica; runner mayor que 0 verde (134/134 unit + e2e con oraculo server).
- C5 [x] sin artefactos temporales; design/*.png intactos; supabase/ diff vacio.
- C6 [PARCIAL] SDD: specs presentes, PERO design reconciliado / requirements NO (ver Cambios requeridos). Cada comportamiento tiene test.
- C7 [N/A] multi-tenant: 0 tablas nuevas, frontend puro. establishmentId sigue del contexto.
- C8 [x] offline-first: captura = estado de cliente puro (sin red); createAnimal/registerBirth offline-first via outbox, contratos INTACTOS.
- C9 [PARCIAL] E2E: suites de regresion presentes y verdes (typecheck) + capture files entregados; shots gitignored. Veto visual Gate 2.5 lo corre el leader (NO ejecute e2e:build, per instruccion).

## Checklist RAFAQ-especifico
- A (multi-tenancy / RLS) - N/A: frontend puro, 0 migraciones, sin tablas nuevas (git diff supabase/ vacio).
- B (offline-first en campo) - APLICA:
  - [x] Funciona offline: captura = estado de cliente; submits offline-first via outbox.
  - [x] Sync bucket: sin cambios (reusa createAnimal/registerBirth, scoped por establishmentId del contexto).
  - [x] Conflict resolution: sin path de escritura nuevo (contratos intactos) -> hereda el del baseline.
  - [x] No hace requests sincronos a Supabase desde la pantalla: onSubmit en captura solo setea estado del form (sin RPC).
- C (BLE) - APLICA:
  - [x] Desconexion repentina: el sheet degrada por resolveListenConnState (connected/connectable/manual) - patron RCF.6 identico.
  - [x] Modo manual fallback en 1 tap: link Sin baston Carga la caravana a mano / CTA Cargar la caravana a mano.
  - [N/A] Correlacion TAG-peso por ventana temporal: este flujo captura EID, no correlaciona peso.
  - [x] Logs BLE no bloquean: logTransportEvent best-effort (baseline provider).
- D (UI de campo) - APLICA:
  - [x] Targets grandes: TagScanCta/CapturedTagRow minHeight token touchMin; botones del sheet fullWidth.
  - [x] Fuente legible en el valor: EID capturado fontSize 5, confirmacion fontSize 8, CTA fontSize 5 (el label muted Caravana electronica fontSize 3 es rotulo, no dato a leer en manga - aceptable).
  - [x] Una decision por pantalla: el sheet es scan -> confirmar.
  - [x] Loading visible: Guardando en confirm (transitorio; en captura resuelve sincronico).
- E (Edge Functions) - N/A: no toca Edge Functions.

---

## Lo que SI cierra (verificado)

1. Generalizacion TagScanSheet - onAssignTag -> onSubmit (neutral, TagScanSheet.tsx:70). Default copy = la de antes, aplicada a AMBOS ReadConfirmation (:218) Y ManualTagEntry (:212). Scoped scanner (:90-94) / ownership / validacion 15 dig (:424) / manualModeRef (:107) SIN cambios. animal/[id].tsx -> onSubmit=onAssignTag (:1013), asignar INTACTO. TagScanCta extraido a components/TagScanCta.tsx; en [id].tsx borrada la def local + import muerto StickIcon (grep 0; TagScanCta usado en :859).
2. ALTA (crear-animal.tsx) - rama prefillKind distinto de tag: tag ? CapturedTagRow : (label + TagScanCta opcional) (:1328-1348). onSubmit setea tag + ok true, sin RPC (:915-921). Campo tipeable suelto ELIMINADO (sanitizeTagInput removido; grep 0). Mis-scan corregible (onClearTag). Rama prefillKind igual a tag read-only intacta. tag -> createAnimal opcional (tagElectronic vacio -> null, :589). Identidad minima (hasAtLeastOneIdentifier, :543) intacta.
3. PARTO (agregar-evento.tsx) - un solo sheet via scanCalfLocalId (:216); onSubmit -> updateCalf(scanCalfLocalId, tagRaw eid) (:771) escribe en EL ternero correcto; localId (no indice) inmune a reorden; mellizos independientes (CTA tag-scan-open-index por card, :1652). tagRaw -> validateCalves -> registerBirth sin cambios (:473-504). idv/visual del ternero no tocado. sanitizeTagInput/TAG_ELECTRONIC_LENGTH removidos (grep 0).
4. Ownership (load-bearing) - VERIFICADO contra listener-gate.ts (resolveListening = scopedScannerActive O BIEN (enabled y no busy)), BleStickListenerProvider.tsx (scopedCount, handleReading dropea si no listeningRef.current), FindOrCreateOverlay.tsx (:152 return si scopedScannerActiveRef.current; :208 cierra si scoped se activa). Alta y parto llaman useBusyWhileMounted() (crear-animal.tsx:123, agregar-evento.tsx:143). Acquire en montaje / release en cleanup -> sin doble-consumo ni listener colgado. E2E lo prueba.
5. Tests - typecheck app VERDE; unit 134/134; e2e con oraculo server (waitForServerCalfTags recorre reproductive_events -> birth_calves -> animal_profiles -> animals.tag_electronic, tabla server-only). Ningun e2e existente llena el campo suelto (3 refs restantes = asserts de AUSENCIA). NO corri e2e:build (lo hace el leader en Gate 2.5).
6. Higiene - anti-hardcode 0 violaciones; git diff supabase/ vacio; sin design/*.png del delta.
7. Reconciliacion design - design-caravana-ficha.md seccion 10.6 (as-built fiel) + design.md fila del delta + design-parto-rodeo-caravana.md nota bajo RPRC.2.5. FIELES al codigo.

---

## Cambios requeridos (bloqueante)

[R-1] Requirements del PARTO quedaron viejas tras el fix (reconciliacion unilateral). El design se reconcilio, las requirements NO - y el proyecto YA tiene precedente de nota inline SUPERADA-por para EXACTAMENTE esta generalizacion en el lado ficha (requirements-caravana-ficha.md RCF.1.6 :65-69 y RCF.2 :76-79). En el lado parto falta:

- specs/active/02-modelo-animal/requirements-parto-rodeo-caravana.md:55 - RPRC.2.5 dice: mantener el tag electronico como CAMPO por ternero (SIN CAMBIOS respecto del baseline). -> CONTRADICE el as-built: el campo tipeable se reemplazo por el bastoneo (CTA TagScanCta + TagScanSheet en modo captura, carga manual dentro del sheet). Ya NO es un campo tipeable ni es sin-cambios. Agregar nota de reconciliacion/supersesion apuntando a design-parto-rodeo-caravana.md (nota bajo RPRC.2.5) - mismo patron que RCF.1.6/RCF.2.
- specs/active/02-modelo-animal/requirements-parto-rodeo-caravana.md:81 - RPRC.5.2 lista sexo/peso/TAG-ELECTRONICO entre lo conservado SIN CAMBIOS. El mecanismo de entrada del tag electronico cambio (FormField -> bastoneo) aunque tagRaw fluya igual a registerBirth -> acotar/anotar.

Reconcilia el implementer (yo no edito specs de codigo). Con esas 2 notas, el delta queda para APPROVED: sin hallazgos de codigo, ownership, ruteo per-ternero ni tests.
