/** Deterministic, original MIT-licensed synthetic plan pixels; no user image content. */
export function syntheticPlan(width=640,height=640,seed=42,shapes=700){
 const data=new Uint8Array(width*height*4);data.fill(255);
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const pixel=(x:number,y:number,value:number)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&y>=0&&x<width&&y<height){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=value;}};
 const line=(x:number,y:number,a:number,b:number,v:number)=>{const length=Math.max(Math.abs(a-x),Math.abs(b-y));for(let t=0;t<=length;t++)pixel(x+(a-x)*t/length,y+(b-y)*t/length,v);};
 for(let i=0;i<shapes;i++){const x=random()*(width-20)+10,y=random()*(height-20)+10,a=3+random()*15,b=3+random()*15,v=Math.floor(random()*100);line(x,y,x+a,y,v);line(x+a,y,x+a,y+b,v);line(x+a,y+b,x,y+b,v);if(random()>.4)line(x,y+b,x,y,v);line(x,y,x+a*.3,y+b*.8,v);}
 return {width,height,data};
}
export function cropPixels(image:ReturnType<typeof syntheticPlan>,x:number,y:number,width:number,height:number){const data=new Uint8Array(width*height*4);for(let j=0;j<height;j++)data.set(image.data.subarray(((y+j)*image.width+x)*4,((y+j)*image.width+x+width)*4),j*width*4);return {width,height,data};}
