import type { CatalogBook } from "./data";

const OPENBD_ENDPOINT = "https://api.openbd.jp/v1/get";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function recordAt(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function firstTextContent(value: unknown): string {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    const contentText = recordAt(candidate, "Text", "content") ?? recordAt(candidate, "Text") ?? recordAt(candidate, "ContentText", "content") ?? recordAt(candidate, "ContentText");
    const text = stringValue(contentText);
    if (text) return text;
  }
  return "";
}

function pageCount(value: unknown): number {
  const extent = recordAt(value, "onix", "DescriptiveDetail", "Extent");
  const candidates = Array.isArray(extent) ? extent : [extent];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const number = Number(candidate.ExtentValue);
    if (Number.isFinite(number) && number > 0) return Math.round(number);
  }
  return 0;
}

function safeCoverUrl(value: unknown): string {
  const candidate = stringValue(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeIsbn(value: string): string {
  return value.replace(/^ISBN(?:-1[03])?:?/i, "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

export function isValidIsbn(value: string): boolean {
  const isbn = normalizeIsbn(value);
  if (isbn.length === 13) {
    const digits = [...isbn].map(Number);
    if (digits.some(Number.isNaN)) return false;
    const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
    return (10 - sum % 10) % 10 === digits[12];
  }
  if (isbn.length === 10) {
    const values = [...isbn].map((char, index) => char === "X" && index === 9 ? 10 : Number(char));
    if (values.some(Number.isNaN)) return false;
    return values.reduce((total, digit, index) => total + digit * (10 - index), 0) % 11 === 0;
  }
  return false;
}

export async function fetchOpenBdBook(value: string, signal?: AbortSignal): Promise<CatalogBook> {
  const isbn = normalizeIsbn(value);
  if (!isValidIsbn(isbn)) throw new Error("ISBN-10またはISBN-13を確認してください");

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const url = new URL(OPENBD_ENDPOINT);
    url.searchParams.set("isbn", isbn);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`openBDへの接続に失敗しました（${response.status}）`);

    const payload = await response.json() as unknown;
    const source = Array.isArray(payload) ? payload[0] : null;
    if (!isRecord(source)) throw new Error("openBDに書誌情報がありませんでした");
    const summary = isRecord(source.summary) ? source.summary : {};
    const title = stringValue(summary.title);
    if (!title) throw new Error("openBDの書名を確認できませんでした");

    const synopsis = stringValue(recordAt(source, "hanmoto", "kaisetsu105w"))
      || stringValue(recordAt(source, "hanmoto", "kaisetsu"))
      || firstTextContent(recordAt(source, "onix", "CollateralDetail", "TextContent"));

    return {
      title,
      author: stringValue(summary.author) || "著者不明",
      isbn: stringValue(summary.isbn) || isbn,
      genre: "その他",
      pages: pageCount(source),
      publisher: stringValue(summary.publisher),
      coverUrl: safeCoverUrl(summary.cover),
      source: "openbd",
      synopsis,
      cover: Math.abs([...isbn].reduce((total, char) => total + char.charCodeAt(0), 0)) % 6,
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("openBDへの接続がタイムアウトしました");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
