# ADR-009 — Infraestructura de Billing Diferida Post-Beta

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

El producto tiene un modelo de negocio definido conceptualmente (planes Vet Base, Vet Pro, Productor), pero:

1. Los **números exactos** de pricing (5/20/20 USD) son tentativos y se validan con el vet socio y con clientes reales durante la beta
2. La **estructura de planes** podría refinarse (¿el plan Base tiene sentido como existe? ¿1 semana es el tiempo correcto?)
3. **Construir billing real** (integración con gateway, gestión de suscripciones, dunning, facturación AFIP) toma 2-4 semanas de trabajo
4. Con la obligación SENASA de identificación electrónica vigente desde el 1/1/2026, el tiempo es escaso. Cualquier semana invertida en billing es una semana menos en producto core.
5. La beta gratuita (6-12 meses) cubre el primer período donde el producto está siendo refinado. No hay que cobrar en esa ventana.

El riesgo de construir billing ahora es **construir lo equivocado**: si los planes cambian post-beta (probable), hay que refactorizar billing.

El riesgo de NO preparar nada ahora es **refactorizar el schema cuando llegue el momento**: agregar columnas, migrar datos, romper queries.

## Decisión

**Construir la infraestructura schema-level de billing desde día 1. Diferir toda la lógica activa para post-beta.**

### Lo que se construye ahora

**Columnas en schema** (preparadas, sin lógica que las consuma):

```sql
establishments
  + plan_type           VARCHAR  DEFAULT 'free'
  + plan_started_at     TIMESTAMPTZ NULL
  + plan_limits         JSONB    DEFAULT '{}'

users
  + subscription_type   VARCHAR  DEFAULT 'free'
  + subscription_data   JSONB    DEFAULT '{}'
```

**Middleware stub**:
- Función `checkPlanLimits(action, context)` que existe en el código pero retorna `{ allowed: true }` siempre
- Llamada en todas las acciones potencialmente limitables (crear establishment, agregar animal, invitar usuario)
- Cuando se active billing, solo se cambia el cuerpo de la función

**Comunicación al usuario**:
- Mensaje persistente en onboarding: "Esta es una beta gratuita. El producto será pago a futuro: Plan Productor ~20 USD/mes por campo, Plan Vet ~5-20 USD/mes."
- Esto pre-acondiciona expectativas y evita backlash al activar billing

### Lo que NO se construye

- Lógica real de límites por plan
- Integración con MercadoPago / Stripe
- UI de "upgrade" / "downgrade"
- Sistema de invoices / facturación AFIP
- Webhooks de gateway
- Dunning / payment failures
- Cupones / promociones

## Alternativas consideradas

### Construir billing completo desde día 1
- **Pros**: nunca hay que migrar después
- **Contras**: 2-4 semanas de trabajo en algo que probablemente cambia. Pre-mature optimization.

### No preparar nada, refactorizar después
- **Pros**: velocidad máxima ahora
- **Contras**: migrar schema con producción activa es doloroso. Mejor preparar las columnas vacías ahora.

### Free para siempre (modelo open source con servicios)
- **Pros**: máxima adopción
- **Contras**: no es sustentable como negocio. Hay costos reales (Supabase, PowerSync, hosting, soporte).

### Modelo freemium con tier gratuito permanente
- **Pros**: adopción + conversión
- **Contras**: complica el modelo conceptual. Decidir post-beta con data real.

## Consecuencias

**Positivas**:
- Trade-off óptimo: cero refactor de schema vs cero overhead de implementación
- Foco en producto core durante el período más crítico (pre-deadline SENASA)
- Decisiones de pricing basadas en data real, no en intuición
- Tiempo para ver cómo el mercado responde al producto antes de definir precios

**Negativas**:
- Hay que recordar activar billing cuando llegue el momento (riesgo de seguir cobrando 0 más tiempo del necesario)
- Comunicar pricing futuro como tentativo puede crear confusión

**Mitigaciones**:
- Trigger explícito en el roadmap: "10 campos pidiendo entrada activa = activar billing"
- Mensaje al usuario claro sobre que es beta + producto futuro pago
- ADR explícito (este) para que la decisión esté registrada y no olvidada

**Notas de implementación**:
- `plan_type` valores futuros: `'free'`, `'beta'`, `'productor'`, `'vet_base'`, `'vet_pro'`
- `plan_limits` JSON estructura futura:
  ```json
  {
    "max_animals": 1000,
    "max_users": 10,
    "max_temporary_fields": 5,
    "features": ["benchmarking", "portfolio"]
  }
  ```
- Middleware en Edge Function: chequea `plan_limits` antes de permitir acción
- Cuando se active: data migration que setea `plan_type='beta'` para todos los campos existentes con fecha fin
