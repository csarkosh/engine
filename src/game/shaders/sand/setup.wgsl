
  let sdW=input.vTerrainW.w+input.vTerrainW2.x;
  let sdOn=sdW>0.02;
  let sdsx=dpdx(uvS);let sdsy=dpdy(uvS);let sdpx=dpdx(uvP);let sdpy=dpdy(uvP);
  var sdhS=Hex(vec2<f32>(0.0),vec2<f32>(0.0),vec2<f32>(0.0),vec3<f32>(0.0));
  var sdhP=sdhS;
