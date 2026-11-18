// Generates the PNG icons for Mi Barrio - TPV Celular with zero dependencies.
// Rasterizes a simple flat design (deep red background, cream pizza, red pepperoni)
// at 4x supersampling, downsamples, and encodes PNG (RGBA, filter 0, zlib).
// Run: node mi-barrio-tpv-celular/tools/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..');

const BG = [185, 28, 28];        // #b91c1c deep red
const CRUST = [245, 196, 112];   // amber crust
const CHEESE = [253, 240, 210];  // cream
const PEPPERONI = [200, 50, 31]; // pepperoni red
const INK = [23, 23, 23];        // receipt ink (dark)
const PAPER = [255, 255, 255];   // receipt paper

// Signed distance helpers (unit = pixels, centered coordinates)
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
const sdRoundBox = (x, y, cx, cy, hw, hh, r) => {
    const qx = Math.abs(x - cx) - (hw - r), qy = Math.abs(y - cy) - (hh - r);
    const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
};

function render(size, { maskable = false } = {}) {
    const SS = 4, S = size * SS;
    const px = new Uint8Array(S * S * 3);
    const C = S / 2;
    // Maskable: keep art inside the 80% safe zone; regular icon fills more.
    const pizzaR = S * (maskable ? 0.26 : 0.30);
    const pizzaCY = C - S * 0.02;
    const pepperoniR = S * (maskable ? 0.038 : 0.045);
    const pep = [
        [C - pizzaR * 0.45, pizzaCY - pizzaR * 0.30],
        [C + pizzaR * 0.42, pizzaCY - pizzaR * 0.22],
        [C - pizzaR * 0.05, pizzaCY + pizzaR * 0.38],
        [C + pizzaR * 0.05, pizzaCY + pizzaR * 0.02],
    ];
    // Receipt (small white ticket under the pizza) for the "TPV" angle.
    const rw = S * 0.15, rh = S * 0.19, rcx = C + S * 0.25, rcy = C + S * 0.26;
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            let col = null; // start transparent; background rounded rect below
            const bgD = maskable
                ? -1 // maskable: full-bleed background (OS applies the mask)
                : sdRoundBox(x, y, C, C, C, C, S * 0.22);
            if (bgD < 0) col = BG;
            if (col) {
                // Pizza crust ring
                if (sdCircle(x, y, C, pizzaCY, pizzaR) < 0) col = CRUST;
                if (sdCircle(x, y, C, pizzaCY, pizzaR * 0.82) < 0) col = CHEESE;
                for (const [pxp, pyp] of pep) {
                    if (sdCircle(x, y, pxp, pyp, pepperoniR) < 0) col = PEPPERONI;
                }
                // Receipt body with torn bottom edge (zigzag via triangles)
                if (sdRoundBox(x, y, rcx, rcy, rw, rh, S * 0.015) < 0) col = PAPER;
                if (col === PAPER) {
                    // Printed lines on the receipt
                    const lw = rw * 0.62;
                    for (let li = -1; li <= 1; li++) {
                        const ly = rcy + li * rh * 0.42;
                        if (Math.abs(y - ly) < S * 0.008 && Math.abs(x - rcx) < lw) col = INK;
                    }
                }
            }
            const i = (y * S + x) * 3;
            // Outside the rounded background: paint BG (alpha is applied at encode time)
            // so edge anti-alias doesn't bleed black into the icon.
            const c = col || BG;
            px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
        }
    }
    // Downsample 4x -> 1x (box filter)
    const out = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let r = 0, g = 0, b = 0, n = 0;
            const opaque = new Array(SS * SS).fill(true);
            for (let dy = 0; dy < SS; dy++) {
                for (let dx = 0; dx < SS; dx++) {
                    const i = (((y * SS + dy) * S) + (x * SS + dx)) * 3;
                    r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
                    if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0 && !maskable) {
                        // track possibly-transparent background pixels
                    }
                }
            }
            const j = (y * size + x) * 4;
            out[j] = Math.round(r / n); out[j + 1] = Math.round(g / n); out[j + 2] = Math.round(b / n);
            out[j + 3] = maskable ? 255 : alphaFor(x, y, size);
        }
    }
    return out;
}

// Outside the rounded background (transparent corners) alpha = 0.
function alphaFor(x, y, size) {
    const C = size / 2;
    const sd = sdRoundBox(x, y, C, C, C, C, size * 0.22);
    if (sd >= 1) return 0;
    if (sd <= -1) return 255;
    return Math.round(255 * (1 - (sd + 1) / 2));
}

// CRC32 (PNG)
const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
};
function encodePng(rgba, width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0; // filter: none
        Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
    }
    const idat = deflateSync(raw, { level: 9 });
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const targets = [
    ['icon-192.png', 192, {}],
    ['icon-512.png', 512, {}],
    ['icon-maskable-192.png', 192, { maskable: true }],
    ['icon-maskable-512.png', 512, { maskable: true }],
    ['apple-touch-icon.png', 180, {}],
];
for (const [name, size, opts] of targets) {
    writeFileSync(join(OUT, name), encodePng(render(size, opts), size, size));
    console.log('wrote', name, size + 'x' + size);
}
