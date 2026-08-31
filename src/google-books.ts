import { isValidIsbn, normalizeIsbn } from "./openbd";

const GOOGLE_BOOKS_DYNAMIC_LINKS_ENDPOINT = "https://books.google.com/books";
const GOOGLE_BOOKS_TIMEOUT_MS = 8_000;
const GOOGLE_BOOKS_CALLBACK_GRACE_MS = 30_000;
const GOOGLE_BOOKS_COVER_HOSTS = new Set(["books.google.com", "books.google.co.jp"]);

type UnknownRecord = Record<string, unknown>;
type GoogleBooksCallback = (payload: unknown) => void;

let callbackSequence = 0;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeCoverUrl(value: unknown): string {
  const candidate = stringValue(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:"
      && GOOGLE_BOOKS_COVER_HOSTS.has(url.hostname)
      && url.pathname === "/books/content"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function abortError(): DOMException {
  return new DOMException("Google Booksの書影検索を中止しました", "AbortError");
}

export function findGoogleBooksCoverByIsbn(value: string, signal?: AbortSignal): Promise<string> {
  const isbn = normalizeIsbn(value);
  if (!isValidIsbn(isbn)) return Promise.resolve("");
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const callbackName = `__yomuGoogleBooks_${Date.now().toString(36)}_${callbackSequence++}`;
    const callbacks = window as unknown as Record<string, GoogleBooksCallback | undefined>;
    const script = document.createElement("script");
    let settled = false;

    const cleanup = (keepLateResponseGuard = false) => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      script.onerror = null;
      script.remove();
      if (keepLateResponseGuard) {
        const ignoreLateResponse: GoogleBooksCallback = () => {};
        callbacks[callbackName] = ignoreLateResponse;
        window.setTimeout(() => {
          if (callbacks[callbackName] === ignoreLateResponse) delete callbacks[callbackName];
        }, GOOGLE_BOOKS_CALLBACK_GRACE_MS);
      } else {
        delete callbacks[callbackName];
      }
    };
    const finish = (coverUrl: string, error?: Error, keepLateResponseGuard = false) => {
      if (settled) return;
      settled = true;
      cleanup(keepLateResponseGuard);
      if (error) reject(error);
      else resolve(coverUrl);
    };
    const abort = () => finish("", abortError(), true);
    const timeout = window.setTimeout(
      () => finish("", new Error("Google Booksの書影検索がタイムアウトしました"), true),
      GOOGLE_BOOKS_TIMEOUT_MS,
    );

    callbacks[callbackName] = payload => {
      const bibKey = `ISBN:${isbn}`;
      const entry = isRecord(payload) ? payload[bibKey] : undefined;
      if (!isRecord(entry) || stringValue(entry.bib_key) !== bibKey) {
        finish("");
        return;
      }
      finish(safeCoverUrl(entry.thumbnail_url));
    };

    const url = new URL(GOOGLE_BOOKS_DYNAMIC_LINKS_ENDPOINT);
    url.searchParams.set("bibkeys", `ISBN:${isbn}`);
    url.searchParams.set("jscmd", "viewapi");
    url.searchParams.set("callback", callbackName);
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.onerror = () => finish("", new Error("Google Booksの書影検索に接続できませんでした"));
    script.src = url.href;
    signal?.addEventListener("abort", abort, { once: true });
    document.head.append(script);
  });
}
