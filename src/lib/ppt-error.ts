/** Keep actionable failures visible; raw protocol diagnostics belong in reports. */
export function pptFailureMessage(value:string,locale='zh'){
 const en=locale==='en',hk=locale==='zh-HK';
 const known = (code:string) => new RegExp('(?:ppt_|PPT model failure: )'+code+'(?:\\b|$)').test(value);
 const messages:Record<string,[string,string,string]> = {
  request_invalid:['模型服务拒绝了生成请求（HTTP 400）。请求格式或参数不被接受；已有输入与进度已保留。','模型服務拒絕了生成請求（HTTP 400）。請求格式或參數不被接受；已有輸入與進度已保留。','The model service rejected the request (HTTP 400): its format or parameters were not accepted. Input and progress are retained.'],
  timeout:['模型请求超时。已有大纲和成功页面已保留，可重试当前失败步骤。','模型請求逾時。已有大綱和成功頁面已保留，可重試目前失敗步驟。','The model request timed out. The outline and completed pages are retained; retry the failed step.'],
  rate_limit:['模型服务限流（HTTP 429）。请稍后重试当前失败步骤。','模型服務限流（HTTP 429）。請稍後重試目前失敗步驟。','The model service rate limited the request (HTTP 429). Retry the failed step later.'],
  network:['无法连接模型服务。请检查网络或 API 地址后重试。','無法連線模型服務。請檢查網絡或 API 位址後重試。','Could not connect to the model service. Check the network or API address and retry.'],
  truncated_output:['模型输出达到长度上限，被截断，无法形成有效大纲或内容。已保留原输入与检查点，可重试或更换模型。','模型輸出達到長度上限而截斷。已保留原輸入與進度，可重試或更換模型。','The model output hit its length limit and was truncated. Input and checkpoints are retained; retry or change the model.'],
  empty_visible_output:['模型没有返回可用内容。请重试或更换模型；已有进度已保留。','模型沒有回傳可用內容。請重試或更換模型；已有進度已保留。','The model returned no usable content. Retry or change the model; progress is retained.'],
  invalid_json:['模型返回的数据格式无效，无法解析。请重试当前步骤；已有进度已保留。','模型回傳的資料格式無效，無法解析。請重試目前步驟；已有進度已保留。','The model returned invalid JSON. Retry the failed step; progress is retained.'],
  coverage_invalid:['大纲未通过重点覆盖、来源归属或重复核心消息检查。查看候选大纲中的具体问题，重试时只修复失败范围。','大綱未通過重點覆蓋、來源歸屬或重複核心訊息檢查。請查看候選大綱的具體問題。','The outline failed coverage, source ownership or repeated-message checks. Review the candidate diagnostics; retry repairs the affected scope.'],
  capacity_invalid:['内容无法在所选页数和模板字号内完整排布。请增加页数或调整展示方式，已有来源与大纲保留。','內容無法在所選頁數和模板字號內完整排布。請增加頁數或調整展示方式。','The content cannot fit the selected page count and template type sizes. Increase the count or change the presentation options; source and outline are retained.'],
  input_budget:['输入超过模型请求容量。请使用支持更长上下文的模型或拆分输入。','輸入超過模型請求容量。請使用較長上下文模型或拆分輸入。','The input exceeds the model request budget. Use a longer-context model or split the input.'],
 };
 for(const [code,text] of Object.entries(messages))if(known(code))return text[en?2:hk?1:0];
 if(/source_artifact_capacity|planned_density_overflow|outline_confirmation_capacity|template.*capacity/.test(value))return en?'The content exceeds the readable capacity of the selected template. The source is retained; review its layout or content contract.':hk?'內容超出所選模板的可讀容量。來源已保留，請檢查排版或展示合同。':'内容超出所选模板的可读容量。来源已保留，请检查排版或展示合同。';
 if(/ppt_(?:transport|model_unavailable)|PPT model failure: (?:transport|model_unavailable)/.test(value))return en?'The model request did not complete. The task checkpoint is retained; retry or select an available model.':hk?'模型請求未完成。任務進度已保留，可重試或選擇可用模型。':'模型请求未完成。任务进度已保留，可重试或选择可用模型。';
 if(/ppt_auth|PPT model failure: auth/.test(value))return en?'Model authentication failed. Check the configured API credentials.':hk?'模型授權失敗，請檢查 API 設置。':'模型授权失败，请检查 API 设置。';
 if(/ppt_(?:schema_invalid|invalid_json|truncated_output|empty_visible_output)|ppt_content_selection_invalid|writer changed the confirmed outline title/.test(value))return en?'The model result has not passed the outline or content checks. No new PowerPoint has been published; the input and checkpoint are retained.':hk?'模型結果尚未通過大綱或內容檢查，未發布新的 PowerPoint；輸入及任務進度已保留。':'模型结果尚未通过大纲或内容检查，未发布新的 PowerPoint；输入及任务进度已保留。';
 return value;
}
