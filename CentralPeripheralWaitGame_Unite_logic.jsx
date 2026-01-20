// src/components/CentralPeripheralWaitGame.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * CentralPeripheralWaitGame (WAIT) – unit_logic refactor
 * - Zachová původní mechaniku: central stim → (delay) peripheral target + 3 distractors (WAIT do kliknutí)
 * - Struktura: GameSurface4K → StageDefinition → ButtonDefinition → LayoutEngine → GameEngine → GameView
 * - Kontrakt iSenses: props { sessionId, taskId, emitEvent, emitScore }
 * - emitEvent: {type, ts, data}
 * - emitScore: volá se 1× na konci: {taskId, metrics}
 */

export default function CentralPeripheralWaitGame({
  sessionId,
  taskId,
  emitEvent,
  emitScore,
  config,
}) {
  // ---------------------------------------------------------------------------
  // 1) GameSurface4K (rámec, layout, TopBar)
  // ---------------------------------------------------------------------------
  const GameSurface4K = useCallback(function GameSurface4K({
    title,
    descriptionHtml,
    running,
    progressPct,
    hits,
    errors,
    trialCount,
    totalTrials,
    onStart,
    onStop,
    children,
    palette,
  }) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: palette.blue,
          color: palette.white,
          padding: 16,
          gap: 12,
        }}
      >
        {/* TopBar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 20, fontWeight: 600, zIndex: 10 }}>{title}</div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontWeight: 600 }}>{progressPct}%</div>
            <div style={{ opacity: 0.95 }}>
              <span style={{ marginRight: 12 }}>Zásahy: {hits}</span>
              <span style={{ marginRight: 12 }}>Chyby: {errors}</span>
              <span>
                Trial: {trialCount}/{totalTrials}
              </span>
            </div>

            {running ? (
              <button
                onClick={onStop}
                style={{
                  padding: "8px 16px",
                  borderRadius: 16,
                  background: palette.white,
                  color: palette.black,
                  border: `4px solid ${palette.black}`,
                  cursor: "pointer",
                  userSelect: "none",
                  fontWeight: 600,
                }}
              >
                Stop
              </button>
            ) : (
              <button
                onClick={onStart}
                style={{
                  padding: "8px 16px",
                  borderRadius: 16,
                  background: palette.white,
                  color: palette.black,
                  border: `4px solid ${palette.black}`,
                  cursor: "pointer",
                  userSelect: "none",
                  fontWeight: 700,
                }}
              >
                Start
              </button>
            )}
          </div>
        </div>

        {/* Overlay + Description (před startem) */}
        {!running ? (
          <>
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.15)",
                pointerEvents: "none",
              }}
            />
            {descriptionHtml ? (
              <div
                style={{
                  maxWidth: 900,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 16,
                  padding: 16,
                }}
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            ) : null}
          </>
        ) : null}

        {/* Game area */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {children}
        </div>
      </div>
    );
  }, []);

  // ---------------------------------------------------------------------------
  // 2) StageDefinition (geometrie a parametry "hracího pole")
  // ---------------------------------------------------------------------------
  const StageDefinition = useMemo(() => {
    return {
      GRID_SIZE: 5,
      TOTAL_TRIALS: 50,
      DELAY_BETWEEN_MS: 800,
      NEXT_TRIAL_AFTER_CLICK_MS: 600,

      // UI proporce (zachováno z původního kódu)
      layout: {
        outerGridCols: "30vmin 15vmin 30vmin",
        outerGridRows: "30vmin 15vmin 30vmin",
        gap: 16,
        quadrantSize: "30vmin",
        centerSize: "15vmin",
        centerInnerSize: "13vmin",
      },
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 3) ButtonDefinition (UI-only tlačítko, bez logiky)
  // ---------------------------------------------------------------------------
  const ButtonCell = useCallback(function ButtonCell({ disabled, onClick, visual }) {
    // visual: { bg, border }
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          border: visual.border,
          background: visual.bg,
          borderRadius: 8,
          cursor: disabled ? "default" : "pointer",
          userSelect: "none",
        }}
      />
    );
  }, []);

  // ---------------------------------------------------------------------------
  // 4) LayoutEngine (jediné místo "větvení" rozložení / generování trialu)
  // ---------------------------------------------------------------------------
  const LayoutEngine = useMemo(() => {
    const quadrants = ["A", "B", "C", "D"]; // A=LH, B=PH, C=LD, D=PD
    const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
    const pick = (arr) => arr[randInt(0, arr.length - 1)];

    function buildTrial({ gridSize, targetColor, otherColor }) {
      const targetQuadrant = pick(quadrants);
      const targetIdx = randInt(0, gridSize * gridSize - 1);

      const distractors = quadrants
        .filter((q) => q !== targetQuadrant)
        .map((q) => ({
          quadrant: q,
          idx: randInt(0, gridSize * gridSize - 1),
          color: otherColor,
        }));

      return {
        target: { quadrant: targetQuadrant, idx: targetIdx, color: targetColor },
        distractors,
      };
    }

    return { quadrants, buildTrial };
  }, []);

  // ---------------------------------------------------------------------------
  // 5) GameEngine (logika, timing, metriky, emitEvent/emitScore)
  // ---------------------------------------------------------------------------
  const palette = useMemo(
    () => ({
      blue: "#1A4E8A",
      red: "#D50032",
      green: "#00A499",
      yellow: "#F2A900",
      gray: "#1D1D1D",
      white: "#FFFFFF",
      black: "#1D1D1D",
      panel: "#0D2B55",
    }),
    []
  );

  const name = String(config?.name ?? "");
  const description = String(config?.description ?? "");

  const nowMs = () => Date.now();

  const runningRef = useRef(false);
  const startTsRef = useRef(null);
  const reactionStartRef = useRef(null);

  const timersRef = useRef({ centralToPeripheral: null, nextTrial: null });
  const trialCountRef = useRef(0);
  const hitsRef = useRef(0);
  const errorsRef = useRef(0);
  const rtListRef = useRef([]);

  const [running, setRunning] = useState(false);
  const [trialCount, setTrialCount] = useState(0);

  const [centralStim, setCentralStim] = useState(null); // { color, id }
  const [peripheralStim, setPeripheralStim] = useState(null); // { quadrant, idx, color }
  const [distractors, setDistractors] = useState([]); // [{ quadrant, idx, color }]

  const clearTimers = useCallback(() => {
    const t = timersRef.current;
    if (t.centralToPeripheral) clearTimeout(t.centralToPeripheral);
    if (t.nextTrial) clearTimeout(t.nextTrial);
    timersRef.current.centralToPeripheral = null;
    timersRef.current.nextTrial = null;
  }, []);

  const resetEngine = useCallback(() => {
    clearTimers();
    trialCountRef.current = 0;
    hitsRef.current = 0;
    errorsRef.current = 0;
    rtListRef.current = [];

    setTrialCount(0);
    setCentralStim(null);
    setPeripheralStim(null);
    setDistractors([]);
  }, [clearTimers]);

  const finalizeAndEmitScore = useCallback(() => {
    const endTs = nowMs();
    const startTs = startTsRef.current ?? endTs;
    const durationMs = Math.max(0, endTs - startTs);

    const hits = hitsRef.current;
    const errors = errorsRef.current;
    const list = rtListRef.current.slice();

    const avg =
      list.length > 0 ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0;

    const accuracy =
      hits + errors > 0 ? Math.round((hits / (hits + errors)) * 100) : 0;

    // iSenses unified metrics (Core-like naming)
    emitScore?.({
      taskId,
      metrics: {
        Completion_Time: durationMs, // ms
        Reaction_Time_Avg: avg, // ms
        Reaction_Time_List: list, // ms[]
        Hits: hits,
        Errors: errors,
        Accuracy: accuracy, // %
      },
    });

    emitEvent?.({
      type: "END",
      ts: endTs,
      data: {
        Hits: hits,
        Errors: errors,
        Reaction_Time_Avg: avg,
        Accuracy: accuracy,
      },
    });
  }, [emitEvent, emitScore, taskId]);

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    runningRef.current = false;
    setRunning(false);
    clearTimers();

    // zhasnout UI
    setCentralStim(null);
    setPeripheralStim(null);
    setDistractors([]);

    finalizeAndEmitScore();
  }, [clearTimers, finalizeAndEmitScore]);

  const scheduleNextTrial = useCallback(() => {
    clearTimers();

    if (!runningRef.current) return;

    if (trialCountRef.current >= StageDefinition.TOTAL_TRIALS) {
      // konec
      stop();
      return;
    }

    // 1) central stim
    const stimColor = Math.random() < 0.5 ? palette.green : palette.blue;
    const stimId = `${nowMs()}-${Math.random().toString(36).slice(2, 8)}`;
    setCentralStim({ color: stimColor, id: stimId });

    emitEvent?.({
      type: "CENTRAL_STIM",
      ts: nowMs(),
      data: { color: stimColor },
    });

    // 2) po delay vyrobit peripheral trial (target + 3 distractors)
    const otherColor = stimColor === palette.green ? palette.blue : palette.green;

    timersRef.current.centralToPeripheral = setTimeout(() => {
      if (!runningRef.current) return;

      const built = LayoutEngine.buildTrial({
        gridSize: StageDefinition.GRID_SIZE,
        targetColor: stimColor,
        otherColor,
      });

      setPeripheralStim(built.target);
      setDistractors(built.distractors);
      reactionStartRef.current = performance.now();

      emitEvent?.({
        type: "PERIPH_STIM",
        ts: nowMs(),
        data: {
          quadrant: built.target.quadrant,
          idx: built.target.idx,
          color: built.target.color,
          distractors: built.distractors,
        },
      });
    }, StageDefinition.DELAY_BETWEEN_MS);
  }, [
    LayoutEngine,
    StageDefinition.DELAY_BETWEEN_MS,
    StageDefinition.GRID_SIZE,
    StageDefinition.TOTAL_TRIALS,
    clearTimers,
    emitEvent,
    palette.blue,
    palette.green,
    stop,
  ]);

  const start = useCallback(() => {
    resetEngine();
    runningRef.current = true;
    setRunning(true);

    const ts = nowMs();
    startTsRef.current = ts;

    emitEvent?.({
      type: "START",
      ts,
      data: { sessionId, taskId },
    });

    scheduleNextTrial();
  }, [emitEvent, resetEngine, scheduleNextTrial, sessionId, taskId]);

  const commitTrialAndContinue = useCallback(() => {
    // trialCount update (state + ref) a plánování dalšího trialu
    setTrialCount((prev) => {
      const next = prev + 1;
      trialCountRef.current = next;

      if (next >= StageDefinition.TOTAL_TRIALS) {
        timersRef.current.nextTrial = setTimeout(() => stop(), 0);
      } else {
        timersRef.current.nextTrial = setTimeout(
          () => scheduleNextTrial(),
          StageDefinition.NEXT_TRIAL_AFTER_CLICK_MS
        );
      }
      return next;
    });
  }, [
    StageDefinition.NEXT_TRIAL_AFTER_CLICK_MS,
    StageDefinition.TOTAL_TRIALS,
    scheduleNextTrial,
    stop,
  ]);

  const onCellClick = useCallback(
    (quad, idx) => {
      if (!runningRef.current) return;
      if (!peripheralStim) return; // ještě není periferní stimul

      const rt = Math.round(performance.now() - (reactionStartRef.current ?? performance.now()));
      const correct = quad === peripheralStim.quadrant && idx === peripheralStim.idx;

      if (correct) {
        hitsRef.current += 1;
        rtListRef.current.push(rt);
        emitEvent?.({
          type: "HIT",
          ts: nowMs(),
          data: { quadrant: quad, idx, reactionMs: rt },
        });
      } else {
        errorsRef.current += 1;
        emitEvent?.({
          type: "ERROR",
          ts: nowMs(),
          data: { quadrant: quad, idx, reactionMs: rt },
        });
      }

      // zhasnout a pokračovat
      setCentralStim(null);
      setPeripheralStim(null);
      setDistractors([]);

      commitTrialAndContinue();
    },
    [commitTrialAndContinue, emitEvent, peripheralStim]
  );

  // Cleanup (unit_logic požadavek: zastavit timery na unmount)
  useEffect(() => {
    return () => {
      runningRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  // ---------------------------------------------------------------------------
  // 6) GameView (kompozice UI)
  // ---------------------------------------------------------------------------
  const renderQuadrantGrid = useCallback(
    (quad) => {
      const active = peripheralStim && peripheralStim.quadrant === quad ? peripheralStim : null;
      const distractor = distractors.find((d) => d.quadrant === quad) ?? null;

      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${StageDefinition.GRID_SIZE}, 1fr)`,
            gridTemplateRows: `repeat(${StageDefinition.GRID_SIZE}, 1fr)`,
            gap: 4,
            width: "100%",
            height: "100%",
            background: palette.panel,
            borderRadius: 20,
            padding: 8,
          }}
        >
          {Array.from({ length: StageDefinition.GRID_SIZE * StageDefinition.GRID_SIZE }, (_, i) => {
            const isTarget = !!active && active.idx === i;
            const isDistractor = !!distractor && distractor.idx === i;

            let bg = palette.white;
            let border = "2px solid #ccc";

            if (isTarget) {
              bg = active.color;
              border = `2px solid ${palette.black}`;
            } else if (isDistractor) {
              bg = distractor.color;
              border = `2px solid ${palette.black}`;
            }

            return (
              <ButtonCell
                key={i}
                disabled={!running}
                onClick={() => onCellClick(quad, i)}
                visual={{ bg, border }}
              />
            );
          })}
        </div>
      );
    },
    [ButtonCell, StageDefinition.GRID_SIZE, distractors, onCellClick, palette, peripheralStim, running]
  );

  const progressPct = useMemo(() => {
    const pct =
      StageDefinition.TOTAL_TRIALS > 0
        ? Math.round((trialCount / StageDefinition.TOTAL_TRIALS) * 100)
        : 0;
    return Math.max(0, Math.min(100, pct));
  }, [StageDefinition.TOTAL_TRIALS, trialCount]);

  return (
    <GameSurface4K
      title={name}
      descriptionHtml={description}
      running={running}
      progressPct={progressPct}
      hits={hitsRef.current}
      errors={errorsRef.current}
      trialCount={trialCount}
      totalTrials={StageDefinition.TOTAL_TRIALS}
      onStart={start}
      onStop={stop}
      palette={palette}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: StageDefinition.layout.outerGridCols,
          gridTemplateRows: StageDefinition.layout.outerGridRows,
          gap: StageDefinition.layout.gap,
          alignItems: "center",
          justifyItems: "center",
        }}
      >
        {/* A - levý horní */}
        <div
          style={{
            gridColumn: "1",
            gridRow: "1",
            width: StageDefinition.layout.quadrantSize,
            height: StageDefinition.layout.quadrantSize,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {renderQuadrantGrid("A")}
        </div>

        {/* B - pravý horní */}
        <div
          style={{
            gridColumn: "3",
            gridRow: "1",
            width: StageDefinition.layout.quadrantSize,
            height: StageDefinition.layout.quadrantSize,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {renderQuadrantGrid("B")}
        </div>

        {/* Center */}
        <div
          style={{
            gridColumn: "2",
            gridRow: "2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: StageDefinition.layout.centerSize,
            height: StageDefinition.layout.centerSize,
          }}
        >
          {centralStim ? (
            <div
              style={{
                width: StageDefinition.layout.centerInnerSize,
                height: StageDefinition.layout.centerInnerSize,
                background: centralStim.color,
                border: `4px solid ${palette.white}`,
                borderRadius: 16,
                boxShadow: "0 8px 16px rgba(0,0,0,0.4)",
              }}
            />
          ) : null}
        </div>

        {/* C - levý dolní */}
        <div
          style={{
            gridColumn: "1",
            gridRow: "3",
            width: StageDefinition.layout.quadrantSize,
            height: StageDefinition.layout.quadrantSize,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {renderQuadrantGrid("C")}
        </div>

        {/* D - pravý dolní */}
        <div
          style={{
            gridColumn: "3",
            gridRow: "3",
            width: StageDefinition.layout.quadrantSize,
            height: StageDefinition.layout.quadrantSize,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {renderQuadrantGrid("D")}
        </div>
      </div>
    </GameSurface4K>
  );
}
