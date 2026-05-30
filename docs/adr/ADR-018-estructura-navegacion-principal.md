# ADR-018 — Estructura de navegación principal (bottom nav de 5 items con FAB central)

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf (estructura propuesta por el leader, validada en el research de diseño de las sesiones 9 y 16)

## Contexto

Varias specs de UI (01 identidad, 09 BUSCAR ANIMAL, y más adelante 03 MODO MANIOBRAS y 07 reportes) necesitan asumir una **estructura de navegación raíz** para poder ubicar sus pantallas: ¿dónde vive la tab Animales?, ¿cómo se llega a MODO MANIOBRAS?, ¿dónde van settings, miembros, asignación masiva de caravanas?

Hasta ahora esa estructura existía como **hipótesis tentativa** repetida en varios documentos sin estar cerrada en un ADR:

- `progress/plan.md` (item A.2): estructura tentativa `[Inicio] [Animales] [⚡FAB Maniobra central] [Reportes] [Más]`, surgida del análisis del bottom nav de Mercado Pago en la sesión 9.
- `design/FRONTEND-STATUS.md`: "bottom nav definitivo de la home canonizada" — 5 items con FAB central elevado, validado en las iteraciones de Stitch del onboarding.
- `specs/active/09-buscar-animal/`: R1.1, design.md y requirements.md citan literalmente la estructura como "sujeta a ADR-018 pending".

Mientras el ADR no exista, las secciones de navegación de esas specs quedan bloqueadas con un disclaimer "tentativo". Cerrarlo ahora desbloquea las secciones de navegación raíz de spec 01 y spec 09, y fija el contrato para spec 03 (el FAB) y spec 07 (la tab Reportes).

La decisión está condicionada por los principios del producto (CLAUDE.md):

- **Velocidad operativa, uso en campo con una mano** (a veces enguantada o con barro): la navegación tiene que ser thumb-friendly, con tap targets grandes y la acción más crítica al alcance del pulgar.
- **MODO MANIOBRAS es el workflow operativo central de la app** (la sesión de manga): merece la posición de mayor jerarquía visual.
- **BUSCAR ANIMAL tiene dos puertas que convergen** (spec 09): manual desde una tab dedicada + bastón BLE como listener global. La navegación tiene que reflejar la puerta manual como tab de primer nivel.

## Decisión

**La navegación raíz de RAFAQ es un bottom tab bar de 5 items con un FAB central elevado**, con esta estructura fija:

```
[Inicio]   [Animales]   [⚡ FAB Maniobra]   [Reportes]   [Más]
```

Roles de cada item:

1. **Inicio** — Home post-creación (greeting personalizado, resumen de rodeos del establecimiento activo, accesos rápidos). Es la pantalla de aterrizaje tras login / creación de establecimiento.

2. **Animales** — Tab dedicada de BUSCAR ANIMAL (`AnimalsTabScreen` de spec 09 R1). Lista paginada de `animal_profiles` del establecimiento activo + search bar permanente + filtros (rodeo, status, "sin caravana electrónica"). Es la **puerta manual** del motor find-or-create. BUSCAR ANIMAL vive en primer nivel de jerarquía, **no** en un submenú.

3. **⚡ FAB Maniobra** (centro, elevado) — Botón flotante central que abre **MODO MANIOBRAS** (spec 03). Es la acción más crítica de la app, por eso ocupa la posición central, elevada, en verde botella `#1e5a3e` (~64px de diámetro, shadow, icono rayo blanco, label "Maniobra" en grey debajo). El FAB **no es una tab navegable más**: es la entrada al wizard secuencial de la sesión de manga.

4. **Reportes** — Resúmenes por sesión, ficha individual, KPIs del rodeo (spec 07).

5. **Más** — Cajón de configuración y acciones secundarias: settings, perfil del usuario, miembros e invitaciones del establecimiento (spec 01), asignación masiva de caravanas (spec 09 R8), y **cambio de establecimiento activo** (multi-tenant, spec 01).

**Regla transversal — el bastón BLE no es una tab.** El bastón Allflex (spec 04) actúa como **listener global** activo en **todas las pantallas excepto MODO MANIOBRAS**. Un bastoneo dispara el motor find-or-create de BUSCAR ANIMAL (spec 09 R2) **encima de la pantalla actual** (modal full-screen o stack que preserva la pantalla previa). Esto es deliberado: BUSCAR ANIMAL no necesita un botón de "escanear" en el bottom nav porque el bastoneo ya funciona desde cualquier tab. Se excluye MODO MANIOBRAS porque spec 03 tiene su propio uso del bastón en bloque dentro del wizard.

Aplicación práctica:

- **Expo Router**: la estructura vive en un grupo de rutas `app/(tabs)/_layout.tsx` con `Tabs`. El FAB central elevado se implementa con un `tabBarButton` custom (o `tabBar` custom) que rompe el layout plano de los 5 items para elevar el del medio.
- **Activo/inactivo**: item activo en verde botella `#1e5a3e`, inactivos en grey. Iconos Lucide.
- **Specs que esto desbloquea**: la sección "Navegación raíz" del design.md de spec 01 y la ubicación de `AnimalsTabScreen` / `BulkTagAssignmentScreen` del design.md de spec 09 dejan de ser tentativas y pasan a referenciar este ADR.

## Alternativas consideradas

### Drawer lateral (hamburger menu)
- **Pros**: escala a muchas secciones sin saturar la barra; patrón conocido.
- **Contras**: esconde la navegación detrás de un tap extra; el botón hamburguesa suele quedar arriba a la izquierda, **lejos del pulgar** en uso a una mano; no comunica jerarquía de acciones. Malo para uso en campo. Rechazado.

### 4 tabs sin FAB (MODO MANIOBRAS como tab plana más)
- **Pros**: barra más simple, sin tratamiento especial.
- **Contras**: no comunica que MODO MANIOBRAS es **la** acción central de la app. Una tab plana entre otras cuatro lo iguala visualmente a Reportes o Más, cuando en realidad es el corazón del uso operativo. Rechazado.

### FAB central para BUSCAR ANIMAL en vez de MODO MANIOBRAS
- **Pros**: BUSCAR ANIMAL es una feature core muy usada.
- **Contras**: BUSCAR ANIMAL **ya tiene dos puertas** (tab Animales dedicada + listener BLE global activo en toda la app); no necesita además el FAB. MODO MANIOBRAS, en cambio, solo tiene una entrada y es el workflow más crítico. Darle el FAB a Buscar Animal dejaría a Maniobras sin señal de jerarquía. Rechazado.

### Más de 5 items en la barra
- **Pros**: cabe todo sin un cajón "Más".
- **Contras**: rompe la regla de usabilidad de ~5 items para thumb reach + legibilidad; con el FAB ocupando el centro, 6+ items quedan apretados. Rechazado.

### Top tab bar (tabs arriba) en vez de bottom nav
- **Pros**: deja el borde inferior libre.
- **Contras**: arriba está fuera del alcance cómodo del pulgar en teléfonos grandes; contradice el principio de uso a una mano. Rechazado.

## Consecuencias

**Positivas**:

- **Thumb-friendly para uso en campo**: las 5 acciones principales están en el borde inferior, al alcance del pulgar; la más crítica (Maniobra) en el centro exacto.
- **Jerarquía visual clara**: el FAB elevado y en color brand comunica sin texto que MODO MANIOBRAS es la acción principal, sin degradar las otras cuatro.
- **BUSCAR ANIMAL en primer nivel**: la tab Animales le da a la feature core la prominencia que merece; combinada con el listener BLE transversal, cubre las dos puertas sin saturar la barra.
- **Familiaridad cultural**: el patrón bottom nav + FAB central replica el de Mercado Pago (analizado en sesión 9), que el usuario argentino ya conoce — alineado con el posicionamiento "el mejor en el primer try".
- **Contrato estable para las specs**: 01, 03, 07 y 09 pueden referenciar este ADR en vez de repetir una estructura tentativa.

**Negativas**:

- **"Más" tiende a convertirse en cajón de sastre** (settings + perfil + miembros + invitaciones + asignación masiva + switch de establishment). Mitigación: vigilar que no crezca sin orden; si se vuelve denso, evaluar una pantalla "Más" bien jerarquizada o reubicar acciones de alto uso (ej. switch de establecimiento podría subir a un selector en el header de Inicio).
- **El FAB central rompe el layout plano** del tab bar y requiere un componente custom en Expo Router (no sale del `Tabs` default). Costo de implementación menor pero real. Mitigación: documentar el patrón del `tabBarButton` custom cuando se implemente B.1.
- **El switch de establecimiento queda escondido en "Más"**: en un producto multi-tenant donde un vet puede tener varios establecimientos, cambiar de contexto es relativamente frecuente. Mitigación: re-evaluar tras feedback de uso real; puede promoverse a un selector en el header de Inicio sin tocar la estructura de tabs.

**Reversibilidad**: media-alta. Reordenar tabs o renombrar items es barato en Expo Router. Cambiar **qué hace el FAB** sí toca specs 03 y 09 (asume que el FAB = Maniobras y que Buscar Animal vive en la tab Animales), por eso conviene cerrarlo ahora antes de implementar esos frontends.

**Notas de implementación**:

- La estructura se materializa en B.1 (frontend de spec 01), que es el primer frontend en construirse y el que monta el shell de navegación.
- Tokens del FAB ya canónicos en `design/FRONTEND-STATUS.md`: verde botella `#1e5a3e`, ~64px, shadow, icono rayo ⚡ blanco (Lucide), label "Maniobra".
- Al implementar, actualizar la sección "Navegación raíz" del design.md de spec 01 y la ubicación de `AnimalsTabScreen` / `BulkTagAssignmentScreen` del design.md de spec 09 para que referencien este ADR en vez del disclaimer tentativo.
- El FAB queda como stub navegable (abre un placeholder) hasta que spec 03 MODO MANIOBRAS se implemente (Ola 3 del plan).
