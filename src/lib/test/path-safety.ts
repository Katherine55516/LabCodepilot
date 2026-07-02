import path from 'path';

/**
 * Test-route path-segment guard.
 *
 * A client-supplied taskName / env flows into filesystem paths via artifactPaths
 * (e.g. AI_LabTest/report/{taskName}/{taskName}-{env}.run.json). Unlike a `file`
 * param we can basename-strip, these segments compose the directory itself, so a
 * traversal value (../, separators, absolute path, NUL) would let the path escape
 * the project root. Every test route that builds a path from these must reject
 * unsafe values up front.
 *
 * @returns true when `s` must NOT be trusted as a single path segment.
 */
export function isUnsafeSegment(s: string): boolean {
  return (
    !s ||
    s.includes('/') ||
    s.includes('\\') ||
    s.includes('..') ||
    s.includes('\0') ||
    path.isAbsolute(s)
  );
}
