import { NextRequest, NextResponse } from 'next/server';
import { getAllProviders, createProvider, getSetting } from '@/lib/db';
import { getEffectiveProviderProtocol, isValidProtocol } from '@/lib/provider-catalog';
import { parseManagedMultiplier } from '@/lib/model-multiplier';
import { compatibleBaseUrl } from '@/lib/openai-compatible-api';
import type { ProviderResponse, ErrorResponse, CreateProviderRequest, ApiProvider } from '@/types';

function maskApiKey(provider: ApiProvider): ApiProvider {
  let maskedKey = provider.api_key;
  if (maskedKey && maskedKey.length > 8) {
    maskedKey = '***' + maskedKey.slice(-8);
  }
  return { ...provider, api_key: maskedKey };
}

/**
 * Lift the managed model's cost multiplier out of `managed_extra_json` into a
 * typed top-level field.
 *
 * The multiplier only exists inside the raw ModelConfig dump (the account
 * backend added `model_multiplier` after the client's typed columns were
 * settled). Extracting it here keeps the model pickers off that JSON blob
 * entirely — it also carries the provider's plaintext auth_token, so parsing
 * it in the renderer would spread a secret across UI components for the sake
 * of one number. Local / BYOK rows have no multiplier and stay undefined.
 */
function withMultiplier(provider: ApiProvider): ApiProvider {
  const multiplier = parseManagedMultiplier(provider.managed_extra_json);
  return multiplier === null ? provider : { ...provider, model_multiplier: multiplier };
}

/**
 * Drop `managed_extra_json` from the response.
 *
 * getAllProviders() decrypts it (it is a sealed column), and the raw
 * ModelConfig it holds includes the model's plaintext `auth_token` — so
 * shipping it here handed out a full API key next to an `api_key` field we
 * deliberately mask. Nothing consumes the blob over HTTP: the multiplier, its
 * only reader, is lifted to a top-level field by withMultiplier() just above,
 * and the sync path writes this column through the DB layer, never through
 * this route. Must run after withMultiplier(), which reads it.
 */
function stripManagedExtra(provider: ApiProvider): ApiProvider {
  if (provider.managed_extra_json === undefined) return provider;
  const { managed_extra_json: _sealed, ...rest } = provider;
  return rest;
}

/** Check which ANTHROPIC_* env vars are set in the server process environment */
function detectEnvVars(): Record<string, string> {
  const detected: Record<string, string> = {};
  const envKeys = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ];
  for (const key of envKeys) {
    const val = process.env[key];
    if (val) {
      // Mask secrets, show base_url in full
      if (key.includes('URL')) {
        detected[key] = val;
      } else if (val.length > 8) {
        detected[key] = '***' + val.slice(-8);
      } else {
        detected[key] = '***';
      }
    }
  }
  return detected;
}

export async function GET() {
  try {
    const providers = getAllProviders().map(maskApiKey).map(withMultiplier).map(stripManagedExtra);
    const envDetected = detectEnvVars();
    return NextResponse.json({
      providers,
      env_detected: envDetected,
      default_provider_id: getSetting('default_provider_id') || '',
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get providers' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateProviderRequest = await request.json();

    if (!body.name) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    // Reject raw protocol strings we don't recognize — otherwise a stray
    // 'random-garbage' protocol would survive in the DB, bypass the legacy
    // inference path in resolver/models, and mis-route capability metadata.
    // Undefined/empty is fine: getEffectiveProviderProtocol() will infer
    // from provider_type below.
    if (body.protocol !== undefined && body.protocol !== '' && !isValidProtocol(body.protocol)) {
      return NextResponse.json<ErrorResponse>(
        {
          error: `Unknown protocol '${body.protocol}'. Supported protocols: ${[...[...new Set([
            'anthropic', 'openai-compatible', 'openrouter', 'bedrock', 'vertex', 'google', 'gemini-image', 'openai-image',
          ])]].join(', ')}.`,
          code: 'INVALID_PROTOCOL',
        },
        { status: 400 }
      );
    }

    // Anthropic-protocol providers must declare a base URL. Empty base_url
    // has an ambiguous meaning (legacy "Default" providers migrated from
    // older settings vs third-party presets that forgot to fill the URL),
    // and the latter would silently get promoted to first-party catalog +
    // routed to api.anthropic.com by the native SDK. Require explicit URL
    // on the write path so third-party configurations don't leak there.
    // Users wanting official Anthropic must pass 'https://api.anthropic.com'.
    //
    // Use effective protocol (raw → inferred) because body.protocol is
    // optional; older clients or raw-API callers can post
    // { provider_type: 'anthropic', base_url: '' } without protocol and
    // still land in the same ambiguous state.
    const effectiveProtocol = getEffectiveProviderProtocol(
      body.provider_type ?? '',
      body.protocol,
      body.base_url ?? '',
    );
    if (effectiveProtocol === 'openai-compatible') {
      try { body.base_url = compatibleBaseUrl(body.base_url || ''); }
      catch { return NextResponse.json({ error: 'A valid OpenAI-compatible Base URL is required' }, { status: 400 }); }
    }

    if (effectiveProtocol === 'anthropic' && !body.base_url?.trim()) {
      return NextResponse.json<ErrorResponse>(
        {
          error: 'Anthropic-protocol providers must specify a base URL (use https://api.anthropic.com for the official API, or your third-party endpoint)',
          code: 'ANTHROPIC_BASE_URL_REQUIRED',
        },
        { status: 400 }
      );
    }

    // Third-party media providers (openai-image, gemini-image) have the same
    // ambiguity: the official preset fills baseUrl client-side, but the
    // third-party preset ships empty and relies on the user to type a URL.
    // If that field is left blank, provider-resolver falls back to the
    // official endpoint — so a "third-party" row silently generates against
    // api.openai.com / generativelanguage.googleapis.com. Mirror the
    // Anthropic guard so the wrong service can't be saved.
    if (
      (effectiveProtocol === 'openai-image' || effectiveProtocol === 'gemini-image')
      && !body.base_url?.trim()
    ) {
      return NextResponse.json<ErrorResponse>(
        {
          error: effectiveProtocol === 'openai-image'
            ? 'OpenAI Image providers must specify a base URL (use https://api.openai.com/v1 for the official API, or your third-party endpoint)'
            : 'Gemini Image providers must specify a base URL (use https://generativelanguage.googleapis.com/v1beta for the official API, or your third-party endpoint)',
          code: 'MEDIA_BASE_URL_REQUIRED',
        },
        { status: 400 }
      );
    }

    const provider = createProvider(body);
    return NextResponse.json<ProviderResponse>(
      { provider: maskApiKey(provider) },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to create provider' },
      { status: 500 }
    );
  }
}
