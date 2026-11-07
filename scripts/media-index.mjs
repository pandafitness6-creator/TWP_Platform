// Read the JSON inside the canonical embedded resolver without executing app code.
export function readMediaIndex(html){
 const marker='window.PANDA_RESOLVE_ASSET=(()=>{const index=';
 const statementStart=html.indexOf(marker);
 if(statementStart<0)throw Error('Embedded media resolver missing.');
 const start=statementStart+marker.length;
 let depth=0,inString=false,escaped=false,end=-1;
 for(let i=start;i<html.length;i++){
  const c=html[i];
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"'){inString=true;continue;}
  if(c==='{'||c==='[')depth++;
  if((c==='}'||c===']')&&--depth===0){end=i+1;break;}
 }
 if(end<0)throw Error('Unterminated media index.');
 const statementEnd=html.indexOf('})();',end);
 if(statementEnd<0)throw Error('Unterminated embedded media resolver.');
 return {index:JSON.parse(html.slice(start,end)),start,end,statementStart,statementEnd:statementEnd+5};
}
