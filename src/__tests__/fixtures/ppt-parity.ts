import type {PptEditScope,PptExecutionPolicy,PptGenerationPolicy} from '@/components/ppt/types';
/** Isolated UI fixture: production components, deterministic API responses, no user account writes. */
export function pptParityFixture(options: {completeAfterEdits?: number; holdOutline?: boolean} = {}) {
  const size = { width: 12192000, height: 6858000 };
  const now = new Date().toISOString();
  const templates = [12, 10].map((pages, index) => ({ id: index ? 'blue' : 'light', name: index ? 'Blue template' : 'Teaching template', category: '通用模板', description: 'Fixture template', pages, kind: 'builtin', compatibility: 'mapped', pinned: false, tags: [], sampleTitles: ['Cover','Mechanism','Summary'] }));
  const outlineFor = (pages: number) => Array.from({length:pages}, (_, index) => ({id:`s${index}`,title:`Topic ${index+1}`,focus:'Explain the source relationship',section:'Source',description:'Mechanism, conditions and source evidence.',children:[{id:`c${index}`,title:'Conditions',description:'Retain assumptions and uncertainty.'}]}));
  type FixturePayload={
    [key:string]:unknown;
    prompt?:string;text?:string;title?:string;template?:string;inputKind?:string;importMode?:string;pages?:number;
    images?:{fileName:string;[key:string]:unknown}[];
    generationPolicy?:PptGenerationPolicy;executionPolicy?:PptExecutionPolicy;
    slides?:ReturnType<typeof outlineFor>;finalPageCount?:number;
    previousScopeId?:string;slideId?:string;scopeId?:string;action?:string;
    parameters?:{[key:string]:unknown;lengthRatio?:number};
  };
  const renderFor = (outline: ReturnType<typeof outlineFor>) => ({ schemaVersion:3, units:'emu', deckId:'deck_fixture', hash:'fixture', size, slides:outline.map((slide,index) => ({id:`render${index}`,slideId:slide.id,index,layoutId:index ? 'summary':'cover',size,background:'#ffffff',elements:[{id:`e${index}`,nodeId:`n${index}`,kind:'text',bounds:{x:500000,y:500000,width:10000000,height:1000000},content:{text:slide.title},style:{fontSizePt:28,color:'#111111'},zIndex:1,locked:false,semanticRole:'title'}]})) });
  const makeProject = (id: string, pages: number, status = 'outline_ready') => {
    const outline = outlineFor(pages), renderTree = renderFor(outline);
    return {coverAvailable:status==='completed',inputUnderstanding:{version:1,recommended:pages,min:3,max:15,reason:'Fixture agent read checkpoint'},planning:{pageRecommendation:{recommended:pages,range:[3,15],reason:'Fixture agent read checkpoint',assumptions:[{topic:'code' as const,decision:'omit',reversible:true,affectedSourceIds:[] as string[],reason:'2 段代码不上页'}]}},id,title:'Workflow fixture',prompt:'Explain mechanisms',inputKind:'prompt',pages,template:'light',model:'demo-model',configId:'demo',status,stage:status,error:'',outline,deck:{slides:outline.map(slide => ({...slide,bullets:['Source-backed relationship and conditions'],blocks:[],layoutId:'summary'}))},renderTree,revision:1,publishedRevision:1,currentRunId:`run_${'a'.repeat(24)}`,createdAt:now,updatedAt:now,editing:{contentOpen:true,intents:{} as Record<string, unknown>},nodes:Object.fromEntries(outline.map(slide => [slide.id,{status:'pending'}])),runtime:{slides:Object.fromEntries(outline.map((slide,index) => [slide.id,{phase:'content',epoch:0,accepted:false,preview:renderTree.slides[index]}]))}};
  };
  // Card decks (2026-10-23): a new project is read by code and stops at the
  // settings form; one planning command writes the whole card outline.
  const presets = {quick:{content:5,dividers:0,takeaway:true,total:7},standard:{content:6,dividers:0,takeaway:true,total:8},full:{content:8,dividers:0,takeaway:true,total:10}};
  type Length = {preset?:keyof typeof presets;exact?:number};
  const cardOutlineFor = (total: number) => [{id:'s0',title:'Workflow fixture',focus:'Workflow fixture',section:'Workflow fixture',keyPoints:[] as unknown[]},
    ...Array.from({length:total-2},(_, index) => ({id:`s${index+1}`,title:`Topic ${index+1}`,focus:`Topic ${index+1}`,section:'Source',keyPoints:[{text:'Mechanism, conditions and source evidence.',refs:[],chunkRefs:[]},{text:'Retain assumptions and uncertainty.',refs:[],chunkRefs:[]}]})),
    {id:`s${total-1}`,title:'Takeaway',focus:'Takeaway',section:'Source',cardFrame:'takeaway',keyPoints:[{text:'Keep the conditions with the mechanism.',refs:[],chunkRefs:[]}]}];
  const totalFor = (length: Length = {}) => length.exact || presets[length.preset || 'standard'].total;
  const cardContract = (length: Length = {preset:'standard'}) => ({version:3,phase:'reading',contentMode:null as string|null,logicalCards:[] as unknown[],semanticRevision:undefined as string|undefined,
    settings:{length,presets,language:'en',languageDefault:'en',bilingualSource:false,notesOther:false,instruction:''},
    structure:{sections:6,chars:2400,objects:{tables:0,code:0,equations:0,lists:0},images:0,primaryLanguage:'en',bilingualRatio:0,warnings:[] as unknown[]},summary:undefined as unknown});
  const projects = new Map<string, ReturnType<typeof makeProject>>();
  projects.set('9'.repeat(32),makeProject('9'.repeat(32),12,'generating'));
  const payloads: FixturePayload[] = [], scopes = new Map<string, PptEditScope>(), written = new Map<string, () => void>(); let counter=0;
  type OutlineRequest = {length?:Length;template?:string;contentMode?:string;language?:string;notesOther?:boolean;instruction?:string};
  // A card outline being written, like the server: "outlining" now, written on
  // the next read of the project unless the test holds it. A fresh read starts
  // one too (Gamma, 2026-10-31) and shows its planned topics as they form.
  const startOutline = (id: string, project: ReturnType<typeof makeProject>, body: OutlineRequest, forming = false) => {
    const contract = (project as unknown as {planningContract:ReturnType<typeof cardContract>}).planningContract;
    const length = body.length, total = totalFor(length), revision = `r${++counter}`;
    Object.assign(project,{status:'outlining',stage:'outline',outline:[]});Object.assign(contract,{phase:'expanding',writing:{pages:total}});
    if (forming) Object.assign(project,{outlineForming:{version:1,phase:'cards',done:0,total:total-1,at:now,syllabus:Array.from({length:total-1},(_,k)=>({id:`forming_${k}`,title:`Topic ${k+1}`,points:[],pending:true}))}});
    written.set(id,() => {
      Object.assign(project,{status:'outline_ready',stage:'outline',pages:total,outline:cardOutlineFor(total),template:body.template||project.template,outlineAcceptance:{confirmable:true}});
      Object.assign(contract,{phase:'page_plan_ready',semanticRevision:revision,contentMode:body.contentMode||'concise',settings:{...contract.settings,length:length||{preset:'standard'},language:body.language||contract.settings.language,notesOther:Boolean(body.notesOther),instruction:body.instruction||''},
        summary:{version:1,language:body.language||'en',notesOther:Boolean(body.notesOther),textMode:body.contentMode||'concise',length:length?.preset||'custom',pages:total,steps:[],objects:[],statements:['Takeaway'],chapters:[],takeaway:true,uncoveredSections:[],labelled:0,warnings:[]}});
      delete (contract as {writing?:unknown}).writing;delete (project as {outlineForming?:unknown}).outlineForming;
    });
  };
  async function handle(method: string, pathname: string, body: FixturePayload = {}): Promise<{status:number;body:unknown;contentType?:string} | null> {
    const ok = (data: unknown,status=200) => ({status,body:data});
    if (pathname === '/__fixture/state') return ok({payloads,projects:[...projects.values()]});
    if(pathname==='/api/ppt/capabilities')return ok({byok:{protocolVersion:1,executionPolicyVersion:1,multimodalVersion:1,transport:'desktop-model-jobs',credentialLocation:'desktop',requiresOpenClient:true,maxPromptBytes:2000000,maxResultBytes:4000000,jobTimeoutMs:900000,concurrency:3}});
    if (pathname === '/api/providers') return ok({providers:[{id:'managed-demo',name:'Fixture model',source:'managed'}]});
    if(pathname==='/api/providers/options')return ok({options:{default_model_provider:'managed-demo',default_model:'demo-model'}});
    if (pathname === '/api/providers/models') return ok({groups:[{provider_id:'managed-demo',models:[{value:'demo-model',label:'Demo LLM'}]}]});
    if (!pathname.startsWith('/api/ppt/')) return null;
    if (pathname === '/api/ppt/model-jobs') return ok({jobs:[]});
    if (pathname.includes('/templates/') && pathname.endsWith('/preview')) return {status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#eee"/><text x="100" y="200" font-size="60">Template preview</text></svg>'};
    if (pathname.includes('/templates')) return ok({templates});
    if (pathname.includes('/folders')) return ok({folders:[]});
    if (pathname.endsWith('/page-estimate')) {
      const text = String(body.prompt || body.text || '');
      await new Promise(resolve => setTimeout(resolve,text.includes('slow') ? 600 : 80));
      const requested = text.match(/(?:^|[^第\d])(\d+)\s*(?:页|slides?)/i)?.[1];
      if (text.includes('with code')) {
        // Mirrors the server's disclosed planning assumptions (code policy is reversible).
        const keep = body.generationPolicy?.code?.presentation === 'keep';
        return ok({recommendation:{recommended:keep?11:8,min:3,max:15,reason:'Semantic source capacity fixture. 2 段代码不上页',reasonBase:'Semantic source capacity fixture',
          assumptions:[{topic:'code',decision:keep?'keep':'omit_with_disclosure',basis:keep?'user_choice':'default_non_code_template',reversible:true,affectedSourceIds:['b_0002','b_0004'],
            reason:keep?'2 段代码按原文保留为代码组件。可改为不上页。':'2 段代码不上页（所选模板没有代码组件）；公式、阈值与流程逻辑仍以文字、步骤或公式呈现。可改为保留代码。'},
            {topic:'language',decision:'bilingual_pairs',reversible:false,affectedSourceIds:[],reason:'输出语言与输入一致：3 组平行双语段落两种语言都保留，在同一组件内成对呈现；配对算一条内容，两种语言分别占用版面。'}]}});
      }
      return ok({recommendation:{recommended:text.includes('latest')?9:8,min:3,max:15,requested:requested?Number(requested):undefined,reason:'Semantic source capacity fixture'}});
    }
    if (pathname === '/api/ppt/projects') {
      if (method === 'GET') return ok({projects:[...projects.values()]});
      const id = String(++counter).padStart(32,'0'); payloads.push({...body});
      const project = makeProject(id,body.pages || 8,body.importMode === 'editable' ? 'completed':body.readOnlyInput?'input_ready':'outline_ready');
      if(body.readOnlyInput)project.outline=[];
      Object.assign(project,{title:body.title || project.title,template:body.template,generationPolicy:body.generationPolicy,inputKind:body.inputKind});
      if(body.planningFlow==='cards'&&body.importMode!=='editable'){
        const total=presets.standard.total;Object.assign(project,{pages:total,stage:body.readOnlyInput?'input':'outline',inputUnderstanding:{...project.inputUnderstanding,recommended:total,presets},planningContract:cardContract()});
        // Like the server (2026-10-31, Gamma): reading flows into writing the
        // outline; its planned topics show at once and it is there on the next read.
        if(!body.readOnlyInput)startOutline(id,project,{},true);
      }
      projects.set(id,project); return ok({project},201);
    }
    const [,id,action,objectId,decision] = pathname.slice('/api/ppt/'.length).split('/');
    const project = projects.get(id); if (!project) return ok({error:'project not found'},404);
    if (method === 'GET' && !action && written.has(id) && !options.holdOutline) {written.get(id)!();written.delete(id);}
    if(pathname.endsWith('/cover')&&method==='GET')return ok({slide:project.renderTree.slides[0],publishedRevision:project.publishedRevision});
    if (action === 'preview' || action === 'slides' && decision === 'preview') return {status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#fff"/><text x="100" y="200" font-size="60">Source relationship</text></svg>'};
    if (action === 'events') return {status:200,body:`event: snapshot\ndata: ${JSON.stringify({project,run:{lastSeq:1}})}\n\n`,contentType:'text/event-stream'};
    if (action === 'versions') return ok({versions:[]});
    if(action==='conversation')return ok({initialRequest:project.prompt||'',intents:project.editing?.intents||{}});
    if (action === 'planning' && method === 'POST') {
      payloads.push({...body,action});
      const contract = (project as {planningContract?:ReturnType<typeof cardContract>}).planningContract;
      if (!contract) return ok({error:'not a card deck'},409);
      if (body.command === 'outline') {
        // Like the server: the command answers "outlining"; the outline is
        // there on the next read of the project (unless the test holds it).
        startOutline(id,project,body as OutlineRequest);
      }
      if (body.command === 'edit') {
        // Edited cards keep their frames; a new card gets its ID here.
        const before = new Map(project.outline.map(slide => [slide.id,slide]));
        project.outline = (body.cards as {id?:string;title:string;points:string[];labels?:string[]}[]).map(card => ({...(card.id && before.get(card.id) || {section:'Source'}),id:card.id || `s_new${++counter}`,title:card.title,focus:card.title,keyPoints:card.points.map((text,k) => ({text,...(card.labels?.[k]?{label:card.labels[k]}:{}),refs:[],chunkRefs:[]}))})) as typeof project.outline;
        project.pages = project.outline.length;
      }
      return ok({project},202);
    }
    if (action === 'outline') {
      payloads.push({...body,action});
      if (method === 'PATCH') {project.outline=body.slides!; project.pages=body.finalPageCount!;}
      if(method==='POST'){project.status=body.readOnlyInput?'input_ready':'outline_ready';if(body.pages)project.pages=body.pages;if(!body.readOnlyInput&&!project.outline.length)project.outline=outlineFor(project.pages);}
      if (body.generationPolicy) Object.assign(project,{generationPolicy:body.generationPolicy});
      return ok({project});
    }
    if (action === 'generate') {project.status='completed'; project.stage='completed'; project.editing.contentOpen=false; return ok({project},202);}
    if (action === 'generation-edit-scopes') {
      const previous = scopes.get(body.previousScopeId!), slideId = previous?.currentSlideId || body.slideId!;
      const selected = project.outline.findIndex(slide => slide.id === slideId);
      const scope = {id:`scope_${++counter}`,runId:project.currentRunId,planKey:'fixture',baseRevision:project.revision,openedAt:now,currentSlideId:slideId,remainingSlideIds:previous?.remainingSlideIds || project.outline.map(slide=>slide.id),followingSlideIds:previous?.followingSlideIds || project.outline.slice(selected+1).map(slide=>slide.id),sectionSlideIds:project.outline.map(slide=>slide.id),deckSlideIds:project.outline.map(slide=>slide.id)};
      scopes.set(scope.id,scope); return ok({scope});
    }
    if (action === 'generation-edits') {
      if (method === 'GET') return ok({intent:project.editing.intents[objectId]});
      payloads.push({...body,action}); if(options.completeAfterEdits && payloads.filter(value=>value.action==='generation-edits').length >= options.completeAfterEdits) {project.status='completed'; project.editing.contentOpen=false;} const snapshot=scopes.get(body.scopeId!)!;
      const intent={id:`intent_${++counter}`,scope:body.scope,scopeSnapshot:snapshot,instruction:body.instruction,status:'applied',perSlideResults:{[snapshot.currentSlideId]:{status:'applied',revision:++project.revision}}}; project.editing.intents[intent.id]=intent; return ok({project,intent});
    }
    if (action === 'ai-edit') {
      payloads.push({...body,action}); return ok({proposal:{id:'proposal_fixture',scope:body.scope,slideId:body.slideId,instruction:body.instruction,action:body.action,parameters:body.parameters,baseRevision:project.revision,beforeSvg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><text x="20" y="60">Original</text></svg>',afterSvg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><text x="20" y="60">Candidate</text></svg>',metrics:{beforeLength:20,afterLength:40,ratio:2,requestedRatio:body.parameters?.lengthRatio,unchanged:false},quality:{issues:[],hardErrors:0,preservedObjectIds:['formula-source','table-source'],objectChanges:[]}}});
    }
    if (action === 'proposals') return ok({project,proposal:{id:objectId,status:decision==='apply'?'applied':'discarded'},operation:{id:'op_fixture'}});
    if (action === 'revisions' || action === 'commands') return ok({revisions:[],operations:[]});
    if (action === 'slides') return ok({slide:project.renderTree.slides.find(slide=>slide.slideId===objectId)});
    return ok({project});
  }
  return {handle,payloads,projects,cardContract};
}
