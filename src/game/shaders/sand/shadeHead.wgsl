
  let sdFw=fwidth(P.xz);
  let sdFoot=max(sdFw.x,sdFw.y);
  var sdDamp=0.0;
  var sdCoarse=0.0;
  if(sdOn){
    let sdM=smoothstep(0.02,0.4,sdW);
    sdMask=sdM;
    let sdHt=P.y-material.wetLevel;
    let sdSea=select(0.0,1.0,material.wetRadius>=${seaRadius});
    let sdSlope=max(length(terrainN.xz)/max(terrainN.y,0.2),0.012);
