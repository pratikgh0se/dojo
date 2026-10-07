// <pom-stage> — live 3D voxel Pom & Carrot, lifted from animation/Pom 3D.html (same recipe, palette, forms, aura rules).
// Attributes: who="pom|carrot|both" form="0-8|NAME" pose="idle|training|resting|powerup" autorotate background="#0f111c" zoom="1" hide-aura
// Loads three.js from unpkg on demand. One WebGL context per element: keep ≤ 6 per page.
(() => {
  if (customElements.get('pom-stage')) return;
  const THREE_URL = '/engines/vendor/three/three.module.min.js';
  let threeP = null;
  const loadThree = () => (threeP ||= import(THREE_URL));
  const S = .06;
  const FORMS = [{ n: 'BASE', hair: '#0e0f14', eye: '#14151c', aura: null }, { n: 'KINDLE', hair: '#ffe05a', eye: '#5eead4', aura: '#ffe05a' }, { n: 'SURGE', hair: '#ffe05a', eye: '#5eead4', aura: '#ffe05a', bolt: '#4dd8ff' }, { n: 'TEMPEST', hair: '#ffe05a', eye: '#5eead4', aura: '#ffe05a', bolt: '#4dd8ff', scale: 3.6, noBrow: true, violent: true }, { n: 'PRIMAL', hair: '#8b1a1a', eye: '#ffe05a', aura: '#ff4d4d', spark: '#ffe05a', bolt: '#ffd0d0', scale: 1.05, fur: true }, { n: 'ZENITH', hair: '#ff2020', eye: '#ff1a1a', aura: '#ff3b3b', calm: true, glow: 1.2 }, { n: 'AZURE', hair: '#2f6bff', eye: '#4dd8ff', aura: '#4dd8ff', bolt: '#2f6bff', calm: true, slowBolt: true, glow: 1 }, { n: 'VOID', hair: '#3b1f7a', eye: '#c084fc', aura: '#8b5cf6', calm: true, speed: .15, glow: 1 }, { n: 'SOVEREIGN', hair: '#7c5cd6', hairGlow: '#b28cff', eye: '#b28cff', aura: '#c4b5fd', calm: true, speed: .06, glow: 1.2 }];
  const CARROT_FORMS = FORMS.map((f, i) => i < 7 ? f : i === 7 ? { n: 'STILL', hair: '#2e3138', hairGlow: '#dfe4ee', eye: '#c8ccd6', aura: '#e8ecf4', calm: true, speed: .15, glow: 1 } : { n: 'ASCENDANT', hair: '#f4f6fa', eye: '#f4f6fa', aura: '#ffffff', calm: true, speed: .06, glow: 1.2 });
  const CARROT_EYE_POWER = '#5eead4';

  class PomStage extends HTMLElement {
    static get observedAttributes() { return ['who', 'form', 'pose', 'autorotate', 'background', 'zoom', 'hide-aura']; }
    constructor() { super(); this.attachShadow({ mode: 'open' }); this.shadowRoot.innerHTML = '<style>:host{display:block;position:relative;width:100%;height:100%;min-height:40px;background:#0f111c;overflow:hidden}canvas{display:block;width:100%;height:100%}</style>'; this._yaw = 0; this._userYaw = 0; }
    connectedCallback() { this._alive = true; this._init(); }
    disconnectedCallback() { this._alive = false; cancelAnimationFrame(this._raf); this._ro && this._ro.disconnect(); }
    attributeChangedCallback(n) { if (!this._ready) return; if (n === 'background') { const b = this.getAttribute('background') || '#0f111c'; this._bg = b === 'transparent' ? null : b; this.style.background = b === 'transparent' ? 'transparent' : ''; } else if (n === 'zoom' || n === 'who') this._frame(); this._apply(); }
    get FORMS() { return FORMS; } get CARROT_FORMS() { return CARROT_FORMS; }
    setForm(i) { this.setAttribute('form', String(i)); } setPose(p) { this.setAttribute('pose', p); }

    // ONE shared WebGL renderer for every stage on the page (browsers drop contexts past ~16); each stage blits into its own 2D canvas.
    async _init() {
      const THREE = await loadThree(); if (!this._alive) return; this.THREE = THREE;
      const bgAttr = this.getAttribute('background') || '#0f111c', transparent = bgAttr === 'transparent'; if (!PomStage.shared) { const r = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); PomStage.shared = r; } const renderer = PomStage.shared; this._bg = transparent ? null : bgAttr; if (transparent) this.style.background = 'transparent';
      this._canvas = document.createElement('canvas'); this._canvas.style.cssText = 'display:block;width:100%;height:100%'; this._ctx = this._canvas.getContext('2d'); this.shadowRoot.appendChild(this._canvas); this._renderer = renderer;
      const scene = new THREE.Scene(); this._scene = scene;
      scene.add(new THREE.HemisphereLight('#f4efe6', '#1e2a5a', 1.1));
      const key = new THREE.DirectionalLight('#fff4e0', 2.2); key.position.set(-3, 5, 4); scene.add(key);
      const rim = new THREE.DirectionalLight('#3ab4ff', .9); rim.position.set(3, 2, -4); scene.add(rim);
      this._camera = new THREE.PerspectiveCamera(32, 1, .1, 100);
      const world = new THREE.Group(); scene.add(world); this._world = world;
      this._build(THREE, world);
      this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this);
      let dragging = false, lx = 0; const el = this._canvas;
      el.addEventListener('pointerdown', e => { dragging = true; lx = e.clientX; this._interacted = true; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', e => { if (dragging) { this._userYaw += (e.clientX - lx) * .01; lx = e.clientX; } });
      el.addEventListener('pointerup', () => dragging = false); el.addEventListener('pointercancel', () => dragging = false);
      this._ready = true; this._resize(); this._apply(); this._frame(); this._last = performance.now(); this._tick();
    }

    _build(THREE, world) {
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const tex = (hex, n = 8, v = .09) => { const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d'); const col = new THREE.Color(hex); for (let i = 0; i < n * n; i++) { const k = 1 + (rnd() - .5) * 2 * v; x.fillStyle = '#' + col.clone().multiplyScalar(k).getHexString(); x.fillRect(i % n, Math.floor(i / n), 1, 1); } const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; };
      const M = {}; const mat = (n, hex, v) => M[n] || (M[n] = new THREE.MeshStandardMaterial({ name: n, map: tex(hex, 8, v), roughness: .9, flatShading: true }));
      this._tex = tex; this.M = M;
      const pomRoot = new THREE.Group(), carRoot = new THREE.Group(); pomRoot.name = 'pom'; carRoot.name = 'carrot'; carRoot.position.x = 24 * S; world.add(pomRoot, carRoot); this._pomRoot = pomRoot; this._carRoot = carRoot;
      const mk = (root, prefix) => (n, w, h, d, x, y, z, mt) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, d * S), mt); b.name = prefix + n; b.position.set(x * S, y * S, z * S); root.add(b); return b; };
      const box = mk(pomRoot, ''), cbox = mk(carRoot, 'carrot_');
      // ---- POM ----
      const skin = mat('skin', '#f2c28f'), hair = mat('hair', '#0e0f14', .05), suit = mat('suit', '#1e2a5a'), plate = mat('plate', '#f4f1ea', .05), gold = mat('gold', '#d9a72b', .08), white = mat('white', '#f7f2e8', .03), dark = mat('dark', '#14151c', .02);
      box('legL', 4, 12, 4, -3, 6, 0, suit); box('legR', 4, 12, 4, 3, 6, 0, suit);
      box('bootL', 4.2, 6, 4.2, -3, 3, 0, plate); box('bootR', 4.2, 6, 4.2, 3, 3, 0, plate); box('cuffL', 4.8, 1.2, 4.8, -3, 6.4, 0, plate); box('cuffR', 4.8, 1.2, 4.8, 3, 6.4, 0, plate);
      box('torso', 8, 12, 4, 0, 18, 0, suit);
      box('plateFront', 8.4, 7, 1, 0, 20.5, 2.2, plate); box('plateBack', 8.4, 8, 1, 0, 20, -2.2, plate); box('plateSideL', 1, 7, 4.6, -4.2, 20.5, 0, plate); box('plateSideR', 1, 7, 4.6, 4.2, 20.5, 0, plate);
      box('neckline', 3, 1.6, .4, 0, 23.4, 2.75, suit); box('abdGold', 8.6, 2.4, 4.8, 0, 16.2, 0, gold); box('beltEdge', 9, 1, 5.2, 0, 15, 0, plate);
      box('shoulderL', 5, 2.6, 5, -6, 24, 0, plate); box('shoulderR', 5, 2.6, 5, 6, 24, 0, plate); box('shGoldL', 3, .8, 3, -6, 25.6, 0, gold); box('shGoldR', 3, .8, 3, 6, 25.6, 0, gold);
      box('armR', 4, 12, 4, 6, 18, 0, suit); box('gloveR', 4.4, 4, 4.4, 6, 12, 0, white); box('gcuffR', 4.6, 1, 4.6, 6, 14, 0, white);
      box('upperL', 4, 7, 4, -6, 21, 0, suit); box('foreL', 4, 6, 4, -6, 14.5, 0, suit); box('gloveL', 4.2, 3.6, 4.2, -6, 11.5, 0, white); box('gcuffL', 4.6, 1, 4.6, -6, 14, 0, white);
      box('head', 8, 8, 8, 0, 28, 0, skin);
      box('hairCap', 8.6, 2.6, 8.6, 0, 32.6, 0, hair); box('fringe', 8.6, 1.2, 1.2, 0, 31.2, 3.8, hair); box('fringe2', 8.6, 1, 1, 0, 30.3, 3.9, hair); box('peak', 2, 1.6, 1, 0, 29.8, 4, hair); box('peakL', 2, 1.2, 1, -2, 30.6, 4, hair); box('peakR', 2, 1.2, 1, 2, 30.6, 4, hair);
      box('sideL', 1.2, 3, 8.6, -4.3, 30.4, 0, hair); box('sideR', 1.2, 3, 8.6, 4.3, 30.4, 0, hair); box('back', 8.6, 3, 1.2, 0, 30.4, -3.8, hair);
      const browMatP = mat('browP', '#14151c', .02), browMatC = mat('browC', '#14151c', .02);
      box('browL', 2.6, .8, .3, -2, 29.5, 4.1, browMatP).rotation.z = -.2; box('browR', 2.6, .8, .3, 2, 29.5, 4.1, browMatP).rotation.z = .2;
      box('eyeL', 2, 1.4, .3, -2, 28, 4.1, white); box('eyeR', 2, 1.4, .3, 2, 28, 4.1, white); box('pupilL', .8, 1.4, .35, -1.6, 28, 4.15, mat('pupil', '#14151c', .02)); box('pupilR', .8, 1.4, .35, 2.4, 28, 4.15, M.pupil); box('mouth', 3, .6, .3, 0, 25.8, 4.1, dark);
      const furMat = mat('fur', '#3a1010', .12); const furP = [box('furL', 4.4, 8, 4.4, -6, 18.5, 0, furMat), box('furR', 4.4, 8, 4.4, 6, 18.5, 0, furMat)]; furP.forEach(o => o.visible = false); this._furP = furP;
      // ---- CARROT ----
      const cskin = mat('c_skin', '#e8b07a'), chair = mat('c_hair', '#0e0f14', .05), csuit = mat('c_suit', '#ff7f1f'), cunder = mat('c_under', '#1f2d66', .06), csash = mat('c_sash', '#1f2d66', .06), cboot = mat('c_boot', '#1f2d66', .06), camber = mat('c_eye', '#14151c', .02), cteeth = mat('c_teeth', '#f7f2e8', .02);
      cbox('legL', 4, 12, 4, -2, 6, 0, csuit); cbox('legR', 4, 12, 4, 2, 6, 0, csuit); cbox('bootL', 4.2, 3, 4.2, -2, 1.5, 0, cboot); cbox('bootR', 4.2, 3, 4.2, 2, 1.5, 0, cboot); cbox('sockL', 4.1, 2.5, 4.1, -2, 4.25, 0, cboot); cbox('sockR', 4.1, 2.5, 4.1, 2, 4.25, 0, cboot);
      cbox('torso', 8, 12, 4, 0, 18, 0, csuit); cbox('under', 8.2, 3, 4.2, 0, 23, 0, cunder); cbox('sash', 8.4, 2, 4.4, 0, 13.5, 0, csash); cbox('sashTail', 2, 4, .6, 2.5, 11, 2.3, csash);
      cbox('armL', 4, 12, 4, -6, 18, 0, cskin); cbox('armR', 4, 12, 4, 6, 18, 0, cskin);
      cbox('shL', 4.2, 2, 4.2, -6, 23, 0, cunder); cbox('shR', 4.2, 2, 4.2, 6, 23, 0, cunder);
      cbox('bandL', 4.3, 2, 4.3, -6, 13.5, 0, csash); cbox('bandR', 4.3, 2, 4.3, 6, 13.5, 0, csash);
      cbox('head', 8, 8, 8, 0, 28, 0, cskin);
      cbox('hairCap', 8.6, 2, 8.6, 0, 32.2, 0, chair); cbox('fringe', 8.6, 1, 1, 0, 30.8, 3.9, chair); cbox('fringe2', 8.6, .8, 1, 0, 30.2, 3.95, chair); cbox('sideL', 1.2, 3, 8.6, -4.3, 30.5, 0, chair); cbox('sideR', 1.2, 3, 8.6, 4.3, 30.5, 0, chair);
      [[0, -3.5, 6], [-2.2, -3.6, 5], [2.2, -3.6, 5], [0, -1.5, 4.5], [-2.4, -1.4, 3.5], [2.4, -1.4, 3.5], [-1.2, -4.6, 3], [1.2, -4.6, 3]].forEach((s, k) => { cbox('sweep' + k, 2, s[2], 2, s[0], 33 + s[2] / 2, s[1], chair).rotation.x = -.35; });
      cbox('browL', 2.4, .7, .3, -2, 29.6, 4.1, browMatC).rotation.z = .15; cbox('browR', 2.4, .7, .3, 2, 29.6, 4.1, browMatC).rotation.z = -.15;
      cbox('eyeL', 2, 1.6, .3, -2, 28, 4.1, cteeth); cbox('eyeR', 2, 1.6, .3, 2, 28, 4.1, cteeth); cbox('pupilL', 1, 1.6, .35, -1.6, 28, 4.15, camber); cbox('pupilR', 1, 1.6, .35, 2.4, 28, 4.15, camber);
      cbox('grin', 4, 1, .3, 0, 25.6, 4.1, cunder); cbox('teeth', 3.2, .5, .35, 0, 25.75, 4.15, cteeth);
      // ---- limb pivots ----
      const P = n => world.getObjectByName(n);
      const pivot = (root, name, x, y, z, names) => { const pv = new THREE.Group(); pv.name = name; pv.position.set(x * S, y * S, z * S); root.add(pv); names.map(P).filter(Boolean).forEach(o => pv.attach(o)); return pv; };
      this.pv = {
        armPR: pivot(pomRoot, 'pv_armR', 6, 24, 0, ['armR', 'gloveR', 'gcuffR', 'furR']), armPL: pivot(pomRoot, 'pv_armL', -6, 24, 0, ['upperL', 'foreL', 'gloveL', 'gcuffL', 'furL']),
        legPL: pivot(pomRoot, 'pv_legL', -3, 12, 0, ['legL', 'bootL', 'cuffL']), legPR: pivot(pomRoot, 'pv_legR', 3, 12, 0, ['legR', 'bootR', 'cuffR']),
        armCR: pivot(carRoot, 'carrot_pv_armR', 6, 24, 0, ['carrot_armR', 'carrot_bandR']), armCL: pivot(carRoot, 'carrot_pv_armL', -6, 24, 0, ['carrot_armL', 'carrot_bandL']),
        legCL: pivot(carRoot, 'carrot_pv_legL', -2, 12, 0, ['carrot_legL', 'carrot_bootL', 'carrot_sockL']), legCR: pivot(carRoot, 'carrot_pv_legR', 2, 12, 0, ['carrot_legR', 'carrot_bootR', 'carrot_sockR']),
      };
      this._hairP = pomRoot.children.filter(o => /^(hairCap|fringe\d?|peak\w*|sideL|sideR|back)$/.test(o.name));
      this._hairC = carRoot.children.filter(o => /^carrot_(hairCap|fringe\d?|sideL|sideR|sweep\d)$/.test(o.name));
      this._browsP = pomRoot.children.filter(o => /^brow[LR]$/.test(o.name)); this._browsC = carRoot.children.filter(o => /^carrot_brow[LR]$/.test(o.name));
      this._browMatP = browMatP; this._browMatC = browMatC;
      // ---- aura + bolts (same recipe as Pom 3D.html) ----
      const mkAura = (root) => { const grp = new THREE.Group(); grp.name = 'aura'; for (let i = 0; i < 260; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(S * 1.4, S * 1.4, S * 1.4), new THREE.MeshBasicMaterial({ transparent: true, opacity: .8, depthWrite: false })); p.userData = { t: Math.random(), r: 6 + Math.random() * 4, a: Math.random() * Math.PI * 2, sp: .4 + Math.random() * .6 }; grp.add(p); } grp.visible = false; root.add(grp); return grp; };
      const mkBolt = (root) => { const geo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 7 }, () => new THREE.Vector3())); const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ transparent: true, opacity: .9 })); l.visible = false; root.add(l); return l; };
      this._auraP = mkAura(pomRoot); this._auraC = mkAura(carRoot); this._bolts = [mkBolt(pomRoot), mkBolt(pomRoot), mkBolt(carRoot), mkBolt(carRoot)];
    }

    _recolor(m, hex) { m.map = this._tex(hex, 8, .05); m.map.needsUpdate = true; m.needsUpdate = true; }

    _formIndex() { const v = this.getAttribute('form') || '0'; const i = FORMS.findIndex(f => f.n === v.toUpperCase()); return i >= 0 ? i : Math.max(0, Math.min(8, parseInt(v) || 0)); }

    _apply() {
      const fi = this._formIndex(), f = FORMS[fi], c = CARROT_FORMS[fi], M = this.M, hideAura = this.hasAttribute('hide-aura');
      const who = this.getAttribute('who') || 'both'; this._pomRoot.visible = who !== 'carrot'; this._carRoot.visible = who !== 'pom';
      const hairMatP = this._hairP[0].material, hairMatC = this._hairC[0].material;
      this._recolor(hairMatP, f.hair); hairMatP.emissive.set(f.hairGlow || '#000'); hairMatP.emissiveIntensity = f.hairGlow ? .35 : 0;
      this._recolor(M.pupil, fi ? f.eye : '#14151c'); M.pupil.emissive.set(fi ? f.eye : '#000'); M.pupil.emissiveIntensity = fi ? (f.glow || .5) : 0;
      this._recolor(this._browMatP, f.hair); this._browsP.forEach(o => o.visible = !f.noBrow);
      this._recolor(hairMatC, c.hair); hairMatC.emissive.set(c.hairGlow || '#000'); hairMatC.emissiveIntensity = c.hairGlow ? .35 : 0;
      const ce = fi === 0 ? '#14151c' : fi <= 3 ? CARROT_EYE_POWER : c.eye; this._recolor(M.c_eye, ce); M.c_eye.emissive.set(fi ? ce : '#000'); M.c_eye.emissiveIntensity = fi ? (c.glow || .5) : 0;
      this._recolor(this._browMatC, c.hair); this._browsC.forEach(o => o.visible = !c.noBrow);
      const pose = this.getAttribute('pose') || 'idle', hairMul = pose === 'powerup' ? 1.15 : 1;
      const grow = (parts, cap, s) => parts.forEach(o => { if (o.name === cap) { o.scale.y = s; o.position.y = (32.6 + (s - 1) * 1.3) * S; } else if (/sweep/.test(o.name)) { o.scale.y = s; o.position.y = (33 + (o.geometry.parameters.height / S) * s / 2) * S; } });
      grow(this._hairP, 'hairCap', (f.scale || 1) * hairMul); grow(this._hairC, 'carrot_hairCap', (c.scale || 1) * hairMul);
      this._furP.forEach(o => o.visible = !!f.fur);
      const auraOn = !hideAura && (pose === 'powerup' || pose === 'training');
      [[this._auraP, f], [this._auraC, c]].forEach(([grp, src]) => { const on = !hideAura && (!!src.aura || pose === 'powerup'); grp.visible = on; Object.assign(grp.userData, { violent: !!src.violent, calm: !!src.calm, speed: src.speed || 1, topK: fi === FORMS.length - 1 ? 1 : 0 }); const col = src.aura || (grp === this._auraP ? '#ff8a2a' : '#3ab4ff'); grp.children.forEach((p, i) => p.material.color.set(src.spark && i % 7 === 0 ? src.spark : col)); });
      this._bolts.forEach((b, i) => { const src = i < 2 ? f : c; b.visible = !hideAura && !!src.bolt; if (src.bolt) b.material.color.set(src.bolt); b.userData.violent = !!src.violent; b.userData.slow = !!src.slowBolt; });
      void auraOn;
    }

    _frame() {
      const who = this.getAttribute('who') || 'both', zoom = parseFloat(this.getAttribute('zoom') || '1');
      const cx = who === 'both' ? 12 * S : who === 'carrot' ? 24 * S : 0, cy = 18 * S;
      const dist = (who === 'both' ? 6.8 : 4.6) / zoom;
      this._target = new this.THREE.Vector3(cx, cy, 0); this._dist = dist;
    }

    _resize() { const w = this.clientWidth || 300, h = this.clientHeight || 200; const dpr = Math.min(devicePixelRatio, 2); this._w = Math.round(w * dpr); this._h = Math.round(h * dpr); this._canvas.width = this._w; this._canvas.height = this._h; this._camera.aspect = w / h; this._camera.updateProjectionMatrix(); }

    _pose(now) {
      const pv = this.pv, pose = this.getAttribute('pose') || 'idle', set = (o, x = 0, y = 0, z = 0) => o.rotation.set(x, y, z);
      Object.values(pv).forEach(o => set(o)); this._pomRoot.rotation.set(0, 0, 0); this._carRoot.rotation.set(0, 0, 0);
      if (pose === 'idle') { pv.armPL.rotation.set(.55, 0, -.35); pv.armCL.rotation.x = -1.1; pv.armCR.rotation.x = -1.3; }
      else if (pose === 'training') { const lean = Math.floor(now / 500) % 2 ? .1 : -.1; set(pv.armPL, -1.05); set(pv.armPR, -1.05); set(pv.armCL, -1.05); set(pv.armCR, -1.05); set(pv.legPL, -.3); set(pv.legPR, .3); set(pv.legCL, -.3); set(pv.legCR, .3); this._pomRoot.rotation.z = lean; this._carRoot.rotation.z = -lean; }
      else if (pose === 'resting') { this._pomRoot.rotation.x = .08; this._carRoot.rotation.x = .08; }
      else if (pose === 'powerup') { set(pv.armPL, .9, 0, -.7); set(pv.armPR, .9, 0, .7); set(pv.armCL, .9, 0, -.7); set(pv.armCR, .9, 0, .7); set(pv.legPL, -.3); set(pv.legPR, .3); set(pv.legCL, -.3); set(pv.legCR, .3); }
    }

    _tick() {
      if (!this._alive) return; this._raf = requestAnimationFrame(() => this._tick());
      const now = performance.now(), dt = Math.min(.05, (now - this._last) / 1000); this._last = now; const THREE = this.THREE;
      if (this.hasAttribute('autorotate') && !this._interacted) this._yaw += dt * .35;
      const yaw = this._yaw + this._userYaw + .45; const t = this._target, d = this._dist;
      this._camera.position.set(t.x + Math.sin(yaw) * d, t.y + d * .38, t.z + Math.cos(yaw) * d); this._camera.lookAt(t);
      this._pose(now);
      [this._auraP, this._auraC].forEach(grp => { if (!grp.visible) return; const G = grp.userData; const vi = G.violent ? 2 : 1, ca = G.calm, speed = G.speed || 1; grp.children.forEach((p, i) => { const u = p.userData; const wantBlend = ca ? THREE.AdditiveBlending : THREE.NormalBlending; if (p.material.blending !== wantBlend) { p.material.blending = wantBlend; p.material.needsUpdate = true; } if (!ca && i >= 160) { p.scale.setScalar(0); return; } u.t += .016 * u.sp * (ca ? .25 : 1) * vi * speed * (ca && speed < 1 ? 4 : 1); if (u.t > 1) { u.t = 0; u.a = Math.random() * Math.PI * 2; u.r = 5 + Math.random() * 4; } const top = 1 + .35 * (G.topK || 0); const y = u.t * (ca ? 48 * top : 34), w = u.r * vi * (ca ? 1.15 * top : 1.4) * (1 - u.t * (ca ? .25 : .5)) + Math.sin(u.t * 9 * vi + u.a) * .8 * vi; p.position.set(Math.cos(u.a) * w * S, y * S, Math.sin(u.a) * w * S * (vi > 1 ? 1 : .7)); const s = ca ? (1 - u.t) * .55 + .25 : (1 - u.t) * 1.6 + .4; p.scale.setScalar(s); p.material.opacity = (ca ? 1 : .85) * (1 - u.t * (ca ? .55 : 1)); }); });
      this._bolts.forEach(b => { if (!b.visible) return; if (Math.random() < (b.userData.violent ? .45 : b.userData.slow ? .04 : .15)) { const pos = b.geometry.attributes.position; const a = Math.random() * Math.PI * 2; let x = Math.cos(a) * 7, z = Math.sin(a) * 5, y = 2 + Math.random() * 10; for (let i = 0; i < 7; i++) { pos.setXYZ(i, x * S, y * S, z * S); x += (Math.random() - .5) * 5; z += (Math.random() - .5) * 4; y += 3 + Math.random() * 3; } pos.needsUpdate = true; b.material.opacity = .9; } else b.material.opacity *= (b.userData.slow ? .95 : .8); });
      const r = this._renderer, w = this._w || 1, hh = this._h || 1; const rect = this.getBoundingClientRect(); if (rect.bottom < -50 || rect.top > innerHeight + 50) return; if (r.domElement.width !== w || r.domElement.height !== hh) r.setSize(w, hh, false); r.setClearColor(this._bg || '#000000', this._bg ? 1 : 0); r.render(this._scene, this._camera); this._ctx.clearRect(0, 0, w, hh); this._ctx.drawImage(r.domElement, 0, 0);
    }
  }
  customElements.define('pom-stage', PomStage);
})();
