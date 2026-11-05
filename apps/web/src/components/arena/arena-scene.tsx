'use client';

/* Three.js scenes, skeletons and animation actions are intentionally mutable. */
/* eslint-disable react-hooks/immutability */
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  AnimationMixer,
  Box3,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Material,
  OrthographicCamera,
  PCFSoftShadowMap,
  type AnimationAction,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { ArenaEnvironment } from './arena-environment';
import { ArenaClouds } from './arena-clouds';
import { SceneReady } from './scene-ready';
import { hiddenAccessories, OWNED_FIGHTERS, type OwnedFighter } from '../play/mock-fighters';
import {
  ATTACKS,
  dashDistance,
  directionFor,
  homeFor,
  elevationFor,
  heroScaleFor,
  impactEnvelope,
  newCombatRuntime,
  smooth,
  type AttackRequest,
  type CombatStage,
} from './arena-combat';
import { CombatDriver, CombatVfx, type CombatRef } from './combat-vfx';
import type { ArenaOutcome } from './arena-outcome';

export type SceneProps = {
  outcome: ArenaOutcome | null;
  playerKind: OwnedFighter['kind'];
  playing: boolean;
  hp: { left: number; right: number };
  attack: AttackRequest | null;
  onImpact: (attack: AttackRequest) => void;
  onFinish: (id: number) => void;
  onStage: (stage: CombatStage) => void;
  onReady: () => void;
};

function CameraRig({
  runtime,
  playing,
  outcome,
}: {
  runtime: CombatRef;
  playing: boolean;
  outcome: ArenaOutcome | null;
}) {
  const baseZoom = useRef(60);
  const ending = useRef(0);
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const ortho = camera as OrthographicCamera;
    camera.position.set(0, 6.4, 18);
    camera.lookAt(0, 0.5, 0);
    ortho.zoom = Math.min(size.width / 14, size.height / 8.8);
    baseZoom.current = ortho.zoom;
    ortho.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate]);
  useFrame((_, delta) => {
    if (!playing) return;
    ending.current = outcome ? Math.min(ending.current + Math.min(delta, 0.06), 4) : 0;
    if (outcome) {
      const progress = smooth(ending.current / 1.8);
      const side = outcome === 'win' ? -1 : outcome === 'loss' ? 1 : 0;
      const focus = side * 1.25 * progress;
      camera.position.set(focus, 6.4 - progress * 0.4, 18);
      camera.lookAt(focus, 0.5 + progress * 0.35, 0);
      const ortho = camera as OrthographicCamera;
      ortho.zoom = baseZoom.current * (1 + progress * (side ? 0.15 : 0.04));
      ortho.updateProjectionMatrix();
      return;
    }
    const { request, time } = runtime.current;
    const kind = request?.kind;
    const impact = kind ? ATTACKS[kind].impact : 0;
    const amount = request
      ? impactEnvelope(time, impact, 0.42) *
        (kind === 'ultimate' ? 0.095 : kind === 'medium' ? 0.045 : 0.018)
      : 0;
    camera.position.set(Math.sin(time * 73) * amount, 6.4 + Math.cos(time * 91) * amount, 18);
    camera.lookAt(0, 0.5, 0);
    const zoom =
      baseZoom.current *
      (kind === 'ultimate'
        ? 1 + 0.045 * smooth(time / 1.4) * (1 - smooth((time - impact) / 1.1))
        : 1);
    const ortho = camera as OrthographicCamera;
    if (Math.abs(ortho.zoom - zoom) > 0.001) {
      ortho.zoom = zoom;
      ortho.updateProjectionMatrix();
    }
  });
  return null;
}

function AnimationClock({ playing }: { playing: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      clearInterval(timer);
      if (playing && !document.hidden) timer = setInterval(invalidate, 1000 / 30);
      invalidate();
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [playing, invalidate]);
  return null;
}

function Fighter({
  kind,
  side,
  playing,
  runtime,
  defeated,
  outcome,
}: {
  kind: OwnedFighter['kind'] | 'Barbarian';
  side: 'left' | 'right';
  playing: boolean;
  runtime: CombatRef;
  defeated: boolean;
  outcome: ArenaOutcome | null;
}) {
  const dir = directionFor(side);
  const root = useRef<Group>(null);
  const gltf = useLoader(GLTFLoader, `/arena/characters/${kind}.glb`);
  const model = useMemo(() => {
    const object = clone(gltf.scene);
    const accessories = hiddenAccessories(kind);
    const copies = new Map<Material, Material>();
    const copy = (material: Material) => {
      if (!copies.has(material)) copies.set(material, material.clone());
      return copies.get(material)!;
    };
    object.traverse((node) => {
      if (accessories.includes(node.name)) node.visible = false;
      if (node instanceof Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.material = Array.isArray(node.material)
          ? node.material.map(copy)
          : copy(node.material);
      }
    });
    const box = new Box3().setFromObject(object);
    const scale = 2.6 / (box.max.y - box.min.y);
    object.scale.setScalar(scale);
    object.position.y = -box.min.y * scale + 0.045;
    return {
      object,
      weapon: object.getObjectByName(
        OWNED_FIGHTERS.find((fighter) => fighter.kind === kind)?.weapon ?? '1H_Axe',
      ),
      materials: [...copies.values()].filter(
        (m): m is MeshStandardMaterial => m instanceof MeshStandardMaterial,
      ),
    };
  }, [gltf.scene, kind]);
  const animation = useRef<{
    mixer: AnimationMixer;
    idle: AnimationAction | null;
    actions: Map<string, AnimationAction>;
    active: AnimationAction | null;
  } | null>(null);
  const weaponScratch = useMemo(() => ({ tip: new Vector3(), base: new Vector3() }), []);
  const sequence = useRef({ id: 0, main: false, second: false, hit: false });
  useEffect(() => {
    const mixer = new AnimationMixer(model.object);
    const actions = new Map<string, AnimationAction>();
    for (const name of [
      'Idle',
      '1H_Melee_Attack_Slice_Horizontal',
      '1H_Melee_Attack_Chop',
      'Spellcast_Raise',
      '2H_Melee_Attack_Spin',
      'Hit_B',
      'Death_B',
      'Cheer',
      'Sit_Floor_Down',
    ]) {
      const clip = gltf.animations.find((a) => a.name === name);
      if (clip) actions.set(name, mixer.clipAction(clip));
    }
    const idle = actions.get('Idle') ?? null;
    const state = { mixer, idle, actions, active: null as AnimationAction | null };
    animation.current = state;
    idle?.play();
    mixer.update(0);
    const finish = (event: { action: AnimationAction }) => {
      if (state.active !== event.action) return;
      if (event.action === actions.get('Death_B')) return;
      if (event.action === actions.get('Cheer') || event.action === actions.get('Sit_Floor_Down'))
        return;
      event.action.fadeOut(0.16);
      idle?.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.16).play();
      state.active = null;
    };
    mixer.addEventListener('finished', finish);
    return () => {
      mixer.removeEventListener('finished', finish);
      mixer.stopAllAction();
      mixer.uncacheRoot(model.object);
      animation.current = null;
      model.materials.forEach((material) => material.dispose());
    };
  }, [model, gltf.animations]);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const state = animation.current;
    if (!state) return;
    const winner = outcome === 'win' ? 'left' : outcome === 'loss' ? 'right' : null;
    const clip =
      winner === side ? 'Cheer' : defeated ? 'Death_B' : winner ? 'Sit_Floor_Down' : null;
    if (clip) {
      const pose = state.actions.get(clip);
      if (pose) {
        if (clip === 'Death_B' && state.active === pose) return;
        state.idle?.fadeOut(0.12);
        state.active?.fadeOut(0.12);
        pose.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).setLoop(LoopOnce, 1);
        pose.clampWhenFinished = true;
        pose.fadeIn(0.12).play();
        state.active = pose;
        if (!playing) {
          state.mixer.update(pose.getClip().duration);
          if (winner === side && root.current) root.current.rotation.y = 0;
        }
      }
    } else {
      state.mixer.stopAllAction();
      state.active = null;
      state.idle?.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      state.mixer.update(0);
    }
    invalidate();
  }, [defeated, outcome, side, playing, invalidate, model]);
  useFrame((_, delta) => {
    if (!playing) return;
    const state = animation.current;
    if (!state) return;
    const { request, time } = runtime.current;
    const cast = (name: string, speed: number) => {
      const action = state.actions.get(name);
      if (!action) return;
      state.idle?.fadeOut(0.1);
      state.active?.fadeOut(0.1);
      action
        .reset()
        .setEffectiveTimeScale(speed)
        .setEffectiveWeight(1)
        .setLoop(LoopOnce, 1)
        .fadeIn(0.09)
        .play();
      action.clampWhenFinished = true;
      state.active = action;
    };
    if (request && sequence.current.id !== request.id)
      sequence.current = { id: request.id, main: false, second: false, hit: false };
    if (request && !defeated && !outcome) {
      const spec = ATTACKS[request.kind];
      if (request.attacker === side) {
        if (!sequence.current.main && time >= spec.animationAt) {
          sequence.current.main = true;
          cast(
            request.kind === 'basic'
              ? '1H_Melee_Attack_Slice_Horizontal'
              : request.kind === 'medium'
                ? '1H_Melee_Attack_Chop'
                : 'Spellcast_Raise',
            request.kind === 'basic' ? 1.5 : request.kind === 'medium' ? 1.2 : 1.4,
          );
        }
        if (request.kind === 'ultimate' && !sequence.current.second && time >= 1.48) {
          sequence.current.second = true;
          cast('2H_Melee_Attack_Spin', 1.5);
        }
      } else if (!sequence.current.hit && time >= spec.impact) {
        sequence.current.hit = true;
        cast('Hit_B', 1.1);
      }
    }
    const intensity =
      request && request.attacker !== side
        ? impactEnvelope(time, ATTACKS[request.kind].impact, 0.38)
        : 0;
    model.materials.forEach((material) => {
      material.emissive.set('#ffe9bf');
      material.emissiveIntensity = intensity * 0.75;
    });
    if (root.current) {
      const attacking = request?.attacker === side;
      const weight = request
        ? smooth(time / 0.3) * (1 - smooth((time - ATTACKS[request.kind].duration + 0.5) / 0.5))
        : 0;
      root.current.position.x = attacking ? dir * 0.45 * weight : 0;
      const celebrating =
        (outcome === 'win' && side === 'left') || (outcome === 'loss' && side === 'right');
      root.current.rotation.y = celebrating
        ? root.current.rotation.y * Math.exp(-delta * 3)
        : dir * (0.78 + (attacking ? 0.42 * weight : 0));
    }
    if (runtime.current.hitStop <= 0) state.mixer.update(Math.min(delta, 0.06));
    if (model.weapon) {
      model.weapon.localToWorld(weaponScratch.tip.set(0, 0.63, 0));
      model.weapon.localToWorld(weaponScratch.base.set(0, 0.1, 0));
      const sample = runtime.current.weapons[side] ?? { tip: [0, 0, 0], base: [0, 0, 0] };
      weaponScratch.tip.toArray(sample.tip);
      weaponScratch.base.toArray(sample.base);
      runtime.current.weapons[side] = sample;
    }
  });
  return (
    <group ref={root} rotation={[0, dir * 0.78, 0]}>
      <primitive object={model.object} dispose={null} />
    </group>
  );
}

function FloatingIsland({
  side,
  playerKind,
  playing,
  runtime,
  defeated,
  outcome,
}: {
  side: 'left' | 'right';
  playerKind: OwnedFighter['kind'];
  playing: boolean;
  runtime: CombatRef;
  defeated: boolean;
  outcome: ArenaOutcome | null;
}) {
  const gltf = useLoader(GLTFLoader, `/arena/island-${side === 'left' ? 'a' : 'b'}.glb?v=2`);
  const compact = useThree((state) => state.size.width < 600);
  const platformScale = heroScaleFor(compact);
  const elevation = elevationFor(compact);
  const group = useRef<Group>(null);
  const time = useRef(side === 'left' ? 0 : 2.4);
  const island = useMemo(() => {
    const object = gltf.scene.clone(true);
    object.traverse((node) => {
      if (node instanceof Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    return object;
  }, [gltf.scene]);
  useFrame((_, delta) => {
    if (!playing || !group.current) return;
    time.current += Math.min(delta, 0.05);
    const { request, time: attackTime } = runtime.current;
    const attacking = request?.attacker === side;
    const dir = request ? directionFor(request.attacker) : 1;
    const hit =
      request && !attacking ? impactEnvelope(attackTime, ATTACKS[request.kind].impact, 0.48) : 0;
    const dash = request && attacking ? dashDistance(request.kind, attackTime) : 0;
    const lift =
      request && attacking
        ? request.kind === 'basic'
          ? Math.sin(smooth((attackTime - 0.18) / 0.52) * Math.PI) * 0.18
          : request.kind === 'ultimate'
            ? 0.2 * smooth(attackTime) * (1 - smooth((attackTime - 2.5) / 0.8))
            : 0
        : 0;
    group.current.position.x = homeFor(side) + dir * (dash + hit * 0.16);
    group.current.position.y = elevation + Math.sin(time.current * 0.65) * 0.06 + lift + hit * 0.08;
    group.current.rotation.z = Math.sin(time.current * 0.36) * 0.012 - dir * hit * 0.05;
    group.current.rotation.x = Math.cos(time.current * 0.42) * 0.008;
  });
  return (
    <group
      ref={group}
      position={[side === 'left' ? -3.05 : 3.05, elevation, 0]}
      scale={platformScale}
    >
      <primitive object={island} dispose={null} />
      <Fighter
        kind={side === 'left' ? playerKind : 'Barbarian'}
        side={side}
        playing={playing}
        runtime={runtime}
        defeated={defeated}
        outcome={outcome}
      />
    </group>
  );
}

function VictorySparks({ outcome, playing }: { outcome: ArenaOutcome | null; playing: boolean }) {
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  const compact = useThree((state) => state.size.width < 600);
  useFrame((_, delta) => {
    if (!playing || !group.current) return;
    elapsed.current += Math.min(delta, 0.06);
    group.current.children.forEach((spark, index) => {
      const phase = (elapsed.current * 0.45 + index / 28) % 1;
      const angle = index * 2.39996;
      spark.position.set(
        Math.cos(angle) * (0.5 + phase),
        phase * 3.5,
        Math.sin(angle) * (0.5 + phase),
      );
      spark.rotation.set(phase * 5, angle, phase * 4);
      spark.scale.setScalar(Math.sin(phase * Math.PI) * 0.045);
    });
  });
  if (outcome !== 'win' && outcome !== 'loss') return null;
  const side = outcome === 'win' ? 'left' : 'right';
  return (
    <group position={[homeFor(side), elevationFor(compact), 0]}>
      <pointLight color="#ffe2a0" intensity={5} distance={6} />
      {playing && (
        <group ref={group}>
          {Array.from({ length: 28 }, (_, index) => (
            <mesh key={index} scale={0}>
              <octahedronGeometry args={[1, 0]} />
              <meshBasicMaterial color={index % 3 ? '#ffe5a3' : '#fff9e3'} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

export default function ArenaScene({
  outcome,
  playerKind,
  playing,
  hp,
  attack,
  onReady,
  onImpact,
  onFinish,
  onStage,
}: SceneProps) {
  const runtime = useRef(newCombatRuntime());
  return (
    <Canvas
      orthographic
      style={{ touchAction: 'pan-y' }}
      camera={{ position: [0, 6.4, 18], zoom: 60, near: 0.1, far: 120 }}
      dpr={[1, 1.5]}
      frameloop="demand"
      shadows={{ type: PCFSoftShadowMap }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      fallback={<div className="arena-loading">WebGL tidak tersedia.</div>}
      aria-label={`Arena 3D: ${playerKind} dan Barbarian di atas dua pulau rumput melayang`}
    >
      <fog attach="fog" args={['#c2dcea', 27, 75]} />
      <ambientLight intensity={0.8} />
      <hemisphereLight args={['#e7f3f7', '#8c8956', 1.65]} />
      <directionalLight
        position={[-5, 10, 7]}
        intensity={2.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-normalBias={0.035}
        shadow-bias={-0.00015}
        shadow-radius={4}
      />
      <directionalLight position={[5, 4, -5]} intensity={2.1} color="#f6e9d6" />
      <directionalLight position={[2, 2, 9]} intensity={0.35} color="#d8e6ff" />
      <CameraRig runtime={runtime} playing={playing} outcome={outcome} />
      <CombatDriver
        attack={attack}
        runtime={runtime}
        playing={playing}
        onImpact={onImpact}
        onFinish={onFinish}
        onStage={onStage}
      />
      <AnimationClock playing={playing} />
      <Suspense fallback={null}>
        <ArenaClouds playing={playing} />
        <ArenaEnvironment playing={playing} />
        <FloatingIsland
          playerKind={playerKind}
          side="left"
          playing={playing}
          runtime={runtime}
          defeated={hp.left <= 0}
          outcome={outcome}
        />
        <FloatingIsland
          playerKind={playerKind}
          side="right"
          playing={playing}
          runtime={runtime}
          defeated={hp.right <= 0}
          outcome={outcome}
        />
        <CombatVfx runtime={runtime} />
        <VictorySparks outcome={outcome} playing={playing} />
        <SceneReady onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}
