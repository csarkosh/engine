// The line's edge measure in the far softening. The tier with no chain has its own copy that reads the scene's depth directly
// (lineOnly.fragment.wgsl): a change to one is a change to the other.
fn lineInverse(uv:vec2<f32>)->f32{
  return 1.0/farDepth(uv);
}
// How far off the pen lifts. `largest` is 1 over the distance to the nearest of the five readings (the sky reads 1 over 100000, so a
// ridge against the sky is measured at the ridge's own distance, never at the sky's). Along the logarithm of that distance, from
// finishLineFar.x to .y, eased. Returns the multiple the band is made (finishLineFar.z at the far end) and the share of the strength kept
// (finishLineFar.w there). With both at 1 (the default) the line is what it was at every distance.
fn lineReach(largest:f32)->vec2<f32>{
  let far=u.finishLineFar;
  let t=smoothstep(0.0,1.0,clamp(log2(1.0/max(largest,1e-9)/far.x)/max(log2(far.y/far.x),1e-4),0.0,1.0));
  return vec2<f32>(pow(far.z,t),mix(1.0,far.w,t));
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
  let reach=lineReach(largest);
  return smoothstep(u.finishLineBand.x*reach.x,u.finishLineBand.y*reach.x,abs(second)/largest)*reach.y;
}
fn finishLine(uv:vec2<f32>,col:vec3<f32>)->vec3<f32>{
  return mix(col,col*u.finishLine.xyz,lineEdge(uv)*u.finishLine.w);
}
