import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,tick,assignDecisions,demoDecisions,snapshot,LOCATIONS,agentState,availableTasks,BALANCE} from '../lib/simulation.ts';
import {buildQuestions} from '../lib/autonomy-questions.ts';
const running=(seed=42)=>({...createSimulation(seed),status:'running'});
const advance=(s,seconds)=>{for(let t=0;t<seconds;t+=.25)s=tick(s);return s;};

test('fishing has bounded random duration, delayed rewards, and no reroll on repeated assignment',()=>{
  let s=assignDecisions(running(),{pip:'fish'});const duration=s.robots[0].remaining;
  assert.ok(duration>=8&&duration<=16);s=advance(s,1);
  assert.equal(s.fish,0);const remaining=s.robots[0].remaining,job=s.robots[0].job;
  s=assignDecisions(s,{pip:'fish'});assert.equal(s.robots[0].remaining,remaining);assert.equal(s.robots[0].job,job);
  s=advance(s,16);assert.ok(s.fish>=0&&s.fish<=10);assert.equal(s.robots[0].phase,'idle');
});
test('harvest duration and yield are bounded and shared stock cannot go negative',()=>{
  let s=running();s.ripe=1;s.growthRemaining=28;
  s.robots.forEach(r=>Object.assign(r,LOCATIONS.garden));
  s=assignDecisions(s,{pip:'harvest',moss:'harvest',dot:'harvest'});
  s.robots.forEach(r=>assert.ok(r.duration>=6&&r.duration<=12));
  s=advance(s,13);assert.equal(s.crops,1);assert.equal(s.ripe,0);
});
test('pause freezes weather, tasks, resources, and random state',()=>{
  const s={...assignDecisions(running(),{pip:'fish'}),status:'paused'};
  assert.equal(tick(s),s);assert.equal(assignDecisions(s,{pip:'shelter'}),s);
});
test('same seed and decisions replay exactly; different seeds change task durations',()=>{
  const play=seed=>advance(assignDecisions(running(seed),{pip:'fish',moss:'harvest'}),17);
  assert.deepEqual(play(9),play(9));
  assert.notEqual(assignDecisions(running(9),{pip:'fish'}).robots[0].duration,assignDecisions(running(10),{pip:'fish'}).robots[0].duration);
});
test('weather sequence is independent of work-related random draws',()=>{
  let a=running(77),b=running(77);
  for(const s of [a,b])s.robots.forEach(r=>r.health=99);
  a=assignDecisions(a,{pip:'fish',moss:'harvest'});
  a=assignDecisions(a,{pip:'shelter',moss:'shelter',dot:'shelter'},undefined,true);
  b=assignDecisions(b,{pip:'shelter',moss:'shelter',dot:'shelter'});
  for(let i=0;i<1200;i++){
    a=tick(a);b=tick(b);
    assert.equal(a.weather,b.weather);assert.equal(a.weatherRemaining,b.weatherRemaining);assert.equal(a.weatherRng,b.weatherRng);
  }
});
test('storm hurts exposed robots, travelling toward the cabin is not shelter, and death ends the run',()=>{
  let s=running();s.weather='storm';s.weatherRemaining=30;
  Object.assign(s.robots[1],LOCATIONS.cabin,{health:80});s.robots[0].health=1;
  s=assignDecisions(s,{pip:'shelter'});s=tick(s);
  assert.equal(s.robots[0].phase,'dead');assert.equal(s.status,'lost');assert.ok(s.robots[1].health>=80);
  assert.equal(tick(s),s);
});
test('cabin heals but empty batteries still halt work',()=>{
  let s=running();Object.assign(s.robots[1],LOCATIONS.cabin,{health:50,battery:0});
  s=assignDecisions(s,{pip:'fish'});s.robots[0].battery=0;const remaining=s.robots[0].remaining;
  s=advance(s,2);assert.equal(s.robots[0].remaining,remaining);assert.ok(s.robots[1].health>50);assert.equal(s.robots[1].battery,0);
});
test('stale weather discards a response; changed jobs cannot be overwritten by stale decisions',()=>{
  let s=running();const expected=snapshot(s);s.weatherVersion++;
  assert.equal(assignDecisions(s,{pip:'fish'},expected),s);
  s=running();s.robots[0].health=70;const before=snapshot(s);s=assignDecisions(s,{pip:'shelter'});
  s=assignDecisions(s,{pip:'fish',moss:'harvest'},before);
  assert.equal(s.robots[0].task,'shelter');assert.equal(s.robots[1].task,'harvest');
});
test('a completed goal wins only with all robots alive',()=>{
  let s=running();s.fish=100;s.crops=100;s=tick(s);assert.equal(s.status,'won');assert.equal(tick(s),s);
  s=running();s.fish=100;s.crops=100;s.weather='storm';s.robots[0].health=1;s=tick(s);assert.equal(s.status,'lost');
});
test('baseline controller can complete several seeded runs without a hidden rescue',()=>{
  for(const seed of [1,42,99]){
    let s=running(seed);
    for(let i=0;i<7200&&s.status==='running';i++){if(i%20===0)s=assignDecisions(s,demoDecisions(s));s=tick(s);}
    assert.equal(s.status,'won',`seed ${seed}: ${s.fish} fish / ${s.crops} crops, status ${s.status}`);
    assert.ok(s.robots.every(r=>r.health>0));
  }
});

test('cabin heals health without charging the battery',()=>{
  let s=running();Object.assign(s.robots[0],LOCATIONS.cabin,{health:70,battery:30,task:'shelter',phase:'work'});
  s=advance(s,2);assert.equal(s.robots[0].health,73);assert.equal(s.robots[0].battery,30);
});
test('a recovered shelter task completes in clear weather and accepts a new work assignment',()=>{
  let s=running();Object.assign(s.robots[0],LOCATIONS.cabin,{health:100,battery:100,task:'shelter',phase:'work'});
  const oldJob=s.robots[0].job;s=tick(s);
  assert.equal(s.robots[0].phase,'idle');assert.equal(s.robots[0].task,'wait');assert.equal(s.robots[0].job,oldJob+1);
  s=assignDecisions(s,{pip:'fish'});assert.equal(s.robots[0].phase,'travel');assert.equal(s.robots[0].task,'fish');
});
test('shelter remains active during warning and storm even at full health',()=>{
  for(const weather of ['warning','storm']){
    let s=running();s.weather=weather;s.weatherRemaining=10;
    Object.assign(s.robots[0],LOCATIONS.cabin,{health:100,battery:70,task:'shelter',phase:'work'});
    s=advance(s,1);assert.equal(s.robots[0].task,'shelter');assert.equal(s.robots[0].phase,'work');assert.equal(s.robots[0].battery,70);
  }
});
test('the dock charges without healing, and completes the charge at full battery',()=>{
  let s=running();Object.assign(s.robots[0],LOCATIONS.charger,{health:60,battery:98,task:'charge',phase:'work'});
  s=advance(s,.5);assert.equal(s.robots[0].battery,100);assert.equal(s.robots[0].health,60);assert.equal(s.robots[0].phase,'idle');
});

test('Live Jev receives productive choices after every robot recovers in clear weather',()=>{
  let s=running();s.robots.forEach(r=>Object.assign(r,LOCATIONS.cabin,{health:100,battery:100,task:'shelter',phase:'work'}));
  const stale=snapshot(s);s=tick(s);
  const state=agentState(s),questions=buildQuestions(state.robots);
  for(const r of state.robots){
    assert.equal(r.needs_new_task,true);
    assert.deepEqual(Object.keys(questions[r.id].criteria),['fish','harvest']);
  }
  const unchanged=assignDecisions(s,{pip:'shelter'},stale);
  assert.equal(unchanged.robots[0].task,'wait');
  s=assignDecisions(s,{pip:'fish',moss:'harvest',dot:'fish'},snapshot(s));
  assert.ok(s.robots.every(r=>r.phase==='travel'));
});

test('Live Jev can continue storm shelter, then gets fresh work choices when skies clear',()=>{
  let s=running();s.weather='storm';s.weatherRemaining=.25;
  s.robots.forEach(r=>Object.assign(r,LOCATIONS.cabin,{health:100,battery:100,task:'shelter',phase:'work'}));
  const during=buildQuestions(agentState(s).robots);
  assert.ok(during.pip.criteria.shelter&&during.pip.criteria.continue);
  s=tick(s);const after=buildQuestions(agentState(s).robots);
  assert.equal(after.pip.criteria.shelter,undefined);assert.equal(after.pip.criteria.continue,undefined);
  assert.equal(agentState(s).weather.seconds_until_storm,Math.ceil(s.weatherRemaining)+20);
});

test('empty battery at the cabin can reach the dock and recharge without healing there',()=>{
  let s=running();Object.assign(s.robots[0],LOCATIONS.cabin,{health:100,battery:0});
  assert.deepEqual(availableTasks(s,s.robots[0]),['charge']);
  assert.equal(agentState(s).rules.cabin_battery_per_second,0);
  s.weatherRemaining=100;s=assignDecisions(s,{pip:'charge'});s=advance(s,90);
  assert.equal(s.robots[0].battery,100);assert.equal(s.robots[0].phase,'idle');
  assert.deepEqual({x:s.robots[0].x,y:s.robots[0].y},LOCATIONS.charger);
});

test('Moss cannot abandon unfinished cabin repairs for a harvest and bounce back',()=>{
  let s=running();Object.assign(s.robots[1],LOCATIONS.cabin,{health:70,battery:90});
  s=assignDecisions(s,{moss:'shelter'});s=advance(s,3);
  const question=buildQuestions(agentState(s).robots).moss;
  assert.equal(question.criteria.harvest,undefined);
  s=assignDecisions(s,{moss:'harvest'},snapshot(s));s=advance(s,2);
  assert.equal(s.robots[1].task,'shelter');assert.equal(s.robots[1].x,LOCATIONS.cabin.x);
  s=advance(s,16);assert.equal(s.robots[1].health,100);
  s=assignDecisions(s,{moss:'harvest'},snapshot(s));assert.equal(s.robots[1].task,'harvest');
});

test('Moss commits to one harvest through travel and work unless conditions become urgent',()=>{
  let s=running();Object.assign(s.robots[1],LOCATIONS.cabin,{health:98,battery:90});
  s=assignDecisions(s,{moss:'harvest'});s=advance(s,3);
  const job=s.robots[1].job;
  assert.equal(buildQuestions(agentState(s).robots).moss.criteria.shelter,undefined);
  s=assignDecisions(s,{moss:'shelter'},snapshot(s));assert.equal(s.robots[1].task,'harvest');assert.equal(s.robots[1].job,job);
  s=advance(s,17);assert.ok(s.crops>0);
});

test('storm shelter cannot be abandoned between decisions, but danger can interrupt work',()=>{
  let s=running();s.weather='warning';s.weatherRemaining=18;
  Object.assign(s.robots[1],LOCATIONS.cabin,{health:100,battery:90,task:'shelter',phase:'work'});
  s=assignDecisions(s,{moss:'harvest'},snapshot(s));assert.equal(s.robots[1].task,'shelter');
  s=running();s=assignDecisions(s,{moss:'harvest'});s.weather='warning';
  s=assignDecisions(s,{moss:'shelter'},snapshot(s));assert.equal(s.robots[1].task,'shelter');
});

test('low battery and critical health can interrupt a committed work task',()=>{
  for(const [field,value,task] of [['battery',19,'charge'],['health',35,'shelter']]){
    let s=assignDecisions(running(),{moss:'harvest'});s.robots[1][field]=value;
    assert.ok(availableTasks(s,s.robots[1]).includes(task));
    s=assignDecisions(s,{moss:task},snapshot(s));assert.equal(s.robots[1].task,task);
  }
});

test('charging completes before collection resumes but a storm can interrupt it',()=>{
  let s=running();Object.assign(s.robots[1],LOCATIONS.charger,{battery:30});
  s=assignDecisions(s,{moss:'charge'});s=assignDecisions(s,{moss:'harvest'},snapshot(s));
  assert.equal(s.robots[1].task,'charge');
  s.weather='warning';assert.ok(availableTasks(s,s.robots[1]).includes('shelter'));
  s=assignDecisions(s,{moss:'shelter'},snapshot(s));assert.equal(s.robots[1].task,'shelter');
});

test('manual controls can override autonomous commitment and invalidate pending answers',()=>{
  let s=assignDecisions(running(),{moss:'harvest'});const old=snapshot(s);
  s=assignDecisions(s,{moss:'shelter'},undefined,true);
  assert.equal(s.robots[1].task,'shelter');
  s=assignDecisions(s,{moss:'harvest'},old);assert.equal(s.robots[1].task,'shelter');
});

test('energy and recovery use the new balance, also disclosed to Live Jev',()=>{
  let s=running();Object.assign(s.robots[0],LOCATIONS.pond,{battery:90});s=assignDecisions(s,{pip:'fish'});
  s=advance(s,1);assert.ok(Math.abs(s.robots[0].battery-89.05)<1e-8);
  s=running();Object.assign(s.robots[0],LOCATIONS.charger,{battery:50,health:70});s=assignDecisions(s,{pip:'charge'});
  s=advance(s,1);assert.equal(s.robots[0].battery,54);assert.equal(s.robots[0].health,70);
  const state=agentState(s);assert.equal(state.rules.charger_battery_per_second,4);assert.equal(state.rules.cabin_repairs_per_second,1.5);
  assert.ok(state.robots[0].travel_seconds_to_cabin>=9);
});

test('random storms arrive more often and replay exactly for a seed',()=>{
  const lengths=new Set();
  for(let seed=1;seed<=30;seed++){
    let s=running(seed);assert.ok(s.weatherRemaining>=50&&s.weatherRemaining<=80);lengths.add(s.weatherRemaining);
    s.robots.forEach(r=>Object.assign(r,LOCATIONS.cabin));
    s.weatherRemaining=.25;s=tick(s);assert.equal(s.weather,'warning');assert.equal(s.weatherRemaining,20);
    s=advance(s,20);assert.equal(s.weather,'storm');assert.ok(s.weatherRemaining>=18&&s.weatherRemaining<=32);
  }
  assert.equal(lengths.size,30);
});

test('fishing reactions match actual no-catch, ordinary, and lucky rewards without consuming randomness',()=>{
  const seen=new Set();
  for(let seed=1;seed<=100;seed++){
    let s=assignDecisions(running(seed),{pip:'fish'});s=advance(s,17);
    const reaction=s.robots[0].reaction;assert.ok(reaction);seen.add(reaction.kind);
    assert.equal(reaction.kind,s.fish>=7?'lucky':s.fish?'happy':'sad');
    assert.ok(reaction.until>s.events.find(e=>e.id===reaction.id).time);
    const publicBot=agentState(s).robots[0];assert.equal(publicBot.reaction,undefined);
  }
  assert.deepEqual([...seen].sort(),['happy','lucky','sad']);
});

test('harvest reactions distinguish a collected crop from exhausted shared stock',()=>{
  let s=running();s.ripe=1;s.growthRemaining=28;s.robots.forEach(r=>Object.assign(r,LOCATIONS.garden));
  s=assignDecisions(s,{pip:'harvest',moss:'harvest',dot:'harvest'});s=advance(s,13);
  assert.equal(s.crops,1);assert.equal(s.robots.filter(r=>r.reaction?.kind==='happy').length,1);
  assert.equal(s.robots.filter(r=>r.reaction?.kind==='sad').length,2);
});
