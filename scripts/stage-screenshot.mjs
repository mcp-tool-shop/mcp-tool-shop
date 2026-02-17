import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadRegistry } from './lib/front-door.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OVERRIDES_PATH = path.join(ROOT, 'site', 'src', 'data', 'overrides.json');
const SCREENSHOTS_DIR = path.join(ROOT, 'site', 'public', 'screenshots');

const [inputPath, slug] = process.argv.slice(2);

if (!inputPath || !slug) {
  console.error('Usage: node scripts/stage-screenshot.mjs <image-path> <slug>');
  console.error('Example: node scripts/stage-screenshot.mjs ./myshot.png brain-dev');
  process.exit(1);
}

// Support relative paths from CWD
const absInputPath = path.resolve(process.cwd(), inputPath);

if (!fs.existsSync(absInputPath)) {
  console.error(`❌ Input file not found: ${absInputPath}`);
  process.exit(1);
}

let registryData;
try {
  registryData = loadRegistry(ROOT);
} catch (e) {
  console.error(`❌ Failed to load registry: ${e.message}`);
  process.exit(1);
}
const { registry, overrides } = registryData;

const tool = registry.find(t => t.id === slug);
if (!tool) {
  console.error(`❌ Tool "${slug}" not found in registry.`);
  process.exit(1);
}

// 1. Validate Image Type
const ext = path.extname(absInputPath).toLowerCase();
if (ext !== '.png') {
  console.error(`❌ File type must be .png (Found: ${ext})`);
  process.exit(1);
}

// 1.5 Validate Resolution (Dimensions)
// We need a way to check dimensions without heavy deps.
// PNG header parsing is simple enough for IHDR chunk.
function getPngDimensions(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(24);
    fs.readSync(fd, buffer, 0, 24, 0);
    fs.closeSync(fd);
    
    // Check PNG signature
    if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
        throw new Error('Not a valid PNG file');
    }
    
    // Read width (bytes 16-20) and height (bytes 20-24) - Big Endian
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
}

try {
    const { width, height } = getPngDimensions(absInputPath);
    // Flexible constraint: prefer 1280x640 (2:1 aspect) but warn if off
    // User requested "validates resolution" before removing placeholder.
    // Let's enforce strict width 1280 for now, or at least > 800.
    const validWidth = width >= 800 && width <= 1920;
    const validHeight = height >= 400 && height <= 1080; 

    if (!validWidth || !validHeight) {
        console.warn(`⚠️  Warning: dimensions ${width}x${height} are unusual.`);
        // Don't fail, but maybe don't auto-remove placeholder if it's tiny?
        // User asked: "only do that when the file validates as a correct PNG at 1280x640"
        if (width !== 1280 || height !== 640) {
             console.warn(`⚠️  Resolution mismatch: Expected 1280x640. Placeholder REMOVAL skipped.`);
             // We will copy the file, but NOT remove the placeholder tag automatically
             // to nudge the user to fix it or override manually.
             // Actually, let's just fail if it's way off, or warn.
        }
    }
} catch (e) {
    console.error(`❌ Failed to read PNG dimensions: ${e.message}`);
    process.exit(1);
}

// 2. Prep Destination
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// 3. Move/Copy File
const destPath = path.join(SCREENSHOTS_DIR, `${slug}.png`);
try {
  fs.copyFileSync(absInputPath, destPath);
  console.log(`✅ Screenshot staged at: site/public/screenshots/${slug}.png`);
} catch (e) {
  console.error(`❌ Failed to copy file: ${e.message}`);
  process.exit(1);
}

// 4. Update Overrides
let overridesChanged = false;
const currentOverride = overrides[slug] || {};

const imgDims = getPngDimensions(absInputPath);
const validRes = imgDims && imgDims.width === 1280 && imgDims.height === 640;

if (!validRes) {
    if (currentOverride.screenshotType === 'placeholder') {
        console.warn('⚠️  Placeholder NOT removed: Image must be 1280x640 to graduate from placeholder status automatically.');
    }
} else {
    // Only remove placeholder if dims match
    if (currentOverride.screenshotType === 'placeholder') {
        delete currentOverride.screenshotType;
        // Cleanup empty override object to keep file clean
        if(Object.keys(currentOverride).length === 0) {
            delete overrides[slug];
        } else {
            overrides[slug] = currentOverride;
        }
        overridesChanged = true;
        console.log(`✅ Removed 'placeholder' status for ${slug} (Dimensions Valid: 1280x640)`);
    }
}

if (overridesChanged) {
  const sortedOverrides = {};
  Object.keys(overrides).sort().forEach(key => {
    sortedOverrides[key] = overrides[key];
  });
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(sortedOverrides, null, 2));
  console.log(`✅ Updated overrides.json`);
} else {
  console.log(`ℹ️  No changes needed in overrides.json`);
}

console.log(`\n🎉 Done! Run 'node scripts/site-audit-images.mjs' to verify.`);
