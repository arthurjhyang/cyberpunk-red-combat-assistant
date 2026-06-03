export const statLabels = {
  int: "智力",
  ref: "反应",
  dex: "敏捷",
  tech: "技术",
  cool: "冷静",
  will: "意志",
  move: "移速",
  body: "体格",
  emp: "共情"
};

export const skillLabels = {
  handgun: "手枪",
  shoulderArms: "长管武器",
  heavyWeapons: "重武器",
  archery: "弓道",
  autofire: "自动武器",
  meleeWeapon: "近战武器",
  brawling: "搏击",
  martialArts: "武术",
  evasion: "闪避",
  athletics: "运动",
  concentration: "专注",
  firstAid: "急救"
};

export const rangeDv = {
  handgun: [13, 15, 20, 25, 30, 30, null, null],
  smg: [15, 13, 15, 20, 25, 25, 30, null],
  shotgun: [13, 15, 20, 25, 30, 35, null, null],
  assaultRifle: [17, 16, 15, 13, 15, 20, 25, 30],
  sniperRifle: [30, 25, 25, 20, 15, 16, 17, 20],
  bow: [15, 13, 15, 17, 20, 22, null, null],
  grenadeLauncher: [16, 15, 15, 17, 20, 22, 25, null],
  rocketLauncher: [17, 16, 15, 15, 20, 20, 25, 30]
};

export const autofireDv = {
  smg: [20, 17, 20, 25, 30, null, null, null],
  assaultRifle: [22, 20, 17, 20, 25, null, null, null]
};

export const distanceBands = [
  "0-6 米",
  "7-12 米",
  "13-25 米",
  "26-50 米",
  "51-100 米",
  "101-200 米",
  "201-400 米",
  "401-800 米"
];

export const attackModes = {
  ranged: {
    label: "远程单发",
    stat: "ref",
    defender: "range",
    weapons: [
      { id: "mediumPistol", label: "中型手枪", family: "handgun", skill: "handgun", damage: "2d6", rof: 2 },
      { id: "heavyPistol", label: "重型手枪", family: "handgun", skill: "handgun", damage: "3d6", rof: 2 },
      { id: "veryHeavyPistol", label: "超重型手枪", family: "handgun", skill: "handgun", damage: "4d6", rof: 1 },
      { id: "smg", label: "冲锋枪", family: "smg", skill: "handgun", damage: "2d6", rof: 1 },
      { id: "heavySmg", label: "重型冲锋枪", family: "smg", skill: "handgun", damage: "3d6", rof: 1 },
      { id: "shotgunSlug", label: "霰弹枪独头弹", family: "shotgun", skill: "shoulderArms", damage: "5d6", rof: 1 },
      { id: "assaultRifle", label: "突击步枪", family: "assaultRifle", skill: "shoulderArms", damage: "5d6", rof: 1 },
      { id: "sniperRifle", label: "狙击步枪", family: "sniperRifle", skill: "shoulderArms", damage: "5d6", rof: 1 },
      { id: "bow", label: "弓/十字弩", family: "bow", skill: "archery", damage: "4d6", rof: 1 },
      { id: "grenadeLauncher", label: "榴弹发射器", family: "grenadeLauncher", skill: "heavyWeapons", damage: "6d6", rof: 1 },
      { id: "rocketLauncher", label: "火箭筒", family: "rocketLauncher", skill: "heavyWeapons", damage: "8d6", rof: 1 }
    ]
  },
  autofire: {
    label: "全自动射击",
    stat: "ref",
    defender: "range",
    weapons: [
      { id: "smgAuto", label: "冲锋枪全自动", family: "smg", skill: "autofire", damage: "2d6", cap: 3 },
      { id: "assaultAuto", label: "突击步枪全自动", family: "assaultRifle", skill: "autofire", damage: "2d6", cap: 4 }
    ]
  },
  shotgunShell: {
    label: "霰弹",
    stat: "ref",
    defender: "dv",
    fixedDv: 13,
    weapons: [
      { id: "shotgunShell", label: "霰弹枪霰弹", family: "shotgun", skill: "shoulderArms", damage: "3d6", rof: 1 }
    ]
  },
  melee: {
    label: "近战武器",
    stat: "dex",
    defender: "evasion",
    halfArmor: true,
    weapons: [
      { id: "lightMelee", label: "轻型近战武器", skill: "meleeWeapon", damage: "1d6", rof: 2 },
      { id: "mediumMelee", label: "中型近战武器", skill: "meleeWeapon", damage: "2d6", rof: 2 },
      { id: "heavyMelee", label: "重型近战武器", skill: "meleeWeapon", damage: "3d6", rof: 2 },
      { id: "veryHeavyMelee", label: "超重型近战武器", skill: "meleeWeapon", damage: "4d6", rof: 1 }
    ]
  },
  brawling: {
    label: "搏击",
    stat: "dex",
    defender: "evasion",
    bodyDamage: true,
    weapons: [{ id: "brawling", label: "徒手/搏击", skill: "brawling", damage: "body", rof: 2 }]
  },
  martial: {
    label: "武术",
    stat: "dex",
    defender: "evasion",
    halfArmor: true,
    bodyDamage: true,
    weapons: [{ id: "martial", label: "武术攻击", skill: "martialArts", damage: "body", rof: 2 }]
  },
  grapple: {
    label: "擒拿/抢夺",
    stat: "dex",
    defender: "brawling",
    noDamage: true,
    weapons: [{ id: "grapple", label: "擒拿或抢夺", skill: "brawling", damage: "0d6", rof: 1 }]
  },
  throwObject: {
    label: "投掷物体",
    stat: "dex",
    defender: "range",
    weapons: [
      { id: "throwObject", label: "投掷物体", family: "grenadeLauncher", skill: "athletics", damage: "0d6", rof: 1, manualDamage: true }
    ]
  }
};
