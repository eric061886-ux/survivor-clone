/**
 * 噠噠特工練習生 - Core Game Logic
 * 更新：迴旋鏢固定距離折返, 怪物小隊生成 (1/3/5 隻)
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- 遊戲設定 ---
const CONFIG = {
    PLAYER_SPEED: 3,
    PLAYER_MAX_HP: 10,
    PLAYER_HIT_COOLDOWN: 200, 
    ENEMY_BASE_SPEED: 1.3,
    BULLET_SPEED: 9,
    FIRE_RATE: 400, 
    BOOMERANG_SPEED: 7,        // 稍微提升速度感
    BOOMERANG_FIRE_RATE: 2000,
    SPAWN_INTERVAL: 1000,
    INITIAL_SPAWN_CHANCE: 0.5,
    CHANCE_INC_PER_10S: 0.05,
    MAX_SPAWN_CHANCE: 1.0,
    XP_ATTRACT_DIST: 100,
    XP_COLLECT_DIST: 20,
    GRID_SIZE: 100,
    MONSTER_HP: 3
};

// --- 狀態管理 ---
let gameState = {
    running: true,
    level: 1,
    exp: 0,
    nextLevelExp: 10,
    kills: 0,
    time: 0,
    upgradeMenuOpen: false,
    camera: { x: 0, y: 0 },
    currentSpawnChance: CONFIG.INITIAL_SPAWN_CHANCE,
    hasBoomerang: false,
    boomerangLevel: 0
};

// --- 物件池 ---
class ObjectPool {
    constructor(createFn, size = 100) {
        this.pool = [];
        for (let i = 0; i < size; i++) {
            this.pool.push(createFn());
        }
    }

    get() {
        const obj = this.pool.find(o => !o.active);
        if (obj) {
            obj.active = true;
            if (obj.reset) obj.reset();
            return obj;
        }
        const newObj = this.pool[0].constructor ? new (this.pool[0].constructor)() : null;
        if (newObj) {
            newObj.active = true;
            if (newObj.reset) newObj.reset();
            this.pool.push(newObj);
            return newObj;
        }
        return null;
    }

    release(obj) {
        obj.active = false;
    }
}

// --- 基礎類別 ---
class Entity {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.radius = 10;
        this.active = false;
    }

    getScreenPos() {
        return {
            x: this.x - gameState.camera.x,
            y: this.y - gameState.camera.y
        };
    }

    isOnScreen() {
        const screen = this.getScreenPos();
        return (
            screen.x >= -100 && 
            screen.x <= canvas.width + 100 && 
            screen.y >= -100 && 
            screen.y <= canvas.height + 100
        );
    }
}

class Player extends Entity {
    constructor() {
        super();
        this.radius = 15;
        this.hp = CONFIG.PLAYER_MAX_HP;
        this.flashFrames = 0;
        this.lastHitTime = 0;
    }

    takeDamage(dmg) {
        const now = Date.now();
        if (now - this.lastHitTime < CONFIG.PLAYER_HIT_COOLDOWN) return;
        this.hp -= dmg;
        this.lastHitTime = now;
        this.flashFrames = 10;
        if (this.hp <= 0) {
            this.hp = 0;
            updateUI();
            alert("遊戲結束！擊殺數: " + gameState.kills);
            location.reload();
        }
        updateUI();
    }

    draw() {
        const screen = this.getScreenPos();
        ctx.save();
        if (this.flashFrames > 0) {
            ctx.fillStyle = '#ffffff';
            this.flashFrames--;
        } else {
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#4ade80';
            ctx.fillStyle = '#4ade80';
        }
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class Enemy extends Entity {
    constructor() {
        super();
        this.radius = 12;
        this.reset();
    }

    reset() {
        this.hp = CONFIG.MONSTER_HP;
        this.flashFrames = 0;
        this.speed = CONFIG.ENEMY_BASE_SPEED;
    }

    update(playerX, playerY) {
        if (!this.active) return;
        const dx = playerX - this.x;
        const dy = playerY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }
        if (this.flashFrames > 0) this.flashFrames--;
        if (dist > 1500) this.active = false;
    }

    draw() {
        if (!this.active) return;
        const screen = this.getScreenPos();
        // 怪物中心點在畫面內才畫 (保持 User 要求的精準判定)
        const isCenterIn = screen.x >= 0 && screen.x <= canvas.width && screen.y >= 0 && screen.y <= canvas.height;
        if (!isCenterIn) return;

        if (this.flashFrames > 0) {
            ctx.fillStyle = '#ffffff';
        } else {
            ctx.fillStyle = '#ef4444';
        }
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }

    takeDamage(dmg) {
        this.hp -= dmg;
        this.flashFrames = 5;
        if (this.hp <= 0) {
            this.active = false;
            return true;
        }
        return false;
    }
}

class Bullet extends Entity {
    constructor() {
        super();
        this.radius = 5;
        this.vx = 0;
        this.vy = 0;
        this.spawnTime = 0;
        this.damage = 1;
    }

    update() {
        if (!this.active) return;
        this.x += this.vx;
        this.y += this.vy;
        if (Date.now() - this.spawnTime > 3000) {
            this.active = false;
        }
    }

    draw() {
        const screen = this.getScreenPos();
        ctx.fillStyle = '#60a5fa';
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

class Boomerang extends Entity {
    constructor() {
        super();
        this.radius = 20;
        this.vx = 0;
        this.vy = 0;
        this.startX = 0;
        this.startY = 0;
        this.damage = 1;
        this.returning = false;
        this.rotation = 0;
        // 折返距離設定為螢幕對角線或最大寬度的一半
        this.returnThreshold = 0; 
    }

    reset() {
        this.returning = false;
        this.rotation = 0;
        this.returnThreshold = Math.max(canvas.width, canvas.height) / 2 + 50;
        
        const level = gameState.boomerangLevel;
        this.radius = 20 * (1 + (level - 1) * 0.5);
        this.damage = 1 + (level - 1) * 0.5;
    }

    update(playerX, playerY) {
        if (!this.active) return;
        
        if (!this.returning) {
            this.x += this.vx;
            this.y += this.vy;
            const distFromStart = Math.sqrt((this.x - playerX)**2 + (this.y - playerY)**2);
            // 飛到邊界距離折返
            if (distFromStart > this.returnThreshold) this.returning = true;
        } else {
            const dx = playerX - this.x;
            const dy = playerY - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            this.vx = (dx / dist) * CONFIG.BOOMERANG_SPEED * 1.5;
            this.vy = (dy / dist) * CONFIG.BOOMERANG_SPEED * 1.5;
            this.x += this.vx;
            this.y += this.vy;
            if (dist < 30) this.active = false;
        }
        this.rotation += 0.35; 
    }

    draw() {
        const screen = this.getScreenPos();
        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.rotate(this.rotation);
        ctx.fillStyle = '#a855f7';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#a855f7';
        
        const s = this.radius / 10;
        ctx.beginPath();
        ctx.moveTo(-15 * s, -5 * s);
        ctx.lineTo(0, 15 * s);
        ctx.lineTo(15 * s, -5 * s);
        ctx.lineTo(0, 5 * s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

class XPGem extends Entity {
    constructor() {
        super();
        this.radius = 6;
        this.value = 1;
    }

    update(playerX, playerY) {
        if (!this.active) return;
        const dx = playerX - this.x;
        const dy = playerY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONFIG.XP_ATTRACT_DIST) {
            this.x += (dx / dist) * 7;
            this.y += (dy / dist) * 7;
        }
    }

    draw() {
        const screen = this.getScreenPos();
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.rect(screen.x - 4, screen.y - 4, 8, 8);
        ctx.fill();
    }
}

// --- 初始化 ---
const player = new Player();
const enemyPool = new ObjectPool(() => new Enemy(), 500); // 增加池大小以應對群組生成
const bulletPool = new ObjectPool(() => new Bullet(), 100);
const boomerangPool = new ObjectPool(() => new Boomerang(), 10);
const xpPool = new ObjectPool(() => new XPGem(), 500);

let activeEnemies = [];
let activeBullets = [];
let activeBoomerangs = [];
let activeXPGems = [];

function drawBackground() {
    const offsetX = -gameState.camera.x % CONFIG.GRID_SIZE;
    const offsetY = -gameState.camera.y % CONFIG.GRID_SIZE;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = offsetX; x < canvas.width; x += CONFIG.GRID_SIZE) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = offsetY; y < canvas.height; y += CONFIG.GRID_SIZE) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
}

const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');
let joystickActive = false;
let joystickData = { x: 0, y: 0 };

function setupJoystick() {
    const handleMove = (e) => {
        if (!joystickActive) return;
        const rect = joystickBase.getBoundingClientRect();
        const touch = (e.touches && e.touches[0]) || e;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let dx = touch.clientX - centerX;
        let dy = touch.clientY - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = rect.width / 2;
        if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
        }
        joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;
        joystickData = { x: dx / maxDist, y: dy / maxDist };
    };
    window.addEventListener('mousedown', () => joystickActive = true);
    window.addEventListener('touchstart', (e) => { joystickActive = true; handleMove(e); });
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('mouseup', resetJoystick);
    window.addEventListener('touchend', resetJoystick);
}

function resetJoystick() {
    joystickActive = false;
    joystickStick.style.transform = 'translate(0, 0)';
    joystickData = { x: 0, y: 0 };
}

function resize() {
    const container = document.getElementById('game-container');
    if (!container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
}

function spawnEnemy() {
    if (gameState.upgradeMenuOpen) return;
    const enemy = enemyPool.get();
    if (!enemy) return;
    const angle = Math.random() * Math.PI * 2;
    const spawnDist = Math.max(canvas.width, canvas.height) * 0.7;
    enemy.x = player.x + Math.cos(angle) * spawnDist;
    enemy.y = player.y + Math.sin(angle) * spawnDist;
    activeEnemies.push(enemy);
}

function fireBullet() {
    if (activeEnemies.length === 0 || gameState.upgradeMenuOpen) return;
    let closest = null;
    let minDist = Infinity;
    activeEnemies.forEach(e => {
        if (!e.active) return;
        const screen = e.getScreenPos();
        // 怪物中心在畫面內才射擊
        if (screen.x < 0 || screen.x > canvas.width || screen.y < 0 || screen.y > canvas.height) return;
        
        const d = Math.sqrt((e.x - player.x)**2 + (e.y - player.y)**2);
        if (d < minDist) { minDist = d; closest = e; }
    });
    if (closest) {
        const bullet = bulletPool.get();
        if (bullet) {
            bullet.x = player.x; bullet.y = player.y; bullet.spawnTime = Date.now();
            const dx = closest.x - player.x; const dy = closest.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            bullet.vx = (dx / dist) * CONFIG.BULLET_SPEED; bullet.vy = (dy / dist) * CONFIG.BULLET_SPEED;
            activeBullets.push(bullet);
        }
    }
}

function fireBoomerang() {
    if (!gameState.hasBoomerang || gameState.upgradeMenuOpen) return;
    const b = boomerangPool.get();
    if (b) {
        b.x = player.x; b.y = player.y; b.startX = player.x; b.startY = player.y;
        let target = null;
        let minDist = Infinity;
        activeEnemies.forEach(e => {
            if (!e.active) return;
            const screen = e.getScreenPos();
            if (screen.x < 0 || screen.x > canvas.width || screen.y < 0 || screen.y > canvas.height) return;
            const d = Math.sqrt((e.x - player.x)**2 + (e.y - player.y)**2);
            if (d < minDist) { minDist = d; target = e; }
        });
        if (target) {
            const dx = target.x - player.x; const dy = target.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            b.vx = (dx / dist) * CONFIG.BOOMERANG_SPEED; b.vy = (dy / dist) * CONFIG.BOOMERANG_SPEED;
        } else {
            const angle = Math.random() * Math.PI * 2;
            b.vx = Math.cos(angle) * CONFIG.BOOMERANG_SPEED; b.vy = Math.sin(angle) * CONFIG.BOOMERANG_SPEED;
        }
        activeBoomerangs.push(b);
    }
}

function checkCollisions() {
    for (let i = activeBullets.length - 1; i >= 0; i--) {
        const b = activeBullets[i];
        if (!b.active) { activeBullets.splice(i, 1); continue; }
        for (let j = activeEnemies.length - 1; j >= 0; j--) {
            const e = activeEnemies[j];
            if (!e.active) { activeEnemies.splice(j, 1); continue; }
            const dist = Math.sqrt((b.x - e.x)**2 + (b.y - e.y)**2);
            if (dist < b.radius + e.radius) {
                b.active = false;
                const isDead = e.takeDamage(b.damage);
                if (isDead) { gameState.kills++; spawnXP(e.x, e.y); }
                break;
            }
        }
    }
    for (let i = activeBoomerangs.length - 1; i >= 0; i--) {
        const b = activeBoomerangs[i];
        if (!b.active) { activeBoomerangs.splice(i, 1); continue; }
        for (let j = 0; j < activeEnemies.length; j++) {
            const e = activeEnemies[j];
            if (!e.active) continue;
            const dist = Math.sqrt((b.x - e.x)**2 + (b.y - e.y)**2);
            if (dist < b.radius + e.radius) {
                const isDead = e.takeDamage(b.damage);
                if (isDead) { gameState.kills++; spawnXP(e.x, e.y); }
            }
        }
    }
    for (let i = 0; i < activeEnemies.length; i++) {
        const e = activeEnemies[i];
        if (!e.active) continue;
        const dist = Math.sqrt((player.x - e.x)**2 + (player.y - e.y)**2);
        if (dist < player.radius + e.radius) player.takeDamage(1);
    }
    for (let i = activeXPGems.length - 1; i >= 0; i--) {
        const gem = activeXPGems[i];
        if (!gem.active) { activeXPGems.splice(i, 1); continue; }
        const dist = Math.sqrt((gem.x - player.x)**2 + (gem.y - player.y)**2);
        if (dist < CONFIG.XP_COLLECT_DIST) { gem.active = false; gainExp(gem.value); }
    }
}

function spawnXP(x, y) {
    const gem = xpPool.get();
    if (gem) { gem.x = x; gem.y = y; activeXPGems.push(gem); }
}

function gainExp(val) {
    gameState.exp += val;
    if (gameState.exp >= gameState.nextLevelExp) levelUp();
    updateUI();
}

function levelUp() {
    gameState.level++; gameState.exp = 0;
    gameState.nextLevelExp = Math.floor(gameState.nextLevelExp * 1.5);
    showUpgradeMenu();
}

function showUpgradeMenu() {
    gameState.upgradeMenuOpen = true;
    const menu = document.getElementById('upgrade-menu');
    const options = document.getElementById('upgrade-options');
    menu.classList.remove('hidden');
    const pool = [
        { id: 'kunai', title: "強化苦無", desc: "提升子彈速度與縮短間隔" },
        { id: 'speed', title: "健身指南", desc: "永久提升玩家移動速度" },
        { id: 'magnet', title: "磁鐵", desc: "大幅增加經驗值吸收範圍" },
        { id: 'boomerang', title: "迴旋鏢", desc: "穿透性重型武器" }
    ];
    let selectionPool = pool.filter(item => {
        if (item.id === 'boomerang' && gameState.boomerangLevel >= 4) return false;
        return true;
    });
    const selection = selectionPool.sort(() => 0.5 - Math.random()).slice(0, 3);
    options.innerHTML = '';
    selection.forEach(u => {
        const div = document.createElement('div');
        div.className = 'upgrade-item';
        const title = (u.id === 'boomerang' && gameState.boomerangLevel > 0) ? `${u.title} LV.${gameState.boomerangLevel + 1}` : u.title;
        const desc = (u.id === 'boomerang' && gameState.boomerangLevel > 0) ? "體積 +50%, 傷害 +0.5" : u.desc;
        div.innerHTML = `<h3>${title}</h3><p>${desc}</p>`;
        div.onclick = () => {
            menu.classList.add('hidden'); gameState.upgradeMenuOpen = false;
            if (u.id === 'speed') CONFIG.PLAYER_SPEED += 0.5;
            if (u.id === 'kunai') { CONFIG.FIRE_RATE *= 0.85; CONFIG.BULLET_SPEED += 1; }
            if (u.id === 'magnet') CONFIG.XP_ATTRACT_DIST += 50;
            if (u.id === 'boomerang') { gameState.hasBoomerang = true; gameState.boomerangLevel++; }
        };
        options.appendChild(div);
    });
}

function updateUI() {
    document.getElementById('level-value').innerText = gameState.level;
    document.getElementById('kill-count').innerText = `擊殺: ${gameState.kills}`;
    const expBar = document.getElementById('exp-bar-fill');
    if (expBar) expBar.style.width = `${(gameState.exp / gameState.nextLevelExp) * 100}%`;
    const hpBar = document.getElementById('hp-bar-fill');
    if (hpBar) hpBar.style.width = `${(player.hp / CONFIG.PLAYER_MAX_HP) * 100}%`;
    const mins = Math.floor(gameState.time / 60); const secs = Math.floor(gameState.time % 60);
    const timerElem = document.getElementById('timer');
    if (timerElem) timerElem.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

let lastFire = 0;
let lastBoomerangFire = 0;
let lastSpawnAttempt = 0;
let lastTimeUpdate = 0;

function gameLoop(timestamp) {
    if (!gameState.running) return;
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!gameState.upgradeMenuOpen) {
        player.x += joystickData.x * CONFIG.PLAYER_SPEED;
        player.y += joystickData.y * CONFIG.PLAYER_SPEED;
        gameState.camera.x = player.x - canvas.width / 2;
        gameState.camera.y = player.y - canvas.height / 2;
        
        if (timestamp - lastTimeUpdate > 1000) { 
            gameState.time++; lastTimeUpdate = timestamp; 
            const bonus = Math.floor(gameState.time / 10) * CONFIG.CHANCE_INC_PER_10S;
            gameState.currentSpawnChance = Math.min(CONFIG.MAX_SPAWN_CHANCE, CONFIG.INITIAL_SPAWN_CHANCE + bonus);
            updateUI(); 
        }

        if (timestamp - lastSpawnAttempt > CONFIG.SPAWN_INTERVAL) {
            if (Math.random() < gameState.currentSpawnChance) {
                // 新的生成規則：70% 出1隻, 20% 出3隻, 10% 出5隻
                const roll = Math.random();
                let count = 1;
                if (roll < 0.1) count = 5;
                else if (roll < 0.3) count = 3;
                for (let i = 0; i < count; i++) spawnEnemy();
            }
            lastSpawnAttempt = timestamp;
        }

        if (timestamp - lastFire > CONFIG.FIRE_RATE) { fireBullet(); lastFire = timestamp; }
        if (timestamp - lastBoomerangFire > CONFIG.BOOMERANG_FIRE_RATE) { fireBoomerang(); lastBoomerangFire = timestamp; }

        activeEnemies.forEach(e => e.update(player.x, player.y));
        activeBullets.forEach(b => b.update());
        activeBoomerangs.forEach(b => b.update(player.x, player.y));
        activeXPGems.forEach(g => g.update(player.x, player.y));
        checkCollisions();
    }
    drawBackground();
    activeXPGems.forEach(g => g.draw());
    activeBullets.forEach(b => b.draw());
    activeBoomerangs.forEach(b => b.draw());
    activeEnemies.forEach(e => e.draw());
    player.draw();
    requestAnimationFrame(gameLoop);
}

window.addEventListener('load', () => {
    resize(); player.x = 0; player.y = 0;
    setupJoystick(); requestAnimationFrame(gameLoop);
});
window.addEventListener('resize', resize);
