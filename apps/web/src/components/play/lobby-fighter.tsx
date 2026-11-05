'use client';

/* The Three.js mixer and scene objects are mutable animation state. */
/* eslint-disable react-hooks/immutability */
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { AnimationMixer, Box3, Group, OrthographicCamera, Euler, Quaternion } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { FighterAvatar } from './play-assets';
import { OWNED_FIGHTERS } from './mock-fighters';

function subscribeMotion(callback: () => void) {
  const query = matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', callback);
  document.addEventListener('visibilitychange', callback);
  return () => {
    query.removeEventListener('change', callback);
    document.removeEventListener('visibilitychange', callback);
  };
}
function LobbyCamera({ carousel }: { carousel: boolean }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const ortho = camera as OrthographicCamera;
    ortho.position.set(0, carousel ? 2.9 : 2.65, 10);
    ortho.lookAt(0, carousel ? 1.85 : 1.6, 0);
    ortho.zoom = Math.min(size.width / (carousel ? 7 : 4.6), size.height / (carousel ? 4.7 : 5.2));
    ortho.updateProjectionMatrix();
    invalidate();
  }, [camera, size, invalidate, carousel]);
  return null;
}
type FighterMood = 'idle' | 'victory' | 'sad';
function Knight({
  playing,
  modelPath,
  mood = 'idle',
  faceForward = false,
}: {
  playing: boolean;
  modelPath: string;
  mood?: FighterMood;
  faceForward?: boolean;
}) {
  const gltf = useLoader(GLTFLoader, modelPath);
  const group = useRef<Group>(null);
  const model = useMemo(() => {
    const object = clone(gltf.scene);
    const hidden = [
      '1H_Sword_Offhand',
      'Rectangle_Shield',
      'Round_Shield',
      'Spike_Shield',
      '2H_Sword',
    ];
    if (modelPath.includes('Mage')) hidden.push('Spellbook', 'Spellbook_open', '1H_Wand');
    if (modelPath.includes('Rogue')) hidden.push('1H_Crossbow', '2H_Crossbow', 'Throwable');
    if (modelPath.includes('Barbarian')) hidden.push('1H_Axe_Offhand', '2H_Axe', 'Mug');
    if (mood === 'sad')
      hidden.push(
        '1H_Sword',
        '1H_Axe',
        'Knife',
        'Knife_Offhand',
        '2H_Staff',
        'Round_Shield',
        'Rectangle_Shield',
        'Spike_Shield',
      );
    object.traverse((node) => {
      if (hidden.includes(node.name)) node.visible = false;
    });
    const box = new Box3().setFromObject(object),
      scale = 3.5 / (box.max.y - box.min.y);
    object.scale.setScalar(scale);
    object.position.y = -box.min.y * scale;
    return object;
  }, [gltf.scene, modelPath, mood]);
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  const head = useMemo(() => model.getObjectByName('head'), [model]);
  const headBase = useRef(new Quaternion());
  const headTilt = useMemo(() => new Quaternion().setFromEuler(new Euler(0.32, 0, -0.08)), []);
  useEffect(() => {
    const desired = mood === 'victory' ? 'Cheer' : mood === 'sad' ? 'Sit_Floor_Idle' : 'Idle';
    const clip =
      gltf.animations.find((clip) => clip.name === desired) ??
      gltf.animations.find((clip) => clip.name === 'Idle');
    if (clip) {
      const action = mixer.clipAction(clip);
      action.setEffectiveTimeScale(mood === 'victory' ? 0.9 : mood === 'sad' ? 0.65 : 1).play();
      if (mood !== 'idle') action.time = Math.min(0.45, clip.duration * 0.35);
    }
    mixer.update(0);
    if (head) {
      headBase.current.copy(head.quaternion);
      if (mood === 'sad') head.quaternion.multiply(headTilt);
    }
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    };
  }, [gltf.animations, mixer, model, mood, head, headTilt]);
  useFrame(({ clock }, delta) => {
    if (!playing) return;
    if (mood === 'sad' && head) head.quaternion.copy(headBase.current);
    mixer.update(Math.min(delta, 0.05));
    if (mood === 'sad' && head) {
      headBase.current.copy(head.quaternion);
      head.quaternion.multiply(headTilt);
    }
    if (group.current)
      group.current.rotation.y = faceForward
        ? 0
        : 0.32 + Math.sin(clock.elapsedTime * 0.6) * (mood === 'sad' ? 0.015 : 0.06);
  });
  return (
    <group ref={group} rotation={[0, faceForward ? 0 : 0.32, 0]}>
      <primitive object={model} dispose={null} />
    </group>
  );
}
function Stand() {
  return (
    <group>
      <mesh position={[0, -0.14, 0]}>
        <cylinderGeometry args={[1.22, 1.37, 0.25, 8]} />
        <meshStandardMaterial color="#46543a" roughness={0.85} metalness={0.12} />
      </mesh>
      <mesh position={[0, -0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.12, 1.145, 64]} />
        <meshBasicMaterial color="#d5c184" transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, -0.27, 0]}>
        <cylinderGeometry args={[1.36, 1.2, 0.11, 8]} />
        <meshStandardMaterial color="#9b8b57" roughness={0.7} metalness={0.35} />
      </mesh>
    </group>
  );
}

function CarouselSlot({
  index,
  selectedId,
  playing,
  reducedMotion,
}: {
  index: number;
  selectedId: number;
  playing: boolean;
  reducedMotion: boolean;
}) {
  const group = useRef<Group>(null);
  const slot = (index - selectedId + 3) % 3;
  const side = slot === 2 ? -1 : slot;
  const target = {
    x: side * 2.35,
    y: side ? 0.45 : 0,
    z: side ? -1.7 : 0.4,
    scale: side ? 0.72 : 1.15,
  };
  const [initial] = useState(target);
  useFrame((_, delta) => {
    if (!group.current) return;
    const amount = reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, 0.05) * 10);
    group.current.position.x += (target.x - group.current.position.x) * amount;
    group.current.position.y += (target.y - group.current.position.y) * amount;
    group.current.position.z += (target.z - group.current.position.z) * amount;
    const scale = group.current.scale.x + (target.scale - group.current.scale.x) * amount;
    group.current.scale.setScalar(scale);
  });
  return (
    <group ref={group} position={[initial.x, initial.y, initial.z]} scale={initial.scale}>
      <Knight
        playing={playing}
        modelPath={`/arena/characters/${OWNED_FIGHTERS[index]!.kind}.glb`}
      />
      <Stand />
    </group>
  );
}

export default function LobbyFighter({
  paused = false,
  modelPath = '/arena/characters/Knight.glb',
  label = 'Your fighter, The Sentinel, standing on an illuminated stone pedestal',
  carouselId,
  mood = 'idle',
  faceForward = false,
}: {
  paused?: boolean;
  modelPath?: string;
  label?: string;
  carouselId?: number;
  mood?: FighterMood;
  faceForward?: boolean;
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true,
  );
  const playing = !paused && !reducedMotion;
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 2.65, 10], zoom: 70, near: 0.1, far: 40 }}
      dpr={[1, 1.5]}
      frameloop={playing ? 'always' : 'demand'}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      fallback={
        <div className="hub-fighter-fallback">
          <FighterAvatar />
        </div>
      }
      aria-label={label}
    >
      <ambientLight intensity={1.2} />
      <hemisphereLight args={['#e7efd4', '#364d30', 1.6]} />
      <directionalLight position={[-4, 6, 6]} intensity={3} />
      <directionalLight position={[4, 3, -4]} intensity={3} color="#e9ce87" />
      <LobbyCamera carousel={carouselId !== undefined} />
      <Suspense fallback={null}>
        {carouselId !== undefined ? (
          OWNED_FIGHTERS.map((fighter, index) => (
            <CarouselSlot
              key={fighter.id}
              index={index}
              selectedId={carouselId}
              playing={playing}
              reducedMotion={reducedMotion}
            />
          ))
        ) : (
          <>
            <Knight
              key={modelPath}
              playing={playing}
              modelPath={modelPath}
              mood={mood}
              faceForward={faceForward}
            />
            <Stand />
          </>
        )}
      </Suspense>
    </Canvas>
  );
}
