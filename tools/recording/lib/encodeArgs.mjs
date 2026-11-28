// The ffmpeg arguments that turn a film's recorded frames into its MP4: pure, so the shape is testable without ffmpeg.

/**
 * With a loop, input A is the frames from `blend*fps` to the end and input B the first `blend*fps` frames; B fades in
 * as A ends, so the last frame dissolves into the first. Without one, the frames as they are. Either way the output
 * has exactly `seconds*fps` frames.
 */
export function encodeArgs(def, paths, crf = 18) {
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
  args.push("-c:v", "libx264", "-crf", String(crf), "-g", String(2 * def.fps), "-movflags", "+faststart", "-an", paths.out);
  return args;
}
