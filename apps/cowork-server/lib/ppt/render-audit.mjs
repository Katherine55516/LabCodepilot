import { measureText, textContract, CODE_FONT_FLOOR_PT, CARD_PADDING } from './render-contract.mjs';
import { classifyCollision } from './render-collision.mjs';
function textFitEstimate(element) { return measureText(element); }
const validBounds = b => b && ['x','y','width','height'].every(k=>Number.isFinite(b[k])) && b.width>0 && b.height>0;

export function renderIssues(tree) {
  const issues = [];
  for (const slide of tree.slides) {
    const editable = slide.elements.filter(element => !element.hidden && element.style?.opacity !== 0 && validBounds(element.bounds));
    for (let i = 0; i < editable.length; i++) for (let j = i + 1; j < editable.length; j++) {
      const collision=classifyCollision(editable[i],editable[j]);
      if (['collision','occlusion'].includes(collision.status)) issues.push({
        code: 'render_overlap', severity: 'error', message: `${editable[i].id} 与 ${editable[j].id} 可见内容重叠`,
        slideId: slide.id, nodeIds: [editable[i].nodeId, editable[j].nodeId].filter(Boolean), repairable: true,
        basis:collision.basis,
      });
      else if(collision.status==='unresolved')issues.push({code:'render_overlay_unresolved',severity:'warning',slideId:slide.id,nodeIds:[editable[i].nodeId,editable[j].nodeId].filter(Boolean),basis:collision.basis,repairable:false,message:'Overlapping native/artwork regions require actual exported-render inspection.'});
    }
    for (const element of slide.elements.filter(element=>element.nodeId)) {
      const b = element.bounds;
      if(!validBounds(b)) {
        issues.push({code:'render_geometry_invalid',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:true,message:'Visible object requires finite positive frame dimensions.'});
        continue;
      }
      if (b.x < 0 || b.y < 0 || b.x + b.width > slide.size.width || b.y + b.height > slide.size.height) {
        issues.push({ code: 'render_overflow', severity: 'error', message: `${element.id} 超出页面边界`, slideId: slide.id, nodeIds: [element.nodeId].filter(Boolean), repairable: true });
      }
      if(element.mathLayout?.overflow)issues.push({code:'math_layout_capacity',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],overflowPt:Math.max(element.mathLayout.widthPt-b.width/12700,element.mathLayout.heightPt-b.height/12700),repairable:false,message:'Equation exceeds its available frame; re-layout without deleting terms.'});
      if(element.kind==='chart'&&element.content?.chartType==='unsupported')issues.push({code:'chart_rendering_unsupported',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,message:'Native chart type requires a supported representation before new publication.'});
      if (element.kind==='chart' && !element.chartLayout?.valid && element.content?.values) issues.push({code:'chart_data_invalid',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,message:'Chart requires finite matched values and valid non-negative pie data.'});
      if (element.kind==='image' && element.imageLayout?.valid===false) issues.push({code:'image_crop_invalid',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,message:'Image crop has invalid bounds.'});
      if (element.kind==='table' && element.content?.rows) {
        const rows=element.content.rows, cols=rows[0]?.length || 0;
        if (!cols || rows.some(row=>row.length!==cols)) issues.push({code:'table_matrix_invalid',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,message:'Table must retain a rectangular matrix.'});
        else {
          if(!element.nativeRef && rows.length>1 && rows[0].some((cell,c)=>c===cols-1&&cols>2&&!String(cell).trim()&&rows.slice(1).some(row=>String(row[c]).trim())))issues.push({code:'table_column_identity_missing',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,message:'A populated generated table column needs an explicit identity; blank columns cannot receive displaced cells.'});
          const cw=element.content.columnWeights || Array(cols).fill(1),rw=element.content.rowWeights || Array(rows.length).fill(1);
          if(cw.length!==cols || rw.length!==rows.length || [...cw,...rw].some(v=>typeof v!=='number'||!Number.isFinite(v)||v<=0)) {
            issues.push({code:'table_weights_invalid',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,message:'Table row/column weights must match the matrix and be finite positive values.'});
            continue;
          }
          const cs=cw.reduce((a,b)=>a+b,0),rs=rw.reduce((a,b)=>a+b,0);
          rows.forEach((row,i)=>row.forEach((cell,j)=>{
            const e={kind:'text',content:{text:String(cell)},style:{...element.style,lineHeight:1.18,paragraphSpacingEm:0},bounds:{width:b.width*cw[j]/cs,height:b.height*rw[i]/rs}};
            const contract=textContract(e,[7.2,3,7.2,3]),fit=measureText(e,contract);
            if(fit.overflow)issues.push({code:'table_cell_capacity',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,details:{row:i,column:j,...fit},message:'Table cell exceeds visible capacity; reflow or split without deleting cells.'});
          }));
        }
      }
      const prose = ['list', 'timeline', 'metric'].includes(element.kind) ||
        (element.kind === 'text' && !['eyebrow', 'subtitle', 'takeaway', 'title', 'page-number'].includes(element.semanticRole));
      // Monospace listings/drawings have their own measured floor (P0-3).
      // A card deck's continuation explanation (13/12 pt) and a formula's
      // brace legend (12 pt) are decided sizes, body − 2 at most (Fable r19 D/H).
      // A figure's caption on a crowded page is decided the same way (Fable F4/E3, 2026-10-27).
      const decided = ['continuation_font_ladder', 'formula_legend', 'figure_caption'].includes(element.style?.fontBasis);
      const minimumPt = element.content?.codeBlock ? CODE_FONT_FLOOR_PT : decided ? 12 : 14;
      // A source table may step down to 11 pt to read whole on one page, never below (Fable 2026-10-25).
      if (element.kind === 'table' && !element.nativeRef && Number(element.style?.fontSizePt || 0) > 0 && Number(element.style.fontSizePt) < 11)
        issues.push({ code: 'minimum_font_size', severity: 'error', message: `${element.id} 表格字号低于 11pt`, slideId: slide.id, nodeIds: [element.nodeId].filter(Boolean), repairable: true });
      if (!element.nativeRef && prose && Number(element.style?.fontSizePt || 0) < minimumPt) {
        issues.push({ code: 'minimum_font_size', severity: 'error', message: `${element.id} 字号低于 ${minimumPt}pt`, slideId: slide.id, nodeIds: [element.nodeId].filter(Boolean), repairable: true });
      }
      if (['text', 'list', 'timeline', 'metric'].includes(element.kind) && !element.content?.mathMl) {
        if (element.kind === 'list' && element.content?.pointLayout) {
          const layout=element.content.pointLayout;
          for(const [index,item] of (element.content.items||[]).entries()) {
            const box=layout.boxes?.[index],font=Number(layout.fontSizePt),headingFont=Number(layout.headingFontSizePt||font);
            if(!box||![box.x,box.y,box.w,box.h].every(Number.isFinite)||box.x<0||box.y<0||box.w<=0||box.h<=0||box.x+box.w>1.001||box.y+box.h>1.001) {issues.push({code:'component_label_geometry',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,details:{itemId:item.id},message:'A component label lies outside its final parent frame.'});continue;}
            if(!element.nativeRef&&(!Number.isFinite(font)||font<minimumPt||headingFont<minimumPt))issues.push({code:'component_effective_font',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,details:{itemId:item.id,fontSizePt:font,headingFontSizePt:headingFont,minimumPt},message:'Final component label font is below its readable floor.'});
            const rawParts=String(item.text||'').split('\n'),heading=item.heading||item.body?item.heading||'':rawParts.length>1?rawParts.shift():'',body=item.heading||item.body?item.body||'':rawParts.join('\n');
            const e={kind:'text',bounds:{width:b.width*box.w,height:b.height*box.h},style:{...element.style,fontSizePt:font,lineHeight:1.18,paragraphSpacingEm:0},content:{text:layout.inlineHeading&&heading?heading+'　'+body:body}};
            const contract=textContract(e,CARD_PADDING);
            if(heading&&!layout.inlineHeading)contract.paragraphs=[{text:heading,lineHeight:1.18,spaceAfterPt:3,runs:[{text:heading,fontSizePt:headingFont,bold:true}]},...contract.paragraphs];
            const fit=measureText(e,contract);
            if(fit.overflow)issues.push({code:'component_label_capacity',severity:'error',slideId:slide.id,nodeIds:[element.nodeId],repairable:false,details:{itemId:item.id,...fit},message:'A child label exceeds its final measured frame; reflow the component without dropping text.'});
          }
          if (element.content.pointLayout.overflow) issues.push({
            code: 'point_layout_capacity', severity: 'error',
            message: `${element.id} 的要点超过固定页容量；请缩短、换版式或拆页`,
            slideId: slide.id, nodeIds: [element.nodeId].filter(Boolean), repairable: false,
            details: { points: element.content.items?.length || 0, fontSizePt: element.content.pointLayout.fontSizePt,
              suggestedSplitCount: element.content.pointLayout.suggestedSplitCount },
          });
          continue;
        }
        const spacing = Number(element.style?.lineHeight || 1.12);
        if (spacing < .95) issues.push({ code: 'typography_too_compact', severity: 'warning',
          message: `${element.id} 行距低于 0.95，建议调整以便阅读`, slideId: slide.id,
          nodeIds: [element.nodeId].filter(Boolean), repairable: false });
        const fit = textFitEstimate(element);
        if (fit.overflow) issues.push({
          code: ['title','template-title'].includes(element.semanticRole)?'rendered_title_capacity':'typography_capacity', severity: 'error',
          message: ['title','template-title'].includes(element.semanticRole)?`${element.id} 标题超过实际文本框容量；保字号，改写完整短标题或明确报告锁定冲突`:`${element.id} 正文估计超过文本框容量，应先重组内容或版式`, slideId: slide.id,
          nodeIds: [element.nodeId].filter(Boolean), details: {...fit,nodeRole:element.semanticRole||'body',pageIndex:slide.index,fontSizePt:element.style?.fontSizePt,lineHeight:element.style?.lineHeight,bounds:element.bounds,measurement:'render_text_contract',units:'emu'}, repairable: !element.locked,
        });
      }
    }
  }
  return issues;
}
