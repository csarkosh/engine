// The line's edge measure in the far softening. The tier with no chain has its own copy that reads the scene's depth directly
// (lineOnly.fragment.wgsl): a change to one is a change to the other.
fn lineInverse(uv:vec2<f32>)->f32{
  return 1.0/farDepth(uv);
}
fn lineEdge(uv:vec2<f32>)->f32{
  let o=1.0/vec2<f32>(textureDimensions(depthSampler));
  if(any(uv<o)||any(uv>vec2<f32>(1.0)-o)){return 0.0;}
  let wc=lineInverse(uv);
  let wl=lineInverse(uv-vec2<f32>(o.x,0.0));
  let wr=lineInverse(uv+vec2<f32>(o.x,0.0));
  let wd=lineInverse(uv-vec2<f32>(0.0,o.y));
  let wu=lineInverse(uv+vec2<f32>(0.0,o.y));
  let second=wl+wr+wd+wu-4.0*wc;
  let largest=max(max(max(wl,wr),max(wd,wu)),wc);
  return smoothstep(u.finishLineBand.x,u.finishLineBand.y,abs(second)/largest);
}
fn finishLine(uv:vec2<f32>,col:vec3<f32>)->vec3<f32>{
  return mix(col,col*u.finishLine.xyz,lineEdge(uv)*u.finishLine.w);
}
