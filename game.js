/**
 * 噠噠特工練習生 - Core Game Logic
 * 更新：徹底修復陣列膨脹引起的效能問題, 子彈速度校準
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- 遊戲設定 ---
const CONFIG = {
    PLAYER_SPEED: 180,
    PLAYER_MAX_HP: 10,
    PLAYER_HIT_COOLDOWN: 200, 
    ENEMY_BASE_SPEED: 60,
    BULLET_SPEED: 160,         // 降速並穩定化
    FIRE_RATE: 800,
    BOOMERANG_SPEED: 260,
    BOOMERANG_FIRE_RATE: 2000,
    SPAWN_INTERVAL: 1000,
    INITIAL_SPAWN_CHANCE: 0.5,
    CHANCE_INC_PER_10S: 0.05,
    MAX_SPAWN_CHANCE: 1.0,
    XP_ATTRACT_DIST: 100,
    XP_COLLECT_DIST: 20,
    GRID_SIZE: 100,
    MONSTER_HP: 2
};

// --- 狀態管理 ---
let gameState = {
    running: false,
    level: 1,
    exp: 0,
    nextLevelExp: 10,
    kills: 0,
    time: 0,
    upgradeMenuOpen: false,
    camera: { x: 0, y: 0 },
    currentSpawnChance: CONFIG.INITIAL_SPAWN_CHANCE,
    hasBoomerang: false,
    boomerangLevel: 0,
    lastFrameTime: 0
};

// --- 物件池 ---
class ObjectPool {
    constructor(createFn, size = 100) {
        this.pool = [];
        for (let i = 0; i < size; i++) this.pool.push(createFn());
    }
    get() {
        const obj = this.pool.find(o => !o.active);
        if (obj) { obj.active = true; if (obj.reset) obj.reset(); return obj; }
        return null;
    }
    releaseAll() { this.pool.forEach(o => o.active = false); }
}

// --- 傷害數字 ---
class DamageText {
    constructor() { this.x = 0; this.y = 0; this.text = ""; this.color = "#fff"; this.active = false; this.life = 0; }
    reset() {} // 預留
    spawn(x, y, text, color) { this.x = x; this.y = y; this.text = text; this.color = color; this.active = true; this.life = 0.6; }
    update(dt) { if (!this.active) return; this.y -= 50 * dt; this.life -= dt; if (this.life <= 0) this.active = false; }
    draw() {
        if (!this.active) return;
        const s = { x: this.x - gameState.camera.x, y: this.y - gameState.camera.y };
        ctx.save(); ctx.globalAlpha = Math.max(0, this.life / 0.6); ctx.fillStyle = this.color;
        ctx.font = "bold 16px Arial"; ctx.textAlign = "center"; ctx.fillText(this.text, s.x, s.y); ctx.restore();
    }
}

// --- 實體 ---
class Entity {
    constructor() { this.x = 0; this.y = 0; this.radius = 10; this.active = false; }
    getScreenPos() { return { x: this.x - gameState.camera.x, y: this.y - gameState.camera.y }; }
    isOnScreen() {
        const s = this.getScreenPos();
        return s.x >= -50 && s.x <= canvas.width + 50 && s.y >= -50 && s.y <= canvas.height + 50;
    }
}

class Player extends Entity {
    constructor() { super(); this.radius = 15; this.hp = CONFIG.PLAYER_MAX_HP; this.flashFrames = 0; this.lastHitTime = 0; }
    reset() { this.x = 0; this.y = 0; this.hp = CONFIG.PLAYER_MAX_HP; this.flashFrames = 0; this.lastHitTime = 0; }
    takeDamage(dmg) {
        const now = Date.now();
        if (now - this.lastHitTime < CONFIG.PLAYER_HIT_COOLDOWN) return;
        this.hp -= dmg; this.lastHitTime = now; this.flashFrames = 10;
        spawnDamageText(this.x, this.y, dmg, "#ef4444");
        if (this.hp <= 0) { this.hp = 0; showGameOver(); }
        updateUI();
    }
    draw() {
        const s = this.getScreenPos(); ctx.save();
        if (this.flashFrames > 0) { ctx.fillStyle = '#ffffff'; this.flashFrames--; }
        else { ctx.shadowBlur = 15; ctx.shadowColor = '#4ade80'; ctx.fillStyle = '#4ade80'; }
        ctx.beginPath(); ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
}

class Enemy extends Entity {
    constructor() { super(); this.radius = 12; this.reset(); }
    reset() { this.hp = CONFIG.MONSTER_HP; this.flashFrames = 0; this.speed = CONFIG.ENEMY_BASE_SPEED; }
    update(px, py, dt) {
        if (!this.active) return;
        const dx = px - this.x, dy = py - this.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0) { this.x += (dx / d) * this.speed * dt; this.y += (dy / d) * this.speed * dt; }
        if (this.flashFrames > 0) this.flashFrames--;
        if (d > 2000) this.active = false;
    }
    draw() {
        if (!this.active) return;
        const s = this.getScreenPos();
        if (s.x < 0 || s.x > canvas.width || s.y < 0 || s.y > canvas.height) return;
        ctx.fillStyle = this.flashFrames > 0 ? '#ffffff' : '#ef4444';
        ctx.beginPath(); ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2); ctx.fill();
    }
    takeDamage(dmg) { this.hp -= dmg; this.flashFrames = 5; spawnDamageText(this.x, this.y, dmg, "#ffffff"); if (this.hp <= 0) { this.active = false; return true; } return false; }
}

class Bullet extends Entity {
    constructor() { super(); this.radius = 5; this.vx = 0; this.vy = 0; this.spawnTime = 0; this.damage = 1; }
    reset() { this.vx = 0; this.vy = 0; this.spawnTime = Date.now(); } // 確保重置
    update(dt) { if (!this.active) return; this.x += this.vx * dt; this.y += this.vy * dt; if (Date.now() - this.spawnTime > 3000) this.active = false; }
    draw() { if (!this.active) return; const s = this.getScreenPos(); ctx.fillStyle = '#60a5fa'; ctx.beginPath(); ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2); ctx.fill(); }
}

class Boomerang extends Entity {
    constructor() { super(); this.radius = 20; this.vx = 0; this.vy = 0; this.damage = 1; this.returning = false; this.rotation = 0; }
    reset() {
        this.returning = false; this.rotation = 0; this.returnThreshold = Math.max(canvas.width, canvas.height) / 2 + 50;
        const lvl = gameState.boomerangLevel; this.radius = 20 * (1 + (lvl - 1) * 0.5); this.damage = 1 + (lvl - 1) * 0.5;
    }
    update(px, py, dt) {
        if (!this.active) return;
        if (!this.returning) { this.x += this.vx * dt; this.y += this.vy * dt; if (Math.sqrt((this.x - px)**2 + (this.y - py)**2) > this.returnThreshold) this.returning = true; }
        else {
            const dx = px - this.x, dy = py - this.y, d = Math.sqrt(dx * dx + dy * dy);
            const speed = CONFIG.BOOMERANG_SPEED * 1.5; this.vx = (dx / d) * speed; this.vy = (dy / d) * speed; this.x += this.vx * dt; this.y += this.vy * dt;
            if (d < 30) this.active = false;
        }
        this.rotation += 18 * dt;
    }
    draw() {
        if (!this.active) return;
        const s = this.getScreenPos(); ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(this.rotation);
        ctx.fillStyle = '#a855f7'; ctx.shadowBlur = 10; ctx.shadowColor = '#a855f7';
        const sc = this.radius / 10; ctx.beginPath(); ctx.moveTo(-15*sc, -5*sc); ctx.lineTo(0, 15*sc); ctx.lineTo(15*sc, -5*sc); ctx.lineTo(0, 5*sc); ctx.closePath(); ctx.fill(); ctx.restore();
    }
}

class XPGem extends Entity {
    constructor() { super(); this.radius = 6; this.value = 1; }
    reset() {}
    update(px, py, dt) { if (!this.active) return; const dx = px - this.x, dy = py - this.y, d = Math.sqrt(dx * dx + dy * dy); if (d < CONFIG.XP_ATTRACT_DIST) { this.x += (dx / d) * 420 * dt; this.y += (dy / d) * 420 * dt; } }
    draw() { if (!this.active) return; const s = this.getScreenPos(); ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.rect(s.x - 4, s.y - 4, 8, 8); ctx.fill(); }
}

// --- 初始化系統 ---
const player = new Player();
const enemyPool = new ObjectPool(() => new Enemy(), 500);
const bulletPool = new ObjectPool(() => new Bullet(), 100);
const boomerangPool = new ObjectPool(() => new Boomerang(), 10);
const xpPool = new ObjectPool(() => new XPGem(), 500);
const damageTextPool = new ObjectPool(() => new DamageText(), 100);

let activeEnemies = [], activeBullets = [], activeBoomerangs = [], activeXPGems = [], activeDamageTexts = [];

function spawnDamageText(x, y, text, color) { const t = damageTextPool.get(); if (t) { t.spawn(x, y, text, color); activeDamageTexts.push(t); } }

function drawBackground() {
    const ox = -gameState.camera.x % CONFIG.GRID_SIZE, oy = -gameState.camera.y % CONFIG.GRID_SIZE;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'; ctx.lineWidth = 1.5;
    for (let x = ox; x < canvas.width; x += CONFIG.GRID_SIZE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (let y = oy; y < canvas.height; y += CONFIG.GRID_SIZE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
}

// --- 控制 ---
const joystickBase = document.getElementById('joystick-base'), joystickStick = document.getElementById('joystick-stick');
let joystickActive = false, joystickData = { x: 0, y: 0 };
function setupControls() {
    const move = (e) => {
        if (!joystickActive) return;
        const rect = joystickBase.getBoundingClientRect(), touch = (e.touches && e.touches[0]) || e;
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        let dx = touch.clientX - cx, dy = touch.clientY - cy, d = Math.sqrt(dx * dx + dy * dy), max = rect.width / 2;
        if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
        joystickStick.style.transform = `translate(${dx}px, ${dy}px)`; joystickData = { x: dx / max, y: dy / max };
    };
    const start = (e) => { joystickActive = true; move(e); };
    const end = () => { joystickActive = false; joystickStick.style.transform = 'translate(0, 0)'; joystickData = { x: 0, y: 0 }; };
    window.addEventListener('mousedown', start); window.addEventListener('touchstart', start);
    window.addEventListener('mousemove', move); window.addEventListener('touchmove', move);
    window.addEventListener('mouseup', end); window.addEventListener('touchend', end);
}
function resize() { const c = document.getElementById('game-container'); canvas.width = c.clientWidth; canvas.height = c.clientHeight; }

// --- 邏輯 ---
function spawnEnemy() {
    if (gameState.upgradeMenuOpen) return;
    const e = enemyPool.get(); if (!e) return;
    const ang = Math.random() * Math.PI * 2, dist = Math.max(canvas.width, canvas.height) / 2 + 60;
    e.x = player.x + Math.cos(ang) * dist; e.y = player.y + Math.sin(ang) * dist; activeEnemies.push(e);
}
function fireBullet() {
    if (gameState.upgradeMenuOpen) return;
    let closest = null, minDist = Infinity;
    activeEnemies.forEach(e => { if (e.active && e.isOnScreen()) { const d = Math.sqrt((e.x - player.x)**2 + (e.y - player.y)**2); if (d < minDist) { minDist = d; closest = e; } } });
    if (closest) {
        const b = bulletPool.get();
        if (b) { b.x = player.x; b.y = player.y; const dx = closest.x - player.x, dy = closest.y - player.y, d = Math.sqrt(dx * dx + dy * dy); b.vx = (dx / d) * CONFIG.BULLET_SPEED; b.vy = (dy / d) * CONFIG.BULLET_SPEED; activeBullets.push(b); }
    }
}
function fireBoomerang() {
    if (!gameState.hasBoomerang || gameState.upgradeMenuOpen) return;
    const b = boomerangPool.get(); if (!b) return;
    b.x = player.x; b.y = player.y;
    let target = null, minDist = Infinity;
    activeEnemies.forEach(e => { if (e.active && e.isOnScreen()) { const d = Math.sqrt((e.x - player.x)**2 + (e.y - player.y)**2); if (d < minDist) { minDist = d; target = e; } } });
    if (target) { const dx = target.x - player.x, dy = target.y - player.y, d = Math.sqrt(dx * dx + dy * dy); b.vx = (dx / d) * CONFIG.BOOMERANG_SPEED; b.vy = (dy / d) * CONFIG.BOOMERANG_SPEED; }
    else { const ang = Math.random() * Math.PI * 2; b.vx = Math.cos(ang) * CONFIG.BOOMERANG_SPEED; b.vy = Math.sin(ang) * CONFIG.BOOMERANG_SPEED; }
    activeBoomerangs.push(b);
}
function checkCollisions() {
    activeBullets.forEach(b => { if (b.active) { activeEnemies.forEach(e => { if (e.active && Math.sqrt((b.x - e.x)**2 + (b.y - e.y)**2) < b.radius + e.radius) { b.active = false; if (e.takeDamage(b.damage)) { gameState.kills++; spawnXP(e.x, e.y); } } }); } });
    activeBoomerangs.forEach(b => { if (b.active) { activeEnemies.forEach(e => { if (e.active && Math.sqrt((b.x - e.x)**2 + (b.y - e.y)**2) < b.radius + e.radius) { if (e.takeDamage(b.damage)) { gameState.kills++; spawnXP(e.x, e.y); } } }); } });
    activeEnemies.forEach(e => { if (e.active && Math.sqrt((player.x - e.x)**2 + (player.y - e.y)**2) < player.radius + e.radius) player.takeDamage(1); });
    activeXPGems.forEach(g => { if (g.active && Math.sqrt((g.x - player.x)**2 + (g.y - player.y)**2) < CONFIG.XP_COLLECT_DIST) { g.active = false; gainExp(g.value); } });
}
function spawnXP(x, y) { const g = xpPool.get(); if (g) { g.x = x; g.y = y; activeXPGems.push(g); } }
function gainExp(v) { gameState.exp += v; if (gameState.exp >= gameState.nextLevelExp) levelUp(); updateUI(); }
function levelUp() { gameState.level++; gameState.exp = 0; gameState.nextLevelExp = Math.floor(gameState.nextLevelExp * 1.5); showUpgradeMenu(); }
function showUpgradeMenu() {
    gameState.upgradeMenuOpen = true; const menu = document.getElementById('upgrade-menu'), opts = document.getElementById('upgrade-options'); menu.classList.remove('hidden');
    const pool = [{ id: 'kunai', title: "強化苦無", desc: "提升子彈速度與縮短間隔" }, { id: 'speed', title: "健身指南", desc: "永久提升玩家移動速度" }, { id: 'magnet', title: "磁鐵", desc: "大幅增加經驗值吸收範圍" }, { id: 'boomerang', title: "迴旋鏢", desc: "穿透性重型武器" }].filter(i => i.id !== 'boomerang' || gameState.boomerangLevel < 4);
    const selection = pool.sort(() => 0.5 - Math.random()).slice(0, 3); opts.innerHTML = '';
    selection.forEach(u => {
        const div = document.createElement('div'); div.className = 'upgrade-item'; const title = (u.id === 'boomerang' && gameState.boomerangLevel > 0) ? `${u.title} LV.${gameState.boomerangLevel + 1}` : u.title; const desc = (u.id === 'boomerang' && gameState.boomerangLevel > 0) ? "體積 +50%, 傷害 +0.5" : u.desc;
        div.innerHTML = `<h3>${title}</h3><p>${desc}</p>`; div.onclick = () => { menu.classList.add('hidden'); gameState.upgradeMenuOpen = false; applyUpgrade(u.id); }; opts.appendChild(div);
    });
}
function applyUpgrade(id) {
    if (id === 'speed') CONFIG.PLAYER_SPEED += 30; if (id === 'kunai') { CONFIG.FIRE_RATE *= 0.85; CONFIG.BULLET_SPEED += 25; } if (id === 'magnet') CONFIG.XP_ATTRACT_DIST += 50; if (id === 'boomerang') { gameState.hasBoomerang = true; gameState.boomerangLevel++; }
}
function updateUI() {
    document.getElementById('level-value').innerText = gameState.level; document.getElementById('kill-count').innerText = `擊殺: ${gameState.kills}`; document.getElementById('exp-bar-fill').style.width = `${(gameState.exp / gameState.nextLevelExp) * 100}%`; document.getElementById('hp-bar-fill').style.width = `${(player.hp / CONFIG.PLAYER_MAX_HP) * 100}%`;
    const mins = Math.floor(gameState.time / 60), secs = Math.floor(gameState.time % 60); document.getElementById('timer').innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
function showGameOver() { gameState.running = false; document.getElementById('game-over-menu').classList.remove('hidden'); document.getElementById('final-stats').innerText = `最終擊殺數: ${gameState.kills}`; }
function resetGameState() {
    gameState.level = 1; gameState.exp = 0; gameState.nextLevelExp = 10; gameState.kills = 0; gameState.time = 0; gameState.upgradeMenuOpen = false; gameState.currentSpawnChance = CONFIG.INITIAL_SPAWN_CHANCE; gameState.hasBoomerang = false; gameState.boomerangLevel = 0;
    player.reset(); enemyPool.releaseAll(); bulletPool.releaseAll(); boomerangPool.releaseAll(); xpPool.releaseAll(); damageTextPool.releaseAll(); activeEnemies = []; activeBullets = []; activeBoomerangs = []; activeXPGems = []; activeDamageTexts = []; updateUI();
}
function startGame(isMobile) {
    if (isMobile) { const c = document.getElementById('game-container'); if (c.requestFullscreen) c.requestFullscreen(); else if (c.webkitRequestFullscreen) c.webkitRequestFullscreen(); }
    document.getElementById('start-screen').classList.add('hidden'); document.getElementById('game-over-menu').classList.add('hidden'); resetGameState();
    gameState.lastFrameTime = performance.now(); player.active = true; gameState.running = true;
    setTimeout(resize, 100);
}
document.getElementById('pc-start-button').onclick = () => startGame(false);
document.getElementById('mobile-start-button').onclick = () => startGame(true);
document.getElementById('restart-button').onclick = () => startGame(false);

let lastFire = 0, lastBoomerangFire = 0, lastSpawnAttempt = 0, lastTimeUpdate = 0;
function gameLoop(timestamp) {
    let dt = (timestamp - gameState.lastFrameTime) / 1000;
    if (dt > 0.1) dt = 0.1;
    gameState.lastFrameTime = timestamp;

    ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (gameState.running && !gameState.upgradeMenuOpen) {
        player.x += joystickData.x * CONFIG.PLAYER_SPEED * dt; player.y += joystickData.y * CONFIG.PLAYER_SPEED * dt;
        gameState.camera.x = player.x - canvas.width / 2; gameState.camera.y = player.y - canvas.height / 2;
        
        if (timestamp - lastTimeUpdate > 1000) { gameState.time++; lastTimeUpdate = timestamp; gameState.currentSpawnChance = Math.min(CONFIG.MAX_SPAWN_CHANCE, CONFIG.INITIAL_SPAWN_CHANCE + Math.floor(gameState.time / 10) * CONFIG.CHANCE_INC_PER_10S); updateUI(); }
        if (timestamp - lastSpawnAttempt > CONFIG.SPAWN_INTERVAL) { if (Math.random() < gameState.currentSpawnChance) { const r = Math.random(), c = r < 0.1 ? 5 : (r < 0.3 ? 3 : 1); for (let i = 0; i < c; i++) spawnEnemy(); } lastSpawnAttempt = timestamp; }
        if (timestamp - lastFire > CONFIG.FIRE_RATE) { fireBullet(); lastFire = timestamp; }
        if (timestamp - lastBoomerangFire > CONFIG.BOOMERANG_FIRE_RATE) { fireBoomerang(); lastBoomerangFire = timestamp; }

        activeEnemies.forEach(e => e.update(player.x, player.y, dt));
        activeBullets.forEach(b => b.update(dt));
        activeBoomerangs.forEach(b => b.update(player.x, player.y, dt));
        activeXPGems.forEach(g => g.update(player.x, player.y, dt));
        activeDamageTexts.forEach(t => t.update(dt));
        
        // --- 核心優化：清理陣列 ---
        activeEnemies = activeEnemies.filter(e => e.active);
        activeBullets = activeBullets.filter(b => b.active);
        activeBoomerangs = activeBoomerangs.filter(b => b.active);
        activeXPGems = activeXPGems.filter(g => g.active);
        activeDamageTexts = activeDamageTexts.filter(t => t.active);
        
        checkCollisions();
    }
    drawBackground(); activeXPGems.forEach(g => g.draw()); activeBullets.forEach(b => b.draw()); activeBoomerangs.forEach(b => b.draw()); activeEnemies.forEach(e => e.draw()); activeDamageTexts.forEach(t => t.draw()); player.draw(); requestAnimationFrame(gameLoop);
}
window.addEventListener('load', () => { resize(); setupControls(); requestAnimationFrame(gameLoop); });
window.addEventListener('resize', resize);
