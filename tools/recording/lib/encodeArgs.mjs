// The ffmpeg arguments that turn a film's recorded frames into its MP4: pure, so the shape is testable without ffmpeg.

/**
 * With a loop, input A is the frames from `blend*fps` to the end and input B the first `blend*fps` frames; B fades in
 * as A ends, so the last frame dissolves into the first. Without one, the frames as they are. Either way the output
 * has exactly `seconds*fps` frames, with a key frame every 2 s and only there (no scene-cut key frames). A loop's
 * blend must be over 0.
 */
export function encodeArgs(def, paths, crf = 18) {
  if (def.loop && !(def.loop.blend > 0)) throw new Error(`the film's loop blend must be over 0 s (it is ${def.loop.blend}): a film with no blend has \`loop: null\``);
  const frames = `${paths.frames}/frame-%06d.png`;
  const total = Math.round(def.seconds * def.fps);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (def.loop) {
    const blend = def.loop.blend;
    const blendFrames = Math.round(blend * def.fps);
    args.push("-framerate", String(def.fps), "-start_number", String(blendFrames), "-t", String(def.seconds), "-i", frames);
    args.push("-framerate", String(def.fps), "-start_number", "0", "-t", String(blend), "-i", frames);
    args.push("-filter_complex", `[0:v][1:v]xfade=transition=fade:duration=${blend}:offset=${def.seconds - blend},format=yuv420p[v]`, "-map", "[v]");
  } else {
    args.push("-framerate", String(def.fps), "-start_number", "0", "-i", frames, "-pix_fmt", "yuv420p");
  }
  args.push("-frames:v", String(total), "-r", String(def.fps));
  args.push("-c:v", "libx264", "-crf", String(crf), "-g", String(2 * def.fps), "-keyint_min", String(2 * def.fps), "-sc_threshold", "0", "-movflags", "+faststart", "-an", paths.out);
  return args;
}
