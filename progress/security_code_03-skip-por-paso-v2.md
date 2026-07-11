# Gate 2 (security_analyzer modo `code`) — delta `03-skip-por-paso-v2`

**Veredicto: PASS — 0 findings HIGH.** Frontend puro (ADR-028 Nivel A), cero backend/RLS/schema. Baseline `42f76c5`. (Reporte devuelto inline por el analyzer; persistido acá por el leader para el registro.)

## Focos verificados
1. **SQL injection por interpolación de tabla** (`maneuver-skip.ts:138-143` `buildManeuverEventSoftDeleteQuery`): SEGURO. `${table}` viene SIEMPRE de la unión de tipo cerrada `ManeuverEventTable` (7 literales) alimentada por el switch `tableForStepValue` (literales hardcodeados) o el literal `'custom_measurements'` — nunca de input de usuario (patrón allowlist recomendado para identificadores no parametrizables). El `id` va como arg `?` parametrizado (`runLocalWrite` → `db.execute(sql,args)`), sin concatenación.
2. **Reset de ids del paso** (`carga.tsx` corrección captura→skip): SEGURO. El descarte se scopea a `{ [maneuver]: prev }` → `collectManeuverDiscardTargets` solo toca las filas de ESE paso; el reset borra solo los refs de esa maniobra; re-captura genera id fresco → INSERT limpio, row viejo oculto por `deleted_at`. El `useEffect` keyed en `[profileId]` resetea todos los refs al cambiar de animal → sin fuga cross-animal.
3. **Fail-closed**: si el soft-delete del descarte falla, el frame NO marca skipped ni avanza (`if (!del.ok) { setCaptureError(...); return; }`). Sin filas huérfanas.
4. **Input de texto libre nuevo**: NINGUNO. El skip es estado puro; el label del pill sale de un mapa cerrado (`skipStepButtonLabel`, ≤9 chars); el chevron D2 es un View. Cero entrada de usuario.
5. **Multi-tenant**: `establishment_id`/`sessionId`/`profileId` del contexto/route, nunca hardcodeados ni fabricados.

## Observaciones para Gate 2.5 (veto visual del leader) — del reviewer, no del security
- squeeze de la caravana en línea 1 con un IDV largo (solo-RFID)
- contraste del chevron terracota (medido 5.1:1 — OK)
- `teeth_state` no revertido en corrección→salteado (dientes = UPDATE de propiedad, no fila de evento; misma limitación documentada del skip — el frame no transporta el estado previo)
