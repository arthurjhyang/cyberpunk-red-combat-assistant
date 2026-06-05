import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BookOpen,
  ClipboardList,
  Crosshair,
  Edit3,
  FileSpreadsheet,
  FolderOpen,
  GripHorizontal,
  GripVertical,
  Maximize2,
  Minus,
  Monitor,
  Plus,
  Radar,
  RotateCcw,
  Save,
  Settings,
  Shield,
  Swords,
  Terminal,
  Trash2,
  UploadCloud,
  Users,
  X,
  Zap
} from "lucide-react";
import { attackModes, autofireDv, distanceBands, rangeDv, skillLabels, statLabels } from "./data/rules.js";
import { createBlankCard, sampleCards } from "./data/sampleCards.js";
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

const fallbackPortraitModules = import.meta.glob("./assets/portraits/*.png", {
  eager: true,
  query: "?url",
  import: "default"
});
const fallbackPortraits = Object.values(fallbackPortraitModules).sort();

const initialConfig = {
  attacker: "",
  defender: "",
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

const defaultPanelLayout = {
  rosterWidth: 300,
  opsWidth: 360,
  opsConsoleHeight: 300,
  opsResultHeight: 190
};

function blankSources(cards) {
  return Object.fromEntries(Object.keys(cards).map(id => [id, null]));
}

function App() {
  const isDesktopApp = Boolean(window.electronWindow);
  const terminalLayoutRef = useRef(null);
  const opsColumnRef = useRef(null);
  const [cards, setCards] = useState({});
  const [sources, setSources] = useState({});
  const [battlePositions, setBattlePositions] = useState({});
  const [config, setConfig] = useState(initialConfig);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);
  const [toast, setToast] = useState("");
  const [dragSide, setDragSide] = useState(null);
  const [lastSnapshot, setLastSnapshot] = useState(null);
  const [activeView, setActiveView] = useState("combat");
  const [panelLayout, setPanelLayout] = useState(() => readPanelLayout());

  const combatants = useMemo(() => Object.entries(cards).map(([id, card], index) => ({ id, card, index })), [cards]);
  const stagedCombatants = useMemo(
    () => combatants.filter(({ id }) => battlePositions[id]),
    [combatants, battlePositions]
  );
  const mode = selectedMode(config);
  const attacker = cards[config.attacker];
  const defender = cards[config.defender];
  const selectedCard = cards[selectedCardId] || attacker || combatants[0]?.card || createBlankCard();
  const selectedSource = sources[selectedCardId] || null;
  const threat = useMemo(() => estimateThreat(cards, config), [cards, config]);

  useEffect(() => {
    window.localStorage?.setItem("cyberpunk-red-panel-layout", JSON.stringify(panelLayout));
  }, [panelLayout]);

  useEffect(() => {
    if (activeView !== "combat") return;
    const columnBounds = terminalLayoutRef.current?.getBoundingClientRect();
    const opsBounds = opsColumnRef.current?.getBoundingClientRect();
    if (!columnBounds && !opsBounds) return;
    setPanelLayout(prev => {
      const next = fitPanelLayout(prev, columnBounds, opsBounds);
      return panelLayoutsEqual(prev, next) ? prev : next;
    });
  }, [activeView]);

  function startColumnResize(side, event) {
    const layoutNode = terminalLayoutRef.current;
    if (!layoutNode) return;
    event.preventDefault();
    const bounds = layoutNode.getBoundingClientRect();
    const startX = event.clientX;
    const start = { ...panelLayout };

    function move(pointerEvent) {
      const delta = pointerEvent.clientX - startX;
      setPanelLayout(prev => {
        const next = { ...prev };
        if (side === "left") next.rosterWidth = start.rosterWidth + delta;
        if (side === "right") next.opsWidth = start.opsWidth - delta;
        return fitPanelLayout(next, bounds);
      });
    }

    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("resizing-panels");
      document.body.classList.remove("resizing-panels-col");
    }

    document.body.classList.add("resizing-panels");
    document.body.classList.add("resizing-panels-col");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function startOpsResize(boundary, event) {
    const opsNode = opsColumnRef.current;
    if (!opsNode) return;
    event.preventDefault();
    const bounds = opsNode.getBoundingClientRect();
    const startY = event.clientY;
    const start = { ...panelLayout };

    function move(pointerEvent) {
      const delta = pointerEvent.clientY - startY;
      setPanelLayout(prev => {
        const next = { ...prev };
        if (boundary === "console") next.opsConsoleHeight = start.opsConsoleHeight + delta;
        if (boundary === "result") next.opsResultHeight = start.opsResultHeight + delta;
        return fitPanelLayout(next, null, bounds);
      });
    }

    function stop() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("resizing-panels");
      document.body.classList.remove("resizing-panels-row");
    }

    document.body.classList.add("resizing-panels");
    document.body.classList.add("resizing-panels-row");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function patchCard(id, patch) {
    setCards(prev => {
      const current = prev[id];
      const nextCard = {
        ...current,
        ...patch,
        skills: { ...current.skills, ...(patch.skills || {}) }
      };
      const next = { ...prev, [id]: nextCard };
      setSources(sourcePrev => ({
        ...sourcePrev,
        [id]: updateWorkbookFromCard(sourcePrev[id], nextCard) || sourcePrev[id]
      }));
      return next;
    });
  }

  async function importFile(id, file, handle = null, position = null) {
    if (!file) return;
    if (!isSpreadsheetFile(file)) {
      setToast("只支持导入 .xlsx 自动卡，请拖入角色卡表格文件。");
      return;
    }
    try {
      const source = await readWorkbookFile(file, handle);
      const targetId = id || nextSlotId(cards);
      setCards(prev => ({ ...prev, [targetId]: source.card }));
      setSources(prev => ({ ...prev, [targetId]: source }));
      if (position) {
        setBattlePositions(prev => ({ ...prev, [targetId]: position }));
        setConfig(prev => nextConfigAfterStage(prev, targetId));
      }
      setSelectedCardId(targetId);
      pushLog(`导入 ${slotLabel(targetId)}：${source.card.name}（${file.name}）`);
      setToast(`${slotLabel(targetId)} 已读取：${source.card.name}`);
    } catch (error) {
      setToast(error.message);
    }
  }

  async function openWithPicker(id = "") {
    try {
      const source = await openWorkbookWithPicker();
      const targetId = id || nextSlotId(cards);
      setCards(prev => ({ ...prev, [targetId]: source.card }));
      setSources(prev => ({ ...prev, [targetId]: source }));
      setSelectedCardId(targetId);
      pushLog(`授权打开 ${slotLabel(targetId)}：${source.card.name}`);
      setToast(`${slotLabel(targetId)} 已授权，可直接保存回原文件`);
    } catch (error) {
      setToast(error.message);
    }
  }

  function resolve(baseOnly = false) {
    if (!attacker || !defender) {
      setToast("先把至少两张角色卡拖进战场，并指定攻击方与目标。");
      return;
    }
    if (config.attacker === config.defender) {
      setToast("攻击方和防守方不能是同一个战斗人员。");
      return;
    }
    if (baseOnly) {
      setResult({ baseOnly: true, mode, attacker, defender, config: { ...config } });
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
    const targetId = result.config.defender;
    const before = cards[targetId];
    const applied = applyDamage(before, result.damage.total, result.attack, result.targetPart, result.damage.crit);
    const nextTarget = applied.card;
    setLastSnapshot({ id: targetId, card: before, source: sources[targetId], result });
    setCards(prev => ({ ...prev, [targetId]: nextTarget }));
    setSources(prev => ({
      ...prev,
      [targetId]: updateWorkbookFromCard(prev[targetId], nextTarget) || prev[targetId]
    }));
    setSelectedCardId(targetId);
    setResult(prev => ({ ...prev, applied, appliedAt: new Date().toLocaleTimeString() }));
    pushLog(`回填: ${result.defender.name} 扣 HP ${applied.finalDamage}${applied.armorAbated ? "，护甲 SP -1" : ""}`);
  }

  function undoDamage() {
    if (!lastSnapshot) {
      setToast("没有可撤销的伤害。");
      return;
    }
    setCards(prev => ({ ...prev, [lastSnapshot.id]: lastSnapshot.card }));
    setSources(prev => ({ ...prev, [lastSnapshot.id]: lastSnapshot.source }));
    setSelectedCardId(lastSnapshot.id);
    if (lastSnapshot.result) setResult(lastSnapshot.result);
    pushLog(`撤销 ${slotLabel(lastSnapshot.id)} 上次伤害。`);
    setLastSnapshot(null);
  }

  async function saveDirect(id) {
    try {
      const saved = await saveWorkbookToHandle(sources[id]);
      setSources(prev => ({ ...prev, [id]: saved }));
      setToast(`${slotLabel(id)} 已保存回原文件`);
      pushLog(`直接保存 ${slotLabel(id)}：${cards[id].name}`);
    } catch (error) {
      setToast(error.message);
    }
  }

  function setAttacker(id) {
    setConfig(prev => ({ ...prev, attacker: id, defender: prev.defender === id ? firstOtherStagedId(battlePositions, id) : prev.defender }));
    setSelectedCardId(id);
  }

  function setDefender(id) {
    setConfig(prev => ({ ...prev, defender: id, attacker: prev.attacker === id ? firstOtherStagedId(battlePositions, id) : prev.attacker }));
    setSelectedCardId(id);
  }

  function swapSides() {
    setConfig(prev => ({ ...prev, attacker: prev.defender, defender: prev.attacker }));
    setSelectedCardId(config.defender);
  }

  function addCombatant() {
    const nextIndex = nextSlotNumber(cards);
    const id = `slot-${nextIndex}`;
    setCards(prev => ({ ...prev, [id]: createBlankCard(nextIndex) }));
    setSources(prev => ({ ...prev, [id]: null }));
    setSelectedCardId(id);
    pushLog(`新增 ${slotLabel(id)}。`);
  }

  function removeCombatant(id) {
    if (!cards[id]) return;
    const ids = Object.keys(cards);
    const removed = cards[id];
    const remaining = ids.filter(item => item !== id);
    const nextAttacker = config.attacker === id ? firstStagedIdWithout(battlePositions, id) : config.attacker;
    const nextDefender = config.defender === id
      ? firstStagedIdWithout(battlePositions, id, nextAttacker)
      : config.defender;
    setCards(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSources(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setBattlePositions(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setConfig(prev => ({ ...prev, attacker: nextAttacker, defender: nextDefender }));
    setSelectedCardId(prev => (prev === id ? remaining[0] || "" : prev));
    setResult(null);
    setLastSnapshot(null);
    pushLog(`移除 ${slotLabel(id)}：${removed.name || "未命名角色"}。`);
  }

  function resetDemo() {
    setCards({});
    setSources({});
    setBattlePositions({});
    setConfig(initialConfig);
    setSelectedCardId("");
    setResult(null);
    setLog([]);
    setLastSnapshot(null);
  }

  function loadDemo() {
    setCards(sampleCards);
    setSources(blankSources(sampleCards));
    setBattlePositions({
      "slot-1": { x: 23, y: 32 },
      "slot-2": { x: 76, y: 36 }
    });
    setConfig(prev => ({ ...prev, attacker: "slot-1", defender: "slot-2" }));
    setSelectedCardId("slot-1");
    setResult(null);
    setLog([]);
    setLastSnapshot(null);
  }

  function stageCombatant(id, position) {
    if (!cards[id]) return;
    setBattlePositions(prev => ({ ...prev, [id]: position }));
    setConfig(prev => nextConfigAfterStage(prev, id));
    setSelectedCardId(id);
  }

  function moveStagedCombatant(id, position) {
    setBattlePositions(prev => ({ ...prev, [id]: position }));
  }

  function unstageCombatant(id) {
    setBattlePositions(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setConfig(prev => ({
      ...prev,
      attacker: prev.attacker === id ? firstStagedIdWithout(battlePositions, id) : prev.attacker,
      defender: prev.defender === id ? firstStagedIdWithout(battlePositions, id, prev.attacker) : prev.defender
    }));
  }

  function pushLog(text) {
    const tone = text.includes("未命中") ? "miss" : text.includes("命中") || text.includes("回填") ? "hit" : "info";
    setLog(prev => [{ text, tone, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) }, ...prev].slice(0, 16));
  }

  return (
    <>
      {isDesktopApp && <WindowTitleBar />}
      <main className={`app-shell ${isDesktopApp ? "with-titlebar" : ""}`}>
        <TerminalNav
          activeView={activeView}
          onChange={setActiveView}
          combatants={combatants}
          autoRollDamage={config.autoRollDamage}
        />

        {activeView === "combat" && (
        <section
          ref={terminalLayoutRef}
          className="terminal-layout hud-frame resizable-workspace"
          style={{
            "--roster-width": `${panelLayout.rosterWidth}px`,
            "--ops-width": `${panelLayout.opsWidth}px`
          }}
        >
          <RosterPanel
            combatants={combatants}
            sources={sources}
            config={config}
            selectedCardId={selectedCardId}
            dragSide={dragSide}
            onDragSide={setDragSide}
            onSelect={setSelectedCardId}
            onSetAttacker={setAttacker}
            onSetDefender={setDefender}
            onDropFile={importFile}
            onOpenPicker={openWithPicker}
            onAdd={addCombatant}
            onRemove={removeCombatant}
            onLoadDemo={loadDemo}
            onStageQuick={id => stageCombatant(id, defaultStagePosition(Object.keys(battlePositions).length))}
          />

          <PanelResizeHandle
            orientation="vertical"
            label="拖动调整角色卡库宽度"
            onPointerDown={event => startColumnResize("left", event)}
          />

          <section className="combat-stage">
            <TacticalBoard
              combatants={combatants}
              stagedCombatants={stagedCombatants}
              cards={cards}
              positions={battlePositions}
              config={config}
              attacker={attacker}
              defender={defender}
              threat={threat}
              mode={mode}
              onSetAttacker={setAttacker}
              onSetDefender={setDefender}
              onConfigChange={setConfig}
              onSwap={swapSides}
              onStage={stageCombatant}
              onMove={moveStagedCombatant}
              onImportToStage={(file, position) => importFile("", file, null, position)}
              onUnstage={unstageCombatant}
            />
          </section>

          <PanelResizeHandle
            orientation="vertical"
            label="拖动调整战斗控制台宽度"
            onPointerDown={event => startColumnResize("right", event)}
          />

          <aside
            ref={opsColumnRef}
            className="ops-column resizable-ops"
            style={{
              "--ops-console-height": `${panelLayout.opsConsoleHeight}px`,
              "--ops-result-height": `${panelLayout.opsResultHeight}px`
            }}
          >
            <CombatConsole
              combatants={combatants}
              stagedCombatants={stagedCombatants}
              config={config}
              setConfig={setConfig}
              mode={mode}
              onResolve={() => resolve(false)}
              onBaseOnly={() => resolve(true)}
              onFillBack={fillBackResult}
              onUndo={undoDamage}
              onSwap={swapSides}
              onReset={resetDemo}
              onLoadDemo={loadDemo}
            />
            <PanelResizeHandle
              orientation="horizontal"
              label="拖动调整结算控制台高度"
              onPointerDown={event => startOpsResize("console", event)}
            />
            <ResultPanel result={result} config={config} onFillBack={fillBackResult} />
            <PanelResizeHandle
              orientation="horizontal"
              label="拖动调整结算结果高度"
              onPointerDown={event => startOpsResize("result", event)}
            />
            <LogPanel log={log} onClear={() => setLog([])} />
          </aside>
        </section>
        )}

        {activeView === "cards" && (
          <section className="management-layout">
            <RosterPanel
              combatants={combatants}
              sources={sources}
              config={config}
              selectedCardId={selectedCardId}
              dragSide={dragSide}
              onDragSide={setDragSide}
              onSelect={setSelectedCardId}
              onSetAttacker={setAttacker}
              onSetDefender={setDefender}
              onDropFile={importFile}
              onOpenPicker={openWithPicker}
              onAdd={addCombatant}
              onRemove={removeCombatant}
              onLoadDemo={loadDemo}
              onStageQuick={id => stageCombatant(id, defaultStagePosition(Object.keys(battlePositions).length))}
            />
            {selectedCardId ? <CharacterPanel
              id={selectedCardId}
              card={selectedCard}
              source={selectedSource}
              active={config.attacker === selectedCardId ? "attacker" : config.defender === selectedCardId ? "defender" : ""}
              onDropFile={importFile}
              onOpenPicker={openWithPicker}
              onSaveDirect={saveDirect}
              onChange={patchCard}
              onRemove={removeCombatant}
              canRemove={combatants.length > 0}
            /> : <EmptyCharacterPanel onAdd={addCombatant} onOpenPicker={() => openWithPicker("")} />}
          </section>
        )}

        {activeView === "log" && (
          <section className="log-workspace">
            <LogPanel log={log} onClear={() => setLog([])} />
          </section>
        )}

        {activeView === "settings" && (
          <section className="settings-workspace">
            <article className="console-panel">
              <div className="panel-heading">
                <h2>设置</h2>
              </div>
              <div className="rule-hints">
                <span>当前版本：本地文件桥接 / 直接回填写卡 / 伤害撤回</span>
                <span>自动回填：{config.autoRollDamage ? "自动掷伤害" : "仅手动结果"}</span>
              </div>
            </article>
          </section>
        )}

        {toast && (
          <button className="toast" type="button" onClick={() => setToast("")}>
            <AlertTriangle size={16} />
            {toast}
          </button>
        )}
      </main>
    </>
  );
}

function TerminalNav({ activeView, onChange, combatants, autoRollDamage }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const tabs = [
    { id: "combat", label: "战斗结算", icon: <Crosshair size={15} /> },
    { id: "cards", label: "角色卡管理", icon: <BookOpen size={15} /> },
    { id: "log", label: "战斗日志", icon: <ClipboardList size={15} /> },
    { id: "settings", label: "设置", icon: <Settings size={15} /> }
  ];

  return (
    <header className="terminal-nav">
      <div className="nav-brand">
        <span className="brand-mark compact">
          <Terminal size={16} />
        </span>
        <strong>战斗助手</strong>
        <span>NIGHT CITY</span>
      </div>
      <nav className="nav-tabs" aria-label="主模块">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={activeView === tab.id ? "active" : ""}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="nav-status">
        <span><Monitor size={14} /> 桌面模式</span>
        <span>战斗人员 {combatants.length}/12</span>
        <span>自动回填：<strong>{autoRollDamage ? "手动确认" : "关闭"}</strong></span>
        <time>{now.toLocaleTimeString("zh-CN", { hour12: false })}</time>
      </div>
    </header>
  );
}

function PanelResizeHandle({ orientation, label, onPointerDown }) {
  const Icon = orientation === "vertical" ? GripVertical : GripHorizontal;
  return (
    <button
      type="button"
      className={`panel-resizer ${orientation}`}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
    >
      <Icon size={16} />
    </button>
  );
}

function WindowTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.electronWindow?.isMaximized?.().then(setMaximized).catch(() => {});
  }, []);

  async function toggleMaximize() {
    const next = await window.electronWindow.toggleMaximize();
    setMaximized(next);
  }

  return (
    <header className="window-titlebar">
      <div className="titlebar-grip">
        <span className="titlebar-sigil">
          <Terminal size={15} />
        </span>
        <div>
          <strong>Night City Combat Console</strong>
          <small>Cyberpunk RED / Multiplayer Card Ops</small>
        </div>
      </div>
      <div className="titlebar-status">
        <span>LOCAL FILE BRIDGE</span>
        <span>READY</span>
      </div>
      <div className="window-controls">
        <button type="button" className="window-button" onClick={() => window.electronWindow.minimize()} title="最小化">
          <Minus size={15} />
        </button>
        <button type="button" className="window-button" onClick={toggleMaximize} title={maximized ? "还原" : "最大化"}>
          <Maximize2 size={14} />
        </button>
        <button type="button" className="window-button close" onClick={() => window.electronWindow.close()} title="关闭">
          <X size={16} />
        </button>
      </div>
    </header>
  );
}

function RosterPanel({
  combatants,
  sources,
  config,
  selectedCardId,
  dragSide,
  onDragSide,
  onSelect,
  onSetAttacker,
  onSetDefender,
  onDropFile,
  onOpenPicker,
  onAdd,
  onRemove,
  onLoadDemo,
  onStageQuick
}) {
  const [compact, setCompact] = useState(false);
  const fileInputRef = useRef(null);

  function handleDockDrop(event) {
    event.preventDefault();
    onDragSide(null);
    if (draggedCombatantId(event.dataTransfer)) return;
    onDropFile("", event.dataTransfer.files?.[0]);
  }

  return (
    <aside className={`roster-panel ${compact ? "compact" : ""}`}>
      <div className="panel-heading">
        <div>
          <h2>角色卡库 <span>{combatants.length}/12</span></h2>
          <p>导入角色卡后，拖到中间战场自由摆位。</p>
        </div>
        <div className="panel-tools">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={event => onDropFile("", event.target.files?.[0])}
          />
          <button type="button" className="icon-button secondary" onClick={() => setCompact(prev => !prev)} title="切换列表密度">
            <ClipboardList size={16} />
          </button>
          <button type="button" className="icon-button secondary" onClick={onLoadDemo} title="载入演示角色">
            <Users size={16} />
          </button>
          <button type="button" className="icon-button" onClick={() => fileInputRef.current?.click()} title="导入角色卡">
            <UploadCloud size={17} />
          </button>
        </div>
      </div>
      <div className="roster-list">
        {combatants.length ? combatants.map(({ id, card, index }) => (
          <RosterCard
            key={id}
            id={id}
            card={card}
            source={sources[id]}
            index={index}
            selected={selectedCardId === id}
            role={config.attacker === id ? "attacker" : config.defender === id ? "defender" : ""}
            dragging={dragSide === id}
            onDragSide={onDragSide}
            onSelect={onSelect}
            onSetAttacker={onSetAttacker}
            onSetDefender={onSetDefender}
            onDropFile={onDropFile}
            onOpenPicker={onOpenPicker}
            onRemove={onRemove}
            onStageQuick={onStageQuick}
            canRemove={combatants.length > 0}
          />
        )) : (
          <div className="roster-empty">
            <UploadCloud size={26} />
            <strong>还没有角色卡</strong>
            <span>拖拽自动卡到下方导入坞，或点击右上角导入。导入后再拖进中间战场。</span>
          </div>
        )}
      </div>
      <div
        className="roster-import-dock"
        onDragOver={event => event.preventDefault()}
        onDragLeave={() => onDragSide(null)}
        onDrop={handleDockDrop}
      >
        <UploadCloud size={22} />
        <div>
          <strong>拖拽 .xlsx 自动卡到此处导入</strong>
          <span>导入后出现在卡库，可继续拖到战场自由摆放</span>
        </div>
      </div>
    </aside>
  );
}

function RosterCard({
  id,
  card,
  source,
  index,
  selected,
  role,
  dragging,
  onDragSide,
  onSelect,
  onSetAttacker,
  onSetDefender,
  onDropFile,
  onOpenPicker,
  onRemove,
  onStageQuick,
  canRemove
}) {
  const fileInputRef = useRef(null);
  const wound = woundState(card);
  const hpPercent = Math.max(0, Math.min(100, (num(card.hp) / Math.max(1, num(card.maxHp))) * 100));

  function handleDrop(event) {
    event.preventDefault();
    onDragSide(null);
    if (draggedCombatantId(event.dataTransfer)) return;
    onDropFile(id, event.dataTransfer.files?.[0]);
  }

  return (
    <article
      className={`roster-card ${selected ? "selected" : ""} ${role} ${dragging ? "dragging" : ""}`}
      draggable
      onClick={() => onSelect(id)}
      onDragStart={event => {
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData("application/x-combatant-id", id);
        event.dataTransfer.setData("text/plain", id);
      }}
      onDragOver={event => {
        event.preventDefault();
        onDragSide(id);
      }}
      onDragLeave={() => onDragSide(null)}
      onDrop={handleDrop}
    >
      <div className="roster-index">{index + 1}</div>
      <Avatar card={card} index={index} variant="roster" />
      <div className="roster-main">
        <div className="roster-title">
          <strong>{card.name || slotLabel(id)}</strong>
          <div className="roster-title-actions" onClick={event => event.stopPropagation()}>
            <span className={`role-light ${role || wound.tone}`}>{role ? (role === "attacker" ? "攻击" : "目标") : wound.label}</span>
            <button type="button" className="deploy-chip" onClick={() => onStageQuick(id)} title="部署到战场">
              <Crosshair size={12} />
            </button>
          </div>
        </div>
        <p>{source?.fileName || card.alias || "拖拽 xlsx 到此卡位"}</p>
        <div className="roster-vitals">
          <span>HP <b>{card.hp}/{card.maxHp}</b></span>
          <span>身体SP <b>{card.bodySp}</b></span>
          <span>头部SP <b>{card.headSp}</b></span>
        </div>
        <div className="micro-bars" aria-label={`HP ${card.hp}/${card.maxHp}`}>
          <span className="hp-bar" style={{ width: `${hpPercent}%` }} />
        </div>
        <div className="roster-actions" onClick={event => event.stopPropagation()}>
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={event => onDropFile(id, event.target.files?.[0])}
          />
          <button type="button" className="ghost-button" onClick={() => fileInputRef.current?.click()} title="选择导入">
            <FileSpreadsheet size={14} />
          </button>
          <button type="button" className="ghost-button" onClick={() => onOpenPicker(id)} title="授权打开">
            <FolderOpen size={14} />
          </button>
          <button type="button" className="ghost-button" onClick={() => onSelect(id)} title="编辑卡位">
            <Edit3 size={13} />
          </button>
          <button type="button" className="ghost-button danger" onClick={() => onRemove(id)} disabled={!canRemove} title="删除卡位">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}

function Avatar({ card, index = 0, variant = "" }) {
  const initial = String(card?.name || "?").trim().slice(0, 1).toUpperCase() || "?";
  const image = card?.avatar || fallbackPortrait(index);
  return (
    <span
      className={`avatar has-image ${variant ? `avatar-${variant}` : ""}`}
      style={{ "--avatar-hue": (index * 47 + 190) % 360, "--avatar-seed": index % 4 }}
    >
      <img src={image} alt="" draggable={false} />
    </span>
  );
}

function TacticalBoard({
  combatants,
  stagedCombatants,
  positions,
  config,
  attacker,
  defender,
  threat,
  mode,
  onSetAttacker,
  onSetDefender,
  onConfigChange,
  onSwap,
  onStage,
  onMove,
  onImportToStage,
  onUnstage
}) {
  const [nextPick, setNextPick] = useState("attacker");
  const [draggingToken, setDraggingToken] = useState(null);
  const [mapDragActive, setMapDragActive] = useState(false);
  const movedTokenRef = useRef(false);
  const suppressClickRef = useRef("");
  const mapRef = useRef(null);
  const attackerPoint = positions[config.attacker] || null;
  const defenderPoint = positions[config.defender] || null;
  const route = attackerPoint && defenderPoint ? routePath(attackerPoint, defenderPoint) : "";

  function pickToken(id) {
    if (nextPick === "attacker") {
      onSetAttacker(id);
      setNextPick("defender");
    } else {
      onSetDefender(id);
      setNextPick("attacker");
    }
  }

  function setDistance(distanceBand) {
    onConfigChange(prev => ({ ...prev, distanceBand }));
  }

  function pointFromEvent(event) {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 50 };
    return {
      x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((event.clientY - rect.top) / rect.height) * 100)
    };
  }

  function handleMapDrop(event) {
    event.preventDefault();
    setMapDragActive(false);
    const position = pointFromEvent(event);
    const id = draggedCombatantId(event.dataTransfer);
    if (id) {
      if (positions[id]) onMove(id, position);
      else onStage(id, position);
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) {
      onImportToStage(file, position);
      return;
    }
  }

  useEffect(() => {
    if (!draggingToken) return;
    function handlePointerMove(event) {
      movedTokenRef.current = true;
      onMove(draggingToken, pointFromEvent(event));
    }
    function handlePointerUp() {
      if (movedTokenRef.current) {
        suppressClickRef.current = draggingToken;
        window.setTimeout(() => {
          if (suppressClickRef.current === draggingToken) suppressClickRef.current = "";
        }, 80);
      }
      movedTokenRef.current = false;
      setDraggingToken(null);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draggingToken, onMove]);

  return (
    <article className="tactical-board">
      <div className="panel-heading">
        <div>
          <h2>自由战场</h2>
          <p>拖入角色卡或 .xlsx 后自由摆位；点击头像牌指定{nextPick === "attacker" ? "攻击方" : "目标"}。</p>
        </div>
        <button type="button" className="icon-button" onClick={onSwap} title="交换攻防">
          <ArrowLeftRight size={17} />
        </button>
      </div>

      <div className="duel-lane">
        <CombatantSpot role="攻击方" tone="cyan" card={attacker} id={config.attacker} emptyText="把攻击方拖进战场后点击头像牌" />
        <div className="versus-core">
          <Radar size={26} />
          <strong>VS</strong>
          <span className={attacker && defender ? threat.tone : ""}>{attacker && defender ? threat.label : "待部署"}</span>
        </div>
        <CombatantSpot role="目标" tone="red" card={defender} id={config.defender} emptyText="把目标拖进战场后点击头像牌" />
      </div>

      <div className="distance-strip">
        {distanceBands.map((label, index) => {
          const dv = config.attackType === "autofire"
            ? autofireDv[mode.weapon.family]?.[index]
            : rangeDv[mode.weapon.family]?.[index];
          const disabled = !mode.attack.fixedDv && dv == null && mode.attack.defender === "range";
          return (
            <button
              key={label}
              type="button"
              className={num(config.distanceBand) === index ? "active" : ""}
              disabled={disabled}
              onClick={() => setDistance(index)}
            >
              <strong>{label}</strong>
              <span>{mode.attack.fixedDv ? `DV ${mode.attack.fixedDv}` : dv ? `DV ${dv}` : "不可用"}</span>
            </button>
          );
        })}
      </div>

      <div
        ref={mapRef}
        className={`battle-map ${stagedCombatants.length ? "" : "empty"} ${mapDragActive ? "drop-active" : ""}`}
        data-pick-mode={nextPick === "attacker" ? "攻击方" : "目标"}
        onDragEnter={() => setMapDragActive(true)}
        onDragOver={event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setMapDragActive(true);
        }}
        onDragLeave={event => {
          if (event.currentTarget === event.target) setMapDragActive(false);
        }}
        onDrop={handleMapDrop}
      >
        <div className="map-header">
          <span>战场态势</span>
          <strong>{distanceBands[num(config.distanceBand)]}</strong>
          <em>点选: {nextPick === "attacker" ? "攻击方" : "目标"}</em>
        </div>
        {route && (
          <svg className="attack-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="route-neon-gradient" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#27d8ff" />
                <stop offset="50%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#ff315d" />
              </linearGradient>
              <filter id="route-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.25" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path className="route-shadow" d={route} />
            <path className="route-hot" d={route} />
            <path className="route-cyan" d={route} />
            <circle className="route-runner" r="1.15">
              <animateMotion dur="1.65s" repeatCount="indefinite" path={route} />
            </circle>
            <circle className="route-start" cx={attackerPoint.x} cy={attackerPoint.y} r="1.8" />
            <circle className="route-end" cx={defenderPoint.x} cy={defenderPoint.y} r="2.1" />
          </svg>
        )}
        {!stagedCombatants.length && (
          <div className="battle-drop-empty">
            <UploadCloud size={30} />
            <strong>拖入角色卡开始布阵</strong>
            <span>支持从左侧卡库拖入，也支持直接拖入 .xlsx 自动卡。</span>
          </div>
        )}
        {stagedCombatants.map(({ id, card, index }) => {
          const point = positions[id] || { x: 50, y: 50 };
          return (
          <button
            key={id}
            type="button"
            draggable={false}
            title={`${card.name} / HP ${card.hp}/${card.maxHp} / SP ${card.bodySp}/${card.headSp}`}
            className={`map-token ${config.attacker === id ? "as-attacker" : ""} ${config.defender === id ? "as-defender" : ""} ${draggingToken === id ? "is-dragging" : ""}`}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            onClick={event => {
              event.stopPropagation();
              if (suppressClickRef.current === id) return;
              pickToken(id);
            }}
            onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              movedTokenRef.current = false;
              setDraggingToken(id);
            }}
            onDoubleClick={event => {
              event.stopPropagation();
              onUnstage(id);
            }}
          >
            <Avatar card={card} index={index} variant="token" />
            <span className="token-index">{index + 1}</span>
            {(config.attacker === id || config.defender === id) && (
              <strong className="token-role">{config.attacker === id ? "攻" : "目"}</strong>
            )}
            <em>{card.name}</em>
            <small>HP {card.hp}/{card.maxHp}</small>
          </button>
          );
        })}
      </div>
    </article>
  );
}

function CombatantSpot({ role, tone, card, id, emptyText }) {
  if (!card) {
    return (
      <div className={`combatant-spot ${tone} empty-spot`}>
        <div className="spot-frame empty-portrait">
          <Crosshair size={34} />
          <span>{role}</span>
        </div>
        <div className="spot-data">
          <span>{role}</span>
          <strong>等待部署</strong>
          <p>{emptyText || "拖入角色卡后选择攻防对象"}</p>
        </div>
      </div>
    );
  }
  const wound = woundState(card);
  const hpPercent = Math.max(0, Math.min(100, (num(card.hp) / Math.max(1, num(card.maxHp))) * 100));
  return (
    <div className={`combatant-spot ${tone}`}>
      <div className="spot-frame">
        <Avatar card={card} index={Number(String(id).match(/(\d+)$/)?.[1] || 1) - 1} variant="duel" />
        <span>{role}</span>
      </div>
      <div className="spot-data">
        <span>{role} · {slotLabel(id)}</span>
        <strong>{card.name}</strong>
        <p>{card.alias || wound.label}</p>
        <div className="spot-stats">
          <span>REF <b>{card.ref}</b></span>
          <span>DEX <b>{card.dex}</b></span>
          <span>BODY <b>{card.body}</b></span>
          <span>COOL <b>{card.cool}</b></span>
          <span>WILL <b>{card.will}</b></span>
          <span>MOVE <b>{card.move}</b></span>
        </div>
        <div className="spot-bars compact">
          <div><span>HP</span><b>{card.hp}/{card.maxHp}</b><i style={{ width: `${hpPercent}%` }} /></div>
          <div><span>SP</span><b>身体 {card.bodySp} / 头部 {card.headSp}</b></div>
        </div>
      </div>
    </div>
  );
}

function CharacterPanel({ id, card, source, active, onDropFile, onOpenPicker, onSaveDirect, onChange, onRemove, canRemove }) {
  const fileInputRef = useRef(null);
  const wound = woundState(card);
  const sideLabel = slotLabel(id);

  return (
    <article className={`runner-card ${active}`}>
      <div className="panel-top">
        <div>
          <span className="side-chip">{sideLabel}</span>
          <h2>{card.name || "未命名角色"}</h2>
          <p>{card.alias || source?.fileName || "手动卡 / 等待导入"}</p>
        </div>
        <div className="panel-tools">
          <div className={`wound ${wound.tone}`}>{wound.label}</div>
          <button type="button" className="ghost-button danger" onClick={() => onRemove(id)} disabled={!canRemove} title="删除当前角色">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="identity-grid">
        <TextField label="角色名" value={card.name} onChange={name => onChange(id, { name })} />
        <TextField label="代号 / 备注" value={card.alias} onChange={alias => onChange(id, { alias })} />
      </div>

      <div className="drop-zone">
        <UploadCloud size={20} />
        <span>当前编辑卡位可拖拽 xlsx 到左侧名册导入</span>
        <small>{source?.fileName || "支持鲨鱼包/芬里尔 1.7+ 自动卡"}</small>
      </div>

      <div className="button-row">
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={event => onDropFile(id, event.target.files?.[0])}
        />
        <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>
          <FileSpreadsheet size={16} />
          选择导入
        </button>
        <button type="button" onClick={() => onOpenPicker(id)}>
          <FolderOpen size={16} />
          授权打开
        </button>
        <button type="button" className="secondary" disabled={!source?.canDirectSave} onClick={() => onSaveDirect(id)}>
          <Save size={16} />
          保存原卡
        </button>
      </div>

      <div className="vitals">
        <NumberField label="当前 HP" value={card.hp} onChange={hp => onChange(id, { hp })} />
        <NumberField label="最大 HP" value={card.maxHp} onChange={maxHp => onChange(id, { maxHp })} />
        <NumberField label="身体 SP" value={card.bodySp} onChange={bodySp => onChange(id, { bodySp })} />
        <NumberField label="头部 SP" value={card.headSp} onChange={headSp => onChange(id, { headSp })} />
      </div>

      <div className="meter">
        <span style={{ width: `${Math.max(0, Math.min(100, (num(card.hp) / Math.max(1, num(card.maxHp))) * 100))}%` }} />
      </div>

      <SectionTitle icon={<Activity size={16} />} title="属性" />
      <div className="compact-grid stats">
        {["int", "ref", "dex", "tech", "cool", "will", "move", "body"].map(key => (
          <NumberField key={key} label={statLabels[key]} value={card[key]} onChange={value => onChange(id, { [key]: value })} />
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
            onChange={value => onChange(id, { skills: { [key]: value } })}
          />
        ))}
      </div>

      <ImportedWeapons weapons={card.weapons} />
    </article>
  );
}

function EmptyCharacterPanel({ onAdd, onOpenPicker }) {
  return (
    <article className="runner-card empty-editor">
      <div className="panel-top">
        <div>
          <span className="side-chip">卡库</span>
          <h2>等待角色卡</h2>
          <p>导入或新增角色后，这里会显示可编辑属性。</p>
        </div>
      </div>
      <div className="drop-zone">
        <UploadCloud size={20} />
        <span>战斗页也支持把 .xlsx 直接拖到中间战场。</span>
        <small>导入卡片后，再拖进战场进行自由摆位和攻防选择。</small>
      </div>
      <div className="button-row">
        <button type="button" onClick={onOpenPicker}>
          <FolderOpen size={16} />
          授权打开角色卡
        </button>
        <button type="button" className="secondary" onClick={onAdd}>
          <Plus size={16} />
          新增手动卡
        </button>
      </div>
    </article>
  );
}

function CombatConsole({ combatants, stagedCombatants, config, setConfig, mode, onResolve, onBaseOnly, onFillBack, onUndo, onSwap, onReset, onLoadDemo }) {
  const attackType = attackModes[config.attackType] ? config.attackType : "ranged";
  const weapons = attackModes[attackType].weapons;
  const isAreaAttack = Boolean(attackModes[attackType].area || mode.weapon.area);
  const selectableCombatants = stagedCombatants;

  function update(patch) {
    setConfig(prev => {
      const next = { ...prev, ...patch };
      const nextAttack = attackModes[next.attackType] || attackModes.ranged;
      const nextWeapon = nextAttack.weapons.find(item => item.id === next.weaponId) || nextAttack.weapons[0];
      if (nextAttack.area || nextWeapon.area) next.targetPart = "body";
      if (next.attacker === next.defender) {
        if (patch.attacker) next.defender = firstOtherId(Object.fromEntries(selectableCombatants.map(({ id, card }) => [id, card])), patch.attacker);
        if (patch.defender) next.attacker = firstOtherId(Object.fromEntries(selectableCombatants.map(({ id, card }) => [id, card])), patch.defender);
      }
      return next;
    });
  }

  return (
    <article className="console-panel combat-console">
      <div className="panel-heading">
        <div>
          <h2>战斗结算控制台</h2>
          <p>攻防对象、射程、部位与规则修正集中控制。</p>
        </div>
        <button type="button" className="icon-button" onClick={onSwap} title="交换攻防">
          <ArrowLeftRight size={17} />
        </button>
      </div>

      <div className="button-row primary-actions command-actions">
        <button type="button" onClick={onResolve}>
          <Zap size={16} />
          鎺烽骞剁粨绠?        </button>
        <button type="button" className="secondary" onClick={onBaseOnly}>
          鍙湅鍩虹鍊?        </button>
        <button type="button" className="secondary" onClick={onFillBack}>
          鍥炲～鍐欏崱
        </button>
        <button type="button" className="secondary" onClick={onUndo}>
          鎾ゅ洖鍥炲～
        </button>
        <button type="button" className="secondary danger-text" onClick={onReset}>
          <RotateCcw size={16} />
          娓呯┖
        </button>
        <button type="button" className="secondary" onClick={onLoadDemo}>
          <Users size={16} />
          婕旂ず
        </button>
      </div>

      <div className="control-grid">
        <SelectField label="攻击方" value={config.attacker} onChange={attacker => update({ attacker })}>
          <option value="">未选择</option>
          {selectableCombatants.map(({ id, card }) => (
            <option key={id} value={id}>
              {slotLabel(id)} · {card.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="防守方" value={config.defender} onChange={defender => update({ defender })}>
          <option value="">未选择</option>
          {selectableCombatants.map(({ id, card }) => (
            <option key={id} value={id}>
              {slotLabel(id)} · {card.name}
            </option>
          ))}
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
              {[weapon.label, skillLabels[weapon.skill], weapon.damage, weapon.cap ? `x${weapon.cap}` : weapon.rof ? `ROF ${weapon.rof}` : ""].filter(Boolean).join(" / ")}
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
          <option value="head" disabled={isAreaAttack}>头部 / 弱点</option>
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
      <RuleHint config={config} mode={mode} isAreaAttack={isAreaAttack} />

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
          清空
        </button>
        <button type="button" className="secondary" onClick={onLoadDemo}>
          <Users size={16} />
          演示
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
          <h2>结算结果</h2>
        </div>
        <p>先从名册选择攻击方和目标，然后点击“只看基础值”或“掷骰并结算”。</p>
      </article>
    );
  }
  if (result.error) {
    return (
      <article className="console-panel result-panel">
        <div className="result-verdict miss">
          <strong>规则错误</strong>
          <span>{result.error}</span>
        </div>
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

  const partLabel = result.targetPart === "head" ? "头部" : "身体";
  const preview = result.hit && !result.attack.noDamage && result.damage.total > 0
    ? applyDamage(result.defender, result.damage.total, result.attack, result.targetPart, result.damage.crit)
    : null;
  return (
    <article className="console-panel result-panel">
      <div className={`result-verdict ${result.hit ? "hit" : "miss"}`}>
        <strong>{result.hit ? "命中" : "未命中"}</strong>
        <span>攻击总值 <b>{result.attackTotal}</b> {result.hit ? ">" : "≤"} 目标值 <b>{result.targetTotal}</b></span>
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
      {!!result.ruleNotes?.length && (
        <div className="rules-strip">
          {result.ruleNotes.map(note => (
            <span key={note}>
              <AlertTriangle size={13} />
              {note}
            </span>
          ))}
        </div>
      )}
      <div className={`verdict ${result.hit ? "hit" : "miss"}`}>
        <strong>{result.attacker.name}</strong> 使用 <strong>{result.weapon.label}</strong> 对 <strong>{result.defender.name}</strong>：
        {result.attackTotal} {result.hit ? ">" : "<="} {result.targetTotal}。
        {result.hit ? damageText(result) : "未造成伤害。"}
      </div>
      {!result.applied && preview && (
        <DamagePreview applied={preview} result={result} />
      )}
      {result.applied && (
        <DamagePreview applied={result.applied} result={result} committed />
      )}
      {!result.applied && result.hit && !result.attack.noDamage && result.damage.total > 0 && (
        <div className="result-actions">
          <button type="button" onClick={onFillBack}>
            <Save size={16} />
            回填写卡
          </button>
          <span>只修改本次选中的目标卡；可用“撤回回填”还原。</span>
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

function RuleHint({ config, mode, isAreaAttack }) {
  const hints = [];
  if (config.targetPart === "head") hints.push("头部攻击自动按瞄准/弱点处理，命中修正 -8。");
  if (isAreaAttack) hints.push("区域攻击固定按身体结算，不能指定头部。");
  if (mode.attack.halfArmor) hints.push("该动作按半甲计算防护。");
  if (config.attackType === "autofire") hints.push(`全自动上限 x${mode.weapon.cap}，命中差额决定倍率。`);
  if (!hints.length) hints.push("命中需严格大于目标值；伤害穿过 SP 才削减护甲。");

  return (
    <div className="rule-hints">
      {hints.map(hint => (
        <span key={hint}>{hint}</span>
      ))}
    </div>
  );
}

function DamagePreview({ applied, result, committed = false }) {
  const hpTone = applied.hpAfter < 1 ? "danger" : applied.hpAfter < Math.ceil(num(result.defender.maxHp) / 2) ? "warn" : "";
  const multiplier = applied.headMultiplier > 1 ? ` x${applied.headMultiplier}` : "";
  const crit = applied.critBonus ? ` + 严重伤势 ${applied.critBonus}` : "";
  const damageFormula = `${applied.penetrated}${multiplier}${crit}`;

  return (
    <div className={`damage-preview ${committed ? "applied" : ""}`}>
      <div>
        <span>{committed ? "已回填" : "回填预览"}</span>
        <strong>{damageFormula} = {applied.finalDamage} HP</strong>
      </div>
      <div className="damage-ledger">
        <span>SP {applied.originalSp}{result.attack.halfArmor ? ` / 半甲 ${applied.effectiveSp}` : ""}</span>
        <span>穿透 {applied.penetrated}</span>
        <span className={hpTone}>HP {applied.hpBefore} → {applied.hpAfter}</span>
        <span>{applied.armorAbated ? "护甲 SP -1" : "护甲未削减"}</span>
      </div>
    </div>
  );
}

function LogPanel({ log, onClear }) {
  return (
    <article className="console-panel log-panel">
      <div className="panel-heading">
        <h2>战斗记录</h2>
        <button type="button" className="secondary mini" onClick={onClear}>
          清空
        </button>
      </div>
      <div className="log-list">
        {log.length ? log.map((item, index) => {
          const entry = typeof item === "string" ? { text: item, tone: item.includes("未命中") ? "miss" : item.includes("命中") ? "hit" : "info", time: "--:--:--" } : item;
          return (
            <div className={`log-entry ${entry.tone}`} key={`${entry.text}-${index}`}>
              <time>{entry.time}</time>
              <span>{entry.text}</span>
            </div>
          );
        }) : <p>还没有结算记录。</p>}
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
  const margin = result.damage.margin ? `，全自动倍率 x${result.damage.margin}，乘后伤害 ${result.damage.total}` : "";
  const head = result.isHeadShot ? "，穿甲后头部伤害翻倍" : "";
  const crit = result.damage.crit ? "，出现严重伤势，额外 +5 HP 伤害" : "";
  return `${rolls}${margin || `，原始伤害 ${result.damage.total}`}${head}${crit}。`;
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

function slotLabel(id) {
  const match = String(id).match(/(\d+)$/);
  return match ? `卡位 ${match[1]}` : id;
}

function firstOtherId(cards, currentId) {
  return Object.keys(cards).find(id => id !== currentId) || currentId;
}

function firstOtherStagedId(positions, currentId) {
  return Object.keys(positions).find(id => id !== currentId) || "";
}

function firstStagedIdWithout(positions, removedId, exceptId = "") {
  return Object.keys(positions).find(id => id !== removedId && id !== exceptId) || "";
}

function draggedCombatantId(dataTransfer) {
  if (!dataTransfer) return "";
  const explicitId = dataTransfer.getData("application/x-combatant-id");
  if (explicitId) return explicitId;
  const text = dataTransfer.getData("text/plain");
  return /^slot-\d+$/i.test(text) ? text : "";
}

function isSpreadsheetFile(file) {
  if (!file) return false;
  return /\.xlsx$/i.test(file.name || "");
}

function readPanelLayout() {
  try {
    const saved = window.localStorage?.getItem("cyberpunk-red-panel-layout");
    if (!saved) return defaultPanelLayout;
    const parsed = JSON.parse(saved);
    return {
      rosterWidth: clampValue(num(parsed.rosterWidth ?? defaultPanelLayout.rosterWidth), 280, 430),
      opsWidth: clampValue(num(parsed.opsWidth ?? defaultPanelLayout.opsWidth), 300, 520),
      opsConsoleHeight: clampValue(num(parsed.opsConsoleHeight ?? defaultPanelLayout.opsConsoleHeight), 220, 620),
      opsResultHeight: clampValue(num(parsed.opsResultHeight ?? defaultPanelLayout.opsResultHeight), 160, 420)
    };
  } catch {
    return defaultPanelLayout;
  }
}

function fitPanelLayout(layout, columnBounds = null, opsBounds = null) {
  const next = { ...layout };
  const columnWidth = columnBounds?.width || 0;
  const centerMin = 420;
  const handleSpace = 16;
  const rosterMin = 280;
  const rosterMax = 430;
  const opsMin = 300;
  const opsMax = 520;

  if (columnWidth) {
    const maxRoster = Math.max(rosterMin, Math.min(rosterMax, columnWidth - next.opsWidth - centerMin - handleSpace));
    next.rosterWidth = clampValue(next.rosterWidth, rosterMin, maxRoster);
    const maxOps = Math.max(opsMin, Math.min(opsMax, columnWidth - next.rosterWidth - centerMin - handleSpace));
    next.opsWidth = clampValue(next.opsWidth, opsMin, maxOps);
  } else {
    next.rosterWidth = clampValue(next.rosterWidth, rosterMin, rosterMax);
    next.opsWidth = clampValue(next.opsWidth, opsMin, opsMax);
  }

  const opsHeight = opsBounds?.height || 0;
  const consoleMin = 220;
  const resultMin = 160;
  const logMin = 120;
  const rowHandleSpace = 16;

  if (opsHeight) {
    const maxConsole = Math.max(consoleMin, opsHeight - next.opsResultHeight - logMin - rowHandleSpace);
    next.opsConsoleHeight = clampValue(next.opsConsoleHeight, consoleMin, maxConsole);
    const maxResult = Math.max(resultMin, opsHeight - next.opsConsoleHeight - logMin - rowHandleSpace);
    next.opsResultHeight = clampValue(next.opsResultHeight, resultMin, maxResult);
  } else {
    next.opsConsoleHeight = clampValue(next.opsConsoleHeight, consoleMin, 620);
    next.opsResultHeight = clampValue(next.opsResultHeight, resultMin, 420);
  }

  return next;
}

function panelLayoutsEqual(a, b) {
  return a.rosterWidth === b.rosterWidth
    && a.opsWidth === b.opsWidth
    && a.opsConsoleHeight === b.opsConsoleHeight
    && a.opsResultHeight === b.opsResultHeight;
}

function nextConfigAfterStage(config, id) {
  if (!config.attacker) return { ...config, attacker: id };
  if (!config.defender && config.attacker !== id) return { ...config, defender: id };
  return config;
}

function nextSlotNumber(cards) {
  const usedNumbers = Object.keys(cards)
    .map(id => Number(String(id).match(/(\d+)$/)?.[1]))
    .filter(Number.isFinite);
  return Math.max(0, ...usedNumbers) + 1;
}

function nextSlotId(cards) {
  return `slot-${nextSlotNumber(cards)}`;
}

function clampPercent(value) {
  return Math.max(8, Math.min(92, value));
}

function clampValue(value, min, max) {
  const fallback = Number.isFinite(value) ? value : min;
  return Math.max(min, Math.min(max, fallback));
}

function defaultStagePosition(index) {
  const positions = [
    { x: 24, y: 34 },
    { x: 74, y: 36 },
    { x: 40, y: 64 },
    { x: 58, y: 58 },
    { x: 28, y: 72 },
    { x: 82, y: 66 },
    { x: 18, y: 52 },
    { x: 68, y: 78 }
  ];
  return positions[index % positions.length];
}

function fallbackPortrait(index) {
  return fallbackPortraits[index % fallbackPortraits.length] || "";
}

function mapPoint(index) {
  const points = [
    { x: 14, y: 22 },
    { x: 78, y: 28 },
    { x: 38, y: 42 },
    { x: 58, y: 22 },
    { x: 22, y: 70 },
    { x: 46, y: 75 },
    { x: 64, y: 62 },
    { x: 82, y: 72 },
    { x: 31, y: 28 },
    { x: 70, y: 44 },
    { x: 12, y: 58 },
    { x: 88, y: 52 }
  ];
  return points[index % points.length];
}

function routePath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const sweep = Math.max(7, Math.min(16, Math.abs(dx) * 0.18 + Math.abs(dy) * 0.08));
  const side = dy >= 0 ? 1 : -1;
  const c1x = from.x + dx * 0.36;
  const c1y = from.y + side * sweep;
  const c2x = from.x + dx * 0.68;
  const c2y = to.y - side * sweep;
  return `M ${roundPoint(from.x)} ${roundPoint(from.y)} C ${roundPoint(c1x)} ${roundPoint(c1y)} ${roundPoint(c2x)} ${roundPoint(c2y)} ${roundPoint(to.x)} ${roundPoint(to.y)}`;
}

function roundPoint(value) {
  return Math.round(value * 10) / 10;
}

createRoot(document.getElementById("root")).render(<App />);
