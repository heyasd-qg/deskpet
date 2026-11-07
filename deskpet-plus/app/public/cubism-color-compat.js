'use strict';
((factory)=>{const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{globalThis.CubismColorCompat=api;api.install(globalThis.PIXI?.live2d);}})(()=>{
  // Cubism Core supplies per-drawable colors. The bundled older Web Framework
  // ignores them, so a texture intended to be recolored can appear black.
  // Apply the standard premultiplied-alpha multiply/screen operations in all
  // three draw shaders; the alpha-only clipping-mask shader stays unchanged.
  const helper='uniform vec4 u_multiplyColor;uniform vec4 u_screenColor;'+
    'vec4 cubismTextureColor(vec4 texColor){texColor.rgb=texColor.rgb*u_multiplyColor.rgb;'+
    'texColor.rgb=(texColor.rgb+u_screenColor.rgb*texColor.a)-(texColor.rgb*u_screenColor.rgb);return texColor;}';
  function patchFragment(source){
    if(source.includes('u_multiplyColor'))return source;
    const pattern=/texture2D\(s_texture0\s*,\s*v_texCoord\)\s*\*\s*u_baseColor/g;
    if(!pattern.test(source))return source;
    return source.replace(pattern,'cubismTextureColor(texture2D(s_texture0, v_texCoord)) * u_baseColor').replace(/void\s+main\s*\(\s*\)/,helper+'void main()');
  }
  function colorSample(texture,multiply,screen){return texture.map((value,i)=>i===3?value:value*multiply[i]+screen[i]*texture[3]-value*multiply[i]*screen[i]);}
  function install(api){
    const Renderer=api?.CubismRenderer_WebGL,Shader=api?.CubismShader_WebGL;
    if(!Renderer||!Shader)throw Error('Live2D 渲染器尚未准备好。');
    if(Renderer.prototype.__colorCompatInstalled)return;
    Renderer.prototype.__colorCompatInstalled=true;
    const initialize=Renderer.prototype.initialize,drawMesh=Renderer.prototype.drawMesh;
    Renderer.prototype.initialize=function(model){
      const result=initialize.call(this,model);this.__colorCompatIndices=new WeakMap();
      for(let i=0;i<model.getDrawableCount();i++)this.__colorCompatIndices.set(model.getDrawableVertices(i),i);
      return result;
    };
    Renderer.prototype.drawMesh=function(...args){
      const previous=this.__colorCompatIndex;this.__colorCompatIndex=this.__colorCompatIndices?.get(args[4]);
      try{return drawMesh.apply(this,args)}finally{this.__colorCompatIndex=previous}
    };
    const load=Shader.prototype.loadShaderProgram,setup=Shader.prototype.setupShaderProgram,locations=new WeakMap();
    Shader.prototype.loadShaderProgram=function(vertex,fragment){return load.call(this,vertex,patchFragment(fragment));};
    Shader.prototype.setupShaderProgram=function(...args){
      const result=setup.apply(this,args),renderer=args[0];
      if(renderer.getClippingContextBufferForMask()!=null)return result;
      const clipped=renderer.getClippingContextBufferForDraw()!=null,mode=args[8],offset=clipped?(args[12]?2:1):0;
      const program=this._shaderSets[(mode===1?4:mode===2?7:1)+offset]?.shaderProgram;if(!program)return result;
      let uniforms=locations.get(program);
      if(!uniforms){uniforms={multiply:this.gl.getUniformLocation(program,'u_multiplyColor'),screen:this.gl.getUniformLocation(program,'u_screenColor')};locations.set(program,uniforms);}
      const index=renderer.__colorCompatIndex,raw=renderer.getModel()?._model?.drawables,multiply=raw?.multiplyColors,screen=raw?.screenColors,o=index*4;
      const available=Number.isInteger(index)&&index>=0&&multiply&&screen&&o+3<multiply.length&&o+3<screen.length;
      if(uniforms.multiply!=null)this.gl.uniform4f(uniforms.multiply,available?multiply[o]:1,available?multiply[o+1]:1,available?multiply[o+2]:1,1);
      if(uniforms.screen!=null)this.gl.uniform4f(uniforms.screen,available?screen[o]:0,available?screen[o+1]:0,available?screen[o+2]:0,1);
      return result;
    };
  }
  return {install,patchFragment,colorSample};
});
