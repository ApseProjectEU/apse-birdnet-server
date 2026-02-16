/**
 * Main application - Connects recorder, spectrogram renderer, and player.
 */
(function () {
    'use strict';

    // ── DOM elements ──
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    const btnRecord = document.getElementById('btn-record');
    const btnStopRecord = document.getElementById('btn-stop-record');
    const recordTimer = document.getElementById('record-timer');
    const recordStatus = document.getElementById('record-status');

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileInfo = document.getElementById('file-info');

    const spectrogramSection = document.getElementById('spectrogram-section');
    const spectrogramCanvas = document.getElementById('spectrogram-canvas');
    const spectrogramOverlay = document.getElementById('spectrogram-overlay');
    const freqAxisCanvas = document.getElementById('spectrogram-freq-axis');
    const timeAxisCanvas = document.getElementById('spectrogram-time-axis');
    const spectrogramScroll = document.getElementById('spectrogram-scroll');
    const timeAxisScroll = document.getElementById('time-axis-scroll');

    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomReset = document.getElementById('btn-zoom-reset');
    const btnExportPng = document.getElementById('btn-export-png');

    const cursorTime = document.getElementById('cursor-time');
    const cursorFreq = document.getElementById('cursor-freq');
    const cursorAmp = document.getElementById('cursor-amp');

    const playerSection = document.getElementById('player-section');
    const btnPlay = document.getElementById('btn-play');
    const btnPause = document.getElementById('btn-pause');
    const playerProgress = document.getElementById('player-progress');
    const playerProgressBar = document.getElementById('player-progress-bar');
    const playerCurrent = document.getElementById('player-current');
    const playerDuration = document.getElementById('player-duration');
    const volumeSlider = document.getElementById('volume-slider');

    const settingFftSize = document.getElementById('fft-size');
    const settingWindowFn = document.getElementById('window-fn');
    const settingOverlap = document.getElementById('overlap');
    const settingOverlapValue = document.getElementById('overlap-value');
    const settingColorMap = document.getElementById('color-map');
    const settingFreqScale = document.getElementById('freq-scale');
    const settingMinDb = document.getElementById('min-db');
    const settingMinDbValue = document.getElementById('min-db-value');
    const settingMaxFreq = document.getElementById('max-freq');
    const settingPixelsPerSec = document.getElementById('pixels-per-sec');
    const btnRegenerate = document.getElementById('btn-regenerate');

    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    // BirdNET elements
    const btnAnalyzeSpectrogram = document.getElementById('btn-analyze-spectrogram');
    const birdnetResultsPanel = document.getElementById('birdnet-results-panel');
    const birdnetResults = document.getElementById('birdnet-results');
    const btnCloseResults = document.getElementById('btn-close-results');

    // External URL elements
    const audioUrlInput = document.getElementById('audio-url-input');
    const btnLoadUrl = document.getElementById('btn-load-url');

    // ── State ──
    let currentAudioBuffer = null;
    let currentBlob = null;
    let recorder = new AudioRecorder();
    let player = new AudioPlayer();
    let birdnetAnalyzer = new BirdNETAnalyzer();
    let renderer = null;
    let timerInterval = null;
    let basePixelsPerSec = 100;
    let zoomLevel = 1;

    // ── Tab switching ──
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${tab}`).classList.add('active');
        });
    });

    // ── Recording ──
    recorder.onComplete = (audioBuffer, blob) => {
        currentAudioBuffer = audioBuffer;
        currentBlob = blob;
        recordStatus.textContent = `Recorded ${audioBuffer.duration.toFixed(1)}s (${audioBuffer.sampleRate} Hz, ${audioBuffer.numberOfChannels}ch)`;
        generateSpectrogram();
    };

    recorder.onError = (err) => {
        recordStatus.textContent = err.message;
        resetRecordUI();
    };

    btnRecord.addEventListener('click', async () => {
        const ok = await recorder.start();
        if (ok) {
            btnRecord.disabled = true;
            btnRecord.classList.add('recording');
            btnStopRecord.disabled = false;
            recordStatus.textContent = 'Recording...';
            timerInterval = setInterval(updateRecordTimer, 100);
        }
    });

    btnStopRecord.addEventListener('click', () => {
        recorder.stop();
        resetRecordUI();
        recordStatus.textContent = 'Processing...';
    });

    function updateRecordTimer() {
        const elapsed = recorder.getElapsedTime();
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = Math.floor(elapsed % 60).toString().padStart(2, '0');
        recordTimer.textContent = `${mins}:${secs}`;
    }

    function resetRecordUI() {
        btnRecord.disabled = false;
        btnRecord.classList.remove('recording');
        btnStopRecord.disabled = true;
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    // ── File Upload ──
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            loadAudioFile(e.target.files[0]);
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            loadAudioFile(files[0]);
        }
    });

    async function loadAudioFile(file) {
        if (!file.type.startsWith('audio/') && !file.name.match(/\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i)) {
            showFileInfo('Unsupported file format.', true);
            return;
        }

        showFileInfo(`Loading: <span class="file-name">${escapeHtml(file.name)}</span> (${formatSize(file.size)})...`);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            audioCtx.close();

            currentAudioBuffer = audioBuffer;
            currentBlob = file;

            showFileInfo(`
                <span class="file-name">${escapeHtml(file.name)}</span> &mdash;
                ${audioBuffer.duration.toFixed(1)}s,
                ${audioBuffer.sampleRate} Hz,
                ${audioBuffer.numberOfChannels} channel${audioBuffer.numberOfChannels > 1 ? 's' : ''}
            `);

            generateSpectrogram();
        } catch (err) {
            showFileInfo(`Error decoding audio file: ${err.message}`, true);
        }
    }

    function showFileInfo(html, isError) {
        fileInfo.innerHTML = html;
        fileInfo.classList.remove('hidden');
        fileInfo.style.color = isError ? '#ef4444' : '';
    }

    // ── Spectrogram Generation ──
    async function generateSpectrogram() {
        if (!currentAudioBuffer) return;

        player.stop();
        updatePlayerUI(0, currentAudioBuffer.duration);

        showLoading(true, 'Generating spectrogram...');

        const options = getSettings();
        renderer = new SpectrogramRenderer(options);
        zoomLevel = 1;
        basePixelsPerSec = options.pixelsPerSec;

        try {
            await renderer.generate(currentAudioBuffer, (progress) => {
                loadingText.textContent = `Generating spectrogram... ${Math.round(progress * 100)}%`;
            });

            renderer.renderToCanvas(spectrogramCanvas, spectrogramOverlay, freqAxisCanvas, timeAxisCanvas);

            // Set up player
            player.load(currentAudioBuffer);
            player.setVolume(parseFloat(volumeSlider.value));

            // Show sections
            spectrogramSection.classList.remove('hidden');
            playerSection.classList.remove('hidden');

            // Sync scroll
            syncTimeAxisScroll();

            showLoading(false);
        } catch (err) {
            showLoading(false);
            alert('Error generating spectrogram: ' + err.message);
        }
    }

    function getSettings() {
        return {
            fftSize: parseInt(settingFftSize.value),
            windowFn: settingWindowFn.value,
            overlap: parseInt(settingOverlap.value) / 100,
            colorMap: settingColorMap.value,
            freqScale: settingFreqScale.value,
            minDb: parseInt(settingMinDb.value),
            maxFreq: parseInt(settingMaxFreq.value),
            pixelsPerSec: parseInt(settingPixelsPerSec.value)
        };
    }

    // ── Settings controls ──
    settingOverlap.addEventListener('input', () => {
        settingOverlapValue.textContent = `${settingOverlap.value}%`;
    });

    settingMinDb.addEventListener('input', () => {
        settingMinDbValue.textContent = `${settingMinDb.value} dB`;
    });

    btnRegenerate.addEventListener('click', () => {
        generateSpectrogram();
    });

    // ── Zoom ──
    btnZoomIn.addEventListener('click', () => {
        if (!renderer || !renderer.spectrogramData) return;
        zoomLevel = Math.min(zoomLevel * 1.5, 8);
        applyZoom();
    });

    btnZoomOut.addEventListener('click', () => {
        if (!renderer || !renderer.spectrogramData) return;
        zoomLevel = Math.max(zoomLevel / 1.5, 0.25);
        applyZoom();
    });

    btnZoomReset.addEventListener('click', () => {
        if (!renderer || !renderer.spectrogramData) return;
        zoomLevel = 1;
        applyZoom();
    });

    function applyZoom() {
        renderer.pixelsPerSec = basePixelsPerSec * zoomLevel;
        renderer.renderToCanvas(spectrogramCanvas, spectrogramOverlay, freqAxisCanvas, timeAxisCanvas);
        syncTimeAxisScroll();
    }

    // ── Spectrogram mouse interaction ──
    spectrogramScroll.addEventListener('mousemove', (e) => {
        if (!renderer || !renderer.spectrogramData) return;
        const rect = spectrogramCanvas.getBoundingClientRect();
        const scrollLeft = spectrogramScroll.scrollLeft;
        const x = e.clientX - rect.left + scrollLeft;
        const y = e.clientY - rect.top;

        const info = renderer.getInfoAt(x, y, spectrogramCanvas.width, spectrogramCanvas.height);
        if (info) {
            cursorTime.textContent = `Time: ${info.time.toFixed(3)}s`;
            cursorFreq.textContent = `Freq: ${info.freq.toFixed(0)} Hz`;
            cursorAmp.textContent = `Amp: ${info.db.toFixed(1)} dB`;
        }
    });

    spectrogramScroll.addEventListener('click', (e) => {
        if (!renderer || !renderer.spectrogramData) return;
        const rect = spectrogramCanvas.getBoundingClientRect();
        const scrollLeft = spectrogramScroll.scrollLeft;
        const x = e.clientX - rect.left + scrollLeft;
        const time = (x / spectrogramCanvas.width) * renderer.spectrogramData.duration;
        player.seek(time);
        updatePlayerUI(time, renderer.spectrogramData.duration);
        renderer.drawPlaybackCursor(spectrogramOverlay, time);
    });

    // Sync time axis scroll with spectrogram scroll
    spectrogramScroll.addEventListener('scroll', syncTimeAxisScroll);

    function syncTimeAxisScroll() {
        timeAxisScroll.scrollLeft = spectrogramScroll.scrollLeft;
    }

    // ── Export ──
    btnExportPng.addEventListener('click', () => {
        if (!renderer) return;
        const dataUrl = renderer.exportAsImage(spectrogramCanvas, freqAxisCanvas, timeAxisCanvas);
        const link = document.createElement('a');
        link.download = 'spectrogram.png';
        link.href = dataUrl;
        link.click();
    });

    // ── Player controls ──
    player.onTimeUpdate = (currentTime, duration) => {
        updatePlayerUI(currentTime, duration);
        if (renderer) {
            renderer.drawPlaybackCursor(spectrogramOverlay, currentTime);

            // Auto-scroll spectrogram to follow cursor
            const cursorX = (currentTime / duration) * spectrogramCanvas.width;
            const scrollWidth = spectrogramScroll.clientWidth;
            const scrollLeft = spectrogramScroll.scrollLeft;
            if (cursorX < scrollLeft || cursorX > scrollLeft + scrollWidth - 50) {
                spectrogramScroll.scrollLeft = cursorX - scrollWidth * 0.2;
            }
        }
    };

    player.onEnded = () => {
        btnPlay.classList.remove('hidden');
        btnPause.classList.add('hidden');
        if (renderer) {
            renderer.clearOverlay(spectrogramOverlay);
        }
        updatePlayerUI(0, player.duration);
    };

    btnPlay.addEventListener('click', () => {
        player.play();
        btnPlay.classList.add('hidden');
        btnPause.classList.remove('hidden');
    });

    btnPause.addEventListener('click', () => {
        player.pause();
        btnPlay.classList.remove('hidden');
        btnPause.classList.add('hidden');
    });

    playerProgress.addEventListener('click', (e) => {
        const rect = playerProgress.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        const time = ratio * player.duration;
        player.seek(time);
        updatePlayerUI(time, player.duration);
        if (renderer) {
            renderer.drawPlaybackCursor(spectrogramOverlay, time);
        }
    });

    volumeSlider.addEventListener('input', () => {
        player.setVolume(parseFloat(volumeSlider.value));
    });

    function updatePlayerUI(currentTime, duration) {
        playerProgressBar.style.width = `${(currentTime / duration) * 100}%`;
        playerCurrent.textContent = formatDuration(currentTime);
        playerDuration.textContent = formatDuration(duration);
    }

    // ── Utility ──
    function formatDuration(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function showLoading(visible, text) {
        if (visible) {
            loadingText.textContent = text || 'Loading...';
            loadingOverlay.classList.remove('hidden');
        } else {
            loadingOverlay.classList.add('hidden');
        }
    }

    // ── BirdNET Analysis ──
    btnAnalyzeSpectrogram.addEventListener('click', async () => {
        if (!currentAudioBuffer) return;
        await runBirdNETAnalysis();
    });

    btnCloseResults.addEventListener('click', () => {
        birdnetResultsPanel.classList.add('hidden');
    });

    async function runBirdNETAnalysis() {
        // Show results panel
        birdnetResultsPanel.classList.remove('hidden');

        // Show analyzing state
        birdnetResults.innerHTML = '<div class="birdnet-analyzing"><div class="mini-spinner"></div><span>Analyzing audio with BirdNET...</span></div>';

        try {
            const results = await birdnetAnalyzer.analyze(currentAudioBuffer, (progress) => {
                const pct = Math.round(progress * 100);
                birdnetResults.innerHTML = `<div class="birdnet-analyzing"><div class="mini-spinner"></div><span>Analyzing audio... ${pct}%</span></div>`;
            });

            renderBirdNETResults(results);
        } catch (err) {
            birdnetResults.innerHTML = `<p class="birdnet-no-results" style="color: var(--danger);">Analysis error: ${escapeHtml(err.message)}</p>`;
        }
    }

    function renderBirdNETResults(results) {
        if (!results || results.length === 0) {
            birdnetResults.innerHTML = '<p class="birdnet-no-results">No species detected in this audio.</p>';
            return;
        }

        let html = '<div class="birdnet-species-list">';
        results.forEach((r, i) => {
            const pct = Math.round(r.confidence * 100);
            const level = pct >= 70 ? 'high' : pct >= 40 ? 'medium' : 'low';
            const displayName = r.species.replace(/\s*\(.*\)/, '');
            const scientific = r.scientificName || '';
            const timeRange = `${r.startTime.toFixed(1)}s - ${r.endTime.toFixed(1)}s`;
            const freqRange = r.frequencyRange || '';

            html += `
                <div class="species-card">
                    <span class="species-rank">#${i + 1}</span>
                    <div class="species-info">
                        <div class="species-name">${escapeHtml(displayName)}</div>
                        ${scientific ? `<div class="species-scientific">${escapeHtml(scientific)}</div>` : ''}
                        <div class="species-meta">${escapeHtml(timeRange)}${freqRange ? ' &middot; ' + escapeHtml(freqRange) : ''}</div>
                    </div>
                    <div class="species-confidence-wrapper">
                        <div class="species-confidence-bar">
                            <div class="species-confidence-fill ${level}" style="width: ${pct}%"></div>
                        </div>
                        <span class="species-confidence-value ${level}">${pct}%</span>
                    </div>
                </div>`;
        });
        html += '</div>';
        birdnetResults.innerHTML = html;
    }

    // ── External URL Audio Loading ──
    btnLoadUrl.addEventListener('click', () => {
        loadAudioFromUrl();
    });

    audioUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            loadAudioFromUrl();
        }
    });

    async function loadAudioFromUrl() {
        const url = audioUrlInput.value.trim();
        if (!url) return;

        try {
            new URL(url);
        } catch {
            showFileInfo('Please enter a valid URL.', true);
            return;
        }

        showFileInfo(`Loading audio from URL...`);
        btnLoadUrl.disabled = true;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            audioCtx.close();

            const fileName = url.split('/').pop().split('?')[0] || 'audio';
            currentAudioBuffer = audioBuffer;
            currentBlob = new Blob([arrayBuffer]);

            showFileInfo(`
                <span class="file-name">${escapeHtml(fileName)}</span> &mdash;
                ${audioBuffer.duration.toFixed(1)}s,
                ${audioBuffer.sampleRate} Hz,
                ${audioBuffer.numberOfChannels} channel${audioBuffer.numberOfChannels > 1 ? 's' : ''}
            `);

            generateSpectrogram();
        } catch (err) {
            showFileInfo(`Error loading audio from URL: ${escapeHtml(err.message)}`, true);
        } finally {
            btnLoadUrl.disabled = false;
        }
    }

    // ── Keyboard shortcuts ──
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (player.isPlaying) {
                    btnPause.click();
                } else if (player.audioBuffer) {
                    btnPlay.click();
                }
                break;
            case 'Equal':
            case 'NumpadAdd':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    btnZoomIn.click();
                }
                break;
            case 'Minus':
            case 'NumpadSubtract':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    btnZoomOut.click();
                }
                break;
            case 'Digit0':
            case 'Numpad0':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    btnZoomReset.click();
                }
                break;
        }
    });

    // ── Responsive canvas sizing ──
    function resizeRecordCanvas() {
        const canvas = document.getElementById('record-waveform');
        if (canvas) {
            canvas.width = canvas.parentElement.clientWidth;
        }
    }

    window.addEventListener('resize', resizeRecordCanvas);
    resizeRecordCanvas();

})();
