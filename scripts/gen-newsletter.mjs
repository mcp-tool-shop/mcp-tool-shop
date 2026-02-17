/**
 * Generate newsletter updates.
 * Updates the timestamp and potentially rotates content snippet to keep it fresh.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT_PATH = path.join(process.cwd(), 'site', 'src', 'data', 'newsletter.json');

// Ensure directory exists
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

if (fs.existsSync(OUT_PATH)) {
  try {
    const existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    
    // Update timestamp to today
    const updated = {
      ...existing,
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(OUT_PATH, JSON.stringify(updated, null, 2));
    console.log(`Updated newsletter at ${OUT_PATH}`);
  } catch (e) {
    console.error("Failed to update newsletter:", e);
  }
} else {
  console.log("Newsletter file not found, skipping update.");
}
