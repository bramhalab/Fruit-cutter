class AudioManager {
    constructor() {
        this.basePath = 'Sound_Effect/';
        this.sounds = {
            bgm: [
                'bgm_loop/bgm_loop1.mp3',
                'bgm_loop/bgm_loop2.mp3',
                'bgm_loop/bgm_loop3.mp3'
            ],
            combo: [
                'combo_hit/combo_hit1.mp3',
                'combo_hit/combo_hit2.mp3',
                'combo_hit/combo_hit3.wav'
            ],
            game_over: [
                'game_over/game_over1.wav',
                'game_over/game_over2.wav',
                'game_over/game_over3.wav'
            ],
            miss: [
                'Miss/miss1.wav',
                'Miss/miss2.wav',
                'Miss/miss3.wav'
            ],
            slice: [
                'Slice/slice1.wav',
                'Slice/slice2.wav',
                'Slice/slice3.mp3'
            ]
        };

        this.pools = {};
        this.bgmAudio = null;
        this.initPools();
    }

    initPools() {
        // Create audio pools to allow overlapping sounds without lag
        for (let category in this.sounds) {
            this.pools[category] = this.sounds[category].map(src => {
                let a = new Audio(this.basePath + src);
                a.preload = 'auto'; // Preload for instant play
                if (category === 'bgm') {
                    a.loop = true;
                    a.volume = 0.3; // BGM should be quieter
                }
                return a;
            });
        }
    }

    playRandom(category, volume = 1.0) {
        if (!window.GameSettings || !window.GameSettings.sfx) return; // Hooked up to settings
        if (!this.pools[category]) return;
        const pool = this.pools[category];
        const randomIndex = Math.floor(Math.random() * pool.length);
        const originalAudio = pool[randomIndex];

        // Clone the audio node so overlapping cuts don't cut off each other
        const soundClone = originalAudio.cloneNode();
        soundClone.volume = volume;
        soundClone.play().catch(e => console.warn("Audio play blocked by browser:", e));
    }

    startBgm() {
        this.stopBgm();
        if (!window.GameSettings || !window.GameSettings.bgm) return; // Hooked up to settings
        const pool = this.pools['bgm'];
        const randomIndex = Math.floor(Math.random() * pool.length);
        this.bgmAudio = pool[randomIndex];
        // Don't clone BGM so we can stop it later
        this.bgmAudio.currentTime = 0;
        this.bgmAudio.play().catch(e => console.warn("BGM blocked:", e));
    }

    stopBgm() {
        if (this.bgmAudio) {
            this.bgmAudio.pause();
            this.bgmAudio.currentTime = 0;
            this.bgmAudio = null;
        }
    }
}

// Global instance
window.GameAudio = new AudioManager();
