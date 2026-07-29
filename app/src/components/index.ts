// UI reutilizable. Librería de componentes canónica (ADR-023): el deliverable del
// frontend son los componentes, no las pantallas. Derivados al construir la home (A.1).
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Card } from './Card';
export type { CardProps } from './Card';
// Skeleton loaders (polish U6b): primitivo pulsante + presets que espejan los componentes reales
// (AnimalRow / GroupSummaryCard / LoteCard / ficha de animal / RodeoCard / MemberRow). Se usan SOLO en la
// primera carga sin datos (loading && data===null), nunca en refresh.
export {
  Skeleton,
  SkeletonCircle,
  SkeletonText,
  useSkeletonPulse,
  AnimalRowSkeleton,
  GroupSummaryCardSkeleton,
  LoteCardSkeleton,
  AnimalHeroSkeleton,
  DetailSectionSkeleton,
  AnimalFichaSkeleton,
  RodeoCardSkeleton,
  MemberRowSkeleton,
} from './Skeleton';
export type { SkeletonProps, SkeletonTextProps } from './Skeleton';
export { FormField } from './FormField';
export type { FormFieldProps } from './FormField';
// Teléfono (spec 01, delta TELÉFONO): el ÚNICO input de teléfono de la app. Ninguna pantalla arma
// uno a mano con FormField — la paridad es por construcción y la hace cumplir phone-field-guard.test.ts.
export { PhoneField } from './PhoneField';
export type { PhoneFieldProps, PhoneValue } from './PhoneField';
export { ConditionScoreStepper } from './ConditionScoreStepper';
export type { ConditionScoreStepperProps } from './ConditionScoreStepper';
export { AuthScreenShell } from './AuthScreenShell';
export type { AuthScreenShellProps } from './AuthScreenShell';
// EL primitivo de "no me tapes con el teclado" (unidad «teclado Android»): base iOS/web
// (KeyboardAvoidingView 'padding') + `.android.tsx` (paddingBottom = alto del teclado vía
// useAnimatedKeyboard, porque con edge-to-edge la ventana ya no se encoge y el KAV es un no-op).
// NINGUNA pantalla monta un KeyboardAvoidingView a mano — lo hace cumplir keyboard-avoiding-guard.test.ts.
export { KeyboardAvoidingShell } from './KeyboardAvoidingShell';
export type { KeyboardAvoidingShellProps } from './KeyboardAvoidingShell';
export { FooterActionShell } from './FooterActionShell';
export type { FooterActionShellProps } from './FooterActionShell';
// Shell canónico de BOTTOM SHEET del repo (hermano de FooterActionShell, para sheets en vez de pantallas):
// backdrop $scrim con guard anti click-huérfano + header fijo / body scroll / footer fijo + KEYBOARD-AWARE
// (sube sobre el teclado y condensa lo prescindible). Todo sheet con input de texto usa este shell.
export { BottomSheetShell } from './BottomSheetShell';
export type { BottomSheetShellProps } from './BottomSheetShell';
export { FormError, InfoNote, LinkButton, AuthDivider } from './AuthBits';
// Login social (spec 19). GoogleSignInButton = 1 archivo; AppleSignInButton = base (web) + .native
// (iOS botón custom armonizado / Android null); markup compartido en AppleSignInButtonView.
export { GoogleSignInButton } from './GoogleSignInButton';
export type { GoogleSignInButtonProps } from './GoogleSignInButton';
export { AppleSignInButton } from './AppleSignInButton';
export type { AppleSignInButtonProps } from './AppleSignInButton';
export { Stepper } from './Stepper';
export type { StepperProps, StepperStep } from './Stepper';
export { EstablishmentCard } from './EstablishmentCard';
export type {
  EstablishmentCardProps,
  EstablishmentRole,
  EstablishmentHeroMetric,
} from './EstablishmentCard';
export { EstablishmentSwitcherDropdown, pickVisited, switcherSubtitle } from './EstablishmentSwitcherDropdown';
export type {
  EstablishmentSwitcherDropdownProps,
  SwitcherField,
} from './EstablishmentSwitcherDropdown';
export { ShareLink } from './ShareLink';
export type { ShareLinkProps } from './ShareLink';
export { RoleBadge } from './RoleBadge';
export type { RoleBadgeProps } from './RoleBadge';
export { AnimalRow, shouldShowFutureBullBadge } from './AnimalRow';
export type {
  AnimalRowProps,
  AnimalSex,
  AnimalStatus,
} from './AnimalRow';
export { CategoryBadge } from './CategoryBadge';
export type { CategoryBadgeProps } from './CategoryBadge';
export { FieldTemplateToggleList } from './FieldTemplateToggleList';
export type { FieldTemplateToggleListProps } from './FieldTemplateToggleList';
export { TimelineEvent } from './TimelineEvent';
export type { TimelineEventProps } from './TimelineEvent';
export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';
export { CenteredRow } from './CenteredRow';
export type { CenteredRowProps } from './CenteredRow';
export { GroupActionsBar } from './GroupActionsBar';
export type { GroupActionsBarProps } from './GroupActionsBar';
export { GroupMetaHeader } from './GroupViewBits';
export { GroupViewScreen } from './GroupViewScreen';
export type { GroupViewScreenProps } from './GroupViewScreen';
export { GroupSearchBar } from './GroupSearchBar';
export type { GroupSearchBarProps, GroupCategoryChipOption } from './GroupSearchBar';
export { GroupSummaryCard } from './GroupSummaryCard';
export type { GroupSummaryCardProps } from './GroupSummaryCard';
export { BulkConfirmSheet } from './BulkConfirmSheet';
export type { BulkConfirmSheetProps } from './BulkConfirmSheet';
// delta spec 02 tratamientos — sección de la ficha + sheets de iniciar/aplicar
export { TreatmentsSection } from './TreatmentsSection';
export type { TreatmentsSectionProps } from './TreatmentsSection';
export { TreatmentStartSheet } from './TreatmentStartSheet';
export type { TreatmentStartSheetProps, TreatmentStartSubmit } from './TreatmentStartSheet';
export { TreatmentApplicationSheet } from './TreatmentApplicationSheet';
export type { TreatmentApplicationSheetProps, TreatmentApplicationSubmit } from './TreatmentApplicationSheet';
export { BulkProgressPanel } from './BulkProgressPanel';
export type {
  BulkProgressPanelProps,
  BulkProgressPhase,
  BulkProgressRejection,
} from './BulkProgressPanel';
export { BleConnectionChip } from './BleConnectionChip';
export { bleConnectionView } from './ble-connection-view';
export type {
  BleConnectionView,
  BleConnectionEnv,
  BleStatusColorToken,
  BleStatusIcon,
} from './ble-connection-view';
export { IdentifierAssignRow } from './IdentifierAssignRow';
export type { IdentifierAssignRowProps } from './IdentifierAssignRow';
export { TagScanSheet } from './TagScanSheet';
export type { TagScanSheetProps } from './TagScanSheet';
export { TagScanCta, CapturedTagRow } from './TagScanCta';
export type { TagScanCtaProps, CapturedTagRowProps } from './TagScanCta';
export { LinkCalfPrompt } from './LinkCalfPrompt';
export type { LinkCalfPromptProps } from './LinkCalfPrompt';
export { ComboOptionRow } from './ComboOptionRow';
export type { ComboOptionRowProps } from './ComboOptionRow';
