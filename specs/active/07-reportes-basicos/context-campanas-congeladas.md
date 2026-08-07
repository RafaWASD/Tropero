# Spec 07 — Delta CAMPAÑAS CONGELADAS: los reportes cerrados son una foto — Contexto (Gate 0)

**Status**: `context_ready` — **Puerta 0 APROBADA por Raf (2026-08-07)**, con los 2 puntos abiertos cerrados
(ver § "Los 2 puntos…" al final).
Delta **Nivel B (ADR-028)** sobre spec 07 (`done`) · **CON BACKEND** (2 tablas nuevas + 2 RPC de escritura +
reescritura de 6 RPC de lectura) · **Gate 1 OBLIGATORIO**.
**Fecha**: 2026-08-07.
**Origen**: `docs/adr/ADR-032-campanas-cerradas-foto-inmutable.md` (la decisión) ·
`progress/repro_reportes-campanas-congeladas.md` (la evidencia) ·
`progress/handoff-reportes-campanas-congeladas.md` (el handoff, ya consumido).
**Deploy**: **NO autorizado todavía** — toca DB. Se pide en sesión antes de aplicar.

---

## Problema

Los KPI reproductivos de campañas pasadas **se recalculan con el estado de hoy**. Reproducido en DEV: el
reporte 2025 de un rodeo pasó de `3 servidas / 3 preñadas` (100 %) a `1 servida / 0 preñadas` (0 %) con tres
acciones normales de un campo de cría — un tacto de 2026, una venta y una transferencia de rodeo. Ninguna
tocó un dato de 2025.

Y el año casi no participa: pedir el KPI de **2020** —sin un solo evento cargado— devuelve el mismo número
que 2025. Para servicio natural puro no hay campañas: hay una foto de hoy replicada en todos los años.

El benchmarking año a año es uno de los tres pilares del producto. Números creíbles que cambian solos son
peor que números que faltan.

## Decisiones de dominio (Raf, 2026-08-07 — ADR-032, NO se re-discuten)

- **D1 — El cierre lo dispara el productor, y la app se lo sugiere.** Manual, por rodeo y campaña. La app
  detecta que el ciclo se completó y **avisa**; el que cierra es el productor (es el único que sabe si
  terminó de cargar). Descartado el cierre automático por fecha: **verificado que el 1/1 es imposible** —
  una campaña sigue generando hechos hasta ~17 meses después del servicio (partos a los 9, destetes a los
  ~15), así que congelar 2025 el 1/1/2026 dejaría %parición y %destete en 0 para siempre.
- **D2 — El pasado: se re-seedea "La Facundina".** Es el único campo con una campaña pasada con datos
  (es el demo de Facundo); no hay cliente productivo con histórico. Se lo regenera con su campaña 2025 ya
  cerrada y correcta, en vez de congelar un número contaminado. **Sin backfill de cierres para nadie más.**
- **D3 — Se tapan las cuatro fugas, incluida la historia de membresía de rodeo** (tabla nueva). Es la
  decisión cara y se tomó a conciencia: es el único camino a un histórico fiel y destraba la spec 11.

## Decisiones del leader (Gate 0 — a ratificar en la Puerta 0)

- **DL1 — El dato es por rodeo; el gesto puede ser masivo.** `service_months` es del rodeo, así que la
  campaña y su cierre son del rodeo. Pero la UI ofrece "cerrar la campaña 2025 del campo" como acción que
  escribe N cierres, uno por rodeo — el productor no cierra cuatro veces a mano.
- **DL2 — El snapshot lo computa el server al cerrar, nunca el cliente.** El cierre es una RPC
  `SECURITY DEFINER` que recomputa los KPI y persiste el resultado. La UI no es autoritativa: no se congela
  "lo que la pantalla mostraba".
- **DL3 — Una campaña cerrada se LEE del snapshot; una abierta se computa en vivo.** La decisión vive
  server-side (las RPC de KPI devuelven el snapshot si existe), no en el cliente — así ninguna pantalla
  puede mostrar en vivo un reporte que está cerrado.
- **DL4 — La reapertura existe, con rastro.** Un cierre por error a mitad de la parición no puede ser
  irreversible. Se puede reabrir mientras **no** esté cerrada la campaña siguiente del mismo rodeo. El
  cierre y la reapertura quedan con fecha y autor.
- **DL5 — Ventana del tacto de la campaña N** = desde el primer día del primer mes de servicio del año N
  hasta el día anterior al inicio del servicio del año N+1. Es lo único que necesita una ventana temporal
  nueva: `calved` y `weaned` ya se imputan por vínculo (concepción − 9 meses / cría→parto→servida) y no
  dependen de ella. Funciona con el wrap de fin de año sin lógica especial.
  **[VALIDAR CON FACUNDO]** — es la definición natural, pero la confirma un veterinario, no yo.
- **DL6 — El estado histórico se resuelve al CIERRE de la ventana de campaña**, no a su inicio: la vaca que
  entró al rodeo durante el servicio cuenta; la que salió antes de que terminara, no.
- **DL7 — Backfill de la historia de membresía**: al crear la tabla se siembra **una fila abierta por
  perfil** con el `rodeo_id` actual y `from_date = coalesce(entry_date, created_at::date)`. Es lo mejor
  disponible y **asume que nunca se movió** — falso para los que sí se movieron, y hay que decirlo en la
  spec, no taparlo. El historial real empieza a acumularse desde el deploy.
- **DL8 — La historia de membresía NO va a PowerSync.** Es historia server-side para reportes; no se agrega
  a `sync-streams/rafaq.yaml` (mismo criterio que `audit.record_version`, ADR-032 §1.2). Igual lleva
  `establishment_id` denormalizado por ADR-026.
- **DL9 — El cierre es online-only**, como el resto de spec 07 ("online-only server-side"). Es un gesto de
  oficina con señal, no de manga.
- **DL10 — Si llega un dato de una campaña ya cerrada** (un tacto de 2025 cargado en 2027 desde el
  cuaderno): **el dato se acepta y el snapshot NO se mueve**; la app avisa que la campaña cerrada tiene
  datos nuevos sin reflejar y ofrece reabrirla. Rechazar el dato rompería el offline-first; aceptarlo en
  silencio dejaría al snapshot mintiendo sin que nadie lo sepa.

## Alcance

### Backend (deploy gateado)

1. **`rodeo_membership_history`** (tabla nueva) — `animal_profile_id`, `rodeo_id`, `establishment_id`
   (denorm), `from_date`, `to_date` (NULL = vigente), autor. Mantenida por **trigger** sobre
   `animal_profiles` (INSERT abre fila; UPDATE de `rodeo_id` cierra la vigente y abre la nueva), así que
   captura también los movimientos que llegan por el upload de PowerSync. + backfill (DL7).
2. **Snapshot de campaña** (tabla/s nuevas) — el cierre por `(rodeo_id, campaign_year)` con `closed_at` /
   `closed_by`, los KPI congelados, y **el detalle por animal** que los sustenta (ver punto abierto ②).
3. **`close_campaign(p_rodeo_id, p_year)`** y **`reopen_campaign(...)`** — RPC `SECURITY DEFINER`, las
   **primeras de escritura** de toda la superficie de reportes (hasta hoy es read-only). Guard
   `is_owner_or_vet_of` (punto ①, helper nuevo) como primera sentencia + idempotencia + la regla de DL4.
4. **Reescritura del cómputo histórico** en las 6 RPC con `p_year`: `rodeo_serviced_females` y
   `rodeo_repro_denominator` (0105 — el denominador común, donde está el núcleo) + `rodeo_pregnancy_kpi`,
   `rodeo_calving_kpi` (as-built vigente = `0117`, **no** 0106), `rodeo_ccl_distribution`,
   `rodeo_calving_by_stage` (0106) y **`rodeo_weaning_kpi`** (`0118`). Las cuatro fugas:
   - **F1 numerador**: el "último tacto" se acota a la ventana de campaña (DL5). Hoy no tiene filtro de
     fecha (`0106:242-249`, y espejado en `0117`, `0106:308`, `0106:376`).
   - **F2 estado**: se usa `exit_date` contra la ventana, no `status` actual (`0105:122`).
   - **F3 categoría**: se resuelve con `animal_category_history` a la fecha de corte, no la actual
     (`0105:121,127-144`).
   - **F4 rodeo**: se usa `rodeo_membership_history`, no `animal_profiles.rodeo_id` (`0105:119`).
5. **Contrato de seguridad**: las RPC modificadas **preservan íntegro** `0106` cabecera §5.1-§5.10 (guard
   `has_role_in` fail-closed como **primera sentencia**, `SECURITY DEFINER STABLE set search_path = public`,
   cota de `p_year`, tenant por el JOIN a `animal_profiles`, revoke public/anon + grant authenticated +
   smoke-check fail-closed). Las **dos RPC nuevas son de ESCRITURA** → no son `STABLE`, y su guard es más
   estricto que el de lectura. **Gate 1 obligatorio.**
6. Próxima migración libre: **`0127`**. Ojo con la regla `reference_function_recreate_base`: el molde de
   `rodeo_calving_kpi` es `0117` y el de `rodeo_weaning_kpi` es `0118`, **no** `0106`. Verificar el cuerpo
   **vigente en el remoto** antes de re-crear cualquiera de las seis.

### Frontend

- `app/app/(tabs)/reportes.tsx`: estado **"campaña cerrada (foto del DD/MM/AAAA)"** vs **"en curso"**,
  visible sin ambigüedad; el gesto de cierre; el aviso de "el ciclo terminó, ¿cerrás?"; el aviso de DL10.
  es-AR, tokens, anti-recorte de descendentes.
- **⚠ Colisión**: `reportes.tsx` tiene cambios sin commitear de **otra terminal** (el
  `useStickStatusSurface('screen-band')` del bastón, 2026-08-06). Coordinar antes de tocarlo.

### Tests

- `supabase/tests/reports/run.cjs` — **el oráculo central es un test de INMUTABILIDAD**: cerrar una campaña,
  aplicarle las cuatro mutaciones del probe (tacto de la campaña siguiente, venta, transferencia de rodeo,
  cambio de categoría) y exigir que **los 5 KPI no se muevan ni un dígito**. Más el contrafactual: la misma
  campaña **sin** cerrar sí se mueve (si no, el test pasa por el motivo equivocado).
- Tests del cómputo histórico **antes** del cierre: una campaña abierta con un animal vendido/movido después
  del cierre de su ventana tiene que dar el número de entonces, no el de hoy.
- Los IDOR/authz de las 2 RPC nuevas (42501, no vacío silencioso) + los grants.
- **No romper lo verificado**: un tacto **sin jornada** sigue entrando a los KPI (ninguna función referencia
  `session_id`; el delta `ficha-categoria-tacto` de spec 02 depende de eso).

## No-alcance

- Las **4 RPC sin `p_year`** (`session_event_summary`, `rodeo_sessions_list`, `rodeo_weight_by_category`,
  `establishment_overdue_doses`, `establishment_unweighed`): trabajan sobre el presente **por diseño** —
  verificado que es correcto que lo hagan.
- **`entoradas = servidas − retiradas`**, que está estructuralmente roto para servicio natural (`retired`
  siempre 0). Es un defecto **del presente**, no del pasado → queda en `docs/backlog.md`. Se re-evalúa al
  escribir el design: con estado histórico por fecha, "retirada durante la campaña" pasa a ser computable
  de verdad, así que puede resolverse de arriba — o caerse la columna.
- Cache offline de reportes (R7.2.3, sigue no implementada). El snapshot la habilita; no la implementa.
- La UI de **comparativa multi-año** (benchmarking propiamente dicho). Este delta hace que los números sean
  comparables; graficarlos es otro incremento.

## Reúso

- `rodeo_service_campaign(p_rodeo_id, p_year)` (0105) ya deriva la ventana de meses con el wrap por
  set-membership: es la base de DL5.
- `animal_category_history` (0030) — `from_category_id`/`to_category_id`/`changed_at`, ya poblada por
  trigger (6.817 filas en DEV).
- `animal_profiles.exit_date` — poblado 21/21 en DEV; la RPC `exit_animal_profile` (0044) lo recibe como
  parámetro **sin default**, así que toda baja lo escribe.
- Molde de tabla con historia por trigger: `animal_category_history` (0030) y su
  `tg_animal_profiles_record_category_change`.
- Molde de RPC de escritura con guard: `exit_animal_profile` (0044), `register_birth` (0116).

---

## ✅ Los 2 puntos de la Puerta 0 — CERRADOS por Raf (2026-08-07)

### ① Cierran el **owner** y el **veterinario**

El cierre es la **primera escritura** de la superficie de reportes (hoy las 10 RPC las **lee** cualquier rol
activo vía `has_role_in`) y es un acto contable. **Decisión de Raf: `owner` + `veterinarian`; el
`field_operator` NO.** Fundamento operativo: el vet es el que sabe si el tacto quedó completo, o sea si el
ciclo terminó de verdad.

**Consecuencias para la spec:**
- Hace falta un **helper nuevo**, porque hoy no existe: `is_owner_of(est_id)` existe (0023) pero es solo
  owner, y `has_role_in(est_id)` no discrimina rol. Moldear `is_owner_or_vet_of(est_id)` **exactamente**
  sobre el cuerpo de `is_owner_of` (`STABLE SECURITY DEFINER set search_path`, join a `establishments` con
  `deleted_at is null`, `ur.active = true`), cambiando solo `ur.role = 'owner'` por
  `ur.role in ('owner','veterinarian')`. El enum vigente es `('owner','field_operator','veterinarian')`
  — verificado en el remoto.
- El guard va como **primera sentencia ejecutable** de `close_campaign` / `reopen_campaign`, fail-closed
  (42501, nunca un no-op silencioso), y **la RPC de lectura no cambia de guard**: leer un reporte cerrado
  lo sigue pudiendo hacer cualquier rol activo.

### ② Se congelan los números **y** el detalle por animal

**Decisión de Raf**: el snapshot guarda los 5 KPI **y** qué animal cayó en cada bucket (servida / preñada /
vacía / parida / destetada), para que el drill-down *"¿qué vacas quedaron vacías en 2025?"* siga disponible
dentro de tres años. Costo ~350 filas por campaña por rodeo: trivial.

**Consecuencias para la spec:**
- Tabla de detalle con FK al snapshot + `animal_profile_id` + su rol en el KPI. El rol es un **enum** o un
  set de booleanos: decisión del `spec_author`, pero tiene que soportar que un mismo animal esté en varios
  buckets a la vez (servida **y** preñada **y** parida).
- **El detalle sobrevive a la baja del animal**: es un hecho histórico. La FK a `animal_profiles` **no**
  puede ser `on delete cascade` — un perfil borrado no puede vaciar un reporte cerrado. Guardar además el
  identificador legible del animal al momento del cierre (`idv`), para que el drill-down no dependa de que
  la fila del perfil siga existiendo.
- Multi-tenant: `establishment_id` denormalizado (ADR-026) + RLS de lectura por `has_role_in`.

## Tareas para la spec

El `spec_author` redacta `{requirements,design,tasks}-campanas-congeladas.md` con numeración **`RCC.<n>`**
("Reportes Campañas Congeladas"), tomando D1-D3 de ADR-032 como cerradas, DL1-DL10 como decisiones del
leader ya ratificadas en la Puerta 0, y los puntos ① y ② como resueltos por Raf. Marcar explícitamente toda
decisión de criterio propio (forma exacta de las tablas, nombres de las RPC, enum de roles del snapshot,
numeración de migraciones desde `0127`). **Gate 1 obligatorio.** Gate 2.5 con capture de los dos estados de
la pantalla (campaña en curso / campaña cerrada + su fecha).
