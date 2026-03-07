// ==========================================
// GAME ENGINE (Telemetry UI is now in bot.js)
// ==========================================
let HIT_BUFFER = 20; // Base hit buffer
const SWIPE_DIST_MIN = 25;
const MAX_FRUITS_ON_SCREEN = 5;

const video = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const scoreEl = document.getElementById('score');
const overlay = document.getElementById('start-overlay');
const errorBox = document.getElementById('error-box');

// Responsive dimension logic
const canvasContainer = document.getElementById('canvas-container');
let W = canvasContainer.clientWidth;
let H = canvasContainer.clientHeight;
canvas.width = W;
canvas.height = H;

let gameActive = false, isPaused = false, inputMode = 'touch', hasCameraBg = false, isGameOver = false;
let score = 0, lives = 5, comboCount = 0, fruits = [], particles = [], cutFruits = [], splashes = [], fid = 0;
window.highestComboEver = 0; // Expose to Bot telemetry
let pointers = {}, trails = {}, isAIProcessing = false; // Support for Both Hands
let videoDrawParams = { dx: 0, dy: 0, dw: 0, dh: 0 };

let stats = { cut: 0, missed: 0, lastFrameTime: 0, fps: 60, lastSpawnTime: 0 };
const colors = ['#ef4444', '#facc15', '#22c55e', '#f97316'];
const fruitNames = ['Apple', 'Banana', 'Watermelon', 'Orange', 'Pineapple'];
const fruitImages = {};
fruitNames.forEach(name => {
    fruitImages[name] = {
        whole: new Image(),
        halfLeft: new Image(),
        halfRight: new Image(),
        splash: new Image()
    };
    fruitImages[name].whole.src = `images/${name}/Whole_${name}.png`;
    fruitImages[name].halfLeft.src = `images/${name}/Left_Half_${name}.png`;
    fruitImages[name].halfRight.src = `images/${name}/Right_Half_${name}.png`;

    // Account for the Apple splash difference
    if (name === 'Apple') {
        fruitImages[name].splash.src = `images/${name}/Splash_Effect_Cut_${name}.png`;
    } else {
        fruitImages[name].splash.src = `images/${name}/Juice_Splash_Effect_${name}.png`;
    }
});

// Expose score to the Bot Logger
window.getScore = () => score;

window.addEventListener('resize', () => {
    W = canvasContainer.clientWidth;
    H = canvasContainer.clientHeight;
    canvas.width = W;
    canvas.height = H;
});

// Touch Input
function handleTouchMove(e) {
    if (inputMode === 'touch' && gameActive) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        let cX = e.touches ? e.touches[0].clientX : e.clientX;
        let cY = e.touches ? e.touches[0].clientY : e.clientY;
        pointers['touch_0'] = { x: cX - rect.left, y: cY - rect.top, time: performance.now() };
    }
}

canvas.addEventListener('mousemove', handleTouchMove);
canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
canvas.addEventListener('touchstart', (e) => { handleTouchMove(e); trails['touch_0'] = []; }, { passive: false });
canvas.addEventListener('mouseleave', () => { delete pointers['touch_0']; delete trails['touch_0']; });
canvas.addEventListener('touchend', () => { delete pointers['touch_0']; delete trails['touch_0']; });

function spawn(timestamp) {
    if (fruits.length >= MAX_FRUITS_ON_SCREEN) return;

    const r = 30 + Math.random() * 20; // Increased base radius slightly for better image visibility

    // Calculate upward velocity via Physics
    const requiredVy = Math.sqrt(0.7 * H);
    const randomVy = -(requiredVy * (0.7 + Math.random() * 0.3));

    // Dynamic chance to spawn a heart based on missing lives
    // Agar 4 lives hain (sirf 1 khoyi) -> 5% chance. Agar 1 life hai (4 khoyi) -> 20% chance.
    let isHeart = false;
    if (lives < 5) {
        let missingLives = 5 - lives;
        let spawnChance = missingLives * 0.05; // 0.05, 0.10, 0.15, 0.20
        if (Math.random() < spawnChance) {
            isHeart = true;
        }
    }

    let fruitType = fruitNames[Math.floor(Math.random() * fruitNames.length)];
    let f = {
        id: isHeart ? `heart_${++fid}` : `food_${++fid}`,
        type: fruitType,
        color: isHeart ? '#ff0000' : colors[Math.floor(Math.random() * colors.length)],
        isHeart: isHeart,
        x: r + Math.random() * (W - r * 2), y: H + r, r: r,
        vx: (Math.random() - 0.5) * 6, vy: randomVy, active: true,
        rotation: 0,
        rotationSpeed: (Math.random() - 0.5) * 0.2
    };
    fruits.push(f);
    stats.lastSpawnTime = timestamp;
    if (window.BotTracker) window.BotTracker.recordSpawn(f);
}

// --- Main Loop ---
function loop(timestamp) {
    if (!gameActive || isGameOver) return;

    // Handle Pausing without breaking the physics timestep
    if (isPaused) {
        stats.lastFrameTime = timestamp;
        requestAnimationFrame(loop);
        return;
    }

    // FPS and TimeScale Calculation (Physics Sync)
    let timeScale = 1;
    if (stats.lastFrameTime) {
        let deltaTimeMs = timestamp - stats.lastFrameTime;
        stats.fps = Math.round(1000 / deltaTimeMs);

        // Calculate TimeScale: How many 60fps frames passed in this single real frame?
        // E.g., if laggy at 15fps, timeScale = 4.0. Physics will run 4x faster to catch up!
        timeScale = deltaTimeMs / 16.666;
        if (timeScale > 5) timeScale = 5; // Cap to prevent teleporting bugs on severe lag

        if (window.BotTracker) window.BotTracker.recordFPS(stats.fps, timestamp);
    }
    stats.lastFrameTime = timestamp;

    if (timestamp - stats.lastSpawnTime > 1200) spawn(timestamp);

    let dynamicHitBuffer = HIT_BUFFER + (typeof AILearning !== 'undefined' ? AILearning.getHitBufferOffset() : 0);

    // Draw Background
    if (hasCameraBg && video.readyState >= 2) {
        const vRatio = video.videoWidth / video.videoHeight;
        const cRatio = W / H;
        let dw = vRatio > cRatio ? H * vRatio : W;
        let dh = vRatio > cRatio ? H : W / vRatio;
        let dx = vRatio > cRatio ? (W - dw) / 2 : 0;
        let dy = vRatio > cRatio ? 0 : (H - dh) / 2;

        videoDrawParams = { dx, dy, dw, dh };

        ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
        ctx.drawImage(video, dx, dy, dw, dh); ctx.restore();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.4)'; ctx.fillRect(0, 0, W, H);
    } else {
        ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
    }

    // Process Hand Tracking for all fingers concurrently (Two hands or touch)
    let anyPointerSwipingCount = 0;

    // First update the fruits positions based on TimeScale
    for (let i = fruits.length - 1; i >= 0; i--) {
        let f = fruits[i];

        // Apply Gravity and Movement multiplied by time lag (Delta Time)
        f.vy += 0.35 * timeScale;
        f.x += f.vx * timeScale;
        f.y += f.vy * timeScale;

        if (f.isHeart) {
            ctx.font = `${Math.floor(f.r * 2)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❤️', f.x, f.y);
        } else {
            f.rotation += f.rotationSpeed * timeScale;
            if (fruitImages[f.type] && fruitImages[f.type].whole.complete) {
                ctx.save();
                ctx.translate(f.x, f.y);
                ctx.rotate(f.rotation);

                // Add a small shadow to make fruits pop out
                ctx.shadowColor = 'rgba(0,0,0,0.5)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 5;

                // Draw image centered; scaling it a bit bigger than the hitbox r
                ctx.drawImage(fruitImages[f.type].whole, -f.r * 1.4, -f.r * 1.4, f.r * 2.8, f.r * 2.8);
                ctx.restore();
            } else {
                ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
                ctx.fillStyle = f.color; ctx.fill();
                ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke();
            }
        }
    }

    for (let pid in pointers) {
        let current = pointers[pid];
        let isSwiping = false, startPos = null, endPos = null, currentSpeed = 0;

        if (current) {
            current.time = timestamp;
            if (!trails[pid]) trails[pid] = [];
            trails[pid].push({ ...current });
            if (trails[pid].length > 5) trails[pid].shift();

            ctx.beginPath(); ctx.arc(current.x, current.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();

            if (trails[pid].length > 1) {
                startPos = trails[pid][0]; endPos = trails[pid][trails[pid].length - 1];
                let dist = Math.hypot(endPos.x - startPos.x, endPos.y - startPos.y);
                let dt = (endPos.time - startPos.time) / 1000;

                if (dist > SWIPE_DIST_MIN && dt > 0) {
                    isSwiping = true;
                    currentSpeed = dist / dt;

                    ctx.beginPath(); ctx.moveTo(trails[pid][0].x, trails[pid][0].y);
                    for (let i = 1; i < trails[pid].length; i++) ctx.lineTo(trails[pid][i].x, trails[pid][i].y);
                    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
                }
            }
        }

        let swipeRegistered = false;
        let closestFruit = null;
        let closestDistSq = Infinity;

        // Hit Detection against all active fruits
        for (let i = fruits.length - 1; i >= 0; i--) {
            let f = fruits[i];

            if (current && f.active) {
                let dSq = Math.pow(f.x - current.x, 2) + Math.pow(f.y - current.y, 2);
                if (dSq < closestDistSq) { closestDistSq = dSq; closestFruit = f; }
            }

            if (isSwiping && startPos && endPos && f.active) {
                let l2 = Math.pow(endPos.x - startPos.x, 2) + Math.pow(endPos.y - startPos.y, 2);
                let t = l2 === 0 ? 0 : ((f.x - startPos.x) * (endPos.x - startPos.x) + (f.y - startPos.y) * (endPos.y - startPos.y)) / l2;
                t = Math.max(0, Math.min(1, t));
                let projX = startPos.x + t * (endPos.x - startPos.x);
                let projY = startPos.y + t * (endPos.y - startPos.y);
                let distSq = Math.pow(f.x - projX, 2) + Math.pow(f.y - projY, 2);

                if (distSq <= Math.pow(f.r + dynamicHitBuffer, 2)) {
                    f.active = false;
                    swipeRegistered = true;

                    if (f.isHeart) {
                        if (window.GameAudio) window.GameAudio.playRandom('combo', 1.0);
                        if (window.BotTracker) window.BotTracker.sessionLog.metadata.gamification_stats.hearts_collected++;

                        if (lives < 5) {
                            lives++;
                            let heartEl = document.getElementById(`heart-${lives}`);
                            if (heartEl) heartEl.classList.remove('cracked');
                            for (let j = 0; j < 10; j++) particles.push({ x: f.x, y: f.y, vx: (Math.random() - .5) * 10, vy: (Math.random() - .5) * 10, l: 1, c: '#ef4444', text: j === 0 ? '+1 Life!' : null });
                        } else {
                            score += 50; scoreEl.textContent = score;
                            for (let j = 0; j < 10; j++) particles.push({ x: f.x, y: f.y, vx: (Math.random() - .5) * 10, vy: (Math.random() - .5) * 10, l: 1, c: '#ef4444', text: j === 0 ? '+50 Bonus' : null });
                        }
                    } else {
                        comboCount++;
                        if (comboCount > window.highestComboEver) window.highestComboEver = comboCount;
                        score += 10;

                        if (window.GameAudio) window.GameAudio.playRandom('slice', 0.8);

                        if (comboCount > 0 && comboCount % 5 === 0) {
                            score += 20; // Bonus points!
                            if (window.GameAudio) window.GameAudio.playRandom('combo', 1.0);
                            // Make a cool popup text for combo
                            for (let j = 0; j < 15; j++) particles.push({ x: f.x, y: f.y, vx: (Math.random() - .5) * 20, vy: (Math.random() - .5) * 20, l: 1, c: '#f59e0b', text: j === 0 ? `COMBO x${comboCount}` : null });
                        }

                        if (fruitImages[f.type]) {
                            splashes.push({ type: f.type, x: f.x, y: f.y, l: 1.0, scale: f.r / 15 });
                            cutFruits.push({ type: f.type, isLeft: true, x: f.x - 10, y: f.y, vx: -3 - Math.random() * 2, vy: f.vy - 2, r: f.r, rotation: f.rotation, rotationSpeed: -0.15 });
                            cutFruits.push({ type: f.type, isLeft: false, x: f.x + 10, y: f.y, vx: 3 + Math.random() * 2, vy: f.vy - 2, r: f.r, rotation: f.rotation, rotationSpeed: 0.15 });
                        }
                        for (let j = 0; j < 6; j++) particles.push({ x: f.x, y: f.y, vx: (Math.random() - .5) * 15, vy: (Math.random() - .5) * 15, l: 1, c: f.color });

                        scoreEl.textContent = score;
                        stats.cut++;
                    }

                    if (window.BotTracker) {
                        let evLog = { event: "FRUIT_CUT", id: f.id, speed: Math.round(currentSpeed) };
                        window.BotTracker.logActionUI(evLog);
                        window.BotTracker.recordEvent('FRUIT_CUT', evLog);
                        window.BotTracker.recordSwipe(currentSpeed, true, f.id);
                    }
                    if (typeof AILearning !== 'undefined') AILearning.recordSwipe(true, f.x, f.y, current.x, current.y);
                }
            }
        }

        if (isSwiping && !swipeRegistered && currentSpeed > 400 && current) {
            if (!current.lastMissLog || timestamp - current.lastMissLog > 250) { // 250ms debouncing so it doesn't spam every frame!
                current.lastMissLog = timestamp;
                if (Math.random() > 0.5 && window.BotTracker) window.BotTracker.recordSwipe(currentSpeed, false);
                if (typeof AILearning !== 'undefined' && closestFruit) {
                    AILearning.recordSwipe(false, closestFruit.x, closestFruit.y, current.x, current.y);
                }
            }
        }

        // Bot UI - Hover Download Checker (Allow any hand to hover)
        if (window.BotTracker && inputMode === 'ai' && current) {
            let hoverResult = window.BotTracker.checkHoverClick(current, timestamp, (x, y) => {
                for (let j = 0; j < 20; j++) particles.push({ x: x, y: y, vx: (Math.random() - .5) * 15, vy: (Math.random() - .5) * 15, l: 1, c: '#10b981' });
            });

            if (hoverResult && hoverResult.isHovering) {
                ctx.beginPath(); ctx.arc(current.x, current.y, 25, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(245, 158, 11, 0.2)'; ctx.fill();

                ctx.beginPath();
                ctx.arc(current.x, current.y, 25, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * hoverResult.progress));
                ctx.strokeStyle = '#10b981'; ctx.lineWidth = 4; ctx.stroke();

                ctx.fillStyle = "white"; ctx.font = "10px JetBrains Mono";
                ctx.fillText("HOLD TO CLICK", current.x - 38, current.y - 35);
            }
        }
    }

    // Fruit Garbage Collection
    for (let i = fruits.length - 1; i >= 0; i--) {
        let f = fruits[i];
        if (!f.active || f.y > H + 50 || f.x < -50 || f.x > W + 50) {
            if (f.active) {
                if (!f.isHeart) { // Only lose lives/combo if you miss a food fruit
                    stats.missed++;
                    comboCount = 0; // Wipe combo!
                    if (window.GameAudio) window.GameAudio.playRandom('miss', 0.6);

                    let heartEl = document.getElementById(`heart-${lives}`);
                    if (heartEl) heartEl.classList.add('cracked');
                    lives--;
                    if (window.BotTracker) window.BotTracker.sessionLog.metadata.gamification_stats.lives_lost++;
                }

                if (window.BotTracker) {
                    let evLog = { event: "DESTROYED (MISSED)", id: f.id };
                    window.BotTracker.logActionUI(evLog);
                    window.BotTracker.recordEvent('FRUIT_MISSED', evLog);
                }

                if (lives <= 0 && !isGameOver) {
                    isGameOver = true;
                    document.getElementById('btn-pause').style.display = 'none'; // Hide pause button
                    // Trigger Game Over Flow
                    if (window.GameAudio) {
                        window.GameAudio.stopBgm();
                        window.GameAudio.playRandom('game_over');
                    }
                    document.getElementById('final-score').textContent = score;
                    document.getElementById('game-over-overlay').style.display = 'flex';

                }
            }
            fruits.splice(i, 1);
        }
    }

    // Splashes
    for (let i = splashes.length - 1; i >= 0; i--) {
        let s = splashes[i];
        s.l -= 0.02 * timeScale;
        if (s.l <= 0) { splashes.splice(i, 1); continue; }
        if (fruitImages[s.type] && fruitImages[s.type].splash.complete) {
            ctx.save();
            ctx.globalAlpha = Math.max(0, s.l);
            let size = s.scale * 40;
            ctx.drawImage(fruitImages[s.type].splash, s.x - size, s.y - size, size * 2, size * 2);
            ctx.restore();
        }
    }

    // Cut Fruits
    for (let i = cutFruits.length - 1; i >= 0; i--) {
        let cf = cutFruits[i];
        cf.vy += 0.35 * timeScale;
        cf.x += cf.vx * timeScale;
        cf.y += cf.vy * timeScale;
        cf.rotation += cf.rotationSpeed * timeScale;

        if (cf.y > H + 50) { cutFruits.splice(i, 1); continue; }

        let img = cf.isLeft ? fruitImages[cf.type].halfLeft : fruitImages[cf.type].halfRight;
        if (img && img.complete) {
            ctx.save();
            ctx.translate(cf.x, cf.y);
            ctx.rotate(cf.rotation);
            ctx.drawImage(img, -cf.r * 1.4, -cf.r * 1.4, cf.r * 2.8, cf.r * 2.8);
            ctx.restore();
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        // Multiply particle speed by time lag
        p.x += p.vx * timeScale;
        p.y += p.vy * timeScale;
        p.l -= 0.05 * timeScale;

        ctx.globalAlpha = Math.max(0, p.l);
        if (p.text) {
            ctx.fillStyle = "white";
            ctx.font = "bold 20px sans-serif";
            ctx.fillText(p.text, p.x, p.y);
        } else {
            ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 5, 5);
        }
        ctx.globalAlpha = 1.0;

        if (p.l <= 0) particles.splice(i, 1);
    }

    // Bot UI Panel Updates (throttled locally in BotTracker)
    if (window.BotTracker) window.BotTracker.updateUIDom(stats, fruits.length, timestamp);

    requestAnimationFrame(loop);
}

// --- Setup & Hand Tracking ---
async function setupCameraOnly() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    await video.play();
    hasCameraBg = true;
}

function loadScript(src) {
    return new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = src; s.crossOrigin = "anonymous";
        s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
}

async function initFullAI() {
    document.getElementById('loading-spinner').style.display = 'block';
    await setupCameraOnly();
    await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");
    await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");

    const hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    // Increase to track both hands simultaneously! User requirement: dual index finger hit
    hands.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

    hands.onResults((res) => {
        let activeKeys = [];

        if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
            for (let i = 0; i < Math.min(2, res.multiHandLandmarks.length); i++) {
                const tip = res.multiHandLandmarks[i][8];
                let mappedX, mappedY;

                if (videoDrawParams.dw > 0) {
                    const originalMappedX = videoDrawParams.dx + tip.x * videoDrawParams.dw;
                    mappedX = W - originalMappedX;
                    mappedY = videoDrawParams.dy + tip.y * videoDrawParams.dh;
                } else {
                    mappedX = (1 - tip.x) * W;
                    mappedY = tip.y * H;
                }

                if (typeof AILearning !== 'undefined') {
                    const fix = AILearning.getPointerCorrection();
                    mappedX += fix.x;
                    mappedY += fix.y;
                }

                // Use Handedness label to ensure Left and Right hands don't swap trails!
                let handLabel = res.multiHandedness ? res.multiHandedness[i].label : `Hand`;
                // Add index just in case camera detects two "Right" hands by mistake
                let pointerKey = `ai_${handLabel}_${i}`;

                // Teleportation bug fix (if camera swaps hands rapidly, break the trail)
                if (pointers[pointerKey]) {
                    let dist = Math.hypot(pointers[pointerKey].x - mappedX, pointers[pointerKey].y - mappedY);
                    if (dist > 300) {
                        delete trails[pointerKey]; // Break the visual line so it doesn't cross the screen
                    }
                }

                activeKeys.push(pointerKey);
                pointers[pointerKey] = { x: mappedX, y: mappedY, time: performance.now() };
            }
        }

        // Clear ghost trackers and their trails so they don't reconnect magnetically
        for (let key in pointers) {
            if (key.startsWith('ai_') && !activeKeys.includes(key)) {
                delete pointers[key];
                delete trails[key];
            }
        }
    });

    const cam = new Camera(video, {
        onFrame: async () => {
            if (gameActive && !isAIProcessing) {
                isAIProcessing = true;
                await hands.send({ image: video });
                isAIProcessing = false;
            }
        },
        width: 480, height: 360
    });
    await cam.start();
    document.getElementById('loading-spinner').style.display = 'none';
}

function startGame() {
    overlay.style.display = 'none';
    document.getElementById('game-over-overlay').style.display = 'none';



    // Reset Logic
    gameActive = true;
    isGameOver = false;
    isPaused = false;
    document.getElementById('btn-pause').style.display = 'flex'; // Show Pause Button
    document.getElementById('btn-settings').style.display = 'none'; // Hide Settings when game starts

    score = 0;
    lives = 5;
    comboCount = 0;
    fruits = [];
    particles = [];
    cutFruits = [];
    splashes = [];
    pointers = {};
    trails = {};
    scoreEl.textContent = '0';

    // Restore hearts visual
    for (let i = 1; i <= 5; i++) {
        let h = document.getElementById(`heart-${i}`);
        if (h) h.classList.remove('cracked');
    }

    if (window.GameAudio) window.GameAudio.startBgm();
    if (window.BotTracker) window.BotTracker.sessionLog.metadata.input_mode = inputMode;

    stats.lastSpawnTime = performance.now();
    requestAnimationFrame(loop);
}

function showError(msg) {
    errorBox.classList.remove('hidden');
    document.getElementById('loading-spinner').style.display = 'none';
    document.getElementById('error-msg').innerText = "❌ " + msg;
    document.getElementById('error-fix').innerHTML = "Please ensure Camera permissions are granted to the App. Also make sure you have internet to load AI brain (CDN).<br><small>Technical code: " + msg + "</small>";
}

document.getElementById('btn-full-ai').onclick = async () => {
    try { inputMode = 'ai'; await initFullAI(); startGame(); } catch (e) { showError(e.message); }
};
document.getElementById('btn-safe-ar').onclick = async () => {
    try { inputMode = 'touch'; await setupCameraOnly(); startGame(); } catch (e) { showError(e.message); }
};

document.getElementById('btn-play-again').onclick = () => {
    startGame();
};

// Settings Modal Logic
const settingsBtn = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('btn-close-settings');
const toggleBgm = document.getElementById('toggle-bgm');
const toggleSfx = document.getElementById('toggle-sfx');

if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        if (window.GameSettings) {
            toggleBgm.checked = window.GameSettings.bgm;
            toggleSfx.checked = window.GameSettings.sfx;
        }
        settingsModal.style.display = 'flex';
    });
}

if (closeSettingsBtn) {
    const handleSettingsClose = () => {
        if (window.GameSettings) {
            window.GameSettings.bgm = toggleBgm.checked;
            window.GameSettings.sfx = toggleSfx.checked;
            localStorage.setItem('fruitCutterSettings', JSON.stringify(window.GameSettings));

            // Apply BGM settings dynamically if changed mid-game
            if (window.GameAudio) {
                if (!window.GameSettings.bgm) {
                    window.GameAudio.stopBgm();
                } else if (gameActive && !isGameOver) {
                    window.GameAudio.startBgm();
                }
            }
        }
        settingsModal.style.display = 'none';
    };

    closeSettingsBtn.addEventListener('click', handleSettingsClose);
    const topCloseX = document.getElementById('btn-close-settings-x');
    if (topCloseX) topCloseX.addEventListener('click', handleSettingsClose);
}

const pauseCloseX = document.getElementById('btn-close-pause-x');
if (pauseCloseX) {
    pauseCloseX.addEventListener('click', () => {
        const pauseModal = document.getElementById('pause-modal');
        const btnPause = document.getElementById('btn-pause');
        if (pauseModal) pauseModal.style.display = 'none';
        if (btnPause) btnPause.style.display = 'flex';
        isPaused = false;
    });
}

// GUI Buttons & Interactions Mapping
const btnPause = document.getElementById('btn-pause');
const pauseModal = document.getElementById('pause-modal');

if (btnPause) {
    btnPause.addEventListener('click', () => {
        isPaused = true;
        pauseModal.style.display = 'flex';
        btnPause.style.display = 'none';
    });
}

const btnResume = document.getElementById('btn-resume');
if (btnResume) {
    btnResume.addEventListener('click', () => {
        pauseModal.style.display = 'none';
        btnPause.style.display = 'flex';
        isPaused = false;
    });
}

const btnRestartPause = document.getElementById('btn-restart-pause');
if (btnRestartPause) {
    btnRestartPause.addEventListener('click', () => {
        pauseModal.style.display = 'none';
        startGame();
    });
}

const btnHomePause = document.getElementById('btn-home-pause');
if (btnHomePause) {
    btnHomePause.addEventListener('click', () => {
        pauseModal.style.display = 'none';
        btnPause.style.display = 'none';
        gameActive = false;
        isGameOver = true;
        document.getElementById('start-overlay').style.display = 'flex';
        document.getElementById('btn-settings').style.display = 'flex'; // Restore settings logic on main menu
        if (window.GameAudio) window.GameAudio.stopBgm();
    });
}

const btnHomeGameOver = document.getElementById('btn-home-gameover');
if (btnHomeGameOver) {
    btnHomeGameOver.addEventListener('click', () => {
        document.getElementById('game-over-overlay').style.display = 'none';
        gameActive = false;
        isGameOver = true;
        document.getElementById('start-overlay').style.display = 'flex';
        document.getElementById('btn-settings').style.display = 'flex'; // Restore settings logic on main menu
        if (window.GameAudio) window.GameAudio.stopBgm();
    });
}
