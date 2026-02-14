/**
 * SpectrogramRenderer - Generates and renders professional spectrograms.
 * Uses offline FFT computation for high-quality output.
 */
class SpectrogramRenderer {
    constructor(options = {}) {
        this.fftSize = options.fftSize || 2048;
        this.windowFn = options.windowFn || 'hann';
        this.overlap = options.overlap ?? 0.75;
        this.colorMap = options.colorMap || 'viridis';
        this.freqScale = options.freqScale || 'linear';
        this.minDb = options.minDb ?? -100;
        this.maxDb = 0;
        this.maxFreq = options.maxFreq || 12000;
        this.pixelsPerSec = options.pixelsPerSec || 100;
        this.spectrogramHeight = options.height || 512;

        this.spectrogramData = null;
        this.sampleRate = null;
        this.audioBuffer = null;
    }

    /**
     * Generate spectrogram data from an AudioBuffer.
     */
    async generate(audioBuffer, onProgress) {
        this.audioBuffer = audioBuffer;
        this.sampleRate = audioBuffer.sampleRate;

        // Mix to mono
        const channelData = this._mixToMono(audioBuffer);

        const hopSize = Math.round(this.fftSize * (1 - this.overlap));
        const numFrames = Math.floor((channelData.length - this.fftSize) / hopSize) + 1;

        if (numFrames <= 0) {
            throw new Error('Audio is too short for the selected FFT size.');
        }

        const freqBins = this.fftSize / 2;
        const window = this._createWindow(this.fftSize, this.windowFn);

        // Allocate spectrogram matrix: numFrames x freqBins
        const spectrogram = new Float32Array(numFrames * freqBins);

        // Process in chunks with progress
        const chunkSize = 200;
        for (let frame = 0; frame < numFrames; frame++) {
            const offset = frame * hopSize;
            const segment = new Float32Array(this.fftSize);
            for (let i = 0; i < this.fftSize; i++) {
                segment[i] = channelData[offset + i] * window[i];
            }

            // Compute FFT magnitude
            const magnitudes = this._fft(segment);

            for (let bin = 0; bin < freqBins; bin++) {
                spectrogram[frame * freqBins + bin] = magnitudes[bin];
            }

            if (onProgress && frame % chunkSize === 0) {
                onProgress(frame / numFrames);
                // Yield to keep UI responsive
                await new Promise(r => setTimeout(r, 0));
            }
        }

        this.spectrogramData = {
            data: spectrogram,
            numFrames,
            freqBins,
            hopSize,
            sampleRate: this.sampleRate,
            duration: audioBuffer.duration
        };

        if (onProgress) onProgress(1);
        return this.spectrogramData;
    }

    /**
     * Render the spectrogram to a canvas.
     */
    renderToCanvas(canvas, overlayCanvas, freqAxisCanvas, timeAxisCanvas) {
        if (!this.spectrogramData) return;

        const { data, numFrames, freqBins, sampleRate, duration } = this.spectrogramData;

        // Calculate canvas size
        const width = Math.max(Math.round(duration * this.pixelsPerSec), numFrames);
        const height = this.spectrogramHeight;

        canvas.width = width;
        canvas.height = height;
        overlayCanvas.width = width;
        overlayCanvas.height = height;

        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        const pixels = imageData.data;
        const lut = ColorMaps.createLUT(this.colorMap);

        // Determine frequency range
        const nyquist = sampleRate / 2;
        const maxFreqBin = Math.min(freqBins, Math.round((this.maxFreq / nyquist) * freqBins));

        // Build frequency mapping based on scale
        const freqMap = this._buildFreqMap(height, maxFreqBin, freqBins, nyquist);

        // Render each pixel
        for (let x = 0; x < width; x++) {
            // Map x to frame
            const frameFloat = (x / width) * numFrames;
            const frame0 = Math.floor(frameFloat);
            const frame1 = Math.min(frame0 + 1, numFrames - 1);
            const frameFrac = frameFloat - frame0;

            for (let y = 0; y < height; y++) {
                const binInfo = freqMap[y];
                const bin0 = binInfo.bin0;
                const bin1 = binInfo.bin1;
                const binFrac = binInfo.frac;

                // Bilinear interpolation
                const v00 = data[frame0 * freqBins + bin0];
                const v01 = data[frame0 * freqBins + bin1];
                const v10 = data[frame1 * freqBins + bin0];
                const v11 = data[frame1 * freqBins + bin1];

                const vTop = v00 + (v01 - v00) * binFrac;
                const vBot = v10 + (v11 - v10) * binFrac;
                const magnitude = vTop + (vBot - vTop) * frameFrac;

                // Convert to dB
                const db = 20 * Math.log10(Math.max(magnitude, 1e-10));
                const normalized = Math.max(0, Math.min(1, (db - this.minDb) / (this.maxDb - this.minDb)));

                // Map to color
                const colorIdx = Math.round(normalized * 255) * 4;
                const pixelIdx = (y * width + x) * 4;
                pixels[pixelIdx] = lut[colorIdx];
                pixels[pixelIdx + 1] = lut[colorIdx + 1];
                pixels[pixelIdx + 2] = lut[colorIdx + 2];
                pixels[pixelIdx + 3] = 255;
            }
        }

        ctx.putImageData(imageData, 0, 0);

        // Render axes
        this._renderFreqAxis(freqAxisCanvas, height, maxFreqBin, freqBins, nyquist);
        this._renderTimeAxis(timeAxisCanvas, width, duration);
        this._renderColorLegend();
    }

    /**
     * Build frequency bin mapping for y-axis based on scale type.
     */
    _buildFreqMap(height, maxFreqBin, freqBins, nyquist) {
        const map = new Array(height);

        for (let y = 0; y < height; y++) {
            // y=0 is top (high freq), y=height-1 is bottom (low freq)
            const normalizedY = 1 - (y / (height - 1));
            let binFloat;

            if (this.freqScale === 'mel') {
                const maxMel = 2595 * Math.log10(1 + this.maxFreq / 700);
                const mel = normalizedY * maxMel;
                const freq = 700 * (Math.pow(10, mel / 2595) - 1);
                binFloat = (freq / nyquist) * freqBins;
            } else if (this.freqScale === 'log') {
                const minFreqLog = Math.log10(Math.max(20, 1));
                const maxFreqLog = Math.log10(this.maxFreq);
                const logFreq = minFreqLog + normalizedY * (maxFreqLog - minFreqLog);
                const freq = Math.pow(10, logFreq);
                binFloat = (freq / nyquist) * freqBins;
            } else {
                // Linear
                binFloat = normalizedY * maxFreqBin;
            }

            binFloat = Math.max(0, Math.min(freqBins - 1.001, binFloat));
            const bin0 = Math.floor(binFloat);
            const bin1 = Math.min(bin0 + 1, freqBins - 1);
            const frac = binFloat - bin0;

            map[y] = { bin0, bin1, frac };
        }

        return map;
    }

    /**
     * Render frequency axis labels.
     */
    _renderFreqAxis(canvas, height, maxFreqBin, freqBins, nyquist) {
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0f1117';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#9aa0b0';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        // Generate nice tick values
        const ticks = this._generateFreqTicks();

        for (const freq of ticks) {
            if (freq > this.maxFreq || freq < 0) continue;

            let normalizedY;
            if (this.freqScale === 'mel') {
                const maxMel = 2595 * Math.log10(1 + this.maxFreq / 700);
                const mel = 2595 * Math.log10(1 + freq / 700);
                normalizedY = mel / maxMel;
            } else if (this.freqScale === 'log') {
                const minLog = Math.log10(Math.max(20, 1));
                const maxLog = Math.log10(this.maxFreq);
                normalizedY = (Math.log10(Math.max(freq, 20)) - minLog) / (maxLog - minLog);
            } else {
                normalizedY = freq / this.maxFreq;
            }

            const y = height - normalizedY * height;

            if (y < 8 || y > height - 8) continue;

            // Draw tick
            ctx.strokeStyle = '#3a4060';
            ctx.beginPath();
            ctx.moveTo(canvas.width - 5, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();

            // Draw label
            const label = freq >= 1000 ? `${(freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 1)}k` : `${freq}`;
            ctx.fillText(label, canvas.width - 8, y);
        }

        // "Hz" label at top
        ctx.fillStyle = '#6b7280';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Hz', canvas.width / 2, 10);
    }

    /**
     * Generate frequency tick values.
     */
    _generateFreqTicks() {
        const ticks = [];
        if (this.maxFreq <= 4000) {
            for (let f = 500; f <= this.maxFreq; f += 500) ticks.push(f);
        } else if (this.maxFreq <= 12000) {
            for (let f = 1000; f <= this.maxFreq; f += 1000) ticks.push(f);
        } else {
            for (let f = 2000; f <= this.maxFreq; f += 2000) ticks.push(f);
        }
        return ticks;
    }

    /**
     * Render time axis labels.
     */
    _renderTimeAxis(canvas, width, duration) {
        canvas.width = width;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0f1117';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#9aa0b0';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Decide tick interval based on duration & pixels
        const pixelsPerTick = 80;
        const numTicks = Math.floor(width / pixelsPerTick);
        let interval = duration / numTicks;

        // Round to nice interval
        const niceIntervals = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
        for (const ni of niceIntervals) {
            if (ni >= interval) {
                interval = ni;
                break;
            }
        }

        for (let t = 0; t <= duration; t += interval) {
            const x = (t / duration) * width;
            if (x < 20 || x > width - 20) continue;

            ctx.strokeStyle = '#3a4060';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 5);
            ctx.stroke();

            const label = this._formatTime(t);
            ctx.fillText(label, x, 8);
        }

        // "s" label
        ctx.fillStyle = '#6b7280';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.fillText('s', width - 10, 8);
    }

    /**
     * Render the color legend bar.
     */
    _renderColorLegend() {
        const canvas = document.getElementById('color-legend-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const lut = ColorMaps.createLUT(this.colorMap);
        const w = canvas.width;
        const h = canvas.height;

        const imageData = ctx.createImageData(w, h);
        for (let x = 0; x < w; x++) {
            const normalized = x / (w - 1);
            const colorIdx = Math.round(normalized * 255) * 4;
            for (let y = 0; y < h; y++) {
                const pixelIdx = (y * w + x) * 4;
                imageData.data[pixelIdx] = lut[colorIdx];
                imageData.data[pixelIdx + 1] = lut[colorIdx + 1];
                imageData.data[pixelIdx + 2] = lut[colorIdx + 2];
                imageData.data[pixelIdx + 3] = 255;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * Draw playback cursor on overlay.
     */
    drawPlaybackCursor(overlayCanvas, currentTime) {
        if (!this.spectrogramData) return;
        const ctx = overlayCanvas.getContext('2d');
        const { duration } = this.spectrogramData;
        const x = (currentTime / duration) * overlayCanvas.width;

        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, overlayCanvas.height);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    /**
     * Clear playback cursor.
     */
    clearOverlay(overlayCanvas) {
        const ctx = overlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    /**
     * Get frequency/time/amplitude info at canvas coordinates.
     */
    getInfoAt(x, y, canvasWidth, canvasHeight) {
        if (!this.spectrogramData) return null;
        const { data, numFrames, freqBins, sampleRate, duration } = this.spectrogramData;
        const nyquist = sampleRate / 2;

        const time = (x / canvasWidth) * duration;
        const normalizedY = 1 - (y / (canvasHeight - 1));

        let freq;
        if (this.freqScale === 'mel') {
            const maxMel = 2595 * Math.log10(1 + this.maxFreq / 700);
            const mel = normalizedY * maxMel;
            freq = 700 * (Math.pow(10, mel / 2595) - 1);
        } else if (this.freqScale === 'log') {
            const minLog = Math.log10(Math.max(20, 1));
            const maxLog = Math.log10(this.maxFreq);
            const logFreq = minLog + normalizedY * (maxLog - minLog);
            freq = Math.pow(10, logFreq);
        } else {
            freq = normalizedY * this.maxFreq;
        }

        // Get amplitude
        const frame = Math.min(Math.floor((x / canvasWidth) * numFrames), numFrames - 1);
        const bin = Math.min(Math.floor((freq / nyquist) * freqBins), freqBins - 1);
        const magnitude = data[frame * freqBins + bin];
        const db = 20 * Math.log10(Math.max(magnitude, 1e-10));

        return { time, freq, db };
    }

    /**
     * Export spectrogram canvas with axes as a single image.
     */
    exportAsImage(mainCanvas, freqAxisCanvas, timeAxisCanvas) {
        const exportCanvas = document.createElement('canvas');
        const axisWidth = freqAxisCanvas.width;
        const timeHeight = timeAxisCanvas.height;
        const padding = 10;

        exportCanvas.width = axisWidth + mainCanvas.width + padding;
        exportCanvas.height = mainCanvas.height + timeHeight + padding + 30; // extra for title

        const ctx = exportCanvas.getContext('2d');
        ctx.fillStyle = '#0f1117';
        ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

        // Title
        ctx.fillStyle = '#e8eaed';
        ctx.font = 'bold 14px -apple-system, sans-serif';
        ctx.fillText('Audio Spectrogram', padding, 20);

        const yOffset = 30;
        ctx.drawImage(freqAxisCanvas, 0, yOffset);
        ctx.drawImage(mainCanvas, axisWidth, yOffset);
        ctx.drawImage(timeAxisCanvas, axisWidth, yOffset + mainCanvas.height);

        return exportCanvas.toDataURL('image/png');
    }

    // ── Internal helpers ──

    _mixToMono(audioBuffer) {
        if (audioBuffer.numberOfChannels === 1) {
            return audioBuffer.getChannelData(0);
        }
        const length = audioBuffer.length;
        const mixed = new Float32Array(length);
        const numChannels = audioBuffer.numberOfChannels;
        for (let ch = 0; ch < numChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                mixed[i] += channelData[i];
            }
        }
        const scale = 1 / numChannels;
        for (let i = 0; i < length; i++) {
            mixed[i] *= scale;
        }
        return mixed;
    }

    _createWindow(size, type) {
        const w = new Float32Array(size);
        switch (type) {
            case 'hann':
                for (let i = 0; i < size; i++)
                    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
                break;
            case 'hamming':
                for (let i = 0; i < size; i++)
                    w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (size - 1));
                break;
            case 'blackman':
                for (let i = 0; i < size; i++)
                    w[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (size - 1));
                break;
            case 'bartlett':
                for (let i = 0; i < size; i++)
                    w[i] = 1 - Math.abs((2 * i - (size - 1)) / (size - 1));
                break;
            case 'rectangular':
            default:
                w.fill(1);
                break;
        }
        return w;
    }

    /**
     * Simple radix-2 FFT returning magnitudes for the first half of bins.
     */
    _fft(signal) {
        const N = signal.length;
        const real = new Float32Array(N);
        const imag = new Float32Array(N);

        // Bit-reversal permutation
        for (let i = 0; i < N; i++) {
            real[this._bitReverse(i, N)] = signal[i];
        }

        // Cooley-Tukey iterative FFT
        for (let size = 2; size <= N; size *= 2) {
            const halfSize = size / 2;
            const angleStep = -2 * Math.PI / size;
            for (let i = 0; i < N; i += size) {
                for (let j = 0; j < halfSize; j++) {
                    const angle = angleStep * j;
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);

                    const tReal = real[i + j + halfSize] * cos - imag[i + j + halfSize] * sin;
                    const tImag = real[i + j + halfSize] * sin + imag[i + j + halfSize] * cos;

                    real[i + j + halfSize] = real[i + j] - tReal;
                    imag[i + j + halfSize] = imag[i + j] - tImag;
                    real[i + j] += tReal;
                    imag[i + j] += tImag;
                }
            }
        }

        // Compute magnitudes for first half
        const half = N / 2;
        const magnitudes = new Float32Array(half);
        const scale = 2 / N;
        for (let i = 0; i < half; i++) {
            magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) * scale;
        }

        return magnitudes;
    }

    _bitReverse(x, N) {
        const bits = Math.log2(N);
        let result = 0;
        for (let i = 0; i < bits; i++) {
            result = (result << 1) | (x & 1);
            x >>= 1;
        }
        return result;
    }

    _formatTime(seconds) {
        if (seconds < 60) {
            return seconds.toFixed(1);
        }
        const m = Math.floor(seconds / 60);
        const s = (seconds % 60).toFixed(0).padStart(2, '0');
        return `${m}:${s}`;
    }
}
