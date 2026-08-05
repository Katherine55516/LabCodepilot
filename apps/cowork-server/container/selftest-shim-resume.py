#!/usr/bin/env python3
"""
cowork-shim 的 --resume 兜底自测(纯逻辑,不需要 docker)。

    python3 apps/cowork-server/container/selftest-shim-resume.py

覆盖 rewrite_stale_resume 的全部分支:transcript 在则原样透传、不在则按 id 是否 UUID
分别换成 --session-id 或整段摘掉、--resume= 写法、裸 --resume(不带 id)不误伤、
--fork-session 随改写一起摘掉、无 --resume 的命令行零改动。

背景见 rewrite_stale_resume 的 docstring:线上约两成回合因为这条挂掉。
"""
import os
import sys
import tempfile
import importlib.util

DIR = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('cowork_shim', os.path.join(DIR, 'cowork-shim.py'))
shim = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shim)

LIVE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'   # 有 transcript
GONE = '5e79dc1a-243c-4b27-99d9-ce43012d8613'   # 无 transcript(线上真实那个)
BASE = ['--output-format', 'stream-json', '--verbose']

failed = []


def check(label, got, want):
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        print(f"      got  = {got}\n      want = {want}")
        failed.append(label)


def main():
    with tempfile.TemporaryDirectory() as home:
        # 造一个真实布局的 transcript:$HOME/.claude/projects/<slug>/<id>.jsonl
        proj = os.path.join(home, '.claude', 'projects', '-workspace')
        os.makedirs(proj)
        open(os.path.join(proj, LIVE + '.jsonl'), 'w').close()
        os.environ['HOME'] = home

        check('transcript 在 → 原样透传',
              shim.rewrite_stale_resume(['--resume', LIVE] + BASE),
              ['--resume', LIVE] + BASE)

        check('transcript 不在 → 换成 --session-id',
              shim.rewrite_stale_resume(['--resume', GONE] + BASE),
              ['--session-id', GONE] + BASE)

        check('--resume=<id> 写法同样处理',
              shim.rewrite_stale_resume([f'--resume={GONE}'] + BASE),
              ['--session-id', GONE] + BASE)

        check('非 UUID 的 id → 直接去掉 --resume(不塞给 --session-id)',
              shim.rewrite_stale_resume(['--resume', 'not-a-uuid'] + BASE),
              BASE)

        check('--fork-session 随改写一起摘掉',
              shim.rewrite_stale_resume(['--resume', GONE, '--fork-session'] + BASE),
              ['--session-id', GONE] + BASE)

        check('裸 --resume(无 id,交互选择器)不误伤',
              shim.rewrite_stale_resume(['--resume', '--verbose']),
              ['--resume', '--verbose'])

        check('没有 --resume → 零改动',
              shim.rewrite_stale_resume(BASE), BASE)

        # .claude 整个不存在(全新卷)也不能抛
        os.environ['HOME'] = os.path.join(home, 'nope')
        check('HOME 里还没有 .claude → 按"不存在"处理',
              shim.rewrite_stale_resume(['--resume', GONE]),
              ['--session-id', GONE])

    print(f"\n{'FAILED: ' + ', '.join(failed) if failed else 'ALL PASS'}")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
