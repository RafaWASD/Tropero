// app/editar-campo.tsx — EditEstablishmentScreen (spec 01, T4.5 / R3.4).
//
// Edita los datos del CAMPO ACTIVO (name/province/city/hectáreas). OWNER-ONLY (R3.4/R3.5):
//   - La UI solo ofrece "Editar campo" desde "Más" cuando el rol del usuario en el campo activo
//     es `owner` (EstablishmentContext.state.role === 'owner'). Acá defendemos igual: si al montar
//     el campo activo no es owner, mostramos un aviso y volvemos (no construimos el form). La RLS
//     `establishments_update` (0007, is_owner_of) es la barrera real server-side.
//
// Reusa el MISMO patrón del form de crear-campo (AuthScreenShell + FormField + Button +
// parseHectares + validateCreateEstablishment), pero SIN el gate de teléfono (R3.8 solo aplica al
// ALTA; editar no requiere teléfono) y PRE-CARGADO con los datos actuales del campo.
//
// ⚠️ Update SIN `.select()` (gotcha RLS-on-RETURNING — ver updateEstablishment en services). Tras
// guardar OK: refreshEstablishments() para reflejar el cambio en el contexto (la home/switch/Mis
// campos leen el nombre nuevo) y volver atrás.
//
// Cero hardcode (ADR-023 §4): componentes de librería + tokens. Voseo argentino.

import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, FormField, FormError, InfoNote } from '@/components';
import { useEstablishment } from '@/contexts';
import {
  loadEstablishmentDetail,
  updateEstablishment,
  type EstablishmentDetail,
} from '@/services/establishments';
import { formatHectares, parseHectares } from '@/utils/establishment';
import { validateCreateEstablishment } from '@/utils/validation';

// Copy accionable ante falta de conexión (editar es operación online, igual que crear).
const OFFLINE_COPY =
  'Necesitás conexión para editar el campo. Conectate a internet y volvé a intentar.';

type Phase =
  | { kind: 'loading' }
  | { kind: 'not_owner' }
  | { kind: 'error'; message: string }
  | { kind: 'form'; detail: EstablishmentDetail };

export default function EditarCampoScreen() {
  const router = useRouter();
  const { state, refreshEstablishments } = useEstablishment();

  // Campo activo + rol del usuario en él. Solo el owner puede editar (R3.4).
  const activeId = state.status === 'active' ? state.current.id : null;
  const isOwner = state.status === 'active' && state.role === 'owner';

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    if (state.status !== 'active') {
      // Sin campo activo (transición / active_lost): no tiene sentido editar. El RootGate
      // ya reubicará; acá mostramos un aviso para no quedar en blanco.
      setPhase({ kind: 'error', message: 'No hay un campo activo para editar.' });
      return;
    }
    if (!isOwner) {
      setPhase({ kind: 'not_owner' });
      return;
    }
    let active = true;
    setPhase({ kind: 'loading' });
    (async () => {
      const result = await loadEstablishmentDetail(activeId!);
      if (!active) return;
      if (!result.ok) {
        setPhase({
          kind: 'error',
          message: result.error.kind === 'network' ? OFFLINE_COPY : 'No pudimos cargar los datos del campo.',
        });
        return;
      }
      setPhase({ kind: 'form', detail: result.establishment });
    })();
    return () => {
      active = false;
    };
    // activeId/isOwner derivan de `state`; re-cargamos si cambia el campo activo.
  }, [activeId, isOwner, state.status]);

  if (phase.kind === 'loading') {
    return (
      <AuthScreenShell title="Editar campo" subtitle="Un momento…">
        <YStack gap="$4" marginTop="$2">
          <InfoNote>Cargando los datos del campo…</InfoNote>
        </YStack>
      </AuthScreenShell>
    );
  }

  if (phase.kind === 'not_owner') {
    return (
      <AuthScreenShell
        title="Editar campo"
        subtitle="Solo el dueño del campo puede editar sus datos."
      >
        <YStack gap="$4" marginTop="$2">
          <InfoNote>
            No tenés permiso para editar este campo. Pedile al dueño que haga los cambios.
          </InfoNote>
          <Button variant="secondary" fullWidth onPress={() => router.back()}>
            Volver
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  if (phase.kind === 'error') {
    return (
      <AuthScreenShell title="Editar campo" subtitle="No pudimos abrir la edición.">
        <YStack gap="$4" marginTop="$2">
          <FormError message={phase.message} />
          <Button variant="secondary" fullWidth onPress={() => router.back()}>
            Volver
          </Button>
        </YStack>
      </AuthScreenShell>
    );
  }

  return (
    <EditForm
      detail={phase.detail}
      onSaved={async () => {
        // Reflejamos el cambio en el contexto (nombre/provincia/etc.) sin cambiar el campo
        // activo: refreshEstablishments() re-lee el set; como el id sigue siendo el preferido,
        // resuelve `active` sobre el MISMO campo con los datos nuevos. Después volvemos a "Más".
        await refreshEstablishments();
        router.back();
      }}
      onCancel={() => router.back()}
    />
  );
}

// ─── Form de edición (R3.4) ─────────────────────────────────────────────────────

function EditForm({
  detail,
  onSaved,
  onCancel,
}: {
  detail: EstablishmentDetail;
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(detail.name);
  const [province, setProvince] = useState(detail.province);
  const [city, setCity] = useState(detail.city ?? '');
  const [hectares, setHectares] = useState(formatHectares(detail.totalHectares));

  const [nameError, setNameError] = useState<string | null>(null);
  const [provinceError, setProvinceError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit() {
    setFormError(null);
    const v = validateCreateEstablishment({ name, province });
    setNameError(v.name);
    setProvinceError(v.province);
    if (!v.valid) return;

    setSaving(true);
    const result = await updateEstablishment(detail.id, {
      name,
      province,
      city: city.trim() || null,
      totalHectares: parseHectares(hectares),
    });
    setSaving(false);

    if (result.ok) {
      await onSaved();
    } else {
      setFormError(result.error.kind === 'network' ? OFFLINE_COPY : result.error.message);
    }
  }

  return (
    <AuthScreenShell
      title="Editar campo"
      subtitle="Actualizá los datos de tu establecimiento."
    >
      <YStack gap="$4" marginTop="$2">
        <FormField
          label="Nombre del campo"
          value={name}
          onChangeText={setName}
          placeholder="Ej. La Juanita"
          autoCapitalize="words"
          error={nameError}
        />
        <FormField
          label="Provincia"
          value={province}
          onChangeText={setProvince}
          placeholder="Ej. Buenos Aires"
          autoCapitalize="words"
          error={provinceError}
        />
        <FormField
          label="Ciudad (opcional)"
          value={city}
          onChangeText={setCity}
          placeholder="Ej. Chascomús"
          autoCapitalize="words"
        />
        <FormField
          label="Hectáreas (opcional)"
          value={hectares}
          onChangeText={setHectares}
          placeholder="Ej. 1200"
          keyboardType="numeric"
        />

        <FormError message={formError} />

        <Button variant="primary" fullWidth disabled={saving} onPress={onSubmit}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        <Button variant="secondary" fullWidth onPress={onCancel}>
          Cancelar
        </Button>
      </YStack>
    </AuthScreenShell>
  );
}
