/**
 * Builds the app icon set from two source images.
 *
 * Run with Electron, not node:
 *   npx electron scripts/make-icons.js <bot.png> <logo.png>
 *
 * Electron's nativeImage does the resizing, so there is no native image
 * dependency to install — sharp and ImageMagick are both absent here, and
 * adding a compiled dependency to this project has already proven expensive.
 *
 * The .ico is written directly. A modern ICO is just a small header followed by
 * embedded PNGs, which Windows has accepted since Vista, so a few dozen lines
 * beat pulling in a package for one build step.
 */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Sizes Windows actually asks for: taskbar, desktop, alt-tab, high DPI. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(pngBuffers) {
  // ICONDIR: reserved(2) + type(2) + count(2)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(pngBuffers.length, 4);

  const entries = [];
  const images = [];
  // Directory entries are fixed-width, so payloads start after all of them.
  let offset = 6 + pngBuffers.length * 16;

  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    // 256 is stored as 0 — the field is a single byte.
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2);                      // palette count
    entry.writeUInt8(0, 3);                      // reserved
    entry.writeUInt16LE(1, 4);                   // colour planes
    entry.writeUInt16LE(32, 6);                  // bits per pixel
    entry.writeUInt32LE(buffer.length, 8);       // payload size
    entry.writeUInt32LE(offset, 12);             // payload offset
    entries.push(entry);
    images.push(buffer);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...entries, ...images]);
}

app.whenReady().then(() => {
  const [botSrc, logoSrc] = process.argv.slice(2);

  if (!botSrc || !fs.existsSync(botSrc)) {
    console.error('Bot image not found:', botSrc);
    console.error('Usage: npx electron scripts/make-icons.js <bot.png> <logo.png>');
    process.exit(1);
  }
  if (!logoSrc || !fs.existsSync(logoSrc)) {
    console.error('Logo image not found:', logoSrc);
    process.exit(1);
  }

  const bot = nativeImage.createFromPath(botSrc);
  if (bot.isEmpty()) {
    console.error('Could not decode the bot image (is it a real PNG/JPG?):', botSrc);
    process.exit(1);
  }
  const botSize = bot.getSize();
  console.log(`bot source : ${botSize.width}x${botSize.height}  ${botSrc}`);

  const logo = nativeImage.createFromPath(logoSrc);
  if (logo.isEmpty()) {
    console.error('Could not decode the logo image:', logoSrc);
    process.exit(1);
  }
  const logoSize = logo.getSize();
  console.log(`logo source: ${logoSize.width}x${logoSize.height}  ${logoSrc}`);

  // 1. Windows icon for the exe, the desktop shortcut and the taskbar.
  const pngs = ICO_SIZES.map(size => ({
    size,
    buffer: bot.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));
  const icoPath = path.join(ROOT, 'build', 'icon.ico');
  fs.mkdirSync(path.dirname(icoPath), { recursive: true });
  fs.writeFileSync(icoPath, buildIco(pngs));
  console.log(`wrote ${icoPath} (${ICO_SIZES.join(', ')})`);

  // 2. In-app icon: the tray and the BrowserWindow read this one. Kept square
  //    and modest — the tray renders it at 16-32px.
  const iconPng = path.join(ROOT, 'src', 'images', 'lead-icon.png');
  fs.writeFileSync(iconPng, bot.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  console.log(`wrote ${iconPng} (512x512)`);

  // 3. In-app logo: the sidebar and the startup loader. Aspect ratio is
  //    preserved — this one is a wordmark, not a square.
  const targetWidth = 512;
  const logoPng = path.join(ROOT, 'src', 'images', 'lead-logo.png');
  fs.writeFileSync(
    logoPng,
    logo.resize({
      width: targetWidth,
      height: Math.round((logoSize.height / logoSize.width) * targetWidth),
      quality: 'best',
    }).toPNG(),
  );
  console.log(`wrote ${logoPng} (${targetWidth}px wide, aspect preserved)`);

  console.log('\nDone. Rebuild to pick these up.');
  process.exit(0);
});
