/**
 * AudioPlayer - Audio playback with spectrogram cursor synchronization.
 */
class AudioPlayer {
    constructor() {
        this.audioContext = null;
        this.sourceNode = null;
        this.gainNode = null;
        this.audioBuffer = null;
        this.isPlaying = false;
        this.startOffset = 0;
        this.startTime = 0;
        this.duration = 0;
        this.volume = 0.8;
        this.onTimeUpdate = null;
        this.onEnded = null;
        this.animationFrame = null;
    }

    /**
     * Load an AudioBuffer for playback.
     */
    load(audioBuffer) {
        this.stop();
        this.audioBuffer = audioBuffer;
        this.duration = audioBuffer.duration;
        this.startOffset = 0;
    }

    /**
     * Start or resume playback.
     */
    play() {
        if (!this.audioBuffer) return;
        if (this.isPlaying) return;

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = this.volume;
        this.gainNode.connect(this.audioContext.destination);

        this.sourceNode = this.audioContext.createBufferSource();
        this.sourceNode.buffer = this.audioBuffer;
        this.sourceNode.connect(this.gainNode);

        this.sourceNode.onended = () => {
            if (this.isPlaying) {
                this.isPlaying = false;
                this.startOffset = 0;
                if (this.animationFrame) {
                    cancelAnimationFrame(this.animationFrame);
                    this.animationFrame = null;
                }
                if (this.onEnded) this.onEnded();
            }
        };

        this.startTime = this.audioContext.currentTime;
        this.sourceNode.start(0, this.startOffset);
        this.isPlaying = true;

        this._updateTime();
    }

    /**
     * Pause playback.
     */
    pause() {
        if (!this.isPlaying) return;
        this.isPlaying = false;

        this.startOffset += this.audioContext.currentTime - this.startTime;
        if (this.startOffset >= this.duration) {
            this.startOffset = 0;
        }

        if (this.sourceNode) {
            this.sourceNode.onended = null;
            this.sourceNode.stop();
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }

        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    /**
     * Stop playback and reset position.
     */
    stop() {
        this.pause();
        this.startOffset = 0;
    }

    /**
     * Seek to a specific time position.
     */
    seek(time) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
            this.pause();
        }
        this.startOffset = Math.max(0, Math.min(time, this.duration));
        if (wasPlaying) {
            this.play();
        }
    }

    /**
     * Set volume (0-1).
     */
    setVolume(value) {
        this.volume = Math.max(0, Math.min(1, value));
        if (this.gainNode) {
            this.gainNode.gain.value = this.volume;
        }
    }

    /**
     * Get current playback time.
     */
    getCurrentTime() {
        if (!this.isPlaying || !this.audioContext) {
            return this.startOffset;
        }
        const elapsed = this.audioContext.currentTime - this.startTime;
        return Math.min(this.startOffset + elapsed, this.duration);
    }

    /**
     * Destroy and clean up.
     */
    destroy() {
        this.stop();
        this.audioBuffer = null;
    }

    // ── Internal ──

    _updateTime() {
        if (!this.isPlaying) return;
        this.animationFrame = requestAnimationFrame(() => this._updateTime());

        const currentTime = this.getCurrentTime();
        if (this.onTimeUpdate) {
            this.onTimeUpdate(currentTime, this.duration);
        }
    }
}
