import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorld, interpretDemo, makePlan, applyPlan, publicState} from '../lib/world.ts';

test('an available worker waters plants without disturbing the charging robot', () => {
  const before=initialWorld();
  const answer=interpretDemo('Send someone to water the plants, but leave the charging robot alone.',before);
  const plan=makePlan(answer), after=applyPlan(before,plan);
  assert.deepEqual(plan.robots,['pip']);
  assert.equal(after.moisture,64);
  assert.deepEqual(after.robots[2],before.robots[2]);
  assert.equal(answer.mode,'demo');
  assert.equal(answer.usage,undefined);
});
test('everyone includes all three robots when there is no exclusion', () => {
  const before=initialWorld();
  const after=applyPlan(before,makePlan(interpretDemo('Get everyone inside before the storm.',before)));
  assert.ok(after.robots.every(r=>r.place==='cabin'));
});
test('excluded lights retain their existing state', () => {
  const before={...initialWorld(),lights:{porch:.8,garden:1,cabin:.6}};
  const after=applyPlan(before,makePlan(interpretDemo('Turn everything off except the porch',before)));
  assert.deepEqual(after.lights,{porch:.8,garden:0,cabin:0});
  const evening=applyPlan(initialWorld(),makePlan(interpretDemo('Turn on all lights except the cabin',initialWorld())));
  assert.ok(evening.lights.porch>0&&evening.lights.garden>0);
  assert.equal(evening.lights.cabin,0);
});
test('unsupported, negative, and compound commands leave the world unchanged', () => {
  const before=initialWorld();
  for(const command of ['Build a spaceship',"Don't send Pip to the pond",'Send Pip to the pond then water the garden']) {
    const plan=makePlan(interpretDemo(command,before));
    assert.equal(plan.supported,false,command);
    assert.equal(applyPlan(before,plan),before);
  }
});
test('missing destination pauses for a choice and cannot move a robot', () => {
  const before=initialWorld();
  const plan=makePlan(interpretDemo('Send Pip somewhere',before));
  assert.equal(plan.needsReview,true);
  assert.equal(plan.destination,null);
  assert.equal(applyPlan(before,plan),before);
  const after=applyPlan(before,{...plan,destination:'pond',needsReview:false});
  assert.equal(after.robots[0].place,'pond');
});
test('uncertain targets and action distributions trigger review', () => {
  const answer=interpretDemo('Send Pip to the pond',initialWorld());
  answer.mode='live';
  answer.answers.robot_moss.noul=.4;
  assert.equal(makePlan(answer).needsReview,true);
  answer.answers.robot_moss.noul=0;
  answer.answers.action.confidence=.3;
  assert.equal(makePlan(answer).needsReview,true);
});
test('water and battery stay bounded; API context omits rendering coordinates', () => {
  const before=initialWorld();before.moisture=95;before.robots[0].battery=1;
  const after=applyPlan(before,makePlan(interpretDemo('Pip water the garden',before)));
  assert.equal(after.moisture,100);assert.equal(after.robots[0].battery,0);
  const state=publicState('Pip water the garden',before);
  assert.equal('x' in state.robots[0],false);
  assert.equal(state.preferred_available_worker,'moss');
});
