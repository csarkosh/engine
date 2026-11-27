    let sdNL=sdNoise(P.xz+vec2<f32>(83.0,-29.0),9.0);
    let sdNF=sdNoise(P.xz+vec2<f32>(-57.0,11.0),1.3);
    let sdWob=(sdNL-0.5)*0.34+(sdNF-0.5)*0.10;
    sdRag=sdWob;
