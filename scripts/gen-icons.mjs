import sharp from 'sharp';
import { mkdirSync } from 'fs';

mkdirSync('public/icons', { recursive: true });

// Compound "C" logo — warm clay on off-white, rounded corners
const makeSvg = (size) => {
  const r = Math.round(size * 0.2); // corner radius ~20%
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#c96442"/>
  <text
    x="50%"
    y="53%"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="${Math.round(size * 0.58)}"
    font-weight="bold"
    fill="#faf9f5"
    letter-spacing="-0.02em"
  >C</text>
</svg>`;
};

const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];

for (const size of sizes) {
  await sharp(Buffer.from(makeSvg(size)))
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}x${size}.png`);
  console.log(`✓ icon-${size}x${size}.png`);
}

// Also generate favicon-style icons
await sharp(Buffer.from(makeSvg(32)))
  .resize(32, 32)
  .png()
  .toFile('public/favicon-32x32.png');

await sharp(Buffer.from(makeSvg(16)))
  .resize(16, 16)
  .png()
  .toFile('public/favicon-16x16.png');

// apple-touch-icon (180x180 already above, also copy to root)
await sharp(Buffer.from(makeSvg(180)))
  .resize(180, 180)
  .png()
  .toFile('public/apple-touch-icon.png');

console.log('✓ All icons generated');
