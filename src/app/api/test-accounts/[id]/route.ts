import { NextRequest, NextResponse } from 'next/server';
import { getTestAccountSystem, updateTestAccountSystem, deleteTestAccountSystem } from '@/lib/db';
import type { ErrorResponse, UpdateTestAccountSystemRequest } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const system = getTestAccountSystem(id);
    if (!system) {
      return NextResponse.json<ErrorResponse>({ error: 'System not found' }, { status: 404 });
    }
    return NextResponse.json({ system });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get system' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body: UpdateTestAccountSystemRequest = await request.json();
    const updated = updateTestAccountSystem(id, body);
    if (!updated) {
      return NextResponse.json<ErrorResponse>({ error: 'System not found' }, { status: 404 });
    }
    return NextResponse.json({ system: updated });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to update system' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const deleted = deleteTestAccountSystem(id);
    if (!deleted) {
      return NextResponse.json<ErrorResponse>({ error: 'System not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to delete system' },
      { status: 500 },
    );
  }
}
