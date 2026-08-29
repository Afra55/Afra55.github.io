#!/usr/bin/env node
/**
 * 从 remvze/moodist 元数据生成 catalog，下载音频与 Wikimedia 封面。
 * 运行：node scripts/build-ambient-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tools/assets/ambient");
const MOODIST_RAW = "https://raw.githubusercontent.com/remvze/moodist/main";
const OPENVERSE_API = "https://api.openverse.org/v1/images/";
const UA = "Afra55-devtools/1.0 (https://github.com/Afra55/Afra55.github.io; ambient-build)";

const CATEGORY_ZH = {
  nature: "自然",
  rain: "雨声",
  animals: "动物",
  urban: "城市",
  places: "场所",
  transport: "交通",
  things: "物品",
  noise: "噪音",
  binaural: "双耳节拍",
};

const CATEGORY_ICONS = {
  nature: "fa6:tree",
  rain: "bi:cloud-rain-fill",
  animals: "fa6:dog",
  urban: "fa6:city",
  places: "mdi:map-marker",
  transport: "fa6:car-side",
  things: "mdi:robot-happy",
  noise: "bi:soundwave",
  binaural: "tabler:wave-sine",
};

/** react-icons 组件名 → Iconify id（尽量对齐 Moodist 原版图标集） */
const RI_TO_ICONIFY = {
  PiBirdFill: "ph:bird-fill",
  GiSeagull: "game-icons:seagull",
  GiCricket: "game-icons:cricket",
  GiWolfHead: "game-icons:wolf-head",
  GiOwl: "game-icons:owl",
  FaFrog: "fa6:frog",
  PiDogBold: "ph:dog-fill",
  FaDog: "fa6:dog",
  FaHorseHead: "fa6:horse-head",
  FaCat: "fa6:cat",
  FaCrow: "fa6:crow",
  GiWhaleTail: "game-icons:whale-tail",
  GiTreeBeehive: "game-icons:beehive",
  GiEgyptianBird: "game-icons:woodpecker",
  GiChicken: "game-icons:chicken",
  GiCow: "game-icons:cow",
  GiSheep: "game-icons:sheep",
  BiSolidTree: "bi:tree-fill",
  BiWater: "bi:water",
  FaWater: "fa6:water",
  BsFire: "bi:fire",
  FaWind: "fa6:wind",
  GiWaterfall: "game-icons:waterfall",
  FaRegSnowflake: "fa6:snowflake",
  FaLeaf: "fa6:leaf",
  GiStonePile: "game-icons:stone-pile",
  BsFillDropletFill: "bi:droplet-fill",
  FaTree: "fa6:tree",
  BsFillCloudRainFill: "bi:cloud-rain-fill",
  BsFillCloudRainHeavyFill: "bi:cloud-rain-heavy-fill",
  MdOutlineThunderstorm: "mdi:weather-lightning",
  GiWindow: "game-icons:window",
  FaCarSide: "fa6:car-side",
  BsUmbrellaFill: "bi:umbrella-fill",
  PiTentFill: "ph:tent-fill",
  BiSolidTraffic: "bi:traffic-cone",
  FaCity: "fa6:city",
  FaRoad: "fa6:road",
  PiRoadHorizonFill: "ph:road-horizon-fill",
  PiSirenBold: "ph:siren-fill",
  BsSoundwave: "bi:soundwave",
  BsPeopleFill: "bi:people-fill",
  RiSparkling2Fill: "ri:sparkling-2-fill",
  BiSolidCoffeeAlt: "bi:cup-hot-fill",
  BiSolidPlaneAlt: "bi:airplane-fill",
  FaChurch: "fa6:church",
  MdTempleBuddhist: "mdi:temple-buddhist",
  MdConstruction: "mdi:hard-hat",
  TbScubaMask: "tabler:scuba-mask",
  TbBeerFilled: "tabler:beer-filled",
  GiVillage: "game-icons:village",
  FaSubway: "fa6:train-subway",
  HiOfficeBuilding: "heroicons:building-office-2-solid",
  FaShoppingBasket: "fa6:basket-shopping",
  GiCarousel: "game-icons:carousel",
  AiFillExperiment: "bi:beaker-fill",
  BiSolidDryer: "bi:wind",
  IoRestaurant: "io5:restaurant",
  FaBookOpen: "fa6:book-open",
  BiSolidTrain: "bi:train-front-fill",
  GiSubmarine: "game-icons:submarine",
  GiSailboat: "game-icons:sailboat",
  TbSailboat: "tabler:sailboat",
  GiWindchimes: "game-icons:windchimes",
  BsFillKeyboardFill: "bi:keyboard-fill",
  FaKeyboard: "fa6:keyboard",
  RiFilePaper2Fill: "ri:file-paper-2-fill",
  FaClock: "fa6:clock",
  TbBowlFilled: "tabler:bowl-filled",
  FaFan: "fa6:fan",
  GiFilmProjector: "game-icons:film-projector",
  MdWaterDrop: "mdi:water-boiler",
  RiBubbleChartFill: "ri:bubble-chart-fill",
  MdRadio: "mdi:radio",
  IoIosRadio: "ion:radio",
  GiWashingMachine: "game-icons:washing-machine",
  PiVinylRecord: "ph:vinyl-record-fill",
  TbWiper: "tabler:wiper-wash",
  GiSoundWaves: "game-icons:sound-waves",
  TbWaveSine: "tabler:wave-sine",
  MdSmartToy: "mdi:robot-happy",
};

const NAME_ZH = {
  birds: "鸟鸣",
  seagulls: "海鸥",
  crickets: "蟋蟀",
  wolf: "狼嚎",
  owl: "猫头鹰",
  frog: "青蛙",
  "dog-barking": "狗叫",
  "horse-gallop": "马蹄",
  "cat-purring": "猫呼噜",
  crows: "乌鸦",
  whale: "鲸鱼",
  beehive: "蜂巢",
  woodpecker: "啄木鸟",
  chickens: "鸡叫",
  cows: "牛鸣",
  sheep: "羊叫",
  river: "河流",
  waves: "海浪",
  campfire: "篝火",
  wind: "风声",
  "howling-wind": "呼啸风",
  "wind-in-trees": "林间风",
  waterfall: "瀑布",
  "walk-in-snow": "踏雪",
  "walk-on-leaves": "踏叶",
  "walk-on-gravel": "踏碎石",
  droplets: "水滴",
  jungle: "丛林",
  "light-rain": "小雨",
  "heavy-rain": "大雨",
  thunder: "雷声",
  "rain-on-window": "窗上雨",
  "rain-on-car-roof": "车顶雨",
  "rain-on-umbrella": "伞上雨",
  "rain-on-tent": "帐篷雨",
  "rain-on-leaves": "叶上雨",
  highway: "高速公路",
  road: "公路",
  "ambulance-siren": "救护车",
  "busy-street": "繁忙街道",
  crowd: "人群",
  traffic: "交通",
  fireworks: "烟花",
  cafe: "咖啡馆",
  airport: "机场",
  church: "教堂",
  temple: "寺庙",
  "construction-site": "工地",
  underwater: "水下",
  "crowded-bar": "酒吧",
  "night-village": "夜晚村落",
  "subway-station": "地铁站",
  office: "办公室",
  supermarket: "超市",
  carousel: "旋转木马",
  laboratory: "实验室",
  "laundry-room": "洗衣房",
  restaurant: "餐厅",
  library: "图书馆",
  train: "火车",
  "inside-a-train": "车厢内",
  airplane: "飞机",
  submarine: "潜艇",
  sailboat: "帆船",
  "rowing-boat": "划艇",
  keyboard: "键盘",
  typewriter: "打字机",
  paper: "纸张",
  clock: "钟表",
  "wind-chimes": "风铃",
  "singing-bowl": "颂钵",
  "ceiling-fan": "吊扇",
  dryer: "烘干机",
  "slide-projector": "幻灯机",
  "boiling-water": "沸水",
  bubbles: "气泡",
  "tuning-radio": "调频收音机",
  "morse-code": "摩斯电码",
  "washing-machine": "洗衣机",
  "vinyl-effect": "黑胶",
  "windshield-wipers": "雨刷",
  "white-noise": "白噪音",
  "pink-noise": "粉噪音",
  "brown-noise": "棕噪音",
  "binaural-delta": "Delta 节拍",
  "binaural-theta": "Theta 节拍",
  "binaural-alpha": "Alpha 节拍",
  "binaural-beta": "Beta 节拍",
  "binaural-gamma": "Gamma 节拍",
};

const IMAGE_QUERY = {
  birds: "songbird nature",
  seagulls: "seagull beach",
  crickets: "cricket insect",
  wolf: "wolf howling",
  owl: "owl forest",
  frog: "frog pond",
  "dog-barking": "dog barking",
  "horse-gallop": "horse running",
  "cat-purring": "cat sleeping",
  crows: "crow bird",
  whale: "whale ocean",
  beehive: "beehive honey",
  woodpecker: "woodpecker tree",
  chickens: "chicken farm",
  cows: "cow pasture",
  sheep: "sheep meadow",
  river: "river stream",
  waves: "ocean waves",
  campfire: "campfire night",
  wind: "wind grass",
  "howling-wind": "storm wind",
  "wind-in-trees": "forest trees wind",
  waterfall: "waterfall",
  "walk-in-snow": "footsteps snow",
  "walk-on-leaves": "autumn leaves forest",
  "walk-on-gravel": "gravel path",
  droplets: "water droplet",
  jungle: "jungle rainforest",
  "light-rain": "light rain",
  "heavy-rain": "heavy rain storm",
  thunder: "lightning storm",
  "rain-on-window": "rain window",
  "rain-on-car-roof": "rain car",
  "rain-on-umbrella": "umbrella rain",
  "rain-on-tent": "tent camping rain",
  "rain-on-leaves": "rain leaves",
  highway: "highway traffic",
  road: "city road",
  "ambulance-siren": "ambulance",
  "busy-street": "busy street crowd",
  crowd: "crowd people",
  traffic: "traffic jam",
  fireworks: "fireworks night",
  cafe: "coffee shop interior",
  airport: "airport terminal",
  church: "church building",
  temple: "buddhist temple",
  "construction-site": "construction site",
  underwater: "underwater coral",
  "crowded-bar": "bar pub",
  "night-village": "village night",
  "subway-station": "subway station",
  office: "office workspace",
  supermarket: "supermarket",
  carousel: "carousel amusement",
  laboratory: "science laboratory",
  "laundry-room": "laundry room",
  restaurant: "restaurant dining",
  library: "library books",
  train: "train railway",
  "inside-a-train": "train interior",
  airplane: "airplane cabin",
  submarine: "submarine",
  sailboat: "sailboat sea",
  "rowing-boat": "rowing boat lake",
  keyboard: "mechanical keyboard",
  typewriter: "typewriter vintage",
  paper: "paper writing",
  clock: "wall clock",
  "wind-chimes": "wind chimes",
  "singing-bowl": "singing bowl",
  "ceiling-fan": "ceiling fan",
  dryer: "clothes dryer",
  "slide-projector": "film projector",
  "boiling-water": "kettle boiling",
  bubbles: "soap bubbles",
  "tuning-radio": "vintage radio",
  "morse-code": "telegraph morse",
  "washing-machine": "washing machine",
  "vinyl-effect": "vinyl record",
  "windshield-wipers": "windshield wiper rain",
  "white-noise": "abstract white noise",
  "pink-noise": "abstract pink gradient",
  "brown-noise": "abstract brown texture",
  "binaural-delta": "meditation sleep",
  "binaural-theta": "meditation calm",
  "binaural-alpha": "meditation focus",
  "binaural-beta": "brain focus",
  "binaural-gamma": "brain waves abstract",
};

function fixNameZh(id, label) {
  if (NAME_ZH[id]) return NAME_ZH[id];
  if (id === "walk-on-gravel") return "踏碎石";
  return label;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function parseCategoryFile(text, catId) {
  const catIconMatch = text.match(/export const \w+: Category = \{\s*icon: <(\w+) \/>/);
  const catIcon = catIconMatch?.[1] || "";
  const sounds = [];
  const re = /icon: <(\w+) \/>,\s*id: '([^']+)',\s*label: '([^']+)',\s*src: getAssetPath\('([^']+)'\)/g;
  let m;
  while ((m = re.exec(text))) {
    sounds.push({ icon: m[1], id: m[2], label: m[3], src: m[4] });
  }
  return { catId, catIcon, sounds };
}

async function fetchCoverImage(query) {
  const params = new URLSearchParams({
    q: query,
    page_size: "1",
    license: "cc0,pdm,by,by-sa",
  });
  const data = await fetchJson(`${OPENVERSE_API}?${params}`);
  const hit = data?.results?.[0];
  if (!hit?.url) return null;
  const credit = `${hit.creator || "Unknown"} / ${hit.source || "Openverse"} (${(hit.license || "").toUpperCase()})`;
  return { url: hit.url, credit };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const cats = ["animals", "nature", "rain", "urban", "places", "transport", "things", "noise", "binaural"];
  const items = [];
  const attribution = [];

  for (const cat of cats) {
    const text = await fetchText(`${MOODIST_RAW}/src/data/sounds/${cat}.tsx`);
    const { catIcon, sounds } = parseCategoryFile(text, cat);
    for (const s of sounds) {
      const moodistRel = s.src.replace(/^\//, "");
      const localRel = moodistRel;
      const absAudio = path.join(OUT, localRel);
      fs.mkdirSync(path.dirname(absAudio), { recursive: true });
      const ext = path.extname(localRel);
      if (!fs.existsSync(absAudio)) {
        process.stdout.write(`↓ audio ${s.id}${ext} … `);
        const buf = await fetchBuf(`${MOODIST_RAW}/public/${moodistRel}`);
        fs.writeFileSync(absAudio, buf);
        console.log("ok");
      }
      const imageRel = localRel.replace(/\.(mp3|wav)$/i, ".jpg");
      const absImage = path.join(OUT, imageRel);
      let imageCredit = "";
      let hasImage = fs.existsSync(absImage) && fs.statSync(absImage).size > 100;
      if (!hasImage) {
        const q = IMAGE_QUERY[s.id] || s.label;
        process.stdout.write(`↓ image ${s.id} … `);
        try {
          const img = await fetchCoverImage(q);
          await sleep(220);
          if (img) {
            const ib = await fetchBuf(img.url);
            fs.writeFileSync(absImage, ib);
            imageCredit = img.credit;
            hasImage = true;
            console.log("openverse");
          } else {
            console.log("skip");
          }
        } catch (err) {
          console.log("err");
        }
      } else {
        imageCredit = "Openverse (cached)";
      }
      items.push({
        id: s.id,
        category: cat,
        categoryZh: CATEGORY_ZH[cat],
        categoryIcon: CATEGORY_ICONS[cat],
        nameZh: fixNameZh(s.id, s.label),
        nameEn: s.label,
        icon: RI_TO_ICONIFY[s.icon] || "bi:music-note-beamed",
        audio: `./assets/ambient/${localRel}`,
        image: hasImage ? `./assets/ambient/${imageRel}` : "",
        tags: [fixNameZh(s.id, s.label), s.label, CATEGORY_ZH[cat], cat],
      });
      attribution.push({
        id: s.id,
        audioSource: "remvze/moodist (Pixabay/CC0 per upstream)",
        imageCredit: imageCredit || "Icon fallback",
      });
    }
  }

  const catalog = {
    version: 1,
    credit: "Audio catalog inspired by remvze/moodist (MIT). Audio assets from upstream third-party licenses (Pixabay/CC0).",
    categories: cats.map((id) => ({
      id,
      nameZh: CATEGORY_ZH[id],
      nameEn: id.charAt(0).toUpperCase() + id.slice(1),
      icon: CATEGORY_ICONS[id],
    })),
    items,
  };

  fs.writeFileSync(path.join(OUT, "catalog.json"), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(OUT, "ATTRIBUTION.json"), JSON.stringify(attribution, null, 2));
  console.log(`\nDone: ${items.length} items → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
