/** The local execution route can fail before reaching the SDK (e.g. HTML 404). */
export async function pptModelJobError(response:Response){
 const body=await response.json().catch(()=>null);
 return typeof body?.error==='string'?body.error.slice(0,400):`PPT model execution failed (HTTP ${response.status})`;
}
