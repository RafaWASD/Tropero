// Componentes de REPORTES (spec 07 Stream C — FRONTEND). Cards/estados reutilizables, sin fetch directo
// (architecture.md: la lógica de fetching vive en hooks/services). Las pantallas de reportes los componen.

export { ReportLoading, ReportOffline, ReportError, ReportEmpty } from './ReportStates';
export { KpiCard, KpiRow, ReportSectionHeader, ReportDivider } from './KpiCard';
export type { KpiCardProps } from './KpiCard';
export { CclBars } from './CclBars';
export type { CclBarsProps } from './CclBars';
export { AlertList } from './AlertList';
export type { AlertItem } from './AlertList';
