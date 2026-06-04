import test from "node:test";
import assert from "node:assert/strict";
import { sampleCards } from "../data/sampleCards.js";
import { applyDamage, resolveCombat } from "./combat.js";

function cloneCards(patch = {}) {
  return {
    "slot-1": { ...sampleCards["slot-1"], skills: { ...sampleCards["slot-1"].skills } },
    "slot-2": { ...sampleCards["slot-2"], skills: { ...sampleCards["slot-2"].skills } },
    "slot-3": { ...sampleCards["slot-3"], skills: { ...sampleCards["slot-3"].skills } },
    "slot-4": { ...sampleCards["slot-4"], skills: { ...sampleCards["slot-4"].skills } },
    ...patch
  };
}

function config(patch = {}) {
  return {
    attacker: "slot-1",
    defender: "slot-2",
    attackType: "ranged",
    weaponId: "mediumPistol",
    distanceBand: 0,
    targetPart: "body",
    modifier: 0,
    attackDie: "5",
    defenseDie: "5",
    aimed: false,
    forceDodge: false,
    autoRollDamage: false,
    ...patch
  };
}

test("ranged attacks use the weapon distance DV when the defender cannot dodge bullets", () => {
  const result = resolveCombat(cloneCards(), config());

  assert.equal(result.useDodge, false);
  assert.equal(result.targetTotal, 13);
  assert.equal(result.attackBase, 14);
  assert.equal(result.attackTotal, 19);
  assert.equal(result.hit, true);
});

test("out-of-range handgun attacks return a DV error unless dodge is forced", () => {
  const result = resolveCombat(cloneCards(), config({ distanceBand: 7 }));

  assert.equal(result.error, "当前距离没有可用 DV。请换距离、换武器，或改用闪避对抗。");
});

test("REF 8 defenders roll evasion against ranged attacks", () => {
  const result = resolveCombat(cloneCards(), config({ defender: "slot-4" }));

  assert.equal(result.useDodge, true);
  assert.equal(result.defenseBase, 15);
  assert.equal(result.targetTotal, 20);
  assert.equal(result.targetLabel, "敏捷 + 闪避");
});

test("head or weak-point attacks apply the aimed -8 modifier", () => {
  const result = resolveCombat(cloneCards(), config({ targetPart: "head" }));

  assert.equal(result.isHeadShot, true);
  assert.equal(result.aimedPenalty, -8);
  assert.equal(result.modifier, -8);
  assert.equal(result.attackTotal, 11);
});

test("area shotgun shells force body targeting and fixed DV 13", () => {
  const result = resolveCombat(cloneCards(), config({
    attackType: "shotgunShell",
    weaponId: "shotgunShell",
    targetPart: "head",
    attackDie: "8"
  }));

  assert.equal(result.isAreaAttack, true);
  assert.equal(result.targetPart, "body");
  assert.equal(result.requestedTargetPart, "head");
  assert.equal(result.targetTotal, 13);
});

test("autofire caps the hit-margin multiplier by weapon cap", () => {
  const result = resolveCombat(cloneCards(), config({
    attackType: "autofire",
    weaponId: "smgAuto",
    distanceBand: 1,
    attackDie: "10",
    autoRollDamage: true
  }));

  assert.equal(result.hit, true);
  assert.equal(result.targetTotal, 17);
  assert.equal(result.damage.margin, 3);
  assert.equal(result.damage.multiplier, 3);
  assert.equal(result.damage.total, result.damage.baseTotal * 3);
});

test("head damage doubles only penetrated damage and then adds critical injury bonus", () => {
  const result = applyDamage({ ...sampleCards["slot-1"], hp: 45, headSp: 5 }, 20, {}, "head", true);

  assert.equal(result.originalSp, 5);
  assert.equal(result.penetrated, 15);
  assert.equal(result.headMultiplier, 2);
  assert.equal(result.critBonus, 5);
  assert.equal(result.finalDamage, 35);
  assert.equal(result.card.hp, 10);
  assert.equal(result.card.headSp, 4);
});

test("half-armor attacks halve effective SP but ablate the original armor by one", () => {
  const result = applyDamage({ ...sampleCards["slot-1"], hp: 45, bodySp: 11 }, 10, { halfArmor: true }, "body", false);

  assert.equal(result.originalSp, 11);
  assert.equal(result.effectiveSp, 6);
  assert.equal(result.penetrated, 4);
  assert.equal(result.finalDamage, 4);
  assert.equal(result.card.hp, 41);
  assert.equal(result.card.bodySp, 10);
});
