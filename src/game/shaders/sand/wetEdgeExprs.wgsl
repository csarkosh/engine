mix(wetBelow(input.worldPos.y,material.wetLine),sdWet,sdE)
max(wetCoveW.y*(1.0-wetStill),sdE*sdDmp*wetIn)
mix(WET_ROUGHNESS,sdGloss,sdE)
