/** A card icon as a recoloured PNG (Fable S2, 2026-11-01: PowerPoint shows an
 * embedded picture everywhere, an SVG not). An SVG path on the 256-unit icon
 * grid is flattened to polygons, filled with the SVG nonzero rule at four
 * times the size and box-filtered down, so edges are antialiased. Node only:
 * zlib for the PNG, no image library. */
import zlib from 'node:zlib';

const GRID=256,SUPER=4;
const NUMBER=/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu;
/** The polygons of a path (each subpath a closed list of [x, y] points). */
export function flattenPath(d){
 const tokens=String(d).match(NUMBER)||[],polygons=[];
 let at=0,command='',x=0,y=0,startX=0,startY=0,controlX=0,controlY=0,current=[];
 const next=()=>Number(tokens[at++]);
 const flag=()=>{const token=tokens[at];if(/^[01]{2,}/u.test(token)){tokens[at]=token.slice(1);return Number(token[0]);}at++;return Number(token);};
 const close=()=>{if(current.length>2)polygons.push(current);current=[];};
 const line=(nx,ny)=>{current.push([nx,ny]);x=nx;y=ny;};
 const cubic=(x1,y1,x2,y2,x3,y3)=>{for(let k=1;k<=16;k++){const t=k/16,u=1-t;current.push([u*u*u*x+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3,u*u*u*y+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3]);}controlX=x2;controlY=y2;x=x3;y=y3;};
 const quad=(x1,y1,x2,y2)=>{for(let k=1;k<=12;k++){const t=k/12,u=1-t;current.push([u*u*x+2*u*t*x1+t*t*x2,u*u*y+2*u*t*y1+t*t*y2]);}controlX=x1;controlY=y1;x=x2;y=y2;};
 // SVG arc: endpoint to centre parameterisation (SVG 1.1, F.6.5).
 const arc=(rx,ry,rotation,large,sweep,x2,y2)=>{
  rx=Math.abs(rx);ry=Math.abs(ry);if(!rx||!ry){line(x2,y2);return;}
  const phi=rotation*Math.PI/180,cos=Math.cos(phi),sin=Math.sin(phi);
  const dx=(x-x2)/2,dy=(y-y2)/2,x1p=cos*dx+sin*dy,y1p=-sin*dx+cos*dy;
  const lambda=x1p*x1p/(rx*rx)+y1p*y1p/(ry*ry);if(lambda>1){rx*=Math.sqrt(lambda);ry*=Math.sqrt(lambda);}
  const num=rx*rx*ry*ry-rx*rx*y1p*y1p-ry*ry*x1p*x1p,den=rx*rx*y1p*y1p+ry*ry*x1p*x1p;
  const coef=(large===sweep?-1:1)*Math.sqrt(Math.max(0,num/den));
  const cxp=coef*rx*y1p/ry,cyp=-coef*ry*x1p/rx,cx=cos*cxp-sin*cyp+(x+x2)/2,cy=sin*cxp+cos*cyp+(y+y2)/2;
  const angle=(ux,uy,vx,vy)=>{const a=Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);return a;};
  const start=angle(1,0,(x1p-cxp)/rx,(y1p-cyp)/ry);let delta=angle((x1p-cxp)/rx,(y1p-cyp)/ry,(-x1p-cxp)/rx,(-y1p-cyp)/ry);
  if(!sweep&&delta>0)delta-=2*Math.PI;else if(sweep&&delta<0)delta+=2*Math.PI;
  const steps=Math.max(4,Math.ceil(Math.abs(delta)/(Math.PI/16)));
  for(let k=1;k<=steps;k++){const t=start+delta*k/steps;current.push([cos*rx*Math.cos(t)-sin*ry*Math.sin(t)+cx,sin*rx*Math.cos(t)+cos*ry*Math.sin(t)+cy]);}
  x=x2;y=y2;
 };
 while(at<tokens.length){
  if(/[a-zA-Z]/u.test(tokens[at]))command=tokens[at++];
  const rel=command===command.toLowerCase(),C=command.toUpperCase();
  const ox=rel?x:0,oy=rel?y:0;
  if(C==='M'){close();x=next()+ox;y=next()+oy;startX=x;startY=y;current=[[x,y]];command=rel?'l':'L';}
  else if(C==='L')line(next()+ox,next()+oy);
  else if(C==='H')line(next()+ox,y);
  else if(C==='V')line(x,next()+oy);
  else if(C==='C'){const a=next()+ox,b=next()+oy,c=next()+ox,e=next()+oy,f=next()+ox,g=next()+oy;cubic(a,b,c,e,f,g);}
  else if(C==='S'){const a=2*x-controlX,b=2*y-controlY,c=next()+ox,e=next()+oy,f=next()+ox,g=next()+oy;cubic(a,b,c,e,f,g);}
  else if(C==='Q'){const a=next()+ox,b=next()+oy,c=next()+ox,e=next()+oy;quad(a,b,c,e);}
  else if(C==='T'){const a=2*x-controlX,b=2*y-controlY,c=next()+ox,e=next()+oy;quad(a,b,c,e);}
  else if(C==='A'){const rx=next(),ry=next(),rotation=next(),large=flag(),sweep=flag(),ex=next()+ox,ey=next()+oy;arc(rx,ry,rotation,large,sweep,ex,ey);}
  else if(C==='Z'){current.push([startX,startY]);x=startX;y=startY;close();current=[[x,y]];}
  else at++;
  if(!['C','S','Q','T'].includes(C)){controlX=x;controlY=y;}
 }
 close();
 return polygons;
}
/** Nonzero-rule coverage (0-255) of the polygons on a size×size grid. */
function coverage(polygons,size){
 const big=size*SUPER,scale=big/GRID,alpha=new Uint8Array(size*size);
 const edges=polygons.flatMap(points=>points.map((point,k)=>{const other=points[(k+1)%points.length];return [point[0]*scale,point[1]*scale,other[0]*scale,other[1]*scale];})).filter(([,y1,,y2])=>y1!==y2);
 const counts=new Uint16Array(size*size);
 for(let row=0;row<big;row++){
  const sy=row+.5,crossings=[];
  for(const [x1,y1,x2,y2] of edges){if((y1<=sy&&y2>sy)||(y2<=sy&&y1>sy))crossings.push([x1+(sy-y1)*(x2-x1)/(y2-y1),y2>y1?1:-1]);}
  crossings.sort((a,b)=>a[0]-b[0]);
  let winding=0;
  for(let k=0;k<crossings.length-1;k++){
   winding+=crossings[k][1];if(!winding)continue;
   const from=Math.max(0,Math.ceil(crossings[k][0]-.5)),to=Math.min(big-1,Math.floor(crossings[k+1][0]-.5));
   for(let col=from;col<=to;col++)counts[Math.floor(row/SUPER)*size+Math.floor(col/SUPER)]++;
  }
 }
 for(let k=0;k<counts.length;k++)alpha[k]=Math.round(counts[k]*255/(SUPER*SUPER));
 return alpha;
}
const CRC=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
const crc32=buffer=>{let c=-1;for(const byte of buffer)c=CRC[(c^byte)&255]^(c>>>8);return (c^-1)>>>0;};
const chunk=(type,data)=>{const head=Buffer.alloc(8);head.writeUInt32BE(data.length,0);head.write(type,4,'ascii');const tail=Buffer.alloc(4);tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4),data])),0);return Buffer.concat([head,data,tail]);};
/** A data URL of the icon in one colour on a transparent square. */
export function iconPng(paths,{size=192,color='#333333'}={}){
 const hex=/^#[0-9a-f]{6}$/iu.test(color)?color:'#333333',[r,g,b]=[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16));
 const alpha=coverage(paths.flatMap(flattenPath),size);
 const raw=Buffer.alloc(size*(size*4+1));
 for(let row=0;row<size;row++){raw[row*(size*4+1)]=0;for(let col=0;col<size;col++){const at=row*(size*4+1)+1+col*4,a=alpha[row*size+col];raw[at]=r;raw[at+1]=g;raw[at+2]=b;raw[at+3]=a;}}
 const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;header[10]=0;header[11]=0;header[12]=0;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
 return 'data:image/png;base64,'+png.toString('base64');
}
