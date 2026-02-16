/**
 * Privacy-respecting telemetry tracker.
 *
 * No cookies, no user IDs, no IP storage, no fingerprinting, no external services.
 * Events buffered in localStorage, exported manually via /lab/telemetry-export/.
 */

const STORAGE_KEY = "mcpt_telemetry";
const MAX_BUFFER = 1000;
const DEDUPE_WINDOW_MS = 2000;

const VALID_TYPES = new Set([
  "copy_proof_link",
  "copy_bundle",
  "copy_verify_cmd",
  "copy_install",
  "copy_proof_bullets",
  "copy_claim",
  "click_evidence_link",
  "click_receipt_link",
  "click_submit_link",
]);

interface TelemetryEvent {
  id: string;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

function randomHex(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

function readBuffer(): TelemetryEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeBuffer(events: TelemetryEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

/**
 * Track an event. Validates type, deduplicates within 2s window, buffers to localStorage.
 */
export function trackEvent(type: string, payload: Record<string, unknown> = {}): void {
  if (!VALID_TYPES.has(type)) return;

  const events = readBuffer();
  const now = Date.now();

  // Dedupe: skip if same type+payload within 2 seconds
  const payloadStr = JSON.stringify(payload);
  const recent = events.findLast(
    (e) => e.type === type && JSON.stringify(e.payload) === payloadStr,
  );
  if (recent && now - new Date(recent.timestamp).getTime() < DEDUPE_WINDOW_MS) {
    return;
  }

  const event: TelemetryEvent = {
    id: `evt_${now}_${randomHex(6)}`,
    timestamp: new Date(now).toISOString(),
    type,
    payload,
  };

  events.push(event);

  // FIFO eviction if over max
  if (events.length > MAX_BUFFER) {
    events.splice(0, events.length - MAX_BUFFER);
  }

  writeBuffer(events);
}

/** Retrieve all buffered events. */
export function getEvents(): TelemetryEvent[] {
  return readBuffer();
}

/** Clear all buffered events. */
export function clearEvents(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // fail silently
  }
}

/** Export buffered events as JSONL string. */
export function exportEventsJsonl(): string {
  return readBuffer()
    .map((e) => JSON.stringify(e))
    .join("\n");
}
