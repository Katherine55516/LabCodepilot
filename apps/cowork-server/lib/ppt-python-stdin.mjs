// Linux caps each argv string at 128 KiB (MAX_ARG_STRLEN), on the host and in
// containers alike, and the embedded PPT scripts are near or past that size, so
// `python3 -c SCRIPT` fails with E2BIG there. Send the script on stdin instead:
// a fixed bootstrap reads a length-prefixed script, runs it as `-c` would (in
// __main__), and leaves the rest of stdin to the script as its usual input.
export const PYTHON_STDIN_ARGS = Object.freeze(['-c', "import sys;exec(compile(sys.stdin.buffer.read(int(sys.stdin.buffer.readline())),'<string>','exec'))"]);

export function pythonStdinInput(script, input = '') {
  const source = Buffer.from(String(script), 'utf8');
  const body = input == null ? Buffer.alloc(0) : typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return Buffer.concat([Buffer.from(`${source.length}\n`), source, body]);
}
