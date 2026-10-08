"""Regression scenarios for the mobile reading and navigation experience."""
import json
from datetime import date

from playwright.sync_api import expect


def make_books(count):
    today = date.today().isoformat()
    return [dict(
        id=f"ux-{i}", title=("森と暮らす、小さな時間" if i == 0 else f"読書の記録 {i:04d}"),
        author="検証 著者", isbn="", genre="文学・小説" if i % 2 == 0 else "歴史", pages=240,
        status=["read", "reading", "wishlist"][i % 3], rating=i % 5 + 1,
        finishedAt=today if i % 3 == 0 else "", createdAt=today,
        notes="風の記憶をたどる引用。\n120ページを読み返す。" if i == 0 else "記録した言葉。",
        review="日々の暮らしの中で見過ごしてしまう小さな景色に、目を向けたくなりました。\n\n時間をおいて、もう一度読みたい一冊です。" if i == 0 else f"読んだ本 {i} の感想。",
        cover=i % 6,
    ) for i in range(count)]


def run_mobile_ux(browser, base_url, artifacts):
    errors = []
    contexts = []

    def new_page(count=0):
        context = browser.new_context(viewport={"width": 360, "height": 800}, has_touch=True, is_mobile=True, service_workers="block")
        contexts.append(context)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(error.stack or str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.route("https://openlibrary.org/**", lambda route: route.fulfill(json={"docs": []}))
        page.route("https://api.openbd.jp/**", lambda route: route.fulfill(json=[None]))
        if count:
            payload = json.dumps({"schemaVersion": 2, "books": make_books(count)}, ensure_ascii=False)
            page.add_init_script(f"if (!localStorage.getItem('yomu-reading-archive:v2')) localStorage.setItem('yomu-reading-archive:v2', {json.dumps(payload)});")
        page.goto(base_url, wait_until="networkidle")
        return context, page

    def close_detail(page):
        page.locator('#detail-dialog [data-close]').click()
        expect(page.locator('#detail-dialog')).not_to_be_visible()

    def back(page):
        page.evaluate("history.back()")

    def scroll_is_uncovered(page, selector):
        box = page.locator(selector).bounding_box()
        footer = page.locator('.bottom-nav').bounding_box()
        assert box and footer and box['y'] + box['height'] <= footer['y'], (selector, box, footer)

    _, empty = new_page()
    expect(empty.locator('[data-filter=all]')).to_have_attribute('aria-selected', 'true')
    scroll_is_uncovered(empty, '#empty-add-isbn')
    scroll_is_uncovered(empty, '#empty-add-manual')
    empty.screenshot(path=str(artifacts / 'ux-empty.png'))

    context, page = new_page(120)
    expect(page.locator('.book-card')).to_have_count(120)
    assert page.locator('.book-card').first.bounding_box()['y'] <= 300
    scroll_is_uncovered(page, '.book-card:first-child .book-date')
    page.screenshot(path=str(artifacts / 'ux-shelf.png'))

    # Search and read personal notes with no network connection.
    context.set_offline(True)
    page.locator('#library-search').fill('風の記憶')
    expect(page.locator('.book-card')).to_have_count(1)
    page.locator('[data-book-id="ux-0"]').click()
    expect(page.locator('#detail-form')).to_have_count(0)
    expect(page.locator('.record-prose').first).to_contain_text('日々の暮らし')
    assert page.locator('.record-section').first.bounding_box()['y'] < 400
    page.screenshot(path=str(artifacts / 'ux-detail.png'))
    page.locator('#edit-book').click()
    page.locator('#detail-form [name=review]').fill('まだ保存していない感想')
    before = page.evaluate('history.state.yomu.index')
    page.once('dialog', lambda dialog: dialog.dismiss())
    back(page)
    page.wait_for_function('(index) => history.state.yomu.index === index', arg=before)
    expect(page.locator('#detail-form [name=review]')).to_have_value('まだ保存していない感想')
    page.once('dialog', lambda dialog: dialog.accept())
    back(page)
    expect(page.locator('#edit-book')).to_be_visible()
    expect(page.locator('.record-prose').first).not_to_contain_text('まだ保存していない感想')

    # Failed saves preserve the draft and the persisted original; retry works offline.
    page.locator('#edit-book').click()
    page.locator('#detail-form [name=review]').fill('保存を再試行した感想\n改行も保持する。')
    page.evaluate("""() => {
        window.originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
            if (key === 'yomu-reading-archive:v2') throw new DOMException('full', 'QuotaExceededError');
            return window.originalSetItem.call(this, key, value);
        };
    }""")
    page.locator('#save-book').click()
    expect(page.locator('#detail-feedback')).to_contain_text('入力は保持')
    expect(page.locator('#detail-form [name=review]')).to_have_value('保存を再試行した感想\n改行も保持する。')
    assert page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books[0].review").startswith('日々')
    page.screenshot(path=str(artifacts / 'ux-edit-save-error.png'))
    page.evaluate('() => { Storage.prototype.setItem = window.originalSetItem; }')
    page.locator('#save-book').click()
    expect(page.locator('#edit-book')).to_be_visible()
    expect(page.locator('.record-prose').first).to_have_text('保存を再試行した感想\n改行も保持する。')
    back(page)
    expect(page.locator('#detail-dialog')).not_to_be_visible()
    expect(page.locator('#library-search')).to_have_value('風の記憶')
    expect(page.locator('.book-card')).to_have_count(1)
    context.set_offline(False)
    page.locator('#close-search').click()

    # Filter changes are drafts until Apply; closing them leaves the shelf intact.
    page.locator('#filter-toggle').click()
    page.locator('#filter-rating').select_option('4')
    expect(page.locator('#apply-filters')).to_have_text('24冊を表示')
    expect(page.locator('.book-card')).to_have_count(120)
    page.locator('#close-filter').click()
    expect(page.locator('#filter-panel')).not_to_be_visible()
    expect(page.locator('#filter-count')).not_to_be_visible()
    page.locator('#filter-toggle').click()
    expect(page.locator('#filter-rating')).to_have_value('')
    page.locator('#filter-rating').select_option('4')
    page.locator('#apply-filters').click()
    expect(page.locator('#filter-panel')).not_to_be_visible()
    expect(page.locator('.book-card')).to_have_count(24)
    page.locator('#clear-all-filters').click()

    # Preferences survive reload, but a stale query does not hide the next session's books.
    page.locator('[data-filter=wishlist]').click()
    page.locator('[data-view=list]').click()
    page.locator('#sort-books').select_option('title-asc')
    page.locator('#library-search').fill('読書の記録')
    page.reload(wait_until='networkidle')
    page.wait_for_function('history.state.yomu.index === 0')
    expect(page.locator('[data-filter=wishlist]')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('#book-grid')).to_have_class('book-grid is-list')
    expect(page.locator('#sort-books')).to_have_value('title-asc')
    expect(page.locator('#library-search')).to_have_value('')
    page.locator('#library-search').fill('風の記憶')
    expect(page.locator('.book-card')).to_have_count(0)
    page.locator('#empty-search-all').click()
    expect(page.locator('.book-card')).to_have_count(1)
    expect(page.locator('[data-filter=all]')).to_have_attribute('aria-selected', 'true')
    page.locator('#close-search').click()
    page.screenshot(path=str(artifacts / 'ux-list.png'))

    # Return from a record and analytics to the same place in a long shelf.
    card = page.locator('[data-book-id="ux-30"]')
    card.scroll_into_view_if_needed()
    top = page.evaluate('scrollY')
    card.click()
    back(page)
    expect(page.locator('#detail-dialog')).not_to_be_visible()
    assert abs(page.evaluate('scrollY') - top) <= 2
    page.locator('.bottom-nav [data-nav=analytics]').click()
    back(page)
    expect(page.locator('#screen-shelf')).to_have_class('screen is-active')
    assert abs(page.evaluate('scrollY') - top) <= 2
    page.locator('.bottom-nav [data-nav=analytics]').click()
    page.locator('#genre-legend [data-analytics-genre="歴史"]').click()
    expect(page.locator('#active-filter-bar')).to_contain_text('歴史')
    back(page)
    expect(page.locator('#screen-analytics')).to_have_class('screen is-active')
    back(page)
    expect(page.locator('[data-filter=all]')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('#active-filter-bar')).not_to_be_visible()

    # Adding a book has no automatic keyboard/camera start. Back preserves its draft.
    page.locator('#bottom-add').click()
    assert page.evaluate("!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)")
    assert page.locator('#add-dialog').bounding_box()['width'] == 360
    page.screenshot(path=str(artifacts / 'ux-add.png'), animations='disabled')
    page.locator('#isbn-enter-directly').click()
    page.locator('#manual-form [name=title]').fill('新しく追加する本')
    page.locator('#manual-form [name=author]').fill('新しい著者')
    page.locator('#manual-form [name=status]').select_option('reading')
    expect(page.locator('#manual-finished-field')).not_to_be_visible()
    back(page)
    expect(page.locator('#start-barcode-scan')).to_be_visible()
    page.evaluate('history.forward()')
    expect(page.locator('#manual-confirm-stage')).to_be_visible()
    expect(page.locator('#manual-form [name=title]')).to_have_value('新しく追加する本')
    page.locator('#manual-form button[type=submit]').click()
    expect(page.locator('#edit-book')).to_be_visible()
    expect(page.locator('.record-hero h3')).to_have_text('新しく追加する本')
    expect(page.locator('.record-status')).to_have_text('読書中')
    back(page)
    expect(page.locator('#detail-dialog')).not_to_be_visible()
    expect(page.locator('#add-dialog')).not_to_be_visible()
    assert page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2')).books.length") == 121

    # A pending permission request must not leave a live camera after closing Add.
    page.locator('#bottom-add').click()
    page.evaluate("""() => {
      window.stoppedTracks = 0;
      Object.defineProperty(navigator, 'mediaDevices', {configurable:true,value:{getUserMedia: () => new Promise(resolve => window.resolveCamera = resolve)}});
      window.BarcodeDetector = class { async detect() { return []; } };
    }""")
    page.locator('#start-barcode-scan').click()
    page.locator('#add-dialog [data-close]').click()
    expect(page.locator('#add-dialog')).not_to_be_visible()
    page.evaluate('window.resolveCamera({getTracks: () => [{stop: () => window.stoppedTracks++}]})')
    page.wait_for_function('window.stoppedTracks === 1')
    expect(page.locator('#barcode-scanner')).not_to_be_visible()

    # Invalid UI preferences cannot damage valid book records.
    page.evaluate("localStorage.setItem('yomu-shelf-preferences:v1', '{bad')")
    page.reload(wait_until='networkidle')
    expect(page.locator('[data-filter=all]')).to_have_attribute('aria-selected', 'true')
    expect(page.locator('#book-grid')).to_have_class('book-grid')
    expect(page.locator('.book-card')).to_have_count(121)
    page.locator('#library-search').fill('森と暮らす')
    for width in [320, 360, 390, 412, 700, 720, 768, 1440]:
        page.set_viewport_size({'width':width,'height':800 if width < 768 else 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        expect(page.locator('#library-search')).to_be_visible()
        expect(page.locator('#filter-toggle')).to_be_visible()
        assert page.locator('.shelf-tabs').bounding_box()['height'] <= 64, width
        box = page.locator('#filter-toggle').bounding_box()
        assert box['width'] >= 48 and box['height'] >= 48, (width, box)
        page.locator('[data-book-id="ux-0"]').click()
        box = page.locator('#detail-dialog').bounding_box()
        if width <= 720:
            assert box['width'] == width, (width, box)
        page.locator('#edit-book').click()
        assert page.locator('#save-book').bounding_box()['y'] < page.viewport_size['height']
        for star in page.locator('.rating-control [data-rating]').all():
            box = star.bounding_box()
            assert box['width'] >= 48 and box['height'] >= 48, (width, box)
        close_detail(page)
    page.set_viewport_size({'width':360,'height':800})
    page.locator('#close-search').click()
    page.locator('.bottom-nav [data-nav=settings]').click()
    assert page.evaluate("JSON.parse(localStorage.getItem('yomu-settings:v2')).theme") == 'system'
    page.locator('#theme-control [data-theme=dark]').click()
    page.screenshot(path=str(artifacts / 'ux-settings-dark.png'))
    page.locator('.bottom-nav [data-nav=shelf]').click()
    page.screenshot(path=str(artifacts / 'ux-shelf-dark.png'))
    page.locator('[data-book-id="ux-0"]').click()
    page.screenshot(path=str(artifacts / 'ux-detail-dark.png'))
    # A reduced viewport checks the layout contract used when the keyboard resizes it.
    page.set_viewport_size({'width':360,'height':420})
    page.locator('#edit-book').click()
    page.locator('#detail-form [name=notes]').focus()
    page.locator('#detail-form [name=notes]').scroll_into_view_if_needed()
    save_box = page.locator('#save-book').bounding_box()
    assert save_box['y'] >= 0 and save_box['y'] + save_box['height'] <= 420
    page.screenshot(path=str(artifacts / 'ux-edit-short-viewport.png'), animations='disabled')
    back(page)
    expect(page.locator('#edit-book')).to_be_visible()
    page.set_viewport_size({'width':360,'height':800})
    # Double the actual text sizes, not the root size while all children use pixels.
    page.evaluate("""() => document.querySelectorAll('.record-prose, .record-hero h3, .record-header h2').forEach(e => e.style.fontSize = `${parseFloat(getComputedStyle(e).fontSize)*2}px`)""")
    assert page.evaluate("document.querySelector('.record-scroll').scrollWidth <= document.querySelector('.record-scroll').clientWidth")
    expect(page.locator('#edit-book')).to_be_visible()
    close_detail(page)

    # A thousand books can still be searched directly without pagination hiding matches.
    _, large = new_page(1000)
    expect(large.locator('.book-card')).to_have_count(1000)
    result = large.evaluate("""() => {
        const input = document.querySelector('#library-search');
        const begin = performance.now();
        input.value = '読書の記録 0999';
        input.dispatchEvent(new Event('input',{bubbles:true}));
        return {books:1000,searchMs:performance.now()-begin};
    }""")
    expect(large.locator('.book-card')).to_have_count(1)
    assert result['searchMs'] < 1000, result
    (artifacts / 'ux-performance.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    assert not errors, errors
    for context in contexts:
        context.close()
    print('PASS: mobile read/edit, draft safety, failed saves, Back navigation, preference restore, 1000 books, touch targets, dark mode, and responsive widths')


if __name__ == "__main__":
    from playwright.sync_api import sync_playwright
    from verify_app import preview_server, BASE_URL, ARTIFACTS, CHROME_PATH
    with preview_server(), sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=CHROME_PATH)
        try:
            run_mobile_ux(browser, BASE_URL, ARTIFACTS)
        except Exception:
            for index, context in enumerate(browser.contexts):
                for page in context.pages:
                    page.screenshot(path=str(ARTIFACTS / f"ux-failure-{index}.png"))
            raise
        finally:
            browser.close()
