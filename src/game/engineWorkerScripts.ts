/**
 * The addresses of the engine's own workers' scripts, as the bundler names
 * them: the same files `skyWorker.ts`, `oceanLoopStart.ts` and
 * `impostorFieldWorker.ts` start their workers from, for the page to fetch
 * ahead (`workerScripts.ts`). Only the addresses: nothing of the workers is
 * loaded by naming them.
 */
import impostorFieldScript from "./impostorField.worker.ts?worker&url";
import oceanLoopScript from "./oceanLoop.worker.ts?worker&url";
import skyScript from "./sky.worker.ts?worker&url";

export const ENGINE_WORKER_SCRIPTS: readonly string[] = [skyScript, oceanLoopScript, impostorFieldScript];
