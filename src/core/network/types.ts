// Owner: @BE | Scope: Generic network-observer shared types

import type { Response } from '@playwright/test';

/** A single captured response entry. */
export interface ResponseLog {
  url:       string;
  status:    number;
  body:      unknown;          // parsed JSON; null if parse failed or non-JSON
  raw:       Response;         // Playwright Response handle (alive during test)
  capturedAt: number;          // Date.now() at capture
}

/**
 * Bucketed capture result — one key per pattern name supplied to observeNetwork().
 * Each key maps to an array of ResponseLogs that matched that pattern.
 *
 * @example
 *   const captured: Captured<'search_graphql' | 'platforms'>
 *   captured.search_graphql[0].body  // first match for 'search_graphql'
 */
export type Captured<K extends string> = Record<K, ResponseLog[]>;
