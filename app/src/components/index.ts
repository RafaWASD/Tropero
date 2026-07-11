// UI reutilizable. Librería de componentes canónica (ADR-023): el deliverable del
// frontend son los componentes, no las pantallas. Derivados al construir la home (A.1).
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Card } from './Card';
export type { CardProps } from './Card';
export { FormField } from './FormField';
export type { FormFieldProps } from './FormField';
export { ConditionScoreStepper } from './ConditionScoreStepper';
export type { ConditionScoreStepperProps } from './ConditionScoreStepper';
export { AuthScreenShell } from './AuthScreenShell';
export type { AuthScreenShellProps } from './AuthScreenShell';
export { FormError, InfoNote, LinkButton } from './AuthBits';
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
export { GroupMetaHeader, GroupAnimalsList } from './GroupViewBits';
export { GroupViewScreen } from './GroupViewScreen';
export type { GroupViewScreenProps } from './GroupViewScreen';
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
export type { BleConnectionView, BleStatusColorToken } from './ble-connection-view';
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
