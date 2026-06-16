// app/maniobra/_components/InseminacionStep.tsx — PASO de INSEMINACIÓN (spec 03 M3.2b fix, R6.5).
//
// La inseminación elige la PAJUELA (semen) y registra un reproductive_events (event_type='service',
// service_type='ai') — el write-path lo arma el orquestador M3.1 (buildAddManeuverInseminationInsert; la
// pajuela va en `notes`). Este paso SOLO captura el nombre de la pajuela. R6.5:
//   - 1 PAJUELA preconfigurada (de la tanda, M1) → confirmar de UN toque (mismo patrón silent_apply SINGLE:
//     la pajuela como HERO grande + "Cambiar pajuela" + "Aplicar y seguir"). Reusa SilentSanitaryStep con la
//     copia de inseminación ("pajuela" en vez de "producto").
//   - >1 PAJUELA disponible → SELECTOR: bloques grandes con cada pajuela disponible (un toque = elige y
//     aplica), + "Otra pajuela" que abre el modo de UN producto (input + autocompletar) para una libre.
// La pajuela es texto libre + autocompletar de valores usados antes (R1.8, sin catálogo de stock).
//
// LAYOUT (dirección del leader, CERO ESPACIO MUERTO): el selector son bloques full-width que se REPARTEN el
// alto (figura-fondo, patrón TactoVaquillonaStep/blocks); el modo single delega en SilentSanitaryStep (card
// dominante). Sin banda muerta. Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. es-AR no
// aplica a la pajuela (nombre/código de máquina, no número humano). Recorte de descendentes: lineHeight
// matching en todo Text.

import { useState } from 'react';
import { Platform } from 'react-native';
import { getTokenValue, ScrollView, Text, View, YStack } from 'tamagui';
import { Check, Plus } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';
import { SilentSanitaryStep } from './SilentSanitaryStep';

export type InseminacionStepProps = {
  /**
   * Pajuelas DISPONIBLES de la tanda (de la preconfig de M1). 0/1 → modo single (confirmar de un toque);
   * >1 → selector (R6.5). Ya dedupeadas/limpias por el frame.
   */
  availablePajuelas: readonly string[];
  /** Pajuela ya cargada (corrección desde el resumen, R5.9) o '' si es la 1ra captura. */
  initialPajuela?: string;
  /** Valores históricos del campo para el autocompletar (R1.8, "Usadas antes"). */
  history: readonly string[];
  /** Devuelve la pajuela elegida. El frame persiste el reproductive_events service ai (M3.1). */
  onConfirm: (semenName: string) => void;
  bottomPad: number;
};

export function InseminacionStep({
  availablePajuelas,
  initialPajuela,
  history,
  onConfirm,
  bottomPad,
}: InseminacionStepProps) {
  // ¿El operario tocó "Otra pajuela" en el selector multi? → cae al modo de UN producto (input + autocompletar).
  const [otherMode, setOtherMode] = useState(false);

  const startedWith = (initialPajuela ?? '').trim();
  // CORRECCIÓN (R5.9): si ya hay una pajuela cargada, mostrarla directamente en el modo single (hero) — el
  // operario ve lo que eligió y puede cambiarla; no re-mostramos el selector (ya hubo elección).
  const single = availablePajuelas.length <= 1 || startedWith.length > 0 || otherMode;

  if (single) {
    // 1 pajuela (o ninguna, o "otra", o corrección): patrón silent_apply SINGLE con copia de inseminación.
    return (
      <SilentSanitaryStep
        title="Inseminación"
        preconfigProduct={availablePajuelas.length === 1 ? availablePajuelas[0] : ''}
        initialProduct={initialPajuela}
        history={history}
        bottomPad={bottomPad}
        noun="pajuela"
        questionLabel="¿Qué pajuela usaste?"
        changeLabel="Cambiar pajuela"
        emptyHero="Sin pajuela"
        inputPlaceholder="Ej.: Toro 123"
        ctaLabel="Aplicar y seguir"
        onConfirm={onConfirm}
      />
    );
  }

  // >1 pajuela DISPONIBLE → SELECTOR (R6.5): bloques grandes que se reparten el alto + "Otra pajuela".
  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
        Elegí la pajuela
      </Text>
      <ScrollView flex={1} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$3', 'space'), flexGrow: 1 }}>
        {availablePajuelas.map((p) => (
          <View
            key={p}
            testID={`pajuela-block-${p}`}
            flex={1}
            minHeight="$searchBarLg"
            backgroundColor="$primary"
            borderRadius="$card"
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            gap="$2"
            paddingHorizontal="$4"
            paddingVertical="$4"
            pressStyle={{ backgroundColor: '$primaryPress' }}
            onPress={() => onConfirm(p)}
            {...buttonA11y(Platform.OS, { label: `Usar pajuela ${p}` })}
          >
            <Check size={getTokenValue('$icon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
            <Text fontFamily="$heading" fontSize="$8" lineHeight="$8" fontWeight="700" color="$white" textAlign="center" numberOfLines={2}>
              {p}
            </Text>
          </View>
        ))}
        {/* "Otra pajuela" → modo single (input + autocompletar) para una pajuela libre fuera de la tanda. */}
        <View
          testID="pajuela-other"
          minHeight="$searchBarLg"
          backgroundColor="$surface"
          borderRadius="$card"
          borderWidth={1}
          borderColor="$divider"
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          gap="$2"
          paddingHorizontal="$4"
          paddingVertical="$3"
          pressStyle={{ backgroundColor: '$divider' }}
          onPress={() => setOtherMode(true)}
          {...buttonA11y(Platform.OS, { label: 'Otra pajuela' })}
        >
          <Plus size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={3} />
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$primary" numberOfLines={1}>
            Otra pajuela
          </Text>
        </View>
      </ScrollView>
    </YStack>
  );
}
