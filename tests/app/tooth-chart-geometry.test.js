const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../../website/app/app.js'),'utf8');
const ctx=vm.createContext({});
vm.runInContext(src.slice(src.indexOf('const TOOTH_LAYOUT='),src.indexOf('function dentalChartSvg(')),ctx);
const teeth=[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
function polygon(n){
 const p=vm.runInContext(`toothPosition(${n})`,ctx);
 const markup=vm.runInContext(`toothGlyphMarkup(${n})`,ctx);
 const d=markup.match(/class="tooth-svg-shape" d="([^"]+)"/)[1];
 const tokens=d.match(/[A-Za-z]|[-+]?(?:\d*\.)?\d+/g);
 let i=0,current,points=[];
 const point=()=>[Number(tokens[i++]),Number(tokens[i++])];
 while(i<tokens.length){
  const cmd=tokens[i++];
  if(cmd==='M'){current=point();points.push(current);}
  else if(cmd==='C'){
   const a=current,b=point(),c=point(),e=point();
   for(let j=1;j<=30;j++){const t=j/30,u=1-t;points.push([0,1].map(k=>u*u*u*a[k]+3*u*u*t*b[k]+3*u*t*t*c[k]+t*t*t*e[k]));}
   current=e;
  }else if(cmd!=='Z')throw Error(`Unsupported SVG command ${cmd}`);
 }
 const flip=markup.includes('transform="rotate(180)"')?-1:1;
 const r=p.rotation*Math.PI/180;
 return points.map(([x,y])=>{x*=p.scaleX*flip;y*=p.scaleY*flip;return [p.x+x*Math.cos(r)-y*Math.sin(r),p.y+x*Math.sin(r)+y*Math.cos(r)];});
}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
function pointSegment(p,a,b){const ab=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),ab)/(dot(ab,ab)||1)));return Math.hypot(p[0]-a[0]-t*ab[0],p[1]-a[1]-t*ab[1]);}
function inside(p,poly){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
const bounds=p=>[Math.min(...p.map(v=>v[0])),Math.max(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1])),Math.max(...p.map(v=>v[1]))];
function clearance(a,b){
 if(a.some(p=>inside(p,b))||b.some(p=>inside(p,a)))return -1;
 let gap=Infinity;
 for(const [p,q] of [[a,b],[b,a]])for(const point of p)for(let k=0;k<q.length;k++)gap=Math.min(gap,pointSegment(point,q[k],q[(k+1)%q.length]));
 return gap;
}
const polys=new Map(teeth.map(n=>[n,polygon(n)]));
// Check the transformed contours, not their rectangular click bounds.
test('tooth crown interiors never overlap',()=>{
 const bad=[];
 for(let i=0;i<teeth.length;i++)for(let j=i+1;j<teeth.length;j++){
  const a=polys.get(teeth[i]),b=polys.get(teeth[j]),aa=bounds(a),bb=bounds(b);
  if(aa[0]>bb[1]||bb[0]>aa[1]||aa[2]>bb[3]||bb[2]>aa[3])continue;
  if(clearance(a,b)<0)bad.push([teeth[i],teeth[j]]);
 }
 assert.deepEqual(bad,[],`Overlapping crowns: ${JSON.stringify(bad)}`);
});
test('adjacent crowns meet at their outlines within each arch',()=>{
 const bad=[];
 for(const arch of [teeth.slice(0,16),teeth.slice(16)])for(let i=1;i<arch.length;i++){
  const gap=clearance(polys.get(arch[i-1]),polys.get(arch[i]));
  if(gap<0||gap>.8)bad.push({pair:[arch[i-1],arch[i]],gap:Number(gap.toFixed(2))});
 }
 assert.deepEqual(bad,[],`Open or overlapping contacts: ${JSON.stringify(bad)}`);
});
test('upper and lower arches remain visibly separated',()=>{
 for(const [a,b] of [[18,48],[28,38]]){
  assert.ok(clearance(polys.get(a),polys.get(b))>=15,`${a} and ${b} must retain the interarch gap`);
 }
});
