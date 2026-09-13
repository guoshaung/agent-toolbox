const assert = require('node:assert/strict');
const test = require('node:test');

test('火柴人行走时两条腿会交替摆动，站立时保持对称', async () => {
  const { stickmanPose } = await import('../src/renderer/tools/focus/battle.js');
  const idle = stickmanPose({ team: 'player', moving: false, walkPhase: 0 });
  const walking = stickmanPose({ team: 'player', moving: true, walkPhase: Math.PI / 4 });
  assert.equal(idle.leftLeg.x, -10);
  assert.equal(idle.rightLeg.x, 10);
  assert.notEqual(walking.leftLeg.x, -10);
  assert.notEqual(walking.rightLeg.x, 10);
  assert.equal(walking.leftLeg.x, -walking.rightLeg.x);
  assert.ok(walking.hipY > idle.hipY);
});

test('火柴人攻击时前伸手臂会改变姿势', async () => {
  const { stickmanPose } = await import('../src/renderer/tools/focus/battle.js');
  const idle = stickmanPose({ team: 'enemy', moving: false, attackClock: 0 });
  const attacking = stickmanPose({ team: 'enemy', moving: false, attackClock: .2 });
  assert.ok(attacking.rightArm.x < idle.rightArm.x);
});

test('不同武器会产生不同的攻击动作参数', async () => {
  const { stickmanPose } = await import('../src/renderer/tools/focus/battle.js');
  const slash = stickmanPose({ team: 'player', weapon: 'sword', moving: false, attackClock: .15, attackDuration: .3 });
  const bow = stickmanPose({ team: 'player', weapon: 'bow', moving: false, attackClock: .15, attackDuration: .3 });
  const pickaxe = stickmanPose({ team: 'player', weapon: 'pickaxe', moving: false, attackClock: .15, attackDuration: .3 });
  assert.equal(slash.weapon, 'sword');
  assert.equal(bow.weapon, 'bow');
  assert.equal(pickaxe.weapon, 'pickaxe');
  assert.ok(pickaxe.leftArm.y < slash.leftArm.y);
  assert.notEqual(bow.rightArm.y, slash.rightArm.y);
});

test('手绘直线刀和弧线弓会被识别为不同战斗类型，并按刀长调整距离', async () => {
  const { analyzeCustomDrawing } = await import('../src/renderer/tools/focus/battle.js');
  const shortSword = analyzeCustomDrawing([[{ x: 108, y: 68 }, { x: 158, y: 54 }]]);
  const longSword = analyzeCustomDrawing([[{ x: 108, y: 68 }, { x: 198, y: 38 }]]);
  const bow = analyzeCustomDrawing([[{ x: 155, y: 35 }, { x: 173, y: 60 }, { x: 155, y: 85 }]]);
  assert.equal(shortSword.combatClass, 'melee');
  assert.equal(longSword.weapon, 'sword');
  assert.ok(longSword.range > shortSword.range);
  assert.equal(bow.combatClass, 'ranged');
  assert.equal(bow.weapon, 'bow');
});

test('不同武器会绑定不同的手部攻击特效', async () => {
  const { handEffectType } = await import('../src/renderer/tools/focus/battle.js');
  assert.equal(handEffectType('sword'), 'energy-trail');
  assert.equal(handEffectType('bow'), 'charge');
  assert.equal(handEffectType('pickaxe'), 'sparks');
});
