// CclBars — distribución CCL (cabeza/cuerpo/cola) como barras horizontales (spec 07 Stream C, R7.7/R7.8).
// El nº de barras lo decide `cclBarsForMonths` (que usa `sizeBucketsForServiceMonths` — FUENTE ÚNICA de la
// regla por meses, design §2.4/§8). Muestra, por bucket: label + conteo + % + una barra proporcional. El
// total base (R7.7.5) se muestra arriba. Si el rodeo no distingue etapas (1/12/sin config) → la pantalla
// no monta este componente y muestra la nota (R7.7.3). Empty (total=0) → la pantalla muestra ReportEmpty.
//
// Opcionalmente recibe una SEGUNDA distribución (nacimientos por etapa, R7.8) para el "cruce de oro": las
// barras del tacto (diagnosticado) junto a las de nacimientos (real) → el usuario compara dónde se pierde.
//
// Cero hardcode (ADR-023 §4): tokens. El ancho de la barra es un % (width admite raw, no es spacing-token).

import { Text, View, XStack, YStack } from 'tamagui';

import type { CclBar } from '../../utils/reports-format';

/** Una fila de barra: label a la izquierda, barra proporcional, conteo + % a la derecha. */
function BarRow({ bar, filled }: { bar: CclBar; filled: boolean }) {
  // El ancho proporcional al % (0..100). Mínimo visible de 2% para que un bucket con ≥1 no desaparezca.
  const widthPct = bar.count > 0 ? Math.max(2, bar.percent) : 0;
  return (
    <YStack gap="$1">
      <XStack alignItems="baseline" justifyContent="space-between" gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textPrimary">
          {bar.label}
        </Text>
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          {bar.count} · {formatBarPct(bar.percent)}
        </Text>
      </XStack>
      {/* Pista de la barra (fondo) + relleno proporcional. */}
      <View width="100%" height={10} borderRadius="$pill" backgroundColor="$bg" overflow="hidden">
        <View
          height={10}
          borderRadius="$pill"
          backgroundColor={filled ? '$primary' : '$greenLight'}
          width={`${widthPct}%`}
        />
      </View>
    </YStack>
  );
}

/** % de una barra en es-AR sin decimal superfluo. (No usa formatPercentAR para no meter el espacio + %.) */
function formatBarPct(percent: number): string {
  const s = percent.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  return `${s}%`;
}

export type CclBarsProps = {
  /** Barras del tacto diagnosticado (de `cclBarsForMonths`). */
  bars: CclBar[];
  /** Total de preñeces sobre el que se calcula la distribución (R7.7.5). */
  total: number;
  /** Barras de la distribución REAL de nacimientos (cruce de oro, R7.8). Opcional. */
  bornBars?: CclBar[];
  /** Total de nacimientos del cruce. Si `bornBars` viene vacío/0 → se muestra la nota de degradado (R7.8.3). */
  bornTotal?: number;
};

/**
 * Renderiza la distribución CCL del tacto + (opcional) el cruce con nacimientos. El bloque del tacto va
 * con barras llenas ($primary); el de nacimientos con barras claras ($greenLight) para distinguirlos de un
 * vistazo. Si hay `bornBars` pero `bornTotal=0` → muestra "todavía no hay pariciones de esta campaña"
 * (R7.8.3) sin romper el bloque del tacto.
 */
export function CclBars({ bars, total, bornBars, bornTotal }: CclBarsProps) {
  const hasCross = bornBars !== undefined;
  return (
    <YStack gap="$4">
      <YStack gap="$3">
        {hasCross ? (
          <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$textMuted">
            Al tacto · {total} preñadas
          </Text>
        ) : (
          <Text fontFamily="$body" fontSize="$2" fontWeight="500" color="$textMuted">
            {total} preñadas
          </Text>
        )}
        {bars.map((b) => (
          <BarRow key={b.stage} bar={b} filled />
        ))}
      </YStack>

      {hasCross ? (
        <YStack gap="$3">
          <View height={1} backgroundColor="$divider" />
          {bornTotal && bornTotal > 0 && bornBars && bornBars.length > 0 ? (
            <>
              <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$textMuted">
                Nacimientos · {bornTotal}
              </Text>
              {bornBars.map((b) => (
                <BarRow key={b.stage} bar={b} filled={false} />
              ))}
            </>
          ) : (
            <Text fontFamily="$body" fontSize="$3" color="$textMuted">
              Todavía no hay pariciones de esta campaña para comparar.
            </Text>
          )}
        </YStack>
      ) : null}
    </YStack>
  );
}
