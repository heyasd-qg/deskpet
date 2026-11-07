'use strict';
((factory)=>{const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else globalThis.CharacterControls=api;})(()=>{
  const copy=value=>JSON.parse(JSON.stringify(value));
  function defaultState(character){return {expressions:character.bindings?.expression?[character.bindings.expression]:[],parameters:{},heldParameters:{},gesture:null,physicsStrength:character.resources?.defaultPhysics??1,breathing:true,followMouse:true};}
  function reduceState(character,current,command){
    const state={...defaultState(character),...copy(current||{})},outfit=character.outfits[0];
    if(command.type==='reset')return {...state,expressions:[],parameters:{},heldParameters:{},gesture:null};
    if(command.type==='expression'){
      const expression=outfit.expressions.find(e=>e.name===command.name);if(!expression)throw Error('这个表情已不存在。');
      const enabled=command.enabled??!state.expressions.includes(expression.name);
      state.expressions=state.expressions.filter(n=>n!==expression.name);
      if(enabled){
        const ids=new Set(expression.parameters.map(p=>p.Id));
        state.expressions=state.expressions.filter(name=>{const old=outfit.expressions.find(e=>e.name===name);return old&&!(['眼神','体型','眼镜'].includes(expression.category)&&old.category===expression.category)&&!old.parameters.some(p=>ids.has(p.Id));});
        state.expressions.push(expression.name);
      }
    }else if(command.type==='motion'){
      const motion=outfit.motions.find(m=>m.name===command.name);if(!motion)throw Error('这个动作已不存在。');
      if(motion.playback!=='loop')state.heldParameters={...state.heldParameters,...motion.finalParameters};
      if(motion.playback==='hold')state.gesture=motion.label;else if(motion.playback==='once')state.gesture=null;
    }else if(command.type==='stop'){state.heldParameters={};state.gesture=null;}
    else if(command.type==='parameter'){
      const known=new Set([...(character.resources?.parameterInfo||[]).map(p=>p.Id),...(character.resources?.mappings||[]).map(p=>p.output),...outfit.expressions.flatMap(e=>e.parameters.map(p=>p.Id))]);
      if(!known.has(command.id))throw Error('未知的模型参数。');
      if(command.value===null)delete state.parameters[command.id];else{const value=Number(command.value);if(!Number.isFinite(value))throw Error('参数值无效。');state.parameters[command.id]=Math.max(-10000,Math.min(10000,value));}
    }else if(command.type==='settings'){
      for(const key of ['breathing','followMouse'])if(key in command)state[key]=!!command[key];
      if('physicsStrength'in command){const value=Number(command.physicsStrength);if(!Number.isFinite(value))throw Error('物理强度无效。');state.physicsStrength=Math.max(0,Math.min(2,value));}
    }else throw Error('不支持的角色操作。');
    return state;
  }
  function keyLabel(triggers){return [triggers?.Trigger1,triggers?.Trigger2,triggers?.Trigger3].filter(Boolean).map(k=>k.replace(/^N(\d)$/,'$1').replace('LeftShift','Shift').replace('RightShift','Shift').replace('LeftControl','Ctrl').replace('RightControl','Ctrl')).join(' + ');}
  function matchesKey(event,triggers){
    const keys=[triggers?.Trigger1,triggers?.Trigger2,triggers?.Trigger3].filter(Boolean);if(!keys.length)return false;
    const modifier=k=>/^(Alt|LeftAlt|RightAlt|Shift|LeftShift|RightShift|Control|Ctrl|LeftControl|RightControl|Meta|Windows)$/.test(k);
    if(event.altKey!==keys.some(k=>/Alt/.test(k))||event.shiftKey!==keys.some(k=>/Shift/.test(k))||event.ctrlKey!==keys.some(k=>/Control|Ctrl/.test(k))||event.metaKey!==keys.some(k=>/Meta|Windows/.test(k)))return false;
    return keys.filter(k=>!modifier(k)).some(k=>event.code===(/^N\d$/.test(k)?'Digit'+k[1]:/^[A-Z]$/.test(k)?'Key'+k:k));
  }
  class Controller{
    constructor(model,character,options={}){
      this.model=model;this.character=character;this.internal=model.internalModel;this.core=this.internal.coreModel;this.manager=this.internal.motionManager;
      this.now=options.now||(()=>performance.now());this.state=copy(character.runtimeState||defaultState(character));this.cursor={x:0,y:0,active:false};this.parameters=new Map();this.touched=new Set();this.serial=0;this.current=null;this.disposed=false;this.error='';
      const core=this.core,count=core.getParameterCount();
      for(let i=0;i<count;i++){const id=String(core._parameterIds?.[i]??core._model?.parameters.ids?.[i]??'');if(id)this.parameters.set(id,{id,min:core.getParameterMinimumValue(i),max:core.getParameterMaximumValue(i),default:core.getParameterDefaultValue(i)});}
      this.originalNatural=this.internal.updateNaturalMovements;
      const self=this;this.internal.updateNaturalMovements=function(...args){self.originalNatural.apply(this,args);self.tick(args[0]/1000);};
      this.beforeUpdate=()=>{for(const[id,value]of Object.entries(this.state.parameters||{}))this.set(id,value);};this.internal.on?.('beforeModelUpdate',this.beforeUpdate);
      const physics=this.internal.physics;
      if(physics){this.originalPhysics=physics.evaluate;physics.evaluate=function(core,dt){const strength=self.state.physicsStrength;if(strength===0)return;const ids=self.character.resources?.physics.outputIds||[],before=ids.map(id=>self.get(id));self.originalPhysics.call(this,core,dt);if(strength!==1)ids.forEach((id,i)=>self.set(id,before[i]+(self.get(id)-before[i])*strength));};}
    }
    get(id){return this.parameters.has(id)?this.core.getParameterValueById(id):0;}
    set(id,value){const p=this.parameters.get(id);if(p&&Number.isFinite(value))this.core.setParameterValueById(id,Math.max(p.min,Math.min(p.max,value)));}
    defaults(id){return this.parameters.get(id)?.default||0;}
    setState(state){this.state=copy(state);}
    setCursor(cursor,active=true){this.cursor={x:Math.max(-1,Math.min(1,cursor.x||0)),y:Math.max(-1,Math.min(1,cursor.y||0)),active};}
    async playMotion(name){
      const motion=this.character.outfits[0].motions.find(m=>m.name===name);if(!motion)throw Error('动作不存在。');
      const serial=++this.serial;this.current={name,loading:true};
      try{
        const native=await this.manager.loadMotion(name,0);if(this.disposed||serial!==this.serial)return false;if(!native)throw Error('动作资源加载失败。');
        native.setIsLoop?.(motion.playback==='loop');
        this.manager.stopAllMotions();const ok=await this.model.motion(name,0,3);if(this.disposed||serial!==this.serial)return false;
        if(ok===false)throw Error('动作未能开始播放。');
        this.current={name,loading:false,end:motion.playback==='loop'?Infinity:this.now()+motion.duration*1000,info:motion};return true;
      }catch(error){if(serial===this.serial){this.current=null;this.error=error.message;}throw error;}
    }
    playIdle(){const name=this.character.bindings.idle;if(!name||this.current)return;this.playMotion(name).catch(error=>{this.error=error.message;});}
    stop(){this.serial++;this.manager.stopAllMotions();this.current=null;this.playIdle();}
    command(command,state){this.setState(state||reduceState(this.character,this.state,command));if(command.type==='motion')return this.playMotion(command.name);if(command.type==='reset'||command.type==='stop')this.stop();return Promise.resolve(true);}
    tick(dt=1/60){
      if(this.disposed)return;
      if(this.current?.info?.category==='待机'&&!('ParamEyeLOpen'in this.current.info.finalParameters))this.internal.eyeBlink?.updateParameters(this.core,dt);
      if(this.current&&!this.current.loading&&this.now()>=this.current.end){this.manager.stopAllMotions();this.current=null;this.playIdle();}
      const values={};
      for(const name of this.state.expressions){const e=this.character.outfits[0].expressions.find(x=>x.name===name);for(const p of e?.parameters||[]){const previous=values[p.Id]??this.defaults(p.Id);values[p.Id]=p.Blend==='Overwrite'?p.Value:p.Blend==='Multiply'?previous*p.Value:previous+p.Value;}}
      for(const[id,value]of Object.entries(this.state.heldParameters||{})){if(!this.current?.info?.finalParameters||!(id in this.current.info.finalParameters)||this.current.info.playback==='loop')values[id]=value;}
      if(!this.state.breathing)values.ParamBreath=this.defaults('ParamBreath');
      if(this.state.followMouse&&this.cursor.active){
        const inputs={FaceAngleX:this.cursor.x*30,FaceAngleY:this.cursor.y*20,FaceAngleZ:this.cursor.x*12,EyeRightX:this.cursor.x,EyeRightY:this.cursor.y};
        for(const map of this.character.resources?.mappings||[]){if(!(map.input in inputs)||!Number.isFinite(map.inputMin)||!Number.isFinite(map.inputMax)||map.inputMax===map.inputMin)continue;const t=Math.max(0,Math.min(1,(inputs[map.input]-map.inputMin)/(map.inputMax-map.inputMin)));values[map.output]=map.outputMin+t*(map.outputMax-map.outputMin);}
      }
      Object.assign(values,this.state.parameters);
      for(const id of this.touched)if(!(id in values)&&!(id in (this.current?.info?.finalParameters||{})))this.set(id,this.defaults(id));
      this.touched=new Set(Object.keys(values));for(const[id,value]of Object.entries(values))this.set(id,value);
    }
    dispose(){this.disposed=true;this.serial++;this.internal.removeListener?.('beforeModelUpdate',this.beforeUpdate);this.internal.updateNaturalMovements=this.originalNatural;if(this.originalPhysics&&this.internal.physics)this.internal.physics.evaluate=this.originalPhysics;}
  }
  return {defaultState,reduceState,keyLabel,matchesKey,Controller};
});
