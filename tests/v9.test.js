/* v9 regression checks: node tests/v9.test.js  (no dependencies; loads the engine straight out of index.html) */
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const pick = tag => { const m = html.match(new RegExp('/\\*' + tag + '-BEGIN\\*/([\\s\\S]*?)/\\*' + tag + '-END\\*/')); if (!m) throw new Error(tag + ' block missing'); return m[1]; };
const V9E = new Function(pick('V9E') + ';return V9E')(), V9M = new Function(pick('V9M') + ';return V9M')(), NX = new Function(pick('NX') + ';return NX')();
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
/* 2026-10-19 bull-nose axial chip thinning and hyperMILL multipliers */
{ const m = V9E.mults({ D: 12, R: 2, ae: 6, ap: 0.5, fz: 0.1, iso: 'P2' });
  near(m.kappaDeg, Math.acos(1.5 / 2) * 180 / Math.PI, 1e-9, 'bull: κ = arccos((R − ap)/R)');
  near(m.sAx, 2 / Math.sqrt(2 * 2 * 0.5 - 0.25), 1e-9, 'bull: s_axial = R / √(2·R·ap − ap²)');
  near(m.sRad, 1, 1e-9, 'bull: ae ≥ ½ cutting Ø → no radial thinning');
  near(m.Dc, 12 - 4 + 2 * Math.sqrt(4 - 2.25), 1e-9, 'bull: cutting Ø on the corner arc');
  near(m.hex, 0.1 / m.sAx, 1e-9, 'bull: h_ex = fz · sin κ');
  near(m.rampDeg, 3, 0, 'ramp angle P'); near(V9E.rampDeg('M'), 1.5, 0, 'ramp angle M'); near(V9E.rampDeg('N1'), 5, 0, 'ramp angle N');
  near(V9E.mults({ D: 12, R: 2, ae: 6, ap: 3 }).sAx, 1, 0, 'bull: ap ≥ R → no axial thinning');
  const c = V9E.mults({ D: 12, R: 2, ae: 0.6, ap: 0.3 }); ok(c.capped && Math.abs(c.sTot - V9E.K.cthMax) < 1e-9, 'bull: combined held at the cap');
  near(V9E.mults({ D: 10, ball: true, ae: 0.2, ap: 0.2, tilt: 15 }).sAx, 10 / (10 * Math.sin((15 + Math.acos(0.96) * 180 / Math.PI) * Math.PI / 180)), 1e-9, 'ball: tilt reduces axial thinning');
  const r2 = V9E.calc({ D: 12, z: 4, Vc: 150, fz: 0.3, ae: 6, ap: 0.5, cornerR: 2, op: 'rough', iso: 'P2', kc11: 2100, mc: 0.25, nmax: 12000, eta: 0.8, tool: { type: 'end_mill_square', material: 'carbide' }, spindleKw: 15 });
  near(r2.hex, 0.3 / r2.mx.sAx, 1e-9, 'calc: h_ex uses the corner-arc κ'); near(r2.loadPct, 100 * r2.Pc / 15, 1e-9, 'calc: spindle load %');
  const T = { material_tool_baselines: [{ material: '', group_id: 'P2', tool_family: 'BX', band_id: 'B1', Vc_base: 150, fz_base: 0.1, fz_unit: 'per_tooth', is_active: true }], diameter_bands: [{ band_id: 'B1', label: '10–16', lo_mm: 10, hi_mm: 16 }],
    profile_op: [{ profile_id: 'HF', op_class: 'rough', Vc_mult: 1, fz_mult: 1, ae_ratio: 0.5, ap_ratio: 0.04 }], cycle_map: [], operations: [] };
  const rec = V9E.recommend(T, { material: 'X', iso: 'P2', family: 'BX', type: 'end_mill_square', D: 12, z: 4, op: 'rough', profile: 'HF', R: 2, ldTier: 1 });
  near(rec.fz, 0.1 * V9E.cthAx(0.48, 2), 1e-9, 'recommend: bull-nose starting fz includes axial thinning'); }
/* 2026-10-19 ap axis: Vc × / fz × at min / max ap multiply the ae values, ×1 at the start ap */
{ const po = { Vc_mult: 1.1, fz_mult: 1, ae_min: 0.05, ae_max: 0.1, ap_min: 0.5, ap_max: 2, ap_ratio: 1, Vc_mult_aplo: 1.2, fz_mult_aplo: 1.1, Vc_mult_aphi: 0.9, fz_mult_aphi: 0.8 };
  near(V9E.range(po).apNom, 1, 1e-9, 'ap: start');
  near(V9E.rangeAt(po, 0.075, 1).vc, 1.1, 1e-9, 'ap: ×1 at the start ap');
  near(V9E.rangeAt(po, 0.075, 0.5).fz, 1.1, 1e-9, 'ap: fz at min ap'); near(V9E.rangeAt(po, 0.075, 2).vc, 1.1 * 0.9, 1e-9, 'ap: Vc at max ap × ae value');
  near(V9E.rangeAt(po, 0.075, 1.5).apFz, 0.9, 1e-9, 'ap: straight line'); ok(V9E.rangeAt(po, 0.075, 3).apAbove && Math.abs(V9E.rangeAt(po, 0.075, 3).apFz - 0.8) < 1e-9, 'ap: held and flagged above max');
  near(V9E.rangeAt({ ap_min: 2, ap_max: 1.5, fz_mult_aplo: 2 }, NaN, 1).apFz, 1, 0, 'ap: min > max is ignored');
  near(V9E.range({ ap_min: 0.5, ap_max: 1.5 }).apNom, 1, 1e-9, 'ap: blank start = middle'); }
/* 2026-10-19 sub-cycle values per ISO group / material: material › group › all, field by field */
{ const rows = [{ profile_id: 'PX', op_class: 'rough', Vc_mult: 1, fz_mult: 1, ae_ratio: 0.1, ap_ratio: 1 },
    { profile_id: 'PX', op_class: 'rough', scope: '@M', Vc_mult: 0.8, ae_ratio: '' }, { profile_id: 'PX', op_class: 'rough', scope: 'SS 316', fz_mult: 0.9 }];
  const g = V9E.poFor(rows, 'PX', 'rough', 'SS 304', 'M'), m = V9E.poFor(rows, 'PX', 'rough', 'SS 316', 'M'), p = V9E.poFor(rows, 'PX', 'rough', 'EN8', 'P1');
  ok(g.Vc_mult === 0.8 && g.fz_mult === 1 && g.ae_ratio === 0.1, 'scope: ISO group overrides only its filled fields');
  ok(m.Vc_mult === 0.8 && m.fz_mult === 0.9 && m._layers.join() === '@M,SS 316', 'scope: material on top of its group');
  ok(p.Vc_mult === 1 && !p._layers.length, 'scope: other groups use the standard row');
  const T = { material_tool_baselines: [{ material: '', group_id: 'M', tool_family: 'BX', band_id: 'B1', Vc_base: 100, fz_base: 0.05, fz_unit: 'per_tooth', is_active: true }], diameter_bands: [{ band_id: 'B1', label: '6–10', lo_mm: 6, hi_mm: 10 }], profile_op: rows, cycle_map: [], operations: [] };
  near(V9E.recommend(T, { material: 'SS 316', iso: 'M', family: 'BX', type: 'end_mill_square', D: 10, z: 4, op: 'rough', profile: 'PX', ldTier: 1 }).Vc, 80, 1e-9, 'scope: recommend uses the group Vc ×'); }
/* 2026-10-20 new workflow: operations, engagement lists, pass tables, limits as information, default formulas */
{ const rows = [{ profile_id: 'E.wall', op_class: 'finish', Vc_mult: 1, fz_mult: 1, ae_ratio: 0.1, ap_ratio: 1 },
    { profile_id: 'E.wall', op_class: 'finish', scope: 'SS 316|SS13-8PH H950', fz_mult: 0.8 }, { profile_id: 'E.wall', op_class: 'finish', scope: '@N1', Vc_mult: 1.5 }];
  ok(NX.engFor(rows, 'E.wall', 'finish', 'SS13-8PH H950', 'H1').fz_mult === 0.8, 'engagement: one row covers materials from two ISO groups');
  ok(NX.engFor(rows, 'E.wall', 'finish', 'AL 6082', 'N1').Vc_mult === 1.5 && NX.engFor(rows, 'E.wall', 'finish', 'EN8', 'P1').fz_mult === 1, 'engagement: group row and default');
  const op = { key: 'wall', cat: 'contour', name: 'Wall milling', styles: [] }, rough = { key: 'troch', cat: 'rough' }, drill = { key: 'drill', cat: 'holes', cls: 'drill' };
  ok(NX.clsOf(op, 'semi') === 'semi' && NX.clsOf(rough, 'finish') === 'rough' && NX.clsOf(drill, 'finish') === 'drill', 'pass: roughing and holes have no pass selector');
  const T = { material_tool_baselines: [{ material: '', group_id: 'M', tool_family: 'BX', band_id: 'B1', Vc_base: 100, fz_base: 0.05, fz_unit: 'per_tooth', is_active: true }, { material: '', group_id: 'P1', tool_family: 'BX', band_id: 'B1', Vc_base: 200, fz_base: 0.05, fz_unit: 'per_tooth', is_active: true }],
    diameter_bands: [{ band_id: 'B1', label: '6–10', lo_mm: 6, hi_mm: 10, rigidity_ap_max_ratio: 0.5 }], profile_op: rows, cycle_map: [], operations: [], pass_mult: [{ tool_family: 'BX', pass: 'finish', Vc_mult: 1.2, fz_mult: 0.5 }] };
  const r = NX.recommend(V9E, T, { op: Object.assign({ prof: '' }, op), pass: 'finish', material: '', iso: 'P1', family: 'BX', type: 'end_mill_square', D: 10, z: 4 });
  near(r.Vc, 240, 1e-9, 'group only: the group base × pass Vc'); near(r.ap, 10, 1e-9, 'limits are information only (ap not capped to 0.5×Ø)'); ok(r.warn.length === 1, 'the cap is reported');
  near(r.fz, 0.05 * 0.5 * V9E.cthRad(1, 10), 1e-9, 'chip thinning always on, after the pass fz ×');
  const sp = NX.speeds(V9E, { D: 10, z: 2, type: 'end_mill_ball', Vc: 100, fz: 0.1, ap: 0.5, tilt: 0 }); near(sp.Dc, 2 * Math.sqrt(0.5 * 9.5), 1e-9, 'ball nose: cutting Ø at ap');
  ok(NX.speeds(V9E, { D: 10, z: 2, type: 'end_mill_ball', Vc: 100, fz: 0.1, ap: 0.5, tilt: 15 }).Dc > sp.Dc, 'ball nose: tilt raises the cutting Ø');
  near(NX.speeds(V9E, { D: 6, z: 1, type: 'tap', tap: true, pitch: 1, Vc: 10, fz: 0 }).vf, 10000 / (Math.PI * 6), 1e-9, 'tap: feed = pitch × rpm');
  near(NX.speeds(V9E, { D: 8, z: 3, circ: true, Dh: 12, Vc: 100, fz: 0.05 }).vf / NX.speeds(V9E, { D: 8, z: 3, Vc: 100, fz: 0.05 }).vf, 4 / 12, 1e-9, 'thread mill: arc correction internal');
  ok(NX.speeds(V9E, { D: 1, z: 2, Vc: 150, fz: 0.01, nmax: 12000 }).warn, 'rpm over the machine only warns');
  const b = NX.build({ profile_op: [{ profile_id: 'P09', op_class: 'finish', Vc_mult: 0.95 }], multiplier_profiles: [] });
  ok(b.ops.length > 30 && b.legacy['contouring.spiral'].style === 'spiral' && b.profile_op.some(x => x.profile_id === 'E.wall/full-flute' && x.Vc_mult === 0.95), 'migration: operations, styles and engagement copies'); }
/* 2026-10-20 recalculation and logged-cut nudges */
{ const ops = NX.build({ profile_op: [], multiplier_profiles: [] }).ops;
  const r = NX.recalc({ ops, profile_op: [], pass_mult: [], material_tool_baselines: [{ tool_family: 'CD', fz_unit: 'per_tooth', fz_base: 0.2, band_id: 'B06' }, { tool_family: 'BN', fz_unit: 'per_tooth', fz_base: 0.054, band_id: 'B06' }] });
  ok(r.material_tool_baselines[0].fz_unit === 'per_rev', 'recalc: drill feeds are per rev'); near(r.material_tool_baselines[1].fz_base, 0.019, 1e-9, 'recalc: ball-nose chip back to catalogue level');
  const tr = (sc, k) => r.profile_op.find(x => x.profile_id === 'E.trochoidal' && x.scope === sc)[k];
  ok(tr('@M|@S1|@S2|@H1|@H2', 'ap_ratio') === 1.5 && tr('@N1|@N2|@PL', 'ap_ratio') === 3, 'recalc: trochoidal ap 1.5×Ø stainless / hardened, 3×Ø aluminium');
  ok(NX.engFor(r.profile_op, 'E.trochoidal', 'rough', 'SS13-8PH H950', 'H1').ap_ratio === 1.5, 'recalc: 13-8PH (H1) takes the hard values');
  ok(r.pass_mult.some(x => x.tool_family === 'BX' && x.pass === 'finish' && x.Vc_mult === 1.1 && x.fz_mult === 0.8), 'recalc: pass tables per family');
  const T = { ops, profile_op: r.profile_op, pass_mult: r.pass_mult, material_tool_baselines: [{ baseline_id: 'X1', material: '', group_id: 'P1', tool_family: 'BX', band_id: 'B1', Vc_base: 100, fz_base: 0.05, fz_unit: 'per_tooth', is_active: true }],
    diameter_bands: [{ band_id: 'B1', label: '6–12', lo_mm: 6, hi_mm: 12 }], cycle_map: [], operations: [] };
  const tl = () => ({ D: 10, z: 4, type: 'end_mill_square', family: 'BX', fluteL: 25, R: 0 }), op = ops.find(o => o.key === 'traditional');
  const base = NX.recommend(V9E, T, { op, pass: 'rough', material: '', iso: 'P1', family: 'BX', type: 'end_mill_square', D: 10, z: 4, flute: 25 });
  const cut = k => ({ id: 'c' + k, result: 'Good', nxOp: 'traditional', nxGrp: 'P1', tool: 'T', vc: base.Vc * 1.2, fz: base.fz, doc: base.ap, woc: base.ae });
  const nd = NX.nudges(V9E, T, [cut(1), cut(2)], tl, () => 'P1');
  near(nd.X1.vc, 1 + 0.5 * 0.2, 1e-6, 'nudge: two cuts pull Vc half way'); near(nd.X1.fz, 1, 1e-6, 'nudge: same chip, no fz change');
  const nd2 = NX.nudges(V9E, T, [Object.assign(cut(3), { vc: base.Vc * 3 }), Object.assign(cut(4), { vc: base.Vc * 3 }), Object.assign(cut(5), { vc: base.Vc * 3, result: 'Bad' })], tl, () => 'P1');
  near(nd2.X1.vc, 1.25, 1e-9, 'nudge: held at +25 %'); ok(nd2.X1.n === 2, 'nudge: Bad cuts are left out');
  const wn = NX.recommend(V9E, T, { op, pass: 'rough', material: '', iso: 'P1', family: 'BX', type: 'end_mill_square', D: 10, z: 4, flute: 25, nudge: nd });
  near(wn.Vc, base.Vc * 1.1, 1e-9, 'nudge: applied in the recommendation'); near(wn.VcCat, base.Vc, 1e-9, 'nudge: catalogue value kept alongside'); }
/* 2026-10-20 roughing and finishing bases */
{ const rows = [{ baseline_id: 'A', material: '', group_id: 'P1', tool_family: 'BX', band_id: 'B1', Vc_base: 100, fz_base: 0.05, fz_unit: 'per_tooth', is_active: true },
    { baseline_id: 'B', material: '', group_id: 'P1', tool_family: 'BN', band_id: 'B1', Vc_base: 110, fz_base: 0.02, fz_unit: 'per_tooth', is_active: true }];
  const pm = [{ tool_family: 'BX', pass: 'finish', Vc_mult: 1.1, fz_mult: 0.8 }, { tool_family: 'BN', pass: 'finish', Vc_mult: 1.1, fz_mult: 0.9 }, { tool_family: 'BX', pass: 'semi', Vc_mult: 1.05, fz_mult: 0.9 }];
  let sp = NX.splitRows(rows, pm, 'BX'); sp = NX.splitRows(sp, pm, 'BN');
  ok(sp.length === 4 && sp.filter(r => r.pass === 'finish').length === 2, 'split: one roughing and one finishing row per range');
  near(sp.find(r => r.tool_family === 'BX' && r.pass === 'finish').Vc_base, 110, 1e-9, 'split: end-mill finishing = roughing × pass table');
  near(sp.find(r => r.tool_family === 'BN' && r.pass === 'rough').Vc_base, 100, 1e-9, 'split: ball-nose roughing = finishing ÷ pass table');
  const ops = NX.build({ profile_op: [], multiplier_profiles: [] }).ops, op = ops.find(o => o.key === 'wall'), T = { ops, profile_op: [{ profile_id: 'E.wall', op_class: 'finish', ae_ratio: .5, ap_ratio: 1 }, { profile_id: 'E.wall', op_class: 'semi', ae_ratio: .5, ap_ratio: 1 }], pass_mult: pm,
    material_tool_baselines: sp.map(r => Object.assign({}, r, r.pass === 'finish' && r.tool_family === 'BX' ? { Vc_base: 150 } : {})), diameter_bands: [{ band_id: 'B1', label: '6–12', lo_mm: 6, hi_mm: 12 }], cycle_map: [], operations: [] };
  const q = pass => ({ op, pass, material: '', iso: 'P1', family: 'BX', type: 'end_mill_square', D: 10, z: 4, flute: 25 });
  near(NX.recommend(V9E, T, q('finish')).Vc, 150, 1e-9, 'finish uses the finishing base, pass table not applied');
  near(NX.recommend(V9E, T, q('semi')).Vc, 105, 1e-9, 'semi uses the roughing base × the semi pass table');
  near(NX.recommend(V9E, T, q('rough')).Vc, 100, 1e-9, 'rough uses the roughing base'); }
console.log(bad ? `${bad} of ${n} checks failed` : `all ${n} checks passed`); process.exit(bad ? 1 : 0);
