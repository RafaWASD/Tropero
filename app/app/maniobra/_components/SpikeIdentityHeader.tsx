// app/maniobra/_components/SpikeIdentityHeader.tsx — header de identidad del SPIKE (spec 03 M2.0).
//
// Header de identidad mínimo pero SIEMPRE visible (R12.4): la CARAVANA VISUAL HUMANA en GRANDE y bold
// (la verificación #1 del operario — la que LEE en la oreja, R12.4), y el TAG ELECTRÓNICO (RFID 15 díg)
// MUTED debajo como confirmación de la lectura BLE — espejando la pantalla de identificación
// (`identify-found.png`: "Caravana 0385" grande + "982 000412345678" muted). Luego rodeo + categoría en
// muted, y un chip de progreso. Fondo $surface (bone) → CONTEXTO, distinto de la zona de acción ($bg) →
// figura-fondo. Compartido por carga.tsx (decisión binaria) y paso.tsx (pesaje) para que las dos pantallas
// hero tengan EXACTAMENTE la misma capa de identidad. El call-site (carga.tsx) decide la PRIORIDAD de la
// identidad dominante (delta IDU: idv → tag; el 4to campo visual_id_alt se eliminó); el tag va acá secundario.
//
// SALTEAR (spec 03 delta `skip-animal-maniobra`, R5.15): prop OPCIONAL `onSkip`. Cuando el caller la pasa
// (carga.tsx en modo carga/resumen), el header muestra una afordancia "Saltear" en la ESQUINA SUP-DER (Fitts:
// esquina alta, lejos del CTA de confirmar de cada paso que vive ABAJO → sin tap accidental contra la acción
// primaria) y el chip de progreso baja a la línea rodeo·categoría. Sin `onSkip` (spikes: tacto-spike/rueda-ce/
// paso) el layout queda IDÉNTICO al original (chip arriba, sin botón) — cero regresión.
//
// JERARQUÍA (regla de campo, R12.4): el operario verifica el animal por la caravana VISUAL que lee en la
// oreja, NO por el RFID de 15 dígitos. Por eso `idv` (grande) = caravana visual humana, y `tagElectronic`
// (muted, opcional) = confirmación de la lectura electrónica. Consistencia (Jakob) con identify-found.png.
//
// RECORTE DE DESCENDENTES (memoria): el IDV ($9), el tag muted ($3) y la línea rodeo·categoría ($4, con
// numberOfLines) llevan lineHeight matching → g/q/p/j/y/ñ no se recortan.
//
// Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue.

import { Platform } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { SkipForward } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';

export type SpikeIdentityHeaderProps = {
  /** Identidad dominante ya resuelta por el caller (delta IDU: idv → tag) — la verificación #1 (grande, R12.4). */
  idv: string;
  /**
   * Tag electrónico (RFID 15 díg, ya formateado legible) — confirmación de la lectura BLE, MUTED y
   * secundario debajo de la caravana. Opcional: si el animal no tiene tag, o el spike mock no lo pasa,
   * no se renderiza la línea. NUNCA es la identidad dominante (R12.4).
   */
  tagElectronic?: string | null;
  /** Rodeo del animal (contexto, muted). */
  rodeo: string;
  /** Categoría del animal (contexto, muted). */
  categoria: string;
  /** Chip de progreso de la jornada, ej. "Animal 12". */
  progreso: string;
  /**
   * Saltear este animal (R5.15). Opcional: cuando está, aparece la afordancia "Saltear" en la esquina sup-der
   * y el chip de progreso baja a la línea rodeo·categoría. Sin ella, layout original (spikes).
   */
  onSkip?: () => void;
};

/** Chip de progreso "Animal N" (verde suave). Reusado arriba (sin skip) o abajo (con skip). */
function ProgressChip({ progreso }: { progreso: string }) {
  return (
    <View backgroundColor="$greenLight" borderRadius="$pill" paddingHorizontal="$3" paddingVertical="$1">
      <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="600" color="$primary" numberOfLines={1}>
        {progreso}
      </Text>
    </View>
  );
}

/** Afordancia "Saltear" — pill bordeado tappable en la esquina sup-der (alto contraste, target manga). */
function SkipAffordance({ onSkip }: { onSkip: () => void }) {
  return (
    <View
      flexShrink={0}
      flexDirection="row"
      alignItems="center"
      gap="$2"
      minHeight="$touchMin"
      paddingHorizontal="$3"
      backgroundColor="$bg"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      pressStyle={{ backgroundColor: '$greenLight' }}
      onPress={onSkip}
      testID="skip-animal"
      {...buttonA11y(Platform.OS, { label: 'Saltear este animal' })}
    >
      <SkipForward size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2.5} />
      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$textPrimary" numberOfLines={1}>
        Saltear
      </Text>
    </View>
  );
}

export function SpikeIdentityHeader({ idv, tagElectronic, rodeo, categoria, progreso, onSkip }: SpikeIdentityHeaderProps) {
  return (
    <YStack
      backgroundColor="$surface"
      paddingHorizontal="$4"
      paddingTop="$3"
      paddingBottom="$3"
      borderBottomWidth={1}
      borderBottomColor="$divider"
      gap="$1"
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$3">
        {/* Caravana VISUAL en GRANDE y bold (R12.4): la verificación #1 que el operario lee en la oreja.
            $9 = 30px, lineHeight matching para los descendentes. */}
        <Text
          fontFamily="$heading"
          fontSize="$9"
          lineHeight="$9"
          fontWeight="700"
          color="$textPrimary"
          numberOfLines={1}
          flexShrink={1}
        >
          {idv}
        </Text>
        {/* Con skip: la afordancia "Saltear" ocupa la esquina sup-der (el chip baja). Sin skip: el chip. */}
        {onSkip ? <SkipAffordance onSkip={onSkip} /> : <ProgressChip progreso={progreso} />}
      </XStack>
      {/* Tag electrónico MUTED como confirmación de la lectura BLE (secundario, espejo de identify-found).
          $3 con lineHeight matching; letterSpacing como en identify-found para legibilidad de la tira.
          Color $textMuted (AA 5.58:1 sobre $surface) — el tag es CHICO ($3 ≈ texto normal), así que NO
          usamos $textFaint (3.92:1, < AA para texto normal). La jerarquía la da el tamaño/peso, no el lavado:
          la caravana ($9 negro bold) domina; el tag ($3 muted) confirma la lectura. */}
      {tagElectronic ? (
        <Text
          fontFamily="$body"
          fontSize="$3"
          lineHeight="$3"
          fontWeight="500"
          color="$textMuted"
          numberOfLines={1}
          letterSpacing={0.5}
        >
          {tagElectronic}
        </Text>
      ) : null}
      {/* Rodeo · categoría. Con skip, el chip de progreso viaja acá a la derecha (el sup-der lo tomó "Saltear"). */}
      {onSkip ? (
        <XStack alignItems="center" justifyContent="space-between" gap="$3">
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" color="$textMuted" numberOfLines={1} flexShrink={1}>
            {rodeo} · {categoria}
          </Text>
          <ProgressChip progreso={progreso} />
        </XStack>
      ) : (
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" color="$textMuted" numberOfLines={1}>
          {rodeo} · {categoria}
        </Text>
      )}
    </YStack>
  );
}
