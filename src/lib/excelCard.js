import * as XLSX from "xlsx";
import { blankSkills } from "../data/sampleCards.js";
import { num } from "./combat.js";

const SHEET_CHARACTER = "人物卡";
const SHEET_GEAR = "装备卡";

const statCells = {
  int: "P4",
  ref: "P6",
  dex: "P8",
  tech: "P10",
  cool: "P12",
  will: "P14",
  move: "P18",
  body: "P20",
  emp: "P22"
};

const skillBaseCells = {
  brawling: ["AK3", "dex"],
  evasion: ["AK4", "dex"],
  martialArts: ["AK5", "dex"],
  meleeWeapon: ["AK8", "dex"],
  archery: ["AK10", "ref"],
  autofire: ["AK11", "ref"],
  handgun: ["AK12", "ref"],
  heavyWeapons: ["AK13", "ref"],
  shoulderArms: ["AK14", "ref"],
  athletics: ["X11", "dex"],
  concentration: ["X15", "will"],
  firstAid: ["AK32", "tech"]
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
  const card = extractCard(workbook, fileName);
  return {
    fileName,
    handle,
    workbook,
    card,
    dirty: false,
    canDirectSave: Boolean(handle?.createWritable || handle?.electronPath)
  };
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
    Object.entries(statCells).map(([key, cell]) => [key, num(cellValue(character[cell]))])
  );
  const skills = { ...blankSkills };
  for (const [key, [cell, statKey]] of Object.entries(skillBaseCells)) {
    const base = num(cellValue(character[cell]));
    skills[key] = Math.max(0, base - num(stats[statKey]));
  }

  const hp = num(cellValue(character.K30));
  const maxHp = num(cellValue(character.O30)) || hp;
  const headSp = gear ? num(cellValue(gear.AE5)) : num(cellValue(character.BA24));
  const bodySp = gear ? num(cellValue(gear.AE9)) : num(cellValue(character.BA28));

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
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}
