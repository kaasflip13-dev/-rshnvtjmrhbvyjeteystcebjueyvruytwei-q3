// ============================================================
// NEON DODGE 3D  (Three.js)
// Spel-logica blijft 2D (x/y in "pixels"), de weergave is 3D.
// 2D x  -> wereld X,  2D y -> wereld Z (boven = ver weg)
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

let player;
let meteors = [];
let energy = [];
let debris = [];

let score = 0;
let best = Number(localStorage.getItem("neonBest")) || 0;

let running = false;
let keys = {};

let meteorTimer = 0;
let energyTimer = 0;
let lastTime = 0;
let shake = 0;

bestText.textContent = best;

// ------------------------------------------------------------
// THREE: renderer, scene, camera
// ------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, H, false); // CSS regelt de weergavegrootte

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080d1b);
scene.fog = new THREE.Fog(0x080d1b, 45, 115);

const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 300);
const CAM_BASE = new THREE.Vector3(0, 45, 58);
camera.position.copy(CAM_BASE);
camera.lookAt(0, 0, 6);

// Licht
scene.add(new THREE.AmbientLight(0x6680aa, 0.7));

const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.position.set(10, 30, 20);
scene.add(sun);

const playerLight = new THREE.PointLight(0x55ff88, 1.4, 30);
scene.add(playerLight);

// Glow-sprite texture (zacht neon gloeien)
function makeGlowTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
}

const glowTexture = makeGlowTexture();

function makeGlow(color, scale) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: color,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    }));
    sprite.scale.set(scale, scale, 1);
    return sprite;
}

// ------------------------------------------------------------
// WERELD: vloer, raster, randen, sterren
// ------------------------------------------------------------

const FIELD_W = W * S; // 44
const FIELD_D = H * S; // 55

const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshBasicMaterial({ color: 0x070b18 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.05;
scene.add(floor);

const GRID_CELL = 5;
const grid = new THREE.GridHelper(300, 60, 0x1f6f55, 0x15384a);
grid.position.y = 0;
scene.add(grid);

// Gloeiende randen van het speelveld
const edgeMat = new THREE.MeshBasicMaterial({ color: 0x55ff88 });
[-1, 1].forEach(side => {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 140), edgeMat);
    edge.position.set(side * (FIELD_W / 2 + 0.2), 0.1, -20);
    scene.add(edge);

    const glow = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.05, 140),
        new THREE.MeshBasicMaterial({
            color: 0x55ff88, transparent: true, opacity: 0.12, depthWrite: false
        })
    );
    glow.position.set(side * (FIELD_W / 2 + 0.2), 0.05, -20);
    scene.add(glow);
});

// Sterren (punten) die op je afkomen
const STAR_COUNT = 260;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_COUNT * 3);
const starSpeed = new Float32Array(STAR_COUNT);

for (let i = 0; i < STAR_COUNT; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 220;
    starPos[i * 3 + 1] = 4 + Math.random() * 50;
    starPos[i * 3 + 2] = -110 + Math.random() * 170;
    starSpeed[i] = 2 + Math.random() * 6;
}

starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0x9fb4d0, size: 0.6, sizeAttenuation: true, fog: false
}));
scene.add(stars);

// ------------------------------------------------------------
// SPELER (ruimteschip)
// ------------------------------------------------------------

const shipGroup = new THREE.Group();

const shipMat = new THREE.MeshStandardMaterial({
    color: 0x55ff88, emissive: 0x1a8040, metalness: 0.4, roughness: 0.35,
    flatShading: true
});

const body = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.2, 4), shipMat);
body.rotation.x = -Math.PI / 2; // punt naar voren (-Z)
body.rotation.y = Math.PI / 4;
shipGroup.add(body);

[-1, 1].forEach(side => {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 1.8), shipMat);
    wing.position.set(side * 1.6, 0, 0.9);
    wing.rotation.z = side * -0.15;
    wing.rotation.y = side * -0.35;
    shipGroup.add(wing);
});

const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 2, 8),
    new THREE.MeshBasicMaterial({ color: 0xbbffd0 })
);
flame.rotation.x = Math.PI / 2;
flame.position.z = 3;
shipGroup.add(flame);

shipGroup.add(makeGlow(0x55ff88, 9));
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

// ------------------------------------------------------------
// PLAYER
// ------------------------------------------------------------

function createPlayer() {
    return {
        x: W / 2,
        y: H - 65,
        size: 18,
        speed: 270,
        vx: 0
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
    running = true;

    shipGroup.visible = true;
    playerLight.intensity = 1.4;
    overlay.classList.add("hidden");

    scoreText.textContent = score;
    message.textContent = "SURVIVE!";
    startButton.textContent = "RESTART GAME";
}

function clearObjects() {
    meteors.forEach(m => scene.remove(m.mesh));
    energy.forEach(e => scene.remove(e.mesh));
    debris.forEach(d => scene.remove(d.mesh));
    meteors = [];
    energy = [];
    debris = [];
}

// ------------------------------------------------------------
// OBJECTEN MAKEN
// ------------------------------------------------------------

const meteorGeo = new THREE.IcosahedronGeometry(1, 1);
const meteorMat = new THREE.MeshStandardMaterial({
    color: 0xff405b, emissive: 0x9a1026, roughness: 0.6, flatShading: true
});

const energyGeo = new THREE.OctahedronGeometry(1, 0);
const energyMat = new THREE.MeshStandardMaterial({
    color: 0x55ff88, emissive: 0x2cc060, roughness: 0.2, metalness: 0.3,
    flatShading: true
});

function createMeteor() {
    const size = 12 + Math.random() * 15;

    const mesh = new THREE.Group();
    const rock = new THREE.Mesh(meteorGeo, meteorMat);
    rock.scale.setScalar(size * S);
    mesh.add(rock);
    mesh.add(makeGlow(0xff334f, size * S * 3.4));

    const m = {
        x: 20 + Math.random() * (W - 40),
        y: -30,
        size: size,
        speed: 150 + Math.random() * 100 + score * 1.5,
        mesh: mesh,
        rock: rock,
        spin: new THREE.Vector3(
            (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 4
        )
    };

    mesh.position.set(toX(m.x), size * S, toZ(m.y));
    scene.add(mesh);
    meteors.push(m);
}

function createEnergy() {
    const mesh = new THREE.Group();
    const gem = new THREE.Mesh(energyGeo, energyMat);
    gem.scale.set(1.0, 1.5, 1.0);
    mesh.add(gem);
    mesh.add(makeGlow(0x55ff88, 5));

    const e = {
        x: 20 + Math.random() * (W - 40),
        y: -20,
        size: 9,
        speed: 120,
        mesh: mesh,
        gem: gem
    };

    mesh.position.set(toX(e.x), 1.6, toZ(e.y));
    scene.add(mesh);
    energy.push(e);
}

// Explosie bij game over
function explode(x, y) {
    const geo = new THREE.TetrahedronGeometry(0.5);

    for (let i = 0; i < 40; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: Math.random() < 0.5 ? 0x55ff88 : 0xff405b,
            transparent: true
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(toX(x), 1.5, toZ(y));
        scene.add(mesh);

        const a = Math.random() * Math.PI * 2;
        const sp = 6 + Math.random() * 14;

        debris.push({
            mesh: mesh,
            vx: Math.cos(a) * sp,
            vy: 6 + Math.random() * 12,
            vz: Math.sin(a) * sp,
            life: 1.2
        });
    }
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
    const oldX = player.x;

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

function updateVisuals(dt, time) {
    const t = time / 1000;

    // Raster scrolt naar de speler toe
    grid.position.z = (t * 12) % GRID_CELL;

    // Sterren
    const pos = starGeo.attributes.position.array;
    for (let i = 0; i < STAR_COUNT; i++) {
        pos[i * 3 + 2] += starSpeed[i] * dt;
        if (pos[i * 3 + 2] > 70) {
            pos[i * 3 + 2] = -110;
            pos[i * 3] = (Math.random() - 0.5) * 220;
        }
    }
    starGeo.attributes.position.needsUpdate = true;

    // Schip
    if (player) {
        const wx = toX(player.x);
        const wz = toZ(player.y);
        const bob = running ? 0 : Math.sin(t * 2) * 0.3;

        shipGroup.position.set(wx, 1.2 + bob, wz);

        const targetRoll = -Math.max(-1, Math.min(1, player.vx / 270)) * 0.6;
        shipGroup.rotation.z += (targetRoll - shipGroup.rotation.z) * Math.min(1, dt * 12);

        flame.scale.set(1, 0.7 + Math.random() * 0.8, 1);

        playerLight.position.set(wx, 4, wz);

        // Camera volgt de speler een beetje
        camera.position.x += (wx * 0.35 - camera.position.x) * Math.min(1, dt * 4);
    }

    // Meteoren
    meteors.forEach(m => {
        m.mesh.position.x = toX(m.x);
        m.mesh.position.z = toZ(m.y);
        m.rock.rotation.x += m.spin.x * dt;
        m.rock.rotation.y += m.spin.y * dt;
        m.rock.rotation.z += m.spin.z * dt;
    });

    // Energie
    energy.forEach(e => {
        e.mesh.position.x = toX(e.x);
        e.mesh.position.z = toZ(e.y);
        e.mesh.position.y = 1.6 + Math.sin(t * 4 + e.x) * 0.3;
        e.gem.rotation.y += 2.5 * dt;
    });

    // Brokstukken
    debris = debris.filter(d => {
        d.life -= dt;
        d.vy -= 25 * dt;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y = Math.max(0.1, d.mesh.position.y + d.vy * dt);
        d.mesh.position.z += d.vz * dt;
        d.mesh.rotation.x += 6 * dt;
        d.mesh.rotation.y += 6 * dt;
        d.mesh.material.opacity = Math.max(0, d.life / 1.2);

        if (d.life <= 0) {
            scene.remove(d.mesh);
            return false;
        }
        return true;
    });

    // Camera shake
    if (shake > 0) {
        shake = Math.max(0, shake - dt * 2.5);
        camera.position.y = CAM_BASE.y + (Math.random() - 0.5) * shake * 3;
        camera.position.z = CAM_BASE.z + (Math.random() - 0.5) * shake * 3;
    } else {
        camera.position.y = CAM_BASE.y;
        camera.position.z = CAM_BASE.z;
    }
    camera.lookAt(camera.position.x * 0.5, 0, 6);
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
    playerLight.intensity = 0;
    shake = 1;

    overlayScore.textContent = "SCORE: " + finalScore;
    overlay.classList.remove("hidden");
}

// ------------------------------------------------------------
// START: beginscherm
// ------------------------------------------------------------

player = createPlayer();
requestAnimationFrame(loop);
