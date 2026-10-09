/** Verify the worker protocol before sending input to a remote PPT project. */
export async function requirePptByokCapabilities(fetcher: typeof fetch = fetch) {
  const response = await fetcher('/api/ppt/capabilities', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (response.status === 401) throw new Error('请先登录并获取 PPT 沙箱配置。');
  if (!response.ok) throw new Error('PPT 服务尚未支持本地 API 模型，请先部署配套接口。');
  const data = await response.json().catch(() => null);
  const byok = data?.byok;
  const numericLimits = [byok?.maxPromptBytes, byok?.maxResultBytes, byok?.jobTimeoutMs, byok?.concurrency];
  if (byok?.protocolVersion !== 1 || byok.transport !== 'desktop-model-jobs'
      || byok.credentialLocation !== 'desktop' || byok.requiresOpenClient !== true
      || !numericLimits.every(value => Number.isSafeInteger(value))
      || byok.maxPromptBytes < 2000000 || byok.maxResultBytes < 4000000
      || byok.jobTimeoutMs < 300000 || byok.concurrency < 3) {
    throw new Error('PPT 客户端与服务端的本地模型协议不兼容，请更新配套服务。');
  }
  return byok;
}
