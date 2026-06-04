import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readWorkbookBuffer } from "./excelCard.js";

const cardDir = "D:/wxfile/xwechat_files/q13722185751_c7a8/msg/file/2026-06";

test("imports fallback stat and armor cells from the Zheguang card when available", async (t) => {
  if (!fs.existsSync(cardDir)) {
    t.skip("local WeChat card fixture is not available");
    return;
  }
  const fileName = fs.readdirSync(cardDir).find(name => name.endsWith("_media.xlsx"));
  if (!fileName) {
    t.skip("Zheguang card fixture is not available");
    return;
  }

  const buffer = fs.readFileSync(path.join(cardDir, fileName));
  const source = await readWorkbookBuffer(fileName, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

  assert.equal(source.card.name, "沈绫");
  assert.equal(source.card.alias, "折光");
  assert.equal(source.card.ref, 6);
  assert.equal(source.card.dex, 6);
  assert.equal(source.card.body, 5);
  assert.equal(source.card.cool, 7);
  assert.equal(source.card.will, 6);
  assert.equal(source.card.move, 7);
  assert.equal(source.card.headSp, 11);
  assert.equal(source.card.bodySp, 11);
  assert.equal(source.card.skills.handgun, 3);
  assert.equal(source.card.skills.evasion, 5);
  assert.equal(source.card.skills.athletics, 3);
  assert.ok(source.card.avatar.startsWith("data:image/png;base64,"));
});
