// app/_components/ServiceMonthsSelector.tsx — SELECTOR DE MESES de servicio del rodeo (spec 03
// Stream B / B1 — DD-PSC-5). Componente REUTILIZABLE consumido por DOS superficies:
//   - el wizard de ALTA de rodeo (crear-rodeo.tsx, mode='alta')   → arranca con PRIMAVERA pre-tildada
//     (RPSC.2.2) salvo que el caller pase otro `value`.
//   - la EDICIÓN de un rodeo existente (editar-plantilla.tsx, mode='edicion') → arranca con lo
//     persistido o, si es `null`, con el estado explícito "SIN CONFIGURAR" (RPSC.3.2) — no se inventa
//     una campaña que el productor no declaró (espejo de DD-PS-3).
//
// 🔑 CONTIGÜIDAD POR CONSTRUCCIÓN (Raf 2026-06-23, RPSC.2.3/RPSC.2.8): la selección manual de la grilla
// es un PERÍODO "inicio → fin", NO un toggle disjunto. Una máquina de 2 taps (1º tap = inicio del período;
// 2º tap = fin → se rellena el run HACIA ADELANTE en orden de calendario, WRAP-AWARE: si el fin cae antes
// del inicio, envuelve por fin de año, ej. Nov → Ene; un 3er tap REINICIA con un inicio nuevo; tap único =
// período de 1 mes). Es IMPOSIBLE armar un set disjunto desde la grilla. Los atajos
// (Primavera/Otoño/Todo/Ninguno) también son contiguos. La lógica vive en `@/utils/service-months` (pura,
// testeada); el `anchor` (inicio pendiente) es estado de INTERACCIÓN local (no del valor persistido).
//
// ⚠️ DESIGN-SPIKE (B1): este componente es VISUAL + estado controlado. El CABLEADO a
// `create_rodeo(p_service_months)` / `set_rodeo_service_months` / outbox lo hace el caller POST-VETO —
// acá sólo exponemos `value`/`onChange` (el padre persiste el array `months`).
//
// Dirección de diseño del leader (design §3.1, re-iteración contigua):
//   - GRID 3×4 de meses (Ene…Dic) como chips, targets ≥ $touchMin (manga-friendly). TRES estados
//     visuales inconfundibles a pleno sol: EN EL RUN = $primary lleno + texto blanco; INICIO PENDIENTE
//     (esperando el fin) = borde $primary grueso + fondo $greenLight tenue + texto $primary; FUERA =
//     outline $divider + texto $textPrimary.
//   - LABEL EN VIVO del período resultante + conteo ("Servicio: Oct → Dic · 3 meses") SIEMPRE visible
//     (Nielsen #1). Mientras se espera el 2º tap, el label se vuelve una GUÍA ("Tocá el mes de fin · empezó
//     en Oct") → resuelve la ambigüedad de "inicio→fin hacia adelante".
//   - ATAJOS de un toque arriba (Primavera/Otoño/Todo el año/Ninguno) → reducen fricción. El atajo activo
//     se resalta.
//   - TÍTULO con lineHeight matching ('¿','q','j','g' → recorte de descendentes vetado).
//
// Cero hardcode (ADR-023 §4): tokens. a11y split web/native (a11y.ts). Light-only (MVP). Voseo.

import { useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { Text, View, XStack, YStack } from 'tamagui';

import { buttonA11y, labelA11y } from '@/utils/a11y';
import {
  ALL_MONTHS,
  SERVICE_MONTHS_SHORTCUTS,
  activeShortcutId,
  applyShortcutSelection,
  describeServicePeriod,
  isMonthChecked,
  isPendingAnchor,
  monthFullLabel,
  monthShortLabel,
  nextRangeSelection,
  type RangeSelection,
  type ServiceMonthsShortcut,
} from '@/utils/service-months';

export type ServiceMonthsSelectorMode = 'alta' | 'edicion';

export type ServiceMonthsSelectorProps = {
  /** Meses del run actual. `null` = "sin configurar" (sólo significativo en edición; en alta el caller
   *  pasa el default de primavera). El componente NO decide el default — lo provee el padre. */
  value: number[] | null;
  /** Notifica el nuevo conjunto de meses (ordenado/único, SIEMPRE contiguo por construcción). El padre lo
   *  guarda en su estado y, post-veto, lo manda como `p_service_months`. */
  onChange: (months: number[]) => void;
  /** 'alta' = wizard de alta; 'edicion' = rodeo existente. Cambia copy y el banner "sin configurar". */
  mode: ServiceMonthsSelectorMode;
};

const TITLE = '¿En qué meses hace servicio este rodeo?';
const COPY =
  'Define la campaña reproductiva del rodeo (un solo período). Alimenta los reportes de preñez y parición.';
const HELP_RANGE = 'Tocá el mes de inicio y después el de fin del período.';
const UNCONFIGURED_COPY =
  'Todavía sin configurar. Elegí los meses en que este rodeo entra en servicio para activar los reportes reproductivos.';

// ─── Un chip de mes (estado: en-el-run / inicio-pendiente / fuera) ─────────────────────────────────────

type ChipState = 'in' | 'anchor' | 'out';

function MonthChip({
  month,
  state,
  onPress,
}: {
  month: number;
  state: ChipState;
  onPress: () => void;
}) {
  const label = monthShortLabel(month);
  // a11y: "en el run" se reporta como seleccionado; el inicio pendiente lleva el matiz en el label.
  const a11yLabel =
    state === 'anchor' ? `${monthFullLabel(month)}, inicio del período` : monthFullLabel(month);
  const a11y = buttonA11y(Platform.OS, { label: a11yLabel, selected: state === 'in' });

  const borderColor = state === 'out' ? '$divider' : '$primary';
  const backgroundColor = state === 'in' ? '$primary' : state === 'anchor' ? '$greenLight' : '$white';
  const borderWidth = state === 'anchor' ? 3 : 2;
  const textColor = state === 'in' ? '$white' : state === 'anchor' ? '$primary' : '$textPrimary';

  return (
    <Pressable
      testID={`month-chip-${month}`}
      onPress={onPress}
      style={{ flexBasis: '31%', flexGrow: 1 }}
      {...a11y}
    >
      <View
        width="100%"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={borderWidth}
        borderColor={borderColor}
        backgroundColor={backgroundColor}
        alignItems="center"
        justifyContent="center"
        pressStyle={{ opacity: 0.7 }}
      >
        <Text
          fontFamily="$body"
          fontSize="$6"
          lineHeight="$6"
          fontWeight="600"
          color={textColor}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Un chip de atajo (preset de un toque) ────────────────────────────────────────────────────────

function ShortcutChip({
  shortcut,
  active,
  onPress,
}: {
  shortcut: ServiceMonthsShortcut;
  active: boolean;
  onPress: () => void;
}) {
  const a11y = buttonA11y(Platform.OS, { label: `Atajo ${shortcut.label}`, selected: active });
  return (
    <Pressable testID={`shortcut-${shortcut.id}`} onPress={onPress} {...a11y}>
      <View
        minHeight="$chipMin"
        borderRadius="$pill"
        borderWidth={1}
        borderColor={active ? '$primary' : '$divider'}
        backgroundColor={active ? '$surface' : '$white'}
        paddingHorizontal="$3"
        alignItems="center"
        justifyContent="center"
        pressStyle={{ opacity: 0.7 }}
      >
        <Text
          fontFamily="$body"
          fontSize="$4"
          lineHeight="$4"
          fontWeight="600"
          color={active ? '$primary' : '$textMuted'}
          numberOfLines={1}
        >
          {shortcut.label}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Tarjeta de RESUMEN del período (Nielsen #1 — visibilidad de lo que se armó) ──────────────────────

function PeriodSummary({
  value,
  anchor,
}: {
  value: number[] | null;
  anchor: number | null;
}) {
  // Mientras se espera el 2º tap, el resumen GUÍA en vez de mostrar un período "cerrado".
  const waitingForEnd = anchor !== null;
  const period = describeServicePeriod(value);

  const headline = waitingForEnd ? 'Tocá el mes de fin del período' : 'Servicio';
  const detail = waitingForEnd
    ? `Empezó en ${monthShortLabel(anchor!)}`
    : period.count > 0 && period.text !== 'Todo el año'
      ? `${period.text} · ${period.count} ${period.count === 1 ? 'mes' : 'meses'}`
      : period.text;

  const a11y = labelA11y(Platform.OS, `${headline}: ${detail}`);

  return (
    <View
      testID="service-months-summary"
      width="100%"
      backgroundColor={waitingForEnd ? '$greenLight' : '$surface'}
      borderRadius="$card"
      borderWidth={1}
      borderColor={waitingForEnd ? '$primary' : '$divider'}
      paddingHorizontal="$4"
      paddingVertical="$3"
      gap="$1"
      {...a11y}
    >
      <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="600" color="$textMuted">
        {headline}
      </Text>
      <Text
        testID="service-months-summary-detail"
        fontFamily="$body"
        fontSize="$7"
        lineHeight="$7"
        fontWeight="700"
        color="$textPrimary"
      >
        {detail}
      </Text>
    </View>
  );
}

// ─── Selector completo ───────────────────────────────────────────────────────────────────────────

export function ServiceMonthsSelector({ value, onChange, mode }: ServiceMonthsSelectorProps) {
  // `anchor` = inicio PENDIENTE de la interacción de rango (esperando el 2º tap). Estado de INTERACCIÓN
  // local, NO del valor persistido (el padre sólo conoce `months` vía value/onChange).
  const [anchor, setAnchor] = useState<number | null>(null);

  const activeId = activeShortcutId(value);
  const isUnconfigured = mode === 'edicion' && value === null;

  function chipState(month: number): ChipState {
    if (isPendingAnchor({ months: value ?? [], anchor }, month)) return 'anchor';
    if (isMonthChecked(value, month)) return 'in';
    return 'out';
  }

  function onTapMonth(month: number) {
    const current: RangeSelection = { months: value ?? [], anchor };
    const next = nextRangeSelection(current, month);
    setAnchor(next.anchor);
    onChange(next.months);
  }

  function onPickShortcut(shortcut: ServiceMonthsShortcut) {
    const next = applyShortcutSelection(shortcut);
    setAnchor(next.anchor); // limpia un período en progreso
    onChange(next.months);
  }

  return (
    <YStack width="100%" gap="$3">
      {/* ── Título (lineHeight matching: '¿','q','j','g' → sin recorte de descendentes) ── */}
      <YStack gap="$1">
        <Text
          fontFamily="$body"
          fontSize="$6"
          lineHeight="$6"
          fontWeight="600"
          color="$textPrimary"
        >
          {TITLE}
        </Text>
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
          {COPY}
        </Text>
      </YStack>

      {/* ── Banner "sin configurar" (sólo edición + value === null, RPSC.3.2) ── */}
      {isUnconfigured ? (
        <View
          testID="service-months-unconfigured"
          width="100%"
          backgroundColor="$surface"
          borderRadius="$card"
          borderWidth={1}
          borderColor="$divider"
          paddingHorizontal="$4"
          paddingVertical="$3"
        >
          <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="500" color="$textMuted">
            {UNCONFIGURED_COPY}
          </Text>
        </View>
      ) : null}

      {/* ── Resumen EN VIVO del período resultante (o guía mientras se espera el fin) ── */}
      <PeriodSummary value={value} anchor={anchor} />

      {/* ── Atajos de un toque (fila arriba del grid fino) ── */}
      <XStack width="100%" flexWrap="wrap" gap="$2">
        {SERVICE_MONTHS_SHORTCUTS.map((s) => (
          <ShortcutChip
            key={s.id}
            shortcut={s}
            active={activeId === s.id}
            onPress={() => onPickShortcut(s)}
          />
        ))}
      </XStack>

      {/* ── Pista de la interacción de rango (descubribilidad de los 2 taps) ── */}
      <Text fontFamily="$body" fontSize="$2" lineHeight="$3" fontWeight="500" color="$textFaint">
        {HELP_RANGE}
      </Text>

      {/* ── Grid 3×4 de meses (Ene…Dic) — selección de período inicio→fin ── */}
      <XStack testID="service-months-grid" width="100%" flexWrap="wrap" gap="$2">
        {ALL_MONTHS.map((m) => (
          <MonthChip key={m} month={m} state={chipState(m)} onPress={() => onTapMonth(m)} />
        ))}
      </XStack>
    </YStack>
  );
}
