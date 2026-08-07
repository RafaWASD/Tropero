# Gate 1 (ADR-019) — modo `spec` — delta `campanas-congeladas` (feature 07)

- **Fecha**: 2026-08-07
- **Auditor**: `security_analyzer` (modo `spec`)
- **Input**: `specs/active/07-reportes-basicos/{requirements,design,tasks,context}-campanas-congeladas.md`,
  `docs/adr/ADR-032-campanas-cerradas-foto-inmutable.md`
- **Contrato medido**: cabecera `supabase/migrations/0106_reports_rpcs.sql` §5.1–§5.10 · `0105_repro_denominator.sql`
  (§4 grants + smoke-check) · `0005_rls_helpers.sql` · `0023_event_helpers.sql` · `0030_animal_category_history.sql` ·
  `0020`/`0022` (animal_profiles + RLS) · `sync-streams/rafaq.yaml` · ADR-025 · ADR-026
- **Alcance**: solo lectura sobre spec y as-built. No se editó código, tests, migraciones ni la spec.

## Veredicto

**FAIL** — 3 findings HIGH, 6 MEDIUM.

Aclaración importante para el leader, porque cambia qué hay que hacer: **la §5 del design es sólida en sustancia**.
Revisé el contrato §5.1–§5.10 de `0106` línea por línea contra el delta y **no encontré un hueco de diseño abierto**
en el cortocircuito, en la cota de `p_year`, en el guard de las 3 RPC nuevas ni en el reemplazo de `p.status`. Los tres
HIGH son de otra clase: **invariantes de seguridad que la spec sostiene en prosa y que ningún oráculo verifica**, sobre
código que se escribe de cero. En un repo cuya regla es "el guard se escribe sobre la ausencia" y donde ya hubo cuatro
casos de guards burlados por texto, una frontera de tenant nueva sin test adversarial es un hueco, no una prolijidad.

Los arreglos son **aditivos** (5 bullets de requirements + 4 de tests + 3 correcciones de la §5). No hay que rediseñar
nada. Re-auditar el delta corregido cuesta ~15 minutos.

---

## Findings HIGH

### H-1 · El cortocircuito por snapshot agrega 7 salidas tempranas nuevas y **ninguna** tiene test de tenant

**Dónde**: `design` §3.6, §3.3 (paso 2), §5.A fila §5.3 · `requirements` RCC.7.1, RCC.13.5 · `tasks` T48, T69(a).

**El diseño está bien.** §3.6 lo dice literal:

> Se inserta DESPUÉS del guard de tenant y de la cota de `p_year`, y ANTES de cualquier cómputo.

y §5.A lo repite en la fila de §5.3. El problema es que **eso es todo lo que lo sostiene**: una frase en el design y el
punto (a) de la autorrevisión del implementer (T69). El plan de tests no lo verifica en ningún lado.

**Por qué es explotable si se rompe.** Poner el `select … from rodeo_campaign_snapshots where rodeo_id = p_rodeo_id`
antes del `select establishment_id … from rodeos` es la variante *natural* de escribir esta función: leer el snapshot no
necesita la fila del rodeo para nada. Si el implementer lo hace así en una sola de las siete, cualquier `authenticated`
de cualquier tenant que conozca (o adivine) un `rodeo_id` recibe **los 5 KPI congelados y el detalle por animal completo**
(`rodeo_serviced_females` con la campaña cerrada devuelve las filas del bucket `serviced`, RCC.7.2) de un campo ajeno,
con la RLS verde: las funciones son `SECURITY DEFINER` y la RLS no las protege (`0105` §4: *"SECURITY DEFINER → la RLS no
las protege; el guard interno SÍ"*).

**Por qué ningún test lo agarra hoy.** La suite tiene el IDOR por función (`run.cjs:475`, `:529`, `:754`, `:802`, `:854`
— *"owner B no lee pregnancy_kpi de A"*), pero **todos corren con campañas abiertas**: hoy no existen snapshots, así que
el camino nuevo nunca se ejercita. Y el delta no lo cubre: TR.14 (T48) prueba IDOR **solo sobre las 3 RPC nuevas**
(`RCC.13.5`: *"owner de otro campo → 42501"* en `close`/`reopen`/`status`). Las 7 de lectura, con la campaña **cerrada**,
quedan sin oráculo. El bug pasaría Gate 2, el reviewer y la suite en verde.

Lo mismo aplica a la cota de `p_year`: si el cortocircuito queda antes de la cota, `p_year = 9999999` con snapshot
existente deja de dar `22023`. También sin test.

**Qué tiene que cambiar en la spec** (bloqueante):

1. `requirements` — **RCC.13.5.a (nuevo)**: *"El sistema deberá incluir un test de aislamiento cross-tenant **con la
   campaña CERRADA**: un owner de B invocando las **siete** funciones de lectura y `rodeo_campaign_status` sobre un rodeo
   de A cuya campaña tiene snapshot vigente deberá recibir `42501`, y en ningún caso filas del snapshot."*
2. `requirements` — **RCC.13.5.b (nuevo)**: *"El sistema deberá incluir un test de que la cota de `p_year` sigue
   devolviendo `22023` **aunque exista un snapshot vigente** para `(rodeo, year)`."*
3. `tasks` — extender T48 (TR.14) con los dos casos, ejecutados **después** de `close_campaign` en el mismo fixture, no
   antes.

---

### H-2 · La RLS de las dos tablas de snapshot cuelga de un `establishment_id` cuya procedencia la spec **nunca fija**, y cuya premisa ("no hay camino de escritura del cliente") no tiene oráculo

**Dónde**: `design` §2.3 (bloque de RLS), DP-19, §5.B W5 · `requirements` RCC.4.8 · `tasks` T19, T37, T38.

DP-19 hace una excepción deliberada: en `rodeo_membership_history` la RLS deriva el tenant por la cadena de FK
(`has_role_in(establishment_of_profile(animal_profile_id))`, molde `0030:57-58`), pero en las dos de snapshot scopea por
la **columna denormalizada**:

```sql
create policy rodeo_campaign_snapshots_select on public.rodeo_campaign_snapshots
  for select using (has_role_in(establishment_id));
create policy rodeo_campaign_snapshot_animals_select on public.rodeo_campaign_snapshot_animals
  for select using (has_role_in(establishment_id));
```

El argumento de §2.3 es: *"estas dos tablas no tienen ningún camino de escritura desde el cliente … El valor no es
spoofeable, así que puede ser la frontera de autorización."* El razonamiento es correcto **condicionado a dos cosas que
la spec no fija**:

**(a) La procedencia del valor no está escrita en ningún requisito.** RCC.1.12 lo exige explícitamente para
`rodeo_membership_history` (*"deberá derivar el `establishment_id` denormalizado de la fila del `animal_profiles` padre y
no deberá tomarlo nunca de un valor provisto por el cliente (ADR-026, patrón anti-spoof)"*). **No existe el requisito
equivalente para las dos tablas de snapshot.** El design tampoco lo dice: §4.2 paso 8 escribe la cabecera con "(…)" y el
paso 9 solo aclara que el `idv` sale de `animal_profiles`; T37 y T38 enumeran los campos y **omiten `establishment_id`**
en ambos. O sea: la única columna que es la frontera de autorización de las dos tablas nuevas es la única que nadie dice
de dónde sale. Con `rodeo_campaign_snapshot_animals` es peor, porque hay dos fuentes plausibles (el header vs.
`animal_profiles.establishment_id` de cada fila) y la spec no elige.

**(b) La premisa "no hay camino de escritura del cliente" no se testea.** RCC.4.8 y RCC.1.11 dicen "no deberá otorgar
`insert`/`update`/`delete` a `authenticated`", y T19/T6 lo instruyen — pero **§8 no tiene un solo test de eso**. TR.15
prueba RLS de SELECT en membresía (*"owner de B no ve filas de A"*); TR.14b prueba grants **de funciones**; TR.20 prueba
conteos. Nada verifica los grants **de tabla** ni que un `authenticated` no pueda insertar. Si mañana alguien agrega un
`grant insert` (o una policy `for all`) "para el import", la frontera de las dos tablas de snapshot se cae sin que nada
se ponga en rojo — y el atacante puede insertar una fila con el `establishment_id` de otro tenant, que es exactamente el
spoof que ADR-026 previene con triggers en todas las demás tablas hijas.

**Nota de coherencia con ADR-026** (vale la pena que quede escrito): ADR-026 dice *"la RLS as-built de las tablas hijas
**NO cambia** — sigue derivando el tenant vía `establishment_of_profile(...)` / la cadena de FKs. La columna
denormalizada es **solo para el stream**"*. Acá la columna **no tiene** propósito de stream (DL8 / RCC.4.9: las tablas no
sincronizan) y sí es la frontera de RLS: es la inversión exacta de la consecuencia de ADR-026. La decisión puede ser
correcta, pero hoy está tomada citando ADR-026 en lugar de declarándose como desvío de ADR-026 con su invariante.

**Qué tiene que cambiar en la spec** (bloqueante):

1. `requirements` — **RCC.4.8.a (nuevo)**: *"El sistema deberá escribir el `establishment_id` de
   `rodeo_campaign_snapshots` derivándolo de la fila del `rodeos` padre (el mismo `v_est` del guard) y el de
   `rodeo_campaign_snapshot_animals` derivándolo de la fila de snapshot padre; en ningún caso de un valor del cliente ni
   de la fila del animal (ADR-026, anti-spoof)."*
2. `requirements` — **RCC.13.6.a (nuevo)**: *"El sistema deberá incluir un test de que un cliente `authenticated` con rol
   activo no puede `insert`/`update`/`delete` en `rodeo_membership_history`, `rodeo_campaign_snapshots` ni
   `rodeo_campaign_snapshot_animals` (ni siquiera sobre filas de su propio establecimiento), y que las policies de las
   tres son exclusivamente `for select`."* — el intento de INSERT con un `establishment_id` de otro tenant tiene que ser
   uno de los casos.
3. `design` §2.3 / DP-19 — declarar el desvío de ADR-026 en una línea, con el invariante que lo sostiene ("mientras no
   exista grant de escritura ni policy distinta de SELECT"), y apuntar al test de (2) como el guard de ese invariante.
4. `tasks` — T37/T38 deben nombrar `establishment_id` y su fuente; agregar la tarea del test (TR.14e).

---

### H-3 · `is_owner_or_vet_of` es el primer helper de autorización nuevo desde `0005` y su corrección se apoya solo en la instrucción "copia literal"

**Dónde**: `design` §4.1 · `requirements` RCC.5.3, RCC.13.5 · `tasks` T12 · contra `0005:31-48`.

El design es explícito y correcto:

> Copia literal de `is_owner_of` (`0005:31-48`) — `sql security definer stable set search_path = public`, join a
> `establishments` con `e.deleted_at is null`, `ur.active = true` — cambiando **solo** `ur.role = 'owner'` por
> `ur.role in ('owner','veterinarian')`.

Verifiqué el original: las dos cláusulas están (`0005:45` `ur.active = true`, `0005:46` `e.deleted_at is null`). O sea,
la spec pide lo correcto. El problema es qué pasa si el implementer escribe el helper de memoria en vez de copiarlo:

- **sin `ur.active = true`** → un **ex-miembro revocado** (owner o vet dado de baja, con `user_roles.active = false`)
  puede cerrar y reabrir campañas del campo del que lo echaron. Es una escritura sobre un tenant al que ya no pertenece,
  y encima una escritura *irreversible en la práctica* (congela el reporte del año).
- **sin el join a `establishments … deleted_at is null`** → owner de un campo soft-deleteado sigue operando sobre él.
  Ese invariante además es load-bearing para PowerSync (ADR-026 / migración `0076`).

**Y no hay ningún oráculo.** RCC.13.5 y T48 (TR.14) cubren la **forma del rol** — owner de otro campo, `field_operator`,
`veterinarian` — pero **ningún caso con `active = false` ni con establecimiento borrado**. Es la asimetría clásica: se
testea que el rol equivocado no pase, no se testea que el rol correcto **caducado** tampoco.

**Qué tiene que cambiar en la spec** (bloqueante):

1. `requirements` — **RCC.13.5.c (nuevo)**: *"El sistema deberá incluir tests de que `close_campaign` y
   `reopen_campaign` devuelven `42501` (a) para un owner cuyo `user_roles.active` es `false`, y (b) para un owner de un
   establecimiento con `deleted_at` no nulo; y que `rodeo_campaign_status` los rechaza igual por `has_role_in`."*
2. `requirements` — **RCC.13.5.d (nuevo, guard de clase)**: *"El sistema deberá incluir un guard estructural que compare
   `pg_get_functiondef('public.is_owner_or_vet_of(uuid)')` contra `pg_get_functiondef('public.is_owner_of(uuid)')` y
   falle si difieren en algo que no sea la cláusula de `ur.role`, o si al helper nuevo le falta `ur.active`,
   `e.deleted_at is null`, `security definer`, `stable` o `set search_path`."* — mismo patrón que el guard de
   `session_id` que la spec ya tiene en RCC.12.2/TR.17, que es la prueba de que el repo sabe hacer esto.
3. `tasks` — sumar los dos bloques a T48.

---

## Findings MEDIUM

### M-1 · La justificación de §5.6 sobre el reemplazo de `p.status = 'active'` es incorrecta, y el argumento que **sí** sostiene la seguridad no está escrito

**Dónde**: `design` §5.A fila §5.6, §3.3 (tabla de cambios) · `requirements` RCC.2.3, RCC.2.4.

§5.A dice:

> `p.status = 'active'` se **quita a propósito** (es F2) y se reemplaza por el intervalo de membresía, que es un filtro
> **más** restrictivo en el pasado y equivalente en el presente.

Las dos mitades son falsas:

- **No es más restrictivo en el pasado.** Es *bidireccional*. Excluye a los que entraron después del corte (más
  restrictivo) e **incluye** a los que ya no están en el padrón pero cuya membresía cubría el corte (más permisivo — que
  es justamente el fix F2: *"hoy una vaca vendida desaparece del reporte de 2025; después del cambio, cuenta"*, §3.3).
- **No es equivalente en el presente.** Un perfil con `status = 'sold'` y `exit_date` nulo queda con
  `to_date = current_date` (backfill/trigger, §2.1) → para cualquier corte pasado, `to_date > v_state_as_of` es
  verdadero → entra, donde el código viejo lo excluía. La columna `retired` existía exactamente para contarlos.

Que la justificación esté mal importa porque **el argumento correcto es otro y no está en la §5**: lo que preserva la
frontera de tenant no es el intervalo de membresía sino que **`p.establishment_id = v_est` sobre `animal_profiles`
sobrevive intacto** (§5.5). Y eso es load-bearing de verdad, porque:

- `animal_profiles.rodeo_id` es una columna **escribible por el cliente** (`0022:13` — `animal_profiles_update` solo
  exige `has_role_in(establishment_id)`), y **no hay CHECK ni trigger que valide que el rodeo pertenece al mismo
  establecimiento** (`0020:16` es una FK pelada a `rodeos(id)`).
- El trigger nuevo copia ese `rodeo_id` tal cual a `rodeo_membership_history`, y el `member` CTE de §3.3 filtra
  **solo** por `mh.rodeo_id = p_rodeo_id`, sin filtro de tenant.

Tracé el ataque hasta el final y **hoy está contenido**: un perfil de A apuntado al rodeo de B entra al CTE `member` de
B pero muere en el `join animal_profiles p … where p.establishment_id = v_est`; y a la inversa, el atacante no puede leer
el rodeo de B porque el guard `has_role_in(v_est_B)` falla antes. **No hay fuga.** Pero la contención depende de una sola
cláusula que la §5 atribuye a otra cosa — y el próximo que lea "el intervalo de membresía es más restrictivo" puede
concluir que `p.establishment_id = v_est` es redundante y sacarlo.

**Qué cambiar**: reescribir la fila §5.6 de §5.A con el argumento real ("la frontera de tenant sigue siendo
`p.establishment_id = v_est`; `rodeo_membership_history.rodeo_id` deriva de una columna escribible por el cliente sin
constraint de establecimiento y por lo tanto **no puede** ser frontera de tenant — §5.5"), y agregar el test adversarial:
**perfil de A con `rodeo_id` apuntando a un rodeo de B → no aparece en ningún KPI ni en el snapshot de B**. Ese test es el
guard de la única cláusula que contiene el caso.

### M-2 · La lista normativa de funciones internas a revocar tiene 5 entradas; las funciones internas son 7

**Dónde**: `requirements` RCC.9.5 · `design` §5.B W9 — contra `design` §4.1-bis y `tasks` T14-bis/T20/T49.

RCC.9.5 y W9 enumeran `rodeo_campaign_tacto`, `rodeo_campaign_births`, `rodeo_campaign_calves`, `animal_category_at`,
`campaign_tacto_bounds`. Faltan **`campaign_cycle_complete` y `campaign_missing_summary`**, que §4.1-bis crea en `0128` y
declara *"Ambas se revocan de `public`, `anon` y `authenticated`"*. Los tasks sí las cubren (T14-bis, T20, T49), así que
el implementer probablemente lo haga bien — pero el reviewer chequea contra los requirements, y el smoke-check de RCC.9.6
enumera por nombre: si la lista normativa tiene 5, el smoke-check puede quedarse con 5 y las dos nuevas se quedan con el
default de Postgres (`EXECUTE` a `PUBLIC`, alcanzable por `anon` vía PostgREST).

**Explotabilidad real: baja.** Son funciones puras sobre valores que pasa el caller; no tocan tablas, no filtran datos.
El daño es superficie RPC innecesaria expuesta a `anon`, no disclosure. Por eso MEDIUM y no HIGH. **Fix**: agregar las
dos a RCC.9.5 y a §5.B W9.

### M-3 · `close_campaign` crea temp tables dentro de un `SECURITY DEFINER` con `set search_path = public`

**Dónde**: `design` §4.2 paso 7 · `tasks` T36.

```sql
create temp table _snap_serviced on commit drop as
  select * from public.rodeo_serviced_females(p_rodeo_id, p_year);
```

Dos cosas:

**(a) `pg_temp` queda implícitamente primero en la resolución de relaciones.** Postgres documenta que si `pg_temp` **no**
está listado en el `search_path`, igual se busca **primero** para nombres de relación; por eso la guía oficial de
*Writing SECURITY DEFINER Functions Safely* dice que hay que poner `pg_temp` **último** y explícito. Con
`set search_path = public`, la función definer resuelve `_snap_serviced` (y cualquier tabla no calificada) contra el
`pg_temp` de la **sesión del que llama**. **No es explotable hoy** por la superficie de la app: `authenticated` solo llega
por PostgREST, que no permite DDL, así que nadie puede pre-crear `pg_temp.animal_profiles`. Pero este delta es el
**primero** del repo que crea y lee temp tables no calificadas adentro de un definer, así que el as-built deja de cubrir
el caso por accidente. **Fix barato**: `set search_path = public, pg_temp` en las dos RPC de escritura (o calificar
`pg_temp._snap_*`), y dejar el comentario de por qué, para que no se "uniformice" con las demás.

**(b) Dos `close_campaign` en la misma transacción explotan.** El segundo `create temp table _snap_serviced` falla con
`42P07 relation already exists` (el `on commit drop` limpia al COMMIT, no al salir de la función). Con el cierre masivo
por N llamadas HTTP separadas (DP-11) no pasa — pero **sí pasa en el procedimiento del §9**, que necesita una transacción
única para el `set local request.jwt.claims` y cierra 2024 en **dos** rodeos (ver M-6). **Fix**: `create temp table … ` →
`if to_regclass('pg_temp._snap_serviced') is not null then truncate … else create …`, o directamente CTEs/arrays en vez de
temp tables, o declarar explícitamente "un cierre por transacción" y adaptar el §9.

### M-4 · La cota de costo de §5.B W8 subdeclara la amplificación real, y el cierre no tiene piso de años

**Dónde**: `design` §5.B W8, §4.2 paso 7, §4.4, §13 · `requirements` RCC.9.10.

W8 afirma: *"El cierre agrega sobre un rodeo y una campaña … el detalle es proporcional al tamaño del rodeo … No se
expone `p_limit` porque no hay input del cliente que module el volumen."* Per-call es cierto que ningún parámetro modula
el volumen. Lo que W8 no dice:

1. **Amplificación ~10-15×.** `close_campaign` materializa 4 temp tables y **después** invoca las 5 RPC de KPI, que
   recomputan todo desde cero: `rodeo_pregnancy_kpi` → `rodeo_campaign_tacto` → `rodeo_serviced_females`;
   `rodeo_calving_kpi` → tacto + births → serviced; `ccl` → tacto → serviced; `by_stage` → births → serviced;
   `weaning` → calves → births → serviced. `rodeo_serviced_females` se ejecuta del orden de una docena de veces por
   cierre, y **cada** ejecución hace un `animal_category_at(p.id, …)` correlacionado por perfil (§3.2) más la subquery de
   `heifer_fitness`. Las temp tables no ahorran nada de eso: solo alimentan los `insert` del detalle. §13 reconoce el
   costo de `animal_category_at` pero lo evalúa a 1×, no a 12×.
2. **`rodeo_campaign_status` recomputa 2 KPI en el camino abierto** (§4.4: `pending_pregnant`/`pending_weaning` salen de
   `rodeo_calving_kpi`/`rodeo_weaning_kpi` cuando la campaña no está cerrada) y se recarga en cada `useFocusEffect` de la
   pantalla de reportes (T63). La pantalla pasa de 8 RPC a 9, con la novena costando dos de las anteriores otra vez.
3. **`p_year` no tiene piso útil.** `1900..current+1` son ~127 años. Para un año vacío, `campaign_cycle_complete` da
   `true` por la rama de los 18 meses → cierra **sin** reconocimiento → un owner/vet puede materializar ~126 snapshots
   por rodeo iterando `p_year`, cada uno pagando la amplificación de (1). No hay rate limiting en ninguna RPC de
   PostgREST en RAFAQ (verificado: `[auth.rate_limit]` cubre solo Auth; las Edge Functions y las RPC no tienen cuota).

Es abuso **autenticado y same-tenant**, en una instancia de Supabase **compartida entre tenants** → vecino ruidoso, no
disclosure. Por eso MEDIUM. **Fix pedido**: (a) corregir W8 con el factor real y decir que la cota es
`≈12 × N_cabezas_del_rodeo`; (b) medir el wall-time de un `close_campaign` sobre La Facundina (350 cabezas) durante T74 y
dejar el número en el design — es gratis, el leader ya va a estar ahí; (c) si sale caro, la salida natural es que las 5
RPC de KPI lean de las temp tables ya materializadas en vez de recomputar, o que el cierre acepte los KPI de un único
cómputo interno; (d) dejar escrito que cerrar un año sin datos escribe igual un snapshot y que eso es el límite superior
de filas que un usuario puede crear.

### M-5 · `closed_by_name` lee `users.name` global desde dentro de un `SECURITY DEFINER`, contra la convención de ADR-026 (c2)

**Dónde**: `design` §4.4 (fila `closed_by_name`), §5.B W11.

W11 dice *"el nombre se resuelve por JOIN dentro de una RPC con guard, no se denormaliza"*, y §4.4 lo implementa como
`snapshot vigente ⋈ users.name`. Pero ADR-026 decidió lo contrario para exactamente este caso: *"(C) users/nombres →
**(c2) ELEGIDA**: denormalizar `name` sobre `user_roles` … La tabla global `users` queda fuera del sync set"*, y
`user_roles.member_name` ya existe. Consecuencias de leer la global:

- se abre un camino de lectura nuevo a una tabla **compartida entre tenants** desde una función que corre con
  privilegios del owner (la RLS de `users` no aplica);
- el nombre que se muestra es el global **de hoy**, no el que la membresía de ese campo conoce, y se sigue mostrando
  aunque la persona ya no sea miembro del establecimiento.

Nada de eso es una fuga hoy (el `closed_by` siempre fue miembro y el guard es `has_role_in`), pero es un desvío de una
decisión de arquitectura vigente, en la dirección de más superficie. **Fix**: resolver por
`user_roles.member_name where user_id = closed_by and establishment_id = v_est`, con `coalesce` a `null`.

### M-6 · El procedimiento de re-seed del §9 no está suficientemente acotado para una DB de DEV compartida

**Dónde**: `design` §9.2 · `tasks` T74.

Lo que el §9.2 ya tiene bien: backup previo, borrado acotado por `establishment_id`, orden de dependencia calcado del
`cleanup()` de la suite, cierre por `close_campaign` en vez de insertar snapshots a mano, y verificación posterior. Lo
que le falta, en orden de riesgo:

1. **La impersonación corre con el rol equivocado.** El paso 4 hace
   `set local request.jwt.claims = '{"sub":"…","role":"authenticated"}'` pero **no** hace `set local role authenticated`.
   La sesión sigue siendo la de service_role/postgres: RLS bypasseada **y** con identidad spoofeada. Es la combinación
   más privilegiada posible, y toda sentencia del resto de esa transacción (el re-seed entero) escribe sin red de
   contención de tenant. Con `set local role authenticated` la impersonación es fiel, la RLS vuelve a aplicar y un bug
   en el seed **no puede** escribir fuera del campo demo. Es una línea.
2. **El borrado no tiene assertion de magnitud ni transacción única.** El §9.2 enumera las tablas pero no muestra los
   `where`. Un `delete` al que se le escape el filtro (o un `establishment_id` mal pegado) se lleva "Santo Domingo" o
   datos de otra terminal, y el único remedio es el dump. Pedido: un `select count(*)` por tabla **antes**, con abort si
   los conteos se desvían de la magnitud esperada (~350 perfiles / ~2.045 eventos), todo dentro de **una** transacción
   con los asserts adentro, y un chequeo de que el conjunto de `establishment_id` tocados tiene cardinalidad 1.
3. **Los dos cierres en la misma transacción van a fallar** por las temp tables (ver M-3(b)). Si no se arregla M-3(b),
   el §9.2 tiene que hacer una transacción por rodeo (y por lo tanto un `set local` por transacción).
4. **El backup se nombra pero no se verifica.** Pedido: verificar que el archivo existe, pesa > 0 y contiene filas del
   `establishment_id` que se va a borrar, **antes** del primer `delete`.

Informativo (LOW, no bloqueante): el `sub` del paso 4 es el user id real de una persona, commiteado en la spec. No es un
secreto, pero la receta de impersonación conviene que viva como paso de runbook del leader y no como snippet
copiable-pegable en un documento de spec.

---

## Lo que auditué y está bien (para trazabilidad)

| # | Verificado | Evidencia |
|---|---|---|
| 1 | **Guard → cota → cortocircuito** en las 7, en ese orden. | `design` §3.6, §3.3 paso (1)-(2), §5.A fila §5.3 |
| 2 | **Ninguna de las 3 RPC nuevas recibe `establishment_id` del cliente**; el tenant sale de la fila del rodeo. La alternativa `close_campaign_for_establishment` está explícitamente descartada por reintroducir la superficie M1 de `0106` §5.1. | RCC.9.3, §5.B W4, §11 alt. 5, DP-11 |
| 3 | **`is_owner_or_vet_of` conserva `ur.active = true` y el join a `establishments … deleted_at is null`** (a nivel de especificación — ver H-3 por la falta de oráculo). | §4.1 contra `0005:38-47` |
| 4 | **Escrituras `VOLATILE`, no `STABLE`**, con `set search_path = public`, y el motivo documentado para que nadie lo "uniformice". | RCC.9.2, §5.B W1 |
| 5 | **`p_acknowledge_incomplete` no sirve para nada más que saltear el aviso.** No sortea el guard duro de `state_as_of > current_date` (§4.2 paso 5, testeado en TR.14d(f)); **no** setea `closed_incomplete`, que se deriva de `v_complete` computado en el server (`closed_incomplete = not v_complete`, T37); no modula volumen; y en el masivo va en dos pasadas para que el gesto grande no se coma el reconocimiento. Es un booleano tipado, sin efecto lateral. | §4.2 paso 7-bis, T35, T37, RCC.5.10.a |
| 6 | **Fail-closed bajo service_role**: `close_campaign` con la service_role key deja `auth.uid()` en null → `is_owner_or_vet_of` false → `42501`. Los fixtures de test tienen que usar clientes con JWT, no `admin`. | `0005:20` + §4.2 paso 2 |
| 7 | **Frontera de sync (DL8)**: verifiqué `sync-streams/rafaq.yaml` entero. 31 streams, **cada tabla declarada con un `SELECT` explícito**, **sin stream catch-all**, y las tres tablas nuevas ausentes. El invariante se cierra: agregar cualquiera al wire exige nombrarla en un `SELECT … FROM <tabla>`, que es lo que el guard de RCC.13.10 matchea. (Dos reservas menores en el anexo LOW.) | `sync-streams/rafaq.yaml:44-311` |
| 8 | **PII (ADR-025)**: ninguna tabla nueva guarda email ni teléfono. `closed_by`/`reopened_by`/`changed_by` son FK a `users(id)`. El snapshot congela `idv` (identificador del animal, no PII) y **no** copia `tag_electronic` / EID SENASA. | §2.2, §2.3, §5.B W11 |
| 9 | **Sin SQL dinámico**: los 3 parámetros nuevos son tipados de PostgREST (`uuid`, `int`, `boolean`), acotados server-side. §5.10 preservado. | §5.A fila §5.10 |
| 10 | **El detalle del snapshot sobrevive a la baja del animal sin `cascade`** (`on delete set null` + `idv` congelado) — no hay camino por el que borrar un animal vacíe un reporte cerrado. | §2.3, RCC.4.6 |
| 11 | **DL10 se resuelve por ausencia de código** (nada bloquea escribir un evento de campaña cerrada) y se testea explícitamente, sin trigger de rechazo que rompa el offline-first. | T41, RCC.8.1, TR.16 |
| 12 | **El guard de lectura no se endurece** (RCC.7.3 / W3): el `field_operator` sigue leyendo. Correcto: endurecerlo habría sido un cambio de authz no pedido por ①. | RCC.7.3, §5.B W3 |
| 13 | **Idempotencia y carrera del cierre**: índice único parcial + captura de `unique_violation` → devuelve el existente en vez de propagar el error. Nunca dos fotos vigentes. | §4.2 paso 8, §5.B W6, RCC.9.8 |
| 14 | **Firma tipada completa en el revoke/grant de `close_campaign` (`uuid,int,boolean`)** — la spec ya cazó que la firma vieja falla con `42883` y dejaría `EXECUTE` a `PUBLIC`. Buen catch preventivo. | T42 |

---

## Tabla de inputs (campos que tipea el usuario)

Este delta **no agrega ningún campo de texto libre, buscador ni prompt**. La pantalla nueva es una barra de estado con
botones y una hoja de confirmación sin input de texto (T62, T64, T64-bis). Lo que sí cruza la frontera cliente→servidor:

| Campo / parámetro | Origen | Límite | Validación | ¿OK? |
|---|---|---|---|---|
| `p_rodeo_id` (uuid) | selector de rodeo (`RodeoContext`), no tipeado | tipo `uuid` de PostgREST | **server**: `select … from rodeos where id = … and deleted_at is null` → `P0002`; luego guard de tenant | ✅ |
| `p_year` (int) | `YearStepper` (stepper, no tipeado) | `1900 .. current+1` | **server**: `22023` tras el guard, en las 3 RPC nuevas y en las 7 de lectura | ✅ (ver H-1: sin test con snapshot) |
| `p_acknowledge_incomplete` (boolean) | segundo toque de la hoja de confirmación | booleano | **server**: `coalesce(…, false)`; no sortea el guard duro; no setea el flag persistido | ✅ |
| `acknowledgeIncomplete` (wrapper TS) | call sites de `closeCampaign` | — | **sin default en el wrapper** a propósito, para que el compilador obligue a decidir en cada call site | ✅ (buena decisión, §7.1) |
| fan-out del cierre masivo | `RodeoContext` del usuario | N = rodeos del establecimiento del usuario | N llamadas del cliente, sin RPC de establecimiento; cada una re-guardada server-side | ✅ |
| `missing_at_close` / mensaje del `23514` | **generado en el server** (`campaign_missing_summary` sobre ints) | — | no hay input de usuario en la cadena; no se parsea el texto en el cliente (§5.C) | ✅ |

Ningún campo llega a un `.or()`, `.filter()`, `ilike` ni a un prompt. No hay concatenación de input de usuario en SQL.

## Tabla de rate limits (acciones abusables que toca el delta)

| Acción | ¿Rate limit? | Keyeo | ¿Fail-closed? | Nota |
|---|---|---|---|---|
| `close_campaign` (escritura, cómputo pesado) | **No** | — | El **guard** sí (owner/vet, `42501`); el **costo** no está acotado por frecuencia | Ver M-4: ~12× el cómputo de elegibilidad por llamada, iterable sobre ~126 valores de `p_year` × N rodeos. Supabase no rate-limitea PostgREST. |
| `reopen_campaign` | **No** | — | Guard sí | Barato (un `update`). No amplifica. |
| `rodeo_campaign_status` | **No** | — | Guard sí (`has_role_in`) | Recomputa 2 KPI en el camino abierto y se llama en cada focus de la pantalla (M-4.2). |
| Las 7 RPC de lectura | **No** (as-built) | — | Guard sí | El delta les **sube** el costo por llamada (cómputo histórico + `animal_category_at` por perfil). Pre-existente, agravado. |
| Cierre masivo por campo | **No** server-side | Acotado por construcción: N = rodeos del usuario, 2 pasadas | El guard corre en cada una de las N llamadas | Correcto que sea N llamadas del cliente (DP-11): sin fan-out server-side no hay amplificación de una request. |
| Auth (`[auth.rate_limit]`) | **n.a.** | — | — | El delta no toca `supabase/config.toml` ni ningún flujo de auth. Verificado. |
| Email / SMS / API externa | **n.a.** | — | — | El delta no manda nada ni pega a ninguna API externa. |

**Conclusión de rate limits**: no hay ninguna acción nueva que mande email/SMS ni pegue a un tercero, así que no hace
falta una cuota propia tipo Edge Function. Lo que sí queda abierto es el costo por llamada de `close_campaign` /
`rodeo_campaign_status`, que es M-4 (MEDIUM, no bloqueante) y cuya salida más barata es medirlo en T74 antes de deployar.

---

## Dominios del catálogo revisados

| Dominio | Aplica | Resultado |
|---|---|---|
| **A1** service-role / definer bypassa RLS | Sí — 3 RPC nuevas + 7 re-creadas + 1 trigger, todas `SECURITY DEFINER` | Scoping manual verificado; H-1 y H-3 son los huecos de verificación |
| **A2** mass assignment | Sí | Ninguna RPC hace spread de un body del cliente; los 21 campos del snapshot los computa el server (DL2/RCC.5.4) |
| **A3** IDOR por FK | Sí | `p_rodeo_id` valida la fila padre + guard; el detalle del snapshot deriva del cómputo, no de ids del cliente |
| **A4** function-level authz (BFLA) | Sí | Escritura = `is_owner_or_vet_of`; lectura = `has_role_in`. `field_operator` explícitamente excluido de escritura y testeado (T48) |
| **B1** `err.message` crudo al cliente | Sí | No aplica a SQL: los mensajes son literales de la propia función (`23514` con conteos del propio tenant). Sin fuga |
| **B2** PII en logs | Sí | Nada nuevo se loggea. Ver M-5 por el `users.name` |
| **B3** over-fetching column-level | Sí | Las 2 tablas de snapshot no tienen columnas que un rol activo no pueda ver ya vía `animal_profiles` |
| **C1** PowerSync sync rules | Sí | Las 3 tablas quedan fuera; `rafaq.yaml` verificado sin catch-all; guard de ausencia en TR.19 |
| **C2** Realtime | No | El delta no suscribe canales |
| **C3** data-at-rest local | No | Nada nuevo baja al SQLite local (consecuencia de C1) |
| **C4** stale-auth en replay | Parcial | El cierre es online-only (DL9) y se re-autoriza server-side en cada llamada. El único camino offline que toca datos nuevos es el UPDATE de `rodeo_id` que dispara el trigger, y ese ya pasa por la RLS de `animal_profiles` |
| **D1/D3** secretos | No | Sin secretos nuevos |
| **D2** imports Deno | No | Sin Edge Functions en el delta |
| **E1** queries sin tope | Sí | M-4 |
| **E2** denial-of-wallet | Sí | M-4 (costo de DB, no de terceros) |
| **E4** enumeration | Sí | `P0002` antes del guard = oráculo de existencia de `rodeo_id`; pre-existente y con UUID no adivinable → anexo LOW |
| **F1** PostgREST filter injection | Sí | No hay input de usuario en filtros; sin SQL dinámico |
| **F2/F3** import de archivos / SSRF | No | El delta no importa archivos ni hace `fetch` |
| **F4** XSS en email | No | No manda emails |
| **G** BLE | No | Fuera de alcance |
| **H1** invalidación de sesión | Sí | H-3 es exactamente esto: que la revocación de rol corte la escritura |
| **H3** token en URL | No | — |
| **I1** retención / borrado | Parcial | `on delete set null` en `closed_by`/`reopened_by` → anexo LOW |
| **I2** audit tamper-evidence | Sí | La reapertura no borra: `reopened_at`/`reopened_by` + snapshot nuevo al re-cerrar. Append-only de hecho |
| **I3** mobile hardening | No | La pantalla no muestra nada nuevo sensible |

**Dominios excluidos y por qué**: BLE (G) — el delta no toca el bastón. Edge Functions / Deno (D2) — no hay ninguna.
SSRF e ingesta de archivos (F2/F3) — no hay `fetch` ni upload. Realtime (C2) — sin suscripciones. Todo lo excluido se
verificó por lectura de `design` §1 (tabla de archivos a crear/modificar), no por supuesto.

---

## Anexo LOW

- **L-1 · `P0002` antes del guard = oráculo de existencia.** `close_campaign`/`reopen_campaign`/las 7 de lectura levantan
  `P0002` cuando el rodeo no existe y `42501` cuando existe en otro tenant → distingue "existe en la DB" de "no existe".
  Idéntico al as-built (`0105:103`, `0106:67`), UUIDv4 no adivinable, y `reports.ts` mapea ambos a `forbidden` (§5.C).
  Sin cambio pedido; queda anotado para que no se "arregle" a medias en una sola función.
- **L-2 · Política de borrado del actor inconsistente entre las tablas nuevas.** `rodeo_campaign_snapshots.closed_by`
  y `reopened_by` son `on delete set null`; `rodeo_membership_history.changed_by` queda en `NO ACTION` (molde `0030:15`).
  Para un registro que se presenta como auditable a tres años (RCC.4.11), perder el actor si el usuario borra su cuenta
  es una decisión, no un default — y hoy las dos tablas del mismo delta toman decisiones opuestas. Unificar y decir cuál
  gana (`set null` es defendible por derecho de supresión, Ley 25.326).
- **L-3 · El guard de RCC.13.10 es un match de texto y case-sensitive.** Cierra el invariante en la práctica (el YAML es
  la fuente canónica, se deploya con `scripts/powersync-deploy.sh`, y no hay catch-all: agregar una tabla obliga a
  nombrarla). Dos reservas: hacerlo **case-insensitive** (`RODEO_MEMBERSHIP_HISTORY` lo burla hoy) y dejar escrito que no
  puede ver una edición manual en el dashboard de PowerSync — que el header del propio YAML ya declara fuera de proceso.
- **L-4 · `animal_category_at` no tiene guard de tenant.** Devuelve la categoría de cualquier `animal_profile_id`. Lo
  único que la protege es el `revoke … from authenticated`. Está bien cubierto (T14, T20, T49), pero conviene el
  `comment on function` diciendo "sin guard a propósito: no es alcanzable; si alguna vez se le da grant, hay que
  agregarle el guard primero".
- **L-5 · El `establishment_id` denormalizado de `rodeo_membership_history` puede quedar viejo.** El trigger dispara con
  `update of rodeo_id, status, deleted_at`; un cambio de `animal_profiles.establishment_id` no está en la lista. Hoy es
  inocuo porque la RLS de esa tabla usa `establishment_of_profile()` (DP-19) y `transfer_animal` crea un perfil nuevo en
  vez de mover el existente. Anotar el motivo en el `comment on column`, porque el día que alguien "optimice" la policy a
  `has_role_in(establishment_id)` (que es lo que hacen las otras dos tablas del mismo delta) esa columna pasa a ser
  frontera de autorización con un valor potencialmente stale.

---

## Qué hace falta para PASS

Bloqueante (los 3 HIGH), todo aditivo:

1. **H-1** — RCC.13.5.a y RCC.13.5.b nuevos + extender T48: IDOR cross-tenant sobre las **7** funciones de lectura y
   `rodeo_campaign_status` **con la campaña cerrada**, y `22023` con snapshot vigente.
2. **H-2** — RCC.4.8.a nuevo (procedencia del `establishment_id` en las 2 tablas de snapshot) + RCC.13.6.a nuevo (un
   `authenticated` no escribe en las 3 tablas nuevas, incluido el intento con `establishment_id` de otro tenant) +
   nombrar la columna y su fuente en T37/T38 + declarar el desvío de ADR-026 en DP-19.
3. **H-3** — RCC.13.5.c nuevo (`active = false` y establecimiento borrado → `42501`) + RCC.13.5.d nuevo (guard
   estructural de `is_owner_or_vet_of` contra `is_owner_of`).

No bloqueante pero se pide antes del deploy (M-1 a M-6): corregir la fila §5.6 de §5.A con el argumento real y su test;
completar la lista de revokes con las dos funciones de F8; `set search_path = public, pg_temp` + resolver el doble cierre
en una transacción; corregir la cota de costo de W8 y medirla en T74; pasar `closed_by_name` a `user_roles.member_name`;
y acotar el procedimiento del §9 con `set local role authenticated`, asserts de magnitud, transacción única y
verificación del backup.

Ninguna de las decisiones de dominio (D1-D3, DL1-DL10, ①/②) se cuestiona: son input fijo del Gate 0 y este informe no
las toca.
