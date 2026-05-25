# 06 — Stack Tecnológico

## Decisión

**React Native + Expo + TypeScript + Supabase + PowerSync**

Ver `docs/adr/ADR-002-tech-stack.md` para el análisis completo.

## Componentes

### Frontend móvil
- **React Native** con Expo (bare workflow cuando se necesite código nativo)
- **TypeScript** estricto
- **react-native-ble-plx** para BLE (multi-conexión iOS + Android)
- UI: por definir (probablemente Tamagui o NativeWind)
- Estado: Zustand o Jotai (no Redux)
- Navegación: Expo Router

### Backend
- **Supabase** como BaaS completo:
  - PostgreSQL gestionado
  - Auth (email, OAuth, magic link)
  - Realtime para suscripciones
  - Storage para archivos (PDFs de laboratorio, fotos)
  - Edge Functions (Deno + TS) para lógica de negocio compleja

### Sincronización offline
- **PowerSync** como sync engine
  - Integración nativa con Supabase
  - Replicación bidireccional con SQLite local
  - Resolución de conflictos last-write-wins por defecto
  - Las queries en el cliente son sobre SQLite local (rápidas, sin red)

### Lenguaje único
- **TypeScript** en todo: frontend, edge functions, scripts, infraestructura
- Tipos compartidos entre cliente y servidor (generación desde schema Supabase)

## Por qué este stack

**1. Time-to-market crítico**: Supabase elimina semanas de trabajo de backend (auth, DB, storage, realtime).

**2. Offline-first sólido**: PowerSync está diseñado exactamente para "carga en campo sin internet, sincroniza después".

**3. BLE robusto**: react-native-ble-plx es la librería más madura cross-platform para BLE multi-conexión.

**4. AI assistance excelente**: TypeScript + React Native + Supabase = entrenamiento masivo en LLMs. Claude Code y Cursor producen código muy alto en este stack.

**5. Single developer**: un solo lenguaje en todo el stack reduce contexto cognitivo.

**6. Bajo lock-in real**: Supabase es Postgres puro. Migrar a infraestructura propia es portear edge functions y configurar el server.

## Stack rechazado y por qué

**Flutter + Dart**:
- Dart no es transferible (no JS/TS, no Swift, no Kotlin)
- BLE menos maduro (flutter_blue_plus < react-native-ble-plx)
- Backend en Dart es débil (Serverpod nuevo)
- Menos developers Dart en LATAM

**Native (Swift + Kotlin)**:
- Duplica trabajo
- No viable para solo developer con tiempo limitado

**Firebase**:
- NoSQL no encaja con relaciones complejas (animales/eventos/sesiones)
- Lock-in mucho más fuerte que Supabase

**Backend custom desde cero**:
- 3 meses solo armar lo que Supabase da gratis

**Ionic / Capacitor / web-based**:
- BLE débil
- Performance pobre en hardware viejo de campo

## Bootstrap del proyecto

```bash
# Crear proyecto Expo con TypeScript
npx create-expo-app cattle-app --template
cd cattle-app

# Dependencias core
npx expo install react-native-ble-plx
npm install @supabase/supabase-js
npm install @powersync/react-native @powersync/op-sqlite

# Estado y navegación
npm install zustand
npx expo install expo-router

# UI (a decidir)
# npm install tamagui  # o
# npm install nativewind tailwindcss
```

## Estructura sugerida del proyecto

```
cattle-app/
├── app/                    # Expo Router screens
│   ├── (auth)/
│   ├── (app)/
│   │   ├── establishments/
│   │   ├── maneuvers/
│   │   ├── animals/
│   │   └── reports/
│   └── _layout.tsx
├── components/
│   ├── ui/                 # base components
│   ├── maneuvers/          # maniobra-specific
│   ├── bluetooth/          # BLE components
│   └── ...
├── lib/
│   ├── supabase/           # cliente, types
│   ├── powersync/          # sync setup, schema
│   ├── bluetooth/          # BLE service layer
│   │   ├── vestaBridge.ts
│   │   ├── allflexReader.ts
│   │   └── correlation.ts
│   └── domain/             # lógica de negocio pura
├── stores/                 # Zustand stores
├── hooks/
├── types/
├── supabase/               # backend (schema, edge functions)
│   ├── migrations/
│   ├── functions/
│   └── seed.sql
└── docs/
    └── adr/
```

## Decisiones técnicas pendientes

- **UI library**: Tamagui vs NativeWind vs build propio. A decidir antes de Spec 2.
- **Forms library**: react-hook-form (probable) o uso directo.
- **Validación**: Zod (probable) por integración con Supabase types.
- **Testing**: Jest + React Native Testing Library para unit, Detox o Maestro para e2e.
- **CI/CD**: GitHub Actions + Expo EAS Build.
- **Observabilidad**: Sentry para errors, PostHog para analytics de producto.

## Costos estimados

**Beta (primeros 6-12 meses)**:
- Supabase free tier: hasta 500 MB DB, 2 GB transfer, 1 GB storage
- PowerSync free tier: para empezar
- Expo: gratis hasta cierto volumen de builds
- **Total: ~0 USD/mes** para beta con pocos clientes

**Producción inicial (~50 campos)**:
- Supabase Pro: 25 USD/mes
- PowerSync: ~20-50 USD/mes según uso
- **Total: ~75 USD/mes**

Razonable hasta que el modelo de pricing genere ingresos suficientes.
