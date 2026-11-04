import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPptProxyPath } from '../../lib/ppt-proxy-path';
const id = 'a'.repeat(32);
test('PPT generation, local proposals, media retry and ordering pass the bounded proxy', () => {
  const paths = [ ['page-estimate'],['health'],['projects',id,'page-policy'],['projects',id,'media-exclusions'],['model-jobs',id,'progress'],['projects',id,'slides','slide_1','repair-comparison',id,'before'], ['templates','light','preview'], ['projects','order'], ['folders','order'],
    ...['generation-edit-scopes','generation-edits','ai-edit','proposals','asset-tasks','pause','resume'].map(p=>['projects',id,p]),
    ['projects',id,'generation-edits','intent_1','retry'], ['projects',id,'proposals','proposal_1','apply'],
    ['projects',id,'proposals','proposal_1','discard'], ['projects',id,'asset-tasks','asset_1','retry'],
    ...['revise','version','restore'].map(action=>['projects',id,'proposals','proposal_1',action]),
    ['projects',id,'slides','slide_1','accept'], ['projects',id,'slides','slide_1','regenerate'],
    ['projects',id,'events'], ['projects',id,'preview','slide_1.svg'], ['projects',id,'revisions','2','restore'] ];
  for (const path of paths) assert.equal(isPptProxyPath(path),true,path.join('/'));
});
test('PPT proxy rejects traversal, malformed IDs and unlisted operations', () => {
  for (const path of [[],['page-estimate','extra'],['health','extra'],['projects','bad','generation-edits'],['projects',id,'proposals','../secret','apply'],['projects',id,'proposals','p','delete'],['projects',id,'asset-tasks','asset_1','restore'],['projects',id,'generation-edits','intent_1','revise'],['projects',id,'proposals','p','version','after'],['projects',id,'slides','s','unknown'],['templates','../../secret'],['templates','light','unknown'],['folders','order','extra']])
    assert.equal(isPptProxyPath(path),false,path.join('/'));
});

test('PPT fonts allow only account-project manifest and immutable font SHA',()=>{
 assert.equal(isPptProxyPath(['projects','a'.repeat(32),'native-fonts']),true);
 assert.equal(isPptProxyPath(['projects','a'.repeat(32),'native-fonts','b'.repeat(64)+'.ttf']),true);
 assert.equal(isPptProxyPath(['projects','a'.repeat(32),'native-fonts','../../font.ttf']),false);
 assert.equal(isPptProxyPath(['projects','a'.repeat(32),'native-fonts','https:font.ttf']),false);
});

test('outline-first planning commands reach the backend through the proxy', () => {
 // The planner posts semantic/expand/save commands here; browser tests that
 // mock /api/** never exercise this allow-list.
 assert.equal(isPptProxyPath(['projects', id, 'planning']), true);
 assert.equal(isPptProxyPath(['projects', 'bad', 'planning']), false);
 assert.equal(isPptProxyPath(['projects', id, 'planning', 'extra']), false);
 // A requirement added while a card outline or generation is paused (found on 3143: 'Invalid PPT path').
 assert.equal(isPptProxyPath(['projects', id, 'requirements']), true);
 assert.equal(isPptProxyPath(['projects', 'bad', 'requirements']), false);
 // The editor's table/cards switch (T5; live mlq-r32: 'Invalid PPT path').
 assert.equal(isPptProxyPath(['projects', id, 'table-representation']), true);
 assert.equal(isPptProxyPath(['projects', id, 'table-representation', 'extra']), false);
});

test('review advisory decisions reach the backend only for a well-formed advisory ID', () => {
 // The editor's "Dismiss" posts here; browser tests that mock /api/** never exercise this allow-list.
 assert.equal(isPptProxyPath(['projects', id, 'review-advisories', 'adv_' + 'c'.repeat(20)]), true);
 for (const bad of ['adv_short', 'adv_' + 'C'.repeat(20), '../commands', 'adv_' + 'c'.repeat(21)])
  assert.equal(isPptProxyPath(['projects', id, 'review-advisories', bad]), false, bad);
 assert.equal(isPptProxyPath(['projects', id, 'review-advisories']), false);
 assert.equal(isPptProxyPath(['projects', id, 'review-advisories', 'adv_' + 'c'.repeat(20), 'extra']), false);
});
