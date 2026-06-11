// UI reutilizable. Librería de componentes canónica (ADR-023): el deliverable del
// frontend son los componentes, no las pantallas. Derivados al construir la home (A.1).
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Card } from './Card';
export type { CardProps } from './Card';
export { FormField } from './FormField';
export type { FormFieldProps } from './FormField';
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
export { AnimalRow } from './AnimalRow';
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
