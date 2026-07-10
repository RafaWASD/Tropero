// app/maniobra/_components/SilentVaccinationStep.tsx — PASO SILENT_APPLY MULTI de VACUNACIÓN (spec 03 R6.1,
// delta-fix D2 · triage demo-facundo-padre 2026-07-10).
//
// D2 (patrón CONFIRMADO por Raf): las vacunas se definen SOLO antes de la maniobra (preconfig de la tanda).
// Dentro de cada animal NO se cargan vacunas nuevas: por cada vacuna DEFINIDA el operario elige APLICA /
// NO APLICA en un CHECKLIST grande — todas TILDADAS (APLICA) por default; tap la destilda (NO APLICA); tap
// de nuevo la vuelve a tildar. Se ELIMINÓ la vía de agregar vacunas nuevas por animal (chips + input libre +
// "Agregar" del diseño previo D1): el endurecimiento pedido → si falta una vacuna, se corrige en la config
// pre-maniobra (etapa 2), no acá.
//
// El CTA queda SIEMPRE habilitado (preserva el fix D1): con ≥1 tildada dice "Aplicar y seguir" (✓, persiste
// N `sanitary_events` — UNA fila por vacuna TILDADA, R6.1); con 0 tildadas dice "Seguir sin aplicar" (→, NO
// persiste ninguna fila — el animal no se vacuna). El resumen del animal (`describeStepValue`) queda HONESTO:
// N tildadas → sus nombres; 0 → "Sin vacuna". Solo se persisten las TILDADAS (`appliedVaccineNames`); las
// destildadas no escriben fila. El gating capa 2 lo re-valida server.
//
// El CEREBRO del checklist (universo de filas + estado inicial + subset APLICA) es PURO y testeado
// (`vaccine-checklist.ts`); este componente solo dibuja las filas grandes y togglea. Manga-friendly (memoria
// del repo): filas grandes (tap-target ≥$touchMin), alto contraste (APLICA verde / NO APLICA terracota),
// tilde clara, una mirada, sin teclado. Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue.
// Recorte de descendentes: lineHeight matching en el título.
//
// LAYOUT: el título + subtítulo + checklist viven en una CARD DOMINANTE de superficie (figura-fondo, patrón
// CondicionCorporalStep/SilentSanitaryStep) que ocupa el ALTO ÚTIL (`flex={1}`); el checklist scrollea
// internamente si entran muchas vacunas. El CTA gigante queda abajo en la zona del pulgar.

import { useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ArrowRight, Check } from 'lucide-react-native';

import { buttonA11y, switchA11y } from '@/utils/a11y';
import { appliedVaccineNames, buildVaccineChecklist } from '@/utils/vaccine-checklist';

export type SilentVaccinationStepProps = {
  /** Vacunas DEFINIDAS en la tanda (preconfig) = universo del checklist. El operario NO agrega nuevas acá. */
  definedProducts: readonly string[];
  /**
   * Subset ya APLICADO (solo al CORREGIR desde el resumen): undefined = primer paso (todas TILDADAS por
   * default); provisto = solo esas quedan tildadas (respeta el (des)tildado previo del operario).
   */
  appliedProducts?: readonly string[];
  /** Devuelve la lista de vacunas TILDADAS (APLICA). El frame persiste N sanitary_events vaccination. */
  onConfirm: (products: readonly string[]) => void;
  bottomPad: number;
};

export function SilentVaccinationStep({
  definedProducts,
  appliedProducts,
  onConfirm,
  bottomPad,
}: SilentVaccinationStepProps) {
  // Universo + estado inicial (APLICA por default / respeta corrección) — cerebro PURO, testeado.
  const [items, setItems] = useState(() => buildVaccineChecklist(definedProducts, appliedProducts));

  const WHITE = getTokenValue('$white', 'color');

  // Togglear una fila: APLICA ↔ NO APLICA (por nombre, único en el universo). Nada más se agrega/quita.
  function toggle(name: string) {
    setItems((prev) => prev.map((it) => (it.name === name ? { ...it, applies: !it.applies } : it)));
  }

  // ¿Hay al menos UNA vacuna TILDADA (APLICA)? Con 0 → el animal NO recibe vacuna: el CTA cambia a
  // "Seguir sin aplicar" y NO se persiste ninguna fila (path honesto D1 preservado). El CTA queda SIEMPRE
  // habilitado (poder no vacunar un animal puntual).
  const hasApplied = items.some((it) => it.applies);

  function handleConfirm() {
    onConfirm(appliedVaccineNames(items));
  }

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      {/* ── CARD DOMINANTE de superficie (figura-fondo): título + subtítulo + checklist ocupan el alto útil. ── */}
      <YStack
        flex={1}
        marginTop="$2"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$4"
        paddingVertical="$4"
        gap="$3"
      >
        <YStack gap="$1">
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={1}>
            Vacunas de la tanda
          </Text>
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={2}>
            Todas se aplican. Tocá una para marcarla como NO aplica.
          </Text>
        </YStack>

        {items.length === 0 ? (
          // Sin vacunas definidas en la tanda (sesión legacy: el endurecimiento de etapa 2 lo previene en
          // sesiones nuevas). Path honesto: no hay nada que aplicar → "Seguir sin aplicar".
          <View flex={1} justifyContent="center">
            <Text fontFamily="$body" fontSize="$4" lineHeight="$4" color="$textMuted" numberOfLines={2}>
              No hay vacunas definidas para esta tanda.
            </Text>
          </View>
        ) : (
          <ScrollView flex={1} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$2', 'space') }}>
            {items.map((it) => {
              const applies = it.applies;
              return (
                <Pressable
                  key={it.name}
                  onPress={() => toggle(it.name)}
                  testID={`vaccine-check-${it.name}`}
                  {...switchA11y(Platform.OS, { label: it.name, checked: applies, disabled: false })}
                >
                  {/* Figura-fondo por estado (3 señales, una mirada): APLICA = fila $greenLight + borde $primary +
                      casilla verde llena; NO APLICA = fila $white (recede sobre el card $surface) + borde $divider +
                      casilla vacía + rótulo "No aplica" terracota. Alto contraste manga. */}
                  <XStack
                    backgroundColor={applies ? '$greenLight' : '$white'}
                    borderRadius="$card"
                    borderWidth={applies ? 2 : 1}
                    borderColor={applies ? '$primary' : '$divider'}
                    paddingHorizontal="$3"
                    paddingVertical="$3"
                    minHeight="$touchMin"
                    alignItems="center"
                    gap="$3"
                    pressStyle={{ opacity: 0.85 }}
                  >
                    {/* CASILLA: APLICA = cuadro verde lleno + ✓ blanco; NO APLICA = cuadro vacío (outline). */}
                    <View
                      width={30}
                      height={30}
                      borderRadius="$2"
                      alignItems="center"
                      justifyContent="center"
                      backgroundColor={applies ? '$primary' : '$white'}
                      borderWidth={2}
                      borderColor={applies ? '$primary' : '$textMuted'}
                    >
                      {applies ? <Check size={20} color={WHITE} strokeWidth={3} /> : null}
                    </View>

                    {/* Nombre de la vacuna. APLICA = énfasis; NO APLICA = atenuado (pero legible). */}
                    <Text
                      flex={1}
                      minWidth={0}
                      fontFamily="$body"
                      fontSize="$5"
                      lineHeight="$5"
                      fontWeight={applies ? '700' : '600'}
                      color={applies ? '$textPrimary' : '$textMuted'}
                      numberOfLines={1}
                    >
                      {it.name}
                    </Text>

                    {/* RÓTULO de estado (alto contraste): "Aplica" ($primary) / "No aplica" ($terracota, la excepción). */}
                    {applies ? (
                      <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="700" color="$primary" numberOfLines={1}>
                        Aplica
                      </Text>
                    ) : (
                      <Text
                        fontFamily="$body"
                        fontSize="$3"
                        lineHeight="$3"
                        fontWeight="700"
                        color="$terracota"
                        numberOfLines={1}
                        testID={`vaccine-noaplica-${it.name}`}
                      >
                        No aplica
                      </Text>
                    )}
                  </XStack>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </YStack>

      {/* ── CTA GIGANTE (botella). SIEMPRE habilitado (fix D1): con ≥1 tildada "Aplicar y seguir" (✓, persiste
            N filas); con 0 "Seguir sin aplicar" (→, no persiste ninguna — el animal no se vacuna). ── */}
      <View
        testID="silent-apply"
        backgroundColor="$primary"
        borderRadius="$pill"
        minHeight="$touchMin"
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        pressStyle={{ backgroundColor: '$primaryPress' }}
        onPress={handleConfirm}
        {...buttonA11y(Platform.OS, { label: hasApplied ? 'Aplicar y seguir' : 'Seguir sin aplicar' })}
      >
        {hasApplied ? (
          <Check size={getTokenValue('$fabIcon', 'size')} color={WHITE} strokeWidth={3} />
        ) : (
          <ArrowRight size={getTokenValue('$fabIcon', 'size')} color={WHITE} strokeWidth={3} />
        )}
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          {hasApplied ? 'Aplicar y seguir' : 'Seguir sin aplicar'}
        </Text>
      </View>
    </YStack>
  );
}
