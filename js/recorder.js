/**
 * AudioRecorder - Handles microphone recording with real-time waveform visualization.
 * Works on both desktop and mobile browsers.
 */
class AudioRecorder {
    constructor() {
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.analyser = null;
        this.chunks = [];
        this.isRecording = false;
        this.startTime = 0;
        this.timerInterval = null;
        this.animationFrame = null;
        this.onComplete = null;
        this.onError = null;
    }

    /**
     * Request microphone permission and start recording.
     */
    async start() {
        try {
            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 44100
                }
            });

            // Set up MediaRecorder
            const mimeType = this._getSupportedMimeType();
            this.mediaRecorder = new MediaRecorder(this.mediaStream, {
                mimeType,
                audioBitsPerSecond: 128000
            });

            this.chunks = [];
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.chunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this._processRecording();
            };

            this.mediaRecorder.onerror = (e) => {
                if (this.onError) this.onError(e.error || new Error('Recording error'));
            };

            // Set up audio analysis for waveform visualization
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.8;
            source.connect(this.analyser);

            // Start recording
            this.mediaRecorder.start(100); // Collect data every 100ms
            this.isRecording = true;
            this.startTime = Date.now();

            // Start waveform drawing
            this._drawWaveform();

            return true;
        } catch (err) {
            if (this.onError) {
                if (err.name === 'NotAllowedError') {
                    this.onError(new Error('Microphone access denied. Please allow microphone access and try again.'));
                } else if (err.name === 'NotFoundError') {
                    this.onError(new Error('No microphone found. Please connect a microphone and try again.'));
                } else {
                    this.onError(err);
                }
            }
            return false;
        }
    }

    /**
     * Stop recording and process the audio.
     */
    stop() {
        if (!this.isRecording) return;
        this.isRecording = false;

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        // Stop all tracks
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }

        // Stop animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Stop timer
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    /**
     * Get elapsed recording time in seconds.
     */
    getElapsedTime() {
        if (!this.isRecording) return 0;
        return (Date.now() - this.startTime) / 1000;
    }

    /**
     * Destroy and clean up resources.
     */
    destroy() {
        this.stop();
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    // ── Internal ──

    _getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
            'audio/wav'
        ];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return '';
    }

    async _processRecording() {
        if (this.chunks.length === 0) {
            if (this.onError) this.onError(new Error('No audio data recorded.'));
            return;
        }

        const blob = new Blob(this.chunks, { type: this.chunks[0].type || 'audio/webm' });

        try {
            // Decode to AudioBuffer
            const arrayBuffer = await blob.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            audioCtx.close();

            if (this.onComplete) {
                this.onComplete(audioBuffer, blob);
            }
        } catch (err) {
            if (this.onError) this.onError(new Error('Failed to decode recorded audio: ' + err.message));
        }
    }

    _drawWaveform() {
        const canvas = document.getElementById('record-waveform');
        if (!canvas || !this.analyser) return;

        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!this.isRecording) return;
            this.animationFrame = requestAnimationFrame(draw);

            this.analyser.getByteTimeDomainData(dataArray);

            const w = canvas.width;
            const h = canvas.height;
            ctx.fillStyle = '#0f1117';
            ctx.fillRect(0, 0, w, h);

            ctx.lineWidth = 2;
            ctx.strokeStyle = '#4f8df9';
            ctx.beginPath();

            const sliceWidth = w / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * h) / 2;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }

                x += sliceWidth;
            }

            ctx.lineTo(w, h / 2);
            ctx.stroke();

            // RMS level bar
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = (dataArray[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / bufferLength);
            const level = Math.min(1, rms * 4);

            ctx.fillStyle = `rgba(79, 141, 249, ${0.15 + level * 0.2})`;
            const barWidth = level * w;
            ctx.fillRect((w - barWidth) / 2, h - 4, barWidth, 4);
        };

        draw();
    }
}
