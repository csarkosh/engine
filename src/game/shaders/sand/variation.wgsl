    {
      let vMotAa=1.0-smoothstep(0.15,0.45,sdFoot/0.5);
      var vMot=0.0;
      if(vMotAa>0.0){vMot=sdNoise(P.xz+vec2<f32>(17.3,5.1),0.5)-0.5;}
      let vPt=smoothstep(0.52,0.78,sdNoise(P.xz+vec2<f32>(-41.0,63.0),5.0))*(1.0-smoothstep(0.15,0.45,sdFoot/5.0));
      let vDr=sdNoise(P.xz+vec2<f32>(101.0,-13.0),30.0)-0.5;
      let vHue=sdNoise(P.xz+vec2<f32>(-7.0,59.0),41.0)-0.5;
      sdDamp=vPt;
      let vTone=1.0+vMot*0.20*(1.0+0.5*sdCoarse)*vMotAa+vDr*0.26-0.14*vPt;
      let vTint=mix(vec3<f32>(1.05,1.01,0.93),vec3<f32>(0.95,0.98,1.03),smoothstep(-0.25,0.25,vHue));
      surfaceAlbedo*=mix(vec3<f32>(1.0),mix(vec3<f32>(1.0),vTone*vTint,${variation}),sdM);
    }
