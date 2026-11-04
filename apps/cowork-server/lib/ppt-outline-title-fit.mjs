import {inspectOutlineTopicLanguages,topicRangeConstraint}from './ppt-topic-title-validation.mjs';
import {copyBudgetFor,visualUnits,formatUserDeckTitle} from './ppt-presentation-writing.mjs';
import {buildSlideRenderTree} from './ppt/render-tree.mjs';
import {measureText} from './ppt/render-contract.mjs';
import {contentCanvas} from './ppt-density-capacity.mjs';
import {deckLanguageName,deckLanguage} from './ppt-presentation-contract.mjs';
/** Measure the same system header/style as preview/export before freezing the
 * topic. Reserve the real body canvas, rather than borrowing space from it.
 * Only metadata is repaired; original headings and sources stay immutable. */
export function inspectSystemOutlineTitles(project,outline=project.outline||[],planning=project.planning){
 const languageIssues=inspectOutlineTopicLanguages(project,outline);
 if(project.templateFidelity?.mode==='preserve'||project.externalPptx?.mode==='preserve')return [];
 const probe={...project,outline,deck:{...project.deck,slides:outline.map((slide,index)=>{
   const canvas=contentCanvas({...project,outline},index);
   return {...slide,id:slide.id||'title-probe-'+index,nodes:[
    {id:'title-probe-'+index+'-text',type:'text',semanticRole:'title',content:{text:slide.title}},
    {id:'title-probe-'+index+'-body',type:'shape',semanticRole:'source-body-reservation',geometry:canvas.geometry,content:{shape:'rect'}}
   ]};
 })}};
 const capacityIssues=probe.deck.slides.flatMap((slide,pageIndex)=>{
  const scene=buildSlideRenderTree(probe,slide.id),title=scene?.elements.find(element=>element.semanticRole==='title');
  if(!title)return [];
  const measured=measureText(title),contract=planning?.slidePlan?.find(plan=>plan.slideId===slide.id);
  const budget=contract?.copyBudget||copyBudgetFor(slide.role,scene.layoutId,deckLanguage(project));
  const userCover=pageIndex===0&&project.deckTitle?.source==='user';
  // A cover's title is measured at its stepped size (coverTitlePt), not held to the writer's budget.
  const used=visualUnits(slide.title),copyBlocked=userCover?!formatUserDeckTitle(slide.title,budget).fits:pageIndex>0&&used>budget.titleHardUnits;
  if(!measured.overflow&&!copyBlocked)return [];
  const font=Number(title.style.fontSizePt)||32,widthPt=title.bounds.width/12700;
  // Conservative guidance only; a revised candidate is always measured again
  // with its actual words and final template font before it can be confirmed.
  const recommendedMaxLength=Math.max(8,Math.min(80,Math.floor(widthPt/font*1.6)));
  return [{code:measured.overflow?'planned_system_title_overflow':'planned_system_title_copy_budget',severity:'error',pageIndex,field:'title',reason:measured.overflow?'system_title_capacity':'system_title_copy_budget',maxLength:160,recommendedMaxLength,...(!userCover?{capacityVisualUnits:budget.titleHardUnits,usedVisualUnits:used}:{}),
   requiredLanguages:[deckLanguageName(project)],...topicRangeConstraint(outline[pageIndex]),...(!project.confirmedOutline?{topicLanguage:deckLanguage(project)}:{}),fontSizePt:font,measuredLines:measured.lines,
   frame:{...title.bounds},message:`Page ${pageIndex+1} title exceeds its ${measured.overflow?font+'pt system header':'unchanged writer topic budget ('+budget.titleHardUnits+' visual units)'}. Shorten its source-supported topic before confirmation; keep complete original headings/content in source. No body overlap or font shrinking.`}];
 });
 const conflicts=[...capacityIssues];
 for(const languageIssue of languageIssues){
  const existing=conflicts.find(issue=>issue.pageIndex===languageIssue.pageIndex);
  if(existing)Object.assign(existing,{topicLanguage:languageIssue.topicLanguage,...topicRangeConstraint(outline[languageIssue.pageIndex]),message:existing.message+' '+languageIssue.message});
  else conflicts.push(languageIssue);
 }
 return conflicts;
}
