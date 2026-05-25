# ADR-006 — Modelo de Roles: 3 roles unificados con vet independiente

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

En el campo argentino conviven distintos actores con responsabilidades superpuestas:

- **Dueño/productor**: toma decisiones estratégicas, no necesariamente está en la manga
- **Capataz**: jefe operativo del campo, decisiones tácticas, está en la manga
- **Peón**: ejecuta tareas operativas, está en la manga
- **Veterinario**: profesional externo que atiende uno o varios campos, no es empleado del campo, factura aparte

La distinción funcional entre **capataz** y **peón** en la práctica diaria con la app es nula: ambos cargan datos en manga, ambos ven la información del campo, ambos pueden hacer las mismas maniobras (incluyendo tacto, sangrado, vacunación si tienen la habilidad).

La diferencia entre **dueño** y **operario** sí es relevante: el dueño tiene poder administrativo (invitar usuarios, exportar data, cambiar configuración del campo).

El **veterinario** es un caso especial: tiene cuenta propia, trabaja en múltiples campos, factura aparte, y es el principal canal de adquisición del producto.

## Decisión

**Tres roles**:

### 1. `OWNER` (Dueño)
- Crea y configura el establecimiento
- Invita y remueve usuarios
- Acceso a todos los datos del campo
- Configuración de planes y billing (cuando exista)
- **Puede operar como field_operator** (cargar maniobras en manga)

### 2. `FIELD_OPERATOR` (capataz/peón unificado)
- Carga maniobras en manga
- Carga eventos individuales
- Ve la información operativa del campo
- NO puede invitar usuarios ni cambiar configuración administrativa
- Cualquier field_operator puede hacer cualquier maniobra (incluyendo tacto, sangrado, raspado)

### 3. `VETERINARIAN` (Veterinario)
- **Cuenta independiente** del establecimiento (login propio)
- Acceso multi-establecimiento (invitado por owner a cada campo)
- Mismo poder operativo que field_operator en campo
- **Funcionalidades exclusivas** (post-MVP):
  - Vista multi-cliente
  - Portfolio profesional
  - Benchmarking
  - Agenda
  - Centralización de labs cross-campo
  - Protocolos reutilizables

## Modelo de datos

```sql
users
  id, name, email, phone, password_hash, ...

user_roles  (pivot table)
  id, user_id, establishment_id, role, active, created_at
  -- role: 'owner' | 'field_operator' | 'veterinarian'
```

Un mismo `user_id` puede tener distintos roles en distintos `establishment_id`. Un veterinario tiene N filas, todas con `role='veterinarian'`, una por campo donde es invitado.

El veterinario también podría tener un campo propio donde figura como `owner`. Los roles no son propiedad del usuario sino de la **relación usuario-establecimiento**.

## Alternativas consideradas

### Separar capataz y peón
- **Pros**: refleja jerarquía formal del campo
- **Contras**: la funcionalidad operativa en la app es idéntica. Distinguir agrega complejidad sin valor.

### Permisos granulares (RBAC complejo)
- **Pros**: flexibilidad total
- **Contras**: complejidad innecesaria en MVP. YAGNI.

### Veterinario sin cuenta propia (invitación temporal por email)
- **Pros**: más simple
- **Contras**: rompe modelo de negocio. El vet es el canal de adquisición y necesita su propia cuenta con sus features.

### Veterinario como sub-rol de field_operator
- **Pros**: jerarquía clara
- **Contras**: no captura la independencia comercial del vet ni sus features Pro

## Consecuencias

**Positivas**:
- Modelo simple, fácil de implementar y explicar
- Cubre la realidad operativa sin sobre-modelar
- Veterinario tiene su lugar en el modelo de negocio (puede crecer, monetizarse)
- Multi-tenant + roles permiten un veterinario trabajar limpiamente en N campos
- Postgres RLS policies simples: "puedes ver X si tienes role activo en su establishment"

**Negativas**:
- Si en el futuro hace falta distinguir "capataz" vs "peón" hay que refactorizar (poco probable)
- No hay permisos granulares para casos exóticos (ej: "este peón solo puede ver vacunaciones")

**Notas de implementación**:
- RLS policy unificada: `EXISTS(SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND establishment_id = X AND active = true)`
- Para operaciones administrativas, agregar check `AND role = 'owner'`
- Para features Pro del veterinario, agregar check `AND role = 'veterinarian' AND user.subscription_type = 'vet_pro'`
