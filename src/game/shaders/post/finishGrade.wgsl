  var finishShown=shown;
  let finishL=dot(finishShown,vec3<f32>(0.299,0.587,0.114));
  let finishBand=(floor(finishL*5.0)+smoothstep(0.3,0.7,fract(finishL*5.0)))/5.0;
  finishShown=finishShown*mix(1.0,finishBand/max(finishL,0.02),u.finishGrade.z);
  let finishHash=fract(sin(dot(floor(pixel),vec2<f32>(12.9898,78.233))+fract(u.time*7.31)*43.0)*43758.5453)
    +fract(sin(dot(floor(pixel)+vec2<f32>(31.0,17.0),vec2<f32>(39.346,11.135))+fract(u.time*3.17)*29.0)*24634.6345)-1.0;
  let finishL2=dot(finishShown,vec3<f32>(0.299,0.587,0.114));
  finishShown+=vec3<f32>(finishHash)*u.finishGrade.x*(1.0-0.5*finishL2);
  let finishR=length((vUV-0.5)*vec2<f32>(1.0,0.8))*1.5;
  finishShown*=1.0-u.finishGrade.y*smoothstep(0.45,1.0,finishR);
  shown=finishShown;
