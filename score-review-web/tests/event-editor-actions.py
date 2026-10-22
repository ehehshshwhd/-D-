"""Exercise the five event editor actions in the real page with a mock cloud."""
import base64
import json
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
for base in [ROOT, ROOT.parent]:
    sys.path.insert(0, str(base / '.racing-tools' / 'python'))
from playwright.sync_api import sync_playwright

SOURCE = (ROOT / 'full-system/index.html').read_text(encoding='utf-8')
EVENT = dict(id='actions-test', title='按钮测试赛事', type='拉力赛',
             dateStart='2026-10-31', dateEnd='2026-11-02',
             registrationDeadline='2026-10-22', status='报名中',
             location='资兴市', contactPhone='13269191919', published=True,
             coverFileId='cloud://original-cover',
             detailPageHtml='<p>上次保存的正文</p>')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGK0AAAAASUVORK5CYII=')


class EditorActions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(channel='msedge', headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.requests = []
        self.errors = []
        self.fail_next = False
        self.page = self.browser.new_page(viewport=dict(width=1280, height=800))
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.route('http://race-actions.test/**', self.mock_cloud)
        self.page.add_init_script('''
            window.RACE_API_SAME_ORIGIN=true;
            window.alerts=[];window.alert=message=>window.alerts.push(message);
            window.allowConfirm=true;window.confirm=()=>window.allowConfirm;
            window.returnedHome=0;window.mutationsStarted=0;
            const originalFetch=window.fetch;
            window.fetch=async(url,options)=>{
                if(String(url).endsWith('/api/events')&&['POST','DELETE'].includes(options?.method)){
                    window.mutationsStarted++;
                    if(window.holdMutation)await new Promise(resolve=>window.releaseMutation=resolve);
                }
                return originalFetch(url,options);
            };
        ''')
        self.page.goto('http://race-actions.test/', wait_until='networkidle', timeout=60000)
        self.page.get_by_placeholder('请输入赛事标题').wait_for(timeout=30000)

    def tearDown(self):
        errors = self.errors[:]
        self.page.close()
        self.assertEqual(errors, [])

    def mock_cloud(self, route):
        path = urlparse(route.request.url).path
        if path == '/':
            render = 'EVENTS=[cloudEventToEditorEvent(' + json.dumps(EVENT, ensure_ascii=False) + ''')];
                ReactDOM.createRoot(document.getElementById("root")).render(
                  <div className="admin-app min-w-[1280px] bg-white">
                    <Header user={{name:'测试管理员'}} activeModule="赛事管理" onHome={()=>{}} />
                    <DetailPage ev={EVENTS[0]} onHome={()=>{window.returnedHome++}} />
                  </div>);'''
            return route.fulfill(content_type='text/html; charset=utf-8', body=SOURCE.replace(
                'ReactDOM.createRoot(document.getElementById("root")).render(<App />);', render))
        if path in ['/full-system/score-review-cloud.js', '/full-system/score-review-export.js']:
            return route.fulfill(content_type='text/javascript', body=(ROOT / path.lstrip('/')).read_bytes())
        if path == '/api/event-covers':
            if route.request.method == 'POST':
                return route.fulfill(json=dict(ok=True, coverFileId='cloud://new-cover'))
            return route.fulfill(content_type='image/png', body=PNG)
        if path == '/api/events':
            if route.request.method in ['POST', 'DELETE']:
                payload = route.request.post_data_json
                self.requests.append((route.request.method, payload))
                if self.fail_next:
                    self.fail_next = False
                    return route.fulfill(status=503, json=dict(ok=False, message='测试云端暂不可用'))
                return route.fulfill(json=dict(ok=True, event={**EVENT, **payload}))
            return route.fulfill(json=dict(ok=True, events=[EVENT]))
        if path == '/api/event-data':
            return route.fulfill(json=dict(ok=True, items={}, storage='cloudbase'))
        if path == '/api/health':
            return route.fulfill(json=dict(ok=True, cloudEnabled=True, cloudDatabaseConnected=True))
        if path == '/api/session':
            return route.fulfill(json=dict(ok=True))
        return route.fulfill(status=404, body='not found')

    def button(self, name):
        return self.page.get_by_role('button', name=name, exact=name != '手机预览')

    def save(self, publish=False):
        self.button('发布到小程序' if publish else '提交并返回').click()
        self.page.wait_for_function('window.returnedHome===1')
        return self.requests[-1][1]

    def test_footer_and_phone_preview(self):
        for name in ['删除赛事', '手机预览', '提交并返回', '重置', '发布到小程序']:
            button = self.button(name)
            box = button.bounding_box()
            self.assertGreaterEqual(box['y'], 0)
            self.assertLessEqual(box['y'] + box['height'], 800)
            button.click(trial=True)
        self.button('手机预览').click()
        dialog = self.page.get_by_role('dialog', name='赛事手机预览')
        dialog.wait_for()
        self.assertEqual(dialog.locator('.race-phone-title').inner_text(), EVENT['title'])
        self.assertIn('上次保存的正文', dialog.inner_text())
        self.page.keyboard.press('Escape')
        self.assertFalse(dialog.is_visible())

    def test_reset_restores_saved_content_for_preview_and_submit(self):
        self.page.get_by_placeholder('请输入赛事标题').fill('改过的标题')
        self.page.locator('[data-date="start"]').fill('2026-10-30')
        self.page.locator('[data-editor]').fill('不应保留的正文')
        self.button('重置').click()
        self.assertEqual(self.page.get_by_placeholder('请输入赛事标题').input_value(), EVENT['title'])
        self.assertEqual(self.page.locator('[data-date="start"]').input_value(), EVENT['dateStart'])
        self.assertEqual(self.page.locator('[data-editor]').inner_html(), EVENT['detailPageHtml'])
        self.button('手机预览').click()
        dialog = self.page.get_by_role('dialog', name='赛事手机预览')
        self.assertEqual(dialog.locator('.race-phone-content').inner_html(), EVENT['detailPageHtml'])
        self.page.keyboard.press('Escape')
        self.assertEqual(self.save()['detailPageHtml'], EVENT['detailPageHtml'])

    def test_reset_restores_cover_and_editor_mode(self):
        self.page.locator('input[type=file][accept="image/*"]').set_input_files(
            dict(name='new-cover.png', mimeType='image/png', buffer=PNG))
        self.page.wait_for_function("document.querySelector('img[alt=赛事封面]').src.includes('new-cover')")
        self.page.get_by_role('button', name='HTML', exact=True).click()
        self.page.locator('[data-editor]').fill('<p>源码修改</p>')
        self.button('重置').click()
        self.assertTrue(self.page.get_by_role('button', name='加粗', exact=True).is_enabled())
        self.assertIn('original-cover', self.page.get_by_alt_text('赛事封面').get_attribute('src'))
        saved = self.save()
        self.assertEqual(saved['coverFileId'], EVENT['coverFileId'])
        self.assertEqual(saved['detailPageHtml'], EVENT['detailPageHtml'])

    def test_save_publish_show_progress_and_prevent_duplicate_requests(self):
        self.page.evaluate('window.holdMutation=true')
        self.button('发布到小程序').click()
        self.page.wait_for_function('window.mutationsStarted===1')
        pending = self.page.get_by_role('button', name='正在发布…', exact=True)
        self.assertEqual(pending.count(), 1, '发布请求等待时应显示进度')
        self.assertFalse(pending.is_enabled())
        self.assertFalse(self.button('提交并返回').is_enabled())
        self.assertFalse(self.button('删除赛事').is_enabled())
        self.assertFalse(self.button('重置').is_enabled())
        self.page.evaluate('window.releaseMutation()')
        self.page.wait_for_function('window.returnedHome===1')
        self.assertEqual(len(self.requests), 1)
        self.assertTrue(self.requests[0][1]['published'])

    def test_validation_and_save_failure_allow_retry(self):
        title = self.page.get_by_placeholder('请输入赛事标题')
        title.fill('')
        self.button('提交并返回').click()
        self.assertEqual(self.page.evaluate('window.alerts.at(-1)'), '请输入赛事标题')
        self.assertEqual(self.requests, [])
        title.fill(EVENT['title'])
        self.fail_next = True
        self.button('提交并返回').click()
        self.page.wait_for_function('window.alerts.at(-1).includes("测试云端暂不可用")')
        self.assertEqual(self.page.evaluate('window.returnedHome'), 0)
        self.assertTrue(self.button('提交并返回').is_enabled())
        self.assertFalse(self.save()['published'])

    def test_delete_cancel_failure_and_retry(self):
        self.page.evaluate('window.allowConfirm=false')
        self.button('删除赛事').click()
        self.assertEqual(self.requests, [])
        self.page.evaluate('window.allowConfirm=true')
        self.fail_next = True
        self.button('删除赛事').click()
        self.page.wait_for_function('window.alerts.at(-1)?.includes("删除赛事失败")')
        self.assertEqual(self.page.evaluate('window.returnedHome'), 0)
        self.button('删除赛事').click()
        self.page.wait_for_function('window.returnedHome===1')
        self.assertEqual(self.requests[-1], ('DELETE', dict(eventId=EVENT['id'])))


if __name__ == '__main__':
    unittest.main(verbosity=2)
