/**
 * The finish's line on the tier with no post chain (`GameLook.finish.line`), which has no far softening to draw it in.
 *
 * Only where the look asks for one (`lineOnTier`): the scene's pass then resolves into a target of its own, the
 * canvas's format and the frame's size, instead of into the canvas, and one triangle after it reads that colour and the
 * scene's multisampled depth and writes the canvas, the colour with the line multiplied in (`lineOnly.fragment.wgsl`).
 * A look with no line makes none of this: the scene resolves into the canvas as it always has, with no task, no
 * target, no shader and no pipeline added.
 *
 * The depth is read where the scene's pass left it (`texture_depth_multisampled_2d`, every sample of five pixels), so
 * no depth is resolved and none is made; its distance is made as the chain's depth resolve makes it, from the
 * projection's two depth terms. The colour on this tier is the display's already (the materials grade themselves), and
 * the line is multiplied into it as it is.
 *
 * **The pipeline is asked for off the page's thread** (`pipelineAsk.ts`) when this is made, and its maker waits for
 * `ready` before the scene is registered, so no frame is drawn to the canvas without it. **The scene's targets stand
 * while the frame's size does** (`keep`): the group is made again only when they are not the ones it was made for
 * (`chainTargetsStand`), which is a resize; a recording of the frame's passes that is no resize makes nothing.
 *
 * The task is added straight after the scene's pass by the renderer, before anything else that draws to the canvas.
 */
import { createCustomTask, createRenderTarget, getFrameEncoder, getGpuDevice, getProjectionMatrix, getRenderTargetAttachments, type BankedFreeCamera, type EngineContext, type RenderTarget, type RenderTargetAttachments, type SceneContext, type Task } from "@babylonjs/lite";
import { finishDrawsLine, finishLineBandUniform, finishLineFarUniform, finishLineUniform, type LookFinish } from "../gameLook.js";
import { chainTargetsStand } from "./postChain.js";
import { askRenderPipeline } from "./pipelineAsk.js";
import { POST_VERTEX_WGSL, lineOnlyWgsl, passLayout, writePass } from "./postWgsl.js";

/** WebGPU's usages, by their values. */
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;

/** Whether a tier draws the line itself: it has no chain (whose far softening draws it) and the look asks for one. */
export function lineOnTier(chained: boolean, finish: LookFinish): boolean {
  return !chained && finishDrawsLine(finish);
}

/** The pass's uniforms: the line's colour and strength, where it begins and is full, the projection's two depth terms (`depthTerms`: its elements 10 and 14), and how the line thins with distance. */
export function lineOnlyUniforms(finish: LookFinish, depthTerms: readonly [number, number] = [0, 0]): { finishLine: number[]; finishLineBand: number[]; depthTerms: number[]; finishLineFar: number[] } {
  return { finishLine: finishLineUniform(finish), finishLineBand: finishLineBandUniform(finish), depthTerms: [depthTerms[0], depthTerms[1]], finishLineFar: finishLineFarUniform(finish) };
}

export type LiteLineOnly = {
  /** The target the scene's pass resolves into, in the place of the canvas. */
  readonly resolved: RenderTarget;
  /** The task that draws the line into the canvas: added straight after the scene's own pass. */
  readonly task: Task;
  /** The pipeline is in: wait for it before the scene is registered. */
  readonly ready: Promise<void>;
  dispose(): void;
};

/**
 * The line's pass for a scene whose own pass draws into `samples`. Asks for its pipeline at once; the caller adds the
 * scene's pass (resolving into `resolved`), then `task`.
 */
export function createLiteLineOnly(engine: EngineContext, scene: SceneContext, options: { samples: RenderTarget; sampleCount: number; camera: () => BankedFreeCamera; finish: LookFinish }): LiteLineOnly {
  const { samples, camera, finish } = options;
  const device = getGpuDevice(engine);
  // The scene's resolve: the canvas's format and the frame's size, kept while it stands, as the scene's samples are.
  const resolved = createRenderTarget({ lbl: "scene-resolved", format: engine.format, samples: 1, size: engine, keep: true });
  /** The pass's record, its depth terms written in place each frame: a frame makes no array. */
  const record = lineOnlyUniforms(finish);
  const layout = passLayout(record);
  const data = new Float32Array(layout.bytes / 4);
  const buffer = device.createBuffer({ label: "line only", size: layout.bytes, usage: UNIFORM | COPY_DST });
  let sent = new Float32Array(data.length).fill(Number.NaN);
  const module = device.createShaderModule({ label: "post line only", code: `${layout.struct}\n${POST_VERTEX_WGSL}\n${lineOnlyWgsl(options.sampleCount)}` });
  let pipeline: GPURenderPipeline | null = null;
  const ready: Promise<void> = askRenderPipeline(device, {
    label: "post line only",
    layout: "auto",
    vertex: { module, entryPoint: "postVertex" },
    fragment: { module, entryPoint: "postFragment", targets: [{ format: engine.format }] },
  }).then((made) => {
    pipeline = made;
  });

  const canvasNow = {} as RenderTargetAttachments;
  const resolvedNow = {} as RenderTargetAttachments;
  const samplesNow = {} as RenderTargetAttachments;
  /** The scene's depth and resolve the group was made for. */
  let madeFor: { depth: GPUTexture; resolve: GPUTextureView } | null = null;
  let group: GPUBindGroup | null = null;
  let disposed = false;

  /** The group for the scene's targets as they now stand; nothing where they are the ones it was made for. */
  function build(): void {
    const own = getRenderTargetAttachments(samples, samplesNow);
    const colour = getRenderTargetAttachments(resolved, resolvedNow).colorView;
    if (chainTargetsStand(madeFor, own.depthTexture, colour)) return;
    madeFor = null;
    group = null;
    if (pipeline === null || own.depthTexture === null || colour === null) return;
    madeFor = { depth: own.depthTexture, resolve: colour };
    // The depth of a depth-and-stencil texture is read through a view of that aspect alone.
    group = device.createBindGroup({
      layout: (pipeline as GPURenderPipeline).getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer, size: layout.bytes } },
        { binding: 1, resource: colour },
        { binding: 2, resource: own.depthTexture.createView({ aspect: "depth-only" }) },
      ],
    });
  }

  const task: Task = createCustomTask(engine, scene, {
    name: "line",
    record() {
      if (!disposed) build();
    },
    execute() {
      const encoder = getFrameEncoder(engine);
      const canvas = getRenderTargetAttachments(engine.scRT, canvasNow).colorView;
      if (disposed || encoder === undefined || canvas === null) return 0;
      build();
      if (pipeline === null || group === null) return 0;
      // The projection's depth terms, from the camera's near and far: written when the lens moves them.
      const { width, height } = engine.canvas;
      const projection = getProjectionMatrix(camera(), width > 0 && height > 0 ? width / height : 1);
      record.depthTerms[0] = projection[10] as number;
      record.depthTerms[1] = projection[14] as number;
      writePass(data, 0, layout, record);
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== sent[i]) {
          device.queue.writeBuffer(buffer, 0, data.buffer, 0, data.byteLength);
          sent = data.slice();
          break;
        }
      }
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: canvas, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      return 1;
    },
    dispose() {
      madeFor = null;
      group = null;
    },
  });

  return {
    resolved,
    task,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      madeFor = null;
      group = null;
      buffer.destroy();
    },
  };
}
