// app/maniobra/_components/SpikeIdentityHeader.tsx — header de identidad del SPIKE (spec 03 M2.0).
//
// Header de identidad mínimo pero SIEMPRE visible (R12.4): la CARAVANA VISUAL HUMANA en GRANDE y bold
// (la verificación #1 del operario — la que LEE en la oreja, R12.4), y el TAG ELECTRÓNICO (RFID 15 díg)
// MUTED debajo como confirmación de la lectura BLE — espejando la pantalla de identificación
// (`identify-found.png`: "Caravana 0385" grande + "982 000412345678" muted). Luego rodeo + categoría en
// muted, y un chip de progreso. Fondo $surface (bone) → CONTEXTO, distinto de la zona de acción ($bg) →
// figura-fondo. Compartido por carga.tsx (decisión binaria) y paso.tsx (pesaje) para que las dos pantallas
// hero tengan EXACTAMENTE la misma capa de identidad. El call-site (carga.tsx) decide la PRIORIDAD
// visual > electrónico (`visual_id_alt || idv`); el tag electrónico va acá como secundario.
//
// JERARQUÍA (regla de campo, R12.4): el operario verifica el animal por la caravana VISUAL que lee en la
// oreja, NO por el RFID de 15 dígitos. Por eso `idv` (grande) = caravana visual humana, y `tagElectronic`
// (muted, opcional) = confirmación de la lectura electrónica. Consistencia (Jakob) con identify-found.png.
//
// RECORTE DE DESCENDENTES (memoria): el IDV ($9), el tag muted ($3) y la línea rodeo·categoría ($4, con
// numberOfLines) llevan lineHeight matching → g/q/p/j/y/ñ no se recortan.
//
// Cero hardcode (ADR-023 §4): tokens.

import { Text, View, XStack, YStack } from 'tamagui';

export type SpikeIdentityHeaderProps = {
  /** Caravana VISUAL humana (`visual_id_alt || idv`) — la verificación #1 (grande y bold, R12.4). */
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
};

export function SpikeIdentityHeader({ idv, tagElectronic, rodeo, categoria, progreso }: SpikeIdentityHeaderProps) {
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
        <View backgroundColor="$greenLight" borderRadius="$pill" paddingHorizontal="$3" paddingVertical="$1">
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="600" color="$primary" numberOfLines={1}>
            {progreso}
          </Text>
        </View>
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
      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" color="$textMuted" numberOfLines={1}>
        {rodeo} · {categoria}
      </Text>
    </YStack>
  );
}
