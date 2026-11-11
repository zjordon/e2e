# e2e 初学者指南：理念、机制与上手路径

写给第一次接触 e2e 的人。前半部分讲理念和机制，细节取自仓库源码和随包分发的技能文档，不是转述宣传语；最后一节是照着做就能跑通的一小时上手路径。配套的问答版在 [e2e 概念问答](e2e-concepts-qa.md)，那边是真实接入过程中问出来的问题，两篇可以互为索引。

## 1. 它取代你的手，不取代你的脑

写一个端到端测试要两类知识。测什么、对错标准是什么，这是脑；把意图变成找按钮、填表单、等加载的操作序列，这是手。传统 Playwright 测试贵就贵在手的部分：懂需求的人把意图逐条翻译成选择器和点击，UI 一改还得重翻译一遍。

e2e 把手的部分接走了。你说"让应用问候 Grace"（一句话），agent 自己看页面、找控件、完成目标；验证结果的断言仍然是你写的一行代码。表格如下。

| 知识 | 内容 | e2e 之后 |
|---|---|---|
| 测什么、对错标准（脑） | 覆盖哪些场景、业务规则、预期结果 | 仍然是人，而且变成人的几乎全部工作 |
| 怎么操作浏览器（手） | 找控件、填表、等加载、处理 iframe 和动效 | agent 首跑自己完成，录下来之后回放 |

所以测试人员的产出从"一套 Playwright 脚本"变成"一份薄测试加两份清单"。薄测试是一句话目标加一行断言；清单是覆盖面（哪些场景要测）和业务规则（什么算对）。代码打字可以交给编码代理，清单的内容只有你定得了。框架没有任何机制替你判断什么值得测，也不应该有。

需求表达的质量直接就是测试的质量。这句话不是修辞，第 4 节的机制会说明为什么。

## 2. 一个测试长什么样

下面是官方示例 `examples/with-vite` 的真实代码，整个项目就这些。先看不需要模型的那一半，`tests/deterministic.e2e.ts`：

```ts
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('greets the name you type', async ({ app, screen }) => {
  await app.open('/');

  await screen.getByLabel('Name').fill('Ada');
  await screen.getByRole('button', 'Greet').click();

  await expect(screen.getByRole('status')).toHaveText('Hello, Ada!');
});
```

再看有 agent 的那一半，`tests/agentic.e2e.ts`：

```ts
test('the agent gets a greeting', { skip }, async ({ app, agent, screen }) => {
  await app.open('/');

  // The agent works out which field and button to use.
  await agent.act('get the app to greet {name}', { params: { name: 'Grace' } });

  // Pair each agent step with a check that does not depend on the model.
  await expect(screen.getByRole('status')).toHaveText('Hello, Grace!');
  await agent.assert('the app greets Grace by name');
});
```

配置在 `e2e.config.ts`，声明引擎、被测应用和模型各一份：

```ts
export default {
  agents: {
    default: {
      model: gateway('openai/gpt-6-luna-fast'),
      system: 'You are a thorough QA agent. Verify every outcome.',
    },
  },
  targets: [
    {
      engine: web(),
      app: {
        url: 'http://localhost:5173',
        // runner 会自己起 dev server 并等 URL 应答；本机已有服务在跑就复用
        command: { executable: 'npm', args: ['run', 'dev'], reuseExisting: true },
      },
    },
  ],
} satisfies E2EConfig;
```

三件事值得注意。确定性测试完全不需要模型和 key，拿起来就能跑。agent 测试没有 key 会跳过而不是报错，因为示例文件里写了 `skip` 条件。`app.command` 让 runner 负责启动被测应用，测试文件里不用管服务起没起。

定位控件的方式也值得看一眼：`getByLabel('Name')`、`getByRole('button', 'Greet')`。没有 CSS 选择器，没有 `data-testid`（支持，但不是首选）。e2e 的定位语言是语义，角色加可访问名。第 6 节会说这套语义从哪来。

## 3. 两半结构：操作用自然语言，对错用断言

每个 `agent.act` 后面必须跟一个不依赖模型的检查，这是技能文档里的原话规则，示例代码的注释也印着它。原因很直白：纯自然语言的"成功"是模型自己说了算，它觉得做到了就算做到了，等于考生自己给自己判卷。断言把判卷权拿回人手里。

断言一侧还有三个判断类 API，各管一种问法：

```ts
await agent.assert('the dashboard shows a trial badge');   // 看一眼，判一次，不轮询
await agent.waitFor('the export finished', { interval: 500, timeout: 120_000 }); // 轮询到屏幕变化才判
const data = await agent.extract('every todo title', {     // 结构化输出
  schema: z.object({ titles: z.array(z.string()) }),
});
expect(data.titles).toContain('Buy milk');
```

`assert` 证据不足也是失败，错误码 `ASSERTION_INCONCLUSIVE`，所以要先走到对的屏幕再问可见的问题。`extract` 用 schema 校验模型读到的东西，屏幕上没有的数据返回缺失说明而不是空字符串。判断只看当前屏幕和问题本身，不看之前步骤的记录，两次判断之间没有对话残留。

写 goal 有三条规矩。一个 `act` 一个目标，路径归模型，顺序归测试。用屏幕上的词说事，写"open the Billing tab"而不是"upgrade"，模型看到的是页面语义树，Billing 这个词在树上。值放进 `params` 而不是展开进句子里，`act('rename to {name}', { params })`，这样录制才跨次有效。

## 4. 首跑时底下发生了什么

`agent.act` 的一次执行是一个有边界的循环。模型看到的是页面的语义树快照，角色、可访问名、文本、状态，经过脱敏。它看不到原始 HTML、cookie、环境变量，永远看不到 Secret 的值。它每一步发回的是一个工具调用，动词就那十几个：`tap`、`type`、`select`、`check`、`scroll`、`drag`、`upload`、`navigate`、`type_secret`、`screenshot`，加几个点坐标的变体。

安全性不是靠提示词维持的，是机制。每个工具调用先解析进封闭的 schema，派发前逐个授权；模型叫了不认识的工具、传了没声明的字段，这条错误原样回给它，下一轮自己修。点了一个不在当前屏幕上的节点是 `LOCATOR_NOT_FOUND`，一种普通的动作失败，模型读到后重新瞄准。模型返回的任何内容都不会被当作代码、选择器或 shell 执行。

预算也有边。一次 `act` 默认最多 25 次模型调用、120 秒，每次调用拿干净的观察，步骤之间不共享对话。预算烧完是 `STEP_BUDGET_EXHAUSTED`，测试失败，不会无限花钱。登录这类敏感填值走 `type_secret`：步骤声明句柄，模型只看得见名字，runner 负责往密码框里填值。

所以"需求表达的质量直接就是测试的质量"的机制版本是：模型拿到的全部信息是你的一句话、页面语义树和配置里的 `context`（应用词汇表）。你没说的规则它不知道，只能拿通用常识垫底。反直觉的业务规则（考试开始后不能重复进入、切屏一次强制交卷）必须写进 goal 文本，或者干脆写成断言。规则变成断言是最强的一级，那时候对错不再依赖任何模型的理解。

## 5. 录制与回放：自然语言只解释一次

首跑成功后，动作序列录进 `.e2e/cache/`。之后每次回归回放的是录制，模型不参与。可以把自然语言理解成源码，录制是编译产物，回归是跑二进制。UI 改版会让录制失配，报 `REPLAY_STALE`，重新"编译"一次就好。

录制和回放的精确规则，来自技能文档 `agent` 主题，每条都有对应实现：

- 条目不是 act 一通过就写。它要求 act 之后紧跟的验证也通过，定位器断言、`browser.waitForURL`、`agent.assert` 都算数；没有验证的 act 永远不回放。这是"被证明的录制"的出处：录制写入的前提是你的断言已经确认了结果。
- 回放不是傻点坐标。它按角色、可访问名、test id、placeholder、输入用途重新找每个控件；终点路由回来了、该出现的控件带着状态出现了、该消失的消失了，才算独立通过。对不上时活的 agent 中途接管，从当前屏幕继续，不是直接失败。
- 判断类步骤（`assert`、`waitFor`、`extract`）永不缓存，每次都活跑。缓存只管动作。
- 一次失败的运行会把它牵连的条目逐出缓存，坏录制不会留下来反复坑你。
- 默认读写模式；CI 里默认只读；`--no-cache` 全关。

`e2e init` 生成的 `.gitignore` 会忽略 `.e2e/cache/`。删掉那一行，把录制提交进仓库，团队和 CI 就共享零成本回归；CI 再加 `--strict-cache`，失配的录制明确报 `REPLAY_STALE`，而不是每个 run 悄悄花一遍模型钱。这个仓库自己就是这么用的：web 和 mobile 两个 benchmark 把 agent 套件的录制全部提交，CI 按确定性的速度和成本守门，只有没录制过的步骤才调模型。

## 6. 常见质疑：让 code agent 直接生成 Playwright 不行吗

现在编码代理写 Playwright 很熟练，测试人员用自然语言描述、代理生成脚本，听起来同样省事。这个流程成立，分歧在产物形态和长期维护行为上。

生成的脚本是开环的。代理基于它看过的页面把整个操作序列一次性写完，冻结成选择器和点击流。首跑常常就错，进入"跑错、改代码、再跑"的循环。脚本的正确性是被相信的。e2e 首跑是闭环的，每步对着当前活页面执行，动作失败回给模型重新瞄准，最后过你的断言，全通过才录制。录制的正确性是被证明的。

| | 生成 Playwright 脚本 | e2e |
|---|---|---|
| 首跑产物 | 完整脚本（代码） | 一句话目标加断言，加录制（数据） |
| UI 改版后 | 测试红或 flake，人读代码分辨是产品坏了还是脚本过期 | `REPLAY_STALE` 指名步骤，重录即可，断言重新把关 |
| 长期维护对象 | 整份脚本 | 一句话加一行断言 |
| flake 来源 | 生成的等待和选择器竞态 | 没人写等待，轮询和匹配语义由引擎统一提供 |
| 需求权威 | 每次重新生成都是对需求的一次重新解释，漂移累积 | 重录只重新推导"怎么做"，"测什么"钉在人写的目标里 |

"要让模型重新学一门语言"的说法也不成立，两层都不成立。作者面上要写的 API 就五六个：`test`、`agent.act`、`expect`、`session`、`setup`，比 Playwright 的 API 面小一个量级。执行面上模型用的不是语言而是动词，`tap` 和 `type`，每个调用都过校验和授权。真正复杂的部分在框架运行时里，其中最值钱的是语义树：引擎把页面读成角色加可访问名的树，模型和定位器都在这棵树上工作。这棵树在这个仓库里被两套外部基准校验过。`packages/web/tests/integration/crosscheck.test.ts` 把树上每个节点与 Chrome 通过 CDP 暴露的无障碍树、以及 Playwright `getByRole` 的往返结果互查；另一个 conformance 套件（`packages/web/tests/conformance/`）拿 axe-core 测试套件的角色与可访问名预期逐条对表，不一致的地方全部登记在案并写明原因。选择器定位 DOM，语义定位含义，DOM 重构、class 改名、框架迁移都动摇不了后者。这些是运行时机器，不在任何模型的权重里。

诚实地说边界。已有 Playwright 底子和 CI 的团队、数据驱动和参数化测试、改版少维护期短的项目，直接生成脚本够用甚至更合适，e2e 里这类测试也仍然用代码写。e2e 拉开差距的地方是长期维护、UI 改版频繁、flake 敏感、需要同一套写法覆盖移动原生应用（`@e2e-dev/mobile` 管 iOS 模拟器、Android 模拟器和真机，Playwright 只覆盖浏览器）、以及需要探索和密钥纪律的场合。

## 7. 测试项目放哪

e2e 不要求独立建测试项目，Playwright 也不必须住在被测仓库里。放哪是工程组织决策，两个工具哪个方向都能放。这个仓库的官方示例就是两种都有：web 示例（`examples/with-vite`、`with-next`、`with-astro`）测试和应用同目录；原生示例（SwiftUI、Compose、Flutter）在原生项目旁边放一个 `e2e/` 文件夹。

| | 放被测项目里 | 独立测试项目 |
|---|---|---|
| 改动原子性 | UI 改动、测试更新、重录同一个提交 | 跨仓库两次提交，自己保证顺序 |
| 边界 | 白盒方便，能读源码 | 黑盒被物理强制，测试只能看见服务 |
| 工具链 | 被测仓库背上测试工具全套依赖 | 各自干净，Python 仓库不用装 Node |
| 节奏 | 测试随应用发布 | 独立演进，可测多套环境 |

按工具链是否同族、要不要白盒、改版时想不想一次提交来选。搬家也只是挪目录装依赖的事，框架层面没有障碍。

## 8. 选它还是不选

把前文收拢成一个判断清单。

选它的信号：应用在活跃开发，UI 会持续改；回归要天天跑、跑得起；flake 已经在消耗团队时间；同样的流程要覆盖浏览器和移动原生；团队里懂需求的人多、熟 Playwright API 的人少；需要在真实服务上做黑盒探索。

不选的信号：项目接近维护尾声，改版稀少；测试以 API 和数据驱动为主；已经有一套维护良好的 Playwright 资产，且没有明显的 flake 痛点。这种情况下引入任何新框架的迁移成本都盖过收益，诚实的建议是不换。

## 9. 上手：第一小时

1. 建项目。在被测应用旁边（或里面）执行 `npx e2e init`，交互里选 web 引擎和模型通路。它会写好 `e2e.config.ts`、示例测试、`.gitignore`，把技能文档装进 `.agents/skills/` 和 `.claude/skills/`，并注册 `.mcp.json`。
2. 先跑确定性示例，`npx e2e run`。这一步不需要任何模型 key，验证引擎和应用接线正确。
3. 在 config 里配好模型（任何支持工具调用的 AI SDK 提供商都行），跑 agent 示例。观察第一次模型驱动的执行和它录下的动作。
4. 把 `.gitignore` 里 `.e2e/cache/` 那行删掉，提交录制。从现在起回归零模型成本。
5. 写自己的第一个测试：一句 `agent.act`，紧跟一行 `expect`。卡住时按这个顺序查：

   - `npx e2e guide`，八个主题的官方文档，`writing-tests` 和 `agent` 最常翻。
   - 失败测试的 trace 页，`.e2e/results/<test>/trace.md`，每一步做了什么、缓存的决定、失败时的屏幕都在里面。
   - `--debug` 打印每步的时长、模型调用、token 和成本。
   - `npx e2e explore "目标"`，不带测试文件的探索，适合先摸清陌生应用。
   - `npx e2e mcp` 起 MCP 服务器，编码代理可以用 `open_session`、`observe`、`locate` 实时看页面、试操作，边看边写测试。

最后一条铁律来自技能文档：永远不要加 sleep。动作会等就绪，断言会重试，等待是引擎的事。

## 心智模型

- 工作流：规格（人）→ 薄测试（一句话目标加一行断言）→ 首跑录制（唯一花钱处）→ 回归零成本回放 → 改版重录同提交。
- 分工：覆盖面和业务规则来自人；页面结构来自实时观察；探索命令负责找你不知道自己不知道的东西。
- 规则注入：常识不如写进目标文本，写进目标文本不如变成断言。
- 定位：取代手，不取代脑；操作用自然语言，对错用断言；自然语言只解释一次。
- 对比生成脚本：开环产出被相信的代码，闭环产出被证明的录制。
- 放置：独立还是同仓库，按工具链、边界、原子性权衡，两个方向都合法。
