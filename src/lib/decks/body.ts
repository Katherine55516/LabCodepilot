import { EngineError } from './engine';

/** Reads a raw request body, stopping as soon as it passes `max` bytes. */
export async function readBody(request: Request, max: number, tooLarge: string): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new EngineError(413, tooLarge, 'import_too_large');
  if (!request.body) throw new EngineError(400, 'Send the file as the request body.', 'import_empty');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new EngineError(413, tooLarge, 'import_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
