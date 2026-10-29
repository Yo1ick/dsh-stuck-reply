# dsh-stuck-reply

**卡住会话飞书答复代理**——DSH 会话卡住（提问 / 审批 / 计划）时通过飞书通知你，你在飞书回复，答案自动喂回会话。

> 定位：**卡住才介入的急诊，不抢会话控制权**。dsh-lark 把会话问答搬进飞书；本插件不搬任何东西——只在会话卡住时用飞书叫醒你、把答复带回。

## 两件套形态（重要）

本插件只做**飞书中继**：消费意图文件 → 发通知 → 收回复 → 发回执 → 心跳互检。它**不检测卡住、不应用答案**，这两件事属于一个外挂看守（watch）：

1. **外挂 watch**（不在本仓）：检测会话卡住 + 状态机 + 通过 DSH Remote API 应用答案，并在 `stateRoot` 下写意图文件。
2. **本插件**：负责飞书通知、收回复、应用回执、心跳互检。

两者通过 `stateRoot` 下的意图文件协议 v1 通信（原子写、版本戳、id 幂等、消费后归档）。缺了 watch，插件能启动但不会收到任何通知——这是设计边界，不是 bug。

## 安装

```bash
dsh plugin add dsh-stuck-reply        # 或 npm/pnpm 本地路径
```

在 profile 的 `cordis.patch.yml` 里按 `config.example.yaml` 配置（必填 `stateRoot`，`larkCli` 缺省为 PATH 中的 `lark-cli`）：

```yaml
- insert:
    - id: dsh-stuck-reply
      name: 'dsh-stuck-reply'
      config:
        stateRoot: '/path/to/dsh-stuck/state'
        larkCli: 'lark-cli'
```

独立运行（不装进 DSH）也可以用 `standalone.mjs`：

```bash
node standalone.mjs --state-root /path/to/dsh-stuck/state --lark-cli /opt/homebrew/bin/lark-cli
```

启动时校验：`stateRoot` 为空、或 `larkCli` 是绝对路径但文件不存在 → 直接报错退出，不静默变哑巴。

## 飞书用法

卡住时收到通知（带 `#N` 编号，多条并存可指定）：

```
🔔 DSH 会话等你选择（本条编号 #1）
会话：<标题>
问题：今晚想吃什么？
1. 火锅
2. 烧烤
直接回复序号（如 1）选择；回复自定义文字作答案；回「取消」放弃。
```

回复规则：`1`（选项序号）/ `#1 2`（指定条目）/ 任意文字（自定义答案）/ `批准`·`拒绝`（审批）/ `取消`。

## 安全

- 飞书凭据全程在 lark-cli 自身认证里，**不进包、不进 git**。
- 插件不注册任何工具/事件/subagent，不碰会话 seam；只做文件轮询 + lark-cli 出站调用。
- 意图文件协议 v1（原子写、版本校验、id 幂等、done/ 归档）。
