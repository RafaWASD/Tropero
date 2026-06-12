# impl_10-ui-a-iconfix — Fix CHICO: convención canónica de íconos rodeo/lote

Convención canónica: **rodeo = `Boxes` (cubos), lote = `Layers` (pila)**.

## Cambio aplicado
- `app/app/rodeos.tsx:230` — la fila de acción "Lotes" usaba `Boxes` (ícono de rodeo) → cambiado a `Layers`. Es el link a `/lotes` etiquetado "Lotes".
- `app/app/rodeos.tsx:23` — import `Boxes` reemplazado por `Layers`. Verificado: `Boxes` solo se usaba en esa única línea de `rodeos.tsx` (grep semántico), por lo que el reemplazo del import es limpio.

Nada más tocado. Cero hardcode. Sin screenshots (swap de ícono).

## Verificación SEMÁNTICA (por etiqueta real, no por nombre de archivo)

| archivo:línea | etiqueta (rodeo\|lote) | ícono | ¿correcto? |
|---|---|---|---|
| `(tabs)/index.tsx:664` | rodeo (card bajo "Mis rodeos") | `Boxes` | ✅ |
| `(tabs)/index.tsx:686` | lote (card bajo "Lotes") | `Layers` | ✅ |
| `(tabs)/mas.tsx:840` | rodeo (ActionRow label="Rodeos") | `Boxes` | ✅ |
| `(tabs)/mas.tsx:851` | lote (ActionRow label="Lotes") | `Layers` | ✅ |
| `animal/[id].tsx:926` | lote (DetailSection title="Lote") | `Layers` | ✅ |
| `animal/[id].tsx:964` | lote (trigger "cambiar lote" en sección Lote) | `Layers` | ✅ |
| `lotes.tsx:385` | lote (fila de lista en pantalla Lotes) | `Layers` | ✅ |
| `lote/[id].tsx:88` | lote (GroupViewScreen kindLabel="Lote") | `Layers` | ✅ |
| `rodeo/[id].tsx:80` | rodeo (GroupViewScreen kindLabel="Rodeo") | `Boxes` | ✅ |
| `rodeos.tsx:230` | lote (fila acción "Lotes" → /lotes) | `Layers` (FIX) | ✅ |

Recorridos los 10 usos de `Boxes`/`Layers` en `app/` que representan rodeo o lote, leyendo el label/contexto real de cada uno. **No queda ningún mismatch**: todo `Boxes` etiqueta un rodeo, todo `Layers` etiqueta un lote.

## Verificación técnica
- `cd app; pnpm.cmd typecheck` → verde (tsc --noEmit sin errores).
- `node scripts/check.mjs` → exit 0 (tests verdes, entorno listo).

No marco nada done — espera al leader/reviewer.
