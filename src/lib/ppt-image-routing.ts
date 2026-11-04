/** Only configured, explicitly tiered image models participate in quality routing. */
export function selectPptImageModel(config:{model:string;models:{id:string;qualityTier?:1|2|3}[]},level?:string) {
  if(!level||level==='legacy_single_model')return config.model;
  if(!['fast','balanced','rigorous','legacy_single_model'].includes(level))throw new Error('Invalid image quality level');
  const target=level==='fast'?1:level==='rigorous'?3:2;
  const ranked=config.models.filter(model=>[1,2,3].includes(model.qualityTier||0)).sort((a,b)=>Math.abs(a.qualityTier!-target)-Math.abs(b.qualityTier!-target)||b.qualityTier!-a.qualityTier!);
  return ranked[0]?.id||config.model;
}
