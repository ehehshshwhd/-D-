"""Verify the real event editor, saved checkbox and phone registration rows."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
for base in [ROOT, ROOT.parent]:
    sys.path.insert(0, str(base / '.racing-tools' / 'python'))
from playwright.sync_api import sync_playwright

event = dict(id='signup-test', title='测试赛事', type='拉力赛', dateStart='2026-10-31',
             dateEnd='2026-11-02', registrationDeadline='2026-10-22', status='报名中',
             location='资兴市', contactPhone='13269191919', published=True,
             signupOptions=[dict(name='四驱组', fee='3000', unit='辆', note='含保险'),
                            dict(name='女子组', fee='600', unit='人'),
                            dict(name='公开组', fee='1000', unit='车', note='已报5辆')])
original = (ROOT / 'full-system/index.html').read_text(encoding='utf-8')
saved_requests = []


def mock_cloud(route):
    global event
    path = urlparse(route.request.url).path
    if path == '/':
        render = 'EVENTS=[cloudEventToEditorEvent(' + json.dumps(event, ensure_ascii=False) + ')];ReactDOM.createRoot(document.getElementById("root")).render(<InfoTab ev={EVENTS[0]} onHome={()=>{}} />);'
        source = original.replace('ReactDOM.createRoot(document.getElementById("root")).render(<App />);', render)
        return route.fulfill(content_type='text/html; charset=utf-8', body=source)
    if path in ['/full-system/score-review-cloud.js', '/full-system/score-review-export.js']:
        return route.fulfill(content_type='text/javascript', body=(ROOT / path.lstrip('/')).read_bytes())
    if path == '/api/events':
        if route.request.method == 'POST':
            event = route.request.post_data_json
            saved_requests.append(event)
            payload = dict(ok=True, event=event)
        else:
            payload = dict(ok=True, events=[event])
    elif path == '/api/health':
        payload = dict(ok=True, cloudEnabled=True, cloudDatabaseConnected=True)
    elif path == '/api/session':
        payload = dict(ok=True)
    else:
        return route.fulfill(status=404, body='not found')
    route.fulfill(content_type='application/json', body=json.dumps(payload))


with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport=dict(width=1280, height=800))
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('http://race-signup.test/**', mock_cloud)
    page.add_init_script('window.RACE_API_SAME_ORIGIN=true;window.alert=message=>{window.lastAlert=message};window.confirm=()=>true;')
    page.goto('http://race-signup.test/', wait_until='networkidle', timeout=60000)
    checkbox = page.get_by_role('checkbox', name='隐藏报名人数')
    checkbox.wait_for(timeout=30000)
    assert not checkbox.is_checked()

    def preview(hidden):
        page.locator('button').filter(has_text='手机预览').click(force=True)
        dialog = page.get_by_role('dialog', name='赛事手机预览')
        dialog.wait_for()
        rows = dialog.locator('.race-phone-signup-row').all_text_contents()
        assert len(rows) == 3
        assert any('已报' in row for row in rows) == (not hidden), rows
        assert '四驱组' in rows[0] and '¥ 3000/辆' in rows[0] and '（含保险）' in rows[0]
        assert '女子组' in rows[1] and '¥ 600/人' in rows[1]
        assert dialog.locator('.race-phone-title').inner_text() == '测试赛事'
        assert '展示当前编辑内容，无需保存' not in dialog.inner_text()
        assert dialog.locator('header').count() == 0
        scroll = dialog.locator('.race-phone-scroll')
        assert scroll.evaluate('el=>el.scrollWidth<=el.clientWidth')
        return dialog

    dialog = preview(False)
    dialog.get_by_role('button', name='关闭手机预览').click()
    checkbox.check()
    dialog = preview(True)
    page.keyboard.press('Escape')
    assert not dialog.is_visible()
    with page.expect_response(lambda response: response.url.endswith('/api/events') and response.request.method == 'POST'):
        page.get_by_role('button', name='提交并返回', exact=True).click()
    page.wait_for_function("window.lastAlert==='赛事草稿已保存到云端。'")
    assert saved_requests[-1]['hideSignupCount'] is True
    page.reload(wait_until='networkidle')
    assert checkbox.is_checked()
    preview(True)
    page.mouse.click(5, 5)
    assert not dialog.is_visible()
    checkbox.uncheck()
    preview(False)
    page.keyboard.press('Escape')
    with page.expect_response(lambda response: response.url.endswith('/api/events') and response.request.method == 'POST'):
        page.get_by_role('button', name='发布到小程序', exact=True).click()
    page.wait_for_function("window.lastAlert==='赛事已保存并发布到云端。'")
    assert saved_requests[-1]['hideSignupCount'] is False
    assert saved_requests[-1]['published'] is True
    page.reload(wait_until='networkidle')
    assert not checkbox.is_checked()
    assert not errors, errors
    browser.close()
    print('PASS: default, hide/show all signup counts, retained fees/notes, save/reload/publish, header removed and close controls')
