# ADR-027 — Invariante de layout: centrado robusto ante decoraciones (slots simétricos)

**Status**: Accepted
**Fecha**: 2026-06
**Decisores**: Raf

## Contexto

Bug de layout **recurrente** en el frontend: un elemento que se quiere **centrado** convive con una **decoración** lateral (círculo/radio de selección, check/tilde, ícono, badge, chevron) que es un *hermano flex* y **ocupa ancho de un solo lado**. La decoración se come el espacio de centrado → el "centro" del contenido se corre y queda **desalineado respecto a las filas hermanas que no tienen la decoración**.

Evidencia canónica: la card "Cría" del wizard *Crear rodeo* (sistema productivo) quedaba corrida hacia la izquierda respecto a "Cabaña"/"Feedlot"/… porque el radio circular a la derecha la desplazaba (captura `tests/DESCENTRADO.png`, sesión 2026-06-11).

Lo grave no fue una pantalla: el mismo bug **ya se había reintroducido y parchado a mano dos veces, sin dejar una regla canónica ni un componente que lo impida**:
- `app/app/(tabs)/animales.tsx` (FilterPopover) — comentario "FIX 3: el item seleccionado quedaba corrido" (parche con *slot reservado*).
- `app/app/animal/[id].tsx` ("Crear lote nuevo") — label centrado con *spacer simétrico* hardcodeado a `width={20}`.

Sin una primitiva ni una regla documentada, cada pantalla nueva reintroduce la clase de bug. Este ADR cierra esa puerta.

## Decisión

### Regla 1 — Centrado robusto: las decoraciones laterales NO consumen el espacio de centrado

Cuando un contenido se quiere **centrado respecto a su contenedor** (para que se alinee con filas hermanas, o para un centrado visual intencional), debe centrarse sobre el **ancho REAL del contenedor**, no sobre el ancho residual que dejan las decoraciones. Mecanismo canónico: **slots laterales de ANCHO IGUAL a ambos lados** (aunque solo un lado tenga decoración, el otro lleva un spacer del mismo ancho). El centro queda matemáticamente en el centro del contenedor, indiferente a la decoración.

Primitiva: **`CenteredRow`** (`app/src/components/CenteredRow.tsx`), parte de la librería canónica (ADR-023). API:

```tsx
type CenteredRowProps = {
  children: ReactNode;            // contenido centrado
  left?: ReactNode;              // decoración izquierda (opcional)
  right?: ReactNode;             // decoración derecha (opcional)
  sideWidth: SizeTokens | number; // ancho reservado a CADA lado (IGUAL en ambos)
} & XStackProps;                  // gap, minHeight, padding, etc. pasan al frame

// Render: [ slot izq width=sideWidth ][ centro flex=1 alignItems=center ][ slot der width=sideWidth ]
```

Ejemplo (fila seleccionable con check a la derecha, label centrado y robusto):

```tsx
<CenteredRow sideWidth="$navIcon" right={selected ? <Check /> : null}>
  <Text textAlign="center">{label}</Text>
</CenteredRow>
```

### Regla 2 — Decoraciones condicionales: reservar el slot SIEMPRE

Una decoración que se renderiza **solo en algunos estados** (un check que aparece únicamente si el item está seleccionado) debe **reservar su slot de ancho fijo SIEMPRE**, también cuando no se muestra. Si no, togglear el estado **recorre el layout** del contenido (el bug del "FIX 3"). `CenteredRow` lo garantiza por construcción: el slot existe aunque `left`/`right` sea `null`.

### Distinción explícita — ícono ligado al label (CTA) ≠ este invariante

Cuando el ícono es **semánticamente parte de la etiqueta** (ícono *leading* de un CTA, ej. `+ Dar de alta este animal`), lo correcto es **centrar el GRUPO ícono+label** como una unidad (`justifyContent="center"` + `gap`), patrón estándar de Material/iOS. **Eso NO es el caso de este invariante** y no se "arregla". El invariante aplica solo cuando la decoración es una **afordancia lateral** (selección, navegación, metadata) que debería ser indiferente al centrado del contenido principal.

### Alternativa aceptada — decoración `position: absolute` para labels cortos de ancho fijo

Para contenido **corto y de ancho acotado** centrado a pantalla completa (ej. el título de un header con un botón "atrás"), es aceptable centrar el contenido a `width: 100%` y pinear la decoración con `position: absolute` a su lado, en vez de reservar gutters. Solo cuando **no hay riesgo de overlap** (el contenido no llega a tocar la decoración). Si el contenido puede ser largo → usar `CenteredRow` (los slots evitan el solapamiento).

### Enforcement

- Documentado en `docs/design-system.md` (§4 Layout / §6 Componentes) y en la skill **`design-review`** (criterio + ítem de checklist obligatorio).
- **Vet de diseño antes de mostrar a Raf** (skill `design-review`): toda pantalla con contenido centrado + decoración se valida con render fiel (CDP) verificando que el centro no se corre vs filas hermanas.

## Alternativas consideradas

- **Solo `position: absolute` para todo** — elegante para texto corto, pero riesgo de overlap con contenido largo y no resuelve el corrimiento por render condicional de elementos en flujo. Queda como alternativa acotada, no como regla general.
- **CSS Grid (`display: grid`)** — no soportado de forma fiable en el modelo flex de RN/Tamagui. Descartado.
- **Seguir parchando inline sin primitiva** — es lo que venía pasando (2 parches ad-hoc divergentes). Recae en cada pantalla nueva. Rechazado: la primitiva es justamente lo que da "consistencia por construcción" (ADR-023).

## Consecuencias

**Positivas**:
- **Consistencia por construcción**: una pantalla que usa `CenteredRow` no puede descentrar el contenido aunque agregue una decoración después. Mata la recurrencia.
- Unifica los 2 parches ad-hoc previos en un solo patrón canónico.
- Cubre en una primitiva los dos sub-casos (centrado robusto + reserva de slot condicional).

**Negativas / mitigaciones**:
- Reservar gutters simétricos **resta un poco de ancho** al contenido centrado. Es el costo de garantizar el centrado; aceptable (los gutters son del ancho de un ícono). Para texto corto de ancho fijo donde el ancho importa, está la alternativa `position: absolute`.
- Hay que **elegir `sideWidth`** correctamente (≥ ancho de la decoración más grande de la fila). Documentado; el vet de diseño lo verifica.

**Reversibilidad**: alta. `CenteredRow` es un componente de layout sin estado; quitarlo o cambiar el mecanismo no toca lógica de negocio.

**Relación con otros ADRs**: ejecuta **ADR-023** (componentes = deliverable; "consistencia por construcción"). Consume los tokens de tamaño de `docs/design-system.md` / `app/tamagui.config.ts`. Sin relación con backend/seguridad.
