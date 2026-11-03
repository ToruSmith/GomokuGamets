// 產生木紋材質與 App 圖示，輸出檔案已納入版本控制，只有想調整時才需要重跑。
// 執行：node scripts/generate-assets.mjs
import fs from 'node:fs';
import sharp from 'sharp';

/* ───── 木紋：柾目（直紋），用多層正弦與平滑雜訊疊出 ───── */
const SIZE = 1024;

function smoothNoise(seed, cells) {
  const grid = new Float32Array((cells + 1) * (cells + 1));
  let state = seed;
  for (let i = 0; i < grid.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    grid[i] = state / 2 ** 32;
  }
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x * cells;
    const gy = y * cells;
    const ix = Math.min(cells - 1, Math.floor(gx));
    const iy = Math.min(cells - 1, Math.floor(gy));
    const fx = fade(gx - ix);
    const fy = fade(gy - iy);
    const at = (a, b) => grid[b * (cells + 1) + a];
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

const warp = smoothNoise(7, 6);
const broad = smoothNoise(19, 14);
const fine = smoothNoise(31, 180);
const pixels = Buffer.alloc(SIZE * SIZE);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const u = x / SIZE;
    const v = y / SIZE;
    // 紋理沿縱向延伸，只用很低頻的擾動讓線條微微彎曲
    const bend = (warp(u, v * 0.25) - 0.5) * 0.035;
    const position = u + bend;
    const growth = Math.sin(position * 300 + broad(u, v * 0.15) * 6);
    const pores = Math.sin(position * 880 + fine(u, v * 0.06) * 8);
    const band = (broad(u * 0.8, v * 0.06) - 0.5) * 26;
    const value = 228 + growth * 6 + pores * 3 + band;
    pixels[y * SIZE + x] = Math.max(0, Math.min(255, Math.round(value)));
  }
}

await sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 1 } })
  .webp({ quality: 58, effort: 6 })
  .toFile('src/assets/wood.webp');

/* ───── App 圖示：棋盤一角上的一黑一白 ───── */
const iconSvg = (padding) => {
  const size = 512 - padding * 2;
  const step = size / 4;
  const offset = (n) => padding + step * n;
  const lines = [0.5, 1.5, 2.5, 3.5]
    .map(
      (n) =>
        `<path d="M${offset(0)} ${offset(n)}H${offset(4)}M${offset(n)} ${offset(0)}V${offset(4)}" stroke="#3d2a12" stroke-width="${step * 0.05}"/>`,
    )
    .join('');
  const radius = step * 0.74;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="b" cx="36%" cy="32%" r="72%"><stop offset="0" stop-color="#5b6068"/><stop offset=".45" stop-color="#23262c"/><stop offset="1" stop-color="#0a0b0e"/></radialGradient>
    <radialGradient id="w" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#fff"/><stop offset=".62" stop-color="#f1efe8"/><stop offset="1" stop-color="#c4c2b8"/></radialGradient>
  </defs>
  <rect width="512" height="512" fill="#e2b56c"/>
  ${lines}
  <circle cx="${offset(1.5)}" cy="${offset(1.5)}" r="${radius}" fill="url(#b)"/>
  <circle cx="${offset(2.5)}" cy="${offset(2.5)}" r="${radius}" fill="url(#w)"/>
</svg>`;
};

fs.mkdirSync('public/icons', { recursive: true });
const rounded = (svg) =>
  svg.replace('<rect width="512" height="512"', '<rect width="512" height="512" rx="96"');
await sharp(Buffer.from(rounded(iconSvg(0))))
  .resize(192, 192)
  .png()
  .toFile('public/icons/icon-192.png');
await sharp(Buffer.from(rounded(iconSvg(0))))
  .resize(512, 512)
  .png()
  .toFile('public/icons/icon-512.png');
await sharp(Buffer.from(iconSvg(60)))
  .png()
  .toFile('public/icons/icon-maskable-512.png');
await sharp(Buffer.from(iconSvg(0)))
  .resize(180, 180)
  .png()
  .toFile('public/icons/apple-touch-icon.png');
fs.writeFileSync('public/icons/favicon.svg', rounded(iconSvg(0)));
