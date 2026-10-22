"""Exercise the actual React review component with isolated mock cloud data."""
import json
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
for base in [ROOT, ROOT.parent]:
    sys.path.insert(0, str(base / '.racing-tools' / 'python'))
from playwright.sync_api import sync_playwright
import openpyxl

source = (ROOT / 'full-system' / 'index.html').read_text(encoding='utf-8')
source = source.replace(
    'ReactDOM.createRoot(document.getElementById("root")).render(<App />);',
    'ReactDOM.createRoot(document.getElementById("root")).render(<ScoreReview ev={{id:"timing-test"}} />);'
)
rows = [{
    'id': 'record-23', 'carNumber': '23', 'group': '公开组',
    'startTime': '12:34:14.14', 'endTime': '12:37:12.41',
    'penaltyTotal': '0', 'segmentDuration': '0:02:58.270',
    'durationManual': False, 'status': 'pending', 'uploader': '测试裁判',
    'uploadedAt': '2026-10-22T02:00:00.000Z'
}]
revisions = {f'SS{i}': 0 for i in range(1, 21)}


def mock_cloud(route):
    global rows
    parsed = urlparse(route.request.url)
    if parsed.path == '/':
        return route.fulfill(content_type='text/html; charset=utf-8', body=source)
    if parsed.path in ['/full-system/score-review-cloud.js', '/full-system/score-review-export.js']:
        return route.fulfill(content_type='text/javascript', body=(ROOT / parsed.path.lstrip('/')).read_bytes())
    if parsed.path == '/api/health':
        payload = dict(ok=True, cloudEnabled=True, cloudDatabaseConnected=True)
    elif parsed.path == '/api/session':
        payload = dict(ok=True)
    elif parsed.path == '/api/work-records':
        if route.request.method == 'PUT':
            body = route.request.post_data_json
            assert body['eventId'] == 'timing-test'
            stage = body['stage']
            assert body['expectedRevision'] == revisions[stage]
            assert stage == 'SS1'
            rows = body['rows']
            revisions[stage] += 1
        else:
            stage = parse_qs(parsed.query)['stage'][0]
        selected = rows if stage == 'SS1' else []
        payload = dict(ok=True, rows=selected, count=len(selected), revision=revisions[stage])
    else:
        return route.fulfill(status=404, body='not found')
    route.fulfill(content_type='application/json', body=json.dumps(payload))


with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport=dict(width=1500, height=1000), accept_downloads=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('http://race-timing.test/**', mock_cloud)
    page.add_init_script('window.RACE_API_SAME_ORIGIN=true;')
    page.goto('http://race-timing.test/', wait_until='networkidle', timeout=60000)
    page.get_by_role('tab', name='总成绩', exact=True).wait_for(timeout=30000)
    page.get_by_text('已连接云端', exact=True).wait_for()
    assert page.locator('tbody tr').first.locator('td').nth(3).inner_text() == '0:02:58.270'
    page.get_by_role('tab', name='SS1', exact=True).click()
    cells = page.locator('tbody tr').first.locator('td')
    assert cells.nth(6).inner_text() == '0:02:58.270'
    assert cells.nth(5).inner_text() == '0'
    for index in [0, 3, 4, 6]:
        style = cells.nth(index).evaluate('el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color})')
        assert style == dict(bg='rgb(255, 247, 237)', color='rgb(234, 88, 12)'), (index, style)

    page.get_by_role('button', name='编辑', exact=True).click()
    dialog = page.get_by_role('dialog', name='编辑成绩')
    duration = dialog.get_by_label('赛段用时（可直接修改）')
    dialog.get_by_label('收车时间', exact=True).fill('12:37:13.41')
    assert duration.input_value() == '0:02:59.270'
    dialog.get_by_role('button', name='保存修改').click()
    page.get_by_text('成绩已保存并同步到赛事云端', exact=True).wait_for()
    assert rows[0]['segmentDuration'] == '0:02:59.270'
    assert rows[0]['durationManual'] is False

    page.get_by_role('button', name='编辑', exact=True).click()
    duration.fill('invalid')
    dialog.get_by_role('button', name='保存并通过').click()
    assert dialog.is_visible()
    assert revisions['SS1'] == 1
    duration.fill('0:03:00.001')
    dialog.get_by_role('button', name='保存修改').click()
    page.wait_for_function("JSON.parse(localStorage.getItem('score-review-timing-test'))[0].time===180.001")
    page.get_by_text('已连接云端', exact=True).wait_for()
    assert rows[0]['segmentDuration'] == '0:03:00.001'
    assert rows[0]['durationManual'] is True
    page.get_by_role('button', name='刷新数据', exact=True).click()
    page.get_by_text('已连接云端', exact=True).wait_for()
    assert cells.nth(6).inner_text() == '0:03:00.001'
    page.get_by_role('tab', name='总成绩', exact=True).click()
    assert cells.nth(3).inner_text() == '0:03:00.001'

    page.get_by_role('button', name='导出成绩', exact=True).click()
    with page.expect_download(timeout=20000) as download_info:
        page.get_by_role('menuitem', name='导出总成绩', exact=True).click()
    with tempfile.TemporaryDirectory(prefix='race-timing-') as folder:
        target = Path(folder) / 'scores.xlsx'
        download_info.value.save_as(target)
        workbook = openpyxl.load_workbook(target, data_only=True)
        assert workbook['总成绩']['B2'].value == '0:03:00.001'
        assert workbook['SS1']['E2'].value == '0:03:00.001'
        assert workbook['SS1']['E2'].alignment.horizontal == 'center'
        assert len(workbook.sheetnames) == 21
    assert not errors, errors
    browser.close()
    print('PASS: orange cells, calculated preview, invalid input, manual save/refresh, total and 21-sheet Excel export')
