/* v9 regression checks: node tests/v9.test.js  (no dependencies; loads the engine straight out of index.html) */
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const pick = tag => { const m = html.match(new RegExp('/\\*' + tag + '-BEGIN\\*/([\\s\\S]*?)/\\*' + tag + '-END\\*/')); if (!m) throw new Error(tag + ' block missing'); return m[1]; };
const V9E = new Function(pick('V9E') + ';return V9E')(), V9M = new Function(pick('V9M') + ';return V9M')();
let n = 0, bad = 0; const near = (a, b, tol, msg) => { n++; if (!(Math.abs(a - b) <= tol)) { bad++; console.log('FAIL', msg, a, '≠', b); } };
const ok = (c, msg) => { n++; if (!c) { bad++; console.log('FAIL', msg); } };
/* 4.3 chip thinning: ae 5 % → 2.29; clamp reached near 4.2 % */
near(V9E.cthRad(0.5, 10), 2.294, 0.002, 'CTh at 5 %');
near(V9E.cthRad(5, 10), 1, 1e-9, 'CTh at 50 %');
/* 4.1 Kienzle mean chip thickness: full slot hm = 2fz/π */
near(V9E.hm(0.1, 10, 10, Math.PI / 2), 0.2 / Math.PI, 1e-6, 'hm full slot');
near(V9E.ks(2000, 0.25, 1, 0), 2000, 1e-9, 'Ks at h = 1 mm equals kc1.1');
/* 4.9b stepped stiffness reduces to the uniform case */
const E = 600e3, I = d => Math.PI * d ** 4 / 64;
near(V9E.beam([[0, 40, 8]], E, 14.5e-6, 0).k, 3 * E * I(8) / 40 ** 3, 1e-6, 'uniform k');
near(V9E.beam([[0, 20, 2.8], [20, 30, 6]], E, 14.5e-6, 0).k, 3 * E / ((30 ** 3 - 20 ** 3) / I(6) + 20 ** 3 / I(2.8)), 1e-6, 'stepped k (v8.1 §4.9 formula)');
/* 4.9c Rayleigh mass of a uniform beam = 33/140 m */
const ub = V9E.beam([[0, 40, 8]], E, 14.5e-6, 0); near(ub.m / (14.5e-6 * Math.PI * 16 * 40), 33 / 140, 0.003, 'uniform m_eq 33/140');
/* 4.6 power: ap 10, ae 5, Vf 1000, Ks 2000, η 0.8 → 2.08 kW */
near(10 * 5 * 1000 * 2000 / (60e6 * 0.8), 2.083, 0.001, 'power constant');
/* 4.9d two-mass: very stiff spindle → tool mode equals the tool alone */
const tm = V9E.twoMass(1e9, 900, 5, 0.002); near(tm[0].f, Math.sqrt(5e3 / 0.002) / (2 * Math.PI), 1, 'two-mass tool mode');
/* a full calculation runs and lands in range for a Ø10 × 35 mm end mill in P2 steel */
const r = V9E.calc({ D: 10, z: 4, Vc: 120, fz: 0.05, ae: 1, ap: 15, op: 'rough', iso: 'P2', kc11: 2100, mc: 0.25, nmax: 12000, stick: 35, eta: 0.8,
  tool: { type: 'end_mill_square', material: 'carbide', fluteL: 25, shankD: 10 }, spindle: { k: 50e6, f: 900, zeta: 0.04 }, holderType: 'Shrink Fit', VcBase: 120 });
ok(r.inRange && r.aLim > 0 && r.Pc > 0 && r.pockets.length >= 0 && Math.abs(r.life - 1) < 1e-9, 'Ø10 calc in range');
near(r.n, 3820, 1, 'RPM');
/* rules grammar */
ok(V9E.evalExpr("iso in ('S1','S2') and coolant in ('dry','mql')", { iso: 'S1', coolant: 'MQL' }), 'rule in/and');
ok(!V9E.evalExpr("Pc > 0.8 * spindle_kw", { Pc: 5 }), 'unknown var is false');
ok(V9E.evalExpr("not work_hardening or hrc > 35", { work_hardening: false }), 'not/or');
/* migration rules all parse */
const mig = V9M.build({ L: { materials: [], tools: [], cycles: [], baseline: [], bands: [], matbands: [] } });
mig.tables.rules_engine.forEach(x => { try { V9E.evalExpr(x.trigger_expression, {}); n++; } catch (e) { bad++; console.log('FAIL rule', x.strategy_code, e.message); } });
/* 2026-10-19 sub-cycle ae / ap ranges: multipliers slide along the ae range, hold at the ends, ap max caps the start */
{ const po = { Vc_mult: 1, fz_mult: 1, ae_min: 0.05, ae_max: 0.1, ae_ratio: '', Vc_mult_lo: 1.2, Vc_mult_hi: 0.9, fz_mult_lo: 1.3, fz_mult_hi: 0.8, ap_min: 1, ap_max: 2, ap_ratio: 3 };
  const rg = V9E.range(po); near(rg.aeNom, 0.075, 1e-9, 'range: start is the middle when blank');
  near(V9E.rangeAt(po, 0.05).vc, 1.2, 1e-9, 'range: Vc at min ae'); near(V9E.rangeAt(po, 0.1).fz, 0.8, 1e-9, 'range: fz at max ae');
  near(V9E.rangeAt(po, 0.0625).vc, 1.1, 1e-9, 'range: straight line between min and start');
  near(V9E.rangeAt(po, 0.2).vc, 0.9, 1e-9, 'range: held at the end value'); ok(V9E.rangeAt(po, 0.2).above && V9E.rangeAt(po, 0.02).below, 'range: outside is flagged');
  near(V9E.rangeAt({ Vc_mult: 1.1, fz_mult: 0.9, ae_ratio: 0.3 }, 0.1).vc, 1.1, 1e-9, 'no range: flat multipliers');
  const T = { material_tool_baselines: [{ material: '', group_id: 'P1', tool_family: 'BX', band_id: 'B1', Vc_base: 100, fz_base: 0.05, fz_unit: 'per_tooth', is_active: true }], diameter_bands: [{ band_id: 'B1', label: '6–10', lo_mm: 6, hi_mm: 10 }],
    profile_op: [Object.assign({ profile_id: 'PX', op_class: 'rough' }, po)], cycle_map: [], operations: [] };
  const rec = V9E.recommend(T, { material: 'X', iso: 'P1', family: 'BX', type: 'end_mill_square', D: 10, z: 4, op: 'rough', profile: 'PX', ldTier: 1 });
  near(rec.ae, 0.75, 1e-9, 'range: recommended ae'); near(rec.ap, 20, 1e-9, 'range: ap held at ap max'); near(rec.Vc, 100, 1e-9, 'range: Vc at the start point (start ×1)'); }
console.log(bad ? `${bad} of ${n} checks failed` : `all ${n} checks passed`); process.exit(bad ? 1 : 0);
