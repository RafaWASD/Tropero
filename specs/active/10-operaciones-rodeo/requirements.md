# Spec 10 — Operaciones masivas por rodeo + vista de grupo — Requirements (EARS)

**Status**: `spec_ready` (reconciliación completa 2026-06-11; el flip/estado en `feature_list.json` lo coordina el leader).
**Gate 1 (security spec)**: ✅ **RE-CORRIDO 2026-06-11 — PASS 0 HIGH / 2 MEDIUM / 3 LOW** (`progress/security_spec_10-operaciones-rodeo.md` §"Spec reconciliada v2"; el PASS del 2026-06-01 quedó obsoleto — auditaba el delta `castracion` eliminado). Los 2 MEDIUM documentales (M1 interacción con checks de 0021; M2 sobre-promesa del audit trail en `ternero`) + el LOW barato (L1 aserción de orden contra `pg_trigger`) están **foldeados** en este fix-loop — ver §Limitaciones explícitas e Historial.
**Puerta 1 (aprobación humana)**: ✅ **APROBADA por Raf (2026-06-11) — LIM-1=mitigar con observación / LIM-2=tolerar-y-saltear foldeadas.** Las 2 decisiones sobre §Limitaciones explícitas están foldeadas en esta revisión: **LIM-1 → MITIGADA** con observación automática client-side al castrar/revertir (nuevo R13.7) y **LIM-2 → RESUELTA** con tolerar-y-saltear (pre-filtro en la propagación, design §4.2(4)). Los **4 criterios propios del autor quedaron validados tal cual** (R7.2 exclusión-de-lista en destete cross-rodeo, R11.4 lista de destete acotada, R5.6 aviso de override en el bottom-sheet, design §9 D8 normalización silenciosa de `future_bull`). ⚠ El delta de LIM-2 (cambio del trigger de propagación) requiere **re-chequeo puntual de Gate 1** (lo lanza el leader — design §6).
**Fecha**: 2026-06-11 (reescritura orgánica; redacción original 2026-06-01, sesión 21).
**Autor**: spec_author.
**Fuentes de verdad** (en este orden): `specs/active/10-operaciones-rodeo/context-v2-seleccion.md` (Gate 0 v2, D1–D11 lockeadas — gana donde choque) → as-built de migraciones 0059–0083 → `specs/active/10-operaciones-rodeo/context.md` (Gate 0 original, sesión 18 — sigue válido para lo NO tocado por v2: vista de grupo, Inicio rodeo-céntrico, vacunación todo+filtro, skip-and-report, offline, 1-evento-por-animal en las ops de evento, filtro `status='active'`).
**Related**: spec 02 (rodeos, `rodeo_data_config`, tablas de evento, `management_groups`, RLS R11; Tier 2 categorías: 0059–0067; frontend C1 rodeos / C2 alta+lista / C3 ficha / C4 lotes — **DONE**), spec 03 (gating DB capa 2, 0054/0056), spec 09 (`AnimalRow`, find-or-create), spec 15 (PowerSync: sync streams JOIN-free `sync-streams/rafaq.yaml`, CRUD plano, denormalizaciones 0077–0080, ADR-026), chunk C6 de spec 02 (espejo de categorías — finding F1 `is_castrated`), ADR-018 (Inicio), ADR-020 (lote), ADR-021 (gating), ADR-019 (security gates), ADR-022 (Gate 0), ADR-025/026 (frontera de sync).

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". IDs estables: esta reconciliación **preserva los IDs ya asignados** (R1–R10); los requirements cuyo contenido cambió se reescribieron **bajo el mismo ID** con su traza (Gate 0 v2 o staleness); los grupos nuevos del Gate 0 v2 son R11 (selección explícita), R12 (`future_bull`) y R13 (castrado = estado + denormalización + recompute simétrico).

> **Las tres operaciones, en una línea.** **Vacunación masiva** = N `sanitary_events` (modelo "todo el grupo + filtro + preview + skip-and-report" del Gate 0 ORIGINAL — **no cambia**, D1). **Destete masivo** = pantalla de **selección explícita** (Gate 0 v2) → N `reproductive_events 'weaning'`; la categoría **transiciona sola** server-side (as-built 0062/0063). **Castración masiva** = pantalla de **selección explícita** → N **UPDATEs de estado** (`is_castrated = true`), **sin evento** (D10); el trigger 0064 (extendido a simétrico) transiciona la categoría.

> **Madurez por capa.** Lógica de aplicación / autorización / offline / idempotencia / delta backend (R3–R7, R9, R10, R12.1, R12.4, R13.3–R13.6): **firmes** — operan sobre el sustrato as-built de specs 02/03/15. UI (R1, R2, R8 no existe, R11, R12.2–R12.3, R13.1–R13.2): el **modelo de interacción está lockeado por Gate 0 v2** (secciones, defaults, CTA con número, bottom-sheet, copy reversible — NO se re-decide) pero la **estética fina** (tokens exactos, microcopy final, spacing) es **TENTATIVA** hasta el design system (ADR-023), mismo patrón que spec 02/09. Ya **no** quedan requirements pendientes de Facundo: los targets de destete y el efecto de castración se cerraron con él y están as-built (0059–0064).

---

## US-1 — Inicio rodeo-céntrico y vista de grupo

> Como productor/operario, quiero un Inicio que muestre mis rodeos y lotes y, al tocarlos, su configuración + sus animales + las acciones masivas, para gestionar el grupo entero sin escanear animal por animal. (context §Navegación; ADR-018)

> **TENTATIVA UI (estética)** — R1.x y R2.x describen el comportamiento funcional. Esta sección **realiza** el rol que ADR-018 ya le da a Inicio; **no** reabre ADR-018 ni cambia la estructura de tabs. *(Staleness: las dependencias "frontend en vuelo" de la versión anterior quedaron viejas — los chunks C1 rodeos, C2 alta+lista, C3 ficha y C4 lotes de spec 02 están **DONE**; la vista de grupo se construye SOBRE ese as-built, no en paralelo.)*

**R1.1** El sistema deberá exponer una **vista de grupo** que muestre, para un grupo dado (un `rodeo` o un `management_group` del establecimiento activo): el nombre y metadatos del grupo, su configuración de datos (`rodeo_data_config`) cuando aplique, la lista de sus animales **activos**, y las **acciones masivas** disponibles. (context §Navegación)

**R1.2** La vista de grupo deberá listar los animales reusando el componente **`AnimalRow`** (as-built, `app/src/components/AnimalRow.tsx`, tab Animales de spec 09) y los services as-built de rodeos/animales (`rodeos.ts`, `animals.ts`, `rodeo-config.ts`); **no** deberá redefinir un componente de lista ni un servicio de rodeo propios. *(Staleness: el nombre de la versión anterior, `AnimalListItem`, no existe as-built — el componente real es `AnimalRow`.)*

**R1.3** Mientras se renderiza la lista de animales de un grupo, el sistema deberá incluir **solo** animales con `status = 'active'` y `deleted_at IS NULL` (consistente con spec 09 R1.5 y spec 02 R4.12). Los archivados/baja/soft-deleted no deberán aparecer en ninguna lista candidata de operación masiva.

**R1.4** El sistema deberá ofrecer en la vista de grupo, como mucho, las **tres acciones masivas del MVP**: **vacunación masiva** (eventos), **destete masivo** (eventos, selección explícita) y **castración masiva** (edición de estado, selección explícita). No deberá ofrecer otras operaciones masivas (sangrado, raspado, pesaje, condición corporal masivos quedan fuera de MVP — context §Alcance). Los botones de castrar/destetar deberán usar el **verbo pelado** ("Castrar", "Destetar"), sin "todos". (Gate 0 v2 D1)

**R1.5** Cuando el grupo es un `rodeo`, el sistema deberá ofrecer la vacunación masiva **solo si** `vacunacion` está `enabled = true` y el destete masivo **solo si** `destete` está `enabled = true` en el `rodeo_data_config` de ese rodeo (gating UI capa 1, mismo mapeo que spec 03 R5.4). La **castración masiva no se gatea por `rodeo_data_config`**: no existe (ni se crea) un data_key `castracion` — castrado es un atributo base del animal (0060), no un dato configurable del rodeo. (Gate 0 v2 §Implicancias: el data_key `castracion` se eliminó de esta spec)

**R1.6** Si una operación masiva gateada (vacunación, destete) tiene su `data_key` requerido `enabled = false` en el `rodeo_data_config` del rodeo, entonces el sistema **no deberá** ofrecer esa operación para ese rodeo. (context §Gating)

> **Reconciliación gating-por-candidatos (fix Raf 2026-06-12, as-built — ver design §3.4).** Además del gating de CONFIG (R1.5/R1.6), una acción NO se ofrece si no hay **candidatos** a quienes aplicarla (evita abrir una pantalla de selección vacía): **Destetar** requiere ≥1 ternero/a sin destete; **Castrar** requiere ≥1 macho entero candidato; **Vacunar** no cambia (aplica a todos los activos → si hay animales, hay candidatos; sigue gateada solo por config). Es ortogonal a R1.5 (que sigue valiendo: la castración no se gatea por `rodeo_data_config`) — solo se le suma el requisito de presencia de candidatos.

**R2.1** El sistema deberá mostrar en **Inicio** las **cards de rodeo** del establecimiento activo (nombre, sistema, cabezas y al menos una métrica clave o señal de atención) y, como grupos secundarios, las **cards de lote** (`management_groups`) activos del establecimiento. (context §Navegación; ADR-018)

**R2.2** Cuando el usuario toca una card de rodeo o de lote en Inicio, el sistema deberá navegar a la **vista de grupo** (R1.1) del grupo correspondiente. (context §Navegación)

**R2.3** El sistema **no deberá** modificar la tab `Animales` (lupa + lista + filtros de spec 09): la gestión de grupos vive en Inicio, la búsqueda de un animal vive en `Animales`. (context §Navegación)

---

## US-2 — Las tres operaciones masivas (MVP)

> Como operario de campo, quiero aplicar la operación a los animales del grupo de una, generando una mutación individual por animal. (context §Las 3 operaciones; Gate 0 v2 D1/D10)

**R3.1** El sistema deberá soportar **vacunación masiva**: generar **un** `sanitary_events` (`event_type = 'vaccination'`) **por animal** del conjunto seleccionado, con `product_name` (y demás parámetros) tomados de la pre-config de la operación, reusando `sanitary_events` (0026). La tabla `sanitary_campaigns` **no existe as-built** — `campaign_id` queda `NULL` (ver design §2.2); este modelo **no cambia** en esta reconciliación. Requiere `vacunacion` enabled en el rodeo del animal (capa 1 R1.5 + capa 2 DB R7.3). (context §Vacunación masiva — sin cambios de modelo, Gate 0 v2 D1)

**R3.2** El sistema deberá soportar **destete masivo**: generar **un** `reproductive_events` (`event_type = 'weaning'`) **por ternero/a** seleccionado en la pantalla de selección explícita (R11). Requiere `destete` enabled en el rodeo del animal (gating capa 1; ver R7.3 para el límite as-built de la capa DB). (context §Destete masivo + Gate 0 v2 D1/D4)

**R3.3** El sistema deberá soportar **castración masiva** como **edición masiva de estado, sin evento**: por cada animal seleccionado (R11), **un UPDATE** que setea `is_castrated = true` (y `future_bull = false`, R12.4) sobre su perfil activo. **No** deberá crear ningún evento sanitario, marcador (`product_name='Castración'`) ni registro "castración" — el modelo de evento-marker de la versión anterior queda **ELIMINADO** (Gate 0 v2 D10 + §Implicancias). Además del UPDATE, la masiva deberá crear **una observación automática por animal** (R13.7): N UPDATEs + N observaciones. La transición de categoría la aplica el trigger de DB as-built (0064, extendido a simétrico — R13.5); **cuando la castración produce transición** (`torito→novillito`, `toro→novillo`), la historia queda además en `animal_category_history` (visible en el timeline como cambio de categoría). En **`ternero`** — justamente el caso pre-tildado por default en la masiva (R11.3) — la castración **no transiciona** y no deja fila de history; el **rastro atribuible existe igual** vía la observación automática de R13.7 (autor + fecha en el timeline). *(LIM-1 MITIGADA por decisión de Raf en Puerta 1 2026-06-11, ver §Limitaciones explícitas; prosa previamente corregida por Gate 1 v2 M2.)*

**R3.4** El sistema deberá modelar cada operación masiva como **N mutaciones individuales** (una por animal: N inserts de evento en vacunación/destete, N updates de estado en castración), **no** como un único evento/registro colectivo ni un RPC bulk. (context §Selección "Un evento por animal"; Gate 0 v2 §Implicancias 4)

**R3.5** Cuando un animal es **mellizo** o comparte parto con otro, el destete masivo deberá generar **un evento de destete por cada ternero seleccionado** (se desteta el ternero, no el parto). (context §Selección)

**R5.5** Cuando se crea un evento `weaning` (individual o por destete masivo), el sistema (capa DB as-built) deberá **transicionar la categoría del ternero automáticamente**: el trigger `reproductive_events_apply_transition` (0063) delega en `compute_category` (0062), que con destete cargado da `ternera → vaquillona` y `ternero → torito` (o `novillito` si `is_castrated = true`), salvo `category_override = true` (R5.6). El cliente **no** deberá aplicar la transición por su cuenta (la DB es la fuente de verdad; el espejo C6 la refleja offline, R10.6). *(Staleness: la versión anterior decía "el evento se persiste y la categoría NO transiciona — pendiente de Facundo"; eso es **FALSO as-built**: los targets se cerraron con Facundo el 2026-06-03 y están implementados en 0062/0063. Confirmado por Raf en el Gate 0 v2, D4.)*

**R5.7** El sistema deberá tratar el **efecto de categoría de la castración** como **definido y as-built** (ya NO pendiente de Facundo): `torito → novillito` y `toro → novillo`, con corte de 2 años (≥730 días) entre novillito y novillo, según `compute_category` (0062) + el seed de categorías (0059) + el trigger de transición (0064). En `ternero` el efecto se difiere al destete (0064/RT2.2.2: `compute_category` sigue dando `ternero` hasta destete o 1 año). El delta de esta spec sobre ese sustrato es únicamente el **recompute simétrico** del revert (R13.5). *(Staleness: la versión anterior lo marcaba TENTATIVO pendiente de Facundo; resuelto en sesión Tier 2, migraciones 0059/0062/0064.)*

> **DIFERIDO explícito (fuera de MVP, sin cambios).** Cualquier **marca en la madre** al destetar queda fuera del MVP de esta spec. Nota as-built: el sustrato Tier 2 ya mantiene `animal_profiles.nursing` en la madre vía trigger (0061/0067) — eso es de spec 02, no de esta spec; esta spec **no** agrega nada sobre la madre.

---

## US-3 — Vacunación masiva: alcance, preview y skip-and-report (modelo Gate 0 original — sin cambios)

> Como operario, quiero vacunar todo el grupo (o un subconjunto filtrado), ver un preview y confirmar, sabiendo qué animales se saltan y por qué. (context §Selección; Gate 0 v2 D1: "Vacunación NO cambia")

**R4.1** Para la **vacunación masiva**, el sistema deberá usar como conjunto candidato por **default = todos los animales activos del grupo** (R1.3), y deberá permitir un **filtro opcional** por **categoría** y/o **sexo**. Para castración y destete este modelo **no aplica**: usan la pantalla de selección explícita (R11). (context §Selección; Gate 0 v2 D1)

> **AS-BUILT (2026-06-14, delta vía-intranasal):** la **vía** de la vacunación (opcional, `sanitary_events.route`) se restringe en la UI a **3 vías curadas** — **Subcutánea · Intramuscular · Intranasal** — porque son las únicas vías reales de vacuna bovina (tópica = pour-on antiparasitario; oral = irrelevante en vacuna; "otra" innecesaria). El enum `public.sanitary_route` conserva los 6 valores (delta: la migración 0090 agrega `intranasal`) para otros sanitary_events (desparasitación/tratamiento); solo se cura la lista *ofrecida* en el contexto vacunación. (Decisión de producto cerrada con Raf; sub-detalle del pre-config — no abre un EARS propio, igual que la vía no lo tenía en el fix VIA-ENUM-MISMATCH.)

**R4.2** Antes de aplicar la vacunación masiva, el sistema deberá mostrar un **preview obligatorio** ("vas a crear N eventos sobre N animales, uno por animal") y deberá requerir una **confirmación explícita**. (context §Selección)

**R4.3** El sistema deberá excluir del conjunto a aplicar (**skip-and-report**) y reportar al operario, agrupados por motivo, los animales que no aplican a la vacunación masiva:
- ya tienen el evento aplicado según el criterio de idempotencia (R6.1);
- su **rodeo no tiene** `vacunacion` habilitado (R7.2, caso lote cross-rodeo).
En castración/destete la no-aplicabilidad se resuelve **por construcción de la lista de selección** (R11.2/R11.4: los ya castrados / ya destetados / de sexo-categoría incompatible directamente no aparecen como candidatos). (context §Selección skip-and-report)

**R4.4** El sistema **no deberá** crear una mutación sobre un animal saltado/excluido; la operación sobre el resto del conjunto deberá proceder normalmente (un salteado no bloquea a los demás). (context §Selección)

**R4.5** El sistema deberá garantizar que cada mutación de una operación masiva queda **individualmente corregible**: los eventos (vacunación/destete) por el owner o el autor, sin ventana, reusando la corrección de eventos tipados de spec 02 (R6.8.1 — editar/soft-deletear recalcula la categoría si correspondía); la castración, **animal por animal desde la ficha** vía el estado editable "Castrado Sí/No" (R13.1) — **sin undo masivo** (consistente con spec 03 D2 "sin reversión de jornada"). (context §Selección; Gate 0 v2 D10)

**R5.6** Cuando una operación que transiciona categoría (destete R5.5, castración R5.7/R13.5) incluiría un animal con `category_override = true`, el sistema **no deberá** pisar su categoría (el override manda, spec 02 R4.9; los triggers 0063/0064 as-built ya lo respetan). La confirmación (preview de vacunación no aplica; **bottom-sheet** de castrar/destetar, R11.8) deberá **avisar** ("N animales tienen categoría fijada manualmente y no van a cambiar de categoría") y deberá **ofrecer revertir el override** (patrón as-built del chunk C6: revert con recálculo en un solo statement) para incluirlos en la transición. La mutación principal (evento weaning / update is_castrated) **igual se aplica** al animal con override — el override solo bloquea la categoría. (context §Selección, decisión Raf s18)

---

## US-4 — Gating sobre lotes cross-rodeo

> Como sistema, quiero ofrecer una operación masiva sobre un lote que junta animales de rodeos con configs distintas, aplicándola solo donde corresponde. (context §Gating)

**R7.1** Cuando el grupo es un `management_group` (cross-rodeo posible), el sistema deberá ofrecer una operación masiva **gateada** (vacunación, destete) si **algún** rodeo representado en el lote tiene su `data_key` `enabled = true`. La castración se ofrece siempre (R1.5). (context §Gating)

**R7.2** Cuando se aplica vacunación masiva sobre un lote cross-rodeo, el sistema deberá **saltar (skip-and-report, R4.3)** los animales cuyo **rodeo real** (`animal_profiles.rodeo_id`) no tenga `vacunacion` `enabled = true`. Cuando se abre la **selección de destete** sobre un lote cross-rodeo, el sistema deberá **excluir de la lista de candidatos** los terneros cuyo rodeo real no tenga `destete` `enabled = true`, indicando cuántos quedaron excluidos por configuración del rodeo (equivalente del skip-and-report en el modelo de selección — criterio del autor, **validado por Raf en Puerta 1 2026-06-11**). (context §Gating)

**R7.3** El sistema deberá apoyarse en el gating **DB capa 2 as-built tal cual es**, sin extenderlo: cada `sanitary_events 'vaccination'` pasa por `tg_sanitary_events_gating` → `assert_data_keys_enabled(['vacunacion'])` (0054, fail-closed, tenant-safe, EXECUTE revocado). **Límite documentado**: el trigger de `reproductive_events` (0054) **no gatea `weaning`** as-built (solo tacto/tacto_vaquillona/service-ai) — el gating de destete es **solo capa 1** (UI), decisión as-built de spec 03 que esta spec **no** reabre. La castración no tiene gating DB (no es dato gateable; es estado del animal). La **rama de gating `castracion` de la versión anterior queda ELIMINADA** — no se modifica `tg_sanitary_events_gating`. *(Staleness + Gate 0 v2 §Implicancias: la versión anterior afirmaba "la capa DB valida por animal" para las 3 ops; as-built solo vacunación tiene rama. Corregido a la verdad.)*

---

## US-5 — Idempotencia y no-duplicación

> Como sistema offline-first donde un re-intento de sync puede reejecutar mutaciones, quiero que una operación masiva no genere duplicados. (context §Offline-first)

**R6.1** Para las operaciones **de evento** (vacunación, destete), el sistema deberá tratar cada evento como **idempotente por animal + tipo de operación + fecha de la operación**, con **dos barreras** (ambas firmes, design §7): (1) exclusión local de animales ya procesados (R6.2); (2) **`id` (PK) determinístico OBLIGATORIO** — UUIDv5 sobre un namespace fijo + `(animal_profile_id, tipo, fecha)` — de modo que dos syncs concurrentes del mismo evento lógico colisionen en la PK y no dupliquen. Para la **castración**, la idempotencia es **semántica**: `is_castrated = true` es un estado absoluto — re-aplicar el mismo UPDATE es un no-op por valor (y los ya castrados ni siquiera son candidatos, R11.2); no requiere id determinístico. (context §Offline-first; M2 Gate 1 s21, conservado para las ops de evento)

**R6.2** El armado del conjunto deberá **excluir de entrada** a los animales que ya tienen la operación aplicada — en vacunación vía skip `already_applied` (R4.3); en destete/castración por construcción de la lista de candidatos (R11.2/R11.4) — de modo que el preview/CTA refleje el conteo real de mutaciones nuevas. (context §Selección)

**R6.3** Si una operación masiva se ejecuta dos veces (el operario la repite, o un re-intento de sync la reejecuta), entonces el sistema **no deberá** producir eventos duplicados ni transiciones espurias: la segunda ejecución deberá excluir a los ya procesados, y los triggers as-built (0063/0064) solo transicionan cuando la categoría target difiere de la actual. (context §Offline-first)

---

## US-6 — Offline-first y sincronización por animal

> Como peón sin señal, quiero armar y aplicar la operación masiva offline y que sincronice después, viendo qué se sincronizó y qué falló por animal. (context §Offline-first)

**R10.1** El sistema deberá permitir armar el conjunto, ver el preview/selección y **aplicar** la operación masiva **sin conexión**: las N mutaciones se escriben en la copia local (PowerSync/SQLite, CRUD plano — patrón as-built validado en feature 15, `runLocalWrite`) y se encolan para subir después. Las tablas tocadas están **todas dentro del sync set** (`ev_sanitary_events`, `ev_reproductive_events`, `est_animal_profiles` — `sync-streams/rafaq.yaml`); la castración escribe `animal_profiles.is_castrated` denormalizado (R13.3), **nunca** la tabla `animals` (fuera del sync set, ADR-026 b1). (context §Offline-first; Gate 0 v2 §Implicancias 4)

**R10.2** El sistema deberá tratar las N mutaciones como **independientes, no como transacción atómica todo-o-nada**: si la sincronización falla a mitad, las que entraron quedan persistidas y las que fallan se reportan; no deberá hacer rollback de las exitosas. (context §Offline-first)

**R10.3** Si una mutación de una operación masiva es **rechazada al sincronizar** (gating capa 2, RLS, race), entonces el sistema deberá **hacerlo visible al operario por animal** (no descartarlo en silencio), reusando el canal de status/error de upload as-built de spec 15 (uploadData descarta el rechazo permanente + lo superficia), e indicando el motivo. (context §Offline-first; as-built spec 15 R8.1)

**R10.4** El sistema deberá mostrar un **contador "X de N sincronizados"** por operación masiva, reflejando cuántas de las N mutaciones subieron y cuántas quedan pendientes o fallaron. (context §Offline-first)

**R10.5** El sistema deberá manejar el **volumen** de un rodeo grande (cientos a miles de animales): la generación y el encolado de las N mutaciones locales deberán resolverse por **batching/encolado** sin bloquear la UI, según design §7. (context §Offline-first)

**R10.6** Mientras el dispositivo está offline, el sistema deberá mostrar la **transición de categoría resultante** de una castración o destete recién aplicados usando el **espejo client-side de `compute_category`** (chunk C6 de spec 02) alimentado con el **`is_castrated` real** denormalizado (R13.6) y los eventos locales — sin esperar el recálculo server-side ni el sync-down. (Gate 0 v2 §Implicancias 2 — cierra el finding F1 de C6; reduce el gap "transiciones no visibles offline" de `docs/backlog.md` para estos flujos)

---

## US-7 — Roles, multi-tenant y seguridad

> Como producto multi-tenant con datos regulados (SENASA), quiero que la operación masiva no abra superficie de autorización nueva ni exponga datos cross-tenant. (ADR-019)

**R9.1** El sistema deberá permitir disparar cada operación masiva a **exactamente los mismos roles** que pueden ejecutar la mutación individual equivalente: vacunación/destete = los roles que insertan ese evento individual (spec 02 R11.5: cualquier rol activo del establishment); castración = los roles que pueden editar el animal/perfil (policy `animal_profiles_update` as-built — cualquier rol activo; mismo poder que ya da el as-built de `animals_update`, 0022/0071). **No** se introduce restricción ni superficie de autorización distinta. (context §Roles; Gate 0 v2 D10)

**R9.2** El sistema deberá hacer cumplir el aislamiento multi-tenant **por animal** en cada una de las N mutaciones: cada insert de evento pasa por la RLS canónica de su tabla (spec 02 R11.1/R11.2) y cada update de castración por la RLS de `animal_profiles` (`has_role_in(establishment_id)`). La operación masiva **no** deberá poder mutar animales de un establecimiento donde el usuario no tiene rol activo. La nuance del **animal compartido** entre campos (global, ADR-004) se documenta en design §5 — el write-through de castración no agrega poder que el as-built no diera ya (0071). (ADR-019)

**R9.3** Para las operaciones **de evento**, el sistema deberá registrar `created_by` vía el trigger as-built `tg_set_created_by_auth_uid` (0024, "solo si NULL"): defaultea a `auth.uid()` cuando el cliente lo omite (la op masiva no lo envía), **spoofeable intra-tenant** — condición sistémica pre-existente SEC-SPEC-03, **heredada**, no introducida (no cross-tenant; fix transversal backlogged, design §9). Para la castración (UPDATE de estado) no hay `created_by`; la autoría del cambio queda implícita en `animal_category_history` (transición `auto_transition`). (H2 Gate 1 s21, conservado)

**R9.4** El sistema **no deberá** introducir ninguna política RLS nueva, Edge Function nueva, ni RPC invocable por clientes nueva. El **delta backend completo** de esta spec es (design §4): (a) columna `animal_profiles.future_bull` + su trigger de normalización; (b) columna denormalizada `animal_profiles.is_castrated` + backfill + trigger force-on-INSERT + propagación `animals → profiles` + **write-through** `profiles → animals` (estilo 0079); (c) reemplazo del cuerpo de `tg_animals_apply_castration` (0064) para el recompute **simétrico**. Toda función de trigger nueva deberá ser `SECURITY DEFINER` con `set search_path = public` y `revoke execute from public, authenticated, anon` (patrón 0055/0079). El delta de la versión anterior (data_key `castracion` + rama de gating + marcador) queda **ELIMINADO** — no se toca `tg_sanitary_events_gating` ni el catálogo. *(Gate 0 v2 §Implicancias 1–3.)*

---

## US-8 — Pantalla de selección explícita (castrar / destetar) — Gate 0 v2

> Como productor, quiero elegir explícitamente qué animales castrar/destetar tildándolos en una lista, con defaults inteligentes que protegen a mis futuros toritos, en vez de una masiva "todos" que asusta. (Gate 0 v2 D1, D3, D4, D6–D9, D11 — modelo de interacción LOCKEADO; estética fina TENTATIVA hasta design system)

**R11.1** Cuando el usuario toca "Castrar" o "Destetar" en la vista de grupo, el sistema deberá abrir una **pantalla de selección** con **checkbox por animal**; la operación se aplica **solo** a los animales tildados. (D1)

**R11.2** La lista de candidatos de **castración** deberá incluir **todos los machos activos no castrados** del grupo (terneros + adultos: `ternero`, `torito`, `toro`; `is_castrated = false`), y **excluir** hembras y ya castrados. (D3)

**R11.3** Al abrir la selección de castración, el sistema deberá **pre-tildar solo los terneros comunes** (categoría `ternero` con `future_bull = false`); los terneros marcados ⭐ futuro torito y **todos los adultos** deberán arrancar **sin tildar**. (D3, D6)

**R11.4** La lista de candidatos de **destete** deberá incluir los **terneros/as activos** del grupo (categorías `ternero`/`ternera`, ambos sexos) **sin destete previo** (sin `weaning` no borrado), y deberá **pre-tildarlos a todos**. El marcador ⭐ **no deberá** generar aviso ni resaltado en destete. (D4, R11.10 foldeado acá)

**R11.5** La pantalla de selección deberá agrupar los candidatos en **secciones por categoría** (castración: Terneros arriba, Adultos abajo), con control **"todos/ninguno" por sección** y un **contador vivo** de seleccionados en el header. (D6)

**R11.6** Cuando el usuario tilda un animal con `future_bull = true` en la selección de **castración**, el sistema deberá **resaltar la fila** (estado de advertencia, terracota — token final TENTATIVO) **sin interponer ningún modal**; la advertencia agregada ("⚠ N futuros toritos incluidos") deberá aparecer recién en la confirmación (R11.8). Una sola confirmación en todo el flujo. (D7)

**R11.7** La pantalla de selección deberá tener un **CTA fijo abajo con el número en vivo** ("CASTRAR 12 ANIMALES" / "DESTETAR N ANIMALES"), **deshabilitado** cuando la selección es 0. (D8)

**R11.8** Cuando el usuario toca el CTA, el sistema deberá mostrar la confirmación como **bottom-sheet sobre la misma pantalla** con: desglose de la selección **por categoría**, la advertencia "⚠ N futuros toritos incluidos" cuando aplique (castración), el aviso de override cuando aplique (R5.6), y acciones CONFIRMAR / Volver. El copy deberá comunicar **reversibilidad** ("Podés corregirlo después desde la ficha de cada animal") y **no deberá** usar lenguaje amenazante tipo "esta acción no se puede deshacer". (D9 — decisión explícita de Raf sobre el copy)

**R11.9** Cada fila de la selección deberá ser la **versión compacta de `AnimalRow`** (glifo de sexo + identificador hero + categoría · edad + badge ⭐ cuando `future_bull`) con **checkbox**, fila entera tappeable con target **≥56px**; orden **por identificador** dentro de cada sección; con **búsqueda arriba solo si** la lista supera ~20 animales (mismo patrón que "Mis campos" >8). (D11)

---

## US-9 — Flag "futuro torito" (`future_bull`) — Gate 0 v2

> Como productor de cría, ya de terneros sé cuáles van a ser mis toritos; quiero marcarlos para que la castración masiva no me los lleve puestos. (Gate 0 v2 D2)

**R12.1** El sistema deberá persistir el flag en **`animal_profiles.future_bull`** (`boolean not null default false`): es una **decisión de manejo del campo** — vive en el perfil (per-establishment) y **no viaja** en venta/transferencia (un perfil nuevo en otro campo arranca `false` por default). Deberá aplicar **solo a machos**: la capa DB deberá impedir/normalizar `future_bull = true` sobre un animal no-macho (enforcement por trigger contra `animal_sex` denormalizado — design §4.1). (D2)

**R12.2** El sistema deberá permitir marcar/desmarcar `future_bull` **solo desde la ficha del animal** (toggle, MVP); **no** deberá ofrecerse en el alta. (D2)

**R12.3** El sistema deberá mostrar el badge ⭐ futuro torito **solo cuando es positivo** (en la ficha y en la fila del animal), y deberá **ocultarlo cuando la categoría del animal ya es `toro`** (el flag cumplió su ciclo). (D2)

**R12.4** Cuando un animal se castra (individual desde la ficha o por masiva), el sistema deberá **auto-limpiar** `future_bull → false`: el cliente lo setea en la **misma mutación** del UPDATE de castración, y la capa DB lo garantiza igual server-side (trigger de normalización: `is_castrated = true ⇒ future_bull = false` — defensa en profundidad si el UPDATE llega por otro camino). (D2)

---

## US-10 — Castrado = estado editable + denormalización + recompute simétrico — Gate 0 v2

> Como productor que se equivocó en una masiva, quiero corregir "castrado" desde la ficha del animal y que la categoría se recalcule sola, sin eventos fantasma ni "descastrar". (Gate 0 v2 D10)

**R13.1** El sistema deberá exponer en la **ficha del animal** el estado **"Castrado Sí/No" como campo editable** (solo machos), con una **confirmación que anticipe el recálculo de categoría** (p. ej. "La categoría se recalcula: Novillito → Torito" — el target previsto se deriva del espejo C6 local). (D10)

**R13.2** El sistema **no deberá** crear ningún evento **tipado** por castrar/des-castrar (D10 firme). Una sola fuente de verdad del estado: `is_castrated`. La atribución queda cubierta en **dos capas**: (a) la **observación automática** (R13.7) que acompaña cada flip — autor + fecha en el timeline, en **todos** los casos, incluido `ternero`; (b) `animal_category_history` (origen de la cronología as-built, RPC `animal_timeline`) **solo cuando el flip produce transición de categoría** (`torito↔novillito`, `toro↔novillo`) — en `ternero` no hay fila de history hasta el destete, donde el `changed_by` será el de quien cargue el `weaning`, no el de quien castró (la observación de R13.7 es la que preserva al autor real del flip). *(LIM-1 MITIGADA — decisión de Raf en Puerta 1 2026-06-11; prosa previamente corregida por Gate 1 v2 M2.)* (D10)

**R13.3** El sistema deberá **denormalizar `is_castrated` sobre `animal_profiles`** (columna `boolean not null default false`), mantenida **fiel a `animals`** (la fuente de verdad física, 0060) con el patrón as-built 0079: **backfill** de los perfiles existentes + **force en INSERT** del perfil (copia desde `animals`, anti-spoof del alta) + **propagación** `animals → todos los perfiles` en cada cambio (guard `IS DISTINCT FROM`, sin loops). Razón: `animals` está **fuera del sync set** (ADR-026 b1) — sin la denorm, ni la castración offline ni el espejo C6 tienen el dato. (Gate 0 v2 §Implicancias 2; cierra el finding F1 de `design-c6-categoria-espejo.md` §7)

**R13.4** Cuando un cliente actualiza `animal_profiles.is_castrated` (el **único write-path de castración de la app**, offline-friendly porque `animal_profiles` sincroniza), el sistema deberá hacer **write-through a `animals.is_castrated`** server-side (trigger AFTER UPDATE OF `is_castrated`, guard `IS DISTINCT FROM` para cortar el ciclo con la propagación de R13.3). A diferencia de la identidad (0079), `is_castrated` **no se fuerza en UPDATE**: es un atributo **editable por diseño** (0060: "el toggle castrado/entero debe poder corregirse") y el poder de escribirlo ya existe as-built vía `animals_update` (0071) — el write-through no escala privilegios. (design §4.2)

**R13.5** Cuando `animals.is_castrated` cambia **en cualquier dirección**, el sistema deberá **recalcular la categoría** del perfil activo (delegando en `compute_category`, respetando `category_override`): el trigger as-built `tg_animals_apply_castration` (0064) **solo actúa en `false → true`** (guard explícito líneas 28–31; el header 0064/RT2.2.6 dice "true→false NO revierte") — esta spec lo **reemplaza** para actuar ante `OLD.is_castrated IS DISTINCT FROM NEW.is_castrated`, cubriendo el revert (`novillito → torito`, `novillo → toro`). El resto del cuerpo (perfil activo único, respeto de override, `apply_auto_transition` + history) se conserva idéntico. *(Gate 0 v2 D10 supersede RT2.2.6 de spec 02 Tier 2 — requiere nota de reconciliación en esa spec, coordinación del leader.)*

**R13.6** El sistema deberá alimentar el **espejo C6** (`computeCategoryCode`) con el **`is_castrated` real** leído de `animal_profiles` local, reemplazando la inferencia por categoría (`RC6.2.1`, que era un workaround explícito hasta esta denorm). (Gate 0 v2 §Implicancias 2; design-c6 §7 F1)

**R13.7** Cuando un cambio de `is_castrated` se aplica desde la app (masiva R3.3 o toggle de ficha R13.1), el sistema deberá crear **client-side, junto al UPDATE**, una **observación automática** en el timeline del animal: INSERT en `animal_events` con `event_type = 'observacion'` (Modelo Híbrido as-built 0034, **sin gating** — no es dato configurable), reusando el camino as-built de `addObservation` (`events.ts`): INSERT plano encolado (offline-safe, patrón spec 15), `establishment_id` derivado del **perfil** (trigger de validación 0034), `author_id` omitido en el INSERT → el trigger server-side lo setea a `auth.uid()` del que sube (= usuario actual, mismo comportamiento que una observación manual). Copy es-AR propuesto (funcional, ajuste menor de microcopy permitido): **"Castrado"** al castrar y **"Corrección: marcado como no castrado"** al revertir — el revert **también** deja observación (simetría). En la masiva son **N observaciones + N UPDATEs** (2 CrudEntries por animal); desde la ficha, 1+1. La observación y el UPDATE son mutaciones **independientes** (R10.2, sin atomicidad — residual aceptado, design §3.5). **No** es un evento tipado CASTRAR (D10 firme — es la observación genérica que ya existe). (Decisión de Raf, Puerta 1 2026-06-11 — mitiga LIM-1)

---

## Limitaciones explícitas — estado post-Puerta 1 (decididas por Raf, 2026-06-11)

Gaps que el Gate 1 v2 superficó y que Raf resolvió explícitamente al aprobar la Puerta 1 (2026-06-11). Se preserva la redacción original de cada gap como traza; el estado vigente es el del encabezado de cada ítem.

1. **LIM-1 (Gate 1 v2 M2) — ✅ MITIGADA (Puerta 1, 2026-06-11): observación automática al castrar/revertir → R13.7.** *Gap original:* castrar/revertir un `ternero` no dejaba NINGÚN rastro atribuible hasta el destete — el history solo se escribe cuando cambia `category_id` (0030) y en `ternero` la castración no transiciona (0062: sigue `ternero` hasta destete/1 año), así que el flip de `is_castrated` no generaba fila de history, ni evento, ni autor, ni entrada de timeline — solo `updated_at` del perfil, sin `created_by`; y `ternero` es **el caso default pre-tildado** de la masiva (R11.3). *Decisión de Raf:* registrar el flip como **observación automática** en `animal_events` (la "mínima señal posible" que este ítem ofrecía), client-side junto a cada UPDATE, con autor y simetría en el revert — especificada en R13.7 + design §3.5. D10 **no** se reabre (sigue sin evento tipado; la fuente de verdad del estado sigue siendo `is_castrated`). *Residual aceptado:* observación y UPDATE son CrudEntries independientes (sin atomicidad, R10.2) — un rechazo asimétrico de sync puede dejar flip sin observación o viceversa (visible vía R10.3).
2. **LIM-2 (Gate 1 v2 M1) — ✅ RESUELTA (Puerta 1, 2026-06-11): la propagación TOLERA Y SALTEA perfiles con rodeo muerto.** *Gap original:* los checks always-on de 0021 disparan en cada UPDATE de la cadena; `rodeo_check` exige rodeo activo y no soft-deleted → en un animal compartido/transferido con un perfil viejo cuyo rodeo fue desactivado/borrado, la castración entera de ese animal **abortaba fail-closed** (la propagación raiseaba y volteaba toda la cadena, incluido el perfil propio). *Decisión de Raf:* la propagación **no aborta**: aplica en el perfil propio (y en todo perfil con rodeo vivo) y **saltea** los perfiles huérfanos, vía **pre-filtro** en el trigger de propagación que espeja el predicado exacto de `rodeo_check` (design §4.2(4) — mecanismo y justificación vs manejo de excepción). *Inconsistencia aceptada:* el perfil huérfano queda con `is_castrated` (y `future_bull`) stale hasta el próximo cambio de `is_castrated` del animal con su rodeo ya vivo (la propagación re-corre con guard `IS DISTINCT FROM` — sin job de reconciliación activa). Visibilidad: `RAISE LOG` server-side por animal salteado (design §4.2(4)); **sin** skip-report en la UI de la masiva — el perfil huérfano es típicamente de **otro** establecimiento (animal compartido, ADR-004) y reportarlo al operario filtraría información cross-tenant; además el UPDATE del cliente ya tuvo éxito (no hay canal de error que activar). El UPDATE directo del **perfil propio** sigue sujeto a `rodeo_check` fail-closed (caso prácticamente inalcanzable desde la masiva: los candidatos salen de la vista de un grupo activo). ⚠ Este delta cambia el trigger de propagación → **re-chequeo puntual de Gate 1** (lo lanza el leader).

---

## Criterios de aceptación globales

Esta spec se considera implementada cuando:

- Inicio muestra cards de rodeo + lote del establecimiento activo; tocar una abre la vista de grupo (config + animales activos vía `AnimalRow` + acciones masivas: Vacunar gated por `vacunacion`, Destetar gated por `destete`, Castrar siempre). La tab `Animales` queda intacta.
- **Vacunación masiva** (modelo todo+filtro+preview+skip-report, sin cambios): N `sanitary_events 'vaccination'` con `campaign_id NULL`, idempotentes (UUIDv5 + skip), gateadas por animal en DB (0054).
- **Castrar/Destetar** abren la **pantalla de selección explícita**: secciones por categoría, defaults correctos (castración: solo terneros comunes pre-tildados; destete: todos los terneros/as), todos/ninguno por sección, contador vivo, fila = `AnimalRow` compacto con checkbox ≥56px, búsqueda solo si >~20, ⭐ resalta sin modal (solo castración), CTA con número en vivo deshabilitado en 0, bottom-sheet de confirmación con desglose por categoría + ⚠ futuros toritos + copy REVERSIBLE (nunca "no se puede deshacer").
- **Destete masivo**: N `weaning` (uno por ternero seleccionado, mellizos incluidos); la categoría transiciona sola server-side (0062/0063) y se ve offline vía el espejo C6.
- **Castración masiva**: N UPDATEs `animal_profiles.is_castrated = true` + `future_bull = false` **+ N observaciones automáticas** ("Castrado", autor = usuario actual — R13.7) — **cero eventos tipados**; el write-through actualiza `animals`; 0064 (simétrico) transiciona `torito→novillito` / `toro→novillo`; cuando hay transición, la historia queda además en `animal_category_history`/timeline (en `ternero` no hay transición, pero la observación deja el rastro atribuible — LIM-1 mitigada).
- **Observación automática de castración** (R13.7): castrar (masiva o ficha) crea una observación "Castrado" con autor; revertir crea "Corrección: marcado como no castrado" (simetría); offline-safe; sin gating; sin evento tipado.
- **Propagación tolerante** (LIM-2 resuelta): castrar un animal con un perfil cuyo rodeo está inactivo/soft-deleted aplica en el perfil propio y los perfiles con rodeo vivo, saltea el huérfano (pre-filtro, design §4.2(4)) y lo deja en `RAISE LOG`; la cadena no aborta.
- **`future_bull`**: solo machos (DB lo garantiza), toggle solo en ficha, badge solo positivo y oculto en `toro`, auto-clear al castrar (cliente + DB).
- **Castrado reversible**: la ficha edita "Castrado Sí/No" con confirmación que anticipa el recálculo; el revert `true→false` recalcula la categoría (novillito→torito) vía 0064 extendido; sin evento, sin undo masivo.
- Animales con `category_override = true` no transicionan; el bottom-sheet lo avisa y ofrece revertir el override.
- Todo el flujo (armado + selección/preview + aplicar) funciona offline; N mutaciones independientes encoladas (CRUD plano); rechazos visibles por animal + contador "X de N"; sin rollback de exitosas; sin duplicados en re-intentos.
- Roles = los de la mutación individual equivalente; RLS impide mutaciones cross-tenant; el delta backend es exactamente el de R9.4 (sin RLS/EF/RPC nuevas; triggers SECURITY DEFINER revocados); **no** existe data_key `castracion` ni marcador `product_name='Castración'`.

---

## Cobertura de los context (cada decisión → ≥1 `R<n>`)

### context-v2-seleccion.md (Gate 0 v2 — gana donde choca)

| Decisión v2 | Requirements |
|---|---|
| D1 — selección explícita castrar/destetar; vacunación no cambia | R11.1, R1.4, R4.1, R3.1 |
| D2 — `future_bull` en `animal_profiles`, solo machos, ficha-only, badge solo-positivo/oculto-en-toro, auto-clear | R12.1, R12.2, R12.3, R12.4 |
| D3 — alcance castración: todos los machos no castrados; defaults protegen | R11.2, R11.3 |
| D4 — destete: pre-tildar todos los terneros/as; transición sola al crear weaning; ⭐ no avisa | R11.4, R5.5 |
| D6 — secciones por categoría + todos/ninguno + contador vivo | R11.5 |
| D7 — warning ⭐ sin modal (fila resaltada + resumen agrupado) | R11.6, R11.8 |
| D8 — CTA fijo con número en vivo, deshabilitado en 0 | R11.7 |
| D9 — bottom-sheet + copy reversible (nunca amenazante) | R11.8 |
| D10 — castrado = estado editable, no evento; historia vía category_history; sin undo masivo | R3.3, R13.1, R13.2, R4.5 |
| D11 — fila AnimalRow compacto + checkbox ≥56px; orden por ID; búsqueda >~20 | R11.9 |
| Implicancia 1 — eliminar data_key/gating/marker `castracion` | R3.3, R7.3, R9.4, R1.5 |
| Implicancia 2 — denormalizar `is_castrated` (cierra F1 de C6) | R13.3, R13.6, R10.6 |
| Implicancia 3 — recompute simétrico (revert recalcula) | R13.5 |
| Implicancia 4 — masiva offline = N UPDATEs CRUD plano | R3.4, R10.1 |

### Decisiones de Puerta 1 (Raf, 2026-06-11)

| Decisión | Requirements / design |
|---|---|
| LIM-1 → mitigar con observación automática (autor, simetría en revert) | R13.7, R3.3, R13.2, design §3.5 |
| LIM-2 → tolerar-y-saltear perfiles con rodeo muerto (pre-filtro) | design §4.2(4)/§6.1, T-DB.4(e), §Limitaciones LIM-2 |
| Criterios propios del autor (R7.2, R11.4, R5.6, D8 normalización silenciosa) | validados tal cual — sin cambios |

### context.md original (válido donde v2 no lo toca)

| Caso/Decisión | Requirements |
|---|---|
| §Navegación — Inicio rodeo-céntrico / tap card → vista de grupo / lotes secundarios / tab Animales intacta | R2.1, R2.2, R1.1, R7.1, R2.3 |
| §Las 3 ops — vacunación (`sanitary_events`, gating `vacunacion`) | R3.1, R1.5, R7.3 |
| §Las 3 ops — destete (`weaning`, transición) | R3.2, R5.5 |
| §Las 3 ops — castración (efecto de categoría) | R3.3, R5.7, R13.5 |
| §Selección — default todo + filtro (vacunación) / preview + confirmación | R4.1, R4.2 |
| §Selección — skip-and-report / no bloquea a los demás | R4.3, R4.4, R7.2 |
| §Selección — corregible individualmente | R4.5 |
| §Selección — 1 mutación por animal (mellizos por ternero) | R3.4, R3.5 |
| §Selección — candidatos `status='active'` | R1.3 |
| §Selección — `category_override`: aviso + revertir | R5.6 |
| §Gating — data_key enabled (capa 1) / lote cross-rodeo / capa DB | R1.5, R1.6, R7.1, R7.2, R7.3 |
| §Offline — N mutaciones encoladas / independientes / rechazos por animal + contador / sin duplicados | R10.1–R10.5, R6.1–R6.3 |
| §Roles — mismos roles que la mutación individual | R9.1 |
| §Pendientes — efecto categoría castración | **RESUELTO as-built** (0059/0062/0064) → R5.7 |
| §Pendientes — marca en la madre | DIFERIDO (nota US-2); `nursing` as-built es de spec 02 |
| §Pendientes — performance N mutaciones | R10.5 |

---

## Historial de refinamiento

- **2026-06-01 (sesión 21) — Redacción inicial** desde `context.md` (Gate 0 s18). Traducción a EARS; overrides del leader (roles; castración/destete TENTATIVOS pendientes de Facundo; marca-en-madre diferida); delta backend declarado = data_key `castracion`. *(Detalle completo en el historial git.)*

- **2026-06-01 (sesión 21) — Refinamiento por Gate 1 (FAIL: 2H+2M+1L)**: H1 nombre real `tg_sanitary_events_gating`; H2 `created_by` spoofeable intra-tenant (SEC-SPEC-03, heredado); M1 marcador canónico robusto a acento/caso; M2 id UUIDv5 obligatorio; L1 seed por `.code`. IDs preservados. *(H1/M1/L1 quedaron luego obsoletos al eliminarse el delta `castracion` — ver entrada siguiente; H2 y M2 siguen vigentes en R9.3 y R6.1.)*

- **2026-06-11 — RECONCILIACIÓN COMPLETA (Gate 0 v2 + staleness vs Tier 2 as-built).** Reescritura orgánica de los 3 archivos; IDs R1–R10 preservados; Puerta 1 y Gate 1 **reseteados**. Cambios:
  - **Por Gate 0 v2** (`context-v2-seleccion.md`, aprobado por Raf 2026-06-11): castrar/destetar pasan a **selección explícita** (nuevo grupo R11, D1/D3/D4/D6–D9/D11); **castración = estado editable, NO evento** (R3.3 reescrita; R4.5/R13.1/R13.2; se eliminan data_key `castracion`, rama de gating y marcador — R7.3/R9.4); flag **`future_bull`** (nuevo grupo R12); **denormalización de `is_castrated`** + write-through + espejo con input real (nuevo grupo R13, R10.6); **recompute simétrico** del revert (R13.5). Vacunación sin cambios de modelo (R3.1/R4.x).
  - **Por staleness contra el as-built**: R5.5 reescrita — el `weaning` **SÍ transiciona** la categoría server-side (0062/0063; antes decía "no transiciona, pendiente de Facundo" — falso as-built, confirmado por Raf); R5.7 reescrita — efecto de castración **definido** (torito→novillito / toro→novillo, corte 2 años; 0059/0062/0064; ya no pendiente); R7.3 corregida a la verdad as-built (la capa DB solo gatea `vaccination`; `weaning` no tiene rama — límite documentado); R1.2 `AnimalListItem` → **`AnimalRow`** (nombre real as-built); dependencias "frontend en vuelo" → **C1–C4 de spec 02 DONE**; R10.1/R10.3 actualizadas al as-built de spec 15 (sync streams JOIN-free, CRUD plano, canal de error de upload); R9.4 reescrita con el delta backend real.
  - Criterio propio del autor (validar en Puerta 1): exclusión-de-lista como equivalente del skip-and-report para destete en lote cross-rodeo (R7.2); lista de destete acotada a categorías `ternero`/`ternera` sin destete previo (R11.4); aviso de override movido al bottom-sheet (R5.6); enforcement de `future_bull` solo-machos por trigger de normalización silenciosa contra `animal_sex` denormalizado (R12.1, design §4.1).

- **2026-06-11 — Fix-loop por Gate 1 v2 (PASS 0H/2M/3L — folds documentales, IDs preservados, cero cambio de diseño)**:
  - **M1**: corregida en design §6.1/§4.2 la afirmación falsa "sin interacción con triggers as-built" — los checks de 0021 (`identity_check`/`rodeo_check`/`category_check`) son BEFORE INSERT OR UPDATE sin lista de columnas y disparan en cada UPDATE de `is_castrated`/`future_bull`; `rodeo_check` puede abortar fail-closed la propagación hacia un perfil con rodeo inactivo/soft-deleted. Caso agregado a T-DB.4(e) + listado como **LIM-2** en §Limitaciones explícitas.
  - **M2**: R13.2 y R3.3 reescritas a la verdad (la historia queda en `animal_category_history` **solo cuando hay transición**; castrar/revertir un `ternero` — el default pre-tildado — no deja registro atribuible hasta el destete); eco corregido en el criterio de aceptación global y en design §3.3; gap visible como **LIM-1** en la nueva sección §Limitaciones explícitas. **D10 NO se reabre** (castrado = estado, lockeado).
  - **L1 (LOW foldeado)**: T-DB.4(f) agrega la aserción del orden de los triggers BEFORE contra `pg_trigger` (no solo por convención de nombres).
  - Headers de los 3 archivos actualizados: Gate 1 = PASS 2026-06-11; ⏸ solo queda la re-aprobación de Puerta 1.

- **2026-06-11 — Fix-loop #2: Puerta 1 APROBADA por Raf — folds de las 2 decisiones sobre §Limitaciones (IDs preservados)**:
  - **LIM-1 → MITIGADA (observación automática)**: nuevo **R13.7** — al castrar/revertir (masiva o ficha), el cliente crea junto al UPDATE una observación en `animal_events` (`event_type='observacion'`, reuso `addObservation` as-built, offline-safe, autor = `auth.uid()` del que sube); copy "Castrado" / "Corrección: marcado como no castrado" (revert simétrico). R3.3 y R13.2 reescritas: el rastro atribuible en `ternero` ahora SÍ existe (vía observación); D10 NO se reabre (sin evento tipado). Eco en criterios de aceptación, design §1.1/§3.2/§3.3/§3.5 y tasks (T-CL.8/T-CL.11/T-CL.13/T-UI.7/T-UI.9).
  - **LIM-2 → RESUELTA (tolerar-y-saltear)**: la propagación `animals → profiles` pre-filtra los perfiles cuyo rodeo está inactivo/soft-deleted (espeja el predicado de `rodeo_check` 0021) en vez de abortar; perfil propio aplicado, huérfano salteado con `RAISE LOG`, inconsistencia entre perfiles aceptada y documentada. design §4.2(4)/§6.1 actualizados (pre-filtro elegido sobre manejo de excepción — justificación en §4.2(4)); T-DB.4(e) pasa de "aborto esperado" a "skip esperado + perfil propio aplicado". ⚠ Delta del trigger → re-chequeo puntual de Gate 1 (lo lanza el leader).
  - Los 4 criterios propios del autor (R7.2, R11.4, R5.6, D8) quedaron **validados tal cual** — hedges "validar en Puerta 1" cerrados.
