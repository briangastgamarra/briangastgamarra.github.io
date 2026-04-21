const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ── Web Audio ────────────────────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
    try {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const now = audioCtx.currentTime;
        if (type === 'speed') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(900, now + 0.18);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc.start(now); osc.stop(now + 0.22);
        } else if (type === 'invincible') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(120, now);
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.3);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.start(now); osc.stop(now + 0.35);
        } else if (type === 'doublePoints') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.setValueAtTime(1100, now + 0.08);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
            osc.start(now); osc.stop(now + 0.28);
        } else if (type === 'collect') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(660, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.start(now); osc.stop(now + 0.12);
        } else if (type === 'gameover') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.6);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
            osc.start(now); osc.stop(now + 0.65);
        } else if (type === 'levelup') {
            // Upward arpeggio fanfare
            const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
            notes.forEach((freq, i) => {
                const o2 = audioCtx.createOscillator();
                const g2 = audioCtx.createGain();
                o2.connect(g2); g2.connect(audioCtx.destination);
                o2.type = 'triangle';
                o2.frequency.setValueAtTime(freq, now + i * 0.1);
                g2.gain.setValueAtTime(0.18, now + i * 0.1);
                g2.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.22);
                o2.start(now + i * 0.1); o2.stop(now + i * 0.1 + 0.25);
            });
        }
    } catch(e) {}
}

// ── localStorage helpers ─────────────────────────────────────────────────────
function getInventory() {
    return JSON.parse(localStorage.getItem('duckInventory') || '{"speed":0,"invincible":0,"doublePoints":0}');
}
function saveInventory(inv) { localStorage.setItem('duckInventory', JSON.stringify(inv)); }
function getActiveSkin()  { return localStorage.getItem('duckActiveSkin')  || 'default'; }
function getActiveTrail() { return localStorage.getItem('duckActiveTrail') || 'none'; }

// ── Skin ability helpers ─────────────────────────────────────────────────────
function powerUpMult()  { return getActiveSkin() === 'super'  ? 2   : 1;  }
function magnetRadius() { return getActiveSkin() === 'magnet' ? 120 : 0;  }
function speedMult()    { return getActiveSkin() === 'ghost'  ? 1.2 : 1;  }
function ghostSpawnMult() { return getActiveSkin() === 'ghost' ? 0.6 : 1; }
function bonusCoinPerObstacle() { return getActiveSkin() === 'lemon' ? 1 : 0; }

function oceanSpeedFactor() {
    if (getActiveSkin() !== 'ocean') return 1;
    return Math.max(0.6, 1 - Math.min(frameCount / 3600, 1) * 0.4);
}

// ── Difficulty config ────────────────────────────────────────────────────────
// baseSpeed   = starting speed for level 1
// speedStep   = added to currentSpeed on each level-up
// spawnBase   = obstacle spawn chance at level 1
// spawnStep   = added to spawn chance per level (caps at 0.06)
// speedIncrease = per-frame gradual speed ramp (within a level, minor)
const DIFFICULTY = {
    easy:   { baseSpeed: 2.0, speedStep: 0.35, spawnBase: 0.010, spawnStep: 0.0018, speedIncrease: 0.00008 },
    normal: { baseSpeed: 3.0, speedStep: 0.55, spawnBase: 0.016, spawnStep: 0.0028, speedIncrease: 0.00012 },
    hard:   { baseSpeed: 4.5, speedStep: 0.80, spawnBase: 0.024, spawnStep: 0.0042, speedIncrease: 0.00018 },
};
let difficulty   = 'normal';
let currentSpeed = DIFFICULTY.normal.baseSpeed;
let frameCount   = 0;

// ── Level system ─────────────────────────────────────────────────────────────
const POINTS_PER_LEVEL = 40;
let level         = 1;
let lastLevelScore = 0;   // score at which last level-up occurred

// Level-up banner animation state
let levelUpAnim = {
    active: false,
    level:  1,
    timer:  0,        // counts up from 0
    duration: 150,    // frames (~2.5s at 60fps)
};

function checkLevelUp() {
    const newLevel = 1 + Math.floor(score / POINTS_PER_LEVEL);
    if (newLevel > level) {
        level = newLevel;
        applyLevelStats();
        triggerLevelUpFX();
        saveMaxLevel();  // ← Speichere das neue Maximum-Level
    }
}

function applyLevelStats() {
    const diff = DIFFICULTY[difficulty];
    // Each level-up: bump currentSpeed by speedStep
    currentSpeed = diff.baseSpeed + (level - 1) * diff.speedStep;
    // Update speed of all existing obstacles so they don't feel laggy
    for (const obs of obstacles) obs.speed = currentSpeed;
    for (const pu  of powerups)  pu.speed  = currentSpeed;
    for (const c   of coinsList) c.speed   = currentSpeed;
}

function currentSpawnRate() {
    const diff = DIFFICULTY[difficulty];
    // Spawn rate grows each level, capped at 0.065
    return Math.min(0.065, diff.spawnBase + (level - 1) * diff.spawnStep) * ghostSpawnMult();
}

function triggerLevelUpFX() {
    playSound('levelup');
    flashColor = '#ffffff';
    flashAlpha = 0.45;
    levelUpAnim.active   = true;
    levelUpAnim.level    = level;
    levelUpAnim.timer    = 0;
}

// ── Game state ───────────────────────────────────────────────────────────────
let duck        = { x: 100, y: 300, width: 38, height: 38, speed: 5 };
let obstacles   = [];
let powerups    = [];
let coinsList   = [];
let score       = 0;
let gameRunning = true;
let highScore   = parseInt(localStorage.getItem('duckGameHighScore')) || 0;
let coins       = parseInt(localStorage.getItem('duckGameCoins'))     || 0;

let speedBoost   = false, speedBoostTime   = 0;
let invincible   = false, invincibleTime   = 0;
let doublePoints = false, doublePointsTime = 0;

let flashColor = null, flashAlpha = 0;
let floatingLabels = [];

// ── Trail system ─────────────────────────────────────────────────────────────
const TRAIL_MAX    = 400;
let trailPoints    = [];
let trailParticles = [];

function spawnTrailParticles() {
    const trail = getActiveTrail();
    if (trail === 'none' || trail === 'rainbow') return;
    const tx = duck.x, ty = duck.y + 22;
    if (trail === 'fire') {
        for (let i = 0; i < 3; i++) {
            trailParticles.push({ x:tx+Math.random()*6, y:ty+(Math.random()-0.5)*14,
                vx:-(Math.random()*1.4+0.5), vy:(Math.random()-0.5)*0.9,
                life:40+Math.random()*20, maxLife:60, r:4+Math.random()*5, type:'fire' });
        }
    } else if (trail === 'star') {
        if (frameCount % 3 === 0)
            trailParticles.push({ x:tx+Math.random()*8, y:ty+(Math.random()-0.5)*20,
                vx:-(Math.random()*0.9+0.2), vy:(Math.random()-0.5)*0.6,
                life:70+Math.random()*40, maxLife:110, r:3+Math.random()*4,
                angle:Math.random()*Math.PI*2, spin:(Math.random()-0.5)*0.14, type:'star' });
    } else if (trail === 'cloud') {
        if (frameCount % 7 === 0)
            trailParticles.push({ x:tx, y:ty+(Math.random()-0.5)*12,
                vx:-(Math.random()*0.5+0.1), vy:(Math.random()-0.5)*0.3,
                life:90+Math.random()*40, maxLife:130, r:10+Math.random()*10, type:'cloud' });
    }
}

function drawTrail() {
    const trail = getActiveTrail();
    if (trail === 'none') return;
    trailPoints.push({ x: duck.x, y: duck.y + 22 });
    if (trailPoints.length > TRAIL_MAX) trailPoints.shift();
    if (trail === 'rainbow') drawRainbowTrail();
    else { spawnTrailParticles(); drawParticleTrail(); }
}

function drawRainbowTrail() {
    if (trailPoints.length < 2) return;
    const pts = trailPoints;
    const COLORS = ['#ff0000','#ff7700','#ffee00','#00cc44','#0088ff','#8833ff','#ff00cc'];
    const total  = pts.length - 1;
    for (let i = 0; i < total; i++) {
        const a=pts[i], b=pts[i+1], frac=i/total;
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.6*frac;
        ctx.strokeStyle = COLORS[i % COLORS.length];
        ctx.lineWidth   = 4 + 7*frac;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        ctx.restore();
    }
    const oldest = pts[0];
    if (oldest.x > 0) {
        const grad = ctx.createLinearGradient(0,oldest.y,oldest.x,oldest.y);
        grad.addColorStop(0,'rgba(255,0,100,0)'); grad.addColorStop(1,'rgba(255,0,200,0.25)');
        ctx.save(); ctx.strokeStyle=grad; ctx.lineWidth=4; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(0,oldest.y); ctx.lineTo(oldest.x,oldest.y); ctx.stroke();
        ctx.restore();
    }
}

function drawParticleTrail() {
    trailParticles = trailParticles.filter(p => {
        p.x+=p.vx; p.y+=p.vy; p.life--;
        const t=p.life/p.maxLife;
        if (p.type==='fire') {
            const g2=Math.floor(140*t);
            ctx.save(); ctx.globalAlpha=t*0.88;
            const grad=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
            grad.addColorStop(0,`rgba(255,${g2+80},20,1)`);
            grad.addColorStop(0.5,`rgba(255,${g2},0,0.55)`);
            grad.addColorStop(1,`rgba(160,0,0,0)`);
            ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*(1+(1-t)*0.6),0,Math.PI*2); ctx.fill(); ctx.restore();
        } else if (p.type==='star') {
            p.angle+=p.spin;
            ctx.save(); ctx.globalAlpha=t*0.92; ctx.translate(p.x,p.y); ctx.rotate(p.angle);
            ctx.fillStyle=`hsl(${48+(1-t)*15},100%,${55+t*18}%)`;
            ctx.beginPath();
            for (let k=0;k<5;k++) {
                const oa=(k*4*Math.PI/5)-Math.PI/2, ia=oa+Math.PI/5;
                if(k===0) ctx.moveTo(Math.cos(oa)*p.r,Math.sin(oa)*p.r);
                else      ctx.lineTo(Math.cos(oa)*p.r,Math.sin(oa)*p.r);
                ctx.lineTo(Math.cos(ia)*p.r*0.42,Math.sin(ia)*p.r*0.42);
            }
            ctx.closePath(); ctx.fill(); ctx.restore();
        } else if (p.type==='cloud') {
            ctx.save(); ctx.globalAlpha=t*0.52; ctx.fillStyle='#ffffff';
            [[-0.5,0],[0,-0.38],[0.5,0]].forEach(([ox,oy])=>{
                ctx.beginPath(); ctx.arc(p.x+ox*p.r,p.y+oy*p.r,p.r*(0.58+t*0.12),0,Math.PI*2); ctx.fill();
            });
            ctx.restore();
        }
        return p.life > 0;
    });
}

// ── Input ────────────────────────────────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    handleShortcut(e.code);
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyB') {
        e.preventDefault(); coins += 50;
        localStorage.setItem('duckGameCoins', coins); refreshUI();
    }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.getElementById('diffSelect').addEventListener('change', (e) => {
    difficulty   = e.target.value;
    currentSpeed = DIFFICULTY[difficulty].baseSpeed;
});

function handleShortcut(code) {
    if (!gameRunning) return;
    const inv=getInventory(), mult=powerUpMult(), BASE=300;
    if (code==='Digit1' && inv.speed>0) {
        inv.speed--; saveInventory(inv);
        speedBoost=true; speedBoostTime=BASE*mult;
        triggerPowerUpFX('speed','⚡ BOOST!'+(mult>1?' ×2':''),'#ff7b00');
    } else if (code==='Digit2' && inv.invincible>0) {
        inv.invincible--; saveInventory(inv);
        invincible=true; invincibleTime=BASE*mult;
        triggerPowerUpFX('invincible','🛡️ SHIELD!'+(mult>1?' ×2':''),'#f4d03f');
    } else if (code==='Digit3' && inv.doublePoints>0) {
        inv.doublePoints--; saveInventory(inv);
        doublePoints=true; doublePointsTime=BASE*mult;
        triggerPowerUpFX('doublePoints','2x PUNKTE!'+(mult>1?' ×2':''),'#00cfb4');
    }
    refreshUI();
}

function triggerPowerUpFX(type, label, color) {
    playSound(type); flashColor=color; flashAlpha=0.35;
    floatingLabels.push({text:label,color,x:duck.x+19,y:duck.y-10,alpha:1.0,vy:-1.4,life:70});
}

// ── Robo skin ────────────────────────────────────────────────────────────────
function saveRoboTimers() {
    if (getActiveSkin()!=='robo') return;
    localStorage.setItem('roboTimers',JSON.stringify({speedBoost,speedBoostTime,invincible,invincibleTime,doublePoints,doublePointsTime}));
}
function loadRoboTimers() {
    if (getActiveSkin()!=='robo') return;
    try {
        const d=JSON.parse(localStorage.getItem('roboTimers')||'null');
        if (!d) return;
        speedBoost=d.speedBoost; speedBoostTime=d.speedBoostTime;
        invincible=d.invincible; invincibleTime=d.invincibleTime;
        doublePoints=d.doublePoints; doublePointsTime=d.doublePointsTime;
        localStorage.removeItem('roboTimers');
    } catch(e) {}
}

// ── Spawning ─────────────────────────────────────────────────────────────────
function spawnObstacle() {
    if (Math.random() > currentSpawnRate()) return;
    const h = Math.random() * 220 + 50;
    obstacles.push({ x:canvas.width, y:Math.random()*(canvas.height-h), width:52, height:h, speed:currentSpeed });
}

function spawnPowerUp() {
    if (Math.random()>0.005) return;
    for (const obs of obstacles) { if (Math.abs(canvas.width-obs.x)<120) return; }
    const types=['speed','invincible','doublePoints'];
    powerups.push({ x:canvas.width, y:Math.random()*(canvas.height-40), width:40, height:40, speed:currentSpeed,
        type:types[Math.floor(Math.random()*3)] });
}

function spawnCoin() {
    if (Math.random()>0.01) return;
    coinsList.push({ x:canvas.width, y:Math.random()*(canvas.height-30), width:30, height:30, speed:currentSpeed });
}

// ── Drawing ──────────────────────────────────────────────────────────────────
function drawBackground() {
    // Background colour shifts subtly with level (gets slightly more intense)
    const warm = Math.min((level - 1) * 5, 30);
    const sky = ctx.createLinearGradient(0,0,0,canvas.height);
    sky.addColorStop(0,`hsl(${205 - warm},${55+warm}%,${60}%)`);
    sky.addColorStop(1,`hsl(${195 - warm},${70}%,${85}%)`);
    ctx.fillStyle=sky; ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.fillStyle='rgba(255,255,255,0.82)';
    const cp=[
        {x:(frameCount*0.3)%(canvas.width+120)-60,       y:60,  r:34},
        {x:(frameCount*0.2+280)%(canvas.width+120)-60,   y:110, r:26},
        {x:(frameCount*0.25+500)%(canvas.width+120)-60,  y:45,  r:28},
        {x:(frameCount*0.15+150)%(canvas.width+120)-60,  y:90,  r:20},
    ];
    for (const c of cp) {
        ctx.beginPath(); ctx.arc(c.x,   c.y,   c.r,     0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(c.x+c.r,c.y-8,c.r*0.7, 0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(c.x-c.r,c.y-4,c.r*0.6, 0,Math.PI*2); ctx.fill();
    }
}

function drawBamboo(obs) {
    const {x,y,width:w,height:h}=obs;
    const g=ctx.createLinearGradient(x,0,x+w,0);
    g.addColorStop(0,'#2d6a4f'); g.addColorStop(0.4,'#52b788'); g.addColorStop(1,'#2d6a4f');
    ctx.fillStyle=g; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='rgba(0,0,0,0.18)'; ctx.lineWidth=1.5;
    const sc=Math.floor(h/28);
    for(let i=1;i<=sc;i++){const sy=y+i*(h/(sc+1));ctx.beginPath();ctx.moveTo(x,sy);ctx.lineTo(x+w,sy);ctx.stroke();}
    const cg=ctx.createLinearGradient(x,0,x+w,0);
    cg.addColorStop(0,'#1b4332');cg.addColorStop(0.5,'#40916c');cg.addColorStop(1,'#1b4332');
    ctx.fillStyle=cg;
    ctx.fillRect(x-4,y,w+8,14); ctx.beginPath(); ctx.arc(x+w/2,y+7,w/2+4,0,Math.PI*2); ctx.fill();
    ctx.fillRect(x-4,y+h-14,w+8,14); ctx.beginPath(); ctx.arc(x+w/2,y+h-7,w/2+4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.fillRect(x+8,y+16,8,h-32);
}

function drawDuck() {
    const skin=getActiveSkin();
    if (invincible&&Math.floor(invincibleTime/6)%2===0){ctx.save();ctx.globalAlpha=0.4;}
    if (skin==='ghost'){ctx.save();ctx.globalAlpha=0.72;}
    const bodyColor=skin==='super'?'#ff4444':skin==='magnet'?'#4488ff':skin==='ghost'?'#cc88ff':skin==='lemon'?'#c8e62a':skin==='robo'?'#b0bec5':skin==='ocean'?'#00c9c9':'#fff1a8';
    const beakColor=skin==='super'?'#ff9900':skin==='magnet'?'#ffcc00':skin==='ghost'?'#ff99ff':skin==='lemon'?'#88bb00':skin==='robo'?'#78909c':skin==='ocean'?'#006b6b':'#f4a261';
    ctx.fillStyle=bodyColor;
    ctx.beginPath();ctx.ellipse(duck.x+25,duck.y+25,20,18,0,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(duck.x+25,duck.y+10,12,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=beakColor;
    ctx.beginPath();ctx.ellipse(duck.x+35,duck.y+10,8,5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=skin==='robo'?'#00e5ff':'#222';
    ctx.beginPath();ctx.arc(duck.x+28,duck.y+8,2.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='white';ctx.beginPath();ctx.arc(duck.x+29,duck.y+7,1,0,Math.PI*2);ctx.fill();
    if(skin==='super'){ctx.fillStyle='#fff';ctx.font='bold 13px Arial';ctx.textAlign='center';ctx.fillText('S',duck.x+25,duck.y+29);ctx.textAlign='left';}
    else if(skin==='magnet'){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(duck.x+25,duck.y+29,5,Math.PI,0);ctx.stroke();ctx.strokeStyle='#ff4444';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(duck.x+20,duck.y+29);ctx.lineTo(duck.x+20,duck.y+26);ctx.stroke();ctx.strokeStyle='#4444ff';ctx.beginPath();ctx.moveTo(duck.x+30,duck.y+29);ctx.lineTo(duck.x+30,duck.y+26);ctx.stroke();}
    else if(skin==='ghost'){ctx.fillStyle='rgba(255,255,255,0.9)';ctx.beginPath();ctx.arc(duck.x+21,duck.y+24,2.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(duck.x+29,duck.y+28,2.5,0,Math.PI*2);ctx.fill();}
    else if(skin==='lemon'){ctx.fillStyle='#88bb00';ctx.beginPath();ctx.ellipse(duck.x+22,duck.y+0,4,7,-0.5,0,Math.PI*2);ctx.fill();}
    else if(skin==='robo'){ctx.strokeStyle='rgba(0,229,255,0.5)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(duck.x+16,duck.y+20);ctx.lineTo(duck.x+34,duck.y+20);ctx.stroke();ctx.beginPath();ctx.moveTo(duck.x+25,duck.y+20);ctx.lineTo(duck.x+25,duck.y+38);ctx.stroke();ctx.strokeStyle='#78909c';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(duck.x+25,duck.y-2);ctx.lineTo(duck.x+25,duck.y+0);ctx.stroke();ctx.fillStyle='#00e5ff';ctx.beginPath();ctx.arc(duck.x+25,duck.y-4,2.5,0,Math.PI*2);ctx.fill();}
    else if(skin==='ocean'){ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(duck.x+14,duck.y+26);ctx.quadraticCurveTo(duck.x+18,duck.y+22,duck.x+22,duck.y+26);ctx.quadraticCurveTo(duck.x+26,duck.y+30,duck.x+30,duck.y+26);ctx.stroke();}
    if(skin==='ghost')ctx.restore();
    if(invincible&&Math.floor(invincibleTime/6)%2===0)ctx.restore();
    if(skin==='magnet'){ctx.save();ctx.globalAlpha=0.08+0.04*Math.sin(frameCount*0.1);ctx.strokeStyle='#4488ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(duck.x+19,duck.y+19,magnetRadius(),0,Math.PI*2);ctx.stroke();ctx.restore();}
}

function drawPowerUp(pu) {
    ctx.save();ctx.translate(pu.x+20,pu.y+20);
    const g=ctx.createLinearGradient(0,-16,0,16);
    if(pu.type==='speed'){g.addColorStop(0,'#ffca2c');g.addColorStop(1,'#ff7b00');}
    else if(pu.type==='invincible'){g.addColorStop(0,'#ffc94d');g.addColorStop(1,'#f4d03f');}
    else{g.addColorStop(0,'#00cfb4');g.addColorStop(1,'#009a85');}
    ctx.fillStyle=g;ctx.beginPath();
    ctx.moveTo(0,-16);ctx.quadraticCurveTo(10,-6,6,0);ctx.quadraticCurveTo(14,6,4,10);
    ctx.quadraticCurveTo(-10,16,-6,6);ctx.quadraticCurveTo(-16,0,0,-16);ctx.fill();
    ctx.restore();
}

function drawCoinItem(coin) {
    ctx.save();ctx.translate(coin.x+15,coin.y+15);
    ctx.fillStyle='#FFD700';ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#FFA500';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.6)';ctx.beginPath();ctx.arc(-5,-5,4,0,Math.PI*2);ctx.fill();
    ctx.restore();
}

function drawFlash() {
    if(flashAlpha<=0)return;
    ctx.save();ctx.globalAlpha=flashAlpha;ctx.fillStyle=flashColor;
    ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();
    flashAlpha=Math.max(0,flashAlpha-0.025);
}

function drawFloatingLabels() {
    floatingLabels=floatingLabels.filter((lbl)=>{
        lbl.y+=lbl.vy;lbl.life--;lbl.alpha=Math.max(0,lbl.life/70);
        ctx.save();ctx.globalAlpha=lbl.alpha;ctx.font='bold 18px Arial';ctx.fillStyle=lbl.color;
        ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=3;
        ctx.strokeText(lbl.text,lbl.x,lbl.y);ctx.fillText(lbl.text,lbl.x,lbl.y);
        ctx.restore();return lbl.life>0;
    });
}

// ── Level-up banner ───────────────────────────────────────────────────────────
function drawLevelUpBanner() {
    if (!levelUpAnim.active) return;
    levelUpAnim.timer++;
    if (levelUpAnim.timer >= levelUpAnim.duration) { levelUpAnim.active = false; return; }

    const t   = levelUpAnim.timer / levelUpAnim.duration; // 0→1
    // Slide in from top (0→0.15), hold (0.15→0.75), slide out to top (0.75→1)
    let yFrac;
    if      (t < 0.15) yFrac = t / 0.15;
    else if (t < 0.75) yFrac = 1;
    else               yFrac = 1 - (t - 0.75) / 0.25;

    const bannerH = 80;
    const bx      = canvas.width / 2;
    const by      = -bannerH + yFrac * (bannerH + 30);   // slides from above

    ctx.save();
    ctx.globalAlpha = Math.min(1, yFrac * 2);

    // Card
    const bw = 340;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.beginPath();
    ctx.roundRect(bx - bw/2, by, bw, bannerH, 16);
    ctx.fill();

    // Coloured left stripe
    const stripe = ctx.createLinearGradient(bx - bw/2, by, bx - bw/2, by + bannerH);
    stripe.addColorStop(0, '#1f6feb'); stripe.addColorStop(1, '#0a4f9e');
    ctx.fillStyle = stripe;
    ctx.beginPath();
    ctx.roundRect(bx - bw/2, by, 8, bannerH, [16, 0, 0, 16]);
    ctx.fill();

    // "LEVEL UP!" text
    ctx.fillStyle = '#1f6feb';
    ctx.font      = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('LEVEL UP!', bx, by + 24);

    // Big level number
    ctx.fillStyle = '#1a3d5d';
    ctx.font      = 'bold 32px Arial';
    ctx.fillText(`Level ${levelUpAnim.level}`, bx, by + 58);

    // Next level hint (points needed)
    const nextAt = levelUpAnim.level * POINTS_PER_LEVEL;
    ctx.fillStyle = '#66788a';
    ctx.font      = '11px Arial';
    ctx.fillText(`Nächstes Level bei ${nextAt} Punkten`, bx, by + 75);

    ctx.textAlign = 'left';
    ctx.restore();
}

function drawHUD() {
    // ── Score box ──
    ctx.fillStyle='rgba(0,0,0,0.45)';
    ctx.beginPath();ctx.roundRect(6,6,178,28,6);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='bold 15px Arial';
    ctx.fillText('Punkte: '+score,12,24);

    // ── Level badge (left, below score) ──
    const lvlColors = [
        '#52b788','#1f6feb','#9b5de5','#f4a261','#e63946',
        '#ff006e','#fb5607','#ffbe0b','#00b4d8','#7b2d8b'
    ];
    const lvlColor = lvlColors[(level - 1) % lvlColors.length];
    ctx.fillStyle = lvlColor;
    ctx.beginPath(); ctx.roundRect(6, 40, 84, 22, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial';
    ctx.fillText(`Level ${level}`, 14, 55);

    // ── Progress bar toward next level (below level badge) ──
    const progressToNext = (score % POINTS_PER_LEVEL) / POINTS_PER_LEVEL;
    const barW = 84;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.roundRect(6, 66, barW, 7, 3); ctx.fill();
    ctx.fillStyle = lvlColor;
    ctx.beginPath(); ctx.roundRect(6, 66, barW * progressToNext, 7, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '9px Arial';
    ctx.fillText(`${score % POINTS_PER_LEVEL}/${POINTS_PER_LEVEL}`, 12, 80);

    // ── Skin + trail badges (top right) ──
    const skin=getActiveSkin();
    if (skin!=='default') {
        const label=skin==='super'?'🦸 Super':skin==='magnet'?'🧲 Magnet':skin==='ghost'?'👻 Geist':skin==='lemon'?'🍋 Zitrone':skin==='robo'?'🤖 Robo':'🌊 Ozean';
        ctx.fillStyle='rgba(0,0,0,0.38)';ctx.beginPath();ctx.roundRect(canvas.width-108,26,102,20,5);ctx.fill();
        ctx.fillStyle='#fff';ctx.font='bold 12px Arial';ctx.fillText(label,canvas.width-104,40);
    }
    const trail=getActiveTrail();
    if (trail!=='none') {
        const tl=trail==='rainbow'?'🌈 Regenbogen':trail==='fire'?'🔥 Feuer':trail==='star'?'⭐ Sterne':'☁️ Wolken';
        ctx.fillStyle='rgba(0,0,0,0.38)';ctx.beginPath();ctx.roundRect(canvas.width-108,50,102,20,5);ctx.fill();
        ctx.fillStyle='#fff';ctx.font='bold 12px Arial';ctx.fillText(tl,canvas.width-104,64);
    }

    // ── Speed / ocean bar (top right) ──
    if (skin==='ocean') {
        const factor=1-oceanSpeedFactor();const barW2=120;
        ctx.fillStyle='rgba(0,0,0,0.35)';ctx.beginPath();ctx.roundRect(canvas.width-barW2-10,8,barW2,12,4);ctx.fill();
        ctx.fillStyle='#00c9c9';ctx.beginPath();ctx.roundRect(canvas.width-barW2-10,8,barW2*(factor/0.4),12,4);ctx.fill();
        ctx.fillStyle='rgba(255,255,255,0.7)';ctx.font='10px Arial';ctx.fillText('Verlangsamung',canvas.width-barW2-10,32);
    } else {
        const diff=DIFFICULTY[difficulty];
        const maxSpeed=diff.baseSpeed + 10 * diff.speedStep;
        const progress=Math.min((currentSpeed-diff.baseSpeed)/(maxSpeed-diff.baseSpeed),1);
        const barW2=120;
        ctx.fillStyle='rgba(0,0,0,0.35)';ctx.beginPath();ctx.roundRect(canvas.width-barW2-10,8,barW2,12,4);ctx.fill();
        const bc=progress<0.4?'#52b788':progress<0.7?'#f9c74f':'#e63946';
        ctx.fillStyle=bc;ctx.beginPath();ctx.roundRect(canvas.width-barW2-10,8,barW2*progress,12,4);ctx.fill();
        ctx.fillStyle='rgba(255,255,255,0.7)';ctx.font='10px Arial';ctx.fillText('Tempo',canvas.width-barW2-10,32);
    }

    // ── Active power-up timers (bottom) ──
    const sy=canvas.height-12;ctx.font='bold 13px Arial';
    if(speedBoost)  {ctx.fillStyle='#ff7b00';ctx.fillText('⚡ Schneller! ('+Math.ceil(speedBoostTime/60)+'s)',10,sy);}
    if(invincible)  {ctx.fillStyle='#f4d03f';ctx.fillText('🛡️ Unverwundbar! ('+Math.ceil(invincibleTime/60)+'s)',220,sy);}
    if(doublePoints){ctx.fillStyle='#00cfb4';ctx.fillText('2x Punkte! ('+Math.ceil(doublePointsTime/60)+'s)',480,sy);}
}

function drawGameOver() {
    ctx.fillStyle='rgba(0,0,0,0.65)';ctx.fillRect(0,0,canvas.width,canvas.height);
    const cw=420,ch=240,cx=(canvas.width-cw)/2,cy=(canvas.height-ch)/2;
    ctx.fillStyle='rgba(255,255,255,0.96)';ctx.beginPath();ctx.roundRect(cx,cy,cw,ch,20);ctx.fill();
    ctx.strokeStyle='rgba(31,111,235,0.2)';ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(cx,cy,cw,ch,20);ctx.stroke();
    ctx.textAlign='center';
    ctx.fillStyle='#e63946';ctx.font='bold 38px Arial';ctx.fillText('Spiel vorbei!',canvas.width/2,cy+52);
    ctx.fillStyle='#1a3d5d';ctx.font='bold 20px Arial';ctx.fillText('Punkte: '+score+'  ·  Level '+level,canvas.width/2,cy+92);
    ctx.fillStyle='#3b4d66';ctx.font='17px Arial';ctx.fillText('Highscore: '+highScore,canvas.width/2,cy+122);
    // Reached level display
    const lvlColors=['#52b788','#1f6feb','#9b5de5','#f4a261','#e63946','#ff006e','#fb5607','#ffbe0b','#00b4d8','#7b2d8b'];
    ctx.fillStyle=lvlColors[(level-1)%lvlColors.length];
    ctx.font='bold 15px Arial';ctx.fillText('🏁 Erreichtes Level: '+level,canvas.width/2,cy+152);
    ctx.fillStyle='#66788a';ctx.font='14px Arial';ctx.fillText('Neustart → Button klicken',canvas.width/2,cy+182);
    ctx.textAlign='left';
}

// ── Collision ────────────────────────────────────────────────────────────────
function hits(a,b){return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;}

function applyMagnet() {
    const r=magnetRadius();if(r===0)return;
    const dx=duck.x+19,dy=duck.y+19;
    for(const coin of coinsList){
        const cx=coin.x+15,cy=coin.y+15,dist=Math.hypot(dx-cx,dy-cy);
        if(dist<r&&dist>1){const s=3.5*(1-dist/r);coin.x+=(dx-cx)/dist*s;coin.y+=(dy-cy)/dist*s;}
    }
}

// ── Main loop ────────────────────────────────────────────────────────────────
function gameLoop() {
    if (!gameRunning) return;
    frameCount++;

    // Gentle per-frame speed ramp within a level (minor, level-ups are the big jumps)
    const diff = DIFFICULTY[difficulty];
    currentSpeed += diff.speedIncrease;

    drawBackground();
    drawTrail();

    const spd=duck.speed*speedMult()*(speedBoost?1.6:1);
    if(keys['ArrowLeft'] &&duck.x>0)                        duck.x-=spd;
    if(keys['ArrowRight']&&duck.x<canvas.width-duck.width)  duck.x+=spd;
    if(keys['ArrowUp']   &&duck.y>0)                        duck.y-=spd;
    if(keys['ArrowDown'] &&duck.y<canvas.height-duck.height)duck.y+=spd;

    spawnPowerUp();
    powerups=powerups.filter((pu)=>{
        pu.x-=pu.speed;drawPowerUp(pu);
        if(hits(duck,pu)){
            const inv=getInventory();inv[pu.type]++;saveInventory(inv);
            playSound('collect');
            floatingLabels.push({text:pu.type==='speed'?'⚡ +1':pu.type==='invincible'?'🛡️ +1':'2x +1',
                color:pu.type==='speed'?'#ff7b00':pu.type==='invincible'?'#f4d03f':'#00cfb4',
                x:pu.x,y:pu.y-5,alpha:1,vy:-1,life:50});
            refreshUI();return false;
        }
        return pu.x+pu.width>0;
    });

    applyMagnet();spawnCoin();
    coinsList=coinsList.filter((coin)=>{
        coin.x-=coin.speed;drawCoinItem(coin);
        if(hits(duck,coin)){
            coins++;localStorage.setItem('duckGameCoins',coins);
            playSound('collect');refreshUI();return false;
        }
        return coin.x+coin.width>0;
    });

    if(speedBoostTime>0)  speedBoostTime--;  else speedBoost=false;
    if(invincibleTime>0)  invincibleTime--;  else invincible=false;
    if(doublePointsTime>0)doublePointsTime--;else doublePoints=false;

    spawnObstacle();
    obstacles=obstacles.filter((obs)=>{
        obs.x-=obs.speed*oceanSpeedFactor();drawBamboo(obs);
        if(hits(duck,obs)&&!invincible){
            gameRunning=false;
            if(score>highScore){highScore=score;localStorage.setItem('duckGameHighScore',highScore);}
            saveRoboTimers();refreshUI();drawDuck();playSound('gameover');drawGameOver();
            return true;
        }
        if(obs.x+obs.width<0){
            const bonus=bonusCoinPerObstacle();
            score+=doublePoints?2:1;
            if(bonus>0){coins+=bonus;localStorage.setItem('duckGameCoins',coins);}
            checkLevelUp();   // ← level check after every point gained
            refreshUI();return false;
        }
        return true;
    });

    drawDuck();
    drawFlash();
    drawFloatingLabels();
    drawLevelUpBanner();  // ← drawn on top of everything
    drawHUD();

    requestAnimationFrame(gameLoop);
}

// ── UI ───────────────────────────────────────────────────────────────────────
function refreshUI() {
    document.getElementById('highscoreLabel').textContent=highScore+' Punkte';
    document.getElementById('coinsLabel').textContent=coins;
    const inv=getInventory();
    document.getElementById('speedCount').textContent=inv.speed;
    document.getElementById('shieldCount').textContent=inv.invincible;
    document.getElementById('pointsCount').textContent=inv.doublePoints;

    // Level sidebar widgets
    const lvlEl = document.getElementById('levelLabel');
    const barEl  = document.getElementById('levelProgressBar');
    const txtEl  = document.getElementById('levelProgressText');
    if (lvlEl) lvlEl.textContent = level;
    if (barEl) {
        const pct = ((score % POINTS_PER_LEVEL) / POINTS_PER_LEVEL) * 100;
        barEl.style.width = pct + '%';
        const lvlColors=['#52b788','#1f6feb','#9b5de5','#f4a261','#e63946','#ff006e','#fb5607','#ffbe0b','#00b4d8','#7b2d8b'];
        const c = lvlColors[(level-1) % lvlColors.length];
        barEl.style.background = `linear-gradient(90deg,${c},${c}cc)`;
    }
    if (txtEl) txtEl.textContent = (score % POINTS_PER_LEVEL) + ' / ' + POINTS_PER_LEVEL + ' Punkte';
}

document.getElementById('restartButton').addEventListener('click',()=>{
    const diff=DIFFICULTY[difficulty];
    duck.x=100;duck.y=300;obstacles=[];powerups=[];coinsList=[];
    score=0;frameCount=0;level=1;lastLevelScore=0;
    currentSpeed=diff.baseSpeed;gameRunning=true;
    speedBoost=false;speedBoostTime=0;invincible=false;invincibleTime=0;
    doublePoints=false;doublePointsTime=0;flashAlpha=0;floatingLabels=[];
    trailPoints=[];trailParticles=[];
    levelUpAnim.active=false;levelUpAnim.timer=0;
    loadRoboTimers();
    refreshUI();requestAnimationFrame(gameLoop);
});

document.getElementById('newPageButton').addEventListener('click',()=>{window.location.href='marktplatz.html';});

// ── Speichere Maximum-Level in localStorage für Marktplatz ──
function saveMaxLevel() { 
    const currentMax = parseInt(localStorage.getItem('duckGameMaxLevel')) || 1;
    if (level > currentMax) {
        localStorage.setItem('duckGameMaxLevel', level);
    }
}

refreshUI();
gameLoop();
