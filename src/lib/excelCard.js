import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import { blankSkills } from "../data/sampleCards.js";
import { num } from "./combat.js";

const SHEET_CHARACTER = "人物卡";
const SHEET_GEAR = "装备卡";

const statCells = {
  int: ["P4", "K4"],
  ref: ["P6", "K6"],
  dex: ["P8", "K8"],
  tech: ["P10", "K10"],
  cool: ["P12", "K12"],
  will: ["P14", "K14"],
  move: ["P18", "K18"],
  body: ["P20", "K20"],
  emp: ["P22", "K22"]
};

const skillBaseCells = {
  brawling: { base: ["AK3"], points: ["AJ3"], stat: "dex" },
  evasion: { base: ["AK4"], points: ["AJ4"], stat: "dex" },
  martialArts: { base: ["AK5"], points: ["AJ5"], stat: "dex" },
  meleeWeapon: { base: ["AK8"], points: ["AJ8"], stat: "dex" },
  archery: { base: ["AK10"], points: ["AJ10"], stat: "ref" },
  autofire: { base: ["AK11"], points: ["AJ11"], stat: "ref" },
  handgun: { base: ["AK12"], points: ["AJ12"], stat: "ref" },
  heavyWeapons: { base: ["AK13"], points: ["AJ13"], stat: "ref" },
  shoulderArms: { base: ["AK14"], points: ["AJ14"], stat: "ref" },
  athletics: { base: ["X11"], points: ["W11"], stat: "dex" },
  concentration: { base: ["X15", "X5"], points: ["W15", "W5"], stat: "will" },
  firstAid: { base: ["AK32", "AK31"], points: ["AJ32", "AJ31"], stat: "tech" }
};

const writebackCells = {
  hp: `${SHEET_CHARACTER}!K30`,
  headSp: `${SHEET_GEAR}!AE5`,
  bodySp: `${SHEET_GEAR}!AE9`
};

const weaponRows = [5, 17, 29, 41];

export async function readWorkbookFile(file, handle = null) {
  const buffer = await file.arrayBuffer();
  return readWorkbookBuffer(file.name, buffer, handle);
}

export async function readWorkbookBuffer(fileName, buffer, handle = null) {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellFormula: true,
    cellStyles: true,
    cellDates: true
  });
  const card = {
    ...extractCard(workbook, fileName),
    avatar: extractAvatarFromWorkbookBuffer(buffer)
  };
  return {
    fileName,
    handle,
    workbook,
    card,
    dirty: false,
    canDirectSave: Boolean(handle?.createWritable || handle?.electronPath)
  };
}

function extractAvatarFromWorkbookBuffer(buffer) {
  try {
    const zip = unzipSync(new Uint8Array(buffer));
    const media = Object.entries(zip)
      .filter(([name]) => /^xl\/media\/image\d+\.(png|jpe?g|webp)$/i.test(name))
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes.length - a.bytes.length);
    const image = media[0];
    if (!image) return "";
    return `data:${mimeForImage(image.name, image.bytes)};base64,${uint8ToBase64(image.bytes)}`;
  } catch {
    return "";
  }
}

function mimeForImage(name, bytes) {
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (bytes?.[0] === 0xff && bytes?.[1] === 0xd8) return "image/jpeg";
  if (bytes?.[0] === 0x52 && bytes?.[1] === 0x49 && bytes?.[2] === 0x46 && bytes?.[3] === 0x46) return "image/webp";
  return "image/png";
}

export async function openWorkbookWithPicker() {
  if (window.electronFiles?.openWorkbook) {
    const picked = await window.electronFiles.openWorkbook();
    if (!picked) {
      throw new Error("已取消选择文件。");
    }
    return readWorkbookBuffer(picked.fileName, base64ToArrayBuffer(picked.base64), {
      electronPath: picked.filePath
    });
  }
  if (!window.showOpenFilePicker) {
    throw new Error("当前环境不支持直接授权写回，请使用拖拽或选择导入。");
  }
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [
      {
        description: "Excel 自动卡",
        accept: {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
        }
      }
    ]
  });
  const file = await handle.getFile();
  return readWorkbookFile(file, handle);
}

export function extractCard(workbook, fileName = "") {
  const character = workbook.Sheets[SHEET_CHARACTER];
  const gear = workbook.Sheets[SHEET_GEAR];
  if (!character) {
    throw new Error("没有找到“人物卡”工作表。");
  }

  const stats = Object.fromEntries(
    Object.entries(statCells).map(([key, cells]) => [key, firstNumber(character, cells)])
  );
  const skills = { ...blankSkills };
  for (const [key, rule] of Object.entries(skillBaseCells)) {
    skills[key] = readSkillLevel(character, rule, stats);
  }

  const hp = num(cellValue(character.K30));
  const maxHp = num(cellValue(character.O30)) || hp;
  const headSp = gear ? firstNumber(gear, ["AE5", "AE27"]) : firstNumber(character, ["BA24"]);
  const bodySp = gear ? firstNumber(gear, ["AE9", "AE31"]) : firstNumber(character, ["BA28"]);

  return {
    name: textValue(character.D17) || fileName.replace(/\.xlsx$/i, ""),
    alias: textValue(character.D18),
    hp,
    maxHp,
    headSp,
    bodySp,
    deathPenalty: 0,
    ...stats,
    skills,
    weapons: gear ? extractWeapons(gear) : [],
    source: {
      fileName,
      sheetType: "鲨鱼包/芬里尔 1.7+ 自动卡",
      writebackCells
    }
  };
}

export function updateWorkbookFromCard(source, card) {
  if (!source?.workbook) return null;
  setCellByAddress(source.workbook, writebackCells.hp, num(card.hp));
  setCellByAddress(source.workbook, writebackCells.headSp, num(card.headSp));
  setCellByAddress(source.workbook, writebackCells.bodySp, num(card.bodySp));
  return { ...source, dirty: true, card };
}

export async function saveWorkbookToHandle(source) {
  if (source?.handle?.electronPath && window.electronFiles?.saveWorkbook) {
    const buffer = writeWorkbookBuffer(source.workbook);
    await window.electronFiles.saveWorkbook({
      filePath: source.handle.electronPath,
      base64: arrayBufferToBase64(buffer)
    });
    return { ...source, dirty: false };
  }
  if (!source?.handle?.createWritable) {
    throw new Error("这张卡没有授权文件句柄，请先用“授权打开”载入原文件。");
  }
  const buffer = writeWorkbookBuffer(source.workbook);
  const writable = await source.handle.createWritable();
  await writable.write(buffer);
  await writable.close();
  return { ...source, dirty: false };
}

export async function downloadWorkbook(source, suffix = "战斗回写") {
  if (!source?.workbook) {
    throw new Error("没有可导出的工作簿。");
  }
  const buffer = writeWorkbookBuffer(source.workbook);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const base = source.fileName?.replace(/\.xlsx$/i, "") || "自动卡";
  link.href = url;
  link.download = `${base}-${suffix}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function extractWeapons(gear) {
  return weaponRows
    .map(row => ({
      row,
      name: textValue(gear[`C${row}`]),
      type: textValue(gear[`E${row}`]),
      skill: textValue(gear[`F${row}`]),
      damage: textValue(gear[`G${row}`]),
      magazine: textValue(gear[`H${row}`]),
      rof: textValue(gear[`I${row}`]),
      autofire: textValue(gear[`J${row}`]),
      armorPierce: textValue(gear[`M${row}`])
    }))
    .filter(weapon => weapon.name || weapon.damage || weapon.skill);
}

function cellValue(cell) {
  return cell?.v ?? "";
}

function firstNumber(sheet, cells) {
  for (const address of cells) {
    const value = num(cellValue(sheet?.[address]));
    if (value > 0) return value;
  }
  return 0;
}

function readSkillLevel(sheet, rule, stats) {
  const base = firstNumber(sheet, rule.base);
  const statValue = num(stats[rule.stat]);
  if (base > statValue) return Math.max(0, base - statValue);
  const points = firstNumber(sheet, rule.points);
  if (points > 0) return points;
  return base > 0 ? base : 0;
}

function textValue(cell) {
  const value = cellValue(cell);
  return value === null || value === undefined ? "" : String(value).trim();
}

function setCellByAddress(workbook, address, value) {
  const [sheetName, cellAddress] = address.split("!");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return;
  sheet[cellAddress] = {
    ...(sheet[cellAddress] || {}),
    t: "n",
    v: value,
    w: String(value)
  };
}

function writeWorkbookBuffer(workbook) {
  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    cellStyles: true
  });
}

function base64ToArrayBuffer(base64) {
  const binary = globalThis.atob ? globalThis.atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  return uint8ToBase64(bytes);
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa ? globalThis.btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}
