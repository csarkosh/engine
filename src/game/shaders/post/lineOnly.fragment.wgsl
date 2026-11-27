// The finish's line on the tier with no post chain: the scene's colour and its multisampled depth read as they stand,
// the line multiplied in, written to the canvas. The edge measure is finishLine.wgsl's (the second difference of the
// inverse of the distance over four neighbours, over the largest of the five), and a change to one is a change to the other.
// Where this tier keeps the frame (`RenderSide.keepsFrame`) and the look draws the line through (`finish.lineThrough`), the line on what shows through a
// surface drawn after the break is finishLineThroughCore.wgsl's rule, the chain's far softening's too, with this pass's reads of its own. Otherwise
// it is not in the text at all.
// Depth is Lite's: 1 at the near plane, 0 where nothing was drawn. A pixel's distance is made as the chain's depth
// resolve makes it (depthResolve.fragment.wgsl): depthTerms.y/(d-depthTerms.x) for each of the pixel's samples that holds
// something, summed and divided by the samples, so a wire thinner than a pixel is in every pixel it crosses and not in
// every other one; 100000 where no sample holds anything, as farSoft's farDepth makes it.
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var sceneColour:texture_2d<f32>;
@group(0)@binding(2)var sceneDepth:texture_depth_multisampled_2d;
const LINE_SKY:f32=100000.0;${lineThroughFunctions}
fn lineInverse(at:vec2<i32>)->f32{
  var sum=0.0;
  for(var i:i32=0;i<${samples};i++){
    let d=textureLoad(sceneDepth,at,i);
    if(d>0.0){sum+=u.depthTerms.y/(d-u.depthTerms.x);}
  }
  return select(1.0/LINE_SKY,${samples}.0/max(sum,1e-6),sum>0.0);
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
fn lineEdge(at:vec2<i32>)->f32{
  let size=vec2<i32>(textureDimensions(sceneDepth));
  if(any(at<vec2<i32>(1))||any(at>size-vec2<i32>(2))){return 0.0;}
  let wc=lineInverse(at);
  let wl=lineInverse(at-vec2<i32>(1,0));
  let wr=lineInverse(at+vec2<i32>(1,0));
  let wd=lineInverse(at-vec2<i32>(0,1));
  let wu=lineInverse(at+vec2<i32>(0,1));
  let second=wl+wr+wd+wu-4.0*wc;
  let largest=max(max(max(wl,wr),max(wd,wu)),wc);
  let reach=lineReach(largest);
  return smoothstep(u.finishLineBand.x*reach.x,u.finishLineBand.y*reach.x,abs(second)/largest)*reach.y;
}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let at=vec2<i32>(input.position.xy);
  let c=textureLoad(sceneColour,at,0);
  return vec4<f32>(mix(c.rgb,c.rgb*u.finishLine.xyz,${lineMeasure}*u.finishLine.w),c.a);
}
