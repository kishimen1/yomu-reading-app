import { isBookStatus, normalizeBook, type Book } from "./data";

export type CsvFormat = "yomu" | "biblia";

export interface CsvParseResult {
  format: CsvFormat;
  books: Book[];
  invalidRows: number;
}

export interface CsvMergeResult {
  books: Book[];
  added: number;
  duplicates: number;
}

const YOMU_HEADERS = new Set(["id", "title", "author", "isbn", "genre", "status", "rating", "pages", "finished_at", "created_at", "notes", "review"]);

function parseRows(contents: string): string[][] {
  const source = contents.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSVの引用符が閉じられていません");
  row.push(field);
  if (row.some(cell => cell.trim() !== "")) rows.push(row);
  return rows;
}

function toIsoDate(value: string): string {
  const normalized = value.trim().replaceAll("/", "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function headerMap(row: string[]): Map<string, number> {
  return new Map(row.map((header, index) => [header.trim().toLowerCase(), index]));
}

function valueAt(row: string[], headers: Map<string, number>, name: string): string {
  const index = headers.get(name);
  return index === undefined ? "" : row[index] ?? "";
}

function parseYomuRow(row: string[], headers: Map<string, number>, index: number): Book | null {
  const title = valueAt(row, headers, "title").trim();
  if (!title) return null;
  const rawStatus = valueAt(row, headers, "status");
  return normalizeBook({
    id: valueAt(row, headers, "id"),
    title,
    author: valueAt(row, headers, "author") || "著者不明",
    isbn: valueAt(row, headers, "isbn"),
    genre: valueAt(row, headers, "genre") || "その他",
    status: isBookStatus(rawStatus) ? rawStatus : "read",
    rating: valueAt(row, headers, "rating"),
    pages: valueAt(row, headers, "pages"),
    finished_at: toIsoDate(valueAt(row, headers, "finished_at")),
    created_at: toIsoDate(valueAt(row, headers, "created_at")),
    notes: valueAt(row, headers, "notes"),
    review: valueAt(row, headers, "review"),
    cover: index % 6,
  }, index);
}

function parseBibliaRow(row: string[], index: number): Book | null {
  if (row.length < 12 || !row[0]?.trim()) return null;
  const wishlist = row[12]?.trim() === "1";
  return normalizeBook({
    title: row[0],
    author: row[2] || "著者不明",
    isbn: row[5],
    genre: "その他",
    status: wishlist ? "wishlist" : "read",
    rating: row[13] ?? 0,
    pages: 0,
    finishedAt: toIsoDate(row[6] ?? ""),
    createdAt: toIsoDate(row[11] ?? ""),
    notes: row[7] ?? "",
    review: row[8] ?? "",
    cover: index % 6,
  }, index);
}

export function parseBooksCsv(contents: string): CsvParseResult {
  const rows = parseRows(contents);
  if (!rows.length) throw new Error("CSVにデータがありません");

  const possibleHeaders = rows[0].map(value => value.trim().toLowerCase());
  const matchedHeaders = possibleHeaders.filter(value => YOMU_HEADERS.has(value));
  const format: CsvFormat = matchedHeaders.includes("title") && matchedHeaders.includes("author") ? "yomu" : "biblia";
  const sourceRows = format === "yomu" ? rows.slice(1) : rows;
  const headers = format === "yomu" ? headerMap(rows[0]) : new Map<string, number>();
  const parsed = sourceRows.map((row, index) => format === "yomu"
    ? parseYomuRow(row, headers, index)
    : parseBibliaRow(row, index));

  return {
    format,
    books: parsed.filter((book): book is Book => book !== null),
    invalidRows: parsed.filter(book => book === null).length,
  };
}

function duplicateKey(book: Book): string {
  const isbn = book.isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (isbn.length >= 10) return `isbn:${isbn}`;
  const title = book.title.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s\p{P}\p{S}]+/gu, "");
  const author = book.author.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s\p{P}\p{S}]+/gu, "");
  return `book:${title}:${author}`;
}

export function hasDuplicateBook(books: Book[], candidate: Book): boolean {
  const key = duplicateKey(candidate);
  return books.some(book => duplicateKey(book) === key);
}

export function mergeImportedBooks(existing: Book[], incoming: Book[]): CsvMergeResult {
  const keys = new Set(existing.map(duplicateKey));
  const additions: Book[] = [];
  let duplicates = 0;

  for (const book of incoming) {
    const key = duplicateKey(book);
    if (keys.has(key)) {
      duplicates += 1;
      continue;
    }
    keys.add(key);
    additions.push(book);
  }

  return {
    books: [...additions, ...existing],
    added: additions.length,
    duplicates,
  };
}
