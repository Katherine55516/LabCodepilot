# 定时任务 transcript 黄金样本

**从生产沙箱服务器上取的真实运行原文,一个字节都没改。**

来源:`cowork-prod:/data/cowork-state/runs/<runId>.jsonl` —— 服务端跑
`claude -p --output-format stream-json --verbose` 的逐行输出。

| 文件 | 原 runId | 内容 |
|---|---|---|
| `success-with-tools.jsonl` | `run_1f9580e132029f7e2b912df4` | 8 行:init / thinking / Write / 结果 / Bash / 结果 / 收尾文字 / result。带工具调用与 tool_result 回喂。注意那条 thinking **文本是空的**(只有签名),按设计会被丢弃,所以重放出来是 5 个块不是 6 个 |
| `success-text-only.jsonl` | `run_d8bba124ba96b2df10cec4ca` | 13 行:init / 9 条 `thinking_tokens` 进度噪声 / thinking / text / result。无工具调用 |

## 为什么必须是真实样本

`routine-transcript.ts` 要处理的形状有三件事**只有实读才会知道**,照文档或直觉写必错:

1. 原文里**没有用户指令那一条** —— 首行直接是 `system/init`,`user` 行全是 tool_result 回喂;
2. 同一条 assistant 消息在流式下会**拆成多行**(`message.id` 相同);
3. `system/thinking_tokens` 这类进度噪声混在中间(样本二有 9 条)。

所以这两个文件是**输入契约的活标本**。测试挂了要先怀疑代码,不要改样本 —— 改了就等于
把契约改成自己想象的样子,而生产上服务端并不会跟着变。

## 已确认不含敏感内容

提交前扫过:无 API key、无 token、无 URL、无用户标识。里面的 UUID 是容器内 claude 的
session id 与消息 id,以及 thinking 块的签名 —— 都是一次性的、已随容器销毁。

## 缺一个失败样本

`is_error: true` 的真实样本还没有(生产上还没跑出过失败的定时任务)。相关测试用手工构造的
行,并**刻意复刻 G1 陷阱**:末行 `subtype: "success"` 但 `is_error: true` —— 生产实测过
401 全程失败的回合就长这样。真拿到失败样本后应替换成真实的。
