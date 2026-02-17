/**
 * Professional color maps for spectrogram rendering.
 * Each map is an array of 256 [R, G, B] values.
 */
const ColorMaps = (() => {
    function interpolate(stops, n = 256) {
        const result = new Array(n);
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            let s0 = 0;
            let s1 = 1;
            for (let j = 0; j < stops.length - 1; j++) {
                const st = j / (stops.length - 1);
                const st1 = (j + 1) / (stops.length - 1);
                if (t >= st && t <= st1) {
                    s0 = j;
                    s1 = j + 1;
                    break;
                }
            }
            const localT = (stops.length - 1) * t - s0;
            const c0 = stops[s0];
            const c1 = stops[s1];
            result[i] = [
                Math.round(c0[0] + (c1[0] - c0[0]) * localT),
                Math.round(c0[1] + (c1[1] - c0[1]) * localT),
                Math.round(c0[2] + (c1[2] - c0[2]) * localT)
            ];
        }
        return result;
    }

    const viridis = interpolate([
        [68, 1, 84],
        [72, 35, 116],
        [64, 67, 135],
        [52, 94, 141],
        [41, 120, 142],
        [32, 144, 140],
        [34, 167, 132],
        [68, 190, 112],
        [121, 209, 81],
        [189, 222, 38],
        [253, 231, 37]
    ]);

    const magma = interpolate([
        [0, 0, 4],
        [20, 14, 54],
        [56, 15, 110],
        [97, 18, 132],
        [137, 28, 131],
        [175, 45, 116],
        [210, 71, 89],
        [234, 107, 66],
        [247, 153, 57],
        [251, 204, 80],
        [252, 253, 191]
    ]);

    const inferno = interpolate([
        [0, 0, 4],
        [22, 11, 57],
        [66, 10, 104],
        [106, 23, 110],
        [147, 38, 103],
        [186, 54, 85],
        [216, 87, 53],
        [237, 130, 17],
        [246, 181, 10],
        [241, 229, 29],
        [252, 255, 164]
    ]);

    const plasma = interpolate([
        [13, 8, 135],
        [65, 4, 157],
        [106, 0, 168],
        [143, 13, 163],
        [175, 40, 145],
        [201, 67, 121],
        [221, 97, 93],
        [237, 130, 63],
        [246, 168, 32],
        [248, 209, 27],
        [240, 249, 33]
    ]);

    const grayscale = interpolate([
        [0, 0, 0],
        [255, 255, 255]
    ]);

    const jet = interpolate([
        [0, 0, 127],
        [0, 0, 255],
        [0, 127, 255],
        [0, 255, 255],
        [127, 255, 127],
        [255, 255, 0],
        [255, 127, 0],
        [255, 0, 0],
        [127, 0, 0]
    ]);

    const maps = { viridis, magma, inferno, plasma, grayscale, jet };

    /**
     * Get a colormap by name.
     * @param {string} name
     * @returns {Array<number[]>} Array of 256 [R,G,B] values
     */
    function get(name) {
        return maps[name] || viridis;
    }

    /**
     * Map a normalized value [0,1] to an RGB color.
     * @param {string} mapName
     * @param {number} value 0..1
     * @returns {number[]} [R,G,B]
     */
    function mapValue(mapName, value) {
        const cm = get(mapName);
        const idx = Math.max(0, Math.min(255, Math.round(value * 255)));
        return cm[idx];
    }

    /**
     * Create a lookup table as Uint8Array(256*4) for fast RGBA mapping.
     */
    function createLUT(mapName) {
        const cm = get(mapName);
        const lut = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) {
            const c = cm[i];
            lut[i * 4] = c[0];
            lut[i * 4 + 1] = c[1];
            lut[i * 4 + 2] = c[2];
            lut[i * 4 + 3] = 255;
        }
        return lut;
    }

    return { get, mapValue, createLUT, maps };
})();
