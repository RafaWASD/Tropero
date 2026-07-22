// e2e/captures/skeletons.capture.ts — CAPTURE FILE del Gate 2.5 (ADR-029) para el polish U6b
// "SKELETON LOADERS" (docs/plan-mejoras-2026-07-20.md). Recorre las 4 pantallas de mayor tráfico en su
// estado SKELETON de primera carga y saca CAPTURAS NOMBRADAS a
// `e2e/captures/__shots__/skeletons/NN-<pantalla>.png` para que el leader las vete (design-review) antes
// de mostrárselas a Raf.
//
// ⚠️ NO es un test de regresión (.capture.ts, no .spec.ts → NO corre en `pnpm e2e`; se dispara a mano con
// --config playwright.capture.config.ts, viewport mobile real 412×915). Usa el spike `skeletons-spike`
// (DEV_WEB_ROUTES → el RootGate NO lo rebota a sign-in) que renderiza los MISMOS componentes de producción
// (AnimalRowSkeleton / GroupSummaryCardSkeleton / LoteCardSkeleton / ReportSkeleton) → lo que se vetea acá
// ES lo que ve el operario mientras baja la primera carga.
//
// Para correrlo:
//   cd app && pnpm e2e:build && pnpm exec playwright test e2e/captures/skeletons.capture.ts \
//     --config playwright.capture.config.ts --workers=1
//
// Salida: app/e2e/captures/__shots__/skeletons/  (gitignoreado — app/.gitignore + ADR-029 §Artefactos).

import path from 'node:path';

import { test, expect } from '../helpers/fixtures';
import type { Page } from '@playwright/test';

const SHOT_DIR = path.join('e2e', 'captures', '__shots__', 'skeletons');

/** Saca una captura NOMBRADA tras un breve settle (deja que monte el bundle + arranque el pulso). */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

/** Navega a una variante del spike y espera a que el título de la pantalla esté visible (bundle montado). */
async function gotoVariant(page: Page, variant: string, title: string): Promise<void> {
  await page.goto(`/skeletons-spike?variant=${variant}`);
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });
}

test('captura U6b skeletons: las 7 pantallas en su estado de primera carga', async ({ page }) => {
  test.setTimeout(240_000);

  // ── 1er incremento (commit 54c13ea) ──────────────────────────────────────────────────────────

  // ── 01 — ANIMALES: ~8 filas skeleton (espejo de AnimalRow, alto $animalRow + avatar $icon). ──
  await gotoVariant(page, 'animales', 'Animales');
  await shot(page, '01-animales');

  // ── 02 — HOME: sección "Mis rodeos" con 3 cards skeleton (espejo de GroupSummaryCard). ──
  await gotoVariant(page, 'home', 'Inicio');
  await expect(page.getByText('Mis rodeos', { exact: true })).toBeVisible();
  await shot(page, '02-home-rodeos');

  // ── 03 — LOTES: 3 cards skeleton (espejo de LoteCard, Card $surface + círculo + título). ──
  await gotoVariant(page, 'lotes', 'Lotes');
  await shot(page, '03-lotes');

  // ── 04 — REPORTES: sección "Reproductivo" con los KPIs skeleton (espejo de KpiCard/KpiRow). ──
  await gotoVariant(page, 'reportes', 'Reportes');
  await expect(page.getByText('Reproductivo', { exact: true })).toBeVisible();
  await shot(page, '04-reportes-kpis');

  // ── 2do incremento (U6b) ─────────────────────────────────────────────────────────────────────

  // ── 05 — FICHA: hero (identificador $9 + chips) + 2 cards de sección (espejo de AnimalHero/DetailSection). ──
  //   La ficha real NO tiene título (el hero lo es); solo la barra de back → sin `expect` de título.
  await page.goto('/skeletons-spike?variant=ficha');
  await page.waitForTimeout(1_000);
  await shot(page, '05-ficha');

  // ── 06 — RODEOS: 3 cards skeleton (owner) — título $6 + filas de acción $chipMin (espejo de RodeoCard). ──
  await gotoVariant(page, 'rodeos', 'Rodeos');
  await shot(page, '06-rodeos');

  // ── 07 — MIEMBROS: Card única con 4 filas SIN avatar — nombre + RoleBadge (espejo de MemberRow). ──
  await gotoVariant(page, 'miembros', 'Equipo');
  await shot(page, '07-miembros');
});
