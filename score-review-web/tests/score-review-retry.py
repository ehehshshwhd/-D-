"""Verify failed cloud score reads retry every five seconds and stop after success."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
for base in [ROOT, ROOT.parent]:
    sys.path.insert(0, str(base / '.racing-tools' / 'python'))
from playwright.sync_api import sync_playwright

SOURCE = (ROOT / 'full-system' / 'index.html').read_text(encoding='utf-8')


def run():
    health_calls = 0

    def mock_cloud(route):
        nonlocal health_calls
        path = urlparse(route.request.url).path
        if path == '/':
            body = SOURCE.replace(
                'ReactDOM.createRoot(document.getElementById("root")).render(<App />);',
                'ReactDOM.createRoot(document.getElementById("root")).render(<div className="admin-app min-w-[1280px] bg-white"><Header onHome={()=>{}} user={{name:"测试管理员"}} onLogout={()=>{}} activeModule="赛事管理"/><DetailPage ev={{id:"retry-test",title:"重试测试赛事"}} onHome={()=>{}} /></div>);',
            )
            return route.fulfill(content_type='text/html; charset=utf-8', body=body)
        if path in ['/full-system/score-review-cloud.js', '/full-system/score-review-export.js']:
            return route.fulfill(content_type='text/javascript', body=(ROOT / path.lstrip('/')).read_bytes())
        if path == '/api/health':
            health_calls += 1
            if health_calls in (1, 3):
                return route.fulfill(status=503, json={'ok': False, 'message': '测试云端暂不可用'})
            payload = {'ok': True, 'cloudEnabled': True, 'cloudDatabaseConnected': True}
        elif path == '/api/session':
            payload = {'ok': True}
        elif path == '/api/event-data':
            payload = {'ok': True, 'items': {}, 'storage': 'cloudbase'}
        elif path == '/api/work-records':
            payload = {'ok': True, 'rows': [], 'count': 0, 'revision': 0}
        else:
            return route.fulfill(status=404, body='not found')
        return route.fulfill(content_type='application/json', body=json.dumps(payload))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='msedge', headless=True)
        page = browser.new_page(viewport={'width': 1500, 'height': 1000})
        page.route('http://race-retry.test/**', mock_cloud)
        page.add_init_script('window.RACE_API_SAME_ORIGIN=true;')
        page.goto('http://race-retry.test/', wait_until='networkidle', timeout=60000)
        page.locator('aside').get_by_text('成绩审核', exact=True).click()
        page.get_by_role('tab', name='总成绩', exact=True).wait_for(timeout=30000)
        page.get_by_text('未连接云端', exact=True).wait_for(timeout=30000)
        page.wait_for_timeout(4500)
        assert health_calls == 1, health_calls
        page.get_by_text('已连接云端', exact=True).wait_for(timeout=3000)
        assert health_calls == 2, health_calls
        page.wait_for_timeout(5500)
        assert health_calls == 2, health_calls
        page.get_by_role('button', name='刷新数据', exact=True).click()
        page.get_by_text('未连接云端', exact=True).wait_for(timeout=3000)
        page.wait_for_timeout(4500)
        assert health_calls == 3, health_calls
        page.get_by_text('已连接云端', exact=True).wait_for(timeout=3000)
        assert health_calls == 4, health_calls
        page.get_by_text('赛事信息', exact=True).first.click()
        page.wait_for_timeout(5500)
        assert health_calls == 4, health_calls
        page.close()
        browser.close()


if __name__ == '__main__':
    run()
    print('PASS score-review-retry')
