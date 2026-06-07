// app/crear-rodeo.tsx — wizard "Crear rodeo" (spec 02 frontend, C1 / T4.3 — R2.6).
//
// 3 pasos, una decisión por pantalla (CLAUDE.md ppio 4, manga-friendly aunque crear rodeo es
// operación de oficina):
//   1. Sistema productivo: cards grandes. Solo (bovino, cría) seleccionable; el resto grisado
//      con badge "Próximamente" (R2.4 / MVP). Lee systems_by_species de bovino.
//   2. Nombre del rodeo: FormField con validación no-vacío (trim, máx 60).
//   3. Plantilla de datos: lista agrupada por categoría (FieldTemplateToggleList), pre-tildada
//      según system_default_fields. Confirmar → createRodeo (INSERT + trigger pre-pobla config +
//      aplica el diff de toggles). R2.6/R2.8/R2.11/R2.12.
//
// DOBLE USO:
//   - Ruta navegable: desde RodeosScreen ("Crear rodeo"), con back. Tras crear, vuelve a la lista.
//   - Empty-state de bloqueo total (R2.6): el RootGate rutea acá cuando el campo activo tiene 0
//     rodeos. En ese modo NO hay "atrás" (no hay a dónde volver: sin rodeo la app está bloqueada);
//     el copy de bienvenida lo refleja. Distinguimos por el estado del RodeoContext (no_rodeos).
//
// Tras crear OK: refreshRodeos() → el RodeoContext pasa a 'active' sobre el rodeo nuevo y el
// RootGate destraba la navegación (sale del bloqueo total). Reemplazamos para no dejar el wizard
// en el back-stack.
//
// Crear rodeo es operación ONLINE (R9.2, como crear campo): sin red → copy accionable.
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería. Voseo argentino.

import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';

import { Button, FieldTemplateToggleList, FormField, FormError, InfoNote } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import {
  fetchProductionSystems,
  createRodeo,
  type ProductionSystem,
} from '@/services/rodeos';
import {
  fetchFieldCatalog,
  fetchSystemDefaults,
} from '@/services/rodeo-config';
import {
  buildWizardToggles,
  groupTogglesByCategory,
  setToggle,
  type TemplateToggle,
} from '@/utils/rodeo-template';
import { buttonA11y } from '@/utils/a11y';

const OFFLINE_COPY =
  'Necesitás conexión para crear un rodeo. Conectate a internet y volvé a intentar.';

const TEMPLATE_HEADER =
  'Ya dejamos tildados los datos típicos de cría. Ajustá los que registres (o no) en este rodeo.';

const NAME_MAX = 60;
const TOTAL_STEPS = 3;

export default function CrearRodeoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state: estState } = useEstablishment();
  const { state: rodeoState, refreshRodeos } = useRodeo();

  const establishmentId = estState.status === 'active' ? estState.current.id : null;
  // Modo bloqueo total (R2.6): el campo no tiene rodeos. Sin "atrás" (no hay a dónde volver).
  const isBlockingEmptyState = rodeoState.status === 'no_rodeos';

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Paso 1: sistemas disponibles + el elegido.
  const [systems, setSystems] = useState<ProductionSystem[] | null>(null);
  const [systemsError, setSystemsError] = useState<string | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<ProductionSystem | null>(null);

  // Paso 2: nombre.
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  // Paso 3: plantilla (toggles).
  const [toggles, setToggles] = useState<TemplateToggle[] | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Onboarding (R1.2 spec 12): tras crear el PRIMER rodeo (bloqueo total = onboarding), ofrecemos
  // importar el rodeo existente en vez de saltar directo al inicio. Solo en este caso (el alta desde
  // Rodeos ya tiene su propio CTA de import, T5.1). El que llega al bloqueo total es siempre el owner.
  const [onboardingDone, setOnboardingDone] = useState(false);

  // ── Cargar sistemas al montar (paso 1). ──────────────────────────────────────
  useEffect(() => {
    let active = true;
    (async () => {
      const result = await fetchProductionSystems('bovino');
      if (!active) return;
      if (!result.ok) {
        setSystemsError(
          result.error.kind === 'network'
            ? 'Sin conexión: no pudimos cargar los sistemas productivos.'
            : 'No pudimos cargar los sistemas productivos.',
        );
        return;
      }
      // Orden: activos primero (para que "Cría" quede arriba), después por nombre.
      const sorted = [...result.value].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name, 'es');
      });
      setSystems(sorted);
      // Pre-seleccionamos el único activo (en MVP, cría) para acelerar — el usuario igual confirma.
      const onlyActive = sorted.filter((s) => s.active);
      if (onlyActive.length === 1) setSelectedSystem(onlyActive[0]);
    })();
    return () => {
      active = false;
    };
  }, []);

  // ── Cargar la plantilla del sistema elegido al entrar al paso 3. ──────────────
  async function loadTemplateFor(system: ProductionSystem) {
    setLoadingTemplate(true);
    setTemplateError(null);
    const [catalogR, defaultsR] = await Promise.all([
      fetchFieldCatalog(),
      fetchSystemDefaults(system.systemId),
    ]);
    setLoadingTemplate(false);
    if (!catalogR.ok || !defaultsR.ok) {
      const err = !catalogR.ok ? catalogR.error : defaultsR.ok ? null : defaultsR.error;
      setTemplateError(
        err?.kind === 'network'
          ? 'Sin conexión: no pudimos cargar la plantilla de datos.'
          : 'No pudimos cargar la plantilla de datos.',
      );
      return;
    }
    const built = buildWizardToggles(catalogR.value, defaultsR.value);
    setToggles(built);
  }

  const sections = useMemo(
    () => (toggles ? groupTogglesByCategory(toggles) : []),
    [toggles],
  );

  // ── Navegación entre pasos. ───────────────────────────────────────────────────
  function goToStep2() {
    if (!selectedSystem) return;
    setStep(2);
  }

  function goToStep3() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError('Poné un nombre para el rodeo.');
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setNameError(`El nombre es muy largo (máx ${NAME_MAX} caracteres).`);
      return;
    }
    setNameError(null);
    setStep(3);
    if (selectedSystem && !toggles && !loadingTemplate) {
      void loadTemplateFor(selectedSystem);
    }
  }

  function goBack() {
    setFormError(null);
    if (step === 1) {
      // En bloqueo total no hay "atrás" (lo oculta la UI); por robustez, no navegamos fuera.
      if (!isBlockingEmptyState) router.back();
      return;
    }
    setStep((s) => (s === 3 ? 2 : 1) as 1 | 2 | 3);
  }

  async function onCreate() {
    if (!establishmentId || !selectedSystem || !toggles) return;
    setFormError(null);
    setCreating(true);
    const result = await createRodeo({
      establishmentId,
      name,
      systemCode: selectedSystem.code,
      speciesCode: 'bovino',
      toggles,
    });
    setCreating(false);

    if (!result.ok) {
      setFormError(result.error.kind === 'network' ? OFFLINE_COPY : result.error.message);
      return;
    }
    // El rodeo se creó: refrescamos el RodeoContext (pasa a 'active' sobre el nuevo) → el RootGate
    // destraba la navegación (sale del bloqueo total si venía de ahí).
    await refreshRodeos();
    if (isBlockingEmptyState) {
      // Onboarding (R1.2 spec 12): en vez de saltar directo al inicio, ofrecemos importar el rodeo
      // existente (el caso del beta — el productor ya tiene su padrón en una planilla). No forzamos.
      setOnboardingDone(true);
    } else {
      // Alta desde Rodeos: volvemos a la lista (ahí está el CTA de import, T5.1). Reemplazamos para
      // no dejar el wizard en el back-stack.
      router.replace('/rodeos');
    }
  }

  const title = isBlockingEmptyState ? 'Creá tu primer rodeo' : 'Crear rodeo';
  const subtitle = isBlockingEmptyState
    ? 'Un rodeo agrupa tus animales por sistema productivo. Creá el primero para empezar a cargar animales.'
    : 'Configurá un nuevo rodeo en este campo.';

  // Onboarding completado: oferta de importar el rodeo existente (R1.2 spec 12).
  if (onboardingDone) {
    return (
      <OnboardingImportOffer
        insets={insets}
        onImport={() => router.replace('/import-rodeo')}
        onSkip={() => router.replace('/(tabs)')}
      />
    );
  }

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header con barra de progreso (3 pasos). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4" gap="$3">
        <ProgressBar step={step} total={TOTAL_STEPS} />
        <YStack gap="$1">
          <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
            {title}
          </Text>
          <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
            {subtitle}
          </Text>
        </YStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$3', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {step === 1 ? (
          <Step1System
            systems={systems}
            error={systemsError}
            selected={selectedSystem}
            onSelect={setSelectedSystem}
          />
        ) : null}

        {step === 2 ? (
          <YStack gap="$3">
            <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
              ¿Cómo se llama el rodeo?
            </Text>
            <FormField
              label="Nombre del rodeo"
              value={name}
              onChangeText={setName}
              placeholder="Ej. Rodeo general"
              autoCapitalize="sentences"
              maxLength={NAME_MAX}
              error={nameError}
            />
          </YStack>
        ) : null}

        {step === 3 ? (
          <YStack gap="$2">
            {loadingTemplate ? (
              <InfoNote>Cargando la plantilla de datos…</InfoNote>
            ) : templateError ? (
              <YStack gap="$2">
                <FormError message={templateError} />
                <Button
                  variant="secondary"
                  fullWidth
                  onPress={() => selectedSystem && void loadTemplateFor(selectedSystem)}
                >
                  Reintentar
                </Button>
              </YStack>
            ) : toggles ? (
              <FieldTemplateToggleList
                sections={sections}
                header={TEMPLATE_HEADER}
                onToggle={(id, enabled) =>
                  setToggles((prev) => (prev ? setToggle(prev, id, enabled) : prev))
                }
              />
            ) : null}
          </YStack>
        ) : null}
      </ScrollView>

      {/* CTAs fijos abajo (thumb-zone). */}
      <YStack
        width="100%"
        paddingHorizontal="$4"
        paddingTop="$3"
        paddingBottom={insets.bottom + 12}
        gap="$2"
        borderTopWidth={1}
        borderTopColor="$divider"
        backgroundColor="$bg"
      >
        <FormError message={formError} />
        {step === 1 ? (
          <Button variant="primary" fullWidth disabled={!selectedSystem} onPress={goToStep2}>
            Continuar
          </Button>
        ) : step === 2 ? (
          <Button variant="primary" fullWidth onPress={goToStep3}>
            Continuar
          </Button>
        ) : (
          <Button
            variant="primary"
            fullWidth
            disabled={creating || !toggles}
            onPress={() => void onCreate()}
          >
            {creating ? 'Creando…' : 'Crear rodeo'}
          </Button>
        )}

        {/* "Atrás" salvo en el paso 1 del bloqueo total (no hay a dónde volver). */}
        {step === 1 && isBlockingEmptyState ? null : (
          <Button variant="secondary" fullWidth onPress={goBack}>
            {step === 1 ? 'Cancelar' : 'Atrás'}
          </Button>
        )}
      </YStack>
    </YStack>
  );
}

// ─── Oferta de import post-onboarding (R1.2 spec 12) ───────────────────────────────
//
// Tras crear el primer campo + rodeo, ofrecemos importar el rodeo existente desde una planilla (el
// caso del beta de Chascomús). Es una OFERTA, no un paso obligatorio: el CTA secundario va directo al
// inicio. El que llega acá es siempre el owner (el bloqueo total solo lo ve quien crea el campo).

function OnboardingImportOffer({
  insets,
  onImport,
  onSkip,
}: {
  insets: { top: number; bottom: number };
  onImport: () => void;
  onSkip: () => void;
}) {
  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: insets.top + getTokenValue('$6', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
        }}
        showsHorizontalScrollIndicator={false}
      >
        <YStack gap="$3">
          <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
            ¡Listo! Tu rodeo ya está creado
          </Text>
          <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
            ¿Ya tenés tu rodeo en una planilla o en un archivo de SENASA? Importalo de una y empezá con
            todos tus animales cargados. Si preferís, también podés cargarlos de a uno más adelante.
          </Text>
        </YStack>
      </ScrollView>

      <YStack
        width="100%"
        paddingHorizontal="$4"
        paddingTop="$3"
        paddingBottom={insets.bottom + 12}
        gap="$2"
        borderTopWidth={1}
        borderTopColor="$divider"
        backgroundColor="$bg"
      >
        <Button variant="primary" fullWidth onPress={onImport}>
          Importar mi rodeo existente
        </Button>
        <Button variant="secondary" fullWidth onPress={onSkip}>
          Más tarde, ir al inicio
        </Button>
      </YStack>
    </YStack>
  );
}

// ─── Barra de progreso (3 segmentos) ──────────────────────────────────────────────

function ProgressBar({ step, total }: { step: number; total: number }) {
  const segments = Array.from({ length: total }, (_, i) => i + 1);
  // Label ramificado por plataforma (aria-label en web, accessibilityLabel en native): igual que el
  // resto, `accessibilityLabel` crudo en el XStack de RN-web filtra como atributo DOM desconocido.
  const label = `Paso ${step} de ${total}`;
  const a11y =
    Platform.OS === 'web'
      ? { role: 'progressbar' as const, 'aria-label': label }
      : { accessibilityLabel: label };
  return (
    <XStack width="100%" gap="$2" marginTop="$2" {...a11y}>
      {segments.map((n) => (
        <View
          key={n}
          flex={1}
          height="$progressTrack"
          borderRadius="$pill"
          backgroundColor={n <= step ? '$primary' : '$divider'}
        />
      ))}
    </XStack>
  );
}

// ─── Paso 1: cards de sistema productivo ────────────────────────────────────────

function Step1System({
  systems,
  error,
  selected,
  onSelect,
}: {
  systems: ProductionSystem[] | null;
  error: string | null;
  selected: ProductionSystem | null;
  onSelect: (s: ProductionSystem) => void;
}) {
  if (error) {
    return <FormError message={error} />;
  }
  if (!systems) {
    return <InfoNote>Cargando sistemas productivos…</InfoNote>;
  }
  return (
    <YStack gap="$3">
      <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
        ¿Qué sistema productivo?
      </Text>
      {systems.map((s) => (
        <SystemCard
          key={s.systemId}
          system={s}
          selected={selected?.systemId === s.systemId}
          onSelect={() => s.active && onSelect(s)}
        />
      ))}
    </YStack>
  );
}

function SystemCard({
  system,
  selected,
  onSelect,
}: {
  system: ProductionSystem;
  selected: boolean;
  onSelect: () => void;
}) {
  const disabled = !system.active;
  // a11y ramificado por plataforma (buttonA11y): pasar `accessibilityLabel` crudo al Pressable de
  // RN-web lo filtra como atributo DOM desconocido → warning de React que en DEV monta el overlay que
  // bloquea los toques de TODA la pantalla (BUG 2). Mismo fix que ToggleRow. Ver utils/a11y.ts.
  const label = disabled
    ? `${system.name} (próximamente, no disponible)`
    : `Sistema ${system.name}`;
  const a11y = buttonA11y(Platform.OS, { label, disabled, selected });
  return (
    <Pressable disabled={disabled} onPress={onSelect} {...a11y}>
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor={selected ? '$primary' : '$divider'}
        backgroundColor={selected ? '$surface' : '$white'}
        paddingHorizontal="$4"
        paddingVertical="$3"
        opacity={disabled ? 0.5 : 1}
      >
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
            {system.name}
          </Text>
          {disabled ? (
            <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textFaint">
              Próximamente
            </Text>
          ) : null}
        </YStack>
        {/* Radio visual del seleccionado (solo para sistemas activos). */}
        {!disabled ? (
          <View
            width="$icon"
            height="$icon"
            borderRadius="$pill"
            borderWidth={2}
            borderColor={selected ? '$primary' : '$divider'}
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
          >
            {selected ? (
              <View width="$dot" height="$dot" borderRadius="$pill" backgroundColor="$primary" />
            ) : null}
          </View>
        ) : null}
      </XStack>
    </Pressable>
  );
}
