# 搜索路由

在本工作区需要联网搜索资料、设计参考或官方文档时，优先阅读并使用
`D:/CodexData/skills/web-search-router/SKILL.md`，通过以下脚本执行搜索：

```powershell
& 'D:\CodexData\skills\web-search-router\scripts\search.ps1' -Query '搜索内容' -MaxResults 5
```

- 脚本负责搜索服务切换和密钥轮换；不要输出密钥或绕过脚本直接调用服务商接口。
- 所有服务失败后再使用内置搜索，并说明回退情况。
- 引用搜索结果时链接到原始来源；搜索摘要不能作为已经看过页面或界面截图的依据。
- 此规则仅设置资料搜索方式，不授权修改产品功能或部署。
