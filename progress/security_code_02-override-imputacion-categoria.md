# Security Review (Gate 2, modo `code`) — delta `override-imputacion-categoria` (spec 02)

**Veredicto: PASS — 0 findings HIGH · 0 findings MEDIUM**

- Baseline: `5145943` (working tree sin commitear).
- Alcance: lógica PURA client-side (React Native / TypeScript). `git diff 5145943 -- supabase/` = **vacío** → sin superficie server-side nueva (Gate 1 N/A confirmado, no asumido).
- Skill: `sentry-skills:security-review` invocada sobre el diff → **No high-confidence vulnerabilities identified**. Validado manualmente + checklist RAFAQ-específico.

---

## Archivos analizados (diff vs `5145943`)

| Archivo | Cambio | Superficie |
|---|---|---|
| `app/src/utils/animal-birth-year.ts` | Campo aditivo `precision: 'exact'\|'year'\|'none'` en `BirthDateValidation`; `validateBirthDate` lo emite | Cliente, lógica pura |
| `app/src/utils/animal-category.ts` | Nueva `imputeBirthDateForCategory` + `AGE_WINDOWS` + `isoUtcDate`; `categoryOverrideFor` reenvía `today` | Cliente, lógica pura |
| `app/app/crear-animal.tsx` | Llama `imputeBirthDateForCategory` cuando `precision==='year'` antes de `createAnimal` | Cliente |
| `app/e2e/helpers/admin.ts` | Nueva `readServerProfileCategory` (oráculo E2E, service_role) | **Test-only** |
| `app/e2e/animals.spec.ts` | Test del oráculo | **Test-only** |
| `*.test.ts` (birth-year / category) | Tests unitarios | **Test-only** |

---

## Findings HIGH de Sentry

Ninguno. La skill no identificó vulnerabilidades high-confidence. El diff no contiene ninguno de sus patrones "always flag": no hay `eval`/`exec`, ni deserialización, ni `innerHTML`/`dangerouslySetInnerHTML`, ni template strings de SQL, ni command injection, ni secrets hardcodeados. Es aritmética de fechas pura.

## Findings RAFAQ-SPECIFIC

Ninguno. Detalle del checklist abajo.

---

## Focos revisados (validación manual + mandato del prompt)

### 1. La imputación NUNCA puede emitir una fecha futura (evasión del CHECK server-side) — CONFIRMADO seguro
`animals.birth_date` tiene CHECK de no-futuro server-side. Trazando `imputeBirthDateForCategory` (`animal-category.ts:170-215`):
- Rama con ventana etaria: `hi = Math.min(latestBirth, yearEnd, todayMid.getTime())` → `hi <= todayMid` **siempre**. El midpoint `mid = lo + floor(spanDays/2)*DAY_MS ≤ hi ≤ todayMid`. `todayMid = startOfDay(now)` es medianoche UTC de hoy → la fecha imputada ≤ UTC-hoy = `current_date` del server (Postgres UTC). No-futura garantizada por construcción.
- Todas las ventanas están alineadas a medianoche UTC (`yearStart/yearEnd` vía `Date.UTC`; `latestBirth/earliestBirth` = `todayMid ± k*DAY_MS`) → `mid` cae en medianoche → `isoUtcDate` limpio, sin drift de horas.
- Rama fallback (categoría sin ventana, o cruce vacío `lo > hi`): delega en `birthYearToDate(year, today)` (`animal-birth-year.ts:67-77`), que YA clampea a no-futuro ('07-01', o '01-01' si '07-01' cae adelante de hoy). No-futura garantizada.
- Conclusión: **ningún camino** de la imputación produce fecha futura. Si el reloj del dispositivo estuviera adelantado (clock attacker-controlled), el CHECK del server rechaza el insert → **fail-closed**, no bypass.

### 2. Parseo acotado / sin unbounded parsing — CONFIRMADO
`Number(yearOnlyIso.slice(0,4))` (`animal-category.ts:172`) sólo se ejecuta cuando `dateV.precision === 'year'` (`crear-animal.tsx:562`), es decir sobre la salida ya validada de `validateBirthDate` → `validateBirthYear` (4 dígitos, `≥ MIN_BIRTH_YEAR` 1980, `≤ currentYear`). El slice de 4 chars + `Number()` es intrínsecamente acotado (aritmética numérica, no string libre). No hay parseo de input crudo del usuario.

### 3. Validación de inputs NO debilitada — CONFIRMADO (aditivo)
El cambio en `BirthDateValidation` es **puramente aditivo**: agrega el campo `precision` a las variantes `ok:true`; no toca ninguna rama de rechazo. Todas las guardas siguen intactas: `validateBirthYear` (formato/no-futuro/cota inferior), `validateBirthDate` (todo-o-nada DD/MM, rango sin clamp, febrero bisiesto, fecha exacta no-futura), `sanitizeDayMonthInput` (tope 4 dígitos). La imputación consume la fecha **ya validada**, no la reemplaza como control. Los límites de cada campo de entrada se conservan (ver tabla).

### 4. Sin superficie server-side / multi-tenant / auth nueva — CONFIRMADO
`git diff -- supabase/` vacío. `birthDate` viaja al MISMO parámetro nombrado de `createAnimal` que ya existía (`crear-animal.tsx:584`), sin cambio de contrato. La categoría la sigue computando el server (`compute_category`) y el tenant lo deriva la RLS (comentario `crear-animal.tsx:610`, `establishmentId` no se usa para saltear RLS). El delta sólo cambia el VALOR de una fecha ya-validada. Ninguna decisión de autorización se mueve al cliente.

### 5. Mass assignment / over-posting — N/A (whitelist preservada)
`createAnimal` recibe campos discretos nombrados uno por uno (`crear-animal.tsx:577-597`); no hay `.insert(body)` ni spread del input del cliente. `birthDate` es la misma variable de antes, reasignada in-place. No se introduce `role`/`establishment_id`/`id` desde el cliente.

### 6. Information disclosure / logging — CONFIRMADO limpio
`grep console.` sobre el diff = 0 coincidencias. No se loggea la fecha imputada ni ningún dato. No hay `err.message` crudo devuelto al cliente (el path de error de `createAnimal` es preexistente y no lo toca el delta).

### 7. Estado inválido explotable — CONFIRMADO imposible
El peor caso de una imputación "equivocada" es un animal MAL CATEGORIZADO dentro del PROPIO tenant del usuario (data-quality), nunca cruce de frontera de seguridad. El `category_override` (bool) que se envía ya existía antes de este delta y sólo afecta animales propios; no es vector nuevo. La salida siempre es un ISO válido dentro del año y no-futuro → `compute_category` lo maneja.

### 8. Ciclo de imports — sin riesgo funcional/seguridad
`animal-category.ts` ahora importa `birthYearToDate` de `animal-birth-year.ts`. El header documenta (y verifiqué) que `animal-birth-year` importa sólo `event-timeline`, nunca `animal-category` → sin ciclo. No es tema de seguridad; se anota por trazabilidad.

---

## Cobertura Sentry vs. RAFAQ (advertencia de cobertura indirecta)

La skill de Sentry NO cubre nativamente Deno/RLS/PowerSync/BLE/React-Native. En este delta **no aplica ninguno de esos dominios**: es lógica pura client-side sin migrations, sin Edge Functions, sin sync rules, sin BLE. La revisión manual RAFAQ-específica (arriba) cubrió el gap y no encontró nada. El único uso de `service_role` (`readServerProfileCategory` en `admin.ts`) es infraestructura de test E2E (no se empaqueta en el bundle de Expo), scopeada por `.eq('id', profileId)` — no es superficie de producción.

---

## Tabla de inputs

| Campo | Límite (largo/charset/formato/rango) | Validación | OK? |
|---|---|---|---|
| Año nacimiento | 4 dígitos numéricos; `≥1980` y `≤ año actual` | `validateBirthYear` (client). Autoritativo: columna `date` + CHECK no-futuro server-side | Sí — no modificado |
| Día/Mes nacimiento | 4 dígitos `DDMM`, día 1..díasDelMes, mes 1..12, no-futuro | `validateBirthDate` + `sanitizeDayMonthInput` (client). Autoritativo: `date` + CHECK server-side | Sí — no modificado |

Ningún campo de entrada nuevo. El delta agrega derivación (`precision`) sobre inputs ya validados; no afloja ni introduce parseo sin acotar.

## Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| (ninguna acción abusable nueva) | n.a. | n.a. | n.a. | Frontend puro; no toca Edge Functions, email/SMS, APIs externas, bulk/import. El path `createAnimal` es preexistente y no se modifica su contrato ni su frecuencia |

## False positives descartados

La skill no reportó findings, así que no hubo que descartar ninguno. Preventivamente verifiqué que `Number(yearOnlyIso.slice(0,4))` y el uso de `service_role` en `admin.ts` no son findings: el primero opera sobre input ya validado y acotado; el segundo es test-only fuera del bundle.

---

## Dominios excluidos (con justificación)

- **A (authz/service-role/mass-assignment/IDOR)**: sin Edge Functions ni queries admin de producción nuevas; `createAnimal` mantiene whitelist de campos.
- **B (exposición de datos)**: sin nuevos `select('*')`, sin `err.message` al cliente, sin logging.
- **C (offline/sync/PowerSync/data-at-rest)**: no toca sync rules, Realtime, ni almacenamiento local; sólo deriva una fecha antes del write existente.
- **D (secrets/supply chain)**: sin secrets, sin imports remotos nuevos.
- **E/F/G (abuso a escala / inyección-ingesta / BLE)**: sin buscadores, sin `.or()/.filter()/ilike`, sin import de archivos, sin `fetch()` a URL de usuario, sin BLE.
- **H/I (auth-sesión / compliance-mobile)**: sin cambios de sesión, credenciales, retención ni pantallas sensibles.

Todos excluidos porque el diff es frontend puro de imputación de fecha + un campo aditivo en un validador existente.
