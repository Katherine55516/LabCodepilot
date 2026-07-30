import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectSystemNameMap,
  getProjectSystemName,
} from '@/lib/test-project-display-name';
import type { TestAccountProjectSummary } from '@/types';

function system(
  name: string,
  projectRoot: string,
  id = `${name}-${projectRoot}`,
): TestAccountProjectSummary {
  return { id, name, project_root: projectRoot };
}

describe('测试工作台项目系统名称映射', () => {
  it('按归一化路径匹配，容忍尾斜杠', () => {
    const names = buildProjectSystemNameMap([
      system('论坛管理系统', '/Users/dev/forum-xc-sit/'),
    ]);
    assert.equal(getProjectSystemName(names, '/Users/dev/forum-xc-sit'), '论坛管理系统');
    assert.equal(getProjectSystemName(names, '/Users/dev/forum-xc-sit//'), '论坛管理系统');
  });

  it('空系统名与空绑定路径不进入映射，交给 UI 回退文件夹名', () => {
    const names = buildProjectSystemNameMap([
      system('   ', '/Users/dev/no-name'),
      system('未绑定系统', '   '),
    ]);
    assert.equal(getProjectSystemName(names, '/Users/dev/no-name'), null);
    assert.equal(names.size, 0);
  });

  it('同一路径重复绑定时保留排序后的首条，与现有 resolve 语义一致', () => {
    const names = buildProjectSystemNameMap([
      system('首条系统', '/Users/dev/site', 'first'),
      system('后续系统', '/Users/dev/site/', 'second'),
    ]);
    assert.equal(getProjectSystemName(names, '/Users/dev/site'), '首条系统');
  });

  it('未匹配项目返回 null', () => {
    const names = buildProjectSystemNameMap([
      system('订单系统', '/Users/dev/orders'),
    ]);
    assert.equal(getProjectSystemName(names, '/Users/dev/other'), null);
  });
});
