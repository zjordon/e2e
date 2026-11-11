# 考试系统接入 e2e 测试实施计划

> 元信息
> - 日期：2026-11-09（同日更新：填定考生端路径 / 移动端形态 / 全部账号）
> - 目标系统：本地部署的考试系统 `http://127.0.0.1:8000`，含三个使用端：
>   - **管理端**：`/admin`（Web，管理员登录后由 `/` 303 跳转进入）
>   - **考生端**：同源，路径见 §3.1 路由表（已确认）
>   - **移动端**：移动 Web（响应式，断点 `max-width: 767.98px`，验收基线 375×812）
> - 三端均为 Web 形态，全部走 web 引擎 + 本地 Chrome CDP 附着，无需 mobile 引擎和模拟器
> - 关联仓库：e2e 框架 fork（`D:\dev\git\z_jordon\fork\active\e2e`，本计划存放于其 `docs/`）
> - 状态：参数已填定；**待开发库种子数据就绪后执行**（见阶段 0 前置）

## 1. 背景与目标

用 e2e 框架对考试系统做 agentic 端到端测试：先让 agent 探索与执行目标，再把通过验证的动作固化为**可零成本回归的测试**。

必须明确的定位：e2e 的回归产物是 **e2e 测试文件 + `.e2e/cache/` 回放录制（trace-1 格式）**，不是 Playwright 脚本，也没有导出为 Playwright 代码的功能。回归永远在 e2e 工具链内执行（首跑模型驱动 + 录制，之后回放缓存、零模型调用）。

**与考试系统仓库自带 Playwright 套件的分工**（互补，不替代）：那边 `tests/e2e`（`live_server` fixture + 临时 SQLite）管确定性验收基线，含 375×812 `is_mobile`/`has_touch` 触屏仿真（`mobile_page`）；本套管 **agentic 流程 + 回放缓存**，打 dev 服务器（8000 端口）的真实开发库。代价是开发库需要种子数据（阶段 0 前置）。

## 2. 已确定的决策

| # | 决策 | 理由与依据 |
|---|------|-----------|
| 1 | **模型用智谱 GLM Coding Plan（`glm-5.3`）**，走 Anthropic 兼容端点 + `@ai-sdk/anthropic` 的 `createAnthropic` 接入 | e2e 模型层是标准 AI SDK 生态（"Every AI SDK provider that supports tool calls works"，`docs/models.mdx`）。Coding Plan 的 key 即 Anthropic 兼容端点 key |
| 2 | **浏览器用本地 Chrome，CDP 附着，不自动下载**：`web({ connect: { cdpEndpoint } })` | 源码验证：`packages/web/src/surface.ts:318`，`connect` 配置存在时 `prepare` 直接跳过 `ensureBrowsersInstalled`。Chrome 136+ 要求远程调试必须配独立 `--user-data-dir` |
| 3 | **应用侧只配 `app.url`，不配 `app.command`** | 服务用户自己跑（`uv run uvicorn app.main:app --port 8000`），e2e 直接连；顺带避开原生 Windows 下 npm/pnpm `.cmd` shim 无法被 shell-less spawn 的已知问题 |
| 4 | **端结构：两个命名 target**——`desktop`（默认视口 1280×720，管理端+考生端共用，靠 `app.open()` 区分路径）与 `mobile`（视口 **375×812**，对齐验收基线宽度） | 考生端同源不同路径，无需独立 target；同平台两个 target 必须命名（`docs/reference/config.mdx`），运行时用 `--target` 选择。**限制**：e2e 的 `WebOptions` 只暴露 `viewport`，不暴露 Playwright 的 `isMobile`/`hasTouch`（`surface.ts:156-231` 已核实）——触屏语义基线由考试系统仓库的 Playwright 套件覆盖，本套负责移动宽度下的 agentic 流程 |
| 5 | **账号凭据走 config 的 `credentials` 块 + setup 测试的 session 复用**，密码经环境变量注入，永不硬编码、永不出现在 goal 文本里 | `docs/authentication.mdx`："Sign in once, reuse the session across tests"。密码是句柄（`<secret:name>`），模型/报告/录制里都看不到值 |

约束组合意味着：e2e 自身**不下载任何东西**（浏览器走附着、依赖走普通 npm 安装），全程可在原生 Windows PowerShell 下操作。

## 3. 参数清单（已填定）

| 参数 | 值 | 说明 |
|------|-----|------|
| 测试项目目录 | `D:\dev\git\z_jordon\examination-system-e2e` | 已定 |
| Chrome 可执行文件 | `C:\Program Files\Google\Chrome\Application\chrome.exe` | 按实际安装路径调整 |
| 调试端口 | `9222` | 被占用就换，config 同步改 |
| Chrome 独立 profile 目录 | `D:\dev\chrome-e2e-profile` | 测试专用，不污染日常浏览器 |
| 智谱模型 ID | `glm-5.3` | 已定 |
| `ZHIPU_API_KEY` | —（执行时进 `.env`） | bigmodel 控制台 Coding Plan 页获取 |
| 移动视口 | `375 × 812` | 对齐考试系统验收基线宽度；断点 `767.98px` 由宽度触发 |
| 密码 | 统一（本地 e2e 种子账号专用测试密码，已定；值只写入测试项目 `.env`，不写入文档） | 仍走 `.env` 注入不硬编码；**任何凭据（含测试密码）一律只进 `.env`、不进对话/文档** |

### 3.1 考生端路由表（已确认）

| 路径 | 页面 | 要点 |
|---|---|---|
| `/login` | 登录页 | 表单 POST `/api/login`；退出 POST `/api/logout`；管理员登录后访问 `/` 会 303 跳 `/admin` |
| `/` | 我的考试（首页） | 考试卡片：徽标（进行中/未开始/已结束/模拟）、已参加次数、入口按钮（进入考试/继续答题/再来一次/查看成绩） |
| `/exams/{id}/intro` | 考前须知 | 时间窗/时长/及格线 + 「确认无误，开始答题」 |
| `/exams/{id}/take` | 答题页 | Alpine 外壳，数据 `POST /api/take/{id}/start` 加载；倒计时、单题增量保存、切屏检测 |
| `/exams/{id}/result` | 成绩页 | 总分/及格、逐题解析；模拟考 `?sheet=N` 切换历史 |
| `/my/wrong` | 错题本 | 历次答错归集，题型/题库筛选分页 |

典型 happy path：`/login` → `/` → `/exams/{id}/intro` → `/exams/{id}/take` → 交卷 → `/exams/{id}/result`。

### 3.2 测试账号（e2e 种子考生，密码统一见上表）

| credentials 键 | 用户名 | 姓名 | 角色 | 可参加的种子考试 |
|----------------|--------|------|------|------------------|
| `admin` | `admin` | — | 管理员 | —（管理端） |
| `stu_e2e` | `stu_e2e` | 考生小E | 考生 | E2E考试（固定卷）、E2E随机考试（双乱序）、E2E模拟考试（不限次） |
| `stu_e2e2` | `stu_e2e2` | 考生小F | 考生 | E2E随机考试、E2E切屏考试（切屏 1 次强制交卷） |
| `stu_e2e3` | `stu_e2e3` | 考生小G | 考生 | E2E考试 |

对应密码环境变量：`EXAM_ADMIN_PASSWORD`、`EXAM_STU_E2E_PASSWORD`、`EXAM_STU_E2E2_PASSWORD`、`EXAM_STU_E2E3_PASSWORD`。移动端不设独立账号——移动 Web 即考生界面的响应式呈现，mobile target 复用考生会话。

**关键前提**：这批账号与种子考试目前只存在于考试系统仓库 `tests/e2e` 的**临时种子库**（每次由 `live_server` fixture 新建临时 SQLite 灌入），**不在开发库 `data/exam.db`**。打 8000 端口真实服务前必须先在开发库造好（见阶段 0）。

## 4. 阶段 0：前置检查

```powershell
# 服务可访问（返回页面或 3xx 即可）
curl.exe -I http://127.0.0.1:8000/admin
curl.exe -I http://127.0.0.1:8000/login

# Node 版本：需要 ^22.22.3 || >=24.8.0
node -v
```

- [ ] **开发库种子数据就绪**：回考试系统仓库那边的会话说一声"在开发库创建"，让它在 `data/exam.db` 造好三个同名考生（密码用 §3 的统一种子密码，值见测试项目 `.env`）+ 种子考试 + 报考名单（admin 账号按其现有情况确认）
- [ ] 种子就绪后用 `stu_e2e` 在浏览器手工登录一次 `/login`，确认能看到"E2E考试"等卡片
- [ ] 确认管理员登录后的落点（`/login` 登录 → 访问 `/` 是否 303 到 `/admin`），写测试时用
- [ ] 服务在跑且 `/admin`、`/login` 可达
- [ ] Node 版本满足要求
- [ ] Chrome 已安装（`Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe"`）
- [ ] `ZHIPU_API_KEY` 已取得（进 `.env`，不进对话）

## 5. 实施步骤

### 阶段 1：建测试项目

```powershell
mkdir D:\dev\git\z_jordon\examination-system-e2e; cd D:\dev\git\z_jordon\examination-system-e2e
npm init -y
npx e2e init
```

向导选择：**Web (Playwright)**；模型选 **None**（智谱在阶段 2 手工接，不走向导的预设）。

完成判据：目录下生成 `e2e.config.ts`、`tests/` 示例测试、`.claude/skills/e2e/` 等；依赖已安装。

### 阶段 2：配置改造（核心）

安装 provider 包：

```powershell
npm i -D ai @ai-sdk/anthropic
```

将 `e2e.config.ts` 整体替换为附录 A 模板，含四部分：zhipu provider、`connect.cdpEndpoint`、两个 target（desktop 1280×720 / mobile 375×812）、`credentials` 四个账号。

**凭据在本阶段进入（硬性时点）**：config 一旦声明 `credentials`，加载时即校验每个密码——未设置或少于 6 位，**所有命令**（连 `e2e list`）直接 `INVALID_CONFIG` 拒绝运行。密码值已知（统一测试密码），执行时可直接生成完整 `.env`：

```powershell
# .env（放项目根，加进 .gitignore）
ZHIPU_API_KEY=<你的key>
EXAM_ADMIN_PASSWORD=<统一种子测试密码>
EXAM_STU_E2E_PASSWORD=<统一种子测试密码>
EXAM_STU_E2E2_PASSWORD=<统一种子测试密码>
EXAM_STU_E2E3_PASSWORD=<统一种子测试密码>
```

config 顶部的 `process.loadEnvFile()` 会读取它（e2e 不自动加载 `.env`）。密码也支持运行时用 `E2E_USER_<NAME>_PASSWORD` 环境变量临时覆盖（`docs/authentication.mdx` "Override a value per run"）。

完成判据：`npx e2e list` 正常列出示例测试（不再 `INVALID_CONFIG`，说明凭据校验通过）。

### 阶段 3：冒烟验证

**3.1 启动调试 Chrome**（保持开着，e2e 跑完只断开、不关闭）：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir=D:\dev\chrome-e2e-profile `
  http://127.0.0.1:8000/login
```

两个参数都必须带：端口开 CDP；`--user-data-dir` 是 Chrome 136+ 的强制要求（默认 profile 上调试端口不生效）。

**3.2 先跑示例测试**（init 生成的，无模型调用，验证 Chrome 附着 + 服务连通）：

```powershell
npx e2e run
```

**3.3 再跑智谱链路冒烟**（附录 B 模板存为 `tests/smoke.e2e.ts`）：

```powershell
npx e2e run tests/smoke.e2e.ts --no-cache
```

完成判据：示例测试绿；冒烟测试绿且能在报告里看到模型实际调用了智谱（agent 步骤非缓存回放）。

### 阶段 4：探索期（可选但推荐）

```powershell
npx e2e explore "浏览 /admin 后台的主要功能，检查各入口是否正常，报告任何异常"
```

探索输出发现报告，不生成测试——用于摸底，确定哪些流程值得固化。

**红线：探索目标文本里绝不出现账号或密码**——goal 文本会完整进入模型输入。登录页本身的可用性、公开流程可以先探；登录后的深度探索放到阶段 5 有 session 机制之后通过测试进行。

### 阶段 5：固化测试用例

**5.1 登录集中化：setup + session 复用**（`docs/authentication.mdx` 的多用户模式）。四个账号各一个 setup 测试（登录页统一 `/login`），每次运行只登录一次；功能测试用 `{ session: 'stu_e2e' }` 直接带登录态开始（模板见附录 C）。secret 填充的像素 taint 会传到恢复该 session 的测试（截图受限），若需要保留功能测试截图，参考 `/reference/security#screenshots-after-a-secret-fill` 的登录写法。

**5.2 固定模式**（框架最佳实践，见 `AGENTS.md`）：

> **每个 `agent.act` 后面跟一个确定性 locator 断言**——agent 步骤负责"做到"，locator 断言负责"证明确实做到了"，后者天然确定性、零模型调用。

**5.3 首批用例矩阵**（按种子考试设计，账号能力对号入座）：

| target | 账号/session | 用例 |
|--------|--------------|------|
| desktop | `stu_e2e` | **完整 happy path**：登录 → 我的考试卡片可见 → 进入 E2E考试 intro → 确认开始 → 答题 → 交卷 → 成绩页显示总分与及格状态（可拆成多 test，靠 session 续登录态） |
| desktop | `stu_e2e` | E2E模拟考试「再来一次」+ 成绩页 `?sheet=N` 切换历史各次 |
| desktop | `stu_e2e` | 错题本 `/my/wrong`：题型/题库筛选、分页 |
| desktop | `stu_e2e2` | E2E随机考试（双乱序）走一遍：题目顺序两次进入不同（断言用 extract/判断而非精确顺序） |
| desktop | `stu_e2e2` | E2E切屏考试：切屏 1 次强制交卷——确定性 locator 级用例（`browser.evaluate` 触发 `visibilitychange`），agent 不适合演切屏 |
| desktop | `stu_e2e3` | E2E考试（固定卷）重复覆盖：另一账号视角的同套流程回归 |
| desktop | `admin` | 登录（`/login`）→ 落点断言（303 → `/admin`）→ 仪表盘可见；题库/试卷管理列表与筛选；新建一条记录 → 保存且出现在列表 |
| mobile | `stu_e2e` | 375×812 下：登录 → 我的考试单列卡片布局 → 进入模拟考试答题页（答题卡堆叠在题面下方、选项触控目标 44px 可用） |

三端共用 target 结构：desktop 跑管理端+考生用例（`app.open('/admin/...')` vs 考生路径），mobile target 用 `--target mobile` 单独跑；未指定 target 时同一用例会在两个 target 上各跑一遍（桌面+移动双视口回归，通常是好事，不想要的用例用 `--target` 拆开跑）。

**注意**：答题页数据由 `POST /api/take/{id}/start` 动态加载（Alpine）——agent 观察会等 DOM 就绪，无需特殊处理；倒计时/增量保存/切屏检测是页面行为，断言只锚定稳定结果（成绩、状态徽标），不断言倒计时读数这类时变值。

### 阶段 6：回归策略

```powershell
npx e2e run                    # 首跑：模型驱动 + 录制
npx e2e run                    # 之后：读 .e2e/cache/ 回放，零模型调用
npx e2e run --target mobile    # 只跑移动端
```

- `.e2e/cache/` **提交进 git**（两个 benchmark 仓库即此用法）
- CI 加 `--strict-cache`：UI 改动导致录制过期时直接报 `REPLAY_STALE`，而不是悄悄调模型花钱
- UI 改版后重录（本地跑一次 `--no-cache`），变更的缓存条目与场景改动**同一 PR 提交**
- 注意：**回放也需要 `.env` 里的密码**——录制里存的是动作序列不是密码值，登录动作重放时仍由 runner 从凭据注入
- 注意：模拟考/随机考的行为有随机性（题目乱序、历史次数）——这类用例的确定性断言要锚定"结构存在"而非具体题目内容，否则录制回放与重录都易碎

## 6. 风险与回退

| 风险 | 表现 | 处理 |
|------|------|------|
| 开发库没有种子账号/考试 | 登录失败或考试列表为空 | 阶段 0 前置：让考试系统仓库侧在开发库造好；这是打真实服务的前提 |
| Anthropic 兼容端点路径差异 | 请求 404 | 调整 `baseURL` 末尾的 `/v1`（`@ai-sdk/anthropic` 自动拼 `/messages`，网关对该前缀处理不一） |
| Chrome 自动升级与 playwright-core 1.63 版本错位 | 读语义树异常 | 钉住独立 profile 的 Chrome 版本，或临时回退为下载配套 Chromium（去掉 `connect` 即恢复默认下载路线） |
| 模型拒绝 forced tool choice | agent 步报错 | e2e 内置降级重试（`docs/models.mdx` 所述机制），一般无需处理 |
| 录制过期 | `REPLAY_STALE`（strict 模式） | 属预期行为：重录并同 PR 提交 |
| 凭据缺失/过短 | 所有命令 `INVALID_CONFIG` | 检查 `.env` 是否就位、变量名是否与 config 读取的一致 |
| Chrome 调试端口未生效 | 连接 `http://127.0.0.1:9222` 失败 | 检查是否漏了 `--user-data-dir`；验证：`curl.exe http://127.0.0.1:9222/json/version` |
| 移动触屏语义（`is_mobile`/`has_touch`）| e2e 引擎未暴露这两个开关 | 由考试系统仓库自带 Playwright 套件（`mobile_page`）覆盖验收基线；e2e 负责移动宽度下的 agentic 流程 |
| 随机卷/模拟考历史导致断言不稳 | 录制回放或重跑偶发失败 | 断言锚定结构（卡片存在、成绩页元素）而非题目内容/次数 |
| 原生 Windows 兼容 | — | 本方案已规避 `app.command`（唯一硬坑）；官方对一般用户仍推荐 WSL，若日后让 e2e 自启应用需注意 `executable` 必须是真 exe（如 `node`） |

## 7. 附录

### A. `e2e.config.ts` 完整模板

```ts
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createAnthropic } from '@ai-sdk/anthropic';

// 从项目 .env 读环境变量（e2e 不自动加载 .env）
process.loadEnvFile();

const zhipu = createAnthropic({
  baseURL: 'https://open.bigmodel.cn/api/anthropic/v1',
  apiKey: process.env.ZHIPU_API_KEY,
});

// 本地 Chrome 附着（两个 target 共用同一个调试端口）
const attachChrome = web({
  connect: { cdpEndpoint: () => 'http://127.0.0.1:9222' }, // 不要加 reconnectEndpoint
});

export default {
  agents: {
    default: { model: zhipu('glm-5.3') },
  },
  targets: [
    {
      name: 'desktop', // 管理端 + 考生端（路径在测试里区分）
      engine: attachChrome, // 默认视口 1280×720
      app: { url: 'http://127.0.0.1:8000' },
    },
    {
      name: 'mobile', // 移动 Web，375×812 对齐验收基线宽度
      engine: web({
        connect: { cdpEndpoint: () => 'http://127.0.0.1:9222' },
        viewport: { width: 375, height: 812 },
      }),
      app: { url: 'http://127.0.0.1:8000' },
    },
  ],
  credentials: {
    // 用户名非机密，直接写；密码从环境变量读，缺失或 <6 位时所有命令 INVALID_CONFIG
    admin:    { username: 'admin',    password: process.env.EXAM_ADMIN_PASSWORD ?? '' },
    stu_e2e:  { username: 'stu_e2e',  password: process.env.EXAM_STU_E2E_PASSWORD ?? '' },
    stu_e2e2: { username: 'stu_e2e2', password: process.env.EXAM_STU_E2E2_PASSWORD ?? '' },
    stu_e2e3: { username: 'stu_e2e3', password: process.env.EXAM_STU_E2E3_PASSWORD ?? '' },
  },
} satisfies E2EConfig;
```

### B. `tests/smoke.e2e.ts`（智谱链路冒烟）

```ts
import { test } from '@e2e-dev/web';

test('智谱链路冒烟', async ({ app, agent }) => {
  await app.open('/login');
  await agent.act('描述当前登录页上有哪些输入项和按钮');
});
```

### C. `tests/auth.setup.e2e.ts`（多账号登录 + session 保存）

```ts
import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

// 考生会话（三个考生同构，替换 credentials.user 的参数即可）
test.setup('authenticate as stu_e2e', { sessions: ['stu_e2e'] }, async ({ app, screen, session, browser }) => {
  const stu = credentials.user('stu_e2e');
  await app.open('/login');
  await screen.getByLabel('用户名').fill(stu.username);   // 控件标签按实际页面调整
  await screen.getByLabel('密码').fill(stu.password);     // Secret 句柄，模型/报告/缓存都看不到值
  await screen.getByRole('button', '登录').tap();
  await expect(browser).toHaveURL('/');                    // 我的考试页 = 登录成功
  await session.save('stu_e2e');
});

// 管理员会话：同一登录页，登录后访问 / 会被 303 到 /admin（落点断言按实际跳转调整）
test.setup('authenticate as admin', { sessions: ['admin'] }, async ({ app, screen, session, browser }) => {
  const admin = credentials.user('admin');
  await app.open('/login');
  await screen.getByLabel('用户名').fill(admin.username);
  await screen.getByLabel('密码').fill(admin.password);
  await screen.getByRole('button', '登录').tap();
  await app.open('/');
  await expect(browser).toHaveURL('/admin');
  await session.save('admin');
});
```

### D. `tests/take-exam.e2e.ts`（固化用例示例：session + agent + 确定性断言）

```ts
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('考生完整走一场 E2E 考试', { session: 'stu_e2e' }, async ({ app, agent, screen, browser }) => {
  await app.open('/');

  await agent.act('进入名为「E2E考试」的考试，阅读考前须知并确认开始答题');

  // 确定性断言：证明真的到了答题页（锚定稳定结构，不断言题目内容）
  await expect(screen.getByRole('button', '交卷')).toBeVisible();

  await agent.act('作答所有题目并交卷');

  await expect(browser).toHaveURL(/\/exams\/\d+\/result/);
  await expect(screen.getByText('及格').or(screen.getByText('未及格'))).toBeVisible();
});
```

### E. Chrome 调试启动命令

见阶段 3.1。端口或 profile 目录改动时，同步修改 config 里的 `cdpEndpoint`。
