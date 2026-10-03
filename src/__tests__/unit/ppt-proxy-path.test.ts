import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPptProxyPath } from '../../lib/ppt-proxy-path';
const id = 'a'.repeat(32);
test('PPT generation, local proposals, media retry and ordering pass the bounded proxy', () => {
  const paths = [ ['page-estimate'], ['templates','light','preview'], ['projects','order'], ['folders','order'],
    ...['generation-edit-scopes','generation-edits','ai-edit','proposals','asset-tasks','pause','resume'].map(p=>['projects',id,p]),
    ['projects',id,'generation-edits','intent_1','retry'], ['projects',id,'proposals','proposal_1','apply'],
    ['projects',id,'proposals','proposal_1','discard'], ['projects',id,'asset-tasks','asset_1','retry'],
    ['projects',id,'slides','slide_1','accept'], ['projects',id,'slides','slide_1','regenerate'],
    ['projects',id,'events'], ['projects',id,'preview','slide_1.svg'], ['projects',id,'revisions','2','restore'] ];
  for (const path of paths) assert.equal(isPptProxyPath(path),true,path.join('/'));
});
test('PPT proxy rejects traversal, malformed IDs and unlisted operations', () => {
  for (const path of [[],['page-estimate','extra'],['projects','bad','generation-edits'],['projects',id,'proposals','../secret','apply'],['projects',id,'proposals','p','delete'],['projects',id,'slides','s','unknown'],['templates','../../secret'],['templates','light','unknown'],['folders','order','extra']])
    assert.equal(isPptProxyPath(path),false,path.join('/'));
});
