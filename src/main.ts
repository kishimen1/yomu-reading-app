import "./styles.css";
import {
  createBackup,
  isBookStatus,
  isThemePreference,
  loadBooks,
  loadSettings,
  normalizeBook,
  parseBackup,
  saveBooks,
  saveSettings,
  todayIso,
  type Book,
  type BookStatus,
  type CatalogBook,
  type ThemePreference,
} from "./data";
import { hasDuplicateBook, mergeImportedBooks, parseBooksCsv } from "./csv";
import { fetchOpenBdBook, isValidIsbn, normalizeIsbn } from "./openbd";
import { searchOpenLibraryBooks } from "./book-search";
import { coverLookupKey, resolveBookCover, shouldLookupBookCover } from "./book-covers";
import { findGoogleBooksCoverByIsbn } from "./google-books";
import { backupReminder, countChangesSinceBackup, daysSince, loadBackupState, recordBackup, saveBackupState, snoozeBackupReminder, BACKUP_REMINDER_SNOOZE_DAYS, type BackupState } from "./backup-state";

import { createNavigation } from "./navigation";
import { isShelfFilter, loadShelfPreferences, saveShelfPreferences, selectShelfBooks, type ShelfFilter, type ShelfView, type ShelfSort, type ShelfCriteria, type ShelfState } from "./shelf-state";
type ScreenName = "shelf" | "analytics" | "settings";
type AddMode = "search" | "manual";
type ManualStage = "search" | "confirm";

interface AppRoute {
  screen: ScreenName;
  layer: "none" | "detail" | "edit" | "add" | "confirm" | "filter";
  bookId?: string;
  shelf: ShelfState;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new(options?: { formats?: string[] }): BarcodeDetectorInstance;
}

declare global {
  interface Window {
    lucide?: {
      createIcons(options?: { attrs?: Record<string, string | number> }): void;
    };
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

const COVER_POSITIONS = ["0% 0%", "50% 0%", "100% 0%", "0% 100%", "50% 100%", "100% 100%"]; 
const GENRE_COLORS = ["#256b54", "#e4513b", "#456a82", "#c3912f", "#7b657f", "#88908b"];
const COVER_LOOKUP_SESSION_LIMIT = 50;
const COVER_LOOKUP_DELAY_MS = 650;
let visibleCatalogBooks: CatalogBook[] = [];
let visibleManualSearchBooks: CatalogBook[] = [];
let selectedManualCatalogBook: CatalogBook | null = null;
let books = loadBooks();
let settings = loadSettings();
const shelfPreferences = loadShelfPreferences();
let activeFilter: ShelfFilter = shelfPreferences.filter;
let activeView: ShelfView = shelfPreferences.view;
let query = "";
let shelfCriteria: ShelfCriteria = { genre: "", rating: "", finishedPeriod: "" };
let filterDraft: ShelfCriteria = { ...shelfCriteria };
let navigation: ReturnType<typeof createNavigation<AppRoute>>;
let currentRoute: AppRoute;
let applyingRoute = false;
let lockedScroll: number | null = null;
const screenScroll: Record<ScreenName, number> = { shelf: 0, analytics: 0, settings: 0 };
let detailBaseline = "";
let addBaseline = "";
let addReturnMode: AddMode = "search";
let currentAddMode: AddMode = "search";
let directEntry = false;
let detailNotice = "";
let scannerGeneration = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let backupState: BackupState = loadBackupState();
type StorageProtection = "unknown" | "persisted" | "not-persisted" | "unsupported";
let storageProtection: StorageProtection = "unknown";
let storagePersistRequested = false;
let catalogSearchTimer: ReturnType<typeof setTimeout> | null = null;
let catalogRequest: AbortController | null = null;
let manualSearchRequest: AbortController | null = null;
let scannerStream: MediaStream | null = null;
let scannerTimer: ReturnType<typeof setInterval> | null = null;
let scannerDetectionBusy = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installCompletedThisSession = false;
let coverLookupTimer: ReturnType<typeof setTimeout> | null = null;
let coverLookupRunning = false;
let coverLookupSessionAttempts = 0;
const coverLookupAttempted = new Set<string>();
const priorityCoverLookups = new Set<string>();

function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function persist() {
  saveBooks(books);
  saveSettings(settings);
}

function escapeHtml(value: unknown = ""): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" };
  return String(value).replace(/[&<>'"]/g, char => entities[char] ?? char);
}

function formatDate(dateString: string): string {
  if (!dateString) return "日付なし";
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function statusLabel(status: ShelfFilter): string {
  return { all: "すべて", read: "読了", reading: "読書中", wishlist: "読みたい" }[status];
}

function iconize() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function showToast(message: string) {
  const feedback = document.querySelector<HTMLElement>("dialog[open] .inline-feedback");
  if (feedback) {
    feedback.textContent = message;
    feedback.hidden = false;
  }
  const toast = $("#toast");
  $("span", toast).textContent = message;
  toast.classList.add("is-visible");
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function coverImageMarkup(book: Pick<Book, "id" | "title" | "coverUrl">, lazy = false): string {
  if (!book.coverUrl) return "";
  return `<img class="real-cover-image" src="${escapeHtml(book.coverUrl)}" alt="${escapeHtml(`『${book.title}』の表紙`)}" ${lazy ? 'loading="lazy"' : ""} decoding="async" referrerpolicy="no-referrer" data-cover-image data-cover-book-id="${escapeHtml(book.id)}">`;
}

function catalogCoverImageMarkup(book: CatalogBook): string {
  if (!book.coverUrl) return "";
  return `<img class="real-cover-image" src="${escapeHtml(book.coverUrl)}" alt="${escapeHtml(`『${book.title}』の表紙`)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover-image>`;
}

function coverAttemptKey(book: Book): string {
  return `${book.id}\u0000${coverLookupKey(book)}`;
}

function hasRenderableCover(book: Pick<Book, "coverUrl">): boolean {
  return Boolean(book.coverUrl);
}

function coverSourceMarkup(book: Book): string {
  if (book.coverSource === "openbd") return '<span>書影: <a href="https://openbd.jp/" target="_blank" rel="noopener noreferrer">openBD</a></span>';
  if (book.coverSource === "googlebooks") {
    const link = isValidIsbn(book.isbn) ? `https://books.google.com/books?vid=ISBN${normalizeIsbn(book.isbn)}` : "https://books.google.com/";
    return `<span>書影: <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Google Books</a></span>`;
  }
  if (book.coverSource === "openlibrary") {
    const link = isValidIsbn(book.isbn) ? `https://openlibrary.org/isbn/${normalizeIsbn(book.isbn)}` : "https://openlibrary.org/";
    return `<span>書影: <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open Library</a></span>`;
  }
  return "<span>表紙画像なし</span>";
}

function updateDetailCover(book: Book) {
  const form = document.querySelector<HTMLFormElement>(`#detail-content [data-record-id="${CSS.escape(book.id)}"]`);
  if (!form) return;
  const visual = form.querySelector<HTMLElement>("#detail-cover-visual");
  const source = form.querySelector<HTMLElement>("#detail-cover-source");
  if (visual) {
    visual.classList.toggle("has-real-cover", hasRenderableCover(book));
    visual.innerHTML = coverImageMarkup(book);
  }
  if (source) source.innerHTML = coverSourceMarkup(book);
}

function applyCoverResult(book: Book, result: Awaited<ReturnType<typeof resolveBookCover>>): boolean {
  book.coverLookupKey = result.lookupKey;
  book.coverCheckedAt = result.checkedAt;
  if (!result.coverUrl) return false;
  book.coverUrl = result.coverUrl;
  book.coverSource = result.coverSource;
  return true;
}

async function lookupBookCover(bookId: string, force = false): Promise<"found" | "missing" | "error"> {
  const book = books.find(item => item.id === bookId);
  if (!book || (!force && !shouldLookupBookCover(book)) || !navigator.onLine) return "missing";
  const lookupKey = coverLookupKey(book);
  const attemptKey = coverAttemptKey(book);
  coverLookupAttempted.add(attemptKey);

  try {
    const result = await resolveBookCover(book);
    const current = books.find(item => item.id === bookId);
    if (!current || coverLookupKey(current) !== lookupKey) return "missing";
    const found = applyCoverResult(current, result);
    persist();
    if (found) {
      renderBooks();
      updateDetailCover(current);
      return "found";
    }
    return "missing";
  } catch {
    return "error";
  }
}

function scheduleCoverBackfill(delay = 0) {
  if (coverLookupTimer !== null) return;
  coverLookupTimer = setTimeout(() => {
    coverLookupTimer = null;
    void runCoverBackfill();
  }, delay);
}

function queuePriorityCoverLookup(bookId: string) {
  const book = books.find(item => item.id === bookId);
  if (!book || book.coverUrl) return;
  priorityCoverLookups.add(bookId);
  coverLookupAttempted.delete(coverAttemptKey(book));
  scheduleCoverBackfill();
}

async function runCoverBackfill() {
  if (coverLookupRunning || !navigator.onLine) return;
  coverLookupRunning = true;
  try {
    while (navigator.onLine) {
      const priorityId = priorityCoverLookups.values().next().value as string | undefined;
      const candidate = priorityId
        ? books.find(book => book.id === priorityId)
        : books.find(book => shouldLookupBookCover(book) && !coverLookupAttempted.has(coverAttemptKey(book)));
      if (priorityId && !candidate) {
        priorityCoverLookups.delete(priorityId);
        continue;
      }
      if (!candidate) break;
      if (!priorityId && coverLookupSessionAttempts >= COVER_LOOKUP_SESSION_LIMIT) break;
      priorityCoverLookups.delete(candidate.id);
      coverLookupSessionAttempts += 1;
      await lookupBookCover(candidate.id);
      await new Promise(resolve => window.setTimeout(resolve, COVER_LOOKUP_DELAY_MS));
    }
  } finally {
    coverLookupRunning = false;
    if (priorityCoverLookups.size > 0 && navigator.onLine) scheduleCoverBackfill();
  }
}

async function refreshBookCover(bookId: string, button: HTMLButtonElement) {
  if (!navigator.onLine) {
    showToast("通信できるときに表紙を再取得できます");
    return;
  }
  const book = books.find(item => item.id === bookId);
  if (!book) return;
  button.disabled = true;
  button.classList.add("is-loading");
  const result = await lookupBookCover(bookId, true);
  button.disabled = false;
  button.classList.remove("is-loading");
  iconize();
  showToast(result === "found" ? "表紙画像を更新しました" : result === "missing" ? "一致する表紙画像が見つかりませんでした" : "表紙画像を取得できませんでした");
}

function handleCoverImageError(image: HTMLImageElement) {
  image.hidden = true;
  image.closest(".has-real-cover")?.classList.remove("has-real-cover");
  const bookId = image.dataset.coverBookId;
  const form = bookId ? document.querySelector<HTMLFormElement>(`#detail-content [data-record-id="${CSS.escape(bookId)}"]`) : null;
  const source = form?.querySelector<HTMLElement>("#detail-cover-source");
  if (source) source.textContent = "表紙画像を読み込めませんでした";
}

function isInstalled(): boolean {
  return installCompletedThisSession || window.matchMedia("(display-mode: standalone)").matches;
}

function updateInstallUI() {
  const button = $<HTMLButtonElement>("#install-app");
  const title = $("#install-title");
  const status = $("#install-status");
  if (isInstalled()) {
    title.textContent = "インストール済みです";
    status.textContent = "ホーム画面またはアプリ一覧からYOMUを起動できます。";
    button.disabled = true;
    button.innerHTML = '<i data-lucide="check"></i><span>インストール済み</span>';
  } else if (deferredInstallPrompt) {
    title.textContent = "YOMUをインストール";
    status.textContent = "このブラウザーからすぐにインストールできます。";
    button.disabled = false;
  } else {
    title.textContent = "YOMUをホーム画面へ";
    status.textContent = "Android版Chromeのメニューから「ホーム画面に追加」も選べます。";
    button.disabled = false;
  }
  iconize();
}

function initializeInstallExperience() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    updateInstallUI();
  });
  window.addEventListener("appinstalled", () => {
    installCompletedThisSession = true;
    deferredInstallPrompt = null;
    updateInstallUI();
    showToast("YOMUをインストールしました");
  });
  $("#install-app").addEventListener("click", async () => {
    if (isInstalled()) return;
    if (!deferredInstallPrompt) {
      showToast("Chromeのメニューから「ホーム画面に追加」を選んでください");
      return;
    }
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") showToast("インストールを開始しました");
    } catch {
      showToast("ブラウザーのメニューからインストールしてください");
    }
    updateInstallUI();
  });
  updateInstallUI();
}

function finishedPeriodLabel(period: string): string {
  if (/^\d{4}$/.test(period)) return `${period}年`;
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split("-");
    return `${year}年${Number(month)}月`;
  }
  const recurringMonth = period.match(/^\*-(\d{2})$/)?.[1];
  return recurringMonth ? `全期間の${Number(recurringMonth)}月` : period;
}

function shelfCriteriaCount(): number {
  return [shelfCriteria.genre, shelfCriteria.rating, shelfCriteria.finishedPeriod].filter(value => value !== "").length;
}

function getShelfState(): ShelfState {
  return { filter: activeFilter, view: activeView, sort: $<HTMLSelectElement>("#sort-books").value as ShelfSort, query, criteria: { ...shelfCriteria } };
}

function renderShelfFilterControls() {
  const chips: Array<{ key: string; label: string }> = [];
  if (query.trim()) chips.push({ key: "query", label: `検索: ${query.trim()}` });
  if (shelfCriteria.genre) chips.push({ key: "genre", label: shelfCriteria.genre });
  if (shelfCriteria.rating !== "") chips.push({ key: "rating", label: shelfCriteria.rating === "0" ? "未評価" : `評価 ${shelfCriteria.rating}` });
  if (shelfCriteria.finishedPeriod) chips.push({ key: "finishedPeriod", label: finishedPeriodLabel(shelfCriteria.finishedPeriod) });
  $("#active-filter-chips").innerHTML = chips.map(chip => `<button type="button" data-clear-shelf-filter="${chip.key}" aria-label="${escapeHtml(chip.label)}の条件を解除"><span>${escapeHtml(chip.label)}</span><i data-lucide="x"></i></button>`).join("");
  $("#active-filter-bar").hidden = chips.length === 0;
  const count = shelfCriteriaCount();
  $("#filter-count").textContent = String(count);
  $("#filter-count").hidden = count === 0;
  iconize();
}

function renderFilterDraft() {
  const genres = [...new Set(books.map(book => book.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  $<HTMLSelectElement>("#filter-genre").innerHTML = `<option value="">すべて</option>${genres.map(genre => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join("")}`;
  $<HTMLSelectElement>("#filter-genre").value = filterDraft.genre;
  $<HTMLSelectElement>("#filter-rating").value = filterDraft.rating;
  $<HTMLInputElement>("#filter-month").value = /^\d{4}-\d{2}$/.test(filterDraft.finishedPeriod) ? filterDraft.finishedPeriod : "";
  const periodHint = $("#filter-period-hint");
  periodHint.hidden = !filterDraft.finishedPeriod || /^\d{4}-\d{2}$/.test(filterDraft.finishedPeriod);
  periodHint.textContent = periodHint.hidden ? "" : `現在の条件: ${finishedPeriodLabel(filterDraft.finishedPeriod)}。月を選ぶと変更できます。`;
  const count = selectShelfBooks(books, { ...getShelfState(), criteria: filterDraft }).length;
  $("#apply-filters").textContent = `${count}冊を表示`;
}

function renderBooks() {
  const state = getShelfState();
  const filtered = selectShelfBooks(books, state);
  saveShelfPreferences({ filter: activeFilter, view: activeView, sort: state.sort });
  if (navigation && !applyingRoute && currentRoute.screen === "shelf") {
    currentRoute = { ...currentRoute, shelf: state };
    navigation.update(currentRoute);
  }
  $$(".shelf-tab").forEach(tab => {
    const selected = tab.dataset.filter === activeFilter;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.setAttribute("tabindex", selected ? "0" : "-1");
  });
  $$("[data-view]").forEach(button => {
    button.classList.toggle("is-active", button.dataset.view === activeView);
    button.setAttribute("aria-pressed", String(button.dataset.view === activeView));
  });
  const grid = $("#book-grid");
  grid.classList.toggle("is-list", activeView === "list");
  grid.innerHTML = filtered.map(book => `
    <article class="book-card">
      <button class="book-card-button" type="button" data-book-id="${escapeHtml(book.id)}" aria-label="${escapeHtml(book.title)}の詳細を開く">
        <span class="book-cover${hasRenderableCover(book) ? " has-real-cover" : ""}" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}">
          ${coverImageMarkup(book, true)}
          <span class="cover-copy"><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}</small></span>
        </span>
        <span class="book-meta">
          <span class="book-title">${escapeHtml(book.title)}</span><span class="book-author">${escapeHtml(book.author)}</span>
          <span class="book-meta-footer"><span class="rating" aria-label="${book.rating ? `評価${book.rating}` : "未評価"}">${book.rating ? `★ ${book.rating}` : "未評価"}</span><span class="status-badge">${statusLabel(book.status)}</span></span>
          ${book.status === "read" ? `<span class="book-date">${formatDate(book.finishedAt)}</span>` : ""}
          ${book.review.trim() ? `<span class="book-excerpt">${escapeHtml(book.review)}</span>` : ""}
        </span>
      </button>
    </article>`).join("");
  grid.hidden = filtered.length === 0;
  $("#all-count").textContent = String(books.length);
  $("#read-count").textContent = String(books.filter(book => book.status === "read").length);
  $("#reading-count").textContent = String(books.filter(book => book.status === "reading").length);
  $("#wishlist-count").textContent = String(books.filter(book => book.status === "wishlist").length);
  $("#shelf-result-count").textContent = `${filtered.length}冊`;
  $("#shelf-pulse").hidden = books.length === 0;
  renderEmptyState(filtered.length);
  renderShelfFilterControls();
}

function renderEmptyState(resultCount: number) {
  const empty = $("#empty-state");
  empty.hidden = resultCount > 0;
  if (resultCount > 0) return;
  const hasQuery = query.trim().length > 0 || shelfCriteriaCount() > 0;
  const first = books.length === 0;
  empty.classList.toggle("is-first-book", first);
  $("#empty-clear-search").hidden = !hasQuery;
  $("#empty-search-all").hidden = first || !hasQuery || (activeFilter === "all" && shelfCriteriaCount() === 0);
  $("#empty-add-isbn").hidden = !first && hasQuery;
  $("#empty-add-manual").hidden = !first && hasQuery;
  $("#empty-title").textContent = first ? "最初の一冊から、あなたの本棚へ" : hasQuery ? "条件に合う本がありません" : `${statusLabel(activeFilter)}の本はまだありません`;
  $("#empty-copy").textContent = first ? "バーコードや書名から、本を追加できます。記録はこの端末に保存されます。" : hasQuery ? "検索する言葉を変えるか、絞り込みを解除してみてください。" : "別の本棚へ切り替えるか、新しい本を追加してください。";
}

function syncAnalyticsYearOptions() {
  const select = $<HTMLSelectElement>("#analytics-year");
  const currentYear = new Date().getFullYear();
  const previousValue = select.value || String(currentYear);
  const years = new Set<number>([currentYear]);
  books.forEach(book => {
    const year = Number(book.finishedAt.slice(0, 4));
    if (book.status === "read" && Number.isInteger(year) && year >= 1000) years.add(year);
  });
  const sortedYears = [...years].sort((a, b) => b - a);
  select.innerHTML = `${sortedYears.map(year => `<option value="${year}">${year}年</option>`).join("")}<option value="all">すべて</option>`;
  select.value = previousValue === "all" || years.has(Number(previousValue)) ? previousValue : String(currentYear);
}

function renderReadingPulse(allReadBooks: Book[], now: Date) {
  const month = todayIso(now).slice(0, 7);
  $("#month-count").textContent = `${allReadBooks.filter(book => book.finishedAt.startsWith(month)).length}冊`;
}

function renderAnalytics() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const selectedValue = $<HTMLSelectElement>("#analytics-year").value;
  const selectedYear = selectedValue === "all" ? null : Number(selectedValue);
  const allReadBooks = books.filter(book => book.status === "read" && /^\d{4}-\d{2}-\d{2}$/.test(book.finishedAt));
  const readBooks = selectedYear === null
    ? allReadBooks
    : allReadBooks.filter(book => Number(book.finishedAt.slice(0, 4)) === selectedYear);
  const totalPages = readBooks.reduce((sum, book) => sum + Number(book.pages || 0), 0);
  const rated = readBooks.filter(book => book.rating > 0);
  const averageRating = rated.length ? rated.reduce((sum, book) => sum + book.rating, 0) / rated.length : 0;
  const uniqueAuthors = new Set(readBooks.map(book => book.author)).size;
  const earliest = [...readBooks].sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))[0]?.finishedAt;
  const allYearsMonths = earliest
    ? Math.max(1, (now.getFullYear() - Number(earliest.slice(0, 4))) * 12 + now.getMonth() - (Number(earliest.slice(5, 7)) - 1) + 1)
    : 1;
  const monthsElapsed = selectedYear === null ? allYearsMonths : selectedYear === currentYear ? currentMonth : 12;
  const monthly = Array.from({ length: 12 }, (_, month) => readBooks.filter(book => Number(book.finishedAt.slice(5, 7)) === month + 1).length);
  const currentYearBooks = allReadBooks.filter(book => Number(book.finishedAt.slice(0, 4)) === currentYear);

  $("#analytics-total").textContent = String(readBooks.length);
  $("#sidebar-year-label").textContent = `${currentYear}年の記録`;
  $("#sidebar-year-count").textContent = `${currentYearBooks.length}冊`;
  $("#kpi-pages").textContent = totalPages.toLocaleString("ja-JP");
  $("#kpi-rating").textContent = averageRating.toFixed(1);
  $("#kpi-monthly").textContent = (readBooks.length / monthsElapsed).toFixed(1);
  $("#kpi-authors").textContent = String(uniqueAuthors);
  renderReadingPulse(allReadBooks, now);

  const comparison = $("#analytics-comparison");
  if (selectedYear === null) {
    comparison.innerHTML = `<i data-lucide="library-big"></i> 全期間の読了記録`;
  } else if (!readBooks.length) {
    comparison.innerHTML = `<i data-lucide="book-open"></i> 読了日を入れた本が集計されます`;
  } else {
    const throughMonth = selectedYear === currentYear ? currentMonth : 12;
    const previousYearCount = allReadBooks.filter(book => Number(book.finishedAt.slice(0, 4)) === selectedYear - 1 && Number(book.finishedAt.slice(5, 7)) <= throughMonth).length;
    const difference = readBooks.length - previousYearCount;
    const icon = difference > 0 ? "trending-up" : difference < 0 ? "trending-down" : "minus";
    comparison.innerHTML = previousYearCount
      ? `<i data-lucide="${icon}"></i> 前年同期より <strong>${Math.abs(difference)}冊</strong> ${difference > 0 ? "多い" : difference < 0 ? "少ない" : "同じ"}`
      : `<i data-lucide="bookmark-check"></i> ${selectedYear}年の読了記録`;
  }

  const genreCounts = readBooks.reduce<Record<string, number>>((acc, book) => {
    acc[book.genre] = (acc[book.genre] || 0) + 1;
    return acc;
  }, {});
  const genres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
  let cursor = 0;
  const stops = genres.map(([_, count], index) => {
    const start = cursor;
    cursor += readBooks.length ? count / readBooks.length * 100 : 0;
    return `${GENRE_COLORS[index % GENRE_COLORS.length]} ${start}% ${cursor}%`;
  }).join(", ");
  $("#genre-donut").style.background = `conic-gradient(${stops || "#d7ddd8 0 100%"})`;
  $("#genre-donut").innerHTML = `<div><strong>${genres.length}</strong><span>ジャンル</span></div>`;
  $("#genre-legend").innerHTML = genres.length
    ? genres.map(([genre, count], index) => `
      <button class="legend-row" type="button" data-analytics-genre="${escapeHtml(genre)}" data-analytics-period="${selectedYear ?? ""}" aria-label="${escapeHtml(genre)}の本を本棚で見る"><i style="background:${GENRE_COLORS[index % GENRE_COLORS.length]}"></i><span>${escapeHtml(genre)}</span><strong>${Math.round(count / readBooks.length * 100)}%</strong><i data-lucide="arrow-up-right"></i></button>`).join("")
    : `<p class="analytics-empty">読了記録が増えると、ジャンルの割合が表示されます。</p>`;

  $("#analytics-summary").textContent = !readBooks.length
    ? "本を読み終えたら、読了日を記録してみましょう。"
    : genres.length === 1
      ? `「${genres[0][0]}」が、この期間の読書を形づくっています。`
      : `「${genres[0][0]}」と「${genres[1][0]}」が、この期間の読書を形づくっています。`;

  const maxMonth = Math.max(...monthly, 1);
  $("#month-chart").setAttribute("aria-label", `${selectedYear ?? "全期間"}の月別読了冊数`);
  $("#month-chart").innerHTML = monthly.map((count, index) => `
    <button class="month-bar ${selectedYear === currentYear && index === currentMonth - 1 ? "current" : ""}" type="button" data-analytics-month="${selectedYear === null ? `*-${String(index + 1).padStart(2, "0")}` : `${selectedYear}-${String(index + 1).padStart(2, "0")}`}" aria-label="${selectedYear ?? "全期間"}の${index + 1}月に読了した本 ${count}冊"><strong>${count || ""}</strong><i style="--height:${Math.max(count / maxMonth * 82, count ? 20 : 3)}%"></i><span>${index + 1}月</span></button>`).join("");
  $("#trend-signal").innerHTML = readBooks.length
    ? `<i data-lucide="activity"></i> ${readBooks.length}冊を集計`
    : `<i data-lucide="minus"></i> 記録なし`;

  const ratingCounts = [5, 4, 3, 2, 1].map(rating => ({ rating, count: rated.filter(book => book.rating === rating).length }));
  const maxRating = Math.max(...ratingCounts.map(item => item.count), 1);
  $("#rating-bars").innerHTML = ratingCounts.map(item => `
    <button class="rating-row" type="button" data-analytics-rating="${item.rating}" data-analytics-period="${selectedYear ?? ""}" aria-label="評価${item.rating}の本を本棚で見る"><strong>${item.rating}.0</strong><div class="rating-track"><i style="width:${item.count / maxRating * 100}%"></i></div><span>${item.count}</span><i data-lucide="arrow-up-right"></i></button>`).join("");

  const insightTitle = $("#insight-title");
  const insightCopy = $("#insight-copy");
  const insightButton = $("#show-insight-books");
  if (!readBooks.length) {
    insightTitle.textContent = "記録から見えてくること";
    insightCopy.textContent = "読了記録が増えると、よく読むジャンルや満足度の高い領域が見えてきます。";
    insightButton.dataset.insightGenre = "";
    insightButton.dataset.insightPeriod = "";
    insightButton.innerHTML = `最初の本を追加する <i data-lucide="arrow-right"></i>`;
  } else {
    const ratedByGenre = new Map<string, number[]>();
    rated.forEach(book => ratedByGenre.set(book.genre, [...(ratedByGenre.get(book.genre) || []), book.rating]));
    const highestRated = [...ratedByGenre.entries()]
      .map(([genre, ratings]) => ({ genre, average: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length }))
      .sort((a, b) => b.average - a.average)[0];
    const insightGenre = highestRated?.genre || genres[0]?.[0] || "その他";
    insightTitle.textContent = highestRated ? "満足度の高いジャンル" : "よく読むジャンル";
    insightCopy.innerHTML = highestRated
      ? `「${escapeHtml(insightGenre)}」の平均評価は <strong>${highestRated.average.toFixed(1)}</strong>。この期間で満足度の高い領域です。`
      : `「${escapeHtml(insightGenre)}」を最も多く読んでいます。評価を付けると、満足度も比較できます。`;
    insightButton.dataset.insightGenre = insightGenre;
    insightButton.dataset.insightPeriod = selectedYear === null ? "" : String(selectedYear);
    insightButton.innerHTML = `該当する本を見る <i data-lucide="arrow-right"></i>`;
  }
  iconize();
}

function renderAll() {
  renderBooks();
  syncAnalyticsYearOptions();
  renderAnalytics();
  updateGoalUI();
  renderBackupUI();
  iconize();
}

function formSignature(form: HTMLFormElement): string {
  return JSON.stringify([...new FormData(form).entries()]) + (form.dataset.rating || "");
}

function canLeaveRoute(from: AppRoute, to: AppRoute): boolean {
  if (from.layer === "edit" && (to.layer !== "edit" || to.bookId !== from.bookId)) {
    const form = document.querySelector<HTMLFormElement>("#detail-form");
    if (form && formSignature(form) !== detailBaseline && !window.confirm("保存していない変更があります。変更を破棄して戻りますか？")) return false;
  }
  if (["add", "confirm"].includes(from.layer) && !["add", "confirm"].includes(to.layer)) {
    const form = $<HTMLFormElement>("#manual-form");
    if (addBaseline && formSignature(form) !== addBaseline && !window.confirm("追加していない入力があります。入力を破棄して閉じますか？")) return false;
  }
  return true;
}

function syncBodyLock(locked: boolean) {
  if (locked && lockedScroll === null) {
    lockedScroll = window.scrollY;
    document.body.style.top = `-${lockedScroll}px`;
    document.body.classList.add("has-dialog");
  } else if (!locked && lockedScroll !== null) {
    const top = lockedScroll;
    lockedScroll = null;
    document.body.classList.remove("has-dialog");
    document.body.style.top = "";
    window.scrollTo({ top, behavior: "instant" });
  }
}

function stopAddRequests() {
  stopBarcodeScanner();
  if (catalogSearchTimer !== null) clearTimeout(catalogSearchTimer);
  catalogSearchTimer = null;
  catalogRequest?.abort();
  manualSearchRequest?.abort();
  catalogRequest = null;
  manualSearchRequest = null;
}

function resetAddSession() {
  stopAddRequests();
  const form = $<HTMLFormElement>("#manual-form");
  form.reset();
  $<HTMLInputElement>('[name="isbn"]', form).setCustomValidity("");
  selectedManualCatalogBook = null;
  visibleManualSearchBooks = [];
  visibleCatalogBooks = [];
  directEntry = false;
  $<HTMLInputElement>("#catalog-search").value = "";
  $<HTMLInputElement>("#manual-book-query").value = "";
  $<HTMLSelectElement>('[name="status"]', form).value = activeFilter === "all" ? "read" : activeFilter;
  syncManualFinishedAt();
  addBaseline = formSignature(form);
  $("#add-feedback").hidden = true;
  $("#retry-catalog").hidden = true;
  renderCatalogResults([], "ISBNを入力して検索できます。");
  renderManualSearchResults([]);
  updateNdlSearchLink("");
  $("#manual-search-source").textContent = "候補を選ぶと、内容を確認して追加できます。";
  $("#catalog-source").textContent = "本の裏表紙にある978・979から始まるバーコードを読み取ります。";
}

let addSearchScroll = 0;
const detailScroll = new Map<string, number>();

function applyRoute(next: AppRoute) {
  const previous = currentRoute;
  screenScroll[previous.screen] = lockedScroll ?? window.scrollY;
  if (previous.layer === "detail" && previous.bookId) detailScroll.set(previous.bookId, document.querySelector(".record-scroll")?.scrollTop || 0);
  if (previous.layer === "add" && next.layer === "confirm") addSearchScroll = $(".add-scroll").scrollTop;
  if (["add", "confirm"].includes(previous.layer) && !["add", "confirm"].includes(next.layer)) stopAddRequests();
  currentRoute = next;
  applyingRoute = true;
  activeFilter = next.shelf.filter;
  activeView = next.shelf.view;
  query = next.shelf.query;
  shelfCriteria = { ...next.shelf.criteria };
  $<HTMLSelectElement>("#sort-books").value = next.shelf.sort;
  $<HTMLInputElement>("#library-search").value = query;
  $$(".screen").forEach(screen => screen.classList.toggle("is-active", screen.id === `screen-${next.screen}`));
  $$("[data-nav]").forEach(button => {
    button.classList.toggle("is-active", button.dataset.nav === next.screen);
    if (button.classList.contains("nav-item")) button.setAttribute("aria-current", button.dataset.nav === next.screen ? "page" : "false");
  });
  renderAll();
  const dialogId = next.layer === "filter" ? "filter-panel" : ["detail", "edit"].includes(next.layer) ? "detail-dialog" : ["add", "confirm"].includes(next.layer) ? "add-dialog" : "";
  $$<HTMLDialogElement>("dialog[open]").forEach(dialog => { if (dialog.id !== dialogId) dialog.close(); });
  if (dialogId !== "detail-dialog") $("#detail-content").replaceChildren();
  syncBodyLock(Boolean(dialogId));
  if (next.layer === "detail" || next.layer === "edit") {
    renderBookDetail(next.bookId || "", next.layer === "edit");
  } else if (next.layer === "filter") {
    filterDraft = { ...shelfCriteria };
    renderFilterDraft();
  } else if (next.layer === "add" || next.layer === "confirm") {
    if (!["add", "confirm"].includes(previous.layer)) resetAddSession();
    setAddMode(next.layer === "confirm" ? "manual" : addReturnMode);
    $<HTMLFormElement>("#manual-form").dataset.stage = next.layer === "confirm" ? "confirm" : "search";
    $(".add-modes").hidden = next.layer === "confirm";
    if (next.layer === "confirm") renderManualSelectedSummary(directEntry ? null : selectedManualCatalogBook);
  }
  $("#filter-toggle").setAttribute("aria-expanded", String(next.layer === "filter"));
  if (dialogId) {
    const dialog = $<HTMLDialogElement>(`#${dialogId}`);
    if (!dialog.open) dialog.showModal();
    if (next.layer === "add" || next.layer === "confirm") {
      $("#add-title").focus({ preventScroll: true });
      $(".add-scroll").scrollTo({ top: next.layer === "confirm" ? 0 : addSearchScroll, behavior: "instant" });
    } else if (next.layer === "detail") {
      $(".record-scroll").scrollTop = detailScroll.get(next.bookId || "") || 0;
      $("#record-heading").focus({ preventScroll: true });
    } else if (next.layer === "edit") {
      $("#record-heading").focus({ preventScroll: true });
    }
  } else {
    window.scrollTo({ top: screenScroll[next.screen], behavior: "instant" });
    if (previous.bookId) document.querySelector<HTMLElement>(`[data-book-id="${CSS.escape(previous.bookId)}"]`)?.focus({ preventScroll: true });
  }
  applyingRoute = false;
  iconize();
}

function routeTo(layer: AppRoute["layer"], bookId?: string) {
  navigation.push({ screen: currentRoute.screen, layer, bookId, shelf: getShelfState() });
}

function navigate(screen: ScreenName) {
  if (screen === currentRoute.screen && currentRoute.layer === "none") return;
  navigation.push({ screen, layer: "none", shelf: getShelfState() });
}

function setFilter(filter: ShelfFilter) {
  activeFilter = filter;
  if (filter !== "read" && filter !== "all") shelfCriteria.finishedPeriod = "";
  renderBooks();
}

function resetShelfCriteria() {
  shelfCriteria = { genre: "", rating: "", finishedPeriod: "" };
}

function clearAllShelfFilters() {
  query = "";
  resetShelfCriteria();
  $<HTMLInputElement>("#library-search").value = "";
  renderBooks();
}

function applyAnalyticsShelfFilter(criteria: Partial<ShelfCriteria>) {
  const shelf: ShelfState = { ...getShelfState(), filter: "read", query: "", criteria: { genre: "", rating: "", finishedPeriod: "", ...criteria } };
  screenScroll.shelf = 0;
  navigation.push({ screen: "shelf", layer: "none", shelf });
}

function openAddDialog(mode: AddMode = "search") {
  addReturnMode = mode;
  addSearchScroll = 0;
  routeTo("add");
}

function closeDialog(id: string) {
  if (id === "filter-panel") navigation.back();
  else navigation.returnTo(route => route.layer === "none");
}

function setAddMode(mode: AddMode) {
  if (mode !== "search") stopBarcodeScanner();
  currentAddMode = mode;
  $$('[data-add-mode]').forEach(button => {
    button.classList.toggle("is-active", button.dataset.addMode === mode);
    button.setAttribute("aria-selected", String(button.dataset.addMode === mode));
  });
  $$('[data-add-view]').forEach(view => view.classList.toggle("is-active", view.dataset.addView === mode));
  if (currentRoute?.layer === "add") addReturnMode = mode;
}

function renderManualSelectedSummary(book: CatalogBook | null) {
  const summary = $("#manual-selected-summary");
  if (!book) {
    summary.innerHTML = `<div class="selected-book-placeholder"><i data-lucide="pencil-line"></i></div><div><span class="section-kicker">DIRECT ENTRY</span><strong>書誌情報を入力してください</strong><small>タイトルと著者だけでも登録できます。</small></div>`;
    iconize();
    return;
  }
  const metadata = [book.publisher, book.isbn ? `ISBN ${book.isbn}` : "ISBNなし"].filter(Boolean).join(" · ");
  summary.innerHTML = `<div class="result-cover${hasRenderableCover(book) ? " has-real-cover" : ""}" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}">${catalogCoverImageMarkup(book)}</div><div><span class="section-kicker">SELECTED BOOK</span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}${metadata ? `<br>${escapeHtml(metadata)}` : ""}</small></div>`;
  iconize();
}

function setManualStage(stage: ManualStage, isDirect = false) {
  if (stage === "search") { navigation.back(); return; }
  directEntry = isDirect;
  $<HTMLDetailsElement>("#manual-details").open = isDirect;
  routeTo("confirm");
}

function prepareDirectManualEntry() {
  const form = $<HTMLFormElement>("#manual-form");
  if (addBaseline && formSignature(form) !== addBaseline && !window.confirm("入力済みの内容を破棄して、別の本を直接入力しますか？")) return;
  selectedManualCatalogBook = null;
  const status = activeFilter === "all" ? "read" : activeFilter;
  form.reset();
  $<HTMLSelectElement>('[name="status"]', form).value = status;
  const isbn = $<HTMLInputElement>("#catalog-search").value;
  $<HTMLInputElement>('[name="isbn"]', form).value = currentAddMode === "search" && isValidIsbn(isbn) ? normalizeIsbn(isbn) : "";
  syncManualFinishedAt();
  addBaseline = formSignature(form);
  setManualStage("confirm", true);
}

function renderCatalogResults(results: CatalogBook[], emptyMessage = "書誌情報が見つかりませんでした。直接入力で登録できます。") {
  $("#catalog-results").innerHTML = results.map(book => `
    <button class="catalog-result candidate-button" type="button" data-catalog-isbn="${escapeHtml(book.isbn)}" aria-label="${escapeHtml(book.title)}を確認して追加">
      <span class="result-cover${hasRenderableCover(book) ? " has-real-cover" : ""}" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}">${catalogCoverImageMarkup(book)}</span>
      <span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}${book.publisher ? ` · ${escapeHtml(book.publisher)}` : ""}<br>ISBN ${escapeHtml(book.isbn)}</small><span class="candidate-action">内容を確認 <i data-lucide="arrow-right"></i></span></span>
    </button>`).join("") || `<p class="catalog-empty">${escapeHtml(emptyMessage)}</p>`;
  iconize();
}

async function searchCatalog(searchTerm: string) {
  const term = searchTerm.trim();
  catalogRequest?.abort();
  catalogRequest = null;
  visibleCatalogBooks = [];
  $("#retry-catalog").hidden = true;
  if (!isValidIsbn(term)) {
    renderCatalogResults([], term ? "ISBNを最後まで入力してください。ISBN-10の末尾のXも使えます。" : "ISBNを入力して検索できます。");
    $("#catalog-source").textContent = "ハイフンが入っていても検索できます。";
    return;
  }
  const request = new AbortController();
  catalogRequest = request;
  $("#catalog-source").textContent = "本を検索しています…";
  renderCatalogResults([], "書誌情報を検索中です。");
  try {
    const result = await fetchOpenBdBook(term, request.signal);
    if (request.signal.aborted) return;
    visibleCatalogBooks = [result];
    renderCatalogResults(visibleCatalogBooks);
    $("#catalog-source").textContent = result.coverUrl ? "本を選んで、内容を確認してください。" : "本が見つかりました。表紙を確認しています…";
    if (!result.coverUrl) {
      try {
        const coverResult = await resolveBookCover(result, { signal: request.signal, openBdCover: null });
        if (request.signal.aborted) return;
        if (coverResult.coverUrl) {
          result.coverUrl = coverResult.coverUrl;
          result.coverSource = coverResult.coverSource;
        }
      } catch { if (request.signal.aborted) return; }
      renderCatalogResults(visibleCatalogBooks);
      if (selectedManualCatalogBook === result && currentRoute.layer === "confirm") renderManualSelectedSummary(result);
    }
    $("#catalog-source").textContent = result.coverUrl ? "本を選んで、内容を確認してください。" : "表紙は見つかりませんでしたが、この本を登録できます。";
  } catch (error) {
    if (request.signal.aborted) return;
    renderCatalogResults([], "本の情報を取得できませんでした。再検索や直接入力をお試しください。");
    $("#catalog-source").textContent = error instanceof Error ? error.message : "書誌検索に接続できませんでした。";
    $("#retry-catalog").hidden = false;
  } finally {
    if (catalogRequest === request) catalogRequest = null;
  }
}

function scheduleCatalogSearch(searchTerm: string) {
  if (catalogSearchTimer !== null) clearTimeout(catalogSearchTimer);
  catalogSearchTimer = setTimeout(() => searchCatalog(searchTerm), 350);
}

function renderManualSearchResults(results: CatalogBook[], emptyMessage = "書名や著者を入力して検索してください。", selectedIndex = -1) {
  $("#manual-search-results").innerHTML = results.map((book, index) => `
    <button class="manual-search-result candidate-button${index === selectedIndex ? " is-selected" : ""}" type="button" data-manual-result-index="${index}" aria-label="${escapeHtml(book.title)}を入力欄に反映">
      <span class="result-cover${hasRenderableCover(book) ? " has-real-cover" : ""}" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}">${catalogCoverImageMarkup(book)}</span>
      <span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}${book.publisher ? `<br>${escapeHtml(book.publisher)}` : ""}${book.isbn ? `<br>ISBN ${escapeHtml(book.isbn)}` : ""}</small><span class="candidate-action">内容を確認 <i data-lucide="arrow-right"></i></span></span>
    </button>`).join("") || `<p class="catalog-empty">${escapeHtml(emptyMessage)}</p>`;
  iconize();
}

async function hydrateManualSearchCovers(results: CatalogBook[], request: AbortController) {
  const candidates = results.filter(book => !book.coverUrl && isValidIsbn(book.isbn)).slice(0, 12);
  await Promise.allSettled(candidates.map(async book => {
    const coverUrl = await findGoogleBooksCoverByIsbn(book.isbn, request.signal);
    if (!coverUrl || request.signal.aborted) return;
    book.coverUrl = coverUrl;
    book.coverSource = "googlebooks";
  }));
  if (request.signal.aborted || manualSearchRequest !== request) return;
  const selectedIndex = selectedManualCatalogBook ? results.indexOf(selectedManualCatalogBook) : -1;
  renderManualSearchResults(results, undefined, selectedIndex);
  if (selectedManualCatalogBook && currentRoute.layer === "confirm") renderManualSelectedSummary(selectedManualCatalogBook);
}

function updateNdlSearchLink(searchTerm: string) {
  const link = $<HTMLAnchorElement>("#manual-search-ndl");
  if (!searchTerm.trim()) {
    link.hidden = true;
    return;
  }
  const url = new URL("https://ndlsearch.ndl.go.jp/api/openurl");
  url.searchParams.set("genre", "book");
  url.searchParams.set("any", searchTerm.trim());
  link.href = url.href;
  link.hidden = false;
}

async function searchManualBooks(searchTerm: string) {
  const term = searchTerm.trim();
  manualSearchRequest?.abort();
  manualSearchRequest = null;

  if (!term) {
    visibleManualSearchBooks = [];
    renderManualSearchResults([], "タイトル、著者、出版社、ISBNのいずれかを入力してください。");
    $("#manual-search-source").textContent = "検索語を入力すると、Open Libraryの収録範囲から候補を探します。";
    updateNdlSearchLink("");
    return;
  }

  const request = new AbortController();
  manualSearchRequest = request;
  updateNdlSearchLink(term);
  $("#manual-search-source").textContent = "本の候補を検索しています…";
  $("#manual-search-results").innerHTML = '<p class="catalog-empty">Open Libraryを検索中です。</p>';

  try {
    const results = await searchOpenLibraryBooks(term, request.signal);
    if (request.signal.aborted) return;
    visibleManualSearchBooks = results;
    renderManualSearchResults(results, "候補が見つかりませんでした。入力欄へ直接記入できます。");
    $("#manual-search-source").textContent = results.length
      ? `${results.length}件の候補です。ISBNのある候補は表紙も確認しています。`
      : "Open Libraryの収録範囲では候補が見つかりませんでした。直接入力、または国立国会図書館サーチで確認できます。";
    await hydrateManualSearchCovers(results, request);
    if (request.signal.aborted) return;
    $("#manual-search-source").textContent = results.length
      ? `${results.length}件の候補です。選ぶと確認画面へ進みます。`
      : $("#manual-search-source").textContent;
  } catch (error) {
    if (request.signal.aborted) return;
    visibleManualSearchBooks = [];
    renderManualSearchResults([], "検索できませんでした。入力欄へ直接記入できます。");
    $("#manual-search-source").textContent = error instanceof Error ? error.message : "書籍検索へ接続できませんでした。";
  } finally {
    if (manualSearchRequest === request) manualSearchRequest = null;
  }
}

function selectCatalogBook(book: CatalogBook) {
  const form = $<HTMLFormElement>("#manual-form");
  const same = selectedManualCatalogBook === book;
  if (!same && addBaseline && formSignature(form) !== addBaseline && !window.confirm("入力済みの内容を破棄して、この本を選びますか？")) return;
  if (!same) {
    const status = activeFilter === "all" ? "read" : activeFilter;
    form.reset();
    $<HTMLSelectElement>('[name="status"]', form).value = status;
    for (const name of ["title", "author", "publisher", "isbn", "genre", "pages"] as const) {
      const input = $<HTMLInputElement>(`[name="${name}"]`, form);
      input.value = String(book[name] || (name === "genre" ? "その他" : ""));
      input.setCustomValidity("");
    }
    syncManualFinishedAt();
    addBaseline = formSignature(form);
  }
  selectedManualCatalogBook = book;
  setManualStage("confirm");
}

function selectManualSearchBook(index: number) {
  const book = visibleManualSearchBooks[index];
  if (book) selectCatalogBook(book);
}

function syncManualFinishedAt() {
  const status = $<HTMLSelectElement>('#manual-form [name="status"]').value;
  const finishedAt = $<HTMLInputElement>("#manual-finished-at");
  finishedAt.disabled = status !== "read";
  $("#manual-finished-field").hidden = status !== "read";
  if (status === "read" && !finishedAt.value) finishedAt.value = todayIso();
}

function stopBarcodeScanner() {
  scannerGeneration += 1;
  if (scannerTimer !== null) {
    clearInterval(scannerTimer);
    scannerTimer = null;
  }
  scannerStream?.getTracks().forEach(track => track.stop());
  scannerStream = null;
  scannerDetectionBusy = false;
  const video = document.getElementById("barcode-video") as HTMLVideoElement | null;
  if (video) video.srcObject = null;
  const scanner = document.getElementById("barcode-scanner");
  if (scanner) scanner.hidden = true;
  const button = document.getElementById("start-barcode-scan") as HTMLButtonElement | null;
  if (button) button.disabled = false;
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) return "カメラの使用が許可されていません。ブラウザーの権限を確認するか、ISBNを入力してください。";
  if (error instanceof DOMException && error.name === "NotFoundError") return "利用できるカメラが見つかりません。ISBNを入力してください。";
  return "カメラを開始できませんでした。ISBNを入力して検索できます。";
}

async function startBarcodeScanner() {
  stopBarcodeScanner();
  const generation = scannerGeneration;
  const button = $<HTMLButtonElement>("#start-barcode-scan");
  const scanner = $("#barcode-scanner");
  const status = $("#barcode-status");
  const video = $<HTMLVideoElement>("#barcode-video");
  button.disabled = true;

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera-unsupported");
    if (!window.BarcodeDetector) throw new Error("barcode-unsupported");

    scanner.hidden = false;
    status.textContent = "カメラを起動しています…";
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (generation !== scannerGeneration || currentRoute.layer !== "add" || currentAddMode !== "search") {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    scannerStream = stream;
    video.srcObject = stream;
    await video.play();
    if (generation !== scannerGeneration) return;
    status.textContent = "本の裏表紙にあるISBNバーコードを枠に合わせてください。";

    const detector = new window.BarcodeDetector({ formats: ["ean_13"] });
    scannerTimer = setInterval(() => {
      if (scannerDetectionBusy) return;
      scannerDetectionBusy = true;
      void detector.detect(video).then(codes => {
        if (generation !== scannerGeneration) return;
        const isbn = codes.map(code => normalizeIsbn(code.rawValue)).find(value => value.length === 13 && /^(978|979)/.test(value) && isValidIsbn(value));
        if (!isbn) {
          if (codes.length) status.textContent = "ISBNバーコードではありません。978または979で始まるバーコードを写してください。";
          return;
        }
        $<HTMLInputElement>("#catalog-search").value = isbn;
        stopBarcodeScanner();
        showToast("ISBNを読み取りました");
        void searchCatalog(isbn);
      }).catch(() => {
        // A frame can be unreadable while the camera is moving. Keep scanning.
      }).finally(() => {
        scannerDetectionBusy = false;
      });
    }, 350);
  } catch (error) {
    if (generation !== scannerGeneration) return;
    const message = error instanceof Error && error.message === "barcode-unsupported"
      ? "このブラウザーはバーコード読み取りに対応していません。ISBNを入力して検索してください。"
      : error instanceof Error && error.message === "camera-unsupported"
        ? "この環境ではカメラを利用できません。HTTPSの公開版で開くか、ISBNを入力してください。"
        : cameraErrorMessage(error);
    stopBarcodeScanner();
    $("#catalog-source").textContent = message;
    showToast(message);
  }
}

function saveLibraryChange(next: Book[]): boolean {
  try {
    saveBooks(next);
    books = next;
    void requestPersistentStorage();
    return true;
  } catch {
    showToast("保存できませんでした。入力は保持しています。端末の空き容量やブラウザーの保存設定を確認し、もう一度保存してください。");
    return false;
  }
}

function showDuplicate(candidate: Book): boolean {
  const existing = books.find(book => hasDuplicateBook([book], candidate));
  if (!existing) return false;
  showToast(`「${candidate.title}」はすでに本棚にあります`);
  const feedback = document.querySelector<HTMLElement>("dialog[open] .inline-feedback");
  if (feedback) feedback.innerHTML = `<span>「${escapeHtml(candidate.title)}」はすでに本棚にあります。</span><button type="button" class="text-button" data-open-existing="${escapeHtml(existing.id)}">登録済みの記録を開く</button>`;
  return true;
}

function openBookDetail(id: string) {
  if (!books.some(book => book.id === id)) return;
  detailScroll.delete(id);
  routeTo("detail", id);
}

function recordHeader(title: string): string {
  return `<header class="record-header"><button class="icon-button" data-detail-action="back" type="button" aria-label="戻る"><i data-lucide="arrow-left"></i></button><h2 id="record-heading" tabindex="-1">${title}</h2><button class="icon-button" data-close="detail-dialog" type="button" aria-label="閉じる"><i data-lucide="x"></i></button></header>`;
}

function renderBookDetail(id: string, editing: boolean) {
  const book = books.find(item => item.id === id);
  if (!book) {
    $("#detail-content").innerHTML = `<div class="record-shell">${recordHeader("本の記録")}<div class="record-scroll"><p>この本は本棚にありません。</p></div></div>`;
    return;
  }
  const cover = `<div class="detail-cover${hasRenderableCover(book) ? " has-real-cover" : ""}" id="detail-cover-visual" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}">${coverImageMarkup(book)}</div>`;
  const hero = `<div class="record-hero">${cover}<div><span class="record-status">${statusLabel(book.status)}</span><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.author)}</p><div class="record-rating">${book.rating ? `<span aria-label="評価${book.rating}">★ ${book.rating} / 5</span>` : "未評価"}${book.status === "read" ? `<span>${formatDate(book.finishedAt)}</span>` : ""}</div></div></div>`;
  const feedback = `<div class="inline-feedback" id="detail-feedback" role="status" aria-live="polite" ${detailNotice ? "" : "hidden"}>${escapeHtml(detailNotice)}</div>`;
  detailNotice = "";
  if (!editing) {
    $("#detail-content").innerHTML = `<div class="record-shell" data-record-id="${escapeHtml(book.id)}">
      ${recordHeader("本の記録")}
      <div class="record-scroll">
        ${hero}${feedback}
        <section class="record-section"><h3>感想</h3>${book.review.trim() ? `<p class="record-prose">${escapeHtml(book.review)}</p>` : `<p class="record-placeholder">この本の感想を残してみませんか。</p><button type="button" class="text-button" data-detail-action="edit">感想を書く</button>`}</section>
        <section class="record-section"><h3>メモ</h3>${book.notes.trim() ? `<p class="record-prose">${escapeHtml(book.notes)}</p>` : '<p class="record-placeholder">メモはまだありません。</p>'}</section>
        <details class="record-metadata"><summary>書誌情報・表紙・共有 <i data-lucide="chevron-down"></i></summary><dl><div><dt>ジャンル</dt><dd>${escapeHtml(book.genre)}</dd></div><div><dt>出版社</dt><dd>${escapeHtml(book.publisher || "未登録")}</dd></div><div><dt>ページ数</dt><dd>${book.pages ? `${book.pages.toLocaleString()}ページ` : "未登録"}</dd></div><div><dt>ISBN</dt><dd>${escapeHtml(book.isbn || "未登録")}</dd></div></dl><div class="detail-cover-meta" id="detail-cover-source">${coverSourceMarkup(book)}</div><div class="metadata-actions"><button class="secondary-button" type="button" data-detail-action="refresh-cover"><i data-lucide="refresh-cw"></i>表紙を再取得</button><button class="secondary-button" type="button" data-detail-action="share"><i data-lucide="share-2"></i>本を共有</button></div></details>
      </div>
      <footer class="record-actions"><button class="primary-button" type="button" id="edit-book" data-detail-action="edit"><i data-lucide="pencil-line"></i><span>記録を編集</span></button></footer>
    </div>`;
  } else {
    $("#detail-content").innerHTML = `<form class="record-shell" id="detail-form" data-record-id="${escapeHtml(book.id)}" data-book-id="${escapeHtml(book.id)}" data-rating="${book.rating}" novalidate>
      ${recordHeader("記録を編集")}
      <div class="record-scroll">
        <div class="edit-book-heading"><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(book.author)}</span></div>
        ${feedback}
        <div class="edit-reading-fields">
          <label class="field"><span>読書状況</span><select name="status"><option value="read" ${book.status === "read" ? "selected" : ""}>読了</option><option value="reading" ${book.status === "reading" ? "selected" : ""}>読書中</option><option value="wishlist" ${book.status === "wishlist" ? "selected" : ""}>読みたい</option></select></label>
          <label class="field" id="detail-finished-field" ${book.status !== "read" ? "hidden" : ""}><span>読了日</span><input name="finishedAt" type="date" value="${escapeHtml(book.finishedAt)}" ${book.status !== "read" ? "disabled" : ""}></label>
        </div>
        <div class="field"><span>評価 <span id="rating-value">${book.rating ? `${book.rating} / 5` : "未評価"}</span></span><div class="rating-control" role="group" aria-label="評価">${[1,2,3,4,5].map(value => `<button class="${value <= book.rating ? "is-active" : ""}" type="button" data-rating="${value}" aria-pressed="${value === book.rating}" aria-label="評価${value}"><i data-lucide="star"></i></button>`).join("")}<button class="text-button clear-rating" type="button" data-rating="0" aria-label="評価を解除">解除</button></div></div>
        <label class="field"><span>感想</span><textarea name="review" maxlength="50000" placeholder="読後の感想を記録">${escapeHtml(book.review)}</textarea></label>
        <label class="field"><span>メモ</span><textarea name="notes" maxlength="50000" placeholder="引用やページ番号、気づきを記録">${escapeHtml(book.notes)}</textarea></label>
        <details class="record-metadata" id="detail-metadata"><summary>書誌情報を編集 <i data-lucide="chevron-down"></i></summary><div class="detail-metadata-grid">
          <label class="field span-2"><span>タイトル *</span><input name="title" value="${escapeHtml(book.title)}" required maxlength="500"></label>
          <label class="field span-2"><span>著者 *</span><input name="author" value="${escapeHtml(book.author)}" required maxlength="300"></label>
          <label class="field"><span>ISBN</span><input name="isbn" value="${escapeHtml(book.isbn)}" maxlength="30" inputmode="text"></label>
          <label class="field"><span>ジャンル</span><input name="genre" value="${escapeHtml(book.genre)}" list="genre-options" maxlength="100"></label>
          <label class="field"><span>ページ数</span><input name="pages" type="number" min="0" max="100000" inputmode="numeric" value="${book.pages || ""}"></label>
          <label class="field"><span>出版社</span><input name="publisher" value="${escapeHtml(book.publisher || "")}" maxlength="300"></label>
        </div></details>
        <button class="text-button danger-button delete-record" type="button" id="delete-book" data-detail-action="delete"><i data-lucide="trash-2"></i>この本を削除</button>
      </div>
      <footer class="record-actions"><button class="primary-button" type="submit" id="save-book"><i data-lucide="check"></i><span>変更を保存</span></button></footer>
    </form>`;
    const form = $<HTMLFormElement>("#detail-form");
    detailBaseline = formSignature(form);
    form.addEventListener("submit", event => { event.preventDefault(); saveBookDetail(form); });
    $<HTMLSelectElement>('[name="status"]', form).addEventListener("change", () => {
      const isRead = $<HTMLSelectElement>('[name="status"]', form).value === "read";
      const date = $<HTMLInputElement>('[name="finishedAt"]', form);
      $("#detail-finished-field").hidden = !isRead;
      date.disabled = !isRead;
      if (isRead && !date.value) date.value = todayIso();
    });
  }
  iconize();
}

function saveBookDetail(form: HTMLFormElement) {
  const book = books.find(item => item.id === form.dataset.bookId);
  if (!book) return;
  const previousLookupKey = coverLookupKey(book);
  const formData = new FormData(form);
  const isbnInput = $<HTMLInputElement>('[name="isbn"]', form);
  const rawIsbn = String(formData.get("isbn") || "").trim();
  isbnInput.setCustomValidity(rawIsbn && !isValidIsbn(rawIsbn) ? "ISBN-10またはISBN-13を確認してください" : "");
  for (const name of ["title", "author"]) {
    const input = $<HTMLInputElement>(`[name="${name}"]`, form);
    input.setCustomValidity(input.value.trim() ? "" : "入力してください");
  }
  if (!form.checkValidity()) {
    $<HTMLDetailsElement>("#detail-metadata").open = true;
    form.reportValidity();
    return;
  }
  const status = String(formData.get("status"));
  const nextStatus: BookStatus = isBookStatus(status) ? status : "read";
  const candidate = normalizeBook({ ...book, title: formData.get("title"), author: formData.get("author"), isbn: rawIsbn ? normalizeIsbn(rawIsbn) : "", genre: formData.get("genre"), pages: formData.get("pages"), publisher: formData.get("publisher"), status: nextStatus, rating: Number(form.dataset.rating || 0), finishedAt: nextStatus === "read" ? String(formData.get("finishedAt") || todayIso()) : "", notes: formData.get("notes"), review: formData.get("review") });
  if (!candidate) return;
  if (hasDuplicateBook(books.filter(item => item.id !== book.id), candidate)) {
    showToast("同じISBN、または同じ書名と著者の本がすでにあります");
    return;
  }
  const coverIdentityChanged = coverLookupKey(candidate) !== previousLookupKey;
  if (coverIdentityChanged) {
    candidate.coverUrl = "";
    candidate.coverSource = undefined;
    candidate.coverLookupKey = undefined;
    candidate.coverCheckedAt = undefined;
  }
  if (!saveLibraryChange(books.map(item => item.id === candidate.id ? candidate : item))) return;
  detailBaseline = formSignature(form);
  detailNotice = "読書記録を更新しました";
  navigation.returnTo(route => route.layer === "detail" && route.bookId === book.id);
  if (coverIdentityChanged) queuePriorityCoverLookup(book.id);
}

function shareBook(id: string) {
  const book = books.find(item => item.id === id);
  if (!book) return;
  const text = `『${book.title}』${book.author ? `（${book.author}）` : ""}\n評価: ${book.rating || "未評価"}/5\n${book.review || book.notes || "YOMUで読書記録を管理中"}`;
  if (navigator.share) {
    navigator.share({ title: book.title, text }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text);
    showToast("共有用テキストをコピーしました");
  }
}

function deleteBook(id: string) {
  const book = books.find(item => item.id === id);
  if (!book || !window.confirm(`「${book.title}」を本棚から削除しますか？この操作は取り消せません。`)) return;
  if (!saveLibraryChange(books.filter(item => item.id !== id))) return;
  const form = document.querySelector<HTMLFormElement>("#detail-form");
  if (form) detailBaseline = formSignature(form);
  navigation.returnTo(route => route.layer === "none");
  showToast("本棚から削除しました");
}

function downloadFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const columns = ["id", "title", "author", "isbn", "genre", "status", "rating", "pages", "finished_at", "created_at", "notes", "review"];
  const rows = books.map(book => [book.id, book.title, book.author, book.isbn, book.genre, book.status, book.rating, book.pages, book.finishedAt, book.createdAt, book.notes, book.review]);
  const quote = (value: string | number) => {
    const plain = String(value ?? "");
    const spreadsheetSafe = /^[=+\-@\t\r]/.test(plain) ? `'${plain}` : plain;
    return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
  };
  const csv = `\uFEFF${columns.join(",")}\r\n${rows.map(row => row.map(quote).join(",")).join("\r\n")}`;
  downloadFile(`yomu-books-${todayIso()}.csv`, csv, "text/csv;charset=utf-8");
  showToast(`${books.length}件をCSVに書き出しました`);
}

function exportJson() {
  const backup = createBackup(books, settings);
  downloadFile(`yomu-backup-${todayIso()}.json`, JSON.stringify(backup, null, 2), "application/json");
  updateBackupState(recordBackup(books));
  void requestPersistentStorage();
  showToast("完全バックアップを書き出しました");
}

function updateBackupState(next: BackupState) {
  backupState = next;
  try { saveBackupState(backupState); } catch { /* The reminder state is advisory; the library itself is unaffected. */ }
  renderBackupUI();
}

function formatBackupDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const days = daysSince(isoTimestamp);
  const label = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" }).format(date);
  return `${label}（${days === 0 ? "今日" : `${days}日前`}）`;
}

function renderBackupUI() {
  const reminder = backupReminder(books, backupState);
  const banner = $("#backup-reminder");
  banner.hidden = reminder === null;
  if (reminder) {
    const title = reminder.reason === "never"
      ? "まだバックアップがありません"
      : reminder.reason === "stale"
        ? `前回のバックアップから${reminder.daysSinceBackup}日たちました`
        : `前回のバックアップから${reminder.changes}件の変更があります`;
    const detail = reminder.reason === "never"
      ? `${books.length}冊の記録はこの端末にだけあります。ファイルに保存しておくと、機種変更やデータ削除のときに復元できます。`
      : reminder.reason === "stale"
        ? `その後${reminder.changes}件の追加・編集・削除があります。最新の記録をファイルに保存しておきましょう。`
        : "最新の記録をファイルに保存しておきましょう。";
    // Phones show a one-line summary so the reminder does not push the shelf below the fold.
    const short = reminder.reason === "never"
      ? `${books.length}冊が未バックアップ`
      : reminder.reason === "stale"
        ? `前回の保存から${reminder.daysSinceBackup}日`
        : `前回から${reminder.changes}件の変更`;
    $("#backup-reminder-title").textContent = title;
    $("#backup-reminder-detail").textContent = detail;
    $("#backup-reminder-short").textContent = short;
  }

  const changes = backupState.lastBackupAt ? countChangesSinceBackup(books, backupState.snapshot) : books.length;
  $("#backup-last").textContent = backupState.lastBackupAt ? `前回のバックアップ: ${formatBackupDate(backupState.lastBackupAt)}` : "まだバックアップしていません";
  $("#backup-changes").textContent = !backupState.lastBackupAt
    ? (books.length ? `${books.length}冊の記録がまだファイルに保存されていません。` : "本を登録したら、JSONファイルに保存できます。")
    : changes ? `その後${changes}件の追加・編集・削除があります。` : "その後の変更はありません。";
  $("#backup-status").dataset.state = !backupState.lastBackupAt ? (books.length ? "missing" : "empty") : changes ? "outdated" : "current";
  renderStorageProtection();
}

function renderStorageProtection() {
  const element = $("#backup-storage");
  if (element.dataset.state === storageProtection) return;
  const content: Record<StorageProtection, [string, string]> = {
    unknown: ["shield", "保存領域の保護状態を確認しています。"],
    persisted: ["shield-check", "この端末の保存領域は保護されています。容量不足でブラウザーが自動削除することはありません。ブラウザーデータの削除や機種変更に備えて、バックアップも保存してください。"],
    "not-persisted": ["shield-alert", "容量不足のとき、ブラウザーが記録を削除する可能性があります。ホーム画面に追加すると保護されやすくなります。定期的にバックアップを保存してください。"],
    unsupported: ["shield", "このブラウザーでは保存領域の保護状態を確認できません。定期的にバックアップを保存してください。"],
  };
  const [icon, message] = content[storageProtection];
  element.dataset.state = storageProtection;
  element.innerHTML = `<i data-lucide="${icon}"></i><span id="backup-storage-text">${escapeHtml(message)}</span>`;
  iconize();
}

/** Asks the browser not to evict localStorage under storage pressure; browsers may grant it silently. */
async function requestPersistentStorage() {
  const storage = navigator.storage;
  if (!storage?.persisted) {
    storageProtection = "unsupported";
    renderStorageProtection();
    return;
  }
  try {
    let persisted = await storage.persisted();
    if (!persisted && !storagePersistRequested && books.length > 0 && storage.persist) {
      storagePersistRequested = true;
      persisted = await storage.persist();
    }
    storageProtection = persisted ? "persisted" : "not-persisted";
  } catch {
    storageProtection = "unsupported";
  }
  renderStorageProtection();
}

async function importJson(file: File) {
  try {
    const raw = JSON.parse(await file.text()) as unknown;
    const imported = parseBackup(raw);
    books = imported.books;
    if (imported.settings) settings = imported.settings;
    persist();
    // The restored file is itself an up-to-date backup of what is now on the shelf.
    const exportedAt = typeof raw === "object" && raw !== null && "exportedAt" in raw ? new Date(String(raw.exportedAt)) : new Date(Number.NaN);
    updateBackupState(recordBackup(books, Number.isNaN(exportedAt.getTime()) || exportedAt.getTime() > Date.now() ? new Date() : exportedAt));
    applyTheme(settings.theme);
    renderAll();
    showToast(`${books.length}件の読書記録を復元しました`);
    coverLookupAttempted.clear();
    coverLookupSessionAttempts = 0;
    scheduleCoverBackfill(300);
  } catch {
    showToast("バックアップ形式を確認できませんでした");
  }
}

async function importCsv(file: File) {
  const summary = $("#import-summary");
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("CSVは10MB以下にしてください");
    const parsed = parseBooksCsv(await file.text());
    const merged = mergeImportedBooks(books, parsed.books);
    books = merged.books;
    persist();
    renderAll();

    const formatLabel = parsed.format === "biblia" ? "ビブリア形式" : "YOMU形式";
    summary.innerHTML = `<strong>${formatLabel}を取り込みました。</strong> 追加 ${merged.added}件・重複スキップ ${merged.duplicates}件・無効行 ${parsed.invalidRows}件`;
    summary.hidden = false;
    showToast(`${merged.added}件を追加し、重複${merged.duplicates}件をスキップしました`);
    coverLookupAttempted.clear();
    coverLookupSessionAttempts = 0;
    scheduleCoverBackfill(300);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CSV形式を確認できませんでした";
    summary.innerHTML = `<strong>取り込みできませんでした。</strong> ${escapeHtml(message)}`;
    summary.hidden = false;
    showToast("CSV形式を確認できませんでした");
  }
}

function applyTheme(theme: ThemePreference) {
  settings.theme = theme;
  const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.body.dataset.theme = resolved;
  $$('#theme-control [data-theme]').forEach(button => {
    button.classList.toggle("is-active", button.dataset.theme === theme);
    button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
  });
  try { saveSettings(settings); } catch { showToast("外観の設定を保存できませんでした"); }
}

function updateGoalUI() {
  $("#goal-value").textContent = `${settings.goal}冊`;
  const currentYear = String(new Date().getFullYear());
  const total = books.filter(book => book.status === "read" && book.finishedAt?.startsWith(currentYear)).length;
  $(".progress-track span").style.width = `${Math.min(total / settings.goal * 100, 100)}%`;
  $(".side-summary small").textContent = `年間目標 ${settings.goal}冊`;
  $<HTMLInputElement>("#synopsis-toggle").checked = settings.synopsis;
}

function initializeEvents() {
  document.addEventListener("error", event => {
    if (event.target instanceof HTMLImageElement && event.target.matches("[data-cover-image]")) handleCoverImageError(event.target);
  }, true);

  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const navButton = target.closest<HTMLElement>("[data-nav]");
    if (navButton?.dataset.nav) navigate(navButton.dataset.nav as ScreenName);

    const closeButton = target.closest<HTMLElement>("[data-close]");
    if (closeButton?.dataset.close) closeDialog(closeButton.dataset.close);

    const tab = target.closest<HTMLElement>(".shelf-tab");
    if (isShelfFilter(tab?.dataset.filter)) setFilter(tab.dataset.filter);

    const viewButton = target.closest<HTMLElement>("[data-view]");
    if (viewButton) {
      activeView = viewButton.dataset.view === "list" ? "list" : "grid";
      $$('[data-view]').forEach(button => button.classList.toggle("is-active", button === viewButton));
      renderBooks();
    }

    const bookButton = target.closest<HTMLButtonElement>("button[data-book-id]");
    if (bookButton?.dataset.bookId) openBookDetail(bookButton.dataset.bookId);

    const addMode = target.closest<HTMLElement>("[data-add-mode]");
    if (addMode?.dataset.addMode) setAddMode(addMode.dataset.addMode as AddMode);

    const catalogButton = target.closest<HTMLElement>("[data-catalog-isbn]");
    if (catalogButton) {
      const book = visibleCatalogBooks.find(item => item.isbn === catalogButton.dataset.catalogIsbn);
      if (book) selectCatalogBook(book);
    }

    const manualResultButton = target.closest<HTMLElement>("[data-manual-result-index]");
    if (manualResultButton?.dataset.manualResultIndex) selectManualSearchBook(Number(manualResultButton.dataset.manualResultIndex));

    const clearShelfFilter = target.closest<HTMLElement>("[data-clear-shelf-filter]");
    if (clearShelfFilter?.dataset.clearShelfFilter) {
      const key = clearShelfFilter.dataset.clearShelfFilter;
      if (key === "query") {
        query = "";
        $<HTMLInputElement>("#library-search").value = "";
      }
      if (key === "genre") shelfCriteria.genre = "";
      if (key === "rating") shelfCriteria.rating = "";
      if (key === "finishedPeriod") shelfCriteria.finishedPeriod = "";
      renderBooks();
    }

    const analyticsGenre = target.closest<HTMLElement>("[data-analytics-genre]");
    if (analyticsGenre?.dataset.analyticsGenre) {
      applyAnalyticsShelfFilter({
        genre: analyticsGenre.dataset.analyticsGenre,
        finishedPeriod: analyticsGenre.dataset.analyticsPeriod || "",
      });
    }

    const analyticsMonth = target.closest<HTMLElement>("[data-analytics-month]");
    if (analyticsMonth?.dataset.analyticsMonth) applyAnalyticsShelfFilter({ finishedPeriod: analyticsMonth.dataset.analyticsMonth });

    const analyticsRating = target.closest<HTMLElement>("[data-analytics-rating]");
    if (analyticsRating?.dataset.analyticsRating) {
      applyAnalyticsShelfFilter({
        rating: analyticsRating.dataset.analyticsRating,
        finishedPeriod: analyticsRating.dataset.analyticsPeriod || "",
      });
    }

    const ratingButton = target.closest<HTMLElement>(".rating-control [data-rating]");
    if (ratingButton) {
      const rating = Number(ratingButton.dataset.rating);
      const form = ratingButton.closest<HTMLFormElement>("#detail-form");
      if (!form) return;
      const nextRating = Number(form.dataset.rating || 0) === rating ? 0 : rating;
      form.dataset.rating = String(nextRating);
      $$(".rating-control [data-rating]", form).forEach(button => {
        button.classList.toggle("is-active", Number(button.dataset.rating) > 0 && Number(button.dataset.rating) <= nextRating);
        button.setAttribute("aria-pressed", String(Number(button.dataset.rating) === nextRating));
      });
      $("#rating-value").textContent = nextRating ? `${nextRating} / 5` : "未評価";
    }

    const themeButton = target.closest<HTMLElement>("#theme-control [data-theme]");
    if (isThemePreference(themeButton?.dataset.theme)) applyTheme(themeButton.dataset.theme);

    const existing = target.closest<HTMLElement>("[data-open-existing]");
    if (existing?.dataset.openExisting) {
      navigation.returnTo(route => route.layer === "none", { screen: currentRoute.screen, layer: "detail", bookId: existing.dataset.openExisting, shelf: getShelfState() });
    }
    const detailAction = target.closest<HTMLButtonElement>("[data-detail-action]");
    if (detailAction) {
      const action = detailAction.dataset.detailAction;
      const bookId = currentRoute.bookId;
      if (action === "back") { navigation.back(); return; }
      if (!bookId) return;
      if (action === "edit") routeTo("edit", bookId);
      if (action === "refresh-cover") void refreshBookCover(bookId, detailAction);
      if (action === "share") shareBook(bookId);
      if (action === "delete") deleteBook(bookId);
    }
  });

  $("#open-add").addEventListener("click", () => openAddDialog());
  $("#bottom-add").addEventListener("click", () => openAddDialog());
  $("#filter-toggle").addEventListener("click", () => routeTo("filter"));
  $("#close-filter").addEventListener("click", () => closeDialog("filter-panel"));
  $("#apply-filters").addEventListener("click", () => {
    const shelf = { ...getShelfState(), criteria: { ...filterDraft } };
    navigation.returnTo(route => route.layer === "none", { screen: "shelf", layer: "none", shelf }, true);
  });
  $("#close-search").addEventListener("click", () => {
    query = "";
    $<HTMLInputElement>("#library-search").value = "";
    renderBooks();
    $("#library-search").focus();
  });
  $<HTMLInputElement>("#library-search").addEventListener("input", event => { query = (event.currentTarget as HTMLInputElement).value; renderBooks(); });
  $<HTMLSelectElement>("#filter-genre").addEventListener("change", event => { filterDraft.genre = (event.currentTarget as HTMLSelectElement).value; renderFilterDraft(); });
  $<HTMLSelectElement>("#filter-rating").addEventListener("change", event => { filterDraft.rating = (event.currentTarget as HTMLSelectElement).value; renderFilterDraft(); });
  $<HTMLInputElement>("#filter-month").addEventListener("change", event => { filterDraft.finishedPeriod = (event.currentTarget as HTMLInputElement).value; renderFilterDraft(); });
  $("#clear-criteria").addEventListener("click", () => { filterDraft = { genre: "", rating: "", finishedPeriod: "" }; renderFilterDraft(); });
  $("#clear-all-filters").addEventListener("click", clearAllShelfFilters);
  $("#sort-books").addEventListener("change", renderBooks);
  $(".shelf-tabs").addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = $$<HTMLButtonElement>(".shelf-tab");
    const current = tabs.findIndex(tab => tab.dataset.filter === activeFilter);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    const tab = tabs[next]!;
    setFilter(tab.dataset.filter as ShelfFilter);
    tab.focus();
  });
  $<HTMLSelectElement>("#analytics-year").addEventListener("change", renderAnalytics);
  $<HTMLInputElement>("#catalog-search").addEventListener("input", event => scheduleCatalogSearch((event.currentTarget as HTMLInputElement).value));
  $("#start-barcode-scan").addEventListener("click", () => { void startBarcodeScanner(); });
  $("#stop-barcode-scan").addEventListener("click", stopBarcodeScanner);
  $("#manual-book-search").addEventListener("click", () => { void searchManualBooks($<HTMLInputElement>("#manual-book-query").value); });
  $("#manual-enter-directly").addEventListener("click", prepareDirectManualEntry);
  $("#isbn-enter-directly").addEventListener("click", prepareDirectManualEntry);
  $("#retry-catalog").addEventListener("click", () => { void searchCatalog($<HTMLInputElement>("#catalog-search").value); });
  $("#manual-back-to-search").addEventListener("click", () => setManualStage("search"));
  $<HTMLInputElement>("#manual-book-query").addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void searchManualBooks((event.currentTarget as HTMLInputElement).value);
  });
  $("#empty-add-isbn").addEventListener("click", () => openAddDialog("search"));
  $("#empty-add-manual").addEventListener("click", () => openAddDialog("manual"));
  $("#empty-clear-search").addEventListener("click", clearAllShelfFilters);
  $("#empty-search-all").addEventListener("click", () => { resetShelfCriteria(); setFilter("all"); });

  $<HTMLSelectElement>('#manual-form [name="status"]').addEventListener("change", syncManualFinishedAt);
  syncManualFinishedAt();

  $<HTMLFormElement>("#manual-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const requestedStatus = String(data.get("status"));
    const status: BookStatus = isBookStatus(requestedStatus) ? requestedStatus : "read";
    const isbnInput = $<HTMLInputElement>('[name="isbn"]', form);
    const rawIsbn = String(data.get("isbn") || "").trim();
    isbnInput.setCustomValidity(rawIsbn && !isValidIsbn(rawIsbn) ? "ISBN-10またはISBN-13を確認してください" : "");
    for (const name of ["title", "author"]) {
      const input = $<HTMLInputElement>(`[name="${name}"]`, form);
      input.setCustomValidity(input.value.trim() ? "" : "入力してください");
    }
    if (!form.checkValidity()) {
      $<HTMLDetailsElement>("#manual-details").open = true;
      form.reportValidity();
      return;
    }
    const title = String(data.get("title") || "").trim();
    const author = String(data.get("author") || "").trim();
    const normalizedInputIsbn = rawIsbn ? normalizeIsbn(rawIsbn) : "";
    const selected = selectedManualCatalogBook;
    const selectedMatches = Boolean(selected && (
      (normalizedInputIsbn ? normalizedInputIsbn === normalizeIsbn(selected.isbn) : !selected.isbn && title.toLocaleLowerCase("ja") === selected.title.toLocaleLowerCase("ja") && author.toLocaleLowerCase("ja") === selected.author.toLocaleLowerCase("ja"))
    ));
    const notes = String(data.get("notes") || "");
    const candidate = normalizeBook({
      id: crypto.randomUUID(),
      title,
      author,
      isbn: normalizedInputIsbn,
      genre: data.get("genre"),
      pages: data.get("pages"),
      publisher: data.get("publisher"),
      status,
      rating: data.get("rating"),
      finishedAt: status === "read" ? data.get("finishedAt") || todayIso() : "",
      createdAt: todayIso(),
      notes: notes || (selectedMatches && settings.synopsis ? selected?.synopsis || "" : ""),
      review: data.get("review"),
      cover: selectedMatches && selected ? selected.cover : books.length % 6,
      coverUrl: selectedMatches ? selected?.coverUrl || "" : "",
      coverSource: selectedMatches ? selected?.coverSource : undefined,
      source: selectedMatches ? selected?.source || "catalog" : "manual",
    });
    if (!candidate) return;
    if (showDuplicate(candidate)) return;
    if (candidate.coverUrl) {
      candidate.coverLookupKey = coverLookupKey(candidate);
      candidate.coverCheckedAt = new Date().toISOString();
    }
    if (!saveLibraryChange([candidate, ...books])) return;
    addBaseline = formSignature(form);
    detailNotice = `「${candidate.title}」を本棚に追加しました`;
    navigation.returnTo(route => route.layer === "none", { screen: currentRoute.screen, layer: "detail", bookId: candidate.id, shelf: getShelfState() });
    queuePriorityCoverLookup(candidate.id);
  });

  $("#export-csv").addEventListener("click", exportCsv);
  $("#export-json").addEventListener("click", exportJson);
  $("#backup-now").addEventListener("click", exportJson);
  $("#backup-reminder-save").addEventListener("click", exportJson);
  $("#backup-reminder-snooze").addEventListener("click", () => {
    updateBackupState(snoozeBackupReminder(backupState));
    showToast(`${BACKUP_REMINDER_SNOOZE_DAYS}日後にもう一度お知らせします`);
  });
  $("#import-csv").addEventListener("click", () => $<HTMLInputElement>("#import-csv-file").click());
  $<HTMLInputElement>("#import-csv-file").addEventListener("change", event => {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.[0]) importCsv(input.files[0]);
    input.value = "";
  });
  $("#import-json").addEventListener("click", () => $<HTMLInputElement>("#import-file").click());
  $<HTMLInputElement>("#import-file").addEventListener("change", event => {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.[0]) importJson(input.files[0]);
    input.value = "";
  });
  $("#goal-minus").addEventListener("click", () => { settings.goal = Math.max(1, settings.goal - 1); persist(); updateGoalUI(); });
  $("#goal-plus").addEventListener("click", () => { settings.goal = Math.min(999, settings.goal + 1); persist(); updateGoalUI(); });
  $<HTMLInputElement>("#synopsis-toggle").addEventListener("change", event => { settings.synopsis = (event.currentTarget as HTMLInputElement).checked; persist(); showToast("設定を保存しました"); });
  $("#show-insight-books").addEventListener("click", event => {
    const genre = (event.currentTarget as HTMLElement).dataset.insightGenre || "";
    if (!genre) {
      openAddDialog("search");
      return;
    }
    applyAnalyticsShelfFilter({ genre, finishedPeriod: (event.currentTarget as HTMLElement).dataset.insightPeriod || "" });
  });

  $$<HTMLDialogElement>("dialog").forEach(dialog => {
    dialog.addEventListener("cancel", event => { event.preventDefault(); navigation.back(); });
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog.id);
    });
  });
  window.addEventListener("beforeunload", event => {
    const form = document.querySelector<HTMLFormElement>("#detail-form");
    const dirtyEdit = currentRoute.layer === "edit" && form && formSignature(form) !== detailBaseline;
    const dirtyAdd = ["add", "confirm"].includes(currentRoute.layer) && addBaseline && formSignature($<HTMLFormElement>("#manual-form")) !== addBaseline;
    if (dirtyEdit || dirtyAdd) { event.preventDefault(); event.returnValue = ""; }
  });
  window.addEventListener("online", () => {
    coverLookupSessionAttempts = 0;
    scheduleCoverBackfill(300);
  });
}

function initialize() {
  const now = new Date();
  const localToday = todayIso(now);
  $("#today-label").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now).toUpperCase();
  $<HTMLInputElement>("#manual-finished-at").value = localToday;
  $<HTMLSelectElement>("#sort-books").value = shelfPreferences.sort;
  currentRoute = { screen: "shelf", layer: "none", shelf: getShelfState() };
  navigation = createNavigation(currentRoute, applyRoute, canLeaveRoute);
  applyTheme(settings.theme);
  initializeEvents();
  initializeInstallExperience();
  renderCatalogResults([], "ISBNを入力すると、openBDから書誌情報を取得します。");
  renderManualSearchResults([]);
  renderAll();
  setTimeout(iconize, 150);
  scheduleCoverBackfill(900);
  void requestPersistentStorage();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", initialize);
