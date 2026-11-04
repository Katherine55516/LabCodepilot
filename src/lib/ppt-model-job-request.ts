import http from 'node:http';
import https from 'node:https';

/** A retry bypasses the fetch pool entirely; Connection:close alone can still
 * select an already closed pooled socket. This request owns its new socket. */
export async function pptModelJobRequest(url:string,init:Omit<RequestInit,'body'>&{body?:string},{freshConnection=false}={}) {
  if(!freshConnection)return fetch(url,init);
  const target=new URL(url),request=target.protocol==='https:'?https.request:http.request;
  return new Promise<Response>((resolve,reject)=>{
    const headers=Object.fromEntries(new Headers(init.headers).entries());
    const req=request(target,{method:init.method,headers,agent:false,signal:init.signal??undefined},res=>{
      const chunks:Buffer[]=[];
      res.on('data',chunk=>chunks.push(Buffer.from(chunk)));
      res.on('error',reject);
      res.on('end',()=>{const headers=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)headers.append(res.rawHeaders[i],res.rawHeaders[i+1]);const status=res.statusCode||502;resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks).toString('utf8'),{status,headers}));});
    });
    req.on('error',reject);
    req.end(init.body);
  });
}
