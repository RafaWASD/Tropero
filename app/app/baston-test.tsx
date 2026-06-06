// app/baston-test.tsx — HARNESS DE DEV/TEST WEB para el bastón RFID (feature 04, R5).
//
// Pantalla NO de producción: existe para que Raf valide el adapter-web-serial.ts (ya
// committeado, 23ff54e) contra el RS420 real pareado a su notebook Windows, corriendo
// `pnpm web` → http://localhost:8081/baston-test. La pantalla de conexión de PRODUCCIÓN
// (spec 04 R9) es otra cosa y espera el design system (Fase 6, tentativa); ESTO es un
// harness funcional, no un deliverable de UI.
//
// Es SELF-CONTAINED a propósito (no toca _layout.tsx ni los providers globales): monta su
// propio BleStickListenerProvider en modo 'auto' (en web selecciona web-serial) para quedar
// aislada de la otra terminal (feature 2). La CONEXIÓN viva la maneja una instancia propia de
// WebSerialAdapter(baud) + un EidIngestEngine local, así el harness ejercita EXACTAMENTE el
// código committeado que Raf quiere de-riskear: adapter-web-serial (requestPort/open/read loop/
// framing/backoff) → contract.ingestRawLine (parser-rs420 + isValidTag) → dedup por-TAG ~3s →
// commit → tag_read. El baud (default 9600, el del RS420) es configurable porque el adapter se
// construye acá con el baud elegido.
//
// Qué NO hace (fuera de alcance del harness): persistencia del puerto recordado en UI, beep/
// vibración (web no aplica, R4.5 — la confirmación es VISUAL), find-or-create de spec 09. La
// confirmación visual de R4.4/R2.1 sí está: cada EID confirmado aparece en la lista en vivo.
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens Tamagui.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Bluetooth, BluetoothConnected, BluetoothSearching, RadioTower, Trash2, TriangleAlert } from 'lucide-react-native';

import { Button, Card } from '@/components';
import { BleStickListenerProvider } from '@/services/ble/BleStickListenerProvider';
import { WebSerialAdapter } from '@/services/ble/adapter-web-serial';
import { EidIngestEngine } from '@/services/ble/contract';
import { isWebSerialSupported } from '@/services/ble/line-framer';
import { DEFAULT_BAUD } from '@/services/ble/config';
import type { ConnectionStatus } from '@/services/ble/stick-adapter';

// ─── Modelo de una lectura confirmada en la lista en vivo ───────────────────────
interface TagRead {
  /** EID de 15 dígitos confirmado (validado + des-duplicado por el contrato). */
  eid: string;
  /** Timestamp del TELÉFONO al confirmar (R1.5), para mostrar la hora local. */
  timestamp: number;
  /** Id incremental estable (la key de la lista; dos lecturas del mismo EID son filas distintas). */
  seq: number;
}

// ─── Mapa de presentación de cada estado de conexión (R9.2) ─────────────────────
// Sin lógica de negocio: solo el copy + el ícono + el token de color del indicador.
type StatusView = {
  label: string;
  hint: string;
  Icon: typeof Bluetooth;
  /** Token de color (string para getTokenValue del ícono + prop de color del texto). */
  colorToken: '$textMuted' | '$primary' | '$terracota';
};

function statusView(status: ConnectionStatus): StatusView {
  switch (status) {
    case 'connected':
      return {
        label: 'Conectado',
        hint: 'Bastoneá un EID; aparece abajo en menos de 1 segundo.',
        Icon: BluetoothConnected,
        colorToken: '$primary',
      };
    case 'connecting':
      return {
        label: 'Conectando…',
        hint: 'Elegí el puerto COM del RS420 en el diálogo del navegador.',
        Icon: BluetoothSearching,
        colorToken: '$primary',
      };
    case 'scanning':
      return {
        label: 'Reintentando…',
        hint: 'Se perdió el puerto; reintentando con backoff. La carga manual sigue disponible.',
        Icon: BluetoothSearching,
        colorToken: '$terracota',
      };
    case 'disconnected':
      return {
        label: 'Desconectado',
        hint: 'El bastón está apagado, fuera de rango o se canceló el diálogo. Volvé a conectar.',
        Icon: Bluetooth,
        colorToken: '$terracota',
      };
    case 'permission_denied':
      return {
        label: 'Sin permiso / sin soporte',
        hint: 'El navegador no expone Web Serial o se denegó el puerto.',
        Icon: TriangleAlert,
        colorToken: '$terracota',
      };
    case 'off':
    default:
      return {
        label: 'Apagado',
        hint: 'Tocá "Conectar bastón" para elegir el puerto COM del RS420.',
        Icon: Bluetooth,
        colorToken: '$textMuted',
      };
  }
}

/** Formatea un timestamp del teléfono como hora local es-AR con milisegundos (para ver la latencia). */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

// ─── Banner para navegadores sin Web Serial (Safari/Firefox) — R5.6 ─────────────
function UnsupportedBanner() {
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <Card backgroundColor="$surface" borderWidth={1} borderColor="$terracota">
      <XStack gap="$3" alignItems="flex-start">
        <TriangleAlert size={24} color={terracota} strokeWidth={2} />
        <YStack flex={1} gap="$1">
          <Text fontFamily="$body" fontSize="$5" fontWeight="700" color="$textPrimary">
            Este navegador no soporta Web Serial
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
            La Web Serial API solo existe en Chromium (Chrome / Edge) sobre un contexto seguro.
            localhost:8081 de pnpm web califica. Abrí esta pantalla en Chrome o Edge en Windows —
            Safari y Firefox no la exponen.
          </Text>
        </YStack>
      </XStack>
    </Card>
  );
}

// ─── Pantalla interna (consume hooks; vive dentro del Provider) ─────────────────
function BastonTestInner() {
  const insets = useSafeAreaInsets();
  const muted = getTokenValue('$textMuted', 'color');

  // Soporte de Web Serial: solo web + Chromium + contexto seguro (R5.6). En native (iOS/Android)
  // este harness no aplica (Web Serial no existe en RN) → mostramos el mismo banner de degradado.
  const supported = useMemo(() => Platform.OS === 'web' && isWebSerialSupported(), []);

  // Baud configurable (default 9600, el del RS420). Texto editable para no acoplar a un Stepper.
  const [baudText, setBaudText] = useState(String(DEFAULT_BAUD));
  const baud = useMemo(() => {
    const n = Number.parseInt(baudText, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_BAUD;
  }, [baudText]);

  const [status, setStatus] = useState<ConnectionStatus>('off');
  const [reads, setReads] = useState<TagRead[]>([]);

  // El adapter web-serial y el motor de ingesta viven en refs (sobreviven renders sin recrearse).
  // El motor mantiene su ventana de dedup por-TAG (~3s, R3): re-escaneo del mismo EID se ignora.
  const adapterRef = useRef<WebSerialAdapter | null>(null);
  const engineRef = useRef<EidIngestEngine>(new EidIngestEngine());
  const seqRef = useRef(0);

  // Construye (o reconstruye) el adapter cuando cambia el baud, suscribiendo lecturas + status.
  // Cada línea CRUDA del lector pasa por el contrato committeado: processRawLine = parseRs420Line
  // (descarta framing + timestamp del lector) → isValidTag → dedup por-TAG. Un malformado o un
  // re-escaneo dentro de la ventana NO produce fila (se descarta en silencio, R1.4/R3.1).
  useEffect(() => {
    if (!supported) return;

    const adapter = new WebSerialAdapter(baud);
    adapterRef.current = adapter;

    const offStatus = adapter.onStatus((s) => setStatus(s));
    const offTag = adapter.onTagRead((rawLine) => {
      const now = Date.now();
      const candidate = engineRef.current.processRawLine(rawLine, now);
      if (candidate === null) return; // re-escaneo dentro de la ventana de dedup (R3.1)
      if ('rejected' in candidate) return; // malformado: se descarta sin romper el flujo (R1.4)
      // Candidato válido + des-duplicado → confirmación visual (R2.1/R4.4): fila en la lista.
      // commit() materializa el tag_read del contrato (R1.6) con el timestamp del teléfono (R1.5).
      // `now` ES ese timestamp (el mismo que commit usa, R1.5); lo guardamos directo para la fila.
      engineRef.current.commit(candidate.eid, now);
      seqRef.current += 1;
      setReads((prev) => [
        { eid: candidate.eid, timestamp: now, seq: seqRef.current },
        ...prev,
      ]);
    });

    return () => {
      offStatus();
      offTag();
      // Desconecta el transporte físico al desmontar / antes de reconstruir con otro baud.
      void adapter.disconnect().catch(() => undefined);
      if (adapterRef.current === adapter) adapterRef.current = null;
    };
  }, [supported, baud]);

  // Conectar: requestPort() necesita un GESTO DE USUARIO (este onPress lo es) — sin gesto, el
  // navegador rechaza el diálogo (R5.2). Sin deviceId → pide el puerto; el adapter degrada con
  // estado claro si cancelás el diálogo (R5.5) sin bloquear nada.
  const onConnect = useCallback(() => {
    void adapterRef.current?.connect().catch(() => undefined);
  }, []);

  const onDisconnect = useCallback(() => {
    void adapterRef.current?.disconnect().catch(() => undefined);
  }, []);

  const onClear = useCallback(() => setReads([]), []);

  const view = statusView(status);
  const iconColor = getTokenValue(view.colorToken, 'color');
  const isConnected = status === 'connected';
  const isBusy = status === 'connecting' || status === 'scanning';

  return (
    <YStack flex={1} backgroundColor="$bg">
      {/* Header */}
      <YStack paddingTop={insets.top} paddingHorizontal="$4" paddingBottom="$2">
        <XStack alignItems="center" gap="$2" paddingVertical="$3">
          <RadioTower size={26} color={getTokenValue('$primary', 'color')} strokeWidth={2.25} />
          <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
            Test bastón (Web Serial)
          </Text>
        </XStack>
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
          Harness de dev para el RS420 real pareado a Windows. No es la pantalla de producción.
        </Text>
      </YStack>

      <ScrollView
        flex={1}
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: getTokenValue('$8', 'space'),
          gap: getTokenValue('$4', 'space'),
        }}
        showsVerticalScrollIndicator={false}
      >
        {!supported ? (
          <UnsupportedBanner />
        ) : (
          <>
            {/* Estado de conexión + CTA (R9.2) */}
            <Card>
              <YStack gap="$3">
                <XStack alignItems="center" gap="$3">
                  <view.Icon size={28} color={iconColor} strokeWidth={2.25} />
                  <YStack flex={1} gap="$1">
                    <Text fontFamily="$body" fontSize="$5" fontWeight="700" color={view.colorToken}>
                      {view.label}
                    </Text>
                    <Text fontFamily="$body" fontSize="$2" fontWeight="400" color="$textMuted">
                      {view.hint}
                    </Text>
                  </YStack>
                </XStack>

                {/* Baud (default 9600, el del RS420). Editable por si el lector usa otro. */}
                <XStack alignItems="center" justifyContent="space-between" gap="$3">
                  <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textPrimary">
                    Baud rate
                  </Text>
                  <View
                    backgroundColor="$bg"
                    borderWidth={1}
                    borderColor="$divider"
                    borderRadius="$card"
                    paddingHorizontal="$3"
                    paddingVertical="$2"
                    minWidth={getTokenValue('$10', 'size')}
                  >
                    {/* TextInput de RN: cruza a API no-Tamagui; estilos via getTokenValue (ADR-023 §4). */}
                    <BaudInput value={baudText} onChangeText={setBaudText} disabled={isConnected || isBusy} />
                  </View>
                </XStack>

                {/* CTA conectar / desconectar (gesto de usuario para requestPort, R5.2) */}
                {isConnected ? (
                  <Button variant="secondary" fullWidth onPress={onDisconnect}>
                    Desconectar
                  </Button>
                ) : (
                  <Button variant="primary" fullWidth onPress={onConnect} disabled={isBusy}>
                    {isBusy ? 'Conectando…' : 'Conectar bastón (Web Serial)'}
                  </Button>
                )}
              </YStack>
            </Card>

            {/* Lista en vivo de EIDs (confirmación visual, R4.4/R2.1) */}
            <Card>
              <YStack gap="$3">
                <XStack alignItems="center" justifyContent="space-between">
                  <Text fontFamily="$body" fontSize="$5" fontWeight="700" color="$textPrimary">
                    Lecturas {reads.length > 0 ? `(${reads.length})` : ''}
                  </Text>
                  {reads.length > 0 ? (
                    <Button variant="secondary" onPress={onClear}>
                      Limpiar
                    </Button>
                  ) : null}
                </XStack>

                {reads.length === 0 ? (
                  <XStack alignItems="center" gap="$2" paddingVertical="$3">
                    <Bluetooth size={18} color={muted} strokeWidth={2} />
                    <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
                      Todavía no leíste ningún EID. Conectá el bastón y bastoneá un animal.
                    </Text>
                  </XStack>
                ) : (
                  <YStack gap="$2">
                    {reads.map((r, i) => (
                      <ReadRow key={r.seq} eid={r.eid} time={formatTime(r.timestamp)} latest={i === 0} />
                    ))}
                  </YStack>
                )}
              </YStack>
            </Card>
          </>
        )}
      </ScrollView>
    </YStack>
  );
}

// ─── TextInput del baud (API RN no-Tamagui; estilos via token, ADR-023 §4) ──────
function BaudInput({
  value,
  onChangeText,
  disabled,
}: {
  value: string;
  onChangeText: (t: string) => void;
  disabled: boolean;
}) {
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const faint = getTokenValue('$textFaint', 'color');
  // 16px para el input (mismo token que el SearchBar de mis-campos.tsx; cruza a la API RN
  // no-Tamagui del TextInput, así que se lee con getTokenValue — sigue referenciando el token).
  const fontSize = getTokenValue('$inputText', 'size');
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      editable={!disabled}
      keyboardType="number-pad"
      accessibilityLabel="Baud rate del puerto serie"
      placeholder={String(DEFAULT_BAUD)}
      placeholderTextColor={faint}
      style={{
        color: disabled ? faint : textPrimary,
        fontFamily: 'Inter',
        fontSize,
        minWidth: getTokenValue('$8', 'size'),
        textAlign: 'right',
        padding: getTokenValue('$0', 'space'), // 0 via token (el View padre ya da el padding)
      }}
    />
  );
}

// ─── Fila de una lectura confirmada ─────────────────────────────────────────────
function ReadRow({ eid, time, latest }: { eid: string; time: string; latest: boolean }) {
  return (
    <XStack
      alignItems="center"
      justifyContent="space-between"
      gap="$3"
      backgroundColor={latest ? '$greenLight' : '$bg'}
      borderWidth={1}
      borderColor={latest ? '$primary' : '$divider'}
      borderRadius="$card"
      paddingHorizontal="$3"
      paddingVertical="$3"
    >
      <Text
        fontFamily="$body"
        fontSize="$5"
        fontWeight={latest ? '700' : '500'}
        color="$textPrimary"
        letterSpacing={1}
      >
        {eid}
      </Text>
      <Text fontFamily="$body" fontSize="$2" fontWeight="400" color="$textMuted">
        {time}
      </Text>
    </XStack>
  );
}

// ─── Export: monta el Provider (self-contained) alrededor del harness ───────────
export default function BastonTestScreen() {
  // BleStickListenerProvider en 'auto' (en web → web-serial). Se monta DENTRO de la pantalla
  // (no en el root layout) para no tocar archivos compartidos de la otra terminal. La conexión
  // viva la maneja el adapter propio del harness (baud configurable); el provider queda montado
  // para que la pantalla sea self-contained y los hooks de spec 09 tengan contexto si se usan.
  return (
    <BleStickListenerProvider mode="auto">
      <BastonTestInner />
    </BleStickListenerProvider>
  );
}
