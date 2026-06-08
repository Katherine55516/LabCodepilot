import { nanoid } from 'nanoid';
import type { FileAttachment } from '@/types';
import { isImageFile } from '@/types';

/**
 * Convert a data URL to a FileAttachment object.
 */
export async function dataUrlToFileAttachment(
  dataUrl: string,
  filename: string,
  mediaType: string,
): Promise<FileAttachment> {
  // data:image/png;base64,<data>  — extract the base64 part
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

  // Estimate raw size from base64 length
  const size = Math.ceil((base64.length * 3) / 4);

  return {
    id: nanoid(),
    name: filename,
    type: mediaType || 'application/octet-stream',
    size,
    data: base64,
  };
}

/**
 * Build the optimistic `<!--files:...-->` display marker embedded in a freshly
 * sent user message's content. MessageItem.parseMessageFiles parses it back
 * into FileAttachment[] for FileAttachmentDisplay.
 *
 * Image files KEEP their base64 `data` so the thumbnail renders immediately via
 * a data URI — FileAttachmentDisplay.fileUrl() is explicitly designed for this
 * "optimistic / in-memory" case. Previously only {id,name,type,size} was
 * embedded, so a just-sent image had neither `data` nor `filePath`, fell into
 * the "other files" bucket, and rendered as a filename-only FileCard until the
 * message was reloaded from the DB (which carries `filePath`). That reload-only
 * behavior is the bug this fixes.
 *
 * The base64 lives only in the client-side temp message — the chat API persists
 * its own `<!--files:...-->` variant (with `filePath`, no base64) and the
 * messages GET endpoint strips base64 on serve, so nothing here bloats the DB.
 *
 * Non-image files omit `data` — they render as cards regardless of URL, so
 * embedding their base64 would only bloat the in-memory message string.
 */
export function buildFilesDisplayContent(files: FileAttachment[], text: string): string {
  const fileMeta = files.map((f) =>
    isImageFile(f.type)
      ? { id: f.id, name: f.name, type: f.type, size: f.size, data: f.data }
      : { id: f.id, name: f.name, type: f.type, size: f.size },
  );
  return `<!--files:${JSON.stringify(fileMeta)}-->${text}`;
}
