import { readFileSync } from 'node:fs';
import type { Provenance } from './contracts.js';

export const provenance = JSON.parse(readFileSync(new URL('../../fixtures/optimization/manifest.json', import.meta.url), 'utf8')).provenance as Provenance;
