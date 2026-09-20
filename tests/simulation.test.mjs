import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,tick,assignDecisions,demoDecisions,snapshot,LOCATIONS} from '../lib/simulation.ts';
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
  a=assignDecisions(a,{pip:'fish',moss:'harvest'});
  a=assignDecisions(a,{pip:'shelter',moss:'shelter',dot:'shelter'});
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
test('cabin restores health and emergency battery; work does not progress on an empty battery',()=>{
  let s=running();Object.assign(s.robots[1],LOCATIONS.cabin,{health:50,battery:0});
  s=assignDecisions(s,{pip:'fish'});s.robots[0].battery=0;const remaining=s.robots[0].remaining;
  s=advance(s,2);assert.equal(s.robots[0].remaining,remaining);assert.ok(s.robots[1].health>50&&s.robots[1].battery>0);
});
test('stale weather discards a response; changed jobs cannot be overwritten by stale decisions',()=>{
  let s=running();const expected=snapshot(s);s.weatherVersion++;
  assert.equal(assignDecisions(s,{pip:'fish'},expected),s);
  s=running();const before=snapshot(s);s=assignDecisions(s,{pip:'shelter'});
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
