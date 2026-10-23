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
    'ReactDOM.createRoot(document.getElementById("root")).render(<div className="admin-app min-w-[1280px] bg-white"><Header onHome={()=>{}} user={{name:"测试管理员"}} onLogout={()=>{}} activeModule="赛事管理"/><DetailPage ev={{id:"timing-test",title:"测试赛事"}} onHome={()=>{}} /></div>);'
)
rows = [{
    'id': 'record-23', 'carNumber': '23', 'group': '公开组',
    'startTime': '12:34:14.14', 'endTime': '12:37:12.41',
    'penaltyTotal': '0', 'segmentDuration': '0:02:58.270',
    'durationManual': False, 'status': 'pending', 'uploader': '测试裁判',
    'uploadedAt': '2026-10-22T02:00:00.000Z'
}]
revisions = {f'SS{i}': 0 for i in range(1, 21)}
stress_by_stage = {}


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
    elif parsed.path == '/api/event-data':
        payload = dict(ok=True, items={}, storage='cloudbase')
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
        selected = stress_by_stage.get(stage, rows if stage == 'SS1' else [])
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
    page.locator('aside').get_by_text('成绩审核', exact=True).click()
    page.get_by_role('tab', name='总成绩', exact=True).wait_for(timeout=30000)
    page.get_by_text('已连接云端', exact=True).wait_for()
    assert page.locator('tbody tr').first.locator('td').nth(3).inner_text() == '0:02:58.270'
    page.get_by_role('tab', name='SS1', exact=True).click()
    cells = page.locator('tbody tr').first.locator('td')
    assert cells.nth(6).inner_text() == '0:02:58.270'
    assert cells.nth(5).inner_text() == '0'
    review = page.locator('.score-review')
    typography = review.evaluate('''el => ({
        titleSize:getComputedStyle(el.querySelector('h2')).fontSize,
        weights:[...el.querySelectorAll('h2,h3,p,button,input,th,td')].map(node=>getComputedStyle(node).fontWeight),
        buttonRadius:getComputedStyle(el.querySelector('button')).borderRadius,
        background:getComputedStyle(el).backgroundColor
    })''')
    assert typography['titleSize'] == '34px', typography
    assert set(typography['weights']) == {'700'}, typography
    assert typography['buttonRadius'] == '12px', typography
    assert typography['background'] == 'rgb(255, 255, 255)', typography
    stats = review.locator(':scope > .grid')
    assert stats.evaluate('el=>getComputedStyle(el).display') == 'grid'
    assert len(stats.evaluate('el=>getComputedStyle(el).gridTemplateColumns.split(" ")')) == 3
    page.get_by_role('button', name='导出成绩', exact=True).click()
    for item in page.get_by_role('menuitem').all():
        assert item.evaluate('el=>getComputedStyle(el).whiteSpace') == 'nowrap'
    page.get_by_role('button', name='导出成绩', exact=True).click()
    assert page.get_by_role('menu').count() == 0
    page.get_by_role('button', name='导出成绩', exact=True).click()
    page.get_by_role('heading', name='成绩审核', exact=True).click()
    assert page.get_by_role('menu').count() == 0
    page.get_by_role('button', name='全屏').click()
    page.wait_for_function("getComputedStyle(document.querySelector('.score-review')).position === 'fixed'", timeout=1500)
    fullscreen = page.locator('.score-review').evaluate('el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}')
    assert fullscreen == dict(x=0, y=0, width=1500, height=1000), fullscreen
    page.keyboard.press('Escape')
    page.wait_for_function("getComputedStyle(document.querySelector('.score-review')).position !== 'fixed'", timeout=1500)
    for index in [0, 3, 4, 6]:
        style = cells.nth(index).evaluate('el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color})')
        assert style == dict(bg='rgba(0, 0, 0, 0)', color='rgb(234, 88, 12)'), (index, style)

    page.get_by_role('button', name='编辑', exact=True).click()
    dialog = page.get_by_role('dialog', name='编辑成绩')
    assert dialog.locator('input').first.evaluate('el=>getComputedStyle(el).fontWeight') == '700'
    editor_box = dialog.bounding_box()
    assert editor_box['width'] == 580 and editor_box['y'] >= 0, editor_box
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

    for stage in revisions:
        stress_by_stage[stage] = [{**rows[0], 'id': f'{stage}-{car}', 'carNumber': str(car)} for car in range(1, 201)]
    page.get_by_role('button', name='刷新数据', exact=True).click()
    page.get_by_text('共 4000 条成绩记录', exact=False).wait_for()
    page.set_viewport_size(dict(width=1280, height=800))
    page.get_by_role('button', name='全屏').click()
    table_view = page.locator('table').locator('..')
    measurements = table_view.evaluate('''el => {
        el.scrollTop = el.scrollHeight;
        el.scrollLeft = el.scrollWidth;
        const rect = el.getBoundingClientRect();
        const header = el.querySelector('th').getBoundingClientRect();
        const last = el.querySelector('tbody tr:last-child').getBoundingClientRect();
        return {height:el.clientHeight, width:el.clientWidth, total:el.scrollHeight,
                scrollTop:el.scrollTop, scrollLeft:el.scrollLeft, top:rect.top,
                bottom:rect.bottom, lastBottom:last.bottom, headerTop:header.top};
    }''')
    assert measurements['height'] >= 100, measurements
    assert measurements['bottom'] <= 800, measurements
    assert measurements['scrollTop'] > 0 and measurements['scrollLeft'] > 0, measurements
    assert measurements['lastBottom'] <= measurements['bottom'] + 2, measurements
    assert abs(measurements['headerTop'] - measurements['top']) < 2, measurements
    assert page.locator('tbody tr').count() == 200
    assert page.get_by_role('columnheader', name='SS20赛段用时').count() == 1
    for label in ['退出全屏', '刷新数据']:
        button = page.get_by_role('button', name=label, exact=True)
        box = button.bounding_box()
        assert box['y'] >= 0 and box['y'] + box['height'] <= 800, (label, box)
        button.click(trial=True)
    page.get_by_role('button', name='退出全屏', exact=True).click()
    page.wait_for_function("getComputedStyle(document.querySelector('.score-review')).position !== 'fixed'")
    artifacts = ROOT.parent / '.racing-tools'
    artifacts.mkdir(exist_ok=True)
    for width, height in [(2560, 1600), (1280, 800)]:
        page.set_viewport_size(dict(width=width, height=height))
        review.evaluate('el=>el.scrollTop=0')
        assert review.evaluate('el=>el.scrollWidth<=el.clientWidth+1')
        page.screenshot(path=str(artifacts / f'score-review-reference-{width}.png'))
    page.set_viewport_size(dict(width=700, height=1000))
    review.evaluate('el=>el.scrollTop=0')
    page.wait_for_function("matchMedia('(max-width:760px)').matches")
    assert len(stats.evaluate('el=>getComputedStyle(el).gridTemplateColumns.split(" ")')) == 1, page.evaluate("({width:innerWidth, media:matchMedia('(max-width:760px)').matches,cols:getComputedStyle(document.querySelector('.score-review>.grid')).gridTemplateColumns})")
    assert review.evaluate('el=>el.scrollWidth<=el.clientWidth+1')
    page.get_by_role('button', name='编辑', exact=True).first.click()
    assert dialog.bounding_box()['width'] <= 700
    dialog.get_by_role('button', name='保存修改').click(trial=True)
    dialog.get_by_role('button', name='关闭', exact=True).click()
    print(json.dumps(measurements))
    assert not errors, errors
    browser.close()
    print('PASS: orange text without fill, fullscreen enter/button/escape, 4000 records at 1280x800 with internal scrolling, timing edits and 21-sheet export')
