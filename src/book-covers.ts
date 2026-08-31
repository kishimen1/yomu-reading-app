import type { Book, CoverSource } from "./data";
import { findOpenLibraryCoverForBook } from "./book-search";
import { fetchOpenBdBook, isValidIsbn, normalizeIsbn } from "./openbd";

export const COVER_LOOKUP_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export interface CoverLookupResult {
  lookupKey: string;
  checkedAt: string;
  coverUrl: string;
  coverSource?: CoverSource;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s\u3000]+/g, "");
}

export function coverLookupKey(book: Pick<Book, "title" | "author" | "isbn">): string {
  const isbn = normalizeIsbn(book.isbn);
  if (isValidIsbn(isbn)) return `isbn:${isbn}`;
  return `meta:${normalizedText(book.title)}\u0000${normalizedText(book.author)}`;
}

export function shouldLookupBookCover(book: Book, now = Date.now()): boolean {
  if (book.coverUrl) return false;
  const lookupKey = coverLookupKey(book);
  if (!book.coverLookupKey || book.coverLookupKey !== lookupKey || !book.coverCheckedAt) return true;
  const checkedAt = Date.parse(book.coverCheckedAt);
  return Number.isNaN(checkedAt) || now - checkedAt >= COVER_LOOKUP_TTL_MS;
}

function canDisplayCover(url: string, signal?: AbortSignal): Promise<boolean> {
  if (!/^https:\/\//i.test(url)) return Promise.resolve(false);
  return new Promise(resolve => {
    const image = new Image();
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    };
    const abort = () => finish(false);
    const timeout = window.setTimeout(() => finish(false), 6_000);
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.onload = () => finish(image.naturalWidth > 1 && image.naturalHeight > 1);
    image.onerror = () => finish(false);
    signal?.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

export async function resolveBookCover(book: Book, signal?: AbortSignal): Promise<CoverLookupResult> {
  const lookupKey = coverLookupKey(book);
  const checkedAt = new Date().toISOString();
  const isbn = normalizeIsbn(book.isbn);

  if (isValidIsbn(isbn)) {
    try {
      const openBdBook = await fetchOpenBdBook(isbn, signal);
      if (openBdBook.coverUrl && await canDisplayCover(openBdBook.coverUrl, signal)) {
        return { lookupKey, checkedAt, coverUrl: openBdBook.coverUrl, coverSource: "openbd" };
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      // openBDに未収録、または一時的に利用できない場合もOpen Libraryを試す。
    }
  }

  const openLibraryCover = await findOpenLibraryCoverForBook(book, signal);
  if (!openLibraryCover) return { lookupKey, checkedAt, coverUrl: "" };
  if (!await canDisplayCover(openLibraryCover, signal)) throw new Error("表紙画像を読み込めませんでした");
  return { lookupKey, checkedAt, coverUrl: openLibraryCover, coverSource: "openlibrary" };
}
