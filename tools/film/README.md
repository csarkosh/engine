# tools/film

`record.mjs` records a film page's frames over the Chrome DevTools Protocol. The page exposes
`window.engineFilm` (`src/game/film/filmApi.ts`).

```
ENGINE_LAB=/Volumes/CyrusExtSSD/engine-lab \
node tools/film/record.mjs --url <film page> [--out <dir>] [--remote <port>] [--stills 0,12.5]
```

- Without `--out`, frames go to `$ENGINE_LAB/film/<name>`; with neither, the run is refused.
- The viewport is set to the film's `width` x `height` at device scale 1. The run waits up to 10 minutes
  for `engineFilm.ready` and refuses, printing them, if `problems` is not empty.
- Frames are `frame-000000.png` and on; frames already there are kept, so a stopped run resumes.
- `--stills` writes `still-<t>.png` at those times only. `film.json` holds the definition, the page URL,
  the build's tag and the start time.

## Locally

Without `--remote`, the script starts Chrome on this Mac from a fresh profile (`tools/frame-budget/lib/cdp.mjs`).
Serve the game's film page with its dev server and pass that URL.

## On the rig

Start the rig with Day Hike's `tools/rig/session.sh up` (the owner's go-ahead is needed; it bills while up),
forward its DevTools port on 9333, then:

```
node tools/film/record.mjs --url <film page> --remote 9333
```

The tools never start a rig. Stop it when the run is done.
