/**
 * A skinned model on Babylon Lite, drawn as many bodies in one draw a
 * primitive: the model's clips baked once into a table of bone matrices,
 * and each body an instance with its own matrix and its own place in a
 * clip (`skinInstances.ts` has the arithmetic).
 *
 * Lite skins a mesh from a texture of bone matrices it writes again every
 * frame a pose moves, one texture a mesh, so five hikers were ten such
 * writes a frame and a herd one a head. Baked, the clips are a table read
 * by row (Lite's baked vertex animation), a body costs no write while it
 * plays on, and every body of a model is one draw a primitive.
 *
 * **One clock for every model** (`createSkinClock`): Lite gives each baked
 * mesh a small buffer of its own for the clock its rows are read by. Every
 * mesh here is handed the same one instead, so a frame in which anything
 * skinned is shown writes four bytes once, and a frame in which nothing is
 * writes none.
 *
 * **A model's primitives share their bodies' clips**: one table of them,
 * sent once a change whatever the primitives. Their matrices are one array
 * here and a buffer a primitive on the GPU, sent once each when a body
 * moves: Lite keeps a mesh's draw arguments with its instances, so two
 * meshes of different geometry cannot share them.
 *
 * **A primitive with bodies of its own** (`own`): a model's primitives draw the same bodies, so one that only some of them wear (a head among
 * several heads, a hat, a thing in the hand) would be drawn for every body, as nothing for most, and its vertices worked for each. Its owner can
 * ask for it to have bodies of its own instead (`SkinnedModelOptions.own`): matrices, clips and a count that are its alone (`SkinnedPart.own`),
 * read from the model's one table. It is then drawn for the bodies that wear it and no others; its owner writes each wearer's matrix and clips
 * into it and shows it, as the model's own are written and shown.
 *
 * **A clip table in fewer texels** (`clipLayout`): a bone's matrix is four texels of the table by default. A model whose bones are
 * only a turn, a move and one size can have two (`"rigid"`), and any model three (`"rows"`: the matrix's first three rows, exact, since
 * its fourth is 0,0,0,1). The shader rebuilds the same matrix where it reads a bone, so a table of two or three texels a bone is half or
 * three quarters of the memory and draws what the whole one does, to within what a model's matrices differ from a rigid one by (the
 * game measures that for each model before it chooses `"rigid"`). Unset, the table is today's.
 *
 * The loader's own materials are kept, each dressed by its owner
 * (`dress`); its textures are claimed, since the loader leaves them
 * unowned. A model stands in the scene from when it lands, hidden while it
 * has no body to draw; a primitive that only a pass of its owner's draws
 * (`elsewhere`) stays hidden whatever the bodies.
 */
import {
  acquireTexture, addToScene, attachVat, bakeVatMany, disposeMeshGpu, getContainerMeshes, getGpuDevice, loadGltf, releaseTexture, removeFromScene, setMeshVisible,
  setThinInstanceCount, setThinInstances,
  type AssetContainer, type EngineContext, type Mesh, type PbrMaterialProps, type SceneContext, type SceneNode, type Texture2D, type VatHandle,
  type LoadGltfOptions, type VatLayout, type VatTableOptions,
} from "@babylonjs/lite";
import { glbEmissive } from "../glbParts.js";
import { CLIP_FLOATS, SKIN_CLOCK_FOLD, type BakedClip } from "../skinInstances.js";
import type { FrameUploads } from "./frameUploads.js";
import { fetchRetried } from "../fetchRetry.js";
import { modelLoadTold } from "../loadReport.js";
import { MATRIX_BYTES } from "./listMeshes.js";

/** The clock every baked mesh's rows are read by, seconds, folded. */
export type SkinClock = {
  /** The clock now, seconds: under `SKIN_CLOCK_FOLD`. */
  readonly seconds: number;
  /** How many times the clock has started again: a body's clips are written again for each. */
  readonly folds: number;
  /** Runs the clock on by `dt`. Nothing is sent: `send` does, on a frame that shows a body. */
  step(dt: number): void;
  /** Sends the clock where it has moved since it was last sent: four bytes. */
  send(uploads?: FrameUploads): void;
  /** Hands `mesh` (a baked one) this clock in place of its own. */
  adopt(mesh: Mesh): void;
  dispose(): void;
};

/** WebGPU's buffer usages for a uniform buffer written from the page (`GPUBufferUsage`), by their values. */
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;

/** Bytes of a baked mesh's settings: its clip's four floats, which an instanced mesh does not read, and the clock's four. */
const SETTINGS_BYTES = 32;
/** Where the clock stands in them. */
const CLOCK_OFFSET = 16;

type BakedMesh = { vat?: { settingsBuffer: GPUBuffer; instanceTexture?: GPUTexture | null } | null };

export function createSkinClock(engine: EngineContext): SkinClock {
  const device = getGpuDevice(engine);
  const buffer = device.createBuffer({ label: "skin clock", size: SETTINGS_BYTES, usage: UNIFORM | COPY_DST });
  const value = new Float32Array(1);
  let seconds = 0;
  let folds = 0;
  let sent = Number.NaN;
  return {
    get seconds() {
      return seconds;
    },
    get folds() {
      return folds;
    },
    step(dt) {
      seconds += dt;
      if (seconds >= SKIN_CLOCK_FOLD) {
        seconds -= SKIN_CLOCK_FOLD;
        folds++;
      }
    },
    send(uploads) {
      if (seconds === sent) return;
      sent = seconds;
      value[0] = seconds;
      device.queue.writeBuffer(buffer, CLOCK_OFFSET, value);
      uploads?.count("uniforms", value.byteLength);
    },
    adopt(mesh) {
      const vat = (mesh as unknown as BakedMesh).vat;
      if (vat === undefined || vat === null) throw new Error(`${mesh.name} is not a baked mesh: it has no clock to hand over`);
      const own = vat.settingsBuffer;
      vat.settingsBuffer = buffer;
      own.destroy();
    },
    dispose() {
      buffer.destroy();
    },
  };
}

/** A primitive's own bodies: what a model has for all its primitives, for one of them alone. */
export type PartBodies = {
  /** A matrix a body, sixteen floats each: written in place, then shown. */
  readonly matrices: Float32Array;
  /** A body's clips, `CLIP_FLOATS` each: written in place (`writeClipParams`), then shown. */
  readonly clipParams: Float32Array;
  /** Bodies drawn. */
  readonly count: number;
  /** Draws the primitive's first `count` bodies: `moved` and `reclipped` as a model's `show` takes them. A primitive shown no body is hidden. */
  show(count: number, moved: boolean, reclipped: boolean): void;
};

/** Which of a model's primitives is the first that draws the model's bodies (it holds the clips the others read), given which have bodies of their own; -1 where all have. */
export function sharedFirst(owns: readonly boolean[]): number {
  return owns.indexOf(false);
}

/** One primitive of a model: the loader's mesh and its material. */
export type SkinnedPart = {
  readonly mesh: Mesh;
  readonly material: PbrMaterialProps;
  /** The material's name in the file. */
  readonly name: string;
  /** What the file says the material gives off: its emissive factor, which the loader keeps to itself. */
  readonly emissive: readonly [number, number, number];
  /** Whether the primitive is drawn at all: its owner's to say (`dress`). One that is not stays hidden. */
  drawn: boolean;
  /**
   * Whether a pass of its owner's alone draws the primitive (`dress` sets it): it is given its bodies as the others
   * are, and stays hidden, which leaves it out of every pass but one that shows it by its own word.
   */
  elsewhere: boolean;
  /** The primitive's own bodies, where its owner asked for them (`SkinnedModelOptions.own`): the loader sets it. Null for a primitive that draws the model's bodies. */
  own: PartBodies | null;
};

export type SkinnedModel = {
  readonly parts: readonly SkinnedPart[];
  /** Where each of the file's clips landed in the table, by the clip's name. */
  readonly clips: ReadonlyMap<string, BakedClip>;
  /** The most bodies drawn at once. */
  readonly capacity: number;
  /** A matrix a body, sixteen floats each: written in place, then shown. */
  readonly matrices: Float32Array;
  /** A body's clips, `CLIP_FLOATS` each: written in place (`writeClipParams`), then shown. */
  readonly clipParams: Float32Array;
  /** Bodies drawn. */
  readonly count: number;
  /**
   * Draws the first `count` bodies. `moved`: a matrix among them has changed,
   * or the count has; `reclipped`: a body's clips have. The clips are sent
   * once whatever the primitives, the matrices once a primitive drawn, and a
   * model shown no body is hidden. A primitive with bodies of its own
   * (`SkinnedPart.own`) is not this's to draw: it is shown by its own `show`.
   */
  show(count: number, moved: boolean, reclipped: boolean): void;
  dispose(): void;
};

export type SkinnedModelOptions = {
  /** The most bodies drawn at once. */
  capacity: number;
  clock: SkinClock;
  signal: AbortSignal;
  /** Dresses a primitive's material and places it among the draws, before it joins the scene; false for one that is not drawn. */
  dress(part: SkinnedPart, index: number): boolean;
  /**
   * Whether a primitive has bodies of its own (`SkinnedPart.own`), asked once for each after `dress`: true for one that only some of the
   * model's bodies wear. Unset, every primitive draws the model's bodies, as it always has.
   */
  own?(part: SkinnedPart, index: number): boolean;
  uploads?: FrameUploads;
  /**
   * How the model's clip table holds a bone: `"rigid"` (two texels; for a model whose bones are a turn, a move and one size),
   * `"rows"` (three, exact) or `"matrix"` (four). Unset is the table as it has always been.
   */
  clipLayout?: VatLayout;
  /**
   * How the model's maps are loaded (`modelTextureOptions`). A map shared with another model is a texture each holds and
   * lets go of with its own model: this one holds each of its own and releases each once, as it did unshared. Unset, as it was.
   */
  textures?: LoadGltfOptions;
};

/** What the bake is told of the table: nothing where the layout is unset, so the bake is the one it has always been. */
export function tableOptions(layout: VatLayout | undefined): VatTableOptions | undefined {
  return layout === undefined ? undefined : { layout };
}

/** The textures a loader's material reads. */
function texturesOf(material: PbrMaterialProps): Texture2D[] {
  return [material.baseColorTexture, material.normalTexture, material.ormTexture, material.emissiveTexture, material.occlusionTexture].filter(
    (texture): texture is Texture2D => texture !== undefined,
  );
}

/**
 * The model at `url`, standing in `scene` with no body shown. It throws
 * where the file cannot be fetched or read, or holds no skinned mesh or no
 * clip. The loading bar is told of the download as it starts, as its bytes
 * are in and as the model stands or fails (`modelLoadTold`).
 */
export function loadSkinnedModel(engine: EngineContext, scene: SceneContext, url: string, options: SkinnedModelOptions): Promise<SkinnedModel> {
  return modelLoadTold(url, options.signal, (fetched) => makeSkinnedModel(engine, scene, url, options, fetched));
}

async function makeSkinnedModel(
  engine: EngineContext, scene: SceneContext, url: string, options: SkinnedModelOptions, fetched: (bytes: number) => void,
): Promise<SkinnedModel> {
  const file = await fetchRetried(url, options.signal, (response) => response.arrayBuffer());
  fetched(file.byteLength);
  const emissive = glbEmissive(file);
  const container: AssetContainer = await loadGltf(engine, file, options.textures);
  const meshes = getContainerMeshes(container);
  const groups = container.animationGroups ?? [];
  // The clips are baked, not played: the scene's own mixer never hears of them.
  container.animationGroups = undefined;
  if (meshes.length === 0 || groups.length === 0 || meshes.some((mesh) => mesh.skeleton === undefined || mesh.skeleton === null)) {
    for (const mesh of meshes) disposeMeshGpu(mesh);
    throw new Error(`${url}: ${meshes.length} meshes and ${groups.length} clips, where a skinned model has both`);
  }
  const baked = bakeVatMany(engine, meshes.map((mesh) => ({ mesh })), groups, tableOptions(options.clipLayout));
  const clips = new Map<string, BakedClip>();
  for (const [name, clip] of Object.entries(baked[0]?.clips ?? {})) {
    const group = groups.find((candidate) => candidate.name === name);
    clips.set(name, { fromRow: clip.fromRow, frames: clip.frameCount, fps: clip.fps, seconds: group?.duration ?? (clip.frameCount - 1) / clip.fps });
  }

  const capacity = options.capacity;
  const matrices = new Float32Array(capacity * 16);
  for (let i = 0; i < capacity; i++) matrices[i * 16] = matrices[i * 16 + 5] = matrices[i * 16 + 10] = matrices[i * 16 + 15] = 1;
  const clipParams = new Float32Array(capacity * CLIP_FLOATS);
  const held = new Set<Texture2D>();
  const parts: SkinnedPart[] = [];
  // The first primitive that draws the model's bodies: the others like it read its clips.
  const shared: { mesh: Mesh | null; handle: VatHandle | null } = { mesh: null, handle: null };
  let disposed = false;
  /** Bodies of its own for a primitive: its matrices, its clips (a texture of its own, which Lite makes for it) and its count. */
  const ownBodies = (mesh: Mesh, handle: VatHandle, part: SkinnedPart): PartBodies => {
    const own = new Float32Array(capacity * 16);
    for (let i = 0; i < capacity; i++) own[i * 16] = own[i * 16 + 5] = own[i * 16 + 10] = own[i * 16 + 15] = 1;
    const clipsOwn = new Float32Array(capacity * CLIP_FLOATS);
    setThinInstances(mesh, own, capacity);
    setThinInstanceCount(mesh, 0);
    handle.setInstancesBlend(clipsOwn);
    let shown = 0;
    return {
      matrices: own,
      clipParams: clipsOwn,
      get count() {
        return shown;
      },
      show(next, moved, reclipped) {
        if (disposed) return;
        if (next > capacity) throw new Error(`${url}: ${next} bodies of ${part.name}, where the model was made for ${capacity}`);
        if (reclipped && next > 0) {
          handle.setInstancesBlend(clipsOwn);
          options.uploads?.count("textures", next * CLIP_FLOATS * 4);
        }
        if ((moved || next !== shown) && part.drawn) {
          setThinInstanceCount(mesh, next);
          if (next > 0) options.uploads?.count("instances", next * MATRIX_BYTES);
        }
        if ((next > 0) !== (shown > 0) && part.drawn && !part.elsewhere) setMeshVisible(mesh, next > 0);
        shown = next;
      },
    };
  };
  meshes.forEach((mesh, index) => {
    const handle = attachVat(engine, mesh, baked[index] as (typeof baked)[number]);
    options.clock.adopt(mesh);
    const material = mesh.material as PbrMaterialProps;
    for (const texture of texturesOf(material)) {
      if (held.has(texture)) continue;
      held.add(texture);
      acquireTexture(texture);
    }
    const name = (material as { name?: string }).name ?? "";
    const part: SkinnedPart = { mesh, material, name, emissive: emissive.get(name) ?? [0, 0, 0], drawn: true, elsewhere: false, own: null };
    part.drawn = options.dress(part, index);
    parts.push(part);
    if (options.own?.(part, index) === true) {
      // Bodies of its own: nothing of the model's matrices or of the first primitive's clips.
      part.own = ownBodies(mesh, handle, part);
      setMeshVisible(mesh, false);
      return;
    }
    // Every other primitive draws the same bodies, from the same array of matrices, and reads the first such one's clips.
    setThinInstances(mesh, matrices, capacity);
    setThinInstanceCount(mesh, 0);
    handle.setInstancesBlend(clipParams);
    if (shared.mesh === null) {
      shared.mesh = mesh;
      shared.handle = handle;
    } else {
      const own = (mesh as unknown as BakedMesh).vat;
      const first = (shared.mesh as unknown as BakedMesh).vat;
      if (own !== undefined && own !== null && first !== undefined && first !== null) {
        own.instanceTexture?.destroy();
        own.instanceTexture = first.instanceTexture;
      }
    }
    setMeshVisible(mesh, false);
  });
  const roots = container.entities as SceneNode[];
  for (const root of roots) addToScene(scene, root);
  options.uploads?.made(meshes.length);

  let count = 0;
  return {
    parts,
    clips,
    capacity,
    matrices,
    clipParams,
    get count() {
      return count;
    },
    show(next, moved, reclipped) {
      if (disposed) return;
      if (next > capacity) throw new Error(`${url}: ${next} bodies, where the model was made for ${capacity}`);
      if (reclipped && next > 0 && shared.handle !== null) {
        shared.handle.setInstancesBlend(clipParams);
        options.uploads?.count("textures", clipParams.byteLength);
      }
      if (moved || next !== count) {
        for (const part of parts) {
          if (!part.drawn || part.own !== null) continue;
          setThinInstanceCount(part.mesh, next);
          if (next > 0) options.uploads?.count("instances", next * MATRIX_BYTES);
        }
      }
      if ((next > 0) !== (count > 0)) for (const part of parts) if (part.drawn && !part.elsewhere && part.own === null) setMeshVisible(part.mesh, next > 0);
      count = next;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const root of roots) removeFromScene(scene, root);
      for (const mesh of meshes) disposeMeshGpu(mesh);
      for (const texture of held) releaseTexture(texture);
      options.uploads?.dropped(meshes.length);
    },
  };
}
