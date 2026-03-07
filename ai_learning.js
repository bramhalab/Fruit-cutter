// ai_learning.js
// This creates a learning history to calibrate index finger tracking and hit accuracy
// Yeh script as a history file kaam karegi jo background mein hand tracking ko adapt/perfect banayegi.

const AILearning = {
    history: [],
    model: {
        hit_buffer_adaptation: 11.5,
        x_offset: -10.7263,
        y_offset: 5.4648,
        total_swipes: 208,
        successful_swipes: 10,
        last_updated: new Date().toISOString()
    },

    init: function () {
        const savedData = localStorage.getItem('web_cam_finger_profile');
        if (savedData) {
            try {
                const parsed = JSON.parse(savedData);
                this.history = parsed.history || [];
                // Naya model merge karo
                this.model = { ...this.model, ...parsed.model };
                console.log("🧠 AI Learning Finger Profile Loaded", this.model);
            } catch (e) {
                console.error("Error loading AI history", e);
            }
        }
    },

    save: function () {
        this.model.last_updated = new Date().toISOString();
        const data = {
            history: this.history,
            model: this.model
        };
        localStorage.setItem('web_cam_finger_profile', JSON.stringify(data));
    },

    recordSwipe: function (isCut, targetX, targetY, handX, handY) {
        this.model.total_swipes++;
        if (isCut) {
            this.model.successful_swipes++;
        }

        // Calculate distance if we missed closely (Learn to correct hit buffers & Camera Shifts)
        if (!isCut && targetX !== null && targetY !== null) {
            const dx = targetX - handX;
            const dy = targetY - handY;
            const dist = Math.hypot(dx, dy);

            // If missed by a margin, user is probably aiming correctly but camera angle is creating an offset
            if (dist > 25 && dist < 150) {
                // Increase hit allowance
                if (this.model.hit_buffer_adaptation < 40) {
                    this.model.hit_buffer_adaptation += 1.0;
                }

                // Active Finger Offset Adjustment:
                // Move the virtual point slightly towards the actual fruit center (Self-Correcting Camera Alignment)
                this.model.x_offset += (dx * 0.05); // Move 5% towards the target naturally per miss
                this.model.y_offset += (dy * 0.05);

                // Cap the maximum offset so the cursor doesn't completely fly away
                if (this.model.x_offset < -50) this.model.x_offset = -50;
                if (this.model.x_offset > 50) this.model.x_offset = 50;
                if (this.model.y_offset < -50) this.model.y_offset = -50;
                if (this.model.y_offset > 50) this.model.y_offset = 50;
            }
        }

        // If player starts cutting fruits well (Success), slowly retract the hit buffer handicap
        // so the game doesn't stay too "easy" forever
        if (isCut && this.model.hit_buffer_adaptation > 11.5) {
            this.model.hit_buffer_adaptation -= 0.5;
        }

        // Limit history array to 200 elements
        this.history.push({
            time: Date.now(),
            success: isCut,
            error_x: targetX ? Math.round(targetX - handX) : 0,
            error_y: targetY ? Math.round(targetY - handY) : 0
        });

        if (this.history.length > 200) {
            this.history.shift();
        }

        // Auto-save every 30 swipes (instead of 5) to save CPU/Memory thrashing (Prevents Lag spikes)
        if (this.model.total_swipes % 20 === 0) { // Slightly faster saving so User feels adaptation
            this.save();
        }


    },

    getHitBufferOffset: function () {
        return this.model.hit_buffer_adaptation;
    },

    getPointerCorrection: function () {
        // Tracker offsets are actively applied based on learning from the missed distances (AI Offset mapping)
        return {
            x: this.model.x_offset,
            y: this.model.y_offset
        };
    },

    // Expose model to telemetry JSON download
    getLearningData: function () {
        return {
            model: this.model,
            recent_history: this.history.slice(-20) // send last 20 for analysis
        };
    }
};

AILearning.init();
