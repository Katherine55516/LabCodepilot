import test from 'node:test';

// The editorial passes (selection, allocation, reduction, coverage and
// obligation-placement audits) were removed with the ledger outline path (R4/R5);
// the table projection repair prompts with it (2026-10-25, no production caller).

test('page reassessment remains a model advisory until explicit user adoption', async () => {
  const {execFileSync} = await import('node:child_process');
  execFileSync(process.execPath, ['apps/cowork-server/selftest-ppt-page-reassessment.mjs'], {cwd:process.cwd(),stdio:'pipe'});
});
