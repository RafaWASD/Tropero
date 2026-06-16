// src/theme/icons.ts — REGISTRO CENTRAL DE ICONOS DE ENTIDAD (single source of truth).
//
// Pedido de Raf: hoy cada pantalla importa el ícono lucide suelto (`Boxes`, `Layers`, …) y se
// desincronizan — una pantalla usa un glifo para "rodeo", otra usa otro. Este archivo es la ÚNICA
// fuente: cada entidad del dominio tiene UN ícono semántico, re-exportado de lucide. Cambiar el ícono
// de rodeo en toda la app = cambiar UNA línea acá.
//
// Convención as-built verificada (NO la cambiamos, solo la centralizamos):
//   - RODEO = `Boxes` (los cubos 3D)        — index.tsx l.664, mas.tsx l.840, rodeo/[id].tsx
//   - LOTE  = `Layers` (las capas apiladas)  — index.tsx l.686, mas.tsx l.851, lotes.tsx, lote/[id].tsx
//   - CAMPO/ESTABLECIMIENTO = `Building2`    — index.tsx header, mas.tsx
//   - ANIMAL = `PawPrint`                     — tab bar "Animales"
//   - MIEMBRO/EQUIPO = `Users`                — mas.tsx "Miembros e invitaciones"
//
// Uso: importás el alias semántico, no el lucide crudo.
//   import { RodeoIcon, LoteIcon } from '@/theme/icons';
//   <RodeoIcon size={20} color={primary} />            // como componente
//   <GroupSummaryCard icon={RodeoIcon} … />            // o pasando el componente por prop
//
// Los aliases son `LucideIcon` (mismo type que el import crudo) → drop-in, sin cambio de API. Un ícono
// que NO representa una entidad del dominio (chevrons, check, x, search, acciones puntuales) NO va acá:
// este registro es solo para los íconos de ENTIDAD, que son los que se desincronizaban entre pantallas.

import {
  Boxes,
  Building2,
  Layers,
  PawPrint,
  ScanLine,
  Users,
  type LucideIcon,
} from 'lucide-react-native';

/** Rodeo (agrupación productiva, ADR-020). Glifo: cubos 3D. */
export const RodeoIcon: LucideIcon = Boxes;

/** Lote (agrupación de manejo cross-rodeo, ADR-020). Glifo: capas apiladas. */
export const LoteIcon: LucideIcon = Layers;

/** Campo / establecimiento (tenant). Glifo: edificio rural. */
export const CampoIcon: LucideIcon = Building2;

/** Animal (cabeza). Glifo: huella. */
export const AnimalIcon: LucideIcon = PawPrint;

/** Miembro del equipo / personas del campo. Glifo: grupo de personas. */
export const MiembroIcon: LucideIcon = Users;

/**
 * Bastón / lector RFID de caravana electrónica (CONTEXT/05, spec 04). Glifo: línea de escaneo —
 * metáfora directa de "pasar el bastón por el animal para leer el chip". Es un ícono de DISPOSITIVO
 * de entrada del dominio (no de entidad), pero se centraliza acá porque la identificación BLE
 * aparece en varias pantallas de manga (MODO MANIOBRAS, BUSCAR ANIMAL) y debe verse igual en todas.
 */
export const StickIcon: LucideIcon = ScanLine;
