# Setup externo — 17-observabilidad (Sentry + PostHog)

> Registro de las cuentas/proyectos externos creados para la feature 17 y sus valores de conexión.
> Los tres valores de abajo son **claves de cliente write-only** (viajan embebidas en la app, sólo pueden
> ENVIAR eventos, no leer nada) → NO son secretos tipo password. Se consumen como `EXPO_PUBLIC_*`.
> Fecha: 2026-08-11. Capturados por el leader vía Claude-for-Chrome sobre las cuentas de Raf.

## Sentry

- **Org**: `mitropero` (`mitropero.sentry.io`), región **US**.
- **Proyecto**: `react-native` (plataforma React Native), team `#mitropero`.
- **DSN**:
  ```
  https://5dc0605a7d38dcf76e0c3b6a1bc8dcf1@o4511892683489280.ingest.us.sentry.io/4511892742406144
  ```
  (public key `5dc0605a7d38dcf76e0c3b6a1bc8dcf1` · org id `4511892683489280` · project id `4511892742406144` — cross-verificado contra la config OTLP de la misma pantalla).
- **Alertas**: creada en el wizard → "Alert me on high priority issues" + **Notify via email** tildado (regla del spec D1: issue nuevo → email, free tier).
- **Plan**: cuenta en trial de 14 días del plan pago; **al vencer cae sola al plan Developer gratis** (single user, ~5k errores/mes, retención 30d) — suficiente para la beta. Raf puede forzar el plan Developer ahora en Settings → Subscription si le molesta el trial. **No se cargó tarjeta.**

### Pendiente de Sentry (NO hecho por el leader, a propósito)
- **GitHub App / acceso al repo `Tropero`**: **salteado.** No hace falta para reportar errores; sólo agrega suspect-commits + abrir el stack en el código, a cambio de dar a un tercero lectura del repo privado (que por regla del proyecto debe quedar privado por la PII de PROD en las Actions). Se puede agregar después si se quiere suspect-commits. Decisión de Raf.
- **`SENTRY_AUTH_TOKEN`** (para subir source maps en los builds de EAS, spec D1): es un **auth token real (secreto)** → lo crea Raf en Settings → Auth Tokens y se guarda como **EAS secret**, NO se commitea. Sólo se necesita al momento del build/`eas update`, no para el wiring. Diferido hasta ese paso.

## PostHog

- **Project token (API key)**: `phc_Aph5ynzVU2cnrhqYDxSXVfYf23p5aaCakHcJTaobHsRG`
- **Project ID**: `552831`
- **Host / región**: **US Cloud** → `https://us.i.posthog.com`

## Variables de entorno propuestas (el implementer las cablea; nombres a confirmar en la spec)

```
EXPO_PUBLIC_SENTRY_DSN=https://5dc0605a7d38dcf76e0c3b6a1bc8dcf1@o4511892683489280.ingest.us.sentry.io/4511892742406144
EXPO_PUBLIC_POSTHOG_KEY=phc_Aph5ynzVU2cnrhqYDxSXVfYf23p5aaCakHcJTaobHsRG
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Guarda de doble candado del spec (D1/D2): `Sentry.init({ enabled: !!dsn && !isE2E() })` y `PostHogProvider({ disabled: !key || isE2E() })` → sin estas envs la app bootea idéntica (no-op), los ~70 E2E siguen verdes.

## Dependencia de orden (spec context §"Dependencia de orden")

La **config nativa de Sentry** (config plugin en `app.config.ts` + metro plugin) NO se apila antes del **build verde de Fase 0** de la feature 16 (E.0). El wiring JS (Sentry.init con guardas, ErrorBoundary, PostHogProvider, screen tracking) y el comportamiento no-op sí se pueden specificar/implementar ya.
