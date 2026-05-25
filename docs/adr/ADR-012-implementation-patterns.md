# ADR-012 — Patrones de implementación: trigger-vs-edge-function, tests RLS en Node, Supabase CLI como devDep

**Status**: Accepted
**Fecha**: 2026-05-25
**Decisores**: Raf (aprobación), implementer (propuestas durante Fase 0 + Fase 1)

## Contexto

Durante la implementación de Fase 0 + Fase 1 de la feature `01-identity-multitenancy` aparecieron tres decisiones técnicas que no estaban contempladas en la spec ni en ADRs previos, pero que tuvieron impacto directo sobre la forma en que se construyó (y se va a construir) el backend del MVP. Las anoto acá para que futuras features sigan los mismos patrones — o los desafíen explícitamente si tienen buenas razones.

Las tres decisiones se tomaron durante la sesión del 2026-05-25 y se validaron con tests pasando (15 tests RLS verdes contra la DB remota).

## Decisiones

### 1. Trigger Postgres para auto-creación de `user_roles` owner al crear establishment, en lugar de Edge Function

**Qué hacemos**: cuando un usuario hace `insert into establishments(...)`, un trigger `AFTER INSERT` llamado `handle_new_establishment` (migration `0011`) crea automáticamente la fila correspondiente en `user_roles` con `role = 'owner'` y `active = true` para `auth.uid()`. Esto cubre `R3.2` sin necesidad de una Edge Function `create_establishment`.

**Alternativa descartada**: una Edge Function que recibiera el payload del establishment, hiciera el insert con `service_role`, creara la membership en la misma transacción, y devolviera el `id`.

**Razón de elegir trigger**:
- Una sola roundtrip cliente → DB.
- Atomicidad garantizada por Postgres (transacción del INSERT envuelve el trigger).
- Menos infraestructura de Edge Functions que mantener para un caso simple.
- RLS sigue protegiendo el insert (`establishments_insert` policy verifica `auth.uid() is not null`).

**Trade-off conocido**: PostgREST evalúa el SELECT del `RETURNING *` antes (o sin ver) la fila que el trigger AFTER INSERT crea en `user_roles`. Resultado: `insert(...).select()` falla con `42501` aunque la fila se persistió bien y la membership se creó. **Implicación para el cliente** (T4.4): hacer insert sin `.select()` y luego un select separado, o usar Edge Function si el id se necesita en el mismo roundtrip.

**Aplicación a futuras features**: si una nueva entidad necesita lógica derivada en INSERT (ej: auto-crear una membership, asignar valores default complejos, registrar audit log), preferir trigger Postgres a Edge Function. Justificar el uso de Edge Function cuando se necesite: llamar APIs externas, manejar service_role explícito desde el cliente, o devolver datos calculados en el mismo roundtrip.

### 2. Suite de tests RLS en Node nativo + `supabase-js`, no en pgTAP

**Qué hacemos**: los tests de RLS viven en `supabase/tests/rls/run.cjs`, escritos en Node nativo (`node:test`), usando `@supabase/supabase-js` como cliente y `ws` como transport (Node 20 no trae WebSocket built-in por default). Cada test hace un login real con un user de prueba, ejerce la policy, y limpia los datos creados al final.

**Alternativa descartada**: pgTAP local con `supabase test db`. Habría requerido Docker corriendo Postgres local.

**Razón**:
- **Fidelidad**: los tests corren contra la DB remota real, exactamente con los JWTs que usaría la app en producción. pgTAP local nunca habría visto problemas de configuración de Auth o de PostgREST.
- **Sin Docker**: el entorno corporativo (Cylance Endpoint + Banco Patagonia) bloquea Docker Desktop. Resolver eso habría llevado días de fricción con IT.
- **Reutilización**: la suite usa el mismo cliente y el mismo `service_role key` que usaría la app o un script de admin. Cero código duplicado entre tests y runtime.

**Trade-off conocido**:
- Requiere conectividad para correr (no es test unitario aislable).
- Requiere `SUPABASE_SERVICE_ROLE_KEY` en `.env.local` (el runner saltea con warning si no está, no es failure).
- Más lento que pgTAP (≈3-10s por suite vs ms).
- No se puede correr en pipelines completamente sandboxed sin acceso outbound al proyecto Supabase.

**Aplicación a futuras features**: los tests de RLS y de Edge Functions van en `supabase/tests/`, en Node nativo. Si en algún momento el equipo crece y se necesita CI de unit-tests masivos, evaluar pgTAP como complemento (no reemplazo).

### 3. Supabase CLI como devDep npm de `app/`, no instalación nativa (Scoop/winget)

**Qué hacemos**: `supabase` está listado en `app/package.json` como devDependency. El paquete npm bundle el binario nativo via `optionalDependencies` (`@supabase/cli-windows-x64`, etc.). Está agregado a `pnpm.onlyBuiltDependencies` para permitir el post-install que descarga el binario.

**Alternativa descartada**: `scoop install supabase` o `winget install Supabase.CLI`. Ambos bloqueados por Cylance Application Control en el entorno actual.

**Razón**:
- Funciona en este entorno donde otras vías no.
- Versionado consistente entre devs futuros (el lockfile fija la versión).
- Un solo `pnpm.cmd install` instala toda la tooling, incluyendo la CLI.

**Trade-off conocido**:
- El binario nativo aumenta el tamaño de `node_modules/` en ~30 MB.
- Si en el futuro se quiere usar la CLI fuera de `app/` (ej: scripts en la raíz), hay que invocarla via `pnpm exec supabase ...` o agregar un alias.
- Si la versión empaquetada queda detrás de la última oficial (raro), hay que esperar al release de npm.

**Aplicación a futuras features**: tools de CLI que tengan paquete npm (`supabase`, `eas`, etc.) van como devDep. Si alguna tool NO tiene paquete npm, evaluar caso por caso.

## Consecuencias generales

**Positivas**:
- El backend de Fase 1 quedó cerrado con tests reales pasando.
- Las decisiones son reversibles: si más adelante alguna duele, se migra (trigger → Edge Function es ~1 día de trabajo, tests Node → pgTAP es similar).
- El entorno de desarrollo es reproducible vía `pnpm.cmd install` desde un repo limpio.

**Negativas**:
- Los tres patrones son específicos del entorno corporativo de Raf hoy. Si el desarrollo eventualmente se mueve a un setup más estándar (otra empresa, oficina propia, máquina personal), algunas de estas decisiones se pueden revisitar.
- Por la limitación RLS-on-RETURNING, el cliente tiene un patrón "split insert + select" no obvio. Documentado en `progress/impl_01-identity-multitenancy.md` y replicado en el flujo de creación de establishment (T4.4).

**Notas de implementación**:
- Cualquier futura migration que dependa de un trigger debe testearse explícitamente en la suite de Node.
- Si se agrega una nueva tabla con relación N:M, probablemente quiera el mismo patrón de "trigger AFTER INSERT crea membership default" si aplica.
- Si se decide en el futuro abrir el proyecto a contribuidores externos (open-source o equipo), evaluar si Docker para tests locales destrabados vale la pena.
