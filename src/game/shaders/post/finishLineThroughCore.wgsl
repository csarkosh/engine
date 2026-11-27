// The rule of the line on what shows through a surface drawn after the frame's break (`GameLook.finish.lineThrough`), apart from how a pass reads its
// textures, so that the chain's far softening (finishLineThrough.wgsl) and the pass of the tier with no chain (lineOnly.fragment.wgsl) can run the same text.
// Given the five taps of a pixel (itself, left, right, below, above: `taps`), the inverse of the distance of each on the depth the first half left
// (`inverse`), whether each is through (`through`: the whole pass's depth is nearer than the first half's there) and the line the pass would draw from
// its own depth (`edge`): the same measure on the first half's depth (the band and the reach as lineEdge's own), taken by what the nearest tap leaves of it,
// which is the whole of it where that tap is not through and what its surface's alpha does not hide where it is (`lineTapAlpha`, the pass's own read of the
// frame's alpha at a tap); and the larger of that and `edge`.
// `lineThrough` is the whole of it for a pixel `at`, given the line the pass draws from its own depth (`edge`) and four reads each pass makes for itself:
// `lineSize` (the frame's size in pixels), `keptInverse` (the inverse of the distance on the first half's depth, sample 0, the sky as the line treats it),
// `lineIsThrough` (the whole pass's depth, sample 0, nearer than the first half's) and `lineTapAlpha`. Where the frame did not break (`u.lineKept` is 0: the
// first half's depth is a frame old), at the border, or where no tap is through, it is `edge`.
fn lineHidden(edge:f32,inverse:array<f32,5>,through:array<bool,5>,taps:array<vec2<i32>,5>)->f32{
  let second=inverse[1]+inverse[2]+inverse[3]+inverse[4]-4.0*inverse[0];
  let largest=max(max(max(inverse[1],inverse[2]),max(inverse[3],inverse[4])),inverse[0]);
  let reach=lineReach(largest);
  let hidden=smoothstep(u.finishLineBand.x*reach.x,u.finishLineBand.y*reach.x,abs(second)/largest)*reach.y;
  var nearest:i32=0;
  for(var i:i32=1;i<5;i++){
    if(inverse[i]>inverse[nearest]){nearest=i;}
  }
  var keep=1.0;
  if(through[nearest]){keep=1.0-clamp(lineTapAlpha(taps[nearest]),0.0,1.0);}
  return max(edge,hidden*keep);
}
fn lineThrough(edge:f32,at:vec2<i32>)->f32{
  if(u.lineKept<0.5){return edge;}
  let size=lineSize();
  if(any(at<vec2<i32>(1))||any(at>size-vec2<i32>(2))){return edge;}
  var taps=array<vec2<i32>,5>(at,at-vec2<i32>(1,0),at+vec2<i32>(1,0),at-vec2<i32>(0,1),at+vec2<i32>(0,1));
  var inverse=array<f32,5>(0.0,0.0,0.0,0.0,0.0);
  var through=array<bool,5>(false,false,false,false,false);
  var seen=false;
  for(var i:i32=0;i<5;i++){
    inverse[i]=keptInverse(taps[i]);
    through[i]=lineIsThrough(taps[i]);
    seen=seen||through[i];
  }
  if(!seen){return edge;}
  return lineHidden(edge,inverse,through,taps);
}
