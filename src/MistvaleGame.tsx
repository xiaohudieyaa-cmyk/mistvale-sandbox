"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

type GameMode = "menu" | "playing";
type BlockType = "grass" | "dirt" | "stone" | "wood" | "lamp" | "leaf";
type Inventory = Record<ItemId, number>;
type ItemId = "dirt" | "stone" | "wood" | "lamp" | "leaf" | "apple";

type EngineApi = {
  breakBlock: () => void;
  placeBlock: () => void;
  interact: () => void;
  jump: () => void;
  setMove: (x: number, y: number) => void;
  craftLamp: () => void;
};

type Particle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  gravity: number;
};

const SAVE_KEY = "mistvale-save-v1";
const WORLD_RADIUS = 12;
const EYE_HEIGHT = 1.62;

const ITEMS: Array<{
  id: ItemId;
  name: string;
  detail: string;
  placeType?: BlockType;
}> = [
  { id: "dirt", name: "泥土", detail: "柔软的山谷土壤", placeType: "dirt" },
  { id: "stone", name: "青石", detail: "适合搭建坚固地基", placeType: "stone" },
  { id: "wood", name: "原木", detail: "带着松脂的清香", placeType: "wood" },
  { id: "lamp", name: "萤灯", detail: "会在雾里发出暖光", placeType: "lamp" },
  { id: "leaf", name: "树叶", detail: "轻而蓬松的绿叶", placeType: "leaf" },
  { id: "apple", name: "红苹果", detail: "谷中动物很喜欢" },
];

const INITIAL_INVENTORY: Inventory = {
  dirt: 18,
  stone: 14,
  wood: 10,
  lamp: 4,
  leaf: 12,
  apple: 5,
};

const BLOCK_COLORS: Record<BlockType, number> = {
  grass: 0x6fa04f,
  dirt: 0x875a39,
  stone: 0x777c82,
  wood: 0x725039,
  lamp: 0xf1c760,
  leaf: 0x3f7f4c,
};

const BLOCK_TO_ITEM: Record<BlockType, ItemId> = {
  grass: "dirt",
  dirt: "dirt",
  stone: "stone",
  wood: "wood",
  lamp: "lamp",
  leaf: "leaf",
};

function blockKey(x: number, y: number, z: number) {
  return `${x},${y},${z}`;
}

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function terrainHeight(x: number, z: number) {
  const hill = Math.sin(x * 0.33) * 0.72 + Math.cos(z * 0.29) * 0.68;
  const ridge = Math.sin((x + z) * 0.18) * 0.45;
  return Math.max(1, Math.min(4, Math.floor(2.4 + hill + ridge)));
}

function generateWorld() {
  const map = new Map<string, BlockType>();
  const random = seededRandom(1927);

  for (let x = -WORLD_RADIUS; x < WORLD_RADIUS; x += 1) {
    for (let z = -WORLD_RADIUS; z < WORLD_RADIUS; z += 1) {
      const h = terrainHeight(x, z);
      for (let y = 0; y <= h; y += 1) {
        map.set(blockKey(x, y, z), y === h ? "grass" : y < h - 1 ? "stone" : "dirt");
      }

      const clearSpawn = Math.abs(x) < 4 && Math.abs(z) < 4;
      if (!clearSpawn && random() > 0.958 && Math.abs(x) < 10 && Math.abs(z) < 10) {
        const trunk = 3 + Math.floor(random() * 2);
        for (let y = 1; y <= trunk; y += 1) {
          map.set(blockKey(x, h + y, z), "wood");
        }
        for (let ox = -2; ox <= 2; ox += 1) {
          for (let oz = -2; oz <= 2; oz += 1) {
            for (let oy = trunk - 1; oy <= trunk + 1; oy += 1) {
              const canopy = Math.abs(ox) + Math.abs(oz) + Math.abs(oy - trunk) < 4;
              const trunkSpace = ox === 0 && oz === 0 && oy <= trunk;
              if (canopy && !trunkSpace) map.set(blockKey(x + ox, h + oy, z + oz), "leaf");
            }
          }
        }
      }
    }
  }

  [
    [-2, 4, -6],
    [-1, 4, -6],
    [0, 4, -6],
    [1, 4, -6],
    [2, 4, -6],
  ].forEach(([x, y, z], index) => map.set(blockKey(x, y, z), index === 2 ? "lamp" : "stone"));
  return map;
}

function makeBlockMaterial(type: BlockType) {
  if (type === "leaf") {
    return new THREE.MeshStandardMaterial({
      color: BLOCK_COLORS[type],
      roughness: 1,
      transparent: true,
      opacity: 0.94,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: BLOCK_COLORS[type],
    roughness: type === "lamp" ? 0.6 : 0.92,
    metalness: 0,
    emissive: type === "lamp" ? 0xe0a63d : 0,
    emissiveIntensity: type === "lamp" ? 0.62 : 0,
    flatShading: true,
  });
}

function createAnimal(
  id: string,
  kind: "sheep" | "deer" | "chicken",
  name: string,
  x: number,
  z: number,
) {
  const group = new THREE.Group();
  group.position.set(x, terrainHeight(Math.round(x), Math.round(z)) + 0.55, z);
  group.userData.animalId = id;
  group.userData.kind = kind;
  group.userData.animalName = name;
  group.userData.origin = new THREE.Vector3(x, group.position.y, z);
  group.userData.phase = Number(id.replace(/\D/g, "")) * 1.73;
  group.userData.happyUntil = 0;

  const box = new THREE.BoxGeometry(1, 1, 1);
  const addPart = (
    sx: number,
    sy: number,
    sz: number,
    px: number,
    py: number,
    pz: number,
    color: number,
  ) => {
    const part = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
    part.scale.set(sx, sy, sz);
    part.position.set(px, py, pz);
    part.castShadow = true;
    part.receiveShadow = true;
    part.userData.animalId = id;
    part.userData.animalRoot = group;
    group.add(part);
    return part;
  };

  if (kind === "sheep") {
    addPart(1.18, 0.85, 0.72, 0, 0.86, 0, 0xf1eee5);
    addPart(0.5, 0.52, 0.52, 0, 1.04, 0.58, 0x4d4641);
    [-0.38, 0.38].forEach((lx) => {
      [-0.25, 0.28].forEach((lz) => addPart(0.16, 0.58, 0.16, lx, 0.33, lz, 0x4d4641));
    });
  } else if (kind === "deer") {
    addPart(1.05, 0.72, 0.55, 0, 1.02, 0, 0xa66e3f);
    addPart(0.42, 0.58, 0.42, 0, 1.35, 0.5, 0x9a6036);
    addPart(0.12, 0.42, 0.1, -0.16, 1.83, 0.52, 0x463226);
    addPart(0.12, 0.42, 0.1, 0.16, 1.83, 0.52, 0x463226);
    [-0.35, 0.35].forEach((lx) => {
      [-0.2, 0.25].forEach((lz) => addPart(0.13, 0.82, 0.13, lx, 0.48, lz, 0x6f472f));
    });
  } else {
    addPart(0.62, 0.62, 0.62, 0, 0.55, 0, 0xf2dfb4);
    addPart(0.4, 0.42, 0.4, 0, 0.92, 0.32, 0xf5e8c8);
    addPart(0.24, 0.13, 0.3, 0, 0.9, 0.65, 0xe99b36);
    addPart(0.1, 0.35, 0.1, -0.16, 0.2, 0, 0xd39a46);
    addPart(0.1, 0.35, 0.1, 0.16, 0.2, 0, 0xd39a46);
  }

  return group;
}

export default function MistvaleGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef<GameMode>("menu");
  const inventoryOpenRef = useRef(false);
  const selectedRef = useRef(0);
  const inventoryRef = useRef<Inventory>({ ...INITIAL_INVENTORY });
  const engineRef = useRef<EngineApi | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mode, setMode] = useState<GameMode>("menu");
  const [loaded, setLoaded] = useState(false);
  const [renderFallback, setRenderFallback] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [inventory, setInventory] = useState<Inventory>({ ...INITIAL_INVENTORY });
  const [animalsMet, setAnimalsMet] = useState(0);
  const [toast, setToast] = useState("");
  const [hasSave, setHasSave] = useState(false);
  const [joyKnob, setJoyKnob] = useState({ x: 0, y: 0 });

  const notify = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 1900);
  };

  const chooseSlot = (index: number) => {
    selectedRef.current = index;
    setSelected(index);
    notify(`已选择：${ITEMS[index].name}`);
  };

  const toggleInventory = () => {
    const next = !inventoryOpenRef.current;
    inventoryOpenRef.current = next;
    setInventoryOpen(next);
    engineRef.current?.setMove(0, 0);
    if (next && document.pointerLockElement) document.exitPointerLock();
  };

  const beginPlay = () => {
    modeRef.current = "playing";
    setMode("playing");
    setInventoryOpen(false);
    inventoryOpenRef.current = false;
    notify("点击或滑动画面观察四周");
  };

  const returnToMenu = () => {
    modeRef.current = "menu";
    setMode("menu");
    setInventoryOpen(false);
    inventoryOpenRef.current = false;
    engineRef.current?.setMove(0, 0);
    if (document.pointerLockElement) document.exitPointerLock();
  };

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    inventoryOpenRef.current = inventoryOpen;
  }, [inventoryOpen]);

  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // The renderer owns one long-lived world; live UI values are synchronized through refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const storedRaw = window.localStorage.getItem(SAVE_KEY);
    const fallbackWorld = generateWorld();
    let blockMap = fallbackWorld;
    const metAnimals = new Set<string>();
    const player = new THREE.Vector3(0, terrainHeight(0, 0) + 2.15, 2);
    let yaw = 0;
    let pitch = -0.08;

    if (storedRaw) {
      try {
        const stored = JSON.parse(storedRaw) as {
          blocks?: Array<[string, BlockType]>;
          inventory?: Inventory;
          animals?: string[];
          player?: number[];
          yaw?: number;
        };
        if (stored.blocks?.length) blockMap = new Map(stored.blocks);
        if (stored.inventory) {
          inventoryRef.current = { ...INITIAL_INVENTORY, ...stored.inventory };
          setInventory(inventoryRef.current);
        }
        stored.animals?.forEach((id) => metAnimals.add(id));
        setAnimalsMet(metAnimals.size);
        if (stored.player?.length === 3) player.set(stored.player[0], stored.player[1], stored.player[2]);
        if (typeof stored.yaw === "number") yaw = stored.yaw;
        setHasSave(true);
      } catch {
        window.localStorage.removeItem(SAVE_KEY);
      }
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: window.devicePixelRatio < 2,
        powerPreference: "high-performance",
      });
    } catch {
      setRenderFallback(true);
      setLoaded(true);
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb9d8dc);
    scene.fog = new THREE.Fog(0xb9d8dc, 17, 48);

    const camera = new THREE.PerspectiveCamera(64, 1, 0.06, 95);
    camera.rotation.order = "YXZ";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.55));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;

    scene.add(new THREE.HemisphereLight(0xdaf5ff, 0x63704c, 2.05));
    const sun = new THREE.DirectionalLight(0xfff0c4, 2.35);
    sun.position.set(-13, 20, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -19;
    sun.shadow.camera.right = 19;
    sun.shadow.camera.top = 19;
    sun.shadow.camera.bottom = -19;
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffefd0 }),
    );
    sunDisc.position.set(-24, 23, -34);
    scene.add(sunDisc);

    const world = new THREE.Group();
    scene.add(world);
    const blockGeometry = new THREE.BoxGeometry(0.99, 0.99, 0.99);
    const materials = Object.fromEntries(
      (Object.keys(BLOCK_COLORS) as BlockType[]).map((type) => [type, makeBlockMaterial(type)]),
    ) as Record<BlockType, THREE.MeshStandardMaterial>;
    let blockMeshes: THREE.InstancedMesh[] = [];

    const rebuildBlocks = () => {
      blockMeshes.forEach((mesh) => world.remove(mesh));
      blockMeshes = [];
      const grouped = Object.fromEntries(
        (Object.keys(BLOCK_COLORS) as BlockType[]).map((type) => [type, [] as THREE.Vector3[]]),
      ) as Record<BlockType, THREE.Vector3[]>;
      blockMap.forEach((type, key) => {
        const [x, y, z] = key.split(",").map(Number);
        grouped[type].push(new THREE.Vector3(x, y, z));
      });
      const matrix = new THREE.Matrix4();
      (Object.keys(grouped) as BlockType[]).forEach((type) => {
        const positions = grouped[type];
        if (!positions.length) return;
        const mesh = new THREE.InstancedMesh(blockGeometry, materials[type], positions.length);
        positions.forEach((position, index) => {
          matrix.makeTranslation(position.x, position.y, position.z);
          mesh.setMatrixAt(index, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.blockType = type;
        mesh.userData.positions = positions;
        mesh.castShadow = type === "wood" || type === "leaf";
        mesh.receiveShadow = true;
        world.add(mesh);
        blockMeshes.push(mesh);
      });
    };
    rebuildBlocks();

    const waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x5ba6ba,
      transparent: true,
      opacity: 0.68,
      roughness: 0.2,
      transmission: 0.08,
    });
    const water = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 6), waterMaterial);
    water.position.set(-8.4, 1.58, 8.5);
    scene.add(water);

    const animals = [
      createAnimal("sheep1", "sheep", "白团", 3, 5),
      createAnimal("sheep2", "sheep", "云朵", 6, 3),
      createAnimal("deer3", "deer", "栗角", -3, -4),
      createAnimal("chicken4", "chicken", "米粒", 0, 7),
      createAnimal("chicken5", "chicken", "小麦", -6, 2),
    ];
    const animalParts: THREE.Object3D[] = [];
    animals.forEach((animal) => {
      world.add(animal);
      animal.traverse((object) => {
        if (object instanceof THREE.Mesh) animalParts.push(object);
      });
    });

    const random = seededRandom(4821);
    const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xf6faf3, roughness: 1 });
    const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
    const clouds: THREE.Group[] = [];
    for (let i = 0; i < 7; i += 1) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 4; j += 1) {
        const puff = new THREE.Mesh(cloudGeometry, cloudMaterial);
        puff.scale.set(2.4 + random() * 2, 0.55 + random() * 0.75, 1.2 + random());
        puff.position.set(j * 2 - 3, random() * 0.8, random() - 0.5);
        cloud.add(puff);
      }
      cloud.position.set(-24 + i * 8, 13 + random() * 6, -12 + random() * 27);
      scene.add(cloud);
      clouds.push(cloud);
    }

    const fireflyPositions = new Float32Array(66 * 3);
    for (let i = 0; i < 66; i += 1) {
      fireflyPositions[i * 3] = (random() - 0.5) * 28;
      fireflyPositions[i * 3 + 1] = 3 + random() * 6;
      fireflyPositions[i * 3 + 2] = (random() - 0.5) * 28;
    }
    const fireflyGeometry = new THREE.BufferGeometry();
    fireflyGeometry.setAttribute("position", new THREE.BufferAttribute(fireflyPositions, 3));
    const fireflies = new THREE.Points(
      fireflyGeometry,
      new THREE.PointsMaterial({ color: 0xffdc77, size: 0.09, transparent: true, opacity: 0.72 }),
    );
    scene.add(fireflies);

    const selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.025, 1.025, 1.025)),
      new THREE.LineBasicMaterial({ color: 0xfff1bd, transparent: true, opacity: 0.92 }),
    );
    selection.visible = false;
    scene.add(selection);

    const raycaster = new THREE.Raycaster();
    raycaster.far = 6;
    const center = new THREE.Vector2(0, 0);
    let currentBlockTarget: { position: THREE.Vector3; normal: THREE.Vector3; type: BlockType } | null = null;
    let currentAnimalTarget: THREE.Group | null = null;
    const particles: Particle[] = [];

    const highestSolid = (x: number, z: number) => {
      const bx = Math.round(x);
      const bz = Math.round(z);
      let highest = -1;
      blockMap.forEach((type, key) => {
        if (type === "leaf") return;
        const [kx, ky, kz] = key.split(",").map(Number);
        if (kx === bx && kz === bz && ky > highest) highest = ky;
      });
      return highest;
    };

    const groundEye = (x: number, z: number) => highestSolid(x, z) + 0.5 + EYE_HEIGHT;
    if (player.y < groundEye(player.x, player.z)) player.y = groundEye(player.x, player.z);

    const saveGame = () => {
      window.localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          blocks: Array.from(blockMap.entries()),
          inventory: inventoryRef.current,
          animals: Array.from(metAnimals),
          player: [Number(player.x.toFixed(2)), Number(player.y.toFixed(2)), Number(player.z.toFixed(2))],
          yaw: Number(yaw.toFixed(3)),
        }),
      );
      setHasSave(true);
    };

    const changeInventory = (item: ItemId, delta: number) => {
      const next = {
        ...inventoryRef.current,
        [item]: Math.max(0, inventoryRef.current[item] + delta),
      };
      inventoryRef.current = next;
      setInventory(next);
      return next[item];
    };

    const refreshTarget = () => {
      raycaster.setFromCamera(center, camera);
      const animalHits = raycaster.intersectObjects(animalParts, false);
      currentAnimalTarget = animalHits.length && animalHits[0].distance <= 4.6
        ? (animalHits[0].object.userData.animalRoot as THREE.Group)
        : null;
      const hits = raycaster.intersectObjects(blockMeshes, false);
      const hit = hits.find((candidate) => candidate.distance <= 6 && candidate.instanceId !== undefined);
      if (!hit || hit.instanceId === undefined || !hit.face) {
        currentBlockTarget = null;
        selection.visible = false;
        return;
      }
      const mesh = hit.object as THREE.InstancedMesh;
      const position = (mesh.userData.positions as THREE.Vector3[])[hit.instanceId];
      currentBlockTarget = {
        position: position.clone(),
        normal: hit.face.normal.clone(),
        type: mesh.userData.blockType as BlockType,
      };
      selection.position.copy(position);
      selection.visible = true;
    };

    const spawnFragments = (position: THREE.Vector3, color: number, upward = 1) => {
      for (let i = 0; i < 7; i += 1) {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.12 + random() * 0.12, 0.12 + random() * 0.12, 0.12 + random() * 0.12),
          new THREE.MeshBasicMaterial({ color }),
        );
        mesh.position.copy(position).addScalar((random() - 0.5) * 0.2);
        scene.add(mesh);
        particles.push({
          mesh,
          velocity: new THREE.Vector3((random() - 0.5) * 2.2, random() * 2.2 * upward, (random() - 0.5) * 2.2),
          life: 0.75 + random() * 0.35,
          gravity: 4.8,
        });
      }
    };

    const showAnimalHeart = (animal: THREE.Group) => {
      const heart = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.28, 0.12),
        new THREE.MeshBasicMaterial({ color: 0xf06b6b }),
      );
      heart.rotation.z = Math.PI / 4;
      heart.position.copy(animal.position).add(new THREE.Vector3(0, 2.35, 0));
      scene.add(heart);
      particles.push({
        mesh: heart,
        velocity: new THREE.Vector3((random() - 0.5) * 0.3, 0.72, 0),
        life: 1.35,
        gravity: -0.05,
      });
    };

    const breakBlock = () => {
      if (modeRef.current !== "playing" || inventoryOpenRef.current) return;
      refreshTarget();
      if (currentAnimalTarget) {
        notify("这是动物，不可以挖掉它");
        return;
      }
      if (!currentBlockTarget) {
        notify("靠近一点再挖");
        return;
      }
      const { position, type } = currentBlockTarget;
      if (position.y <= 0) {
        notify("谷底的基岩挖不动");
        return;
      }
      blockMap.delete(blockKey(position.x, position.y, position.z));
      const item = BLOCK_TO_ITEM[type];
      changeInventory(item, 1);
      spawnFragments(position, BLOCK_COLORS[type]);
      rebuildBlocks();
      currentBlockTarget = null;
      selection.visible = false;
      notify(`获得 ${ITEMS.find((entry) => entry.id === item)?.name ?? "方块"} +1`);
      saveGame();
    };

    const placeBlock = () => {
      if (modeRef.current !== "playing" || inventoryOpenRef.current) return;
      refreshTarget();
      if (!currentBlockTarget) {
        notify("对准一个方块再放置");
        return;
      }
      const item = ITEMS[selectedRef.current];
      if (!item.placeType) {
        notify("苹果要拿给动物吃");
        return;
      }
      if (inventoryRef.current[item.id] <= 0) {
        notify(`${item.name}已经用完了`);
        return;
      }
      const destination = currentBlockTarget.position.clone().add(currentBlockTarget.normal).round();
      const key = blockKey(destination.x, destination.y, destination.z);
      if (blockMap.has(key) || Math.abs(destination.x) > 15 || Math.abs(destination.z) > 15) return;
      const nearPlayer = Math.abs(destination.x - player.x) < 0.75
        && Math.abs(destination.z - player.z) < 0.75
        && destination.y > player.y - EYE_HEIGHT - 0.2
        && destination.y < player.y + 0.4;
      if (nearPlayer) {
        notify("不能把方块放在自己身上");
        return;
      }
      blockMap.set(key, item.placeType);
      changeInventory(item.id, -1);
      rebuildBlocks();
      spawnFragments(destination, BLOCK_COLORS[item.placeType], 0.42);
      notify(`放置了 ${item.name}`);
      saveGame();
    };

    const interact = () => {
      if (modeRef.current !== "playing" || inventoryOpenRef.current) return;
      refreshTarget();
      if (!currentAnimalTarget) {
        notify("附近没有可以互动的动物");
        return;
      }
      const id = currentAnimalTarget.userData.animalId as string;
      const name = currentAnimalTarget.userData.animalName as string;
      const appleSelected = ITEMS[selectedRef.current].id === "apple";
      if (appleSelected && inventoryRef.current.apple > 0) {
        changeInventory("apple", -1);
        notify(`${name}开心地吃掉了苹果`);
      } else {
        notify(`${name}轻轻蹭了蹭你的手`);
      }
      if (!metAnimals.has(id)) {
        metAnimals.add(id);
        setAnimalsMet(metAnimals.size);
      }
      currentAnimalTarget.userData.happyUntil = performance.now() + 1200;
      showAnimalHeart(currentAnimalTarget);
      saveGame();
    };

    const moveInput = { x: 0, y: 0 };
    const keys = new Set<string>();
    let verticalSpeed = 0;
    let onGround = true;
    let saveClock = 0;

    engineRef.current = {
      breakBlock,
      placeBlock,
      interact,
      jump: () => {
        if (modeRef.current === "playing" && onGround && !inventoryOpenRef.current) {
          verticalSpeed = 5.4;
          onGround = false;
        }
      },
      setMove: (x, y) => {
        moveInput.x = x;
        moveInput.y = y;
      },
      craftLamp: () => {
        if (inventoryRef.current.stone < 2 || inventoryRef.current.wood < 1) {
          notify("需要青石 ×2、原木 ×1");
          return;
        }
        changeInventory("stone", -2);
        changeInventory("wood", -1);
        changeInventory("lamp", 2);
        notify("制作完成：萤灯 ×2");
        saveGame();
      },
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat && ["KeyQ", "KeyE", "Space"].includes(event.code)) return;
      if (event.code.startsWith("Digit")) {
        const index = Number(event.code.replace("Digit", "")) - 1;
        if (index >= 0 && index < ITEMS.length) chooseSlot(index);
      }
      if (event.code === "KeyQ" && modeRef.current === "playing") toggleInventory();
      if (event.code === "KeyE") interact();
      if (event.code === "Space") {
        event.preventDefault();
        engineRef.current?.jump();
      }
      keys.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas || modeRef.current !== "playing" || inventoryOpenRef.current) return;
      yaw -= event.movementX * 0.00215;
      pitch -= event.movementY * 0.00215;
      pitch = THREE.MathUtils.clamp(pitch, -1.42, 1.42);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (modeRef.current !== "playing" || inventoryOpenRef.current) return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
        return;
      }
      if (event.button === 0) breakBlock();
      if (event.button === 2) placeBlock();
    };
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    let lookPointer: number | null = null;
    let lastTouchX = 0;
    let lastTouchY = 0;
    const onCanvasPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || modeRef.current !== "playing" || inventoryOpenRef.current) return;
      lookPointer = event.pointerId;
      lastTouchX = event.clientX;
      lastTouchY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onCanvasPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || lookPointer !== event.pointerId || modeRef.current !== "playing") return;
      yaw -= (event.clientX - lastTouchX) * 0.006;
      pitch -= (event.clientY - lastTouchY) * 0.006;
      pitch = THREE.MathUtils.clamp(pitch, -1.42, 1.42);
      lastTouchX = event.clientX;
      lastTouchY = event.clientY;
    };
    const onCanvasPointerUp = (event: PointerEvent) => {
      if (lookPointer === event.pointerId) lookPointer = null;
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("pointerdown", onCanvasPointerDown);
    canvas.addEventListener("pointermove", onCanvasPointerMove);
    canvas.addEventListener("pointerup", onCanvasPointerUp);
    canvas.addEventListener("pointercancel", onCanvasPointerUp);

    let width = 0;
    let height = 0;
    const resize = () => {
      const nextWidth = canvas.clientWidth;
      const nextHeight = canvas.clientHeight;
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };

    const clock = new THREE.Clock();
    let frame = 0;
    let renderFrame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      resize();
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      renderFrame += 1;

      if (modeRef.current === "menu") {
        camera.position.set(
          Math.cos(elapsed * 0.055) * 17,
          9.7 + Math.sin(elapsed * 0.12) * 0.6,
          Math.sin(elapsed * 0.055) * 17,
        );
        camera.lookAt(0, 2.3, 0);
        selection.visible = false;
      } else {
        const forwardKey = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0)
          - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
        const rightKey = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0)
          - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
        const forwardAmount = THREE.MathUtils.clamp(forwardKey + moveInput.y, -1, 1);
        const rightAmount = THREE.MathUtils.clamp(rightKey + moveInput.x, -1, 1);
        const direction = new THREE.Vector3(
          -Math.sin(yaw) * forwardAmount + Math.cos(yaw) * rightAmount,
          0,
          -Math.cos(yaw) * forwardAmount - Math.sin(yaw) * rightAmount,
        );
        if (direction.lengthSq() > 1) direction.normalize();
        if (!inventoryOpenRef.current) {
          const speed = keys.has("ShiftLeft") ? 6 : 4.25;
          const nextX = THREE.MathUtils.clamp(player.x + direction.x * speed * delta, -14.5, 14.5);
          const nextZ = THREE.MathUtils.clamp(player.z + direction.z * speed * delta, -14.5, 14.5);
          const nextGround = groundEye(nextX, nextZ);
          if (!onGround || nextGround <= player.y + 0.86) {
            player.x = nextX;
            player.z = nextZ;
          }
        }
        verticalSpeed -= 12.5 * delta;
        player.y += verticalSpeed * delta;
        const ground = groundEye(player.x, player.z);
        if (player.y <= ground) {
          player.y = ground;
          verticalSpeed = 0;
          onGround = true;
        } else {
          onGround = false;
        }
        if (player.y < -4) {
          player.set(0, groundEye(0, 2), 2);
          verticalSpeed = 0;
          notify("雾把你送回了山谷入口");
        }
        camera.position.copy(player);
        camera.rotation.set(pitch, yaw, 0);
        if (renderFrame % 4 === 0 && !inventoryOpenRef.current) refreshTarget();
        saveClock += delta;
        if (saveClock > 10) {
          saveClock = 0;
          saveGame();
        }
      }

      animals.forEach((animal, index) => {
        const phase = elapsed * (0.19 + index * 0.014) + animal.userData.phase;
        const origin = animal.userData.origin as THREE.Vector3;
        animal.position.x = origin.x + Math.sin(phase) * 0.72;
        animal.position.z = origin.z + Math.cos(phase * 0.82) * 0.58;
        animal.position.y = terrainHeight(Math.round(animal.position.x), Math.round(animal.position.z)) + 0.55;
        animal.rotation.y = -phase + Math.PI / 2;
        const happy = performance.now() < animal.userData.happyUntil;
        const bounce = happy ? Math.abs(Math.sin(elapsed * 9)) * 0.2 : Math.sin(elapsed * 3 + index) * 0.018;
        animal.position.y += bounce;
      });
      clouds.forEach((cloud, index) => {
        cloud.position.x += delta * (0.16 + index * 0.012);
        if (cloud.position.x > 29) cloud.position.x = -29;
      });
      fireflies.rotation.y = elapsed * 0.015;
      water.position.y = 1.58 + Math.sin(elapsed * 0.8) * 0.025;
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const particle = particles[i];
        particle.life -= delta;
        particle.velocity.y -= particle.gravity * delta;
        particle.mesh.position.addScaledVector(particle.velocity, delta);
        particle.mesh.rotation.x += delta * 3;
        particle.mesh.rotation.y += delta * 4;
        particle.mesh.scale.multiplyScalar(Math.max(0.93, 1 - delta * 0.35));
        if (particle.life <= 0) {
          scene.remove(particle.mesh);
          particle.mesh.geometry.dispose();
          (particle.mesh.material as THREE.Material).dispose();
          particles.splice(i, 1);
        }
      }
      renderer.render(scene, camera);
    };
    animate();
    setLoaded(true);

    return () => {
      saveGame();
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("pointerdown", onCanvasPointerDown);
      canvas.removeEventListener("pointermove", onCanvasPointerMove);
      canvas.removeEventListener("pointerup", onCanvasPointerUp);
      canvas.removeEventListener("pointercancel", onCanvasPointerUp);
      renderer.dispose();
      blockGeometry.dispose();
      cloudGeometry.dispose();
      fireflyGeometry.dispose();
      water.geometry.dispose();
      waterMaterial.dispose();
      Object.values(materials).forEach((material) => material.dispose());
      engineRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoystick = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const max = rect.width * 0.32;
    const distance = Math.hypot(dx, dy);
    const scale = distance > max ? max / distance : 1;
    const x = dx * scale;
    const y = dy * scale;
    setJoyKnob({ x, y });
    engineRef.current?.setMove(x / max, -y / max);
  };

  const resetJoystick = () => {
    setJoyKnob({ x: 0, y: 0 });
    engineRef.current?.setMove(0, 0);
  };

  return (
    <main className={`game-shell${renderFallback ? " webgl-fallback" : ""}`}>
      <canvas ref={canvasRef} className="game-canvas" aria-label="雾谷方境 3D 游戏画面" />
      <div className="fallback-landscape" aria-hidden="true"><i /><i /><i /></div>
      <div className="mist-overlay" aria-hidden="true" />

      {mode === "menu" ? (
        <section className="start-screen">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <p className="eyebrow">A TINY BLOCK WORLD</p>
          <h1>雾谷方境</h1>
          <p className="start-copy">天亮之前，替山谷留下一点新的东西。</p>
          <button
            className="primary-button"
            type="button"
            onClick={beginPlay}
            disabled={!loaded}
          >
            {loaded ? (hasSave ? "继续探索" : "进入雾谷") : "世界生成中…"}
          </button>
          <div className="feature-row" aria-label="游戏特色">
            <span>探索方块世界</span>
            <span>遇见谷中动物</span>
            <span>自由采集建造</span>
          </div>
          <p className="start-tip">手机与电脑均可游玩 · 进度保存在本机</p>
        </section>
      ) : (
        <section className="hud-shell" aria-label="游戏界面">
          <div className="status-row" aria-label="生命状态"><span>♥</span><span>♥</span><span>♥</span><b>雾谷 · 清晨</b></div>
          <div className="quest-card">
            <span className="quest-label">清晨任务</span>
            <strong>{animalsMet >= 3 ? "山谷已经记住你了" : "和三只动物打个招呼"}</strong>
            <span className="quest-progress">{Math.min(animalsMet, 3)} / 3</span>
          </div>
          <div className="crosshair" aria-hidden="true" />

          <div className="top-actions">
            <button className="icon-button" type="button" onClick={toggleInventory} aria-label="打开物品栏">▣</button>
            <button className="icon-button" type="button" onClick={returnToMenu} aria-label="返回开始界面">Ⅱ</button>
          </div>

          <div className="desktop-help">WASD 移动　空格跳跃　鼠标控制视角<br />左键挖掘　右键放置　E 互动　Q 物品栏</div>

          <div className="hotbar" aria-label="快捷物品栏">
            {ITEMS.map((item, index) => (
              <button
                className={index === selected ? "hotbar-slot active" : "hotbar-slot"}
                key={item.id}
                type="button"
                onClick={() => chooseSlot(index)}
                aria-label={`${item.name}，数量 ${inventory[item.id]}`}
              >
                <span className={`item-cube item-${index}`} aria-hidden="true" />
                <small>{index + 1}</small>
                <em>{inventory[item.id]}</em>
                <b>{item.name}</b>
              </button>
            ))}
            <button className="bag-slot" type="button" onClick={toggleInventory} aria-label="打开完整物品栏">背包</button>
          </div>

          <div className="mobile-controls">
            <div
              className="joystick"
              role="group"
              aria-label="移动摇杆"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                handleJoystick(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) handleJoystick(event);
              }}
              onPointerUp={resetJoystick}
              onPointerCancel={resetJoystick}
            >
              <span style={{ transform: `translate(${joyKnob.x}px, ${joyKnob.y}px)` }} />
            </div>
            <div className="action-cluster">
              <button type="button" className="action-button small" onClick={() => engineRef.current?.interact()}>摸</button>
              <button type="button" className="action-button" onClick={() => engineRef.current?.breakBlock()}>挖</button>
              <button type="button" className="action-button" onClick={() => engineRef.current?.placeBlock()}>放</button>
              <button type="button" className="action-button jump" onClick={() => engineRef.current?.jump()}>跳</button>
            </div>
          </div>

          {toast ? <div className="game-toast" role="status">{toast}</div> : null}

          {inventoryOpen ? (
            <div className="inventory-backdrop" role="dialog" aria-modal="true" aria-label="物品栏">
              <div className="inventory-panel">
                <header>
                  <div><span>INVENTORY</span><h2>随身物品</h2></div>
                  <button type="button" onClick={toggleInventory} aria-label="关闭物品栏">×</button>
                </header>
                <div className="inventory-grid">
                  {ITEMS.map((item, index) => (
                    <button
                      type="button"
                      key={item.id}
                      className={selected === index ? "inventory-item selected" : "inventory-item"}
                      onClick={() => chooseSlot(index)}
                    >
                      <span className={`inventory-cube item-${index}`} aria-hidden="true" />
                      <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                      <em>× {inventory[item.id]}</em>
                    </button>
                  ))}
                </div>
                <div className="craft-card">
                  <div className="craft-icon">✦</div>
                  <div><span>简易制作</span><strong>萤灯 ×2</strong><small>青石 ×2　原木 ×1</small></div>
                  <button
                    type="button"
                    disabled={inventory.stone < 2 || inventory.wood < 1}
                    onClick={() => engineRef.current?.craftLamp()}
                  >制作</button>
                </div>
                <p className="inventory-tip">选中苹果后靠近动物，可以喂给它吃。</p>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}
