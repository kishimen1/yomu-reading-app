import type { Book } from "./data";

export const BACKUP_STATE_STORAGE_KEY = "yomu-backup-state:v1";
export const BACKUP_REMINDER_MIN_BOOKS = 5;
export const BACKUP_REMINDER_STALE_DAYS = 30;
export const BACKUP_REMINDER_CHANGE_LIMIT = 10;
export const BACKUP_REMINDER_SNOOZE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Device-local backup bookkeeping. It is never exported so restoring a backup cannot rewind it. */
export interface BackupState {
  lastBackupAt: string;
  snapshot: Record<string, string>;
  snoozedUntil: string;
}

export type BackupReminderReason = "never" | "changes" | "stale";

export interface BackupReminder {
  reason: BackupReminderReason;
  changes: number;
  daysSinceBackup: number;
}

const EMPTY_STATE: BackupState = { lastBackupAt: "", snapshot: {}, snoozedUntil: "" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

// FNV-1a keeps the stored snapshot small while still detecting edits to a record.
function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Fingerprints only what the user wrote; cover cache fields can be fetched again. */
export function bookFingerprint(book: Book): string {
  return hashText(JSON.stringify([
    book.title, book.author, book.isbn, book.genre, book.pages, book.status,
    book.rating, book.finishedAt, book.createdAt, book.notes, book.review, book.publisher ?? "",
  ]));
}

export function createBackupSnapshot(books: Book[]): Record<string, string> {
  return Object.fromEntries(books.map(book => [book.id, bookFingerprint(book)]));
}

/** Counts added, edited and deleted books since the last backup snapshot. */
export function countChangesSinceBackup(books: Book[], snapshot: Record<string, string>): number {
  let changes = 0;
  const currentIds = new Set<string>();
  for (const book of books) {
    currentIds.add(book.id);
    if (snapshot[book.id] !== bookFingerprint(book)) changes += 1;
  }
  for (const id of Object.keys(snapshot)) {
    if (!currentIds.has(id)) changes += 1;
  }
  return changes;
}

export function daysSince(isoTimestamp: string, now = new Date()): number {
  if (!isoTimestamp) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(isoTimestamp).getTime()) / DAY_MS));
}

export function backupReminder(books: Book[], state: BackupState, now = new Date()): BackupReminder | null {
  if (books.length === 0) return null;
  if (state.snoozedUntil && new Date(state.snoozedUntil).getTime() > now.getTime()) return null;
  if (!state.lastBackupAt) {
    return books.length >= BACKUP_REMINDER_MIN_BOOKS ? { reason: "never", changes: books.length, daysSinceBackup: 0 } : null;
  }
  const changes = countChangesSinceBackup(books, state.snapshot);
  if (changes === 0) return null;
  const daysSinceBackup = daysSince(state.lastBackupAt, now);
  if (changes >= BACKUP_REMINDER_CHANGE_LIMIT) return { reason: "changes", changes, daysSinceBackup };
  if (daysSinceBackup >= BACKUP_REMINDER_STALE_DAYS) return { reason: "stale", changes, daysSinceBackup };
  return null;
}

export function normalizeBackupState(value: unknown): BackupState {
  if (!isRecord(value)) return { ...EMPTY_STATE, snapshot: {} };
  const snapshot: Record<string, string> = {};
  if (isRecord(value.snapshot)) {
    for (const [id, fingerprint] of Object.entries(value.snapshot)) {
      if (typeof fingerprint === "string") snapshot[id] = fingerprint;
    }
  }
  return {
    lastBackupAt: timestamp(value.lastBackupAt),
    snapshot,
    snoozedUntil: timestamp(value.snoozedUntil),
  };
}

export function loadBackupState(storage: Storage = localStorage): BackupState {
  try {
    const raw = storage.getItem(BACKUP_STATE_STORAGE_KEY);
    return normalizeBackupState(raw ? JSON.parse(raw) as unknown : null);
  } catch {
    return normalizeBackupState(null);
  }
}

export function saveBackupState(state: BackupState, storage: Storage = localStorage): void {
  storage.setItem(BACKUP_STATE_STORAGE_KEY, JSON.stringify(state));
}

/** Marks the given library as safely backed up at the given time. */
export function recordBackup(books: Book[], at = new Date()): BackupState {
  return { lastBackupAt: at.toISOString(), snapshot: createBackupSnapshot(books), snoozedUntil: "" };
}

export function snoozeBackupReminder(state: BackupState, now = new Date()): BackupState {
  return { ...state, snoozedUntil: new Date(now.getTime() + BACKUP_REMINDER_SNOOZE_DAYS * DAY_MS).toISOString() };
}
