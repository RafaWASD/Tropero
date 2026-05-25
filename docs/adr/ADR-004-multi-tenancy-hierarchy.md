# ADR-004 — Jerarquía Multi-Tenant: User → Establishment → Rodeo → Animal

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

El producto se vende a múltiples productores (cada uno con uno o varios campos), y cada veterinario puede trabajar en varios establecimientos distintos. Adicionalmente:

- Un mismo establecimiento puede tener varias categorías productivas conviviendo (cría + invernada, o cría + cabaña genética)
- Los animales pueden moverse entre establecimientos a futuro (compra/venta) y deberían mantener su identidad
- El TAG electrónico (ISO 11784/11785) es único globalmente — un mismo animal con el mismo TAG no debería duplicarse aunque cambie de campo

## Decisión

**Modelo de jerarquía**:

```
USER  (cuenta de usuario, login)
  │
  │  ← relación many-to-many via user_roles
  │
  ESTABLISHMENT  (campo físico / unidad económica)
    │
    │  ← un establishment tiene uno o más
    │
    RODEO  (combinación especie + sistema productivo)
      │
      │  ← contiene
      │
      ANIMAL_PROFILE  (presencia del animal en este establishment)
            ↑
            │  ← referencia
            │
            ANIMAL  (entidad global, identificada por TAG si existe)
```

**Reglas clave**:

1. `users` y `establishments` se relacionan via tabla pivot `user_roles` (un usuario puede tener distintos roles en distintos campos)
2. `establishments` contiene uno o varios `rodeos`
3. `rodeos` define la combinación de especie (bovino/equino/etc) + sistema (cría/invernada/etc)
4. `animals` es entidad **global** identificada idealmente por `tag_electronic`
5. `animal_profiles` representa la presencia del animal en un establishment específico, con todos los datos locales (categoría, IDV, eventos, etc.)
6. Soft deletes en todas las entidades de negocio
7. Multi-tenant enforcement vía Row Level Security (RLS) de Supabase

## Alternativas consideradas

### Single-tenant (un campo = una instancia)
- **Pros**: simplicidad máxima
- **Contras**: incompatible con modelo de negocio (vet trabaja en N campos, productor con varios campos)

### Multi-tenant simple (sin distinción animal global vs animal_profile)
- **Pros**: schema más simple
- **Contras**:
  - Pérdida de continuidad cuando animal cambia de campo
  - Duplicación del mismo TAG en múltiples campos viola la lógica ISO
  - Imposible benchmarking cross-campo del mismo animal

### Sin la capa de Rodeo (Establishment → Animal directo)
- **Pros**: menos profundidad
- **Contras**:
  - No permite mezclar sistemas productivos en un mismo campo (cría + cabaña, por ejemplo)
  - Categorías y maniobras dependen del sistema, no del campo, así que necesitan ese nivel

### Modelo "lote físico" como capa intermedia
- **Pros**: refleja terminología de campo
- **Contras**: lote en realidad es etiqueta de organización, no entidad física con movimientos (ver `CONTEXT/03-flujos-maniobras.md`)

## Consecuencias

**Positivas**:
- Modelo extensible para múltiples especies y sistemas sin refactorizar
- Trazabilidad real del animal a lo largo de su vida y campos
- Productores con varios campos modelables sin tricks
- Veterinarios multi-cliente naturales en el modelo
- Postgres RLS hace cumplir el aislamiento entre tenants

**Negativas**:
- Schema más profundo, joins más complejos
- Indices necesarios en `establishment_id` en casi todas las tablas
- Lógica de "ver al animal global" vs "ver al animal en este campo" requiere disciplina en queries

**Notas de implementación**:
- Todas las tablas de datos operativos tienen `establishment_id` como FK obligatoria
- RLS policies basadas en `auth.uid()` + tabla `user_roles` activa
- Anti-fraude (un dueño con varios campos físicos cargando todo como uno) se aborda post-MVP con validaciones de CUIT/RENSPA
