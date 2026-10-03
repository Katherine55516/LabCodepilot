/** Editable display text for common TeX, retaining unsupported commands verbatim.
 * This is a notation adapter, not symbolic simplification or an OMML renderer. */
export function sourceDisplayText(text) {
  const math = value => {
    let result=value;
    for(let n=0;n<8;n++) {
      const next=result.replace(/\\(?:mathbf|mathrm|mathit|text|operatorname)\s*\{([^{}]*)\}/gu,'$1')
        .replace(/\\(?:frac|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/gu,'($1)/($2)');
      if(next===result)break;result=next;
    }
    const symbols={alpha:'α',beta:'β',gamma:'γ',mu:'μ',sigma:'σ',Sigma:'Σ',lambda:'λ',tau:'τ',epsilon:'ε',Delta:'Δ',propto:'∝',approx:'≈',times:'×',infty:'∞',sum:'∑',dots:'…',to:'→',Rightarrow:'⇒',Longrightarrow:'⇒',top:'T'};
    return result.replace(/\\([A-Za-z]+)(?![A-Za-z])/gu,(full,key)=>symbols[key] || (['quad','qquad','left','right','big'].includes(key)?' ':full))
      .replace(/\\[,;]/gu,' ').replace(/([_^])\{([^{}]*)\}/gu,'$1($2)');
  };
  return String(text||'').replace(/\$\$([\s\S]*?)\$\$/gu,(_,value)=>math(value)).replace(/(?<!\\)\$([^$\n]+)\$/gu,(_,value)=>math(value))
    .replace(/\\\[([\s\S]*?)\\\]/gu,(_,value)=>math(value)).replace(/\*\*|`/g,'').trim();
}
