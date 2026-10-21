"""Browser regression: SS20, 200 rows, sticky header, and internal scrolling.

Uses only local mock rows; never reads or writes production data.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.racing-tools' / 'python'))
from playwright.sync_api import sync_playwright

mock_rows = [dict(id=f'row-{i}', car=str(i), group='测试组', stage='SS20',
                 start='10:00:00.000', finish='10:01:00.000', penalty='0',
                 duration='0:01:00.000', status='pending', uploader='测试员',
                 uploadedAt='2026-10-13T00:00:00.000Z') for i in range(1, 201)]

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('https://cdn.sheetjs.com/**', lambda route: route.abort())
    page.add_init_script('localStorage.setItem("race-score-review-web-v1", ' +
                         json.dumps(json.dumps(mock_rows)) + ');')
    page.goto((ROOT / 'score-review-web' / 'index.html').as_uri())
    page.wait_for_load_state('networkidle')
    assert page.locator('#stageTabs .tab').count() == 21
    assert page.locator('#editStage option').count() == 20
    assert page.locator('#tableHead').inner_text().find('SS20赛段用时') >= 0
    assert page.locator('#tableBody tr').count() == 200
    page.locator('#stageTabs [data-stage="SS20"]').click()
    assert page.locator('#tableBody tr').count() == 200
    measurements = page.locator('.table-wrap').evaluate('''el => {
      el.scrollTop = el.scrollHeight;
      return {height:el.clientHeight, total:el.scrollHeight, scrollTop:el.scrollTop,
              maxHeight:getComputedStyle(el).maxHeight,
              headerTop:el.querySelector('th').getBoundingClientRect().top,
              top:el.getBoundingClientRect().top,
              lastRowBottom:el.querySelector('tr:last-child').getBoundingClientRect().bottom,
              bottom:el.getBoundingClientRect().bottom,
              documentHeight:document.documentElement.scrollHeight};
    }''')
    assert measurements['height'] <= 680
    assert measurements['total'] > measurements['height'] * 10
    assert measurements['scrollTop'] > 0
    assert abs(measurements['headerTop'] - measurements['top']) < 3
    assert measurements['lastRowBottom'] <= measurements['bottom'] + 1
    assert measurements['documentHeight'] < 2000
    page.locator('.table-wrap').evaluate('el => el.scrollTop = 0')
    page.screenshot(path=str(ROOT / '.racing-tools' / 'ss20-200-rows.png'), full_page=True)
    assert not errors, errors
    print(json.dumps(measurements, ensure_ascii=False))
    print('PASS: SS1–SS20, 200 rows scroll inside the table, last row reachable, header stays visible')
    browser.close()
