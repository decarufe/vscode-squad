import * as path from 'path';
import { log } from '../utils/logger';

/**
 * Suppression window (ms) during which a file-system change event for a
 * team.md written by the extension itself is ignored by the registry watcher.
 */
const INTERNAL_CHANGE_WINDOW_MS = 1000;

const pendingInternalChanges = new Map<string, NodeJS.Timeout>();

function key(teamFilePath: string): string {
  return path.normalize(teamFilePath).toLowerCase();
}

/**
 * Mark an upcoming file-system change for `teamFilePath` as extension-authored
 * so the registry watcher does not reload (and re-emit) state we already hold.
 */
export function markInternalChange(teamFilePath: string): void {
  const id = key(teamFilePath);
  const existing = pendingInternalChanges.get(id);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    pendingInternalChanges.delete(id);
  }, INTERNAL_CHANGE_WINDOW_MS);
  pendingInternalChanges.set(id, timer);
}

/**
 * Returns true (and clears the flag) when the change for `teamFilePath` was
 * authored by the extension. External edits always return false.
 */
export function consumeInternalChange(teamFilePath: string): boolean {
  const id = key(teamFilePath);
  const timer = pendingInternalChanges.get(id);
  if (!timer) {
    return false;
  }
  clearTimeout(timer);
  pendingInternalChanges.delete(id);
  log('Ignoring internal team.md change for', teamFilePath);
  return true;
}

/** Test/dispose helper — drops every pending suppression flag. */
export function clearInternalChanges(): void {
  for (const timer of pendingInternalChanges.values()) {
    clearTimeout(timer);
  }
  pendingInternalChanges.clear();
}
