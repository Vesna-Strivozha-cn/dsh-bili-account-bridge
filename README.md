# dsh-bili-account-bridge（B站桥）· 0.326

一份 B站 登录态，给 **养鱼**（dsh-bili-whale）和 **大肥鱼**（dsh-dafeiyu-life）共用；一句前置判断，决定收到的这句话**要不要回、由谁回**。

它不是"第三个 B站 插件"，而是这两个插件中间的一层：登录态在这里对齐，能不能动手在这里开关，该不该回在这里打分，谁来回在这里抢单。

> **制作通告 / Made with DSH**：本插件的代码在 **DeepSeek Harness（DSH）** 会话中由 AI 助手与作者 Vesna-Strivozha-cn 协作产出，源文件头部带同一句声明；**PolyForm Noncommercial 1.0.0** 许可——自用、学习、改、分享都行，公网发布也允许，但**商业用途要另外授权**；按现状提供、不附担保。
> This plugin's code was produced in a **DeepSeek Harness（DSH）** session by an AI assistant working with the author; the same notice sits at the top of the source files.

## 安装

```bash
dsh plugin add github:Vesna-Strivozha-cn/dsh-bili-account-bridge
```

纯 JS、没有构建步骤、没有安装期脚本。被桥接的两个插件是可选的：只装一个也能跑（只是没有另一侧可对齐、可抢单）。

## 它管四件事

| # | 问题 | 机制 | 落在哪 |
|---|---|---|---|
| 1 | 两边各扫各的码，登录态互相顶替 | 账号对齐 | `account.json` |
| 2 | 什么消息都往会话里灌，回一堆废话 | 判定词库打分（回复判定） | `gate-lexicon.json` |
| 3 | 同一条消息两个插件都想回 | 互斥抢单 | `bili-reply-claims.json` |
| 4 | 某一侧该静默时还在动 | 插件闸门 + 文本分流 | `config.json` |

---

## 一、账号对齐（不再互相顶替）

两个插件各读各的凭据文件：

| 插件 | 文件 | 字段 |
|---|---|---|
| 养鱼 | `%USERPROFILE%\.bili-ai\credentials.json` | sessdata / bili_jct / buvid3 |
| 大肥鱼 | `$DSH_HOME/bili-duty/bili_credential.json` | sessdata / bili_jct / buvid3 / dedeuserid |

两份文件互不通气。一边重新扫码 → 另一边那份就成了失效 cookie → 它下次启动自己再扫 → 登录态在两套 cookie（甚至两个账号）之间来回横跳，看上去就是"账号被顶替"。

桥的做法：

1. `fs.watch` 盯住两个文件，外加 10 秒兜底轮询；
2. 有变化就验一次 `/x/web-interface/nav`（只读，同一份 cookie 5 分钟内复用结果）；
3. **同一个 uid** 的两套 cookie → 以文件较新的那份为准，原子覆盖另一边（覆盖前备份到 `history/`）；
4. **不同 uid** → 一个字节都不写，写 `conflict.json`，等主人决定（`bili_bridge_adopt`）。

只认本机账本（`$DSH_HOME/bili-duty/account-binding.json` 的 `activeUid`，或桥自己的 `account.json`）里绑定的那个 uid，绝不静默换号。

---

## 二、插件闸门（谁能动）

设置 → **B站桥 → 插件闸门**，总开关 + 两侧各两个开关：

| 开关 | 含义 |
|---|---|
| 行为处理 | 允许该插件执行动作（评论、私信、分享等） |
| 正常回复 | 允许该插件做日常自动回复 |

关掉「行为处理」只挡动作，日常回复照旧；两个都关 = 这一侧静默。
总开关关掉时桥只做账号对齐，不再对任何消息做事（闸门只报告，不产生副作用）。

这一页和下一节的词库是**连着的**：词库判出这句话属于哪一侧，就看那一侧的开关——「行为处理」关掉，那一侧即使被判成指令也不会进会话；「正常回复」关掉，日常口吻也不回。总开关关掉时只报告、不拦。

---

## 三、判定词库（这句话要不要回）

这是「这句话归谁」的判据：**收到的文本先在插件内部截出来打分，分数只决定归属，不决定拦不拦**——偏养鱼的走养鱼，其余全部走大肥鱼；拦不拦只看那一侧的闸门。

- 文件：`$DSH_HOME/gate-lexicon.json`，养鱼与大肥鱼共用同一份，改一次两边生效。
- 默认 **7 个词**，全归养鱼：下一个、安装、关闭、整一个、立刻进行、跑一次、下载（权重 1、阈值 0.5）。这就是 2026-11-14 主人在面板里定下的那一份；线上文件 `gate-lexicon.json` 不被覆盖，只在文件缺失时用这份种子。不够用就在面板里加，别指望种子覆盖所有说法。
- 结构：

```json
{ "version": 2, "threshold": 0.5, "entries": [ { "id": "d1", "word": "安装", "side": "whale", "weight": 1 } ] }
```

- **词至少两个字**（2026-11-14 定）：单字太容易误判——「发」「给」「看」在「我发了个视频」里也会命中。不足两字的词读入时直接丢弃，面板加词也会拦下来。
- **side 预设**：明显指令口气的词归 `whale`（养鱼：安装 / 关闭 / 下一个 / 跑一次…）；其余口吻才归 `dafeiyu`（大肥鱼：看看 / 说说 / 在吗）。`both`（两边）仍可选，但基础词库不用。默认这 7 个全是 `whale`。
- 打分：命中的词按**最长匹配**去重叠（「安装这个插件」里的「安装」只算一次）→ 分数 = `min(1, Σweight)` → `≥ threshold` 判给养鱼；其余一律归大肥鱼。没有第三档，也没有「谁都不回」。
- 守卫：动词后紧跟「了 / 着 / 过」不计分；整句是叙述（"今天看了个视频"）且没有满分词命中时清零；纯社交（在吗 / 早安 / 晚安）不计分。
- 面板只暴露 **词**、**side**、**阈值** 三样：加一个词就是按 1 计分，不让主人填数字。`weight` 仍在数据里：指令词 1，日常词 0.4（两个才够线），寒暄词 0（只列出、不计分）。
- **和闸门联动**：分数 → 归 `whale` 或 `dafeiyu` → 查那一侧的 `action` / `reply` 开关 → 开着才放行，关着就拦下（理由 `gate-closed:whale.action` 这种）。两个插件里的 `gateIncoming` 与桥的 `/api/route` 用的是同一套结论，不会一个放一个拦。
- 词库只分归属：它不决定回不回，只决定这句话更像谁的口吻。要不要动，是闸门的事。
- **公开评论是例外**：`not-owner` 与 `other-side` 只作用于私信与主人会话；视频评论、楼中楼、回复通知只看那一侧的「正常回复」闸门，不按归属拦人。
- 面板：设置页与独立主页里都有「判定词库」一块，可增删词、改 side、改阈值、试判一句。
- 结果会记一行到 `$DSH_HOME/whale-gate.jsonl`（`allow` / `reason` / `score` / 原文截断），排查时直接看这个文件。

试判示例（词库为默认种子）：

| 文本 | 得分 | 结果 |
|---|---|---|
| 测试文本，今日天气如何 | 0 | 走大肥鱼 |
| 在吗 / 今天天气不错 / 😂😂😂 | 0 | 走大肥鱼 |
| 安装这个插件 | 1 | 放行（养鱼·行为处理） |
| 下一个 / 关闭那个窗口 | 1 | 放行 |
| 立刻进行同步 | 1 | 放行 |
| 跑一次大肥鱼插件 | 1 | 放行 |
| 下载好了吗 | 1（含「下载」） | 放行（养鱼） |
| 看看说说 | 0 | 走大肥鱼（默认词库里没有这三个词；面板里加了才计分） |
| 养成鱼闸门关掉后再发「安装这个插件」 | 1 但闸门关 | 拦下，理由 `gate-closed:whale.action` |

覆盖范围：养鱼（私信 + 评论监听）、大肥鱼（私信自动回复、主人私信 Agent）。**公开评论**（视频下的评论、楼中楼、回复通知）不按归属硬拦：词库只给倾向，评论区本来就是回陌生人的地方，这里只查大肥鱼这一侧的「正常回复」闸门；两边都想回同一条时按 rpid 抢单，谁先抢到谁回。

（2026-11-15 修：此前公开评论也走同一道拦截，非主人评论被判 `not-owner`、带养鱼动词的被判 `other-side`，大肥鱼的正常评论回复被整片卡住。）

### 两块插件各自的闸门（判定对照）

| 场景 | 养鱼（dsh-bili-whale） | 大肥鱼（dsh-dafeiyu-life） |
|---|---|---|
| 私信 | `gateIncoming`：not-owner → 词库归属 → `gates.whale.action` | `gateIncoming`：not-owner → 词库归属 → `gates.dafeiyu.reply` |
| 主人评论 / 回复通知 | 同一套 `gateIncoming`（`listen.ownerOnly` 只盯主人） | 公开评论专用闸：只看 `gates.dafeiyu.reply` + 分流规则，不按「是不是主人」「判给谁」拦 |
| 观众评论 | 不在监听范围（ownerOnly），轮不到闸门 | 照常回；只有闸门关才 `gate-closed:dafeiyu.reply` |
| 判给对面那一侧 | 让路：`other-side:<side>` | 只有**命中分流规则且 target 不是大肥鱼**才让路：`routed:whale`；其余照常，谁先抢到谁回 |
| 同一条两边都想回 | `claim()` 按 rpid 抢单 | 同左 |

对照结论（2026-11-15）：

- 养鱼的 `not-owner` 是**监听范围**（只服务主人），不是词库硬拦，和「词库只给倾向」不冲突；
- 大肥鱼的公开评论不套 `not-owner` / `other-side`——评论区本来就是回陌生人的地方，套上去会把正常观众全挡掉（就是这次的故障）；
- 分流规则是主人显式指定的走向，对两侧都生效：规则指名养鱼时大肥鱼不抢，指名大肥鱼时养鱼让路。

---

## 四、文本分流（这条消息给谁）

同一页的 **文本分流**。分流默认关闭；打开后按「前置文本条件」把消息分给养鱼或大肥鱼：

- 每条规则：启用 / 前缀 / 包含 / 交给谁（养鱼、大肥鱼）/ 模式（行为处理、正常回复、两者）/ 备注；
- 命中顺序 = 列表顺序，第一条命中的规则生效；前缀从头匹配，包含任意位置匹配；
- 大小写默认不敏感，可关；
- 没命中任何规则 → 交给词库判定（判给谁、分够不够），不是无条件回复；
- 规则命中但目标那一侧的闸门关着 → 拦下（blocked），并说明是哪一侧关的；
- 规则优先于词库：一句话同时符合规则和词库时，按规则指定的那一侧走，再受该侧闸门约束。

条件只认文本（前缀 / 包含），不做正则、不看图片。页面底部有「试一句」，输入一句话就能看到会分给谁、命中哪条规则。

---

## 五、两个插件不抢同一句

`$DSH_HOME/bili-reply-claims.json` 记「这条消息谁在处理」，10 分钟过期。判定分三层，任一层撞上都算被占：① 正文键 `kind:uid:sha1(归一文本)前12位`（去句首 @、全半角归一、去空白与标点、转小写）；② 来源键 `kind:uid:sha1(来源 id)前12位`（评论用 rpid——两个插件拿到的通知 id 不是一个命名空间，只能按来源 id 认）；③ 包含判定：同 kind、同 uid，归一后一方是另一方的子串且短的那段 ≥6 字。

三方都会先 `claim()`：养鱼（`whale`）、大肥鱼自动回复（`dafeiyu`）、大肥鱼主人私信 Agent（`dafeiyu-owner`）。先到先得，另一方看到 `held-by-other` 就整条跳过——不进会话、不发回复，只确认回执防止重投。

大肥鱼内部也分开了：主人私信固定交给「主人私信 Agent」，自动回复那一路直接跳过主人的私信，不会同一封各回一次。

这样同一条消息不会出现「两边都在回」或「一个回完另一个还在跑」的浪费。

---

## 界面：独立主页 + 设置页

- **独立主页**：左侧导航的「B站桥」（图标是两端一线）。点它切到顶层页面，不占会话，一屏从上到下：登录态现状 → 插件闸门 → 文本分流 → 判定词库。
- **设置页**：设置里的「B站桥」与主页同源同组件，只有一页，适合不离开会话时随手改。
- 两处读写同一份状态，改哪边都一样。

## 工具

| 工具 | 用途 |
|---|---|
| `bili_bridge_status` | 两侧各是谁、是否有效、有没有冲突（只读） |
| `bili_bridge_heal` | 立即对齐；`confirm:true` 才真的写 |
| `bili_bridge_adopt` | 冲突后定夺：把某个 uid 定为这台机器的账号并铺到另一侧（`confirm:true`） |
| `bili_bridge_config` | 读 / 改闸门与分流（不给 patch 即读） |
| `bili_bridge_route` | 只读预判：一段文本该交给谁、闸门是否放行 |
| `bili_gate_lexicon` | 读词库；给 `text` 试判；给 `lexicon` 整份替换 |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/dsh-bili-bridge/api/status` | 登录态体检 |
| POST | `/dsh-bili-bridge/api/heal` | 对齐两侧（带 confirm 才写） |
| POST | `/dsh-bili-bridge/api/adopt` | 冲突后换绑 |
| GET | `/dsh-bili-bridge/api/config` | 读配置 + 暂停状态 |
| POST | `/dsh-bili-bridge/api/config` | 写配置：`{paused?, patch?}` |
| POST | `/dsh-bili-bridge/api/route` | 只读预判：`{text}` → `{decision, allow, side, mode, reason, rule, gate, scores}` |
| GET | `/dsh-bili-bridge/api/lexicon` | 读判定词库 |
| POST | `/dsh-bili-bridge/api/lexicon` | 整份替换词库：`{lexicon}` |
| POST | `/dsh-bili-bridge/api/lexicon/test` | 只读试判：`{text, side}` → `{score, threshold, directive, hits, decision}` |

配置存放：`$DSH_HOME/bili-account-bridge/config.json`（原子写）。

## 数据文件

| 文件 | 内容 |
|---|---|
| `$DSH_HOME/bili-account-bridge/account.json` | 权威登录态（600 权限，只有当前用户可读写） |
| `$DSH_HOME/bili-account-bridge/events.jsonl` | 最近动作（镜像 / 冲突 / 暂停） |
| `$DSH_HOME/bili-account-bridge/conflict.json` | 当前未解决的冲突（解决后自动删除） |
| `$DSH_HOME/bili-account-bridge/history/` | 每次覆盖前的备份 |
| `$DSH_HOME/bili-account-bridge/config.json` | 闸门与分流配置 |
| `$DSH_HOME/bili-account-bridge/boot.log` | 启动/挂载诊断标记 |
| `$DSH_HOME/gate-lexicon.json` | 两个插件共用的判定词库 |
| `$DSH_HOME/whale-gate.jsonl` | 每次判断的记录（放行 / 拦下 / 理由 / 分数） |
| `$DSH_HOME/bili-reply-claims.json` | 抢单记录（谁在处理哪一句，10 分钟过期） |

## 为什么它没挂上（boot.log）

插件每次 `apply` 都会往 `$DSH_HOME/bili-account-bridge/boot.log` 追加一行标记：
`apply:enter` / `apply:routes <n>` / `apply:tools ok` / `tool:throw <name> :: <stack>` / `apply:throw :: <stack>`。

排查顺序：路由 404 但 `boot.log` 里有 `apply:routes 5` → 说明挂上了又被回收，看后面有没有 `tool:throw`；整个文件没有今天的行 → 宿主没装到这份代码（看 profile 的 bundles 与 node_modules 副本）。
已知坑：同一进程里插件被挂载两次时，第二次 `ctx.tools.register` 会因工具名重复抛错，把整条 fiber（含已注册的路由）一起带走——现在重复注册只记一行 `tool:throw` 并跳过，不再拖垮插件。

## 边界

- 只写本地凭据文件，不改账号身份、不上传任何 cookie。
- 唯一的外网请求是 `/x/web-interface/nav` 登录态校验（同一份 cookie 5 分钟内复用），不抓页面、不轮询内容接口。
- 覆盖前一定备份；不同 uid 一律不写，等主人定夺。
- 这是本地桌面工具，不对外提供网络服务，不涉及 ICP 备案；所有动作都在 B站 正常接口与频率范围内，不做高频请求、不绕过风控。

## 许可

本插件按 **PolyForm Noncommercial License 1.0.0** 发布（SPDX：`PolyForm-Noncommercial-1.0.0`），全文见仓库根目录的 [LICENSE](LICENSE)。

| 用途 | 允许？ |
|---|---|
| 自己装来用、学习、研究、改代码、给朋友用 | ✅ 随便 |
| 把改过的版本发到论坛 / 自己的仓 / 插件目录（非商业） | ✅ 可以，保留版权声明与许可文本 |
| 卖钱、付费代配置、企业内当作生产工具对外经营、拿它做带广告或订阅的产品 | ❌ 需要单独的商业授权 |
| 二次打包后闭源收费分发 | ❌ 不允许 |

商业授权联系作者：https://github.com/Vesna-Strivozha-cn 。

> 说明：这不是 OSI 认可的开源许可，属于「源码可见、非商业可用」（source-available）。代码照样公开、照样能改，只是不能拿去赚钱。
> 许可只约束代码的使用方式，不代表 B站 的接口授权；使用本插件时仍须遵守 B站 的用户协议与社区规则。
