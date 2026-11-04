#!/bin/bash
# Cowork 真机零写入验收(E5)— fs_usage 系统调用级监控包装。
#
# 验收口径:一轮完整办公回合(上传附件 → agent 在 VM 内读改建 → 下载产物)
# 期间,本应用进程树对宿主"用户数据区"的写类系统调用应为 0。
# 豁免面(设计内写入,不算违规):
#   ~/.codepilot/            应用数据(DB / 办公暂存目录 / VM 镜像资产)
#   ~/Downloads/             用户主动下载落点
#   ~/Library/、/private/var|tmp、/dev  Electron/Chromium 运行缓存与系统噪声
#   .next/、node_modules     dev 编译产物(仅 dev 环境出现)
#
# 用法(需要 root,fs_usage 是内核级追踪):
#   sudo bash scripts/poc/cowork/fs-audit.sh [秒数,默认 180]
#   → 启动后在应用里完整跑一轮办公回合,等脚本自然结束(或 Ctrl-C)
#   → 输出目录里 violations.log 应为空;不为空则逐条归因
set -uo pipefail

DUR="${1:-180}"
OUT="/tmp/cowork-fs-audit-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

if [[ $EUID -ne 0 ]]; then
  echo "[fs-audit] fs_usage 需要 root:sudo bash $0 $DUR" >&2
  exit 1
fi

echo "[fs-audit] 开始记录 ${DUR}s 全量文件系统调用 → $OUT/full.log"
echo "[fs-audit] 请现在在应用里执行一轮完整办公回合(上传→改建→下载)…"
timeout "$DUR" fs_usage -w -f filesys > "$OUT/full.log" 2>/dev/null || true

# 写类操作(fs_usage 操作名列)
grep -E "[[:space:]](write|pwrite|WrData\[?A?\]?|WrMeta|creat|mkdir|rename|unlink|ftruncate)[[:space:]]" \
  "$OUT/full.log" > "$OUT/writes.log" || true

# 本应用进程树:打包版 next-server/Electron 进程名带 "AI Native Lab";
# dev 环境是 node;转发器经 ELECTRON_RUN_AS_NODE 也名列其中;VM 进程 vfkit。
grep -E "(AI Native Lab|next-server|vfkit|Electron|node)" "$OUT/writes.log" \
  > "$OUT/app-writes.log" || true

# 违规 = 用户数据区写入(剔除豁免面)
grep -Ev "/\.codepilot/|/Downloads/|/Library/|/private/var/|/private/tmp/|^/tmp/|/dev/|/\.next/|node_modules|/\.npm/|/\.claude|/\.nvm/" \
  "$OUT/app-writes.log" > "$OUT/violations.log" || true

echo
echo "[fs-audit] 写调用总数:      $(wc -l < "$OUT/writes.log" | tr -d ' ')"
echo "[fs-audit] 本应用进程写调用: $(wc -l < "$OUT/app-writes.log" | tr -d ' ')"
echo "[fs-audit] 疑似违规(应为 0):$(wc -l < "$OUT/violations.log" | tr -d ' ')"
echo
if [[ -s "$OUT/violations.log" ]]; then
  echo "[fs-audit] ⚠️ 违规明细(逐条归因,确认是否真是 agent 文件工具写入):"
  head -50 "$OUT/violations.log"
else
  echo "[fs-audit] ✅ 用户数据区零写入"
fi
echo "[fs-audit] 完整记录:$OUT"
