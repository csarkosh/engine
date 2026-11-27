let sdE=sdMask*${wetEdge};
let sdY=input.worldPos.y-sdRag*sdE*1.2;
let sdLine=sdY-material.wetLine;
let sdWet=1.0-smoothstep(-0.13,0.03,sdLine);
let sdDmp=(1.0-smoothstep(0.0,0.38,sdLine))*(1.0-sdWet);
let sdGloss=mix(0.07,0.32,smoothstep(0.0,1.0,(sdY-material.wetLevel)/max(material.wetLine-material.wetLevel,0.05)));
