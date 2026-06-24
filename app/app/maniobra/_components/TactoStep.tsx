// app/maniobra/_components/TactoStep.tsx — PASO de TACTO DE VACA (spec 03 M2.2, R6.2 / §6.bis.2)
// + ADAPTATIVO por el rodeo (Stream B / B2, RPSC.5 — DD-PSC-2/DD-PSC-3).
//
// Porta el lenguaje visual YA APROBADO del spike M2.0 (`app/maniobra/carga.tsx`): bloques de decisión
// full-width que se REPARTEN el alto del viewport (R5.2/R12.5), alto contraste, label gigante centrado.
// NO se rediseña — se estructura como paso de 2 SUB-PASOS condicionales que devuelve UN pregnancy_status al
// frame (onConfirm), que persiste UN único reproductive_events (R6.2):
//
//   Sub-paso 1 — ¿Preñada?     [ PREÑADA ]   [ VACÍA ]      (2 bloques gigantes — NO se rediseña, RPSC.5.1)
//     · VACÍA   → onConfirm('empty')  → cierra la maniobra (sin sub-paso 2).
//     · PREÑADA → según los BUCKETS del rodeo (abajo).
//   Sub-paso 2 — Tamaño (solo si PREÑADA y hay buckets): N bloques (CABEZA/CUERPO/COLA según el rodeo).
//     · CABEZA→'large' · CUERPO→'medium' · COLA→'small'  (mapeo 1:1, RPSC.5.6; espejo de
//       event-timeline.PREGNANCY_LABELS: small=Cola, medium=Cuerpo, large=Cabeza). onConfirm(<status>).
//
// 🔑 ADAPTATIVO (Stream B / B2, RPSC.5.2–5.5): el Nº de bloques de TAMAÑO = los `buckets` del rodeo,
// derivados de `sizeBucketsForServiceMonths(nMonths)` (FUENTE ÚNICA, pregnancy-buckets.ts):
//   - `buckets.length === 0` (1/12 meses de servicio, o "medir tamaño = NO") → al marcar PREÑADA NO se
//     abre el sub-paso 2: se persiste directo `onConfirm('large')` (DD-PSC-2 — el enum no tiene un
//     "preñada sin tamaño"; 'large'=Cabeza es positivo y fiel para 1 mes/continuo; no contamina CCL
//     porque rodeos 1/12 no se reportan por CCL). El RESUMEN oculta el tamaño no medido (DD-PSC-8).
//   - `buckets.length === 2` (rodeo de 2 meses) → 2 bloques (CABEZA/COLA — sin CUERPO).
//   - `buckets.length === 3` (rodeo de 3–11 meses) → 3 bloques (= as-built actual).
// El componente NO re-implementa la regla CCL: la recibe ya resuelta en `buckets` (RPSC.5.8). El default
// `buckets` (caller que aún no pasa el prop, p.ej. el `carga.tsx` pre-cableado) = los 3 bloques as-built,
// para no romper el wiring real mientras este spike espera el veto. El CABLEADO de `buckets` al rodeo de
// la jornada es POST-VETO (no en este spike).
//
// Recorte de descendentes (memoria): "PREÑADA" trae ñ → veta el clip en el texto gigante ($10). Cero
// hardcode (ADR-023 §4): tokens. El header de identidad + la línea de maniobra los pone el FRAME.

import { useState } from 'react';
import { Platform } from 'react-native';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { ArrowLeft, Check, X } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';
import type { PregnancyStatus } from '@/utils/maneuver-sequence';
import type { SizeBucket } from '@/utils/pregnancy-buckets';

/** Buckets de tamaño as-built (3 bloques cabeza/cuerpo/cola) — default cuando el caller no pasa `buckets`
 *  todavía (wiring real pre-cableado). Espeja exactamente el comportamiento previo a B2. */
const DEFAULT_BUCKETS: SizeBucket[] = [
  { label: 'Cabeza', status: 'large' },
  { label: 'Cuerpo', status: 'medium' },
  { label: 'Cola', status: 'small' },
];

export type TactoStepProps = {
  /** Devuelve el pregnancy_status final (un único reproductive_events) al frame, que lo persiste. */
  onConfirm: (status: PregnancyStatus) => void;
  bottomPad: number;
  /** Buckets de tamaño a mostrar (de `sizeBucketsForServiceMonths`/`effectiveSizeBuckets`, RPSC.5.8).
   *  `[]` = sin sub-paso de tamaño (PREÑADA persiste 'large' directo, DD-PSC-2). Ausente = as-built 3 bloques. */
  buckets?: SizeBucket[];
};

type Phase = 'binary' | 'size';

/** Color de fondo de un bloque de decisión (token Tamagui). Acotado a los que usa el tacto. */
type DecisionColor = '$primary' | '$primaryPress' | '$terracota';

/** Un bloque de decisión gigante full-width que se reparte el alto (flex:1). Label centrado + ícono opcional. */
function DecisionBlock({
  label,
  bg,
  pressBg,
  icon,
  onPress,
}: {
  label: string;
  bg: DecisionColor;
  pressBg: DecisionColor;
  icon?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <View
      testID="decision-block"
      flex={1}
      backgroundColor={bg}
      borderRadius="$card"
      alignItems="center"
      justifyContent="center"
      gap="$2"
      pressStyle={{ backgroundColor: pressBg }}
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label })}
    >
      {icon}
      <Text fontFamily="$heading" fontSize="$10" lineHeight="$10" fontWeight="700" color="$white" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function TactoStep({ onConfirm, bottomPad, buckets = DEFAULT_BUCKETS }: TactoStepProps) {
  const [phase, setPhase] = useState<Phase>('binary');
  const WHITE = getTokenValue('$white', 'color');
  const DECISION_ICON = getTokenValue('$icon', 'size');

  // ¿Hay sub-paso de tamaño? Sólo si el rodeo produce ≥1 bucket (RPSC.5.2). `[]` → preñada sin tamaño.
  const measuresSize = buckets.length > 0;

  // PREÑADA: si NO se mide tamaño (1/12 meses o "medir = NO"), persiste 'large' directo (DD-PSC-2);
  // si se mide, abre el sub-paso 2 de tamaño.
  const onPregnant = () => {
    if (measuresSize) {
      setPhase('size');
    } else {
      onConfirm('large');
    }
  };

  if (phase === 'binary') {
    return (
      <YStack
        flex={1}
        backgroundColor="$bg"
        paddingHorizontal="$4"
        paddingTop="$2"
        paddingBottom={bottomPad}
        gap="$3"
      >
        <DecisionBlock
          label="PREÑADA"
          bg="$primary"
          pressBg="$primaryPress"
          icon={<Check size={DECISION_ICON} color={WHITE} strokeWidth={3} />}
          onPress={onPregnant}
        />
        <DecisionBlock
          label="VACÍA"
          bg="$terracota"
          pressBg="$terracota"
          icon={<X size={DECISION_ICON} color={WHITE} strokeWidth={3} />}
          onPress={() => onConfirm('empty')}
        />
      </YStack>
    );
  }

  // Sub-paso 2 — tamaño (solo si PREÑADA y hay buckets). N bloques = `buckets` del rodeo (RPSC.5.3–5.5).
  // 2 buckets (2 meses): CABEZA/COLA · 3 buckets (3–11 meses): CABEZA/CUERPO/COLA. Mapeo 1:1 (RPSC.5.6).
  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      {buckets.map((b) => (
        <DecisionBlock
          key={b.status}
          label={b.label.toUpperCase()}
          bg="$primary"
          pressBg="$primaryPress"
          onPress={() => onConfirm(b.status)}
        />
      ))}

      {/* Volver al sub-paso 1 (corrección antes de confirmar) — secundario, no compite con los bloques. */}
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        minHeight="$touchMin"
        pressStyle={{ opacity: 0.6 }}
        onPress={() => setPhase('binary')}
        {...buttonA11y(Platform.OS, { label: 'Volver a preñada o vacía' })}
      >
        <ArrowLeft size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2} />
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
          Volver
        </Text>
      </View>
    </YStack>
  );
}
