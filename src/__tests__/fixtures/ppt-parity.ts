/** Isolated UI fixture: production components, deterministic API responses, no user account writes. */
export function pptParityFixture(options: {completeAfterEdits?: number} = {}) {
  const size = { width: 12192000, height: 6858000 };
  const now = new Date().toISOString();
  const templates = [12, 10].map((pages, index) => ({ id: index ? 'blue' : 'light', name: index ? 'Blue template' : 'Teaching template', category: '通用模板', description: 'Fixture template', pages, kind: 'builtin', compatibility: 'mapped', pinned: false, tags: [], sampleTitles: ['Cover','Mechanism','Summary'] }));
  const outlineFor = (pages: number) => Array.from({length:pages}, (_, index) => ({id:`s${index}`,title:`Topic ${index+1}`,focus:'Explain the source relationship',section:'Source',description:'Mechanism, conditions and source evidence.',children:[{id:`c${index}`,title:'Conditions',description:'Retain assumptions and uncertainty.'}]}));
  const renderFor = (outline: ReturnType<typeof outlineFor>) => ({ schemaVersion:3, units:'emu', deckId:'deck_fixture', hash:'fixture', size, slides:outline.map((slide,index) => ({id:`render${index}`,slideId:slide.id,index,layoutId:index ? 'summary':'cover',size,background:'#ffffff',elements:[{id:`e${index}`,nodeId:`n${index}`,kind:'text',bounds:{x:500000,y:500000,width:10000000,height:1000000},content:{text:slide.title},style:{fontSizePt:28,color:'#111111'},zIndex:1,locked:false,semanticRole:'title'}]})) });
  const makeProject = (id: string, pages: number, status = 'outline_ready') => {
    const outline = outlineFor(pages), renderTree = renderFor(outline);
    return {id,title:'Workflow fixture',prompt:'Explain mechanisms',inputKind:'prompt',pages,template:'light',model:'demo-model',configId:'demo',status,stage:status,error:'',outline,deck:{slides:outline.map(slide => ({...slide,bullets:['Source-backed relationship and conditions'],blocks:[],layoutId:'summary'}))},renderTree,revision:1,publishedRevision:1,currentRunId:`run_${'a'.repeat(24)}`,createdAt:now,updatedAt:now,editing:{contentOpen:true,intents:{} as Record<string, any>},nodes:Object.fromEntries(outline.map(slide => [slide.id,{status:'pending'}])),runtime:{slides:Object.fromEntries(outline.map((slide,index) => [slide.id,{phase:'content',epoch:0,accepted:false,preview:renderTree.slides[index]}]))}};
  };
  const projects = new Map<string, ReturnType<typeof makeProject>>();
  projects.set('9'.repeat(32),makeProject('9'.repeat(32),12,'generating'));
  const payloads: any[] = [], scopes = new Map<string, any>(); let counter=0;
  async function handle(method: string, pathname: string, body: any = {}): Promise<{status:number;body:unknown;contentType?:string} | null> {
    const ok = (data: unknown,status=200) => ({status,body:data});
    if (pathname === '/__fixture/state') return ok({payloads,projects:[...projects.values()]});
    if (pathname === '/api/providers') return ok({providers:[{id:'managed-demo',name:'Fixture model',source:'managed'}]});
    if (pathname === '/api/providers/models') return ok({groups:[{provider_id:'managed-demo',models:[{value:'demo-model',label:'Demo LLM'}]}]});
    if (!pathname.startsWith('/api/ppt/')) return null;
    if (pathname.includes('/templates/') && pathname.endsWith('/preview')) return {status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#eee"/><text x="100" y="200" font-size="60">Template preview</text></svg>'};
    if (pathname.includes('/templates')) return ok({templates});
    if (pathname.includes('/folders')) return ok({folders:[]});
    if (pathname.endsWith('/page-estimate')) {
      const text = String(body.prompt || body.text || '');
      await new Promise(resolve => setTimeout(resolve,text.includes('slow') ? 600 : 80));
      const requested = text.match(/(?:^|[^第\d])(\d+)\s*(?:页|slides?)/i)?.[1];
      return ok({recommendation:{recommended:text.includes('latest')?9:8,min:3,max:15,requested:requested?Number(requested):undefined,reason:'Semantic source capacity fixture'}});
    }
    if (pathname === '/api/ppt/projects') {
      if (method === 'GET') return ok({projects:[...projects.values()]});
      const id = String(++counter).padStart(32,'0'); payloads.push({...body});
      const project = makeProject(id,body.pages || 8,body.importMode === 'editable' ? 'completed':'outline_ready');
      Object.assign(project,{title:body.title || project.title,template:body.template,generationPolicy:body.generationPolicy,inputKind:body.inputKind}); projects.set(id,project); return ok({project},201);
    }
    const [,id,action,objectId,decision] = pathname.slice('/api/ppt/'.length).split('/');
    const project = projects.get(id); if (!project) return ok({error:'project not found'},404);
    if (action === 'preview' || action === 'slides' && decision === 'preview') return {status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#fff"/><text x="100" y="200" font-size="60">Source relationship</text></svg>'};
    if (action === 'events') return {status:200,body:`event: snapshot\ndata: ${JSON.stringify({project,run:{lastSeq:1}})}\n\n`,contentType:'text/event-stream'};
    if (action === 'versions') return ok({versions:[]});
    if (action === 'outline') {
      payloads.push({...body,action});
      if (method === 'PATCH') {project.outline=body.slides; project.pages=body.finalPageCount;}
      if (body.generationPolicy) Object.assign(project,{generationPolicy:body.generationPolicy});
      return ok({project});
    }
    if (action === 'generate') {project.status='completed'; project.stage='completed'; project.editing.contentOpen=false; return ok({project},202);}
    if (action === 'generation-edit-scopes') {
      const previous = scopes.get(body.previousScopeId), slideId = previous?.currentSlideId || body.slideId;
      const selected = project.outline.findIndex(slide => slide.id === slideId);
      const scope = {id:`scope_${++counter}`,runId:project.currentRunId,planKey:'fixture',baseRevision:project.revision,openedAt:now,currentSlideId:slideId,remainingSlideIds:previous?.remainingSlideIds || project.outline.map(slide=>slide.id),followingSlideIds:previous?.followingSlideIds || project.outline.slice(selected+1).map(slide=>slide.id),sectionSlideIds:project.outline.map(slide=>slide.id),deckSlideIds:project.outline.map(slide=>slide.id)};
      scopes.set(scope.id,scope); return ok({scope});
    }
    if (action === 'generation-edits') {
      if (method === 'GET') return ok({intent:project.editing.intents[objectId]});
      payloads.push({...body,action}); if(options.completeAfterEdits && payloads.filter(value=>value.action==='generation-edits').length >= options.completeAfterEdits) {project.status='completed'; project.editing.contentOpen=false;} const snapshot=scopes.get(body.scopeId);
      const intent={id:`intent_${++counter}`,scope:body.scope,scopeSnapshot:snapshot,instruction:body.instruction,status:'applied',perSlideResults:{[snapshot.currentSlideId]:{status:'applied',revision:++project.revision}}}; project.editing.intents[intent.id]=intent; return ok({project,intent});
    }
    if (action === 'ai-edit') {
      payloads.push({...body,action}); return ok({proposal:{id:'proposal_fixture',scope:body.scope,slideId:body.slideId,instruction:body.instruction,action:body.action,parameters:body.parameters,baseRevision:project.revision,beforeSvg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><text x="20" y="60">Original</text></svg>',afterSvg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><text x="20" y="60">Candidate</text></svg>',metrics:{beforeLength:20,afterLength:40,ratio:2,requestedRatio:body.parameters?.lengthRatio,unchanged:false},quality:{issues:[],hardErrors:0}}});
    }
    if (action === 'proposals') return ok({project,proposal:{id:objectId,status:decision==='apply'?'applied':'discarded'},operation:{id:'op_fixture'}});
    if (action === 'revisions' || action === 'commands') return ok({revisions:[],operations:[]});
    if (action === 'slides') return ok({slide:project.renderTree.slides.find(slide=>slide.slideId===objectId)});
    return ok({project});
  }
  return {handle,payloads,projects};
}
