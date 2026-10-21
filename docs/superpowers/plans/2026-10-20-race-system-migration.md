# 赛事系统迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前赛事系统的赛事配置、正文详情、横幅、组别奖金、报名管理、成绩录入审核和小程序赛事详情能力接入“全新系统”，并共享经过授权的线上赛事数据。

**Architecture:** 保留目标系统现有平台、商城和会员模块，把赛事系统逐步接入其现有“赛事管理”入口。先确定后端 API、身份和字段映射，再以目标页面已有的 `RaceAdminSDK` 接口替换赛事模块的 LocalStorage 演示读写；CloudBase 凭证和授权校验只在服务器端，现有小程序继续通过兼容接口读取赛事和成绩。

**Tech Stack:** 目标端为单 HTML React 18/Babel 页面、Tailwind CDN 与浏览器 LocalStorage；现有小程序为微信原生小程序；赛事后台 API 使用 Node.js、CloudBase Node SDK、Cloud Run。

**Spec:** 目标页面 `D:/gogle下载/全新系统/index.html` 中内嵌的“赛车管理前端合并与接口接入说明（v1）”及本迁移计划。

## Global Constraints

- 保留目标系统现有非赛事模块及其入口和存储行为。
- 赛事生产数据必须通过服务端 API 持久化；LocalStorage 只允许用于非权威界面偏好或离线草稿。
- 浏览器不得包含 CloudBase API Key、微信 AppSecret、服务端密码或可伪造的生产登录令牌。
- 小程序现有赛事详情、报名状态、成绩发布和工作人员赛段权限必须维持兼容。
- 赛事正文和富文本需沿用安全清洗；报名、收费、组别和成绩规则由服务端重新校验。
- 不把目标页面其余业务模块纳入本次迁移。

---

## 代码与接口边界

目标项目：`D:/gogle下载/全新系统/index.html` 是单页 React 应用；`RaceAdminSDK` 声明了 `/v1/auth/*`、`/v1/events` 和赛事子资源客户端，但登录及许多模块仍读写 `localStorage`。`INTEGRATION_GUIDE` 已列出建议的赛事、报名、检录、成绩和财务 API。

现有赛事系统：`D:/微信小程序开发/score-review-web/server.js` 与 `cloud-store.js` 提供网页端登录、CloudBase 赛事记录、成绩和工作人员权限服务；小程序赛事列表及详情位于 `racing-app/pages/events/`、`racing-app/subpackages/events/detail/`，登录和云函数位于 `racing-app/utils/`、`racing-app/cloudfunctions/`。现有网页 API 的 `/api/events` 等路由与目标端的 `/v1/events` 并非同一契约，必须先设计兼容适配层，不能假设直接改 `baseURL` 就能连通。

## Task 1: 固化目标页面现状和迁移字段映射

**Files:**
- Read: `D:/gogle下载/全新系统/index.html`
- Read: `score-review-web/cloud-store.js`
- Read: `racing-app/pages/events/events.js`
- Read: `racing-app/subpackages/events/detail/detail.js`
- Create: `docs/superpowers/plans/race-data-mapping.md`

- [ ] **Step 1: 记录双方赛事数据字段**

  从源端整理 `id/title/dateStart/dateEnd/location/status/notice/detailPageHtml/contentBlocks/coverUrl/signupOptions/groups/visibleGroups/groupStageNames/stageNames`、报名费、备注、奖金和成绩发布字段；从目标 HTML 整理赛事 `ev`、`form`、`schedule`、组别中文键、报名条目和成绩结构。

- [ ] **Step 2: 编写迁移映射表和兼容原则**

  每个目标字段标注源字段、转换、缺省策略、是否必须保留原值以及小程序消费方。保留 CloudBase 现有赛事 ID；未知字段放在版本化 `extensions` 对象，不静默丢弃。

- [ ] **Step 3: 核对字段映射**

  对照小程序 `normalizeEvent`、`normalizeSignupOptions`、详情正文构建和成绩发布路径，确保同一赛事从管理端保存后仍可被现有正式版小程序正确读取。

## Task 2: 设计并实现兼容 API 与真实授权

**Files:**
- Modify: `score-review-web/server.js`
- Modify: `score-review-web/cloud-store.js`
- Modify: `score-review-web/package.json` only if a required test dependency is absent
- Create: `score-review-web/tests/event-v1-api.test.js`
- Modify: `score-review-web/CLOUD-HOSTING-SETUP.md`

- [ ] **Step 1: 为目标 API 契约写失败测试**

  覆盖 `/v1/auth/login`, `/v1/auth/me`, `/v1/auth/logout`, `/v1/events` 的会话认证、列表分页、创建、更新、无权限 403 和输入校验；覆盖 `/v1/events/:id/:resource` 的资源读写及非法赛事 ID。

- [ ] **Step 2: 写版本化数据适配函数**

  增加纯函数 `toRaceAdminEvent(sourceEvent)` 和 `fromRaceAdminEvent(targetEvent, existingEvent)`；把目标字段映射回当前 CloudBase 文档时保留旧字段和未知 `extensions`。适配函数不访问网络或数据库。

- [ ] **Step 3: 接通服务端路由**

  将 `/v1` 路由映射到现有 CloudBase store；以服务端会话验证每个写请求，以当前管理员/工作人员角色校验资源范围；公众只读接口只返回已发布赛事，不回传内部权限、手机号密钥或草稿。

- [ ] **Step 4: 保持现有路由兼容**

  保留 `/api/events`、成绩和小程序 callContainer 使用中的现有路由；对相同记录通过同一个 store 实现，不创建第二份赛事权威数据。

- [ ] **Step 5: 运行接口测试**

  运行：`node --test score-review-web/tests/event-v1-api.test.js score-review-web/tests/*.test.js`。预期：新路由测试和既有测试全部通过。

## Task 3: 以真实 API 替换目标端赛事管理演示数据

**Files:**
- Modify: `D:/gogle下载/全新系统/index.html`
- Create: `D:/gogle下载/全新系统/tests/race-admin-api.test.js`（若目标项目未启用 Node 测试，先为该纯前端脚本增加可运行的 Node 测试入口，不引入构建系统）

- [ ] **Step 1: 将赛事业务请求抽离为可测模块**

  把登录、赛事列表、详情、保存、删除、组别/报名/成绩子资源调用封装在 `RaceAdminSDK` 周围的独立接口层；React 页面只调用接口层，不直接操作赛事 LocalStorage。

- [ ] **Step 2: 替换演示认证**

  删除赛事管理入口的固定 `admin/123456`、`mock-jwt-token` 和伪造角色。启动时请求真实会话；401 返回登录，403 显示无权限，退出后清除会话并重载当前用户数据。

- [ ] **Step 3: 替换赛事及组别读写**

  `ListPage`、`InfoPage`、`GroupPage` 与赛事相关 CRUD 改用 `/v1/events`、`/v1/events/:id/groups`；保留分页、搜索、加载、空态、保存中和服务端错误提示。

- [ ] **Step 4: 替换详情、横幅和正文保存**

  映射赛事标题、日期、地点、报名字段、可手动新增/移除的横幅、富文本、表格、奖金模板和颜色配置；图片上传通过服务器签发的上传流程，记录只保存 CloudBase 文件 ID 或 HTTPS 地址，不把大图片 Base64 写入 LocalStorage。

- [ ] **Step 5: 做新增/编辑/保存/刷新验收**

  使用非生产测试赛事，新增后刷新仍能读取，编辑保存后小程序公开赛事接口回读字段一致；删除需二次确认并遵守已有关联报名/成绩保护规则。

## Task 4: 迁移报名、检录、赛程、成绩和发布能力

**Files:**
- Modify: `D:/gogle下载/全新系统/index.html`
- Modify: `score-review-web/server.js`
- Modify: `score-review-web/cloud-store.js`
- Modify: `racing-app/cloudfunctions/web-api/index.js` only when the existing app contract requires a compatibility change
- Modify: `racing-app/subpackages/events/detail/detail.js` only when contract tests show a required backward-compatible fix
- Create: `score-review-web/tests/race-resource-api.test.js`

- [ ] **Step 1: 接通报名及名额 API**

  将报名、报名项、收费单位（人/辆/队）、金额、备注、名额和报名状态映射到数据库资源；服务端校验组别归属、名额并发和重复报名，不信任浏览器汇总数。

- [ ] **Step 2: 接通检录、赛程、车检和罚时 API**

  为目标模块建立明确资源端点或复用既有受权路由；对车辆、赛事和赛段关系做服务端验证，保留每项资源的 ID、修改人和时间。

- [ ] **Step 3: 接通成绩审核与发布快照**

  复用已有的成绩版本、赛段权限、审核状态和不可静默覆盖的发布历史；发布动作在服务端校验角色、赛事、赛段和修订版本。

- [ ] **Step 4: 验证小程序回读**

  对赛事正文、报名费 `¥ 金额/人|辆`、非空备注括号展示、横幅和成绩发布做接口回归测试，并在小程序开发工具用测试赛事检查手机详情页。

## Task 5: 数据备份与一次性导入

**Files:**
- Create: `tools/race-migration/export-local-race-data.js`
- Create: `tools/race-migration/import-race-data.js`
- Create: `tools/race-migration/tests/mapping.test.js`
- Create: `docs/race-system-migration-runbook.md`

- [ ] **Step 1: 导出目标浏览器赛事数据**

  提供浏览器内可运行的导出脚本，读取 `race-events` 及赛事相关 LocalStorage 键，生成带 `schemaVersion`、导出时间和校验和的 JSON；导出前显示记录数量，绝不将资料上传到陌生服务。

- [ ] **Step 2: 实现预览模式导入器**

  默认 `--dry-run`，报告新增、更新、冲突和缺失字段；正式写入需显式 `--apply`，按 ID 更新，不自动覆盖目标端非赛事数据。

- [ ] **Step 3: 测试可重复导入**

  用固定 JSON 样本覆盖重复执行、ID 冲突、未知字段保留、失败回滚和图片引用；第二次执行不得重复创建记录。

- [ ] **Step 4: 编写回滚和操作步骤**

  记录 CloudBase 备份、测试环境导入、生产停写窗口、导入前后数量校验和回滚恢复方式。

## Task 6: 分环境验收和发布

**Files:**
- Modify: `docs/race-system-migration-runbook.md`
- Modify: `score-review-web/CLOUD-HOSTING-SETUP.md`
- Modify: `racing-app/project.config.json` only if a new合法小程序服务器域名/请求通道确有需要

- [ ] **Step 1: 验证本地测试环境**

  配置独立 CloudBase 测试环境和测试凭证；运行全部 Node 测试，再做端到端新增赛事、奖金表格、报名、录入成绩、审核发布和小程序回读。

- [ ] **Step 2: 验证权限和故障情况**

  覆盖未登录、会话过期、普通工作人员越权、网络断开、重复提交、保存超时后重试和大正文/多图片场景；确认失败会显示结果并且不静默丢数据。

- [ ] **Step 3: 对照生产数据做只读演练**

  用生产只读查询比对记录计数和映射结果；备份后先导入一条已批准的测试赛事，验证管理端与正式接口回读相同后再迁移其余数据。

- [ ] **Step 4: 分开发布网页服务和小程序版本**

  部署兼容 API 和目标管理端后复测 HTTPS 与会话；小程序改动需单独在微信开发者工具上传、提审和发布。每步记录版本号、接口健康检查结果和回滚版本。

## 验收标准

- 目标“赛事管理”读取和保存的是同一份 CloudBase 赛事数据，刷新或换管理员设备不会丢失。
- 赛事、横幅、富文本/奖金表格、组别奖金、报名资料和成绩发布在目标管理端可完成操作。
- 正式小程序无需升级也能读取兼容记录；若需升级，明确列出变更并通过开发版验收。
- 目标系统其他管理模块仍能运行，数据互不覆盖。
- 演示账号、固定令牌和任何密钥不进入生产路径或客户端包。
- 导入流程可预览、可重复执行、可核对且有恢复步骤。
