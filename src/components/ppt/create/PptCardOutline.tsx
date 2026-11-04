'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useTranslation} from '@/hooks/useTranslation';
import {pptFailureMessage} from '@/lib/ppt-error';
import type {TranslationKey} from '@/i18n';
import type {PptProject,PptTemplate,PptCardLanguage,PptCardSettings,PptCardSummary,PptSourceStructure,PptSourceNote} from '../types';
import {PptSourceWarnings,unresolvedSourceWarnings} from './PptSourceWarnings';
import {AiSparkleIcon} from './AiSparkleIcon';

type Density='concise'|'standard'|'detailed';
type Length='quick'|'standard'|'full'|'custom';
const button='rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';
const primary='rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
const tool='rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40';
const select='w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const seamless='block w-full resize-none bg-transparent outline-none focus:rounded focus:bg-muted/40';
const LENGTHS=['quick','standard','full'] as const;
/** One card as the outline shows it: a title, its points and their headings. */
export type PptOutlineCard={key:string;title:string;subtitle?:string;numbered:boolean;points:string[];labels?:(string|undefined)[];frame?:'divider'|'takeaway';pending?:boolean;figures?:string[];figurePage?:boolean};
/** One card as the author edits it; a new card has no id until it is saved. */
export type PptCardEdit={key:string;id?:string;title:string;subtitle?:string;numbered:boolean;points:string[];labels?:(string|undefined)[];frame?:'divider'|'takeaway';figures?:string[];figurePage?:boolean};

/** Cards to show: the accepted outline, else one pending card per planned page. */
export function outlineCards(project:PptProject):PptOutlineCard[]{
 const c=project.planningContract;
 // A shortened cover headline shows the full title beneath it.
 if(c?.phase==='page_plan_ready'&&project.outline.length)return project.outline.map((slide,index)=>({key:slide.id,title:slide.title,subtitle:slide.titleSecondary||(index===0&&slide.description?slide.description:undefined),numbered:Boolean(slide.numberedPoints),
  points:(slide.keyPoints||[]).map(point=>point.text),labels:(slide.keyPoints||[]).map(point=>point.label),...(slide.cardFrame?{frame:slide.cardFrame}:{}),
  // The figures a page shows (captions), and whether it is a figure page.
  ...(slide.sourceImageIds?.length?{figures:slide.sourceImageIds.map(id=>String(project.sourceAssets?.find(asset=>asset.id===id)?.caption||id).split('\n')[0])}:{}),...(slide.figurePage?{figurePage:true}:{})}));
 // While the outline is written, each topic's cards replace its placeholder as
 // soon as they arrive, after the cover (P1, 2026-10-31).
 const forming=project.status==='outlining'?project.outlineForming:undefined;
 if(forming?.syllabus.length)return [{key:'forming_cover',title:project.deckTitle?.text||project.title||'',numbered:false,points:[]},
  ...forming.syllabus.map(item=>({key:item.id,title:item.title,numbered:false,points:item.points||[],...(item.pending?{pending:true}:{})}))];
 return Array.from({length:c?.writing?.pages||0},(_,k)=>({key:`w${k}`,title:'',numbered:false,points:[],pending:true}));
}
/** The step the outline is on while it is written (P2, 2026-10-31). */
export function formingStatus(project:PptProject,t:ReturnType<typeof useTranslation>['t']){
 const forming=project.status==='outlining'?project.outlineForming:undefined;
 if(!forming)return '';
 if(forming.phase==='cards')return forming.total?t('ppt.cards.formingCards',{done:forming.done,total:forming.total}):'';
 return t(forming.phase==='finishing'?'ppt.cards.formingFinishing':forming.phase==='fitting'?'ppt.cards.formingFitting':'ppt.cards.formingChecking');
}
const editsFrom=(project:PptProject):PptCardEdit[]=>outlineCards(project).map(card=>({key:card.key,id:card.key,title:card.title,subtitle:card.subtitle,numbered:card.numbered,points:card.points,labels:card.labels,frame:card.frame,figures:card.figures,figurePage:card.figurePage}));
let localKeys=0;
/** Pure edit operations on the card list (the cover stays first). */
export const cardEditOps={
 add:(cards:PptCardEdit[],after:number,title:string):PptCardEdit[]=>[...cards.slice(0,after+1),{key:`new-${++localKeys}`,title,numbered:false,points:['']},...cards.slice(after+1)],
 remove:(cards:PptCardEdit[],index:number)=>index>0?cards.filter((_,i)=>i!==index):cards,
 move:(cards:PptCardEdit[],from:number,to:number)=>{if(from<1||to<1||to>=cards.length||from===to)return cards;const next=[...cards];const [card]=next.splice(from,1);next.splice(to,0,card);return next;},
 // A point's heading (its label on the slide) travels in a list parallel to the
 // points and is edited on its own (Fable 2026-10-25, report b813b4d3).
 point:(cards:PptCardEdit[],index:number,at:number,text:string)=>cards.map((card,i)=>i===index?{...card,points:card.points.map((point,k)=>k===at?text:point)}:card),
 heading:(cards:PptCardEdit[],index:number,at:number,text:string)=>cards.map((card,i)=>i===index?{...card,labels:card.points.map((_,k)=>k===at?text:card.labels?.[k])}:card),
 insertPoint:(cards:PptCardEdit[],index:number,after:number)=>cards.map((card,i)=>i===index?{...card,points:[...card.points.slice(0,after+1),'',...card.points.slice(after+1)],labels:card.labels&&[...card.labels.slice(0,after+1),undefined,...card.labels.slice(after+1)]}:card),
 removePoint:(cards:PptCardEdit[],index:number,at:number)=>cards.map((card,i)=>i===index?{...card,points:card.points.filter((_,k)=>k!==at),labels:card.labels?.filter((_,k)=>k!==at)}:card),
 /** What the server receives: titles and non-empty points with their headings
  * ('' for none), in order; a blank point leaves with its heading. */
 payload:(cards:PptCardEdit[])=>cards.map(card=>{const kept=card.points.map((point,k)=>[point.trim(),String(card.labels?.[k]||'').trim()]).filter(([point])=>point);
  return{...(card.id?{id:card.id}:{}),title:card.title.trim(),points:kept.map(([point])=>point),labels:kept.map(([,label])=>label),numbered:card.numbered};}),
};

/** The settings form's values (Gamma's "Settings" panel). */
export type CardSettingsForm={length:Length;exact:number;density:Density;language:PptCardLanguage;notesOther:boolean;template:string};
export function settingsFrom(project:PptProject):CardSettingsForm{
 const s=project.planningContract?.settings,length=s?.length;
 const exact=length&&'exact' in length?length.exact:s?.presets?.standard?.total||12;
 return{length:length&&'exact' in length?'custom':length?.preset||'standard',exact,density:(project.planningContract?.contentMode||'concise') as Density,language:s?.language||'en',notesOther:Boolean(s?.notesOther),template:project.template};
}
/** The planning command for these settings (and an optional instruction). */
export function outlineRequest(project:PptProject,form:CardSettingsForm,instruction=''){
 return{command:'outline',template:form.template,contentMode:form.density,semanticRevision:project.planningContract?.semanticRevision,
  length:form.length==='custom'?{exact:Math.max(6,Math.min(40,Math.round(form.exact)))}:{preset:form.length},language:form.language,notesOther:form.language!=='bilingual'&&form.notesOther,instruction:instruction.trim()};
}
const sameSettings=(a:CardSettingsForm,b:CardSettingsForm)=>a.length===b.length&&(a.length!=='custom'||a.exact===b.exact)&&a.density===b.density&&a.language===b.language&&(a.language==='bilingual'||a.notesOther===b.notesOther)&&a.template===b.template;
const languageKey:Record<PptCardLanguage,TranslationKey>={bilingual:'ppt.cards.languageBilingual',en:'ppt.cards.languageEn',zh:'ppt.cards.languageZh','zh-Hant':'ppt.cards.languageZhHant'};
const lengthKey:Record<Length,TranslationKey>={quick:'ppt.cards.lengthQuick',standard:'ppt.cards.lengthStandard',full:'ppt.cards.lengthFull',custom:'ppt.cards.lengthCustom'};
const densityKey:Record<Density,TranslationKey>={concise:'ppt.cards.condense',standard:'ppt.cards.keep',detailed:'ppt.cards.expand'};

/** A text field as tall as its wrapped text, so a long point is read in full. */
function Grow({value,onChange,onKeyDown,className,placeholder,label,inputRef}:{value:string;onChange:(value:string)=>void;onKeyDown?:(event:React.KeyboardEvent<HTMLTextAreaElement>)=>void;className:string;placeholder:string;label:string;inputRef?:(element:HTMLTextAreaElement|null)=>void}){
 const own=useRef<HTMLTextAreaElement|null>(null);
 const fit=()=>{const t=own.current;if(t){t.style.height='auto';t.style.height=t.scrollHeight+'px';}};
 useEffect(fit,[value]);
 useEffect(()=>{window.addEventListener('resize',fit);return()=>window.removeEventListener('resize',fit);},[]);
 return <textarea ref={element=>{own.current=element;inputRef?.(element);}} rows={1} aria-label={label} placeholder={placeholder} className={`${seamless} overflow-hidden ${className}`} value={value} onKeyDown={onKeyDown}
  onChange={event=>onChange(event.target.value)}/>;
}

/** Segmented choice, Gamma style, in the app's own colours. */
function Segments<T extends string>({label,value,options,onChange,disabled,testId}:{label:string;value:T;options:{value:T;label:string;detail?:string}[];onChange:(value:T)=>void;disabled:boolean;testId?:string}){
 return <div role="radiogroup" aria-label={label} data-testid={testId} className="grid gap-2" style={{gridTemplateColumns:`repeat(${options.length},minmax(0,1fr))`}}>
  {options.map(option=><button key={option.value} type="button" role="radio" aria-checked={value===option.value} disabled={disabled} onClick={()=>onChange(option.value)}
   className={`rounded-lg border px-2 py-2 text-sm transition-colors disabled:opacity-50 ${value===option.value?'border-primary bg-primary/10 font-medium text-primary':'border-border hover:bg-accent'}`}>
   <span className="block">{option.label}</span>{option.detail&&<span className="block text-xs text-muted-foreground">{option.detail}</span>}</button>)}
 </div>;
}

/** The settings form: length with page counts, text density, language and
 * notes, template. Shown alone before the outline is written, beside it after. */
function SettingsForm({form,onChange,settings,templates,disabled,keepTemplate,compact}:{form:CardSettingsForm;onChange:(form:CardSettingsForm)=>void;settings?:PptCardSettings;templates:PptTemplate[];disabled:boolean;keepTemplate:boolean;compact:boolean}){
 const {t}=useTranslation();
 const set=(patch:Partial<CardSettingsForm>)=>onChange({...form,...patch});
 const languages:PptCardLanguage[]=settings?.bilingualSource?['bilingual','en','zh','zh-Hant']:['en','zh','zh-Hant'];
 return <div data-testid="ppt-card-settings" className={`space-y-5 rounded-xl border border-border bg-card ${compact?'p-4':'p-6'}`}>
  <h2 className={compact?'text-sm font-semibold':'text-lg font-semibold'}>{t('ppt.cards.settings')}</h2>
  <section className="space-y-2"><h3 className="text-sm font-medium">{t('ppt.cards.length')}</h3>
   <Segments testId="ppt-card-length" label={t('ppt.cards.length')} value={form.length} disabled={disabled} onChange={length=>set({length})}
    options={[...LENGTHS.map(name=>({value:name as Length,label:t(lengthKey[name]),detail:settings?.presets?.[name]?t('ppt.cards.lengthPages',{n:settings.presets[name].total}):undefined})),{value:'custom' as Length,label:t('ppt.cards.lengthCustom')}]}/>
   {form.length==='custom'&&<label className="flex items-center gap-2 text-sm">{t('ppt.cards.customPages')}<input data-testid="ppt-card-exact" type="number" min={6} max={40} step={1} className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-center" disabled={disabled} value={form.exact}
    onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))set({exact:value});}} onBlur={()=>set({exact:Math.max(6,Math.min(40,Math.round(form.exact)||6))})}/></label>}
   {!compact&&<p className="text-xs text-muted-foreground">{t('ppt.cards.lengthHint')}</p>}
  </section>
  <section className="space-y-2"><h3 className="text-sm font-medium">{t('ppt.cards.density')}</h3>
   <Segments testId="ppt-card-density" label={t('ppt.cards.density')} value={form.density} disabled={disabled} onChange={density=>set({density})}
    options={(['concise','standard','detailed'] as Density[]).map(value=>({value,label:t(densityKey[value])}))}/>
   {!compact&&<p className="text-xs text-muted-foreground">{t('ppt.cards.densityHint')}</p>}
  </section>
  <section className="space-y-2"><h3 className="text-sm font-medium">{t('ppt.cards.language')}</h3>
   <Segments testId="ppt-card-language" label={t('ppt.cards.language')} value={form.language} disabled={disabled} onChange={language=>set({language})}
    options={languages.map(value=>({value,label:t(languageKey[value])}))}/>
   {settings?.languageDefault&&<p className="text-xs text-muted-foreground">{t('ppt.cards.languageDetected',{language:t(languageKey[settings.languageDefault])})}</p>}
   {settings?.bilingualSource&&form.language!=='bilingual'&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid="ppt-card-notes-other" checked={form.notesOther} disabled={disabled} onChange={event=>set({notesOther:event.target.checked})}/>{t('ppt.cards.notesOther')}</label>}
  </section>
  <section className="space-y-2"><h3 className="text-sm font-medium">{t('ppt.cards.template')}</h3>
   <select aria-label={t('ppt.cards.template')} className={select} value={form.template} disabled={disabled||keepTemplate} onChange={event=>set({template:event.target.value})}>{templates.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
  </section>
 </div>;
}

/** What code read from the source: sections, objects and reading warnings. */
function SourcePanel({structure}:{structure?:PptSourceStructure}){
 const {t}=useTranslation();
 if(!structure)return null;
 return <section data-testid="ppt-card-source" className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
  <h2 className="font-semibold">{t('ppt.cards.source')}</h2>
  <p>{t('ppt.cards.sourceRead',{sections:structure.sections,chars:structure.chars})}</p>
  <p className="text-muted-foreground">{t('ppt.cards.sourceObjects',{tables:structure.objects.tables,equations:structure.objects.equations,code:structure.objects.code,images:structure.images})}</p>
  {structure.warnings.length>0&&<ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{structure.warnings.map((warning,index)=><li key={warning.code+index}>{warning.message}</li>)}</ul>}
 </section>;
}

/** A deck written from a brief (no source document): what that means for facts. */
function BriefPanel({project}:{project:PptProject}){
 const {t}=useTranslation();
 return <section data-testid="ppt-card-brief" className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
  <h2 className="font-semibold">{t('ppt.cards.briefTitle')}</h2>
  {project.prompt&&<p className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">{project.prompt}</p>}
  <p className="text-xs text-muted-foreground">{t('ppt.cards.briefHint')}</p>
 </section>;
}

/** Outline notes the editor words itself (the code's message is English). */
const NOTE_KEYS:Record<string,TranslationKey>={labels_partial_dropped:'ppt.cards.noteLabelsDropped',labels_completed:'ppt.cards.noteLabelsCompleted'};

/** What the written outline decided (D13), worded from the outline itself. */
function SummaryMessage({summary}:{summary:PptCardSummary}){
 const {t}=useTranslation();
 const list=(items:string[])=>items.slice(0,6).join(' · ')+(items.length>6?' …':'');
 return <section data-testid="ppt-card-summary" className="space-y-1 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
  <h2 className="font-semibold">{t('ppt.cards.summaryTitle')}</h2>
  {summary.basis==='brief'&&<p>{t('ppt.cards.summaryBrief')}</p>}
  <p>{t('ppt.cards.summaryPages',{pages:summary.pages,language:t(languageKey[summary.language]||'ppt.cards.languageEn'),textMode:t(densityKey[summary.textMode]||'ppt.cards.condense'),length:t(lengthKey[summary.length]||'ppt.cards.lengthStandard')})}</p>
  {summary.chapters.length>0&&<p>{t('ppt.cards.summaryChapters',{list:list(summary.chapters)})}</p>}
  {summary.takeaway&&<p>{t('ppt.cards.summaryTakeaway')}</p>}
  {summary.steps.length>0&&<p>{t('ppt.cards.summarySteps',{list:list(summary.steps)})}</p>}
  {summary.objects.length>0&&<p>{t('ppt.cards.summaryObjects',{list:list(summary.objects)})}</p>}
  {Boolean(summary.images?.length)&&<p>{t('ppt.cards.summaryImages',{list:list(summary.images!)})}</p>}
  {summary.labelled>0&&<p>{t('ppt.cards.summaryLabelled',{n:summary.labelled})}</p>}
  {summary.notesOther&&<p>{t('ppt.cards.summaryNotes')}</p>}
  {summary.uncoveredSections.length>0&&<p className="text-muted-foreground">{t('ppt.cards.summaryUncovered',{list:list(summary.uncoveredSections)})}</p>}
  {summary.warnings.length>0&&<ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{summary.warnings.slice(0,8).map((warning,index)=><li key={warning.code+index}>{warning.params&&NOTE_KEYS[warning.code]?t(NOTE_KEYS[warning.code],warning.params):warning.message}</li>)}</ul>}
 </section>;
}

function FrameTag({frame,cover}:{frame?:'divider'|'takeaway';cover:boolean}){
 const {t}=useTranslation();
 const key:TranslationKey|null=cover?'ppt.cards.coverTag':frame==='divider'?'ppt.cards.chapter':frame==='takeaway'?'ppt.cards.takeawayTag':null;
 return key?<span className="mb-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t(key)}</span>:null;
}
const Label=({label}:{label?:string})=>label?<strong className="mr-1 font-semibold">{label}:</strong>:null;
/** The figures a page shows, by caption (figure pages carry only these). */
function Figures({figures}:{figures:string[]}){
 const {t}=useTranslation();
 return <div data-testid="ppt-card-figures" className="mt-2 text-xs text-muted-foreground"><span className="font-medium">{t('ppt.cards.figures')}</span><ul className="mt-1 list-disc space-y-0.5 pl-5">{figures.map((caption,k)=><li key={k}>{caption}</li>)}</ul></div>;
}

/** A card that states a source count which does not multiply out (Fable,
 * 2026-10-23): the source is never changed; the author edits the point or keeps
 * the original. Generation never waits on it; publication does while a card
 * shows the count with its product. */
function SourceNote({note,onEdit,onKeep,disabled}:{note:PptSourceNote;onEdit?:()=>void;onKeep:()=>void;disabled:boolean}){
 const {t}=useTranslation();
 return <div role="note" data-testid="ppt-card-source-note" className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs">
  <p className="font-medium text-foreground">{t('ppt.cards.noteArithmeticShown',note.params)}</p>
  <p className="mt-1 text-muted-foreground">{t('ppt.sourceWarnings.arithmeticHint')}</p>
  <div className="mt-2 flex flex-wrap gap-2">
   {onEdit&&<button type="button" className={tool} onClick={onEdit}>{t('ppt.cards.editPoint')}</button>}
   <button type="button" className={tool} disabled={disabled} onClick={onKeep}>{t('ppt.create.sourceWarnings.keepOriginal')}</button>
  </div>
 </div>;
}
/** Card outline (after Gamma): the settings form first, then the outline
 * written in one run, shown card by card, edited in place, rewritten with an
 * instruction, then generated. There is no topic review, lock or pause. */
export function PptCardOutline({initial,templates,onClose,onGenerate,busy,modelsLoading=false,modelsError,onRetryModels,submitRefusal}:{initial:PptProject;templates:PptTemplate[];onClose:()=>void;onGenerate:(project:PptProject)=>void;busy:boolean;submitRefusal?:{message:string;pages:number[]}|null;modelsLoading?:boolean;modelsError?:string;onRetryModels?:()=>void}){
 const {t,locale}=useTranslation();
 const [project,setProject]=useState(initial),[error,setError]=useState(''),[pending,setPending]=useState(false);
 const c=project.planningContract!;
 const [form,setForm]=useState<CardSettingsForm>(()=>settingsFrom(initial));
 const [instruction,setInstruction]=useState('');
 const [edits,setEdits]=useState<PptCardEdit[]>(()=>editsFrom(initial));
 const [save,setSave]=useState<'idle'|'dirty'|'saving'|'saved'>('idle');
 const alive=useRef(true),latest=useRef(edits),saving=useRef<Promise<PptProject|null>|null>(null),focus=useRef<{key:string;select:boolean}|null>(null),fields=useRef(new Map<string,HTMLTextAreaElement>());
 latest.current=edits;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const active=['ingesting','outlining'].includes(project.status);
 const apply=useCallback((next:PptProject)=>{setProject(next);if(next.status==='failed')setError(next.error||'');},[]);
 // A run that (re)writes the outline replaces the cards being edited and the form.
 const wasActive=useRef(active);
 useEffect(()=>{if(wasActive.current&&!active){setEdits(editsFrom(project));setSave('idle');setForm(settingsFrom(project));}wasActive.current=active;},[active,project]);
 useEffect(()=>{
  if(!active)return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>;
  async function poll(){try{const r=await fetch(`/api/ppt/projects/${initial.id}?view=live`);const data=await r.json();if(!r.ok)throw Error(data.error||`HTTP ${r.status}`);if(cancelled)return;apply(data.project);if(['ingesting','outlining'].includes(data.project.status))timer=setTimeout(poll,1000);}catch(e){if(!cancelled){setError((e as Error).message);timer=setTimeout(poll,3000);}}}
  timer=setTimeout(poll,500);return()=>{cancelled=true;clearTimeout(timer);};
 },[active,initial.id,apply]);
 const post=useCallback(async(path:string,body:unknown)=>{
  setPending(true);setError('');
  try{const response=await fetch(`/api/ppt/projects/${project.id}/${path}?view=live`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.message||data.error||`HTTP ${response.status}`);if(alive.current&&data.project)apply(data.project);return data.project as PptProject;}
  catch(e){if(alive.current)setError((e as Error).message);return null;}finally{if(alive.current)setPending(false);}
 },[project.id,apply]);
 const written=c.phase==='page_plan_ready'||Boolean(c.writing)||project.outline.length>0;
 const write=async(withInstruction='')=>{const next=await post('planning',outlineRequest(project,form,withInstruction));if(next&&alive.current)setInstruction('');};
 const ready=c.phase==='page_plan_ready'&&Boolean(project.outlineAcceptance?.confirmable)&&project.outline.length>0;
 const editable=ready&&!active&&project.status==='outline_ready';
 // Edits are saved a second after the last change; new cards then get their IDs.
 const flush=useCallback(async():Promise<PptProject|null>=>{
  if(saving.current)await saving.current;
  const sent=latest.current;setSave('saving');
  const run=(async()=>{
   try{const response=await fetch(`/api/ppt/projects/${project.id}/planning`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'edit',semanticRevision:c.semanticRevision,cards:cardEditOps.payload(sent)})});const data=await response.json();if(!response.ok)throw Error(data.message||data.error||`HTTP ${response.status}`);
    const next=data.project as PptProject,ids=new Map(sent.map((card,index)=>[card.key,next.outline[index]?.id]));
    if(alive.current){setProject(next);setEdits(current=>current.map(card=>card.id?card:{...card,id:ids.get(card.key)}));setSave(latest.current===sent?'saved':'dirty');setError('');}
    return next;
   }catch(e){if(alive.current){setError((e as Error).message);setSave('dirty');}return null;}
  })();
  saving.current=run;const result=await run;saving.current=null;return result;
 },[project.id,c.semanticRevision]);
 useEffect(()=>{if(save!=='dirty'||!editable)return;const timer=setTimeout(()=>void flush(),1000);return()=>clearTimeout(timer);},[save,edits,editable,flush]);
 const change=(next:PptCardEdit[],focusKey?:string,select=false)=>{setEdits(next);setSave('dirty');if(focusKey)focus.current={key:focusKey,select};};
 useEffect(()=>{if(focus.current){const field=fields.current.get(focus.current.key);field?.focus();if(focus.current.select)field?.select();field?.scrollIntoView({block:'nearest'});focus.current=null;}},[edits]);
 const field=(key:string)=>(element:HTMLTextAreaElement|null)=>{if(element)fields.current.set(key,element);else fields.current.delete(key);};
 const dragged=useRef<number|null>(null);
 const cards=editable?edits:outlineCards(project);
 const changed=written&&!sameSettings(form,settingsFrom(project));
 const disabled=active||pending||busy;
 const invalid=edits.some(card=>!card.title.trim());
 // The first reason the generate button waits (it shows beside the button).
 const blocked=changed?'ppt.cards.generateBlocked.settings':invalid?'ppt.cards.generateBlocked.title':save==='saving'?'ppt.cards.generateBlocked.saving':unresolvedSourceWarnings(project).length?'ppt.cards.generateBlocked.warnings':null;
 async function generate(){const next=save==='idle'||save==='saved'?project:await flush();if(next&&alive.current)onGenerate(next);}
 const settingsForm=<SettingsForm form={form} onChange={setForm} settings={c.settings} templates={templates} disabled={disabled} keepTemplate={project.templateContentMode==='keep_fixed'} compact={written||active}/>;
 return <section data-testid="ppt-card-outline" className="ppt-prototype fixed inset-0 z-50 flex flex-col bg-background text-foreground">
  <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
   <strong>{t('ppt.cards.title')}</strong>
   {project.model&&<span data-testid="ppt-card-model" className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{t('ppt.cards.model')} · {project.model}</span>}
   <span className="ml-auto"/>
   {editable&&save!=='idle'&&<span className="text-xs text-muted-foreground" role="status">{t(save==='saved'?'ppt.cards.saved':'ppt.cards.saving')}</span>}
   <button className={button} disabled={pending||save==='saving'} onClick={async()=>{if(save==='dirty')await flush();onClose();}}>{t('ppt.edit.close')}</button>
  </header>
  {modelsLoading&&<p role="status" className="shrink-0 border-b border-border px-4 py-2 text-sm">{t('ppt.quality.modelsLoading')}</p>}
  {modelsError&&<div data-testid="ppt-card-model-error" role="alert" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-destructive/40 bg-background px-4 py-2 text-sm"><p title={modelsError}>{t('ppt.quality.modelsLoadError')}</p><button type="button" className={button} disabled={modelsLoading} onClick={onRetryModels}>{t('ppt.quality.reloadModels')}</button></div>}
  <div className="min-h-0 flex-1 overflow-auto">
   <div className="mx-auto grid w-full max-w-6xl items-start gap-6 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <main className="min-w-0 space-y-4">
     {error&&<div role="alert" className="flex items-center gap-3 rounded-lg border border-destructive p-3 text-sm"><span className="flex-1">{error}</span>{project.status==='failed'&&<button className={button} disabled={disabled} onClick={()=>void post('retry',{})}>{t('ppt.cards.retry')}</button>}</div>}
     {Boolean(project.runtimeWarnings?.length)&&<div role="status" data-testid="ppt-runtime-warnings" className="rounded-lg border border-border bg-muted/40 p-3 text-sm"><strong>{t('ppt.runtime.warning')}</strong><ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{project.runtimeWarnings!.map(warning=><li key={warning.code}>{warning.message}</li>)}</ul></div>}
     <PptSourceWarnings project={project} onProject={next=>setProject(current=>({...current,...next,planningContract:next.planningContract||current.planningContract}))}/>
     {!written&&!active?<>
      {settingsForm}
      <div className="flex justify-end"><button data-testid="ppt-card-write" className={primary} disabled={disabled||modelsLoading||Boolean(modelsError)} onClick={()=>void write()}>{t('ppt.cards.writeOutline')}</button></div>
     </>:<>
      {active&&<p data-testid="ppt-card-writing" role="status" className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm"><span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"/>{formingStatus(project,t)||<>{t('ppt.cards.writing')}{c.writing?` · ${t('ppt.cards.lengthPages',{n:c.writing.pages})}`:''}</>}</p>}
      {ready&&!active&&c.summary&&<SummaryMessage summary={c.summary}/>}
      <ol data-testid="ppt-card-list" className="space-y-3">{cards.map((card,index)=>{
       const pendingCard='pending' in card&&card.pending,edit=editable?card as PptCardEdit:null;
       return <li key={card.key} id={`ppt-card-page-${index+1}`} className="group flex gap-3" data-pending={pendingCard?'':undefined} data-frame={card.frame} draggable={Boolean(edit&&index>0)}
        onDragStart={()=>{dragged.current=index;}} onDragOver={event=>{if(edit&&index>0&&dragged.current!==null)event.preventDefault();}} onDrop={event=>{event.preventDefault();if(dragged.current!==null)change(cardEditOps.move(edits,dragged.current,index));dragged.current=null;}}>
        <span className={`mt-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs text-muted-foreground ${edit&&index>0?'cursor-grab':''}`} title={edit&&index>0?t('ppt.cards.drag'):undefined}>{index+1}</span>
        <article className={`min-w-0 flex-1 rounded-xl border p-4 ${card.frame==='divider'?'border-primary/40 bg-primary/5':'border-border bg-card'}`}>
         {pendingCard?<div className="space-y-2">{card.title?<h3 className="text-base font-semibold text-muted-foreground">{card.title}</h3>:<div aria-hidden className="h-4 w-2/3 animate-pulse rounded bg-muted"/>}<div className="h-3 w-full animate-pulse rounded bg-muted"/><div className="h-3 w-5/6 animate-pulse rounded bg-muted"/></div>:edit?<>
          <FrameTag frame={edit.frame} cover={index===0}/>
          <div className="flex items-start gap-2">
           <Grow inputRef={field(card.key+':title')} label={t('ppt.cards.cardTitle')} placeholder={t('ppt.cards.cardTitle')} className="text-base font-semibold" value={edit.title} onChange={value=>change(edits.map((item,i)=>i===index?{...item,title:value}:item))}/>
           <div className="flex shrink-0 gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {index>0&&<button className={tool} aria-pressed={edit.numbered} title={t('ppt.cards.numbered')} onClick={()=>change(edits.map((item,i)=>i===index?{...item,numbered:!item.numbered}:item))}>1.</button>}
            {index>0&&<button className={tool} disabled={index<2} aria-label={t('dashboard.moveUp')} title={t('dashboard.moveUp')} onClick={()=>change(cardEditOps.move(edits,index,index-1))}>↑</button>}
            {index>0&&<button className={tool} disabled={index===edits.length-1} aria-label={t('dashboard.moveDown')} title={t('dashboard.moveDown')} onClick={()=>change(cardEditOps.move(edits,index,index+1))}>↓</button>}
            {index>0&&<button className={tool} disabled={edits.length<=2} aria-label={t('ppt.cards.delete')} title={t('ppt.cards.delete')} onClick={()=>change(cardEditOps.remove(edits,index))}>✕</button>}
           </div>
          </div>
          {edit.subtitle&&<p className="text-sm text-muted-foreground">{edit.subtitle}</p>}
          {index>0&&<ol className={`mt-2 space-y-1 pl-5 text-sm ${edit.numbered?'list-decimal':'list-disc'}`}>{edit.points.map((point,k)=><li key={k}>
           <input data-testid="ppt-card-heading" aria-label={t('ppt.cards.heading')} placeholder={t('ppt.cards.heading')} maxLength={40} className="block w-full bg-transparent text-xs font-semibold text-primary outline-none placeholder:font-normal placeholder:text-muted-foreground/60 focus:rounded focus:bg-muted/40" value={edit.labels?.[k]||''}
            onChange={event=>change(cardEditOps.heading(edits,index,k,event.target.value))}/>
           <Grow inputRef={field(`${card.key}:${k}`)} label={t('ppt.cards.point')} placeholder={t('ppt.cards.point')} className="text-sm" value={point}
            onChange={value=>change(cardEditOps.point(edits,index,k,value))}
            onKeyDown={event=>{
             if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();change(cardEditOps.insertPoint(edits,index,k),`${card.key}:${k+1}`);}
             else if(event.key==='Backspace'&&!point&&edit.points.length>1){event.preventDefault();change(cardEditOps.removePoint(edits,index,k),k?`${card.key}:${k-1}`:`${card.key}:title`);}
            }}/></li>)}</ol>}
          {index>0&&!edit.points.length&&!('figurePage' in card&&card.figurePage)&&<button className={tool} onClick={()=>change(cardEditOps.insertPoint(edits,index,-1),`${card.key}:0`)}>+ {t('ppt.cards.point')}</button>}
          {'figures' in card&&card.figures&&<Figures figures={card.figures}/>}
         </>:<>
          <FrameTag frame={card.frame} cover={index===0}/>
          <h3 className="text-base font-semibold">{card.title}{card.subtitle&&<span className="ml-2 font-normal text-muted-foreground">{card.subtitle}</span>}</h3>
          {card.points.length>0&&(card.numbered?<ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{card.points.map((point,k)=><li key={k}><Label label={card.labels?.[k]}/>{point}</li>)}</ol>:<ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{card.points.map((point,k)=><li key={k}><Label label={card.labels?.[k]}/>{point}</li>)}</ul>)}
          {'figures' in card&&card.figures&&<Figures figures={card.figures}/>}
         </>}
         {(c.sourceNotes||[]).filter(note=>note.pageId===card.key&&!note.resolved).map(note=><SourceNote key={`${note.key}:${note.pointIndex}`} note={note} disabled={disabled}
          onEdit={edit&&note.pointIndex!==null?()=>{const target=fields.current.get(`${card.key}:${note.pointIndex}`);target?.focus();target?.scrollIntoView({block:'nearest'});}:undefined}
          onKeep={()=>void post('source-warnings',{keys:[note.key],reason:t('ppt.create.sourceWarnings.keepReason')})}/>)}
        </article>
       </li>;})}</ol>
      {editable&&<button data-testid="ppt-card-add" className={`${tool} ml-10`} disabled={edits.length>=100} onClick={()=>{const next=cardEditOps.add(edits,edits.length-1,t('ppt.cards.newCard')),added=next.find(card=>!edits.includes(card));change(next,added&&added.key+':title',true);}}>+ {t('ppt.cards.add')}</button>}
     </>}
    </main>
    <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:overscroll-contain">
     {written||active?<>
      {settingsForm}
      <section data-testid="ppt-card-instruction" className="space-y-2 rounded-xl border border-border bg-card p-4">
       <label className="block space-y-2 text-sm"><span className="font-medium">{t('ppt.cards.instruction')}</span>
        <textarea data-testid="ppt-card-instruction-text" className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" maxLength={2000} disabled={disabled} placeholder={t('ppt.cards.instructionPlaceholder')} value={instruction} onChange={event=>setInstruction(event.target.value)}/></label>
       <button data-testid="ppt-card-rewrite" className={`${button} w-full`} disabled={disabled||(!changed&&!instruction.trim())} onClick={()=>void write(instruction)}>{t('ppt.cards.rewriteWith')}</button>
      </section>
     </>:null}
     {c.settings?.brief?<BriefPanel project={project}/>:<SourcePanel structure={c.structure}/>}
    </aside>
   </div>
  </div>
  <footer data-testid="ppt-card-actions" className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3">
   {Boolean(c.uncoveredSources)&&<span className="mr-auto text-sm text-muted-foreground" data-testid="ppt-card-omitted">{t('ppt.cards.omitted',{n:c.uncoveredSources!})}</span>}
   {ready&&<span className="text-sm text-muted-foreground">{t('ppt.cards.total',{n:cards.length})}</span>}
   {/* Why the button waits, so a disabled button is never a riddle. */}
   {ready&&blocked&&<span role="status" data-testid="ppt-card-generate-blocked" className="text-sm text-muted-foreground">{t(blocked)}</span>}
   {/* A refused generate says why beside its button, with the pages it names (3197, 2026-11-03: it read as a dead button). */}
   {submitRefusal&&!busy&&<div role="alert" data-testid="ppt-card-generate-refused" className="mr-auto flex max-w-2xl flex-wrap items-center gap-2 text-sm text-destructive"><span>{pptFailureMessage(submitRefusal.message,locale)}</span>{submitRefusal.pages.map(page=><button key={page} type="button" className={button} onClick={()=>{const card=document.getElementById(`ppt-card-page-${page}`);card?.scrollIntoView({block:'center',behavior:'smooth'});card?.querySelector<HTMLTextAreaElement|HTMLInputElement>('textarea, input')?.focus({preventScroll:true});}}>{t('ppt.outline.goToPage',{page})}</button>)}</div>}
   <button data-testid="ppt-card-generate" className={`${primary.replace('px-4','pl-3 pr-4')} inline-flex items-center gap-1.5`} disabled={disabled||!ready||Boolean(blocked)||modelsLoading||Boolean(modelsError)} onClick={()=>void generate()}><AiSparkleIcon/>{t('ppt.cards.generate')}</button>
  </footer>
 </section>;
}
