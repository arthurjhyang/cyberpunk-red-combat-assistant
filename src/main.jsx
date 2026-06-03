import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Crosshair,
  FileSpreadsheet,
  FolderOpen,
  RotateCcw,
  Save,
  Shield,
  Swords,
  Terminal,
  UploadCloud,
  Zap
} from "lucide-react";
import { attackModes, distanceBands, skillLabels, statLabels } from "./data/rules.js";
import { sampleCards } from "./data/sampleCards.js";
import {
  applyDamage,
  baseFor,
  bodyDamageDice,
  num,
  resolveCombat,
  selectedMode,
  woundState
} from "./lib/combat.js";
import {
  openWorkbookWithPicker,
  readWorkbookFile,
  saveWorkbookToHandle,
  updateWorkbookFromCard
} from "./lib/excelCard.js";
import "./styles.css";

const initialConfig = {
  attacker: "a",
  defender: "b",
  attackType: "ranged",
  weaponId: "mediumPistol",
  distanceBand: 0,
  targetPart: "body",
  modifier: 0,
  attackDie: "",
  defenseDie: "",
  aimed: false,
  forceDodge: false,
  autoRollDamage: true
};

function App() {
  const [cards, setCards] = useState(sampleCards);
  const [sources, setSources] = useState({ a: null, b: null });
  const [config, setConfig] = useState(initialConfig);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);
  const [toast, setToast] = useState("");
  const [dragSide, setDragSide] = useState(null);
  const [lastSnapshot, setLastSnapshot] = useState(null);

  const mode = selectedMode(config);
  const attacker = cards[config.attacker];
  const defender = cards[config.defender];

  function patchCard(side, patch) {
    setCards(prev => {
      const nextCard = {
        ...prev[side],
        ...patch,
        skills: { ...prev[side].skills, ...(patch.skills || {}) }
      };
      const next = { ...prev, [side]: nextCard };
      setSources(sourcePrev => ({
        ...sourcePrev,
        [side]: updateWorkbookFromCard(sourcePrev[side], nextCard) || sourcePrev[side]
      }));
      return next;
    });
  }

  async function importFile(side, file, handle = null) {
    if (!file) return;
    try {
      const source = await readWorkbookFile(file, handle);
      setCards(prev => ({ ...prev, [side]: source.card }));
      setSources(prev => ({ ...prev, [side]: source }));
      pushLog(`导入 ${side.toUpperCase()} 卡：${source.card.name}（${file.name}）`);
      setToast(`${side.toUpperCase()} 卡已读取：${source.card.name}`);
    } catch (error) {
      setToast(error.message);
    }
  }

  async function openWithPicker(side) {
    try {
      const source = await openWorkbookWithPicker();
      setCards(prev => ({ ...prev, [side]: source.card }));
      setSources(prev => ({ ...prev, [side]: source }));
      pushLog(`授权打开 ${side.toUpperCase()} 卡：${source.card.name}`);
      setToast(`${side.toUpperCase()} 卡已授权，可直接保存回原文件`);
    } catch (error) {
      setToast(error.message);
    }
  }

  function resolve(baseOnly = false) {
    if (config.attacker === config.defender) {
      setToast("攻击方和防守方不能是同一张卡。");
      return;
    }
    if (baseOnly) {
      setResult({ baseOnly: true, mode, attacker, defender, config });
      return;
    }
    const resolved = resolveCombat(cards, config);
    if (resolved.error) {
      setToast(resolved.error);
      setResult(resolved);
      return;
    }

    const nextResult = { ...resolved, applied: null, appliedAt: null, config: { ...config } };
    setResult(nextResult);
    pushLog(formatLog(nextResult));
  }

  function fillBackResult() {
    if (!result || result.error || result.baseOnly) {
      setToast("没有可回填的结算结果。");
      return;
    }
    if (result.applied) {
      setToast("这次结算已经回填过了。");
      return;
    }
    if (!result.hit || result.attack.noDamage || result.damage.total <= 0) {
      setToast("这次结算没有自动伤害可回填。");
      return;
    }
    const targetSide = result.config.defender;
    const before = cards[targetSide];
    const applied = applyDamage(before, result.damage.total, result.attack, result.config.targetPart, result.damage.crit);
    const nextTarget = applied.card;
    setLastSnapshot({ side: targetSide, card: before, source: sources[targetSide], result });
    setCards(prev => ({ ...prev, [targetSide]: nextTarget }));
    setSources(prev => ({
      ...prev,
      [targetSide]: updateWorkbookFromCard(prev[targetSide], nextTarget) || prev[targetSide]
    }));
    setResult(prev => ({ ...prev, applied, appliedAt: new Date().toLocaleTimeString() }));
    pushLog(`回填: ${result.defender.name} 扣 HP ${applied.finalDamage}${applied.armorAbated ? "，护甲 SP -1" : ""}`);
  }

  function undoDamage() {
    if (!lastSnapshot) {
      setToast("没有可撤销的伤害。");
      return;
    }
    setCards(prev => ({ ...prev, [lastSnapshot.side]: lastSnapshot.card }));
    setSources(prev => ({ ...prev, [lastSnapshot.side]: lastSnapshot.source }));
    if (lastSnapshot.result) {
      setResult(lastSnapshot.result);
    }
    pushLog(`撤销 ${lastSnapshot.side.toUpperCase()} 卡上次伤害。`);
    setLastSnapshot(null);
  }

  async function saveDirect(side) {
    try {
      const saved = await saveWorkbookToHandle(sources[side]);
      setSources(prev => ({ ...prev, [side]: saved }));
      setToast(`${side.toUpperCase()} 卡已保存回原文件`);
      pushLog(`直接保存 ${side.toUpperCase()} 卡：${cards[side].name}`);
    } catch (error) {
      setToast(error.message);
    }
  }

  function swapSides() {
    setConfig(prev => ({ ...prev, attacker: prev.defender, defender: prev.attacker }));
  }

  function resetDemo() {
    setCards(sampleCards);
    setSources({ a: null, b: null });
    setConfig(initialConfig);
    setResult(null);
    setLog([]);
    setLastSnapshot(null);
  }

  function pushLog(text) {
    setLog(prev => [text, ...prev].slice(0, 12));
  }

  const threat = useMemo(() => estimateThreat(cards, config), [cards, config]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <div className="brand-mark">
            <Terminal size={18} />
            NIGHT CITY COMBAT CONSOLE
          </div>
          <h1>赛博朋克 RED 战斗结算台</h1>
          <p>
            拖入鲨鱼包/芬里尔自动卡，读取角色属性、战斗技能、HP、护甲和武器。结算先出结果，点击“回填写卡”后再改目标卡，并可撤回。
          </p>
        </div>
        <div className="hero-status">
          <Metric icon={<Crosshair />} label="攻击方" value={attacker.name || config.attacker.toUpperCase()} />
          <Metric icon={<Shield />} label="目标" value={defender.name || config.defender.toUpperCase()} />
          <Metric icon={<Zap />} label="胜率倾向" value={threat.label} tone={threat.tone} />
        </div>
      </section>

      <section className="workbench">
        <div className="card-grid">
          <CharacterPanel
            side="a"
            card={cards.a}
            source={sources.a}
            active={config.attacker === "a" ? "attacker" : config.defender === "a" ? "defender" : ""}
            dragSide={dragSide}
            onDragSide={setDragSide}
            onDropFile={importFile}
            onOpenPicker={openWithPicker}
            onSaveDirect={saveDirect}
            onChange={patchCard}
          />
          <CharacterPanel
            side="b"
            card={cards.b}
            source={sources.b}
            active={config.attacker === "b" ? "attacker" : config.defender === "b" ? "defender" : ""}
            dragSide={dragSide}
            onDragSide={setDragSide}
            onDropFile={importFile}
            onOpenPicker={openWithPicker}
            onSaveDirect={saveDirect}
            onChange={patchCard}
          />
        </div>

        <aside className="side-stack">
          <CombatConsole
            config={config}
            setConfig={setConfig}
            mode={mode}
            onResolve={() => resolve(false)}
            onBaseOnly={() => resolve(true)}
            onFillBack={fillBackResult}
            onUndo={undoDamage}
            onSwap={swapSides}
            onReset={resetDemo}
          />
          <ResultPanel result={result} config={config} onFillBack={fillBackResult} />
          <LogPanel log={log} onClear={() => setLog([])} />
        </aside>
      </section>

      {toast && (
        <button className="toast" type="button" onClick={() => setToast("")}>
          <AlertTriangle size={16} />
          {toast}
        </button>
      )}
    </main>
  );
}

function CharacterPanel({
  side,
  card,
  source,
  active,
  dragSide,
  onDragSide,
  onDropFile,
  onOpenPicker,
  onSaveDirect,
  onChange
}) {
  const fileInputRef = useRef(null);
  const wound = woundState(card);
  const sideLabel = side.toUpperCase();
  const isDragging = dragSide === side;

  function handleDrop(event) {
    event.preventDefault();
    onDragSide(null);
    onDropFile(side, event.dataTransfer.files?.[0]);
  }

  return (
    <article
      className={`runner-card ${active} ${isDragging ? "dragging" : ""}`}
      onDragOver={event => {
        event.preventDefault();
        onDragSide(side);
      }}
      onDragLeave={() => onDragSide(null)}
      onDrop={handleDrop}
    >
      <div className="panel-top">
        <div>
          <span className="side-chip">{sideLabel} 卡</span>
          <h2>{card.name || "未命名角色"}</h2>
          <p>{card.alias || source?.fileName || "手动卡 / 等待导入"}</p>
        </div>
        <div className={`wound ${wound.tone}`}>{wound.label}</div>
      </div>

      <div className="drop-zone">
        <UploadCloud size={20} />
        <span>拖拽 xlsx 到这里导入</span>
        <small>{source?.fileName || "支持鲨鱼包/芬里尔 1.7+ 自动卡"}</small>
      </div>

      <div className="button-row">
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={event => onDropFile(side, event.target.files?.[0])}
        />
        <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>
          <FileSpreadsheet size={16} />
          选择导入
        </button>
        <button type="button" onClick={() => onOpenPicker(side)}>
          <FolderOpen size={16} />
          授权打开
        </button>
        <button type="button" className="secondary" disabled={!source?.canDirectSave} onClick={() => onSaveDirect(side)}>
          <Save size={16} />
          保存原卡
        </button>
      </div>

      <div className="vitals">
        <NumberField label="当前 HP" value={card.hp} onChange={hp => onChange(side, { hp })} />
        <NumberField label="最大 HP" value={card.maxHp} onChange={maxHp => onChange(side, { maxHp })} />
        <NumberField label="身体 SP" value={card.bodySp} onChange={bodySp => onChange(side, { bodySp })} />
        <NumberField label="头部 SP" value={card.headSp} onChange={headSp => onChange(side, { headSp })} />
      </div>

      <div className="meter">
        <span style={{ width: `${Math.max(0, Math.min(100, (num(card.hp) / Math.max(1, num(card.maxHp))) * 100))}%` }} />
      </div>

      <SectionTitle icon={<Activity size={16} />} title="属性" />
      <div className="compact-grid stats">
        {["int", "ref", "dex", "tech", "cool", "will", "move", "body"].map(key => (
          <NumberField key={key} label={statLabels[key]} value={card[key]} onChange={value => onChange(side, { [key]: value })} />
        ))}
      </div>

      <SectionTitle icon={<Swords size={16} />} title="战斗技能" />
      <div className="compact-grid skills">
        {Object.entries(skillLabels).map(([key, label]) => (
          <NumberField
            key={key}
            label={label}
            value={card.skills[key] || 0}
            sub={`基础 ${skillStatBase(card, key)}`}
            onChange={value => onChange(side, { skills: { [key]: value } })}
          />
        ))}
      </div>

      <ImportedWeapons weapons={card.weapons} />
    </article>
  );
}

function CombatConsole({ config, setConfig, mode, onResolve, onBaseOnly, onFillBack, onUndo, onSwap, onReset }) {
  const attackType = attackModes[config.attackType] ? config.attackType : "ranged";
  const weapons = attackModes[attackType].weapons;

  function update(patch) {
    setConfig(prev => ({ ...prev, ...patch }));
  }

  return (
    <article className="console-panel">
      <div className="panel-heading">
        <h2>结算器</h2>
        <button type="button" className="icon-button" onClick={onSwap} title="交换攻防">
          <ArrowLeftRight size={17} />
        </button>
      </div>

      <div className="control-grid">
        <SelectField label="攻击方" value={config.attacker} onChange={attacker => update({ attacker, defender: attacker === "a" ? "b" : "a" })}>
          <option value="a">A 卡</option>
          <option value="b">B 卡</option>
        </SelectField>
        <SelectField label="防守方" value={config.defender} onChange={defender => update({ defender, attacker: defender === "a" ? "b" : "a" })}>
          <option value="b">B 卡</option>
          <option value="a">A 卡</option>
        </SelectField>
        <SelectField
          label="攻击类型"
          value={attackType}
          onChange={value => update({ attackType: value, weaponId: attackModes[value].weapons[0].id })}
        >
          {Object.entries(attackModes).map(([key, attack]) => (
            <option key={key} value={key}>
              {attack.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="武器/动作" value={mode.weapon.id} onChange={weaponId => update({ weaponId })}>
          {weapons.map(weapon => (
            <option key={weapon.id} value={weapon.id}>
              {weapon.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="距离" value={String(config.distanceBand)} onChange={distanceBand => update({ distanceBand: Number(distanceBand) })}>
          {distanceBands.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField label="命中部位" value={config.targetPart} onChange={targetPart => update({ targetPart })}>
          <option value="body">身体</option>
          <option value="head">头部</option>
        </SelectField>
        <NumberField label="手动修正" value={config.modifier} onChange={modifier => update({ modifier })} />
        <TextField label="固定命中骰" value={config.attackDie} placeholder="空=随机" onChange={attackDie => update({ attackDie })} />
        <TextField label="固定防御骰" value={config.defenseDie} placeholder="空=随机" onChange={defenseDie => update({ defenseDie })} />
      </div>

      <div className="toggle-grid">
        <CheckField label="瞄准/弱点 -8" checked={config.aimed} onChange={aimed => update({ aimed })} />
        <CheckField label="远程强制闪避" checked={config.forceDodge} onChange={forceDodge => update({ forceDodge })} />
        <CheckField label="自动掷伤害" checked={config.autoRollDamage} onChange={autoRollDamage => update({ autoRollDamage })} />
      </div>

      <div className="button-row primary-actions">
        <button type="button" onClick={onResolve}>
          <Zap size={16} />
          掷骰并结算
        </button>
        <button type="button" className="secondary" onClick={onBaseOnly}>
          只看基础值
        </button>
        <button type="button" className="secondary" onClick={onFillBack}>
          回填写卡
        </button>
        <button type="button" className="secondary" onClick={onUndo}>
          撤回回填
        </button>
        <button type="button" className="secondary danger-text" onClick={onReset}>
          <RotateCcw size={16} />
          重置演示
        </button>
      </div>
    </article>
  );
}

function ResultPanel({ result, config, onFillBack }) {
  if (!result) {
    return (
      <article className="console-panel result-panel empty">
        <div className="panel-heading">
          <h2>结果</h2>
        </div>
        <p>先导入或调整两张卡，然后点击“只看基础值”或“掷骰并结算”。</p>
      </article>
    );
  }
  if (result.error) {
    return (
      <article className="console-panel result-panel">
        <div className="verdict miss">{result.error}</div>
      </article>
    );
  }
  if (result.baseOnly) {
    const { attack, weapon } = result.mode;
    return (
      <article className="console-panel result-panel">
        <div className="panel-heading">
          <h2>基础值速查</h2>
        </div>
        <div className="formula-grid">
          <Metric label="攻击方" value={result.attacker.name} />
          <Metric label={`${statLabels[attack.stat]} + ${skillLabels[weapon.skill]}`} value={baseFor(result.attacker, attack.stat, weapon.skill)} />
          <Metric label="防守闪避基础" value={baseFor(result.defender, "dex", "evasion")} />
          <Metric label="伤害" value={attack.bodyDamage ? bodyDamageDice(result.attacker.body) : attack.noDamage ? "无" : weapon.damage} />
        </div>
      </article>
    );
  }

  const partLabel = config.targetPart === "head" ? "头部" : "身体";
  return (
    <article className="console-panel result-panel">
      <div className="panel-heading">
        <h2>结果</h2>
        <span className={`status-pill ${result.hit ? "hit" : "miss"}`}>{result.hit ? "命中" : "未命中"}</span>
      </div>
      <div className="formula-grid">
        <Metric label="攻击基础" value={result.attackBase} />
        <Metric label="攻击骰" value={result.attackRoll.detail} />
        <Metric label="修正" value={result.modifier} />
        <Metric label="攻击总值" value={result.attackTotal} />
        <Metric label={result.targetLabel} value={result.useDodge ? result.defenseBase : result.targetTotal} />
        <Metric label="防御骰" value={result.defenseRoll?.detail || "-"} />
        <Metric label="目标值" value={result.targetTotal} />
        <Metric label="部位" value={partLabel} />
      </div>
      <div className={`verdict ${result.hit ? "hit" : "miss"}`}>
        <strong>{result.attacker.name}</strong> 使用 <strong>{result.weapon.label}</strong> 对 <strong>{result.defender.name}</strong>：
        {result.attackTotal} {result.hit ? ">" : "<="} {result.targetTotal}。
        {result.hit ? damageText(result) : "未造成伤害。"}
      </div>
      {result.applied && (
        <div className="damage-ledger">
          <span>SP {result.applied.originalSp}{result.attack.halfArmor ? ` / 半甲 ${result.applied.effectiveSp}` : ""}</span>
          <span>穿透 {result.applied.penetrated}</span>
          <span>扣 HP {result.applied.finalDamage}</span>
          <span>{result.applied.armorAbated ? "护甲 SP -1" : "护甲未削减"}</span>
        </div>
      )}
      {!result.applied && result.hit && !result.attack.noDamage && result.damage.total > 0 && (
        <div className="result-actions">
          <button type="button" onClick={onFillBack}>
            <Save size={16} />
            回填写卡
          </button>
          <span>点击后才会修改目标卡 HP/SP；可用“撤回回填”还原。</span>
        </div>
      )}
      {result.applied && (
        <div className="result-actions applied">
          <span>已回填 {result.appliedAt}。可点击“撤回回填”恢复这次改动。</span>
        </div>
      )}
    </article>
  );
}

function LogPanel({ log, onClear }) {
  return (
    <article className="console-panel">
      <div className="panel-heading">
        <h2>战斗记录</h2>
        <button type="button" className="secondary mini" onClick={onClear}>
          清空
        </button>
      </div>
      <div className="log-list">
        {log.length ? log.map((item, index) => <div key={`${item}-${index}`}>{item}</div>) : <p>还没有结算记录。</p>}
      </div>
    </article>
  );
}

function ImportedWeapons({ weapons = [] }) {
  if (!weapons.length) return null;
  return (
    <>
      <SectionTitle icon={<FileSpreadsheet size={16} />} title="自动卡武器" />
      <div className="weapon-list">
        {weapons.map(weapon => (
          <div key={weapon.row}>
            <strong>{weapon.name || `装备卡第 ${weapon.row} 行`}</strong>
            <span>{[weapon.skill, weapon.damage, weapon.rof ? `ROF ${weapon.rof}` : "", weapon.autofire ? `全自动 ${weapon.autofire}` : ""].filter(Boolean).join(" / ")}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function NumberField({ label, value, onChange, sub }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value ?? 0} onChange={event => onChange(num(event.target.value))} />
      {sub && <small>{sub}</small>}
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value ?? ""} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, onChange, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function CheckField({ label, checked, onChange }) {
  return (
    <label className="check-field">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SectionTitle({ icon, title }) {
  return (
    <div className="section-title">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function Metric({ icon, label, value, tone = "" }) {
  return (
    <div className={`metric ${tone}`}>
      {icon && <span className="metric-icon">{icon}</span>}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function skillStatBase(card, skill) {
  const stat = ["brawling", "evasion", "meleeWeapon", "martialArts", "athletics"].includes(skill)
    ? "dex"
    : skill === "concentration"
      ? "will"
      : skill === "firstAid"
        ? "tech"
        : "ref";
  return baseFor(card, stat, skill);
}

function damageText(result) {
  if (result.attack.noDamage) return "命中表示擒拿/抢夺成立。";
  if (!result.damage.total) return "命中，伤害需要 GM 手动决定。";
  const rolls = result.damage.rolls.length ? `伤害骰 ${result.damage.rolls.join(" + ")}` : "伤害骰";
  const margin = result.damage.margin ? `，全自动倍率 ${result.damage.margin}` : "";
  const crit = result.damage.crit ? "，出现严重伤势，额外 +5 HP 伤害" : "";
  return `${rolls}${margin}，原始伤害 ${result.damage.total}${crit}。`;
}

function formatLog(result) {
  const status = result.hit ? "命中" : "未命中";
  return `${status}: ${result.attacker.name} 用 ${result.weapon.label} 攻击 ${result.defender.name}，${result.attackTotal} vs ${result.targetTotal}${result.applied ? `，扣 HP ${result.applied.finalDamage}` : ""}`;
}

function estimateThreat(cards, config) {
  const { attack, weapon } = selectedMode(config);
  const attackerBase = baseFor(cards[config.attacker], attack.stat, weapon.skill);
  const defenderBase = baseFor(cards[config.defender], "dex", "evasion");
  const delta = attackerBase - defenderBase;
  if (delta >= 5) return { label: "压制", tone: "good" };
  if (delta >= 1) return { label: "优势", tone: "good" };
  if (delta >= -2) return { label: "五五开", tone: "warn" };
  return { label: "危险", tone: "danger" };
}

createRoot(document.getElementById("root")).render(<App />);
