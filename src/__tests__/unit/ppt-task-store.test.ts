import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pptTaskStore} from '../../lib/ppt-task-store';
import type {PptProject} from '../../components/ppt/types';
const project=(id:string)=>({id,status:'completed',libraryEligible:true} as PptProject);
test('PPT library snapshots preserve a newer mutation against late polls and reject old-account responses',()=>{
 pptTaskStore.clear();assert.equal(pptTaskStore.isReady(),false);
 const oldPoll=pptTaskStore.beginRequest(),newRefresh=pptTaskStore.beginRequest();
 assert.equal(pptTaskStore.set([project('remaining')],newRefresh),true);assert.equal(pptTaskStore.isReady(),true);
 assert.equal(pptTaskStore.set([project('remaining'),project('deleted')],oldPoll),false);assert.deepEqual(pptTaskStore.getSnapshot().map(value=>value.id),['remaining']);
 const previousAccount=pptTaskStore.beginRequest();pptTaskStore.clear();assert.equal(pptTaskStore.isReady(),false);assert.equal(pptTaskStore.isCurrent(previousAccount),false);assert.equal(pptTaskStore.set([project('private-old-account')],previousAccount),false);assert.deepEqual(pptTaskStore.getSnapshot(),[]);
 const empty=pptTaskStore.beginRequest();assert.equal(pptTaskStore.set([],empty),true);assert.equal(pptTaskStore.isReady(),true,'a verified empty library is different from not yet loaded');
 pptTaskStore.clear();
});
