/** A shared testing server cannot be restarted underneath another writer. */
export function assertPptServiceIdle(projects,{force=false,servicePid}={}) {
 if(force)return;
 if(!Array.isArray(projects))throw Error('无法确认 PPT 活动状态；没有停止服务。');
 const active=projects.filter(p=>!p.deletedAt&&(['ingesting','outlining','generating'].includes(p.status)||['reviewing','publishing'].includes(p.runtime?.publication?.phase)&&(!servicePid||p.runtime.publication.pid===servicePid)));
 if(active.length)throw Error('PPT 仍有 '+active.length+' 个活动任务，禁止普通 stop 中断它们：'+active.map(p=>p.id).join(', ')+'。请等待完成；仅在明确需要中断时使用 stop --force。');
}
