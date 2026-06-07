baseline_commit: b897703a0e5cd245b15dc39391b779e460873ef2

# impl 02 — C4 Lotes (frontend de management_groups)

Feature: spec 02 C4 — gestión de lotes (`management_groups`, ADR-020). FRONTEND PURO (backend 0037 ya aplicado al remoto). Gate 1 N/A. Fuente de verdad: `specs/active/02-modelo-animal/context-c4-lotes.md` (Gate 0 aprobado por Raf).

## Estado
LISTO PARA REVIEW. C4 completo y FUNCIONANDO de punta a punta, incluido el borrado de lote (soft-delete vía RPC `soft_delete_management_group`). NO hay bloqueante de backend (ver "Corrección del falso bloqueante" abajo: lo que la corrida previa reportó como "bug de RLS" era un error de MECANISMO en el frontend — UPDATE directo en vez del RPC ya desplegado).

## Archivos tocados
- **`app/src/services/management-groups.ts`** (extendido, no reescrito): + `createManagementGroup`, `renameManagementGroup`, `softDeleteManagementGroup` (D1: clear-NULL directo → soft-delete vía RPC `soft_delete_management_group`, 2 pasos no atómicos), `assignAnimalToGroup` (assign/clear), `fetchGroupMembers`. Patrón `ServiceResult` + `classifyError` + `classifyDeleteError` (mapea 42501/P0002 del RPC a copy es-AR). Split write+read (RLS-on-RETURNING).
- **`app/src/services/animals.ts`**: `AnimalListItem` + `LIST_SELECT` + `toListItem` ahora incluyen `managementGroupId` (lo necesita `fetchGroupMembers` para filtrar miembros por lote). Cambio aditivo, no rompe callers.
- **`app/src/utils/management-group.ts`** (NUEVO): lógica pura — `validateGroupName` (espeja el CHECK `length(trim(name))>0` + tope 80) + gating por rol `canManageGroups` (owner) / `canAssignGroup` (cualquier rol operativo).
- **`app/src/utils/management-group.test.ts`** (NUEVO): 8 tests node:test (validación + gating). Registrado en `scripts/run-tests.mjs`.
- **`app/app/lotes.tsx`** (NUEVO `LotesScreen`, ruta `/lotes`): lista de lotes activos + CRUD owner-only (crear/renombrar inline + borrar con confirmación destructiva, copy D1) + ver-miembros (acordeón con `AnimalRow`). No-owner: read-only + InfoNote.
- **`app/app/animal/[id].tsx`**: nueva sección/control `LoteControl` (reemplaza la fila read-only "Lote" de "Datos del animal"). Asignar/cambiar/quitar (cualquier rol) + quick-create owner-only inline. Refresca la ficha al instante.
- **`app/app/_layout.tsx`**: registra `/lotes` como `Stack.Screen` + lo agrega a `RODEO_DESTINATIONS` (no se re-rutea al wizard en estado active).
- **`app/app/rodeos.tsx`**: link "Lotes" (sección "Otros grupos del campo") → `/lotes` (D2: gestión junto a Rodeos). Visible a todos los roles.
- **`app/app/(tabs)/mas.tsx`**: ActionRow "Lotes" bajo "Rodeos" (entry point alternativo, D2).
- **`app/e2e/lotes.spec.ts`** (NUEVO): flujo crear→asignar→ver-miembros (PASA) + borrar lote→reasignar a NULL (D1, test ACTIVO — verifica el efecto real: animal sin lote + lote ausente de la lista).
- **Specs reconciliadas** (`specs/active/02-modelo-animal/tasks.md`): T3.7, T4.5 marcadas [x] con scope C4; T4.2 nota del selector de lote (`LoteControl`). Scope narrowing documentado: el agrupamiento de display "lote/categoría" (R2.16) + vista rodeo-céntrica = spec 10 (fuera de C4, per context-c4-lotes).

## Cómo cubrí D1/D2/D3 + defaults
- **D1 (borrar con reasignación a NULL)**: `softDeleteManagementGroup` hace PRIMERO `UPDATE animal_profiles SET management_group_id=NULL WHERE management_group_id=id` (UPDATE directo — sin filtro de status: limpia TODA fila apuntando al lote, incluidos archivados → cero FK colgante; no choca con el gotcha porque no cambia la visibilidad SELECT del perfil), DESPUÉS el soft-delete del lote vía RPC `soft_delete_management_group(p_group_id)` (0041, SECURITY DEFINER owner-only). El UPDATE directo de `deleted_at` daría 42501 (la fila sale de la SELECT-policy `deleted_at is null`); por eso va por RPC. El error del RPC (42501 no-owner / P0002 inexistente) se traduce con `classifyDeleteError` a copy es-AR. 2 pasos NO atómicos, documentado en el JSDoc igual que la no-atomicidad del split de `createAnimal` (estado recuperable e idempotente: si el RPC falla, animales en NULL + lote vivo → reintento). Confirmación destructiva con copy D1 ("sus N animales quedan sin lote"); N = conteo de miembros ACTIVOS (vía `fetchGroupMembers`). Usa un RPC ya desplegado (0041), sin migración nueva → Gate 1 sigue N/A.
- **D2 (entry point junto a Rodeos)**: `/lotes` se llega desde `RodeosScreen` (sección "Otros grupos del campo") y desde "Más" (ActionRow "Lotes"). Mismo patrón de nav que `/rodeos` (Stack.Screen + RODEO_DESTINATIONS). Asignar día-a-día desde la ficha (no hace falta entrar a /lotes).
- **D3 (ver-miembros)**: tap en un lote (LotesScreen) → acordeón con `fetchGroupMembers(establishmentId, groupId)` (activos del lote) renderizados con `AnimalRow` (reuso de C2). Tap en un animal → su ficha.
- **Default — nombres duplicados**: `hasDuplicateName` (de `utils/establishment`) avisa con InfoNote en crear (vs todos) y renombrar (excluye el propio lote); NO bloquea (ADR-020 texto libre).
- **Default — asignar sin lotes existentes**: owner ve "Crear lote nuevo" inline en el selector de la ficha; no-owner sin lotes ve "Todavía no hay lotes en este campo. Pedíle al dueño que cree uno."
- **Default — gating de UI por rol**: owner ve crear/renombrar/borrar (`canManageGroups`); no-owner ve read-only y SÍ puede asignar/quitar (`canAssignGroup`). RLS = barrera autoritativa; la UI solo evita botones muertos.
- **Default — `active` no se expone**: "borrar" = soft-delete (`deleted_at`); el toggle `active` no se toca.
- **Default — RLS-on-RETURNING**: ningún `.insert().select()`/`.update().select()` en un roundtrip; create diffea before/after, update usa count:'exact' sin select.
- **Default — errores crudos → copy es-AR**: `kind:'unknown'` muestra el `message` accionable del service (nunca el PostgREST crudo), `network` → copy "necesitás conexión".

## Multi-tenant / seguridad
- NUNCA se hardcodea `establishment_id`: LotesScreen lo lee de `EstablishmentContext` (campo activo); la ficha lo lee de `detail.establishmentId` (el campo del PERFIL, no el activo — mismo cuidado que `canExit`, por si el usuario tiene otro campo activo mientras mira una ficha de otro campo).
- `canQuickCreateLote` (ficha) es owner-only Y solo si el animal pertenece al campo activo (no podemos saber el rol en otro campo desde el contexto → conservador). Asignar sí se ofrece siempre (si ves la ficha, tenés rol en ese campo por `has_role_in` → RLS te deja asignar; un 0-filas se traduce a copy).
- El trigger 0037 valida server-side que el lote sea del mismo establishment del perfil (no se puede asignar un lote de otro campo).

## Autorrevisión adversarial (paso 8)
Busqué activamente:
- **Botón muerto (UI ofrece lo que RLS prohíbe)**: no-owner NO ve crear/renombrar/borrar (gated por `canManageGroups`); quick-create owner-only. ✔
- **FK colgante al borrar**: clear-NULL (todas las filas, sin filtro status) ANTES del soft-delete vía RPC. ✔ (consistente y recuperable aun si el RPC fallara: el clear corre y deja animales en NULL; el clear es idempotente para el reintento).
- **Leak cross-tenant**: siempre se filtra por el establishment correcto (activo en LotesScreen; del perfil en la ficha). ✔
- **Quitar lote (→NULL)**: opción "Sin lote" → `assignAnimalToGroup(id, null)`. ✔ (probado en e2e indirecto + repro).
- **Duplicados avisan sin bloquear**: InfoNote, submit procede. ✔
- **Ficha refleja el lote al instante**: `onAssign` llama a `load()` (refetch detalle+grupos). ✔ (probado en e2e: tras asignar, "Lote actual" muestra el lote y el trigger pasa a "Cambiar lote").
- **a11y label == texto visible**: FIX encontrado en autorrevisión vía e2e — el trigger del selector tenía aria-label fijo "Cambiar lote" mientras el texto visible era "Asignar a un lote" (cuando no hay lote) → el nombre accesible (y el e2e por rol) no coincidían. Corregido: `triggerLabel` dinámico compartido por el aria-label y el texto.
- **tests que pasan por la razón equivocada**: el e2e asigna y verifica que el lote queda como "Lote actual" Y que el trigger cambia a "Cambiar lote" (no solo que el texto aparezca); ver-miembros verifica que el `AnimalRow` del idv sembrado aparece DENTRO del acordeón.

## check.mjs
- typecheck client: OK (0 errores).
- client unit tests: 628 pass / 0 fail (incluye los 8 nuevos de management-group; baseline previo 620).
- Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components.
- Backend suites (RLS/Edge/Animal/Maneuvers/User_private/Import): todas verdes.
- Salida final: "[OK] Entorno listo. Podés trabajar."

## Tests nuevos
- `app/src/utils/management-group.test.ts` — 8 casos: validateGroupName (normal/trim, vacío, solo-espacios, límite exacto, pasado el límite, trim-antes-de-medir) + canManageGroups (owner-only) + canAssignGroup (cualquier rol operativo).
- `app/e2e/lotes.spec.ts` — `crear lote → asignar desde la ficha → ver miembros` (PASA) + `borrar lote → su animal queda reasignado a NULL (D1)` (ACTIVO — verifica que tras borrar, el lote desaparece de la lista Y el animal vuelve a "Sin lote"; soft-delete vía RPC).

## Corrección del falso bloqueante (fix-loop — sesión siguiente)

La corrida previa reportó acá un "BLOQUEANTE de backend: el owner no puede soft-deletear management_groups (ni rodeos)". **Esa conclusión era FALSA.** No hay bug de backend. Lo dejo desmentido y corregido:

- **Qué pasaba de verdad**: era un error de MECANISMO en el frontend. `softDeleteManagementGroup` hacía el soft-delete con un `UPDATE management_groups SET deleted_at = now()` **directo** vía PostgREST. Ese 42501 es comportamiento ESPERADO y documentado: PostgREST exige que la fila siga visible bajo la policy de SELECT tras el UPDATE; la SELECT de `management_groups` filtra `deleted_at is null`, así que al setear `deleted_at` la fila sale de visibilidad → rechazo. Es el MISMO gotcha RLS-on-RETURNING ya conocido del repo, en su variante soft-delete — no una falla de la policy.
- **La solución ya estaba desplegada**: `supabase/migrations/0041_soft_delete_rpcs.sql` define el RPC `soft_delete_management_group(p_group_id uuid)` (SECURITY DEFINER, owner-only, `grant execute ... to authenticated`) creado EXACTAMENTE para esto. Su header documenta el gotcha y la decisión de canalizar TODOS los soft-deletes de spec 02 (rodeos / management_groups / animal_events / eventos) por RPC. El frontend solo tenía que llamarlo.
- **El fix**: `softDeleteManagementGroup` mantiene el paso 1 (clear-NULL por UPDATE directo, que SÍ funciona — no toca la visibilidad SELECT del perfil) y reemplaza el paso 2 por `supabase.rpc('soft_delete_management_group', { p_group_id: id })`. El error del RPC se mapea con `classifyDeleteError` (42501→"solo el dueño", P0002→"el lote ya no existe", network→copy de conexión; nunca el sqlerrm crudo). Sigue siendo 2 pasos no atómicos (recuperable; documentado en el JSDoc).
- **La afirmación "el mismo bug rompe rodeos" también era FALSA**: rodeos ya borra vía el RPC `soft_delete_rodeo` (0041) — C1 nunca estuvo roto. No había nada que "cazar" en C1; la corrida previa nunca lo verificó por UI y asumió mal.
- **Verificación**: `node scripts/check.mjs` VERDE; el test e2e `borrar lote → su animal queda reasignado a NULL (D1)` quedó ACTIVO (sin `.fixme`) y verifica el efecto real (animal vuelve a "Sin lote" + el lote desaparece de la lista).

## Hallazgos fuera de alcance (NO arreglados — reportados)

### [menor, anotado] Conteo del copy D1 cuenta solo activos
- El copy "sus N animales quedan sin lote" usa N = miembros ACTIVOS; un animal archivado que apuntaba al lote no se cuenta en N pero SÍ se limpia su FK (correcto). Aceptable (el productor razona en animales activos). No se arregla.

### Numeración de migración del repo
- El archivo de backend es `supabase/migrations/0037_management_groups.sql` (como dice el brief), pero `tasks.md` lo nombra como `0036`. Discrepancia de numeración lógica vs as-built (current.md ya documenta que el disco renumera). No toqué nada — anotado.
