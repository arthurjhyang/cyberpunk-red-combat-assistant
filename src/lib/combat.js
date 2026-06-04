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
  const isAreaAttack = Boolean(attack.area || weapon.area);
  const targetPart = isAreaAttack ? "body" : config.targetPart;
  const isHeadShot = targetPart === "head";
  const aimedPenalty = config.aimed || isHeadShot ? -8 : 0;
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

  let damage = { rolls: [], total: 0, baseTotal: 0, crit: false, expr: damageExpr, multiplier: 1 };
  if (hit && !attack.noDamage && !weapon.manualDamage && config.autoRollDamage) {
    damage = { ...rollDamage(damageExpr), expr: damageExpr };
    if (config.attackType === "autofire") {
      const margin = Math.min(Math.max(attackTotal - targetTotal, 1), weapon.cap);
      damage = { ...damage, baseTotal: damage.total, margin, multiplier: margin, total: damage.total * margin };
    } else {
      damage = { ...damage, baseTotal: damage.total };
    }
  }

  const ruleNotes = [];
  if (isHeadShot) ruleNotes.push("头部/弱点攻击自动应用 -8 修正；伤害穿过 SP 后再翻倍。");
  if (isAreaAttack) ruleNotes.push("区域攻击不能瞄准头部，护甲削减只按身体位置处理。");
  if (attack.halfArmor) ruleNotes.push("近战/武术按半数 SP 计算防护，但削甲仍从原 SP 扣 1。");
  if (config.attackType === "autofire") ruleNotes.push("全自动先用命中差额计算倍率，再从乘后的伤害中扣 SP。");
  if (damage.crit) ruleNotes.push("伤害骰出现两颗或更多 6，触发严重伤势并额外造成 5 点 HP 伤害。");
  if (useDodge && attack.defender === "range") ruleNotes.push("远程闪避应在攻击掷骰前声明；本工具用防御骰结果作为攻击 DV。");

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
    aimedPenalty,
    targetPart,
    requestedTargetPart: config.targetPart,
    isAreaAttack,
    isHeadShot,
    ruleNotes,
    hit,
    damage
  };
}

export function applyDamage(card, rawDamage, attack, targetPart, isCrit) {
  const spKey = targetPart === "head" ? "headSp" : "bodySp";
  const originalSp = num(card[spKey]);
  const effectiveSp = attack.halfArmor ? Math.ceil(originalSp / 2) : originalSp;
  const penetrated = Math.max(0, num(rawDamage) - effectiveSp);
  const headMultiplier = targetPart === "head" && penetrated > 0 ? 2 : 1;
  const postLocationDamage = penetrated * headMultiplier;
  const critBonus = isCrit ? 5 : 0;
  const finalDamage = postLocationDamage + critBonus;
  const armorAbated = penetrated > 0 && originalSp > 0;
  const nextHp = num(card.hp) - finalDamage;
  return {
    card: {
      ...card,
      hp: nextHp,
      [spKey]: armorAbated ? Math.max(0, originalSp - 1) : originalSp
    },
    finalDamage,
    penetrated,
    originalSp,
    effectiveSp,
    headMultiplier,
    postLocationDamage,
    critBonus,
    hpBefore: num(card.hp),
    hpAfter: nextHp,
    spKey,
    armorAbated
  };
}

function clampDie(value) {
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 10 ? parsed : null;
}
