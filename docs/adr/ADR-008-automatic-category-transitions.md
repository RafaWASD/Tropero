# ADR-008 — Transiciones Automáticas de Categoría con Override Manual

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

En cría bovina, los animales se mueven entre categorías productivas según eventos biológicos:

| Categoría | Definición |
|---|---|
| Ternero/Ternera | Animal al pie de la madre, sin destete |
| Vaquillona | Hembra destetada, pre-servicio |
| Vaquillona preñada | Vaquillona con tacto positivo |
| Vaca segundo servicio | Hembra que parió una vez |
| Multípara | Hembra que parió dos o más veces |
| CUT | Criando Último Ternero (vaca de descarte por edad/dientes) |
| Toro | Macho reproductor |

En sistemas tradicionales (papel, Excel), el productor mueve manualmente animales entre categorías. Esto genera errores: animales que parieron pero quedaron como "vaquillona preñada" para siempre, vacas viejas que nunca se marcan CUT, etc.

Si la app puede **inferir las transiciones automáticamente** desde los eventos cargados, el productor no se olvida y los reportes son siempre correctos.

Pero hay casos edge donde la inferencia automática puede equivocarse:
- Vaca comprada como multípara sin historial cargado en el sistema
- Aborto que el productor no carga
- Vaquillona que falla pero el campo decide darle segunda oportunidad
- Hembras de cabaña con tratamiento reproductivo experimental

## Decisión

**Transiciones automáticas activas por defecto, con flag `category_override` para forzar manual**.

### Transiciones automáticas

| Desde | Hacia | Trigger |
|---|---|---|
| Vaquillona | Vaquillona preñada | Registro de tacto con `pregnancy_status` distinto de `empty` |
| Vaquillona preñada | Vaca segundo servicio | Registro de evento `birth` (parto) |
| Vaca segundo servicio | Multípara | Registro de segundo evento `birth` |
| Cualquier vaca | CUT | Manual (con prompt automático al cargar dientes 1/2, 1/4 o sin dientes) |

### Override manual

Cada `animal_profile` tiene un boolean `category_override`:
- `false` (default): la categoría se recalcula automáticamente al cargar eventos
- `true`: la categoría queda fija, no se modifica por eventos

El override se activa cuando el usuario cambia manualmente la categoría desde la ficha del animal.

### Categorías especiales: CUT y Dientes

CUT (Criando Último Ternero) es siempre manual, pero la app **sugiere automáticamente** marcar CUT cuando se carga estado de dientes 1/2, 1/4 o sin dientes (lo que indica vaca de descarte por edad).

UX del prompt:
```
Cargaste dientes: 1/2
Este estado indica vaca vieja.
¿Marcar como CUT (Criando Último Ternero)?

[ Sí, marcar CUT ]  [ No, solo dientes ]
```

## Alternativas consideradas

### Solo categorías manuales (sin inferencia)
- **Pros**: simple, predecible
- **Contras**: errores garantizados con el tiempo, reportes deficientes

### Inferencia automática sin override
- **Pros**: data más consistente
- **Contras**: no maneja edge cases reales del campo, frustra a usuarios que necesitan corregir

### Inferencia con confirmación en cada caso
- **Pros**: máxima precisión
- **Contras**: fricción operativa inaceptable

### Categorías derivadas como views (no almacenadas)
- **Pros**: nunca se desincronizan
- **Contras**: imposible hacer override manual (categoría es función pura de eventos)

## Consecuencias

**Positivas**:
- Reportes consistentes: la categoría siempre refleja la realidad biológica conocida
- Productor no se olvida de mover animales entre categorías
- Casos edge (compra, aborto no cargado, decisiones de campo) se manejan con un toggle
- Validaciones cruzadas posibles: si la app espera parto pero no llega, se puede alertar

**Negativas**:
- Lógica de transiciones tiene que estar en backend (Edge Functions) para enforcement
- Hay que duplicarla en cliente para preview offline (riesgo de divergencia)
- Tests críticos para evitar regresiones

**Mitigaciones**:
- Lógica encapsulada en un módulo TypeScript reutilizado por cliente y edge function
- Tests unitarios de todos los caminos de transición
- Botón "ver historial de cambios de categoría" en ficha del animal (auditoría)

**Notas de implementación**:
- Trigger en Postgres al insertar `reproductive_events` que evalúa transición
- O alternativamente: lógica en Edge Function que se llama desde el cliente al cargar evento
- En offline: cliente calcula la transición localmente; al sincronizar, backend revalida
- `category_override = false` por default en nuevos animales
- Cambiar manualmente la categoría desde la ficha → `category_override = true` automáticamente
- Botón "permitir actualización automática" → vuelve `category_override = false` y recalcula
