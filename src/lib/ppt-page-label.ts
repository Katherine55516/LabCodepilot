import type {PptProject} from '@/components/ppt/types';
export function pptPageLabel(project:PptProject,locale:string,kind:'file'|'detail'|'task'='detail'){
 const en=locale==='en',hk=locale==='zh-HK',counts=project.pageCounts;
 const published=counts?.published??(project.status==='completed'?(project.deck?.slides.length||project.pages):null);
 const draft=counts?.draft??project.deck?.slides.length??0;
 const unit=en?'pages':hk?'頁':'页';
 if((kind==='file'||project.status==='completed')&&(published!==null||project.libraryEligible))return `${published??'…'} ${unit}${published!==null&&draft>0&&draft!==published?` · ${en?'draft':hk?'草稿':'草稿'} ${draft} ${unit}`:''}`;
 const confirmed=counts?.confirmed??(project.pageDecision?.confirmedAt||['generating','paused','quality_blocked'].includes(project.status)?project.pages:null);
 if(confirmed)return `${en?'Confirmed':hk?'已確認':'已确认'} ${confirmed} ${unit}`;
 if(project.status==='outline_ready')return `${en?'Awaiting confirmation':hk?'待確認':'待确认'} ${counts?.planned||project.pages} ${unit}`;
 return `${en?'Estimated':hk?'暫估':'暂估'} ${counts?.estimated??project.pages} ${unit}`;
}
export function pptTimelineLabel(stage:string,locale:string){
 const labels:Record<string,string>=locale==='en'?{created:'Project created',source:'Input read',outline:'Outline confirmed',content:'Content generated',layout:'Layout checked',quality:'Quality checked',publish:'Published'}:locale==='zh-HK'?{created:'項目已建立',source:'輸入已讀取',outline:'大綱已確認',content:'內容已生成',layout:'版式已檢查',quality:'品質已檢查',publish:'已發佈'}:{created:'项目已创建',source:'输入已读取',outline:'大纲已确认',content:'内容已生成',layout:'版式已检查',quality:'质量已检查',publish:'已发布'};
 return labels[stage]||stage;
}
export function pptRoleLabel(role:string|undefined,locale:string){
 return locale==='zh-HK'?role==='cover'?'封面':role==='navigation'?'目錄':['closing','conclusion','summary'].includes(role||'')?'總結':'內容頁':locale==='en'?role==='cover'?'Cover':role==='navigation'?'Contents':['closing','conclusion','summary'].includes(role||'')?'Conclusion':'Content':role==='cover'?'封面':role==='navigation'?'目录':['closing','conclusion','summary'].includes(role||'')?'总结':'内容页';
}
