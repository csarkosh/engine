/**
 * The beach on Babylon Lite: the wrack's heaps of kelp, the cobbles, the small driftwood and the dune grass
 * (`sim/beach.ts` places them; `beachField.ts` says which are near; `beachInstances.ts` seats them). Made only
 * where the active terrain has a beach, by the ground clutter's shell (`clutterMeshes.ts`), which hands it the
 * loader it loads its own models with, so that a file the clutter draws is read and uploaded once.
 *
 * **Six draws, one a bucket**: the kelp's tangled heap and its single strand (both built in code, `kelpHeap.ts`), the clutter's two rounded rocks as the
 * cobbles, its driftwood, and its second grass tuft as the dune grass, each at its LOD1 and nothing else: a piece
 * this small is seen at a few paces, and a second level would be a draw more. Each bucket is one mesh drawn as thin
 * instances (`listMeshes.ts`) and every piece dithers out toward its kind's radius by its own edge (`rampBands`), so
 * the beach thins across its last metres and no line stands anywhere. Nothing sways: the tufts are still.
 *
 * **Materials.** Lite's PBR with the wet look and the air, as the clutter's, and the vegetation's dither for the
 * fade alone. The tufts' colour is the model's, gained toward a straw (`DUNE_GRASS_GAIN`): the beach's grass is
 * paler and coarser than the field's. The heaps are white under their vertex colours, lit on both sides.
 *
 * **The lists follow the eye.** They are made again when it crosses a 4 m cell, as a job of the renderer's
 * scheduler (`rebuildJobs.ts`) whose last slice shows every bucket at once.
 */
import {
  createMeshFromData, createPbrMaterial, disposeMeshGpu, removeFromScene, setPbrAlphaCutoff, setPbrMetallicReflectance,
  type EngineContext, type Mesh, type MaterialPlugin, type PbrMaterialProps, type PluginUniformBlock, type SceneContext,
} from "@babylonjs/lite";
import { BEACH_CELL, BEACH_DRIFT, BEACH_GRASS, BEACH_KELP, BEACH_KIND_COUNT, BEACH_STONE, BEACH_VARIANTS, type BeachInstance } from "../../sim/beach.js";
import { BEACH_LOD, BEACH_MODEL_IDS, beachMatrix } from "../beachInstances.js";
import { beachFadeEdges, createBeachCollector, type BeachBands } from "../beachField.js";
import { rampBands } from "../clutterField.js";
import { fadeBands, writeFadeBands, type FadeBands } from "../distanceFade.js";
import type { FirstBuilds } from "../firstBuilds.js";
import { kelpHeapGeometry, kelpStrandGeometry } from "../kelpHeap.js";
import type { ListBuffers } from "../instanceLists.js";
import { sliceDue, type Slices, type SyncJobs } from "../syncJobs.js";
import { WET_CAP } from "../wetSurface.js";
import type { WetUniforms } from "../wetSurface.js";
import type { LoadedModel, ModelPart } from "./forestModels.js";
import { baseColourPlugin, oneSidedLightPlugin, surfaceWetPlugin, vegetationInstanceLayout, vegetationPlugin, type Vegetation } from "./forestPlugins.js";
import { DRAW_ORDER, createDrawOrders } from "./drawOrder.js";
import type { FrameUploads } from "./frameUploads.js";
import { listBytes, listMesh, showList, type ListMesh } from "./listMeshes.js";
import { cellOrigin, createRebuilds } from "./rebuildJobs.js";

/** The dune grass's gain on the tuft model's own colour (linear, a channel each): toward a dry straw, and paler. */
export const DUNE_GRASS_GAIN: readonly [number, number, number] = [1.7, 1.55, 1.05];
/** The heaps' roughness, and their reflectance at normal incidence as a share of a dielectric's (the shrubs': a wet leaf mirrors the sky otherwise). */
const KELP_ROUGHNESS = 0.85;
const KELP_F0 = 0.12;
/** What showing the lists is expected to take (ms), as the clutter's. */
const UPLOAD_MS = 1;
/** Instances' worth of work a slice of the fill does before it yields. */
const FILL_SLICE = 2048;

export type BeachMeshOptions = {
  /** The tier's reach (`clutterReachFor`): every kind's radius is scaled by it. */
  reach: number;
  /** The low tier: half the density. */
  low: boolean;
  eye: { readonly x: number; readonly y: number; readonly z: number };
  frame: { readonly height: number };
  wet: (cap: number) => WetUniforms;
  air: () => MaterialPlugin;
  shared: PluginUniformBlock;
  /** The clutter's loader of models: one read of a file however many shells draw it. */
  model: (id: string, lods: readonly string[]) => Promise<LoadedModel>;
  jobs?: SyncJobs;
  firstBuilds?: FirstBuilds;
  uploads?: FrameUploads;
};

export type BeachMeshes = {
  /** Follows the eye: the lists are made again when it crosses a 4 m cell. */
  update(camX: number, camZ: number): void;
  /** What is drawn now: the buckets' meshes with an instance, and their instances. */
  drawn(): { meshes: number; instances: number };
  dispose(): void;
};

/** One mesh's geometry: a model's primitive or the heap. */
type Geometry = { positions: Float32Array; normals: Float32Array; indices: Uint32Array | Uint16Array; uvs?: Float32Array; tangents?: Float32Array; colors?: Float32Array };

/** A bucket: a kind's variant, its meshes, the list they are shown from, and the one being filled. */
type Bucket = {
  kind: number;
  variant: number;
  targets: ListMesh[];
  live: ListBuffers;
  count: number;
  staged: { buf: Float32Array; bands: Float32Array; count: number };
};

const EMPTY = new Float32Array(0);

function geometryOf(part: ModelPart): Geometry {
  const mapped = part.colour !== undefined || part.normal !== undefined;
  return {
    positions: part.positions, normals: part.normals, indices: part.indices,
    ...(mapped ? { uvs: part.uvs } : {}),
    ...(mapped && part.tangents !== null ? { tangents: part.tangents } : {}),
  };
}

/** The beach for a world, once its models have landed. It resolves to the meshes, which draw nothing until the eye is known. */
export async function createBeachMeshes(engine: EngineContext, scene: SceneContext, seed: number, options: BeachMeshOptions): Promise<BeachMeshes> {
  const { reach, low } = options;
  const meshes: Mesh[] = [];
  const materials: PbrMaterialProps[] = [];
  const orders = createDrawOrders(DRAW_ORDER.beach);
  const collector = createBeachCollector(seed);
  let disposed = false;

  const vegetation: Vegetation = {
    eye: options.eye, frame: options.frame, shared: options.shared, foliage: null, match: false, light: false, fade: true,
    conform: false, moss: null, deadwood: null, sky: true,
  };
  const layout = vegetationInstanceLayout(vegetation);
  const fades: FadeBands[] = Array.from({ length: BEACH_KIND_COUNT }, (_, kind) => {
    const edge = beachFadeEdges(kind, reach);
    return fadeBands(null, [edge.start, edge.end]);
  });

  function material(props: Partial<PbrMaterialProps>, f0: number, cap: number, more: MaterialPlugin[] = []): PbrMaterialProps {
    const made = createPbrMaterial({ metallicFactor: 0, usePhysicalLightFalloff: true, ...props });
    setPbrMetallicReflectance(made, { color: [1, 1, 1], f0Factor: f0 });
    made.plugins = [baseColourPlugin(), ...more, vegetationPlugin(vegetation), surfaceWetPlugin(options.wet(cap), options.shared), options.air()];
    materials.push(made);
    orders.take(made);
    return made;
  }

  // Every file is asked for at once, from the clutter's own loader (its LOD names, so its copy is the one read).
  const lods = ["LOD0", "LOD1"];
  const files = BEACH_MODEL_IDS.map((ids) => ids.map((id) => options.model(id, lods)));
  const loaded = await Promise.all(files.map((of) => Promise.all(of)));

  const buckets: Bucket[][] = [];
  for (let kind = 0; kind < BEACH_KIND_COUNT; kind++) {
    const row: Bucket[] = [];
    for (let variant = 0; variant < (BEACH_VARIANTS[kind] as number); variant++) {
      let made: PbrMaterialProps;
      let parts: Geometry[];
      if (kind === BEACH_KELP) {
        made = material({ baseColorFactor: [1, 1, 1, 1], roughnessFactor: KELP_ROUGHNESS, doubleSided: true }, KELP_F0, WET_CAP.leaf, [oneSidedLightPlugin()]);
        parts = [variant === 0 ? kelpHeapGeometry() : kelpStrandGeometry()];
      } else {
        const file = (loaded[kind] as LoadedModel[])[variant] as LoadedModel;
        const lod = file.get(BEACH_LOD) ?? [];
        const first = lod[0];
        if (first === undefined) throw new Error(`${BEACH_MODEL_IDS[kind]?.[variant]}: no ${BEACH_LOD} in the model`);
        const gain = kind === BEACH_GRASS ? DUNE_GRASS_GAIN : ([1, 1, 1] as const);
        const colour: [number, number, number, number] = [first.factor[0] * gain[0], first.factor[1] * gain[1], first.factor[2] * gain[2], 1];
        const cap = kind === BEACH_STONE ? WET_CAP.rock : kind === BEACH_DRIFT ? WET_CAP.deadwood : WET_CAP.leaf;
        made = material(
          {
            baseColorFactor: colour, roughnessFactor: 1, doubleSided: first.facts.doubleSided,
            ...(first.colour === undefined ? {} : { baseColorTexture: first.colour }),
            ...(first.normal === undefined ? {} : { normalTexture: first.normal }),
          },
          first.facts.specularWeight ?? 1, cap,
        );
        if (first.facts.alphaMask) setPbrAlphaCutoff(made, first.facts.alphaCutoff);
        parts = lod.map(geometryOf);
      }
      const targets = parts.map((g, p) => {
        const mesh = createMeshFromData(
          engine, `beach_${kind}_${variant}_${p}`, g.positions.slice(), g.normals.slice(), Uint32Array.from(g.indices), g.uvs?.slice(), undefined, g.tangents?.slice(), g.colors?.slice(),
        );
        mesh.material = made;
        mesh.renderOrder = orders.of(made);
        meshes.push(mesh);
        return listMesh(scene, mesh, layout);
      });
      row.push({
        kind, variant, targets, live: { buf: EMPTY, bands: EMPTY, foliage: EMPTY, strength: EMPTY }, count: 0,
        staged: { buf: EMPTY, bands: EMPTY, count: 0 },
      });
    }
    buckets.push(row);
  }
  const all = buckets.flat();
  /** Where each kind's buckets begin in `all`. */
  const first = buckets.map((_, kind) => buckets.slice(0, kind).reduce((n, row) => n + row.length, 0));
  const scratch = new Float32Array(16);

  /** Room for `n` instances in a bucket's staging arrays, doubling. */
  function stage(bucket: Bucket, n: number): void {
    if (bucket.staged.buf.length >= n * 16) return;
    let capacity = Math.max(64, bucket.staged.buf.length / 16);
    while (capacity < n) capacity *= 2;
    bucket.staged = { buf: new Float32Array(capacity * 16), bands: new Float32Array(capacity * 4), count: 0 };
  }

  function* rebuild(x: number, z: number): Slices {
    const found: BeachBands = yield* collector.collectSlices(x, z, reach, low);
    yield;
    const counts = all.map(() => 0);
    const bucketOf = (inst: BeachInstance): number => (first[inst.kind] as number) + Math.min(inst.variant, (BEACH_VARIANTS[inst.kind] as number) - 1);
    for (const list of found) for (const inst of list) counts[bucketOf(inst)]!++;
    all.forEach((bucket, i) => {
      stage(bucket, counts[i] as number);
      bucket.staged.count = 0;
    });
    let work = 0;
    for (const list of found) {
      for (const inst of list) {
        const bucket = all[bucketOf(inst)] as Bucket;
        const i = bucket.staged.count++;
        beachMatrix(inst, scratch);
        bucket.staged.buf.set(scratch, i * 16);
        writeFadeBands(bucket.staged.bands, i * 4, rampBands(fades[inst.kind] as FadeBands, inst.hash));
        if (++work >= FILL_SLICE || sliceDue(1 / 64)) {
          work = 0;
          yield;
        }
      }
    }
    yield UPLOAD_MS;
    if (options.uploads !== undefined) {
      let sending = 0;
      for (const bucket of all) for (const target of bucket.targets) sending += listBytes(bucket.staged.count, target.layout.floats);
      yield* options.uploads.hold(sending);
    }
    if (disposed) return;
    for (const bucket of all) {
      const n = bucket.staged.count;
      if (bucket.live.buf.length < n * 16) {
        let capacity = Math.max(64, bucket.live.buf.length / 16);
        while (capacity < n) capacity *= 2;
        bucket.live = { buf: new Float32Array(capacity * 16), bands: new Float32Array(capacity * 4), foliage: EMPTY, strength: EMPTY };
      }
      bucket.live.buf.set(bucket.staged.buf.subarray(0, n * 16));
      bucket.live.bands.set(bucket.staged.bands.subarray(0, n * 4));
      bucket.count = n;
      for (const target of bucket.targets) showList(target, bucket.live, n, options.uploads);
    }
  }
  const rebuilds = createRebuilds({
    name: "beach", cell: BEACH_CELL, origin: cellOrigin(BEACH_CELL), rebuild, jobs: options.jobs, firstBuilds: options.firstBuilds,
  });

  return {
    update(x, z) {
      if (disposed) return;
      rebuilds.update(x, z);
    },
    drawn() {
      let shown = 0;
      let instances = 0;
      for (const bucket of all) {
        for (const target of bucket.targets) {
          if (target.count === 0) continue;
          shown++;
          instances += target.count;
        }
      }
      return { meshes: shown, instances };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rebuilds.dispose();
      for (const mesh of meshes) {
        removeFromScene(scene, mesh);
        disposeMeshGpu(mesh);
      }
      meshes.length = 0;
      materials.length = 0;
    },
  };
}
