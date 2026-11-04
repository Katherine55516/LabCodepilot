/** Screen-space anchor for UTF-16 textarea offsets. This mirror is UI-only;
 * offsets always come from the original textarea, never the visible DOM. */
export function textareaSelectionRect(element:HTMLTextAreaElement,start:number,end:number):DOMRect {
 const rect=element.getBoundingClientRect(),computed=getComputedStyle(element),mirror=document.createElement('div');
 for(const property of ['font-family','font-size','font-weight','font-style','line-height','letter-spacing','word-spacing','padding','border','box-sizing','white-space','overflow-wrap','tab-size','text-indent','text-align'])mirror.style.setProperty(property,computed.getPropertyValue(property));
 Object.assign(mirror.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',left:rect.left+'px',top:(rect.top-element.scrollTop)+'px',width:rect.width+'px',height:'auto',overflow:'visible',transform:'none'});
 mirror.append(document.createTextNode(element.value.slice(0,start)));
 const selected=document.createElement('span');selected.textContent=element.value.slice(start,end);mirror.append(selected,document.createTextNode(element.value.slice(end)));document.body.append(mirror);
 const range=document.createRange();range.selectNodeContents(selected);const anchor=range.getClientRects()[0]||rect;
 const result=new DOMRect(anchor.x,anchor.y,anchor.width,anchor.height);mirror.remove();return result;
}
