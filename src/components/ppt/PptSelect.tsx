"use client";
import {Children,isValidElement,type ReactNode} from "react";
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from "@/components/ui/select";
/** Application-rendered options keep font, scale and width consistent in
 * Chrome/Electron and on high-DPI displays; native OS menus bypass CSS. */
export function PptSelect({value,onValueChange,options,disabled,ariaLabel,className,id}:{value:string;onValueChange:(value:string)=>void;options:{value:string;label:ReactNode;disabled?:boolean}[];disabled?:boolean;ariaLabel?:string;className?:string;id?:string}){
 return <Select value={value} onValueChange={onValueChange} disabled={disabled}>
  <SelectTrigger id={id} aria-label={ariaLabel} className={`w-full min-w-0 text-sm ${className||""}`}><SelectValue/></SelectTrigger>
  <SelectContent position="popper" align="start" sideOffset={4} onEscapeKeyDown={event=>event.stopPropagation()} className="z-[110] min-w-0 w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-content-available-width)] text-sm">
   {options.map(option=><SelectItem key={option.value} value={option.value} data-ppt-option-value={option.value} disabled={option.disabled} className="min-w-0 text-sm"><span className="block min-w-0 max-w-full truncate">{option.label}</span></SelectItem>)}
  </SelectContent>
 </Select>;
}
/** Existing declarative options share the same app-rendered menu. */
export function PptSelectField({value,defaultValue,onValueChange,children,disabled,className,id,'aria-label':label}:{value?:string|number;defaultValue?:string|number;onValueChange:(value:string)=>void;children:ReactNode;disabled?:boolean;className?:string;id?:string;'aria-label'?:string}){
 const options:{value:string;label:ReactNode;disabled?:boolean}[]=[];
 const collect=(items:ReactNode)=>Children.forEach(items,child=>{
  if(!isValidElement<{value?:string|number;children?:ReactNode;disabled?:boolean}>(child))return;
  if(child.type==='option')options.push({value:String(child.props.value??'')||'__empty__',label:child.props.children,disabled:child.props.disabled});
  else if(child.props.children)collect(child.props.children);
 });collect(children);
 return <PptSelect value={String(value??defaultValue??'')||'__empty__'} onValueChange={next=>onValueChange(next==='__empty__'?'':next)} options={options} disabled={disabled} className={className} id={id} ariaLabel={label}/>;
}
