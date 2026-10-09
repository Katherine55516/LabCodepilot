import { NextRequest, NextResponse } from 'next/server';
import { getProvider, getModelsForProvider, upsertProviderModel } from '@/lib/db';
import { discoverCompatibleModels } from '@/lib/openai-compatible-api';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const provider = getProvider(id);
  if (!provider || provider.source === 'managed' || provider.protocol !== 'openai-compatible') return NextResponse.json({ error: 'Local OpenAI-compatible provider required' }, { status: 400 });
  if (!provider.api_key) return NextResponse.json({ error: 'Save your API key first' }, { status: 400 });
  try {
    const models = await discoverCompatibleModels(provider.base_url, provider.api_key);
    // Upsert only: permission-limited or temporary catalogs must not erase manual IDs.
    models.forEach((model, index) => upsertProviderModel({ provider_id: id, model_id: model, display_name: model, upstream_model_id: model, capabilities_json: '{}', sort_order: index }));
    return NextResponse.json({ models: getModelsForProvider(id), discovered: models.length });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Model discovery failed' }, { status: 502 }); }
}
