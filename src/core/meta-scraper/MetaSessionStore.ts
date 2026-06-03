import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

// Persistent Chromium profile directory — stored in the project root (gitignored).
// Using a persistent profile means Meta sees the same "device" on every run,
// so 2FA is only required once (when the profile is first created or manually cleared).
const PROFILE_DIR = path.resolve(__dirname, '../../../meta-profile');

export class MetaSessionStore {
  /** Returns the path to the persistent browser profile directory */
  static getProfileDir(): string {
    return PROFILE_DIR;
  }

  /** Returns true if the profile directory already exists on disk */
  static hasProfile(): boolean {
    return fs.existsSync(PROFILE_DIR);
  }

  /**
   * Deletes the entire browser profile — forces a fresh login + 2FA next time.
   * Use this only when Meta has explicitly invalidated the session.
   */
  static clear(): void {
    if (fs.existsSync(PROFILE_DIR)) {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
      logger.info('Meta browser profile cleared — next run will require 2FA');
    }
  }
}
