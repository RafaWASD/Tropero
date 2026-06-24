// KpiCard — card de un KPI con el patrón "número GRANDE + label + el absoluto chico" (spec 07 Stream C,
// design §6). El número grande del KPI MANDA (jerarquía clara); debajo, el numerador/denominador absolutos
// (denominador explícito, ej. "preñadas 41 / servidas 46", R7.5.5/R7.6.5). Una métrica por card, respiro.
//
// Inspirado en cómo Mercado Pago muestra montos: el número domina, el contexto va chico abajo. Acá el "%"
// va pegado al número (lo arma `formatPercentAR`), y la lectura absoluta + el label viven debajo.
//
// Cero hardcode (ADR-023 §4): tokens. Sin lógica de negocio (el % y el formato vienen ya resueltos del
// caller con `reports-format.ts`). Sin recorte de descendentes: `lineHeight` matcheado en el número hero.

import { Text, View, XStack, YStack } from 'tamagui';

import { kpiValueFontToken } from '../../utils/reports-format';

export type KpiCardProps = {
  /** Título del KPI ("Preñez", "Parición"). */
  label: string;
  /** El número grande ya formateado ("84,6 %", "—"). El "%"/unidad lo arma el caller. */
  value: string;
  /** El denominador explícito ya formateado ("41 preñadas de 46 servidas"). Opcional. */
  detail?: string;
  /** Una nota secundaria opcional bajo el detalle (ej. "12 vacías"). */
  footnote?: string;
  /** true → el valor es "sin datos" ("—"): se atenúa para no competir con los KPIs con dato. */
  muted?: boolean;
};

/**
 * Card de un KPI. El valor hero usa un tamaño LENGTH-AWARE (`kpiValueFontToken`): `$10` (38px) para valores
 * cortos, `$9` (30px) para 6-7 chars — web-safe, porque `adjustsFontSizeToFit` es NO-OP en react-native-web
 * (gotcha del repo) y truncaría "82,6 %" en una media card a 360px. El `lineHeight` matchea el token (regla
 * de recorte de descendentes del DS). Cuando `muted` (sin datos), el valor va en `$textMuted` para que un
 * "—" no se lea como un KPI fuerte.
 */
export function KpiCard({ label, value, detail, footnote, muted = false }: KpiCardProps) {
  const size = kpiValueFontToken(value);
  return (
    <YStack
      flex={1}
      minWidth={0}
      backgroundColor="$surface"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$divider"
      paddingHorizontal="$4"
      paddingVertical="$4"
      gap="$2"
    >
      <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted" numberOfLines={1}>
        {label}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={size.fontSize}
        lineHeight={size.lineHeight}
        fontWeight="800"
        color={muted ? '$textMuted' : '$textPrimary'}
        numberOfLines={1}
      >
        {value}
      </Text>
      {detail ? (
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textPrimary">
          {detail}
        </Text>
      ) : null}
      {footnote ? (
        <Text fontFamily="$body" fontSize="$2" color="$textMuted">
          {footnote}
        </Text>
      ) : null}
    </YStack>
  );
}

/** Fila de dos KPIs lado a lado (preñez | parición), con un gap consistente. */
export function KpiRow({ children }: { children: React.ReactNode }) {
  return (
    <XStack gap="$3" alignItems="stretch">
      {children}
    </XStack>
  );
}

/**
 * Encabezado de sección dentro de la pantalla de reportes (ej. "Reproductivo", "Peso", "Alertas"). Un
 * separador de jerarquía liviano. `hint` opcional (ej. la campaña / base del KPI).
 */
export function ReportSectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <XStack alignItems="baseline" justifyContent="space-between" gap="$2" marginTop="$2">
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
        {title}
      </Text>
      {hint ? (
        <Text fontFamily="$body" fontSize="$2" fontWeight="500" color="$textMuted" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </XStack>
  );
}

/** Divisor fino entre sub-bloques de una card. */
export function ReportDivider() {
  return <View height={1} backgroundColor="$divider" />;
}
