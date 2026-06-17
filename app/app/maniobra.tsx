// app/maniobra.tsx — INICIO de MODO MANIOBRAS (spec 03 M1.4 US-2/R2.2 + M4 reanudación R10.5/R10.6).
//
// Destino del FAB central elevado (presentación modal, ver _layout.tsx raíz). Pantalla de arranque del
// wizard de jornada:
//   - REANUDACIÓN (M4, R10.5/R10.6): al enfocar, chequea si hay una jornada ABIERTA (getActiveSession,
//     lectura local offline). Si la hay, muestra una TARJETA PROMINENTE "Retomar la jornada de hoy" ARRIBA
//     de "Tus rutinas" (rodeo + maniobras + N animales + fecha si no empezó hoy); tap → la identificación
//     de esa sesión. Por qué importa: "Salir sin terminar" del ExitJornadaSheet (M2.1-exit-hero) deja la
//     sesión `active` y reanudable, pero sin esta tarjeta el landing no tenía a dónde volver.
//   - PRESETS AL TOPE (R2.2): filas tappables de presets del establecimiento; tap arranca la jornada desde
//     el preset (navega al wizard con presetId → carga las maniobras aplicables y avisa las omitidas, R2.3).
//   - CTA grande "Nueva jornada": arranca el wizard desde cero (etapa 1 = elegir rodeo). CON una jornada
//     abierta (R10.6: una sola jornada activa por dispositivo) → abre un sheet de confirmación
//     (NuevaJornadaConfirmSheet): empezar una nueva CIERRA la abierta (con aviso) o retomar la abierta. SIN
//     jornada abierta → va DIRECTO al wizard (como siempre). Decisión de Raf: una sola jornada activa.
//
// Servicios consumidos (M1-SERVICIOS): fetchPresets + getActiveSession (lectura LOCAL offline). El cierre de
// la jornada abierta al "Empezar una nueva" NO se hace acá: lo hace `createSession` al arrancar la jornada
// nueva en el wizard (cierra TODAS las activas del establishment ANTES de insertar → invariante ≤1 activa,
// R10.6). El establishment activo SIEMPRE del contexto (NUNCA hardcodeado, CLAUDE.md ppio 6). El nombre del
// rodeo de la sesión se resuelve via RodeoContext (mismo patrón que identificar.tsx).
//
// 🟡 mixto: targets grandes + CTA primario en zona del pulgar, pero permite la densidad de la lista de
// presets. RECORTE DE DESCENDENTES (memoria): headings ≥$6 y Text con numberOfLines llevan lineHeight
// matching. Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue.

import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ChevronRight, History, Sparkles, X, Zap } from 'lucide-react-native';

import { Button, Card, InfoNote } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import { fetchPresets, type ManeuverPreset } from '@/services/maneuver-presets';
import { getActiveSession, type Session } from '@/services/sessions';
import { extractManeuvers } from '@/utils/maneuver-config';
import { maneuverLabel } from '@/utils/maneuver-wizard';
import {
  resumeManeuversSummary,
  resumeAnimalCountLabel,
  resumeStartedDateLabel,
} from '@/utils/maniobra-resume';
import { NuevaJornadaConfirmSheet } from './maniobra/_components/NuevaJornadaConfirmSheet';

export default function ManiobraInicioScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  const [presets, setPresets] = useState<ManeuverPreset[]>([]);
  // Jornada ABIERTA del dispositivo (R10.5/R10.6), o null. Chequeada al enfocar (lectura local offline).
  const [openSession, setOpenSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // ¿Mostrar el sheet de confirmación de "Nueva jornada" (cuando hay una abierta, R10.6)?
  const [showNuevaConfirm, setShowNuevaConfirm] = useState(false);

  // Cargamos presets + la sesión activa al enfocar (local, offline). Un campo sin presets es válido (solo
  // "Nueva jornada"); sin sesión activa también (no se muestra la tarjeta de retomar). Refrescar al enfocar
  // asegura que tras "Salir sin terminar" o tras terminar/arrancar una jornada, el landing refleje el estado.
  useFocusEffect(
    useCallback(() => {
      if (!establishmentId) {
        setPresets([]);
        setOpenSession(null);
        setLoading(false);
        return;
      }
      let active = true;
      setLoading(true);
      void (async () => {
        const [presetsRes, sessionRes] = await Promise.all([
          fetchPresets(establishmentId),
          getActiveSession(establishmentId),
        ]);
        if (!active) return;
        setPresets(presetsRes.ok ? presetsRes.value : []);
        // Una lectura fallida de la sesión activa (no debería offline) → tratamos como "sin jornada abierta"
        // (no bloqueamos el landing por eso; el peor caso es no ofrecer retomar, recuperable re-enfocando).
        setOpenSession(sessionRes.ok ? sessionRes.value : null);
        setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [establishmentId]),
  );

  // Nombre del rodeo de la jornada abierta (RodeoContext del campo activo). '' si no resuelve (no rompe).
  const openRodeoName =
    openSession && rodeoState.status === 'active'
      ? (rodeoState.available.find((r) => r.id === openSession.rodeoId)?.name ?? '')
      : '';

  // Navegar a la identificación de la jornada abierta (retomar, R10.5).
  const resumeOpenSession = useCallback(
    (session: Session) => {
      router.push({ pathname: '/maniobra/identificar', params: { sessionId: session.id } });
    },
    [router],
  );

  const onNuevaJornada = useCallback(() => {
    // R10.6: una sola jornada activa por dispositivo. Con una abierta → confirmar (cerrar la abierta o
    // retomarla); sin abierta → directo al wizard (camino de siempre).
    // GUARD de carrera: si el chequeo de la sesión activa (getActiveSession) aún está en vuelo (`loading`),
    // NO arrancamos a ciegas — eso podría saltarse el aviso y dejar DOS sesiones activas. El CTA también se
    // deshabilita mientras `loading` (defensa en profundidad). La lectura es local (sub-segundo).
    if (loading) return;
    if (openSession) {
      setShowNuevaConfirm(true);
      return;
    }
    router.push('/maniobra/jornada');
  }, [loading, openSession, router]);

  // "Empezar una nueva" desde el sheet: va al wizard. NO cierra la abierta acá — el cierre lo hace
  // `createSession` al ARRANCAR la jornada nueva en el wizard, que cierra TODAS las activas del
  // establishment ANTES de insertar (invariante ≤1 activa, R10.6). Un solo camino de cierre → sin
  // doble-close. La abierta queda `active` mientras el operario configura la nueva (si abandona el wizard
  // sin arrancar, sigue siendo la única activa y el landing la vuelve a ofrecer retomar — coherente). El
  // copy del sheet ("…esa queda cerrada") vale: al crear la nueva, la vieja queda cerrada. Devuelve true
  // (no hay write acá que pueda fallar; el fail-closed real es del createSession en el wizard).
  const onConfirmStartNew = useCallback(async (): Promise<boolean> => {
    setShowNuevaConfirm(false);
    router.push('/maniobra/jornada');
    return true;
  }, [router]);

  const onConfirmResume = useCallback(() => {
    if (!openSession) return;
    setShowNuevaConfirm(false);
    resumeOpenSession(openSession);
  }, [openSession, resumeOpenSession]);

  const onPreset = useCallback(
    (preset: ManeuverPreset) => {
      // Arranca el wizard desde el preset: el wizard pide el rodeo (etapa 1) y al elegirlo carga el
      // preset contra ese rodeo (loadPreset filtra maniobras gateadas OFF + avisa las omitidas, R2.3).
      router.push({ pathname: '/maniobra/jornada', params: { presetId: preset.id } });
    },
    [router],
  );

  const PRIMARY = getTokenValue('$primary', 'color');
  const MUTED = getTokenValue('$textMuted', 'color');
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  return (
    <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      {/* ── HEADER: título + cerrar (es modal) ── */}
      <XStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$2" alignItems="center" justifyContent="space-between">
        <XStack alignItems="center" gap="$2">
          <Zap size={26} color={PRIMARY} fill={PRIMARY} />
          {/* "MODO MANIOBRAS" — heading, lineHeight matching por convención. */}
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
            Modo maniobras
          </Text>
        </XStack>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12}>
          <X size={26} color={MUTED} />
        </Pressable>
      </XStack>

      <ScrollView
        flex={1}
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$2', 'space'),
          paddingBottom: getTokenValue('$6', 'space'),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── RETOMAR LA JORNADA ABIERTA (M4, R10.5/R10.6) — ARRIBA de todo cuando la hay ── */}
        {openSession ? (
          <ResumeJornadaCard
            session={openSession}
            rodeoName={openRodeoName}
            onPress={resumeOpenSession}
          />
        ) : null}

        {/* ── PRESETS AL TOPE (R2.2) ── */}
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textMuted" numberOfLines={1} marginBottom="$2">
          Tus rutinas
        </Text>

        {loading ? (
          <InfoNote>Cargando rutinas…</InfoNote>
        ) : presets.length === 0 ? (
          <InfoNote>Todavía no tenés rutinas guardadas. Arrancá una jornada nueva y, cuando quieras, guardala como rutina.</InfoNote>
        ) : (
          <YStack gap="$3">
            {presets.map((p) => (
              <PresetRow key={p.id} preset={p} onPress={onPreset} />
            ))}
          </YStack>
        )}
      </ScrollView>

      {/* ── CTA "Nueva jornada" (zona del pulgar). Deshabilitado mientras se resuelve la sesión activa
            (R10.6 guard de carrera: no arrancar antes de saber si hay una abierta). ── */}
      <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad}>
        <Button fullWidth disabled={loading} onPress={onNuevaJornada}>
          Nueva jornada
        </Button>
      </YStack>

      {/* ── SHEET de confirmación de "Nueva jornada" con una jornada abierta (R10.6) ── */}
      {showNuevaConfirm && openSession ? (
        <NuevaJornadaConfirmSheet
          rodeoName={openRodeoName}
          animalCount={openSession.animalCount}
          onStartNew={onConfirmStartNew}
          onResume={onConfirmResume}
          onClose={() => setShowNuevaConfirm(false)}
        />
      ) : null}
    </YStack>
  );
}

// Tarjeta PROMINENTE "Retomar la jornada de hoy" (R10.5/R10.6). Target grande (full-width card tappable):
// es la acción principal cuando hay una jornada abierta — el operario salió a medias y vuelve a la manga.
function ResumeJornadaCard({
  session,
  rodeoName,
  onPress,
}: {
  session: Session;
  rodeoName: string;
  onPress: (s: Session) => void;
}) {
  const PRIMARY = getTokenValue('$primary', 'color');
  // Subtítulo: rodeo + maniobras (con · de separador). Sin rodeo resuelto, omitimos esa parte (no rompe).
  const maniobras = resumeManeuversSummary(session.config);
  const startedLabel = resumeStartedDateLabel(session.startedAt);
  const countLabel = resumeAnimalCountLabel(session.animalCount);
  // Línea de detalle: "N animales" + "· desde el 12/06" si no empezó hoy.
  const detail = startedLabel ? `${countLabel} · desde el ${startedLabel}` : countLabel;
  // Subtítulo de identidad de la jornada: rodeo (si resuelve) + maniobras.
  const identity = rodeoName ? (maniobras ? `${rodeoName} · ${maniobras}` : rodeoName) : maniobras || 'Jornada en curso';

  return (
    <Pressable
      onPress={() => onPress(session)}
      accessibilityRole="button"
      accessibilityLabel="Retomar la jornada de hoy"
      style={{ marginBottom: getTokenValue('$5', 'space') }}
    >
      {/* Card de acento (borde verde + fondo greenLight) para que destaque sobre las filas de presets. */}
      <View
        backgroundColor="$greenLight"
        borderColor="$primary"
        borderWidth={2}
        borderRadius="$card"
        paddingHorizontal="$4"
        paddingVertical="$4"
      >
        <XStack alignItems="center" gap="$3">
          <View backgroundColor="$bg" borderRadius="$pill" width={52} height={52} alignItems="center" justifyContent="center">
            <History size={28} color={PRIMARY} />
          </View>
          <YStack flex={1} minWidth={0} gap="$1">
            {/* Título — lineHeight matching ("jornada" trae j). 2 líneas: en 360px no entra en una sola y
                no queremos truncar "…de hoy" (pierde la frase). En 412+ entra holgado en una línea. */}
            <Text fontFamily="$heading" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={2}>
              Retomar la jornada de hoy
            </Text>
            <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary" numberOfLines={1}>
              {identity}
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
              {detail}
            </Text>
          </YStack>
          <ChevronRight size={24} color={PRIMARY} />
        </XStack>
      </View>
    </Pressable>
  );
}

function PresetRow({ preset, onPress }: { preset: ManeuverPreset; onPress: (p: ManeuverPreset) => void }) {
  const PRIMARY = getTokenValue('$primary', 'color');
  const FAINT = getTokenValue('$textFaint', 'color');
  // Resumen legible de las maniobras del preset (filtra desconocidas vía extractManeuvers).
  const maniobras = extractManeuvers(preset.config);
  const summary = maniobras.length > 0 ? maniobras.map(maneuverLabel).join(' · ') : 'Sin maniobras';
  return (
    <Pressable onPress={() => onPress(preset)} accessibilityRole="button" accessibilityLabel={`Arrancar rutina ${preset.name}`}>
      <Card>
        <XStack alignItems="center" gap="$3">
          <View backgroundColor="$greenLight" borderRadius="$pill" width={44} height={44} alignItems="center" justifyContent="center">
            <Sparkles size={22} color={PRIMARY} />
          </View>
          <YStack flex={1} minWidth={0} gap="$1">
            {/* Nombre del preset — lineHeight matching (puede traer descendentes). */}
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {preset.name}
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
              {summary}
            </Text>
          </YStack>
          <ChevronRight size={22} color={FAINT} />
        </XStack>
      </Card>
    </Pressable>
  );
}
