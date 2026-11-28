"use strict";

/**
 * gifski 分块抽 RGBA：每块 = 整窗 fps 网格（多段走分段采样）上的帧号 [A, A+N)。
 * 旧实现块头按时间 trim=start=块起点：块起点前开始、仍在显示的那一帧被整帧丢掉，
 * VFR 静帧一丢几秒（手机长片强压分块 ×72 时，删中间后 GIF 比预览短且后段画面提前）。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const shared = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "10-shared-encode.js"),
  "utf8"
);
const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
  n += 1;
}

function fnSrc(name) {
  const m = shared.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n      \\}`));
  assert.ok(m, `缺 ${name}`);
  return m[0];
}

const buildSrc = (() => {
  const m = shared.match(/const buildRawArgs = \([\s\S]*?\n {10}\};/);
  assert.ok(m, "缺 buildRawArgs");
  return m[0];
})();

/** 在与 encode 闭包同名的变量环境里求 buildRawArgs */
function makeBuild({
  segmentSpans,
  exportedEdit,
  exactKeepFrames = false,
  encodeSs,
  encodeT,
  fps = 15,
  speed = 1,
}) {
  const box = {};
  // 与 10-shared-encode encodeV2gGifGifski 一致：导出片不再分段采样
  const useSeg =
    encodeSs <= 0.001 &&
    !exportedEdit &&
    !exactKeepFrames &&
    Array.isArray(segmentSpans) &&
    segmentSpans.length > 1;
  const src = `
${fnSrc("vbbEncodeHardTrimFilters")}
${fnSrc("vbbEncodeOutTrimFilters")}
${fnSrc("vbbEncodeSegmentedFpsFilter")}
const opts = ${JSON.stringify({ segmentSpans, exportedEdit, exactKeepFrames })};
const speed = ${speed};
const fps = ${fps};
const cropFilter = "";
const outW = 420;
const outH = 194;
const brightFilter = "";
const DENOISE = "hqdn3d=1.5:1.5:6:6,";
const wmBytes = null;
let encodeSs = ${encodeSs};
let encodeT = ${encodeT};
const useSegmentedSk = ${useSeg};
const seg0 = useSegmentedSk ? vbbEncodeSegmentedFpsFilter(opts.segmentSpans, speed, fps, cropFilter) : null;
let frameCount = seg0 ? seg0.frameCount : Math.ceil((encodeT / speed) * fps - 1e-6);
${buildSrc}
this.build = buildRawArgs;
this.frameCount = frameCount;
`;
  vm.runInNewContext(src, box);
  return box;
}

const graphOf = (args) => {
  const i = args.indexOf("-filter_complex");
  return String(args[(i >= 0 ? i : args.indexOf("-vf")) + 1]);
};

t("多段导出片：走整窗全局 fps（禁止再按 segmentSpans 切，避免 concat 漂移）", () => {
  const { build, frameCount } = makeBuild({
    segmentSpans: [4, 6.9, 5.9, 6.9, 3.86],
    exportedEdit: true,
    encodeSs: 0,
    encodeT: 27.56,
  });
  assert.strictEqual(frameCount, Math.ceil(27.56 * 15 - 1e-6));
  const whole = graphOf(build(false, frameCount, 0));
  const c5 = graphOf(build(false, 72, 288));
  assert.ok(!whole.includes("concat="), `导出片勿再分段 concat：${whole}`);
  assert.ok(!whole.includes("[vseg]"), whole);
  assert.ok(!/trim=start=[0-9]/.test(c5.replace(/trim=start_frame/g, "TRIMFRAME")), `块头勿按时间切：${c5}`);
  assert.ok(
    c5.includes("fps=15:round=up,") && c5.includes("trim=start_frame=288:end_frame=360,setpts=PTS-STARTPTS,"),
    `块须按全局帧号取：${c5}`
  );
});

t("未导出多段：仍可分段采样（源片按 span 切）", () => {
  const { build, frameCount } = makeBuild({
    segmentSpans: [4, 6.9, 5.9],
    exportedEdit: false,
    encodeSs: 0,
    encodeT: 16.8,
  });
  assert.ok(frameCount >= 4 + 6.9 + 5.9);
  const whole = graphOf(build(false, frameCount, 0));
  assert.ok(whole.includes("concat=n=3:v=1:a=0[vseg]"), whole);
});

t("源码：导出片 useSegmentedSk / useSegmented 须排除 exportedEdit", () => {
  assert.ok(shared.includes("!opts.exportedEdit"));
  assert.ok(shared.includes("!opts.exactKeepFrames"));
  const sk = shared.slice(
    shared.indexOf("const useSegmentedSk ="),
    shared.indexOf("const useSegmentedSk =") + 280
  );
  assert.ok(sk.includes("!opts.exportedEdit"), sk);
  const ff = shared.slice(
    shared.indexOf("const useSegmented ="),
    shared.indexOf("const useSegmented =") + 320
  );
  assert.ok(ff.includes("!opts.exportedEdit"), ff);
});

t("单段导出片：整窗 fps 网格 → 帧号取块；块头禁止按时间 trim=start", () => {
  const { build, frameCount } = makeBuild({
    segmentSpans: [27.5],
    exportedEdit: true,
    encodeSs: 0,
    encodeT: 27.5,
  });
  const whole = graphOf(build(false, frameCount, 0));
  const c3 = graphOf(build(false, 72, 144));
  assert.ok(!whole.includes("start_frame"), whole);
  assert.ok(!/trim=start=/.test(c3), `块头勿按时间切：${c3}`);
  assert.ok(c3.includes("fps=15:round=up,trim=start_frame=144:end_frame=216,setpts=PTS-STARTPTS,"), c3);
  assert.ok(c3.indexOf("fps=15") < c3.indexOf("start_frame"), "须先出整窗网格再取帧号");
});

t("旧路径（未导出、窗起点>0）：各块时间窗都按整窗起点，与首块一致", () => {
  const { build } = makeBuild({ segmentSpans: [10], exportedEdit: false, encodeSs: 3, encodeT: 10 });
  const c1 = graphOf(build(false, 72, 0));
  const c2 = graphOf(build(false, 72, 72));
  assert.ok(c1.includes("trim=start=3:end=12.999"), c1);
  assert.ok(c2.includes("trim=start=3:end=12.999"), `第 2 块仍须从整窗起点出网格：${c2}`);
  assert.ok(c2.includes("trim=start_frame=72:end_frame=144"), c2);
  const head = (g) => g.slice(0, g.indexOf("fps=15:round=up"));
  assert.strictEqual(head(c2), head(c1));
});

t("encodeChunk 调用：传块起始帧号，不再传块起点时间", () => {
  assert.ok(shared.includes("buildRawArgs(useDenoise, chunkFrames, chunkStartFrame)"));
  assert.ok(shared.includes("buildRawArgs(false, chunkFrames, chunkStartFrame)"));
  assert.ok(!/buildRawArgs\([^)]*ptsStart/.test(shared), "禁止再把块起点时间喂给 buildRawArgs");
  assert.ok(!buildSrc.includes("ptsStart"), "buildRawArgs 内禁止按块起点时间切");
  assert.ok(!buildSrc.includes("nMax >= frameCount - 1"), "勿再「仅首块走分段」");
});

t("分块 demux -t 盖整窗尾（不能只盖到块尾）", () => {
  assert.ok(
    shared.includes("输入 -t 必须盖整窗") || shared.includes("必须盖到整窗尾") || shared.includes("盖到整窗尾"),
    "注释须写明根因"
  );
  // 旧写法：块尾 ptsStart+dur / 首块仅 dur → 后块 start_frame 超出已解帧
  const chunkBody = shared.slice(
    shared.indexOf("const encodeChunk = async"),
    shared.indexOf("let blob;\n          let actualFrames;")
  );
  assert.ok(chunkBody.includes("inputLimitSec"));
  assert.ok(chunkBody.includes('"-t", String(inputLimitSec)'));
  assert.ok(chunkBody.includes("encodeSs + encodeT + 0.05"));
  assert.ok(!/baseArgs\.push\(\s*"-t",\s*String\(ptsStart/.test(chunkBody));
});

t("已导出编辑片：gifski/ffmpeg 两条路径都禁止 wantSeg 再抽", () => {
  const hits = [...shared.matchAll(/const wantSeg =\s*([\s\S]*?);/g)];
  assert.ok(hits.length >= 2, `wantSeg 定义数=${hits.length}`);
  for (const m of hits) {
    assert.ok(m[1].includes("!opts.exportedEdit"), m[1].slice(0, 200));
    assert.ok(m[1].includes("!opts.exactKeepFrames"), m[1].slice(0, 200));
  }
});

t("物化上报：记录方法/上报/采用时长，诊断可直接看出截短", () => {
  assert.ok(vbb.includes("[vbb-mat]"));
  const block = vbb.slice(vbb.indexOf("const finishMat = async"), vbb.indexOf("const ffFirst"));
  assert.ok(block.includes("vbbMaterializedKeepDuration(out.duration, keepSpan, duration)"));
});

console.log(`vbb-gif-chunk-frames.test.js: ${n} passed`);
