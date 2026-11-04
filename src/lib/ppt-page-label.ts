import type {PptProject} from '@/components/ppt/types';
export function pptPageLabel(project:PptProject,locale:string,kind:'file'|'detail'|'task'='detail'){
 const en=locale==='en',hk=locale==='zh-HK',counts=project.pageCounts;
 const published=counts?.published??(project.status==='completed'?(project.deck?.slides.length||project.pages):null);
 const draft=counts?.draft??project.deck?.slides.length??0;
 const unit=en?'pages':hk?'頁':'页';
 if((kind==='file'||project.status==='completed')&&(published!==null||project.libraryEligible))return `${published??'…'} ${unit}${published!==null&&draft>0&&draft!==published?` · ${en?'draft':hk?'草稿':'草稿'} ${draft} ${unit}`:''}`;
 if(project.status==='input_ready')return `${en?'Input read · estimated':hk?'已讀取 · 建議':'已读取 · 建议'} ${project.inputUnderstanding?.recommended||project.pages} ${unit}`;
 if((project.planningPhase||project.planningContract?.phase)==='semantic_ready')return en?'Logical outline ready · capacity pending':hk?'邏輯大綱就緒 · 容量待規劃':'逻辑大纲就绪 · 容量待规划';
 if(project.status==='outline_ready')return `${project.outlineAcceptance?.confirmable===false?(en?'Outline needs revision':hk?'大綱待修訂':'大纲待修订'):(en?'Awaiting confirmation':hk?'待確認':'待确认')} ${counts?.planned||project.pages} ${unit}`;
 const confirmed=counts?.confirmed??(project.pageDecision?.confirmedAt||['generating','paused','quality_blocked'].includes(project.status)?project.pages:null);
 if(confirmed)return `${en?'Confirmed':hk?'已確認':'已确认'} ${confirmed} ${unit}`;
 if(project.pageDecision?.awaitingInputRead)return en?'Reading input · pages pending':hk?'正在讀取輸入 · 頁數待定':'正在读取输入 · 页数待定';
 return `${en?'Estimated':hk?'暫估':'暂估'} ${counts?.estimated??project.pages} ${unit}`;
}
export function pptTimelineLabel(stage:string,locale:string){
 const labels:Record<string,string>=locale==='en'?{created:'Project created',source:'Input read',outline:'Outline confirmed',content:'Content generated',layout:'Layout checked',quality:'Quality checked',publish:'Published'}:locale==='zh-HK'?{created:'項目已建立',source:'輸入已讀取',outline:'大綱已確認',content:'內容已生成',layout:'版式已檢查',quality:'品質已檢查',publish:'已發佈'}:{created:'项目已创建',source:'输入已读取',outline:'大纲已确认',content:'内容已生成',layout:'版式已检查',quality:'质量已检查',publish:'已发布'};
 return labels[stage]||stage;
}
export function pptRoleLabel(role:string|undefined,locale:string){
 return locale==='zh-HK'?role==='cover'?'封面':role==='navigation'?'目錄':['closing','conclusion','summary'].includes(role||'')?'總結':'內容頁':locale==='en'?role==='cover'?'Cover':role==='navigation'?'Contents':['closing','conclusion','summary'].includes(role||'')?'Conclusion':'Content':role==='cover'?'封面':role==='navigation'?'目录':['closing','conclusion','summary'].includes(role||'')?'总结':'内容页';
}
/** Total pages for a progress counter; an unread v2 seed is not a page count (E3). */
export function pptProgressTotal(project:Pick<PptProject,'pages'|'progress'|'pageDecision'>):number|string{
 return project.pageDecision?.awaitingInputRead?'…':project.progress?.total||project.pages;
}
