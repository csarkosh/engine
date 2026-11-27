// The line on what shows through a surface drawn after the frame's break (`GameLook.finish.lineThrough`), in the far softening of a chain that
// keeps the frame; the rule itself is finishLineThroughCore.wgsl's. `keptDepth` is the depth the first half left (sample 0), `wholeDepth` the scene's
// multisampled depth as the whole pass left it. A tap is through where the whole pass's sample 0 is nearer than the first half's (Lite's depth is 1 at
// the near plane: larger is nearer), and they are the same bits where nothing was drawn after the break. The tier with no chain does not read this file; where
// it keeps the frame its line pass runs the same rule (finishLineThroughCore.wgsl) with reads of its own (lineOnly.fragment.wgsl).
@group(0)@binding(6)var keptDepth:texture_2d<f32>;
@group(0)@binding(7)var wholeDepth:texture_depth_multisampled_2d;
fn keptInverse(at:vec2<i32>)->f32{
  let d=textureLoad(keptDepth,at,0).r;
  return 1.0/select(FAR_SOFT_SKY,u.depthTerms.y/(d-u.depthTerms.x),d>0.0);
}
fn lineIsThrough(at:vec2<i32>)->bool{
  return textureLoad(wholeDepth,at,0)>textureLoad(keptDepth,at,0).r;
}
fn lineTapAlpha(at:vec2<i32>)->f32{
  return textureLoad(textureSampler,at,0).a;
}
fn lineSize()->vec2<i32>{
  return vec2<i32>(textureDimensions(keptDepth));
}
// The line at a pixel: lineEdge's, or lineThrough's where a tap is through.
fn lineSeen(uv:vec2<f32>)->f32{
  return lineThrough(lineEdge(uv),vec2<i32>(tx(uv)*vec2<f32>(lineSize())));
}
fn finishLineThrough(uv:vec2<f32>,col:vec3<f32>)->vec3<f32>{
  return mix(col,col*u.finishLine.xyz,lineSeen(uv)*u.finishLine.w);
}
