import { describe, it, expect, vi } from "vitest";
import type { InputCommand } from "../../src/sim/core.js";
import { addPlayer, applyInput, tickPlayers, type PlayerCore, type Rules, type SimWorld } from "../../src/sim/tick.js";

type World = SimWorld<PlayerCore>;

const cmd = (seq: number, over: Partial<InputCommand> = {}): InputCommand => ({
  seq,
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: 0,
  buttons: 0,
  ...over,
});

function makeWorld(): World {
  return {
    state: { tick: 0, players: new Map(), nextEntityId: 1, rngSeed: 1 },
    boxes: [],
    ground: null,
    forest: null,
    authoritative: true,
    waterLevel: null,
  };
}

function makeRules(extra: Partial<Rules<World, PlayerCore>> = {}): Rules<World, PlayerCore> {
  return {
    spawn: () => ({ pos: { x: 0, y: 1, z: 0 }, yaw: 0 }),
    newPlayer: (id, at) => ({
      id,
      pos: at.pos,
      vel: { x: 0, y: 0, z: 0 },
      yaw: at.yaw,
      pitch: 0,
      grounded: false,
      lastProcessedInput: 0,
    }),
    held: () => false,
    hostStep: () => {},
    ...extra,
  };
}

describe("Rules.move", () => {
  it("a move that answers true replaces the walking step", () => {
    const constrain = vi.fn();
    const rules = makeRules({
      constrain,
      move: (_w, p) => {
        p.pos.x += 1;
        return true;
      },
    });
    const world = makeWorld();
    const p = addPlayer(world, rules);
    tickPlayers(world, new Map([[p.id, cmd(7, { moveZ: 1, yaw: 0.5 })]]), rules);
    expect(p.pos).toEqual({ x: 1, y: 1, z: 0 });
    expect(p.yaw).toBe(0.5);
    expect(p.lastProcessedInput).toBe(7);
    expect(constrain).not.toHaveBeenCalled();
  });

  it("a move that answers false walks exactly as rules with no move", () => {
    const run = (rules: Rules<World, PlayerCore>) => {
      const world = makeWorld();
      const p = addPlayer(world, rules);
      for (let i = 1; i <= 30; i++) tickPlayers(world, new Map([[p.id, cmd(i, { moveZ: 1 })]]), rules);
      return p;
    };
    const without = run(makeRules());
    const withFalse = run(makeRules({ move: () => false }));
    expect(withFalse.pos).toEqual(without.pos);
    expect(withFalse.vel).toEqual(without.vel);
  });

  it("applyInput goes through the hook too", () => {
    const move = vi.fn(() => true);
    const rules = makeRules({ move });
    const world = makeWorld();
    const p = addPlayer(world, rules);
    applyInput(world, p.id, cmd(8), rules);
    expect(move).toHaveBeenCalledTimes(1);
  });

  it("a tick with no command hands the hook the player's last sequence number", () => {
    const move = vi.fn<NonNullable<Rules<World, PlayerCore>["move"]>>(() => true);
    const rules = makeRules({ move });
    const world = makeWorld();
    const p = addPlayer(world, rules);
    p.lastProcessedInput = 5;
    tickPlayers(world, new Map(), rules);
    expect(move.mock.calls[0]![2].seq).toBe(5);
  });

  it("a fresh command reaches the hook before the player's sequence number moves to it", () => {
    const seen: Array<[number, number]> = [];
    const rules = makeRules({
      move: (_w, p, c) => {
        seen.push([c.seq, p.lastProcessedInput]);
        return true;
      },
    });
    const world = makeWorld();
    const p = addPlayer(world, rules);
    tickPlayers(world, new Map([[p.id, cmd(3)]]), rules);
    expect(seen).toEqual([[3, 0]]);
    expect(p.lastProcessedInput).toBe(3);
  });
});
