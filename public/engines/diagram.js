// <sr-diagram> — STILL ROOM system & architecture engine. One JSON, two views: 2D block diagram and voxel isometric.
// JSON: { layout:'layered'|'grid'|'manual', nodes:[{id,kind,label,sub,state,fields,x,y}], links:[{from,to,kind,label}],
//        zones:[{label,kind,nodes:[ids]}], flows:[{path:[ids],packet,label}] }   type="sequence": { actors:[{id,kind,label}], messages:[{from,to,label,kind}] }
// Attributes: type (graph|sequence), view (2d|iso), data (JSON) or src (#id of a <script type=application/json>), opts (JSON), play (attr → animate flows).
// Rules: 24 px grid, radius 0, 2 px orthogonal edges, cube arrowheads, 7×7 glyphs, Silkscreen 9 labels, mono subs, steps-based motion, Reduce Motion → numbered static packets.
(() => {
  if (customElements.get('sr-diagram')) return;
  const C = { panel: '#2a2f45', tile: '#3a4162', well: '#0f111c', muted: '#5a627f', edge: '#0f111c', mid: '#414968', shade: '#1b1f30', light: '#56608a', text: '#f4efe6', text2: '#9aa0b8', accent: '#ff8a2a', glow: '#ffb545', aShade: '#b8501a', rival: '#3ab4ff', rGlow: '#9fdcff', rShade: '#1e6fc2', ok: '#3ddc84', warn: '#ffe05a', danger: '#ff4d4d', arcane: '#8c75fa', onAccent: '#1a1d2b' };
  const LIGHT = { panel: '#efe8d9', tile: '#faf6ec', well: '#ffffff', muted: '#cfc7b5', edge: '#1a1d2b', mid: '#b8ae98', shade: '#cfc7b5', light: '#ffffff', text: '#1a1d2b', text2: '#5b5e72', accent: '#ff8a2a', glow: '#ffb545', aShade: '#b8501a', rival: '#3ab4ff', rGlow: '#9fdcff', rShade: '#1e6fc2', ok: '#1f7a48', warn: '#8a6a00', danger: '#c2331f', arcane: '#6b52e0', onAccent: '#1a1d2b' };
  const NS = 'http://www.w3.org/2000/svg', GRID = 24, NW = 112, NH = 88, PROP_H = 60, GX = 72, GY = 28, PAD = 24;
  const el = (t, a = {}, ...k) => { const n = document.createElementNS(NS, t); for (const key in a) if (a[key] != null) n.setAttribute(key, a[key]); k.forEach(c => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)); return n; };
  const R = (x, y, w, h, fill, ex = {}) => el('rect', { x: Math.round(x), y: Math.round(y), width: Math.max(0, Math.round(w)), height: Math.max(0, Math.round(h)), fill, 'shape-rendering': 'crispEdges', ...ex });
  const TXT = (x, y, s, o = {}) => el('text', { x: Math.round(x), y: Math.round(y), fill: o.fill, 'font-family': o.mono ? '"Space Mono", monospace' : 'Silkscreen, monospace', 'font-size': o.size || 9, 'text-anchor': o.anchor || 'start', 'font-weight': o.bold ? 700 : 400, 'letter-spacing': o.mono ? 0 : .5 }, String(s));
  const P = (d, stroke, w = 2, ex = {}) => el('path', { d, fill: 'none', stroke, 'stroke-width': w, 'shape-rendering': 'crispEdges', ...ex });

  // ---------- 7×7 glyphs ----------
  const GL = {
    browser: ['#######', '#.#.###', '#######', '#.....#', '#.....#', '#.....#', '#######'], phone: ['.#####.', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.#.#.#.', '.#####.'], desktop: ['#######', '#.....#', '#.....#', '#######', '...#...', '..###..', '.#####.'], cli: ['#######', '#.....#', '#.#...#', '#..#..#', '#.#...#', '#.....#', '#######'],
    cdn: ['..###..', '.#...#.', '#..#..#', '#.###.#', '#..#..#', '.#...#.', '..###..'], dns: ['#.....#', '##...##', '#.#.#.#', '#..#..#', '#.....#', '#.....#', '#.....#'], gateway: ['..###..', '.#...#.', '#.....#', '#.###.#', '#.#.#.#', '#.#.#.#', '###.###'], lb: ['...#...', '..###..', '.#.#.#.', '#..#..#', '#..#..#', '#..#..#', '#..#..#'], webhook: ['#......', '##.....', '###....', '####...', '###....', '##.....', '#......'],
    service: ['#######', '#.....#', '#.###.#', '#.#.#.#', '#.###.#', '#.....#', '#######'], function: ['..####.', '.#.....', '.#.....', '#####..', '.#.....', '.#.....', '.#.....'], worker: ['###.###', '#.#.#.#', '###.###', '.......', '###.###', '#.#.#.#', '###.###'], cron: ['..###..', '.#...#.', '#..#..#', '#..##.#', '#.....#', '.#...#.', '..###..'], process: ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######'],
    queue: ['##.##.#', '##.##.#', '##.##.#', '##.##.#', '##.##.#', '##.##.#', '##.##.#'], stream: ['.......', '###.###', '.......', '###.###', '.......', '###.###', '.......'], cache: ['...##..', '..##...', '.####..', '...##..', '..##...', '.##....', '.......'],
    sql: ['.#####.', '#.....#', '.#####.', '#.....#', '.#####.', '#.....#', '.#####.'], nosql: ['#####..', '#...##.', '#...###', '#.....#', '#.....#', '#.....#', '#######'], vector: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'], search: ['.####..', '#....#.', '#....#.', '#....#.', '.####..', '....###', '......#'], storage: ['#######', '#.....#', '#######', '#.....#', '#######', '#.....#', '#######'], fs: ['.###...', '#...###', '#.....#', '#.....#', '#.....#', '#.....#', '#######'], table: ['#######', '#######', '#.#.#.#', '#######', '#.#.#.#', '#######', '#.#.#.#'],
    auth: ['..###..', '.#...#.', '.#...#.', '#######', '###.###', '###.###', '#######'], secrets: ['..##...', '.#..#..', '..##...', '...#...', '...##..', '...#...', '...##..'], config: ['...#...', '.#####.', '..#.#..', '#######', '..#.#..', '.#####.', '...#...'], monitor: ['.......', '......#', '....##.', '#..#...', '.##....', '#......', '#######'],
    llm: ['.#####.', '#.....#', '#.#.#.#', '#.....#', '#.###.#', '#.....#', '.#####.'], agent: ['..###..', '.#####.', '.#.#.#.', '.#####.', '..###..', '.#####.', '#######'], gpu: ['#######', '#.#.#.#', '#######', '#.#.#.#', '#######', '#.#.#.#', '#######'], external: ['#.#.#.#', '.......', '#.....#', '.......', '#.....#', '.......', '#.#.#.#'], human: ['..###..', '..###..', '...#...', '.#####.', '#..#..#', '..#.#..', '..#.#..'],
    state: ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'], start: ['..#....', '..##...', '..###..', '..####.', '..###..', '..##...', '..#....'], end: ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'], decision: ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'], doc: ['#####..', '#...##.', '#...###', '#.....#', '#.....#', '#.....#', '#######'],
  };
  // kind → family → colours + iso height (voxels)
  const FAM = {
    client: { kinds: ['browser', 'phone', 'desktop', 'cli', 'human'], fill: 'tile', glyph: 'text', edge: 'edge', h: 2 },
    edge: { kinds: ['cdn', 'dns', 'gateway', 'lb', 'webhook'], fill: 'panel', glyph: 'glow', edge: 'edge', h: 2 },
    compute: { kinds: ['service', 'function', 'worker', 'cron', 'process'], fill: 'panel', glyph: 'accent', edge: 'edge', h: 2 },
    data: { kinds: ['sql', 'nosql', 'vector', 'search', 'storage', 'fs', 'table', 'doc'], fill: 'well', glyph: 'rival', edge: 'rShade', h: 3 },
    messaging: { kinds: ['queue', 'stream'], fill: 'rShade', glyph: 'rGlow', edge: 'edge', h: 1, striped: true },
    cache: { kinds: ['cache'], fill: 'panel', glyph: 'glow', edge: 'glow', h: 1 },
    security: { kinds: ['auth', 'secrets', 'config'], fill: 'panel', glyph: 'warn', edge: 'edge', h: 2 },
    observe: { kinds: ['monitor'], fill: 'panel', glyph: 'ok', edge: 'edge', h: 2 },
    ai: { kinds: ['llm', 'agent', 'gpu'], fill: 'panel', glyph: 'arcane', edge: 'arcane', h: 3 },
    external: { kinds: ['external'], fill: 'well', glyph: 'text2', edge: 'mid', dashed: true, h: 1 },
    flow: { kinds: ['state', 'start', 'end', 'decision'], fill: 'panel', glyph: 'accent', edge: 'edge', h: 1 },
  };
  const famOf = k => Object.values(FAM).find(f => f.kinds.includes(k)) || FAM.compute;
  // link kinds → stroke pattern + rail height (iso) + default colour role
  const LK = { sync: { dash: null, w: 2, col: 'mid', rail: 0 }, async: { dash: '6 4', w: 2, col: 'rival', rail: 1 }, stream: { dash: '2 3', w: 2, col: 'rival', rail: 2 }, batch: { dash: null, w: 4, col: 'mid', rail: 0 }, replication: { dash: '8 4', w: 2, col: 'rShade', rail: 1 }, cacheHit: { dash: null, w: 2, col: 'glow', rail: 1 }, cacheMiss: { dash: '2 3', w: 2, col: 'glow', rail: 1 }, retry: { dash: '4 4', w: 2, col: 'warn', rail: 2 }, timeout: { dash: '2 6', w: 2, col: 'danger', rail: 2 }, failover: { dash: '6 4', w: 2, col: 'danger', rail: 3 }, talk: { dash: '4 2', w: 2, col: 'arcane', rail: 3 }, read: { dash: null, w: 2, col: 'rival', rail: 1 }, write: { dash: null, w: 2, col: 'accent', rail: 0 } };
  const PK = { json: 'stack', row: 'row', blob: 'blob', envelope: 'env', token: 'token', event: 'cube', error: 'error', request: 'cube', response: 'cube', file: 'blob' };
  const ZK = { region: 'mid', az: 'mid', vpc: 'rShade', trust: 'danger', tenant: 'arcane', team: 'accent', system: 'mid', boundary: 'text2' };
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const glyph = (g, name, x, y, cell, fill) => { const b = GL[name] || GL.process; b.forEach((row, r) => [...row].forEach((c, i) => { if (c === '#') g.appendChild(R(x + i * cell, y + r * cell, cell, cell, fill)); })); };
  const packet = (g, kind, x, y, T) => { // x,y = centre; 8-px cube grammar
    const k = PK[kind] || 'cube';
    if (k === 'stack') { g.appendChild(R(x - 5, y - 6, 10, 4, T.glow)); g.appendChild(R(x - 5, y - 1, 10, 3, T.accent)); g.appendChild(R(x - 5, y + 3, 10, 3, T.aShade)); }
    else if (k === 'row') { for (let i = 0; i < 3; i++) g.appendChild(R(x - 7 + i * 5, y - 3, 4, 6, i ? T.rival : T.rGlow)); }
    else if (k === 'blob') { g.appendChild(R(x - 5, y - 5, 10, 10, T.rShade)); g.appendChild(R(x - 3, y - 3, 4, 4, T.rGlow)); }
    else if (k === 'env') { g.appendChild(R(x - 6, y - 4, 12, 8, T.text)); g.appendChild(R(x - 6, y - 4, 12, 2, T.accent)); g.appendChild(R(x - 4, y, 8, 2, T.mid)); }
    else if (k === 'token') { g.appendChild(R(x - 7, y - 3, 4, 6, T.warn)); g.appendChild(R(x - 2, y - 3, 4, 6, T.warn)); g.appendChild(R(x + 3, y - 3, 4, 6, T.warn)); }
    else if (k === 'error') { g.appendChild(R(x - 4, y - 4, 8, 8, T.danger)); g.appendChild(R(x - 1, y - 2, 2, 3, T.onAccent)); g.appendChild(R(x - 1, y + 2, 2, 1, T.onAccent)); }
    else g.appendChild(R(x - 4, y - 4, 8, 8, T.accent));
  };

  const face = (g, pts, fill, ex = {}) => g.appendChild(el('path', { d: pts.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join('') + 'Z', fill, 'shape-rendering': 'crispEdges', ...ex }));
  const shade = (hex, k) => { if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex; const n = parseInt(hex.slice(1), 16); const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * k))), gg = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * k))), b = Math.min(255, Math.max(0, Math.round((n & 255) * k))); return '#' + [r, gg, b].map(v => v.toString(16).padStart(2, '0')).join(''); };
  // ---------- voxel props: [x, y, z, w, d, h, role] in voxel units; shared by 2D (mini-iso), iso and System 3D ----------
  const PROPS = {
    sql: [[0,0,0,6,6,2,'rShade'],[0,0,2,6,6,2,'rival'],[0,0,4,6,6,2,'rShade'],[1,1,6,4,4,1,'rGlow']],
    nosql: [[0,0,0,6,5,1,'rShade'],[.6,.6,1,6,5,1,'rival'],[1.2,1.2,2,6,5,1,'rShade'],[1.8,1.8,3,6,5,1,'rGlow']],
    doc: [[0,0,0,5,6,1,'rival'],[1,1,1,3,1,.6,'rGlow'],[1,2.5,1,3,1,.6,'rGlow'],[1,4,1,2,1,.6,'rGlow']],
    vector: [[1,1,0,4,4,4,'rShade'],[0,0,4,1,1,1,'rGlow'],[5,0,5,1,1,1,'rGlow'],[0,5,5,1,1,1,'rGlow'],[5,5,4,1,1,1,'rGlow'],[2.5,2.5,4,1,1,2,'rival']],
    search: [[0,0,0,5,5,1,'rShade'],[1,1,1,3,3,3,'rGlow'],[4.5,4.5,0,2,2,1,'rival'],[6,6,0,1.5,1.5,1,'rival']],
    storage: [[0,0,0,6,6,5,'well'],[0,0,3,6,6,1,'rival'],[1,1,5,4,4,.6,'rShade']],
    fs: [[0,0,0,7,5,1,'rShade'],[0,0,1,7,5,.6,'rival'],[0,0,1.6,3,5,.6,'rGlow']],
    table: [[0,0,0,7,5,1,'rShade'],[0,1.4,1,7,.5,.4,'rGlow'],[0,2.8,1,7,.5,.4,'rGlow'],[2.2,0,1,.5,5,.4,'rGlow'],[4.6,0,1,.5,5,.4,'rGlow']],
    service: [[0,0,0,6,4,6,'panel'],[.8,4,1,1,.4,1,'ok'],[2.4,4,1,1,.4,1,'accent'],[4,4,1,1,.4,1,'accent'],[.8,4,3.2,4.4,.4,.6,'mid'],[.8,4,4.6,4.4,.4,.6,'mid']],
    function: [[0,0,0,5,5,2,'panel'],[1,1,2,3,3,2,'accent'],[2,2,4,1,1,1,'glow']],
    worker: [[0,0,0,3,3,3,'panel'],[3.6,0,0,3,3,3,'panel'],[0,3.6,0,3,3,3,'panel'],[3.6,3.6,0,3,3,3,'accent']],
    cron: [[0,0,0,6,6,1,'panel'],[1,1,1,4,4,.6,'well'],[2.5,2.5,1.6,1,1,.6,'accent'],[2.5,1.4,1.6,1,1.4,.5,'glow'],[3.4,2.5,1.6,1.4,1,.5,'glow']],
    process: [[0,0,0,6,4,3,'panel'],[1,4,1,4,.4,1,'accent']],
    queue: [[0,0,0,8,3,1,'rShade'],[.6,.8,1,1.4,1.4,1.4,'rGlow'],[3.2,.8,1,1.4,1.4,1.4,'rGlow'],[5.8,.8,1,1.4,1.4,1.4,'rGlow'],[0,0,1,8,.4,.4,'rival'],[0,2.6,1,8,.4,.4,'rival']],
    stream: [[0,0,0,8,1,.6,'rShade'],[0,2,.6,8,1,.6,'rShade'],[0,4,1.2,8,1,.6,'rShade'],[1,0,.6,1.2,1,1.2,'rGlow'],[4,2,1.2,1.2,1,1.2,'rGlow'],[6.5,4,1.8,1.2,1,1.2,'rGlow']],
    cache: [[0,0,0,6,6,1,'panel'],[3,3,1,1.4,1.4,1.4,'glow'],[2,2,2.4,1.4,1.4,1.4,'glow'],[3,2,3.8,1.4,1.4,1.4,'accent'],[2,1,5.2,1.4,1.4,1.4,'glow'],[3,1,6.6,1.4,1.4,1.4,'accent']],
    browser: [[0,3,0,7,1,5,'tile'],[.4,2.6,4,6.2,.4,.8,'accent'],[.6,2.6,4.2,1.2,.4,.5,'glow'],[2,2.6,4.2,1.2,.4,.5,'panel'],[.4,2.6,.4,6.2,.4,3.2,'well']],
    phone: [[1.5,3,0,3.5,.8,6.5,'tile'],[1.9,2.6,.6,2.7,.4,5,'well'],[2.9,2.6,5.8,.8,.4,.3,'text2']],
    desktop: [[2,2.5,0,3,2,.8,'tile'],[3,3,.8,1,1,1.2,'tile'],[0,3,2,7,.8,4.5,'tile'],[.4,2.6,2.4,6.2,.4,3.7,'well'],[1,2.6,3,2,.4,.5,'accent'],[1,2.6,4,3.5,.4,.4,'mid']],
    cli: [[0,3,0,7,.8,4.5,'well'],[.6,2.6,3.4,1,.4,.5,'ok'],[1.8,2.6,3.4,2,.4,.5,'text2'],[.6,2.6,2.4,3,.4,.5,'text2'],[.6,2.6,1.4,1,.4,.5,'accent']],
    human: [[1.5,2,0,1.2,1.4,2.5,'tile'],[3.3,2,0,1.2,1.4,2.5,'tile'],[1.2,1.8,2.5,3.6,1.8,3,'panel'],[.2,2,3.4,1,1.4,2.2,'tile'],[4.8,2,3.4,1,1.4,2.2,'tile'],[1.6,1.8,5.5,2.8,2.4,2.6,'tile'],[1.6,1.8,7.6,2.8,2.4,.6,'well']],
    cdn: [[0,2,0,2,2,2,'panel'],[1.6,1.5,0,3,3,3.5,'panel'],[4.2,2,0,2,2,2.4,'panel'],[2,2,3.5,2,2,1,'glow']],
    dns: [[2.5,2.5,0,1,1,7,'panel'],[0,2.6,5,3.5,.8,1.2,'glow'],[3.5,2.6,3.5,3.5,.8,1.2,'glow']],
    gateway: [[0,2,0,1.4,2,6,'panel'],[5.6,2,0,1.4,2,6,'panel'],[0,2,6,7,2,1,'panel'],[3,2.2,6,1,1.6,.6,'glow']],
    lb: [[2,2,0,3,3,3,'panel'],[.2,.2,3,1.4,1.4,1.4,'glow'],[2.8,.2,3,1.4,1.4,1.4,'glow'],[5.4,.2,3,1.4,1.4,1.4,'glow'],[2.8,2.8,3,1.4,1.4,1,'accent']],
    webhook: [[3,3,0,1,1,6,'panel'],[1,3,5,3,1,1,'glow'],[1,3,3.5,1,1,1.5,'glow']],
    auth: [[0,1,0,6,4,4,'panel'],[1,2,4,1,1.2,2.5,'warn'],[4,2,4,1,1.2,2.5,'warn'],[1,2,6.5,4,1.2,1,'warn'],[2.5,5,1.5,1,.4,1.2,'well']],
    secrets: [[0,2.5,0,6,1,1,'warn'],[6,1.5,0,3,3,1,'warn'],[7,2.5,0,1,1,1,'well'],[1,2.5,1,1,1,.6,'glow'],[3,2.5,1,1,1,.6,'glow']],
    config: [[1,1,0,5,5,2,'panel'],[2.5,-.6,0,2,1.6,2,'warn'],[2.5,6,0,2,1.6,2,'warn'],[-.6,2.5,0,1.6,2,2,'warn'],[6,2.5,0,1.6,2,2,'warn'],[2.5,2.5,2,2,2,.6,'well']],
    monitor: [[0,3,0,7,.8,4,'panel'],[.6,2.6,.6,1,.4,1,'ok'],[2,2.6,.6,1,.4,2,'ok'],[3.4,2.6,.6,1,.4,1.4,'ok'],[4.8,2.6,.6,1,.4,2.8,'ok']],
    llm: [[0,0,0,6,5,5,'panel'],[1.2,5,2.8,1.2,.4,1,'arcane'],[3.6,5,2.8,1.2,.4,1,'arcane'],[2,5,1,2,.4,.5,'mid'],[-.8,-.8,5.5,1,1,1,'arcane'],[6,5,6.5,1,1,1,'arcane'],[2.5,2,5,1,1,1.5,'arcane']],
    agent: [[1.5,2,0,1.2,1.4,2.5,'panel'],[3.3,2,0,1.2,1.4,2.5,'panel'],[1.2,1.8,2.5,3.6,1.8,3,'arcane'],[.2,2,3.4,1,1.4,2.2,'panel'],[4.8,2,3.4,1,1.4,2.2,'panel'],[1.6,1.8,5.5,2.8,2.4,2.6,'tile'],[1.6,1.8,8.1,2.8,2.4,.6,'arcane']],
    gpu: [[0,0,0,7,7,1,'well'],[2,2,1,3,3,1,'arcane'],[-.6,1,0,.6,.6,.6,'text2'],[-.6,3,0,.6,.6,.6,'text2'],[-.6,5,0,.6,.6,.6,'text2'],[1,-.6,0,.6,.6,.6,'text2'],[3,-.6,0,.6,.6,.6,'text2'],[5,-.6,0,.6,.6,.6,'text2'],[7,1,0,.6,.6,.6,'text2'],[7,3,0,.6,.6,.6,'text2'],[7,5,0,.6,.6,.6,'text2']],
    external: [[0,0,0,6,6,.6,'mid'],[0,0,3,6,6,.6,'mid'],[0,0,0,.6,.6,3,'mid'],[5.4,0,0,.6,.6,3,'mid'],[0,5.4,0,.6,.6,3,'mid'],[5.4,5.4,0,.6,.6,3,'mid']],
    state: [[0,0,0,6,6,2,'panel'],[1,1,2,4,4,.6,'accent']],
    start: [[0,0,0,5,5,4,'accent'],[1.5,5,1,1,.4,2,'onAccent']],
    end: [[0,0,0,6,6,1,'panel'],[1,1,1,4,4,2.5,'well'],[2,2,3.5,2,2,.6,'accent']],
    decision: [[0,0,0,7,7,1,'panel'],[1,1,1,5,5,1,'warn'],[2,2,2,3,3,1,'warn'],[3,3,3,1,1,1,'glow']],
  };
  const propFor = k => PROPS[k] || PROPS.process;
  const propBounds = (boxes) => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9, z1 = 0; boxes.forEach(([x, y, z, w, d, h]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x + w); y0 = Math.min(y0, y); y1 = Math.max(y1, y + d); z1 = Math.max(z1, z + h); }); return { x0, x1, y0, y1, z1 }; };
  // draw a prop with a given voxel size (px) at a screen origin; boxes sorted painter's order
  const drawProp = (g, kind, ox, oy, V, T, edgeCol) => { const boxes = propFor(kind); const pj = (x, y, z) => [ox + Math.round((x - y) * V * .866), oy + Math.round((x + y) * V * .5 - z * V)];
    [...boxes].sort((a, b) => (a[0] + a[1] + a[2] * .01) - (b[0] + b[1] + b[2] * .01)).forEach(([x, y, z, w, d, h, role]) => { const fill = T[role] || role; const top = [pj(x, y, z + h), pj(x + w, y, z + h), pj(x + w, y + d, z + h), pj(x, y + d, z + h)], left = [pj(x, y + d, z), pj(x + w, y + d, z), pj(x + w, y + d, z + h), pj(x, y + d, z + h)], right = [pj(x + w, y + d, z), pj(x + w, y, z), pj(x + w, y, z + h), pj(x + w, y + d, z + h)];
      face(g, left, shade(fill, .78)); face(g, right, shade(fill, .58)); face(g, top, shade(fill, 1.12)); if (V >= 6) [top, left, right].forEach(f => face(g, f, 'none', { stroke: edgeCol || T.edge, 'stroke-width': 1 })); }); };

  // text width in the real font (canvas), falling back to a per-char estimate before fonts load
  const MC = document.createElement('canvas').getContext('2d');
  const measure = (s, font, perChar) => { if (!s) return 0; try { MC.font = font; const w = MC.measureText(s).width; const loaded = document.fonts && document.fonts.check ? document.fonts.check(font) : true; return Math.ceil(Math.max(w, loaded ? 0 : s.length * perChar)); } catch (e) { return s.length * perChar; } };
  // ---------- layout ----------
  const layout = (d) => {
    const nodes = d.nodes.map(n => ({ ...n })); const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
    nodes.forEach(n => { n.h = NH + (n.sub ? 18 : 0) + (n.fields ? n.fields.length * 12 + 4 : 0); const lab = (n.label || n.id).toUpperCase(), sb = n.sub || ''; const lw = 28 + Math.max(measure(lab, '700 14px "Space Mono", monospace', 9.4), lab.length * 9.4, measure(sb, '14px "Space Mono", monospace', 8.8), sb.length * 8.8) + 12; n.w = n.w || Math.max(NW, Math.ceil(lw / 8) * 8); });
    if (d.layout === 'manual') { nodes.forEach(n => { n.px = PAD + (n.x || 0) * GRID; n.py = PAD + (n.y || 0) * GRID; }); }
    else if (d.layout === 'grid') { const cols = d.cols || Math.ceil(Math.sqrt(nodes.length)); nodes.forEach((n, i) => { n.px = PAD + (i % cols) * (NW + GX); n.py = PAD + Math.floor(i / cols) * (NH + GY + 16); }); }
    else { // layered: longest path from sources, back edges ignored
      const out = {}, indeg = {}; nodes.forEach(n => { out[n.id] = []; indeg[n.id] = 0; });
      (d.links || []).forEach(l => { if (byId[l.from] && byId[l.to] && !l.back) { out[l.from].push(l.to); indeg[l.to]++; } });
      const rank = {}; const q = nodes.filter(n => indeg[n.id] === 0).map(n => n.id); q.forEach(id => rank[id] = 0); const seen = new Set(q); let guard = 0;
      while (q.length && guard++ < 5000) { const id = q.shift(); out[id].forEach(t => { rank[t] = Math.max(rank[t] || 0, rank[id] + 1); if (!seen.has(t)) { seen.add(t); q.push(t); } }); }
      nodes.forEach(n => { if (rank[n.id] == null) rank[n.id] = 0; if (n.rank != null) rank[n.id] = n.rank; });
      const cols = {}; nodes.forEach(n => (cols[rank[n.id]] = cols[rank[n.id]] || []).push(n));
      const maxN = Math.max(...Object.values(cols).map(c => c.reduce((a, n) => a + n.h + GY, 0)));
      const colX = {}; { let cx = PAD; Object.keys(cols).map(Number).sort((a, b) => a - b).forEach(r => { colX[r] = cx; cx += Math.max(NW, ...cols[r].map(n => n.w)) + GX; }); }
      Object.entries(cols).forEach(([r, list]) => { const tot = list.reduce((a, n) => a + n.h + GY, 0); let y = PAD + Math.round((maxN - tot) / 2 / GRID) * GRID; list.forEach(n => { n.px = colX[r]; n.py = y; y += n.h + GY; }); });
      nodes.forEach(n => n.rank = rank[n.id]);
    }
    const W = Math.max(...nodes.map(n => n.px + n.w)) + PAD, H = Math.max(...nodes.map(n => n.py + n.h)) + PAD;
    return { nodes, byId, W, H };
  };
  // orthogonal route from a to b: right port → left port; back edges go under
  const route = (a, b) => {
    const ax = a.px + a.w, ay = a.py + Math.round(PROP_H * .62), bx = b.px, by = b.py + Math.round(PROP_H * .62);
    if (bx >= ax + 16) { const mx = Math.round((ax + bx) / 2); return [[ax, ay], [mx, ay], [mx, by], [bx, by]]; }
    const yb = Math.max(a.py + a.h, b.py + b.h) + 16; const sx = a.px + Math.round(a.w / 2), tx = b.px + Math.round(b.w / 2);
    return [[sx, a.py + a.h], [sx, yb], [tx, yb], [tx, b.py + b.h]];
  };
  const pathD = pts => pts.map(([x, y], i) => (i ? (pts[i - 1][0] === x ? 'V' + y : 'H' + x) : `M${x} ${y}`)).join('');
  const along = (pts, t) => { const segs = []; let L = 0; for (let i = 1; i < pts.length; i++) { const l = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]); segs.push(l); L += l; } let d = t * L; for (let i = 1; i < pts.length; i++) { if (d <= segs[i - 1] || i === pts.length - 1) { const f = segs[i - 1] ? d / segs[i - 1] : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; } d -= segs[i - 1]; } return pts[pts.length - 1]; };

  // ---------- 2D renderer ----------
  const draw2d = (svg, d, T, tick, o) => {
    const { nodes, byId, W, H } = layout(d); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.style.width = W + 'px'; svg.style.height = H + 'px';
    const g = el('g'); svg.appendChild(g);
    if (o.grid !== false) for (let x = 0; x < W; x += GRID) for (let y = 0; y < H; y += GRID) g.appendChild(R(x, y, 2, 2, T.shade));
    // zones
    (d.zones || []).forEach(z => { const ns = z.nodes.map(id => byId[id]).filter(Boolean); if (!ns.length) return; const x0 = Math.min(...ns.map(n => n.px)) - 14, y0 = Math.min(...ns.map(n => n.py)) - 22, x1 = Math.max(...ns.map(n => n.px + n.w)) + 14, y1 = Math.max(...ns.map(n => n.py + n.h)) + 12; const col = T[ZK[z.kind] || 'mid'];
      g.appendChild(el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: T.well, 'fill-opacity': .35, stroke: col, 'stroke-width': 2, 'stroke-dasharray': z.kind === 'trust' ? '2 4' : '6 4', 'shape-rendering': 'crispEdges' })); g.appendChild(TXT(x0 + 6, y0 + 11, (z.label || z.kind || 'ZONE').toUpperCase(), { fill: col })); });
    // links
    const routes = {};
    (d.links || []).forEach((l, i) => { const a = byId[l.from], b = byId[l.to]; if (!a || !b) return; const k = LK[l.kind] || LK.sync; const pts = route(a, b); routes[l.id || l.from + '>' + l.to] = pts; const col = l.color ? T[l.color] || l.color : T[k.col];
      g.appendChild(P(pathD(pts), col, k.w, k.dash ? { 'stroke-dasharray': k.dash } : {})); const [ex, ey] = pts[pts.length - 1]; const horiz = pts[pts.length - 1][1] === pts[pts.length - 2][1]; g.appendChild(R(horiz ? ex - 6 : ex - 3, horiz ? ey - 3 : ey, 6, 6, col));
      if (l.label) { const [mx, my] = along(pts, .5); const w = l.label.length * 6.5 + 8; g.appendChild(R(mx - w / 2, my - 7, w, 13, T.well)); g.appendChild(TXT(mx, my + 3, l.label.toUpperCase(), { anchor: 'middle', fill: col === T.mid ? T.text2 : col })); } });
    // nodes
    nodes.forEach(n => { const f = famOf(n.kind); const fill = T[f.fill], edge = n.state === 'failed' || n.state === 'down' ? T.danger : n.state === 'degraded' ? T.warn : n.state === 'running' ? T.accent : n.state === 'ok' ? T.ok : T[f.edge]; const shake = n.state === 'failed' && tick != null ? [0, -4, 4, 0][tick % 4] : 0; const ng = el('g', { transform: `translate(${shake},0)` }); g.appendChild(ng);
      const chipY = n.py + PROP_H, chipH = n.h - PROP_H; const dashed = f.dashed || n.state === 'queued';
      // label chip: L1 bevel block under the prop
      ng.appendChild(R(n.px, chipY + 4, n.w, chipH, T.edge));
      ng.appendChild(el('rect', { x: n.px, y: chipY, width: n.w, height: chipH, fill: T.panel, stroke: edge, 'stroke-width': 2, 'stroke-dasharray': dashed ? '4 4' : null, 'shape-rendering': 'crispEdges' }));
      ng.appendChild(R(n.px + 2, chipY + 2, n.w - 4, 2, T.light)); ng.appendChild(R(n.px + 2, chipY + chipH - 4, n.w - 4, 2, T.shade));
      glyph(ng, n.kind, n.px + 8, chipY + 8, 2, T[f.glyph]);
      ng.appendChild(TXT(n.px + 28, chipY + 19, (n.label || n.id).toUpperCase(), { fill: T.text, bold: true })); if (n.sub) ng.appendChild(TXT(n.px + 28, chipY + 37, n.sub, { fill: T.text2, mono: true, size: 9 }));
      // the prop: a mini voxel object of the actual thing, standing on a ground tile
      const bx = n.px + Math.round(n.w / 2), by = n.py + PROP_H - 6; const bb = propBounds(propFor(n.kind)); const V = 4.4; const cxv = (bb.x0 + bb.x1) / 2, cyv = (bb.y0 + bb.y1) / 2;
      const ox = bx - Math.round((cxv - cyv) * V * .866), oy = by - Math.round((cxv + cyv) * V * .5);
      const tile = [[bb.x0 - 1, bb.y0 - 1], [bb.x1 + 1, bb.y0 - 1], [bb.x1 + 1, bb.y1 + 1], [bb.x0 - 1, bb.y1 + 1]].map(([x, y]) => [ox + Math.round((x - y) * V * .866), oy + Math.round((x + y) * V * .5)]);
      face(ng, tile, T.well, { stroke: edge === T[f.edge] ? T.mid : edge, 'stroke-width': 2, 'stroke-dasharray': dashed ? '3 3' : null });
      drawProp(ng, n.kind, ox, oy, V, T);
      if (n.state === 'failed' || n.state === 'down') ng.appendChild(R(bx - 4, n.py + 2, 8, 8, T.danger));
      // ports at prop height
      ng.appendChild(R(n.px - 2, n.py + Math.round(PROP_H * .62) - 2, 4, 4, T.mid)); ng.appendChild(R(n.px + n.w - 2, n.py + Math.round(PROP_H * .62) - 2, 4, 4, T.mid));
      if (n.state === 'ok') ng.appendChild(R(bx - 6, n.py + 4, 12, 3, T.ok)); if (n.state === 'cached') ng.appendChild(R(n.px + n.w - 14, n.py + 4, 8, 8, T.glow));
      if (n.state === 'running' && tick != null && !reduceMotion()) for (let i = 0; i < 5; i++) { const ph = (tick + i * 3) % 12; ng.appendChild(R(bx - 26 + i * 12, by - 6 - ph * 4, 4, 4, T.accent, { 'fill-opacity': 1 - ph / 12 })); }
      (n.fields || []).forEach((fl, i) => { const y = n.py + PROP_H + 30 + (n.sub ? 18 : 0) + i * 12; ng.appendChild(R(n.px + 6, y - 2, n.w - 12, 2, T.shade)); ng.appendChild(TXT(n.px + 8, y + 8, fl, { fill: T.text2, mono: true, size: 9 })); });
      if (n.badge) { const w = String(n.badge).length * 6 + 8; ng.appendChild(R(n.px + n.w - w + 2, n.py - 8, w, 12, T.accent)); ng.appendChild(TXT(n.px + n.w - w / 2 + 2, n.py + 1, n.badge, { anchor: 'middle', fill: T.onAccent })); } });
    // flows
    (d.flows || []).forEach((fl, fi) => { const pts = []; for (let i = 1; i < fl.path.length; i++) { const a = byId[fl.path[i - 1]], b = byId[fl.path[i]]; if (a && b) route(a, b).forEach(p => pts.push(p)); } if (pts.length < 2) return;
      if (reduceMotion() || tick == null) { const [mx, my] = along(pts, .5); packet(g, fl.packet, mx, my, T); g.appendChild(R(mx + 6, my - 14, 12, 12, T.text)); g.appendChild(TXT(mx + 12, my - 5, fi + 1, { anchor: 'middle', fill: T.onAccent })); }
      else { const per = fl.every || 60; const t = ((tick * 4 + fi * Math.floor(per / 2)) % per) / per; const [px, py] = along(pts, t); packet(g, fl.packet, px, py, T); if (fl.label && t < .5) g.appendChild(TXT(px + 10, py - 6, fl.label.toUpperCase(), { fill: T.glow })); } });
    return { W, H };
  };

  // ---------- isometric voxel renderer ----------
  const ISO = 12; // px per voxel
  const iso = (x, y, z) => [Math.round((x - y) * ISO * .866), Math.round((x + y) * ISO * .5 - z * ISO)];
  const block = (g, x, y, z, w, dpt, h, fill, edge) => { const p = (a, b, c) => iso(a, b, c); const top = [p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + dpt, z + h), p(x, y + dpt, z + h)], left = [p(x, y + dpt, z), p(x + w, y + dpt, z), p(x + w, y + dpt, z + h), p(x, y + dpt, z + h)], right = [p(x + w, y + dpt, z), p(x + w, y, z), p(x + w, y, z + h), p(x + w, y + dpt, z + h)];
    face(g, left, shade(fill, .8)); face(g, right, shade(fill, .6)); face(g, top, shade(fill, 1.15)); [top, left, right].forEach(f => face(g, f, 'none', { stroke: edge, 'stroke-width': 1.5 })); return top; };
  const drawIso = (svg, d, T, tick, o) => {
    const L = layout(d); const nodes = L.nodes, byId = L.byId; const CELL = 3; // ground units per grid cell
    nodes.forEach(n => { n.gx = ((n.px - PAD) / (NW + GX)) * 14; n.gy = ((n.py - PAD) / (NH + GY)) * 7; n.gw = 7; n.gd = 7; n.gh = 5; });
    const all = []; nodes.forEach(n => { all.push(iso(n.gx, n.gy, n.gh + 3), iso(n.gx + n.gw, n.gy + n.gd, 0), iso(n.gx, n.gy + n.gd, 0), iso(n.gx + n.gw, n.gy, 0)); });
    const minX = Math.min(...all.map(p => p[0])) - 60, minY = Math.min(...all.map(p => p[1])) - 40, maxX = Math.max(...all.map(p => p[0])) + 60, maxY = Math.max(...all.map(p => p[1])) + 40; const W = maxX - minX, H = maxY - minY;
    svg.setAttribute('viewBox', `${minX} ${minY} ${W} ${H}`); svg.style.width = W + 'px'; svg.style.height = H + 'px';
    const g = el('g'); svg.appendChild(g);
    // ground: zone tiles + dots
    const gx0 = Math.min(...nodes.map(n => n.gx)) - 3, gx1 = Math.max(...nodes.map(n => n.gx + n.gw)) + 3, gy0 = Math.min(...nodes.map(n => n.gy)) - 3, gy1 = Math.max(...nodes.map(n => n.gy + n.gd)) + 3;
    face(g, [iso(gx0, gy0, 0), iso(gx1, gy0, 0), iso(gx1, gy1, 0), iso(gx0, gy1, 0)], T.well, { stroke: T.mid, 'stroke-width': 2 });
    for (let x = gx0; x <= gx1; x += CELL) for (let y = gy0; y <= gy1; y += CELL) { const [px, py] = iso(x, y, 0); g.appendChild(R(px - 1, py - 1, 2, 2, T.shade)); }
    (d.zones || []).forEach(z => { const ns = z.nodes.map(id => byId[id]).filter(Boolean); if (!ns.length) return; const x0 = Math.min(...ns.map(n => n.gx)) - 1.5, y0 = Math.min(...ns.map(n => n.gy)) - 1.5, x1 = Math.max(...ns.map(n => n.gx + n.gw)) + 1.5, y1 = Math.max(...ns.map(n => n.gy + n.gd)) + 1.5; const col = T[ZK[z.kind] || 'mid'];
      face(g, [iso(x0, y0, .1), iso(x1, y0, .1), iso(x1, y1, .1), iso(x0, y1, .1)], col, { 'fill-opacity': .12, stroke: col, 'stroke-width': 2, 'stroke-dasharray': '6 4' }); const [lx, ly] = iso(x0, y1, .1); g.appendChild(TXT(lx + 4, ly + 12, (z.label || z.kind).toUpperCase(), { fill: col })); });
    // links as rails on the ground / at rail heights, drawn before blocks (painter's order by depth)
    const rails = [];
    (d.links || []).forEach(l => { const a = byId[l.from], b = byId[l.to]; if (!a || !b) return; const k = LK[l.kind] || LK.sync; const z = k.rail * 1.5 + .2; const ax = a.gx + a.gw / 2, ay = a.gy + a.gd / 2, bx = b.gx + b.gw / 2, by = b.gy + b.gd / 2; const pts3 = [[ax, ay, z], [bx, ay, z], [bx, by, z]]; rails.push({ l, pts3, col: l.color ? T[l.color] || l.color : T[k.col], k });
      const pts = pts3.map(p => iso(...p)); g.appendChild(P(pts.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join(''), T.edge, k.w + 2)); g.appendChild(P(pts.map(([x, y], i) => (i ? 'L' : 'M') + x + ' ' + y).join(''), rails[rails.length - 1].col, k.w, k.dash ? { 'stroke-dasharray': k.dash } : {}));
      if (z > .3) { const [sx, sy] = iso(ax, ay, 0), [sx2, sy2] = iso(ax, ay, z); g.appendChild(P(`M${sx} ${sy}L${sx2} ${sy2}`, T.mid, 1)); }
      const [ex, ey] = pts[2]; g.appendChild(R(ex - 3, ey - 3, 6, 6, rails[rails.length - 1].col)); if (l.label) { const [mx, my] = iso((ax + bx) / 2, ay, z); g.appendChild(TXT(mx, my - 6, l.label.toUpperCase(), { anchor: 'middle', fill: rails[rails.length - 1].col })); } });
    // blocks, back to front
    [...nodes].sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy)).forEach(n => { const f = famOf(n.kind); const fill = T[f.fill] === T.well ? '#1a1f33' : T[f.fill]; const edge = n.state === 'failed' || n.state === 'down' ? T.danger : n.state === 'running' ? T.accent : n.state === 'degraded' ? T.warn : T.edge;
      { const bb = propBounds(propFor(n.kind)); const sc = Math.min(n.gw / (bb.x1 - bb.x0 + 1), n.gd / (bb.y1 - bb.y0 + 1)); const V = ISO * sc; const [ox, oy] = iso(n.gx + .5 - bb.x0 * sc, n.gy + .5 - bb.y0 * sc, 0); face(g, [iso(n.gx, n.gy, 0), iso(n.gx + n.gw, n.gy, 0), iso(n.gx + n.gw, n.gy + n.gd, 0), iso(n.gx, n.gy + n.gd, 0)], T.well, { stroke: edge === T.edge ? T.mid : edge, 'stroke-width': 2 }); drawProp(g, n.kind, ox, oy, V, T, T.edge); n.gh = propBounds(propFor(n.kind)).z1 * sc; }
      // label chip floating above
      const [cx, cy] = iso(n.gx + n.gw / 2, n.gy + n.gd / 2, n.gh + 1.6); const label = (n.label || n.id).toUpperCase(); const w = label.length * 6.5 + 28; g.appendChild(R(cx - w / 2, cy - 9, w, 18, T.well)); g.appendChild(el('rect', { x: cx - w / 2, y: cy - 9, width: w, height: 18, fill: 'none', stroke: edge === T.edge ? T.mid : edge, 'stroke-width': 2, 'shape-rendering': 'crispEdges' })); glyph(g, n.kind, cx - w / 2 + 5, cy - 7, 2, T[f.glyph]); g.appendChild(TXT(cx - w / 2 + 24, cy + 4, label, { fill: T.text })); const [lx, ly] = iso(n.gx + n.gw / 2, n.gy + n.gd / 2, n.gh); g.appendChild(R(cx - 1, cy + 9, 2, ly - cy - 9, T.mid));
      if (n.state === 'running' && tick != null && !reduceMotion()) for (let i = 0; i < 5; i++) { const ph = (tick + i * 3) % 12; const [px, py] = iso(n.gx + (i % 2 ? -.6 : n.gw + .6), n.gy + (i * 1.3) % n.gd, ph * .5); g.appendChild(R(px - 2, py - 2, 4, 4, T.accent, { 'fill-opacity': 1 - ph / 12 })); } });
    // packets
    (d.flows || []).forEach((fl, fi) => { const pts3 = []; for (let i = 1; i < fl.path.length; i++) { const r = rails.find(x => x.l.from === fl.path[i - 1] && x.l.to === fl.path[i]); if (r) pts3.push(...r.pts3); } if (pts3.length < 2) return; const pts = pts3.map(p => iso(...p));
      if (reduceMotion() || tick == null) { const [mx, my] = along(pts, .5); packet(g, fl.packet, mx, my - 6, T); g.appendChild(R(mx + 6, my - 20, 12, 12, T.text)); g.appendChild(TXT(mx + 12, my - 11, fi + 1, { anchor: 'middle', fill: T.onAccent })); }
      else { const per = fl.every || 60; const t = ((tick * 4 + fi * Math.floor(per / 2)) % per) / per; const [px, py] = along(pts, t); packet(g, fl.packet, px, py - 6, T); g.appendChild(R(px - 1, py - 1, 2, 5, T.edge)); } });
    return { W, H };
  };

  // ---------- sequence diagram ----------
  const drawSeq = (svg, d, T, tick, o) => { const AW = 96, AG = 40, ROW = 28, top = 8, NH = 64; const actors = d.actors; const X = i => PAD + i * (AW + AG) + AW / 2; const msgs = d.messages || []; const W = PAD * 2 + actors.length * (AW + AG) - AG, H = top + NH + 24 + msgs.length * ROW + 24; svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.style.width = W + 'px'; svg.style.height = H + 'px'; const g = el('g'); svg.appendChild(g);
    actors.forEach((a, i) => { const x = X(i) - AW / 2, f = famOf(a.kind || 'service'); g.appendChild(P(`M${X(i)} ${top + NH}V${H - 8}`, T.mid, 2, { 'stroke-dasharray': '4 4' })); const bb = propBounds(propFor(a.kind || 'service')); const V = 3.2; const cxv = (bb.x0 + bb.x1) / 2, cyv = (bb.y0 + bb.y1) / 2; const ox = X(i) - Math.round((cxv - cyv) * V * .866), oy = top + 40 - Math.round((cxv + cyv) * V * .5); drawProp(g, a.kind || 'service', ox, oy, V, T);
      g.appendChild(R(x, top + 48, AW, 20, T.edge)); g.appendChild(el('rect', { x, y: top + 44, width: AW, height: 20, fill: T[f.fill] === T.well ? T.panel : T[f.fill], stroke: T[f.edge], 'stroke-width': 2, 'shape-rendering': 'crispEdges' })); g.appendChild(TXT(X(i), top + 57, (a.label || a.id).toUpperCase(), { anchor: 'middle', fill: T.text, bold: true })); });
    const idx = Object.fromEntries(actors.map((a, i) => [a.id, i])); const active = {};
    msgs.forEach((m, i) => { const y = top + NH + 24 + i * ROW; const a = idx[m.from], b = idx[m.to]; if (a == null || b == null) return; const k = LK[m.kind] || (m.reply ? { dash: '6 4', col: 'text2', w: 2 } : LK.sync); const col = m.kind === 'error' ? T.danger : T[k.col] || T.mid; const cur = tick != null && !reduceMotion() ? (Math.floor(tick / 6) % (msgs.length + 2)) : -1; const on = cur === i;
      if (a === b) { const x = X(a); g.appendChild(P(`M${x} ${y}H${x + 32}V${y + 14}H${x + 6}`, col, 2)); g.appendChild(R(x + 2, y + 11, 6, 6, col)); if (m.label) g.appendChild(TXT(x + 38, y + 10, m.label, { fill: T.text2, mono: true, size: 9 })); return; }
      const x1 = X(a), x2 = X(b), dir = x2 > x1 ? 1 : -1; g.appendChild(P(`M${x1} ${y}H${x2 - dir * 4}`, on ? T.glow : col, on ? 3 : k.w, k.dash ? { 'stroke-dasharray': k.dash } : {})); g.appendChild(R(x2 - dir * 4 - 3, y - 3, 6, 6, on ? T.glow : col));
      if (m.label) { const mx = (x1 + x2) / 2, w = m.label.length * 6.2 + 8; g.appendChild(R(mx - w / 2, y - 16, w, 13, T.well)); g.appendChild(TXT(mx, y - 6, m.label.toUpperCase(), { anchor: 'middle', fill: on ? T.glow : m.reply ? T.text2 : T.text })); }
      if (m.activate) active[m.to] = y; if (m.reply && active[m.from] != null) { g.appendChild(R(X(idx[m.from]) - 3, active[m.from], 6, y - active[m.from], T[famOf(actors[idx[m.from]].kind || 'service').glyph])); delete active[m.from]; }
      if (m.note) g.appendChild(TXT(W - PAD, y + 3, m.note, { anchor: 'end', fill: T.text2, mono: true, size: 9 })); });
    return { W, H }; };

  const LIVE = new Set(); let ticker = null; const tickAll = () => { if (document.hidden) return; LIVE.forEach(d => { if (d._visible !== false) { d._tick++; d.render(true); } }); };
  const startTicker = () => { if (!ticker) ticker = setInterval(tickAll, 60); }; const stopTicker = () => { if (!LIVE.size) { clearInterval(ticker); ticker = null; } };
  const IO = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { e.target._visible = e.isIntersecting; if (e.isIntersecting && e.target._playing) e.target.render(true); }), { rootMargin: '64px' }) : null;
  class SRDiagram extends HTMLElement {
    static get observedAttributes() { return ['type', 'view', 'data', 'src', 'opts', 'play', 'theme']; }
    connectedCallback() { if (!this.shadowRoot) this.attachShadow({ mode: 'open' }); this.style.display = 'inline-block'; this.style.overflow = 'auto'; this.style.maxWidth = '100%'; this._tick = 0; if (IO) IO.observe(this); this.render(); if (this.hasAttribute('play')) this.play(); }
    disconnectedCallback() { this.pause(); if (IO) IO.unobserve(this); }
    attributeChangedCallback(n) { if (!this.isConnected) return; if (n === 'play') { this.hasAttribute('play') ? this.play() : this.pause(); return; } this.render(); }
    get model() { if (this._model) return this._model; const src = this.getAttribute('src'); let raw = this.getAttribute('data'); if (src) { const s = document.querySelector(src); raw = s ? s.textContent : null; } try { return raw ? JSON.parse(raw) : null; } catch (e) { return { error: e.message }; } }
    set model(m) { this._model = m; this.render(); }
    get opts() { try { return JSON.parse(this.getAttribute('opts') || '{}'); } catch (e) { return {}; } }
    play() { if (this._playing) return; this._playing = true; LIVE.add(this); startTicker(); }
    pause() { this._playing = false; LIVE.delete(this); stopTicker(); this.render(); }
    step() { this._tick += 4; this.render(true); }
    render(anim) { const root = this.shadowRoot || this; const d = this.model; const o = this.opts; const T = this.getAttribute('theme') === 'light' ? LIGHT : C; root.innerHTML = ''; const svg = el('svg', { xmlns: NS }); svg.style.display = 'block'; svg.style.background = o.bg || 'transparent'; svg.style.fontFamily = 'Silkscreen, monospace';
      if (!d || d.error || !(d.nodes || d.actors)) { svg.setAttribute('viewBox', '0 0 240 72'); svg.style.width = '240px'; svg.style.height = '72px'; svg.appendChild(el('rect', { x: 1, y: 1, width: 238, height: 70, fill: 'none', stroke: T.danger, 'stroke-width': 2 })); svg.appendChild(TXT(120, 32, d && d.error ? 'BAD JSON' : 'NO DIAGRAM', { anchor: 'middle', fill: T.danger, size: 11 })); svg.appendChild(TXT(120, 48, d && d.error ? d.error.slice(0, 36) : 'GIVE nodes + links OR actors + messages', { anchor: 'middle', fill: T.text2, size: 8, mono: true })); root.appendChild(svg); return; }
      const tick = this._playing || anim ? this._tick : null; const type = this.getAttribute('type') || (d.actors ? 'sequence' : 'graph'); const view = this.getAttribute('view') || d.view || '2d';
      if (type === 'sequence') drawSeq(svg, d, T, tick, o); else if (view === 'iso') drawIso(svg, d, T, tick, o); else draw2d(svg, d, T, tick, o); root.appendChild(svg); }
  }
  customElements.define('sr-diagram', SRDiagram);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => document.querySelectorAll('sr-diagram').forEach(d => d.render()));

  // ---------- templates (the gallery + the 3D bench read these) ----------
  const TPL = {
    webApp: { nodes: [{ id: 'user', kind: 'human', label: 'User' }, { id: 'web', kind: 'browser', label: 'Web app', sub: 'react · pwa' }, { id: 'cdn', kind: 'cdn', label: 'CDN' }, { id: 'api', kind: 'gateway', label: 'API gateway', sub: 'auth · rate limit' }, { id: 'svc', kind: 'service', label: 'App service', sub: 'node · 3 replicas', state: 'running' }, { id: 'cache', kind: 'cache', label: 'Cache', sub: 'redis' }, { id: 'db', kind: 'sql', label: 'Postgres', sub: 'primary' }, { id: 'dbr', kind: 'sql', label: 'Replica', sub: 'read only' }, { id: 'q', kind: 'queue', label: 'Jobs', sub: 'sqs' }, { id: 'wk', kind: 'worker', label: 'Worker', sub: 'emails · exports' }, { id: 'mail', kind: 'external', label: 'Email API' }, { id: 'obs', kind: 'monitor', label: 'Metrics', sub: 'otel' }],
      links: [{ from: 'user', to: 'web' }, { from: 'web', to: 'cdn', kind: 'sync', label: 'assets' }, { from: 'web', to: 'api', kind: 'sync', label: 'https' }, { from: 'api', to: 'svc' }, { from: 'svc', to: 'cache', kind: 'cacheHit', label: 'hit' }, { from: 'svc', to: 'db', kind: 'write' }, { from: 'db', to: 'dbr', kind: 'replication', label: 'wal' }, { from: 'svc', to: 'q', kind: 'async', label: 'enqueue' }, { from: 'q', to: 'wk', kind: 'async' }, { from: 'wk', to: 'mail', kind: 'sync' }, { from: 'svc', to: 'obs', kind: 'stream', label: 'traces' }],
      zones: [{ label: 'VPC · us-east-1', kind: 'vpc', nodes: ['api', 'svc', 'cache', 'db', 'dbr', 'q', 'wk'] }], flows: [{ path: ['web', 'api', 'svc', 'db'], packet: 'json', label: 'POST /orders' }, { path: ['svc', 'q', 'wk'], packet: 'event', label: 'order.created', every: 90 }] },
    eventDriven: { nodes: [{ id: 'app', kind: 'phone', label: 'Mobile' }, { id: 'ing', kind: 'gateway', label: 'Ingest' }, { id: 'bus', kind: 'stream', label: 'Event bus', sub: 'kafka · 12 partitions' }, { id: 'ord', kind: 'service', label: 'Orders' }, { id: 'inv', kind: 'service', label: 'Inventory', state: 'degraded' }, { id: 'ntf', kind: 'function', label: 'Notify' }, { id: 'odb', kind: 'nosql', label: 'Orders DB' }, { id: 'idb', kind: 'sql', label: 'Stock DB' }, { id: 'dlq', kind: 'queue', label: 'DLQ' }, { id: 'push', kind: 'external', label: 'Push' }],
      links: [{ from: 'app', to: 'ing' }, { from: 'ing', to: 'bus', kind: 'async', label: 'publish' }, { from: 'bus', to: 'ord', kind: 'stream' }, { from: 'bus', to: 'inv', kind: 'stream' }, { from: 'bus', to: 'ntf', kind: 'stream' }, { from: 'ord', to: 'odb', kind: 'write' }, { from: 'inv', to: 'idb', kind: 'write' }, { from: 'inv', to: 'dlq', kind: 'retry', label: 'retry ×3' }, { from: 'ntf', to: 'push' }],
      zones: [{ label: 'consumers', kind: 'team', nodes: ['ord', 'inv', 'ntf'] }], flows: [{ path: ['app', 'ing', 'bus', 'ord', 'odb'], packet: 'event', label: 'order.placed' }, { path: ['bus', 'inv', 'dlq'], packet: 'error', every: 100 }] },
    dataPipeline: { nodes: [{ id: 'src1', kind: 'sql', label: 'App DB' }, { id: 'src2', kind: 'external', label: 'Stripe' }, { id: 'src3', kind: 'fs', label: 'Logs', sub: 's3://raw' }, { id: 'ext', kind: 'cron', label: 'Extract', sub: 'hourly', state: 'ok' }, { id: 'lake', kind: 'storage', label: 'Lake', sub: 'parquet' }, { id: 'tr', kind: 'worker', label: 'Transform', sub: 'dbt · 42 models', state: 'running' }, { id: 'wh', kind: 'sql', label: 'Warehouse' }, { id: 'ml', kind: 'gpu', label: 'Train', sub: 'nightly' }, { id: 'dash', kind: 'desktop', label: 'Dashboards' }, { id: 'alert', kind: 'monitor', label: 'Quality checks', state: 'failed' }],
      links: [{ from: 'src1', to: 'ext', kind: 'batch' }, { from: 'src2', to: 'ext', kind: 'batch' }, { from: 'src3', to: 'ext', kind: 'batch' }, { from: 'ext', to: 'lake', kind: 'write' }, { from: 'lake', to: 'tr', kind: 'read' }, { from: 'tr', to: 'wh', kind: 'write' }, { from: 'wh', to: 'ml', kind: 'read' }, { from: 'wh', to: 'dash', kind: 'read' }, { from: 'tr', to: 'alert', kind: 'async', label: 'tests' }],
      zones: [{ label: 'sources', kind: 'boundary', nodes: ['src1', 'src2', 'src3'] }, { label: 'platform', kind: 'region', nodes: ['ext', 'lake', 'tr', 'wh'] }], flows: [{ path: ['src1', 'ext', 'lake', 'tr', 'wh'], packet: 'row', label: '12k rows' }] },
    mlServing: { nodes: [{ id: 'cl', kind: 'browser', label: 'Client' }, { id: 'gw', kind: 'gateway', label: 'Gateway', sub: 'auth · quotas' }, { id: 'orch', kind: 'agent', label: 'Orchestrator', sub: 'plan · route' }, { id: 'vec', kind: 'vector', label: 'Vector DB', sub: 'pgvector' }, { id: 'llm', kind: 'llm', label: 'LLM', sub: 'claude', state: 'running' }, { id: 'tools', kind: 'function', label: 'Tools', sub: 'search · code' }, { id: 'cache', kind: 'cache', label: 'Prompt cache' }, { id: 'eval', kind: 'monitor', label: 'Evals', sub: 'sampled 5%' }, { id: 'store', kind: 'nosql', label: 'Sessions' }],
      links: [{ from: 'cl', to: 'gw' }, { from: 'gw', to: 'orch' }, { from: 'orch', to: 'vec', kind: 'read', label: 'top-k' }, { from: 'orch', to: 'cache', kind: 'cacheMiss', label: 'miss' }, { from: 'orch', to: 'llm', kind: 'talk', label: 'prompt' }, { from: 'llm', to: 'tools', kind: 'talk', label: 'tool call' }, { from: 'orch', to: 'store', kind: 'write' }, { from: 'llm', to: 'eval', kind: 'async' }],
      zones: [{ label: 'trust boundary · no PII past here', kind: 'trust', nodes: ['llm', 'tools', 'eval'] }], flows: [{ path: ['cl', 'gw', 'orch', 'llm'], packet: 'json', label: 'messages[]' }, { path: ['orch', 'vec'], packet: 'row', every: 80 }] },
    mobileBackend: { nodes: [{ id: 'ios', kind: 'phone', label: 'iOS', sub: 'swift' }, { id: 'and', kind: 'phone', label: 'Android', sub: 'kotlin' }, { id: 'api', kind: 'gateway', label: 'API', sub: 'graphql' }, { id: 'auth', kind: 'auth', label: 'Auth', sub: 'oidc' }, { id: 'svc', kind: 'service', label: 'Core' }, { id: 'db', kind: 'sql', label: 'DB' }, { id: 'blob', kind: 'storage', label: 'Media', sub: 's3' }, { id: 'push', kind: 'external', label: 'APNs · FCM' }, { id: 'cfg', kind: 'config', label: 'Flags' }],
      links: [{ from: 'ios', to: 'api' }, { from: 'and', to: 'api' }, { from: 'api', to: 'auth', kind: 'sync', label: 'verify' }, { from: 'api', to: 'svc' }, { from: 'svc', to: 'db', kind: 'write' }, { from: 'svc', to: 'blob', kind: 'write' }, { from: 'svc', to: 'push', kind: 'async' }, { from: 'svc', to: 'cfg', kind: 'read' }],
      flows: [{ path: ['ios', 'api', 'auth'], packet: 'token', label: 'jwt' }, { path: ['and', 'api', 'svc', 'blob'], packet: 'blob', every: 90 }] },
    ciMonorepo: { nodes: [{ id: 'dev', kind: 'human', label: 'Dev' }, { id: 'git', kind: 'fs', label: 'Repo', sub: 'main' }, { id: 'ci', kind: 'worker', label: 'CI', sub: 'matrix ×6', state: 'running' }, { id: 'cache', kind: 'cache', label: 'Build cache', state: 'cached' }, { id: 'reg', kind: 'storage', label: 'Registry', sub: 'oci' }, { id: 'stg', kind: 'service', label: 'Staging', state: 'ok' }, { id: 'prd', kind: 'service', label: 'Prod', sub: 'canary 5%' }, { id: 'obs', kind: 'monitor', label: 'SLOs' }],
      links: [{ from: 'dev', to: 'git', kind: 'write', label: 'push' }, { from: 'git', to: 'ci', kind: 'webhook' in LK ? 'async' : 'async', label: 'webhook' }, { from: 'ci', to: 'cache', kind: 'cacheHit' }, { from: 'ci', to: 'reg', kind: 'write', label: 'image' }, { from: 'reg', to: 'stg', kind: 'sync', label: 'deploy' }, { from: 'stg', to: 'prd', kind: 'sync', label: 'promote' }, { from: 'prd', to: 'obs', kind: 'stream' }, { from: 'obs', to: 'prd', kind: 'failover', label: 'rollback', back: true }],
      flows: [{ path: ['dev', 'git', 'ci', 'reg', 'stg'], packet: 'blob', label: 'sha 4f2e' }] },
    agentSystem: { nodes: [{ id: 'u', kind: 'human', label: 'You' }, { id: 'plan', kind: 'agent', label: 'Planner', sub: 'carrot · primal' }, { id: 'dev', kind: 'agent', label: 'Dev', sub: 'pom · kindle', state: 'running' }, { id: 'rev', kind: 'agent', label: 'Reviewer', sub: 'carrot · surge' }, { id: 'repo', kind: 'fs', label: 'Repo' }, { id: 'db', kind: 'sql', label: 'DB' }, { id: 'reg', kind: 'search', label: 'Registry' }, { id: 'dash', kind: 'desktop', label: 'Dashboards' }],
      links: [{ from: 'u', to: 'plan', kind: 'talk', label: 'goal' }, { from: 'plan', to: 'dev', kind: 'talk', label: 'task' }, { from: 'dev', to: 'repo', kind: 'write' }, { from: 'dev', to: 'db', kind: 'write', label: '12 rows' }, { from: 'dev', to: 'rev', kind: 'talk', label: 'diff' }, { from: 'rev', to: 'repo', kind: 'read' }, { from: 'plan', to: 'reg', kind: 'read', label: 'search' }, { from: 'rev', to: 'dash', kind: 'write' }],
      flows: [{ path: ['u', 'plan', 'dev', 'rev'], packet: 'envelope', label: 'thread' }] },
    checkoutSequence: { actors: [{ id: 'u', kind: 'browser', label: 'Browser' }, { id: 'api', kind: 'gateway', label: 'API' }, { id: 'pay', kind: 'external', label: 'Payments' }, { id: 'db', kind: 'sql', label: 'DB' }, { id: 'q', kind: 'queue', label: 'Jobs' }],
      messages: [{ from: 'u', to: 'api', label: 'POST /checkout', activate: true }, { from: 'api', to: 'db', label: 'BEGIN · reserve stock' }, { from: 'db', to: 'api', label: 'ok', reply: true }, { from: 'api', to: 'pay', label: 'charge 42.00', kind: 'sync' }, { from: 'pay', to: 'api', label: 'declined', kind: 'error', reply: true, note: 'card_declined' }, { from: 'api', to: 'db', label: 'ROLLBACK' }, { from: 'api', to: 'q', label: 'checkout.failed', kind: 'async' }, { from: 'api', to: 'u', label: '402 · try another card', reply: true }] },
    stateMachine: { layout: 'layered', nodes: [{ id: 'idle', kind: 'start', label: 'Idle' }, { id: 'run', kind: 'state', label: 'Running', state: 'running' }, { id: 'pause', kind: 'state', label: 'Paused' }, { id: 'done', kind: 'end', label: 'Done' }, { id: 'fail', kind: 'state', label: 'Failed', state: 'failed' }],
      links: [{ from: 'idle', to: 'run', label: 'start' }, { from: 'run', to: 'pause', label: 'pause' }, { from: 'pause', to: 'run', label: 'resume', back: true, kind: 'async' }, { from: 'run', to: 'done', label: 'complete' }, { from: 'run', to: 'fail', label: 'error', kind: 'timeout' }, { from: 'fail', to: 'run', label: 'retry', kind: 'retry', back: true }] },
    er: { layout: 'layered', nodes: [{ id: 'user', kind: 'table', label: 'users', fields: ['id  pk', 'email', 'created_at'] }, { id: 'order', kind: 'table', label: 'orders', fields: ['id  pk', 'user_id  fk', 'total', 'status'] }, { id: 'item', kind: 'table', label: 'order_items', fields: ['order_id  fk', 'sku  fk', 'qty'] }, { id: 'prod', kind: 'table', label: 'products', fields: ['sku  pk', 'name', 'price'] }],
      links: [{ from: 'user', to: 'order', label: '1 · n' }, { from: 'order', to: 'item', label: '1 · n' }, { from: 'prod', to: 'item', label: '1 · n' }] },
    flowchart: { layout: 'layered', nodes: [{ id: 's', kind: 'start', label: 'Request' }, { id: 'auth', kind: 'decision', label: 'Has token?' }, { id: 'v', kind: 'decision', label: 'Valid?' }, { id: 'h', kind: 'process', label: 'Handle' }, { id: 'r401', kind: 'end', label: '401' }, { id: 'ok', kind: 'end', label: '200' }],
      links: [{ from: 's', to: 'auth' }, { from: 'auth', to: 'v', label: 'yes' }, { from: 'auth', to: 'r401', label: 'no', kind: 'timeout' }, { from: 'v', to: 'h', label: 'yes' }, { from: 'v', to: 'r401', label: 'no', kind: 'timeout' }, { from: 'h', to: 'ok' }] },
    c4context: { layout: 'layered', nodes: [{ id: 'p', kind: 'human', label: 'Person', sub: 'customer' }, { id: 'sys', kind: 'service', label: 'Still Room', sub: 'software system', badge: 'SYSTEM' }, { id: 'pay', kind: 'external', label: 'Payments', sub: 'external' }, { id: 'mail', kind: 'external', label: 'Email', sub: 'external' }],
      links: [{ from: 'p', to: 'sys', label: 'uses' }, { from: 'sys', to: 'pay', label: 'charges' }, { from: 'sys', to: 'mail', label: 'sends' }] },
  };
  window.SRDiagram = { layout, famOf, LK, PROPS, propFor, propBounds, KINDS: Object.keys(GL), FAMILIES: FAM, LINK_KINDS: Object.keys(LK), PACKETS: Object.keys(PK), ZONES: Object.keys(ZK), templates: TPL, GLYPHS: GL };
})();
