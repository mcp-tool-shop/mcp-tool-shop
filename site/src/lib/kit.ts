/**
 * Kit configuration for Astro build-time usage.
 *
 * Reads kit.config.json from the repo root (one level above site/).
 * Import as: import { kit } from '../lib/kit';
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let raw: Record<string, any> = {};
try {
  const configPath = resolve(process.cwd(), '..', 'kit.config.json');
  raw = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
  // Fail soft — use empty defaults
}

export const kit = {
  kitVersion: (raw.kitVersion as number) ?? 1,
  org: {
    name: (raw.org?.name as string) ?? '',
    account: (raw.org?.account as string) ?? '',
    url: (raw.org?.url as string) ?? '',
  },
  site: {
    title: (raw.site?.title as string) ?? '',
    url: (raw.site?.url as string) ?? '',
    description: (raw.site?.description as string) ?? '',
  },
  repo: {
    marketing: (raw.repo?.marketing as string) ?? '',
  },
  contact: {
    email: (raw.contact?.email as string) ?? '',
  },
};
