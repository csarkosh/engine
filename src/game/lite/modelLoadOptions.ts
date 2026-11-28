/**
 * What a model's textures are loaded with, by tier: the one place the tier's cap reaches the loader.
 *
 * A model's maps are KTX2 files that carry every mip level, so a tier that draws a smaller frame does
 * not need the top ones (`QUALITY[tier].textureMipCap`: the loader starts from the first stored level
 * that fits, and rescales nothing). Every model of every tier is loaded sharing its textures: an image
 * that is the same bytes in two files (the lamps, tyres and underbodies of the parked vehicles, the
 * crowns of two conifers) is one GPU texture, held by each model that reads it and destroyed with the last.
 *
 * Pass the result as `loadModel`'s and `loadSkinnedModel`'s `textures`. A game that loads a model through
 * Lite's `loadGltf` itself passes it there.
 */
import type { LoadGltfOptions } from "@babylonjs/lite";
import { QUALITY, type QualityTier } from "../quality.js";

export function modelTextureOptions(tier: QualityTier): LoadGltfOptions {
  return { maxTextureSize: QUALITY[tier].textureMipCap, shareTextures: true };
}
