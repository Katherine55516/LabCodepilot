/**
 * strip-ansi.ts — remove ANSI escape sequences (terminal color / style / cursor
 * codes) from text so command output renders cleanly in HTML instead of showing
 * stray "□[90m" boxes. Pure, unit-testable.
 *
 * ESC/BEL are built with String.fromCharCode so the source contains no literal
 * control characters and does not depend on escape-sequence preservation in the
 * editor/tooling. The patterns only match real escape sequences, so literal
 * brackets in normal text (e.g. "- [x] task") are left untouched.
 */

const ESC = String.fromCharCode(27); // \x1b
const BEL = String.fromCharCode(7); // \x07

// CSI: ESC [ <params> <intermediates> <final> — SGR colors, cursor moves, erase
const CSI = new RegExp(ESC + '\\[[0-9;?]*[ -/]*[@-~]', 'g');
// OSC: ESC ] ... terminated by BEL or ESC \
const OSC = new RegExp(ESC + '\\][^' + BEL + ESC + ']*(?:' + BEL + '|' + ESC + '\\\\)', 'g');
// Other: ESC followed by a single command byte
const ESC_SEQ = new RegExp(ESC + '[@-Z\\\\-_]', 'g');

export function stripAnsi(text: string): string {
  if (!text) return text;
  return text.replace(CSI, '').replace(OSC, '').replace(ESC_SEQ, '');
}
