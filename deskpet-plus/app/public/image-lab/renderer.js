'use strict';
window.CharacterRenderer = class {
 constructor(canvas){
  this.canvas=canvas;this.gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:true,preserveDrawingBuffer:true});
  if(!this.gl)throw new Error('当前浏览器不支持 WebGL，请使用新版 Chrome 或 Edge，并开启图形加速。');
  this.base=document.createElement('canvas');this.frame=document.createElement('canvas');this.ctx=this.frame.getContext('2d',{willReadFrequently:true});
  const gl=this.gl;
  const vs=`attribute vec2 aUV; varying vec2 vUV; uniform vec2 uFit; uniform float uSway; uniform float uBreath;
  void main(){vUV=aUV;vec2 p=aUV;float head=1.0-smoothstep(.51,.89,p.y);float angle=uSway*.036;vec2 d=p-vec2(.5,.79);float aspect=1.0; p.x+=(-d.y*angle)*head;p.y+=d.x*angle*head;
  float chest=exp(-pow((p.y-.80)/.20,2.0));p.y-=uBreath*.0038*chest;p.x+=(p.x-.5)*uBreath*.004*chest;
  p.x+=uSway*.004*sin(p.y*5.0)*smoothstep(.35,.9,abs(p.x-.5)*2.0);
  gl_Position=vec4((p*2.0-1.0)*vec2(1.0,-1.0)*uFit,0.,1.);}`;
  const fs=`precision mediump float;varying vec2 vUV;uniform sampler2D uImage;void main(){gl_FragColor=texture2D(uImage,vUV);}`;
  const compile=(type,source)=>{const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh));return sh;};
  this.program=gl.createProgram();gl.attachShader(this.program,compile(gl.VERTEX_SHADER,vs));gl.attachShader(this.program,compile(gl.FRAGMENT_SHADER,fs));gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));gl.useProgram(this.program);
  const vertices=[],nx=48,ny=56;for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const a=[x/nx,y/ny],b=[(x+1)/nx,y/ny],c=[x/nx,(y+1)/ny],d=[(x+1)/nx,(y+1)/ny];vertices.push(...a,...b,...c,...c,...b,...d);}
  this.count=vertices.length/2;const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);const loc=gl.getAttribLocation(this.program,'aUV');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(gl.getUniformLocation(this.program,'uImage'),0);
  this.uniforms={};for(const name of ['uFit','uSway','uBreath'])this.uniforms[name]=gl.getUniformLocation(this.program,name);
 }
 setImage(image){this.image=image;const scale=Math.min(1,1100/image.naturalHeight,1100/image.naturalWidth);this.w=Math.round(image.naturalWidth*scale);this.h=Math.round(image.naturalHeight*scale);for(const c of [this.base,this.frame]){c.width=this.w;c.height=this.h;}this.prepare(false,45);}
 prepare(remove,tolerance){
  const ctx=this.base.getContext('2d',{willReadFrequently:true}),w=this.w,h=this.h;ctx.clearRect(0,0,w,h);ctx.drawImage(this.image,0,0,w,h);
  if(remove){
   const data=ctx.getImageData(0,0,w,h),p=data.data,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let start=0,end=0;const threshold=65-tolerance*.6;
   const isBlue=i=>{let j=i*4;return p[j+2]-p[j]>threshold&&p[j+1]-p[j]>threshold*.5&&p[j+2]>p[j+1]*1.035;};
   const push=i=>{if(!seen[i]&&isBlue(i)){seen[i]=1;queue[end++]=i;}};
   for(let x=0;x<w;x++){push(x);push((h-1)*w+x);}for(let y=0;y<h;y++){push(y*w);push(y*w+w-1);}
   while(start<end){const i=queue[start++],x=i%w;p[i*4+3]=0;if(x>0)push(i-1);if(x<w-1)push(i+1);if(i>=w)push(i-w);if(i<w*(h-1))push(i+w);}
   // Remove enclosed blue background too, without keying neutral blue-gray hair.
   for(let i=0;i<w*h;i++)if(!seen[i]&&isBlue(i)){const j=i*4;if(p[j+2]-p[j]>threshold+15)p[j+3]=0;}
   ctx.putImageData(data,0,0);
  }
 }
 skin(x,y){const c=this.base.getContext('2d'),w=this.w,h=this.h;let xx=Math.max(0,Math.min(w-5,Math.round(x*w)-2)),yy=Math.max(0,Math.min(h-5,Math.round(y*h)-2));const d=c.getImageData(xx,yy,5,5).data;let r=0,g=0,b=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];}return [r/25,g/25,b/25].map(Math.round);}
 cover(x,y,rx,ry,color){const c=this.ctx;c.save();c.translate(x,y);c.scale(rx,ry);const g=c.createRadialGradient(0,0,.72,0,0,1.12);g.addColorStop(0,`rgba(${color.join(',')},1)`);g.addColorStop(1,`rgba(${color.join(',')},0)`);c.fillStyle=g;c.fillRect(-1.15,-1.15,2.3,2.3);c.restore();}
 paint(state,points,eyeWidth,mouthWidth,original=false){
  const c=this.ctx,w=this.w,h=this.h;c.clearRect(0,0,w,h);c.drawImage(this.base,0,0);
  if(!original&&state.blink>.005){
   for(const point of [points.leftEye,points.rightEye]){
    const x=point.x*w,y=point.y*h,ew=eyeWidth/100*w,eh=ew*.74,b=state.blink;
    const color=this.skin(point.x,point.y+.061);this.cover(x,y,ew*.76,eh*.83,color);
    const height=Math.max(1,eh*(1-b)),dy=y-eh/2+(eh-height)*.67;
    if(b<.96)c.drawImage(this.base,x-ew*.62,y-eh*.5,ew*1.24,eh,x-ew*.62,dy,ew*1.24,height);
    if(b>.65){c.save();c.globalAlpha=Math.min(1,(b-.65)/.2);c.strokeStyle='#433d4c';c.lineWidth=Math.max(1.5,ew*.027);c.lineCap='round';c.beginPath();c.moveTo(x-ew*.46,y+eh*.12);c.quadraticCurveTo(x,y+eh*.40,x+ew*.46,y+eh*.12);c.stroke();c.restore();}
   }
  }
  if(!original&&state.mouth>.025){const p=points.mouth,x=p.x*w,y=p.y*h,mw=mouthWidth/100*w,open=state.mouth;this.cover(x,y,mw*.76,mw*.32,this.skin(p.x,p.y-.028));c.save();c.translate(x,y+mw*.03);c.fillStyle='#713c49';c.strokeStyle='#a36769';c.lineWidth=Math.max(1,mw*.015);c.beginPath();c.ellipse(0,0,mw*(.35-.05*open),mw*(.035+.23*open),0,0,Math.PI*2);c.fill();c.stroke();c.fillStyle='#ca7b87';c.beginPath();c.ellipse(0,mw*.12*open,mw*.18,mw*.045*open,0,0,Math.PI*2);c.fill();c.restore();}
  const gl=this.gl,dpr=Math.min(devicePixelRatio||1,2),width=Math.round(this.canvas.clientWidth*dpr),height=Math.round(this.canvas.clientHeight*dpr);if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
  gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);const ar=w/h,view=width/height,fit=.93;this.fit={x:(view>ar?ar/view:1)*fit,y:(view>ar?1:view/ar)*fit};gl.uniform2f(this.uniforms.uFit,this.fit.x,this.fit.y);gl.uniform1f(this.uniforms.uSway,original?0:state.sway);gl.uniform1f(this.uniforms.uBreath,original?0:state.breathe);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.frame);gl.drawArrays(gl.TRIANGLES,0,this.count);
 }
};
