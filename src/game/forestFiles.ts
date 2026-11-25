/**
 * The forest's own files by name, and those a session with a forest reads
 * first.
 *
 * The names are the renderer's (`lite/forestMeshes.ts` adopts the models by
 * them); they stand here, apart from it, so the page can name them before a
 * renderer is loaded. `forestFilesAhead` is the list a game with a forest
 * hands the page to ask for at a session's start (`filesAhead.ts`), in the
 * order the session reads them: the ground's images, which the renderer is
 * made from and the terrain waits for, then the trees', the dead trees' and
 * the nurse fern's models, the first the forest asks for and the largest
 * files a session has. No Babylon is loaded by naming them.
 */
import { modelUrl } from "./assetUrls.js";
import { GROUND_ALBEDOS, GROUND_LAYER_URLS } from "./groundLayers.js";

/** The canopy giants' models by `TreeInstance.species`: the fir, then the pine. */
export const GIANT_MODELS = ["models/tree.giant_fir.glb", "models/tree.giant_pine.glb"];
/** The saplings' models by `TreeInstance.species`: the two conifers, then the alder. */
export const SAPLING_MODELS = ["models/tree.conifer_a.glb", "models/tree.conifer_b.glb", "models/tree.alder.glb"];
/** The dead trees' one model, both roles. */
export const DEADWOOD_MODEL = "models/deadwood.snag.glb";
/** The fern on the nurse logs, by catalog id: the understory's fern, in the cover's green as the floor's own are. */
export const NURSE_FERN_ID = "understory.fern";
export const NURSE_FERN_MODEL = `models/${NURSE_FERN_ID}.glb`;

/**
 * The addresses of the files a session with a forest reads first, in its order. A file the game's catalog does not
 * name is left out, never thrown for: the renderer that reads it says what is missing.
 */
export function forestFilesAhead(): string[] {
  const urls: string[] = [];
  const add = (address: () => string | string[]): void => {
    try {
      urls.push(...[address()].flat());
    } catch {
      // Not in this game's catalog.
    }
  };
  for (const albedo of Object.values(GROUND_ALBEDOS)) add(() => albedo.url);
  add(() => GROUND_LAYER_URLS.normal);
  add(() => GROUND_LAYER_URLS.rah);
  for (const output of [...GIANT_MODELS, ...SAPLING_MODELS, DEADWOOD_MODEL, NURSE_FERN_MODEL]) add(() => modelUrl(output));
  return urls;
}
