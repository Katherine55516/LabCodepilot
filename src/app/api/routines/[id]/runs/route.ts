import { listRuns } from '@/lib/routines-client';
import { routineError } from '@/lib/routines-route-helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const runs = await listRuns(id, {
      since: url.searchParams.get('since') || undefined,
      limit: parseInt(url.searchParams.get('limit') || '0', 10) || undefined,
    });
    return Response.json({ runs });
  } catch (e) {
    return routineError(e);
  }
}
