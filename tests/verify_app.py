from contextlib import contextmanager
import csv
from datetime import date
import io
import json
from pathlib import Path
import subprocess
from time import sleep
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
BASE_URL = "http://127.0.0.1:4173"


@contextmanager
def preview_server():
    process = subprocess.Popen(
        ["npm.cmd", "run", "preview", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    try:
        for _ in range(80):
            if process.poll() is not None:
                raise RuntimeError("Vite preview server stopped before becoming ready")
            try:
                with urlopen(BASE_URL, timeout=1) as response:
                    if response.status == 200:
                        break
            except Exception:
                sleep(0.25)
        else:
            raise RuntimeError("Timed out waiting for the Vite preview server")
        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def open_with_retry(page) -> None:
    for attempt in range(3):
        try:
            page.goto(BASE_URL, wait_until="networkidle")
            return
        except Exception:
            if attempt == 2:
                raise
            sleep(0.5)


def run() -> None:
    ARTIFACTS.mkdir(exist_ok=True)
    errors = []
    today = date.today().isoformat()

    with preview_server(), sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        )
        context = browser.new_context(
            viewport={"width": 360, "height": 800},
            accept_downloads=True,
            service_workers="block",
        )
        page = context.new_page()
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))

        openbd_records = {}
        google_books_covers = {
            "9784003210543": "https://books.google.com/books/content?id=GB-YOMU-IWANAMI&printsec=frontcover&img=1&zoom=5",
        }
        manual_search_requests = []
        open_library_docs = {
            "境界を歩く 佐伯 凛": [
                {
                    "key": "/works/OL-YOMU-1W",
                    "title": "境界を歩く",
                    "author_name": ["佐伯 凛"],
                    "publisher": ["検索出版社"],
                    "isbn": ["9784101010014"],
                    "number_of_pages_median": 180,
                    "cover_i": 101,
                },
                {
                    "key": "/works/OL-YOMU-2W",
                    "title": "境界を歩く 新装版",
                    "author_name": ["佐伯 凛"],
                    "publisher": ["岩波書店"],
                    "isbn": ["9784003210543"],
                    "number_of_pages_median": 224,
                },
                {
                    "key": "/works/OL-YOMU-3W",
                    "title": "境界を歩く研究",
                    "author_name": ["研究会"],
                    "publisher": ["検索出版社"],
                    "isbn": [],
                    "number_of_pages_median": 144,
                },
            ],
        }

        def handle_openbd(route):
            isbn = parse_qs(urlparse(route.request.url).query).get("isbn", [""])[0]
            record = openbd_records.get(isbn)
            route.fulfill(status=200, content_type="application/json", body=json.dumps([record] if record else [None], ensure_ascii=False))

        def handle_open_library(route):
            parameters = parse_qs(urlparse(route.request.url).query)
            query = parameters.get("q", [""])[0]
            manual_search_requests.append(parameters)
            documents = open_library_docs.get(query, [])
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"numFound": len(documents), "docs": documents}, ensure_ascii=False))

        def handle_google_books(route):
            parameters = parse_qs(urlparse(route.request.url).query)
            bib_key = parameters.get("bibkeys", [""])[0]
            callback = parameters.get("callback", [""])[0]
            cover_url = google_books_covers.get(bib_key.removeprefix("ISBN:"), "")
            payload = {
                bib_key: {
                    "bib_key": bib_key,
                    "thumbnail_url": cover_url,
                    "info_url": "https://books.google.com/books?vid=" + bib_key,
                },
            } if bib_key and cover_url else {}
            route.fulfill(status=200, content_type="application/javascript", body=f"{callback}({json.dumps(payload)});")

        page.route("https://api.openbd.jp/v1/get?*", handle_openbd)
        page.route("https://books.google.com/books?*", handle_google_books)
        page.route("https://books.google.com/books/content?*", lambda route: route.fulfill(path=str(ROOT / "public" / "assets" / "app-icon-192.png"), content_type="image/png"))
        page.route("https://openlibrary.org/search.json?*", handle_open_library)
        page.route("https://covers.openlibrary.org/b/id/*", lambda route: route.fulfill(path=str(ROOT / "public" / "assets" / "app-icon-192.png"), content_type="image/png"))

        open_with_retry(page)
        page.locator("#shelf-title").wait_for()

        # A real first-time user starts with an empty, actionable shelf.
        assert page.locator("#book-grid .book-card").count() == 0
        assert page.locator("#read-count").inner_text() == "0"
        assert "最初の一冊" in page.locator("#empty-title").inner_text()
        assert page.locator("#empty-add-isbn").is_visible()
        assert page.locator("#empty-add-manual").is_visible()
        assert page.locator("#demo-scan").count() == 0
        stored_empty = page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2'))")
        assert stored_empty == {"schemaVersion": 2, "books": []}
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.wait_for_timeout(250)
        page.screenshot(path=str(ARTIFACTS / "mobile-empty-shelf.png"), full_page=True)

        # Search by title/author, reflect the selected metadata into the manual form,
        # then register a complete reading record and prove it survives reload.
        page.locator("#empty-add-manual").click()
        form = page.locator("#manual-form")
        page.locator("#manual-book-query").fill("境界を歩く 佐伯 凛")
        page.locator("#manual-book-search").click()
        manual_result = page.get_by_role("button", name="境界を歩くを入力欄に反映")
        manual_result.wait_for()
        assert page.locator("#manual-search-results .manual-search-result").count() == 3
        assert manual_search_requests[-1]["limit"] == ["24"]
        page.wait_for_function("document.querySelectorAll('#manual-search-results .result-cover.has-real-cover').length >= 2")
        assert page.locator("#manual-search-ndl").is_visible()
        page.screenshot(path=str(ARTIFACTS / "mobile-title-author-search.png"), full_page=True)
        manual_result.click()
        assert page.locator("#manual-confirm-stage").is_visible()
        assert not page.locator("#manual-search-stage").is_visible()
        assert not page.locator("#manual-details").get_attribute("open")
        assert "境界を歩く" in page.locator("#manual-selected-summary").inner_text()
        page.screenshot(path=str(ARTIFACTS / "mobile-title-author-confirm.png"), full_page=True)
        assert form.locator("[name=title]").input_value() == "境界を歩く"
        assert form.locator("[name=author]").input_value() == "佐伯 凛"
        assert form.locator("[name=publisher]").input_value() == "検索出版社"
        assert form.locator("[name=isbn]").input_value() == "9784101010014"
        page.locator("#manual-details summary").click()
        form.locator("[name=genre]").fill("文学・小説")
        form.locator("[name=pages]").fill("180")
        form.locator("[name=finishedAt]").fill(today)
        form.locator("[name=rating]").select_option("5")
        form.locator("[name=notes]").fill("42ページの引用を読み返す")
        form.locator("[name=review]").fill("静かな余韻が残った。")
        form.locator("button[type=submit]").click()
        page.locator("#edit-book").wait_for()
        assert page.locator("#book-grid .book-card").count() == 1
        assert page.locator("#read-count").inner_text() == "1"
        page.reload(wait_until="networkidle")
        assert page.locator("#book-grid .book-card").count() == 1
        assert page.locator("#book-grid .book-cover.has-real-cover").count() == 1
        assert page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books[0].coverSource") == "openlibrary"

        page.get_by_role("button", name="境界を歩くの詳細を開く").click()
        page.locator("#edit-book").click()
        page.locator("#detail-metadata summary").click()
        detail = page.locator("#detail-form")
        detail.locator('[name="isbn"]').fill("123")
        page.locator("#save-book").click()
        assert page.locator("#detail-dialog").is_visible()
        assert "ISBN-10" in detail.locator('[name="isbn"]').evaluate("input => input.validationMessage")
        detail.locator('[name="isbn"]').fill("9784101010014")
        detail.locator('[name="pages"]').fill("192")
        detail.locator('[name="publisher"]').fill("検証出版社")
        detail.locator('[name="notes"]').fill("検証用の読書メモ")
        detail.get_by_role("button", name="評価4").click()
        page.locator("#save-book").click()
        page.locator("#edit-book").wait_for()
        page.locator("#edit-book").click()
        page.locator("#detail-metadata summary").click()
        saved_isbn = page.locator('#detail-form [name="isbn"]').input_value()
        assert saved_isbn == "9784101010014", saved_isbn
        assert page.locator('#detail-form [name="pages"]').input_value() == "192"
        assert page.locator('#detail-form [name="publisher"]').input_value() == "検証出版社"
        assert page.locator("#detail-form").get_attribute("data-rating") == "4"
        page.locator('#detail-dialog [data-close="detail-dialog"]').click()

        # ISBN lookup uses real openBD-shaped data and can register directly to a shelf.
        openbd_isbn = "9784873113364"
        openbd_records[openbd_isbn] = {
            "summary": {
                "title": "型で育てる読書記録",
                "author": "OpenBD 著者",
                "publisher": "検証出版社",
                "isbn": openbd_isbn,
                "cover": "",
            },
            "onix": {
                "DescriptiveDetail": {"Extent": {"ExtentValue": "256"}},
                "CollateralDetail": {"TextContent": {"Text": {"content": "検証用の内容紹介"}}},
            },
        }
        google_books_covers[openbd_isbn] = "https://books.google.com/books/content?id=GB-YOMU-ISBN&printsec=frontcover&img=1&zoom=5"
        page.locator("#bottom-add").click()
        page.evaluate(
            f"""() => {{
                const canvas = document.createElement('canvas');
                canvas.width = 320;
                canvas.height = 180;
                const context = canvas.getContext('2d');
                let frame = 0;
                window.__yomuCameraTestTimer = window.setInterval(() => {{
                    context.fillStyle = frame++ % 2 ? '#111' : '#222';
                    context.fillRect(0, 0, canvas.width, canvas.height);
                }}, 100);
                const stream = canvas.captureStream(5);
                window.__yomuCameraTestCanvas = canvas;
                Object.defineProperty(navigator, 'mediaDevices', {{
                    configurable: true,
                    value: {{ getUserMedia: async () => stream }},
                }});
                window.BarcodeDetector = class {{
                    async detect() {{
                        await new Promise(resolve => setTimeout(resolve, 700));
                        return [{{ rawValue: '{openbd_isbn}' }}];
                    }}
                }};
            }}"""
        )
        page.locator("#start-barcode-scan").click()
        page.locator("#barcode-scanner").wait_for()
        page.screenshot(path=str(ARTIFACTS / "mobile-isbn-camera.png"), full_page=True)
        result_button = page.get_by_role("button", name="型で育てる読書記録を確認して追加")
        result_button.wait_for()
        assert page.locator("#catalog-search").input_value() == openbd_isbn
        page.wait_for_function("document.querySelectorAll('#catalog-results .result-cover.has-real-cover').length === 1")
        result_button.click()
        page.locator('#manual-form [name="status"]').select_option("wishlist")
        page.locator('#manual-form button[type="submit"]').click()
        page.locator("#edit-book").wait_for()
        page.locator('#detail-dialog [data-close]').click()
        page.locator('#detail-dialog').wait_for(state="hidden")
        page.locator('[data-filter="wishlist"]').click()
        assert page.locator("#book-grid .book-card").count() == 1
        page.wait_for_function("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books.some(book => book.isbn === '9784873113364' && book.coverSource === 'googlebooks')")
        assert page.locator("#book-grid .book-cover.has-real-cover").count() == 1

        # Repeating the same ISBN must not create another record.
        page.locator("#bottom-add").click()
        page.locator("#catalog-search").fill("")
        page.locator("#catalog-search").fill(openbd_isbn)
        duplicate_button = page.get_by_role("button", name="型で育てる読書記録を確認して追加")
        duplicate_button.wait_for()
        duplicate_button.click()
        page.locator('#manual-form button[type="submit"]').click()
        assert "すでに本棚にあります" in page.locator("#add-feedback").inner_text()
        page.locator('#add-dialog [data-close="add-dialog"]').click()
        page.locator('[data-filter="read"]').click()

        page.locator(".bottom-nav [data-nav=analytics]").click()
        assert page.locator("#analytics-total").inner_text() == "1"
        assert page.locator("#genre-legend .legend-row").count() == 1
        assert "文学・小説" in page.locator("#analytics-summary").inner_text()
        assert page.evaluate("[...document.querySelectorAll('dialog')].every(dialog => !dialog.open)")
        page.wait_for_function("!document.querySelector('#toast').classList.contains('is-visible')")
        page.wait_for_timeout(250)
        page.screenshot(path=str(ARTIFACTS / "mobile-analytics.png"), full_page=True)

        page.locator('#genre-legend [data-analytics-genre="文学・小説"]').click()
        assert page.locator("#screen-shelf").get_attribute("class").find("is-active") >= 0
        assert "文学・小説" in page.locator("#active-filter-bar").inner_text()
        assert page.locator("#book-grid .book-card").count() == 1
        page.locator("#clear-all-filters").click()
        assert page.locator("#active-filter-bar").is_hidden()

        page.locator(".bottom-nav [data-nav=analytics]").click()
        page.locator(f'[data-analytics-month="{today[:7]}"]').click()
        assert f"{today[:4]}年{int(today[5:7])}月" in page.locator("#active-filter-bar").inner_text()
        assert page.locator("#book-grid .book-card").count() == 1
        page.locator("#clear-all-filters").click()

        page.locator("#filter-toggle").click()
        page.locator("#filter-genre").select_option(label="文学・小説")
        page.locator("#filter-rating").select_option("4")
        page.locator("#filter-month").fill(today[:7])
        page.locator("#filter-month").dispatch_event("change")
        page.screenshot(path=str(ARTIFACTS / "mobile-filter-draft.png"))
        page.locator("#apply-filters").click()
        page.locator("#filter-panel").wait_for(state="hidden")
        assert page.locator("#filter-count").inner_text() == "3"
        assert page.locator("#book-grid .book-card").count() == 1
        page.screenshot(path=str(ARTIFACTS / "mobile-shelf-filters.png"), full_page=True)
        page.locator("#filter-toggle").click()
        page.locator("#clear-criteria").click()
        page.locator("#apply-filters").click()
        page.locator("#filter-panel").wait_for(state="hidden")
        assert page.locator("#filter-count").is_hidden()
        page.wait_for_timeout(250)
        page.screenshot(path=str(ARTIFACTS / "mobile-shelf.png"), full_page=True)

        # Import/export is the user's backup and migration path.
        page.locator(".bottom-nav [data-nav=settings]").click()
        assert page.locator("#install-app").is_visible()
        assert "ホーム画面" in page.locator("#install-status").inner_text()
        page.locator("#install-app").click()
        assert "ホーム画面に追加" in page.locator("#toast").inner_text()
        csv_buffer = io.StringIO(newline="")
        csv_writer = csv.writer(csv_buffer)
        csv_writer.writerow(["境界を歩く", "", "佐伯 凛", "", "検証出版社", "9784101010014", today.replace("-", "/"), "重複", "", "", "", today.replace("-", "/"), "0", "4"])
        csv_writer.writerow(["CSVから来た本", "", "取込 著者", "", "検証出版社", "", today.replace("-", "/"), "取込メモ", "感想の一行目\n二行目", "", "", today.replace("-", "/"), "0", "4"])
        csv_writer.writerow(["列不足"])
        page.locator("#import-csv-file").set_input_files({
            "name": "biblia-books.csv",
            "mimeType": "text/csv",
            "buffer": csv_buffer.getvalue().encode("utf-8"),
        })
        page.locator("#import-summary").wait_for(state="visible")
        import_summary = page.locator("#import-summary").inner_text()
        assert "ビブリア形式" in import_summary
        assert "追加 1件" in import_summary
        assert "重複スキップ 1件" in import_summary
        assert "無効行 1件" in import_summary

        with page.expect_download() as csv_download:
            page.locator("#export-csv").click()
        export_path = ARTIFACTS / "test-export.csv"
        csv_download.value.save_as(str(export_path))
        page.locator("#import-csv-file").set_input_files(str(export_path))
        page.wait_for_function("document.querySelector('#import-summary').textContent.includes('重複スキップ 3件')")
        assert "YOMU形式" in page.locator("#import-summary").inner_text()
        assert "追加 0件" in page.locator("#import-summary").inner_text()

        with page.expect_download() as json_download:
            page.locator("#export-json").click()
        backup_path = ARTIFACTS / "test-backup.json"
        json_download.value.save_as(str(backup_path))
        backup_data = json.loads(backup_path.read_text(encoding="utf-8"))
        assert backup_data["schemaVersion"] == 2
        assert len(backup_data["books"]) == 3
        assert any(book.get("coverSource") == "openlibrary" and book.get("coverUrl") for book in backup_data["books"])
        assert any(book.get("coverSource") == "googlebooks" and book.get("coverUrl") for book in backup_data["books"])

        page.wait_for_function("!document.querySelector('#toast').classList.contains('is-visible')")
        page.wait_for_timeout(250)
        page.screenshot(path=str(ARTIFACTS / "mobile-settings.png"), full_page=True)

        page.set_viewport_size({"width": 1440, "height": 1000})
        page.locator(".side-nav [data-nav=analytics]").click()
        assert page.locator("#analytics-total").inner_text() == "2"
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.wait_for_timeout(250)
        page.screenshot(path=str(ARTIFACTS / "desktop-analytics.png"), full_page=True)

        page.set_viewport_size({"width": 768, "height": 1024})
        page.locator(".side-nav [data-nav=shelf]").click()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.wait_for_timeout(250)
        page.screenshot(path=str(ARTIFACTS / "tablet-shelf.png"), full_page=True)

        manifest = page.request.get(f"{BASE_URL}/manifest.json")
        assert manifest.ok
        manifest_data = manifest.json()
        assert manifest_data["display"] == "standalone"
        assert manifest_data["id"] == "./"
        assert {icon["sizes"] for icon in manifest_data["icons"]} == {"192x192", "512x512"}
        assert page.evaluate(
            """async () => {
                const dimensions = await Promise.all([
                    ['assets/app-icon-192.png', 192],
                    ['assets/app-icon-512.png', 512],
                ].map(([src, expected]) => new Promise((resolve, reject) => {
                    const image = new Image();
                    image.onload = () => resolve(image.naturalWidth === expected && image.naturalHeight === expected);
                    image.onerror = reject;
                    image.src = src;
                })));
                return dimensions.every(Boolean);
            }"""
        )
        assert not errors, f"Browser errors: {errors}"
        context.close()

        # Existing records receive real covers in the background. Exact metadata
        # matching, source fallback, cooldown, manual retry, and broken images are covered.
        cover_context = browser.new_context(viewport={"width": 768, "height": 1024}, service_workers="block")
        cover_page = cover_context.new_page()
        cover_page.add_init_script(
            """(() => {
                if (localStorage.getItem('yomu-reading-archive:v2')) return;
                const common = {genre:'その他', pages:100, status:'read', rating:0, finishedAt:'2026-08-01', createdAt:'2026-08-01', notes:'', review:'', cover:0};
                localStorage.setItem('yomu-reading-archive:v2', JSON.stringify({schemaVersion:2, books:[
                    {...common, id:'openbd-cover', title:'openBD表紙本', author:'表紙 著者', isbn:'9784873113364'},
                    {...common, id:'google-cover', title:'Google Books表紙本', author:'書影 著者', isbn:'9784101010014', cover:1, coverLookupKey:'isbn:9784101010014', coverCheckedAt:'2026-08-30T00:00:00.000Z'},
                    {...common, id:'openlibrary-cover', title:'Open Library表紙本', author:'補完 著者', isbn:'9784873115658', cover:2},
                    {...common, id:'metadata-cover', title:'一致タイトル', author:'一致 著者', isbn:'', cover:2},
                    {...common, id:'wrong-cover', title:'違う候補', author:'正しい 著者', isbn:'', cover:3},
                    {...common, id:'google-mismatch', title:'不一致後補完', author:'厳密 著者', isbn:'9784495210465', cover:3},
                    {...common, id:'google-timeout', title:'タイムアウト後補完', author:'再試行 著者', isbn:'9784065243305', cover:4},
                    {...common, id:'broken-cover', title:'壊れた表紙', author:'画像 著者', isbn:'', cover:4, coverUrl:'https://cover.test/broken.png', coverSource:'openbd'},
                    {...common, id:'network-error', title:'通信失敗', author:'再試行 著者', isbn:'', cover:5}
                ]}));
            })()"""
        )
        cover_open_library_docs = {
            "9784873115658": [{
                "key": "/books/OL-FALLBACK",
                "title": "Open Library表紙本",
                "author_name": ["補完 著者"],
                "isbn": ["9784873115658"],
                "cover_i": 202,
            }],
            "9784495210465": [{
                "key": "/books/OL-MISMATCH-FALLBACK",
                "title": "不一致後補完",
                "author_name": ["厳密 著者"],
                "isbn": ["9784495210465"],
                "cover_i": 505,
            }],
            "9784065243305": [{
                "key": "/books/OL-TIMEOUT-FALLBACK",
                "title": "タイムアウト後補完",
                "author_name": ["再試行 著者"],
                "isbn": ["9784065243305"],
                "cover_i": 606,
            }],
            "一致タイトル 一致 著者": [{
                "key": "/books/OL-METADATA",
                "title": "一致タイトル",
                "author_name": ["一致 著者"],
                "isbn": [],
                "cover_i": 303,
            }],
            "違う候補 正しい 著者": [{
                "key": "/books/OL-WRONG",
                "title": "別の本",
                "author_name": ["正しい 著者"],
                "isbn": [],
                "cover_i": 404,
            }],
        }
        cover_google_books_covers = {
            "9784101010014": "https://books.google.com/books/content?id=GB-COVER&printsec=frontcover&img=1&zoom=5",
        }
        cover_api_requests = []

        def handle_cover_openbd(route):
            isbn = parse_qs(urlparse(route.request.url).query).get("isbn", [""])[0]
            cover_api_requests.append(("openbd", isbn))
            if isbn == "9784873113364":
                record = {"summary": {"title": "openBD表紙本", "author": "表紙 著者", "isbn": isbn, "cover": "https://cover.test/openbd.png"}}
            else:
                record = None
            route.fulfill(status=200, content_type="application/json", body=json.dumps([record] if record else [None], ensure_ascii=False))

        def handle_cover_google_books(route):
            parameters = parse_qs(urlparse(route.request.url).query)
            bib_key = parameters.get("bibkeys", [""])[0]
            callback = parameters.get("callback", [""])[0]
            isbn = bib_key.removeprefix("ISBN:")
            cover_api_requests.append(("googlebooks", isbn))
            if isbn == "9784065243305":
                route.fulfill(status=200, content_type="application/javascript", body="")
                return
            if isbn == "9784495210465":
                payload = {bib_key: {
                    "bib_key": "ISBN:9780000000000",
                    "thumbnail_url": "https://books.google.com/books/content?id=WRONG&img=1",
                }}
            else:
                cover_url = cover_google_books_covers.get(isbn, "")
                payload = {bib_key: {"bib_key": bib_key, "thumbnail_url": cover_url}} if cover_url else {}
            route.fulfill(status=200, content_type="application/javascript", body=f"{callback}({json.dumps(payload)});")

        def handle_cover_open_library(route):
            query = parse_qs(urlparse(route.request.url).query).get("q", [""])[0]
            cover_api_requests.append(("openlibrary", query))
            if query == "通信失敗 再試行 著者":
                route.abort("timedout")
                return
            documents = cover_open_library_docs.get(query, [])
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"numFound": len(documents), "docs": documents}, ensure_ascii=False))

        def handle_cover_image(route):
            if route.request.url.endswith("/broken.png"):
                route.fulfill(status=404, content_type="image/png", body=b"")
            else:
                route.fulfill(path=str(ROOT / "public" / "assets" / "app-icon-192.png"), content_type="image/png")

        cover_page.route("https://api.openbd.jp/v1/get?*", handle_cover_openbd)
        cover_page.route("https://books.google.com/books?*", handle_cover_google_books)
        cover_page.route("https://books.google.com/books/content?*", handle_cover_image)
        cover_page.route("https://openlibrary.org/search.json?*", handle_cover_open_library)
        cover_page.route("https://covers.openlibrary.org/b/id/*", handle_cover_image)
        cover_page.route("https://cover.test/*", handle_cover_image)
        open_with_retry(cover_page)
        try:
            cover_page.wait_for_function(
                """() => {
                    const books = JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books;
                    const byId = Object.fromEntries(books.map(book => [book.id, book]));
                    return byId['openbd-cover'].coverSource === 'openbd'
                        && byId['google-cover'].coverSource === 'googlebooks'
                        && byId['google-cover'].coverLookupKey === 'v2:isbn:9784101010014'
                        && byId['openlibrary-cover'].coverSource === 'openlibrary'
                        && byId['metadata-cover'].coverSource === 'openlibrary'
                        && byId['google-mismatch'].coverSource === 'openlibrary'
                        && byId['google-timeout'].coverSource === 'openlibrary'
                        && byId['wrong-cover'].coverCheckedAt && !byId['wrong-cover'].coverUrl
                        && byId['broken-cover'].coverUrl === 'https://cover.test/broken.png';
                }"""
            )
        except Exception:
            print(json.dumps({
                "cover_books": cover_page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books"),
                "cover_requests": cover_api_requests,
            }, ensure_ascii=False, indent=2))
            raise
        cover_page.wait_for_function("!document.querySelector('[data-book-id=\"broken-cover\"] .book-cover').classList.contains('has-real-cover')")
        assert cover_page.locator("#book-grid .book-cover.has-real-cover").count() == 6
        assert not cover_page.locator('[data-book-id="openbd-cover"] .cover-copy').is_visible()
        assert cover_page.locator('[data-book-id="wrong-cover"] .real-cover-image').count() == 0
        cover_page.wait_for_timeout(1200)
        assert ("googlebooks", "9784101010014") in cover_api_requests
        assert ("openlibrary", "9784101010014") not in cover_api_requests
        assert ("googlebooks", "9784873115658") in cover_api_requests
        assert ("openlibrary", "9784873115658") in cover_api_requests
        assert ("googlebooks", "9784495210465") in cover_api_requests
        assert ("openlibrary", "9784495210465") in cover_api_requests
        assert ("googlebooks", "9784065243305") in cover_api_requests
        assert ("openlibrary", "9784065243305") in cover_api_requests
        assert ("openlibrary", "通信失敗 再試行 著者") in cover_api_requests
        assert not cover_page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books.find(book => book.id === 'network-error').coverCheckedAt")

        cover_page.get_by_role("button", name="Google Books表紙本の詳細を開く").click()
        cover_page.locator(".record-metadata summary").click()
        assert "Google Books" in cover_page.locator("#detail-cover-source").inner_text()
        cover_page.locator('#detail-dialog [data-close="detail-dialog"]').click()

        cover_page.get_by_role("button", name="違う候補の詳細を開く").click()
        cover_open_library_docs["違う候補 正しい 著者"] = [{
            "key": "/books/OL-CORRECTED",
            "title": "違う候補",
            "author_name": ["正しい 著者"],
            "isbn": [],
            "cover_i": 404,
        }]
        cover_page.locator(".record-metadata summary").click()
        cover_page.get_by_role("button", name="表紙を再取得").click()
        cover_page.wait_for_function("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books.find(book => book.id === 'wrong-cover').coverSource === 'openlibrary'")
        assert "Open Library" in cover_page.locator("#detail-cover-source").inner_text()
        assert cover_page.locator("#detail-cover-visual.has-real-cover").count() == 1
        cover_page.screenshot(path=str(ARTIFACTS / "tablet-real-book-covers.png"), full_page=True)
        cover_page.locator('#detail-dialog [data-close="detail-dialog"]').click()
        cover_page.wait_for_timeout(500)
        image_state_before_reload = cover_page.evaluate("[...document.querySelectorAll('[data-cover-image]')].map(image => ({src:image.getAttribute('src'), complete:image.complete, width:image.naturalWidth, hidden:image.hidden, connected:image.isConnected}))")
        assert cover_page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books.filter(book => book.coverUrl).length") == 8, image_state_before_reload

        request_count_before_reload = len(cover_api_requests)
        covers_before_reload = cover_page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books.map(({id, coverUrl, coverSource, coverCheckedAt}) => ({id, coverUrl, coverSource, coverCheckedAt}))")
        cover_page.reload(wait_until="networkidle")
        cover_page.wait_for_timeout(1600)
        covers_after_reload = cover_page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books.map(({id, coverUrl, coverSource, coverCheckedAt}) => ({id, coverUrl, coverSource, coverCheckedAt}))")
        assert cover_api_requests[request_count_before_reload:] == [("openlibrary", "通信失敗 再試行 著者")], {"requests": cover_api_requests, "before": covers_before_reload, "after": covers_after_reload}
        assert cover_page.locator("#book-grid .book-cover.has-real-cover").count() == 7
        cover_context.close()

        # v1 data is migrated without deleting the legacy source.
        migration_context = browser.new_context(viewport={"width": 360, "height": 800}, service_workers="block")
        migration_page = migration_context.new_page()
        migration_page.add_init_script(
            """(() => {
                localStorage.setItem('yomu-reading-archive:v1', JSON.stringify([{
                    id: 'legacy-1', title: '旧形式の本', author: '移行テスト', isbn: '978-4-10-101001-4',
                    genre: 'テスト', pages: -20, status: 'read', rating: 9,
                    finished_at: '2025-12-31', created_at: '2025-01-01', notes: '', review: '', cover: 12
                }]));
                localStorage.setItem('yomu-settings:v1', JSON.stringify({theme: 'dark', goal: 1200, synopsis: false}));
            })()"""
        )
        open_with_retry(migration_page)
        assert migration_page.locator("#book-grid .book-card").count() == 1
        migrated_library = migration_page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2'))")
        migrated_settings = migration_page.evaluate("JSON.parse(localStorage.getItem('yomu-settings:v2'))")
        assert migrated_library["schemaVersion"] == 2
        assert migrated_library["books"][0]["rating"] == 5
        assert migrated_library["books"][0]["pages"] == 0
        assert migrated_library["books"][0]["cover"] == 5
        assert migrated_settings == {"theme": "dark", "goal": 999, "synopsis": False}
        assert migration_page.evaluate("localStorage.getItem('yomu-reading-archive:v1') !== null")
        migration_context.close()

        # Exact old demo rows are removed once, while a user's own row is retained.
        cleanup_context = browser.new_context(viewport={"width": 360, "height": 800}, service_workers="block")
        cleanup_page = cleanup_context.new_page()
        cleanup_page.add_init_script(
            """(() => {
                const common = {isbn:'', genre:'その他', pages:0, status:'read', rating:0, finishedAt:'2026-01-01', createdAt:'2026-01-01', notes:'', review:'', cover:0};
                localStorage.setItem('yomu-reading-archive:v2', JSON.stringify({schemaVersion:2, books:[
                    {...common, id:'b01', title:'灯りのない窓辺', author:'架空 著者'},
                    {...common, id:'my-book', title:'残すべき私の本', author:'利用者'}
                ]}));
            })()"""
        )
        open_with_retry(cleanup_page)
        assert cleanup_page.locator("#book-grid .book-card").count() == 1
        assert cleanup_page.get_by_text("残すべき私の本", exact=True).count() >= 1
        assert cleanup_page.get_by_text("灯りのない窓辺", exact=True).count() == 0
        cleaned_library = cleanup_page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2'))")
        assert len(cleaned_library["books"]) == 1
        assert cleanup_page.evaluate("localStorage.getItem('yomu-demo-library-cleanup:v1') === '1'")
        cleanup_context.close()

        # The application shell and existing records remain available offline.
        pwa_context = browser.new_context(viewport={"width": 360, "height": 800})
        pwa_page = pwa_context.new_page()
        pwa_errors = []
        pwa_page.on("console", lambda message: pwa_errors.append(message.text) if message.type == "error" else None)
        pwa_page.on("pageerror", lambda error: pwa_errors.append(str(error)))
        pwa_page.on("requestfailed", lambda request: pwa_errors.append(f"{request.url}: {request.failure}"))
        open_with_retry(pwa_page)
        pwa_page.evaluate("navigator.serviceWorker.ready")
        pwa_page.wait_for_function("navigator.serviceWorker.controller !== null")
        cached_urls = pwa_page.evaluate("async () => { const names = await caches.keys(); const entries = await Promise.all(names.map(async key => (await (await caches.open(key)).keys()).map(request => request.url))); return entries.flat(); }")
        assert all(url.startswith(BASE_URL) for url in cached_urls), cached_urls
        pwa_context.set_offline(True)
        pwa_page.reload(wait_until="domcontentloaded")
        assert pwa_page.locator("#shelf-title").inner_text() == "わたしの本棚"
        pwa_page.wait_for_timeout(1000)
        offline_ready = pwa_page.locator("#empty-add-manual").is_visible()
        assert offline_ready, {"cached": cached_urls, "errors": pwa_errors, "stored": pwa_page.evaluate("localStorage.getItem('yomu-reading-archive:v2')")}
        pwa_context.close()
        from verify_mobile_ux import run_mobile_ux
        run_mobile_ux(browser, BASE_URL, ARTIFACTS)
        browser.close()

    print("PASS: reading-first mobile UX, staged mobile add, candidate covers, shelf filters, analytics drill-down, camera ISBN, persistence, migration, exports, offline PWA, and responsive layouts")


if __name__ == "__main__":
    run()
