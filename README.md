# @smanx/dsh-fixed-providers

> 中文 | [English](README.en.md)

面向 DeepSeek Harness 的**托管提供商**插件：安装并重启后，会把配置文件里定义的提供商写入“设置 → 模型”的提供商列表。它们的 API 地址（URL）与 API 密钥（Key）由插件锁定，**用户无法编辑**；每个提供商下的**模型列表可以自行增删改**——但 `free-zen` 例外：它的模型目录由插件从上游动态拉取并锁定（见 [动态模型目录](#动态模型目录free-zen)）。

提供商配置放在 **JSON 文件**里，不再写死在代码中：

- 插件启动时读取**本地 JSON**（默认使用插件自带的 `providers.json`，可用 `$DSH_HOME/dsh-fixed-providers.json` 覆盖）；
- 同时会请求本地 JSON 里 `remoteUrl` 指向的**远端 JSON**；
- 把**两个 JSON 里的提供商合并**（按 route 去重，本地优先），再统一添加并锁定；
- 对 `free-zen` 这类动态提供商，再从**上游 `/models`** 拉取并筛选模型目录。

```
插件启动
  -> 读取本地 JSON（$DSH_HOME/dsh-fixed-providers.json，缺省回退到包内 providers.json）
  -> 请求 remoteUrl 指向的远端 JSON（失败则只用本地）
  -> 合并两个文件的 providers（同 route 本地覆盖远端）
  -> 对 free-zen 请求上游 /models，筛选出 -free 结尾的模型（失败则回退到配置里的 models）
  -> 把合并结果写入 llm-pi-ai 设置（URL / 密钥 / 协议固定）并写入固定密钥到凭证库
  -> 每次设置变更都重新断言固定字段（改 URL/密钥/删除都会被还原）
  -> free-zen 的模型目录同样每次重新断言（手动增删会被还原）
  -> 客户端锁定这些提供商的 URL/密钥/名称输入框，以及 free-zen 的模型编辑（名单由宿主提供，不含密钥）
  -> 其余提供商的模型列表保持可编辑
```

> 内置提供商使用**独立的 route ID**，与你自行配置的提供商**互不冲突、可以同时显示**，互不影响。

## 配置文件

### 位置（按优先级）

1. `$DSH_HOME/dsh-fixed-providers.json` —— 用户覆盖配置（推荐；`$DSH_HOME` 默认是 `~/.dsh`，即 `C:\Users\cc\.dsh`）
2. 插件包内的 `providers.json` —— 随插件分发的默认配置

### 格式

```json
{
  "remoteUrl": "https://example.com/providers.json",
  "providers": [
    {
      "route": "my-fixed-provider",
      "displayName": "My Fixed Provider",
      "apiKeyEnv": "MY_FIXED_PROVIDER_API_KEY",
      "api": "openai-completions",
      "baseURL": "https://api.example.com/v1",
      "key": "your-fixed-key",
      "models": [
        { "id": "my-model", "contextWindow": 1000000, "maxTokens": 200000 },
        { "id": "my-vision-model", "contextWindow": 256000, "maxTokens": 330000, "input": ["text", "image"] }
      ]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `remoteUrl` | 否 | 远端 JSON 的地址；填了就会在启动时拉取并合并 |
| `providers[].route` | 是 | 路由 ID：小写字母开头，可含小写字母/数字/连字符；在同一份文件里必须唯一 |
| `providers[].displayName` | 是 | 提供商在模型列表里显示的名字（建议全局唯一） |
| `providers[].baseURL` | 是 | API 地址（锁定的字段） |
| `providers[].api` | 否 | 协议，默认 `openai-completions` |
| `providers[].apiKeyEnv` | 否 | 密钥引用名，默认按 route 推导（如 `my-provider` → `MY_PROVIDER_API_KEY`） |
| `providers[].key` | 否 | 固定的密钥值；有则插件写入/恢复该凭证，没有则由环境提供 |
| `providers[].models` | 否 | 默认模型列表（仅首次创建该提供商时写入；之后你在界面里改） |

### 合并规则

- 两个文件都按 `providers` 数组给出；先收集远端，再用本地**按 route 覆盖**（同 route 本地胜出）。
- 本地文件里的非法条目会**报错**（配置 bug 应当响亮）；远端文件里的非法条目会被**跳过并告警**，不会拖垮插件。
- 远端拉取失败（网络/超时/非 200）只告警，继续使用本地结果。

### 动态模型目录（free-zen）

`free-zen` 的 `models` **不再直接使用**，而是作为**兜底清单**。插件在启动时（以及每次设置变更后重新断言）会：

1. 请求上游 `{baseURL}/models`（即 `https://opencode.ai/zen/v1/models`），带 `Authorization: Bearer <key>`；
2. 从 OpenAI 格式的 `{ data: [{ id }] }` 里取出全部模型 ID；
3. **只保留以 `-free` 结尾的模型**，作为该提供商的模型目录；
4. 若拉取失败（网络/超时/非 200）或过滤后为空，则**回退**使用配置里的 `models`。

该目录是**完全托管**的：守护会在每次设置变更后把它改回上游结果，界面上的模型编辑框、增删模型按钮与“获取可用模型/恢复默认模型”也会被锁定，避免手动改动被无声还原。

> 这套规则目前**只对 `free-zen` 这一个 route 生效**（在 `src/config.ts` 的 `UPSTREAM_MODEL_CATALOG` 中按 route 声明）；其余提供商的 `models` 仍由你手动维护。

## 工作原理

插件不注册自己的 LLM 适配器，而是把托管提供商写在自带的 `llm-pi-ai` 设置段里，由 pi-ai 适配器服务：

- **加载**：启动时按上述流程读取本地 + 远端 JSON 并合并，再解析动态提供商的模型目录，得到托管提供商集合。
- **种子（seed）**：确认 `llm-pi-ai.providers.<route>` 存在，`displayName`、`apiKeyEnv`、`api`、`baseURL` 与配置一致（缺失就创建，被改就改回）；把带 `key` 的提供商的固定密钥写入凭证库。
- **守护（guard）**：监听 `settings/document-updated`（`llm-pi-ai` 命名空间），每次变更后重新读取该命名空间并断言受保护字段——改 URL、改密钥引用、删除整个提供商都会在写入后立即被还原。静态提供商的 `models` 一律不碰；动态提供商（free-zen）的 `models` 会一并还原为上游结果。监听 `credentials/reference-updated`，密钥被覆盖或删除时恢复固定值。守护**只作用于托管 route**，你自行配置的其他提供商完全不受影响。
- **客户端锁定**：宿主在 `/dsh-fixed-providers/managed.json` 提供**客户端安全名单**（只有 route、显示名与“模型是否锁定”标志，**不含任何密钥**）；浏览器端据此把这些行的“API 密钥 / API 地址 / 显示名称 / API 协议”输入框置为禁用，并隐藏删除按钮与“Custom”标签；对动态提供商还会禁用模型编辑框并隐藏增删模型 / 获取模型 / 恢复默认按钮。

所以即使绕过 UI 直接改 `settings.yaml` 或 `credentials.yaml`，受保护字段也会在下一次设置变更（或重启）时被还原。

## 安装

**方式一：在线安装（Git 仓库）**

```sh
dsh plugin --profile web add github:smanx/dsh-fixed-providers#master
```

**方式二：从源码目录安装（本地开发）**

```sh
dsh plugin --profile web add file:C:/mydata/codes/dsh-fixed-providers
```

安装完成后**重启一次 Web 服务器**，让新的宿主插件与客户端 bundle 编入启动清单，然后刷新页面。

> 前提：profile 里已包含 `@deepseek-ai/dsh-llm-pi-ai`（`dsh-web-app` 自带）。没有 `settings` / `credentials` 服务的环境（如纯 headless）插件会自动休眠。

> 兼容性：插件按 `@deepseek-ai/dsh@0.1.7-rc.2` 起的设置/凭证接缝编写——设置读取走 `settings.describe()`，变更事件为 `settings/document-updated` 与 `credentials/reference-updated`。更早的 harness 版本暴露的是已被移除的 `settings.get()` / `settings/updated` / `credentials/updated`，不再支持。

## 依赖与边界

| 方面 | 影响 |
| --- | --- |
| Token 消耗 | 无——插件不注入任何提示词或工具。 |
| 模型调用 | 走 `llm-pi-ai` 适配器，与手动配置这些提供商完全一致。 |
| 会话日志 | 无影响。 |
| 权限 | 只写 `llm-pi-ai` 设置段中**托管 route** 与固定密钥引用；不触碰你自行配置的提供商与 `agent-default-model` 等其余设置。 |
| 网络 | 启动时向 `remoteUrl` 发起一次 GET（10 秒超时），并对每个动态提供商（free-zen）向上游 `/models` 发起一次 GET（同样 10 秒超时）；失败不影响本地配置。 |

## 开发

```sh
pnpm install
pnpm run check    # typecheck + vitest + 客户端 bundle 端到端检查 + build（lib/ 随源码提交）
pnpm run test     # vitest（config 合并 / guard 保护逻辑 / client DOM 锁定）
pnpm run test:bundle # 对构建产物 lib/client.js 的端到端检查（ModuleLoader 握手 + 真实 DOM）
pnpm run build    # esbuild 宿主 + 客户端 bundle，tsc 类型声明
```

## 修改配置

改配置**不需要重新构建**：编辑 `$DSH_HOME/dsh-fixed-providers.json`（或插件包内 `providers.json`），重启 Web 服务器即可生效；重启后守护会自动把旧值更新为新配置（静态提供商的模型列表保留不动；free-zen 每次都会重新从上游拉取）。

改代码（如默认配置、路径、超时）才需要 `pnpm run build` 后重装。

## 已知限制

- 客户端锁定基于 DOM（按显示名匹配行卡片）；若未来版本改动 Models 页结构，锁定可能需要跟进。
- 服务器端守护是事件驱动的：极快的连续两次写（如脚本直接连续改两次 URL）会在第二次写入后被还原为固定值——最终一致。
- 配置在**启动时**读取；运行时修改 JSON 需要重启服务器。远端 JSON 内容变化同理。
- `free-zen` 的模型目录在**启动时**拉取一次；上游新增/下架的模型要**重启服务器**才会反映。上游不可达或过滤后为空时，会回退到配置里的 `models` 兜底清单。
- `free-zen` 的模型编辑在界面上被锁定、服务端也会还原，因此**无法手动增删**它的模型；这是“完全托管”的预期行为。
- 同一 `apiKeyEnv` 若被多个提供商共用，插件以其中一个 `key` 为准（建议共用引用的提供商使用相同密钥）。
- “Custom”标签被隐藏，但目录条目本身仍由 pi-ai 标记为 declared；不影响任何功能。

## 许可证

MIT
