/**
 * Chinese descriptions for the vendored GSD (Get-Shit-Done) plugin commands,
 * keyed by command name (the frontmatter `name`, e.g. "gsd-resume-work").
 *
 * Applied in SlashCommandPopover when the app locale is 'zh'. External plugin
 * commands carry only an English `description` from their .md frontmatter and
 * have no i18n `descriptionKey`, so without this map they'd stay English under
 * a Chinese UI. Missing keys fall back to the English frontmatter description,
 * so new/updated GSD commands degrade gracefully (English) until translated.
 *
 * This is intentionally a standalone Record — NOT part of the TranslationKey
 * type system — so 67 third-party command strings don't pollute the main i18n
 * key union.
 *
 * Source of truth: vendor/gsd-bundle/commands/*.md frontmatter. When GSD is
 * re-vendored (npm run vendor:gsd) and command descriptions change, refresh
 * the entries here. Proper nouns (GSD / PLAN.md / UAT / PR / ADR / SPEC / MVP
 * / UI-SPEC.md etc.) are deliberately left untranslated.
 */
export const GSD_COMMAND_DESCRIPTIONS_ZH: Record<string, string> = {
  'gsd-add-tests': '根据 UAT 标准和实现，为已完成的阶段生成测试',
  'gsd-ai-integration-phase': '为涉及构建 AI 系统的阶段生成 AI-SPEC.md 设计契约',
  'gsd-audit-fix': '自主的「审计到修复」流水线——发现问题、分类、修复、测试、提交',
  'gsd-audit-milestone': '归档前对照原始目标审计里程碑的完成情况',
  'gsd-audit-uat': '跨阶段审计所有未完成的 UAT 与验证项',
  'gsd-autonomous': '自主运行所有剩余阶段——每个阶段依次「讨论→规划→执行」',
  'gsd-capture': '把想法、任务、笔记和灵感捕获并归入对应位置',
  'gsd-cleanup': '归档已完成里程碑累积下来的阶段目录',
  'gsd-code-review': '审查阶段内改动的源文件，检查 bug、安全问题和代码质量',
  'gsd-complete-milestone': '归档已完成的里程碑并为下一个版本做准备',
  'gsd-config': '配置 GSD——工作流开关、高级参数、集成与模型档案',
  'gsd-context': '代码库情报 | 映射 graphify 文档 经验沉淀',
  'gsd-debug': '系统化调试，跨上下文重置持久保留状态',
  'gsd-discuss-phase': '规划前通过自适应提问收集阶段上下文',
  'gsd-docs-update': '生成或更新项目文档，并对照代码库校验',
  'gsd-eval-review': '审计已执行 AI 阶段的评估覆盖度，产出 EVAL-REVIEW.md 修复计划',
  'gsd-execute-phase': '以波次并行方式执行阶段内的所有计划',
  'gsd-explore': '苏格拉底式构思与想法路由——在落地为计划前先想清楚',
  'gsd-extract-learnings': '从已完成阶段的产物中提炼决策、经验、模式与意外发现',
  'gsd-fast': '内联执行琐碎任务——不用子 agent，无规划开销',
  'gsd-forensics': '对失败的 GSD 工作流做事后调查——诊断哪里出了问题',
  'gsd-graphify': '在 .planning/graphs/ 中构建、查询和检视项目知识图谱',
  'gsd-health': '诊断 planning 目录健康状况，可选自动修复',
  'gsd-help': '显示可用的 GSD 命令和使用指南',
  'gsd-ideate': '探索式捕获 | explore sketch spike spec capture',
  'gsd-import': '导入外部计划，写入前先与项目决策做冲突检测',
  'gsd-inbox': '对照项目模板和贡献指南，分流审阅 GitHub issue 和 PR',
  'gsd-ingest-docs': '从仓库已有的 ADR、PRD、SPEC 和文档引导或合并出 .planning/ 配置',
  'gsd-manage': '配置工作区 | workstreams thread update ship inbox',
  'gsd-manager': '交互式指挥中心，在一个终端管理多个阶段',
  'gsd-map-codebase': '用并行 mapper agent 分析代码库，产出 .planning/codebase/ 文档',
  'gsd-milestone-summary': '从里程碑产物生成完整的项目总结，用于团队上手与回顾',
  'gsd-mvp-phase': '把阶段规划成纵向 MVP 切片——用户故事、SPIDR 拆分，再做 plan-phase',
  'gsd-new-milestone': '开启新里程碑周期——更新 PROJECT.md 并路由到需求',
  'gsd-new-project': '以深度上下文收集初始化新项目并生成 PROJECT.md',
  'gsd-pause-work': '在阶段中途暂停工作时创建上下文交接',
  'gsd-phase': '对 ROADMAP.md 中的阶段做增删改——添加、插入、移除或编辑',
  'gsd-plan-phase': '创建详细的阶段计划（PLAN.md），带验证循环',
  'gsd-plan-review-convergence': '跨 AI 计划收敛循环——根据评审反馈反复重规划，直到无 HIGH 级隐患',
  'gsd-pr-branch': '过滤掉 .planning/ 提交，创建干净的 PR 分支，可直接代码评审',
  'gsd-profile-user': '生成开发者行为画像，并创建 Claude 可发现的产物',
  'gsd-progress': '检查进度、推进工作流或派发自由意图——统一的 GSD 态势命令',
  'gsd-project': '项目生命周期 | milestones audits summary',
  'gsd-quality': '质量门禁 | code review debug audit security eval ui',
  'gsd-quick': '以 GSD 保障执行快速任务（原子提交、状态跟踪），跳过可选 agent',
  'gsd-resume-work': '从上次会话恢复工作，完整还原上下文',
  'gsd-review-backlog': '审阅并把 backlog 项提升到当前里程碑',
  'gsd-review': '向外部 AI CLI 发起对阶段计划的跨 AI 同行评审',
  'gsd-secure-phase': '回溯性地验证已完成阶段的威胁缓解措施',
  'gsd-settings': '配置 GSD 工作流开关和模型档案',
  'gsd-ship': '创建 PR、运行评审，并在验证通过后准备合并',
  'gsd-sketch': '用一次性 HTML 原型勾勒 UI/设计想法，或提议下一步勾勒什么（frontier 模式）',
  'gsd-spec-phase': '用歧义评分厘清阶段交付什么——在 discuss-phase 前产出 SPEC.md',
  'gsd-spike': '通过体验式探索对想法做 spike，或提议下一步 spike 什么（frontier 模式）',
  'gsd-stats': '展示项目统计——阶段、计划、需求、git 指标与时间线',
  'gsd-surface': '切换暴露哪些技能——应用档案、列出或停用某个集群，无需重装',
  'gsd-thread': '管理跨会话工作的持久上下文线程',
  'gsd-ui-phase': '为前端阶段生成 UI 设计契约（UI-SPEC.md）',
  'gsd-ui-review': '对已实现前端代码做回溯性的 6 维度视觉审计',
  'gsd-ultraplan-phase': '[BETA] 把 plan 阶段卸载到 Claude Code 的 ultraplan 云端，在浏览器评审后导回',
  'gsd-undo': '安全的 git 回滚。借助阶段清单回退阶段或计划提交，并做依赖检查',
  'gsd-update': '更新 GSD 到最新版本并展示更新日志',
  'gsd-validate-phase': '回溯性审计并补齐已完成阶段的 Nyquist 验证缺口',
  'gsd-verify-work': '通过对话式 UAT 验证已构建的功能',
  'gsd-workflow': '工作流 | discuss plan execute verify phase progress',
  'gsd-workspace': '管理 GSD 工作区——创建、列出或移除隔离的工作区环境',
  'gsd-workstreams': '管理并行工作流——列出、创建、切换、状态、进度、完成与恢复',
};
