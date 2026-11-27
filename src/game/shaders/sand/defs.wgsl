const SAND_WRAP:f32=1024.0;
const SAND_CUT:f32=0.04;
fn sdHash(c:vec2<f32>)->f32{
  var p3=fract(vec3<f32>(c.x,c.y,c.x)*0.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
fn sdNoise(p:vec2<f32>,wave:f32)->f32{
  let q=p/wave;
  let c=floor(q);
  let f=q-c;
  let u=f*f*(3.0-2.0*f);
  let c0=gmod2(c,SAND_WRAP);
  let c1=gmod2(c+1.0,SAND_WRAP);
  let a=sdHash(c0);
  let b=sdHash(vec2<f32>(c1.x,c0.y));
  let d=sdHash(vec2<f32>(c0.x,c1.y));
  let e=sdHash(c1);
  return mix(mix(a,b,u.x),mix(d,e,u.x),u.y);
}
fn sdFetch(tex:texture_2d_array<f32>,on:bool,h:Hex,layer:i32,dx:vec2<f32>,dy:vec2<f32>,uv:vec2<f32>)->vec3<f32>{
  if(!on){return textureSampleGrad(tex,terrainSmp,uv,layer,dx,dy).rgb;}
  var c=vec3<f32>(0.0);
  var s=0.0;
  if(h.s.x>SAND_CUT){c+=textureSampleGrad(tex,terrainSmp,h.u1,layer,dx,dy).rgb*h.s.x;s+=h.s.x;}
  if(h.s.y>SAND_CUT){c+=textureSampleGrad(tex,terrainSmp,h.u2,layer,dx,dy).rgb*h.s.y;s+=h.s.y;}
  if(h.s.z>SAND_CUT){c+=textureSampleGrad(tex,terrainSmp,h.u3,layer,dx,dy).rgb*h.s.z;s+=h.s.z;}
  return c/max(s,1.0e-4);
}
