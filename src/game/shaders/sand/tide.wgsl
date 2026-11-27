    {
      let tHw=0.07;
      let tAa=1.0-smoothstep(0.4,1.0,sdFoot*sdSlope/tHw);
      let tK=${tide}*sdSea*sdM;
      let tWrack=(1.0-smoothstep(0.0,tHw,abs(sdHt-${wrack}-sdWob)))*smoothstep(0.30,0.65,sdNF);
      let tOld=(1.0-smoothstep(0.0,tHw*1.2,abs(sdHt-${old}-sdWob)))*smoothstep(0.35,0.75,1.0-sdNF*0.7-sdNL*0.3);
      let tStorm=smoothstep(-0.10,0.10,sdHt-${storm}-sdWob*1.3)*sdSea;
      sdCoarse=tStorm;
      surfaceAlbedo*=1.0-tK*tAa*(0.36*tWrack+0.15*tOld);
      surfaceAlbedo*=1.0+tK*tStorm*vec3<f32>(0.08,0.08,0.09);
    }
