/**
 * BOT AI & TELEMETRY SYSTEM MODULE (bot.js)
 * Separated to reduce CPU load from the main Game loop.
 * Features: Event tracking, UI Layout manipulation, and DOM Throttling.
 */

class TelemetrySystem {
    constructor() {
        this.sessionLog = {
            metadata: {
                start_time: new Date().toISOString(),
                input_mode: 'unknown',
                device: {
                    userAgent: navigator.userAgent,
                    screen_resolution: `${window.innerWidth}x${window.innerHeight}`,
                    logical_cores: navigator.hardwareConcurrency || 'unknown',
                    device_memory_gb: navigator.deviceMemory || 'unknown'
                },
                ai_learning_data: null,
                gamification_stats: {
                    max_combo_streak: 0,
                    hearts_collected: 0,
                    lives_lost: 0
                }
            },
            performance_logs: [],
            fruit_spawns: [],
            hand_movements: [],
            game_events: []
        };

        this.lastFpsLogTime = 0;
        this.lastUiUpdateTime = 0;
        this.uiRefs = null;

        // Expose globally for the main game engine to hook into
        window.BotTracker = this;

        // Immediately load and mount the UI into the DOM
        this.mountUI();
    }

    async mountUI() {
        try {
            const res = await fetch('bot.html');
            if (res.ok) {
                const html = await res.text();
                const container = document.createElement('div');
                container.style.display = 'none'; // User requested to hide this noisy UI during gameplay
                container.innerHTML = html;
                document.body.appendChild(container);
                this.bindUI();
            } else {
                console.error("Failed to load bot.html - ensure you are running on a Local Server (Live Server).");
            }
        } catch (error) {
            console.error("CORS Error Loading bot.html. Please run via VS Code Live Server.", error);
        }
    }

    bindUI() {
        // Cache DOM nodes for High-Performance operations (to avoid DOM search in game loop)
        this.uiRefs = {
            botFps: document.getElementById('bot-fps'),
            botFruits: document.getElementById('bot-fruits'),
            botCut: document.getElementById('bot-cut'),
            botMissed: document.getElementById('bot-missed'),
            btnDownload: document.getElementById('btn-download-json'),
            btnHideLog: document.getElementById('btn-hide-log'),
            btnRestoreLog: document.getElementById('btn-restore-log'),
            logWrapper: document.getElementById('log-panel-wrapper'),
            eventLogsEl: document.getElementById('event-logs'),
            btnDownloadRect: document.getElementById('btn-download-json').getBoundingClientRect()
        };

        // Window resize resets coordinate bounds cache
        window.addEventListener('resize', () => {
            if (this.uiRefs && this.uiRefs.btnDownload) {
                this.uiRefs.btnDownloadRect = this.uiRefs.btnDownload.getBoundingClientRect();
            }
        });

        // Hide/Show Logic
        let isLogVisible = true;
        const setLogState = (visible) => {
            isLogVisible = visible;
            if (!isLogVisible) {
                this.uiRefs.logWrapper.classList.add('log-hidden');
                this.uiRefs.btnRestoreLog.style.display = 'block';
            } else {
                this.uiRefs.logWrapper.classList.remove('log-hidden');
                this.uiRefs.btnRestoreLog.style.display = 'none';
            }
            this.recordEvent("UI_LAYOUT_CHANGE", {
                action: isLogVisible ? "SHOWING_LOGS" : "HIDDEN_LOGS_FULLSCREEN_MODE",
                timestamp: performance.now()
            });
        };

        if (this.uiRefs.btnHideLog) this.uiRefs.btnHideLog.addEventListener('click', () => setLogState(false));
        if (this.uiRefs.btnRestoreLog) this.uiRefs.btnRestoreLog.addEventListener('click', () => setLogState(true));
        if (window.innerWidth < 768) setLogState(false);

        // Download JSON logic
        if (this.uiRefs.btnDownload) {
            this.uiRefs.btnDownload.addEventListener('click', () => this.downloadJSON());
        }
    }

    downloadJSON() {
        this.sessionLog.metadata.end_time = new Date().toISOString();
        if (typeof window.getScore === "function") {
            this.sessionLog.metadata.total_score = window.getScore();
        }

        if (typeof AILearning !== 'undefined') {
            this.sessionLog.metadata.ai_learning_data = AILearning.getLearningData();
        }

        // Fetch Global Gamification variables from main logic
        if (typeof comboCount !== 'undefined') {
            this.sessionLog.metadata.gamification_stats.max_combo_streak = window.highestComboEver || 0;
        }

        const jsonString = JSON.stringify(this.sessionLog, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `air_slice_telemetry_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert("✅ JSON Report Downloaded! AI ko bhej sakte hain.");
    }

    updateUIDom(stats, fruitsLength, timestamp) {
        if (!this.uiRefs) return; // UI not loaded yet

        // THROTTLE UI UPDATES (Only update texts max 5 times a second to prevent CPU overload and layout thrashing)
        if (timestamp - this.lastUiUpdateTime > 200) {
            this.uiRefs.botFps.textContent = stats.fps;
            this.uiRefs.botFps.className = stats.fps < 30 ? "text-red-500 font-bold" : "text-emerald-400 font-bold";
            this.uiRefs.botFruits.textContent = fruitsLength;
            this.uiRefs.botCut.textContent = stats.cut;
            this.uiRefs.botMissed.textContent = stats.missed;
            this.lastUiUpdateTime = timestamp;
        }
    }

    logActionUI(obj) {
        if (!this.uiRefs) return;
        const div = document.createElement('div');
        let colorClass = obj.event === 'DESTROYED (MISSED)' ? 'log-red' : 'log-green';
        div.className = `log-entry ${colorClass}`;
        div.textContent = JSON.stringify(obj);

        this.uiRefs.eventLogsEl.appendChild(div);

        // Auto scroll handling with limits
        if (this.uiRefs.eventLogsEl.children.length > 50) {
            this.uiRefs.eventLogsEl.removeChild(this.uiRefs.eventLogsEl.firstChild);
        }
        this.uiRefs.eventLogsEl.scrollTop = this.uiRefs.eventLogsEl.scrollHeight;
    }

    recordFPS(fps, timestamp) {
        if (timestamp - this.lastFpsLogTime > 2000) {
            this.sessionLog.performance_logs.push({ time_ms: Math.round(timestamp), fps: fps });
            this.lastFpsLogTime = timestamp;
        }
    }

    recordSpawn(fruitObj) {
        this.sessionLog.fruit_spawns.push({
            id: fruitObj.id, type: fruitObj.color,
            spawn_x: Math.round(fruitObj.x), spawn_y: Math.round(fruitObj.y),
            time: Math.round(performance.now())
        });
        if (this.sessionLog.fruit_spawns.length > 500) this.sessionLog.fruit_spawns.shift();
    }

    recordSwipe(speed, isCut, fruitId = null) {
        this.sessionLog.hand_movements.push({
            time: Math.round(performance.now()),
            speed_px_per_sec: Math.round(speed),
            result: isCut ? 'SUCCESS' : 'MISS',
            target_id: fruitId
        });
        if (this.sessionLog.hand_movements.length > 500) this.sessionLog.hand_movements.shift();
    }

    recordEvent(type, details) {
        this.sessionLog.game_events.push({
            time: Math.round(performance.now()),
            type: type,
            data: details
        });
        if (this.sessionLog.game_events.length > 500) this.sessionLog.game_events.shift();
    }

    // Checking if pointer clicked the download button via hover
    checkHoverClick(currentPointer, timestamp, callbackSparks) {
        if (!this.uiRefs || !this.uiRefs.btnDownloadRect || !currentPointer) return false;

        const btnRect = this.uiRefs.btnDownloadRect;

        if (currentPointer.x >= btnRect.left && currentPointer.x <= btnRect.right &&
            currentPointer.y >= btnRect.top && currentPointer.y <= btnRect.bottom) {

            if (!window.hoverStartTime) window.hoverStartTime = timestamp;
            let elapsed = timestamp - window.hoverStartTime;
            let progress = Math.min(1, elapsed / 1500);

            // Trigger the actual button
            if (progress >= 1.0) {
                if (!window.btnClickedState) {
                    this.uiRefs.btnDownload.click();
                    window.btnClickedState = true;
                    setTimeout(() => window.btnClickedState = false, 3000); // 3 sec cooldown
                    if (callbackSparks) callbackSparks(currentPointer.x, currentPointer.y);
                }
            }
            return { isHovering: true, progress: progress };
        } else {
            window.hoverStartTime = null;
            return false;
        }
    }
}

// Auto-instantiate the bot
new TelemetrySystem();
