// The line pass's reads for the line on what shows through a surface drawn after the frame's break (`GameLook.finish.lineThrough`), on the tier with no chain that
// keeps the frame: the rule is finishLineThroughCore.wgsl's, the same text as the far softening's (finishLineThrough.wgsl), and these are this pass's own reads of
// it. `keptDepth` is the depth the first half left (sample 0); the whole pass's depth is `sceneDepth` sample 0, and the surfaces' alpha is that of `sceneColour`.
@group(0)@binding(3)var keptDepth:texture_2d<f32>;
fn keptInverse(at:vec2<i32>)->f32{
  let d=textureLoad(keptDepth,at,0).r;
  return 1.0/select(LINE_SKY,u.depthTerms.y/(d-u.depthTerms.x),d>0.0);
}
fn lineIsThrough(at:vec2<i32>)->bool{
  return textureLoad(sceneDepth,at,0)>textureLoad(keptDepth,at,0).r;
}
fn lineTapAlpha(at:vec2<i32>)->f32{
  return textureLoad(sceneColour,at,0).a;
}
fn lineSize()->vec2<i32>{
  return vec2<i32>(textureDimensions(keptDepth));
}
fn lineSeen(at:vec2<i32>)->f32{
  return lineThrough(lineEdge(at),at);
}
