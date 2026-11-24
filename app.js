// ============================================================
// NEON DODGE 3D  -  realistische versie (Three.js r128)
// Spel-logica blijft 2D (x/y in "pixels"), de weergave is 3D.
// 2D x  -> wereld X,  2D y -> wereld Z (boven = ver weg)
// Alle texturen worden procedureel gegenereerd (geen losse bestanden).
// ============================================================

const canvas = document.getElementById("game");

const scoreText = document.getElementById("score");
const bestText = document.getElementById("best");
const message = document.getElementById("message");
const startButton = document.getElementById("startButton");
const overlay = document.getElementById("overlay");
const overlayScore = document.getElementById("overlayScore");

const W = canvas.width;   // 440
const H = canvas.height;  // 550
const S = 0.1;            // pixels -> wereld-eenheden

const toX = x => (x - W / 2) * S;
const toZ = y => (y - H / 2) * S;
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;

let player;
let meteors = [];
let energy = [];
let debris = [];
let effects = [];

let score = 0;
let best = Number(localStorage.getItem("neonBest")) || 0;

let running = false;
let keys = {};

let meteorTimer = 0;
let energyTimer = 0;
let lastTime = 0;
let shake = 0;
let flash = 0;

bestText.textContent = best;

// ------------------------------------------------------------
// RUIS-FUNCTIES voor procedurele texturen en rotsen
// ------------------------------------------------------------

function hash(x, y, z) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

const smooth = t => t * t * (3 - 2 * t);

// 2D ruis die naadloos herhaalt (voor tegelbare texturen)
function pnoise2(x, y, per, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = smooth(x - xi), ty = smooth(y - yi);
    const x0 = ((xi % per) + per) % per, x1 = (x0 + 1) % per;
    const y0 = ((yi % per) + per) % per, y1 = (y0 + 1) % per;
    const a = hash(x0, y0, seed), b = hash(x1, y0, seed);
    const c = hash(x0, y1, seed), d = hash(x1, y1, seed);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function fbmP(x, y, per, oct, seed) {
    let s = 0, a = 0.5, f = 1, t = 0;
    for (let o = 0; o < oct; o++) {
        s += a * pnoise2(x * f, y * f, per * f, seed + o * 17);
        t += a; a *= 0.5; f *= 2;
    }
    return s / t;
}

// 3D ruis (voor het vervormen van rotsen)
function vnoise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const tx = smooth(x - xi), ty = smooth(y - yi), tz = smooth(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
        l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), tx), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), tx), ty),
        l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), tx), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), tx), ty),
        tz
    );
}

function fbm3(x, y, z, oct) {
    let s = 0, a = 0.5, f = 1, t = 0;
    for (let o = 0; o < oct; o++) {
        s += a * vnoise3(x * f, y * f, z * f);
        t += a; a *= 0.5; f *= 2;
    }
    return s / t;
}

// ------------------------------------------------------------
// RENDERER, SCENE, CAMERA
// ------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, H, false);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const FOG_COLOR = 0x0a1020;
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0075);

// Camera kijkt nu steiler naar beneden (~51 graden i.p.v. ~41)
const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 400);
const CAM_BASE = new THREE.Vector3(0, 50, 52);
const CAM_TARGET_Z = 12;
camera.position.copy(CAM_BASE);
camera.lookAt(0, 0, CAM_TARGET_Z);

// ------------------------------------------------------------
// OMGEVINGSMAP (voor realistische metaalreflecties)
// ------------------------------------------------------------

function makeSkyTexture() {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 512;
    const g = c.getContext("2d");

    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, "#0a1230");
    grad.addColorStop(0.45, "#27385f");
    grad.addColorStop(0.52, "#4b5a80");
    grad.addColorStop(0.58, "#161a28");
    grad.addColorStop(1.0, "#0b0d14");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);

    for (let i = 0; i < 700; i++) {
        g.fillStyle = "rgba(255,255,255," + rand(0.2, 0.9) + ")";
        g.fillRect(Math.random() * 1024, Math.random() * 230, 1.5, 1.5);
    }

    const blob = (x, y, r, col) => {
        const rg = g.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, col);
        rg.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = rg;
        g.fillRect(x - r, y - r, r * 2, r * 2);
    };

    blob(220, 110, 110, "rgba(210,225,255,1)");   // maan / koel licht
    blob(720, 130, 90, "rgba(190,210,255,0.9)");
    blob(500, 240, 140, "rgba(255,140,60,0.8)");  // vuur-gloed aan de horizon
    blob(900, 250, 120, "rgba(255,120,50,0.6)");

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

{
    const pmrem = new THREE.PMREMGenerator(renderer);
    const sky = makeSkyTexture();
    scene.environment = pmrem.fromEquirectangular(sky).texture;
    sky.dispose();
    pmrem.dispose();
}

// ------------------------------------------------------------
// LICHT
// ------------------------------------------------------------

scene.add(new THREE.HemisphereLight(0x5a70a8, 0x1a1410, 0.55));

const moon = new THREE.DirectionalLight(0xbcd0ff, 1.8);
moon.position.set(-30, 60, 25);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -70;
moon.shadow.camera.right = 70;
moon.shadow.camera.top = 70;
moon.shadow.camera.bottom = -70;
moon.shadow.camera.near = 1;
moon.shadow.camera.far = 160;
moon.shadow.bias = -0.0006;
moon.shadow.normalBias = 0.05;
scene.add(moon);

// Vuurlicht van de dichtstbijzijnde meteoren
const fireLights = [0, 1, 2].map(() => {
    const l = new THREE.PointLight(0xff7a30, 0, 26, 2);
    scene.add(l);
    return l;
});

// Flits bij explosies
const flashLight = new THREE.PointLight(0xffa050, 0, 60, 2);
scene.add(flashLight);

// ------------------------------------------------------------
// TEXTUREN
// ------------------------------------------------------------

const maxAniso = renderer.capabilities.getMaxAnisotropy();

function canvasTexture(c, srgb) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return t;
}

// Glow (zachte lichtvlek)
function makeGlowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.12)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
}

const glowTexture = makeGlowTexture();

function makeGlow(color, scale, opacity) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: color,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: opacity === undefined ? 1 : opacity,
        depthWrite: false
    }));
    sprite.scale.set(scale, scale, 1);
    return sprite;
}

// Rotsachtige grond: basalt, scheuren, kiezels
function makeGroundTextures() {
    const N = 512;
    const cc = document.createElement("canvas"); cc.width = cc.height = N;
    const cb = document.createElement("canvas"); cb.width = cb.height = N;
    const gc = cc.getContext("2d"), gb = cb.getContext("2d");
    const ic = gc.createImageData(N, N), ib = gb.createImageData(N, N);

    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const u = x / N, v = y / N;
            const big = fbmP(u * 4, v * 4, 4, 5, 1);
            const fine = fbmP(u * 32, v * 32, 32, 3, 2);
            const warm = fbmP(u * 6, v * 6, 6, 3, 5);
            const ridge = 1 - Math.abs(fbmP(u * 6, v * 6, 6, 4, 3) * 2 - 1);
            const crack = Math.max(0, (ridge - 0.92) / 0.08);
            const pebble = Math.max(0, fbmP(u * 48, v * 48, 48, 2, 9) - 0.62) * 2.2;

            let h = big * 0.55 + fine * 0.35 + pebble * 0.4 - crack * 0.55;
            h = Math.max(0, Math.min(1, h));

            const dark = 1 - crack * 0.85;
            const r = lerp(24, 92, h) * dark * (0.9 + warm * 0.3);
            const g = lerp(22, 80, h) * dark * (0.9 + warm * 0.1);
            const b = lerp(26, 74, h) * dark * (1.05 - warm * 0.25);

            const i = (y * N + x) * 4;
            ic.data[i] = r; ic.data[i + 1] = g; ic.data[i + 2] = b; ic.data[i + 3] = 255;
            const hv = h * 255;
            ib.data[i] = ib.data[i + 1] = ib.data[i + 2] = hv; ib.data[i + 3] = 255;
        }
    }

    gc.putImageData(ic, 0, 0);
    gb.putImageData(ib, 0, 0);
    return { map: canvasTexture(cc, true), bump: canvasTexture(cb, false) };
}

// Meteorietrots: donker gesteente met gloeiende lava-scheuren
function makeRockTextures() {
    const N = 256;
    const cm = document.createElement("canvas"); cm.width = cm.height = N;
    const ce = document.createElement("canvas"); ce.width = ce.height = N;
    const cb = document.createElement("canvas"); cb.width = cb.height = N;
    const gm = cm.getContext("2d"), ge = ce.getContext("2d"), gb = cb.getContext("2d");
    const im = gm.createImageData(N, N), ie = ge.createImageData(N, N), ib = gb.createImageData(N, N);

    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const u = x / N, v = y / N;
            const n = fbmP(u * 5, v * 5, 5, 5, 21);
            const fine = fbmP(u * 24, v * 24, 24, 3, 22);
            const ridge = 1 - Math.abs(fbmP(u * 4, v * 4, 4, 5, 23) * 2 - 1);
            const lava = Math.max(0, Math.min(1, (ridge - 0.86) / 0.1));
            const edge = Math.max(0, Math.min(1, (ridge - 0.8) / 0.1));

            const h = n * 0.6 + fine * 0.4;
            const shade = lerp(28, 85, h) * (1 - edge * 0.5);

            const i = (y * N + x) * 4;
            im.data[i] = shade * 1.05; im.data[i + 1] = shade * 0.92; im.data[i + 2] = shade * 0.85; im.data[i + 3] = 255;

            // Emissive: oranje met gele kern
            ie.data[i] = 255 * lava;
            ie.data[i + 1] = (70 + 140 * lava * lava) * lava;
            ie.data[i + 2] = 10 * lava;
            ie.data[i + 3] = 255;

            const bv = (h * (1 - lava * 0.6)) * 255;
            ib.data[i] = ib.data[i + 1] = ib.data[i + 2] = bv; ib.data[i + 3] = 255;
        }
    }

    gm.putImageData(im, 0, 0);
    ge.putImageData(ie, 0, 0);
    gb.putImageData(ib, 0, 0);
    return {
        map: canvasTexture(cm, true),
        emissive: canvasTexture(ce, true),
        bump: canvasTexture(cb, false)
    };
}

const groundTex = makeGroundTextures();
const rockTex = makeRockTextures();

// ------------------------------------------------------------
// WERELD: grond
// ------------------------------------------------------------

const TILE = 24; // wereld-eenheden per textuur-tegel
groundTex.map.repeat.set(300 / TILE, 300 / TILE);
groundTex.bump.repeat.set(300 / TILE, 300 / TILE);

const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({
        map: groundTex.map,
        bumpMap: groundTex.bump,
        bumpScale: 2.2,
        roughness: 0.95,
        metalness: 0.0,
        envMapIntensity: 0.5
    })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const FIELD_W = W * S; // 44

// ------------------------------------------------------------
// ROTSEN (vervormde iso-bollen)
// ------------------------------------------------------------

function makeRockGeometry(seed) {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();

    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = fbm3(v.x * 1.5 + seed * 7.1, v.y * 1.5 + seed * 3.3, v.z * 1.5 + seed * 5.9, 4);
        const d = 0.7 + n * 0.62;
        v.multiplyScalar(d);
        p.setXYZ(i, v.x, v.y, v.z);
    }

    geo.computeVertexNormals();
    return geo;
}

const rockGeos = [1, 2, 3, 4].map(makeRockGeometry);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const meteorMat = new THREE.MeshStandardMaterial({
    map: rockTex.map,
    bumpMap: rockTex.bump,
    bumpScale: 3,
    emissive: 0xffffff,
    emissiveMap: rockTex.emissive,
    emissiveIntensity: 1.6,
    roughness: 0.95,
    metalness: 0.05
});

const propMat = new THREE.MeshStandardMaterial({
    map: rockTex.map,
    bumpMap: rockTex.bump,
    bumpScale: 3,
    color: 0x9a928a,
    roughness: 1,
    metalness: 0
});

// ------------------------------------------------------------
// SCROLLENDE OMGEVING: bakens en rotsen langs het veld
// ------------------------------------------------------------

const beacons = [];
const BEACON_SPACING = 9.6;
const BEACON_COUNT = 14;
const BEACON_SPAN = BEACON_SPACING * BEACON_COUNT;
const BEACON_ZMAX = 50;

const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.8, roughness: 0.4 });
const lampMat = new THREE.MeshBasicMaterial({ color: 0x7dffae });
const postGeo = new THREE.CylinderGeometry(0.12, 0.2, 2.4, 10);
const lampGeo = new THREE.SphereGeometry(0.22, 12, 8);
const padGeo = new THREE.PlaneGeometry(1, 1);
const padMat = new THREE.MeshBasicMaterial({
    map: glowTexture, color: 0x40ff90, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
});

[-1, 1].forEach(side => {
    for (let i = 0; i < BEACON_COUNT; i++) {
        const g = new THREE.Group();

        const post = new THREE.Mesh(postGeo, postMat);
        post.position.y = 1.2;
        post.castShadow = true;
        g.add(post);

        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.y = 2.55;
        g.add(lamp);

        const glow = makeGlow(0x55ff90, 3.2, 0.9);
        glow.position.y = 2.55;
        g.add(glow);

        const pad = new THREE.Mesh(padGeo, padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.05;
        pad.scale.setScalar(6);
        g.add(pad);

        g.position.set(side * (FIELD_W / 2 + 1.4), 0, BEACON_ZMAX - i * BEACON_SPACING);
        scene.add(g);
        beacons.push(g);
    }
});

const props = [];
const PROP_COUNT = 80;
const PROP_SPAN = 140;
const PROP_ZMAX = 50;

for (let i = 0; i < PROP_COUNT; i++) {
    const m = new THREE.Mesh(pick(rockGeos), propMat);
    const s = Math.pow(Math.random(), 2.2) * 4.5 + 0.6;
    m.scale.set(s * rand(0.9, 1.5), s * rand(0.5, 0.9), s * rand(0.9, 1.4));
    m.rotation.set(rand(-0.3, 0.3), rand(0, 6.28), rand(-0.3, 0.3));

    const side = Math.random() < 0.5 ? -1 : 1;
    m.position.set(side * rand(FIELD_W / 2 + 5, 95), s * 0.25, PROP_ZMAX - Math.random() * PROP_SPAN);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    props.push(m);
}

// ------------------------------------------------------------
// DEELTJES: vuur, rook, vonken (eigen shader, per-deeltje grootte)
// ------------------------------------------------------------

const PARTICLE_VERT = `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
uniform float scale;
varying float vAlpha;
varying vec3 vColor;
void main() {
    vAlpha = alpha;
    vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vColor;
void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor, t.a * vAlpha);
}`;

// types: 0 vuur, 1 uitlaat (blauw), 2 explosie, 3 rook, 4 groene vonk, 5 hete vonk
function particleColor(type, age, out) {
    const mix = (a, b, t) => {
        out.r = lerp(a[0], b[0], t); out.g = lerp(a[1], b[1], t); out.b = lerp(a[2], b[2], t);
    };
    switch (type) {
        case 0:
        case 2:
            if (age < 0.25) mix([1, 0.9, 0.55], [1, 0.55, 0.12], age / 0.25);
            else mix([1, 0.55, 0.12], [0.4, 0.07, 0.02], (age - 0.25) / 0.75);
            out.a = (1 - age) * (type === 2 ? 0.9 : 0.8);
            break;
        case 1:
            mix([0.85, 0.95, 1], [0.25, 0.5, 1], age);
            out.a = (1 - age) * 0.9;
            break;
        case 3:
            mix([0.16, 0.15, 0.16], [0.28, 0.27, 0.28], age);
            out.a = Math.min(age * 6, 1) * (1 - age) * 0.6;
            break;
        case 4:
            mix([0.6, 1, 0.75], [0.1, 0.7, 0.35], age);
            out.a = 1 - age;
            break;
        default:
            mix([1, 0.95, 0.7], [1, 0.45, 0.1], age);
            out.a = 1 - age;
    }
}

class Particles {
    constructor(max, additive) {
        this.max = max;
        this.head = 0;
        this.pos = new Float32Array(max * 3);
        this.vel = new Float32Array(max * 3);
        this.col = new Float32Array(max * 3);
        this.size = new Float32Array(max);
        this.alpha = new Float32Array(max);
        this.life = new Float32Array(max);
        this.lifeMax = new Float32Array(max);
        this.s0 = new Float32Array(max);
        this.grow = new Float32Array(max);
        this.grav = new Float32Array(max);
        this.type = new Uint8Array(max);
        this.tmp = { r: 0, g: 0, b: 0, a: 0 };

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
        geo.setAttribute("pcolor", new THREE.BufferAttribute(this.col, 3));
        geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
        geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1));

        this.uniforms = { map: { value: glowTexture }, scale: { value: 1 } };

        this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader: PARTICLE_VERT,
            fragmentShader: PARTICLE_FRAG,
            transparent: true,
            depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
        }));
        this.points.frustumCulled = false;
        scene.add(this.points);
    }

    emit(type, x, y, z, vx, vy, vz, life, size, grow, grav) {
        const i = this.head;
        this.head = (this.head + 1) % this.max;
        const k = i * 3;
        this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
        this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
        this.life[i] = life; this.lifeMax[i] = life;
        this.s0[i] = size; this.grow[i] = grow; this.grav[i] = grav || 0;
        this.type[i] = type;
    }

    update(dt) {
        const t = this.tmp;
        this.uniforms.scale.value = (renderer.domElement.height / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

        for (let i = 0; i < this.max; i++) {
            if (this.life[i] <= 0) {
                if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; }
                continue;
            }

            this.life[i] -= dt;
            if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }

            const k = i * 3;
            this.vel[k + 1] -= this.grav[i] * dt;
            this.pos[k] += this.vel[k] * dt;
            this.pos[k + 1] += this.vel[k + 1] * dt;
            this.pos[k + 2] += this.vel[k + 2] * dt;

            const age = 1 - this.life[i] / this.lifeMax[i];
            this.size[i] = Math.max(0, this.s0[i] + this.grow[i] * age);

            particleColor(this.type[i], age, t);
            this.col[k] = t.r; this.col[k + 1] = t.g; this.col[k + 2] = t.b;
            this.alpha[i] = t.a;
        }

        const a = this.points.geometry.attributes;
        a.position.needsUpdate = true;
        a.pcolor.needsUpdate = true;
        a.size.needsUpdate = true;
        a.alpha.needsUpdate = true;
    }
}

const fireSys = new Particles(4500, true);
const smokeSys = new Particles(2500, false);

// ------------------------------------------------------------
// SPELER: gedetailleerd ruimteschip
// ------------------------------------------------------------

const hullMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.85, roughness: 0.28, envMapIntensity: 1.3 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b2028, metalness: 0.6, roughness: 0.5, envMapIntensity: 1.0 });
const accentMat = new THREE.MeshStandardMaterial({ color: 0x0a3d20, emissive: 0x2cff7a, emissiveIntensity: 1.6, roughness: 0.4 });
const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1b2e, metalness: 0.1, roughness: 0.05,
    clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.2
});

const shipGroup = new THREE.Group();
const shipBody = new THREE.Group();   // schaal 0.7 (past bij de hitbox)
shipBody.scale.setScalar(0.7);
shipGroup.add(shipBody);

// Romp (lathe)
{
    const profile = [
        [0.0, 2.9], [0.10, 2.7], [0.28, 2.2], [0.46, 1.4], [0.58, 0.5],
        [0.62, -0.4], [0.60, -1.3], [0.52, -1.9], [0.46, -2.1], [0.0, -2.1]
    ].map(p => new THREE.Vector2(p[0], p[1]));

    const fus = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), hullMat);
    fus.rotation.x = -Math.PI / 2;   // neus naar -Z
    fus.scale.set(1, 1, 0.55);       // afgeplat
    shipBody.add(fus);
}

// Cockpit
{
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 18), glassMat);
    cockpit.scale.set(0.75, 0.6, 1.7);
    cockpit.position.set(0, 0.26, -0.7);
    shipBody.add(cockpit);
}

// Vleugels
{
    const shape = new THREE.Shape();
    shape.moveTo(0.45, -0.2);
    shape.lineTo(3.4, 1.9);
    shape.lineTo(3.4, 2.35);
    shape.lineTo(0.45, 1.8);
    shape.closePath();

    const wingGeo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1
    });

    const right = new THREE.Mesh(wingGeo, hullMat);
    right.rotation.x = Math.PI / 2;
    right.position.y = 0.05;
    shipBody.add(right);

    const left = new THREE.Mesh(wingGeo, hullMat);
    left.rotation.x = Math.PI / 2;
    left.position.y = 0.05;
    left.scale.x = -1;
    shipBody.add(left);

    // Staartvinnen
    [-1, 1].forEach(side => {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.9), darkMat);
        fin.position.set(side * 0.75, 0.55, 1.85);
        fin.rotation.z = side * -0.25;
        shipBody.add(fin);
    });

    // Groene accentstreep
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 1.8), accentMat);
    stripe.position.set(0, 0.36, 0.5);
    shipBody.add(stripe);
}

// Motoren + gloeiende nozzles
const nozzleGlows = [];
const nozzleLocal = [];

[-1, 1].forEach(side => {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.7, 18), hullMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.95, -0.05, 1.4);
    shipBody.add(pod);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 10, 20), darkMat);
    ring.position.set(side * 0.95, -0.05, 2.27);
    shipBody.add(ring);

    const core = new THREE.Mesh(new THREE.CircleGeometry(0.33, 18), new THREE.MeshBasicMaterial({ color: 0xcfe8ff }));
    core.position.set(side * 0.95, -0.05, 2.28);
    shipBody.add(core);

    const glow = makeGlow(0x6fb4ff, 2.6, 0.95);
    glow.position.set(side * 0.95, -0.05, 2.5);
    shipBody.add(glow);
    nozzleGlows.push(glow);

    nozzleLocal.push(new THREE.Vector3(side * 0.95, -0.05, 2.4));
});

// Navigatielichten
const navLights = [];
[[-1, 0xff2a2a], [1, 0x2aff5a]].forEach(([side, color]) => {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color }));
    bulb.position.set(side * 3.4, 0.05, 2.1);
    shipBody.add(bulb);

    const glow = makeGlow(color, 1.6, 0.9);
    glow.position.copy(bulb.position);
    shipBody.add(glow);
    navLights.push(glow);
});

shipBody.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
});

// Licht van de motoren
const engineLight = new THREE.PointLight(0x7fb8ff, 1.6, 16, 2);
engineLight.position.set(0, 0.4, 2.8);
shipGroup.add(engineLight);

scene.add(shipGroup);

// ------------------------------------------------------------
// KEYBOARD
// ------------------------------------------------------------

document.addEventListener("keydown", function (e) {
    const key = e.key.toLowerCase();

    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
        e.preventDefault();
    }

    keys[key] = true;
});

document.addEventListener("keyup", function (e) {
    keys[e.key.toLowerCase()] = false;
});

window.addEventListener("blur", () => { keys = {}; });

// ------------------------------------------------------------
// PLAYER
// ------------------------------------------------------------

function createPlayer() {
    return {
        x: W / 2,
        y: H - 65,
        size: 18,
        speed: 270,
        vx: 0,
        vz: 0
    };
}

// ------------------------------------------------------------
// START GAME
// ------------------------------------------------------------

function startGame() {
    clearObjects();

    player = createPlayer();

    score = 0;
    meteorTimer = 0;
    energyTimer = 0;
    shake = 0;
    flash = 0;
    running = true;

    shipGroup.visible = true;
    overlay.classList.add("hidden");

    scoreText.textContent = score;
    message.textContent = "SURVIVE!";
    startButton.textContent = "RESTART GAME";
}

function clearObjects() {
    meteors.forEach(m => scene.remove(m.mesh));
    energy.forEach(e => scene.remove(e.mesh));
    debris.forEach(d => scene.remove(d.mesh));
    effects.forEach(f => scene.remove(f.mesh));
    meteors = [];
    energy = [];
    debris = [];
    effects = [];
}

// ------------------------------------------------------------
// OBJECTEN MAKEN
// ------------------------------------------------------------

const decalGeo = new THREE.PlaneGeometry(1, 1);
const fireDecalMat = new THREE.MeshBasicMaterial({
    map: glowTexture, color: 0xff6a20, transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
});
const greenDecalMat = new THREE.MeshBasicMaterial({
    map: glowTexture, color: 0x30ff80, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
});

function createMeteor() {
    const size = 12 + Math.random() * 15;
    const r = size * S;
    const hover = r * 0.95 + 0.4;

    const group = new THREE.Group();

    const rock = new THREE.Mesh(pick(rockGeos), meteorMat);
    rock.scale.set(r * rand(0.9, 1.2), r * rand(0.8, 1.05), r * rand(0.9, 1.25));
    rock.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);

    group.add(makeGlow(0xff6a2a, r * 4.2, 0.85));

    const decal = new THREE.Mesh(decalGeo, fireDecalMat);
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = -hover + 0.06;
    decal.scale.setScalar(r * 8);
    group.add(decal);

    const m = {
        x: 20 + Math.random() * (W - 40),
        y: -250,
        size: size,
        speed: 150 + Math.random() * 100 + score * 1.5,
        mesh: group,
        rock: rock,
        hover: hover,
        trailAcc: 0,
        smokeAcc: 0,
        spin: new THREE.Vector3(rand(-1.5, 1.5), rand(-1.5, 1.5), rand(-1.5, 1.5))
    };

    group.position.set(toX(m.x), hover, toZ(m.y));
    scene.add(group);
    meteors.push(m);
}

const crystalGeo = new THREE.OctahedronGeometry(1, 0);
const crystalMat = new THREE.MeshStandardMaterial({
    color: 0x2bff7a, emissive: 0x16c85a, emissiveIntensity: 1.5,
    roughness: 0.15, metalness: 0.2, flatShading: true
});
const coreMat = new THREE.MeshBasicMaterial({ color: 0xd6ffe6 });

function createEnergy() {
    const group = new THREE.Group();

    const gem = new THREE.Mesh(crystalGeo, crystalMat);
    gem.scale.set(0.9, 1.5, 0.9);
    gem.castShadow = true;
    group.add(gem);

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), coreMat);
    group.add(core);

    group.add(makeGlow(0x40ff90, 6, 0.9));

    const decal = new THREE.Mesh(decalGeo, greenDecalMat);
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = -1.6 + 0.06;
    decal.scale.setScalar(6);
    group.add(decal);

    const e = {
        x: 20 + Math.random() * (W - 40),
        y: -250,
        size: 9,
        speed: 120,
        mesh: group,
        gem: gem,
        sparkAcc: 0
    };

    group.position.set(toX(e.x), 1.6, toZ(e.y));
    scene.add(group);
    energy.push(e);
}

// ------------------------------------------------------------
// EFFECTEN: schokgolf, energie-burst, explosie
// ------------------------------------------------------------

const ringGeo = new THREE.RingGeometry(0.85, 1, 64);

function addRing(x, z, color, maxScale, dur) {
    const mat = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.15, z);
    mesh.scale.setScalar(0.5);
    scene.add(mesh);
    effects.push({ mesh: mesh, t: 0, dur: dur, maxScale: maxScale });
}

function energyBurst(x, y, z) {
    for (let i = 0; i < 30; i++) {
        const a = rand(0, 6.28), sp = rand(3, 11);
        fireSys.emit(4, x, y, z, Math.cos(a) * sp, rand(2, 9), Math.sin(a) * sp, rand(0.4, 0.9), rand(0.5, 1.1), -0.3, 18);
    }
    addRing(x, z, 0x40ff90, 7, 0.45);
}

const debrisGeos = [
    new THREE.BoxGeometry(0.5, 0.12, 0.8),
    new THREE.BoxGeometry(0.3, 0.3, 0.9),
    new THREE.TetrahedronGeometry(0.4),
    new THREE.BoxGeometry(1.0, 0.08, 0.5)
];

function explode(x, y) {
    const wx = toX(x), wz = toZ(y), wy = 1.2;

    // vuurbal
    for (let i = 0; i < 40; i++) {
        const a = rand(0, 6.28), up = rand(-0.2, 1), sp = rand(2, 9);
        fireSys.emit(2, wx, wy, wz,
            Math.cos(a) * sp, up * 5, Math.sin(a) * sp,
            rand(0.6, 1.3), rand(2.5, 5), rand(3, 7), 0);
    }

    // vonken
    for (let i = 0; i < 110; i++) {
        const a = rand(0, 6.28), sp = rand(8, 30);
        fireSys.emit(5, wx, wy, wz,
            Math.cos(a) * sp, rand(4, 20), Math.sin(a) * sp,
            rand(0.5, 1.5), rand(0.35, 0.8), -0.2, 28);
    }

    // rook
    for (let i = 0; i < 50; i++) {
        const a = rand(0, 6.28), sp = rand(1, 5);
        smokeSys.emit(3, wx + rand(-1, 1), wy, wz + rand(-1, 1),
            Math.cos(a) * sp, rand(1.5, 5), Math.sin(a) * sp,
            rand(1.8, 3.4), rand(2.5, 4), rand(4, 8), -0.5);
    }

    // brokstukken van het schip
    for (let i = 0; i < 18; i++) {
        const mesh = new THREE.Mesh(pick(debrisGeos), i % 4 === 0 ? darkMat : hullMat);
        mesh.position.set(wx, wy, wz);
        mesh.castShadow = true;
        scene.add(mesh);

        const a = rand(0, 6.28), sp = rand(4, 16);
        debris.push({
            mesh: mesh,
            v: new THREE.Vector3(Math.cos(a) * sp, rand(6, 16), Math.sin(a) * sp),
            spin: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
            life: rand(3, 4.5),
            smoke: 0
        });
    }

    addRing(wx, wz, 0xff9040, 16, 0.7);
    addRing(wx, wz, 0xffd9a0, 9, 0.4);

    flash = 1;
}

// ------------------------------------------------------------
// COLLISION (2D, ongewijzigd)
// ------------------------------------------------------------

function collision(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.sqrt(dx * dx + dy * dy) < a.size + b.size;
}

// ------------------------------------------------------------
// UPDATE GAME LOGICA
// ------------------------------------------------------------

function update(dt) {
    const oldX = player.x, oldY = player.y;

    if (keys["arrowleft"] || keys["a"]) {
        player.x -= player.speed * dt;
    }

    if (keys["arrowright"] || keys["d"]) {
        player.x += player.speed * dt;
    }

    if (keys["arrowup"] || keys["w"]) {
        player.y -= player.speed * dt;
    }

    if (keys["arrowdown"] || keys["s"]) {
        player.y += player.speed * dt;
    }

    player.x = Math.max(20, Math.min(W - 20, player.x));
    player.y = Math.max(25, Math.min(H - 20, player.y));

    player.vx = dt > 0 ? (player.x - oldX) / dt : 0;
    player.vz = dt > 0 ? (player.y - oldY) / dt : 0;

    meteorTimer += dt;
    energyTimer += dt;

    if (meteorTimer > Math.max(0.28, 0.85 - score * 0.004)) {
        createMeteor();
        meteorTimer = 0;
    }

    if (energyTimer > 2.5) {
        createEnergy();
        energyTimer = 0;
    }

    meteors.forEach(m => { m.y += m.speed * dt; });
    energy.forEach(e => { e.y += e.speed * dt; });

    // METEOR COLLISION
    for (let m of meteors) {
        if (collision(player, m)) {
            endGame();
            return;
        }
    }

    // COLLECT ENERGY
    energy = energy.filter(item => {
        if (collision(player, item)) {
            score += 10;
            scoreText.textContent = Math.floor(score);
            energyBurst(toX(item.x), 1.6, toZ(item.y));
            scene.remove(item.mesh);
            return false;
        }

        if (item.y >= H + 20) {
            scene.remove(item.mesh);
            return false;
        }

        return true;
    });

    meteors = meteors.filter(m => {
        if (m.y >= H + 40) {
            scene.remove(m.mesh);
            return false;
        }
        return true;
    });

    // SURVIVAL POINTS
    score += dt * 2;
    scoreText.textContent = Math.floor(score);
}

// ------------------------------------------------------------
// VISUELE UPDATE (elk frame, ook na game over)
// ------------------------------------------------------------

const tmpV = new THREE.Vector3();
const tmpCol = { r: 0, g: 0, b: 0, a: 0 };
let groundOffset = 0;

function updateVisuals(dt, time) {
    const t = time / 1000;

    // Grond en omgeving schuiven naar de speler toe
    const groundSpeed = running ? 14 + Math.min(score * 0.08, 14) : 3;
    groundOffset = (groundOffset + groundSpeed * dt / TILE) % 1;
    groundTex.map.offset.y = groundOffset;
    groundTex.bump.offset.y = groundOffset;

    beacons.forEach(b => {
        b.position.z += groundSpeed * dt;
        if (b.position.z > BEACON_ZMAX) b.position.z -= BEACON_SPAN;
    });

    props.forEach(p => {
        p.position.z += groundSpeed * dt;
        if (p.position.z > PROP_ZMAX) {
            p.position.z -= PROP_SPAN;
            const side = Math.random() < 0.5 ? -1 : 1;
            p.position.x = side * rand(FIELD_W / 2 + 5, 95);
        }
    });

    // Schip
    if (player) {
        const wx = toX(player.x);
        const wz = toZ(player.y);
        const bob = running ? Math.sin(t * 9) * 0.05 : Math.sin(t * 2) * 0.3;

        shipGroup.position.set(wx, 1.0 + bob, wz);

        const targetRoll = -Math.max(-1, Math.min(1, player.vx / 270)) * 0.6;
        const targetPitch = Math.max(-1, Math.min(1, player.vz / 270)) * 0.22;
        const k = Math.min(1, dt * 10);
        shipGroup.rotation.z += (targetRoll - shipGroup.rotation.z) * k;
        shipGroup.rotation.x += (targetPitch - shipGroup.rotation.x) * k;

        // Navigatielichten knipperen
        const blink = (Math.sin(t * 5) > 0.2) ? 1 : 0.15;
        navLights.forEach(n => { n.material.opacity = 0.9 * blink; });

        // Motorgloed + uitlaatdeeltjes
        if (shipGroup.visible) {
            shipGroup.updateMatrixWorld(true);
            nozzleGlows.forEach(gl => {
                const f = 2.4 + Math.random() * 0.5;
                gl.scale.set(f, f, 1);
            });
            engineLight.intensity = 1.4 + Math.random() * 0.5;

            nozzleLocal.forEach(local => {
                tmpV.copy(local);
                shipBody.localToWorld(tmpV);
                const n = 2 + (Math.random() < 0.5 ? 1 : 0);
                for (let i = 0; i < n; i++) {
                    fireSys.emit(1,
                        tmpV.x + rand(-0.1, 0.1), tmpV.y + rand(-0.1, 0.1), tmpV.z,
                        rand(-0.5, 0.5), rand(-0.3, 0.3), 8 + rand(0, 4) + groundSpeed * 0.3,
                        rand(0.25, 0.45), 0.85, -0.7, 0);
                }
            });
        } else {
            engineLight.intensity = 0;
        }

        // Camera volgt de speler een beetje
        camera.position.x += (wx * 0.35 - camera.position.x) * Math.min(1, dt * 4);
    }

    // Meteoren
    const flick = 1.5 + Math.sin(t * 17) * 0.15 + Math.random() * 0.1;
    meteorMat.emissiveIntensity = flick;

    meteors.forEach(m => {
        m.mesh.position.x = toX(m.x);
        m.mesh.position.z = toZ(m.y);
        m.rock.rotation.x += m.spin.x * dt;
        m.rock.rotation.y += m.spin.y * dt;
        m.rock.rotation.z += m.spin.z * dt;

        if (running) {
            const r = m.size * S;
            const px = m.mesh.position.x, py = m.mesh.position.y, pz = m.mesh.position.z;

            // vurige staart
            m.trailAcc += 85 * dt;
            while (m.trailAcc >= 1) {
                m.trailAcc -= 1;
                const back = rand(0.4, 1.1) * r + Math.random() * m.speed * S * dt;
                fireSys.emit(0,
                    px + rand(-0.55, 0.55) * r, py + rand(-0.45, 0.6) * r, pz - back,
                    rand(-1, 1), rand(0.3, 2.2), rand(2, 6),
                    rand(0.45, 0.95), r * rand(1.8, 2.8), -r * 1.9, 0);
            }

            // rook
            m.smokeAcc += 28 * dt;
            while (m.smokeAcc >= 1) {
                m.smokeAcc -= 1;
                smokeSys.emit(3,
                    px + rand(-0.5, 0.5) * r, py + rand(0, 0.8) * r, pz - r * rand(1, 2.4),
                    rand(-0.8, 0.8), rand(0.8, 2.4), rand(2, 5),
                    rand(1.2, 2.2), r * 1.4, r * 3.5, 0);
            }

            // af en toe een vonk
            if (Math.random() < 0.35) {
                fireSys.emit(5, px, py, pz - r,
                    rand(-4, 4), rand(1, 6), rand(1, 7),
                    rand(0.4, 0.9), rand(0.25, 0.5), -0.15, 14);
            }
        }
    });

    // Vuurlicht van de dichtstbijzijnde meteoren
    const near = player ? meteors
        .filter(m => m.y > -140)
        .map(m => ({ m: m, d: (m.x - player.x) * (m.x - player.x) + (m.y - player.y) * (m.y - player.y) }))
        .sort((a, b) => a.d - b.d) : [];

    fireLights.forEach((l, i) => {
        const c = near[i];
        const kk = Math.min(1, dt * 10);
        if (c) {
            l.position.set(toX(c.m.x), c.m.mesh.position.y + 0.8, toZ(c.m.y));
            l.intensity += (3.4 * (0.85 + Math.random() * 0.3) - l.intensity) * kk;
        } else {
            l.intensity *= (1 - kk);
        }
    });

    // Energie-kristallen
    energy.forEach(e => {
        e.mesh.position.x = toX(e.x);
        e.mesh.position.z = toZ(e.y);
        e.mesh.position.y = 1.6 + Math.sin(t * 3 + e.x) * 0.3;
        e.gem.rotation.y += 2 * dt;

        if (running) {
            e.sparkAcc += 10 * dt;
            while (e.sparkAcc >= 1) {
                e.sparkAcc -= 1;
                fireSys.emit(4,
                    e.mesh.position.x + rand(-0.6, 0.6), e.mesh.position.y + rand(-0.5, 0.5), e.mesh.position.z + rand(-0.6, 0.6),
                    rand(-0.5, 0.5), rand(0.5, 1.8), rand(-0.5, 0.5),
                    rand(0.5, 1), rand(0.3, 0.6), -0.2, 0);
            }
        }
    });

    // Brokstukken: vallen, stuiteren, roken
    debris = debris.filter(d => {
        d.life -= dt;
        d.v.y -= 28 * dt;
        d.mesh.position.addScaledVector(d.v, dt);

        if (d.mesh.position.y < 0.2) {
            d.mesh.position.y = 0.2;
            d.v.y *= -0.35;
            d.v.x *= 0.7;
            d.v.z *= 0.7;
            d.spin.multiplyScalar(0.6);
        }

        d.mesh.rotation.x += d.spin.x * dt;
        d.mesh.rotation.y += d.spin.y * dt;
        d.mesh.rotation.z += d.spin.z * dt;

        d.smoke += dt * 22;
        while (d.smoke >= 1 && d.life > 1.5) {
            d.smoke -= 1;
            smokeSys.emit(3, d.mesh.position.x, d.mesh.position.y, d.mesh.position.z,
                rand(-0.4, 0.4), rand(0.5, 1.4), rand(-0.4, 0.4),
                rand(0.7, 1.3), 0.7, 1.8, 0);
        }

        if (d.life < 0.5) d.mesh.scale.setScalar(Math.max(0.01, d.life / 0.5));

        if (d.life <= 0) {
            scene.remove(d.mesh);
            return false;
        }
        return true;
    });

    // Schokgolven
    effects = effects.filter(f => {
        f.t += dt;
        const p = f.t / f.dur;
        if (p >= 1) {
            scene.remove(f.mesh);
            f.mesh.material.dispose();
            return false;
        }
        f.mesh.scale.setScalar(0.5 + (f.maxScale - 0.5) * (1 - Math.pow(1 - p, 3)));
        f.mesh.material.opacity = 0.9 * (1 - p);
        return true;
    });

    // Explosie-flits
    if (flash > 0) {
        flash = Math.max(0, flash - dt * 2.2);
        flashLight.position.set(shipGroup.position.x, 3, shipGroup.position.z);
        flashLight.intensity = flash * flash * 14;
    } else {
        flashLight.intensity = 0;
    }

    // Deeltjes
    fireSys.update(dt);
    smokeSys.update(dt);

    // Camera shake
    if (shake > 0) {
        shake = Math.max(0, shake - dt * 2.2);
        camera.position.y = CAM_BASE.y + (Math.random() - 0.5) * shake * 3;
        camera.position.z = CAM_BASE.z + (Math.random() - 0.5) * shake * 3;
    } else {
        camera.position.y = CAM_BASE.y;
        camera.position.z = CAM_BASE.z;
    }
    camera.lookAt(camera.position.x * 0.5, 0, CAM_TARGET_Z);
}

// ------------------------------------------------------------
// GAME LOOP
// ------------------------------------------------------------

function loop(timestamp) {
    const dt = lastTime === 0
        ? 0
        : Math.min((timestamp - lastTime) / 1000, 0.04);

    lastTime = timestamp;

    if (running) update(dt);
    updateVisuals(dt, timestamp);

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

// ------------------------------------------------------------
// GAME OVER
// ------------------------------------------------------------

function endGame() {
    running = false;

    const finalScore = Math.floor(score);

    if (finalScore > best) {
        best = finalScore;
        localStorage.setItem("neonBest", best);
        bestText.textContent = best;
    }

    message.textContent = "GAME OVER! SCORE: " + finalScore;
    startButton.textContent = "PLAY AGAIN";

    explode(player.x, player.y);
    shipGroup.visible = false;
    shake = 1.2;

    overlayScore.textContent = "SCORE: " + finalScore;
    overlay.classList.remove("hidden");
}

// ------------------------------------------------------------
// START: beginscherm
// ------------------------------------------------------------

player = createPlayer();
requestAnimationFrame(loop);
