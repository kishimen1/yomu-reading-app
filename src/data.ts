export const LIBRARY_SCHEMA_VERSION = 2;
export const LIBRARY_STORAGE_KEY = "yomu-reading-archive:v2";
export const SETTINGS_STORAGE_KEY = "yomu-settings:v2";

const LEGACY_LIBRARY_KEYS = ["yomu-reading-archive:v1"];
const LEGACY_SETTINGS_KEYS = ["yomu-settings:v1"];
const LEGACY_DEMO_CLEANUP_KEY = "yomu-demo-library-cleanup:v1";
const BOOK_STATUSES = ["read", "reading", "wishlist"] as const;
const THEME_PREFERENCES = ["system", "light", "dark"] as const;

const LEGACY_DEMO_BOOKS = new Map([
  ["b01", "灯りのない窓辺"],
  ["b02", "葉脈から読む世界"],
  ["b03", "小さな組織の設計図"],
  ["b04", "青の列島史"],
  ["b05", "他者を想像する"],
  ["b06", "海岸線をゆく列車"],
  ["b07", "夜の標本室"],
  ["b08", "森のネットワーク"],
  ["b09", "余白の経営"],
  ["b10", "水路と都市の記憶"],
  ["b11", "静かな対話の技術"],
  ["b12", "島々の朝食"],
  ["b13", "透明な時間"],
  ["b14", "都市の昆虫地図"],
  ["b15", "文化をつくる会議"],
  ["b16", "近代港湾の歩き方"],
  ["b17", "選択の心理学"],
  ["b18", "北緯35度の旅"],
]);

export type BookStatus = typeof BOOK_STATUSES[number];
export type ThemePreference = typeof THEME_PREFERENCES[number];
export type CoverSource = "openbd" | "googlebooks" | "openlibrary";

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn: string;
  genre: string;
  pages: number;
  status: BookStatus;
  rating: number;
  finishedAt: string;
  createdAt: string;
  notes: string;
  review: string;
  cover: number;
  publisher?: string;
  coverUrl?: string;
  coverSource?: CoverSource;
  coverLookupKey?: string;
  coverCheckedAt?: string;
  source?: "manual" | "catalog" | "openbd" | "import";
}

export type CatalogBook = Pick<Book, "title" | "author" | "isbn" | "genre" | "pages" | "cover"> & Pick<Book, "publisher" | "coverUrl" | "coverSource" | "source"> & { synopsis?: string };

export interface Settings {
  theme: ThemePreference;
  goal: number;
  synopsis: boolean;
}

export interface BackupData {
  schemaVersion: number;
  exportedAt: string;
  settings: Settings;
  books: Book[];
}

interface LibraryEnvelope {
  schemaVersion: number;
  books: Book[];
}

type UnknownRecord = Record<string, unknown>;

const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  goal: 18,
  synopsis: true,
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = "", maxLength = 50_000): string {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  return String(value).slice(0, maxLength);
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function isoDate(value: unknown, fallback = ""): string {
  const candidate = text(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
  const date = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate ? fallback : candidate;
}

function isoTimestamp(value: unknown): string {
  const candidate = text(value, "", 100).trim();
  if (!candidate) return "";
  const timestamp = new Date(candidate);
  return Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString();
}

export function isBookStatus(value: unknown): value is BookStatus {
  return BOOK_STATUSES.includes(value as BookStatus);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function todayIso(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function normalizeBook(value: unknown, index = 0, today = todayIso()): Book | null {
  if (!isRecord(value)) return null;
  const status = isBookStatus(value.status) ? value.status : "read";
  const title = text(value.title, "無題", 500).trim() || "無題";
  const author = text(value.author, "著者不明", 300).trim() || "著者不明";
  const finishedAt = isoDate(value.finishedAt ?? value.finished_at);

  const coverUrlCandidate = text(value.coverUrl, "", 2_000).trim();
  const coverUrl = /^https:\/\//i.test(coverUrlCandidate) ? coverUrlCandidate : "";
  const coverSource = coverUrl && (value.coverSource === "openbd" || value.coverSource === "googlebooks" || value.coverSource === "openlibrary") ? value.coverSource : undefined;
  const source = value.source === "openbd" || value.source === "catalog" || value.source === "import" ? value.source : "manual";

  return {
    id: text(value.id, crypto.randomUUID(), 200).trim() || crypto.randomUUID(),
    title,
    author,
    isbn: text(value.isbn, "", 30).replace(/[^0-9Xx-]/g, ""),
    genre: text(value.genre, "その他", 100).trim() || "その他",
    pages: boundedInteger(value.pages, 0, 100_000, 0),
    status,
    rating: boundedInteger(value.rating, 0, 5, 0),
    finishedAt: status === "read" ? finishedAt : "",
    createdAt: isoDate(value.createdAt ?? value.created_at, today),
    notes: text(value.notes),
    review: text(value.review),
    cover: boundedInteger(value.cover, 0, 5, index % 6),
    publisher: text(value.publisher, "", 300).trim(),
    coverUrl,
    coverSource,
    coverLookupKey: text(value.coverLookupKey, "", 1_000).trim() || undefined,
    coverCheckedAt: isoTimestamp(value.coverCheckedAt) || undefined,
    source,
  };
}

export function normalizeSettings(value: unknown): Settings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  return {
    theme: isThemePreference(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    goal: boundedInteger(value.goal, 1, 999, DEFAULT_SETTINGS.goal),
    synopsis: typeof value.synopsis === "boolean" ? value.synopsis : DEFAULT_SETTINGS.synopsis,
  };
}

function migrateLibrary(value: unknown): LibraryEnvelope {
  const schemaVersion = isRecord(value) ? boundedInteger(value.schemaVersion, 1, Number.MAX_SAFE_INTEGER, 1) : 1;
  if (schemaVersion > LIBRARY_SCHEMA_VERSION) {
    throw new Error(`Unsupported library schema version: ${schemaVersion}`);
  }

  const candidates = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.books) ? value.books : null;
  if (!candidates) throw new Error("Library data does not contain a books array");

  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    books: candidates.map((book, index) => normalizeBook(book, index)).filter((book): book is Book => book !== null),
  };
}

function removeLegacyDemoBooks(books: Book[], storage: Storage): Book[] {
  if (storage.getItem(LEGACY_DEMO_CLEANUP_KEY)) return books;
  const cleaned = books.filter(book => LEGACY_DEMO_BOOKS.get(book.id) !== book.title);
  storage.setItem(LEGACY_DEMO_CLEANUP_KEY, "1");
  return cleaned;
}

export function loadBooks(storage: Storage = localStorage): Book[] {
  for (const key of [LIBRARY_STORAGE_KEY, ...LEGACY_LIBRARY_KEYS]) {
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const envelope = migrateLibrary(JSON.parse(raw) as unknown);
      const books = removeLegacyDemoBooks(envelope.books, storage);
      saveBooks(books, storage);
      return books;
    } catch {
      // Keep trying older keys without deleting the unreadable source data.
    }
  }

  const books: Book[] = [];
  storage.setItem(LEGACY_DEMO_CLEANUP_KEY, "1");
  saveBooks(books, storage);
  return books;
}

export function saveBooks(books: Book[], storage: Storage = localStorage): void {
  const envelope: LibraryEnvelope = {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    books,
  };
  storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(envelope));
}

export function loadSettings(storage: Storage = localStorage): Settings {
  for (const key of [SETTINGS_STORAGE_KEY, ...LEGACY_SETTINGS_KEYS]) {
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const settings = normalizeSettings(JSON.parse(raw) as unknown);
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      return settings;
    } catch {
      // Keep the unreadable source value and continue with safe defaults.
    }
  }
  saveSettings(DEFAULT_SETTINGS, storage);
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings, storage: Storage = localStorage): void {
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
}

export function createBackup(books: Book[], settings: Settings): BackupData {
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: normalizeSettings(settings),
    books: books.map((book, index) => normalizeBook(book, index)).filter((book): book is Book => book !== null),
  };
}

export function parseBackup(value: unknown): { books: Book[]; settings: Settings | null } {
  const envelope = migrateLibrary(value);
  const settings = isRecord(value) && "settings" in value ? normalizeSettings(value.settings) : null;
  return { books: envelope.books, settings };
}
