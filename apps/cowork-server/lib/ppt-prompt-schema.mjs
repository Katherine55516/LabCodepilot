/** Read only the complete embedded schema, allowing later repair diagnostics. */
export function promptSchema(prompt, marker) {
 if(!prompt.includes(marker))return undefined;
 const text=prompt.slice(prompt.lastIndexOf(marker)+marker.length).trimStart();
 if(text[0]!=='{')return undefined;
 let depth=0,quoted=false,escaped=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
  if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&--depth===0){try{return JSON.parse(text.slice(0,i+1));}catch{return undefined;}}
 }
 return undefined;
}
