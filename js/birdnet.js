/**
 * BirdNET-Lite Integration Module
 * Connects to local BirdNET-Lite API server (localhost:8080)
 * for real species detection using the BirdNET AI model.
 *
 * API endpoint: POST http://localhost:8080/analyze
 * Accepts: multipart/form-data with 'audio' file field
 * Returns: JSON array of detections
 */
class BirdNETAnalyzer {
    constructor() {
        this.apiEndpoint = 'http://localhost:8080/analyze';
        this.isAnalyzing = false;
        this.lastResults = [];
    }

    /**
     * Analyze an AudioBuffer for bird species via local BirdNET-Lite API.
     */
    async analyze(audioBuffer, onProgress) {
        this.isAnalyzing = true;
        this.lastResults = [];

        try {
            if (onProgress) onProgress(0.1);

            // Convert AudioBuffer to WAV blob
            const wavBlob = this._audioBufferToWav(audioBuffer);

            if (onProgress) onProgress(0.3);

            const formData = new FormData();
            formData.append('audio', wavBlob, 'audio.wav');

            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                const errMsg = errData && errData.error ? errData.error : `Server error: ${response.status}`;
                throw new Error(errMsg);
            }

            if (onProgress) onProgress(0.8);

            const data = await response.json();
            this.lastResults = Array.isArray(data) ? data : (data.results || []);

            if (onProgress) onProgress(1);
            return this.lastResults;
        } catch (err) {
            if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
                throw new Error('BirdNET-Lite API non raggiungibile. Assicurati che server.py sia in esecuzione su localhost:8080.');
            }
            throw err;
        } finally {
            this.isAnalyzing = false;
        }
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
