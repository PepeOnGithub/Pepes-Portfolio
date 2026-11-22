/* JSON UI interpreter for the customizer's HUD preview.
   Runs Minecraft Bedrock's own UI files: the vanilla HUD (assets/ui/vanilla.json, built from Mojang's bedrock-samples by
   tools/build_ui_bundle.py) with Pepe's packs stacked on top (assets/ui/pack-<id>@<ver>.json), the way the game stacks
   resource packs. It merges same-named elements, applies "modifications", resolves @inheritance, $variables (with
   |default and "variables"/"requires"), global variables, factories and collections, evaluates global / collection /
   view bindings with their expressions, lays everything out (size and offset units, anchors, stack panels, grids,
   min/max size, layers, clipping) and draws images (uv, nine-slice, tint, tiling) and labels (§ formatting, shadow).
   Engine-coded renderers (hearts, hotbar items, entity renderers ...) are handed to hooks supplied by the caller. */
(function () {
  'use strict';

  const BASE = 'assets/ui/';
  const ANCH = { top_left: [0, 0], top_middle: [0.5, 0], top_right: [1, 0], left_middle: [0, 0.5], center: [0.5, 0.5],
    right_middle: [1, 0.5], bottom_left: [0, 1], bottom_middle: [0.5, 1], bottom_right: [1, 1] };
  const MC = { 0: '#000000', 1: '#0000aa', 2: '#00aa00', 3: '#00aaaa', 4: '#aa0000', 5: '#aa00aa', 6: '#ffaa00', 7: '#aaaaaa',
    8: '#555555', 9: '#5555ff', a: '#55ff55', b: '#55ffff', c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff', g: '#ddd605',
    h: '#e3d4d1', i: '#cecaca', j: '#443a3b', m: '#971607', n: '#b4684d', p: '#deb12d', q: '#47a036', s: '#2cbaa8', t: '#21497b',
    u: '#9a5cc6', v: '#eb7114' };
  // Minecraft font advance widths (glyph + 1px spacing); everything else is 6
  const ADV = { ' ': 4, '!': 2, '"': 4, "'": 2, '(': 4, ')': 4, '*': 4, ',': 2, '.': 2, ':': 2, ';': 2, '<': 5, '>': 5, '@': 7,
    I: 4, '[': 4, ']': 4, '`': 3, f: 5, i: 2, k: 5, l: 3, t: 4, '{': 4, '|': 2, '}': 4, '~': 7 };
  const LINE = 10;
  const GLYPH = 9;                                   // a glyph-page character (U+E000-U+F8FF) draws as a 9px square
  const isGlyph = (c) => { const n = c.codePointAt(0); return n >= 0xe000 && n <= 0xf8ff; };
  const adv = (c) => (isGlyph(c) ? GLYPH + 1 : ADV[c] || 6);

  const fetchJson = (u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
  const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

  /* ---------- program: merged element definitions from every bundle ---------- */
  function splitKey(key, ns) {
    const at = key.indexOf('@');
    if (at < 0) return { name: key, base: null };
    const base = key.slice(at + 1), dot = base.lastIndexOf('.');
    return { name: key.slice(0, at), base: dot < 0 ? { ns, name: base, raw: base } : { ns: base.slice(0, dot), name: base.slice(dot + 1), raw: base } };
  }

  function Program() {
    this.defs = {};          // ns -> name -> {base, props, mods: [...]}
    this.paths = {};         // ns -> element -> [{path: [child, ...], props, mods}]  ("element/child" keys)
    this.globals = {};
    this.nine = {};
    this.sources = [];
  }
  Program.prototype.add = function (bundle, label) {
    this.memo = null;
    if (!bundle) return;
    this.sources.push(label);
    Object.assign(this.globals, bundle.globals || {});
    Object.assign(this.nine, bundle.nineslice || {});
    for (const [ns, elems] of Object.entries(bundle.namespaces || {})) {
      const space = this.defs[ns] || (this.defs[ns] = {});
      for (const [key, def] of Object.entries(elems)) {
        if (!isObj(def)) continue;
        const { name, base } = splitKey(key, ns);
        const props = clone(def), mods = props.modifications || [];
        delete props.modifications;
        if (name.includes('/')) {
          // "element/child/grandchild" patches a control nested inside an element
          const [head, ...path] = name.split('/');
          ((this.paths[ns] || (this.paths[ns] = {}))[head] || (this.paths[ns][head] = [])).push({ path, props, mods });
          continue;
        }
        const prev = space[name];
        if (!prev) { space[name] = { base, props, mods: [...mods], from: label }; continue; }
        // a later pack defining the same element merges into it, its properties win; modifications stack up
        prev.props = Object.assign(prev.props, props);
        if (base) prev.base = base;
        prev.mods.push(...mods);
      }
    }
  };
  Program.prototype.lookup = function (ns, name) { return (this.defs[ns] || {})[name]; };

  // the element's own properties over its base chain, with the modifications applied
  Program.prototype.resolve = function (ns, name, depth = 0) {
    const memo = this.memo || (this.memo = new Map()), key = ns + '\u0000' + name;
    if (memo.has(key)) return memo.get(key);
    const r = this.resolveNow(ns, name, depth);
    if (depth === 0 || r) memo.set(key, r);
    return r;
  };
  Program.prototype.resolveNow = function (ns, name, depth) {
    const d = this.lookup(ns, name);
    if (!d || depth > 40) return null;
    let props = {};
    if (d.base && !String(d.base.raw).startsWith('$')) {
      const b = this.resolve(d.base.ns, d.base.name, depth + 1);
      if (b) props = b.props;
    }
    props = Object.assign(clone(props), clone(d.props));
    applyMods(props, d.mods);
    for (const patch of (this.paths[ns] || {})[name] || []) patchPath(props, patch);
    return { props, ns };
  };

  function patchPath(props, { path, props: over, mods }) {
    let target = props;
    for (const step of path) {
      const entry = (target.controls || []).find((e) => isObj(e) && childName(e) === step);
      if (!entry) return;
      const key = Object.keys(entry)[0];
      target = entry[key] || (entry[key] = {});
    }
    Object.assign(target, clone(over));
    applyMods(target, mods);
  }

  function childName(entry) { const k = Object.keys(entry)[0]; return k.split('@')[0]; }
  function applyMods(props, mods) {
    for (const m of mods || []) {
      const arr = props[m.array_name] || (props[m.array_name] = []);
      const value = clone(m.value) || [];
      const vals = Array.isArray(value) ? value : [value];
      const at = () => arr.findIndex((e) => (isObj(e) ? (m.array_name === 'controls' ? childName(e) === m.control_name : e.binding_name === m.where?.binding_name) : false));
      switch (m.operation) {
        case 'insert_front': arr.unshift(...vals); break;
        case 'insert_back': arr.push(...vals); break;
        case 'insert_after': { const i = at(); arr.splice(i < 0 ? arr.length : i + 1, 0, ...vals); break; }
        case 'insert_before': { const i = at(); arr.splice(i < 0 ? 0 : i, 0, ...vals); break; }
        case 'remove': {
          if (m.control_name) { const i = at(); if (i >= 0) arr.splice(i, 1); }
          else if (m.where) { for (let i = arr.length - 1; i >= 0; i -= 1) if (Object.entries(m.where).every(([k, v]) => arr[i][k] === v)) arr.splice(i, 1); }
          break;
        }
        case 'replace': { const i = at(); if (i >= 0) arr.splice(i, 1, ...vals); break; }
        case 'move_front': case 'move_back': case 'move_after': case 'move_before': {
          const i = at(); if (i < 0) break;
          const [e] = arr.splice(i, 1);
          if (m.operation === 'move_front') arr.unshift(e); else arr.push(e);
          break;
        }
        default: break;
      }
    }
  }

  /* ---------- expressions (requires, view bindings) ---------- */
  const tokCache = new Map();
  function tokenize(src) {
    let t = tokCache.get(src);
    if (t) return t;
    t = tokenizeNow(src);
    if (tokCache.size > 5000) tokCache.clear();
    tokCache.set(src, t);
    return t;
  }
  function tokenizeNow(src) {
    const t = [], re = /\s*(?:(\d+(?:\.\d+)?)|'([^']*)'|"([^"]*)"|([#$][\w|.]+)|(<=|>=|!=|=|<|>|\+|-|\*|\/|%|\(|\))|([A-Za-z_]\w*))/y;
    let m;
    re.lastIndex = 0;
    while (re.lastIndex < src.length && (m = re.exec(src))) {
      if (m[1] != null) t.push({ k: 'n', v: parseFloat(m[1]) });
      else if (m[2] != null || m[3] != null) t.push({ k: 's', v: m[2] ?? m[3] });
      else if (m[4] != null) t.push({ k: 'id', v: m[4] });
      else if (m[5] != null) t.push({ k: 'op', v: m[5] });
      else t.push({ k: 'w', v: m[6].toLowerCase() });
      if (!/\S/.test(src.slice(re.lastIndex))) break;
    }
    return t;
  }
  // strings count as their leading number, the way the game reads "12, 64, -30" as 12
  const num = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return +v;
    if (v === '' || v == null) return 0;
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  };
  // printf-style left operand: '%.3s' * text keeps 3 characters, '%d' / '%.2f' format numbers
  function format(fmt, v) {
    const m = /^%(\.(\d+))?([sdf])$/.exec(fmt);
    if (!m) return fmt + String(v);
    if (m[3] === 's') return m[2] != null ? String(v ?? '').slice(0, +m[2]) : String(v ?? '');
    if (m[3] === 'd') return String(Math.trunc(num(v)));
    return num(v).toFixed(m[2] != null ? +m[2] : 6);
  }
  const truthy = (v) => !(v === false || v === 0 || v === '' || v == null || v === 'false');
  function evaluate(src, get) {
    if (typeof src !== 'string') return src;
    const toks = tokenize(src); let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    const isW = (w) => peek() && peek().k === 'w' && peek().v === w;
    const isOp = (o) => peek() && peek().k === 'op' && peek().v === o;
    function primary() {
      const t = next();
      if (!t) return '';
      if (t.k === 'n' || t.k === 's') return t.v;
      if (t.k === 'id') return get(t.v);
      if (t.k === 'op' && t.v === '(') {
        let v = or(); if (isOp(')')) next();
        // a bracket that yields "#name" reads that property: ('#k' + #item_id_aux) looks up a property_bag entry
        if (typeof v === 'string' && /^#\w+$/.test(v)) v = get(v) ?? '';
        return v;
      }
      if (t.k === 'op' && t.v === '-') return -num(unary());
      if (t.k === 'w' && (t.v === 'true' || t.v === 'false')) return t.v === 'true';
      return t.v;
    }
    function unary() { if (isW('not')) { next(); return !truthy(unary()); } return primary(); }
    function mul() {
      let v = unary();
      while (isOp('*') || isOp('/') || isOp('%')) {
        const o = next().v, rv = unary();
        if (o === '*' && typeof v === 'string' && v.startsWith('%')) { v = format(v, rv); continue; }
        const r = num(rv), l = num(v);
        const ints = Number.isInteger(l) && Number.isInteger(r);
        v = o === '*' ? l * r : o === '%' ? (r ? l % r : 0) : (r ? (ints ? Math.trunc(l / r) : l / r) : 0);
      }
      return v;
    }
    function add() {
      let v = mul();
      while (isOp('+') || isOp('-')) {
        const o = next().v, r = mul();
        if (o === '+' && (typeof v === 'string' || typeof r === 'string')) v = String(v ?? '') + String(r ?? '');
        else if (o === '-' && typeof v === 'string' && typeof r === 'string' && !(/^\s*-?\d/.test(v) && /^\s*-?\d/.test(r) && !Number.isNaN(+v) && !Number.isNaN(+r))) v = r ? v.split(r).join('') : v;   // removes every occurrence
        else v = o === '+' ? num(v) + num(r) : num(v) - num(r);
      }
      return v;
    }
    function cmp() {
      let v = add();
      while (isOp('=') || isOp('!=') || isOp('<') || isOp('>') || isOp('<=') || isOp('>=')) {
        const o = next().v, r = add();
        const both = typeof v !== 'string' || typeof r !== 'string' ? [num(v), num(r)] : [v, r];
        if (o === '=') v = typeof v === 'string' && typeof r === 'string' ? v === r : num(v) === num(r);
        else if (o === '!=') v = typeof v === 'string' && typeof r === 'string' ? v !== r : num(v) !== num(r);
        else v = o === '<' ? both[0] < both[1] : o === '>' ? both[0] > both[1] : o === '<=' ? both[0] <= both[1] : both[0] >= both[1];
      }
      return v;
    }
    function and() { let v = cmp(); while (isW('and')) { next(); const r = cmp(); v = truthy(v) && truthy(r); } return v; }
    function or() { let v = and(); while (isW('or')) { next(); const r = and(); v = truthy(v) || truthy(r); } return v; }
    try { return or(); } catch (e) { return ''; }
  }

  /* ---------- instantiation: variables, controls, factories, collections ---------- */
  function Node(name, props, vars, parent) {
    this.name = name; this.p = props; this.vars = vars; this.parent = parent; this.kids = []; this.b = {};
    this.type = props.type || 'panel';
  }

  function substitute(v, vars) {
    if (typeof v === 'string') {
      if (v.startsWith('$') && v in vars) return substitute(vars[v], vars);
      return v;
    }
    // copy on change: values without a $variable come back as the same object, so big tables (property bags,
    // binding lists) are shared between every control that uses them instead of copied per control
    if (Array.isArray(v)) {
      let out = null;
      for (let i = 0; i < v.length; i += 1) { const x = substitute(v[i], vars); if (x !== v[i]) { if (!out) out = v.slice(0, i); } if (out) out.push(x); }
      return out || v;
    }
    if (isObj(v)) {
      let out = null;
      for (const k in v) { const x = substitute(v[k], vars); if (x !== v[k] && !out) out = Object.assign({}, v); if (out) out[k] = x; }
      return out || v;
    }
    return v;
  }

  function scopeVars(props, inherited) {
    const vars = Object.create(inherited);            // inherits by prototype: no per-control copy of every global
    // definition / reference values override what the parent passed; |default only fills gaps
    for (const [k, v] of Object.entries(props)) if (k.startsWith('$') && !k.includes('|')) vars[k] = substitute(v, inherited);
    for (const [k, v] of Object.entries(props)) {
      if (!k.endsWith('|default')) continue;
      const n = k.slice(0, -8);
      if (!(n in vars)) vars[n] = substitute(v, vars);
    }
    for (const block of props.variables || []) {
      if (!isObj(block)) continue;
      if (block.requires != null && !truthy(evaluate(substitute(block.requires, vars), (id) => vars[id]))) continue;
      // within a block, |default keys only fill gaps (and go first, since the other keys may name them)
      for (const [k, v] of Object.entries(block)) if (k.endsWith('|default') && !(k.slice(0, -8) in vars)) vars[k.slice(0, -8)] = substitute(v, vars);
      for (const [k, v] of Object.entries(block)) if (k.startsWith('$') && !k.includes('|')) vars[k] = substitute(v, vars);
    }
    return vars;
  }

  function Instancer(prog, data) { this.prog = prog; this.data = data; this.count = 0; this.unknown = new Set(); }

  Instancer.prototype.make = function (name, props, inherited, parent, ns, ctx) {
    if (++this.count > 6000) return null;
    const vars = scopeVars(props, inherited);
    const p = {};
    for (const [k, v] of Object.entries(props)) if (!k.startsWith('$') && k !== 'variables' && k !== 'controls') p[k] = substitute(v, vars);
    for (const k of ['ignored', 'visible', 'enabled']) if (typeof p[k] === 'string' && /[($ ]/.test(p[k]) && !p[k].startsWith('#')) p[k] = truthy(evaluate(p[k], (id) => vars[id]));
    if (typeof p.alpha === 'string' && p.alpha.startsWith('@')) p.alpha = 1;            // animated alpha: shown fully faded in
    if (p.ignored === true || p.ignored === 'true') return null;
    if (name.startsWith('$')) name = String(substitute(name, vars));
    const node = new Node(name, p, vars, parent);
    node.ns = ns; node.ci = ctx.ci; node.coll = ctx.coll;
    // the $variables that place or show this control (followed through $a -> $b chains), so a page can tell which setting
    // a box on screen belongs to
    const uses = new Set();
    const follow = (v, depth) => {
      if (depth > 8) return;
      if (typeof v === 'string' && v.startsWith('$')) { uses.add(v); if (v in vars) follow(vars[v], depth + 1); }
      else if (Array.isArray(v)) v.forEach((x) => follow(x, depth + 1));
    };
    for (const k of ['anchor_from', 'anchor_to', 'offset', 'alpha', 'ignored', 'visible']) if (k in props) follow(props[k], 0);
    for (const k of Object.keys(props)) if (k.startsWith('$') && typeof props[k] === 'string' && props[k].startsWith('$')) follow(props[k], 0);
    node.uses = uses;
    if (p.collection_index != null) node.ci = num(p.collection_index);
    if (p.collection_name) node.coll = p.collection_name;
    if (isObj(p.property_bag)) Object.assign(node.b, p.property_bag);     // shallow: bag values are read, never changed
    const kctx = { ci: node.ci, coll: node.coll };
    for (const entry of props.controls || []) {
      if (!isObj(entry)) continue;
      const key = Object.keys(entry)[0];
      const child = this.child(key, entry[key], vars, node, ns, kctx);
      if (child) node.kids.push(child);
    }
    this.expand(node, vars, ns);
    if (node.type === 'button' || node.type === 'toggle') {
      const states = ['hover_control', 'pressed_control', 'locked_control', 'checked_hover_control', 'unchecked_hover_control',
        'checked_locked_control', 'unchecked_locked_control', 'checked_locked_hover_control', 'unchecked_locked_hover_control'];
      const off = new Set(states.map((k) => p[k]).filter(Boolean));
      if (node.type === 'toggle') off.add(p.checked_control);
      node.kids = node.kids.filter((k) => !off.has(k.name));
    }
    return node;
  };

  Instancer.prototype.child = function (key, over, vars, parent, ns, ctx) {
    let { name, base } = splitKey(key, ns);
    let props = {}, cns = ns;
    if (base) {
      let raw = base.raw;
      if (raw.startsWith('$')) raw = String(substitute(raw, scopeVars(over || {}, vars)) || '');
      const dot = raw.lastIndexOf('.');
      const bns = dot < 0 ? ns : raw.slice(0, dot), bname = dot < 0 ? raw : raw.slice(dot + 1);
      const r = this.prog.resolve(bns, bname);
      if (!r) return null;
      props = r.props; cns = bns;
    }
    let merged;
    if (over && over.modifications) { merged = Object.assign(clone(props), clone(over)); applyMods(merged, over.modifications); }
    else merged = over ? Object.assign({}, props, over) : props;
    return this.make(name, merged, vars, parent, cns, ctx);
  };

  // grids over a collection repeat their template; factories create the controls the game would spawn
  Instancer.prototype.expand = function (node, vars, ns) {
    const p = node.p;
    if (node.type === 'grid' && p.grid_item_template) {
      const coll = p.collection_name || node.coll;
      let dims = p.grid_dimensions;
      const dimName = p.grid_dimension_binding || (p.bindings || []).find((b) => b.binding_name?.endsWith('grid_dimensions'))?.binding_name;
      if (dimName) dims = this.data.global(dimName, node) || dims;
      const items = this.data.collection(coll) || [];
      const [cols, rows] = Array.isArray(dims) ? dims.map(num) : [items.length || 1, 1];
      const count = Math.min(p.maximum_grid_items ? num(p.maximum_grid_items) : cols * rows, cols * rows, 200);
      node.grid = [cols, rows];
      for (let i = 0; i < count; i += 1) {
        const k = this.child(`${p.grid_item_template.split('.').pop()}${i}@${p.grid_item_template}`, { collection_index: i }, vars, node, ns, { ci: i, coll });
        if (k) node.kids.push(k);
      }
    }
    if (isObj(p.factory) || node.type === 'factory') {
      // factory spec either nested ("factory": {name, control_ids}) or on the element itself (type "factory")
      const f = isObj(p.factory) ? p.factory : { name: node.name, control_ids: p.control_ids, control_name: p.control_name };
      const want = this.data.factory(f.name, node) || this.data.factory(node.name, node);
      const ids = f.control_ids || (f.control_name ? { [f.name]: f.control_name } : {});
      for (const id of want || []) {
        const ref = ids[id] || (id === f.name ? f.control_name : null);
        if (!ref) continue;
        const key = ref.startsWith('@') ? id + ref : ref.includes('@') ? ref : `${id}@${ref}`;
        const k = this.child(key, {}, vars, node, ns, { ci: node.ci, coll: node.coll });
        if (k) node.kids.push(k);
      }
    }
  };

  /* ---------- bindings ---------- */
  function bindTree(node, data, unknown) {
    // data bindings (global / collection) first, then view bindings, which may read them in any order
    const list = (node.p.bindings || []).filter(isObj);
    const kind = (b) => b.binding_type || (b.binding_collection_name ? 'collection' : (b.source_property_name != null ? 'view' : 'global'));
    for (const b of list) {
      const type = kind(b);
      if (type !== 'global' && type !== 'collection') continue;
      const name = b.binding_name;
      if (!name || typeof name !== 'string' || name.startsWith('$')) continue;
      let v;
      if (type === 'collection') v = data.item(b.binding_collection_name || node.coll, node.ci, name);
      else if (/^\(|\s(and|or)\s|^not\s/.test(name.trim())) {
        // a binding name can be an expression over global bindings
        v = evaluate(name, (id) => { const g = id.startsWith('$') ? node.vars[id] : data.global(id, node); if (g === undefined) unknown.add(id); return g === undefined ? '' : g; });
      } else v = data.global(name, node);
      if (v === undefined) {
        unknown.add(name);
        if ((b.binding_name_override || name) === '#visible') node.b['#visible'] = false;
        continue;
      }
      node.b[b.binding_name_override || name] = v;
    }
    node.views = list.filter((b) => kind(b) === 'view');
    for (const k of node.kids) bindTree(k, data, unknown);
  }

  // view bindings run after every data binding in the tree, twice so chains settle (the game re-evaluates each frame)
  function runViews(node, data, unknown) {
    for (const b of node.views || []) {
      const src = b.source_control_name ? findSource(node, b.source_control_name) : node;
      const getter = (id) => {
        if (id.startsWith('$')) return node.vars[id] ?? '';
        if (src && id in src.b) return src.b[id];
        if (id in node.b) return node.b[id];
        const g = data.global(id, node);
        if (g === undefined) unknown.add(id);
        return g === undefined ? '' : g;
      };
      const sp = b.source_property_name;
      let v = typeof sp === 'string' && /^#[\w]+$/.test(sp.trim()) ? getter(sp.trim()) : evaluate(String(sp), getter);
      if (typeof v === 'string' && /^-?\d+(\.\d+)?(,|$)/.test(v)) v = num(v);
      node.b[b.target_property_name || '#visible'] = v;
    }
    for (const k of node.kids) runViews(k, data, unknown);
  }
  // the game searches the control's own subtree first, then up through the ancestors' subtrees, never the control
  // asking (a view binding that names its own control reads a namesake elsewhere). indexTree gives every node its
  // preorder range, so "is c inside n's subtree" is two comparisons and each name keeps its nodes in preorder.
  function indexTree(tree) {
    const byName = new Map(); let i = 0;
    (function walk(n) {
      n.pre = i++;
      const list = byName.get(n.name); if (list) list.push(n); else byName.set(n.name, [n]);
      for (const k of n.kids) walk(k);
      n.end = i;
    })(tree);
    return byName;
  }
  let nameIndex = null;
  function findSource(node, name) {
    const list = nameIndex && nameIndex.get(name);
    if (!list) return null;
    for (let n = node; n; n = n.parent) {
      for (const c of list) if (c !== node && c.pre >= n.pre && c.pre < n.end) return c;
    }
    return null;
  }

  // resolves a property value that may name a binding ("#text") or come from a binding override
  function prop(node, key, fallback) {
    if (('#' + key) in node.b) return node.b['#' + key];
    let v = node.p[key];
    if (typeof v === 'string' && v.startsWith('#')) v = v in node.b ? node.b[v] : (fallback !== undefined ? fallback : v);
    return v === undefined ? fallback : v;
  }

  /* ---------- layout ---------- */
  const termCache = new Map();
  function terms(v) {
    if (typeof v === 'number') return [{ n: v, u: 'px' }];
    if (typeof v !== 'string') return [{ n: 100, u: '%' }];
    let t = termCache.get(v);
    if (!t) { t = termsNow(v); if (termCache.size > 2000) termCache.clear(); termCache.set(v, t); }
    return t;
  }
  function termsNow(v) {
    const s = v.replace(/\s+/g, '');
    if (s === 'default') return [{ u: 'default' }];
    if (s === 'fill') return [{ u: 'fill' }];
    const out = []; const re = /([+-]?)(\d*\.?\d+)(%cm|%sm|%c|%x|%y|%|px)?/g; let m;
    while ((m = re.exec(s))) out.push({ n: (m[1] === '-' ? -1 : 1) * parseFloat(m[2]), u: m[3] || 'px' });
    return out.length ? out : [{ n: 0, u: 'px' }];
  }
  const hasChildUnit = (t) => t.some((x) => x.u === '%c' || x.u === '%cm');
  const visibleNode = (n) => truthy(prop(n, 'visible', true));

  function Layout(tex, fonts) { this.tex = tex; this.fonts = fonts; }

  Layout.prototype.textSize = function (node) {
    const text = String(prop(node, 'text', '') ?? '');
    const scale = num(prop(node, 'font_scale_factor', 1)) || 1;
    const lines = plain(text).split('\n');
    const w = Math.max(...lines.map((l) => [...l].reduce((a, c) => a + adv(c), 0))) - (lines[0] ? 1 : 0);
    return [Math.max(0, w) * scale, lines.length * LINE * scale - (scale > 1 ? 0 : 1)];
  };
  Layout.prototype.defaultSize = function (node) {
    if (node.type === 'label') return this.textSize(node);
    if (node.type === 'image') {
      const uvs = prop(node, 'uv_size'); if (Array.isArray(uvs)) return uvs.map(num);
      const t = this.tex(texPath(prop(node, 'texture', '')));
      return t ? [t.w, t.h] : [0, 0];
    }
    return null;
  };

  Layout.prototype.axis = function (node, i, pw, ph, own, kidsExt, sibMax) {
    const sz = prop(node, 'size', node.type === 'label' || node.type === 'image' ? ['default', 'default'] : ['100%', '100%']);
    const v = Array.isArray(sz) ? sz[i] : sz;
    const ts = terms(v);
    const parent = i ? ph : pw;
    let total = 0;
    for (const t of ts) {
      if (t.u === 'px') total += t.n;
      else if (t.u === '%') total += parent * t.n / 100;
      else if (t.u === '%c') total += (kidsExt ? kidsExt.sum[i] : 0) * t.n / 100;
      else if (t.u === '%cm') total += (kidsExt ? kidsExt.max[i] : 0) * t.n / 100;
      else if (t.u === '%sm') total += (sibMax ? sibMax[i] : 0) * t.n / 100;
      else if (t.u === '%x') total += (own[0] || 0) * t.n / 100;
      else if (t.u === '%y') total += (own[1] || 0) * t.n / 100;
      else if (t.u === 'default') { const d = this.defaultSize(node); total += d ? d[i] : parent; }
      else if (t.u === 'fill') total += node.fill?.[i] ?? parent;
    }
    const lim = (k, f) => { const L = prop(node, k); if (!Array.isArray(L)) return null; const tt = terms(L[i]);
      if (tt.some((t) => t.u === 'default' || t.u === 'fill')) return null; return tt.reduce((a, t) => a + (t.u === '%' ? parent * t.n / 100 : t.u === '%c' ? (kidsExt ? kidsExt.sum[i] : 0) * t.n / 100 : t.u === '%cm' ? (kidsExt ? kidsExt.max[i] : 0) * t.n / 100 : t.n || 0), 0); };
    const mn = lim('min_size'), mx = lim('max_size');
    if (mx != null) total = Math.min(total, mx);
    if (mn != null) total = Math.max(total, mn);
    return Math.max(0, total);
  };

  // sizes every node; children with % sizes use the parent's size, parents sized by %c wait for their children
  Layout.prototype.size = function (node, pw, ph, sibMax) {
    // a node's subtree only changes through its own size() call, so when the inputs equal its last call's the
    // whole subtree is already sized: %c parents size their children twice and nested ones would otherwise
    // redo every level below them again and again
    const key = pw + '|' + ph + '|' + (sibMax ? sibMax[0] + ',' + sibMax[1] : '') + '|' + (node.fill ? node.fill[0] + ',' + node.fill[1] : '');
    if (node.sk === key) return;
    this.sizeNow(node, pw, ph, sibMax);
    node.sk = key;
  };
  Layout.prototype.sizeNow = function (node, pw, ph, sibMax) {
    if (!visibleNode(node)) { node.w = node.h = 0; node.hidden = true; return; }
    node.hidden = false;
    const sz = prop(node, 'size', null);
    const tx = terms(Array.isArray(sz) ? sz[0] : sz ?? (node.type === 'label' || node.type === 'image' ? 'default' : '100%'));
    const ty = terms(Array.isArray(sz) ? sz[1] : sz ?? (node.type === 'label' || node.type === 'image' ? 'default' : '100%'));
    const needKids = hasChildUnit(tx) || hasChildUnit(ty);
    let w = this.axis(node, 0, pw, ph, [], null, sibMax), h = this.axis(node, 1, pw, ph, [w, 0], null, sibMax);
    if (tx.some((t) => t.u === '%y')) w = this.axis(node, 0, pw, ph, [w, h], null, sibMax);
    node.w = w; node.h = h;
    this.sizeKids(node);
    if (node.type === 'grid' && node.grid && sz == null) {
      // a grid without a size takes its cells' size times its dimensions
      const ext = this.extents(node);
      node.w = ext.sum[0]; node.h = ext.sum[1];
      this.sizeKids(node);
    }
    if (needKids) {
      const ext = this.extents(node);
      node.w = this.axis(node, 0, pw, ph, [w, h], ext, sibMax);
      node.h = this.axis(node, 1, pw, ph, [node.w, h], ext, sibMax);
      this.sizeKids(node);
    }
  };
  // whether a control's size uses %sm / fill, worked out once per control
  function sizeHas(k, what) {
    if (!k.sizeFlags) { const j = JSON.stringify(prop(k, 'size', '')); k.sizeFlags = { sm: /%sm/.test(j), fill: /fill/.test(j) }; }
    return k.sizeFlags[what];
  }
  Layout.prototype.sizeKids = function (node) {
    const kids = node.kids;
    const stack = node.type === 'stack_panel';
    const vert = (prop(node, 'orientation', 'vertical')) === 'vertical';
    if (node.type === 'grid' && node.grid) {
      const [cols, rows] = node.grid;
      kids.forEach((k) => this.size(k, node.w / cols, node.h / rows));
      return;
    }
    // first pass to know sibling max (%sm) and the space "fill" children share
    kids.forEach((k) => { k.fill = null; this.size(k, node.w, node.h); });
    const sib = [Math.max(0, ...kids.map((k) => k.w)), Math.max(0, ...kids.map((k) => k.h))];
    if (kids.some((k) => sizeHas(k, 'sm'))) kids.forEach((k) => this.size(k, node.w, node.h, sib));
    if (stack) {
      const ax = vert ? 1 : 0;
      const fills = kids.filter((k) => !k.hidden && terms((prop(k, 'size') || [])[ax]).some((t) => t.u === 'fill'));
      if (fills.length) {
        const used = kids.filter((k) => !k.hidden && !fills.includes(k)).reduce((a, k) => a + (ax ? k.h : k.w), 0);
        const each = Math.max(0, ((ax ? node.h : node.w) - used) / fills.length);
        fills.forEach((k) => { k.fill = ax ? [node.w, each] : [each, node.h]; this.size(k, node.w, node.h); });
      }
    } else {
      // "fill" outside stacks takes the parent's remaining size
      kids.forEach((k) => { if (sizeHas(k, 'fill')) { k.fill = [node.w, node.h]; this.size(k, node.w, node.h); } });
    }
  };
  Layout.prototype.extents = function (node) {
    const vis = node.kids.filter((k) => !k.hidden);
    const max = [Math.max(0, ...vis.map((k) => k.w)), Math.max(0, ...vis.map((k) => k.h))];
    if (node.type === 'stack_panel') {
      const vert = prop(node, 'orientation', 'vertical') === 'vertical';
      const sum = vert ? [max[0], vis.reduce((a, k) => a + k.h, 0)] : [vis.reduce((a, k) => a + k.w, 0), max[1]];
      return { sum, max };
    }
    if (node.type === 'grid' && node.grid) {
      const [cols, rows] = node.grid;
      return { sum: [max[0] * cols, max[1] * rows], max };
    }
    return { sum: max, max };
  };

  function offsetPx(v, pw, ph) {
    if (!Array.isArray(v)) return [0, 0];
    return [0, 1].map((i) => terms(v[i] ?? 0).reduce((a, t) => a + (t.u === '%' ? (i ? ph : pw) * t.n / 100 : t.u === 'px' ? t.n : 0), 0));
  }

  Layout.prototype.place = function (node, x, y, z) {
    node.x = x; node.y = y; node.z = z;
    const kids = node.kids.filter((k) => !k.hidden);
    const stack = node.type === 'stack_panel', vert = prop(node, 'orientation', 'vertical') === 'vertical';
    let cursor = 0;
    kids.forEach((k, i) => {
      const off = offsetPx(prop(k, 'offset', [0, 0]), node.w, node.h);
      const from = ANCH[prop(k, 'anchor_from', 'center')] || ANCH.center, to = ANCH[prop(k, 'anchor_to', 'center')] || ANCH.center;
      let kx = node.x + from[0] * node.w - to[0] * k.w + off[0];
      let ky = node.y + from[1] * node.h - to[1] * k.h + off[1];
      if (node.type === 'grid' && node.grid) {
        const cols = node.grid[0], cw = node.w / node.grid[0], ch = node.h / node.grid[1];
        kx = node.x + (i % cols) * cw + off[0]; ky = node.y + Math.floor(i / cols) * ch + off[1];
      } else if (stack) {
        // stack children ignore their anchors: they line up along the stack from its start edge
        if (vert) { ky = node.y + cursor + off[1]; kx = node.x + off[0]; cursor += k.h; } else { kx = node.x + cursor + off[0]; ky = node.y + off[1]; cursor += k.w; }
      }
      this.place(k, kx, ky, z + num(prop(k, 'layer', 0)));
    });
  };

  /* ---------- drawing ---------- */
  const texPath = (t) => (typeof t === 'string' ? t.replace(/\.(png|tga|jpg)$/i, '') : '');
  function plain(s) { return String(s).replace(/§./g, ''); }
  function rgb(c, fallback) {
    if (Array.isArray(c)) return c.map((x) => Math.round(Math.max(0, Math.min(1, num(x))) * 255));
    if (typeof c === 'string' && c.startsWith('#') && c.length >= 7) { const n = parseInt(c.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    if (typeof c === 'string' && MC[c.replace('§', '')]) return rgb(MC[c.replace('§', '')]);
    return fallback;
  }
  const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const shadowOf = (c) => c.map((v) => Math.floor(v / 4));

  function richText(text, base) {
    const frag = document.createDocumentFragment();
    let color = base, bold = false, italic = false, buf = '';
    const flush = () => {
      if (!buf) return;
      const s = document.createElement('span');
      s.textContent = buf; s.style.color = css(color);
      if (bold) s.style.fontWeight = '700';
      if (italic) s.style.fontStyle = 'italic';
      s.style.setProperty('--sh', css(shadowOf(color)));
      frag.append(s); buf = '';
    };
    const str = String(text);
    const glyph = (c) => {
      // font/glyph_XX.png: 16x16 cells, XX is the high byte of the code point
      flush();
      const n = c.codePointAt(0), page = (n >> 8).toString(16).toUpperCase(), cell = n & 255;
      const g = document.createElement('span');
      g.className = 'czu-glyph';
      // cells draw 1:1; the glyph's line box is the cell's rows 4-12 (Food Stats+ shanks sit there, native 9x9)
      Object.assign(g.style, { width: GLYPH + 'px', height: GLYPH + 'px', backgroundImage: `url("${BASE}tex/font/glyph_${page}.png")`,
        backgroundSize: '256px 256px', backgroundPosition: `${-(cell % 16) * 16}px ${-(Math.floor(cell / 16) * 16 + 4)}px` });
      frag.append(g);
    };
    for (let i = 0; i < str.length; i += 1) {
      if (isGlyph(str[i])) { glyph(str[i]); continue; }
      if (str[i] === '§' && i + 1 < str.length) {
        flush(); const c = str[i + 1].toLowerCase(); i += 1;
        if (MC[c]) { color = rgb(MC[c]); bold = italic = false; } else if (c === 'l') bold = true; else if (c === 'o') italic = true; else if (c === 'r') { color = base; bold = italic = false; }
        continue;
      }
      buf += str[i];
    }
    flush();
    return frag;
  }

  function Renderer(prog, texCache, hooks) { this.prog = prog; this.tex = texCache; this.hooks = hooks || {}; }

  Renderer.prototype.draw = function (node, host, alphaIn) {
    if (node.hidden) return;
    const a = num(prop(node, 'alpha', 1));
    const propagate = truthy(prop(node, 'propagate_alpha', false));
    let el = null;
    const box = (cls) => {
      const d = document.createElement('div');
      d.className = cls;
      Object.assign(d.style, { left: node.x + 'px', top: node.y + 'px', width: node.w + 'px', height: node.h + 'px', zIndex: String(Math.round(node.z)) });
      d.dataset.ui = node.name;
      return d;
    };
    if (node.type === 'image') {
      const path = texPath(prop(node, 'texture', ''));
      if (path) { el = box('czu-img'); this.paintImage(el, node, path); el.style.opacity = String(a * alphaIn); }
    } else if (node.type === 'label') {
      const text = prop(node, 'text', '');
      if (text !== '' && text != null) {
        el = box('czu-label');
        const color = rgb(prop(node, 'color', [1, 1, 1]), [255, 255, 255]);
        const scale = num(prop(node, 'font_scale_factor', 1)) || 1;
        const align = prop(node, 'text_alignment', 'left');
        el.style.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
        el.style.fontSize = 8 * scale + 'px'; el.style.lineHeight = LINE * scale + 'px';
        if (truthy(prop(node, 'shadow', false))) el.classList.add('czu-shadow');
        el.append(richText(String(text).replace(/%%/g, '%'), color));
        el.style.opacity = String(a * alphaIn);
      }
    } else if (node.type === 'custom') {
      const fn = this.hooks[node.name] || this.hooks['renderer:' + prop(node, 'renderer', '')];
      if (fn) { el = box('czu-custom'); const r = fn(node, el); if (r === false) el = null; }
    }
    if (el && node.type === 'image') {
      // clip_ratio is the fraction cut away; clip_direction names the side the image keeps
      const r = prop(node, 'clip_ratio');
      if (r != null && r !== '') {
        const keep = Math.max(0, Math.min(1, 1 - num(r))), dir = prop(node, 'clip_direction', 'left');
        const horiz = dir === 'left' || dir === 'right';
        const full = horiz ? node.w : node.h, vis = full * keep;
        const st = el.style;
        if (!st.borderImage) st.backgroundSize = `${node.w}px ${node.h}px`;
        if (horiz) { st.width = vis + 'px'; if (dir === 'right') { st.left = node.x + full - vis + 'px'; st.backgroundPosition = `${vis - full}px 0`; } }
        else { st.height = vis + 'px'; if (dir === 'down') { st.top = node.y + full - vis + 'px'; st.backgroundPosition = `0 ${vis - full}px`; } }
      }
    }
    if (el) host.append(el);
    if (truthy(prop(node, 'clips_children', false))) {
      const clip = box('czu-clip'); host.append(clip);
      const inner = document.createElement('div');
      Object.assign(inner.style, { position: 'absolute', left: -node.x + 'px', top: -node.y + 'px' });
      clip.append(inner); host = inner;
    }
    const childAlpha = propagate ? a * alphaIn : alphaIn;
    for (const k of node.kids) this.draw(k, host, childAlpha);
  };

  Renderer.prototype.paintImage = function (el, node, path) {
    const t = this.tex.get(path), url = this.tex.url(path);
    const nine = this.prog.nine[path] || {};
    const ns = prop(node, 'nineslice_size', nine.nineslice_size);
    const color = rgb(prop(node, 'color'), null);
    const tint = color && !(color[0] === 255 && color[1] === 255 && color[2] === 255);
    const s = el.style;
    const slices = ns == null ? null : (Array.isArray(ns) ? (ns.length === 4 ? ns : [ns[0], ns[1], ns[0], ns[1]]) : [ns, ns, ns, ns]).map(num);
    // slices that leave no middle (a 2x2 texture cut at 1px) render nothing as border-image: stretch it instead
    const hollow = slices && t && (t.w - slices[0] - slices[2] <= 0 || t.h - slices[1] - slices[3] <= 0);
    if (slices && !tint && !hollow) {
      const [l, tp, r, b] = slices;
      s.borderStyle = 'solid'; s.borderWidth = `${tp}px ${r}px ${b}px ${l}px`;
      s.borderImage = `url("${url}") ${tp} ${r} ${b} ${l} fill / ${tp}px ${r}px ${b}px ${l}px stretch`;
      s.boxSizing = 'border-box';
      return;
    }
    const uv = prop(node, 'uv'), uvs = prop(node, 'uv_size');
    if (Array.isArray(uv) && Array.isArray(uvs) && t) {
      const kx = node.w / num(uvs[0]), ky = node.h / num(uvs[1]);
      s.backgroundImage = `url("${url}")`;
      s.backgroundSize = `${t.w * kx}px ${t.h * ky}px`;
      s.backgroundPosition = `${-num(uv[0]) * kx}px ${-num(uv[1]) * ky}px`;
    } else if (truthy(prop(node, 'tiled', false)) && t) {
      s.backgroundImage = `url("${url}")`; s.backgroundSize = `${t.w}px ${t.h}px`; s.backgroundRepeat = 'repeat';
    } else {
      s.backgroundImage = `url("${url}")`; s.backgroundSize = '100% 100%';
    }
    if (tint) {
      s.backgroundColor = css(color); s.backgroundBlendMode = 'multiply';
      s.webkitMaskImage = s.maskImage = s.backgroundImage;
      s.webkitMaskSize = s.maskSize = s.backgroundSize;
      s.webkitMaskPosition = s.maskPosition = s.backgroundPosition || '0 0';
      s.webkitMaskRepeat = s.maskRepeat = s.backgroundRepeat || 'no-repeat';
    }
    if (!s.backgroundRepeat) s.backgroundRepeat = 'no-repeat';
  };

  /* ---------- textures ---------- */
  function TexCache(onLoad) { this.map = new Map(); this.onLoad = onLoad; }
  TexCache.prototype.url = (path) => BASE + 'tex/' + encodeURI(path) + '.png';
  TexCache.prototype.get = function (path) {
    if (!path) return null;
    let e = this.map.get(path);
    if (!e) {
      e = { w: 0, h: 0, ok: false };
      this.map.set(path, e);
      const im = new Image();
      im.onload = () => { e.w = im.naturalWidth; e.h = im.naturalHeight; e.ok = true; this.onLoad && this.onLoad(path); };
      im.onerror = () => { e.bad = true; };
      im.src = this.url(path);
    }
    return e.ok ? e : null;
  };

  /* ---------- public API ---------- */
  const bundles = new Map();
  const loadBundle = (file) => { if (!bundles.has(file)) bundles.set(file, fetchJson(BASE + file)); return bundles.get(file); };

  async function program(packs) {
    const prog = new Program();
    // every bundle downloads at once; they are still added in pack order, since later packs override earlier ones
    const all = await Promise.all([loadBundle('vanilla.json'), ...packs.map(([id, ver]) => loadBundle(`pack-${id}@${ver}.json`))]);
    prog.add(all[0], 'vanilla');
    packs.forEach(([id, ver], i) => prog.add(all[i + 1], `${id}@${ver}`));
    return prog;
  }

  /* data: {global(name, node), collection(name), item(coll, index, name), factory(name, node) -> [control ids]}
     vars: extra global variables (customizer settings) applied over the packs' _global_variables.json */
  function run(prog, opts) {
    const { root = ['hud', 'hud_content'], width, height, vars = {}, data, hooks, texCache } = opts;
    const r = prog.resolve(root[0], root[1]);
    if (!r) return null;
    const base = Object.assign(Object.create(null), prog.globals, vars);
    for (const [k, v] of Object.entries(base)) if (k.endsWith('|default')) { const n = k.slice(0, -8); if (!(n in base)) base[n] = v; }
    const inst = new Instancer(prog, data);
    const tree = inst.make(root[1], r.props, base, null, root[0], { ci: 0, coll: null });
    if (!tree) return null;
    tree.p.size = [width, height];
    const unknown = new Set();
    bindTree(tree, data, unknown);
    nameIndex = indexTree(tree);
    runViews(tree, data, unknown);
    runViews(tree, data, unknown);
    const lay = new Layout((p) => texCache.get(p));
    lay.size(tree, width, height);
    lay.place(tree, 0, 0, 0);
    return { tree, unknown, nodes: inst.count, draw: (host) => new Renderer(prog, texCache, hooks).draw(tree, host, 1) };
  }

  // walk helpers for hooks and debugging
  function find(tree, pred) { const out = []; const w = (n) => { if (pred(n)) out.push(n); n.kids.forEach(w); }; if (tree) w(tree); return out; }

  window.CzUI = { program, run, find, evaluate, prop, TexCache, plain, textWidth: (s) => [...plain(s)].reduce((a, c) => a + adv(c), 0) - 1 };
})();
