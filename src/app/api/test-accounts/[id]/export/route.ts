import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getTestAccountSystem } from '@/lib/db';
import { toEnvironmentsJson } from '@/lib/test-accounts-export';
import type { ErrorResponse } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/test-accounts/[id]/export
// 把系统配置写入 {project_root}/AI_LabTest/environments.json（并确保 .auth/ 目录存在）。
// 登录态 storageState 文件由「获取登录态」流程在抓取时直接写入 .auth/，导出不重写它们。
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const system = getTestAccountSystem(id);
    if (!system) {
      return NextResponse.json<ErrorResponse>({ error: 'System not found' }, { status: 404 });
    }

    const root = (system.project_root || '').trim();
    if (!root) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Project folder is required', code: 'PROJECT_ROOT_REQUIRED' },
        { status: 400 },
      );
    }
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Project folder does not exist', code: 'PROJECT_ROOT_NOT_FOUND' },
        { status: 400 },
      );
    }

    const labDir = path.join(root, 'AI_LabTest');
    fs.mkdirSync(path.join(labDir, '.auth'), { recursive: true });
    const filePath = path.join(labDir, 'environments.json');
    const json = JSON.stringify(toEnvironmentsJson(system), null, 2);
    fs.writeFileSync(filePath, json + '\n', 'utf-8');

    return NextResponse.json({ success: true, path: filePath });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 },
    );
  }
}
