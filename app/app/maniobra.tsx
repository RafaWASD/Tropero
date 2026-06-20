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

import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { AlertTriangle, ChevronRight, History, MoreVertical, Sparkles, X, Zap } from 'lucide-react-native';

import { Button, Card, InfoNote } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import {
  fetchPresets,
  softDeletePreset,
  updatePreset,
  type ManeuverPreset,
} from '@/services/maneuver-presets';
import { getActiveSession, type Session } from '@/services/sessions';
import {
  useUploadRejections,
  isManeuverRejection,
  acknowledgeUploadRejections,
  recordUploadRejection,
  rejectionBannerTitle,
} from '@/services/powersync/upload-rejections';
import { buttonA11y } from '@/utils/a11y';
import { extractManeuvers } from '@/utils/maneuver-config';
import { maneuverLabel } from '@/utils/maneuver-wizard';
import {
  resumeManeuversSummary,
  resumeAnimalCountLabel,
  resumeStartedDateLabel,
} from '@/utils/maniobra-resume';
import { NuevaJornadaConfirmSheet } from './maniobra/_components/NuevaJornadaConfirmSheet';
import { SyncRechazoSheet } from './maniobra/_components/SyncRechazoSheet';
import { PresetActionsSheet } from './maniobra/_components/PresetActionsSheet';
import { ConfirmDeleteSheet } from './maniobra/_components/ConfirmDeleteSheet';
import { SavePresetSheet } from './maniobra/_components/SavePresetSheet';
import { consumeSyncRejectE2E } from './maniobra/_components/sync-rechazo-e2e';

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
  // ¿Mostrar el sheet de detalle de RECHAZOS DE SYNC (R10.8)?
  const [showRechazos, setShowRechazos] = useState(false);
  // ── GESTIÓN DE RUTINAS (M7-A, R2.6–R2.9) ──────────────────────────────────────────────────
  // La rutina sobre la que se abrió el menú ⋯ (null = ningún menú abierto). Una superficie a la vez:
  // `presetUiMode` discrimina qué sheet de esa rutina está abierto (menú / renombrar / confirmar-borrar).
  const [actionPreset, setActionPreset] = useState<ManeuverPreset | null>(null);
  const [presetUiMode, setPresetUiMode] = useState<'menu' | 'rename' | 'delete'>('menu');

  // ── RECHAZOS DE SYNC (R10.8) — el store observable que el connector llena al descartar un upload
  //    rechazado de forma permanente. Filtramos a las maniobras (un rechazo de otra tabla no es de manga).
  const allRejections = useUploadRejections();
  const maneuverRejections = useMemo(
    () => allRejections.filter((r) => isManeuverRejection(r.table)),
    [allRejections],
  );

  // Cargamos presets + la sesión activa al enfocar (local, offline). Un campo sin presets es válido (solo
  // "Nueva jornada"); sin sesión activa también (no se muestra la tarjeta de retomar). Refrescar al enfocar
  // asegura que tras "Salir sin terminar" o tras terminar/arrancar una jornada, el landing refleje el estado.
  useFocusEffect(
    useCallback(() => {
      // SOLO-E2E (gated fuera de prod, patrón `maneuver-e2e-fault.ts`): si Playwright armó un rechazo de
      // sync, lo inyectamos en el store al enfocar (consume-y-desarma) para ejercer el banner+sheet sin
      // forzar un rechazo server-side real. En prod/dev normal la marca no existe → no-op.
      const injected = consumeSyncRejectE2E();
      if (injected) {
        recordUploadRejection(
          { id: injected.id, table: injected.table, op: injected.op } as never,
          { code: injected.code },
        );
      }
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

  // "Entendido" del sheet de rechazos (R10.8): marca esos rechazos como vistos + cierra. Marcamos SOLO los
  // que se están mostrando (por id) — si llegara uno nuevo mientras el sheet está abierto, no se pierde.
  const onAcknowledgeRechazos = useCallback(() => {
    acknowledgeUploadRejections(maneuverRejections.map((r) => r.id));
    setShowRechazos(false);
  }, [maneuverRejections]);

  const onPreset = useCallback(
    (preset: ManeuverPreset) => {
      // Arranca el wizard desde el preset: el wizard pide el rodeo (etapa 1) y al elegirlo carga el
      // preset contra ese rodeo (loadPreset filtra maniobras gateadas OFF + avisa las omitidas, R2.3).
      router.push({ pathname: '/maniobra/jornada', params: { presetId: preset.id } });
    },
    [router],
  );

  // ── GESTIÓN DE RUTINAS (M7-A, R2.6–R2.9) ──────────────────────────────────────────────────

  // Abrir el menú ⋯ de una rutina (R2.6). El tap del CUERPO de la fila sigue arrancando la jornada (onPreset);
  // este ⋯ es una zona de tap aparte.
  const onOpenPresetMenu = useCallback((preset: ManeuverPreset) => {
    setActionPreset(preset);
    setPresetUiMode('menu');
  }, []);

  const closePresetUi = useCallback(() => {
    setActionPreset(null);
    setPresetUiMode('menu');
  }, []);

  // Editar → Renombrar (R2.7): abre el sheet de nombre precargado. La config NO cambia (solo el name).
  const onPresetRename = useCallback(
    async (newName: string): Promise<string | null> => {
      if (!actionPreset) return 'No pudimos resolver la rutina. Volvé a intentar.';
      const r = await updatePreset(actionPreset.id, newName, actionPreset.config);
      if (!r.ok) return r.error.message;
      // OK: cerramos el menú + refrescamos la lista (el nuevo nombre aparece). El overlay/local ya lo refleja.
      closePresetUi();
      setPresets((prev) =>
        prev.map((p) => (p.id === actionPreset.id ? { ...p, name: newName.trim() } : p)),
      );
      return null;
    },
    [actionPreset, closePresetUi],
  );

  // Editar → Reconfigurar maniobras (R2.8): reabre el wizard en MODO EDICIÓN de preset (editPresetId). El
  // wizard precarga loadPreset, deja cambiar maniobras/orden/preconfig y al guardar llama updatePreset (NO
  // arranca jornada). NO usa presetId (ese ARRANCA desde el preset) — usa editPresetId (EDITA el preset).
  const onPresetReconfigure = useCallback(() => {
    if (!actionPreset) return;
    const id = actionPreset.id;
    closePresetUi();
    router.push({ pathname: '/maniobra/jornada', params: { editPresetId: id } });
  }, [actionPreset, closePresetUi, router]);

  // Eliminar (R2.9): el menú cambia a la confirmación; al confirmar → softDeletePreset (RPC 0057, OUTBOX).
  const onPresetDeleteConfirm = useCallback(async (): Promise<string | null> => {
    if (!actionPreset) return 'No pudimos resolver la rutina. Volvé a intentar.';
    const r = await softDeletePreset(actionPreset.id);
    if (!r.ok) return r.error.message;
    // OK: la rutina desaparece de la lista al instante (overlay pending_status_overrides + quita optimista).
    const removedId = actionPreset.id;
    closePresetUi();
    setPresets((prev) => prev.filter((p) => p.id !== removedId));
    return null;
  }, [actionPreset, closePresetUi]);

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
        {/* ── BANNER de RECHAZOS DE SYNC (R10.8) — ARRIBA de todo (antes de retomar / rutinas) cuando hay
              maniobras que el server rechazó al sincronizar. Tap → sheet de detalle. ── */}
        {maneuverRejections.length > 0 ? (
          <SyncRechazoBanner
            count={maneuverRejections.length}
            onPress={() => setShowRechazos(true)}
          />
        ) : null}

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
              <PresetRow key={p.id} preset={p} onPress={onPreset} onMenu={onOpenPresetMenu} />
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

      {/* ── SHEET de detalle de RECHAZOS DE SYNC (R10.8) ── */}
      {showRechazos && maneuverRejections.length > 0 ? (
        <SyncRechazoSheet
          rejections={maneuverRejections}
          onAcknowledge={onAcknowledgeRechazos}
          onClose={() => setShowRechazos(false)}
        />
      ) : null}

      {/* ── GESTIÓN DE RUTINAS (M7-A): menú ⋯ → Editar (Renombrar/Reconfigurar) / Eliminar ── */}
      {actionPreset && presetUiMode === 'menu' ? (
        <PresetActionsSheet
          presetName={actionPreset.name}
          onRename={() => setPresetUiMode('rename')}
          onReconfigure={onPresetReconfigure}
          onDelete={() => setPresetUiMode('delete')}
          onClose={closePresetUi}
        />
      ) : null}

      {/* Renombrar (R2.7): reusa SavePresetSheet precargado con el nombre actual → updatePreset (config intacta). */}
      {actionPreset && presetUiMode === 'rename' ? (
        <SavePresetSheet
          initialName={actionPreset.name}
          title="Renombrar la rutina"
          description="Cambiá el nombre de la rutina. Las maniobras no se tocan."
          ctaLabel="Guardar nombre"
          onSave={onPresetRename}
          onClose={() => setPresetUiMode('menu')}
        />
      ) : null}

      {/* Eliminar (R2.9): confirmación SIN "Deshacer" → softDeletePreset. */}
      {actionPreset && presetUiMode === 'delete' ? (
        <ConfirmDeleteSheet
          title={`¿Eliminar la rutina ${actionPreset.name}?`}
          confirmLabel="Eliminar rutina"
          onConfirm={onPresetDeleteConfirm}
          onClose={() => setPresetUiMode('menu')}
          testID="delete-preset"
        />
      ) : null}
    </YStack>
  );
}

// Banner terracota (aviso, NO rojo) "⚠ N maniobra(s) no se sincronizaron" (R10.8). Tap → sheet de detalle.
// Target grande (banner full-width tappable). Pluralización es-AR.
function SyncRechazoBanner({ count, onPress }: { count: number; onPress: () => void }) {
  const TERRACOTA = getTokenValue('$terracota', 'color');
  const title = rejectionBannerTitle(count);
  return (
    <Pressable
      onPress={onPress}
      testID="sync-rechazo-banner"
      style={{ marginBottom: getTokenValue('$5', 'space') }}
      {...buttonA11y(Platform.OS, { label: `${title}. Ver detalle.` })}
    >
      {/* Borde + fondo de aviso terracota (color de aviso del DS, no hay token de error / no rojo). */}
      <View
        backgroundColor="$surface"
        borderColor="$terracota"
        borderWidth={2}
        borderRadius="$card"
        paddingHorizontal="$4"
        paddingVertical="$4"
      >
        <XStack alignItems="center" gap="$3">
          <AlertTriangle size={getTokenValue('$icon', 'size') * 0.6} color={TERRACOTA} />
          <YStack flex={1} minWidth={0} gap="$1">
            {/* Título — lineHeight matching ("sincronizaron" trae descenders). 2 líneas: en 360 no entra
                en una sola y no queremos truncar la frase. */}
            <Text fontFamily="$heading" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={2}>
              {title}
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
              Tocá para ver qué pasó
            </Text>
          </YStack>
          <ChevronRight size={24} color={TERRACOTA} />
        </XStack>
      </View>
    </Pressable>
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

function PresetRow({
  preset,
  onPress,
  onMenu,
}: {
  preset: ManeuverPreset;
  onPress: (p: ManeuverPreset) => void;
  /** Abre el menú ⋯ de gestión (Editar/Eliminar) de la rutina (M7-A, R2.6). */
  onMenu: (p: ManeuverPreset) => void;
}) {
  const PRIMARY = getTokenValue('$primary', 'color');
  const FAINT = getTokenValue('$textFaint', 'color');
  const MUTED = getTokenValue('$textMuted', 'color');
  // Resumen legible de las maniobras del preset (filtra desconocidas vía extractManeuvers).
  const maniobras = extractManeuvers(preset.config);
  const summary = maniobras.length > 0 ? maniobras.map(maneuverLabel).join(' · ') : 'Sin maniobras';
  return (
    <Card>
      <XStack alignItems="center" gap="$2">
        {/* CUERPO de la fila: tap = ARRANCAR la jornada (no se lo roba el ⋯, que va aparte a la derecha). */}
        <Pressable
          style={{ flex: 1, minWidth: 0 }}
          onPress={() => onPress(preset)}
          accessibilityRole="button"
          accessibilityLabel={`Arrancar rutina ${preset.name}`}
        >
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
        </Pressable>

        {/* ⋯ MENÚ DE ACCIONES (M7-A, R2.6): editar/eliminar la rutina. Affordance EXPLÍCITA (no swipe/long-press).
            Target XL (≥$touchMin) y zona de tap propia (no roba el tap del cuerpo que arranca la jornada). */}
        <Pressable
          onPress={() => onMenu(preset)}
          hitSlop={8}
          testID={`preset-menu-${preset.id}`}
          {...buttonA11y(Platform.OS, { label: `Acciones de la rutina ${preset.name}` })}
        >
          <View
            width="$touchMin"
            height="$touchMin"
            alignItems="center"
            justifyContent="center"
            borderRadius="$pill"
            pressStyle={{ backgroundColor: '$greenLight' }}
          >
            <MoreVertical size={getTokenValue('$navIcon', 'size')} color={MUTED} />
          </View>
        </Pressable>
      </XStack>
    </Card>
  );
}
