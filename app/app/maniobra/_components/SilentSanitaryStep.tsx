// app/maniobra/_components/SilentSanitaryStep.tsx — PASO SILENT_APPLY de UN producto (spec 03 M3.2b).
//
// Antiparasitario (deworming, R6.13/R6.14) + Antibiótico (treatment, R6.15): maniobras sanitarias estilo
// "silenciosa" igual que la vacunación (R6.1). TAMBIÉN lo reusa la INSEMINACIÓN (R6.5, ver InseminacionStep)
// para la pajuela de la tanda (mismo patrón "producto hero + Cambiar + Aplicar"). El producto de la tanda
// (preconfig de M1, ej. "Ivermectina") se muestra GRANDE/hero + un CTA GIGANTE "Aplicar y seguir" → un
// toque, mínima fricción ("silent_apply").
//
// DOS modos según haya o no producto preconfigurado:
//   - CON producto (de config.preconfig[<maniobra>]) → hero del producto + "Aplicar y seguir" (1 toque).
//     El producto es EDITABLE: tocar "Cambiar producto" abre el input + autocompletar para reemplazarlo.
//   - SIN producto → el input GRANDE + autocompletar "Usadas antes" (reusando filterAutocomplete) es lo
//     primero a la vista; recién con un producto válido se habilita "Aplicar y seguir".
//
// LAYOUT (dirección del leader, fix-loop M3.2b — CERO ESPACIO MUERTO, Gate 0): el contenido es una CARD
// DOMINANTE de superficie (figura-fondo, patrón de CondicionCorporalStep) que ocupa el ALTO DISPONIBLE
// (`flex={1}`) en vez de dejar el hero flotando en el medio con bandas vacías arriba/abajo. El producto es
// el HERO grande centrado dentro de la card; "Cambiar producto" vive ADENTRO de la card (espacialmente
// DISJUNTO del CTA "Aplicar y seguir", que va abajo full-width) → sin riesgo de mis-tap entre aplicar y
// cambiar. La card llena el alto; el CTA gigante queda en la zona del pulgar. Sin banda muerta de 50%.
//
// El producto NO es required por gating (la maniobra es silent: el operario puede aplicar sin tipear el
// nombre exacto — el dato útil es "se aplicó", el product_name es libre). Por eso "Aplicar y seguir" está
// habilitado SIEMPRE (con o sin producto): un producto vacío persiste un sanitary_event con product_name
// vacío (la maniobra igual se registró). El gating capa 2 (data_key enabled del rodeo real) lo re-valida
// server-side, no el nombre del producto.
//
// Reusa el patrón de input/autocompletar del wizard (ManeuverConfigSheet): input $searchBarLg=56 +
// chips "Usadas antes". NO se rediseña. Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. es-AR.
// Recorte de descendentes: lineHeight matching en todo heading/Text con numberOfLines.
//
// HERO del producto (web-safe, fix M3.2b): el nombre es texto LIBRE de longitud variable → su tamaño se
// elige por la LONGITUD del string en buckets (`heroFontTokenForName`, length-aware step-down: nombre típico
// GRANDE / largo más chico). NO se usa `adjustsFontSizeToFit` (NO-OP en react-native-web, memoria
// reference_rn_web_pitfalls → con $11 fijo el nombre largo overfloweaba horizontal saliéndose de la
// pantalla). El caso patológico (string larguísimo sin espacios) no overflowea: width 100% + word-break
// (CSS web-only) parte la palabra y `numberOfLines={2}` elipsa como último recurso.

import { useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, Pencil } from 'lucide-react-native';

import { buttonA11y, labelA11y } from '@/utils/a11y';
import { filterAutocomplete } from '@/utils/maneuver-wizard';
import { heroFontTokenForName } from '@/utils/hero-text-size';
import { PRODUCT_NAME_MAX_LENGTH } from '@/utils/maneuver-sequence';

export type SilentSanitaryStepProps = {
  /** Nombre es-AR de la maniobra (ej. "Antiparasitario"), para los títulos. */
  title: string;
  /** Producto preconfigurado de la tanda (config.preconfig[<maniobra>]) o '' si no hay. */
  preconfigProduct: string;
  /** Valor ya cargado (corrección desde el resumen, R5.9) o '' si es la 1ra captura. */
  initialProduct?: string;
  /** Valores históricos del campo para el autocompletar (R1.8, "Usadas antes"). */
  history: readonly string[];
  /** Devuelve el producto aplicado (puede ser '' = aplicado sin nombre). El frame persiste el sanitary_event. */
  onConfirm: (productName: string) => void;
  bottomPad: number;
  /**
   * Copy CONFIGURABLE para reusar el componente en INSEMINACIÓN (R6.5: la "pajuela" en vez del "producto").
   * Todos opcionales → defaults a la copia sanitaria. La inseminación pasa pajuela/Cambiar pajuela/etc.
   */
  noun?: string; // sustantivo del valor para los labels (default "producto", inseminación "pajuela").
  questionLabel?: string; // pregunta en modo edición (default "¿Qué <title> aplicaste?").
  changeLabel?: string; // label del botón editar (default "Cambiar producto").
  emptyHero?: string; // hero cuando no hay valor (default "Sin producto").
  inputPlaceholder?: string; // placeholder del input (default "Ej.: Ivermectina").
  ctaLabel?: string; // label del CTA (default "Aplicar y seguir").
};

export function SilentSanitaryStep({
  title,
  preconfigProduct,
  initialProduct,
  history,
  onConfirm,
  bottomPad,
  noun = 'producto',
  questionLabel,
  changeLabel,
  emptyHero,
  inputPlaceholder = 'Ej.: Ivermectina',
  ctaLabel = 'Aplicar y seguir',
}: SilentSanitaryStepProps) {
  const resolvedQuestion = questionLabel ?? `¿Qué ${title.toLowerCase()} aplicaste?`;
  const resolvedChange = changeLabel ?? `Cambiar ${noun}`;
  const resolvedEmpty = emptyHero ?? `Sin ${noun}`;
  // Producto vigente: el ya cargado (corrección) gana sobre el preconfig de la tanda.
  const startProduct = (initialProduct ?? '').trim() || preconfigProduct.trim();
  const [product, setProduct] = useState<string>(startProduct);
  // ¿Editando el producto? Arranca en modo edición si NO hay producto inicial (hay que cargarlo).
  const [editing, setEditing] = useState<boolean>(startProduct.length === 0);
  const [typed, setTyped] = useState<string>('');

  const placeholderColor = getTokenValue('$textMuted', 'color');
  const textColor = getTokenValue('$textPrimary', 'color');
  const borderColor = getTokenValue('$divider', 'color');
  const surfaceColor = getTokenValue('$white', 'color');
  const inputFontSize = getTokenValue('$inputText', 'size');
  const inputMinHeight = getTokenValue('$searchBarLg', 'size');
  const radius = getTokenValue('$card', 'radius');
  const padH = getTokenValue('$4', 'space');

  const suggestions = editing ? filterAutocomplete(history, typed, 6) : [];

  // HERO del producto (modo lectura): el nombre vigente o el placeholder "Sin <noun>". El tamaño se elige
  // por la LONGITUD del nombre (length-aware step-down, web-safe) — un $11 fijo overfloweaba en web.
  const heroName = product || resolvedEmpty;
  const heroToken = heroFontTokenForName(heroName);

  function commitTyped() {
    const v = typed.trim();
    setProduct(v);
    setEditing(false);
    setTyped('');
  }

  function pickSuggestion(s: string) {
    setProduct(s);
    setEditing(false);
    setTyped('');
  }

  function startEditing() {
    setTyped(product);
    setEditing(true);
  }

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      {/* ── CARD DOMINANTE de superficie (figura-fondo, patrón CondicionCorporalStep): ocupa el ALTO ÚTIL
            (flex:1) → cero banda muerta. Contiene el HERO del producto (lectura) o el input+autocompletar
            (edición). "Cambiar producto" vive ADENTRO de la card, espacialmente DISJUNTO del CTA de abajo. ── */}
      <YStack
        flex={1}
        marginTop="$2"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$4"
        paddingVertical="$5"
        gap="$4"
      >
        {editing ? (
          // MODO EDICIÓN: pregunta + input grande + autocompletar. El bloque se ancla arriba pero la card
          // (flex:1) llena el alto igual → sin vacío grande (el resto de la card es el área de la card).
          <YStack gap="$4">
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary" numberOfLines={2}>
              {resolvedQuestion}
            </Text>
            <TextInput
              value={typed}
              // Tope de longitud (UX/defensa-en-profundidad) = cap server-side de sanitary_events.product_name
              // (CHECK <= 160, 0070). `maxLength` corta en native; el `.slice` adicional asegura el tope también
              // en web (react-native-web no siempre honra maxLength) — mismo patrón que LabSampleStep (tube).
              onChangeText={(t) => setTyped(t.slice(0, PRODUCT_NAME_MAX_LENGTH))}
              maxLength={PRODUCT_NAME_MAX_LENGTH}
              placeholder={inputPlaceholder}
              placeholderTextColor={placeholderColor}
              autoCapitalize="sentences"
              returnKeyType="done"
              onSubmitEditing={commitTyped}
              testID="silent-product-input"
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
              {...labelA11y(Platform.OS, title)}
            />
            {/* AUTOCOMPLETAR (R1.8): valores usados antes que matchean lo tipeado. */}
            {suggestions.length > 0 ? (
              <YStack gap="$2">
                <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
                  Usadas antes
                </Text>
                <XStack flexWrap="wrap" gap="$2">
                  {suggestions.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => pickSuggestion(s)}
                      {...buttonA11y(Platform.OS, { label: `Usar ${s}` })}
                    >
                      <View
                        backgroundColor="$white"
                        borderRadius="$pill"
                        borderWidth={1}
                        borderColor="$divider"
                        paddingHorizontal="$3"
                        paddingVertical="$2"
                        testID={`silent-suggestion-${s}`}
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
          </YStack>
        ) : (
          // HERO del producto (modo lectura): centrado en la card dominante → producto GRANDE + "Cambiar".
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$5">
            <YStack alignItems="center" gap="$3" width="100%">
              <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" numberOfLines={1}>
                {title}
              </Text>
              {/* TAMAÑO length-aware (web-safe): el nombre es texto LIBRE de longitud variable → un $11 fijo
                  + adjustsFontSizeToFit (NO-OP en react-native-web, memoria reference_rn_web_pitfalls) lo
                  hacía overflowear horizontal. heroFontTokenForName baja el token por buckets de longitud
                  (típico GRANDE / largo más chico). El caso patológico (string larguísimo sin espacios) no
                  overflowea: width 100% + word-break parte la palabra; si excede 2 líneas, elipsa. */}
              <Text
                testID="silent-product-hero"
                fontFamily="$heading"
                fontSize={heroToken.fontSize}
                lineHeight={heroToken.lineHeight}
                fontWeight="700"
                color="$textPrimary"
                textAlign="center"
                width="100%"
                numberOfLines={2}
                ellipsizeMode="tail"
                // overflowWrap/wordBreak son CSS web-only (react-native-web): garantizan que un string largo
                // SIN espacios parta dentro del ancho en vez de overflowear horizontal. En native son no-op.
                style={Platform.OS === 'web' ? ({ overflowWrap: 'anywhere', wordBreak: 'break-word' } as object) : undefined}
              >
                {heroName}
              </Text>
            </YStack>
            <Pressable onPress={startEditing} {...buttonA11y(Platform.OS, { label: resolvedChange })}>
              <XStack
                alignItems="center"
                gap="$2"
                backgroundColor="$white"
                borderRadius="$pill"
                borderWidth={1}
                borderColor="$divider"
                paddingHorizontal="$4"
                paddingVertical="$3"
                testID="silent-edit-product"
              >
                <Pencil size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} />
                <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$primary" numberOfLines={1}>
                  {resolvedChange}
                </Text>
              </XStack>
            </Pressable>
          </YStack>
        )}
      </YStack>

      {/* ── CTA GIGANTE (botella, zona del pulgar). En edición confirma el producto tipeado primero (commit)
            y aplica; en lectura aplica el producto vigente. Siempre habilitado (silent). DISJUNTO de "Cambiar"
            (que vive dentro de la card de arriba) → sin riesgo de mis-tap entre aplicar y cambiar. ── */}
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
        onPress={() => onConfirm(editing ? typed.trim() : product.trim())}
        {...buttonA11y(Platform.OS, { label: ctaLabel })}
      >
        <Check size={getTokenValue('$fabIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          {ctaLabel}
        </Text>
      </View>
    </YStack>
  );
}
