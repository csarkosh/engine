    {
      let rBand=smoothstep(-0.03,0.05,sdHt)*(1.0-smoothstep(0.38,0.55,sdHt+sdWob*0.6))*(1.0-smoothstep(4.0,9.0,dist))*(1.0-smoothstep(0.016,0.036,sdFoot))*sdSea*sdM;
      if(rBand>0.01){
        let rDir=terrainN.xz/max(length(terrainN.xz),1.0e-4);
        let rPh=sdHt/(0.09*clamp(sdSlope,0.012,0.12))*6.28318+(sdNF-0.5)*9.0+(sdNL-0.5)*26.0;
        let rAmp=rBand*smoothstep(0.30,0.62,sdNoise(P.xz+vec2<f32>(29.0,-71.0),2.3))*${ripples};
        let rC=cos(rPh);
        N=normalize(N+vec3<f32>(rDir.x,0.0,rDir.y)*rC*0.26*rAmp);
        surfaceAlbedo*=1.0-0.20*rAmp*(0.5-0.5*rC);
      }
    }
