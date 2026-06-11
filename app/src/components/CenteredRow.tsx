// CenteredRow — fila con contenido CENTRADO ROBUSTO ante decoraciones laterales (ADR-027).
//
// EL INVARIANTE (ADR-027 / design-system §4):
//   Un contenido que se quiere CENTRADO respecto a su contenedor se DESALINEA cuando convive
//   con una decoración lateral (radio/check/tilde/ícono/badge/chevron) que es un hermano flex y
//   come ancho de UN SOLO lado: el "centro" se calcula sobre el ancho residual y queda corrido
//   vs las filas hermanas SIN decoración. Bug recurrente (la card "Cría" del wizard Crear rodeo
//   corrida por su radio; ya parchado ad-hoc 2 veces antes de canonizarse).
//
// MECANISMO (slots simétricos):
//   [ slot izq width=sideWidth ][ centro flex=1 minWidth=0 center ][ slot der width=sideWidth ]
//   Los dos slots laterales reservan el MISMO ancho (`sideWidth`) y se renderizan SIEMPRE —
//   aunque `left`/`right` sea null. Así (a) el centro queda matemáticamente en el centro del
//   contenedor, indiferente a qué lado tenga decoración; y (b) una decoración CONDICIONAL (un
//   check que aparece solo si seleccionado) NO recorre el layout al togglear: su slot ya existe.
//   El slot izq alinea su contenido a flex-start, el der a flex-end; ambos flexShrink=0 y
//   centrados verticalmente.
//
// CUÁNDO usarlo: siempre que haya (o pueda llegar a haber) contenido centrado conviviendo con un
// ícono/check/radio/badge/chevron a un costado — headers con back + título centrado, sheets con
// título + X, filas seleccionables con check. NO es para un ícono LIGADO al label (leading de un
// CTA, ej. "+ Dar de alta"): ese grupo ícono+label se centra como unidad y NO es este invariante.
//
// Cero hardcode (ADR-023 §4): `sideWidth` es un token de tamaño ($navIcon, $icon, $avatar…) o un
// número; el resto de props de XStack (gap, minHeight, padding…) pasan al frame.

import { ReactNode } from 'react';
import { GetProps, SizeTokens, XStack } from 'tamagui';

type XStackProps = GetProps<typeof XStack>;

export type CenteredRowProps = Omit<XStackProps, 'children'> & {
  /** Contenido CENTRADO sobre el ancho REAL del contenedor. */
  children: ReactNode;
  /** Decoración izquierda (opcional). Su slot se reserva SIEMPRE, aunque sea null. */
  left?: ReactNode;
  /** Decoración derecha (opcional). Su slot se reserva SIEMPRE, aunque sea null. */
  right?: ReactNode;
  /** Ancho reservado a CADA lado (IGUAL en ambos) — token de tamaño o número. */
  sideWidth: SizeTokens | number;
};

export function CenteredRow({
  children,
  left = null,
  right = null,
  sideWidth,
  ...frame
}: CenteredRowProps) {
  return (
    <XStack width="100%" alignItems="center" {...frame}>
      {/* Slot IZQUIERDO — ancho fijo, contenido a flex-start. Se renderiza siempre (reserva). */}
      <XStack
        width={sideWidth}
        flexShrink={0}
        alignItems="center"
        justifyContent="flex-start"
      >
        {left}
      </XStack>

      {/* CENTRO — toma el ancho residual y centra su contenido sobre el centro REAL del contenedor
          (los dos slots laterales son simétricos, así que el centro coincide con el del frame). */}
      <XStack
        flex={1}
        minWidth={0}
        alignItems="center"
        justifyContent="center"
      >
        {children}
      </XStack>

      {/* Slot DERECHO — ancho fijo IGUAL al izquierdo, contenido a flex-end. Siempre presente. */}
      <XStack
        width={sideWidth}
        flexShrink={0}
        alignItems="center"
        justifyContent="flex-end"
      >
        {right}
      </XStack>
    </XStack>
  );
}
