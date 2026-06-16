// app/maniobra/paso.tsx — DESIGN SPIKE (spec 03 M2.0): PASO DE MANIOBRA con CAPTURA NUMÉRICA (PESAJE).
//
// ⚠️ SPIKE VISUAL, 100% MOCK. NO hay servicios, balanza BLE ni persistencia: el peso tecleado vive en
// estado local efímero (useState) y NO se guarda. El objetivo es mostrar que los "botones gigantes"
// (R5.2/R12.2/R12.5) también aplican a la OTRA forma de interacción: entrada numérica (vs la decisión
// discreta de carga.tsx). En M2.2/M3.2 esto se cablea a addWeight (peso manual, R6.9). El layout
// (header + display + teclado + CTA) es el slot que M3.2 reutiliza.
//
// Pantalla representada: PESAJE manual del animal en el cepo.
//   - Mismo header de identidad SIEMPRE visible (R12.4), via SpikeIdentityHeader.
//   - Línea fina de maniobra + paso.
//   - DISPLAY de peso GIGANTE (hero number $11=64px, DOMINANTE estilo Cash App: es lo que el operario
//     carga y verifica, R12.4 → el elemento más grande de la pantalla). La unidad "kg" va como sufijo
//     más chico ($7) al lado. El valor se formatea es-AR (coma decimal, punto de miles) con
//     toLocaleString('es-AR') — ver formatPesoAR.
//   - TECLADO NUMÉRICO GIGANTE: grilla 3×4 PERFECTAMENTE SIMÉTRICA (12 celdas idénticas). Las filas se
//     reparten el alto (flex:1 por fila) y cada celda reparte el ancho TOTAL por igual (flexBasis:0 +
//     minWidth:0, no flex:1 a secas) >> el piso de 60px. Última fila: [ , 0, ⌫ ] (decimal + cero +
//     borrar); el separador decimal es COMA (es-AR, no punto); el ⌫ va centrado DENTRO de su celda de
//     ancho fijo (overflow:hidden) sin estirarla.
//     Bordes de 2px en $textFaint para que cada tecla resalte como target a pleno sol. Tap imposible
//     de errar (Fitts).
//   - CTA "✓ Confirmar" full-width abajo (zona del pulgar), alto $touchMin, semántica positiva.
//
// RECORTE DE DESCENDENTES (memoria): el header trae descendentes (g/ñ/j); el display y las teclas son
// numéricas (sin descendentes) pero igual llevan lineHeight matching por convención. La línea de
// maniobra ("Pesaje", g+j) veta el clip.
//
// Cero hardcode (ADR-023 §4): tokens. Light-only (MVP).

import { useState } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, Delete } from 'lucide-react-native';

import { SpikeIdentityHeader } from './_components/SpikeIdentityHeader';

// ─── MOCK (hardcodeado — se reemplaza por datos reales en M2.2/M3.2) ────────────────────────────
const MOCK_ANIMAL = {
  idv: 'ARG 4721',
  rodeo: 'Manejo grande',
  categoria: 'Vaquillona preñada',
  progreso: 'Animal 12',
  maniobra: 'Pesaje',
  pasoActual: 3,
  pasoTotal: 4,
} as const;

// Layout del teclado: filas de teclas. ',' = decimal (COMA, es-AR), 'del' = borrar (ícono). El cero va
// solo en la última fila (centrado), patrón de teclado numérico de balanza.
const KEY_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [',', '0', 'del'],
];

// Separador decimal local (es-AR): coma. Único lugar donde vive el glifo, para no esparcir ','.
const DECIMAL_SEP = ',';

// Formatea el peso TECLEADO (string en curso, separador interno = coma es-AR) para el display: agrega
// el punto de miles a la parte entera con toLocaleString('es-AR'), preservando el estado de tipeo en
// curso (coma final sola, ceros a la derecha del decimal). No es concatenación cruda — la parte entera
// pasa por Intl. Ej.: "385"→"385", "1050"→"1.050", "1050,5"→"1.050,5", "1050,"→"1.050,".
function formatPesoAR(raw: string): string {
  if (raw.length === 0) return '0';
  const [intPart, decPart] = raw.split(DECIMAL_SEP);
  const intNum = Number(intPart === '' ? '0' : intPart);
  // toLocaleString('es-AR') → punto de miles, sin decimales (los manejamos aparte para preservar el
  // tipeo en curso, ej. "1050," o "1050,0" que Number() colapsaría).
  const intFmt = Number.isFinite(intNum) ? intNum.toLocaleString('es-AR') : intPart;
  // ¿el usuario tecleó la coma decimal? (split produce 2 elementos aunque decPart esté vacío)
  const hasDecimal = raw.includes(DECIMAL_SEP);
  return hasDecimal ? `${intFmt}${DECIMAL_SEP}${decPart}` : intFmt;
}

export default function ManiobraPasoSpike() {
  const insets = useSafeAreaInsets();
  // Estado EFÍMERO del peso tecleado (no se persiste — es spike). Empieza con un valor mock realista
  // para que la captura muestre el display "lleno".
  const [peso, setPeso] = useState<string>('385');

  const PRIMARY = getTokenValue('$primary', 'color');
  const KEY_ICON = getTokenValue('$icon', 'size'); // 48px — el ⌫ grande

  function pressKey(k: string) {
    if (k === 'del') {
      setPeso((p) => p.slice(0, -1));
      return;
    }
    if (k === DECIMAL_SEP) {
      // una sola coma decimal (es-AR)
      setPeso((p) => (p.includes(DECIMAL_SEP) ? p : p.length === 0 ? `0${DECIMAL_SEP}` : p + DECIMAL_SEP));
      return;
    }
    // límite defensivo de largo (cuento solo dígitos) para que no desborde el display (spike)
    setPeso((p) => (p.replace(DECIMAL_SEP, '').length >= 5 ? p : p + k));
  }

  return (
    <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      {/* ── HEADER DE IDENTIDAD (sticky, contexto), idéntico al de carga.tsx ── */}
      <SpikeIdentityHeader
        idv={MOCK_ANIMAL.idv}
        rodeo={MOCK_ANIMAL.rodeo}
        categoria={MOCK_ANIMAL.categoria}
        progreso={MOCK_ANIMAL.progreso}
      />

      {/* ── LÍNEA FINA DE MANIOBRA + PASO ── */}
      <XStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$2" alignItems="center" gap="$2">
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
          {MOCK_ANIMAL.maniobra}
        </Text>
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" color="$textFaint" numberOfLines={1}>
          · {MOCK_ANIMAL.pasoActual} de {MOCK_ANIMAL.pasoTotal}
        </Text>
      </XStack>

      {/* ── DISPLAY DE PESO GIGANTE (hero number $11=64px, DOMINANTE: el elemento más grande de la
            pantalla, estilo Cash App) + unidad "kg" como sufijo más chico ($7). El valor se formatea
            es-AR (coma decimal, punto de miles) con formatPesoAR. ── */}
      <XStack paddingHorizontal="$4" paddingTop="$2" paddingBottom="$3" alignItems="baseline" justifyContent="center" gap="$2">
        <Text fontFamily="$heading" fontSize="$11" lineHeight="$11" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          {formatPesoAR(peso)}
        </Text>
        <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="600" color="$textMuted" numberOfLines={1}>
          kg
        </Text>
      </XStack>

      {/* ── TECLADO NUMÉRICO GIGANTE: grilla 3×4 PERFECTAMENTE SIMÉTRICA. Las filas se reparten el alto
            sobrante (flex:1) y dentro de cada fila las 3 celdas son IDÉNTICAS. Clave de la simetría:
            cada celda es `flexBasis=0` + `minWidth=0` (no `flex:1` a secas) → todas crecen desde cero
            por igual repartiendo el ancho TOTAL de la fila, NO el sobrante tras el contenido. Sin esto,
            la celda del ⌫ (cuyo ícono tiene ancho intrínseco ~43px) se estiraba y desalineaba el `0`/`.`
            (bug medido: row4 centros 69/187/323 vs 76/204/332 de las otras). `overflow=hidden` impide
            que el contenido (ícono o glifo) empuje la celda. El ⌫ va CENTRADO dentro de su celda de
            ancho fijo, NO la estira. Teclas >> 60px de piso (Fitts). testID `action-zone` (acá y en el
            CTA) → el e2e mide la densidad teclado+CTA border-to-border (R12.5).
            Bordes NÍTIDOS (manga a pleno sol): el fill $surface (bone) sobre $bg casi-blanco apenas
            contrasta (1.03), así que la definición de cada tecla la da un borde de 2px en $textFaint
            (#807A74) — contraste 3.9-4.0 (AA non-text ≥3:1), visible al sol sin leerse como "activo"
            (eso sería $primary). ── */}
      <YStack testID="action-zone" flex={1} paddingHorizontal="$4" gap="$2">
        {KEY_ROWS.map((row, ri) => (
          <XStack key={`row-${ri}`} flex={1} gap="$2">
            {row.map((k) => (
              <View
                key={k}
                flexGrow={1}
                flexShrink={1}
                flexBasis={0}
                minWidth={0}
                overflow="hidden"
                backgroundColor="$surface"
                borderRadius="$card"
                borderWidth={2}
                borderColor="$textFaint"
                alignItems="center"
                justifyContent="center"
                pressStyle={{ backgroundColor: '$greenLight' }}
                onPress={() => pressKey(k)}
                {...(Platform.OS === 'web'
                  ? { role: 'button' as const, 'aria-label': k === 'del' ? 'Borrar' : k }
                  : { accessibilityRole: 'button' as const, accessibilityLabel: k === 'del' ? 'Borrar' : k })}
              >
                {k === 'del' ? (
                  <Delete size={KEY_ICON} color={PRIMARY} />
                ) : (
                  <Text fontFamily="$heading" fontSize="$10" lineHeight="$10" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                    {k}
                  </Text>
                )}
              </View>
            ))}
          </XStack>
        ))}
      </YStack>

      {/* ── CTA "✓ Confirmar" full-width abajo (zona del pulgar). Semántica positiva (verde botella). ── */}
      <YStack
        testID="action-zone"
        paddingHorizontal="$4"
        paddingTop="$3"
        paddingBottom={Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'))}
      >
        <View
          backgroundColor="$primary"
          borderRadius="$pill"
          minHeight="$touchMin"
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          gap="$2"
          pressStyle={{ backgroundColor: '$primaryPress' }}
          {...(Platform.OS === 'web'
            ? { role: 'button' as const, 'aria-label': 'Confirmar peso' }
            : { accessibilityRole: 'button' as const, accessibilityLabel: 'Confirmar peso' })}
        >
          <Check size={getTokenValue('$fabIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
            Confirmar
          </Text>
        </View>
      </YStack>
    </YStack>
  );
}
