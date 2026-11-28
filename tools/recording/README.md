# tools/recording

`record.mjs` records a film page's frames over the Chrome DevTools Protocol, and `encode.mjs` turns them into the
film's MP4 and still. The page exposes `window.engineFilm` (`src/game/film/filmApi.ts`).

The scripts ship in the engine's package: run them from the game's directory, through `node_modules`.

```
ENGINE_LAB=/Volumes/CyrusExtSSD/engine-lab \
node node_modules/@csarkosh/engine/tools/recording/record.mjs --url <film page> [--out <dir>] [--remote <port>] \
  [--stills 0,12.5] [--fresh] [--allow-unsettled] [--frame-timeout 120]
```

- Without `--out`, frames go to `$ENGINE_LAB/film/<name>`; with neither, the run is refused.
- The viewport is set to the film's `width` x `height` at device scale 1. The run waits up to 10 minutes
  for `engineFilm.ready` and refuses, printing them, if `problems` is not empty (a path too fast, too
  low, or not covering the whole recording).
- Frames are `frame-000000.png` and on. Frames already there are kept, so a stopped run resumes, but only
  into frames of the same film: `film.json`'s `def.digest` must match the page's, or the run is refused.
  `--fresh` clears the frames there and starts again.
- `film.json` holds the definition, the page URL, the build's tag, when the first run started and
  (`resumed`) when each later run took over.
- A frame whose world did not settle is named as it is drawn and not kept, and the run fails at the end
  with their count; running it again draws just those. `--allow-unsettled` keeps them as they stand.
- A frame that takes longer than `--frame-timeout` seconds (120) fails the run.
- `--stills` writes `still-<t>.png` at those times only, and warns of the path's problems rather than
  refusing.

```
node node_modules/@csarkosh/engine/tools/recording/encode.mjs --frames <dir> --out <file.mp4> --still <file.webp> [--crf 18]
```

- Refuses a directory with no `film.json`, with a frame of the recording missing, or whose first frame is
  not the film's size.
- H.264 in MP4, `yuv420p`, `faststart`, no audio, a key frame every 2 s and only there. A looping film's
  last `blend` seconds dissolve into its start, and the seam is checked: the jump from the last frame to
  the first must be no bigger than the biggest frame-to-frame step (its size against the median step is
  printed too).

## Requirements

`encode.mjs` needs `ffmpeg` on the PATH, and `sharp` for the WebP still. `sharp` is a devDependency of the
engine, so a game adds it itself: `npm install -D sharp@0.34.5`. Without it the script stops with that
message. The engine's own tests of these scripts also use `ffprobe`, and skip without `ffmpeg` and `ffprobe`.

## Locally

Without `--remote`, the script starts Chrome on this Mac from a fresh profile (`tools/frame-budget/lib/cdp.mjs`).
Serve the game's film page with its dev server and pass that URL.

## On the rig

Start the rig with Day Hike's `tools/rig/session.sh up` (the owner's go-ahead is needed; it bills while up),
forward its DevTools port on 9333, then:

```
node node_modules/@csarkosh/engine/tools/recording/record.mjs --url <film page> --remote 9333
```

With `--remote`, pages an earlier run left open on that Chrome are closed first. The tools never start a
rig. Stop it when the run is done.
