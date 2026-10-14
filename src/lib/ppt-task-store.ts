import type {PptProject} from '@/components/ppt/types';
const EMPTY:PptProject[]=[];let tasks=EMPTY,ready=false,epoch=0,issued=0,committed=0;const listeners=new Set<()=>void>();
export type PptSummaryRequest={epoch:number;sequence:number};
const notify=()=>{for(const listener of listeners)listener();};
export const pptTaskStore={
 subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
 getSnapshot:()=>tasks,getServerSnapshot:()=>EMPTY,isReady:()=>ready,
 beginRequest:():PptSummaryRequest=>({epoch,sequence:++issued}),
 isCurrent:(request:PptSummaryRequest)=>request.epoch===epoch,
 set:(next:PptProject[],request?:PptSummaryRequest)=>{
  if(!Array.isArray(next))throw new Error("Invalid PPT summary snapshot");
  const ticket=request||{epoch,sequence:++issued};
  if(ticket.epoch!==epoch||ticket.sequence<committed)return false;
  committed=ticket.sequence;tasks=next;ready=true;notify();return true;
 },
 clear:()=>{epoch++;committed=++issued;tasks=EMPTY;ready=false;notify();},
};
