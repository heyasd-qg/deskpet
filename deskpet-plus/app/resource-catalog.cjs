'use strict';
const fs = require('node:fs'), path = require('node:path');
const clean = name => name.replaceAll('\\', '/');
const baseName = name => path.basename(name).replace(/\.(motion3|exp3)\.json$/i, '');
function expressionGroup(name, parameters) {
  if (/圈圈|爱心|＞＜|><|屑|eye/i.test(name)) return '眼神';
  if (/体型/.test(name) || parameters.some(p => p.Id === 'Clothes2')) return '体型';
  if (/眼镜/.test(name)) return '眼镜';
  if (/衣服|裙|鞋|尾巴/.test(name)) return '服装与外观';
  if (/钢盆|牙/.test(name)) return '配饰';
  if (/前倾|食指|举手/.test(name)) return '姿态';
  return '表情';
}
function enrichModel(root, entry, model, readJSON) {
  const directory = path.dirname(entry), absolute = path.resolve(root, directory), files = [], warnings = [];
  function scan(dir) {
    for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
      if (item.isSymbolicLink()) throw Error('模型资源中不允许链接。');
      const file = path.join(dir, item.name);
      if (item.isDirectory()) scan(file); else if (item.isFile()) files.push(clean(path.relative(absolute, file)));
      if (files.length > 10000) throw Error('模型目录文件数过多。');
    }
  }
  scan(absolute);
  const refs = model.FileReferences;
  const read = relative => readJSON(path.join(directory, relative));
  const vtubeFiles = files.filter(f => /\.vtube\.json$/i.test(f)); let vtube;
  for (const file of vtubeFiles) {
    try {
      const value = read(file);
      if (clean(value.FileReferences?.Model || '') === path.basename(entry) || vtubeFiles.length === 1) { vtube = value; break; }
    } catch { warnings.push('无法读取追踪配置：' + file); }
  }
  const motions = [], expressions = [], motionFiles = new Map(), expressionFiles = new Map();
  const motionByFile = new Map(), expressionByFile = new Map();
  const originalGroups = refs.Motions || {}, finalGroups = {};
  function addMotion(file, name, label, definition = {}) {
    const normal = clean(path.normalize(file)).replace(/\.gz$/i, '');
    if (motionByFile.has(normal.toLowerCase())) return motionByFile.get(normal.toLowerCase());
    const value = read(normal);
    if (value.Version !== 3 || !Array.isArray(value.Curves)) throw Error('不是有效的动作：' + file);
    name ||= 'custom_motion_' + motions.length;
    while (finalGroups[name]) name += '_';
    const info = { name, label:label || baseName(normal), file:normal, duration:Number(value.Meta?.Duration) || 3,
      sourceLoop:!!value.Meta?.Loop, loop:!!value.Meta?.Loop, playback: /idle|待机/i.test(normal) ? 'loop' : 'once',
      category: /idle|待机/i.test(label||normal) ? '待机' : /脱捕|tracking/i.test(label||normal) ? '离开时动画' : '手势与动作',
      finalParameters:Object.fromEntries(value.Curves.filter(c => c.Target === 'Parameter' && Array.isArray(c.Segments) && c.Segments.length >= 2).map(c => [c.Id,c.Segments.at(-1)])) };
    if(info.category==='待机')info.playback='loop';
    info.loop = info.playback === 'loop'; motions.push(info); motionByFile.set(normal.toLowerCase(),info);
    finalGroups[name] = [{...definition,File:normal}]; motionFiles.set(path.basename(normal).toLowerCase(), info);
    return info;
  }
  for (const [group, definitions] of Object.entries(originalGroups)) for (let n=0;n<definitions.length;n++) {
    const def = definitions[n]; addMotion(def.File, /^custom_motion_/.test(group)&&definitions.length===1?group:undefined, /^custom_motion_/.test(group) ? baseName(def.File) : group + (definitions.length > 1 ? ' · '+(n+1) : ''), def);
  }
  for (const file of files.filter(f=>/\.motion3\.json(?:\.gz)?$/i.test(f))) {
    try { addMotion(file); } catch(error) { warnings.push(error.message); }
  }
  function addExpression(file, name) {
    const normal=clean(path.normalize(file)).replace(/\.gz$/i,'');
    if (expressionByFile.has(normal.toLowerCase())) return expressionByFile.get(normal.toLowerCase());
    const value=read(normal); if (!Array.isArray(value.Parameters)) throw Error('不是有效的表情：'+file);
    name ||= baseName(normal);
    if (expressions.some(e=>e.name===name)) name += ' · '+expressions.length;
    const info={name,label:name,file:normal,parameters:value.Parameters,category:expressionGroup(name,value.Parameters)};
    expressions.push(info);expressionByFile.set(normal.toLowerCase(),info);expressionFiles.set(path.basename(normal).toLowerCase(),info);return info;
  }
  for(const def of refs.Expressions || []) addExpression(def.File,def.Name);
  for(const file of files.filter(f=>/\.exp3\.json(?:\.gz)?$/i.test(f))) {try{addExpression(file)}catch(error){warnings.push(error.message)}}
  const hotkeys=[];
  for(const hotkey of vtube?.Hotkeys || []) {
    if (hotkey.IsActive === false) continue;
    const found=hotkey.Action==='ToggleExpression'?expressionFiles.get(path.basename(hotkey.File || '').toLowerCase()):motionFiles.get(path.basename(hotkey.File || '').toLowerCase());
    const type=({ToggleExpression:'expression',TriggerAnimation:'motion',RemoveAllExpressions:'reset'})[hotkey.Action];
    if(!type || type!=='reset' && !found){warnings.push('尚未适配快捷操作：'+hotkey.Name);continue}
    if(type==='motion'){found.playback=hotkey.StopsOnLastFrame?'hold':'once';found.loop=false;found.label=hotkey.Name;}
    hotkeys.push({name:hotkey.Name,type,target:found?.name || null,triggers:hotkey.Triggers || {},hold:!!hotkey.StopsOnLastFrame});
  }
  const idleFile=vtube?.FileReferences?.IdleAnimation;
  const idle=motionFiles.get(path.basename(idleFile || '').toLowerCase()) || motions.find(m=>m.category==='待机');
  if(idle){idle.category='待机';idle.playback='loop';idle.loop=true;}
  const lost=motionFiles.get(path.basename(vtube?.FileReferences?.IdleAnimationWhenTrackingLost || '').toLowerCase());
  if(lost){lost.category='离开时动画';lost.playback='loop';lost.loop=true;}
  refs.Motions=finalGroups;
  refs.Expressions=expressions.map(e=>({Name:e.name,File:e.file}));
  let display={Parameters:[],ParameterGroups:[]},physics;
  try{if(refs.DisplayInfo)display=read(refs.DisplayInfo)}catch(error){warnings.push(error.message)}
  try{if(refs.Physics)physics=read(refs.Physics)}catch(error){warnings.push(error.message)}
  const mappings=(vtube?.ParameterSettings || []).filter(p=>typeof p.OutputLive2D==='string').map(p=>({name:p.Name,input:p.Input,output:p.OutputLive2D,inputMin:p.InputRangeLower,inputMax:p.InputRangeUpper,outputMin:p.OutputRangeLower,outputMax:p.OutputRangeUpper,breathing:!!p.UseBreathing}));
  return {motions,expressions,idle:idle?.name || null,hotkeys,mappings,warnings,
    parameterInfo:display.Parameters || [], parameterGroups:display.ParameterGroups || [],
    physics:{groups:physics?.Meta?.PhysicsSettingCount || 0,outputIds:[...new Set((physics?.PhysicsSettings || []).flatMap(s=>(s.Output || []).map(o=>o.Destination?.Id)).filter(Boolean))]},
    sourceFormat:vtube?'VTube Studio':'Cubism',defaultPhysics:vtube?.PhysicsSettings?.Use===false?0:Math.min(2,Math.max(0,(vtube?.PhysicsSettings?.PhysicsStrength ?? 100)/100))};
}
module.exports={enrichModel,expressionGroup};
