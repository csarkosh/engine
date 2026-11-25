/**
 * A film's frames as the screen got them.
 *
 * A film played over a session while the session loads shares the machine
 * with the load: the graphics chip that draws the hidden session presents the
 * film's frames, and a film that is not given its frames in time shows a
 * picture that stands and then jumps. Whether that is happening is read off
 * the film itself, so the load can be paced by it (`loadPace.ts`):
 *
 * - `missed`: the film's frames the screen never showed, counted from the
 *   watch's start. Where the browser calls back for each frame it presents
 *   (`requestVideoFrameCallback`), a call says how far the film's own time
 *   moved since the last and how many frames were presented meanwhile: time
 *   that moved by more frames than were presented left the difference
 *   unshown, however long the gap (a film's time stands while it waits for
 *   data, so time that moved was time played). A call that came late (the
 *   page was busy) is not a frame missed: the count of frames presented went
 *   on without it. And a picture standing now is counted as it stands, before
 *   the call that ends it: once the film's time is `FILM_STANDS_S` past the
 *   last frame presented, the frames due since are missed. Where the browser
 *   has no such call, its own count of frames dropped is read
 *   (`getVideoPlaybackQuality`).
 * - `clock`: the film's time, in seconds. A film that plays and whose time
 *   stands is a picture that stands, though no frame of it was missed.
 * - `playing`: whether the film plays (not paused, ended or failed).
 * - `fed`: whether the film has data ahead of its time. A film with none
 *   waits for its file: its time stands for the link's sake, and nothing the
 *   machine does or leaves undone moves it.
 *
 * A browser with neither count says nothing of a film's frames, and neither
 * does one that offers the call and has not yet made it (a film not yet
 * shown, or never): the watch reads null, and whoever paces by it keeps to
 * what is safe unseen.
 */

/** A film's frames at a moment. */
export type FilmFrames = { playing: boolean; missed: number; clock: number; fed: boolean };

/** Reads a film's frames as they stand; null where nothing is told of them. */
export type FilmFramesProbe = () => FilmFrames | null;

/** What the watch asks of a film: a video element's own members. */
export type WatchedFilm = {
  readonly paused: boolean;
  readonly ended: boolean;
  readonly error: unknown;
  readonly currentTime: number;
  readonly buffered?: { readonly length: number; start(index: number): number; end(index: number): number };
  requestVideoFrameCallback?(callback: (now: number, frame: { mediaTime: number; presentedFrames: number }) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
  getVideoPlaybackQuality?(): { droppedVideoFrames: number };
};

/** A playing film whose time is this far past the last frame presented shows a picture that stands (s). */
export const FILM_STANDS_S = 0.25;

/** A film with less than this buffered past its time has no data ahead (s). */
export const FILM_FED_S = 0.25;

export type FilmWatch = {
  read: FilmFramesProbe;
  /** Ends the watch: the film is called back for no more frames. */
  stop(): void;
};

export function watchFilmFrames(film: WatchedFilm): FilmWatch {
  const playing = (): boolean => !film.paused && !film.ended && (film.error === null || film.error === undefined);
  /** Whether the film has data ahead of its time; a film that does not say what it has buffered is taken to. */
  const fed = (): boolean => {
    const ranges = film.buffered;
    if (ranges === undefined) return true;
    const t = film.currentTime;
    for (let i = 0; i < ranges.length; i++) if (ranges.start(i) <= t && t <= ranges.end(i)) return ranges.end(i) - t >= FILM_FED_S;
    return false;
  };
  if (typeof film.requestVideoFrameCallback === "function") {
    let stopped = false;
    let handle = 0;
    /** Frames missed between calls, and the most ever read (with those of a picture standing): a read never goes back. */
    let counted = 0;
    let read = 0;
    let lastTime = -1;
    let lastPresented = 0;
    /** The film's time a frame, as the shortest step a frame seen so far: a step with a frame missed in it reads longer, never shorter. */
    let frameS = Infinity;
    const next = (): void => {
      handle = (film.requestVideoFrameCallback as NonNullable<WatchedFilm["requestVideoFrameCallback"]>)((_now, frame) => {
        if (stopped) return;
        const step = frame.mediaTime - lastTime;
        const presented = frame.presentedFrames - lastPresented;
        if (lastTime >= 0 && step > 0 && presented > 0) {
          frameS = Math.min(frameS, step / presented);
          const due = Math.round(step / frameS);
          if (due > presented) counted += due - presented;
        }
        lastTime = frame.mediaTime;
        lastPresented = frame.presentedFrames;
        next();
      });
    };
    next();
    return {
      read() {
        // No frame has been called back for yet: nothing is known of this film's frames.
        if (lastTime < 0) return null;
        const plays = playing();
        // A picture standing now: the film's time has gone on past the last frame presented.
        const past = film.currentTime - lastTime;
        const standing = plays && Number.isFinite(frameS) && past >= FILM_STANDS_S ? Math.floor(past / frameS) - 1 : 0;
        read = Math.max(read, counted + Math.max(0, standing));
        return { playing: plays, missed: read, clock: film.currentTime, fed: fed() };
      },
      stop() {
        stopped = true;
        film.cancelVideoFrameCallback?.(handle);
      },
    };
  }
  if (typeof film.getVideoPlaybackQuality === "function") {
    const from = film.getVideoPlaybackQuality().droppedVideoFrames;
    return {
      read: () => ({
        playing: playing(),
        missed: (film.getVideoPlaybackQuality as NonNullable<WatchedFilm["getVideoPlaybackQuality"]>)().droppedVideoFrames - from,
        clock: film.currentTime,
        fed: fed(),
      }),
      stop: () => undefined,
    };
  }
  return { read: () => null, stop: () => undefined };
}
