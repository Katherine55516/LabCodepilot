import {pptPromptFrame} from './ppt-prompt-contracts.mjs';
export function pptModelInput(prompt,images=[]) {
  if(!images.length)return {args:[],frame:pptPromptFrame(prompt)};
  if(images.length>4)throw new Error('Too many model images');
  const content=[{type:'text',text:prompt},...images.map(image=>{
    const match=image.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u);
    if(!match||image.dataUrl.length>6000000)throw new Error('Invalid model image');
    return {type:'image',source:{type:'base64',media_type:match[1],data:match[2]}};
  })];
  return {args:['--input-format','stream-json'],frame:pptPromptFrame(JSON.stringify({type:'user',message:{role:'user',content}})+'\n')};
}
