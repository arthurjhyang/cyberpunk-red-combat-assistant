import { attackModes, autofireDv, rangeDv } from "../data/rules.js";

export function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function baseFor(card, stat, skill) {
  return num(card?.[stat]) + num(card?.skills?.[skill]);
}

export function woundState(card) {
  if (num(card.hp) < 1) return { label: "致命伤", penalty: -4, tone: "danger" };
  if (num(card.hp) < Math.ceil(num(card.maxHp) / 2)) return { label: "重伤", penalty: -2, tone: "warn" };
  if (num(card.hp) < num(card.maxHp)) return { label: "轻伤", penalty: 0, tone: "warn" };
  return { label: "无伤", penalty: 0, tone: "good" };
}

export function rollD10(fixed) {
  const first = fixed || rollDie(10);
  if (fixed) return { first, total: first, detail: String(first), critical: false, fumble: false };
  if (first === 10) {
    const bonus = rollDie(10);
    return { first, total: first + bonus, detail: `10 + ${bonus}`, critical: true, fumble: false };
  }
  if (first === 1) {
    const penalty = rollDie(10);
    return { first, total: first - penalty, detail: `1 - ${penalty}`, critical: false, fumble: true };
  }
  return { first, total: first, detail: String(first), critical: false, fumble: false };
}

export function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollDamage(expr) {
  const match = String(expr).match(/(\d+)d(\d+)/i);
  const count = match ? Number(match[1]) : 0;
  const sides = match ? Number(match[2]) : 6;
  const rolls = Array.from({ length: count }, () => rollDie(sides));
  return {
    rolls,
    total: rolls.reduce((sum, value) => sum + value, 0),
    crit: rolls.filter(value => value === 6).length >= 2
  };
}

export function bodyDamageDice(body, cyberArm = false) {
  if (num(body) <= 4 && cyberArm) return "2d6";
  if (num(body) <= 4) return "1d6";
  if (num(body) <= 6) return "2d6";
  if (num(body) <= 10) return "3d6";
  return "4d6";
}

export function selectedMode(config) {
  const attack = attackModes[config.attackType] || attackModes.ranged;
  const weapon = attack.weapons.find(item => item.id === config.weaponId) || attack.weapons[0];
  return { attack, weapon };
}

export function targetDv(config, attack, weapon, defender, useDodge) {
  if (attack.fixedDv) return { dv: attack.fixedDv, label: `固定 DV ${attack.fixedDv}` };
  if (useDodge) return null;
  if (config.attackType === "autofire") {
    const dv = autofireDv[weapon.family]?.[num(config.distanceBand)] ?? null;
    return { dv, label: dv ? `全自动距离 DV ${dv}` : "距离超出全自动表" };
  }
  const dv = rangeDv[weapon.family]?.[num(config.distanceBand)] ?? null;
  return { dv, label: dv ? `距离 DV ${dv}` : "距离超出武器射程表" };
}

export function resolveCombat(cards, config) {
  const attacker = cards[config.attacker];
  const defender = cards[config.defender];
  const { attack, weapon } = selectedMode(config);
  const aimedPenalty = config.aimed ? -8 : 0;
  const modifier = num(config.modifier) + aimedPenalty;
  const attackBase = baseFor(attacker, attack.stat, weapon.skill);
  const useDodge =
    attack.defender === "evasion" ||
    attack.defender === "brawling" ||
    config.forceDodge ||
    (attack.defender === "range" && num(defender.ref) >= 8);
  const defenseSkill = attack.defender === "brawling" ? "brawling" : "evasion";
  const defenseBase = baseFor(defender, "dex", defenseSkill);
  const dvInfo = targetDv(config, attack, weapon, defender, useDodge);

  if (!useDodge && (!dvInfo || dvInfo.dv === null)) {
    return { error: "当前距离没有可用 DV。请换距离、换武器，或改用闪避对抗。" };
  }

  const fixedAttack = clampDie(config.attackDie);
  const fixedDefense = clampDie(config.defenseDie);
  const attackRoll = rollD10(fixedAttack);
  const attackTotal = attackBase + attackRoll.total + modifier;
  const defenseRoll = useDodge ? rollD10(fixedDefense) : null;
  const targetTotal = useDodge ? defenseBase + defenseRoll.total : dvInfo.dv;
  const hit = attackTotal > targetTotal;
  const damageExpr = attack.bodyDamage ? bodyDamageDice(attacker.body) : weapon.damage;

  let damage = { rolls: [], total: 0, crit: false, expr: damageExpr };
  if (hit && !attack.noDamage && !weapon.manualDamage && config.autoRollDamage) {
    damage = { ...rollDamage(damageExpr), expr: damageExpr };
    if (config.attackType === "autofire") {
      const margin = Math.min(Math.max(attackTotal - targetTotal, 1), weapon.cap);
      damage = { ...damage, margin, total: damage.total * margin };
    }
  }

  return {
    attack,
    weapon,
    attacker,
    defender,
    attackBase,
    attackRoll,
    attackTotal,
    defenseBase,
    defenseRoll,
    targetTotal,
    targetLabel: useDodge ? `敏捷 + ${defenseSkill === "brawling" ? "搏击" : "闪避"}` : dvInfo.label,
    useDodge,
    modifier,
    hit,
    damage
  };
}

export function applyDamage(card, rawDamage, attack, targetPart, isCrit) {
  const spKey = targetPart === "head" ? "headSp" : "bodySp";
  const originalSp = num(card[spKey]);
  const effectiveSp = attack.halfArmor ? Math.ceil(originalSp / 2) : originalSp;
  const penetrated = Math.max(0, num(rawDamage) - effectiveSp);
  let finalDamage = targetPart === "head" && penetrated > 0 ? penetrated * 2 : penetrated;
  if (isCrit) finalDamage += 5;
  const armorAbated = penetrated > 0 && originalSp > 0;
  return {
    card: {
      ...card,
      hp: num(card.hp) - finalDamage,
      [spKey]: armorAbated ? Math.max(0, originalSp - 1) : originalSp
    },
    finalDamage,
    penetrated,
    originalSp,
    effectiveSp,
    armorAbated
  };
}

function clampDie(value) {
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 10 ? parsed : null;
}
