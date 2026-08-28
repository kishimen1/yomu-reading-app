const STORAGE_KEY = "yomu-reading-archive:v1";
const SETTINGS_KEY = "yomu-settings:v1";
const COVER_POSITIONS = ["0% 0%", "50% 0%", "100% 0%", "0% 100%", "50% 100%", "100% 100%"];
const GENRE_COLORS = ["#256b54", "#e4513b", "#456a82", "#c3912f", "#7b657f", "#88908b"];

const seedBooks = [
  { id: "b01", title: "灯りのない窓辺", author: "水原 澄", isbn: "9784000000001", genre: "文学・小説", pages: 288, status: "read", rating: 5, finishedAt: "2026-01-18", createdAt: "2026-01-18", notes: "静かな文章の間に、家族の時間が折り重なる。", review: "余白まで味わいたくなる作品だった。", cover: 0 },
  { id: "b02", title: "葉脈から読む世界", author: "朝倉 透", isbn: "9784000000002", genre: "自然科学", pages: 336, status: "read", rating: 5, finishedAt: "2026-02-09", createdAt: "2026-02-09", notes: "植物の形は環境への応答の蓄積。", review: "図版と説明のバランスがよく、再読したい。", cover: 1 },
  { id: "b03", title: "小さな組織の設計図", author: "高城 真", isbn: "9784000000003", genre: "ビジネス", pages: 254, status: "read", rating: 4, finishedAt: "2026-03-22", createdAt: "2026-03-22", notes: "意思決定の速度は権限の置き方で変わる。", review: "実務に持ち帰れる論点が多い。", cover: 2 },
  { id: "b04", title: "青の列島史", author: "相川 遼", isbn: "9784000000004", genre: "歴史", pages: 412, status: "read", rating: 4, finishedAt: "2026-04-06", createdAt: "2026-04-06", notes: "海上交通から列島のつながりを捉え直す。", review: "視点が新鮮。地図を見ながら読むと楽しい。", cover: 3 },
  { id: "b05", title: "他者を想像する", author: "柊木 直", isbn: "9784000000005", genre: "心理・思想", pages: 320, status: "read", rating: 4, finishedAt: "2026-04-27", createdAt: "2026-04-27", notes: "理解とは一致することではない。", review: "対話について考え直すきっかけになった。", cover: 4 },
  { id: "b06", title: "海岸線をゆく列車", author: "宮沢 碧", isbn: "9784000000006", genre: "紀行・エッセイ", pages: 224, status: "read", rating: 3, finishedAt: "2026-05-15", createdAt: "2026-05-15", notes: "土地の記憶を車窓の速度でたどる。", review: "短い章ごとに旅の温度が変わる。", cover: 5 },
  { id: "b07", title: "夜の標本室", author: "水原 澄", isbn: "9784000000007", genre: "文学・小説", pages: 301, status: "read", rating: 5, finishedAt: "2026-06-03", createdAt: "2026-06-03", notes: "記憶を保存することと忘れること。", review: "今年いちばん印象に残った小説。", cover: 0 },
  { id: "b08", title: "森のネットワーク", author: "芦田 葵", isbn: "9784000000008", genre: "自然科学", pages: 376, status: "read", rating: 5, finishedAt: "2026-06-20", createdAt: "2026-06-20", notes: "菌根菌を介した資源交換の仕組み。", review: "複雑な生態系を丁寧にほどいている。", cover: 1 },
  { id: "b09", title: "余白の経営", author: "三崎 修", isbn: "9784000000009", genre: "ビジネス", pages: 272, status: "read", rating: 3, finishedAt: "2026-07-07", createdAt: "2026-07-07", notes: "計画に余白を組み込む。", review: "後半の事例が特に参考になった。", cover: 2 },
  { id: "b10", title: "水路と都市の記憶", author: "相川 遼", isbn: "9784000000010", genre: "歴史", pages: 348, status: "read", rating: 4, finishedAt: "2026-08-02", createdAt: "2026-08-02", notes: "都市の骨格は見えない水路に残る。", review: "身近な街の見え方が変わった。", cover: 3 },
  { id: "b11", title: "静かな対話の技術", author: "柊木 直", isbn: "9784000000011", genre: "心理・思想", pages: 264, status: "read", rating: 4, finishedAt: "2026-08-14", createdAt: "2026-08-14", notes: "問いを急いで閉じない。", review: "会議や面談でも応用できそう。", cover: 4 },
  { id: "b12", title: "島々の朝食", author: "宮沢 碧", isbn: "9784000000012", genre: "紀行・エッセイ", pages: 246, status: "read", rating: 4, finishedAt: "2026-08-26", createdAt: "2026-08-26", notes: "食卓から気候と産業が見えてくる。", review: "旅に出たくなる、軽やかな読後感。", cover: 5 },
  { id: "b13", title: "透明な時間", author: "遠野 翠", isbn: "9784000000013", genre: "文学・小説", pages: 390, status: "reading", rating: 0, finishedAt: "", createdAt: "2026-08-21", notes: "p.84 時間の感覚について", review: "", cover: 0 },
  { id: "b14", title: "都市の昆虫地図", author: "芦田 葵", isbn: "9784000000014", genre: "自然科学", pages: 298, status: "reading", rating: 0, finishedAt: "", createdAt: "2026-08-24", notes: "", review: "", cover: 1 },
  { id: "b15", title: "文化をつくる会議", author: "高城 真", isbn: "9784000000015", genre: "ビジネス", pages: 230, status: "wishlist", rating: 0, finishedAt: "", createdAt: "2026-07-02", notes: "", review: "", cover: 2 },
  { id: "b16", title: "近代港湾の歩き方", author: "相川 遼", isbn: "9784000000016", genre: "歴史", pages: 310, status: "wishlist", rating: 0, finishedAt: "", createdAt: "2026-07-18", notes: "", review: "", cover: 3 },
  { id: "b17", title: "選択の心理学", author: "柊木 直", isbn: "9784000000017", genre: "心理・思想", pages: 286, status: "wishlist", rating: 0, finishedAt: "", createdAt: "2026-08-05", notes: "", review: "", cover: 4 },
  { id: "b18", title: "北緯35度の旅", author: "宮沢 碧", isbn: "9784000000018", genre: "紀行・エッセイ", pages: 208, status: "wishlist", rating: 0, finishedAt: "", createdAt: "2026-08-19", notes: "", review: "", cover: 5 }
];

const catalogBooks = [
  { title: "風を集める図書館", author: "遠野 翠", isbn: "9784100000201", genre: "文学・小説", pages: 312, cover: 0 },
  { title: "土と微生物の教科書", author: "芦田 葵", isbn: "9784100000202", genre: "自然科学", pages: 344, cover: 1 },
  { title: "問いから始める戦略", author: "三崎 修", isbn: "9784100000203", genre: "ビジネス", pages: 268, cover: 2 }
];

let books = loadBooks();
let settings = loadSettings();
let activeFilter = "read";
let activeView = "grid";
let query = "";
let cameraStream = null;
let toastTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadBooks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) && saved.length ? saved : structuredClone(seedBooks);
  } catch {
    return structuredClone(seedBooks);
  }
}

function loadSettings() {
  try {
    return { theme: "system", goal: 18, synopsis: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
  } catch {
    return { theme: "system", goal: 18, synopsis: true };
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
}

function formatDate(dateString) {
  if (!dateString) return "日付なし";
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function statusLabel(status) {
  return { read: "読了", reading: "読書中", wishlist: "読みたい" }[status] || status;
}

function iconize() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function showToast(message) {
  const toast = $("#toast");
  $("span", toast).textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function renderBooks() {
  const sort = $("#sort-books").value;
  const normalizedTerms = query.toLocaleLowerCase("ja").trim().split(/\s+/).filter(Boolean);
  const filtered = books
    .filter(book => book.status === activeFilter)
    .filter(book => normalizedTerms.every(term => `${book.title} ${book.author} ${book.isbn} ${book.genre}`.toLocaleLowerCase("ja").includes(term)))
    .sort((a, b) => {
      if (sort === "date-asc") return (a.finishedAt || a.createdAt).localeCompare(b.finishedAt || b.createdAt);
      if (sort === "rating-desc") return b.rating - a.rating;
      if (sort === "title-asc") return a.title.localeCompare(b.title, "ja");
      return (b.finishedAt || b.createdAt).localeCompare(a.finishedAt || a.createdAt);
    });

  const grid = $("#book-grid");
  grid.classList.toggle("is-list", activeView === "list");
  grid.innerHTML = filtered.map((book, index) => `
    <article class="book-card" style="animation-delay:${Math.min(index * 35, 210)}ms">
      <button class="book-cover" type="button" data-book-id="${escapeHtml(book.id)}" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}" aria-label="${escapeHtml(book.title)}の詳細を開く">
        <span class="cover-copy"><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}</small></span>
      </button>
      <div class="book-meta">
        <div><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.author)}</p><span class="status-badge">${statusLabel(book.status)}</span></div>
        <div class="book-meta-footer"><span>${book.status === "read" ? formatDate(book.finishedAt) : escapeHtml(book.genre)}</span><span class="rating">${book.rating ? `★ ${book.rating}.0` : "未評価"}</span></div>
      </div>
    </article>`).join("");

  $("#empty-state").hidden = filtered.length > 0;
  grid.hidden = filtered.length === 0;
  $("#read-count").textContent = books.filter(book => book.status === "read").length;
  $("#reading-count").textContent = books.filter(book => book.status === "reading").length;
  $("#wishlist-count").textContent = books.filter(book => book.status === "wishlist").length;
}

function renderAnalytics() {
  const readBooks = books.filter(book => book.status === "read" && book.finishedAt?.startsWith("2026"));
  const totalPages = readBooks.reduce((sum, book) => sum + Number(book.pages || 0), 0);
  const rated = readBooks.filter(book => book.rating > 0);
  const averageRating = rated.length ? rated.reduce((sum, book) => sum + book.rating, 0) / rated.length : 0;
  const uniqueAuthors = new Set(readBooks.map(book => book.author)).size;
  const monthsElapsed = 8;
  const monthly = Array.from({ length: 8 }, (_, month) => readBooks.filter(book => Number(book.finishedAt.slice(5, 7)) === month + 1).length);

  $("#analytics-total").textContent = readBooks.length;
  $("#sidebar-year-count").textContent = `${readBooks.length}冊`;
  $("#kpi-pages").textContent = totalPages.toLocaleString("ja-JP");
  $("#kpi-rating").textContent = averageRating.toFixed(1);
  $("#kpi-monthly").textContent = (readBooks.length / monthsElapsed).toFixed(1);
  $("#kpi-authors").textContent = uniqueAuthors;
  $("#month-count").textContent = `${monthly[7]}冊`;

  const genreCounts = readBooks.reduce((acc, book) => {
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
  $("#genre-legend").innerHTML = genres.map(([genre, count], index) => `
    <div class="legend-row"><i style="background:${GENRE_COLORS[index % GENRE_COLORS.length]}"></i><span>${escapeHtml(genre)}</span><strong>${Math.round(count / readBooks.length * 100)}%</strong></div>`).join("");

  const maxMonth = Math.max(...monthly, 1);
  $("#month-chart").innerHTML = monthly.map((count, index) => `
    <div class="month-bar ${index === 7 ? "current" : ""}"><strong>${count || ""}</strong><i style="--height:${Math.max(count / maxMonth * 82, count ? 20 : 3)}%"></i><span>${index + 1}月</span></div>`).join("");

  const ratingCounts = [5, 4, 3, 2, 1].map(rating => ({ rating, count: rated.filter(book => book.rating === rating).length }));
  const maxRating = Math.max(...ratingCounts.map(item => item.count), 1);
  $("#rating-bars").innerHTML = ratingCounts.map(item => `
    <div class="rating-row"><strong>${item.rating}.0</strong><div class="rating-track"><i style="width:${item.count / maxRating * 100}%"></i></div><span>${item.count}</span></div>`).join("");
}

function renderAll() {
  renderBooks();
  renderAnalytics();
  updateGoalUI();
  iconize();
}

function navigate(screen) {
  $$(".screen").forEach(section => section.classList.toggle("is-active", section.id === `screen-${screen}`));
  $$('[data-nav]').forEach(button => button.classList.toggle("is-active", button.dataset.nav === screen));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setFilter(filter) {
  activeFilter = filter;
  $$(".shelf-tab").forEach(tab => {
    const isActive = tab.dataset.filter === filter;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  renderBooks();
}

function openAddDialog(mode = "scan") {
  setAddMode(mode);
  $("#add-dialog").showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
  if (id === "add-dialog") stopCamera();
}

function setAddMode(mode) {
  $$('[data-add-mode]').forEach(button => button.classList.toggle("is-active", button.dataset.addMode === mode));
  $$('[data-add-view]').forEach(view => view.classList.toggle("is-active", view.dataset.addView === mode));
  if (mode === "search") renderCatalog("");
}

function renderCatalog(searchTerm) {
  const term = searchTerm.trim().toLocaleLowerCase("ja");
  const results = catalogBooks.filter(book => `${book.title} ${book.author} ${book.isbn}`.toLocaleLowerCase("ja").includes(term));
  $("#catalog-results").innerHTML = results.map(book => `
    <article class="catalog-result">
      <div class="result-cover" style="--cover-position:${COVER_POSITIONS[book.cover]}"></div>
      <span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)} · ${escapeHtml(book.isbn)}</small></span>
      <button type="button" data-catalog-isbn="${book.isbn}" aria-label="${escapeHtml(book.title)}を追加"><i data-lucide="plus"></i></button>
    </article>`).join("") || `<p class="empty-state">候補が見つかりませんでした。</p>`;
  iconize();
}

function addCatalogBook(catalogBook, source = "検索") {
  const now = new Date().toISOString().slice(0, 10);
  books.unshift({ ...catalogBook, id: crypto.randomUUID(), status: "wishlist", rating: 0, finishedAt: "", createdAt: now, notes: settings.synopsis ? "書誌情報から取得したあらすじ（モック）" : "", review: "" });
  persist();
  renderAll();
  showToast(`${source}から「${catalogBook.title}」を読みたい本に追加しました`);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("このブラウザーではカメラを利用できません");
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    const video = $("#camera-preview");
    video.srcObject = cameraStream;
    video.hidden = false;
    await video.play();
    showToast("カメラを起動しました。モックではサンプル読取で登録を試せます");
  } catch {
    showToast("カメラ権限がありません。サンプル読取は利用できます");
  }
}

function stopCamera() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const video = $("#camera-preview");
  video.srcObject = null;
  video.hidden = true;
}

function showScanResult() {
  const book = catalogBooks[1];
  const result = $("#scan-result");
  result.hidden = false;
  result.innerHTML = `<div class="result-cover" style="--cover-position:${COVER_POSITIONS[book.cover]}"></div><span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)} · ${book.isbn}</small></span><button type="button" id="add-scan-result" aria-label="読み取った本を追加"><i data-lucide="plus"></i></button>`;
  iconize();
}

function openBookDetail(id) {
  const book = books.find(item => item.id === id);
  if (!book) return;
  $("#detail-content").innerHTML = `
    <form class="detail-layout" id="detail-form" data-book-id="${escapeHtml(book.id)}">
      <div class="detail-cover-panel"><div class="detail-cover" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}"></div></div>
      <div class="detail-form">
        <span class="section-kicker">BOOK RECORD</span>
        <h2>${escapeHtml(book.title)}</h2>
        <p class="detail-author">${escapeHtml(book.author)}</p>
        <div class="detail-stats"><span>${escapeHtml(book.genre)}</span><span>${Number(book.pages || 0).toLocaleString()}ページ</span><span>ISBN ${escapeHtml(book.isbn || "未登録")}</span></div>
        <span class="section-kicker">RATING</span>
        <div class="rating-control" role="group" aria-label="評価">
          ${[1,2,3,4,5].map(value => `<button class="${value <= book.rating ? "is-active" : ""}" type="button" data-rating="${value}" aria-label="評価${value}"><i data-lucide="star"></i></button>`).join("")}
        </div>
        <div class="detail-fields">
          <label class="field"><span>タイトル</span><input name="title" value="${escapeHtml(book.title)}" required></label>
          <label class="field"><span>著者</span><input name="author" value="${escapeHtml(book.author)}" required></label>
          <label class="field"><span>本棚</span><select name="status"><option value="read" ${book.status === "read" ? "selected" : ""}>読んだ</option><option value="reading" ${book.status === "reading" ? "selected" : ""}>読書中</option><option value="wishlist" ${book.status === "wishlist" ? "selected" : ""}>読みたい</option></select></label>
          <label class="field"><span>読了日</span><input name="finishedAt" type="date" value="${escapeHtml(book.finishedAt || "")}"></label>
          <label class="field"><span>メモ</span><textarea name="notes" placeholder="引用やページ番号、気づきを記録">${escapeHtml(book.notes || "")}</textarea></label>
          <label class="field"><span>感想</span><textarea name="review" placeholder="読後の感想を記録">${escapeHtml(book.review || "")}</textarea></label>
        </div>
        <div class="detail-actions"><button class="primary-button" type="button" id="save-book" onclick="saveBookDetail(this.form)"><i data-lucide="save"></i><span>変更を保存</span></button><button class="icon-button" type="button" id="share-book" onclick="shareBook(this.form.dataset.bookId)" aria-label="本を共有" title="本を共有"><i data-lucide="share-2"></i></button><button class="icon-button danger-button" type="button" id="delete-book" onclick="deleteBook(this.form.dataset.bookId)" aria-label="本を削除" title="本を削除"><i data-lucide="trash-2"></i></button></div>
      </div>
    </form>`;
  $("#detail-dialog").showModal();
  iconize();
}

function saveBookDetail(form) {
  if (!form.reportValidity()) return;
  const book = books.find(item => item.id === form.dataset.bookId);
  if (!book) return;
  const formData = new FormData(form);
  book.title = String(formData.get("title") || "").trim();
  book.author = String(formData.get("author") || "").trim();
  book.status = String(formData.get("status"));
  book.finishedAt = String(formData.get("finishedAt") || "");
  book.notes = String(formData.get("notes") || "");
  book.review = String(formData.get("review") || "");
  if (book.status === "read" && !book.finishedAt) book.finishedAt = new Date().toISOString().slice(0, 10);
  persist();
  renderAll();
  closeDialog("detail-dialog");
  showToast("読書記録を更新しました");
}

function shareBook(id) {
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

function deleteBook(id) {
  const book = books.find(item => item.id === id);
  if (!book || !window.confirm(`「${book.title}」を本棚から削除しますか？`)) return;
  books = books.filter(item => item.id !== id);
  persist();
  renderAll();
  closeDialog("detail-dialog");
  showToast("本棚から削除しました");
}

function downloadFile(filename, contents, type) {
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
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = `\uFEFF${columns.join(",")}\r\n${rows.map(row => row.map(quote).join(",")).join("\r\n")}`;
  downloadFile(`yomu-books-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
  showToast(`${books.length}件をCSVに書き出しました`);
}

function exportJson() {
  const backup = { schemaVersion: 1, exportedAt: new Date().toISOString(), settings, books };
  downloadFile(`yomu-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), "application/json");
  showToast("完全バックアップを書き出しました");
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    const importedBooks = Array.isArray(data) ? data : data.books;
    if (!Array.isArray(importedBooks)) throw new Error("invalid");
    books = importedBooks.map((book, index) => ({
      id: book.id || crypto.randomUUID(), title: String(book.title || "無題"), author: String(book.author || "著者不明"), isbn: String(book.isbn || ""), genre: String(book.genre || "その他"),
      status: ["read", "reading", "wishlist"].includes(book.status) ? book.status : "read", rating: Number(book.rating || 0), pages: Number(book.pages || 0),
      finishedAt: String(book.finishedAt || book.finished_at || ""), createdAt: String(book.createdAt || book.created_at || new Date().toISOString().slice(0,10)),
      notes: String(book.notes || ""), review: String(book.review || ""), cover: Number.isInteger(book.cover) ? book.cover % 6 : index % 6
    }));
    if (data.settings) settings = { ...settings, ...data.settings };
    persist();
    applyTheme(settings.theme);
    renderAll();
    showToast(`${books.length}件の読書記録を復元しました`);
  } catch {
    showToast("バックアップ形式を確認できませんでした");
  }
}

function applyTheme(theme) {
  settings.theme = theme;
  const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.body.dataset.theme = resolved;
  $$('[data-theme]').forEach(button => button.classList.toggle("is-active", button.dataset.theme === theme));
  persist();
}

function updateGoalUI() {
  $("#goal-value").textContent = `${settings.goal}冊`;
  const total = books.filter(book => book.status === "read" && book.finishedAt?.startsWith("2026")).length;
  $(".progress-track span").style.width = `${Math.min(total / settings.goal * 100, 100)}%`;
  $(".side-summary small").textContent = `年間目標 ${settings.goal}冊`;
  $("#synopsis-toggle").checked = settings.synopsis;
}

function initializeEvents() {
  document.addEventListener("click", event => {
    const navButton = event.target.closest("[data-nav]");
    if (navButton) navigate(navButton.dataset.nav);

    const closeButton = event.target.closest("[data-close]");
    if (closeButton) closeDialog(closeButton.dataset.close);

    const tab = event.target.closest(".shelf-tab");
    if (tab) setFilter(tab.dataset.filter);

    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      activeView = viewButton.dataset.view;
      $$('[data-view]').forEach(button => button.classList.toggle("is-active", button === viewButton));
      renderBooks();
    }

    const bookButton = event.target.closest("[data-book-id]");
    if (bookButton) openBookDetail(bookButton.dataset.bookId);

    const addMode = event.target.closest("[data-add-mode]");
    if (addMode) setAddMode(addMode.dataset.addMode);

    const catalogButton = event.target.closest("[data-catalog-isbn]");
    if (catalogButton) {
      const book = catalogBooks.find(item => item.isbn === catalogButton.dataset.catalogIsbn);
      if (book) addCatalogBook(book);
    }

    const ratingButton = event.target.closest("[data-rating]");
    if (ratingButton) {
      const rating = Number(ratingButton.dataset.rating);
      const book = books.find(item => item.id === $("#detail-form")?.dataset.bookId);
      if (book) book.rating = book.rating === rating ? 0 : rating;
      $$("[data-rating]").forEach(button => button.classList.toggle("is-active", Number(button.dataset.rating) <= (book?.rating || 0)));
    }

    const themeButton = event.target.closest("[data-theme]");
    if (themeButton) applyTheme(themeButton.dataset.theme);
  });

  $("#open-add").addEventListener("click", () => openAddDialog());
  $("#bottom-add").addEventListener("click", () => openAddDialog());
  $("#search-toggle").addEventListener("click", () => { $("#search-panel").hidden = false; $("#library-search").focus(); });
  $("#close-search").addEventListener("click", () => { query = ""; $("#library-search").value = ""; $("#search-panel").hidden = true; renderBooks(); });
  $("#library-search").addEventListener("input", event => { query = event.target.value; renderBooks(); });
  $("#sort-books").addEventListener("change", renderBooks);
  $("#catalog-search").addEventListener("input", event => renderCatalog(event.target.value));
  $("#start-camera").addEventListener("click", startCamera);
  $("#demo-scan").addEventListener("click", showScanResult);
  $("#scan-result").addEventListener("click", event => { if (event.target.closest("#add-scan-result")) addCatalogBook(catalogBooks[1], "バーコード"); });

  $("#manual-form").addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const status = String(data.get("status"));
    books.unshift({ id: crypto.randomUUID(), title: String(data.get("title")).trim(), author: String(data.get("author")).trim(), isbn: "", genre: String(data.get("genre")), pages: Number(data.get("pages") || 0), status, rating: Number(data.get("rating") || 0), finishedAt: status === "read" ? String(data.get("finishedAt") || new Date().toISOString().slice(0,10)) : "", createdAt: new Date().toISOString().slice(0,10), notes: "", review: "", cover: books.length % 6 });
    persist();
    renderAll();
    event.currentTarget.reset();
    closeDialog("add-dialog");
    showToast("新しい本を追加しました");
  });

  $("#export-csv").addEventListener("click", exportCsv);
  $("#export-json").addEventListener("click", exportJson);
  $("#import-json").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", event => { if (event.target.files[0]) importJson(event.target.files[0]); event.target.value = ""; });
  $("#goal-minus").addEventListener("click", () => { settings.goal = Math.max(1, settings.goal - 1); persist(); updateGoalUI(); });
  $("#goal-plus").addEventListener("click", () => { settings.goal = Math.min(999, settings.goal + 1); persist(); updateGoalUI(); });
  $("#synopsis-toggle").addEventListener("change", event => { settings.synopsis = event.target.checked; persist(); showToast("設定を保存しました"); });
  $("#show-science-books").addEventListener("click", () => { navigate("shelf"); setFilter("read"); query = "自然科学"; $("#search-panel").hidden = false; $("#library-search").value = query; renderBooks(); });

  $$('dialog').forEach(dialog => dialog.addEventListener("click", event => {
    if (event.target === dialog) closeDialog(dialog.id);
  }));
  $("#add-dialog").addEventListener("close", stopCamera);
}

function initialize() {
  const now = new Date();
  $("#today-label").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now).toUpperCase();
  applyTheme(settings.theme);
  initializeEvents();
  renderCatalog("");
  renderAll();
  setTimeout(iconize, 150);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", initialize);
