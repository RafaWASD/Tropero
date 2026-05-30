# ADR-002 — Selección de Stack Tecnológico

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

Solo developer construyendo aplicación móvil ganadera con los siguientes requerimientos críticos:

- **Mobile primero** (iOS + Android), uso intensivo en campo
- **Offline-first** no negociable: peón en manga no tiene señal
- **Bluetooth LE** robusto con múltiples conexiones simultáneas (bastón + balanza)
- **Base de datos relacional** con relaciones complejas (animales / eventos / sesiones / labs)
- **Tiempo a producción crítico**: identificación electrónica bovina obligatoria por SENASA desde el 1/1/2026 (Res. 841/2025)
- **AI assistance disponible** (Claude Max, Claude Code) — el stack debe ser uno donde la IA produzca código de alta calidad

## Decisión

**React Native + Expo + TypeScript + Supabase + PowerSync**

- **Frontend**: React Native + Expo + TypeScript
- **BLE**: react-native-ble-plx
- **Backend**: Supabase (Postgres + Auth + Realtime + Storage + Edge Functions)
- **Sync offline-first**: PowerSync
- **Lenguaje único**: TypeScript en cliente, edge functions, scripts e infraestructura

## Alternativas consideradas

### Flutter + Dart + Backend custom
- **Pros**: rendimiento nativo, UI consistente entre plataformas
- **Contras**:
  - Dart no es transferible (no es JS, no es Swift, no es Kotlin)
  - `flutter_blue_plus` es menos maduro que `react-native-ble-plx` para multi-conexión
  - Backend en Dart (Serverpod) inmaduro
  - Menos developers Dart en LATAM (cuello de botella si hay que crecer el equipo)
  - LLMs producen código menos consistente en Flutter que en RN

### Native (Swift + Kotlin)
- **Pros**: máxima calidad y acceso a APIs
- **Contras**: duplica trabajo. No viable para solo developer con deadline.

### React Native + Firebase
- **Pros**: Firebase es maduro y rápido para arrancar
- **Contras**:
  - Firestore (NoSQL) no encaja con el modelo relacional (animales / sesiones / eventos / labs)
  - Lock-in fuerte con Google
  - Reglas de seguridad de Firestore son complicadas para multi-tenant

### React Native + AWS Amplify
- **Pros**: stack completo, AppSync para sync
- **Contras**:
  - Curva de aprendizaje de Amplify es alta
  - GraphQL agrega complejidad para un solo developer
  - Vendor lock-in con AWS

### React Native + Backend custom (Node + Postgres + WatermelonDB)
- **Pros**: control total
- **Contras**: 3 meses solo para construir lo que Supabase ofrece gratis (auth, RLS, realtime, storage)

### Ionic / Capacitor (PWA híbrida)
- **Pros**: web-first, reutilizable
- **Contras**:
  - BLE débil en webview
  - Performance pobre en hardware viejo de campo
  - UX se siente menos nativa

## Consecuencias

**Positivas**:
- Supabase elimina semanas de trabajo de backend
- PowerSync resuelve offline-first sin construir engine custom
- TypeScript unificado en todo el stack reduce carga cognitiva
- React Native + Supabase tiene el mejor "AI fit" — Claude Code produce código muy bueno aquí
- Bajo lock-in real: Supabase es Postgres puro, migrar a infraestructura propia es portear edge functions

**Negativas**:
- Dependencia de servicios gestionados (Supabase, PowerSync) — riesgo de pricing futuro
- React Native tiene fricciones nativas que de vez en cuando requieren ejectar de Expo managed
- Costos de PowerSync pueden crecer con escala

**Mitigaciones**:
- Supabase self-hostable si los costos justifican migrar
- PowerSync alternativa: WatermelonDB con sync custom (mucho más trabajo)
- Mantener edge functions simples para facilitar migración eventual

## Costos estimados

| Etapa | Supabase | PowerSync | Total mensual |
|---|---|---|---|
| Beta (5 campos) | Free | Free | ~0 USD |
| Producción inicial (50 campos) | Pro ($25) | ~$20-50 | ~$75 USD |
| Escala (200+ campos) | Team ($599) | ~$200-500 | ~$800 USD |

Razonable hasta que el revenue justifique migrar a infraestructura propia si fuera necesario.
