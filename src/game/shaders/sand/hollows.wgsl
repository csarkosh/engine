    {
      let hWs=max(w3+w4,1.0e-3);
      let hPeb=w4/hWs;
      let hHs=mix(smoothstep(0.46,0.55,rah3.b),smoothstep(0.30,0.66,rah4.b),hPeb);
      let hCav=(0.45*(hHs-0.5)-0.18*(1.0-smoothstep(0.0,0.35,hHs)))*(1.0+0.6*hPeb);
      surfaceAlbedo*=1.0+${hollows}*hCav*strength*sdM;
    }
