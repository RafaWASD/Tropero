-- 0126_user_private_phone_format.sql — Delta TELÉFONO de spec 01 (RTEL.7.*).
--
-- Normaliza public.user_private.phone al canónico '+54' + 10 dígitos nacionales (o '+' + 8..15 dígitos
-- para el escape internacional) e impone un CHECK de formato AUTORITATIVO.
--
-- Por qué el CHECK y no "el cliente ya valida": el bundle de React Native es modificable por el usuario
-- y PostgREST es alcanzable directo con su propio JWT; `user_private_update_self` (0068:105-114) autoriza
-- cualquier UPDATE de la FILA PROPIA. Hoy eso permite escribir CUALQUIER string de ≤32 chars en una
-- columna de PII — incluidos saltos de línea, comillas y control chars. La validación del cliente es UX;
-- esta es la única frontera real (RTEL.5.6).
--
-- ⚠️ PII: ningún raise notice/exception de ESTA MIGRACIÓN imprime un teléfono ni un email — solo conteos
--    y `user_id` opacos (RTEL.7.5, patrón 0068:75-87).
--
-- ⚠️ RIESGO RESIDUAL ACEPTADO (R-7, HIGH-1 del Gate 1): el CHECK de abajo, al rechazar en RUNTIME, hace
--    que Postgres emita `DETAIL: Failing row contains (...)` con TODAS las columnas sobre las que el rol
--    tiene SELECT — y `authenticated` tiene `grant select` sobre user_private (0068:200) → email +
--    teléfono EN CLARO en el log del servidor, sujeto a su retención y drains, sobreviviendo a
--    delete_account. ACEPTADO (decisión del leader) porque: (a) es SELF-SCOPED — la RLS impide que el
--    UPDATE toque una fila ajena, así que el DETAIL solo puede contener PII propia del usuario que
--    dispara el error; (b) la audiencia del log son quienes ya tienen acceso a la DB; (c) con el cliente
--    y el CHECK alineados en TODOS los bordes (incluido el primer dígito ≠ '0', MEDIUM-1), el rechazo es
--    prácticamente inalcanzable en operación normal. Descartado un trigger BEFORE con excepción propia:
--    reintroduce superficie imperativa (search_path/security definer) por un DETAIL self-scoped.
--    Ver design-telefono.md §8 R-7. Las patas de esa aceptación son RTEL.2.9 (un solo origen de la
--    normalización, verificado por phone-vectors.json desde las dos suites) y RTEL.8.5/8.6 (la PII
--    tampoco viaja al cliente por error.details, verificado por classify-error.test.ts).
--
-- ⚠️ DEPLOY COORDINADO con el release del cliente: un cliente viejo que escriba formato no canónico
--    recibe 23514. Es beta con release coordinado; la UI ya traduce ese código a un copy accionable
--    sobre el formato (RTEL.8.3), no a un error genérico.
--
-- NO toca: policies, grants, streams de PowerSync, triggers, el tipo de la columna (sigue text nullable)
-- ni `user_private_phone_len_chk` de 0070 (RTEL.7.6/RTEL.7.7 — el CHECK de formato ya es estrictamente
-- más fuerte; el cap de 32 queda como cota externa de defensa en profundidad). NO crea índices ni
-- constraints de unicidad sobre phone (RTEL.11.8: el canónico descarta el bit móvil/fijo, así que
-- COLAPSA un móvil y un fijo del mismo número nacional → no es un identificador de abonado).
--
-- Todo en UNA transacción (atomicidad, RTEL.7.8): si algo falla, no queda el constraint agregado ni
-- filas parcialmente normalizadas.

-- =====================================================================
-- T1 — CHECK de formato, NOT VALID (RTEL.7.1, RTEL.7.2)
-- =====================================================================
-- Va PRIMERO como NOT VALID para que un backfill con bugs falle DE INMEDIATO, en la fila que lo dispara,
-- en vez de producir en silencio un valor no canónico que recién explotaría al final en el VALIDATE (con
-- un error mucho más difícil de ubicar). NO es por concurrencia: en una migración de una sola
-- transacción el ADD CONSTRAINT toma ACCESS EXCLUSIVE hasta el commit, así que los writers concurrentes
-- BLOQUEAN — no quedan "gobernados" por nada, esperan.
alter table public.user_private
  add constraint user_private_phone_format_chk
  check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$') not valid;

-- =====================================================================
-- T2 — Backfill: reglas N1..N6 (RTEL.7.3)
-- =====================================================================
-- Son las MISMAS reglas de app/src/utils/phone.ts, incluida la precedencia '+' / no-'+' (RTEL.2.10):
-- sin ella un '+34 600 12345' (10 dígitos con código de país) se convertiría en un teléfono argentino
-- INVENTADO. El prefijo '15' NO se remueve (RTEL.2.8): localizarlo exige la tabla de códigos de área,
-- que es cosmética por diseño — si participara de la escritura, un largo de área mal clasificado
-- recortaría los dígitos equivocados y persistiría en silencio un teléfono incorrecto.
do $$
declare
  r        record;
  v_digits text;
  v_intl   boolean;
  v_canon  text;
  v_count  int := 0;
begin
  for r in select user_id, phone from public.user_private where phone is not null loop
    v_digits := regexp_replace(r.phone, '\D', '', 'g');
    v_intl   := left(btrim(r.phone), 1) = '+';
    v_canon  := null;

    if v_intl then
      if    length(v_digits) = 13 and left(v_digits, 3) = '549' then v_canon := '+54' || right(v_digits, 10);
      elsif length(v_digits) = 12 and left(v_digits, 2) = '54'  then v_canon := '+'   || v_digits;
      -- MEDIUM-1: primer dígito <> '0'. Ningún código de país del plan E.164 empieza con 0 (el 0 es
      -- prefijo troncal NACIONAL, que es justo lo que descarta N3) y el CHECK de T1 (^\+[1-9]...) lo
      -- exige. Sin esta condición el backfill produciría un valor que el propio VALIDATE de T4
      -- rechazaría, abortando la migración por un bug nuestro.
      elsif length(v_digits) between 8 and 15 and left(v_digits, 1) <> '0'
                                                                then v_canon := '+'   || v_digits;
      end if;
    else
      if    length(v_digits) = 10                               then v_canon := '+54' || v_digits;
      elsif length(v_digits) = 11 and left(v_digits, 1) = '0'   then v_canon := '+54' || right(v_digits, 10);
      elsif length(v_digits) = 12 and left(v_digits, 2) = '54'  then v_canon := '+'   || v_digits;
      elsif length(v_digits) = 13 and left(v_digits, 3) = '549' then v_canon := '+54' || right(v_digits, 10);
      end if;
    end if;

    if v_canon is not null and v_canon is distinct from r.phone then
      update public.user_private set phone = v_canon where user_id = r.user_id;
      v_count := v_count + 1;
    end if;
  end loop;

  raise notice '0126: % fila(s) de user_private.phone normalizada(s)', v_count;  -- SOLO el conteo
end $$;

-- =====================================================================
-- T3 — Precheck ABORTIVO del residuo (RTEL.7.4, DP3)
-- =====================================================================
-- Grandfatherear (CHECK NOT VALID sin VALIDATE, como 0070 hace con animals.tag_electronic) NO es opción
-- acá, y la razón es de CORRECTITUD, no de prolijidad: Postgres evalúa TODOS los CHECK de una fila en
-- CUALQUIER update, cambie o no la columna restringida, y NOT VALID solo saltea el re-chequeo de las
-- filas EXISTENTES. El trigger `propagate_confirmed_email` (0068:169-194) hace
-- `update public.user_private set email = ... where user_id = ...`: con un phone legacy sucio en esa
-- fila, ESE update fallaría y ABORTARÍA la confirmación de cambio de email de ese usuario. Dejar filas
-- sucias es dejar una bomba de tiempo en un flujo de auth. → residuo CERO antes del VALIDATE.
--
-- ⚠️ NO "OPTIMIZAR" SACANDO ESTE BLOQUE por creerlo redundante con el VALIDATE de T4 (RTEL.2.9.2): el
--    backfill de T2 es un TERCER ENCODING de las reglas (PL/pgSQL, además del TypeScript del cliente y
--    del regex del CHECK). Este precheck es lo que garantiza su equivalencia — corre DESPUÉS del
--    backfill y ANTES del VALIDATE, así que si el do $$ produjera un valor que el CHECK no acepta, la
--    migración aborta en vez de persistirlo, y el mensaje dice exactamente qué mirar.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.user_private
  where phone is not null and phone !~ '^\+[1-9][0-9]{7,14}$';

  if v_bad > 0 then
    -- MEDIUM-2: se da la QUERY de reconciliación, no solo el diagnóstico (una instrucción sin
    -- herramienta deja al operador sin el paso siguiente). Devuelve SOLO user_id — un UUID opaco, no
    -- PII de contacto — así que puede viajar en el mensaje sin abrir el leak que RTEL.7.5 cierra.
    raise exception
      '0126 abortada: % fila(s) de user_private.phone no se pudieron normalizar al canónico. '
      'Los valores NO se listan (PII). Para ubicarlas, ejecutar: '
      'select user_id from public.user_private where phone is not null '
      'and phone !~ ''^\+[1-9][0-9]{7,14}$''; '
      'Corregir cada fila POR user_id (sin copiar la columna phone a archivos, logs, chat ni capturas) '
      'y re-aplicar.',
      v_bad;
  end if;
end $$;

-- =====================================================================
-- T4 — Recién ahora el re-chequeo retroactivo es seguro (RTEL.7.2)
-- =====================================================================
alter table public.user_private validate constraint user_private_phone_format_chk;

comment on constraint user_private_phone_format_chk on public.user_private is
  'Formato canónico del teléfono (spec 01, delta telefono, RTEL.7.1): NULL o E.164-sintáctico '
  '(+ seguido de 8 a 15 dígitos, sin separadores). Para AR el canónico es +54 + los 10 dígitos '
  'nacionales, SIN el 9 de celular (no es derivable de los 10 dígitos; inventarlo corrompe los fijos de '
  'forma irrecuperable). Validación AUTORITATIVA: el cliente valida solo por UX. Cap complementario de '
  'longitud: user_private_phone_len_chk (0070). NO usar phone como clave de identidad ni para dedup de '
  'cuentas: al descartar el 9, un móvil y un fijo del mismo número nacional colapsan al mismo string.';

notify pgrst, 'reload schema';
