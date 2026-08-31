import type { CatalogBook } from "./data";
import { isValidIsbn, normalizeIsbn } from "./openbd";

const OPEN_LIBRARY_SEARCH_ENDPOINT = "https://openlibrary.org/search.json";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function firstValidIsbn(value: unknown): string {
  const identifiers = stringList(value).map(normalizeIsbn);
  return identifiers.find(identifier => identifier.length === 13 && isValidIsbn(identifier))
    || identifiers.find(isValidIsbn)
    || "";
}

function positiveInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function coverUrl(value: unknown): string {
  const coverId = positiveInteger(value);
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : "";
}

function coverIndex(seed: string): number {
  return Math.abs([...seed].reduce((total, char) => total + char.charCodeAt(0), 0)) % 6;
}

function toCatalogBook(value: unknown): CatalogBook | null {
  if (!isRecord(value)) return null;
  const title = stringValue(value.title);
  if (!title) return null;
  const author = stringList(value.author_name).join("、") || "著者不明";
  const isbn = firstValidIsbn(value.isbn);
  const publisher = stringList(value.publisher)[0] || "";
  const key = stringValue(value.key) || `${title}-${author}`;

  return {
    title,
    author,
    isbn,
    genre: "その他",
    pages: positiveInteger(value.number_of_pages_median),
    publisher,
    coverUrl: coverUrl(value.cover_i),
    source: "catalog",
    cover: coverIndex(isbn || key),
  };
}

export async function searchOpenLibraryBooks(searchTerm: string, signal?: AbortSignal): Promise<CatalogBook[]> {
  const term = searchTerm.trim();
  if (!term) return [];

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const url = new URL(OPEN_LIBRARY_SEARCH_ENDPOINT);
    url.searchParams.set("q", term);
    url.searchParams.set("fields", "key,title,author_name,isbn,publisher,number_of_pages_median,cover_i");
    url.searchParams.set("limit", "8");
    url.searchParams.set("lang", "ja");
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`書籍検索への接続に失敗しました（${response.status}）`);

    const payload = await response.json() as unknown;
    const docs = isRecord(payload) && Array.isArray(payload.docs) ? payload.docs : [];
    const seen = new Set<string>();
    return docs
      .map(toCatalogBook)
      .filter((book): book is CatalogBook => book !== null)
      .filter(book => {
        const key = book.isbn || `${book.title}\u0000${book.author}`.toLocaleLowerCase("ja");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("書籍検索がタイムアウトしました");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
