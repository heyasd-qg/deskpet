'use strict';
window.MOTIONS = [
 {id:'idle',name:'自然待机',icon:'✧',description:'组合眨眼、呼吸与轻摆，观察角色整体感觉。'},
 {id:'blink',name:'眨眼',icon:'◡',description:'循环闭眼与睁眼。闭眼线条为程序绘制，可通过五官校准调整位置。'},
 {id:'talk',name:'说话',icon:'♡',description:'循环嘴型试验，尚未接入语音或真实口型同步。'},
 {id:'breathe',name:'呼吸',icon:'≋',description:'胸肩轻微起伏，观察边缘和颈部衔接。'},
 {id:'sway',name:'轻摆',icon:'↔',description:'小幅歪头和上身摆动，属于二维网格变形。'},
 {id:'still',name:'静态原姿',icon:'◇',description:'停止动作，用于检查素材和五官位置。'}
];
window.getMotion = function(id,t,strength){
 const s=strength/100, state={blink:0,mouth:0,breathe:0,sway:0};
 if(id==='blink'||id==='idle'){
   const phase=t%(id==='blink'?2.6:4.3);
   state.blink=phase<.30?Math.pow(Math.sin(phase/.30*Math.PI),.65)*Math.min(1,s*1.54):0;
 }
 if(id==='talk')state.mouth=(.5+.5*Math.sin(t*10))*(.7+.3*Math.sin(t*3.7))*s;
 if(id==='breathe'||id==='idle')state.breathe=Math.sin(t*1.7)*s;
 if(id==='sway'||id==='idle')state.sway=Math.sin(t*.95)*s*(id==='idle'?.55:1);
 return state;
};
