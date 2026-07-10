// app/maniobra/_components/SilentVaccinationStep.tsx — PASO SILENT_APPLY MULTI de VACUNACIÓN (spec 03 M3.2b, R6.1).
//
// La vacunación es silent_apply como antiparasitario/antibiótico, pero admite VARIAS vacunas simultáneas
// (R6.1): genera un sanitary_events (event_type='vaccination') por vacuna. La(s) vacuna(s) de la tanda
// (preconfig de M1, ej. ["Aftosa","Mancha"]) se muestran como CHIPS pre-cargados, editables (× quita,
// input + autocompletar agrega). CTA GIGANTE "Aplicar y seguir" → el frame persiste N sanitary_events.
//
// El CTA está habilitado SIEMPRE (delta-fix D1, triage 2026-07-10): el operario TIENE que poder NO vacunar a
// un animal puntual (la vacuna no le aplica) y seguir. Con ≥1 vacuna el CTA dice "Aplicar y seguir" (persiste
// N sanitary_events); con CERO vacunas dice "Seguir sin aplicar" y NO persiste ninguna fila (path honesto: el
// animal no recibe vacuna — el resumen lo muestra como "Sin vacuna", no "Aplicada"). Si el operario tipeó algo
// sin "Agregar", se incluye al confirmar (no se pierde el último tipeo). El gating capa 2 lo re-valida server.
//
// Reusa el patrón multi del wizard (ManeuverConfigSheet): chips con × + input $searchBarLg=56 + botón "+" +
// autocompletar "Usadas antes" (filterAutocomplete). NO se rediseña. Cero hardcode (ADR-023 §4): tokens;
// lucide vía getTokenValue (X/Plus con su literal de tamaño como en ManeuverConfigSheet). es-AR. Recorte de
// descendentes: lineHeight matching.
//
// LAYOUT (dirección del leader, fix-loop M3.2b — CERO ESPACIO MUERTO, Gate 0): el grupo "Vacunas aplicadas"
// + chips + input + autocompletar vive en una CARD DOMINANTE de superficie (figura-fondo, patrón
// CondicionCorporalStep) que ocupa el ALTO ÚTIL (`flex={1}`) → sin la banda muerta de ~50% que dejaba el
// contenido top-aligned. El CTA gigante "Aplicar y seguir" queda abajo en la zona del pulgar. La card
// scrollea internamente si entran muchas vacunas.

import { useMemo, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ArrowRight, Check, Plus, X } from 'lucide-react-native';

import { buttonA11y, labelA11y } from '@/utils/a11y';
import { filterAutocomplete } from '@/utils/maneuver-wizard';
import { PRODUCT_NAME_MAX_LENGTH } from '@/utils/maneuver-sequence';

export type SilentVaccinationStepProps = {
  /** Vacunas pre-cargadas de la tanda + corrección (ya parseadas a lista por el frame). */
  initialProducts?: readonly string[];
  /** Valores históricos del campo para el autocompletar (R1.8, "Usadas antes"). */
  history: readonly string[];
  /** Devuelve la lista de vacunas aplicadas. El frame persiste N sanitary_events vaccination. */
  onConfirm: (products: readonly string[]) => void;
  bottomPad: number;
};

export function SilentVaccinationStep({
  initialProducts = [],
  history,
  onConfirm,
  bottomPad,
}: SilentVaccinationStepProps) {
  const [items, setItems] = useState<string[]>(() => dedup(initialProducts));
  const [typed, setTyped] = useState<string>('');

  const placeholderColor = getTokenValue('$textMuted', 'color');
  const textColor = getTokenValue('$textPrimary', 'color');
  const borderColor = getTokenValue('$divider', 'color');
  const surfaceColor = getTokenValue('$white', 'color');
  const inputFontSize = getTokenValue('$inputText', 'size');
  const inputMinHeight = getTokenValue('$searchBarLg', 'size');
  const radius = getTokenValue('$card', 'radius');
  const padH = getTokenValue('$4', 'space');
  const PRIMARY = getTokenValue('$primary', 'color');
  const FAINT = getTokenValue('$textFaint', 'color');

  const trimmed = typed.trim();

  // Sugerencias: históricas que matchean lo tipeado, excluyendo las ya agregadas (no re-sugerir lo puesto).
  const itemsLower = useMemo(() => new Set(items.map((i) => i.toLowerCase())), [items]);
  const suggestions = useMemo(
    () => filterAutocomplete(history, typed, 6).filter((s) => !itemsLower.has(s.toLowerCase())),
    [history, typed, itemsLower],
  );

  function addItem(raw: string) {
    const v = raw.trim();
    if (v.length === 0) return;
    setItems((prev) => (prev.some((p) => p.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v]));
    setTyped('');
  }

  function removeItem(target: string) {
    setItems((prev) => prev.filter((p) => p !== target));
  }

  // Confirmar: incluye lo tipeado sin "Agregar" (no se pierde el último tipeo) + dedup.
  function handleConfirm() {
    const pending =
      trimmed.length > 0 && !items.some((p) => p.toLowerCase() === trimmed.toLowerCase());
    onConfirm(dedup(pending ? [...items, trimmed] : items));
  }

  // ¿Hay al menos UNA vacuna que se va a aplicar? (una agregada como chip, o algo tipeado sin "Agregar" que se
  // incluye al confirmar). Con CERO → el animal NO recibe vacuna: el CTA cambia a "Seguir sin aplicar" y NO se
  // persiste ninguna fila (la vacunación escribe UN sanitary_event POR VACUNA — R6.1 — así que 0 vacunas = 0
  // filas, path honesto). El CTA queda SIEMPRE habilitado (delta-fix D1): poder no vacunar un animal puntual.
  const hasVaccines = items.length > 0 || trimmed.length > 0;

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      {/* ── CARD DOMINANTE de superficie (figura-fondo): el título + chips + input + autocompletar ocupan el
            ALTO ÚTIL (flex:1) → cero banda muerta. Scrollea internamente si entran muchas vacunas. ── */}
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
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary" numberOfLines={1}>
        Vacunas aplicadas
      </Text>

      <ScrollView flex={1} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$3', 'space') }}>
        {/* Chips de vacunas YA agregadas. Tocar la × quita la vacuna. */}
        {items.length > 0 ? (
          <XStack flexWrap="wrap" gap="$2">
            {items.map((it) => (
              <XStack
                key={it}
                backgroundColor="$greenLight"
                borderRadius="$pill"
                paddingLeft="$3"
                paddingRight="$2"
                paddingVertical="$2"
                alignItems="center"
                gap="$2"
                testID={`vaccine-chip-${it}`}
              >
                <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary" numberOfLines={1}>
                  {it}
                </Text>
                <Pressable onPress={() => removeItem(it)} hitSlop={8} {...buttonA11y(Platform.OS, { label: `Quitar ${it}` })}>
                  <X size={18} color={PRIMARY} strokeWidth={3} />
                </Pressable>
              </XStack>
            ))}
          </XStack>
        ) : null}

        {/* INPUT GRANDE + botón "Agregar". */}
        <XStack gap="$2" alignItems="center">
          <View flex={1}>
            <TextInput
              value={typed}
              // Tope de longitud (UX/defensa-en-profundidad) = cap server-side de sanitary_events.product_name
              // (CHECK <= 160, 0070). `maxLength` corta en native; el `.slice` asegura el tope también en web.
              onChangeText={(t) => setTyped(t.slice(0, PRODUCT_NAME_MAX_LENGTH))}
              maxLength={PRODUCT_NAME_MAX_LENGTH}
              placeholder="Ej.: Aftosa"
              placeholderTextColor={placeholderColor}
              autoCapitalize="sentences"
              returnKeyType="done"
              onSubmitEditing={() => addItem(typed)}
              testID="vaccine-input"
              style={{
                minHeight: inputMinHeight,
                borderRadius: radius,
                borderWidth: 1,
                borderColor,
                backgroundColor: surfaceColor,
                paddingHorizontal: padH,
                fontSize: inputFontSize,
                fontFamily: 'Inter',
                color: textColor,
              }}
              {...labelA11y(Platform.OS, 'Vacuna')}
            />
          </View>
          <Pressable
            onPress={() => addItem(typed)}
            disabled={trimmed.length === 0}
            {...buttonA11y(Platform.OS, { label: 'Agregar vacuna', disabled: trimmed.length === 0 })}
          >
            <View
              width={inputMinHeight}
              height={inputMinHeight}
              borderRadius="$card"
              alignItems="center"
              justifyContent="center"
              backgroundColor={trimmed.length === 0 ? '$white' : '$primary'}
              borderWidth={1}
              borderColor={trimmed.length === 0 ? '$divider' : '$primary'}
            >
              <Plus size={24} color={trimmed.length === 0 ? FAINT : surfaceColor} strokeWidth={3} />
            </View>
          </Pressable>
        </XStack>

        {/* AUTOCOMPLETAR (R1.8). */}
        {suggestions.length > 0 ? (
          <YStack gap="$2">
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
              Usadas antes
            </Text>
            <XStack flexWrap="wrap" gap="$2">
              {suggestions.map((s) => (
                <Pressable key={s} onPress={() => addItem(s)} {...buttonA11y(Platform.OS, { label: `Usar ${s}` })}>
                  <View
                    backgroundColor="$white"
                    borderRadius="$pill"
                    borderWidth={1}
                    borderColor="$divider"
                    paddingHorizontal="$3"
                    paddingVertical="$2"
                    testID={`vaccine-suggestion-${s}`}
                  >
                    <Text fontFamily="$body" fontSize="$4" lineHeight="$4" color="$textPrimary" numberOfLines={1}>
                      {s}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </XStack>
          </YStack>
        ) : null}
      </ScrollView>
      </YStack>

      {/* ── CTA GIGANTE (botella). SIEMPRE habilitado (delta-fix D1): con ≥1 vacuna "Aplicar y seguir" (✓,
            persiste N filas); con CERO "Seguir sin aplicar" (→, no persiste ninguna — el animal no se vacuna). ── */}
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
        {...buttonA11y(Platform.OS, { label: hasVaccines ? 'Aplicar y seguir' : 'Seguir sin aplicar' })}
      >
        {hasVaccines ? (
          <Check size={getTokenValue('$fabIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
        ) : (
          <ArrowRight size={getTokenValue('$fabIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
        )}
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          {hasVaccines ? 'Aplicar y seguir' : 'Seguir sin aplicar'}
        </Text>
      </View>
    </YStack>
  );
}

/** Dedup case-insensitive preservando orden + casing del primer visto (espeja splitMultiPreconfig). */
function dedup(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (v.length === 0) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
