// Tests del mapeo NACIMIENTO → ETAPA (cabeza/cuerpo/cola) por mes de concepción (spec 07 Stream C — R7.8).
// node:test. Espejo de la asignación mes→tercio de la RPC `rodeo_calving_by_stage` (design §2.5). Foco:
//   - conceptionMonthFromBirthMonth: parto − 9 con wrap (R7.6.2/R7.8.1 / Gate 0 §5).
//   - calvingStageForBirth: tercios para 3..11, cabeza/cola para 2, null para 1/12/0/null (espejo de
//     pregnancy-buckets) — RPSC.5.x / R7.7.2 / R7.8.1.
//   - wrap de fin de año (Nov→Dic→Ene) por ORDEN DE SERVICIO, no numérico.
//   - concepción fuera de la ventana → null (no se ubica en ningún tercio).

import test from 'node:test';
import assert from 'node:assert/strict';

import { calvingStageForBirth, conceptionMonthFromBirthMonth } from './calving-stage';

// ─── conceptionMonthFromBirthMonth: parto − 9 (wrap 1..12) ───────────────────────────────────────────

test('conceptionMonthFromBirthMonth: parto − 9 con wrap (Gate 0 §5)', () => {
  // parto Octubre (10) → concepción Enero (1)
  assert.equal(conceptionMonthFromBirthMonth(10), 1);
  // parto Noviembre (11) → Febrero (2)
  assert.equal(conceptionMonthFromBirthMonth(11), 2);
  // parto Marzo (3) → Junio (6) del año anterior (mes 6)
  assert.equal(conceptionMonthFromBirthMonth(3), 6);
  // parto Agosto (8) → Noviembre (11)
  assert.equal(conceptionMonthFromBirthMonth(8), 11);
  // parto Septiembre (9) → Diciembre (12)
  assert.equal(conceptionMonthFromBirthMonth(9), 12);
  // parto Enero (1) → Abril (4)
  assert.equal(conceptionMonthFromBirthMonth(1), 4);
});

test('conceptionMonthFromBirthMonth: el resultado siempre cae en 1..12', () => {
  for (let m = 1; m <= 12; m += 1) {
    const c = conceptionMonthFromBirthMonth(m);
    assert.ok(c !== null && c >= 1 && c <= 12, `parto ${m} → concepción ${c} fuera de 1..12`);
  }
});

test('conceptionMonthFromBirthMonth: fuera de rango / no entero → null (defensivo)', () => {
  assert.equal(conceptionMonthFromBirthMonth(0), null);
  assert.equal(conceptionMonthFromBirthMonth(13), null);
  assert.equal(conceptionMonthFromBirthMonth(-1), null);
  assert.equal(conceptionMonthFromBirthMonth(3.5), null);
  assert.equal(conceptionMonthFromBirthMonth(Number.NaN), null);
});

// ─── calvingStageForBirth: sin distinción de etapas (espejo de sizeBucketsForServiceMonths) ──────────

test('calvingStageForBirth: rodeo sin configurar (null) → null', () => {
  assert.equal(calvingStageForBirth(null, 3), null);
});

test('calvingStageForBirth: 0 meses (no hace servicio) → null', () => {
  assert.equal(calvingStageForBirth([], 3), null);
});

test('calvingStageForBirth: 1 mes (misma edad) → null (sin distinción)', () => {
  // servicio en noviembre (11); parto en agosto (8) concibió en nov → pero 1 mes no distingue etapas
  assert.equal(calvingStageForBirth([11], 8), null);
});

test('calvingStageForBirth: 12 meses (continuo) → null (sin CCL)', () => {
  assert.equal(calvingStageForBirth([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3), null);
});

// ─── calvingStageForBirth: 2 meses → cabeza / cola ───────────────────────────────────────────────────

test('calvingStageForBirth: 2 meses {10,11} → 1er mes (Oct) cabeza, 2do (Nov) cola', () => {
  // servicio Oct(10)→Nov(11). concepción Oct = pos 0 → cabeza; Nov = pos 1 → cola.
  // parto que concibió en Oct: Oct + 9 = Jul → parto Julio (7).
  assert.equal(calvingStageForBirth([10, 11], 7), 'head');
  // parto que concibió en Nov: Nov + 9 = Ago → parto Agosto (8).
  assert.equal(calvingStageForBirth([10, 11], 8), 'tail');
});

// ─── calvingStageForBirth: 3 meses → tercios exactos ─────────────────────────────────────────────────

test('calvingStageForBirth: 3 meses {10,11,12} → tercios exactos cabeza/cuerpo/cola', () => {
  // servicio Oct(10)→Nov(11)→Dic(12). concepción Oct=pos0 cabeza; Nov=pos1 cuerpo; Dic=pos2 cola.
  assert.equal(calvingStageForBirth([10, 11, 12], 7), 'head'); // concibió Oct (Oct+9=Jul)
  assert.equal(calvingStageForBirth([10, 11, 12], 8), 'body'); // concibió Nov (Nov+9=Ago)
  assert.equal(calvingStageForBirth([10, 11, 12], 9), 'tail'); // concibió Dic (Dic+9=Sep)
});

// ─── calvingStageForBirth: WRAP de fin de año (orden de servicio, no numérico) ───────────────────────

test('calvingStageForBirth: wrap {11,12,1} (Nov→Dic→Ene) por ORDEN DE SERVICIO', () => {
  // El array ordenado asc sería [1,11,12]; pero el ORDEN DE SERVICIO es Nov(11)→Dic(12)→Ene(1).
  // pos: Nov=0 cabeza, Dic=1 cuerpo, Ene=2 cola.
  const sm = [11, 12, 1];
  assert.equal(calvingStageForBirth(sm, 8), 'head'); // concibió Nov (Nov+9=Ago)
  assert.equal(calvingStageForBirth(sm, 9), 'body'); // concibió Dic (Dic+9=Sep)
  assert.equal(calvingStageForBirth(sm, 10), 'tail'); // concibió Ene (Ene+9=Oct)
});

test('calvingStageForBirth: wrap {12,1,2} (Dic→Ene→Feb)', () => {
  const sm = [12, 1, 2];
  assert.equal(calvingStageForBirth(sm, 9), 'head'); // concibió Dic (Dic+9=Sep)
  assert.equal(calvingStageForBirth(sm, 10), 'body'); // concibió Ene (Ene+9=Oct)
  assert.equal(calvingStageForBirth(sm, 11), 'tail'); // concibió Feb (Feb+9=Nov)
});

// ─── calvingStageForBirth: tercios enteros para 4..11 (split entero, [SUPUESTO]) ─────────────────────

test('calvingStageForBirth: 6 meses {1..6} → tercios pares (1,2 cabeza / 3,4 cuerpo / 5,6 cola)', () => {
  const sm = [1, 2, 3, 4, 5, 6];
  // concepción Ene(1)=pos0, Feb(2)=pos1 → cabeza; Mar(3)=pos2, Abr(4)=pos3 → cuerpo; May(5)=pos4, Jun(6)=pos5 → cola.
  // parto = concepción + 9: Ene→Oct(10), Feb→Nov(11), Mar→Dic(12), Abr→Ene(1), May→Feb(2), Jun→Mar(3).
  assert.equal(calvingStageForBirth(sm, 10), 'head'); // Ene
  assert.equal(calvingStageForBirth(sm, 11), 'head'); // Feb
  assert.equal(calvingStageForBirth(sm, 12), 'body'); // Mar
  assert.equal(calvingStageForBirth(sm, 1), 'body'); // Abr
  assert.equal(calvingStageForBirth(sm, 2), 'tail'); // May
  assert.equal(calvingStageForBirth(sm, 3), 'tail'); // Jun
});

test('calvingStageForBirth: 4 meses {3,4,5,6} → split entero 1/1/2 (cabeza/cuerpo/cola)', () => {
  // headEnd=floor(4/3)=1, bodyEnd=floor(8/3)=2. pos0 cabeza, pos1 cuerpo, pos2/3 cola.
  const sm = [3, 4, 5, 6];
  // concepción Mar=pos0, Abr=pos1, May=pos2, Jun=pos3.
  // parto: Mar→Dic(12), Abr→Ene(1), May→Feb(2), Jun→Mar(3).
  assert.equal(calvingStageForBirth(sm, 12), 'head'); // Mar
  assert.equal(calvingStageForBirth(sm, 1), 'body'); // Abr
  assert.equal(calvingStageForBirth(sm, 2), 'tail'); // May
  assert.equal(calvingStageForBirth(sm, 3), 'tail'); // Jun
});

// ─── calvingStageForBirth: concepción fuera de la ventana → null ─────────────────────────────────────

test('calvingStageForBirth: nacimiento cuyo mes de concepción NO cae en service_months → null', () => {
  // servicio Oct/Nov/Dic; un parto en Marzo (3) concibió en Junio (6), que NO está en {10,11,12} → null.
  assert.equal(calvingStageForBirth([10, 11, 12], 3), null);
});

test('calvingStageForBirth: orden del array de entrada no importa (se ordena por servicio)', () => {
  // Mismo conjunto, distinto orden de entrada → mismo resultado.
  assert.equal(calvingStageForBirth([12, 10, 11], 7), 'head'); // concibió Oct
  assert.equal(calvingStageForBirth([10, 11, 12], 7), 'head');
});
