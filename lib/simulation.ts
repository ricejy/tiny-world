export const TASKS = ['continue', 'fish', 'harvest', 'water', 'charge', 'shelter', 'wait'] as const;
export type Task = typeof TASKS[number];
export type Id = 'pip' | 'moss' | 'dot';
export type Place = 'cabin' | 'garden' | 'pond' | 'charger';
export const LOCATIONS = { cabin:{x:39,y:30}, garden:{x:38,y:56}, pond:{x:61,y:50}, charger:{x:55,y:64} };
export const TASK_LABELS:Record<Task,string> = {continue:'Continue task',fish:'Fish',harvest:'Harvest',water:'Water crops',charge:'Recharge',shelter:'Shelter & repair',wait:'Wait'};
export const BALANCE={travelDrain:.65,workDrain:.95,chargeRate:4,healRate:1.5,clearMin:50,clearMax:80,stormMin:18,stormMax:32,warningSeconds:20} as const;
export type Reaction={id:number;kind:'happy'|'sad'|'lucky';text:string;until:number};
export type Bot = {id:Id;name:string;x:number;y:number;health:number;battery:number;task:Task;phase:'idle'|'travel'|'work'|'dead';destination:Place;remaining:number;duration:number;job:number;reaction?:Reaction};
export type Event = {id:number;time:number;text:string;kind:'decision'|'reward'|'weather'|'danger'};
export type Simulation = {seed:number;rng:number;weatherRng:number;growthRng:number;time:number;status:'ready'|'running'|'paused'|'won'|'lost';fish:number;crops:number;moisture:number;ripe:number;growthRemaining:number;weather:'clear'|'warning'|'storm';weatherRemaining:number;weatherVersion:number;eventId:number;events:Event[];robots:Bot[]};
export type Decisions = Record<Id,Task>;
export type Snapshot = {weatherVersion:number;jobs:Record<Id,number>};
export const snapshot = (s:Simulation):Snapshot=>({weatherVersion:s.weatherVersion,jobs:Object.fromEntries(s.robots.map(r=>[r.id,r.job])) as Record<Id,number>});

type Stream='rng'|'weatherRng'|'growthRng';
function random(s:Simulation,stream:Stream='rng'){s[stream]=(Math.imul(s[stream],1664525)+1013904223)>>>0;return s[stream]/4294967296;}
function between(s:Simulation,min:number,max:number,stream:Stream='rng'){return min+random(s,stream)*(max-min);}
function whole(s:Simulation,min:number,max:number,stream:Stream='rng'){return Math.floor(between(s,min,max+1,stream));}
function record(s:Simulation,text:string,kind:Event['kind']){s.events=[{id:++s.eventId,time:s.time,text,kind},...s.events].slice(0,60);}
function copy(s:Simulation):Simulation{return {...s,robots:s.robots.map(r=>({...r})),events:[...s.events]};}
const distance=(r:Bot,p:Place)=>Math.hypot(r.x-LOCATIONS[p].x,r.y-LOCATIONS[p].y);
const speed=(r:Bot)=>r.battery>0?4:.7;
export const travelSeconds=(r:Bot,p:Place)=>distance(r,p)/speed(r);
export const isSheltered=(r:Bot)=>distance(r,'cabin')<.15;

export function availableTasks(s:Simulation,r:Bot):Task[]{
  if(r.phase==='dead')return ['wait'];
  const options:Task[]=[];
  const shelterNeeded=s.weather!=='clear'||r.health<100;
  const continuing=(r.phase==='travel'||r.phase==='work')&&(
    r.task==='shelter'?shelterNeeded:r.task==='charge'?r.battery<100:
    r.task==='fish'?s.fish<100&&r.battery>0:
    (r.task==='harvest'||r.task==='water')?s.crops<100&&r.battery>0:false);
  if(continuing)options.push('continue');
  if(s.fish<100&&r.battery>0)options.push('fish');
  if(s.crops<100&&s.ripe>0&&r.battery>0)options.push('harvest');
  if(s.crops<100&&s.moisture<60&&r.battery>0)options.push('water');
  if(r.battery<100)options.push('charge');
  if(shelterNeeded)options.push('shelter');
  // Jev chooses a job, then keeps it through travel and one work cycle.
  // Recovery is a complete job too; reevaluation must not cancel it halfway.
  if(continuing){
    if(r.task==='shelter')return ['continue','shelter'];
    const urgentShelter=s.weather!=='clear'||r.health<=35;
    if(r.task==='charge')return urgentShelter?['continue','charge','shelter']:['continue','charge'];
    return options.filter(task=>task==='continue'||task===r.task||task==='shelter'&&urgentShelter||task==='charge'&&r.battery<20);
  }
  if(isSheltered(r)&&s.weather!=='clear')return ['shelter'];
  return options.length?options:['wait'];
}
function finishMaintenance(s:Simulation,r:Bot,text:string){
  r.task='wait';r.phase='idle';r.remaining=0;r.duration=0;r.job++;
  record(s,`${r.name}: ${text}; ready for a new task.`,'decision');
}
export function createSimulation(seed=1):Simulation{
  const s:Simulation={seed:seed>>>0,rng:seed>>>0,weatherRng:(seed^0x9e3779b9)>>>0,growthRng:(seed^0x85ebca6b)>>>0,time:0,status:'ready',fish:0,crops:0,moisture:65,ripe:12,growthRemaining:20,weather:'clear',weatherRemaining:80,weatherVersion:0,eventId:0,events:[],robots:([
    ['pip','Pip','pond',95],['moss','Moss','garden',85],['dot','Dot','charger',60]
  ] as const).map(([id,name,place,battery])=>({id,name,...LOCATIONS[place],health:100,battery,task:'wait',phase:'idle',destination:place,remaining:0,duration:0,job:0}))};
  s.weatherRemaining=between(s,BALANCE.clearMin,BALANCE.clearMax,'weatherRng');s.growthRemaining=between(s,18,28,'growthRng');return s;
}
function begin(s:Simulation,r:Bot,task:Task,manual=false){
  if(task==='continue'||r.phase==='dead')return;
  if(!manual&&!availableTasks(s,r).includes(task)){record(s,`${r.name}: task no longer useful; waiting for a fresh decision.`,'decision');return;}
  // Keeping the same job cannot reset its timer or reroll its reward.
  if(r.task===task && (r.phase==='travel'||r.phase==='work'))return;
  if(task==='harvest'&&s.ripe<=0){record(s,`${r.name}: harvest unavailable; continuing current task.`,'decision');return;}
  r.job++;r.task=task;
  if(task==='wait'){r.phase='idle';r.remaining=0;r.duration=0;record(s,`${r.name}: wait.`,'decision');return;}
  r.destination=task==='fish'?'pond':task==='charge'?'charger':task==='shelter'?'cabin':'garden';
  r.duration=task==='fish'?between(s,8,16):task==='harvest'?between(s,6,12):task==='water'?5:0;
  r.remaining=r.duration;r.phase=distance(r,r.destination)>.15?'travel':'work';
  record(s,`${r.name}: ${TASK_LABELS[task].toLowerCase()}.`,'decision');
}
export function assignDecisions(state:Simulation,decisions:Partial<Decisions>,expected?:Snapshot,manual=false):Simulation{
  if(state.status!=='running')return state;
  if(expected&&expected.weatherVersion!==state.weatherVersion)return state;
  const s=copy(state);
  for(const r of s.robots){
    const task=decisions[r.id];
    if(!task||!TASKS.includes(task)||expected&&expected.jobs[r.id]!==r.job)continue;
    begin(s,r,task,manual);
  }
  return s;
}
export function tick(state:Simulation,dt=.25):Simulation{
  if(state.status!=='running')return state;
  if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new Error('Simulation steps must be at most 250 ms.');
  const s=copy(state);s.time+=dt;s.weatherRemaining-=dt;
  if(s.weatherRemaining<=0){
    s.weather=s.weather==='clear'?'warning':s.weather==='warning'?'storm':'clear';s.weatherVersion++;
    s.weatherRemaining=s.weather==='warning'?BALANCE.warningSeconds:s.weather==='storm'?between(s,BALANCE.stormMin,BALANCE.stormMax,'weatherRng'):between(s,BALANCE.clearMin,BALANCE.clearMax,'weatherRng');
    record(s,s.weather==='warning'?'Storm approaching in 20 seconds.':s.weather==='storm'?'Storm arrived. Exposed robots take damage.':'Clear skies returned.','weather');
  }
  s.moisture=Math.max(0,Math.min(100,s.moisture+dt*(s.weather==='storm'?2:-.14)));
  if(s.moisture>20){s.growthRemaining-=dt;if(s.growthRemaining<=0){s.ripe=Math.min(24,s.ripe+whole(s,4,8,'growthRng'));s.growthRemaining=between(s,18,28,'growthRng');}}
  for(const r of s.robots){
    if(r.phase==='dead')continue;
    // Damage is based on actual location. Walking toward the cabin is not shelter.
    if(s.weather==='storm'&&!isSheltered(r))r.health=Math.max(0,r.health-6*dt);
    if(r.health<=0){r.phase='dead';r.job++;record(s,`${r.name} was lost in the storm.`,'danger');s.status='lost';continue;}
    if(isSheltered(r))r.health=Math.min(100,r.health+BALANCE.healRate*dt);
    if(r.phase==='travel'){
      const target=LOCATIONS[r.destination],d=distance(r,r.destination),step=Math.min(d,speed(r)*dt);
      if(d>0){r.x+=(target.x-r.x)*step/d;r.y+=(target.y-r.y)*step/d;}
      r.battery=Math.max(0,r.battery-BALANCE.travelDrain*dt);
      if(distance(r,r.destination)<.01){r.x=target.x;r.y=target.y;r.phase='work';}
      continue;
    }
    if(r.phase!=='work')continue;
    if(r.task==='charge'){r.battery=Math.min(100,r.battery+BALANCE.chargeRate*dt);if(r.battery>=100)finishMaintenance(s,r,'fully charged');continue;}
    if(r.task==='shelter'){if(s.weather==='clear'&&r.health>=100)finishMaintenance(s,r,'repairs complete and skies clear');continue;}
    if(r.battery<=0)continue;
    r.battery=Math.max(0,r.battery-BALANCE.workDrain*dt);r.remaining=Math.max(0,r.remaining-dt);
    if(r.remaining>0)continue;
    if(r.task==='fish'){
      const roll=random(s),caught=roll<.18?0:roll>.94?whole(s,7,10):whole(s,1,5);s.fish+=caught;
      record(s,caught?`${r.name} caught ${caught} fish${caught>=7?' — a lucky haul!':'.'}`:`${r.name}: no bite this time.`,'reward');
      r.reaction={id:s.eventId,kind:caught>=7?'lucky':caught?'happy':'sad',text:caught>=7?`JACKPOT! +${caught}`:caught?`+${caught} fish!`:'No bite…',until:s.time+(caught>=7?5:3.5)};
    }else if(r.task==='harvest'){
      const harvested=Math.min(s.ripe,whole(s,2,6));s.ripe-=harvested;s.crops+=harvested;
      record(s,harvested?`${r.name} harvested ${harvested} crops.`:`${r.name}: no ripe crops left this time.`,'reward');
      r.reaction={id:s.eventId,kind:harvested?'happy':'sad',text:harvested?`+${harvested} crops!`:'No crops…',until:s.time+3.5};
    }else if(r.task==='water'){s.moisture=Math.min(100,s.moisture+35);record(s,`${r.name} watered the crops.`,'reward');}
    r.phase='idle';r.task='wait';r.job++;
  }
  if(s.status!=='lost'&&s.fish>=100&&s.crops>=100){s.status='won';record(s,'100 fish, 100 crops, and every robot alive. Island secured!','reward');}
  return s;
}
// Explicit baseline controller for keyless play. No Jev predictions are fabricated.
export function demoDecisions(s:Simulation):Decisions{
  const actions={} as Decisions;
  for(const r of s.robots){
    if(r.phase==='dead'){actions[r.id]='wait';continue;}
    if(s.weather==='storm'||s.weather==='warning'){actions[r.id]='shelter';continue;}
    if(r.health<75||r.task==='shelter'&&r.health<95){actions[r.id]='shelter';continue;}
    if(r.battery<20||r.task==='charge'&&r.battery<90){actions[r.id]='charge';continue;}
    if(r.phase!=='idle'&&['fish','harvest','water'].includes(r.task)){actions[r.id]='continue';continue;}
    if(s.moisture<35&&r.id==='moss'){actions[r.id]='water';continue;}
    actions[r.id]=s.crops<100&&s.ripe>0&&(r.id==='moss'||s.fish>=100||r.id==='dot'&&s.crops<s.fish)?'harvest':s.fish<100?'fish':'wait';
  }
  return actions;
}
export function agentState(s:Simulation){
  return {goal:{fish:100,crops:100,all_robots_must_survive:true},time:Math.round(s.time),progress:{fish:s.fish,crops:s.crops},weather:{phase:s.weather,seconds_remaining:Math.ceil(s.weatherRemaining),seconds_until_storm:s.weather==='storm'?0:Math.ceil(s.weatherRemaining)+(s.weather==='clear'?BALANCE.warningSeconds:0)},garden:{ripe_crops:s.ripe,moisture:Math.round(s.moisture),growth_seconds_remaining:Math.ceil(s.growthRemaining)},robots:s.robots.map(r=>({id:r.id,name:r.name,health:Math.round(r.health),battery:Math.round(r.battery),task:r.task,phase:r.phase,destination:r.destination,task_seconds_remaining:Math.ceil(r.remaining),sheltered:isSheltered(r),available_tasks:availableTasks(s,r),needs_new_task:r.phase==='idle',travel_seconds_to_cabin:Math.ceil(travelSeconds(r,'cabin')),travel_seconds_to_charger:Math.ceil(travelSeconds(r,'charger'))})),rules:{fish_attempt_seconds:[8,16],fish_yield:'18% no catch; 76% 1–5 fish; 6% 7–10 fish',harvest_seconds:[6,12],harvest_yield:[2,6],storm_damage_per_second:6,cabin_repairs_per_second:BALANCE.healRate,cabin_battery_per_second:0,charger_battery_per_second:BALANCE.chargeRate,travel_battery_per_second:BALANCE.travelDrain,work_battery_per_second:BALANCE.workDrain,clear_seconds:[BALANCE.clearMin,BALANCE.clearMax],storm_seconds:[BALANCE.stormMin,BALANCE.stormMax],charger_is_outdoors:true,zero_battery:'Work stops; emergency travel is much slower.',task_commitment:'Autonomous jobs persist through travel and one work cycle. Repairs and charging finish before changing jobs. Storm warnings, health at or below 35%, or battery below 20% permit appropriate safety interruptions. Manual controls can interrupt any job.',continue:'Preserves an unfinished useful task. Charging ends at 100% battery; shelter ends at full health when skies are clear. Completed tasks cannot be continued.',cabin_and_charger_capacity:3},recent_events:s.events.slice(0,6).map(e=>e.text)};
}
