/**
 * BirdNET Integration Module
 * Simulates BirdNET species detection for audio analysis.
 * In production, this would connect to a BirdNET-Analyzer API server.
 * 
 * API endpoint expected: POST /analyze with audio file
 * Returns: array of { species, confidence, startTime, endTime }
 */
class BirdNETAnalyzer {
    constructor() {
        this.apiEndpoint = null; // Set to your BirdNET server URL
        this.isAnalyzing = false;
        this.lastResults = [];
    }

    /**
     * Analyze an AudioBuffer for bird species.
     * If no API server is configured, performs local frequency analysis
     * to demonstrate the UI workflow.
     */
    async analyze(audioBuffer, onProgress) {
        this.isAnalyzing = true;
        this.lastResults = [];

        try {
            if (this.apiEndpoint) {
                return await this._analyzeRemote(audioBuffer, onProgress);
            } else {
                return await this._analyzeLocal(audioBuffer, onProgress);
            }
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Remote analysis via BirdNET-Analyzer API server.
     */
    async _analyzeRemote(audioBuffer, onProgress) {
        if (onProgress) onProgress(0.1);

        // Convert AudioBuffer to WAV blob
        const wavBlob = this._audioBufferToWav(audioBuffer);

        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');

        if (onProgress) onProgress(0.3);

        const response = await fetch(this.apiEndpoint, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`BirdNET server error: ${response.status}`);
        }

        if (onProgress) onProgress(0.8);

        const data = await response.json();
        this.lastResults = data.results || data;

        if (onProgress) onProgress(1);
        return this.lastResults;
    }

    /**
     * Local frequency-based analysis (demo mode).
     * Analyzes audio energy in bird-vocalization frequency bands.
     */
    async _analyzeLocal(audioBuffer, onProgress) {
        const sampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0);
        const duration = audioBuffer.duration;
        const results = [];

        // Analyze in 3-second segments (like BirdNET)
        const segmentDuration = 3.0;
        const segmentSamples = Math.floor(segmentDuration * sampleRate);
        const numSegments = Math.floor(channelData.length / segmentSamples);
        const fftSize = 2048;

        for (let seg = 0; seg < numSegments; seg++) {
            if (onProgress) onProgress(seg / numSegments);
            await new Promise(r => setTimeout(r, 0)); // yield

            const offset = seg * segmentSamples;
            const segment = channelData.slice(offset, offset + segmentSamples);

            // Compute energy in key frequency bands
            const bands = this._analyzeFrequencyBands(segment, sampleRate, fftSize);

            // Determine likely species based on frequency characteristics
            const detections = this._classifyBands(bands, seg * segmentDuration, (seg + 1) * segmentDuration);

            for (const det of detections) {
                if (det.confidence >= 0.1) {
                    results.push(det);
                }
            }
        }

        // Sort by confidence descending
        results.sort((a, b) => b.confidence - a.confidence);

        // Deduplicate keeping highest confidence per species
        const seen = new Map();
        const unique = [];
        for (const r of results) {
            if (!seen.has(r.species) || seen.get(r.species).confidence < r.confidence) {
                seen.set(r.species, r);
            }
        }
        this.lastResults = Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);

        if (onProgress) onProgress(1);
        return this.lastResults;
    }

    _analyzeFrequencyBands(segment, sampleRate, fftSize) {
        // Simple energy calculation per frequency band
        const N = Math.min(segment.length, fftSize);
        const real = new Float32Array(fftSize);
        const imag = new Float32Array(fftSize);

        // Apply Hann window and copy
        for (let i = 0; i < N; i++) {
            const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
            real[i] = segment[i] * window;
        }

        // Simple DFT for key frequency bins (not full FFT for speed)
        const bands = {
            lowBird: 0,    // 1-3 kHz (pigeons, doves, owls)
            midBird: 0,    // 3-6 kHz (warblers, sparrows, robins)
            highBird: 0,   // 6-10 kHz (thrushes, goldfinches)
            insect: 0,     // 4-8 kHz (crickets, cicadas)
            ambient: 0,    // 0-1 kHz (wind, traffic)
            total: 0
        };

        const binHz = sampleRate / fftSize;

        for (let k = 0; k < fftSize / 2; k++) {
            let sumReal = 0, sumImag = 0;
            // Compute DFT only for sampled points for speed
            const step = Math.max(1, Math.floor(N / 512));
            for (let n = 0; n < N; n += step) {
                const angle = -2 * Math.PI * k * n / fftSize;
                sumReal += real[n] * Math.cos(angle);
                sumImag += real[n] * Math.sin(angle);
            }
            const magnitude = Math.sqrt(sumReal * sumReal + sumImag * sumImag) / (N / step);
            const freq = k * binHz;

            bands.total += magnitude;

            if (freq >= 100 && freq < 1000) bands.ambient += magnitude;
            else if (freq >= 1000 && freq < 3000) bands.lowBird += magnitude;
            else if (freq >= 3000 && freq < 6000) bands.midBird += magnitude;
            else if (freq >= 6000 && freq < 10000) bands.highBird += magnitude;

            if (freq >= 4000 && freq < 8000) bands.insect += magnitude;
        }

        return bands;
    }

    _classifyBands(bands, startTime, endTime) {
        const detections = [];
        const { lowBird, midBird, highBird, insect, ambient, total } = bands;

        if (total < 0.001) return detections;

        // Normalize
        const lowR = lowBird / total;
        const midR = midBird / total;
        const highR = highBird / total;
        const insR = insect / total;
        const ambR = ambient / total;

        // Classification heuristics based on dominant frequency bands
        if (midR > 0.25 && midR > lowR) {
            detections.push({
                species: 'Sylvia atricapilla (Blackcap)',
                scientificName: 'Sylvia atricapilla',
                confidence: Math.min(0.95, midR * 2.5),
                startTime, endTime,
                frequencyRange: '3-6 kHz'
            });
        }

        if (lowR > 0.2) {
            detections.push({
                species: 'Columba palumbus (Wood Pigeon)',
                scientificName: 'Columba palumbus',
                confidence: Math.min(0.85, lowR * 2),
                startTime, endTime,
                frequencyRange: '1-3 kHz'
            });
        }

        if (highR > 0.15) {
            detections.push({
                species: 'Turdus merula (Blackbird)',
                scientificName: 'Turdus merula',
                confidence: Math.min(0.90, highR * 3),
                startTime, endTime,
                frequencyRange: '6-10 kHz'
            });
        }

        if (midR > 0.15 && highR > 0.1) {
            detections.push({
                species: 'Erithacus rubecula (European Robin)',
                scientificName: 'Erithacus rubecula',
                confidence: Math.min(0.80, (midR + highR) * 1.5),
                startTime, endTime,
                frequencyRange: '3-10 kHz'
            });
        }

        if (insR > 0.3 && highR > 0.15) {
            detections.push({
                species: 'Gryllus campestris (Field Cricket)',
                scientificName: 'Gryllus campestris',
                confidence: Math.min(0.75, insR * 1.8),
                startTime, endTime,
                frequencyRange: '4-8 kHz'
            });
        }

        if (ambR > 0.5 && lowR < 0.1 && midR < 0.1) {
            detections.push({
                species: 'Ambient/Wind noise',
                scientificName: '',
                confidence: Math.min(0.60, ambR),
                startTime, endTime,
                frequencyRange: '0-1 kHz'
            });
        }

        return detections;
    }

    /**
     * Convert AudioBuffer to WAV Blob for API upload.
     */
    _audioBufferToWav(audioBuffer) {
        const numChannels = 1;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        const data = audioBuffer.getChannelData(0);
        const buffer = new ArrayBuffer(44 + data.length * 2);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + data.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * bitDepth / 8, true);
        view.setUint16(32, numChannels * bitDepth / 8, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, data.length * 2, true);

        // Write samples
        let offset = 44;
        for (let i = 0; i < data.length; i++) {
            const sample = Math.max(-1, Math.min(1, data[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }
}
