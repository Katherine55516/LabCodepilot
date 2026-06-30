import { NextRequest, NextResponse } from 'next/server';
import { getAllTestAccountSystems, createTestAccountSystem } from '@/lib/db';
import type { ErrorResponse, CreateTestAccountSystemRequest } from '@/types';

// Test Accounts (测试账号设置) — 多系统测试账号配置 CRUD。
// 凭据明文存本地库、明文回传给本地渲染端（UI 需可编辑），不做掩码。
// 契约见 docs/exec-plans/active/test-account-settings.md。

export async function GET() {
  try {
    return NextResponse.json({ systems: getAllTestAccountSystems() });
  } catch (error) {
    // 打日志：之前 catch 只回 500 JSON、不记录，导致 Windows 上 test-accounts 失败时
    // main.log 完全查不到痕迹(用户「点了没反应」却无从定位)。
    console.error('[test-accounts:GET]', error instanceof Error ? error.message : String(error));
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to list test account systems' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateTestAccountSystemRequest = await request.json();
    if (!body.name || !body.name.trim()) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing required field: name' },
        { status: 400 },
      );
    }
    const system = createTestAccountSystem(body);
    return NextResponse.json({ system }, { status: 201 });
  } catch (error) {
    console.error('[test-accounts:POST]', error instanceof Error ? error.message : String(error));
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to create test account system' },
      { status: 500 },
    );
  }
}
