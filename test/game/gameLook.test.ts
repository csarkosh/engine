import { describe, expect, it } from "vitest";
import { ENGINE_LOOK, LINE_FAR, LINE_FROM, LINE_NEAR, LINE_TO, NO_FINISH, finishDrawsInGrade, finishDrawsLine, finishDrawsLineThrough, finishGradeUniform, finishLineBandUniform, finishLineFarUniform, finishLineUniform, gameLook, lookGradeAt, type LookFinish, type LookGrade } from "../../src/game/gameLook.js";
import { PAINT_OILS, mixPalette } from "../../src/game/gradeParams.js";
import { SWARD_FLOOR, SWARD_MAX } from "../../src/game/groundHexParams.js";
import { sunPositionAt } from "../../src/game/sky.js";
import { FAR_SOFT_RADIUS } from "../../src/game/postFrame.js";
import { PAINT_STRENGTH } from "../../src/game/postParams.js";
import { DEFAULT_HOUR } from "../../src/game/skyWait.js";
import { emptyTerrainUniforms, terrainUniforms } from "../../src/game/terrainUniforms.js";
import { DEFAULT_WEATHER, WEATHER_PRESETS } from "../../src/game/weather.js";
import { farSoftWgsl, gradeWgsl, FAR_SOFT_WGSL, POST_VERTEX_WGSL, depthResolveWgsl, lineOnlyWgsl, passLayout } from "../../src/game/lite/postWgsl.js";
import { lineOnTier, lineOnlyUniforms } from "../../src/game/lite/lineOnly.js";
import { emptyFarSoftUniforms } from "../../src/game/postFrame.js";
import { fill, wgsl } from "../../src/game/shaders/shaderText.js";
import { createHash } from "node:crypto";
import { sourceText } from "../helpers/source.js";

describe("a game's look over the engine's", () => {
  it("is the engine's own look where a game gives none", () => {
    expect(gameLook()).toBe(ENGINE_LOOK);
  });

  it("holds the engine's constants as the engine's own look", () => {
    expect(ENGINE_LOOK.paint).toBe(PAINT_STRENGTH);
    expect(ENGINE_LOOK.farSoft).toBe(FAR_SOFT_RADIUS);
    expect(ENGINE_LOOK.exposure).toBe(1);
    expect(ENGINE_LOOK.palette).toBe(PAINT_OILS);
    expect(ENGINE_LOOK.weather).toBe(WEATHER_PRESETS[DEFAULT_WEATHER]);
    expect(ENGINE_LOOK.weatherName).toBe(DEFAULT_WEATHER);
    expect(ENGINE_LOOK.hour).toBe(DEFAULT_HOUR);
  });

  it("keeps the rest of the engine's look under the part a game gives", () => {
    const look = gameLook({ paint: 0, hour: 18 });
    expect(look.paint).toBe(0);
    expect(look.hour).toBe(18);
    expect({ ...look, paint: ENGINE_LOOK.paint, hour: ENGINE_LOOK.hour }).toEqual(ENGINE_LOOK);
  });

  it("has no finish by default: every strength 0", () => {
    expect(ENGINE_LOOK.finish).toBe(NO_FINISH);
    expect(ENGINE_LOOK.finish.grain).toBe(0);
    expect(ENGINE_LOOK.finish.edge).toBe(0);
    expect(ENGINE_LOOK.finish.line).toBe(0);
    expect(ENGINE_LOOK.finish.bands).toBe(0);
    expect(finishDrawsLine(ENGINE_LOOK.finish)).toBe(false);
    expect(finishDrawsInGrade(ENGINE_LOOK.finish)).toBe(false);
  });

  it("lays a game's whole finish over the engine's none", () => {
    const finish: LookFinish = { grain: 0.028, edge: 0.14, line: 0.6, lineColour: [0.16, 0.17, 0.22], lineFrom: 0.005, lineTo: 0.025, bands: 0.25 };
    const look = gameLook({ finish });
    expect(look.finish).toBe(finish);
    expect(look.paint).toBe(ENGINE_LOOK.paint);
    expect(finishDrawsLine(finish)).toBe(true);
    expect(finishDrawsInGrade(finish)).toBe(true);
    expect(finishLineUniform(finish)).toEqual([0.16, 0.17, 0.22, 0.6]);
    expect(finishLineBandUniform(finish)).toEqual([0.005, 0.025]);
    // Where a finish does not say, the line begins and is full where it always has.
    expect(finishLineBandUniform(NO_FINISH)).toEqual([LINE_FROM, LINE_TO]);
    expect([LINE_FROM, LINE_TO]).toEqual([0.01, 0.05]);
    expect(finishGradeUniform(finish)).toEqual([0.028, 0.14, 0.25]);
  });

  it("thins the line with distance only where the finish says so, and never divides by nothing", () => {
    // Not said: the line is the same at every distance (band 1, weight 1).
    expect(finishLineFarUniform(NO_FINISH)).toEqual([LINE_NEAR, LINE_FAR, 1, 1]);
    expect(finishLineFarUniform({ ...NO_FINISH, lineNear: 40, lineFar: 600, lineFarBand: 16, lineFarWeight: 0.4 })).toEqual([40, 600, 16, 0.4]);
    // A band under 1 would draw more far off, a weight out of 0 to 1 is no share: both are held, and the far end stays beyond the near.
    expect(finishLineFarUniform({ ...NO_FINISH, lineFarBand: 0.5, lineFarWeight: 3 })).toEqual([LINE_NEAR, LINE_FAR, 1, 1]);
    expect(finishLineFarUniform({ ...NO_FINISH, lineFarWeight: -1 })[3]).toBe(0);
    const same = finishLineFarUniform({ ...NO_FINISH, lineNear: 100, lineFar: 100 });
    expect(same[1]).toBeGreaterThan(same[0] as number);
    expect(finishLineFarUniform({ ...NO_FINISH, lineNear: 0 })[0]).toBeGreaterThan(0);
  });

  it("asks the grade for its part and the far softening for the line separately", () => {
    expect(finishDrawsLine({ ...NO_FINISH, line: 0.5 })).toBe(true);
    expect(finishDrawsInGrade({ ...NO_FINISH, line: 0.5 })).toBe(false);
    expect(finishDrawsLine({ ...NO_FINISH, grain: 0.02 })).toBe(false);
    expect(finishDrawsInGrade({ ...NO_FINISH, grain: 0.02 })).toBe(true);
    expect(finishDrawsInGrade({ ...NO_FINISH, edge: 0.1 })).toBe(true);
    expect(finishDrawsInGrade({ ...NO_FINISH, bands: 0.1 })).toBe(true);
  });

  it("leaves the passes' shader text the engine's own where the finish is off", () => {
    for (const text of [FAR_SOFT_WGSL, farSoftWgsl(false), gradeWgsl(true), gradeWgsl(false), gradeWgsl(true, false), gradeWgsl(false, false)]) {
      expect(text).not.toMatch(/finish/i);
      expect(text).not.toContain("LINE_DEPTH");
      expect(text).not.toContain("${");
    }
  });

  it("draws the line itself only on a tier with no chain, and only where the look asks for one", () => {
    const line: LookFinish = { ...NO_FINISH, line: 0.6 };
    expect(lineOnTier(false, line)).toBe(true);
    expect(lineOnTier(false, NO_FINISH)).toBe(false);
    expect(lineOnTier(false, { ...NO_FINISH, grain: 0.02, edge: 0.1, bands: 0.2 })).toBe(false);
    expect(lineOnTier(true, line)).toBe(false);
    expect(lineOnTier(true, NO_FINISH)).toBe(false);
  });

  it("gives the line's own pass the line's uniforms and the depth's two terms", () => {
    const finish: LookFinish = { ...NO_FINISH, line: 0.6, lineColour: [0.16, 0.17, 0.22], lineFrom: 0.005, lineTo: 0.025, lineFarBand: 16, lineFarWeight: 0.4 };
    const record = lineOnlyUniforms(finish, [-1.0002, -0.2]);
    expect(record.finishLine).toEqual([0.16, 0.17, 0.22, 0.6]);
    expect(record.finishLineBand).toEqual([0.005, 0.025]);
    expect(record.depthTerms).toEqual([-1.0002, -0.2]);
    expect(record.finishLineFar).toEqual([LINE_NEAR, LINE_FAR, 16, 0.4]);
    expect(Object.keys(record)).toEqual(["finishLine", "finishLineBand", "depthTerms", "finishLineFar"]);
    const layout = passLayout(record);
    expect(layout.struct).toBe("struct U{finishLine:vec4<f32>,finishLineBand:vec2<f32>,depthTerms:vec2<f32>,finishLineFar:vec4<f32>}");
    expect(layout.bytes).toBe(48);
  });

  it("reads the line's measure from the scene's multisampled depth on the tier with no chain", () => {
    const text = `${passLayout(lineOnlyUniforms(NO_FINISH)).struct}\n${POST_VERTEX_WGSL}\n${lineOnlyWgsl(4)}`;
    expect(text).not.toContain("${");
    expect(text).toContain("texture_depth_multisampled_2d");
    // A pixel's distance is every sample's, summed as the chain's depth resolve sums them.
    expect(text).toContain("for(var i:i32=0;i<4;i++){");
    expect(text).toContain("textureLoad(sceneDepth,at,i)");
    expect(text).toContain("if(d>0.0){sum+=u.depthTerms.y/(d-u.depthTerms.x);}");
    expect(depthResolveWgsl(4)).toContain("if(d>0.0){sum+=u.depthTerms.y/(d-u.depthTerms.x);}");
    expect(text).toContain("select(1.0/LINE_SKY,4.0/max(sum,1e-6),sum>0.0)");
    expect(text).toContain("let second=wl+wr+wd+wu-4.0*wc;");
    expect(text).toContain("let largest=max(max(max(wl,wr),max(wd,wu)),wc);");
    expect(text).toContain("smoothstep(u.finishLineBand.x*reach.x,u.finishLineBand.y*reach.x,abs(second)/largest)*reach.y");
    expect(text).toContain("mix(c.rgb,c.rgb*u.finishLine.xyz,lineEdge(at)*u.finishLine.w)");
    // The distance's thinning: the logarithm of the nearest reading's distance between the two ends, eased, and the same in both.
    for (const same of ["fn lineReach(largest:f32)->vec2<f32>{", "log2(1.0/max(largest,1e-9)/far.x)/max(log2(far.y/far.x),1e-4)", "return vec2<f32>(pow(far.z,t),mix(1.0,far.w,t));"]) {
      expect(text).toContain(same);
      expect(farSoftWgsl(true)).toContain(same);
    }
    // The sky's reading is 1 over 100000 in both, so a ridge against it is measured at the ridge's own distance.
    expect(text).toContain("const LINE_SKY:f32=100000.0;");
    expect(FAR_SOFT_WGSL).toContain("const FAR_SOFT_SKY:f32=100000.0;");
    // The same measure as the far softening's, line for line.
    const chain = farSoftWgsl(true);
    for (const same of ["let second=wl+wr+wd+wu-4.0*wc;", "let largest=max(max(max(wl,wr),max(wd,wu)),wc);", "let reach=lineReach(largest);", "smoothstep(u.finishLineBand.x*reach.x,u.finishLineBand.y*reach.x,abs(second)/largest)*reach.y"]) {
      expect(chain).toContain(same);
    }
  });

  it("makes no line pass for a look with no line: the renderer asks first", () => {
    const renderer = sourceText("game/lite/renderer.ts");
    expect(renderer).toContain("line = lineOnTier(chained, look.finish) ? createLiteLineOnly(");
    expect(renderer).toContain(": null;\n      const sceneTask = createRenderTask(");
    expect(renderer).toContain("if (line !== null) addTask(scene, line.task);");
    expect(renderer).toContain("if (line !== null) await line.ready;");
  });

  it("breaks the no-chain tier's scene pass only where the game's side asks, and makes the water's read-through no more the tier's", () => {
    const renderer = sourceText("game/lite/renderer.ts");
    // The task is the same one; the break is enabled on it only for a side that keeps the frame, before it is added to the scene.
    expect(renderer).toContain("if (side.keepsFrame === true) sceneKept = enableRenderTaskBreak(sceneTask, engine, { depth: true, keep: true });");
    expect(renderer.indexOf("sceneKept = enableRenderTaskBreak(")).toBeLessThan(renderer.indexOf("addTask(scene, sceneTask);"));
    expect(renderer).toContain("...(side.keepsFrame === true ? { kept: () => sceneKept } : {})");
    // What is kept is handed to the game's parts as the chain's is, and the water reads it on the high tier alone.
    expect(renderer).toContain("const keptFrame = chain === null ? sceneKept : chain.kept;");
    expect(renderer).toContain('const behind = tier === "high" ? frameBehind : undefined;');
    expect(renderer).toContain("waterThrough = behind !== undefined;");
  });

  it("builds the line-only pass's text as it was where the look does not draw the line through (the comment lines aside)", () => {
    const stripped = (text: string): string => text.split("\n").filter((l) => !l.startsWith("//")).join("\n");
    // The pass's text before the field, without its comment lines, by its hash: the text with the slots filled as an unset look fills them.
    const was = "ca5d0243161a4ac767246857e753211699a5ad84ceb634707932a04ee80f4fc4";
    expect(createHash("sha256").update(stripped(lineOnlyWgsl(4))).digest("hex")).toBe(was);
    expect(createHash("sha256").update(stripped(lineOnlyWgsl(4, false))).digest("hex")).toBe(was);
    expect(lineOnlyWgsl(4)).not.toContain("keptDepth");
    expect(lineOnlyWgsl(4)).not.toContain("${");
    expect(lineOnlyWgsl(4)).toContain("lineEdge(at)*u.finishLine.w)");
  });

  it("runs the same through rule in the line-only pass, with reads of its own", () => {
    const text = lineOnlyWgsl(4, true);
    expect(text).not.toContain("${");
    // The rule is the chain's text, byte for byte.
    const core = wgsl(sourceText("game/shaders/post/finishLineThroughCore.wgsl"));
    expect(text).toContain(core);
    expect(farSoftWgsl(true, true)).toContain(core);
    // This pass's reads: the kept depth as binding 3, the whole pass's depth sample 0 from the binding it has, and the alpha of the colour it reads.
    expect(text).toContain("@group(0)@binding(3)var keptDepth:texture_2d<f32>;");
    expect(text).toContain("return textureLoad(sceneDepth,at,0)>textureLoad(keptDepth,at,0).r;");
    expect(text).toContain("return textureLoad(sceneColour,at,0).a;");
    expect(text).toContain("return 1.0/select(LINE_SKY,u.depthTerms.y/(d-u.depthTerms.x),d>0.0);");
    expect(text).toContain("mix(c.rgb,c.rgb*u.finishLine.xyz,lineSeen(at)*u.finishLine.w)");
    expect(text).not.toContain("lineEdge(at)*u.finishLine.w)");
    // The plain line's code stands as it was (the new code is laid after the sky's constant, and WGSL takes its functions in any order).
    expect(text).toContain("fn lineEdge(at:vec2<i32>)->f32{");
    expect(text).toContain("fn lineInverse(at:vec2<i32>)->f32{");
    // The uniforms: the plain pass's record and layout are as they were, and the through pass's has the break's flag after them.
    const finish: LookFinish = { ...NO_FINISH, line: 0.6 };
    expect(Object.keys(lineOnlyUniforms(finish))).toEqual(["finishLine", "finishLineBand", "depthTerms", "finishLineFar"]);
    expect(Object.keys(lineOnlyUniforms(finish, [0, 0], true))).toEqual(["finishLine", "finishLineBand", "depthTerms", "finishLineFar", "lineKept"]);
    expect(passLayout(lineOnlyUniforms(finish, [0, 0], true)).struct).toBe("struct U{finishLine:vec4<f32>,finishLineBand:vec2<f32>,depthTerms:vec2<f32>,finishLineFar:vec4<f32>,lineKept:f32}");
    // The pass asks for the break where the renderer gives it, and writes whether the frame broke when it is recorded.
    const only = sourceText("game/lite/lineOnly.ts");
    expect(only).toContain("const through = options.kept !== undefined && finishDrawsLineThrough(finish, true);");
    expect(only).toContain("lineOnlyWgsl(options.sampleCount, through)");
    expect(only).toContain("record.lineKept[0] = kept.breaks !== breaksSeen ? 1 : 0;");
    expect(only).toContain("...(keptDepth === null ? [] : [{ binding: 3, resource: keptDepth }]),");
  });

  it("puts the finish's code in a shader only where it is asked for", () => {
    const line = farSoftWgsl(true);
    expect(line).toContain("fn finishLine(");
    expect(line).toContain("smoothstep(u.finishLineBand.x*reach.x,u.finishLineBand.y*reach.x,");
    expect(line).toContain("col=finishLine(vUV,col);");
    for (const halation of [true, false]) {
      const grade = gradeWgsl(halation, true);
      expect(grade).toContain("u.finishGrade.z");
      expect(grade.indexOf("finishShown=finishShown*mix(")).toBeLessThan(grade.indexOf("u.finishGrade.x"));
      expect(grade.indexOf("u.finishGrade.x")).toBeLessThan(grade.indexOf("u.finishGrade.y"));
      expect(grade.indexOf("u.finishGrade.y")).toBeLessThan(grade.indexOf("shown+=(d1+d2-1.0)*DITHER_LSB;"));
      expect(grade.indexOf("let pixel=vUV/u.texelSize;")).toBeLessThan(grade.indexOf("var finishShown"));
    }
  });

  it("draws the line on what shows through marked surfaces only where the look asks, the look draws a line and the chain keeps the frame", () => {
    const line: LookFinish = { ...NO_FINISH, line: 0.6 };
    expect(NO_FINISH.lineThrough).toBeUndefined();
    expect(finishDrawsLineThrough(line, true)).toBe(false);
    expect(finishDrawsLineThrough({ ...line, lineThrough: false }, true)).toBe(false);
    expect(finishDrawsLineThrough({ ...line, lineThrough: true }, true)).toBe(true);
    // No frame kept (the tiers below, and a chain that does not break its pass): the line is the depth's alone.
    expect(finishDrawsLineThrough({ ...line, lineThrough: true }, false)).toBe(false);
    // And no line, nothing to draw through.
    expect(finishDrawsLineThrough({ ...NO_FINISH, lineThrough: true }, true)).toBe(false);
    // The tier with no chain draws its line as it always did, whatever the look says.
    expect(lineOnTier(false, { ...line, lineThrough: true })).toBe(true);
    expect(lineOnlyWgsl(4)).not.toContain("keptDepth");
  });

  it("builds the far softening's text as it was where the look does not draw the line through", () => {
    const farSoft = wgsl(sourceText("game/shaders/post/farSoft.fragment.wgsl"));
    const lineText = wgsl(sourceText("game/shaders/post/finishLine.wgsl"));
    // The text a look with a line had before the field: the line's functions after the constants and its call after the cloud.
    const before = fill(farSoft, { lineFunctions: `\n${lineText}`, lineCall: "\n  col=finishLine(vUV,col);" });
    expect(farSoftWgsl(true)).toBe(before);
    expect(farSoftWgsl(true, false)).toBe(before);
    expect(farSoftWgsl(false)).toBe(fill(farSoft, { lineFunctions: "", lineCall: "" }));
    // With no line there is nothing to draw through.
    expect(farSoftWgsl(false, true)).toBe(FAR_SOFT_WGSL);
    for (const text of [before, FAR_SOFT_WGSL]) {
      expect(text).not.toContain("keptDepth");
      expect(text).not.toContain("wholeDepth");
      expect(text).not.toContain("lineKept");
      expect(text).not.toContain("@binding(6)");
    }
  });

  it("reads the depth the first half left and the whole pass's where the look draws the line through", () => {
    const text = farSoftWgsl(true, true);
    const plain = farSoftWgsl(true, false);
    expect(text).not.toContain("${");
    // The plain line's functions stand as they were, and the new code is laid after them; the call is the new one's.
    expect(text).toContain(wgsl(sourceText("game/shaders/post/finishLine.wgsl")));
    expect(text).toContain("fn finishLine(uv:vec2<f32>,col:vec3<f32>)->vec3<f32>{");
    expect(text).toContain("col=finishLineThrough(vUV,col);");
    expect(text).not.toContain("col=finishLine(vUV,col);");
    expect(text.indexOf("fn lineSeen(")).toBeGreaterThan(text.indexOf("fn lineEdge("));
    expect(text.indexOf("fn lineHidden(")).toBeLessThan(text.indexOf("fn lineSeen("));
    // Two textures more, after the pass's six: the kept depth is read by pixel, as r32float must be, and the whole pass's depth by its sample.
    expect(text).toContain("@group(0)@binding(6)var keptDepth:texture_2d<f32>;");
    expect(text).toContain("@group(0)@binding(7)var wholeDepth:texture_depth_multisampled_2d;");
    expect(text).not.toContain("textureSample(keptDepth");
    expect(text).not.toContain("textureSampleLevel(keptDepth");
    expect(text).toContain("textureLoad(wholeDepth,at,0)>textureLoad(keptDepth,at,0).r");
    // The kept depth's distance is made as the depth's resolve makes it, the sky as the line reads it.
    expect(text).toContain("return 1.0/select(FAR_SOFT_SKY,u.depthTerms.y/(d-u.depthTerms.x),d>0.0);");
    expect(depthResolveWgsl(4)).toContain("u.depthTerms.y/(d-u.depthTerms.x)");
    // The same measure on it, the same band and reach as the line's own.
    for (const same of ["let reach=lineReach(largest);", "smoothstep(u.finishLineBand.x*reach.x,u.finishLineBand.y*reach.x,abs(second)/largest)*reach.y"]) {
      expect(text.split(same).length).toBe(3);
    }
    // A frame that did not break, a pixel with no tap through, and the border leave the line as lineEdge makes it.
    expect(text).toContain("if(u.lineKept<0.5){return edge;}");
    expect(text).toContain("if(!seen){return edge;}");
    // What a surface hides is its alpha in the scene's colour, at the nearest tap if that tap is through; the line is the larger of the two.
    expect(text).toContain("if(inverse[i]>inverse[nearest]){nearest=i;}");
    expect(text).toContain("keep=1.0-clamp(lineTapAlpha(taps[nearest]),0.0,1.0);");
    expect(text).toContain("fn lineTapAlpha(at:vec2<i32>)->f32{\n  return textureLoad(textureSampler,at,0).a;");
    expect(text).toContain("return max(edge,hidden*keep);");
    // Bigger by that code alone.
    expect(text.length).toBeGreaterThan(plain.length);
    expect(text.startsWith(plain.slice(0, plain.indexOf("fn farDepth(")))).toBe(true);
  });

  it("lays the far softening's uniforms out with the depth's two terms and the break flag after the line's own, where the line is drawn through", () => {
    const base = { ...emptyFarSoftUniforms(), atmSunDir: [0, 0, 0], atmSunColour: [0, 0, 0], finishLine: [0, 0, 0, 0], finishLineBand: [0, 0], finishLineFar: [0, 0, 0, 0] };
    const plain = passLayout(base);
    const through = passLayout({ ...base, depthTerms: [0, 0], lineKept: [0] });
    expect([...through.offsets.keys()].slice(0, plain.offsets.size)).toEqual([...plain.offsets.keys()]);
    for (const [name, at] of plain.offsets) expect(through.offsets.get(name)).toBe(at);
    expect([...through.offsets.keys()].slice(-2)).toEqual(["depthTerms", "lineKept"]);
    expect(through.struct).toContain("depthTerms:vec2<f32>,lineKept:f32}");
    expect(through.bytes).toBeLessThanOrEqual(512);
    // The chain asks for it where the look does and the frame is kept, and writes whether this frame broke where the chain's pass is recorded.
    const chain = sourceText("game/lite/postChain.ts");
    expect(chain).toContain("const lineThrough = kept !== null && finishDrawsLineThrough(look.finish, true);");
    expect(chain).toContain("farSoftWgsl(finishDrawsLine(look.finish), lineThrough)");
    expect(chain).toContain("...(lineThrough ? { depthTerms: [0, 0], lineKept: [0] } : {}),");
    expect(chain).toContain("const broke = kept.breaks !== breaksSeen;");
    expect(chain).toContain("...(keptDepth === null ? [] : [keptDepth, depthSamples])");
  });

  it("has no grades by default, and then reads none: the caller keeps the one palette and gain", () => {
    expect(ENGINE_LOOK.grades).toEqual([]);
    expect(lookGradeAt(ENGINE_LOOK, 12, 0.5)).toBeNull();
    expect(lookGradeAt(gameLook({ exposure: 1.5 }), 3, 1)).toBeNull();
  });

  it("wears the grade the sun's height asks for: the first and the last past either end, the two between mixed", () => {
    const dark = { ...PAINT_OILS, contrast: 1.5 };
    const night: LookGrade = { sun: -0.5, palette: dark, exposure: 2, overcast: 4 };
    const day: LookGrade = { sun: 0.5, palette: PAINT_OILS, exposure: 1, overcast: 3 };
    const look = gameLook({ grades: [night, day] });
    // Midnight is under the first, noon over the last.
    expect(lookGradeAt(look, 0, 0)).toEqual({ palette: dark, exposure: 2 });
    expect(lookGradeAt(look, 12, 0)).toEqual({ palette: PAINT_OILS, exposure: 1 });
    // Sunset, the sun on the horizon, is half way between the two.
    const sunset = lookGradeAt(look, 18, 0);
    const half = (sunPositionAt(18).y + 0.5) / 1;
    expect(half).toBeCloseTo(0.5, 6);
    expect(sunset?.exposure).toBeCloseTo(1.5, 6);
    expect(sunset?.palette).toEqual(mixPalette(dark, PAINT_OILS, half));
  });

  it("takes the gain from clear to overcast by the cloud's cover, held to 0 and 1", () => {
    const look = gameLook({ grades: [{ sun: 0, palette: PAINT_OILS, exposure: 1, overcast: 3 }] });
    expect(lookGradeAt(look, 12, 0)?.exposure).toBe(1);
    expect(lookGradeAt(look, 12, 0.25)?.exposure).toBeCloseTo(1.5, 6);
    expect(lookGradeAt(look, 12, 1)?.exposure).toBe(3);
    expect(lookGradeAt(look, 12, 7)?.exposure).toBe(3);
    expect(lookGradeAt(look, 12, -2)?.exposure).toBe(1);
  });

  it("pulls the ground under the grass to the engine's own floor by default, and to a game's where it gives one", () => {
    expect(ENGINE_LOOK.sward).toEqual({ floor: [SWARD_FLOOR.r, SWARD_FLOOR.g, SWARD_FLOOR.b], pull: SWARD_MAX });
    const none = emptyTerrainUniforms();
    const own = emptyTerrainUniforms();
    const base = { eye: null, wetness: 0, rain: 0, seconds: 0, sward: true, relief: true, road: null, trail: null, features: null };
    terrainUniforms(base, none);
    // The engine's look hands the terrain what it reads with no look at all.
    const engine = emptyTerrainUniforms();
    terrainUniforms({ ...base, swardLook: ENGINE_LOOK.sward }, engine);
    expect(Array.from(engine.terrainSward)).toEqual(Array.from(none.terrainSward));
    terrainUniforms({ ...base, swardLook: { floor: [0.031, 0.041, 0.013], pull: 1 } }, own);
    expect(Array.from(own.terrainSward)).toEqual([0.031, 0.041, 0.013, 1]);
    // Where the blades are not drawn there is no pull, whatever the look.
    terrainUniforms({ ...base, sward: false, swardLook: { floor: [0.031, 0.041, 0.013], pull: 1 } }, own);
    expect(own.terrainSward[3]).toBe(0);
  });

  it("names nothing of Babylon.js", () => {
    expect(sourceText("game/gameLook.ts")).not.toMatch(/@babylonjs/);
  });
});
