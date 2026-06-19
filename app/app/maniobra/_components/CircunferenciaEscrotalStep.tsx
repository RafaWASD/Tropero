// app/maniobra/_components/CircunferenciaEscrotalStep.tsx — PASO de CIRCUNFERENCIA ESCROTAL (CE) del toro.
//
// Spec 03 M6 (US-14, R14.5/R14.6/R14.7) — renderer del StepKind 'rueda', 🔴 manga-crítico. Nació como DESIGN
// SPIKE VISUAL en M6-C.0 (el harness `maniobra/rueda-ce.tsx` lo montaba con mock data para la captura/veto del
// leader) y quedó CABLEADO a carga.tsx + la persistencia en M6-C.1: carga.tsx lo dispatcha en `case 'rueda':`
// con props reales (initialCm = última medida local o 36 / ageMonths = prefill de birth_date / onConfirm →
// write-path `addScrotalMeasurement`).
//
// DIRECCIÓN DE DISEÑO (leader, fix-loop v2):
//   - CAMPO EDITABLE (HERO PRIMARIO): el readout de arriba es un INPUT bordeado (caja estilo-input) que
//     muestra "36,5 cm" (es-AR, coma) con affordance clara de editable (ícono de teclado). Tap → TECLADO
//     numérico del dispositivo (keyboardType decimal) para TIPEAR los cm a mano. Es el valor protagonista.
//     Sincronía BIDIRECCIONAL con la rueda: scrollear la rueda actualiza el campo; tipear en el campo
//     mueve/snapea la rueda. Un único valor canónico (`cm`). Validación PURA (parseCmInput): "36,5"/"36.5"
//     → número; clamp [20,50]; redondeo al 0,5 más cercano; no-numérico → revierte. Target ≥56.
//   - RUEDA DE CE (SELECTOR, gradiente de tamaño): drum/wheel picker inercial (WheelPicker) con la celda
//     central ENFATIZADA (más grande + sólida) vs vecinos chicos/atenuados → el valor elegido RESALTA. Fling
//     rápido pasa muchos valores, drag lento es preciso, snap al valor, tick háptico. 20–50 cm, paso 0,5.
//   - Jerarquía: CAMPO editable (primario, bordeado, input) > centro de la rueda (enfatizado) > vecinos
//     (chicos/atenuados). El campo y la rueda muestran el MISMO valor con ROLES visuales distintos.
//   - EDAD como control SECUNDARIO PRELLENADO (no compite con la CE): "≈ 24 meses" (mock) con affordance de
//     tap-to-ajustar que abre una rueda de MESES (mismo idiom, 6–120, paso 1). El default visible =
//     prellenado desde birth_date (R14.6); siempre ajustable (R14.7). Puede quedar "Edad sin definir".
//   - CONFIRM GIGANTE full-width abajo (R5.2/R12.2, zona del pulgar). Densidad ≥60% del alto útil (R12.5).
//
// es-AR (memoria reference_es_ar_number_format): coma decimal en el display ("36,5 cm", "≈ 24 meses"); el
// valor que persistiría es float de máquina (lo arma el StepValue del orquestador en M6-C.1). Cero hardcode
// (ADR-023 §4): tokens; lucide vía getTokenValue. Toda la aritmética (rango/paso/snap/formato/edad) vive en
// la util PURA `wheel-picker.ts` (testeada sin UI) — este componente solo dibuja y delega.
//
// ⚠️ GUARD ANTI TAP-THROUGH del sheet de edad (web táctil, regla `reference_rn_web_pitfalls`): el scrim del
// sheet lleva el guard `readyToDismissRef` armado en el próximo frame (doble rAF + fallback setTimeout(0)),
// idiom LOCKEADO de ManeuverConfigSheet/SavePresetSheet — el click huérfano del tap que abre el sheet no lo
// auto-cierra; un tap deliberado posterior sí.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, Keyboard as KeyboardIcon, Pencil } from 'lucide-react-native';

import { buttonA11y, labelA11y } from '@/utils/a11y';
import {
  AGE_WHEEL,
  CE_DEFAULT_CM,
  CE_WHEEL,
  formatAgeLabel,
  formatCmAR,
  formatMonthsAR,
  formatMonthsNum,
  initialAgeIndex,
  indexToValue,
  parseCmInput,
  snapToWheel,
} from '@/utils/wheel-picker';
import { WheelPicker } from './WheelPicker';

export type ScrotalStepResult = {
  /** CE confirmada en cm (float de máquina, ej. 36.5). El step la snapea/clampa al rango. */
  circumferenceCm: number;
  /** Edad en meses confirmada (snapshot, R14.8) o null si quedó desconocida (R14.7). */
  ageMonths: number | null;
};

export type CircunferenciaEscrotalStepProps = {
  /** Valor inicial de la rueda de CE (última medida del animal o 36,0 cm si es la 1ra). Default 36. */
  initialCm?: number;
  /** Edad PRELLENADA en meses (calculada de birth_date por el caller, R14.6) o null si sin fecha. */
  ageMonths?: number | null;
  /** Devuelve la CE + edad confirmadas (el frame las persiste con session_id en M6-C.1). */
  onConfirm: (result: ScrotalStepResult) => void;
  bottomPad: number;
};

export function CircunferenciaEscrotalStep({
  initialCm = CE_DEFAULT_CM,
  ageMonths = null,
  onConfirm,
  bottomPad,
}: CircunferenciaEscrotalStepProps) {
  // Valor de CE seleccionado (centrado en la rueda). Snapeado al entrar (corrección/última medida).
  const [cm, setCm] = useState<number>(() => snapToWheel(initialCm, CE_WHEEL));
  // Edad confirmada (snapshot). null = desconocida (sin fecha y sin ajuste). Se prellena del caller.
  const [age, setAge] = useState<number | null>(() =>
    ageMonths == null ? null : snapToWheel(ageMonths, AGE_WHEEL),
  );
  // Sheet de ajuste de edad (rueda de meses) abierto.
  const [ageSheetOpen, setAgeSheetOpen] = useState(false);

  const WHITE = getTokenValue('$white', 'color');
  const FAINT = getTokenValue('$textMuted', 'color');
  const PENCIL = getTokenValue('$icon', 'size');

  // Commit del campo editable / la rueda: lleva el valor a la grilla (clamp + 0,5) y lo guarda como único
  // valor canónico. parseCmInput ya snapea; snapToWheel acá es defensivo para la rueda (idempotente).
  const commitCm = useCallback((next: number) => {
    setCm(snapToWheel(next, CE_WHEEL));
  }, []);

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2">
      {/* ── CARD de la rueda: superficie con PESO que ocupa el alto útil (densidad R12.5, sin vacíos
            muertos) y delimita la zona de decisión (figura-fondo) — patrón CondicionCorporalStep. ── */}
      <YStack
        flex={1}
        marginVertical="$2"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$4"
        paddingVertical="$4"
        justifyContent="center"
        gap="$4"
      >
        {/* CAMPO EDITABLE = HERO PRIMARIO (fix-loop v2): caja estilo-input bordeada con "36,5 cm" + ícono de
            teclado (affordance de editable). Tap → teclado numérico del dispositivo. Sincronía bidireccional
            con la rueda vía `cm` (un único valor canónico). */}
        <CmInputField value={cm} onCommit={commitCm} />

        {/* RUEDA DE CE = SELECTOR (gradiente de tamaño: centro enfatizado vs vecinos). El campo de arriba
            refleja el centro; tipear en el campo mueve la rueda (sincronía bidireccional). */}
        <WheelPicker
          testID="ce-wheel"
          accessibilityLabel="Rueda de circunferencia escrotal en centímetros"
          spec={CE_WHEEL}
          value={cm}
          onValueChange={setCm}
          formatValue={formatCmAR}
        />

        {/* EDAD como control SECUNDARIO prellenado (no compite con la CE). Tap-to-ajustar → rueda de meses.
            Pill outline (no rellena, jerarquía: la CE es la primaria; la edad acompaña). */}
        <View alignItems="center" width="100%">
          <Pressable
            onPress={() => setAgeSheetOpen(true)}
            {...buttonA11y(Platform.OS, { label: 'Ajustar edad en meses' })}
          >
            <XStack
              testID="age-control"
              alignItems="center"
              gap="$2"
              backgroundColor="$bg"
              borderRadius="$pill"
              borderWidth={1}
              borderColor="$divider"
              paddingHorizontal="$4"
              paddingVertical="$2"
              minHeight="$touchMin"
            >
              <Text
                fontFamily="$body"
                fontSize="$5"
                lineHeight="$5"
                fontWeight="600"
                color="$textPrimary"
                numberOfLines={1}
              >
                {formatAgeLabel(age)}
              </Text>
              <Pencil size={PENCIL} color={FAINT} />
            </XStack>
          </Pressable>
        </View>
      </YStack>

      {/* CTA "✓ Confirmar" full-width (zona del pulgar). Siempre habilitado (hay una CE válida por default). */}
      <YStack paddingTop="$3" paddingBottom={bottomPad}>
        <View
          testID="confirm-step"
          backgroundColor="$primary"
          borderRadius="$pill"
          minHeight="$touchMin"
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          gap="$2"
          pressStyle={{ backgroundColor: '$primaryPress' }}
          onPress={() => onConfirm({ circumferenceCm: snapToWheel(cm, CE_WHEEL), ageMonths: age })}
          {...buttonA11y(Platform.OS, { label: 'Confirmar circunferencia escrotal' })}
        >
          <Check size={getTokenValue('$fabIcon', 'size')} color={WHITE} strokeWidth={3} />
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
            Confirmar
          </Text>
        </View>
      </YStack>

      {/* ── SHEET de ajuste de EDAD (rueda de meses, mismo idiom). Mock: arranca en la edad prellenada o el
            default (24). "Quitar edad" deja age_months NULL (R14.7: puede quedar desconocida). ── */}
      {ageSheetOpen ? (
        <AgeAdjustSheet
          initialMonths={age}
          onClose={() => setAgeSheetOpen(false)}
          onPickMonths={(months) => {
            setAge(months);
            setAgeSheetOpen(false);
          }}
          onClearAge={() => {
            setAge(null);
            setAgeSheetOpen(false);
          }}
          bottomPad={bottomPad}
        />
      ) : null}
    </YStack>
  );
}

/** Sanitiza el tipeo de cm es-AR mientras el operario escribe en el campo: dígitos + UN solo separador
 *  decimal (coma; un punto pegado se normaliza a coma). Sin signo (la CE es positiva). La validación dura
 *  (clamp/grilla/no-numérico) la hace parseCmInput en el commit; esto solo evita basura mientras se tipea. */
function sanitizeCmTyping(raw: string): string {
  let out = raw.replace(/[^0-9.,]/g, '').replace(/\./g, ',');
  const firstSep = out.indexOf(',');
  if (firstSep >= 0) out = out.slice(0, firstSep + 1) + out.slice(firstSep + 1).replace(/,/g, '');
  return out;
}

/**
 * CAMPO EDITABLE = HERO PRIMARIO de la CE (fix-loop v2, R14.5 sub-cláusula de teclado manual). Caja
 * estilo-input bordeada que muestra "36,5 cm" con un ícono de teclado (affordance de editable) y, al
 * tocarla, abre el TECLADO numérico del dispositivo (keyboardType="decimal-pad"; en web es el input nativo)
 * para tipear los cm a mano (es-AR, coma decimal).
 *
 * SINCRONÍA BIDIRECCIONAL con la rueda (un único valor canónico `value`):
 *  - rueda → campo: cuando NO está enfocado, el campo muestra `formatCmAR(value)` (sigue a la rueda).
 *  - campo → rueda: mientras se tipea se guarda un `draft` (sin reformatear); al hacer blur/done se
 *    valida con `parseCmInput` (clamp [20,50] + grilla 0,5) y se commitea (`onCommit`) → la rueda se
 *    mueve/snapea a ese valor. Si el tipeo no es numérico, se revierte al último valor válido (no se mueve
 *    la rueda).
 */
function CmInputField({ value, onCommit }: { value: number; onCommit: (cm: number) => void }) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  // Texto visible: mientras se edita, el draft tipeado; en reposo, el valor canónico formateado es-AR.
  const display = focused ? draft : formatCmAR(value);

  const commit = useCallback(() => {
    const parsed = parseCmInput(draft, CE_WHEEL);
    if (parsed != null) onCommit(parsed); // válido → snapea/clampa y mueve la rueda.
    // null (no-numérico/vacío) → no commiteamos: el display vuelve a `value` (último válido).
    setFocused(false);
  }, [draft, onCommit]);

  return (
    <View testID="ce-display" alignItems="center" width="100%">
      <Pressable
        onPress={() => inputRef.current?.focus()}
        {...buttonA11y(Platform.OS, { label: 'Editar circunferencia escrotal con el teclado' })}
      >
        {/* Caja estilo-input CENTRADA y dimensionada al contenido (alignSelf center + sin width 100% → no
            bleed fuera de la card). De izq a der: número grande (TextInput, hero), "cm", ícono de teclado. */}
        <XStack
          testID="ce-input-box"
          alignSelf="center"
          alignItems="center"
          gap="$3"
          backgroundColor="$white"
          borderRadius="$card"
          borderWidth={2}
          borderColor={focused ? '$primary' : '$divider'}
          paddingHorizontal="$4"
          minHeight="$touchMin"
        >
          {/* El número grande es el HERO: tamaño FIJO $wheelHero=44, NO adjustsFontSizeToFit (NO-OP web).
              TextInput para abrir el teclado nativo al tocar (decimal-pad, es-AR). Ancho fijo (no flex) para
              que la caja quede contenida y no se estire a 100 % en react-native-web. */}
          <TextInput
            ref={inputRef}
            value={display}
            onFocus={() => {
              setDraft(formatCmAR(value)); // seed con el valor actual al entrar a editar.
              setFocused(true);
            }}
            onBlur={commit}
            onChangeText={(t) => setDraft(sanitizeCmTyping(t))}
            onSubmitEditing={commit}
            keyboardType="decimal-pad"
            returnKeyType="done"
            selectTextOnFocus
            testID="ce-input"
            style={{
              width: getTokenValue('$stepperBtn', 'size'), // 88 — entra "36,5"/"40,5" sin estirar la caja
              textAlign: 'center',
              fontSize: getTokenValue('$wheelHero', 'size'),
              lineHeight: getTokenValue('$wheelHero', 'size'),
              fontFamily: 'Inter',
              fontWeight: '700',
              color: getTokenValue('$textPrimary', 'color'),
              paddingVertical: getTokenValue('$2', 'space'),
              // POLISH (web): el <input> nativo de react-native-web pinta su PROPIO outline de foco del
              // navegador (suele ser NARANJA/azul del UA) — choca con el DS. Lo SUPRIMIMOS: el tratamiento de
              // foco verde es el borde de la CAJA (borderColor $divider→$primary, arriba), no el outline del UA.
              // outlineStyle no está en el RNStyle type → cast web-only (en native es no-op).
              ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as object) : null),
            }}
            {...labelA11y(Platform.OS, 'Circunferencia escrotal en centímetros')}
          />
          <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="600" color="$textMuted" numberOfLines={1}>
            cm
          </Text>
          {/* Ícono de teclado = pista clara de que el campo es editable a mano. */}
          <KeyboardIcon size={getTokenValue('$icon', 'size')} color={getTokenValue('$textMuted', 'color')} />
        </XStack>
      </Pressable>
    </View>
  );
}

/** Bottom-sheet con la RUEDA DE MESES para ajustar/fijar la edad. Idiom de sheet del repo + guard tap-through. */
function AgeAdjustSheet({
  initialMonths,
  onClose,
  onPickMonths,
  onClearAge,
  bottomPad,
}: {
  initialMonths: number | null;
  onClose: () => void;
  onPickMonths: (months: number) => void;
  onClearAge: () => void;
  bottomPad: number;
}) {
  // La rueda arranca en la edad prellenada/ajustada o en el default (24) si era desconocida.
  const [months, setMonths] = useState<number>(() => indexToValue(initialAgeIndex(initialMonths), AGE_WHEEL));

  // GUARD anti tap-through (web táctil): el scrim no descarta hasta el próximo frame (idiom del repo).
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    const t = setTimeout(() => {
      readyToDismissRef.current = true;
    }, 0);
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        readyToDismissRef.current = true;
      });
    });
    return () => {
      clearTimeout(t);
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!readyToDismissRef.current) return;
    onClose();
  }, [onClose]);

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo (idiom LOCKEADO de SavePresetSheet).
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      zIndex={10}
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      {/* Backdrop tappable (descarta con guard anti tap-through). */}
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={dismiss}
        testID="age-sheet-scrim"
        {...buttonA11y(Platform.OS, { label: 'Cerrar ajuste de edad' })}
      />

      <YStack
        backgroundColor="$surface"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
      >
        {/* Grip + título. El título "Edad del toro" no trae descendentes, pero lineHeight matcheado por regla. */}
        <View alignSelf="center" width="$icon" height="$dot" borderRadius="$pill" backgroundColor="$divider" />
        <YStack gap="$1" alignItems="center">
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
            Edad del toro
          </Text>
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" color="$textMuted" numberOfLines={1}>
            {formatMonthsAR(months)} al medir
          </Text>
        </YStack>

        {/* RUEDA DE MESES (mismo idiom). Las celdas muestran SOLO el número (la unidad "meses" va en el
            encabezado live de arriba — si fuera "24 meses" por celda el texto se truncaría con "…"). El
            valor centrado = la edad elegida. */}
        <View alignItems="center" width="100%">
          <WheelPicker
            testID="age-wheel"
            accessibilityLabel="Rueda de edad en meses"
            spec={AGE_WHEEL}
            value={months}
            onValueChange={setMonths}
            formatValue={formatMonthsNum}
          />
        </View>

        {/* Acciones: usar la edad elegida (primaria) + quitar edad (R14.7: puede quedar desconocida). */}
        <YStack gap="$2">
          <View
            testID="age-confirm"
            backgroundColor="$primary"
            borderRadius="$pill"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ backgroundColor: '$primaryPress' }}
            onPress={() => onPickMonths(snapToWheel(months, AGE_WHEEL))}
            {...buttonA11y(Platform.OS, { label: 'Usar esta edad' })}
          >
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
              Usar esta edad
            </Text>
          </View>
          <View
            testID="age-clear"
            backgroundColor="$bg"
            borderRadius="$pill"
            borderWidth={1}
            borderColor="$divider"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ backgroundColor: '$surface' }}
            onPress={onClearAge}
            {...buttonA11y(Platform.OS, { label: 'No registrar edad' })}
          >
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
              No sé la edad
            </Text>
          </View>
        </YStack>
      </YStack>
    </View>
  );
}
