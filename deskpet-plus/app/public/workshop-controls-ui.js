'use strict';
window.WorkshopControlsUI=class{
  constructor({call,notice,fit,getItem}){
    Object.assign(this,{call,notice,fit,getItem});this.$=id=>document.getElementById(id);this.queue=Promise.resolve();this.drag=null;
    setInterval(()=>this.renderMotionStatus(),300);
    const $=this.$;
    $('clear-effects').onclick=()=>this.act({type:'reset'});$('stop-motion').onclick=()=>this.act({type:'stop'});
    $('breathing').onchange=()=>this.act({type:'settings',breathing:$('breathing').checked});
    $('follow-cursor').onchange=()=>this.act({type:'settings',followMouse:$('follow-cursor').checked});
    $('physics-strength').oninput=()=>{const value=+$('physics-strength').value;this.act({type:'settings',physicsStrength:value});};
    $('parameter-search').oninput=()=>this.populateParameters();$('parameter-select').onchange=()=>this.showParameter();
    $('parameter-value').oninput=()=>{
      if(!this.controller)return;const id=$('parameter-select').value,value=+$('parameter-value').value;$('parameter-output').textContent=value.toFixed(2);
      this.controller.command({type:'parameter',id,value}).catch(e=>this.notice(e.message,true));
      clearTimeout(this.parameterTimer);this.parameterTimer=setTimeout(()=>this.act({type:'parameter',id,value}),150);
    };
    $('reset-parameter').onclick=()=>this.act({type:'parameter',id:$('parameter-select').value,value:null}).then(()=>this.showParameter());
    for(const id of ['zoom','offset-x','offset-y'])$(id).oninput=()=>{if(!this.character)return;this.readFraming();this.fit();clearTimeout(this.frameTimer);this.frameTimer=setTimeout(()=>this.saveFrame(),150);};
    $('reset-framing').onclick=()=>{$('zoom').value=1;$('offset-x').value=0;$('offset-y').value=0;this.readFraming();this.fit();this.saveFrame();};
    const canvas=$('model-canvas');
    canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!this.character)return;this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,offsetX:+$('offset-x').value,offsetY:+$('offset-y').value};canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{
      if(!this.controller)return;
      if(this.drag){$('offset-x').value=this.drag.offsetX+(event.clientX-this.drag.x)/(340/173);$('offset-y').value=this.drag.offsetY+(event.clientY-this.drag.y)/(340/173);this.readFraming();this.fit();clearTimeout(this.frameTimer);this.frameTimer=setTimeout(()=>this.saveFrame(),100);}
      else{const r=canvas.getBoundingClientRect();this.controller.setCursor({x:(event.clientX-r.left)/r.width*2-1,y:1-(event.clientY-r.top)/r.height*2},true);}
    });
    for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>{if(this.drag){this.drag=null;clearTimeout(this.frameTimer);this.saveFrame();}});
    canvas.addEventListener('pointerleave',()=>this.controller?.setCursor({x:0,y:0},false));
    document.addEventListener('keydown',event=>{
      if(!this.character||!$('enable-hotkeys').checked||event.repeat||/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))return;
      const hotkey=this.character.resources?.hotkeys?.find(h=>CharacterControls.matchesKey(event,h.triggers));if(!hotkey)return;event.preventDefault();this.act({type:hotkey.type,name:hotkey.target});
    });
  }
  detach(){clearTimeout(this.parameterTimer);clearTimeout(this.frameTimer);this.drag=null;this.controller?.dispose();this.controller=null;this.character=null;this.$('control-panel').hidden=true;}
  attach(model,character){
    this.detach();this.character=character;this.controller=new CharacterControls.Controller(model,character);this.$('control-panel').hidden=false;
    const $=this.$,resources=character.resources||{},outfit=character.outfits[0];
    $('resource-summary').textContent=`${outfit.motions.length} 个动画 · ${outfit.expressions.length} 个表情与外观预设 · ${resources.hotkeys?.length||0} 条快捷操作 · ${resources.physics?.groups||0} 组物理`;
    $('resource-warnings').textContent=(resources.warnings||[]).join('；');$('expression-groups').replaceChildren();$('motion-buttons').replaceChildren();
    for(const category of [...new Set(outfit.expressions.map(e=>e.category||'表情'))]){
      const h=document.createElement('h3');h.textContent=category;const group=document.createElement('div');group.className='control-buttons';
      for(const expression of outfit.expressions.filter(e=>(e.category||'表情')===category)){const b=document.createElement('button');b.textContent=expression.label||expression.name;b.dataset.expression=expression.name;b.onclick=()=>this.act({type:'expression',name:expression.name});group.append(b);}
      $('expression-groups').append(h,group);
    }
    for(const motion of outfit.motions){const b=document.createElement('button'),label=document.createElement('span'),small=document.createElement('small');b.dataset.motion=motion.name;label.textContent=motion.label;small.textContent=motion.playback==='hold'?'播放后保持':motion.playback==='loop'?'循环播放':'播放一次';b.append(label,small);b.onclick=()=>this.act({type:'motion',name:motion.name});$('motion-buttons').append(b);}
    $('hotkey-list').replaceChildren();for(const hotkey of resources.hotkeys||[]){const row=document.createElement('div'),key=document.createElement('kbd');row.textContent=hotkey.name;key.textContent=CharacterControls.keyLabel(hotkey.triggers)||'未设键位';row.append(key);$('hotkey-list').append(row);}
    this.renderState();this.populateParameters();this.controller.playIdle();
  }
  renderState(){
    if(!this.controller)return;const $=this.$,state=this.controller.state;
    for(const b of document.querySelectorAll('[data-expression]')){const enabled=state.expressions.includes(b.dataset.expression);b.classList.toggle('active',enabled);b.setAttribute('aria-pressed',String(enabled));}
    $('breathing').checked=state.breathing;$('follow-cursor').checked=state.followMouse;$('physics-strength').value=state.physicsStrength;$('physics-value').textContent=Math.round(state.physicsStrength*100)+'%';
    this.renderMotionStatus();
  }
  renderMotionStatus(){if(!this.controller)return;const current=this.controller.current,gesture=this.controller.state.gesture;this.$('motion-state').textContent=this.controller.error|| (gesture?'保持手势：'+gesture:current?.info?.category==='待机'?'待机中':current?.info?.label||'准备中');for(const b of this.$('motion-buttons').querySelectorAll('button')){const motion=this.character.outfits[0].motions.find(m=>m.name===b.dataset.motion);b.classList.toggle('active',current?.name===motion?.name||motion?.playback==='hold'&&gesture===motion.label);}}
  act(command){
    if(!this.controller)return Promise.resolve();const character=this.character,key=character.key,controller=this.controller;
    try{const state=CharacterControls.reduceState(character,controller.state,command);character.runtimeState=state;controller.command(command,state).catch(e=>this.notice(e.message,true));this.renderState();}
    catch(error){this.notice(error.message,true);return Promise.resolve();}
    this.queue=this.queue.catch(()=>{}).then(()=>this.call('control',{key,command})).catch(error=>{this.notice(error.message,true);});return this.queue;
  }
  readFraming(){if(!this.character)return;const $=this.$;Object.assign(this.character.outfits[0].framing,{zoom:+$('zoom').value,offsetX:+$('offset-x').value,offsetY:+$('offset-y').value});$('zoom-value').textContent=Number($('zoom').value).toFixed(2)+'×';}
  saveFrame(){if(!this.character)return;const key=this.character.key,framing={...this.character.outfits[0].framing};this.queue=this.queue.catch(()=>{}).then(()=>this.call('framing',{key,framing})).catch(e=>this.notice(e.message,true));}
  populateParameters(){
    if(!this.controller)return;const $=this.$,old=$('parameter-select').value,filter=$('parameter-search').value.trim().toLowerCase();
    const names=new Map((this.character.resources?.parameterInfo||[]).map(p=>[p.Id,p.Name]));$('parameter-select').replaceChildren();
    for(const p of this.controller.parameters.values()){const label=names.get(p.id)||p.id;if(/^[■□\-\s]+$/.test(label)||/下面是按键|按键到此结束/.test(label))continue;if(filter&&!`${label} ${p.id}`.toLowerCase().includes(filter))continue;const o=new Option(label,p.id);o.title=p.id;$('parameter-select').append(o);}
    if([...$('parameter-select').options].some(o=>o.value===old))$('parameter-select').value=old;this.showParameter();
  }
  showParameter(){
    if(!this.controller)return;const $=this.$,p=this.controller.parameters.get($('parameter-select').value);$('parameter-value').disabled=!p;$('reset-parameter').disabled=!p;if(!p)return;
    const value=this.controller.state.parameters[p.id]??this.controller.get(p.id);$('parameter-value').min=p.min;$('parameter-value').max=p.max;$('parameter-value').step=Math.max(.001,(p.max-p.min)/500);$('parameter-value').value=value;$('parameter-output').textContent=value.toFixed(2);
  }
};
