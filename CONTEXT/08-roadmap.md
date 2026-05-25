# 08 — Roadmap y Scope

## Principio rector

**MVP enfocado en cría bovina**. Arquitectura preparada desde día 1 para extender a otros sistemas y especies, pero solo cría visible en UI.

Deadline contextual: julio 2026 (SENASA — caravanas electrónicas obligatorias).

## Dentro del MVP

### Core de identidad y multi-tenancy
- Auth con Supabase (email + password)
- Usuarios con roles por establecimiento (owner / field_operator / veterinarian)
- Veterinarios con cuenta independiente, multi-establecimiento
- Invitaciones a campos
- Soft deletes y multi-tenant desde día 1

### Modelo de animal
- Identificación flexible (al menos uno de: TAG electrónico / IDV / visual_id_alt)
- Categorías de cría bovina con transiciones automáticas
- Override manual de categoría
- Ficha de animal con eventos cronológicos
- Ternero al pie como entidad independiente desde nacimiento

### MODO MANIOBRAS
- Wizard secuencial pantalla por pantalla
- Pantalla de resumen final antes de commit
- 10 maniobras del MVP (ver `CONTEXT/03-flujos-maniobras.md`)
- Presets de combinaciones de maniobras
- Carga offline con sync posterior

### Integración hardware
- Bridge BLE Vesta 3516 vía ESP32 (Nordic UART Service)
- Lectura de bastón Allflex RS420 (BLE nativo)
- Motor de correlación TAG ↔ peso por ventana temporal (~3 segundos)
- Modo manual de carga (sin hardware)

### Laboratorio
- Importación de PDFs/Excel de CEDIVE (primer lab soportado)
- Arquitectura de parsers configurables para sumar más labs
- Vinculación automática con animales por número de tubo

### Reportes básicos
- Resumen por sesión
- Ficha individual de animal con cronología
- KPIs del rodeo (% preñez, % parición, peso promedio por categoría)
- Comparativas básicas entre sesiones

### Sincronización
- PowerSync con SQLite local
- Resolución de conflictos last-write-wins
- Indicador visual de estado de sync

### Exportación SENASA (diferencial competitivo)
- Exportar archivos en formato SIGSA/SIGBIOTRAZA
- Permite al productor cumplir con declaración de identificaciones electrónicas en 10 días

### Infraestructura preparada (sin lógica activa)
- Campos `plan_type`, `plan_limits` en establishments
- Campos `subscription_type`, `subscription_data` en users
- Middleware de límites stub (no chequea nada)

## Fuera del MVP — Evoluciones futuras

### Sistemas bovinos adicionales
- Invernada (engorde a campo)
- Feedlot (engorde intensivo)
- Tambo (lechería)
- Cabaña (reproductores genéticos)

Cada uno con sus categorías, maniobras específicas, KPIs y reportes.

### Otras especies
- Equino
- Porcino
- Ovino/caprino (mucho más adelante)

### Funcionalidades del veterinario (Plan Pro)
- Vista multi-cliente con dashboard agregado
- Benchmarking anónimo entre campos
- Portfolio profesional exportable
- Agenda integrada de visitas
- Centralización de análisis de laboratorio cross-campo
- Protocolos sanitarios reutilizables
- Alertas cruzadas multi-campo

### Módulos de gestión avanzada
- Stock de pajuelas con compra/uso
- Stock de medicamentos con compra/uso
- Stock de alimentos
- Módulo financiero / contabilidad básica
- Lotes/potreros como entidades físicas con movimientos
- Mapeo geoespacial del establecimiento

### Integraciones externas
- Cabaña genética (importación de pedigrees)
- Frigoríficos (datos de faena)
- Financieras agropecuarias (datos para crédito)
- Servicios de clima y pasturas

### Activación de billing
- Sistema de pricing real
- Pagos con MercadoPago / Stripe
- Gestión de suscripciones
- Validación anti-fraude (CUIT, RENSPA, límites)

### Funcionalidades de IA
- Predicción de preñez basada en condición corporal + alimentación
- Detección automática de patrones anómalos (caída de peso, etc.)
- Asistente conversacional sobre los datos del campo
- Reconocimiento de imágenes (caravanas dañadas, lesiones)

## Hitos del proyecto

### Hito 1 — Beta interno en Los Tamarindos
**Target: pre-julio 2026** (antes del deadline SENASA)
- MVP funcionando en producción real
- Carga diaria de manga con vet socio + capataz
- Validación de UX con feedback continuo
- Iteración rápida sobre bugs y fricciones

### Hito 2 — Beta extendido
**Target: post-julio 2026**
- Sumar 5-10 campos a través de la red del vet socio
- Validación de pricing con productores reales
- Estabilización de features core
- Documentación y onboarding

### Hito 3 — Activación de billing
**Target: cuando haya 10+ campos pidiendo entrada activa**
- Implementar lógica real de planes y límites
- Integrar gateway de pagos
- Definir pricing final basado en data de beta
- Materiales de marketing

### Hito 4 — Expansión funcional
**Target: post-billing activado**
- Sumar sistema invernada (mercado más grande)
- Features Pro del veterinario
- Exportación SIGSA refinada
- Comenzar evaluación de otras provincias / otros países

## Orden propuesto de implementación de specs

1. **Core de identidad y multi-tenancy** (users, establishments, rodeos, roles, auth)
2. **Modelo de animal** (identificación flexible, categorías, transiciones)
3. **MODO MANIOBRAS** (sessions, maniobras, presets, wizard)
4. **Integración bastón Bluetooth** (Allflex + correlación con teclado manual)
5. **Integración balanza Bluetooth** (Vesta bridge + correlación)
6. **Importación de laboratorios** (parser CEDIVE)
7. **Reportes básicos** (ficha animal, KPIs de rodeo)
8. **Exportación SIGSA**

## Lo que NUNCA va a estar en este producto (decisión explícita)

- App web completa (este es un producto mobile-first y mobile-only en MVP)
- Módulo contable completo (existen sistemas dedicados)
- Comercio electrónico de ganado o insumos
- Red social ganadera
- Geolocalización con mapas detallados (se puede agregar coords simples pero no GIS)
