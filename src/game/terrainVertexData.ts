/**
 * What a terrain mesh carries a vertex in the plugin vertex buffer, and the interleave that writes it
 * (`terrainVertices.ts` has the arrays it reads). It loads nothing of the renderer, so a worker can make a
 * ring's plugin vertex data as the page does; `lite/terrainPlugins.ts` re-exports it.
 */
import { finish, sliceDue, type Slices } from "./syncJobs.js";
import { TERRAIN_ATTRIBUTES, TERRAIN_VERTEX_SIZES, type TerrainVertices } from "./terrainVertices.js";

/**
 * A terrain vertex's own data in the mesh's plugin vertex buffer: the two
 * weight sets, the cover and the vertex colour, by the name the vertex stage
 * reads each under, with the varying it is handed on as, how many floats it
 * is and the float it starts at.
 */
export const TERRAIN_VERTEX_LAYOUT = (() => {
  const parts = [
    { name: TERRAIN_ATTRIBUTES.weights, floats: TERRAIN_VERTEX_SIZES.weights, varying: "vTerrainW" },
    { name: TERRAIN_ATTRIBUTES.weights2, floats: TERRAIN_VERTEX_SIZES.weights2, varying: "vTerrainW2" },
    { name: TERRAIN_ATTRIBUTES.cover, floats: TERRAIN_VERTEX_SIZES.cover, varying: "vTerrainCover" },
    { name: "terrainColor", floats: TERRAIN_VERTEX_SIZES.colors, varying: "vTerrainColor" },
  ];
  let offset = 0;
  return parts.map((part) => {
    const at = offset;
    offset += part.floats;
    return { ...part, offset: at };
  });
})();

/** Floats a vertex in the plugin vertex buffer. */
export const TERRAIN_VERTEX_FLOATS = TERRAIN_VERTEX_LAYOUT.reduce((sum, part) => sum + part.floats, 0);

/**
 * A terrain mesh's plugin vertex data: `vertices`' weights, cover and colours
 * interleaved a vertex (`TERRAIN_VERTEX_LAYOUT`). Fills and returns `out`
 * where it is the right length, so a ring written again makes nothing; else
 * an array of its own.
 */
export function terrainVertexData(vertices: TerrainVertices, out?: Float32Array | null): Float32Array {
  return finish(terrainVertexDataSlices(vertices, out));
}

/** Vertices copied between two looks at the scheduler's clock (`sliceDue`): a few thousand floats. */
const COPY_BLOCK = 2048;

/** `terrainVertexData` in slices, each ended by the scheduler's clock between two blocks of vertices. */
export function* terrainVertexDataSlices(vertices: TerrainVertices, out?: Float32Array | null): Slices<Float32Array> {
  const count = vertices.positions.length / TERRAIN_VERTEX_SIZES.positions;
  const length = count * TERRAIN_VERTEX_FLOATS;
  const data = out !== undefined && out !== null && out.length === length ? out : new Float32Array(length);
  const sources = [vertices.weights, vertices.weights2, vertices.cover, vertices.colors];
  for (let p = 0; p < TERRAIN_VERTEX_LAYOUT.length; p++) {
    const part = TERRAIN_VERTEX_LAYOUT[p] as (typeof TERRAIN_VERTEX_LAYOUT)[number];
    const source = sources[p] as Float32Array;
    for (let i = 0; i < count; i++) {
      const from = i * part.floats;
      const to = i * TERRAIN_VERTEX_FLOATS + part.offset;
      for (let k = 0; k < part.floats; k++) data[to + k] = source[from + k] as number;
      if (i % COPY_BLOCK === COPY_BLOCK - 1 && sliceDue(COPY_UNITS)) yield;
    }
  }
  return data;
}

/** The units of work (`sliceDue`) a block of `COPY_BLOCK` vertices' copy counts: about as long as eight terrain samples. */
const COPY_UNITS = 8;
