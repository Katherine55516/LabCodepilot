/** Host tools a selftest needs beyond Node and Python. A missing tool is an
 * environment gap, not a product failure: the test says so and exits with 77
 * (the automake skip code), which run-quality-selftests.mjs records as skipped.
 * Production containers ship these tools, so CI never skips. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

export const SKIP_EXIT_CODE=77;
const MAC_SOFFICE='/Applications/LibreOffice.app/Contents/MacOS/soffice';

const runs=bin=>{try{const r=spawnSync(bin,['--version'],{encoding:'utf8',timeout:15000});return !r.error&&r.status===0;}catch{return false;}};

/** Where `soffice` runs from, or null. A macOS app install is put on PATH so
 * the production Python script's bare `soffice` resolves as it does in docker. */
export function locateSoffice(){
  if(runs('soffice'))return 'soffice';
  if(fs.existsSync(MAC_SOFFICE)&&runs(MAC_SOFFICE)){process.env.PATH=path.dirname(MAC_SOFFICE)+path.delimiter+(process.env.PATH||'');return MAC_SOFFICE;}
  return null;
}

/** Local inputs a selftest reads but the repository does not ship (for example
 * user-provided templates). Missing ones skip like a missing tool; set
 * PPT_REQUIRE_INPUTS=1 to fail instead. */
export function requireInputs(testName,...files){
  const missing=files.filter(file=>!fs.existsSync(file));
  if(!missing.length)return;
  if(process.env.PPT_REQUIRE_INPUTS==='1')throw new Error(testName+': required inputs are missing: '+missing.join(', '));
  console.log(`SKIP ${testName}: inputs missing (${missing.join(', ')})`);
  process.exit(SKIP_EXIT_CODE);
}

/** Call at the top of a selftest that needs LibreOffice itself: rendered-visibility
 * assertions, PDF rendering or document conversion. Publishing alone does not:
 * without soffice the export verifier records rendered visibility as unavailable. */
export function requireSoffice(testName){
  const found=locateSoffice();
  if(found)return found;
  if(process.env.PPT_REQUIRE_SOFFICE==='1')throw new Error(testName+': soffice (LibreOffice) is required but unavailable');
  console.log(`SKIP ${testName}: soffice unavailable (install LibreOffice, or set PPT_REQUIRE_SOFFICE=1 to fail instead)`);
  process.exit(SKIP_EXIT_CODE);
}
