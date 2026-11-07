class InteractionDirector {
  constructor({ data, catalogue, context, transport, end, now=Date.now, random=Math.random }) {
    Object.assign(this,{data,catalogue,context,transport,end,now,random});
    this.signature='';this.characterSignature='';this.pending=false;this.nextAt=null;this.busy=null;this.serial=0;this.last='';this.history=[];
  }
  configure() {
    const c=this.context(),chars=c.dualEnabled?c.left.character+'|'+c.right.character:'single';
    const sig=chars+(c.dualEnabled?'|'+c.left.outfit+'|'+c.right.outfit:'');
    if(sig===this.signature)return;
    const changed=chars!==this.characterSignature;
    this.cancel('profile changed');this.signature=sig;this.characterSignature=chars;
    this.pending=c.dualEnabled&&(changed||this.pending);this.settleAt=this.now()+700;this.nextAt=null;
  }
  pair() {
    const c=this.context(),match=p=>p.characters.includes(c.left.character)&&p.characters.includes(c.right.character)&&c.left.character!==c.right.character;
    return { paired:this.data.paired.find(match)?.exchanges||[],daily:this.data.daily.find(match)?.lines||[] };
  }
  ready(c) { return c.dualEnabled&&['left','right'].every(s=>c.scenes[s]?.ready&&c.scenes[s].character===c[s].character&&c.scenes[s].outfit===c[s].outfit); }
  choose(items) { const pool=items.filter(x=>x.id!==this.last);return (pool.length?pool:items)[Math.floor(this.random()*(pool.length||items.length))]; }
  poll() {
    this.configure();const c=this.context(),eligible=c.dualEnabled&&(c.locked||c.idle);
    if (c.dualEnabled && [c.left, c.right].some(p => this.catalogue.find(x => x.key === p.character)?.custom)) { this.pending=false;this.nextAt=null;return; }
    if(!eligible)this.nextAt=null;
    if(this.busy||!this.ready(c))return;
    if(this.pending) {
      if(this.now()<this.settleAt)return;
      this.pending=false;const {paired}=this.pair();
      if(paired.length){this.start(this.choose(paired),'selection');return;}
      const left=this.catalogue.find(x=>x.key===c.left.character),right=this.catalogue.find(x=>x.key===c.right.character);
      if(left.band!==right.band){
        this.start({id:'cross/'+this.characterSignature,kind:'cross',segments:[
          {speaker:left.key,zh:'预祝你们演出顺利',ja:'公演がうまくいきますように。',duration:3,reactions:[{character:left.key,codes:['S']},{character:right.key,codes:['N']}]},
          {speaker:right.key,zh:'你们也是',ja:'そちらも。',duration:2.5,reactions:[{character:right.key,codes:['S']},{character:left.key,codes:['S']}]}
        ]},'selection');return;
      }
    }
    if(!eligible)return;
    if(this.nextAt==null)this.nextAt=this.now();
    if(this.now()<this.nextAt)return;
    const {paired,daily}=this.pair();
    if(!paired.length){this.start({id:'gesture/'+this.serial,kind:'gesture',segments:[]},'random');return;}
    const items=daily.length&&this.random()<.5?daily:paired;this.start(this.choose(items),'random');
  }
  async start(item,reason) {
    const c=this.context(),job={id:'interaction-'+(++this.serial),kind:item.kind,item:item.id,reason};this.busy=job;this.last=item.id;
    this.history.push({event:'start',...job,at:this.now()});if(this.history.length>80)this.history.shift();
    try {
      if(item.kind==='gesture')await Promise.all(['left','right'].map(slot=>this.transport(slot,{group:job.id,phase:0,kind:'gesture'})));
      else for(let i=0;i<item.segments.length;i++) {
        if(this.busy!==job)return;
        const segment=item.segments[i];
        await Promise.all(['left','right'].map(slot=>this.transport(slot,{group:job.id,phase:i,kind:'speech',segment,
          speaking:c[slot].character===segment.speaker,reaction:segment.reactions.find(r=>r.character===c[slot].character)})));
      }
      if(this.busy!==job)return;
      this.history.push({event:'finish',...job,at:this.now()});
    } catch(error) { if(this.busy===job)this.history.push({event:'error',...job,error:String(error.message||error)}); }
    finally {
      if(this.busy===job){this.end(job.id);this.busy=null;const current=this.context();this.nextAt=current.dualEnabled&&(current.locked||current.idle)?this.now()+30000+Math.floor(this.random()*30001):null;}
    }
  }
  cancel(reason='cancelled') { const job=this.busy;if(job){this.busy=null;this.end(job.id,true);this.history.push({event:'cancel',...job,reason});}this.nextAt=null; }
  debug() {return{pending:this.pending,nextAt:this.nextAt,busy:this.busy,history:this.history.slice(-30)}}
}
module.exports={InteractionDirector};
