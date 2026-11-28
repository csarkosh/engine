/**
 * The terrain's meshes on Babylon Lite: the clipmap's seven rings round the
 * camera (`clipmap.ts`) and the steep ground's patches in its reach
 * (`facePatches.ts`), drawn with the terrain's material from the vertex
 * data the two make (`terrainVertices.ts`): a mesh a ring, and one mesh
 * for all the patches.
 *
 * A ring is two meshes for its life, one drawn and one hidden. Its vertices
 * are as many whatever it draws, so a ring that moves is written again in
 * place, into the hidden one: the positions and the normals into the mesh's
 * own buffers, its triangles into an index buffer of the ring's full size
 * with the ones left out under a patch drawn as nothing, and the weights,
 * cover and colour into its plugin vertex data; then the two change places.
 *
 * The patches are one mesh, and one draw (`patchPool.ts`). A patch is a
 * slot of the mesh's vertex buffers, taken when its cell enters the reach
 * and let go when the cell leaves or is wanted at another spacing or
 * stitch, for the next patch of its size to be written over; and the set
 * shown is the mesh's one list of triangles, each patch's in its slot, the
 * patches in the order of their cells' places.
 *
 * **The rings and the patches change under the renderer's scheduler**
 * (`syncJobs.ts`). The rings move when the camera
 * crosses a line of the finest ring's lattice: at a walk as a job, every
 * ring's samples moved and each ring whose inputs changed made again in
 * slices and written to its hidden mesh, then all of them shown in the
 * job's last slice, together, so no frame draws one ring moved against a
 * neighbour that has not. A ring re-emits when it moved, when the ring
 * inside it or outside it moved (its hole follows the finer ring and its
 * border blends to the coarser one), or when the ground the patches cover
 * is measured from somewhere else, the rule `createClipmap` states in
 * full. As idle work each ring's next move on the camera's heading is
 * sampled ahead, and a rebuild that finds its move prepared commits it in
 * one step.
 *
 * Given the world's worker for the rings (`ringWork`), and while it has not
 * failed, the job is the worker's and is not patient: as its first slice
 * begins it asks for the camera's place, against what the page has drawn,
 * and the worker moves the samples and makes each stale ring; the job writes
 * each ring to its hidden mesh as it arrives, waiting at no cost while none
 * has, and shows the set in one step once it is done (`ringJob.ts`). The
 * first such ask hands the worker the rings' samples, and from then the page
 * holds none and prepares no move ahead. A build on this thread (the first,
 * a teleport, the loader's, or a job whose worker failed) stops the worker
 * and samples the rings anew where the page holds none, and the next job
 * hands them over again.
 *
 * The patches change when the camera crosses a line of their cells: at a
 * walk as one job, the cells to build placed nearest first, each into a
 * slot of the patches' mesh that no triangle drawn names yet, then in the
 * last slice the list of triangles written with the new ones in it and
 * without the ones they replace or that left, at once. Given the world's
 * worker (`patchWork`), the job asks it for the set's cells as its first
 * slice begins, so a request held behind a job that has started asks
 * nothing until that job is shown, and places each cell as it arrives,
 * waiting at no cost while none has (`patchJob.ts`); such a job is not
 * patient. Without a worker, or once it has failed, the job is patient and
 * makes the cells on this thread, one a slice, and a worker that fails
 * while a job waits leaves the rest of its set to this thread. Until then the last set shown is drawn whole, and the rings
 * leave out the ground that set covers. The first update draws the near
 * band at once and leaves the rest to the job; with nothing pending, idle
 * work builds ahead the cells the next crossing will want, asked of the
 * worker where there is one. A set built at once is this thread's, and
 * after the first update stops the worker first. The rings are
 * drawn first, the finest first, and the patches after them, ahead of
 * everything else (`drawOrder.ts`), their triangles in the order of their
 * cells' places (`patchPlace`): whenever a set is shown and whichever
 * patch was built last, two surfaces that share an edge are drawn in one
 * order.
 *
 * The first build, a teleport and a view moving fast build
 * at once (`crossingAt`), or are stepped by the loader of first builds
 * while the intro's film covers the hike (`firstBuilds.ts`). Given no
 * scheduler, every crossing is worked whole in the call that finds it.
 *
 * **What a frame sends is held to the renderer's budget**
 * (`frameUploads.ts`). Lite sends a mesh's geometry as it is made or
 * written, drawn or not, and its plugin vertex data with the next frame
 * once the mesh stands in the scene, shown or hidden. So a job sends a
 * ring whole to its hidden mesh, a ring at a time, each waiting for a frame
 * with room, and the frame that changes the rings' places sends nothing; a
 * patch goes ahead the same way, whole, to a slot no triangle drawn names
 * yet, and what is left for the frame that shows a set is the list of
 * triangles, from the first that differs.
 *
 * **Why a ring keeps two meshes.** A crossing leaves two rings stale at the
 * least (the finest, and the next, whose hole follows it) and all seven at
 * the most, about 1.6 MB a ring. Written in place they would have to go in
 * one frame, since a ring drawn moved against a neighbour that has not
 * leaves a gap: 3.2 MB to 11 MB in a frame against a budget of two
 * mebibytes. Written to meshes no frame draws, they go a ring a frame.
 */
import {
  addToScene, createMeshFromData, disposeMeshGpu, markPluginVertexData, removeFromScene, resizeMeshGeometry, setMeshVisible, updateMeshGeometry,
  enableMeshDrawArgs, updateMeshGeometryCapacity, updateMeshNormals, updateMeshPositions,
  type EngineContext, type Material, type Mesh, type SceneContext,
} from "@babylonjs/lite";
import type { TrailGraph } from "../../sim/trail.js";
import {
  BASE_SPACING_BY_TIER, RING_COUNT, commitRingMove, coversRing, createRingSamples, createRingSamplesSlices, prepareRingMove,
  ringSampleSlices, snapOrigin,
  type CoveredGround, type RingArrays, type RingGeometry, type RingMove, type RingSamples,
} from "../clipmap.js";
import {
  PATCH_CELL, PATCH_FAR_SPACING, PATCH_NEAR_SPACING, PATCH_REACH, facePatchCells, facePatchCover, facePatchGeometrySlices, facePatchStitch, patchIndices, patchKey,
  patchStitchBits,
  type FacePatch, type PatchCell, type PavedGround, type PatchReach, type PatchStitch,
} from "../facePatches.js";
import { buildAtOnce, type FirstBuilds } from "../firstBuilds.js";
import type { PatchWork } from "../patchWork.js";
import type { QualityTier } from "../quality.js";
import { createCrossing, crossingAt, finish, nextCrossing, type Slices, type SyncJobs } from "../syncJobs.js";
import { ringBuildSlices, ringDrawnOf, ringStale, type RingBuffers, type RingDrawn } from "../ringBuild.js";
import type { RingCover, RingSent } from "../ringWire.js";
import type { RingArrived, RingWork } from "../ringWork.js";
import { facePatchVertices, ringVertices, type TerrainVertices } from "../terrainVertices.js";
import { activeTerrainVariant } from "../../sim/terrain.js";
import type { PatchCellAsk } from "../worldWork.js";
import { DRAW_ORDER, DRAW_PLACES } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";
import { askThenPlace, type PatchPlacing } from "./patchJob.js";
import { askThenPlaceRings, type RingPlacing } from "./ringJob.js";
import {
  createMarkedRun, createPatchPool, firstDifference, patchIndexCapacity, patchIndexCount, patchVertexCount, writePatchTriangles,
  type DrawnPatch, type PatchSlot,
} from "./patchPool.js";
import type { ReflectionRegistry } from "./lakePanorama.js";
import { RAIN_MAP_RINGS, type CoverRegistry } from "./rainMap.js";
import { TERRAIN_VERTEX_FLOATS, terrainVertexData } from "./terrainPlugins.js";

/** What writing one ring's buffers is expected to take (ms): the game's own estimate. The
 * rings' job says so before its last slice (`syncJobs.ts`). */
const CLIPMAP_UPLOAD_MS = 1;

/** What showing a set of patches is expected to take (ms): its list of triangles written and sent, one step. The
 * scheduler learns the figure on the device it runs on (`syncJobs.ts`) and trusts it where it is more. A cell's own
 * sampling is not one step: it is sliced by the scheduler's clock (`facePatchGeometrySlices`). */
const FACE_PATCH_SHOW_MS = 2;

/**
 * Vertices the patches' pool is made with room for, by tier. A set drawn holds 6,000 to 10,000 on low and 21,000 to
 * 27,000 on medium, and at a run the pool also holds the set being built and the cells built ahead of the next: over
 * 100 m at 6 m/s it has taken 27,000 and 43,000 in the forest, and 34,000 and 64,000 from the trailhead, where the
 * ground is steepest. The high tier's reach covers 1.8 times the medium's ground. A view that wants more is given
 * more (`growPatches`), at the cost of sending the whole pool again in one frame, which is why the pool starts with
 * room to spare.
 */
export const PATCH_POOL_VERTICES: Readonly<Record<QualityTier, number>> = { low: 44_000, medium: 80_000, high: 144_000 };
/** Bytes of the five words the patches' draw reads its count from (`enableMeshDrawArgs`). */
const PATCH_DRAW_WORDS_BYTES = 20;

/** How much room a pool that has run out is given: half again what it had. */
const PATCH_POOL_GROWTH = 1.5;

/** Bytes a vertex of a patch is on the GPU: its position and its normal, and its plugin vertex data. */
const PATCH_GEOMETRY_BYTES = 24;
const PATCH_PLUGIN_BYTES = TERRAIN_VERTEX_FLOATS * 4;

export type TerrainMeshes = {
  /** The rings' first build, as slices: each ring sampled (one slice a ring,
   * its level told to `onRing`), then every ring made and written. Run once;
   * before it, the rings follow no camera. */
  firstBuild(onRing?: (level: number) => void): Slices;
  /** Follows the camera: the patches first, then the rings, which leave out
   * the ground the patches now drawn cover. */
  update(camX: number, camZ: number): void;
  /** Meshes drawn now: the rings built, and the patches' one while a cell of the set last shown has a patch. */
  meshCount(): number;
  /** Cells of the set last shown that have a patch. */
  patchCount(): number;
  dispose(): void;
};

export type TerrainMeshOptions = {
  /** Where the rings' first build is centred: where the hike's player starts. Absent or null, the origin. */
  start?: { x: number; z: number } | null;
  /** The first build's rings sampled ahead, where they are the ones a build
   * at `start` samples (`fittingRings`): taken as the rings' own. */
  rings?: RingSamples[] | null;
  /** The world's trail, which the walkable rock keeps off. */
  trail?: TrailGraph | null;
  /** The renderer's scheduler: given it, a crossing at a walk is a job. */
  jobs?: SyncJobs;
  /** The loader of first builds, while the intro's film covers the hike (`firstBuilds.ts`). */
  firstBuilds?: FirstBuilds;
  /** The renderer's record of its uploads, and its budget for the streamed ones (`frameUploads.ts`). */
  uploads?: FrameUploads;
  /** The rain's cover map, as terrain: the rings that cover its square and the patches' mesh, each from the frame it
   * joins the scene until it is let go (`rainMap.ts`). */
  cover?: CoverRegistry;
  /** What a lake's shore panorama draws of the ground: the rings out to the ridges (`REFLECTED_RINGS`) and the patches'
   * mesh, likewise (`lakePanorama.ts`). */
  reflections?: ReflectionRegistry;
  /** The session's client of the world's worker (`patchWork.ts`): given it, and while it has not failed, a crossing's
   * rock faces are asked of the worker and placed as they arrive. The meshes never end it. */
  patchWork?: PatchWork | null;
  /** The session's client of the world's worker for the rings (`ringWork.ts`): given it, and while it has not failed, a
   * crossing's rings are asked of the worker, written as they arrive and shown as a set. The meshes never end it. */
  ringWork?: RingWork | null;
};

/** The rings of the terrain in a lake's reflections: the five finest, to the ridges past the fourth's 512 m. */
export const REFLECTED_RINGS = 5;

/** Cells a side of the square the patches' places among the draws repeat over. */
const PATCH_PLACE_SIDE = 32;

/**
 * A patch's place among the draws (`drawOrder.ts`): its cell's, the same whenever the patch was built, so two patches
 * that share an edge are drawn in one order on every page. The patches' triangles stand in their one mesh in the
 * order of these (`patchPool.ts`). The places repeat every `PATCH_PLACE_SIDE` cells a way, further than two cells of
 * one set share an edge.
 */
export function patchPlace(ci: number, cj: number): number {
  const i = ((ci % PATCH_PLACE_SIDE) + PATCH_PLACE_SIDE) % PATCH_PLACE_SIDE;
  const j = ((cj % PATCH_PLACE_SIDE) + PATCH_PLACE_SIDE) % PATCH_PLACE_SIDE;
  return DRAW_ORDER.patches + (i * PATCH_PLACE_SIDE + j) / DRAW_PLACES;
}

/** The bytes a mesh's geometry is: its positions, its normals and its triangles. */
function geometryBytes(vertices: Pick<TerrainVertices, "positions" | "normals">, indices: Uint32Array): number {
  return vertices.positions.byteLength + vertices.normals.byteLength + indices.byteLength;
}

/** One of a ring's two meshes, written from buffers this thread made: the ring's geometry, its triangles at the index
 * buffer's full size, and its plugin vertex data, which a build here makes the ring again into. Null until the ring is
 * first made into it. */
type PageTwin = RingBuffers & { mesh: Mesh | null; inScene: boolean; sent: null };
/** One of a ring's two meshes, written from a ring the world's worker sent (`sent`), its plugin vertex data the ring's
 * own: it goes back to the worker once the mesh is written from another. */
type WorkerTwin = { mesh: Mesh | null; inScene: boolean; sent: RingSent; geometry: null; indices: null; plugin: Float32Array };
/** One of a ring's two meshes, and what it is written from: this thread's buffers, or a ring the worker sent. */
type RingTwin = PageTwin | WorkerTwin;

/** A cell as built: its spacing and stitch, its place among the draws, and its patch's slot in the pool, null for a
 * cell with no steep ground. */
type PatchEntry = { spacing: number; stitch: number; place: number; slot: PatchSlot | null; pattern: Uint16Array | null };

/** `covered` as it is sent to the world's worker: without its paved-ground function, which the worker makes from the
 * terrain's own as the page does (`ringServe.ts`). */
function ringCover(covered: CoveredGround | null): RingCover | null {
  if (covered === null) return null;
  const { x, z, reach, fine, cell } = covered;
  return { x, z, reach, fine, cell, pavedMargin: covered.paved === undefined ? null : (covered.pavedMargin ?? null) };
}

/** A set for a camera's cell: the cells walked from its centre, their stitches as numbers, and the indices of those
 * the set drawn does not hold as they are wanted, nearest the centre first. */
type Wanted = { ci: number; cj: number; cells: PatchCell[]; stitches: PatchStitch[]; bits: number[]; changed: number[] };

export function createTerrainMeshes(
  engine: EngineContext,
  scene: SceneContext,
  materials: { ground: Material; patches: Material },
  seed: number,
  tier: QualityTier,
  options: TerrainMeshOptions = {},
): TerrainMeshes {
  const { jobs, firstBuilds, uploads, cover, reflections } = options;
  const base = BASE_SPACING_BY_TIER[tier];
  /**
   * Ring 0's snap step (m): `snapOrigin` puts it on a lattice of twice its spacing, and every coarser ring moves only
   * when ring 0 does. It is the rings' cell for `crossingAt`. `createClipmap` names 2 m, the step at a spacing of
   * 1 m; at the low tier's 2 m the lattice is 4 m, and with a cell of 2 a single step reads as a jump of more than
   * a cell, so there every crossing would build at once.
   */
  const ringStep = 2 * base;
  let disposed = false;

  /** A terrain mesh of `vertices`, with its plugin vertex data, in `material`, drawn at `order` among the opaque meshes: not in the scene yet. */
  function meshOf(name: string, material: Material, vertices: Pick<TerrainVertices, "positions" | "normals">, drawnIndices: Uint32Array, plugin: Float32Array, order: number): Mesh {
    const made = createMeshFromData(engine, name, vertices.positions, vertices.normals, drawnIndices);
    made.pluginVertexData = plugin;
    made.material = material;
    made.renderOrder = order;
    uploads?.stream("geometry", geometryBytes(vertices, drawnIndices), 3);
    uploads?.made();
    return made;
  }

  // ---- The patches ---------------------------------------------------------------------------------------------

  const reach = PATCH_REACH[tier];
  /** The near band alone, as a reach: what the first update draws at once. */
  const nearReach: PatchReach = { near: reach.near, far: reach.near, wide: reach.near };
  /** The cells drawn: the set last shown. */
  let cells = new Map<number, PatchEntry>();
  /** Cells built and not yet drawn, their patches in slots no triangle names: a job's, or the idle work's ahead of a
   * crossing, until a set is shown. One a cell, spacing and stitch (`readyKey`), so the sets of two headings keep
   * their own builds. */
  const ready = new Map<number, PatchEntry>();
  /** The ground the patches drawn cover; null before any set is. */
  let patchCover: CoveredGround | null = null;
  let live = 0;

  /**
   * The patches' one mesh (`patchPool.ts`), made with the first patch built: its slots, the arrays its vertex buffers
   * and its plugin vertex data are written from, a slot's run at a time, and its list of triangles as the GPU holds
   * it, with a second the next list is written to before the two change places.
   */
  const pool = createPatchPool(PATCH_POOL_VERTICES[tier]);
  let patchMesh: Mesh | null = null;
  let patchPositions = new Float32Array(0);
  let patchNormals = new Float32Array(0);
  let patchPlugin = new Float32Array(0);
  let triangles = new Uint32Array(0);
  let nextTriangles = new Uint32Array(0);
  /** Indices of `triangles` drawn, and whether the list has been written since the mesh's buffers were made. */
  let drawnIndices = 0;
  let listWritten = false;
  /** Whether the mesh is drawn: hidden while its list is empty, so a view with no patch has no draw of theirs. */
  let patchesDrawn = false;
  /** Each band's triangles, from 0: a patch's own, kept from the first built at its spacing. */
  const patterns = new Map<number, Uint16Array>();
  const drawnPatches: DrawnPatch[] = [];
  /** The plugin vertex data marked this frame, which Lite sends as one run. */
  const marked = createMarkedRun();
  /** The floats of the plugin vertex data that are `slot`'s. */
  const pluginRun = (slot: PatchSlot): [number, number] =>
    [slot.at * TERRAIN_VERTEX_FLOATS, (slot.at + patchVertexCount(slot.spacing)) * TERRAIN_VERTEX_FLOATS];

  /** The patches' mesh, made at the pool's size where there is none: in the scene from the start and hidden until a
   * set is shown, so a patch's plugin vertex data goes up with the frame after it is written. */
  function standPatches(): Mesh {
    if (patchMesh !== null) return patchMesh;
    const capacity = pool.capacity;
    patchPositions = new Float32Array(capacity * 3);
    patchNormals = new Float32Array(capacity * 3);
    patchPlugin = new Float32Array(capacity * TERRAIN_VERTEX_FLOATS);
    triangles = new Uint32Array(patchIndexCapacity(capacity));
    nextTriangles = new Uint32Array(triangles.length);
    // Every index the first vertex: triangles of no size, which draw nothing.
    const made = createMeshFromData(engine, "facePatches", patchPositions, patchNormals, triangles);
    // The mesh draws the list it holds and no more, its count read from five words Lite writes with the list: the
    // room past the list is not drawn in any pass, and is not cleared.
    enableMeshDrawArgs(engine, made);
    made.pluginVertexData = patchPlugin;
    made.material = materials.patches;
    made.renderOrder = DRAW_ORDER.patches;
    setMeshVisible(made, false);
    addToScene(scene, made);
    cover?.add(made);
    reflections?.add(made);
    uploads?.count("geometry", patchPositions.byteLength + patchNormals.byteLength + triangles.byteLength, 3);
    uploads?.count("pluginVertices", patchPlugin.byteLength);
    uploads?.made();
    patchMesh = made;
    return made;
  }

  /** The pool given room for `more` vertices past what it has taken, and the mesh's buffers made again at that size:
   * every slot keeps its place, and the whole pool is sent again, which is why the pool starts with room to spare. */
  function growPatches(more: number): void {
    const capacity = Math.max(Math.ceil(pool.capacity * PATCH_POOL_GROWTH), pool.top + more);
    pool.grow(capacity);
    const mesh = patchMesh;
    if (mesh === null) return;
    const positions = new Float32Array(capacity * 3);
    const normals = new Float32Array(capacity * 3);
    const plugin = new Float32Array(capacity * TERRAIN_VERTEX_FLOATS);
    const list = new Uint32Array(patchIndexCapacity(capacity));
    positions.set(patchPositions);
    normals.set(patchNormals);
    plugin.set(patchPlugin);
    list.set(triangles.subarray(0, drawnIndices));
    resizeMeshGeometry(engine, mesh, positions, normals, list);
    mesh.pluginVertexData = plugin;
    mesh.pluginVertexVersion = (mesh.pluginVertexVersion ?? 0) + 1;
    patchPositions = positions;
    patchNormals = normals;
    patchPlugin = plugin;
    triangles = list;
    nextTriangles = new Uint32Array(list.length);
    listWritten = false;
    uploads?.stream("geometry", positions.byteLength + normals.byteLength + list.byteLength, 3);
    uploads?.stream("pluginVertices", plugin.byteLength);
  }

  /** A slot for a patch at `spacing`, the pool given more room where it has none. */
  function allot(spacing: number): PatchSlot {
    const slot = pool.take(spacing);
    if (slot !== null) return slot;
    growPatches(patchVertexCount(spacing));
    return pool.take(spacing) as PatchSlot;
  }

  /** `patch` written to `slot`: into the mesh's arrays, and from them to the GPU, its positions and its normals now and
   * its plugin vertex data with the next frame. No triangle drawn names the slot, so nothing shown changes. */
  function writePatch(slot: PatchSlot, vertices: TerrainVertices): void {
    const mesh = standPatches();
    const count = patchVertexCount(slot.spacing);
    if (vertices.positions.length !== count * 3) throw new Error(`a patch at ${slot.spacing} m has ${count} vertices, not ${vertices.positions.length / 3}`);
    if (!patterns.has(slot.spacing)) patterns.set(slot.spacing, patchIndices(Math.round(PATCH_CELL / slot.spacing)));
    patchPositions.set(vertices.positions, slot.at * 3);
    patchNormals.set(vertices.normals, slot.at * 3);
    const [from, to] = pluginRun(slot);
    const run = patchPlugin.subarray(from, to);
    if (terrainVertexData(vertices, run) !== run) throw new Error("a patch's plugin vertex data did not fit its slot");
    updateMeshPositions(engine, mesh, patchPositions, slot.at, count, slot.at);
    updateMeshNormals(engine, mesh, patchNormals, slot.at, count, slot.at);
    markPluginVertexData(mesh, from, to);
    uploads?.stream("geometry", count * PATCH_GEOMETRY_BYTES, 2);
    // Lite sends the frame's marks as one run: this one is counted as what it adds to the run.
    if (uploads !== undefined) {
      const writes = marked.begins(uploads.frame) ? 1 : 0;
      uploads.stream("pluginVertices", marked.mark(uploads.frame, from, to), writes);
    }
  }

  /**
   * The set `shown` drawn: its patches' triangles written to the spare list in the order of their places, and of
   * that the mesh's index buffer sent what differs from the list it holds, from the first index that does. The one
   * step that changes what is drawn.
   */
  function drawPatches(shown: ReadonlyMap<number, PatchEntry>): void {
    const mesh = patchMesh;
    // No patch was ever built: there is nothing to draw, and nothing drawn.
    if (mesh === null) return;
    drawnPatches.length = 0;
    for (const entry of shown.values()) if (entry.slot !== null) drawnPatches.push({ slot: entry.slot, place: entry.place, pattern: entry.pattern });
    const count = writePatchTriangles(drawnPatches, patterns, nextTriangles);
    const from = firstDifference(triangles, nextTriangles, Math.min(count, drawnIndices));
    // What the buffer holds past the new list is never drawn, so nothing is cleared: a list that differs is sent from
    // its first index that does, and one that has only another length sends the draw's five words alone.
    const resized = !listWritten || count !== drawnIndices;
    if (from < count || resized) {
      updateMeshGeometryCapacity(
        engine, mesh, patchPositions, patchNormals, nextTriangles.subarray(0, count), undefined, undefined, undefined, undefined, 1,
        { vertices: [], indices: [{ offset: from, count: count - from }] },
      );
      listWritten = true;
      uploads?.stream("geometry", (count - from) * 4 + (resized ? PATCH_DRAW_WORDS_BYTES : 0), (from < count ? 1 : 0) + (resized ? 1 : 0));
    }
    const held = triangles;
    triangles = nextTriangles;
    nextTriangles = held;
    drawnIndices = count;
    if (patchesDrawn !== count > 0) {
      patchesDrawn = count > 0;
      setMeshVisible(mesh, patchesDrawn);
    }
  }
  const patchCrossing = createCrossing();
  let patchHeadingX = 0;
  let patchHeadingZ = 0;
  /** The cell the idle work builds ahead for (NaN: none). */
  let aheadCi = Number.NaN;
  let aheadCj = Number.NaN;
  const ahead = new Float64Array(2);
  /** The patches' place in the scheduler's queue and the loader's. */
  const patchOwner = {};
  /** The world's worker's client, the session's: the patches' jobs at a walk and their idle work ask it for their
   * cells while it has not failed. */
  const patchWork = options.patchWork ?? null;

  /** Whether `entry` is the cell as wanted at `spacing` with `bits`: an empty cell is empty whatever its stitch. */
  const holds = (entry: PatchEntry | undefined, spacing: number, bits: number): entry is PatchEntry =>
    entry !== undefined && entry.spacing === spacing && (entry.stitch === bits || entry.slot === null);

  /** A drawn cell's patch let go: its slot is free once the list of triangles is next written (`drawPatches`). */
  function dropPatch(entry: PatchEntry): void {
    if (entry.slot === null) return;
    pool.free(entry.slot);
    entry.slot = null;
    live--;
  }

  /** A built cell never drawn, let go. */
  function discardPatch(entry: PatchEntry): void {
    if (entry.slot === null) return;
    pool.free(entry.slot);
    entry.slot = null;
  }

  /** The set walked from cell (ci, cj)'s centre, and what of it to build. */
  function want(ci: number, cj: number): Wanted {
    const cx = (ci + 0.5) * PATCH_CELL;
    const cz = (cj + 0.5) * PATCH_CELL;
    const list = facePatchCells(cx, cz, reach);
    const stitches = facePatchStitch(list);
    const bits = stitches.map(patchStitchBits);
    const changed: number[] = [];
    const d2: number[] = [];
    list.forEach((c, i) => {
      const dx = (c.ci + 0.5) * PATCH_CELL - cx;
      const dz = (c.cj + 0.5) * PATCH_CELL - cz;
      d2.push(dx * dx + dz * dz);
      if (!holds(cells.get(patchKey(c.ci, c.cj)), c.spacing, bits[i] as number)) changed.push(i);
    });
    // Stable: equal distances keep the walk's order.
    changed.sort((a, b) => (d2[a] as number) - (d2[b] as number));
    return { ci, cj, cells: list, stitches, bits, changed };
  }

  /** `ready`'s key for cell `i` of `w` built as wanted with a patch, or, with `empty`, built empty. */
  function readyKey(w: Wanted, i: number, empty: boolean): number {
    const c = w.cells[i] as PatchCell;
    const band = c.spacing === PATCH_NEAR_SPACING ? 0 : c.spacing === PATCH_FAR_SPACING ? 1 : 2;
    // The stitch's twelve bits, or a thirteenth for an empty cell.
    return (patchKey(c.ci, c.cj) * 4 + band) * 8192 + (empty ? 4096 : (w.bits[i] as number));
  }

  /** `ready`'s key for cell `i` of `w` if it is built as wanted, else NaN. */
  function readyAt(w: Wanted, i: number): number {
    const full = readyKey(w, i, false);
    if (ready.has(full)) return full;
    const empty = readyKey(w, i, true);
    return ready.has(empty) ? empty : Number.NaN;
  }

  const isReady = (w: Wanted, i: number): boolean => !Number.isNaN(readyAt(w, i));

  /** The ground the game paves, which no patch covers (`TerrainVariant.pavedGround`), as a function of position; null where none. */
  function pavedGround(): PavedGround | null {
    const hook = activeTerrainVariant().pavedGround;
    return hook === undefined ? null : (x, z) => hook(seed, x, z);
  }

  /** Cell `i` of `w`'s patch as wanted, computed in slices ended by the scheduler's clock: null for a cell with no steep ground. */
  function shapeSlices(w: Wanted, i: number): Slices<FacePatch | null> {
    const c = w.cells[i] as PatchCell;
    return facePatchGeometrySlices(seed, c.ci, c.cj, c.spacing, w.stitches[i] as PatchStitch, options.trail ?? null, pavedGround());
  }

  /** Cell `i` of `w`'s patch as wanted, computed at once. */
  const shape = (w: Wanted, i: number): FacePatch | null => finish(shapeSlices(w, i));

  /** The bytes writing `patch` to the slot it would take sends: its positions and its normals, and what its plugin
   * vertex data adds to the run the frame's marks send. */
  function shapeBytes(patch: FacePatch | null, spacing: number): number {
    if (patch === null) return 0;
    const slot = pool.peek(spacing);
    const plugin = slot === null || uploads === undefined ? patch.vertexCount * PATCH_PLUGIN_BYTES : marked.cost(uploads.frame, ...pluginRun(slot));
    return patch.vertexCount * PATCH_GEOMETRY_BYTES + plugin;
  }

  /** Cell `i` of `w` entered among the cells built and not yet drawn, `patch` written to a slot of the pool, unless
   * the cell was built meanwhile. */
  function enter(w: Wanted, i: number, patch: FacePatch | null): void {
    if (isReady(w, i)) return;
    const c = w.cells[i] as PatchCell;
    let slot: PatchSlot | null = null;
    let pattern: Uint16Array | null = null;
    if (patch !== null) {
      slot = allot(c.spacing);
      writePatch(slot, facePatchVertices(patch));
      // A patch with triangles left out (beside paved ground) is drawn by its own list, not its band's.
      if (patch.indices.length < patchIndexCount(c.spacing)) pattern = patch.indices;
    }
    ready.set(readyKey(w, i, slot === null), { spacing: c.spacing, stitch: w.bits[i] as number, place: patchPlace(c.ci, c.cj), slot, pattern });
  }

  /** Cell `i` of `w` built as wanted and not yet drawn, unless it is. */
  function make(w: Wanted, i: number): void {
    if (!isReady(w, i)) enter(w, i, shape(w, i));
  }

  /** Cell `i` of `w` built as a job builds it, in slices: computed a slice at a time, then written to a slot once the
   * frame's upload budget has room for it. */
  function* makeSlices(w: Wanted, i: number): Slices {
    const patch = yield* shapeSlices(w, i);
    if (uploads !== undefined) yield* uploads.hold(shapeBytes(patch, (w.cells[i] as PatchCell).spacing));
    if (disposed) return;
    enter(w, i, patch);
  }

  /** The bytes showing the set `w` sends at the most: the list of its triangles, whole. */
  function showBytes(w: Wanted, nearOnly: boolean): number {
    let bytes = 0;
    w.cells.forEach((c, i) => {
      if (nearOnly && c.spacing !== PATCH_NEAR_SPACING) return;
      const had = cells.get(patchKey(c.ci, c.cj));
      const entry = holds(had, c.spacing, w.bits[i] as number) ? had : ready.get(readyAt(w, i));
      if (entry !== undefined && entry.slot !== null) bytes += patchIndexCount(c.spacing) * 4;
    });
    return bytes;
  }

  /** Cell `i` of `w`, built as wanted and taken out of `ready`, to be drawn: built now unless it is already. */
  function take(w: Wanted, i: number): PatchEntry {
    make(w, i);
    const at = readyAt(w, i);
    const entry = ready.get(at) as PatchEntry;
    ready.delete(at);
    entry.stitch = w.bits[i] as number;
    return entry;
  }

  /**
   * The set `w` drawn: each cell built since taken into the set, and the patch it replaces dropped; then, unless
   * `nearOnly`, every cell of the old set that left dropped and what was built and not wanted let go; then the
   * set's triangles written, which is what changes the picture. With `nearOnly`, the near band alone, over a set
   * with none drawn: the first update's.
   */
  function showPatches(w: Wanted, nearOnly: boolean): void {
    const next = nearOnly ? cells : new Map<number, PatchEntry>();
    w.cells.forEach((c, i) => {
      if (nearOnly && c.spacing !== PATCH_NEAR_SPACING) return;
      const key = patchKey(c.ci, c.cj);
      const bits = w.bits[i] as number;
      const had = cells.get(key);
      if (holds(had, c.spacing, bits)) {
        had.stitch = bits;
        cells.delete(key);
        next.set(key, had);
        return;
      }
      // The patch it replaces is let go first: one built here takes its slot, which no frame draws before the list is
      // written below.
      if (had !== undefined) {
        dropPatch(had);
        cells.delete(key);
      }
      // Built by now; one that is not (a set drawn at once) is built here.
      const entry = take(w, i);
      if (entry.slot !== null) live++;
      next.set(key, entry);
    });
    if (!nearOnly) {
      // What is left of the old set has left the reach.
      for (const entry of cells.values()) dropPatch(entry);
      for (const entry of ready.values()) discardPatch(entry);
      ready.clear();
      // The idle work built for this crossing: the next update aims it at the next.
      stopAhead();
    }
    cells = next;
    drawPatches(cells);
    patchCover = facePatchCover((w.ci + 0.5) * PATCH_CELL, (w.cj + 0.5) * PATCH_CELL, nearOnly ? nearReach : reach, pavedGround());
  }

  /** The patches' rebuild for cell (ci, cj): the set worked out, each cell to build in a slice of its own, nearest
   * first, then the set drawn in the last. */
  function* rebuildPatches(ci: number, cj: number, nearOnly = false): Slices {
    const w = want(ci, cj);
    for (const i of w.changed) {
      if ((nearOnly && (w.cells[i] as PatchCell).spacing !== PATCH_NEAR_SPACING) || isReady(w, i)) continue;
      if (disposed) return;
      yield* makeSlices(w, i);
      // A cell is a slice at the least: the jobs behind it and the frame's share are looked at between cells.
      yield;
    }
    yield FACE_PATCH_SHOW_MS;
    if (uploads !== undefined) yield* uploads.hold(showBytes(w, nearOnly));
    if (disposed) return;
    showPatches(w, nearOnly);
  }

  /** Idle work: the cells the set for cell (ci, cj) will want built, nearest first. What was built for another cell
   * is kept, for a camera that turns back, until a set is shown. */
  function* buildAhead(ci: number, cj: number): Slices {
    const w = want(ci, cj);
    for (const i of w.changed) {
      if (isReady(w, i)) continue;
      if (disposed) return;
      yield* makeSlices(w, i);
      yield;
    }
  }

  /** Asks `work` for the cells of `w` to build that are not built yet, each under its key in `ready` as wanted with a
   * patch (`readyKey`), which names the cell, its band and its stitch: one key, one geometry. Returns `w`. */
  function askPatches(work: PatchWork, w: Wanted): Wanted {
    const asks: PatchCellAsk[] = [];
    const keys: number[] = [];
    for (const i of w.changed) {
      if (isReady(w, i)) continue;
      const c = w.cells[i] as PatchCell;
      asks.push({ ci: c.ci, cj: c.cj, spacing: c.spacing, stitch: w.stitches[i] as PatchStitch });
      keys.push(readyKey(w, i, false));
    }
    work.ask(asks, keys);
    return w;
  }

  /** What placing the cells of `w` that `work` sends takes (`patchJob.ts`). */
  function placing(work: PatchWork, w: Wanted): PatchPlacing {
    return {
      changed: w.changed,
      isReady: (i) => isReady(w, i),
      key: (i) => readyKey(w, i, false),
      arrived: (key) => work.take(key),
      failed: () => work.failed,
      *hold(i, patch): Slices {
        if (uploads !== undefined) yield* uploads.hold(shapeBytes(patch, (w.cells[i] as PatchCell).spacing));
      },
      enter: (i, patch) => enter(w, i, patch),
      makeHere: (i) => makeSlices(w, i),
      disposed: () => disposed,
    };
  }

  /**
   * The patches' rebuild for cell (ci, cj) with the world's worker: the set worked out and its cells not built yet
   * asked of `work` as the job's first slice begins, never at the crossing (`askThenPlace`); then each cell placed
   * as it arrives, nearest first, and the set drawn in the last slice, as `rebuildPatches` draws it.
   */
  function* rebuildAsked(work: PatchWork, ci: number, cj: number): Slices {
    const w = yield* askThenPlace(() => askPatches(work, want(ci, cj)), (set) => placing(work, set));
    if (disposed) return;
    yield FACE_PATCH_SHOW_MS;
    if (uploads !== undefined) yield* uploads.hold(showBytes(w, false));
    if (disposed) return;
    showPatches(w, false);
  }

  /** Idle work with the world's worker: the cells the set for cell (ci, cj) will want, asked of `work` as its first
   * slice begins and placed as they arrive, nearest first. */
  function* buildAheadAsked(work: PatchWork, ci: number, cj: number): Slices {
    yield* askThenPlace(() => askPatches(work, want(ci, cj)), (set) => placing(work, set));
  }

  /** The idle work stopped: the next `aimPatches` sets it again. */
  function stopAhead(): void {
    jobs?.idle(patchOwner, null);
    aheadCi = Number.NaN;
    aheadCj = Number.NaN;
  }

  /** Aims the idle work at the cell the camera at (camX, camZ) enters next on its heading, when that changed. */
  function aimPatches(camX: number, camZ: number): void {
    if (jobs === undefined || jobs.pending(patchOwner)) return;
    let ci = Number.NaN;
    let cj = Number.NaN;
    if (nextCrossing(camX, camZ, patchHeadingX, patchHeadingZ, PATCH_CELL, ahead)) {
      ci = Math.floor((ahead[0] as number) / PATCH_CELL);
      cj = Math.floor((ahead[1] as number) / PATCH_CELL);
    }
    if (Object.is(ci, aheadCi) && Object.is(cj, aheadCj)) return;
    aheadCi = ci;
    aheadCj = cj;
    jobs.idle(patchOwner, Number.isNaN(ci) ? null : patchWork !== null && !patchWork.failed ? buildAheadAsked(patchWork, ci, cj) : buildAhead(ci, cj));
  }

  /** Begins the patches' rebuild for cell (ci, cj) as a job: asked of the worker where there is one that has not
   * failed, a job that is not patient; else built on this thread, a patient one. */
  function beginRebuild(ci: number, cj: number): void {
    if (patchWork !== null && !patchWork.failed) (jobs as SyncJobs).begin(patchOwner, rebuildAsked(patchWork, ci, cj), false, "facePatches");
    else (jobs as SyncJobs).begin(patchOwner, rebuildPatches(ci, cj), true, "facePatches");
  }

  function updatePatches(camX: number, camZ: number): void {
    const hx = camX - patchCrossing.lastX;
    const hz = camZ - patchCrossing.lastZ;
    if ((hx !== 0 || hz !== 0) && !Number.isNaN(hx) && !Number.isNaN(hz)) {
      patchHeadingX = hx;
      patchHeadingZ = hz;
    }
    const ci = Math.floor(camX / PATCH_CELL);
    const cj = Math.floor(camZ / PATCH_CELL);
    const first = Number.isNaN(patchCrossing.originX);
    const kind = crossingAt(patchCrossing, camX, camZ, ci * PATCH_CELL, cj * PATCH_CELL, PATCH_CELL, jobs !== undefined, jobs?.viewedAt(), jobs, "facePatches");
    if (kind === "none") {
      // While the loader steps the first set, nothing is built ahead of it.
      if (firstBuilds?.queued(patchOwner) !== true) aimPatches(camX, camZ);
      return;
    }
    // A new place: a set the loader still holds for the last one is dropped.
    firstBuilds?.cancel(patchOwner);
    // Idle work runs beside a patient job, and a job's ask of the worker replaces the idle work's: the job builds what
    // it needs, and the idle work starts again once it is drawn.
    stopAhead();
    if (kind === "later") {
      beginRebuild(ci, cj);
      return;
    }
    jobs?.cancel(patchOwner);
    // Built at once on this thread after the first update (a teleport): the worker stops, and holds nothing of a set
    // no job will place. On the first update nothing has been asked of it, so it is sent nothing.
    if (!first) patchWork?.clear();
    if (first && jobs !== undefined) {
      if (firstBuilds?.open === true) {
        // Under the film no frame shows the face in front of the camera: the whole set is the loader's.
        firstBuilds.add(patchOwner, rebuildPatches(ci, cj), "facePatches");
        return;
      }
      // The face in front of the camera on the first frame, the distance over the frames after it.
      const startedAt = jobs.atOnceStart();
      finish(rebuildPatches(ci, cj, true));
      jobs.atOnceEnd("facePatches", startedAt);
      beginRebuild(ci, cj);
      return;
    }
    const startedAt = jobs?.atOnceStart() ?? Number.NaN;
    finish(rebuildPatches(ci, cj));
    jobs?.atOnceEnd("facePatches", startedAt);
  }

  // ---- The rings -----------------------------------------------------------------------------------------------

  /** The seven rings' samples, while the page holds them: empty from when they go to the world's worker until a build
   * on this thread samples them anew (`samplesAway`). */
  const rings: RingSamples[] = [];
  /** Each ring's two meshes, and which of them is drawn (-1: neither yet). A rebuild writes the other, which no frame
   * draws, and its last slice shows it in the drawn one's place. */
  const twins: [RingTwin, RingTwin][] = [];
  const shown: number[] = [];
  const drawn: (RingDrawn | undefined)[] = [];
  /** The one spare set of sample arrays the rings' moves share (`ringSampleSlices`). */
  const spare: RingArrays[] = [];
  /** The covered ground of the rebuild in progress, or of the last. */
  let covered: CoveredGround | null = null;
  const ringCrossing = createCrossing();
  const ringOwner = {};
  /** Each ring's next move, prepared ahead, or null. */
  const prepared: (RingMove | null)[] = [];
  /** The origin each ring is expected to move to next (NaN: none), which `prepared` is worked out for. */
  const expectX = new Float64Array(RING_COUNT).fill(Number.NaN);
  const expectZ = new Float64Array(RING_COUNT).fill(Number.NaN);
  /** The camera's last move between two frames: its heading. */
  let headingX = 0;
  let headingZ = 0;
  /** The world's worker's client for the rings, the session's: the rings' jobs ask it for their rings while it has not
   * failed. */
  const ringWork = options.ringWork ?? null;
  /** Whether the rings' samples went to the worker, so the page holds none (`rings` is empty). */
  let samplesAway = false;
  const twin = (): RingTwin => ({ mesh: null, geometry: null, indices: null, plugin: null, inScene: false, sent: null });
  for (let level = 0; level < RING_COUNT; level++) {
    twins.push([twin(), twin()]);
    shown.push(-1);
    prepared.push(null);
  }
  /** Which of ring `level`'s two meshes is not drawn. */
  const hiddenAt = (level: number): 0 | 1 => (shown[level] === 0 ? 1 : 0);
  /** The mesh of ring `level` that is not drawn: the one a rebuild writes. */
  const hidden = (level: number): RingTwin => (twins[level] as [RingTwin, RingTwin])[hiddenAt(level)];
  /** Whether the rings' next moves are prepared ahead: not while the worker is used, nor while the page holds no samples. */
  const preparesAhead = (): boolean => !samplesAway && (ringWork === null || ringWork.failed);

  const coverOf = (level: number): CoveredGround | null => (coversRing(covered, (rings[level] as RingSamples).spacing) ? covered : null);

  /** What ring `level` made from the page's samples as they stand is made against. */
  function drawnNow(level: number): RingDrawn {
    const ring = rings[level] as RingSamples;
    const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
    const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
    return ringDrawnOf(ring, finer, coarser, coverOf(level));
  }

  function stale(level: number): boolean {
    return ringStale(drawn[level], drawnNow(level));
  }

  /** Ring `level`'s hidden mesh as this thread makes the ring into it: one written from the worker's ring is given
   * buffers of this thread's, as on first use, and the worker's ring is dropped. */
  function madeHere(level: number): PageTwin {
    const pair = twins[level] as [RingTwin, RingTwin];
    const at = hiddenAt(level);
    const to = pair[at];
    if (to.sent === null) return to;
    const here: PageTwin = { mesh: to.mesh, inScene: to.inScene, geometry: null, indices: null, plugin: null, sent: null };
    pair[at] = here;
    return here;
  }

  /** Ring `level` made again from its samples, in slices, into the arrays its hidden mesh is written from. */
  function* emit(level: number): Slices {
    const ring = rings[level] as RingSamples;
    const finer = level > 0 ? (rings[level - 1] as RingSamples) : null;
    // The border blends to the coarser ring's samples, so every ring has moved before any ring emits.
    const coarser = level < RING_COUNT - 1 ? (rings[level + 1] as RingSamples) : null;
    const to = madeHere(level);
    yield* ringBuildSlices(ring, finer, coarser, coverOf(level), to);
  }

  /** The bytes writing ring `level` to its hidden mesh sends: its geometry, and its plugin vertex data where the
   * mesh stands in the scene. */
  function stageBytes(level: number): number {
    const to = hidden(level);
    return geometryBytes(ringVertices(to.geometry as RingGeometry), to.indices as Uint32Array) + (to.inScene ? (to.plugin?.byteLength ?? 0) : 0);
  }

  /** Ring `level` as `emit` made it, written to its hidden mesh, or to a mesh made for it: Lite sends the geometry
   * now, and the plugin vertex data with the next frame, or, for a mesh not in the scene yet, with the frame that
   * shows it. */
  function stage(level: number): void {
    const to = hidden(level);
    const vertices = ringVertices(to.geometry as RingGeometry);
    const whole = to.indices as Uint32Array;
    if (to.mesh === null) {
      // A ring's place is its level's: the finest first, whichever of a ring's two meshes joined the scene last.
      to.mesh = meshOf(`clipmap_${level}`, materials.ground, vertices, whole, to.plugin as Float32Array, DRAW_ORDER.rings + level / DRAW_PLACES);
      return;
    }
    updateMeshGeometry(engine, to.mesh, vertices.positions, vertices.normals, whole);
    to.mesh.pluginVertexData = to.plugin;
    to.mesh.pluginVertexVersion = (to.mesh.pluginVertexVersion ?? 0) + 1;
    uploads?.stream("geometry", geometryBytes(vertices, whole), 3);
    if (to.inScene) uploads?.stream("pluginVertices", to.plugin?.byteLength ?? 0);
  }

  /** The bytes showing ring `level`'s hidden mesh sends: its plugin vertex data, where the mesh first joins the scene. */
  function showBytesOf(level: number): number {
    const to = hidden(level);
    return to.inScene ? 0 : (to.plugin?.byteLength ?? 0);
  }

  /** The bytes writing `arrived`, a ring the worker sent, to its level's hidden mesh sends, as `stageBytes` counts
   * them: its geometry, and its plugin vertex data where the mesh stands in the scene. */
  function sentBytes(arrived: RingArrived): number {
    const { ring } = arrived;
    return geometryBytes(ring, ring.indices) + (hidden(arrived.level).inScene ? ring.plugin.byteLength : 0);
  }

  /** `arrived`, a ring the worker sent, written to its level's hidden mesh, or to a mesh made for it, as `stage` writes
   * one of this thread's. The mesh holds the ring from then; what it held before goes back to the worker if it was the
   * worker's, and is dropped if it was this thread's. */
  function writeSent(work: RingWork, arrived: RingArrived): void {
    const { level, ring } = arrived;
    const pair = twins[level] as [RingTwin, RingTwin];
    const at = hiddenAt(level);
    const to = pair[at];
    let mesh = to.mesh;
    if (mesh === null) mesh = meshOf(`clipmap_${level}`, materials.ground, ring, ring.indices, ring.plugin, DRAW_ORDER.rings + level / DRAW_PLACES);
    else {
      updateMeshGeometry(engine, mesh, ring.positions, ring.normals, ring.indices);
      mesh.pluginVertexData = ring.plugin;
      mesh.pluginVertexVersion = (mesh.pluginVertexVersion ?? 0) + 1;
      uploads?.stream("geometry", geometryBytes(ring, ring.indices), 3);
      if (to.inScene) uploads?.stream("pluginVertices", ring.plugin.byteLength);
    }
    if (to.sent !== null) work.giveBack(to.sent);
    pair[at] = { mesh, inScene: to.inScene, sent: ring, geometry: null, indices: null, plugin: ring.plugin };
  }

  /** Ring `level`'s hidden mesh shown in the drawn one's place, and the other hidden for the next rebuild to write. A
   * mesh that first joins the scene sends its plugin vertex data with the frame. `made` is what the ring was made
   * against, where the worker made it; else it is worked out from the page's samples. */
  function show(level: number, made?: RingDrawn): void {
    const to = hidden(level);
    const mesh = to.mesh as Mesh;
    if (to.inScene) setMeshVisible(mesh, true);
    else {
      addToScene(scene, mesh);
      to.inScene = true;
      uploads?.stream("pluginVertices", to.plugin?.byteLength ?? 0);
      // Both of a ring's meshes stand in the map; it draws the one shown.
      if (level < RAIN_MAP_RINGS) cover?.add(mesh);
      // And both in a lake's reflections, which draw the one shown too.
      if (level < REFLECTED_RINGS) reflections?.add(mesh);
    }
    const was = shown[level] as number;
    if (was >= 0) {
      const old = (twins[level] as [RingTwin, RingTwin])[was] as RingTwin;
      if (old.mesh !== null) setMeshVisible(old.mesh, false);
    }
    shown[level] = was === 0 ? 1 : 0;
    drawn[level] = made ?? drawnNow(level);
  }

  /** Hands back a prepared move that is not for ring `level` as it stands, going to (ox, oz), or, with `onTheWay`,
   * going part of the way there: along one axis of a step that also goes along the other. */
  function dropPrepared(level: number, ox: number, oz: number, onTheWay = false): void {
    const p = prepared[level];
    if (p === null || p === undefined) return;
    const ring = rings[level] as RingSamples;
    if (p.moves === ring.moves) {
      if (p.originX === ox && p.originZ === oz) return;
      if (onTheWay && (p.originX === ox || p.originX === ring.originX) && (p.originZ === oz || p.originZ === ring.originZ)) return;
    }
    spare.push(p.arrays);
    prepared[level] = null;
  }

  /** Where each ring moves next if the camera at (camX, camZ) keeps its heading: across whichever of its lattice's
   * lines, x or z, the camera reaches first. Returns whether any ring's expectation changed. */
  function expect(camX: number, camZ: number): boolean {
    let changed = false;
    for (let level = 0; level < RING_COUNT; level++) {
      const ring = rings[level] as RingSamples;
      const s = ring.spacing;
      const tx = headingX > 0 ? (ring.originX + 66 * s - camX) / headingX
        : headingX < 0 ? (camX - (ring.originX + 64 * s)) / -headingX : Infinity;
      const tz = headingZ > 0 ? (ring.originZ + 66 * s - camZ) / headingZ
        : headingZ < 0 ? (camZ - (ring.originZ + 64 * s)) / -headingZ : Infinity;
      let ex = Number.NaN;
      let ez = Number.NaN;
      if (tx < Infinity || tz < Infinity) {
        ex = tx <= tz ? ring.originX + Math.sign(headingX) * 2 * s : ring.originX;
        ez = tx <= tz ? ring.originZ : ring.originZ + Math.sign(headingZ) * 2 * s;
      }
      if (!Object.is(ex, expectX[level]) || !Object.is(ez, expectZ[level])) changed = true;
      expectX[level] = ex;
      expectZ[level] = ez;
    }
    return changed;
  }

  /** Idle work: each ring's expected move prepared, finer rings first. */
  function* prepare(): Slices {
    for (let level = 0; level < RING_COUNT; level++) {
      const ring = rings[level] as RingSamples;
      const ex = expectX[level] as number;
      const ez = expectZ[level] as number;
      if (Number.isNaN(ex) || (ex === ring.originX && ez === ring.originZ)) continue;
      dropPrepared(level, ex, ez);
      if (prepared[level] !== null) continue;
      prepared[level] = yield* prepareRingMove(ring, seed, ex, ez, spare);
    }
  }

  /** Re-aims the idle work at the camera's next moves, when they changed. */
  function aimRings(camX: number, camZ: number, force: boolean): void {
    if (jobs === undefined || jobs.pending(ringOwner) || !preparesAhead()) return;
    if (expect(camX, camZ) || force) jobs.idle(ringOwner, prepare());
  }

  /** The rings for a camera at (camX, camZ): every ring's samples moved, then each stale ring made again, in slices
   * of its own, and written to its hidden mesh once the frame's upload budget has room for it, then all of them
   * shown in the last slice. Without `uncovered` the rings leave out the ground the patches now drawn cover. With
   * `atOnce` it is a build at once (`buildAtOnce`), and a ring it samples anew is sampled whole; a job's samples anew in
   * slices (`sampleAnew`). */
  function* build(camX: number, camZ: number, uncovered = false, atOnce = false): Slices {
    if (samplesAway) {
      yield* sampleAnew(camX, camZ, atOnce);
      if (disposed) return;
    }
    covered = uncovered ? null : patchCover;
    for (let level = 0; level < RING_COUNT; level++) {
      const ring = rings[level] as RingSamples;
      const ox = snapOrigin(camX, ring.spacing);
      const oz = snapOrigin(camZ, ring.spacing);
      // A ring that stays keeps its prepared move for when it does go.
      if (ox === ring.originX && oz === ring.originZ) continue;
      // A move prepared along one axis of a step along both is committed, and the move samples only the rest of the way.
      dropPrepared(level, ox, oz, true);
      const p = prepared[level];
      if (p !== null && p !== undefined) {
        commitRingMove(ring, p, spare);
        prepared[level] = null;
      }
      yield* ringSampleSlices(ring, seed, camX, camZ, spare);
    }
    const made: number[] = [];
    let showing = 0;
    for (let level = 0; level < RING_COUNT; level++) {
      if (!stale(level)) continue;
      yield* emit(level);
      // A ring's write is one step, and a long one.
      yield CLIPMAP_UPLOAD_MS;
      if (uploads !== undefined) yield* uploads.hold(stageBytes(level));
      if (disposed) return;
      stage(level);
      made.push(level);
      showing += showBytesOf(level);
    }
    // The rings change places in one step, which sends nothing but for a mesh that first joins the scene.
    if (made.length > 0) {
      yield;
      if (uploads !== undefined) yield* uploads.hold(showing);
    }
    if (disposed) return;
    for (const level of made) show(level);
    // The rings stand somewhere new: aim the idle work at their next moves.
    if (!Number.isNaN(ringCrossing.lastX)) aimRings(ringCrossing.lastX, ringCrossing.lastZ, true);
  }

  /** The seven rings sampled anew for a camera at (camX, camZ), where their samples went to the worker: at once a ring
   * a step, and in a job in slices by the scheduler's clock (`createRingSamplesSlices`). The worker is stopped first,
   * so it holds them no more, and the page holds the new ones once all seven are. */
  function* sampleAnew(camX: number, camZ: number, atOnce: boolean): Slices {
    ringWork?.stop();
    const fresh: RingSamples[] = [];
    for (let level = 0; level < RING_COUNT; level++) {
      if (disposed) return;
      if (atOnce) fresh.push(createRingSamples(seed, level, camX, camZ, base));
      else fresh.push(yield* createRingSamplesSlices(seed, level, camX, camZ, base));
      yield;
    }
    rings.push(...fresh);
    samplesAway = false;
  }

  /** Asks `work` for the rings for a camera at (camX, camZ), leaving out the ground the patches now drawn cover, against
   * what the page has drawn; with the page's samples where the worker holds none, after which the page holds none, nor
   * the moves prepared from them, nor the spare arrays the moves share. */
  function askRings(work: RingWork, camX: number, camZ: number): void {
    if (work.failed) return;
    covered = patchCover;
    const request = { camX, camZ, cover: ringCover(covered), drawn: Array.from({ length: RING_COUNT }, (_, level) => drawn[level] ?? null) };
    work.ask(work.holds ? request : { ...request, samples: handOver() });
  }

  /** The page's samples, taken out of `rings` for the worker: what was prepared from them and ahead of them goes. */
  function handOver(): RingSamples[] {
    samplesAway = true;
    prepared.fill(null);
    spare.length = 0;
    jobs?.idle(ringOwner, null);
    return rings.splice(0);
  }

  /** What writing and showing the rings `work` sends for a camera at (camX, camZ) takes (`ringJob.ts`). */
  function ringPlacing(work: RingWork, camX: number, camZ: number): RingPlacing {
    /** The rings written in this job, and what each was made against. */
    const written: { level: number; drawn: RingDrawn }[] = [];
    return {
      ask: () => askRings(work, camX, camZ),
      arrived: () => work.take(),
      done: () => work.done,
      failed: () => work.failed,
      disposed: () => disposed,
      // A ring's write is one step, and a long one, as `build`'s.
      *holdWrite(ring): Slices {
        yield CLIPMAP_UPLOAD_MS;
        if (uploads !== undefined) yield* uploads.hold(sentBytes(ring));
      },
      write(ring) {
        writeSent(work, ring);
        written.push({ level: ring.level, drawn: ring.drawn });
      },
      *holdShow(): Slices {
        let showing = 0;
        for (const ring of written) showing += showBytesOf(ring.level);
        if (uploads !== undefined) yield* uploads.hold(showing);
      },
      show() {
        for (const ring of written) show(ring.level, ring.drawn);
      },
      // The rings written are not shown as they are: the build samples anew, and makes again and shows whatever is
      // stale against what is drawn. A ring it finds fresh stays hidden, and only a build or a job that writes a ring
      // shows it.
      finishHere: () => build(camX, camZ),
    };
  }

  /**
   * The rings for a camera at (camX, camZ) with the world's worker: asked of `work` as the job's first slice begins,
   * never at the crossing, then each written to its hidden mesh as it arrives and all of them shown in one step once
   * the set is done (`askThenPlaceRings`). Where neither the page nor the worker holds the samples (a build that was to
   * sample them anew was dropped before it did), the job is this thread's build. A job dropped while its set is out
   * stops the worker, so the next ask finds none out.
   */
  function* ringsAsked(work: RingWork, camX: number, camZ: number): Slices {
    if (samplesAway && !work.holds) {
      yield* build(camX, camZ);
      return;
    }
    try {
      yield* askThenPlaceRings(ringPlacing(work, camX, camZ));
    } finally {
      if (work.out) work.stop();
    }
  }

  /** Begins the rings' rebuild for a camera at (camX, camZ) as a job that is not patient: asked of the worker where
   * there is one that has not failed, else built on this thread. */
  function beginRings(camX: number, camZ: number): void {
    if (ringWork !== null && !ringWork.failed) (jobs as SyncJobs).begin(ringOwner, ringsAsked(ringWork, camX, camZ), false, "clipmap");
    else (jobs as SyncJobs).begin(ringOwner, build(camX, camZ), false, "clipmap");
  }

  function* firstBuild(onRing?: (level: number) => void): Slices {
    if (rings.length === RING_COUNT || samplesAway || disposed) return;
    const at = options.start ?? { x: 0, z: 0 };
    const sampled = options.rings ?? null;
    for (let level = 0; level < RING_COUNT; level++) {
      rings.push(sampled?.[level] ?? createRingSamples(seed, level, at.x, at.z, base));
      onRing?.(level);
      // A ring taken made costs nothing: the seven are one slice.
      if (sampled === null) yield;
    }
    if (sampled !== null) yield;
    // No patch stands yet: the first update measures the covered ground from the camera.
    yield* build(at.x, at.z, true);
  }

  function updateRings(camX: number, camZ: number): void {
    if (rings.length < RING_COUNT && !samplesAway) return;
    const hx = camX - ringCrossing.lastX;
    const hz = camZ - ringCrossing.lastZ;
    if ((hx !== 0 || hz !== 0) && !Number.isNaN(hx) && !Number.isNaN(hz)) {
      headingX = hx;
      headingZ = hz;
    }
    const kind = crossingAt(ringCrossing, camX, camZ, snapOrigin(camX, base), snapOrigin(camZ, base), ringStep, jobs !== undefined, jobs?.viewedAt(), jobs, "clipmap");
    if (kind === "none") {
      // While the loader steps the rings' build, nothing else is begun and nothing prepared ahead of it.
      if (firstBuilds?.queued(ringOwner) === true) return;
      // The patches drew a new set since the rings last asked: the rings that leave ground out are drawn again for
      // it, though the camera has not moved, so none waits on a further crossing to stop leaving out ground the new
      // set no longer covers.
      if (!(jobs?.pending(ringOwner) ?? false) && patchCover !== covered) {
        // The first cover the rings are built for cannot wait; one that changes after that is the scheduler's.
        if (jobs !== undefined && covered !== null) {
          beginRings(camX, camZ);
        } else {
          // Nothing is prepared ahead beside a build the loader steps: the build aims it again as it ends.
          jobs?.idle(ringOwner, null);
          buildAtOnce(firstBuilds, ringOwner, build(camX, camZ, false, true), "clipmap", jobs);
        }
        return;
      }
      aimRings(camX, camZ, false);
      return;
    }
    // A new place: a build the loader still holds for the last one is dropped.
    firstBuilds?.cancel(ringOwner);
    if (kind === "later") {
      beginRings(camX, camZ);
      return;
    }
    jobs?.cancel(ringOwner);
    // At once, or stepped by the loader while the film covers the hike.
    buildAtOnce(firstBuilds, ringOwner, build(camX, camZ, false, true), "clipmap", jobs);
  }

  return {
    firstBuild,
    update(camX, camZ) {
      if (disposed) return;
      // The patches go first: the rings leave out the ground they draw over now.
      updatePatches(camX, camZ);
      updateRings(camX, camZ);
    },
    meshCount() {
      return (live > 0 ? 1 : 0) + shown.filter((at) => at >= 0).length;
    },
    patchCount() {
      return live;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      firstBuilds?.cancel(patchOwner);
      firstBuilds?.cancel(ringOwner);
      jobs?.cancel(patchOwner);
      jobs?.cancel(ringOwner);
      jobs?.idle(patchOwner, null);
      jobs?.idle(ringOwner, null);
      // The worker stops, and its client, the session's, holds nothing of these meshes: a renderer made next asks anew.
      patchWork?.clear();
      // And the rings' worker forgets their samples; its client is the session's too.
      ringWork?.stop();
      for (const entry of cells.values()) dropPatch(entry);
      for (const entry of ready.values()) discardPatch(entry);
      cells.clear();
      ready.clear();
      patchCover = null;
      if (patchMesh !== null) {
        cover?.remove(patchMesh);
        reflections?.remove(patchMesh);
        removeFromScene(scene, patchMesh);
        disposeMeshGpu(patchMesh);
        uploads?.dropped();
        patchMesh = null;
      }
      for (const pair of twins) {
        for (const one of pair) {
          if (one.mesh === null) continue;
          cover?.remove(one.mesh);
          reflections?.remove(one.mesh);
          if (one.inScene) removeFromScene(scene, one.mesh);
          disposeMeshGpu(one.mesh);
          one.mesh = null;
        }
      }
    },
  };
}
