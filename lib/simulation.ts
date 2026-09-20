export const TASKS = ['continue', 'fish', 'harvest', 'water', 'charge', 'shelter', 'wait'] as const;
export type Task = typeof TASKS[number];
export type Id = 'pip' | 'moss' | 'dot';
export type Place = 'cabin' | 'garden' | 'pond' | 'charger';
export const LOCATIONS = { cabin:{x:39,y:30}, garden:{x:38,y:56}, pond:{x:61,y:50}, charger:{x:54,y:21} };
export const TASK_LABELS:Record<Task,string> = {continue:'Continue task',fish:'Fish',harvest:'Harvest',water:'Water crops',charge:'Recharge',shelter:'Shelter & repair',wait:'Wait'};
export type Bot = {id:Id;name:string;x:number;y:number;health:number;battery:number;task:Task;phase:'idle'|'travel'|'work'|'dead';destination:Place;remaining:number;duration:number;job:number};
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

export function createSimulation(seed=1):Simulation{
  const s:Simulation={seed:seed>>>0,rng:seed>>>0,weatherRng:(seed^0x9e3779b9)>>>0,growthRng:(seed^0x85ebca6b)>>>0,time:0,status:'ready',fish:0,crops:0,moisture:65,ripe:12,growthRemaining:20,weather:'clear',weatherRemaining:80,weatherVersion:0,eventId:0,events:[],robots:([
    ['pip','Pip','pond',95],['moss','Moss','garden',85],['dot','Dot','charger',60]
  ] as const).map(([id,name,place,battery])=>({id,name,...LOCATIONS[place],health:100,battery,task:'wait',phase:'idle',destination:place,remaining:0,duration:0,job:0}))};
  s.weatherRemaining=between(s,70,100,'weatherRng');s.growthRemaining=between(s,18,28,'growthRng');return s;
}
function begin(s:Simulation,r:Bot,task:Task){
  if(task==='continue'||r.phase==='dead')return;
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
export function assignDecisions(state:Simulation,decisions:Partial<Decisions>,expected?:Snapshot):Simulation{
  if(state.status!=='running')return state;
  if(expected&&expected.weatherVersion!==state.weatherVersion)return state;
  const s=copy(state);
  for(const r of s.robots){
    const task=decisions[r.id];
    if(!task||!TASKS.includes(task)||expected&&expected.jobs[r.id]!==r.job)continue;
    begin(s,r,task);
  }
  return s;
}
export function tick(state:Simulation,dt=.25):Simulation{
  if(state.status!=='running')return state;
  if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new Error('Simulation steps must be at most 250 ms.');
  const s=copy(state);s.time+=dt;s.weatherRemaining-=dt;
  if(s.weatherRemaining<=0){
    s.weather=s.weather==='clear'?'warning':s.weather==='warning'?'storm':'clear';s.weatherVersion++;
    s.weatherRemaining=s.weather==='warning'?20:s.weather==='storm'?between(s,20,35,'weatherRng'):between(s,70,100,'weatherRng');
    record(s,s.weather==='warning'?'Storm approaching in 20 seconds.':s.weather==='storm'?'Storm arrived. Exposed robots take damage.':'Clear skies returned.','weather');
  }
  s.moisture=Math.max(0,Math.min(100,s.moisture+dt*(s.weather==='storm'?2:-.14)));
  if(s.moisture>20){s.growthRemaining-=dt;if(s.growthRemaining<=0){s.ripe=Math.min(24,s.ripe+whole(s,4,8,'growthRng'));s.growthRemaining=between(s,18,28,'growthRng');}}
  for(const r of s.robots){
    if(r.phase==='dead')continue;
    // Damage is based on actual location. Walking toward the cabin is not shelter.
    if(s.weather==='storm'&&!isSheltered(r))r.health=Math.max(0,r.health-6*dt);
    if(r.health<=0){r.phase='dead';r.job++;record(s,`${r.name} was lost in the storm.`,'danger');s.status='lost';continue;}
    if(isSheltered(r)){r.health=Math.min(100,r.health+3*dt);r.battery=Math.min(100,r.battery+1.5*dt);}
    if(r.phase==='travel'){
      const target=LOCATIONS[r.destination],d=distance(r,r.destination),step=Math.min(d,speed(r)*dt);
      if(d>0){r.x+=(target.x-r.x)*step/d;r.y+=(target.y-r.y)*step/d;}
      r.battery=Math.max(0,r.battery-.3*dt);
      if(distance(r,r.destination)<.01){r.x=target.x;r.y=target.y;r.phase='work';}
      continue;
    }
    if(r.phase!=='work')continue;
    if(r.task==='charge'){r.battery=Math.min(100,r.battery+8*dt);continue;}
    if(r.task==='shelter')continue;
    if(r.battery<=0)continue;
    r.battery=Math.max(0,r.battery-.45*dt);r.remaining=Math.max(0,r.remaining-dt);
    if(r.remaining>0)continue;
    if(r.task==='fish'){
      const roll=random(s),caught=roll<.18?0:roll>.94?whole(s,7,10):whole(s,1,5);s.fish+=caught;
      record(s,caught?`${r.name} caught ${caught} fish${caught>=7?' — a lucky haul!':'.'}`:`${r.name}: no bite this time.`,'reward');
    }else if(r.task==='harvest'){
      const harvested=Math.min(s.ripe,whole(s,2,6));s.ripe-=harvested;s.crops+=harvested;
      record(s,`${r.name} harvested ${harvested} crops.`,'reward');
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
  return {goal:{fish:100,crops:100,all_robots_must_survive:true},time:Math.round(s.time),progress:{fish:s.fish,crops:s.crops},weather:{phase:s.weather,seconds_remaining:Math.ceil(s.weatherRemaining)},garden:{ripe_crops:s.ripe,moisture:Math.round(s.moisture),growth_seconds_remaining:Math.ceil(s.growthRemaining)},robots:s.robots.map(r=>({id:r.id,name:r.name,health:Math.round(r.health),battery:Math.round(r.battery),task:r.task,phase:r.phase,destination:r.destination,task_seconds_remaining:Math.ceil(r.remaining),sheltered:isSheltered(r),travel_seconds_to_cabin:Math.ceil(travelSeconds(r,'cabin'))})),rules:{fish_attempt_seconds:[8,16],fish_yield:'18% no catch; 76% 1–5 fish; 6% 7–10 fish',harvest_seconds:[6,12],harvest_yield:[2,6],storm_damage_per_second:6,cabin_repairs_per_second:3,cabin_battery_per_second:1.5,charger_battery_per_second:8,charger_is_outdoors:true,zero_battery:'Work stops; emergency travel is much slower.',continue:'Preserves current task progress. Repeating the same active task also preserves progress.',cabin_and_charger_capacity:3},recent_events:s.events.slice(0,6).map(e=>e.text)};
}
