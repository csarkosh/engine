# Memory

Where a game's memory goes, measured the same way every time, for any game built on the engine.
Three scripts, run from the game's root (their paths below are as a game installs the engine):

| Script | What it does |
| --- | --- |
| `check.mjs` | Loads one address in a Chrome of its own, waits, and writes one JSON inventory and a short table. |
| `group.mjs` | Groups an inventory by kind, by label and format, or by the code that made each buffer and texture. |
| `diff.mjs` | Two inventories in, what changed out: the one a session uses to say what a change saved or what grew. |

There is no `duplicates.mjs`. Telling that two textures are the same image needs their contents, and
the inventory holds only what the page asked the GPU for (sizes, formats, labels, stacks), never the
pixels; hashing them would mean the page copying every upload, which changes the thing measured. A
game that suspects duplicates hashes its own files before they are loaded.

## Measuring

```bash
# a dev server
node node_modules/@csarkosh/engine/tools/memory/check.mjs --url 'http://localhost:5173/game/x?cmd=seed%20abc' --label dev-before

# a live address
node node_modules/@csarkosh/engine/tools/memory/check.mjs --url 'https://games.example.com/mygame/' --wait 110 --label live
```

| Option | |
| --- | --- |
| `--url` | The address, exactly as the page should open it, query and all. The tool adds nothing to it and reads no parameter of any game's. |
| `--label` | The run's name; the files are `<out>/<label>.json` and `<label>.jpg` (a screenshot, to see the page showed what you meant). Default: the host and the time. |
| `--out` | The folder (default `tools/memory/runs` under the game's root, made if missing; a game ignores it in Git, a run is 100 to 500 KB). |
| `--wait` | Seconds to let the page load and settle before reading (default 90). |
| `--width`, `--height`, `--dpr` | The page's size and pixel ratio (1280 x 720 at 1). |
| `--heap` | Also a heap snapshot of the page and each worker, summed by kind of object, and who holds the large array buffers. Slow and heavy: leave it off unless the JavaScript heap is the question. |
| `--probe <expression>` | A JavaScript expression run in the page at the end; its value is stored as `page.probe` and printed. This is how a game's own counters (the number of meshes, a tier name) go into the run without the tool knowing them. |
| `--chrome <path>` | The browser. Otherwise the `CHROME` variable, otherwise the usual install places of the platform; with none, the tool says where it looked. |

The browser is headless, takes a debugging port the system picks, uses a profile directory of its own under
the OS temp folder, and is shut down and the profile removed when the run ends, on an error and on Ctrl-C
too. Nothing of your own Chrome is touched. WebGPU needs a machine with a GPU; a machine without one
makes a run that says `gpu.available: false` and an empty GPU inventory.

The table it prints: what the page reported about itself (its title, its body's classes, any `data-*`
attributes on `html` and `body`, and the `--probe` value), each browser process's resident size and (on
a Mac) physical footprint, each JavaScript context's heap, and the largest groups of GPU memory.

### How long to wait

A town, a forest or a model arrives late: models are fetched and decoded after the page is up, and a
streamed world keeps adding until it has caught up with the camera. A run that reads too early shows a
smaller number and a different mix. Wait until the figures stop growing: take one run at 60 s and one at
300 s once, see where it flattens, and use that wait for every run you will compare. The JSON's `series`
(the page's JS heap and the resident size of the tab and the GPU process, every second for 30 s and then
every five) shows it without a second run. 90 s is a start, not a rule.

### What the numbers are

- **GPU buffers and textures** (`gpu`) are what the page asked the GPU device for: every `createBuffer`
  and `createTexture`, counted until the page calls `destroy()` on it. A texture is counted as
  texels x bytes a texel x mip levels x samples; a block-compressed format in whole blocks, level by
  level. A format the tool does not know is counted at 4 bytes a texel and named in `gpu.unknownFormats`,
  and the total is then a guess. Depth formats are the browser's to size, so their figure is an estimate.
  Resources the page lets go of without `destroy()` stay counted.
- **The browser's own count is about twice that.** The GPU process also holds its own copies and
  staging, and the browser's tile, window and shader memory. The page's count is the part the page
  chose; use it to see what changed, and the process figures to see what it costs the machine.
- **Process figures**: `rssMB` is resident size; `footprintMB` is the Mac's physical footprint (the number
  Activity Monitor calls Memory), `null` elsewhere. There are no process figures on Windows.
- **Heaps** (`heaps`) are the JavaScript heap of the page and of each worker, as the browser reports it.

### Comparing two runs honestly

Change one thing. The same address (same seed, same place, same build tag or `--probe` that proves it),
the same `--width`, `--height` and `--dpr`, the same graphics tier, the same `--wait`, the same machine
and browser (each run records `browser` and `platform`), and nothing else heavy running. Run the same
build twice first and `diff.mjs` them: that is the noise of the page, and it should be a few
kilobytes. A change smaller than that is not a change.

A game that scales its render resolution to hold its frame rate (most do) makes render targets that
are a different size from one run to the next, on the same build: two runs of one live game differed by
19 MB, all of it in the full-screen targets, while every buffer was identical. Put the render targets in
one group with a rules file (so the change shows as one line), or pin the game's resolution in the
address if it has a way to, before reading a small change.

A production build's call stacks are minified, so on a live address the makers are coarse (a bundle's
file name and a one-letter function) and the totals are what to compare. For a fine breakdown measure
the dev server, which keeps the file names and function names.

## Grouping

```bash
node node_modules/@csarkosh/engine/tools/memory/group.mjs tools/memory/runs/dev-before.json [--by maker|label|kind|full] [--rules rules.json] [--top 25] [--json]
```

`--by maker` (the default) groups by kind (buffer or texture) and by **maker**: the innermost frame of
the call stack that is the application's own source. A frame is the application's own when its file is
not under `node_modules` and not one of the dev server's (`.vite`, `@vite`, `@id`); the engine installed
as a package (`node_modules/@csarkosh/engine/`) counts as the application's, since its code is what
says who asked for the resource. A stack with no such frame (everything in the renderer library) falls
back to the nearest frame that has a function name. A maker is written `<file> <function>` with no
line number, so an edit above it does not rename it, and a bundle's content hash is left out of its
file name so two builds name it alike. `--by label` groups by kind, label and format; `--by kind` by
kind alone; `--by full` by all of them.

### A game's own groups

A rules file is a JSON list, tried in order; the first rule an entry matches names its group, and an
entry no rule matches is grouped by `--by`. Nothing of any game is in the engine: this is where a game
says what its own pieces are.

```json
[
  { "name": "render targets", "kind": "texture", "label": "^(scene|post_)" },
  { "name": "town geometry", "kind": "buffer", "stack": "town/parts\\.ts" },
  { "name": "block-compressed textures", "kind": "texture", "format": "^(bc|astc|etc2)" },
  { "name": "big single buffers", "kind": "buffer", "minBytes": 8388608 }
]
```

| Key | |
| --- | --- |
| `name` | The group's name (required). |
| `kind` | `"buffer"` or `"texture"`. |
| `label`, `format` | Regular expressions over the resource's label and its format (a buffer has format `""`). |
| `stack` | A regular expression over the stack's text: one line a frame, `<function> <file>:<line>`, innermost first. |
| `minBytes`, `maxBytes` | Bounds on the size of one object (an entry's bytes divided by its count). |

Every key a rule has must match. A key that is not in the list above is an error, so a typo is not
silently a rule that matches everything.

## Diffing

```bash
node node_modules/@csarkosh/engine/tools/memory/diff.mjs before.json after.json [--by ...] [--rules ...] [--top 25] [--min-kb 0] [--json]
```

Both files are grouped the same way, so pass the same `--by` and `--rules` to see a change in the
terms you care about. It prints the GPU totals before and after, the browser's sums (renderer, GPU
process, all processes, page heap), and every group that changed, largest change first, with its bytes
and object counts before and after and `new` or `gone` where a group appeared or vanished. A group that
did not change is left out.

## The inventory's shape

`<label>.json` (`schema` 1), made by `check.mjs`:

```
{
  schema, label, url, at, waitSeconds,
  viewport: { width, height, dpr },
  browser, platform,                         // "Chrome/150...", "darwin"
  series: [{ t, heapMB, tabMB, gpuProcessMB }],   // t in seconds since the page was asked for
  page: { title, bodyClass, htmlData, bodyData, finalUrl, probe? },
  processes: [{ pid, type, rssMB, footprintMB }],  // type: browser, renderer, gpu-process, utility:...
  heaps: [{ type, url, usedMB, totalMB, embedderMB, backingMB }],  // type: page, worker
  performanceMemory: { used, total, limit },
  gpu: {
    available,                              // false: the page made no WebGPU device
    bufferBytes, textureBytes, count,       // live resources at the end
    unknownFormats: [format],
    entries: [{                             // live resources of one kind, label, format, size, usage and stack, summed
      kind: "buffer" | "texture", label, format, dims, usage,
      bytes, count,                         // the sum of the group, the number of resources
      stack: [{ fn, file, line }]           // innermost first, the file as a path (no host, no query)
    }]                                      // largest first
  },
  snapshots?: [{ type, url, totalMB, top: [text], holders: [text] }],   // with --heap
  problems: [text]                          // the page's first uncaught errors
}
```

`dims` is `WxH`, `WxHxLayers`, with ` 3d`, ` mipsN` and ` msaaN` where they apply (empty for a buffer).
The page-side wrapping is `lib/track.mjs`, which says in its header what it counts and how.

## Tests

`npm run test:tools` runs these with the other tools' (`npx vitest run --root tools memory` runs only
these). They need no browser: the page-side counting runs against a fake device, and the rest against a
small made-up inventory (`test/fixture.mjs`). Starting Chrome and reading its processes are the parts
they cannot cover; a run against a real address is the test of those.
