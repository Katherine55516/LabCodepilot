---
description: 生成《系统知识地图》SYSTEM_KNOWLEDGE_MAP.md（独立于 3 步流程的附加能力）
argument-hint: [可选：输出目录，默认项目根]
---

# /ai-lab-test:knowledge-map — 系统知识地图

> 这是 AI_LabTest 自带的一项**附加能力**，**不属于** 3 步测试流程，可独立使用。用于对当前项目做全方位深度解构，产出一份标准化的《系统知识地图》。

## 规则

严格遵循 `${CLAUDE_PLUGIN_ROOT}/rules/system_knowledge_map.md`（**先用 Read 工具读取该文件再执行**）。该文件定义了两阶段规范：第一阶段项目深度扫描（技术栈 / 架构拓扑 / 核心接口 / 数据模型），第二阶段输出 `SYSTEM_KNOWLEDGE_MAP.md`（含 Mermaid 架构图与 ER 图）。

## 行为红线

- **严禁凭空想象**：所有技术栈、接口、架构描述必须在代码库中有迹可循；未实现/闭源的部分明确标注「代码库中未发现相关实现」。
- **只读不改**：纯逆向分析与文档生成，**绝对禁止**修改任何业务源码与配置文件。

## 输出

`SYSTEM_KNOWLEDGE_MAP.md`（默认项目根目录；`$ARGUMENTS` 可指定其他输出目录）。

## 参数

$ARGUMENTS
