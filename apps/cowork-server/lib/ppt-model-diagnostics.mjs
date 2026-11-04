/** Wire input is untrusted. Never persist upstream messages, endpoints or bodies. */
export function safeModelDiagnostic(value){
 if(!value||typeof value!=='object')return {};
 const out={},enums={kind:['timeout','network','schema_validation','response_validation'],sdkName:['AI_TypeValidationError','TypeValidationError','AI_InvalidResponseDataError','InvalidResponseDataError','AI_APICallError','AI_NoObjectGeneratedError','AI_NoOutputGeneratedError','AI_UnsupportedFunctionalityError','AI_NoSuchModelError','TypeError','SyntaxError','AbortError','TimeoutError'],networkCode:['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'],origin:['queue','execution']};
 for(const [key,allowed]of Object.entries(enums))if(allowed.includes(value[key]))out[key]=value[key];
 if(Number.isInteger(value.httpStatus)&&value.httpStatus>=400&&value.httpStatus<=599)out.httpStatus=value.httpStatus;
 for(const key of ['elapsedMs','firstTokenMs','receivedChars'])if(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=86400000)out[key]=value[key];
 return out;
}
export function archiveModelFailure(project){
 if(project.failure){project.failureHistory=[...(project.failureHistory||[]).slice(-49),project.failure];delete project.failure;}
 project.error='';
}
